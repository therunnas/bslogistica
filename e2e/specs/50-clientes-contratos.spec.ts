import type { Page } from "@playwright/test";

import { contarPorNome, lancamento, lit } from "../apoio/banco";
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
  reais,
  valorDoCartao,
} from "../apoio/telas";

/**
 * CP-02 — Clientes e contratos: cada ação da tela /clientes (cliente, contrato, condições por
 * vigência, exclusões, feriados) e a passagem dos dados para operação, apontamento e fechamento.
 *
 * Em ordem (1 worker), NÃO serial: uma falha não esconde os demais casos. Dados próprios
 * ("CP02"), criados pela tela; valores esperados escritos à mão (8 h = 1 diária, sem hora extra).
 *
 * Distinções usadas nas conferências (ver docs/qa/CP-02-clientes-e-contratos.md):
 * definido = o que o usuário digitou; vigente = versão de contract_terms na data; persistido =
 * coluna do banco; exibido = tela; aplicado/congelado = billed_amount e daily_rate_snapshot do
 * lançamento; exportado = fechamento.
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP02`;
const CLI_A = `${C} Cliente A`;
const CTR_A = `${C} Contrato A`;
const OP_A = `${C} Op A`;
const TURNO = "Diurno CP02";
const ANA = `${C} Ana`;
const BETO = `${C} Beto`;

async function abrirClientes(page: Page) {
  await page.goto("/clientes");
  await expect(page.getByRole("heading", { name: "Clientes e contratos", level: 1 })).toBeVisible();
}

async function abrirContratos(page: Page) {
  await abrirClientes(page);
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
}

function linhaDaTabela(page: Page, texto: string) {
  return page.locator("tr").filter({ hasText: texto }).first();
}

async function responderConfirmacao(page: Page, aceitar: boolean): Promise<string> {
  // D8 (CP-09): a confirmação é o diálogo da tela, não mais o `window.confirm` nativo.
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toBeVisible({ timeout: 15_000 });
  const texto = (await confirmacao.innerText()).trim();
  await confirmacao
    .getByRole("button", { name: aceitar ? "Excluir" : "Cancelar", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  return texto;
}

function contratoNoBanco(nome: string) {
  return consultar<{
    id: string;
    cliente: string;
    diaria: string;
    inicio: string;
    fim: string | null;
    status: string;
  }>(`select c.id, cl.name as cliente, c.daily_rate::numeric(12,2)::text as diaria,
             to_char(c.valid_from,'YYYY-MM-DD') as inicio, to_char(c.valid_to,'YYYY-MM-DD') as fim,
             c.status::text as status
        from public.contracts c join public.clients cl on cl.id = c.client_id
       where c.name = ${lit(nome)}`);
}

function vigenciasDoContrato(nome: string) {
  return consultar<{ inicio: string; fim: string | null; diaria: string }>(
    `select to_char(t.valid_from,'YYYY-MM-DD') as inicio, to_char(t.valid_to,'YYYY-MM-DD') as fim,
            t.daily_rate::numeric(12,2)::text as diaria
       from public.contract_terms t join public.contracts c on c.id = t.contract_id
      where c.name = ${lit(nome)} and t.active order by t.valid_from`,
  );
}

function snapshotDe(operacao: string, colaborador: string, data: string): string | undefined {
  return consultar<{ s: string }>(
    `select te.daily_rate_snapshot::numeric(12,2)::text as s
       from public.timesheet_entries te join public.operations o on o.id = te.operation_id
       join public.employees e on e.id = te.employee_id
      where o.name = ${lit(operacao)} and e.name = ${lit(colaborador)}
        and te.work_date = ${lit(data)}`,
  )[0]?.s;
}

// =============================================================================================
// CLIENTES
// =============================================================================================

test("CL1 novo cliente: rótulos ligados aos campos, nome obrigatório (vazio e só espaços)", async ({
  page,
}) => {
  await abrirClientes(page);
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Novo cliente" })).toBeVisible();
  // Leitor de tela e clique no rótulo: cada rótulo precisa nomear o seu campo.
  for (const rotulo of ["Nome", "CNPJ", "Contato", "E-mail", "Telefone", "Observações"]) {
    await expect(d.getByLabel(rotulo, { exact: true }), `rótulo "${rotulo}"`).toBeVisible();
  }
  const salvar = d.getByRole("button", { name: "Salvar cliente" });
  await expect(salvar).toBeDisabled();
  await d.getByLabel("Nome", { exact: true }).fill("   ");
  await expect(salvar, "nome só com espaços não é nome").toBeDisabled();
  await d.getByRole("button", { name: "Cancelar" }).click();
  await esperarFechar(page);
});

test("CL2 cadastrar: todos os campos persistem (banco e tela, depois de recarregar)", async ({
  page,
}) => {
  await abrirClientes(page);
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const d = dialogo(page);
  await campo(d, "Nome").fill(`  ${CLI_A}  `);
  await campo(d, "CNPJ").fill("12.345.678/0001-90");
  await campo(d, "Contato").fill("Maria Teste");
  await campo(d, "E-mail").fill("contato@exemplo.test");
  await campo(d, "Telefone").fill("(11) 4000-0000");
  await campo(d, "Observações").fill("Cliente sintético do CP-02");
  await d.getByRole("button", { name: "Salvar cliente" }).click();
  await esperarAviso(page, "Registro salvo.");
  await esperarFechar(page);

  const [linha] = consultar<Record<string, string>>(
    `select name, doc, contact_name, email, phone, notes, status::text as status
       from public.clients where name like ${lit(`%${CLI_A}%`)}`,
  );
  expect(linha, "o nome é gravado sem os espaços das pontas").toEqual({
    name: CLI_A,
    doc: "12.345.678/0001-90",
    contact_name: "Maria Teste",
    email: "contato@exemplo.test",
    phone: "(11) 4000-0000",
    notes: "Cliente sintético do CP-02",
    status: "active",
  });
  await page.reload();
  const tr = linhaDaTabela(page, CLI_A);
  await expect(tr).toContainText("12.345.678/0001-90");
  await expect(tr).toContainText("Maria Teste");
  await expect(tr).toContainText("contato@exemplo.test");
  await expect(tr).toContainText("Ativo");
});

test("CL3 [D3] duplo clique e Enter repetido em “Salvar cliente” criam UM cliente", async ({
  page,
}) => {
  const nome = `${C} Duplo`;
  await abrirClientes(page);
  await page.getByRole("button", { name: "Novo cliente" }).click();
  let d = dialogo(page);
  await campo(d, "Nome").fill(nome);
  // Dois cliques no mesmo instante (mesmo tick), como um duplo clique rápido.
  await d.getByRole("button", { name: "Salvar cliente" }).evaluate((botao: HTMLElement) => {
    botao.click();
    botao.click();
  });
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contarPorNome("clients", nome), "duplo clique").toBe(1);

  const nomeEnter = `${C} Enter`;
  await page.getByRole("button", { name: "Novo cliente" }).click();
  d = dialogo(page);
  await campo(d, "Nome").fill(nomeEnter);
  await d.getByRole("button", { name: "Salvar cliente" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contarPorNome("clients", nomeEnter), "Enter repetido").toBe(1);
});

test("CL4 carregamento, falha de rede em português e trava liberada depois do erro", async ({
  page,
}) => {
  const nome = `${C} Rede`;
  await abrirClientes(page);
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const d = dialogo(page);
  await campo(d, "Nome").fill(nome);

  // 1. Falha de rede: nada é gravado, a mensagem é em português e o diálogo continua aberto.
  await page.route("**/rest/v1/clients**", (rota) =>
    rota.request().method() === "POST" ? rota.abort("failed") : rota.continue(),
  );
  await d.getByRole("button", { name: "Salvar cliente" }).click();
  const toastDeErro = page.locator("[data-sonner-toast]").first();
  await expect(toastDeErro).toBeVisible({ timeout: 20_000 });
  const aviso = (await toastDeErro.innerText()).trim();
  expect(aviso, `aviso exibido: "${aviso}"`).not.toMatch(/failed|fetch|network|error/i);
  expect(aviso).toContain("Não foi possível falar com o servidor");
  await expect(d).toBeVisible();
  expect(contarPorNome("clients", nome)).toBe(0);
  await page.unroute("**/rest/v1/clients**");

  // 2. Sem a falha, com resposta lenta: o botão mostra o carregamento e fica desabilitado; a
  //    trava foi liberada pelo erro anterior (o segundo envio acontece).
  await page.route("**/rest/v1/clients**", async (rota) => {
    if (rota.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
    await rota.continue();
  });
  await d.getByRole("button", { name: "Salvar cliente" }).click();
  const carregando = d.getByRole("button", { name: "Salvando..." });
  await expect(carregando).toBeVisible();
  await expect(carregando).toBeDisabled();
  await esperarFechar(page);
  await page.unroute("**/rest/v1/clients**");
  expect(contarPorNome("clients", nome)).toBe(1);
});

test("CL5 editar: dados e situação mudam, relações e contadores acompanham", async ({ page }) => {
  await criarCliente(page, `${C} Editar`);
  await abrirClientes(page);
  await expect(linhaDaTabela(page, `${C} Editar`)).toBeVisible();
  const ativosAntes = Number(await valorDoCartao(page, "Clientes ativos").innerText());
  await page.getByRole("button", { name: `Editar ${C} Editar`, exact: true }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Editar cliente" })).toBeVisible();
  await expect(campo(d, "Nome")).toHaveValue(`${C} Editar`);
  await campo(d, "Contato").fill("Contato Novo");
  await escolher(page, campo(d, "Status"), "Inativo");
  await d.getByRole("button", { name: "Salvar cliente" }).click();
  await esperarAviso(page, "Registro salvo.");
  await esperarFechar(page);
  await page.reload();
  const tr = linhaDaTabela(page, `${C} Editar`);
  await expect(tr).toContainText("Contato Novo");
  await expect(tr).toContainText("Inativo");
  await expect(valorDoCartao(page, "Clientes ativos")).toHaveText(String(ativosAntes - 1));
  expect(valor(`select status::text from public.clients where name = ${lit(`${C} Editar`)}`)).toBe(
    "inactive",
  );
});

test("CL6 excluir sem dependência: Cancelar mantém; confirmar remove", async ({ page }) => {
  const nome = `${C} Excluir Livre`;
  await criarCliente(page, nome);
  await abrirClientes(page);
  let resposta = responderConfirmacao(page, false);
  await page.getByRole("button", { name: `Excluir ${nome}`, exact: true }).click();
  expect(await resposta).toContain(nome);
  expect(contarPorNome("clients", nome)).toBe(1);

  resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${nome}`, exact: true }).click();
  await resposta;
  await esperarAviso(page, "Registro removido.");
  await expect(linhaDaTabela(page, nome)).toHaveCount(0);
  expect(contarPorNome("clients", nome)).toBe(0);
});

test("CL7 excluir cliente faturado é recusado em português e nada muda", async ({ page }) => {
  // Cliente faturado pelo 20-seguranca ("Seg").
  const nome = `${P} Seg`;
  test.skip(
    Number(
      valor(`select count(*) from public.invoices i join public.clients c on c.id = i.client_id
              where c.name = ${lit(nome)}`),
    ) === 0,
    "depende do cliente faturado criado pelo 20-seguranca",
  );
  await abrirClientes(page);
  const resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${nome}`, exact: true }).click();
  await resposta;
  await esperarAviso(page, "Cliente com histórico faturado não pode ser excluído");
  expect(contarPorNome("clients", nome)).toBe(1);
});

test("CL8 excluir cliente com operação e apontamento não faturados: a confirmação diz o que some", async ({
  page,
}) => {
  const cli = `${C} Cascata`;
  const op = `${C} Op Cascata`;
  const pessoa = `${C} Ciro`;
  await criarCliente(page, cli);
  await criarColaborador(page, { nome: pessoa, custo: 150, desde: "2026-10-01" });
  await criarOperacao(page, {
    cliente: cli,
    nome: op,
    tipo: "Avulsa",
    valor: 200,
    data: "2026-10-05",
  });
  await criarTurno(page, {
    operacao: op,
    nome: TURNO,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: op, colaborador: pessoa, turno: TURNO });
  await lancarDia(page, {
    operacao: op,
    turno: TURNO,
    data: "2026-10-05",
    linhas: [{ colaborador: pessoa, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  expect(lancamento(op, pessoa, "2026-10-05")?.receita).toBe("200.00");

  await abrirClientes(page);
  const resposta = responderConfirmacao(page, false);
  await page.getByRole("button", { name: `Excluir ${cli}`, exact: true }).click();
  const texto = await resposta;
  // A exclusão do cliente leva junto (ON DELETE CASCADE) as operações, turnos, equipes e os
  // apontamentos ainda não faturados. A confirmação precisa dizer isso antes.
  expect(texto, `confirmação exibida: "${texto}"`).toMatch(/1 operaç/i);
  expect(texto).toMatch(/apontamento/i);
  expect(contarPorNome("clients", cli), "Cancelar não exclui").toBe(1);
});

// =============================================================================================
// CONTRATOS
// =============================================================================================

test("CT1 novo contrato: rótulos, obrigatórios e datas (fim antes do início e ano 0001 recusados)", async ({
  page,
}) => {
  await criarCliente(page, `${C} Datas`);
  await abrirContratos(page);
  await page.getByRole("button", { name: "Novo contrato" }).click();
  const d = dialogo(page);
  for (const rotulo of [
    "Nome do contrato",
    "Valor da diária (R$)",
    "Hora extra (fator)",
    "Tolerância antes da hora extra (min)",
    "Início do contrato",
    "Fim do contrato (opcional)",
  ]) {
    await expect(d.getByLabel(rotulo, { exact: true }), `rótulo "${rotulo}"`).toBeVisible();
  }
  const salvar = d.getByRole("button", { name: "Salvar contrato" });
  await escolher(page, campo(d, "Cliente"), `${C} Datas`);
  await expect(salvar, "sem nome").toBeDisabled();
  await campo(d, "Nome do contrato").fill(`${C} Contrato Datas`);
  await campo(d, "Valor da diária (R$)").fill("250");
  await campo(d, "Início do contrato").fill("2026-10-01");
  await expect(salvar).toBeEnabled();

  // Fim antes do início.
  await campo(d, "Fim do contrato (opcional)").fill("2026-09-30");
  await expect(salvar, "fim antes do início").toBeDisabled();
  await expect(d.getByText("O fim do contrato não pode ser antes do início.")).toBeVisible();

  // Ano 0001: o que um ano digitado pela metade produz no campo de data.
  await campo(d, "Fim do contrato (opcional)").fill("0001-01-01");
  await expect(salvar, "ano 0001").toBeDisabled();
  await campo(d, "Início do contrato").fill("0001-01-01");
  await campo(d, "Fim do contrato (opcional)").fill("");
  await expect(salvar, "início no ano 0001").toBeDisabled();

  await d.getByRole("button", { name: "Cancelar" }).click();
  expect(contratoNoBanco(`${C} Contrato Datas`)).toEqual([]);
});

test("CT2 duplo clique em “Salvar contrato” cria UM contrato e UMA vigência inicial", async ({
  page,
}) => {
  const nome = `${C} Contrato Duplo`;
  await abrirContratos(page);
  await page.getByRole("button", { name: "Novo contrato" }).click();
  const d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), `${C} Datas`);
  await campo(d, "Nome do contrato").fill(nome);
  await campo(d, "Valor da diária (R$)").fill("230");
  await campo(d, "Início do contrato").fill("2026-10-01");
  await d.getByRole("button", { name: "Salvar contrato" }).evaluate((botao: HTMLElement) => {
    botao.click();
    botao.click();
  });
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contratoNoBanco(nome).length, "contratos").toBe(1);
  expect(vigenciasDoContrato(nome).length, "vigências").toBe(1);
});

test("CN-A cliente → contrato → operação: relações persistidas e exibidas", async ({ page }) => {
  await criarContrato(page, { cliente: CLI_A, nome: CTR_A, diaria: 250, inicio: "2026-10-01" });
  const [ctr] = contratoNoBanco(CTR_A);
  expect(ctr).toMatchObject({ cliente: CLI_A, diaria: "250.00", inicio: "2026-10-01", fim: null });
  expect(vigenciasDoContrato(CTR_A), "vigência inicial = valores digitados").toEqual([
    { inicio: "2026-10-01", fim: null, diaria: "250.00" },
  ]);
  await abrirContratos(page);
  const tr = linhaDaTabela(page, CTR_A);
  await expect(tr).toContainText(CLI_A);
  await expect(tr).toContainText(reais(250));
  await expect(tr).toContainText("1,50x");
  await expect(tr).toContainText("10 min");
  await expect(tr).toContainText("01/10/2026 em diante");
  // Resolução comercial DESLIGADA (como na Production): sem botão de tarifas por função e a diária
  // genérica do contrato é o preço exibido.
  await expect(page.getByRole("button", { name: `Tarifas de ${CTR_A}` })).toHaveCount(0);
  await expect(tr).not.toContainText("Por função");

  await criarOperacao(page, { cliente: CLI_A, nome: OP_A, tipo: "Fixa", contrato: CTR_A });
  const [op] = consultar<{ cliente: string; contrato: string }>(
    `select cl.name as cliente, c.name as contrato from public.operations o
       join public.clients cl on cl.id = o.client_id join public.contracts c on c.id = o.contract_id
      where o.name = ${lit(OP_A)}`,
  );
  expect(op).toEqual({ cliente: CLI_A, contrato: CTR_A });
  await page.reload();
  await expect(cartaoDaOperacao(page, OP_A)).toContainText(CTR_A);
  await expect(cartaoDaOperacao(page, OP_A)).toContainText(CLI_A);

  // Com operação, o cliente do contrato não pode ser trocado.
  await abrirContratos(page);
  await page.getByRole("button", { name: `Editar ${CTR_A}`, exact: true }).click();
  const d = dialogo(page);
  await expect(campo(d, "Cliente")).toBeDisabled();
  await expect(d.getByText("Este contrato já é usado por operações")).toBeVisible();
  await d.getByRole("button", { name: "Cancelar" }).click();
});

test("CN-B alteração contratual: cada lançamento usa a condição da sua data", async ({ page }) => {
  await criarColaborador(page, { nome: ANA, custo: 150, desde: "2026-10-01" });
  await criarColaborador(page, { nome: BETO, custo: 150, desde: "2026-10-01" });
  await criarTurno(page, {
    operacao: OP_A,
    nome: TURNO,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: OP_A, colaborador: ANA, turno: TURNO });
  await alocar(page, { operacao: OP_A, colaborador: BETO, turno: TURNO });

  // Vigência A (250): lançamento em 05/10.
  await lancarDia(page, {
    operacao: OP_A,
    turno: TURNO,
    data: "2026-10-05",
    linhas: [{ colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });

  // "Alterar condições": 300 a partir de 08/10.
  await abrirContratos(page);
  await page.getByRole("button", { name: `Editar ${CTR_A}`, exact: true }).click();
  let d = dialogo(page);
  await expect(d.getByText("Condições do contrato", { exact: true })).toBeVisible();
  await expect(d).toContainText(/Valor atual:.*R\$\s?250,00/);
  await d.getByRole("button", { name: "Alterar condições" }).click();
  const alt = dialogo(page);
  await alt.locator("#valor-atual-inicio").fill("2026-10-08");
  await alt.locator("#valor-atual-daily_rate").fill("300");
  await alt.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(alt.getByRole("heading", { name: "Alterar condições" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");

  expect(vigenciasDoContrato(CTR_A)).toEqual([
    { inicio: "2026-10-01", fim: "2026-10-08", diaria: "250.00" },
    { inicio: "2026-10-08", fim: null, diaria: "300.00" },
  ]);

  // Vigência B: lançamento em 09/10.
  await lancarDia(page, {
    operacao: OP_A,
    turno: TURNO,
    data: "2026-10-09",
    linhas: [{ colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  expect(lancamento(OP_A, ANA, "2026-10-05")?.receita, "05/10 na vigência A").toBe("250.00");
  expect(snapshotDe(OP_A, ANA, "2026-10-05")).toBe("250.00");
  expect(lancamento(OP_A, ANA, "2026-10-09")?.receita, "09/10 na vigência B").toBe("300.00");
  expect(snapshotDe(OP_A, ANA, "2026-10-09")).toBe("300.00");

  // Lista: o valor de HOJE (300), não a coluna do cadastro.
  await abrirContratos(page);
  await expect(linhaDaTabela(page, CTR_A)).toContainText(reais(300));

  // Histórico mostra os dois períodos.
  await page.getByRole("button", { name: `Editar ${CTR_A}`, exact: true }).click();
  d = dialogo(page);
  await expect(d).toContainText(/Valor atual:.*R\$\s?300,00/);
  await d.getByText("Ver histórico").click();
  await expect(d).toContainText("01/10/2026");
  await expect(d).toContainText("08/10/2026");
  await d.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("CN-C alteração retroativa e cadastral: lançado fica congelado; nome novo segue para os módulos", async ({
  page,
}) => {
  // Dia 13/10 lançado na vigência B (300). Salvar o dia grava a equipe inteira do turno (Ana e
  // Beto): é o comportamento da tela de apontamento (CP-05), aqui só conferido.
  await lancarDia(page, {
    operacao: OP_A,
    turno: TURNO,
    data: "2026-10-13",
    linhas: [{ colaborador: BETO, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  expect(lancamento(OP_A, BETO, "2026-10-13")?.receita).toBe("300.00");
  expect(lancamento(OP_A, ANA, "2026-10-13")?.receita).toBe("300.00");

  async function alterarCondicoes(inicio: string, diaria: number) {
    await abrirContratos(page);
    await page.getByRole("button", { name: `Editar ${CTR_A}`, exact: true }).click();
    await dialogo(page).getByRole("button", { name: "Alterar condições" }).click();
    const alt = dialogo(page);
    await alt.locator("#valor-atual-inicio").fill(inicio);
    await alt.locator("#valor-atual-daily_rate").fill(String(diaria));
    await alt.getByRole("button", { name: "Salvar novo valor" }).click();
    return alt;
  }

  // Retroativo sobre dia já lançado: recusado, em português, e nada muda (protege o congelado).
  let alt = await alterarCondicoes("2026-10-13", 320);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Há apontamentos que usam esta versão" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(alt.getByRole("heading", { name: "Alterar condições" })).toBeVisible();
  await alt.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(vigenciasDoContrato(CTR_A).length, "nenhuma vigência nova").toBe(2);

  // A partir de um dia ainda sem lançamento: aceito.
  alt = await alterarCondicoes("2026-10-14", 320);
  await expect(alt.getByRole("heading", { name: "Alterar condições" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
  expect(vigenciasDoContrato(CTR_A)).toEqual([
    { inicio: "2026-10-01", fim: "2026-10-08", diaria: "250.00" },
    { inicio: "2026-10-08", fim: "2026-10-14", diaria: "300.00" },
    { inicio: "2026-10-14", fim: null, diaria: "320.00" },
  ]);

  // Congelado: o que já foi lançado mantém o valor e o snapshot.
  expect(lancamento(OP_A, BETO, "2026-10-13")?.receita, "13/10 continua 300").toBe("300.00");
  expect(snapshotDe(OP_A, BETO, "2026-10-13")).toBe("300.00");
  // Aplicado: um dia novo na vigência nova usa 320.
  await lancarDia(page, {
    operacao: OP_A,
    turno: TURNO,
    data: "2026-10-15",
    linhas: [{ colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  expect(lancamento(OP_A, ANA, "2026-10-15")?.receita, "15/10 na vigência C").toBe("320.00");
  expect(snapshotDe(OP_A, ANA, "2026-10-15")).toBe("320.00");

  // Exportado: o fechamento soma o congelado de cada dia, dois colaboradores por dia:
  // 05/10 2×250 + 09/10 2×300 + 13/10 2×300 + 15/10 2×320 = 2.340,00.
  await gerarFechamento(page, { cliente: CLI_A, mes: 10, ano: 2026 });
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(2340));

  // Dado cadastral: renomear o cliente não quebra contrato, operação nem fechamento.
  const novoNome = `${CLI_A} Renomeado`;
  await abrirClientes(page);
  await page.getByRole("button", { name: `Editar ${CLI_A}`, exact: true }).click();
  const d = dialogo(page);
  await campo(d, "Nome").fill(novoNome);
  await d.getByRole("button", { name: "Salvar cliente" }).click();
  await esperarAviso(page, "Registro salvo.");
  await abrirContratos(page);
  await expect(linhaDaTabela(page, CTR_A)).toContainText(novoNome);
  await page.goto("/operacoes");
  await expect(cartaoDaOperacao(page, OP_A)).toContainText(novoNome);
  await gerarFechamento(page, { cliente: novoNome, mes: 10, ano: 2026 });
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(2340));

  // Volta o nome para os casos seguintes.
  await abrirClientes(page);
  await page.getByRole("button", { name: `Editar ${novoNome}`, exact: true }).click();
  await campo(dialogo(page), "Nome").fill(CLI_A);
  await dialogo(page).getByRole("button", { name: "Salvar cliente" }).click();
  await esperarAviso(page, "Registro salvo.");
});

test("CV1 lista de contratos: sem os valores de hoje (erro ou carregando) não mostra o valor do cadastro como se fosse o atual", async ({
  page,
}) => {
  // A coluna do cadastro guarda o valor inicial (250); o de hoje é 320.
  expect(contratoNoBanco(CTR_A)[0]?.diaria).toBe("250.00");

  // Erro ao ler as vigências.
  await page.route("**/rest/v1/contract_terms**", (rota) => rota.abort("failed"));
  await abrirContratos(page);
  const tr = linhaDaTabela(page, CTR_A);
  await expect(tr).toBeVisible();
  // Enquanto o TanStack Query tenta de novo (3 vezes), "Carregando…"; esgotadas, "Indisponível".
  await expect(tr, "erro: não pode exibir o 250 do cadastro como valor atual").not.toContainText(
    reais(250),
  );
  await expect(tr).toContainText(/indisponível/i, { timeout: 60_000 });
  await expect(tr).not.toContainText(reais(250));
  await page.unroute("**/rest/v1/contract_terms**");

  // Carregando (resposta lenta).
  await page.route("**/rest/v1/contract_terms**", async (rota) => {
    await new Promise((r) => setTimeout(r, 4000));
    await rota.continue();
  });
  await abrirContratos(page);
  await expect(linhaDaTabela(page, CTR_A)).toBeVisible();
  await expect(linhaDaTabela(page, CTR_A), "carregando").not.toContainText(reais(250));
  await expect(linhaDaTabela(page, CTR_A)).toContainText(reais(320), { timeout: 20_000 });
  await page.unroute("**/rest/v1/contract_terms**");
});

// [RISCO] com decisão pendente (DEC-CP02-01 no documento do CP-02): o "Fim do contrato" não
// limita a vigência das condições, então um dia depois do fim é lançado e cobrado. Bloquear exige
// decidir a regra (e mexe no motor/contrato SQL): fica registrado como falha conhecida.
test(
  "CN-D [RISCO] contrato com fim: lançamento depois do fim do contrato é aceito e cobrado",
  {
    tag: "@falha-conhecida",
  },
  async ({ page }) => {
    // Fim do contrato em 20/10/2026 (edição comum do contrato).
    await abrirContratos(page);
    await page.getByRole("button", { name: `Editar ${CTR_A}`, exact: true }).click();
    const d = dialogo(page);
    await campo(d, "Fim do contrato (opcional)").fill("2026-10-20");
    await d.getByRole("button", { name: "Salvar contrato" }).click();
    await esperarAviso(page, "Registro salvo.");
    await esperarFechar(page);
    expect(contratoNoBanco(CTR_A)[0]?.fim).toBe("2026-10-20");
    await expect(linhaDaTabela(page, CTR_A)).toContainText("01/10/2026 até 20/10/2026");

    // A vigência das condições continua aberta: o fim do contrato não a limita.
    expect(vigenciasDoContrato(CTR_A).at(-1)?.fim, "vigência das condições").toBeNull();
    // Registro do comportamento atual: um dia DEPOIS do fim do contrato é lançado e cobrado.
    await lancarDia(page, {
      operacao: OP_A,
      turno: TURNO,
      data: "2026-10-22",
      linhas: [{ colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
    });
    expect(lancamento(OP_A, ANA, "2026-10-22")?.receita).toBe("320.00");
  },
);

test("CT3 excluir contrato: sem uso remove (com as vigências); usado em apontamento é recusado", async ({
  page,
}) => {
  const livre = `${C} Contrato Duplo`;
  await abrirContratos(page);
  let resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${livre}`, exact: true }).click();
  expect(await resposta).toContain(livre);
  await esperarAviso(page, "Registro removido.");
  expect(contratoNoBanco(livre)).toEqual([]);
  expect(vigenciasDoContrato(livre)).toEqual([]);

  resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${CTR_A}`, exact: true }).click();
  await resposta;
  const recusa = page.locator("[data-sonner-toast]").filter({ hasText: /não pode ser excluído/ });
  await expect(recusa).toBeVisible({ timeout: 20_000 });
  expect(await recusa.first().innerText()).not.toMatch(/violates|constraint|foreign key/i);
  expect(contratoNoBanco(CTR_A).length).toBe(1);
});

test("CL9 excluir cliente cujo contrato tem apontamento é recusado e nada some", async ({
  page,
}) => {
  const antes = Number(
    valor(`select count(*) from public.timesheet_entries te join public.operations o
              on o.id = te.operation_id where o.name = ${lit(OP_A)}`),
  );
  await abrirClientes(page);
  const resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${CLI_A}`, exact: true }).click();
  await resposta;
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: /não pode ser excluído/ }),
  ).toBeVisible({ timeout: 20_000 });
  expect(contarPorNome("clients", CLI_A)).toBe(1);
  expect(
    Number(
      valor(`select count(*) from public.timesheet_entries te join public.operations o
                on o.id = te.operation_id where o.name = ${lit(OP_A)}`),
    ),
  ).toBe(antes);
});

// =============================================================================================
// FERIADOS (aba Contratos e regras)
// =============================================================================================

test("FE1 feriado: data repetida é recusada; aposentar exige motivo e muda a situação", async ({
  page,
}) => {
  await abrirContratos(page);
  await page.getByRole("button", { name: "Novo feriado" }).click();
  let d = dialogo(page);
  await d.locator("#feriado-data").fill("2026-11-20");
  await d.locator("#feriado-nome").fill("Feriado CP02");
  const registrar = d.getByRole("button", { name: "Registrar feriado" });
  await expect(registrar, "motivo obrigatório").toBeDisabled();
  await d.locator("#feriado-motivo").fill("E2E CP-02");
  await registrar.click();
  await esperarFechar(page);
  const linha = linhaDaTabela(page, "Feriado CP02");
  await expect(linha).toContainText("20/11/2026");

  await page.getByRole("button", { name: "Novo feriado" }).click();
  d = dialogo(page);
  await d.locator("#feriado-data").fill("2026-11-20");
  await d.locator("#feriado-nome").fill("Repetido");
  await d.locator("#feriado-motivo").fill("E2E CP-02");
  await expect(d.getByRole("button", { name: "Registrar feriado" })).toBeDisabled();
  await d.getByRole("button", { name: "Cancelar" }).click();

  await linha.getByRole("button", { name: "Aposentar" }).click();
  d = dialogo(page);
  const aposentar = d.getByRole("button", { name: /Aposentar/ }).last();
  await expect(aposentar).toBeDisabled();
  await d.locator("#feriado-motivo-apos").fill("E2E CP-02: aposentado");
  await aposentar.click();
  await esperarFechar(page);
  await expect(linhaDaTabela(page, "Feriado CP02")).toContainText("Aposentado");
  expect(
    valor(`select active from public.financial_holidays where name = 'Feriado CP02'`),
    "aposentado",
  ).toBe(false);
});
