/**
 * O modelo da exportação PARA O CLIENTE (modelo Dynamis, FIN-PR-12).
 *
 * É a conferência que o cliente recebe: o que foi cobrado, lançamento a lançamento, e o resumo por
 * colaborador. **Não leva custo, resultado nem margem** — nenhuma coluna, rótulo ou total interno.
 *
 * Como `exportacao.ts`, este módulo não decide dinheiro. Cada valor vem pronto de `FechamentoData`:
 *
 *  - lançamento: diária, hora extra, domingo/feriado e adicional diário já decompostos pelo núcleo
 *    (`componentes-financeiros.ts` garante que a soma é o cobrado);
 *  - adicional de serviço (inclusive container, o serviço avulso do FIN-PR-11): uma linha cada;
 *  - arredondamento acumulado: o ajuste que o banco devolveu, por colaborador, e o já faturado.
 *
 * O que se soma aqui é só apresentação: o total de cada coluna e de cada colaborador, em centavos
 * inteiros (`somarCentavos`). Antes de entregar, o modelo CONFERE essas somas contra o Fechamento —
 * a soma das linhas tem de ser a receita, e a de cada componente, o consolidado. Divergência lança
 * erro: o cliente nunca recebe um arquivo cujo total não é o do Fechamento.
 *
 * Sem dependência de servidor: o XLSX (`xlsx-cliente.ts`) é quem escreve o arquivo.
 */

import { dateBR } from "../format";
import { somarCentavos } from "./centavos";
import { ErroDeDadoFinanceiro } from "./erros";
import type { ColunaExportada, ValorExportado } from "./exportacao";
import { diasDoMes, ehMesInteiro } from "./periodo";
import {
  ROTULO_DO_STATUS,
  ROTULO_DO_TIPO_DO_DIA,
  type FechamentoData,
  type LinhaDetalhe,
} from "./tipos";
import { centesimosDeHora } from "./valores";

/**
 * O arquivo não pode ser entregue: as somas não fecham com o Fechamento. É inconsistência de dado
 * (422 `dado-inconsistente` na rota), não falha do servidor.
 */
export class ErroDaExportacaoDoCliente extends ErroDeDadoFinanceiro {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDaExportacaoDoCliente";
  }
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/**
 * "Fechamento – 1ª quinzena de outubro/2026", "Fechamento – 2ª quinzena de …", "Fechamento –
 * outubro/2026" para o mês inteiro, e as datas para qualquer outro recorte.
 */
export function tituloDoFechamento(inicio: string, fim: string): string {
  const [ano, mes, dia] = inicio.split("-").map(Number);
  const [anoF, mesF, diaF] = fim.split("-").map(Number);
  const nomeDoMes = mes === undefined ? undefined : MESES[mes - 1];
  if (
    ano !== undefined &&
    mes !== undefined &&
    nomeDoMes !== undefined &&
    ano === anoF &&
    mes === mesF
  ) {
    const referencia = `${nomeDoMes}/${ano}`;
    if (ehMesInteiro(inicio, fim)) return `Fechamento – ${referencia}`;
    if (dia === 1 && diaF === 15) return `Fechamento – 1ª quinzena de ${referencia}`;
    if (dia === 16 && diaF === diasDoMes(ano, mes)) {
      return `Fechamento – 2ª quinzena de ${referencia}`;
    }
  }
  return `Fechamento – ${dateBR(inicio)} a ${dateBR(fim)}`;
}

export const ROTULO_DO_SUBTOTAL = "Subtotal (linhas visíveis no filtro)";
export const ROTULO_DO_TOTAL_DO_FECHAMENTO = "Total do fechamento";
export const ROTULO_DOS_SERVICOS = "Adicionais de serviço";
export const ROTULO_DO_AJUSTE_ACUMULADO = "Ajuste de arredondamento das horas extras";
export const ROTULO_DO_AJUSTE_JA_FATURADO = "Ajuste de arredondamento já faturado";

/** Colunas da aba de lançamentos. As numéricas são as que o SUBTOTAL soma. */
export const COLUNAS_DOS_LANCAMENTOS: readonly ColunaExportada[] = [
  { titulo: "Colaborador", tipo: "texto", largura: 32 },
  { titulo: "Função", tipo: "texto", largura: 22 },
  { titulo: "Data", tipo: "data", largura: 12 },
  { titulo: "Operação", tipo: "texto", largura: 28 },
  { titulo: "Tipo do dia", tipo: "texto", largura: 14 },
  { titulo: "Lançamento", tipo: "texto", largura: 40 },
  { titulo: "Horas extras (h)", tipo: "horas", largura: 16 },
  { titulo: "Diária", tipo: "moeda", largura: 15 },
  { titulo: "Hora extra", tipo: "moeda", largura: 15 },
  { titulo: "Domingo/feriado", tipo: "moeda", largura: 17 },
  { titulo: "Adicional", tipo: "moeda", largura: 15 },
  { titulo: "Total", tipo: "moeda", largura: 16 },
];

/** Colunas do resumo por colaborador. */
export const COLUNAS_DO_RESUMO: readonly ColunaExportada[] = [
  { titulo: "Colaborador", tipo: "texto", largura: 32 },
  { titulo: "Função", tipo: "texto", largura: 22 },
  { titulo: "Diárias", tipo: "inteiro", largura: 10 },
  { titulo: "Horas extras (h)", tipo: "horas", largura: 16 },
  { titulo: "Diária", tipo: "moeda", largura: 15 },
  { titulo: "Hora extra", tipo: "moeda", largura: 15 },
  { titulo: "Domingo/feriado", tipo: "moeda", largura: 17 },
  { titulo: "Adicional", tipo: "moeda", largura: 15 },
  { titulo: "Total", tipo: "moeda", largura: 16 },
];

/** Uma aba tabular do cliente: linhas, colunas somadas e o total do fechamento por coluna. */
export interface TabelaDoCliente {
  colunas: readonly ColunaExportada[];
  linhas: ValorExportado[][];
  /** Índices das colunas que o SUBTOTAL e o total somam (as numéricas). */
  somadas: readonly number[];
  /** Linha "Total do fechamento": rótulo na primeira coluna e a soma de cada coluna somada. */
  total: ValorExportado[];
}

/** Os valores de uma linha, na escala do domínio (centésimos de hora e centavos). */
interface Componentes {
  centesimos: number;
  diaria: number;
  extra: number;
  especial: number;
  adicional: number;
}

const ZERO: Componentes = { centesimos: 0, diaria: 0, extra: 0, especial: 0, adicional: 0 };

function somarComponentes(a: Componentes, b: Componentes): Componentes {
  return {
    centesimos: a.centesimos + b.centesimos,
    diaria: somarCentavos(a.diaria, b.diaria, "diária"),
    extra: somarCentavos(a.extra, b.extra, "hora extra"),
    especial: somarCentavos(a.especial, b.especial, "domingo/feriado"),
    adicional: somarCentavos(a.adicional, b.adicional, "adicional"),
  };
}

function totalDe(c: Componentes): number {
  return [c.extra, c.especial, c.adicional].reduce(
    (total, parcela) => somarCentavos(total, parcela, "total"),
    c.diaria,
  );
}

/** Uma linha da aba de lançamentos, com o dono (para o resumo) e os valores. */
interface LinhaDoCliente {
  employeeId: string | null;
  celulas: [
    colaborador: string | null,
    funcao: string | null,
    data: string | null,
    operacao: string | null,
    tipoDoDia: string | null,
    lancamento: string,
  ];
  horas: number | null;
  valores: Componentes;
}

const comparar = new Intl.Collator("pt-BR", { sensitivity: "base" }).compare;

function componentesDoLancamento(d: LinhaDetalhe): Componentes {
  const valores: Componentes = {
    centesimos: centesimosDeHora(d.minutosExtrasCobrados),
    diaria: d.diariaCentavos,
    extra: d.extraCentavos,
    especial: d.especialCentavos,
    adicional: d.adicionalDiarioCentavos,
  };
  // Defesa: o núcleo já garante; aqui se recusa entregar um lançamento cuja decomposição mudou.
  if (totalDe(valores) !== d.faturadoCentavos) {
    throw new ErroDaExportacaoDoCliente(
      `Lançamento ${d.entryId}: os componentes não somam o valor cobrado.`,
    );
  }
  return valores;
}

/** As linhas na ordem do cliente: colaborador, data; depois adicionais de serviço e ajuste faturado. */
function linhasDoCliente(dados: FechamentoData): LinhaDoCliente[] {
  const ordemDoColaborador = new Map(dados.colaboradores.map((c, i) => [c.employeeId, i]));
  const funcaoDoColaborador = new Map(dados.colaboradores.map((c) => [c.employeeId, c.funcao]));
  const posicao = (employeeId: string) =>
    ordemDoColaborador.get(employeeId) ?? Number.MAX_SAFE_INTEGER;

  const lancamentos = [...dados.detalhes].sort(
    (a, b) =>
      posicao(a.employeeId) - posicao(b.employeeId) ||
      comparar(a.colaborador, b.colaborador) ||
      a.workDate.localeCompare(b.workDate) ||
      comparar(a.operacao, b.operacao) ||
      a.entryId.localeCompare(b.entryId),
  );

  const ajustePorColaborador = new Map<string, number>();
  for (const a of dados.ajustesAcumulados) {
    ajustePorColaborador.set(
      a.employeeId,
      somarCentavos(ajustePorColaborador.get(a.employeeId) ?? 0, a.ajusteCentavos, "ajuste"),
    );
  }

  const linhas: LinhaDoCliente[] = [];
  const ajusteDe = (employeeId: string, colaborador: string): LinhaDoCliente | null => {
    const ajuste = ajustePorColaborador.get(employeeId);
    ajustePorColaborador.delete(employeeId);
    if (ajuste === undefined || ajuste === 0) return null;
    return {
      employeeId,
      celulas: [
        colaborador,
        funcaoDoColaborador.get(employeeId) ?? null,
        null,
        null,
        null,
        ROTULO_DO_AJUSTE_ACUMULADO,
      ],
      horas: null,
      valores: { ...ZERO, extra: ajuste },
    };
  };

  lancamentos.forEach((d, i) => {
    linhas.push({
      employeeId: d.employeeId,
      celulas: [
        d.colaborador,
        d.funcao,
        d.workDate,
        d.operacao,
        d.tipoDoDia === null ? null : ROTULO_DO_TIPO_DO_DIA[d.tipoDoDia],
        `Diária — ${ROTULO_DO_STATUS[d.status].toLowerCase()}`,
      ],
      horas: centesimosDeHora(d.minutosExtrasCobrados),
      valores: componentesDoLancamento(d),
    });
    if (lancamentos[i + 1]?.employeeId !== d.employeeId) {
      const ajuste = ajusteDe(d.employeeId, d.colaborador);
      if (ajuste) linhas.push(ajuste);
    }
  });

  // Ajuste de quem não tem lançamento no recorte (raro): ainda é receita do período.
  for (const a of dados.ajustesAcumulados) {
    const ajuste = ajusteDe(a.employeeId, a.colaborador);
    if (ajuste) linhas.push(ajuste);
  }

  const nomeDaOperacao = new Map(dados.detalhes.map((d) => [d.operationId, d.operacao]));
  const servicos = [...dados.adicionais].sort(
    (a, b) =>
      a.inicio.localeCompare(b.inicio) ||
      comparar(a.descricao, b.descricao) ||
      a.id.localeCompare(b.id),
  );
  for (const s of servicos) {
    const referencia = s.referencia === null ? "" : ` (ref. ${s.referencia})`;
    const periodo = s.fim === s.inicio ? "" : ` — ${dateBR(s.inicio)} a ${dateBR(s.fim)}`;
    linhas.push({
      employeeId: null,
      celulas: [
        null,
        null,
        s.inicio,
        s.operacaoId === null ? null : (nomeDaOperacao.get(s.operacaoId) ?? null),
        null,
        `Adicional de serviço — ${s.descricao}${referencia}${periodo}`,
      ],
      horas: null,
      valores: { ...ZERO, adicional: s.valorCentavos },
    });
  }

  if (dados.financeiro.ajusteFaturadoCentavos !== 0) {
    linhas.push({
      employeeId: null,
      celulas: [null, null, null, null, null, ROTULO_DO_AJUSTE_JA_FATURADO],
      horas: null,
      valores: { ...ZERO, extra: dados.financeiro.ajusteFaturadoCentavos },
    });
  }
  return linhas;
}

function celulasDosValores(horas: number | null, v: Componentes): ValorExportado[] {
  return [horas, v.diaria, v.extra, v.especial, v.adicional, totalDe(v)];
}

/** A soma de todas as linhas tem de ser o Fechamento: receita e cada componente. */
function conferirTotais(dados: FechamentoData, total: Componentes): void {
  const c = dados.consolidado;
  const esperado: [string, number, number][] = [
    ["diária", total.diaria, c.diariaCentavos],
    ["domingo/feriado", total.especial, c.especialCentavos],
    [
      "adicional",
      total.adicional,
      somarCentavos(c.adicionalDiarioCentavos, dados.financeiro.adicionaisCentavos, "adicional"),
    ],
    [
      "hora extra",
      total.extra,
      somarCentavos(c.extraCentavos, dados.financeiro.ajusteCentavos, "hora extra"),
    ],
    ["total", totalDe(total), dados.financeiro.receitaCentavos],
  ];
  for (const [campo, obtido, fechamento] of esperado) {
    if (obtido !== fechamento) {
      throw new ErroDaExportacaoDoCliente(
        `A soma de ${campo} da exportação (${obtido}) não é a do fechamento (${fechamento}).`,
      );
    }
  }
}

const SOMADAS_DOS_LANCAMENTOS = [6, 7, 8, 9, 10, 11] as const;
const SOMADAS_DO_RESUMO = [2, 3, 4, 5, 6, 7, 8] as const;

/** Aba de lançamentos: uma linha por diária, ajuste e adicional de serviço. */
export function tabelaDosLancamentos(dados: FechamentoData): TabelaDoCliente {
  const linhas = linhasDoCliente(dados);
  const total = linhas.reduce((soma, l) => somarComponentes(soma, l.valores), ZERO);
  conferirTotais(dados, total);
  const horas = linhas.reduce((soma, l) => soma + (l.horas ?? 0), 0);

  return {
    colunas: COLUNAS_DOS_LANCAMENTOS,
    linhas: linhas.map((l) => [...l.celulas, ...celulasDosValores(l.horas, l.valores)]),
    somadas: SOMADAS_DOS_LANCAMENTOS,
    total: [
      ROTULO_DO_TOTAL_DO_FECHAMENTO,
      null,
      null,
      null,
      null,
      null,
      ...celulasDosValores(horas, total),
    ],
  };
}

/**
 * Resumo por colaborador, montado das MESMAS linhas da aba de lançamentos: o total de cada
 * colaborador é a soma das linhas dele lá, e as diárias, a quantidade de lançamentos. Serviços
 * avulsos e o ajuste já faturado entram como linhas próprias, sem colaborador.
 */
export function tabelaDoResumo(dados: FechamentoData): TabelaDoCliente {
  const linhas = linhasDoCliente(dados);
  const porColaborador = new Map<string, { diarias: number; valores: Componentes }>();
  let servicos = ZERO;
  let ajusteFaturado = ZERO;

  for (const l of linhas) {
    const valores = { ...l.valores, centesimos: l.horas ?? 0 };
    if (l.employeeId === null) {
      if (l.celulas[5] === ROTULO_DO_AJUSTE_JA_FATURADO) {
        ajusteFaturado = somarComponentes(ajusteFaturado, valores);
      } else {
        servicos = somarComponentes(servicos, valores);
      }
      continue;
    }
    const atual = porColaborador.get(l.employeeId) ?? { diarias: 0, valores: ZERO };
    porColaborador.set(l.employeeId, {
      diarias: atual.diarias + (l.celulas[2] === null ? 0 : 1),
      valores: somarComponentes(atual.valores, valores),
    });
  }

  const resultado: ValorExportado[][] = [];
  const total = { diarias: 0, valores: ZERO };
  const somar = (diarias: number, valores: Componentes) => {
    total.diarias += diarias;
    total.valores = somarComponentes(total.valores, valores);
  };

  for (const c of dados.colaboradores) {
    const linha = porColaborador.get(c.employeeId);
    if (!linha) continue;
    if (linha.diarias !== c.consolidado.diarias) {
      throw new ErroDaExportacaoDoCliente(
        `Colaborador ${c.employeeId}: a quantidade de diárias não confere com o fechamento.`,
      );
    }
    resultado.push([
      c.nome,
      c.funcao,
      linha.diarias,
      ...celulasDosValores(linha.valores.centesimos, linha.valores),
    ]);
    somar(linha.diarias, linha.valores);
    porColaborador.delete(c.employeeId);
  }
  if (porColaborador.size > 0) {
    throw new ErroDaExportacaoDoCliente("Há lançamento de colaborador fora do fechamento.");
  }

  if (dados.adicionais.length > 0) {
    resultado.push([ROTULO_DOS_SERVICOS, null, null, ...celulasDosValores(null, servicos)]);
    somar(0, servicos);
  }
  if (dados.financeiro.ajusteFaturadoCentavos !== 0) {
    resultado.push([
      ROTULO_DO_AJUSTE_JA_FATURADO,
      null,
      null,
      ...celulasDosValores(null, ajusteFaturado),
    ]);
    somar(0, ajusteFaturado);
  }

  conferirTotais(dados, total.valores);
  if (total.diarias !== dados.consolidado.diarias) {
    throw new ErroDaExportacaoDoCliente("A quantidade de diárias não confere com o fechamento.");
  }

  return {
    colunas: COLUNAS_DO_RESUMO,
    linhas: resultado,
    somadas: SOMADAS_DO_RESUMO,
    total: [
      ROTULO_DO_TOTAL_DO_FECHAMENTO,
      null,
      total.diarias,
      ...celulasDosValores(total.valores.centesimos, total.valores),
    ],
  };
}

/** Identificação no topo das abas: cliente e período. */
export function identificacaoDoCliente(dados: FechamentoData): [string, string][] {
  return [
    ["Cliente", dados.meta.clienteNome],
    ["Período", `${dateBR(dados.meta.inicio)} a ${dateBR(dados.meta.fim)}`],
  ];
}

export const SUFIXO_DO_ARQUIVO_DO_CLIENTE = "cliente";
