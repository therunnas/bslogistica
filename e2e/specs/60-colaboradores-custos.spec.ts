import type { Page } from "@playwright/test";

import { sessaoApi } from "../apoio/contas";
import { lancamento, lit } from "../apoio/banco";
import { consultar, estadoDe, expect, test, valor } from "../apoio/fixtures";
import {
  P,
  abrirColaborador,
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
  esperarFechar,
  gerarFechamento,
  lancarDia,
  reais,
  valorDoCartao,
} from "../apoio/telas";

/**
 * CP-03 — Colaboradores, funções, custos e vigências: cada ação da tela /colaboradores, o
 * "Alterar custo" (D2) e a passagem do CUSTO do colaborador para operação, apontamento,
 * fechamento e relatórios. Custo do colaborador NÃO é preço cobrado do cliente: cada conferência
 * diz qual dos dois está medindo.
 *
 * Em ordem (1 worker), NÃO serial. Dados próprios ("CP03"). Valores esperados calculados à mão:
 * 8 h = 1 diária; hora extra do CUSTO = custo ÷ 8 por hora, sem fator; hora extra da RECEITA =
 * diária ÷ 8 × 1,5 (regra conferida no 10-ciclo-completo).
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP03`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const OP = `${C} Op`;
const TURNO = "Diurno CP03";
const ZECA = `${C} Zeca`;
const LIA = `${C} Lia`;
const DORA = `${C} Dora`;
const AJUDANTE = "Ajudante CP03";
const CONFERENTE = "Conferente CP03";

async function abrirColaboradores(page: Page) {
  await page.goto("/colaboradores");
  await expect(page.getByRole("heading", { name: "Colaboradores", level: 1 })).toBeVisible();
}

function linha(page: Page, texto: string) {
  return page.locator("tr").filter({ hasText: texto }).first();
}

function contarColaboradores(nome: string): number {
  return Number(valor(`select count(*) from public.employees where name = ${lit(nome)}`));
}

function custosDe(nome: string) {
  return consultar<{ inicio: string; fim: string | null; custo: string }>(
    `select to_char(t.valid_from,'YYYY-MM-DD') as inicio, to_char(t.valid_to,'YYYY-MM-DD') as fim,
            t.daily_cost::numeric(12,2)::text as custo
       from public.employee_cost_terms t join public.employees e on e.id = t.employee_id
      where e.name = ${lit(nome)} and t.active order by t.valid_from`,
  );
}

function snapshot(nome: string, data: string) {
  return consultar<{ custo: string; versao: string; funcao: string | null }>(
    `select te.daily_cost_snapshot::numeric(12,2)::text as custo,
            to_char(t.valid_from,'YYYY-MM-DD') as versao, f.name as funcao
       from public.timesheet_entries te
       join public.employees e on e.id = te.employee_id
       join public.operations o on o.id = te.operation_id
       left join public.employee_cost_terms t on t.id = te.employee_cost_terms_id
       left join public.job_functions f on f.id = te.job_function_id_snapshot
      where o.name = ${lit(OP)} and e.name = ${lit(nome)} and te.work_date = ${lit(data)}`,
  )[0];
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

async function abrirAlterarCusto(page: Page, nome: string) {
  await abrirColaborador(page, nome);
  await dialogo(page).getByRole("button", { name: "Alterar custo" }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Alterar custo" })).toBeVisible();
  return d;
}

// =============================================================================================
// CADASTRO E FUNÇÕES
// =============================================================================================

test("FN1 catálogo de funções: cadastrar, nome repetido, Enter repetido, renomear, inativar e reativar", async ({
  page,
}) => {
  await abrirColaboradores(page);
  await page.getByRole("button", { name: /^Funções/ }).click();
  const d = dialogo(page);
  const nova = d.getByLabel("Nova função");
  await nova.fill(AJUDANTE);
  await nova.press("Enter");
  await nova.press("Enter");
  await expect(d.getByRole("cell", { name: AJUDANTE, exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(
    Number(valor(`select count(*) from public.job_functions where name = ${lit(AJUDANTE)}`)),
    "Enter repetido",
  ).toBe(1);

  await nova.fill("ajudante  cp03");
  await expect(d.getByText("Já existe uma função com este nome")).toBeVisible();
  await expect(d.getByRole("button", { name: "Cadastrar" })).toBeDisabled();

  await nova.fill("Conferente CP03 provisório");
  await d.getByRole("button", { name: "Cadastrar" }).click();
  const linhaF = d.locator("tr").filter({ hasText: "Conferente CP03 provisório" });
  await expect(linhaF).toBeVisible();
  await linhaF.getByRole("button", { name: "Renomear" }).click();
  await d.getByLabel("Novo nome de Conferente CP03 provisório").fill(CONFERENTE);
  await d.getByRole("button", { name: "Salvar nome" }).click();
  const linhaC = d.locator("tr").filter({ hasText: CONFERENTE });
  await expect(linhaC).toBeVisible();
  await linhaC.getByRole("button", { name: "Inativar" }).click();
  await expect(linhaC).toContainText("Inativa");
  await linhaC.getByRole("button", { name: "Reativar" }).click();
  await expect(linhaC).toContainText("Ativa");
  expect(valor(`select active from public.job_functions where name = ${lit(CONFERENTE)}`)).toBe(
    true,
  );
  await page.keyboard.press("Escape");
});

test("CB1 novo colaborador: rótulos, nome obrigatório (vazio e só espaços), custo inválido recusado", async ({
  page,
}) => {
  await abrirColaboradores(page);
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const d = dialogo(page);
  for (const rotulo of [
    "Nome",
    "Função",
    "Documento",
    "Telefone",
    "Custo por diária (R$)",
    "Custo vale a partir de",
    "Status",
  ]) {
    await expect(d.getByLabel(rotulo, { exact: true }), `rótulo "${rotulo}"`).toBeVisible();
  }
  const salvar = d.getByRole("button", { name: "Salvar colaborador" });
  await expect(salvar).toBeDisabled();
  await d.locator("#employee-name").fill("   ");
  await expect(salvar, "nome só com espaços").toBeDisabled();

  await d.locator("#employee-name").fill(`${C} Custo Inválido`);
  await d.locator("#employee-cost").fill("-10");
  await expect(salvar, "custo negativo").toBeDisabled();
  await expect(d.getByText("O custo por diária não pode ser negativo.")).toBeVisible();
  await d.getByRole("button", { name: "Cancelar" }).click();
  expect(contarColaboradores(`${C} Custo Inválido`)).toBe(0);
});

test("CB2 cadastrar: campos, função e custo inicial persistem; nome sem espaços nas pontas", async ({
  page,
}) => {
  await abrirColaboradores(page);
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const d = dialogo(page);
  await d.locator("#employee-name").fill(`  ${ZECA}  `);
  await escolher(page, d.locator("#employee-job-function"), AJUDANTE);
  await d.locator("#employee-doc").fill("123.456.789-00");
  await d.locator("#employee-phone").fill("(11) 90000-0000");
  await d.locator("#employee-cost").fill("150");
  await d.locator("#employee-cost-from").fill("2026-10-01");
  await d.getByRole("button", { name: "Salvar colaborador" }).click();
  await esperarFechar(page);

  const [e] = consultar<Record<string, string>>(
    `select e.name, e.doc, e.phone, e.status::text as status, f.name as funcao,
            e.daily_cost::numeric(12,2)::text as coluna
       from public.employees e left join public.job_functions f on f.id = e.job_function_id
      where e.name like ${lit(`%${ZECA}%`)}`,
  );
  expect(e, "o nome é gravado sem os espaços das pontas").toEqual({
    name: ZECA,
    doc: "123.456.789-00",
    phone: "(11) 90000-0000",
    status: "active",
    funcao: AJUDANTE,
    coluna: "150.00",
  });
  expect(custosDe(ZECA), "vigência inicial do custo").toEqual([
    { inicio: "2026-10-01", fim: null, custo: "150.00" },
  ]);
  await page.reload();
  const tr = linha(page, ZECA);
  await expect(tr).toContainText(AJUDANTE);
  await expect(tr).toContainText(reais(150));
  await expect(tr).toContainText("Ativo");
});

test("CB3 duplo clique e Enter repetido em “Salvar colaborador” criam UM colaborador", async ({
  page,
}) => {
  const nome = `${C} Duplo`;
  await abrirColaboradores(page);
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  let d = dialogo(page);
  await d.locator("#employee-name").fill(nome);
  await d.locator("#employee-cost").fill("150");
  await d.locator("#employee-cost-from").fill("2026-10-01");
  await d.getByRole("button", { name: "Salvar colaborador" }).evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contarColaboradores(nome), "duplo clique").toBe(1);
  expect(custosDe(nome).length, "uma vigência inicial").toBe(1);

  const nomeEnter = `${C} Enter`;
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  d = dialogo(page);
  await d.locator("#employee-name").fill(nomeEnter);
  await d.locator("#employee-cost").fill("150");
  await d.locator("#employee-cost-from").fill("2026-10-01");
  await d.getByRole("button", { name: "Salvar colaborador" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await esperarFechar(page);
  await page.waitForTimeout(1500);
  expect(contarColaboradores(nomeEnter), "Enter repetido").toBe(1);
});

test("CB4 falha de rede ao cadastrar: português, nada gravado, nova tentativa grava uma vez", async ({
  page,
}) => {
  const nome = `${C} Rede`;
  await abrirColaboradores(page);
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const d = dialogo(page);
  await d.locator("#employee-name").fill(nome);
  await d.locator("#employee-cost").fill("150");
  await d.locator("#employee-cost-from").fill("2026-10-01");
  await page.route("**/rest/v1/rpc/**", (rota) => rota.abort("failed"));
  await d.getByRole("button", { name: "Salvar colaborador" }).click();
  const aviso = page.locator("[data-sonner-toast]").first();
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  const texto = (await aviso.innerText()).trim();
  expect(texto, `aviso exibido: "${texto}"`).not.toMatch(/failed|fetch|network|error/i);
  await expect(d).toBeVisible();
  expect(contarColaboradores(nome)).toBe(0);
  await page.unroute("**/rest/v1/rpc/**");
  await d.getByRole("button", { name: "Salvar colaborador" }).click();
  await esperarFechar(page);
  expect(contarColaboradores(nome)).toBe(1);
});

test("CB5 editar: dados e situação persistem; com o motor ligado o custo só muda por “Alterar custo”", async ({
  page,
}) => {
  await criarColaborador(page, { nome: `${C} Editar`, custo: 150, desde: "2026-10-01" });
  await abrirColaboradores(page);
  await expect(linha(page, `${C} Editar`)).toBeVisible();
  const inativosAntes = Number(await valorDoCartao(page, "Inativos").innerText());
  await page.getByRole("button", { name: `Editar ${C} Editar`, exact: true }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Editar colaborador" })).toBeVisible();
  await expect(d.locator("#employee-cost"), "custo travado: muda por vigência").toHaveCount(0);
  await expect(d.getByText("Custo do colaborador", { exact: true })).toBeVisible();
  await d.locator("#employee-phone").fill("(11) 98888-7777");
  await escolher(page, d.getByLabel("Status", { exact: true }), "Inativo");
  await d.getByRole("button", { name: "Salvar colaborador" }).click();
  await esperarAviso(page, "Registro salvo.");
  await esperarFechar(page);
  await page.reload();
  await expect(linha(page, `${C} Editar`)).toContainText("(11) 98888-7777");
  await expect(linha(page, `${C} Editar`)).toContainText("Inativo");
  await expect(valorDoCartao(page, "Inativos")).toHaveText(String(inativosAntes + 1));
  expect(custosDe(`${C} Editar`), "editar dados não mexe no custo").toEqual([
    { inicio: "2026-10-01", fim: null, custo: "150.00" },
  ]);
});

// =============================================================================================
// D2 — "ALTERAR CUSTO"
// =============================================================================================

test("D2 “Alterar custo”: o valor digitado não se perde ao trocar a data (várias vezes)", async ({
  page,
}) => {
  await criarColaborador(page, { nome: DORA, custo: 150, desde: "2026-10-01" });
  const d = await abrirAlterarCusto(page, DORA);
  const custo = d.locator("#valor-atual-daily_cost");
  const inicio = d.locator("#valor-atual-inicio");
  await expect(custo).toHaveValue(/^150(\.0+)?$/);
  await custo.fill("199");
  // Data de um valor já existente (vira "corrigir"): o aviso mostra o valor antigo, o campo mantém
  // o digitado.
  await inicio.fill("2026-10-01");
  await expect(custo, "data igual à do valor existente").toHaveValue("199");
  await expect(d.getByText(/Já existe um valor começando nesta data/)).toBeVisible();
  // Data antes do primeiro valor (vira "antecipar").
  await inicio.fill("2026-09-20");
  await expect(custo, "data antes do primeiro valor").toHaveValue("199");
  // Data nova (vira "novo valor").
  await inicio.fill("2026-10-20");
  await expect(custo, "data nova").toHaveValue("199");
  await expect(d.getByRole("button", { name: "Salvar novo valor" })).toBeEnabled();

  // Cancelar e reabrir: o formulário volta ao valor de hoje e à data de hoje.
  await d.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialogo(page).getByRole("button", { name: "Alterar custo" }).click();
  const d2 = dialogo(page);
  await expect(d2.locator("#valor-atual-daily_cost")).toHaveValue(/^150(\.0+)?$/);
  await expect(d2.locator("#valor-atual-inicio")).not.toHaveValue("2026-10-20");
  await d2.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(custosDe(DORA), "nada gravado").toEqual([
    { inicio: "2026-10-01", fim: null, custo: "150.00" },
  ]);
});

test("D2b “Alterar custo”: erro de rede preserva o digitado; nova tentativa e duplo clique gravam UMA vez", async ({
  page,
}) => {
  const d = await abrirAlterarCusto(page, DORA);
  await d.locator("#valor-atual-inicio").fill("2026-10-20");
  await d.locator("#valor-atual-daily_cost").fill("199");

  await page.route("**/rest/v1/rpc/**", (rota) => rota.abort("failed"));
  await d.getByRole("button", { name: "Salvar novo valor" }).click();
  const aviso = page.locator("[data-sonner-toast]").first();
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  const texto = (await aviso.innerText()).trim();
  expect(texto, `aviso exibido: "${texto}"`).not.toMatch(/failed|fetch|network|error/i);
  await expect(d.locator("#valor-atual-daily_cost"), "o digitado continua").toHaveValue("199");
  await expect(d.locator("#valor-atual-inicio")).toHaveValue("2026-10-20");
  await page.unroute("**/rest/v1/rpc/**");

  // Nova tentativa com duplo clique: uma versão, sem aviso de erro.
  await d.getByRole("button", { name: "Salvar novo valor" }).evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await expect(d.getByRole("heading", { name: "Alterar custo" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: /sobrepõe|erro|não foi possível/i }),
  ).toHaveCount(0);
  expect(custosDe(DORA), "persistido no banco").toEqual([
    { inicio: "2026-10-01", fim: "2026-10-20", custo: "150.00" },
    { inicio: "2026-10-20", fim: null, custo: "199.00" },
  ]);
  // Exibido depois de recarregar: hoje (12/11) vale 199.
  await abrirColaboradores(page);
  await expect(linha(page, DORA)).toContainText(reais(199));
});

// =============================================================================================
// VALORES DE HOJE (lista)
// =============================================================================================

test("VH1 lista: erro ou lentidão ao ler os custos não mostra o custo do cadastro como atual", async ({
  page,
}) => {
  // A coluna do cadastro ficou em 150; o custo de hoje é 199.
  expect(
    valor(`select daily_cost::numeric(12,2)::text from public.employees where name = ${lit(DORA)}`),
  ).toBe("150.00");
  await page.route("**/rest/v1/employee_cost_terms**", (rota) => rota.abort("failed"));
  await abrirColaboradores(page);
  const tr = linha(page, DORA);
  await expect(tr).toBeVisible();
  await expect(tr, "nunca o 150 do cadastro").not.toContainText(reais(150));
  await expect(tr).toContainText(/indisponível/i, { timeout: 60_000 });
  await expect(tr).not.toContainText(reais(150));
  await expect(valorDoCartao(page, "Custo médio")).toHaveText(/indisponível/i);
  await page.unroute("**/rest/v1/employee_cost_terms**");

  await page.route("**/rest/v1/employee_cost_terms**", async (rota) => {
    await new Promise((r) => setTimeout(r, 4000));
    await rota.continue();
  });
  await abrirColaboradores(page);
  await expect(linha(page, DORA)).toBeVisible();
  await expect(linha(page, DORA), "carregando").not.toContainText(reais(150));
  await expect(linha(page, DORA)).toContainText(reais(199), { timeout: 20_000 });
  await page.unroute("**/rest/v1/employee_cost_terms**");
});

test("VH2 escala: com 300 colaboradores a lista continua mostrando o custo de hoje", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // 300 cadastros sintéticos sem custo (custo 0 dispensa vigência), pela API com a sessão do admin.
  const api = await sessaoApi("ADMIN");
  const linhas = Array.from({ length: 300 }, (_, i) => ({
    name: `${C} Escala ${String(i + 1).padStart(3, "0")}`,
    daily_cost: 0,
    status: "active",
  }));
  const { data: criados, error } = await api.from("employees").insert(linhas).select("id");
  expect(error, "inserção dos 300").toBeNull();
  expect(criados?.length).toBe(300);
  try {
    // A consulta dos custos de hoje leva todos os IDs da lista (mais de 300).
    const respostas: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/rest/v1/employee_cost_terms")) respostas.push(r.status());
    });
    await abrirColaboradores(page);
    await expect(linha(page, `${C} Escala 300`)).toBeVisible({ timeout: 30_000 });
    await expect(linha(page, DORA)).toContainText(reais(199), { timeout: 60_000 });
    expect(
      respostas.filter((s) => s >= 400),
      `respostas com erro: ${respostas.join(",")}`,
    ).toEqual([]);
  } finally {
    const ids = (criados ?? []).map((c) => c.id as string);
    for (let i = 0; i < ids.length; i += 100) {
      await api
        .from("employees")
        .delete()
        .in("id", ids.slice(i, i + 100));
    }
    await api.auth.signOut({ scope: "local" });
  }
  expect(
    Number(valor(`select count(*) from public.employees where name like ${lit(`${C} Escala %`)}`)),
  ).toBe(0);
});

// =============================================================================================
// INTEGRAÇÃO FINANCEIRA
// =============================================================================================

test("CN-A custo inicial: cadastro 150 → equipe → apontamento → fechamento → relatório", async ({
  page,
}) => {
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: 250, inicio: "2026-10-01" });
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, {
    operacao: OP,
    nome: TURNO,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: OP, colaborador: ZECA, turno: TURNO });
  await lancarDia(page, {
    operacao: OP,
    turno: TURNO,
    data: "2026-10-05",
    linhas: [{ colaborador: ZECA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  const l = lancamento(OP, ZECA, "2026-10-05");
  expect(l, "custo aplicado ≠ receita").toMatchObject({ receita: "250.00", custo: "150.00" });
  expect(snapshot(ZECA, "2026-10-05")).toEqual({
    custo: "150.00",
    versao: "2026-10-01",
    funcao: AJUDANTE,
  });
  await gerarFechamento(page, { cliente: CLI, mes: 10, ano: 2026 });
  await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(150));
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(250));
});

test("CN-B reajuste 150 → 250: cada dia usa o custo da sua data; hora extra pelo custo vigente", async ({
  page,
}) => {
  // Lançamento ANTES do reajuste.
  await lancarDia(page, {
    operacao: OP,
    turno: TURNO,
    data: "2026-10-07",
    linhas: [{ colaborador: ZECA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  // Reajuste a partir de 08/10 pela tela.
  const d = await abrirAlterarCusto(page, ZECA);
  await d.locator("#valor-atual-inicio").fill("2026-10-08");
  await d.locator("#valor-atual-daily_cost").fill("250");
  await d.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(d.getByRole("heading", { name: "Alterar custo" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
  expect(custosDe(ZECA)).toEqual([
    { inicio: "2026-10-01", fim: "2026-10-08", custo: "150.00" },
    { inicio: "2026-10-08", fim: null, custo: "250.00" },
  ]);
  // Lançamentos DEPOIS: 8 h e 10 h (2 h extras).
  await lancarDia(page, {
    operacao: OP,
    turno: TURNO,
    data: "2026-10-09",
    linhas: [{ colaborador: ZECA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  await lancarDia(page, {
    operacao: OP,
    turno: TURNO,
    data: "2026-10-13",
    linhas: [{ colaborador: ZECA, entrada: "08:00", saida: "19:00", intervalo: 60 }],
  });
  expect(lancamento(OP, ZECA, "2026-10-07")?.custo, "07/10: antes do reajuste").toBe("150.00");
  expect(snapshot(ZECA, "2026-10-07")?.versao).toBe("2026-10-01");
  expect(lancamento(OP, ZECA, "2026-10-09")?.custo, "09/10: depois").toBe("250.00");
  expect(snapshot(ZECA, "2026-10-09")).toMatchObject({ custo: "250.00", versao: "2026-10-08" });
  // 10 h: custo 250 + 2 h × 250/8 = 312,50; receita 250 + 2 h × 250/8 × 1,5 = 343,75.
  expect(lancamento(OP, ZECA, "2026-10-13")).toMatchObject({ custo: "312.50", receita: "343.75" });
  // O 05/10 (lançado antes de tudo) continua 150.
  expect(lancamento(OP, ZECA, "2026-10-05")?.custo).toBe("150.00");
  // Lista: custo de hoje.
  await abrirColaboradores(page);
  await expect(linha(page, ZECA)).toContainText(reais(250));
});

test("CN-C alteração retroativa sobre dias lançados é recusada; posterior não reescreve o passado", async ({
  page,
}) => {
  let d = await abrirAlterarCusto(page, ZECA);
  await d.locator("#valor-atual-inicio").fill("2026-10-09");
  await d.locator("#valor-atual-daily_cost").fill("270");
  await d.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Há apontamentos que usam esta versão" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(d.locator("#valor-atual-daily_cost"), "o digitado continua").toHaveValue("270");
  await d.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(custosDe(ZECA).length, "nada novo").toBe(2);

  d = await abrirAlterarCusto(page, ZECA);
  await d.locator("#valor-atual-inicio").fill("2026-10-14");
  await d.locator("#valor-atual-daily_cost").fill("270");
  await d.getByRole("button", { name: "Salvar novo valor" }).click();
  await expect(d.getByRole("heading", { name: "Alterar custo" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
  expect(custosDe(ZECA)).toEqual([
    { inicio: "2026-10-01", fim: "2026-10-08", custo: "150.00" },
    { inicio: "2026-10-08", fim: "2026-10-14", custo: "250.00" },
    { inicio: "2026-10-14", fim: null, custo: "270.00" },
  ]);
  for (const [data, custo] of [
    ["2026-10-05", "150.00"],
    ["2026-10-07", "150.00"],
    ["2026-10-09", "250.00"],
    ["2026-10-13", "312.50"],
  ] as const) {
    expect(lancamento(OP, ZECA, data)?.custo, `${data} não é reescrito`).toBe(custo);
  }
});

test("CN-D dois profissionais com custos diferentes: custo individual, total do dia, período e relatório", async ({
  page,
}) => {
  await criarColaborador(page, { nome: LIA, custo: 180, desde: "2026-10-01" });
  await alocar(page, { operacao: OP, colaborador: LIA, turno: TURNO });
  await lancarDia(page, {
    operacao: OP,
    turno: TURNO,
    data: "2026-10-15",
    linhas: [
      { colaborador: ZECA, entrada: "08:00", saida: "17:00", intervalo: 60 },
      { colaborador: LIA, entrada: "08:00", saida: "17:00", intervalo: 60 },
    ],
  });
  expect(lancamento(OP, ZECA, "2026-10-15")).toMatchObject({ custo: "270.00", receita: "250.00" });
  expect(lancamento(OP, LIA, "2026-10-15")).toMatchObject({ custo: "180.00", receita: "250.00" });
  const dia = consultar<{ n: number; custo: string; receita: string }>(
    `select count(*)::int as n, sum(te.cost_amount)::numeric(12,2)::text as custo,
            sum(te.billed_amount)::numeric(12,2)::text as receita
       from public.timesheet_entries te join public.operations o on o.id = te.operation_id
      where o.name = ${lit(OP)} and te.work_date = '2026-10-15'`,
  )[0];
  expect(dia, "dia 15/10: dois lançamentos, sem duplicidade").toEqual({
    n: 2,
    custo: "450.00",
    receita: "500.00",
  });

  // Período 01–15/10: custo Zeca 150+150+250+312,50+270 = 1.132,50; Lia 180 → 1.312,50.
  // Receita: 250+250+250+343,75+250+250 = 1.593,75.
  await gerarFechamento(page, { cliente: CLI, mes: 10, ano: 2026 });
  await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(1312.5));
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(1593.75));

  // Relatório por colaborador (todas as operações do período): Zeca e Lia só trabalharam aqui.
  await page.goto("/relatorios");
  await campo(page, "De").fill("2026-10-01");
  await campo(page, "Até").fill("2026-10-15");
  await expect(linha(page, ZECA)).toContainText(reais(1132.5), { timeout: 30_000 });
  await expect(linha(page, LIA)).toContainText(reais(180));
});

test("CN-E trocar a função profissional não muda o custo nem a função de trabalho já alocada", async ({
  page,
}) => {
  await abrirColaboradores(page);
  await page.getByRole("button", { name: `Editar ${ZECA}`, exact: true }).click();
  const d = dialogo(page);
  await escolher(page, d.locator("#employee-job-function"), CONFERENTE);
  await d.getByRole("button", { name: "Salvar colaborador" }).click();
  await esperarAviso(page, "Registro salvo.");
  await esperarFechar(page);
  await lancarDia(page, {
    operacao: OP,
    turno: TURNO,
    data: "2026-10-16",
    linhas: [{ colaborador: ZECA, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  // O custo é o da vigência da data, qualquer que seja a função. A função gravada no lançamento é a
  // da ALOCAÇÃO na equipe da operação (função de trabalho, copiada na alocação), não a função
  // profissional do cadastro: trocar a do cadastro não reescreve alocações já feitas (CP-04).
  expect(
    valor(`select f.name from public.employees e join public.job_functions f
             on f.id = e.job_function_id where e.name = ${lit(ZECA)}`),
    "função profissional trocada no cadastro",
  ).toBe(CONFERENTE);
  expect(snapshot(ZECA, "2026-10-16"), "custo da vigência; função da alocação").toEqual({
    custo: "270.00",
    versao: "2026-10-14",
    funcao: AJUDANTE,
  });
  expect(snapshot(ZECA, "2026-10-05")?.funcao).toBe(AJUDANTE);
  expect(custosDe(ZECA).length, "nenhuma vigência nova").toBe(3);
});

test("CB6 excluir: com apontamento é recusado em português; sem dependência remove", async ({
  page,
}) => {
  await abrirColaboradores(page);
  let resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${ZECA}`, exact: true }).click();
  await resposta;
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Exclusão recusada" }),
  ).toBeVisible({ timeout: 20_000 });
  expect(contarColaboradores(ZECA)).toBe(1);

  resposta = responderConfirmacao(page, false);
  await page.getByRole("button", { name: `Excluir ${C} Enter`, exact: true }).click();
  await resposta;
  expect(contarColaboradores(`${C} Enter`), "Cancelar mantém").toBe(1);
  resposta = responderConfirmacao(page, true);
  await page.getByRole("button", { name: `Excluir ${C} Enter`, exact: true }).click();
  await resposta;
  // O aviso anterior (recusa) pode continuar na tela: espera o aviso desta exclusão.
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Registro removido." }),
  ).toBeVisible({ timeout: 20_000 });
  expect(contarColaboradores(`${C} Enter`)).toBe(0);
});
