/**
 * Regressão S19E-DEF-002: o formulário de contrato aceitava "Vigente até" anterior a "Vigente de"
 * e gravava o período invertido (HML: contrato E2E-S19E Contrato Teste, 06/11 → 01/11). O banco não
 * tem restrição para isso. A tela passa a recusar o período invertido (fim igual ou anterior ao
 * início), mostra a mensagem e bloqueia o salvar. Fim vazio continua permitido (contrato aberto).
 * Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const ARQUIVO = "src/lib/contrato-periodo.ts";

function carregar() {
  const saida = ts.transpileModule(readFileSync(path.join(root, ARQUIVO), "utf8"), {
    fileName: ARQUIVO,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", saida)(() => ({}), module.exports, module);
  return module.exports;
}

test("módulo existe", () => assert.ok(existsSync(path.join(root, ARQUIVO))));

test("período do contrato: fim vazio ou posterior ao início", () => {
  const { erroDoPeriodoDoContrato } = carregar();
  assert.equal(erroDoPeriodoDoContrato("2026-11-06", ""), null);
  assert.equal(erroDoPeriodoDoContrato("2026-11-06", "2026-12-01"), null);
  const mensagem = "“Vigente até” deve ser posterior a “Vigente de”.";
  assert.equal(erroDoPeriodoDoContrato("2026-11-06", "2026-11-01"), mensagem);
  assert.equal(erroDoPeriodoDoContrato("2026-11-06", "2026-11-06"), mensagem);
  assert.equal(erroDoPeriodoDoContrato("", "2026-11-01"), "Informe “Vigente de”.");
});

test("a tela mostra o erro e bloqueia o salvar", () => {
  const tela = readFileSync(
    path.join(root, "src/app/(painel)/clientes/painel-clientes.tsx"),
    "utf8",
  );
  assert.match(
    tela,
    /const erroDoPeriodo = erroDoPeriodoDoContrato\(contractForm\.valid_from, contractForm\.valid_to\)/,
  );
  assert.match(tela, /erroDoPeriodo !== null \|\|/);
  assert.match(tela, /\{erroDoPeriodo && \(/);
});
