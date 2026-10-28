/**
 * Apoio das suítes do Fechamento: um "banco" falso COERENTE com os lançamentos.
 *
 * `bancoCoerente` devolve o que `resumo_financeiro_periodo` e as demais funções da 030 devolveriam
 * para um conjunto de lançamentos normalizados — somando o que está nas linhas, sem regra
 * financeira nenhuma. Serve para as suítes que testam outra coisa (período, alertas, exportação)
 * não acusarem divergência de conciliação por um banco que elas nem montaram.
 *
 * As suítes que testam a conciliação em si montam o `banco` à mão, valor a valor.
 */

const soma = (valores) => valores.reduce((total, v) => total + v, 0);

export function bancoCoerente(
  linhas,
  { adicionais = [], ajustesPrevistos = [], ajustesFaturados = [], saldoDeHoras = [] } = {},
) {
  const financeiras = linhas.filter((l) => l.status !== "absent");
  const apontamentos = soma(financeiras.map((l) => l.faturadoCentavos));
  const pendentes = soma(
    financeiras.filter((l) => l.invoiceId === null).map((l) => l.faturadoCentavos),
  );
  const adic = soma(adicionais.map((a) => a.valorCentavos));
  const adicPendentes = soma(
    adicionais.filter((a) => a.faturaId === null).map((a) => a.valorCentavos),
  );
  const ajusteFaturado = soma(ajustesFaturados.map((a) => a.valorCentavos));
  const ajustePrevisto = soma(ajustesPrevistos.map((a) => a.ajusteCentavos));

  return {
    resumo: {
      receitaApontamentosCentavos: apontamentos,
      adicionaisCentavos: adic,
      ajusteFaturadoCentavos: ajusteFaturado,
      ajustePrevistoCentavos: ajustePrevisto,
      receitaTotalCentavos: apontamentos + adic + ajusteFaturado + ajustePrevisto,
      aFaturarCentavos: pendentes + adicPendentes + ajustePrevisto,
      faturadoCentavos: apontamentos - pendentes + (adic - adicPendentes) + ajusteFaturado,
      ajusteAplicavel: true,
    },
    ajustesPrevistos,
    ajustesFaturados,
    adicionais,
    saldoDeHoras,
  };
}

/** Um `banco` vazio e coerente: sem adicional, sem arredondamento acumulado, sem saldo. */
export const bancoSemExtras = (linhas) => bancoCoerente(linhas);
