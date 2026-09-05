import type { Metadata } from "next";

import { PainelColaboradores } from "./painel-colaboradores";

export const metadata: Metadata = {
  title: "Colaboradores",
  description: "Cadastro de colaboradores com função, contato e custo por diária.",
  openGraph: {
    title: "Colaboradores | BS Logística",
    description: "Cadastro de equipe e custo por diária.",
  },
};

export default function Colaboradores() {
  return <PainelColaboradores />;
}
