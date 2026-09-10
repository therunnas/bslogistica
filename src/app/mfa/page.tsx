import { redirect } from "next/navigation";

import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { AcessoNaoLiberado } from "@/app/(painel)/_components/acesso-nao-liberado";
import { VerificacaoIndisponivel } from "@/app/(painel)/_components/verificacao-indisponivel";
import { PainelMfa } from "./painel-mfa";

/**
 * Tela do segundo fator.
 *
 * Fica fora do grupo (painel) de propósito: o layout de lá manda para cá quem
 * está sem AAL2, e se esta rota vivesse dentro dele o redirecionamento voltaria
 * para si mesmo em laço.
 *
 * A guarda aqui é a mesma do painel, com um caso a menos: exige sessão e papel,
 * mas não exige AAL2 — é justamente o que se vem obter. Quem já está com os
 * dois fatores não tem o que fazer nesta tela e volta para o painel.
 */
export default async function Mfa() {
  const acesso = await lerAcesso();

  if (acesso.situacao === "sem-sessao") redirect("/login");
  if (acesso.situacao === "sem-papel") return <AcessoNaoLiberado email={acesso.email} />;
  if (acesso.situacao === "liberado") redirect("/dashboard");

  // Sem saber o estado do fator, não se entra no fluxo: cadastrar por engano é
  // exatamente o que travava a conta que já tinha fator.
  if (acesso.situacao === "mfa-indisponivel")
    return <VerificacaoIndisponivel email={acesso.email} />;

  return <PainelMfa email={acesso.email} etapa={acesso.situacao} />;
}
