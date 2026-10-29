import type { Metadata } from "next";

import { MENSAGEM_DE_INDISPONIBILIDADE } from "@/lib/fechamento/disponibilidade";
import { verificarDisponibilidadeNoServidor } from "@/lib/fechamento/disponibilidade-servidor";

import { exigirAdmin } from "../_exigir-admin";
import { PainelFechamento } from "./painel-fechamento";

export const metadata: Metadata = {
  title: "Fechamento por cliente e período",
  description:
    "Conferência de diárias, horas extras, custos e faturamento por cliente e período, com o que ainda falta faturar.",
  openGraph: {
    title: "Fechamento por cliente e período | BS Soluções Logísticas",
    description: "Diárias, horas extras, custo previsto e faturamento por cliente e período.",
  },
};

export default async function Fechamento() {
  // Bloqueio server-side: o painel administrativo nem chega a existir na
  // árvore quando a sessão não é de administrador. O endpoint /api/fechamento
  // se protege por conta própria; esta tela não é a barreira dele.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  // O Fechamento depende das migrations 029/030 e do motor novo ligado. Sem isso, a tela nem
  // monta o painel (a API também nega): mensagem controlada, nunca erro de função inexistente.
  const disponibilidade = await verificarDisponibilidadeNoServidor();
  if (!disponibilidade.disponivel) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 text-card-foreground">
        <h1 className="text-lg font-semibold tracking-tight">Fechamento indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {MENSAGEM_DE_INDISPONIBILIDADE[disponibilidade.motivo]}
        </p>
      </div>
    );
  }

  return <PainelFechamento />;
}
