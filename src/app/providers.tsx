"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useState, type ReactNode } from "react";

import { ThemeProvider, useTema } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

function ToasterComTema() {
  const { tema } = useTema();

  return (
    <Toaster theme={tema} richColors position="top-center" offset="16px" mobileOffset="12px" />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <ToasterComTema />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
