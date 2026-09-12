"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { NOME_DO_COOKIE_DE_PROVA, validarProvaDeRecuperacao } from "@/lib/prova-recuperacao";
import { decidirMfaNaRecuperacao, decidirSituacaoMfa } from "@/lib/mfa";
import {
  MENSAGEM_FALHA_AO_TROCAR,
  MENSAGEM_MFA_EXIGIDO,
  MENSAGEM_MFA_INDISPONIVEL,
  MENSAGEM_RECUPERACAO_INVALIDA,
  ROTA_DASHBOARD,
  ROTA_LOGIN_SENHA_REDEFINIDA,
  ROTA_LOGIN_SESSOES_ATIVAS,
  ROTA_REDEFINIR_SENHA,
  decidirTrocaDeSenha,
  traduzirErroDeSenha,
  validarNovaSenha,
} from "@/lib/recuperacao-senha";

/**
 * Só o erro volta para o formulário.
 *
 * O desfecho parcial — senha trocada, sessões não encerradas — não é erro e
 * também não volta: ele redireciona para o login com aviso próprio. Represente
 * isso como estado faria o formulário continuar montado depois de a senha já
 * ter mudado, que é o beco sem saída apontado em revisão.
 */
export type EstadoDaTroca = { situacao: "erro"; mensagem: string };

/**
 * Troca de senha, no servidor.
 *
 * POR QUE NÃO É MAIS NO NAVEGADOR
 *
 * O formulário chamava `updateUser` direto do cliente. A prova era conferida
 * só na renderização da página, então bastava deixar a aba aberta: passados os
 * 10 minutos, a prova expirava mas o envio continuava funcionando, porque ia
 * direto ao Supabase com a sessão ainda válida. O `exp` limitava a abertura da
 * página, não a troca da senha.
 *
 * Agora o envio é uma NOVA decisão de autorização. Nada do que o Server
 * Component decidiu antes é reaproveitado: usuário, claims e prova são lidos
 * de novo, no instante do envio, com o relógio daquele instante.
 *
 * LIMITE DA GARANTIA — conhecido e aceito
 *
 * A revalidação garante a janela de 10 minutos para o fluxo oficial da
 * aplicação. Ela NÃO encurta a sessão do Supabase nem remove o fato de que um
 * usuário autenticado tem, pela própria API do Supabase Auth, capacidades que
 * não passam por aqui. A barreira de acesso aos dados do painel continua sendo
 * papel, MFA/AAL2 e RLS. Resolver isso não é escopo desta etapa.
 */
export async function redefinirSenha(entrada: {
  senha: unknown;
  confirmacao: unknown;
}): Promise<EstadoDaTroca> {
  // O cliente já valida para dar retorno rápido, mas essa validação é de UX e
  // não vale como garantia: a action é um ponto de entrada próprio e precisa
  // recusar entrada malformada por conta própria.
  const senha = typeof entrada?.senha === "string" ? entrada.senha : "";
  const confirmacao = typeof entrada?.confirmacao === "string" ? entrada.confirmacao : "";
  const validacao = validarNovaSenha(senha, confirmacao);

  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims?.session_id;

  const armazemDeCookies = await cookies();
  const provaBruta = armazemDeCookies.get(NOME_DO_COOKIE_DE_PROVA)?.value;

  const resultadoDaProva =
    user && typeof sessionId === "string"
      ? await validarProvaDeRecuperacao(provaBruta, { sub: user.id, sessionId })
      : "ausente";

  const decisao = decidirTrocaDeSenha({
    temUsuario: Boolean(user),
    temClaims: typeof sessionId === "string",
    resultadoDaProva,
    senhaValida: validacao.valida,
  });

  // Mensagem pública única para qualquer falha de autorização. O motivo real
  // — assinatura, expiração, sub ou sessão divergente — fica no servidor.
  if (decisao === "recuperacao-invalida") {
    return { situacao: "erro", mensagem: MENSAGEM_RECUPERACAO_INVALIDA };
  }

  if (decisao === "senha-invalida") {
    return {
      situacao: "erro",
      mensagem: validacao.valida ? MENSAGEM_FALHA_AO_TROCAR : validacao.mensagem,
    };
  }

  /**
   * Segundo fator revalidado no instante do envio, antes do `updateUser`.
   *
   * A página já decidiu isto ao renderizar, mas a decisão não é reaproveitada:
   * entre abrir a tela e enviar o formulário a sessão pode ter mudado. E o
   * `updateUser` é justamente o ponto onde o Supabase recusa aal1 quando a
   * conta tem MFA — chegar nele sem checar devolveria um 401 cru ao usuário.
   */
  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const decisaoMfa = decidirMfaNaRecuperacao(decidirSituacaoMfa(nivel ?? null, Boolean(erroNivel)));

  if (decisaoMfa === "desafiar-mfa") {
    return { situacao: "erro", mensagem: MENSAGEM_MFA_EXIGIDO };
  }

  if (decisaoMfa === "falhar") {
    return { situacao: "erro", mensagem: MENSAGEM_MFA_INDISPONIVEL };
  }

  const { error } = await supabase.auth.updateUser({ password: senha });

  if (error) {
    // Nunca `error.message`: texto livre do GoTrue, em inglês, às vezes com
    // detalhe de implementação. Traduzido pelo código estável.
    return { situacao: "erro", mensagem: traduzirErroDeSenha(error.code) };
  }

  /**
   * A prova morre assim que a senha muda, antes de qualquer chamada remota que
   * possa falhar. Depois da troca ela não autoriza mais nada que o usuário deva
   * querer, e um caminho de falha que saísse antes desta limpeza a deixaria
   * viva por até 10 minutos — foi um achado de revisão.
   *
   * Mesmo Path do `Set-Cookie` original, senão o navegador não casa o cookie a
   * remover.
   */
  function apagarProva() {
    armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: ROTA_REDEFINIR_SENHA,
      maxAge: 0,
    });
  }

  apagarProva();

  /** Limpeza local best-effort. Nunca impede o que vem depois. */
  async function derrubarSessaoLocal() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignorado de propósito: cookies internos `sb-*` seguem intocados —
      // manipulá-los à mão acoplaria a aplicação a detalhe do SDK.
    }
  }

  /**
   * Revoga as OUTRAS sessões e preserva esta.
   *
   * POR QUE NÃO É MAIS `signOut()` GLOBAL
   *
   * O global derrubava também a sessão atual, que a esta altura já provou
   * posse do link, prova HMAC, TOTP e está em aal2. O usuário caía no login e
   * era obrigado a informar o mesmo TOTP de novo, no mesmo processo. Com
   * `scope: "others"` o objetivo real da troca de senha — expulsar sessões
   * antigas — é cumprido sem essa segunda cobrança.
   *
   * `others` está declarado em `@supabase/auth-js` 2.115.0
   * (`SIGN_OUT_SCOPES = ['global','local','others']`) e a implementação só
   * remove a sessão local quando o escopo NÃO é `others`.
   *
   * LIMITE CONHECIDO, e que já existia antes
   *
   * Isto revoga as refresh sessions das outras. Access tokens JWT já emitidos
   * em outros dispositivos continuam válidos até expirarem — são stateless.
   * O `signOut` global tinha exatamente a mesma limitação: nenhum escopo
   * invalida um JWT já emitido. Não é regressão desta mudança e não é escopo
   * desta etapa.
   */
  const { error: erroAoSair } = await supabase.auth.signOut({ scope: "others" });

  if (erroAoSair) {
    /**
     * A revogação não respondeu — rede, indisponibilidade do Auth. A senha JÁ
     * mudou: não é caminho de erro, é sucesso parcial. Com outras sessões
     * possivelmente vivas, não se entra no painel; cai no comportamento
     * anterior, que avisa o usuário.
     */
    await derrubarSessaoLocal();

    /**
     * Sai desta tela, em vez de devolver estado para o formulário.
     *
     * Devolver estado deixava o usuário preso: a senha já mudou, então o
     * formulário não serve mais para nada, e um F5 aqui cairia em
     * /esqueci-senha — porque a prova acabou de ser apagada — dizendo "link
     * inválido" a quem tinha acabado de ter sucesso.
     *
     * O destino é próprio, e não o sucesso normal: `sessoes-ativas=1` troca a
     * mensagem do login e impede o auto-redirect para o painel.
     */
    redirect(ROTA_LOGIN_SESSOES_ATIVAS);
  }

  /**
   * Revalidação antes de entrar no painel.
   *
   * Nada aqui aposta em como o GoTrue trata a sessão atual depois de uma troca
   * de senha. O SDK não substitui os tokens no `updateUser` — a mesma sessão é
   * regravada com o usuário novo —, mas o servidor é livre para invalidá-la, e
   * isso não é verificável sem tráfego real. Então o estado é CONFERIDO, não
   * presumido: se qualquer peça não confirmar, o fluxo cai no comportamento
   * anterior e o usuário entra pelo login.
   *
   * `getUser` valida o token contra o Supabase; ler o cookie não provaria nada.
   */
  const {
    data: { user: usuarioDepois },
  } = await supabase.auth.getUser();

  const { data: nivelDepois, error: erroNivelDepois } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  /**
   * O usuário precisa ser o MESMO de antes da troca.
   *
   * Uma sessão que sobrevive apontando para outro `sub` seria estado absurdo,
   * e entrar no painel com ela daria acesso à conta errada. Comparar é barato;
   * confiar, não.
   */
  const mesmoUsuario = Boolean(usuarioDepois) && usuarioDepois?.id === user!.id;
  const continuaEmAal2 = !erroNivelDepois && nivelDepois?.currentLevel === "aal2";

  if (!mesmoUsuario || !continuaEmAal2) {
    // Fallback seguro, idêntico ao comportamento anterior a esta mudança: não
    // se tenta reconstruir sessão nenhuma, o usuário entra pelo login.
    await derrubarSessaoLocal();
    redirect(ROTA_LOGIN_SENHA_REDEFINIDA);
  }

  /**
   * Senha trocada, prova morta, outras sessões revogadas, mesmo usuário e
   * sessão ainda em aal2. O segundo fator já foi cobrado neste mesmo fluxo, em
   * `/redefinir-senha/mfa` — pedir de novo agora seria fricção sem ganho.
   *
   * Nenhum bypass: o guard do painel continua decidindo sessão, papel e AAL2, e
   * a RLS continua protegendo os dados.
   */
  redirect(ROTA_DASHBOARD);
}
