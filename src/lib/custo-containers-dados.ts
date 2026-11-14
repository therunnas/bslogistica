import { useQuery } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import {
  ehSchemaSemContainers,
  type ServicoComCusto,
  type ServicoDoAdicional,
} from "@/lib/custo-containers";
import { lerConsultaPaginada } from "@/lib/paginacao";

/**
 * Leitura (só leitura) dos serviços de Containers do período, para somar o custo à margem do
 * Dashboard e dos Relatórios. Mesmo critério da receita do adicional: não cancelados, com a janela
 * de cobrança (competência ou execução) dentro do período. Banco sem a 045 devolve lista vazia,
 * não erro. Nenhuma escrita, nenhuma RPC.
 */
interface ConsultaDeServicos<T> extends PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}> {
  eq(coluna: string, valor: string): ConsultaDeServicos<T>;
  gte(coluna: string, valor: string): ConsultaDeServicos<T>;
  lte(coluna: string, valor: string): ConsultaDeServicos<T>;
  is(coluna: string, valor: null): ConsultaDeServicos<T>;
  gt(coluna: string, valor: string): ConsultaDeServicos<T>;
  order(coluna: string, opcoes: { ascending: boolean }): ConsultaDeServicos<T>;
  limit(quantidade: number): ConsultaDeServicos<T>;
}

/** `container_services` ainda não está nos tipos gerados do banco: leitura tipada à mão. */
export interface ClienteDeLeitura {
  from(tabela: string): {
    select<T = ServicoComCusto>(
      colunas: string,
      opcoes?: { count?: "exact"; head?: boolean },
    ): ConsultaDeServicos<T>;
  };
}

export const CHAVE_DO_CUSTO_DE_CONTAINERS = ["custo-containers"] as const;

/** Linha lida: o serviço e a janela de cobrança do adicional dele (relação 1:1, `billing_additional_id`). */
interface LinhaDeServico {
  id: string;
  client_id: string;
  operation_id: string | null;
  executed_on: string;
  cost_total_cents: number;
  canceled_at: string | null;
  billing_additionals: {
    period_start: string;
    period_end: string;
    billing_period_start: string | null;
    billing_period_end: string | null;
  } | null;
}

const COLUNAS_DOS_SERVICOS =
  "id, client_id, operation_id, executed_on, cost_total_cents, canceled_at, " +
  "billing_additionals!inner(period_start, period_end, billing_period_start, billing_period_end)";

/**
 * Lê os serviços COBRADOS no período (D-CP08-01): a janela de cobrança do adicional do serviço —
 * a competência (`billing_period_*`, 038) ou, sem ela, a execução (`period_*`) — cabe inteira no
 * período. É o critério da receita em `resumo_financeiro_periodo`; antes, a leitura filtrava pela
 * data de execução e o custo caía num período e a receita em outro. Duas consultas (com e sem
 * competência), porque o PostgREST não filtra por `coalesce`. Banco sem a 045 (Production na
 * 034) devolve lista vazia.
 */
export async function lerServicosDoPeriodo(
  db: ClienteDeLeitura,
  inicio: string,
  fim: string,
): Promise<ServicoComCusto[]> {
  // Sondagem de uma linha ANTES de paginar. Num banco sem a 045 (Production na 034) o GET devolve
  // 404/PGRST205, mas o HEAD de contagem devolve 204 sem erro e com count nulo: o paginador
  // lançaria CONTAGEM_INVALIDA. Medido em banco restaurado do backup de Production.
  const sonda = await db.from("container_services").select("id").limit(1);
  if (sonda.error) {
    if (ehSchemaSemContainers(sonda.error)) return [];
    throw sonda.error;
  }
  const comCompetencia = (q: ConsultaDeServicos<LinhaDeServico>) =>
    q
      .gte("billing_additionals.billing_period_start", inicio)
      .lte("billing_additionals.billing_period_end", fim);
  const semCompetencia = (q: ConsultaDeServicos<LinhaDeServico>) =>
    q
      .is("billing_additionals.billing_period_start", null)
      .gte("billing_additionals.period_start", inicio)
      .lte("billing_additionals.period_end", fim);
  try {
    const linhas: LinhaDeServico[] = [];
    for (const filtro of [comCompetencia, semCompetencia]) {
      linhas.push(
        ...(await lerConsultaPaginada<LinhaDeServico>(
          ({ depoisDe, limite }) => {
            let q = filtro(
              db
                .from("container_services")
                .select<LinhaDeServico>(COLUNAS_DOS_SERVICOS)
                .is("canceled_at", null),
            );
            if (depoisDe !== null) q = q.gt("id", depoisDe);
            return q.order("id", { ascending: true }).limit(limite);
          },
          () =>
            filtro(
              db
                .from("container_services")
                .select<LinhaDeServico>(COLUNAS_DOS_SERVICOS, { count: "exact", head: true })
                .is("canceled_at", null),
            ),
        )),
      );
    }
    return linhas.map((l) => {
      const a = l.billing_additionals;
      return {
        id: l.id,
        client_id: l.client_id,
        operation_id: l.operation_id,
        executed_on: l.executed_on,
        cost_total_cents: l.cost_total_cents,
        canceled_at: l.canceled_at,
        cobranca_inicio: a?.billing_period_start ?? a?.period_start ?? l.executed_on,
        cobranca_fim: a?.billing_period_end ?? a?.period_end ?? l.executed_on,
      };
    });
  } catch (erro) {
    if (ehSchemaSemContainers(erro)) return [];
    throw erro;
  }
}

/**
 * Serviços NÃO cancelados de um cliente, com o adicional a que pertencem (prévia do Faturamento).
 * Mesma sondagem para o schema 034.
 */
export async function lerServicosDoCliente(
  db: ClienteDeLeitura,
  clienteId: string,
): Promise<ServicoDoAdicional[]> {
  const colunas = "id, billing_additional_id, cost_total_cents";
  const sonda = await db.from("container_services").select("id").limit(1);
  if (sonda.error) {
    if (ehSchemaSemContainers(sonda.error)) return [];
    throw sonda.error;
  }
  const linhas = await lerConsultaPaginada<ServicoDoAdicional & { id: string }>(
    ({ depoisDe, limite }) => {
      let q = db
        .from("container_services")
        .select<ServicoDoAdicional & { id: string }>(colunas)
        .eq("client_id", clienteId)
        .is("canceled_at", null);
      if (depoisDe !== null) q = q.gt("id", depoisDe);
      return q.order("id", { ascending: true }).limit(limite);
    },
    () =>
      db
        .from("container_services")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clienteId)
        .is("canceled_at", null),
  );
  return linhas;
}

export function useCustoDeContainersDoCliente(clienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DO_CUSTO_DE_CONTAINERS, "cliente", clienteId],
    enabled: habilitado && clienteId !== "",
    queryFn: (): Promise<ServicoDoAdicional[]> =>
      lerServicosDoCliente(criarClienteNavegador() as unknown as ClienteDeLeitura, clienteId),
  });
}

export function useCustoDeContainers(inicio: string, fim: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DO_CUSTO_DE_CONTAINERS, inicio, fim],
    enabled: habilitado && inicio !== "" && fim !== "" && inicio <= fim,
    queryFn: (): Promise<ServicoComCusto[]> =>
      lerServicosDoPeriodo(criarClienteNavegador() as unknown as ClienteDeLeitura, inicio, fim),
  });
}
