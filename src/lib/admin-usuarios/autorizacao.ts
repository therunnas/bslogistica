/**
 * A porta de entrada de toda ação administrativa (usuários, papéis, motor financeiro, implantação).
 *
 * AUTH-01D.R1: o segundo fator protege só o LOGIN, então esta porta confere apenas o que o servidor
 * pode e deve conferir sempre: sessão válida, acesso liberado por `lerAcesso()` (o que já barra uma
 * sessão AAL1 de conta com fator verificado, que fica em `mfa-pendente`) e papel `admin`. Não há mais
 * exigência de AAL2 por operação; a barreira de dados continua sendo o banco (RLS, `has_role()`,
 * `mfa_cotidiano_ok()`).
 *
 * Por que não reaproveitar `exigirAdmin()` (o guard de `_exigir-admin.tsx`):
 * ele devolve `ReactNode | null`, pensado para telas. Toda Server Action deste
 * módulo precisa do `userId` de quem está agindo — para `actor_id` da
 * auditoria e para nunca aceitar um `user_id` vindo do cliente como a
 * identidade de quem autoriza —, e `Acesso` não carrega isso. Em vez de
 * alterar aquele tipo compartilhado por telas e testes já existentes
 * (`test:papel`), este módulo faz sua própria leitura mínima de identidade.
 */

import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { ehAdmin } from "@/app/(painel)/_papel";
import { criarClienteServidor } from "@/integrations/supabase/server";

export class ErroDeAutorizacaoAdministrativa extends Error {
  constructor(mensagem = "Acesso administrativo exigido (papel admin com acesso liberado).") {
    super(mensagem);
    this.name = "ErroDeAutorizacaoAdministrativa";
  }
}

export interface AtorAdministrativo {
  id: string;
  email: string;
}

/**
 * Lança se quem chama não é admin com acesso liberado. Nunca aceitar um `userId` alternativo por
 * parâmetro: a identidade de quem autoriza é sempre a da sessão corrente.
 */
export async function exigirAdminAtor(): Promise<AtorAdministrativo> {
  const acesso = await lerAcesso();

  if (acesso.situacao !== "liberado" || !ehAdmin(acesso.papeis)) {
    throw new ErroDeAutorizacaoAdministrativa();
  }

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Defensivo: `lerAcesso() === "liberado"` já implica sessão válida. Cai
    // aqui só se a sessão expirar entre as duas chamadas — janela real, ainda
    // que estreita.
    throw new ErroDeAutorizacaoAdministrativa();
  }

  return { id: user.id, email: acesso.email };
}
