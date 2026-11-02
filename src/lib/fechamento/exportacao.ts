/**
 * O modelo tabular da exportação: UMA definição de colunas e linhas para o CSV
 * e para o XLSX.
 *
 * Nada aqui soma, subtrai nem arredonda dinheiro. Cada célula é um valor que o
 * núcleo já entregou em `FechamentoData`, na escala do domínio:
 *
 *  - dinheiro: centavos inteiros;
 *  - horas: centésimos de hora (`centesimosDeHora`, o mesmo arredondamento que
 *    `gerar_fatura` grava em `total_overtime`);
 *  - margem: milésimos (`margemPermil`);
 *  - data: `YYYY-MM-DD`.
 *
 * A conversão para o que cada formato exibe — "1234,56" no CSV, `12.34` num
 * Number do Excel — é só mudança de escala, feita na borda, em aritmética
 * inteira no caso do CSV.
 *
 * Sem dependência de servidor: o CSV roda no navegador. O XLSX (`xlsx.ts`) é
 * quem importa `node:` e a biblioteca de planilha.
 */

import { montarCsv } from "../csv";
import { dateBR } from "../format";
import {
  ROTULO_DA_FOLHA,
  ROTULO_DA_SITUACAO_DE_FATURAMENTO,
  ROTULO_DO_STATUS,
  ROTULO_DO_TIPO_DO_DIA,
  type CodigoDeConciliacao,
  type FechamentoData,
  type Valores,
} from "./tipos";
import { centesimosDeHora } from "./valores";

export type TipoDeColuna = "texto" | "data" | "moeda" | "inteiro" | "horas" | "percentual";

/** Texto, `YYYY-MM-DD` (data), ou número na escala do tipo. `null` = vazio. */
export type ValorExportado = string | number | null;

export interface ColunaExportada {
  titulo: string;
  tipo: TipoDeColuna;
  /** Largura aproximada, em caracteres, para o XLSX. */
  largura: number;
}

export interface TabelaExportada {
  colunas: ColunaExportada[];
  linhas: ValorExportado[][];
  /** Linha de totais consolidados, ou `null` quando a tabela não tem. */
  totais: ValorExportado[] | null;
  /**
   * Linhas do CONSOLIDADO DO CLIENTE depois do total por colaborador (só o CSV as usa): o que
   * compõe a receita e não pertence a nenhum colaborador. Vêm prontas de `financeiro`.
   */
  consolidado?: ValorExportado[][];
}

export type FormatoDeCsv = "colaborador" | "diario";

export const ROTULO_DO_FORMATO_DE_CSV: Record<FormatoDeCsv, string> = {
  colaborador: "Por colaborador",
  diario: "Detalhamento diário",
};

export const ROTULO_DO_TOTAL = "Total";

/** Rótulos das linhas do consolidado do cliente (CSV por colaborador). */
export const ROTULO_DOS_ADICIONAIS =
  "Adicionais de serviço (consolidado do cliente, sem distribuir)";
export const ROTULO_DO_AJUSTE_FATURADO =
  "Ajuste de arredondamento já faturado (consolidado do cliente)";
export const ROTULO_DO_AJUSTE_PREVISTO =
  "Ajuste de arredondamento previsto (consolidado do cliente; já na coluna de ajuste do Total)";
export const ROTULO_DA_RECEITA = "Receita total (consolidado do cliente)";

const POR_COLABORADOR: ColunaExportada[] = [
  { titulo: "Colaborador", tipo: "texto", largura: 32 },
  { titulo: "Função", tipo: "texto", largura: 22 },
  { titulo: "Diárias", tipo: "inteiro", largura: 10 },
  { titulo: "Valor das diárias", tipo: "moeda", largura: 18 },
  { titulo: "Horas extras cobradas", tipo: "horas", largura: 20 },
  { titulo: "Valor das horas extras", tipo: "moeda", largura: 22 },
  { titulo: "Ajuste de arredondamento", tipo: "moeda", largura: 24 },
  { titulo: "Custo previsto", tipo: "moeda", largura: 16 },
  { titulo: "Já faturado", tipo: "moeda", largura: 16 },
  { titulo: "A faturar", tipo: "moeda", largura: 16 },
  { titulo: "Total cobrado", tipo: "moeda", largura: 16 },
  { titulo: "Resultado", tipo: "moeda", largura: 16 },
  { titulo: "Margem", tipo: "percentual", largura: 10 },
];

const DETALHAMENTO: ColunaExportada[] = [
  { titulo: "Data", tipo: "data", largura: 12 },
  { titulo: "Colaborador", tipo: "texto", largura: 32 },
  { titulo: "Função", tipo: "texto", largura: 22 },
  { titulo: "Operação", tipo: "texto", largura: 28 },
  { titulo: "Turno", tipo: "texto", largura: 18 },
  { titulo: "Status", tipo: "texto", largura: 13 },
  { titulo: "Tipo do dia", tipo: "texto", largura: 14 },
  { titulo: "Horas trabalhadas", tipo: "horas", largura: 18 },
  { titulo: "Excedente (custo)", tipo: "horas", largura: 22 },
  { titulo: "Horas extras cobradas", tipo: "horas", largura: 20 },
  { titulo: "Diária", tipo: "moeda", largura: 15 },
  { titulo: "Extra", tipo: "moeda", largura: 15 },
  { titulo: "Cobrado", tipo: "moeda", largura: 15 },
  { titulo: "Custo previsto", tipo: "moeda", largura: 16 },
  { titulo: "Situação de faturamento", tipo: "texto", largura: 24 },
  { titulo: "Situação da folha", tipo: "texto", largura: 18 },
];

/** Uma linha de colaborador (ou o total): os valores já vêm de `Valores`. */
function celulasFinanceiras(
  consolidado: Valores,
  aFaturar: Valores,
  jaFaturado: Valores,
  ajusteCentavos: number,
): ValorExportado[] {
  return [
    consolidado.diarias,
    consolidado.diariaCentavos,
    centesimosDeHora(consolidado.minutosExtrasCobrados),
    consolidado.extraCentavos,
    ajusteCentavos,
    consolidado.custoCentavos,
    jaFaturado.faturadoCentavos,
    aFaturar.faturadoCentavos,
    consolidado.faturadoCentavos,
    consolidado.resultadoCentavos,
    consolidado.margemPermil,
  ];
}

type ComponentesExportados = Pick<Valores, "especialCentavos" | "adicionalDiarioCentavos">;

/** Acrescenta os componentes já gravados, mantendo o formato legado quando ambos são zero. */
function incluirComponentes(
  tabela: TabelaExportada,
  linhas: readonly ComponentesExportados[],
  total: ComponentesExportados,
): TabelaExportada {
  if (total.especialCentavos === 0 && total.adicionalDiarioCentavos === 0) return tabela;
  const valores = (v: ComponentesExportados) => [v.especialCentavos, v.adicionalDiarioCentavos];
  return {
    ...tabela,
    colunas: [
      ...tabela.colunas,
      { titulo: "Horas especiais", tipo: "moeda", largura: 20 },
      { titulo: "Adicional diário", tipo: "moeda", largura: 20 },
    ],
    linhas: tabela.linhas.map((linha, i) => {
      const componentes = linhas[i];
      if (!componentes) throw new Error("Componentes ausentes na linha da exportação.");
      return [...linha, ...valores(componentes)];
    }),
    totais: tabela.totais === null ? null : [...tabela.totais, ...valores(total)],
    ...(tabela.consolidado
      ? { consolidado: tabela.consolidado.map((linha) => [...linha, null, null]) }
      : {}),
  };
}

export function tabelaPorColaborador(dados: FechamentoData): TabelaExportada {
  return incluirComponentes(
    {
      colunas: POR_COLABORADOR,
      linhas: dados.colaboradores.map((c) => [
        c.nome,
        c.funcao,
        ...celulasFinanceiras(c.consolidado, c.aFaturar, c.jaFaturado, c.ajusteAcumuladoCentavos),
      ]),
      totais: [
        ROTULO_DO_TOTAL,
        null,
        ...celulasFinanceiras(
          dados.consolidado,
          dados.aFaturar,
          dados.jaFaturado,
          dados.financeiro.ajustePrevistoCentavos,
        ),
      ],
      consolidado: linhasDoConsolidado(dados),
    },
    dados.colaboradores.map((c) => c.consolidado),
    dados.consolidado,
  );
}

/**
 * Consolidado do cliente: adicionais e ajuste faturado (que nenhum colaborador "tem") e a receita
 * total, com o custo, o já faturado, o a faturar, o resultado e a margem do banco. Nada é somado
 * nem distribuído aqui: cada célula é um campo de `financeiro`.
 */
function linhasDoConsolidado(dados: FechamentoData): ValorExportado[][] {
  const f = dados.financeiro;
  // Uma linha com o rótulo e células vazias; cada par [coluna, valor] preenche uma coluna.
  const linha = (rotulo: string, celulas: [number, ValorExportado][]): ValorExportado[] =>
    POR_COLABORADOR.map((_, coluna) =>
      coluna === 0 ? rotulo : (celulas.find(([indice]) => indice === coluna)?.[1] ?? null),
    );
  return [
    linha(ROTULO_DOS_ADICIONAIS, [[10, f.adicionaisCentavos]]),
    linha(ROTULO_DO_AJUSTE_FATURADO, [[10, f.ajusteFaturadoCentavos]]),
    linha(ROTULO_DO_AJUSTE_PREVISTO, [[10, f.ajustePrevistoCentavos]]),
    linha(ROTULO_DA_RECEITA, [
      [7, f.custoCentavos],
      [8, f.jaFaturadoCentavos],
      [9, f.aFaturarCentavos],
      [10, f.receitaCentavos],
      [11, f.resultadoCentavos],
      [12, f.margemPermil],
    ]),
  ];
}

export function tabelaDetalhamentoDiario(dados: FechamentoData): TabelaExportada {
  return incluirComponentes(
    {
      colunas: DETALHAMENTO,
      linhas: dados.detalhes.map((d) => [
        d.workDate,
        d.colaborador,
        d.funcao,
        d.operacao,
        d.turno,
        ROTULO_DO_STATUS[d.status],
        d.tipoDoDia === null ? null : ROTULO_DO_TIPO_DO_DIA[d.tipoDoDia],
        centesimosDeHora(d.minutosTrabalhados),
        centesimosDeHora(d.minutosExtras),
        centesimosDeHora(d.minutosExtrasCobrados),
        d.diariaCentavos,
        d.extraCentavos,
        d.faturadoCentavos,
        d.custoCentavos,
        ROTULO_DA_SITUACAO_DE_FATURAMENTO[d.situacaoDeFaturamento],
        ROTULO_DA_FOLHA[d.situacaoDaFolha],
      ]),
      totais: null,
    },
    dados.detalhes,
    dados.consolidado,
  );
}

/** Uma linha do resumo: rótulo, tipo e valor na escala do tipo. */
export interface LinhaDoResumo {
  rotulo: string;
  tipo: TipoDeColuna;
  valor: ValorExportado;
}

/** Texto fixo: os valores são previstos, não há registro de pagamento. */
export const AVISO_DE_VALORES_PREVISTOS =
  "Valores previstos a partir dos apontamentos. Não representam pagamento realizado. O saldo de horas é informativo e não altera nenhum valor.";

/** O bloco do cabeçalho do resumo, antes dos números. */
export function identificacaoDoResumo(dados: FechamentoData): LinhaDoResumo[] {
  return [
    { rotulo: "Cliente", tipo: "texto", valor: dados.meta.clienteNome },
    {
      rotulo: "Período",
      tipo: "texto",
      valor: `${dateBR(dados.meta.inicio)} a ${dateBR(dados.meta.fim)}`,
    },
  ];
}

/** Os indicadores do resumo, na ordem pedida. Todos lidos do modelo, nenhum calculado aqui. */
export function indicadoresDoResumo(dados: FechamentoData): LinhaDoResumo[] {
  const f = dados.financeiro;
  return [
    { rotulo: "Quantidade de diárias", tipo: "inteiro", valor: dados.consolidado.diarias },
    {
      rotulo: "Horas extras cobradas",
      tipo: "horas",
      valor: centesimosDeHora(dados.consolidado.minutosExtrasCobrados),
    },
    {
      rotulo: "Excedente do custo (horas)",
      tipo: "horas",
      valor: centesimosDeHora(dados.consolidado.minutosExtras),
    },
    { rotulo: "Apontamentos", tipo: "moeda", valor: f.apontamentosCentavos },
    { rotulo: "Adicionais de serviço", tipo: "moeda", valor: f.adicionaisCentavos },
    {
      rotulo: "Ajuste de arredondamento já faturado",
      tipo: "moeda",
      valor: f.ajusteFaturadoCentavos,
    },
    { rotulo: "Ajuste de arredondamento previsto", tipo: "moeda", valor: f.ajustePrevistoCentavos },
    { rotulo: "Receita total", tipo: "moeda", valor: f.receitaCentavos },
    {
      rotulo: "Custo previsto / Valor devido",
      tipo: "moeda",
      valor: f.custoCentavos,
    },
    { rotulo: "Já faturado", tipo: "moeda", valor: f.jaFaturadoCentavos },
    { rotulo: "A faturar", tipo: "moeda", valor: f.aFaturarCentavos },
    { rotulo: "Resultado", tipo: "moeda", valor: f.resultadoCentavos },
    { rotulo: "Margem", tipo: "percentual", valor: f.margemPermil },
  ];
}

const ROTULO_DA_CONCILIACAO: Record<CodigoDeConciliacao, string> = {
  apontamentos: "Apontamentos",
  adicionais: "Adicionais de serviço",
  "ajuste-faturado": "Ajuste de arredondamento já faturado",
  "ajuste-previsto": "Ajuste de arredondamento previsto",
  "a-faturar": "A faturar (sem o ajuste previsto)",
  faturado: "Já faturado",
};

/** Conferência com o resumo financeiro do banco: "Confere", ou os dois valores quando não. */
export function conciliacaoDoResumo(dados: FechamentoData): LinhaDoResumo[] {
  return dados.conciliacao.map((c) => ({
    rotulo: `Conferência com o banco — ${ROTULO_DA_CONCILIACAO[c.codigo]}`,
    tipo: "texto",
    valor: c.confere
      ? "Confere"
      : `NÃO CONFERE: fechamento R$ ${decimalPtBr(c.fechamentoCentavos, 2)} / banco R$ ${decimalPtBr(c.bancoCentavos, 2)}`,
  }));
}

/** Adicionais, ajuste acumulado e saldo de horas: o detalhe que sustenta o resumo. */
export function detalhesDoResumo(dados: FechamentoData): LinhaDoResumo[] {
  const horasTexto = (minutos: number) =>
    `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
  return [
    ...dados.adicionais.map((a): LinhaDoResumo => ({
      rotulo: `Adicional — ${a.descricao}${a.referencia === null ? "" : ` (ref. ${a.referencia})`}`,
      tipo: "moeda",
      valor: a.valorCentavos,
    })),
    ...dados.ajustesAcumulados.map((a): LinhaDoResumo => ({
      rotulo: `Arredondamento acumulado previsto — ${a.colaborador} (${a.minutosBrutos} → ${a.minutosArredondados} min)`,
      tipo: "moeda",
      valor: a.ajusteCentavos,
    })),
    ...dados.ajustesFaturados.map((a): LinhaDoResumo => ({
      rotulo: `Já faturado — ${a.descricao}`,
      tipo: "moeda",
      valor: a.valorCentavos,
    })),
    ...dados.saldoDeHoras.map((s): LinhaDoResumo => ({
      rotulo: `Saldo de horas (informativo) — ${s.colaborador}`,
      tipo: "texto",
      valor: `excedente ${horasTexto(s.minutosExcedentes)} / faltante ${horasTexto(s.minutosFaltantes)}`,
    })),
  ];
}

// ---------------------------------------------------------------------------
// CSV

/** Inteiro com duas casas implícitas em "1234,56". Sem ponto flutuante. */
function decimalPtBr(inteiro: number, casas: number): string {
  const sinal = inteiro < 0 ? "-" : "";
  const absoluto = Math.abs(inteiro);
  const escala = 10 ** casas;
  const parteInteira = Math.trunc(absoluto / escala);
  const fracao = String(absoluto % escala).padStart(casas, "0");
  return `${sinal}${parteInteira},${fracao}`;
}

/**
 * Uma célula como texto de CSV pt-BR. Sem separador de milhar e sem "R$"/"%":
 * assim um valor negativo continua sendo número puro para a neutralização de
 * `csv.ts` (que trataria "-1.234,56" como possível fórmula) e a planilha o lê
 * como número.
 */
export function textoDoCsv(tipo: TipoDeColuna, valor: ValorExportado): string {
  if (valor === null) return tipo === "percentual" ? "—" : "";
  if (typeof valor === "string") return tipo === "data" ? dateBR(valor) : valor;

  switch (tipo) {
    case "moeda":
    case "horas":
      return decimalPtBr(valor, 2);
    case "percentual":
      // Milésimos → percentual com uma casa: 125 → "12,5".
      return decimalPtBr(valor, 1);
    default:
      return String(valor);
  }
}

/** O cabeçalho do CSV: a margem diz a unidade no título, já que a célula é só número. */
function tituloDoCsv(coluna: ColunaExportada): string {
  return coluna.tipo === "percentual" ? `${coluna.titulo} (%)` : coluna.titulo;
}

export function montarCsvDaTabela(tabela: TabelaExportada): string {
  const linhas = [
    ...tabela.linhas,
    ...(tabela.totais ? [tabela.totais] : []),
    ...(tabela.consolidado ?? []),
  ];
  return montarCsv(
    tabela.colunas.map(tituloDoCsv),
    linhas.map((linha) =>
      tabela.colunas.map((coluna, indice) => textoDoCsv(coluna.tipo, linha[indice] ?? null)),
    ),
  );
}

export function csvDoFechamento(dados: FechamentoData, formato: FormatoDeCsv): string {
  return montarCsvDaTabela(
    formato === "colaborador" ? tabelaPorColaborador(dados) : tabelaDetalhamentoDiario(dados),
  );
}

// ---------------------------------------------------------------------------
// Nome de arquivo

const MAXIMO_DO_NOME_DO_CLIENTE = 40;

/** Só `a-z`, `0-9` e hífen: sem acento, controle, espaço nem separador de caminho. */
export function sanitizarParaArquivo(texto: string): string {
  const limpo = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAXIMO_DO_NOME_DO_CLIENTE)
    .replace(/-+$/g, "");
  return limpo === "" ? "cliente" : limpo;
}

export function nomeDoArquivo(
  meta: Pick<FechamentoData["meta"], "clienteNome" | "inicio" | "fim">,
  extensao: "xlsx" | "csv",
  sufixo?: string,
): string {
  const partes = ["fechamento", sanitizarParaArquivo(meta.clienteNome), meta.inicio, meta.fim];
  if (sufixo) partes.push(sufixo);
  return `${partes.join("-")}.${extensao}`;
}

export const SUFIXO_DO_FORMATO_DE_CSV: Record<FormatoDeCsv, string> = {
  colaborador: "por-colaborador",
  diario: "diario",
};
