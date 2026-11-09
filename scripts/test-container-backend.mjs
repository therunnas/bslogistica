/** FIN-PR-11B: domínio real → contrato RPC, sem rede e sem banco. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const base = {
  clienteId: "5c45c000-0000-4000-8000-0000000000c1",
  solicitadoEm: "2026-11-03",
  executadoEm: "2026-11-04",
  descricao: "  Descarga sintética  ",
  quantidade: 3,
  totalCobrado: "100,01",
  referencia: "  ORDEM-11B  ",
  participantes: [
    { colaboradorId: "5c45f000-0000-4000-8000-000000000001", valorDevido: "10,01" },
    { colaboradorId: "5c45f000-0000-4000-8000-000000000002", valorDevido: "20.02" },
  ],
  modalidadeCusto: "total_distribuido",
  totalDistribuido: "30,03",
  competenciaCobranca: { inicio: "2026-10-16", fim: "2026-10-31" },
};
const key = "5c45b000-0000-4000-8000-000000000001";
const id = "5c45b000-0000-4000-8000-000000000002";
const reason = "Registro sintético autorizado";
let modulo;
async function backend() {
  if (!modulo) {
    try {
      modulo = await import("../src/lib/container-servico-backend.ts");
    } catch (erro) {
      if (erro.code === "ERR_MODULE_NOT_FOUND") {
        assert.fail("FIN11B feature missing: adaptador container-servico-backend.ts");
      }
      throw erro;
    }
  }
  return modulo;
}
function cliente(resposta = { data: id, error: null }) {
  const chamadas = [];
  return {
    chamadas,
    rpc: async (nome, parametros) => {
      chamadas.push({ nome, parametros });
      return resposta;
    },
  };
}

test("registro transmite centavos exatos, quantidade física e competência independente", async () => {
  const { registrarServicoContainer } = await backend();
  const db = cliente();
  assert.equal(await registrarServicoContainer(db, base, key, `  ${reason}  `), id);
  assert.deepEqual(db.chamadas, [
    {
      nome: "registrar_servico_container",
      parametros: {
        p_idempotency_key: key,
        p_reason: reason,
        p_dados: {
          clienteId: base.clienteId,
          operacaoId: null,
          solicitadoEm: base.solicitadoEm,
          executadoEm: base.executadoEm,
          descricao: "Descarga sintética",
          quantidade: 3,
          receitaCentavos: 10001,
          custoTotalCentavos: 3003,
          referencia: "ORDEM-11B",
          participantes: [
            { colaboradorId: base.participantes[0].colaboradorId, custoCentavos: 1001 },
            { colaboradorId: base.participantes[1].colaboradorId, custoCentavos: 2002 },
          ],
          modalidadeCusto: "total_distribuido",
          competenciaCobranca: base.competenciaCobranca,
        },
      },
    },
  ]);
});

test("registro no mesmo dia preserva centavos e datas no payload da RPC", async () => {
  const { registrarServicoContainer } = await backend();
  const db = cliente();
  assert.equal(
    await registrarServicoContainer(db, { ...base, solicitadoEm: base.executadoEm }, key, reason),
    id,
  );
  const payload = db.chamadas[0].parametros.p_dados;
  assert.equal(payload.solicitadoEm, payload.executadoEm);
  assert.equal(payload.receitaCentavos, 10001);
  assert.equal(payload.custoTotalCentavos, 3003);
  assert.equal(db.chamadas[0].parametros.p_idempotency_key, key);
});

test("domínio inválido não chama a RPC", async () => {
  const { registrarServicoContainer } = await backend();
  for (const alteracao of [
    { quantidade: 0 },
    { solicitadoEm: "2026-11-05" },
    { totalDistribuido: "30,02" },
    { totalCobrado: "1,001" },
    { participantes: [] },
    { participantes: [base.participantes[0], base.participantes[0]] },
  ]) {
    const db = cliente();
    await assert.rejects(registrarServicoContainer(db, { ...base, ...alteracao }, key, reason));
    assert.equal(db.chamadas.length, 0);
  }
});

test("chave de idempotência e motivo inválidos são recusados antes da RPC", async () => {
  const { registrarServicoContainer } = await backend();
  for (const [chave, motivo] of [
    ["", reason],
    ["nao-uuid", reason],
    [key, "   "],
    [key, "a".repeat(1001)],
  ]) {
    const db = cliente();
    await assert.rejects(registrarServicoContainer(db, base, chave, motivo));
    assert.equal(db.chamadas.length, 0);
  }
});

test("erro de autorização ou conflito do banco permanece disponível ao chamador", async () => {
  const { registrarServicoContainer } = await backend();
  for (const codigo of ["42501", "23505"]) {
    const erro = { code: codigo, message: "Falha sintética" };
    await assert.rejects(
      registrarServicoContainer(cliente({ data: null, error: erro }), base, key, reason),
      (obtido) => obtido === erro,
    );
  }
});

test("registro sem UUID retornado pelo banco falha de modo fechado", async () => {
  const { registrarServicoContainer } = await backend();
  for (const data of [null, "", "nao-uuid"]) {
    await assert.rejects(
      registrarServicoContainer(cliente({ data, error: null }), base, key, reason),
    );
  }
});

test("cancelamento transmite somente serviço e motivo e aceita retorno void", async () => {
  const { cancelarServicoContainer } = await backend();
  const db = cliente({ data: null, error: null });
  assert.equal(await cancelarServicoContainer(db, id, `  ${reason}  `), undefined);
  assert.deepEqual(db.chamadas, [
    { nome: "cancelar_servico_container", parametros: { p_id: id, p_reason: reason } },
  ]);
});

test("cancelamento inválido não chama a RPC e bloqueio de faturado propaga", async () => {
  const { cancelarServicoContainer } = await backend();
  for (const [alvo, motivo] of [
    ["nao-uuid", reason],
    [id, ""],
  ]) {
    const db = cliente();
    await assert.rejects(cancelarServicoContainer(db, alvo, motivo));
    assert.equal(db.chamadas.length, 0);
  }
  const erro = { code: "55000", message: "Serviço faturado" };
  await assert.rejects(
    cancelarServicoContainer(cliente({ data: null, error: erro }), id, reason),
    (obtido) => obtido === erro,
  );
});

test("operação existente é enviada à RPC sem criar operação ou contrato", async () => {
  const { registrarServicoContainer } = await backend();
  const db = cliente();
  const operacaoId = "5c45e000-0000-4000-8000-000000000001";
  await registrarServicoContainer(db, { ...base, operacaoId }, key, reason);
  assert.equal(db.chamadas.length, 1);
  assert.equal(db.chamadas[0].nome, "registrar_servico_container");
  assert.equal(db.chamadas[0].parametros.p_dados.operacaoId, operacaoId);
  assert.equal(db.chamadas[0].parametros.p_dados.clienteId, base.clienteId);
  assert.equal("contratoId" in db.chamadas[0].parametros.p_dados, false);
});

test("050 preserva normalizador financeiro/ACL e altera só a ordem das datas", () => {
  const anterior = readFileSync(
    new URL("../supabase/migrations/20261112120000_045_container_servico.sql", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261117120000_050_container_same_day_request.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const original = anterior.match(
    /create function public\.normalizar_payload_container\(p_dados jsonb\)[\s\S]*?\n\$\$;/,
  )[0];
  const nova = migration.match(
    /create or replace function public\.normalizar_payload_container\(p_dados jsonb\)[\s\S]*?\n\$\$;/,
  )[0];
  assert.equal(
    nova,
    original
      .replace("create function", "create or replace function")
      .replace("v_requested >= v_executed", "v_requested > v_executed")
      .replace(
        "O serviço precisa ser solicitado até o dia anterior à execução.",
        "A solicitação não pode ser posterior à execução.",
      ),
  );
  assert.match(migration, /check \(requested_on <= executed_on\)/);
  const comandos = migration.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(comandos, /\b(?:grant|revoke|policy|truncate|delete|update)\b/i);
});
