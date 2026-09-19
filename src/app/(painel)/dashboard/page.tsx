import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { lerAcesso } from "../_autorizacao";
import { exigirAdmin } from "../_exigir-admin";
import { resolverPapelEfetivo } from "../_papel";
import { PainelDashboard } from "./painel-dashboard";

export const metadata: Metadata = {
  title: "Dashboard operacional",
  description: "Diárias, horas extras, receita, custo e margem do período por cliente e operação.",
  openGraph: {
    title: "Dashboard operacional | BS Logística",
    description: "Indicadores de diárias, horas extras, receita, custo e margem por período.",
  },
};

/**
 * O destino pós-autenticação, e o único lugar que decide para onde cada papel
 * vai.
 *
 * Login, tela de MFA e recuperação de senha mandam todo mundo para cá — o login
 * é componente de cliente e não tem como saber o papel. Em vez de espalhar a
 * decisão pelos quatro caminhos, ela mora aqui, no servidor, onde o papel já é
 * conhecido: administrador fica, operacional segue para a área dele.
 *
 * `exigirAdmin()` continua logo abaixo, e não é redundância. O redirecionamento
 * cuida de quem chegou aqui por inércia; o guard cuida de quem digitou o
 * endereço — e fecha também as situações que não são `liberado`, em que não há
 * papel nenhum para rotear.
 */
export default async function Dashboard() {
  const acesso = await lerAcesso();

  if (acesso.situacao === "liberado" && resolverPapelEfetivo(acesso.papeis) === "operacional") {
    redirect("/operacional");
  }

  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelDashboard />;
}
