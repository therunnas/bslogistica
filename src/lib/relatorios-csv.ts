/**
 * CSV da tela de Relatórios no padrão do Excel brasileiro: `;` como separador (via `montarCsv`),
 * decimal com vírgula, data dd/mm/aaaa e acentos preservados (UTF-8; o BOM é acrescentado por quem
 * baixa o arquivo). Valores monetários saem de centavos inteiros, sem separador de milhar e sem
 * "R$", para a planilha ler a célula como número e a neutralização de fórmula de `csv.ts` continuar
 * tratando negativos como números. Nenhum valor é recalculado aqui: só a apresentação muda.
 */
import { montarCsv } from "./csv";
import { dateBR } from "./format";

export interface LinhaDoRelatorioCsv {
  date: string;
  clientName: string;
  operationName: string;
  shiftName: string;
  employeeName: string;
  status: string;
  workedMinutes: number;
  overtimeMinutes: number;
  billed: number;
  cost: number;
}

const CABECALHO = [
  "Data",
  "Cliente",
  "Operação",
  "Turno",
  "Colaborador",
  "Presença",
  "Trabalhado (min)",
  "Hora extra (min)",
  "Receita",
  "Custo",
];

/** Reais → "1234,56" a partir de centavos inteiros. */
export function reaisPtBr(valor: number): string {
  const centavos = Math.round(valor * 100);
  const sinal = centavos < 0 ? "-" : "";
  const absoluto = Math.abs(centavos);
  return `${sinal}${Math.trunc(absoluto / 100)},${String(absoluto % 100).padStart(2, "0")}`;
}

export function csvDeRelatorio(
  linhas: readonly LinhaDoRelatorioCsv[],
  rotulosDePresenca: Readonly<Record<string, string>>,
): string {
  return montarCsv(
    CABECALHO,
    linhas.map((row) => [
      dateBR(row.date),
      row.clientName,
      row.operationName,
      row.shiftName,
      row.employeeName,
      rotulosDePresenca[row.status] ?? row.status,
      row.workedMinutes,
      row.overtimeMinutes,
      reaisPtBr(row.billed),
      reaisPtBr(row.cost),
    ]),
  );
}
