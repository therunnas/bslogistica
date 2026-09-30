/**
 * Atribuição de operações ao operacional — `public.user_operation_access`.
 *
 * Ao contrário de `servico.ts`, este módulo NÃO usa `service_role`: a tabela
 * já tem policy `FOR ALL` para admin em AAL2 desde a migration 013 (permissiva
 * + RESTRICTIVE de mesmo predicado). A sessão real do admin, pela RLS, já
 * basta — usar `service_role` aqui só ampliaria superfície sem necessidade,
 * e essa tabela não tem trigger de proteção que precise ser contornado, ao
 * contrário de `user_roles`.
 *
 * A tabela não está no `Database` gerado (mesma lacuna do B2.1 para as RPCs
 * da 013), então o cliente injetado tem forma própria e mínima, no mesmo
 * molde de `cliente.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { exigirUuid } from "./dominio";
import { ACAO_AUDITORIA } from "./tipos";
import type {
  AtribuicaoDeOperacao,
  ResultadoAtribuicaoDeOperacao,
  ResultadoRemocaoDeOperacao,
} from "./tipos";
import {
  auditarSemFalhar,
  type ClienteAdministrativo,
  ErroAdministrativo,
  type ErroDaResposta,
} from "./cliente";

interface LinhaBruta {
  operation_id: string;
  created_at: string;
}

export interface ClienteDeOperacoes {
  listarAtribuidas(userId: string): Promise<AtribuicaoDeOperacao[]>;
  atribuir(userId: string, operationId: string, criadoPor: string): Promise<void>;
  remover(userId: string, operationId: string): Promise<void>;
  /** Remove TODAS as atribuições do usuário. Devolve quantas linhas saíram. */
  removerTodas(userId: string): Promise<number>;
}

interface TabelaUserOperationAccess {
  select(colunas: "operation_id, created_at"): {
    eq(
      coluna: "user_id",
      valor: string,
    ): PromiseLike<{ data: LinhaBruta[] | null; error: ErroDaResposta | null }>;
  };
  insert(valores: {
    user_id: string;
    operation_id: string;
    created_by: string;
  }): PromiseLike<{ error: ErroDaResposta | null }>;
  delete(): {
    eq(
      coluna: "user_id",
      valor: string,
    ): {
      eq(coluna: "operation_id", valor: string): PromiseLike<{ error: ErroDaResposta | null }>;
      /**
       * Sem o segundo `.eq`: apaga TODAS as linhas daquele usuário.
       * `.select()` pede `Prefer: return=representation` — é o que permite
       * saber QUANTAS linhas saíram, para a auditoria de `revogarAcesso`.
       */
      select(
        colunas: "operation_id",
      ): PromiseLike<{ data: { operation_id: string }[] | null; error: ErroDaResposta | null }>;
    };
  };
}

interface ClienteBrutoDeOperacoes {
  from(tabela: "user_operation_access"): TabelaUserOperationAccess;
}

export function criarClienteDeOperacoes(supabase: SupabaseClient<Database>): ClienteDeOperacoes {
  const bruto = supabase as unknown as ClienteBrutoDeOperacoes;

  return {
    async listarAtribuidas(userId) {
      const resposta = await bruto
        .from("user_operation_access")
        .select("operation_id, created_at")
        .eq("user_id", userId);
      if (resposta.error) {
        throw new ErroAdministrativo(resposta.error, "listar operações atribuídas");
      }
      return (resposta.data ?? []).map((linha) => ({
        operationId: linha.operation_id,
        criadoEm: linha.created_at,
      }));
    },

    async atribuir(userId, operationId, criadoPor) {
      const resposta = await bruto
        .from("user_operation_access")
        .insert({ user_id: userId, operation_id: operationId, created_by: criadoPor });
      // PK (user_id, operation_id): atribuir de novo é idempotente.
      if (resposta.error && resposta.error.code !== "23505") {
        throw new ErroAdministrativo(resposta.error, "atribuir operação");
      }
    },

    async remover(userId, operationId) {
      const resposta = await bruto
        .from("user_operation_access")
        .delete()
        .eq("user_id", userId)
        .eq("operation_id", operationId);
      if (resposta.error) {
        throw new ErroAdministrativo(resposta.error, "remover operação");
      }
    },

    async removerTodas(userId) {
      const resposta = await bruto
        .from("user_operation_access")
        .delete()
        .eq("user_id", userId)
        .select("operation_id");
      if (resposta.error) {
        throw new ErroAdministrativo(resposta.error, "remover todas as operações");
      }
      return (resposta.data ?? []).length;
    },
  };
}

/**
 * `registrador` é o `ClienteAdministrativo` (service_role), só para
 * `registrarAuditoria` — `admin_audit_log` não tem policy de INSERT para
 * `authenticated` nem para admin, de propósito (ver `cliente.ts`). A escrita
 * em `user_operation_access` em si continua pela sessão real do admin, via
 * `cliente` (RLS).
 */
export async function atribuirOperacao(
  cliente: ClienteDeOperacoes,
  registrador: ClienteAdministrativo,
  entrada: { userId: unknown; operationId: unknown },
  ator: { id: string },
): Promise<ResultadoAtribuicaoDeOperacao> {
  let userId: string;
  let operationId: string;
  try {
    userId = exigirUuid(entrada.userId, "userId");
    operationId = exigirUuid(entrada.operationId, "operationId");
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  try {
    await cliente.atribuir(userId, operationId, ator.id);
    await auditarSemFalhar(registrador, {
      actorId: ator.id,
      action: ACAO_AUDITORIA.operacaoAtribuida,
      targetUserId: userId,
      details: { operationId },
    });
    return { situacao: "atribuida" };
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao atribuir operação.",
    };
  }
}

export async function removerOperacao(
  cliente: ClienteDeOperacoes,
  registrador: ClienteAdministrativo,
  entrada: { userId: unknown; operationId: unknown },
  ator: { id: string },
): Promise<ResultadoRemocaoDeOperacao> {
  let userId: string;
  let operationId: string;
  try {
    userId = exigirUuid(entrada.userId, "userId");
    operationId = exigirUuid(entrada.operationId, "operationId");
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Entrada inválida.",
    };
  }

  try {
    await cliente.remover(userId, operationId);
    await auditarSemFalhar(registrador, {
      actorId: ator.id,
      action: ACAO_AUDITORIA.operacaoRemovida,
      targetUserId: userId,
      details: { operationId },
    });
    return { situacao: "removida" };
  } catch (erro) {
    return {
      situacao: "erro",
      mensagem: erro instanceof Error ? erro.message : "Falha ao remover operação.",
    };
  }
}

export async function listarOperacoesAtribuidas(
  cliente: ClienteDeOperacoes,
  entrada: { userId: unknown },
): Promise<AtribuicaoDeOperacao[]> {
  const userId = exigirUuid(entrada.userId, "userId");
  return cliente.listarAtribuidas(userId);
}

/**
 * Limpa TODAS as atribuições do usuário — parte do contrato de
 * `revogarAcesso` (`servico.ts`): acesso revogado não deixa a conta com
 * operações que ela não pode mais alcançar de outro jeito nenhum. `userId`
 * chega já validado por quem chama (`servico.revogarAcesso` já exigiu UUID
 * antes de começar a sequência), por isso não é `unknown` aqui — ao contrário
 * de `atribuirOperacao`/`removerOperacao`, que são a própria borda de entrada.
 */
export async function removerTodasAsAtribuicoes(
  cliente: ClienteDeOperacoes,
  userId: string,
): Promise<number> {
  return cliente.removerTodas(userId);
}

/** O suficiente para a tela de usuários oferecer uma operação na lista. */
export interface OperacaoResumo {
  id: string;
  name: string;
}

/**
 * Lista as operações que existem, para o picker de atribuição da tela de
 * usuários — NUNCA para o operador ver: quem chama isto já passou por
 * `exigirAdminAal2()`.
 *
 * Ao contrário de `user_operation_access`, `operations` está no `Database`
 * gerado, então esta função usa o cliente de sessão (RLS) tipado direto, sem
 * a forma própria que `ClienteDeOperacoes` precisa para a tabela sem tipos.
 * Mesma razão de não usar `service_role` aqui: a policy de admin+AAL2 já
 * libera a leitura pela sessão real, e usar `service_role` só ampliaria
 * superfície sem necessidade — como o comentário do topo deste arquivo já
 * registra para `user_operation_access`.
 *
 * Projeta só `id, name`: a tela de usuários não é a tela de operações, e não
 * precisa de `client_id`, valores acordados nem qualquer outro campo — a
 * mesma disciplina de "só o necessário" que rege a superfície operacional da
 * migration 013.
 */
export async function listarOperacoesDisponiveis(
  supabase: SupabaseClient<Database>,
): Promise<OperacaoResumo[]> {
  const resposta = await supabase
    .from("operations")
    .select("id, name")
    .order("created_at", { ascending: false });
  if (resposta.error) {
    throw new ErroAdministrativo(resposta.error, "listar operações");
  }
  return resposta.data ?? [];
}
