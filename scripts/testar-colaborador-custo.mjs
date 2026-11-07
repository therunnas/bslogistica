/**
 * UX-SIMPLIFICACAO-01 — custo do colaborador editado no próprio cadastro.
 * O planejador decide se o custo mudou e monta a NOVA VIGÊNCIA pelo mecanismo existente
 * (montarRegistro/registrar_custo_colaborador): histórico preservado, sem retroagir, sem conflito
 * na mesma data, valor-hora acordado mantido.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  custosVigentesPorColaborador,
  planejarNovoCusto,
  textoDaConfirmacao,
} from "../src/lib/colaborador-custo.ts";
import { montarRegistro } from "../src/lib/vigencias-ui.ts";

const HOJE = "2026-11-07";
const versao = (o) => ({
  id: o.id ?? "v1",
  valid_from: o.valid_from,
  valid_to: o.valid_to ?? null,
  active: o.active ?? true,
  origin: "informada",
  reason: "x",
  created_at: "2026-01-01T00:00:00Z",
  retired_at: null,
  daily_cost: o.daily_cost,
  ot_hourly_cost: o.ot_hourly_cost ?? null,
});
const base = (o = {}) => ({
  versoes: [versao({ valid_from: "2026-10-01", daily_cost: "120.00", ot_hourly_cost: "22.50" })],
  custoAtual: 120,
  novoCusto: "135,50",
  inicio: HOJE,
  motivo: "Reajuste combinado",
  hoje: HOJE,
  regrasBs: true,
  regrasDefinitivas: false,
  periodoContratual: false,
  ...o,
});

test("custo igual ao atual: não registra vigência nova", () => {
  const p = planejarNovoCusto(base({ novoCusto: "120,00" }));
  assert.equal(p.muda, false);
  assert.equal(p.form, null);
  assert.deepEqual(p.erros, []);
});

test("custo novo hoje: vigência que encerra a anterior, mantém o valor-hora e passa pela RPC existente", () => {
  const p = planejarNovoCusto(base());
  assert.equal(p.muda, true);
  assert.deepEqual(p.erros, []);
  assert.equal(p.form.inicio, HOJE);
  assert.equal(p.form.encerrarAnterior, true);
  assert.equal(p.form.valores.daily_cost, "135,50");
  assert.equal(
    p.form.valores.ot_hourly_cost,
    "22.50",
    "o valor-hora acordado não pode sumir em silêncio",
  );
  const { rpc, params } = montarRegistro("colaborador", "emp-1", p.form);
  assert.equal(rpc, "registrar_custo_colaborador");
  assert.equal(params.p_daily_cost, 135.5);
  assert.equal(params.p_ot_hourly_cost, 22.5);
  assert.equal(params.p_valid_from, HOJE);
  assert.equal(params.p_encerrar_anterior, true);
  assert.equal(params.p_reason, "Reajuste combinado");
});

test("data no passado é recusada: correção retroativa só pelo histórico", () => {
  const p = planejarNovoCusto(base({ inicio: "2026-11-01" }));
  assert.equal(p.form, null);
  assert.match(p.erros.join(" "), /anterior a hoje/);
});

test("data futura é aceita e aparece como programada", () => {
  const p = planejarNovoCusto(base({ inicio: "2026-12-01" }));
  assert.deepEqual(p.erros, []);
  assert.match(textoDaConfirmacao(p, "Ana"), /01\/12\/2026/);
});

test("conflito: já existe custo começando na mesma data", () => {
  const p = planejarNovoCusto(
    base({ versoes: [versao({ valid_from: HOJE, daily_cost: "120.00" })] }),
  );
  assert.equal(p.form, null);
  assert.match(p.erros.join(" "), /mesma data/);
});

test("custo futuro já programado bloqueia o atalho (evita sobrepor vigências)", () => {
  const p = planejarNovoCusto(
    base({
      versoes: [
        versao({ id: "a", valid_from: "2026-10-01", valid_to: "2026-12-01", daily_cost: "120.00" }),
        versao({ id: "b", valid_from: "2026-12-01", daily_cost: "130.00" }),
      ],
    }),
  );
  assert.equal(p.form, null);
  assert.match(p.erros.join(" "), /programado/);
});

test("motivo vazio e valor inválido seguem as regras da vigência", () => {
  assert.match(planejarNovoCusto(base({ motivo: " " })).erros.join(" "), /motivo/i);
  assert.match(planejarNovoCusto(base({ novoCusto: "-5" })).erros.join(" "), /válido/);
  assert.match(planejarNovoCusto(base({ novoCusto: "1,234" })).erros.join(" "), /duas casas/);
});

test("versões aposentadas não contam como vigente nem como conflito", () => {
  const p = planejarNovoCusto(
    base({
      versoes: [
        versao({ id: "x", valid_from: HOJE, daily_cost: "999.00", active: false }),
        versao({ id: "y", valid_from: "2026-10-01", daily_cost: "120.00" }),
      ],
    }),
  );
  assert.deepEqual(p.erros, []);
});

test("confirmação diz valor novo, data e que o passado não muda", () => {
  const t = textoDaConfirmacao(planejarNovoCusto(base()), "Ana");
  assert.match(t, /R\$\s?135,50/);
  assert.match(t, /07\/11\/2026/);
  assert.match(t, /anteriores/);
});

test("compara com o custo EM VIGOR, não com o valor legado do cadastro", () => {
  // Cadastro ainda diz 100, mas a vigência de hoje já é 110: digitar 110 não gera nada novo.
  const igual = planejarNovoCusto(
    base({
      custoAtual: 100,
      novoCusto: "110,00",
      versoes: [versao({ valid_from: "2026-10-01", daily_cost: "110.00" })],
    }),
  );
  assert.equal(igual.muda, false);
  // E voltar a 100 é uma mudança real (seria engolida se a comparação usasse o cadastro).
  const volta = planejarNovoCusto(
    base({
      custoAtual: 100,
      novoCusto: "100,00",
      inicio: "2026-11-20",
      versoes: [versao({ valid_from: "2026-10-01", daily_cost: "110.00" })],
    }),
  );
  assert.equal(volta.muda, true);
  assert.deepEqual(volta.erros, []);
});

test("sem versão vigente, a comparação recorre ao valor do cadastro", () => {
  const p = planejarNovoCusto(base({ versoes: [], custoAtual: 120, novoCusto: "120,00" }));
  assert.equal(p.muda, false);
});

test("lista: custo vigente por colaborador; futura, encerrada e aposentada não contam", () => {
  const v = (id, employee_id, o) => ({ ...versao({ id, ...o }), employee_id });
  const mapa = custosVigentesPorColaborador(
    [
      v("a", "e1", { valid_from: "2026-01-01", valid_to: HOJE, daily_cost: "100.00" }),
      v("b", "e1", { valid_from: HOJE, daily_cost: "110.00" }),
      v("c", "e2", { valid_from: "2026-12-01", daily_cost: "90.00" }),
      v("d", "e3", { valid_from: "2026-01-01", daily_cost: "80.00", active: false }),
    ],
    HOJE,
  );
  assert.equal(mapa.get("e1"), 110);
  assert.equal(mapa.has("e2"), false, "só futura: sem custo vigente, a tela mostra a pendência");
  assert.equal(mapa.has("e3"), false);
});
