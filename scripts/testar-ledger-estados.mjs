/**
 * Testes dos estados de completude do ledger (C03, A4C).
 *
 * COMO RODAR:
 *
 *   npm run test:ledger-estados
 *
 * Três camadas, todas com dados sintéticos e sem rede:
 *   1. NÚCLEO PURO (`src/lib/ledger-estado.ts`): a decisão de estado, a montagem
 *      das linhas (fórmulas) e a política de exibição.
 *   2. HOOK REAL (`useLedger`) sobre um React Query real, com o cache semeado:
 *      primeira carga, sucesso, vazio legítimo, erro (com e sem dado antigo),
 *      refetch em andamento e refetch concluído. O hook roda dentro de um
 *      `renderToString`; o transporte não existe (`fetch` lança se for chamado).
 *   3. TELAS: os componentes são `.tsx` e este runner não executa JSX, então a
 *      ligação de cada tela ao estado é conferida por forma do código, SÓ como
 *      complemento. Quem prova o comportamento é a camada 1 (a decisão que as
 *      telas consomem) e a camada 2.
 *
 * LIMITE DECLARADO. O `renderToString` não executa `useEffect`. Por isso a
 * reconciliação (a releitura única) é provada pela máquina de estados pura:
 * `avaliarLedger` + `planoDeReconciliacao` simulados em laço. O efeito do hook
 * só aplica o que essas duas funções mandam.
 */

import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
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
globalThis.fetch = () => {
  throw new Error("rede proibida nesta suíte");
};

const React = (await import("react")).default;
const { renderToString } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useLedger } = await import("../src/lib/ledger.ts");
const E = await import("../src/lib/ledger-estado.ts");

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

const idDe = (prefixo, n) => `${prefixo}000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Dados sintéticos
// ---------------------------------------------------------------------------

function cenario(sobrescritas = {}) {
  const clients = [{ id: idDe("c1", 1), name: "Cliente A" }];
  const employees = [
    { id: idDe("e1", 1), name: "Ana" },
    { id: idDe("e1", 2), name: "Bruno" },
    { id: idDe("e1", 3), name: "Carla" },
  ];
  const operations = [{ id: idDe("a1", 1), client_id: clients[0].id, name: "Op 1", type: "fixed" }];
  const shifts = [{ id: idDe("b1", 1), name: "Manhã" }];
  const timesheets = [
    {
      id: idDe("d1", 1),
      operation_id: operations[0].id,
      shift_id: shifts[0].id,
      work_date: "2026-10-01",
      status: "open",
    },
    {
      id: idDe("d1", 2),
      operation_id: operations[0].id,
      shift_id: null,
      work_date: "2026-10-02",
      status: "closed",
    },
  ];
  const entries = [
    entrada(1, timesheets[0].id, employees[0].id, "present", 200, 150, 30, 100),
    entrada(2, timesheets[0].id, employees[1].id, "absent", 0, 0, 0, 0),
    entrada(3, timesheets[1].id, employees[2].id, "present", 260, 200, 60, 200, idDe("f1", 1)),
  ];
  return { clients, employees, operations, shifts, timesheets, entries, ...sobrescritas };
}

function entrada(n, timesheet_id, employee_id, status, billed, rate, ot, cost, invoice_id = null) {
  return {
    id: idDe("f2", n),
    timesheet_id,
    employee_id,
    status,
    worked_minutes: status === "absent" ? 0 : 480,
    overtime_minutes: ot,
    billed_amount: billed,
    daily_rate_snapshot: rate,
    cost_amount: cost,
    invoice_id,
  };
}

const NOMES = ["entries", "timesheets", "operations", "clients", "employees", "shifts"];
const sucesso = (data, extra = {}) => ({
  status: "success",
  fetchStatus: "idle",
  data,
  dataUpdatedAt: 1000,
  ...extra,
});
const retratos = (c, extra = {}) =>
  Object.fromEntries(NOMES.map((n) => [n, sucesso(c[n], extra[n])]));

// ---------------------------------------------------------------------------
console.log("\nA. Núcleo: estados\n");

{
  const c = cenario();
  const av = E.avaliarLedger(retratos(c), 0);
  verificar("A1. tudo lido, nada em andamento, relações fecham -> pronto", av.estado, "pronto");
  verificar(
    "A2. pronto traz 3 linhas e o instante da leitura",
    `${av.rows.length}/${av.lidoEm}`,
    "3/1000",
  );
}
{
  const vazio = Object.fromEntries(NOMES.map((n) => [n, []]));
  const av = E.avaliarLedger(retratos(vazio), 0);
  verificar(
    "A3. resultado legitimamente vazio -> pronto com 0 linhas (não é carregando nem erro)",
    `${av.estado}/${av.rows?.length}`,
    "pronto/0",
  );
}
{
  const c = cenario();
  const sem = retratos(c);
  sem.entries = { status: "pending", fetchStatus: "fetching", data: undefined, dataUpdatedAt: 0 };
  const av = E.avaliarLedger(sem, 0);
  verificar("A4. consulta ainda sem dado -> carregando", av.estado, "carregando");
  verificar(
    "A5. carregando não carrega linhas",
    String("rows" in av || "rowsAnteriores" in av),
    "false",
  );
}
for (const nome of NOMES) {
  const c = cenario();
  const base = retratos(c);
  base[nome] = { status: "error", fetchStatus: "idle", data: c[nome], dataUpdatedAt: 1000 }; // erro COM dado antigo
  const av = E.avaliarLedger(base, 0);
  verificar(`A6-${nome}a. falha com dado antigo em cache -> erro (não pronto)`, av.estado, "erro");
  verificar(
    `A6-${nome}b. aponta a consulta que falhou`,
    JSON.stringify(av.falhas),
    JSON.stringify([nome]),
  );
  verificar(
    `A6-${nome}c. erro não expõe linhas`,
    String("rows" in av || "rowsAnteriores" in av),
    "false",
  );
  const semDado = retratos(c);
  semDado[nome] = { status: "error", fetchStatus: "idle", data: undefined, dataUpdatedAt: 0 };
  verificar(
    `A6-${nome}d. falha sem nenhum dado -> erro`,
    E.avaliarLedger(semDado, 0).estado,
    "erro",
  );
}
{
  const c = cenario();
  const base = retratos(c);
  base.clients = { status: "error", fetchStatus: "fetching", data: c.clients, dataUpdatedAt: 1000 };
  const av = E.avaliarLedger(base, 0);
  verificar(
    "A7. erro com releitura em andamento continua erro, marcado como recarregando",
    `${av.estado}/${av.recarregando}`,
    "erro/true",
  );
  verificar(
    "A8. e o retry fica indisponível enquanto relê",
    String(E.decidirExibicao(av).podeTentarNovamente),
    "false",
  );
}
{
  const c = cenario();
  const base = retratos(c, { shifts: { fetchStatus: "fetching" } });
  const av = E.avaliarLedger(base, 0);
  verificar(
    "A9. refetch em andamento (com dado em cache) -> atualizando",
    `${av.estado}/${av.motivo}`,
    "atualizando/leitura",
  );
  verificar(
    "A10. atualizando só oferece as linhas como 'anteriores'",
    String(!("rows" in av) && av.rowsAnteriores.length === 3),
    "true",
  );
  const pausada = retratos(c, { entries: { fetchStatus: "paused" } });
  verificar(
    "A11. rede pausada também não é 'pronto'",
    E.avaliarLedger(pausada, 0).estado,
    "atualizando",
  );
}
{
  const c = cenario();
  const base = retratos(c);
  base.entries = { status: "pending", fetchStatus: "fetching", data: undefined, dataUpdatedAt: 0 };
  base.shifts = { status: "error", fetchStatus: "idle", data: undefined, dataUpdatedAt: 0 };
  verificar(
    "A12. uma falha vence outra consulta ainda carregando",
    E.avaliarLedger(base, 0).estado,
    "erro",
  );
}

console.log("\nB. Núcleo: relações ausentes e reconciliação limitada\n");

const casosDeRelacao = [
  [
    "lancamento-sem-folha",
    (c) => ({ ...c, timesheets: c.timesheets.slice(1) }),
    ["entries", "timesheets"],
  ],
  ["folha-sem-operacao", (c) => ({ ...c, operations: [] }), ["timesheets", "operations"]],
  ["operacao-sem-cliente", (c) => ({ ...c, clients: [] }), ["operations", "clients"]],
  [
    "lancamento-sem-colaborador",
    (c) => ({ ...c, employees: c.employees.slice(1) }),
    ["entries", "employees"],
  ],
  ["folha-sem-turno", (c) => ({ ...c, shifts: [] }), ["timesheets", "shifts"]],
];

for (const [tipo, quebrar, consultasEsperadas] of casosDeRelacao) {
  const c = quebrar(cenario());
  const entrada0 = retratos(c);
  const primeira = E.avaliarLedger(entrada0, 0);
  verificar(
    `B-${tipo}-1. 1ª vez que aparece, tudo assentado -> atualizando (reconciliação)`,
    `${primeira.estado}/${primeira.motivo}`,
    "atualizando/reconciliacao",
  );
  const plano = E.planoDeReconciliacao(primeira, entrada0, 0);
  verificar(
    `B-${tipo}-2. plano relê exatamente as duas pontas da relação`,
    JSON.stringify(plano),
    JSON.stringify(E.NOMES_DAS_CONSULTAS.filter((n) => consultasEsperadas.includes(n))),
  );
  const segunda = E.avaliarLedger(entrada0, 1);
  verificar(
    `B-${tipo}-3. persistindo após a releitura -> inconsistente`,
    segunda.estado,
    "inconsistente",
  );
  verificar(
    `B-${tipo}-4. descreve o tipo e a quantidade, sem identificadores`,
    String(segunda.problemas.some((p) => p.tipo === tipo && p.quantidade >= 1)),
    "true",
  );
  verificar(
    `B-${tipo}-5. a mensagem não contém nenhum id`,
    String(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(E.decidirExibicao(segunda).aviso.descricao)),
    "false",
  );
  verificar(
    `B-${tipo}-6. inconsistente não expõe linhas`,
    String("rows" in segunda || "rowsAnteriores" in segunda),
    "false",
  );
  verificar(
    `B-${tipo}-7. com a tentativa gasta não há mais plano (sem laço)`,
    JSON.stringify(E.planoDeReconciliacao(segunda, entrada0, 1)),
    "[]",
  );
}
{
  // Entrada sem relação alguma quebrada não gera plano nem reconciliação.
  const entrada0 = retratos(cenario());
  const av = E.avaliarLedger(entrada0, 0);
  verificar(
    "B8. sem relação ausente não há plano",
    JSON.stringify(E.planoDeReconciliacao(av, entrada0, 0)),
    "[]",
  );
}
{
  // Folhas sem lançamento e operações sem folha NÃO são relações do ledger.
  const c = cenario({
    operations: [
      ...cenario().operations,
      { id: idDe("a1", 9), client_id: idDe("zz", 9), name: "Solta", type: "spot" },
    ],
  });
  verificar(
    "B9. operação que nenhum lançamento usa não bloqueia o ledger",
    E.avaliarLedger(retratos(c), 0).estado,
    "pronto",
  );
}
{
  // Simulação do que o hook faz, em laço. Persistente: UMA reconciliação e para.
  const c = casosDeRelacao[0][1](cenario());
  let tentativa = 0;
  let reconciliacoes = 0;
  const trilha = [];
  for (let i = 0; i < 20; i++) {
    const entrada0 = retratos(c);
    const av = E.avaliarLedger(entrada0, tentativa);
    trilha.push(av.estado);
    const plano = E.planoDeReconciliacao(av, entrada0, tentativa);
    if (plano.length > 0) {
      reconciliacoes++;
      tentativa = 1; // o hook faz setTentativa(1) e invalida o plano; aqui o dado volta igual
      continue;
    }
    if (av.estado === "pronto" && tentativa !== 0) tentativa = 0;
    break;
  }
  verificar("B10. ausência persistente: exatamente 1 reconciliação", String(reconciliacoes), "1");
  verificar("B11. e termina em inconsistente", trilha.at(-1), "inconsistente");
  verificar(
    "B12. trilha: atualizando(reconciliação) -> inconsistente",
    trilha.join(">"),
    "atualizando>inconsistente",
  );
}
{
  // Ausência temporária: a releitura traz a folha que faltava e o estado fecha em pronto.
  const completo = cenario();
  const comFalha = { ...completo, timesheets: completo.timesheets.slice(1) };
  let tentativa = 0;
  let reconciliacoes = 0;
  let fonte = comFalha;
  const trilha = [];
  for (let i = 0; i < 20; i++) {
    const entrada0 = retratos(fonte);
    const av = E.avaliarLedger(entrada0, tentativa);
    trilha.push(av.estado);
    const plano = E.planoDeReconciliacao(av, entrada0, tentativa);
    if (plano.length > 0) {
      reconciliacoes++;
      tentativa = 1;
      fonte = completo; // a releitura achou o registro (leitura em momentos diferentes)
      continue;
    }
    if (av.estado === "pronto" && tentativa !== 0) tentativa = 0;
    break;
  }
  verificar(
    "B13. ausência temporária: 1 reconciliação e fecha em pronto",
    `${reconciliacoes}/${trilha.at(-1)}`,
    "1/pronto",
  );
  verificar(
    "B14. a tentativa volta a zero após o pronto (novo episódio poderá reconciliar)",
    String(tentativa),
    "0",
  );
}

console.log("\nC. Núcleo: política de exibição (KPIs, prévia, CSV)\n");

{
  const c = cenario();
  const base = retratos(c);
  const mapa = {
    pronto: base,
    carregando: {
      ...base,
      entries: { status: "pending", fetchStatus: "fetching", data: undefined, dataUpdatedAt: 0 },
    },
    erro: {
      ...base,
      entries: { status: "error", fetchStatus: "idle", data: c.entries, dataUpdatedAt: 1 },
    },
    atualizando: { ...base, clients: { ...base.clients, fetchStatus: "fetching" } },
    inconsistente: retratos({ ...c, timesheets: [] }),
  };
  const esperado = {
    pronto: [true, false, true],
    atualizando: [true, true, false],
    carregando: [false, false, false],
    erro: [false, false, false],
    inconsistente: [false, false, false],
  };
  for (const [estado, entrada0] of Object.entries(mapa)) {
    const av = E.avaliarLedger(entrada0, estado === "inconsistente" ? 1 : 0);
    const d = E.decidirExibicao(av);
    verificar(`C-${estado}-0. estado obtido`, av.estado, estado);
    verificar(
      `C-${estado}-1. mostrarValores / desatualizados / podeAgir`,
      `${d.mostrarValores}/${d.valoresDesatualizados}/${d.podeAgir}`,
      esperado[estado].join("/"),
    );
    verificar(
      `C-${estado}-2. KPIs, prévia e CSV só liberados em pronto (podeAgir === pronto)`,
      String(d.podeAgir),
      String(estado === "pronto"),
    );
    verificar(
      `C-${estado}-3. sem zero falso: o que não é mostrável nem calcula linhas`,
      String(d.mostrarValores || E.linhasParaExibicao(av).length === 0),
      "true",
    );
    verificar(
      `C-${estado}-4. tem aviso quando não está pronto`,
      String((d.aviso !== null) === (estado !== "pronto")),
      "true",
    );
  }
  const erro = E.decidirExibicao(E.avaliarLedger(mapa.erro, 0));
  verificar("C-erro-5. erro oferece 'tentar novamente'", String(erro.podeTentarNovamente), "true");
  verificar(
    "C-erro-6. a mensagem cita a leitura que falhou",
    String(/lançamentos/.test(erro.aviso.descricao)),
    "true",
  );
  verificar(
    "C-erro-7. e não mostra valor monetário",
    String(/R\$|\d,\d\d/.test(erro.aviso.descricao + erro.aviso.titulo)),
    "false",
  );
  const inc = E.decidirExibicao(E.avaliarLedger(mapa.inconsistente, 1));
  verificar(
    "C-inconsistente-5. oferece 'tentar novamente'",
    String(inc.podeTentarNovamente),
    "true",
  );
  verificar(
    "C-atualizando-5. avisa que os valores são da leitura anterior",
    String(
      /leitura anterior/.test(
        E.decidirExibicao(E.avaliarLedger(mapa.atualizando, 0)).aviso.descricao,
      ),
    ),
    "true",
  );
}

console.log("\nD. Núcleo: fórmulas preservadas (contra a implementação original)\n");

// Cópia fiel do cálculo que `useLedger` fazia antes da A4C (ledger.ts em 4e3b446).
function ledgerOriginal({ entries, timesheets, operations, clients, employees, shifts }) {
  const tsMap = new Map(timesheets.map((t) => [t.id, t]));
  const opMap = new Map(operations.map((o) => [o.id, o]));
  const clMap = new Map(clients.map((c) => [c.id, c]));
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const shMap = new Map(shifts.map((s) => [s.id, s]));
  return entries
    .map((entry) => {
      const ts = tsMap.get(entry.timesheet_id);
      if (!ts) return null;
      const op = opMap.get(ts.operation_id);
      const client = op ? clMap.get(op.client_id) : undefined;
      const shift = ts.shift_id ? shMap.get(ts.shift_id) : undefined;
      return {
        entryId: entry.id,
        timesheetId: ts.id,
        date: ts.work_date,
        clientId: op?.client_id ?? "",
        clientName: client?.name ?? "—",
        operationId: op?.id ?? "",
        operationName: op?.name ?? "—",
        operationType: op?.type ?? "fixed",
        shiftName: shift?.name ?? "—",
        employeeId: entry.employee_id,
        employeeName: empMap.get(entry.employee_id)?.name ?? "—",
        status: entry.status,
        workedMinutes: entry.worked_minutes,
        overtimeMinutes: entry.overtime_minutes,
        dailies: entry.status === "absent" ? 0 : 1,
        billed: Number(entry.billed_amount ?? 0),
        // FIN-PR-03: o legado decompõe pela regra de sempre; a diária é o cobrado menos a HE, e não
        // há horas especiais nem adicional diário.
        dailyValue:
          entry.status === "absent"
            ? 0
            : Number(entry.billed_amount ?? 0) -
              Math.max(
                0,
                Number(entry.billed_amount ?? 0) - Number(entry.daily_rate_snapshot ?? 0),
              ),
        otValue:
          entry.status === "absent"
            ? 0
            : Math.max(
                0,
                Number(entry.billed_amount ?? 0) - Number(entry.daily_rate_snapshot ?? 0),
              ),
        specialValue: 0,
        additionalValue: 0,
        cost: Number(entry.cost_amount ?? 0),
        invoiceId: entry.invoice_id,
        timesheetStatus: ts.status,
      };
    })
    .filter((r) => r !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

{
  const c = cenario();
  const novo = E.montarLinhas(c);
  verificar(
    "D1. sem relação ausente, as linhas são idênticas às do cálculo original",
    JSON.stringify(novo.rows),
    JSON.stringify(ledgerOriginal(c)),
  );
  verificar("D2. e não há problema de relação", String(novo.problemas.length), "0");
  const soma = (campo) => novo.rows.reduce((s, r) => s + r[campo], 0);
  verificar("D3. receita = soma de billed_amount", String(soma("billed")), "460");
  verificar("D4. custo = soma de cost_amount", String(soma("cost")), "300");
  verificar("D5. diárias: falta não conta", String(soma("dailies")), "2");
  verificar(
    "D6. hora extra em valor = billed - taxa da diária (mínimo 0)",
    String(soma("otValue")),
    String(50 + 60),
  );
  verificar(
    "D7. faturado (invoiceId) preservado",
    String(novo.rows.filter((r) => r.invoiceId !== null).length),
    "1",
  );
}
{
  // volume: 2501 lançamentos, mesmas fórmulas
  const base = cenario();
  const muitos = Array.from({ length: 2501 }, (_, i) => ({
    ...base.entries[i % 3],
    id: idDe("f9", i + 1),
    timesheet_id: base.timesheets[i % 2].id,
    employee_id: base.employees[i % 3].id,
  }));
  const c = { ...base, entries: muitos };
  verificar(
    "D8. 2501 lançamentos: linhas idênticas ao cálculo original",
    JSON.stringify(E.montarLinhas(c).rows),
    JSON.stringify(ledgerOriginal(c)),
  );
}
{
  // única divergência intencional: relação ausente não vira "—" nem some em silêncio
  const c = cenario({ employees: [] });
  const original = ledgerOriginal(c);
  const novo = E.montarLinhas(c);
  verificar(
    "D9. (intencional) o cálculo original mostrava '—' para colaborador ausente",
    original[0].employeeName,
    "—",
  );
  verificar(
    "D10. (intencional) agora a linha sai de 'rows' e entra na contagem de problemas",
    `${novo.rows.length}/${novo.problemas[0].quantidade}`,
    "0/3",
  );
}

console.log("\nE. Hook real (useLedger) sobre React Query\n");

const CHAVES = {
  entries: ["timesheet_entries"],
  timesheets: ["timesheets"],
  operations: ["operations"],
  clients: ["clients"],
  employees: ["employees"],
  shifts: ["shifts"],
};

function novoCliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function semear(cliente, c) {
  for (const nome of NOMES) cliente.setQueryData(CHAVES[nome], c[nome]);
}

function lerHook(cliente) {
  let captado;
  function Componente() {
    captado = useLedger();
    return null;
  }
  renderToString(
    React.createElement(QueryClientProvider, { client: cliente }, React.createElement(Componente)),
  );
  return captado;
}

{
  const cliente = novoCliente();
  const l = lerHook(cliente);
  verificar("E1. cache vazio: carregando (nunca pronto com zeros)", l.estado, "carregando");
  verificar(
    "E2. carregando não traz linhas",
    String("rows" in l || "rowsAnteriores" in l),
    "false",
  );
}
{
  const cliente = novoCliente();
  const c = cenario();
  semear(cliente, c);
  const l = lerHook(cliente);
  verificar("E3. cache completo: pronto", l.estado, "pronto");
  verificar(
    "E4. as linhas do hook são as do cálculo original (queryKeys preservadas)",
    JSON.stringify(l.rows),
    JSON.stringify(ledgerOriginal(c)),
  );
  verificar("E5. expõe 'tentarNovamente'", typeof l.tentarNovamente, "function");
}
{
  const cliente = novoCliente();
  semear(cliente, Object.fromEntries(NOMES.map((n) => [n, []])));
  const l = lerHook(cliente);
  verificar(
    "E6. tudo legitimamente vazio: pronto com 0 linhas",
    `${l.estado}/${l.rows?.length}`,
    "pronto/0",
  );
}
for (const nome of NOMES) {
  const cliente = novoCliente();
  semear(cliente, cenario());
  // refetch que FALHA com dado antigo em cache: status vira error, data antiga permanece
  await cliente
    .fetchQuery({
      queryKey: CHAVES[nome],
      queryFn: () => Promise.reject(new Error("falha")),
      staleTime: 0,
    })
    .catch(() => {});
  const estadoDaQuery = cliente.getQueryState(CHAVES[nome]);
  const l = lerHook(cliente);
  verificar(
    `E7-${nome}a. a query falhou e ainda guarda o dado antigo`,
    `${estadoDaQuery.status}/${estadoDaQuery.data !== undefined}`,
    "error/true",
  );
  verificar(
    `E7-${nome}b. o ledger NÃO usa o dado antigo: erro`,
    `${l.estado}/${l.falhas?.join(",")}`,
    `erro/${nome}`,
  );
  verificar(
    `E7-${nome}c. e não expõe linhas`,
    String("rows" in l || "rowsAnteriores" in l),
    "false",
  );
}
{
  // falha sem nenhum dado. `retryOnMount: false` isola o estado de erro: com o padrão do
  // React Query, montar o hook sobre uma query em erro dispara uma nova tentativa (e o
  // ledger mostra `carregando` enquanto ela corre), o que também é correto e não zera nada.
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, retryOnMount: false } },
  });
  await cliente
    .fetchQuery({ queryKey: CHAVES.clients, queryFn: () => Promise.reject(new Error("falha")) })
    .catch(() => {});
  const l = lerHook(cliente);
  verificar("E8. falha na primeira carga -> erro (não zero)", l.estado, "erro");
}
{
  // refetch em andamento e depois concluído
  const cliente = novoCliente();
  const c = cenario();
  semear(cliente, c);
  let liberar;
  const travada = new Promise((r) => (liberar = r));
  const emAndamento = cliente.fetchQuery({
    queryKey: CHAVES.entries,
    queryFn: () => travada,
    staleTime: 0,
  });
  await Promise.resolve();
  const durante = lerHook(cliente);
  verificar(
    "E9. refetch em andamento -> atualizando",
    `${durante.estado}/${durante.motivo}`,
    "atualizando/leitura",
  );
  verificar(
    "E10. as linhas só aparecem como 'anteriores'",
    String(!("rows" in durante) && durante.rowsAnteriores.length === 3),
    "true",
  );
  verificar(
    "E11. durante o refetch não se pode agir (CSV, fatura)",
    String(E.decidirExibicao(durante).podeAgir),
    "false",
  );
  const novas = c.entries.slice(0, 2);
  liberar(novas);
  await emAndamento;
  const depois = lerHook(cliente);
  verificar("E12. refetch bem-sucedido -> pronto", depois.estado, "pronto");
  verificar("E13. com o dado novo (2 lançamentos)", String(depois.rows.length), "2");
  verificar(
    "E14. e a ação volta a ser permitida",
    String(E.decidirExibicao(depois).podeAgir),
    "true",
  );
}
{
  // relação ausente no hook: sem efeitos (renderToString), o estado inicial é a reconciliação
  const cliente = novoCliente();
  semear(cliente, cenario({ timesheets: [] }));
  const l = lerHook(cliente);
  verificar(
    "E15. relação ausente: atualizando (reconciliação pendente), nunca pronto",
    `${l.estado}/${l.motivo}`,
    "atualizando/reconciliacao",
  );
  verificar("E16. nada de pronto com lançamentos descartados", String("rows" in l), "false");
}

console.log("\nF. Telas: ligação ao estado (forma do código, só como complemento)\n");

const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const telas = {
  Dashboard: ler("src/app/(painel)/dashboard/painel-dashboard.tsx"),
  Faturamento: ler("src/app/(painel)/faturamento/painel-faturamento.tsx"),
  Relatorios: ler("src/app/(painel)/relatorios/painel-relatorios.tsx"),
};

for (const [nome, fonte] of Object.entries(telas)) {
  verificar(
    `F-${nome}-1. decide a exibição por decidirExibicao(ledger)`,
    String(/decidirExibicao\(ledger\)/.test(fonte)),
    "true",
  );
  verificar(
    `F-${nome}-2. não extrai 'rows' direto do useLedger`,
    String(/const\s*\{[^}]*\brows\b[^}]*\}\s*=\s*useLedger\(\)/.test(fonte)),
    "false",
  );
  verificar(
    `F-${nome}-3. não depende de isLoading do ledger`,
    String(/isLoading[^\n]*useLedger|useLedger[^\n]*isLoading/.test(fonte)),
    "false",
  );
  verificar(
    `F-${nome}-4. oferece 'tentar novamente' quando cabe`,
    String(/tentarNovamente/.test(fonte)),
    "true",
  );
  verificar(
    `F-${nome}-5. aviso acessível (role="alert")`,
    String(/role="alert"/.test(fonte)),
    "true",
  );
}
for (const nome of ["Faturamento", "Relatorios"]) {
  const fonte = telas[nome];
  verificar(
    `F-${nome}-6. exportCsv recusa quando o ledger não está pronto (primeira instrução)`,
    String(/function exportCsv\(\) \{\s*if \(!exibicao\.podeAgir\) return;/.test(fonte)),
    "true",
  );
  verificar(
    `F-${nome}-7. botão de CSV desabilitado fora de 'pronto'`,
    String(/onClick=\{exportCsv\}\s*disabled=\{[^}]*!exibicao\.podeAgir/.test(fonte)),
    "true",
  );
  verificar(
    `F-${nome}-8. os valores só renderizam com mostrarValores`,
    String(/exibicao\.mostrarValores && \(/.test(fonte)),
    "true",
  );
}
{
  const f = telas.Faturamento;
  verificar(
    "F-Faturamento-9. 'Gerar fatura' exige ledger pronto",
    String(/disabled=\{[^}]*!exibicao\.podeAgir \|\| generate\.isPending/.test(f)),
    "true",
  );
  verificar(
    "F-Faturamento-10. a mutação também recusa fora de 'pronto'",
    String(/mutationFn: async \(\) => \{[\s\S]*?if \(!exibicao\.podeAgir\) \{\s*throw/.test(f)),
    "true",
  );
  verificar(
    "F-Faturamento-11. a RPC gerar_fatura segue com os mesmos parâmetros",
    String(
      /rpc\("gerar_fatura", \{\s*_client_id: selectedClient,\s*_period_start: start,\s*_period_end: end,\s*\}\)/.test(
        f,
      ),
    ),
    "true",
  );
  verificar(
    "F-Faturamento-12. lista de faturas com erro não vira 'nenhuma fatura'",
    String(/invoices\.isError/.test(f)),
    "true",
  );
}
{
  const d = telas.Dashboard;
  verificar(
    "F-Dashboard-6. esqueleto só na primeira carga (carregando)",
    String(/ledger\.estado === "carregando"/.test(d)),
    "true",
  );
  verificar(
    "F-Dashboard-7. KPIs só no ramo com mostrarValores",
    String(/!exibicao\.mostrarValores/.test(d)),
    "true",
  );
}

console.log("\nG. Pureza do núcleo e sem laço de invalidação\n");

{
  const nucleo = ler("src/lib/ledger-estado.ts");
  // FIN-PR-03: o único valor importado é a regra compartilhada dos componentes, que por sua vez
  // não importa nada (a suíte segue rodando o núcleo direto, com o resolvedor de .ts).
  verificar(
    "G1. núcleo só importa tipos e a regra dos componentes (sem dependência própria)",
    String(
      [...nucleo.matchAll(/^\s*import\s+(?!type\b)[^;]*from\s+"([^"]+)"/gm)]
        .map((m) => m[1])
        .join(","),
    ),
    "./componentes-financeiros",
  );
  verificar(
    "G1b. a regra dos componentes não importa nada em tempo de execução",
    String(/^\s*import\s+(?!type\b)/m.test(ler("src/lib/componentes-financeiros.ts"))),
    "false",
  );
  verificar(
    "G2. sem rede, ambiente ou console",
    String(/\bfetch\(|process\.env|console\./.test(nucleo)),
    "false",
  );
  const hook = ler("src/lib/ledger.ts");
  const chamadas = (hook.match(/relerConsultas\(/g) ?? []).length;
  verificar(
    "G3. a releitura é disparada em só 2 lugares (reconciliação e retry do usuário)",
    String(chamadas),
    "2",
  );
  verificar(
    "G4. a reconciliação usa a tentativa única (setTentativa(1) antes de reler)",
    String(/setTentativa\(1\);\s*relerConsultas\(plano\)/.test(hook)),
    "true",
  );
}

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
