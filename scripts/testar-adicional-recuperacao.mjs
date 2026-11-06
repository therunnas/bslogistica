import assert from "node:assert/strict";
import test from "node:test";
import * as dominio from "../src/lib/adicional-intencao.ts";

test("commit com resposta perdida, fechar/recarregar e reenviar não duplica", async () => {
  const dados = new Map();
  const storage = {
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => dados.set(k, v),
    removeItem: (k) => dados.delete(k),
  };
  const rows = new Map();
  let writes = 0;
  let perder = true;
  const deps = {
    storage,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    gerar: () => crypto.randomUUID(),
    consultar: async (key) => rows.get(key) ?? null,
    registrar: async (key) => {
      writes++;
      rows.set(key, "registro-1");
      if (perder) throw new Error("resposta perdida");
      return "registro-2";
    },
  };
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
  assert.equal(writes, 1);
  assert.ok(!JSON.stringify([...dados]).includes("valor"));
  perder = false;
  // Nova instância: nenhum payload/estado de formulário sobreviveu.
  await assert.rejects(() => dominio.executarIntencaoDeAdicional({ ...deps }), /já foi registrado/);
  assert.equal(writes, 1);
  // Nova ação explícita depois de reconciliar permite operação legítima igual.
  assert.equal(await dominio.executarIntencaoDeAdicional({ ...deps }), "registro-2");
  assert.equal(writes, 2);
});

test("ausência na 047 reutiliza chave; falha de leitura nunca escreve", async () => {
  const dados = new Map();
  const storage = {
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => dados.set(k, v),
    removeItem: (k) => dados.delete(k),
  };
  const chaves = [];
  const deps = {
    storage,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    gerar: () => crypto.randomUUID(),
    consultar: async () => null,
    registrar: async (key) => {
      chaves.push(key);
      throw Error("timeout");
    },
  };
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
  await assert.rejects(() =>
    dominio.executarIntencaoDeAdicional({
      ...deps,
      consultar: async () => {
        throw Error("rede");
      },
    }),
  );
  assert.equal(chaves.length, 1);
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
  assert.equal(chaves[0], chaves[1]);
});

test("fallback legado desconhecido, storage indisponível e marcador inválido falham fechados", async () => {
  const dados = new Map();
  let writes = 0;
  const storage = {
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => dados.set(k, v),
    removeItem: (k) => dados.delete(k),
  };
  const deps = {
    storage,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    gerar: () => crypto.randomUUID(),
    consultar: async () => null,
    registrar: async (key, legado) => {
      legado();
      writes++;
      throw Error("timeout");
    },
  };
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps), /administrativa/);
  assert.equal(writes, 1);
  dados.clear();
  await assert.rejects(() =>
    dominio.executarIntencaoDeAdicional({
      ...deps,
      storage: {
        ...storage,
        setItem: () => {
          throw Error("quota");
        },
      },
    }),
  );
  assert.equal(writes, 1);
  dados.set("bs:adicional:intencao:v1:" + deps.userId, "corrompido");
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
  assert.equal(writes, 1);
});

const USUARIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memoria = () => {
  const dados = new Map();
  return {
    dados,
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => dados.set(k, v),
    removeItem: (k) => dados.delete(k),
  };
};

test("legado: toda recusa SQL transacional libera; resultado sem código do banco continua bloqueando", async () => {
  // SQLSTATEs que registrar_adicional (038) levanta por contrato: a transação é desfeita, nada foi gravado.
  for (const code of [
    "22023",
    "23505",
    "23514",
    "23P01",
    "28000",
    "40001",
    "42501",
    "55000",
    "P0002",
  ]) {
    const storage = memoria();
    let writes = 0;
    const deps = {
      storage,
      userId: USUARIO,
      gerar: () => crypto.randomUUID(),
      consultar: async () => null,
      registrar: async (_chave, legado) => {
        legado();
        writes++;
        throw Object.assign(new Error("recusa"), { code });
      },
    };
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
    assert.equal(
      storage.dados.size,
      0,
      `${code}: recusa explícita não pode deixar o usuário travado`,
    );
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
    assert.equal(writes, 2, `${code}: nova tentativa deve ser possível`);
  }
  // Sem código do banco (timeout, gateway, rede) o resultado é desconhecido: bloqueia.
  for (const erro of [
    new Error("timeout"),
    Object.assign(new Error("gw"), { code: "PGRST000" }),
    Object.assign(new Error("x"), { code: "08006" }),
  ]) {
    const storage = memoria();
    let writes = 0;
    const deps = {
      storage,
      userId: USUARIO,
      gerar: () => crypto.randomUUID(),
      consultar: async () => null,
      registrar: async (_chave, legado) => {
        legado();
        writes++;
        throw erro;
      },
    };
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps));
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps), /administrativa/);
    assert.equal(writes, 1);
  }
});

test("marcador corrompido ou com forma inesperada falha fechado com a mensagem de reconciliação", async () => {
  for (const bruto of [
    "corrompido",
    "null",
    "[]",
    '{"chave":"x","legado":false}',
    '{"chave":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab","legado":false,"valor":10}',
  ]) {
    const storage = memoria();
    storage.dados.set(`bs:adicional:intencao:v1:${USUARIO}`, bruto);
    let writes = 0;
    await assert.rejects(
      () =>
        dominio.executarIntencaoDeAdicional({
          storage,
          userId: USUARIO,
          gerar: () => crypto.randomUUID(),
          consultar: async () => null,
          registrar: async () => {
            writes++;
            return "x";
          },
        }),
      /administrativa/,
      bruto,
    );
    assert.equal(writes, 0);
    assert.equal(
      storage.dados.get(`bs:adicional:intencao:v1:${USUARIO}`),
      bruto,
      "o bloqueio não é apagado",
    );
  }
});

test("o que é persistido: só chave e modo, por identidade; valor/motivo/referência jamais", async () => {
  const storage = memoria();
  await assert.rejects(() =>
    dominio.executarIntencaoDeAdicional({
      storage,
      userId: USUARIO,
      gerar: () => crypto.randomUUID(),
      consultar: async () => null,
      registrar: async () => {
        throw new Error("timeout");
      },
    }),
  );
  assert.deepEqual([...storage.dados.keys()], [`bs:adicional:intencao:v1:${USUARIO}`]);
  const gravado = JSON.parse(storage.dados.get(`bs:adicional:intencao:v1:${USUARIO}`));
  assert.deepEqual(Object.keys(gravado).sort(), ["chave", "legado"]);
  assert.equal(gravado.legado, false);
  // Outra identidade na mesma aba não enxerga nem é bloqueada por este marcador.
  let chaveOutro = null;
  await dominio.executarIntencaoDeAdicional({
    storage,
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    gerar: () => crypto.randomUUID(),
    consultar: async () => null,
    registrar: async (chave) => {
      chaveOutro = chave;
      return "ok";
    },
  });
  assert.notEqual(chaveOutro, gravado.chave);
});

test("LIMITE COMPROVADO: aba nova ou storage limpo não recupera o marcador (sem proteção contra fechar a aba)", async () => {
  const antes = memoria();
  const chaves = [];
  const deps = (storage) => ({
    storage,
    userId: USUARIO,
    gerar: () => crypto.randomUUID(),
    consultar: async () => null,
    registrar: async (chave) => {
      chaves.push(chave);
      throw new Error("resposta perdida");
    },
  });
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps(antes)));
  // sessionStorage não sobrevive ao fechamento da aba: a "aba nova" começa com armazenamento vazio.
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(deps(memoria())));
  assert.equal(chaves.length, 2);
  assert.notEqual(
    chaves[0],
    chaves[1],
    "sem marcador não há como reconciliar: o limite precisa constar na documentação",
  );
});
