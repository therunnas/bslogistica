import type { Locator, Page } from "@playwright/test";

import {
  MENSAGEM_CONFIRMAR_RECUPERACAO,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_SENHA_FRACA,
  MENSAGEM_SENHA_REDEFINIDA,
  MENSAGEM_SENHAS_DIFERENTES,
  MENSAGEM_SOLICITACAO_ENVIADA,
} from "../../src/lib/recuperacao-senha";
import { MENSAGEM_LOGIN_RECUSADO } from "../../src/lib/mensagens-de-login";
import {
  MENSAGEM_CRUA,
  contextoLimpo,
  emailDe,
  enviarLogin,
  lembrado,
  lembrar,
  entrar,
  senhaDe,
  requisitarComo,
  senhaNova,
  sessaoApi,
  textoDoAviso,
  trocarSenha,
  type Conta,
} from "../apoio/contas";
import {
  ORIGEM_DO_LINK,
  esperarEmail,
  idsPara,
  linkDeRecuperacao,
  novasPara,
  tokenDoEmail,
} from "../apoio/email";
import { consultar, expect, test, valor } from "../apoio/fixtures";
import { lit } from "../apoio/banco";
import { campo, dialogo, escolher } from "../apoio/telas";
import { codigoErrado, codigoNovo } from "../apoio/totp";

/**
 * CP-01 — Autenticação: login, recuperação de senha (e-mail capturado no Mailpit local), MFA/TOTP
 * real (código calculado do segredo mostrado na tela e verificado pelo GoTrue local) e
 * administração de usuários. Contas sintéticas locais; nada sai do loopback.
 *
 * Em ordem (1 worker), mas NÃO serial: uma falha não esconde os demais casos. O que um caso deixa
 * para o seguinte (senha nova, segredo TOTP) fica no arquivo de estado da execução.
 */

const OPERACAO = "TESTE-AUD-132 Op Seg"; // criada pelo 20-seguranca
/** E-mail do convidado, fixo para a execução inteira (sobrevive ao reinício do worker). */
function convidado(): string {
  try {
    return lembrado("convidado");
  } catch {
    const email = `e2e-convidado-${Date.now()}@exemplo.test`;
    lembrar("convidado", email);
    return email;
  }
}

async function pedirRecuperacao(page: Page, email: string) {
  await page.goto("/esqueci-senha");
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
  await expect(page.getByText(MENSAGEM_SOLICITACAO_ENVIADA)).toBeVisible();
}

/** Pede a recuperação pela tela e devolve o token_hash capturado no e-mail local. */
async function tokenDeRecuperacao(page: Page, email: string): Promise<string> {
  const antes = await idsPara(email);
  await pedirRecuperacao(page, email);
  const { texto } = await esperarEmail(email, antes);
  return tokenDoEmail(texto, "recovery");
}

async function definirSenha(page: Page, senha: string, confirmacao = senha) {
  await page.locator("#senha").fill(senha);
  await page.locator("#confirmacao").fill(confirmacao);
  await page.getByRole("button", { name: "Redefinir senha" }).click();
}

function fatoresVerificados(conta: Conta): number {
  return Number(
    valor(`select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id
            where u.email = ${lit(emailDe(conta))} and f.status = 'verified'`),
  );
}

function papeisNoBanco(email: string): string[] {
  return consultar<{ role: string }>(
    `select r.role::text as role from public.user_roles r join auth.users u on u.id = r.user_id
      where u.email = ${lit(email)} order by 1`,
  ).map((l) => l.role);
}

// ---------------------------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------------------------

test("L1 login: campos vazios não enviam (validação do formulário)", async ({ page }) => {
  await page.goto("/login");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.locator("#email").evaluate((e: HTMLInputElement) => e.validity.valueMissing),
  ).toBe(true);
  await page.locator("#email").fill(emailDe("ADMIN"));
  await page.locator("button[type=submit]").click();
  expect(
    await page.locator("#senha").evaluate((e: HTMLInputElement) => e.validity.valueMissing),
  ).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
});

test("L2 login: senha errada mostra mensagem em português, sem texto cru do provedor", async ({
  page,
}) => {
  await enviarLogin(page, emailDe("ADMIN"), "senha-errada-123");
  const aviso = await textoDoAviso(page);
  expect(aviso, `aviso exibido: "${aviso}"`).not.toMatch(MENSAGEM_CRUA);
  expect(aviso).toBe(MENSAGEM_LOGIN_RECUSADO);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("button[type=submit]")).toBeEnabled();
});

test("L3 login: e-mail inexistente recebe a MESMA mensagem (sem enumeração de contas)", async ({
  page,
}) => {
  await enviarLogin(page, "nao-existe@exemplo.test", "qualquer-senha-123");
  expect(await textoDoAviso(page)).toBe(MENSAGEM_LOGIN_RECUSADO);
});

test("L4 login: estado de carregamento trava o botão durante o envio", async ({ page }) => {
  await page.route("**/auth/v1/token**", async (rota) => {
    await new Promise((r) => setTimeout(r, 1500));
    await rota.continue();
  });
  await page.goto("/login");
  await page.locator("#email").fill(emailDe("ADMIN"));
  await page.locator("#senha").fill(senhaDe("ADMIN"));
  await page.locator("button[type=submit]").click();
  const botao = page.getByRole("button", { name: "Aguarde..." });
  await expect(botao).toBeVisible();
  await expect(botao).toBeDisabled();
  await page.waitForURL(/\/dashboard/);
});

test("L5/L6 login correto entra; com sessão ativa, /login devolve ao painel", async ({
  browser,
}) => {
  const page = await entrar(browser, "ADMIN");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/login");
  await page.waitForURL(/\/dashboard/);
  await page.context().close();
});

test("L7/L8 logout encerra a sessão no servidor; cookie antigo e sessão sem cookie voltam ao login", async ({
  browser,
}) => {
  // Conta própria (operacional "recupera"): o logout é global e não pode derrubar o login global.
  const page = await entrar(browser, "RECUPERA");
  await expect(page).toHaveURL(/\/operacional/);
  const estadoAntigo = await page.context().storageState();

  await page
    .getByRole("button", { name: /e2e-recupera|conta|menu/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/operacional");
  await expect(page).toHaveURL(/\/login/);

  // Reutilizar os cookies de antes do logout: a sessão não existe mais no Auth.
  const reaproveitado = await browser.newContext({ storageState: estadoAntigo });
  const p2 = await reaproveitado.newPage();
  await p2.goto("/operacional");
  await expect(p2).toHaveURL(/\/login/);
  await reaproveitado.close();

  // Sem cookie nenhum.
  const vazio = await contextoLimpo(browser);
  const p3 = await vazio.newPage();
  for (const rota of ["/dashboard", "/usuarios", "/operacional", "/configuracoes"]) {
    await p3.goto(rota);
    await expect(p3, rota).toHaveURL(/\/login/);
  }
  await vazio.close();
  await page.context().close();
});

// ---------------------------------------------------------------------------------------------
// RECUPERAÇÃO DE SENHA (conta sem MFA)
// ---------------------------------------------------------------------------------------------

test("R1/R2 solicitar: mensagem neutra; e-mail só para conta existente", async ({ page }) => {
  const inexistente = "ninguem@exemplo.test";
  const antes = await idsPara(inexistente);
  await pedirRecuperacao(page, inexistente);
  await page.waitForTimeout(2000);
  expect(await novasPara(inexistente, antes)).toBe(0);

  const antesReal = await idsPara(emailDe("RECUPERA"));
  await pedirRecuperacao(page, emailDe("RECUPERA"));
  const { texto } = await esperarEmail(emailDe("RECUPERA"), antesReal);
  expect(tokenDoEmail(texto, "recovery")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
});

test("R3–R7 link: GET de scanner não consome; Continuar; validações; nova senha; link reusado", async ({
  browser,
  request,
}) => {
  // Sessão aberta ANTES da recuperação: precisa perder o acesso depois (R10).
  const sessaoAnterior = await entrar(browser, "RECUPERA");
  await expect(sessaoAnterior).toHaveURL(/\/operacional/);

  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  const token = await tokenDeRecuperacao(page, emailDe("RECUPERA"));

  // R4: um gateway de e-mail que só faz GET no link não gasta o token.
  const scanner = await request.get(linkDeRecuperacao(token), { maxRedirects: 0 });
  expect(scanner.status()).toBe(303);
  expect(scanner.headers()["cache-control"]).toContain("no-store");
  expect(scanner.headers()["location"]).toContain("/auth/confirmar-recuperacao");
  expect(scanner.headers()["location"]).not.toContain(token);

  // R3: o clique real.
  await page.goto(linkDeRecuperacao(token));
  await expect(page).toHaveURL(/\/auth\/confirmar-recuperacao$/);
  await expect(page.getByText(MENSAGEM_CONFIRMAR_RECUPERACAO)).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/redefinir-senha$/);

  // R5: vazio, diferentes, fraca.
  // Vazio: o formulário não envia (campo obrigatório). Só espaços passa pelo navegador e pela
  // validação da tela (que recusa apenas o vazio) e é recusado pelo Auth como senha fraca.
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  expect(
    await page.locator("#senha").evaluate((e: HTMLInputElement) => e.validity.valueMissing),
  ).toBe(true);
  await definirSenha(page, "   ");
  await expect(page.getByText(MENSAGEM_SENHA_FRACA)).toBeVisible();
  await expect(page).toHaveURL(/\/redefinir-senha$/);
  await definirSenha(page, "SenhaBoa-123", "SenhaBoa-124");
  await expect(page.getByText(MENSAGEM_SENHAS_DIFERENTES)).toBeVisible();
  await definirSenha(page, "12345");
  await expect(page.getByText(MENSAGEM_SENHA_FRACA)).toBeVisible();

  // R6: sucesso.
  const nova = senhaNova();
  const antiga = senhaDe("RECUPERA");
  await definirSenha(page, nova);
  await page.waitForURL(/\/login\?senha-redefinida=1/);
  await expect(page.getByText(MENSAGEM_SENHA_REDEFINIDA)).toBeVisible();
  trocarSenha("RECUPERA", nova);

  await enviarLogin(page, emailDe("RECUPERA"), antiga);
  expect(await textoDoAviso(page)).not.toMatch(MENSAGEM_CRUA);
  await expect(page).toHaveURL(/\/login/);
  const ok = await entrar(browser, "RECUPERA");
  await expect(ok).toHaveURL(/\/operacional/);
  await ok.context().close();

  // R10: a sessão aberta antes perdeu o acesso.
  await sessaoAnterior.goto("/operacional");
  await expect(sessaoAnterior).toHaveURL(/\/login/);
  await sessaoAnterior.context().close();

  // R7: o mesmo link outra vez.
  const outro = await contextoLimpo(browser);
  const p2 = await outro.newPage();
  await p2.goto(linkDeRecuperacao(token));
  await p2.getByRole("button", { name: "Continuar" }).click();
  await expect(p2).toHaveURL(/\/esqueci-senha\?status=link-invalido/);
  await expect(p2.getByText(MENSAGEM_LINK_INVALIDO)).toBeVisible();
  await outro.close();
  await ctx.close();
});

test("R8/R9/R11 token inválido, confirmação sem cookie e redefinição sem prova", async ({
  page,
}) => {
  await page.goto(`${ORIGEM_DO_LINK}/auth/confirm?token_hash=invalido0000&type=recovery`);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/status=link-invalido/);
  await expect(page.getByText(MENSAGEM_LINK_INVALIDO)).toBeVisible();

  await page.goto(`${ORIGEM_DO_LINK}/auth/confirm?token_hash=abc&type=signup`);
  await expect(page.getByText(MENSAGEM_LINK_INVALIDO)).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`${ORIGEM_DO_LINK}/auth/confirmar-recuperacao`);
  await expect(page.getByText(MENSAGEM_LINK_INVALIDO)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar" })).toHaveCount(0);

  await page.goto("/redefinir-senha");
  await expect(page.locator("#confirmacao")).toHaveCount(0);
});

test("R12 duplo clique em Continuar não invalida o próprio link", async ({ browser }) => {
  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  const token = await tokenDeRecuperacao(page, emailDe("RECUPERA"));
  await page.goto(linkDeRecuperacao(token));
  await page.getByRole("button", { name: "Continuar" }).dblclick();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/confirmar-recuperacao"), {
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/redefinir-senha$/);
  await expect(page.locator("#confirmacao")).toBeVisible();
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------
// MFA / TOTP (admin2)
// ---------------------------------------------------------------------------------------------

async function abrirSeguranca(page: Page) {
  await page.goto("/configuracoes");
  await expect(page.getByText("Verificação em duas etapas").first()).toBeVisible();
}

test("M1–M3 cadastro do fator: cancelar, código errado recusado, código real ativa", async ({
  browser,
}) => {
  const page = await entrar(browser, "ADMIN2");
  await expect(page).toHaveURL(/\/dashboard/);
  expect(fatoresVerificados("ADMIN2")).toBe(0);

  // Cancelar no meio do cadastro: nada fica ativo.
  await abrirSeguranca(page);
  await page.getByRole("button", { name: "Ativar autenticação em duas etapas" }).click();
  await expect(page.locator("#segredo-configuracoes")).not.toBeEmpty();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(
    page.getByRole("button", { name: "Ativar autenticação em duas etapas" }),
  ).toBeVisible();
  expect(fatoresVerificados("ADMIN2")).toBe(0);

  await page.getByRole("button", { name: "Ativar autenticação em duas etapas" }).click();
  const segredo = (await page.locator("#segredo-configuracoes").innerText()).trim();
  lembrar("segredo:ADMIN2", segredo);
  expect(segredo).toMatch(/^[A-Z2-7]{16,}$/);

  await page.locator("#codigo-configuracoes").fill(codigoErrado(segredo));
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  const aviso = await textoDoAviso(page);
  expect(aviso, `aviso exibido: "${aviso}"`).not.toMatch(MENSAGEM_CRUA);
  expect(aviso).toContain("Código inválido");
  expect(fatoresVerificados("ADMIN2")).toBe(0);

  await page.locator("#codigo-configuracoes").fill(await codigoNovo(segredo));
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Verificação em duas etapas ativada.")).toBeVisible();
  expect(fatoresVerificados("ADMIN2")).toBe(1);
  await page.context().close();
});

test("M4/M5 com fator: login exige TOTP; AAL1 barrada na tela, na API e no banco; código real libera", async ({
  browser,
}) => {
  const segredo = lembrado("segredo:ADMIN2");
  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  await enviarLogin(page, emailDe("ADMIN2"), senhaDe("ADMIN2"));
  await page.waitForURL(/\/mfa/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/mfa/);
  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/mfa/);

  // API Route com os cookies AAL1 desta sessão.
  const api = await requisitarComo(ctx, "GET", "/api/fechamento?inicio=2026-10-01&fim=2026-10-15");
  expect(api.status()).toBe(403);

  // Banco: sessão AAL1 de conta com fator não lê tabela de negócio.
  const aal1 = await sessaoApi("ADMIN2");
  const { data: clientes } = await aal1.from("clients").select("id").limit(5);
  expect(clientes ?? []).toEqual([]);
  const { data: papeis } = await aal1.from("user_roles").select("role");
  expect((papeis ?? []).length, "user_roles continua legível em AAL1 (sem deadlock)").toBe(1);
  await aal1.auth.signOut({ scope: "local" });

  // Código errado no desafio.
  await page.locator("#codigo").fill(codigoErrado(segredo));
  await page.getByRole("button", { name: "Confirmar" }).click();
  const aviso = await textoDoAviso(page);
  expect(aviso, `aviso exibido: "${aviso}"`).not.toMatch(MENSAGEM_CRUA);
  expect(aviso).toContain("Código inválido");
  await expect(page).toHaveURL(/\/mfa/);

  await page.locator("#codigo").fill(await codigoNovo(segredo));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.waitForURL(/\/dashboard/);
  const liberada = await requisitarComo(
    ctx,
    "GET",
    "/api/fechamento?inicio=2026-10-01&fim=2026-10-15",
  );
  expect(liberada.status()).not.toBe(401);
  expect(liberada.status()).not.toBe(403);
  await ctx.close();
});

test("M6 Sair na tela do segundo fator encerra a sessão", async ({ browser }) => {
  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  await enviarLogin(page, emailDe("ADMIN2"), senhaDe("ADMIN2"));
  await page.waitForURL(/\/mfa/);
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/mfa");
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

test("M7 recuperação com MFA: exatamente um TOTP, código errado recusado, sem segundo pedido", async ({
  browser,
}) => {
  const segredo = lembrado("segredo:ADMIN2");
  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  const token = await tokenDeRecuperacao(page, emailDe("ADMIN2"));
  await page.goto(linkDeRecuperacao(token));
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/redefinir-senha\/mfa$/);

  await page.locator("#codigo").fill(codigoErrado(segredo));
  await page.getByRole("button", { name: "Confirmar" }).click();
  const aviso = await textoDoAviso(page);
  expect(aviso, `aviso exibido: "${aviso}"`).not.toMatch(MENSAGEM_CRUA);
  await expect(page).toHaveURL(/\/redefinir-senha\/mfa$/);

  await page.locator("#codigo").fill(await codigoNovo(segredo));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.waitForURL(/\/redefinir-senha$/);

  const nova = senhaNova();
  await definirSenha(page, nova);
  trocarSenha("ADMIN2", nova);
  // Depois da redefinição a sessão continua AAL2: vai ao painel sem pedir outro código.
  await page.waitForURL(/\/dashboard/);
  await expect(page.locator("#codigo")).toHaveCount(0);
  await ctx.close();
});

test("M8 desativar o fator: código errado mantém; Cancelar mantém; código real remove", async ({
  browser,
}) => {
  const segredo = lembrado("segredo:ADMIN2");
  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  await enviarLogin(page, emailDe("ADMIN2"), senhaDe("ADMIN2"));
  await page.waitForURL(/\/mfa/);
  await page.locator("#codigo").fill(await codigoNovo(segredo));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.waitForURL(/\/dashboard/);

  await abrirSeguranca(page);
  await page.getByRole("button", { name: "Desativar autenticação em duas etapas" }).click();
  const d = page.getByRole("alertdialog");
  await d.locator("#codigo-desativacao").fill(codigoErrado(segredo));
  await d.getByRole("button", { name: "Desativar", exact: true }).click();
  expect(await textoDoAviso(page)).toContain("Código inválido");
  expect(fatoresVerificados("ADMIN2")).toBe(1);

  await d.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(fatoresVerificados("ADMIN2")).toBe(1);

  await page.getByRole("button", { name: "Desativar autenticação em duas etapas" }).click();
  await page
    .getByRole("alertdialog")
    .locator("#codigo-desativacao")
    .fill(await codigoNovo(segredo));
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Desativar", exact: true })
    .click();
  await expect(page.getByText("Verificação em duas etapas removida.")).toBeVisible();
  expect(fatoresVerificados("ADMIN2")).toBe(0);
  await ctx.close();

  // Sem fator: o login volta a ser só e-mail e senha.
  const depois = await entrar(browser, "ADMIN2");
  await expect(depois).toHaveURL(/\/dashboard/);
  await depois.context().close();
});

// ---------------------------------------------------------------------------------------------
// USUÁRIOS (admin pela tela)
// ---------------------------------------------------------------------------------------------

/** Linha de um papel no diálogo do usuário (o rótulo e os botões dela). */
function linhaDoPapel(d: Locator, rotulo: "Administrador" | "Operacional"): Locator {
  return d
    .locator("div")
    .filter({ has: d.page().getByText(rotulo, { exact: true }) })
    .filter({ has: d.page().getByRole("button") })
    .last();
}

async function abrirUsuario(page: Page, email: string) {
  await page.goto("/usuarios");
  const linha = page.locator("tr").filter({ hasText: email });
  await expect(linha).toBeVisible({ timeout: 20_000 });
  await linha.getByRole("button").last().click();
  return dialogo(page);
}

async function convidar(page: Page, email: string, papel: "Administrador" | "Operacional") {
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Convidar usuário" }).click();
  const d = dialogo(page);
  await d.locator("input").first().fill(email);
  await escolher(page, d.getByRole("combobox"), papel);
  return d;
}

test("U1/U2 convite: e-mail capturado, papel, auditoria; inválido e duplicado em português; sem duplicar", async ({
  browser,
}) => {
  const page = await entrar(browser, "ADMIN");
  const antes = await idsPara(convidado());
  const d = await convidar(page, convidado(), "Operacional");
  await d.getByRole("button", { name: "Enviar convite" }).dblclick();
  expect(await textoDoAviso(page)).toContain("Convite enviado.");
  await esperarEmail(convidado(), antes);
  await page.waitForTimeout(1500);
  expect(await novasPara(convidado(), antes), "duplo clique não envia dois convites").toBe(1);
  expect(papeisNoBanco(convidado())).toEqual(["operacional"]);
  expect(Number(valor(`select count(*) from auth.users where email = ${lit(convidado())}`))).toBe(
    1,
  );
  expect(
    Number(
      valor(
        `select count(*) from public.admin_audit_log a join auth.users u on u.id = a.target_user_id
          where u.email = ${lit(convidado())} and a.action = 'convite_criado'`,
      ),
    ),
    "convite auditado uma única vez",
  ).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("tr").filter({ hasText: convidado() })).toBeVisible();

  for (const errado of ["nao-e-email", emailDe("RECUPERA")]) {
    const d2 = await convidar(page, errado, "Operacional");
    await d2.getByRole("button", { name: "Enviar convite" }).click();
    const aviso = await textoDoAviso(page);
    expect(aviso, `aviso para "${errado}": "${aviso}"`).not.toMatch(MENSAGEM_CRUA);
    if (errado.includes("@")) expect(aviso).toContain("Já existe uma conta com este e-mail");
    await page.keyboard.press("Escape");
  }
  expect(papeisNoBanco(emailDe("RECUPERA"))).toEqual(["operacional"]);
  await page.context().close();
});

test("U3 aceitar convite: o convidado define a senha pela recuperação e entra com o papel dado", async ({
  browser,
}) => {
  const ctx = await contextoLimpo(browser);
  const page = await ctx.newPage();
  const token = await tokenDeRecuperacao(page, convidado());
  await page.goto(linkDeRecuperacao(token));
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/redefinir-senha$/);
  const senha = senhaNova();
  await definirSenha(page, senha);
  lembrar("senha:convidado", senha);
  await page.waitForURL(/\/login/);
  await enviarLogin(page, convidado(), senha);
  await page.waitForURL(/\/operacional/);
  await ctx.close();
});

test("U4 conceder e revogar papel atualiza a lista e o banco; último admin é protegido", async ({
  browser,
}) => {
  const page = await entrar(browser, "ADMIN");
  let d = await abrirUsuario(page, convidado());
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Conceder" }).click();
  expect(await textoDoAviso(page)).toContain("Papel concedido.");
  expect(papeisNoBanco(convidado())).toEqual(["admin", "operacional"]);
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
  expect(papeisNoBanco(convidado())).toEqual(["admin", "operacional"]);
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByText("Papel revogado.").first()).toBeVisible();
  expect(papeisNoBanco(convidado())).toEqual(["operacional"]);
  await page.keyboard.press("Escape");

  // Último admin: tira o admin do admin2 e tenta tirar o do próprio admin.
  d = await abrirUsuario(page, emailDe("ADMIN2"));
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByText("Papel revogado.").first()).toBeVisible();
  await page.keyboard.press("Escape");
  expect(papeisNoBanco(emailDe("ADMIN2"))).toEqual([]);

  d = await abrirUsuario(page, emailDe("ADMIN"));
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click();
  await expect(d.getByText(/último administrador|único administrador/i).first()).toBeVisible();
  expect(papeisNoBanco(emailDe("ADMIN"))).toEqual(["admin"]);
  await d.getByRole("button", { name: "Revogar acesso" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revogar acesso" }).click();
  await expect(d.getByText(/único administrador/i).first()).toBeVisible();
  expect(papeisNoBanco(emailDe("ADMIN"))).toEqual(["admin"]);
  await page.keyboard.press("Escape");

  d = await abrirUsuario(page, emailDe("ADMIN2"));
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Conceder" }).click();
  await expect(page.getByText("Papel concedido.").first()).toBeVisible();
  expect(papeisNoBanco(emailDe("ADMIN2"))).toEqual(["admin"]);
  await page.context().close();
});

test("U4b mudança de papel vale na próxima requisição da sessão já aberta (sem cache)", async ({
  browser,
}) => {
  const ctx = await contextoLimpo(browser);
  const sessao = await ctx.newPage();
  await enviarLogin(sessao, convidado(), lembrado("senha:convidado"));
  await sessao.waitForURL(/\/operacional/);
  await sessao.goto("/usuarios");
  await expect(sessao.getByText("Área administrativa restrita")).toBeVisible();

  const admin = await entrar(browser, "ADMIN");
  let d = await abrirUsuario(admin, convidado());
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Conceder" }).click();
  await expect(admin.getByText("Papel concedido.").first()).toBeVisible();

  await sessao.goto("/usuarios");
  await expect(sessao.getByText("Área administrativa restrita")).toHaveCount(0);
  await expect(sessao.locator("tr").filter({ hasText: emailDe("ADMIN") })).toBeVisible();

  await admin.keyboard.press("Escape");
  d = await abrirUsuario(admin, convidado());
  await linhaDoPapel(d, "Administrador").getByRole("button", { name: "Revogar" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click();
  await expect(admin.getByText("Papel revogado.").first()).toBeVisible();

  await sessao.goto("/usuarios");
  await expect(sessao.getByText("Área administrativa restrita")).toBeVisible();
  expect(papeisNoBanco(convidado())).toEqual(["operacional"]);
  await admin.context().close();
  await ctx.close();
});

test("U5 atribuir e remover operação: o operador passa a ver e deixa de ver; sem duplicar", async ({
  browser,
}) => {
  const admin = await entrar(browser, "ADMIN");
  const oper = await entrar(browser, "REVOGAR");
  await expect(oper).toHaveURL(/\/operacional/);
  await expect(oper.getByText(OPERACAO)).toHaveCount(0);

  const auditadas = () =>
    Number(
      valor(
        `select count(*) from public.admin_audit_log a join auth.users u on u.id = a.target_user_id
          where u.email = ${lit(emailDe("REVOGAR"))} and a.action = 'operacao_atribuida'`,
      ),
    );
  const auditadasAntes = auditadas();
  const d = await abrirUsuario(admin, emailDe("REVOGAR"));
  await escolher(admin, campo(d, "Atribuir operação"), OPERACAO);
  await d.getByRole("button", { name: "Atribuir", exact: true }).dblclick();
  await expect(d.getByText("Operação atribuída.").first()).toBeVisible({ timeout: 20_000 });
  await admin.waitForTimeout(1500);
  expect(
    Number(
      valor(
        `select count(*) from public.user_operation_access a join auth.users u on u.id = a.user_id
          join public.operations o on o.id = a.operation_id
          where u.email = ${lit(emailDe("REVOGAR"))} and o.name = ${lit(OPERACAO)}`,
      ),
    ),
  ).toBe(1);

  expect(auditadas() - auditadasAntes, "duplo clique não executa a atribuição duas vezes").toBe(1);

  await oper.reload();
  await expect(oper.getByText(OPERACAO).first()).toBeVisible({ timeout: 20_000 });

  await d
    .locator("div")
    .filter({ has: admin.getByText(OPERACAO, { exact: true }) })
    .filter({ has: admin.locator("button") })
    .last()
    .getByRole("button", { name: "Remover operação" })
    .click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Remover" }).click();
  await expect(admin.getByText("Operação removida.").first()).toBeVisible();
  await oper.reload();
  await expect(oper.getByText(OPERACAO)).toHaveCount(0);

  // Atribui de novo para a revogação provar que limpa as operações.
  await escolher(admin, campo(d, "Atribuir operação"), OPERACAO);
  await d.getByRole("button", { name: "Atribuir", exact: true }).click();
  await expect(d.getByText("Operação atribuída.").first()).toBeVisible({ timeout: 20_000 });
  await admin.context().close();
  await oper.context().close();
});

test("U6 revogar acesso derruba a sessão ativa e o login; reativar devolve só o papel", async ({
  browser,
}) => {
  const oper = await entrar(browser, "REVOGAR");
  await expect(oper).toHaveURL(/\/operacional/);
  const admin = await entrar(browser, "ADMIN");

  const d = await abrirUsuario(admin, emailDe("REVOGAR"));
  await d.getByRole("button", { name: "Revogar acesso" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
  expect(papeisNoBanco(emailDe("REVOGAR"))).toEqual(["operacional"]);
  await d.getByRole("button", { name: "Revogar acesso" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Revogar acesso" }).click();
  await expect(admin.getByText("Acesso revogado.").first()).toBeVisible();
  expect(papeisNoBanco(emailDe("REVOGAR"))).toEqual([]);
  expect(
    Number(
      valor(
        `select count(*) from public.user_operation_access a join auth.users u on u.id = a.user_id
          where u.email = ${lit(emailDe("REVOGAR"))}`,
      ),
    ),
  ).toBe(0);
  await admin.keyboard.press("Escape");
  await expect(admin.locator("tr").filter({ hasText: emailDe("REVOGAR") })).toContainText(
    "Acesso revogado",
  );

  // A sessão que estava aberta não vê mais nada.
  await oper.reload();
  await expect(oper.getByText(OPERACAO)).toHaveCount(0);
  await expect(oper).not.toHaveURL(/\/operacional$/);
  await oper.context().close();

  // Login novo recusado, com mensagem em português.
  const ctx = await contextoLimpo(browser);
  const p = await ctx.newPage();
  await enviarLogin(p, emailDe("REVOGAR"), senhaDe("REVOGAR"));
  const aviso = await textoDoAviso(p);
  expect(aviso, `aviso exibido: "${aviso}"`).not.toMatch(MENSAGEM_CRUA);
  await expect(p).toHaveURL(/\/login/);
  await ctx.close();

  // Reativar como operacional: entra, mas sem operações antigas.
  const d2 = await abrirUsuario(admin, emailDe("REVOGAR"));
  await d2.getByRole("button", { name: "Reativar acesso" }).click();
  await expect(admin.getByText("Acesso reativado.").first()).toBeVisible();
  expect(papeisNoBanco(emailDe("REVOGAR"))).toEqual(["operacional"]);
  const volta = await entrar(browser, "REVOGAR");
  await expect(volta).toHaveURL(/\/operacional/);
  await expect(volta.getByText(OPERACAO)).toHaveCount(0);
  await volta.context().close();
  await admin.context().close();
});
