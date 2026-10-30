import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { RPC_ADICIONAIS, montarRegistroDeAdicional, type Adicional } from "@/lib/adicionais";
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

export function useRegistrarAdicional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (f: FormularioDeAdicional) => {
      const params = montarRegistroDeAdicional(f);
      const { error } = await cliente().rpc(RPC_ADICIONAIS.registrar, {
        p_client_id: params["p_client_id"] as string,
        p_period_start: params["p_period_start"] as string,
        p_period_end: params["p_period_end"] as string,
        p_description: params["p_description"] as string,
        p_amount: params["p_amount"] as number,
        ...(params["p_reference"] !== null ? { p_reference: params["p_reference"] as string } : {}),
        ...(params["p_operation_id"] !== null
          ? { p_operation_id: params["p_operation_id"] as string }
          : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar(queryClient);
      toast.success("Adicional registrado.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
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
