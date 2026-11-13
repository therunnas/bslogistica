import type { Page } from "@playwright/test";

import { linhasDoCsv } from "../apoio/arquivos";
import { contarPorNome, lit } from "../apoio/banco";
import { consultar, estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirFaturamento,
  alocar,
  campo,
  cartaoDaOperacao,
  criarCliente,
  criarColaborador,
  criarContrato,
  criarOperacao,
  criarTurno,
  descricaoDoCartao,
  dialogo,
  escolher,
  esperarAviso,
  lancarDia,
  valorDoCartao,
} from "../apoio/telas";

const C = `${P} CP09`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const CTR_FUT = `${C} Futuro Contrato`;
const OP = `${C} Op`;
const DIA = "Dia CP09";
const ANA = `${C} Ana`;
const CLI_DESC = `${C} Cliente Descartável`;
const CTR_DESC = `${C} Descartável Contrato`;
const COL_DESC = `${C} Colaborador Descartável`;
const OP_DESC = `${C} Op Descartável`;
const TURNO_DESC = "Turno Descartável CP09";

/**
 * CP-09 — Interface, clareza e consistência. Auditoria automática (rolagem horizontal, botões sem
 * nome acessível, campos sem rótulo, diálogos maiores que a tela) em todas as telas do painel, nos
 * tamanhos de celular, tablet e notebook, mais os casos de D8, R-CP07-06 e R-CP08-01..03.
 */

const VIEWPORTS = [
  { nome: "celular", width: 390, height: 844 },
  { nome: "tablet", width: 768, height: 1024 },
  { nome: "notebook", width: 1366, height: 768 },
] as const;

const ROTAS_ADMIN = [
  "/dashboard",
  "/clientes",
  "/colaboradores",
  "/operacoes",
  "/apontamentos",
  "/fechamento",
  "/faturamento",
  "/relatorios",
  "/usuarios",
  "/configuracoes",
  "/implantacao-vigencias",
];

/** Problemas de interface medidos no DOM da página aberta. */
async function auditar(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problemas: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth - doc.clientWidth > 1) {
      problemas.push(`rolagem horizontal da página: ${doc.scrollWidth}px em ${doc.clientWidth}px`);
    }
    const visivel = (el: Element) => {
      // Elementos ocultos da tecnologia assistiva (ex.: o <select> nativo que o Radix gera para
      // formulários) não são campos da pessoa.
      if (el.closest("[aria-hidden=true]")) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const nomeDe = (el: Element) => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const ids = el.getAttribute("aria-labelledby");
      if (ids) {
        const t = ids
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (t) return t;
      }
      const texto = (el as HTMLElement).innerText?.trim();
      if (texto) return texto;
      return el.getAttribute("title")?.trim() ?? "";
    };
    for (const b of document.querySelectorAll("button, [role=button], a[href]")) {
      if (!visivel(b)) continue;
      if (!nomeDe(b)) {
        const onde = (b as HTMLElement).outerHTML.slice(0, 120);
        problemas.push(`ação sem nome acessível: ${onde}`);
      }
    }
    for (const c of document.querySelectorAll(
      "input:not([type=hidden]), select, textarea, [role=combobox]",
    )) {
      if (!visivel(c)) continue;
      const id = c.getAttribute("id");
      const temLabel =
        Boolean(c.getAttribute("aria-label")?.trim()) ||
        Boolean(c.getAttribute("aria-labelledby")) ||
        Boolean(c.closest("label")) ||
        Boolean(id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        Boolean(c.getAttribute("title")?.trim());
      if (!temLabel) {
        problemas.push(`campo sem rótulo: ${(c as HTMLElement).outerHTML.slice(0, 120)}`);
      }
    }
    for (const d of document.querySelectorAll("[role=dialog], [role=alertdialog]")) {
      if (!visivel(d)) continue;
      const r = d.getBoundingClientRect();
      if (r.right - r.left > window.innerWidth + 1) {
        problemas.push(`diálogo mais largo que a tela: ${Math.round(r.width)}px`);
      }
    }
    return problemas;
  });
}

// =============================================================================================
// PREPARAÇÃO (dados próprios; julho a setembro de 2027, que nenhum outro arquivo usa)
// =============================================================================================

test("PR preparação: cliente, contratos (um com início futuro), operação, turno, colaboradora e descartáveis", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const contexto = await browser.newContext({ storageState: estadoDe("admin") });
  const page = await contexto.newPage();
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: 240, inicio: "2027-06-01" });
  await criarContrato(page, { cliente: CLI, nome: CTR_FUT, diaria: 240, inicio: "2027-08-01" });
  await criarColaborador(page, { nome: ANA, custo: 150, desde: "2027-06-01" });
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, { operacao: OP, nome: DIA, inicio: "08:00", fim: "17:00", intervalo: 60 });
  await alocar(page, { operacao: OP, colaborador: ANA, turno: DIA });
  // Descartáveis, sem dependência, para o D8.
  await criarCliente(page, CLI_DESC);
  await criarContrato(page, { cliente: CLI, nome: CTR_DESC, diaria: 200, inicio: "2027-06-01" });
  await criarColaborador(page, { nome: COL_DESC, custo: 100, desde: "2027-06-01" });
  await criarOperacao(page, {
    cliente: CLI,
    nome: OP_DESC,
    tipo: "Avulsa",
    valor: 200,
    data: "2027-06-01",
  });
  await criarTurno(page, {
    operacao: OP_DESC,
    nome: TURNO_DESC,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await contexto.close();
});

test.describe("AU auditoria automática das telas do painel (admin)", () => {
  test.use({ storageState: estadoDe("admin") });
  for (const vp of VIEWPORTS) {
    test(`AU ${vp.nome} ${vp.width}px: sem rolagem lateral, ações e campos com nome`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const achados: string[] = [];
      for (const rota of ROTAS_ADMIN) {
        await page.goto(rota);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
          timeout: 30_000,
        });
        await page.waitForLoadState("networkidle").catch(() => {});
        for (const p of await auditar(page)) achados.push(`${rota}: ${p}`);
      }
      expect(achados, achados.join("\n")).toEqual([]);
    });
  }
});

const DIALOGOS: { rota: string; aba?: string; botao: string }[] = [
  { rota: "/clientes", botao: "Novo cliente" },
  { rota: "/clientes", aba: "Contratos e regras", botao: "Novo contrato" },
  { rota: "/colaboradores", botao: "Novo colaborador" },
  { rota: "/operacoes", botao: "Nova operação" },
  { rota: "/faturamento", botao: "Novo adicional" },
];

test.describe("AU auditoria automática dos diálogos de cadastro", () => {
  test.use({ storageState: estadoDe("admin") });
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`AU diálogos ${vp.nome} ${vp.width}px: cabem na tela, campos com rótulo`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const achados: string[] = [];
      for (const d of DIALOGOS) {
        await page.goto(d.rota);
        if (d.aba) await page.getByRole("tab", { name: d.aba }).click();
        const botao = page.getByRole("button", { name: d.botao });
        await expect(botao).toBeEnabled({ timeout: 30_000 });
        await botao.click();
        const dialogo = page.getByRole("dialog").last();
        await expect(dialogo).toBeVisible();
        for (const p of await auditar(page)) achados.push(`${d.rota} · ${d.botao}: ${p}`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      expect(achados, achados.join("\n")).toEqual([]);
    });
  }
});

test.describe("AU auditoria automática das telas de acesso e do operador", () => {
  for (const vp of VIEWPORTS) {
    test(`AU acesso ${vp.nome} ${vp.width}px: login e recuperação`, async ({ browser }) => {
      const contexto = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await contexto.newPage();
      const achados: string[] = [];
      for (const rota of ["/login", "/esqueci-senha"]) {
        await page.goto(rota);
        await expect(page.locator("form").first()).toBeVisible({ timeout: 30_000 });
        for (const p of await auditar(page)) achados.push(`${rota}: ${p}`);
      }
      await contexto.close();
      expect(achados, achados.join("\n")).toEqual([]);
    });
  }

  test("AU operador 390px: tela operacional", async ({ browser }) => {
    const contexto = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: estadoDe("operacional"),
    });
    const page = await contexto.newPage();
    await page.goto("/operacional");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    const achados = (await auditar(page)).map((p) => `/operacional: ${p}`);
    await contexto.close();
    expect(achados, achados.join("\n")).toEqual([]);
  });
});

// =============================================================================================
// D8 — CONFIRMAÇÕES DE EXCLUSÃO (sem window.confirm)
// =============================================================================================

function existe(tabela: "contracts" | "operations", nome: string): number {
  return consultar<{ n: number }>(
    `select count(*)::int as n from public.${tabela} where name = ${lit(nome)}`,
  )[0]!.n;
}

/** Cancela e depois confirma a exclusão pelo diálogo da tela; nenhum diálogo nativo pode abrir. */
async function excluirPeloDialogo(
  page: Page,
  botao: string,
  nome: string,
  contar: () => number,
  consequencia?: RegExp,
) {
  let nativo = false;
  const ouvinte = (d: { dismiss: () => Promise<void> }) => {
    nativo = true;
    void d.dismiss();
  };
  page.on("dialog", ouvinte);
  await page.getByRole("button", { name: botao, exact: true }).click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao.getByRole("heading", { name: /^Excluir / })).toBeVisible();
  await expect(confirmacao).toContainText(nome);
  await expect(confirmacao).toContainText("não pode ser desfeita");
  if (consequencia) await expect(confirmacao).toContainText(consequencia);
  // O foco começa em "Cancelar": Enter sem querer não apaga.
  await expect(confirmacao.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(contar(), `${nome} continua depois de cancelar`).toBe(1);
  await page.getByRole("button", { name: botao, exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await esperarAviso(page, "Registro removido.");
  expect(contar(), `${nome} removido`).toBe(0);
  page.off("dialog", ouvinte);
  expect(nativo, "nenhum window.confirm").toBe(false);
}

test.describe("D8 confirmações de exclusão", () => {
  test.use({ storageState: estadoDe("admin") });

  test("D8 turno, operação, colaborador, contrato e cliente: diálogo da tela, foco em Cancelar, cancelar mantém, confirmar remove", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/operacoes");
    await expect(cartaoDaOperacao(page, OP_DESC)).toBeVisible({ timeout: 30_000 });
    await excluirPeloDialogo(page, `Excluir turno ${TURNO_DESC}`, TURNO_DESC, () =>
      contarPorNome("shifts", TURNO_DESC),
    );
    await excluirPeloDialogo(page, `Excluir ${OP_DESC}`, OP_DESC, () =>
      existe("operations", OP_DESC),
    );
    await page.goto("/colaboradores");
    await excluirPeloDialogo(page, `Excluir ${COL_DESC}`, COL_DESC, () =>
      contarPorNome("employees", COL_DESC),
    );
    await page.goto("/clientes");
    await page.getByRole("tab", { name: "Contratos e regras" }).click();
    await excluirPeloDialogo(page, `Excluir ${CTR_DESC}`, CTR_DESC, () =>
      existe("contracts", CTR_DESC),
    );
    await page.goto("/clientes");
    await excluirPeloDialogo(page, `Excluir ${CLI_DESC}`, CLI_DESC, () =>
      contarPorNome("clients", CLI_DESC),
    );
  });

  test("D8b cliente com contratos e operações: a confirmação diz o que some junto", async ({
    page,
  }) => {
    await page.goto("/clientes");
    await page.getByRole("button", { name: `Excluir ${CLI}`, exact: true }).click();
    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao).toContainText(/contrato/i);
    await expect(confirmacao).toContainText(/opera/i);
    await confirmacao.getByRole("button", { name: "Cancelar" }).click();
    expect(contarPorNome("clients", CLI)).toBe(1);
  });
});

// =============================================================================================
// R-CP07-06 — CONTRATO COM PRIMEIRA VERSÃO FUTURA
// =============================================================================================

function versoesDoContrato(nome: string) {
  return consultar<{ inicio: string; fim: string | null; diaria: string }>(`
    select to_char(t.valid_from,'YYYY-MM-DD') as inicio, to_char(t.valid_to,'YYYY-MM-DD') as fim,
           t.daily_rate::numeric(12,2)::text as diaria
      from public.contract_terms t join public.contracts c on c.id = t.contract_id
     where c.name = ${lit(nome)} and t.active
     order by t.valid_from`);
}

async function abrirAlterarCondicoes(page: Page, contrato: string) {
  await page.goto("/clientes");
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
  await page.getByRole("button", { name: `Editar ${contrato}`, exact: true }).click();
  const d = dialogo(page);
  await expect(d.getByText("Carregando…")).toHaveCount(0, { timeout: 20_000 });
  await d.getByRole("button", { name: "Alterar condições" }).click();
  const alt = dialogo(page);
  await expect(alt.getByRole("heading", { name: "Alterar condições" })).toBeVisible();
  return alt;
}

test.describe("VF valores futuros", () => {
  test.use({ storageState: estadoDe("admin") });

  test("VF1 primeira versão em 01/08/2027: alterar DEPOIS dela parte do valor daquela data e salva", async ({
    page,
  }) => {
    const alt = await abrirAlterarCondicoes(page, CTR_FUT);
    await alt.locator("#valor-atual-inicio").fill("2027-09-01");
    // O valor que vale em 01/09 é o da primeira versão (240), não um "valor de hoje" que não existe.
    await expect(alt.locator("#valor-atual-daily_rate")).toHaveValue(/^240(\.0+)?$/);
    await alt.locator("#valor-atual-daily_rate").fill("260");
    const salvar = alt.getByRole("button", { name: "Salvar novo valor" });
    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(alt.getByRole("heading", { name: "Alterar condições" })).toHaveCount(0, {
      timeout: 20_000,
    });
    expect(versoesDoContrato(CTR_FUT)).toEqual([
      { inicio: "2027-08-01", fim: "2027-09-01", diaria: "240.00" },
      { inicio: "2027-09-01", fim: null, diaria: "260.00" },
    ]);
  });

  test("VF2 na data de uma versão: corrige aquela versão; ANTES da primeira: antecipa — os dois partem do valor dela", async ({
    page,
  }) => {
    let alt = await abrirAlterarCondicoes(page, CTR_FUT);
    await alt.locator("#valor-atual-inicio").fill("2027-09-01");
    await expect(alt.locator("#valor-atual-daily_rate")).toHaveValue(/^260(\.0+)?$/);
    await expect(alt.getByRole("button", { name: "Corrigir valor" })).toBeEnabled();
    await alt.getByRole("button", { name: "Cancelar" }).click();
    alt = await abrirAlterarCondicoes(page, CTR_FUT);
    await alt.locator("#valor-atual-inicio").fill("2027-07-15");
    await expect(alt.locator("#valor-atual-daily_rate")).toHaveValue(/^240(\.0+)?$/);
    await expect(alt.getByRole("button", { name: "Antecipar início" })).toBeEnabled();
    await alt.getByRole("button", { name: "Cancelar" }).click();
    // Nada gravado nas duas tentativas canceladas.
    expect(versoesDoContrato(CTR_FUT)).toHaveLength(2);
  });
});

// =============================================================================================
// R-CP08-01, 02 e 03 — INDICADORES E CSV
// =============================================================================================

test.describe("IN indicadores e CSV", () => {
  test.use({ storageState: estadoDe("admin") });

  test("IN1 'Diárias' diz quantos lançamentos são de domingo/feriado (cobrados por hora) — sem mudar a contagem", async ({
    page,
  }) => {
    const linha = (entrada: string, saida: string, intervalo: number) => ({
      colaborador: ANA,
      entrada,
      saida,
      intervalo,
    });
    await lancarDia(page, {
      operacao: OP,
      turno: DIA,
      data: "2027-07-04", // domingo
      linhas: [linha("08:00", "12:00", 0)],
    });
    await lancarDia(page, {
      operacao: OP,
      turno: DIA,
      data: "2027-07-05",
      linhas: [linha("08:00", "17:00", 60)],
    });
    await page.goto("/dashboard");
    await page.locator("input[type=date]").nth(0).fill("2027-07-01");
    await page.locator("input[type=date]").nth(1).fill("2027-07-15");
    await expect(valorDoCartao(page, "Diárias")).toHaveText("2", { timeout: 30_000 });
    await expect(descricaoDoCartao(page, "Diárias")).toContainText(
      /inclui 1 de domingo ou feriado, cobrado por hora/,
    );
    await page.goto("/relatorios");
    await page.locator("#relatorios-inicio").fill("2027-07-01");
    await page.locator("#relatorios-fim").fill("2027-07-15");
    await expect(valorDoCartao(page, "Diárias")).toHaveText("2", { timeout: 30_000 });
    await expect(descricaoDoCartao(page, "Diárias")).toContainText(
      /inclui 1 de domingo ou feriado/,
    );
    await abrirFaturamento(page, { cliente: CLI, inicio: "2027-07-01", fim: "2027-07-15" });
    await expect(descricaoDoCartao(page, "Diárias")).toContainText(
      /inclui 1 de domingo ou feriado/,
    );
  });

  test("IN2 sem receita no período, a margem percentual não aparece como 0,0%", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.locator("input[type=date]").nth(0).fill("2027-06-16");
    await page.locator("input[type=date]").nth(1).fill("2027-06-30");
    await expect(valorDoCartao(page, "Margem")).toHaveText(/R\$\s?0,00/, { timeout: 30_000 });
    await expect(descricaoDoCartao(page, "Margem")).toHaveText(/sem receita/i);
    await page.goto("/relatorios");
    await page.locator("#relatorios-inicio").fill("2027-06-16");
    await page.locator("#relatorios-fim").fill("2027-06-30");
    await expect(descricaoDoCartao(page, "Margem")).toContainText(/sem receita/i, {
      timeout: 30_000,
    });
  });

  test("CSV1 extratos de lançamentos com vírgula decimal (como o Fechamento): planilha em português lê número", async ({
    page,
  }) => {
    await page.goto("/relatorios");
    await page.locator("#relatorios-inicio").fill("2027-07-01");
    await page.locator("#relatorios-fim").fill("2027-07-15");
    await expect(valorDoCartao(page, "Receita")).toBeVisible({ timeout: 30_000 });
    const [d1] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar lançamentos (CSV)" }).click(),
    ]);
    const rel = linhasDoCsv(await d1.path()).filter((l) => l.some((c) => c !== ""));
    const iR = rel[0]!.indexOf("Receita");
    // Domingo 4 h em dobro = 240,00; segunda 8 h = 240,00.
    expect(
      rel
        .slice(1)
        .map((l) => l[iR])
        .sort(),
    ).toEqual(["240,00", "240,00"]);
    await abrirFaturamento(page, { cliente: CLI, inicio: "2027-07-01", fim: "2027-07-15" });
    const [d2] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar lançamentos (CSV)" }).click(),
    ]);
    const fat = linhasDoCsv(await d2.path()).filter((l) => l.some((c) => c !== ""));
    const iV = fat[0]!.indexOf("Valor faturado");
    expect(
      fat
        .slice(1)
        .map((l) => l[iV])
        .sort(),
    ).toEqual(["240,00", "240,00"]);
  });
});

// =============================================================================================
// OPERAÇÕES: O QUE SE COBRA (sem campo fictício de cobrança por produção)
// =============================================================================================

test.describe("OP clareza da Nova operação", () => {
  test.use({ storageState: estadoDe("admin") });

  test("OP1 a Nova operação diz que cobra por diária e que cobrança por quantidade não existe — sem campo de produção", async ({
    page,
  }) => {
    await page.goto("/operacoes");
    const botao = page.getByRole("button", { name: "Nova operação" });
    await expect(botao).toBeEnabled({ timeout: 30_000 });
    await botao.click();
    const d = page.getByRole("dialog").last();
    await expect(d).toBeVisible();
    for (const tipo of ["Fixa", "Avulsa"]) {
      await escolher(page, campo(d, "Tipo"), tipo);
      await expect(d.getByText(/cobrança é por diária de cada participante/)).toBeVisible();
      await expect(d.getByText(/por quantidade executada .* ainda não existe/)).toBeVisible();
    }
    // Nenhum campo que sugira cobrança por produção/quantidade/unidade.
    await expect(
      d.getByLabel(/quantidade|produção|por unidade|forma de cobrança|regime/i),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
