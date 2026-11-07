/**
 * Regressão S19E-DEF-001: o CSV de Relatórios saía com `;` como separador (padrão do Excel
 * brasileiro), mas com decimal em ponto ("307.50") e data ISO ("2026-11-05"); no Excel pt-BR esses
 * valores viram texto ou número errado. Regra aprovada: `;`, decimal `,`, UTF-8 com BOM, datas
 * dd/mm/aaaa e acentos preservados. Valores vêm de centavos inteiros, sem ponto flutuante.
 * Este teste exporta, reimporta como uma planilha pt-BR faria e confere os números.
 * Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const ARQUIVO = "src/lib/relatorios-csv.ts";

function carregar(arquivo, dependencias) {
  const saida = ts.transpileModule(readFileSync(path.join(root, arquivo), "utf8"), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", saida)(
    (id) => dependencias[id],
    module.exports,
    module,
  );
  return module.exports;
}

const csv = carregar("src/lib/csv.ts", {});
const format = carregar("src/lib/format.ts", {});

/** Leitor mínimo de CSV RFC 4180 com `;`, como o Excel pt-BR abre o arquivo. */
function lerCsv(texto) {
  const linhas = [];
  let celula = "";
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') {
        celula += '"';
        i += 1;
      } else if (ch === '"') aspas = false;
      else celula += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ";") {
      linha.push(celula);
      celula = "";
    } else if (ch === "\r" && texto[i + 1] === "\n") {
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
      i += 1;
    } else celula += ch;
  }
  if (celula !== "" || linha.length) {
    linha.push(celula);
    linhas.push(linha);
  }
  return linhas;
}
const numeroPtBr = (texto) => {
  assert.match(texto, /^-?\d+,\d{2}$/, `não é decimal pt-BR: ${texto}`);
  return Number(texto.replace(",", "."));
};

const LINHAS = [
  {
    date: "2026-11-05",
    clientName: "E2E-S19B Cliente 8b48",
    operationName: "Operação Itajaí; Navegantes",
    shiftName: "Dia 08-17",
    employeeName: 'Colab "2" — Conferente',
    status: "present",
    workedMinutes: 570,
    overtimeMinutes: 90,
    billed: 307.5,
    cost: 198.25,
  },
  {
    date: "2026-11-06",
    clientName: "E2E-S11 Cliente B",
    operationName: "B1",
    shiftName: "Dia B1",
    employeeName: "Colaborador 5",
    status: "present",
    workedMinutes: 490,
    overtimeMinutes: 10,
    billed: 309.375,
    cost: 0.1 + 0.2,
  },
  {
    date: "2026-11-06",
    clientName: "C",
    operationName: "O",
    shiftName: "T",
    employeeName: "=HYPERLINK(1)",
    status: "absent",
    workedMinutes: 0,
    overtimeMinutes: 0,
    billed: 0,
    cost: -12.3,
  },
];
const ROTULOS = { present: "Presente", absent: "Falta", substitute: "Substituição" };

test("módulo puro de CSV de Relatórios existe e a tela o usa com BOM", () => {
  assert.ok(existsSync(path.join(root, ARQUIVO)));
  const tela = readFileSync(
    path.join(root, "src/app/(painel)/relatorios/painel-relatorios.tsx"),
    "utf8",
  );
  assert.match(tela, /csvDeRelatorio\(/);
  assert.match(tela, /\\uFEFF\$\{csv\}/);
  assert.doesNotMatch(tela, /\.toFixed\(2\)/);
});

test("exporta e reimporta como planilha pt-BR: números, datas e acentos preservados", () => {
  const { csvDeRelatorio } = carregar(ARQUIVO, { "./csv": csv, "./format": format });
  const texto = csvDeRelatorio(LINHAS, ROTULOS);
  const tabela = lerCsv(texto);
  assert.deepEqual(tabela[0], [
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
  ]);
  const [, a, b, c] = tabela;
  assert.equal(a[0], "05/11/2026");
  assert.equal(a[2], "Operação Itajaí; Navegantes");
  assert.equal(a[4], 'Colab "2" — Conferente');
  assert.equal(a[5], "Presente");
  assert.equal(a[6], "570");
  assert.equal(numeroPtBr(a[8]), 307.5);
  assert.equal(a[8], "307,50");
  assert.equal(numeroPtBr(a[9]), 198.25);
  assert.equal(b[8], "309,38"); // arredonda a partir de centavos, não do float
  assert.equal(b[9], "0,30");
  assert.equal(c[4], "'=HYPERLINK(1)"); // neutralização de fórmula preservada
  assert.equal(c[5], "Falta");
  assert.equal(c[9], "-12,30"); // negativo continua número puro
  for (const linha of tabela.slice(1)) {
    assert.match(linha[0], /^\d{2}\/\d{2}\/\d{4}$/);
    assert.equal(linha.length, 10);
  }
});
