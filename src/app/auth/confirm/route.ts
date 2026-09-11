import { NextResponse, type NextRequest } from "next/server";

import { criarClienteServidor } from "@/integrations/supabase/server";
import {
  NOME_DO_COOKIE_DE_PROVA,
  VALIDADE_DA_PROVA_EM_SEGUNDOS,
  criarProvaDeRecuperacao,
} from "@/lib/prova-recuperacao";
import {
  ROTA_REDEFINIR_SENHA,
  decidirConfirmacao,
  montarDestinoConfirmacao,
} from "@/lib/recuperacao-senha";

/**
 * Consumo do link de recuperação de senha, no servidor.
 *
 * O e-mail aponta para cá com `token_hash` e `type`. A troca do token por
 * sessão acontece aqui, e não no navegador, para que o token nunca precise
 * existir no JavaScript da página nem no fragmento da URL.
 *
 * O que esta rota deliberadamente NÃO faz:
 *
 * - não aceita `next`, `redirect_to` nem qualquer destino vindo da query. Os
 *   dois destinos possíveis são constantes em `lib/recuperacao-senha.ts`, o
 *   que fecha a porta para open redirect;
 * - não aceita `type` diferente de `recovery`. Convite, magic link e troca de
 *   e-mail criariam sessão pelo mesmo `verifyOtp` sem que nada disso tenha
 *   sido revisado nesta etapa;
 * - não escreve o token em resposta, mensagem ou log. Nem no caminho de erro:
 *   o motivo real fica com o Supabase, e o usuário recebe sempre o mesmo texto;
 * - não coloca o `token_hash` dentro do cookie de prova.
 *
 * Este é o ÚNICO ponto do sistema onde a recuperação fica comprovada, então é
 * aqui que a prova assinada é emitida — depois do `verifyOtp` dar certo, e
 * amarrada ao `sub` e ao `session_id` lidos de claims verificados.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  function responder(resultado: "ok" | "falha") {
    const destino = request.nextUrl.clone();
    const { pathname, search } = montarDestinoConfirmacao(resultado);
    destino.pathname = pathname;
    destino.search = search;
    return NextResponse.redirect(destino);
  }

  if (decidirConfirmacao({ tokenHash, type }) === "recusar") return responder("falha");

  const supabase = await criarClienteServidor();

  // O `decidirConfirmacao` acima já garantiu que é string não vazia.
  const { data, error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash as string,
  });

  if (error || !data.session) return responder("falha");

  // Claims verificados do access token recém-emitido. `getClaims` valida a
  // assinatura do JWT; ler o corpo sem verificar seria confiar no que veio da
  // rede. Daqui saem o `sub` e o `session_id` que amarram a prova.
  const { data: claims, error: erroClaims } = await supabase.auth.getClaims(
    data.session.access_token,
  );

  // Confirmação independente de que há usuário autenticado de fato.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sub = claims?.claims?.sub;
  const sessionId = claims?.claims?.session_id;

  if (erroClaims || !user || typeof sub !== "string" || typeof sessionId !== "string") {
    return responder("falha");
  }

  // Coerência entre as duas leituras: o token verificado tem de descrever o
  // mesmo usuário que o servidor confirmou.
  if (sub !== user.id) return responder("falha");

  const prova = await criarProvaDeRecuperacao({ sub, sessionId });

  // Sem segredo configurado não há prova possível. Falha fechada: é melhor o
  // fluxo parar aqui do que seguir para um formulário que não conseguiria
  // provar nada.
  if (!prova) return responder("falha");

  const resposta = responder("ok");

  // `lax`, não `strict`: o fluxo nasce num link de e-mail, então a chegada a
  // /auth/confirm é uma navegação cross-site e os navegadores propagam essa
  // classificação pela cadeia de redirect. Com `strict` o cookie seria gravado
  // mas poderia não ser enviado na requisição seguinte a /redefinir-senha, e o
  // guard negaria um link legítimo. `lax` envia em navegação top-level GET —
  // exatamente este caso — e segue bloqueando subrequisição cross-site. Não
  // enfraquece nada: quem impede a forja é o HMAC, não o SameSite.
  //
  // O Path restringe o envio à única rota que lê a prova. O atributo Path do
  // Set-Cookie não precisa casar com a rota que o emite, então emitir daqui
  // com destino /redefinir-senha é legítimo.
  resposta.cookies.set(NOME_DO_COOKIE_DE_PROVA, prova, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ROTA_REDEFINIR_SENHA,
    maxAge: VALIDADE_DA_PROVA_EM_SEGUNDOS,
  });

  return resposta;
}
