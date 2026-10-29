import type { ReactNode } from "react";

import { lerAcesso } from "./_autorizacao";
import { ehAdmin } from "./_papel";
import { AcessoAdministrativoRestrito } from "./_components/acesso-administrativo-restrito";
import { ExigeSegundoFator } from "./_components/exige-segundo-fator";

/**
 * Guarda server-side das telas administrativas.
 *
 * Devolve `null` quando a sessão é de administrador, e a tela de restrição
 * quando não é. O uso é sempre o mesmo, e é o que mantém a decisão em um lugar
 * só:
 *
 *     const bloqueio = await exigirAdmin();
 *     if (bloqueio) return bloqueio;
 *
 * **Esconder o link não é proteção.** Sem esta chamada, o operacional que
 * digitasse `/faturamento` receberia o painel inteiro renderizado pelo
 * servidor — a navegação do `AppShell` só governa o que se vê, nunca o que se
 * alcança. Por isso o bloqueio acontece ANTES do componente administrativo
 * existir na árvore: nenhuma consulta dele chega a ser disparada.
 *
 * **Fecha em qualquer situação que não seja `liberado`.** O layout já redireciona
 * quem não tem sessão, papel ou segundo fator, mas layout e página renderizam na
 * mesma passada: confiar nisso seria confiar em ordem de execução. Aqui a
 * pergunta é direta — é admin com acesso liberado? —, e tudo o mais é não.
 *
 * `lerAcesso()` é memoizada por requisição, então chamá-la aqui e no layout não
 * duplica consulta ao Supabase. A memoização é por requisição e por natureza do
 * `cache` do React: nada de autorização atravessa usuários ou requisições.
 *
 * Isto governa o que a interface entrega. Quem protege os dados continua sendo a
 * RLS — em AAL1 as 11 policies `*_exige_aal2` recusam as tabelas de negócio, com
 * ou sem este arquivo.
 */
export async function exigirAdmin(): Promise<ReactNode | null> {
  const acesso = await lerAcesso();

  if (acesso.situacao !== "liberado" || !ehAdmin(acesso.papeis)) {
    return <AcessoAdministrativoRestrito />;
  }

  return null;
}

/**
 * O guard das telas CRÍTICAS (AUTH-01B): administração de usuários e implantação financeira.
 *
 * Como `exigirAdmin()`, mas exige AAL2 DE FATO. O segundo fator é opcional, então "liberado" já não
 * significa AAL2: conta sem fator trabalha em AAL1 e vê aqui a orientação de ativar o seu. Não
 * substitui a proteção real, que continua na Server Action (`exigirAdminAal2`) e no banco.
 */
export async function exigirAdminAal2Tela(): Promise<ReactNode | null> {
  const acesso = await lerAcesso();

  if (acesso.situacao !== "liberado" || !ehAdmin(acesso.papeis)) {
    return <AcessoAdministrativoRestrito />;
  }
  if (acesso.nivel !== "aal2") return <ExigeSegundoFator />;

  return null;
}
