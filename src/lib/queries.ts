import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

async function fetchAll<T>(table: string, order: string, ascending = true): Promise<T[]> {
  const { data, error } = await supabase
    .from(table as never)
    .select("*")
    .order(order, { ascending });
  if (error) throw error;
  return (data ?? []) as T[];
}

export const useClients = () =>
  useQuery({ queryKey: ["clients"], queryFn: () => fetchAll<Client>("clients", "name") });

export const useContracts = () =>
  useQuery({
    queryKey: ["contracts"],
    queryFn: () => fetchAll<Contract>("contracts", "created_at", false),
  });

export const useEmployees = () =>
  useQuery({ queryKey: ["employees"], queryFn: () => fetchAll<Employee>("employees", "name") });

export const useOperations = () =>
  useQuery({
    queryKey: ["operations"],
    queryFn: () => fetchAll<Operation>("operations", "created_at", false),
  });

export const useShifts = () =>
  useQuery({ queryKey: ["shifts"], queryFn: () => fetchAll<Shift>("shifts", "start_time") });

export const useTeam = () =>
  useQuery({
    queryKey: ["operation_team"],
    queryFn: () => fetchAll<TeamMember>("operation_team", "created_at"),
  });

export const useTimesheets = () =>
  useQuery({
    queryKey: ["timesheets"],
    queryFn: () => fetchAll<Timesheet>("timesheets", "work_date", false),
  });

export const useEntries = () =>
  useQuery({
    queryKey: ["timesheet_entries"],
    queryFn: () => fetchAll<TimesheetEntry>("timesheet_entries", "created_at"),
  });

export const useInvoices = () =>
  useQuery({
    queryKey: ["invoices"],
    queryFn: () => fetchAll<Invoice>("invoices", "period_start", false),
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
