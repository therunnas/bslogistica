import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { RPC_ADICIONAIS, montarRegistroDeAdicional, type Adicional } from "@/lib/adicionais";
import { criarExclusaoEntreAbas, executarIntencaoDeAdicional } from "@/lib/adicional-intencao";
import {
  CODIGO_DE_CHAVE_REUTILIZADA,
  MENSAGEM_CHAVE_REUTILIZADA,
  registrarAdicional,
  type ChamadaDeRpc,
} from "@/lib/adicionais-registro";
import type { FormularioDeAdicional } from "@/lib/adicionais";
import { mensagemDoErro } from "@/lib/erros-banco";
import { toast } from "@/lib/notificacoes";
import { lerConsultaPaginada } from "@/lib/paginacao";

/**
 * Camada de dados dos adicionais de serviço (migration 029). Leitura direta (RLS: admin) e
 * escrita só pelas RPCs; o banco recusa qualquer escrita direta na tabela.
 */

const cliente = () => criarClienteNavegador();

export const CHAVE_DOS_ADICIONAIS = ["adicionais"] as const;

/** Todos os adicionais do cliente, completos (paginados por `id` e conferidos por contagem). */
export function useAdicionais(clienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DOS_ADICIONAIS, clienteId],
    enabled: habilitado && clienteId !== "",
    queryFn: async (): Promise<Adicional[]> => {
      const db = cliente();
      const linhas = await lerConsultaPaginada(
        ({ depoisDe, limite }) => {
          let q = db.from("billing_additionals").select("*").eq("client_id", clienteId);
          if (depoisDe !== null) q = q.gt("id", depoisDe);
          return q.order("id", { ascending: true }).limit(limite);
        },
        () =>
          db
            .from("billing_additionals")
            .select("*", { count: "exact", head: true })
            .eq("client_id", clienteId),
      );
      return linhas
        .slice()
        .sort((a, b) =>
          a.period_start === b.period_start
            ? b.created_at.localeCompare(a.created_at)
            : b.period_start.localeCompare(a.period_start),
        );
    },
  });
}

/**
 * Adicionais NÃO cancelados de todos os clientes com o período inteiro dentro de [inicio, fim]:
 * o mesmo critério da fatura, para Dashboard e Relatórios somarem o que a fatura somaria.
 */
export function useAdicionaisDoPeriodo(inicio: string, fim: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DOS_ADICIONAIS, "periodo", inicio, fim],
    enabled: habilitado && inicio !== "" && fim !== "" && inicio <= fim,
    queryFn: async (): Promise<Adicional[]> => {
      const db = cliente();
      return lerConsultaPaginada(
        ({ depoisDe, limite }) => {
          let q = db
            .from("billing_additionals")
            .select("*")
            .gte("period_start", inicio)
            .lte("period_end", fim)
            .is("canceled_at", null);
          if (depoisDe !== null) q = q.gt("id", depoisDe);
          return q.order("id", { ascending: true }).limit(limite);
        },
        () =>
          db
            .from("billing_additionals")
            .select("*", { count: "exact", head: true })
            .gte("period_start", inicio)
            .lte("period_end", fim)
            .is("canceled_at", null),
      );
    },
  });
}

function invalidar(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: CHAVE_DOS_ADICIONAIS });
}

/** A chamada tipada do cliente do navegador, vista pelo transporte como uma função de RPC por nome. */
const chamarRpc: ChamadaDeRpc = (nome, args) =>
  cliente().rpc(nome as never, args as never) as unknown as ReturnType<ChamadaDeRpc>;

function codigoDoErro(erro: unknown): string | undefined {
  return typeof erro === "object" && erro !== null ? (erro as { code?: string }).code : undefined;
}

/**
 * Registra o adicional pela RPC idempotente (047). A CHAVE acompanha a intenção: o duplo clique e o retry
 * depois de um erro ou timeout reconciliam a mesma chave. Só o marcador opaco sobrevive à navegação;
 * payload e valores permanecem na memória. Fechar o formulário não encerra uma intenção pendente.
 */
export function useRegistrarAdicional() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (f: FormularioDeAdicional) => {
      const params = montarRegistroDeAdicional(f);
      const db = cliente();
      const { data, error } = await db.auth.getUser();
      if (error || !data.user) throw new Error("Não foi possível confirmar a sessão.");
      return executarIntencaoDeAdicional({
        storage: localStorage,
        exclusivo: criarExclusaoEntreAbas(navigator.locks),
        userId: data.user.id,
        gerar: () => crypto.randomUUID(),
        consultar: async (chave) => {
          const resposta = await db
            .from("billing_additionals")
            .select("id")
            .eq("idempotency_key", chave)
            .maybeSingle();
          if (resposta.error) throw resposta.error;
          return resposta.data?.id ?? null;
        },
        registrar: (chave, marcarLegado) =>
          registrarAdicional(chamarRpc, params, chave, marcarLegado),
      });
    },
    onSuccess: () => {
      invalidar(queryClient);
      toast.success("Adicional registrado.");
    },
    onError: (erro: unknown) => {
      invalidar(queryClient);
      if (codigoDoErro(erro) === CODIGO_DE_CHAVE_REUTILIZADA) {
        // O marcador continua pendente: a próxima tentativa deve reconciliar a chave.
        toast.error(MENSAGEM_CHAVE_REUTILIZADA);
        return;
      }
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro));
    },
  });
  return mutation;
}

export function useCancelarAdicional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; motivo: string }) => {
      if (v.motivo.trim() === "") throw new Error("O motivo do cancelamento é obrigatório.");
      const { error } = await cliente().rpc(RPC_ADICIONAIS.cancelar, {
        p_additional_id: v.id,
        p_reason: v.motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar(queryClient);
      toast.success("Adicional cancelado.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}
