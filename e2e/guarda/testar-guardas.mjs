/**
 * Testes das próprias travas do E2E, com casos negativos. Não precisam de Docker nem de Supabase:
 * rodam antes de subir o ambiente e falham se alguma trava deixar passar um destino real.
 * Uso: node e2e/guarda/testar-guardas.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
    // Lido do Git, não do disco: na CI o arquivo em disco já foi trocado pelo projeto local.
    const versionado = execFileSync("git", ["show", "HEAD:supabase/config.toml"], {
      encoding: "utf8",
    });
    const projeto = projetoDoConfig(versionado);
    assert.equal(projeto, "ehkduqokntemtmqzdrbd");
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

// ---------------------------------------------------------------------------------------------
// Encerramento do scripts/e2e-local.sh, com STUBS (nenhum docker, supabase, npm ou curl real).
// Cada cenário roda uma CÓPIA do script num diretório temporário, com config.toml próprio e
// comandos falsos no PATH que só registram as chamadas. Prova que validação falha sem reset nem
// stop, que instância alheia é recusada e que a limpeza só atinge o projeto desta execução.
// ---------------------------------------------------------------------------------------------
const PROJETO_STUB = "bs-e2e-stub-1";
const STUBS = {
  docker: `#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
case "$1" in
  info) exit 0 ;;
  ps) [ -n "\${STUB_EXISTENTES:-}" ] && printf '%s\\n' "$STUB_EXISTENTES"; exit 0 ;;
  inspect)
    case "$*" in
      *State.Running*) echo "\${STUB_RODANDO:-true}" ;;
      *Labels*) echo "\${STUB_ROTULO:-$STUB_PROJETO}" ;;
    esac
    exit 0 ;;
  *) exit 0 ;;
esac
`,
  npx: `#!/usr/bin/env bash
echo "npx $*" >>"$STUB_LOG"
case "$*" in
  *"supabase@"*" status"*)
    echo "API_URL=\\"\${STUB_API_URL:-http://127.0.0.1:54321}\\""
    echo 'ANON_KEY="anon-sintetica"'
    echo 'SERVICE_ROLE_KEY="service-sintetica"' ;;
  *"supabase@"*" start"*) exit "\${STUB_START_SAIDA:-0}" ;;
  *"next start"*)
    # App falso: registra o próprio PID e grupo, sobe um filho (como o next-server) e espera.
    d="$(dirname "$STUB_LOG")"
    echo "$$ $(ps -o pgid= -p $$ | tr -d ' ')" >"$d/app.pid"
    sleep 300 &
    echo "$!" >"$d/filho.pid"
    wait
    exit 0 ;;
  *"playwright test"*) exit "\${STUB_PLAYWRIGHT_SAIDA:-1}" ;;
esac
exit 0
`,
  // Simula o macOS: \`setsid\` não existe. Se o script o chamar, fica registrado e falha.
  setsid: `#!/usr/bin/env bash
echo "setsid $*" >>"$STUB_LOG"
echo "setsid: command not found" >&2
exit 127
`,
  npm: `#!/usr/bin/env bash
echo "npm $*" >>"$STUB_LOG"
# Erro durante o ensaio: o build falha depois do reset.
[ "$*" = "run build" ] && exit "\${STUB_BUILD_SAIDA:-1}"
exit 0
`,
  curl: `#!/usr/bin/env bash
echo "curl" >>"$STUB_LOG"
echo '{"id":"00000000-0000-4000-8000-000000000001"}'
`,
};

function montarSandbox({ projeto = PROJETO_STUB, vinculo = false } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "e2e-encerrar-"));
  for (const sub of ["scripts", "e2e/guarda", "e2e/sql", "supabase/.temp", "bin"])
    mkdirSync(join(raiz, sub), { recursive: true });
  copyFileSync("scripts/e2e-local.sh", join(raiz, "scripts/e2e-local.sh"));
  for (const arq of ["regras.mjs", "verificar-ambiente.mjs"])
    copyFileSync(`e2e/guarda/${arq}`, join(raiz, "e2e/guarda", arq));
  // Na cópia, o autoteste das travas é um no-op (evita recursão); o verificador é o real.
  writeFileSync(join(raiz, "e2e/guarda/testar-guardas.mjs"), "");
  writeFileSync(join(raiz, "e2e/sql/semente-local.sql"), "");
  writeFileSync(join(raiz, "supabase/config.toml"), `project_id = "${projeto}"\n`);
  if (vinculo) writeFileSync(join(raiz, "supabase/.temp/project-ref"), "qbnfcmrxmssnwkhaitgd\n");
  for (const [nome, corpo] of Object.entries(STUBS)) {
    writeFileSync(join(raiz, "bin", nome), corpo);
    chmodSync(join(raiz, "bin", nome), 0o755);
  }
  writeFileSync(join(raiz, "chamadas.log"), "");
  return raiz;
}

/** Roda a cópia do script com os stubs; devolve o código de saída e as chamadas registradas. */
function rodarSandbox(raiz, extras = {}) {
  const env = {
    PATH: `${join(raiz, "bin")}:${process.env.PATH}`,
    HOME: process.env.HOME ?? tmpdir(),
    STUB_LOG: join(raiz, "chamadas.log"),
    STUB_PROJETO: PROJETO_STUB,
    ...extras,
  };
  return new Promise((resolve) => {
    const filho = spawn("bash", [join(raiz, "scripts/e2e-local.sh")], { env, cwd: raiz });
    let saida = "";
    filho.stdout.on("data", (p) => (saida += p));
    filho.stderr.on("data", (p) => (saida += p));
    const limite = setTimeout(() => filho.kill("SIGKILL"), 60_000);
    filho.on("close", (codigo) => {
      clearTimeout(limite);
      const chamadas = readFileSync(join(raiz, "chamadas.log"), "utf8").split("\n").filter(Boolean);
      resolve({ codigo, saida, chamadas });
    });
  });
}

const supabase = (r, trecho) =>
  r.chamadas.filter((c) => c.includes("supabase@") && c.includes(trecho));
const destrutivas = (r) =>
  r.chamadas.filter(
    (c) =>
      c.includes("supabase@") &&
      (c.includes(" start") || c.includes(" db reset") || c.includes(" stop")),
  );

const rDestino = await rodarSandbox(montarSandbox({ projeto: "ehkduqokntemtmqzdrbd" }));
const rUrl = await rodarSandbox(montarSandbox(), {
  NEXT_PUBLIC_SUPABASE_URL: "https://qbnfcmrxmssnwkhaitgd.supabase.co",
});
const rVinculo = await rodarSandbox(montarSandbox({ vinculo: true }));
const rExistente = await rodarSandbox(montarSandbox(), {
  STUB_EXISTENTES: `supabase_db_${PROJETO_STUB}`,
});
// Porta da API ocupada por outro processo (servidor de verdade em 127.0.0.1:54321). Se a porta já
// estiver ocupada por algo desta máquina, o cenário vale igual: o script tem de recusar.
const ocupante = createServer((_, res) => res.end("alheio"));
await new Promise((resolve) => {
  ocupante.once("error", () => resolve());
  ocupante.listen(54321, "127.0.0.1", resolve);
});
const rPorta = await rodarSandbox(montarSandbox());
await new Promise((resolve) => ocupante.close(() => resolve()));
const rProprioErro = await rodarSandbox(montarSandbox());
const rIdentidade = await rodarSandbox(montarSandbox(), {
  // URL inesperada mas sem referência real (uma com ref real já pararia no passo 1).
  STUB_API_URL: "http://127.0.0.1:65000",
});
const rRotulo = await rodarSandbox(montarSandbox(), { STUB_ROTULO: "bs-e2e-outro" });

// I1 (portabilidade): o app sobe sem `setsid`, num grupo de processos próprio, e um erro no ensaio
// (Playwright falha) encerra o líder e o filho. Build verdadeiro no stub para chegar até o app.
const raizApp = montarSandbox();
const rApp = await rodarSandbox(raizApp, { STUB_BUILD_SAIDA: "0" });
const lerPid = (arquivo) => {
  try {
    return readFileSync(join(raizApp, arquivo), "utf8").trim().split(/\s+/);
  } catch {
    return [];
  }
};
const [appPid, appGrupo] = lerPid("app.pid");
const [filhoPid] = lerPid("filho.pid");
/** Encerrado = não existe mais ou é zumbi (o PID 1 de alguns contêineres não recolhe zumbis). */
function encerrado(pid) {
  try {
    const estado = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    return estado.trim() === "" || estado.trim().startsWith("Z");
  } catch {
    return true;
  }
}
async function esperarEncerrar(pids) {
  for (let i = 0; i < 50 && !pids.every(encerrado); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  return pids.every(encerrado);
}
const appEncerrado = appPid && filhoPid ? await esperarEncerrar([appPid, filhoPid]) : false;
// Nunca deixar processo de teste para trás, mesmo se a verificação falhar.
if (!appEncerrado && appGrupo) {
  try {
    process.kill(-Number(appGrupo), "SIGKILL");
  } catch {
    // grupo já encerrado
  }
}

caso("G14. destino inválido (project_id da Production): sai sem start, reset nem stop", () => {
  assert.notEqual(rDestino.codigo, 0);
  assert.deepEqual(destrutivas(rDestino), []);
  assert.match(rDestino.saida, /Nenhum Supabase desta execução para encerrar/);
});
caso("G15. URL externa no ambiente: sai sem start, reset nem stop", () => {
  assert.notEqual(rUrl.codigo, 0);
  assert.deepEqual(destrutivas(rUrl), []);
});
caso("G16. vínculo remoto (supabase/.temp/project-ref): sai sem start, reset nem stop", () => {
  assert.notEqual(rVinculo.codigo, 0);
  assert.deepEqual(destrutivas(rVinculo), []);
});
caso("G17. instância preexistente (container): recusada, nenhuma operação destrutiva", () => {
  assert.notEqual(rExistente.codigo, 0);
  assert.match(rExistente.saida, /já existe Supabase local/);
  assert.deepEqual(destrutivas(rExistente), []);
});
caso("G18. porta local ocupada por outro processo: recusada, nenhuma operação destrutiva", () => {
  assert.notEqual(rPorta.codigo, 0);
  assert.match(rPorta.saida, /porta local 54321 já está em uso/);
  assert.deepEqual(destrutivas(rPorta), []);
});
caso("G19. instância própria validada + erro no ensaio: reset e stop só do projeto próprio", () => {
  assert.notEqual(rProprioErro.codigo, 0);
  assert.equal(supabase(rProprioErro, " start").length, 1);
  assert.equal(supabase(rProprioErro, " db reset --local").length, 1);
  const stops = supabase(rProprioErro, " stop");
  assert.deepEqual(
    stops.map((c) => c.replace(/^npx --yes supabase@[\d.]+ /, "")),
    [`stop --project-id ${PROJETO_STUB} --no-backup`],
  );
  // O reset veio depois da conferência de identidade (inspect) e antes do stop.
  const ordem = (trecho) => rProprioErro.chamadas.findIndex((c) => c.includes(trecho));
  assert.ok(ordem("Labels") < ordem(" db reset"));
  assert.ok(ordem(" db reset") < ordem(" stop"));
});
caso("G20. identidade divergente depois do start: sem reset; stop só do projeto próprio", () => {
  for (const r of [rIdentidade, rRotulo]) {
    assert.notEqual(r.codigo, 0);
    assert.deepEqual(supabase(r, " db reset"), []);
    assert.deepEqual(
      supabase(r, " stop").map((c) => c.replace(/^npx --yes supabase@[\d.]+ /, "")),
      [`stop --project-id ${PROJETO_STUB} --no-backup`],
    );
  }
  assert.match(rIdentidade.saida, /API local inesperada/);
  assert.match(rRotulo.saida, /pertence a "bs-e2e-outro"/);
});
caso("G21. nenhum cenário usa stop sem --project-id nem --all", () => {
  const todas = [
    rDestino,
    rUrl,
    rVinculo,
    rExistente,
    rPorta,
    rProprioErro,
    rIdentidade,
    rRotulo,
    rApp,
  ];
  for (const r of todas)
    for (const c of supabase(r, " stop")) {
      assert.match(c, /stop --project-id bs-e2e-[a-z0-9-]+ --no-backup$/);
      assert.doesNotMatch(c, /--all/);
    }
});

caso("G22. o script não chama `setsid` (ausente no macOS; I1)", () => {
  const codigo = readFileSync("scripts/e2e-local.sh", "utf8")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("#"));
  assert.deepEqual(
    codigo.filter((linha) => /\bsetsid\b/.test(linha)),
    [],
  );
});
caso("G23. com `setsid` indisponível, o app sobe e nada chama `setsid`", () => {
  assert.ok(appPid, `o app falso não subiu; saída: ${rApp.saida.slice(-400)}`);
  assert.deepEqual(
    rApp.chamadas.filter((c) => c.startsWith("setsid")),
    [],
  );
  assert.ok(rApp.chamadas.some((c) => c.includes("next start -H 127.0.0.1 -p 3000")));
});
caso("G24. o app fica num grupo de processos próprio (líder do grupo)", () => {
  assert.equal(appGrupo, appPid);
});
caso("G25. erro no ensaio: encerra o app inteiro (líder e filho) e só o Supabase próprio", () => {
  assert.notEqual(rApp.codigo, 0);
  assert.ok(appEncerrado, `processos do app ainda vivos: ${appPid} ${filhoPid}`);
  assert.deepEqual(
    supabase(rApp, " stop").map((c) => c.replace(/^npx --yes supabase@[\d.]+ /, "")),
    [`stop --project-id ${PROJETO_STUB} --no-backup`],
  );
  assert.ok(rApp.chamadas.some((c) => c.includes("playwright test")));
});

console.log(`\n${total} verificações das travas: todas PASS.`);
