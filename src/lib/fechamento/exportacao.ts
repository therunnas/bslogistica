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
}

export type FormatoDeCsv = "colaborador" | "diario";

export const ROTULO_DO_FORMATO_DE_CSV: Record<FormatoDeCsv, string> = {
  colaborador: "Por colaborador",
  diario: "Detalhamento diário",
};

export const ROTULO_DO_TOTAL = "Total";

const POR_COLABORADOR: ColunaExportada[] = [
  { titulo: "Colaborador", tipo: "texto", largura: 32 },
  { titulo: "Função", tipo: "texto", largura: 22 },
  { titulo: "Diárias", tipo: "inteiro", largura: 10 },
  { titulo: "Valor das diárias", tipo: "moeda", largura: 18 },
  { titulo: "Horas extras", tipo: "horas", largura: 13 },
  { titulo: "Valor das horas extras", tipo: "moeda", largura: 22 },
  { titulo: "Custo previsto", tipo: "moeda", largura: 16 },
  { titulo: "Já faturado", tipo: "moeda", largura: 16 },
  { titulo: "A faturar", tipo: "moeda", largura: 16 },
  { titulo: "Faturado total", tipo: "moeda", largura: 16 },
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
  { titulo: "Horas trabalhadas", tipo: "horas", largura: 18 },
  { titulo: "Horas extras", tipo: "horas", largura: 13 },
  { titulo: "Diária", tipo: "moeda", largura: 15 },
  { titulo: "Extra", tipo: "moeda", largura: 15 },
  { titulo: "Faturado", tipo: "moeda", largura: 15 },
  { titulo: "Custo previsto", tipo: "moeda", largura: 16 },
  { titulo: "Situação de faturamento", tipo: "texto", largura: 24 },
  { titulo: "Situação da folha", tipo: "texto", largura: 18 },
];

/** Uma linha de colaborador (ou o total): os valores já vêm de `Valores`. */
function celulasFinanceiras(
  consolidado: Valores,
  aFaturar: Valores,
  jaFaturado: Valores,
): ValorExportado[] {
  return [
    consolidado.diarias,
    consolidado.diariaCentavos,
    centesimosDeHora(consolidado.minutosExtras),
    consolidado.extraCentavos,
    consolidado.custoCentavos,
    jaFaturado.faturadoCentavos,
    aFaturar.faturadoCentavos,
    consolidado.faturadoCentavos,
    consolidado.resultadoCentavos,
    consolidado.margemPermil,
  ];
}

export function tabelaPorColaborador(dados: FechamentoData): TabelaExportada {
  return {
    colunas: POR_COLABORADOR,
    linhas: dados.colaboradores.map((c) => [
      c.nome,
      c.funcao,
      ...celulasFinanceiras(c.consolidado, c.aFaturar, c.jaFaturado),
    ]),
    totais: [
      ROTULO_DO_TOTAL,
      null,
      ...celulasFinanceiras(dados.consolidado, dados.aFaturar, dados.jaFaturado),
    ],
  };
}

export function tabelaDetalhamentoDiario(dados: FechamentoData): TabelaExportada {
  return {
    colunas: DETALHAMENTO,
    linhas: dados.detalhes.map((d) => [
      d.workDate,
      d.colaborador,
      d.funcao,
      d.operacao,
      d.turno,
      ROTULO_DO_STATUS[d.status],
      centesimosDeHora(d.minutosTrabalhados),
      centesimosDeHora(d.minutosExtras),
      d.diariaCentavos,
      d.extraCentavos,
      d.faturadoCentavos,
      d.custoCentavos,
      ROTULO_DA_SITUACAO_DE_FATURAMENTO[d.situacaoDeFaturamento],
      ROTULO_DA_FOLHA[d.situacaoDaFolha],
    ]),
    totais: null,
  };
}

/** Uma linha do resumo: rótulo, tipo e valor na escala do tipo. */
export interface LinhaDoResumo {
  rotulo: string;
  tipo: TipoDeColuna;
  valor: ValorExportado;
}

/** Texto fixo: os valores são previstos, não há registro de pagamento. */
export const AVISO_DE_VALORES_PREVISTOS =
  "Valores previstos a partir dos apontamentos. Não representam pagamento realizado.";

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

/** Os indicadores do resumo, na ordem pedida, todos lidos de `consolidado`. */
export function indicadoresDoResumo(dados: FechamentoData): LinhaDoResumo[] {
  return [
    { rotulo: "Quantidade de diárias", tipo: "inteiro", valor: dados.consolidado.diarias },
    {
      rotulo: "Horas extras",
      tipo: "horas",
      valor: centesimosDeHora(dados.consolidado.minutosExtras),
    },
    {
      rotulo: "Custo previsto / Valor devido",
      tipo: "moeda",
      valor: dados.consolidado.custoCentavos,
    },
    { rotulo: "Já faturado", tipo: "moeda", valor: dados.jaFaturado.faturadoCentavos },
    { rotulo: "A faturar", tipo: "moeda", valor: dados.aFaturar.faturadoCentavos },
    { rotulo: "Faturado total", tipo: "moeda", valor: dados.consolidado.faturadoCentavos },
    { rotulo: "Resultado", tipo: "moeda", valor: dados.consolidado.resultadoCentavos },
    { rotulo: "Margem", tipo: "percentual", valor: dados.consolidado.margemPermil },
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
  const linhas = tabela.totais ? [...tabela.linhas, tabela.totais] : tabela.linhas;
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
