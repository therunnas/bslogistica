/**
 * XLSX do Fechamento — SOMENTE servidor.
 *
 * Recebe um `FechamentoData` já carregado e validado e devolve os bytes do
 * arquivo. Não consulta o Supabase, não lê o relógio e não calcula dinheiro: as
 * células vêm de `exportacao.ts`, o mesmo modelo do CSV. Aqui só se decide como
 * cada valor aparece no Excel.
 *
 * TIPOS
 *
 * Dinheiro, horas e margem saem como `Number` com formato — nunca como texto —
 * para a planilha continuar somável. A conversão é só de escala: centavos/100,
 * centésimos de hora/100, milésimos/1000. Datas saem como `Date` à meia-noite
 * UTC (número de série inteiro, sem deslocamento de fuso).
 *
 * SEGURANÇA CONTRA FÓRMULA
 *
 * Todo texto do banco (colaborador, função, operação, turno, cliente) é escrito
 * como `String`, com formato de texto `@`. Este módulo nunca usa `type:
 * "Formula"`: uma célula de texto "=1+1" vira `<c t="s">` na tabela de strings,
 * nunca um `<f>`. Por isso não há apóstrofo: o tipo já basta.
 *
 * AUTOFILTRO E CONGELAMENTO
 *
 * O congelamento da primeira linha é recurso nativo da biblioteca
 * (`stickyRowsCount`). O autofiltro não é: entra pelo mecanismo oficial de
 * "features" (`files.transform`), com os auxiliares de XML do subpacote
 * `write-excel-file/utility` — a ordem de elementos da planilha vem da própria
 * biblioteca, não de manipulação de texto. A feature falha alto se o XML não
 * tiver o formato esperado, em vez de entregar um arquivo sem filtro.
 *
 * Importe este módulo só em Route Handler ou outro código de servidor.
 */

import type { Blob } from "node:buffer";
import type Stream from "node:stream";

import writeXlsxFile, { type Cell, type Feature, type SheetData } from "write-excel-file/node";
import {
  findElement,
  getOrderOfSiblings,
  getSelfClosingTagMarkup,
  insertElementMarkupAccordingToOrderOfSiblings,
  replaceElement,
} from "write-excel-file/utility";

import {
  AVISO_DE_VALORES_PREVISTOS,
  identificacaoDoResumo,
  indicadoresDoResumo,
  tabelaDetalhamentoDiario,
  tabelaPorColaborador,
  type ColunaExportada,
  type LinhaDoResumo,
  type TabelaExportada,
  type TipoDeColuna,
  type ValorExportado,
} from "./exportacao";
import { rotuloDaAtualizacao } from "./apresentacao";
import type { FechamentoData } from "./tipos";

/** O conteúdo de arquivo que a biblioteca aceita no Node (imagens; não usamos). */
type Arquivo = Stream | Buffer | Blob;

export const TIPO_DO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const ABA_RESUMO = "Resumo";
export const ABA_POR_COLABORADOR = "Por colaborador";
export const ABA_DETALHAMENTO = "Detalhamento diário";

export const FORMATO_DE_DATA = "dd/mm/yyyy";
export const FORMATO_DE_MOEDA = '"R$" #,##0.00';
export const FORMATO_DE_HORAS = "0.00";
export const FORMATO_DE_PERCENTUAL = "0.0%";
export const FORMATO_DE_INTEIRO = "0";
const FORMATO_DE_TEXTO = "@";

const COR_DO_CABECALHO = "#1F3A5F";
const COR_DO_TOTAL = "#E5E7EB";
const COR_DO_TEXTO_DO_CABECALHO = "#FFFFFF";

type Estilo = Partial<{
  fontWeight: "bold";
  fontStyle: "italic";
  backgroundColor: string;
  textColor: string;
  topBorderStyle: "thin";
  topBorderColor: string;
  align: "left" | "center" | "right";
  wrap: boolean;
}>;

const ESTILO_DO_CABECALHO: Estilo = {
  fontWeight: "bold",
  backgroundColor: COR_DO_CABECALHO,
  textColor: COR_DO_TEXTO_DO_CABECALHO,
  align: "center",
  wrap: true,
};

const ESTILO_DO_TOTAL: Estilo = {
  fontWeight: "bold",
  backgroundColor: COR_DO_TOTAL,
  topBorderStyle: "thin",
  topBorderColor: "#6B7280",
};

/** `YYYY-MM-DD` → meia-noite UTC. O núcleo valida a data antes; aqui só se converte. */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  if (ano === undefined || mes === undefined || dia === undefined) {
    throw new Error("Data inválida na exportação.");
  }
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const ESCALA: Partial<Record<TipoDeColuna, number>> = {
  moeda: 100,
  horas: 100,
  percentual: 1000,
};

const FORMATO: Record<TipoDeColuna, string> = {
  texto: FORMATO_DE_TEXTO,
  data: FORMATO_DE_DATA,
  moeda: FORMATO_DE_MOEDA,
  inteiro: FORMATO_DE_INTEIRO,
  horas: FORMATO_DE_HORAS,
  percentual: FORMATO_DE_PERCENTUAL,
};

/** Uma célula tipada. `null` vira célula vazia (margem sem faturado, por exemplo). */
export function celulaXlsx(tipo: TipoDeColuna, valor: ValorExportado, estilo: Estilo = {}): Cell {
  if (valor === null) return estilo.backgroundColor ? { ...estilo } : null;

  if (tipo === "texto") {
    return { ...estilo, value: String(valor), type: String, format: FORMATO[tipo] };
  }
  if (tipo === "data") {
    return { ...estilo, value: dataUtc(String(valor)), type: Date, format: FORMATO[tipo] };
  }
  if (typeof valor !== "number") {
    throw new Error("Valor numérico esperado na exportação.");
  }
  return {
    ...estilo,
    value: valor / (ESCALA[tipo] ?? 1),
    type: Number,
    format: FORMATO[tipo],
    align: estilo.align ?? "right",
  };
}

function cabecalho(colunas: readonly ColunaExportada[]): Cell[] {
  return colunas.map((coluna) => ({
    ...ESTILO_DO_CABECALHO,
    value: coluna.titulo,
    type: String,
  }));
}

interface AbaTabular {
  nome: string;
  dados: SheetData;
  larguras: { width: number }[];
  /** Referência A1 do autofiltro: cabeçalho + linhas, sem o total. */
  filtro: string;
}

/** Letra da coluna (1 → A). A tabela tem poucas colunas, nunca passa de Z. */
function letraDaColuna(quantidade: number): string {
  if (quantidade < 1 || quantidade > 26) throw new Error("Quantidade de colunas fora do previsto.");
  return String.fromCharCode(64 + quantidade);
}

function abaTabular(nome: string, tabela: TabelaExportada): AbaTabular {
  const dados: SheetData = [cabecalho(tabela.colunas)];

  for (const linha of tabela.linhas) {
    dados.push(tabela.colunas.map((coluna, i) => celulaXlsx(coluna.tipo, linha[i] ?? null)));
  }

  if (tabela.totais) {
    const totais = tabela.totais;
    // Uma linha em branco separa o total do intervalo filtrado: reaplicar o
    // filtro no Excel não o inclui na ordenação.
    dados.push([]);
    dados.push(
      tabela.colunas.map((coluna, i) =>
        celulaXlsx(coluna.tipo, totais[i] ?? null, ESTILO_DO_TOTAL),
      ),
    );
  }

  const ultimaColuna = letraDaColuna(tabela.colunas.length);
  return {
    nome,
    dados,
    larguras: tabela.colunas.map((coluna) => ({ width: coluna.largura })),
    filtro: `A1:${ultimaColuna}${1 + tabela.linhas.length}`,
  };
}

function abaResumo(dados: FechamentoData): { dados: SheetData } {
  const rotulo = (texto: string): Cell => ({ value: texto, type: String, fontWeight: "bold" });
  const linha = (item: LinhaDoResumo): Cell[] => [
    rotulo(item.rotulo),
    celulaXlsx(item.tipo, item.valor, { align: "right" }),
  ];

  const linhas: SheetData = [
    [{ value: "Fechamento", type: String, fontWeight: "bold", fontSize: 14 }],
    [],
    ...identificacaoDoResumo(dados).map(linha),
    [
      rotulo("Gerado em"),
      celulaXlsx("texto", rotuloDaAtualizacao(dados.meta.geradoEm), { align: "right" }),
    ],
    [],
    ...indicadoresDoResumo(dados).map(linha),
    [],
    [
      {
        value: AVISO_DE_VALORES_PREVISTOS,
        type: String,
        fontStyle: "italic",
        columnSpan: 2,
        wrap: true,
        height: 32,
      },
      null,
    ],
  ];
  return { dados: linhas };
}

/**
 * Autofiltro por aba, pelo mecanismo oficial de features.
 *
 *  - `<autoFilter ref="…"/>` entra na planilha na posição que a própria
 *    biblioteca define para o elemento (depois de `sheetData`);
 *  - o Excel espera o nome definido oculto `_xlnm._FilterDatabase` apontando
 *    para o mesmo intervalo; ele entra em `workbook.xml`.
 */
export function recursoDeAutofiltro(
  filtros: ReadonlyMap<number, { nome: string; ref: string }>,
): Feature<Arquivo> {
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform(xml, _opcoes, { sheetIndex }) {
            const filtro = filtros.get(sheetIndex);
            if (!filtro) return xml;

            const ordem = getOrderOfSiblings("xl/worksheets/sheet{id}.xml", "worksheet");
            if (!ordem) throw new Error("Ordem dos elementos da planilha indisponível.");

            return insertElementMarkupAccordingToOrderOfSiblings(
              xml,
              getSelfClosingTagMarkup("autoFilter", { ref: filtro.ref }),
              ordem,
              "worksheet",
            );
          },
        },
        "xl/workbook.xml": {
          transform(xml) {
            const nomes = [...filtros.entries()]
              .sort(([a], [b]) => a - b)
              .map(([indice, filtro]) => {
                const [de, ate] = filtro.ref.split(":");
                const absoluta = (ref: string | undefined) =>
                  (ref ?? "").replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
                return `<definedName name="_xlnm._FilterDatabase" localSheetId="${indice}" hidden="1">'${filtro.nome}'!${absoluta(de)}:${absoluta(ate)}</definedName>`;
              })
              .join("");

            const existente = findElement(xml, "definedNames");
            if (!existente) {
              throw new Error("xl/workbook.xml sem <definedNames/>: formato inesperado.");
            }
            return replaceElement(xml, existente, `<definedNames>${nomes}</definedNames>`);
          },
        },
      },
    },
  };
}

/** Gera o arquivo. Lança em qualquer falha: nunca devolve arquivo parcial. */
export async function gerarXlsxDoFechamento(dados: FechamentoData): Promise<Buffer> {
  const colaboradores = abaTabular(ABA_POR_COLABORADOR, tabelaPorColaborador(dados));
  const detalhamento = abaTabular(ABA_DETALHAMENTO, tabelaDetalhamentoDiario(dados));

  const filtros = new Map([
    [1, { nome: ABA_POR_COLABORADOR, ref: colaboradores.filtro }],
    [2, { nome: ABA_DETALHAMENTO, ref: detalhamento.filtro }],
  ]);

  return writeXlsxFile(
    [
      {
        sheet: ABA_RESUMO,
        data: abaResumo(dados).dados,
        columns: [{ width: 34 }, { width: 36 }],
      },
      {
        sheet: ABA_POR_COLABORADOR,
        data: colaboradores.dados,
        columns: colaboradores.larguras,
        stickyRowsCount: 1,
      },
      {
        sheet: ABA_DETALHAMENTO,
        data: detalhamento.dados,
        columns: detalhamento.larguras,
        stickyRowsCount: 1,
      },
    ],
    { features: [recursoDeAutofiltro(filtros)] },
  ).toBuffer();
}
