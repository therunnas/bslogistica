import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelClientes } from "./painel-clientes";

export const metadata: Metadata = {
  title: "Clientes e contratos",
  description:
    "Cadastro de clientes e regras de cobrança: valor da diária, jornada, fator e tolerância de hora extra.",
  openGraph: {
    title: "Clientes e contratos | BS Soluções Logísticas",
    description: "Clientes e regras de cobrança por diária e hora extra.",
  },
};

export default async function Clientes() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelClientes />;
}
