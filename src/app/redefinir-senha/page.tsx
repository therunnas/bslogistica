import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { MolduraAuth } from "@/components/moldura-auth";
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
 * "Existe usuário autenticado" NÃO basta como porteiro. Uma sessão comum de
 * `signInWithPassword`, mesmo em aal1, também é autenticada, e o
 * `updateUser({ password })` aceitaria a troca — alguém já logado poderia abrir
 * esta rota direto e trocar a própria senha sem nunca ter passado por um link
 * de recuperação. Por isso o método de autenticação da sessão é verificado,
 * além da existência dela.
 *
 * As duas leituras são de servidor e validadas: `getUser` confere o token
 * contra o Supabase em vez de confiar no cookie, e `getClaims` devolve os
 * claims já verificados do JWT — nada aqui vem de dado não verificado do
 * cliente.
 *
 * A regra de decisão fica em `decidirAcessoRedefinicao`, testável à parte: o
 * AMR precisa conter explicitamente `recovery`. Qualquer outro método, claim
 * ausente ou malformado nega o acesso.
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

  // Sem sessão de recuperação não há o que redefinir. Volta para o começo do
  // fluxo em vez de mostrar um formulário que falharia no envio — ou, pior,
  // que aceitaria a troca vinda de uma sessão comum.
  if (decidirAcessoRedefinicao({ temUsuario: Boolean(user), amr: claims?.claims?.amr }) === "negar")
    redirect(ROTA_ESQUECI_SENHA);

  return (
    <MolduraAuth
      titulo="Definir nova senha"
      descricao="Escolha uma nova senha para a sua conta. Depois disso você entrará novamente."
    >
      <FormularioNovaSenha />
    </MolduraAuth>
  );
}
