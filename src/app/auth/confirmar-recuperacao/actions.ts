"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";
import {
  NOME_DO_COOKIE_DE_PROVA,
  VALIDADE_DA_PROVA_EM_SEGUNDOS,
  criarProvaDeRecuperacao,
} from "@/lib/prova-recuperacao";
import { decidirMfaNaRecuperacao, decidirSituacaoMfa } from "@/lib/mfa";
import {
  NOME_DO_COOKIE_PENDENTE,
  ROTA_CONFIRMAR_RECUPERACAO,
  ROTA_ESQUECI_SENHA_LINK_INVALIDO,
  ROTA_REDEFINIR_SENHA,
  ROTA_REDEFINIR_SENHA_MFA,
} from "@/lib/recuperacao-senha";

/**
 * Consumo do token de recuperação, no servidor, após ação deliberada.
 *
 * Este é o passo que antes acontecia no GET de `/auth/confirm`. Foi movido
 * para cá porque um GET não pode gastar um token de uso único: scanners de
 * e-mail visitam links automaticamente e queimavam a recuperação antes do
 * usuário. Aqui só se chega por POST, disparado por um clique.
 *
 * O `token_hash` vem EXCLUSIVAMENTE do cookie `httpOnly` gravado pelo GET.
 * Nunca do `FormData`: aceitar o token pelo corpo do formulário devolveria ao
 * navegador a capacidade de escolher qual token verificar, que é exatamente o
 * que o cookie evita — e o colocaria no HTML da página para poder ser enviado.
 * Por isso esta action não recebe parâmetro algum.
 *
 * Este é o ÚNICO ponto do sistema onde a recuperação fica comprovada, então é
 * aqui que a prova assinada é emitida — depois do `verifyOtp` dar certo, e
 * amarrada ao `sub` e ao `session_id` lidos de claims verificados.
 */
export async function confirmarRecuperacao() {
  const armazemDeCookies = await cookies();
  const tokenHash = armazemDeCookies.get(NOME_DO_COOKIE_PENDENTE)?.value;

  /**
   * O cookie pendente morre em toda saída, qualquer que seja o desfecho.
   *
   * No sucesso porque o token já foi consumido e guardá-lo não serve a nada.
   * Na falha porque insistir com um token inválido só repetiria a falha. Mesmo
   * `path` do `Set-Cookie` original, senão o navegador não casa o cookie a
   * remover.
   */
  function apagarPendente() {
    armazemDeCookies.set(NOME_DO_COOKIE_PENDENTE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: ROTA_CONFIRMAR_RECUPERACAO,
      maxAge: 0,
    });
  }

  function falharSemSessao(): never {
    apagarPendente();
    redirect(ROTA_ESQUECI_SENHA_LINK_INVALIDO);
  }

  // Sem cookie não há o que verificar: link aberto direto, cookie expirado
  // (5 min) ou navegador que o descartou. O link do e-mail continua válido,
  // porque nada foi consumido — basta abri-lo de novo.
  if (typeof tokenHash !== "string" || tokenHash.trim() === "") falharSemSessao();

  const supabase = await criarClienteServidor();

  // `type` fixo no código, não vindo de lugar nenhum. Convite, magic link e
  // troca de e-mail criariam sessão pelo mesmo `verifyOtp` sem que nada disso
  // tenha sido revisado neste fluxo.
  const { data, error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash,
  });

  // O `verifyOtp` em si falhou: nenhuma sessão nova foi criada, então não há o
  // que limpar. Sai direto.
  if (error || !data.session) falharSemSessao();

  /**
   * Daqui para baixo a sessão de recuperação JÁ EXISTE: o `verifyOtp` gravou
   * os cookies dela. Toda saída de falha precisa derrubá-la antes de
   * redirecionar — senão a tela diz "link inválido" e deixa o navegador
   * autenticado, que era o defeito apontado na revisão.
   *
   * Escopo `local`, não global: isto limpa a sessão de recuperação recém-criada
   * cujo processamento falhou. Derrubar as sessões legítimas do usuário em
   * outros dispositivos porque um segredo de servidor está ausente seria
   * castigar quem não tem culpa. O `signOut` global continua existindo, mas
   * pertence ao outro momento — depois da TROCA de senha bem-sucedida, em
   * `redefinir-senha/actions.ts`.
   */
  async function falharDepoisDeVerificar(): Promise<never> {
    await supabase.auth.signOut({ scope: "local" });
    falharSemSessao();
  }

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
    return falharDepoisDeVerificar();
  }

  // Coerência entre as duas leituras: o token verificado tem de descrever o
  // mesmo usuário que o servidor confirmou.
  if (sub !== user.id) return falharDepoisDeVerificar();

  /**
   * Situação do segundo fator, decidida ANTES de emitir a prova.
   *
   * A sessão que o `verifyOtp` acabou de criar é aal1. Se a conta tem TOTP
   * verificado, o Supabase recusa a troca de senha nela — `PUT /user` devolve
   * 401 "AAL2 session is required…". Descobrir isso aqui é o que permite mandar
   * o usuário ao desafio em vez de deixá-lo esbarrar no erro lá na frente.
   *
   * Falha na consulta não vira "não tem fator": `decidirSituacaoMfa` separa as
   * duas coisas, e `decidirMfaNaRecuperacao` fecha o caminho no erro.
   */
  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const decisaoMfa = decidirMfaNaRecuperacao(decidirSituacaoMfa(nivel ?? null, Boolean(erroNivel)));

  if (decisaoMfa === "falhar") return falharDepoisDeVerificar();

  const prova = await criarProvaDeRecuperacao({ sub, sessionId });

  // Sem segredo configurado não há prova possível. Falha fechada: é melhor o
  // fluxo parar aqui do que seguir para um formulário que não conseguiria
  // provar nada.
  if (!prova) return falharDepoisDeVerificar();

  apagarPendente();

  // `lax`, não `strict`: o fluxo nasce num link de e-mail, então a chegada a
  // /auth/confirm é uma navegação cross-site e os navegadores propagam essa
  // classificação pela cadeia de redirect. Com `strict` o cookie seria gravado
  // mas poderia não ser enviado na requisição seguinte a /redefinir-senha, e o
  // guard negaria um link legítimo. `lax` envia em navegação top-level GET —
  // exatamente este caso — e segue bloqueando subrequisição cross-site. Não
  // enfraquece nada: quem impede a forja é o HMAC, não o SameSite.
  //
  // O Path restringe o envio à única rota que lê a prova.
  armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA, prova, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ROTA_REDEFINIR_SENHA,
    maxAge: VALIDADE_DA_PROVA_EM_SEGUNDOS,
  });

  // Conta com TOTP verificado passa pelo desafio antes do formulário de senha;
  // conta sem fator vai direto, porque para ela o 401 do GoTrue não existe.
  //
  // Dois `redirect` em vez de um ternário: o `typedRoutes` valida cada rota
  // como literal, e uma união de literais não casa com o tipo esperado.
  if (decisaoMfa === "desafiar-mfa") redirect(ROTA_REDEFINIR_SENHA_MFA);

  redirect(ROTA_REDEFINIR_SENHA);
}
