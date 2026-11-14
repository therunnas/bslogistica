import type { Locator, Page } from "@playwright/test";

import { lit } from "../apoio/banco";
import { ambiente, sessaoApi } from "../apoio/contas";
import { consultar, estadoDe, expect, test } from "../apoio/fixtures";
import {
  P,
  abrirDia,
  alocar,
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
  gerarFechamento,
  linhaDo,
  literal,
  reais,
  valorDoCartao,
} from "../apoio/telas";

/**
 * CP-05 — Apontamentos e regras financeiras. Cada valor é conferido por um CÁLCULO INDEPENDENTE
 * (o `esperado()` abaixo, escrito a partir das regras de negócio de `docs/NEGOCIO.md` §10 e da
 * regra V2 aprovada, sem importar nada de `src/`), comparado com a prévia da tela, com o banco e
 * com o fechamento e o relatório.
 *
 * Configuração = Production (semente E2E): motor por vigência LIGADO, resolução de tarifas
 * DESLIGADA, domingo e feriado em dobro LIGADO. Contrato pela tela: fator 1,5, tolerância 10 min,
 * hora extra no modo diário, minutos exatos no dia especial.
 *
 * Números redondos de propósito: diária R$ 240 (R$ 30/h; HE R$ 45/h; domingo/feriado R$ 1 por
 * minuto) e custo R$ 160 (R$ 20/h; R$ 2/3 por minuto no dia especial). Fábio tem valor-hora
 * acordado de R$ 25 para a hora extra PAGA, diferente da cobrada.
 *
 * Datas de 2026-11/12, que nenhum outro arquivo usa; 02/11 (segunda) vira feriado aqui.
 */

test.use({ storageState: estadoDe("admin") });

const C = `${P} CP05`;
const CLI = `${C} Cliente`;
const CTR = `${C} Contrato`;
const OP = `${C} Op`;
const DIA = "Dia CP05"; // 08:00–17:00, 60 min
const NOITE = "Noite CP05"; // 22:00–07:00, 60 min, vira a meia-noite
const TARDE = "Tarde CP05"; // 15:00–00:00, 60 min
const CEDO = "Cedo CP05"; // 06:00–15:00, 60 min

const ANA = `${C} Ana`;
const BIA = `${C} Bia`;
const CAIO = `${C} Caio`;
const DAVI = `${C} Davi`;
const EDU = `${C} Edu`;
const FABIO = `${C} Fábio`;
const NINA = `${C} Nina`;
const TAIS = `${C} Tais`;
const CIRO = `${C} Ciro`;
const EQUIPE_DIA = [ANA, BIA, CAIO, DAVI, EDU, FABIO];

const DIARIA = 240;
const CUSTO = 160;
const HE_ACORDADA: Record<string, number> = { [FABIO]: 25 };
const FERIADO = "2026-11-02";

// =============================================================================================
// CÁLCULO INDEPENDENTE (regras de negócio; não importa o núcleo do sistema)
// =============================================================================================

type Tipo = "util" | "sabado" | "domingo" | "feriado";

function tipoDaData(data: string): Tipo {
  if (data === FERIADO) return "feriado";
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dow === 0 ? "domingo" : dow === 6 ? "sabado" : "util";
}

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
/** Meio centavo para cima, sobre a fração exata `num / den` (valores não negativos). */
const arred = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
/** HE cobrada no modo diário: fração da hora < 15 min = 0; 15–44 = 30; ≥ 45 = 60. */
function blocosDaHora(m: number) {
  const r = m % 60;
  return Math.floor(m / 60) * 60 + (r < 15 ? 0 : r < 45 ? 30 : 60);
}

interface Esperado {
  trabalhados: number;
  receita: string;
  custo: string;
}

/**
 * NEGOCIO §10: dia útil — HE acima de 8 h, 50%; saída antecipada proporcional. Sábado — até 4 h a
 * diária integral, acima disso diária + HE do excedente (cobrança 50%; pagamento pelo valor-hora
 * combinado, ou custo ÷ 8). Domingo e feriado — horas efetivas com 100%. Falta — nada.
 * Tolerância do contrato (10 min) é limiar de descarte; a HE paga é em minutos exatos.
 */
function esperado(o: {
  colaborador: string;
  data: string;
  status: "present" | "absent" | "replacement";
  entrada?: string;
  saida?: string;
  intervalo?: number;
}): Esperado {
  if (o.status === "absent") return { trabalhados: 0, receita: "0.00", custo: "0.00" };
  const ini = min(o.entrada!);
  let fim = min(o.saida!);
  if (fim <= ini) fim += 1440;
  const w = fim - ini - (o.intervalo ?? 0);
  const d = DIARIA * 100; // centavos
  const c = CUSTO * 100;
  const tipo = tipoDaData(o.data);
  const reais2 = (centavos: number) => (centavos / 100).toFixed(2);
  if (tipo === "domingo" || tipo === "feriado") {
    // horas × (diária ÷ 8) × 2  =  minutos × diária × 200 ÷ 48.000
    return {
      trabalhados: w,
      receita: reais2(arred(d * w * 200, 48_000)),
      custo: reais2(arred(c * w * 200, 48_000)),
    };
  }
  const ref = tipo === "sabado" ? 240 : 480;
  const proporcional = tipo === "util" && w < 480;
  const excesso = Math.max(w - ref, 0);
  const passa = excesso > 10;
  const heCobrada = passa ? blocosDaHora(excesso) : 0;
  const hePaga = passa ? excesso : 0;
  const base = (proporcional ? w : 480) * 100; // em 1/48.000 da diária
  const receita = arred(d * base + d * heCobrada * 150, 48_000);
  const horaPaga = HE_ACORDADA[o.colaborador];
  const custoHe = horaPaga ? hePaga * horaPaga * 100 * 800 : hePaga * c * 100;
  const custo = arred(c * base + custoHe, 48_000);
  return { trabalhados: w, receita: reais2(receita), custo: reais2(custo) };
}

// =============================================================================================
// Leituras e telas
// =============================================================================================

type Gravado = {
  colaborador: string;
  data: string;
  status: "present" | "absent" | "replacement";
  entrada: string | null;
  saida: string | null;
  intervalo: number;
  trabalhados: number;
  receita: string;
  custo: string;
  dia: string | null;
  turno: string | null;
};

function gravados(filtro = ""): Gravado[] {
  return consultar<Gravado>(`
    select e.name as colaborador, to_char(te.work_date,'YYYY-MM-DD') as data,
           te.status::text as status, to_char(te.check_in,'HH24:MI') as entrada,
           to_char(te.check_out,'HH24:MI') as saida, te.break_minutes as intervalo,
           te.worked_minutes as trabalhados, te.billed_amount::numeric(12,2)::text as receita,
           te.cost_amount::numeric(12,2)::text as custo, te.day_kind_snapshot as dia,
           s.name as turno
      from public.timesheet_entries te
      join public.employees e on e.id = te.employee_id
      join public.operations o on o.id = te.operation_id
      join public.timesheets t on t.id = te.timesheet_id
      left join public.shifts s on s.id = t.shift_id
     where o.name = ${lit(OP)} ${filtro}
     order by te.work_date, e.name`);
}

function gravado(colaborador: string, data: string) {
  return gravados(`and e.name = ${lit(colaborador)} and te.work_date = ${lit(data)}`)[0];
}

/** O gravado bate com o cálculo independente feito sobre os horários gravados. */
function conferir(colaborador: string, data: string) {
  const g = gravado(colaborador, data);
  expect(g, `${colaborador} em ${data} foi gravado`).toBeDefined();
  const e = esperado({
    colaborador,
    data,
    status: g!.status,
    entrada: g!.entrada ?? undefined,
    saida: g!.saida ?? undefined,
    intervalo: g!.intervalo,
  });
  expect(
    { trabalhados: g!.trabalhados, receita: g!.receita, custo: g!.custo },
    `${colaborador} em ${data}`,
  ).toEqual(e);
  return g!;
}

type Linha = {
  colaborador: string;
  presenca?: "Presente" | "Falta" | "Substituição";
  entrada?: string;
  saida?: string;
  intervalo?: number;
};

async function preencher(page: Page, linhas: Linha[]) {
  for (const l of linhas) {
    const tr = linhaDo(page, l.colaborador);
    await expect(tr).toBeVisible();
    if (l.presenca) await escolher(page, tr.getByRole("combobox").first(), l.presenca);
    if (l.entrada !== undefined) await tr.locator("input[type=time]").nth(0).fill(l.entrada);
    if (l.saida !== undefined) await tr.locator("input[type=time]").nth(1).fill(l.saida);
    if (l.intervalo !== undefined) {
      await tr.locator("input[type=number]").first().fill(String(l.intervalo));
    }
  }
}

const salvarBotao = (page: Page) => page.getByRole("button", { name: "Salvar", exact: true });

async function salvar(page: Page) {
  await expect(salvarBotao(page)).toBeEnabled();
  await salvarBotao(page).click();
  await esperarAviso(page, "Apontamento salvo.");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Apontamento salvo." }),
  ).toBeVisible();
}

/** Células "A faturar" e "Custo" da prévia de uma linha. */
function previa(tr: Locator) {
  return { receita: tr.locator("td").nth(7), custo: tr.locator("td").nth(8) };
}

/** A prévia mostra exatamente o que o cálculo independente espera (antes de salvar). */
async function conferirPrevia(page: Page, l: Linha & { data: string }) {
  const e = esperado({
    colaborador: l.colaborador,
    data: l.data,
    status: l.presenca === "Falta" ? "absent" : "present",
    entrada: l.entrada ?? "08:00",
    saida: l.saida ?? "17:00",
    intervalo: l.intervalo ?? 60,
  });
  const p = previa(linhaDo(page, l.colaborador));
  await expect(p.receita, `prévia da receita de ${l.colaborador}`).toContainText(
    reais(Number(e.receita)),
  );
  await expect(p.custo, `prévia do custo de ${l.colaborador}`).toContainText(
    reais(Number(e.custo)),
  );
}

// =============================================================================================
// PREPARAÇÃO
// =============================================================================================

test("PR preparação: cliente, contrato 240, operação com quatro turnos, nove colaboradores e feriado", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await criarCliente(page, CLI);
  await criarContrato(page, { cliente: CLI, nome: CTR, diaria: DIARIA, inicio: "2026-10-01" });
  for (const nome of [...EQUIPE_DIA, NINA, TAIS, CIRO]) {
    await criarColaborador(page, {
      nome,
      custo: CUSTO,
      desde: "2026-10-01",
      ...(HE_ACORDADA[nome] ? { horaExtra: HE_ACORDADA[nome] } : {}),
    });
  }
  await criarOperacao(page, { cliente: CLI, nome: OP, tipo: "Fixa", contrato: CTR });
  await criarTurno(page, { operacao: OP, nome: DIA, inicio: "08:00", fim: "17:00", intervalo: 60 });
  await criarTurno(page, {
    operacao: OP,
    nome: NOITE,
    inicio: "22:00",
    fim: "07:00",
    intervalo: 60,
    viraDia: true,
  });
  await criarTurno(page, {
    operacao: OP,
    nome: TARDE,
    inicio: "15:00",
    fim: "00:00",
    intervalo: 60,
  });
  await criarTurno(page, {
    operacao: OP,
    nome: CEDO,
    inicio: "06:00",
    fim: "15:00",
    intervalo: 60,
  });
  for (const nome of EQUIPE_DIA)
    await alocar(page, { operacao: OP, colaborador: nome, turno: DIA });
  await alocar(page, { operacao: OP, colaborador: NINA, turno: NOITE });
  await alocar(page, { operacao: OP, colaborador: TAIS, turno: TARDE });
  await alocar(page, { operacao: OP, colaborador: CIRO, turno: CEDO });
  await cadastrarFeriado(page, { data: FERIADO, nome: `${C} Finados` });

  // Parâmetros que o cálculo independente presume, conferidos na versão gravada do contrato.
  const [k] = consultar<{ diaria: string; fator: string; tol: number; modo: string; esp: string }>(
    `select ct.daily_rate::numeric(12,2)::text as diaria, ct.ot_factor::numeric(5,2)::text as fator,
            ct.ot_tolerance_min as tol, ct.ot_rounding_mode as modo, ct.special_rounding_mode as esp
       from public.contract_terms ct join public.contracts c on c.id = ct.contract_id
      where c.name = ${lit(CTR)} and ct.active`,
  );
  expect(k).toEqual({ diaria: "240.00", fator: "1.50", tol: 10, modo: "diario", esp: "minutos" });
});

// =============================================================================================
// D1/B3 — JORNADA QUE VIRA O DIA FORA DE TURNO NOTURNO
// =============================================================================================

test("D1 [CRÍTICO] saída antes da entrada num turno diurno: aviso, salvamento bloqueado até confirmar; confirmado grava 22h50", async ({
  page,
}) => {
  const data = "2026-11-10";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  // Só a Ana nesta folha: os demais ficam como falta, para o teste medir uma linha só.
  await preencher(page, [
    { colaborador: ANA, entrada: "08:00", saida: "07:50", intervalo: 60 },
    ...EQUIPE_DIA.filter((n) => n !== ANA).map((colaborador) => ({
      colaborador,
      presenca: "Falta" as const,
    })),
  ]);
  const tr = linhaDo(page, ANA);
  // A prévia já mostra o que o cálculo faria: 22h50 trabalhadas.
  await expect(tr.locator("td").nth(5)).toContainText("22h50");
  // Correto: a tela avisa e não salva sem confirmação.
  const alerta = page.getByRole("alert").filter({ hasText: "saída antes da entrada" });
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText("não atravessa a meia-noite");
  await expect(salvarBotao(page)).toBeDisabled();
  expect(gravado(ANA, data), "nada gravado sem confirmação").toBeUndefined();

  // B — jornada excepcional confirmada expressamente: grava, com o valor do cálculo.
  await tr
    .getByRole("checkbox", { name: /Confirmo que a jornada atravessou a meia-noite/ })
    .check();
  await expect(alerta).toHaveCount(0);
  await salvar(page);
  const g = conferir(ANA, data);
  expect({ trabalhados: g.trabalhados, receita: g.receita, custo: g.custo }).toEqual({
    trabalhados: 1370,
    receita: "915.00", // 240 + 15 h de HE (890 min → 900) × 45
    custo: "456.67", // 160 + 890 min × 20/60
  });

  // C — erro de digitação corrigido antes de salvar: a confirmação não vale para outro horário.
  await abrirDia(page, { operacao: OP, turno: DIA, data: "2026-11-13" });
  await preencher(page, [
    { colaborador: BIA, entrada: "08:00", saida: "07:00" },
    ...EQUIPE_DIA.filter((n) => n !== BIA).map((colaborador) => ({
      colaborador,
      presenca: "Falta" as const,
    })),
  ]);
  const trBia = linhaDo(page, BIA);
  await trBia
    .getByRole("checkbox", { name: /Confirmo que a jornada atravessou a meia-noite/ })
    .check();
  await trBia.locator("input[type=time]").nth(1).fill("06:30");
  await expect(
    page.getByRole("alert").filter({ hasText: "saída antes da entrada" }),
    "trocar o horário exige nova confirmação",
  ).toBeVisible();
  await expect(salvarBotao(page)).toBeDisabled();
  await trBia.locator("input[type=time]").nth(1).fill("17:00");
  await expect(page.getByRole("alert").filter({ hasText: "saída antes da entrada" })).toHaveCount(
    0,
  );

  // D — jornada impossível (entrada = saída, 24 h): bloqueada, sem confirmação possível.
  await trBia.locator("input[type=time]").nth(1).fill("08:00");
  await expect(page.getByRole("alert").filter({ hasText: "entrada igual à saída" })).toBeVisible();
  await expect(
    trBia.getByRole("checkbox", { name: /Confirmo que a jornada atravessou a meia-noite/ }),
  ).toHaveCount(0);
  await expect(salvarBotao(page)).toBeDisabled();
  await trBia.locator("input[type=time]").nth(1).fill("17:00");
  await salvar(page);
  conferir(BIA, "2026-11-13");
});

test("D1 A — turnos que viram o dia (22–07 e 15–00) e o diurno 06–15 salvam sem aviso; data é a da entrada", async ({
  page,
}) => {
  const data = "2026-11-03";
  for (const [turno, colaborador, entrada, saida] of [
    [NOITE, NINA, "22:00", "07:00"],
    [TARDE, TAIS, "15:00", "00:00"],
    [CEDO, CIRO, "06:00", "15:00"],
  ] as const) {
    await abrirDia(page, { operacao: OP, turno, data });
    await preencher(page, [{ colaborador, entrada, saida, intervalo: 60 }]);
    await conferirPrevia(page, { colaborador, data, entrada, saida, intervalo: 60 });
    await expect(page.getByRole("alert").filter({ hasText: "saída antes da entrada" })).toHaveCount(
      0,
    );
    await salvar(page);
    const g = conferir(colaborador, data);
    expect({ turno: g.turno, data: g.data, dia: g.dia, trabalhados: g.trabalhados }).toEqual({
      turno,
      data,
      dia: "util",
      trabalhados: 480,
    });
  }
});

// =============================================================================================
// DIA ÚTIL — jornada, saída antecipada, tolerância e arredondamento (limites do D6)
// =============================================================================================

test("DU1 dia útil: 8 h, saída antecipada proporcional e HE nos limites 14/15/16 min; prévia = banco = cálculo", async ({
  page,
}) => {
  const data = "2026-11-03";
  const linhas: Linha[] = [
    { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 }, // 8 h
    { colaborador: BIA, entrada: "08:00", saida: "15:00", intervalo: 60 }, // 6 h → 3/4
    { colaborador: CAIO, entrada: "08:00", saida: "17:24", intervalo: 60 }, // +24 → 30
    { colaborador: DAVI, entrada: "08:00", saida: "17:14", intervalo: 60 }, // +14 → 0
    { colaborador: EDU, entrada: "08:00", saida: "17:15", intervalo: 60 }, // +15 → 30
    { colaborador: FABIO, entrada: "08:00", saida: "17:16", intervalo: 60 }, // +16 → 30
  ];
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, linhas);
  for (const l of linhas) await conferirPrevia(page, { ...l, data });
  await salvar(page);
  for (const l of linhas) conferir(l.colaborador, data);
  // Valores à mão, para o relatório: a HE cobrada arredonda, a paga é exata.
  expect(
    [ANA, BIA, CAIO, DAVI, EDU, FABIO].map((n) => {
      const g = gravado(n, data)!;
      return `${g.receita}/${g.custo}`;
    }),
  ).toEqual([
    "240.00/160.00",
    "180.00/120.00",
    "262.50/168.00",
    "240.00/164.67", // 14 min: não cobra (< 15), paga 14 min
    "262.50/165.00",
    "262.50/166.67", // Fábio: HE paga a R$ 25/h acordados (16 min = 6,67)
  ]);
});

test("DU2 dia útil: limites 44/45/46 min, 1h10, falta e substituição", async ({ page }) => {
  const data = "2026-11-04";
  const linhas: Linha[] = [
    { colaborador: ANA, entrada: "08:00", saida: "17:44" }, // +44 → 30
    { colaborador: BIA, entrada: "08:00", saida: "17:45" }, // +45 → 60
    { colaborador: CAIO, entrada: "08:00", saida: "17:46" }, // +46 → 60
    { colaborador: DAVI, entrada: "08:00", saida: "18:10" }, // +70 → 60
    { colaborador: EDU, presenca: "Falta" },
    { colaborador: FABIO, presenca: "Substituição", entrada: "08:00", saida: "17:00" },
  ];
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, linhas);
  await expect(previa(linhaDo(page, EDU)).receita).toContainText(reais(0));
  await salvar(page);
  for (const l of linhas) conferir(l.colaborador, data);
  const edu = gravado(EDU, data)!;
  expect({
    status: edu.status,
    entrada: edu.entrada,
    saida: edu.saida,
    receita: edu.receita,
  }).toEqual({ status: "absent", entrada: null, saida: null, receita: "0.00" });
  expect(gravado(FABIO, data)!.status).toBe("replacement");
  expect(
    [ANA, BIA, CAIO, DAVI].map((n) => `${gravado(n, data)!.receita}/${gravado(n, data)!.custo}`),
  ).toEqual(["262.50/174.67", "285.00/175.00", "285.00/175.33", "285.00/183.33"]);
});

test("DU3 dia útil: tolerância de 10 min é limiar (10 não conta, 11 conta) e HE paga pelo valor acordado", async ({
  page,
}) => {
  const data = "2026-11-05";
  const linhas: Linha[] = [
    { colaborador: ANA, entrada: "08:00", saida: "17:10" }, // +10: dentro da tolerância
    { colaborador: BIA, entrada: "08:00", saida: "17:11" }, // +11: cobra 0 (< 15), paga 11
    { colaborador: FABIO, entrada: "08:00", saida: "17:30" }, // +30: cobra 30 × 45; paga 30 × 25
    { colaborador: CAIO, entrada: "08:00", saida: "17:30" }, // mesmo, pago por custo ÷ 8 (20)
    { colaborador: DAVI, presenca: "Falta" },
    { colaborador: EDU, presenca: "Falta" },
  ];
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, linhas);
  for (const l of linhas.slice(0, 4)) await conferirPrevia(page, { ...l, data, intervalo: 60 });
  await salvar(page);
  for (const l of linhas) conferir(l.colaborador, data);
  expect(
    [ANA, BIA, FABIO, CAIO].map((n) => `${gravado(n, data)!.receita}/${gravado(n, data)!.custo}`),
  ).toEqual(["240.00/160.00", "240.00/163.67", "262.50/172.50", "262.50/170.00"]);
});

// =============================================================================================
// SÁBADO, DOMINGO E FERIADO
// =============================================================================================

test("SA1 sábado: até 4 h diária integral (3 h e 4 h); acima, diária + HE do excedente", async ({
  page,
}) => {
  const data = "2026-11-07";
  const linhas: Linha[] = [
    { colaborador: ANA, entrada: "08:00", saida: "12:00", intervalo: 0 }, // 4 h
    { colaborador: BIA, entrada: "08:00", saida: "11:00", intervalo: 0 }, // 3 h: integral
    { colaborador: CAIO, entrada: "08:00", saida: "14:00", intervalo: 0 }, // 6 h: +2 h
    { colaborador: DAVI, entrada: "08:00", saida: "17:00", intervalo: 60 }, // 8 h: +4 h
    { colaborador: FABIO, entrada: "08:00", saida: "14:00", intervalo: 0 }, // +2 h a R$ 25
    { colaborador: EDU, presenca: "Falta" },
  ];
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, linhas);
  for (const l of linhas.slice(0, 5)) await conferirPrevia(page, { ...l, data });
  await salvar(page);
  // Falta não é classificada (o tipo do dia só é congelado em presença).
  for (const l of linhas) {
    expect(conferir(l.colaborador, data).dia).toBe(l.presenca === "Falta" ? null : "sabado");
  }
  expect(
    [ANA, BIA, CAIO, DAVI, FABIO].map(
      (n) => `${gravado(n, data)!.receita}/${gravado(n, data)!.custo}`,
    ),
  ).toEqual(["240.00/160.00", "240.00/160.00", "330.00/200.00", "420.00/240.00", "330.00/210.00"]);
});

test("DF1 domingo e feriado: horas efetivas em dobro, sem diária; prévia só depois de salvar", async ({
  page,
}) => {
  for (const [data, tipo] of [
    ["2026-11-08", "domingo"],
    [FERIADO, "feriado"],
  ] as const) {
    await abrirDia(page, { operacao: OP, turno: DIA, data });
    await preencher(page, [
      { colaborador: ANA, entrada: "08:00", saida: "17:00", intervalo: 60 }, // 480 min
      { colaborador: BIA, entrada: "08:00", saida: "12:00", intervalo: 0 }, // 240 min
      ...[CAIO, DAVI, EDU, FABIO].map((colaborador) => ({
        colaborador,
        presenca: "Falta" as const,
      })),
    ]);
    // A prévia não estima o dia especial: o banco calcula ao salvar.
    await expect(previa(linhaDo(page, ANA)).receita).toContainText("depois de salvar");
    await salvar(page);
    const a = conferir(ANA, data);
    const b = conferir(BIA, data);
    expect([a.dia, `${a.receita}/${a.custo}`, `${b.receita}/${b.custo}`]).toEqual([
      tipo,
      "480.00/320.00",
      "240.00/160.00",
    ]);
  }
});

// =============================================================================================
// VIRADAS DE DATA
// =============================================================================================

test("VD1 viradas: sábado→domingo, domingo→segunda, fim de mês e fim de ano; tipo e data são os da entrada", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const casos = [
    ["2026-11-07", "sabado"], // sáb 22:00 → dom 07:00
    ["2026-11-08", "domingo"], // dom 22:00 → seg 07:00
    ["2026-11-30", "util"], // 30/11 → 01/12
    ["2026-12-31", "util"], // 31/12 → 01/01 (feriado nacional não cadastrado aqui)
  ] as const;
  for (const [data] of casos) {
    await abrirDia(page, { operacao: OP, turno: NOITE, data });
    await preencher(page, [{ colaborador: NINA, entrada: "22:00", saida: "07:00", intervalo: 60 }]);
    await expect(page.getByRole("alert").filter({ hasText: "saída antes da entrada" })).toHaveCount(
      0,
    );
    await salvar(page);
  }
  const resultado = casos.map(([data, tipo]) => {
    const g = conferir(NINA, data);
    return [g.data, g.dia, tipo, `${g.receita}/${g.custo}`];
  });
  expect(resultado).toEqual([
    // A jornada inteira é do tipo da data de entrada (sábado: 8 h = diária + 4 h de HE).
    ["2026-11-07", "sabado", "sabado", "420.00/240.00"],
    ["2026-11-08", "domingo", "domingo", "480.00/320.00"],
    ["2026-11-30", "util", "util", "240.00/160.00"],
    ["2026-12-31", "util", "util", "240.00/160.00"],
  ]);
});

// =============================================================================================
// PRESENÇA E EQUIPE: o que "salvar o dia" grava
// =============================================================================================

test("PA1 salvar o dia: linhas ainda não gravadas são identificadas; quem não foi marcado vira presença; falta não gera diária", async ({
  page,
}) => {
  const data = "2026-11-11";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  // Nada gravado: as seis linhas da equipe aparecem como presença sugerida.
  await expect(page.getByText(/6 colaboradores ainda sem apontamento/)).toBeVisible();
  for (const n of EQUIPE_DIA) {
    await expect(linhaDo(page, n).getByText("Não gravado")).toBeVisible();
  }
  // A pessoa só mexe em duas linhas: Edu faltou, Davi saiu às 13:00.
  await preencher(page, [
    { colaborador: EDU, presenca: "Falta" },
    { colaborador: DAVI, saida: "13:00" },
  ]);
  await salvar(page);
  // Grava as seis: quatro presenças com o horário do turno, a saída antecipada e a falta.
  const linhas = gravados(`and te.work_date = ${lit(data)}`);
  expect(
    linhas.map((l) => `${l.colaborador.replace(`${C} `, "")}:${l.status}:${l.receita}/${l.custo}`),
  ).toEqual([
    "Ana:present:240.00/160.00",
    "Bia:present:240.00/160.00",
    "Caio:present:240.00/160.00",
    "Davi:present:120.00/80.00",
    "Edu:absent:0.00/0.00",
    "Fábio:present:240.00/160.00",
  ]);
  for (const l of linhas) conferir(l.colaborador, data);
  await expect(page.getByText(/ainda sem apontamento/)).toHaveCount(0);

  // Alteração de presença depois de salvar: Caio vira falta (zera) e volta (reprecifica).
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, [{ colaborador: CAIO, presenca: "Falta" }]);
  await salvar(page);
  expect(conferir(CAIO, data).receita).toBe("0.00");
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, [
    { colaborador: CAIO, presenca: "Presente", entrada: "08:00", saida: "17:00" },
  ]);
  await salvar(page);
  expect(`${conferir(CAIO, data).receita}/${gravado(CAIO, data)!.custo}`).toBe("240.00/160.00");
});

// =============================================================================================
// ROBUSTEZ
// =============================================================================================

test("RB1 duplo clique em “Salvar” grava cada colaborador uma vez; falha de rede em português e nova tentativa", async ({
  page,
}) => {
  const data = "2026-11-09";
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await preencher(page, [{ colaborador: ANA, saida: "17:30" }]);
  // Falha de rede: nada gravado, mensagem em português.
  await page.route("**/rest/v1/rpc/salvar_apontamento_admin", (r) => r.abort("failed"));
  await salvarBotao(page).click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: /conex|rede|internet/i }),
  ).toBeVisible({ timeout: 20_000 });
  expect(gravados(`and te.work_date = ${lit(data)}`)).toHaveLength(0);
  await page.unroute("**/rest/v1/rpc/salvar_apontamento_admin");
  // Depois do erro a tela relê os dados (botão desabilitado até terminar): o clique de dentro do
  // `evaluate` não espera, então esperamos o botão voltar antes do duplo clique.
  await expect(salvarBotao(page)).toBeEnabled();
  // Nova tentativa com duplo clique no mesmo instante.
  await salvarBotao(page).evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await expect
    .poll(() => gravados(`and te.work_date = ${lit(data)}`).length, { timeout: 20_000 })
    .toBe(EQUIPE_DIA.length);
  await page.waitForTimeout(1500);
  const linhas = gravados(`and te.work_date = ${lit(data)}`);
  expect(linhas, "uma linha por colaborador, sem duplicar").toHaveLength(EQUIPE_DIA.length);
  expect(conferir(ANA, data).receita).toBe("262.50");
});

test("RB2 duas abas no mesmo dia: a segunda não sobrescreve sem aviso o que a primeira gravou", async ({
  page,
  context,
}) => {
  const data = "2026-11-13";
  // Bia já foi gravada no D1 (08:00–17:00). Duas abas abrem o mesmo dia.
  const outra = await context.newPage();
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await abrirDia(outra, { operacao: OP, turno: DIA, data });
  // Aba 1: Bia sai às 18:00 e grava.
  await preencher(page, [{ colaborador: BIA, saida: "18:00" }]);
  await salvar(page);
  expect(gravado(BIA, data)!.saida).toBe("18:00");
  // Aba 2 (leitura de antes): marca Bia como falta e tenta salvar.
  await preencher(outra, [{ colaborador: BIA, presenca: "Falta" }]);
  await salvarBotao(outra).click();
  await expect(
    outra.locator("[data-sonner-toast]").filter({ hasText: /alterad|recarregue/i }),
  ).toBeVisible({ timeout: 20_000 });
  expect(gravado(BIA, data)!.status, "a gravação da aba 1 ficou").toBe("present");
  await outra.close();
});

// =============================================================================================
// INTEGRAÇÃO: fechamento e relatório da 1ª quinzena, ao centavo
// =============================================================================================

// =============================================================================================
// D1 NA TELA DO OPERADOR (/operacional)
// =============================================================================================

test("D1 operador: saída antes da entrada no turno diurno bloqueia até confirmar; aviso de presenças sem horário", async ({
  page,
  browser,
}) => {
  const data = "2026-11-17";
  // O administrador atribui a operação ao operador sintético (uma vez: repetir o teste não duplica).
  const [{ atribuida }] = consultar<{ atribuida: boolean }>(
    `select exists (select 1 from public.user_operation_access a
                      join public.operations o on o.id = a.operation_id
                      join auth.users u on u.id = a.user_id
                     where o.name = ${lit(OP)} and u.email = ${lit(ambiente("E2E_OPER_EMAIL"))}) as atribuida`,
  );
  if (!atribuida) {
    await page.goto("/usuarios");
    const linha = page.locator("tr").filter({ hasText: ambiente("E2E_OPER_EMAIL") });
    await linha.getByRole("button").last().click();
    const d = dialogo(page);
    await escolher(page, campo(d, "Atribuir operação"), OP);
    await d.getByRole("button", { name: "Atribuir", exact: true }).click();
    await expect(d.getByText(OP, { exact: true })).toBeVisible({ timeout: 20_000 });
  }

  const contexto = await browser.newContext({ storageState: estadoDe("operacional") });
  const op = await contexto.newPage();
  await op.goto("/operacional");
  await escolher(op, campo(op, "Operação"), new RegExp(`^${literal(OP)} — `));
  await escolher(op, campo(op, "Turno"), new RegExp(`^${literal(DIA)} — `));
  await campo(op, "Data").fill(data);
  const tr = op.locator("tr").filter({ hasText: ANA }).first();
  await expect(tr).toBeVisible();
  // As seis linhas da equipe (horários vazios no operador) entrariam como presença sem horário.
  await expect(op.getByText(/6 colaboradores .* presentes sem horário/)).toBeVisible();
  for (const n of EQUIPE_DIA.filter((n) => n !== ANA)) {
    await escolher(
      op,
      op.locator("tr").filter({ hasText: n }).first().getByRole("combobox").first(),
      "Falta",
    );
  }
  // Só a Ana continua sem horário; depois de informá-los, o aviso some.
  await expect(op.getByText(/1 colaborador .* presente sem horário/)).toBeVisible();
  await tr.locator("input[type=time]").nth(0).fill("08:00");
  await tr.locator("input[type=time]").nth(1).fill("07:50");
  await expect(op.getByText(/presentes? sem horário/)).toHaveCount(0);
  const salvarOp = op.getByRole("button", { name: "Salvar apontamento" });
  await expect(op.getByRole("alert").filter({ hasText: "saída antes da entrada" })).toBeVisible();
  await expect(salvarOp).toBeDisabled();
  await tr
    .getByRole("checkbox", { name: /Confirmo que a jornada atravessou a meia-noite/ })
    .check();
  await expect(salvarOp).toBeEnabled();
  await salvarOp.click();
  await esperarAviso(op, "Apontamento salvo.");
  await contexto.close();
  // O valor é derivado pelo banco; o operador não o vê.
  expect(`${conferir(ANA, data).receita}/${gravado(ANA, data)!.custo}`).toBe("915.00/456.67");
});

// =============================================================================================
// ESTADO DO DIA: fechar e reabrir
// =============================================================================================

test("FD1 fechar o dia trava a tela e o banco; reabrir libera; valores não mudam", async ({
  page,
}) => {
  const data = "2026-11-10"; // Ana gravada no D1 (22h50 confirmada); os outros, falta
  const antes = gravados(`and te.work_date = ${lit(data)}`).map((l) => `${l.receita}/${l.custo}`);
  await abrirDia(page, { operacao: OP, turno: DIA, data });
  await page.getByRole("button", { name: "Fechar dia" }).click();
  await esperarAviso(page, "Status do apontamento atualizado.");
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeVisible();
  await expect(salvarBotao(page)).toBeDisabled();
  await expect(linhaDo(page, ANA).locator("input[type=time]").first()).toBeDisabled();
  // O banco recusa escrita na folha fechada, mesmo fora da tela (migration 031).
  const api = await sessaoApi("ADMIN");
  const [{ shift }] = consultar<{ shift: string }>(
    `select id as shift from public.shifts where name = ${lit(DIA)}`,
  );
  const [{ op }] = consultar<{ op: string }>(
    `select id as op from public.operations where name = ${lit(OP)}`,
  );
  const [{ ana }] = consultar<{ ana: string }>(
    `select id as ana from public.employees where name = ${lit(ANA)}`,
  );
  const { error } = await api.rpc("salvar_apontamento_admin", {
    p_operation_id: op,
    p_shift_id: shift,
    p_work_date: data,
    p_linhas: [{ employee_id: ana, status: "absent", break_minutes: 0 }],
  });
  expect(error?.code, "folha fechada recusa a escrita").toBe("55000");
  await api.auth.signOut({ scope: "local" });
  // Reabrir libera a edição; nada foi recalculado.
  await page.getByRole("button", { name: "Reabrir" }).click();
  await esperarAviso(page, "Status do apontamento atualizado.");
  await expect(salvarBotao(page)).toBeVisible();
  await expect(linhaDo(page, ANA).locator("input[type=time]").first()).toBeEnabled();
  expect(gravados(`and te.work_date = ${lit(data)}`).map((l) => `${l.receita}/${l.custo}`)).toEqual(
    antes,
  );
});

test("IN1 fechamento e relatório da 1ª quinzena de novembro batem com o cálculo independente", async ({
  page,
}) => {
  const linhas = gravados(`and te.work_date between '2026-11-01' and '2026-11-15'`);
  expect(linhas.length).toBeGreaterThan(30);
  let receita = 0;
  let custo = 0;
  const porColaborador = new Map<string, { receita: number; custo: number }>();
  for (const l of linhas) {
    const e = esperado({
      colaborador: l.colaborador,
      data: l.data,
      status: l.status,
      entrada: l.entrada ?? undefined,
      saida: l.saida ?? undefined,
      intervalo: l.intervalo,
    });
    expect(`${l.receita}/${l.custo}`, `${l.colaborador} ${l.data}`).toBe(`${e.receita}/${e.custo}`);
    receita += Math.round(Number(e.receita) * 100);
    custo += Math.round(Number(e.custo) * 100);
    const atual = porColaborador.get(l.colaborador) ?? { receita: 0, custo: 0 };
    atual.receita += Math.round(Number(e.receita) * 100);
    atual.custo += Math.round(Number(e.custo) * 100);
    porColaborador.set(l.colaborador, atual);
  }
  // Totais do período pelo cálculo independente (anexados ao relatório do teste).
  await test.info().attach("totais-1a-quinzena-nov.txt", {
    body: `receita ${(receita / 100).toFixed(2)}\ncusto ${(custo / 100).toFixed(2)}\nresultado bruto ${((receita - custo) / 100).toFixed(2)}\nlançamentos ${linhas.length}\n`,
    contentType: "text/plain",
  });
  console.log(
    `TOTAIS 1ª quinzena: receita ${(receita / 100).toFixed(2)} custo ${(custo / 100).toFixed(2)}`,
  );
  await gerarFechamento(page, { cliente: CLI, mes: 11, ano: 2026 });
  await expect(valorDoCartao(page, "Receita total")).toHaveText(reais(receita / 100));
  await expect(valorDoCartao(page, "Custo previsto")).toHaveText(reais(custo / 100));

  await page.goto("/relatorios");
  await campo(page, "De").fill("2026-11-01");
  await campo(page, "Até").fill("2026-11-15");
  for (const [nome, v] of porColaborador) {
    const tr = page.locator("tr").filter({ hasText: nome }).first();
    await expect(tr, `relatório de ${nome}`).toContainText(reais(v.custo / 100), {
      timeout: 30_000,
    });
  }
});
