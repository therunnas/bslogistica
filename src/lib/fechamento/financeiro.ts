/**
 * Composição financeira do Fechamento e conciliação com o banco (migration 030).
 *
 * O que este módulo faz é SOMAR parcelas que já existem — lançamentos persistidos, adicionais e os
 * ajustes devolvidos por `ajustes_de_arredondamento_acumulado` — e COMPARAR a soma com
 * `resumo_financeiro_periodo`. Ele não decide arredondamento, tolerância, sábado nem feriado: isso
 * está no banco, que é a única autoridade.
 *
 * VOCABULÁRIO (um nome, um significado — o mesmo de Dashboard, Relatórios e Faturamento):
 *
 *   Apontamentos      Σ cobrado dos lançamentos de presença e substituição
 *   Adicionais        adicionais de serviço não cancelados, com o período inteiro dentro
 *   Ajuste faturado   arredondamento acumulado que já está em fatura emitida
 *   Ajuste previsto   arredondamento acumulado do período ainda sem fatura
 *   Receita           apontamentos + adicionais + ajuste faturado + ajuste previsto
 *   A faturar         o que ainda não está em fatura (inclui o ajuste previsto)
 *   Já faturado       o que já está em fatura
 *
 * **A conciliação nunca corrige.** Quando o Fechamento e o banco discordam, o item aparece como
 * "não confere" e vira alerta crítico; nenhum total é alterado para as duas telas coincidirem.
 * A única diferença prevista é a do arredondamento de um MÊS inteiro: o Fechamento mensal
 * arredonda o mês de uma vez (como a fatura), enquanto o resumo do banco soma as quinzenas.
 */

import { somarCentavos } from "./centavos";
import { margemPermil } from "./valores";
import type { DadosDoBanco, Financeiro, ItemDeConciliacao, Valores } from "./tipos";

function somar(parcelas: readonly number[], campo: string): number {
  return parcelas.reduce((total, parcela) => somarCentavos(total, parcela, campo), 0);
}

/** Os dois blocos de `Valores` já fechados pelo núcleo (sem fatura / com fatura). */
export function comporFinanceiro(
  consolidado: Valores,
  aFaturar: Valores,
  jaFaturado: Valores,
  banco: DadosDoBanco,
): Financeiro {
  const adicionaisCentavos = somar(
    banco.adicionais.map((a) => a.valorCentavos),
    "adicionais",
  );
  const adicionaisPendentes = somar(
    banco.adicionais.filter((a) => a.faturaId === null).map((a) => a.valorCentavos),
    "adicionais a faturar",
  );
  const adicionaisFaturados = adicionaisCentavos - adicionaisPendentes;

  const ajusteFaturadoCentavos = banco.resumo.ajusteFaturadoCentavos;
  const ajustePrevistoCentavos = somar(
    banco.ajustesPrevistos.map((a) => a.ajusteCentavos),
    "ajuste previsto",
  );

  const apontamentosCentavos = consolidado.faturadoCentavos;
  const receitaCentavos = somar(
    [apontamentosCentavos, adicionaisCentavos, ajusteFaturadoCentavos, ajustePrevistoCentavos],
    "receita",
  );
  const custoCentavos = consolidado.custoCentavos;
  const resultadoCentavos = receitaCentavos - custoCentavos;

  return {
    apontamentosCentavos,
    adicionaisCentavos,
    ajusteFaturadoCentavos,
    ajustePrevistoCentavos,
    ajusteCentavos: somar([ajusteFaturadoCentavos, ajustePrevistoCentavos], "ajuste"),
    receitaCentavos,
    custoCentavos,
    resultadoCentavos,
    margemPermil: margemPermil(receitaCentavos, custoCentavos),
    aFaturarCentavos: somar(
      [aFaturar.faturadoCentavos, adicionaisPendentes, ajustePrevistoCentavos],
      "a faturar",
    ),
    jaFaturadoCentavos: somar(
      [jaFaturado.faturadoCentavos, adicionaisFaturados, ajusteFaturadoCentavos],
      "já faturado",
    ),
  };
}

function item(
  codigo: ItemDeConciliacao["codigo"],
  fechamentoCentavos: number,
  bancoCentavos: number,
): ItemDeConciliacao {
  return {
    codigo,
    fechamentoCentavos,
    bancoCentavos,
    confere: fechamentoCentavos === bancoCentavos,
  };
}

/**
 * Compara o Fechamento com `resumo_financeiro_periodo`, parcela a parcela. O "a faturar" é
 * comparado SEM o ajuste previsto, que tem item próprio: assim uma diferença do arredondamento
 * mensal aparece uma vez só, no item certo.
 */
export function conciliar(financeiro: Financeiro, banco: DadosDoBanco): ItemDeConciliacao[] {
  const { resumo } = banco;
  const aFaturarSemAjuste = financeiro.aFaturarCentavos - financeiro.ajustePrevistoCentavos;
  const itensDeAjusteFaturado = somar(
    banco.ajustesFaturados.map((a) => a.valorCentavos),
    "ajustes faturados",
  );

  return [
    item("apontamentos", financeiro.apontamentosCentavos, resumo.receitaApontamentosCentavos),
    item("adicionais", financeiro.adicionaisCentavos, resumo.adicionaisCentavos),
    item("ajuste-faturado", itensDeAjusteFaturado, resumo.ajusteFaturadoCentavos),
    item("ajuste-previsto", financeiro.ajustePrevistoCentavos, resumo.ajustePrevistoCentavos),
    item("a-faturar", aFaturarSemAjuste, resumo.aFaturarCentavos - resumo.ajustePrevistoCentavos),
    item("faturado", financeiro.jaFaturadoCentavos, resumo.faturadoCentavos),
  ];
}
