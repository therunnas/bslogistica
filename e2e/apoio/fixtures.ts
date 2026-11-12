import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { test as base, expect, type Page } from "@playwright/test";

import { urlPermitida } from "../guarda/regras.mjs";

/** Estado de sessão salvo pelo login global (fora de e2e-results: nunca vira artefato). */
export function estadoDe(papel: "admin" | "operacional"): string {
  const dir = process.env["E2E_ESTADO_DIR"];
  if (!dir) throw new Error("E2E_ESTADO_DIR ausente: rode pelo scripts/e2e-local.sh");
  return join(dir, `${papel}.json`);
}

/**
 * Consulta SOMENTE LEITURA ao Postgres do Supabase local (container conferido pelo script).
 * A transação é forçada como read only pelo próprio Postgres; uma escrita aqui falha.
 * Devolve as linhas como objetos (JSON agregado pelo banco).
 */
export function consultar<T = Record<string, unknown>>(sql: string): T[] {
  const saida = psqlSomenteLeitura(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`);
  return JSON.parse(saida.trim()) as T[];
}

/** Executa um comando SQL no Postgres local com a sessão forçada em somente leitura. */
export function psqlSomenteLeitura(comando: string): string {
  const container = process.env["E2E_DB_CONTAINER"];
  if (!container || !container.startsWith("supabase_db_bs-e2e-")) {
    throw new Error("E2E_DB_CONTAINER ausente ou fora do projeto local bs-e2e-");
  }
  return execFileSync(
    "docker",
    [
      "exec",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      comando,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Um único valor da primeira linha. */
export function valor(sql: string): unknown {
  const linha = consultar(sql)[0];
  return linha ? Object.values(linha)[0] : undefined;
}

type Extras = { bloqueadas: string[] };

/**
 * `test` com a trava de rede do navegador: qualquer requisição fora do loopback é abortada e
 * registrada; o teste falha se houver alguma.
 */
export const test = base.extend<Extras>({
  bloqueadas: [
    async ({ context }, fornecer) => {
      const bloqueadas: string[] = [];
      await context.route("**/*", async (rota) => {
        const url = rota.request().url();
        if (urlPermitida(url)) return rota.continue();
        bloqueadas.push(url);
        return rota.abort("blockedbyclient");
      });
      await fornecer(bloqueadas);
      expect(bloqueadas, "requisições do navegador fora do loopback").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Página sem erro de aplicação (fronteira de erro do Next ou tela de falha genérica). */
export async function semErroDeAplicacao(page: Page) {
  await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Algo deu errado", { exact: false })).toHaveCount(0);
}
