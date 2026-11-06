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
 * participantes, que é o mesmo valor), dos serviços NÃO cancelados cujo adicional (também não
 * cancelado) tem a COMPETÊNCIA DE COBRANÇA inteira dentro do período:
 * `coalesce(billing_period_start, period_start) >= início` e
 * `coalesce(billing_period_end, period_end) <= fim` — o predicado de `resumo_financeiro_periodo`
 * (migration 038), que reconhece a receita desse mesmo adicional. Soma-se em centavos inteiros.
 *
 * MUDANÇA DE CRITÉRIO (S19C-DEF-005, aprovada pelo responsável em 05/11/2026). O PR #104 somava pela
 * data de EXECUÇÃO, supondo que a receita também usava a execução; desde a 038 a receita usa a
 * competência. No HML, 01–15/10 do cliente A: um serviço executado em 16/10 com cobrança na 1ª
 * quinzena tinha a receita no período e o custo fora dele, e a margem dos Relatórios aparecia como
 * R$ 2.300,88 contra R$ 2.000,87 da fatura. A data de execução continua preservada no serviço; só
 * deixa de decidir o período do custo. Custo persistido, fatura, Fechamento e banco não mudam.
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
const { somarCustoDeContainers, somarCustoDosAdicionais, ehSchemaSemContainers } = modulo;
const { lerServicosAtivos } = await import("../src/lib/custo-containers-dados.ts");

const A = "5c4a0000-0000-4000-8000-0000000000a1";
const B = "5c4a0000-0000-4000-8000-0000000000b1";
const Q1 = { billing_period_start: "2026-10-01", billing_period_end: "2026-10-15" };
const Q2 = { billing_period_start: "2026-10-16", billing_period_end: "2026-10-31" };
const MES = { billing_period_start: "2026-10-01", billing_period_end: "2026-10-31" };
/** Serviço com o adicional embutido como o PostgREST devolve (`billing_additionals(...)`). */
const s = ({ competencia = Q1, adicionalCancelado = null, ...o } = {}) => {
  const executed_on = o.executed_on ?? "2026-10-09";
  return {
    id: crypto.randomUUID(),
    client_id: A,
    operation_id: null,
    executed_on,
    cost_total_cents: 0,
    canceled_at: null,
    billing_additional_id: crypto.randomUUID(),
    ...o,
    billing_additionals:
      competencia === undefined
        ? null
        : {
            period_start: executed_on,
            period_end: executed_on,
            canceled_at: adicionalCancelado,
            ...competencia,
          },
  };
};

// Cenário do HML (outubro). Cliente A quinzenal: quatro serviços ativos da 1ª quinzena (um deles
// EXECUTADO em 16/10 com cobrança na 1ª), um cancelado e um da 2ª. Cliente B mensal.
const SERVICOS = [
  s({ cost_total_cents: 25000 }),
  s({ cost_total_cents: 30001, executed_on: "2026-10-16", competencia: Q1 }),
  s({ cost_total_cents: 2000, executed_on: "2026-10-12" }),
  s({ cost_total_cents: 6000, executed_on: "2026-10-12" }),
  s({ cost_total_cents: 5000, executed_on: "2026-10-12", canceled_at: "2026-10-13T00:00:00Z" }),
  s({ cost_total_cents: 4000, executed_on: "2026-10-21", competencia: Q2 }),
  s({ client_id: B, cost_total_cents: 30000, executed_on: "2026-10-20", competencia: MES }),
];

test("soma pela competência de cobrança do adicional, em reais exatos", () => {
  // 01–15/10: 250,00 + 300,01 (executado 16/10, cobrado na 1ª) + 20,00 + 60,00 = 630,01.
  // O mensal do cliente B (01–31/10) não cabe inteiro na quinzena: fica de fora, como a receita.
  assert.equal(somarCustoDeContainers(SERVICOS, "2026-10-01", "2026-10-15"), 630.01);
  assert.equal(somarCustoDeContainers(SERVICOS, "2026-10-16", "2026-10-31"), 40);
  assert.equal(
    somarCustoDeContainers(SERVICOS, "2026-10-01", "2026-10-31"),
    Math.round((630.01 + 40 + 300) * 100) / 100,
  );
});

test("regressão S19C-DEF-005: executado em 16/10 e cobrado em 01–15/10 entra na 1ª quinzena", () => {
  const servico = [s({ cost_total_cents: 30001, executed_on: "2026-10-16", competencia: Q1 })];
  assert.equal(somarCustoDeContainers(servico, "2026-10-01", "2026-10-15"), 300.01);
  assert.equal(somarCustoDeContainers(servico, "2026-10-16", "2026-10-31"), 0);
  // A data de execução é preservada; só não decide o período.
  assert.equal(servico[0].executed_on, "2026-10-16");
});

test("competência parcialmente dentro do filtro não entra (mesmo critério da receita)", () => {
  // S19B: executado 06/11, cobrança 01–15/11. Filtro 05–06/11: nem receita nem custo.
  const servico = [
    s({
      cost_total_cents: 17000,
      executed_on: "2026-11-06",
      competencia: { billing_period_start: "2026-11-01", billing_period_end: "2026-11-15" },
    }),
  ];
  assert.equal(somarCustoDeContainers(servico, "2026-11-05", "2026-11-06"), 0);
  assert.equal(somarCustoDeContainers(servico, "2026-11-01", "2026-11-15"), 170);
});

test("adicional sem competência (anterior à 038) usa o período do próprio adicional", () => {
  const legado = [s({ cost_total_cents: 1000, competencia: {} })];
  assert.equal(somarCustoDeContainers(legado, "2026-10-09", "2026-10-09"), 10);
  assert.equal(somarCustoDeContainers(legado, "2026-10-10", "2026-10-31"), 0);
});

test("serviço cancelado ou adicional cancelado nunca entra no custo", () => {
  const cancelado = [s({ cost_total_cents: 999, canceled_at: "2026-10-10T00:00:00Z" })];
  assert.equal(somarCustoDeContainers(cancelado, "2026-10-01", "2026-10-31"), 0);
  const adicionalCancelado = [
    s({ cost_total_cents: 999, adicionalCancelado: "2026-10-10T00:00:00Z" }),
  ];
  assert.equal(somarCustoDeContainers(adicionalCancelado, "2026-10-01", "2026-10-31"), 0);
});

test("equivalência com Fechamento e Faturamento: mesmo total pelo adicional do recorte", () => {
  // Fechamento e prévia do Faturamento somam o custo dos serviços dos adicionais do recorte
  // (escolhidos pela competência). Com o mesmo recorte, o total tem de ser idêntico.
  for (const [inicio, fim] of [
    ["2026-10-01", "2026-10-15"],
    ["2026-10-16", "2026-10-31"],
    ["2026-10-01", "2026-10-31"],
  ]) {
    const doRecorte = SERVICOS.filter(
      (x) =>
        x.canceled_at === null &&
        x.billing_additionals.canceled_at === null &&
        x.billing_additionals.billing_period_start >= inicio &&
        x.billing_additionals.billing_period_end <= fim,
    ).map((x) => x.billing_additional_id);
    assert.equal(
      somarCustoDeContainers(SERVICOS, inicio, fim),
      somarCustoDosAdicionais(SERVICOS, doRecorte),
      `${inicio}–${fim}`,
    );
  }
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

test("paridade com a fatura do HML: margem 01–15/10 = R$ 2.000,87, não R$ 2.300,88", () => {
  const receita = 3782.51; // resumo_financeiro_periodo: apontamentos 2.862,50 + adicionais 920,01
  const custoApontamentos = 1151.63;
  const containers = somarCustoDeContainers(SERVICOS, "2026-10-01", "2026-10-15");
  assert.equal(containers, 630.01);
  assert.equal(Math.round((custoApontamentos + containers) * 100) / 100, 1781.64); // total_cost da fatura emitida em HML
  const margem = Math.round((receita - custoApontamentos - containers) * 100) / 100;
  assert.equal(margem, 2000.87);
  assert.notEqual(margem, 2300.88); // valor exibido antes da correção (custo pela execução)
});

test("adicional não lido (embed ausente) não some com o custo: cai na data de execução", () => {
  const semEmbed = [{ ...s({ cost_total_cents: 1234 }), billing_additionals: null }];
  assert.equal(somarCustoDeContainers(semEmbed, "2026-10-09", "2026-10-09"), 12.34);
  assert.equal(somarCustoDeContainers(semEmbed, "2026-10-10", "2026-10-31"), 0);
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
  assert.match(dash, /Custo de mão de obra e de Containers/);
  // O cartão por cliente soma só apontamentos (sem adicionais, Containers e ajuste): diz isso.
  assert.match(dash, /apontamentos \{brl\(client\.receita\)\}/);
  assert.match(dash, /sem adicionais, Containers e ajuste de arredondamento/);
});

test("o hook só LÊ container_services (sem escrita, sem RPC) com a competência do adicional", () => {
  const f = ler("src/lib/custo-containers-dados.ts");
  assert.match(f, /from\("container_services"\)/);
  assert.match(f, /export async function lerServicosAtivos\(db: ClienteDeLeitura\)/);
  // A competência vem do adicional embutido; a execução não recorta mais no servidor.
  assert.match(
    f,
    /billing_additionals\(period_start, period_end, billing_period_start, billing_period_end, canceled_at\)/,
  );
  assert.doesNotMatch(f, /gte\("executed_on"/);
  assert.doesNotMatch(f, /lte\("executed_on"/);
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
  assert.deepEqual(await lerServicosAtivos(clienteSem045()), []);
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
  await assert.rejects(() => lerServicosAtivos(c));
});
