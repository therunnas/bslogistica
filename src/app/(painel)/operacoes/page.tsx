import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelOperacoes } from "./painel-operacoes";

export const metadata: Metadata = {
  title: "Operações e turnos",
  description:
    "Operações fixas e avulsas de carga e descarga, com turnos, intervalos e equipe alocada.",
  openGraph: {
    title: "Operações e turnos | BS Logística",
    description: "Operações fixas e avulsas com turnos e equipe alocada.",
  },
};

export default async function Operacoes() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelOperacoes />;
}
