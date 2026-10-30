/**
 * Núcleo financeiro puro — COMPATIBILIDADE COM O MOTOR ANTIGO (FIN-PR-01).
 *
 * COMO RODAR:  npm run test:nucleo-legado
 *
 * Suíte separada das regras v2, de propósito: aqui nada é regra nova. Prova que a aritmética exata
 * do núcleo e do oráculo reproduz, centavo a centavo, o que o trigger REAL
 * `derivar_valores_financeiros()` (migration 010) gravou para as mesmas entradas
 * (`scripts/fixtures/paridade-financeira-sql.json`). Sem rede e sem banco.
 *
 *   L1  oráculo  = trigger real em 100% da fixture
 *   L2  núcleo   = trigger real em 100% da fixture
 *   L3  núcleo   = oráculo numa grade sintética (jornadas fracionárias, fatores de 2 casas)
 *   L4  a prévia atual (`calcEntry`, billing.ts) segue igual ao oráculo na fixture: nada mudou nela
 */

import { readFileSync } from "node:fs";

import { oraculoLegado010 } from "./_oraculo-financeiro.mjs";
import { calcEntry } from "../src/lib/billing.ts";
import { calcularLegado010, minutosPrevistosDoTurno } from "../src/lib/nucleo-financeiro.ts";

let passou = 0;
const falhas = [];
function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const centesimos = (texto) => {
  const [i, d = ""] = texto.split(".");
  return Number(i) * 100 + Number((d + "00").slice(0, 2));
};

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/paridade-financeira-sql.json", import.meta.url), "utf8"),
);

function entradaDoCaso(c) {
  const previsto = c.shift
    ? minutosPrevistosDoTurno(c.shift.start, c.shift.end, c.shift.brk, c.shift.cross)
    : 0;
  return {
    status: c.status,
    entrada: c.in,
    saida: c.out,
    intervaloMinutos: c.brk,
    previstoMinutos: previsto,
    diariaCentavos: centesimos(c.dr),
    custoCentavos: centesimos(c.dc),
    jornadaCentesimos: centesimos(c.sh),
    fatorCentesimos: centesimos(c.f),
    toleranciaMinutos: c.tol,
  };
}

const doTrigger = (c) => [c.sql.worked, c.sql.ot, c.sql.billed, c.sql.cost];

console.log("L. Motor antigo (010): fixture do trigger real");
verificar("L0. a fixture tem os 701 casos esperados", fixture.casos.length, 701);

const divOraculo = [];
const divNucleo = [];
for (const c of fixture.casos) {
  const e = entradaDoCaso(c);
  const o = oraculoLegado010({
    status: e.status,
    entrada: e.entrada,
    saida: e.saida,
    intervalo: e.intervaloMinutos,
    previstoMinutos: e.previstoMinutos,
    diaria: e.diariaCentavos,
    custo: e.custoCentavos,
    jornadaCentesimos: e.jornadaCentesimos,
    fatorCentesimos: e.fatorCentesimos,
    tolerancia: e.toleranciaMinutos,
  });
  if (
    JSON.stringify([o.trabalhados, o.extras, o.cobrado, o.custo]) !== JSON.stringify(doTrigger(c))
  ) {
    divOraculo.push(`#${c.i}`);
  }
  const n = calcularLegado010(e);
  const obtido = [n.minutosTrabalhados, n.minutosExtras, n.cobradoCentavos, n.custoCentavos];
  if (JSON.stringify(obtido) !== JSON.stringify(doTrigger(c))) divNucleo.push(`#${c.i}`);
}
verificar(
  "L1. oráculo = trigger real em 100% da fixture (minutos, extras, cobrado, custo)",
  divOraculo,
  [],
);
verificar(
  "L2. núcleo  = trigger real em 100% da fixture (minutos, extras, cobrado, custo)",
  divNucleo,
  [],
);
verificar(
  "L2b. a fixture cobre falta, substituição, sem horários e sem turno",
  [
    fixture.casos.some((c) => c.status === "absent"),
    fixture.casos.some((c) => c.status === "replacement"),
    fixture.casos.some((c) => c.in === null || c.out === null),
    fixture.casos.some((c) => c.shift === null),
  ],
  [true, true, true, true],
);

// ---------------------------------------------------------------------------
// L3. Grade: jornadas fracionárias (7,33 h), fatores de 2 casas, viradas de dia
// ---------------------------------------------------------------------------

function mulberry32(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = mulberry32(10);
const ate = (n) => Math.floor(r() * (n + 1));
const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
let divGrade = 0;
const N = 60_000;
for (let i = 0; i < N; i++) {
  const semHorario = r() < 0.05;
  const e = {
    status: ["present", "present", "replacement", "absent"][ate(3)],
    entrada: semHorario ? null : hhmm(ate(1439)),
    saida: semHorario ? null : hhmm(ate(1439)),
    intervaloMinutos: ate(180),
    previstoMinutos: r() < 0.3 ? 0 : ate(720),
    diariaCentavos: ate(200_000),
    custoCentavos: ate(100_000),
    jornadaCentesimos: r() < 0.05 ? 0 : 1 + ate(2400),
    fatorCentesimos: r() < 0.05 ? 0 : ate(300),
    toleranciaMinutos: ate(30),
  };
  const n = calcularLegado010(e);
  const o = oraculoLegado010({
    status: e.status,
    entrada: e.entrada,
    saida: e.saida,
    intervalo: e.intervaloMinutos,
    previstoMinutos: e.previstoMinutos,
    diaria: e.diariaCentavos,
    custo: e.custoCentavos,
    jornadaCentesimos: e.jornadaCentesimos,
    fatorCentesimos: e.fatorCentesimos,
    tolerancia: e.toleranciaMinutos,
  });
  if (
    n.minutosTrabalhados !== o.trabalhados ||
    n.minutosExtras !== o.extras ||
    n.cobradoCentavos !== o.cobrado ||
    n.custoCentavos !== o.custo
  ) {
    divGrade++;
  }
}
verificar(`L3. núcleo = oráculo em ${N} casos sintéticos do motor antigo`, divGrade, 0);

// ---------------------------------------------------------------------------
// L4. A prévia em vigor (billing.ts) não mudou: continua igual ao trigger real
// ---------------------------------------------------------------------------

const cents = (v) => Math.round(v * 100);
let divCalc = 0;
for (const c of fixture.casos) {
  const planned = c.shift
    ? minutosPrevistosDoTurno(c.shift.start, c.shift.end, c.shift.brk, c.shift.cross)
    : 0;
  const res = calcEntry({
    status: c.status,
    checkIn: c.in,
    checkOut: c.out,
    breakMinutes: c.brk,
    plannedMinutes: planned,
    rules: {
      daily_rate: Number(c.dr),
      shift_hours: Number(c.sh),
      ot_factor: Number(c.f),
      ot_tolerance_min: c.tol,
    },
    employeeDailyCost: Number(c.dc),
  });
  if (cents(res.billedAmount) !== c.sql.billed || cents(res.costAmount) !== c.sql.cost) divCalc++;
}
verificar("L4. calcEntry (prévia em vigor) segue igual ao trigger real na fixture", divCalc, 0);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
