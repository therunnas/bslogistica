import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  ambiente,
  clienteApi,
  contextoLimpo,
  requisitarComo,
  emailDe,
  entrar,
  lembrado,
  lembrar,
  sessaoApi,
} from "../apoio/contas";
import { estadoDe, expect, test } from "../apoio/fixtures";
import { dialogo } from "../apoio/telas";

/**
 * CP-01 — Matriz de autorização: ADMIN × OPERACIONAL × SEM PAPEL × NÃO AUTENTICADO × REVOGADO,
 * conferida em cada camada — tela (URL direta), API Route, Server Action reenviada com os cookies
 * de outro papel, tabela direta pelo PostgREST e RPC do operador. Esconder botão não é controle:
 * cada linha aqui chama o servidor sem passar pela interface.
 *
 * Em ordem, não serial. O primeiro caso revoga a conta "revogar" (operacional) pela tela, guardando
 * antes os cookies e uma sessão de API dela; o último a reativa, para não deixar estado novo.
 */

type Persona = "ADMIN" | "OPERACIONAL" | "SEM PAPEL" | "ANÔNIMO" | "REVOGADO";
const PERSONAS: Persona[] = ["ADMIN", "OPERACIONAL", "SEM PAPEL", "ANÔNIMO", "REVOGADO"];

const ROTAS_ADMIN = [
  "/clientes",
  "/operacoes",
  "/colaboradores",
  "/apontamentos",
  "/faturamento",
  "/fechamento",
  "/relatorios",
  "/usuarios",
];

async function contextoDe(browser: Browser, p: Persona): Promise<BrowserContext> {
  switch (p) {
    case "ADMIN":
      return contextoLimpo(browser, estadoDe("admin"));
    case "OPERACIONAL":
      return contextoLimpo(browser, estadoDe("operacional"));
    case "SEM PAPEL": {
      const page = await entrar(browser, "SEMPAPEL");
      return page.context();
    }
    case "ANÔNIMO":
      return contextoLimpo(browser);
    case "REVOGADO":
      return contextoLimpo(browser, lembrado("estado:revogado"));
  }
}

async function abrirGerenciar(page: Page, email: string) {
  await page.goto("/usuarios");
  const linha = page.locator("tr").filter({ hasText: email });
  await expect(linha).toBeVisible({ timeout: 20_000 });
  await linha.getByRole("button").last().click();
  return dialogo(page);
}

test("P0 preparação: cookies e sessão de API da conta 'revogar'; revogação pela tela", async ({
  browser,
}) => {
  const page = await entrar(browser, "REVOGAR");
  await expect(page).toHaveURL(/\/operacional/);
  const arquivo = `${process.env["E2E_ESTADO_DIR"]}/revogado.json`;
  await page.context().storageState({ path: arquivo });
  lembrar("estado:revogado", arquivo);
  const api = await sessaoApi("REVOGAR");
  const { data } = await api.auth.getSession();
  lembrar("token:revogado", data.session!.access_token);
  await page.context().close();

  const admin = await contextoLimpo(browser, estadoDe("admin"));
  const ap = await admin.newPage();
  const d = await abrirGerenciar(ap, emailDe("REVOGAR"));
  await d.getByRole("button", { name: "Revogar acesso" }).click();
  await ap.getByRole("alertdialog").getByRole("button", { name: "Revogar acesso" }).click();
  await expect(ap.getByText("Acesso revogado.").first()).toBeVisible();
  await admin.close();
});

for (const persona of PERSONAS) {
  test(`P1 tela por URL direta — ${persona}`, async ({ browser }) => {
    const ctx = await contextoDe(browser, persona);
    const page = await ctx.newPage();

    for (const rota of [...ROTAS_ADMIN, "/dashboard", "/configuracoes", "/operacional"]) {
      await page.goto(rota);
      const url = new URL(page.url()).pathname;
      const restritoAdmin = page.getByText("Área administrativa restrita");
      const restritoOper = page.getByText("Área operacional restrita");
      const naoLiberado = page.getByText("Acesso não liberado");

      if (persona === "ANÔNIMO" || persona === "REVOGADO") {
        // Revogado: a conta está banida e a sessão deixou de valer no Auth.
        expect(url, `${persona} em ${rota}`).toBe("/login");
        continue;
      }
      if (persona === "SEM PAPEL") {
        await expect(naoLiberado, `${persona} em ${rota}`).toBeVisible();
        continue;
      }
      if (persona === "ADMIN") {
        expect(url, rota).not.toBe("/login");
        await expect(naoLiberado).toHaveCount(0);
        if (rota === "/operacional") await expect(restritoOper).toBeVisible();
        else await expect(restritoAdmin, rota).toHaveCount(0);
        continue;
      }
      // OPERACIONAL
      if (rota === "/dashboard") {
        expect(url).toBe("/operacional");
      } else if (rota === "/operacional" || rota === "/configuracoes") {
        expect(url).toBe(rota);
        await expect(restritoAdmin).toHaveCount(0);
        await expect(restritoOper).toHaveCount(0);
      } else {
        await expect(restritoAdmin, `${persona} em ${rota}`).toBeVisible();
      }
    }
    await ctx.close();
  });
}

async function statusDe(ctx: BrowserContext, metodo: "GET" | "POST", url: string) {
  return (await requisitarComo(ctx, metodo, url)).status();
}

for (const persona of PERSONAS) {
  test(`P2 API Routes — ${persona}`, async ({ browser }) => {
    const ctx = await contextoDe(browser, persona);
    const req = ctx;
    const esperado = (admin: (s: number) => void) => {
      return (s: number, rota: string) => {
        if (persona === "ADMIN") return admin(s);
        if (persona === "ANÔNIMO" || persona === "REVOGADO")
          return expect(s, `${persona} ${rota}`).toBe(401);
        return expect(s, `${persona} ${rota}`).toBe(403);
      };
    };
    const naoBarrado = esperado((s) => expect([401, 403]).not.toContain(s));

    naoBarrado(
      await statusDe(req, "GET", "/api/fechamento?inicio=2026-10-01&fim=2026-10-15"),
      "GET fechamento",
    );
    naoBarrado(await statusDe(req, "POST", "/api/fechamento/xlsx"), "POST xlsx");
    naoBarrado(await statusDe(req, "POST", "/api/fechamento/xlsx-cliente"), "POST xlsx-cliente");
    // UF inválida: o admin recebe 400 antes de qualquer chamada ao IBGE (nenhuma rede externa).
    naoBarrado(await statusDe(req, "GET", "/api/calendario/municipios?uf=XX"), "GET municipios");
    await ctx.close();
  });
}

test("P3 Server Action reenviada: listar usuários só responde ao admin", async ({ browser }) => {
  // Captura a chamada real que a tela do admin faz (id da action e corpo).
  const admin = await contextoLimpo(browser, estadoDe("admin"));
  const ap = await admin.newPage();
  const capturas: Array<{ id: string; corpo: string }> = [];
  ap.on("request", (r) => {
    const id = r.headers()["next-action"];
    if (id && r.method() === "POST") capturas.push({ id, corpo: r.postData() ?? "[]" });
  });
  await ap.goto("/usuarios");
  await expect(ap.locator("tr").filter({ hasText: emailDe("ADMIN2") })).toBeVisible();

  let alvo: { id: string; corpo: string } | null = null;
  for (const c of capturas) {
    const r = await requisitarComo(admin, "POST", "/usuarios", {
      headers: {
        "Next-Action": c.id,
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      data: c.corpo,
    });
    if ((await r.text()).includes(emailDe("ADMIN2"))) {
      alvo = c;
      break;
    }
  }
  expect(
    alvo,
    "action de listagem de usuários capturada (controle positivo do admin)",
  ).not.toBeNull();
  await admin.close();

  for (const persona of PERSONAS.filter((p) => p !== "ADMIN")) {
    const ctx = await contextoDe(browser, persona);
    const r = await requisitarComo(ctx, "POST", "/usuarios", {
      headers: {
        "Next-Action": alvo!.id,
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      data: alvo!.corpo,
    });
    const corpo = await r.text();
    expect(corpo, `${persona} não recebe a lista de usuários`).not.toContain(emailDe("ADMIN2"));
    expect(corpo, `${persona} não recebe a lista de usuários`).not.toContain(emailDe("SEMPAPEL"));
    await ctx.close();
  }
});

test("P4 PostgREST direto e RPC do operador, por papel", async () => {
  const admin = await sessaoApi("ADMIN");
  const oper = await sessaoApi("OPER");
  const semPapel = await sessaoApi("SEMPAPEL");
  const anonimo = clienteApi();
  // JWT emitido ANTES da revogação, ainda dentro da validade (1 h).
  const revogado = createClient(
    ambiente("NEXT_PUBLIC_SUPABASE_URL"),
    ambiente("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${lembrado("token:revogado")}` } },
    },
  );

  const clientes = async (c: SupabaseClient) =>
    (await c.from("clients").select("id").limit(3)).data ?? [];
  const papeis = async (c: SupabaseClient) =>
    (await c.from("user_roles").select("role")).data ?? [];
  const rpc = async (c: SupabaseClient) => (await c.rpc("listar_operacoes_do_operador")).error;

  expect((await clientes(admin)).length, "admin lê tabela de negócio").toBeGreaterThan(0);
  expect(await clientes(oper), "operacional: zero linha na tabela direta").toEqual([]);
  expect(await clientes(semPapel), "sem papel: zero linha").toEqual([]);
  expect(await clientes(anonimo), "anônimo: zero linha").toEqual([]);

  expect(await papeis(semPapel), "sem papel não tem papel").toEqual([]);
  expect(await rpc(oper), "operacional usa a RPC").toBeNull();
  expect(await rpc(admin), "admin não usa a RPC do operador").not.toBeNull();
  expect(await rpc(semPapel), "sem papel não usa a RPC").not.toBeNull();
  expect(await rpc(anonimo), "anônimo não usa a RPC").not.toBeNull();

  expect(await clientes(revogado), "revogado: zero linha").toEqual([]);
  expect(await papeis(revogado), "revogado: o papel removido não aparece").toEqual([]);
  expect(await rpc(revogado), "revogado não usa a RPC").not.toBeNull();
  for (const c of [admin, oper, semPapel]) await c.auth.signOut({ scope: "local" });
});

test("P5 limpeza: reativa a conta 'revogar' como operacional", async ({ browser }) => {
  const admin = await contextoLimpo(browser, estadoDe("admin"));
  const ap = await admin.newPage();
  const d = await abrirGerenciar(ap, emailDe("REVOGAR"));
  await d.getByRole("button", { name: "Reativar acesso" }).click();
  await expect(ap.getByText("Acesso reativado.").first()).toBeVisible();
  await admin.close();
});
