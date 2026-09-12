import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { MolduraAuth } from "@/components/moldura-auth";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { decidirMfaNaRecuperacao, decidirSituacaoMfa } from "@/lib/mfa";
import { NOME_DO_COOKIE_DE_PROVA, validarProvaDeRecuperacao } from "@/lib/prova-recuperacao";
import {
  MENSAGEM_MFA_INDISPONIVEL,
  MENSAGEM_MFA_RECUPERACAO,
  ROTA_ESQUECI_SENHA,
  ROTA_REDEFINIR_SENHA,
  TITULO_MFA_RECUPERACAO,
  decidirAcessoRedefinicao,
} from "@/lib/recuperacao-senha";

import { FormularioMfaRecuperacao } from "./formulario-mfa";

export const metadata: Metadata = {
  title: TITULO_MFA_RECUPERACAO,
  robots: { index: false, follow: false },
};

/**
 * Segundo fator dentro da recuperação de senha.
 *
 * Fica sob `/redefinir-senha` porque o cookie `bs_recovery_proof` é emitido com
 * `Path=/redefinir-senha`, que pela RFC 6265 §5.1.4 cobre a subárvore. Uma rota
 * irmã não receberia a prova, e ampliar o cookie para `Path=/` entregaria a
 * prova à aplicação inteira para resolver um problema de roteamento.
 *
 * O PORTEIRO, igual ao de `/redefinir-senha`
 *
 * Usuário confirmado contra o Supabase, claims verificados e prova íntegra,
 * amarrada a este `sub` e a este `session_id`. Sem os três, nada é renderizado.
 * Isto é o que impede a tela de virar um elevador de aal1 para aal2 aberto a
 * qualquer sessão autenticada.
 *
 * Esta página decide o que mostrar; a Server Action revalida tudo de novo no
 * POST, porque o estado pode mudar entre renderizar e enviar.
 *
 * NUNCA cadastra fator, nunca remove, nunca exibe QR, nunca leva ao painel.
 */
export default async function MfaDaRecuperacao() {
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

  const acesso = decidirAcessoRedefinicao({
    temUsuario: Boolean(user),
    temClaims: typeof sessionId === "string",
    resultadoDaProva,
  });

  if (acesso === "negar") redirect(ROTA_ESQUECI_SENHA);

  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const decisao = decidirMfaNaRecuperacao(decidirSituacaoMfa(nivel ?? null, Boolean(erroNivel)));

  // Falha fechada: não saber se há fator não é o mesmo que não haver. Seguir
  // daria o 401 do GoTrue na troca da senha, sem explicação para o usuário.
  if (decisao === "falhar") {
    return (
      <MolduraAuth titulo={TITULO_MFA_RECUPERACAO} descricao={MENSAGEM_MFA_INDISPONIVEL}>
        <p className="text-sm text-muted-foreground">
          Recarregue a página em instantes. Se o problema continuar, solicite um novo link de
          recuperação.
        </p>
      </MolduraAuth>
    );
  }

  // Conta sem fator, ou sessão que já é aal2: não há desafio a fazer.
  if (decisao === "prosseguir") redirect(ROTA_REDEFINIR_SENHA);

  return (
    <MolduraAuth titulo={TITULO_MFA_RECUPERACAO} descricao={MENSAGEM_MFA_RECUPERACAO}>
      <FormularioMfaRecuperacao />
    </MolduraAuth>
  );
}
