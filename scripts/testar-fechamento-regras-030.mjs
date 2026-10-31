/**
 * Testes do Fechamento sobre a migration 030 (C05-B8.19): a conciliação com o banco.
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-conciliacao
 *
 * O CENÁRIO é o da suíte SQL `supabase/tests/029_fechamento_conciliacao.sql` (cliente FQ,
 * quinzena 01–15/03/2026), com os mesmos números calculados à mão. Aqui as linhas e as respostas
 * das funções do banco são o que o PostgREST devolveria; a SQL prova que o banco devolve isso, e
 * esta suíte prova que o Fechamento TypeScript, ao receber isso:
 *
 *   - SOMA sem recalcular regra (cobrado, custo, minutos cobrados, adicional, ajuste);
 *   - CONCILIA parcela a parcela com `resumo_financeiro_periodo` e nunca corrige uma diferença;
 *   - AVISA o que a regra comercial ainda não define (feriado, domingo, hora extra tardia,
 *     compensação) sem implementar por suposição;
 *   - NÃO tem aritmética de arredondamento própria.
 *
 *   A. cenário antes da fatura     B. depois da fatura      C. divergência de conciliação
 *   D. mês e período personalizado E. hora extra tardia     F. leitura estrita do banco
 *   G. assinatura                  H. exportações           I. forma literal e acoplamento com a SQL
 */

import { readFileSync } from "node:fs";

import {
  buscarDadosDoBanco,
  centavosDeValor,
  lerResumoDoBanco,
} from "../src/lib/fechamento/banco.ts";
import { carregarFechamento } from "../src/lib/fechamento/carregar.ts";
import {
  conciliacaoDoResumo,
  csvDoFechamento,
  detalhesDoResumo,
  indicadoresDoResumo,
  tabelaPorColaborador,
} from "../src/lib/fechamento/exportacao.ts";
import { ErroDeDadoDoFechamento, ErroDeDadoFinanceiro } from "../src/lib/fechamento/erros.ts";
import { assinarFechamento } from "../src/lib/fechamento/assinatura.ts";
import { normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";
import { diaDaSemana, ehMesInteiro, ehPeriodoDeFechamento } from "../src/lib/fechamento/periodo.ts";
import { gerarXlsxDoFechamento } from "../src/lib/fechamento/xlsx.ts";
import { lerCsv } from "./_fechamento-exportacao.mjs";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
    console.log(`  FAIL  ${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
  }
}
const igual = (caso, obtido, esperado) =>
  verificar(caso, JSON.stringify(obtido), JSON.stringify(esperado));

async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

const fonteDoRepo = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ */
/* O cenário (SQL 029). Dinheiro em texto, como a leitura devolve.     */

const CLIENTE = "5c40c000-0000-4000-8000-0000000000c1";
const FILTROS = { clienteId: CLIENTE, inicio: "2026-03-01", fim: "2026-03-15" };

function linha(o) {
  const emp = o.emp;
  return {
    id: o.id,
    employee_id: emp,
    status: o.status ?? "present",
    check_in: o.in === undefined ? "06:00:00" : o.in,
    check_out: o.out === undefined ? "15:00:00" : o.out,
    worked_minutes: o.worked,
    overtime_minutes: o.ot ?? 0,
    billed_overtime_minutes: o.cobrados === undefined ? 0 : o.cobrados,
    day_kind_snapshot: o.dia === undefined ? "util" : o.dia,
    invoice_id: o.inv ?? null,
    faturado: o.faturado,
    custo: o.custo,
    taxa_da_diaria: "120.00",
    employees: { id: emp, name: o.nome, role: "Auxiliar" },
    timesheets: {
      id: `ts-${o.id}`,
      work_date: o.data,
      status: "closed",
      operation_id: "op-q",
      operations: { id: "op-q", client_id: CLIENTE, name: "OPQ", contract_id: "ctr-fq" },
      shifts: { id: "sh-q", name: "SQ" },
    },
  };
}

const E1 = { emp: "emp-1", nome: "E1" };
const E2 = { emp: "emp-2", nome: "E2" };
const E3 = { emp: "emp-3", nome: "E3" };

const L01 = (inv) =>
  linha({
    ...E1,
    id: "l-01",
    data: "2026-03-02",
    out: "15:14:00",
    worked: 494,
    ot: 14,
    cobrados: 14,
    faturado: "125.25",
    custo: "82.33",
    inv,
  });
const L02 = (inv) =>
  linha({
    ...E1,
    id: "l-02",
    data: "2026-03-03",
    out: "15:26:00",
    worked: 506,
    ot: 26,
    cobrados: 26,
    faturado: "129.75",
    custo: "84.33",
    inv,
  });
const L03 = () =>
  linha({
    ...E2,
    id: "l-03",
    data: "2026-03-04",
    status: "absent",
    in: null,
    out: null,
    worked: 0,
    cobrados: 0,
    dia: null,
    faturado: "0.00",
    custo: "0.00",
  });
const L04 = (inv) =>
  linha({
    ...E3,
    id: "l-04",
    data: "2026-03-05",
    out: "13:00:00",
    worked: 360,
    dia: "feriado",
    faturado: "90.00",
    custo: "120.00",
    inv,
  });
const L05 = (inv) =>
  linha({
    ...E3,
    id: "l-05",
    data: "2026-03-06",
    out: null,
    worked: 0,
    faturado: "120.00",
    custo: "80.00",
    inv,
  });
const L06 = (inv) =>
  linha({
    ...E2,
    id: "l-06",
    data: "2026-03-07",
    out: "12:00:00",
    worked: 360,
    cobrados: 120,
    dia: "sabado",
    faturado: "165.00",
    custo: "187.50", // FIN-PR-02 (V2): sábado de 6 h paga 150,00 + 2 h × 18,75 (a 030: 112,50)
    inv,
  });
const L07 = (inv) =>
  linha({
    ...E1,
    id: "l-07",
    data: "2026-03-08",
    worked: 480,
    faturado: "120.00",
    custo: "80.00",
    inv,
  });

const aFaturar = () => [L01(), L02(), L03(), L04(), L05(), L06(), L07()];
const faturadas = (inv = "inv-1") => [
  L01(inv),
  L02(inv),
  L03(),
  L04(inv),
  L05(inv),
  L06(inv),
  L07(inv),
];

/** Respostas do banco no formato do PostgREST (RPC: `numeric` como número JSON). */
const AJUSTES_ANTES = [
  {
    employee_id: "emp-1",
    colaborador: "E1",
    valor_hora: 22.5,
    minutos_brutos: 40,
    minutos_arredondados: 30,
    valor_bruto: 15,
    valor_arredondado: 11.25,
    ajuste: -3.75,
  },
  {
    employee_id: "emp-2",
    colaborador: "E2",
    valor_hora: 22.5,
    minutos_brutos: 120,
    minutos_arredondados: 120,
    valor_bruto: 45,
    valor_arredondado: 45,
    ajuste: 0,
  },
  {
    employee_id: "emp-3",
    colaborador: "E3",
    valor_hora: 22.5,
    minutos_brutos: 0,
    minutos_arredondados: 0,
    valor_bruto: 0,
    valor_arredondado: 0,
    ajuste: 0,
  },
];
const SALDO = [
  {
    employee_id: "emp-1",
    colaborador: "E1",
    apontamentos: 3,
    minutos_excedentes: 40,
    minutos_faltantes: 0,
    saldo: 40,
  },
  {
    employee_id: "emp-2",
    colaborador: "E2",
    apontamentos: 1,
    minutos_excedentes: 120,
    minutos_faltantes: 0,
    saldo: 120,
  },
  {
    employee_id: "emp-3",
    colaborador: "E3",
    apontamentos: 1,
    minutos_excedentes: 0,
    minutos_faltantes: 120,
    saldo: -120,
  },
];
const ADICIONAL = (inv = null) => ({
  id: "ad-1",
  description: "Etiquetagem",
  reference: "REF-1",
  operation_id: null,
  period_start: "2026-03-01",
  period_end: "2026-03-15",
  invoice_id: inv,
  valor: "100.00",
});
const RESUMO_ANTES = {
  receita_apontamentos: 750,
  adicionais: 100,
  ajuste_faturado: 0,
  ajuste_previsto: -3.75,
  receita_total: 846.25,
  a_faturar: 846.25,
  faturado: 0,
  ajuste_aplicavel: true,
};
const RESUMO_DEPOIS = {
  ...RESUMO_ANTES,
  ajuste_faturado: -3.75,
  ajuste_previsto: 0,
  a_faturar: 0,
  faturado: 846.25,
};
const AJUSTE_FATURADO = [
  {
    invoice_id: "inv-1",
    description: "Arredondamento acumulado de horas extras — E1 (40 min → 30 min)",
    valor: "-3.75",
  },
];

function fonteLinhas(brutas) {
  const todas = [...brutas].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    async lerPagina({ cursor, limite, contar }) {
      const candidatas = (cursor === null ? todas : todas.filter((l) => l.id > cursor)).slice(
        0,
        limite,
      );
      return { linhas: candidatas, total: contar ? todas.length : null };
    },
    async contar() {
      return todas.length;
    },
  };
}

function fonteBanco(o = {}) {
  return {
    async resumo() {
      return [o.resumo ?? RESUMO_ANTES];
    },
    async ajustesPrevistos() {
      return o.ajustes ?? AJUSTES_ANTES;
    },
    async saldoDeHoras() {
      return o.saldo ?? SALDO;
    },
    async adicionais() {
      return o.adicionais ?? [ADICIONAL()];
    },
    async ajustesFaturados() {
      return o.faturados ?? [];
    },
  };
}

async function carregar(brutas, banco = {}, filtros = FILTROS) {
  return carregarFechamento(filtros, {
    async buscarCliente(id) {
      return { id, name: "FQ" };
    },
    criarFonte: () => fonteLinhas(brutas),
    criarFonteDoBanco: () => fonteBanco(banco),
    agora: () => new Date("2026-03-16T12:00:00.000Z"),
  });
}

const codigos = (d) => d.alertas.map((a) => a.codigo);
const alerta = (d, codigo) => d.alertas.find((a) => a.codigo === codigo);

/* ================================================================== */
console.log("\nA. Cenário antes da fatura\n");

const antes = await carregar(aFaturar());

igual(
  "A1. composição: apontamentos 750,00 + adicional 100,00 + ajuste −3,75 = receita 846,25",
  antes.financeiro,
  {
    apontamentosCentavos: 75000,
    adicionaisCentavos: 10000,
    ajusteFaturadoCentavos: 0,
    ajustePrevistoCentavos: -375,
    ajusteCentavos: -375,
    receitaCentavos: 84625,
    custoCentavos: 63416,
    resultadoCentavos: 21209,
    margemPermil: 251,
    aFaturarCentavos: 84625,
    jaFaturadoCentavos: 0,
  },
);
verificar(
  "A2. a conciliação confere em todas as parcelas",
  antes.conciliacao.every((c) => c.confere),
  true,
);
igual(
  "A3. as seis parcelas conciliadas",
  antes.conciliacao.map((c) => c.codigo),
  ["apontamentos", "adicionais", "ajuste-faturado", "ajuste-previsto", "a-faturar", "faturado"],
);
verificar(
  "A4. seis diárias (a falta não conta) e uma falta",
  `${antes.consolidado.diarias}|${antes.faltas}`,
  "6|1",
);
verificar(
  "A5. horas extras COBRADAS 160 min; excedente do CUSTO 40 min",
  `${antes.consolidado.minutosExtrasCobrados}|${antes.consolidado.minutosExtras}`,
  "160|40",
);
verificar(
  "A6. decomposição: extra 60,00 e diária 690,00",
  `${antes.consolidado.extraCentavos}|${antes.consolidado.diariaCentavos}`,
  "6000|69000",
);
verificar(
  "A7. custo previsto 634,16 (V2) e cobrado dos lançamentos 750,00",
  `${antes.consolidado.custoCentavos}|${antes.consolidado.faturadoCentavos}`,
  "63416|75000",
);
igual(
  "A8. ajuste previsto por colaborador: só E1 tem ajuste",
  antes.colaboradores.map((c) => [c.nome, c.ajusteAcumuladoCentavos]),
  [
    ["E1", -375],
    ["E2", 0],
    ["E3", 0],
  ],
);
igual(
  "A9. tipo do dia e minutos cobrados nos detalhes, em ordem de data",
  antes.detalhes.map((d) => `${d.workDate}:${d.tipoDoDia}:${d.minutosExtrasCobrados}`),
  [
    "2026-03-02:util:14",
    "2026-03-03:util:26",
    "2026-03-05:feriado:0",
    "2026-03-06:util:0",
    "2026-03-07:sabado:120",
    "2026-03-08:util:0",
  ],
);
igual("A10. adicional do período, sem fatura", antes.adicionais, [
  {
    id: "ad-1",
    descricao: "Etiquetagem",
    referencia: "REF-1",
    operacaoId: null,
    inicio: "2026-03-01",
    fim: "2026-03-15",
    valorCentavos: 10000,
    faturaId: null,
  },
]);
verificar(
  "A11. saldo de horas vem pronto, em minutos (E3 −120)",
  antes.saldoDeHoras.find((s) => s.colaborador === "E3")?.saldoMinutos,
  -120,
);
igual(
  "A12. alertas: presença sem horário, feriado, domingo e falta — nada além disso",
  codigos(antes),
  ["dado-incompleto", "feriado-cobranca-pendente", "domingo-regra-pendente", "falta"],
);
igual(
  "A13. presença sem saída é o lançamento 05; o feriado, o 04; o domingo, o 07",
  [
    alerta(antes, "dado-incompleto").entryIds,
    alerta(antes, "feriado-cobranca-pendente").entryIds,
    alerta(antes, "domingo-regra-pendente").entryIds,
  ],
  [["l-05"], ["l-04"], ["l-07"]],
);
verificar(
  "A14. feriado e domingo são informativos: não bloqueiam nada",
  `${alerta(antes, "feriado-cobranca-pendente").severidade}|${alerta(antes, "domingo-regra-pendente").severidade}`,
  "informacao|informacao",
);
verificar("A15. a versão do modelo é a 2", antes.versao, 2);
verificar(
  "A16. a receita não é um campo recalculado em outro lugar: aFaturar do banco = do Fechamento",
  antes.financeiro.aFaturarCentavos,
  84625,
);

/* ================================================================== */
console.log("\nB. Depois da fatura\n");

const depois = await carregar(faturadas(), {
  resumo: RESUMO_DEPOIS,
  ajustes: [],
  adicionais: [ADICIONAL("inv-1")],
  faturados: AJUSTE_FATURADO,
});
igual(
  "B1. o ajuste migra de previsto para faturado; nada a faturar; já faturado = receita",
  depois.financeiro,
  {
    apontamentosCentavos: 75000,
    adicionaisCentavos: 10000,
    ajusteFaturadoCentavos: -375,
    ajustePrevistoCentavos: 0,
    ajusteCentavos: -375,
    receitaCentavos: 84625,
    custoCentavos: 63416,
    resultadoCentavos: 21209,
    margemPermil: 251,
    aFaturarCentavos: 0,
    jaFaturadoCentavos: 84625,
  },
);
verificar(
  "B2. a conciliação continua conferindo",
  depois.conciliacao.every((c) => c.confere),
  true,
);
verificar(
  "B3. o item de arredondamento já faturado está na lista",
  `${depois.ajustesFaturados.length}|${depois.ajustesFaturados[0].valorCentavos}`,
  "1|-375",
);
verificar(
  "B4. seis lançamentos em 'já faturado'; nenhum em 'a faturar'",
  `${depois.jaFaturado.diarias}|${depois.aFaturar.diarias}`,
  "6|0",
);
verificar(
  "B5. sem hora extra tardia: a fatura cobriu o acumulado",
  codigos(depois).includes("hora-extra-acumulada-tardia"),
  false,
);
verificar(
  "B6. total cobrado dos apontamentos não muda com a fatura",
  depois.consolidado.faturadoCentavos,
  antes.consolidado.faturadoCentavos,
);

/* ================================================================== */
console.log("\nC. Divergência de conciliação\n");

const divergente = await carregar(aFaturar(), {
  resumo: { ...RESUMO_ANTES, receita_apontamentos: 750.01, receita_total: 846.26 },
});
const itemDivergente = divergente.conciliacao.find((c) => c.codigo === "apontamentos");
verificar(
  "C1. a parcela de apontamentos NÃO confere (1 centavo)",
  `${itemDivergente.confere}|${itemDivergente.fechamentoCentavos}|${itemDivergente.bancoCentavos}`,
  "false|75000|75001",
);
verificar(
  "C2. vira alerta CRÍTICO",
  `${alerta(divergente, "divergencia-conciliacao")?.severidade}|${alerta(divergente, "divergencia-conciliacao")?.quantidade}`,
  "critico|1",
);
verificar(
  "C3. nenhum total foi ajustado para coincidir",
  divergente.financeiro.apontamentosCentavos,
  75000,
);
verificar(
  "C4. as outras parcelas seguem conferindo",
  divergente.conciliacao.filter((c) => c.confere).length,
  5,
);
const adicionalDivergente = await carregar(aFaturar(), {
  resumo: { ...RESUMO_ANTES, adicionais: 0, receita_total: 746.25 },
});
verificar(
  "C5. adicional que o banco não tem: não confere",
  adicionalDivergente.conciliacao.find((c) => c.codigo === "adicionais").confere,
  false,
);
const faturadoDivergente = await carregar(aFaturar(), {
  resumo: { ...RESUMO_ANTES, faturado: 10 },
});
verificar(
  "C6. faturado do banco diferente do dos lançamentos: não confere",
  faturadoDivergente.conciliacao.find((c) => c.codigo === "faturado").confere,
  false,
);

/* ================================================================== */
console.log("\nD. Mês inteiro e período personalizado\n");

// 16/03: E1 +40 min (135,00). Mês: E1 14 + 26 + 40 = 80 → 90 min, +3,75; o resumo soma as quinzenas: −7,50.
const L08 = () =>
  linha({
    ...E1,
    id: "l-08",
    data: "2026-03-16",
    out: "15:40:00",
    worked: 520,
    ot: 40,
    cobrados: 40,
    faturado: "135.00",
    custo: "86.67",
  });
const FILTROS_MES = { clienteId: CLIENTE, inicio: "2026-03-01", fim: "2026-03-31" };
const AJUSTES_MES = [
  {
    employee_id: "emp-1",
    colaborador: "E1",
    valor_hora: 22.5,
    minutos_brutos: 80,
    minutos_arredondados: 90,
    valor_bruto: 30,
    valor_arredondado: 33.75,
    ajuste: 3.75,
  },
  AJUSTES_ANTES[1],
  AJUSTES_ANTES[2],
];
const mes = await carregar(
  [...aFaturar(), L08()],
  {
    resumo: {
      ...RESUMO_ANTES,
      receita_apontamentos: 885,
      receita_total: 885 + 100 - 7.5,
      a_faturar: 885 + 100 - 7.5,
      ajuste_previsto: -7.5,
    },
    ajustes: AJUSTES_MES,
  },
  FILTROS_MES,
);
verificar(
  "D1. o Fechamento do mês arredonda o mês de uma vez: ajuste previsto +3,75",
  mes.financeiro.ajustePrevistoCentavos,
  375,
);
const itemMes = mes.conciliacao.find((c) => c.codigo === "ajuste-previsto");
verificar(
  "D2. o resumo do banco soma as quinzenas (−7,50): o item não confere, e mostra os dois valores",
  `${itemMes.confere}|${itemMes.fechamentoCentavos}|${itemMes.bancoCentavos}`,
  "false|375|-750",
);
verificar(
  "D3. é diferença esperada do mês: alerta de ATENÇÃO 'prévia por quinzena', não divergência crítica",
  `${alerta(mes, "previa-por-quinzena")?.severidade}|${alerta(mes, "divergencia-conciliacao") === undefined}`,
  "atencao|true",
);
verificar(
  "D4. as demais parcelas do mês conferem",
  mes.conciliacao
    .filter((c) => !c.confere)
    .map((c) => c.codigo)
    .join(","),
  "ajuste-previsto",
);
verificar(
  "D5. o mês é um período de fechamento (fatura aceita)",
  ehPeriodoDeFechamento("2026-03-01", "2026-03-31"),
  true,
);
verificar(
  "D6. nenhum aviso de período fora de fechamento no mês",
  alerta(mes, "periodo-fora-de-fechamento") === undefined,
  true,
);

// Quinzena inteira com a MESMA diferença é divergência grave (não há razão de construção).
const quinzenaDiverge = await carregar(aFaturar(), {
  resumo: { ...RESUMO_ANTES, ajuste_previsto: -7.5, receita_total: 842.5, a_faturar: 842.5 },
});
verificar(
  "D7. na quinzena, diferença no ajuste previsto é CRÍTICA",
  alerta(quinzenaDiverge, "divergencia-conciliacao")?.severidade,
  "critico",
);

// Período personalizado (02–20/03) com hora extra acumulada.
const FILTROS_LIVRE = { clienteId: CLIENTE, inicio: "2026-03-02", fim: "2026-03-20" };
const livre = await carregar(
  aFaturar().filter((l) => l.timesheets.work_date >= "2026-03-02"),
  {
    ajustes: AJUSTES_ANTES,
    resumo: { ...RESUMO_ANTES, ajuste_previsto: 0, receita_total: 850, a_faturar: 850 },
  },
  FILTROS_LIVRE,
);
verificar(
  "D8. período personalizado com acumulado: avisa que a fatura só aceita quinzena ou mês",
  alerta(livre, "periodo-fora-de-fechamento")?.severidade,
  "atencao",
);
verificar(
  "D9. e a diferença da prévia (que só soma quinzenas inteiras) é atenção, não divergência",
  alerta(livre, "divergencia-conciliacao") === undefined,
  true,
);
verificar(
  "D10. períodos de fechamento: 1–15, 16–31, mês; 2–20 não",
  [
    ehPeriodoDeFechamento("2026-03-01", "2026-03-15"),
    ehPeriodoDeFechamento("2026-03-16", "2026-03-31"),
    ehPeriodoDeFechamento("2026-02-16", "2026-02-28"),
    ehPeriodoDeFechamento("2026-03-02", "2026-03-20"),
  ].join(","),
  "true,true,true,false",
);
verificar(
  "D11. fevereiro bissexto: 16–29",
  ehPeriodoDeFechamento("2028-02-16", "2028-02-29"),
  true,
);
verificar(
  "D12. mês inteiro",
  [ehMesInteiro("2026-03-01", "2026-03-31"), ehMesInteiro("2026-03-01", "2026-03-15")].join(","),
  "true,false",
);
verificar(
  "D13. dia da semana sem Date: 01/03/2026 é domingo; 07/03 sábado; 02/03 segunda",
  [diaDaSemana("2026-03-01"), diaDaSemana("2026-03-07"), diaDaSemana("2026-03-02")].join(","),
  "0,6,1",
);

/* ================================================================== */
console.log("\nE. Hora extra acumulada tardia\n");

// E1 já tem hora extra faturada na quinzena; um lançamento posterior, também com hora extra, ficou sem fatura.
const L09 = () =>
  linha({
    ...E1,
    id: "l-09",
    data: "2026-03-10",
    out: "15:16:00",
    worked: 496,
    ot: 16,
    cobrados: 16,
    faturado: "126.00",
    custo: "82.67",
  });
const tardia = await carregar([...faturadas(), L09()], {
  resumo: {
    ...RESUMO_DEPOIS,
    receita_apontamentos: 876,
    receita_total: 876 + 100 - 3.75 + 1.5,
    a_faturar: 126 + 1.5,
    ajuste_previsto: 1.5,
  },
  ajustes: [
    {
      employee_id: "emp-1",
      colaborador: "E1",
      valor_hora: 22.5,
      minutos_brutos: 16,
      minutos_arredondados: 30,
      valor_bruto: 6,
      valor_arredondado: 11.25,
      ajuste: 5.25,
    },
  ],
  adicionais: [ADICIONAL("inv-1")],
  faturados: AJUSTE_FATURADO,
});
verificar(
  "E1. aviso CRÍTICO de hora extra acumulada tardia, com o lançamento afetado",
  `${alerta(tardia, "hora-extra-acumulada-tardia")?.severidade}|${alerta(tardia, "hora-extra-acumulada-tardia")?.entryIds.join(",")}`,
  "critico|l-09",
);
verificar(
  "E2. o Fechamento NÃO inventa regra: o ajuste previsto do banco entra como veio (+5,25)",
  tardia.financeiro.ajustePrevistoCentavos,
  525,
);
verificar(
  "E3. sem colaborador com acumulado pendente, sem aviso",
  alerta(depois, "hora-extra-acumulada-tardia") === undefined,
  true,
);

/* ================================================================== */
console.log("\nF. Leitura estrita do banco\n");

verificar("F1. 503.13 → 50313 centavos", centavosDeValor(503.13, "x"), 50313);
verificar("F2. −3.75 → −375", centavosDeValor(-3.75, "x"), -375);
verificar(
  "F3. 100 → 10000; 0 → 0; '12.50' → 1250",
  `${centavosDeValor(100, "x")}|${centavosDeValor(0, "x")}|${centavosDeValor("12.50", "x")}`,
  "10000|0|1250",
);
verificar(
  "F4. mais de duas casas é erro financeiro",
  (await erroDe(() => centavosDeValor("12.345", "x"))) instanceof ErroDeDadoFinanceiro,
  true,
);
verificar(
  "F5. NaN e Infinity são erro",
  `${(await erroDe(() => centavosDeValor(Number.NaN, "x"))) instanceof ErroDeDadoDoFechamento}|${(await erroDe(() => centavosDeValor(Number.POSITIVE_INFINITY, "x"))) instanceof ErroDeDadoDoFechamento}`,
  "true|true",
);
verificar(
  "F6. notação científica (1e21) é recusada",
  (await erroDe(() => centavosDeValor(1e21, "x"))) instanceof ErroDeDadoFinanceiro,
  true,
);
verificar(
  "F7. valor ausente (null/undefined) é erro",
  `${(await erroDe(() => centavosDeValor(null, "x"))) instanceof ErroDeDadoFinanceiro}|${(await erroDe(() => centavosDeValor(undefined, "x"))) instanceof ErroDeDadoFinanceiro}`,
  "true|true",
);
verificar(
  "F8. resumo com duas linhas é erro",
  (await erroDe(() => lerResumoDoBanco([RESUMO_ANTES, RESUMO_ANTES]))) instanceof
    ErroDeDadoDoFechamento,
  true,
);
verificar(
  "F9. resumo vazio é erro (nunca zero inventado)",
  (await erroDe(() => lerResumoDoBanco([]))) instanceof ErroDeDadoDoFechamento,
  true,
);
verificar(
  "F10. resumo sem ajuste_aplicavel é erro",
  (await erroDe(() =>
    lerResumoDoBanco([{ ...RESUMO_ANTES, ajuste_aplicavel: undefined }]),
  )) instanceof ErroDeDadoDoFechamento,
  true,
);
verificar(
  "F11. minutos fracionados no ajuste são erro",
  (await erroDe(() =>
    buscarDadosDoBanco(
      fonteBanco({ ajustes: [{ ...AJUSTES_ANTES[0], minutos_brutos: 40.5 }] }),
      FILTROS,
    ),
  )) instanceof ErroDeDadoDoFechamento,
  true,
);
verificar(
  "F12. adicional sem valor é erro",
  (await erroDe(() =>
    buscarDadosDoBanco(fonteBanco({ adicionais: [{ ...ADICIONAL(), valor: null }] }), FILTROS),
  )) instanceof ErroDeDadoFinanceiro,
  true,
);
verificar(
  "F13. falha de uma das fontes derruba o carregamento inteiro",
  (await erroDe(() =>
    carregarFechamento(FILTROS, {
      async buscarCliente(id) {
        return { id, name: "FQ" };
      },
      criarFonte: () => fonteLinhas(aFaturar()),
      criarFonteDoBanco: () => ({
        ...fonteBanco(),
        async saldoDeHoras() {
          throw new Error("rede caiu");
        },
      }),
      agora: () => new Date("2026-03-16T12:00:00.000Z"),
    }),
  )) instanceof Error,
  true,
);
verificar(
  "F14. ajuste de colaborador sem lançamento no recorte é erro (dado inconsistente)",
  (await erroDe(() =>
    carregar(aFaturar(), {
      ajustes: [{ ...AJUSTES_ANTES[0], employee_id: "emp-9", colaborador: "Fantasma" }],
    }),
  )) instanceof ErroDeDadoDoFechamento,
  true,
);

/* ================================================================== */
console.log("\nG. Assinatura\n");

const bancoDe = async (extra = {}) => buscarDadosDoBanco(fonteBanco(extra), FILTROS);
const assinar = async (extra = {}, brutas = aFaturar()) =>
  assinarFechamento({
    clienteId: CLIENTE,
    clienteNome: "FQ",
    inicio: FILTROS.inicio,
    fim: FILTROS.fim,
    linhas: normalizarLinhas(brutas),
    banco: await bancoDe(extra),
  });
const base = await assinar();
verificar("G1. determinística", await assinar(), base);
verificar(
  "G2. a ordem dos ajustes não muda a assinatura",
  await assinar({ ajustes: [...AJUSTES_ANTES].reverse() }),
  base,
);
verificar(
  "G3. adicional +1 centavo muda a assinatura",
  (await assinar({ adicionais: [{ ...ADICIONAL(), valor: "100.01" }] })) !== base,
  true,
);
verificar(
  "G4. ajuste previsto diferente muda a assinatura",
  (await assinar({
    ajustes: [{ ...AJUSTES_ANTES[0], ajuste: -3.74 }, AJUSTES_ANTES[1], AJUSTES_ANTES[2]],
  })) !== base,
  true,
);
verificar(
  "G5. resumo diferente muda a assinatura",
  (await assinar({ resumo: { ...RESUMO_ANTES, faturado: 1 } })) !== base,
  true,
);
verificar(
  "G6. minutos cobrados diferentes mudam a assinatura",
  (await assinar({}, [
    { ...L01(), billed_overtime_minutes: 15 },
    L02(),
    L03(),
    L04(),
    L05(),
    L06(),
    L07(),
  ])) !== base,
  true,
);
verificar(
  "G7. o saldo de horas também entra no snapshot",
  (await assinar({ saldo: [{ ...SALDO[0], minutos_excedentes: 41 }, SALDO[1], SALDO[2]] })) !==
    base,
  true,
);
verificar("G8. a assinatura do modelo carregado é a do snapshot lido", antes.meta.assinatura, base);

/* ================================================================== */
console.log("\nH. Exportações\n");

const csvColab = lerCsv(csvDoFechamento(antes, "colaborador"));
verificar(
  "H1. CSV por colaborador: cabeçalho traz o ajuste de arredondamento",
  csvColab[0].includes("Ajuste de arredondamento"),
  true,
);
verificar(
  "H2. E1 com ajuste −3,75; os outros 0,00",
  csvColab
    .slice(1, 4)
    .map((l) => l[6])
    .join("|"),
  "-3,75|0,00|0,00",
);
verificar(
  "H3. total do ajuste −3,75 (linha de total, antes do consolidado)",
  csvColab.at(-5)[6],
  "-3,75",
);
verificar("H4. horas extras COBRADAS no CSV: 160 min = 2,67 h", csvColab.at(-5)[4], "2,67");
const csvDiario = lerCsv(csvDoFechamento(antes, "diario"));
verificar(
  "H5. CSV diário: tipo do dia em texto (Feriado, Sábado, Dia comum)",
  ["Feriado", "Sábado", "Dia comum"].every((t) => csvDiario.some((l) => l[6] === t)),
  true,
);
const indicadores = Object.fromEntries(indicadoresDoResumo(antes).map((i) => [i.rotulo, i.valor]));
verificar(
  "H6. resumo exportado: apontamentos 75000, adicionais 10000, ajuste previsto −375, receita 84625",
  [
    indicadores["Apontamentos"],
    indicadores["Adicionais de serviço"],
    indicadores["Ajuste de arredondamento previsto"],
    indicadores["Receita total"],
  ].join(","),
  "75000,10000,-375,84625",
);
verificar(
  "H7. resumo exportado: custo 63416, resultado 21209, margem 251, a faturar 84625, já faturado 0",
  [
    indicadores["Custo previsto / Valor devido"],
    indicadores["Resultado"],
    indicadores["Margem"],
    indicadores["A faturar"],
    indicadores["Já faturado"],
  ].join(","),
  "63416,21209,251,84625,0",
);
verificar(
  "H8. conferência com o banco: seis linhas 'Confere'",
  conciliacaoDoResumo(antes)
    .map((l) => l.valor)
    .join("|"),
  "Confere|Confere|Confere|Confere|Confere|Confere",
);
const conferenciaDivergente = conciliacaoDoResumo(divergente).find((l) =>
  /Apontamentos/.test(l.rotulo),
);
verificar(
  "H9. conferência divergente mostra os dois valores no arquivo",
  conferenciaDivergente.valor,
  "NÃO CONFERE: fechamento R$ 750,00 / banco R$ 750,01",
);
verificar(
  "H10. detalhe do resumo: adicional, ajuste previsto por colaborador e saldo de horas (informativo)",
  detalhesDoResumo(antes)
    .map((l) => l.rotulo.split(" — ")[0])
    .join("|"),
  "Adicional|Arredondamento acumulado previsto|Arredondamento acumulado previsto|Arredondamento acumulado previsto|Saldo de horas (informativo)|Saldo de horas (informativo)|Saldo de horas (informativo)",
);
verificar(
  "H11. tabela por colaborador: total do ajuste vem do financeiro",
  tabelaPorColaborador(antes).totais[6],
  -375,
);
const xlsx = await gerarXlsxDoFechamento(antes);
verificar(
  "H12. o XLSX do cenário é gerado (zip com assinatura PK)",
  xlsx.subarray(0, 2).toString("latin1"),
  "PK",
);
verificar(
  "H13. e o do cenário divergente também",
  (await gerarXlsxDoFechamento(divergente)).length > 1000,
  true,
);

/* ================================================================== */
console.log("\nI. Forma literal e acoplamento com a SQL\n");

const banco = fonteDoRepo("src/lib/fechamento/banco.ts");
const financeiro = fonteDoRepo("src/lib/fechamento/financeiro.ts");
const alertasFonte = fonteDoRepo("src/lib/fechamento/alertas.ts");
const leitura = fonteDoRepo("src/lib/fechamento/leitura.ts");
const semComentarios = (f) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const codigoDoBanco =
  semComentarios(banco) + semComentarios(financeiro) + semComentarios(alertasFonte);

verificar(
  "I1. nenhum arredondamento nem conversão decimal no código do banco, da composição e dos alertas",
  /Math\.(round|floor|ceil|trunc)|toFixed|parseFloat|Number\(/.test(codigoDoBanco),
  false,
);
verificar(
  "I2. nenhuma regra financeira duplicada em TypeScript (tolerância, jornada, fator, valor-hora)",
  /tolerancia|tolerance|valor_hora\s*\*|jornada\s*\*|holiday_pay|saturday_shift|ot_factor/i.test(
    codigoDoBanco,
  ),
  false,
);
verificar(
  "I3. as funções oficiais são chamadas pelo nome",
  [
    "resumo_financeiro_periodo",
    "ajustes_de_arredondamento_acumulado",
    "saldo_de_horas_do_periodo",
  ].every((n) => banco.includes(`"${n}"`)),
  true,
);
verificar(
  'I4. a leitura nomeia billed_overtime_minutes e day_kind_snapshot; nenhum select("*")',
  leitura.includes('"billed_overtime_minutes"') &&
    leitura.includes('"day_kind_snapshot"') &&
    !/select\(\s*["']\*["']/.test(semComentarios(leitura)),
  true,
);
verificar(
  "I5. cliente da sessão: nenhum service_role nem cliente administrativo",
  /service_role|admin-client|createAdminClient|SUPABASE_SERVICE/i.test(banco),
  false,
);
verificar(
  "I6. as consultas auxiliares recusam truncamento (contam e conferem)",
  banco.includes('count: "exact"') && /!== count/.test(banco),
  true,
);
verificar(
  "I7. o dinheiro das consultas auxiliares sai em texto (::text)",
  (banco.match(/::text/g) ?? []).length >= 2,
  true,
);
verificar(
  "I8. nenhuma escrita: o Fechamento só lê (sem insert/update/delete/upsert)",
  /\.(insert|update|delete|upsert)\(/.test(banco + leitura),
  false,
);

const sql = fonteDoRepo("supabase/tests/029_fechamento_conciliacao.sql");
for (const trecho of [
  "'125.25|82.33|494|14|14|util;129.75|84.33|506|26|26|util;0.00|0.00|0|0|0|-;90.00|120.00|360|0|0|feriado;120.00|80.00|0|0|0|util;165.00|187.50|360|120|120|sabado;120.00|80.00|480|0|0|util'",
  "'750.00|634.16|6'",
  "'160|160'",
  "'60.00|690.00'",
  "'E1|40|30|15.00|11.25|-3.75;E2|120|120|45.00|45.00|0.00;E3|0|0|0.00|0.00|0.00'",
  "'750.00|100.00|0.00|-3.75|846.25|846.25|0.00|true'",
  "'750.00|100.00|-3.75|0.00|846.25|0.00|846.25|true'",
  "'E1|3|40|0|40;E2|1|120|0|120;E3|1|0|120|-120'",
  "'E1|80|90|30.00|33.75|3.75'",
  "'-7.50'",
  "'846.25|634.16|2.50'",
  "'690.00|60.00|-3.75|100.00'",
]) {
  verificar(
    `I9. a SQL 029 contém o valor esperado ${trecho.slice(0, 48)}…`,
    sql.includes(trecho),
    true,
  );
}

/* ================================================================== */
console.log("\nJ. Período só com adicionais (B8.21)\n");

const { estadoDoResultado } = await import("../src/lib/fechamento/apresentacao.ts");
const soAdicional = await carregar([], {
  resumo: {
    receita_apontamentos: 0,
    adicionais: 100,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 100,
    a_faturar: 100,
    faturado: 0,
    ajuste_aplicavel: true,
  },
  ajustes: [],
  saldo: [],
});
verificar(
  "J1. só adicional: o período NÃO é vazio",
  estadoDoResultado(soAdicional),
  "somente-financeiro",
);
igual(
  "J2. receita, a faturar e já faturado vêm do banco; custo 0 e nenhuma diária inventada",
  [
    soAdicional.financeiro.receitaCentavos,
    soAdicional.financeiro.adicionaisCentavos,
    soAdicional.financeiro.aFaturarCentavos,
    soAdicional.financeiro.jaFaturadoCentavos,
    soAdicional.financeiro.custoCentavos,
    soAdicional.consolidado.diarias,
    soAdicional.colaboradores.length,
    soAdicional.detalhes.length,
  ],
  [10000, 10000, 10000, 0, 0, 0, 0, 0],
);
verificar(
  "J3. a conciliação confere em todas as parcelas, sem duplicar o adicional",
  soAdicional.conciliacao.every((c) => c.confere),
  true,
);
verificar("J4. o adicional está detalhado", soAdicional.adicionais.length, 1);
const soAdicionalFaturado = await carregar([], {
  resumo: {
    receita_apontamentos: 0,
    adicionais: 100,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 100,
    a_faturar: 0,
    faturado: 100,
    ajuste_aplicavel: true,
  },
  ajustes: [],
  saldo: [],
  adicionais: [ADICIONAL("inv-1")],
});
verificar(
  "J5. adicional já faturado: já faturado 100, a faturar 0, conciliado",
  `${soAdicionalFaturado.financeiro.jaFaturadoCentavos}|${soAdicionalFaturado.financeiro.aFaturarCentavos}|${soAdicionalFaturado.conciliacao.every((c) => c.confere)}`,
  "10000|0|true",
);
const nenhum = await carregar([], {
  resumo: {
    receita_apontamentos: 0,
    adicionais: 0,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 0,
    a_faturar: 0,
    faturado: 0,
    ajuste_aplicavel: true,
  },
  ajustes: [],
  saldo: [],
  adicionais: [],
});
verificar(
  "J6. sem qualquer movimentação (ou só adicional cancelado, que não vem na lista): vazio",
  estadoDoResultado(nenhum),
  "vazio",
);
const soFaltas = await carregar([L03()], {
  resumo: {
    receita_apontamentos: 0,
    adicionais: 0,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 0,
    a_faturar: 0,
    faturado: 0,
    ajuste_aplicavel: true,
  },
  ajustes: [],
  saldo: [],
  adicionais: [],
});
verificar(
  "J7. somente faltas continua somente-faltas",
  estadoDoResultado(soFaltas),
  "somente-faltas",
);
const faltaMaisAdicional = await carregar([L03()], {
  resumo: {
    receita_apontamentos: 0,
    adicionais: 100,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 100,
    a_faturar: 100,
    faturado: 0,
    ajuste_aplicavel: true,
  },
  ajustes: [],
  saldo: [],
});
verificar(
  "J8. falta + adicional: somente-financeiro, e a falta segue contada por colaborador",
  `${estadoDoResultado(faltaMaisAdicional)}|${faltaMaisAdicional.faltas}|${faltaMaisAdicional.colaboradores.length}`,
  "somente-financeiro|1|1",
);
verificar(
  "J9. adicionais + apontamentos: com-lancamentos, sem duplicar (receita 846,25)",
  `${estadoDoResultado(antes)}|${antes.financeiro.receitaCentavos}`,
  "com-lancamentos|84625",
);
verificar(
  "J10. exportação disponível no período só de adicionais: o XLSX é gerado e o resumo traz o adicional",
  (await gerarXlsxDoFechamento(soAdicional)).subarray(0, 2).toString("latin1"),
  "PK",
);
const indSo = Object.fromEntries(indicadoresDoResumo(soAdicional).map((i) => [i.rotulo, i.valor]));
verificar(
  "J11. resumo exportado: adicionais 10000, receita 10000, custo 0, diárias 0",
  [
    indSo["Adicionais de serviço"],
    indSo["Receita total"],
    indSo["Custo previsto / Valor devido"],
    indSo["Quantidade de diárias"],
  ].join(","),
  "10000,10000,0,0",
);
verificar(
  "J12. CSV só com adicionais: por colaborador = cabeçalho + total + 4 linhas do consolidado; diário só cabeçalho",
  [
    lerCsv(csvDoFechamento(soAdicional, "colaborador")).length,
    lerCsv(csvDoFechamento(soAdicional, "diario")).length,
  ].join(","),
  "6,1",
);
{
  const painel = semComentarios(fonteDoRepo("src/app/(painel)/fechamento/painel-fechamento.tsx"));
  verificar(
    "J13. a tela libera a exportação no estado somente-financeiro",
    /estado === "com-lancamentos" \|\| estado === "somente-financeiro"/.test(painel),
    true,
  );
  verificar(
    "J14. e mostra a conciliação em todo estado que não é vazio",
    painel.indexOf("<ConciliacaoDoFechamento") > painel.indexOf('estado === "vazio"'),
    true,
  );
}

/* ================================================================== */
console.log("\nK. Alertas em todo estado e consolidado do CSV (B8.21)\n");

const { temDivergencia } = await import("../src/lib/fechamento/apresentacao.ts");
const vazioDivergente = await carregar([], {
  resumo: {
    receita_apontamentos: 50,
    adicionais: 0,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 50,
    a_faturar: 50,
    faturado: 0,
    ajuste_aplicavel: true,
  },
  ajustes: [],
  saldo: [],
  adicionais: [],
});
verificar(
  "K1. período vazio com valor no banco: o estado segue vazio (nenhuma diária inventada)",
  `${estadoDoResultado(vazioDivergente)}|${vazioDivergente.consolidado.diarias}|${vazioDivergente.colaboradores.length}`,
  "vazio|0|0",
);
verificar(
  "K2. mas o ALERTA CRÍTICO de divergência existe e a divergência é detectada",
  `${alerta(vazioDivergente, "divergencia-conciliacao")?.severidade}|${temDivergencia(vazioDivergente)}`,
  "critico|true",
);
verificar(
  "K3. o alerta não altera nenhum total",
  `${vazioDivergente.financeiro.receitaCentavos}|${vazioDivergente.financeiro.apontamentosCentavos}`,
  "0|0",
);
verificar(
  "K4. vazio sem divergência: sem alerta e sem conciliação extra",
  `${nenhum.alertas.length}|${temDivergencia(nenhum)}`,
  "0|false",
);
verificar(
  "K5. só faltas e só adicionais continuam com seus alertas visíveis",
  `${codigos(soFaltas).join(",")}|${soAdicional.alertas.length}`,
  "falta|0",
);
{
  const painel = semComentarios(fonteDoRepo("src/app/(painel)/fechamento/painel-fechamento.tsx"));
  const iAlertas = painel.indexOf("<AlertasDoFechamento");
  verificar(
    "K6. a tela renderiza os alertas UMA vez, antes de qualquer ramo de estado",
    (painel.match(/<AlertasDoFechamento/g) ?? []).length === 1 &&
      iAlertas < painel.indexOf('estado === "vazio"'),
    true,
  );
  verificar(
    "K7. no estado vazio a conciliação só aparece com divergência",
    /temDivergencia\(dados\) \? <ConciliacaoDoFechamento/.test(painel),
    true,
  );
}
const csvSoAdicional = lerCsv(csvDoFechamento(soAdicional, "colaborador"));
verificar(
  "K8. CSV só com adicionais: adicional 100,00 e receita 100,00 nas linhas do consolidado, sem colaborador",
  `${csvSoAdicional.at(-4)[10]}|${csvSoAdicional.at(-1)[10]}|${csvSoAdicional.length}`,
  "100,00|100,00|6",
);
const csvAntes = lerCsv(csvDoFechamento(antes, "colaborador"));
verificar(
  "K9. apontamentos + adicional (cenário 029): receita no consolidado 846,25 = total cobrado 750,00 + adicional 100,00 + ajuste −3,75",
  `${csvAntes.at(-5)[10]}|${csvAntes.at(-4)[10]}|${csvAntes.at(-5)[6]}|${csvAntes.at(-1)[10]}`,
  "750,00|100,00|-3,75|846,25",
);
verificar(
  "K10. já faturado/a faturar do consolidado: 0,00 e 846,25; custo 634,16; resultado 212,09",
  `${csvAntes.at(-1)[8]}|${csvAntes.at(-1)[9]}|${csvAntes.at(-1)[7]}|${csvAntes.at(-1)[11]}`,
  "0,00|846,25|634,16|212,09",
);
verificar(
  "K11. conciliado com o resumo exportado (XLSX/Resumo): mesma receita",
  `${csvAntes.at(-1)[10] === "846,25"}|${indicadores["Receita total"]}`,
  "true|84625",
);
verificar(
  "K12. a soma das linhas por colaborador não inclui o adicional (sem duplicar)",
  csvAntes
    .slice(1, -5)
    .reduce((a, l) => a + Number(l[10].replace(",", ".")) * 100, 0)
    .toFixed(0),
  "75000",
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
