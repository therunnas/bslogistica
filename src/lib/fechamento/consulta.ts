/**
 * As opções do TanStack Query para o Fechamento.
 *
 * Ficam aqui, e não no hook, para a suíte exercitar o comportamento REAL do
 * TanStack (chave, cancelamento, `enabled`) com um `QueryClient` de verdade e um
 * `fetch` falso, sem renderizar React. `useFechamento` (`_hooks.ts`) só entrega
 * estas opções ao `useQuery`.
 *
 *  - a chave leva cliente e período: trocar qualquer um é uma consulta nova, e a
 *    anterior, ainda em voo, é cancelada pelo `AbortSignal` que a `queryFn`
 *    repassa ao `fetch`;
 *  - só executa com filtros aplicados (`null` = ainda não pediu);
 *  - `staleTime: 0` e `gcTime: 0`: o fechamento reflete apontamento e fatura no
 *    instante seguinte, então nada fica em cache de uma visita para a outra;
 *  - sem refetch automático por foco ou reconexão: uma consulta pode ter dezenas
 *    de páginas, e quem decide atualizar é o usuário (botão "Atualizar");
 *  - sem retentativa silenciosa: o erro aparece, com "Tentar novamente".
 */

import { buscarFechamento, type FiltrosDaBusca, type OpcoesDaBusca } from "./buscar";

export const RAIZ_DA_CHAVE_DO_FECHAMENTO = "fechamento";

export function chaveDoFechamento(filtros: FiltrosDaBusca | null) {
  return [
    RAIZ_DA_CHAVE_DO_FECHAMENTO,
    filtros?.clienteId ?? null,
    filtros?.inicio ?? null,
    filtros?.fim ?? null,
  ] as const;
}

export function opcoesDoFechamento(filtros: FiltrosDaBusca | null, busca: OpcoesDaBusca = {}) {
  return {
    queryKey: chaveDoFechamento(filtros),
    enabled: filtros !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (filtros === null) throw new Error("Fechamento consultado sem filtros.");
      return buscarFechamento(filtros, { ...busca, signal });
    },
  };
}
