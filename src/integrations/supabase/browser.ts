"use client";

import { createBrowserClient } from "@supabase/ssr";

import { obterOpcoesCookieSupabase } from "./cookie-options";
import { lerAmbienteSupabase } from "./env";
import type { Database } from "./types";

let cliente: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Cliente do Supabase para o navegador.
 *
 * Uma instância só por sessão de página: cada cliente mantém o próprio estado
 * de autenticação e os próprios ouvintes, então criar vários faria a renovação
 * de token disputar consigo mesma.
 *
 * Usa a chave publicável. A sessão fica em cookies, e não em localStorage, para
 * que o servidor consiga lê-la ao renderizar.
 */
export function criarClienteNavegador() {
  if (!cliente) {
    const { url, chave } = lerAmbienteSupabase();
    cliente = createBrowserClient<Database>(url, chave, {
      cookieOptions: obterOpcoesCookieSupabase(),
    });
  }
  return cliente;
}
