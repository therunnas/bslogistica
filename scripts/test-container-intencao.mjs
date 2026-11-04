/** FIN-PR-11C: intenção e recuperação reais, sem rede, banco ou credenciais. */
import assert from "node:assert/strict";
import test from "node:test";

const userId = "5c45a000-0000-4000-8000-000000000001";
const otherUserId = "5c45a000-0000-4000-8000-000000000002";
const chave = "5c45b000-0000-4000-8000-000000000001";
const servicoId = "5c45b000-0000-4000-8000-000000000002";
const motivo = "Registro autorizado";
const lote = {
  clienteId: "5c45c000-0000-4000-8000-000000000001",
  solicitadoEm: "2026-11-03",
  executadoEm: "2026-11-04",
  descricao: "  Descarga  ",
  quantidade: 2,
  totalCobrado: "100,01",
  modalidadeCusto: "total_distribuido",
  totalDistribuido: "30,03",
  participantes: [
    { colaboradorId: "5c45f000-0000-4000-8000-000000000002", valorDevido: "20,02" },
    { colaboradorId: "5c45f000-0000-4000-8000-000000000001", valorDevido: "10.01" },
  ],
};
let modulo;
async function intencoes() {
  if (!modulo) {
    try {
      modulo = await import("../src/lib/container-servico-intencao.ts");
    } catch (erro) {
      if (erro.code === "ERR_MODULE_NOT_FOUND") {
        assert.fail("FIN11C feature missing: módulo de intenção/recuperação");
      }
      throw erro;
    }
  }
  return modulo;
}
function armazenamento() {
  const itens = new Map();
  const leituras = [];
  return {
    itens,
    leituras,
    getItem(key) {
      leituras.push(key);
      return itens.get(key) ?? null;
    },
    setItem: (key, value) => itens.set(key, value),
    removeItem: (key) => itens.delete(key),
  };
}

test("intenção fixa chave UUID e centavos canônicos independentemente da ordem dos participantes", async () => {
  const { criarIntencao } = await intencoes();
  const intent = criarIntencao(userId, lote, ` ${motivo} `, chave);
  assert.equal(intent.chave, chave);
  assert.equal(intent.estado, "preparada");
  assert.equal(intent.versao, 1);
  assert.equal(intent.motivo, motivo);
  assert.equal(intent.payload.receitaCentavos, 10001);
  assert.equal(intent.payload.custoTotalCentavos, 3003);
  assert.deepEqual(intent.payload.participantes, [
    { colaboradorId: "5c45f000-0000-4000-8000-000000000001", custoCentavos: 1001 },
    { colaboradorId: "5c45f000-0000-4000-8000-000000000002", custoCentavos: 2002 },
  ]);
});

test("duplo clique bloqueia segundo envio; resultado desconhecido e retry preservam a mesma chave", async () => {
  const { criarIntencao, marcarIntencao } = await intencoes();
  const inicial = criarIntencao(userId, lote, motivo, chave);
  const enviando = marcarIntencao(inicial, "enviando");
  assert.throws(() => marcarIntencao(enviando, "enviando"));
  const desconhecida = marcarIntencao(enviando, "indeterminada");
  const retry = marcarIntencao(desconhecida, "enviando");
  assert.equal(retry.chave, chave);
  assert.deepEqual(retry.payload, inicial.payload);
  const confirmada = marcarIntencao(retry, "confirmada", servicoId);
  assert.equal(confirmada.servicoId, servicoId);
  assert.throws(() => marcarIntencao(confirmada, "enviando"));
  assert.throws(() => marcarIntencao(inicial, "confirmada"));
  assert.throws(() => marcarIntencao(enviando, "confirmada", "inválido"));
});

test("reconciliação de intenção preparada confirma UUID existente sem novo envio", async () => {
  const { criarIntencao, marcarIntencao } = await intencoes();
  const inicial = criarIntencao(userId, lote, motivo, chave);
  const confirmada = marcarIntencao(inicial, "confirmada", servicoId);
  assert.equal(confirmada.estado, "confirmada");
  assert.equal(confirmada.servicoId, servicoId);
  assert.equal(confirmada.chave, chave);
  assert.throws(() => marcarIntencao(inicial, "confirmada", "inválido"));
});

test("falha antes da RPC preserva intenção preparada como indeterminada sem outra chave", async () => {
  const { criarIntencao, marcarIntencao } = await intencoes();
  const inicial = criarIntencao(userId, lote, motivo, chave);
  const indeterminada = marcarIntencao(inicial, "indeterminada");
  assert.equal(indeterminada.estado, "indeterminada");
  assert.equal(indeterminada.chave, chave);
  assert.deepEqual(indeterminada.payload, inicial.payload);
  assert.throws(() => marcarIntencao(indeterminada, "preparada"));
});

test("payload equivalente aceita formatos monetários e ordem; edição material ou motivo bloqueia retry", async () => {
  const { criarIntencao, assertPayloadDaIntencao } = await intencoes();
  const intent = criarIntencao(userId, lote, motivo, chave);
  assert.doesNotThrow(() =>
    assertPayloadDaIntencao(
      intent,
      { ...lote, totalCobrado: "100.01", participantes: [...lote.participantes].reverse() },
      ` ${motivo} `,
    ),
  );
  for (const alteracao of [
    { quantidade: 3 },
    { totalCobrado: "100.02" },
    { descricao: "Outro serviço" },
    { clienteId: otherUserId },
  ]) {
    assert.throws(() => assertPayloadDaIntencao(intent, { ...lote, ...alteracao }, motivo));
  }
  assert.throws(() => assertPayloadDaIntencao(intent, lote, "Outro motivo"));
});

test("snapshot não muda por mutação posterior do formulário ou do payload", async () => {
  const { criarIntencao } = await intencoes();
  const formulario = structuredClone(lote);
  const intent = criarIntencao(userId, formulario, motivo, chave);
  formulario.quantidade = 99;
  formulario.participantes[0].valorDevido = "999";
  assert.equal(intent.lote.quantidade, 2);
  assert.equal(intent.lote.participantes[0].valorDevido, "20,02");
  assert.throws(() => (intent.payload.receitaCentavos = 999));
  assert.throws(() => (intent.lote.participantes[0].valorDevido = "999"));
});

test("reload preserva somente marcador; conteúdo e motivo ficam exclusivamente em memória", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao, marcarIntencao } = await intencoes();
  for (const estado of ["preparada", "enviando", "indeterminada"]) {
    const storage = armazenamento();
    let intent = criarIntencao(userId, lote, motivo, chave);
    if (estado !== "preparada") intent = marcarIntencao(intent, "enviando");
    if (estado === "indeterminada") intent = marcarIntencao(intent, "indeterminada");
    salvarIntencao(storage, intent);
    const recuperada = recuperarIntencao(storage, userId);
    assert.deepEqual(recuperada, { versao: 2, userId, chave });
    assert.equal(recuperada.payload, undefined);
    assert.equal(recuperada.motivo, undefined);
    assert.equal(recuperada.lote, undefined);
  }
});

test("recuperação confirmada mantém identificador sem tornar serviço reenviável", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao, marcarIntencao } = await intencoes();
  const storage = armazenamento();
  const enviando = marcarIntencao(criarIntencao(userId, lote, motivo, chave), "enviando");
  salvarIntencao(storage, marcarIntencao(enviando, "confirmada", servicoId));
  const recuperada = recuperarIntencao(storage, userId);
  assert.deepEqual(recuperada, { versao: 2, userId, chave });
  assert.equal(recuperada.servicoId, undefined);
  assert.throws(() => marcarIntencao(recuperada, "enviando"));
});

test("rejeição explícita permite retry ou confirmação reconciliada com a mesma chave", async () => {
  const { criarIntencao, marcarIntencao } = await intencoes();
  const enviando = marcarIntencao(criarIntencao(userId, lote, motivo, chave), "enviando");
  const recusada = marcarIntencao(enviando, "recusada");
  assert.equal(recusada.estado, "recusada");
  assert.equal(recusada.chave, chave);
  assert.equal(marcarIntencao(recusada, "enviando").chave, chave);
  assert.equal(marcarIntencao(recusada, "confirmada", servicoId).servicoId, servicoId);
});

test("correção de rejeição explícita valida novo payload e preserva identidade e chave", async () => {
  const { criarIntencao, marcarIntencao, corrigirIntencaoRecusada } = await intencoes();
  assert.equal(typeof corrigirIntencaoRecusada, "function");
  const enviando = marcarIntencao(criarIntencao(userId, lote, motivo, chave), "enviando");
  const recusada = marcarIntencao(enviando, "recusada");
  const alterado = { ...lote, quantidade: 3, totalCobrado: "200,02" };
  const corrigida = corrigirIntencaoRecusada(recusada, alterado, "Motivo corrigido");
  assert.equal(corrigida.estado, "preparada");
  assert.equal(corrigida.chave, chave);
  assert.equal(corrigida.userId, userId);
  assert.equal(corrigida.payload.quantidade, 3);
  assert.equal(corrigida.payload.receitaCentavos, 20002);
  assert.equal(corrigida.motivo, "Motivo corrigido");
  assert.equal(recusada.payload.receitaCentavos, 10001);
  assert.throws(() => corrigirIntencaoRecusada(recusada, { ...lote, quantidade: 0 }, motivo));
  assert.throws(() =>
    corrigirIntencaoRecusada(recusada, { ...lote, clienteId: otherUserId }, motivo),
  );
});

test("intenção indeterminada, confirmada ou em envio nunca permite alterar conteúdo", async () => {
  const { criarIntencao, marcarIntencao, corrigirIntencaoRecusada } = await intencoes();
  assert.equal(typeof corrigirIntencaoRecusada, "function");
  const preparada = criarIntencao(userId, lote, motivo, chave);
  const enviando = marcarIntencao(preparada, "enviando");
  for (const intent of [
    preparada,
    enviando,
    marcarIntencao(enviando, "indeterminada"),
    marcarIntencao(enviando, "confirmada", servicoId),
  ]) {
    assert.throws(() => corrigirIntencaoRecusada(intent, { ...lote, quantidade: 3 }, motivo));
  }
});

test("reload de rejeição preserva chave, mas exige reconciliação sem restaurar valores", async () => {
  const { criarIntencao, marcarIntencao, salvarIntencao, recuperarIntencao } = await intencoes();
  const storage = armazenamento();
  const enviando = marcarIntencao(criarIntencao(userId, lote, motivo, chave), "enviando");
  salvarIntencao(storage, marcarIntencao(enviando, "recusada"));
  const recuperada = recuperarIntencao(storage, userId);
  assert.deepEqual(recuperada, { versao: 2, userId, chave });
  assert.equal(recuperada.payload, undefined);
});

test("identidade confirmada é obrigatória antes de qualquer acesso ao storage", async () => {
  const { recuperarIntencao, limparIntencao } = await intencoes();
  for (const uid of ["", " ", "sem-identidade", null, undefined]) {
    const storage = armazenamento();
    assert.throws(() => recuperarIntencao(storage, uid));
    assert.throws(() => limparIntencao(storage, uid));
    assert.equal(storage.leituras.length, 0);
  }
});

test("troca de usuário não lê nem remove dados de outra identidade", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao, limparIntencao } = await intencoes();
  const storage = armazenamento();
  salvarIntencao(storage, criarIntencao(userId, lote, motivo, chave));
  const key = [...storage.itens.keys()][0];
  assert.equal(recuperarIntencao(storage, otherUserId), null);
  assert.ok(!storage.leituras.includes(key));
  limparIntencao(storage, otherUserId);
  assert.ok(storage.itens.has(key));
  limparIntencao(storage, userId);
  assert.equal(storage.itens.size, 0);
});

test("storage adulterado ou malformado bloqueia recuperação e preserva item para reconciliar", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao } = await intencoes();
  const original = criarIntencao(userId, lote, motivo, chave);
  const adulteracoes = [
    { versao: 2 },
    { userId: otherUserId },
    { chave: "nao-uuid" },
    { motivo: "" },
    { estado: "desconhecido" },
    { estado: "confirmada" },
    { servicoId },
    { lote: { ...lote, quantidade: 0 } },
    { lote: { ...lote, participantes: [] } },
    { payload: { ...original.payload, receitaCentavos: 1 } },
    { access_token: "não deve ser aceito" },
    { lote: { ...lote, access_token: "não deve ser aceito" } },
  ];
  for (const adulteracao of adulteracoes) {
    const storage = armazenamento();
    salvarIntencao(storage, original);
    const key = [...storage.itens.keys()][0];
    storage.setItem(key, JSON.stringify({ ...original, ...adulteracao }));
    const bruto = storage.itens.get(key);
    assert.throws(() => recuperarIntencao(storage, userId));
    assert.equal(storage.itens.get(key), bruto);
  }
  for (const bruto of ["{", "null", "[]", "42"]) {
    const storage = armazenamento();
    salvarIntencao(storage, original);
    const key = [...storage.itens.keys()][0];
    storage.setItem(key, bruto);
    assert.throws(() => recuperarIntencao(storage, userId));
    assert.equal(storage.itens.get(key), bruto);
  }
});

test("nova intenção recusa domínio, UUID ou motivo inválido e não persiste campos desconhecidos", async () => {
  const { criarIntencao } = await intencoes();
  assert.throws(() => criarIntencao("", lote, motivo, chave));
  assert.throws(() => criarIntencao(userId, lote, motivo, "nao-uuid"));
  assert.throws(() => criarIntencao(userId, lote, " ", chave));
  assert.throws(() => criarIntencao(userId, lote, "a".repeat(1001), chave));
  assert.throws(() => criarIntencao(userId, { ...lote, quantidade: 0 }, motivo, chave));
  assert.throws(() => criarIntencao(userId, { ...lote, access_token: "proibido" }, motivo, chave));
});

test("storage indisponível impede persistência explicitamente", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao } = await intencoes();
  const falha = new Error("Storage indisponível");
  const storage = {
    getItem() {
      throw falha;
    },
    setItem() {
      throw falha;
    },
    removeItem() {},
  };
  assert.throws(() => salvarIntencao(storage, criarIntencao(userId, lote, motivo, chave)), falha);
  assert.throws(() => recuperarIntencao(storage, userId), falha);
});

test("P1: persistência nunca contém lote, motivo, receita ou custos, mesmo após confirmação", async () => {
  const { criarIntencao, salvarIntencao, marcarIntencao, recuperarIntencao } = await intencoes();
  const storage = armazenamento();
  const preparada = criarIntencao(userId, lote, motivo, chave);
  const enviada = marcarIntencao(preparada, "enviando");
  for (const intent of [
    preparada,
    enviada,
    marcarIntencao(enviada, "indeterminada"),
    marcarIntencao(enviada, "confirmada", servicoId),
  ]) {
    salvarIntencao(storage, intent);
    const raw = JSON.parse([...storage.itens.values()][0]);
    assert.deepEqual(raw, { versao: 2, userId, chave });
    assert.deepEqual(recuperarIntencao(storage, userId), raw);
    assert.equal(recuperarIntencao(storage, otherUserId), null);
  }
});

test("P1: envelopes legados de todas as contas perdem valores sem perder UUID; corrupção bloqueia", async () => {
  const { criarIntencao, sanearIntencoes, recuperarIntencao } = await intencoes();
  const storage = armazenamento();
  Object.defineProperty(storage, "length", { get: () => storage.itens.size });
  storage.key = (i) => [...storage.itens.keys()][i] ?? null;
  for (const uid of [userId, otherUserId]) {
    storage.setItem(
      `bs:container:intencao:v1:${uid}`,
      JSON.stringify(criarIntencao(uid, lote, motivo, chave)),
    );
  }
  sanearIntencoes(storage);
  for (const uid of [userId, otherUserId]) {
    assert.deepEqual(recuperarIntencao(storage, uid), { versao: 2, userId: uid, chave });
  }
  const key = `bs:container:intencao:v1:${userId}`;
  storage.setItem(key, '{"totalCobrado":"100,01"');
  sanearIntencoes(storage);
  assert.doesNotMatch(storage.getItem(key), /100,01|totalCobrado/);
  assert.throws(() => recuperarIntencao(storage, userId));
  assert.notEqual(storage.getItem(key), null);
});

test("P1: saída com falha e múltiplas abas bloqueiam conteúdo sem apagar marcadores", async () => {
  const { observarPrivacidadeContainers } =
    await import("../src/lib/container-servico-privacidade.ts");
  const { criarIntencao, salvarIntencao } = await intencoes();
  const canais = [];
  function canal() {
    const c = {
      onmessage: null,
      postMessage: () => canais.filter((v) => v !== c).forEach((v) => v.onmessage?.()),
      close() {},
    };
    canais.push(c);
    return c;
  }
  let bloqueiosA = 0,
    bloqueiosB = 0;
  const a = armazenamento(),
    b = armazenamento();
  for (const storage of [a, b]) {
    Object.defineProperty(storage, "length", { get: () => storage.itens.size });
    storage.key = (i) => [...storage.itens.keys()][i] ?? null;
    salvarIntencao(storage, criarIntencao(userId, lote, motivo, chave));
  }
  const tabA = observarPrivacidadeContainers(canal(), () => bloqueiosA++, a);
  const tabB = observarPrivacidadeContainers(canal(), () => bloqueiosB++, b);
  const sair = async () => {
    throw new Error("Logout sem resposta");
  };
  tabA.sair();
  await assert.rejects(sair());
  assert.equal(bloqueiosA, 1);
  assert.equal(bloqueiosB, 1);
  for (const storage of [a, b]) {
    assert.deepEqual(JSON.parse([...storage.itens.values()][0]), { versao: 2, userId, chave });
  }
  tabB.invalidar();
  assert.equal(bloqueiosA, 1);
  assert.equal(bloqueiosB, 2);
  tabA.fechar();
  tabB.fechar();
});

test("P1: ausência de BroadcastChannel não impede proteção local nem apaga intenção", async () => {
  const { observarPrivacidadeContainers } =
    await import("../src/lib/container-servico-privacidade.ts");
  const { criarIntencao, salvarIntencao } = await intencoes();
  const storage = armazenamento();
  Object.defineProperty(storage, "length", { get: () => storage.itens.size });
  storage.key = (i) => [...storage.itens.keys()][i] ?? null;
  salvarIntencao(storage, criarIntencao(userId, lote, motivo, chave));
  let bloqueios = 0;
  const observador = observarPrivacidadeContainers(null, () => bloqueios++, storage);
  observador.sair();
  assert.equal(bloqueios, 1);
  assert.deepEqual(JSON.parse([...storage.itens.values()][0]), { versao: 2, userId, chave });
  observador.fechar();
});

test("C.5: saneamento recusado não impede invalidação de outra aba nem apaga marcador", async () => {
  const { observarPrivacidadeContainers } =
    await import("../src/lib/container-servico-privacidade.ts");
  const { criarIntencao, salvarIntencao } = await intencoes();
  const abas = [];
  function canal() {
    const atual = {
      onmessage: null,
      postMessage: () => abas.filter((aba) => aba !== atual).forEach((aba) => aba.onmessage?.()),
      close() {},
    };
    abas.push(atual);
    return atual;
  }
  const a = armazenamento(),
    b = armazenamento();
  for (const storage of [a, b]) {
    Object.defineProperty(storage, "length", { get: () => storage.itens.size });
    storage.key = (i) => [...storage.itens.keys()][i] ?? null;
    salvarIntencao(storage, criarIntencao(userId, lote, motivo, chave));
  }
  let bloqueiosA = 0,
    bloqueiosB = 0;
  const tabA = observarPrivacidadeContainers(canal(), () => bloqueiosA++, a);
  const tabB = observarPrivacidadeContainers(canal(), () => bloqueiosB++, b);
  a.getItem = () => {
    throw new Error("Leitura recusada");
  };
  try {
    assert.doesNotThrow(() => tabA.sair());
    assert.equal(bloqueiosA, 1);
    assert.equal(bloqueiosB, 1);
    for (const storage of [a, b]) {
      assert.deepEqual(JSON.parse([...storage.itens.values()][0]), { versao: 2, userId, chave });
    }
  } finally {
    tabA.fechar();
    tabB.fechar();
  }
});
