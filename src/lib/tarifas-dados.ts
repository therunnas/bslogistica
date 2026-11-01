import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { toast } from "@/lib/notificacoes";
import {
  RPC_TARIFAS,
  montarRegistroDeTarifa,
  type FormularioDeTarifa,
  type TarifaDoContrato,
} from "@/lib/tarifas";

/**
 * Camada de dados das tarifas por função e período (migration 041). Leitura direta (RLS: admin) e
 * escrita só pelas RPCs. Só consulta com a capacidade confirmada: sem a 041 a tabela não existe.
 */

const cliente = () => criarClienteNavegador();

export const CHAVE_DAS_TARIFAS = ["contract_rate_terms"] as const;

/** Todas as versões (ativas e aposentadas) das tarifas de um contrato. */
export function useTarifasDoContrato(contratoId: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DAS_TARIFAS, contratoId],
    enabled: habilitado && contratoId !== "",
    queryFn: async (): Promise<TarifaDoContrato[]> => {
      const { data, error } = await cliente()
        .from("contract_rate_terms")
        .select(
          "id, contract_id, job_function_id, shift_period, valid_from, valid_to, daily_rate, active, origin, reason",
        )
        .eq("contract_id", contratoId)
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return data as TarifaDoContrato[];
    },
  });
}

function invalidar(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_TARIFAS });
  void queryClient.invalidateQueries({ queryKey: ["vigencias"] });
}

const aoFalhar = (erro: unknown) =>
  toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro));

/** Nova versão de tarifa (encerra a vigente que começou antes e abre a nova no mesmo ato). */
export function useRegistrarTarifa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (f: FormularioDeTarifa) => {
      const params = montarRegistroDeTarifa(f);
      const { error } = await cliente().rpc(RPC_TARIFAS.registrar, {
        p_contract_id: params["p_contract_id"] as string,
        p_job_function_id: params["p_job_function_id"] as string,
        p_shift_period: params["p_shift_period"] as string,
        p_valid_from: params["p_valid_from"] as string,
        p_daily_rate: params["p_daily_rate"] as number,
        p_reason: params["p_reason"] as string,
        p_encerrar_anterior: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar(queryClient);
      toast.success("Tarifa registrada.");
    },
    onError: aoFalhar,
  });
}

/** Liga ou desliga a resolução por função e período (decisão administrativa, com motivo). */
export function useAlterarResolucaoDeTarifas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { ligar: boolean; motivo: string }) => {
      const { error } = await cliente().rpc(RPC_TARIFAS.resolucao, {
        p_ativar: v.ligar,
        p_reason: v.motivo.trim(),
      });
      if (error) throw error;
      return v.ligar;
    },
    onSuccess: (ligou) => {
      void queryClient.invalidateQueries();
      toast.success(
        ligou
          ? "Resolução por função e período ligada."
          : "Resolução por função e período desligada.",
      );
    },
    onError: aoFalhar,
  });
}

/** Corrige a função (e/ou atualiza o período) de um apontamento NÃO faturado, com motivo e trilha. */
export function useCorrigirSnapshotsDoApontamento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      entryId: string;
      funcaoId: string | null;
      atualizarPeriodo: boolean;
      motivo: string;
    }) => {
      const { error } = await cliente().rpc(RPC_TARIFAS.corrigirSnapshots, {
        p_entry_id: v.entryId,
        // O tipo gerado exige string; a RPC aceita nulo quando só o período é atualizado.
        p_job_function_id: v.funcaoId as string,
        p_atualizar_periodo: v.atualizarPeriodo,
        p_reason: v.motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] });
      toast.success("Apontamento corrigido.");
    },
    onError: aoFalhar,
  });
}
