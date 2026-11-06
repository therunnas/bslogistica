/**
 * Regressão S19C-DEF-004: telas de Containers exibiam datas em ISO cru
 * ("2026-11-05", "2026-11-01 a 2026-11-15") e o instante da auditoria em UTC
 * ("2026-11-06T00:57:21.905735+00:00" para um registro das 21:57 de 05/11 em
 * Brasília). Datas de calendário passam por dateBR; o instante, pelo fuso da
 * operação. Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const ler = (arquivo) => readFileSync(path.join(root, arquivo), "utf8");

function carregarFormato() {
  const output = ts.transpileModule(ler("src/lib/format.ts"), {
    fileName: "format.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", output)(() => ({}), module.exports, module);
  return module.exports;
}

const format = carregarFormato();

test("instante com hora no fuso de Brasília", () => {
  assert.equal(typeof format.instanteDataHoraBR, "function");
  assert.equal(format.instanteDataHoraBR("2026-11-06T00:57:21.905735+00:00"), "05/11/2026 21:57");
  assert.equal(format.instanteDataHoraBR("2026-11-01T10:00:00Z"), "01/11/2026 07:00");
  assert.equal(format.instanteDataHoraBR(null), "—");
  assert.equal(format.instanteDataHoraBR("inválido"), "—");
});

test("detalhe do serviço formata datas e auditoria", () => {
  const detalhe = ler("src/app/(painel)/containers/detalhe-container.tsx");
  assert.match(detalhe, /\["Solicitação", dateBR\(servico\.requested_on\)\]/);
  assert.match(detalhe, /\["Execução", dateBR\(servico\.executed_on\)\]/);
  assert.match(detalhe, /dateBR\(competencia\.inicio\)} a \$\{dateBR\(competencia\.fim\)/);
  assert.match(detalhe, /instanteDataHoraBR\(evento\.created_at\)/);
  assert.doesNotMatch(detalhe, /· \{evento\.created_at\}/);
});

test("lista e conferência do novo serviço formatam datas", () => {
  assert.match(ler("src/app/(painel)/containers/lista-containers.tsx"), /dateBR\(s\.executed_on\)/);
  const formulario = ler("src/app/(painel)/containers/formulario-container.tsx");
  assert.match(formulario, /dateBR\(lote\.solicitadoEm\)/);
  assert.match(formulario, /dateBR\(lote\.executadoEm\)/);
});
