import { validarHandoff } from "./validar-workflow-documental.mjs";

export const PREVIEW_START = "<!-- checkpoint-preview:start -->";
export const PREVIEW_END = "<!-- checkpoint-preview:end -->";
const SHA = /^[0-9a-f]{40}$/;
const vercelBot = (actor) => actor?.login === "vercel[bot]" && actor?.type === "Bot";

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

function documentationPath(path) {
  return (
    /^(?:AGENTS|CLAUDE|PROGRESS|README)\.md$/.test(path) ||
    /^docs\/.+\.md$/.test(path) ||
    /^docs\/continuidade\/previews\/deployment-[1-9][0-9]*\.json$/.test(path)
  );
}

export function isDocumentationOnly(files) {
  return (
    files.length > 0 &&
    files.every(
      (file) =>
        documentationPath(file.filename) &&
        (!file.previous_filename || documentationPath(file.previous_filename)),
    )
  );
}

function validateBranch(branch, defaultBranch, allowlist) {
  requireEvidence(
    typeof branch === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(branch) &&
      !branch.includes("..") &&
      !branch.includes("//") &&
      !branch.endsWith("/") &&
      branch !== defaultBranch &&
      !/^(?:main|master|production|prod|staging|hml)(?:\/|$)/i.test(branch) &&
      allowlist.includes(branch),
    "Branch ausente, protegida ou fora da autorização explícita.",
  );
}

function previewUrl(value, project, team) {
  requireEvidence(/^[a-z0-9][a-z0-9-]+$/.test(project ?? ""), "Projeto Preview não configurado.");
  requireEvidence(/^[a-z0-9][a-z0-9-]+$/.test(team ?? ""), "Time Preview não configurado.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL do Preview ausente ou inválida.");
  }
  requireEvidence(
    url.protocol === "https:" &&
      new RegExp(`^${project}-[a-z0-9]+-${team}\\.vercel\\.app$`).test(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === "/",
    "URL do Preview não permitida ou contém informação adicional.",
  );
  return url.origin;
}

function renderHandoff(markdown, receipt, receiptPath) {
  requireEvidence(
    typeof markdown === "string" && validarHandoff(markdown).length === 0,
    "HANDOFF ausente ou inválido; nenhuma substituição permitida.",
  );
  requireEvidence(
    markdown.split(PREVIEW_START).length === 2 &&
      markdown.split(PREVIEW_END).length === 2 &&
      markdown.indexOf(PREVIEW_START) < markdown.indexOf(PREVIEW_END),
    "Marcadores técnicos do HANDOFF ausentes, duplicados ou invertidos.",
  );
  const technical = [
    PREVIEW_START,
    "### Última evidência automática de Preview",
    "",
    `- PR [#${receipt.pr}](https://github.com/${receipt.repository}/pull/${receipt.pr}), branch \`${receipt.branch}\`.`,
    `- Commit implantado: \`${receipt.commit}\`. Evidência restrita a esse SHA.`,
    `- Deployment GitHub \`${receipt.github_deployment_id}\`: **success**, ambiente **Preview**, ${receipt.deployed_at}.`,
    `- URL: [Preview](${receipt.preview_url}).`,
    `- CI: [run ${receipt.ci.run_id}](https://github.com/${receipt.repository}/actions/runs/${receipt.ci.run_id}), tentativa ${receipt.ci.run_attempt}; validar e sql-local **success** no mesmo SHA.`,
    `- [Recibo técnico e limitações](${receiptPath.replace(/^docs\//, "")}).`,
    "- Homologação funcional, telas autenticadas e destino efetivo do banco: **não verificados pela automação**.",
    "- Nenhuma migration, alteração em HML/Production ou autorização comercial decorre deste registro.",
    PREVIEW_END,
  ].join("\n");
  const start = markdown.indexOf(PREVIEW_START);
  const end = markdown.indexOf(PREVIEW_END) + PREVIEW_END.length;
  return markdown.slice(0, start) + technical + markdown.slice(end);
}

function validRun(run, sha, repository) {
  return (
    SHA.test(sha ?? "") &&
    run?.head_sha === sha &&
    run.head_repository?.full_name === repository &&
    run.event === "pull_request" &&
    run.path === ".github/workflows/ci.yml" &&
    run.status === "completed" &&
    run.conclusion === "success" &&
    Number.isSafeInteger(run.id) &&
    Number.isSafeInteger(run.run_attempt) &&
    run.run_attempt > 0
  );
}

export async function reconcilePreview({
  api,
  repository,
  enabled = false,
  branchAllowlist = [],
  previewProject,
  previewTeam,
  eventName,
  event,
  publish = false,
}) {
  if (!enabled) return { status: "skipped", reason: "Automação desligada." };
  requireEvidence(
    repository === "therunnas/bslogistica" && event.repository?.full_name === repository,
    "Repositório do evento não autorizado.",
  );
  const repo = await api.get("");
  requireEvidence(
    repo.full_name === repository && typeof repo.default_branch === "string" && repo.default_branch,
    "Identificação da branch padrão indisponível.",
  );
  let deploymentId;
  if (eventName === "deployment_status") {
    deploymentId = event.deployment?.id;
  } else if (eventName === "workflow_run") {
    const id = event.workflow_run?.id;
    requireEvidence(Number.isSafeInteger(id) && id > 0, "Execução de origem inválida.");
    const run = await api.get(`actions/runs/${id}`);
    const signal =
      SHA.test(run.head_sha ?? "") &&
      run.head_repository?.full_name === repository &&
      run.event === "deployment_status" &&
      run.path === ".github/workflows/checkpoint-preview-signal.yml" &&
      run.status === "completed" &&
      run.conclusion === "success";
    requireEvidence(
      validRun(run, run.head_sha, repository) || signal,
      "Execução de origem não é CI ou sinal de Preview comprovado.",
    );
    const deployments = await api.list(`deployments?sha=${run.head_sha}`);
    const candidate = deployments
      .filter((item) => item.environment === "Preview" && item.sha === run.head_sha)
      .sort((a, b) => b.id - a.id)[0];
    deploymentId = candidate?.id;
  } else {
    throw new Error("Evento não autorizado; somente deployment_status e workflow_run.");
  }
  requireEvidence(
    Number.isSafeInteger(deploymentId) && deploymentId > 0,
    "Sem deployment verificável para o evento.",
  );
  const deployment = await api.get(`deployments/${deploymentId}`);
  requireEvidence(
    deployment.id === deploymentId &&
      SHA.test(deployment.sha ?? "") &&
      deployment.environment === "Preview" &&
      deployment.production_environment === false &&
      vercelBot(deployment.creator),
    "Deployment não é um Preview da integração Vercel comprovado.",
  );
  const sha = deployment.sha;
  const statuses = await api.list(`deployments/${deploymentId}/statuses`);
  const status = statuses[0]; // A API retorna o mais recente primeiro; não ressuscitar sucesso antigo.
  requireEvidence(
    status?.state === "success" &&
      status.environment === "Preview" &&
      vercelBot(status.creator) &&
      /^\d{4}-\d{2}-\d{2}T/.test(status.created_at ?? "") &&
      Number.isFinite(Date.parse(status.created_at)),
    "Status mais recente do Preview não comprova sucesso.",
  );
  const url = previewUrl(status.environment_url, previewProject, previewTeam);
  const commit = await api.get(`commits/${sha}`);
  requireEvidence(commit.sha === sha && commit.parents?.length > 0, "Commit não verificável.");
  const files = await api.list(`commits/${sha}`, "files");
  requireEvidence(
    files.length > 0,
    "Diff ausente: não é possível distinguir código e documentação.",
  );
  if (isDocumentationOnly(files)) {
    return { status: "skipped", reason: "Commit exclusivamente documental; prevenção de loop." };
  }
  const prs = (await api.list(`commits/${sha}/pulls`)).filter((pr) => pr.state === "open");
  requireEvidence(prs.length === 1, "PR ausente ou ambíguo para o commit.");
  const pr = await api.get(`pulls/${prs[0].number}`);
  requireEvidence(pr.head?.repo?.full_name === repository, "Fork não pode receber escrita.");
  const branch = pr.head.ref;
  validateBranch(branch, repo.default_branch, branchAllowlist);
  if (pr.head.sha !== sha) return { status: "skipped", reason: "Evento de HEAD já substituído." };
  const runs = await api.list(
    `actions/workflows/ci.yml/runs?head_sha=${sha}&event=pull_request`,
    "workflow_runs",
  );
  const run = runs.sort((a, b) => b.id - a.id)[0];
  requireEvidence(validRun(run, sha, repository), "CI mais recente não comprova sucesso no SHA.");
  const jobs = await api.list(`actions/runs/${run.id}/jobs`, "jobs");
  for (const name of ["validar", "sql-local"]) {
    const matches = jobs.filter((job) => job.name === name);
    requireEvidence(
      matches.length === 1 &&
        matches[0].status === "completed" &&
        matches[0].conclusion === "success",
      "Jobs obrigatórios da CI ausentes ou sem sucesso.",
    );
  }
  const receiptPath = `docs/continuidade/previews/deployment-${deploymentId}.json`;
  const existing = await api.getFile(receiptPath, sha);
  if (existing !== null) {
    const receipt = JSON.parse(existing);
    requireEvidence(
      receipt.github_deployment_id === deploymentId && receipt.commit === sha,
      "Recibo existente divergente; histórico preservado sem sobrescrita.",
    );
    return { status: "skipped", reason: "Deployment já registrado." };
  }
  const receipt = {
    schema_version: 1,
    repository,
    pr: pr.number,
    branch,
    commit: sha,
    github_deployment_id: deploymentId,
    vercel_deployment_id: null,
    preview_url: url,
    environment: "Preview",
    deployment_status: "success",
    deployed_at: status.created_at,
    ci: { run_id: run.id, run_attempt: run.run_attempt, status: "success" },
    functional_homologation: "not_verified",
    limitations: [
      "Somente evidência técnica de CI e deployment no SHA indicado.",
      "Telas autenticadas e destino efetivo do Supabase não inspecionados.",
      "Nenhuma migration, ativação comercial ou homologação inferida.",
      "ID interno da Vercel não fornecido pela API de deployments do GitHub.",
    ],
  };
  const markdown = renderHandoff(await api.getFile("docs/HANDOFF.md", sha), receipt, receiptPath);
  const ref = await api.get(`git/ref/heads/${encodeURIComponent(branch)}`);
  const currentPr = await api.get(`pulls/${pr.number}`);
  requireEvidence(
    ref.object?.sha === sha &&
      currentPr.state === "open" &&
      currentPr.head?.sha === sha &&
      currentPr.head.ref === branch &&
      currentPr.head.repo?.full_name === repository,
    "HEAD ou PR mudou durante a coleta; retomar sem sobrescrever.",
  );
  if (!publish) return { status: "dry-run", receipt };
  const result = await api.commit({
    branch,
    expectedHeadOid: sha,
    message: `docs(checkpoint): record Preview deployment ${deploymentId}`,
    files: [
      { path: "docs/HANDOFF.md", content: markdown },
      { path: receiptPath, content: JSON.stringify(receipt, null, 2) + "\n" },
    ],
  });
  return { status: "published", commit: result.oid, deployment: deploymentId };
}
