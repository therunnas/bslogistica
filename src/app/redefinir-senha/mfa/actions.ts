"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { decidirMfaNaRecuperacao, decidirSituacaoMfa } from "@/lib/mfa";
import {
  NOME_DO_COOKIE_DE_PROVA,
  lerExpAutenticado,
  reemitirProvaDeRecuperacao,
} from "@/lib/prova-recuperacao";
import {
  MENSAGEM_MFA_INDISPONIVEL,
  MENSAGEM_MFA_RECUPERACAO_INVALIDA,
  MENSAGEM_RECUPERACAO_INVALIDA,
  ROTA_ESQUECI_SENHA_LINK_INVALIDO,
  ROTA_REDEFINIR_SENHA,
} from "@/lib/recuperacao-senha";

export type EstadoDoDesafio = { situacao: "erro"; mensagem: string };

/**
 * Segundo fator dentro da recuperação de senha.
 *
 * POR QUE ESTA ACTION EXISTE
 *
 * O `verifyOtp({ type: "recovery" })` cria a sessão em aal1. Quando a conta tem
 * TOTP verificado, o Supabase recusa a troca de senha nessa sessão: `PUT /user`
 * devolve 401 "AAL2 session is required to update email or password when MFA is
 * enabled". A resposta certa é satisfazer o fator, nunca contorná-lo — daí este
 * desafio, entre a confirmação do link e o formulário de nova senha.
 *
 * O QUE ELA NUNCA FAZ
 *
 * - não cadastra fator (`enroll`): recuperação de senha não é lugar de criar
 *   segundo fator. Quem não tem MFA nem chega aqui;
 * - não remove fator (`unenroll`);
 * - não exibe QR nem segredo;
 * - não leva ao painel. O único destino de sucesso é `/redefinir-senha`.
 *
 * A TRAVA QUE SUSTENTA TUDO
 *
 * A prova é revalidada aqui, no instante do POST — não se confia na validação
 * que a página fez ao renderizar. Sem isso, esta action seria um elevador de
 * aal1 para aal2 aberto a qualquer sessão autenticada, incluindo uma nascida de
 * `signInWithPassword`. A prova é o que amarra a elevação à recuperação.
 *
 * Nada de código TOTP, segredo de fator, prova ou token é registrado em log.
 */
export async function confirmarSegundoFator(entrada: {
  codigo: unknown;
  factorId?: unknown;
}): Promise<EstadoDoDesafio> {
  const codigo = typeof entrada?.codigo === "string" ? entrada.codigo.trim() : "";
  const factorIdInformado = typeof entrada?.factorId === "string" ? entrada.factorId : null;

  const supabase = await criarClienteServidor();
  const armazemDeCookies = await cookies();

  function negar(): EstadoDoDesafio {
    return { situacao: "erro", mensagem: MENSAGEM_RECUPERACAO_INVALIDA };
  }

  // 1. Sessão real, confirmada contra o Supabase — não o que o cookie afirma.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims?.session_id;

  if (!user || typeof sessionId !== "string") return negar();

  /**
   * 2. Prova revalidada AGORA, e o `exp` autenticado extraído dela.
   *
   * O prazo precisa ser lido aqui, antes do desafio, porque é aqui que ainda se
   * conhece o `session_id` a que a prova está amarrada. Depois do
   * `challengeAndVerify` o token é trocado, e se o `session_id` mudar a prova
   * antiga não valida mais contra nada.
   */
  const provaAtual = armazemDeCookies.get(NOME_DO_COOKIE_DE_PROVA)?.value;
  const autenticada = await lerExpAutenticado(provaAtual, { sub: user.id, sessionId });

  if (autenticada.situacao !== "valida") return negar();

  // 3. Situação do fator, revalidada no instante do POST.
  const { data: nivelAntes, error: erroNivelAntes } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const decisao = decidirMfaNaRecuperacao(
    decidirSituacaoMfa(nivelAntes ?? null, Boolean(erroNivelAntes)),
  );

  if (decisao === "falhar") {
    return { situacao: "erro", mensagem: MENSAGEM_MFA_INDISPONIVEL };
  }

  // Já em aal2, ou conta sem fator: não há desafio a fazer aqui.
  if (decisao === "prosseguir") redirect(ROTA_REDEFINIR_SENHA);

  if (codigo === "") {
    return { situacao: "erro", mensagem: MENSAGEM_MFA_RECUPERACAO_INVALIDA };
  }

  /**
   * 4. O fator é escolhido no SERVIDOR, entre os já verificados da conta.
   *
   * `listFactors` devolve em `totp` apenas os verificados. Um `factorId` vindo
   * do formulário só é aceito se constar dessa lista — nunca é usado como veio.
   * Com um único fator, o cliente nem precisa informar nada.
   */
  const { data: fatores, error: erroFatores } = await supabase.auth.mfa.listFactors();

  if (erroFatores || !fatores) {
    return { situacao: "erro", mensagem: MENSAGEM_MFA_INDISPONIVEL };
  }

  const verificados = fatores.totp;
  if (verificados.length === 0) {
    // O nível disse que havia fator e a lista não trouxe nenhum. Incoerência:
    // não é caso de cadastrar por conta própria.
    return { situacao: "erro", mensagem: MENSAGEM_MFA_INDISPONIVEL };
  }

  const fator = factorIdInformado
    ? verificados.find((f) => f.id === factorIdInformado)
    : verificados[0];

  if (!fator) return negar();

  const { error: erroDesafio } = await supabase.auth.mfa.challengeAndVerify({
    factorId: fator.id,
    code: codigo,
  });

  if (erroDesafio) {
    // Mensagem única: código errado e código expirado não se distinguem para
    // quem está do lado de fora.
    return { situacao: "erro", mensagem: MENSAGEM_MFA_RECUPERACAO_INVALIDA };
  }

  // 5. Confirma que a sessão realmente subiu. Sucesso do desafio sem aal2 seria
  //    estado inesperado, e seguir daria o mesmo 401 na troca da senha.
  const { data: nivelDepois, error: erroNivelDepois } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (erroNivelDepois || nivelDepois?.currentLevel !== "aal2") {
    return { situacao: "erro", mensagem: MENSAGEM_MFA_INDISPONIVEL };
  }

  // 6. Claims pós-MFA: o token foi trocado, então o `session_id` é relido.
  const {
    data: { user: userDepois },
  } = await supabase.auth.getUser();

  const { data: claimsDepois } = await supabase.auth.getClaims();
  const sessionIdDepois = claimsDepois?.claims?.session_id;

  if (!userDepois || typeof sessionIdDepois !== "string") return negar();

  /**
   * 7. Prova reemitida para a sessão de agora, herdando o prazo original.
   *
   * Se o `session_id` não mudou, isto é inócuo. Se mudou, é o que impede o
   * usuário de ser barrado logo depois de acertar o código. O `exp` vem de
   * `lerExpAutenticado`, então a janela não reinicia: o cookie recebe apenas o
   * tempo que restava.
   */
  const reemissao = await reemitirProvaDeRecuperacao({
    sub: userDepois.id,
    sessionId: sessionIdDepois,
    expOriginal: autenticada.exp,
  });

  if (reemissao.situacao !== "reemitida") return negar();

  armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA, reemissao.prova, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ROTA_REDEFINIR_SENHA,
    maxAge: reemissao.segundosRestantes,
  });

  redirect(ROTA_REDEFINIR_SENHA);
}

/** Saída de falha dura: apaga a prova e devolve ao início da recuperação. */
export async function abandonarRecuperacao() {
  const armazemDeCookies = await cookies();
  armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ROTA_REDEFINIR_SENHA,
    maxAge: 0,
  });
  redirect(ROTA_ESQUECI_SENHA_LINK_INVALIDO);
}
