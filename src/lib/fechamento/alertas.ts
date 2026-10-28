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

import { diaDaSemana, ehMesInteiro, ehPeriodoDeFechamento } from "./periodo";
import type {
  Alerta,
  CodigoDeAlerta,
  DadosDoBanco,
  ItemDeConciliacao,
  LinhaNormalizada,
  SeveridadeDoAlerta,
} from "./tipos";

const ORDEM: readonly { codigo: CodigoDeAlerta; severidade: SeveridadeDoAlerta }[] = [
  { codigo: "duplicidade", severidade: "critico" },
  { codigo: "divergencia-conciliacao", severidade: "critico" },
  { codigo: "hora-extra-acumulada-tardia", severidade: "critico" },
  { codigo: "folha-aberta", severidade: "atencao" },
  { codigo: "dado-incompleto", severidade: "atencao" },
  { codigo: "sem-contrato", severidade: "atencao" },
  { codigo: "diaria-zerada", severidade: "atencao" },
  { codigo: "periodo-fora-de-fechamento", severidade: "atencao" },
  { codigo: "previa-por-quinzena", severidade: "atencao" },
  { codigo: "feriado-cobranca-pendente", severidade: "informacao" },
  { codigo: "domingo-regra-pendente", severidade: "informacao" },
  { codigo: "compensacao-informativa", severidade: "informacao" },
  { codigo: "falta", severidade: "informacao" },
];

/** O que o alerta precisa saber além das linhas: o banco, a conciliação e o período. */
export interface ContextoDosAlertas {
  inicio: string;
  fim: string;
  banco: DadosDoBanco;
  conciliacao: readonly ItemDeConciliacao[];
}

/**
 * Colaborador com hora extra ACUMULADA já faturada e lançamento posterior, sem fatura, também com
 * hora extra cobrada. O banco recusa faturar o resto (`validar_fechamento_acumulado`, 55000): o
 * arredondamento do acumulado seria feito duas vezes. A regra comercial para esse caso não existe;
 * o Fechamento apenas avisa. O colaborador entra pelo ajuste acumulado previsto (só quem tem
 * minutos acumulados sem fatura aparece lá).
 */
function horaExtraAcumuladaTardia(
  financeiras: readonly LinhaNormalizada[],
  banco: DadosDoBanco,
): LinhaNormalizada[] {
  const acumulados = new Set(banco.ajustesPrevistos.map((a) => a.employeeId));
  if (acumulados.size === 0) return [];
  const faturadosComExtra = new Set(
    financeiras
      .filter((l) => l.invoiceId !== null && l.minutosExtrasCobrados > 0)
      .map((l) => l.employeeId),
  );
  return financeiras.filter(
    (l) =>
      l.invoiceId === null &&
      l.minutosExtrasCobrados > 0 &&
      acumulados.has(l.employeeId) &&
      faturadosComExtra.has(l.employeeId),
  );
}

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

export function detectarAlertas(
  linhas: readonly LinhaNormalizada[],
  contexto: ContextoDosAlertas,
): Alerta[] {
  const financeiras = linhas.filter((linha) => linha.status !== "absent");
  const { banco, conciliacao } = contexto;

  const divergentes = conciliacao.filter((c) => !c.confere);
  // O Fechamento arredonda o período pedido de uma vez (como a fatura), mas o resumo do banco
  // (Dashboard e Relatórios) soma o ajuste por quinzena INTEIRA. Fora de uma quinzena — o mês, ou
  // um período personalizado — os dois diferem por construção. Só isso, e só no item do ajuste
  // previsto, é diferença esperada: vira "atenção" e nunca corrige nenhum valor.
  const ehQuinzena =
    ehPeriodoDeFechamento(contexto.inicio, contexto.fim) &&
    !ehMesInteiro(contexto.inicio, contexto.fim);
  const previaDifereDeConstrucao = !ehQuinzena;
  const divergenciaGrave = divergentes.filter(
    (c) => !(previaDifereDeConstrucao && c.codigo === "ajuste-previsto"),
  );
  const diferencaDePrevia = divergentes.filter(
    (c) => previaDifereDeConstrucao && c.codigo === "ajuste-previsto",
  );

  const afetadas: Record<CodigoDeAlerta, LinhaNormalizada[]> = {
    duplicidade: emDuplicidade(financeiras),
    "folha-aberta": financeiras.filter((linha) => linha.situacaoDaFolha === "open"),
    "dado-incompleto": financeiras.filter(
      (linha) =>
        linha.checkIn === null || linha.checkOut === null || linha.minutosTrabalhados === 0,
    ),
    "sem-contrato": financeiras.filter((linha) => linha.contractId === null),
    "diaria-zerada": financeiras.filter((linha) => linha.diariaSnapshotCentavos === 0),
    // Sem lançamento associado: a divergência é do conjunto, não de uma linha.
    "divergencia-conciliacao": [],
    "hora-extra-acumulada-tardia": horaExtraAcumuladaTardia(financeiras, banco),
    "periodo-fora-de-fechamento": [],
    "previa-por-quinzena": [],
    "feriado-cobranca-pendente": financeiras.filter((linha) => linha.tipoDoDia === "feriado"),
    "domingo-regra-pendente": financeiras.filter((linha) => diaDaSemana(linha.workDate) === 0),
    "compensacao-informativa": [],
    falta: linhas.filter((linha) => linha.status === "absent"),
  };

  // Alertas do conjunto (sem lançamento): a quantidade é o número de itens afetados.
  const doConjunto: Partial<Record<CodigoDeAlerta, number>> = {
    "divergencia-conciliacao": divergenciaGrave.length,
    "periodo-fora-de-fechamento":
      banco.ajustesPrevistos.length > 0 && !ehPeriodoDeFechamento(contexto.inicio, contexto.fim)
        ? banco.ajustesPrevistos.length
        : 0,
    "previa-por-quinzena": diferencaDePrevia.length,
    "compensacao-informativa": banco.saldoDeHoras.filter(
      (s) => s.minutosExcedentes > 0 && s.minutosFaltantes > 0,
    ).length,
  };

  const alertas: Alerta[] = [];
  for (const { codigo, severidade } of ORDEM) {
    const lista = afetadas[codigo];
    const quantidadeDoConjunto = doConjunto[codigo];
    if (quantidadeDoConjunto !== undefined) {
      if (quantidadeDoConjunto === 0) continue;
      alertas.push({ codigo, severidade, quantidade: quantidadeDoConjunto, entryIds: [] });
      continue;
    }
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
