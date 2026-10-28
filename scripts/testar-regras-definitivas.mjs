/**
 * Regras financeiras definitivas da BS (C05-B8.15, migration 030).
 *
 * COMO RODAR:
 *
 *   npm run test:regras-definitivas
 *
 * Sem framework, sem rede e sem banco. Sai com código diferente de zero em qualquer falha.
 *
 * O QUE ESTA SUÍTE PROVA
 *
 *   A  arredondamento: 14, 15, 16, 44, 45, 46 e horas completas, contra um oráculo independente
 *   B  prévia (`calcEntry`) com os MESMOS números que `supabase/tests/028_regras_definitivas_bs.sql`
 *      prova no banco (paridade SQL × TypeScript): diário, saída antecipada, sábado, feriado,
 *      Aceville (bruto) e Dynamis (dias sem compensação)
 *   C  sem as opções novas, a prévia é a de antes (029)
 *   D  `valorDaLinha`: regras novas só com o anúncio e o motor ligado; versão congelada na edição
 *   E  tipo do dia, parâmetros da vigência do contrato e anúncio `regras_definitivas`
 *   F  calendário de feriados
 *   G  forma da migration 030 e das telas
 */

import { readFileSync, readdirSync } from "node:fs";

import { arredondarMinutosExtras, calcEntry } from "../src/lib/billing.ts";
import { valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";
import {
  camposDaVigencia,
  camposDoCadastroInicialDeContrato,
  errosDosParametros030,
  interpretarRegrasDefinitivas,
  montarCadastroAtomico,
  montarRegistro,
  PARAMETROS_030_INICIAIS,
  parametrosDeHoras,
  resolverCondicaoDoDia,
  tipoDoDia,
  validarNovaVigencia,
} from "../src/lib/vigencias-ui.ts";
import {
  ajusteTotal,
  descricaoDaReceita,
  lerResumoFinanceiro,
  parcelasFecham,
} from "../src/lib/resumo-financeiro.ts";
import { datasAtivas, montarRegistroDeFeriado, validarFeriado } from "../src/lib/feriados.ts";

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

const ler = (p) => readFileSync(p, "utf8");
const igual = verificar;
const semComentarios = (f) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// A. Arredondamento
// ---------------------------------------------------------------------------

console.log("A. Arredondamento da hora extra cobrada");

verificar(
  "A1. residuais 0,14,15,16,30,44,45,46,59 -> 0,0,0,30,30,30,30,60,60 (iguais ao SQL R1)",
  [0, 14, 15, 16, 30, 44, 45, 46, 59].map(arredondarMinutosExtras),
  [0, 0, 0, 30, 30, 30, 30, 60, 60],
);
verificar(
  "A2. horas completas preservadas: 60,74,75,76,105,106,134,135,136 (iguais ao SQL R2)",
  [60, 74, 75, 76, 105, 106, 134, 135, 136].map(arredondarMinutosExtras),
  [60, 60, 60, 90, 90, 120, 120, 120, 150],
);
verificar("A3. Aceville: 14 + 26 = 40 -> 30", arredondarMinutosExtras(14 + 26), 30);
verificar(
  "A4. negativo, zero e NaN -> 0",
  [-30, 0, Number.NaN].map(arredondarMinutosExtras),
  [0, 0, 0],
);

/** Oráculo escrito de outro jeito: compara com as faixas da BS em minutos absolutos. */
function oraculo(m) {
  if (m <= 0) return 0;
  let resultado = 0;
  for (let h = 0; h * 60 <= m; h++) {
    const resto = m - h * 60;
    if (resto < 60) {
      resultado = resto <= 15 ? h * 60 : resto <= 45 ? h * 60 + 30 : (h + 1) * 60;
    }
  }
  return resultado;
}
const divergentes = [];
for (let m = 0; m <= 1440; m++) {
  if (arredondarMinutosExtras(m) !== oraculo(m)) divergentes.push(m);
}
verificar("A5. 0 a 1440 minutos: igual ao oráculo independente", divergentes.slice(0, 5), []);

// ---------------------------------------------------------------------------
// B. Prévia = banco (mesmos números da suíte SQL 028)
// ---------------------------------------------------------------------------

console.log("B. Paridade com a suíte SQL 028");

const K1 = { daily_rate: 120, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 };

function nova({
  modo = "diario",
  dia = "util",
  sabado = null,
  feriado = null,
  custo = 80,
  hora = null,
  entrada = "06:00",
  saida,
  pausa = 60,
}) {
  const r = calcEntry({
    status: "present",
    checkIn: entrada,
    checkOut: saida,
    breakMinutes: pausa,
    plannedMinutes: 480,
    rules: K1,
    employeeDailyCost: custo,
    employeeOtHourCost: hora,
    proportionalCost: true,
    roundingMode: modo,
    dayKind: dia,
    saturdayShiftHours: sabado,
    holidayPayFactor: feriado,
  });
  return [
    r.billedAmount,
    r.costAmount,
    r.workedMinutes,
    r.overtimeMinutes,
    r.billedOvertimeMinutes,
  ];
}

verificar(
  "D1. 14 min: cobra 0 (120,00); paga 14 min exatos (85,83)",
  nova({ hora: 25, saida: "15:14" }),
  [120, 85.83, 494, 14, 0],
);
verificar(
  "D2. 16 min: cobra 30 (131,25); paga 16 (86,67)",
  nova({ hora: 25, saida: "15:16" }),
  [131.25, 86.67, 496, 16, 30],
);
verificar(
  "D3. 45 min: cobra 30 (131,25); paga 45 (98,75)",
  nova({ hora: 25, saida: "15:45" }),
  [131.25, 98.75, 525, 45, 30],
);
verificar(
  "D4. 46 min: cobra 60 (142,50); paga 46 (99,17)",
  nova({ hora: 25, saida: "15:46" }),
  [142.5, 99.17, 526, 46, 60],
);
verificar("D5. 8 min (≤ tolerância): nada", nova({ saida: "15:08" }), [120, 80, 488, 0, 0]);
verificar("D6. 75 min: cobra 60 (142,50)", nova({ hora: 25, saida: "16:15" }).slice(0, 1), [142.5]);
verificar(
  "E1. 8 h previstas, 4 trabalhadas: meia diária cobrada (60) e paga (40)",
  nova({ saida: "11:00" }),
  [60, 40, 240, 0, 0],
);
verificar(
  "E2. 06-10 sem intervalo: 4 h, o mesmo",
  nova({ saida: "10:00", pausa: 0 }).slice(0, 3),
  [60, 40, 240],
);
verificar("E3. sem saída: diária cheia cobrada e paga", nova({ saida: null }), [120, 80, 0, 0, 0]);
verificar(
  "S1. sábado 6 h: 165,00 cobrados; pagamento inalterado (60,00)",
  nova({ dia: "sabado", sabado: 4, hora: 25, saida: "12:00", pausa: 0 }),
  [165, 60, 360, 0, 120],
);
verificar(
  "S2. sábado 3 h: 90,00 (proporcional à referência de 4 h)",
  nova({ dia: "sabado", sabado: 4, saida: "09:00", pausa: 0 }),
  [90, 30, 180, 0, 0],
);
verificar(
  "S3. sábado 4h16: 131,25",
  nova({ dia: "sabado", sabado: 4, saida: "10:16", pausa: 0 }).slice(0, 1),
  [131.25],
);
verificar(
  "S4. sábado em contrato sem regra: dia comum (6 h = 90,00)",
  nova({ dia: "sabado", sabado: null, saida: "12:00", pausa: 0 }).slice(0, 1),
  [90],
);
verificar(
  "H1. feriado, custo 150, 6 h, fator 2: paga 225,00; cobra 90,00",
  nova({ dia: "feriado", feriado: 2, custo: 150, saida: "13:00" }),
  [90, 225, 360, 0, 0],
);
verificar(
  "H4. o mesmo feriado com 7 h: paga 262,50; cobra 105,00",
  nova({ dia: "feriado", feriado: 2, custo: 150, saida: "14:00" }).slice(0, 2),
  [105, 262.5],
);
verificar(
  "H2. feriado sem fator: pagamento comum (80)",
  nova({ dia: "feriado", feriado: null, saida: "15:00" }).slice(0, 2),
  [120, 80],
);
verificar(
  "A6. Aceville 14 min: cobra bruto, sem tolerância (125,25; 14 min)",
  nova({ modo: "acumulado", hora: 25, saida: "15:14" }),
  [125.25, 85.83, 494, 14, 14],
);
verificar(
  "A7. Aceville 26 min: 129,75",
  nova({ modo: "acumulado", saida: "15:26" }).slice(0, 1),
  [129.75],
);
verificar(
  "A8. Aceville 50 min: 138,75",
  nova({ modo: "acumulado", saida: "15:50" }).slice(0, 1),
  [138.75],
);
verificar(
  "A9. fechamento Aceville (fórmula do SQL): E1 40 -> 30 min: 11,25 - 15,00 = -3,75; E3 50 -> 60: 22,50 - 18,75 = +3,75",
  [
    Math.round((arredondarMinutosExtras(40) / 60) * 22.5 * 100) / 100 - 15,
    Math.round((arredondarMinutosExtras(50) / 60) * 22.5 * 100) / 100 - 18.75,
  ],
  [-3.75, 3.75],
);
verificar(
  "C1. Dynamis: -30 (112,50) e +30 (131,25) num dia cada; o saldo é só informativo",
  [nova({ saida: "14:30" })[0], nova({ saida: "15:30" })[0]],
  [112.5, 131.25],
);

// ---------------------------------------------------------------------------
// C. Sem as opções novas, nada muda
// ---------------------------------------------------------------------------

console.log("C. Prévia de antes (motor sem a 030)");

function antiga(saida, extra = {}) {
  const r = calcEntry({
    status: "present",
    checkIn: "06:00",
    checkOut: saida,
    breakMinutes: 60,
    plannedMinutes: 480,
    rules: K1,
    employeeDailyCost: 80,
    proportionalCost: true,
    ...extra,
  });
  return [r.billedAmount, r.costAmount, r.billedOvertimeMinutes];
}
verificar("C2. saída antecipada: diária cheia cobrada (029)", antiga("11:00"), [120, 40, 0]);
verificar("C3. 16 min: cobra 16 min exatos (029)", antiga("15:16"), [126, 82.67, 16]);
verificar(
  "C4. dayKind/sábado/feriado sem roundingMode: ignorados (5 h: diária cheia cobrada, 50,00 pagos)",
  antiga("12:00", { dayKind: "feriado", holidayPayFactor: 2, saturdayShiftHours: 4 }),
  [120, 50, 0],
);

// ---------------------------------------------------------------------------
// D. valorDaLinha
// ---------------------------------------------------------------------------

console.log("D. valorDaLinha");

function capturar(entrada) {
  let horas = "não chamado";
  const v = valorDaLinha({
    status: "present",
    regrasDoCadastro: K1,
    custoDoCadastro: 80,
    plannedMinutes: 480,
    calcular: (p) => {
      horas = p.horas;
      return { billedAmount: 0, costAmount: 0, overtimeMinutes: 0 };
    },
    ...entrada,
  });
  return { horas, tipo: v.tipo };
}
const LIGADO = { tag: "ligado", ativadaEm: null };
const COND = {
  ok: true,
  regras: K1,
  custoDiario: 80,
  origem: "Contrato",
  custoHoraExtra: null,
  horas: { modo: "acumulado", sabadoHoras: 4, fatorFeriado: 2 },
};
const GRAVADO = {
  status: "present",
  billed_amount: 120,
  cost_amount: 80,
  overtime_minutes: 0,
  daily_rate_snapshot: 120,
  daily_cost_snapshot: 80,
  shift_hours_snapshot: 8,
  ot_factor_snapshot: 1.5,
  ot_tolerance_snapshot: 10,
  planned_minutes_snapshot: 480,
  terms_origin: "versao",
  contract_terms_id: "v-1",
  day_kind_snapshot: "feriado",
};
verificar(
  "D1. sem o anúncio da 030: nenhuma regra nova",
  capturar({
    estado: LIGADO,
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: COND,
    regrasBs: true,
    regrasDefinitivas: false,
  }).horas,
  null,
);
verificar(
  "D2. regras definitivas exigem também as da 029 (regrasBs)",
  capturar({
    estado: LIGADO,
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: COND,
    regrasBs: false,
    regrasDefinitivas: true,
  }).horas,
  null,
);
verificar(
  "D3. linha nova: parâmetros da versão da data e o tipo do dia do calendário",
  capturar({
    estado: LIGADO,
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: COND,
    regrasBs: true,
    regrasDefinitivas: true,
    tipoDoDia: "sabado",
  }).horas,
  { modo: "acumulado", sabadoHoras: 4, fatorFeriado: 2, tipoDoDia: "sabado" },
);
verificar(
  "D4. linha gravada e editada: parâmetros da versão CONGELADA e o tipo do dia congelado",
  capturar({
    estado: LIGADO,
    gravada: true,
    tocada: true,
    gravado: GRAVADO,
    condicaoDoDia: COND,
    regrasBs: true,
    regrasDefinitivas: true,
    tipoDoDia: "util",
    parametrosDaVersao: (id) =>
      id === "v-1" ? { modo: "diario", sabadoHoras: null, fatorFeriado: 2 } : null,
  }).horas,
  { modo: "diario", sabadoHoras: null, fatorFeriado: 2, tipoDoDia: "feriado" },
);
verificar(
  "D5. versão congelada não carregada: prévia indisponível (o banco calcula ao salvar)",
  capturar({
    estado: LIGADO,
    gravada: true,
    tocada: true,
    gravado: GRAVADO,
    condicaoDoDia: COND,
    regrasBs: true,
    regrasDefinitivas: true,
    parametrosDaVersao: () => null,
  }).tipo,
  "indisponivel",
);
verificar(
  "D6. valor acordado (sem contrato): parâmetros neutros",
  capturar({
    estado: LIGADO,
    gravada: true,
    tocada: true,
    gravado: {
      ...GRAVADO,
      terms_origin: "valor_acordado",
      contract_terms_id: null,
      day_kind_snapshot: null,
    },
    condicaoDoDia: COND,
    regrasBs: true,
    regrasDefinitivas: true,
    tipoDoDia: "util",
  }).horas,
  { modo: "diario", sabadoHoras: null, fatorFeriado: null, tipoDoDia: "util" },
);
verificar(
  "D7. motor desligado: nunca regra nova",
  capturar({
    estado: { tag: "desligado" },
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: null,
    regrasBs: true,
    regrasDefinitivas: true,
  }).horas,
  null,
);

// ---------------------------------------------------------------------------
// E. Tipo do dia, parâmetros e anúncio
// ---------------------------------------------------------------------------

console.log("E. Tipo do dia e vigência do contrato");

verificar(
  "E1. tipo do dia (mesmo critério do SQL): 05/03 feriado, 07/03 sábado, 08/03 domingo útil, 02/03 útil, inválida útil",
  ["2026-03-05", "2026-03-07", "2026-03-08", "2026-03-02", "x"].map((d) =>
    tipoDoDia(d, ["2026-03-05"]),
  ),
  ["feriado", "sabado", "util", "util", "util"],
);
verificar(
  "E2. feriado num sábado: feriado tem precedência",
  tipoDoDia("2026-03-07", ["2026-03-07"]),
  "feriado",
);
verificar(
  "E3. anúncio: só regras_definitivas === true",
  [
    interpretarRegrasDefinitivas({ regras_definitivas: true }, null),
    interpretarRegrasDefinitivas({ regras_bs: true }, null),
    interpretarRegrasDefinitivas({ regras_definitivas: true }, { code: "42501" }),
    interpretarRegrasDefinitivas(null, null),
  ],
  [true, false, false, false],
);
verificar(
  "E4. campos do contrato: os da 030 só com o anúncio",
  [
    camposDaVigencia("contrato", true, false).length,
    camposDaVigencia("contrato", true, true)
      .map((c) => c.chave)
      .slice(4),
  ],
  [4, ["ot_rounding_mode", "saturday_shift_hours", "holiday_pay_factor"]],
);
const FORM = {
  inicio: "2026-11-01",
  motivo: "Reajuste",
  valores: { daily_rate: "120", shift_hours: "8", ot_factor: "1,5", ot_tolerance_min: "10" },
  encerrarAnterior: true,
  regrasBs: true,
};
verificar(
  "E5. sem o anúncio, os parâmetros novos não são enviados (chamada de antes)",
  Object.keys(montarRegistro("contrato", "k-1", FORM).params).filter((k) =>
    /rounding|saturday|holiday/.test(k),
  ),
  [],
);
verificar(
  "E6. com o anúncio: modo vazio vira 'diario'; sábado e feriado opcionais omitidos quando vazios",
  (() => {
    const p = montarRegistro("contrato", "k-1", { ...FORM, regrasDefinitivas: true }).params;
    return [p["p_ot_rounding_mode"], "p_saturday_shift_hours" in p, "p_holiday_pay_factor" in p];
  })(),
  ["diario", false, false],
);
verificar(
  "E7. com valores: acumulado, sábado 4 e feriado 2 enviados",
  (() => {
    const p = montarRegistro("contrato", "k-1", {
      ...FORM,
      regrasDefinitivas: true,
      valores: {
        ...FORM.valores,
        ot_rounding_mode: "acumulado",
        saturday_shift_hours: "4",
        holiday_pay_factor: "2",
      },
    }).params;
    return [p["p_ot_rounding_mode"], p["p_saturday_shift_hours"], p["p_holiday_pay_factor"]];
  })(),
  ["acumulado", 4, 2],
);
verificar(
  "E8. validação: modo inválido, sábado acima da jornada, fator abaixo de 1",
  [
    validarNovaVigencia("contrato", {
      ...FORM,
      regrasDefinitivas: true,
      valores: { ...FORM.valores, ot_rounding_mode: "mensal" },
    }).length > 0,
    validarNovaVigencia("contrato", {
      ...FORM,
      regrasDefinitivas: true,
      valores: { ...FORM.valores, saturday_shift_hours: "9" },
    }).length > 0,
    validarNovaVigencia("contrato", {
      ...FORM,
      regrasDefinitivas: true,
      valores: { ...FORM.valores, holiday_pay_factor: "0,5" },
    }).length > 0,
    validarNovaVigencia("contrato", { ...FORM, regrasDefinitivas: true }).length,
  ],
  [true, true, true, 0],
);
verificar(
  "E9. cadastro atômico de contrato leva os parâmetros só com o anúncio",
  [
    "p_ot_rounding_mode" in
      montarCadastroAtomico("contrato", { client_id: "c", name: "K", status: "active" }, FORM)
        .params,
    montarCadastroAtomico(
      "contrato",
      { client_id: "c", name: "K", status: "active" },
      {
        ...FORM,
        regrasDefinitivas: true,
        valores: { ...FORM.valores, ot_rounding_mode: "acumulado" },
      },
    ).params["p_ot_rounding_mode"],
  ],
  [false, "acumulado"],
);
const versao = (extra) => ({
  id: "v",
  valid_from: "2026-01-01",
  valid_to: null,
  active: true,
  origin: "informada",
  reason: "x",
  created_at: "",
  daily_rate: 120,
  shift_hours: 8,
  ot_factor: 1.5,
  ot_tolerance_min: 10,
  ...extra,
});
verificar(
  "E10. parâmetros de horas de uma versão: com e sem as colunas da 030",
  [
    parametrosDeHoras(
      versao({
        ot_rounding_mode: "acumulado",
        saturday_shift_hours: "4.00",
        holiday_pay_factor: "2.00",
      }),
    ),
    parametrosDeHoras(versao({})),
  ],
  [
    { modo: "acumulado", sabadoHoras: 4, fatorFeriado: 2 },
    { modo: "diario", sabadoHoras: null, fatorFeriado: null },
  ],
);
verificar(
  "E11. condição do dia leva os parâmetros da versão do contrato; valor acordado, neutros",
  [
    resolverCondicaoDoDia({
      data: "2026-03-02",
      contratoId: "k",
      termosContrato: [versao({ ot_rounding_mode: "acumulado" })],
      termosOperacao: [],
      termosCusto: [versao({ daily_cost: 80 })],
    }).horas,
    resolverCondicaoDoDia({
      data: "2026-03-02",
      contratoId: null,
      termosContrato: [],
      termosOperacao: [versao({ agreed_amount: 250 })],
      termosCusto: [versao({ daily_cost: 80 })],
    }).horas,
  ],
  [
    { modo: "acumulado", sabadoHoras: null, fatorFeriado: null },
    { modo: "diario", sabadoHoras: null, fatorFeriado: null },
  ],
);

// ---------------------------------------------------------------------------
// F. Calendário de feriados
// ---------------------------------------------------------------------------

console.log("F. Feriados");

verificar(
  "F1. válido",
  validarFeriado({ data: "2026-04-21", nome: "Tiradentes", motivo: "Nacional" }, []),
  [],
);
verificar(
  "F2. recusas: sem data, data repetida, sem nome, sem motivo",
  [
    validarFeriado({ data: "", nome: "x", motivo: "y" }, []).length > 0,
    validarFeriado({ data: "2026-04-21", nome: "x", motivo: "y" }, ["2026-04-21"]).length > 0,
    validarFeriado({ data: "2026-04-21", nome: " ", motivo: "y" }, []).length > 0,
    validarFeriado({ data: "2026-04-21", nome: "x", motivo: " " }, []).length > 0,
  ],
  [true, true, true, true],
);
verificar(
  "F3. parâmetros da RPC e só as datas ATIVAS entram no calendário",
  [
    montarRegistroDeFeriado({ data: "2026-04-21", nome: " Tiradentes ", motivo: " Nacional " }, []),
    datasAtivas([
      { holiday_date: "2026-04-21", active: true },
      { holiday_date: "2026-05-01", active: false },
    ]),
  ],
  [{ p_data: "2026-04-21", p_nome: "Tiradentes", p_reason: "Nacional" }, ["2026-04-21"]],
);

// ---------------------------------------------------------------------------
// G. Forma
// ---------------------------------------------------------------------------

console.log("G. Forma");

const NOME = "20261028120000_030_regras_definitivas_bs.sql";
const sql = ler(`supabase/migrations/${NOME}`).replace(/^\s*--.*$/gm, "");
const corpo = (nome) => {
  const m = sql.match(
    new RegExp(`function public\\.${nome}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`),
  );
  return m ? m[1] : "";
};
const migrations = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
verificar(
  "G1. a 030 é a última migration e a 019 continua ausente",
  [migrations.at(-1), migrations.some((m) => m.includes("_019_"))],
  [NOME, false],
);
verificar(
  "G2. arredondamento só na COBRANÇA: o custo usa o excedente exato; o feriado só no custo",
  (() => {
    const c = corpo("derivar_valores_por_vigencia");
    const linhaDaCobranca = c.split("\n").find((l) => l.includes("_billed := round")) ?? "";
    return [
      /_ot_cob := case[\s\S]*?arredondar_minutos_extras/.test(c),
      /_cost := round\(\(\( _base_cost \+ _ot_horas \* _ot_cost_hour_rate\)/.test(c),
      /_billed := round\(\(\( _base_cob \+ \(_ot_cob \/ 60\.0\) \* _ot_hour_rate\)/.test(
        linhaDaCobranca,
      ),
      /_fator_feriado|arredondar/.test(linhaDaCobranca),
      /if _dia = 'feriado' and _fator_feriado is not null and _completo then\s+_cost :=/.test(c),
    ];
  })(),
  [true, true, true, false, true],
);
verificar(
  "G3. a hora cobrada é diária ÷ jornada contratual também no sábado (nunca ÷ referência de sábado)",
  /_ot_hour_rate      := \(_daily_rate \/ _shift_hours_efetivo\) \* _ot_factor_efetivo;/.test(
    corpo("derivar_valores_por_vigencia"),
  ) && !/_daily_rate \/ \(?_sabado_horas/.test(corpo("derivar_valores_por_vigencia")),
  true,
);
verificar(
  "G4. modo acumulado: minutos brutos sem tolerância; ajuste por uma função só, usada pela prévia e pela fatura",
  [
    /when _modo = 'acumulado' then _excesso_cob/.test(corpo("derivar_valores_por_vigencia")),
    (
      corpo("gerar_fatura").match(
        /ajustes_de_arredondamento_acumulado\(_client_id, _period_start, _period_end, _ids\)/g,
      ) ?? []
    ).length,
    /temporary/i.test(corpo("gerar_fatura")),
    /vigencia|financial_engine_settings|.terms/i.test(corpo("gerar_fatura")),
  ],
  [true, 2, false, false],
);
verificar(
  "G5. segurança: funções do fechamento exigem admin AAL2; feriados por RPC com trilha; nada para anon",
  [
    /perform public\.condicoes_exigir_admin\(\);/.test(
      corpo("ajustes_de_arredondamento_acumulado"),
    ),
    /perform public\.condicoes_exigir_admin\(\);/.test(corpo("saldo_de_horas_do_periodo")),
    /condicoes_auditar\('feriado_registrado'/.test(corpo("registrar_feriado")),
    /grant [^;]* to (anon|public)\b/i.test(sql),
    /revoke all on table public\.financial_holidays from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
      sql,
    ),
  ],
  [true, true, true, false, true],
);
verificar(
  "G6. o saldo de horas (Dynamis) é só leitura: a função não escreve",
  /\b(insert|update|delete)\b/i.test(corpo("saldo_de_horas_do_periodo")),
  false,
);
const faturamento = ler("src/app/(painel)/faturamento/painel-faturamento.tsx");
const clientes = ler("src/app/(painel)/clientes/painel-clientes.tsx");
const ledger = ler("src/lib/ledger-estado.ts");
verificar(
  "G7. telas só com o anúncio: arredondamento acumulado no Faturamento e calendário em Contratos; ledger pelos minutos cobrados",
  [
    /\{regrasDefinitivas \? \(\s*<ArredondamentoAcumulado/.test(faturamento),
    /\{regrasDefinitivas \? <FeriadosDoCalendario \/> : null\}/.test(clientes),
    /overtimeMinutes: entry\.billed_overtime_minutes \?\? entry\.overtime_minutes/.test(ledger),
    /totalAFaturar = round2\(totals\.billed \+ totalAdicionais \+ totalAjustes\)/.test(faturamento),
  ],
  [true, true, true, true],
);
verificar(
  "G8. o operacional não recebe nada novo",
  readdirSync("src/lib/operacional")
    .map((f) => ler(`src/lib/operacional/${f}`))
    .concat(ler("src/app/(painel)/operacional/painel-operacional.tsx"))
    .some((t) => /billed_overtime|day_kind|feriado|arredond/i.test(t)),
  false,
);

// ---------------------------------------------------------------------------
// H. Conciliação da receita e fracionamento (C05-B8.17)
// ---------------------------------------------------------------------------

console.log("H. Conciliação");

const LINHA = {
  receita_apontamentos: "1034.25",
  adicionais: "0.00",
  ajuste_faturado: "4.50",
  ajuste_previsto: "0.00",
  receita_total: "1038.75",
  a_faturar: "0.00",
  faturado: "1038.75",
  ajuste_aplicavel: true,
};
const brl = (v) => `R$ ${v.toFixed(2)}`;
verificar(
  "H1. lê a linha da RPC (numeric chega como texto) e as parcelas fecham em centavos",
  (() => {
    const r = lerResumoFinanceiro(LINHA);
    return [r?.receita, r?.ajusteFaturado, r ? parcelasFecham(r) : null, r ? ajusteTotal(r) : null];
  })(),
  [1038.75, 4.5, true, 4.5],
);
verificar(
  "H2. resposta fora do formato é recusada (nulo), nunca um total inventado",
  [
    lerResumoFinanceiro(null),
    lerResumoFinanceiro([]),
    lerResumoFinanceiro({ ...LINHA, receita_total: "abc" }),
    lerResumoFinanceiro({ ...LINHA, ajuste_aplicavel: "true" }),
    lerResumoFinanceiro({ ...LINHA, adicionais: undefined }),
  ],
  [null, null, null, null, null],
);
verificar(
  "H3. parcelas que não fecham com o total são detectadas",
  parcelasFecham(lerResumoFinanceiro({ ...LINHA, receita_total: "1039.00" })),
  false,
);
verificar(
  "H4. ajustes negativo, positivo e zero entram uma vez na descrição, com o mesmo texto nas duas telas",
  [
    descricaoDaReceita(lerResumoFinanceiro({ ...LINHA, ajuste_faturado: "-3.75" }), brl),
    descricaoDaReceita(lerResumoFinanceiro({ ...LINHA, ajuste_faturado: "5.25" }), brl),
    descricaoDaReceita(lerResumoFinanceiro({ ...LINHA, ajuste_faturado: "0.00" }), brl),
    descricaoDaReceita(
      lerResumoFinanceiro({ ...LINHA, ajuste_faturado: "2.00", ajuste_previsto: "1.50" }),
      brl,
    ),
  ],
  [
    "Apontamentos R$ 1034.25 + adicionais R$ 0.00 + arredondamento R$ -3.75",
    "Apontamentos R$ 1034.25 + adicionais R$ 0.00 + arredondamento R$ 5.25",
    "Apontamentos R$ 1034.25 + adicionais R$ 0.00",
    "Apontamentos R$ 1034.25 + adicionais R$ 0.00 + arredondamento R$ 3.50",
  ],
);
verificar(
  "H5. com filtro de operação o ajuste não se aplica e a tela diz isso",
  descricaoDaReceita(
    lerResumoFinanceiro({ ...LINHA, ajuste_faturado: "0.00", ajuste_aplicavel: false }),
    brl,
  ),
  "Apontamentos R$ 1034.25 + adicionais R$ 0.00 (arredondamento acumulado não se aplica por operação)",
);
const dashboard = ler("src/app/(painel)/dashboard/painel-dashboard.tsx");
const relatorios = ler("src/app/(painel)/relatorios/painel-relatorios.tsx");
verificar(
  "H6. Dashboard e Relatórios leem a receita do MESMO resumo do banco e usam o mesmo texto das parcelas",
  [dashboard, relatorios].map(
    (t) =>
      /useResumoFinanceiro\(start, end, regrasDefinitivas\)/.test(t) &&
      /resumo\.data\?\.receita \?\?/.test(t) &&
      /descricaoDaReceita\(resumo\.data, brl\)/.test(t),
  ),
  [true, true],
);
verificar(
  "H7. nenhuma fórmula de arredondamento em tela ou nos módulos do resumo (o ajuste só vem do banco)",
  [
    dashboard,
    relatorios,
    ler("src/lib/resumo-financeiro.ts"),
    ler("src/lib/regras-definitivas-dados.ts"),
  ].map((t) => /arredondarMinutosExtras|arredondar_minutos|valor_arredondado\s*-/.test(t)),
  [false, false, false, false],
);
verificar(
  "H8. antes da 030 a receita é a de antes: o resumo só é lido com o anúncio e os adicionais locais só sem ele",
  [dashboard, relatorios].map((t) =>
    /useAdicionaisDoPeriodo\(start, end, regrasBs && !regrasDefinitivas\)/.test(t),
  ),
  [true, true],
);
const sql030 = ler("supabase/migrations/20261028120000_030_regras_definitivas_bs.sql").replace(
  /^\s*--.*$/gm,
  "",
);
const corpoSql = (nome) => {
  const m = sql030.match(
    new RegExp(`function public\\.${nome}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`),
  );
  return m ? m[1] : "";
};
verificar(
  "H9. gerar_fatura valida o fechamento ANTES de qualquer escrita e marca o tipo de cada item",
  (() => {
    const c = corpoSql("gerar_fatura");
    const itens = (c.match(/insert into public\.invoice_items/g) ?? []).length;
    const comTipo = (c.match(/'(diarias|horas_extras|arredondamento|adicional)'/g) ?? []).length;
    return [
      c.indexOf("validar_fechamento_acumulado(") > 0 &&
        c.indexOf("validar_fechamento_acumulado(") < c.indexOf("insert into public.invoices"),
      itens,
      comTipo >= 4,
    ];
  })(),
  [true, 4, true],
);
verificar(
  "H10. o fracionamento é recusado com 55000: período de fechamento inteiro e sem repetir colaborador já faturado",
  (() => {
    const c = corpoSql("validar_fechamento_acumulado");
    return [
      (c.match(/errcode = '55000'/g) ?? []).length,
      /extract\(day from p_inicio\) = 16 and p_fim = _ultimo/.test(c),
      /te\.invoice_id is not null/.test(c),
      /insert|update|delete/i.test(c),
    ];
  })(),
  [2, true, true, false],
);
verificar(
  "H11. o resumo é só leitura, exige admin AAL2 e lê o ajuste faturado pelo TIPO do item (nunca pela descrição)",
  (() => {
    const c = corpoSql("resumo_financeiro_periodo");
    return [
      /condicoes_exigir_admin\(\)/.test(c),
      /it\.kind = 'arredondamento'/.test(c),
      /description/.test(c),
      /insert|update|delete/i.test(c),
      /ajustes_de_arredondamento_acumulado\(c\.cli, q\.qi, q\.qf\)/.test(c),
    ];
  })(),
  [true, true, false, false, true],
);
verificar(
  "H12. nada de acesso novo: sem grant a anon e a validação interna sem EXECUTE de API",
  [
    /grant execute on function public\.validar_fechamento_acumulado/i.test(sql030),
    /'resumo_financeiro_periodo'/.test(sql030),
    /grant [^;]* to (anon|public)\b/i.test(sql030),
  ],
  [false, true, false],
);

console.log("\nI. Cadastro inicial do contrato com os parâmetros da 030 (B8.21)\n");

const linhaContrato = {
  client_id: "cli-1",
  name: "Contrato novo",
  valid_to: null,
  status: "active",
};
const baseValores = {
  daily_rate: "120",
  shift_hours: "8",
  ot_factor: "1,5",
  ot_tolerance_min: "10",
};
const formInicial = (extra = {}, regrasDefinitivas = true) => ({
  inicio: "2026-01-01",
  motivo: "Cadastro inicial do contrato",
  valores: { ...baseValores, ...extra },
  encerrarAnterior: false,
  regrasDefinitivas,
});
const cadastro030 = (extra, flag) =>
  montarCadastroAtomico("contrato", linhaContrato, formInicial(extra, flag)).params;

verificar(
  "I1. sem o anúncio da 030 o cadastro inicial não tem campo novo",
  camposDoCadastroInicialDeContrato(false).length,
  0,
);
verificar(
  "I2. com a 030: modo, sábado e feriado, os mesmos campos da nova vigência",
  camposDoCadastroInicialDeContrato(true)
    .map((c) => c.chave)
    .join(","),
  "ot_rounding_mode,saturday_shift_hours,holiday_pay_factor",
);
igual(
  "I3. contrato novo com os três parâmetros: a RPC atômica recebe os três",
  (({ p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor }) => ({
    p_ot_rounding_mode,
    p_saturday_shift_hours,
    p_holiday_pay_factor,
  }))(
    cadastro030({
      ot_rounding_mode: "acumulado",
      saturday_shift_hours: "4",
      holiday_pay_factor: "2",
    }),
  ),
  { p_ot_rounding_mode: "acumulado", p_saturday_shift_hours: 4, p_holiday_pay_factor: 2 },
);
igual(
  "I4. contrato novo com os padrões válidos: só o modo diário; sábado e feriado vazios não são enviados",
  (({ p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor }) => ({
    p_ot_rounding_mode,
    p_saturday_shift_hours,
    p_holiday_pay_factor,
  }))(cadastro030({ ...PARAMETROS_030_INICIAIS })),
  { p_ot_rounding_mode: "diario" },
);
verificar(
  "I5. antes da 030 a chamada é a de antes: nenhum parâmetro novo",
  Object.keys(
    cadastro030({ ot_rounding_mode: "acumulado", saturday_shift_hours: "4" }, false),
  ).filter((k) => /rounding|saturday|holiday/.test(k)).length,
  0,
);
verificar(
  "I6. validação: sábado acima da jornada",
  errosDosParametros030({ ...PARAMETROS_030_INICIAIS, shift_hours: "8", saturday_shift_hours: "9" })
    .length,
  1,
);
verificar(
  "I7. validação: sábado dentro da jornada, fator 2: sem erro",
  errosDosParametros030({
    ...PARAMETROS_030_INICIAIS,
    shift_hours: "8",
    saturday_shift_hours: "4",
    holiday_pay_factor: "2",
  }).length,
  0,
);
verificar(
  "I8. validação: fator de feriado abaixo de 1",
  errosDosParametros030({ ...PARAMETROS_030_INICIAIS, holiday_pay_factor: "0,5" }).length,
  1,
);
verificar(
  "I9. validação: modo fora das opções",
  errosDosParametros030({ ...PARAMETROS_030_INICIAIS, ot_rounding_mode: "mensal" }).length,
  1,
);
verificar(
  "I10. validação: três casas decimais no sábado",
  errosDosParametros030({ ...PARAMETROS_030_INICIAIS, saturday_shift_hours: "4,125" }).length,
  1,
);
verificar(
  "I11. o erro dos parâmetros não esconde nem inventa erro de outros campos",
  errosDosParametros030({ ...PARAMETROS_030_INICIAIS }).length,
  0,
);
verificar(
  "I12. o envio inválido continua barrado pela montagem (segunda barreira)",
  (() => {
    try {
      cadastro030({ saturday_shift_hours: "9" });
      return "enviou";
    } catch {
      return "barrou";
    }
  })(),
  "barrou",
);
{
  const tela = semComentarios(
    ler(new URL("../src/app/(painel)/clientes/painel-clientes.tsx", import.meta.url)),
  );
  verificar(
    "I13. campos só aparecem com a 030, motor por vigência e contrato NOVO",
    /camposDoCadastroInicialDeContrato\(\s*regrasDefinitivas && modoDeTaxa === "por-vigencia" && !contractForm\.id,?\s*\)/.test(
      tela,
    ),
    true,
  );
  verificar(
    "I14. o envio usa a RPC atômica e informa regrasDefinitivas só quando os campos existem",
    /regrasDefinitivas: camposDa030\.length > 0/.test(tela),
    true,
  );
  verificar(
    "I15. parâmetros da 030 nunca vão no payload da edição tradicional (saveContract)",
    /payload\[["'](ot_rounding_mode|saturday_shift_hours|holiday_pay_factor)/.test(tela),
    false,
  );
  verificar(
    "I16. o botão salvar fica desabilitado com erro dos parâmetros",
    /errosDa030\.length > 0 \|\|/.test(tela),
    true,
  );
  verificar(
    "I17. contrato existente continua por nova vigência (campos fora do formulário de edição)",
    /!contractForm\.id\s*\)/.test(tela),
    true,
  );
  verificar(
    "I18. nenhuma gravação direta em contract_terms nem service_role na tela",
    /contract_terms|service_role/.test(tela),
    false,
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
