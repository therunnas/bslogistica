/**
 * Conciliação da receita (C05-B8.17, migration 030).
 *
 * Fonte única: o banco (`resumo_financeiro_periodo`). Nada aqui calcula receita, arredondamento ou
 * ajuste: este módulo só lê a resposta da RPC e dá nome às parcelas, para que Dashboard e
 * Relatórios mostrem os mesmos números, com o mesmo nome, que o Faturamento e a fatura.
 *
 * VOCABULÁRIO (cada nome significa uma coisa só):
 *
 *   Receita dos apontamentos   Σ cobrado dos apontamentos do período
 *   Adicionais                 adicionais de serviço não cancelados dentro do período
 *   Ajuste de arredondamento   diferença do arredondamento acumulado (contratos em modo acumulado):
 *                                faturado = já está em fatura; previsto = fechamento ainda sem fatura
 *   Receita                    apontamentos + adicionais + ajuste de arredondamento
 *   A faturar                  o que ainda não está em fatura (inclui o ajuste previsto)
 *   Faturado                   total das faturas emitidas no período
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

export interface ResumoFinanceiro {
  receitaApontamentos: number;
  adicionais: number;
  ajusteFaturado: number;
  ajustePrevisto: number;
  receita: number;
  aFaturar: number;
  faturado: number;
  /** Falso com filtro de operação: o ajuste é por colaborador, não por operação. */
  ajusteAplicavel: boolean;
}

const numero = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

/**
 * Lê a linha devolvida pela RPC. Resposta fora do formato é recusada (nulo): a tela nunca
 * inventa um total a partir de dado incompleto.
 */
export function lerResumoFinanceiro(linha: unknown): ResumoFinanceiro | null {
  if (typeof linha !== "object" || linha === null || Array.isArray(linha)) return null;
  const r = linha as Record<string, unknown>;
  const campos = [
    numero(r["receita_apontamentos"]),
    numero(r["adicionais"]),
    numero(r["ajuste_faturado"]),
    numero(r["ajuste_previsto"]),
    numero(r["receita_total"]),
    numero(r["a_faturar"]),
    numero(r["faturado"]),
  ];
  if (campos.some((c) => c === null) || typeof r["ajuste_aplicavel"] !== "boolean") return null;
  const [
    receitaApontamentos,
    adicionais,
    ajusteFaturado,
    ajustePrevisto,
    receita,
    aFaturar,
    faturado,
  ] = campos as number[];
  return {
    receitaApontamentos: receitaApontamentos as number,
    adicionais: adicionais as number,
    ajusteFaturado: ajusteFaturado as number,
    ajustePrevisto: ajustePrevisto as number,
    receita: receita as number,
    aFaturar: aFaturar as number,
    faturado: faturado as number,
    ajusteAplicavel: r["ajuste_aplicavel"],
  };
}

/** Ajuste de arredondamento total (faturado + previsto), em centavos inteiros. */
export function ajusteTotal(r: ResumoFinanceiro): number {
  return (Math.round(r.ajusteFaturado * 100) + Math.round(r.ajustePrevisto * 100)) / 100;
}

/** A receita bate com as parcelas? Conferência da própria tela, em centavos. */
export function parcelasFecham(r: ResumoFinanceiro): boolean {
  const soma =
    Math.round(r.receitaApontamentos * 100) +
    Math.round(r.adicionais * 100) +
    Math.round(r.ajusteFaturado * 100) +
    Math.round(r.ajustePrevisto * 100);
  return soma === Math.round(r.receita * 100);
}

/** Texto das parcelas, igual em Dashboard e Relatórios. */
export function descricaoDaReceita(r: ResumoFinanceiro, brl: (valor: number) => string): string {
  const base = `Apontamentos ${brl(r.receitaApontamentos)} + adicionais ${brl(r.adicionais)}`;
  if (!r.ajusteAplicavel) return `${base} (arredondamento acumulado não se aplica por operação)`;
  const ajuste = ajusteTotal(r);
  return ajuste === 0 ? base : `${base} + arredondamento ${brl(ajuste)}`;
}
