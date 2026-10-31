/**
 * Resolvedor só para `scripts/testar-compatibilidade-deploy.mjs`: além do `.ts` sem extensão de
 * `_resolver-ts.mjs`, resolve o alias `@/` (src/) que o código do app usa. Não muda o tsconfig.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (!globalThis.__resolverCompatRegistrado) {
  globalThis.__resolverCompatRegistrado = true;
  register(import.meta.url);
}

const SRC = pathToFileURL(`${process.cwd()}/src/`).href;

export async function resolve(specifier, context, nextResolve) {
  const alvo = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
  try {
    return await nextResolve(alvo, context);
  } catch (erro) {
    const relativo = /^(\.\.?\/|file:)/.test(alvo) && !/\.[a-zA-Z0-9]+$/.test(alvo);
    if (erro?.code === "ERR_MODULE_NOT_FOUND" && relativo) {
      try {
        return await nextResolve(`${alvo}.ts`, context);
      } catch {
        return nextResolve(`${alvo}/index.ts`, context);
      }
    }
    throw erro;
  }
}
