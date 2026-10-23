/**
 * Testes de integração dos nove hooks de `src/lib/queries.ts` com o paginador.
 *
 * COMO RODAR:
 *
 *   npm run test:queries-paginacao
 *
 * O QUE É REAL E O QUE É SIMULADO
 *   - REAL: os hooks de `queries.ts`, o React Query, o cliente `supabase-js`
 *     (via `criarClienteNavegador`) e o adaptador de `paginacao.ts`. Os hooks são
 *     executados dentro de um `renderToString`, e a `queryFn` de cada um roda
 *     pelo cache do React Query.
 *   - SIMULADO: apenas o transporte. `globalThis.fetch` é trocado por um servidor
 *     PostgREST em memória que entende `id=gt.<cursor>`, `order`, `limit`, o
 *     `HEAD` de contagem exata e um teto remoto (`max_rows`). Assim a URL que o
 *     `supabase-js` de fato monta é a que os testes inspecionam, em vez de
 *     procurar texto no código.
 *
 * Nada acessa rede nem o Supabase de Production: o domínio é `.invalid` e a
 * chave é inerte.
 */

import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Resolve `@/...` e imports relativos sem extensão, só para esta suíte (as
// outras usam `scripts/_resolver-ts.mjs`, que não trata o alias `@/`).
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

const React = (await import("react")).default;
const { renderToString } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const Q = await import("../src/lib/queries.ts");
const { ErroPaginacao, ordenarApresentacao } = await import("../src/lib/paginacao.ts");

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${esperado}, obtido ${obtido}`);
    console.log(`  FAIL  ${caso} — esperado ${esperado}, obtido ${obtido}`);
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
  /** (req) => Response | undefined: intercepta a requisição antes do tratamento normal. */
  interceptar: null,
  /** (tabela, estado) chamado a cada GET, para simular escrita concorrente. */
  aoGet: null,
  contagemSobrescrita: null,
};

function reiniciar(tabelas, opcoes = {}) {
  servidor.tabelas = tabelas;
  servidor.maxRows = opcoes.maxRows ?? 1000;
  servidor.requisicoes = [];
  servidor.interceptar = opcoes.interceptar ?? null;
  servidor.aoGet = opcoes.aoGet ?? null;
  servidor.contagemSobrescrita = opcoes.contagemSobrescrita ?? null;
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
    range: req.headers.get("range"),
  };
  servidor.requisicoes.push(registro);

  if (servidor.interceptar) {
    const resposta = servidor.interceptar(registro);
    if (resposta) return resposta;
  }

  const linhas = servidor.tabelas[tabela];
  if (!linhas) return Response.json({ message: `tabela ${tabela} inexistente` }, { status: 404 });

  if (req.method === "HEAD") {
    const total = servidor.contagemSobrescrita
      ? servidor.contagemSobrescrita(tabela)
      : linhas.length;
    return new Response(null, { status: 200, headers: { "content-range": `*/${total}` } });
  }

  if (servidor.aoGet) servidor.aoGet(tabela, linhas);
  let resultado = [...linhas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const filtro = registro.parametros.id;
  if (filtro?.startsWith("gt.")) resultado = resultado.filter((l) => l.id > filtro.slice(3));
  const limite = Number(registro.parametros.limit ?? Infinity);
  resultado = resultado.slice(0, Math.min(limite, servidor.maxRows));
  return Response.json(resultado, { status: 200 });
};

// ---------------------------------------------------------------------------
// Os nove hooks: chave, tabela e dados sintéticos
// ---------------------------------------------------------------------------

const HOOKS = [
  { hook: "useClients", chave: ["clients"], tabela: "clients" },
  { hook: "useContracts", chave: ["contracts"], tabela: "contracts" },
  { hook: "useEmployees", chave: ["employees"], tabela: "employees" },
  { hook: "useOperations", chave: ["operations"], tabela: "operations" },
  { hook: "useShifts", chave: ["shifts"], tabela: "shifts" },
  { hook: "useTeam", chave: ["operation_team"], tabela: "operation_team" },
  { hook: "useTimesheets", chave: ["timesheets"], tabela: "timesheets" },
  { hook: "useEntries", chave: ["timesheet_entries"], tabela: "timesheet_entries" },
  { hook: "useInvoices", chave: ["invoices"], tabela: "invoices" },
];

function sinteticas(total) {
  return Array.from({ length: total }, (_, i) => ({
    id: idDe(i + 1),
    name: `Nome ${String(i + 1).padStart(5, "0")}`,
    created_at: "2026-10-01T12:00:00.000000+00:00", // repetido de propósito
    start_time: "08:00:00",
    work_date: "2026-10-01",
    period_start: "2026-10-01",
    valor: i + 1,
  }));
}

/** Registra o hook no cache do React Query (via renderToString) e devolve a Query. */
function consultaDoHook(nomeDoHook, chave) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Componente() {
    Q[nomeDoHook]();
    return null;
  }
  renderToString(
    React.createElement(QueryClientProvider, { client: cliente }, React.createElement(Componente)),
  );
  const consulta = cliente.getQueryCache().find({ queryKey: chave, exact: true });
  return { cliente, consulta };
}

async function lerPeloHook({ hook, chave }) {
  const { cliente, consulta } = consultaDoHook(hook, chave);
  try {
    return { dados: await consulta.fetch(), consulta, cliente };
  } catch (erro) {
    return { erro, consulta, cliente };
  }
}

const gets = () => servidor.requisicoes.filter((r) => r.metodo === "GET");
const heads = () => servidor.requisicoes.filter((r) => r.metodo === "HEAD");

console.log("\nA. Os nove hooks: chave preservada, paginação acima de 1000 e filtros reais\n");

for (const alvo of HOOKS) {
  reiniciar({ [alvo.tabela]: sinteticas(2501) });
  const { consulta } = consultaDoHook(alvo.hook, alvo.chave);
  verificar(
    `A-${alvo.hook}-1. query key preservada: ${JSON.stringify(alvo.chave)}`,
    String(consulta !== undefined),
    "true",
  );
  const dados = await consulta.fetch();
  verificar(
    `A-${alvo.hook}-2. lê os 2501 registros (acima do max_rows de 1000)`,
    String(dados.length),
    "2501",
  );
  verificar(
    `A-${alvo.hook}-3. sem duplicata e sem perda`,
    String(
      new Set(dados.map((d) => d.id)).size === 2501 &&
        dados.reduce((s, d) => s + d.valor, 0) === (2501 * 2502) / 2,
    ),
    "true",
  );
  const g = gets();
  verificar(
    `A-${alvo.hook}-4. só requisições à tabela ${alvo.tabela}`,
    String(servidor.requisicoes.every((r) => r.tabela === alvo.tabela)),
    "true",
  );
  verificar(
    `A-${alvo.hook}-5. 7 páginas (6 com dados + 1 vazia de confirmação)`,
    String(g.length),
    "7",
  );
  verificar(
    `A-${alvo.hook}-6. toda página ordena por id ASC`,
    String(g.every((r) => r.parametros.order === "id.asc")),
    "true",
  );
  verificar(
    `A-${alvo.hook}-7. página de 500 (limit=500), nunca acima do max_rows`,
    String(g.every((r) => r.parametros.limit === "500")),
    "true",
  );
  verificar(
    `A-${alvo.hook}-8. primeira página sem filtro de cursor`,
    String(g[0].parametros.id === undefined),
    "true",
  );
  const cursoresEsperados = [1, 2, 3, 4, 5, 6].map((k) => `gt.${idDe(Math.min(k * 500, 2501))}`);
  verificar(
    `A-${alvo.hook}-9. cursor = id do último registro lido (id=gt.<último>)`,
    JSON.stringify(g.slice(1).map((r) => r.parametros.id)),
    JSON.stringify(cursoresEsperados),
  );
  verificar(
    `A-${alvo.hook}-10. sem OFFSET nem cabeçalho Range`,
    String(g.every((r) => r.parametros.offset === undefined && !r.range)),
    "true",
  );
  verificar(
    `A-${alvo.hook}-11. contagem exata antes e depois (2 HEAD, Prefer count=exact)`,
    String(heads().length === 2 && heads().every((h) => /count=exact/.test(h.prefer ?? ""))),
    "true",
  );
}

console.log("\nB. Tamanhos de conjunto pelos hooks\n");

for (const total of [0, 1, 999, 1000, 1001]) {
  reiniciar({ employees: sinteticas(total) });
  const r = await lerPeloHook(HOOKS[2]);
  verificar(
    `B-${total}. useEmployees com ${total} registros lê ${total}`,
    String(r.dados?.length),
    String(total),
  );
}

console.log("\nC. Ordem de apresentação preservada (independe da ordem de leitura por id)\n");

// Ordem real do PostgreSQL (en_US.UTF-8), obtida no Postgres local para estes nomes.
const NOMES_NA_ORDEM_DO_BANCO = [
  "_x",
  "1 Cliente",
  "10 Cliente",
  "2 Cliente",
  "alvaro",
  "Alvaro",
  "Álvaro",
  "ana",
  "Ana",
  "Ana Maria",
  "Ana-Maria",
  "angela",
  "Ângela",
  "Árvore",
  "Carlos",
  "Çarlos",
  "Cesar",
  "Cézar",
  "d'avila",
  "D'Ávila",
  "DAvila",
  "Eder",
  "Éder",
  "ÉDER",
  "Joao  Silva",
  "João da Silva",
  "João Silva",
  "joão-silva",
  "maria",
  "Maria",
  "MARIA",
  "O.K.",
  "OK",
  "Otavio",
  "Ótimo",
  "Transporte",
  "Transportes & Cia",
  "Transportes Ltda",
  "ze",
  "Zé",
  "Zulu",
];

function embaralhado(lista) {
  // determinístico: permutação fixa por passo coprimo
  const n = lista.length;
  return Array.from({ length: n }, (_, i) => lista[(i * 17 + 5) % n]);
}

for (const alvo of [HOOKS[0], HOOKS[2]]) {
  const linhasDeNome = embaralhado(NOMES_NA_ORDEM_DO_BANCO).map((nome, i) => ({
    id: idDe(i + 1),
    name: nome,
  }));
  reiniciar({ [alvo.tabela]: linhasDeNome });
  const r = await lerPeloHook(alvo);
  verificar(
    `C-${alvo.hook}-1. nomes (acentos, caixa, hífen, apóstrofo, números) na ordem do banco`,
    JSON.stringify(r.dados.map((d) => d.name)),
    JSON.stringify(NOMES_NA_ORDEM_DO_BANCO),
  );
}
{
  // nomes iguais: desempate por id crescente
  reiniciar({
    clients: [
      { id: idDe(3), name: "Igual" },
      { id: idDe(1), name: "Igual" },
      { id: idDe(2), name: "Igual" },
    ],
  });
  const r = await lerPeloHook(HOOKS[0]);
  verificar(
    "C-desempate. nomes iguais saem por id crescente",
    JSON.stringify(r.dados.map((d) => d.id)),
    JSON.stringify([idDe(1), idDe(2), idDe(3)]),
  );
}
{
  // created_at DESC com microssegundos, fração de tamanhos diferentes e fusos equivalentes
  const instantes = [
    { id: idDe(1), created_at: "2026-10-01T12:00:00.1+00:00" },
    { id: idDe(2), created_at: "2026-10-01T12:00:00.123456+00:00" },
    { id: idDe(3), created_at: "2026-10-01T12:00:00.123457+00:00" },
    { id: idDe(4), created_at: "2026-10-01T09:00:00.2-03:00" },
    { id: idDe(5), created_at: "2026-10-01T12:00:00+00:00" },
    { id: idDe(6), created_at: "2026-10-02T00:00:00+00:00" },
  ];
  // do mais recente ao mais antigo: 6 (10-02), 4 (12:00:00.2Z), 3 (.123457), 2 (.123456), 1 (.1), 5 (.0)
  reiniciar({ contracts: instantes, operations: instantes });
  const desc = [idDe(6), idDe(4), idDe(3), idDe(2), idDe(1), idDe(5)];
  const c = await lerPeloHook(HOOKS[1]);
  verificar(
    "C-contracts. created_at DESC com microssegundos e fusos",
    JSON.stringify(c.dados.map((d) => d.id)),
    JSON.stringify(desc),
  );
  const o = await lerPeloHook(HOOKS[3]);
  verificar(
    "C-operations. created_at DESC com microssegundos e fusos",
    JSON.stringify(o.dados.map((d) => d.id)),
    JSON.stringify(desc),
  );
  reiniciar({ operation_team: instantes, timesheet_entries: instantes });
  const asc = [...desc].reverse();
  const t = await lerPeloHook(HOOKS[5]);
  verificar(
    "C-operation_team. created_at ASC",
    JSON.stringify(t.dados.map((d) => d.id)),
    JSON.stringify(asc),
  );
  const e = await lerPeloHook(HOOKS[7]);
  verificar(
    "C-timesheet_entries. created_at ASC",
    JSON.stringify(e.dados.map((d) => d.id)),
    JSON.stringify(asc),
  );
}
{
  reiniciar({
    shifts: [
      { id: idDe(1), start_time: "22:00:00" },
      { id: idDe(2), start_time: "06:30:00" },
      { id: idDe(3), start_time: "14:00:00" },
      { id: idDe(4), start_time: "06:30:00" },
    ],
    timesheets: [
      { id: idDe(1), work_date: "2026-10-01" },
      { id: idDe(2), work_date: "2026-12-31" },
      { id: idDe(3), work_date: "2026-01-15" },
    ],
    invoices: [
      { id: idDe(1), period_start: "2026-09-16" },
      { id: idDe(2), period_start: "2026-10-01" },
      { id: idDe(3), period_start: "2026-09-01" },
    ],
  });
  const s = await lerPeloHook(HOOKS[4]);
  verificar(
    "C-shifts. start_time ASC, empate por id",
    JSON.stringify(s.dados.map((d) => d.id)),
    JSON.stringify([idDe(2), idDe(4), idDe(3), idDe(1)]),
  );
  const ts = await lerPeloHook(HOOKS[6]);
  verificar(
    "C-timesheets. work_date DESC",
    JSON.stringify(ts.dados.map((d) => d.id)),
    JSON.stringify([idDe(2), idDe(1), idDe(3)]),
  );
  const inv = await lerPeloHook(HOOKS[8]);
  verificar(
    "C-invoices. period_start DESC",
    JSON.stringify(inv.dados.map((d) => d.id)),
    JSON.stringify([idDe(2), idDe(1), idDe(3)]),
  );
}
{
  // NULLS: como o PostgreSQL (ASC -> nulos por último; DESC -> nulos por primeiro)
  const base = [
    { id: idDe(1), v: null },
    { id: idDe(2), v: "b" },
    { id: idDe(3), v: "a" },
    { id: idDe(4), v: null },
  ];
  const asc = ordenarApresentacao(base, [{ coluna: "v", tipo: "texto", ascendente: true }]).map(
    (l) => l.id,
  );
  const desc = ordenarApresentacao(base, [{ coluna: "v", tipo: "texto", ascendente: false }]).map(
    (l) => l.id,
  );
  verificar(
    "C-nulos-asc. NULL por último em ordem crescente",
    JSON.stringify(asc),
    JSON.stringify([idDe(3), idDe(2), idDe(1), idDe(4)]),
  );
  verificar(
    "C-nulos-desc. NULL por primeiro em ordem decrescente",
    JSON.stringify(desc),
    JSON.stringify([idDe(1), idDe(4), idDe(2), idDe(3)]),
  );
}

console.log("\nD. Erros: nunca resultado parcial\n");

{
  reiniciar(
    { clients: sinteticas(2501) },
    {
      interceptar: (r) =>
        r.metodo === "GET"
          ? Response.json({ message: "PGRST000 banco indisponível" }, { status: 503 })
          : undefined,
    },
  );
  const r = await lerPeloHook(HOOKS[0]);
  verificar(
    "D1. erro do PostgREST na primeira página -> ErroPaginacao PAGINA_FALHOU",
    `${r.erro instanceof ErroPaginacao}:${r.erro?.codigo}`,
    "true:PAGINA_FALHOU",
  );
  verificar(
    "D2. a mensagem do PostgREST fica na causa",
    String(/banco indisponível/.test(r.erro?.cause?.message ?? "")),
    "true",
  );
  verificar(
    "D3. a query fica em erro, sem dado (nada parcial no cache)",
    `${r.consulta.state.status}:${r.consulta.state.data}`,
    "error:undefined",
  );
}
{
  let get = 0;
  reiniciar(
    { employees: sinteticas(2501) },
    {
      interceptar: (r) =>
        r.metodo === "GET" && ++get === 3
          ? Response.json({ message: "queda no meio" }, { status: 500 })
          : undefined,
    },
  );
  const r = await lerPeloHook(HOOKS[2]);
  verificar("D4. falha na 3ª página -> PAGINA_FALHOU", r.erro?.codigo, "PAGINA_FALHOU");
  verificar(
    "D5. nenhum dado das páginas 1 e 2 chega à tela",
    `${r.consulta.state.status}:${r.consulta.state.data}`,
    "error:undefined",
  );
  verificar("D6. não segue lendo depois da falha", String(gets().length), "3");
}
{
  reiniciar(
    { clients: sinteticas(10) },
    {
      interceptar: (r) =>
        r.metodo === "HEAD"
          ? Response.json({ message: "sem permissão" }, { status: 403 })
          : undefined,
    },
  );
  const r = await lerPeloHook(HOOKS[0]);
  verificar("D7. erro na contagem -> CONTAGEM_FALHOU", r.erro?.codigo, "CONTAGEM_FALHOU");
}
{
  // Resposta de contagem sem content-range: contagem ausente não é sucesso.
  reiniciar(
    { clients: sinteticas(10) },
    {
      interceptar: (r) => (r.metodo === "HEAD" ? new Response(null, { status: 200 }) : undefined),
    },
  );
  const r = await lerPeloHook(HOOKS[0]);
  verificar("D8. contagem ausente -> CONTAGEM_INVALIDA", r.erro?.codigo, "CONTAGEM_INVALIDA");
}
{
  // Contagem inválida (texto)
  reiniciar(
    { clients: sinteticas(10) },
    {
      interceptar: (r) =>
        r.metodo === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-range": "*/abc" } })
          : undefined,
    },
  );
  const r = await lerPeloHook(HOOKS[0]);
  verificar(
    "D9. contagem inválida -> não é sucesso",
    String(r.erro instanceof ErroPaginacao),
    "true",
  );
}
{
  // Corte silencioso (o defeito original): o servidor responde 1000 e diz que há 2501.
  reiniciar(
    { timesheet_entries: sinteticas(2501) },
    {
      interceptar: (r) => {
        if (r.metodo !== "GET") return undefined;
        const cursor = r.parametros.id?.slice(3);
        const restantes = servidor.tabelas.timesheet_entries
          .filter((l) => !cursor || l.id > cursor)
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        const corte = restantes.filter((l) => l.valor <= 1000).slice(0, 500);
        return Response.json(corte, { status: 200 });
      },
    },
  );
  const r = await lerPeloHook(HOOKS[7]);
  verificar(
    "D10. corte silencioso em 1000 contra contagem 2501 -> CONTAGEM_DIVERGENTE",
    r.erro?.codigo,
    "CONTAGEM_DIVERGENTE",
  );
  verificar(
    "D11. a causa registra lido=1000 e contagem=2501",
    `${r.erro?.detalhes?.lidas}/${r.erro?.detalhes?.contagemDepois}`,
    "1000/2501",
  );
  verificar("D12. a releitura foi feita uma única vez", String(r.erro?.detalhes?.tentativas), "2");
}
{
  // Escrita concorrente em toda leitura, com id MENOR que o cursor (a leitura não a alcança):
  // a contagem denuncia, a releitura também diverge e o erro é explícito.
  let n = 0;
  reiniciar(
    { invoices: sinteticas(1200) },
    {
      aoGet: (_t, linhas) =>
        linhas.push({
          id: `00000000-0000-4000-0000-${String(n++).padStart(12, "0")}`,
          period_start: "2026-10-01",
        }),
    },
  );
  const r = await lerPeloHook(HOOKS[8]);
  verificar(
    "D13. divergência persistente -> CONTAGEM_DIVERGENTE, sem dados",
    `${r.erro?.codigo}:${r.consulta.state.data}`,
    "CONTAGEM_DIVERGENTE:undefined",
  );
}
{
  // Inserções SEMPRE no fim, a cada página: a leitura nunca alcança o fim. O limite de páginas encerra.
  let n = 0;
  reiniciar(
    { invoices: sinteticas(1200) },
    {
      aoGet: (_t, linhas) => linhas.push({ id: idDe(100000 + n++), period_start: "2026-10-01" }),
    },
  );
  const r = await lerPeloHook(HOOKS[8]);
  verificar(
    "D13b. escrita perseguindo o fim da leitura -> LIMITE_PAGINAS (sem laço infinito)",
    `${r.erro?.codigo}:${r.consulta.state.data}`,
    "LIMITE_PAGINAS:undefined",
  );
}
{
  // Escrita concorrente só na primeira leitura: a releitura resolve
  let feito = false;
  reiniciar(
    { invoices: sinteticas(1200) },
    {
      aoGet: (_t, linhas) => {
        if (!feito) {
          feito = true;
          linhas.push({ id: idDe(100000), period_start: "2026-10-01" });
        }
      },
    },
  );
  const r = await lerPeloHook(HOOKS[8]);
  verificar(
    "D14. divergência transitória: releitura devolve o conjunto atual",
    String(r.dados?.length),
    "1201",
  );
}
{
  // IDs repetidos entre páginas (servidor ignora o cursor)
  reiniciar(
    { clients: sinteticas(1500) },
    {
      interceptar: (r) => {
        if (r.metodo !== "GET") return undefined;
        return Response.json(servidor.tabelas.clients.slice(0, 500), { status: 200 });
      },
    },
  );
  const r = await lerPeloHook(HOOKS[0]);
  verificar(
    "D15. página repetida (ids repetidos) -> CURSOR_SEM_AVANCO",
    r.erro?.codigo,
    "CURSOR_SEM_AVANCO",
  );
}
{
  // Corpo nulo (página ausente)
  reiniciar(
    { clients: sinteticas(5) },
    {
      interceptar: (r) =>
        r.metodo === "GET"
          ? new Response("null", { status: 200, headers: { "content-type": "application/json" } })
          : undefined,
    },
  );
  const r = await lerPeloHook(HOOKS[0]);
  verificar(
    "D16. página ausente (corpo nulo) -> RESPOSTA_INVALIDA",
    r.erro?.codigo,
    "RESPOSTA_INVALIDA",
  );
}

console.log("\nE. Limite remoto menor que o pedido e conjunto vazio\n");

for (const maxRows of [300, 100]) {
  reiniciar({ operations: sinteticas(1001) }, { maxRows });
  const r = await lerPeloHook(HOOKS[3]);
  verificar(
    `E-${maxRows}. max_rows=${maxRows} (menor que 500): lê as 1001`,
    String(r.dados?.length),
    "1001",
  );
}
{
  reiniciar({ shifts: [] });
  const r = await lerPeloHook(HOOKS[4]);
  verificar("E-vazio-1. conjunto vazio -> lista vazia", String(r.dados?.length), "0");
  verificar("E-vazio-2. com 1 GET e 2 contagens", `${gets().length}/${heads().length}`, "1/2");
}

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
