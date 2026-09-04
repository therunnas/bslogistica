import type { Metadata } from "next";

import { PainelClientes } from "./painel-clientes";

export const metadata: Metadata = {
  title: "Clientes e contratos",
  description:
    "Cadastro de clientes e regras de cobrança: valor da diária, jornada, fator e tolerância de hora extra.",
  openGraph: {
    title: "Clientes e contratos | BS Logística",
    description: "Clientes e regras de cobrança por diária e hora extra.",
  },
};

export default function Clientes() {
  return <PainelClientes />;
}
