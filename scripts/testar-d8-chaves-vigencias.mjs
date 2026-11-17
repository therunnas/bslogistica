/**
 * D8 (Gate C, sessão 31) — chaves de cache das vigências: o histórico (todas as versões, inclusive
 * as aposentadas) e a prévia do apontamento (só as ativas) não podem dividir a mesma entrada.
 *
 * COMO RODAR:
 *
 *   npm run test:d8-chaves-vigencias
 *
 * O DEFEITO. `useVersoes` (histórico e "valor atual" de contrato, operação e colaborador) lê
 * TODAS as versões; `useTermosDoApontamento` (prévia do apontamento) lê só as ATIVAS. As duas
 * usavam a chave `["vigencias", "contrato" | "operacao", id]`: quem abria uma tela primeiro
 * decidia o que a outra recebia do cache. Depois do histórico, a prévia recebia versões
 * aposentadas; depois do apontamento, o histórico perdia as aposentadas.
 *
 * O QUE É REAL E O QUE É SIMULADO
 *   - REAL: os hooks de `src/lib/vigencias-dados.ts`, o paginador, o cliente `supabase-js`, um
 *     `QueryClient` do TanStack Query e `resolverCondicaoDoDia` (a prévia da tela).
 *   - SIMULADO: só o transporte (`globalThis.fetch` vira um PostgREST em memória). Os hooks são
 *     executados com `renderToString` (sem DOM); as consultas que eles registram no cache são
 *     executadas com `query.fetch()`, que usa a `queryFn` que o próprio hook registrou.
 *
 * Nada acessa rede, HML ou Production: o domínio é `.invalid` e a chave é inerte.
 */

import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

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

let passou = 0;
const falhas = [];
function verificar(caso, ok, detalhe = "") {
  if (ok) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso}${detalhe ? ` — ${detalhe}` : ""}`);
    console.log(`  FAIL  ${caso}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// PostgREST simulado (só o transporte): eq, in, gt, limit e HEAD de contagem
// ---------------------------------------------------------------------------

const idDe = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const CONTRATO = idDe(1);
const OPERACAO = idDe(2);
const COLABORADOR = idDe(3);
const base = (n, ativa, criada) => ({
  id: idDe(100 + n),
  valid_from: "2026-11-01",
  valid_to: null,
  active: ativa,
  origin: ativa ? "correcao" : "informada",
  reason: ativa ? "Alteração das condições pela tela" : "Cadastro inicial",
  created_at: criada,
  retired_at: ativa ? null : "2026-11-02T10:00:00+00:00",
});
// Uma versão aposentada (substituída por correção na mesma data) e a ativa que a substituiu.
const APOSENTADA_CONTRATO = {
  ...base(1, false, "2026-11-01T10:00:00+00:00"),
  contract_id: CONTRATO,
  daily_rate: 240,
  shift_hours: 8,
  ot_factor: 1.5,
  ot_tolerance_min: 10,
};
const ATIVA_CONTRATO = {
  ...base(2, true, "2026-11-02T10:00:00+00:00"),
  contract_id: CONTRATO,
  daily_rate: 250,
  shift_hours: 8,
  ot_factor: 1.5,
  ot_tolerance_min: 10,
};
const APOSENTADA_OPERACAO = {
  ...base(3, false, "2026-11-01T10:00:00+00:00"),
  operation_id: OPERACAO,
  agreed_amount: 190,
};
const ATIVA_OPERACAO = {
  ...base(4, true, "2026-11-02T10:00:00+00:00"),
  operation_id: OPERACAO,
  agreed_amount: 200,
};
const APOSENTADA_CUSTO = {
  ...base(5, false, "2026-11-01T10:00:00+00:00"),
  employee_id: COLABORADOR,
  daily_cost: 140,
};
const ATIVA_CUSTO = {
  ...base(6, true, "2026-11-02T10:00:00+00:00"),
  employee_id: COLABORADOR,
  daily_cost: 150,
};

const TABELAS = {
  contract_terms: [APOSENTADA_CONTRATO, ATIVA_CONTRATO],
  operation_terms: [APOSENTADA_OPERACAO, ATIVA_OPERACAO],
  employee_cost_terms: [APOSENTADA_CUSTO, ATIVA_CUSTO],
};

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
  if (url.hostname !== "pg-simulado.invalid")
    throw new Error(`rede proibida nesta suíte: ${url.host}`);
  const tabela = url.pathname.replace(/^\/rest\/v1\//, "");
  const linhas = TABELAS[tabela];
  if (!linhas) return Response.json({ message: `tabela ${tabela} inexistente` }, { status: 404 });
  const doFiltro = filtrar(linhas, Object.fromEntries(url.searchParams.entries()));
  if (req.method === "HEAD")
    return new Response(null, {
      status: 200,
      headers: { "content-range": `*/${doFiltro.length}` },
    });
  const ordenadas = [...doFiltro].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const limite = Number(url.searchParams.get("limit") ?? Infinity);
  return Response.json(ordenadas.slice(0, limite), { status: 200 });
};

// ---------------------------------------------------------------------------
// Hooks reais num QueryClient real
// ---------------------------------------------------------------------------

const React = (await import("react")).default;
const { renderToString } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const V = await import("../src/lib/vigencias-dados.ts");
const { resolverCondicaoDoDia } = await import("../src/lib/vigencias-ui.ts");

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Executa o hook como a tela faria num render e devolve o que ele retornou. */
function usar(cliente, hook) {
  let resultado;
  function Sonda() {
    resultado = hook();
    return null;
  }
  renderToString(
    React.createElement(QueryClientProvider, { client: cliente }, React.createElement(Sonda)),
  );
  return resultado;
}

/** Executa as consultas que os hooks registraram e ainda não têm resposta (o "efeito" do mount). */
async function responder(cliente) {
  for (const consulta of cliente.getQueryCache().getAll()) {
    if (consulta.state.status === "pending" && consulta.options.queryFn) await consulta.fetch();
  }
}

const historico = (tipo, id) => () => V.useVersoes(tipo, id);
const apontamento = (p) => () =>
  V.useTermosDoApontamento({
    habilitado: true,
    contratoId: null,
    operacaoId: null,
    colaboradores: [],
    ...p,
  });
const ids = (lista) => (lista ?? []).map((v) => v.id).sort();

/** Abre a tela A, espera responder, abre a tela B: o que B recebe ANTES da própria resposta. */
async function alternar(telaA, telaB) {
  const cliente = novoCliente();
  usar(cliente, telaA);
  await responder(cliente);
  const antes = usar(cliente, telaB);
  await responder(cliente);
  const depois = usar(cliente, telaB);
  return { cliente, antes, depois };
}

/** Tela B aberta direto, sem nada no cache: a referência do comportamento correto. */
async function direto(tela) {
  const cliente = novoCliente();
  usar(cliente, tela);
  await responder(cliente);
  return usar(cliente, tela);
}

const todasContrato = [APOSENTADA_CONTRATO.id, ATIVA_CONTRATO.id].sort();
const todasOperacao = [APOSENTADA_OPERACAO.id, ATIVA_OPERACAO.id].sort();

console.log("\nA/G. Histórico aberto direto mostra todas as versões, inclusive as aposentadas");
{
  const c = await direto(historico("contrato", CONTRATO));
  verificar(
    "A1. contrato: 2 versões (ativa + aposentada)",
    isDeepStrictEqual(ids(c.data), todasContrato),
    JSON.stringify(ids(c.data)),
  );
  const o = await direto(historico("operacao", OPERACAO));
  verificar(
    "A2. operação: 2 versões (ativa + aposentada)",
    isDeepStrictEqual(ids(o.data), todasOperacao),
    JSON.stringify(ids(o.data)),
  );
}

console.log("\nB. Prévia do apontamento aberta direto recebe só as ativas");
{
  const r = await direto(apontamento({ contratoId: CONTRATO }));
  verificar(
    "B1. contrato: só a ativa",
    isDeepStrictEqual(ids(r.termosContrato), [ATIVA_CONTRATO.id]),
    JSON.stringify(ids(r.termosContrato)),
  );
  const o = await direto(apontamento({ operacaoId: OPERACAO }));
  verificar(
    "B2. operação: só a ativa",
    isDeepStrictEqual(ids(o.termosOperacao), [ATIVA_OPERACAO.id]),
    JSON.stringify(ids(o.termosOperacao)),
  );
}

console.log("\nC/E. Contrato: alternância entre o histórico e o apontamento");
{
  const h2a = await alternar(
    historico("contrato", CONTRATO),
    apontamento({ contratoId: CONTRATO }),
  );
  verificar(
    "C1. histórico → apontamento: a prévia NÃO recebe a versão aposentada do cache do histórico",
    !ids(h2a.antes.termosContrato).includes(APOSENTADA_CONTRATO.id),
    `recebeu ${JSON.stringify(ids(h2a.antes.termosContrato))}`,
  );
  verificar(
    "C2. histórico → apontamento: depois da resposta, só a ativa",
    isDeepStrictEqual(ids(h2a.depois.termosContrato), [ATIVA_CONTRATO.id]),
    JSON.stringify(ids(h2a.depois.termosContrato)),
  );
  const a2h = await alternar(
    apontamento({ contratoId: CONTRATO }),
    historico("contrato", CONTRATO),
  );
  verificar(
    "C3. apontamento → histórico: o histórico NÃO recebe a lista parcial (sem aposentadas) do apontamento",
    a2h.antes.data === undefined || isDeepStrictEqual(ids(a2h.antes.data), todasContrato),
    `recebeu ${JSON.stringify(ids(a2h.antes.data))}`,
  );
  verificar(
    "C4. apontamento → histórico: depois da resposta, ativa + aposentada",
    isDeepStrictEqual(ids(a2h.depois.data), todasContrato),
    JSON.stringify(ids(a2h.depois.data)),
  );
}

console.log("\nD/E. Operação: alternância entre o histórico e o apontamento");
{
  const h2a = await alternar(
    historico("operacao", OPERACAO),
    apontamento({ operacaoId: OPERACAO }),
  );
  verificar(
    "D1. histórico → apontamento: a prévia NÃO recebe a versão aposentada",
    !ids(h2a.antes.termosOperacao).includes(APOSENTADA_OPERACAO.id),
    `recebeu ${JSON.stringify(ids(h2a.antes.termosOperacao))}`,
  );
  verificar(
    "D2. depois da resposta, só a ativa",
    isDeepStrictEqual(ids(h2a.depois.termosOperacao), [ATIVA_OPERACAO.id]),
  );
  const a2h = await alternar(
    apontamento({ operacaoId: OPERACAO }),
    historico("operacao", OPERACAO),
  );
  verificar(
    "D3. apontamento → histórico: o histórico NÃO recebe a lista parcial",
    a2h.antes.data === undefined || isDeepStrictEqual(ids(a2h.antes.data), todasOperacao),
    `recebeu ${JSON.stringify(ids(a2h.antes.data))}`,
  );
  verificar(
    "D4. depois da resposta, ativa + aposentada",
    isDeepStrictEqual(ids(a2h.depois.data), todasOperacao),
  );
}

console.log("\nControle. Colaborador: histórico e custos da prévia já tinham chaves distintas");
{
  const h2a = await alternar(
    historico("colaborador", COLABORADOR),
    apontamento({ colaboradores: [COLABORADOR] }),
  );
  verificar(
    "K1. histórico do colaborador → apontamento: custos só ativos",
    isDeepStrictEqual(ids(h2a.antes.termosCusto), []) ||
      isDeepStrictEqual(ids(h2a.antes.termosCusto), [ATIVA_CUSTO.id]),
    JSON.stringify(ids(h2a.antes.termosCusto)),
  );
  verificar(
    "K2. depois da resposta, só o custo ativo",
    isDeepStrictEqual(ids(h2a.depois.termosCusto), [ATIVA_CUSTO.id]),
  );
}

console.log("\nE. Identidade das entradas: mesmo cliente, as duas telas abertas");
{
  const cliente = novoCliente();
  usar(cliente, historico("contrato", CONTRATO));
  usar(cliente, historico("operacao", OPERACAO));
  usar(cliente, apontamento({ contratoId: CONTRATO, operacaoId: OPERACAO }));
  // A consulta de custos da prévia (sem colaborador, desabilitada) também entra no cache; ela já
  // tinha chave própria e fica fora desta contagem.
  const hashes = cliente
    .getQueryCache()
    .getAll()
    .filter((q) => q.queryKey[1] !== "custos")
    .map((q) => q.queryHash);
  verificar(
    "E1. 4 consultas de versões distintas no cache (2 históricos + 2 da prévia)",
    hashes.length === 4 && new Set(hashes).size === 4,
    JSON.stringify(hashes),
  );
}

console.log("\nF. Invalidação depois de alterar uma vigência alcança as duas entradas");
{
  const cliente = novoCliente();
  usar(cliente, historico("contrato", CONTRATO));
  usar(cliente, apontamento({ contratoId: CONTRATO, operacaoId: OPERACAO }));
  usar(cliente, historico("operacao", OPERACAO));
  await responder(cliente);
  // Toda escrita de vigência invalida pelo prefixo ["vigencias"] (invalidarVigencias, tarifas,
  // diária individual, motor): é ela que as telas usam depois de "Alterar".
  await cliente.invalidateQueries({ queryKey: ["vigencias"] });
  const doPrefixo = cliente.getQueryCache().findAll({ queryKey: ["vigencias"] });
  verificar(
    "F1. o prefixo ['vigencias'] cobre todas as entradas, inclusive as 4 de versões",
    doPrefixo.length === cliente.getQueryCache().getAll().length &&
      doPrefixo.filter((q) => q.queryKey[1] !== "custos").length === 4,
    JSON.stringify(doPrefixo.map((q) => q.queryHash)),
  );
  verificar(
    "F2. todas ficam invalidadas",
    doPrefixo.every((q) => q.state.isInvalidated),
  );
  const fonte = (arquivo) => readFileSync(path.join(RAIZ, arquivo), "utf8");
  const arquivos = [];
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) varrer(p);
      else if (/\.(ts|tsx)$/.test(nome)) arquivos.push(path.relative(RAIZ, p));
    }
  };
  varrer(path.join(RAIZ, "src"));
  const especificas = arquivos.flatMap((a) =>
    [
      ...fonte(a).matchAll(
        /(invalidateQueries|refetchQueries|removeQueries|resetQueries|setQueryData|getQueryData|setQueriesData)\(\s*\{?\s*(queryKey:\s*)?\[\s*"vigencias"\s*,/g,
      ),
    ].map(() => a),
  );
  verificar(
    "F3. nenhuma operação de cache por chave específica de vigência (só pelo prefixo)",
    especificas.length === 0,
    JSON.stringify(especificas),
  );
}

console.log("\nH. Prévia financeira: igual à da tela aberta direto, sem versão aposentada");
{
  const data = "2026-11-10";
  const cond = (r) =>
    resolverCondicaoDoDia({
      data,
      contratoId: CONTRATO,
      termosContrato: r.termosContrato,
      termosOperacao: r.termosOperacao,
      termosCusto: [ATIVA_CUSTO],
    });
  const ref = await direto(apontamento({ contratoId: CONTRATO }));
  const alt = await alternar(
    historico("contrato", CONTRATO),
    apontamento({ contratoId: CONTRATO }),
  );
  verificar(
    "H1. condição do dia igual à da tela aberta direto (antes da resposta)",
    isDeepStrictEqual(cond(alt.antes), cond(ref)) || alt.antes.carregando === true,
    JSON.stringify(cond(alt.antes)),
  );
  verificar(
    "H2. condição do dia igual à da tela aberta direto (depois da resposta)",
    isDeepStrictEqual(cond(alt.depois), cond(ref)),
  );
  verificar(
    "H3. a prévia usa a diária ativa (250), nunca a aposentada (240)",
    cond(ref).ok === true && Number(cond(ref).regras?.daily_rate) === 250,
    JSON.stringify(cond(ref)),
  );
  // `parametrosDaVersao` da tela busca a versão por id em `termosContrato`: com a aposentada no
  // cache, uma linha gravada com ela teria parâmetros que a tela aberta direto não tem.
  verificar(
    "H4. busca por id da versão aposentada igual à da tela aberta direto",
    (alt.antes.termosContrato.find((t) => t.id === APOSENTADA_CONTRATO.id) ?? null) ===
      (ref.termosContrato.find((t) => t.id === APOSENTADA_CONTRATO.id) ?? null),
  );
}

console.log("\nI. Forma do código: uma só fábrica de chave, com o escopo explícito");
{
  const fonte = readFileSync(path.join(RAIZ, "src/lib/vigencias-dados.ts"), "utf8");
  verificar(
    "I1. sem as chaves literais antigas de contrato e operação",
    !/queryKey:\s*\[\s*"vigencias"\s*,\s*(tipo|"contrato"|"operacao")\s*,/.test(fonte),
  );
  verificar(
    "I2. o histórico usa o escopo 'todas'",
    /queryKey:\s*chaveDasVersoes\(tipo,\s*entidadeId,\s*"todas"\)/.test(fonte),
  );
  verificar(
    "I3. a prévia usa o escopo 'ativas' no contrato",
    /chaveDasVersoes\("contrato",\s*p\.contratoId,\s*"ativas"\)/.test(fonte),
  );
  verificar(
    "I4. a prévia usa o escopo 'ativas' na operação",
    /chaveDasVersoes\("operacao",\s*p\.operacaoId,\s*"ativas"\)/.test(fonte),
  );
  verificar(
    "I5. as chaves das duas consultas nunca coincidem",
    V.chaveDasVersoes?.("contrato", CONTRATO, "todas")?.join("|") !==
      V.chaveDasVersoes?.("contrato", CONTRATO, "ativas")?.join("|") &&
      V.chaveDasVersoes?.("contrato", CONTRATO, "todas")?.[0] === "vigencias",
  );
}

console.log(`\n${passou} verificações passaram, ${falhas.length} falharam.`);
if (falhas.length) {
  console.log("\nFalhas:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
