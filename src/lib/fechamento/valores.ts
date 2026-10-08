/**
 * Acumulação de `Valores`, margem e horas — tudo em aritmética inteira.
 *
 * Cada recorte (consolidado, a faturar, já faturado, por colaborador) usa um
 * acumulador próprio e é "fechado" uma vez só: `resultado` e `margem` não são
 * somáveis, então são calculados DEPOIS da soma, a partir dos totais.
 */

import { somarCentavos } from "./centavos";
import { ErroDeDadoFinanceiro } from "./erros";
import type { LinhaNormalizada, Valores } from "./tipos";

export interface Acumulador {
  diarias: number;
  minutosExtras: number;
  diariaCentavos: number;
  extraCentavos: number;
  custoCentavos: number;
  faturadoCentavos: number;
}

export function novoAcumulador(): Acumulador {
  return {
    diarias: 0,
    minutosExtras: 0,
    diariaCentavos: 0,
    extraCentavos: 0,
    custoCentavos: 0,
    faturadoCentavos: 0,
  };
}

/**
 * Soma UM lançamento financeiro. Quem chama já excluiu as faltas: uma falta não
 * gera diária, custo nem faturamento no Fechamento.
 */
export function acumular(acumulador: Acumulador, linha: LinhaNormalizada): void {
  acumulador.diarias = somarCentavos(acumulador.diarias, 1, "diárias");
  acumulador.minutosExtras = somarCentavos(
    acumulador.minutosExtras,
    linha.minutosExtras,
    "minutos extras",
  );
  acumulador.diariaCentavos = somarCentavos(
    acumulador.diariaCentavos,
    linha.diariaCentavos,
    "diárias (centavos)",
  );
  acumulador.extraCentavos = somarCentavos(
    acumulador.extraCentavos,
    linha.extraCentavos,
    "horas extras (centavos)",
  );
  acumulador.custoCentavos = somarCentavos(
    acumulador.custoCentavos,
    linha.custoCentavos,
    "custo previsto",
  );
  acumulador.faturadoCentavos = somarCentavos(
    acumulador.faturadoCentavos,
    linha.faturadoCentavos,
    "faturado",
  );
}

/** Fecha o acumulador: acrescenta resultado e margem. */
export function fecharValores(acumulador: Acumulador): Valores {
  const resultadoCentavos = acumulador.faturadoCentavos - acumulador.custoCentavos;
  if (!Number.isSafeInteger(resultadoCentavos)) {
    throw new ErroDeDadoFinanceiro("resultado: fora do intervalo seguro.");
  }

  return {
    diarias: acumulador.diarias,
    minutosExtras: acumulador.minutosExtras,
    diariaCentavos: acumulador.diariaCentavos,
    extraCentavos: acumulador.extraCentavos,
    custoCentavos: acumulador.custoCentavos,
    faturadoCentavos: acumulador.faturadoCentavos,
    resultadoCentavos,
    margemPermil: margemPermil(acumulador.faturadoCentavos, acumulador.custoCentavos),
  };
}

/**
 * `(faturado − custo) / faturado`, em milésimos (`125` = 12,5%), inteiro.
 *
 * - faturado = 0 → `null` (a tela mostra "—"; nunca divide por zero);
 * - arredondamento: **meio para longe de zero**, simétrico — `+0,5‰` vira `+1`
 *   e `−0,5‰` vira `−1`;
 * - feito em BigInt, para o produto `(faturado − custo) × 1000` nunca perder
 *   precisão.
 */
export function margemPermil(faturadoCentavos: number, custoCentavos: number): number | null {
  if (!Number.isSafeInteger(faturadoCentavos) || !Number.isSafeInteger(custoCentavos)) {
    throw new ErroDeDadoFinanceiro("margem: entrada fora do intervalo seguro.");
  }
  if (faturadoCentavos < 0) {
    throw new ErroDeDadoFinanceiro("margem: faturado negativo.");
  }
  if (faturadoCentavos === 0) return null;

  const numerador = BigInt(faturadoCentavos - custoCentavos) * 1000n;
  const denominador = BigInt(faturadoCentavos);

  let quociente = numerador / denominador; // BigInt trunca em direção a zero
  const resto = numerador % denominador;
  const restoAbsoluto = resto < 0n ? -resto : resto;

  if (restoAbsoluto * 2n >= denominador) {
    quociente += numerador < 0n ? -1n : 1n;
  }

  return Number(quociente);
}

/**
 * `round(minutos / 60, 2)` em centésimos de hora, em aritmética inteira.
 *
 * É o que `gerar_fatura` grava em `total_overtime`: `round(sum(overtime_minutes)
 * / 60, 2)`. O `round` do Postgres sobre `numeric` arredonda o meio para longe
 * de zero; para minutos não negativos isso é `⌊(200·min + 60) / 120⌋`.
 * `90` → `150` (1,50 h), `135` → `225` (2,25 h), `1` → `2` (0,02 h).
 *
 * Aplique ao TOTAL de minutos, nunca linha a linha: somar horas já arredondadas
 * dá um número diferente do da fatura.
 */
export function centesimosDeHora(minutos: number): number {
  if (!Number.isSafeInteger(minutos) || minutos < 0) {
    throw new ErroDeDadoFinanceiro(`horas: minutos inválidos (${String(minutos)}).`);
  }
  return Number((BigInt(minutos) * 200n + 60n) / 120n);
}
