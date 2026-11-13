/**
 * Achado I da homologação: a margem do Dashboard e dos Relatórios usava a receita total (que inclui
 * os serviços de Containers) contra um custo que só somava os apontamentos.
 *
 * COMO RODAR: npm run test:custo-containers
 *
 * O QUE É REAL: as funções puras de `src/lib/custo-containers.ts` e a forma do código das telas e
 * do hook de leitura. NADA aqui acessa rede, banco ou Production.
 *
 * REGRA TESTADA. O custo de Containers é `cost_total_cents` do SERVIÇO (nunca a soma dos
 * participantes, que é o mesmo valor), dos serviços NÃO cancelados executados no período, o mesmo
 * critério do adicional de receita (`period_start/period_end` = data da execução). Soma-se em
 * centavos inteiros. Custo persistido, fatura e Fechamento não mudam.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const hooks = `
import { pathToFileURL } from "node:url";
const SRC = ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src") + path.sep).href)};
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

const ler = (p) => readFileSync(path.join(RAIZ, p), "utf8");
const modulo = await import("../src/lib/custo-containers.ts");
const { somarCustoDeContainers, ehSchemaSemContainers } = modulo;
const { lerServicosDoPeriodo } = await import("../src/lib/custo-containers-dados.ts");

const A = "5c4a0000-0000-4000-8000-0000000000a1";
const B = "5c4a0000-0000-4000-8000-0000000000b1";
const s = (o) => ({
  id: crypto.randomUUID(),
  client_id: A,
  operation_id: null,
  executed_on: "2026-10-09",
  cost_total_cents: 0,
  canceled_at: null,
  ...o,
});

// Cenário do HML (cliente A, 1ª quinzena de outubro): quatro serviços ativos, um cancelado e um de 2ª quinzena.
const SERVICOS = [
  s({ cost_total_cents: 25000 }),
  s({ cost_total_cents: 30001, executed_on: "2026-10-16" }), // competência 1ª, execução 16/10: ver nota abaixo
  s({ cost_total_cents: 2000, executed_on: "2026-10-12" }),
  s({ cost_total_cents: 6000, executed_on: "2026-10-12" }),
  s({ cost_total_cents: 5000, executed_on: "2026-10-12", canceled_at: "2026-10-13T00:00:00Z" }),
  s({ cost_total_cents: 4000, executed_on: "2026-10-21" }),
  s({ client_id: B, cost_total_cents: 30000, executed_on: "2026-10-20" }),
];

test("soma os serviços ativos executados no período, em reais exatos", () => {
  // 01–15/10: 250,00 + 20,00 + 60,00 = 330,00 (cancelado e execuções fora do período ficam de fora)
  assert.equal(somarCustoDeContainers(SERVICOS, "2026-10-01", "2026-10-15"), 330);
  assert.equal(
    somarCustoDeContainers(SERVICOS, "2026-10-01", "2026-10-31"),
    330 + 300.01 + 40 + 300,
  );
});

test("serviço cancelado nunca entra no custo", () => {
  const cancelado = [s({ cost_total_cents: 999, canceled_at: "2026-10-10T00:00:00Z" })];
  assert.equal(somarCustoDeContainers(cancelado, "2026-10-01", "2026-10-31"), 0);
});

test("centavos: nunca erro de ponto flutuante", () => {
  const tres = [10, 20, 30].map((c) => s({ cost_total_cents: c }));
  assert.equal(somarCustoDeContainers(tres, "2026-10-01", "2026-10-31"), 0.6);
  assert.equal(
    somarCustoDeContainers([s({ cost_total_cents: 30001 })], "2026-10-01", "2026-10-31"),
    300.01,
  );
});

test("período invertido ou sem serviços devolve zero", () => {
  assert.equal(somarCustoDeContainers([], "2026-10-01", "2026-10-31"), 0);
  assert.equal(somarCustoDeContainers(SERVICOS, "2026-10-31", "2026-10-01"), 0);
});

test("sem duplicidade: o custo é o do serviço, não o dos participantes", () => {
  const fonte = ler("src/lib/custo-containers.ts");
  assert.ok(
    !/participants|participantes/i.test(
      fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    ),
  );
  const comParticipantes = [
    {
      ...s({ cost_total_cents: 25000 }),
      participantes: [{ cost_cents: 10000 }, { cost_cents: 15000 }],
    },
  ];
  assert.equal(somarCustoDeContainers(comParticipantes, "2026-10-01", "2026-10-31"), 250);
});

test("paridade com a fatura do HML: margem do período = receita − (apontamentos + containers)", () => {
  const receita = 3782.51;
  const custoApontamentos = 1151.63;
  const containers = somarCustoDeContainers(
    [25000, 30001, 2000, 6000].map((c) => s({ cost_total_cents: c, executed_on: "2026-10-12" })),
    "2026-10-01",
    "2026-10-15",
  );
  assert.equal(containers, 630.01);
  assert.equal(Math.round((custoApontamentos + containers) * 100) / 100, 1781.64); // total_cost da fatura emitida em HML
  assert.equal(Math.round((receita - custoApontamentos - containers) * 100) / 100, 2000.87);
});

test("schema sem containers (Production 034) não é erro: reconhece o código ou a mensagem", () => {
  assert.equal(ehSchemaSemContainers({ code: "42P01", message: "x" }), true);
  assert.equal(ehSchemaSemContainers({ code: "PGRST205", message: "x" }), true);
  assert.equal(
    ehSchemaSemContainers(Object.assign(new Error("falhou"), { cause: { code: "PGRST205" } })),
    true,
  );
  assert.equal(
    ehSchemaSemContainers({
      message: "Could not find the table 'public.container_services' in the schema cache",
    }),
    true,
  );
  assert.equal(ehSchemaSemContainers({ code: "42501", message: "permission denied" }), false);
  assert.equal(ehSchemaSemContainers(null), false);
});

test("Dashboard e Relatórios somam o custo de Containers ao custo; o cartão por cliente diz o que soma", () => {
  const dash = ler("src/app/(painel)/dashboard/painel-dashboard.tsx").replace(/\s+/g, " ");
  const rel = ler("src/app/(painel)/relatorios/painel-relatorios.tsx").replace(/\s+/g, " ");
  for (const [nome, f] of [
    ["dashboard", dash],
    ["relatórios", rel],
  ]) {
    assert.match(f, /useCustoDeContainers\(/, `${nome}: usa o hook`);
    assert.match(f, /somarCustoDeContainers\(/, `${nome}: soma o custo de Containers`);
  }
  // CP-06B: sem módulo "Containers" na interface; o custo é dos serviços antigos de contêiner.
  assert.match(dash, /Custo de mão de obra e dos serviços antigos de contêiner/);
  // O cartão por cliente soma só apontamentos (sem adicionais, Containers e ajuste): diz isso.
  assert.match(dash, /apontamentos \{brl\(client\.receita\)\}/);
  assert.match(dash, /sem adicionais, serviços antigos de contêiner e ajuste de arredondamento/);
});

test("o hook só LÊ container_services (sem escrita, sem RPC) e usa o mesmo critério da receita", () => {
  const f = ler("src/lib/custo-containers-dados.ts");
  assert.match(f, /from\("container_services"\)/);
  assert.match(f, /export async function lerServicosDoPeriodo/);
  assert.match(f, /gte\("executed_on"/);
  assert.match(f, /lte\("executed_on"/);
  assert.match(f, /is\("canceled_at", null\)/);
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(f));
  assert.match(f, /ehSchemaSemContainers/);
});

test("script npm e passo de CI", () => {
  assert.match(ler("package.json"), /"test:custo-containers"/);
  assert.match(ler(".github/workflows/ci.yml"), /npm run test:custo-containers/);
});

// ---- Compatibilidade com o schema 034 (Production): reproduz o PostgREST real sobre tabela inexistente.
// Medido num banco restaurado do backup de Production (034): o GET devolve 404/PGRST205, mas o HEAD
// de contagem devolve 204 SEM erro e com count nulo. Sem tratamento, o paginador lançava
// CONTAGEM_INVALIDA e o Dashboard mostrava "custo de Containers indisponível" em Production.
function clienteSem045() {
  const consulta = (head) => {
    const c = {
      select: () => c,
      gte: () => c,
      lte: () => c,
      is: () => c,
      gt: () => c,
      order: () => c,
      limit: () => c,
      then: (ok, ko) =>
        Promise.resolve(
          head
            ? { data: null, error: null, count: null }
            : {
                data: null,
                error: {
                  code: "PGRST205",
                  message:
                    "Could not find the table 'public.container_services' in the schema cache",
                },
              },
        ).then(ok, ko),
    };
    return c;
  };
  return { from: () => ({ select: (_c, opcoes) => consulta(opcoes?.head === true) }) };
}
test("schema 034 (sem container_services): o PostgREST real não vira erro, vira lista vazia", async () => {
  assert.deepEqual(await lerServicosDoPeriodo(clienteSem045(), "2026-11-01", "2026-11-30"), []);
});
test("erro que NÃO é de tabela ausente continua sendo erro (permissão negada)", async () => {
  const c = {
    from: () => ({
      select: () => {
        const q = {
          gte: () => q,
          lte: () => q,
          is: () => q,
          gt: () => q,
          order: () => q,
          limit: () => q,
          select: () => q,
        };
        q.then = (ok, ko) =>
          Promise.resolve({
            data: null,
            error: { code: "42501", message: "permission denied for table container_services" },
          }).then(ok, ko);
        return q;
      },
    }),
  };
  await assert.rejects(() => lerServicosDoPeriodo(c, "2026-11-01", "2026-11-30"));
});
