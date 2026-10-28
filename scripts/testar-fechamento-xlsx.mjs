/**
 * Testes do XLSX, do endpoint e do download do Fechamento (etapa 4.5).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-xlsx
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs`. Sai com código diferente de zero em qualquer
 * falha.
 *
 * O arquivo é gerado DE VERDADE e aberto como ZIP (`_zip.mjs`): as asserções
 * olham o XML interno, não uma chamada de função.
 *
 * BLOCOS
 *
 *   X. estrutura: abas, ordem, nomes, partes do arquivo
 *   R. aba Resumo
 *   T. abas tabulares: cabeçalho, dados, totais
 *   Y. tipos e formatos: número, data, moeda, percentual, horas
 *   F. congelamento, autofiltro, larguras
 *   H. textos hostis: nenhuma fórmula executável
 *   V. fixture vazia e margem indefinida
 *   E. decisões do endpoint (corpo, assinatura, 409, tamanho, cabeçalhos)
 *   L. forma literal do Route Handler
 *   D. cliente HTTP do download
 *   U. interface
 *   B. dependência
 *
 * O Route Handler em si precisa do Next e de sessão; o que ele DECIDE mora em
 * `src/lib/fechamento/http.ts`, exercitado aqui por comportamento. O handler é
 * conferido por forma literal, como as demais rotas do projeto. O download real,
 * com sessão e AAL2, é verificação da etapa de E2E.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ErroDaApiDoFechamento } from "../src/lib/fechamento/buscar.ts";
import { baixarXlsx, mensagemDoDownload, pedeAtualizacao } from "../src/lib/fechamento/download.ts";
import { ErroDeFiltroDoFechamento } from "../src/lib/fechamento/erros.ts";
import { nomeDoArquivo } from "../src/lib/fechamento/exportacao.ts";
import {
  cabecalhosDeDownload,
  conferirAssinatura,
  conferirTamanhoDoXlsx,
  decidirAcesso,
  descreverErro,
  extrairCorpoDoXlsx,
  lerCorpoComLimite,
  MENSAGEM_ASSINATURA_DIVERGENTE,
  TETO_DO_CORPO_DO_XLSX_EM_BYTES,
  TETO_DO_XLSX_EM_BYTES,
} from "../src/lib/fechamento/http.ts";
import {
  gerarXlsxDoFechamento,
  recursoDeAutofiltro,
  TIPO_DO_XLSX,
} from "../src/lib/fechamento/xlsx.ts";
import { lerZip } from "./_zip.mjs";
import {
  dadosDoOuro,
  dadosHostis,
  dadosVazios,
  desescapar,
  lerEstilos,
  lerPlanilha,
  lerStringsCompartilhadas,
  letra,
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

function erroDe(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

/** Abre o arquivo gerado e entrega tudo que as asserções precisam. */
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

const dados = dadosDoOuro();
const buffer = await gerarXlsxDoFechamento(dados);
const xlsx = abrir(buffer);

const nColab = dados.colaboradores.length;
const nDetalhe = dados.detalhes.length;

// --- X. estrutura -----------------------------------------------------------

console.log("\nX. Estrutura do arquivo");

verificar("X1. é um ZIP (assinatura PK)", buffer.subarray(0, 2).toString("latin1"), "PK");
verificar("X2. é um Buffer com conteúdo", Buffer.isBuffer(buffer) && buffer.length > 1000, true);

const abas = [...xlsx.workbook.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) =>
  desescapar(m[1]),
);
igual("X3. exatamente três abas, na ordem pedida", abas, [
  "Resumo",
  "Por colaborador",
  "Detalhamento diário",
]);
verificar(
  "X4. há uma parte de planilha por aba",
  ["sheet1", "sheet2", "sheet3"].every((s) => xlsx.zip.has(`xl/worksheets/${s}.xml`)),
  true,
);
verificar(
  "X5. nenhuma outra planilha, macro, imagem ou vínculo externo",
  [...xlsx.zip.keys()].every(
    (k) => !/vbaProject|externalLinks|media\/|drawings\/|embeddings/.test(k),
  ),
  true,
);
verificar(
  "X6. o tipo MIME do XLSX é o oficial",
  TIPO_DO_XLSX,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
);

// --- R. resumo --------------------------------------------------------------

console.log("\nR. Aba Resumo");

const resumo = xlsx.planilha(1);
const textoDe = (celulas, ref) => celulas.get(ref)?.texto ?? null;
const numeroDe = (celulas, ref) => {
  const c = celulas.get(ref);
  return c && c.tipo === "n" ? Number(c.bruto) : null;
};

verificar("R1. título", textoDe(resumo.celulas, "A1"), "Fechamento");
verificar("R2. cliente", textoDe(resumo.celulas, "A3"), "Cliente");
verificar("R3. nome do cliente", textoDe(resumo.celulas, "B3"), "Cliente Ouro");
verificar("R4. período", textoDe(resumo.celulas, "A4"), "Período");
verificar("R5. período em dd/mm/aaaa", textoDe(resumo.celulas, "B4"), "01/03/2026 a 15/03/2026");
verificar("R6. data de geração", textoDe(resumo.celulas, "A5"), "Gerado em");
verificar(
  "R7. data de geração no fuso do Brasil",
  textoDe(resumo.celulas, "B5"),
  "16/03/2026, 09:00",
);

const ROTULOS = [
  ["A7", "Quantidade de diárias", 10, "0"],
  ["A8", "Horas extras cobradas", 2.75, "0.00"],
  ["A9", "Excedente do custo (horas)", 2.75, "0.00"],
  ["A10", "Apontamentos", 1077.64, '"R$" #,##0.00'],
  ["A11", "Adicionais de serviço", 0, '"R$" #,##0.00'],
  ["A12", "Ajuste de arredondamento já faturado", 0, '"R$" #,##0.00'],
  ["A13", "Ajuste de arredondamento previsto", 0, '"R$" #,##0.00'],
  ["A14", "Receita total", 1077.64, '"R$" #,##0.00'],
  ["A15", "Custo previsto / Valor devido", 792.19, '"R$" #,##0.00'],
  ["A16", "Já faturado", 471.09, '"R$" #,##0.00'],
  ["A17", "A faturar", 606.55, '"R$" #,##0.00'],
  ["A18", "Resultado", 285.45, '"R$" #,##0.00'],
  ["A19", "Margem", 0.265, "0.0%"],
];
for (const [ref, rotulo, valor, formato] of ROTULOS) {
  const celula = ref.replace("A", "B");
  verificar(`R8. rótulo ${rotulo}`, textoDe(resumo.celulas, ref), rotulo);
  verificar(`R9. ${rotulo}: valor numérico`, numeroDe(resumo.celulas, celula), valor);
  verificar(`R10. ${rotulo}: formato`, xlsx.formato(resumo.celulas.get(celula)?.estilo), formato);
}
verificar(
  "R11. o aviso diz que os valores são previstos",
  /previstos/.test(textoDe(resumo.celulas, "A28") ?? ""),
  true,
);
verificar(
  "R12. o aviso não afirma pagamento realizado",
  /Não representam pagamento realizado/.test(textoDe(resumo.celulas, "A28") ?? ""),
  true,
);
verificar(
  "R13. nenhum rótulo diz 'pago' ou 'valor pago'",
  !xlsx.strings.some((s) => /\bpago\b/i.test(s)),
  true,
);
verificar(
  "R14. o resumo não é congelado nem filtrado",
  !/<pane/.test(resumo.xml) && !/<autoFilter/.test(resumo.xml),
  true,
);

const CONFERENCIAS = [
  "Apontamentos",
  "Adicionais de serviço",
  "Ajuste de arredondamento já faturado",
  "Ajuste de arredondamento previsto",
  "A faturar (sem o ajuste previsto)",
  "Já faturado",
];
CONFERENCIAS.forEach((nome, i) => {
  const linha = 21 + i;
  verificar(
    `R15. rótulo da conferência — ${nome}`,
    textoDe(resumo.celulas, `A${linha}`),
    `Conferência com o banco — ${nome}`,
  );
  verificar(`R16. conferência — ${nome}: confere`, textoDe(resumo.celulas, `B${linha}`), "Confere");
});

// --- T. abas tabulares ------------------------------------------------------

console.log("\nT. Abas tabulares");

const colab = xlsx.planilha(2);
const diario = xlsx.planilha(3);

igual(
  "T1. cabeçalho da aba Por colaborador",
  Array.from({ length: 13 }, (_, i) => textoDe(colab.celulas, `${letra(i)}1`)),
  [
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
    "Margem",
  ],
);
igual(
  "T2. cabeçalho da aba Detalhamento diário",
  Array.from({ length: 16 }, (_, i) => textoDe(diario.celulas, `${letra(i)}1`)),
  [
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
  ],
);

verificar(
  "T3. primeiro colaborador (ordem do domínio)",
  textoDe(colab.celulas, "A2"),
  "Álvaro Dias",
);
verificar("T4. função padrão", textoDe(colab.celulas, "B2"), "Sem função");
verificar("T5. diárias", numeroDe(colab.celulas, "C2"), 1);
verificar("T6. valor das diárias", numeroDe(colab.celulas, "D2"), 100);
verificar("T7. custo previsto", numeroDe(colab.celulas, "H2"), 120);
verificar("T8. resultado negativo preservado como número", numeroDe(colab.celulas, "L2"), -20);
verificar("T9. margem negativa como fração", numeroDe(colab.celulas, "M2"), -0.2);

const linhaTotal = 1 + nColab + 2; // cabeçalho + dados + linha em branco + total
verificar("T10. rótulo da linha de totais", textoDe(colab.celulas, `A${linhaTotal}`), "Total");
verificar("T11. total de diárias", numeroDe(colab.celulas, `C${linhaTotal}`), 10);
verificar("T12. total do valor das diárias", numeroDe(colab.celulas, `D${linhaTotal}`), 1000.3);
verificar("T13. total de horas extras", numeroDe(colab.celulas, `E${linhaTotal}`), 2.75);
verificar("T13b. total do ajuste de arredondamento", numeroDe(colab.celulas, `G${linhaTotal}`), 0);
verificar("T14. total do custo previsto", numeroDe(colab.celulas, `H${linhaTotal}`), 792.19);
verificar("T15. total já faturado", numeroDe(colab.celulas, `I${linhaTotal}`), 471.09);
verificar("T16. total a faturar", numeroDe(colab.celulas, `J${linhaTotal}`), 606.55);
verificar("T17. total faturado", numeroDe(colab.celulas, `K${linhaTotal}`), 1077.64);
verificar("T18. total do resultado", numeroDe(colab.celulas, `L${linhaTotal}`), 285.45);
verificar("T19. margem total", numeroDe(colab.celulas, `M${linhaTotal}`), 0.265);
verificar(
  "T20. a linha em branco separa os dados do total",
  colab.celulas.get(`A${linhaTotal - 1}`) === undefined,
  true,
);
verificar(
  "T21. os totais são valores, não fórmulas do Excel",
  [...colab.celulas.values()].every((c) => !c.formula),
  true,
);
verificar(
  "T22. o total do 'Faturado total' é a soma dos colaboradores (em centavos)",
  Array.from({ length: nColab }, (_, i) => numeroDe(colab.celulas, `K${i + 2}`)).reduce(
    (soma, v) => soma + Math.round(v * 100),
    0,
  ),
  ouro.esperado.consolidado.faturadoCentavos,
);

verificar("T23. há uma linha por lançamento", diario.celulas.has(`A${nDetalhe + 1}`), true);
verificar("T24. e nenhuma a mais", diario.celulas.has(`A${nDetalhe + 2}`), false);
verificar(
  "T25. o detalhamento não tem linha de totais",
  [...diario.celulas.values()].every((c) => c.texto !== "Total"),
  true,
);

let somaFaturado = 0;
let somaCusto = 0;
for (let linha = 2; linha <= nDetalhe + 1; linha++) {
  somaFaturado += Math.round(numeroDe(diario.celulas, `M${linha}`) * 100);
  somaCusto += Math.round(numeroDe(diario.celulas, `N${linha}`) * 100);
}
verificar(
  "T26. soma do faturado no detalhamento = faturado consolidado",
  somaFaturado,
  dados.consolidado.faturadoCentavos,
);
verificar(
  "T27. soma do custo no detalhamento = custo consolidado",
  somaCusto,
  dados.consolidado.custoCentavos,
);

const celulasDoDetalhe = [...diario.celulas.entries()].filter(([ref]) => /^[A-Z]+(\d+)$/.test(ref));
const linhaDoFabio = [...Array(nDetalhe).keys()]
  .map((i) => i + 2)
  .find(
    (l) =>
      textoDe(diario.celulas, `B${l}`) === "Fábio Reis" &&
      numeroDe(diario.celulas, `A${l}`) === serialDoExcel("2026-03-07"),
  );
verificar("T28. lançamento do Fábio encontrado pela data", linhaDoFabio !== undefined, true);
verificar("T29. operação", textoDe(diario.celulas, `D${linhaDoFabio}`), "Operação Delta");
verificar("T30. turno padrão", textoDe(diario.celulas, `E${linhaDoFabio}`), "Sem turno");
verificar("T31. status", textoDe(diario.celulas, `F${linhaDoFabio}`), "Presente");
verificar("T32. horas trabalhadas", numeroDe(diario.celulas, `H${linhaDoFabio}`), 8);
verificar("T33. situação de faturamento", textoDe(diario.celulas, `O${linhaDoFabio}`), "A faturar");
verificar("T34. situação da folha", textoDe(diario.celulas, `P${linhaDoFabio}`), "Aberta");
verificar("T35. há células no detalhamento", celulasDoDetalhe.length > nDetalhe, true);

// --- Y. tipos e formatos ----------------------------------------------------

console.log("\nY. Tipos e formatos");

const MOEDA = '"R$" #,##0.00';
verificar(
  "Y1. data é número de série",
  numeroDe(diario.celulas, `A${linhaDoFabio}`),
  serialDoExcel("2026-03-07"),
);
verificar(
  "Y2. data é inteira (sem deslocamento de fuso)",
  Number.isInteger(numeroDe(diario.celulas, `A${linhaDoFabio}`)),
  true,
);
verificar(
  "Y3. formato visual da data",
  xlsx.formato(diario.celulas.get(`A${linhaDoFabio}`)?.estilo),
  "dd/mm/yyyy",
);
verificar(
  "Y4. moeda: formato R$",
  xlsx.formato(diario.celulas.get(`K${linhaDoFabio}`)?.estilo),
  MOEDA,
);
verificar("Y5. moeda é número, não texto", diario.celulas.get(`K${linhaDoFabio}`)?.tipo, "n");
verificar(
  "Y6. horas: duas casas",
  xlsx.formato(diario.celulas.get(`H${linhaDoFabio}`)?.estilo),
  "0.00",
);
verificar("Y7. horas é número", diario.celulas.get(`H${linhaDoFabio}`)?.tipo, "n");
verificar("Y8. diárias: inteiro", xlsx.formato(colab.celulas.get("C2")?.estilo), "0");
verificar("Y9. margem: percentual", xlsx.formato(colab.celulas.get("M2")?.estilo), "0.0%");
verificar("Y10. margem é fração numérica", numeroDe(colab.celulas, "M2"), -0.2);
verificar("Y11. texto tem formato de texto", xlsx.formato(colab.celulas.get("A2")?.estilo), "@");
verificar(
  "Y12. toda célula de valor das colunas monetárias é número",
  Array.from({ length: nColab }, (_, i) => colab.celulas.get(`D${i + 2}`)?.tipo).every(
    (t) => t === "n",
  ),
  true,
);
verificar(
  "Y13. nenhuma célula numérica foi gravada como string compartilhada",
  Array.from({ length: nDetalhe }, (_, i) => diario.celulas.get(`K${i + 2}`)?.tipo).every(
    (t) => t === "n",
  ),
  true,
);
verificar(
  "Y14. o total usa o mesmo formato monetário, com destaque",
  xlsx.formato(colab.celulas.get(`J${linhaTotal}`)?.estilo),
  MOEDA,
);

const fontes = [...xlsx.zip.get("xl/styles.xml").matchAll(/<font>(.*?)<\/font>/gs)].map(
  (m) => m[1],
);
verificar(
  "Y15. há fonte em negrito (cabeçalho e total)",
  fontes.some((f) => /<b\/>/.test(f)),
  true,
);
verificar(
  "Y16. há preenchimento de fundo para o cabeçalho e o total",
  (xlsx.zip.get("xl/styles.xml").match(/patternType="solid"/g) ?? []).length >= 2,
  true,
);
verificar(
  "Y17. o estilo do cabeçalho difere do estilo de uma célula de dados",
  colab.celulas.get("A1")?.estilo !== colab.celulas.get("A2")?.estilo,
  true,
);
verificar(
  "Y18. o estilo do total difere do de uma célula de dados do mesmo tipo",
  colab.celulas.get(`J${linhaTotal}`)?.estilo !== colab.celulas.get("J2")?.estilo,
  true,
);

// --- F. congelamento, filtro, larguras --------------------------------------

console.log("\nF. Congelamento, autofiltro e larguras");

for (const [nome, aba, ultima, linhas] of [
  ["Por colaborador", colab, "M", nColab],
  ["Detalhamento diário", diario, "P", nDetalhe],
]) {
  verificar(
    `F1. ${nome}: primeira linha congelada`,
    /<pane\s[^>]*ySplit="1"[^>]*state="frozen"/.test(aba.xml),
    true,
  );
  verificar(`F2. ${nome}: nenhuma coluna congelada`, /<pane\s[^>]*xSplit="0"/.test(aba.xml), true);
  verificar(
    `F3. ${nome}: autofiltro cobre o cabeçalho e os dados`,
    aba.xml.includes(`<autoFilter ref="A1:${ultima}${linhas + 1}"/>`),
    true,
  );
  verificar(`F4. ${nome}: um único autofiltro`, (aba.xml.match(/<autoFilter/g) ?? []).length, 1);
  verificar(
    `F5. ${nome}: autofiltro vem depois de sheetData`,
    aba.xml.indexOf("</sheetData>") < aba.xml.indexOf("<autoFilter"),
    true,
  );
  verificar(
    `F6. ${nome}: larguras de coluna definidas`,
    (aba.xml.match(/<col\s[^>]*customWidth="1"/g) ?? []).length,
    ultima.charCodeAt(0) - 64,
  );
}

verificar(
  "F7. o total fica fora do intervalo filtrado",
  colab.xml.includes('<autoFilter ref="A1:M8"/>') && linhaTotal > nColab + 1,
  true,
);
verificar(
  "F8. nome definido oculto do filtro, por aba",
  xlsx.workbook.includes(
    `<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'Por colaborador'!$A$1:$M$${nColab + 1}</definedName>`,
  ) &&
    xlsx.workbook.includes(
      `<definedName name="_xlnm._FilterDatabase" localSheetId="2" hidden="1">'Detalhamento diário'!$A$1:$P$${nDetalhe + 1}</definedName>`,
    ),
  true,
);
verificar("F9. o resumo não ganha nome definido", !/localSheetId="0"/.test(xlsx.workbook), true);
verificar(
  "F10. as larguras seguem o modelo (primeira coluna do detalhamento)",
  /<col min="1" max="1" width="12"/.test(diario.xml),
  true,
);

const feature = recursoDeAutofiltro(new Map([[1, { nome: "X", ref: "A1:B2" }]]));
verificar(
  "F11. o autofiltro falha alto se o workbook não tiver definedNames",
  erroDe(() =>
    feature.files.transform["xl/workbook.xml"].transform("<workbook></workbook>", [], {}),
  ) instanceof Error,
  true,
);
verificar(
  "F12. o autofiltro não mexe em aba sem filtro",
  feature.files.transform["xl/worksheets/sheet{id}.xml"].transform(
    "<worksheet/>",
    {},
    { sheetIndex: 0, sheetId: "1" },
  ),
  "<worksheet/>",
);

// --- H. textos hostis -------------------------------------------------------

console.log("\nH. Textos hostis e fórmulas");

const hostil = abrir(await gerarXlsxDoFechamento(dadosHostis()));
const planilhasHostis = [1, 2, 3].map((n) => hostil.planilha(n));
const todasAsPartes = [...hostil.zip.values()].join("\n");

verificar(
  "H1. nenhum elemento <f> em nenhuma parte do arquivo",
  !/<f[\s>\/]/.test(todasAsPartes),
  true,
);
verificar(
  "H2. nenhuma célula marcada como fórmula",
  planilhasHostis.every((p) => [...p.celulas.values()].every((c) => !c.formula)),
  true,
);
verificar('H3. nenhum tipo de célula de fórmula (t="str")', !/\bt="str"/.test(todasAsPartes), true);
verificar("H4. nenhum calcChain", !hostil.zip.has("xl/calcChain.xml"), true);

for (const [i, texto] of TEXTOS_HOSTIS.entries()) {
  verificar(
    `H5.${i}. ${JSON.stringify(texto).slice(0, 30)} gravado como texto, sem alteração`,
    hostil.strings.includes(texto),
    true,
  );
}
verificar(
  "H6. sem apóstrofo visual: o tipo texto basta",
  TEXTOS_HOSTIS.every((t) => !hostil.strings.includes(`'${t}`)),
  true,
);
verificar(
  "H7. toda célula que contém texto hostil é string compartilhada",
  planilhasHostis.every((p) =>
    [...p.celulas.values()]
      .filter((c) => c.tipo === "s" && /^\s*[=+\-@]/.test(c.texto ?? ""))
      .every((c) => c.tipo === "s" && !c.formula),
  ),
  true,
);
verificar(
  "H8. a marcação HTML foi escapada no XML",
  !/<script>/.test(hostil.zip.get("xl/sharedStrings.xml")),
  true,
);
verificar(
  "H9. o texto escapado volta idêntico ao ler",
  hostil.strings.includes(TEXTOS_HOSTIS[8]),
  true,
);
verificar(
  "H10. as colunas de texto hostil têm formato de texto",
  [...planilhasHostis[1].celulas.values()]
    .filter((c) => c.tipo === "s" && /^[=+@-]/.test(c.texto ?? ""))
    .every((c) => hostil.formato(c.estilo) === "@"),
  true,
);
verificar(
  "H11. o acento sobrevive: nomes e abas",
  xlsx.strings.includes("Álvaro Dias") &&
    xlsx.strings.includes("Função") &&
    xlsx.strings.includes("Situação de faturamento") &&
    xlsx.workbook.includes("Detalhamento diário"),
  true,
);

// --- V. vazio e margem indefinida -------------------------------------------

console.log("\nV. Casos limite");

const vazio = abrir(await gerarXlsxDoFechamento(dadosVazios()));
verificar(
  "V1. fechamento vazio ainda gera três abas",
  [...vazio.workbook.matchAll(/<sheet\s/g)].length,
  3,
);
verificar(
  "V2. autofiltro só do cabeçalho (colaboradores)",
  vazio.planilha(2).xml.includes('<autoFilter ref="A1:M1"/>'),
  true,
);
verificar(
  "V3. autofiltro só do cabeçalho (detalhamento)",
  vazio.planilha(3).xml.includes('<autoFilter ref="A1:P1"/>'),
  true,
);
verificar(
  "V4. o total de um fechamento vazio é zero",
  numeroDe(vazio.planilha(2).celulas, "K3"),
  0,
);
verificar(
  "V5. a margem indefinida do total fica vazia, não zero",
  vazio.planilha(2).celulas.get("M3")?.tipo,
  "vazia",
);
const semValor = (celula) => celula === undefined || celula.tipo === "vazia";
verificar(
  "V6. o resumo não grava margem quando não há faturado",
  semValor(vazio.planilha(1).celulas.get("B19")),
  true,
);

const semFaturado = Object.entries(ouro.esperado.colaboradores).find(
  ([, c]) => c.consolidado.margemPermil === null,
);
const linhaSemFaturado = dados.colaboradores.findIndex((c) => c.nome === semFaturado[1].nome) + 2;
verificar(
  "V7. colaborador sem faturado: margem sem valor (não zero)",
  semValor(colab.celulas.get(`M${linhaSemFaturado}`)),
  true,
);

// --- E. decisões do endpoint ------------------------------------------------

console.log("\nE. Endpoint: decisões");

const ASSINATURA = "a".repeat(64);
const corpoValido = {
  cliente: "11111111-1111-4111-8111-111111111111",
  inicio: "2026-03-01",
  fim: "2026-03-15",
  assinatura: ASSINATURA,
};

igual("E1. corpo válido", extrairCorpoDoXlsx(corpoValido), {
  clienteId: corpoValido.cliente,
  inicio: "2026-03-01",
  fim: "2026-03-15",
  assinatura: ASSINATURA,
});
verificar(
  "E2. assinatura em maiúsculas é normalizada",
  extrairCorpoDoXlsx({ ...corpoValido, assinatura: ASSINATURA.toUpperCase() }).assinatura,
  ASSINATURA,
);

const recusa = (corpo) =>
  erroDe(() => extrairCorpoDoXlsx(corpo)) instanceof ErroDeFiltroDoFechamento;
verificar("E3. campo desconhecido é recusado", recusa({ ...corpoValido, faturado: 1 }), true);
verificar(
  "E4. valor financeiro no corpo é recusado",
  recusa({ ...corpoValido, billed_amount: "9" }),
  true,
);
verificar(
  "E5. campo ausente é recusado",
  recusa({ cliente: corpoValido.cliente, inicio: "2026-03-01", fim: "2026-03-15" }),
  true,
);
verificar(
  "E6. campo que não é texto é recusado",
  recusa({ ...corpoValido, inicio: 20260301 }),
  true,
);
verificar("E7. campo vazio é recusado", recusa({ ...corpoValido, fim: "" }), true);
verificar("E8. array é recusado", recusa([corpoValido]), true);
verificar("E9. null é recusado", recusa(null), true);
verificar("E10. texto solto é recusado", recusa("abc"), true);
verificar("E11. assinatura curta é recusada", recusa({ ...corpoValido, assinatura: "abc" }), true);
verificar(
  "E12. assinatura fora de hexadecimal é recusada",
  recusa({ ...corpoValido, assinatura: "z".repeat(64) }),
  true,
);
verificar(
  "E13. o erro de corpo vira 400",
  descreverErro(erroDe(() => extrairCorpoDoXlsx(null))).status,
  400,
);

verificar("E14. assinatura igual libera", conferirAssinatura(ASSINATURA, ASSINATURA), null);
const divergente = conferirAssinatura(ASSINATURA, "b".repeat(64));
verificar("E15. assinatura diferente = 409", divergente?.status, 409);
verificar("E16. código estável", divergente?.corpo.erro.codigo, "assinatura-divergente");
verificar(
  "E17. mensagem amigável exata",
  divergente?.corpo.erro.mensagem,
  "Os dados do fechamento foram alterados. Atualize o fechamento antes de baixar.",
);
verificar(
  "E18. a constante exportada é a mesma mensagem",
  MENSAGEM_ASSINATURA_DIVERGENTE,
  divergente?.corpo.erro.mensagem,
);
verificar(
  "E19. a resposta 409 não cita assinatura, SQL, stack nem id",
  !/[0-9a-f]{64}|select|stack|at \w+ \(/i.test(JSON.stringify(divergente)),
  true,
);

verificar("E20. arquivo no teto passa", conferirTamanhoDoXlsx(TETO_DO_XLSX_EM_BYTES), null);
verificar(
  "E21. arquivo acima do teto = 413",
  conferirTamanhoDoXlsx(TETO_DO_XLSX_EM_BYTES + 1)?.status,
  413,
);
verificar(
  "E22. o teto fica abaixo do limite de 4,5 MB da Vercel",
  TETO_DO_XLSX_EM_BYTES < 4.5 * 1024 * 1024,
  true,
);

const nome = nomeDoArquivo(dados.meta, "xlsx");
const cab = cabecalhosDeDownload(nome, TIPO_DO_XLSX);
verificar("E23. Content-Type do XLSX", cab["Content-Type"], TIPO_DO_XLSX);
verificar(
  "E24. Content-Disposition é attachment",
  cab["Content-Disposition"].startsWith("attachment;"),
  true,
);
verificar(
  "E25. filename presente",
  cab["Content-Disposition"].includes(`filename="${nome}"`),
  true,
);
verificar(
  "E26. filename* presente",
  cab["Content-Disposition"].includes(`filename*=UTF-8''${nome}`),
  true,
);
verificar("E27. Cache-Control: no-store", cab["Cache-Control"], "no-store");
verificar(
  "E28. nome do arquivo conceitual",
  nome,
  "fechamento-cliente-ouro-2026-03-01-2026-03-15.xlsx",
);

const injecao = cabecalhosDeDownload('x"; filename="y\r\nSet-Cookie: a=b.xlsx', TIPO_DO_XLSX);
verificar(
  "E29. nome hostil não injeta cabeçalho nem aspas",
  !/[\r\n]/.test(injecao["Content-Disposition"]) &&
    (injecao["Content-Disposition"].match(/"/g) ?? []).length === 2,
  true,
);

verificar("E30. sem sessão = 401", decidirAcesso("sem-sessao", false)?.status, 401);
verificar("E31. operacional = 403", decidirAcesso("liberado", false)?.status, 403);
verificar("E32. admin sem segundo fator = 403", decidirAcesso("mfa-pendente", true)?.status, 403);
verificar("E33. admin liberado (AAL2) passa", decidirAcesso("liberado", true), null);

// --- Q. Limite do corpo do POST ---------------------------------------------

console.log("\nQ. Limite do corpo: leitura incremental");

{
  const TETO = TETO_DO_CORPO_DO_XLSX_EM_BYTES;

  /** Corpo em pedaços que CONTA o que foi puxado e se foi cancelado. */
  function corpoEmPedacos(pedaco, quantidade) {
    const estado = { puxados: 0, cancelado: false };
    const stream = new ReadableStream({
      pull(controle) {
        if (estado.puxados >= quantidade * pedaco) return controle.close();
        estado.puxados += pedaco;
        controle.enqueue(new Uint8Array(pedaco).fill(97));
      },
      cancel() {
        estado.cancelado = true;
      },
    });
    return { stream, estado };
  }
  const requisicao = (body, cabecalhos = {}) =>
    new Request("http://local.invalid/api/fechamento/xlsx", {
      method: "POST",
      body,
      headers: cabecalhos,
      duplex: "half",
    });
  const recusa = async (req) => {
    try {
      await lerCorpoComLimite(req, TETO);
      return null;
    } catch (erro) {
      return erro;
    }
  };

  verificar("Q1. o teto do corpo é de 1 KB", TETO, 1024);
  verificar(
    "Q2. corpo pequeno é lido por inteiro",
    await lerCorpoComLimite(requisicao('{"a":"é"}'), TETO),
    '{"a":"é"}',
  );
  verificar(
    "Q3. corpo exatamente no teto passa",
    (await lerCorpoComLimite(requisicao("a".repeat(TETO)), TETO)).length,
    TETO,
  );
  const acima = await recusa(requisicao("a".repeat(TETO + 1)));
  verificar(
    "Q4. um byte acima do teto é recusado",
    acima instanceof ErroDeFiltroDoFechamento,
    true,
  );
  verificar("Q5. e vira 400 (mesmo contrato do corpo inválido)", descreverErro(acima).status, 400);

  // Content-Length acima do teto: recusa sem puxar um byte do corpo.
  {
    const { stream, estado } = corpoEmPedacos(512, 1000);
    const erro = await recusa(requisicao(stream, { "content-length": "500000" }));
    verificar(
      "Q6. Content-Length acima do teto é recusado",
      erro instanceof ErroDeFiltroDoFechamento,
      true,
    );
    // O ReadableStream pré-puxa um pedaço sozinho (highWaterMark 1) ao ser criado; o que se
    // exige é que a leitura NÃO prossiga: nada além desse buffer inicial.
    verificar(
      "Q7. sem ler o corpo: no máximo o pedaço de buffer inicial",
      estado.puxados <= 512,
      true,
    );
  }

  // Sem Content-Length (pedaços): a leitura para perto do teto e cancela a origem.
  {
    const { stream, estado } = corpoEmPedacos(512, 100_000); // ~50 MB oferecidos
    const erro = await recusa(requisicao(stream));
    verificar(
      "Q8. corpo em pedaços sem Content-Length acima do teto é recusado",
      erro instanceof ErroDeFiltroDoFechamento,
      true,
    );
    verificar(
      "Q9. a leitura parou perto do teto, não leu o corpo todo",
      estado.puxados <= TETO + 3 * 512,
      true,
    );
    verificar("Q10. e a origem foi cancelada", estado.cancelado, true);
  }

  // Content-Length que MENTE (declara pouco, envia muito).
  {
    const { stream, estado } = corpoEmPedacos(512, 100_000);
    const erro = await recusa(requisicao(stream, { "content-length": "10" }));
    verificar(
      "Q11. Content-Length menor que o corpo real não engana o limite",
      erro instanceof ErroDeFiltroDoFechamento,
      true,
    );
    verificar("Q12. e a leitura também para perto do teto", estado.puxados <= TETO + 3 * 512, true);
  }

  verificar(
    "Q13. Content-Length não numérico é recusado",
    (await recusa(requisicao("{}", { "content-length": "abc" }))) instanceof
      ErroDeFiltroDoFechamento,
    true,
  );
  verificar(
    "Q14. Content-Length negativo é recusado",
    (await recusa(requisicao("{}", { "content-length": "-1" }))) instanceof
      ErroDeFiltroDoFechamento,
    true,
  );
  verificar(
    "Q15. corpo vazio devolve texto vazio (o JSON.parse de quem chama o recusa)",
    await lerCorpoComLimite(requisicao(""), TETO),
    "",
  );
  verificar(
    "Q16. sem corpo nenhum também",
    await lerCorpoComLimite(new Request("http://local.invalid/", { method: "POST" }), TETO),
    "",
  );
  verificar(
    "Q17. UTF-8 inválido é recusado",
    (await recusa(requisicao(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])))) instanceof
      ErroDeFiltroDoFechamento,
    true,
  );
  verificar(
    "Q18. o teto conta bytes, não caracteres (acentos ocupam 2)",
    (await recusa(requisicao("é".repeat(TETO / 2 + 1)))) instanceof ErroDeFiltroDoFechamento &&
      (await lerCorpoComLimite(requisicao("é".repeat(TETO / 2)), TETO)).length === TETO / 2,
    true,
  );
  verificar(
    "Q19. o corpo de um POST válido ainda atravessa a leitura e o extrator",
    extrairCorpoDoXlsx(
      JSON.parse(await lerCorpoComLimite(requisicao(JSON.stringify(corpoValido)), TETO)),
    ).assinatura,
    ASSINATURA,
  );
}

// --- L. Route Handler -------------------------------------------------------

console.log("\nL. Route Handler: forma literal");

const rota = fonte("src/app/api/fechamento/xlsx/route.ts");
const codigoDaRota = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const pos = (trecho) => codigoDaRota.indexOf(trecho);

verificar("L1. exporta POST", /export async function POST\(/.test(codigoDaRota), true);
verificar(
  "L2. não exporta GET, PUT, PATCH nem DELETE",
  !/export (?:async )?function (GET|PUT|PATCH|DELETE|HEAD)\b/.test(codigoDaRota),
  true,
);
verificar("L3. runtime nodejs", /export const runtime = "nodejs"/.test(codigoDaRota), true);
verificar(
  "L4. dinâmica, nunca estática",
  /export const dynamic = "force-dynamic"/.test(codigoDaRota),
  true,
);
verificar(
  "L5. lê o acesso pela decisão única do projeto",
  /lerAcesso\(\)/.test(codigoDaRota) && /decidirAcesso\(/.test(codigoDaRota),
  true,
);
verificar("L6. exige admin", /ehAdmin\(acesso\.papeis\)/.test(codigoDaRota), true);
verificar(
  "L7. a ordem é acesso → corpo → carregar → assinatura → gerar → tamanho",
  pos("decidirAcesso(") < pos("extrairCorpoDoXlsx(") &&
    pos("extrairCorpoDoXlsx(") < pos("carregarFechamento(") &&
    pos("carregarFechamento(") < pos("conferirAssinatura(") &&
    pos("conferirAssinatura(") < pos("gerarXlsxDoFechamento(") &&
    pos("gerarXlsxDoFechamento(") < pos("conferirTamanhoDoXlsx("),
  true,
);
verificar(
  "L8. usa o cliente Supabase da sessão",
  /criarClienteServidor\(\)/.test(codigoDaRota),
  true,
);
verificar(
  "L9. nunca service_role nem cliente administrativo",
  !/service_role|SERVICE_ROLE|admin\/|criarClienteAdmin|supabase\/admin/i.test(codigoDaRota),
  true,
);
verificar(
  "L10. resposta de erro sempre no-store",
  /SEM_CACHE/.test(codigoDaRota) && /"Cache-Control": "no-store"/.test(codigoDaRota),
  true,
);
verificar(
  "L11. o sucesso usa os cabeçalhos de download",
  /cabecalhosDeDownload\(/.test(codigoDaRota),
  true,
);
verificar("L12. o corpo precisa ser JSON", /application\/json/.test(codigoDaRota), true);
verificar("L13. o corpo tem teto", /TETO_DO_CORPO_DO_XLSX_EM_BYTES/.test(codigoDaRota), true);
verificar(
  "L13b. o corpo é lido com limite incremental, nunca por request.text() ou request.json()",
  /lerCorpoComLimite\(request,/.test(codigoDaRota) &&
    !/request\.(text|json|formData|arrayBuffer|blob)\(/.test(codigoDaRota),
  true,
);
verificar(
  "L13c. a autenticação vem antes de ler o corpo",
  codigoDaRota.indexOf("decidirAcesso(") < codigoDaRota.indexOf("await lerCorpo(request)"),
  true,
);
verificar(
  "L14. nunca devolve stack, SQL nem a mensagem interna",
  !/\.stack|error\.message|causa\.message\b(?!.*console)/.test(
    codigoDaRota.replace(/console\.error\([\s\S]*?\);/, ""),
  ),
  true,
);
verificar(
  "L15. a rota não lê nenhum valor financeiro do navegador",
  !/faturad|custo|billed|cost_amount|resultado|margem/i.test(codigoDaRota),
  true,
);
verificar(
  "L16. o erro vai ao log só como código e nome",
  /console\.error\(\s*"\[fechamento-xlsx\]"/.test(codigoDaRota),
  true,
);
verificar(
  "L17. nenhum arquivo parcial: o erro de tamanho retorna antes do corpo",
  pos("conferirTamanhoDoXlsx(") < pos("new NextResponse("),
  true,
);
verificar(
  "L18. o proxy continua dono da CSP (a rota não define CSP)",
  !/Content-Security-Policy/i.test(codigoDaRota),
  true,
);

// --- D. cliente HTTP do download --------------------------------------------

console.log("\nD. Cliente HTTP do download");

const PEDIDO = {
  clienteId: corpoValido.cliente,
  inicio: "2026-03-01",
  fim: "2026-03-15",
  assinatura: ASSINATURA,
};

function respostaFalsa({ status = 200, tipo = "application/json", corpo = "" }) {
  return () => Promise.resolve(new Response(corpo, { status, headers: { "Content-Type": tipo } }));
}

let ultimo = null;
const fetchQueCaptura = (resposta) => (url, init) => {
  ultimo = { url, init };
  return resposta();
};

const blob = await baixarXlsx(PEDIDO, {
  fetchImpl: fetchQueCaptura(respostaFalsa({ tipo: TIPO_DO_XLSX, corpo: "PKxx" })),
});
verificar("D1. 200 devolve um Blob", blob instanceof Blob && blob.size === 4, true);
verificar(
  "D2. usa POST em /api/fechamento/xlsx",
  ultimo.init.method === "POST" && ultimo.url === "/api/fechamento/xlsx",
  true,
);
igual(
  "D3. o corpo leva só cliente, período e assinatura",
  Object.keys(JSON.parse(ultimo.init.body)).sort(),
  ["assinatura", "cliente", "fim", "inicio"],
);
verificar("D4. nenhuma credencial é omitida: mesma origem", ultimo.init.credentials, "same-origin");
verificar("D5. sem cache", ultimo.init.cache, "no-store");

async function falhaDe(resposta) {
  try {
    await baixarXlsx(PEDIDO, { fetchImpl: resposta });
    return null;
  } catch (erro) {
    return erro;
  }
}

const e409 = await falhaDe(
  respostaFalsa({
    status: 409,
    corpo: JSON.stringify({
      erro: { codigo: "assinatura-divergente", mensagem: "texto do servidor" },
    }),
  }),
);
verificar(
  "D6. 409 vira ErroDaApiDoFechamento",
  e409 instanceof ErroDaApiDoFechamento && e409.status === 409,
  true,
);
verificar("D7. 409 pede atualização", pedeAtualizacao(e409), true);
verificar(
  "D8. 409 mostra a frase fixa",
  mensagemDoDownload(e409),
  "Os dados do fechamento foram alterados. Atualize o fechamento antes de baixar.",
);
verificar(
  "D9. 401 mostra a frase de sessão",
  mensagemDoDownload(
    await falhaDe(
      respostaFalsa({
        status: 401,
        corpo: JSON.stringify({ erro: { codigo: "nao-autenticado", mensagem: "x" } }),
      }),
    ),
  ),
  "Sua sessão expirou. Entre novamente para continuar.",
);
verificar(
  "D10. 403 mostra a frase de acesso negado",
  mensagemDoDownload(
    await falhaDe(
      respostaFalsa({
        status: 403,
        corpo: JSON.stringify({ erro: { codigo: "acesso-negado", mensagem: "x" } }),
      }),
    ),
  ),
  "Você não tem permissão para ver o fechamento.",
);
verificar(
  "D11. 413 mostra a frase do arquivo grande",
  /grande demais/.test(
    mensagemDoDownload(
      await falhaDe(
        respostaFalsa({
          status: 413,
          corpo: JSON.stringify({ erro: { codigo: "arquivo-grande", mensagem: "x" } }),
        }),
      ),
    ),
  ),
  true,
);

const e500 = await falhaDe(
  respostaFalsa({
    status: 500,
    tipo: "text/html",
    corpo: "<pre>Error: select * from clients at db.js:1</pre>",
  }),
);
verificar(
  "D12. 500 com HTML não vaza o corpo",
  mensagemDoDownload(e500),
  "Não foi possível gerar o arquivo. Tente novamente.",
);
verificar("D13. 500 não pede atualização", pedeAtualizacao(e500), false);

const eTipo = await falhaDe(respostaFalsa({ status: 200, tipo: "text/html", corpo: "<html>" }));
verificar("D14. 200 com tipo errado é erro, não arquivo", eTipo?.codigo, "resposta-invalida");

const eRede = await falhaDe(() => Promise.reject(new TypeError("fetch failed")));
verificar("D15. falha de rede vira erro controlado", eRede?.codigo, "rede");
verificar(
  "D16. e mostra a frase genérica",
  mensagemDoDownload(eRede),
  "Não foi possível gerar o arquivo. Tente novamente.",
);
verificar(
  "D17. erro desconhecido tem frase genérica",
  mensagemDoDownload(new Error("boom")),
  "Não foi possível gerar o arquivo. Tente novamente.",
);

// --- U. interface -----------------------------------------------------------

console.log("\nU. Interface");

const exportar = fonte("src/app/(painel)/fechamento/_exportar.tsx");
const painel = fonte("src/app/(painel)/fechamento/painel-fechamento.tsx");

verificar(
  "U1. ação principal: Baixar Excel (.xlsx)",
  exportar.includes("Baixar Excel (.xlsx)"),
  true,
);
verificar("U2. ação secundária: Baixar CSV", exportar.includes("Baixar CSV"), true);
verificar(
  "U3. CSV por colaborador e detalhamento diário",
  /ROTULO_DO_FORMATO_DE_CSV/.test(exportar) &&
    /FORMATOS_DE_CSV: FormatoDeCsv\[\] = \["colaborador", "diario"\]/.test(exportar),
  true,
);
verificar(
  "U4. o XLSX envia só o recorte e a assinatura",
  /clienteId: dados\.meta\.clienteId,\s*inicio: dados\.meta\.inicio,\s*fim: dados\.meta\.fim,\s*assinatura: dados\.meta\.assinatura,\s*\}\)/.test(
    exportar,
  ),
  true,
);
verificar(
  "U5. o botão respeita 'disponivel' e o download em andamento",
  (exportar.match(/disabled=\{!disponivel \|\| baixando\}/g) ?? []).length,
  2,
);
verificar(
  "U6. só a leitura 'com-lancamentos' libera a exportação",
  /disponivel=\{estado === "com-lancamentos"\}/.test(painel),
  true,
);
verificar(
  "U7. 409 atualiza o fechamento",
  /pedeAtualizacao\(erro\)\) onDesatualizado\(\)/.test(exportar),
  true,
);
verificar(
  "U8. a mensagem exibida vem da frase fixa",
  /toast\.error\(mensagemDoDownload\(erro\)\)/.test(exportar),
  true,
);
verificar(
  "U9. o cliente não importa o gerador de XLSX nem a biblioteca",
  !/fechamento\/xlsx|write-excel-file|node:/.test(exportar),
  true,
);
verificar(
  "U10. o CSV sai do mesmo FechamentoData da tela",
  /csvDoFechamento\(dados, formato\)/.test(exportar),
  true,
);
verificar(
  "U11. o CSV leva BOM para o Excel reconhecer a acentuação",
  exportar.includes("\\uFEFF${csv}"),
  true,
);
verificar(
  "U12. nada de cálculo financeiro na interface de exportação",
  !/\* 100|\/ 100|toFixed|reduce\(/.test(exportar),
  true,
);

function arquivosDe(dir) {
  return readdirSync(dir).flatMap((nomeDoItem) => {
    const caminho = join(dir, nomeDoItem);
    return statSync(caminho).isDirectory() ? arquivosDe(caminho) : [caminho];
  });
}
const raiz = fileURLToPath(new URL("../src", import.meta.url));
const importaOGerador = arquivosDe(raiz)
  .filter((a) => /\.(ts|tsx)$/.test(a))
  .filter((a) => /from "[^"]*fechamento\/xlsx"/.test(readFileSync(a, "utf8")))
  .map((a) => a.replace(/\\/g, "/"));
verificar(
  "U13. só o Route Handler importa o gerador de XLSX",
  importaOGerador.length === 1 &&
    importaOGerador[0].endsWith("src/app/api/fechamento/xlsx/route.ts"),
  true,
);
verificar(
  "U14. nenhum componente cliente importa o gerador",
  arquivosDe(raiz)
    .filter((a) => /\.tsx$/.test(a))
    .filter((a) => /^\s*"use client"/.test(readFileSync(a, "utf8")))
    .every((a) => !/fechamento\/xlsx|write-excel-file/.test(readFileSync(a, "utf8"))),
  true,
);

// --- B. dependência ---------------------------------------------------------

console.log("\nB. Dependência");

const pacote = JSON.parse(fonte("package.json"));
verificar(
  "B1. versão exata em dependencies (sem ^ nem ~)",
  pacote.dependencies["write-excel-file"],
  "4.1.1",
);
verificar("B2. não é devDependency", pacote.devDependencies?.["write-excel-file"], undefined);
const trava = JSON.parse(fonte("package-lock.json"));
verificar(
  "B3. o lockfile resolve 4.1.1",
  trava.packages["node_modules/write-excel-file"]?.version,
  "4.1.1",
);
verificar("B4. licença MIT", trava.packages["node_modules/write-excel-file"]?.license, "MIT");
igual(
  "B5. única dependência transitiva nova",
  Object.keys(trava.packages["node_modules/write-excel-file"]?.dependencies ?? {}),
  ["fflate"],
);
verificar(
  "B6. fflate resolvido no lockfile",
  typeof trava.packages["node_modules/fflate"]?.version,
  "string",
);
verificar(
  "B7. nenhuma biblioteca de planilha alternativa foi adicionada",
  !["exceljs", "xlsx", "sheetjs", "xlsx-populate"].some(
    (p) => pacote.dependencies[p] || pacote.devDependencies?.[p],
  ),
  true,
);
verificar(
  "B8. só o Route Handler usa write-excel-file",
  !arquivosDe(raiz)
    .filter(
      (a) => /\.(ts|tsx)$/.test(a) && !a.replace(/\\/g, "/").endsWith("lib/fechamento/xlsx.ts"),
    )
    .some((a) => /write-excel-file/.test(readFileSync(a, "utf8"))),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
