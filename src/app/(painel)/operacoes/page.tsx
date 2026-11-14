import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelOperacoes } from "./painel-operacoes";

export const metadata: Metadata = {
  title: "Operações e turnos",
  description: "Operações fixas e avulsas, com turnos, intervalos e equipe alocada.",
  openGraph: {
    title: "Operações e turnos | BS Soluções Logísticas",
    description: "Operações fixas e avulsas com turnos e equipe alocada.",
  },
};

export default async function Operacoes({
  searchParams,
}: {
  searchParams?: Promise<{ origem?: string | string[] }>;
}) {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  // CP-06B: `?origem=conteiner` vem do antigo /containers/novo (orientação, não estado).
  const origem = (await searchParams)?.origem;
  return origem === "conteiner" ? <PainelOperacoes origem="conteiner" /> : <PainelOperacoes />;
}
