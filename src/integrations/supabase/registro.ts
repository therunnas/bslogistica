import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * Registro do cliente Supabase em uso pela camada de dados.
 *
 * Existe porque as duas aplicações convivem durante a migração e criam o
 * cliente de formas diferentes: a TanStack guarda a sessão em localStorage, a
 * Next.js em cookies — sem cookie o servidor não conseguiria ler a sessão ao
 * renderizar. Cada aplicação registra o seu na inicialização, e queries.ts e
 * mutations.ts continuam únicos, sem duplicar regra de negócio.
 *
 * Quando a aplicação TanStack sair, isto pode voltar a ser um import direto.
 */
let clienteAtivo: SupabaseClient<Database> | null = null;

export function registrarCliente(cliente: SupabaseClient<Database>) {
  clienteAtivo = cliente;
}

export function obterCliente(): SupabaseClient<Database> {
  if (!clienteAtivo) {
    throw new Error(
      "Cliente do Supabase não registrado. A aplicação precisa chamar registrarCliente() na inicialização.",
    );
  }
  return clienteAtivo;
}
