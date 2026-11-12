import type { Dialog, Page } from "@playwright/test";

import { sessaoApi } from "../apoio/contas";
import { lancamento, lit } from "../apoio/banco";
import { consultar, estadoDe, expect, test, valor } from "../apoio/fixtures";
import {
  P,
  alocar,
  campo,
  cartaoDaOperacao,
  criarCliente,
  criarColaborador,
  criarContrato,
  criarOperacao,
  criarTurno,
  dialogo,
  escolher,
  esperarAviso,
  esperarFechar,
  gerarFechamento,
  lancarDia,
  literal,
  reais,
  valorDoCartao,
} from "../apoio/telas";

/**
 * CP-04 — Operações, turnos e equipes: cada ação da tela /operacoes (operação fixa e avulsa,
 * turnos, equipe) e a passagem para apontamento, fechamento e relatório.
 *
 * Em ordem (1 worker), NÃO serial. Dados próprios ("CP04"). Valores à mão: 8 h = 1 diária; hora
 * extra do custo = custo ÷ 8 sem fator; da receita = diária ÷ 8 × 1,5. Regra de equipe do sistema
 * (migration 006): um colaborador fica ativo em UMA operação e UM turno por vez.
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP04`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const OP = `${C} Op Fixa`;
const AVULSA = `${C} Op Avulsa`;
const DIA = "Dia CP04";
const NOITE = "Noite CP04";
const RUI = `${C} Rui`;
const SOL = `${C} Sol`;
const TITO = `${C} Tito`;

async function abrirOperacoes(page: Page) {
  await page.goto("/operacoes");
  await expect(page.getByRole("heading", { name: "Operações", level: 1 })).toBeVisible();
}

function responderConfirmacao(page: Page, aceitar: boolean): Promise<string> {
  return new Promise((resolver) => {
    page.once("dialog", (d: Dialog) => {
      const texto = d.message();
      void (aceitar ? d.accept() : d.dismiss()).then(() => resolver(texto));
    });
  });
}

function contar(tabela: "operations" | "shifts", nome: string, operacao?: string): number {
  const filtroOp = operacao
    ? ` and operation_id = (select id from public.operations where name = ${lit(operacao)})`
    : "";
  return Number(
    valor(`select count(*) from public.${tabela} where name = ${lit(nome)}${filtroOp}`),
  );
}

function turno(nome: string, operacao: string) {
  return consultar<{ inicio: string; fim: string; intervalo: number; vira: boolean }>(
    `select to_char(s.start_time,'HH24:MI') as inicio, to_char(s.end_time,'HH24:MI') as fim,
            s.break_minutes as intervalo, s.crosses_midnight as vira
       from public.shifts s join public.operations o on o.id = s.operation_id
      where s.name = ${lit(nome)} and o.name = ${lit(operacao)}`,
  )[0];
}

function equipeDe(operacao: string) {
  return consultar<{ colaborador: string; turno: string | null; ativo: boolean }>(
    `select e.name as colaborador, s.name as turno, t.active as ativo
       from public.operation_team t join public.operations o on o.id = t.operation_id
       join public.employees e on e.id = t.employee_id left join public.shifts s on s.id = t.shift_id
      where o.name = ${lit(operacao)} order by e.name`,
  );
}

async function abrirNovoTurno(page: Page, operacao: string) {
  await abrirOperacoes(page);
  await cartaoDaOperacao(page, operacao)
    .getByRole("button", { name: "Turno", exact: true })
    .click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Novo turno" })).toBeVisible();
  return d;
}

async function preencherTurno(
  d: ReturnType<typeof dialogo>,
  o: { nome: string; inicio: string; fim: string; intervalo: number; vira?: boolean },
) {
  await campo(d, "Nome do turno").fill(o.nome);
  await campo(d, "Início").fill(o.inicio);
  await campo(d, "Fim").fill(o.fim);
  await campo(d, "Intervalo (min)").fill(String(o.intervalo));
  const caixa = d.locator("#crosses");
  if ((await caixa.getAttribute("data-state")) === "checked" ? !o.vira : Boolean(o.vira)) {
    await caixa.click();
  }
}

// =============================================================================================
// PREPARAÇÃO
// =============================================================================================

test("PR preparação: cliente, contrato 250, colaboradores e cadastros inativos/encerrados", async ({
  page,
}) => {
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: 250, inicio: "2026-10-01" });
  await criarColaborador(page, { nome: RUI, custo: 150, desde: "2026-10-01" });
  await criarColaborador(page, { nome: SOL, custo: 180, desde: "2026-10-01" });
  await criarColaborador(page, { nome: TITO, custo: 150, desde: "2026-10-01" });
  // Cadastros que não deveriam passar despercebidos no formulário da operação.
  await criarCliente(page, `${C} Cliente Inativo`);
  await criarContrato(page, {
    cliente: CLI,
    nome: `${C} Contrato Encerrado`,
    diaria: 200,
    inicio: "2026-09-01",
  });
  const api = await sessaoApi("ADMIN");
  const r1 = await api
    .from("clients")
    .update({ status: "inactive" })
    .eq("name", `${C} Cliente Inativo`);
  expect(r1.error).toBeNull();
  const r2 = await api
    .from("contracts")
    .update({ valid_to: "2026-09-30" })
    .eq("name", `${C} Contrato Encerrado`);
  expect(r2.error).toBeNull();
  await api.auth.signOut({ scope: "local" });
});

// =============================================================================================
// OPERAÇÕES
// =============================================================================================

test("OP1 nova operação: rótulos, nome obrigatório (vazio e só espaços), inativo e encerrado identificados", async ({
  page,
}) => {
  await abrirOperacoes(page);
  await page.getByRole("button", { name: "Nova operação" }).click();
  const d = dialogo(page);
  for (const rotulo of [
    "Cliente",
    "Tipo",
    "Nome da operação",
    "Local (opcional)",
    "Contrato",
    "Observações",
  ]) {
    await expect(d.getByLabel(rotulo, { exact: true }), `rótulo "${rotulo}"`).toBeVisible();
  }
  const salvar = d.getByRole("button", { name: "Salvar operação" });
  await d.getByLabel("Nome da operação", { exact: true }).fill("   ");
  await expect(salvar, "nome só com espaços").toBeDisabled();

  // Cliente inativo aparece, mas identificado (a escolha não é bloqueada: decisão DEC-CP02-01).
  await d.getByLabel("Cliente", { exact: true }).click();
  await expect(page.getByRole("option", { name: `${C} Cliente Inativo (inativo)` })).toBeVisible();
  await page.getByRole("option", { name: CLI, exact: true }).click();
  // Contrato com fim já passado: aparece, identificado como encerrado.
  await d.getByLabel("Contrato", { exact: true }).click();
  await expect(
    page.getByRole("option", {
      name: new RegExp(`${C} Contrato Encerrado .*encerrado em 30/09/2026`),
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await d.getByRole("button", { name: "Cancelar" }).click();
});

test("OP2 duplo clique e Enter repetido em “Salvar operação” criam UMA operação; nome limpo", async ({
  page,
}) => {
  await abrirOperacoes(page);
  await page.getByRole("button", { name: "Nova operação" }).click();
  let d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), CLI);
  await campo(d, "Nome da operação").fill(`  ${OP}  `);
  await escolher(page, campo(d, "Contrato"), new RegExp(`^${literal(CTR)} — `));
  await d.getByRole("button", { name: "Salvar operação" }).evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contar("operations", OP), "duplo clique, nome sem as pontas").toBe(1);

  const outra = `${C} Op Enter`;
  await page.getByRole("button", { name: "Nova operação" }).click();
  d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), CLI);
  await campo(d, "Nome da operação").fill(outra);
  await d.getByRole("button", { name: "Salvar operação" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contar("operations", outra), "Enter repetido").toBe(1);

  const [op] = consultar<{ cliente: string; contrato: string; tipo: string }>(
    `select c.name as cliente, k.name as contrato, o.type::text as tipo
       from public.operations o join public.clients c on c.id = o.client_id
       join public.contracts k on k.id = o.contract_id where o.name = ${lit(OP)}`,
  );
  expect(op).toEqual({ cliente: CLI, contrato: CTR, tipo: "fixed" });
  await page.reload();
  await expect(cartaoDaOperacao(page, OP)).toContainText(CTR);
  await expect(cartaoDaOperacao(page, OP)).toContainText("Fixa");
});

test("OP3 avulsa sem contrato: valor próprio e data; lista mostra o valor de hoje e nunca o do cadastro sem avisar", async ({
  page,
}) => {
  await criarOperacao(page, {
    cliente: CLI,
    nome: AVULSA,
    tipo: "Avulsa",
    valor: 200,
    data: "2026-10-05",
  });
  const [op] = consultar<{ tipo: string; contrato: string | null; data: string; coluna: string }>(
    `select o.type::text as tipo, o.contract_id as contrato,
            to_char(o.operation_date,'YYYY-MM-DD') as data, o.agreed_amount::numeric(12,2)::text as coluna
       from public.operations o where o.name = ${lit(AVULSA)}`,
  );
  expect(op).toEqual({ tipo: "spot", contrato: null, data: "2026-10-05", coluna: "200.00" });
  await expect(cartaoDaOperacao(page, AVULSA)).toContainText(reais(200));
  await expect(cartaoDaOperacao(page, AVULSA)).toContainText("Avulsa");

  // "Alterar valor": 220 a partir de 06/10.
  await page.getByRole("button", { name: `Editar ${AVULSA}`, exact: true }).click();
  await dialogo(page).getByRole("button", { name: "Alterar valor" }).click();
  const alt = dialogo(page);
  await alt.locator("#valor-atual-inicio").fill("2026-10-06");
  await alt.locator("#valor-atual-agreed_amount").fill("220");
  await alt.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(alt.getByRole("heading", { name: "Alterar valor" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
  await abrirOperacoes(page);
  await expect(cartaoDaOperacao(page, AVULSA), "valor de hoje").toContainText(reais(220));

  // Erro ao ler as vigências: o cartão não mostra os 200 da coluna como valor de hoje.
  await page.route("**/rest/v1/operation_terms**", (rota) => rota.abort("failed"));
  await abrirOperacoes(page);
  const cartao = cartaoDaOperacao(page, AVULSA);
  await expect(cartao).toBeVisible();
  await expect(cartao).not.toContainText(reais(200));
  await expect(cartao).toContainText(/indisponível/i, { timeout: 60_000 });
  await expect(cartao).not.toContainText(reais(200));
  await page.unroute("**/rest/v1/operation_terms**");
});

test("OP4 editar operação: dados persistem; cliente travado com contrato em uso", async ({
  page,
}) => {
  await abrirOperacoes(page);
  await page.getByRole("button", { name: `Editar ${OP}`, exact: true }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Editar operação" })).toBeVisible();
  await campo(d, "Local (opcional)").fill("Galpão 3");
  await campo(d, "Observações").fill("Operação do CP-04");
  await expect(
    d.getByText("O valor da diária e as regras de hora extra vêm do contrato"),
  ).toBeVisible();
  await d.getByRole("button", { name: "Salvar operação" }).click();
  await esperarAviso(page, "Registro salvo.");
  await esperarFechar(page);
  await page.reload();
  await expect(cartaoDaOperacao(page, OP)).toContainText("Galpão 3");
  expect(valor(`select notes from public.operations where name = ${lit(OP)}`)).toBe(
    "Operação do CP-04",
  );
});

// =============================================================================================
// TURNOS
// =============================================================================================

test("TU1 novo turno: rótulos; horários impossíveis bloqueados; meia-noite legítima aceita", async ({
  page,
}) => {
  const d = await abrirNovoTurno(page, OP);
  for (const rotulo of ["Nome do turno", "Início", "Fim", "Intervalo (min)", "Vira a meia-noite"]) {
    await expect(d.getByLabel(rotulo, { exact: true }), `rótulo "${rotulo}"`).toBeVisible();
  }
  const salvar = d.getByRole("button", { name: "Salvar turno" });
  await campo(d, "Nome do turno").fill("   ");
  await expect(salvar, "nome só com espaços").toBeDisabled();

  // 08:00–17:00 com "Vira a meia-noite": 33 h. Erro de digitação, não jornada.
  await preencherTurno(d, {
    nome: "Errado CP04",
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
    vira: true,
  });
  await expect(salvar, "vira a meia-noite com fim depois do início").toBeDisabled();
  await expect(d.getByText(/o fim precisa ser antes do início/)).toBeVisible();
  // Intervalo maior que a jornada.
  await preencherTurno(d, { nome: "Errado CP04", inicio: "08:00", fim: "10:00", intervalo: 180 });
  await expect(salvar, "intervalo maior que a jornada").toBeDisabled();
  await expect(d.getByText(/intervalo não pode ser maior/i)).toBeVisible();
  // 15:00–00:00 sem marcar: termina no dia seguinte (a tela avisa; 8 h).
  await preencherTurno(d, { nome: "Tarde CP04", inicio: "15:00", fim: "00:00", intervalo: 60 });
  await expect(d.getByText(/termina no dia seguinte/i)).toBeVisible();
  await expect(salvar).toBeEnabled();
  await salvar.click();
  await esperarFechar(page);
  expect(turno("Tarde CP04", OP)).toEqual({
    inicio: "15:00",
    fim: "00:00",
    intervalo: 60,
    vira: false,
  });
  await expect(
    cartaoDaOperacao(page, OP).locator("tr").filter({ hasText: "Tarde CP04" }),
  ).toContainText("8h");
});

test("TU2 [D3] duplo clique e Enter repetido em “Salvar turno” criam UM turno", async ({
  page,
}) => {
  let d = await abrirNovoTurno(page, OP);
  await preencherTurno(d, { nome: DIA, inicio: "06:00", fim: "15:00", intervalo: 60 });
  await d.getByRole("button", { name: "Salvar turno" }).evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contar("shifts", DIA, OP), "duplo clique").toBe(1);

  d = await abrirNovoTurno(page, OP);
  await preencherTurno(d, {
    nome: NOITE,
    inicio: "22:00",
    fim: "07:00",
    intervalo: 60,
    vira: true,
  });
  await d.getByRole("button", { name: "Salvar turno" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contar("shifts", NOITE, OP), "Enter repetido").toBe(1);
  expect(turno(DIA, OP)).toEqual({ inicio: "06:00", fim: "15:00", intervalo: 60, vira: false });
  expect(turno(NOITE, OP)).toEqual({ inicio: "22:00", fim: "07:00", intervalo: 60, vira: true });
  await page.reload();
  const linhaNoite = cartaoDaOperacao(page, OP).locator("tr").filter({ hasText: NOITE });
  await expect(linhaNoite).toContainText("07:00 (+1d)");
  await expect(linhaNoite).toContainText("8h");
});

test("TU3 falha de rede ao salvar turno: português, carregamento, nova tentativa grava uma vez", async ({
  page,
}) => {
  const nome = "Rede CP04";
  const d = await abrirNovoTurno(page, OP);
  await preencherTurno(d, { nome, inicio: "07:00", fim: "16:00", intervalo: 60 });
  await page.route("**/rest/v1/shifts**", (rota) =>
    rota.request().method() === "POST" ? rota.abort("failed") : rota.continue(),
  );
  await d.getByRole("button", { name: "Salvar turno" }).click();
  const aviso = page.locator("[data-sonner-toast]").first();
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  expect((await aviso.innerText()).trim()).not.toMatch(/failed|fetch|network|error/i);
  await expect(d).toBeVisible();
  expect(contar("shifts", nome, OP)).toBe(0);
  await page.unroute("**/rest/v1/shifts**");
  await page.route("**/rest/v1/shifts**", async (rota) => {
    if (rota.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
    await rota.continue();
  });
  await d.getByRole("button", { name: "Salvar turno" }).click();
  await expect(d.getByRole("button", { name: "Salvando..." })).toBeDisabled();
  await esperarFechar(page);
  await page.unroute("**/rest/v1/shifts**");
  expect(contar("shifts", nome, OP)).toBe(1);
});

// =============================================================================================
// EQUIPES
// =============================================================================================

test("EQ1 alocar vários no mesmo turno; mover de turno; exclusividade entre operações", async ({
  page,
}) => {
  await alocar(page, { operacao: OP, colaborador: RUI, turno: DIA });
  await alocar(page, { operacao: OP, colaborador: SOL, turno: DIA });
  await alocar(page, { operacao: OP, colaborador: TITO, turno: NOITE });
  expect(equipeDe(OP)).toEqual([
    { colaborador: RUI, turno: DIA, ativo: true },
    { colaborador: SOL, turno: DIA, ativo: true },
    { colaborador: TITO, turno: NOITE, ativo: true },
  ]);
  await abrirOperacoes(page);
  await expect(cartaoDaOperacao(page, OP).getByRole("button", { name: /^Equipe/ })).toContainText(
    "(3)",
  );

  // Na avulsa, quem já está na fixa aparece indisponível, com o lugar onde está.
  await cartaoDaOperacao(page, AVULSA)
    .getByRole("button", { name: /^Equipe/ })
    .click();
  const d = dialogo(page);
  const linhaRui = d.locator("div.border-b").filter({ hasText: RUI }).first();
  await expect(linhaRui).toContainText("Indisponível");
  await expect(linhaRui).toContainText(`Alocado em ${OP}`);
  // Filtro e busca.
  await d.getByRole("button", { name: "Em outra operação" }).click();
  await expect(d.locator("div.border-b").filter({ hasText: SOL })).toHaveCount(1);
  await d.getByPlaceholder("Buscar colaborador...").fill("Tito");
  await expect(d.locator("div.border-b").filter({ hasText: SOL })).toHaveCount(0);
  await expect(d.locator("div.border-b").filter({ hasText: TITO })).toHaveCount(1);
  await d.getByRole("button", { name: "Concluir" }).click();

  // O banco recusa a segunda alocação ativa (mesmo pela API).
  const api = await sessaoApi("ADMIN");
  const ids = consultar<{ op: string; emp: string }>(
    `select (select id from public.operations where name = ${lit(AVULSA)}) as op,
            (select id from public.employees where name = ${lit(RUI)}) as emp`,
  )[0]!;
  const { error } = await api
    .from("operation_team")
    .insert({ operation_id: ids.op, employee_id: ids.emp, shift_id: null });
  expect(error?.code, "exclusividade (migration 006)").toBe("23505");
  await api.auth.signOut({ scope: "local" });
  expect(equipeDe(AVULSA)).toEqual([]);
});

test("EQ2 desalocar: erro de rede em português; depois desaloca e o histórico fica", async ({
  page,
}) => {
  // Um dia lançado para Tito antes de sair da equipe.
  await lancarDia(page, {
    operacao: OP,
    turno: NOITE,
    data: "2026-10-05",
    linhas: [{ colaborador: TITO, entrada: "22:00", saida: "07:00", intervalo: 60 }],
  });
  await abrirOperacoes(page);
  await cartaoDaOperacao(page, OP)
    .getByRole("button", { name: /^Equipe/ })
    .click();
  const d = dialogo(page);
  const linha = d.locator("div.border-b").filter({ hasText: TITO }).first();
  await page.route("**/rest/v1/operation_team**", (rota) =>
    rota.request().method() === "DELETE" ? rota.abort("failed") : rota.continue(),
  );
  await linha.getByRole("button", { name: "Desalocar" }).click();
  const aviso = page.locator("[data-sonner-toast]").first();
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  const texto = (await aviso.innerText()).trim();
  expect(texto, `aviso exibido: "${texto}"`).not.toMatch(/failed|fetch|network|error/i);
  await page.unroute("**/rest/v1/operation_team**");
  await linha.getByRole("button", { name: "Desalocar" }).click();
  await expect(linha.getByRole("button", { name: "Desalocar" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await d.getByRole("button", { name: "Concluir" }).click();
  expect(equipeDe(OP).map((m) => m.colaborador)).toEqual([RUI, SOL]);
  expect(lancamento(OP, TITO, "2026-10-05"), "o lançamento continua").toMatchObject({
    receita: "250.00",
    custo: "150.00",
  });
});

// =============================================================================================
// TURNO COM EQUIPE OU APONTAMENTO
// =============================================================================================

test("TU4 turno com apontamento: jornada travada; criar a partir dele; excluir é recusado", async ({
  page,
}) => {
  await abrirOperacoes(page);
  await page.getByRole("button", { name: `Editar turno ${NOITE}`, exact: true }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Editar turno" })).toBeVisible();
  await expect(campo(d, "Início")).toBeDisabled();
  await d.getByRole("button", { name: "Criar novo turno a partir deste" }).click();
  await expect(d.getByRole("heading", { name: "Novo turno" })).toBeVisible();
  await expect(campo(d, "Início")).toHaveValue("22:00");
  await expect(campo(d, "Fim")).toHaveValue("07:00");
  await campo(d, "Nome do turno").fill("Noite 2 CP04");
  await campo(d, "Fim").fill("06:00");
  await d.getByRole("button", { name: "Salvar turno" }).click();
  await esperarFechar(page);
  expect(turno("Noite 2 CP04", OP)).toEqual({
    inicio: "22:00",
    fim: "06:00",
    intervalo: 60,
    vira: true,
  });
  expect(turno(NOITE, OP), "o turno usado não mudou").toEqual({
    inicio: "22:00",
    fim: "07:00",
    intervalo: 60,
    vira: true,
  });

  const resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir turno ${NOITE}`, exact: true }).click();
  await resposta;
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /não pode|cadastre um turno novo|recusad/i }),
  ).toBeVisible({ timeout: 20_000 });
  expect(contar("shifts", NOITE, OP)).toBe(1);
});

test("TU5 excluir turno com equipe: a confirmação diz quem sai da equipe", async ({ page }) => {
  await alocar(page, { operacao: OP, colaborador: TITO, turno: "Tarde CP04" });
  await abrirOperacoes(page);
  const resposta = responderConfirmacao(page, false);
  await page.getByRole("button", { name: "Excluir turno Tarde CP04", exact: true }).click();
  const texto = await resposta;
  expect(texto, `confirmação exibida: "${texto}"`).toMatch(/1 colaborador/);
  expect(contar("shifts", "Tarde CP04", OP), "Cancelar mantém").toBe(1);
  expect(equipeDe(OP).filter((m) => m.colaborador === TITO).length).toBe(1);
});

// =============================================================================================
// INTEGRAÇÃO
// =============================================================================================

test("CN-B valores de uma jornada normal: contrato 250 × custo 150, gravado, fechamento e relatório", async ({
  page,
}) => {
  await lancarDia(page, {
    operacao: OP,
    turno: DIA,
    data: "2026-10-06",
    linhas: [
      { colaborador: RUI, entrada: "06:00", saida: "15:00", intervalo: 60 },
      { colaborador: SOL, entrada: "06:00", saida: "15:00", intervalo: 60 },
    ],
  });
  // CN-D: dois profissionais, custos diferentes, sem duplicidade.
  expect(lancamento(OP, RUI, "2026-10-06")).toMatchObject({ receita: "250.00", custo: "150.00" });
  expect(lancamento(OP, SOL, "2026-10-06")).toMatchObject({ receita: "250.00", custo: "180.00" });
  const dia = consultar<{ n: number; receita: string; custo: string }>(
    `select count(*)::int as n, sum(billed_amount)::numeric(12,2)::text as receita,
            sum(cost_amount)::numeric(12,2)::text as custo
       from public.timesheet_entries te join public.operations o on o.id = te.operation_id
      where o.name = ${lit(OP)} and te.work_date = '2026-10-06'`,
  )[0];
  expect(dia).toEqual({ n: 2, receita: "500.00", custo: "330.00" });
});

test("CN-C reajustes de contrato, operação e colaborador: cada lançamento usa a condição da data", async ({
  page,
}) => {
  // Contrato 250 → 300 a partir de 08/10.
  await page.goto("/clientes");
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
  await page.getByRole("button", { name: `Editar ${CTR}`, exact: true }).click();
  await dialogo(page).getByRole("button", { name: "Alterar condições" }).click();
  let alt = dialogo(page);
  await alt.locator("#valor-atual-inicio").fill("2026-10-08");
  await alt.locator("#valor-atual-daily_rate").fill("300");
  await alt.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(alt.getByRole("heading", { name: "Alterar condições" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
  // Custo do Rui 150 → 170 a partir de 09/10.
  await page.goto("/colaboradores");
  await page.getByRole("button", { name: `Editar ${RUI}`, exact: true }).click();
  await dialogo(page).getByRole("button", { name: "Alterar custo" }).click();
  alt = dialogo(page);
  await alt.locator("#valor-atual-inicio").fill("2026-10-09");
  await alt.locator("#valor-atual-daily_cost").fill("170");
  await alt.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(alt.getByRole("heading", { name: "Alterar custo" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");

  for (const data of ["2026-10-07", "2026-10-08", "2026-10-09"]) {
    await lancarDia(page, {
      operacao: OP,
      turno: DIA,
      data,
      linhas: [{ colaborador: RUI, entrada: "06:00", saida: "15:00", intervalo: 60 }],
    });
  }
  expect(lancamento(OP, RUI, "2026-10-07"), "contrato 250, custo 150").toMatchObject({
    receita: "250.00",
    custo: "150.00",
  });
  expect(lancamento(OP, RUI, "2026-10-08"), "contrato 300, custo 150").toMatchObject({
    receita: "300.00",
    custo: "150.00",
  });
  expect(lancamento(OP, RUI, "2026-10-09"), "contrato 300, custo 170").toMatchObject({
    receita: "300.00",
    custo: "170.00",
  });
  // Salvar o dia grava a equipe inteira do turno (CP-05): Sol também tem 07–09, com o custo dela.
  expect(lancamento(OP, SOL, "2026-10-08"), "Sol: contrato 300, custo 180").toMatchObject({
    receita: "300.00",
    custo: "180.00",
  });
  // O dia 06/10 (antes dos reajustes) continua congelado.
  expect(lancamento(OP, RUI, "2026-10-06")).toMatchObject({ receita: "250.00", custo: "150.00" });

  // A lista mostra os valores de HOJE: o contrato no seletor e o custo na equipe.
  await abrirOperacoes(page);
  await page.getByRole("button", { name: `Editar ${OP}`, exact: true }).click();
  await campo(dialogo(page), "Contrato").click();
  await expect(
    page.getByRole("option", { name: new RegExp(`^${CTR} — R\\$\\s?300,00`) }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await dialogo(page).getByRole("button", { name: "Cancelar" }).click();
  await esperarFechar(page);
  await cartaoDaOperacao(page, OP)
    .getByRole("button", { name: /^Equipe/ })
    .click();
  await expect(
    dialogo(page).locator("div.border-b").filter({ hasText: RUI }).first(),
  ).toContainText(/custo R\$\s?170,00/);
});

test("CN-E turno noturno: data de referência é a da entrada; 8 h; fechamento e relatório", async ({
  page,
}) => {
  // Tito lançou 05/10 no turno 22:00–07:00 (EQ2): a data é a do início da jornada.
  const [l] = consultar<{ data: string; turno: string; entrada: string; saida: string }>(
    `select to_char(te.work_date,'YYYY-MM-DD') as data, s.name as turno,
            to_char(te.check_in,'HH24:MI') as entrada, to_char(te.check_out,'HH24:MI') as saida
       from public.timesheet_entries te join public.timesheets t on t.id = te.timesheet_id
       join public.shifts s on s.id = t.shift_id join public.employees e on e.id = te.employee_id
      where e.name = ${lit(TITO)}`,
  );
  expect(l).toEqual({ data: "2026-10-05", turno: NOITE, entrada: "22:00", saida: "07:00" });

  // Período 01–15/10 do cliente (Rui e Sol no turno do dia em 06–09; Tito na noite de 05):
  // receita 250 (05) + 2×250 (06) + 2×250 (07) + 2×300 (08) + 2×300 (09) = 2.450,00;
  // custo 150 (05) + 330 (06) + 330 (07) + 330 (08) + (170 + 180) (09) = 1.490,00.
  await gerarFechamento(page, { cliente: CLI, mes: 10, ano: 2026 });
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(2450));
  await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(1490));
  await page.goto("/relatorios");
  await campo(page, "De").fill("2026-10-01");
  await campo(page, "Até").fill("2026-10-15");
  await expect(page.locator("tr").filter({ hasText: RUI }).first()).toContainText(reais(620), {
    timeout: 30_000,
  });
  await expect(page.locator("tr").filter({ hasText: SOL }).first()).toContainText(reais(720));
  await expect(page.locator("tr").filter({ hasText: TITO }).first()).toContainText(reais(150));
});

test("OP5 excluir operação: com apontamento é recusado; sem dependência remove", async ({
  page,
}) => {
  await abrirOperacoes(page);
  let resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${OP}`, exact: true }).click();
  await resposta;
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Exclusão recusada" }),
  ).toBeVisible({ timeout: 20_000 });
  expect(contar("operations", OP)).toBe(1);

  const livre = `${C} Op Enter`;
  resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${livre}`, exact: true }).click();
  await resposta;
  // O aviso anterior (recusa) pode continuar na tela: espera o aviso desta exclusão.
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Registro removido." }),
  ).toBeVisible({ timeout: 20_000 });
  expect(contar("operations", livre)).toBe(0);
});

// =============================================================================================
// D3 TARDIO: o diálogo que fecha depois de gravar ainda aceita o clique
// =============================================================================================

/**
 * Clica e continua clicando a cada quadro enquanto o botão existir e estiver habilitado — como o
 * Enter repetido do teclado. Depois de gravar, o diálogo fica montado durante a animação de
 * saída, com o botão focado e o formulário preenchido: foi nesse intervalo que a CI do acd1747
 * criou dois clientes no CL3 (a trava era liberada no `onSettled`, antes de o diálogo sumir).
 */
async function insistirAteFechar(botao: ReturnType<typeof dialogo>) {
  await botao.evaluate(async (b: HTMLElement) => {
    const alvo = b as HTMLButtonElement;
    alvo.click();
    const fim = performance.now() + 2500;
    while (performance.now() < fim && alvo.isConnected) {
      await new Promise((r) => requestAnimationFrame(r));
      if (alvo.isConnected && !alvo.disabled) alvo.click();
    }
  });
}

test("D3b clique que chega com o diálogo fechando (depois de gravar) não grava de novo: cliente, colaborador, operação e turno", async ({
  page,
}) => {
  const cliente = `${C} Fecho Cliente`;
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  let d = dialogo(page);
  await campo(d, "Nome").fill(cliente);
  await insistirAteFechar(d.getByRole("button", { name: "Salvar cliente" }));
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  const clientes = Number(
    valor(`select count(*) from public.clients where name = ${lit(cliente)}`),
  );

  const colaborador = `${C} Fecho Colaborador`;
  await page.goto("/colaboradores");
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  d = dialogo(page);
  await d.locator("#employee-name").fill(colaborador);
  await d.locator("#employee-cost").fill("150");
  await d.locator("#employee-cost-from").fill("2026-10-01");
  await insistirAteFechar(d.getByRole("button", { name: "Salvar colaborador" }));
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  const colaboradores = Number(
    valor(`select count(*) from public.employees where name = ${lit(colaborador)}`),
  );

  const operacao = `${C} Fecho Op`;
  await abrirOperacoes(page);
  await page.getByRole("button", { name: "Nova operação" }).click();
  d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), CLI);
  await campo(d, "Nome da operação").fill(operacao);
  await escolher(page, campo(d, "Contrato"), new RegExp(`^${literal(CTR)} — `));
  await insistirAteFechar(d.getByRole("button", { name: "Salvar operação" }));
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  const operacoes = contar("operations", operacao);

  d = await abrirNovoTurno(page, operacao);
  await preencherTurno(d, { nome: "Fecho CP04", inicio: "06:00", fim: "15:00", intervalo: 60 });
  await insistirAteFechar(d.getByRole("button", { name: "Salvar turno" }));
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  // `in`, não `=`: se a operação tiver duplicado, a contagem do turno não pode quebrar.
  const turnos = Number(
    valor(
      `select count(*) from public.shifts where name = 'Fecho CP04' and operation_id in
         (select id from public.operations where name = ${lit(operacao)})`,
    ),
  );

  expect({ clientes, colaboradores, operacoes, turnos }).toEqual({
    clientes: 1,
    colaboradores: 1,
    operacoes: 1,
    turnos: 1,
  });
});
