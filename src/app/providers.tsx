"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

/**
 * Provedores que precisam rodar no navegador.
 *
 * O QueryClient nasce dentro de useState, e não em escopo de módulo: no
 * servidor o módulo é compartilhado entre requisições, e um cliente global
 * faria uma requisição enxergar o cache da outra.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* top-center: no canto superior direito o toast cobria justamente os
          botões de ação das telas — Salvar, Novo colaborador, Nova operação —
          e obrigava a esperar ele sumir para continuar. */}
      <Toaster richColors position="top-center" offset="16px" mobileOffset="12px" />
    </QueryClientProvider>
  );
}
