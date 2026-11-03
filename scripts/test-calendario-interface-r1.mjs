/** Executa as duas interfaces reais, trocando apenas os hooks de acesso externo aos dados. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = new Map();
let resposta;
const consultaVazia = { data: [], isError: false, isPending: false, isSuccess: true };
const mutacao = {
  isPending: false,
  mutate: () => {
    throw new Error("A renderização não pode executar mutações.");
  },
};
const fontes = {
  "@/lib/vigencias-dados": {
    useCalendarioTerritorial: () => calendario.capacidadeCalendario(resposta.data, resposta.error),
    useRegimeDoCalendario: () => calendario.regimeCalendario(resposta.data, resposta.error),
  },
  "@/lib/regras-definitivas-dados": {
    useFeriados: () => consultaVazia,
    useRegistrarFeriado: () => mutacao,
    useAposentarFeriado: () => mutacao,
  },
  "@/lib/calendario-dados": {
    useCoberturas: () => consultaVazia,
    useAlterarCalendario: () => mutacao,
    useMunicipios: (uf) => ({
      ...consultaVazia,
      data:
        uf === "DF"
          ? [
              {
                codigo: "5300108",
                nome: "Brasília",
                uf: "DF",
                fonteUrl: "https://servicodados.ibge.gov.br/api/v1/localidades/municipios/5300108",
              },
            ]
          : [],
    }),
  },
};

// Mantém JSX, componentes visuais, validações e hooks React reais, sem instalar um runner.
function carregar(arquivo) {
  if (cache.has(arquivo)) return cache.get(arquivo).exports;
  const modulo = { exports: {} };
  cache.set(arquivo, modulo);
  const exigirPacote = createRequire(arquivo);
  const exigir = (nome) => {
    if (fontes[nome]) return fontes[nome];
    if (!nome.startsWith(".") && !nome.startsWith("@/")) return exigirPacote(nome);
    const base = nome.startsWith("@/")
      ? resolve(root, "src", nome.slice(2))
      : resolve(dirname(arquivo), nome);
    const destino = [base, `${base}.ts`, `${base}.tsx`].find((p) => existsSync(p));
    assert.ok(destino, `Importação local não encontrada: ${nome}`);
    return carregar(destino);
  };
  const { outputText } = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    fileName: arquivo,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  runInThisContext(`(function(require, module, exports) {${outputText}\n})`, {
    filename: arquivo,
  })(exigir, modulo, modulo.exports);
  return modulo.exports;
}

const calendario = carregar(resolve(root, "src/lib/calendario-territorial.ts"));
const { FeriadosDoCalendario } = carregar(resolve(root, "src/app/(painel)/clientes/feriados.tsx"));
const base044 = { ativo: true, consistente: true, calendario_territorial: true };
// Uma regressão que use apenas a capacidade libera o calendário territorial nos casos OFF/erro.
const casos = [
  [
    "044 + resolução OFF mantém cadastro legado",
    { ...base044, resolucao_tarifas: false },
    null,
    "legado",
  ],
  [
    "044 + motor OFF e resolução OFF mantém legado",
    { ...base044, ativo: false, resolucao_tarifas: false },
    null,
    "legado",
  ],
  [
    "044 + resolução ON libera territorial",
    { ...base044, resolucao_tarifas: true },
    null,
    "territorial",
  ],
  ["carregamento não libera cadastro", null, null, "bloqueado"],
  [
    "erro de consulta não libera cadastro",
    { ...base044, resolucao_tarifas: true },
    { message: "Falha de rede" },
    "bloqueado",
  ],
  ["capacidade desconhecida não presume legado", {}, null, "bloqueado"],
  [
    "capacidade inconsistente não presume legado",
    { ...base044, consistente: false, resolucao_tarifas: false },
    null,
    "bloqueado",
  ],
  ["regime ausente na 044 não libera cadastro", base044, null, "bloqueado"],
  [
    "regime inválido na 044 não libera cadastro",
    { ...base044, resolucao_tarifas: "false" },
    null,
    "bloqueado",
  ],
  [
    "resolução ON com motor OFF não libera cadastro",
    { ...base044, ativo: false, resolucao_tarifas: true },
    null,
    "bloqueado",
  ],
  [
    "schema anterior à 044 conhecido mantém legado",
    { ativo: true, consistente: true },
    null,
    "legado",
  ],
  [
    "schema anterior à 044 com motor OFF mantém legado",
    { ativo: false, consistente: true },
    null,
    "legado",
  ],
];
let falhas = 0;
for (const [nome, data, error, esperado] of casos) {
  resposta = { data, error };
  try {
    const html = renderToStaticMarkup(React.createElement(FeriadosDoCalendario));
    const legado = html.includes("Calendário de feriados");
    const territorial = html.includes("Calendário territorial");
    assert.equal(legado, esperado === "legado", "visibilidade do cadastro legado");
    assert.equal(territorial, esperado === "territorial", "visibilidade do cadastro territorial");
    if (esperado === "bloqueado") {
      assert.doesNotMatch(html, /<button\b/, "estado desconhecido não pode oferecer mutações");
      assert.match(html, /Verificando/, "a interface deve orientar sobre a verificação pendente");
    } else {
      assert.match(html, /<button\b/, "estado confirmado mantém o cadastro utilizável");
    }
    console.log(`PASS ${nome}`);
  } catch (erro) {
    falhas++;
    console.error(`FAIL ${nome}: ${erro.message}`);
  }
}
const { SeletorTerritorial } = carregar(
  resolve(root, "src/app/(painel)/_components/calendario-territorial.tsx"),
);
const seletores = [
  [
    "âmbito distrital oferece somente DF, sem seleção municipal",
    { uf: "DF", ambito: "distrital" },
    (html) => {
      assert.deepEqual(
        [...html.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]),
        ["", "DF"],
      );
      assert.equal([...html.matchAll(/<select\b/g)].length, 1);
    },
  ],
  [
    "âmbito estadual exclui DF e preserva SC",
    { uf: "SC", ambito: "estadual" },
    (html) => {
      assert.doesNotMatch(html, /value="DF"/);
      assert.match(html, /value="SC"/);
      assert.equal([...html.matchAll(/<select\b/g)].length, 1);
    },
  ],
  [
    "âmbito municipal exclui DF e mantém seleção municipal",
    { uf: "SC", ambito: "municipal" },
    (html) => {
      assert.doesNotMatch(html, /value="DF"/);
      assert.match(html, /Município oficial \(IBGE\)/);
      assert.equal([...html.matchAll(/<select\b/g)].length, 2);
    },
  ],
  [
    "local real no DF preserva Brasília como identidade IBGE",
    { uf: "DF" },
    (html) => {
      assert.match(html, /Localidade oficial \(IBGE\)/);
      assert.doesNotMatch(html, /Município oficial/);
      assert.match(html, /value="5300108">Brasília \(5300108\)/);
      assert.match(html, /value="DF"/);
      assert.match(html, /value="SC"/);
    },
  ],
  [
    "local real em SC mantém município oficial e todas as UFs",
    { uf: "SC" },
    (html) => {
      assert.match(html, /Município oficial \(IBGE\)/);
      assert.match(html, /value="DF"/);
      assert.match(html, /value="SC"/);
    },
  ],
];
for (const [nome, props, verificar] of seletores) {
  try {
    const html = renderToStaticMarkup(
      React.createElement(SeletorTerritorial, {
        ...props,
        municipio: null,
        onUf: () => {},
        onMunicipio: () => {},
      }),
    );
    verificar(html);
    console.log(`PASS ${nome}`);
  } catch (erro) {
    falhas++;
    console.error(`FAIL ${nome}: ${erro.message}`);
  }
}
const total = casos.length + seletores.length;
console.log(`Calendário interface R1: ${total - falhas}/${total} PASS`);
if (falhas) process.exitCode = 1;
