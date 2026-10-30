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
 * ser admin, e recebem o `ator` só para carimbar a auditoria.
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
  exigirAcaoDePapel,
  exigirEmailValido,
  exigirPapelValido,
  exigirUuid,
} from "./dominio";
import { auditarSemFalhar, ErroAdministrativo, type ClienteAdministrativo } from "./cliente";
import { removerTodasAsAtribuicoes, type ClienteDeOperacoes } from "./operacoes";

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
    await auditarSemFalhar(cliente, {
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
  acao: unknown;
}

/**
 * Concede ou revoga UM papel de uma conta. A proteção do último admin não é
 * verificada aqui em JavaScript antes de tentar — é o trigger
 * `trg_proteger_ultimo_admin` (017) que decide, porque só o banco vê o estado
 * atomicamente (com lock, desde este checkout — seção 3 do PROGRESS.md do
 * PR D); este código só traduz o `42501` dele numa resposta legível.
 *
 * `entrada.acao` chega como `unknown` e passa por `exigirAcaoDePapel` como
 * qualquer outro campo — o tipo da Server Action nunca foi validação: é só o
 * que o TypeScript infere de um payload que, na borda real (POST), pode ser
 * qualquer coisa.
 */
export async function alterarPapel(
  cliente: ClienteAdministrativo,
  entrada: AlterarPapelEntrada,
  ator: { id: string },
): Promise<ResultadoAlteracaoDePapel> {
  let userId: string;
  let papel: Papel;
  let acao: ReturnType<typeof exigirAcaoDePapel>;
  try {
    userId = exigirUuid(entrada.userId, "userId");
    papel = exigirPapelValido(entrada.papel);
    acao = exigirAcaoDePapel(entrada.acao);
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  try {
    if (acao === "conceder") {
      await cliente.concederPapel(userId, papel);
      await auditarSemFalhar(cliente, {
        actorId: ator.id,
        action: ACAO_AUDITORIA.papelConcedido,
        targetUserId: userId,
        details: { papel },
      });
      return { situacao: "concedido" };
    }

    await cliente.revogarPapel(userId, papel);
    await auditarSemFalhar(cliente, {
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
 * Revoga acesso por completo: remove TODOS os papéis, limpa TODAS as
 * atribuições de operação e bane a conta pela Admin API. Reversível por
 * `reativarUsuario` — não apaga `auth.users`, não apaga `profiles`, não apaga
 * histórico. A auditoria já registrada com `target_user_id` continua íntegra
 * (a FK é `ON DELETE SET NULL`, não `CASCADE`).
 *
 * ORDEM, E POR QUE ELA NÃO É ARBITRÁRIA
 *
 * 1. `revogarTodosOsPapeis` — o ÚNICO passo que o banco pode recusar (último
 *    admin). Se recusar, nada mais é tentado: zero efeito colateral.
 * 2. `removerTodasAsAtribuicoes` — `user_operation_access` via RLS (sessão do
 *    admin, não `service_role`: a tabela já concede `FOR ALL` a admin
 *    desde a 013).
 * 3. `banirUsuario`.
 *
 * Estes três passos NÃO são uma transação só — são três chamadas HTTP
 * separadas (duas ao PostgREST sob papéis diferentes, uma à Admin API), e não
 * há como este backend torná-las atômicas sem uma RPC dedicada. Por isso, se
 * o passo 1 tiver sucesso mas 2 ou 3 falharem, o resultado é `"parcial"`, não
 * `"erro"`: dizer "erro" aqui mentiria — o usuário já perdeu o papel.
 */
export async function revogarAcesso(
  cliente: ClienteAdministrativo,
  clienteDeOperacoes: ClienteDeOperacoes,
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

  let papeisRevogados = false;
  try {
    await cliente.revogarTodosOsPapeis(userId);
    papeisRevogados = true;

    const operacoesRemovidas = await removerTodasAsAtribuicoes(clienteDeOperacoes, userId);
    await cliente.banirUsuario(userId);

    await auditarSemFalhar(cliente, {
      actorId: ator.id,
      action: ACAO_AUDITORIA.acessoRevogado,
      targetUserId: userId,
      details: { operacoesRemovidas },
    });
    return { situacao: "revogado" };
  } catch (erro) {
    if (!papeisRevogados && ehRecusaDoUltimoAdmin(erro)) {
      return {
        situacao: "ultimo-admin",
        mensagem: "Não é possível revogar o acesso do único administrador restante.",
      };
    }

    if (papeisRevogados) {
      // O papel já saiu — o passo que o trigger poderia recusar já passou.
      // O que falhou depois (limpar operações, banir) fica registrado como
      // parcial, com o motivo real, para o admin não repetir do zero achando
      // que nada mudou.
      await auditarSemFalhar(cliente, {
        actorId: ator.id,
        action: ACAO_AUDITORIA.acessoRevogado,
        targetUserId: userId,
        details: { parcial: true, motivo: erro instanceof Error ? erro.message : String(erro) },
      });
      return {
        situacao: "parcial",
        mensagem:
          "O papel já foi removido, mas a revogação não terminou (operações e/ou banimento). Verifique a conta manualmente.",
      };
    }

    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao revogar acesso.",
    };
  }
}

/**
 * Desfaz uma revogação: concede o papel informado e SÓ DEPOIS desbane. Não
 * reatribui operações — a revogação as apagou de propósito
 * (`revogarAcesso`), e reativação não é o mesmo que desfazer o tempo: quem
 * reativa atribui operações de novo, explicitamente, por `operacoes.ts`.
 *
 * ORDEM invertida a propósito em relação a uma versão anterior deste código:
 * "concede o papel enquanto ainda banido" é o estado seguro — a conta não
 * consegue logar mesmo já tendo papel, então uma falha em `desbanirUsuario`
 * deixa só um banimento residual, fácil de completar depois. A ordem
 * contrária (desbanir primeiro) podia deixar uma conta CAPAZ de logar sem
 * papel nenhum, se `concederPapel` falhasse em seguida.
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

  let papelConcedido = false;
  try {
    await cliente.concederPapel(userId, papel);
    papelConcedido = true;

    await cliente.desbanirUsuario(userId);

    await auditarSemFalhar(cliente, {
      actorId: ator.id,
      action: ACAO_AUDITORIA.acessoReativado,
      targetUserId: userId,
      details: { papel },
    });
    return { situacao: "reativado" };
  } catch (erro) {
    if (papelConcedido) {
      await auditarSemFalhar(cliente, {
        actorId: ator.id,
        action: ACAO_AUDITORIA.acessoReativado,
        targetUserId: userId,
        details: { papel, parcial: true, desbanido: false },
      });
      return {
        situacao: "parcial",
        mensagem: "O papel foi concedido, mas a conta continua banida. Tente desbanir novamente.",
      };
    }
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao reativar usuário.",
    };
  }
}
