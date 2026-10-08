/**
 * Rascunho do apontamento diário: o que a tela mostra, soma e grava.
 *
 * Funções puras, sem rede, banco ou relógio. Existem separadas do componente
 * para que a regra "só vale o que foi apontado" seja testável sem navegador.
 *
 * REGRAS
 *
 *  - **Apontado é o que existe em `timesheet_entries`.** Membro da equipe sem
 *    registro é *não apontado*: `status: null`, sem diária, sem cobrança, sem
 *    custo. Não é "Presente" por omissão e não é "Falta" — Presente, Falta e
 *    Substituição são decisões explícitas de quem aponta;
 *  - **Dia fechado mostra só o que foi gravado.** `operation_team` guarda a
 *    equipe *atual*, sem vigência: quem entrou depois não pode aparecer num dia
 *    que já fechou;
 *  - **Linha gravada e não editada mostra o que está gravado** (horas, hora
 *    extra, faturado e custo), nunca um recálculo com o contrato ou o custo de
 *    hoje. Só a linha que a pessoa mexeu mostra a prévia de `calcEntry()`, e
 *    mesmo essa é só prévia: quem decide o valor é o trigger do banco.
 */

import type { AttendanceStatus, EntryCalcResult, ShiftLike } from "../billing";

/**
 * `status: null` é "não apontado": a linha existe só na interface. Nunca vai
 * para o banco e nunca entra em total.
 */
export interface DraftEntry {
  employeeId: string;
  entryId: string | undefined;
  status: AttendanceStatus | null;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  notes: string;
}

/** A linha com a decisão já tomada: só estas podem ser gravadas. */
export type DraftEntryApontada = DraftEntry & { status: AttendanceStatus };

/** O pedaço de `operation_team` que o rascunho usa. */
export interface MembroDaEquipe {
  employee_id: string;
}

/** O pedaço de `timesheet_entries` que o rascunho usa. */
export interface RegistroGravado {
  id: string;
  employee_id: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number;
  worked_minutes: number;
  overtime_minutes: number;
  billed_amount: number;
  cost_amount: number;
  notes: string | null;
}

export interface ValoresDaLinha {
  workedMinutes: number;
  overtimeMinutes: number;
  billedAmount: number;
  costAmount: number;
}

const hhmm = (valor: string | null | undefined) => valor?.slice(0, 5) ?? "";

/** Linha vinda do que está gravado. */
function linhaGravada(registro: RegistroGravado): DraftEntry {
  return {
    employeeId: registro.employee_id,
    entryId: registro.id,
    status: registro.status,
    checkIn: hhmm(registro.check_in),
    checkOut: hhmm(registro.check_out),
    breakMinutes: registro.break_minutes,
    notes: registro.notes ?? "",
  };
}

/** Linha de quem está na equipe mas ainda não foi apontado. */
function linhaNaoApontada(
  membro: MembroDaEquipe,
  turno: Pick<ShiftLike, "start_time" | "end_time" | "break_minutes"> | null,
): DraftEntry {
  return {
    employeeId: membro.employee_id,
    entryId: undefined,
    status: null,
    checkIn: hhmm(turno?.start_time),
    checkOut: hhmm(turno?.end_time),
    breakMinutes: turno?.break_minutes ?? 0,
    notes: "",
  };
}

/**
 * As linhas que o servidor sustenta para o contexto.
 *
 * Ordem: a equipe atual na sua ordem (gravados e não apontados), depois quem
 * tem registro mas já não está na equipe ativa. Quem saiu da equipe continua
 * aparecendo enquanto houver registro — o histórico não some com a alocação.
 *
 * Dia fechado: **só** registros gravados. Quem não tem registro não aparece.
 */
export function montarLinhasDoServidor({
  membros,
  registros,
  turno,
  fechado,
}: {
  membros: readonly MembroDaEquipe[];
  registros: readonly RegistroGravado[];
  turno: Pick<ShiftLike, "start_time" | "end_time" | "break_minutes"> | null;
  fechado: boolean;
}): DraftEntry[] {
  const porColaborador = new Map(registros.map((registro) => [registro.employee_id, registro]));
  const vistos = new Set<string>();
  const linhas: DraftEntry[] = [];

  for (const membro of membros) {
    if (vistos.has(membro.employee_id)) {
      continue;
    }

    vistos.add(membro.employee_id);

    const registro = porColaborador.get(membro.employee_id);

    if (registro) {
      linhas.push(linhaGravada(registro));
    } else if (!fechado) {
      linhas.push(linhaNaoApontada(membro, turno));
    }
  }

  for (const registro of registros) {
    if (!vistos.has(registro.employee_id)) {
      vistos.add(registro.employee_id);
      linhas.push(linhaGravada(registro));
    }
  }

  return linhas;
}

/**
 * Valores da linha para exibição e soma.
 *
 * - não apontada: zero em tudo;
 * - gravada e (não editada ou dia fechado): o que está gravado;
 * - o resto (nova ou editada, dia aberto): a prévia.
 */
export function valoresDaLinha({
  linha,
  registro,
  editada,
  fechado,
  previa,
}: {
  linha: DraftEntry;
  registro: RegistroGravado | undefined;
  editada: boolean;
  fechado: boolean;
  previa: EntryCalcResult | null;
}): ValoresDaLinha {
  if (registro && (fechado || !editada)) {
    return {
      workedMinutes: Number(registro.worked_minutes) || 0,
      overtimeMinutes: Number(registro.overtime_minutes) || 0,
      billedAmount: Number(registro.billed_amount) || 0,
      costAmount: Number(registro.cost_amount) || 0,
    };
  }

  if (linha.status === null || previa === null) {
    return { workedMinutes: 0, overtimeMinutes: 0, billedAmount: 0, costAmount: 0 };
  }

  return {
    workedMinutes: previa.workedMinutes,
    overtimeMinutes: previa.overtimeMinutes,
    billedAmount: previa.billedAmount,
    costAmount: previa.costAmount,
  };
}

export interface TotaisDoDia {
  dailies: number;
  overtime: number;
  billed: number;
  cost: number;
}

/**
 * Soma do dia. Diária = presença ou substituição **apontada**; falta e não
 * apontado não contam.
 */
export function totalizar(
  itens: readonly { status: AttendanceStatus | null; valores: ValoresDaLinha }[],
): TotaisDoDia {
  return itens.reduce<TotaisDoDia>(
    (acc, { status, valores }) => ({
      dailies: acc.dailies + (status === "present" || status === "replacement" ? 1 : 0),
      overtime: acc.overtime + valores.overtimeMinutes,
      billed: acc.billed + valores.billedAmount,
      cost: acc.cost + valores.costAmount,
    }),
    { dailies: 0, overtime: 0, billed: 0, cost: 0 },
  );
}

export const foiApontada = (linha: DraftEntry): linha is DraftEntryApontada =>
  linha.status !== null;

/**
 * O que um salvamento grava: linhas com decisão tomada que ainda não existem
 * no banco ou que a pessoa editou. Linha não apontada nunca entra.
 */
export function linhasASalvar(
  linhas: readonly DraftEntry[],
  editadas: ReadonlySet<string>,
): DraftEntryApontada[] {
  return linhas
    .filter(foiApontada)
    .filter((linha) => !linha.entryId || editadas.has(linha.employeeId));
}

/** Quantas linhas da equipe ainda esperam uma decisão. */
export const contarNaoApontadas = (linhas: readonly DraftEntry[]) =>
  linhas.filter((linha) => linha.status === null).length;
