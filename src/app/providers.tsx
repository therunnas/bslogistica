"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ThemeProvider, useTema } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { sanearIntencoes } from "@/lib/container-servico-intencao";
import { temaAplicado } from "@/lib/tema";

function ToasterComTema() {
  const { tema } = useTema();
  const caminho = usePathname();

  return (
    <Toaster
      theme={temaAplicado(caminho, tema)}
      richColors
      position="top-center"
      offset="16px"
      mobileOffset="12px"
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    try {
      sanearIntencoes(sessionStorage);
    } catch {
      // Storage indisponível bloqueia somente o cadastro de containers, no próprio formulário.
    }
  }, []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <ToasterComTema />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
