"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./types";

/**
 * Cliente do Supabase para o navegador (Next.js).
 *
 * A chave publicável é pública por natureza: viaja no JavaScript da página.
 * Quem protege os dados é a RLS do banco, não o sigilo desta chave. A chave
 * secreta nunca entra aqui — ela só existe no servidor, em server.ts.
 */
export function criarClienteNavegador() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const chave = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !chave) {
    const faltando = [
      ...(!url ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
      ...(!chave ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(
      `Variáveis de ambiente do Supabase ausentes: ${faltando.join(", ")}. ` +
        "Defina-as no .env local e nas variáveis de ambiente da hospedagem.",
    );
  }

  return createBrowserClient<Database>(url, chave);
}
