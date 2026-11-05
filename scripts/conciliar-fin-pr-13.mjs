/**
 * Uso:
 * node --experimental-strip-types --import ./scripts/_resolver-ts.mjs \
 *   scripts/conciliar-fin-pr-13.mjs base.json fechamento.json containers.json
 *
 * `containers.json` é um array dos IDs de `billing_additionals` vinculados a Containers.
 * O processo só lê arquivos locais, imprime o relatório JSON e não acessa banco ou rede.
 */

import { readFile } from "node:fs/promises";

import {
  conciliarBaseComercial,
  validarBaseComercial,
} from "../src/lib/fechamento/conciliacao-comercial.ts";

const [basePath, fechamentoPath, containersPath] = process.argv.slice(2);
if (!basePath || !fechamentoPath || !containersPath) {
  console.error("Informe base.json, fechamento.json e containers.json.");
  process.exit(2);
}

try {
  const [baseBruta, fechamentoBruto, containersBrutos] = await Promise.all([
    readFile(basePath, "utf8"),
    readFile(fechamentoPath, "utf8"),
    readFile(containersPath, "utf8"),
  ]);
  const containers = JSON.parse(containersBrutos);
  if (!Array.isArray(containers) || containers.some((id) => typeof id !== "string")) {
    throw new Error("containers.json deve conter um array de IDs em texto.");
  }
  const resultado = conciliarBaseComercial(
    validarBaseComercial(JSON.parse(baseBruta)),
    JSON.parse(fechamentoBruto),
    containers,
  );
  console.log(JSON.stringify(resultado, null, 2));
  process.exitCode = resultado.confere ? 0 : 1;
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exitCode = 2;
}
