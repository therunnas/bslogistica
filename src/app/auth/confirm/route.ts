import { NextResponse, type NextRequest } from "next/server";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { decidirConfirmacao, montarDestinoConfirmacao } from "@/lib/recuperacao-senha";

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
 *   o motivo real fica com o Supabase, e o usuário recebe sempre o mesmo texto.
 *
 * A sessão criada aqui é de recuperação: serve para trocar a senha em
 * /redefinir-senha e nada mais. Ela não passa pelo guard do painel, que segue
 * exigindo papel e AAL2 como antes.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  const destino = request.nextUrl.clone();

  function responder(resultado: "ok" | "falha") {
    const { pathname, search } = montarDestinoConfirmacao(resultado);
    destino.pathname = pathname;
    destino.search = search;
    return NextResponse.redirect(destino);
  }

  if (decidirConfirmacao({ tokenHash, type }) === "recusar") return responder("falha");

  const supabase = await criarClienteServidor();

  // O `decidirConfirmacao` acima já garantiu que é string não vazia.
  const { error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash as string,
  });

  return responder(error ? "falha" : "ok");
}
