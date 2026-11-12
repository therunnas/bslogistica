import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser, Page, Response } from "@playwright/test";

import { faturasDoCliente, lancamento } from "../apoio/banco";
import { estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirFaturamento,
  alocar,
  campo,
  criarCliente,
  criarColaborador,
  criarOperacao,
  criarTurno,
  dialogo,
  emitirFatura,
  escolher,
  esperarAviso,
  literal,
  reais,
} from "../apoio/telas";

/**
 * Segurança com contas sintéticas LOCAIS e permissões normais (nada de superusuário fingindo
 * sessão): o operacional só enxerga o que a RPC devolve, sem valor financeiro; a tabela direta
 * devolve zero linha; a escrita recusa chave extra; o faturado trava; o admin não usa a porta do
 * operador. Dados próprios (cliente "Seg"), independentes do ciclo completo.
 */

test.describe.configure({ mode: "serial" });

const CLI = `${P} Seg`;
const OP = `${P} Op Seg`;
const TURNO = "Turno Seg";
const GIL = `${P} Gil`;
const DATA = "2026-10-13";

/** Chaves que nunca podem chegar ao operador (CLAUDE.md, superfície operacional). */
const CHAVES_PROIBIDAS = [
  "billed_amount",
  "cost_amount",
  "invoice_id",
  "daily_cost",
  "daily_rate",
  "shift_hours",
  "ot_factor",
  "ot_tolerance_min",
  "agreed_amount",
  "daily_cost_snapshot",
  "daily_rate_snapshot",
  "ot_hour_rate_snapshot",
];

function chavesDe(valor: unknown, saida = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) for (const v of valor) chavesDe(v, saida);
  else if (valor && typeof valor === "object")
    for (const [k, v] of Object.entries(valor)) {
      saida.add(k);
      chavesDe(v, saida);
    }
  return saida;
}

function ambiente(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`${nome} ausente: rode pelo scripts/e2e-local.sh`);
  return v;
}

/** Cliente supabase-js com a chave PUBLICÁVEL local, logado com a senha da conta sintética. */
async function sessaoApi(papel: "admin" | "operacional"): Promise<SupabaseClient> {
  const url = ambiente("NEXT_PUBLIC_SUPABASE_URL");
  expect(url).toBe("http://127.0.0.1:54321");
  const cliente = createClient(url, ambiente("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await cliente.auth.signInWithPassword({
    email: ambiente(papel === "admin" ? "E2E_ADMIN_EMAIL" : "E2E_OPER_EMAIL"),
    password: ambiente(papel === "admin" ? "E2E_ADMIN_SENHA" : "E2E_OPER_SENHA"),
  });
  expect(error, "login pela API local").toBeNull();
  return cliente;
}

async function paginaDo(browser: Browser, papel: "admin" | "operacional"): Promise<Page> {
  const contexto = await browser.newContext({ storageState: estadoDe(papel) });
  await contexto.route("**/*", (rota) => {
    const host = new URL(rota.request().url()).hostname;
    return ["127.0.0.1", "localhost"].includes(host) ? rota.continue() : rota.abort();
  });
  return contexto.newPage();
}

test("preparação pelo admin: cliente, operação, turno, equipe e atribuição ao operador", async ({
  browser,
}) => {
  const page = await paginaDo(browser, "admin");
  await criarCliente(page, CLI);
  await criarColaborador(page, { nome: GIL, custo: 150, desde: "2026-10-01" });
  // Avulsa com data do serviço: o valor próprio vale a partir dessa data. (Uma fixa sem contrato
  // tem valor a partir de HOJE e recusaria, corretamente, um dia de outubro.)
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Avulsa", valor: 220, data: DATA });
  await criarTurno(page, {
    operacao: OP,
    nome: TURNO,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: OP, colaborador: GIL, turno: TURNO });

  await page.goto("/usuarios");
  const linha = page.locator("tr").filter({ hasText: ambiente("E2E_OPER_EMAIL") });
  await linha.getByRole("button").last().click();
  const d = dialogo(page);
  await escolher(page, campo(d, "Atribuir operação"), OP);
  await d.getByRole("button", { name: "Atribuir", exact: true }).click();
  await expect(d.getByText(OP, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.context().close();
});

test("operacional: a tela usa só as RPCs e nenhuma resposta traz valor financeiro", async ({
  browser,
}) => {
  const page = await paginaDo(browser, "operacional");
  const respostas: Array<{ caminho: string; chaves: string[] }> = [];
  const pendentes: Promise<void>[] = [];
  page.on("response", (r: Response) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/rest/v1/")) return;
    pendentes.push(
      r
        .json()
        .then((corpo: unknown) => {
          respostas.push({ caminho: u.pathname, chaves: [...chavesDe(corpo)] });
        })
        .catch(() => {
          respostas.push({ caminho: u.pathname, chaves: [] });
        }),
    );
  });

  await page.goto("/operacional");
  await escolher(page, campo(page, "Operação"), new RegExp(`^${literal(OP)} — ${literal(CLI)}$`));
  await escolher(page, campo(page, "Turno"), new RegExp(`^${literal(TURNO)} — 08:00 às 17:00`));
  await campo(page, "Data").fill(DATA);
  const linhaDoGil = page.locator("tr").filter({ hasText: GIL }).first();
  await expect(linhaDoGil).toBeVisible();
  // Na tela do operador os horários começam vazios: ele informa entrada e saída.
  await linhaDoGil.locator("input[type=time]").nth(0).fill("08:00");
  await linhaDoGil.locator("input[type=time]").nth(1).fill("17:00");
  await page.getByRole("button", { name: "Salvar apontamento" }).click();
  await esperarAviso(page, "Apontamento salvo.");
  await Promise.all(pendentes);

  expect(respostas.length).toBeGreaterThan(0);
  // Nenhuma leitura direta de tabela pelo navegador do operador: só /rest/v1/rpc/<função>.
  for (const r of respostas) expect(r.caminho).toMatch(/^\/rest\/v1\/rpc\/[a-z0-9_]+$/);
  // As cinco RPCs do contrato do operador foram as usadas para a tela de apontamento.
  const usadas = new Set(respostas.map((r) => r.caminho.replace("/rest/v1/rpc/", "")));
  for (const rpc of [
    "listar_operacoes_do_operador",
    "listar_turnos_do_operador",
    "listar_equipe_do_operador",
    "listar_apontamentos_do_operador",
    "salvar_apontamento_operacional",
  ])
    expect(usadas.has(rpc), `RPC ${rpc}`).toBe(true);
  await test.info().attach("rpcs-do-operador.txt", {
    body: [...usadas].sort().join("\n"),
    contentType: "text/plain",
  });
  const vistas = new Set(respostas.flatMap((r) => r.chaves));
  for (const chave of CHAVES_PROIBIDAS) expect(vistas.has(chave), `chave ${chave}`).toBe(false);

  // O valor foi derivado pelo banco (trigger), não pela tela do operador.
  const l = lancamento(OP, GIL, DATA);
  expect(l?.receita).toBe("220.00");
  expect(l?.custo).toBe("150.00");
  await page.context().close();
});

test("operacional pela API: tabela direta devolve zero linha; RPC sem valor financeiro", async () => {
  const api = await sessaoApi("operacional");
  for (const tabela of [
    "timesheet_entries",
    "timesheets",
    "employees",
    "clients",
    "operations",
    "invoices",
    "contracts",
  ]) {
    const { data, error } = await api.from(tabela).select("*").limit(5);
    expect(error === null ? (data ?? []).length : 0, `select direto em ${tabela}`).toBe(0);
  }
  const { data: ops, error } = await api.rpc("listar_operacoes_do_operador");
  expect(error).toBeNull();
  expect(Array.isArray(ops) && ops.length).toBeTruthy();
  const chaves = chavesDe(ops);
  for (const chave of CHAVES_PROIBIDAS) expect(chaves.has(chave), `chave ${chave}`).toBe(false);
  expect(chaves.has("cliente_nome")).toBe(true);
  // "local": encerra só esta sessão da API. O padrão (global) derrubaria também a sessão do
  // navegador desta conta, usada pelos outros testes.
  await api.auth.signOut({ scope: "local" });
});

test("operacional pela API: chave extra na escrita recusa a chamada inteira (22023)", async () => {
  const api = await sessaoApi("operacional");
  const { data: ops } = await api.rpc("listar_operacoes_do_operador");
  const operationId = (ops as Array<{ id: string; name: string }>).find((o) => o.name === OP)?.id;
  expect(operationId).toBeTruthy();
  const { data: turnos } = await api.rpc("listar_turnos_do_operador", {
    p_operation_id: operationId,
  });
  const shiftId = (turnos as Array<{ id: string }>)[0]?.id;
  const { data: equipe } = await api.rpc("listar_equipe_do_operador", {
    p_operation_id: operationId,
    p_shift_id: shiftId,
  });
  const employeeId = (equipe as Array<{ employee_id: string }>)[0]?.employee_id;
  const { error } = await api.rpc("salvar_apontamento_operacional", {
    p_operation_id: operationId,
    p_shift_id: shiftId,
    p_work_date: "2026-10-14",
    p_linhas: [
      {
        employee_id: employeeId,
        status: "present",
        check_in: null,
        check_out: null,
        break_minutes: null,
        notes: null,
        billed_amount: 1,
      },
    ],
  });
  expect(error?.code).toBe("22023");
  expect(lancamento(OP, GIL, "2026-10-14")).toBeUndefined();
  // "local": encerra só esta sessão da API. O padrão (global) derrubaria também a sessão do
  // navegador desta conta, usada pelos outros testes.
  await api.auth.signOut({ scope: "local" });
});

test("admin não usa a porta do operador (a RPC exige o papel operacional)", async () => {
  const api = await sessaoApi("admin");
  const { data, error } = await api.rpc("listar_operacoes_do_operador");
  expect(error !== null || (Array.isArray(data) && data.length === 0)).toBe(true);
  // "local": encerra só esta sessão da API. O padrão (global) derrubaria também a sessão do
  // navegador desta conta, usada pelos outros testes.
  await api.auth.signOut({ scope: "local" });
});

test("depois da fatura, o operador vê a linha travada como faturada", async ({ browser }) => {
  const admin = await paginaDo(browser, "admin");
  await abrirFaturamento(admin, { cliente: CLI, inicio: "2026-10-01", fim: "2026-10-15" });
  await emitirFatura(admin, reais(220));
  expect(faturasDoCliente(CLI)[0]?.total).toBe("220.00");
  await admin.context().close();

  const page = await paginaDo(browser, "operacional");
  await page.goto("/operacional");
  await escolher(page, campo(page, "Operação"), new RegExp(`^${literal(OP)} — `));
  await escolher(page, campo(page, "Turno"), new RegExp(`^${literal(TURNO)} — `));
  await campo(page, "Data").fill(DATA);
  const tr = page.locator("tr").filter({ hasText: GIL });
  await expect(tr.getByText("Faturado")).toBeVisible();
  await expect(tr.locator("input[type=time]").first()).toBeDisabled();
  await page.context().close();
});

test("sem sessão: o painel manda para o login e a API não entrega dado", async ({ browser }) => {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);
  await contexto.close();

  const anonimo = createClient(
    ambiente("NEXT_PUBLIC_SUPABASE_URL"),
    ambiente("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await anonimo.from("clients").select("*").limit(5);
  expect(error === null ? (data ?? []).length : 0).toBe(0);
});
