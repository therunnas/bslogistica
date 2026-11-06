import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { RPC_ADICIONAIS, montarRegistroDeAdicional, type Adicional } from "@/lib/adicionais";
import { intencaoParaTentativa, type IntencaoDeAdicional } from "@/lib/adicional-intencao";
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
 * depois de um erro ou timeout reutilizam a mesma chave, e o banco devolve o adicional já gravado em vez
 * de duplicá-lo. Dados diferentes, formulário reaberto ou sucesso começam outra intenção. A chave vive só
 * em memória (useRef), nunca em storage, cookie ou URL.
 */
export function useRegistrarAdicional() {
  const queryClient = useQueryClient();
  const intencao = useRef<IntencaoDeAdicional | null>(null);
  const mutation = useMutation({
    mutationFn: async (f: FormularioDeAdicional) => {
      const params = montarRegistroDeAdicional(f);
      const atual = intencaoParaTentativa(intencao.current, params);
      intencao.current = atual;
      return registrarAdicional(chamarRpc, params, atual.chave);
    },
    onSuccess: () => {
      intencao.current = null;
      invalidar(queryClient);
      toast.success("Adicional registrado.");
    },
    onError: (erro: unknown) => {
      if (codigoDoErro(erro) === CODIGO_DE_CHAVE_REUTILIZADA) {
        // O banco recusou esta chave para estes dados: nunca insistir nela.
        intencao.current = null;
        toast.error(MENSAGEM_CHAVE_REUTILIZADA);
        return;
      }
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro));
    },
  });
  return {
    ...mutation,
    /** Nova operação: a próxima tentativa gera chave nova (formulário aberto ou fechado). */
    reiniciarIntencao: () => {
      intencao.current = null;
    },
  };
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
