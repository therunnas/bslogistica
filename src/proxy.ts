import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { obterOpcoesCookieSupabase } from "@/integrations/supabase/cookie-options";
import { lerAmbienteSupabase } from "@/integrations/supabase/env";

// Mesmo host usado em next.config.ts — NEXT_PUBLIC_SUPABASE_URL é pública por
// natureza, não é segredo.
const SUPABASE_HOST = "https://ehkduqokntemtmqzdrbd.supabase.co";

// Endpoint de segurança do Sentry, derivado do DSN que já está versionado em
// sentry.server.config.ts/sentry.edge.config.ts/src/instrumentation-client.ts
// (host + id do projeto + chave pública do DSN). DSN do Sentry é público por
// desenho — é o mesmo valor que já vai para o bundle do navegador — então
// isto não expõe segredo nenhum, só reaproveita o que já está no repositório.
// Formato documentado pelo próprio Sentry para receber relatório de CSP:
// https://docs.sentry.io/product/security-policy-reporting/
const SENTRY_CSP_REPORT_URI =
  "https://o4512036932419584.ingest.us.sentry.io/api/4512036953260032/security/?sentry_key=61af9cd029eab6da3f484461be2f9d7d";

function construirCspReportOnly(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${SUPABASE_HOST}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    `report-uri ${SENTRY_CSP_REPORT_URI}`,
  ].join("; ");
}

/**
 * Renovação da sessão do Supabase a cada requisição, e CSP em Report-Only
 * com nonce por requisição.
 *
 * No Next.js 16 esta convenção se chama proxy.ts — o antigo middleware.ts foi
 * descontinuado e renomeado nesta versão.
 *
 * SESSÃO — por que precisa existir: o token de acesso do Supabase expira em
 * cerca de uma hora e é renovado gravando cookies novos. Server Components
 * não podem gravar cookies, então sem este arquivo a sessão expiraria e o
 * usuário seria deslogado sem aviso no meio do uso.
 *
 * Este arquivo apenas renova a sessão. A proteção de rotas entra depois, junto
 * com a migração da autenticação.
 *
 * CSP/NONCE — mecanismo oficial do Next.js (App Router): o nonce é gerado
 * aqui, por requisição, e vai tanto no cabeçalho de resposta (o navegador
 * aplica a policy) quanto no cabeçalho da REQUISIÇÃO que segue para o
 * render (`requestHeaders`). É essa segunda cópia que faz o Next detectar o
 * nonce e aplicá-lo sozinho aos scripts inline que ele mesmo injeta no HTML
 * (o payload de streaming do RSC, `self.__next_f.push`) — sem isso, esses
 * scripts internos violariam a CSP e o sinal do Report-Only ficaria inútil.
 * Continua Report-Only: só observa, não bloqueia nada no navegador ainda.
 */
export async function proxy(request: NextRequest) {
  const { url, chave } = lerAmbienteSupabase();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = construirCspReportOnly(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy-Report-Only", csp);

  // A resposta é recriada quando há cookie novo, para que os cabeçalhos
  // Set-Cookie acompanhem o que o Supabase acabou de renovar. Os headers da
  // requisição (nonce + CSP) acompanham em toda recriação, por isso vão como
  // segundo argumento de cada NextResponse.next().
  let resposta = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(url, chave, {
    cookieOptions: obterOpcoesCookieSupabase(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesParaGravar) {
        for (const { name, value } of cookiesParaGravar) {
          request.cookies.set(name, value);
        }
        resposta = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesParaGravar) {
          resposta.cookies.set(name, value, options);
        }
      },
    },
  });

  // Não remover: é esta chamada que dispara a renovação do token. Ela também
  // valida o token com o servidor do Supabase, em vez de confiar no que veio
  // no cookie.
  await supabase.auth.getUser();

  resposta.headers.set("Content-Security-Policy-Report-Only", csp);

  // A resposta precisa ser devolvida como está. Criar outra e esquecer de
  // copiar os cookies faz a sessão se perder de forma difícil de diagnosticar.
  return resposta;
}

export const config = {
  // Sem matcher, o proxy rodaria também sobre arquivos estáticos e imagens,
  // gastando uma verificação de sessão em cada CSS e cada ícone.
  // monitoring é a rota de túnel do Sentry (tunnelRoute em next.config.ts).
  // Sem excluí-la, cada evento enviado ao Sentry dispararia uma validação de
  // token contra o Supabase — e uma futura guarda de rota aqui bloquearia o
  // relato de erros do cliente sem aviso.
  // branding guarda a logo pública. Ela é buscada por quem não tem sessão —
  // a tela de login e o proxy de imagens do Gmail, a cada abertura do e-mail
  // de autenticação — e cada busca gastaria uma validação de token à toa.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|monitoring|branding).*)",
  ],
};
