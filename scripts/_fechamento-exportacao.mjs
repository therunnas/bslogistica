/**
 * Apoio das suítes de exportação do Fechamento (CSV e XLSX).
 *
 * Reúne o que as duas compartilham, para nenhuma redefinir o seu próprio:
 *
 *  - o `FechamentoData` da fixture ouro (valores conferidos À MÃO, nunca
 *    gerados pelo agregador) e uma variante com textos hostis;
 *  - um leitor de CSV (RFC 4180, separador `;`);
 *  - leitores de XML de planilha (strings compartilhadas, estilos, células).
 *
 * Os leitores de XML são deliberadamente simples e tolerantes ao formato que a
 * biblioteca gera. Se o gerador mudar o formato, as suítes falham alto em vez
 * de passar sobre dados que não conseguiram ler.
 */

import { readFileSync } from "node:fs";

import { agregarFechamento } from "../src/lib/fechamento/agregar.ts";
import { normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";

export const ouro = JSON.parse(
  readFileSync(new URL("./fixtures/fechamento-paridade.json", import.meta.url), "utf8"),
);

export function dadosDoOuro() {
  return agregarFechamento(normalizarLinhas(structuredClone(ouro.linhas)), ouro.contexto);
}

/** Textos que uma planilha poderia tratar como fórmula, comando ou marcação. */
export const TEXTOS_HOSTIS = [
  '=HYPERLINK("http://exemplo.invalid";"clique")',
  "+cmd|' /C calc'!A0",
  "-2+3+cmd|' /C calc'!A0",
  "@SUM(1+1)",
  " =1+1",
  "\t=1+1",
  "\n=1+1",
  "\r=1+1",
  '<script>alert(1)</script> & "aspas"',
  "Linha 1\nLinha 2; com ponto e vírgula",
];

/** Fixture ouro com os nomes, funções, operações e turnos trocados por textos hostis. */
export function dadosHostis() {
  const linhas = structuredClone(ouro.linhas);
  const nomes = new Map();
  linhas.forEach((linha, i) => {
    const hostil = TEXTOS_HOSTIS[i % TEXTOS_HOSTIS.length];
    const emp = linha.employees;
    if (emp) {
      if (!nomes.has(emp.id)) nomes.set(emp.id, TEXTOS_HOSTIS[nomes.size % TEXTOS_HOSTIS.length]);
      emp.name = nomes.get(emp.id);
      emp.role = hostil;
    }
    linha.timesheets.operations.name = TEXTOS_HOSTIS[(i + 3) % TEXTOS_HOSTIS.length];
    if (linha.timesheets.shifts) {
      linha.timesheets.shifts.name = TEXTOS_HOSTIS[(i + 5) % TEXTOS_HOSTIS.length];
    }
  });
  const contexto = { ...ouro.contexto, clienteNome: TEXTOS_HOSTIS[0] };
  return agregarFechamento(normalizarLinhas(linhas), contexto);
}

export function dadosVazios() {
  return agregarFechamento([], ouro.contexto);
}

// ---------------------------------------------------------------------------
// CSV

/** Lê CSV com `;`, aspas duplas e CRLF. Devolve `string[][]`. */
export function lerCsv(texto) {
  const linhas = [];
  let linha = [];
  let campo = "";
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\r" && texto[i + 1] === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
      i++;
    } else {
      campo += c;
    }
  }
  linha.push(campo);
  linhas.push(linha);
  return linhas;
}

/** "1234,56" → 123456 (centavos), "-0,05" → -5. Só aceita o formato que o CSV gera. */
export function centavosDoTexto(texto) {
  const m = /^(-?)(\d+),(\d{2})$/.exec(texto);
  if (!m) throw new Error(`valor monetário fora do formato: ${JSON.stringify(texto)}`);
  const centavos = Number(m[2]) * 100 + Number(m[3]);
  return m[1] === "-" ? -centavos : centavos;
}

// ---------------------------------------------------------------------------
// XML de planilha

const ENTIDADES = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" };

export function desescapar(xml) {
  return xml
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(?:lt|gt|quot|apos|amp);/g, (e) => ENTIDADES[e]);
}

/** `xl/sharedStrings.xml` → `string[]`. */
export function lerStringsCompartilhadas(xml) {
  const itens = [];
  for (const m of xml.matchAll(/<si>(.*?)<\/si>/gs)) {
    let texto = "";
    for (const t of m[1].matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)) texto += desescapar(t[1]);
    itens.push(texto);
  }
  return itens;
}

/** `xl/styles.xml` → `formatoDoEstilo(s)`: o código de formato da célula, ou `"General"`. */
export function lerEstilos(xml) {
  const formatos = new Map();
  for (const m of xml.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"\s*\/>/g)) {
    formatos.set(Number(m[1]), desescapar(m[2]));
  }
  const bloco = /<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(xml);
  if (!bloco) throw new Error("styles.xml sem cellXfs.");
  const xfs = [...bloco[1].matchAll(/<xf\b([^>]*)>/g)].map((m) => {
    const id = /numFmtId="(\d+)"/.exec(m[1]);
    return id ? Number(id[1]) : 0;
  });
  return (s) => {
    const id = xfs[s ?? 0];
    return id === undefined || id === 0 ? "General" : (formatos.get(id) ?? `#${id}`);
  };
}

/**
 * Uma planilha → `Map<"A1", { tipo, bruto, texto, estilo }>`.
 * `tipo`: "s" (string compartilhada), "n" (número) ou "vazia". `texto` só em "s".
 */
export function lerPlanilha(xml, strings) {
  const celulas = new Map();
  const dados = /<sheetData>(.*)<\/sheetData>/s.exec(xml);
  if (!dados) throw new Error("planilha sem sheetData.");

  for (const m of dados[1].matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
    const atributos = m[2];
    const t = /\bt="([^"]+)"/.exec(atributos)?.[1];
    const s = /\bs="(\d+)"/.exec(atributos)?.[1];
    const v = m[3] === undefined ? undefined : /<v>(.*?)<\/v>/s.exec(m[3])?.[1];
    const base = { estilo: s === undefined ? 0 : Number(s), formula: /<f[\s>]/.test(m[3] ?? "") };

    if (v === undefined) {
      celulas.set(m[1], { ...base, tipo: "vazia", bruto: null, texto: null });
    } else if (t === "s") {
      celulas.set(m[1], { ...base, tipo: "s", bruto: v, texto: strings[Number(v)] ?? null });
    } else {
      celulas.set(m[1], { ...base, tipo: t ?? "n", bruto: v, texto: null });
    }
  }
  return celulas;
}

/** Número de série do Excel para uma data civil, calculado de forma independente. */
export function serialDoExcel(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function letra(indice) {
  return String.fromCharCode(65 + indice);
}
