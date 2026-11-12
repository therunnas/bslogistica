import { readFileSync } from "node:fs";

// Leitor mínimo de ZIP já usado pelas suítes de exportação (só node:zlib, sem dependência nova).
import { lerZip } from "../../scripts/_zip.mjs";

const ENTIDADES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};

function desescapar(xml: string): string {
  return xml
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(?:lt|gt|quot|apos|amp);/g, (e) => ENTIDADES[e] ?? e);
}

/**
 * Só o que aparece nas células de um .xlsx: textos (`<t>`) e valores (`<v>`), um por linha. Sem
 * nomes de elementos e atributos do XML (ex.: `customWidth` não é a palavra "custo").
 */
export function celulasDoXlsx(caminho: string): string {
  const arquivos = lerZip(readFileSync(caminho)) as Map<string, string>;
  const textos: string[] = [];
  for (const [nome, xml] of arquivos) {
    if (!nome.startsWith("xl/")) continue;
    for (const m of xml.matchAll(/<(t|v)(?:\s[^>]*)?>([^<]*)<\/\1>/g))
      textos.push(desescapar(m[2] ?? ""));
  }
  return textos.join("\n");
}

/** Linhas de um CSV com separador `;` (aspas duplas como no gerador), sem o BOM inicial. */
export function linhasDoCsv(caminho: string): string[][] {
  const texto = readFileSync(caminho, "utf8").replace(/^\s+/, "");
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}
