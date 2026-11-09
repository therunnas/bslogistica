/**
 * FUNC-READY-01 — partes puras: prévia com a precedência de preço do banco, anúncio do recuo no
 * preço-base (048) e lote de correção de container (049). O comportamento gravado é provado em
 * `scripts/testar-fluxos-local.sh` (Supabase local) e nas suítes SQL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicarPrecedenciaDoPreco } from "../src/lib/preco-do-dia.ts";
import { interpretarPrecoBaseRecuo } from "../src/lib/tarifas.ts";
import { loteParaCorrecao } from "../src/lib/container-servico-dados.ts";
import { prepararLoteDeContainers } from "../src/lib/container-servico.ts";

const condicao = {
  ok: true,
  regras: { daily_rate: 150, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 },
  custoDiario: 100,
  origem: "versao",
};
const individual = (o = {}) => ({
  id: "i1",
  contract_id: "K",
  employee_id: "A",
  valid_from: "2026-10-01",
  valid_to: null,
  daily_rate: "260.00",
  active: true,
  ...o,
});
const tarifa = (o = {}) => ({
  id: "t1",
  contract_id: "K",
  job_function_id: "F-op",
  shift_period: "diurno",
  valid_from: "2026-10-01",
  valid_to: null,
  daily_rate: "170.00",
  active: true,
  ...o,
});
const p = (o = {}) => ({
  resolucaoLigada: true,
  recuoNoPrecoBase: true,
  contratoId: "K",
  colaboradorId: "A",
  data: "2026-10-07",
  funcaoId: "F-op",
  periodo: "diurno",
  individuais: [individual()],
  tarifas: [tarifa()],
  ...o,
});

test("resolução desligada ou operação sem contrato: a condição não muda (preço-base / valor acordado)", () => {
  assert.equal(aplicarPrecedenciaDoPreco(condicao, p({ resolucaoLigada: false })), condicao);
  assert.equal(aplicarPrecedenciaDoPreco(condicao, p({ contratoId: null })), condicao);
});

test("1º diária individual vigente prevalece sobre a tarifa da função", () => {
  const r = aplicarPrecedenciaDoPreco(condicao, p());
  assert.equal(r.regras.daily_rate, 260);
  assert.equal(r.fonte, "individual");
});

test("2º tarifa da função e do período quando não há individual (ou ela não vale na data)", () => {
  const r = aplicarPrecedenciaDoPreco(
    condicao,
    p({ individuais: [individual({ valid_to: "2026-10-07" })] }),
  );
  assert.equal(r.regras.daily_rate, 170);
  assert.equal(r.fonte, "funcao_periodo");
  const outroPeriodo = aplicarPrecedenciaDoPreco(
    condicao,
    p({ individuais: [], periodo: "noturno" }),
  );
  assert.equal(outroPeriodo.fonte, "preco_base", "tarifa do diurno não vale no noturno");
});

test("3º preço-base só com o recuo (048); sem ele, a prévia avisa que o banco recusa", () => {
  const com = aplicarPrecedenciaDoPreco(condicao, p({ individuais: [], tarifas: [] }));
  assert.equal(com.regras.daily_rate, 150);
  assert.equal(com.fonte, "preco_base");
  const sem = aplicarPrecedenciaDoPreco(
    condicao,
    p({ individuais: [], tarifas: [], recuoNoPrecoBase: false }),
  );
  assert.equal(sem.ok, false);
  assert.match(sem.motivo, /recusa/);
});

test("versões aposentadas, de outro contrato ou de outro colaborador não contam", () => {
  const r = aplicarPrecedenciaDoPreco(
    condicao,
    p({
      individuais: [
        individual({ active: false }),
        individual({ contract_id: "X" }),
        individual({ employee_id: "B" }),
      ],
      tarifas: [tarifa({ active: false })],
    }),
  );
  assert.equal(r.fonte, "preco_base");
});

test("sem função, sem período ou com leitura pendente: nunca mostra número", () => {
  assert.match(aplicarPrecedenciaDoPreco(condicao, p({ funcaoId: null })).motivo, /função/);
  assert.match(
    aplicarPrecedenciaDoPreco(condicao, p({ periodo: null })).motivo,
    /diurno ou noturno/,
  );
  assert.match(aplicarPrecedenciaDoPreco(condicao, p({ tarifas: null })).motivo, /consultando/);
  const indisponivel = { ok: false, motivo: "x" };
  assert.equal(aplicarPrecedenciaDoPreco(indisponivel, p()), indisponivel);
});

test("anúncio do recuo: só true explícito; erro ou ausência = regra antiga", () => {
  assert.equal(interpretarPrecoBaseRecuo({ preco_base_recuo: true }, null), true);
  assert.equal(interpretarPrecoBaseRecuo({}, null), false);
  assert.equal(interpretarPrecoBaseRecuo({ preco_base_recuo: true }, { code: "x" }), false);
  assert.equal(interpretarPrecoBaseRecuo(null, null), false);
});

const detalhe = {
  servico: {
    id: "s1",
    client_id: "c1",
    operation_id: "o1",
    requested_on: "2026-09-02",
    executed_on: "2026-09-03",
    description: "Descarga",
    quantity: 2,
    revenue_cents: 30000,
    cost_total_cents: 7501,
    reference: null,
    cost_mode: "total_distribuido",
    billing_additional_id: "b1",
    canceled_at: null,
    invoice_id: null,
    cliente_nome: "C",
    operacao_nome: "O",
    situacao: "disponivel",
  },
  participantes: [
    { employee_id: "e1", nome: "A", cost_cents: 4000 },
    { employee_id: "e2", nome: "B", cost_cents: 3501 },
  ],
  auditoria: [],
  competencia: { inicio: "2026-09-01", fim: "2026-09-15" },
  substituidoPor: null,
};

test("correção de container: o lote pré-preenchido reproduz EXATAMENTE o serviço gravado", () => {
  const lote = loteParaCorrecao(detalhe);
  assert.equal(lote.totalCobrado, "300,00");
  assert.equal(lote.totalDistribuido, "75,01");
  assert.deepEqual(
    lote.participantes.map((x) => x.valorDevido),
    ["40,00", "35,01"],
  );
  const n = prepararLoteDeContainers(lote);
  assert.equal(n.receitaCentavos, 30000);
  assert.equal(n.custoTotalCentavos, 7501);
  assert.deepEqual(n.competenciaCobranca, { inicio: "2026-09-01", fim: "2026-09-15" });
  const porPessoa = loteParaCorrecao({
    ...detalhe,
    servico: { ...detalhe.servico, cost_mode: "por_pessoa" },
  });
  assert.equal(porPessoa.totalDistribuido, null);
});

test("telas: Corrigir só com o anúncio e só para serviço disponível; leitor aceita a trilha de correção", () => {
  const det = readFileSync("src/app/(painel)/containers/detalhe-container.tsx", "utf8");
  const dados = readFileSync("src/lib/container-servico-dados.ts", "utf8");
  const form = readFileSync("src/app/(painel)/containers/formulario-container.tsx", "utf8");
  assert.match(det, /servico\.situacao === "disponivel" && podeCorrigir/);
  assert.match(dados, /\["registered", "canceled", "corrected"\]/);
  assert.match(dados, /"correcao_container"\] === true/);
  assert.match(form, /disabled=\{!!correcao \|\|/);
  assert.match(form, /corrigirContainerAction\(/);
});
