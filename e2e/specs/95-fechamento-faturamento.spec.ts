import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { linhasDoCsv } from "../apoio/arquivos";
import { faturasDoCliente, lit } from "../apoio/banco";
import { MENSAGEM_CRUA, clienteApi, sessaoApi, textoDoAviso } from "../apoio/contas";
import { consultar, estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirDia,
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
  escolher,
  esperarAviso,
  esperarFechar,
  gerarFechamento,
  lancarDia,
  reais,
  registrarAdicional,
  valorDoCartao,
} from "../apoio/telas";
import { prepararLoteDeContainers } from "../../src/lib/container-servico";

/**
 * CP-07 — Fechamento e faturamento. Cliente → contrato → operação fixa e avulsa → apontamentos →
 * valores e custos → fechamento → competência → fatura → exportação, conferidos por um CÁLCULO
 * INDEPENDENTE (as regras de `docs/NEGOCIO.md` §10 e a regra V2 aprovada, como no CP-05, aqui
 * com o custo de cada colaborador), pelo banco local e pela tela.
 *
 * Configuração = Production (semente E2E): motor por vigência LIGADO, resolução de tarifas
 * DESLIGADA, domingo e feriado em dobro LIGADO. Contrato pela tela: fator 1,5, tolerância 10 min,
 * HE no modo diário. Datas de janeiro a março de 2027, que nenhum outro arquivo usa; 01/01/2027
 * (sexta) vira feriado aqui.
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP07`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const CLI_MENSAL = `${C} Mensal`;
const CTR_MENSAL = `${C} Contrato Mensal`;
const CLI_DUP = `${C} Dup`;
const OP = `${C} Op Fixa`;
const AVULSA = `${C} Contêiner 20 pés — caixas`;
const AVULSA_DUP = `${C} Contêiner 40 pés — Dup`;
const DIA = "Dia CP07"; // 08:00–17:00, 60 min
const DIA_AV = "Avulso CP07"; // 08:00–17:00, 60 min
const DIA_DUP = "Dup CP07";

const ANA = `${C} Ana`;
const BETO = `${C} Beto`;
const CAIO = `${C} Caio`;
const DAVI = `${C} Davi`;
const EDU = `${C} Edu`;
const FABIO = `${C} Fábio`;
const EQUIPE = [ANA, BETO, CAIO];

const DIARIA = 240;
const DIARIA_AVULSA = 300;
const CUSTO: Record<string, number> = {
  [ANA]: 150,
  [BETO]: 180,
  [CAIO]: 120,
  [DAVI]: 130,
  [EDU]: 110,
  [FABIO]: 100,
};
/** Caio passa a custar R$ 140 a partir de 06/01/2027 (vigência). */
const CAIO_REAJUSTE = { desde: "2027-01-06", custo: 140 };
const FERIADO = "2027-01-01";
const Q1 = { inicio: "2027-01-01", fim: "2027-01-15" };
const ADICIONAL = 75;
const LEGADO = { receita: 90, custo: 40 };

// =============================================================================================
// CÁLCULO INDEPENDENTE (não importa o núcleo financeiro do sistema)
// =============================================================================================

type Tipo = "util" | "sabado" | "domingo" | "feriado";

function tipoDaData(data: string): Tipo {
  if (data === FERIADO) return "feriado";
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dow === 0 ? "domingo" : dow === 6 ? "sabado" : "util";
}

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
/** Meio centavo para cima, sobre a fração exata `num / den`. */
const arred = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
/** HE cobrada no modo diário: fração < 15 min = 0; 15–44 = 30; ≥ 45 = 60. */
function blocosDaHora(m: number) {
  const r = m % 60;
  return Math.floor(m / 60) * 60 + (r < 15 ? 0 : r < 45 ? 30 : 60);
}

function custoDe(colaborador: string, data: string) {
  if (colaborador === CAIO && data >= CAIO_REAJUSTE.desde) return CAIO_REAJUSTE.custo;
  return CUSTO[colaborador]!;
}

/** Centavos de receita e custo de um lançamento (NEGOCIO §10 + V2), sem arredondar o período. */
function esperado(o: {
  colaborador: string;
  data: string;
  status: string;
  entrada: string | null;
  saida: string | null;
  intervalo: number;
  diaria: number;
}): { receita: number; custo: number } {
  if (o.status === "absent") return { receita: 0, custo: 0 };
  const ini = min(o.entrada!);
  let fim = min(o.saida!);
  if (fim <= ini) fim += 1440;
  const w = fim - ini - o.intervalo;
  const d = o.diaria * 100;
  const c = custoDe(o.colaborador, o.data) * 100;
  const tipo = tipoDaData(o.data);
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

// =============================================================================================
// Leituras do banco local
// =============================================================================================

type Gravado = {
  colaborador: string;
  operacao: string;
  data: string;
  status: string;
  entrada: string | null;
  saida: string | null;
  intervalo: number;
  receita: string;
  custo: string;
  faturado: boolean;
  folha: string;
};

function gravados(cliente: string, inicio: string, fim: string): Gravado[] {
  return consultar<Gravado>(`
    select e.name as colaborador, o.name as operacao, to_char(t.work_date,'YYYY-MM-DD') as data,
           te.status::text as status, to_char(te.check_in,'HH24:MI') as entrada,
           to_char(te.check_out,'HH24:MI') as saida, te.break_minutes as intervalo,
           te.billed_amount::numeric(12,2)::text as receita,
           te.cost_amount::numeric(12,2)::text as custo, te.invoice_id is not null as faturado,
           t.status::text as folha
      from public.timesheet_entries te
      join public.employees e on e.id = te.employee_id
      join public.timesheets t on t.id = te.timesheet_id
      join public.operations o on o.id = t.operation_id
      join public.clients c on c.id = o.client_id
     where c.name = ${lit(cliente)} and t.work_date between ${lit(inicio)} and ${lit(fim)}
     order by t.work_date, o.name, e.name`);
}

function idDe(tabela: "clients" | "operations" | "employees" | "shifts", nome: string): string {
  const [l] = consultar<{ id: string }>(
    `select id from public.${tabela} where name = ${lit(nome)}`,
  );
  expect(l, `${tabela} "${nome}" existe`).toBeDefined();
  return l!.id;
}

function adicionaisDoCliente(cliente: string) {
  return consultar<{ valor: string; faturado: boolean; cancelado: boolean; motivo: string }>(`
    select a.amount::numeric(12,2)::text as valor, a.invoice_id is not null as faturado,
           a.canceled_at is not null as cancelado, a.description as motivo
      from public.billing_additionals a join public.clients c on c.id = a.client_id
     where c.name = ${lit(cliente)} order by a.created_at`);
}

/** Total esperado de uma competência, pelo cálculo independente sobre os horários gravados. */
function esperadoDoPeriodo(cliente: string, inicio: string, fim: string, soPendentes = true) {
  let receita = 0;
  let custo = 0;
  let lancamentos = 0;
  for (const g of gravados(cliente, inicio, fim)) {
    if (g.status === "absent" || (soPendentes && g.faturado)) continue;
    const e = esperado({
      ...g,
      diaria: g.operacao === AVULSA || g.operacao === AVULSA_DUP ? DIARIA_AVULSA : DIARIA,
    });
    expect(`${g.receita}/${g.custo}`, `${g.colaborador} ${g.data} (banco × cálculo)`).toBe(
      `${brl2(e.receita)}/${brl2(e.custo)}`,
    );
    receita += e.receita;
    custo += e.custo;
    lancamentos += 1;
  }
  return { receita, custo, lancamentos };
}

/** Lança o dia da equipe fixa: quem não trabalha entra como falta (o "Salvar" grava a equipe). */
async function lancarFixa(
  page: Page,
  data: string,
  presentes: { colaborador: string; entrada: string; saida: string; intervalo: number }[],
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

async function fecharDia(page: Page, o: { operacao: string; turno: string; data: string }) {
  await abrirDia(page, o);
  await page.getByRole("button", { name: "Fechar dia" }).click();
  await esperarAviso(page, "Status do apontamento atualizado.");
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeVisible();
}

async function abrirConfirmacao(page: Page) {
  await page.getByRole("button", { name: "Gerar fatura" }).click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao.getByRole("heading", { name: "Emitir fatura?" })).toBeVisible({
    timeout: 30_000,
  });
  return confirmacao;
}

function faturasDaCompetencia(cliente: string, inicio: string, fim: string) {
  return faturasDoCliente(cliente).filter((f) => f.inicio === inicio && f.fim === fim);
}

// =============================================================================================
// PREPARAÇÃO
// =============================================================================================

test("PR preparação: clientes quinzenal e mensal, contrato 240, fixa e avulsa, seis colaboradores, feriado e reajuste", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: DIARIA, inicio: "2026-12-01" });

  // Cliente mensal: a frequência é escolhida no cadastro do contrato (038).
  await criarCliente(page, CLI_MENSAL);
  await page.goto("/clientes");
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
  await page.getByRole("button", { name: "Novo contrato" }).click();
  const d = dialogo(page);
  await escolher(page, campo(d, "Cliente"), CLI_MENSAL);
  await campo(d, "Nome do contrato").fill(CTR_MENSAL);
  await campo(d, "Valor da diária (R$)").fill("200");
  await campo(d, "Início do contrato").fill("2026-12-01");
  await d.locator("#contrato-closing_period").selectOption("mensal");
  await d.getByRole("button", { name: "Salvar contrato" }).click();
  await esperarFechar(page);

  await criarCliente(page, CLI_DUP);

  for (const nome of Object.keys(CUSTO)) {
    await criarColaborador(page, { nome, custo: CUSTO[nome]!, desde: "2026-12-01" });
  }
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, { operacao: OP, nome: DIA, inicio: "08:00", fim: "17:00", intervalo: 60 });
  for (const nome of EQUIPE) await alocar(page, { operacao: OP, colaborador: nome, turno: DIA });

  await criarOperacao(page, {
    cliente: CLI,
    nome: AVULSA,
    tipo: "Avulsa",
    valor: DIARIA_AVULSA,
    data: "2027-01-08",
  });
  await criarTurno(page, {
    operacao: AVULSA,
    nome: DIA_AV,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  for (const nome of [DAVI, EDU]) {
    await alocar(page, { operacao: AVULSA, colaborador: nome, turno: DIA_AV });
  }

  await criarOperacao(page, {
    cliente: CLI_DUP,
    nome: AVULSA_DUP,
    tipo: "Avulsa",
    valor: DIARIA_AVULSA,
    data: "2027-01-12",
  });
  await criarTurno(page, {
    operacao: AVULSA_DUP,
    nome: DIA_DUP,
    inicio: "08:00",
    fim: "17:00",
    intervalo: 60,
  });
  await alocar(page, { operacao: AVULSA_DUP, colaborador: FABIO, turno: DIA_DUP });

  await cadastrarFeriado(page, { data: FERIADO, nome: `${C} Confraternização` });

  const { botao } = await alterarCusto(page, {
    colaborador: CAIO,
    inicio: CAIO_REAJUSTE.desde,
    custo: CAIO_REAJUSTE.custo,
    botaoEsperado: "Salvar novo valor",
  });
  await botao.click();
  await expect(page.getByText("Novo valor salvo.").first()).toBeVisible({ timeout: 20_000 });

  const [k] = consultar<{ fator: string; tol: number; modo: string; freq: string }>(`
    select ct.ot_factor::numeric(5,2)::text as fator, ct.ot_tolerance_min as tol,
           ct.ot_rounding_mode as modo, ct.closing_period as freq
      from public.contract_terms ct join public.contracts c on c.id = ct.contract_id
     where c.name = ${lit(CTR)} and ct.active`);
  expect(k).toEqual({ fator: "1.50", tol: 10, modo: "diario", freq: "quinzenal" });
  const [m] = consultar<{ freq: string }>(`
    select ct.closing_period as freq from public.contract_terms ct
      join public.contracts c on c.id = ct.contract_id
     where c.name = ${lit(CTR_MENSAL)} and ct.active`);
  expect(m?.freq).toBe("mensal");
});

// D-CP07-07 (achado na CI do CP-07, CN-C da spec 70 intermitente): "Alterar condições" abria antes
// de o valor atual carregar e o formulário nascia VAZIO — inclusive os campos ocultos, que a pessoa
// não consegue preencher —, com "Salvar novo valor" desabilitado para sempre. Nada é gravado aqui.
test("VA1 “Alterar condições” só abre depois de carregar o valor atual: formulário nunca nasce vazio", async ({
  page,
}) => {
  let liberar: () => void = () => {};
  const segurar = new Promise<void>((r) => (liberar = r));
  await page.route("**/rest/v1/contract_terms*", async (rota) => {
    await segurar;
    await rota.continue();
  });
  await page.goto("/clientes");
  await page.getByRole("tab", { name: "Contratos e regras" }).click();
  await page.getByRole("button", { name: `Editar ${CTR}`, exact: true }).click();
  const d = dialogo(page);
  await expect(d.getByText("Carregando…").first()).toBeVisible();
  await expect(d.getByRole("button", { name: "Alterar condições" })).toBeDisabled();
  liberar();
  // O contrato começa em 01/12/2026, depois do "hoje" do relógio: a tela diz que não há valor de
  // hoje — mas já leu as versões, e só então libera o botão.
  await expect(d.getByText("Carregando…")).toHaveCount(0, { timeout: 20_000 });
  await page.unroute("**/rest/v1/contract_terms*");
  await expect(d.getByRole("button", { name: "Alterar condições" })).toBeEnabled();
  await d.getByRole("button", { name: "Alterar condições" }).click();
  const alt = dialogo(page);
  // Na data da versão existente, o formulário vem com os valores dela e é salvável (não grava).
  await alt.locator("#valor-atual-inicio").fill("2026-12-01");
  await expect(alt.locator("#valor-atual-daily_rate")).toHaveValue(/^240(\.0+)?$/);
  await expect(alt.getByRole("button", { name: "Corrigir valor" })).toBeEnabled();
  await alt.getByRole("button", { name: "Cancelar" }).click();
});

// =============================================================================================
// LANÇAMENTOS DA 1ª QUINZENA DE JANEIRO/2027
// =============================================================================================

test("AP lançamentos da competência: feriado, sábado, domingo, falta, saída antecipada, HE, reajuste, avulso, adicional e registro antigo", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const h = (colaborador: string, entrada = "08:00", saida = "17:00", intervalo = 60) => ({
    colaborador,
    entrada,
    saida,
    intervalo,
  });
  await lancarFixa(page, "2027-01-01", [h(ANA)]); // feriado: dobro, sem diária
  await lancarFixa(page, "2027-01-02", [h(ANA, "08:00", "13:00", 0)]); // sábado: 5 h
  await lancarFixa(page, "2027-01-03", [h(BETO, "08:00", "12:00", 0)]); // domingo: 4 h
  await lancarFixa(page, "2027-01-04", [h(ANA), h(CAIO, "08:00", "15:00", 60)]); // Beto falta; Caio sai cedo
  await lancarFixa(page, "2027-01-05", [h(ANA, "08:00", "18:20", 60), h(BETO)]); // HE 80 min
  await lancarFixa(page, "2027-01-06", [h(ANA), h(CAIO)]); // Caio com o custo novo
  await lancarDia(page, {
    operacao: AVULSA,
    turno: DIA_AV,
    data: "2027-01-08",
    linhas: [h(DAVI), h(EDU)],
  });

  // Dias fechados: 01 a 05 e o avulso de 08. O 06 continua ABERTO (D4).
  for (const data of ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05"]) {
    await fecharDia(page, { operacao: OP, turno: DIA, data });
  }
  await fecharDia(page, { operacao: AVULSA, turno: DIA_AV, data: "2027-01-08" });

  // Adicional manual da competência.
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  await registrarAdicional(page, {
    inicio: "2027-01-04",
    fim: "2027-01-08",
    mesCompetencia: "2027-01",
    motivo: `${C} taxa de acesso ao porto`,
    valor: ADICIONAL,
  });

  // Registro antigo de contêiner (histórico legado), sem operação, a faturar nesta competência.
  const api = await sessaoApi("ADMIN");
  const { error } = await api.rpc("registrar_servico_container", {
    p_dados: prepararLoteDeContainers({
      clienteId: idDe("clients", CLI),
      operacaoId: null,
      solicitadoEm: "2027-01-09",
      executadoEm: "2027-01-09",
      descricao: `${C} contêiner antigo a faturar`,
      quantidade: 1,
      totalCobrado: String(LEGADO.receita),
      participantes: [{ colaboradorId: idDe("employees", EDU), valorDevido: String(LEGADO.custo) }],
      modalidadeCusto: "por_pessoa",
    }),
    p_idempotency_key: randomUUID(),
    p_reason: "E2E CP-07: registro antigo a faturar",
  });
  expect(error).toBeNull();
  await api.auth.signOut({ scope: "local" });

  // Cada lançamento gravado bate com o cálculo independente; as folhas estão como esperado.
  const linhas = gravados(CLI, Q1.inicio, Q1.fim);
  expect(linhas.filter((l) => l.status !== "absent")).toHaveLength(11);
  expect(linhas.filter((l) => l.status === "absent")).toHaveLength(9);
  const totais = esperadoDoPeriodo(CLI, Q1.inicio, Q1.fim);
  expect({ receita: brl2(totais.receita), custo: brl2(totais.custo) }).toEqual({
    receita: "3052.50", // fixa 2.452,50 + avulso 600,00
    custo: "1773.75", // fixa 1.533,75 + avulso 240,00
  });
  const abertas = [...new Set(linhas.filter((l) => l.folha === "open").map((l) => l.data))];
  expect(abertas).toEqual(["2027-01-06"]);
});

// =============================================================================================
// COMPETÊNCIAS E PERÍODOS
// =============================================================================================

test("CP1 competências: quinzenal e mensal na tela e no banco (janeiro, fevereiro comum e bissexto, viradas)", async ({
  page,
}) => {
  const quinzenas = (ano: number, mes: number) => {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const mm = String(mes).padStart(2, "0");
    return [
      [`01/${mm}/${ano}`, `15/${mm}/${ano}`],
      [`16/${mm}/${ano}`, `${ultimo}/${mm}/${ano}`],
    ];
  };
  await abrirFaturamento(page, { cliente: CLI, inicio: "2027-01-01", fim: "2027-01-15" });
  await expect(page.getByText("Fechamento quinzenal")).toBeVisible({ timeout: 20_000 });
  for (const [ano, mes, inicio] of [
    [2027, 1, "2027-01-01"],
    [2027, 2, "2027-02-01"], // fevereiro comum: 16 a 28
    [2028, 2, "2028-02-10"], // fevereiro bissexto: 16 a 29
    [2026, 12, "2026-12-20"], // virada de ano: 16 a 31/12
  ] as const) {
    await campo(page, "De").fill(inicio);
    for (const [a, b] of quinzenas(ano, mes)) {
      await expect(page.getByRole("button", { name: `${a} a ${b}` })).toBeVisible();
    }
  }
  // Clicar na competência preenche o período inteiro e libera o botão.
  await campo(page, "De").fill("2028-02-01");
  await page.getByRole("button", { name: "16/02/2028 a 29/02/2028" }).click();
  await expect(campo(page, "De")).toHaveValue("2028-02-16");
  await expect(campo(page, "Até")).toHaveValue("2028-02-29");

  // Período personalizado: a tela explica e não deixa gerar.
  await campo(page, "De").fill("2027-01-05");
  await campo(page, "Até").fill("2027-01-20");
  await expect(page.getByText(/A fatura é uma competência inteira: 1 a 15 ou 16/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();

  // Cliente mensal: uma competência, do dia 1 ao último dia.
  await abrirFaturamento(page, { cliente: CLI_MENSAL, inicio: "2028-02-01", fim: "2028-02-15" });
  await expect(page.getByText("Fechamento mensal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "01/02/2028 a 29/02/2028" })).toBeVisible();
  await expect(page.getByText(/do dia 1 ao último dia do mês/)).toBeVisible();

  // A RPC usa a MESMA definição (038): as janelas da tela são válidas no banco; as outras, não.
  const janelas = consultar<{ f: string; i: string; e: string; ok: boolean }>(`
    select f, i, e, public.janela_de_cobranca_valida(f, i::date, e::date) as ok from (values
      ('quinzenal','2027-01-01','2027-01-15'), ('quinzenal','2027-01-16','2027-01-31'),
      ('quinzenal','2027-02-16','2027-02-28'), ('quinzenal','2028-02-16','2028-02-29'),
      ('quinzenal','2028-02-16','2028-02-28'), ('quinzenal','2026-12-16','2026-12-31'),
      ('quinzenal','2027-01-05','2027-01-20'), ('quinzenal','2027-01-16','2027-02-15'),
      ('mensal','2028-02-01','2028-02-29'), ('mensal','2027-01-01','2027-01-15')) v(f, i, e)`);
  expect(janelas.map((j) => `${j.f} ${j.i} ${j.e} ${j.ok}`)).toEqual([
    "quinzenal 2027-01-01 2027-01-15 true",
    "quinzenal 2027-01-16 2027-01-31 true",
    "quinzenal 2027-02-16 2027-02-28 true",
    "quinzenal 2028-02-16 2028-02-29 true",
    "quinzenal 2028-02-16 2028-02-28 false",
    "quinzenal 2026-12-16 2026-12-31 true",
    "quinzenal 2027-01-05 2027-01-20 false",
    "quinzenal 2027-01-16 2027-02-15 false",
    "mensal 2028-02-01 2028-02-29 true",
    "mensal 2027-01-01 2027-01-15 false",
  ]);

  // Pela API (admin), o banco recusa o que a tela não deixa pedir, em português.
  const api = await sessaoApi("ADMIN");
  const cliente = idDe("clients", CLI);
  const tentar = (i: string, e: string, c = cliente) =>
    api.rpc("gerar_fatura", { _client_id: c, _period_start: i, _period_end: e });
  const personalizado = await tentar("2027-01-05", "2027-01-20");
  expect(personalizado.error?.code).toBe("22023");
  expect(personalizado.error?.message).toMatch(/não é uma competência quinzenal/);
  const atravessa = await tentar("2027-01-16", "2027-02-15");
  expect(atravessa.error?.code).toBe("22023");
  expect(atravessa.error?.message).toMatch(/atravessa o mês/);
  const mensalQuinzena = await tentar("2027-01-01", "2027-01-15", idDe("clients", CLI_MENSAL));
  expect(mensalQuinzena.error?.message).toMatch(/não é uma competência mensal/);
  // Sem registros e antes do contrato: nada a faturar (P0002), nenhuma fatura criada.
  const vazio = await tentar("2027-02-16", "2027-02-28");
  expect(vazio.error?.code).toBe("P0002");
  const antesDoContrato = await tentar("2026-11-01", "2026-11-15");
  expect(antesDoContrato.error?.code).toBe("P0002");
  await api.auth.signOut({ scope: "local" });
  expect(faturasDoCliente(CLI)).toHaveLength(0);
  expect(faturasDoCliente(CLI_MENSAL)).toHaveLength(0);
});

// =============================================================================================
// FECHAMENTO E CONCILIAÇÃO
// =============================================================================================

test("FE1 fechamento da competência: receita e custo ao centavo (fixa + avulso + adicional + registro antigo) e alerta de folha aberta", async ({
  page,
}) => {
  const t = esperadoDoPeriodo(CLI, Q1.inicio, Q1.fim);
  const receita = t.receita + ADICIONAL * 100 + LEGADO.receita * 100;
  const custo = t.custo + LEGADO.custo * 100;
  expect({ receita: brl2(receita), custo: brl2(custo) }).toEqual({
    receita: "3217.50",
    custo: "1813.75",
  });
  await gerarFechamento(page, { cliente: CLI, mes: 1, ano: 2027 });
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(receita / 100));
  await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(custo / 100));
  await expect(page.getByText(/folha.*aberta|aberta/i).first()).toBeVisible();

  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(receita / 100));
  await expect(valorDoCartao(page, "Margem")).toHaveText(reais((receita - custo) / 100));
});

test("EX1 exportações da competência: Faturamento CSV com nome do cliente, presença em português e totais; Fechamento CSV diário", async ({
  page,
}) => {
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar lançamentos (CSV)" }).click(),
  ]);
  const nome = download.suggestedFilename();
  expect(nome, "nome do arquivo identifica cliente e período").toMatch(/cp07-cliente/i);
  expect(nome).toContain("2027-01-01");
  expect(nome).toContain("2027-01-15");
  const csv = linhasDoCsv(await download.path());
  const [cab, ...linhas] = csv.filter((l) => l.some((c) => c !== ""));
  expect(cab).toContain("Presença");
  const iPresenca = cab!.indexOf("Presença");
  const iValor = cab!.indexOf("Valor faturado");
  const iCusto = cab!.indexOf("Custo");
  expect(linhas).toHaveLength(11);
  expect(new Set(linhas.map((l) => l[iPresenca]))).toEqual(new Set(["Presente"]));
  const soma = (i: number) => linhas.reduce((acc, l) => acc + Math.round(Number(l[i]) * 100), 0);
  expect(brl2(soma(iValor))).toBe("3052.50");
  expect(brl2(soma(iCusto))).toBe("1773.75");

  await gerarFechamento(page, { cliente: CLI, mes: 1, ano: 2027 });
  await page.getByRole("button", { name: /Baixar CSV/ }).click();
  const [d2] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Detalhamento diário/ }).click(),
  ]);
  expect(d2.suggestedFilename()).toMatch(/^fechamento-.*2027-01-01-2027-01-15-diario\.csv$/);
  const diario = linhasDoCsv(await d2.path())
    .map((l) => l.join(";"))
    .join("\n");
  for (const nome of [ANA, BETO, CAIO, DAVI, EDU]) expect(diario).toContain(nome);
});

// =============================================================================================
// D4 — DIAS AINDA ABERTOS NA CONFIRMAÇÃO
// =============================================================================================

test("D4 a confirmação distingue dias fechados, abertos e sem apontamento, sem bloquear, e lê o estado atual", async ({
  page,
}) => {
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  const confirmacao = await abrirConfirmacao(page);
  // 7 dias com apontamento a faturar (01–06 e 08): 6 fechados, 1 aberto; 8 dias sem apontamento.
  await expect(confirmacao).toContainText(/Dias com apontamento\s*7/);
  await expect(confirmacao).toContainText("6 fechados");
  await expect(confirmacao).toContainText("1 aberto");
  await expect(confirmacao).toContainText(/Dias sem apontamento\s*8/);
  const aviso = confirmacao.getByRole("alert").filter({ hasText: /ainda aberto/i });
  await expect(aviso).toContainText("06/01/2027");
  await expect(aviso).toContainText(OP);
  await expect(aviso).toContainText(DIA);
  // Só avisa: a política de bloqueio não foi decidida.
  await expect(confirmacao.getByRole("button", { name: "Emitir fatura" })).toBeEnabled();
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();

  // Outra aba fecha o dia 06 enquanto esta continua aberta, sem recarregar.
  const outra = await page.context().newPage();
  await fecharDia(outra, { operacao: OP, turno: DIA, data: "2027-01-06" });
  await outra.close();
  const nova = await abrirConfirmacao(page);
  await expect(nova).toContainText("7 fechados");
  await expect(nova).not.toContainText(/ainda aberto/i);
  await nova.getByRole("button", { name: "Cancelar" }).click();

  // E reabre, para a emissão seguir com um dia aberto (a fatura não depende do estado do dia).
  const terceira = await page.context().newPage();
  await abrirDia(terceira, { operacao: OP, turno: DIA, data: "2027-01-06" });
  await terceira.getByRole("button", { name: "Reabrir" }).click();
  await esperarAviso(terceira, "Status do apontamento atualizado.");
  await terceira.close();
  expect(faturasDoCliente(CLI)).toHaveLength(0);
});

// =============================================================================================
// EMISSÃO
// =============================================================================================

test("EM1 emissão: duplo clique e Enter em “Emitir fatura” geram UMA fatura; itens, vínculos e totais ao centavo", async ({
  page,
}) => {
  const t = esperadoDoPeriodo(CLI, Q1.inicio, Q1.fim);
  const total = t.receita + (ADICIONAL + LEGADO.receita) * 100;
  const custo = t.custo + LEGADO.custo * 100;
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  const confirmacao = await abrirConfirmacao(page);
  await expect(confirmacao).toContainText(reais(total / 100));
  await expect(confirmacao).toContainText(/Apontamentos\s*11/);
  await expect(confirmacao).toContainText(/Adicionais\s*2/);
  const emitir = confirmacao.getByRole("button", { name: "Emitir fatura" });
  await emitir.dblclick();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  const aviso = await textoDoAviso(page);
  expect(aviso).toContain("Fatura gerada");
  expect(aviso).not.toMatch(MENSAGEM_CRUA);

  const faturas = faturasDoCliente(CLI);
  expect(faturas).toHaveLength(1);
  expect(faturas[0]).toMatchObject({
    inicio: Q1.inicio,
    fim: Q1.fim,
    total: brl2(total),
    custo: brl2(custo),
    lancamentos: 11,
  });
  const [itens] = consultar<{ soma: string; tipos: string }>(`
    select sum(it.amount)::numeric(12,2)::text as soma,
           string_agg(distinct it.kind, ',' order by it.kind) as tipos
      from public.invoice_items it where it.invoice_id = ${lit(faturas[0]!.id)}`);
  expect(itens?.soma).toBe(brl2(total));
  expect(itens?.tipos).toBe("adicional,diarias,horas_especiais,horas_extras");
  expect(adicionaisDoCliente(CLI).map((a) => [a.valor, a.faturado])).toEqual([
    ["75.00", true],
    ["90.00", true],
  ]);
  expect(
    gravados(CLI, Q1.inicio, Q1.fim).filter((l) => l.status !== "absent" && !l.faturado),
  ).toEqual([]);
  // Faltas não entram no lastro.
  expect(
    gravados(CLI, Q1.inicio, Q1.fim).filter((l) => l.status === "absent" && l.faturado),
  ).toEqual([]);

  // A tela reflete a emissão: nada a faturar e a fatura listada como "Fechada".
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(0));
  await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();
  const linha = page
    .locator("tr")
    .filter({ hasText: CLI })
    .filter({ hasText: "01/01/2027 – 15/01/2027" });
  await expect(linha).toContainText(reais(total / 100));
  await expect(linha).toContainText("Fechada");
});

test("IM1 imutabilidade: fatura, itens, lançamentos, adicional e registro antigo faturados não mudam pela API nem pela tela", async ({
  page,
}) => {
  const [fatura] = faturasDoCliente(CLI);
  expect(fatura).toBeDefined();
  const antes = JSON.stringify({
    f: faturasDoCliente(CLI),
    l: gravados(CLI, Q1.inicio, Q1.fim),
    a: adicionaisDoCliente(CLI),
  });
  const api = await sessaoApi("ADMIN");
  await api.from("invoices").update({ total_amount: 1 }).eq("id", fatura!.id);
  await api.from("invoices").delete().eq("id", fatura!.id);
  await api.from("invoice_items").update({ amount: 1 }).eq("invoice_id", fatura!.id);
  await api.from("invoice_items").delete().eq("invoice_id", fatura!.id);
  // Lançamento com intervalo > 0, escolhido de forma determinística: o trigger da 011 recusa a
  // MUDANÇA da linha faturada; um UPDATE que não muda nada (intervalo já 0) é aceito sem efeito.
  const [lanc] = consultar<{ id: string }>(`
    select te.id from public.timesheet_entries te
     where te.invoice_id = ${lit(fatura!.id)} and te.break_minutes > 0
     order by te.work_date, te.id limit 1`);
  const upd = await api.from("timesheet_entries").update({ break_minutes: 0 }).eq("id", lanc!.id);
  expect(upd.error, "lançamento faturado recusa UPDATE").not.toBeNull();
  // E o UPDATE sem mudança real é aceito, mas não altera nada (conferido no fim do teste).
  const [semIntervalo] = consultar<{ id: string }>(`
    select te.id from public.timesheet_entries te
     where te.invoice_id = ${lit(fatura!.id)} and te.break_minutes = 0
     order by te.work_date, te.id limit 1`);
  expect(semIntervalo, "há lançamento faturado sem intervalo (sábado/domingo)").toBeDefined();
  const noop = await api
    .from("timesheet_entries")
    .update({ break_minutes: 0 })
    .eq("id", semIntervalo!.id);
  expect(noop.error, "UPDATE sem mudança é aceito sem efeito").toBeNull();
  const del = await api.from("timesheet_entries").delete().eq("id", lanc!.id);
  expect(del.error, "lançamento faturado recusa DELETE").not.toBeNull();
  const [adic] = consultar<{ id: string }>(`
    select a.id from public.billing_additionals a where a.invoice_id = ${lit(fatura!.id)}
     order by a.amount limit 1`);
  const cancA = await api.rpc("cancelar_adicional", {
    p_additional_id: adic!.id,
    p_reason: "E2E CP-07: tentar cancelar faturado",
  });
  expect(cancA.error, "adicional faturado não se cancela").not.toBeNull();
  const [servico] = consultar<{ id: string }>(`
    select cs.id from public.container_services cs
      join public.billing_additionals a on a.id = cs.billing_additional_id
     where a.invoice_id = ${lit(fatura!.id)}`);
  const cancS = await api.rpc("cancelar_servico_container", {
    p_id: servico!.id,
    p_reason: "E2E CP-07: tentar cancelar faturado",
  });
  expect(cancS.error, "registro antigo faturado não se cancela").not.toBeNull();
  await api.auth.signOut({ scope: "local" });
  expect(
    JSON.stringify({
      f: faturasDoCliente(CLI),
      l: gravados(CLI, Q1.inicio, Q1.fim),
      a: adicionaisDoCliente(CLI),
    }),
  ).toBe(antes);

  // Reabrir um dia faturado é permitido (estado do dia), mas os lançamentos seguem travados.
  await abrirDia(page, { operacao: OP, turno: DIA, data: "2027-01-05" });
  await page.getByRole("button", { name: "Reabrir" }).click();
  await esperarAviso(page, "Status do apontamento atualizado.");
  await expect(page.getByText(/Faturado/).first()).toBeVisible();
  await expect(
    page.locator("tr").filter({ hasText: ANA }).first().locator("input[type=time]").first(),
  ).toBeDisabled();
  expect(JSON.stringify(gravados(CLI, Q1.inicio, Q1.fim).map((l) => [l.receita, l.custo]))).toBe(
    JSON.stringify(JSON.parse(antes).l.map((l: Gravado) => [l.receita, l.custo])),
  );
});

test("CPL lançamento atrasado numa competência já faturada: a confirmação avisa que a fatura será complementar", async ({
  page,
}) => {
  await lancarFixa(page, "2027-01-07", [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 },
  ]);
  await abrirFaturamento(page, { cliente: CLI, ...Q1 });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(240));
  const confirmacao = await abrirConfirmacao(page);
  await expect(confirmacao).toContainText(/já existe fatura/i);
  await expect(confirmacao).toContainText(reais(3217.5));
  await expect(confirmacao).toContainText(/complementar/i);
  await confirmacao.getByRole("button", { name: "Emitir fatura" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  // O banco aceita a fatura complementar (só os lançamentos novos): sem cobrar de novo o faturado.
  const faturas = faturasDaCompetencia(CLI, Q1.inicio, Q1.fim);
  expect(faturas.map((f) => [f.total, f.lancamentos])).toEqual([
    ["3217.50", 11],
    ["240.00", 1],
  ]);
});

// =============================================================================================
// DUPLICIDADE (CP-06) NA CONFIRMAÇÃO
// =============================================================================================

test("DUP registro antigo ligado à mesma avulsa: a confirmação repete o aviso; o banco ainda emite a fatura em dobro (DEC-CP06-04)", async ({
  page,
}) => {
  await lancarDia(page, {
    operacao: AVULSA_DUP,
    turno: DIA_DUP,
    data: "2027-01-12",
    linhas: [{ colaborador: FABIO, entrada: "08:00", saida: "17:00", intervalo: 60 }],
  });
  const api = await sessaoApi("ADMIN");
  const { error } = await api.rpc("registrar_servico_container", {
    p_dados: prepararLoteDeContainers({
      clienteId: idDe("clients", CLI_DUP),
      operacaoId: idDe("operations", AVULSA_DUP),
      solicitadoEm: "2027-01-12",
      executadoEm: "2027-01-12",
      descricao: `${C} mesmo contêiner (registro antigo)`,
      quantidade: 1,
      totalCobrado: "300",
      participantes: [{ colaboradorId: idDe("employees", FABIO), valorDevido: "100" }],
      modalidadeCusto: "por_pessoa",
    }),
    p_idempotency_key: randomUUID(),
    p_reason: "E2E CP-07: duplicidade",
  });
  expect(error).toBeNull();
  await api.auth.signOut({ scope: "local" });

  await abrirFaturamento(page, { cliente: CLI_DUP, ...Q1 });
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(600));
  const confirmacao = await abrirConfirmacao(page);
  await expect(
    confirmacao.getByRole("alert").filter({ hasText: /cobrado duas vezes/ }),
  ).toContainText(AVULSA_DUP);
  // DEC-CP06-04 pendente: o aviso não bloqueia. Emitir aqui DEMONSTRA o risco: o banco aceita.
  await expect(confirmacao.getByRole("button", { name: "Emitir fatura" })).toBeEnabled();
  await confirmacao.getByRole("button", { name: "Emitir fatura" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  expect(faturasDoCliente(CLI_DUP).map((f) => [f.total, f.custo])).toEqual([["600.00", "200.00"]]);
});

// =============================================================================================
// CONCORRÊNCIA, REDE E ALTERAÇÃO DURANTE A EMISSÃO
// =============================================================================================

test("CC1 duas abas emitem a mesma competência: uma fatura; a outra aba explica e se atualiza", async ({
  page,
}) => {
  const Q2 = { inicio: "2027-01-16", fim: "2027-01-31" };
  await lancarFixa(page, "2027-01-18", [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 },
  ]);
  // Adicional executado em janeiro, com competência de cobrança na 1ª quinzena de fevereiro:
  // não pode entrar na fatura de janeiro.
  await abrirFaturamento(page, { cliente: CLI, ...Q2 });
  await registrarAdicional(page, {
    inicio: "2027-01-28",
    fim: "2027-01-30",
    mesCompetencia: "2027-02",
    motivo: `${C} adicional cobrado em fevereiro`,
    valor: 40,
  });
  const a = page;
  const b = await page.context().newPage();
  await abrirFaturamento(a, { cliente: CLI, ...Q2 });
  await abrirFaturamento(b, { cliente: CLI, ...Q2 });
  await expect(valorDoCartao(a, "Total a faturar")).toHaveText(reais(240));
  await expect(valorDoCartao(b, "Total a faturar")).toHaveText(reais(240));
  const ca = await abrirConfirmacao(a);
  const cb = await abrirConfirmacao(b);
  await Promise.all([
    ca.getByRole("button", { name: "Emitir fatura" }).click(),
    cb.getByRole("button", { name: "Emitir fatura" }).click(),
  ]);
  await expect(a.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  await expect(b.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  expect(faturasDaCompetencia(CLI, Q2.inicio, Q2.fim).map((f) => [f.total, f.lancamentos])).toEqual(
    [["240.00", 1]],
  );
  // A aba que perdeu a corrida explica e passa a mostrar o estado real, sem recarregar.
  for (const p of [a, b]) {
    await expect(valorDoCartao(p, "Total a faturar")).toHaveText(reais(0), { timeout: 20_000 });
    await expect(p.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();
  }
  const textos = await Promise.all(
    [a, b].map((p) => p.locator("[data-sonner-toast]").allInnerTexts()),
  );
  const todos = textos.flat().join("\n");
  expect(todos).toContain("Fatura gerada");
  expect(todos).toMatch(/já foi faturad|nada a faturar/i);
  expect(todos).not.toMatch(MENSAGEM_CRUA);
  await b.close();
});

test("CC2 chamadas simultâneas à RPC pela API: exatamente uma fatura; adicional com competência própria entra na quinzena dele", async () => {
  const Q = { inicio: "2027-02-01", fim: "2027-02-15" };
  const api1 = await sessaoApi("ADMIN");
  const api2 = await sessaoApi("ADMIN");
  const cliente = idDe("clients", CLI);
  const chamar = (api: typeof api1) =>
    api.rpc("gerar_fatura", { _client_id: cliente, _period_start: Q.inicio, _period_end: Q.fim });
  const resultados = await Promise.all([chamar(api1), chamar(api2), chamar(api1)]);
  await api1.auth.signOut({ scope: "local" });
  await api2.auth.signOut({ scope: "local" });
  const ok = resultados.filter((r) => r.error === null);
  const falhas = resultados.filter((r) => r.error !== null);
  expect(ok).toHaveLength(1);
  expect(falhas.map((r) => r.error?.code)).toEqual(["P0002", "P0002"]);
  // Só o adicional de competência fevereiro (R$ 40), executado em janeiro.
  expect(faturasDaCompetencia(CLI, Q.inicio, Q.fim).map((f) => [f.total, f.lancamentos])).toEqual([
    ["40.00", 0],
  ]);
  expect(faturasDaCompetencia(CLI, "2027-01-16", "2027-01-31")[0]?.total).toBe("240.00");
});

test("RD1 falha de rede ao emitir: mensagem em português, nada gravado, nova tentativa emite uma vez", async ({
  page,
}) => {
  const Q = { inicio: "2027-02-16", fim: "2027-02-28" };
  await lancarFixa(page, "2027-02-17", [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 },
  ]);
  await abrirFaturamento(page, { cliente: CLI, ...Q });
  await page.route("**/rest/v1/rpc/gerar_fatura", (rota) => rota.abort("internetdisconnected"));
  let confirmacao = await abrirConfirmacao(page);
  await confirmacao.getByRole("button", { name: "Emitir fatura" }).click();
  const aviso = await textoDoAviso(page);
  expect(aviso).toMatch(/conex/i);
  expect(aviso).not.toMatch(MENSAGEM_CRUA);
  expect(faturasDaCompetencia(CLI, Q.inicio, Q.fim)).toHaveLength(0);
  await page.unroute("**/rest/v1/rpc/gerar_fatura");
  await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeEnabled({ timeout: 20_000 });
  confirmacao = await abrirConfirmacao(page);
  await confirmacao.getByRole("button", { name: "Emitir fatura" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  expect(faturasDaCompetencia(CLI, Q.inicio, Q.fim).map((f) => f.total)).toEqual(["240.00"]);
});

test("RD2 resposta perdida depois de gravar: a tela avisa, mostra a fatura emitida e não oferece emitir de novo", async ({
  page,
}) => {
  const Q = { inicio: "2027-03-01", fim: "2027-03-15" };
  await lancarFixa(page, "2027-03-03", [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 },
  ]);
  await abrirFaturamento(page, { cliente: CLI, ...Q });
  await page.route("**/rest/v1/rpc/gerar_fatura", async (rota) => {
    await rota.fetch(); // o banco grava a fatura
    await rota.abort("connectionreset"); // e a resposta não chega
  });
  const confirmacao = await abrirConfirmacao(page);
  await confirmacao.getByRole("button", { name: "Emitir fatura" }).click();
  const aviso = await textoDoAviso(page);
  expect(aviso).toMatch(/confira a lista de faturas/i);
  expect(aviso).not.toMatch(MENSAGEM_CRUA);
  await page.unroute("**/rest/v1/rpc/gerar_fatura");
  expect(faturasDaCompetencia(CLI, Q.inicio, Q.fim).map((f) => f.total)).toEqual(["240.00"]);
  await expect(valorDoCartao(page, "Total a faturar")).toHaveText(reais(0), { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Gerar fatura" })).toBeDisabled();
  await expect(
    page.locator("tr").filter({ hasText: CLI }).filter({ hasText: "01/03/2027 – 15/03/2027" }),
  ).toContainText(reais(240));
});

test("ED1 lançamento salvo depois da conferência: a fatura sai com o valor do banco e a tela avisa a diferença", async ({
  page,
}) => {
  const Q = { inicio: "2027-03-16", fim: "2027-03-31" };
  await lancarFixa(page, "2027-03-16", [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 },
  ]);
  await abrirFaturamento(page, { cliente: CLI, ...Q });
  const confirmacao = await abrirConfirmacao(page);
  await expect(confirmacao).toContainText(reais(240));
  // Enquanto a confirmação está aberta, outra aba lança mais um dia na mesma competência.
  const outra = await page.context().newPage();
  await lancarFixa(outra, "2027-03-17", [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 },
  ]);
  await outra.close();
  await confirmacao.getByRole("button", { name: "Emitir fatura" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 30_000 });
  // A autoridade é o banco: a fatura leva o que estava a faturar no momento da emissão.
  expect(faturasDaCompetencia(CLI, Q.inicio, Q.fim).map((f) => [f.total, f.lancamentos])).toEqual([
    ["480.00", 2],
  ]);
  const alerta = page.getByRole("alert").filter({ hasText: /diferente do conferido/i });
  await expect(alerta).toContainText(reais(480));
  await expect(alerta).toContainText(reais(240));
});

// =============================================================================================
// SEGURANÇA
// =============================================================================================

test("SG1 operacional, sem papel e anônimo não emitem fatura nem leem faturas pela API", async () => {
  const cliente = idDe("clients", CLI);
  const params = { _client_id: cliente, _period_start: "2027-04-01", _period_end: "2027-04-15" };
  for (const conta of ["OPER", "SEMPAPEL"] as const) {
    const api = await sessaoApi(conta);
    const r = await api.rpc("gerar_fatura", params);
    expect(r.error?.code, `${conta}: gerar_fatura`).toBe("42501");
    const faturas = await api.from("invoices").select("id, total_amount");
    expect(faturas.data ?? [], `${conta}: invoices`).toEqual([]);
    const itens = await api.from("invoice_items").select("id, amount");
    expect(itens.data ?? [], `${conta}: invoice_items`).toEqual([]);
    await api.auth.signOut({ scope: "local" });
  }
  const anon = clienteApi();
  const r = await anon.rpc("gerar_fatura", params);
  expect(r.error, "anônimo: gerar_fatura").not.toBeNull();
  const faturas = await anon.from("invoices").select("id");
  expect(faturas.data ?? []).toEqual([]);
  expect(
    consultar(`select 1 from public.invoices i join public.clients c on c.id = i.client_id
    where c.name = ${lit(CLI)} and i.period_start = '2027-04-01'`),
  ).toEqual([]);
});
