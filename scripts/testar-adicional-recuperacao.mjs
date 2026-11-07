import assert from "node:assert/strict";
import test from "node:test";
import * as dominio from "../src/lib/adicional-intencao.ts";

const USUARIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHAVE = (u) => `bs:adicional:intencao:v1:${u}`;

/**
 * Um "navegador": armazenamento PERSISTENTE e gerenciador de locks compartilhados por todas as abas.
 * Fechar a aba = abandonar a aba (os locks dela são soltos); o armazenamento permanece.
 */
function navegador() {
  const dados = new Map();
  const presos = new Set();
  const locks = {
    async request(nome, opcoes, cb) {
      if (presos.has(nome)) {
        assert.equal(opcoes.ifAvailable, true, "o app nunca espera por lock: falha fechado");
        return cb(null);
      }
      presos.add(nome);
      try {
        return await cb({ name: nome });
      } finally {
        presos.delete(nome);
      }
    },
  };
  const storage = {
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => dados.set(k, v),
    removeItem: (k) => dados.delete(k),
  };
  return {
    dados,
    presos,
    aba(extra = {}) {
      return {
        storage,
        exclusivo: dominio.criarExclusaoEntreAbas(locks),
        userId: USUARIO,
        gerar: () => crypto.randomUUID(),
        consultar: async () => null,
        registrar: async () => "registro",
        ...extra,
      };
    },
  };
}

test("commit confirmado, resposta perdida, aba fechada e reaberta: reconcilia sem segundo envio", async () => {
  const nav = navegador();
  const rows = new Map();
  let writes = 0;
  const comBanco = {
    consultar: async (key) => rows.get(key) ?? null,
    registrar: async (key) => {
      writes++;
      rows.set(key, "registro-1");
      throw new Error("resposta perdida");
    },
  };
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(nav.aba(comBanco)));
  assert.equal(writes, 1);
  assert.ok(nav.dados.has(CHAVE(USUARIO)), "o marcador sobrevive ao fechamento da aba");
  // Aba nova: nenhum estado de formulário sobreviveu, só o armazenamento persistente do navegador.
  await assert.rejects(
    () => dominio.executarIntencaoDeAdicional(nav.aba(comBanco)),
    /já foi registrado/,
  );
  assert.equal(writes, 1);
  assert.equal(nav.dados.size, 0);
  // Reconciliado, uma operação legítima igual continua possível.
  assert.equal(
    await dominio.executarIntencaoDeAdicional(
      nav.aba({ ...comBanco, registrar: async () => "novo" }),
    ),
    "novo",
  );
});

test("nova aba simultânea e duplo clique: só um envio por usuário em andamento", async () => {
  const nav = navegador();
  let soltar;
  const portao = new Promise((r) => (soltar = r));
  let writes = 0;
  const lenta = nav.aba({
    registrar: async () => {
      writes++;
      await portao;
      return "A";
    },
  });
  const emAndamento = dominio.executarIntencaoDeAdicional(lenta);
  await new Promise((r) => setImmediate(r));
  for (const outra of [
    nav.aba({ registrar: async () => (writes++, "B") }),
    nav.aba({ registrar: async () => (writes++, "C") }),
  ]) {
    await assert.rejects(
      () => dominio.executarIntencaoDeAdicional(outra),
      /outra aba|em andamento/,
    );
  }
  assert.equal(writes, 1);
  soltar();
  assert.equal(await emAndamento, "A");
  assert.equal(nav.presos.size, 0, "o lock é solto ao terminar");
  assert.equal(nav.dados.size, 0);
  assert.equal(await dominio.executarIntencaoDeAdicional(nav.aba()), "registro");
});

test("aba que fecha com o envio em voo: a outra aba reaproveita a MESMA chave", async () => {
  const nav = navegador();
  const chaves = [];
  const emVoo = dominio
    .executarIntencaoDeAdicional(
      nav.aba({
        registrar: async (chave) => {
          chaves.push(chave);
          return new Promise(() => {}); // a aba fecha antes de a resposta chegar
        },
      }),
    )
    .catch(() => {});
  await new Promise((r) => setImmediate(r));
  nav.presos.clear(); // fechar a aba solta os locks dela
  void emVoo;
  await assert.rejects(
    () =>
      dominio.executarIntencaoDeAdicional(
        nav.aba({
          registrar: async (chave) => {
            chaves.push(chave);
            throw new Error("timeout");
          },
        }),
      ),
    /timeout/,
  );
  assert.equal(chaves.length, 2);
  assert.equal(chaves[0], chaves[1], "ausência na 047 só permite reutilizar a chave");
});

test("usuários diferentes não compartilham marcador nem lock", async () => {
  const nav = navegador();
  let chaveA;
  let chaveB;
  let soltar;
  const portao = new Promise((r) => (soltar = r));
  const a = dominio.executarIntencaoDeAdicional(
    nav.aba({
      registrar: async (chave) => {
        chaveA = chave;
        await portao;
        throw new Error("perdida");
      },
    }),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(
    await dominio.executarIntencaoDeAdicional(
      nav.aba({
        userId: OUTRO,
        registrar: async (chave) => {
          chaveB = chave;
          return "B";
        },
      }),
    ),
    "B",
  );
  soltar();
  await assert.rejects(() => a);
  assert.notEqual(chaveA, chaveB);
  assert.ok(nav.dados.has(CHAVE(USUARIO)));
  assert.ok(!nav.dados.has(CHAVE(OUTRO)));
});

test("fail-closed: sem lock, lock que falha, armazenamento indisponível ou marcador corrompido", async () => {
  const nav = navegador();
  let writes = 0;
  const registrar = async () => (writes++, "x");
  // navegador sem gerenciador de locks
  await assert.rejects(
    () =>
      dominio.executarIntencaoDeAdicional(
        nav.aba({ exclusivo: dominio.criarExclusaoEntreAbas(undefined), registrar }),
      ),
    /entre abas/,
  );
  // lock que explode
  await assert.rejects(() =>
    dominio.executarIntencaoDeAdicional(
      nav.aba({
        exclusivo: dominio.criarExclusaoEntreAbas({
          request: async () => {
            throw new Error("SecurityError");
          },
        }),
        registrar,
      }),
    ),
  );
  // armazenamento que lança na leitura e na escrita
  for (const falha of ["getItem", "setItem"]) {
    const base = nav.aba().storage;
    await assert.rejects(() =>
      dominio.executarIntencaoDeAdicional(
        nav.aba({
          storage: {
            ...base,
            [falha]: () => {
              throw new Error("indisponível");
            },
          },
          registrar,
        }),
      ),
    );
  }
  // marcador corrompido ou de forma inesperada
  for (const bruto of [
    "corrompido",
    "null",
    "[]",
    '{"chave":"x","legado":false}',
    '{"chave":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab","legado":false,"valor":10}',
  ]) {
    nav.dados.set(CHAVE(USUARIO), bruto);
    await assert.rejects(
      () => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })),
      /administrativa/,
      bruto,
    );
    assert.equal(nav.dados.get(CHAVE(USUARIO)), bruto, "o bloqueio não é apagado");
  }
  assert.equal(writes, 0);
  assert.equal(nav.presos.size, 0);
});

test("ausência na 047 reutiliza chave; falha de leitura nunca escreve", async () => {
  const nav = navegador();
  const chaves = [];
  const registrar = async (key) => {
    chaves.push(key);
    throw Error("timeout");
  };
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })));
  await assert.rejects(() =>
    dominio.executarIntencaoDeAdicional(
      nav.aba({
        registrar,
        consultar: async () => {
          throw Error("rede");
        },
      }),
    ),
  );
  assert.equal(chaves.length, 1);
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })));
  assert.equal(chaves[0], chaves[1]);
});

test("legado: toda recusa SQL transacional libera; desfecho sem código do banco bloqueia, inclusive em outra aba", async () => {
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
    const nav = navegador();
    let writes = 0;
    const registrar = async (_chave, legado) => {
      legado();
      writes++;
      throw Object.assign(new Error("recusa"), { code });
    };
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })));
    assert.equal(nav.dados.size, 0, `${code}: recusa explícita não pode travar o usuário`);
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })));
    assert.equal(writes, 2, `${code}: nova tentativa deve ser possível`);
  }
  for (const erro of [
    new Error("timeout"),
    Object.assign(new Error("gw"), { code: "PGRST000" }),
    Object.assign(new Error("x"), { code: "08006" }),
  ]) {
    const nav = navegador();
    let writes = 0;
    const registrar = async (_chave, legado) => {
      legado();
      writes++;
      throw erro;
    };
    await assert.rejects(() => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })));
    // aba nova (mesmo armazenamento persistente): continua bloqueado
    await assert.rejects(
      () => dominio.executarIntencaoDeAdicional(nav.aba({ registrar })),
      /administrativa/,
    );
    assert.equal(writes, 1);
  }
});

test("o que é persistido: só chave e modo, por identidade; valor/motivo/referência jamais", async () => {
  const nav = navegador();
  await assert.rejects(() =>
    dominio.executarIntencaoDeAdicional(
      nav.aba({
        registrar: async () => {
          throw new Error("timeout");
        },
      }),
    ),
  );
  assert.deepEqual([...nav.dados.keys()], [CHAVE(USUARIO)]);
  const gravado = JSON.parse(nav.dados.get(CHAVE(USUARIO)));
  assert.deepEqual(Object.keys(gravado).sort(), ["chave", "legado"]);
  assert.equal(gravado.legado, false);
});

test("LIMITE: storage apagado ou outro dispositivo não recupera o marcador", async () => {
  const chaves = [];
  const registrar = async (chave) => {
    chaves.push(chave);
    throw new Error("resposta perdida");
  };
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(navegador().aba({ registrar })));
  await assert.rejects(() => dominio.executarIntencaoDeAdicional(navegador().aba({ registrar })));
  assert.notEqual(chaves[0], chaves[1], "sem marcador não há como reconciliar");
});
