"use client";

/**
 * Hook de leitura do Fechamento — camada fina sobre `GET /api/fechamento`.
 *
 * Nenhum acesso direto ao Supabase: a leitura, a RLS e o cálculo estão do outro
 * lado da API. As regras de quando buscar, de cancelamento e de cache moram em
 * `@/lib/fechamento/consulta`, onde a suíte as exercita com o TanStack de
 * verdade; aqui só se entrega essas opções ao `useQuery`.
 */

import { useQuery } from "@tanstack/react-query";

import type { FiltrosDaBusca } from "@/lib/fechamento/buscar";
import { opcoesDoFechamento } from "@/lib/fechamento/consulta";

export function useFechamento(filtros: FiltrosDaBusca | null) {
  return useQuery(opcoesDoFechamento(filtros));
}
