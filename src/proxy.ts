import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { lerAmbienteSupabase } from "@/integrations/supabase/env";

/**
 * Renovação da sessão do Supabase a cada requisição.
 *
 * No Next.js 16 esta convenção se chama proxy.ts — o antigo middleware.ts foi
 * descontinuado e renomeado nesta versão.
 *
 * Por que precisa existir: o token de acesso do Supabase expira em cerca de uma
 * hora e é renovado gravando cookies novos. Server Components não podem gravar
 * cookies, então sem este arquivo a sessão expiraria e o usuário seria
 * deslogado sem aviso no meio do uso.
 *
 * Este arquivo apenas renova a sessão. A proteção de rotas entra depois, junto
 * com a migração da autenticação.
 */
export async function proxy(request: NextRequest) {
  const { url, chave } = lerAmbienteSupabase();

  // A resposta é recriada quando há cookie novo, para que os cabeçalhos
  // Set-Cookie acompanhem o que o Supabase acabou de renovar.
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesParaGravar) {
        for (const { name, value } of cookiesParaGravar) {
          request.cookies.set(name, value);
        }
        resposta = NextResponse.next({ request });
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
