import { mkdirSync, writeFileSync } from "node:fs";

import { celulasDoXlsx, linhasDoCsv } from "../apoio/arquivos";

import {
  contarPorNome,
  faturasDoCliente,
  lancamento,
  lancamentosDaOperacao,
  somar,
  versoesDeCusto,
} from "../apoio/banco";
import { estadoDe, expect, semErroDeAplicacao, test } from "../apoio/fixtures";
import {
  P,
  abrirDia,
  abrirFaturamento,
  alocar,
  alterarCusto,
  cadastrarFeriado,
  campo,
  cartaoDaOperacao,
  criarCliente,
  criarColaborador,
  criarContrato,
  criarOperacao,
  criarTurno,
  descricaoDoCartao,
  dialogo,
  emitirFatura,
  esperarFechar,
  gerarFechamento,
  lancarDia,
  linhaDo,
  reais,
  registrarAdicional,
  valorDoCartao,
} from "../apoio/telas";

/**
 * Ciclo completo pela TELA, com o admin sintético, contra o Supabase local: cadastros, vigências
 * do PR #132 (V1–V5), operação fixa ao centavo, operação avulsa genérica, fechamento,
 * exportações, fatura com adicional, bloqueio do faturado e proteção contra cobrança dupla.
 *
 * Esperado × obtido: cada valor esperado está escrito aqui (calculado à mão pela regra aprovada:
 * diária 250, custo 150, hora extra 1,5, tolerância 10 min, domingo/feriado em dobro) e é
 * comparado com o que o BANCO gravou (derivação por trigger) e com o que a TELA mostra.
 *
 * Período: 1ª quinzena de outubro de 2026 (passado em relação à execução, para que "valor de
 * hoje" e "vigência imediata" não dependam do relógio da CI).
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: estadoDe("admin") });

// --- Nomes sintéticos -------------------------------------------------------------------------
const CLI_FIXO = `${P} Fixo`;
const CLI_AVULSO = `${P} Avulso`;
const CLI_VIG = `${P} Vigência`;
const CTR_FIXO = `${P} Contrato Fixo`;
const CTR_VIG = `${P} Contrato Vig`;
const OP_FIXA = `${P} Op Fixa`;
const OP_AVULSA = `${P} Op Avulsa`;
const OP_VIG = `${P} Op Vig`;
const ANA = `${P} Ana`;
const BRUNO = `${P} Bruno`;
const DAVI = `${P} Davi`;
const EVA = `${P} Eva`;
const FABIO = `${P} Fábio`;
const VERA = `${P} Vera`;

// --- Esperado da operação fixa (receita, custo) --------------------------------------------------
type Caso = {
  caso: string;
  colaborador: string;
  turno: string;
  data: string;
  presenca?: "Presente" | "Falta" | "Substituição";
  entrada?: string;
  saida?: string;
  receita: string;
  custo: string;
};

const CASOS_FIXA: Caso[] = [
  {
    caso: "8 h normal",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-01",
    entrada: "08:00",
    saida: "17:00",
    receita: "250.00",
    custo: "150.00",
  },
  {
    caso: "6 h incompleta",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-02",
    entrada: "08:00",
    saida: "15:00",
    receita: "187.50",
    custo: "112.50",
  },
  {
    caso: "sábado 4 h",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-03",
    entrada: "08:00",
    saida: "13:00",
    receita: "250.00",
    custo: "150.00",
  },
  {
    caso: "domingo 8 h (dobro)",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-04",
    entrada: "08:00",
    saida: "17:00",
    receita: "500.00",
    custo: "300.00",
  },
  {
    caso: "10 h (2 h extras)",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-05",
    entrada: "08:00",
    saida: "19:00",
    receita: "343.75",
    custo: "187.50",
  },
  {
    caso: "+15 min (limite 15)",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-06",
    entrada: "08:00",
    saida: "17:15",
    receita: "273.44",
    custo: "154.69",
  },
  {
    caso: "+45 min (limite 45)",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-07",
    entrada: "08:00",
    saida: "17:45",
    receita: "296.88",
    custo: "164.06",
  },
  {
    caso: "sábado 6 h (2 h extras)",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-10",
    entrada: "08:00",
    saida: "15:00",
    receita: "343.75",
    custo: "187.50",
  },
  {
    caso: "feriado 8 h (dobro)",
    colaborador: ANA,
    turno: "Diurno A",
    data: "2026-10-12",
    entrada: "08:00",
    saida: "17:00",
    receita: "500.00",
    custo: "300.00",
  },
  {
    caso: "falta",
    colaborador: BRUNO,
    turno: "Diurno B",
    data: "2026-10-01",
    presenca: "Falta",
    receita: "0.00",
    custo: "0.00",
  },
  {
    caso: "substituição",
    colaborador: BRUNO,
    turno: "Diurno B",
    data: "2026-10-02",
    presenca: "Substituição",
    entrada: "08:00",
    saida: "17:00",
    receita: "250.00",
    custo: "150.00",
  },
  {
    caso: "noturno 22:00–07:00",
    colaborador: DAVI,
    turno: "Noturno",
    data: "2026-10-01",
    entrada: "22:00",
    saida: "07:00",
    receita: "250.00",
    custo: "150.00",
  },
];

const RECEITA_FIXA = "3445.32";
const CUSTO_FIXO = "2006.25";
const ADICIONAL = 100;
const FATURA_FIXA = "3545.32";

const CASOS_AVULSA = [EVA, FABIO];
const RECEITA_AVULSA = "400.00";
const CUSTO_AVULSO = "300.00";

const FATURA_VIG = "750.00"; // 3 dias de Vera: 250 cada
const CUSTO_VIG = "490.00"; // 160 + 160 + 170

/** Registro do esperado × obtido, anexado ao relatório do Playwright. */
const conferencias: Array<{ caso: string; esperado: string; obtido: string; ok: boolean }> = [];
function conferir(caso: string, esperado: string, obtido: string | undefined) {
  conferencias.push({ caso, esperado, obtido: obtido ?? "(ausente)", ok: esperado === obtido });
  expect(obtido, caso).toBe(esperado);
}

test.afterAll(() => {
  mkdirSync("e2e-results", { recursive: true });
  writeFileSync("e2e-results/esperado-x-obtido.json", JSON.stringify(conferencias, null, 2));
});

// ------------------------------------------------------------------------------------------------
test("cadastros: clientes, contratos, feriado, colaboradores, operações, turnos e equipe", async ({
  page,
}) => {
  for (const nome of [CLI_FIXO, CLI_AVULSO, CLI_VIG]) await criarCliente(page, nome);
  await criarContrato(page, {
    cliente: CLI_FIXO,
    nome: CTR_FIXO,
    diaria: 250,
    inicio: "2026-10-01",
  });
  await criarContrato(page, { cliente: CLI_VIG, nome: CTR_VIG, diaria: 250, inicio: "2026-10-01" });
  await cadastrarFeriado(page, { data: "2026-10-12", nome: `${P} Feriado` });

  for (const nome of [ANA, BRUNO, DAVI, EVA, FABIO])
    await criarColaborador(page, { nome, custo: 150, desde: "2026-10-01" });
  await criarColaborador(page, { nome: VERA, custo: 150, desde: "2026-10-05" });

  await criarOperacao(page, { cliente: CLI_FIXO, nome: OP_FIXA, tipo: "Fixa", contrato: CTR_FIXO });
  await criarOperacao(page, {
    cliente: CLI_AVULSO,
    nome: OP_AVULSA,
    tipo: "Avulsa",
    valor: 200,
    data: "2026-10-09",
  });
  await criarOperacao(page, { cliente: CLI_VIG, nome: OP_VIG, tipo: "Fixa", contrato: CTR_VIG });

  const diurno = { inicio: "08:00", fim: "17:00", intervalo: 60 };
  await criarTurno(page, { operacao: OP_FIXA, nome: "Diurno A", ...diurno });
  await criarTurno(page, { operacao: OP_FIXA, nome: "Diurno B", ...diurno });
  await criarTurno(page, {
    operacao: OP_FIXA,
    nome: "Noturno",
    inicio: "22:00",
    fim: "07:00",
    intervalo: 60,
    viraDia: true,
  });
  await criarTurno(page, { operacao: OP_AVULSA, nome: "Avulso", ...diurno });
  await criarTurno(page, { operacao: OP_VIG, nome: "Diurno V", ...diurno });

  await alocar(page, { operacao: OP_FIXA, colaborador: ANA, turno: "Diurno A" });
  await alocar(page, { operacao: OP_FIXA, colaborador: BRUNO, turno: "Diurno B" });
  await alocar(page, { operacao: OP_FIXA, colaborador: DAVI, turno: "Noturno" });
  await alocar(page, { operacao: OP_AVULSA, colaborador: EVA, turno: "Avulso" });
  await alocar(page, { operacao: OP_AVULSA, colaborador: FABIO, turno: "Avulso" });
  await alocar(page, { operacao: OP_VIG, colaborador: VERA, turno: "Diurno V" });

  // Um cadastro de cada, sem duplicação.
  for (const nome of [CLI_FIXO, CLI_AVULSO, CLI_VIG])
    expect(contarPorNome("clients", nome)).toBe(1);
  for (const nome of [ANA, BRUNO, DAVI, EVA, FABIO, VERA])
    expect(contarPorNome("employees", nome)).toBe(1);
  await semErroDeAplicacao(page);
});

// ------------------------------------------------------------------------------------------------
test.describe("PR #132 — vigências do custo", () => {
  test("V1: correção na mesma data deixa um único valor ativo, com o número novo", async ({
    page,
  }) => {
    const { dialogo: d, botao } = await alterarCusto(page, {
      colaborador: VERA,
      inicio: "2026-10-05",
      custo: 160,
      botaoEsperado: "Corrigir valor",
    });
    await expect(d.getByText(/Já existe um valor começando nesta data/)).toBeVisible();
    await botao.click();
    await expect(page.getByText("Valor corrigido.").first()).toBeVisible({ timeout: 20_000 });

    const ativas = versoesDeCusto(VERA).filter((v) => v.ativa);
    expect(ativas.map((v) => [v.inicio, v.custo])).toEqual([["2026-10-05", "160.00"]]);
  });

  test("V2: antes da antecipação, lançar 02/10 é recusado (sem vigência)", async ({ page }) => {
    await abrirDia(page, { operacao: OP_VIG, turno: "Diurno V", data: "2026-10-02" });
    await expect(linhaDo(page, VERA)).toBeVisible();
    const salvar = page.getByRole("button", { name: "Salvar", exact: true });
    if (await salvar.isEnabled()) {
      await salvar.click();
      await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Apontamento salvo.")).toHaveCount(0);
    }
    expect(lancamento(OP_VIG, VERA, "2026-10-02")).toBeUndefined();
  });

  test("V2: antecipar o início para 01/10 libera o lançamento de 02/10", async ({ page }) => {
    const { dialogo: d, botao } = await alterarCusto(page, {
      colaborador: VERA,
      inicio: "2026-10-01",
      botaoEsperado: "Antecipar início",
    });
    await expect(d.getByText(/O primeiro valor começa em 05\/10\/2026/)).toBeVisible();
    await expect(d.locator("#valor-atual-daily_cost")).toHaveValue(/^160(\.0+)?$/);
    await botao.click();
    await expect(page.getByText("Valor corrigido.").first()).toBeVisible({ timeout: 20_000 });

    const ativas = versoesDeCusto(VERA).filter((v) => v.ativa);
    expect(ativas.map((v) => [v.inicio, v.custo])).toEqual([["2026-10-01", "160.00"]]);

    await lancarDia(page, {
      operacao: OP_VIG,
      turno: "Diurno V",
      data: "2026-10-02",
      linhas: [{ colaborador: VERA }],
    });
    const l = lancamento(OP_VIG, VERA, "2026-10-02");
    conferir("V2 Vera 02/10 receita", "250.00", l?.receita);
    conferir("V2 Vera 02/10 custo (160 antecipado)", "160.00", l?.custo);
  });

  test("V3: novo valor a partir de 07/10 preserva o lançamento de 06/10", async ({ page }) => {
    await lancarDia(page, {
      operacao: OP_VIG,
      turno: "Diurno V",
      data: "2026-10-06",
      linhas: [{ colaborador: VERA }],
    });
    conferir(
      "V3 Vera 06/10 custo antes da alteração",
      "160.00",
      lancamento(OP_VIG, VERA, "2026-10-06")?.custo,
    );

    const { botao } = await alterarCusto(page, {
      colaborador: VERA,
      inicio: "2026-10-07",
      custo: 170,
      botaoEsperado: "Salvar novo valor",
    });
    await botao.click();
    await expect(page.getByText("Novo valor salvo.").first()).toBeVisible({ timeout: 20_000 });

    const ativas = versoesDeCusto(VERA).filter((v) => v.ativa);
    expect(ativas.map((v) => [v.inicio, v.fim, v.custo])).toEqual([
      // Fim EXCLUSIVO no banco (daterange '[)'): 07/10 = vale até 06/10, como a tela mostra.
      ["2026-10-01", "2026-10-07", "160.00"],
      ["2026-10-07", null, "170.00"],
    ]);

    await lancarDia(page, {
      operacao: OP_VIG,
      turno: "Diurno V",
      data: "2026-10-07",
      linhas: [{ colaborador: VERA }],
    });
    conferir(
      "V3 Vera 07/10 custo (novo valor)",
      "170.00",
      lancamento(OP_VIG, VERA, "2026-10-07")?.custo,
    );
    conferir(
      "V3 Vera 06/10 custo preservado",
      "160.00",
      lancamento(OP_VIG, VERA, "2026-10-06")?.custo,
    );

    // O histórico na tela mostra os dois períodos.
    await page.goto("/colaboradores");
    await page.getByRole("button", { name: `Editar ${VERA}`, exact: true }).click();
    await dialogo(page).getByText("Ver histórico").click();
    await expect(dialogo(page)).toContainText(/160,00/);
    await expect(dialogo(page)).toContainText(/170,00/);
  });
});

// ------------------------------------------------------------------------------------------------
test.describe("operação fixa — ciclo ao centavo", () => {
  for (const c of CASOS_FIXA) {
    test(`lançamento: ${c.caso} (${c.data})`, async ({ page }) => {
      await lancarDia(page, {
        operacao: OP_FIXA,
        turno: c.turno,
        data: c.data,
        linhas: [
          {
            colaborador: c.colaborador,
            ...(c.presenca ? { presenca: c.presenca } : {}),
            ...(c.entrada ? { entrada: c.entrada } : {}),
            ...(c.saida ? { saida: c.saida } : {}),
          },
        ],
      });
      const l = lancamento(OP_FIXA, c.colaborador, c.data);
      conferir(`${c.caso}: receita no banco`, c.receita, l?.receita);
      conferir(`${c.caso}: custo no banco`, c.custo, l?.custo);
      // A tela mostra o mesmo valor gravado na linha.
      await expect(linhaDo(page, c.colaborador)).toContainText(reais(Number(c.receita)));
    });
  }

  test("o feriado cadastrado antes do lançamento marca o dia como feriado", () => {
    const l = lancamento(OP_FIXA, ANA, "2026-10-12");
    expect(l?.dia ?? "").toMatch(/feriado|holiday/i);
  });

  test("totais da operação e por colaborador batem com o esperado", () => {
    const todos = lancamentosDaOperacao(OP_FIXA);
    expect(todos).toHaveLength(CASOS_FIXA.length);
    conferir("operação fixa: receita total", RECEITA_FIXA, somar(todos.map((l) => l.receita)));
    conferir("operação fixa: custo total", CUSTO_FIXO, somar(todos.map((l) => l.custo)));
    const de = (nome: string) => todos.filter((l) => l.colaborador === nome);
    conferir("Ana: receita", "2945.32", somar(de(ANA).map((l) => l.receita)));
    conferir("Ana: custo", "1706.25", somar(de(ANA).map((l) => l.custo)));
    conferir("Bruno: receita", "250.00", somar(de(BRUNO).map((l) => l.receita)));
    conferir("Davi: receita", "250.00", somar(de(DAVI).map((l) => l.receita)));
  });
});

// ------------------------------------------------------------------------------------------------
test.describe("operação avulsa genérica (sem contrato, valor próprio)", () => {
  test("dois participantes no mesmo dia: receita e custo individuais", async ({ page }) => {
    await lancarDia(page, {
      operacao: OP_AVULSA,
      turno: "Avulso",
      data: "2026-10-09",
      linhas: CASOS_AVULSA.map((colaborador) => ({ colaborador })),
    });
    const todos = lancamentosDaOperacao(OP_AVULSA);
    expect(todos.map((l) => [l.colaborador, l.receita, l.custo])).toEqual([
      [EVA, "200.00", "150.00"],
      [FABIO, "200.00", "150.00"],
    ]);
    conferir("avulsa: receita", RECEITA_AVULSA, somar(todos.map((l) => l.receita)));
    conferir("avulsa: custo", CUSTO_AVULSO, somar(todos.map((l) => l.custo)));
  });

  test("fechamento da avulsa mostra o total uma vez", async ({ page }) => {
    await gerarFechamento(page, { cliente: CLI_AVULSO, mes: 10, ano: 2026 });
    await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(400));
    await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(300));
  });

  test("fatura da avulsa e nenhuma segunda cobrança", async ({ page }) => {
    await abrirFaturamento(page, { cliente: CLI_AVULSO, inicio: "2026-10-01", fim: "2026-10-15" });
    await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(400));
    await emitirFatura(page, reais(400));
    const faturas = faturasDoCliente(CLI_AVULSO);
    expect(faturas).toHaveLength(1);
    conferir("avulsa: total da fatura", RECEITA_AVULSA, faturas[0]?.total);
    conferir("avulsa: custo da fatura", CUSTO_AVULSO, faturas[0]?.custo);
    expect(faturas[0]?.lancamentos).toBe(2);

    await abrirFaturamento(page, { cliente: CLI_AVULSO, inicio: "2026-10-01", fim: "2026-10-15" });
    await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();
    expect(faturasDoCliente(CLI_AVULSO)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------
test.describe("fechamento, exportações e fatura do cliente fixo", () => {
  test("fechamento da 1ª quinzena: receita e custo separados, ao centavo", async ({ page }) => {
    await gerarFechamento(page, { cliente: CLI_FIXO, mes: 10, ano: 2026 });
    await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(Number(RECEITA_FIXA)));
    await expect(descricaoDoCartao(page, "Receita total")).toHaveText(
      /Apontamentos R\$\s?3\.445,32 \+ adicionais R\$\s?0,00 \+ ajuste R\$\s?0,00/,
    );
    await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(Number(CUSTO_FIXO)));
    await semErroDeAplicacao(page);
  });

  test("Excel interno tem custo; Excel do cliente não tem custo, resultado nem margem", async ({
    page,
  }) => {
    await gerarFechamento(page, { cliente: CLI_FIXO, mes: 10, ano: 2026 });

    const baixar = async (botao: string) => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: botao }).click(),
      ]);
      return celulasDoXlsx(await download.path());
    };

    const interno = await baixar("Baixar Excel (.xlsx)");
    expect(interno).toMatch(/\bcusto\b/i);

    const cliente = await baixar("Excel do cliente (.xlsx)");
    expect(cliente).not.toMatch(/\b(custo|margem|resultado)\b/i);
    expect(cliente).not.toMatch(/2006[.,]25|1706[.,]25/);
    expect(cliente).toContain(ANA);

    // CSV por colaborador: uma linha por colaborador com lançamento.
    await page.getByRole("button", { name: /Baixar CSV/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Por colaborador" }).click(),
    ]);
    const csv = linhasDoCsv(await download.path());
    const texto = csv.map((linha) => linha.join(";")).join("\n");
    for (const nome of [ANA, BRUNO, DAVI]) expect(texto).toContain(nome);
  });

  test("adicional + fatura: total 3.545,32 e custo 2.006,25 no banco", async ({ page }) => {
    await abrirFaturamento(page, { cliente: CLI_FIXO, inicio: "2026-10-01", fim: "2026-10-15" });
    await registrarAdicional(page, {
      inicio: "2026-10-01",
      fim: "2026-10-15",
      mesCompetencia: "2026-10",
      motivo: `${P} adicional`,
      valor: ADICIONAL,
    });
    await abrirFaturamento(page, { cliente: CLI_FIXO, inicio: "2026-10-01", fim: "2026-10-15" });
    await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(Number(FATURA_FIXA)));
    await emitirFatura(page, reais(Number(FATURA_FIXA)));

    const faturas = faturasDoCliente(CLI_FIXO);
    expect(faturas).toHaveLength(1);
    conferir("fatura fixa: total", FATURA_FIXA, faturas[0]?.total);
    conferir("fatura fixa: custo", CUSTO_FIXO, faturas[0]?.custo);
    // gerar_fatura vincula as presenças e substituições; a falta (valor zero) fica fora do lastro.
    expect(faturas[0]?.lancamentos).toBe(CASOS_FIXA.length - 1);
    expect(faturas[0]?.itens).toBeGreaterThan(0);
    const linhas = lancamentosDaOperacao(OP_FIXA);
    expect(linhas.filter((l) => l.status !== "absent").every((l) => l.faturado)).toBe(true);
    expect(linhas.filter((l) => l.status === "absent").some((l) => l.faturado)).toBe(false);
  });

  test("sem cobrança dupla: o mesmo período não gera segunda fatura", async ({ page }) => {
    await abrirFaturamento(page, { cliente: CLI_FIXO, inicio: "2026-10-01", fim: "2026-10-15" });
    await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(0));
    await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();
    expect(faturasDoCliente(CLI_FIXO)).toHaveLength(1);
  });

  test("fechamento depois da fatura: nada a faturar", async ({ page }) => {
    await gerarFechamento(page, { cliente: CLI_FIXO, mes: 10, ano: 2026 });
    await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(Number(FATURA_FIXA)));
    // Painéis "A faturar" e "Já faturado": o total fica no item "Total com adicionais e ajuste".
    const total = (painel: string) =>
      page
        .getByRole("region", { name: painel, exact: true })
        .locator(
          "xpath=.//dt[normalize-space(.)='Total com adicionais e ajuste']/following-sibling::dd[1]",
        );
    await expect(total("A faturar")).toHaveText(reais(0));
    await expect(total("Já faturado")).toHaveText(reais(Number(FATURA_FIXA)));
  });

  test("lançamento faturado fica travado na tela", async ({ page }) => {
    await abrirDia(page, { operacao: OP_FIXA, turno: "Diurno A", data: "2026-10-01" });
    const tr = linhaDo(page, ANA);
    await expect(tr.getByText("Faturado")).toBeVisible();
    await expect(tr.getByRole("combobox").first()).toBeDisabled();
    await expect(tr.locator("input[type=time]").first()).toBeDisabled();
  });
});

// ------------------------------------------------------------------------------------------------
test.describe("PR #132 — faturado congelado e valor de hoje", () => {
  test("fatura do cliente de vigência (3 dias de Vera)", async ({ page }) => {
    await abrirFaturamento(page, { cliente: CLI_VIG, inicio: "2026-10-01", fim: "2026-10-15" });
    await emitirFatura(page, reais(Number(FATURA_VIG)));
    const faturas = faturasDoCliente(CLI_VIG);
    expect(faturas).toHaveLength(1);
    conferir("fatura vigência: total", FATURA_VIG, faturas[0]?.total);
    conferir("fatura vigência: custo", CUSTO_VIG, faturas[0]?.custo);
  });

  test("V4: corrigir o valor usado pelo faturado não altera o faturado", async ({ page }) => {
    const antes = lancamento(OP_VIG, VERA, "2026-10-07");
    expect(antes?.faturado).toBe(true);

    const { botao } = await alterarCusto(page, {
      colaborador: VERA,
      inicio: "2026-10-07",
      custo: 180,
      botaoEsperado: "Corrigir valor",
    });
    await botao.click();
    // A tela responde (sucesso ou recusa); o que importa é o faturado não mudar.
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

    const depois = lancamento(OP_VIG, VERA, "2026-10-07");
    conferir("V4 faturado 07/10: custo congelado", "170.00", depois?.custo);
    conferir("V4 faturado 07/10: receita congelada", "250.00", depois?.receita);
    const fatura = faturasDoCliente(CLI_VIG)[0];
    conferir("V4 fatura: total inalterado", FATURA_VIG, fatura?.total);
    conferir("V4 fatura: custo inalterado", CUSTO_VIG, fatura?.custo);
    await test.info().attach("v4-resposta-da-tela.txt", {
      body: await page.locator("[data-sonner-toast]").first().innerText(),
      contentType: "text/plain",
    });
  });

  test("V5: listas mostram o valor que vale hoje", async ({ page }) => {
    const hoje = versoesDeCusto(VERA).filter((v) => v.ativa && v.fim === null)[0];
    expect(hoje).toBeDefined();
    await page.goto("/colaboradores");
    await expect(page.locator("tr").filter({ hasText: VERA }).first()).toContainText(
      reais(Number(hoje?.custo)),
    );

    await page.goto("/clientes");
    await page.getByRole("tab", { name: "Contratos e regras" }).click();
    await expect(page.locator("tr").filter({ hasText: CTR_FIXO }).first()).toContainText(
      reais(250),
    );

    await page.goto("/operacoes");
    await expect(cartaoDaOperacao(page, OP_AVULSA)).toContainText(reais(200));
  });
});

// ------------------------------------------------------------------------------------------------
test.describe("Dashboard e Relatórios no período", () => {
  // Fixo 3.445,32 + adicional 100 + avulsa 400 + vigência 750.
  const RECEITA_PERIODO = 4695.32;

  test("Relatórios: receita do período", async ({ page }) => {
    await page.goto("/relatorios");
    await campo(page, "De").fill("2026-10-01");
    await campo(page, "Até").fill("2026-10-15");
    await expect(valorDoCartao(page, "Receita")).toHaveText(reais(RECEITA_PERIODO), {
      timeout: 30_000,
    });
  });

  test("Dashboard: receita e custo do período", async ({ page }) => {
    await page.goto("/dashboard");
    await campo(page, "De").fill("2026-10-01");
    await campo(page, "Até").fill("2026-10-15");
    await expect(valorDoCartao(page, "Receita")).toHaveText(reais(RECEITA_PERIODO), {
      timeout: 30_000,
    });
    // Custo: fixo 2.006,25 + avulsa 300 + vigência 490.
    await expect(valorDoCartao(page, "Custo")).toHaveText(reais(2796.25));
  });
});

// Garante que nenhum diálogo ficou aberto entre testes (falha cedo e com contexto).
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await esperarFechar(page).catch(() => undefined);
});
