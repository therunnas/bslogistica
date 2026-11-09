import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createGitHubApi } from "./checkpoint-github-api.mjs";
import { reconcilePreview } from "./checkpoint-preview.mjs";

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.some((arg) => !["--write", "--dry-run"].includes(arg)) || args.length !== 1) {
    throw new Error("Escolha exatamente --dry-run ou --write.");
  }
  const publish = args[0] === "--write";
  if (publish && env.GITHUB_ACTIONS !== "true") {
    throw new Error("Escrita automática disponível somente no workflow autorizado.");
  }
  if (env.CHECKPOINT_AUTO_ENABLED !== "true") {
    return { status: "skipped", reason: "Automação desligada." };
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  return reconcilePreview({
    api: createGitHubApi({
      repository: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
      allowWrites: publish,
    }),
    repository: env.GITHUB_REPOSITORY,
    enabled: true,
    branchAllowlist: (env.CHECKPOINT_PREVIEW_BRANCHES ?? "").split(/\r?\n/).filter(Boolean),
    previewProject: env.CHECKPOINT_PREVIEW_PROJECT,
    previewTeam: env.CHECKPOINT_PREVIEW_TEAM,
    eventName: env.GITHUB_EVENT_NAME,
    event,
    publish,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main()
    .then((result) => console.log(`Checkpoint: ${result.status}. ${result.reason ?? ""}`))
    .catch(() => {
      // O corpo do evento, respostas da API e credenciais nunca chegam ao log.
      console.error(
        "Checkpoint recusado: evidência insuficiente, conflito ou acesso indisponível.",
      );
      process.exitCode = 1;
    });
}
