/**
 * Catálogo de funções e período do turno (FIN-PR-06).
 *
 * COMO RODAR:  npm run test:funcoes-turno
 *
 * Sem rede e sem banco. A prova com banco é a suíte SQL `039_funcoes_e_periodo_do_turno.sql`, o
 * ensaio `scripts/comparar-catalogo-funcoes.sh` e a compatibilidade de deploy
 * `scripts/testar-compatibilidade-deploy.sh` (bancos até a 034, 037, 038 e 039).
 *
 *   N  normalização e unicidade de nome (espelho do SQL)
 *   V  vínculo por texto exato; ambíguo e desconhecido ficam pendentes; herança na alocação
 *   P  período do turno: classificação explícita; nada inferido
 *   G  capacidade do banco: sem o anúncio nenhum campo novo é enviado
 *   M  migration 039 e runbook: aditiva, sem tocar o financeiro
 *   F  o código financeiro não conhece função nem período
 *   C  telas e CI
 */

import { readFileSync, readdirSync } from "node:fs";

import {
  camposDeFuncaoDoColaborador,
  camposDePeriodoDoTurno,
  funcaoEfetiva,
  funcaoInicialDaAlocacao,
  funcaoPorTextoExato,
  funcoesParaEscolha,
  interpretarFuncoesTurno,
  montarAlocacao,
  nomeDaFuncao,
  normalizarTextoChave,
  opcoesDeFuncao,
  pendentesDeFuncao,
  pendentesResolviveis,
  periodoDoTurno,
  validarNomeDaFuncao,
  validarPeriodoDoTurno,
} from "../src/lib/funcoes.ts";
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

const CATALOGO = [
  { id: "f1", code: "auxiliar_producao", name: "Auxiliar de produção", active: true },
  { id: "f2", code: "conferente", name: "Conferente", active: true },
  { id: "f3", code: "operador", name: "Operador", active: true },
  { id: "f4", code: "administrativo", name: "Administrativo", active: false },
];

// ---------------------------------------------------------------------------
console.log("N. Normalização e unicidade");
verificar(
  "N1. maiúsculas, acento, espaço e pontuação não distinguem (os mesmos casos da suíte SQL)",
  [
    " AUXILIAR de Produção ",
    "auxiliar-de-producao",
    "Conferênte",
    "OPERADOR.",
    "Ñandú Ç",
    "",
    "!!!",
  ].map(normalizarTextoChave),
  ["auxiliardeproducao", "auxiliardeproducao", "conferente", "operador", "nanduc", "", ""],
);
verificar(
  "N2. valor ausente vira vazio",
  [normalizarTextoChave(null), normalizarTextoChave(undefined)],
  ["", ""],
);
verificar(
  "N3. nome novo: vazio, longo, sem letras e duplicado (caixa/acento/espaço) são recusados; nome livre passa",
  [
    validarNomeDaFuncao("   ", CATALOGO),
    validarNomeDaFuncao("x".repeat(81), CATALOGO).length,
    validarNomeDaFuncao("!!!", CATALOGO),
    validarNomeDaFuncao("CONFERÊNTE ", CATALOGO).length,
    validarNomeDaFuncao("Motorista de empilhadeira", CATALOGO),
  ],
  [["Informe o nome da função."], 1, ["O nome da função deve ter letras ou números."], 1, []],
);
verificar(
  "N4. renomear: o próprio nome não conta como duplicado; o de outra função, sim",
  [
    validarNomeDaFuncao("Conferente de carga", CATALOGO, "f2"),
    validarNomeDaFuncao("conferente", CATALOGO, "f2"),
    validarNomeDaFuncao("operador", CATALOGO, "f2").length,
  ],
  [[], [], 1],
);

// ---------------------------------------------------------------------------
console.log("\nV. Vínculo por texto exato, pendentes e herança");
verificar(
  "V1. só a correspondência EXATA e ATIVA vincula; ajudante, plural, texto composto, vazio e inativa não",
  [
    "Conferente",
    "  AUXILIAR de producao ",
    "Ajudante",
    "Conferentes",
    "Auxiliar de produção e limpeza",
    "",
    null,
    "Administrativo",
  ].map((t) => funcaoPorTextoExato(t, CATALOGO)?.code ?? null),
  ["conferente", "auxiliar_producao", null, null, null, null, null, null],
);
const COLABS = [
  { id: "e1", role: "Conferente", job_function_id: null },
  { id: "e2", role: "Ajudante", job_function_id: null },
  { id: "e3", role: "Operador", job_function_id: "f3" },
  { id: "e4", role: "   ", job_function_id: null },
  { id: "e5", role: null },
  { id: "e6", role: "Administrativo", job_function_id: null },
];
verificar(
  "V2. pendentes: texto sem função (E1, E2, E6); vazio, nulo e já vinculado não são pendentes",
  pendentesDeFuncao(COLABS).map((c) => c.id),
  ["e1", "e2", "e6"],
);
verificar(
  "V3. resolvíveis pelo vínculo exato agora: só E1 (E2 é ambíguo; E6 é função inativa)",
  pendentesResolviveis(COLABS, CATALOGO).map((c) => c.id),
  ["e1"],
);
verificar(
  "V4. alocação nova HERDA a função padrão (explícita), mas só se ativa; sem padrão fica sem função",
  [
    funcaoInicialDaAlocacao({ job_function_id: "f2" }, CATALOGO),
    funcaoInicialDaAlocacao({ job_function_id: "f4" }, CATALOGO),
    funcaoInicialDaAlocacao({ job_function_id: null }, CATALOGO),
    funcaoInicialDaAlocacao({}, CATALOGO),
  ],
  ["f2", null, null, null],
);
verificar(
  "V5. função efetiva: a da alocação vence a padrão; sem ela, a padrão; sem nenhuma, nenhuma",
  [
    funcaoEfetiva({ job_function_id: "f3" }, { job_function_id: "f2" }),
    funcaoEfetiva({ job_function_id: null }, { job_function_id: "f2" }),
    funcaoEfetiva({}, { job_function_id: "f2" }),
    funcaoEfetiva(null, { job_function_id: null }),
    funcaoEfetiva(null, null),
  ],
  [
    { funcaoId: "f3", origem: "alocacao" },
    { funcaoId: "f2", origem: "padrao" },
    { funcaoId: "f2", origem: "padrao" },
    { funcaoId: null, origem: "nenhuma" },
    { funcaoId: null, origem: "nenhuma" },
  ],
);
verificar(
  "V6. seletor: só ativas, em ordem; a função inativa JÁ gravada continua aparecendo",
  [
    funcoesParaEscolha(CATALOGO).map((f) => f.code),
    opcoesDeFuncao(CATALOGO, null).map((f) => f.code),
    opcoesDeFuncao(CATALOGO, "f4").map((f) => f.code),
    opcoesDeFuncao(CATALOGO, "f2").map((f) => f.code),
  ],
  [
    ["auxiliar_producao", "conferente", "operador"],
    ["auxiliar_producao", "conferente", "operador"],
    ["auxiliar_producao", "conferente", "operador", "administrativo"],
    ["auxiliar_producao", "conferente", "operador"],
  ],
);
verificar(
  "V7. nome da função: encontrado, inexistente ou ausente",
  [nomeDaFuncao(CATALOGO, "f2"), nomeDaFuncao(CATALOGO, "zz"), nomeDaFuncao(CATALOGO, null)],
  ["Conferente", "—", "—"],
);

// ---------------------------------------------------------------------------
console.log("\nP. Período do turno");
verificar(
  "P1. período lido do cadastro; coluna ausente (banco antigo), nulo e valor estranho = não classificado",
  [
    periodoDoTurno({ shift_period: "diurno" }),
    periodoDoTurno({ shift_period: "noturno" }),
    periodoDoTurno({ shift_period: null }),
    periodoDoTurno({}),
    periodoDoTurno({ shift_period: "tarde" }),
  ],
  ["diurno", "noturno", null, null, null],
);
verificar(
  "P2. turno NOVO exige a escolha (com a 039); turno existente e banco antigo não exigem",
  [
    validarPeriodoDoTurno(null, true, true),
    validarPeriodoDoTurno("noturno", true, true),
    validarPeriodoDoTurno(null, false, true),
    validarPeriodoDoTurno(null, true, false),
  ],
  [["Escolha o período do turno: diurno ou noturno."], [], [], []],
);
verificar(
  "P3. virar a meia-noite não decide o período: a classificação só vem do que foi escolhido",
  [
    periodoDoTurno({ shift_period: null, crosses_midnight: true, start_time: "22:00:00" }),
    periodoDoTurno({ shift_period: "diurno", crosses_midnight: true, start_time: "23:00:00" }),
  ],
  [null, "diurno"],
);

// ---------------------------------------------------------------------------
console.log("\nG. Capacidade do banco");
verificar(
  "G1. anúncio: só `funcoes_turno === true` liga; erro, ausência, texto, nulo e lista não",
  [
    interpretarFuncoesTurno({ funcoes_turno: true }, null),
    interpretarFuncoesTurno({ funcoes_turno: "true" }, null),
    interpretarFuncoesTurno({}, null),
    interpretarFuncoesTurno(null, null),
    interpretarFuncoesTurno([], null),
    interpretarFuncoesTurno({ funcoes_turno: true }, { message: "x" }),
  ],
  [true, false, false, false, false, false],
);
verificar(
  "G2. sem o anúncio nenhum campo novo vai no payload (a coluna não existe no banco antigo)",
  [
    camposDeFuncaoDoColaborador("f2", false),
    camposDePeriodoDoTurno("noturno", false),
    montarAlocacao({ operationId: "o", employeeId: "e", shiftId: "s" }, "f2", false),
  ],
  [{}, {}, { operation_id: "o", employee_id: "e", shift_id: "s", active: true }],
);
verificar(
  "G3. com o anúncio os campos vão explícitos (inclusive nulos: 'sem função' e 'não classificado')",
  [
    camposDeFuncaoDoColaborador("f2", true),
    camposDeFuncaoDoColaborador(null, true),
    camposDePeriodoDoTurno("diurno", true),
    camposDePeriodoDoTurno(null, true),
    montarAlocacao({ operationId: "o", employeeId: "e", shiftId: null }, "f2", true),
  ],
  [
    { job_function_id: "f2" },
    { job_function_id: null },
    { shift_period: "diurno" },
    { shift_period: null },
    { operation_id: "o", employee_id: "e", shift_id: null, active: true, job_function_id: "f2" },
  ],
);

// ---------------------------------------------------------------------------
console.log("\nM. Migration 039 e runbook");
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const NOME = "20261106120000_039_funcoes_e_periodo_do_turno.sql";
const m039 = ler(`supabase/migrations/${NOME}`);
verificar(
  "M1. é a última, número 039 uma vez, timestamp > 038 (20261105120000); 019 fora",
  [
    migrations.at(-1),
    migrations.filter((f) => /_039_/.test(f)).length,
    NOME.slice(0, 14) > "20261105120000",
    migrations.some((f) => /_019_/.test(f)),
  ],
  [NOME, 1, true, false],
);
const semComentarios = m039.replace(/--[^\n]*/g, "");
const comandos = semComentarios.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
verificar(
  "M2. aditiva: nenhum DROP de dado, nenhum DELETE/TRUNCATE, nenhum grant a anon, nenhum trigger desligado",
  [
    /drop\s+(table|column|policy|trigger|constraint)/i.test(comandos),
    /\b(delete\s+from|(?<!before\s)truncate\s+(table\s+)?public)\b/i.test(comandos),
    /grant[^;]*\banon\b/i.test(comandos),
    /disable\s+trigger/i.test(comandos),
    /alter\s+table\s+public\.(timesheet_entries|timesheets|invoices|invoice_items|contract_terms)/i.test(
      comandos,
    ),
  ],
  [false, false, false, false, false],
);
verificar(
  "M3. o único UPDATE de dado é o vínculo por texto exato (employees.job_function_id), e nenhuma coluna de texto é tocada",
  [
    [...semComentarios.matchAll(/update\s+public\.(\w+)/gi)].map((m) => m[1]),
    /set\s+job_function_id\s*=\s*f\.id/i.test(semComentarios),
    /set\s+role\b/i.test(semComentarios),
  ],
  [["job_functions", "job_functions", "employees"], true, false],
);
verificar(
  "M4. nenhuma função financeira é redefinida (só estado_motor_vigencia, com a chave nova)",
  [...semComentarios.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi)]
    .map((m) => m[1])
    .filter((n) =>
      /derivar|gerar_fatura|ajustes|resumo|fechamento|nucleo|componentes|saldo|adicional|periodo_de_cobranca|frequencia/.test(
        n,
      ),
    ),
  [],
);
const m038 = ler("supabase/migrations/20261105120000_038_periodo_contratual.sql");
const estado038 = corpoDaFuncao(m038, "estado_motor_vigencia");
const estado039 = corpoDaFuncao(m039, "estado_motor_vigencia");
const ANTES = "    'periodo_contratual', true);";
const DEPOIS = `    'periodo_contratual', true,
    -- FIN-PR-06 (039): catálogo de funções, função do colaborador e da alocação, período do turno.
    'funcoes_turno', true);`;
verificar(
  "M5. estado_motor_vigencia = corpo da 038 + a chave `funcoes_turno` (nada mais muda)",
  [estado038.includes(ANTES), estado039 === estado038.replace(ANTES, DEPOIS)],
  [true, true],
);
verificar(
  "M6. segurança do catálogo: RLS ligada, sem escrita direta, RPCs com guard de admin e search_path fixo",
  [
    /alter table public\.job_functions enable row level security/.test(m039),
    /grant select on table public\.job_functions to authenticated/.test(m039),
    /grant (insert|update|delete)[^;]*job_functions/i.test(m039),
    (m039.match(/perform public\.funcoes_exigir_admin\(\)/g) ?? []).length,
    /on delete restrict/.test(m039),
  ],
  [true, true, false, 4, true],
);
verificar(
  "M7. colunas novas fora do papel operacional (nenhum grant a bslog_rpc_operacional além do revoke)",
  [
    /grant[^;]*bslog_rpc_operacional/i.test(comandos.replace(/revoke[^;]*;/gi, "")),
    /bslog_rpc_operacional/.test(m039),
  ],
  [false, true],
);
const runbook = ler("docs/runbooks/rollback-funcoes-turno.sql");
verificar(
  "R1. o runbook devolve estado_motor_vigencia ao corpo da 038",
  corpoDaFuncao(runbook, "estado_motor_vigencia") === estado038,
  true,
);
verificar(
  "R2. o runbook RECUSA antes de remover dado e roda numa transação",
  [
    runbook.indexOf("Reversão recusada") < runbook.indexOf("drop column"),
    /shift_period is not null/.test(runbook),
    /operation_team where job_function_id is not null/.test(runbook),
    /normalizar_texto_chave\(e\.role\) <> f\.name_key/.test(runbook),
    /^begin;$/m.test(runbook) && /^commit;$/m.test(runbook),
  ],
  [true, true, true, true, true],
);

// ---------------------------------------------------------------------------
console.log("\nF. O financeiro não conhece função nem período");
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
  "F1. nenhum arquivo de cálculo, Fechamento, Faturamento, Relatórios ou Dashboard cita função ou período do turno",
  FINANCEIRO.filter((f) => /job_function|shift_period|funcoes\.ts|funcoes-dados/.test(ler(f))),
  [],
);
const MOTOR = [
  "20261028120000_030_regras_definitivas_bs.sql",
  "20261103120000_036_integracao_nucleo_v2.sql",
  "20261104120000_037_leitores_por_componentes.sql",
  "20261105120000_038_periodo_contratual.sql",
];
verificar(
  "F2. as migrations financeiras anteriores não conhecem função nem período",
  MOTOR.filter((f) => /job_function|shift_period/.test(ler(`supabase/migrations/${f}`))),
  [],
);

// ---------------------------------------------------------------------------
console.log("\nC. Telas e CI");
const colaboradores = ler("src/app/(painel)/colaboradores/painel-colaboradores.tsx");
const operacoes = ler("src/app/(painel)/operacoes/painel-operacoes.tsx");
verificar(
  "C1. colaboradores: função padrão só com o anúncio; o texto `role` continua sendo enviado",
  [
    /camposDeFuncaoDoColaborador\(form\.job_function_id \|\| null, funcaoNoFormulario\)/.test(
      colaboradores,
    ),
    /role: form\.role \|\| null/.test(colaboradores),
    /useFuncoes\(funcoesHabilitadas\)/.test(colaboradores),
  ],
  [true, true, true],
);
verificar(
  "C2. operações: alocação nova herda a função e a envia explícita; período do turno só com o anúncio",
  [
    /funcaoId: funcaoInicialDaAlocacao\(employee, catalogo\)/.test(operacoes),
    /montarAlocacao\(/.test(operacoes),
    /camposDePeriodoDoTurno\(periodoEscolhido, funcoesHabilitadas\)/.test(operacoes),
    /validarPeriodoDoTurno\(periodoEscolhido, !shiftForm\.id, funcoesHabilitadas\)/.test(operacoes),
  ],
  [true, true, true, true],
);
verificar(
  "C3. a jornada protegida do turno usado segue valendo: horário só entra no payload sem a trava",
  /if \(!jornadaTravada\) \{\s*payload\["start_time"\]/.test(operacoes),
  true,
);
const pacote = JSON.parse(ler("package.json"));
const ci = ler(".github/workflows/ci.yml");
verificar(
  "C4. script npm e passo de CI",
  [pacote.scripts["test:funcoes-turno"], ci.includes("npm run test:funcoes-turno")],
  [
    "node --experimental-strip-types --import ./scripts/_resolver-ts.mjs scripts/testar-funcoes-turno.mjs",
    true,
  ],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
