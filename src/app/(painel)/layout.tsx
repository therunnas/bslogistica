import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { lerAcesso } from "./_autorizacao";
import { resolverPapelEfetivo } from "./_papel";
import { AppShell } from "./_components/app-shell";
import { AcessoNaoLiberado } from "./_components/acesso-nao-liberado";
import { VerificacaoIndisponivel } from "./_components/verificacao-indisponivel";

/**
 * Layout das rotas protegidas.
 *
 * A verificação acontece no servidor, antes de qualquer HTML ser enviado: quem
 * não tem acesso não recebe nem a marcação da tela. Vale também para o segundo
 * fator, quando a conta tem um: sem o TOTP (sessão AAL1 de conta com fator verificado) o painel
 * não é renderizado, então não existe caminho de "esconder no cliente" a ser burlado desativando
 * JavaScript.
 *
 * Isto governa o que a interface mostra. A proteção real dos dados continua
 * sendo a RLS no banco.
 */
export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const acesso = await lerAcesso();

  if (acesso.situacao === "sem-sessao") redirect("/login");
  if (acesso.situacao === "sem-papel") return <AcessoNaoLiberado email={acesso.email} />;

  // Falha ao consultar o nível não é ausência de fator: manda para a tela de
  // "tente novamente", nunca para o cadastro. Fecha o painel de qualquer forma.
  if (acesso.situacao === "mfa-indisponivel")
    return <VerificacaoIndisponivel email={acesso.email} />;

  // Responder ao desafio do fator JÁ ATIVO acontece em /mfa, que fica fora deste layout justamente
  // para não ser barrada por ele. Conta SEM fator não passa por aqui (o segundo fator é opcional e
  // protege só o login) e entra em AAL1 com tudo do seu papel; nenhuma operação pede novo código.
  if (acesso.situacao === "mfa-pendente") redirect("/mfa");

  // O papel decide o que a navegação oferece. O que ela NÃO oferece continua
  // alcançável por URL, e é `exigirAdmin()`, em cada tela administrativa, que
  // fecha esse caminho no servidor.
  return (
    <AppShell email={acesso.email} papel={resolverPapelEfetivo(acesso.papeis)}>
      {children}
    </AppShell>
  );
}
