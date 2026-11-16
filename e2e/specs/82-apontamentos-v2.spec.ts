import type { Page, Request } from "@playwright/test";

import { lit } from "../apoio/banco";
import { ambiente, sessaoApi } from "../apoio/contas";
import { consultar, estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirDia,
  alocar,
  campo,
  criarCliente,
  criarColaborador,
  criarContrato,
  criarOperacao,
  criarTurno,
  dialogo,
  escolher,
  esperarAviso,
  linhaDo,
  literal,
} from "../apoio/telas";
import * as apontamentosSalvar from "../../src/lib/apontamentos-salvar";

/**
 * GATE-FIN-06 — o aplicativo nos contratos v2 da migration 054, contra o Supabase LOCAL com a 054.
 *
 * O que se prova, pelas telas e pela API do PostgREST:
 *   - administrador e operador gravam só pelas RPCs v2, com a versão lida do banco;
 *   - outra sessão que gravou antes produz conflito (40001) explícito, o rascunho fica e a decisão de
 *     manter ou descartar é da pessoa, linha a linha; nada é sobrescrito em silêncio;
 *   - repetição idêntica (resposta perdida) é `sem_alteracao`: sem linha nova nem versão nova;
 *   - a virada da meia-noite fora de turno noturno só é concluída com a confirmação do administrador,
 *     registrada no banco (`apontamento_confirmacoes_virada`); o operador não a confirma;
 *   - sem as v2 no banco, a tela falha de forma controlada, sem caminho antigo;
 *   - os valores financeiros são os mesmos da v1 (o banco os deriva; a tela não decide nada).
 *
 * Dados próprios, em outubro de 2027 (nenhum outro arquivo usa): 1ª quinzena para o administrador
 * (faturada no fim do bloco A), 2ª quinzena para o operador. Diária R$ 200 (R$ 25/h; HE R$ 37,50/h)
 * e custo R$ 120 (R$ 15/h).
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} V2`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const OP = `${C} Op`;
const DIA = "Dia V2"; // 08:00–17:00, 60 min
const NOITE = "Noite V2"; // 22:00–07:00, 60 min, vira a meia-noite
const LIA = `${C} Lia`;
const MAX = `${C} Max`;
const ODE = `${C} Ode`;
const NOE = `${C} Noé`;
const EQUIPE_DIA = [LIA, MAX, ODE];

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

// ---------------------------------------------------------------------------------------------
// Leituras e apoio
// ---------------------------------------------------------------------------------------------

type Linha = {
  colaborador: string;
  status: string;
  entrada: string | null;
  saida: string | null;
  notas: string | null;
  versao: number;
  receita: string;
  custo: string;
  id: string;
  faturado: boolean;
};

function linhas(data: string, turno = DIA): Linha[] {
  return consultar<Linha>(`
    select e.name as colaborador, te.status::text as status,
           to_char(te.check_in,'HH24:MI') as entrada, to_char(te.check_out,'HH24:MI') as saida,
           te.notes as notas, te.versao, te.billed_amount::numeric(12,2)::text as receita,
           te.cost_amount::numeric(12,2)::text as custo, te.id, te.invoice_id is not null as faturado
      from public.timesheet_entries te
      join public.employees e on e.id = te.employee_id
      join public.operations o on o.id = te.operation_id
      join public.timesheets t on t.id = te.timesheet_id
      join public.shifts s on s.id = t.shift_id
     where o.name = ${lit(OP)} and te.work_date = ${lit(data)} and s.name = ${lit(turno)}
     order by e.name`);
}

function linhaDe(colaborador: string, data: string, turno = DIA): Linha | undefined {
  return linhas(data, turno).find((l) => l.colaborador === colaborador);
}

function confirmacoes(entryId: string) {
  return consultar<{
    por: string;
    entrada: string;
    saida: string;
    versao: number;
    invalidada: boolean;
    motivo: string | null;
  }>(`
    select u.email as por, to_char(c.check_in,'HH24:MI') as entrada, to_char(c.check_out,'HH24:MI') as saida,
           c.versao_confirmada as versao, c.invalidada_em is not null as invalidada, c.motivo_invalidacao as motivo
      from public.apontamento_confirmacoes_virada c join auth.users u on u.id = c.confirmado_por
     where c.entry_id = ${lit(entryId)} order by c.confirmado_em`);
}

function ids() {
  const [r] = consultar<{ op: string; dia: string; noite: string; cliente: string }>(`
    select o.id as op, (select id from public.shifts where operation_id = o.id and name = ${lit(DIA)}) as dia,
           (select id from public.shifts where operation_id = o.id and name = ${lit(NOITE)}) as noite,
           o.client_id as cliente
      from public.operations o where o.name = ${lit(OP)}`);
  return r!;
}

function colaborador(nome: string): string {
  return consultar<{ id: string }>(`select id from public.employees where name = ${lit(nome)}`)[0]!
    .id;
}

/** Registra as chamadas do navegador ao PostgREST: caminho, método e corpo das RPCs. */
function gravarChamadas(page: Page) {
  const chamadas: { metodo: string; caminho: string; corpo: unknown }[] = [];
  page.on("request", (r: Request) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith("/rest/v1/")) return;
    let corpo: unknown = null;
    try {
      corpo = r.postDataJSON();
    } catch {
      corpo = null;
    }
    chamadas.push({ metodo: r.method(), caminho: url.pathname, corpo });
  });
  return chamadas;
}

const rpcs = (chamadas: { caminho: string }[]) =>
  chamadas
    .filter((c) => c.caminho.startsWith("/rest/v1/rpc/"))
    .map((c) => c.caminho.replace("/rest/v1/rpc/", ""));

/** Nenhuma escrita direta de tabela (o caminho anterior era upsert e INSERT de folha). */
const escritasDiretas = (chamadas: { metodo: string; caminho: string }[]) =>
  chamadas.filter(
    (c) => !c.caminho.startsWith("/rest/v1/rpc/") && !["GET", "HEAD"].includes(c.metodo),
  );

const salvarBotao = (page: Page) => page.getByRole("button", { name: "Salvar", exact: true });

async function preencher(
  page: Page,
  l: { colaborador: string; presenca?: string; entrada?: string; saida?: string },
) {
  const tr = linhaDo(page, l.colaborador);
  await expect(tr).toBeVisible();
  if (l.presenca) await escolher(page, tr.getByRole("combobox").first(), l.presenca);
  if (l.entrada !== undefined) await tr.locator("input[type=time]").nth(0).fill(l.entrada);
  if (l.saida !== undefined) await tr.locator("input[type=time]").nth(1).fill(l.saida);
}

/**
 * Espera o aviso com ESTE texto. `esperarAviso` lê o primeiro aviso da tela, e depois de um
 * conflito o aviso anterior (recusa) ainda está visível quando o sucesso chega.
 */
async function aviso(page: Page, texto: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: texto }).last()).toBeVisible({
    timeout: 30_000,
  });
}

/** Espera a RESPOSTA da RPC deste clique: o banco já gravou quando o teste segue. */
function respostaDa(page: Page, rpc: string) {
  return page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/rest/v1/rpc/${rpc}` && r.request().method() === "POST",
  );
}

async function salvar(page: Page, texto = "Apontamento salvo.") {
  await expect(salvarBotao(page)).toBeEnabled();
  const resposta = respostaDa(page, "salvar_apontamento_admin_v2");
  await salvarBotao(page).click();
  await resposta;
  await aviso(page, texto);
}

async function abrirOperador(page: Page, data: string, turno = DIA) {
  await page.goto("/operacional");
  await escolher(page, campo(page, "Operação"), new RegExp(`^${literal(OP)} — `));
  await escolher(page, campo(page, "Turno"), new RegExp(`^${literal(turno)} — `));
  await campo(page, "Data").fill(data);
  await expect(page.getByText("Carregando apontamento...")).toHaveCount(0);
}

const linhaOp = (page: Page, nome: string) => page.locator("tr").filter({ hasText: nome }).first();
const salvarOpBotao = (page: Page) => page.getByRole("button", { name: "Salvar apontamento" });

/** Salva pela tela do operador e espera a resposta da v2 e o aviso com o texto. */
async function salvarOp(page: Page, texto = "Apontamento salvo.") {
  await expect(salvarOpBotao(page)).toBeEnabled();
  const resposta = respostaDa(page, "salvar_apontamento_operacional_v2");
  await salvarOpBotao(page).click();
  await resposta;
  await aviso(page, texto);
}

async function preencherOp(
  page: Page,
  l: { colaborador: string; presenca?: string; entrada?: string; saida?: string; nota?: string },
) {
  const tr = linhaOp(page, l.colaborador);
  await expect(tr).toBeVisible();
  if (l.presenca) await escolher(page, tr.getByRole("combobox").first(), l.presenca);
  if (l.entrada !== undefined) await tr.locator("input[type=time]").nth(0).fill(l.entrada);
  if (l.saida !== undefined) await tr.locator("input[type=time]").nth(1).fill(l.saida);
  if (l.nota !== undefined) await tr.getByRole("textbox", { name: /Observação/ }).fill(l.nota);
}

/** O administrador atribui a operação ao operador sintético, pela tela (uma vez). */
async function garantirOperacaoDoOperador(page: Page) {
  const [{ atribuida }] = consultar<{ atribuida: boolean }>(
    `select exists (select 1 from public.user_operation_access a
                      join public.operations o on o.id = a.operation_id
                      join auth.users u on u.id = a.user_id
                     where o.name = ${lit(OP)} and u.email = ${lit(ambiente("E2E_OPER_EMAIL"))}) as atribuida`,
  );
  if (!atribuida) {
    await page.goto("/usuarios");
    const linha = page.locator("tr").filter({ hasText: ambiente("E2E_OPER_EMAIL") });
    await linha.getByRole("button").last().click();
    const d = dialogo(page);
    await escolher(page, campo(d, "Atribuir operação"), OP);
    await d.getByRole("button", { name: "Atribuir", exact: true }).click();
    await expect(d.getByText(OP, { exact: true })).toBeVisible({ timeout: 20_000 });
  }
}

// =============================================================================================
// PREPARAÇÃO
// =============================================================================================

test("PR preparação: cliente, contrato 200, operação com turno diurno e noturno, quatro colaboradores", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: 200, inicio: "2027-09-01" });
  for (const nome of [...EQUIPE_DIA, NOE]) {
    await criarColaborador(page, { nome, custo: 120, desde: "2027-09-01" });
  }
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, { operacao: OP, nome: DIA, inicio: "08:00", fim: "17:00", intervalo: 60 });
  await criarTurno(page, {
    operacao: OP,
    nome: NOITE,
    inicio: "22:00",
    fim: "07:00",
    intervalo: 60,
    viraDia: true,
  });
  for (const nome of EQUIPE_DIA)
    await alocar(page, { operacao: OP, colaborador: nome, turno: DIA });
  await alocar(page, { operacao: OP, colaborador: NOE, turno: NOITE });
  await garantirOperacaoDoOperador(page);
});

// =============================================================================================
// A — ADMINISTRADOR
// =============================================================================================

test("A1 inserção pela v2: versão 0 enviada, versão 1 gravada; nenhuma chamada antiga nem escrita direta", async ({
  page,
}) => {
  const data = "2027-10-04";
  const chamadas = gravarChamadas(page);
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, { colaborador: ODE, presenca: "Falta" });
  await salvar(page);
  const enviados = chamadas.filter((c) => c.caminho === "/rest/v1/rpc/salvar_apontamento_admin_v2");
  expect(enviados).toHaveLength(1);
  const corpo = enviados[0]!.corpo as { p_linhas: { versao_esperada: number }[] };
  expect(corpo.p_linhas.map((l) => l.versao_esperada)).toEqual([0, 0, 0]);
  expect(rpcs(chamadas)).not.toContain("salvar_apontamento_admin");
  expect(escritasDiretas(chamadas), "sem upsert nem INSERT direto").toEqual([]);
  expect(linhas(data).map((l) => `${l.colaborador}:${l.status}:${l.versao}`)).toEqual([
    `${LIA}:present:1`,
    `${MAX}:present:1`,
    `${ODE}:absent:1`,
  ]);
});

test("A2 edição: a versão enviada é a lida do banco; valores ao centavo (8 h + 1 h de HE)", async ({
  page,
}) => {
  const data = "2027-10-04";
  const chamadas = gravarChamadas(page);
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, { colaborador: LIA, saida: "18:00" });
  await salvar(page);
  const corpo = chamadas.find((c) => c.caminho === "/rest/v1/rpc/salvar_apontamento_admin_v2")!
    .corpo as { p_linhas: { employee_id: string; versao_esperada: number }[] };
  // Só a linha alterada vai, com a versão 1 que a tela leu.
  expect(corpo.p_linhas.map((l) => l.versao_esperada)).toEqual([1]);
  const l = linhaDe(LIA, data)!;
  // 200 + 60 min × 37,50/60; custo 120 + 60 × 15/60 (cálculo independente, igual à v1).
  expect([l.versao, l.saida, l.receita, l.custo]).toEqual([2, "18:00", "237.50", "135.00"]);
});

test("A3 + A4 outra aba gravou antes: 40001 explícito, nada sobrescrito; o rascunho fica e a decisão é da pessoa", async ({
  page,
  context,
}) => {
  const data = "2027-10-05";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await salvar(page); // cria o dia: os três presentes, versão 1
  const outra = await context.newPage();
  await abrirDia(outra, { operacao: OP, turno: DIA, data });
  // As duas abas leram a versão 1 de Max. A primeira grava saída 18:30 (versão 2).
  await preencher(page, { colaborador: MAX, saida: "18:30" });
  await salvar(page);
  // A segunda, sobre a leitura antiga, marca Max como falta e tenta salvar.
  await preencher(outra, { colaborador: MAX, presenca: "Falta" });
  await salvarBotao(outra).click();
  await expect(
    outra.locator("[data-sonner-toast]").filter({ hasText: /alterado por outra sessão/ }),
  ).toBeVisible({ timeout: 20_000 });
  expect(linhaDe(MAX, data)!.saida, "a gravação da primeira aba ficou").toBe("18:30");
  expect(linhaDe(MAX, data)!.versao).toBe(2);
  // O rascunho continua: Max segue "Falta" na segunda aba, e o conflito é mostrado na linha.
  const painel = outra.getByRole("alert").filter({ hasText: "Conflito de gravação" });
  await expect(painel).toBeVisible();
  await expect(painel).toContainText(MAX);
  await expect(linhaDo(outra, MAX).getByRole("combobox").first()).toContainText("Falta");
  // Sem decisão, não há como salvar (nada de retry automático com a versão nova).
  await expect(salvarBotao(outra)).toBeDisabled();
  // A pessoa decide manter a própria alteração: só então a versão atual (2) vai no envio.
  await painel.getByRole("button", { name: `Manter a minha alteração (${MAX})` }).click();
  await expect(painel).toHaveCount(0);
  await salvar(outra);
  const l = linhaDe(MAX, data)!;
  expect([l.status, l.versao]).toEqual(["absent", 3]);
  await outra.close();
});

test("A4b conflito resolvido por “Usar o que está gravado”: a linha volta ao banco, nada é enviado", async ({
  page,
  context,
}) => {
  const data = "2027-10-05";
  const outra = await context.newPage();
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await abrirDia(outra, { operacao: OP, turno: DIA, data });
  await preencher(page, { colaborador: LIA, saida: "17:45" });
  await salvar(page);
  await preencher(outra, { colaborador: LIA, saida: "16:00" });
  await salvarBotao(outra).click();
  const painel = outra.getByRole("alert").filter({ hasText: "Conflito de gravação" });
  await expect(painel).toBeVisible({ timeout: 20_000 });
  await painel.getByRole("button", { name: `Usar o que está gravado (${LIA})` }).click();
  await expect(painel).toHaveCount(0);
  await expect(linhaDo(outra, LIA).locator("input[type=time]").nth(1)).toHaveValue("17:45");
  expect(linhaDe(LIA, data)!.saida).toBe("17:45");
  await outra.close();
});

test("A5 retry idêntico: outra aba com a MESMA alteração recebe sem_alteracao; pela API, a repetição não sobe a versão", async ({
  page,
  context,
}) => {
  const data = "2027-10-06";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await salvar(page);
  const outra = await context.newPage();
  await abrirDia(outra, { operacao: OP, turno: DIA, data });
  await preencher(page, { colaborador: ODE, saida: "17:30" });
  await salvar(page);
  // A segunda aba (leitura da versão 1) faz exatamente a mesma alteração: não é conflito.
  await preencher(outra, { colaborador: ODE, saida: "17:30" });
  await salvar(outra, "já estava gravad");
  expect(linhaDe(ODE, data)!.versao, "sem versão nova").toBe(2);
  await outra.close();

  // Pela API, com a carga montada pelo mesmo módulo da tela: duas chamadas idênticas.
  const api = await sessaoApi("ADMIN");
  const { op, dia } = ids();
  const carga = apontamentosSalvar.montarCargaDaRpcV2(
    [
      {
        employeeId: colaborador(MAX),
        entryId: linhaDe(MAX, data)!.id,
        status: "present",
        checkIn: "08:00",
        checkOut: "17:15",
        breakMinutes: 60,
        notes: "",
      },
    ],
    () => 1,
  );
  const params = { p_operation_id: op, p_shift_id: dia, p_work_date: data, p_linhas: carga };
  const r1 = await api.rpc("salvar_apontamento_admin_v2", params);
  const r2 = await api.rpc("salvar_apontamento_admin_v2", params);
  expect(r1.error).toBeNull();
  expect(
    r2.error,
    "a repetição com a versão antiga não é conflito: o conteúdo é o gravado",
  ).toBeNull();
  const res = (r: { data: unknown }) =>
    (r.data as { linhas: { resultado: string; versao: number }[] }).linhas[0];
  expect([res(r1), res(r2)]).toEqual([
    { ...res(r1), resultado: "atualizado", versao: 2 },
    { ...res(r2), resultado: "sem_alteracao", versao: 2 },
  ]);
  // Outra alteração com a versão antiga, agora, é conflito: a repetição não mascara concorrência.
  const r3 = await api.rpc("salvar_apontamento_admin_v2", {
    ...params,
    p_linhas: [{ ...carga[0], check_out: "17:20:00" }],
  });
  expect(r3.error?.code).toBe("40001");
  expect(linhas(data)).toHaveLength(3);
  await api.auth.signOut({ scope: "local" });
});

test("A6 resposta perdida depois do COMMIT: aviso de resultado incerto, rascunho mantido; salvar de novo não duplica nem sobe a versão", async ({
  page,
}) => {
  const data = "2027-10-07";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, { colaborador: LIA, saida: "18:00" });
  // O pedido chega ao banco (que grava) e a resposta se perde no caminho.
  await page.route("**/rest/v1/rpc/salvar_apontamento_admin_v2", async (rota) => {
    await rota.fetch();
    await rota.abort("failed");
  });
  await salvarBotao(page).click();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /confirmar se o apontamento foi gravado/ }),
  ).toBeVisible({ timeout: 20_000 });
  await page.unroute("**/rest/v1/rpc/salvar_apontamento_admin_v2");
  expect(linhas(data), "o banco gravou").toHaveLength(3);
  const antes = linhas(data).map((l) => `${l.colaborador}:${l.versao}`);
  await expect(linhaDo(page, LIA).locator("input[type=time]").nth(1)).toHaveValue("18:00");
  // Nova tentativa: a tela já reconciliou com o banco (nada a enviar) ou o banco responde
  // sem_alteracao. Em nenhum caso há linha nova ou versão nova.
  await expect(salvarBotao(page)).toBeEnabled();
  await salvarBotao(page).click();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /Nenhuma alteração para salvar|já estava gravad/ }),
  ).toBeVisible({ timeout: 20_000 });
  expect(linhas(data).map((l) => `${l.colaborador}:${l.versao}`)).toEqual(antes);
  expect(linhaDe(LIA, data)!.saida).toBe("18:00");
});

test("A7 turno noturno: 22:00 → 07:00 grava sem confirmação excepcional e sem registro na trilha", async ({
  page,
}) => {
  const data = "2027-10-04";
  await abrirDia(page, { operacao: OP, turno: NOITE, data });
  await preencher(page, { colaborador: NOE, entrada: "22:00", saida: "07:00" });
  await expect(page.getByText("Confirmo que a jornada atravessou a meia-noite")).toHaveCount(0);
  await salvar(page);
  const l = linhaDe(NOE, data, NOITE)!;
  expect([l.entrada, l.saida, l.receita, l.custo]).toEqual(["22:00", "07:00", "200.00", "120.00"]);
  expect(confirmacoes(l.id)).toEqual([]);
});

test("A8 virada excepcional: a tela mostra a jornada interpretada; só com a confirmação do admin grava, e a confirmação fica no banco", async ({
  page,
}) => {
  const data = "2027-10-08";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  for (const n of [MAX, ODE]) await preencher(page, { colaborador: n, presenca: "Falta" });
  await preencher(page, { colaborador: LIA, entrada: "08:00", saida: "07:50" });
  const tr = linhaDo(page, LIA);
  // A jornada interpretada: até o dia seguinte, 22h50, e o aviso de registro no banco.
  await expect(tr).toContainText("07:50 do dia seguinte");
  await expect(tr).toContainText("22h50");
  await expect(tr).toContainText("registrada no banco");
  await expect(salvarBotao(page)).toBeDisabled();
  expect(linhaDe(LIA, data), "nada gravado sem confirmação").toBeUndefined();
  await tr
    .getByRole("checkbox", { name: /Confirmo que a jornada atravessou a meia-noite/ })
    .check();
  await salvar(page);
  const l = linhaDe(LIA, data)!;
  // 200 + 15 h de HE (890 min → 900) × 37,50; custo 120 + 890 × 15/60.
  expect([l.versao, l.receita, l.custo]).toEqual([1, "762.50", "342.50"]);
  expect(confirmacoes(l.id)).toEqual([
    {
      por: ambiente("E2E_ADMIN_EMAIL"),
      entrada: "08:00",
      saida: "07:50",
      versao: 1,
      invalidada: false,
      motivo: null,
    },
  ]);
  await page.reload();
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await expect(linhaDo(page, LIA)).toContainText("Virada confirmada");
});

test("A9 mudar o horário confirmado invalida a confirmação; outra virada exige nova confirmação", async ({
  page,
}) => {
  const data = "2027-10-08";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  const tr = linhaDo(page, LIA);
  // Outra virada (07:30): a confirmação anterior não vale para ela.
  await preencher(page, { colaborador: LIA, saida: "07:30" });
  await expect(tr.getByRole("checkbox", { name: /Confirmo que a jornada/ })).not.toBeChecked();
  await expect(salvarBotao(page)).toBeDisabled();
  // Corrigido para uma jornada normal: grava sem confirmação; a anterior fica invalidada (não some).
  await preencher(page, { colaborador: LIA, saida: "17:00" });
  await salvar(page);
  const l = linhaDe(LIA, data)!;
  expect([l.saida, l.versao, l.receita]).toEqual(["17:00", 2, "200.00"]);
  expect(confirmacoes(l.id).map((c) => [c.invalidada, c.motivo])).toEqual([
    [true, "horarios_alterados"],
  ]);
});

test("A11 apontamento antigo com virada sem confirmação: a tela mostra a situação e o admin registra a confirmação", async ({
  page,
}) => {
  const data = "2027-10-11";
  // Gravado pelo caminho v1 (cliente antigo, que a 054 mantém): virada no diurno, sem confirmação.
  const api = await sessaoApi("ADMIN");
  const { op, dia } = ids();
  const { error } = await api.rpc("salvar_apontamento_admin", {
    p_operation_id: op,
    p_shift_id: dia,
    p_work_date: data,
    p_linhas: [
      {
        employee_id: colaborador(ODE),
        status: "present",
        check_in: "08:00:00",
        check_out: "07:50:00",
        break_minutes: 60,
        notes: null,
      },
    ],
  });
  expect(error).toBeNull();
  await api.auth.signOut({ scope: "local" });
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  const tr = linhaDo(page, ODE);
  await expect(tr).toContainText("Virada sem confirmação");
  await tr.getByRole("button", { name: "Confirmar virada" }).click();
  await expect(tr).toContainText("registrada no banco");
  await tr.getByRole("button", { name: "Registrar confirmação" }).click();
  await expect(tr).toContainText("Virada confirmada", { timeout: 20_000 });
  const l = linhaDe(ODE, data)!;
  expect(confirmacoes(l.id).map((c) => [c.entrada, c.saida, c.versao, c.invalidada])).toEqual([
    ["08:00", "07:50", l.versao, false],
  ]);
});

test("C1 admin: banco sem a RPC v2 (PGRST202) falha de forma controlada, sem v1, sem upsert e sem folha", async ({
  page,
}) => {
  const data = "2027-10-12";
  const chamadas = gravarChamadas(page);
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await page.route("**/rest/v1/rpc/salvar_apontamento_admin_v2", (rota) =>
    rota.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PGRST202",
        message: "Could not find the function public.salvar_apontamento_admin_v2",
        details: null,
        hint: null,
      }),
    }),
  );
  await salvarBotao(page).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /054/ })).toBeVisible({
    timeout: 20_000,
  });
  await page.unroute("**/rest/v1/rpc/salvar_apontamento_admin_v2");
  expect(rpcs(chamadas)).not.toContain("salvar_apontamento_admin");
  expect(escritasDiretas(chamadas)).toEqual([]);
  expect(linhas(data), "nenhuma folha nem linha criada").toHaveLength(0);
  const [{ folhas }] = consultar<{ folhas: number }>(
    `select count(*)::int as folhas from public.timesheets t join public.operations o on o.id = t.operation_id
      where o.name = ${lit(OP)} and t.work_date = ${lit(data)}`,
  );
  expect(folhas).toBe(0);
});

test("C3 + C4 valores iguais aos da v1: a mesma jornada pela v1 (cliente antigo) e pela tela v2", async ({
  page,
}) => {
  const data = "2027-10-13";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, { colaborador: LIA, saida: "18:00" });
  await preencher(page, { colaborador: ODE, presenca: "Falta" });
  await salvar(page);
  // A v1 continua disponível para o app antigo (expansão compatível da 054).
  const api = await sessaoApi("ADMIN");
  const { op, dia } = ids();
  const { error } = await api.rpc("salvar_apontamento_admin", {
    p_operation_id: op,
    p_shift_id: dia,
    p_work_date: data,
    p_linhas: [
      {
        employee_id: colaborador(ODE),
        status: "present",
        check_in: "08:00:00",
        check_out: "18:00:00",
        break_minutes: 60,
        notes: null,
      },
    ],
  });
  expect(error).toBeNull();
  await api.auth.signOut({ scope: "local" });
  const v2 = linhaDe(LIA, data)!;
  const v1 = linhaDe(ODE, data)!;
  expect([v2.receita, v2.custo]).toEqual(["237.50", "135.00"]);
  expect([v1.receita, v1.custo]).toEqual([v2.receita, v2.custo]);
});

test("A10 folha fechada e lançamento faturado: a tela trava e a v2 recusa pelo banco", async ({
  page,
}) => {
  const fechado = "2027-10-14";
  await abrirDia(page, { operacao: OP, turno: DIA, data: fechado });
  await salvar(page);
  await page.getByRole("button", { name: "Fechar dia" }).click();
  await esperarAviso(page, "Status do apontamento atualizado.");
  await expect(salvarBotao(page)).toBeDisabled();
  const api = await sessaoApi("ADMIN");
  const { op, dia, cliente } = ids();
  const fechada = await api.rpc("salvar_apontamento_admin_v2", {
    p_operation_id: op,
    p_shift_id: dia,
    p_work_date: fechado,
    p_linhas: [
      {
        employee_id: colaborador(LIA),
        status: "absent",
        check_in: null,
        check_out: null,
        break_minutes: 0,
        notes: null,
        versao_esperada: linhaDe(LIA, fechado)!.versao,
      },
    ],
  });
  expect(fechada.error?.code).toBe("55000");
  // Fatura da 1ª quinzena: as linhas dela ficam imutáveis, também pela v2 com a versão certa.
  const fatura = await api.rpc("gerar_fatura", {
    _client_id: cliente,
    _period_start: "2027-10-01",
    _period_end: "2027-10-15",
  });
  expect(fatura.error).toBeNull();
  const lia = linhaDe(LIA, "2027-10-04")!;
  expect(lia.faturado).toBe(true);
  const faturado = await api.rpc("salvar_apontamento_admin_v2", {
    p_operation_id: op,
    p_shift_id: dia,
    p_work_date: "2027-10-04",
    p_linhas: [
      {
        employee_id: colaborador(LIA),
        status: "present",
        check_in: "08:00:00",
        check_out: "19:00:00",
        break_minutes: 60,
        notes: null,
        versao_esperada: lia.versao,
      },
    ],
  });
  expect(faturado.error?.code).toBe("42501");
  expect(linhaDe(LIA, "2027-10-04")!.saida).toBe("18:00");
  await api.auth.signOut({ scope: "local" });
  await abrirDia(page, { operacao: OP, turno: DIA, data: "2027-10-04" });
  await expect(linhaDo(page, LIA)).toContainText("Faturado");
  await expect(linhaDo(page, LIA).locator("input[type=time]").first()).toBeDisabled();
});

// =============================================================================================
// O — OPERADOR
// =============================================================================================

test.describe("operador", () => {
  test.use({ storageState: estadoDe("operacional") });

  test("O1 + O2 + O3 + O10 listagem e gravação v2: versão 0 na inclusão, a lida na edição; nada financeiro chega", async ({
    page,
  }) => {
    const data = "2027-10-18";
    const respostas: { caminho: string; chaves: string[] }[] = [];
    page.on("response", async (r) => {
      const url = new URL(r.url());
      if (!url.pathname.startsWith("/rest/v1/")) return;
      let chaves: string[] = [];
      try {
        const corpo = await r.json();
        const lista = Array.isArray(corpo) ? corpo : [corpo];
        chaves = lista.flatMap((o) =>
          o && typeof o === "object" ? Object.keys(o as Record<string, unknown>) : [],
        );
      } catch {
        chaves = [];
      }
      respostas.push({ caminho: url.pathname, chaves });
    });
    const chamadas = gravarChamadas(page);
    await abrirOperador(page, data);
    for (const n of EQUIPE_DIA)
      await preencherOp(page, { colaborador: n, entrada: "08:00", saida: "17:00" });
    await salvarOp(page, "Apontamento salvo.");
    const primeira = chamadas.find(
      (c) => c.caminho === "/rest/v1/rpc/salvar_apontamento_operacional_v2",
    )!.corpo as { p_linhas: { versao_esperada: number }[] };
    expect(primeira.p_linhas.map((l) => l.versao_esperada)).toEqual([0, 0, 0]);
    expect(linhas(data).map((l) => l.versao)).toEqual([1, 1, 1]);
    // Edição: só Max, com a versão 1 lida pela listagem v2.
    await preencherOp(page, { colaborador: MAX, saida: "17:30" });
    await salvarOp(page, "Apontamento salvo.");
    const segunda = chamadas.filter(
      (c) => c.caminho === "/rest/v1/rpc/salvar_apontamento_operacional_v2",
    )[1]!.corpo as { p_linhas: { versao_esperada: number }[] };
    expect(segunda.p_linhas.map((l) => l.versao_esperada)).toEqual([1]);
    expect(linhaDe(MAX, data)!.versao).toBe(2);
    // Só as v2 do operador; nenhuma v1; nenhuma tabela direta.
    const usadas = new Set(rpcs(chamadas));
    expect(usadas.has("listar_apontamentos_do_operador_v2")).toBe(true);
    expect(usadas.has("listar_apontamentos_do_operador")).toBe(false);
    expect(usadas.has("salvar_apontamento_operacional")).toBe(false);
    for (const c of chamadas) expect(c.caminho).toMatch(/^\/rest\/v1\/rpc\/[a-z0-9_]+$/);
    const listagem = respostas.filter((r) =>
      r.caminho.endsWith("listar_apontamentos_do_operador_v2"),
    );
    expect(listagem.flatMap((r) => r.chaves)).toContain("versao");
    const vistas = new Set(respostas.flatMap((r) => r.chaves));
    for (const chave of CHAVES_PROIBIDAS) expect(vistas.has(chave), `chave ${chave}`).toBe(false);
  });

  test("O4 duas sessões do operador: a segunda recebe conflito; nada sobrescrito; o rascunho fica", async ({
    page,
    context,
  }) => {
    const data = "2027-10-19";
    await abrirOperador(page, data);
    for (const n of EQUIPE_DIA)
      await preencherOp(page, { colaborador: n, entrada: "08:00", saida: "17:00" });
    await salvarOp(page, "Apontamento salvo.");
    const outra = await context.newPage();
    await abrirOperador(outra, data);
    await preencherOp(page, { colaborador: LIA, nota: "primeira sessão" });
    await salvarOp(page, "Apontamento salvo.");
    await preencherOp(outra, { colaborador: LIA, nota: "segunda sessão" });
    await salvarOpBotao(outra).click();
    await expect(
      outra.locator("[data-sonner-toast]").filter({ hasText: /alterado por outra sessão/ }),
    ).toBeVisible({ timeout: 20_000 });
    expect(linhaDe(LIA, data)!.notas).toBe("primeira sessão");
    await expect(linhaOp(outra, LIA).getByRole("textbox", { name: /Observação/ })).toHaveValue(
      "segunda sessão",
    );
    const painel = outra.getByRole("alert").filter({ hasText: "Conflito de gravação" });
    await expect(painel).toContainText(LIA);
    await expect(salvarOpBotao(outra)).toBeDisabled();
    await painel.getByRole("button", { name: `Manter a minha alteração (${LIA})` }).click();
    await salvarOp(outra, "Apontamento salvo.");
    expect(linhaDe(LIA, data)!.notas).toBe("segunda sessão");
    await outra.close();
  });

  test("O5 o administrador alterou primeiro: o operador recebe conflito, sem sobrescrever", async ({
    page,
    browser,
  }) => {
    const data = "2027-10-20";
    await abrirOperador(page, data);
    for (const n of EQUIPE_DIA)
      await preencherOp(page, { colaborador: n, entrada: "08:00", saida: "17:00" });
    await salvarOp(page, "Apontamento salvo.");
    const adm = await browser.newContext({ storageState: estadoDe("admin") });
    const pa = await adm.newPage();
    await abrirDia(pa, { operacao: OP, turno: DIA, data });
    await preencher(pa, { colaborador: MAX, saida: "18:00" });
    await salvar(pa);
    await adm.close();
    await preencherOp(page, { colaborador: MAX, presenca: "Falta" });
    await salvarOpBotao(page).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /alterado por outra sessão/ }),
    ).toBeVisible({ timeout: 20_000 });
    const l = linhaDe(MAX, data)!;
    expect([l.status, l.saida]).toEqual(["present", "18:00"]);
  });

  test("O6 retry idêntico do operador: sem_alteracao, sem versão nova (tela e API)", async ({
    page,
    context,
  }) => {
    const data = "2027-10-21";
    await abrirOperador(page, data);
    for (const n of EQUIPE_DIA)
      await preencherOp(page, { colaborador: n, entrada: "08:00", saida: "17:00" });
    await salvarOp(page, "Apontamento salvo.");
    const outra = await context.newPage();
    await abrirOperador(outra, data);
    await preencherOp(page, { colaborador: ODE, saida: "16:00" });
    await salvarOp(page, "Apontamento salvo.");
    await preencherOp(outra, { colaborador: ODE, saida: "16:00" });
    await salvarOp(outra, "já estava gravad");
    expect(linhaDe(ODE, data)!.versao).toBe(2);
    await outra.close();

    const api = await sessaoApi("OPER");
    const { op, dia } = ids();
    const linhaApi = {
      employee_id: colaborador(LIA),
      status: "present",
      check_in: "08:00",
      check_out: "17:10",
      break_minutes: 60,
      notes: null,
      versao_esperada: 1,
    };
    const params = { p_operation_id: op, p_shift_id: dia, p_work_date: data, p_linhas: [linhaApi] };
    const r1 = await api.rpc("salvar_apontamento_operacional_v2", params);
    const r2 = await api.rpc("salvar_apontamento_operacional_v2", params);
    expect([r1.error, r2.error]).toEqual([null, null]);
    const res = (r: { data: unknown }) =>
      (r.data as { linhas: { resultado: string; versao: number }[] }).linhas[0];
    expect([res(r1)?.resultado, res(r2)?.resultado, res(r2)?.versao]).toEqual([
      "atualizado",
      "sem_alteracao",
      2,
    ]);
    await api.auth.signOut({ scope: "local" });
  });

  test("O7 virada fora do turno: o operador não confirma; a tela explica, preserva o digitado e não envia", async ({
    page,
  }) => {
    const data = "2027-10-22";
    const chamadas = gravarChamadas(page);
    await abrirOperador(page, data);
    for (const n of [MAX, ODE]) await preencherOp(page, { colaborador: n, presenca: "Falta" });
    await preencherOp(page, { colaborador: LIA, entrada: "08:00", saida: "07:50" });
    await expect(page.getByRole("alert").filter({ hasText: "administrador" })).toBeVisible();
    await expect(page.getByText("Confirmo que a jornada atravessou a meia-noite")).toHaveCount(0);
    await expect(salvarOpBotao(page)).toBeDisabled();
    await expect(linhaOp(page, LIA).locator("input[type=time]").nth(1)).toHaveValue("07:50");
    expect(rpcs(chamadas)).not.toContain("salvar_apontamento_operacional_v2");
    expect(linhas(data)).toHaveLength(0);
    // Pela API, a v2 do operador não aceita a chave de confirmação (só o admin confirma).
    const api = await sessaoApi("OPER");
    const { op, dia } = ids();
    const { error } = await api.rpc("salvar_apontamento_operacional_v2", {
      p_operation_id: op,
      p_shift_id: dia,
      p_work_date: data,
      p_linhas: [
        {
          employee_id: colaborador(LIA),
          status: "present",
          check_in: "08:00",
          check_out: "07:50",
          break_minutes: 60,
          notes: null,
          versao_esperada: 0,
          confirmar_virada: true,
        },
      ],
    });
    expect(error?.code).toBe("22023");
    const conf = await api.rpc("confirmar_virada_do_apontamento", {
      p_entry_id: "00000000-0000-4000-8000-000000000000",
      p_versao: 1,
    });
    expect(conf.error?.code, "o operador não confirma virada").toBe("42501");
    expect(linhas(data)).toHaveLength(0);
    await api.auth.signOut({ scope: "local" });
  });

  test("O8 turno noturno válido: o operador grava 22:00 → 07:00 normalmente", async ({ page }) => {
    const data = "2027-10-18";
    await abrirOperador(page, data, NOITE);
    await preencherOp(page, { colaborador: NOE, entrada: "22:00", saida: "07:00" });
    await expect(page.getByRole("alert").filter({ hasText: "administrador" })).toHaveCount(0);
    await salvarOp(page, "Apontamento salvo.");
    const l = linhaDe(NOE, data, NOITE)!;
    expect([l.entrada, l.saida, l.versao]).toEqual(["22:00", "07:00", 1]);
    expect(confirmacoes(l.id)).toEqual([]);
  });

  test("O9 folha fechada e lançamento faturado: a tela trava e a v2 recusa", async ({ page }) => {
    // 14/10 foi fechado pelo administrador (A10); 04/10 está faturado.
    await abrirOperador(page, "2027-10-14");
    await expect(page.getByText("Folha fechada pelo administrador.")).toBeVisible();
    await expect(salvarOpBotao(page)).toBeDisabled();
    await abrirOperador(page, "2027-10-04");
    await expect(linhaOp(page, LIA)).toContainText("Faturado");
    await expect(linhaOp(page, LIA).locator("input[type=time]").first()).toBeDisabled();
    const api = await sessaoApi("OPER");
    const { op, dia } = ids();
    const base = {
      employee_id: colaborador(LIA),
      status: "absent",
      check_in: null,
      check_out: null,
      break_minutes: 0,
      notes: null,
    };
    const fechada = await api.rpc("salvar_apontamento_operacional_v2", {
      p_operation_id: op,
      p_shift_id: dia,
      p_work_date: "2027-10-14",
      p_linhas: [{ ...base, versao_esperada: linhaDe(LIA, "2027-10-14")!.versao }],
    });
    expect(fechada.error?.code).toBe("42501");
    const faturada = await api.rpc("salvar_apontamento_operacional_v2", {
      p_operation_id: op,
      p_shift_id: dia,
      p_work_date: "2027-10-04",
      p_linhas: [{ ...base, versao_esperada: linhaDe(LIA, "2027-10-04")!.versao }],
    });
    expect(faturada.error?.code).toBe("42501");
    await api.auth.signOut({ scope: "local" });
  });

  test("C1 operador: banco sem as v2 (PGRST202): leitura e gravação falham de forma controlada, sem v1", async ({
    page,
  }) => {
    const data = "2027-10-26";
    const chamadas = gravarChamadas(page);
    const ausente = (nome: string) => (rota: { fulfill: (o: object) => Promise<void> }) =>
      rota.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          code: "PGRST202",
          message: `Could not find the function public.${nome}`,
          details: null,
          hint: null,
        }),
      });
    await page.route(
      "**/rest/v1/rpc/listar_apontamentos_do_operador_v2",
      ausente("listar_apontamentos_do_operador_v2"),
    );
    await page.goto("/operacional");
    await escolher(page, campo(page, "Operação"), new RegExp(`^${literal(OP)} — `));
    await escolher(page, campo(page, "Turno"), new RegExp(`^${literal(DIA)} — `));
    await campo(page, "Data").fill(data);
    await expect(page.getByText(/054/).first()).toBeVisible({ timeout: 20_000 });
    await page.unroute("**/rest/v1/rpc/listar_apontamentos_do_operador_v2");
    await page.route(
      "**/rest/v1/rpc/salvar_apontamento_operacional_v2",
      ausente("salvar_apontamento_operacional_v2"),
    );
    await page.reload();
    await abrirOperador(page, data);
    await preencherOp(page, { colaborador: LIA, entrada: "08:00", saida: "17:00" });
    await salvarOpBotao(page).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /054/ })).toBeVisible({
      timeout: 20_000,
    });
    await page.unroute("**/rest/v1/rpc/salvar_apontamento_operacional_v2");
    const usadas = rpcs(chamadas);
    expect(usadas).not.toContain("listar_apontamentos_do_operador");
    expect(usadas).not.toContain("salvar_apontamento_operacional");
    expect(linhas(data)).toHaveLength(0);
  });

  test("C4 operador: a v1 continua disponível para o app antigo durante a expansão", async () => {
    const data = "2027-10-27";
    const api = await sessaoApi("OPER");
    const { op, dia } = ids();
    const { data: folha, error } = await api.rpc("salvar_apontamento_operacional", {
      p_operation_id: op,
      p_shift_id: dia,
      p_work_date: data,
      p_linhas: [
        {
          employee_id: colaborador(MAX),
          status: "present",
          check_in: "08:00",
          check_out: "17:00",
          break_minutes: 60,
          notes: null,
        },
      ],
    });
    expect(error).toBeNull();
    expect(typeof folha).toBe("string");
    const { data: lidas, error: e2 } = await api.rpc("listar_apontamentos_do_operador", {
      p_operation_id: op,
      p_shift_id: dia,
      p_work_date: data,
    });
    expect(e2).toBeNull();
    expect((lidas as unknown[]).length).toBe(1);
    const l = linhaDe(MAX, data)!;
    expect([l.versao, l.receita, l.custo]).toEqual([1, "200.00", "120.00"]);
    await api.auth.signOut({ scope: "local" });
  });
});
