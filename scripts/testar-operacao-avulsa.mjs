/**
 * Regra aprovada (S19E, OBS-S19C-05): operação avulsa podia ser salva sem data e sem valor.
 * Agora: data da operação obrigatória; sem contrato, o valor acordado é obrigatório e não
 * negativo; valor zero só quando informado explicitamente E justificado em Observações. Com
 * contrato (regra de cobrança) o valor não é exigido; na edição com valor travado pela vigência,
 * o valor também não é exigido. Operação fixa não muda. Validação de interface: o banco não muda.
 * Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const ARQUIVO = "src/lib/operacao-avulsa.ts";

function carregar() {
  const saida = ts.transpileModule(readFileSync(path.join(root, ARQUIVO), "utf8"), {
    fileName: ARQUIVO,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", saida)(() => ({}), module.exports, module);
  return module.exports;
}

const base = {
  type: "spot",
  contract_id: "",
  agreed_amount: "300",
  operation_date: "2026-11-06",
  notes: "",
};

test("módulo existe", () => assert.ok(existsSync(path.join(root, ARQUIVO))));

test("avulsa completa e fixa não têm erro", () => {
  const { validarOperacaoAvulsa } = carregar();
  assert.deepEqual(validarOperacaoAvulsa(base, { valorTravado: false }), []);
  assert.deepEqual(
    validarOperacaoAvulsa(
      { ...base, type: "fixed", operation_date: "", agreed_amount: "" },
      {
        valorTravado: false,
      },
    ),
    [],
  );
});

test("data obrigatória", () => {
  const { validarOperacaoAvulsa } = carregar();
  assert.deepEqual(
    validarOperacaoAvulsa({ ...base, operation_date: "" }, { valorTravado: false }),
    ["Informe a data da operação avulsa."],
  );
});

test("sem contrato: valor ausente, inválido ou negativo é recusado", () => {
  const { validarOperacaoAvulsa } = carregar();
  const v = (agreed_amount) =>
    validarOperacaoAvulsa({ ...base, agreed_amount }, { valorTravado: false });
  assert.deepEqual(v(""), [
    "Informe o valor acordado por diária (zero só com justificativa em Observações).",
  ]);
  assert.deepEqual(v("abc"), ["Informe um valor acordado válido, sem negativo."]);
  assert.deepEqual(v("-5"), ["Informe um valor acordado válido, sem negativo."]);
});

test("zero só com justificativa em Observações", () => {
  const { validarOperacaoAvulsa } = carregar();
  assert.deepEqual(
    validarOperacaoAvulsa({ ...base, agreed_amount: "0" }, { valorTravado: false }),
    ["Valor zero exige justificativa em Observações."],
  );
  assert.deepEqual(
    validarOperacaoAvulsa(
      { ...base, agreed_amount: "0", notes: "Cortesia acordada com o cliente" },
      { valorTravado: false },
    ),
    [],
  );
});

test("com contrato ou com valor travado pela vigência, o valor não é exigido", () => {
  const { validarOperacaoAvulsa } = carregar();
  assert.deepEqual(
    validarOperacaoAvulsa(
      { ...base, contract_id: "c1", agreed_amount: "" },
      { valorTravado: false },
    ),
    [],
  );
  assert.deepEqual(
    validarOperacaoAvulsa({ ...base, agreed_amount: "" }, { valorTravado: true }),
    [],
  );
});

test("a tela mostra os erros e bloqueia o salvar", () => {
  const tela = readFileSync(
    path.join(root, "src/app/(painel)/operacoes/painel-operacoes.tsx"),
    "utf8",
  );
  assert.match(tela, /const errosDaAvulsa = validarOperacaoAvulsa\(opForm, \{ valorTravado \}\)/);
  assert.match(tela, /errosDaAvulsa\.length > 0/);
  assert.match(tela, /errosDaAvulsa\.map\(/);
});
