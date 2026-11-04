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

test("reload preserva chave, payload e motivo e exige reconciliar antes de nova tentativa", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao, marcarIntencao } = await intencoes();
  for (const estado of ["preparada", "enviando", "indeterminada"]) {
    const storage = armazenamento();
    let intent = criarIntencao(userId, lote, motivo, chave);
    if (estado !== "preparada") intent = marcarIntencao(intent, "enviando");
    if (estado === "indeterminada") intent = marcarIntencao(intent, "indeterminada");
    salvarIntencao(storage, intent);
    const recuperada = recuperarIntencao(storage, userId);
    assert.equal(recuperada.estado, "indeterminada");
    assert.equal(recuperada.chave, chave);
    assert.deepEqual(recuperada.payload, intent.payload);
    assert.equal(recuperada.motivo, motivo);
    assert.deepEqual(recuperada.lote, intent.lote);
  }
});

test("recuperação confirmada mantém identificador sem tornar serviço reenviável", async () => {
  const { criarIntencao, salvarIntencao, recuperarIntencao, marcarIntencao } = await intencoes();
  const storage = armazenamento();
  const enviando = marcarIntencao(criarIntencao(userId, lote, motivo, chave), "enviando");
  salvarIntencao(storage, marcarIntencao(enviando, "confirmada", servicoId));
  const recuperada = recuperarIntencao(storage, userId);
  assert.equal(recuperada.estado, "confirmada");
  assert.equal(recuperada.servicoId, servicoId);
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

test("reload preserva rejeição explícita para reconciliar antes da correção", async () => {
  const { criarIntencao, marcarIntencao, salvarIntencao, recuperarIntencao } = await intencoes();
  const storage = armazenamento();
  const enviando = marcarIntencao(criarIntencao(userId, lote, motivo, chave), "enviando");
  salvarIntencao(storage, marcarIntencao(enviando, "recusada"));
  const recuperada = recuperarIntencao(storage, userId);
  assert.equal(recuperada.estado, "recusada");
  assert.equal(recuperada.chave, chave);
  assert.equal(recuperada.payload.receitaCentavos, 10001);
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
