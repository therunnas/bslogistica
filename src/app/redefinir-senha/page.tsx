import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { MolduraAuth } from "@/components/moldura-auth";
import { NOME_DO_COOKIE_DE_PROVA, validarProvaDeRecuperacao } from "@/lib/prova-recuperacao";
import { ROTA_ESQUECI_SENHA, decidirAcessoRedefinicao } from "@/lib/recuperacao-senha";

import { FormularioNovaSenha } from "./formulario-nova-senha";

/**
 * Definição da nova senha.
 *
 * Fica FORA de (painel) de propósito. O layout do painel exige papel e AAL2, e
 * quem chega aqui tem apenas a sessão de recuperação criada em /auth/confirm —
 * seria barrado antes de conseguir trocar a senha.
 *
 * Isso não afrouxa o painel. Esta rota não renderiza dado de negócio, não
 * consulta tabela nenhuma e não dá acesso a nada além do próprio
 * `auth.updateUser`. O painel continua atrás do guard completo, e a RLS segue
 * valendo para tudo que for dado.
 *
 * O PORTEIRO
 *
 * "Existe usuário autenticado" não basta: uma sessão comum de
 * `signInWithPassword`, mesmo em aal1, também é autenticada, e o
 * `updateUser({ password })` aceitaria a troca. Por isso são três exigências
 * simultâneas, todas no servidor:
 *
 * 1. `getUser()` — valida o token contra o Supabase, não confia no cookie;
 * 2. `getClaims()` — claims verificados do JWT, de onde sai o `session_id`;
 * 3. a prova assinada em `bs_recovery_proof` — íntegra, no prazo, com
 *    `purpose` correto e amarrada a este `sub` e a este `session_id`.
 *
 * A origem da sessão NÃO é mais deduzida do AMR. O `verifyOtp({ type:
 * "recovery" })` cria a sessão como `models.OTP`, então `recovery` nunca
 * aparece ali; quem prova a origem é a assinatura emitida em /auth/confirm.
 *
 * Sem o segredo do servidor ninguém fabrica a prova mandando um Cookie.
 *
 * ALCANCE DESTE GUARD — limite conhecido e aceito
 *
 * Ele protege o fluxo da aplicação, não a API do Supabase. O Supabase Auth
 * permite `updateUser` para qualquer usuário autenticado, então este guard não
 * impede que alguém com sessão válida chame a API diretamente. A barreira
 * principal contra acesso ao painel continua sendo o guard de papel e AAL2, e a
 * proteção dos dados continua sendo a RLS. Nada disso é escopo desta etapa.
 */
export default async function RedefinirSenha() {
  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims?.session_id;

  const armazemDeCookies = await cookies();
  const provaBruta = armazemDeCookies.get(NOME_DO_COOKIE_DE_PROVA)?.value;

  // A validação recebe o que o servidor confirmou, não o que o cookie afirma:
  // a prova só vale se apontar para ESTE usuário e ESTA sessão.
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

  return (
    <MolduraAuth
      titulo="Definir nova senha"
      descricao="Escolha uma nova senha para a sua conta. Depois disso você entrará novamente."
    >
      <FormularioNovaSenha />
    </MolduraAuth>
  );
}
