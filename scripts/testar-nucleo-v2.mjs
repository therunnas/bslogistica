/**
 * Núcleo financeiro puro — REGRAS V2 (FIN-PR-01).
 *
 * COMO RODAR:  npm run test:nucleo-v2
 *
 * Sem rede e sem banco. O núcleo (`src/lib/nucleo-financeiro.ts`) é conferido contra duas fontes
 * que não saem dele:
 *   - casos calculados À MÃO (`scripts/fixtures/nucleo-financeiro-golden.json`);
 *   - o oráculo independente em frações exatas (`scripts/_oraculo-financeiro.mjs`).
 * O lado SQL tem a mesma prova em `supabase/tests/035_nucleo_financeiro_puro.sql`. As expectativas
 * do motor antigo ficam em outra suíte (`test:nucleo-legado`) e não são misturadas com estas.
 *
 *   A  casos de referência: oráculo = mão; núcleo = mão
 *   B  pontos exigidos: 14/15/16/44/45/46, tolerâncias 0/10/15, descarte × subtração, sábado,
 *      divisor 8 × 4, domingo/feriado, falta, sem horários, zero minuto, adicional
 *   C  grade sintética grande: núcleo = oráculo, inclusive nas recusas
 *   D  propriedades: identidade dos componentes, adicional fora da HE, custo separado da cobrança
 *   E  primitivas: arredondamento de HE e de centavos, horários
 */

import { readFileSync } from "node:fs";

import { CAMPOS_V2, gradeV2, oraculoArredondarHe, oraculoV2 } from "./_oraculo-financeiro.mjs";
import {
  ErroDoNucleo,
  arredondarCentavos,
  arredondarHoraExtraDiaria,
  calcularComponentesV2,
  minutosDoHorario,
} from "../src/lib/nucleo-financeiro.ts";

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

/** Núcleo com recusa normalizada para `{ erro }`, como o oráculo. */
function nucleo(entrada) {
  try {
    return calcularComponentesV2(entrada);
  } catch (e) {
    if (e instanceof ErroDoNucleo) return { erro: e.codigo };
    throw e;
  }
}

const normalizar = (r) =>
  r.erro ? { erro: r.erro } : Object.fromEntries(CAMPOS_V2.map((c) => [c, r[c]]));

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/nucleo-financeiro-golden.json", import.meta.url), "utf8"),
);
const casos = golden.casos.map((c) => ({
  codigo: c.codigo,
  descricao: c.descricao,
  entrada: { ...golden.padrao, ...c.entrada },
  esperado: c.esperado.erro
    ? { erro: c.esperado.erro }
    : Object.fromEntries(
        CAMPOS_V2.map((campo) => [
          campo,
          c.esperado[campo] ?? (campo === "cruzaMeiaNoite" ? false : 0),
        ]),
      ),
}));
const porCodigo = new Map(casos.map((c) => [c.codigo, c]));

// ---------------------------------------------------------------------------
console.log("A. Casos de referência calculados à mão");
verificar(
  "A0. códigos sintéticos e únicos (G01…)",
  casos.every((c) => /^G\d{2}$/.test(c.codigo)) && porCodigo.size === casos.length,
  true,
);
for (const c of casos) {
  verificar(
    `A1. ${c.codigo} oráculo — ${c.descricao}`,
    normalizar(oraculoV2(c.entrada)),
    c.esperado,
  );
  verificar(`A2. ${c.codigo} núcleo  — ${c.descricao}`, normalizar(nucleo(c.entrada)), c.esperado);
}

// ---------------------------------------------------------------------------
console.log("\nB. Pontos exigidos pela regra");
const he = (codigo) => porCodigo.get(codigo).esperado.heMinutosCobrados;
verificar(
  "B1. excedentes 14/15/16/44/45/46 -> 0/30/30/30/60/60",
  ["G02", "G03", "G04", "G05", "G06", "G07"].map(he),
  [0, 30, 30, 30, 60, 60],
);
verificar(
  "B2. horas inteiras preservadas: 1h14/1h15/1h45/2h59 -> 60/90/120/180",
  ["G08", "G09", "G10", "G11"].map(he),
  [60, 90, 120, 180],
);
verificar("B3. tolerância 0: 14 -> 0, 15 -> 30", ["G12", "G13"].map(he), [0, 30]);
verificar(
  "B4. tolerância 10: 10 descartado, 14 -> 0, 15 -> 30",
  ["G16", "G02", "G03"].map(he),
  [0, 0, 30],
);
verificar("B5. tolerância 15: 15 descartado, 16 -> 30", ["G14", "G15"].map(he), [0, 30]);
verificar(
  "B6. descarte, não subtração: excedente 80, tolerância 10 = 90 (nunca 60)",
  he("G17"),
  90,
);
verificar(
  "B7. sábado 3h59/4h/4h01: diária inteira, sem HE",
  ["G18", "G19", "G20"].map((c) => [porCodigo.get(c).esperado.baseCentavos, he(c)]),
  [
    [20000, 0],
    [20000, 0],
    [20000, 0],
  ],
);
const g21 = nucleo(porCodigo.get("G21").entrada);
const divisor4 = Number(arredondarCentavos(20000n * 30n * 150n, 240n * 100n));
verificar(
  "B8. divisor 8 no sábado: HE de 30 min = 18,75 (divisor 4 daria 37,50)",
  [g21.heCentavos, divisor4, g21.heCentavos !== divisor4],
  [1875, 3750, true],
);
verificar(
  "B9. sábado com zero minuto trabalhado: recusado, nunca diária inteira",
  nucleo(porCodigo.get("G23").entrada),
  { erro: "zero_minuto_com_horarios" },
);
const g29 = nucleo(porCodigo.get("G29").entrada);
verificar(
  "B10. domingo: sem diária e sem HE; só horas × 2",
  [g29.baseCentavos, g29.heCentavos, g29.especialCentavos],
  [0, 0, 30000],
);
verificar(
  "B11. feriado com 9 h: nada de HE de 50% somada às horas × 2",
  [
    nucleo(porCodigo.get("G34").entrada).heCentavos,
    nucleo(porCodigo.get("G34").entrada).especialCentavos,
  ],
  [0, 45000],
);
verificar("B12. domingo/feriado sem horários: recusado", nucleo(porCodigo.get("G33").entrada), {
  erro: "especial_sem_horarios",
});
verificar(
  "B13. falta = zero; falta com adicional = recusada",
  [nucleo(porCodigo.get("G38").entrada).totalCentavos, nucleo(porCodigo.get("G39").entrada)],
  [0, { erro: "falta_com_adicional" }],
);
verificar(
  "B14. útil sem horários = diária inteira",
  nucleo(porCodigo.get("G27").entrada).baseCentavos,
  20000,
);
verificar(
  "B15. adicional não muda a HE (G06 × G36)",
  [
    nucleo(porCodigo.get("G06").entrada).heCentavos,
    nucleo(porCodigo.get("G36").entrada).heCentavos,
  ],
  [3750, 3750],
);
verificar(
  "B16. adicional não entra no custo (G01 × G35)",
  [
    nucleo(porCodigo.get("G01").entrada).custoTotalCentavos,
    nucleo(porCodigo.get("G35").entrada).custoTotalCentavos,
  ],
  [12000, 12000],
);
verificar(
  "B17. acumulado: minutos brutos sem tolerância (14 e 26)",
  ["G43", "G44"].map(he),
  [14, 26],
);
verificar(
  "B18. noturno cruza a meia-noite e só informa",
  nucleo(porCodigo.get("G47").entrada).cruzaMeiaNoite,
  true,
);

// ---------------------------------------------------------------------------
console.log("\nC. Grade sintética: núcleo = oráculo");
const grade = gradeV2(120_000, 20261030);
let divergentes = [];
const contagem = {};
for (const e of grade) {
  const o = normalizar(oraculoV2(e));
  const n = normalizar(nucleo(e));
  const chave = o.erro ?? "ok";
  contagem[chave] = (contagem[chave] ?? 0) + 1;
  if (JSON.stringify(o) !== JSON.stringify(n)) divergentes.push({ e, o, n });
}
verificar(`C1. ${grade.length} casos idênticos, inclusive as recusas`, divergentes.slice(0, 3), []);
verificar("C2. a grade exercita cálculo e todas as recusas", Object.keys(contagem).sort(), [
  "entrada_igual_saida",
  "especial_sem_horarios",
  "falta_com_adicional",
  "ok",
  "zero_minuto_com_horarios",
]);
console.log(`        distribuição: ${JSON.stringify(contagem)}`);

// ---------------------------------------------------------------------------
console.log("\nD. Propriedades");
const validos = grade.filter((e) => !nucleo(e).erro).slice(0, 40_000);
let identidade = 0;
let especialComDiaria = 0;
let adicionalNaHe = 0;
let custoDependente = 0;
for (const e of validos) {
  const r = nucleo(e);
  if (r.totalCentavos !== r.baseCentavos + r.heCentavos + r.especialCentavos + r.adicionalCentavos)
    identidade++;
  if (r.custoTotalCentavos !== r.custoBaseCentavos + r.custoHeCentavos + r.custoEspecialCentavos)
    identidade++;
  if (r.especialCentavos > 0 && (r.baseCentavos !== 0 || r.heCentavos !== 0)) especialComDiaria++;
  const semAdicional = nucleo({ ...e, adicionalCentavos: 0 });
  if (
    semAdicional.heCentavos !== r.heCentavos ||
    semAdicional.baseCentavos !== r.baseCentavos ||
    semAdicional.especialCentavos !== r.especialCentavos
  )
    adicionalNaHe++;
  const outraCobranca = nucleo({
    ...e,
    diariaCentavos: e.diariaCentavos + 777,
    fatorHeCentesimos: 200,
    adicionalCentavos: 0,
  });
  if (outraCobranca.custoTotalCentavos !== r.custoTotalCentavos) custoDependente++;
}
verificar(
  `D1. ${validos.length} casos: total = base + HE + especial + adicional (e custo idem)`,
  identidade,
  0,
);
verificar("D2. domingo/feriado nunca tem diária nem HE", especialComDiaria, 0);
verificar("D3. o adicional não altera diária, HE nem horas especiais", adicionalNaHe, 0);
verificar(
  "D4. o custo não depende da diária cobrada, do fator da HE nem do adicional",
  custoDependente,
  0,
);
verificar(
  "D5. componentes nunca negativos",
  validos.every((e) =>
    CAMPOS_V2.filter((c) => c !== "cruzaMeiaNoite").every((c) => nucleo(e)[c] >= 0),
  ),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nE. Primitivas");
const tabela = [
  [0, 0],
  [14, 0],
  [15, 30],
  [16, 30],
  [44, 30],
  [45, 60],
  [46, 60],
  [59, 60],
  [60, 60],
  [74, 60],
  [75, 90],
  [104, 90],
  [105, 120],
  [179, 180],
];
verificar(
  "E1. arredondamento da HE: tabela à mão",
  tabela.map(([m]) => arredondarHoraExtraDiaria(m)),
  tabela.map(([, e]) => e),
);
let diferentes = 0;
for (let m = 0; m <= 24 * 60; m++)
  if (arredondarHoraExtraDiaria(m) !== oraculoArredondarHe(m)) diferentes++;
verificar("E2. arredondamento da HE = oráculo de 0 a 1440 min", diferentes, 0);
verificar(
  "E3. meio centavo para cima: 1/2, 1/3, 2/3, 500050/100",
  [
    arredondarCentavos(1n, 2n),
    arredondarCentavos(1n, 3n),
    arredondarCentavos(2n, 3n),
    arredondarCentavos(500050n, 100n),
  ].map(Number),
  [1, 0, 1, 5001],
);
verificar(
  "E4. horário: segundos ignorados, formato inválido recusado",
  [minutosDoHorario("08:30:59"), nucleo({ ...golden.padrao, entrada: "24:00" }).erro],
  [510, "parametro_invalido"],
);
verificar(
  "E5. parâmetros fora do domínio recusados (diária negativa, fator 0, custo-hora 0)",
  [
    nucleo({ ...golden.padrao, diariaCentavos: -1 }).erro,
    nucleo({ ...golden.padrao, fatorHeCentesimos: 0 }).erro,
    nucleo({ ...golden.padrao, custoHoraHeCentavos: 0 }).erro,
  ],
  ["parametro_invalido", "parametro_invalido", "parametro_invalido"],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const falha of falhas.slice(0, 20)) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
