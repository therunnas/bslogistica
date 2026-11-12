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

/** Todo o XML de um .xlsx baixado, desescapado, num texto só (para procurar rótulos e valores). */
export function textoDoXlsx(caminho: string): string {
  const arquivos = lerZip(readFileSync(caminho)) as Map<string, string>;
  return desescapar([...arquivos.values()].join("\n"));
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
