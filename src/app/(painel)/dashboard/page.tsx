import type { Metadata } from "next";

import { PainelDashboard } from "./painel-dashboard";

export const metadata: Metadata = {
  title: "Dashboard operacional",
  description: "Diárias, horas extras, receita, custo e margem do período por cliente e operação.",
  openGraph: {
    title: "Dashboard operacional | BS Logística",
    description: "Indicadores de diárias, horas extras, receita, custo e margem por período.",
  },
};

export default function Dashboard() {
  return <PainelDashboard />;
}
