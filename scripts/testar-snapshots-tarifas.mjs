/**
 * Snapshots de função/período e tarifas por função e período (FIN-PR-07).
 *
 * COMO RODAR:  npm run test:snapshots-tarifas
 *
 * Sem rede e sem banco. As provas com banco são as suítes SQL `040_snapshots_funcao_periodo.sql` e
 * `041_tarifas_por_funcao_e_periodo.sql`, os ensaios `comparar-catalogo-snapshots.sh` e
 * `comparar-catalogo-tarifas.sh` e a compatibilidade de deploy (bancos 034, 037, 038, 039, 040 e 041,
 * resolução desligada e ligada).
 *
 *   T  regras puras das tarifas (tarifas.ts): validação, vigência, quadro "Não configurada"
 *   P  payload do salvamento: a função só vai em linha nova e só com a capacidade
 *   M  migrations 040 e 041: só o previsto, o motor só ganha INSERÇÕES, resolução desligada
 *   R  runbooks devolvem os corpos vigentes antes de cada migration
 *   F  o código financeiro do app não conhece snapshot nem tarifa
 *   C  telas, capacidade e CI
 */

import { readFileSync, readdirSync } from "node:fs";

import { montarCargaDaRpc } from "../src/lib/apontamentos-salvar.ts";
import {
  funcoesDoQuadro,
  interpretarResolucaoDeTarifas,
  interpretarSnapshotsDeFuncao,
  interpretarTarifasPorFuncao,
  lerValorDaTarifa,
  montarQuadroDeTarifas,
  montarRegistroDeTarifa,
  pendenteDeClassificacao,
  rotuloDaVigencia,
  tarifaNaData,
  validarTarifa,
} from "../src/lib/tarifas.ts";
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
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();

// ---------------------------------------------------------------------------
console.log("T. Regras puras das tarifas");
verificar(
  "T1. capacidades: só `true` explícito liga; erro, ausência, texto e lista não",
  [
    interpretarTarifasPorFuncao({ tarifas_por_funcao: true }, null),
    interpretarTarifasPorFuncao({ tarifas_por_funcao: "true" }, null),
    interpretarSnapshotsDeFuncao({ snapshots_funcao_periodo: true }, null),
    interpretarSnapshotsDeFuncao({}, null),
    interpretarResolucaoDeTarifas({ resolucao_tarifas: true }, null),
    interpretarResolucaoDeTarifas({ resolucao_tarifas: false }, null),
    interpretarResolucaoDeTarifas({ resolucao_tarifas: true }, { message: "x" }),
    interpretarTarifasPorFuncao([], null),
  ],
  [true, false, true, false, true, false, false, false],
);
const F = {
  contratoId: "k1",
  funcaoId: "f1",
  periodo: "diurno",
  inicio: "2026-04-01",
  valor: "160,00",
  motivo: "Reajuste",
};
verificar(
  "T2. validação: campo vazio NUNCA vira zero; zero, negativo, 3 casas, data inexistente e período inválido são recusados",
  [
    validarTarifa(F),
    validarTarifa({ ...F, valor: "" }),
    validarTarifa({ ...F, valor: "0" }),
    validarTarifa({ ...F, valor: "-5" }),
    validarTarifa({ ...F, valor: "10,005" }),
    validarTarifa({ ...F, inicio: "2026-02-30" }),
    validarTarifa({ ...F, periodo: "" }),
    validarTarifa({ ...F, motivo: "  " }),
    validarTarifa({ ...F, funcaoId: "" }),
  ].map((e) => e.length),
  [0, 1, 1, 1, 1, 1, 1, 1, 1],
);
verificar(
  "T3. valor: vírgula ou ponto decimal; milhar com ponto não é aceito de propósito",
  [
    lerValorDaTarifa("160,5"),
    lerValorDaTarifa("160.50"),
    lerValorDaTarifa("1.234,56"),
    lerValorDaTarifa(""),
  ],
  [160.5, 160.5, null, null],
);
verificar(
  "T4. registro: parâmetros nomeados, diária numérica e versão nova (encerra a anterior)",
  montarRegistroDeTarifa(F),
  {
    p_contract_id: "k1",
    p_job_function_id: "f1",
    p_shift_period: "diurno",
    p_valid_from: "2026-04-01",
    p_daily_rate: 160,
    p_reason: "Reajuste",
    p_encerrar_anterior: true,
  },
);
const TARIFAS = [
  {
    id: "t1",
    contract_id: "k1",
    job_function_id: "f1",
    shift_period: "diurno",
    valid_from: "2026-01-01",
    valid_to: "2026-04-01",
    daily_rate: "160.00",
    active: true,
  },
  {
    id: "t2",
    contract_id: "k1",
    job_function_id: "f1",
    shift_period: "diurno",
    valid_from: "2026-04-01",
    valid_to: null,
    daily_rate: "176.00",
    active: true,
  },
  {
    id: "t3",
    contract_id: "k1",
    job_function_id: "f1",
    shift_period: "noturno",
    valid_from: "2026-01-01",
    valid_to: null,
    daily_rate: "200.00",
    active: true,
  },
  {
    id: "t4",
    contract_id: "k1",
    job_function_id: "f2",
    shift_period: "diurno",
    valid_from: "2026-01-01",
    valid_to: null,
    daily_rate: "120.00",
    active: false,
  },
];
verificar(
  "T5. vigência [início, fim): dia anterior ao reajuste = 160, dia exato = 176, antes de 2026 = nenhuma; aposentada não vale",
  [
    tarifaNaData(TARIFAS, "f1", "diurno", "2026-03-31")?.id,
    tarifaNaData(TARIFAS, "f1", "diurno", "2026-04-01")?.id,
    tarifaNaData(TARIFAS, "f1", "diurno", "2025-12-31")?.id ?? null,
    tarifaNaData(TARIFAS, "f2", "diurno", "2026-03-01")?.id ?? null,
  ],
  ["t1", "t2", null, null],
);
verificar(
  "T6. duas tarifas possíveis na mesma data (dado inconsistente): a tela NÃO escolhe uma",
  tarifaNaData([...TARIFAS, { ...TARIFAS[1], id: "dup" }], "f1", "diurno", "2026-05-01"),
  null,
);
verificar(
  "T7. diurno e noturno são independentes (200 só no noturno; nada presumido para quem não tem)",
  [
    tarifaNaData(TARIFAS, "f1", "noturno", "2026-03-01")?.daily_rate,
    tarifaNaData(TARIFAS, "f2", "noturno", "2026-03-01"),
  ],
  ["200.00", null],
);
const quadro = montarQuadroDeTarifas(TARIFAS, ["f1", "f2", "f3"], "2026-03-15");
verificar(
  "T8. quadro em 15/03: f1 diurno 160 (com a de 176 agendada para 01/04) e noturno 200; f2 e f3 'Não configurada'",
  quadro.map((l) =>
    l.celulas.map((c) => [c.tarifa?.daily_rate ?? null, c.proxima?.daily_rate ?? null]),
  ),
  [
    [
      ["160.00", "176.00"],
      ["200.00", null],
    ],
    [
      [null, null],
      [null, null],
    ],
    [
      [null, null],
      [null, null],
    ],
  ],
);
verificar(
  "T9. o quadro mostra as funções ativas e as inativas que ainda têm tarifa",
  funcoesDoQuadro(TARIFAS, [
    { id: "f1", active: true },
    { id: "f2", active: false },
    { id: "f3", active: false },
    { id: "f4", active: true },
  ]),
  ["f1", "f4"],
);
verificar(
  "T10. rótulo da vigência",
  [rotuloDaVigencia(TARIFAS[0]), rotuloDaVigencia(TARIFAS[1])],
  ["desde 01/01/2026 até 01/04/2026", "desde 01/04/2026"],
);
verificar(
  "T11. pendência de classificação só com a resolução ligada; falta nunca é pendente",
  [
    pendenteDeClassificacao({ status: "present" }, true),
    pendenteDeClassificacao(
      { status: "present", job_function_id_snapshot: "f1", shift_period_snapshot: "diurno" },
      true,
    ),
    pendenteDeClassificacao({ status: "present" }, false),
    pendenteDeClassificacao({ status: "absent" }, true),
  ],
  [
    { funcao: true, periodo: true },
    { funcao: false, periodo: false },
    { funcao: false, periodo: false },
    { funcao: false, periodo: false },
  ],
);

// ---------------------------------------------------------------------------
console.log("\nP. Payload do salvamento");
const L = (id, entryId, status = "present") => ({
  employeeId: id,
  entryId,
  status,
  checkIn: "06:00",
  checkOut: "15:00",
  breakMinutes: 60,
  notes: "",
});
const mapa = new Map([
  ["e1", "f1"],
  ["e2", "f1"],
  ["e3", "f1"],
  ["e4", ""],
]);
verificar(
  "P1. sem o mapa (banco anterior à 040) o payload é o de antes: nenhuma chave nova",
  montarCargaDaRpc([L("e1", undefined)]).map((l) => Object.keys(l).sort()),
  [["break_minutes", "check_in", "check_out", "employee_id", "notes", "status"]],
);
verificar(
  "P2. com o mapa: só linha NOVA e presente leva a função; linha existente, falta e função vazia não",
  montarCargaDaRpc(
    [L("e1", undefined), L("e2", "id-gravado"), L("e3", undefined, "absent"), L("e4", undefined)],
    mapa,
  ).map((l) => l.job_function_id ?? null),
  ["f1", null, null, null],
);

// ---------------------------------------------------------------------------
console.log("\nM. Migrations 040 e 041");
const N040 = "20261107120000_040_snapshots_funcao_periodo.sql";
const N041 = "20261108120000_041_tarifas_por_funcao_e_periodo.sql";
const m040 = ler(`supabase/migrations/${N040}`);
const m041 = ler(`supabase/migrations/${N041}`);
verificar(
  "M1. 040 e 041 uma vez cada, na sequência 039 -> 040 -> 041; 019 fora",
  [
    migrations.filter((f) => /_040_/.test(f)).length,
    migrations.filter((f) => /_041_/.test(f)).length,
    migrations[migrations.indexOf(N040) - 1]?.includes("_039_"),
    migrations[migrations.indexOf(N040) + 1] === N041,
    migrations.some((f) => /_019_/.test(f)),
  ],
  [1, 1, true, true, false],
);
const sem = (t) => t.replace(/--[^\n]*/g, "");
const comandos = (t) => sem(t).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
verificar(
  "M2. aditivas: nenhum DROP de dado, nenhum DELETE/TRUNCATE de dado, nenhum grant a anon, nenhum gatilho desligado",
  [m040, m041].map((m) => [
    /drop\s+(table|column|policy|trigger)\b/i.test(
      comandos(m).replace(/drop constraint financial_terms_audit_acao_valida/gi, ""),
    ),
    /\b(delete\s+from)\b/i.test(comandos(m)),
    /grant[^;]*\banon\b/i.test(comandos(m)),
    /disable\s+trigger/i.test(comandos(m)),
  ]),
  [
    [false, false, false, false],
    [false, false, false, false],
  ],
);
const nomesRedefinidos = (m) =>
  [...sem(m).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi)].map((x) => x[1]);
verificar(
  "M3. 040 não toca o motor: só cria o gatilho/RPC de snapshots e redefine a trava de colunas, o salvamento do admin e o estado",
  nomesRedefinidos(m040).filter((n) =>
    /derivar|gerar_fatura|nucleo|componentes|ajustes|resumo|fonte|custo/.test(n),
  ),
  [],
);
verificar(
  "M4. 041 redefine do motor SÓ derivar_valores_por_vigencia (e a trava de colunas e o estado); gerar_fatura, núcleo, leitores e custo não",
  nomesRedefinidos(m041).filter((n) =>
    /derivar|gerar_fatura|nucleo|componentes|ajustes|resumo|fonte|custo|saldo|adicional/.test(n),
  ),
  ["derivar_valores_por_vigencia"],
);
// O corpo do motor da 041 = o da 036 + INSERÇÕES (única linha tocada: o ponto e vírgula que passou a ser continuação).
const dv036 = corpoDaFuncao(
  ler("supabase/migrations/20261103120000_036_integracao_nucleo_v2.sql"),
  "derivar_valores_por_vigencia",
);
const dv041 = corpoDaFuncao(m041, "derivar_valores_por_vigencia");
function soInsercoes(antes, depois) {
  const B = depois.split("\n");
  let j = 0;
  const naoEncontradas = [];
  for (const linha of antes.split("\n")) {
    const alvo =
      linha === "      or new.timesheet_id  is distinct from old.timesheet_id;"
        ? "      or new.timesheet_id  is distinct from old.timesheet_id"
        : linha;
    let k = j;
    while (k < B.length && B[k] !== alvo) k++;
    if (k === B.length) naoEncontradas.push(linha);
    else j = k + 1;
  }
  return naoEncontradas;
}
verificar(
  "M5. o corpo do motor da 041 contém TODAS as linhas da 036, na mesma ordem (só há inserções)",
  soInsercoes(dv036, dv041),
  [],
);
verificar(
  "M6. a tarifa só é lida com a resolução ligada e contrato; faltar snapshot ou tarifa recusa (55000 / P0002), sem fallback nem zero",
  [
    /if _res and _origem = 'versao' then[\s\S]*?end if;\s*\n\s*_shift_hours := _fonte\.o_shift_hours;/.test(
      dv041,
    ),
    /Apontamento pendente de classificação: sem função trabalhada[\s\S]*?errcode = '55000'/.test(
      dv041,
    ),
    /Apontamento pendente de classificação: o turno desta folha[\s\S]*?errcode = '55000'/.test(
      dv041,
    ),
    /Sem tarifa vigente em %[\s\S]*?errcode = 'P0002'/.test(dv041),
    /coalesce\(_tar\./.test(dv041),
  ],
  [true, true, true, true, false],
);
verificar(
  "M7. a chave nasce DESLIGADA e a resolução exige também o motor ligado",
  [
    /tarifas_por_funcao boolean not null default false/.test(m041),
    /insert into public\.pricing_settings \(id\) values \(true\)/.test(m041),
    /p\.tarifas_por_funcao from public\.pricing_settings p where p\.id\), false\)\s+and public\.motor_ativo\(\)/.test(
      m041,
    ),
  ],
  [true, true, true],
);
verificar(
  "M8. tarifa: valor positivo exato, sem sobreposição entre versões ativas, imutável, sem exclusão, só RPC",
  [
    /daily_rate\s+numeric\(12,2\) not null/.test(m041),
    /constraint contract_rate_terms_diaria_positiva check \(daily_rate > 0\)/.test(m041),
    /exclude using gist \([\s\S]*?contract_id with =, job_function_id with =, shift_period with =/.test(
      m041,
    ),
    /trg_contract_rate_terms_imutavel[\s\S]*?proteger_versao_financeira/.test(m041),
    /Tarifa não é apagada/.test(m041),
    /grant (insert|update|delete)[^;]*contract_rate_terms/i.test(m041),
    /grant select on table public\.contract_rate_terms to authenticated/.test(m041),
  ],
  [true, true, true, true, true, false, true],
);
verificar(
  "M9. tarifa já usada não se corrige nem se aposenta; mudança comercial = versão nova com a MESMA trava das versões de contrato",
  [
    /Esta tarifa já precificou apontamentos e não se edita/.test(m041),
    /Esta tarifa já precificou apontamentos e não se aposenta/.test(m041),
    (m041.match(/hashtextextended\('condicoes_contrato:'/g) ?? []).length >= 4,
  ],
  [true, true, true],
);
verificar(
  "M10. 040: a trava de colunas recusa escrita direta nos snapshots; o gatilho roda depois dela e antes dos cálculos",
  [
    /new\.job_function_id_snapshot is not null\s+or new\.shift_period_snapshot is not null\s+or new\.job_function_source is not null/.test(
      m040,
    ),
    /trg_timesheet_entries_bz_snapshots_funcao_periodo/.test(m040),
    "trg_timesheet_entries_bloqueia_condicoes" <
      "trg_timesheet_entries_bz_snapshots_funcao_periodo" &&
      "trg_timesheet_entries_bz_snapshots_funcao_periodo" <
        "trg_timesheet_entries_calculo_financeiro" &&
      "trg_timesheet_entries_bz_snapshots_funcao_periodo" <
        "trg_timesheet_entries_calculo_vigencia",
  ],
  [true, true, true],
);
verificar(
  "M11. 040: a função nunca é inventada (sem informação fica nula) e o período nunca vem do horário",
  [
    /select s\.shift_period from public\.shifts s where s\.id = _shift/.test(m040),
    /order by \(ot\.shift_id is not distinct from _shift\) desc/.test(m040),
    /employees/.test(sem(corpoDaFuncao(m040, "capturar_snapshots_funcao_periodo"))),
    /crosses_midnight|start_time|end_time/.test(
      sem(corpoDaFuncao(m040, "capturar_snapshots_funcao_periodo")),
    ),
  ],
  [true, true, false, false],
);

// ---------------------------------------------------------------------------
console.log("\nR. Runbooks");
const rb040 = ler("docs/runbooks/rollback-snapshots-funcao-periodo.sql");
const rb041 = ler("docs/runbooks/rollback-tarifas-por-funcao.sql");
const ate = (numero, nome) => {
  let corpo = null;
  for (const f of migrations) {
    if (Number(f.split("_")[1]) >= numero) break;
    const c = corpoDaFuncao(ler(`supabase/migrations/${f}`), nome);
    if (c !== null) corpo = c;
  }
  return corpo;
};
verificar(
  "R1. o runbook da 040 devolve os corpos vigentes antes dela (trava de colunas, salvar do admin, estado)",
  ["bloquear_colunas_de_condicoes", "salvar_apontamento_admin", "estado_motor_vigencia"].map(
    (n) => corpoDaFuncao(rb040, n) === ate(40, n),
  ),
  [true, true, true],
);
verificar(
  "R2. o runbook da 041 devolve os corpos vigentes antes dela (motor, trava de colunas, estado)",
  ["derivar_valores_por_vigencia", "bloquear_colunas_de_condicoes", "estado_motor_vigencia"].map(
    (n) => corpoDaFuncao(rb041, n) === ate(41, n),
  ),
  [true, true, true],
);
verificar(
  "R3. os dois runbooks RECUSAM antes de remover dado e rodam numa transação",
  [rb040, rb041].map((r) => [
    r.indexOf("Reversão recusada") < r.search(/drop (column|table)|alter table[^;]*drop column/i),
    /^begin;$/m.test(r) && /^commit;$/m.test(r),
  ]),
  [
    [true, true],
    [true, true],
  ],
);
verificar(
  "R4. 041: recusa com tarifa, ligação a apontamento, resolução ligada ou trilha; 040: com snapshot ou correção auditada",
  [
    /from public\.contract_rate_terms\) then/.test(rb041),
    /contract_rate_terms_id is not null/.test(rb041),
    /where tarifas_por_funcao/.test(rb041),
    /action like 'tarifa%'/.test(rb041),
    /job_function_id_snapshot is not null or shift_period_snapshot is not null/.test(rb040),
    /action = 'apontamento_snapshots_corrigidos'/.test(rb040),
  ],
  [true, true, true, true, true, true],
);

// ---------------------------------------------------------------------------
console.log("\nF. O código financeiro do app não conhece snapshot nem tarifa");
const FINANCEIRO = [
  "src/lib/billing.ts",
  "src/lib/nucleo-financeiro.ts",
  "src/lib/previa-v2.ts",
  "src/lib/componentes-financeiros.ts",
  "src/lib/apontamentos-financeiro.ts",
  "src/lib/ledger.ts",
  "src/lib/ledger-estado.ts",
  "src/lib/resumo-financeiro.ts",
  "src/lib/adicionais.ts",
  ...readdirSync(new URL("../src/lib/fechamento/", import.meta.url)).map(
    (f) => `src/lib/fechamento/${f}`,
  ),
  "src/app/(painel)/faturamento/painel-faturamento.tsx",
  "src/app/(painel)/dashboard/painel-dashboard.tsx",
  "src/app/(painel)/relatorios/painel-relatorios.tsx",
];
verificar(
  "F1. Fechamento, Faturamento, Relatórios, Dashboard e a prévia não citam snapshot de função/período nem tarifa",
  FINANCEIRO.filter((f) =>
    /job_function_id_snapshot|shift_period_snapshot|contract_rate_terms|lib\/tarifas/.test(ler(f)),
  ),
  [],
);
verificar(
  "F2. as migrations financeiras anteriores à 040 não conhecem os snapshots nem as tarifas",
  migrations
    .filter((f) => Number(f.split("_")[1]) <= 39 && Number(f.split("_")[1]) >= 25)
    .filter((f) =>
      /job_function_id_snapshot|shift_period_snapshot|contract_rate_terms/.test(
        ler(`supabase/migrations/${f}`),
      ),
    ),
  [],
);

// ---------------------------------------------------------------------------
console.log("\nC. Telas, capacidade e CI");
const clientes = ler("src/app/(painel)/clientes/painel-clientes.tsx");
const apont = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
const dados = ler("src/lib/vigencias-dados.ts");
verificar(
  "C1. Contratos: Tarifas só com a capacidade confirmada; a diária genérica some só com a resolução LIGADA",
  [
    /tarifasPorFuncao === "disponivel" && funcoesHabilitadas/.test(clientes),
    /const diariaGenericaSemEfeito = tarifasPorFuncao === "disponivel" && resolucaoDeTarifas === true/.test(
      clientes,
    ),
    /Por função \(ver Tarifas\)/.test(clientes),
  ],
  [true, true, true],
);
verificar(
  "C2. falha ao consultar a capacidade NÃO vira ausência (estado `desconhecida`), e a resolução ilegível é `null`",
  [
    /export function useTarifasPorFuncao\(\): CapacidadeDeTarifas/.test(dados),
    /if \(consulta\.isError\) return "desconhecida"/.test(dados),
    /export function useResolucaoDeTarifas\(\): boolean \| null/.test(dados),
  ],
  [true, true, true],
);
verificar(
  "C3. Apontamentos: a função vai no salvamento só com o anúncio dos snapshots, e só para linha nova",
  [
    /snapshotsDeFuncao\s*\?\s*new Map\(/.test(apont),
    /: undefined,/.test(apont),
    /gravado\.invoice_id/.test(apont),
  ],
  [true, true, true],
);
verificar(
  "C4. Jornada, fator, tolerância e arredondamento continuam com explicação em linguagem da BS",
  [
    /1,5 = hora extra com 50% a mais/.test(clientes),
    /arredondada em blocos de 15\/45 minutos/.test(clientes),
    /Somando a quinzena \(só para clientes que acumulam as horas extras\)/.test(
      ler("src/lib/vigencias-ui.ts"),
    ),
    /Por dia \(padrão\)/.test(ler("src/lib/vigencias-ui.ts")),
  ],
  [true, true, true, true],
);
const pacote = JSON.parse(ler("package.json"));
const ci = ler(".github/workflows/ci.yml");
verificar(
  "C5. script npm e passo de CI",
  [pacote.scripts["test:snapshots-tarifas"], ci.includes("npm run test:snapshots-tarifas")],
  [
    "node --experimental-strip-types --import ./scripts/_resolver-ts.mjs scripts/testar-snapshots-tarifas.mjs",
    true,
  ],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
