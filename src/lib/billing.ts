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
  /**
   * Valor-hora acordado da hora extra PAGA ao colaborador (migration 029). Ausente ou nulo: a
   * hora extra paga é diária de custo ÷ jornada, sem fator, como sempre foi.
   */
  employeeOtHourCost?: number | null;
  /**
   * Saída antecipada paga proporcionalmente às horas trabalhadas (migration 029, motor por
   * vigência). Só vale com entrada e saída preenchidas; a cobrança não muda. Ausente: diária de
   * custo inteira, como no motor antigo.
   */
  proportionalCost?: boolean;
  /**
   * Regras definitivas da BS (migration 030). Presente = regra nova de COBRANÇA: jornada de
   * referência (sábado, se houver), cobrança proporcional na saída antecipada e hora extra
   * arredondada no dia ('diario') ou bruta para o fechamento acumular ('acumulado'). Ausente: a
   * cobrança de antes (diária cheia e minutos exatos após a tolerância).
   */
  roundingMode?: ModoDeArredondamento | null;
  /** Tipo do dia trabalhado (030). Ausente: dia útil. */
  dayKind?: TipoDoDia;
  /** Jornada de referência da cobrança no sábado (030), em horas. Ausente ou nula: dia comum. */
  saturdayShiftHours?: number | null;
  /** Fator do pagamento em feriado (030; 2 = adicional de 100%). Ausente ou nulo: sem regra. */
  holidayPayFactor?: number | null;
}

export type ModoDeArredondamento = "diario" | "acumulado";
export type TipoDoDia = "util" | "sabado" | "feriado";

/**
 * Arredondamento da hora extra cobrada (regra da BS, migration 030), aplicado aos minutos
 * residuais de cada hora, com as horas completas preservadas: até 15 min descarta; de 16 a 45,
 * 30 min; de 46 a 59, a hora seguinte. Espelha `arredondar_minutos_extras()`.
 */
export function arredondarMinutosExtras(minutos: number): number {
  if (!(minutos > 0)) return 0;
  const inteiros = Math.floor(minutos);
  const horas = Math.floor(inteiros / 60);
  const resto = inteiros % 60;
  if (resto <= 15) return horas * 60;
  if (resto <= 45) return horas * 60 + 30;
  return (horas + 1) * 60;
}

export interface EntryCalcResult {
  workedMinutes: number;
  overtimeMinutes: number;
  /** Minutos de hora extra COBRADOS (030); sem as regras novas, iguais a `overtimeMinutes`. */
  billedOvertimeMinutes: number;
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
 * Custo: diária de custo (proporcional às horas trabalhadas na saída antecipada, quando
 * `proportionalCost`) + horas excedentes x valor-hora acordado (ou diária de custo / jornada).
 * Com `roundingMode` (030), a cobrança usa a jornada de referência (sábado), é proporcional na
 * saída antecipada e arredonda a hora extra no dia (ou a deixa bruta para o fechamento acumular);
 * no feriado com fator, o pagamento é horas trabalhadas × custo-hora × fator.
 * A ordem das operações é a de `derivar_valores_por_vigencia()`, para a paridade.
 */
export function calcEntry(input: EntryCalcInput): EntryCalcResult {
  const { rules } = input;
  const shiftHours = rules.shift_hours > 0 ? rules.shift_hours : 8;
  const otHourRate = (rules.daily_rate / shiftHours) * (rules.ot_factor || 1);
  const otHourCost = input.employeeOtHourCost;
  const otCostHourRate =
    otHourCost !== null && otHourCost !== undefined && otHourCost > 0
      ? otHourCost
      : input.employeeDailyCost / shiftHours;

  if (input.status === "absent") {
    return {
      workedMinutes: 0,
      overtimeMinutes: 0,
      billedOvertimeMinutes: 0,
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
  const temHorarios = Boolean(input.checkIn) && Boolean(input.checkOut);
  const baseCost =
    input.proportionalCost === true && temHorarios && worked < planned
      ? (input.employeeDailyCost * worked) / planned
      : input.employeeDailyCost;

  const modo = input.roundingMode;
  let billedOvertime = overtime;
  let billedAmount = round2(rules.daily_rate + otHours * otHourRate);
  if (modo === "diario" || modo === "acumulado") {
    const sabado = input.saturdayShiftHours;
    const plannedCob =
      input.dayKind === "sabado" && sabado !== null && sabado !== undefined && sabado > 0
        ? sabado * 60
        : planned;
    const baseCob =
      temHorarios && worked < plannedCob
        ? (rules.daily_rate * worked) / plannedCob
        : rules.daily_rate;
    const excessoCob = Math.max(worked - plannedCob, 0);
    billedOvertime =
      modo === "acumulado"
        ? excessoCob
        : excessoCob > (rules.ot_tolerance_min ?? 0)
          ? arredondarMinutosExtras(excessoCob)
          : 0;
    billedAmount = round2(baseCob + (billedOvertime / 60) * otHourRate);
  }

  const fatorFeriado = input.holidayPayFactor;
  const costAmount =
    modo !== null &&
    modo !== undefined &&
    input.dayKind === "feriado" &&
    fatorFeriado !== null &&
    fatorFeriado !== undefined &&
    temHorarios
      ? round2((worked / 60) * (input.employeeDailyCost / shiftHours) * fatorFeriado)
      : round2(baseCost + otHours * otCostHourRate);

  return {
    workedMinutes: worked,
    overtimeMinutes: overtime,
    billedOvertimeMinutes: billedOvertime,
    dailyRate: rules.daily_rate,
    otHourRate,
    dailyCost: input.employeeDailyCost,
    billedAmount,
    costAmount,
  };
}

/**
 * Arredonda para o centavo do MESMO jeito que o banco grava.
 *
 * `derivar_valores_financeiros()` (migration 010) faz `ROUND((valor * 100)::numeric) / 100`.
 * O cast de `double precision` para `numeric` mantém 15 dígitos significativos, o que
 * absorve o ruído binário do produto; depois o `ROUND` de `numeric` arredonda o meio
 * centavo para cima. `Math.round` direto sobre o produto cru não tem essa etapa: um
 * empate exato como 120,825 chega como 12082,499999999998 e cai para 120,82, um
 * centavo abaixo do que o banco grava (120,83).
 *
 * `toPrecision(15)` reproduz o cast. Valores negativos mantêm a semântica anterior
 * do `Math.round` (meio para +infinito): o domínio monetário é não-negativo por
 * constraint, e o `numeric` do banco arredondaria o meio negativo para longe do zero.
 * Vale só para a prévia: o valor gravado continua sendo o derivado pelo banco.
 */
export const round2 = (v: number) =>
  Math.round(Number(((Number(v) || 0) * 100).toPrecision(15))) / 100;

export const margin = (revenue: number, cost: number) => round2(revenue - cost);
export const marginPct = (revenue: number, cost: number) =>
  revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0;

export const attendanceLabel: Record<AttendanceStatus, string> = {
  present: "Presente",
  absent: "Falta",
  replacement: "Substituição",
};
