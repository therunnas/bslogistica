/**
 * Renderiza o componente real e os SVGs reais do Recharts com dados sintéticos.
 * Substitui somente hooks de dados/estado, componentes visuais e a medição do
 * ResponsiveContainer (não há layout de navegador no render do servidor).
 * Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Recharts from "recharts";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);
function load(file, resolve = nativeRequire) {
  const source = readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", output)(resolve, module.exports, module);
  return module.exports;
}

const format = load("src/lib/format.ts");
const components = load("src/lib/componentes-financeiros.ts");
const ledgerState = load("src/lib/ledger-estado.ts", (id) =>
  id === "./componentes-financeiros" ? components : nativeRequire(id),
);
const ledger = load("src/lib/ledger.ts", (id) => {
  if (id === "./queries") return {};
  if (id === "./ledger-estado") return ledgerState;
  return nativeRequire(id);
});
const billing = load("src/lib/billing.ts");
const additionals = load("src/lib/adicionais.ts");
const costs = load("src/lib/custo-containers.ts");
const summary = load("src/lib/resumo-financeiro.ts");

function dashboard(rows) {
  let state = 0;
  const resolve = (id) => {
    if (id === "react") {
      return {
        useMemo: (fn) => fn(),
        useState: () => [["2026-10-01", "2026-10-31"][state++], () => {}],
      };
    }
    if (id === "recharts") return Recharts;
    if (id === "@/lib/ledger") {
      return { ...ledger, useLedger: () => ({ estado: "pronto", rows }) };
    }
    const modules = {
      "@/lib/format": format,
      "@/lib/billing": billing,
      "@/lib/ledger-estado": ledgerState,
      "@/lib/adicionais": additionals,
      "@/lib/custo-containers": costs,
      "@/lib/resumo-financeiro": summary,
      "@/lib/vigencias-dados": {
        useRegrasDaBs: () => false,
        useRegrasDefinitivas: () => false,
      },
      "@/lib/adicionais-dados": { useAdicionaisDoPeriodo: () => ({ data: [] }) },
      "@/lib/regras-definitivas-dados": { useResumoFinanceiro: () => ({ data: null }) },
      "@/lib/custo-containers-dados": { useCustoDeContainers: () => ({ data: [] }) },
    };
    if (id in modules) return modules[id];
    if (id === "../_components/app-shell") return { PageHeader: () => null };
    if (id.startsWith("@/components/ui/")) {
      return new Proxy(
        {},
        {
          get:
            () =>
            ({ children }) =>
              React.createElement("div", null, children),
        },
      );
    }
    return nativeRequire(id);
  };
  return load("src/app/(painel)/dashboard/painel-dashboard.tsx", resolve).PainelDashboard();
}

const row = (billed, operationType = "fixed") => ({
  date: "2026-10-09",
  billed,
  operationType,
  cost: 1781.64,
  dailies: 1,
  overtimeMinutes: 30,
  status: "present",
  clientId: "synthetic-client",
  clientName: "Cliente sintético",
  employeeId: "synthetic-employee",
});
function find(node, type) {
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const result = find(child, type);
    if (result) return result;
  }
  return null;
}
const normalize = (text) => text.replace(/\u00a0/g, " ");
function svg(tree, type) {
  const chart = find(tree, type);
  assert.ok(chart, "gráfico presente no componente real");
  const children = React.Children.map(chart.props.children, (child) =>
    child.type === Recharts.Pie ? React.cloneElement(child, { isAnimationActive: false }) : child,
  );
  return normalize(
    renderToStaticMarkup(React.cloneElement(chart, { width: 520, height: 320 }, children)),
  );
}

test("pizza renderiza R$ 6.846,89 no SVG, sem mudar o valor agregado", () => {
  const tree = dashboard([row(6846.89)]);
  assert.match(svg(tree, Recharts.PieChart), />R\$ 6\.846,89<\/tspan>/);
  assert.doesNotMatch(svg(tree, Recharts.PieChart), />6846\.89</);
});

test("fixas e avulsas conservam valores numéricos e formatam cada fatia", () => {
  const tree = dashboard([row(1234.56), row(0.01, "spot")]);
  const chart = find(tree, Recharts.PieChart);
  const pie = React.Children.toArray(chart.props.children)[0];
  assert.deepEqual(
    pie.props.data.map((item) => item.value),
    [1234.56, 0.01],
  );
  assert.match(svg(tree, Recharts.PieChart), />R\$ 1\.234,56<\/tspan>/);
  assert.match(svg(tree, Recharts.PieChart), />R\$ 0,01<\/tspan>/);
});

test("eixo de receita/custo e tooltips financeiros usam moeda brasileira", () => {
  const tree = dashboard([row(6846.89)]);
  const bar = find(tree, Recharts.BarChart);
  const axis = find(bar, Recharts.YAxis);
  assert.equal(normalize(axis.props.tickFormatter(6846.89)), "R$ 6.846,89");
  assert.match(svg(tree, Recharts.BarChart), />R\$ 0,00<\/tspan>/);
  for (const type of [Recharts.BarChart, Recharts.PieChart]) {
    const tooltip = find(find(tree, type), Recharts.Tooltip);
    assert.equal(normalize(tooltip.props.formatter(6846.89)), "R$ 6.846,89");
  }
});

test("diárias continuam sendo quantidades e período vazio não mostra receita fictícia", () => {
  const tree = dashboard([row(6846.89)]);
  assert.doesNotMatch(svg(tree, Recharts.LineChart), /R\$/);
  assert.equal(find(dashboard([]), Recharts.PieChart), null);
  assert.equal(find(dashboard([row(0)]), Recharts.PieChart), null);
});
