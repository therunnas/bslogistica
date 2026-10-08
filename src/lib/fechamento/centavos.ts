/**
 * Dinheiro em centavos inteiros.
 *
 * O Fechamento não carrega reais como `number` decimal em lugar nenhum. O banco
 * guarda `numeric(12,2)`; a leitura pede esses valores como TEXTO (`::text`),
 * e este módulo converte o texto direto em um inteiro de centavos, sem passar
 * por ponto flutuante: nenhum `parseFloat`, nenhuma multiplicação de decimal
 * por 100. Por isso `0,10 + 0,20` é exatamente `30` centavos.
 *
 * O formato aceito é o que o Postgres produz para `numeric(12,2)`:
 *
 *     [-] inteiro [. um ou dois dígitos]
 *
 * com o inteiro sem zero à esquerda (`0` ou `1…9` seguido de dígitos). Qualquer
 * outra coisa — espaço, expoente, vírgula, `+`, ponto sem dígito, mais de duas
 * casas — é recusada: um `numeric(12,2)` não gera nada disso, então ver isso é
 * sinal de que a leitura mudou, e é melhor falhar alto.
 */

import { ErroDeDadoFinanceiro } from "./erros";

const FORMATO = /^(-)?(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

/** `numeric(12,2)` tem no máximo 10 dígitos inteiros; 13 dá folga e ainda é exato. */
const MAXIMO_DE_DIGITOS_INTEIROS = 13;

/**
 * Converte o texto de um `numeric` em centavos inteiros.
 *
 * `"150.10"` → `15010`, `"-1.25"` → `-125`, `"1.2"` → `120`, `"-0.00"` → `0`
 * (nunca `-0`). Só aceita `string`: um `number` aqui significa que alguém leu a
 * coluna sem o `::text` e já passou por ponto flutuante.
 */
export function centavosDeNumeric(valor: unknown, campo = "valor"): number {
  if (typeof valor !== "string") {
    throw new ErroDeDadoFinanceiro(
      `${campo}: esperado o texto do numeric, recebido ${valor === null ? "null" : typeof valor}.`,
    );
  }

  const partes = FORMATO.exec(valor);
  if (partes === null) {
    throw new ErroDeDadoFinanceiro(`${campo}: "${valor}" não é um numeric de duas casas.`);
  }

  const [, sinal, inteiro, fracao] = partes;
  if (inteiro === undefined) {
    throw new ErroDeDadoFinanceiro(`${campo}: "${valor}" não é um numeric de duas casas.`);
  }
  if (inteiro.length > MAXIMO_DE_DIGITOS_INTEIROS) {
    throw new ErroDeDadoFinanceiro(`${campo}: "${valor}" tem dígitos demais.`);
  }

  const centavosDaFracao = fracao === undefined ? 0 : Number(fracao.padEnd(2, "0"));
  const centavos = Number(inteiro) * 100 + centavosDaFracao;

  if (!Number.isSafeInteger(centavos)) {
    throw new ErroDeDadoFinanceiro(`${campo}: "${valor}" fora do intervalo seguro.`);
  }

  return sinal === "-" && centavos !== 0 ? -centavos : centavos;
}

/**
 * Soma que se recusa a sair do intervalo seguro. Os totais do Fechamento são
 * somas de inteiros; se uma delas deixasse de ser exata, o relatório mentiria
 * sem aviso.
 */
export function somarCentavos(a: number, b: number, campo = "soma"): number {
  const soma = a + b;
  if (!Number.isSafeInteger(soma)) {
    throw new ErroDeDadoFinanceiro(`${campo}: a soma saiu do intervalo seguro.`);
  }
  return soma;
}

/**
 * Decompõe UM lançamento em diária e hora extra — a regra de `gerar_fatura`:
 *
 *     extra  = GREATEST(billed_amount − daily_rate_snapshot, 0)
 *     diária = billed_amount − extra
 *
 * Sempre por linha, antes de qualquer soma: `GREATEST` da soma não é a soma dos
 * `GREATEST`. Não olha minutos nem taxa de hora extra — `ot_hour_rate_snapshot`
 * está arredondado a duas casas e o valor faturado foi calculado sem esse
 * arredondamento, então multiplicar daria centavos errados.
 */
export function decomporLancamento(
  faturadoCentavos: number,
  diariaSnapshotCentavos: number,
): { diariaCentavos: number; extraCentavos: number } {
  const extraCentavos = Math.max(faturadoCentavos - diariaSnapshotCentavos, 0);
  return { diariaCentavos: faturadoCentavos - extraCentavos, extraCentavos };
}
