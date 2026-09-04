"use client";

import { createBrowserClient } from "@supabase/ssr";

import { lerAmbienteSupabase } from "./env";
import type { Database } from "./types";

/**
 * Cliente do Supabase para o navegador.
 *
 * Usa a chave publicável. A sessão fica em cookies, e não em localStorage, para
 * que o servidor consiga lê-la ao renderizar — é o que o @supabase/ssr faz.
 */
export function criarClienteNavegador() {
  const { url, chave } = lerAmbienteSupabase();
  return createBrowserClient<Database>(url, chave);
}
