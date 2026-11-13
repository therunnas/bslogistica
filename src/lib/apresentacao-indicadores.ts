/**
 * Apresentação dos indicadores do Dashboard, dos Relatórios e do Faturamento (QA-BS-01, CP-09).
 *
 * Só TEXTO: nada aqui muda a contagem de diárias, a margem ou um valor exportado — os números vêm do
 * ledger e do banco como antes. Funções puras, cobertas por `test:interface-cp09`. Sem importações em
 * tempo de execução: a suíte Node executa este arquivo.
 */

interface LinhaComDiaria {
  status: string;
  specialValue: number;
}

/**
 * R-CP08-01: quantas das diárias contadas são de domingo ou feriado, cobradas por hora (V2). A
 * contagem de "Diárias" continua incluindo esses dias (`dailies` = 1 para quem não faltou, e a fatura
 * grava o mesmo em `total_dailies`); o texto só passa a dizer isso.
 */
export function diariasDeDomingoOuFeriado(linhas: readonly LinhaComDiaria[]): number {
  return linhas.filter((linha) => linha.status !== "absent" && linha.specialValue > 0).length;
}

/** Descrição do cartão "Diárias": a base de sempre e, havendo, quantas são de domingo/feriado. */
export function descricaoDasDiarias(base: string, deDomingoOuFeriado: number): string {
  if (deDomingoOuFeriado <= 0) return base;
  return `${base} · inclui ${deDomingoOuFeriado} de domingo ou feriado, cobrado por hora`;
}

export const SEM_RECEITA_NO_PERIODO = "sem receita no período";

/**
 * R-CP08-02: o percentual da margem. Sem receita não há percentual — `marginPct` devolve 0 e a tela
 * mostrava "0,0%" ao lado de uma margem negativa, como se a operação tivesse empatado.
 */
export function percentualDaMargem(receita: number, custo: number): string {
  if (!(receita > 0)) return SEM_RECEITA_NO_PERIODO;
  // Mesma conta e mesmo formato de `pct(marginPct(receita, custo))` (billing.ts / format.ts).
  const percentual =
    Math.round(Number((((receita - custo) / receita) * 100 * 100).toPrecision(15))) / 100;
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(percentual)}%`;
}

/**
 * R-CP08-03: valor em reais no CSV com vírgula decimal e sem separador de milhar ("1234,56"), o mesmo
 * formato da exportação do Fechamento. Com ponto, a planilha em português lia a coluna como texto.
 * Os dígitos são exatamente os de antes (`toFixed(2)`); só o separador muda — e "-0.00" vira "0,00".
 */
export function reaisNoCsv(valor: number): string {
  const texto = valor.toFixed(2);
  return (texto === "-0.00" ? "0.00" : texto).replace(".", ",");
}
