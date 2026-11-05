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
 * Dashboard e dos Relatórios. Mesmo critério do adicional de receita: não cancelados, executados
 * no período. Banco sem a 045 devolve lista vazia, não erro. Nenhuma escrita, nenhuma RPC.
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

/** Lê os serviços do período. Banco sem a 045 (Production na 034) devolve lista vazia. */
export async function lerServicosDoPeriodo(
  db: ClienteDeLeitura,
  inicio: string,
  fim: string,
): Promise<ServicoComCusto[]> {
  const colunas = "id, client_id, operation_id, executed_on, cost_total_cents, canceled_at";
  // Sondagem de uma linha ANTES de paginar. Num banco sem a 045 (Production na 034) o GET devolve
  // 404/PGRST205, mas o HEAD de contagem devolve 204 sem erro e com count nulo: o paginador
  // lançaria CONTAGEM_INVALIDA. Medido em banco restaurado do backup de Production.
  const sonda = await db.from("container_services").select("id").limit(1);
  if (sonda.error) {
    if (ehSchemaSemContainers(sonda.error)) return [];
    throw sonda.error;
  }
  try {
    return await lerConsultaPaginada<ServicoComCusto>(
      ({ depoisDe, limite }) => {
        let q = db
          .from("container_services")
          .select<ServicoComCusto>(colunas)
          .gte("executed_on", inicio)
          .lte("executed_on", fim)
          .is("canceled_at", null);
        if (depoisDe !== null) q = q.gt("id", depoisDe);
        return q.order("id", { ascending: true }).limit(limite);
      },
      () =>
        db
          .from("container_services")
          .select("id", { count: "exact", head: true })
          .gte("executed_on", inicio)
          .lte("executed_on", fim)
          .is("canceled_at", null),
    );
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
