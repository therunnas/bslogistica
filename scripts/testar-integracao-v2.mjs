/**
 * Integração do núcleo V2 ao motor — COMPORTAMENTO (FIN-PR-02).
 *
 * COMO RODAR:  npm run test:integracao-v2
 *
 * Sem rede e sem banco. A prova do banco é a suíte SQL `036_integracao_nucleo_v2.sql`; aqui ficam a
 * prévia da tela e a explicação das diferenças:
 *
 *   P  prévia (previa-v2.ts) = oráculo independente em toda a grade de dia útil e sábado
 *   L  domingo e feriado: a prévia continua no calcEntry (030) e bate com a MEDIDA da 030 no banco
 *      (scripts/fixtures/derivar-030-baseline.json); sem o anúncio `nucleo_v2`, nada muda
 *   R  os leitores atuais (HE = billed − diária, piso 0) classificam certo toda a V2 de útil/sábado
 *   D  diferenças legado × V2: cada lançamento que mudou é explicado por uma regra aprovada
 *   U  plumbing: anúncio do banco, domingo, valorDaLinha
 */

import { readFileSync } from "node:fs";

import { gradeV2, oraculoV2 } from "./_oraculo-financeiro.mjs";
import {
  CUSTO_CENTAVOS,
  DIARIA_CENTAVOS,
  entradaV2,
  gradeDeIntegracao,
  textoDoResultado,
  TIPO_GRAVADO,
} from "./_integracao-grade.mjs";
import { calcEntry } from "../src/lib/billing.ts";
import { calcEntryComNucleo } from "../src/lib/previa-v2.ts";
import { ehDomingo, interpretarNucleoV2 } from "../src/lib/vigencias-ui.ts";
import { valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";

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

const baseline = new Map(
  JSON.parse(
    readFileSync(new URL("./fixtures/derivar-030-baseline.json", import.meta.url), "utf8"),
  ).casos.map((x) => [x.n, x.r]),
);
const grade = gradeDeIntegracao();
const reais = (c) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const cents = (v) => Math.round(v * 100);

/** Entrada da prévia como o painel a monta para um caso da grade. */
function entradaDaPrevia(c, nucleoV2) {
  return {
    status: c.status,
    checkIn: c.entrada,
    checkOut: c.saida,
    breakMinutes: c.intervalo,
    plannedMinutes: 480, // turno 06:00-15:00 com 60 min de intervalo
    rules: {
      daily_rate: DIARIA_CENTAVOS / 100,
      shift_hours: 8,
      ot_factor: 1.5,
      ot_tolerance_min: c.tolerancia,
    },
    employeeDailyCost: CUSTO_CENTAVOS / 100,
    employeeOtHourCost: c.valorHora ? 25 : null,
    proportionalCost: true,
    roundingMode: c.modo,
    dayKind: TIPO_GRAVADO[c.dia],
    saturdayShiftHours: c.sabado,
    holidayPayFactor: 2,
    nucleoV2,
  };
}

const igual = (c) => c.entrada !== null && c.saida !== null && c.entrada === c.saida;

// ---------------------------------------------------------------------------
console.log("P. Prévia = oráculo V2 (dia útil e sábado)");
let divPrevia = [];
let recusas = 0;
for (const c of grade.filter((x) => (x.dia === "util" || x.dia === "sabado") && !igual(x))) {
  const o = oraculoV2(entradaV2(c));
  const p = calcEntryComNucleo(entradaDaPrevia(c, true));
  if (o.erro) {
    recusas++;
    if (p.recusa !== o.erro || p.billedAmount !== 0) divPrevia.push(`#${c.n} recusa`);
    continue;
  }
  const obtido = [
    cents(p.billedAmount),
    cents(p.costAmount),
    p.workedMinutes,
    p.overtimeMinutes,
    p.billedOvertimeMinutes,
  ];
  const esperado = [
    o.totalCentavos,
    o.custoTotalCentavos,
    o.minutosTrabalhados,
    o.heMinutosPagos,
    o.heMinutosCobrados,
  ];
  if (JSON.stringify(obtido) !== JSON.stringify(esperado)) divPrevia.push(`#${c.n}`);
}
verificar(
  "P1. a prévia de dia útil e sábado é o oráculo em toda a grade (recusas inclusive)",
  divPrevia,
  [],
);
verificar("P2. a grade tem recusas de zero minuto (sem quebrar a prévia)", recusas > 0, true);

// A mesma conta da prévia contra a grade aleatória do núcleo (PR 01), útil e sábado.
let divAleatoria = 0;
for (const e of gradeV2(60_000, 36).filter(
  (x) => x.tipoDoDia === "util" || x.tipoDoDia === "sabado",
)) {
  const o = oraculoV2(e);
  const p = calcEntryComNucleo({
    status: e.status,
    checkIn: e.entrada,
    checkOut: e.saida,
    breakMinutes: e.intervaloMinutos,
    plannedMinutes: 480,
    rules: {
      daily_rate: e.diariaCentavos / 100,
      shift_hours: 8,
      ot_factor: e.fatorHeCentesimos / 100,
      ot_tolerance_min: e.toleranciaMinutos,
    },
    employeeDailyCost: e.custoDiarioCentavos / 100,
    employeeOtHourCost: e.custoHoraHeCentavos === null ? null : e.custoHoraHeCentavos / 100,
    proportionalCost: true,
    roundingMode: e.modoHe,
    dayKind: e.tipoDoDia,
    nucleoV2: true,
  });
  if (o.erro) {
    // falta com adicional não ocorre na prévia (adicional = 0 neste PR); as outras recusas, sim
    if (o.erro !== "falta_com_adicional" && p.recusa !== o.erro) divAleatoria++;
    continue;
  }
  if (
    cents(p.billedAmount) !== o.totalCentavos - e.adicionalCentavos ||
    cents(p.costAmount) !== o.custoTotalCentavos
  )
    divAleatoria++;
}
verificar(
  "P3. prévia = oráculo também na grade aleatória (valores em centavos, fatores variados)",
  divAleatoria,
  0,
);

// ---------------------------------------------------------------------------
console.log("\nL. Domingo e feriado continuam na 030; sem o anúncio, nada muda");
let divLegado = [];
for (const c of grade.filter((x) => (x.dia === "domingo" || x.dia === "feriado") && !igual(x))) {
  const b = baseline.get(c.n).split("|");
  const p = calcEntryComNucleo(entradaDaPrevia(c, c.dia === "feriado")); // feriado: mesmo com o anúncio
  const cAntes = calcEntry(entradaDaPrevia(c, false));
  if (
    reais(cents(p.billedAmount)) !== b[0] ||
    reais(cents(p.costAmount)) !== b[1] ||
    cents(p.billedAmount) !== cents(cAntes.billedAmount)
  ) {
    divLegado.push(
      `#${c.n} ${c.dia}/${c.padrao}: ${reais(cents(p.billedAmount))}|${reais(cents(p.costAmount))} × ${b[0]}|${b[1]}`,
    );
  }
}
verificar(
  "L1. domingo e feriado: prévia = calcEntry (030) = medida da 030 no banco, valor a valor",
  divLegado.slice(0, 3),
  [],
);
let divSemAnuncio = 0;
for (const c of grade.filter((x) => !igual(x))) {
  const a = calcEntryComNucleo(entradaDaPrevia(c, false));
  const b = calcEntry(entradaDaPrevia(c, false));
  if (JSON.stringify(a) !== JSON.stringify(b)) divSemAnuncio++;
}
verificar(
  "L2. sem o anúncio `nucleo_v2` (banco sem a 036) a prévia é exatamente a de antes",
  divSemAnuncio,
  0,
);
verificar(
  "L3. motor antigo (sem regras definitivas): nunca passa pela V2",
  calcEntryComNucleo({ ...entradaDaPrevia(grade[20], true), roundingMode: undefined }).billedAmount,
  calcEntry({ ...entradaDaPrevia(grade[20], true), roundingMode: undefined }).billedAmount,
);

// ---------------------------------------------------------------------------
console.log("\nR. Leitores atuais: HE = billed − diária (piso 0) e diária = billed − HE");
let divLeitor = 0;
let casosLeitor = 0;
for (const e of gradeV2(120_000, 37).filter(
  (x) => x.tipoDoDia === "util" || x.tipoDoDia === "sabado",
)) {
  const r = oraculoV2({ ...e, adicionalCentavos: 0 });
  if (r.erro || e.status === "absent") continue;
  casosLeitor++;
  const heDerivada = Math.max(r.totalCentavos - e.diariaCentavos, 0);
  if (heDerivada !== r.heCentavos || r.totalCentavos - heDerivada !== r.baseCentavos) divLeitor++;
}
verificar(
  `R1. ${casosLeitor} lançamentos V2 de útil/sábado: a derivação dos leitores = componentes`,
  divLeitor,
  0,
);
verificar(
  "R2. a derivação só vale sem especial e sem adicional: com adicional ela erraria (por isso o PR 03 vem antes)",
  (() => {
    const r = oraculoV2({
      ...entradaV2(grade.find((c) => c.padrao === "w480")),
      adicionalCentavos: 3000,
    });
    return Math.max(r.totalCentavos - DIARIA_CENTAVOS, 0) !== r.heCentavos;
  })(),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nD. Diferenças legado (030 medida) × V2, explicadas uma a uma");
const categorias = {};
const naoExplicadas = [];
for (const c of grade.filter((x) => (x.dia === "util" || x.dia === "sabado") && !igual(x))) {
  const antes = baseline.get(c.n);
  const o = oraculoV2(entradaV2(c));
  const depois = o.erro
    ? `erro:22023:${o.erro}`
    : textoDoResultado(o, c.status === "absent" ? "-" : TIPO_GRAVADO[c.dia]);
  let cat;
  if (antes === depois) cat = "igual";
  else if (o.erro === "zero_minuto_com_horarios" && antes.startsWith("0.00|0.00|0|"))
    cat = "recusa de zero minuto (a 030 gravava 0,00)";
  else if (c.dia === "sabado")
    cat = "sábado V2 (diária inteira até 4 h, HE e pagamento acima de 4 h)";
  else {
    const excesso = o.minutosTrabalhados - 480;
    if (c.modo === "diario" && excesso > c.tolerancia && [15, 45].includes(excesso % 60))
      cat = "HE diária no limite 15/45";
    else cat = null;
  }
  if (cat === null)
    naoExplicadas.push(`#${c.n} ${c.cfg}/${c.dia}/${c.padrao}: ${antes} -> ${depois}`);
  else categorias[cat] = (categorias[cat] ?? 0) + 1;
}
for (const [k, v] of Object.entries(categorias))
  console.log(`        ${String(v).padStart(4)}  ${k}`);
verificar("D1. nenhuma diferença sem explicação", naoExplicadas.slice(0, 5), []);
verificar(
  "D2. as três explicações aparecem (limite 15/45, sábado, zero minuto)",
  [
    Boolean(categorias["HE diária no limite 15/45"]),
    Boolean(categorias["sábado V2 (diária inteira até 4 h, HE e pagamento acima de 4 h)"]),
    Boolean(categorias["recusa de zero minuto (a 030 gravava 0,00)"]),
  ],
  [true, true, true],
);
const acumulado = grade.filter((c) => c.modo === "acumulado" && c.dia === "util" && !igual(c));
verificar(
  "D3. acumulado no dia útil: nada muda (minutos brutos, a mesma conta da 030)",
  acumulado.filter((c) => {
    const o = oraculoV2(entradaV2(c));
    return (
      !o.erro && baseline.get(c.n) !== textoDoResultado(o, c.status === "absent" ? "-" : "util")
    );
  }).length,
  0,
);

// ---------------------------------------------------------------------------
console.log("\nU. Anúncio do banco, domingo e valorDaLinha");
verificar(
  "U1. interpretarNucleoV2: só true explícito",
  [
    interpretarNucleoV2({ nucleo_v2: true }, null),
    interpretarNucleoV2({ nucleo_v2: "true" }, null),
    interpretarNucleoV2({}, null),
    interpretarNucleoV2({ nucleo_v2: true }, { message: "x" }),
  ],
  [true, false, false, false],
);
verificar(
  "U2. ehDomingo: 08/03/2026 sim; 07/03 e 09/03 não; data inválida não",
  [ehDomingo("2026-03-08"), ehDomingo("2026-03-07"), ehDomingo("2026-03-09"), ehDomingo("x")],
  [true, false, false, false],
);
const chamadas = [];
const linhaNova = (extra) =>
  valorDaLinha({
    estado: { tag: "ligado", ativadaEm: "2026-01-01" },
    status: "present",
    gravada: false,
    tocada: true,
    gravado: null,
    regrasDoCadastro: { daily_rate: 100, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 },
    custoDoCadastro: 50,
    condicaoDoDia: {
      ok: true,
      regras: { daily_rate: 100, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 },
      custoDiario: 50,
      origem: "versao",
      custoHoraExtra: null,
      horas: { modo: "diario", sabadoHoras: null, fatorFeriado: null },
    },
    plannedMinutes: 480,
    regrasBs: true,
    regrasDefinitivas: true,
    calcular: (p) => {
      chamadas.push(p.horas);
      return { billedAmount: 0, costAmount: 0, overtimeMinutes: 0 };
    },
    ...extra,
  });
linhaNova({ tipoDoDia: "util", nucleoV2: true });
linhaNova({ tipoDoDia: "util", nucleoV2: true, domingo: true });
linhaNova({ tipoDoDia: "feriado", nucleoV2: true });
linhaNova({ tipoDoDia: "sabado", nucleoV2: true });
linhaNova({ tipoDoDia: "util" });
verificar(
  "U3. a prévia só pede a V2 em útil/sábado com o anúncio, nunca no domingo nem no feriado",
  chamadas.map((h) => h?.v2),
  [true, false, false, true, undefined],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
