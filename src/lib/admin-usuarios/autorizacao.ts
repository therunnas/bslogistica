/**
 * A porta de entrada de toda ação administrativa crítica (usuários, papéis, motor financeiro).
 *
 * AUTH-01B: o segundo fator é OPCIONAL, então "liberado" já não implica AAL2 — conta sem fator
 * trabalha em AAL1. Por isso esta porta exige o `nivel === "aal2"` explicitamente: operação crítica
 * continua pedindo um fator verificado, e quem não tem um recebe a orientação de ativar em
 * Configurações > Segurança. A decisão de nível continua vindo de `lerAcesso()`, sem duplicá-la.
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
 * Lança se quem chama não é admin liberado EM AAL2. Admin liberado em AAL1 (conta sem fator) não
 * passa: operação crítica exige o segundo fator. Nunca aceitar um `userId` alternativo por
 * parâmetro: a identidade de quem autoriza é sempre a da sessão corrente.
 */
export async function exigirAdminAal2(): Promise<AtorAdministrativo> {
  const acesso = await lerAcesso();

  if (acesso.situacao !== "liberado" || acesso.nivel !== "aal2" || !ehAdmin(acesso.papeis)) {
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
