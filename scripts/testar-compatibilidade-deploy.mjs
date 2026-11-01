/**
 * Compatibilidade de deploy (FIN-PR-03 e FIN-PR-05) — contra o Supabase LOCAL descartável.
 *
 * COMO RODAR: `bash scripts/testar-compatibilidade-deploy.sh` (sobe o banco local, reseta em três
 * cenários e chama este arquivo). Não roda na CI: precisa do Docker. NUNCA aponta para HML nem
 * Production: a URL vem de `supabase status` local e é recusada se não for 127.0.0.1/localhost.
 *
 * POR QUE EXISTE. A Vercel publica a main sozinha, e as migrations 035 em diante NÃO estão em
 * Production. O app deste PR precisa funcionar com o banco de Production de hoje (até a 034), com o
 * banco até a 037 e com o banco até a 038. Este teste roda o CÓDIGO REAL do app nos três:
 *
 *   F  Fechamento: disponibilidade, carregamento (a mesma função das rotas), CSV e XLSX
 *   L  Faturamento, Relatórios e Dashboard: o ledger (leitura paginada + montarLinhas) e o resumo
 *   P  período contratual: capacidade anunciada, nova condição de contrato e adicional pelo código
 *      do app (com competência só no banco com a 038), leitura dos adicionais
 *   G  gerar_fatura pela sessão do admin, duas chamadas CONCORRENTES (só uma fatura); Fechamento de
 *      novo depois de faturar
 *   H  as rotas HTTP do Next (`/api/fechamento`, `/api/fechamento/xlsx`) e as páginas, com a sessão
 *      de verdade em cookie (se `BASE_URL` for informado)
 *
 * A conta de admin é criada aqui, só no Auth local, e morre com o reset seguinte.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

import { montarRegistroDeAdicional } from "../src/lib/adicionais.ts";
import { montarCargaDaRpc } from "../src/lib/apontamentos-salvar.ts";
import { carregarFechamento, dependenciasComSupabase } from "../src/lib/fechamento/carregar.ts";
import { verificarDisponibilidade } from "../src/lib/fechamento/disponibilidade.ts";
import { csvDoFechamento } from "../src/lib/fechamento/exportacao.ts";
import { gerarXlsxDoFechamento } from "../src/lib/fechamento/xlsx.ts";
import { lerTabelaPaginada } from "../src/lib/paginacao.ts";
import { montarLinhas } from "../src/lib/ledger-estado.ts";
import { lerResumoFinanceiro } from "../src/lib/resumo-financeiro.ts";
import { LEITURAS } from "../src/lib/queries.ts";
import {
  camposDeFuncaoDoColaborador,
  camposDePeriodoDoTurno,
  interpretarFuncoesTurno,
  montarAlocacao,
} from "../src/lib/funcoes.ts";
import {
  interpretarResolucaoDeTarifas,
  interpretarSnapshotsDeFuncao,
  interpretarTarifasPorFuncao,
  montarRegistroDeTarifa,
} from "../src/lib/tarifas.ts";
import {
  interpretarBonusDiario,
  interpretarDiariaIndividual,
  montarBonus,
  montarRegistroDeDiaria,
} from "../src/lib/diaria-individual.ts";
import { interpretarPeriodoContratual, montarRegistro } from "../src/lib/vigencias-ui.ts";

const cenario = process.argv[2] ?? "?";
const esperaComponentes = process.argv[3] === "com-componentes";
const esperaPeriodo = process.argv[4] === "com-periodo";
const esperaFuncoes = process.argv[5] === "com-funcoes";
const esperaSnapshots = process.argv[6] === "com-snap";
const esperaTarifas = process.argv[7] === "com-tarifas";
const esperaDiaria = process.argv[8] === "com-diaria";
const { API_URL, ANON_KEY, SERVICE_ROLE_KEY, CONTAINER, BASE_URL } = process.env;
if (!API_URL || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API_URL)) {
  console.error("API_URL ausente ou não local: este teste só roda contra o Supabase local.");
  process.exit(2);
}

let passou = 0;
const falhas = [];
function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  [${cenario}] ${caso}`);
  } else {
    falhas.push(`[${cenario}] ${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  [${cenario}] ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const psql = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-t",
      "-A",
    ],
    {
      input: sql,
      encoding: "utf8",
    },
  ).trim();

// ---------------------------------------------------------------------------
// Conta de admin LOCAL e sessão real
// ---------------------------------------------------------------------------
const servico = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `admin-compat-${Date.now()}@bslog.test`;
const senha = randomBytes(18).toString("base64url");
const criado = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true });
if (criado.error) throw criado.error;
const uid = criado.data.user.id;
psql(`insert into public.user_roles (user_id, role) values ('${uid}', 'admin');`);

const cliente = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
const entrou = await cliente.auth.signInWithPassword({ email, password: senha });
if (entrou.error) throw entrou.error;
const sessao = entrou.data.session;

// ---------------------------------------------------------------------------
// Dados sintéticos (mesmo SQL nos dois bancos: nenhuma coluna da 036)
// ---------------------------------------------------------------------------
const C = "5c39c000-0000-4000-8000-0000000000c1";
psql(`
insert into public.clients (id, name) values ('${C}', 'COMPAT cliente sintético');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5c39d000-0000-4000-8000-0000000000d1', '${C}', 'KC', 150, 8, 1.5, 10);
insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min,
  active, origin, reason, ot_rounding_mode, saturday_shift_hours, holiday_pay_factor)
  values ('5c39d000-0000-4000-8000-0000000000d1', date '2026-01-01', 150, 8, 1.5, 10, true, 'informada', 'COMPAT', 'diario', 4, 2);
insert into public.operations (id, client_id, contract_id, name)
  values ('5c39e000-0000-4000-8000-0000000000a1', '${C}', '5c39d000-0000-4000-8000-0000000000d1', 'OPC');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
  values ('5c39a000-0000-4000-8000-0000000000a1', '5c39e000-0000-4000-8000-0000000000a1', 'SC', '06:00', '15:00', 60);
insert into public.employees (id, name, daily_cost)
  select ('5c39f000-0000-4000-8000-00000000000' || i)::uuid, 'COMPAT-E' || i, 100 from generate_series(1, 6) i;
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select ('5c39f000-0000-4000-8000-00000000000' || i)::uuid, date '2026-01-01', 100, true, 'informada', 'COMPAT'
    from generate_series(1, 6) i;
`);
const motor = await cliente.rpc("alterar_motor_vigencia", {
  p_ativar: true,
  p_reason: "Ligado no teste de compatibilidade",
});
verificar("M1. motor ligado pela sessão do admin", motor.error?.message ?? motor.data?.ativo, true);
psql(`
insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('5c39b000-0000-4000-8000-000000000001', '5c39e000-0000-4000-8000-0000000000a1', '5c39a000-0000-4000-8000-0000000000a1', date '2026-03-02'),
  ('5c39b000-0000-4000-8000-000000000002', '5c39e000-0000-4000-8000-0000000000a1', '5c39a000-0000-4000-8000-0000000000a1', date '2026-03-07'),
  ('5c39b000-0000-4000-8000-000000000003', '5c39e000-0000-4000-8000-0000000000a1', '5c39a000-0000-4000-8000-0000000000a1', date '2026-03-08');
insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
  ('5c39b000-0000-4000-8000-000000000001', '5c39f000-0000-4000-8000-000000000001', 'present', '06:00', '15:45', 60),
  ('5c39b000-0000-4000-8000-000000000001', '5c39f000-0000-4000-8000-000000000002', 'present', '06:00', '11:00', 60),
  ('5c39b000-0000-4000-8000-000000000001', '5c39f000-0000-4000-8000-000000000003', 'absent', null, null, 0),
  ('5c39b000-0000-4000-8000-000000000002', '5c39f000-0000-4000-8000-000000000004', 'present', '06:00', '13:00', 0),
  ('5c39b000-0000-4000-8000-000000000003', '5c39f000-0000-4000-8000-000000000005', 'present', '06:00', '15:15', 60);
`);
const somaCobrada = Math.round(
  Number(
    psql(
      `select coalesce(sum(billed_amount), 0) from public.timesheet_entries where status <> 'absent';`,
    ),
  ) * 100,
);
const temColunas = psql(
  `select count(*) from information_schema.columns where table_name = 'timesheet_entries' and column_name = 'calc_version';`,
);
verificar(
  "B1. o banco do cenário tem (ou não) as colunas da 036",
  temColunas,
  esperaComponentes ? "1" : "0",
);

// ---------------------------------------------------------------------------
// F. Fechamento (o código das rotas)
// ---------------------------------------------------------------------------
const filtros = { clienteId: C, inicio: "2026-03-01", fim: "2026-03-15" };
const disp = await verificarDisponibilidade(cliente);
verificar("F1. Fechamento disponível", disp, { disponivel: true });
const deps = dependenciasComSupabase(cliente);
verificar(
  "F2. leitura dos componentes decidida pelo banco (nucleo_v2)",
  await deps.lerComponentes(),
  esperaComponentes,
);
const fechamento = await carregarFechamento(filtros, deps);
const c0 = fechamento.consolidado;
verificar(
  "F3. Fechamento carregou, faturado = Σ cobrado do banco",
  c0.faturadoCentavos,
  somaCobrada,
);
verificar(
  "F4. diária + HE + especiais + adicional = faturado",
  c0.diariaCentavos + c0.extraCentavos + c0.especialCentavos + c0.adicionalDiarioCentavos,
  c0.faturadoCentavos,
);
verificar("F5. 4 diárias (a falta não conta)", c0.diarias, 4);
const csvColab = csvDoFechamento(fechamento, "colaborador");
const csvDiario = csvDoFechamento(fechamento, "diario");
verificar(
  "F6. CSV por colaborador e diário gerados",
  [csvColab.split("\r\n").length > 3, csvDiario.split("\r\n").length > 3],
  [true, true],
);
const xlsx = await gerarXlsxDoFechamento(fechamento);
verificar(
  "F7. XLSX gerado (zip válido)",
  [xlsx.length > 2000, xlsx.subarray(0, 2).toString("latin1")],
  [true, "PK"],
);

// ---------------------------------------------------------------------------
// L. Faturamento, Relatórios e Dashboard: ledger e resumo
// ---------------------------------------------------------------------------
const ler = (nome) => lerTabelaPaginada(cliente, LEITURAS[nome]);
const [entries, timesheets, operations, clients, employees, shifts] = await Promise.all(
  ["timesheet_entries", "timesheets", "operations", "clients", "employees", "shifts"].map(ler),
);
const ledger = montarLinhas({ entries, timesheets, operations, clients, employees, shifts });
verificar("L1. ledger sem problema de relação nem de componentes", ledger.problemas, []);
const centavos = (v) => Math.round(v * 100);
const somaLedger = ledger.rows.reduce((s, r) => s + centavos(r.billed), 0);
const somaPartes = ledger.rows.reduce(
  (s, r) =>
    s +
    centavos(r.dailyValue) +
    centavos(r.otValue) +
    centavos(r.specialValue) +
    centavos(r.additionalValue),
  0,
);
verificar(
  "L2. ledger: Σ cobrado = Σ (diária + HE + especiais + adicional) = banco",
  [somaLedger, somaPartes],
  [somaCobrada, somaCobrada],
);
verificar(
  "L3. a HE do ledger = a HE do Fechamento",
  ledger.rows.reduce((s, r) => s + centavos(r.otValue), 0),
  c0.extraCentavos,
);
const resumo = await cliente.rpc("resumo_financeiro_periodo", {
  p_inicio: "2026-03-01",
  p_fim: "2026-03-15",
  p_client_id: C,
});
const r = lerResumoFinanceiro(Array.isArray(resumo.data) ? resumo.data[0] : resumo.data);
verificar(
  "L4. resumo financeiro (Relatórios/Dashboard): receita = Σ cobrado",
  r ? centavos(r.receitaApontamentos) : resumo.error?.message,
  somaCobrada,
);

// ---------------------------------------------------------------------------
// P. Período contratual (FIN-PR-05), pelo código do app
// ---------------------------------------------------------------------------
const estado = await cliente.rpc("estado_motor_vigencia");
const periodoContratual = interpretarPeriodoContratual(estado.data, estado.error);
verificar(
  "P1. capacidade `periodo_contratual` anunciada só no banco com a 038",
  periodoContratual,
  esperaPeriodo,
);
verificar(
  "P2. Fechamento: a decisão do recorte dos adicionais vem do banco",
  await deps.lerPeriodoContratual(),
  esperaPeriodo,
);
// Nova condição de contrato como a tela monta (frequência vazia = não enviada).
const condicao = montarRegistro("contrato", "5c39d000-0000-4000-8000-0000000000d1", {
  inicio: "2026-06-01",
  motivo: "Reajuste de compatibilidade",
  valores: {
    daily_rate: "150",
    shift_hours: "8",
    ot_factor: "1.5",
    ot_tolerance_min: "10",
    closing_period: "",
  },
  encerrarAnterior: true,
  regrasBs: true,
  regrasDefinitivas: true,
  periodoContratual,
});
const registrouCondicao = await cliente.rpc(condicao.rpc, condicao.params);
verificar(
  "P3. nova condição de contrato pela RPC, com os parâmetros que a tela envia",
  [
    registrouCondicao.error?.message ?? typeof registrouCondicao.data,
    "p_closing_period" in condicao.params,
  ],
  ["string", false],
);
// Adicional como a tela monta: com a 038, executado em 20/03 e cobrado na 1ª quinzena; sem ela, a
// execução dentro da 1ª quinzena (regra antiga).
const ADICIONAL_CENTAVOS = 1234;
const formAdicional = {
  clienteId: C,
  operacaoId: "",
  inicio: esperaPeriodo ? "2026-03-20" : "2026-03-05",
  fim: esperaPeriodo ? "2026-03-20" : "2026-03-06",
  motivo: "Etiquetagem sintética",
  referencia: "",
  valor: "12,34",
  ...(periodoContratual ? { competencia: { inicio: "2026-03-01", fim: "2026-03-15" } } : {}),
};
const paramsAdicional = montarRegistroDeAdicional(formAdicional);
const registrouAdicional = await cliente.rpc("registrar_adicional", {
  p_client_id: paramsAdicional.p_client_id,
  p_period_start: paramsAdicional.p_period_start,
  p_period_end: paramsAdicional.p_period_end,
  p_description: paramsAdicional.p_description,
  p_amount: paramsAdicional.p_amount,
  ...("p_billing_period_start" in paramsAdicional
    ? {
        p_billing_period_start: paramsAdicional.p_billing_period_start,
        p_billing_period_end: paramsAdicional.p_billing_period_end,
      }
    : {}),
});
verificar(
  "P4. adicional pela RPC (Serviços adicionais), com competência só no banco com a 038",
  [
    registrouAdicional.error?.message ?? typeof registrouAdicional.data,
    "p_billing_period_start" in paramsAdicional,
  ],
  ["string", esperaPeriodo],
);
const listaAdicionais = await cliente.from("billing_additionals").select("*").eq("client_id", C);
verificar(
  "P5. leitura dos adicionais como a tela faz (select *)",
  [
    listaAdicionais.error?.message ?? listaAdicionais.data.length,
    "billing_period_start" in (listaAdicionais.data?.[0] ?? {}),
  ],
  [1, esperaPeriodo],
);
const comAdicional = await carregarFechamento(filtros, dependenciasComSupabase(cliente));
verificar(
  "P6. Fechamento da 1ª quinzena traz o adicional (pela competência na 038, pela execução antes)",
  [
    comAdicional.adicionais.map((a) => a.valorCentavos),
    comAdicional.adicionais[0]?.competenciaInicio ?? null,
  ],
  [[ADICIONAL_CENTAVOS], esperaPeriodo ? "2026-03-01" : null],
);
if (esperaPeriodo) {
  const mes = await cliente.rpc("gerar_fatura", {
    _client_id: C,
    _period_start: "2026-03-01",
    _period_end: "2026-03-31",
  });
  verificar(
    "P7. 038: o mês inteiro num contrato quinzenal é recusado (22023)",
    mes.error?.code,
    "22023",
  );
  const competencia = await cliente.rpc("competencia_de_cobranca", {
    p_client_id: C,
    p_data: "2026-03-20",
  });
  // App ANTIGO contra o banco 038: o cadastro de adicional não envia competência.
  const antigo = (inicio, fim) =>
    cliente.rpc("registrar_adicional", {
      p_client_id: C,
      p_period_start: inicio,
      p_period_end: fim,
      p_description: "Adicional do app antigo",
      p_amount: 5,
    });
  const antigoDentro = await antigo("2026-03-20", "2026-03-21");
  const gravado = await cliente
    .from("billing_additionals")
    .select("billing_period_start, billing_period_end")
    .eq("id", antigoDentro.data);
  verificar(
    "P7b. 038 + app antigo: execução dentro de uma quinzena grava a competência automática",
    [antigoDentro.error?.message ?? typeof antigoDentro.data, gravado.data?.[0]],
    ["string", { billing_period_start: "2026-03-16", billing_period_end: "2026-03-31" }],
  );
  const antigoCruza = await antigo("2026-03-10", "2026-03-20");
  verificar(
    "P7c. 038 + app antigo: execução que atravessa quinzenas é recusada (22023), sem receita presa",
    [
      antigoCruza.error?.code,
      Number(
        psql(
          `select count(*) from public.billing_additionals where client_id = '${C}' and period_start = date '2026-03-10';`,
        ),
      ),
    ],
    ["22023", 0],
  );
  verificar(
    "P8. 038: competência de cobrança lida pela sessão do admin",
    competencia.error?.message ?? competencia.data,
    [{ frequencia: "quinzenal", inicio: "2026-03-16", fim: "2026-03-31" }],
  );
}

// ---------------------------------------------------------------------------
// K. Funções e período do turno (FIN-PR-06), pelo código do app
// ---------------------------------------------------------------------------
const estadoFuncoes = await cliente.rpc("estado_motor_vigencia");
const funcoesHabilitadas = interpretarFuncoesTurno(estadoFuncoes.data, estadoFuncoes.error);
verificar(
  "K1. capacidade `funcoes_turno` anunciada só no banco com a 039",
  funcoesHabilitadas,
  esperaFuncoes,
);
const E6 = "5c39f000-0000-4000-8000-000000000006";
const OP = "5c39e000-0000-4000-8000-0000000000a1";
const TURNO = "5c39a000-0000-4000-8000-0000000000a1";
let funcaoId = null;
if (funcoesHabilitadas) {
  const catalogo = await cliente
    .from("job_functions")
    .select("id, code, name, active")
    .order("name");
  verificar(
    "K2. catálogo lido pela sessão do admin (4 funções iniciais)",
    catalogo.error?.message ?? catalogo.data.map((f) => f.code).sort(),
    ["administrativo", "auxiliar_producao", "conferente", "operador"],
  );
  funcaoId = catalogo.data?.find((f) => f.code === "conferente")?.id ?? null;
  const nova = await cliente.rpc("criar_funcao", { p_name: "Motorista de empilhadeira" });
  verificar("K3. nova função pela RPC do admin", nova.error?.message ?? typeof nova.data, "string");
} else {
  const ausente = await cliente.from("job_functions").select("id").limit(1);
  verificar(
    "K2. banco sem a 039: a tabela não existe e a tela nem a consulta",
    Boolean(ausente.error),
    true,
  );
}
// O colaborador é salvo como a tela faz: sem a capacidade, o payload é o de antes (sem coluna nova).
const payloadColaborador = {
  role: "Conferente",
  ...camposDeFuncaoDoColaborador(funcaoId, funcoesHabilitadas),
};
const salvouColaborador = await cliente.from("employees").update(payloadColaborador).eq("id", E6);
verificar(
  "K4. salvar colaborador: com a 039 grava a função padrão; sem ela, o payload não leva coluna nova",
  [salvouColaborador.error?.message ?? "ok", "job_function_id" in payloadColaborador],
  ["ok", esperaFuncoes],
);
const alocou = await cliente
  .from("operation_team")
  .insert(
    montarAlocacao(
      { operationId: OP, employeeId: E6, shiftId: TURNO },
      funcaoId,
      funcoesHabilitadas,
    ),
  );
verificar(
  "K5. alocar colaborador (função herdada explícita só com a 039)",
  alocou.error?.message ?? "ok",
  "ok",
);
const turnoNovo = await cliente
  .from("shifts")
  .insert({
    operation_id: OP,
    name: "TN",
    start_time: "22:00:00",
    end_time: "06:00:00",
    break_minutes: 60,
    crosses_midnight: true,
    ...camposDePeriodoDoTurno("noturno", funcoesHabilitadas),
  })
  .select("*")
  .single();
verificar(
  "K6. turno novo (noturno só com a 039); leitura select(*) traz a coluna só no banco novo",
  [
    turnoNovo.error?.message ?? "ok",
    "shift_period" in (turnoNovo.data ?? {}),
    turnoNovo.data?.shift_period ?? null,
  ],
  ["ok", esperaFuncoes, esperaFuncoes ? "noturno" : null],
);
const turnoHistorico = await cliente.from("shifts").select("*").eq("id", TURNO).single();
verificar(
  "K7. turno histórico segue sem classificação e com o mesmo horário",
  [turnoHistorico.data?.shift_period ?? null, turnoHistorico.data?.start_time],
  [null, "06:00:00"],
);
const somaDepois = Math.round(
  Number(
    psql(
      `select coalesce(sum(billed_amount), 0) from public.timesheet_entries where status <> 'absent';`,
    ),
  ) * 100,
);
verificar("K8. nenhum valor financeiro mudou com as mudanças cadastrais", somaDepois, somaCobrada);

// ---------------------------------------------------------------------------
// G. Faturar (duas chamadas concorrentes) e reler
// ---------------------------------------------------------------------------
const chamada = () =>
  cliente.rpc("gerar_fatura", {
    _client_id: C,
    _period_start: "2026-03-01",
    _period_end: "2026-03-15",
  });
const concorrentes = await Promise.all([chamada(), chamada()]);
const fatura = concorrentes.find((c) => !c.error) ?? concorrentes[0];
verificar(
  "G1. gerar_fatura pela sessão do admin: duas chamadas concorrentes, UMA fatura; a outra não acha nada (P0002)",
  [
    concorrentes.filter((c) => !c.error && typeof c.data?.id === "string").length,
    concorrentes.filter((c) => c.error?.code === "P0002").length,
    Number(psql(`select count(*) from public.invoices where client_id = '${C}';`)),
  ],
  [1, 1, 1],
);
const itens = Number(
  psql(
    `select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = '${fatura.data?.id}';`,
  ),
);
const total = Number(
  psql(`select total_amount from public.invoices where id = '${fatura.data?.id}';`),
);
verificar(
  "G2. Σ itens = total da fatura = Σ cobrado + adicional",
  [centavos(itens), centavos(total)],
  [somaCobrada + ADICIONAL_CENTAVOS, somaCobrada + ADICIONAL_CENTAVOS],
);
const depois = await carregarFechamento(filtros, dependenciasComSupabase(cliente));
verificar(
  "G3. Fechamento depois de faturar: tudo já faturado",
  [depois.jaFaturado.faturadoCentavos, depois.aFaturar.faturadoCentavos],
  [somaCobrada, 0],
);

// ---------------------------------------------------------------------------
// Q. Snapshots de função/período (040) e tarifas por função e período (041), pelo código do app
// ---------------------------------------------------------------------------
const estadoQ = await cliente.rpc("estado_motor_vigencia");
verificar(
  "Q1. capacidades anunciadas só nos bancos que as têm (snapshots 040; tarifas 041; resolução desligada)",
  [
    interpretarSnapshotsDeFuncao(estadoQ.data, estadoQ.error),
    interpretarTarifasPorFuncao(estadoQ.data, estadoQ.error),
    interpretarResolucaoDeTarifas(estadoQ.data, estadoQ.error),
  ],
  [esperaSnapshots, esperaTarifas, false],
);
const E = (n) => `5c39f000-0000-4000-8000-00000000000${n}`;
const lerEntrada = async (emp, data) => {
  const r = await cliente
    .from("timesheet_entries")
    .select("*")
    .eq("employee_id", E(emp))
    .eq("work_date", data)
    .maybeSingle();
  return r.data;
};
const salvarDia = (emp, data, funcaoId, saida = "15:00") => {
  const linha = {
    employeeId: E(emp),
    entryId: undefined,
    status: "present",
    checkIn: "06:00",
    checkOut: saida,
    breakMinutes: 60,
    notes: "",
  };
  return cliente.rpc("salvar_apontamento_admin", {
    p_operation_id: "5c39e000-0000-4000-8000-0000000000a1",
    p_shift_id: "5c39a000-0000-4000-8000-0000000000a1",
    p_work_date: data,
    p_linhas: montarCargaDaRpc(
      [linha],
      esperaSnapshots ? new Map([[E(emp), funcaoId ?? ""]]) : undefined,
    ),
  });
};
if (esperaFuncoes) {
  const upd = await cliente
    .from("shifts")
    .update({ shift_period: "diurno" })
    .eq("id", "5c39a000-0000-4000-8000-0000000000a1");
  verificar(
    "Q2. admin classifica o turno do fixture como diurno",
    upd.error?.message ?? "ok",
    "ok",
  );
}
const catQ = esperaFuncoes
  ? ((await cliente.from("job_functions").select("id, code")).data ?? [])
  : [];
const fid = (codigo) => catQ.find((f) => f.code === codigo)?.id ?? null;

if (!esperaSnapshots) {
  // Banco SEM os snapshots: o salvamento é o de antes e nenhuma coluna/RPC nova é usada.
  const s0 = await salvarDia(1, "2026-03-17", null);
  const e0 = await lerEntrada(1, "2026-03-17");
  verificar(
    "Q3. banco sem snapshots: salvar apontamento como sempre; a leitura não traz coluna de snapshot",
    [s0.error?.message ?? "ok", "job_function_id_snapshot" in (e0 ?? {})],
    ["ok", false],
  );
} else {
  const s1 = await salvarDia(1, "2026-03-17", fid("operador"));
  const e1 = await lerEntrada(1, "2026-03-17");
  verificar(
    "Q3. snapshots (040): função informada e período do turno gravados no lançamento",
    [
      s1.error?.message ?? "ok",
      e1?.job_function_id_snapshot === fid("operador"),
      e1?.job_function_source,
      e1?.shift_period_snapshot,
    ],
    ["ok", true, "informada", "diurno"],
  );
  const antes = e1?.billed_amount;
  const corr = await cliente.rpc("corrigir_snapshots_do_apontamento", {
    p_entry_id: e1.id,
    p_job_function_id: fid("conferente"),
    p_atualizar_periodo: false,
    p_reason: "Função conferida (compatibilidade)",
  });
  const e1b = await lerEntrada(1, "2026-03-17");
  verificar(
    "Q4. correção auditada de apontamento não faturado: função muda, valor NÃO muda (resolução desligada)",
    [corr.error?.message ?? "ok", e1b?.job_function_source, e1b?.billed_amount === antes],
    ["ok", "corrigida", true],
  );
  const direto = await cliente
    .from("timesheet_entries")
    .update({ shift_period_snapshot: "noturno" })
    .eq("id", e1.id);
  verificar(
    "Q5. escrita direta no snapshot pelo PostgREST é recusada (42501)",
    direto.error?.code,
    "42501",
  );
}

if (esperaTarifas) {
  const KC = "5c39d000-0000-4000-8000-0000000000d1";
  const novaTarifa = (fn, periodo, valor) =>
    cliente.rpc("registrar_tarifa_contrato", {
      ...montarRegistroDeTarifa({
        contratoId: KC,
        funcaoId: fid(fn),
        periodo,
        inicio: "2026-01-01",
        valor,
        motivo: "Tarifa de compatibilidade",
      }),
    });
  const t1 = await novaTarifa("conferente", "diurno", "160,00");
  const t2 = await novaTarifa("operador", "diurno", "120,00");
  verificar(
    "Q6. tarifas por função e período cadastradas pelo código do app",
    [t1.error?.message ?? "ok", t2.error?.message ?? "ok"],
    ["ok", "ok"],
  );
  const lista = await cliente.from("contract_rate_terms").select("*").eq("contract_id", KC);
  verificar(
    "Q7. tarifas lidas como a tela faz (select por contrato)",
    lista.error?.message ?? lista.data.length,
    2,
  );
  const naData = await cliente.rpc("tarifa_contrato_na_data", {
    p_contract_id: KC,
    p_job_function_id: fid("conferente"),
    p_shift_period: "diurno",
    p_data: "2026-03-18",
  });
  verificar(
    "Q8. tarifa vigente na data lida pela RPC",
    naData.error?.message ?? Number(naData.data?.[0]?.daily_rate),
    160,
  );

  // Resolução DESLIGADA: cadastrar tarifa não muda preço (diária genérica 150).
  const s3 = await salvarDia(3, "2026-03-18", fid("operador"));
  const e3 = await lerEntrada(3, "2026-03-18");
  verificar(
    "Q9. resolução desligada: com tarifas cadastradas o preço continua a diária genérica (150,00) e sem ligação a tarifa",
    [s3.error?.message ?? "ok", Number(e3?.billed_amount), e3?.contract_rate_terms_id ?? null],
    ["ok", 150, null],
  );
  // LIGA (motor ligado + tarifa existente).
  const liga = await cliente.rpc("alterar_resolucao_tarifas", {
    p_ativar: true,
    p_reason: "Ligada no teste de compatibilidade",
  });
  verificar("Q10. admin liga a resolução pelo código do app", liga.error?.message ?? "ok", "ok");
  const estadoLigado = await cliente.rpc("estado_motor_vigencia");
  verificar(
    "Q11. o estado do motor passa a anunciar a resolução ligada",
    interpretarResolucaoDeTarifas(estadoLigado.data, estadoLigado.error),
    true,
  );
  const s4 = await salvarDia(4, "2026-03-19", fid("conferente"));
  const e4 = await lerEntrada(4, "2026-03-19");
  verificar(
    "Q12. resolução ligada: conferente diurno = tarifa 160,00, ligado à versão de tarifa",
    [s4.error?.message ?? "ok", Number(e4?.billed_amount), Boolean(e4?.contract_rate_terms_id)],
    ["ok", 160, true],
  );
  const s5 = await salvarDia(5, "2026-03-19", null);
  const s6 = await salvarDia(2, "2026-03-19", fid("auxiliar_producao"));
  verificar(
    "Q13. resolução ligada: sem função = pendente (55000); função sem tarifa = P0002; nada gravado",
    [
      s5.error?.code,
      s6.error?.code,
      (await lerEntrada(5, "2026-03-19")) === null,
      (await lerEntrada(2, "2026-03-19")) === null,
    ],
    ["55000", "P0002", true, true],
  );
  const e1x = await lerEntrada(1, "2026-03-17");
  verificar(
    "Q14. o apontamento lançado antes de ligar NÃO foi recalculado (continua 150,00 pela diária genérica)",
    [Number(e1x?.billed_amount), e1x?.contract_rate_terms_id ?? null],
    [150, null],
  );
  const desliga = await cliente.rpc("alterar_resolucao_tarifas", {
    p_ativar: false,
    p_reason: "Desligada no teste de compatibilidade",
  });
  verificar("Q15. admin desliga a resolução", desliga.error?.message ?? "ok", "ok");
}

if (esperaSnapshots) {
  // Concorrência: corrigir a função de um apontamento NÃO faturado enquanto a fatura do cliente é gerada.
  const s7 = await salvarDia(2, "2026-03-20", fid("operador"));
  const e7 = await lerEntrada(2, "2026-03-20");
  const [corrida, fat] = await Promise.all([
    cliente.rpc("corrigir_snapshots_do_apontamento", {
      p_entry_id: e7.id,
      p_job_function_id: fid("conferente"),
      p_atualizar_periodo: false,
      p_reason: "Corrida com o faturamento",
    }),
    cliente.rpc("gerar_fatura", {
      _client_id: C,
      _period_start: "2026-03-16",
      _period_end: "2026-03-31",
    }),
  ]);
  const e7b = await lerEntrada(2, "2026-03-20");
  const corrigiu = !corrida.error;
  verificar(
    "Q16. concorrência correção × faturamento: a fatura é gerada; ou a correção entrou ANTES (função nova, faturada) ou foi recusada DEPOIS (55000, função antiga)",
    [
      s7.error?.message ?? "ok",
      !fat.error,
      Boolean(e7b?.invoice_id),
      corrigiu
        ? e7b?.job_function_id_snapshot === fid("conferente")
        : corrida.error?.code === "55000" && e7b?.job_function_id_snapshot === fid("operador"),
    ],
    ["ok", true, true, true],
  );
}

// ---------------------------------------------------------------------------
// S. Diária individual e adicional diário (042), pelo código do app
// ---------------------------------------------------------------------------
const estadoS = await cliente.rpc("estado_motor_vigencia");
verificar(
  "S1. capacidades anunciadas só no banco que as tem (diária individual e adicional diário)",
  [
    interpretarDiariaIndividual(estadoS.data, estadoS.error),
    interpretarBonusDiario(estadoS.data, estadoS.error),
  ],
  [esperaDiaria, esperaDiaria],
);
if (!esperaDiaria) {
  // Banco SEM a 042: a tabela e a RPC não existem e nada do app depende delas.
  const tabela = await cliente.from("contract_employee_rates").select("id").limit(1);
  const rpc = await cliente.rpc("definir_bonus_do_apontamento", {
    p_entry_id: "5c39b000-0000-4000-8000-000000000001",
    p_amount: 1,
    p_reason: "x",
  });
  verificar(
    "S2. banco sem a 042: a tabela e a RPC do adicional não existem (o app nem chega a chamá-las)",
    [
      Boolean(tabela.error),
      Boolean(rpc.error),
      "price_source" in ((await lerEntrada(1, "2026-03-17")) ?? {}),
    ],
    [true, true, false],
  );
} else {
  const KS = "5c39d000-0000-4000-8000-0000000000d1";
  const ind = await cliente.rpc("registrar_diaria_individual", {
    ...montarRegistroDeDiaria({
      contratoId: KS,
      colaboradorId: E(1),
      inicio: "2026-01-01",
      valor: "260,00",
      motivo: "Diária combinada (compatibilidade)",
    }),
  });
  verificar(
    "S2. diária individual registrada pelo código do app",
    ind.error?.message ?? "ok",
    "ok",
  );
  const lista = await cliente.from("contract_employee_rates").select("*").eq("contract_id", KS);
  verificar(
    "S3. diária lida como a tela faz (select por contrato)",
    lista.error?.message ?? [
      lista.data.length,
      Number(lista.data[0].daily_rate),
      lista.data[0].active,
    ],
    [1, 260, true],
  );

  // Resolução DESLIGADA: a individual cadastrada NÃO muda nenhum valor e o adicional é recusado.
  const d1 = await salvarDia(1, "2026-04-06", fid("conferente"));
  const d2 = await salvarDia(2, "2026-04-06", fid("conferente"));
  const ed1 = await lerEntrada(1, "2026-04-06");
  const ed2 = await lerEntrada(2, "2026-04-06");
  verificar(
    "S4. resolução desligada: com diária individual cadastrada o preço é o MESMO do colaborador sem ela (150,00, sem fonte)",
    [
      d1.error?.message ?? "ok",
      d2.error?.message ?? "ok",
      Number(ed1?.billed_amount),
      Number(ed2?.billed_amount),
      ed1?.price_source ?? null,
      ed1?.contract_employee_rate_id ?? null,
      Number(ed1?.additional_amount),
    ],
    ["ok", "ok", 150, 150, null, null, 0],
  );
  const b0 = await cliente.rpc("definir_bonus_do_apontamento", {
    ...montarBonus({ entryId: ed1.id, valor: "30,00", motivo: "Acúmulo" }, false),
  });
  const ed1b = await lerEntrada(1, "2026-04-06");
  verificar(
    "S5. resolução desligada: o adicional diário é recusado (55000) e o lançamento fica como estava",
    [b0.error?.code, Number(ed1b?.billed_amount), Number(ed1b?.additional_amount)],
    ["55000", 150, 0],
  );

  // LIGA: a individual prevalece sobre a tarifa da função.
  const liga = await cliente.rpc("alterar_resolucao_tarifas", {
    p_ativar: true,
    p_reason: "Ligada no teste S",
  });
  verificar("S6. admin liga a resolução", liga.error?.message ?? "ok", "ok");
  await salvarDia(1, "2026-04-07", fid("conferente"));
  await salvarDia(2, "2026-04-07", fid("conferente"));
  const e17 = await lerEntrada(1, "2026-04-07");
  const e27 = await lerEntrada(2, "2026-04-07");
  verificar(
    "S7. resolução ligada: E1 (individual) = 260,00 e E2 (sem individual, tarifa do conferente) = 160,00, cada um com sua fonte",
    [
      Number(e17?.billed_amount),
      e17?.price_source,
      Boolean(e17?.contract_employee_rate_id) && !e17?.contract_rate_terms_id,
      Number(e27?.billed_amount),
      e27?.price_source,
      Boolean(e27?.contract_rate_terms_id) && !e27?.contract_employee_rate_id,
    ],
    [260, "individual", true, 160, "funcao_periodo", true],
  );
  await salvarDia(1, "2026-04-08", fid("conferente"), "16:00");
  const e18 = await lerEntrada(1, "2026-04-08");
  verificar(
    "S8. HE sobre a diária individual: 260 + 1 h × 48,75 = 308,75 (base da HE = 260)",
    [
      Number(e18?.billed_amount),
      Number(e18?.billed_overtime_amount),
      Number(e18?.daily_rate_snapshot),
    ],
    [308.75, 48.75, 260],
  );

  // Adicional diário: separado da HE, sem duplicação, preservado em recálculo.
  const b1 = await cliente.rpc("definir_bonus_do_apontamento", {
    ...montarBonus({ entryId: e18.id, valor: "30,00", motivo: "Acúmulo de função" }, false),
  });
  const e18b = await lerEntrada(1, "2026-04-08");
  verificar(
    "S9. adicional de R$ 30 separado da HE: 260 + 48,75 + 30 = 338,75; a base da HE continua 260",
    [
      b1.error?.message ?? "ok",
      Number(e18b?.billed_amount),
      Number(e18b?.additional_amount),
      Number(e18b?.billed_overtime_amount),
      Number(e18b?.daily_rate_snapshot),
    ],
    ["ok", 338.75, 30, 48.75, 260],
  );
  const b2 = await cliente.rpc("definir_bonus_do_apontamento", {
    ...montarBonus({ entryId: e18.id, valor: "30,00", motivo: "De novo" }, false),
  });
  verificar(
    "S10. sem duplicação: segundo adicional sem confirmar é recusado (23505)",
    b2.error?.code,
    "23505",
  );
  await salvarDia(1, "2026-04-08", fid("conferente"), "17:00");
  const e18c = await lerEntrada(1, "2026-04-08");
  verificar(
    "S11. salvar de novo o apontamento preserva o adicional e recalcula a HE só sobre a diária: 260 + 97,50 + 30 = 387,50",
    [Number(e18c?.billed_amount), Number(e18c?.additional_amount)],
    [387.5, 30],
  );
  const aud = await cliente
    .from("financial_terms_audit")
    .select("action")
    .eq("action", "apontamento_bonus_definido");
  verificar("S12. o adicional fica na trilha com motivo", aud.error?.message ?? aud.data.length, 1);

  // Fechamento, CSV, XLSX e ledger com adicional presente (abril).
  const filtrosS = { clienteId: C, inicio: "2026-04-01", fim: "2026-04-15" };
  const depsS = dependenciasComSupabase(cliente);
  const fecS = await carregarFechamento(filtrosS, depsS);
  const cS = fecS.consolidado;
  const somaAbril = Math.round(
    Number(
      psql(
        `select coalesce(sum(billed_amount), 0) from public.timesheet_entries where work_date between date '2026-04-01' and date '2026-04-15' and status <> 'absent';`,
      ),
    ) * 100,
  );
  verificar(
    "S13. Fechamento com adicional: faturado = Σ cobrado do banco e diária + HE + especial + adicional = faturado",
    [
      cS.faturadoCentavos,
      cS.diariaCentavos + cS.extraCentavos + cS.especialCentavos + cS.adicionalDiarioCentavos,
      cS.adicionalDiarioCentavos,
    ],
    [somaAbril, somaAbril, 3000],
  );
  const xlsxS = await gerarXlsxDoFechamento(fecS);
  verificar(
    "S14. CSV e XLSX gerados com o adicional presente",
    [
      csvDoFechamento(fecS, "colaborador").split("\r\n").length > 2,
      xlsxS.subarray(0, 2).toString("latin1"),
    ],
    [true, "PK"],
  );

  // Concorrência: o adicional × o faturamento do cliente. Ou o adicional entra ANTES (faturado com
  // ele) ou é recusado DEPOIS (55000); a fatura fecha em qualquer ordem.
  const [corridaB, fatS] = await Promise.all([
    cliente.rpc("definir_bonus_do_apontamento", {
      ...montarBonus(
        { entryId: e18.id, valor: "50,00", motivo: "Corrida com o faturamento" },
        true,
      ),
    }),
    cliente.rpc("gerar_fatura", {
      _client_id: C,
      _period_start: "2026-04-01",
      _period_end: "2026-04-15",
    }),
  ]);
  const e18d = await lerEntrada(1, "2026-04-08");
  const fatura = await cliente
    .from("invoices")
    .select("id, total_amount")
    .eq("id", fatS.data?.id ?? "");
  const itens = await cliente
    .from("invoice_items")
    .select("amount, kind")
    .eq("invoice_id", fatS.data?.id ?? "");
  const soma = (itens.data ?? []).reduce((a, i) => a + Math.round(Number(i.amount) * 100), 0);
  const adicionalDosItens = (itens.data ?? [])
    .filter((i) => i.kind === "adicional_diario")
    .reduce((a, i) => a + Math.round(Number(i.amount) * 100), 0);
  verificar(
    "S15. concorrência adicional × faturamento: fatura gerada, Σ itens = total, e o adicional faturado é o do lançamento (50 se entrou antes, 30 se foi recusado depois)",
    [
      !fatS.error,
      soma === Math.round(Number(fatura.data?.[0]?.total_amount) * 100),
      Boolean(e18d?.invoice_id),
      corridaB.error
        ? corridaB.error.code === "55000" && Number(e18d?.additional_amount) === 30
        : Number(e18d?.additional_amount) === 50,
      adicionalDosItens === Math.round(Number(e18d?.additional_amount) * 100) + 0,
    ],
    [true, true, true, true, true],
  );
  const depois = await cliente.rpc("definir_bonus_do_apontamento", {
    ...montarBonus({ entryId: e18.id, valor: "1,00", motivo: "Depois da fatura" }, true),
  });
  verificar("S16. depois da fatura o adicional é recusado (55000)", depois.error?.code, "55000");
  const desligaS = await cliente.rpc("alterar_resolucao_tarifas", {
    p_ativar: false,
    p_reason: "Desligada no teste S",
  });
  verificar("S17. admin desliga a resolução ao final", desligaS.error?.message ?? "ok", "ok");
}

// ---------------------------------------------------------------------------
// H. Rotas HTTP do Next, com a sessão em cookie
// ---------------------------------------------------------------------------
if (BASE_URL) {
  let cookies = [];
  const ssr = createServerClient(API_URL, ANON_KEY, {
    cookies: {
      getAll: () => cookies,
      setAll: (c) => (cookies = c.map(({ name, value }) => ({ name, value }))),
    },
  });
  await ssr.auth.setSession({
    access_token: sessao.access_token,
    refresh_token: sessao.refresh_token,
  });
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const q = new URLSearchParams({ cliente: C, inicio: filtros.inicio, fim: filtros.fim });
  const get = await fetch(`${BASE_URL}/api/fechamento?${q}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const corpo = await get.json().catch(() => null);
  verificar(
    "H1. GET /api/fechamento = 200 com os mesmos totais",
    [get.status, corpo?.consolidado?.faturadoCentavos],
    [200, somaCobrada],
  );
  const post = await fetch(`${BASE_URL}/api/fechamento/xlsx`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({
      cliente: C,
      inicio: filtros.inicio,
      fim: filtros.fim,
      assinatura: corpo?.meta?.assinatura,
    }),
    redirect: "manual",
  });
  const bytes = Buffer.from(await post.arrayBuffer());
  verificar(
    "H2. POST /api/fechamento/xlsx = 200, XLSX",
    [post.status, bytes.subarray(0, 2).toString("latin1")],
    [200, "PK"],
  );
  for (const pagina of [
    "/fechamento",
    "/faturamento",
    "/relatorios",
    "/dashboard",
    "/apontamentos",
    "/clientes",
    "/colaboradores",
    "/operacoes",
  ]) {
    const resp = await fetch(`${BASE_URL}${pagina}`, { headers: { cookie }, redirect: "manual" });
    const html = await resp.text();
    verificar(
      `H3. página ${pagina} = 200, sem erro do servidor`,
      [resp.status, /Application error|Internal Server Error/.test(html)],
      [200, false],
    );
  }
}

await servico.auth.admin.deleteUser(uid);
console.log(`\n[${cenario}] ${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
