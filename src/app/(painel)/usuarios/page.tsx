import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelUsuarios } from "./painel-usuarios";

export const metadata: Metadata = {
  title: "Usuários",
  description: "Convite, papel e acesso de contas administrativas e operacionais.",
  openGraph: {
    title: "Usuários | BS Soluções Logísticas",
    description: "Gestão de contas, papéis e acesso.",
  },
};

export default async function Usuarios() {
  // Bloqueio server-side: a tela nem chega a existir na árvore quando a
  // sessão não é de administrador — mesmo padrão das outras sete
  // telas administrativas.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelUsuarios />;
}
