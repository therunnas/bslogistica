/**
 * Regressão S19C-DEF-001: instantes do Auth (created_at, last_sign_in_at) chegam
 * em UTC. Exibir a data cortando o ISO mostra o dia seguinte para eventos depois
 * das 21h em Brasília. Datas de calendário (colunas date) continuam em dateBR.
 * Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
function load(file) {
  const source = readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", output)(() => ({}), module.exports, module);
  return module.exports;
}

const format = load("src/lib/format.ts");

test("instante UTC após 21h de Brasília mostra o dia local", () => {
  assert.equal(typeof format.instanteBR, "function");
  assert.equal(format.instanteBR("2026-11-06T00:34:00Z"), "05/11/2026");
  assert.equal(format.instanteBR("2026-11-06T00:34:00.123456+00:00"), "05/11/2026");
  assert.equal(format.instanteBR("2026-11-06T03:00:00Z"), "06/11/2026");
});

test("instante ausente ou inválido mostra traço", () => {
  assert.equal(format.instanteBR(null), "—");
  assert.equal(format.instanteBR(undefined), "—");
  assert.equal(format.instanteBR(""), "—");
  assert.equal(format.instanteBR("não é data"), "—");
});

test("dateBR de data de calendário não muda", () => {
  assert.equal(format.dateBR("2026-11-06"), "06/11/2026");
  assert.equal(format.dateBR(null), "—");
});

test("tela de usuários usa instanteBR para criado em e último login", () => {
  const tela = readFileSync(
    path.join(root, "src/app/(painel)/usuarios/painel-usuarios.tsx"),
    "utf8",
  );
  assert.match(tela, /instanteBR\(usuario\.criadoEm\)/);
  assert.match(tela, /instanteBR\(usuario\.ultimoLoginEm\)/);
  assert.doesNotMatch(tela, /dateBR\(usuario\.(criadoEm|ultimoLoginEm)\)/);
});
