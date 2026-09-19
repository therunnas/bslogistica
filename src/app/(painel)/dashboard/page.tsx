import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelDashboard } from "./painel-dashboard";

export const metadata: Metadata = {
  title: "Dashboard operacional",
  description: "Diárias, horas extras, receita, custo e margem do período por cliente e operação.",
  openGraph: {
    title: "Dashboard operacional | BS Logística",
    description: "Indicadores de diárias, horas extras, receita, custo e margem por período.",
  },
};

export default async function Dashboard() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelDashboard />;
}
