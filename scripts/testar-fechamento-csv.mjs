/**
 * Testes do CSV do Fechamento (etapa 4.5).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-csv
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs`. Sai com código diferente de zero em qualquer
 * falha.
 *
 * Os valores esperados vêm da fixture ouro, calculada À MÃO, e das contas
 * escritas aqui em centavos. Nada é comparado com o próprio gerador do CSV.
 *
 * BLOCOS
 *
 *   C. colunas, linhas e totais do CSV por colaborador
 *   D. colunas e linhas do detalhamento diário
 *   F. formato pt-BR (decimal, sinal, data, margem)
 *   P. paridade com o FechamentoData (nenhuma divergência financeira)
 *   H. textos hostis: fórmula, aspas, separador e quebra de linha
 *   N. nome de arquivo
 *   A. forma literal: fonte única, sem dado pessoal, sem aritmética
 */

import { readFileSync } from "node:fs";

import {
  csvDoFechamento,
  nomeDoArquivo,
  sanitizarParaArquivo,
  textoDoCsv,
} from "../src/lib/fechamento/exportacao.ts";
import {
  centavosDoTexto,
  dadosDoOuro,
  dadosVazios,
  dadosHostis,
  lerCsv,
  ouro,
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

const dados = dadosDoOuro();
const csvColab = csvDoFechamento(dados, "colaborador");
const csvDiario = csvDoFechamento(dados, "diario");
const colab = lerCsv(csvColab);
/** Adicionais, ajuste faturado, ajuste previsto e receita total: o consolidado do cliente, depois do total. */
const LINHAS_DO_CONSOLIDADO = 4;
const diario = lerCsv(csvDiario);

// --- C. por colaborador -----------------------------------------------------

console.log("\nC. CSV por colaborador");

igual("C1. cabeçalho, na ordem pedida", colab[0], [
  "Colaborador",
  "Função",
  "Diárias",
  "Valor das diárias",
  "Horas extras cobradas",
  "Valor das horas extras",
  "Ajuste de arredondamento",
  "Custo previsto",
  "Já faturado",
  "A faturar",
  "Total cobrado",
  "Resultado",
  "Margem (%)",
]);

verificar(
  "C2. uma linha por colaborador, mais cabeçalho, total e as 4 linhas do consolidado do cliente",
  colab.length,
  Object.keys(ouro.esperado.colaboradores).length + 2 + LINHAS_DO_CONSOLIDADO,
);

// Total consolidado, conferido contra a fixture ouro (centavos → texto escrito à mão).
igual("C3. linha de totais consolidados", colab[colab.length - 1 - LINHAS_DO_CONSOLIDADO], [
  "Total",
  "",
  "10",
  "1000,30",
  "2,75",
  "77,34",
  "0,00",
  "792,19",
  "471,09",
  "606,55",
  "1077,64",
  "285,45",
  "26,5",
]);

const alvaro = colab.find((l) => l[0] === "Álvaro Dias");
igual("C4. colaborador sem função, só a faturar, resultado e margem negativos", alvaro, [
  "Álvaro Dias",
  "Sem função",
  "1",
  "100,00",
  "0,00",
  "0,00",
  "0,00",
  "120,00",
  "0,00",
  "100,00",
  "100,00",
  "-20,00",
  "-20,0",
]);

const ana = colab.find((l) => l[0] === "Ana Souza");
igual("C5. colaborador com extra e parte já faturada", ana, [
  "Ana Souza",
  "Auxiliar",
  "3",
  "450,00",
  "2,00",
  "56,25",
  "0,00",
  "292,66",
  "150,00",
  "356,25",
  "506,25",
  "213,59",
  "42,2",
]);

const semFaturado = Object.entries(ouro.esperado.colaboradores).find(
  ([, c]) => c.consolidado.margemPermil === null,
);
verificar("C6. a fixture tem colaborador com margem indefinida", semFaturado !== undefined, true);
verificar(
  "C7. margem indefinida sai como travessão, como na tela",
  colab.find((l) => l[0] === semFaturado?.[1].nome)?.[12],
  "—",
);

verificar("C8. separador é ponto e vírgula", csvColab.split("\r\n")[0]?.includes('";"'), true);
verificar(
  "C9. fim de linha é CRLF",
  csvColab.includes("\r\n") && !/[^\r]\n(?=")/.test(csvColab),
  true,
);
verificar(
  "C10. toda linha tem o mesmo número de colunas",
  colab.every((l) => l.length === 13),
  true,
);
verificar("C11. todo campo sai entre aspas", csvColab.split("\r\n")[1]?.startsWith('"'), true);

// --- D. detalhamento diário -------------------------------------------------

console.log("\nD. CSV do detalhamento diário");

igual("D1. cabeçalho, na ordem pedida", diario[0], [
  "Data",
  "Colaborador",
  "Função",
  "Operação",
  "Turno",
  "Status",
  "Tipo do dia",
  "Horas trabalhadas",
  "Excedente (custo)",
  "Horas extras cobradas",
  "Diária",
  "Extra",
  "Cobrado",
  "Custo previsto",
  "Situação de faturamento",
  "Situação da folha",
]);

verificar(
  "D2. uma linha por lançamento financeiro (sem as faltas), mais o cabeçalho",
  diario.length,
  ouro.esperado.ordemDosDetalhes.length + 1,
);
verificar(
  "D3. toda linha tem o mesmo número de colunas",
  diario.every((l) => l.length === 16),
  true,
);
verificar(
  "D4. não há linha de totais no detalhamento",
  diario.some((l) => l[0] === "Total"),
  false,
);

const fabio = diario.find((l) => l[0] === "07/03/2026" && l[1] === "Fábio Reis");
igual("D5. lançamento em folha aberta, sem turno, valores de centavos", fabio, [
  "07/03/2026",
  "Fábio Reis",
  "Auxiliar",
  "Operação Delta",
  "Sem turno",
  "Presente",
  "",
  "8,00",
  "0,00",
  "0,00",
  "0,10",
  "0,00",
  "0,10",
  "0,05",
  "A faturar",
  "Aberta",
]);

verificar(
  "D6. status e situações usam os rótulos do domínio",
  diario
    .slice(1)
    .every(
      (l) =>
        ["Presente", "Substituto"].includes(l[5]) &&
        ["A faturar", "Já faturado"].includes(l[14]) &&
        ["Aberta", "Fechada"].includes(l[15]),
    ),
  true,
);
verificar(
  "D7. as datas saem em dd/mm/aaaa",
  diario.slice(1).every((l) => /^\d{2}\/\d{2}\/\d{4}$/.test(l[0])),
  true,
);
verificar(
  "D8. há ao menos um substituto e um já faturado na fixture",
  diario.some((l) => l[5] === "Substituto") && diario.some((l) => l[14] === "Já faturado"),
  true,
);

// --- F. formato -------------------------------------------------------------

console.log("\nF. Formato pt-BR");

verificar("F1. centavos em decimal com vírgula", textoDoCsv("moeda", 15010), "150,10");
verificar("F2. menos de um real mantém o zero à esquerda", textoDoCsv("moeda", 5), "0,05");
verificar("F3. negativo menor que um real mantém o sinal", textoDoCsv("moeda", -5), "-0,05");
verificar("F4. sem separador de milhar", textoDoCsv("moeda", 123456789), "1234567,89");
verificar("F5. zero", textoDoCsv("moeda", 0), "0,00");
verificar("F6. horas em centésimos", textoDoCsv("horas", 275), "2,75");
verificar(
  "F7. margem em milésimos vira percentual com uma casa",
  textoDoCsv("percentual", 125),
  "12,5",
);
verificar("F8. margem negativa", textoDoCsv("percentual", -5), "-0,5");
verificar("F9. margem indefinida", textoDoCsv("percentual", null), "—");
verificar("F10. inteiro", textoDoCsv("inteiro", 10), "10");
verificar("F11. data civil", textoDoCsv("data", "2026-03-07"), "07/03/2026");
verificar(
  "F12. acentuação preservada no texto",
  textoDoCsv("texto", "Ação à vista"),
  "Ação à vista",
);
verificar(
  "F13. número negativo não é neutralizado como fórmula",
  colab.some((l) => l[11] === "-20,00"),
  true,
);

// --- K. consolidado do cliente (B8.21) --------------------------------------

console.log("\nK. Consolidado do cliente no CSV por colaborador");

{
  const consolidado = colab.slice(-LINHAS_DO_CONSOLIDADO);
  igual(
    "K1. rótulos das quatro linhas, depois do total",
    consolidado.map((l) => l[0]),
    [
      "Adicionais de serviço (consolidado do cliente, sem distribuir)",
      "Ajuste de arredondamento já faturado (consolidado do cliente)",
      "Ajuste de arredondamento previsto (consolidado do cliente; já na coluna de ajuste do Total)",
      "Receita total (consolidado do cliente)",
    ],
  );
  verificar(
    "K2. a fixture ouro não tem adicional nem ajuste: 0,00 e 0,00",
    `${consolidado[0][10]}|${consolidado[1][10]}`,
    "0,00|0,00",
  );
  igual(
    "K3. receita total com custo, já faturado, a faturar, resultado e margem do consolidado",
    consolidado[3].slice(6),
    ["", "792,19", "471,09", "606,55", "1077,64", "285,45", "26,5"],
  );
  verificar(
    "K4. nenhum colaborador recebe adicional: as linhas do consolidado não têm função nem diárias",
    consolidado.every((l) => l[1] === "" && l[2] === ""),
    true,
  );
  verificar(
    "K5. a linha por colaborador não mudou (Ana)",
    colab.find((l) => l[0] === "Ana Souza")[10],
    "506,25",
  );
}
{
  const f = dadosDoOuro();
  const comAdicional = {
    ...f,
    adicionais: [
      {
        id: "a",
        descricao: "x",
        referencia: null,
        operacaoId: null,
        inicio: "2026-03-01",
        fim: "2026-03-15",
        valorCentavos: 10000,
        faturaId: null,
      },
    ],
    financeiro: {
      ...f.financeiro,
      adicionaisCentavos: 10000,
      ajusteFaturadoCentavos: -375,
      ajustePrevistoCentavos: -125,
      ajusteCentavos: -500,
      receitaCentavos: 107764 + 10000 - 500,
      resultadoCentavos: 107764 + 10000 - 500 - 79219,
      margemPermil: 276,
      aFaturarCentavos: 70000,
      jaFaturadoCentavos: 47109,
    },
  };
  const linhas = lerCsv(csvDoFechamento(comAdicional, "colaborador"));
  const c = linhas.slice(-LINHAS_DO_CONSOLIDADO);
  verificar(
    "K6. apontamentos + adicionais: adicionais 100,00 em linha própria",
    c[0][10],
    "100,00",
  );
  verificar(
    "K7. ajuste faturado NEGATIVO sai como número puro (−3,75), sem apóstrofo",
    c[1][10],
    "-3,75",
  );
  verificar(
    "K7b. ajuste previsto em linha própria (−1,25): Total + adicionais + ajuste faturado + ajuste previsto = receita",
    `${c[2][10]}|${centavosDoTexto(linhas.at(-1 - LINHAS_DO_CONSOLIDADO)[10]) + centavosDoTexto(c[0][10]) + centavosDoTexto(c[1][10]) + centavosDoTexto(c[2][10]) === centavosDoTexto(c[3][10])}`,
    "-1,25|true",
  );
  verificar(
    "K8. receita total = apontamentos + adicionais + ajustes, vinda do financeiro (1.172,64), sem duplicar",
    c[3][10],
    "1172,64",
  );
  verificar(
    "K9. a soma por colaborador continua só de apontamentos (1.077,64): o adicional não é distribuído",
    linhas.slice(1, -1 - LINHAS_DO_CONSOLIDADO).reduce((a, l) => a + centavosDoTexto(l[10]), 0),
    107764,
  );
  verificar(
    "K10. já faturado e a faturar do consolidado vêm do financeiro (a faturar inclui adicional e ajuste)",
    `${c[3][8]}|${c[3][9]}`,
    "471,09|700,00",
  );
  verificar(
    "K11. toda linha, inclusive as do consolidado, tem 13 colunas",
    linhas.every((l) => l.length === 13),
    true,
  );
  const hostil = csvDoFechamento(
    { ...comAdicional, financeiro: { ...comAdicional.financeiro, ajusteFaturadoCentavos: -375 } },
    "colaborador",
  );
  verificar(
    "K12. as células do consolidado (rótulos fixos e números) não começam com operador de fórmula",
    lerCsv(hostil)
      .slice(-LINHAS_DO_CONSOLIDADO)
      .every((l) => l.every((x) => !/^[=+@\t\r]/.test(x) && !/^-[^0-9]/.test(x))),
    true,
  );
}
{
  const f = dadosVazios();
  const so = lerCsv(csvDoFechamento(f, "colaborador"));
  verificar(
    "K13. sem movimentação: cabeçalho, total e as 4 linhas do consolidado, tudo zerado",
    `${so.length}|${so.at(-1)[10]}|${so.at(-1)[12]}`,
    "6|0,00|—",
  );
  verificar(
    "K14. o CSV diário não ganhou linha nenhuma (só cabeçalho no vazio)",
    lerCsv(csvDoFechamento(f, "diario")).length,
    1,
  );
}

// --- P. paridade ------------------------------------------------------------

console.log("\nP. Paridade com o FechamentoData");

const somaDe = (linhas, coluna) =>
  linhas.slice(1).reduce((soma, l) => soma + centavosDoTexto(l[coluna]), 0);

verificar(
  "P1. soma do 'Cobrado' do detalhamento = faturado consolidado",
  somaDe(diario, 12),
  dados.consolidado.faturadoCentavos,
);
verificar(
  "P2. soma do 'Custo previsto' do detalhamento = custo consolidado",
  somaDe(diario, 13),
  dados.consolidado.custoCentavos,
);
verificar(
  "P3. soma de 'Diária' do detalhamento = diárias consolidadas",
  somaDe(diario, 10),
  dados.consolidado.diariaCentavos,
);
verificar(
  "P4. soma de 'Extra' do detalhamento = extras consolidados",
  somaDe(diario, 11),
  dados.consolidado.extraCentavos,
);

const linhasColab = colab.slice(1, -1 - LINHAS_DO_CONSOLIDADO);
verificar(
  "P5. soma do 'Total cobrado' por colaborador = total do CSV",
  somaDe([[], ...linhasColab], 10),
  centavosDoTexto(colab[colab.length - 1 - LINHAS_DO_CONSOLIDADO][10]),
);
verificar(
  "P6. soma do 'Custo previsto' por colaborador = total do CSV",
  somaDe([[], ...linhasColab], 7),
  centavosDoTexto(colab[colab.length - 1 - LINHAS_DO_CONSOLIDADO][7]),
);
verificar(
  "P7. já faturado + a faturar = faturado total, em toda linha",
  colab
    .slice(1, -LINHAS_DO_CONSOLIDADO)
    .every((l) => centavosDoTexto(l[8]) + centavosDoTexto(l[9]) === centavosDoTexto(l[10])),
  true,
);
verificar(
  "P8. resultado = faturado − custo, em toda linha",
  colab
    .slice(1, -LINHAS_DO_CONSOLIDADO)
    .every((l) => centavosDoTexto(l[10]) - centavosDoTexto(l[7]) === centavosDoTexto(l[11])),
  true,
);
verificar(
  "P8b. na linha de receita total: já faturado + a faturar = receita total",
  centavosDoTexto(colab.at(-1)[8]) + centavosDoTexto(colab.at(-1)[9]) ===
    centavosDoTexto(colab.at(-1)[10]),
  true,
);
verificar(
  "P9. o total confere com a fixture ouro (faturado e custo)",
  centavosDoTexto(colab[colab.length - 1 - LINHAS_DO_CONSOLIDADO][10]) ===
    ouro.esperado.consolidado.faturadoCentavos &&
    centavosDoTexto(colab[colab.length - 1 - LINHAS_DO_CONSOLIDADO][7]) ===
      ouro.esperado.consolidado.custoCentavos,
  true,
);
verificar(
  "P11. soma do 'Ajuste de arredondamento' por colaborador = ajuste previsto do Fechamento",
  somaDe([[], ...linhasColab], 6),
  dados.financeiro.ajustePrevistoCentavos,
);
verificar(
  "P12. total do 'Ajuste de arredondamento' = ajuste previsto do Fechamento",
  centavosDoTexto(colab[colab.length - 1 - LINHAS_DO_CONSOLIDADO][6]),
  dados.financeiro.ajustePrevistoCentavos,
);
verificar(
  "P10. o CSV não depende da ordem das linhas lidas",
  csvDoFechamento(
    { ...dados, detalhes: [...dados.detalhes].reverse(), colaboradores: dados.colaboradores },
    "colaborador",
  ),
  csvColab,
);

// --- H. textos hostis -------------------------------------------------------

console.log("\nH. Textos hostis");

const hostis = dadosHostis();
const hostilColab = lerCsv(csvDoFechamento(hostis, "colaborador"));
const hostilDiario = lerCsv(csvDoFechamento(hostis, "diario"));
const todosOsCampos = [...hostilColab, ...hostilDiario].flat();

const PERIGOSO = /^\s*[=+\-@]|^[\t\r\n]/;
const NUMERO = /^[+-]?\d+(?:[.,]\d+)?$/;

verificar(
  "H1. nenhum campo do CSV começa como fórmula (exceto número puro)",
  todosOsCampos.every((c) => !PERIGOSO.test(c) || NUMERO.test(c)),
  true,
);

for (const [i, texto] of TEXTOS_HOSTIS.entries()) {
  const perigoso = PERIGOSO.test(texto) && !NUMERO.test(texto);
  if (!perigoso) continue;
  verificar(
    `H2.${i}. ${JSON.stringify(texto).slice(0, 34)} sai neutralizado e íntegro`,
    todosOsCampos.includes(`'${texto}`),
    true,
  );
}

verificar(
  "H3. o texto original nunca aparece sem a neutralização",
  TEXTOS_HOSTIS.filter((t) => PERIGOSO.test(t) && !NUMERO.test(t)).every(
    (t) => !todosOsCampos.includes(t),
  ),
  true,
);
verificar(
  "H4. ponto e vírgula, aspas e quebra de linha ficam dentro de uma única célula",
  todosOsCampos.includes(TEXTOS_HOSTIS[9]) || todosOsCampos.includes(`'${TEXTOS_HOSTIS[9]}`),
  true,
);
verificar(
  "H5. o conteúdo com marcação HTML não é alterado nem escapado no CSV",
  todosOsCampos.includes(TEXTOS_HOSTIS[8]),
  true,
);
verificar(
  "H6. todas as linhas continuam com o mesmo número de colunas",
  hostilColab.every((l) => l.length === 13) && hostilDiario.every((l) => l.length === 16),
  true,
);
verificar(
  "H7. o total de linhas não mudou com os textos hostis",
  hostilDiario.length === diario.length,
  true,
);
verificar(
  "H8. os números continuam números (sem apóstrofo em coluna monetária)",
  hostilColab.slice(1).every((l) => !l[3].startsWith("'") && !l[10].startsWith("'")),
  true,
);

// --- N. nome de arquivo -----------------------------------------------------

console.log("\nN. Nome de arquivo");

const meta = { clienteNome: "Cliente Ação/Ltda ../x", inicio: "2026-03-01", fim: "2026-03-15" };
verificar(
  "N1. acento, espaço e barra viram hífen",
  nomeDoArquivo(meta, "xlsx"),
  "fechamento-cliente-acao-ltda-x-2026-03-01-2026-03-15.xlsx",
);
verificar(
  "N2. sufixo do formato de CSV",
  nomeDoArquivo(meta, "csv", "por-colaborador"),
  "fechamento-cliente-acao-ltda-x-2026-03-01-2026-03-15-por-colaborador.csv",
);
verificar("N3. nome vazio cai no padrão", sanitizarParaArquivo("   ///   "), "cliente");
verificar("N4. controles e CRLF são descartados", sanitizarParaArquivo("A\r\nB\u0000C"), "a-b-c");
verificar(
  "N5. o nome do cliente é limitado",
  sanitizarParaArquivo("x".repeat(200)).length <= 40,
  true,
);
verificar(
  "N6. nenhum nome produzido contém separador de caminho, ponto duplo ou aspas",
  TEXTOS_HOSTIS.every((t) => /^[a-z0-9-]+$/.test(sanitizarParaArquivo(t))),
  true,
);
verificar(
  "N7. letras maiúsculas e unicode viram minúsculas ASCII",
  sanitizarParaArquivo("ÇÃO Ñ"),
  "cao-n",
);

// --- A. forma literal -------------------------------------------------------

console.log("\nA. Forma do código");

const exportacao = fonte("src/lib/fechamento/exportacao.ts");
const codigoDeExportacao = exportacao.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

verificar(
  "A1. o CSV reutiliza montarCsv de src/lib/csv.ts",
  /from "\.\.\/csv"/.test(exportacao) && /montarCsv\(/.test(exportacao),
  true,
);
verificar(
  "A2. a neutralização não é reimplementada na exportação",
  !/INICIO_PERIGOSO|precisaNeutralizar|replace\(\/\^\[=/.test(codigoDeExportacao),
  true,
);
verificar(
  "A3. a exportação não tem ponto flutuante de dinheiro",
  !/toFixed|parseFloat|Number\(|\* 0\.|\/ 100\b/.test(codigoDeExportacao),
  true,
);
verificar(
  "A4. o modelo tabular não importa servidor, Supabase nem a biblioteca de planilha",
  !/node:|supabase|write-excel-file|server-only/i.test(codigoDeExportacao),
  true,
);
verificar(
  "A5. não exporta CPF, documento nem identificador interno",
  !/cpf|documento|entryId|employeeId|operationId|clienteId/i.test(
    codigoDeExportacao.replace(/clienteNome/g, ""),
  ),
  true,
);
verificar(
  "A6. o CSV gerado não contém nenhum id da fixture",
  ouro.linhas.every(
    (l) =>
      !csvColab.includes(l.id) &&
      !csvDiario.includes(l.id) &&
      !csvDiario.includes(l.employee_id) &&
      !csvDiario.includes(l.timesheets.operation_id),
  ),
  true,
);
verificar(
  "A7. 'pago' não aparece como rótulo (custo previsto não é pagamento)",
  !/\bpago\b/i.test(csvColab + csvDiario),
  true,
);

const csvBase = fonte("src/lib/csv.ts");
verificar(
  "A8. a neutralização cobre operador depois de espaço e quebra de linha",
  /INICIO_PERIGOSO = \/\^\\s\*\[=\+\\-@\]\|\^\[\\t\\r\\n\]\//.test(csvBase),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
