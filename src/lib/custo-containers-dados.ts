import { useQuery } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { ehSchemaSemContainers, type ServicoComCusto } from "@/lib/custo-containers";
import { lerConsultaPaginada } from "@/lib/paginacao";

/**
 * Leitura (só leitura) dos serviços de Containers do período, para somar o custo à margem do
 * Dashboard e dos Relatórios. Mesmo critério do adicional de receita: não cancelados, executados
 * no período. Banco sem a 045 devolve lista vazia, não erro. Nenhuma escrita, nenhuma RPC.
 */
interface ConsultaDeServicos extends PromiseLike<{
  data: ServicoComCusto[] | null;
  error: { message: string } | null;
  count?: number | null;
}> {
  gte(coluna: string, valor: string): ConsultaDeServicos;
  lte(coluna: string, valor: string): ConsultaDeServicos;
  is(coluna: string, valor: null): ConsultaDeServicos;
  gt(coluna: string, valor: string): ConsultaDeServicos;
  order(coluna: string, opcoes: { ascending: boolean }): ConsultaDeServicos;
  limit(quantidade: number): ConsultaDeServicos;
}

/** `container_services` ainda não está nos tipos gerados do banco: leitura tipada à mão. */
export interface ClienteDeLeitura {
  from(tabela: string): {
    select(colunas: string, opcoes?: { count?: "exact"; head?: boolean }): ConsultaDeServicos;
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
          .select(colunas)
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

export function useCustoDeContainers(inicio: string, fim: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE_DO_CUSTO_DE_CONTAINERS, inicio, fim],
    enabled: habilitado && inicio !== "" && fim !== "" && inicio <= fim,
    queryFn: (): Promise<ServicoComCusto[]> =>
      lerServicosDoPeriodo(criarClienteNavegador() as unknown as ClienteDeLeitura, inicio, fim),
  });
}
