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
