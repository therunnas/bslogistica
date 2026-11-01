/**
 * Leitores financeiros pelos componentes (FIN-PR-03).
 *
 * COMO RODAR:  npm run test:leitores-componentes
 *
 * Sem rede e sem banco. A prova com banco é a suíte SQL `037_leitores_por_componentes.sql`, o ensaio
 * `scripts/comparar-catalogo-leitores.sh` e a compatibilidade de deploy
 * `scripts/testar-compatibilidade-deploy.sh` (banco até a 034 e até a 037).
 *
 *   U  regra única (componentes-financeiros.ts): V2, legado, falta e integridade, iguais ao SQL
 *   K  componentes sintéticos: a leitura antiga erra; a nova acerta (Fechamento e ledger)
 *   F  Fechamento: consulta escolhida pelo banco; modelo; assinatura do legado inalterada
 *   L  ledger (Faturamento, Relatórios, Dashboard)
 *   M  migration 037 e runbook: só o previsto, corpos vigentes
 *   C  telas e CI
 */

import { readFileSync, readdirSync } from "node:fs";

import { componentesDoLancamento, ErroDeComponentes } from "../src/lib/componentes-financeiros.ts";
import { normalizarLinha } from "../src/lib/fechamento/normalizar.ts";
import { serializarParaAssinatura } from "../src/lib/fechamento/assinatura.ts";
import { carregarFechamento } from "../src/lib/fechamento/carregar.ts";
import {
  SELECT_DO_FECHAMENTO,
  SELECT_DO_FECHAMENTO_COM_COMPONENTES,
} from "../src/lib/fechamento/leitura.ts";
import { ErroDeDadoDoFechamento } from "../src/lib/fechamento/erros.ts";
import { montarLinhas } from "../src/lib/ledger-estado.ts";
import { corpoDaFuncao } from "./gerar-sql-nucleo-financeiro.mjs";

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
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const erroDe = (f) => {
  try {
    f();
    return "sem erro";
  } catch (e) {
    return e?.name ?? "erro";
  }
};

// ---------------------------------------------------------------------------
console.log("U. Regra única dos componentes");
const base = { rotulo: "t", status: "present", diariaSnapshotCentavos: 15000 };
verificar(
  "U1. V2: devolve o gravado, sem derivar",
  componentesDoLancamento({
    ...base,
    cobradoCentavos: 16406,
    calcVersion: 2,
    baseCentavos: 15000,
    extraCentavos: 1406,
    especialCentavos: 0,
    adicionalCentavos: 0,
  }),
  { diariaCentavos: 15000, extraCentavos: 1406, especialCentavos: 0, adicionalCentavos: 0 },
);
verificar(
  "U2. legado: regra da 030 (extra = max(cobrado − diária, 0))",
  componentesDoLancamento({ ...base, cobradoCentavos: 16406, calcVersion: null }),
  { diariaCentavos: 15000, extraCentavos: 1406, especialCentavos: 0, adicionalCentavos: 0 },
);
verificar(
  "U3. banco sem a 036 (coluna não lida) = legado",
  componentesDoLancamento({ ...base, cobradoCentavos: 6667, calcVersion: undefined }),
  { diariaCentavos: 6667, extraCentavos: 0, especialCentavos: 0, adicionalCentavos: 0 },
);
verificar(
  "U4. falta: zero",
  componentesDoLancamento({
    ...base,
    status: "absent",
    cobradoCentavos: 0,
    calcVersion: 2,
    baseCentavos: 0,
    extraCentavos: 0,
    especialCentavos: 0,
    adicionalCentavos: 0,
  }),
  { diariaCentavos: 0, extraCentavos: 0, especialCentavos: 0, adicionalCentavos: 0 },
);
verificar(
  "U5. integridade: ausente, não fecha, especial com diária, legado com adicional, versão desconhecida — todos erro (como R1–R5 no SQL)",
  [
    erroDe(() =>
      componentesDoLancamento({
        ...base,
        cobradoCentavos: 100,
        calcVersion: 2,
        baseCentavos: 100,
        extraCentavos: null,
        especialCentavos: 0,
        adicionalCentavos: 0,
      }),
    ),
    erroDe(() =>
      componentesDoLancamento({
        ...base,
        cobradoCentavos: 100,
        calcVersion: 2,
        baseCentavos: 90,
        extraCentavos: 5,
        especialCentavos: 0,
        adicionalCentavos: 0,
      }),
    ),
    erroDe(() =>
      componentesDoLancamento({
        ...base,
        cobradoCentavos: 100,
        calcVersion: 2,
        baseCentavos: 50,
        extraCentavos: 0,
        especialCentavos: 50,
        adicionalCentavos: 0,
      }),
    ),
    erroDe(() =>
      componentesDoLancamento({
        ...base,
        cobradoCentavos: 100,
        calcVersion: null,
        adicionalCentavos: 5,
      }),
    ),
    erroDe(() => componentesDoLancamento({ ...base, cobradoCentavos: 100, calcVersion: 3 })),
  ],
  Array(5).fill("ErroDeComponentes"),
);
verificar(
  "U6. a classe de erro é a exportada",
  new ErroDeComponentes("x").name,
  "ErroDeComponentes",
);

// ---------------------------------------------------------------------------
console.log("\nK. Sintéticos: a leitura antiga erra, a nova acerta");
const antiga = (cobrado, diaria) => {
  const extra = Math.max(cobrado - diaria, 0);
  return { diaria: cobrado - extra, extra };
};
const adicional = {
  ...base,
  cobradoCentavos: 18500,
  calcVersion: 2,
  baseCentavos: 15000,
  extraCentavos: 0,
  especialCentavos: 0,
  adicionalCentavos: 3500,
};
const especial = {
  ...base,
  cobradoCentavos: 11250,
  calcVersion: 2,
  baseCentavos: 0,
  extraCentavos: 0,
  especialCentavos: 11250,
  adicionalCentavos: 0,
};
verificar(
  "K1. adicional de 35,00: a antiga chama de HE; a nova separa",
  [
    antiga(18500, 15000).extra,
    componentesDoLancamento(adicional).extraCentavos,
    componentesDoLancamento(adicional).adicionalCentavos,
  ],
  [3500, 0, 3500],
);
verificar(
  "K2. horas especiais de 112,50: a antiga chama de diária; a nova separa",
  [
    antiga(11250, 15000).diaria,
    componentesDoLancamento(especial).diariaCentavos,
    componentesDoLancamento(especial).especialCentavos,
  ],
  [11250, 0, 11250],
);

const bruta = (extra) => ({
  id: "e1",
  employee_id: "c1",
  status: "present",
  check_in: "06:00:00",
  check_out: "15:00:00",
  worked_minutes: 480,
  overtime_minutes: 0,
  billed_overtime_minutes: 0,
  day_kind_snapshot: "util",
  invoice_id: null,
  faturado: "185.00",
  custo: "111.11",
  taxa_da_diaria: "150.00",
  employees: { id: "c1", name: "C01", role: "Ajudante" },
  timesheets: {
    id: "f1",
    work_date: "2026-03-05",
    status: "open",
    operation_id: "o1",
    operations: { id: "o1", client_id: "k1", name: "OP1", contract_id: "ct1" },
    shifts: { id: "s1", name: "Dia" },
  },
  ...extra,
});
const n = normalizarLinha(
  bruta({
    calc_version: 2,
    base: "150.00",
    he: "0.00",
    especial: "0.00",
    adicional_diario: "35.00",
  }),
);
verificar(
  "K3. Fechamento V2 com adicional: diária 150,00, HE 0, adicional 35,00",
  [
    n.diariaCentavos,
    n.extraCentavos,
    n.especialCentavos,
    n.adicionalDiarioCentavos,
    n.versaoDoCalculo,
  ],
  [15000, 0, 0, 3500, 2],
);
const nLegado = normalizarLinha(bruta({}));
verificar(
  "K4. o MESMO lançamento lido sem componentes (banco sem a 036) cai na regra antiga — e erra",
  [nLegado.diariaCentavos, nLegado.extraCentavos, nLegado.versaoDoCalculo],
  [15000, 3500, null],
);
verificar(
  "K5. Fechamento recusa lançamento V2 cujos componentes não fecham",
  erroDe(() =>
    normalizarLinha(
      bruta({
        calc_version: 2,
        base: "150.00",
        he: "0.00",
        especial: "0.00",
        adicional_diario: "0.00",
      }),
    ),
  ),
  "ErroDeDadoDoFechamento",
);
verificar(
  "K6. e recusa componente ausente na V2",
  erroDe(() =>
    normalizarLinha(
      bruta({
        calc_version: 2,
        base: "150.00",
        he: null,
        especial: "0.00",
        adicional_diario: "35.00",
      }),
    ),
  ),
  "ErroDeDadoDoFechamento",
);
verificar(
  "K7. o erro é do Fechamento (a rota o trata como dado inválido)",
  new ErroDeDadoDoFechamento("x") instanceof Error,
  true,
);

// ---------------------------------------------------------------------------
console.log("\nF. Fechamento");
const novas = [
  "calc_version",
  "billed_base_amount",
  "billed_overtime_amount",
  "billed_special_amount",
  "additional_amount",
];
verificar(
  "F1. a consulta do banco sem a 036 não pede nenhuma coluna da 036",
  novas.filter((c) => SELECT_DO_FECHAMENTO.includes(c)),
  [],
);
verificar(
  "F2. a consulta com componentes pede as cinco",
  novas.filter((c) => SELECT_DO_FECHAMENTO_COM_COMPONENTES.includes(c)),
  novas,
);
const fonteVazia = () => ({
  lerPagina: async () => ({ linhas: [], total: 0 }),
  contar: async () => 0,
});
const bancoVazio = () => ({
  async resumo() {
    return {
      receitaApontamentosCentavos: 0,
      adicionaisCentavos: 0,
      ajusteFaturadoCentavos: 0,
      ajustePrevistoCentavos: 0,
      receitaTotalCentavos: 0,
      aFaturarCentavos: 0,
      faturadoCentavos: 0,
      ajusteAplicavel: true,
    };
  },
});
const pedidos = [];
for (const componentes of [false, true, undefined]) {
  try {
    await carregarFechamento(
      {
        clienteId: "00000000-0000-4000-8000-000000000001",
        inicio: "2026-03-01",
        fim: "2026-03-15",
      },
      {
        buscarCliente: async () => ({ id: "x", name: "X" }),
        criarFonte: (_f, c) => {
          pedidos.push(c);
          return fonteVazia();
        },
        criarFonteDoBanco: bancoVazio,
        agora: () => new Date("2026-03-20T00:00:00Z"),
        ...(componentes === undefined ? {} : { lerComponentes: async () => componentes }),
      },
    );
  } catch {
    // o banco falso não completa o Fechamento; aqui só importa a escolha da consulta
  }
}
verificar("F3. a fonte recebe a decisão do banco (sem a dependência = leitura antiga)", pedidos, [
  false,
  true,
  false,
]);
const legado = normalizarLinha(bruta({ faturado: "164.06" }));
const linhaV2 = normalizarLinha(
  bruta({
    faturado: "164.06",
    calc_version: 2,
    base: "150.00",
    he: "14.06",
    especial: "0.00",
    adicional_diario: "0.00",
  }),
);
const assinaturaDe = (linha) =>
  serializarParaAssinatura({
    banco: {
      resumo: {
        receitaApontamentosCentavos: 0,
        adicionaisCentavos: 0,
        ajusteFaturadoCentavos: 0,
        ajustePrevistoCentavos: 0,
        receitaTotalCentavos: 0,
        aFaturarCentavos: 0,
        faturadoCentavos: 0,
        ajusteAplicavel: true,
      },
      ajustesPrevistos: [],
      ajustesFaturados: [],
      adicionais: [],
      saldoDeHoras: [],
    },
    clienteId: "k1",
    clienteNome: "K",
    inicio: "2026-03-01",
    fim: "2026-03-15",
    linhas: [linha],
  });
verificar(
  "F4. assinatura do legado não ganhou campos (Fechamentos antigos assinam igual)",
  assinaturaDe(legado).includes('"2,15000,1406'),
  false,
);
verificar(
  "F5. assinatura da V2 inclui os componentes gravados",
  assinaturaDe(linhaV2).includes("2,15000,1406,0,0"),
  true,
);
verificar(
  "F6. legado e V2 com o mesmo dinheiro decompõem igual (diária e HE)",
  [legado.diariaCentavos, legado.extraCentavos],
  [linhaV2.diariaCentavos, linhaV2.extraCentavos],
);

// ---------------------------------------------------------------------------
console.log("\nL. Ledger (Faturamento, Relatórios, Dashboard)");
const tab = {
  timesheets: [
    { id: "f1", operation_id: "o1", shift_id: null, work_date: "2026-03-05", status: "open" },
  ],
  operations: [{ id: "o1", client_id: "k1", name: "OP1", type: "fixed" }],
  clients: [{ id: "k1", name: "K" }],
  employees: [
    { id: "c1", name: "C01" },
    { id: "c2", name: "C02" },
    { id: "c3", name: "C03" },
  ],
  shifts: [],
};
const entrada = (id, emp, extra) => ({
  id,
  timesheet_id: "f1",
  employee_id: emp,
  status: "present",
  worked_minutes: 480,
  overtime_minutes: 0,
  billed_overtime_minutes: 0,
  daily_rate_snapshot: 150,
  cost_amount: 111.11,
  invoice_id: null,
  ...extra,
});
const linhas = montarLinhas({
  ...tab,
  entries: [
    entrada("a", "c1", {
      billed_amount: 185,
      calc_version: 2,
      billed_base_amount: 150,
      billed_overtime_amount: 0,
      billed_special_amount: 0,
      additional_amount: 35,
    }),
    entrada("b", "c2", { billed_amount: 164.06 }),
    entrada("c", "c3", {
      billed_amount: 150,
      calc_version: 2,
      billed_base_amount: 140,
      billed_overtime_amount: 0,
      billed_special_amount: 0,
      additional_amount: 0,
    }),
  ],
});
const porId = Object.fromEntries(
  linhas.rows.map((r) => [r.entryId, [r.dailyValue, r.otValue, r.specialValue, r.additionalValue]]),
);
verificar(
  "L1. V2 com adicional: diária 150, HE 0, adicional 35 (a leitura antiga daria HE 35)",
  porId.a,
  [150, 0, 0, 35],
);
verificar("L2. legado: regra da 030", porId.b, [150, 14.06, 0, 0]);
verificar(
  "L3. V2 inconsistente fica fora das linhas e vira problema visível",
  [porId.c, linhas.problemas],
  [undefined, [{ tipo: "componentes-inconsistentes", quantidade: 1 }]],
);

// ---------------------------------------------------------------------------
console.log("\nM. Migration 037 e runbook");
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const NOME = "20261104120000_037_leitores_por_componentes.sql";
const m037 = ler(`supabase/migrations/${NOME}`);
verificar(
  "M1. número 037 uma vez, timestamp > 036 (20261103120000), seguida só pela 038 (FIN-PR-05) e pela 039 (FIN-PR-06); 019 fora",
  [
    migrations.at(-3),
    migrations.slice(-2),
    migrations.filter((f) => /_037_/.test(f)).length,
    NOME.slice(0, 14) > "20261103120000",
    migrations.some((f) => /_019_/.test(f)),
  ],
  [
    NOME,
    [
      "20261105120000_038_periodo_contratual.sql",
      "20261106120000_039_funcoes_e_periodo_do_turno.sql",
    ],
    1,
    true,
    false,
  ],
);
const semCorpos = m037
  .replace(/--[^\n]*/g, "")
  .replace(/\$(function)?\$[\s\S]*?\$(function)?\$/gi, "$c$");
verificar(
  "M2. nenhum drop de tabela/coluna/função, nenhuma policy, grant, trigger ou DML",
  /\b(drop\s+(table|column|function)|create\s+policy|alter\s+policy|grant\s|create\s+trigger|insert\s+into|update\s+public|delete\s+from|truncate)\b/i.test(
    semCorpos,
  ),
  false,
);
const gf034 = corpoDaFuncao(
  ler("supabase/migrations/20261101120000_034_mfa_somente_login.sql"),
  "gerar_fatura",
);
const gf037 = corpoDaFuncao(m037, "gerar_fatura");
const ini = gf034.indexOf("  -- Diárias por operação");
const fim = gf034.indexOf("  -- B8.15: um item por colaborador");
verificar(
  "M3. gerar_fatura = corpo da 034 com só o bloco de itens trocado e a conferência final",
  [
    gf037.startsWith(gf034.slice(0, ini)),
    gf037.includes(gf034.slice(fim, gf034.lastIndexOf("  return _fatura;"))),
    /if not public\.mfa_cotidiano_ok\(\) then/.test(gf037),
    /<> _fatura\.total_amount then/.test(gf037),
    /greatest\(te\.billed_amount - te\.daily_rate_snapshot/.test(gf037),
  ],
  [true, true, true, true, false],
);
const aj032 = corpoDaFuncao(
  ler("supabase/migrations/20261030120000_032_mfa_opcional.sql"),
  "ajustes_de_arredondamento_acumulado",
);
const aj037 = corpoDaFuncao(m037, "ajustes_de_arredondamento_acumulado");
verificar(
  "M4. ajuste do acumulado = corpo da 032, com o valor bruto vindo do componente",
  [
    /perform public\.condicoes_exigir_admin\(\);/.test(aj037) ===
      /perform public\.condicoes_exigir_admin\(\);/.test(aj032),
    /greatest\(te\.billed_amount - te\.daily_rate_snapshot/.test(aj037),
    /c\.extra as valor/.test(aj037),
  ],
  [true, false, true],
);
const runbook = ler("docs/runbooks/rollback-leitores-por-componentes.sql");
verificar(
  "M5. o runbook recria os corpos vigentes (034 e 032) e só derruba o helper",
  [
    corpoDaFuncao(runbook, "gerar_fatura") === gf034,
    corpoDaFuncao(runbook, "ajustes_de_arredondamento_acumulado") === aj032,
    (runbook.match(/^drop function/gm) ?? []).length,
    /Reversão recusada/.test(runbook),
  ],
  [true, true, 1, true],
);
const helper = corpoDaFuncao(m037, "componentes_do_lancamento");
verificar(
  "M6. o helper SQL é puro e não usa nada além dos parâmetros",
  /\b(select|from|auth\.|public\.)\b/i.test(helper.replace(/--[^\n]*/g, "")),
  false,
);

// ---------------------------------------------------------------------------
console.log("\nC. Telas e CI");
verificar(
  "C1. Faturamento: diárias pelo componente, não por cobrado − HE",
  [
    /totals\.dailyValue/.test(ler("src/app/(painel)/faturamento/painel-faturamento.tsx")),
    /totals\.billed - totals\.otValue/.test(
      ler("src/app/(painel)/faturamento/painel-faturamento.tsx"),
    ),
  ],
  [true, false],
);
verificar(
  "C2. nenhum leitor TypeScript deriva a HE pela diferença fora da regra única",
  [
    "src/lib/ledger-estado.ts",
    "src/lib/fechamento/normalizar.ts",
    "src/app/(painel)/faturamento/painel-faturamento.tsx",
  ].filter((f) =>
    /billed_amount[^\n]*-[^\n]*daily_rate_snapshot|faturadoCentavos\s*-\s*diariaSnapshot/.test(
      ler(f),
    ),
  ),
  [],
);
const pacote = JSON.parse(ler("package.json"));
verificar(
  "C3. a suíte está no package.json e na CI",
  [
    Boolean(pacote.scripts["test:leitores-componentes"]),
    ler(".github/workflows/ci.yml").includes("npm run test:leitores-componentes"),
  ],
  [true, true],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
