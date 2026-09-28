/**
 * Hook de resolução só para `npm run test:admin-usuarios`.
 *
 * POR QUE ISTO EXISTE
 *
 * `node --experimental-strip-types` remove a sintaxe de tipos, mas não resolve
 * import relativo sem extensão para um arquivo `.ts` — ele só "funciona" hoje,
 * nas outras suítes deste projeto, porque todo import cruzado entre arquivos
 * `.ts` do repositório é `import type` (apagado antes de qualquer resolução
 * acontecer). `src/lib/admin-usuarios/` é o primeiro conjunto de módulos que
 * compartilha VALOR (classes de erro, o cliente injetado) entre arquivos, e
 * `import { X } from "./y"` sem extensão não resolve nesta versão do Node —
 * medido diretamente, não suposto: `node --experimental-strip-types` sozinho
 * falha com `ERR_MODULE_NOT_FOUND` mesmo num repro de dois arquivos, fora
 * deste projeto.
 *
 * Reescrever os imports do código-fonte com `.ts` explícito não é opção: o
 * `tsconfig.json` do projeto usa `moduleResolution: "Bundler"` sem
 * `allowImportingTsExtensions`, e ligar essa flag é mudança de configuração
 * compartilhada, fora do escopo desta suíte. Este hook fica só aqui.
 *
 * O QUE ELE FAZ, E SÓ ISSO
 *
 * Tenta a resolução normal primeiro. Se falhar E o especificador for relativo
 * e sem extensão, tenta de novo com `.ts`. Qualquer outra falha sobe como
 * sempre — nada aqui esconde um import realmente quebrado.
 */

import { register } from "node:module";

register(import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (erro) {
    const semExtensao = /^\.\.?\//.test(specifier) && !/\.[a-zA-Z0-9]+$/.test(specifier);
    if (erro?.code === "ERR_MODULE_NOT_FOUND" && semExtensao) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw erro;
  }
}
