import { useMemo } from "react";
import {
  useClients,
  useContracts,
  useEmployees,
  useEntries,
  useOperations,
  useShifts,
  useTimesheets,
} from "./queries";
import type { AttendanceStatus } from "./types";

export interface LedgerRow {
  entryId: string;
  timesheetId: string;
  date: string;
  clientId: string;
  clientName: string;
  operationId: string;
  operationName: string;
  operationType: "fixed" | "spot";
  shiftName: string;
  employeeId: string;
  employeeName: string;
  status: AttendanceStatus;
  workedMinutes: number;
  overtimeMinutes: number;
  dailies: number;
  billed: number;
  otValue: number;
  cost: number;
  invoiceId: string | null;
  timesheetStatus: "open" | "closed";
}

/** Lançamentos consolidados: apontamento + operação + cliente + colaborador. */
export function useLedger() {
  const entries = useEntries();
  const timesheets = useTimesheets();
  const operations = useOperations();
  const clients = useClients();
  const employees = useEmployees();
  const shifts = useShifts();

  const isLoading =
    entries.isLoading ||
    timesheets.isLoading ||
    operations.isLoading ||
    clients.isLoading ||
    employees.isLoading ||
    shifts.isLoading;

  const rows = useMemo<LedgerRow[]>(() => {
    const tsMap = new Map((timesheets.data ?? []).map((t) => [t.id, t]));
    const opMap = new Map((operations.data ?? []).map((o) => [o.id, o]));
    const clMap = new Map((clients.data ?? []).map((c) => [c.id, c]));
    const empMap = new Map((employees.data ?? []).map((e) => [e.id, e]));
    const shMap = new Map((shifts.data ?? []).map((s) => [s.id, s]));

    return (entries.data ?? [])
      .map((entry) => {
        const ts = tsMap.get(entry.timesheet_id);
        if (!ts) return null;
        const op = opMap.get(ts.operation_id);
        const client = op ? clMap.get(op.client_id) : undefined;
        const shift = ts.shift_id ? shMap.get(ts.shift_id) : undefined;
        return {
          entryId: entry.id,
          timesheetId: ts.id,
          date: ts.work_date,
          clientId: op?.client_id ?? "",
          clientName: client?.name ?? "—",
          operationId: op?.id ?? "",
          operationName: op?.name ?? "—",
          operationType: op?.type ?? "fixed",
          shiftName: shift?.name ?? "—",
          employeeId: entry.employee_id,
          employeeName: empMap.get(entry.employee_id)?.name ?? "—",
          status: entry.status,
          workedMinutes: entry.worked_minutes,
          overtimeMinutes: entry.overtime_minutes,
          dailies: entry.status === "absent" ? 0 : 1,
          billed: Number(entry.billed_amount ?? 0),
          otValue:
            entry.status === "absent"
              ? 0
              : Math.max(
                  0,
                  Number(entry.billed_amount ?? 0) - Number(entry.daily_rate_snapshot ?? 0),
                ),
          cost: Number(entry.cost_amount ?? 0),
          invoiceId: entry.invoice_id,
          timesheetStatus: ts.status,
        } satisfies LedgerRow;
      })
      .filter((r): r is LedgerRow => r !== null)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [entries.data, timesheets.data, operations.data, clients.data, employees.data, shifts.data]);

  return { rows, isLoading };
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
