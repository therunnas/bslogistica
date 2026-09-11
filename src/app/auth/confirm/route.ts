import { NextResponse, type NextRequest } from "next/server";

import {
  NOME_DO_COOKIE_PENDENTE,
  ROTA_CONFIRMAR_RECUPERACAO,
  VALIDADE_DO_PENDENTE_EM_SEGUNDOS,
  decidirConfirmacao,
  montarDestinoConfirmacao,
} from "@/lib/recuperacao-senha";

/**
 * Entrada do link de recuperação de senha. NÃO consome o token.
 *
 * POR QUE ESTA ROTA NÃO VERIFICA MAIS O TOKEN
 *
 * Antes, o `verifyOtp` acontecia aqui mesmo, no GET. O problema apontado em
 * revisão: gateways de segurança de e-mail — Defender Safe Links, Proofpoint,
 * Mimecast — fazem um GET automático em cada link da mensagem, na entrega ou
 * na abertura. Esse GET gastava o token de uso único, e o clique real do
 * usuário chegava a um link já consumido. A suposição dos scanners é razoável:
 * pela semântica HTTP, GET é seguro e idempotente. Quem estava errado era a
 * rota, ao mudar estado num GET.
 *
 * Agora o consumo exige ação deliberada, na Server Action de
 * `/auth/confirmar-recuperacao`. Um scanner que só faça GET percorre esta rota
 * inteira sem gastar nada.
 *
 * O QUE ESTA ROTA FAZ
 *
 * Valida o formato, guarda o `token_hash` num cookie `httpOnly` e manda o
 * navegador para a tela de confirmação — por 303, e para uma URL sem query.
 *
 * COOKIE EM VEZ DE CAMPO ESCONDIDO
 *
 * O token precisa sobreviver do GET até o POST. Num `<input type="hidden">`
 * ele entraria no HTML da página, ao alcance de extensão de navegador e de
 * cache indevido, e voltaria no `FormData`. No cookie `httpOnly` ele fica
 * apenas em cabeçalhos: nunca no DOM, nunca no JavaScript, nunca no corpo do
 * formulário.
 *
 * O `path` do cookie é o da tela de confirmação, não o desta rota. Pela
 * RFC 6265 §5.1.4 um `Path=/auth/confirm` NÃO seria enviado para
 * `/auth/confirmar-recuperacao` — o prefixo só casa quando o caractere
 * seguinte é `/`. Emitir com o path do destino é o que faz o cookie chegar à
 * Server Action, e é o mesmo padrão já usado pelo cookie de prova.
 *
 * O que esta rota deliberadamente NÃO faz:
 *
 * - não chama `verifyOtp` nem cria sessão;
 * - não cria prova HMAC — sem token consumido, não há o que provar;
 * - não aceita `next`, `redirect_to` nem destino vindo da query. Os destinos
 *   são constantes de `lib/recuperacao-senha.ts`, o que fecha open redirect;
 * - não aceita `type` diferente de `recovery`;
 * - não escreve o token em resposta, mensagem ou log.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  function redirecionar(pathname: string, search: string) {
    const destino = request.nextUrl.clone();
    destino.pathname = pathname;
    destino.search = search;

    // 303 See Other: o destino é sempre buscado por GET, e a resposta não entra
    // em cache intermediário.
    const resposta = NextResponse.redirect(destino, 303);

    // O redirect carrega o Set-Cookie do token pendente. Guardar isso em
    // qualquer cache — do navegador, de proxy corporativo — entregaria o token
    // a quem pedisse a mesma URL depois.
    resposta.headers.set("Cache-Control", "no-store");

    return resposta;
  }

  if (decidirConfirmacao({ tokenHash, type }) === "recusar") {
    const { pathname, search } = montarDestinoConfirmacao("falha");
    return redirecionar(pathname, search);
  }

  // Destino sem query: é o que tira `token_hash` e `type` da barra de
  // endereços, do histórico e do cabeçalho Referer já no primeiro salto.
  const resposta = redirecionar(ROTA_CONFIRMAR_RECUPERACAO, "");

  // O `decidirConfirmacao` acima já garantiu string não vazia.
  resposta.cookies.set(NOME_DO_COOKIE_PENDENTE, tokenHash as string, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ROTA_CONFIRMAR_RECUPERACAO,
    maxAge: VALIDADE_DO_PENDENTE_EM_SEGUNDOS,
  });

  return resposta;
}
