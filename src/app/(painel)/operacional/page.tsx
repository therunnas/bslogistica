import type { Metadata } from "next";

import { exigirOperacional } from "../_exigir-operacional";
import { PainelOperacional } from "./painel-operacional";

export const metadata: Metadata = {
  title: "Apontamento",
  description: "Registre presença e horários da equipe alocada no turno e na data.",
};

export default async function Operacional() {
  // Bloqueio server-side espelhado do administrativo: a tela operacional não
  // chega a existir na árvore para quem não é do perfil operacional.
  const bloqueio = await exigirOperacional();
  if (bloqueio) return bloqueio;

  return <PainelOperacional />;
}
