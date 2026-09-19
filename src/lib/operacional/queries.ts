/**
 * Hooks de leitura da superfície operacional AAL1.
 *
 * Fonte de dados própria, e não os hooks de `src/lib/queries.ts`: o papel
 * decide de ONDE a tela lê, não quais campos ela esconde. Os hooks
 * administrativos leem as tabelas direto e trazem coluna que o operador não
 * pode ver; aqui só entram as RPCs da migration 013.
 *
 * As três leituras dependentes só disparam com os identificadores do passo
 * anterior em mãos — operação, depois turno, depois data. Sem isso a chamada
 * iria ao banco com parâmetro vazio e voltaria como erro, transformando um
 * estado normal da tela ("ainda não escolheu o turno") em falha.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";

import { chavesOperacionais } from "./chaves";
import {
  buscarApontamentosDoOperador,
  buscarEquipeDoOperador,
  buscarOperacoesDoOperador,
  buscarTurnosDoOperador,
  comoClienteOperacional,
  podeListarApontamentos,
  podeListarEquipe,
  podeListarTurnos,
} from "./rpc";

/** O cliente do navegador, na forma que esta camada consome. */
export const clienteOperacional = () => comoClienteOperacional(criarClienteNavegador());

/** Operações atribuídas à sessão. É o primeiro passo do fluxo. */
export function useOperacoesDoOperador() {
  return useQuery({
    queryKey: chavesOperacionais.operacoes(),
    queryFn: () => buscarOperacoesDoOperador(clienteOperacional()),
  });
}

/**
 * Turnos da operação escolhida.
 *
 * Operação sem turno devolve lista vazia, e é assim que a tela distingue
 * "nenhum turno configurado" de erro — a RPC de escrita exige `shift_id`, então
 * não existe fluxo de apontamento sem turno.
 */
export function useTurnosDoOperador(operationId: string | null) {
  return useQuery({
    queryKey: chavesOperacionais.turnos(operationId),
    queryFn: () => buscarTurnosDoOperador(clienteOperacional(), operationId as string),
    enabled: podeListarTurnos(operationId),
  });
}

/** Equipe alocada ao par operação/turno, incluindo quem está inativo. */
export function useEquipeDoOperador(operationId: string | null, shiftId: string | null) {
  return useQuery({
    queryKey: chavesOperacionais.equipe(operationId, shiftId),
    queryFn: () =>
      buscarEquipeDoOperador(clienteOperacional(), operationId as string, shiftId as string),
    enabled: podeListarEquipe(operationId, shiftId),
  });
}

/** Folha e linhas do par operação/turno numa data. */
export function useApontamentosDoOperador(
  operationId: string | null,
  shiftId: string | null,
  workDate: string | null,
) {
  return useQuery({
    queryKey: chavesOperacionais.apontamentos(operationId, shiftId, workDate),
    queryFn: () =>
      buscarApontamentosDoOperador(
        clienteOperacional(),
        operationId as string,
        shiftId as string,
        workDate as string,
      ),
    enabled: podeListarApontamentos(operationId, shiftId, workDate),
  });
}
