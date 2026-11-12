import type { Locator, Page } from "@playwright/test";

import { expect } from "./fixtures";

/** Prefixo de todos os registros sintéticos criados pelo E2E. */
export const P = "TESTE-AUD-132";

/** Valor em reais no formato da tela ("R$ 1.234,56"), tolerando espaço comum ou rígido. */
export function reais(valor: number): RegExp {
  const texto = valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return new RegExp(`R\\$\\s?${texto.replace(/\./g, "\\.")}`);
}

/** Texto literal dentro de uma expressão regular. */
export function literal(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Campo (input, textarea ou select do Radix) logo depois do rótulo, dentro do escopo. */
export function campo(escopo: Locator | Page, rotulo: string): Locator {
  return escopo
    .locator(`xpath=.//label[normalize-space(.)=${JSON.stringify(rotulo)}]/following-sibling::*[1]`)
    .first();
}

/** Escolhe uma opção num select do Radix (abre o gatilho e clica na opção pelo texto). */
export async function escolher(page: Page, gatilho: Locator, opcao: string | RegExp) {
  await gatilho.click();
  await page.getByRole("option", { name: opcao }).first().click();
}

/** Diálogo aberto (o último, quando há um sobre outro). */
export function dialogo(page: Page): Locator {
  return page.getByRole("dialog").last();
}

/** Espera o diálogo fechar depois de salvar. */
export async function esperarFechar(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Cadastros
// ---------------------------------------------------------------------------

export async function criarCliente(page: Page, nome: string) {
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const d = dialogo(page);
  await campo(d, "Nome").fill(nome);
  await d.getByRole("button", { name: "Salvar cliente" }).click();
  await esperarFechar(page);
  await expect(page.getByRole("cell", { name: nome })).toBeVisible();
}

export async function criarContrato(
  page: Page,
  o: { cliente: string; nome: string; diaria: number; inicio: string },
) {
  await page.goto("/clientes");
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
  await page.getByRole("button", { name: "Novo contrato" }).click();
  const d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), o.cliente);
  await campo(d, "Nome do contrato").fill(o.nome);
  await campo(d, "Valor da diária (R$)").fill(String(o.diaria));
  await campo(d, "Início do contrato").fill(o.inicio);
  await d.getByRole("button", { name: "Salvar contrato" }).click();
  await esperarFechar(page);
}

export async function criarColaborador(
  page: Page,
  o: { nome: string; custo: number; desde: string; funcao?: string },
) {
  await page.goto("/colaboradores");
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const d = dialogo(page);
  await d.locator("#employee-name").fill(o.nome);
  if (o.funcao) await escolher(page, d.locator("#employee-job-function"), o.funcao);
  await d.locator("#employee-cost").fill(String(o.custo));
  await d.locator("#employee-cost-from").fill(o.desde);
  await d.getByRole("button", { name: "Salvar colaborador" }).click();
  await esperarFechar(page);
}

export async function criarOperacao(
  page: Page,
  o: {
    cliente: string;
    nome: string;
    tipo: "Fixa" | "Avulsa";
    contrato?: string;
    valor?: number;
    data?: string;
  },
) {
  await page.goto("/operacoes");
  await page.getByRole("button", { name: "Nova operação" }).click();
  const d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), o.cliente);
  if (o.tipo === "Avulsa") await escolher(page, campo(d, "Tipo"), "Avulsa");
  await campo(d, "Nome da operação").fill(o.nome);
  if (o.contrato) await escolher(page, campo(d, "Contrato"), new RegExp(`^${literal(o.contrato)}`));
  if (o.valor !== undefined) await campo(d, "Valor por diária (R$)").fill(String(o.valor));
  if (o.data) await campo(d, "Data do serviço").fill(o.data);
  await d.getByRole("button", { name: "Salvar operação" }).click();
  await esperarFechar(page);
}

/** Cartão da operação na tela Operações. */
export function cartaoDaOperacao(page: Page, nome: string): Locator {
  return page
    .locator("div.rounded-2xl")
    .filter({ has: page.getByRole("heading", { level: 2, name: nome, exact: true }) })
    .last();
}

export async function criarTurno(
  page: Page,
  o: {
    operacao: string;
    nome: string;
    inicio: string;
    fim: string;
    intervalo: number;
    viraDia?: boolean;
  },
) {
  await page.goto("/operacoes");
  await cartaoDaOperacao(page, o.operacao)
    .getByRole("button", { name: "Turno", exact: true })
    .click();
  const d = dialogo(page);
  await campo(d, "Nome do turno").fill(o.nome);
  await campo(d, "Início").fill(o.inicio);
  await campo(d, "Fim").fill(o.fim);
  await campo(d, "Intervalo (min)").fill(String(o.intervalo));
  if (o.viraDia) await d.locator("#crosses").check();
  await d.getByRole("button", { name: "Salvar turno" }).click();
  await esperarFechar(page);
}

export async function alocar(
  page: Page,
  o: { operacao: string; colaborador: string; turno: string },
) {
  await page.goto("/operacoes");
  await cartaoDaOperacao(page, o.operacao)
    .getByRole("button", { name: /^Equipe/ })
    .click();
  const d = dialogo(page);
  const linha = d.locator("div.border-b").filter({ hasText: o.colaborador }).first();
  await escolher(page, linha.getByRole("combobox").first(), new RegExp(`^${literal(o.turno)}`));
  await expect(linha.getByRole("button", { name: "Desalocar" })).toBeVisible();
  await d.getByRole("button", { name: "Concluir" }).click();
  await esperarFechar(page);
}

export async function cadastrarFeriado(page: Page, o: { data: string; nome: string }) {
  await page.goto("/clientes");
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
  await page.getByRole("button", { name: "Novo feriado" }).click();
  const d = dialogo(page);
  await d.locator("#feriado-data").fill(o.data);
  await d.locator("#feriado-nome").fill(o.nome);
  await d.locator("#feriado-motivo").fill("E2E local");
  await d.getByRole("button", { name: "Registrar feriado" }).click();
  await esperarFechar(page);
}

// ---------------------------------------------------------------------------
// Apontamentos
// ---------------------------------------------------------------------------

export type LinhaDoDia = {
  colaborador: string;
  presenca?: "Presente" | "Falta" | "Substituição";
  entrada?: string;
  saida?: string;
  intervalo?: number;
};

/** Abre o dia na tela de apontamento (operação, turno e data). */
export async function abrirDia(page: Page, o: { operacao: string; turno: string; data: string }) {
  await page.goto("/apontamentos");
  await escolher(page, campo(page, "Operação"), o.operacao);
  await escolher(page, campo(page, "Turno"), new RegExp(`^${literal(o.turno)}`));
  await campo(page, "Data").fill(o.data);
  await expect(page.getByText("Carregando equipe e apontamentos...")).toHaveCount(0);
}

/** Linha do colaborador na tabela "Equipe do dia". */
export function linhaDo(page: Page, colaborador: string): Locator {
  return page.locator("tr").filter({ hasText: colaborador }).first();
}

/** Preenche as linhas e salva o dia. */
export async function lancarDia(
  page: Page,
  o: { operacao: string; turno: string; data: string; linhas: LinhaDoDia[] },
) {
  await abrirDia(page, o);
  for (const l of o.linhas) {
    const tr = linhaDo(page, l.colaborador);
    await expect(tr).toBeVisible();
    if (l.presenca) await escolher(page, tr.getByRole("combobox").first(), l.presenca);
    if (l.entrada !== undefined) await tr.locator("input[type=time]").nth(0).fill(l.entrada);
    if (l.saida !== undefined) await tr.locator("input[type=time]").nth(1).fill(l.saida);
    if (l.intervalo !== undefined)
      await tr.locator("input[type=number]").first().fill(String(l.intervalo));
  }
  const salvar = page.getByRole("button", { name: "Salvar", exact: true });
  await expect(salvar).toBeEnabled();
  await salvar.click();
  await expect(page.getByRole("button", { name: "Salvando..." })).toHaveCount(0, {
    timeout: 30_000,
  });
}
