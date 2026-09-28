/**
 * A porta de entrada de toda ação administrativa de usuários.
 *
 * `lerAcesso()` (`src/app/(painel)/_autorizacao.ts`) já decide "liberado" de
 * um jeito que, para o papel `admin`, SEMPRE implica AAL2 — a tabela de
 * `_autorizacao.ts` não tem uma linha `admin` + `aal1` + `liberado`. Então
 * checar `situacao === "liberado" && ehAdmin(papeis)` aqui É checar
 * admin+AAL2, sem duplicar a decisão de nível de garantia.
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
  constructor(mensagem = "Acesso administrativo exigido (papel admin, sessão em AAL2).") {
    super(mensagem);
    this.name = "ErroDeAutorizacaoAdministrativa";
  }
}

export interface AtorAdministrativo {
  id: string;
  email: string;
}

/**
 * Lança se quem chama não é admin com acesso `liberado` (o que, para admin,
 * é sempre AAL2). Nunca aceitar um `userId` alternativo por parâmetro: a
 * identidade de quem autoriza é sempre a da sessão corrente.
 */
export async function exigirAdminAal2(): Promise<AtorAdministrativo> {
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
