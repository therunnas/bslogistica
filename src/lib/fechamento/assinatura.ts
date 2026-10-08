/**
 * Assinatura do snapshot financeiro: SHA-256 sobre uma serialização canônica.
 *
 * A tela guarda a assinatura dos dados que mostrou. Na hora de baixar o XLSX,
 * o servidor relê, assina de novo e compara: se divergir, algo mudou entre a
 * tela e o download (um apontamento editado, uma fatura gerada) e o arquivo não
 * é entregue. A assinatura NÃO é segurança contra o navegador: é conferência de
 * frescor. Nenhum valor financeiro viaja do cliente para o servidor.
 *
 * O QUE ENTRA
 *
 * Cliente e período, mais, para CADA lançamento lido (faltas inclusive, porque
 * uma falta que vira presença muda o relatório): id, colaborador, operação,
 * data, status, status da folha, fatura, faturado, custo e taxa em centavos,
 * minutos trabalhados e extras, horário e contrato. É tudo que influencia um
 * número, um agrupamento ou um alerta.
 *
 * O QUE NÃO ENTRA
 *
 * `geradoEm` (muda a cada carga) e texto puramente visual — nome do colaborador,
 * da operação, do turno, função. Renomear alguém não muda um centavo do
 * fechamento e não deve invalidar o download.
 *
 * COMO É CANÔNICA
 *
 * Lançamentos em ordem estrita de `entryId`, cada um como uma TUPLA de posição
 * fixa (não um objeto, cuja ordem de chaves é incidental), dentro de uma
 * lista versionada. A ordem de entrada não importa.
 *
 * Servidor apenas: usa `node:crypto`. Este módulo não é importado pela tela.
 */

import { createHash } from "node:crypto";

import type { LinhaNormalizada } from "./tipos";

/** Mude ao alterar o material assinado: assinaturas antigas deixam de bater. */
export const VERSAO_DA_ASSINATURA = "fechamento-v1";

export interface EntradaDaAssinatura {
  clienteId: string;
  inicio: string;
  fim: string;
  linhas: readonly LinhaNormalizada[];
}

function tupla(linha: LinhaNormalizada) {
  return [
    linha.entryId,
    linha.employeeId,
    linha.operationId,
    linha.workDate,
    linha.status,
    linha.situacaoDaFolha,
    linha.invoiceId,
    linha.faturadoCentavos,
    linha.custoCentavos,
    linha.diariaSnapshotCentavos,
    linha.minutosTrabalhados,
    linha.minutosExtras,
    linha.checkIn,
    linha.checkOut,
    linha.contractId,
  ];
}

/** O texto exato que é assinado. Exportado para os testes olharem para ele. */
export function serializarParaAssinatura(entrada: EntradaDaAssinatura): string {
  const ordenadas = [...entrada.linhas].sort((a, b) =>
    a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0,
  );

  return JSON.stringify([
    VERSAO_DA_ASSINATURA,
    entrada.clienteId,
    entrada.inicio,
    entrada.fim,
    ordenadas.map(tupla),
  ]);
}

/** SHA-256 em hexadecimal minúsculo (64 caracteres). */
export function assinarFechamento(entrada: EntradaDaAssinatura): string {
  return createHash("sha256").update(serializarParaAssinatura(entrada), "utf8").digest("hex");
}
