/**
 * Entrada igual à saída (C05-B8.9).
 *
 * O cálculo (banco e `billing.ts`) soma 24 h quando a saída não é posterior à entrada, para que
 * o turno que vira a meia-noite (22:00 → 06:00) seja medido. A igualdade cai na mesma regra e
 * vira uma jornada de 24 h: num turno de 8 h, 15 h de hora extra cobradas e pagas. Nenhuma regra
 * da BS prevê jornada de 24 h; na prática é erro de digitação. As telas de apontamento recusam
 * salvar a linha; o cálculo não muda.
 *
 * Só vale para linha que não é falta e tem os DOIS horários: horário ausente é outra questão,
 * ainda sem regra de negócio, e não é recusado aqui.
 *
 * Sem importações em tempo de execução: as suítes Node executam este arquivo.
 */

export const MENSAGEM_ENTRADA_IGUAL_SAIDA =
  "Entrada igual à saída seria calculada como jornada de 24 horas. Corrija o horário antes de salvar.";

export function entradaIgualSaida(
  status: string,
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): boolean {
  if (status === "absent") return false;
  const entrada = (checkIn ?? "").slice(0, 5);
  const saida = (checkOut ?? "").slice(0, 5);
  return entrada !== "" && entrada === saida;
}

/**
 * D1/B3 (QA-BS-01, CP-05). Saída ANTES da entrada num turno que NÃO atravessa a meia-noite.
 *
 * O cálculo (banco e telas) soma 24 h quando a saída não é posterior à entrada: é assim que o
 * turno 22:00 → 07:00 é medido. Num turno diurno, a mesma regra transforma o erro de digitação
 * 08:00 → 07:50 em 22h50 trabalhadas (num contrato de R$ 240: R$ 915,00 cobrados e R$ 456,67 de
 * custo), gravadas sem nenhum aviso. O que distingue os casos é o TURNO da folha:
 *
 *   A. o turno vira o dia (`crosses_midnight`, ou fim ≤ início, como 15:00–00:00): saída antes da
 *      entrada é a jornada noturna esperada — não é sinalizada;
 *   B/C. o turno não vira o dia (ou não há turno): é uma jornada excepcional ou um erro de
 *      digitação — a tela exige corrigir o horário OU confirmar, linha a linha, que a jornada
 *      atravessou a meia-noite. A confirmação vale só para aquele par de horários;
 *   D. entrada igual à saída (24 h) continua recusada por `entradaIgualSaida`, sem confirmação.
 *
 * Nenhum limite de duração é presumido aqui (DEC-CP05-01): só a coerência com o turno.
 * O cálculo não muda.
 */
export const MENSAGEM_SAIDA_ANTES_DA_ENTRADA =
  "A saída antes da entrada faz o cálculo contar a jornada até o dia seguinte. Este turno não atravessa a meia-noite: corrija o horário ou confirme, na linha, que a jornada atravessou a meia-noite.";

export interface TurnoDaFolha {
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
}

/** O turno vira o dia? A mesma regra do cálculo (`shiftPlannedMinutes`): marcado ou fim ≤ início. */
export function turnoViraODia(turno: TurnoDaFolha | null | undefined): boolean {
  if (!turno) return false;
  const inicio = turno.start_time.slice(0, 5);
  const fim = turno.end_time.slice(0, 5);
  return turno.crosses_midnight || (inicio !== "" && fim !== "" && fim <= inicio);
}

export function saidaAntesDaEntradaForaDoTurno(
  status: string,
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  turno: TurnoDaFolha | null | undefined,
): boolean {
  if (status === "absent") return false;
  const entrada = (checkIn ?? "").slice(0, 5);
  const saida = (checkOut ?? "").slice(0, 5);
  if (entrada === "" || saida === "" || saida >= entrada) return false;
  return !turnoViraODia(turno);
}

/** Chave da confirmação: vale para ESTE colaborador e ESTE par de horários, nada mais. */
export function chaveDaConfirmacaoDeVirada(
  employeeId: string,
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): string {
  return `${employeeId}|${(checkIn ?? "").slice(0, 5)}|${(checkOut ?? "").slice(0, 5)}`;
}
