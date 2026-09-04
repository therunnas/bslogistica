import type { Metadata } from "next";

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

export default function Operacoes() {
  return <PainelOperacoes />;
}
