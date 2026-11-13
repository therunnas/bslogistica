import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { linhasDoCsv } from "../apoio/arquivos";
import { faturasDoCliente, lit } from "../apoio/banco";
import { clienteApi, sessaoApi } from "../apoio/contas";
import { consultar, estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirFaturamento,
  alocar,
  alterarCusto,
  cadastrarFeriado,
  campo,
  criarCliente,
  criarColaborador,
  criarContrato,
  criarOperacao,
  criarTurno,
  dialogo,
  emitirFatura,
  esperarFechar,
  gerarFechamento,
  lancarDia,
  reais,
  registrarAdicional,
  valorDoCartao,
} from "../apoio/telas";
import { prepararLoteDeContainers } from "../../src/lib/container-servico";

/**
 * CP-08 — Dashboard, Relatórios e Exportações. Uma matriz financeira independente (regras do
 * NEGOCIO §10 + V2, como nos CP-05 e CP-07, com custo por colaborador) comparada ao centavo com o
 * banco local, o Fechamento, o Faturamento, o Dashboard, os Relatórios e os CSV.
 *
 * Este arquivo mede PARIDADE TÉCNICA: o sistema reproduz o modelo que implementa (diária por
 * trabalhador). A cobrança por produção não existe e não é simulada aqui (nem por adicional): é
 * lacuna registrada em docs/NEGOCIO_X_SISTEMA.md (revisão da sessão 13).
 *
 * Configuração = Production (semente E2E). Datas de abril e maio de 2027, que nenhum outro arquivo
 * usa; 04/05/2027 (terça) vira feriado aqui.
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP08`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const CLI_AV = `${C} Avulso`;
const OP = `${C} Op Fixa`;
const AVULSA = `${C} Avulsa por diária`;
const DIA = "Dia CP08";
const DIA_AV = "Avulso CP08";

const GIL = `${C} Gil`;
const HANA = `${C} Hana`;
const IVO = `${C} Ivo`;
const JADE = `${C} Jade`;
const EQUIPE = [GIL, HANA, IVO];

const DIARIA = 240;
const DIARIA_AVULSA = 280;
const CUSTO: Record<string, number> = { [GIL]: 150, [HANA]: 200, [IVO]: 120, [JADE]: 130 };
const IVO_REAJUSTE = { desde: "2027-05-10", custo: 140 };
const FERIADO = "2027-05-04";
const Q1 = { inicio: "2027-05-01", fim: "2027-05-15" };

// =============================================================================================
// CÁLCULO INDEPENDENTE (não importa o núcleo financeiro do sistema)
// =============================================================================================

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const arred = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
function blocosDaHora(m: number) {
  const r = m % 60;
  return Math.floor(m / 60) * 60 + (r < 15 ? 0 : r < 45 ? 30 : 60);
}
function tipoDaData(data: string) {
  if (data === FERIADO) return "feriado";
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dow === 0 ? "domingo" : dow === 6 ? "sabado" : "util";
}
function custoDe(colaborador: string, data: string) {
  if (colaborador === IVO && data >= IVO_REAJUSTE.desde) return IVO_REAJUSTE.custo;
  return CUSTO[colaborador]!;
}
/** Centavos de receita e custo de um lançamento (NEGOCIO §10 + V2). */
function esperado(g: Gravado): { receita: number; custo: number } {
  if (g.status === "absent") return { receita: 0, custo: 0 };
  const ini = min(g.entrada!);
  let fim = min(g.saida!);
  if (fim <= ini) fim += 1440;
  const w = fim - ini - g.intervalo;
  const d = (g.operacao === AVULSA ? DIARIA_AVULSA : DIARIA) * 100;
  const c = custoDe(g.colaborador, g.data) * 100;
  const tipo = tipoDaData(g.data);
  if (tipo === "domingo" || tipo === "feriado") {
    return { receita: arred(d * w * 200, 48_000), custo: arred(c * w * 200, 48_000) };
  }
  const ref = tipo === "sabado" ? 240 : 480;
  const proporcional = tipo === "util" && w < 480;
  const excesso = Math.max(w - ref, 0);
  const passa = excesso > 10;
  const heCobrada = passa ? blocosDaHora(excesso) : 0;
  const hePaga = passa ? excesso : 0;
  const base = (proporcional ? w : 480) * 100;
  return {
    receita: arred(d * base + d * heCobrada * 150, 48_000),
    custo: arred(c * base + hePaga * c * 100, 48_000),
  };
}
const brl2 = (centavos: number) => (centavos / 100).toFixed(2);

type Gravado = {
  colaborador: string;
  operacao: string;
  cliente: string;
  data: string;
  status: string;
  entrada: string | null;
  saida: string | null;
  intervalo: number;
  receita: string;
  custo: string;
  faturado: boolean;
};

function gravados(inicio: string, fim: string, cliente?: string): Gravado[] {
  return consultar<Gravado>(`
    select e.name as colaborador, o.name as operacao, c.name as cliente,
           to_char(t.work_date,'YYYY-MM-DD') as data, te.status::text as status,
           to_char(te.check_in,'HH24:MI') as entrada, to_char(te.check_out,'HH24:MI') as saida,
           te.break_minutes as intervalo, te.billed_amount::numeric(12,2)::text as receita,
           te.cost_amount::numeric(12,2)::text as custo, te.invoice_id is not null as faturado
      from public.timesheet_entries te
      join public.employees e on e.id = te.employee_id
      join public.timesheets t on t.id = te.timesheet_id
      join public.operations o on o.id = t.operation_id
      join public.clients c on c.id = o.client_id
     where c.name in (${lit(CLI)}, ${lit(CLI_AV)})
       ${cliente ? `and c.name = ${lit(cliente)}` : ""}
       and t.work_date between ${lit(inicio)} and ${lit(fim)}
     order by t.work_date, o.name, e.name`);
}

/** Totais esperados dos apontamentos no período, conferindo cada linha do banco contra o cálculo. */
function apontamentos(inicio: string, fim: string, cliente?: string) {
  const porColaborador = new Map<string, { receita: number; custo: number }>();
  const porOperacao = new Map<string, { receita: number; custo: number }>();
  let receita = 0;
  let custo = 0;
  let presentes = 0;
  let linhas = 0;
  for (const g of gravados(inicio, fim, cliente)) {
    linhas += 1;
    const e = esperado(g);
    expect(`${g.receita}/${g.custo}`, `${g.colaborador} ${g.data}`).toBe(
      `${brl2(e.receita)}/${brl2(e.custo)}`,
    );
    receita += e.receita;
    custo += e.custo;
    if (g.status !== "absent") presentes += 1;
    for (const [mapa, chave] of [
      [porColaborador, g.colaborador],
      [porOperacao, g.operacao],
    ] as const) {
      const v = mapa.get(chave) ?? { receita: 0, custo: 0 };
      v.receita += e.receita;
      v.custo += e.custo;
      mapa.set(chave, v);
    }
  }
  return { receita, custo, presentes, linhas, porColaborador, porOperacao };
}

/** Adicionais NÃO cancelados cuja janela de cobrança (competência, ou execução) cabe no período. */
function adicionais(inicio: string, fim: string, cliente?: string) {
  const [r] = consultar<{ receita: string; custo: string }>(`
    select coalesce(sum(a.amount), 0)::numeric(12,2)::text as receita,
           coalesce(sum(cs.cost_total_cents), 0)::text as custo
      from public.billing_additionals a
      join public.clients c on c.id = a.client_id
      left join public.container_services cs
        on cs.billing_additional_id = a.id and cs.canceled_at is null
     where c.name in (${lit(CLI)}, ${lit(CLI_AV)})
       ${cliente ? `and c.name = ${lit(cliente)}` : ""}
       and a.canceled_at is null
       and coalesce(a.billing_period_start, a.period_start) >= ${lit(inicio)}
       and coalesce(a.billing_period_end, a.period_end) <= ${lit(fim)}`);
  return {
    receita: Math.round(Number(r!.receita) * 100),
    custo: Number(r!.custo),
  };
}

function idDe(tabela: "clients" | "operations" | "employees", nome: string): string {
  const [l] = consultar<{ id: string }>(
    `select id from public.${tabela} where name = ${lit(nome)}`,
  );
  expect(l, `${tabela} "${nome}" existe`).toBeDefined();
  return l!.id;
}

const h = (colaborador: string, entrada = "08:00", saida = "17:00", intervalo = 60) => ({
  colaborador,
  entrada,
  saida,
  intervalo,
});

async function lancarFixa(
  page: Page,
  data: string,
  presentes: {
    colaborador: string;
    entrada: string;
    saida: string;
    intervalo: number;
    presenca?: "Presente" | "Substituição";
  }[],
) {
  const nomes = new Set(presentes.map((p) => p.colaborador));
  await lancarDia(page, {
    operacao: OP,
    turno: DIA,
    data,
    linhas: [
      ...presentes,
      ...EQUIPE.filter((n) => !nomes.has(n)).map((colaborador) => ({
        colaborador,
        presenca: "Falta" as const,
      })),
    ],
  });
}

async function abrirDashboard(page: Page, inicio: string, fim: string) {
  await page.goto("/dashboard");
  const de = page.locator("input[type=date]").nth(0);
  const ate = page.locator("input[type=date]").nth(1);
  await de.fill(inicio);
  await ate.fill(fim);
}

async function abrirRelatorios(page: Page, inicio: string, fim: string) {
  await page.goto("/relatorios");
  await campo(page, "De").fill(inicio);
  await campo(page, "Até").fill(fim);
}

/** Registro antigo de contêiner pela RPC legada (histórico: o cadastro novo está encerrado). */
async function registroAntigo(o: {
  descricao: string;
  executadoEm: string;
  receita: number;
  custo: number;
  competencia?: { inicio: string; fim: string };
}): Promise<string> {
  const api = await sessaoApi("ADMIN");
  const { data, error } = await api.rpc("registrar_servico_container", {
    p_dados: prepararLoteDeContainers({
      clienteId: idDe("clients", CLI_AV),
      operacaoId: null,
      solicitadoEm: o.executadoEm,
      executadoEm: o.executadoEm,
      descricao: o.descricao,
      quantidade: 1,
      totalCobrado: String(o.receita),
      participantes: [{ colaboradorId: idDe("employees", JADE), valorDevido: String(o.custo) }],
      modalidadeCusto: "por_pessoa",
      ...(o.competencia ? { competenciaCobranca: o.competencia } : {}),
    }),
    p_idempotency_key: randomUUID(),
    p_reason: "E2E CP-08: registro antigo",
  });
  await api.auth.signOut({ scope: "local" });
  expect(error).toBeNull();
  return data as string;
}

// =============================================================================================
// PREPARAÇÃO
// =============================================================================================

test("PR preparação: fixa por diária (3 colaboradores, custos diferentes), avulsa por diária, feriado e reajuste", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: DIARIA, inicio: "2027-04-01" });
  await criarCliente(page, CLI_AV);
  for (const nome of Object.keys(CUSTO)) {
    await criarColaborador(page, { nome, custo: CUSTO[nome]!, desde: "2027-04-01" });
  }
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, { operacao: OP, nome: DIA, inicio: "08:00", fim: "17:00", intervalo: 60 });
  for (const nome of EQUIPE) await alocar(page, { operacao: OP, colaborador: nome, turno: DIA });
  await criarOperacao(page, {
    cliente: CLI_AV,
    nome: AVULSA,
    tipo: "Avulsa",
    valor: DIARIA_AVULSA,
    data: "2027-05-03",
  });
  await criarTurno(page, {
    operacao: AVULSA,
    nome: DIA_AV,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: AVULSA, colaborador: JADE, turno: DIA_AV });
  await cadastrarFeriado(page, { data: FERIADO, nome: `${C} Feriado` });
  const { botao } = await alterarCusto(page, {
    colaborador: IVO,
    inicio: IVO_REAJUSTE.desde,
    custo: IVO_REAJUSTE.custo,
    botaoEsperado: "Salvar novo valor",
  });
  await botao.click();
  await expect(page.getByText("Novo valor salvo.").first()).toBeVisible({ timeout: 20_000 });
});

test("AP lançamentos, adicionais e registros antigos (inclusive com competência diferente da execução e cancelado)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await lancarFixa(page, "2027-05-03", [h(GIL), h(HANA, "08:00", "18:20", 60)]); // Ivo falta; HE
  await lancarFixa(page, "2027-05-04", [h(GIL)]); // feriado
  await lancarFixa(page, "2027-05-08", [h(IVO, "08:00", "13:00", 0)]); // sábado 5 h
  await lancarFixa(page, "2027-05-09", [h(HANA, "08:00", "12:00", 0)]); // domingo 4 h
  await lancarFixa(page, "2027-05-10", [
    h(IVO, "08:00", "15:00", 60), // saída antecipada, custo reajustado
    { ...h(GIL), presenca: "Substituição" },
  ]);
  await lancarDia(page, {
    operacao: AVULSA,
    turno: DIA_AV,
    data: "2027-05-03",
    linhas: [h(JADE)],
  });

  // Adicional manual da 1ª quinzena e um da 2ª (executado na 1ª, cobrado na 2ª).
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  await registrarAdicional(page, {
    inicio: "2027-05-03",
    fim: "2027-05-07",
    mesCompetencia: "2027-05",
    motivo: `${C} taxa de acesso`,
    valor: 60,
  });
  await page.getByRole("button", { name: "Novo adicional" }).click();
  const d = dialogo(page);
  await d.locator("#adicional-inicio").fill("2027-05-12");
  await d.locator("#adicional-fim").fill("2027-05-14");
  await d.locator("#adicional-competencia-mes").fill("2027-05");
  await d.locator("#adicional-competencia").selectOption({ index: 1 });
  await d.locator("#adicional-motivo").fill(`${C} cobrado na 2ª quinzena`);
  await d.locator("#adicional-valor").fill("45");
  await d.getByRole("button", { name: "Registrar adicional" }).click();
  await esperarFechar(page);

  // Registros antigos de contêiner (histórico): A na 1ª quinzena; B executado em abril e cobrado
  // na 1ª quinzena de maio; C cancelado.
  await registroAntigo({
    descricao: `${C} antigo A`,
    executadoEm: "2027-05-06",
    receita: 90,
    custo: 40,
  });
  await registroAntigo({
    descricao: `${C} antigo B`,
    executadoEm: "2027-04-28",
    receita: 100,
    custo: 70,
    competencia: { inicio: "2027-05-01", fim: "2027-05-15" },
  });
  const idC = await registroAntigo({
    descricao: `${C} antigo C`,
    executadoEm: "2027-05-07",
    receita: 500,
    custo: 300,
  });
  const api = await sessaoApi("ADMIN");
  const canc = await api.rpc("cancelar_servico_container", {
    p_id: idC,
    p_reason: "E2E CP-08: cancelado",
  });
  await api.auth.signOut({ scope: "local" });
  expect(canc.error).toBeNull();

  const a = apontamentos(Q1.inicio, Q1.fim);
  expect({ receita: brl2(a.receita), custo: brl2(a.custo), presentes: a.presentes }).toEqual({
    receita: "2252.50", // fixa 1.972,50 + avulsa 280,00
    custo: "1403.33", // fixa 1.273,33 + avulsa 130,00
    presentes: 8,
  });
  const ad = adicionais(Q1.inicio, Q1.fim);
  expect({ receita: brl2(ad.receita), custo: brl2(ad.custo) }).toEqual({
    receita: "250.00", // manual 60 + antigo A 90 + antigo B 100
    custo: "110.00", // A 40 + B 70 (B entra pela competência, como a receita dele)
  });
});

// =============================================================================================
// DASHBOARD
// =============================================================================================

test("DB1 Dashboard da 1ª quinzena: receita, custo, resultado, margem, diárias, faltas, HE e colaboradores ao centavo", async ({
  page,
}) => {
  const a = apontamentos(Q1.inicio, Q1.fim);
  const ad = adicionais(Q1.inicio, Q1.fim);
  const receita = a.receita + ad.receita;
  const custo = a.custo + ad.custo;
  expect({ receita: brl2(receita), custo: brl2(custo) }).toEqual({
    receita: "2502.50",
    custo: "1513.33",
  });
  await abrirDashboard(page, Q1.inicio, Q1.fim);
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(receita / 100), {
    timeout: 30_000,
  });
  await expect(valorDoCartao(page, "Custo")).toHaveText(reais(custo / 100));
  await expect(valorDoCartao(page, "Margem")).toHaveText(reais((receita - custo) / 100));
  await expect(page.getByText("39,5%").first()).toBeVisible();
  await expect(valorDoCartao(page, "Diárias")).toHaveText(String(a.presentes));
  await expect(valorDoCartao(page, "Faltas")).toHaveText(String(a.linhas - a.presentes));
  await expect(valorDoCartao(page, "Colaboradores")).toHaveText("4");
  // HE cobrada: Hana 90 min (80 executados, bloco de 30) e Ivo no sábado 60 min = 2,5 h.
  await expect(valorDoCartao(page, "Horas extras")).toHaveText("2,5 h");
});

test("DB2 gráficos por apontamento dizem que não incluem adicionais nem serviços antigos; Fixa × Avulsa sem Contêineres", async ({
  page,
}) => {
  await abrirDashboard(page, Q1.inicio, Q1.fim);
  await expect(valorDoCartao(page, "Receita")).toBeVisible({ timeout: 30_000 });
  for (const titulo of [
    "Receita x custo por cliente",
    "Diárias por dia",
    "Receita por tipo de operação",
  ]) {
    const card = page
      .locator("div.rounded-2xl, div.rounded-xl")
      .filter({ hasText: titulo })
      .first();
    await expect(card, titulo).toContainText(/somente (dos )?apontamentos/i);
  }
  await expect(
    page.getByText(/contêiner/i).filter({ hasText: /modalidade|tipo de operação/i }),
  ).toHaveCount(0);
});

test("DB3 períodos: dia único, 2ª quinzena, mês, sem dados, período invertido e competência ≠ execução", async ({
  page,
}) => {
  // Dia único (feriado): só Gil, em dobro.
  await abrirDashboard(page, FERIADO, FERIADO);
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(480), { timeout: 30_000 });
  await expect(valorDoCartao(page, "Custo")).toHaveText(reais(300));
  // 2ª quinzena de maio: só o adicional cobrado na 2ª quinzena (R$ 45), sem custo.
  await abrirDashboard(page, "2027-05-16", "2027-05-31");
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(45), { timeout: 30_000 });
  await expect(valorDoCartao(page, "Custo")).toHaveText(reais(0));
  // Mês inteiro.
  await abrirDashboard(page, "2027-05-01", "2027-05-31");
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(2547.5), { timeout: 30_000 });
  await expect(valorDoCartao(page, "Custo")).toHaveText(reais(1513.33));
  // 2ª quinzena de abril: o antigo B foi EXECUTADO em 28/04, mas é cobrado em maio. Receita e
  // custo dele ficam juntos na competência de cobrança (como no Fechamento e na fatura).
  await abrirDashboard(page, "2027-04-16", "2027-04-30");
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(0), { timeout: 30_000 });
  await expect(valorDoCartao(page, "Custo")).toHaveText(reais(0));
  // Período invertido: a tela diz o que está errado, sem números.
  await abrirDashboard(page, "2027-05-15", "2027-05-01");
  await expect(page.getByText(/data inicial é posterior à final/i).first()).toBeVisible();
  await expect(valorDoCartao(page, "Receita")).toHaveCount(0);
});

// =============================================================================================
// RELATÓRIOS
// =============================================================================================

test("RL1 Relatórios: totais, por colaborador e por operação (com modalidade) batem com o cálculo", async ({
  page,
}) => {
  const a = apontamentos(Q1.inicio, Q1.fim);
  const ad = adicionais(Q1.inicio, Q1.fim);
  await abrirRelatorios(page, Q1.inicio, Q1.fim);
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais((a.receita + ad.receita) / 100), {
    timeout: 30_000,
  });
  await expect(page.getByText(`custo ${"R$"}`).first()).toBeVisible();
  await expect(page.getByText(/custo R\$\s?1\.513,33/).first()).toBeVisible();
  await expect(valorDoCartao(page, "Margem")).toHaveText(
    reais((a.receita + ad.receita - a.custo - ad.custo) / 100),
  );
  for (const [nome, v] of a.porColaborador) {
    const tr = page.locator("tr").filter({ hasText: nome }).first();
    await expect(tr, nome).toContainText(reais(v.receita / 100));
    await expect(tr, nome).toContainText(reais(v.custo / 100));
  }
  await page.getByRole("tab", { name: "Por operação" }).click();
  for (const [nome, v] of a.porOperacao) {
    const tr = page.locator("tr").filter({ hasText: nome }).first();
    await expect(tr, nome).toContainText(reais(v.receita / 100));
    await expect(tr, nome).toContainText(reais(v.custo / 100));
    await expect(tr, `${nome}: modalidade`).toContainText(nome === OP ? "Fixa" : "Avulsa");
  }
});

test("RL2 Relatórios: período invertido explica o erro; sem dados mostra zero, sem inventar", async ({
  page,
}) => {
  await abrirRelatorios(page, "2027-05-15", "2027-05-01");
  await expect(page.getByText(/data inicial é posterior à final/i).first()).toBeVisible();
  await expect(valorDoCartao(page, "Receita")).toHaveCount(0);
  await abrirRelatorios(page, "2027-06-01", "2027-06-15");
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(0), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Exportar/ })).toBeDisabled();
});

// =============================================================================================
// FECHAMENTO E FATURAMENTO × DASHBOARD (mesmos números por cliente)
// =============================================================================================

test("FC1 Fechamento e Faturamento por cliente somam o mesmo que Dashboard e Relatórios", async ({
  page,
}) => {
  let receita = 0;
  let custo = 0;
  for (const cliente of [CLI, CLI_AV]) {
    const a = apontamentos(Q1.inicio, Q1.fim, cliente);
    const ad = adicionais(Q1.inicio, Q1.fim, cliente);
    const r = a.receita + ad.receita;
    const c = a.custo + ad.custo;
    receita += r;
    custo += c;
    await gerarFechamento(page, { cliente, mes: 5, ano: 2027 });
    await expect(valorDoCartao(page, "Receita total"), `${cliente}: fechamento`).toHaveText(
      reais(r / 100),
    );
    await expect(valorDoCartao(page, "Custo previsto"), `${cliente}: fechamento`).toHaveText(
      reais(c / 100),
    );
    await abrirFaturamento(page, { cliente, ...Q1 });
    await expect(valorDoCartao(page, "Total a faturar"), `${cliente}: faturamento`).toHaveText(
      reais(r / 100),
    );
  }
  expect({ receita: brl2(receita), custo: brl2(custo) }).toEqual({
    receita: "2502.50",
    custo: "1513.33",
  });
});

// =============================================================================================
// EXPORTAÇÕES
// =============================================================================================

test("EX1 CSV dos Relatórios: extrato de lançamentos com modalidade, presença e situação em português, totais ao centavo", async ({
  page,
}) => {
  const a = apontamentos(Q1.inicio, Q1.fim);
  await abrirRelatorios(page, Q1.inicio, Q1.fim);
  await expect(valorDoCartao(page, "Receita")).toBeVisible({ timeout: 30_000 });
  const botao = page.getByRole("button", { name: "Exportar lançamentos (CSV)" });
  await expect(botao).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), botao.click()]);
  expect(download.suggestedFilename()).toBe("lancamentos-2027-05-01-2027-05-15.csv");
  const csv = linhasDoCsv(await download.path()).filter((l) => l.some((c) => c !== ""));
  const [cab, ...linhas] = csv;
  for (const coluna of [
    "Data",
    "Cliente",
    "Modalidade",
    "Operação",
    "Colaborador",
    "Presença",
    "Receita",
    "Custo",
    "Faturado",
  ]) {
    expect(cab, `coluna ${coluna}`).toContain(coluna);
  }
  const i = (col: string) => cab!.indexOf(col);
  // Só os clientes deste arquivo (outros arquivos não usam maio de 2027).
  expect(linhas).toHaveLength(a.linhas);
  expect(new Set(linhas.map((l) => l[i("Presença")]))).toEqual(
    new Set(["Presente", "Falta", "Substituição"]),
  );
  expect(new Set(linhas.map((l) => l[i("Modalidade")]))).toEqual(new Set(["Fixa", "Avulsa"]));
  expect(new Set(linhas.map((l) => l[i("Faturado")]))).toEqual(new Set(["Não"]));
  const soma = (col: string) =>
    linhas.reduce((acc, l) => acc + Math.round(Number(l[i(col)]) * 100), 0);
  expect(brl2(soma("Receita"))).toBe(brl2(a.receita));
  expect(brl2(soma("Custo"))).toBe(brl2(a.custo));
  // Datas ISO, decimais com ponto (o separador de colunas é ";").
  expect(linhas.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l[i("Data")]!))).toBe(true);
  expect(linhas.every((l) => /^-?\d+\.\d{2}$/.test(l[i("Receita")]!))).toBe(true);
});

test("EX2 Faturamento: o botão diz que exporta só lançamentos (adicionais e serviços antigos ficam no Fechamento)", async ({
  page,
}) => {
  await abrirFaturamento(page, { cliente: CLI_AV, ...Q1 });
  const botao = page.getByRole("button", { name: "Exportar lançamentos (CSV)" });
  await expect(botao).toBeEnabled();
  await expect(botao).toHaveAttribute("title", /adicionais/i);
});

// =============================================================================================
// FATURADO NÃO DUPLICA NEM SOME
// =============================================================================================

test("FT1 depois da fatura do cliente fixo: Dashboard e Relatórios mantêm os totais; lançamentos marcados como faturados", async ({
  page,
}) => {
  const a = apontamentos(Q1.inicio, Q1.fim, CLI);
  const ad = adicionais(Q1.inicio, Q1.fim, CLI);
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  await emitirFatura(page, reais((a.receita + ad.receita) / 100));
  expect(faturasDoCliente(CLI).map((f) => f.total)).toEqual([brl2(a.receita + ad.receita)]);
  await abrirDashboard(page, Q1.inicio, Q1.fim);
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(2502.5), { timeout: 30_000 });
  await expect(valorDoCartao(page, "Custo")).toHaveText(reais(1513.33));
  await abrirRelatorios(page, Q1.inicio, Q1.fim);
  await expect(valorDoCartao(page, "Receita")).toHaveText(reais(2502.5), { timeout: 30_000 });
  await page.getByRole("tab", { name: "Lançamentos" }).click();
  const linhaDoGil = page.locator("tr").filter({ hasText: GIL }).filter({ hasText: "03/05/2027" });
  await expect(linhaDoGil.first()).toContainText(/Faturado|Sim/);
});

// =============================================================================================
// SEGURANÇA
// =============================================================================================

test("SG1 operacional, sem papel e anônimo não leem o resumo financeiro nem os dados dos relatórios pela API", async () => {
  const params = { p_inicio: Q1.inicio, p_fim: Q1.fim };
  for (const conta of ["OPER", "SEMPAPEL"] as const) {
    const api = await sessaoApi(conta);
    const r = await api.rpc("resumo_financeiro_periodo", params);
    expect(r.error, `${conta}: resumo_financeiro_periodo`).not.toBeNull();
    for (const tabela of ["timesheet_entries", "billing_additionals", "container_services"]) {
      const l = await api.from(tabela).select("id").limit(5);
      expect(l.data ?? [], `${conta}: ${tabela}`).toEqual([]);
    }
    await api.auth.signOut({ scope: "local" });
  }
  const anon = clienteApi();
  const r = await anon.rpc("resumo_financeiro_periodo", params);
  expect(r.error, "anônimo: resumo_financeiro_periodo").not.toBeNull();
});
