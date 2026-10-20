import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useClients,
  useContracts,
  useEmployees,
  useEntries,
  useOperations,
  useShifts,
  useTimesheets,
} from "./queries";
import {
  CHAVES_DAS_CONSULTAS,
  NOMES_DAS_CONSULTAS,
  avaliarLedger,
  planoDeReconciliacao,
} from "./ledger-estado";
import type { ConsultaDoLedger, EntradaDoLedger, LedgerAvaliacao } from "./ledger-estado";

export type { LedgerRow } from "./ledger-estado";

/** O estado do ledger mais a ação de tentar de novo (releitura das seis consultas). */
export type Ledger = LedgerAvaliacao & { readonly tentarNovamente: () => void };

/** Retrato estável de uma consulta: só muda quando algum campo relevante muda. */
function useRetrato<T>(consulta: {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  data: T[] | undefined;
  dataUpdatedAt: number;
}): ConsultaDoLedger<T> {
  const { status, fetchStatus, data, dataUpdatedAt } = consulta;
  return useMemo(
    () => ({ status, fetchStatus, data, dataUpdatedAt }),
    [status, fetchStatus, data, dataUpdatedAt],
  );
}

/**
 * Lançamentos consolidados: apontamento + operação + cliente + colaborador.
 *
 * Devolve um ESTADO, não uma lista: `rows` só existe em `pronto` (e, como
 * `rowsAnteriores`, em `atualizando`). Falha de qualquer consulta, mesmo com dado
 * antigo em cache, nunca vira lista vazia nem R$ 0,00. Regras e limites em
 * `ledger-estado.ts`.
 *
 * Relação ausente entre as tabelas manda reler as consultas envolvidas UMA vez por
 * episódio (a tentativa só volta a zero depois de um `pronto`); persistindo, o
 * estado é `inconsistente`. Sem laço de invalidação.
 */
export function useLedger(): Ledger {
  const queryClient = useQueryClient();

  const entries = useRetrato(useEntries());
  const timesheets = useRetrato(useTimesheets());
  const operations = useRetrato(useOperations());
  const clients = useRetrato(useClients());
  const employees = useRetrato(useEmployees());
  const shifts = useRetrato(useShifts());

  const [tentativa, setTentativa] = useState<0 | 1>(0);

  const entrada = useMemo<EntradaDoLedger>(
    () => ({ entries, timesheets, operations, clients, employees, shifts }),
    [entries, timesheets, operations, clients, employees, shifts],
  );

  const avaliacao = useMemo(() => avaliarLedger(entrada, tentativa), [entrada, tentativa]);
  const plano = useMemo(
    () => planoDeReconciliacao(avaliacao, entrada, tentativa),
    [avaliacao, entrada, tentativa],
  );

  const relerConsultas = useCallback(
    (nomes: readonly (typeof NOMES_DAS_CONSULTAS)[number][]) => {
      for (const nome of nomes) {
        void queryClient.invalidateQueries({
          queryKey: [...CHAVES_DAS_CONSULTAS[nome]],
          exact: true,
        });
      }
    },
    [queryClient],
  );

  // Reconciliação: no máximo uma releitura por episódio.
  useEffect(() => {
    if (plano.length === 0) return;
    setTentativa(1);
    relerConsultas(plano);
  }, [plano, relerConsultas]);

  // Leitura válida encerra o episódio; uma nova ausência poderá reconciliar de novo.
  useEffect(() => {
    if (avaliacao.estado === "pronto" && tentativa !== 0) setTentativa(0);
  }, [avaliacao.estado, tentativa]);

  const tentarNovamente = useCallback(() => {
    setTentativa(0);
    relerConsultas(NOMES_DAS_CONSULTAS);
  }, [relerConsultas]);

  return useMemo(() => ({ ...avaliacao, tentarNovamente }), [avaliacao, tentarNovamente]);
}

export function useContractRules(operationId: string | null | undefined) {
  const operations = useOperations();
  const contracts = useContracts();
  return useMemo(() => {
    const op = (operations.data ?? []).find((o) => o.id === operationId);
    const contract = (contracts.data ?? []).find((c) => c.id === op?.contract_id);
    return contract
      ? {
          daily_rate: Number(contract.daily_rate),
          shift_hours: Number(contract.shift_hours),
          ot_factor: Number(contract.ot_factor),
          ot_tolerance_min: Number(contract.ot_tolerance_min),
        }
      : {
          daily_rate: Number(op?.agreed_amount ?? 0),
          shift_hours: 8,
          ot_factor: 1,
          ot_tolerance_min: 10,
        };
  }, [operations.data, contracts.data, operationId]);
}

export const sumBy = <T>(list: T[], pick: (item: T) => number) =>
  list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);

export const inPeriod = (date: string, start: string, end: string) => date >= start && date <= end;
