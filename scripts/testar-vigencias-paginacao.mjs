/**
 * Leituras das vigências financeiras: sempre completas, mesmo acima de 1000 linhas (PR #68, P2).
 *
 * COMO RODAR:
 *
 *   npm run test:vigencias-paginacao
 *
 * O PROBLEMA. O PostgREST corta toda resposta em `max_rows = 1000`, em silêncio. As leituras de
 * versões (`contract_terms`, `operation_terms`, `employee_cost_terms`) eram um `select("*")`
 * filtrado e sem paginação: com mais de 1000 versões ativas dos colaboradores da folha (versão
 * encerrada continua `active`), a tela receberia só uma parte e trataria a versão que faltou como
 * "sem condição financeira", bloqueando o salvamento da folha.
 *
 * O QUE É REAL E O QUE É SIMULADO
 *   - REAL: as funções de leitura de `src/lib/vigencias-dados.ts`, o paginador de `paginacao.ts` e o
 *     cliente `supabase-js` (via `criarClienteNavegador`).
 *   - SIMULADO: só o transporte. `globalThis.fetch` vira um servidor PostgREST em memória que
 *     aplica `eq`, `in`, `id=gt.`, `order`, `limit`, o teto `max_rows` e o `HEAD` de contagem exata
 *     COM os mesmos filtros. A URL que o `supabase-js` monta é a que os testes inspecionam.
 *
 * Nada acessa rede nem o Supabase de Production: o domínio é `.invalid` e a chave é inerte.
 */

import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooks = `
import { pathToFileURL } from "node:url";
const SRC = ${JSON.stringify(pathToFileURL(path.join(RAIZ, "src") + path.sep).href)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2) + ".ts", SRC).href, context);
  try {
    return await nextResolve(specifier, context);
  } catch (erro) {
    const semExtensao = /^\\.\\.?\\//.test(specifier) && !/\\.[a-zA-Z0-9]+$/.test(specifier);
    if (erro?.code === "ERR_MODULE_NOT_FOUND" && semExtensao) return nextResolve(specifier + ".ts", context);
    throw erro;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://pg-simulado.invalid";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "chave-inerte-apenas-de-teste";

const { criarClienteNavegador } = await import("../src/integrations/supabase/browser.ts");
const { lerCustosDosColaboradores, lerVersoesDoContrato, lerVersoesDaOperacao } =
  await import("../src/lib/vigencias-dados.ts");
const { ErroPaginacao } = await import("../src/lib/paginacao.ts");

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const igual = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (igual) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    const detalhe = `esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`;
    falhas.push(`${caso} — ${detalhe}`);
    console.log(`  FAIL  ${caso} — ${detalhe}`);
  }
}

const idDe = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Servidor PostgREST simulado (só o transporte)
// ---------------------------------------------------------------------------

const servidor = {
  tabelas: {},
  maxRows: 1000,
  requisicoes: [],
  /** (registro) => Response | undefined */
  interceptar: null,
  /** (tabela) => número: sobrescreve a contagem exata do HEAD. */
  contagemSobrescrita: null,
};

function reiniciar(tabelas, opcoes = {}) {
  servidor.tabelas = tabelas;
  servidor.maxRows = opcoes.maxRows ?? 1000;
  servidor.requisicoes = [];
  servidor.interceptar = opcoes.interceptar ?? null;
  servidor.contagemSobrescrita = opcoes.contagemSobrescrita ?? null;
}

/** Aplica os filtros do PostgREST que as leituras usam: eq, in e gt. */
function filtrar(linhas, parametros) {
  return linhas.filter((linha) =>
    Object.entries(parametros).every(([coluna, valor]) => {
      if (["select", "order", "limit", "offset"].includes(coluna)) return true;
      if (valor.startsWith("eq.")) return String(linha[coluna]) === valor.slice(3);
      if (valor.startsWith("gt.")) return String(linha[coluna]) > valor.slice(3);
      if (valor.startsWith("in.(")) {
        const lista = valor
          .slice(4, -1)
          .split(",")
          .map((v) => v.replace(/^"|"$/g, ""));
        return lista.includes(String(linha[coluna]));
      }
      throw new Error(`filtro não suportado pelo simulador: ${coluna}=${valor}`);
    }),
  );
}

globalThis.fetch = async (entrada, init = {}) => {
  const req = new Request(entrada, init);
  const url = new URL(req.url);
  const tabela = url.pathname.replace(/^\/rest\/v1\//, "");
  const registro = {
    metodo: req.method,
    tabela,
    parametros: Object.fromEntries(url.searchParams.entries()),
    prefer: req.headers.get("prefer"),
  };
  servidor.requisicoes.push(registro);

  if (servidor.interceptar) {
    const resposta = servidor.interceptar(registro);
    if (resposta) return resposta;
  }

  const linhas = servidor.tabelas[tabela];
  if (!linhas) return Response.json({ message: `tabela ${tabela} inexistente` }, { status: 404 });

  const doFiltro = filtrar(linhas, registro.parametros);

  if (req.method === "HEAD") {
    const total = servidor.contagemSobrescrita
      ? servidor.contagemSobrescrita(tabela)
      : doFiltro.length;
    return new Response(null, { status: 200, headers: { "content-range": `*/${total}` } });
  }

  const ordenadas = [...doFiltro].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const limite = Number(registro.parametros.limit ?? Infinity);
  return Response.json(ordenadas.slice(0, Math.min(limite, servidor.maxRows)), { status: 200 });
};

const gets = () => servidor.requisicoes.filter((r) => r.metodo === "GET");
const heads = () => servidor.requisicoes.filter((r) => r.metodo === "HEAD");
const db = criarClienteNavegador();

/** `n` versões de custo distribuídas entre os colaboradores; `ativa` falsa em `inativas` delas. */
function custos(n, colaboradores, { inativas = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: idDe(i + 1),
    employee_id: colaboradores[i % colaboradores.length],
    active: i >= inativas,
    daily_cost: 100 + i,
    valid_from: "2026-01-01",
  }));
}

const COLABORADORES = ["c1", "c2", "c3"];

// ---------------------------------------------------------------------------
// A. Tamanhos de conjunto
// ---------------------------------------------------------------------------

console.log("A. Tamanho do resultado: abaixo, exatamente no limite e acima de 1000");

for (const total of [0, 1, 300, 999, 1000, 1001, 2501]) {
  reiniciar({ employee_cost_terms: custos(total, COLABORADORES) });
  const lidas = await lerCustosDosColaboradores(db, COLABORADORES, true);
  verificar(
    `A-${total}. ${total} versões ativas: lê todas, sem perda nem duplicação`,
    [
      lidas.length,
      new Set(lidas.map((l) => l.id)).size,
      lidas.reduce((s, l) => s + l.daily_cost, 0),
    ],
    [total, total, Array.from({ length: total }, (_, i) => 100 + i).reduce((s, v) => s + v, 0)],
  );
}

reiniciar({ employee_cost_terms: custos(2501, COLABORADORES) });
const semPaginar = await db
  .from("employee_cost_terms")
  .select("*")
  .in("employee_id", COLABORADORES)
  .eq("active", true);
verificar(
  "A-ref. a leitura de antes (sem paginar) devolvia SÓ 1000 de 2501 e sem erro: o defeito que o simulador reproduz",
  [semPaginar.error, semPaginar.data.length],
  [null, 1000],
);

// ---------------------------------------------------------------------------
// B. Mecânica da paginação e filtros
// ---------------------------------------------------------------------------

console.log("\nB. Mecânica: cursor, ordem, filtros e contagem");

reiniciar({ employee_cost_terms: custos(1200, COLABORADORES) });
await lerCustosDosColaboradores(db, COLABORADORES, true);
const g = gets();
const h = heads();
verificar(
  "B1. toda página ordena por id ASC, pede no máximo 500 linhas e nunca usa OFFSET",
  g.every(
    (r) =>
      r.parametros.order === "id.asc" &&
      r.parametros.limit === "500" &&
      r.parametros.offset === undefined,
  ),
  true,
);
verificar(
  "B2. cursor por id: a primeira página sem cursor, as seguintes com id=gt.<último lido>",
  [g[0].parametros.id, g[1].parametros.id, g[2].parametros.id],
  [undefined, `gt.${idDe(500)}`, `gt.${idDe(1000)}`],
);
verificar("B3. 4 páginas (3 com dados + 1 vazia de confirmação)", g.length, 4);
verificar(
  "B4. o filtro por colaboradores e active=true vai em TODA página e em TODA contagem",
  [...g, ...h].every(
    (r) => r.parametros.employee_id === "in.(c1,c2,c3)" && r.parametros.active === "eq.true",
  ),
  true,
);
verificar(
  "B5. contagem exata antes e depois (2 HEAD com Prefer count=exact)",
  [h.length, h.every((r) => /count=exact/.test(r.prefer ?? ""))],
  [2, true],
);

reiniciar({ employee_cost_terms: custos(50, COLABORADORES) });
await lerCustosDosColaboradores(db, COLABORADORES, false);
verificar(
  "B6. histórico (somenteAtivas = false): sem filtro de active, em páginas e contagens",
  [...gets(), ...heads()].every((r) => r.parametros.active === undefined),
  true,
);

reiniciar({
  employee_cost_terms: [
    ...custos(20, ["c1", "c2"], { inativas: 5 }),
    { id: idDe(900), employee_id: "outro", active: true, daily_cost: 1, valid_from: "2026-01-01" },
  ],
});
const so = await lerCustosDosColaboradores(db, ["c1", "c2"], true);
verificar(
  "B7. o filtro vale: nada de outro colaborador nem de versão aposentada (15 ativas de 20 + 1 alheia)",
  [so.length, so.every((l) => ["c1", "c2"].includes(l.employee_id) && l.active)],
  [15, true],
);
const todas = await lerCustosDosColaboradores(db, ["c1", "c2"], false);
verificar(
  "B8. o histórico traz também as aposentadas (20), nunca as de outro colaborador",
  [todas.length, todas.every((l) => ["c1", "c2"].includes(l.employee_id))],
  [20, true],
);

reiniciar({ employee_cost_terms: custos(700, COLABORADORES) }, { maxRows: 100 });
const teto = await lerCustosDosColaboradores(db, COLABORADORES, true);
verificar(
  "B9. teto remoto menor que a página pedida (100 < 500): página curta não encerra a leitura",
  [teto.length, new Set(teto.map((l) => l.id)).size],
  [700, 700],
);

// ---------------------------------------------------------------------------
// C. Contrato e operação
// ---------------------------------------------------------------------------

console.log("\nC. Versões de contrato e de valor acordado");

const versoesContrato = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: idDe(i + 1),
    contract_id: i % 2 === 0 ? "k1" : "k2",
    active: true,
  }));
reiniciar({ contract_terms: versoesContrato(2200) });
const doContrato = await lerVersoesDoContrato(db, "k1", true);
verificar(
  "C1. contrato: lê todas as 1100 versões do contrato pedido, sem as do outro",
  [doContrato.length, doContrato.every((v) => v.contract_id === "k1")],
  [1100, true],
);
reiniciar({
  operation_terms: Array.from({ length: 1500 }, (_, i) => ({
    id: idDe(i + 1),
    operation_id: "o1",
    active: i % 3 !== 0,
  })),
});
const daOperacaoAtivas = await lerVersoesDaOperacao(db, "o1", true);
const daOperacaoTodas = await lerVersoesDaOperacao(db, "o1", false);
verificar(
  "C2. operação: 1000 ativas de 1500 (exatamente no teto) e o histórico completo de 1500",
  [daOperacaoAtivas.length, daOperacaoTodas.length],
  [1000, 1500],
);

// ---------------------------------------------------------------------------
// D. Falhas: nunca um resultado parcial tratado como válido
// ---------------------------------------------------------------------------

console.log("\nD. Falha de leitura nunca vira resultado parcial");

async function tentar(fn) {
  try {
    return { dados: await fn() };
  } catch (erro) {
    return { erro };
  }
}

reiniciar(
  { employee_cost_terms: custos(1500, COLABORADORES) },
  {
    interceptar: (r) =>
      r.metodo === "GET" && r.parametros.id === `gt.${idDe(500)}`
        ? Response.json({ message: "falha simulada na página 2" }, { status: 500 })
        : undefined,
  },
);
const d1 = await tentar(() => lerCustosDosColaboradores(db, COLABORADORES, true));
verificar(
  "D1. página 2 falha: a leitura REJEITA e não devolve as 500 linhas da página 1",
  [d1.dados, d1.erro instanceof Error],
  [undefined, true],
);

reiniciar(
  { employee_cost_terms: custos(1500, COLABORADORES) },
  {
    interceptar: (r) =>
      r.metodo === "HEAD"
        ? Response.json({ message: "falha simulada na contagem" }, { status: 500 })
        : undefined,
  },
);
const d2 = await tentar(() => lerCustosDosColaboradores(db, COLABORADORES, true));
verificar(
  "D2. contagem falha: rejeita (não 'confia' nas páginas sem poder conferi-las)",
  [d2.dados, d2.erro instanceof Error],
  [undefined, true],
);

reiniciar(
  { employee_cost_terms: custos(1500, COLABORADORES) },
  { contagemSobrescrita: () => 1499 },
);
const d3 = await tentar(() => lerCustosDosColaboradores(db, COLABORADORES, true));
verificar(
  "D3. contagem diverge das linhas lidas e persiste: ErroPaginacao, nunca parcial",
  [d3.dados, d3.erro instanceof ErroPaginacao],
  [undefined, true],
);

reiniciar(
  { employee_cost_terms: custos(10, COLABORADORES) },
  {
    interceptar: (r) =>
      r.metodo === "GET"
        ? Response.json({ message: "permissão negada" }, { status: 403 })
        : undefined,
  },
);
const d4 = await tentar(() => lerVersoesDoContrato(db, "k1", true));
verificar(
  "D4. erro de permissão na primeira página: rejeita; a tela mostra 'não foi possível consultar'",
  [d4.dados, d4.erro instanceof Error],
  [undefined, true],
);

// ---------------------------------------------------------------------------
// E. Forma do código
// ---------------------------------------------------------------------------

console.log("\nE. Forma do código");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const dados = ler("src/lib/vigencias-dados.ts");
const semComentarios = dados.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

verificar(
  "E1. os hooks e o histórico leem pelas funções paginadas",
  [
    /lerVersoesDoContrato\(cliente\(\), p\.contratoId as string, true\)/.test(dados),
    /lerVersoesDaOperacao\(cliente\(\), p\.operacaoId as string, true\)/.test(dados),
    /lerCustosDosColaboradores\(cliente\(\), p\.colaboradores, true\)/.test(dados),
    /lerCustosDosColaboradores\(db, \[id\], false\)/.test(dados),
  ],
  [true, true, true, true],
);
verificar(
  "E2. nenhuma leitura de versões fora dessas funções (todo from() de versões está dentro de lerConsultaPaginada)",
  (semComentarios.match(/\.from\("(contract_terms|operation_terms|employee_cost_terms)"\)/g) ?? [])
    .length,
  6,
);
verificar(
  "E3. as funções paginadas ordenam por id e usam o cursor id > último lido",
  (semComentarios.match(/q\.gt\("id", depoisDe\)/g) ?? []).length === 3 &&
    (semComentarios.match(/order\("id", \{ ascending: true \}\)/g) ?? []).length === 3,
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
