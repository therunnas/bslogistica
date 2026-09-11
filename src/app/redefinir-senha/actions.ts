"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { NOME_DO_COOKIE_DE_PROVA, validarProvaDeRecuperacao } from "@/lib/prova-recuperacao";
import {
  MENSAGEM_FALHA_AO_TROCAR,
  MENSAGEM_RECUPERACAO_INVALIDA,
  MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS,
  ROTA_LOGIN_SENHA_REDEFINIDA,
  ROTA_REDEFINIR_SENHA,
  decidirTrocaDeSenha,
  traduzirErroDeSenha,
  validarNovaSenha,
} from "@/lib/recuperacao-senha";

export type EstadoDaTroca =
  | { situacao: "erro"; mensagem: string }
  /**
   * A senha FOI alterada, mas a revogação global das sessões falhou. Situação
   * própria porque não é erro: tratar como erro faria a tela mentir sobre o
   * que aconteceu e convidaria a uma segunda tentativa inútil.
   */
  | { situacao: "senha-alterada-sessoes-ativas"; mensagem: string };

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

  const { error } = await supabase.auth.updateUser({ password: senha });

  if (error) {
    // Nunca `error.message`: texto livre do GoTrue, em inglês, às vezes com
    // detalhe de implementação. Traduzido pelo código estável.
    return { situacao: "erro", mensagem: traduzirErroDeSenha(error.code) };
  }

  /**
   * A prova morre em todo caminho a partir daqui, com ou sem sucesso do
   * `signOut`. Depois que a senha muda, a prova não autoriza mais nada que o
   * usuário deva querer — e deixá-la viva foi o achado desta rodada: o
   * caminho de falha do `signOut` saía antes desta limpeza, deixando prova e
   * sessão de recuperação de pé por até 10 minutos.
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

  // Ordem obrigatória: a senha já mudou, então agora a sessão de recuperação
  // cai. Escopo global, que derruba também as demais sessões da conta — o
  // comportamento desejado depois de uma troca de senha.
  const { error: erroAoSair } = await supabase.auth.signOut();

  if (erroAoSair) {
    /**
     * A revogação global não respondeu — rede, indisponibilidade do Auth. A
     * senha, porém, JÁ mudou: este não é um caminho de erro, é um sucesso
     * parcial, e o usuário precisa ouvir isso.
     *
     * Resta fazer o que não depende da rede remota: derrubar a sessão local.
     * `try` porque nem esse passo pode impedir a limpeza da prova — se o
     * `signOut` local também falhar, o cookie tem de morrer do mesmo jeito.
     * Cookies internos `sb-*` seguem intocados: manipulá-los à mão acoplaria a
     * aplicação a detalhe de implementação do SDK.
     */
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignorado de propósito: a limpeza da prova, abaixo, é o que não pode
      // deixar de acontecer.
    }

    apagarProva();

    return {
      situacao: "senha-alterada-sessoes-ativas",
      mensagem: MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS,
    };
  }

  apagarProva();

  redirect(ROTA_LOGIN_SENHA_REDEFINIDA);
}
