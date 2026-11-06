/**
 * Regressão S19C-DEF-003: o histórico de vigências entra como item de grid nos
 * diálogos de edição (colaborador, contrato, operação). Com `min-width: auto`
 * a largura mínima da tabela vaza para o grid inteiro do diálogo: os campos
 * ficam mais largos que o diálogo e são cortados à direita. `min-w-0` deixa a
 * tabela rolar no próprio `overflow-x-auto`. Não acessa banco, rede ou sessão.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const fonte = readFileSync(path.join(root, "src/app/(painel)/_components/vigencias.tsx"), "utf8");

test("seção do histórico de vigências pode encolher dentro do grid do diálogo", () => {
  const secao = fonte.match(/<section\s+className="([^"]*)"/);
  assert.ok(secao, "seção do histórico não encontrada");
  assert.match(secao[1], /\bmin-w-0\b/);
});

test("tabela continua com rolagem horizontal própria", () => {
  assert.match(fonte, /<div className="overflow-x-auto">\s*<Table>/);
});
