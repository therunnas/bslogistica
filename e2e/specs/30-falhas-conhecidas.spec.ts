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

test(
  "B3 [DEFEITO]: saída antes da entrada (08:00 → 07:50) salva sem aviso como jornada de 22h50",
  CONHECIDA,
  async ({ page }) => {
    await abrirDia(page, { operacao: OP, turno: TURNO, data: DATA_B3 });
    const tr = linhaDo(page, HUGO);
    await tr.locator("input[type=time]").nth(0).fill("08:00");
    await tr.locator("input[type=time]").nth(1).fill("07:50");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    // Correto seria um aviso de jornada atípica com confirmação. Hoje salva direto:
    await esperarAviso(page, "Apontamento salvo.");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const l = lancamento(OP, HUGO, DATA_B3);
    // Calculado à mão pela regra atual (fator 1,5, tolerância 10 min, blocos de 15/45 min).
    expect(l?.receita).toBe("953.13");
    expect(l?.custo).toBe("428.13");
  },
);

test(
  "[DEFEITO] duplo clique em “Salvar cliente” cria dois clientes iguais",
  CONHECIDA,
  async ({ page }) => {
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
    await expect.poll(() => contarPorNome("clients", nome), { timeout: 20_000 }).toBe(2);
  },
);

test(
  "[DEFEITO] duplo clique em “Salvar turno” cria dois turnos iguais",
  CONHECIDA,
  async ({ page }) => {
    const nome = "Turno Duplo";
    await page.goto("/operacoes");
    await cartaoDaOperacao(page, OP).getByRole("button", { name: "Turno", exact: true }).click();
    const d = dialogo(page);
    await campo(d, "Nome do turno").fill(nome);
    await d.getByRole("button", { name: "Salvar turno" }).evaluate((botao: HTMLElement) => {
      botao.click();
      botao.click();
    });
    await expect.poll(() => contarPorNome("shifts", nome), { timeout: 20_000 }).toBe(2);
  },
);

test(
  "[DEFEITO] “Alterar custo”: trocar a data apaga o valor digitado",
  CONHECIDA,
  async ({ page }) => {
    await abrirColaborador(page, HUGO);
    await dialogo(page).getByRole("button", { name: "Alterar custo" }).click();
    const d = dialogo(page);
    await expect(d.getByRole("heading", { name: "Alterar custo" })).toBeVisible();
    const valor = d.locator("#valor-atual-daily_cost");
    await valor.fill("199");
    await expect(valor).toHaveValue("199");
    await d.locator("#valor-atual-inicio").fill("2026-10-01");
    // Correto seria manter 199. Hoje a tela recarrega o valor da versão que começa nessa data:
    await expect(valor).toHaveValue(/^150(\.0+)?$/);
    await d.getByRole("button", { name: "Cancelar" }).click();
  },
);

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
