import { chromium, type FullConfig } from "@playwright/test";

import { urlPermitida } from "../guarda/regras.mjs";
import { estadoDe } from "./fixtures";

/**
 * Login REAL pela tela, uma vez por papel, com os usuários sintéticos do Auth local criados pelo
 * scripts/e2e-local.sh. A sessão fica num diretório temporário fora dos artefatos.
 */
async function entrar(papel: "admin" | "operacional", email: string, senha: string) {
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ baseURL: "http://127.0.0.1:3000" });
  await contexto.route("**/*", (rota) =>
    urlPermitida(rota.request().url()) ? rota.continue() : rota.abort("blockedbyclient"),
  );
  const page = await contexto.newPage();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#senha").fill(senha);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await contexto.storageState({ path: estadoDe(papel) });
  await navegador.close();
}

export default async function loginGlobal(_config: FullConfig) {
  const exigir = (nome: string) => {
    const v = process.env[nome];
    if (!v) throw new Error(`${nome} ausente: rode pelo scripts/e2e-local.sh`);
    return v;
  };
  await entrar("admin", exigir("E2E_ADMIN_EMAIL"), exigir("E2E_ADMIN_SENHA"));
  await entrar("operacional", exigir("E2E_OPER_EMAIL"), exigir("E2E_OPER_SENHA"));
}
