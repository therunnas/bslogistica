import { redirect } from "next/navigation";

import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { AcessoNaoLiberado } from "@/app/(painel)/_components/acesso-nao-liberado";
import { VerificacaoIndisponivel } from "@/app/(painel)/_components/verificacao-indisponivel";

import { PainelMfa } from "./painel-mfa";

/**
 * Tela do segundo fator.
 *
 * Fica fora do grupo (painel) de propósito: o layout de lá manda para cá quem
 * está sem AAL2. Se esta rota ficasse dentro dele, o redirecionamento poderia
 * voltar para a própria rota em loop.
 *
 * A guarda aqui exige sessão e papel, mas não exige AAL2, porque esta é
 * justamente a etapa responsável por obter o segundo fator.
 *
 * Quem já está com AAL2 não precisa permanecer nesta tela e segue
 * diretamente para o dashboard.
 */
export default async function Mfa() {
  const acesso = await lerAcesso();

  if (acesso.situacao === "sem-sessao") {
    redirect("/login");
  }

  if (acesso.situacao === "sem-papel") {
    return <AcessoNaoLiberado email={acesso.email} />;
  }

  if (acesso.situacao === "liberado") {
    redirect("/dashboard");
  }

  /**
   * Falha fechada.
   *
   * Sem conseguir determinar corretamente o estado do MFA,
   * não iniciamos configuração nem verificação de fator.
   */
  if (acesso.situacao === "mfa-indisponivel") {
    return <VerificacaoIndisponivel email={acesso.email} />;
  }

  return <PainelMfa email={acesso.email} etapa={acesso.situacao} />;
}
