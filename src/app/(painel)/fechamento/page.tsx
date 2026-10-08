import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelFechamento } from "./painel-fechamento";

export const metadata: Metadata = {
  title: "Fechamento por cliente e período",
  description:
    "Conferência de diárias, horas extras, custos e faturamento por cliente e período, com o que ainda falta faturar.",
  openGraph: {
    title: "Fechamento por cliente e período | BS Logística",
    description: "Diárias, horas extras, custo previsto e faturamento por cliente e período.",
  },
};

export default async function Fechamento() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador. O endpoint /api/fechamento
  // se protege por conta própria; esta tela não é a barreira dele.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelFechamento />;
}
