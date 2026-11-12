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
  esperarAviso,
  linhaDo,
} from "../apoio/telas";

/**
 * Defeitos e riscos JÁ CONHECIDOS (auditoria e plano de estabilização). Cada teste REPRODUZ o
 * defeito e confere que ele continua lá, com a etiqueta `@falha-conhecida`: o resumo mostra
 * FALHA CONHECIDA — nunca PASS. Se um passo anterior quebrar, o teste é FAIL (não vira falha
 * conhecida por engano); se a correção entrar, a conferência do defeito falha e a CI acusa,
 * obrigando a trocar o teste pelo comportamento correto. Nenhum código da aplicação é alterado.
 *
 * Dados próprios (cliente "Defeitos"), independentes dos outros arquivos.
 */

test.use({ storageState: estadoDe("admin") });

const CONHECIDA = { tag: "@falha-conhecida" };
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

// D1/B3: CORRIGIDO no CP-05. Saída antes da entrada num turno que não vira o dia não é mais
// gravada em silêncio: a tela bloqueia até corrigir o horário ou confirmar a linha. Deixou de ser
// falha conhecida: o teste confere o comportamento correto, sem a etiqueta. O cálculo não mudou.
test("[CORRIGIDO D1] saída antes da entrada (08:00 → 07:50): aviso e bloqueio até confirmar", async ({
  page,
}) => {
  await abrirDia(page, { operacao: OP, turno: TURNO, data: DATA_B3 });
  const tr = linhaDo(page, HUGO);
  await tr.locator("input[type=time]").nth(0).fill("08:00");
  await tr.locator("input[type=time]").nth(1).fill("07:50");
  const salvar = page.getByRole("button", { name: "Salvar", exact: true });
  await expect(page.getByRole("alert").filter({ hasText: "saída antes da entrada" })).toBeVisible();
  await expect(salvar).toBeDisabled();
  expect(lancamento(OP, HUGO, DATA_B3), "nada gravado sem confirmação").toBeUndefined();
  // Confirmada expressamente, grava pelo cálculo de sempre (fator 1,5, tolerância 10, blocos 15/45).
  await tr
    .getByRole("checkbox", { name: /Confirmo que a jornada atravessou a meia-noite/ })
    .check();
  await salvar.click();
  await esperarAviso(page, "Apontamento salvo.");
  const l = lancamento(OP, HUGO, DATA_B3);
  expect(l?.receita).toBe("953.13");
  expect(l?.custo).toBe("428.13");
});

// D3 em cliente: CORRIGIDO no CP-02 (trava de envio único). Deixou de ser falha conhecida: o
// teste agora confere o comportamento correto, sem a etiqueta. (D3 em turno segue abaixo, CP-04.)
test("[CORRIGIDO D3] duplo clique em “Salvar cliente” cria um único cliente", async ({ page }) => {
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
  await expect.poll(() => contarPorNome("clients", nome), { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(contarPorNome("clients", nome)).toBe(1);
});

// D3 em turno: CORRIGIDO no CP-04 (trava de envio único). Deixou de ser falha conhecida: o teste
// agora confere o comportamento correto, sem a etiqueta.
test("[CORRIGIDO D3] duplo clique em “Salvar turno” cria um único turno", async ({ page }) => {
  const nome = "Turno Duplo";
  await page.goto("/operacoes");
  await cartaoDaOperacao(page, OP).getByRole("button", { name: "Turno", exact: true }).click();
  const d = dialogo(page);
  await campo(d, "Nome do turno").fill(nome);
  await d.getByRole("button", { name: "Salvar turno" }).evaluate((botao: HTMLElement) => {
    botao.click();
    botao.click();
  });
  await expect.poll(() => contarPorNome("shifts", nome), { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(contarPorNome("shifts", nome)).toBe(1);
});

// D2: CORRIGIDO no CP-03 (o formulário guarda o que foi digitado ao trocar a data). Deixou de ser
// falha conhecida: o teste confere o comportamento correto, sem a etiqueta.
test("[CORRIGIDO D2] “Alterar custo”: trocar a data mantém o valor digitado", async ({ page }) => {
  await abrirColaborador(page, HUGO);
  await dialogo(page).getByRole("button", { name: "Alterar custo" }).click();
  const d = dialogo(page);
  await expect(d.getByRole("heading", { name: "Alterar custo" })).toBeVisible();
  const valor = d.locator("#valor-atual-daily_cost");
  await valor.fill("199");
  await expect(valor).toHaveValue("199");
  await d.locator("#valor-atual-inicio").fill("2026-10-01");
  await expect(valor).toHaveValue("199");
  await d.getByRole("button", { name: "Cancelar" }).click();
});

test(
  "[RISCO] a confirmação da fatura não avisa sobre dias ainda abertos",
  CONHECIDA,
  async ({ page }) => {
    await abrirFaturamento(page, { cliente: CLI, inicio: "2026-10-16", fim: "2026-10-31" });
    // O dia 20/10 continua "Aberto" (ninguém clicou em "Fechar dia").
    await page.getByRole("button", { name: "Gerar fatura" }).click();
    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao.getByRole("heading", { name: "Emitir fatura?" })).toBeVisible();
    await expect(confirmacao).toContainText("Apontamentos1");
    // Correto seria listar os dias abertos. Hoje não há menção:
    await expect(confirmacao).not.toContainText(/aberto|não fechad/i);
    // Nunca emitir aqui: só conferir a confirmação.
    await confirmacao.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  },
);
