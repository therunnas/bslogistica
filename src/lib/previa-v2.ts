/**
 * Prévia do apontamento pelo núcleo V2 (FIN-PR-02).
 *
 * O banco passa a calcular DIA ÚTIL e SÁBADO pelo núcleo V2 (migration 036). A prévia da tela tem de
 * dizer o mesmo número que o banco vai gravar, então estes dois dias passam por
 * `calcularComponentesV2` (a mesma aritmética da função SQL `nucleo_componentes_v2`).
 *
 * O QUE CONTINUA NO `calcEntry()` (billing.ts, sem alteração):
 *   - o motor antigo e os bancos sem a 036 (o banco anuncia `nucleo_v2` em `estado_motor_vigencia`;
 *     sem o anúncio a prévia é a de antes);
 *   - DOMINGO e FERIADO, que seguem a 030 até o PR 09;
 *   - o acumulado também passa pela V2 (minutos brutos), exatamente como o banco.
 *
 * Os dois caminhos ficam lado a lado de propósito: `calcEntry` é a regra anterior (a prova das
 * diferenças legado × V2) e este módulo é a regra nova.
 *
 * RECUSAS: o banco recusa presença com entrada, saída e zero minuto trabalhado. A prévia não pode
 * quebrar a tela por isso: devolve valores zerados e `recusa` com o código. A mensagem para a
 * pessoa é da tela (PR de telas); o banco continua sendo a barreira.
 *
 * Importa valor de `billing` e do núcleo: as suítes que carregam este módulo usam o resolvedor de
 * `scripts/_resolver-ts.mjs`.
 */

import { calcEntry, type EntryCalcInput, type EntryCalcResult } from "./billing";
import { ErroDoNucleo, calcularComponentesV2 } from "./nucleo-financeiro";

export interface EntradaDaPreviaV2 extends EntryCalcInput {
  /** O banco anunciou a 036 e o lançamento é de dia útil ou sábado (não domingo nem feriado). */
  nucleoV2?: boolean;
}

export interface ResultadoDaPreviaV2 extends EntryCalcResult {
  /** Código `nucleo:<codigo>` da recusa do núcleo; a prévia vem zerada. */
  recusa?: string;
}

const centavos = (reais: number) => Math.round(Number((reais * 100).toPrecision(15)));

/** Esta entrada é calculada pela V2? (só dia útil e sábado, com as regras definitivas) */
export function usaNucleoV2(e: EntradaDaPreviaV2): boolean {
  return (
    e.nucleoV2 === true &&
    (e.roundingMode === "diario" || e.roundingMode === "acumulado") &&
    (e.dayKind === "util" || e.dayKind === "sabado" || e.dayKind === undefined)
  );
}

export function calcEntryComNucleo(e: EntradaDaPreviaV2): ResultadoDaPreviaV2 {
  if (!usaNucleoV2(e)) return calcEntry(e);

  const { rules } = e;
  const fatorHe = centavos(rules.ot_factor > 0 ? rules.ot_factor : 1);
  const otHourRate = (rules.daily_rate / 8) * (rules.ot_factor || 1);
  const base = {
    workedMinutes: 0,
    overtimeMinutes: 0,
    billedOvertimeMinutes: 0,
    dailyRate: rules.daily_rate,
    otHourRate,
    dailyCost: e.employeeDailyCost,
    billedAmount: 0,
    costAmount: 0,
  };

  try {
    const r = calcularComponentesV2({
      status: e.status,
      tipoDoDia: e.dayKind === "sabado" ? "sabado" : "util",
      entrada: e.checkIn ? e.checkIn : null,
      saida: e.checkOut ? e.checkOut : null,
      intervaloMinutos: e.breakMinutes,
      diariaCentavos: centavos(rules.daily_rate),
      fatorHeCentesimos: fatorHe,
      fatorEspecialCentesimos: 200,
      toleranciaMinutos: Math.round(rules.ot_tolerance_min ?? 0),
      modoHe: e.roundingMode as "diario" | "acumulado",
      arredondamentoEspecial: "minutos",
      adicionalCentavos: 0,
      custoDiarioCentavos: centavos(e.employeeDailyCost),
      custoHoraHeCentavos:
        e.employeeOtHourCost !== null &&
        e.employeeOtHourCost !== undefined &&
        e.employeeOtHourCost > 0
          ? centavos(e.employeeOtHourCost)
          : null,
    });
    return {
      ...base,
      workedMinutes: r.minutosTrabalhados,
      overtimeMinutes: r.heMinutosPagos,
      billedOvertimeMinutes: r.heMinutosCobrados,
      billedAmount: r.totalCentavos / 100,
      costAmount: r.custoTotalCentavos / 100,
    };
  } catch (erro) {
    if (erro instanceof ErroDoNucleo) return { ...base, recusa: erro.codigo };
    throw erro;
  }
}
