import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { lerAcesso } from "./_autorizacao";
import { AppShell } from "./_components/app-shell";
import { AcessoNaoLiberado } from "./_components/acesso-nao-liberado";

/**
 * Layout das rotas protegidas.
 *
 * A verificação acontece no servidor, antes de qualquer HTML ser enviado. É a
 * diferença em relação ao guard da aplicação TanStack, que rodava só depois do
 * JavaScript carregar no navegador: aqui quem não tem acesso não recebe nem a
 * marcação da tela.
 *
 * Isto governa o que a interface mostra. A proteção real dos dados continua
 * sendo a RLS no banco.
 */
export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const acesso = await lerAcesso();

  if (acesso.situacao === "sem-sessao") redirect("/login");
  if (acesso.situacao === "sem-papel") return <AcessoNaoLiberado email={acesso.email} />;

  return <AppShell email={acesso.email}>{children}</AppShell>;
}
