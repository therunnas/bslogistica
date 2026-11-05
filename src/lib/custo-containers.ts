/**
 * Custo dos serviços de Containers para a margem do Dashboard e dos Relatórios (achado I).
 *
 * A receita dessas telas vem de `resumo_financeiro_periodo`, que já inclui os adicionais de
 * serviço, e os Containers geram um adicional. O custo, porém, só somava os apontamentos: a
 * margem do período ficava superestimada. Este módulo soma o custo que faltava.
 *
 * REGRAS (apresentação/agregação, nada persistido muda):
 *   - O custo de um serviço é `cost_total_cents` do próprio serviço. Os custos por participante
 *     somam exatamente esse valor e NÃO entram de novo: seria duplicidade.
 *   - Entram os serviços não cancelados executados dentro do período, o mesmo critério do
 *     adicional de receita (`period_start/period_end` = data da execução).
 *   - A soma é em centavos inteiros e só no fim vira reais.
 *   - Não calcula receita, fatura nem Fechamento. A fatura já soma o custo do serviço uma vez.
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

export interface ServicoComCusto {
  id: string;
  client_id: string;
  operation_id: string | null;
  executed_on: string;
  cost_total_cents: number;
  canceled_at: string | null;
}

function dentroDoPeriodo(s: ServicoComCusto, inicio: string, fim: string): boolean {
  return (
    inicio <= fim &&
    s.canceled_at === null &&
    s.executed_on >= inicio &&
    s.executed_on <= fim &&
    Number.isSafeInteger(s.cost_total_cents) &&
    s.cost_total_cents >= 0
  );
}

/** Custo total dos serviços ativos executados no período, em reais. */
export function somarCustoDeContainers(
  servicos: readonly ServicoComCusto[],
  inicio: string,
  fim: string,
): number {
  let centavos = 0;
  for (const s of servicos) if (dentroDoPeriodo(s, inicio, fim)) centavos += s.cost_total_cents;
  return centavos / 100;
}

const CODIGOS_SEM_CONTAINERS = ["42P01", "PGRST205"];

/**
 * Banco sem a migration 045 (Production na 034): a tabela não existe. Não é falha de leitura:
 * não há serviço de Containers, logo não há custo a somar.
 */
export function ehSchemaSemContainers(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let i = 0; i < 4 && atual !== null && typeof atual === "object"; i += 1) {
    const e = atual as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.code === "string" && CODIGOS_SEM_CONTAINERS.includes(e.code)) return true;
    if (
      typeof e.message === "string" &&
      /container_services/.test(e.message) &&
      /schema cache|does not exist/i.test(e.message)
    ) {
      return true;
    }
    atual = e.cause;
  }
  return false;
}
