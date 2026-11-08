import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGitHubApi } from "./checkpoint-github-api.mjs";
import { main } from "./atualizar-checkpoint-preview.mjs";

const engine = await import("./checkpoint-preview.mjs").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const repository = "therunnas/bslogistica";
const sha = "a".repeat(40);
const branch = "integracao/candidate";
const handoff =
  readFileSync(new URL("../docs/HANDOFF.md", import.meta.url), "utf8").replace(
    /<!-- checkpoint-preview:start -->[\s\S]*?<!-- checkpoint-preview:end -->/g,
    "",
  ) + "\n<!-- checkpoint-preview:start -->\nSem recibo.\n<!-- checkpoint-preview:end -->\n";

function fixture() {
  const state = {
    head: sha,
    files: [{ filename: "src/lib/example.ts", status: "modified" }],
    pr: {
      number: 111,
      state: "open",
      head: { sha, ref: branch, repo: { full_name: repository } },
    },
    deployment: {
      id: 42,
      sha,
      environment: "Preview",
      production_environment: false,
      creator: { login: "vercel[bot]", type: "Bot" },
    },
    statuses: [
      {
        state: "success",
        environment: "Preview",
        environment_url: "https://bs-logistica-sistema-example-bslogisticas.vercel.app",
        created_at: "2026-11-08T12:00:00Z",
        creator: { login: "vercel[bot]", type: "Bot" },
      },
    ],
    run: {
      id: 99,
      head_sha: sha,
      head_repository: { full_name: repository },
      event: "pull_request",
      path: ".github/workflows/ci.yml",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
    },
    jobs: [
      { name: "validar", status: "completed", conclusion: "success" },
      { name: "sql-local", status: "completed", conclusion: "success" },
    ],
    commits: [],
    stored: new Map([["docs/HANDOFF.md", handoff]]),
    race: false,
  };
  const api = {
    async get(path) {
      if (path === "") return { full_name: repository, default_branch: "main" };
      if (path === "deployments/42") return state.deployment;
      if (path === "actions/runs/99") return state.run;
      if (path.startsWith("git/ref/heads/")) return { object: { sha: state.head } };
      if (path === "pulls/111") return state.pr;
      if (path.startsWith("commits/")) return { sha, parents: [{ sha: "b".repeat(40) }] };
      throw new Error(`Unexpected GET ${path}`);
    },
    async list(path, field) {
      if (path === "deployments/42/statuses") return state.statuses;
      if (path.startsWith("deployments?")) return [state.deployment];
      if (path.endsWith("/pulls")) return [state.pr];
      if (path.startsWith("actions/workflows/ci.yml/runs?")) return [state.run];
      if (path === "actions/runs/99/jobs") return state.jobs;
      if (field === "files") return state.files;
      throw new Error(`Unexpected LIST ${path}`);
    },
    async getFile(path) {
      return state.stored.has(path) ? state.stored.get(path) : null;
    },
    async commit(input) {
      if (state.race) state.head = "c".repeat(40);
      assert.equal(input.expectedHeadOid, state.head, "HEAD concorrente");
      state.commits.push(input);
      for (const file of input.files) state.stored.set(file.path, file.content);
      state.head = "d".repeat(40);
      state.pr.head.sha = state.head;
      return { oid: state.head };
    },
  };
  const options = {
    api,
    repository,
    enabled: true,
    branchAllowlist: [branch],
    previewProject: "bs-logistica-sistema",
    previewTeam: "bslogisticas",
    eventName: "deployment_status",
    event: { repository: { full_name: repository }, deployment: { id: 42 } },
    publish: true,
  };
  return { state, api, options };
}

test("motor existe com interface de reconciliação", () => {
  assert.equal(typeof engine.reconcilePreview, "function");
});

test("Preview e CI no mesmo SHA produzem um commit atômico com recibo e HANDOFF", async () => {
  const { state, options } = fixture();
  const result = await engine.reconcilePreview(options);
  assert.equal(result.status, "published");
  assert.equal(state.commits.length, 1);
  const input = state.commits[0];
  assert.equal(input.branch, branch);
  assert.equal(input.expectedHeadOid, sha);
  assert.deepEqual(
    input.files.map((file) => file.path),
    ["docs/HANDOFF.md", "docs/continuidade/previews/deployment-42.json"],
  );
  const receipt = JSON.parse(input.files[1].content);
  assert.equal(receipt.commit, sha);
  assert.equal(receipt.github_deployment_id, 42);
  assert.equal(receipt.ci.run_id, 99);
  assert.equal(receipt.functional_homologation, "not_verified");
  assert.equal(receipt.vercel_deployment_id, null);
  assert.equal(receipt.deployed_at, "2026-11-08T12:00:00Z");
  assert.ok(!input.files[1].content.includes("creator"));
  assert.equal(
    input.files[0].content.split("<!-- checkpoint-preview:start -->")[0],
    handoff.split("<!-- checkpoint-preview:start -->")[0],
  );
});

test("repetição do evento após publicação não duplica histórico", async () => {
  const { state, options } = fixture();
  await engine.reconcilePreview(options);
  await engine.reconcilePreview(options);
  assert.equal(state.commits.length, 1);
});

test("modo seco e chave de ativação desligada nunca escrevem", async () => {
  for (const override of [{ publish: false }, { enabled: false }]) {
    const { state, options } = fixture();
    await engine.reconcilePreview({ ...options, ...override });
    assert.equal(state.commits.length, 0);
  }
});

test("commits exclusivamente documentais e recibos automáticos não alimentam loops", async () => {
  for (const files of [
    [{ filename: "docs/HANDOFF.md", status: "modified" }],
    [
      { filename: "docs/HANDOFF.md", status: "modified" },
      { filename: "docs/continuidade/previews/deployment-42.json", status: "added" },
    ],
  ]) {
    const { state, options } = fixture();
    state.files = files;
    const result = await engine.reconcilePreview(options);
    assert.equal(result.status, "skipped");
    assert.equal(state.commits.length, 0);
  }
});

test("renomear código para documentação não o classifica como documental", () => {
  assert.equal(
    engine.isDocumentationOnly([
      { filename: "docs/example.md", previous_filename: "src/example.ts", status: "renamed" },
    ]),
    false,
  );
  assert.equal(engine.isDocumentationOnly([]), false);
  assert.equal(engine.isDocumentationOnly([{ filename: "docs/runbooks/example.sql" }]), false);
});

test("CI ausente, incompleta, falha, pulada ou de outro SHA recusa publicação", async () => {
  for (const mutate of [
    (s) => (s.run.status = "in_progress"),
    (s) => (s.run.conclusion = "failure"),
    (s) => (s.run.head_sha = "e".repeat(40)),
    (s) => (s.jobs[0].conclusion = "skipped"),
    (s) => (s.jobs = s.jobs.slice(0, 1)),
    (s) => (s.run.event = "push"),
    (s) => (s.run.path = ".github/workflows/other.yml"),
  ]) {
    const { state, options } = fixture();
    mutate(state);
    await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
});

test("evento de CI posterior ao Preview reconcilia a mesma evidência", async () => {
  const { state, options } = fixture();
  options.eventName = "workflow_run";
  options.event.workflow_run = { id: 99 };
  await engine.reconcilePreview(options);
  assert.equal(state.commits.length, 1);
});

test("Preview falho, estado mais recente inativo e origem não Vercel falham fechados", async () => {
  for (const mutate of [
    (s) => (s.statuses[0].state = "failure"),
    (s) => s.statuses.unshift({ state: "inactive" }),
    (s) => (s.deployment.creator.login = "other[bot]"),
    (s) => (s.statuses[0].creator.type = "User"),
    (s) => (s.deployment.environment = "Production"),
    (s) => (s.deployment.production_environment = true),
    (s) => (s.statuses[0].environment = "Production"),
    (s) => (s.statuses[0].created_at = "unknown"),
  ]) {
    const { state, options } = fixture();
    mutate(state);
    await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
});

test("URL inválida ou com segredo não entra no GitHub", async () => {
  for (const url of [
    "https://admin.bslogisticas.com.br",
    "https://other-project-example.vercel.app",
    "https://bs-logistica-sistema-x.vercel.app?token=secret",
    "https://user:secret@bs-logistica-sistema-x.vercel.app",
    "http://bs-logistica-sistema-x.vercel.app",
  ]) {
    const { state, options } = fixture();
    state.statuses[0].environment_url = url;
    await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
});

test("main, branch padrão, staging, HML, forks e branch não autorizada não recebem escrita", async () => {
  for (const target of ["main", "staging", "hml", "production", "unlisted"]) {
    const { state, options } = fixture();
    state.pr.head.ref = target;
    if (target !== "unlisted") options.branchAllowlist.push(target);
    await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
  const { state, options } = fixture();
  state.pr.head.repo.full_name = "fork/bslogistica";
  await assert.rejects(() => engine.reconcilePreview(options));
  assert.equal(state.commits.length, 0);
});

test("evento atrasado não altera um HEAD mais novo", async () => {
  const { state, options } = fixture();
  state.pr.head.sha = "f".repeat(40);
  const result = await engine.reconcilePreview(options);
  assert.equal(result.status, "skipped");
  assert.equal(state.commits.length, 0);
});

test("CAS recusa avanço concorrente sem sobrescrever trabalho alheio", async () => {
  const { state, options } = fixture();
  state.race = true;
  await assert.rejects(() => engine.reconcilePreview(options), /concorrente/);
  assert.equal(state.commits.length, 0);
  assert.equal(state.stored.get("docs/HANDOFF.md"), handoff);
});

test("sem marcadores, com marcadores duplicados ou HANDOFF inválido não há substituição", async () => {
  for (const content of [
    handoff.replace("<!-- checkpoint-preview:start -->", ""),
    handoff + "<!-- checkpoint-preview:start -->\n<!-- checkpoint-preview:end -->",
    handoff.replace("## Autorizações", "## Outro título"),
  ]) {
    const { state, options } = fixture();
    state.stored.set("docs/HANDOFF.md", content);
    await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
});

test("adaptador pagina resultados e recusa coleções incompletas", async () => {
  const requests = [];
  const api = createGitHubApi({
    repository,
    token: "fixture-only",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({ jobs: url.endsWith("page=1") ? Array(100).fill({ id: 1 }) : [{ id: 2 }] }),
      );
    },
  });
  assert.equal((await api.list("actions/runs/99/jobs", "jobs")).length, 101);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((item) => item.options.redirect === "error"));
  await assert.rejects(() => api.list("actions/runs/99/jobs", "missing"));
});

test("escrita usa CAS GraphQL com apenas os dois arquivos permitidos e nenhuma deleção", async () => {
  let request;
  const api = createGitHubApi({
    repository,
    token: "fixture-only",
    allowWrites: true,
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return new Response(
        JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: sha } } } }),
      );
    },
  });
  await api.commit({
    branch,
    expectedHeadOid: sha,
    message: "docs(checkpoint): fixture",
    files: [
      { path: "docs/HANDOFF.md", content: "checkpoint" },
      { path: "docs/continuidade/previews/deployment-42.json", content: "{}" },
    ],
  });
  assert.equal(request.url, "https://api.github.com/graphql");
  assert.equal(request.body.variables.input.expectedHeadOid, sha);
  assert.equal(request.body.variables.input.fileChanges.additions.length, 2);
  assert.equal(request.body.variables.input.fileChanges.deletions, undefined);
});

test("perda de resposta ou erro GraphQL não é relatado como publicação aprovada", async () => {
  const api = createGitHubApi({
    repository,
    token: "fixture-only",
    allowWrites: true,
    fetchImpl: async () =>
      new Response(JSON.stringify({ errors: [{ message: "sensitive fixture" }] })),
  });
  await assert.rejects(
    () =>
      api.commit({
        branch,
        expectedHeadOid: sha,
        message: "fixture",
        files: [
          { path: "docs/HANDOFF.md", content: "checkpoint" },
          { path: "docs/continuidade/previews/deployment-42.json", content: "{}" },
        ],
      }),
    (error) => !error.message.includes("sensitive fixture"),
  );
});

test("CLI nega escrita local e funciona desligada sem token ou configuração privada", async () => {
  assert.deepEqual(await main(["--dry-run"], {}), {
    status: "skipped",
    reason: "Automação desligada.",
  });
  await assert.rejects(() => main(["--write"], {}));
});

test("projeto com prefixo semelhante ou de outro time não comprova o Preview pretendido", async () => {
  for (const url of [
    "https://bs-logistica-sistema-otherproject-abc-bslogisticas.vercel.app",
    "https://bs-logistica-sistema-abc-otherteam.vercel.app",
  ]) {
    const { state, options } = fixture();
    state.statuses[0].environment_url = url;
    await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
});

test("escritor privilegiado aceita somente workflow_run e sinal de deployment não executa candidato", () => {
  const writer = readFileSync(
    new URL("../.github/workflows/checkpoint-preview.yml", import.meta.url),
    "utf8",
  );
  assert.ok(!/^  deployment_status:/m.test(writer));
  assert.ok(writer.includes("workflow_run:"));
  const signal = readFileSync(
    new URL("../.github/workflows/checkpoint-preview-signal.yml", import.meta.url),
    "utf8",
  );
  assert.ok(/^  deployment_status:/m.test(signal));
  assert.ok(signal.includes("permissions: {}"));
  assert.ok(!signal.includes("checkout"));
  assert.ok(!signal.includes("contents: write"));
});

test("publicação AUTO-02 mantém controlador bloqueado e sem permissão de escrita", () => {
  const writer = readFileSync(
    new URL("../.github/workflows/checkpoint-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(writer, /if: >-\s+false &&/);
  assert.match(writer, /contents: read/);
  assert.ok(!writer.includes("contents: write"));
  assert.ok(writer.includes("atualizar-checkpoint-preview.mjs --dry-run"));
  assert.ok(!writer.includes("atualizar-checkpoint-preview.mjs --write"));
});

test("dois eventos simultâneos geram um único recibo, sem perder alteração concorrente", async () => {
  const { state, options } = fixture();
  await Promise.allSettled([engine.reconcilePreview(options), engine.reconcilePreview(options)]);
  assert.equal(state.commits.length, 1);
});

test("workflow_run do sinal posterior à CI publica somente após reconsultar Vercel e CI", async () => {
  const { state, options } = fixture();
  const originalGet = options.api.get;
  options.api.get = async (path) =>
    path === "actions/runs/77"
      ? {
          ...state.run,
          id: 77,
          event: "deployment_status",
          path: ".github/workflows/checkpoint-preview-signal.yml",
        }
      : originalGet(path);
  options.eventName = "workflow_run";
  options.event.workflow_run = { id: 77 };
  await engine.reconcilePreview(options);
  assert.equal(state.commits.length, 1);
  const receipt = JSON.parse(state.commits[0].files[1].content);
  assert.equal(receipt.ci.run_id, 99);
});

test("resposta perdida após commit é desconhecida e a repetição não cria outro commit", async () => {
  const { state, options } = fixture();
  const originalCommit = options.api.commit;
  options.api.commit = async (input) => {
    await originalCommit(input);
    throw new Error("Resposta perdida");
  };
  await assert.rejects(() => engine.reconcilePreview(options));
  await engine.reconcilePreview(options);
  assert.equal(state.commits.length, 1);
});

test("branch padrão descoberta dinamicamente é recusada mesmo na allowlist", async () => {
  const { state, options } = fixture();
  const originalGet = options.api.get;
  options.api.get = (path) =>
    path === "" ? { full_name: repository, default_branch: branch } : originalGet(path);
  await assert.rejects(() => engine.reconcilePreview(options));
  assert.equal(state.commits.length, 0);
});

test("recibo existente é preservado e divergência no histórico recusa sobrescrita", async () => {
  for (const existing of [
    { github_deployment_id: 42, commit: sha },
    { github_deployment_id: 42, commit: "f".repeat(40) },
  ]) {
    const { state, options } = fixture();
    state.stored.set("docs/continuidade/previews/deployment-42.json", JSON.stringify(existing));
    if (existing.commit === sha) await engine.reconcilePreview(options);
    else await assert.rejects(() => engine.reconcilePreview(options));
    assert.equal(state.commits.length, 0);
  }
});
