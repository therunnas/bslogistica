/**
 * Testes do XLSX do Fechamento PARA O CLIENTE (modelo Dynamis, FIN-PR-12).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-xlsx-cliente
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`, com o hook
 * `_resolver-ts.mjs`. Sai com código diferente de zero em qualquer falha.
 *
 * O arquivo é gerado DE VERDADE e aberto como ZIP (`_zip.mjs`): as asserções olham o XML interno.
 *
 * A fixture é SINTÉTICA e passa pelo caminho real (linhas brutas → `normalizarLinhas` →
 * `agregarFechamento`). Os valores esperados abaixo foram conferidos À MÃO a partir das linhas,
 * nunca lidos do próprio gerador. Ela NÃO é a quinzena Dynamis original: o total da conciliação
 * comercial (FIN-PR-13) não se aplica aqui.
 *
 * BLOCOS
 *
 *   T. título do período (quinzena, mês, recorte livre)
 *   M. modelo: ordem, colunas, valores, totais e conferência contra o Fechamento
 *   S. sem custo, resultado nem margem
 *   X. arquivo: abas, topo, cabeçalho, formatos, valores
 *   F. SUBTOTAL, total fixo, autofiltro, congelamento e recálculo ao abrir
 *   H. textos hostis: nenhuma fórmula além dos SUBTOTAL
 *   V. período vazio e fixture ouro
 *   D. cliente HTTP do download (rota por modelo, corpo inalterado)
 *   L. forma literal do Route Handler
 *   U. interface
 */

import { readFileSync } from "node:fs";

import { agregarFechamento } from "../src/lib/fechamento/agregar.ts";
import { baixarXlsx, ROTA_DO_XLSX } from "../src/lib/fechamento/download.ts";
import { descreverErro } from "../src/lib/fechamento/http.ts";
import {
  COLUNAS_DO_RESUMO,
  COLUNAS_DOS_LANCAMENTOS,
  ErroDaExportacaoDoCliente,
  ROTULO_DO_AJUSTE_ACUMULADO,
  ROTULO_DO_AJUSTE_JA_FATURADO,
  ROTULO_DO_SUBTOTAL,
  ROTULO_DO_TOTAL_DO_FECHAMENTO,
  ROTULO_DOS_SERVICOS,
  tabelaDoResumo,
  tabelaDosLancamentos,
  tituloDoFechamento,
} from "../src/lib/fechamento/exportacao-cliente.ts";
import { normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";
import {
  ABA_DO_RESUMO,
  ABA_DOS_LANCAMENTOS,
  AVISO_SEM_LANCAMENTOS,
  gerarXlsxDoCliente,
  LINHA_DO_CABECALHO,
} from "../src/lib/fechamento/xlsx-cliente.ts";
import { lerZip } from "./_zip.mjs";
import { bancoCoerente } from "./_fechamento-banco.mjs";
import {
  dadosDoOuro,
  dadosVazios,
  desescapar,
  lerEstilos,
  lerPlanilha,
  lerStringsCompartilhadas,
  ouro,
  serialDoExcel,
  TEXTOS_HOSTIS,
} from "./_fechamento-exportacao.mjs";

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

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function erroDe(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

// ---------------------------------------------------------------------------
// Fixture sintética (1ª quinzena de outubro/2026)
//
//  Álvaro Costa   03/10 sábado   presente  diária 150,00 + HE 18,75 (30 min)            = 168,75
//  Álvaro Costa   04/10 domingo  presente  domingo/feriado 300,00 + adicional 20,00     = 320,00
//  Beatriz Alves  01/10 comum    presente  diária 150,00                                = 150,00
//  Beatriz Alves  02/10 comum    presente  diária 150,00 + HE 37,50 (60 min)            = 187,50
//  Beatriz Alves  ajuste de arredondamento previsto (HE acumulada)                      =  12,50
//  Carlos Dias    05/10 comum    substituto diária 140,00 + adicional 10,00 (faturado)  = 150,00
//  Daniel Ramos   06/10          falta (não entra em nenhuma linha)
//  Serviço avulso 07/10 Container 40 pés — descarga (ref. CNT-001), operação CD Norte   = 850,00
//  Serviço avulso 08–09/10 Container 20 pés — ova, sem operação                         = 420,50
//  Ajuste de arredondamento já faturado                                                 =   0,07
//
//  Totais: diária 590,00 · HE 68,82 · domingo/feriado 300,00 · adicional 1.300,50
//          total 2.259,32 · horas extras 1,50 h · diárias 5

const CLIENTE = ouro.contexto.clienteId;
const INICIO = "2026-10-01";
const FIM = "2026-10-15";

function linhaBruta({
  id,
  emp,
  nome,
  funcao,
  data,
  status = "present",
  operacao = ["op-cd", "CD Norte"],
  tipo = "util",
  base = "0.00",
  he = "0.00",
  especial = "0.00",
  adicional = "0.00",
  minutosHe = 0,
  fatura = null,
}) {
  const cobrado = (
    [base, he, especial, adicional].reduce((t, v) => t + Math.round(Number(v) * 100), 0) / 100
  ).toFixed(2);
  return {
    id,
    employee_id: emp,
    status,
    check_in: status === "absent" ? null : "08:00:00",
    check_out: status === "absent" ? null : "17:00:00",
    worked_minutes: status === "absent" ? 0 : 480 + minutosHe,
    overtime_minutes: minutosHe,
    billed_overtime_minutes: minutosHe,
    invoice_id: fatura,
    faturado: status === "absent" ? "0.00" : cobrado,
    custo: status === "absent" ? "0.00" : "100.00",
    taxa_da_diaria: "150.00",
    calc_version: status === "absent" ? null : 2,
    base: status === "absent" ? null : base,
    he: status === "absent" ? null : he,
    especial: status === "absent" ? null : especial,
    adicional_diario: status === "absent" ? null : adicional,
    day_kind_snapshot: status === "absent" ? null : tipo,
    employees: { id: emp, name: nome, role: funcao },
    timesheets: {
      id: `ts-${operacao[0]}-${data}`,
      work_date: data,
      status: "open",
      operation_id: operacao[0],
      operations: { id: operacao[0], client_id: CLIENTE, name: operacao[1], contract_id: "ctr-1" },
      shifts: { id: "sh-1", name: "Diurno" },
    },
  };
}

const BRUTAS = [
  linhaBruta({
    id: "e-02",
    emp: "emp-bia",
    nome: "Beatriz Alves",
    funcao: "Conferente",
    data: "2026-10-02",
    base: "150.00",
    he: "37.50",
    minutosHe: 60,
  }),
  linhaBruta({
    id: "e-01",
    emp: "emp-bia",
    nome: "Beatriz Alves",
    funcao: "Conferente",
    data: "2026-10-01",
    base: "150.00",
  }),
  linhaBruta({
    id: "e-04",
    emp: "emp-alv",
    nome: "Álvaro Costa",
    funcao: "Auxiliar de produção",
    data: "2026-10-04",
    tipo: "domingo",
    especial: "300.00",
    adicional: "20.00",
  }),
  linhaBruta({
    id: "e-03",
    emp: "emp-alv",
    nome: "Álvaro Costa",
    funcao: "Auxiliar de produção",
    data: "2026-10-03",
    tipo: "sabado",
    base: "150.00",
    he: "18.75",
    minutosHe: 30,
  }),
  linhaBruta({
    id: "e-05",
    emp: "emp-car",
    nome: "Carlos Dias",
    funcao: "Operador",
    data: "2026-10-05",
    status: "replacement",
    base: "140.00",
    adicional: "10.00",
    fatura: "fat-1",
  }),
  linhaBruta({
    id: "e-06",
    emp: "emp-dan",
    nome: "Daniel Ramos",
    funcao: "Operador",
    data: "2026-10-06",
    status: "absent",
  }),
];

const SERVICOS = [
  {
    id: "ad-2",
    descricao: "Container 20 pés — ova",
    referencia: null,
    operacaoId: null,
    inicio: "2026-10-08",
    fim: "2026-10-09",
    valorCentavos: 42050,
    faturaId: null,
  },
  {
    id: "ad-1",
    descricao: "Container 40 pés — descarga",
    referencia: "CNT-001",
    operacaoId: "op-cd",
    inicio: "2026-10-07",
    fim: "2026-10-07",
    valorCentavos: 85000,
    faturaId: null,
  },
];

const AJUSTES_PREVISTOS = [
  {
    employeeId: "emp-bia",
    colaborador: "Beatriz Alves",
    valorHoraCentavos: 3750,
    minutosBrutos: 60,
    minutosArredondados: 80,
    valorBrutoCentavos: 3750,
    valorArredondadoCentavos: 5000,
    ajusteCentavos: 1250,
  },
];

const AJUSTES_FATURADOS = [{ faturaId: "fat-1", descricao: "Arredondamento", valorCentavos: 7 }];

function montar(brutas, extras, periodo = { inicio: INICIO, fim: FIM }) {
  const linhas = normalizarLinhas(structuredClone(brutas));
  return agregarFechamento(linhas, {
    ...ouro.contexto,
    ...periodo,
    clienteNome: "Cliente Teste FIN-12",
    banco: bancoCoerente(linhas, extras),
  });
}

const EXTRAS = {
  adicionais: SERVICOS,
  ajustesPrevistos: AJUSTES_PREVISTOS,
  ajustesFaturados: AJUSTES_FATURADOS,
};
const dados = montar(BRUTAS, EXTRAS);

// ---------------------------------------------------------------------------
console.log("\nT. Título do período");

verificar(
  "T1. 1ª quinzena",
  tituloDoFechamento("2026-10-01", "2026-10-15"),
  "Fechamento – 1ª quinzena de outubro/2026",
);
verificar(
  "T2. 2ª quinzena (mês de 31 dias)",
  tituloDoFechamento("2026-10-16", "2026-10-31"),
  "Fechamento – 2ª quinzena de outubro/2026",
);
verificar(
  "T3. 2ª quinzena de fevereiro bissexto termina no dia 29",
  tituloDoFechamento("2028-02-16", "2028-02-29"),
  "Fechamento – 2ª quinzena de fevereiro/2028",
);
verificar(
  "T4. 16 a 28/02 de ano bissexto não é a 2ª quinzena inteira",
  tituloDoFechamento("2028-02-16", "2028-02-28"),
  "Fechamento – 16/02/2028 a 28/02/2028",
);
verificar(
  "T5. mês inteiro",
  tituloDoFechamento("2026-03-01", "2026-03-31"),
  "Fechamento – março/2026",
);
verificar(
  "T6. recorte livre",
  tituloDoFechamento("2026-10-03", "2026-10-09"),
  "Fechamento – 03/10/2026 a 09/10/2026",
);
verificar(
  "T7. recorte entre meses",
  tituloDoFechamento("2026-09-25", "2026-10-05"),
  "Fechamento – 25/09/2026 a 05/10/2026",
);
verificar(
  "T8. usa travessão (–), como o modelo pede",
  tituloDoFechamento(INICIO, FIM).includes(" – "),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nM. Modelo");

const lancamentos = tabelaDosLancamentos(dados);
const resumo = tabelaDoResumo(dados);

igual(
  "M1. colunas da aba de lançamentos, na ordem",
  lancamentos.colunas.map((c) => c.titulo),
  [
    "Colaborador",
    "Função",
    "Data",
    "Operação",
    "Tipo do dia",
    "Lançamento",
    "Horas extras (h)",
    "Diária",
    "Hora extra",
    "Domingo/feriado",
    "Adicional",
    "Total",
  ],
);
igual(
  "M2. colunas do resumo, na ordem",
  resumo.colunas.map((c) => c.titulo),
  [
    "Colaborador",
    "Função",
    "Diárias",
    "Horas extras (h)",
    "Diária",
    "Hora extra",
    "Domingo/feriado",
    "Adicional",
    "Total",
  ],
);
igual(
  "M3. ordem: colaborador (pt-BR, Á com A) e data; ajuste do colaborador depois das diárias dele; depois serviços por data e o ajuste já faturado",
  lancamentos.linhas.map((l) => `${l[0] ?? "-"}|${l[2] ?? "-"}|${l[5]}`),
  [
    "Álvaro Costa|2026-10-03|Diária — presente",
    "Álvaro Costa|2026-10-04|Diária — presente",
    "Beatriz Alves|2026-10-01|Diária — presente",
    "Beatriz Alves|2026-10-02|Diária — presente",
    `Beatriz Alves|-|${ROTULO_DO_AJUSTE_ACUMULADO}`,
    "Carlos Dias|2026-10-05|Diária — substituto",
    "-|2026-10-07|Adicional de serviço — Container 40 pés — descarga (ref. CNT-001)",
    "-|2026-10-08|Adicional de serviço — Container 20 pés — ova — 08/10/2026 a 09/10/2026",
    `-|-|${ROTULO_DO_AJUSTE_JA_FATURADO}`,
  ],
);
verificar(
  "M4. falta não gera linha",
  lancamentos.linhas.some((l) => l[0] === "Daniel Ramos"),
  false,
);
igual(
  "M5. sábado: função, operação, tipo, horas e valores (centésimos de hora e centavos)",
  lancamentos.linhas[0],
  [
    "Álvaro Costa",
    "Auxiliar de produção",
    "2026-10-03",
    "CD Norte",
    "Sábado",
    "Diária — presente",
    50,
    15000,
    1875,
    0,
    0,
    16875,
  ],
);
igual(
  "M6. domingo: domingo/feriado e adicional diário SOMADOS ao total",
  lancamentos.linhas[1].slice(4),
  ["Domingo", "Diária — presente", 0, 0, 0, 30000, 2000, 32000],
);
igual(
  "M7. ajuste previsto entra como hora extra do colaborador e no total",
  lancamentos.linhas[4].slice(6),
  [null, 0, 1250, 0, 0, 1250],
);
igual(
  "M8. serviço avulso (container) em linha própria: operação resolvida, valor em Adicional e no Total",
  lancamentos.linhas[6].slice(2),
  [
    "2026-10-07",
    "CD Norte",
    null,
    "Adicional de serviço — Container 40 pés — descarga (ref. CNT-001)",
    null,
    0,
    0,
    0,
    85000,
    85000,
  ],
);
igual("M9. serviço sem operação fica sem operação", lancamentos.linhas[7][3], null);
igual(
  "M10. total do fechamento por coluna (horas, diária, HE, domingo/feriado, adicional, total)",
  lancamentos.total.slice(6),
  [150, 59000, 6882, 30000, 130050, 225932],
);
verificar(
  "M11. total = receita do Fechamento",
  lancamentos.total[11],
  dados.financeiro.receitaCentavos,
);
verificar(
  "M12. em toda linha, Total = Diária + Hora extra + Domingo/feriado + Adicional",
  lancamentos.linhas.every((l) => l[7] + l[8] + l[9] + l[10] === l[11]),
  true,
);
igual(
  "M13. resumo por colaborador, na ordem do Fechamento, mais serviços e ajuste já faturado",
  resumo.linhas,
  [
    ["Álvaro Costa", "Auxiliar de produção", 2, 50, 15000, 1875, 30000, 2000, 48875],
    ["Beatriz Alves", "Conferente", 2, 100, 30000, 5000, 0, 0, 35000],
    ["Carlos Dias", "Operador", 1, 0, 14000, 0, 0, 1000, 15000],
    [ROTULO_DOS_SERVICOS, null, null, null, 0, 0, 0, 127050, 127050],
    [ROTULO_DO_AJUSTE_JA_FATURADO, null, null, null, 0, 7, 0, 0, 7],
  ],
);
igual(
  "M14. total do resumo = total dos lançamentos, com 5 diárias",
  resumo.total.slice(2),
  [5, 150, 59000, 6882, 30000, 130050, 225932],
);
verificar("M15. linha de total rotulada", lancamentos.total[0], ROTULO_DO_TOTAL_DO_FECHAMENTO);

// Conferência: o modelo recusa entregar quando a soma não é a do Fechamento.
const adulterado = structuredClone(dados);
adulterado.financeiro.receitaCentavos += 1;
verificar(
  "M16. receita divergente: recusa a exportação",
  erroDe(() => tabelaDosLancamentos(adulterado)) instanceof ErroDaExportacaoDoCliente,
  true,
);
const decomposicao = structuredClone(dados);
decomposicao.detalhes[0].extraCentavos += 1;
igual(
  "M16b. a recusa vira 422 dado-inconsistente (não 500), sem detalhe na resposta",
  [
    descreverErro(erroDe(() => tabelaDosLancamentos(adulterado))).status,
    descreverErro(erroDe(() => tabelaDosLancamentos(adulterado))).corpo.erro.codigo,
  ],
  [422, "dado-inconsistente"],
);
verificar(
  'M19. vocabulário do projeto: adicionais de serviço, nunca "serviço avulso"',
  /servi[çc]o avulso/i.test(
    JSON.stringify([lancamentos.linhas, resumo.linhas, ROTULO_DOS_SERVICOS]),
  ),
  false,
);
verificar(
  "M20. linha do resumo: Adicionais de serviço",
  ROTULO_DOS_SERVICOS,
  "Adicionais de serviço",
);
verificar(
  "M17. componentes que não somam o cobrado: recusa a exportação",
  erroDe(() => tabelaDosLancamentos(decomposicao)) instanceof ErroDaExportacaoDoCliente,
  true,
);
const diarias = structuredClone(dados);
diarias.colaboradores[0].consolidado.diarias += 1;
verificar(
  "M18. diárias do resumo divergentes do Fechamento: recusa",
  erroDe(() => tabelaDoResumo(diarias)) instanceof ErroDaExportacaoDoCliente,
  true,
);

// ---------------------------------------------------------------------------
console.log("\nS. Sem custo, resultado nem margem");

verificar(
  "S1. nenhuma coluna interna nas duas abas",
  [...COLUNAS_DOS_LANCAMENTOS, ...COLUNAS_DO_RESUMO].some((c) =>
    /custo|resultado|margem|lucro/i.test(c.titulo),
  ),
  false,
);
const modelo = semComentarios(fonte("src/lib/fechamento/exportacao-cliente.ts"));
verificar(
  "S2. o modelo não lê custo, resultado nem margem",
  /custoCentavos|resultadoCentavos|margemPermil|aFaturar|jaFaturado/.test(modelo),
  false,
);
verificar(
  "S3. o gerador não lê custo, resultado nem margem",
  /custoCentavos|resultadoCentavos|margemPermil/.test(
    semComentarios(fonte("src/lib/fechamento/xlsx-cliente.ts")),
  ),
  false,
);

// ---------------------------------------------------------------------------
console.log("\nX. Arquivo");

function abrir(buffer) {
  const zip = lerZip(buffer);
  const strings = lerStringsCompartilhadas(zip.get("xl/sharedStrings.xml") ?? "");
  const formato = lerEstilos(zip.get("xl/styles.xml"));
  const planilha = (n) => {
    const xml = zip.get(`xl/worksheets/sheet${n}.xml`);
    return { xml, celulas: lerPlanilha(xml, strings) };
  };
  return { zip, strings, formato, planilha, workbook: zip.get("xl/workbook.xml") };
}

const buffer = await gerarXlsxDoCliente(dados);
const xlsx = abrir(buffer);
const aba1 = xlsx.planilha(1);
const aba2 = xlsx.planilha(2);
const texto = (aba, ref) => aba.celulas.get(ref)?.texto ?? null;
const numero = (aba, ref) => {
  const c = aba.celulas.get(ref);
  return c && c.tipo === "n" ? Number(c.bruto) : null;
};
const formatoDe = (aba, ref) => xlsx.formato(aba.celulas.get(ref)?.estilo);

verificar("X1. é um ZIP", buffer.subarray(0, 2).toString("latin1"), "PK");
igual(
  "X2. duas abas, na ordem: Fechamento e Resumo por colaborador",
  [...xlsx.workbook.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => desescapar(m[1])),
  [ABA_DOS_LANCAMENTOS, ABA_DO_RESUMO],
);
verificar("X3. título na A1", texto(aba1, "A1"), "Fechamento – 1ª quinzena de outubro/2026");
verificar(
  "X4. o resumo repete o título e se identifica",
  `${texto(aba2, "A1")} / ${texto(aba2, "B1")}`,
  `Fechamento – 1ª quinzena de outubro/2026 / ${ABA_DO_RESUMO}`,
);
verificar(
  "X5. cliente",
  `${texto(aba1, "A2")}: ${texto(aba1, "B2")}`,
  "Cliente: Cliente Teste FIN-12",
);
verificar(
  "X6. período em dd/mm/aaaa",
  `${texto(aba1, "A3")}: ${texto(aba1, "B3")}`,
  "Período: 01/10/2026 a 15/10/2026",
);
verificar("X7. cabeçalho na linha 5", LINHA_DO_CABECALHO, 5);
igual(
  "X8. cabeçalho da aba Fechamento",
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map((c) => texto(aba1, `${c}5`)),
  COLUNAS_DOS_LANCAMENTOS.map((c) => c.titulo),
);
verificar(
  "X9. data como número de série do Excel",
  numero(aba1, "C6"),
  serialDoExcel("2026-10-03"),
);
verificar("X10. data no formato dd/mm/yyyy", formatoDe(aba1, "C6"), "dd/mm/yyyy");
verificar("X11. moeda em reais", formatoDe(aba1, "L6"), '"R$" #,##0.00');
verificar("X12. moeda como número em reais (168,75)", numero(aba1, "L6"), 168.75);
verificar("X13. horas extras em horas decimais (0,50)", numero(aba1, "G6"), 0.5);
verificar("X14. adicional do domingo somado ao total (320,00)", numero(aba1, "L7"), 320);
verificar("X15. serviço avulso sem colaborador", aba1.celulas.get("A12")?.tipo ?? "vazia", "vazia");
verificar("X16. serviço avulso: valor no Adicional", numero(aba1, "K12"), 850);
verificar(
  "X17. última linha de dados é o ajuste já faturado (linha 14)",
  texto(aba1, "F14"),
  ROTULO_DO_AJUSTE_JA_FATURADO,
);
verificar(
  "X18. linha 15 em branco separa os dados do subtotal",
  [...aba1.celulas.keys()].some((r) => /^[A-Z]+15$/.test(r)),
  false,
);

// ---------------------------------------------------------------------------
console.log("\nF. SUBTOTAL, total, filtro, congelamento e recálculo");

const formulaDe = (aba, ref) => {
  const m = new RegExp(`<c r="${ref}"[^>]*>(.*?)</c>`, "s").exec(aba.xml);
  return m ? (/<f>(.*?)<\/f>/s.exec(m[1])?.[1] ?? null) : null;
};

verificar("F1. rótulo do subtotal", texto(aba1, "A16"), ROTULO_DO_SUBTOTAL);
igual(
  "F2. SUBTOTAL(109) nas colunas numéricas, só sobre as linhas de dados (6–14)",
  ["G", "H", "I", "J", "K", "L"].map((c) => formulaDe(aba1, `${c}16`)),
  ["G", "H", "I", "J", "K", "L"].map((c) => `SUBTOTAL(109,${c}6:${c}14)`),
);
verificar("F3. fórmula sem '=' (forma do OOXML)", formulaDe(aba1, "L16").startsWith("="), false);
verificar("F4. subtotal de dinheiro em reais", formatoDe(aba1, "L16"), '"R$" #,##0.00');
verificar("F5. subtotal de horas em horas", formatoDe(aba1, "G16"), "0.00");
verificar("F6. rótulo do total fixo", texto(aba1, "A17"), ROTULO_DO_TOTAL_DO_FECHAMENTO);
igual(
  "F7. total fixo: 1,50 h · 590,00 · 68,82 · 300,00 · 1.300,50 · 2.259,32",
  ["G", "H", "I", "J", "K", "L"].map((c) => numero(aba1, `${c}17`)),
  [1.5, 590, 68.82, 300, 1300.5, 2259.32],
);
verificar(
  "F8. no Fechamento, as únicas fórmulas são os 6 SUBTOTAL",
  (aba1.xml.match(/<f>/g) ?? []).length,
  6,
);
igual(
  "F9. resumo: SUBTOTAL de diárias, horas e valores (linhas 6–10)",
  ["C", "D", "E", "F", "G", "H", "I"].map((c) => formulaDe(aba2, `${c}12`)),
  ["C", "D", "E", "F", "G", "H", "I"].map((c) => `SUBTOTAL(109,${c}6:${c}10)`),
);
verificar("F10. resumo: diárias somadas como inteiro", formatoDe(aba2, "C12"), "0");
igual(
  "F11. resumo: total fixo igual ao dos lançamentos",
  ["C", "D", "E", "F", "G", "H", "I"].map((c) => numero(aba2, `${c}13`)),
  [5, 1.5, 590, 68.82, 300, 1300.5, 2259.32],
);
verificar(
  "F12. autofiltro em todas as colunas, do cabeçalho à última linha de dados",
  /<autoFilter ref="A5:L14"\s*\/>/.test(aba1.xml),
  true,
);
verificar("F13. autofiltro do resumo", /<autoFilter ref="A5:I10"\s*\/>/.test(aba2.xml), true);
verificar(
  "F14. nomes ocultos do filtro, um por aba",
  xlsx.workbook.includes(
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Fechamento'!$A$5:$L$14</definedName>`,
  ) &&
    xlsx.workbook.includes(
      `<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'Resumo por colaborador'!$A$5:$I$10</definedName>`,
    ),
  true,
);
verificar(
  "F15. topo e cabeçalho congelados (5 linhas)",
  /<pane\b[^>]*ySplit="5"/.test(aba1.xml),
  true,
);
verificar("F16. recálculo ao abrir", /<calcPr fullCalcOnLoad="1"\/>/.test(xlsx.workbook), true);

// ---------------------------------------------------------------------------
console.log("\nH. Textos hostis");

const BRUTAS_HOSTIS = BRUTAS.map((l, i) => {
  const c = structuredClone(l);
  c.employees.name = TEXTOS_HOSTIS[i % TEXTOS_HOSTIS.length];
  c.employees.role = TEXTOS_HOSTIS[(i + 1) % TEXTOS_HOSTIS.length];
  c.timesheets.operations.name = TEXTOS_HOSTIS[(i + 2) % TEXTOS_HOSTIS.length];
  return c;
});
const SERVICOS_HOSTIS = SERVICOS.map((s, i) => ({
  ...s,
  descricao: TEXTOS_HOSTIS[(i + 4) % TEXTOS_HOSTIS.length],
  referencia: TEXTOS_HOSTIS[(i + 6) % TEXTOS_HOSTIS.length],
}));
const hostis = montar(BRUTAS_HOSTIS, { ...EXTRAS, adicionais: SERVICOS_HOSTIS });
hostis.meta.clienteNome = TEXTOS_HOSTIS[0];
const xlsxHostil = abrir(await gerarXlsxDoCliente(hostis));
const hostil1 = xlsxHostil.planilha(1);
const hostil2 = xlsxHostil.planilha(2);
verificar(
  "H1. nenhuma fórmula além dos SUBTOTAL (6 + 7)",
  (hostil1.xml.match(/<f>/g) ?? []).length + (hostil2.xml.match(/<f>/g) ?? []).length,
  13,
);
verificar(
  "H2. toda fórmula é um SUBTOTAL montado pelo gerador",
  [...hostil1.xml.matchAll(/<f>(.*?)<\/f>/g), ...hostil2.xml.matchAll(/<f>(.*?)<\/f>/g)].every(
    (m) => /^SUBTOTAL\(109,[A-L]\d+:[A-L]\d+\)$/.test(m[1]),
  ),
  true,
);
verificar(
  "H3. os textos hostis chegam como texto",
  TEXTOS_HOSTIS.slice(0, 4).every((t) => xlsxHostil.strings.some((s) => s.includes(t.trim()))),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nV. Período vazio e fixture ouro");

const vazio = dadosVazios();
const xlsxVazio = abrir(await gerarXlsxDoCliente(vazio));
const vazia1 = xlsxVazio.planilha(1);
verificar("V1. período vazio gera arquivo com aviso", texto(vazia1, "A6"), AVISO_SEM_LANCAMENTOS);
verificar("V2. sem dados, sem SUBTOTAL", (vazia1.xml.match(/<f>/g) ?? []).length, 0);
verificar("V3. total fixo zerado", numero(vazia1, "L7"), 0);
verificar("V4. filtro só no cabeçalho", /<autoFilter ref="A5:L5"\s*\/>/.test(vazia1.xml), true);

const dadosOuro = dadosDoOuro();
const ouroLancamentos = tabelaDosLancamentos(dadosOuro);
verificar(
  "V5. fixture ouro (legado): total = receita conferida à mão (1.077,64)",
  ouroLancamentos.total[11],
  107764,
);
verificar(
  "V6. fixture ouro: Gabi Nunes (só faltas) não aparece no resumo",
  tabelaDoResumo(dadosOuro).linhas.some((l) => l[0] === "Gabi Nunes"),
  false,
);
verificar(
  "V7. fixture ouro: arquivo gerado sem erro",
  (await gerarXlsxDoCliente(dadosOuro)).subarray(0, 2).toString("latin1"),
  "PK",
);

// Só serviços (fatura apenas de serviços avulsos é válida).
const soServicos = montar([], { adicionais: SERVICOS });
igual(
  "V8. período só com serviços avulsos: duas linhas e total 1.270,50",
  [tabelaDosLancamentos(soServicos).linhas.length, tabelaDosLancamentos(soServicos).total[11]],
  [2, 127050],
);

// ---------------------------------------------------------------------------
console.log("\nD. Download");

const chamadas = [];
const respostaOk = () =>
  new Response(new Uint8Array([80, 75]), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
const fetchFalso = async (url, init) => {
  chamadas.push({ url, corpo: JSON.parse(init.body) });
  return respostaOk();
};
const pedido = { clienteId: "c", inicio: INICIO, fim: FIM, assinatura: "a".repeat(64) };
await baixarXlsx({ ...pedido, modelo: "cliente" }, { fetchImpl: fetchFalso });
await baixarXlsx(pedido, { fetchImpl: fetchFalso });
verificar(
  "D1. modelo cliente vai à rota do cliente",
  chamadas[0].url,
  "/api/fechamento/xlsx-cliente",
);
verificar("D2. sem modelo, continua a rota interna", chamadas[1].url, "/api/fechamento/xlsx");
igual(
  "D3. o corpo é o mesmo nos dois (recorte e assinatura; nenhum valor, nenhum modelo)",
  chamadas.map((c) => Object.keys(c.corpo).sort()),
  [
    ["assinatura", "cliente", "fim", "inicio"],
    ["assinatura", "cliente", "fim", "inicio"],
  ],
);
igual("D4. rotas conhecidas", ROTA_DO_XLSX, {
  interno: "/api/fechamento/xlsx",
  cliente: "/api/fechamento/xlsx-cliente",
});

// ---------------------------------------------------------------------------
console.log("\nL. Route Handler");

const rota = semComentarios(fonte("src/app/api/fechamento/xlsx-cliente/route.ts"));
const posicao = (trecho) => rota.indexOf(trecho);
verificar(
  "L1. só POST",
  /export async function POST\(/.test(rota) &&
    !/export async function (GET|PUT|PATCH|DELETE)/.test(rota),
  true,
);
verificar(
  "L2. runtime Node e sem cache",
  /runtime = "nodejs"/.test(rota) && /"Cache-Control": "no-store"/.test(rota),
  true,
);
verificar(
  "L3. decide o acesso (lerAcesso + ehAdmin) antes de qualquer leitura",
  posicao("lerAcesso()") > -1 &&
    posicao("lerAcesso()") < posicao("criarClienteServidor()") &&
    /ehAdmin\(acesso\.papeis\)/.test(rota),
  true,
);
verificar(
  "L4. disponibilidade antes do corpo e do banco",
  posicao("verificarDisponibilidade(supabase)") > -1 &&
    posicao("verificarDisponibilidade(supabase)") < posicao("extrairCorpoDoXlsx(await") &&
    posicao("extrairCorpoDoXlsx(await") < posicao("carregarFechamento(filtros"),
  true,
);
verificar(
  "L5. confere a assinatura antes de gerar",
  posicao("conferirAssinatura") > -1 &&
    posicao("conferirAssinatura") < posicao("gerarXlsxDoCliente(fechamento)"),
  true,
);
verificar(
  "L6. teto de tamanho do arquivo",
  /conferirTamanhoDoXlsx\(arquivo\.length\)/.test(rota),
  true,
);
verificar(
  "L7. nunca service_role nem cliente admin",
  /service_role|SERVICE_ROLE|criarClienteAdmin|supabase\/admin/.test(rota),
  false,
);
verificar(
  "L8. nome do arquivo com sufixo do cliente",
  /nomeDoArquivo\(fechamento\.meta, "xlsx", SUFIXO_DO_ARQUIVO_DO_CLIENTE\)/.test(rota),
  true,
);
verificar(
  "L9. o corpo é o mesmo da rota interna (extrairCorpoDoXlsx)",
  /extrairCorpoDoXlsx\(await lerCorpo\(request\)\)/.test(rota),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nU. Interface");

const exportar = fonte("src/app/(painel)/fechamento/_exportar.tsx");
verificar("U1. botão Excel do cliente", exportar.includes("Excel do cliente (.xlsx)"), true);
verificar("U2. pede o modelo cliente", /baixarExcel\("cliente"\)/.test(exportar), true);
verificar(
  "U3. o Excel interno continua",
  /baixarExcel\("interno"\)/.test(exportar) && exportar.includes("Baixar Excel (.xlsx)"),
  true,
);
verificar(
  "U4. o arquivo do cliente usa o sufixo do cliente",
  /nomeDoArquivo\(dados\.meta, "xlsx", SUFIXO_DO_ARQUIVO_DO_CLIENTE\)/.test(exportar),
  true,
);
verificar(
  "U5. nenhuma aba global nova de exportações (o botão vive no Fechamento)",
  /exporta/i.test(
    fonte("src/app/(painel)/_components/app-shell.tsx")
      .match(/href: "[^"]*"/g)
      ?.join(" ") ?? "",
  ),
  false,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
