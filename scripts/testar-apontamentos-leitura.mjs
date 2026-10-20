/**
 * Testes da proteção de leitura da tela de Apontamentos (C03, A4D).
 *
 * COMO RODAR:
 *
 *   npm run test:apontamentos-leitura
 *
 * O QUE É REAL
 *   - A decisão `avaliarLeituraDeApontamentos` / `avisoDaLeitura` é o código da própria
 *     tela: o bloco entre os marcadores `leitura-de-apontamentos:inicio/fim` de
 *     `painel-apontamentos.tsx` é extraído, tem os tipos removidos
 *     (`module.stripTypeScriptTypes`, Node >= 22.13) e é executado. Nada é copiado
 *     para cá.
 *   - Os seis hooks de `src/lib/queries.ts` rodam sobre um React Query real com o
 *     cache semeado (via `renderToString`), e seus resultados entram na decisão
 *     exatamente como a tela os passa.
 *
 * O QUE NÃO É VALIDADO AQUI (limite declarado)
 *   O componente é `.tsx` e este runner não executa JSX nem tem ambiente DOM
 *   (não há jsdom/testing-library nas dependências, e nenhuma pode ser instalada
 *   nesta etapa). Portanto NÃO foi executada a renderização da tela: a ligação da
 *   decisão aos botões, às mutações e ao aviso é conferida pela FORMA do código
 *   (seção E), só como complemento. A preservação do rascunho e a lógica de salvar
 *   são conferidas pelo diff (que não as toca) e por estas verificações de forma,
 *   não por execução do componente.
 */

import { register, stripTypeScriptTypes } from "node:module";
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
const Q = await import("../src/lib/queries.ts");

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

// ---------------------------------------------------------------------------
// Extração do código real da tela
// ---------------------------------------------------------------------------

const arquivoDaTela = "src/app/(painel)/apontamentos/painel-apontamentos.tsx";
const fonteDaTela = readFileSync(path.join(RAIZ, arquivoDaTela), "utf8");
const inicio = fonteDaTela.indexOf("// === leitura-de-apontamentos:inicio ===");
const fim = fonteDaTela.indexOf("// === leitura-de-apontamentos:fim ===");
if (inicio < 0 || fim < inicio) throw new Error("marcadores do bloco de leitura não encontrados");
const bloco = fonteDaTela.slice(inicio, fim);
const js = stripTypeScriptTypes(bloco, { mode: "strip" });
const { avaliarLeituraDeApontamentos, avisoDaLeitura } = await import(
  `data:text/javascript,${encodeURIComponent(`${js}\nexport { avaliarLeituraDeApontamentos, avisoDaLeitura };`)}`
);

// ---------------------------------------------------------------------------
// Hooks reais sobre cache real
// ---------------------------------------------------------------------------

const CHAVES = {
  operations: ["operations"],
  shifts: ["shifts"],
  employees: ["employees"],
  team: ["operation_team"],
  timesheets: ["timesheets"],
  entries: ["timesheet_entries"],
};
const NOMES = Object.keys(CHAVES);

const dados = () => ({
  operations: [{ id: "op1", name: "Operação 1", client_id: "c1" }],
  shifts: [{ id: "t1", operation_id: "op1", name: "Manhã" }],
  employees: [{ id: "e1", name: "Ana", daily_cost: 100 }],
  team: [{ id: "m1", operation_id: "op1", shift_id: "t1", employee_id: "e1", active: true }],
  timesheets: [
    { id: "f1", operation_id: "op1", shift_id: "t1", work_date: "2026-10-01", status: "open" },
  ],
  entries: [{ id: "l1", timesheet_id: "f1", employee_id: "e1", status: "present" }],
});

function novoCliente() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, retryOnMount: false } },
  });
}
const semear = (cliente, d) => NOMES.forEach((n) => cliente.setQueryData(CHAVES[n], d[n]));

/** Roda os seis hooks como a tela os chama e devolve a leitura + o "carregando" ANTIGO da tela. */
function lerTela(cliente) {
  let saida;
  function Componente() {
    const operations = Q.useOperations();
    const shifts = Q.useShifts();
    const employees = Q.useEmployees();
    const team = Q.useTeam();
    const timesheets = Q.useTimesheets();
    const entries = Q.useEntries();
    saida = {
      leitura: avaliarLeituraDeApontamentos({
        operations,
        shifts,
        employees,
        team,
        timesheets,
        entries,
      }),
      // a expressão que a tela usava ANTES da A4D para decidir se podia montar/salvar
      carregandoAntigo:
        shifts.isLoading || team.isLoading || timesheets.isLoading || entries.isLoading,
      // o que a tela faz com `data ?? []` ao procurar a folha
      folhas: timesheets.data ?? [],
    };
    return null;
  }
  renderToString(
    React.createElement(QueryClientProvider, { client: cliente }, React.createElement(Componente)),
  );
  return saida;
}

const falhar = (cliente, nome) =>
  cliente
    .fetchQuery({
      queryKey: CHAVES[nome],
      queryFn: () => Promise.reject(new Error("falha")),
      staleTime: 0,
    })
    .catch(() => {});

console.log("\nA. Estados da leitura (hooks reais)\n");

{
  const r = lerTela(novoCliente());
  verificar("A1. primeira carga (cache vazio) -> carregando", r.leitura.estado, "carregando");
  verificar(
    "A2. com aviso de carregamento",
    String(avisoDaLeitura(r.leitura)?.titulo),
    "Carregando os dados do apontamento…",
  );
}
{
  const cliente = novoCliente();
  semear(cliente, dados());
  const r = lerTela(cliente);
  verificar("A3. leitura completa -> pronto", r.leitura.estado, "pronto");
  verificar("A4. pronto não mostra aviso", String(avisoDaLeitura(r.leitura)), "null");
}
{
  const cliente = novoCliente();
  semear(cliente, Object.fromEntries(NOMES.map((n) => [n, []])));
  const r = lerTela(cliente);
  verificar(
    "A5. resultado legitimamente vazio -> pronto (não é erro nem carregando)",
    r.leitura.estado,
    "pronto",
  );
}

console.log("\nB. Falha de leitura nunca vira ausência legítima\n");

const ROTULO = {
  operations: "operações",
  shifts: "turnos",
  employees: "colaboradores",
  team: "equipe",
  timesheets: "folhas",
  entries: "lançamentos",
};

for (const nome of NOMES) {
  const cliente = novoCliente();
  semear(cliente, dados());
  await falhar(cliente, nome); // erro COM dado antigo em cache
  const r = lerTela(cliente);
  verificar(
    `B-${nome}1. erro com dado antigo em cache -> erro`,
    `${r.leitura.estado}/${r.leitura.falhas?.join(",")}`,
    `erro/${nome}`,
  );
  verificar(
    `B-${nome}2. o aviso nomeia a leitura que falhou`,
    String(avisoDaLeitura(r.leitura)?.descricao.includes(ROTULO[nome])),
    "true",
  );
  verificar(
    `B-${nome}3. o aviso diz que salvar fica bloqueado e que o rascunho foi mantido`,
    String(
      /bloqueados/.test(avisoDaLeitura(r.leitura).descricao) &&
        /foi mantido/.test(avisoDaLeitura(r.leitura).descricao),
    ),
    "true",
  );

  const semDado = novoCliente();
  const d = dados();
  semear(semDado, { ...d, [nome]: undefined });
  semDado.removeQueries({ queryKey: CHAVES[nome], exact: true });
  await falhar(semDado, nome);
  verificar(`B-${nome}4. erro sem nenhum dado -> erro`, lerTela(semDado).leitura.estado, "erro");
}
{
  // O defeito original: com a folha sem ser lida, a tela via "não há folha" e o salvamento criaria outra.
  const cliente = novoCliente();
  const d = dados();
  semear(cliente, { ...d, timesheets: undefined });
  cliente.removeQueries({ queryKey: CHAVES.timesheets, exact: true });
  await falhar(cliente, "timesheets");
  const r = lerTela(cliente);
  const folhaDoContexto = r.folhas.find(
    (f) => f.operation_id === "op1" && f.work_date === "2026-10-01",
  );
  verificar(
    "B-folha1. folha existente, leitura falha: a tela enxerga 'sem folha' (o risco)",
    String(folhaDoContexto),
    "undefined",
  );
  verificar(
    "B-folha2. a expressão antiga ('isLoading') liberaria o salvamento",
    String(!r.carregandoAntigo),
    "true",
  );
  verificar("B-folha3. a leitura bloqueia: erro, não pronto", r.leitura.estado, "erro");
}
{
  // colaboradores: a tela antiga nem olhava para esta consulta
  const cliente = novoCliente();
  semear(cliente, dados());
  await falhar(cliente, "employees");
  const r = lerTela(cliente);
  verificar(
    "B-colab1. erro na lista de colaboradores -> erro (antes: ignorado, custo calculado com 0)",
    r.leitura.estado,
    "erro",
  );
  verificar("B-colab2. a expressão antiga não percebia", String(!r.carregandoAntigo), "true");
}
{
  const cliente = novoCliente();
  const d = dados();
  semear(cliente, d);
  await falhar(cliente, "team");
  await falhar(cliente, "shifts");
  const r = lerTela(cliente);
  verificar(
    "B-multi. equipe e turnos falham juntos -> as duas aparecem",
    r.leitura.falhas.join(","),
    "shifts,team",
  );
}

console.log("\nC. Atualização, recuperação e retorno ao pronto\n");

{
  const cliente = novoCliente();
  semear(cliente, dados());
  let liberar;
  const travada = new Promise((r) => (liberar = r));
  const emAndamento = cliente.fetchQuery({
    queryKey: CHAVES.timesheets,
    queryFn: () => travada,
    staleTime: 0,
  });
  await Promise.resolve();
  const durante = lerTela(cliente);
  verificar("C1. refetch em andamento -> atualizando", durante.leitura.estado, "atualizando");
  verificar(
    "C2. avisa que salvar e fechar ficam indisponíveis e que o rascunho foi mantido",
    String(
      /indisponíveis/.test(avisoDaLeitura(durante.leitura).descricao) &&
        /foi mantido/.test(avisoDaLeitura(durante.leitura).descricao),
    ),
    "true",
  );
  liberar([]);
  await emAndamento;
  verificar("C3. refetch concluído -> pronto", lerTela(cliente).leitura.estado, "pronto");
}
{
  const cliente = novoCliente();
  semear(cliente, dados());
  await falhar(cliente, "entries");
  verificar("C4. depois do erro: erro", lerTela(cliente).leitura.estado, "erro");
  // o usuário aperta "Tentar novamente" (invalidate -> nova leitura que dá certo)
  await cliente.fetchQuery({
    queryKey: CHAVES.entries,
    queryFn: () => Promise.resolve(dados().entries),
    staleTime: 0,
  });
  const r = lerTela(cliente);
  verificar("C5. recuperação após erro -> pronto novamente", r.leitura.estado, "pronto");
  verificar("C6. e o aviso some", String(avisoDaLeitura(r.leitura)), "null");
}
{
  // erro durante um refetch: a falha vence a atualização
  const cliente = novoCliente();
  semear(cliente, dados());
  await falhar(cliente, "operations");
  const outra = cliente.fetchQuery({
    queryKey: CHAVES.shifts,
    queryFn: () => new Promise(() => {}),
    staleTime: 0,
  });
  void outra;
  await Promise.resolve();
  verificar(
    "C7. uma consulta em erro e outra atualizando -> erro (a falha vence)",
    lerTela(cliente).leitura.estado,
    "erro",
  );
}

console.log("\nD. Decisão em estado puro (todas as combinações relevantes)\n");

{
  const ok = { status: "success", fetchStatus: "idle", data: [] };
  const base = Object.fromEntries(NOMES.map((n) => [n, ok]));
  verificar("D1. tudo certo -> pronto", avaliarLeituraDeApontamentos(base).estado, "pronto");
  verificar(
    "D2. rede pausada não é pronto",
    avaliarLeituraDeApontamentos({ ...base, team: { ...ok, fetchStatus: "paused" } }).estado,
    "atualizando",
  );
  verificar(
    "D3. sucesso sem dado (data indefinido) não é pronto",
    avaliarLeituraDeApontamentos({ ...base, shifts: { ...ok, data: undefined } }).estado,
    "carregando",
  );
  verificar(
    "D4. pendente sem erro -> carregando",
    avaliarLeituraDeApontamentos({
      ...base,
      entries: { status: "pending", fetchStatus: "fetching", data: undefined },
    }).estado,
    "carregando",
  );
  verificar(
    "D5. erro vence carregando",
    avaliarLeituraDeApontamentos({
      ...base,
      entries: { status: "pending", fetchStatus: "fetching", data: undefined },
      team: { status: "error", fetchStatus: "idle", data: undefined },
    }).estado,
    "erro",
  );
  const soPronto = ["carregando", "erro", "atualizando", "pronto"].map((e) => [e, e === "pronto"]);
  verificar(
    "D6. só 'pronto' autoriza ação (a tela usa leitura.estado === 'pronto')",
    JSON.stringify(soPronto),
    JSON.stringify([
      ["carregando", false],
      ["erro", false],
      ["atualizando", false],
      ["pronto", true],
    ]),
  );
}

console.log(
  "\nE. Ligação na tela (forma do código, só como complemento — a renderização NÃO foi executada)\n",
);

{
  const t = fonteDaTela;
  verificar(
    "E1. o salvamento recusa fora de 'pronto' antes de qualquer outra coisa",
    String(
      /const saveAll = useMutation\(\{\s*mutationFn: async \(\) => \{[^}]*?if \(leitura\.estado !== "pronto"\) \{\s*throw new Error/.test(
        t,
      ),
    ),
    "true",
  );
  verificar(
    "E2. o botão Salvar fica desabilitado fora de 'pronto'",
    String(/leitura\.estado !== "pronto" \|\|\s*saveAll\.isPending/.test(t)),
    "true",
  );
  verificar(
    "E3. fechar/reabrir recusa fora de 'pronto' (mutação e botão)",
    String(
      /mutationFn: async \(status: "open" \| "closed"\) => \{\s*if \(leitura\.estado !== "pronto"\)/.test(
        t,
      ) && /disabled=\{!timesheet \|\| leitura\.estado !== "pronto"\}/.test(t),
    ),
    "true",
  );
  verificar(
    "E4. aviso acessível e botão de nova leitura só no erro",
    String(/role="alert"/.test(t) && /leitura\.estado === "erro" \? \(\s*<Button/.test(t)),
    "true",
  );
  verificar(
    "E5. 'Tentar novamente' relê só as seis consultas da tela, sem laço",
    String(
      /function tentarLerDeNovo\(\)/.test(t) && (t.match(/tentarLerDeNovo/g) ?? []).length === 2,
    ),
    "true",
  );
  verificar(
    "E6. o bloco de leitura não toca no rascunho",
    String(/setDraft|dirty|draft/.test(bloco)),
    "false",
  );
  verificar(
    "E7. o bloco de leitura é autocontido (sem imports nem chamadas de rede)",
    String(/\bimport\b|\bfetch\(|criarClienteNavegador|useQuery/.test(bloco)),
    "false",
  );
  verificar(
    "E8. a criação da folha e o upsert seguem como estavam",
    String(
      /\.from\("timesheets"\)\s*\.insert\(\{\s*operation_id: operationId,\s*shift_id: turnoId \|\| null,\s*work_date: date,\s*status: "open",/.test(
        t,
      ) && /\.from\("timesheet_entries"\)\.upsert\(payload\)/.test(t),
    ),
    "true",
  );
  verificar(
    "E9. o efeito que monta o rascunho continua condicionado só a 'carregando' (inalterado)",
    String(
      /useEffect\(\(\) => \{\s*if \(carregando\) \{\s*return;\s*\}\s*const base = teamMembers\.map/.test(
        t,
      ),
    ),
    "true",
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
