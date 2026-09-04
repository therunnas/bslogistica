"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { registrarCliente } from "@/integrations/supabase/registro";

/**
 * Provedores que precisam rodar no navegador.
 *
 * O QueryClient nasce dentro de useState, e não em escopo de módulo: no
 * servidor o módulo é compartilhado entre requisições, e um cliente global
 * faria uma requisição enxergar o cache da outra.
 */
export function Providers({ children }: { children: ReactNode }) {
  // A camada de dados (queries.ts, mutations.ts) busca o cliente no registro.
  // Aqui é o cliente de cookies: é o que mantém navegador e servidor de acordo
  // sobre quem está logado.
  useState(() => {
    registrarCliente(criarClienteNavegador());
    return null;
  });

  // Sem opções próprias, de propósito: a aplicação TanStack usa
  // `new QueryClient()` puro, e qualquer ajuste aqui faria as duas se
  // comportarem de forma diferente durante a migração.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
