/**
 * Paridade financeira entre a prévia (`src/lib/billing.ts`) e o banco (C04).
 *
 * COMO RODAR:
 *
 *   npm run test:paridade-financeira
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente de
 * zero em qualquer falha. Não usa rede nem banco.
 *
 * O DEFEITO QUE ESTA SUÍTE GUARDA
 *
 * `derivar_valores_financeiros()` (migration 010) grava `ROUND((valor * 100)::numeric) / 100`.
 * O cast de `double precision` para `numeric` mantém 15 dígitos significativos e absorve o
 * ruído binário; o `ROUND` de `numeric` arredonda o meio centavo para cima. A prévia usava
 * `Math.round` direto sobre o produto cru, que num empate exato (120,825) chega como
 * 12082,499999999998 e caía para 120,82 — um centavo abaixo do que o banco grava (120,83).
 * A C04.1 mediu 4.222 divergências em 600.840 cenários, todas nesse empate.
 *
 * DE ONDE VÊM OS NÚMEROS ESPERADOS (nenhum sai de `calcEntry()` ou de `round2()`)
 *
 *   1. CONSTANTES FIXAS, calculadas por aritmética exata (frações) — grupos A a H.
 *   2. FIXTURE DO BANCO: `scripts/fixtures/paridade-financeira-sql.json`, gravada a partir
 *      da execução do TRIGGER REAL (PostgreSQL 17.6 local e descartável, em transação
 *      desfeita) com as mesmas entradas. É a paridade de fato, caso a caso.
 *   3. ORÁCULO INDEPENDENTE: aritmética racional com `BigInt` escrita neste arquivo, que
 *      não importa nada de `billing.ts`. Valida a fixture e uma grade grande.
 *
 * ESCOPO: só o arredondamento da prévia. Não cobre `invoice_items`, margem percentual,
 * fechamento, nem regras de RLS ou triggers (tratados em frentes próprias).
 */

import { existsSync, readFileSync } from "node:fs";

import {
  calcEntry,
  margin,
  marginPct,
  round2,
  shiftPlannedMinutes,
  workedMinutes,
} from "../src/lib/billing.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (Object.is(obtido, esperado) || obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${esperado}, obtido ${obtido}`);
    console.log(`  FAIL  ${caso} — esperado ${esperado}, obtido ${obtido}`);
  }
}

/** Um lote de comparações: conta cada caso como asserção e lista só as primeiras falhas. */
function verificarLote(nome, total, divergentes) {
  if (divergentes.length === 0) {
    passou += total;
    console.log(`  PASS  ${nome} (${total} casos)`);
  } else {
    passou += total - divergentes.length;
    for (const d of divergentes.slice(0, 5)) falhas.push(`${nome} — ${d}`);
    if (divergentes.length > 5)
      falhas.push(`${nome} — e mais ${divergentes.length - 5} divergência(s)`);
    console.log(
      `  FAIL  ${nome} — ${divergentes.length} de ${total} diferentes. Primeiras: ${divergentes.slice(0, 3).join("; ")}`,
    );
  }
}

const cents = (reais) => Math.round(reais * 100);
const hhmm = (m) =>
  String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

const TURNO_06_15 = {
  start_time: "06:00:00",
  end_time: "15:00:00",
  break_minutes: 60,
  crosses_midnight: false,
};

/** Atalho: apontamento com turno 06:00–15:00 (480 min líquidos) e horas extras em minutos. */
function calcular({
  diaria,
  custo,
  shiftHours = 8,
  fator = 1,
  tolerancia = 10,
  extra = 0,
  status = "present",
  turno = TURNO_06_15,
}) {
  const planned = shiftPlannedMinutes(turno);
  const saida = 6 * 60 + planned + turno.break_minutes + extra;
  return calcEntry({
    status,
    checkIn: "06:00",
    checkOut: hhmm(saida),
    breakMinutes: turno.break_minutes,
    plannedMinutes: planned,
    rules: {
      daily_rate: diaria,
      shift_hours: shiftHours,
      ot_factor: fator,
      ot_tolerance_min: tolerancia,
    },
    employeeDailyCost: custo,
  });
}

// ---------------------------------------------------------------------------
// ORÁCULO INDEPENDENTE (BigInt). Não usa billing.ts.
// Entradas em centésimos: diária e custo em centavos, shift_hours e fator em centésimos.
// Receita (centavos) = dr + dr * f * ot / (sh * 60), com ot em minutos (possivelmente
// fracionário quando não há turno: planejado = shift_hours * 60), meio centavo para cima.
// ---------------------------------------------------------------------------

const centesimos = (texto) => {
  const [i, d = ""] = String(texto).split(".");
  return BigInt(i) * 100n + BigInt((d + "00").slice(0, 2));
};

function oraculo({ dr, dc, sh, f, tol, planned, worked, status = "present" }) {
  const DR = centesimos(dr);
  const DC = centesimos(dc);
  let SH = centesimos(sh);
  let F = centesimos(f);
  if (SH <= 0n) SH = 800n; // shift_hours <= 0 vale 8
  if (F === 0n) F = 100n; // fator 0 vale 1
  if (status === "absent") return { b: 0n, c: 0n };
  // excesso = trabalhado - planejado; planejado = planned (min inteiros) ou sh * 60 (sem turno)
  const [exN, exD] =
    planned > 0 ? [BigInt(worked - planned), 1n] : [100n * BigInt(worked) - 60n * SH, 100n];
  const acima = exN > BigInt(tol) * exD; // excesso > tolerância
  const [otN, otD] = acima ? [exN, exD] : [0n, 1n];
  const D = SH * 60n * otD;
  const meioParaCima = (N, Dn) => (2n * N + Dn) / (2n * Dn);
  return {
    b: meioParaCima(DR * D + DR * F * otN, D),
    c: meioParaCima(DC * D + 100n * DC * otN, D),
  };
}

// ---------------------------------------------------------------------------
// A. RECEITA COM EMPATE EM MEIO CENTAVO (esperado: aritmética exata, meio para cima)
// ---------------------------------------------------------------------------

console.log("A. Receita com empate em meio centavo");

// R$ 81,00, 8 h, fator 2,00, 118 min: 81 + (118/60) * (81/8 * 2) = 81 + 39,825 = 120,825 -> 120,83
verificar(
  "A1. R$ 81,00 / 8 h / fator 2,00 / 118 min -> R$ 120,83 (o banco grava 120,83)",
  calcular({ diaria: 81, custo: 50, fator: 2, extra: 118 }).billedAmount,
  120.83,
);
const TURNO_10H = { ...TURNO_06_15, end_time: "17:00:00" };
// R$ 81,00, 10 h, fator 1,50, 82 min: 81 + (82/60) * (81/10 * 1,5) = 81 + 16,605 = 97,605 -> 97,61
verificar(
  "A2. R$ 81,00 / 10 h / fator 1,50 / 82 min -> R$ 97,61",
  calcular({ diaria: 81, custo: 50, shiftHours: 10, fator: 1.5, turno: TURNO_10H, extra: 82 })
    .billedAmount,
  97.61,
);
// R$ 81,00, 10 h, fator 1,00, 123 min: 81 + (123/60) * 8,1 = 81 + 16,605 = 97,605 -> 97,61
verificar(
  "A3. R$ 81,00 / 10 h / fator 1,00 / 123 min -> R$ 97,61",
  calcular({ diaria: 81, custo: 50, shiftHours: 10, fator: 1, turno: TURNO_10H, extra: 123 })
    .billedAmount,
  97.61,
);
// R$ 81,00, 8 h, fator 2,00, 138 min: 81 + (138/60) * 20,25 = 81 + 46,575 = 127,575 -> 127,58
verificar(
  "A4. R$ 81,00 / 8 h / fator 2,00 / 138 min -> R$ 127,58",
  calcular({ diaria: 81, custo: 50, fator: 2, extra: 138 }).billedAmount,
  127.58,
);

// ---------------------------------------------------------------------------
// B. CUSTO COM EMPATE EM MEIO CENTAVO
// ---------------------------------------------------------------------------

console.log("B. Custo com empate em meio centavo");

// custo R$ 52,08, 8 h, 150 min: 52,08 + 2,5 * (52,08/8 = 6,51) = 52,08 + 16,275 = 68,355 -> 68,36
verificar(
  "B1. custo R$ 52,08 / 8 h / 150 min -> R$ 68,36 (o banco grava 68,36)",
  calcular({ diaria: 84, custo: 52.08, extra: 150 }).costAmount,
  68.36,
);
verificar(
  "B2. na mesma linha a receita (R$ 84,00 + 2,5 * 10,50) é exata: R$ 110,25",
  calcular({ diaria: 84, custo: 52.08, extra: 150 }).billedAmount,
  110.25,
);

// ---------------------------------------------------------------------------
// C. HORA EXTRA SEM TURNO CADASTRADO (planejado = shift_hours * 60)
// ---------------------------------------------------------------------------

console.log("C. Hora extra sem turno cadastrado");

// R$ 50,94, 7,2 h, fator 1,30, trabalhou 552 min: planejado 432, excesso 120 min (2 h)
// receita = 50,94 + 2 * (50,94/7,2 * 1,3) = 50,94 + 18,395 = 69,335 -> 69,34
const semTurno = calcEntry({
  status: "present",
  checkIn: "00:00",
  checkOut: hhmm(552),
  breakMinutes: 0,
  plannedMinutes: 0,
  rules: { daily_rate: 50.94, shift_hours: 7.2, ot_factor: 1.3, ot_tolerance_min: 10 },
  employeeDailyCost: 91.51,
});
verificar(
  "C1. sem turno: R$ 50,94 / 7,2 h / fator 1,30 / 120 min extras -> R$ 69,34",
  semTurno.billedAmount,
  69.34,
);
verificar(
  "C2. sem turno: o excesso é calculado sobre shift_hours * 60 (120 min)",
  Math.round(semTurno.overtimeMinutes),
  120,
);

// ---------------------------------------------------------------------------
// D. DIÁRIA SEM HORA EXTRA   E. TOLERÂNCIA   F. FALTA
// ---------------------------------------------------------------------------

console.log("D. Diária sem hora extra");
const semExtra = calcular({ diaria: 123.45, custo: 67.89, extra: 0 });
verificar("D1. jornada cumprida -> só a diária (receita)", semExtra.billedAmount, 123.45);
verificar("D2. jornada cumprida -> só o custo do colaborador", semExtra.costAmount, 67.89);
verificar(
  "D3. jornada incompleta não gera hora extra nem desconto",
  calcular({ diaria: 100, custo: 50, extra: -120 }).billedAmount,
  100,
);

console.log("E. Tolerância de horas extras");
verificar(
  "E1. exatamente na tolerância (10 min) -> sem hora extra",
  calcular({ diaria: 100, custo: 50, fator: 1.5, extra: 10 }).billedAmount,
  100,
);
verificar(
  "E2. 1 min acima da tolerância (11 min): 100 + (11/60) * 18,75 = 103,4375 -> 103,44",
  calcular({ diaria: 100, custo: 50, fator: 1.5, extra: 11 }).billedAmount,
  103.44,
);
verificar(
  "E3. tolerância 0 e 1 min extra: 100 + (1/60) * 18,75 = 100,3125 -> 100,31",
  calcular({ diaria: 100, custo: 50, fator: 1.5, tolerancia: 0, extra: 1 }).billedAmount,
  100.31,
);
verificar(
  "E4. minutos pagos são o excesso inteiro, não só o que passa da tolerância",
  calcular({ diaria: 100, custo: 50, extra: 11 }).overtimeMinutes,
  11,
);

console.log("F. Falta");
const falta = calcular({ diaria: 100, custo: 50, fator: 1.5, extra: 200, status: "absent" });
verificar("F1. falta -> receita 0", falta.billedAmount, 0);
verificar("F2. falta -> custo 0", falta.costAmount, 0);
verificar(
  "F3. falta -> sem minutos trabalhados nem extras",
  falta.workedMinutes + falta.overtimeMinutes,
  0,
);
verificar(
  "F4. falta mantém a diária e o custo de referência",
  `${falta.dailyRate}/${falta.dailyCost}`,
  "100/50",
);
verificar(
  "F5. substituto é cobrado como presente (100 + 3 * 18,75 = 156,25)",
  calcular({ diaria: 100, custo: 50, fator: 1.5, extra: 180, status: "replacement" }).billedAmount,
  156.25,
);

// ---------------------------------------------------------------------------
// G. FATORES E JORNADAS VÁLIDOS   H. ARREDONDAMENTOS SUCESSIVOS
// ---------------------------------------------------------------------------

console.log("G. Fatores e jornadas válidos");
verificar(
  "G1. shift_hours 0 vale 8: 100 + 2 * 12,5 = 125",
  calcular({ diaria: 100, custo: 50, shiftHours: 0, extra: 120 }).billedAmount,
  125,
);
verificar(
  "G2. fator 0 vale 1: 100 + 2 * 12,5 = 125",
  calcular({ diaria: 100, custo: 50, fator: 0, extra: 120 }).billedAmount,
  125,
);
verificar(
  "G3. fator 2,00: 100 + 2 * 25 = 150",
  calcular({ diaria: 100, custo: 50, fator: 2, extra: 120 }).billedAmount,
  150,
);
verificar(
  "G4. jornada de 12 h: 120 + 1 * 10 = 130",
  calcular({
    diaria: 120,
    custo: 60,
    shiftHours: 12,
    turno: { ...TURNO_06_15, end_time: "19:00:00" },
    extra: 60,
  }).billedAmount,
  130,
);
verificar(
  "G5. turno que vira o dia (22:00 a 06:00, 60 min de intervalo): 420 min líquidos",
  shiftPlannedMinutes({
    start_time: "22:00:00",
    end_time: "06:00:00",
    break_minutes: 60,
    crosses_midnight: true,
  }),
  420,
);
verificar(
  "G6. trabalhado atravessando a meia-noite: 22:00 a 08:30 com 60 min de intervalo = 570",
  workedMinutes("22:00", "08:30", 60),
  570,
);

console.log("H. Arredondamentos sucessivos");
verificar(
  "H1. valor com dízima: 100 + (11/60) * 12,5 = 102,2916… -> 102,29",
  calcular({ diaria: 100, custo: 50, extra: 11 }).billedAmount,
  102.29,
);
verificar(
  "H2. custo com dízima: 50 + (11/60) * 6,25 = 51,1458… -> 51,15",
  calcular({ diaria: 100, custo: 50, extra: 11 }).costAmount,
  51.15,
);
// A dízima binária não pode mudar o desempate nos empates exatos de meio centavo.
const empatesPuros = [
  [1.005, 1.01],
  [2.675, 2.68],
  [1.015, 1.02],
  [1.025, 1.03],
  [1.035, 1.04],
  [1.045, 1.05],
  [8.325, 8.33],
  [10.075, 10.08],
  [120.825, 120.83],
  [68.355, 68.36],
];
for (const [entrada, esperado] of empatesPuros)
  verificar(`H3. round2(${entrada}) -> ${esperado}`, round2(entrada), esperado);
verificar("H4. round2 é idempotente em valor já arredondado", round2(round2(120.825)), 120.83);

// ---------------------------------------------------------------------------
// I. ACUMULAÇÕES MONETÁRIAS (oráculo em centavos inteiros)
// ---------------------------------------------------------------------------

console.log("I. Acumulações monetárias");
let semente = 20261020;
const aleatorio = () => (semente = (semente * 1664525 + 1013904223) >>> 0) / 2 ** 32;
{
  const divergentes = [];
  const totalConjuntos = 300;
  for (let s = 0; s < totalConjuntos; s++) {
    const n = 1 + Math.floor(aleatorio() * 2500);
    let soma = 0;
    let exato = 0n;
    for (let i = 0; i < n; i++) {
      const c = 1 + Math.floor(aleatorio() * 60000);
      soma += c / 100;
      exato += BigInt(c);
    }
    if (BigInt(Math.round(round2(soma) * 100)) !== exato)
      divergentes.push(`conjunto ${s} (${n} valores)`);
  }
  verificarLote(
    "I1. round2 da soma em ponto flutuante = soma exata em centavos",
    totalConjuntos,
    divergentes,
  );
}
verificar("I2. 0,10 + 0,20 -> 0,30", round2(0.1 + 0.2), 0.3);
verificar(
  "I3. margem de valores de centavos exatos: 1476,60 - 723,45 = 753,15",
  margin(1476.6, 723.45),
  753.15,
);
verificar(
  "I4. margem negativa mantém o sinal: 100,00 - 150,50 = -50,50",
  margin(100, 150.5),
  -50.5,
);
verificar("I5. margem percentual sem receita é 0", marginPct(0, 10), 0);

// ---------------------------------------------------------------------------
// J. VALORES LIMÍTROFES PERMITIDOS (numeric(12,2); shift_hours e fator numeric(5,2))
// ---------------------------------------------------------------------------

console.log("J. Valores limítrofes permitidos");
verificar("J1. round2(0) = 0", round2(0), 0);
verificar("J2. round2(0,01) = 0,01", round2(0.01), 0.01);
verificar(
  "J3. maior valor de numeric(12,2) não muda: 9999999999,99",
  round2(9999999999.99),
  9999999999.99,
);
verificar("J4. round2(undefined) = 0", round2(undefined), 0);
verificar("J5. round2(NaN) = 0", round2(Number.NaN), 0);
verificar(
  "J6. round2(Infinity) segue Infinity (fora do domínio, comportamento anterior)",
  round2(Infinity),
  Infinity,
);
verificar(
  "J7. negativo: round2(-0,005) não vira -0,01 (semântica anterior do Math.round, meio para +infinito)",
  round2(-0.005) === 0,
  true,
);
verificar(
  "J8. diária 0 e custo 0 com hora extra -> 0",
  calcular({ diaria: 0, custo: 0, fator: 1.5, extra: 120 }).billedAmount,
  0,
);

// ---------------------------------------------------------------------------
// K. REGRESSÕES DAS REGRAS EXISTENTES
// ---------------------------------------------------------------------------

console.log("K. Regressões das regras existentes");
{
  // O arredondamento novo não pode alterar nenhum valor "normal": todo valor de centavos exatos passa igual.
  const divergentes = [];
  const total = 200000;
  for (let i = 0; i < total; i++) {
    const reais = Math.floor(aleatorio() * 1_000_000_000) / 100;
    if (round2(reais) !== reais) divergentes.push(`${reais}`);
  }
  verificarLote("K1. round2 não altera valor que já está em centavos", total, divergentes);
}
// O defeito existia: o arredondamento antigo (colado aqui como sentinela) erra os dois casos obrigatórios.
const round2Antigo = (v) => Math.round((Number(v) || 0) * 100) / 100;
verificar(
  "K2. sentinela: o arredondamento antigo dava 120,82 para 81 + 39,825 (o teste A1 pega o defeito)",
  round2Antigo(81 + (118 / 60) * ((81 / 8) * 2)),
  120.82,
);
verificar(
  "K3. sentinela: o arredondamento antigo dava 68,35 para 52,08 + 16,275 (o teste B1 pega o defeito)",
  round2Antigo(52.08 + (150 / 60) * (52.08 / 8)),
  68.35,
);
const regras = { daily_rate: 100, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 };
verificar(
  "K4. sem horários o trabalhado é 0 e a receita é a diária",
  calcEntry({
    status: "present",
    checkIn: null,
    checkOut: null,
    breakMinutes: 0,
    plannedMinutes: 480,
    rules: regras,
    employeeDailyCost: 50,
  }).billedAmount,
  100,
);
verificar(
  "K5. shift_hours 0 cai para 8; 06:00 a 17:00 sem intervalo: 660 - 480 = 180 min, 100 + 3 * 18,75 = 156,25",
  calcEntry({
    status: "present",
    checkIn: "06:00",
    checkOut: "17:00",
    breakMinutes: 0,
    plannedMinutes: 480,
    rules: { ...regras, shift_hours: 0 },
    employeeDailyCost: 50,
  }).billedAmount,
  156.25,
);

// ---------------------------------------------------------------------------
// L. PARIDADE COM O BANCO (fixture do trigger real) E ORÁCULO
// ---------------------------------------------------------------------------

console.log("L. Paridade com o trigger real do PostgreSQL (fixture) e com o oráculo exato");

const caminhoFixture = new URL("./fixtures/paridade-financeira-sql.json", import.meta.url);
verificar("L0. a fixture do banco existe", existsSync(caminhoFixture), true);
const fixture = JSON.parse(readFileSync(caminhoFixture, "utf8"));
const turnoDe = (c) =>
  c.shift
    ? {
        start_time: c.shift.start,
        end_time: c.shift.end,
        break_minutes: c.shift.brk,
        crosses_midnight: c.shift.cross,
      }
    : null;
const aCalcular = (c) =>
  calcEntry({
    status: c.status,
    checkIn: c.in,
    checkOut: c.out,
    breakMinutes: c.brk,
    plannedMinutes: shiftPlannedMinutes(turnoDe(c)),
    rules: {
      daily_rate: Number(c.dr),
      shift_hours: Number(c.sh),
      ot_factor: Number(c.f),
      ot_tolerance_min: c.tol,
    },
    employeeDailyCost: Number(c.dc),
  });
{
  const divergentes = [];
  for (const c of fixture.casos) {
    const r = aCalcular(c);
    if (cents(r.billedAmount) !== c.sql.billed || cents(r.costAmount) !== c.sql.cost) {
      divergentes.push(
        `#${c.i} (${c.origem}) ts=${cents(r.billedAmount)}/${cents(r.costAmount)} sql=${c.sql.billed}/${c.sql.cost}`,
      );
    }
  }
  verificarLote(
    `L1. calcEntry = trigger real em ${fixture.casos.length} casos (receita e custo)`,
    fixture.casos.length,
    divergentes,
  );
}
{
  const divergentes = [];
  let comparados = 0;
  for (const c of fixture.casos) {
    if (c.in === null || c.out === null) continue; // sem horários: não há excesso para o oráculo
    comparados++;
    const planejado = shiftPlannedMinutes(turnoDe(c));
    const trabalhado = workedMinutes(c.in, c.out, c.brk);
    const o = oraculo({
      dr: c.dr,
      dc: c.dc,
      sh: c.sh,
      f: c.f,
      tol: c.tol,
      planned: planejado,
      worked: trabalhado,
      status: c.status,
    });
    if (Number(o.b) !== c.sql.billed || Number(o.c) !== c.sql.cost) {
      divergentes.push(`#${c.i} oráculo=${o.b}/${o.c} sql=${c.sql.billed}/${c.sql.cost}`);
    }
  }
  verificarLote(
    "L2. oráculo exato (BigInt) = trigger real: o oráculo é confiável",
    comparados,
    divergentes,
  );
}
{
  const empates = fixture.casos.filter((c) => c.origem === "empate");
  verificar("L3. a fixture contém casos de empate suficientes", empates.length >= 100, true);
  const diferentes = empates.filter((c) => {
    const r = aCalcular(c);
    return cents(r.billedAmount) !== c.sql.billed || cents(r.costAmount) !== c.sql.cost;
  });
  verificar("L4. nenhum empate da fixture diverge do banco", diferentes.length, 0);
}

// Grade grande contra o oráculo exato (determinística, sem banco).
{
  const divergentes = [];
  let total = 0;
  for (let diaria = 80; diaria <= 300; diaria++) {
    for (const sh of [8, 9, 10, 12]) {
      for (const f of [1, 1.5, 2]) {
        const planejado = sh * 60;
        const dc = (Math.round(diaria * 62) / 100).toFixed(2);
        for (let extra = 11; extra <= 60; extra++) {
          total++;
          const r = calcEntry({
            status: "present",
            checkIn: "00:00",
            checkOut: hhmm(planejado + extra),
            breakMinutes: 0,
            plannedMinutes: planejado,
            rules: { daily_rate: diaria, shift_hours: sh, ot_factor: f, ot_tolerance_min: 10 },
            employeeDailyCost: Number(dc),
          });
          const o = oraculo({
            dr: String(diaria),
            dc,
            sh: sh.toFixed(2),
            f: f.toFixed(2),
            tol: 10,
            planned: planejado,
            worked: planejado + extra,
          });
          if (cents(r.billedAmount) !== Number(o.b) || cents(r.costAmount) !== Number(o.c)) {
            divergentes.push(
              `R$ ${diaria} / ${sh} h / x${f} / ${extra} min: ts=${cents(r.billedAmount)}/${cents(r.costAmount)} exato=${o.b}/${o.c}`,
            );
          }
        }
      }
    }
  }
  verificarLote(
    "L5. grade (221 diárias x 4 jornadas x 3 fatores x 50 minutos) = oráculo exato",
    total,
    divergentes,
  );
}

// ---------------------------------------------------------------------------
// M. FORMA DO CÓDIGO (o que não se observa de fora)
// ---------------------------------------------------------------------------

console.log("M. Forma do código, scripts e CI");
const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const billing = semComentarios(ler("src/lib/billing.ts"));
verificar(
  "M1. round2 usa toPrecision(15), como o cast de double para numeric do banco",
  /toPrecision\(15\)/.test(billing),
  true,
);
verificar(
  "M2. o arredondamento cru antigo não voltou",
  /Math\.round\(\(Number\(v\) \|\| 0\) \* 100\)/.test(billing),
  false,
);
verificar(
  "M3. calcEntry continua usando round2 para receita e custo",
  /billedAmount: round2\(/.test(billing) && /costAmount: round2\(/.test(billing),
  true,
);
verificar(
  "M4. as fórmulas comerciais seguem as mesmas (diária / horas do turno x fator)",
  /rules\.daily_rate \/ shiftHours\) \* \(rules\.ot_factor \|\| 1\)/.test(billing),
  true,
);
const pacote = JSON.parse(ler("package.json"));
verificar(
  "M5. package.json tem o script test:paridade-financeira",
  typeof pacote.scripts["test:paridade-financeira"],
  "string",
);
verificar(
  "M6. o CI executa a suíte nova",
  /npm run test:paridade-financeira/.test(ler(".github/workflows/ci.yml")),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
