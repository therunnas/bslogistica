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
 *   - Entram os serviços não cancelados cujo adicional, também não cancelado, tem a COMPETÊNCIA DE
 *     COBRANÇA inteira dentro do período: `coalesce(billing_period_start, period_start) >= início`
 *     e `coalesce(billing_period_end, period_end) <= fim`. É o predicado com que
 *     `resumo_financeiro_periodo` (038) reconhece a receita do mesmo adicional, e o recorte que
 *     Fechamento e prévia do Faturamento já usam (custo dos serviços dos adicionais do recorte).
 *     A data de execução fica preservada no serviço e não decide o período (S19C-DEF-005: o
 *     critério anterior, pela execução, deslocava custo e receita de quinzena). Só se o adicional
 *     não vier na leitura o serviço cai na própria data de execução, para não sumir com o custo.
 *   - A soma é em centavos inteiros e só no fim vira reais.
 *   - Não calcula receita, fatura nem Fechamento. A fatura já soma o custo do serviço uma vez.
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

/** Adicional do serviço como o PostgREST embute (`billing_additionals(...)`). */
export interface AdicionalDoServico {
  period_start: string;
  period_end: string;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  canceled_at: string | null;
}

export interface ServicoComCusto {
  id: string;
  client_id: string;
  operation_id: string | null;
  executed_on: string;
  cost_total_cents: number;
  canceled_at: string | null;
  billing_additionals?: AdicionalDoServico | null;
}

/** Competência de cobrança em que o custo do serviço é reconhecido (a mesma da receita). */
function competenciaDoServico(s: ServicoComCusto): { inicio: string; fim: string } | null {
  const a = s.billing_additionals;
  if (a === null || a === undefined) return { inicio: s.executed_on, fim: s.executed_on };
  if (a.canceled_at !== null) return null;
  return {
    inicio: a.billing_period_start ?? a.period_start,
    fim: a.billing_period_end ?? a.period_end,
  };
}

function dentroDoPeriodo(s: ServicoComCusto, inicio: string, fim: string): boolean {
  if (inicio > fim || s.canceled_at !== null) return false;
  if (!Number.isSafeInteger(s.cost_total_cents) || s.cost_total_cents < 0) return false;
  const competencia = competenciaDoServico(s);
  return competencia !== null && competencia.inicio >= inicio && competencia.fim <= fim;
}

/** Custo total dos serviços ativos cuja competência de cobrança cabe no período, em reais. */
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
