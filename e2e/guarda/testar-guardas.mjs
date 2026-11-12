/**
 * Testes das próprias travas do E2E, com casos negativos. Não precisam de Docker nem de Supabase:
 * rodam antes de subir o ambiente e falham se alguma trava deixar passar um destino real.
 * Uso: node e2e/guarda/testar-guardas.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  problemasDoAmbiente,
  projetoDoConfig,
  referenciaProibida,
  urlPermitida,
} from "./regras.mjs";

let total = 0;
function caso(nome, fn) {
  fn();
  total += 1;
  console.log(`PASS  ${nome}`);
}

const BASE = {
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
  projetoId: "bs-e2e-ci-1-1",
  vinculoRemoto: false,
};

caso("G1. ambiente local correto é aceito", () => {
  assert.deepEqual(problemasDoAmbiente(BASE), []);
});
caso("G2. URL do HML é recusada", () => {
  const r = problemasDoAmbiente({
    ...BASE,
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://qbnfcmrxmssnwkhaitgd.supabase.co" },
  });
  assert.ok(r.length >= 2);
});
caso("G3. URL da Production é recusada", () => {
  const r = problemasDoAmbiente({
    ...BASE,
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://ehkduqokntemtmqzdrbd.supabase.co" },
  });
  assert.ok(r.some((p) => p.includes("NEXT_PUBLIC_SUPABASE_URL")));
});
caso("G4. qualquer variável com referência real é recusada", () => {
  const r = problemasDoAmbiente({
    ...BASE,
    env: { ...BASE.env, OUTRA: "postgres://x@db.ehkduqokntemtmqzdrbd.supabase.co" },
  });
  assert.ok(r.some((p) => p.startsWith("variável OUTRA")));
});
caso("G5. project_id do repositório (Production) é recusado", () => {
  assert.ok(problemasDoAmbiente({ ...BASE, projetoId: "ehkduqokntemtmqzdrbd" }).length > 0);
});
caso("G6. project_id sem o prefixo local é recusado", () => {
  assert.ok(problemasDoAmbiente({ ...BASE, projetoId: "meu-projeto" }).length > 0);
});
caso("G7. vínculo remoto é recusado", () => {
  assert.ok(problemasDoAmbiente({ ...BASE, vinculoRemoto: true }).length > 0);
});
caso("G8. domínio da Vercel e do site são proibidos", () => {
  assert.ok(referenciaProibida("https://bs-logistica-sistema-x.vercel.app"));
  assert.ok(referenciaProibida("https://admin.bslogisticas.com.br"));
});
caso("G9. navegador: só loopback é permitido", () => {
  assert.equal(urlPermitida("http://127.0.0.1:3000/login"), true);
  assert.equal(urlPermitida("http://localhost:54321/rest/v1/"), true);
  assert.equal(urlPermitida("data:image/png;base64,AA=="), true);
  assert.equal(urlPermitida("https://qbnfcmrxmssnwkhaitgd.supabase.co/rest/v1/"), false);
  assert.equal(urlPermitida("https://fonts.gstatic.com/x.woff2"), false);
  assert.equal(urlPermitida("https://127.0.0.1.nip.io/"), false);
});
caso(
  "G10. o config.toml versionado aponta para Production e por isso é recusado sem a troca",
  () => {
    const projeto = projetoDoConfig(readFileSync("supabase/config.toml", "utf8"));
    assert.ok(problemasDoAmbiente({ ...BASE, projetoId: projeto }).length > 0);
  },
);

// Trava de rede do servidor (rede.cjs): conexão externa recusada, local permitida.
const dir = mkdtempSync(join(tmpdir(), "e2e-guarda-"));
const log = join(dir, "rede.log");
writeFileSync(log, "");
const servidor = createServer((_, res) => res.end("ok"));
await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const porta = servidor.address().port;
const programa = `
  const r = {};
  try { await fetch("https://example.com/"); r.externo = "conectou"; }
  catch (e) { r.externo = String(e?.cause?.code ?? e?.code ?? e?.message); }
  try { const t = await (await fetch("http://127.0.0.1:${porta}/")).text(); r.local = t; }
  catch (e) { r.local = "falhou " + String(e?.cause?.code ?? e?.message); }
  console.log(JSON.stringify(r));
`;
// Assíncrono: o servidor local acima roda neste mesmo processo e precisa responder.
const stdout = await new Promise((resolve, reject) => {
  const filho = spawn(
    process.execPath,
    ["--require", "./e2e/guarda/rede.cjs", "--input-type=module", "-e", programa],
    { env: { ...process.env, E2E_REDE_LOG: log } },
  );
  let texto = "";
  const limite = setTimeout(() => {
    filho.kill();
    reject(new Error("processo de teste da trava de rede excedeu 30 s"));
  }, 30_000);
  filho.stdout.on("data", (parte) => (texto += parte));
  filho.on("close", () => {
    clearTimeout(limite);
    resolve(texto);
  });
});
servidor.close();
const saida = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");

caso("G11. servidor: conexão externa é bloqueada pela trava", () => {
  assert.equal(saida.externo, "E2E_REDE_BLOQUEADA");
});
caso("G12. servidor: conexão local continua funcionando", () => {
  assert.equal(saida.local, "ok");
});
caso("G13. servidor: a tentativa bloqueada fica registrada", () => {
  assert.match(readFileSync(log, "utf8"), /BLOQUEADO example\.com/);
});

console.log(`\n${total} verificações das travas: todas PASS.`);
