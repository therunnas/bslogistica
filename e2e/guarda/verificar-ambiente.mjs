/**
 * Para o E2E antes de qualquer escrita se o ambiente não for o Supabase local descartável.
 * Uso: node e2e/guarda/verificar-ambiente.mjs   (código 0 = seguro; 1 = interrompe)
 */
import { existsSync, readFileSync } from "node:fs";

import { problemasDoAmbiente, projetoDoConfig } from "./regras.mjs";

const projetoId = projetoDoConfig(readFileSync("supabase/config.toml", "utf8"));
const problemas = problemasDoAmbiente({
  env: process.env,
  projetoId,
  vinculoRemoto: existsSync("supabase/.temp/project-ref"),
});

if (problemas.length > 0) {
  console.error("E2E INTERROMPIDO: o ambiente não é o Supabase local isolado.");
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log(`E2E: ambiente isolado conferido (projeto local ${projetoId}).`);
