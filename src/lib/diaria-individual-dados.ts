import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import {
  RPC_DIARIA_INDIVIDUAL,
  montarBonus,
  montarRegistroDeDiaria,
  type DiariaIndividual,
  type FormularioDeBonus,
  type FormularioDeDiaria,
} from "@/lib/diaria-individual";
import { mensagemDoErro } from "@/lib/erros-banco";
import { toast } from "@/lib/notificacoes";

/**
 * Camada de dados da diária individual e do adicional diário (migration 042). Leitura direta (RLS:
 * admin) e escrita só pelas RPCs. Só consulta com a capacidade confirmada: sem a 042 a tabela não
 * existe.
 */

const cliente = () => criarClienteNavegador();

export const CHAVE_DAS_DIARIAS = ["contract_employee_rates"] as const;

/** Todas as versões (ativas e aposentadas) das diárias individuais de um contrato. */
export function useDiariasDoContrato(contratoId: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DAS_DIARIAS, contratoId],
    enabled: habilitado && contratoId !== "",
    queryFn: async (): Promise<DiariaIndividual[]> => {
      const { data, error } = await cliente()
        .from("contract_employee_rates")
        .select(
          "id, contract_id, employee_id, valid_from, valid_to, daily_rate, active, origin, reason",
        )
        .eq("contract_id", contratoId)
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return data as DiariaIndividual[];
    },
  });
}

const aoFalhar = (erro: unknown) =>
  toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro));

/** Nova versão de diária individual (encerra a vigente que começou antes e abre a nova no mesmo ato). */
export function useRegistrarDiariaIndividual() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (f: FormularioDeDiaria) => {
      const params = montarRegistroDeDiaria(f);
      const { error } = await cliente().rpc(RPC_DIARIA_INDIVIDUAL.registrar, {
        p_contract_id: params["p_contract_id"] as string,
        p_employee_id: params["p_employee_id"] as string,
        p_valid_from: params["p_valid_from"] as string,
        p_daily_rate: params["p_daily_rate"] as number,
        p_reason: params["p_reason"] as string,
        p_encerrar_anterior: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_DIARIAS });
      void queryClient.invalidateQueries({ queryKey: ["vigencias"] });
      toast.success("Diária individual registrada.");
    },
    onError: aoFalhar,
  });
}

/** Define (ou remove, com zero) o adicional diário de um apontamento não faturado, com motivo e trilha. */
export function useDefinirBonus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { formulario: FormularioDeBonus; substituir: boolean }) => {
      const params = montarBonus(v.formulario, v.substituir);
      const { error } = await cliente().rpc(RPC_DIARIA_INDIVIDUAL.bonus, {
        p_entry_id: params["p_entry_id"] as string,
        p_amount: params["p_amount"] as number,
        p_reason: params["p_reason"] as string,
        p_substituir: params["p_substituir"] as boolean,
      });
      if (error) throw error;
      return params["p_amount"] as number;
    },
    onSuccess: (valor) => {
      void queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] });
      toast.success(valor === 0 ? "Adicional diário removido." : "Adicional diário registrado.");
    },
    onError: aoFalhar,
  });
}
