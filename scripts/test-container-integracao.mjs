import assert from "node:assert/strict";
import test from "node:test";
import { decidirAcaoAdicionalContainer } from "../src/lib/container-servico-ui.ts";
test("vínculo container exige caminho próprio, nunca cancelamento genérico", () => {
  assert.deepEqual(
    decidirAcaoAdicionalContainer(
      { ok: true, data: { servicos: [{ id: "s", billing_additional_id: "a" }] } },
      "a",
    ),
    { tipo: "container", id: "s" },
  );
  assert.deepEqual(decidirAcaoAdicionalContainer({ ok: true, data: { servicos: [] } }, "a"), {
    tipo: "legado",
  });
});
test("erro ou carga pendente não prova que adicional é legado", () => {
  assert.equal(
    decidirAcaoAdicionalContainer(
      { ok: false, codigo: "indisponivel", mensagem: "RPC ausente" },
      "a",
    ).tipo,
    "bloqueado",
  );
  for (const codigo of ["indeterminado", "nao-autorizado", "inconsistente"])
    assert.equal(
      decidirAcaoAdicionalContainer({ ok: false, codigo, mensagem: "erro" }, "a").tipo,
      "bloqueado",
    );
  assert.equal(decidirAcaoAdicionalContainer(undefined, "a").tipo, "bloqueado");
  assert.equal(
    decidirAcaoAdicionalContainer(
      { ok: false, codigo: "indisponivel", schemaLegado: true, mensagem: "sem 045" },
      "a",
    ).tipo,
    "legado",
  );
});
