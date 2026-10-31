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
 * Cliente (id e nome) e período, mais, para CADA lançamento lido (faltas
 * inclusive, porque uma falta que vira presença muda o relatório): id,
 * colaborador, operação, data, status, status da folha, fatura, faturado, custo
 * e taxa em centavos, minutos trabalhados e extras, horário e contrato — e os
 * TEXTOS que a tela e os arquivos mostram: nome do colaborador, função,
 * operação e turno, já normalizados (os mesmos que vão para o CSV e o XLSX).
 *
 * Os textos entram porque o download deve ser exatamente o que a tela mostrou:
 * se um colaborador foi renomeado entre uma coisa e outra, o arquivo seria
 * outro com a mesma assinatura. Na versão anterior (`fechamento-v1`) eles ficavam
 * de fora, por serem "puramente visuais"; isso foi corrigido na `v2`.
 *
 * O QUE NÃO ENTRA
 *
 * `geradoEm` (muda a cada carga) e tudo que não aparece na tela nem nos
 * arquivos, como ids de turno. A assinatura que vai ao navegador é só o hash:
 * nenhum desses textos sai do servidor por ela.
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

import type { DadosDoBanco, LinhaNormalizada } from "./tipos";

/** Mude ao alterar o material assinado: assinaturas antigas deixam de bater. */
export const VERSAO_DA_ASSINATURA = "fechamento-v3";

export interface EntradaDaAssinatura {
  clienteId: string;
  /** O nome que aparece no Resumo e no nome do arquivo. */
  clienteNome: string;
  inicio: string;
  fim: string;
  linhas: readonly LinhaNormalizada[];
  /** O que o banco devolveu além dos lançamentos: também faz parte do snapshot financeiro. */
  banco: DadosDoBanco;
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
    linha.minutosExtrasCobrados,
    linha.tipoDoDia,
    linha.checkIn,
    linha.checkOut,
    linha.contractId,
    linha.colaborador,
    linha.funcao,
    linha.operacao,
    linha.turno,
    // FIN-PR-03: componentes só entram na assinatura quando são dado gravado (V2). O legado é
    // derivado do cobrado e da diária, que já estão acima, e a assinatura dele não muda.
    ...(linha.versaoDoCalculo === 2
      ? [
          2,
          linha.diariaCentavos,
          linha.extraCentavos,
          linha.especialCentavos,
          linha.adicionalDiarioCentavos,
        ]
      : []),
  ];
}

/** O texto exato que é assinado. Exportado para os testes olharem para ele. */
const porTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Os números do banco, em ordem canônica: sem ela, a assinatura dependeria da ordem de leitura. */
function tuplaDoBanco(banco: DadosDoBanco) {
  const r = banco.resumo;
  return [
    [
      r.receitaApontamentosCentavos,
      r.adicionaisCentavos,
      r.ajusteFaturadoCentavos,
      r.ajustePrevistoCentavos,
      r.receitaTotalCentavos,
      r.aFaturarCentavos,
      r.faturadoCentavos,
      r.ajusteAplicavel,
    ],
    [...banco.ajustesPrevistos]
      .sort(
        (a, b) => porTexto(a.employeeId, b.employeeId) || a.valorHoraCentavos - b.valorHoraCentavos,
      )
      .map((a) => [
        a.employeeId,
        a.colaborador,
        a.valorHoraCentavos,
        a.minutosBrutos,
        a.minutosArredondados,
        a.valorBrutoCentavos,
        a.valorArredondadoCentavos,
        a.ajusteCentavos,
      ]),
    [...banco.ajustesFaturados]
      .sort((a, b) => porTexto(a.faturaId, b.faturaId) || porTexto(a.descricao, b.descricao))
      .map((a) => [a.faturaId, a.descricao, a.valorCentavos]),
    [...banco.adicionais]
      .sort((a, b) => porTexto(a.id, b.id))
      .map((a) => [
        a.id,
        a.descricao,
        a.referencia,
        a.operacaoId,
        a.inicio,
        a.fim,
        a.valorCentavos,
        a.faturaId,
      ]),
    [...banco.saldoDeHoras]
      .sort((a, b) => porTexto(a.employeeId, b.employeeId))
      .map((a) => [
        a.employeeId,
        a.colaborador,
        a.apontamentos,
        a.minutosExcedentes,
        a.minutosFaltantes,
        a.saldoMinutos,
      ]),
  ];
}

export function serializarParaAssinatura(entrada: EntradaDaAssinatura): string {
  const ordenadas = [...entrada.linhas].sort((a, b) =>
    a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0,
  );

  return JSON.stringify([
    VERSAO_DA_ASSINATURA,
    entrada.clienteId,
    entrada.clienteNome,
    entrada.inicio,
    entrada.fim,
    ordenadas.map(tupla),
    tuplaDoBanco(entrada.banco),
  ]);
}

/** SHA-256 em hexadecimal minúsculo (64 caracteres). */
export function assinarFechamento(entrada: EntradaDaAssinatura): string {
  return createHash("sha256").update(serializarParaAssinatura(entrada), "utf8").digest("hex");
}
