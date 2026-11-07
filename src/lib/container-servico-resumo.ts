/**
 * Resumo de um serviço de containers para a listagem (UX-SIMPLIFICACAO-01). Só apresentação, em
 * centavos inteiros: o valor negociado é o TOTAL cobrado pelo serviço (não por container) e o resultado
 * bruto é receita menos o custo dos participantes. Nenhum valor é recalculado para gravação.
 */
export interface ServicoParaResumo {
  quantity: number;
  revenue_cents: number;
  cost_total_cents: number;
  situacao: "disponivel" | "faturado" | "cancelado";
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function resumoDoServico(s: ServicoParaResumo) {
  const resultadoCentavos = s.revenue_cents - s.cost_total_cents;
  return {
    valorNegociado: `${reais(s.revenue_cents)} no total · ${s.quantity} ${s.quantity === 1 ? "container" : "containers"}`,
    custo: reais(s.cost_total_cents),
    resultadoCentavos,
    resultado: reais(resultadoCentavos),
    negativo: resultadoCentavos < 0,
    situacao:
      s.situacao === "disponivel"
        ? "Disponível para faturar"
        : s.situacao === "faturado"
          ? "Faturado"
          : "Cancelado",
  };
}
