import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelApontamentos } from "./painel-apontamentos";

export const metadata: Metadata = {
  title: "Apontamento diário",
  description:
    "Registre presença, faltas, horários e horas extras por turno e gere as diárias faturáveis do dia.",
  openGraph: {
    title: "Apontamento diário | BS Logística",
    description: "Presença, horários e horas extras por turno, com cálculo automático da diária.",
  },
};

export default async function Apontamentos() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelApontamentos />;
}
