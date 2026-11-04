import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const base = path.resolve("src/app/(painel)/containers");
const nativeRequire = createRequire(import.meta.url);
const read = (file) =>
  fs.existsSync(path.join(base, file)) ? fs.readFileSync(path.join(base, file), "utf8") : "";

// Compila os componentes reais sem servidor Next ou credenciais. Só as fronteiras
// de sessão, rede e navegador são substituídas; domínio e intenção são os reais.
function carregarModulo(file, resolver) {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", output)(resolver, module.exports, module);
  return module.exports;
}
const dominio = carregarModulo(path.resolve("src/lib/container-servico.ts"), nativeRequire);
const adicionaisDominio = carregarModulo(path.resolve("src/lib/adicionais.ts"), nativeRequire);
const containerUi = carregarModulo(path.resolve("src/lib/container-servico-ui.ts"), nativeRequire);
const formatos = carregarModulo(path.resolve("src/lib/format.ts"), nativeRequire);
const intencoes = carregarModulo(path.resolve("src/lib/container-servico-intencao.ts"), (id) =>
  id === "./container-servico" ? dominio : nativeRequire(id),
);

for (const route of ["page.tsx", "novo/page.tsx", "[id]/page.tsx"]) {
  test(`${route}: bloqueia antes de renderizar a interface administrativa`, async () => {
    const source = read(route);
    assert.match(source, /await exigirAdmin\(\)/);
    const bloqueio = { restrito: true };
    let negado = true;
    const pagina = carregarModulo(path.join(base, route), (id) => {
      if (id.includes("_exigir-admin")) {
        return { exigirAdmin: async () => (negado ? bloqueio : null) };
      }
      if (id.includes("lista-containers")) return { ListaContainers: "lista" };
      if (id.includes("formulario-container")) return { FormularioContainer: "formulario" };
      if (id.includes("detalhe-container")) return { DetalheDoContainer: "detalhe" };
      return nativeRequire(id);
    });
    const props = { params: Promise.resolve({ id: "identificador" }) };
    assert.equal(await pagina.default(props), bloqueio);
    negado = false;
    const resultado = await pagina.default(props);
    assert.ok(["lista", "formulario", "detalhe"].includes(resultado.type));
    if (route === "[id]/page.tsx") assert.equal(resultado.props.id, "identificador");
  });
}

test("formulário preserva identidade, intenção e reconciliação antes de nova tentativa", () => {
  const source = read("formulario-container.tsx");
  assert.match(source, /recuperarIntencao\(sessionStorage, dados.userId\)/);
  assert.match(source, /recuperarIntencaoContainerAction/);
  assert.match(source, /assertPayloadDaIntencao/);
  assert.match(source, /salvarIntencao\(sessionStorage/);
  assert.match(source, /useRef\(false\)/);
  assert.match(source, /prepararLoteDeContainers/);
  assert.match(source, /Revisar serviço/);
  assert.match(source, /Confirmar registro/);
  assert.doesNotMatch(source, /\.from\(|\.rpc\(/);
});
test("lista oferece filtros e distingue falha de lista vazia", () => {
  const source = read("lista-containers.tsx");
  for (const key of ["clienteId", "inicio", "fim", "situacao"]) assert.ok(source.includes(key));
  assert.match(source, /Nenhum serviço encontrado/);
  assert.match(source, /Não foi possível carregar/);
  assert.match(source, /sort\(/);
  assert.doesNotMatch(source, /\.from\(|\.rpc\(/);
});
test("cancelamento exige motivo, confirmação e consulta após resposta desconhecida", () => {
  const source = read("detalhe-container.tsx");
  assert.match(source, /situacao === "disponivel"/);
  assert.match(source, /Confirmar cancelamento/);
  assert.match(source, /motivo\.trim\(\)/);
  assert.match(source, /carregarContainerAction\(id\)/);
  assert.match(source, /indeterminad/);
  assert.doesNotMatch(source, /\.from\(|\.rpc\(/);
});

const userId = "10000000-0000-4000-8000-000000000001";
const clienteId = "20000000-0000-4000-8000-000000000001";
const colaboradorId = "30000000-0000-4000-8000-000000000001";
const servicoId = "40000000-0000-4000-8000-000000000001";
const dados = {
  userId,
  clientes: [{ id: clienteId, name: "Cliente" }],
  colaboradores: [{ id: colaboradorId, name: "Colaborador" }],
  operacoes: [],
};
const lote = {
  clienteId,
  operacaoId: null,
  solicitadoEm: "2026-11-01",
  executadoEm: "2026-11-02",
  descricao: "Descarga",
  quantidade: 2,
  totalCobrado: "100,00",
  participantes: [{ colaboradorId, valorDevido: "0" }],
  modalidadeCusto: "por_pessoa",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function navegador(acoes = {}, conteudo = null, config = {}) {
  const states = [];
  const refs = [];
  const effects = [];
  const eventos = [];
  let cursor = 0;
  let refCursor = 0;
  let primeiro = true;
  let tree;
  let persistenciaFalha = false;
  const storage = new Map(conteudo ? [[`bs:container:intencao:v1:${userId}`, conteudo]] : []);
  const anteriores = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem(key) {
        eventos.push(["ler", key]);
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        eventos.push(["salvar", key]);
        if (persistenciaFalha) throw new Error("Armazenamento indisponível");
        storage.set(key, value);
      },
      removeItem(key) {
        eventos.push(["remover", key]);
        storage.delete(key);
      },
    },
  });
  const actions = {
    carregarFormularioContainerAction: async () => {
      eventos.push(["identidade"]);
      return { ok: true, data: dados };
    },
    recuperarIntencaoContainerAction: async (...args) => {
      eventos.push(["conferir", ...args]);
      return { ok: true, data: { estado: "ausente" } };
    },
    registrarContainerAction: async (args) => {
      eventos.push(["registrar", args]);
      return { ok: true, data: { id: servicoId } };
    },
    carregarContainersAction: async () => ({ ok: true, data: { servicos: [] } }),
    ...acoes,
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (valor) => {
          states[index] = typeof valor === "function" ? valor(states[index]) : valor;
        },
      ];
    },
    useRef(initial) {
      const index = refCursor++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useEffect(fn) {
      if (primeiro) effects.push(fn);
    },
    useCallback(fn) {
      return fn;
    },
  };
  const component = carregarModulo(
    path.join(base, config.arquivo ?? "formulario-container.tsx"),
    (id) => {
      if (id === "react") return hooks;
      if (id === "./_acoes" || id === "../containers/_acoes") return actions;
      if (id === "next/navigation") return { useRouter: () => config.router };
      if (id === "@/lib/adicionais") return adicionaisDominio;
      if (id === "@/lib/container-servico-ui") return containerUi;
      if (id === "@/lib/format") return formatos;
      if (id === "@/lib/fechamento/periodo") return { competenciasDoMes: () => [] };
      if (id === "@/lib/vigencias-dados") {
        return { useCompetenciaDeCobranca: () => ({ data: null, isError: false }) };
      }
      if (id === "@/lib/vigencias-ui") return { ROTULO_DA_FREQUENCIA: {} };
      if (id === "@/lib/adicionais-dados") {
        return {
          useRegistrarAdicional: () => ({ isPending: false }),
          useCancelarAdicional: () => ({ isPending: false, mutateAsync: config.cancelar }),
        };
      }
      if (id === "@/lib/container-servico") return dominio;
      if (id === "@/lib/container-servico-intencao") return intencoes;
      if (id === "@tanstack/react-query") {
        return {
          useQuery: () =>
            config.consulta ?? { data: { ok: true, data: { servicos: [] } }, isError: false },
          useQueryClient: () => ({
            invalidateQueries: async (key) => eventos.push(["invalidar", key]),
          }),
        };
      }
      if (id === "./lista-containers") return { dinheiroContainer: (valor) => `${valor} centavos` };
      if (id === "next/link") return { default: "a" };
      if (id.includes("/ui/") || id.includes("app-shell") || id === "lucide-react") {
        return new Proxy({}, { get: (_, nome) => nome });
      }
      return nativeRequire(id);
    },
  );
  function render() {
    cursor = 0;
    refCursor = 0;
    tree = component[config.componente ?? "FormularioContainer"](config.props ?? {});
    primeiro = false;
    return tree;
  }
  function nodes(item) {
    if (!item || typeof item !== "object") return [];
    if (Array.isArray(item)) return item.flatMap((child) => nodes(child));
    if (typeof item.type === "function") return nodes(item.type(item.props));
    if (item.type === "Dialog" && item.props.open === false) return [item];
    return [item, ...nodes(item.props?.children)];
  }
  function text(item) {
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (Array.isArray(item)) return item.map(text).join("");
    if (item?.type === "Dialog" && item.props.open === false) return "";
    return item?.props ? text(item.props.children) : "";
  }
  const find = (label) =>
    nodes(tree).find((n) => ["Button", "AlertDialogAction"].includes(n.type) && text(n) === label);
  render();
  effects.forEach((fn) => fn());
  return {
    eventos,
    storage,
    render,
    nodes: () => nodes(tree),
    text: () => text(tree),
    find,
    falharStorage: () => {
      persistenciaFalha = true;
    },
    async pronto() {
      await tick();
      render();
    },
    change(id, value) {
      const node = nodes(tree).find((n) => n.props?.id === id && n.props?.onChange);
      assert.ok(node, `campo ${id} deve existir`);
      node.props.onChange({ target: { value } });
      render();
    },
    click(label) {
      const node = find(label);
      assert.ok(node, `botão ${label} deve existir`);
      const result = node.props.onClick();
      render();
      return result;
    },
    restaurar() {
      if (anteriores) Object.defineProperty(globalThis, "sessionStorage", anteriores);
      else delete globalThis.sessionStorage;
    },
  };
}

async function preencher(h) {
  await h.pronto();
  for (const [id, valor] of Object.entries({
    cliente: clienteId,
    solicitadoEm: lote.solicitadoEm,
    executadoEm: lote.executadoEm,
    totalCobrado: lote.totalCobrado,
    quantidade: String(lote.quantidade),
    descricao: lote.descricao,
    motivo: "Serviço solicitado pelo cliente",
  }))
    h.change(id, valor);
  h.click("Adicionar participante");
  h.change("p-0", colaboradorId);
  h.change("c-0", "0");
}

test("identidade recusada não lê armazenamento e não oferece registro", async () => {
  const h = navegador({
    carregarFormularioContainerAction: async () => ({ ok: false, mensagem: "Sessão inválida" }),
  });
  try {
    await h.pronto();
    assert.equal(h.eventos.filter(([tipo]) => tipo === "ler").length, 0);
    assert.equal(h.find("Confirmar registro"), undefined);
  } finally {
    h.restaurar();
  }
});
test("formulário informa schema indisponível sem oferecer gravação", async () => {
  const h = navegador({
    carregarFormularioContainerAction: async () => ({
      ok: false,
      codigo: "indisponivel",
      mensagem: "Backend 045 indisponível neste banco.",
    }),
  });
  try {
    await h.pronto();
    assert.match(h.text(), /Backend 045 indisponível/);
    assert.equal(h.find("Revisar serviço"), undefined);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "ler").length, 0);
  } finally {
    h.restaurar();
  }
});

test("storage indisponível bloqueia envio antes de qualquer mutação", async () => {
  const h = navegador();
  try {
    await preencher(h);
    h.falharStorage();
    h.click("Revisar serviço");
    assert.equal(h.find("Confirmar registro"), undefined);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "registrar").length, 0);
    assert.match(h.text(), /Armazenamento indisponível/);
  } finally {
    h.restaurar();
  }
});

test("persistência e conferência precedem escrita; sucesso invalida consultas", async () => {
  const h = navegador();
  try {
    await preencher(h);
    assert.ok(
      h.eventos.findIndex(([tipo]) => tipo === "identidade") <
        h.eventos.findIndex(([tipo]) => tipo === "ler"),
    );
    h.click("Revisar serviço");
    h.click("Confirmar registro");
    await h.pronto();
    const escrita = h.eventos.findIndex(([tipo]) => tipo === "registrar");
    assert.ok(escrita > h.eventos.findIndex(([tipo]) => tipo === "salvar"));
    assert.ok(escrita > h.eventos.findIndex(([tipo]) => tipo === "conferir"));
    assert.match(h.text(), /Serviço registrado|Abrir serviço/);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "invalidar").length, 3);
  } finally {
    h.restaurar();
  }
});

test("resposta incerta mantém chave e payload; correção bloqueada e retry só após conferência", async () => {
  const envios = [];
  const h = navegador({
    registrarContainerAction: async (args) => {
      envios.push(args);
      throw new Error("Conexão perdida após envio");
    },
  });
  try {
    await preencher(h);
    h.click("Revisar serviço");
    h.click("Confirmar registro");
    await h.pronto();
    assert.equal(envios.length, 1);
    assert.equal(h.find("Confirmar registro").props.disabled, true);
    assert.equal(h.find("Voltar e corrigir").props.disabled, true);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "invalidar").length, 0);
    h.click("Conferir registro preservado");
    await h.pronto();
    h.click("Confirmar registro");
    await h.pronto();
    assert.equal(envios.length, 2);
    assert.deepEqual(envios[1], envios[0]);
    assert.equal(h.find("Voltar e corrigir").props.disabled, true);
  } finally {
    h.restaurar();
  }
});

test("lista distingue migration ausente de vazio e avisa catálogo indisponível", async () => {
  const h = navegador(
    {
      carregarContainersAction: async () => ({
        ok: false,
        codigo: "indisponivel",
        mensagem: "A migration 045 de containers não está disponível neste banco.",
      }),
      carregarFormularioContainerAction: async () => {
        throw new Error("Rede indisponível");
      },
    },
    null,
    { arquivo: "lista-containers.tsx", componente: "ListaContainers" },
  );
  try {
    await h.pronto();
    assert.match(h.text(), /migration 045/);
    assert.match(h.text(), /filtros.*indisponível/i);
    assert.doesNotMatch(h.text(), /Nenhum serviço encontrado/);
  } finally {
    h.restaurar();
  }
});

test("detalhe preserva erro classificado de autorização", async () => {
  const h = navegador(
    {
      carregarContainerAction: async () => ({
        ok: false,
        codigo: "nao-autorizado",
        mensagem: "Acesso administrativo negado.",
      }),
    },
    null,
    {
      arquivo: "detalhe-container.tsx",
      componente: "DetalheDoContainer",
      props: { id: servicoId },
    },
  );
  try {
    await h.pronto();
    assert.match(h.text(), /Acesso administrativo negado/);
  } finally {
    h.restaurar();
  }
});

test("recuperação incerta não troca intenção nem permite corrigir ou reenviar", async () => {
  const intent = intencoes.marcarIntencao(
    intencoes.criarIntencao(userId, lote, "Registro solicitado", crypto.randomUUID()),
    "enviando",
  );
  const h = navegador(
    {
      recuperarIntencaoContainerAction: async () => ({ ok: false, mensagem: "Banco indisponível" }),
    },
    JSON.stringify(intent),
  );
  try {
    await h.pronto();
    assert.equal(h.find("Confirmar registro").props.disabled, true);
    assert.equal(h.find("Voltar e corrigir").props.disabled, true);
    h.click("Confirmar registro");
    assert.equal(h.eventos.filter(([tipo]) => tipo === "registrar").length, 0);
    const preservada = JSON.parse([...h.storage.values()][0]);
    assert.equal(preservada.chave, intent.chave);
  } finally {
    h.restaurar();
  }
});

test("recuperação confirmada abre UUID existente sem repetir mutação", async () => {
  const intent = intencoes.criarIntencao(userId, lote, "Registro solicitado", crypto.randomUUID());
  const h = navegador(
    {
      recuperarIntencaoContainerAction: async () => ({
        ok: true,
        data: { estado: "registrado", id: servicoId },
      }),
    },
    JSON.stringify(intent),
  );
  try {
    await h.pronto();
    assert.match(h.text(), /Abrir serviço/);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "registrar").length, 0);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "invalidar").length, 3);
    assert.ok(h.nodes().some((n) => n.props?.href === `/containers/${servicoId}`));
  } finally {
    h.restaurar();
  }
});

test("intenção corrompida é preservada e impede chave nova", async () => {
  const h = navegador({}, "{corrompido");
  try {
    await h.pronto();
    h.click("Revisar serviço");
    assert.equal(h.find("Confirmar registro"), undefined);
    assert.equal([...h.storage.values()][0], "{corrompido");
    assert.equal(h.eventos.filter(([tipo]) => tipo === "registrar" || tipo === "salvar").length, 0);
  } finally {
    h.restaurar();
  }
});

test("duplo clique usa trava síncrona e produz uma única chamada de escrita", async () => {
  let liberar;
  let chamadas = 0;
  const pendente = new Promise((resolve) => {
    liberar = resolve;
  });
  const h = navegador({
    registrarContainerAction: async () => {
      chamadas++;
      return pendente;
    },
  });
  try {
    await preencher(h);
    h.click("Revisar serviço");
    const confirmar = h.find("Confirmar registro").props.onClick;
    confirmar();
    confirmar();
    await h.pronto();
    assert.equal(chamadas, 1);
    liberar({ ok: true, data: { id: servicoId } });
    await h.pronto();
    assert.match(h.text(), /Abrir serviço/);
  } finally {
    h.restaurar();
  }
});

const detalheDisponivel = {
  servico: {
    id: servicoId,
    description: "Descarga",
    cliente_nome: "Cliente",
    operacao_nome: null,
    requested_on: "2026-11-01",
    executed_on: "2026-11-02",
    quantity: 2,
    reference: null,
    revenue_cents: 10000,
    cost_total_cents: 0,
    cost_mode: "por_pessoa",
    situacao: "disponivel",
    invoice_id: null,
  },
  participantes: [{ employee_id: colaboradorId, nome: "Colaborador", cost_cents: 0 }],
  auditoria: [],
  competencia: { inicio: "2026-11-01", fim: "2026-11-30" },
};
const configDetalhe = {
  arquivo: "detalhe-container.tsx",
  componente: "DetalheDoContainer",
  props: { id: servicoId },
};

test("cancelamento incerto só se confirma quando releitura comprova cancelado", async () => {
  let leituras = 0;
  let cancelamentos = 0;
  const h = navegador(
    {
      carregarContainerAction: async () => ({
        ok: true,
        data: {
          ...detalheDisponivel,
          servico: {
            ...detalheDisponivel.servico,
            situacao: ++leituras > 1 ? "cancelado" : "disponivel",
          },
        },
      }),
      cancelarContainerAction: async () => {
        cancelamentos++;
        throw new Error("Resposta perdida");
      },
    },
    null,
    configDetalhe,
  );
  try {
    await h.pronto();
    h.change("motivo-cancelamento", "Pedido cancelado pelo cliente");
    h.click("Confirmar cancelamento");
    await h.pronto();
    assert.equal(cancelamentos, 1);
    assert.equal(leituras, 2);
    assert.match(h.text(), /Cancelado/);
    assert.equal(h.find("Confirmar cancelamento"), undefined);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "invalidar").length, 3);
  } finally {
    h.restaurar();
  }
});

test("cancelamento sem prova após erro retém bloqueio e não invalida faturamento", async () => {
  const h = navegador(
    {
      carregarContainerAction: async () => ({ ok: true, data: detalheDisponivel }),
      cancelarContainerAction: async () => {
        throw new Error("Resposta perdida");
      },
    },
    null,
    configDetalhe,
  );
  try {
    await h.pronto();
    h.change("motivo-cancelamento", "Pedido cancelado");
    h.click("Confirmar cancelamento");
    await h.pronto();
    assert.match(h.text(), /Resultado indeterminado/);
    assert.equal(h.find("Confirmar cancelamento").props.disabled, true);
    assert.equal(h.eventos.filter(([tipo]) => tipo === "invalidar").length, 0);
  } finally {
    h.restaurar();
  }
});

test("rejeição explícita permite corrigir após ausência mantendo a mesma chave", async () => {
  for (const codigo of ["validacao", "nao-encontrado"]) {
    const envios = [];
    const mensagem =
      codigo === "validacao"
        ? "Competência fora da janela do cliente."
        : "Colaborador não encontrado.";
    const h = navegador({
      registrarContainerAction: async (args) => {
        envios.push(args);
        return envios.length === 1
          ? { ok: false, codigo, mensagem }
          : { ok: true, data: { id: servicoId } };
      },
    });
    try {
      await preencher(h);
      const checkbox = h.nodes().find((n) => n.type === "input" && n.props.type === "checkbox");
      checkbox.props.onChange({ target: { checked: true } });
      h.render();
      h.change("competencia-inicio", "2026-11-01");
      h.change("competencia-fim", "2026-11-15");
      h.click("Revisar serviço");
      const chave = JSON.parse([...h.storage.values()][0]).chave;
      h.click("Confirmar registro");
      await h.pronto();
      const formulario = h.nodes().find((n) => n.type === "fieldset" && "disabled" in n.props);
      assert.equal(formulario.props.disabled, false, codigo);
      assert.ok(h.text().includes(mensagem));
      h.change("competencia-fim", "2026-11-30");
      h.click("Revisar serviço");
      assert.equal(JSON.parse([...h.storage.values()][0]).chave, chave);
      h.click("Confirmar registro");
      await h.pronto();
      assert.equal(envios.length, 2);
      assert.equal(envios[0].chave, envios[1].chave);
      assert.equal(envios[1].lote.competenciaCobranca.fim, "2026-11-30");
      assert.equal(h.eventos.filter(([tipo]) => tipo === "remover").length, 0);
      assert.match(h.text(), /Abrir serviço/);
    } finally {
      h.restaurar();
    }
  }
});

test("validação depois de timeout não libera alteração da intenção incerta", async () => {
  let envios = 0;
  const h = navegador({
    registrarContainerAction: async () => {
      if (++envios === 1) throw new Error("Resposta perdida");
      return { ok: false, codigo: "validacao", mensagem: "Competência fora da janela." };
    },
  });
  try {
    await preencher(h);
    h.click("Revisar serviço");
    h.click("Confirmar registro");
    await h.pronto();
    h.click("Conferir registro preservado");
    await h.pronto();
    h.click("Confirmar registro");
    await h.pronto();
    const formulario = h.nodes().find((n) => n.type === "fieldset" && "disabled" in n.props);
    assert.equal(formulario.props.disabled, true);
    assert.equal(h.find("Voltar e corrigir").props.disabled, true);
    assert.equal(JSON.parse([...h.storage.values()][0]).estado, "indeterminada");
  } finally {
    h.restaurar();
  }
});

test("recusada recuperada só libera correção depois de conferência de ausência", async () => {
  const intent = intencoes.marcarIntencao(
    intencoes.marcarIntencao(
      intencoes.criarIntencao(userId, lote, "Registro solicitado", crypto.randomUUID()),
      "enviando",
    ),
    "recusada",
  );
  let consultas = 0;
  const h = navegador(
    {
      recuperarIntencaoContainerAction: async () =>
        ++consultas === 1
          ? { ok: false, codigo: "indisponivel", mensagem: "Falha ao conferir" }
          : { ok: true, data: { estado: "ausente" } },
    },
    JSON.stringify(intent),
  );
  try {
    await h.pronto();
    const bloqueado = () =>
      h.nodes().find((n) => n.type === "fieldset" && "disabled" in n.props).props.disabled;
    assert.equal(bloqueado(), true);
    h.click("Conferir registro preservado");
    await h.pronto();
    assert.equal(bloqueado(), false);
    assert.equal(
      h.nodes().find((n) => n.type === "select" && n.props.id === "cliente").props.disabled,
      true,
    );
    h.change("descricao", "Descarga corrigida");
    h.click("Revisar serviço");
    const corrigida = JSON.parse([...h.storage.values()][0]);
    assert.equal(corrigida.chave, intent.chave);
    assert.equal(corrigida.estado, "preparada");
    assert.equal(corrigida.lote.descricao, "Descarga corrigida");
    assert.equal(h.eventos.filter(([tipo]) => tipo === "remover").length, 0);
  } finally {
    h.restaurar();
  }
});

test("correção antes do primeiro envio preserva chave e intenção no armazenamento", async () => {
  const h = navegador();
  try {
    await preencher(h);
    h.click("Revisar serviço");
    const chave = JSON.parse([...h.storage.values()][0]).chave;
    h.click("Voltar e corrigir");
    await h.pronto();
    assert.equal(
      h.nodes().find((n) => n.type === "select" && n.props.id === "cliente").props.disabled,
      true,
    );
    h.change("descricao", "Descrição corrigida antes do envio");
    h.click("Revisar serviço");
    const corrigida = JSON.parse([...h.storage.values()][0]);
    assert.equal(corrigida.chave, chave);
    assert.equal(corrigida.lote.descricao, "Descrição corrigida antes do envio");
    assert.equal(h.eventos.filter(([tipo]) => tipo === "remover").length, 0);
  } finally {
    h.restaurar();
  }
});

const adicionalSemVinculoNoCache = {
  id: "50000000-0000-4000-8000-000000000001",
  client_id: clienteId,
  operation_id: null,
  period_start: "2026-11-01",
  period_end: "2026-11-02",
  description: "Container criado depois da leitura do mapa",
  reference: null,
  amount: "100.00",
  invoice_id: null,
  created_at: "2026-11-01T10:00:00Z",
  canceled_at: null,
  cancel_reason: null,
};
const propsAdicionais = {
  clienteId,
  inicio: "2026-11-01",
  fim: "2026-11-30",
  operacoes: [],
  adicionais: [adicionalSemVinculoNoCache],
  aguardando: false,
  carregando: false,
  erro: false,
};

function faturamento(acoes, cancelamentos, destinos) {
  return navegador(acoes, null, {
    arquivo: "../faturamento/adicionais.tsx",
    componente: "AdicionaisDoPeriodo",
    props: propsAdicionais,
    // O mapa anterior está vazio: só a consulta autoritativa pode descobrir
    // que o adicional recebido depois é lastro de um container.
    consulta: { data: { ok: true, data: { servicos: [] } }, isError: false },
    router: { push: (href) => destinos.push(href) },
    cancelar: async (payload) => cancelamentos.push(payload),
  });
}

test("faturamento com cache antigo confere vínculo atual e encaminha container sem cancelar legado", async () => {
  const cancelamentos = [];
  const destinos = [];
  const consultados = [];
  const h = faturamento(
    {
      verificarVinculoAdicionalContainerAction: async (id) => {
        consultados.push(id);
        return { ok: true, data: { tipo: "container", id: servicoId } };
      },
    },
    cancelamentos,
    destinos,
  );
  try {
    h.click("Conferir cancelamento");
    await h.pronto();
    assert.deepEqual(consultados, [adicionalSemVinculoNoCache.id]);
    assert.deepEqual(destinos, [`/containers/${servicoId}`]);
    assert.deepEqual(cancelamentos, []);
    assert.equal(h.nodes().filter((n) => n.type === "Dialog" && n.props.open).length, 0);
  } finally {
    h.restaurar();
  }
});

test("faturamento bloqueia cancelamento quando conferência atual falha", async () => {
  const cancelamentos = [];
  const destinos = [];
  const h = faturamento(
    {
      verificarVinculoAdicionalContainerAction: async () => {
        throw new Error("Rede indisponível");
      },
    },
    cancelamentos,
    destinos,
  );
  try {
    h.click("Conferir cancelamento");
    await h.pronto();
    assert.match(h.text(), /Não foi possível confirmar o vínculo/);
    assert.deepEqual(cancelamentos, []);
    assert.deepEqual(destinos, []);
    assert.equal(h.nodes().filter((n) => n.type === "Dialog" && n.props.open).length, 0);
  } finally {
    h.restaurar();
  }
});

test("faturamento confirma legado com nova consulta antes de mutateAsync", async () => {
  const cancelamentos = [];
  const destinos = [];
  let consultas = 0;
  const h = faturamento(
    {
      verificarVinculoAdicionalContainerAction: async () => {
        consultas++;
        assert.equal(cancelamentos.length, 0);
        return { ok: true, data: { tipo: "legado" } };
      },
    },
    cancelamentos,
    destinos,
  );
  try {
    h.click("Conferir cancelamento");
    await h.pronto();
    assert.equal(consultas, 1);
    assert.equal(h.nodes().filter((n) => n.type === "Dialog" && n.props.open).length, 1);
    h.change("adicional-motivo-cancelamento", "Correção de adicional legado");
    h.click("Cancelar adicional");
    await h.pronto();
    assert.equal(consultas, 2);
    assert.deepEqual(cancelamentos, [
      { id: adicionalSemVinculoNoCache.id, motivo: "Correção de adicional legado" },
    ]);
    assert.deepEqual(destinos, []);
  } finally {
    h.restaurar();
  }
});

test("faturamento relê vínculo na confirmação e impede legado que virou container", async () => {
  const cancelamentos = [];
  const destinos = [];
  let consultas = 0;
  const h = faturamento(
    {
      verificarVinculoAdicionalContainerAction: async () => ({
        ok: true,
        data: ++consultas === 1 ? { tipo: "legado" } : { tipo: "container", id: servicoId },
      }),
    },
    cancelamentos,
    destinos,
  );
  try {
    h.click("Conferir cancelamento");
    await h.pronto();
    h.change("adicional-motivo-cancelamento", "Tentativa de cancelamento");
    h.click("Cancelar adicional");
    await h.pronto();
    assert.equal(consultas, 2);
    assert.deepEqual(cancelamentos, []);
    assert.deepEqual(destinos, [`/containers/${servicoId}`]);
  } finally {
    h.restaurar();
  }
});
