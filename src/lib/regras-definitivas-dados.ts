import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { montarRegistroDeFeriado, type Feriado, type FormularioDeFeriado } from "@/lib/feriados";
import { toast } from "@/lib/notificacoes";
import { lerConsultaPaginada } from "@/lib/paginacao";
import { RPC_REGRAS_DEFINITIVAS } from "@/lib/vigencias";

/**
 * Camada de dados da migration 030: calendário de feriados e o arredondamento acumulado do
 * fechamento. Leitura sob RLS (admin AAL2); escrita só pelas RPCs.
 */

const cliente = () => criarClienteNavegador();

export const CHAVE_DOS_FERIADOS = ["feriados"] as const;

export function useFeriados(habilitado: boolean) {
  return useQuery({
    queryKey: CHAVE_DOS_FERIADOS,
    enabled: habilitado,
    staleTime: 60_000,
    queryFn: async (): Promise<Feriado[]> => {
      const db = cliente();
      const linhas = await lerConsultaPaginada(
        ({ depoisDe, limite }) => {
          let q = db.from("financial_holidays").select("*");
          if (depoisDe !== null) q = q.gt("id", depoisDe);
          return q.order("id", { ascending: true }).limit(limite);
        },
        () => db.from("financial_holidays").select("*", { count: "exact", head: true }),
      );
      return linhas.slice().sort((a, b) => b.holiday_date.localeCompare(a.holiday_date));
    },
  });
}

function invalidar(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: CHAVE_DOS_FERIADOS });
}

export function useRegistrarFeriado(ativos: readonly string[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (f: FormularioDeFeriado) => {
      const params = montarRegistroDeFeriado(f, ativos);
      const { error } = await cliente().rpc(RPC_REGRAS_DEFINITIVAS.registrarFeriado, params);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar(queryClient);
      toast.success("Feriado registrado.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}

export function useAposentarFeriado() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; motivo: string }) => {
      if (v.motivo.trim() === "") throw new Error("O motivo é obrigatório.");
      const { error } = await cliente().rpc(RPC_REGRAS_DEFINITIVAS.aposentarFeriado, {
        p_id: v.id,
        p_reason: v.motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar(queryClient);
      toast.success("Feriado aposentado.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}

export interface AjusteDeArredondamento {
  employee_id: string;
  colaborador: string;
  valor_hora: number;
  minutos_brutos: number;
  minutos_arredondados: number;
  valor_bruto: number;
  valor_arredondado: number;
  ajuste: number;
}

export const CHAVE_DOS_AJUSTES = ["ajustes-arredondamento"] as const;

/**
 * Arredondamento acumulado dos apontamentos AINDA NÃO FATURADOS do cliente no período: a mesma
 * função que `gerar_fatura` usa, para a prévia não ter fórmula própria.
 */
export function useAjustesDeArredondamento(
  clienteId: string,
  inicio: string,
  fim: string,
  habilitado: boolean,
) {
  return useQuery({
    queryKey: [...CHAVE_DOS_AJUSTES, clienteId, inicio, fim],
    enabled: habilitado && clienteId !== "" && inicio !== "" && fim !== "" && inicio <= fim,
    queryFn: async (): Promise<AjusteDeArredondamento[]> => {
      const { data, error } = await cliente().rpc(RPC_REGRAS_DEFINITIVAS.ajustesDeArredondamento, {
        p_client_id: clienteId,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        employee_id: r.employee_id,
        colaborador: r.colaborador,
        valor_hora: Number(r.valor_hora),
        minutos_brutos: Number(r.minutos_brutos),
        minutos_arredondados: Number(r.minutos_arredondados),
        valor_bruto: Number(r.valor_bruto),
        valor_arredondado: Number(r.valor_arredondado),
        ajuste: Number(r.ajuste),
      }));
    },
  });
}
