/**
 * Escrita da superfície operacional AAL1.
 *
 * Um caminho só: `salvar_apontamento_operacional`. Não há mutation de exclusão
 * — a superfície não tem DELETE —, nem de fechar ou reabrir folha, que é ato
 * administrativo.
 *
 * Depois do sucesso, invalida **apenas** os apontamentos daquele par
 * operação/turno e data. Operações, turnos e equipe não mudam por conta de uma
 * gravação de apontamento, e derrubar o cache inteiro custaria quatro
 * requisições para nada.
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { chavesOperacionais } from "./chaves";
import { clienteOperacional } from "./queries";
import { salvarApontamentoOperacional } from "./rpc";
import type { EscritaDoApontamento } from "./tipos";

export function useSalvarApontamentoOperacional() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (escrita: EscritaDoApontamento) =>
      salvarApontamentoOperacional(clienteOperacional(), escrita),
    onSuccess: (_folhaId, { operationId, shiftId, workDate }) => {
      queryClient.invalidateQueries({
        queryKey: chavesOperacionais.apontamentos(operationId, shiftId, workDate),
      });
    },
  });
}
