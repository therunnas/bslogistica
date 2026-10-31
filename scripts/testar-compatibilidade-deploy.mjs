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
import { carregarFechamento, dependenciasComSupabase } from "../src/lib/fechamento/carregar.ts";
import { verificarDisponibilidade } from "../src/lib/fechamento/disponibilidade.ts";
import { csvDoFechamento } from "../src/lib/fechamento/exportacao.ts";
import { gerarXlsxDoFechamento } from "../src/lib/fechamento/xlsx.ts";
import { lerTabelaPaginada } from "../src/lib/paginacao.ts";
import { montarLinhas } from "../src/lib/ledger-estado.ts";
import { lerResumoFinanceiro } from "../src/lib/resumo-financeiro.ts";
import { LEITURAS } from "../src/lib/queries.ts";
import { interpretarPeriodoContratual, montarRegistro } from "../src/lib/vigencias-ui.ts";

const cenario = process.argv[2] ?? "?";
const esperaComponentes = process.argv[3] === "com-componentes";
const esperaPeriodo = process.argv[4] === "com-periodo";
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
  verificar(
    "P8. 038: competência de cobrança lida pela sessão do admin",
    competencia.error?.message ?? competencia.data,
    [{ frequencia: "quinzenal", inicio: "2026-03-16", fim: "2026-03-31" }],
  );
}

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
