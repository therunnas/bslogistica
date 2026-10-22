export type RecordStatus = "active" | "inactive";
export type OperationType = "fixed" | "spot";
export type TimesheetStatus = "open" | "closed";
export type InvoiceStatus = "draft" | "closed" | "issued";
export type AttendanceStatus = "present" | "absent" | "replacement";

export interface Client {
  id: string;
  name: string;
  doc: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: RecordStatus;
  notes: string | null;
}

export interface Contract {
  id: string;
  client_id: string;
  name: string;
  daily_rate: number;
  shift_hours: number;
  ot_factor: number;
  ot_tolerance_min: number;
  valid_from: string;
  valid_to: string | null;
  status: RecordStatus;
}

export interface Employee {
  id: string;
  name: string;
  doc: string | null;
  role: string | null;
  phone: string | null;
  daily_cost: number;
  status: RecordStatus;
}

export interface Operation {
  id: string;
  client_id: string;
  contract_id: string | null;
  type: OperationType;
  name: string;
  site: string | null;
  agreed_amount: number | null;
  operation_date: string | null;
  status: RecordStatus;
  notes: string | null;
}

export interface Shift {
  id: string;
  operation_id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  crosses_midnight: boolean;
  status: RecordStatus;
}

export interface TeamMember {
  id: string;
  operation_id: string;
  shift_id: string | null;
  employee_id: string;
  active: boolean;
}

export interface Timesheet {
  id: string;
  operation_id: string;
  shift_id: string | null;
  work_date: string;
  status: TimesheetStatus;
  notes: string | null;
}

export interface TimesheetEntry {
  id: string;
  timesheet_id: string;
  employee_id: string;
  operation_id: string;
  work_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number;
  worked_minutes: number;
  overtime_minutes: number;
  daily_rate_snapshot: number;
  ot_hour_rate_snapshot: number;
  daily_cost_snapshot: number;
  billed_amount: number;
  cost_amount: number;
  invoice_id: string | null;
  notes: string | null;
  /** Condições financeiras gravadas pelo banco (migrations 022 e 024); nulas em apontamento legado. */
  terms_origin?: string | null;
  shift_hours_snapshot?: number | null;
  ot_factor_snapshot?: number | null;
  ot_tolerance_snapshot?: number | null;
  planned_minutes_snapshot?: number | null;
  contract_terms_id?: string | null;
  operation_terms_id?: string | null;
  employee_cost_terms_id?: string | null;
}

export interface Invoice {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  status: InvoiceStatus;
  total_dailies: number;
  total_overtime: number;
  total_amount: number;
  total_cost: number;
  notes: string | null;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  operation_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}
