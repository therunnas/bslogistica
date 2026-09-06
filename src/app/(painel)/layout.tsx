import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { lerAcesso } from "./_autorizacao";
import { AppShell } from "./_components/app-shell";
import { AcessoNaoLiberado } from "./_components/acesso-nao-liberado";

/**
 * Layout das rotas protegidas.
 *
 * A verificação acontece no servidor, antes de qualquer HTML ser enviado: quem
 * não tem acesso não recebe nem a marcação da tela. Vale também para o segundo
 * fator — sem AAL2 o painel não é renderizado, então não existe caminho de
 * "esconder no cliente" a ser burlado desativando JavaScript.
 *
 * Isto governa o que a interface mostra. A proteção real dos dados continua
 * sendo a RLS no banco.
 */
export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const acesso = await lerAcesso();

  if (acesso.situacao === "sem-sessao") redirect("/login");
  if (acesso.situacao === "sem-papel") return <AcessoNaoLiberado email={acesso.email} />;

  // Cadastrar o primeiro fator e responder ao desafio acontecem na mesma tela,
  // que fica fora deste layout justamente para não ser barrada por ele.
  if (acesso.situacao === "mfa-ausente" || acesso.situacao === "mfa-pendente") redirect("/mfa");

  return <AppShell email={acesso.email}>{children}</AppShell>;
}
