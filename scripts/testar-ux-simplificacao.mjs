/**
 * UX-SIMPLIFICACAO-01 — textos derivados das telas de Operações e Containers.
 * Só apresentação: nenhum valor é decidido aqui (o banco continua decidindo).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { modalidadeDaOperacao } from "../src/lib/operacao-modalidade.ts";
import { resumoDoServico } from "../src/lib/container-servico-resumo.ts";

test("operação fixa com contrato: cobrada pelo contrato", () => {
  const m = modalidadeDaOperacao(
    { type: "fixed", contract_id: "c1", agreed_amount: null },
    "Contrato A",
  );
  assert.equal(m.tipo, "fixa");
  assert.equal(m.rotulo, "Fixa");
  assert.equal(m.cobranca, "Preço do contrato Contrato A");
});

test("operação avulsa com contrato: preço do contrato, sem valor próprio", () => {
  const m = modalidadeDaOperacao(
    { type: "spot", contract_id: "c1", agreed_amount: 90 },
    "Contrato A",
  );
  assert.equal(m.tipo, "avulsa");
  assert.equal(m.cobranca, "Preço do contrato Contrato A");
});

test("operação avulsa sem contrato: valor acordado POR DIÁRIA, com unidade explícita", () => {
  const m = modalidadeDaOperacao({ type: "spot", contract_id: null, agreed_amount: 150 }, null);
  assert.match(m.cobranca, /^Valor acordado R\$\s?150,00 por diária$/);
});

test("sem contrato e sem valor: pendência visível, nunca R$ 0 implícito", () => {
  const m = modalidadeDaOperacao({ type: "spot", contract_id: null, agreed_amount: null }, null);
  assert.equal(m.cobranca, "Sem regra de cobrança definida");
  assert.equal(m.pendente, true);
});

test("tipo desconhecido não vira fixa nem avulsa", () => {
  const m = modalidadeDaOperacao({ type: "outro", contract_id: null, agreed_amount: null }, null);
  assert.equal(m.tipo, "outro");
  assert.equal(m.rotulo, "Sem classificação");
});

const servico = (o = {}) => ({
  quantity: 3,
  revenue_cents: 90000,
  cost_total_cents: 54000,
  situacao: "disponivel",
  ...o,
});

test("container: valor negociado é o TOTAL do serviço, com a quantidade", () => {
  const r = resumoDoServico(servico());
  assert.match(r.valorNegociado, /^R\$\s?900,00 no total · 3 containers$/);
});

test("container: resultado bruto = receita − custo, em centavos inteiros", () => {
  assert.equal(resumoDoServico(servico()).resultadoCentavos, 36000);
  assert.equal(resumoDoServico(servico({ cost_total_cents: 100000 })).resultadoCentavos, -10000);
  assert.equal(resumoDoServico(servico({ cost_total_cents: 100000 })).negativo, true);
});

test("container: singular e situação do faturamento", () => {
  assert.match(resumoDoServico(servico({ quantity: 1 })).valorNegociado, /1 container$/);
  assert.equal(resumoDoServico(servico()).situacao, "Disponível para faturar");
  assert.equal(resumoDoServico(servico({ situacao: "faturado" })).situacao, "Faturado");
  assert.equal(resumoDoServico(servico({ situacao: "cancelado" })).situacao, "Cancelado");
});
