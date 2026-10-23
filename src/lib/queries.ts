import { useQuery } from "@tanstack/react-query";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { lerTabelaPaginada } from "./paginacao";
import type { ClientePostgrest, LeituraDeTabela } from "./paginacao";
import type {
  Client,
  Contract,
  Employee,
  Invoice,
  Operation,
  Shift,
  TeamMember,
  Timesheet,
  TimesheetEntry,
} from "./types";

/**
 * Tabela e ordem de APRESENTAÇÃO de cada hook. A leitura em si é paginada por
 * `id` (ver `paginacao.ts`); estas ordens são aplicadas depois, sobre o conjunto
 * completo, e reproduzem o `ORDER BY` de antes (empate por `id`).
 */
export const LEITURAS = {
  clients: { tabela: "clients", ordem: [{ coluna: "name", tipo: "texto", ascendente: true }] },
  contracts: {
    tabela: "contracts",
    ordem: [{ coluna: "created_at", tipo: "instante", ascendente: false }],
  },
  employees: { tabela: "employees", ordem: [{ coluna: "name", tipo: "texto", ascendente: true }] },
  operations: {
    tabela: "operations",
    ordem: [{ coluna: "created_at", tipo: "instante", ascendente: false }],
  },
  shifts: {
    tabela: "shifts",
    ordem: [{ coluna: "start_time", tipo: "literal", ascendente: true }],
  },
  operation_team: {
    tabela: "operation_team",
    ordem: [{ coluna: "created_at", tipo: "instante", ascendente: true }],
  },
  timesheets: {
    tabela: "timesheets",
    ordem: [{ coluna: "work_date", tipo: "literal", ascendente: false }],
  },
  timesheet_entries: {
    tabela: "timesheet_entries",
    ordem: [{ coluna: "created_at", tipo: "instante", ascendente: true }],
  },
  invoices: {
    tabela: "invoices",
    ordem: [{ coluna: "period_start", tipo: "literal", ascendente: false }],
  },
} as const satisfies Record<string, LeituraDeTabela>;

/** Lê a tabela inteira (paginada e conferida); lança em qualquer leitura incompleta. */
async function fetchAll<T extends object>(leitura: LeituraDeTabela): Promise<T[]> {
  return lerTabelaPaginada<T>(criarClienteNavegador() as unknown as ClientePostgrest, leitura);
}

export const useClients = () =>
  useQuery({ queryKey: ["clients"], queryFn: () => fetchAll<Client>(LEITURAS.clients) });

export const useContracts = () =>
  useQuery({
    queryKey: ["contracts"],
    queryFn: () => fetchAll<Contract>(LEITURAS.contracts),
  });

export const useEmployees = () =>
  useQuery({ queryKey: ["employees"], queryFn: () => fetchAll<Employee>(LEITURAS.employees) });

export const useOperations = () =>
  useQuery({
    queryKey: ["operations"],
    queryFn: () => fetchAll<Operation>(LEITURAS.operations),
  });

export const useShifts = () =>
  useQuery({ queryKey: ["shifts"], queryFn: () => fetchAll<Shift>(LEITURAS.shifts) });

export const useTeam = () =>
  useQuery({
    queryKey: ["operation_team"],
    queryFn: () => fetchAll<TeamMember>(LEITURAS.operation_team),
  });

export const useTimesheets = () =>
  useQuery({
    queryKey: ["timesheets"],
    queryFn: () => fetchAll<Timesheet>(LEITURAS.timesheets),
  });

export const useEntries = () =>
  useQuery({
    queryKey: ["timesheet_entries"],
    queryFn: () => fetchAll<TimesheetEntry>(LEITURAS.timesheet_entries),
  });

export const useInvoices = () =>
  useQuery({
    queryKey: ["invoices"],
    queryFn: () => fetchAll<Invoice>(LEITURAS.invoices),
  });

export const invalidateKeys = [
  "clients",
  "contracts",
  "employees",
  "operations",
  "shifts",
  "operation_team",
  "timesheets",
  "timesheet_entries",
  "invoices",
] as const;
