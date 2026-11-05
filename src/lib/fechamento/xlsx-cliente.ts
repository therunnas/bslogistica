/**
 * XLSX do Fechamento PARA O CLIENTE (modelo Dynamis, FIN-PR-12) — SOMENTE servidor.
 *
 * Duas abas: "Fechamento" (um lançamento por linha, por colaborador e data, mais os serviços
 * avulsos) e "Resumo por colaborador". As células vêm de `exportacao-cliente.ts`, que já conferiu
 * as somas contra o Fechamento; aqui só se decide a aparência. Não há custo, resultado nem margem.
 *
 * FÓRMULAS
 *
 * As ÚNICAS fórmulas do arquivo são os `SUBTOTAL(109; …)` da linha de subtotal, montadas aqui com
 * letras de coluna e números de linha — nunca com texto do banco. O SUBTOTAL 109 ignora as linhas
 * que o filtro esconde: o cliente filtra por colaborador, data ou operação e vê o subtotal do que
 * ficou visível. Abaixo dele, "Total do fechamento" é o valor fixo do período inteiro.
 *
 * Cada SUBTOTAL leva GRAVADO o valor sem filtro (`<v>`, a soma da coluna, em aritmética inteira):
 * pré-visualizações, o Modo de Exibição Protegido e leitores que não calculam mostram o número
 * certo. `fullCalcOnLoad` ainda pede à planilha que recalcule ao abrir. Na coluna de horas da aba
 * de lançamentos, o SUBTOTAL soma as horas já arredondadas de cada linha (é o que a planilha
 * calcula) e pode diferir em centésimos do "Total do fechamento", que vem da soma dos minutos, como
 * a tela. Em dinheiro, os dois são sempre iguais sem filtro. Texto do banco continua
 * sempre `String` (célula de texto, nunca `<f>`).
 *
 * Importe este módulo só em Route Handler ou outro código de servidor.
 */

import type { Blob } from "node:buffer";
import type Stream from "node:stream";

import writeXlsxFile, { type Cell, type Feature, type SheetData } from "write-excel-file/node";
import { findElement, replaceElement } from "write-excel-file/utility";

import type { TipoDeColuna } from "./exportacao";
import {
  identificacaoDoCliente,
  ROTULO_DO_SUBTOTAL,
  tabelaDoResumo,
  tabelaDosLancamentos,
  tituloDoFechamento,
  type TabelaDoCliente,
} from "./exportacao-cliente";
import type { FechamentoData } from "./tipos";
import {
  celulaXlsx,
  ESTILO_DO_CABECALHO,
  ESTILO_DO_TOTAL,
  FORMATO_DE_HORAS,
  FORMATO_DE_INTEIRO,
  FORMATO_DE_MOEDA,
  letraDaColuna,
  recursoDeAutofiltro,
} from "./xlsx";

/** O conteúdo de arquivo que a biblioteca aceita no Node (imagens; não usamos). */
type Arquivo = Stream | Buffer | Blob;

export const ABA_DOS_LANCAMENTOS = "Fechamento";
export const ABA_DO_RESUMO = "Resumo por colaborador";

/** Linha (1-based) do cabeçalho da tabela: título, cliente, período e uma linha em branco antes. */
export const LINHA_DO_CABECALHO = 5;

export const AVISO_SEM_LANCAMENTOS = "Nenhum lançamento no período.";

/** Escala de cada tipo somado: o valor do modelo dividido por ela é o número do Excel. */
const ESCALA_DA_SOMA: Partial<Record<TipoDeColuna, number>> = {
  moeda: 100,
  horas: 100,
  inteiro: 1,
};

/** Inteiro na escala → número decimal do XML (`225932`, 100 → `2259.32`). Sem ponto flutuante. */
export function decimalDoXml(inteiro: number, escala: number): string {
  if (!Number.isSafeInteger(inteiro)) throw new Error("Soma fora do intervalo seguro.");
  if (escala === 1) return String(inteiro);
  const casas = String(escala).length - 1;
  const absoluto = Math.abs(inteiro);
  const fracao = String(absoluto % escala).padStart(casas, "0");
  return `${inteiro < 0 ? "-" : ""}${Math.trunc(absoluto / escala)}.${fracao}`;
}

const FORMATO_DA_SOMA: Partial<Record<TipoDeColuna, string>> = {
  moeda: FORMATO_DE_MOEDA,
  horas: FORMATO_DE_HORAS,
  inteiro: FORMATO_DE_INTEIRO,
};

function topo(dados: FechamentoData, subtitulo: string | null): SheetData {
  const rotulo = (texto: string): Cell => ({ value: texto, type: String, fontWeight: "bold" });
  return [
    [
      {
        value: tituloDoFechamento(dados.meta.inicio, dados.meta.fim),
        type: String,
        fontWeight: "bold",
        fontSize: 14,
      },
      subtitulo === null ? null : { value: subtitulo, type: String, fontStyle: "italic" },
    ],
    ...identificacaoDoCliente(dados).map(([campo, valor]): Cell[] => [
      rotulo(campo),
      celulaXlsx("texto", valor),
    ]),
    [],
  ];
}

/**
 * Uma aba completa, a referência do autofiltro (cabeçalho e linhas, sem subtotal nem total) e o
 * valor sem filtro de cada SUBTOTAL, por referência A1, para gravar no arquivo.
 */
export function abaDoCliente(
  dados: FechamentoData,
  tabela: TabelaDoCliente,
  subtitulo: string | null,
): { dados: SheetData; filtro: string; calculados: Map<string, string> } {
  const ultima = letraDaColuna(tabela.colunas.length);
  const primeiraLinha = LINHA_DO_CABECALHO + 1;
  const ultimaLinha = LINHA_DO_CABECALHO + tabela.linhas.length;

  const planilha: SheetData = [
    ...topo(dados, subtitulo),
    tabela.colunas.map((coluna) => ({
      ...ESTILO_DO_CABECALHO,
      value: coluna.titulo,
      type: String,
    })),
  ];
  if (planilha.length !== LINHA_DO_CABECALHO) throw new Error("Topo da aba fora do previsto.");

  for (const linha of tabela.linhas) {
    planilha.push(tabela.colunas.map((coluna, i) => celulaXlsx(coluna.tipo, linha[i] ?? null)));
  }

  const calculados = new Map<string, string>();
  if (tabela.linhas.length === 0) {
    planilha.push([{ value: AVISO_SEM_LANCAMENTOS, type: String, fontStyle: "italic" }]);
  } else {
    // Linha em branco: reaplicar o filtro ou ordenar não arrasta o subtotal para o meio dos dados.
    planilha.push([]);
    planilha.push(
      tabela.colunas.map((coluna, i): Cell => {
        if (i === 0) return { ...ESTILO_DO_TOTAL, value: ROTULO_DO_SUBTOTAL, type: String };
        if (!tabela.somadas.includes(i)) return { ...ESTILO_DO_TOTAL };
        const letra = letraDaColuna(i + 1);
        const escala = ESCALA_DA_SOMA[coluna.tipo];
        if (escala === undefined) throw new Error("Coluna somada sem escala.");
        const soma = tabela.linhas.reduce((total, linha) => {
          const valor = linha[i] ?? null;
          if (valor !== null && typeof valor !== "number")
            throw new Error("Valor somado não numérico.");
          return total + (valor ?? 0);
        }, 0);
        calculados.set(`${letra}${ultimaLinha + 2}`, decimalDoXml(soma, escala));
        return {
          ...ESTILO_DO_TOTAL,
          type: "Formula",
          value: `SUBTOTAL(109,${letra}${primeiraLinha}:${letra}${ultimaLinha})`,
          format: FORMATO_DA_SOMA[coluna.tipo] ?? FORMATO_DE_MOEDA,
          align: "right",
        };
      }),
    );
  }

  planilha.push(
    tabela.colunas.map((coluna, i) =>
      celulaXlsx(coluna.tipo, tabela.total[i] ?? null, ESTILO_DO_TOTAL),
    ),
  );

  return {
    dados: planilha,
    filtro: `A${LINHA_DO_CABECALHO}:${ultima}${Math.max(ultimaLinha, LINHA_DO_CABECALHO)}`,
    calculados,
  };
}

/**
 * Grava o valor calculado (`<v>`) em cada célula de SUBTOTAL, pelo mecanismo de features. Falha
 * alto se a célula não estiver exatamente como o gerador a escreveu: nunca um arquivo sem o valor.
 */
export function recursoDeValoresCalculados(
  porAba: ReadonlyMap<number, ReadonlyMap<string, string>>,
): Feature<Arquivo> {
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform(xml, _opcoes, { sheetIndex }) {
            let resultado = xml;
            for (const [ref, valor] of porAba.get(sheetIndex) ?? []) {
              const celula = new RegExp(`(<c r="${ref}"[^>]*><f>[^<]*</f>)(</c>)`, "g");
              const encontradas = resultado.match(celula)?.length ?? 0;
              if (encontradas !== 1) throw new Error(`Célula de SUBTOTAL ${ref} fora do previsto.`);
              resultado = resultado.replace(celula, `$1<v>${valor}</v>$2`);
            }
            return resultado;
          },
        },
      },
    },
  };
}

/** Pede à planilha que recalcule as fórmulas ao abrir (o filtro, então, passa a valer). */
export function recursoDeRecalculoAoAbrir(): Feature<Arquivo> {
  return {
    files: {
      transform: {
        "xl/workbook.xml": {
          transform(xml) {
            const calculo = findElement(xml, "calcPr");
            if (!calculo) throw new Error("xl/workbook.xml sem <calcPr/>: formato inesperado.");
            return replaceElement(xml, calculo, '<calcPr fullCalcOnLoad="1"/>');
          },
        },
      },
    },
  };
}

/** Gera o arquivo do cliente. Lança em qualquer falha: nunca devolve arquivo parcial. */
export async function gerarXlsxDoCliente(dados: FechamentoData): Promise<Buffer> {
  const tabelaDeLancamentos = tabelaDosLancamentos(dados);
  const tabelaDeResumo = tabelaDoResumo(dados);
  const lancamentos = abaDoCliente(dados, tabelaDeLancamentos, null);
  const resumo = abaDoCliente(dados, tabelaDeResumo, ABA_DO_RESUMO);
  const larguras = (tabela: TabelaDoCliente) => tabela.colunas.map((c) => ({ width: c.largura }));

  const filtros = new Map([
    [0, { nome: ABA_DOS_LANCAMENTOS, ref: lancamentos.filtro }],
    [1, { nome: ABA_DO_RESUMO, ref: resumo.filtro }],
  ]);

  return writeXlsxFile(
    [
      {
        sheet: ABA_DOS_LANCAMENTOS,
        data: lancamentos.dados,
        columns: larguras(tabelaDeLancamentos),
        stickyRowsCount: LINHA_DO_CABECALHO,
      },
      {
        sheet: ABA_DO_RESUMO,
        data: resumo.dados,
        columns: larguras(tabelaDeResumo),
        stickyRowsCount: LINHA_DO_CABECALHO,
      },
    ],
    {
      features: [
        recursoDeAutofiltro(filtros),
        recursoDeValoresCalculados(
          new Map([
            [0, lancamentos.calculados],
            [1, resumo.calculados],
          ]),
        ),
        recursoDeRecalculoAoAbrir(),
      ],
    },
  ).toBuffer();
}
