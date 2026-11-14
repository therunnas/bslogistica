/**
 * Margem de Containers no Fechamento e na prévia do Faturamento (sessão 16, achado I estendido).
 *
 * COMO RODAR: npm run test:margem-containers
 *
 * DEFINIÇÕES (as mesmas da fatura emitida, migration 045: `total_cost` soma o custo do serviço uma vez):
 *   custo de apontamentos = Σ custo previsto dos lançamentos (já existente);
 *   custo de Containers   = Σ `cost_total_cents` dos serviços NÃO cancelados cujo adicional está no recorte;
 *   custo total           = apontamentos + Containers;
 *   margem total          = receita total − custo total.
 * Mesmo critério de período e cancelamento da receita: o adicional do serviço é o que decide o recorte.
 * Nada persistido, nenhuma fatura e nenhum cálculo do banco muda: só a agregação mostrada.
 *
 * REAL: as funções puras de `src/lib/fechamento/{financeiro,banco}.ts` e `src/lib/custo-containers.ts`, e a
 * forma do código das telas. SIMULADO: o transporte (nenhum acesso a rede, banco ou Production).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

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
const ler = (p) => readFileSync(path.join(RAIZ, p), "utf8").replace(/\s+/g, " ");

const { comporFinanceiro } = await import("../src/lib/fechamento/financeiro.ts");
const { buscarDadosDoBanco, lerCustoDeContainers } = await import("../src/lib/fechamento/banco.ts");
const { somarCustoDosAdicionais, ehSchemaSemContainers } =
  await import("../src/lib/custo-containers.ts");

const valores = (o = {}) => ({
  diarias: 0,
  minutosExtras: 0,
  minutosExtrasCobrados: 0,
  diariaCentavos: 0,
  extraCentavos: 0,
  especialCentavos: 0,
  adicionalDiarioCentavos: 0,
  custoCentavos: 0,
  faturadoCentavos: 0,
  resultadoCentavos: 0,
  margemPermil: null,
  ...o,
});
const adic = (id, valorCentavos, faturaId = null) => ({
  id,
  descricao: "d",
  referencia: null,
  operacaoId: null,
  inicio: "2026-10-09",
  fim: "2026-10-09",
  valorCentavos,
  faturaId,
});
const resumo = {
  receitaApontamentosCentavos: 0,
  adicionaisCentavos: 0,
  ajusteFaturadoCentavos: 0,
  ajustePrevistoCentavos: 0,
  receitaCentavos: 0,
  aFaturarCentavos: 0,
  faturadoCentavos: 0,
  ajusteAplicavel: true,
};
const banco = (o = {}) => ({
  resumo,
  ajustesPrevistos: [],
  ajustesFaturados: [],
  saldoDeHoras: [],
  adicionais: [adic("a1", 45000), adic("a2", 30001), adic("a3", 5000), adic("a4", 12000)],
  ...o,
});
// Cenário do HML (cliente A, 1ª quinzena de outubro): apontamentos 2.862,50, custo de apontamentos 1.151,63.
const consolidado = valores({
  faturadoCentavos: 286250,
  custoCentavos: 115163,
  resultadoCentavos: 171087,
});

test("sem custo de Containers o financeiro é o de antes (custo = apontamentos)", () => {
  const f = comporFinanceiro(consolidado, consolidado, valores(), banco());
  assert.equal(f.custoCentavos, 115163);
  assert.equal(f.custoApontamentosCentavos, 115163);
  assert.equal(f.custoContainersCentavos, 0);
  assert.equal(f.resultadoCentavos, f.receitaCentavos - 115163);
});

test("com Containers: custo total = apontamentos + Containers; resultado e margem usam o total", () => {
  const f = comporFinanceiro(
    consolidado,
    consolidado,
    valores(),
    banco({ custoContainersCentavos: 63001 }),
  );
  assert.equal(f.receitaCentavos, 286250 + 92001);
  assert.equal(f.custoApontamentosCentavos, 115163);
  assert.equal(f.custoContainersCentavos, 63001);
  assert.equal(f.custoCentavos, 178164); // = total_cost da fatura emitida no HML (R$ 1.781,64)
  assert.equal(f.resultadoCentavos, 378251 - 178164); // R$ 2.000,87
  assert.equal(f.margemPermil, 529); // 2.000,87 ÷ 3.782,51 = 52,9%
});

test("o custo de Containers não altera receita, a faturar nem já faturado", () => {
  const a = comporFinanceiro(consolidado, consolidado, valores(), banco());
  const b = comporFinanceiro(
    consolidado,
    consolidado,
    valores(),
    banco({ custoContainersCentavos: 63001 }),
  );
  for (const k of [
    "receitaCentavos",
    "adicionaisCentavos",
    "aFaturarCentavos",
    "jaFaturadoCentavos",
    "apontamentosCentavos",
  ])
    assert.equal(b[k], a[k], k);
});

test("leitura do banco: soma só serviços não cancelados dos adicionais do recorte, uma vez cada", async () => {
  const fonte = {
    resumo: async () => [
      {
        receita_apontamentos: "0",
        adicionais: "0",
        ajuste_faturado: "0",
        ajuste_previsto: "0",
        receita_total: "0",
        a_faturar: "0",
        faturado: "0",
        ajuste_aplicavel: true,
      },
    ],
    ajustesPrevistos: async () => [],
    saldoDeHoras: async () => [],
    ajustesFaturados: async () => [],
    adicionais: async () => [
      {
        id: "a1",
        description: "x",
        reference: null,
        operation_id: null,
        period_start: "2026-10-09",
        period_end: "2026-10-09",
        invoice_id: null,
        valor: "450.00",
      },
      {
        id: "a2",
        description: "y",
        reference: null,
        operation_id: null,
        period_start: "2026-10-12",
        period_end: "2026-10-12",
        invoice_id: null,
        valor: "300.01",
      },
    ],
    custoDeContainers: async (_f, ids) => {
      assert.deepEqual([...ids].sort(), ["a1", "a2"]);
      return [
        { billing_additional_id: "a1", cost_total_cents: 25000 },
        { billing_additional_id: "a2", cost_total_cents: 30001 },
      ];
    },
  };
  const dados = await buscarDadosDoBanco(fonte, {
    clienteId: "c",
    inicio: "2026-10-01",
    fim: "2026-10-15",
  });
  assert.equal(dados.custoContainersCentavos, 55001);
});

test("banco sem a 045 (fonte sem a leitura, ou lista vazia): custo de Containers = 0, sem erro", async () => {
  assert.equal(lerCustoDeContainers([], ["a1"]), 0);
  assert.equal(
    lerCustoDeContainers([{ billing_additional_id: "zz", cost_total_cents: 999 }], ["a1"]),
    0,
  ); // serviço de outro recorte não entra
});

test("dado inválido de custo derruba a leitura (nunca soma lixo)", () => {
  assert.throws(() =>
    lerCustoDeContainers([{ billing_additional_id: "a1", cost_total_cents: -1 }], ["a1"]),
  );
  assert.throws(() =>
    lerCustoDeContainers([{ billing_additional_id: "a1", cost_total_cents: 1.5 }], ["a1"]),
  );
  assert.throws(() => lerCustoDeContainers("nao-lista", ["a1"]));
});

test("duplicidade: dois serviços para o mesmo adicional recusam a leitura", () => {
  assert.throws(() =>
    lerCustoDeContainers(
      [
        { billing_additional_id: "a1", cost_total_cents: 1 },
        { billing_additional_id: "a1", cost_total_cents: 2 },
      ],
      ["a1"],
    ),
  );
});

test("prévia do Faturamento: custo de Containers só dos adicionais elegíveis e não cancelados", () => {
  const servicos = [
    { billing_additional_id: "a1", cost_total_cents: 25000 },
    { billing_additional_id: "a2", cost_total_cents: 30001 },
    { billing_additional_id: "fora", cost_total_cents: 7777 }, // adicional fora do recorte/elegibilidade
  ];
  assert.equal(somarCustoDosAdicionais(servicos, ["a1", "a2"]), 550.01);
  assert.equal(somarCustoDosAdicionais(servicos, []), 0);
});

test("Fechamento (tela) mostra custo de apontamentos, de Containers e o total", () => {
  const r = ler("src/app/(painel)/fechamento/_resumo.tsx");
  assert.match(r, /f\.custoCentavos/);
  assert.match(r, /custoContainersCentavos/);
  // CP-06B: o rótulo diz "serviços antigos de contêiner" (não há mais módulo "Containers").
  assert.match(
    r,
    /Apontamentos \$\{moeda\(f\.custoApontamentosCentavos\)\} \+ serviços antigos de contêiner/,
  );
});

test("Faturamento (tela) soma o custo de Containers à prévia de margem", () => {
  const f = ler("src/app/(painel)/faturamento/painel-faturamento.tsx");
  assert.match(f, /useCustoDeContainersDoCliente\(/);
  assert.match(f, /somarCustoDosAdicionais\(/);
  assert.match(f, /totalAFaturar - custoTotal/);
});

test("só leitura: nenhuma escrita nem RPC nova no módulo de dados", () => {
  const f = ler("src/lib/custo-containers-dados.ts");
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(f));
  assert.match(f, /export async function lerServicosDoCliente/);
  const b = ler("src/lib/fechamento/banco.ts");
  assert.match(b, /from\("container_services"\)/);
  assert.ok(ehSchemaSemContainers({ code: "PGRST205" }));
});

test("script npm e passo de CI", () => {
  assert.match(ler("package.json"), /"test:margem-containers"/);
  assert.match(ler(".github/workflows/ci.yml"), /npm run test:margem-containers/);
});
