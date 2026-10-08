/**
 * Alertas de domínio do Fechamento.
 *
 * Alertas SÓ SINALIZAM. Nenhum altera um valor, corrige um dado ou tira uma
 * linha dos totais — o relatório continua batendo com `gerar_fatura`, que
 * também não olha status de folha nem contrato. Quem lê o alerta decide o que
 * fazer, na origem.
 *
 * Os alertas de pendência (folha aberta, dado incompleto, contrato, diária
 * zerada) olham apenas lançamentos que geram valor (`present` e `replacement`).
 * A falta é informativa e tem o seu.
 *
 * Saem em ordem fixa, e só os que têm ocorrência.
 */

import type { Alerta, CodigoDeAlerta, LinhaNormalizada, SeveridadeDoAlerta } from "./tipos";

const ORDEM: readonly { codigo: CodigoDeAlerta; severidade: SeveridadeDoAlerta }[] = [
  { codigo: "duplicidade", severidade: "critico" },
  { codigo: "folha-aberta", severidade: "atencao" },
  { codigo: "dado-incompleto", severidade: "atencao" },
  { codigo: "sem-contrato", severidade: "atencao" },
  { codigo: "diaria-zerada", severidade: "atencao" },
  { codigo: "falta", severidade: "informacao" },
];

const porId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Lançamentos que geram valor e aparecem em mais de um registro para o mesmo
 * colaborador, operação e data. O banco proíbe isso por índice único; aparecer
 * aqui significa que o índice real em Production é mais frouxo que o do
 * repositório, ou que um dado entrou por fora.
 */
function emDuplicidade(financeiras: readonly LinhaNormalizada[]): LinhaNormalizada[] {
  const grupos = new Map<string, LinhaNormalizada[]>();
  for (const linha of financeiras) {
    const chave = JSON.stringify([linha.employeeId, linha.operationId, linha.workDate]);
    const grupo = grupos.get(chave);
    if (grupo === undefined) grupos.set(chave, [linha]);
    else grupo.push(linha);
  }
  return [...grupos.values()].filter((grupo) => grupo.length > 1).flat();
}

export function detectarAlertas(linhas: readonly LinhaNormalizada[]): Alerta[] {
  const financeiras = linhas.filter((linha) => linha.status !== "absent");

  const afetadas: Record<CodigoDeAlerta, LinhaNormalizada[]> = {
    duplicidade: emDuplicidade(financeiras),
    "folha-aberta": financeiras.filter((linha) => linha.situacaoDaFolha === "open"),
    "dado-incompleto": financeiras.filter(
      (linha) =>
        linha.checkIn === null || linha.checkOut === null || linha.minutosTrabalhados === 0,
    ),
    "sem-contrato": financeiras.filter((linha) => linha.contractId === null),
    "diaria-zerada": financeiras.filter((linha) => linha.diariaSnapshotCentavos === 0),
    falta: linhas.filter((linha) => linha.status === "absent"),
  };

  const alertas: Alerta[] = [];
  for (const { codigo, severidade } of ORDEM) {
    const lista = afetadas[codigo];
    if (lista.length === 0) continue;
    alertas.push({
      codigo,
      severidade,
      quantidade: lista.length,
      entryIds: lista.map((linha) => linha.entryId).sort(porId),
    });
  }
  return alertas;
}
