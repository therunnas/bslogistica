import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { faturasDoCliente, lit } from "../apoio/banco";
import { sessaoApi } from "../apoio/contas";
import { consultar, estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirDia,
  abrirFaturamento,
  alocar,
  campo,
  criarCliente,
  criarColaborador,
  criarOperacao,
  criarTurno,
  emitirFatura,
  escolher,
  esperarAviso,
  gerarFechamento,
  linhaDo,
  reais,
  registrarAdicional,
  valorDoCartao,
} from "../apoio/telas";
import { prepararLoteDeContainers } from "../../src/lib/container-servico";

/**
 * CP-06 — Serviços avulsos. A BS tem DOIS modelos: operação fixa e serviço avulso. Contêiner é um
 * TIPO de serviço avulso, não uma terceira modalidade. Fluxo canônico (decisão do #121: "serviço
 * pontual vira operação avulsa"): Operações → Nova operação → tipo Avulsa, com valor próprio por
 * diária e data do serviço, sem contrato; os participantes entram pelo apontamento.
 *
 * O módulo `/containers` (045–050) é o caminho LEGADO: fora do menu desde o #121, mas ainda aberto
 * por URL e pelo link "Ver container" do Faturamento. A receita dele vira um adicional
 * (`billing_additionals`) e o custo dos participantes entra no custo da fatura.
 *
 * Valores redondos: diária do avulso R$ 300 (contêiner), R$ 220 (etiquetagem), R$ 180 (limpeza);
 * custos dos colaboradores R$ 160, 200, 150 e 170. Datas de 2026-11, cliente próprio.
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP06`;
const CLI = `${C} Cliente`;
const CONTEINER = `${C} Contêiner 40 pés — tecidos`;
const ETIQUETAGEM = `${C} Etiquetagem — caixas`;
const LIMPEZA = `${C} Limpeza — galpão`;
const TURNO = "Avulso CP06";
const ANA = `${C} Ana`;
const BIA = `${C} Bia`;
const CAIO = `${C} Caio`;
const DAVI = `${C} Davi`;

function lancamentos(operacao: string) {
  return consultar<{
    colaborador: string;
    data: string;
    receita: string;
    custo: string;
    origem: string | null;
    contrato: string | null;
  }>(
    `select e.name as colaborador, to_char(te.work_date,'YYYY-MM-DD') as data,
            te.billed_amount::numeric(12,2)::text as receita, te.cost_amount::numeric(12,2)::text as custo,
            te.terms_origin as origem, te.contract_terms_id::text as contrato
       from public.timesheet_entries te join public.employees e on e.id = te.employee_id
       join public.operations o on o.id = te.operation_id
      where o.name = ${lit(operacao)} order by e.name`,
  );
}

function idDe(tabela: "clients" | "operations" | "employees", nome: string): string {
  const [l] = consultar<{ id: string }>(
    `select id from public.${tabela} where name = ${lit(nome)}`,
  );
  return l!.id;
}

function containers() {
  return consultar<{ descricao: string; receita: string; custo: string; cancelado: boolean }>(
    `select s.description as descricao, (s.revenue_cents/100.0)::numeric(12,2)::text as receita,
            (s.cost_total_cents/100.0)::numeric(12,2)::text as custo, s.canceled_at is not null as cancelado
       from public.container_services s join public.clients c on c.id = s.client_id
      where c.name = ${lit(CLI)} order by s.created_at`,
  );
}

async function lancar(page: Page, operacao: string, data: string, colaboradores: string[]) {
  await abrirDia(page, { operacao, turno: TURNO, data });
  for (const n of colaboradores) await expect(linhaDo(page, n)).toBeVisible();
  const salvar = page.getByRole("button", { name: "Salvar", exact: true });
  await expect(salvar).toBeEnabled();
  await salvar.click();
  await esperarAviso(page, "Apontamento salvo.");
}

// =============================================================================================
// PREPARAÇÃO
// =============================================================================================

test("PR preparação: cliente sem contrato, três serviços avulsos de tipos diferentes e quatro colaboradores", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await criarCliente(page, CLI);
  for (const [nome, custo] of [
    [ANA, 160],
    [BIA, 200],
    [CAIO, 150],
    [DAVI, 170],
  ] as const) {
    await criarColaborador(page, { nome, custo, desde: "2026-10-01" });
  }
  // O tipo do serviço fica no nome e nas observações: a operação avulsa não tem campo de tipo.
  for (const [nome, valor, data] of [
    [CONTEINER, 300, "2026-11-03"],
    [ETIQUETAGEM, 220, "2026-11-04"],
    [LIMPEZA, 180, "2026-11-05"],
  ] as const) {
    await criarOperacao(page, { cliente: CLI, nome, tipo: "Avulsa", valor, data });
    await criarTurno(page, {
      operacao: nome,
      nome: TURNO,
      inicio: "08:00",
      fim: "17:00",
      intervalo: 60,
    });
  }
  await alocar(page, { operacao: CONTEINER, colaborador: ANA, turno: TURNO });
  await alocar(page, { operacao: CONTEINER, colaborador: BIA, turno: TURNO });
  await alocar(page, { operacao: ETIQUETAGEM, colaborador: CAIO, turno: TURNO });
  await alocar(page, { operacao: LIMPEZA, colaborador: DAVI, turno: TURNO });

  const ops = consultar<{ nome: string; tipo: string; contrato: string | null }>(
    `select o.name as nome, o.type::text as tipo, o.contract_id::text as contrato
       from public.operations o join public.clients c on c.id = o.client_id
      where c.name = ${lit(CLI)} order by o.name`,
  );
  // Nenhum contrato fictício: o avulso existe sem operação fixa nem contrato ("Avulsa" = `spot`).
  expect(ops.map((o) => [o.tipo, o.contrato])).toEqual([
    ["spot", null],
    ["spot", null],
    ["spot", null],
  ]);
});

// =============================================================================================
// FLUXO CANÔNICO: operação avulsa
// =============================================================================================

test("AV1 contêiner como serviço avulso: dois participantes, pedido e execução no mesmo dia, sem contrato", async ({
  page,
}) => {
  await lancar(page, CONTEINER, "2026-11-03", [ANA, BIA]);
  // Diária do avulso (R$ 300) por participante; custo de cada um pelo seu cadastro.
  expect(
    lancamentos(CONTEINER).map((l) => [l.colaborador, l.receita, l.custo, l.origem, l.contrato]),
  ).toEqual([
    [ANA, "300.00", "160.00", "valor_acordado", null],
    [BIA, "300.00", "200.00", "valor_acordado", null],
  ]);
});

test("AV2 etiquetagem e limpeza: cada tipo com o seu valor, um participante cada", async ({
  page,
}) => {
  await lancar(page, ETIQUETAGEM, "2026-11-04", [CAIO]);
  await lancar(page, LIMPEZA, "2026-11-05", [DAVI]);
  expect(lancamentos(ETIQUETAGEM).map((l) => `${l.receita}/${l.custo}`)).toEqual(["220.00/150.00"]);
  expect(lancamentos(LIMPEZA).map((l) => `${l.receita}/${l.custo}`)).toEqual(["180.00/170.00"]);
});

// =============================================================================================
// D7 — CAMINHO LEGADO DE CONTÊINER
// =============================================================================================

test("D7 [CP-06B] não existe painel de Contêineres: as URLs antigas levam a Operações, sem menu nem link", async ({
  page,
}) => {
  await page.goto("/containers");
  await expect(page).toHaveURL(/\/operacoes(#servicos-avulsos-antigos)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Containers" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Operações" })).toBeVisible();
  await page.goto("/containers/novo");
  await expect(page).toHaveURL(/\/operacoes\?origem=conteiner$/);
  await expect(page.getByText("Contêiner é um tipo de serviço avulso").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar serviço" })).toHaveCount(0);
  // Nenhum menu nem link interno leva ao antigo painel.
  expect(await page.locator('a[href^="/containers"]').count()).toBe(0);
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /contain|contêiner/i }),
  ).toHaveCount(0);
  expect(containers(), "nada foi criado pelo caminho legado").toEqual([]);
});

test("I1 tipo do serviço: a operação Avulsa explica os tipos e o nome identificado permanece depois de recarregar", async ({
  page,
}) => {
  await page.goto("/operacoes");
  await page.getByRole("button", { name: "Nova operação" }).click();
  const d = page.getByRole("dialog").last();
  await escolher(page, campo(d, "Tipo"), "Avulsa");
  await expect(d.getByText(/Avulsa: serviço pontual/)).toBeVisible();
  await expect(d.getByText(/contêiner, carga e descarga, etiquetagem, limpeza/)).toBeVisible();
  await d.getByRole("button", { name: "Cancelar" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 2, name: CONTEINER, exact: true }),
    "o tipo do serviço fica no nome da operação (não há campo estruturado: DEC-CP06-01)",
  ).toBeVisible();
});

test("D7b registro ANTIGO de contêiner ligado à mesma operação avulsa: o Faturamento avisa a cobrança em dobro", async ({
  page,
}) => {
  // Um registro que já existia antes do encerramento do cadastro (criado pela RPC do banco, como
  // a tela antiga fazia): o mesmo contêiner da operação avulsa, R$ 600 e custos 160 + 200.
  const api = await sessaoApi("ADMIN");
  const lote = prepararLoteDeContainers({
    clienteId: idDe("clients", CLI),
    operacaoId: idDe("operations", CONTEINER),
    solicitadoEm: "2026-11-03",
    executadoEm: "2026-11-03",
    descricao: "Contêiner 40 pés — tecidos (registro antigo)",
    quantidade: 1,
    totalCobrado: "600",
    participantes: [
      { colaboradorId: idDe("employees", ANA), valorDevido: "160" },
      { colaboradorId: idDe("employees", BIA), valorDevido: "200" },
    ],
    modalidadeCusto: "por_pessoa",
  });
  const { error } = await api.rpc("registrar_servico_container", {
    p_dados: lote,
    p_idempotency_key: randomUUID(),
    p_reason: "E2E CP-06: registro antigo de contêiner",
  });
  expect(error).toBeNull();
  await api.auth.signOut({ scope: "local" });

  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  // Apontamentos 600 + 220 + 180 e o mesmo contêiner de novo (600), sem distinção na tela.
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(1600));
  const alerta = page.getByRole("alert").filter({ hasText: "cobrado duas vezes" });
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(CONTEINER);
  // O histórico continua acessível pelo Faturamento, dentro de Operações (sem painel próprio).
  await expect(page.getByRole("link", { name: /registro antigo/i })).toHaveAttribute(
    "href",
    /^\/operacoes\/avulsos-antigos\/[0-9a-f-]{36}$/,
  );
  // E em Operações, na seção de serviços avulsos antigos.
  await page.goto("/operacoes");
  const secao = page.locator("#servicos-avulsos-antigos");
  await secao.getByText("Serviços avulsos antigos").click();
  await expect(secao).toContainText("Contêiner 40 pés — tecidos (registro antigo)", {
    timeout: 20_000,
  });
  await expect(secao.getByRole("link", { name: /Ver/ }).first()).toHaveAttribute(
    "href",
    /^\/operacoes\/avulsos-antigos\//,
  );
});

test("D7c cancelar o registro antigo duplicado: histórico preservado e cobrança única", async ({
  page,
}) => {
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  const href = await page.getByRole("link", { name: /registro antigo/i }).getAttribute("href");
  const id = href!.split("/").pop()!;
  // A URL antiga do registro leva à consulta dentro de Operações.
  await page.goto(`/containers/${id}`);
  await expect(page).toHaveURL(new RegExp(`/operacoes/avulsos-antigos/${id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Serviço avulso antigo");
  await expect(page.getByRole("heading", { level: 1, name: "Serviço de containers" })).toHaveCount(
    0,
  );
  await page.locator("#motivo-cancelamento").fill("Duplicado da operação avulsa (CP-06)");
  await page.getByRole("button", { name: "Cancelar serviço" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirmar cancelamento" })
    .click();
  await expect.poll(() => containers()[0]?.cancelado, { timeout: 20_000 }).toBe(true);
  expect(containers()).toEqual([
    {
      descricao: "Contêiner 40 pés — tecidos (registro antigo)",
      receita: "600.00",
      custo: "360.00",
      cancelado: true,
    },
  ]);
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(1000));
  await expect(page.getByRole("alert").filter({ hasText: "cobrado duas vezes" })).toHaveCount(0);
});

// =============================================================================================
// ADICIONAIS, FECHAMENTO, FATURA ÚNICA
// =============================================================================================

test("AD1 adicional é valor complementar: duplo clique grava UM; entra na fatura uma vez", async ({
  page,
}) => {
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await page.getByRole("button", { name: "Novo adicional" }).click();
  const d = page.getByRole("dialog").last();
  await d.locator("#adicional-inicio").fill("2026-11-04");
  await d.locator("#adicional-fim").fill("2026-11-04");
  const mes = d.locator("#adicional-competencia-mes");
  if (await mes.count()) {
    await mes.fill("2026-11");
    await d.locator("#adicional-competencia").selectOption({ index: 0 });
  }
  await d.locator("#adicional-motivo").fill(`${C} Retrabalho de etiquetas`);
  await d.locator("#adicional-valor").fill("50");
  await d.getByRole("button", { name: "Registrar adicional" }).evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const [{ n }] = consultar<{ n: number }>(
    `select count(*)::int as n from public.billing_additionals a join public.clients c on c.id = a.client_id
      where c.name = ${lit(CLI)} and a.description = ${lit(`${C} Retrabalho de etiquetas`)}`,
  );
  expect(n, "um adicional por envio").toBe(1);
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(1050));
});

test("AD2 cancelar adicional não faturado: exige motivo, sai do total e o histórico fica", async ({
  page,
}) => {
  const motivo = `${C} Adicional a cancelar`;
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await registrarAdicional(page, {
    inicio: "2026-11-05",
    fim: "2026-11-05",
    mesCompetencia: "2026-11",
    motivo,
    valor: 30,
  });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(1080));
  await page
    .locator("tr")
    .filter({ hasText: motivo })
    .getByRole("button", { name: "Conferir cancelamento" })
    .click();
  const d = page.getByRole("dialog").last();
  await expect(d.getByRole("heading", { name: "Cancelar adicional" })).toBeVisible();
  const confirmar = d.getByRole("button", { name: "Cancelar adicional" });
  await expect(confirmar, "sem motivo não cancela").toBeDisabled();
  await d.locator("#adicional-motivo-cancelamento").fill("Lançado por engano (CP-06)");
  await confirmar.click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  const [a] = consultar<{ cancelado: boolean; motivo: string | null }>(
    `select a.canceled_at is not null as cancelado, a.cancel_reason as motivo
       from public.billing_additionals a where a.description = ${lit(motivo)}`,
  );
  expect(a).toEqual({ cancelado: true, motivo: "Lançado por engano (CP-06)" });
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(1050));
});

test("D7d registro antigo SEM operação (R$ 120, custo 50): entra uma vez na fatura e continua consultável", async () => {
  const api = await sessaoApi("ADMIN");
  const { error } = await api.rpc("registrar_servico_container", {
    p_dados: prepararLoteDeContainers({
      clienteId: idDe("clients", CLI),
      operacaoId: null,
      solicitadoEm: "2026-11-06",
      executadoEm: "2026-11-06",
      descricao: "Contêiner 20 pés — caixas (registro antigo a faturar)",
      quantidade: 1,
      totalCobrado: "120",
      participantes: [{ colaboradorId: idDe("employees", CAIO), valorDevido: "50" }],
      modalidadeCusto: "por_pessoa",
    }),
    p_idempotency_key: randomUUID(),
    p_reason: "E2E CP-06B: registro antigo a faturar",
  });
  expect(error).toBeNull();
  await api.auth.signOut({ scope: "local" });
  expect(containers().map((c) => [c.descricao, c.receita, c.custo, c.cancelado])).toEqual([
    ["Contêiner 40 pés — tecidos (registro antigo)", "600.00", "360.00", true],
    ["Contêiner 20 pés — caixas (registro antigo a faturar)", "120.00", "50.00", false],
  ]);
});

test("FE1 fechamento, fatura única e relatório: avulsos + adicional ao centavo; sem segunda cobrança", async ({
  page,
}) => {
  // Receita: avulsos 300 + 300 + 220 + 180 = 1.000 + adicional 50 + registro antigo 120 = 1.170.
  // Custo: 160 + 200 + 150 + 170 = 680 + registro antigo 50 = 730 (o cancelado não entra).
  await gerarFechamento(page, { cliente: CLI, mes: 11, ano: 2026 });
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(1170));
  await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(730));

  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await emitirFatura(page, reais(1170));
  const faturas = faturasDoCliente(CLI);
  expect(faturas).toHaveLength(1);
  expect([faturas[0]?.total, faturas[0]?.custo, faturas[0]?.lancamentos]).toEqual([
    "1170.00",
    "730.00",
    4,
  ]);
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();
  expect(faturasDoCliente(CLI)).toHaveLength(1);
  // Relatório por colaborador: receita e custo de cada participante, iguais ao apontamento.
  await page.goto("/relatorios");
  await campo(page, "De").fill("2026-11-01");
  await campo(page, "Até").fill("2026-11-15");
  for (const [nome, receita, custo] of [
    [ANA, 300, 160],
    [BIA, 300, 200],
    [CAIO, 220, 150],
    [DAVI, 180, 170],
  ] as const) {
    const tr = page.locator("tr").filter({ hasText: nome }).first();
    await expect(tr, `relatório: receita de ${nome}`).toContainText(reais(receita), {
      timeout: 30_000,
    });
    await expect(tr, `relatório: custo de ${nome}`).toContainText(reais(custo));
  }
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  // O registro antigo faturado continua consultável em Operações, sem cancelamento.
  const [{ antigo }] = consultar<{ antigo: string }>(
    `select s.id::text as antigo from public.container_services s
      where s.description = 'Contêiner 20 pés — caixas (registro antigo a faturar)'`,
  );
  await page.goto(`/operacoes/avulsos-antigos/${antigo}`);
  await expect(page.getByText("Faturado").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Cancelar serviço" })).toHaveCount(0);
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-11-01", fim: "2026-11-15" });
  // Faturado é imutável: o adicional não pode mais ser cancelado.
  await expect(
    page
      .locator("tr")
      .filter({ hasText: `${C} Retrabalho de etiquetas` })
      .getByRole("button", {
        name: "Conferir cancelamento",
      }),
  ).toBeDisabled();
});

// =============================================================================================
// SEGURANÇA
// =============================================================================================

test("SG1 operacional não acessa o módulo nem os dados de contêiner e adicionais", async ({
  browser,
}) => {
  const contexto = await browser.newContext({ storageState: estadoDe("operacional") });
  const op = await contexto.newPage();
  await op.goto("/containers");
  await expect(op.getByText(/Área administrativa restrita|Acesso não liberado/)).toBeVisible();
  await op.goto("/containers/novo");
  await expect(op.getByText(/Área administrativa restrita|Acesso não liberado/)).toBeVisible();
  await op.goto("/operacoes/avulsos-antigos/00000000-0000-4000-8000-000000000000");
  await expect(op.getByText(/Área administrativa restrita|Acesso não liberado/)).toBeVisible();
  await contexto.close();

  const api = await sessaoApi("OPER");
  for (const tabela of [
    "container_services",
    "container_service_participants",
    "billing_additionals",
  ]) {
    const { data, error } = await api.from(tabela).select("*");
    expect(error === null ? (data ?? []).length : 0, `${tabela} pelo operacional`).toBe(0);
  }
  const { error } = await api.rpc("registrar_servico_container", {
    p_dados: {},
    p_idempotency_key: randomUUID(),
    p_reason: "tentativa do operacional",
  });
  expect(error, "a RPC recusa o operacional").not.toBeNull();
  await api.auth.signOut({ scope: "local" });
});
