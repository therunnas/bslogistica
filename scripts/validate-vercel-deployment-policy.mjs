import { readFileSync } from "node:fs";

function validatePolicy(source) {
  const config = JSON.parse(source);
  if (config?.framework !== "nextjs") throw new Error("framework");

  // JSON.parse aceita chaves duplicadas; recusar ambiguidades antes de validar a política.
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}[\],:]/g) ?? [];
  const scopes = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "{") scopes.push(new Set());
    else if (token === "[") scopes.push(null);
    else if (token === "}" || token === "]") scopes.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const key = JSON.parse(token);
      const keys = scopes.at(-1);
      if (keys.has(key)) throw new Error("duplicate key");
      keys.add(key);
    }
  }

  const policy = config.git?.deploymentEnabled;
  if (
    policy === null ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    Object.keys(policy).length !== 1 ||
    policy.main !== false
  ) {
    throw new Error("deployment policy");
  }
}

try {
  validatePolicy(readFileSync(process.argv[2] ?? "vercel.json", "utf8"));
  console.log("PASS: Next.js preservado; main:false exclusivo; Previews habilitados por padrão.");
} catch {
  // Não imprimir o JSON, conteúdo de arquivo, erro de parsing ou stack trace.
  console.error(
    "FAIL: arquivo Vercel ilegível/inválido ou política diferente de Next.js e main:false exclusivo.",
  );
  process.exitCode = 1;
}
