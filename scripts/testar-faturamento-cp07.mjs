/**
 * Regressão dos defeitos do CP-07 (QA-BS-01) — fechamento e faturamento.
 *
 * COMO RODAR:
 *
 *   npm run test:faturamento-cp07
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto. O
 * comportamento foi reproduzido no E2E local (e2e/specs/95-fechamento-faturamento) antes da
 * correção; aqui ficam as regras puras da conferência antes de emitir, a matriz do aviso de
 * duplicidade e a forma do código da tela.
 */

import { readFileSync } from "node:fs";

import { adicionaisDeContainerEmDuplicidade } from "../src/lib/container-servico-ui.ts";
import {
  MENSAGEM_EMISSAO_SEM_CONFIRMACAO,
  MENSAGEM_NADA_A_FATURAR,
  ROTULO_DA_PRESENCA,
  divergenciaDaEmissao,
  faturasQueCobremOPeriodo,
  mensagemDaEmissao,
  resumoDosDias,
  rotuloDosDiasComApontamento,
} from "../src/lib/faturamento-conferencia.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const a = typeof obtido === "string" ? obtido : JSON.stringify(obtido);
  const b = typeof esperado === "string" ? esperado : JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------------------------
console.log("\nA. D4 — dias da competência pelo estado do apontamento\n");

const L = (date, timesheetId, timesheetStatus, invoiceId = null, clientId = "c1") => ({
  clientId,
  date,
  invoiceId,
  timesheetId,
  timesheetStatus,
  operationName: `Op ${timesheetId}`,
  shiftName: "Dia",
});

const linhas = [
  L("2027-01-01", "f1", "closed"),
  L("2027-01-01", "f1", "closed"), // dois colaboradores na mesma folha
  L("2027-01-02", "f2", "closed"),
  L("2027-01-06", "f6", "open"),
  L("2027-01-06", "f6b", "closed"), // mesmo dia, outra folha fechada: o dia segue ABERTO
  L("2027-01-07", "f7", "open", "fat-1"), // já faturado: não é pendência
  L("2027-01-08", "f8", "closed", null, "outro"), // outro cliente
  L("2027-01-20", "f20", "open"), // fora do período
];
const r = resumoDosDias(linhas, "c1", "2027-01-01", "2027-01-15");
verificar("A1. dias do período (1 a 15)", r.doPeriodo, 15);
verificar("A2. dias com apontamento a faturar", r.comApontamento, 3);
verificar("A3. fechados / abertos", [r.fechados, r.abertos], [2, 1]);
verificar("A4. dia com uma folha aberta conta como aberto", r.folhasAbertas, [
  { data: "2027-01-06", operacao: "Op f6", turno: "Dia" },
]);
verificar("A5. dia totalmente faturado não é pendência", r.jaFaturados, 1);
verificar("A6. dia sem apontamento NÃO é pendência (15 − 4)", r.semApontamento, 11);
verificar("A7. rótulo", rotuloDosDiasComApontamento(r), "3 (2 fechados, 1 aberto)");
verificar(
  "A8. singular e plural",
  rotuloDosDiasComApontamento({ ...r, comApontamento: 1, fechados: 0, abertos: 1 }),
  "1 (0 fechados, 1 aberto)",
);
verificar(
  "A9. nada a faturar: só zero",
  rotuloDosDiasComApontamento(resumoDosDias([], "c1", "2027-02-16", "2027-02-28")),
  "0",
);
verificar(
  "A10. fevereiro bissexto: 16 a 29 tem 14 dias",
  resumoDosDias([], "c1", "2028-02-16", "2028-02-29").doPeriodo,
  14,
);
verificar(
  "A11. período invertido não inventa dias",
  resumoDosDias([], "c1", "2027-01-15", "2027-01-01").doPeriodo,
  0,
);

// ---------------------------------------------------------------------------------------------
console.log("\nB. Fatura já emitida no período (complementar)\n");

const faturas = [
  {
    id: "a",
    client_id: "c1",
    period_start: "2027-01-01",
    period_end: "2027-01-15",
    total_amount: 3217.5,
  },
  {
    id: "b",
    client_id: "c1",
    period_start: "2027-01-16",
    period_end: "2027-01-31",
    total_amount: 240,
  },
  {
    id: "c",
    client_id: "c2",
    period_start: "2027-01-01",
    period_end: "2027-01-15",
    total_amount: 10,
  },
];
verificar(
  "B1. mesma competência, mesmo cliente",
  faturasQueCobremOPeriodo(faturas, "c1", "2027-01-01", "2027-01-15").map((f) => f.id),
  ["a"],
);
verificar(
  "B2. outro cliente não conta",
  faturasQueCobremOPeriodo(faturas, "c2", "2027-01-16", "2027-01-31").map((f) => f.id),
  [],
);
verificar(
  "B3. sobreposição parcial também é mostrada",
  faturasQueCobremOPeriodo(faturas, "c1", "2027-01-10", "2027-01-20").map((f) => f.id),
  ["a", "b"],
);

// ---------------------------------------------------------------------------------------------
console.log("\nC. Mensagens de erro da emissão (nunca cru, nunca enganoso)\n");

verificar(
  "C1. falha de rede (Chromium) → pode ter gravado: conferir a lista",
  mensagemDaEmissao({ message: "TypeError: Failed to fetch" }),
  MENSAGEM_EMISSAO_SEM_CONFIRMACAO,
);
verificar(
  "C2. falha de rede (Safari)",
  mensagemDaEmissao({ message: "Load failed" }),
  MENSAGEM_EMISSAO_SEM_CONFIRMACAO,
);
verificar(
  "C3. outra aba faturou antes (P0002 do banco)",
  mensagemDaEmissao({
    code: "P0002",
    message: "Nenhum lançamento faturável no período para este cliente.",
  }),
  MENSAGEM_NADA_A_FATURAR,
);
verificar(
  "C4. competência inválida: o texto em português do banco é mantido",
  mensagemDaEmissao({
    code: "22023",
    message: "O período 05/01/2027 a 20/01/2027 não é uma competência quinzenal do cliente.",
  }),
  "O período 05/01/2027 a 20/01/2027 não é uma competência quinzenal do cliente.",
);
verificar(
  "C5. guarda da própria tela",
  mensagemDaEmissao(new Error("Escolha uma competência inteira da frequência do cliente.")),
  "Escolha uma competência inteira da frequência do cliente.",
);
verificar(
  "C6. erro com código do banco nunca vira falha de rede",
  mensagemDaEmissao({ code: "40001", message: "Failed to fetch" }) ===
    MENSAGEM_EMISSAO_SEM_CONFIRMACAO,
  false,
);

// ---------------------------------------------------------------------------------------------
console.log("\nD. Conferido × emitido (ED1)\n");

const conferido = { total: 240, apontamentos: 1, adicionais: 0 };
verificar(
  "D1. igual: sem aviso",
  divergenciaDaEmissao(conferido, { total_amount: "240.00" }),
  null,
);
verificar(
  "D2. diferente: avisa os dois valores",
  divergenciaDaEmissao(conferido, { total_amount: 480 }),
  {
    conferido: 240,
    emitido: 480,
  },
);
verificar(
  "D3. centavos: 0,1 + 0,2 não gera falso aviso",
  divergenciaDaEmissao(
    { total: 0.1 + 0.2, apontamentos: 1, adicionais: 0 },
    { total_amount: "0.30" },
  ),
  null,
);

// ---------------------------------------------------------------------------------------------
console.log("\nE. Matriz do aviso de duplicidade (registro antigo × apontamentos)\n");

const adicionais = [
  { id: "ad-mesma", operation_id: "op-a" },
  { id: "ad-sem-op", operation_id: null },
  { id: "ad-outra", operation_id: "op-b" },
  { id: "ad-manual", operation_id: "op-a" }, // adicional manual: não é registro antigo
  { id: "ad-cancelado", operation_id: "op-a" },
];
const servicos = [
  { id: "s1", billing_additional_id: "ad-mesma", situacao: "disponivel" },
  { id: "s2", billing_additional_id: "ad-sem-op", situacao: "disponivel" },
  { id: "s3", billing_additional_id: "ad-outra", situacao: "disponivel" },
  { id: "s4", billing_additional_id: "ad-cancelado", situacao: "cancelado" },
];
const comApontamento = new Set(["op-a"]);
const avisos = adicionaisDeContainerEmDuplicidade(adicionais, servicos, comApontamento).map(
  (d) => d.adicionalId,
);
verificar(
  "E1. registro antigo ligado à MESMA operação com apontamentos: avisa",
  avisos.includes("ad-mesma"),
  true,
);
verificar(
  "E2. registro antigo sem operação: NÃO avisa (R-CP06-02)",
  avisos.includes("ad-sem-op"),
  false,
);
verificar(
  "E3. registro antigo de OUTRA operação: NÃO avisa (R-CP06-02)",
  avisos.includes("ad-outra"),
  false,
);
verificar(
  "E4. adicional manual de mesmo valor: NÃO avisa (R-CP06-03)",
  avisos.includes("ad-manual"),
  false,
);
verificar("E5. registro antigo cancelado: NÃO avisa", avisos.includes("ad-cancelado"), false);

verificar("F1. presença no CSV em português", ROTULO_DA_PRESENCA, {
  present: "Presente",
  absent: "Falta",
  replacement: "Substituição",
});

// ---------------------------------------------------------------------------------------------
console.log("\nG. Forma do código da tela de Faturamento\n");

const tela = semComentarios(
  readFileSync("src/app/(painel)/faturamento/painel-faturamento.tsx", "utf8"),
);
verificar(
  "G1. “Gerar fatura” relê os dados antes de abrir a confirmação",
  /onClick=\{\(\) => void abrirConfirmacao\(\)\}/.test(tela) &&
    /async function abrirConfirmacao\(\)[\s\S]*?await atualizarDadosDaFatura\(\);[\s\S]*?setConfirmarFatura\(true\)/.test(
      tela,
    ),
  true,
);
verificar(
  "G2. a releitura cobre lançamentos, folhas, faturas, adicionais e registros antigos",
  [
    '["invoices"]',
    '["timesheet_entries"]',
    '["timesheets"]',
    "CHAVE_DOS_ADICIONAIS",
    "CHAVE_DOS_AJUSTES",
    "CHAVE_DO_CUSTO_DE_CONTAINERS",
    '["containers", "adicionais"]',
  ].every((k) => tela.includes(k)),
  true,
);
verificar(
  "G3. erro na emissão: mensagem própria e releitura (outra aba / resposta perdida)",
  /onError: async[\s\S]*?toast\.error\(mensagemDaEmissao\(error\)\);[\s\S]*?await atualizarDadosDaFatura\(\);/.test(
    tela,
  ),
  true,
);
verificar(
  "G4. sucesso compara o conferido com o emitido",
  /onSuccess: async[\s\S]*?divergenciaDaEmissao\(conferido, invoice\)/.test(tela),
  true,
);
verificar(
  "G5. o conferido é fixado no clique de “Emitir fatura”",
  /function emitirFatura\(\)[\s\S]*?conferidoRef\.current = \{\s*total: totalAFaturar,/.test(tela),
  true,
);
verificar(
  "G6. a confirmação mostra dias abertos, fatura já emitida e duplicidade",
  ["dias.folhasAbertas.length > 0", "faturasDoPeriodo.length > 0", "duplicidades.length > 0"].every(
    (k) => tela.includes(k),
  ),
  true,
);
verificar(
  "G7. a confirmação NÃO bloqueia a emissão por dia aberto ou duplicidade (decisão pendente)",
  /AlertDialogAction\s*\n\s*disabled=\{generate\.isPending\}/.test(tela),
  true,
);
verificar(
  "G8. o CSV leva o nome do cliente e a presença traduzida",
  tela.includes(
    "faturamento-${sanitizarParaArquivo(clientName(selectedClient))}-${start}-${end}.csv",
  ) && tela.includes("ROTULO_DA_PRESENCA[row.status] ?? row.status"),
  true,
);
verificar(
  "G9. a autoridade continua na RPC: os totais não são enviados pelo navegador",
  /rpc\("gerar_fatura", \{\s*_client_id: selectedClient,\s*_period_start: start,\s*_period_end: end,\s*\}\)/.test(
    tela,
  ),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
