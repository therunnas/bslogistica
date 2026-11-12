import { contarPorNome, lancamento } from "../apoio/banco";
import { estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirColaborador,
  abrirDia,
  abrirFaturamento,
  alocar,
  cartaoDaOperacao,
  campo,
  criarCliente,
  criarColaborador,
  criarContrato,
  criarOperacao,
  criarTurno,
  dialogo,
  linhaDo,
} from "../apoio/telas";

/**
 * Defeitos e riscos JÁ CONHECIDOS (auditoria e plano de estabilização), escritos como o
 * comportamento CORRETO e marcados com `test.fail`: enquanto o defeito existir, o Playwright conta
 * o teste como "falhou como esperado" e o resumo mostra FALHA CONHECIDA — nunca PASS. Quando a
 * correção entrar, o teste passa a "passar inesperadamente" e a CI acusa, obrigando a tirar a
 * marcação. Nenhum código da aplicação é alterado aqui.
 *
 * Dados próprios (cliente "Defeitos"), independentes dos outros arquivos. A preparação é um teste
 * normal: se ela falhar, os seguintes ficam PULADOS (não viram FALHA CONHECIDA por engano).
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: estadoDe("admin") });

const CLI = `${P} Defeitos`;
const CTR = `${P} Contrato Defeitos`;
const OP = `${P} Op Defeitos`;
const TURNO = "Diurno H";
const HUGO = `${P} Hugo`;
const DATA_B3 = "2026-10-20";

test("preparação: cliente, contrato 250, colaborador, operação e turno", async ({ page }) => {
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: 250, inicio: "2026-10-01" });
  await criarColaborador(page, { nome: HUGO, custo: 150, desde: "2026-10-01" });
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, {
    operacao: OP,
    nome: TURNO,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: OP, colaborador: HUGO, turno: TURNO });
});

test("B3 [DEFEITO]: saída antes da entrada deveria pedir confirmação antes de salvar", async ({
  page,
}) => {
  test.fail(true, "B3 conhecido: 08:00 → 07:50 vira jornada de ~23 h sem aviso");
  await abrirDia(page, { operacao: OP, turno: TURNO, data: DATA_B3 });
  const tr = linhaDo(page, HUGO);
  await tr.locator("input[type=time]").nth(0).fill("08:00");
  await tr.locator("input[type=time]").nth(1).fill("07:50");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  // Correto: um aviso de jornada atípica com confirmação, sem salvar direto.
  await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 5_000 });
});

test("B3 [registro do comportamento atual]: o banco gravou 22h50 como jornada", async () => {
  await expect
    .poll(() => lancamento(OP, HUGO, DATA_B3)?.receita, { timeout: 20_000 })
    .toBeDefined();
  const l = lancamento(OP, HUGO, DATA_B3);
  // Calculado à mão pela regra atual (fator 1,5, tolerância 10 min, blocos de 15/45 min).
  expect(l?.receita).toBe("953.13");
  expect(l?.custo).toBe("428.13");
});

test("[DEFEITO] duplo clique em “Salvar cliente” deveria criar um único cliente", async ({
  page,
}) => {
  test.fail(true, "trava de duplo clique ainda não implementada (fila de estabilização, item 2)");
  const nome = `${P} Duplo`;
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const d = dialogo(page);
  await campo(d, "Nome").fill(nome);
  // Dois cliques no mesmo instante (mesmo tick), como um duplo clique rápido.
  await d.getByRole("button", { name: "Salvar cliente" }).evaluate((botao: HTMLElement) => {
    botao.click();
    botao.click();
  });
  await expect.poll(() => contarPorNome("clients", nome), { timeout: 20_000 }).toBeGreaterThan(0);
  // Dá tempo para a segunda gravação, se houver, chegar ao banco.
  await page.waitForTimeout(3_000);
  expect(contarPorNome("clients", nome)).toBe(1);
});

test("[DEFEITO] duplo clique em “Salvar turno” deveria criar um único turno", async ({ page }) => {
  test.fail(true, "trava de duplo clique ainda não implementada (fila de estabilização, item 2)");
  const nome = "Turno Duplo";
  await page.goto("/operacoes");
  await cartaoDaOperacao(page, OP).getByRole("button", { name: "Turno", exact: true }).click();
  const d = dialogo(page);
  await campo(d, "Nome do turno").fill(nome);
  await d.getByRole("button", { name: "Salvar turno" }).evaluate((botao: HTMLElement) => {
    botao.click();
    botao.click();
  });
  await expect.poll(() => contarPorNome("shifts", nome), { timeout: 20_000 }).toBeGreaterThan(0);
  // Dá tempo para a segunda gravação, se houver, chegar ao banco.
  await page.waitForTimeout(3_000);
  expect(contarPorNome("shifts", nome)).toBe(1);
});

test("[DEFEITO] “Alterar custo”: o valor digitado deveria continuar depois de trocar a data", async ({
  page,
}) => {
  test.fail(true, "a tela recarrega o valor da versão ao trocar a data e perde o que foi digitado");
  await abrirColaborador(page, HUGO);
  await dialogo(page).getByRole("button", { name: "Alterar custo" }).click();
  const d = dialogo(page);
  await d.locator("#valor-atual-daily_cost").fill("199");
  await d.locator("#valor-atual-inicio").fill("2026-10-01");
  await expect(d.locator("#valor-atual-daily_cost")).toHaveValue("199", { timeout: 3_000 });
});

test("[RISCO] a confirmação da fatura deveria avisar sobre dias ainda abertos", async ({
  page,
}) => {
  test.fail(true, "a confirmação não lista dias abertos (fila de estabilização, item 4)");
  await abrirFaturamento(page, { cliente: CLI, inicio: "2026-10-16", fim: "2026-10-31" });
  await page.getByRole("button", { name: "Gerar fatura" }).click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao.getByRole("heading", { name: "Emitir fatura?" })).toBeVisible();
  try {
    await expect(confirmacao).toContainText(/aberto|não fechad/i, { timeout: 3_000 });
  } finally {
    // Nunca emitir aqui: só conferir a confirmação.
    await confirmacao.getByRole("button", { name: "Cancelar" }).click();
  }
});
