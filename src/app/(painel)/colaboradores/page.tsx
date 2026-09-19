import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelColaboradores } from "./painel-colaboradores";

export const metadata: Metadata = {
  title: "Colaboradores",
  description: "Cadastro de colaboradores com função, contato e custo por diária.",
  openGraph: {
    title: "Colaboradores | BS Logística",
    description: "Cadastro de equipe e custo por diária.",
  },
};

export default async function Colaboradores() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelColaboradores />;
}
