/**
 * Regras de cálculo de diárias, horas extras, receita e custo.
 * Usado no apontamento diário e nos fechamentos.
 */

export type AttendanceStatus = "present" | "absent" | "replacement";

export interface ShiftLike {
  start_time: string; // "06:00:00"
  end_time: string; // "15:00:00"
  break_minutes: number;
  crosses_midnight: boolean;
}

export interface ContractRules {
  daily_rate: number;
  shift_hours: number;
  ot_factor: number;
  ot_tolerance_min: number;
}

const toMinutes = (time: string | null | undefined) => {
  if (!time) return null;
  const [h = 0, m = 0] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Duração líquida prevista do turno em minutos (trata virada de meia-noite). */
export function shiftPlannedMinutes(shift: ShiftLike | null | undefined) {
  if (!shift) return 0;
  const start = toMinutes(shift.start_time) ?? 0;
  let end = toMinutes(shift.end_time) ?? 0;
  if (shift.crosses_midnight || end <= start) end += 24 * 60;
  return Math.max(0, end - start - (shift.break_minutes ?? 0));
}

/** Minutos trabalhados a partir de entrada/saída/intervalo (trata virada de dia). */
export function workedMinutes(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  breakMinutes = 0,
) {
  const start = toMinutes(checkIn);
  let end = toMinutes(checkOut);
  if (start === null || end === null) return 0;
  if (end <= start) end += 24 * 60;
  return Math.max(0, end - start - (breakMinutes ?? 0));
}

export interface EntryCalcInput {
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  breakMinutes: number;
  plannedMinutes: number;
  rules: ContractRules;
  employeeDailyCost: number;
}

export interface EntryCalcResult {
  workedMinutes: number;
  overtimeMinutes: number;
  dailyRate: number;
  otHourRate: number;
  dailyCost: number;
  billedAmount: number;
  costAmount: number;
}

/**
 * Diária: 1 por colaborador presente (faltas não geram cobrança).
 * Hora extra: (diária / horas do turno) x fator x horas excedentes,
 * descontando a tolerância em minutos definida no contrato.
 */
export function calcEntry(input: EntryCalcInput): EntryCalcResult {
  const { rules } = input;
  const shiftHours = rules.shift_hours > 0 ? rules.shift_hours : 8;
  const otHourRate = (rules.daily_rate / shiftHours) * (rules.ot_factor || 1);
  const otCostHourRate = input.employeeDailyCost / shiftHours;

  if (input.status === "absent") {
    return {
      workedMinutes: 0,
      overtimeMinutes: 0,
      dailyRate: rules.daily_rate,
      otHourRate,
      dailyCost: input.employeeDailyCost,
      billedAmount: 0,
      costAmount: 0,
    };
  }

  const worked = workedMinutes(input.checkIn, input.checkOut, input.breakMinutes);
  const planned = input.plannedMinutes || shiftHours * 60;
  const excess = worked - planned;
  const overtime = excess > (rules.ot_tolerance_min ?? 0) ? excess : 0;
  const otHours = overtime / 60;

  return {
    workedMinutes: worked,
    overtimeMinutes: overtime,
    dailyRate: rules.daily_rate,
    otHourRate,
    dailyCost: input.employeeDailyCost,
    billedAmount: round2(rules.daily_rate + otHours * otHourRate),
    costAmount: round2(input.employeeDailyCost + otHours * otCostHourRate),
  };
}

export const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

export const margin = (revenue: number, cost: number) => round2(revenue - cost);
export const marginPct = (revenue: number, cost: number) =>
  revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0;

export const attendanceLabel: Record<AttendanceStatus, string> = {
  present: "Presente",
  absent: "Falta",
  replacement: "Substituição",
};
