import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dados = await import("../src/lib/container-servico-dados.ts");
const servidor = await import("../src/lib/container-servico-servidor.ts");

test("capacidade ausente é diferente de rede e autorização", () => {
  assert.equal(dados.classificarErroContainer({ code: "42P01" }).codigo, "indisponivel");
  assert.equal(dados.classificarErroContainer({ code: "PGRST202" }).codigo, "indisponivel");
  assert.equal(dados.classificarErroContainer({ code: "42501" }).codigo, "nao-autorizado");
  assert.equal(
    dados.classificarErroContainer(new TypeError("fetch failed")).codigo,
    "indeterminado",
  );
  assert.equal(dados.classificarErroContainer({ code: "23505" }).codigo, "conflito");
  assert.equal(dados.classificarErroContainer({ code: "55000" }).codigo, "estado-incompativel");
});

for (const papel of ["operacional", "sem-papel", "anon", "sessao-invalida", "admin-mfa-pendente"]) {
  test(`Actions recusam ${papel} antes de criar cliente ou consultar dados`, async () => {
    let acessos = 0;
    const acoes = servidor.criarAcoesContainer({
      autorizar: async () => {
        throw new Error("negado");
      },
      cliente: async () => {
        acessos++;
        throw new Error("não deveria chegar");
      },
    });
    for (const chamada of [
      () => acoes.listar({}),
      () => acoes.formulario(),
      () => acoes.detalhar("invalido"),
      () => acoes.registrar({}),
      () => acoes.cancelar({}),
      () => acoes.vinculo("invalido"),
      () => acoes.marcador("invalido"),
      () => acoes.recuperar("invalido", "invalido", {}),
    ])
      assert.equal((await chamada()).codigo, "nao-autorizado");
    assert.equal(acessos, 0);
  });
}

for (const identidade of ["admin-aal1-sem-fator", "admin-aal2-com-fator"]) {
  test(`Actions respeitam guarda existente para ${identidade}`, async () => {
    let acessos = 0;
    const acoes = servidor.criarAcoesContainer({
      autorizar: async () => ({ id: "10000000-0000-4000-8000-000000000001" }),
      cliente: async () => {
        acessos++;
        throw { code: "42P01" };
      },
    });
    assert.equal((await acoes.formulario()).codigo, "indisponivel");
    assert.equal(acessos, 1);
  });
}

test("Actions reais delegam autorização e usam cliente da sessão", () => {
  const fonte = readFileSync("src/app/(painel)/containers/_acoes.ts", "utf8");
  assert.match(fonte, /exigirAdminAtor/);
  assert.match(fonte, /criarClienteServidor/);
  assert.doesNotMatch(fonte, /service_role|criarClienteAdmin/);
});

test("paginação de participantes usa employee_id e recusa página incompleta", async () => {
  const chamadas = [];
  const cliente = {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        order: (k) => {
          chamadas.push(k);
          return q;
        },
        gt: () => q,
        limit: () => q,
        then: (fn) => Promise.resolve({ data: null, error: null }).then(fn),
      };
      return q;
    },
  };
  await assert.rejects(
    dados.lerParticipantesContainer(cliente, "10000000-0000-4000-8000-000000000001"),
  );
  assert.ok(chamadas.includes("employee_id"));
  assert.ok(!chamadas.includes("id"));
});

test("recusa payload desconhecido e filtros inválidos", () => {
  assert.throws(() => dados.validarFiltroContainer({ inicio: "2026-02-30" }));
  assert.throws(() => dados.validarFiltroContainer({ clienteId: "outro" }));
  assert.throws(() => dados.validarFiltroContainer({ inicio: "2026-02-03", fim: "2026-02-01" }));
});

const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(n = 1) {
  return {
    id: uuid(n),
    client_id: uuid(900),
    operation_id: null,
    requested_on: "2026-02-02",
    executed_on: "2026-02-03",
    description: "Sintético",
    quantity: 3,
    revenue_cents: 10001,
    cost_total_cents: 3003,
    reference: null,
    cost_mode: "por_pessoa",
    billing_additional_id: uuid(n + 1000),
    canceled_at: null,
    clients: { name: "CLIENTE_TESTE" },
    operations: null,
    billing_additionals: {
      id: uuid(n + 1000),
      client_id: uuid(900),
      operation_id: null,
      amount: 100.01,
      period_start: "2026-02-03",
      period_end: "2026-02-03",
      billing_period_start: "2026-02-01",
      billing_period_end: "2026-02-15",
      invoice_id: null,
      canceled_at: null,
    },
  };
}
function dbFake(tabelas, rpc = async () => ({ data: uuid(1), error: null })) {
  return {
    rpc,
    from: (tabela) => {
      let filtros = [],
        contar = false,
        max = Infinity;
      const q = {
        select: (_, o) => {
          contar = !!o?.head;
          return q;
        },
        eq: (k, v) => {
          filtros.push((r) => r[k] === v);
          return q;
        },
        gt: (k, v) => {
          filtros.push((r) => r[k] > v);
          return q;
        },
        gte: (k, v) => {
          filtros.push((r) => r[k] >= v);
          return q;
        },
        lte: (k, v) => {
          filtros.push((r) => r[k] <= v);
          return q;
        },
        order: () => q,
        limit: (n) => {
          max = n;
          return q;
        },
        then: (fn) => {
          const rows = (tabelas[tabela] ?? []).filter((r) => filtros.every((f) => f(r)));
          return Promise.resolve({
            data: contar ? null : rows.slice(0, max),
            error: null,
            count: rows.length,
          }).then(fn);
        },
      };
      return q;
    },
  };
}

test("lista mais de uma página sem perder dados, ordenação estável e filtro", async () => {
  const db = dbFake({ container_services: Array.from({ length: 205 }, (_, i) => fixture(i + 1)) });
  const result = await dados.listarContainers(db, {
    clienteId: uuid(900),
    inicio: "2026-02-03",
    fim: "2026-02-03",
  });
  assert.equal(result.servicos.length, 205);
  assert.equal(result.servicos[0].id, uuid(1));
  assert.equal((await dados.listarContainers(db, { inicio: "2026-02-04" })).servicos.length, 0);
});
test("lastro ausente ou valor divergente nunca vira lista parcial/zero", async () => {
  for (const patch of [{ billing_additionals: null }, { revenue_cents: 999 }, { clients: null }]) {
    await assert.rejects(
      dados.listarContainers(dbFake({ container_services: [{ ...fixture(), ...patch }] }), {}),
    );
  }
});
test("detalhe valida soma, histórico e competência sem expor sessão/payload", async () => {
  const tabelas = {
    container_services: [fixture()],
    container_service_participants: [
      {
        service_id: uuid(1),
        employee_id: uuid(5),
        cost_cents: 3003,
        employees: { name: "COLAB_TESTE" },
      },
    ],
    container_service_audit: [
      {
        id: uuid(6),
        service_id: uuid(1),
        action: "registered",
        reason: "Sintético",
        created_at: "2026-02-03T12:00:00Z",
        actor_session_id: "nao-devolver",
      },
    ],
  };
  const result = await dados.detalharContainer(dbFake(tabelas), uuid(1));
  assert.deepEqual(result.competencia, { inicio: "2026-02-01", fim: "2026-02-15" });
  assert.ok(!JSON.stringify(result).includes("nao-devolver"));
  tabelas.container_service_participants[0].cost_cents = 3002;
  await assert.rejects(dados.detalharContainer(dbFake(tabelas), uuid(1)));
});
const lote = {
  clienteId: uuid(900),
  solicitadoEm: "2026-02-02",
  executadoEm: "2026-02-03",
  descricao: "Sintético",
  quantidade: 3,
  totalCobrado: "100,01",
  participantes: [{ colaboradorId: uuid(5), valorDevido: "30,03" }],
  modalidadeCusto: "por_pessoa",
};
const { prepararLoteDeContainers } = await import("../src/lib/container-servico.ts");
test("recuperação distingue ausência, gravação confirmada e conflito", async () => {
  const payload = prepararLoteDeContainers(lote);
  const row = {
    id: uuid(1),
    client_id: uuid(900),
    idempotency_key: uuid(50),
    request_payload: payload,
  };
  assert.deepEqual(
    await dados.recuperarRegistroContainer(
      dbFake({ container_services: [row] }),
      uuid(900),
      uuid(50),
      payload,
    ),
    { estado: "registrado", id: uuid(1) },
  );
  assert.deepEqual(
    await dados.recuperarRegistroContainer(dbFake({}), uuid(900), uuid(50), payload),
    { estado: "ausente" },
  );
  await assert.rejects(
    dados.recuperarRegistroContainer(dbFake({ container_services: [row] }), uuid(900), uuid(50), {
      ...payload,
      receitaCentavos: 999,
    }),
    (e) => e.code === "23505",
  );
});
test("timeout após commit reconcilia sem gerar outra receita nem chave", async () => {
  const rows = [];
  let chamadas = 0;
  const db = dbFake({ container_services: rows }, async (_, args) => {
    chamadas++;
    rows.push({
      id: uuid(1),
      client_id: uuid(900),
      idempotency_key: args.p_idempotency_key,
      request_payload: args.p_dados,
    });
    throw new TypeError("resposta perdida após commit");
  });
  const acoes = servidor.criarAcoesContainer({
    autorizar: async () => ({ id: uuid(7) }),
    cliente: async () => db,
  });
  assert.equal(
    (await acoes.registrar({ lote, chave: uuid(50), motivo: "Sintético" })).codigo,
    "indeterminado",
  );
  assert.deepEqual(await acoes.registrar({ lote, chave: uuid(50), motivo: "Sintético" }), {
    ok: true,
    data: { id: uuid(1) },
  });
  assert.equal(chamadas, 1);
});
test("serviço faturado recusa cancelamento antes de RPC e estado posterior ainda é validado no banco", async () => {
  const f = fixture();
  f.billing_additionals.invoice_id = uuid(77);
  const db = dbFake(
    {
      container_services: [f],
      container_service_participants: [
        {
          service_id: uuid(1),
          employee_id: uuid(5),
          cost_cents: 3003,
          employees: { name: "COLAB_TESTE" },
        },
      ],
      container_service_audit: [
        {
          id: uuid(6),
          service_id: uuid(1),
          action: "registered",
          reason: "Sintético",
          created_at: "2026-02-03T12:00:00Z",
        },
      ],
    },
    () => assert.fail("não chamar RPC para faturado"),
  );
  const acoes = servidor.criarAcoesContainer({
    autorizar: async () => ({ id: uuid(7) }),
    cliente: async () => db,
  });
  assert.equal(
    (await acoes.cancelar({ id: uuid(1), motivo: "Sintético" })).codigo,
    "estado-incompativel",
  );
});
test("motivo obrigatório continua validado no retry já registrado", async () => {
  const db = dbFake({
    container_services: [
      {
        id: uuid(1),
        client_id: uuid(900),
        idempotency_key: uuid(50),
        request_payload: prepararLoteDeContainers(lote),
      },
    ],
  });
  const acoes = servidor.criarAcoesContainer({
    autorizar: async () => ({ id: uuid(7) }),
    cliente: async () => db,
  });
  assert.equal((await acoes.registrar({ lote, chave: uuid(50), motivo: " " })).codigo, "validacao");
  assert.equal(
    (
      await acoes.registrar({
        lote: { ...lote, quantidade: 0 },
        chave: uuid(50),
        motivo: "Sintético",
      })
    ).codigo,
    "validacao",
  );
});
test("UUIDs de caixa diferente reconciliam o mesmo payload canônico do SQL", async () => {
  const cliente = "abcdef00-0000-4000-8000-000000000001";
  const lower = prepararLoteDeContainers({ ...lote, clienteId: cliente });
  const upper = prepararLoteDeContainers({ ...lote, clienteId: cliente.toUpperCase() });
  const db = dbFake({
    container_services: [
      {
        id: uuid(1),
        client_id: cliente.toUpperCase(),
        idempotency_key: uuid(50),
        request_payload: lower,
      },
    ],
  });
  assert.deepEqual(
    await dados.recuperarRegistroContainer(db, cliente.toUpperCase(), uuid(50), upper),
    { estado: "registrado", id: uuid(1) },
  );
});
test("texto comercial que parece UUID continua sensível a caixa", async () => {
  const referencia = "abcdef00-0000-4000-8000-000000000001";
  const lower = prepararLoteDeContainers({ ...lote, referencia });
  const upper = { ...lower, referencia: referencia.toUpperCase() };
  const db = dbFake({
    container_services: [
      { id: uuid(1), client_id: uuid(900), idempotency_key: uuid(50), request_payload: lower },
    ],
  });
  await assert.rejects(
    dados.recuperarRegistroContainer(db, uuid(900), uuid(50), upper),
    (e) => e.code === "23505",
  );
});
test("mapa financeiro antigo não autoriza cancelar: consulta fresca resolve vínculo novo", async () => {
  const db = dbFake({ container_services: [{ id: uuid(1), billing_additional_id: uuid(1001) }] });
  assert.deepEqual(await dados.lerVinculoAdicionalContainer(db, uuid(1001)), {
    tipo: "container",
    id: uuid(1),
  });
  assert.deepEqual(await dados.lerVinculoAdicionalContainer(db, uuid(1002)), { tipo: "legado" });
});

test("marcador reconcilia após reload sem receber/devolver payload nem chamar RPC", async () => {
  let escritas = 0;
  const rows = [
    {
      id: uuid(1),
      client_id: uuid(900),
      idempotency_key: uuid(50),
      request_payload: prepararLoteDeContainers(lote),
    },
  ];
  const db = dbFake({ container_services: rows }, () => {
    escritas++;
  });
  const acoes = servidor.criarAcoesContainer({
    autorizar: async () => ({ id: uuid(7) }),
    cliente: async () => db,
  });
  assert.deepEqual(await acoes.marcador(uuid(50)), {
    ok: true,
    data: { estado: "registrado", id: uuid(1) },
  });
  assert.deepEqual(await acoes.marcador(uuid(51)), { ok: true, data: { estado: "ausente" } });
  assert.equal((await acoes.marcador("invalido")).codigo, "validacao");
  rows.push({ ...rows[0], id: uuid(2), client_id: uuid(901) });
  assert.equal((await acoes.marcador(uuid(50))).codigo, "inconsistente");
  assert.equal(escritas, 0);
});
