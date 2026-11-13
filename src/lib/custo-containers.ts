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
 *   - Entram os serviços não cancelados cuja JANELA DE COBRANÇA cabe inteira no período: a
 *     competência do adicional do serviço (`billing_period_start/end`, migration 038) ou, sem
 *     competência, a execução (`period_start/end`). É o MESMO critério da receita desse adicional
 *     em `resumo_financeiro_periodo`, e o do Fechamento e da fatura (custo dos adicionais do
 *     recorte). D-CP08-01 (QA-BS-01): antes contava a data de EXECUÇÃO; um serviço executado num
 *     período e cobrado em outro punha o custo num lugar e a receita em outro.
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
  /** Janela de cobrança do adicional do serviço: competência ou, sem ela, execução. */
  cobranca_inicio: string;
  cobranca_fim: string;
}

function dentroDoPeriodo(s: ServicoComCusto, inicio: string, fim: string): boolean {
  return (
    inicio <= fim &&
    s.canceled_at === null &&
    s.cobranca_inicio >= inicio &&
    s.cobranca_fim <= fim &&
    Number.isSafeInteger(s.cost_total_cents) &&
    s.cost_total_cents >= 0
  );
}

/** Custo total dos serviços ativos cobrados no período (pela janela de cobrança), em reais. */
export function somarCustoDeContainers(
  servicos: readonly ServicoComCusto[],
  inicio: string,
  fim: string,
): number {
  let centavos = 0;
  for (const s of servicos) if (dentroDoPeriodo(s, inicio, fim)) centavos += s.cost_total_cents;
  return centavos / 100;
}

export interface ServicoDoAdicional {
  billing_additional_id: string;
  cost_total_cents: number;
}

/**
 * Custo dos serviços ligados aos adicionais dados (a prévia do Faturamento): o adicional é quem
 * decide o recorte, como na fatura. Cada adicional tem no máximo um serviço; soma em centavos.
 */
export function somarCustoDosAdicionais(
  servicos: readonly ServicoDoAdicional[],
  adicionalIds: readonly string[],
): number {
  const ids = new Set(adicionalIds);
  let centavos = 0;
  for (const s of servicos) {
    if (
      ids.has(s.billing_additional_id) &&
      Number.isSafeInteger(s.cost_total_cents) &&
      s.cost_total_cents >= 0
    ) {
      centavos += s.cost_total_cents;
    }
  }
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
