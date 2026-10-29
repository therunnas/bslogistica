import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelFaturamento } from "./painel-faturamento";

export const metadata: Metadata = {
  title: "Faturamento por período",
  description:
    "Feche o período por cliente, some diárias e horas extras e gere a fatura com itens por operação.",
  openGraph: {
    title: "Faturamento por período | BS Soluções Logísticas",
    description: "Fechamento de diárias e horas extras por cliente e período.",
  },
};

export default async function Faturamento() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelFaturamento />;
}
