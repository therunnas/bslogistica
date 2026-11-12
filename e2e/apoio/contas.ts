import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  request,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { urlPermitida } from "../guarda/regras.mjs";
import { expect } from "./fixtures";

/**
 * Contas sintéticas LOCAIS do E2E (criadas pelo scripts/e2e-local.sh, todas @exemplo.test):
 * admin e operacional (login global), admin2 (MFA, recuperação com MFA, último admin), sem papel,
 * revogar (operacional que perde o acesso) e recupera (operacional para a recuperação sem MFA).
 */
export type Conta = "ADMIN" | "OPER" | "ADMIN2" | "SEMPAPEL" | "REVOGAR" | "RECUPERA";

export function ambiente(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`${nome} ausente: rode pelo scripts/e2e-local.sh`);
  return v;
}

export function emailDe(conta: Conta): string {
  return ambiente(`E2E_${conta}_EMAIL`);
}

/**
 * Estado que muda durante a execução (senha nova depois da recuperação, segredo TOTP cadastrado)
 * fica num arquivo da pasta temporária de sessões (fora dos artefatos), para sobreviver ao
 * reinício do worker depois de uma falha. Nunca é impresso.
 */
function arquivoDeEstado(): string {
  return join(ambiente("E2E_ESTADO_DIR"), "cp01.json");
}

function lerEstado(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(arquivoDeEstado(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function lembrar(chave: string, valor: string) {
  writeFileSync(arquivoDeEstado(), JSON.stringify({ ...lerEstado(), [chave]: valor }), {
    mode: 0o600,
  });
}

export function lembrado(chave: string): string {
  const v = lerEstado()[chave];
  if (!v) throw new Error(`estado "${chave}" ausente: um passo anterior não rodou`);
  return v;
}

export function senhaDe(conta: Conta): string {
  return lerEstado()[`senha:${conta}`] ?? ambiente(`E2E_${conta}_SENHA`);
}

export function trocarSenha(conta: Conta, nova: string) {
  lembrar(`senha:${conta}`, nova);
}

export function senhaNova(): string {
  return `Nova-${crypto.randomUUID()}`;
}

/** Contexto novo, sem sessão, com a mesma trava de rede da fixture (só loopback). */
export async function contextoLimpo(browser: Browser, estado?: string): Promise<BrowserContext> {
  const contexto = await browser.newContext(estado ? { storageState: estado } : {});
  await contexto.route("**/*", (rota) =>
    urlPermitida(rota.request().url()) ? rota.continue() : rota.abort("blockedbyclient"),
  );
  return contexto;
}

/**
 * Requisição direta (API Route, Server Action) com a sessão de um contexto do navegador.
 *
 * O `APIRequestContext` do próprio contexto não envia cookie `Secure` por http (o navegador envia
 * em loopback, que é contexto seguro) e substitui o cabeçalho `Cookie` informado; os cookies do
 * Supabase saem `Secure` no build de produção. Por isso a chamada usa um cliente HTTP avulso, sem
 * pote de cookies, com o cabeçalho montado a partir dos cookies do contexto (só os de 127.0.0.1).
 */
export async function requisitarComo(
  contexto: BrowserContext,
  metodo: "GET" | "POST",
  url: string,
  opcoes: { headers?: Record<string, string>; data?: string | object } = {},
): Promise<APIResponse> {
  // Sem URL: `cookies(url)` também descarta os `Secure` quando a URL é http.
  const cookies = (await contexto.cookies()).filter((c) => c.domain === "127.0.0.1");
  const cliente = await request.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    const headers = {
      ...(opcoes.headers ?? {}),
      ...(cookies.length ? { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } : {}),
    };
    const resposta =
      metodo === "GET"
        ? await cliente.get(url, { headers, maxRedirects: 0 })
        : await cliente.post(url, { headers, data: opcoes.data ?? {}, maxRedirects: 0 });
    // Corpo lido antes de descartar o cliente.
    const corpo = await resposta.body();
    return Object.assign(resposta, {
      body: async () => corpo,
      text: async () => corpo.toString("utf8"),
    });
  } finally {
    await cliente.dispose().catch(() => {});
  }
}

/** Preenche e envia o login pela tela (não espera o resultado). */
export async function enviarLogin(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#senha").fill(senha);
  await page.locator("button[type=submit]").click();
}

/** Login pela tela que precisa dar certo; devolve a página já fora de /login. */
export async function entrar(browser: Browser, conta: Conta): Promise<Page> {
  const contexto = await contextoLimpo(browser);
  const page = await contexto.newPage();
  await enviarLogin(page, emailDe(conta), senhaDe(conta));
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  return page;
}

/** Texto do aviso (toast) mais recente. */
export async function textoDoAviso(page: Page): Promise<string> {
  const aviso = page.locator("[data-sonner-toast]").first();
  await expect(aviso).toBeVisible({ timeout: 30_000 });
  return (await aviso.innerText()).trim();
}

/** Mensagens cruas do SDK/GoTrue que nunca podem chegar ao usuário (sempre em inglês). */
export const MENSAGEM_CRUA =
  /invalid|credentials|banned|already|registered|factor|code entered|expired|not found|error|failed|unable|user /i;

export function clienteApi(): SupabaseClient {
  const url = ambiente("NEXT_PUBLIC_SUPABASE_URL");
  expect(url).toBe("http://127.0.0.1:54321");
  return createClient(url, ambiente("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Sessão supabase-js (chave publicável) da conta, por e-mail e senha: AAL1. */
export async function sessaoApi(conta: Conta): Promise<SupabaseClient> {
  const cliente = clienteApi();
  const { error } = await cliente.auth.signInWithPassword({
    email: emailDe(conta),
    password: senhaDe(conta),
  });
  expect(error, `login pela API local (${conta})`).toBeNull();
  return cliente;
}
