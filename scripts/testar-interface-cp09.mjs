/**
 * Regressão do CP-09 (QA-BS-01) — interface, clareza e consistência.
 *
 * COMO RODAR:
 *
 *   npm run test:interface-cp09
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto. O comportamento
 * na tela é provado pelo E2E local (e2e/specs/98-interface-clareza); aqui ficam as funções puras de
 * apresentação e a forma do código que o E2E não alcança (nenhum `window.confirm`, rótulos ligados).
 */

import { readFileSync } from "node:fs";

import {
  SEM_RECEITA_NO_PERIODO,
  descricaoDasDiarias,
  diariasDeDomingoOuFeriado,
  percentualDaMargem,
  reaisNoCsv,
} from "../src/lib/apresentacao-indicadores.ts";
import { mensagemDaExclusao } from "../src/lib/confirmar-exclusao.ts";

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

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fonte = (caminho) => semComentarios(ler(caminho));

const PAINEL = "src/app/(painel)";
const telas = {
  clientes: fonte(`${PAINEL}/clientes/painel-clientes.tsx`),
  colaboradores: fonte(`${PAINEL}/colaboradores/painel-colaboradores.tsx`),
  operacoes: fonte(`${PAINEL}/operacoes/painel-operacoes.tsx`),
  dashboard: fonte(`${PAINEL}/dashboard/painel-dashboard.tsx`),
  relatorios: fonte(`${PAINEL}/relatorios/painel-relatorios.tsx`),
  faturamento: fonte(`${PAINEL}/faturamento/painel-faturamento.tsx`),
  adicionais: fonte(`${PAINEL}/faturamento/adicionais.tsx`),
  apontamentos: fonte(`${PAINEL}/apontamentos/painel-apontamentos.tsx`),
  operacional: fonte(`${PAINEL}/operacional/painel-operacional.tsx`),
};
const dialogo = fonte(`${PAINEL}/_components/confirmacao-de-exclusao.tsx`);

// ---------------------------------------------------------------------------------------------
// A. D8 — exclusão confirmada pelo diálogo da tela, não pelo `window.confirm`
// ---------------------------------------------------------------------------------------------

console.log("\nA. D8 — confirmação de exclusão pela tela\n");

verificar(
  "A1. o texto diz o que sai, o que vai junto e que não se desfaz",
  mensagemDaExclusao("o cliente X", "Leva 2 contratos."),
  {
    titulo: "Excluir o cliente X?",
    descricao: "Leva 2 contratos. Esta ação não pode ser desfeita.",
  },
);
verificar(
  "A2. sem consequência, só o aviso de que não se desfaz",
  mensagemDaExclusao("o turno T", "  "),
  { titulo: "Excluir o turno T?", descricao: "Esta ação não pode ser desfeita." },
);
for (const nome of ["clientes", "colaboradores", "operacoes"]) {
  const tela = telas[nome];
  verificar(
    `A3. ${nome}: nenhum confirm nativo; usa o diálogo e o desenha uma vez`,
    [
      /\bconfirm\(/.test(tela),
      /const confirmacao = useConfirmacaoDeExclusao\(\);/.test(tela),
      (tela.match(/\{confirmacao\.dialogo\}/g) ?? []).length,
    ],
    [false, true, 1],
  );
}
verificar(
  "A4. cada exclusão passa pelo diálogo (cliente, contrato, colaborador, operação, turno)",
  [
    (telas.clientes.match(/confirmacao\.pedir\(/g) ?? []).length,
    (telas.colaboradores.match(/confirmacao\.pedir\(/g) ?? []).length,
    (telas.operacoes.match(/confirmacao\.pedir\(/g) ?? []).length,
  ],
  [2, 1, 2],
);
verificar(
  "A5. a mutação de exclusão só roda dentro do callback de confirmação",
  [
    [telas.clientes, "removeClient"],
    [telas.clientes, "removeContract"],
    [telas.colaboradores, "remove"],
    [telas.operacoes, "removeOperation"],
    [telas.operacoes, "removeShift"],
  ].map(([tela, mutacao]) => {
    const chamadas = tela.match(new RegExp(`\\b${mutacao}\\.mutate\\(`, "g")) ?? [];
    const naConfirmacao = new RegExp(
      `confirmacao\\.pedir\\([\\s\\S]{0,240}?\\(\\) =>\\s*${mutacao}\\.mutate\\(`,
    );
    return chamadas.length === 1 && naConfirmacao.test(tela);
  }),
  [true, true, true, true, true],
);
verificar(
  "A6. o diálogo é um AlertDialog com o foco inicial em Cancelar e o Excluir destrutivo",
  [
    /<AlertDialogContent[\s\S]*?onOpenAutoFocus=\{\(evento\) => \{\s*evento\.preventDefault\(\);\s*cancelarRef\.current\?\.focus\(\);/.test(
      dialogo,
    ),
    /<AlertDialogCancel ref=\{cancelarRef\}>Cancelar<\/AlertDialogCancel>/.test(dialogo),
    /className="bg-destructive[^"]*"[\s\S]*?Excluir\s*<\/AlertDialogAction>/.test(dialogo),
    /\bconfirm\(/.test(dialogo),
  ],
  [true, true, true, false],
);

// ---------------------------------------------------------------------------------------------
// B. R-CP08-01 — "Diárias" diz quantas são de domingo/feriado (cobradas por hora)
// ---------------------------------------------------------------------------------------------

console.log("\nB. R-CP08-01 — diárias de domingo/feriado\n");

verificar(
  "B1. conta só quem não faltou e tem valor de domingo/feriado",
  diariasDeDomingoOuFeriado([
    { status: "present", specialValue: 120 },
    { status: "present", specialValue: 0 },
    { status: "absent", specialValue: 80 },
    { status: "substitution", specialValue: 40 },
  ]),
  2,
);
verificar(
  "B2. sem dia especial, a descrição é a de sempre",
  descricaoDasDiarias("Diárias faturáveis", 0),
  "Diárias faturáveis",
);
verificar(
  "B3. com dia especial, a descrição diz quantos e como é cobrado",
  descricaoDasDiarias("2 faltas", 3),
  "2 faltas · inclui 3 de domingo ou feriado, cobrado por hora",
);
for (const nome of ["dashboard", "relatorios", "faturamento"]) {
  verificar(
    `B4. ${nome}: a contagem continua sendo a soma de dailies; só a descrição muda`,
    [
      /dailies: sumBy\(period, \(row\) => row\.dailies\)/.test(telas[nome]),
      /diariasDeDomingoOuFeriado\(period\)/.test(telas[nome]),
      /description=\{descricaoDasDiarias\(/.test(telas[nome]),
    ],
    [true, true, true],
  );
}

// ---------------------------------------------------------------------------------------------
// C. R-CP08-02 — sem receita, a margem percentual não vira 0,0%
// ---------------------------------------------------------------------------------------------

console.log("\nC. R-CP08-02 — margem sem receita\n");

verificar(
  "C1. sem receita (zero ou negativa) não há percentual",
  [percentualDaMargem(0, 300), percentualDaMargem(0, 0), percentualDaMargem(-10, 5)],
  [SEM_RECEITA_NO_PERIODO, SEM_RECEITA_NO_PERIODO, SEM_RECEITA_NO_PERIODO],
);
verificar(
  "C2. com receita, o mesmo número e formato de antes (pct(marginPct))",
  [percentualDaMargem(400, 300), percentualDaMargem(3052.5, 1773.75), percentualDaMargem(100, 150)],
  ["25,0%", "41,9%", "-50,0%"],
);
verificar(
  "C3. as três telas e as linhas por cliente/operação usam a mesma regra",
  [
    (telas.dashboard.match(/percentualDaMargem\(/g) ?? []).length,
    (telas.relatorios.match(/percentualDaMargem\(/g) ?? []).length,
    (telas.faturamento.match(/percentualDaMargem\(/g) ?? []).length,
    /pct\(marginPct\(/.test(telas.dashboard + telas.relatorios + telas.faturamento),
  ],
  [2, 2, 1, false],
);

// ---------------------------------------------------------------------------------------------
// D. R-CP08-03 — CSV dos lançamentos com vírgula decimal
// ---------------------------------------------------------------------------------------------

console.log("\nD. R-CP08-03 — decimal do CSV\n");

verificar(
  "D1. vírgula decimal, duas casas, sem milhar, sem -0",
  [
    reaisNoCsv(240),
    reaisNoCsv(1234.5),
    reaisNoCsv(0.1 + 0.2),
    reaisNoCsv(-12.5),
    reaisNoCsv(-0.001),
  ],
  ["240,00", "1234,50", "0,30", "-12,50", "0,00"],
);
verificar(
  "D2. o valor não muda: os dígitos são os do toFixed(2) de antes, só o separador troca",
  [1773.75, 3052.5, 0.07, 99999.99, -12.345, 1.005, 2754.69].every(
    (v) => reaisNoCsv(v) === v.toFixed(2).replace(".", ","),
  ),
  true,
);
for (const nome of ["relatorios", "faturamento"]) {
  verificar(
    `D3. ${nome}: as colunas de valor usam reaisNoCsv, nunca toFixed com ponto`,
    [
      /reaisNoCsv\(row\.billed\),\s*reaisNoCsv\(row\.cost\),/.test(telas[nome]),
      /row\.(billed|cost)\.toFixed\(/.test(telas[nome]),
    ],
    [true, false],
  );
}

// ---------------------------------------------------------------------------------------------
// E. D-CP09-01 — rótulos ligados aos campos (leitor de tela e clique no rótulo)
// ---------------------------------------------------------------------------------------------

console.log("\nE. D-CP09-01 — rótulos ligados\n");

const ligados = {
  dashboard: ["dashboard-inicio", "dashboard-fim"],
  relatorios: ["relatorios-inicio", "relatorios-fim"],
  faturamento: ["faturamento-cliente", "faturamento-inicio", "faturamento-fim"],
  adicionais: ["adicional-operacao"],
  apontamentos: ["apontamentos-operacao", "apontamentos-turno", "apontamentos-data"],
  operacional: ["operacional-operacao", "operacional-turno", "operacional-data"],
};
for (const [nome, ids] of Object.entries(ligados)) {
  verificar(
    `E1. ${nome}: cada rótulo aponta para um campo com o mesmo id`,
    ids.map(
      (id) =>
        new RegExp(`<Label htmlFor="${id}"`).test(telas[nome]) &&
        new RegExp(`id="${id}"`).test(telas[nome]),
    ),
    ids.map(() => true),
  );
}
verificar(
  "E2. nenhum <Label> sem htmlFor nos filtros dessas telas (exceto 'Preço', que não é campo)",
  Object.keys(ligados).flatMap((nome) =>
    [...telas[nome].matchAll(/<Label(?![^>]*htmlFor)[^>]*>\s*([^<]*)</g)]
      .map((m) => m[1].trim())
      .filter((texto) => texto !== "Preço"),
  ),
  [],
);

// ---------------------------------------------------------------------------------------------
// F. D-CP09-02 — a tela do operador tem título em todos os estados
// ---------------------------------------------------------------------------------------------

console.log("\nF. D-CP09-02 — título do operador\n");

verificar(
  "F1. carregando, falha e sem operação mostram o cabeçalho antes do aviso",
  [
    /if \(operacoes\.isError\) \{\s*return \(\s*<>\s*\{cabecalho\}\s*<FalhaDeLeitura/.test(
      telas.operacional,
    ),
    /if \(operacoes\.isPending \|\| !operacoes\.data\) \{\s*return \(\s*<>\s*\{cabecalho\}\s*<Aviso tipo="carregando">/.test(
      telas.operacional,
    ),
    /if \(operacoes\.data\.length === 0\) \{\s*return \(\s*<>\s*\{cabecalho\}\s*<Aviso>/.test(
      telas.operacional,
    ),
    (telas.operacional.match(/<PageHeader/g) ?? []).length,
  ],
  [true, true, true, 1],
);

// ---------------------------------------------------------------------------------------------
// G. Operações — o regime de cobrança dito como é (sem campo fictício de produção)
// ---------------------------------------------------------------------------------------------

console.log("\nG. Operações — cobrança por diária\n");

const servicoUi = fonte("src/lib/container-servico-ui.ts");
verificar(
  "G1. a Nova operação diz que cobra por diária e que por quantidade ainda não existe",
  [
    /export const MENSAGEM_COBRANCA_POR_DIARIA =\s*"A cobrança é por diária de cada participante; cobrar por quantidade executada \(ex\.: por contêiner\) ainda não existe no sistema\.";/.test(
      servicoUi,
    ),
    /: "Fixa: operação recorrente, com contrato, turnos e equipe\."\}\{" "\}\s*\{MENSAGEM_COBRANCA_POR_DIARIA\}/.test(
      telas.operacoes,
    ),
  ],
  [true, true],
);
verificar(
  "G2. nenhum campo de quantidade, unidade ou regime de cobrança na operação",
  /<Label[^>]*>[^<]*(Quantidade|Unidade|Produção|Regime|Forma de cobrança)/i.test(telas.operacoes),
  false,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
