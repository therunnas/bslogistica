/**
 * Orquestração do backend administrativo de usuários — a "lógica de negócio"
 * entre `cliente.ts` (o que o `service_role` sabe fazer) e `dominio.ts`
 * (regras puras). Cada função recebe o `ClienteAdministrativo` por parâmetro,
 * nunca o cria: quem monta o cliente real é `_acoes.ts`; quem injeta um falso
 * é `scripts/testar-admin-usuarios.mjs`. Mesma separação de
 * `operacional/rpc.ts` e `operacional/mutations.ts`.
 *
 * Nenhuma função aqui decide AUTORIZAÇÃO — isso é `autorizacao.ts`, chamado
 * antes, em `_acoes.ts`. Estas funções assumem que quem as chama já provou
 * ser admin em AAL2, e recebem o `ator` só para carimbar a auditoria.
 */

import {
  ACAO_AUDITORIA,
  type Papel,
  type ResultadoAlteracaoDePapel,
  type ResultadoConvite,
  type ResultadoReativacao,
  type ResultadoRevogacaoDeAcesso,
  type UsuarioAdministrativo,
} from "./tipos";
import {
  combinarUsuariosEPapeis,
  exigirEmailValido,
  exigirPapelValido,
  exigirUuid,
} from "./dominio";
import { ErroAdministrativo, type ClienteAdministrativo } from "./cliente";

export async function listarUsuarios(
  cliente: ClienteAdministrativo,
): Promise<UsuarioAdministrativo[]> {
  const [usuarios, papeis] = await Promise.all([cliente.listarUsuarios(), cliente.listarPapeis()]);
  return combinarUsuariosEPapeis(usuarios, papeis);
}

export interface ConvidarUsuarioEntrada {
  email: unknown;
  papel: unknown;
  nomeCompleto?: unknown;
}

/**
 * Convite por e-mail (`auth.admin.inviteUserByEmail`), seguido da atribuição
 * EXPLÍCITA do papel escolhido.
 *
 * As duas coisas não são a mesma chamada de propósito: o convite só cria a
 * conta e o perfil — via `provision_bslog_user`, que desde a migration
 * `remove_automatic_admin_bootstrap` NUNCA atribui papel sozinha (ver
 * PROGRESS.md, seção 6). "Contas nascem por convite; papel é decisão
 * administrativa separada" é regra do projeto, não deste módulo.
 *
 * Se o convite for criado mas a concessão do papel falhar, a conta fica
 * "sem-papel" — o mesmo estado, já tratado em toda a aplicação, de uma conta
 * que ainda não recebeu atribuição nenhuma. Não é um estado inconsistente: é
 * o degrau intermediário que já existe hoje entre "convite aceito" e "admin
 * atribuiu um papel", só que descoberto um passo mais cedo. Quem chama decide
 * se tenta atribuir de novo.
 */
export async function convidarUsuario(
  cliente: ClienteAdministrativo,
  entrada: ConvidarUsuarioEntrada,
  ator: { id: string },
): Promise<ResultadoConvite> {
  let email: string;
  let papel: Papel;
  try {
    email = exigirEmailValido(entrada.email);
    papel = exigirPapelValido(entrada.papel);
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  const nomeCompleto =
    typeof entrada.nomeCompleto === "string" && entrada.nomeCompleto.trim() !== ""
      ? entrada.nomeCompleto.trim()
      : null;

  try {
    const { userId } = await cliente.convidarPorEmail(email, nomeCompleto);
    await cliente.concederPapel(userId, papel);
    await cliente.registrarAuditoria({
      actorId: ator.id,
      action: ACAO_AUDITORIA.convite,
      targetUserId: userId,
      details: { email, papel },
    });
    return { situacao: "convidado", userId };
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao convidar usuário.",
    };
  }
}

/** Código que `proteger_ultimo_admin()` (migration 017) usa para recusar. */
const SQLSTATE_RECUSADO = "42501";

function ehRecusaDoUltimoAdmin(erro: unknown): boolean {
  return erro instanceof ErroAdministrativo && erro.code === SQLSTATE_RECUSADO;
}

export interface AlterarPapelEntrada {
  userId: unknown;
  papel: unknown;
  acao: "conceder" | "revogar";
}

/**
 * Concede ou revoga UM papel de uma conta. A proteção do último admin não é
 * verificada aqui em JavaScript antes de tentar — é o trigger
 * `trg_proteger_ultimo_admin` (017) que decide, porque só o banco vê o estado
 * atomicamente; este código só traduz o `42501` dele numa resposta legível.
 */
export async function alterarPapel(
  cliente: ClienteAdministrativo,
  entrada: AlterarPapelEntrada,
  ator: { id: string },
): Promise<ResultadoAlteracaoDePapel> {
  let userId: string;
  let papel: Papel;
  try {
    userId = exigirUuid(entrada.userId, "userId");
    papel = exigirPapelValido(entrada.papel);
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  try {
    if (entrada.acao === "conceder") {
      await cliente.concederPapel(userId, papel);
      await cliente.registrarAuditoria({
        actorId: ator.id,
        action: ACAO_AUDITORIA.papelConcedido,
        targetUserId: userId,
        details: { papel },
      });
      return { situacao: "concedido" };
    }

    await cliente.revogarPapel(userId, papel);
    await cliente.registrarAuditoria({
      actorId: ator.id,
      action: ACAO_AUDITORIA.papelRevogado,
      targetUserId: userId,
      details: { papel },
    });
    return { situacao: "revogado" };
  } catch (erro) {
    if (ehRecusaDoUltimoAdmin(erro)) {
      return {
        situacao: "ultimo-admin",
        mensagem:
          "Não é possível remover o papel de administrador do único administrador restante.",
      };
    }
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao alterar papel.",
    };
  }
}

/**
 * Revoga acesso por completo: remove TODOS os papéis e bane a conta pela
 * Admin API. Reversível por `reativarUsuario` — não apaga `auth.users`, não
 * apaga `profiles`, não apaga histórico. A auditoria já registrada com
 * `target_user_id` continua íntegra (a FK é `ON DELETE SET NULL`, não
 * `CASCADE`).
 *
 * Se a conta revogada for a única admin, `revogarTodosOsPapeis` recusa com
 * `42501` antes de qualquer banimento acontecer — a ordem importa: banir
 * primeiro deixaria a conta bloqueada mesmo com a revogação de papel
 * rejeitada.
 */
export async function revogarAcesso(
  cliente: ClienteAdministrativo,
  entrada: { userId: unknown },
  ator: { id: string },
): Promise<ResultadoRevogacaoDeAcesso> {
  let userId: string;
  try {
    userId = exigirUuid(entrada.userId, "userId");
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  try {
    await cliente.revogarTodosOsPapeis(userId);
    await cliente.banirUsuario(userId);
    await cliente.registrarAuditoria({
      actorId: ator.id,
      action: ACAO_AUDITORIA.acessoRevogado,
      targetUserId: userId,
    });
    return { situacao: "revogado" };
  } catch (erro) {
    if (ehRecusaDoUltimoAdmin(erro)) {
      return {
        situacao: "ultimo-admin",
        mensagem: "Não é possível revogar o acesso do único administrador restante.",
      };
    }
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao revogar acesso.",
    };
  }
}

/**
 * Desfaz uma revogação: desbane e concede o papel informado. Não reatribui
 * operações — isso é `operacoes.ts`, atribuído explicitamente, à parte.
 */
export async function reativarUsuario(
  cliente: ClienteAdministrativo,
  entrada: { userId: unknown; papel: unknown },
  ator: { id: string },
): Promise<ResultadoReativacao> {
  let userId: string;
  let papel: Papel;
  try {
    userId = exigirUuid(entrada.userId, "userId");
    papel = exigirPapelValido(entrada.papel);
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  try {
    await cliente.desbanirUsuario(userId);
    await cliente.concederPapel(userId, papel);
    await cliente.registrarAuditoria({
      actorId: ator.id,
      action: ACAO_AUDITORIA.acessoReativado,
      targetUserId: userId,
      details: { papel },
    });
    return { situacao: "reativado" };
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao reativar usuário.",
    };
  }
}
