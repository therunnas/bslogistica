/**
 * Regras financeiras confirmadas pela BS (C05-B8.10, migration 029).
 *
 * COMO RODAR:
 *
 *   npm run test:regras-bs
 *
 * Sem framework, sem rede e sem banco: Node executa os módulos TypeScript direto
 * (`--experimental-strip-types`). Sai com código diferente de zero em qualquer falha.
 *
 * O QUE ESTA SUÍTE PROVA
 *
 *   A  prévia (`calcEntry`) com os MESMOS números que `supabase/tests/027_regras_financeiras_bs.sql`
 *      prova no banco: diária normal, falta, substituição, saída antecipada (custo proporcional,
 *      cobrança inteira), hora extra cobrada e paga, valor-hora congelado, operação sem contrato
 *   B  sem as opções novas, `calcEntry` é o de antes (o motor antigo e o banco sem a 029)
 *   C  oráculo independente (frações exatas com BigInt, sem importar billing.ts) numa grade
 *   D  `valorDaLinha`: a prévia só usa as regras novas com o motor ligado E o anúncio da 029
 *   E  anúncio `regras_bs`, campo opcional do valor-hora, cadastro atômico, condição do dia
 *   F  adicionais: validação, parâmetros, elegibilidade igual à de `gerar_fatura`, soma
 *   G  forma da migration 029 e das telas (o que não pode regredir)
 */

import { readFileSync, readdirSync } from "node:fs";

import { calcEntry } from "../src/lib/billing.ts";
import { valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";
import {
  CAMPOS_DA_VIGENCIA,
  camposDaVigencia,
  interpretarRegrasDaBs,
  montarCadastroAtomico,
  montarRegistro,
  resolverCondicaoDoDia,
  validarNovaVigencia,
} from "../src/lib/vigencias-ui.ts";
import {
  adicionalElegivel,
  adicionalForaDoPeriodo,
  montarRegistroDeAdicional,
  situacaoDoAdicional,
  somarAdicionais,
  validarAdicional,
} from "../src/lib/adicionais.ts";

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

// ---------------------------------------------------------------------------
// A. Os números da suíte SQL 027, pela prévia
// ---------------------------------------------------------------------------

console.log("A. Prévia com os números provados no banco (027)");

const K1 = { daily_rate: 120, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 };
const AVULSA = { daily_rate: 250, shift_hours: 8, ot_factor: 1, ot_tolerance_min: 10 };

/** Motor por vigência com a 029: valor-hora acordado e custo proporcional. */
function nova(regras, custo, horaExtra, status, entrada, saida, pausa = 60) {
  const r = calcEntry({
    status,
    checkIn: entrada,
    checkOut: saida,
    breakMinutes: pausa,
    plannedMinutes: 480,
    rules: regras,
    employeeDailyCost: custo,
    employeeOtHourCost: horaExtra,
    proportionalCost: true,
  });
  return [r.billedAmount, r.costAmount, r.workedMinutes, r.overtimeMinutes];
}

verificar(
  "A1. diária normal (E1 80, 25/h; 06-15): 120 / 80",
  nova(K1, 80, 25, "present", "06:00", "15:00"),
  [120, 80, 480, 0],
);
verificar("A2. falta: 0 / 0", nova(K1, 60, null, "absent", null, null).slice(0, 2), [0, 0]);
verificar(
  "A3. substituto (reposição) com apontamento próprio: 120 / 80",
  nova(K1, 80, 25, "replacement", "06:00", "15:00"),
  [120, 80, 480, 0],
);
verificar(
  "B1. saída antecipada 06-11 (240 de 480): cobra 120, paga 40",
  nova(K1, 80, 25, "present", "06:00", "11:00"),
  [120, 40, 240, 0],
);
verificar(
  "B2. 06:00-14:55 (475): 80 × 475/480 = 79,17, sem tolerância nem arredondamento",
  nova(K1, 80, 25, "present", "06:00", "14:55"),
  [120, 79.17, 475, 0],
);
verificar(
  "B3. presença sem saída (pendente): diária de custo inteira, 120 / 60",
  nova(K1, 60, null, "present", "06:00", null),
  [120, 60, 0, 0],
);
verificar(
  "C1. E2 sem valor-hora, 2 h extra: 165 / 60 + 2 × 7,50 = 75",
  nova(K1, 60, null, "present", "06:00", "17:00"),
  [165, 75, 600, 120],
);
verificar(
  "C2. E3 com 25/h, 2 h extra: 165 / 80 + 2 × 25 = 130 (cobrança independente)",
  nova(K1, 80, 25, "present", "06:00", "17:00"),
  [165, 130, 600, 120],
);
verificar(
  "C3. tolerância: 06:00-15:08 sem hora extra e sem proporcional: 120 / 80",
  nova(K1, 80, 25, "present", "06:00", "15:08"),
  [120, 80, 488, 0],
);
verificar(
  "E1. E4 versão 100 / 30: 165 / 160",
  nova(K1, 100, 30, "present", "06:00", "17:00"),
  [165, 160, 600, 120],
);
verificar(
  "E2. E4 reajuste 110 / 35: 165 / 180",
  nova(K1, 110, 35, "present", "06:00", "17:00"),
  [165, 180, 600, 120],
);
verificar(
  "E3. preço congelado, 3 h extra: 187,50 / 190",
  nova(K1, 100, 30, "present", "06:00", "18:00"),
  [187.5, 190, 660, 180],
);
verificar(
  "E5. troca para E7 (90 / 20): 187,50 / 150",
  nova(K1, 90, 20, "present", "06:00", "18:00"),
  [187.5, 150, 660, 180],
);
verificar(
  "F1. avulsa, saída antecipada: 250 / 40",
  nova(AVULSA, 80, 25, "present", "06:00", "11:00"),
  [250, 40, 240, 0],
);
verificar(
  "F2. avulsa, hora extra (fator 1): 312,50 / 75",
  nova(AVULSA, 60, null, "present", "06:00", "17:00"),
  [312.5, 75, 600, 120],
);
verificar(
  "H1. conciliação da fatura de C1 (8 diárias): receita 1.440,00, custo 670,00; + adicional 350 = 1.790,00",
  (() => {
    const linhas = [
      nova(K1, 80, 25, "present", "06:00", "15:00"),
      nova(K1, 80, 25, "replacement", "06:00", "15:00"),
      nova(K1, 80, 25, "present", "06:00", "11:00"),
      nova(K1, 60, null, "present", "06:00", "17:00"),
      nova(K1, 80, 25, "present", "06:00", "17:00"),
      nova(K1, 90, 20, "present", "06:00", "18:00"),
      nova(AVULSA, 80, 25, "present", "06:00", "11:00"),
      nova(AVULSA, 60, null, "present", "06:00", "17:00"),
    ];
    const c = (f) => Math.round(linhas.reduce((t, l) => t + f(l) * 100, 0)) / 100;
    const receita = c((l) => l[0]);
    const custo = c((l) => l[1]);
    return [
      receita,
      custo,
      Math.round((receita + 350) * 100) / 100,
      Math.round((receita + 350 - custo) * 100) / 100,
    ];
  })(),
  [1440, 670, 1790, 1120],
);

// ---------------------------------------------------------------------------
// B. Sem as opções novas, nada muda
// ---------------------------------------------------------------------------

console.log("B. Motor antigo / banco sem a 029: a fórmula de antes");

function antiga(regras, custo, entrada, saida, extra = {}) {
  const r = calcEntry({
    status: "present",
    checkIn: entrada,
    checkOut: saida,
    breakMinutes: 60,
    plannedMinutes: 480,
    rules: regras,
    employeeDailyCost: custo,
    ...extra,
  });
  return [r.billedAmount, r.costAmount];
}
verificar(
  "B4. saída antecipada sem `proportionalCost`: custo da diária inteira (Z3 da 027)",
  antiga(K1, 80, "06:00", "11:00"),
  [120, 80],
);
verificar(
  "B5. hora extra sem valor-hora: diária de custo ÷ jornada (100 = 80 + 2 × 10)",
  antiga(K1, 80, "06:00", "17:00"),
  [165, 100],
);
verificar(
  "B6. valor-hora nulo ou zero é o mesmo que ausente",
  [
    antiga(K1, 80, "06:00", "17:00", { employeeOtHourCost: null }),
    antiga(K1, 80, "06:00", "17:00", { employeeOtHourCost: 0 }),
  ],
  [
    [165, 100],
    [165, 100],
  ],
);
verificar(
  "B7. `proportionalCost: false` explícito: diária inteira",
  antiga(K1, 80, "06:00", "11:00", { proportionalCost: false }),
  [120, 80],
);
verificar(
  "B8. o fator da cobrança nunca entra no custo: fator 2 muda só a receita",
  [
    antiga({ ...K1, ot_factor: 2 }, 80, "06:00", "17:00", { employeeOtHourCost: 25 }),
    antiga(K1, 80, "06:00", "17:00", { employeeOtHourCost: 25 }),
  ],
  [
    [180, 130],
    [165, 130],
  ],
);

// ---------------------------------------------------------------------------
// C. Oráculo independente (frações exatas, sem billing.ts)
// ---------------------------------------------------------------------------

console.log("C. Oráculo independente");

/** num/den arredondado meio para cima (domínio não negativo). */
function arredondar(num, den) {
  const q = num / den;
  return 2n * (num % den) >= den ? q + 1n : q;
}
/**
 * Custo exato em centavos: diária × min(trab, prev)/prev + extra/60 × hora, com a hora como
 * fração (hNum/hDen centavos): sem valor-hora, hora = diária/8.
 */
function custoOraculo(diariaCent, trabalhado, previsto, extra, hNum, hDen) {
  const efetivo = BigInt(Math.min(trabalhado, previsto));
  const p = BigInt(previsto);
  const num = BigInt(diariaCent) * efetivo * 60n * hDen + BigInt(extra) * hNum * p;
  const den = p * 60n * hDen;
  return Number(arredondar(num, den));
}

let total = 0;
const divergentes = [];
const diarias = [4000, 6000, 7999, 8000, 9550, 12345, 15000];
const horas = [null, 1250, 2000, 2500, 3333];
for (const diaria of diarias) {
  for (const hora of horas) {
    for (let saida = 6 * 60 + 61; saida <= 20 * 60; saida += 7) {
      const hh = String(Math.floor(saida / 60)).padStart(2, "0");
      const mm = String(saida % 60).padStart(2, "0");
      const r = calcEntry({
        status: "present",
        checkIn: "06:00",
        checkOut: `${hh}:${mm}`,
        breakMinutes: 60,
        plannedMinutes: 480,
        rules: K1,
        employeeDailyCost: diaria / 100,
        employeeOtHourCost: hora === null ? null : hora / 100,
        proportionalCost: true,
      });
      const trabalhado = saida - 360 - 60;
      const extra = trabalhado - 480 > 10 ? trabalhado - 480 : 0;
      // sem valor-hora: diária ÷ 8 h, em centavos exatos (fração) — via hora = diária/8
      const esperado =
        hora === null
          ? custoOraculo(diaria, trabalhado, 480, extra, BigInt(diaria), 8n)
          : custoOraculo(diaria, trabalhado, 480, extra, BigInt(hora), 1n);
      total++;
      const obtido = Math.round(r.costAmount * 100);
      if (obtido !== esperado)
        divergentes.push(`${diaria}/${hora ?? "-"}/${hh}:${mm}: ${obtido} x ${esperado}`);
    }
  }
}
verificar(
  `C1. custo da prévia = oráculo exato em ${total} casos (saída de 07:01 a 20:00, 5 valores-hora, 7 diárias)`,
  divergentes.slice(0, 3),
  [],
);

// ---------------------------------------------------------------------------
// D. valorDaLinha: quando a prévia usa as regras novas
// ---------------------------------------------------------------------------

console.log("D. valorDaLinha");

function capturar(entrada) {
  let recebido = null;
  valorDaLinha({
    ...entrada,
    calcular: (p) => {
      recebido = { horaExtra: p.custoHoraExtra, proporcional: p.custoProporcional };
      return { billedAmount: 0, costAmount: 0, overtimeMinutes: 0 };
    },
  });
  return recebido;
}
const BASE = {
  status: "present",
  regrasDoCadastro: K1,
  custoDoCadastro: 80,
  plannedMinutes: 480,
};
const CONDICAO = { ok: true, regras: K1, custoDiario: 80, origem: "Contrato", custoHoraExtra: 25 };
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
  ot_hourly_cost_snapshot: 30,
};
verificar(
  "D1. motor desligado: nunca valor-hora nem proporcional, mesmo com o anúncio",
  capturar({
    ...BASE,
    estado: { tag: "desligado" },
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: null,
    regrasBs: true,
  }),
  { horaExtra: null, proporcional: false },
);
verificar(
  "D2. motor ligado SEM o anúncio (banco sem a 029): prévia de antes",
  capturar({
    ...BASE,
    estado: { tag: "ligado", ativadaEm: null },
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: CONDICAO,
    regrasBs: false,
  }),
  { horaExtra: null, proporcional: false },
);
verificar(
  "D3. motor ligado com o anúncio, linha nova: valor-hora da vigência da data e proporcional",
  capturar({
    ...BASE,
    estado: { tag: "ligado", ativadaEm: null },
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: CONDICAO,
    regrasBs: true,
  }),
  { horaExtra: 25, proporcional: true },
);
verificar(
  "D4. linha gravada e editada: valor-hora CONGELADO (30), não o da vigência de hoje (25)",
  capturar({
    ...BASE,
    estado: { tag: "ligado", ativadaEm: null },
    gravada: true,
    tocada: true,
    gravado: GRAVADO,
    condicaoDoDia: CONDICAO,
    regrasBs: true,
  }),
  { horaExtra: 30, proporcional: true },
);
verificar(
  "D5. gravada antes da 029 (sem snapshot): sem valor-hora, como o banco",
  capturar({
    ...BASE,
    estado: { tag: "ligado", ativadaEm: null },
    gravada: true,
    tocada: true,
    gravado: { ...GRAVADO, ot_hourly_cost_snapshot: null },
    condicaoDoDia: CONDICAO,
    regrasBs: true,
  }),
  { horaExtra: null, proporcional: true },
);
verificar(
  "D6. `regrasBs` ausente vale como falso",
  capturar({
    ...BASE,
    estado: { tag: "ligado", ativadaEm: null },
    gravada: false,
    tocada: false,
    gravado: null,
    condicaoDoDia: CONDICAO,
  }),
  { horaExtra: null, proporcional: false },
);

// ---------------------------------------------------------------------------
// E. Anúncio, campo opcional, cadastro atômico, condição do dia
// ---------------------------------------------------------------------------

console.log("E. Telas de vigência");

verificar(
  "E1. anúncio: só `regras_bs === true` liga; erro, ausência, texto e nulo, não",
  [
    interpretarRegrasDaBs({ ativo: true, consistente: true, regras_bs: true }, null),
    interpretarRegrasDaBs({ ativo: true, consistente: true }, null),
    interpretarRegrasDaBs({ regras_bs: "true" }, null),
    interpretarRegrasDaBs({ regras_bs: true }, { code: "42501" }),
    interpretarRegrasDaBs(null, null),
    interpretarRegrasDaBs([true], null),
  ],
  [true, false, false, false, false, false],
);
verificar(
  "E2. o campo de valor-hora só aparece com o anúncio",
  [
    camposDaVigencia("colaborador", false).map((c) => c.chave),
    camposDaVigencia("colaborador", true).map((c) => c.chave),
    camposDaVigencia("contrato", true).length,
  ],
  [
    ["daily_cost"],
    ["daily_cost", "ot_hourly_cost"],
    CAMPOS_DA_VIGENCIA.contrato.filter(
      (c) => c.requerRegrasDefinitivas !== true && c.requerPeriodoContratual !== true,
    ).length,
  ],
);
const FORM = {
  inicio: "2026-11-01",
  motivo: "Reajuste",
  valores: { daily_cost: "90" },
  encerrarAnterior: true,
};
verificar(
  "E3. valor-hora vazio: válido e o parâmetro NÃO é enviado (chamada idêntica à de antes)",
  [
    validarNovaVigencia("colaborador", { ...FORM, regrasBs: true }),
    "p_ot_hourly_cost" in montarRegistro("colaborador", "e-1", { ...FORM, regrasBs: true }).params,
  ],
  [[], false],
);
verificar(
  "E4. valor-hora preenchido com o anúncio: enviado como número (vírgula aceita)",
  montarRegistro("colaborador", "e-1", {
    ...FORM,
    regrasBs: true,
    valores: { daily_cost: "90", ot_hourly_cost: "22,50" },
  }).params["p_ot_hourly_cost"],
  22.5,
);
verificar(
  "E5. valor-hora preenchido SEM o anúncio: ignorado (o banco anterior recusaria o parâmetro)",
  "p_ot_hourly_cost" in
    montarRegistro("colaborador", "e-1", {
      ...FORM,
      regrasBs: false,
      valores: { daily_cost: "90", ot_hourly_cost: "22,50" },
    }).params,
  false,
);
verificar(
  "E6. valor-hora zero, negativo ou com três casas: recusado na tela",
  ["0", "-5", "20,123"].map(
    (v) =>
      validarNovaVigencia("colaborador", {
        ...FORM,
        regrasBs: true,
        valores: { daily_cost: "90", ot_hourly_cost: v },
      }).length > 0,
  ),
  [true, true, true],
);
const LINHA = { name: "E9", doc: null, role: "Conferente", phone: null, status: "active" };
verificar(
  "E7. cadastro atômico: com valor-hora, envia p_ot_hourly_cost; sem, a chamada é a de antes",
  [
    montarCadastroAtomico("colaborador", LINHA, {
      ...FORM,
      regrasBs: true,
      valores: { daily_cost: "70", ot_hourly_cost: "22.5" },
    }).params["p_ot_hourly_cost"],
    "p_ot_hourly_cost" in
      montarCadastroAtomico("colaborador", LINHA, {
        ...FORM,
        regrasBs: true,
        valores: { daily_cost: "70", ot_hourly_cost: "" },
      }).params,
  ],
  [22.5, false],
);
const termo = (extra) => ({
  id: "t",
  valid_from: "2026-01-01",
  valid_to: null,
  active: true,
  origin: "informada",
  reason: "x",
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});
verificar(
  "E8. condição do dia leva o valor-hora da versão de custo da data (ou nulo)",
  [
    resolverCondicaoDoDia({
      data: "2026-03-02",
      contratoId: "k",
      termosContrato: [
        termo({ daily_rate: 120, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 }),
      ],
      termosOperacao: [],
      termosCusto: [termo({ daily_cost: "80", ot_hourly_cost: "25.00" })],
    }).custoHoraExtra,
    resolverCondicaoDoDia({
      data: "2026-03-02",
      contratoId: "k",
      termosContrato: [
        termo({ daily_rate: 120, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 }),
      ],
      termosOperacao: [],
      termosCusto: [termo({ daily_cost: "80", ot_hourly_cost: null })],
    }).custoHoraExtra,
    resolverCondicaoDoDia({
      data: "2026-03-02",
      contratoId: "k",
      termosContrato: [
        termo({ daily_rate: 120, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 }),
      ],
      termosOperacao: [],
      termosCusto: [termo({ daily_cost: "80" })],
    }).custoHoraExtra,
  ],
  [25, null, null],
);

// ---------------------------------------------------------------------------
// F. Adicionais
// ---------------------------------------------------------------------------

console.log("F. Adicionais de serviço");

const AD = {
  clienteId: "c1",
  operacaoId: "",
  inicio: "2026-03-01",
  fim: "2026-03-15",
  motivo: "Etiquetagem",
  referencia: "OS 123",
  valor: "350",
};
verificar("F1. formulário válido", validarAdicional(AD), []);
verificar(
  "F2. recusas: sem cliente, período invertido, motivo vazio, valor zero, três casas, referência longa",
  [
    validarAdicional({ ...AD, clienteId: "" }).length > 0,
    validarAdicional({ ...AD, inicio: "2026-03-15", fim: "2026-03-01" }).length > 0,
    validarAdicional({ ...AD, motivo: "  " }).length > 0,
    validarAdicional({ ...AD, valor: "0" }).length > 0,
    validarAdicional({ ...AD, valor: "10,005" }).length > 0,
    validarAdicional({ ...AD, referencia: "x".repeat(201) }).length > 0,
  ],
  [true, true, true, true, true, true],
);
verificar(
  "F3. parâmetros nomeados de registrar_adicional; referência e operação vazias viram nulo",
  [
    montarRegistroDeAdicional(AD),
    montarRegistroDeAdicional({ ...AD, referencia: " ", operacaoId: "op" })["p_reference"],
    montarRegistroDeAdicional({ ...AD, operacaoId: "op" })["p_operation_id"],
  ],
  [
    {
      p_client_id: "c1",
      p_period_start: "2026-03-01",
      p_period_end: "2026-03-15",
      p_description: "Etiquetagem",
      p_amount: 350,
      p_reference: "OS 123",
      p_operation_id: null,
    },
    null,
    "op",
  ],
);
const ad = (extra) => ({
  id: "a",
  client_id: "c1",
  operation_id: null,
  period_start: "2026-03-01",
  period_end: "2026-03-15",
  description: "x",
  reference: null,
  amount: "350.00",
  invoice_id: null,
  created_at: "",
  canceled_at: null,
  cancel_reason: null,
  ...extra,
});
verificar(
  "F4. elegível como em gerar_fatura: período inteiro dentro, não cancelado, não faturado, do cliente",
  [
    adicionalElegivel(ad({}), "c1", "2026-03-01", "2026-03-15"),
    adicionalElegivel(
      ad({ period_start: "2026-03-10", period_end: "2026-03-20" }),
      "c1",
      "2026-03-01",
      "2026-03-15",
    ),
    adicionalElegivel(
      ad({ canceled_at: "2026-03-05T00:00:00Z", cancel_reason: "x" }),
      "c1",
      "2026-03-01",
      "2026-03-15",
    ),
    adicionalElegivel(ad({ invoice_id: "f" }), "c1", "2026-03-01", "2026-03-15"),
    adicionalElegivel(ad({ client_id: "c2" }), "c1", "2026-03-01", "2026-03-15"),
  ],
  [true, false, false, false, false],
);
verificar(
  "F5. o que cruza o fim do período é avisado (não entra nesta fatura)",
  [
    adicionalForaDoPeriodo(
      ad({ period_start: "2026-03-10", period_end: "2026-03-20" }),
      "c1",
      "2026-03-01",
      "2026-03-15",
    ),
    adicionalForaDoPeriodo(ad({}), "c1", "2026-03-01", "2026-03-15"),
  ],
  [true, false],
);
verificar(
  "F6. situação e soma em centavos (0,1 + 0,2 = 0,30 exato)",
  [
    situacaoDoAdicional(ad({})),
    situacaoDoAdicional(ad({ invoice_id: "f" })),
    situacaoDoAdicional(ad({ canceled_at: "x" })),
    somarAdicionais([ad({ amount: "0.10" }), ad({ amount: 0.2 })]),
  ],
  ["a-faturar", "faturado", "cancelado", 0.3],
);

// ---------------------------------------------------------------------------
// G. Forma da migration e das telas
// ---------------------------------------------------------------------------

console.log("G. Forma");

const migrations = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const NOME_029 = "20261026120000_029_regras_financeiras_bs.sql";
const sql = ler(`supabase/migrations/${NOME_029}`);
const sqlSemComentario = sql.replace(/^\s*--.*$/gm, "");
const corpo = (nome) => {
  const m = sqlSemComentario.match(
    new RegExp(`function public\\.${nome}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`),
  );
  return m ? m[1] : "";
};
verificar(
  "G1. a 029 existe (a 030 vem depois) e a 019 continua ausente",
  [migrations.includes(NOME_029), migrations.some((m) => m.includes("_019_"))],
  [true, false],
);
verificar(
  "G2. a 029 não toca o motor antigo nem afrouxa privilégio (sem grant a anon/service_role, sem disable trigger)",
  [
    /function public\.derivar_valores_financeiros/.test(sqlSemComentario),
    /grant [^;]* to (anon|service_role|public)\b/i.test(sqlSemComentario),
    /disable trigger/i.test(sqlSemComentario),
    /security definer[\s\S]{0,80}condicoes_exigir_admin/.test(sqlSemComentario) ||
      /perform public\.condicoes_exigir_admin\(\)/.test(corpo("registrar_adicional")),
  ],
  [false, false, false, true],
);
verificar(
  "G3. o bloqueio de entrada = saída é gatilho da tabela (vale para tela, API e RPC do operador) e nasce habilitado",
  [
    /create trigger trg_timesheet_entries_bloqueia_horario_igual\s+before insert or update on public\.timesheet_entries/.test(
      sqlSemComentario,
    ),
    /errcode = '23514'/.test(corpo("recusar_entrada_igual_saida")),
  ],
  [true, true],
);
verificar(
  "G4. gerar_fatura soma adicionais sem citar o motor por vigência (o teste O16 da 021 exige isso)",
  [
    /billing_additionals/.test(corpo("gerar_fatura")),
    /vigencia|financial_engine_settings|.terms/i.test(corpo("gerar_fatura")),
  ],
  [true, false],
);
verificar(
  "G5. adicionais: RLS de admin AAL2, sem escrita direta, sem DELETE (cancelamento com motivo)",
  [
    /alter table public\.billing_additionals enable row level security/.test(sqlSemComentario),
    /revoke all on table public\.billing_additionals from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
      sqlSemComentario,
    ),
    /grant select on table public\.billing_additionals to authenticated;/.test(sqlSemComentario),
    /before update or delete on public\.billing_additionals/.test(sqlSemComentario),
  ],
  [true, true, true, true],
);
verificar(
  "G6. o motor por vigência congela o valor-hora e só aplica o proporcional com os dois horários",
  [
    /new\.ot_hourly_cost_snapshot\s*:=\s*_ot_hourly;/.test(corpo("derivar_valores_por_vigencia")),
    /when new\.check_in is not null and new\.check_out is not null and _worked < _planned_efetivo/.test(
      corpo("derivar_valores_por_vigencia"),
    ),
    /_billed := round\(\(\( _daily_rate \+ _ot_horas \* _ot_hour_rate\) \* 100\)::numeric\) \/ 100;/.test(
      corpo("derivar_valores_por_vigencia"),
    ),
  ],
  [true, true, true],
);
const faturamento = ler("src/app/(painel)/faturamento/painel-faturamento.tsx");
const apontamentos = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
const colaboradores = ler("src/app/(painel)/colaboradores/painel-colaboradores.tsx");
verificar(
  "G7. as telas só usam a 029 com o anúncio: adicionais, valor-hora no cadastro, prévia",
  [
    /\{regrasBs \? \(\s*<AdicionaisDoPeriodo/.test(faturamento),
    /modoDeCusto === "por-vigencia" && regrasBs \? \(/.test(colaboradores),
    /regrasBs,[\s\S]{0,600}calcular:/.test(apontamentos),
    /employeeOtHourCost: custoHoraExtra,\s*proportionalCost: custoProporcional,/.test(apontamentos),
  ],
  [true, true, true, true],
);
verificar(
  "G8. o navegador não envia valor de fatura: gerar_fatura segue só com cliente e período",
  /rpc\("gerar_fatura", \{\s*_client_id: selectedClient,\s*_period_start: start,\s*_period_end: end,\s*\}\)/.test(
    faturamento,
  ),
  true,
);
verificar(
  "G9. o operacional não recebe nada novo: nenhuma tela ou módulo do operador cita valor-hora ou adicional",
  readdirSync("src/lib/operacional")
    .map((f) => ler(`src/lib/operacional/${f}`))
    .concat(ler("src/app/(painel)/operacional/painel-operacional.tsx"))
    .some((t) => /ot_hourly|billing_additionals|adicional/i.test(t)),
  false,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
