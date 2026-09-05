"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition, type ReactNode } from "react";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sair } from "../_acoes";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/apontamentos", label: "Apontamentos", icon: CalendarCheck },
  { href: "/operacoes", label: "Operações", icon: Wrench },
  { href: "/clientes", label: "Clientes e contratos", icon: Building2 },
  { href: "/colaboradores", label: "Colaboradores", icon: Users },
  { href: "/faturamento", label: "Faturamento", icon: FileText },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
] as const;

export function AppShell({ children, email }: { children: ReactNode; email: string }) {
  const caminho = usePathname();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [saindo, iniciarSaida] = useTransition();

  function encerrarSessao() {
    // Limpa o cache antes de sair, para que os dados do usuário anterior não
    // fiquem em memória se outra pessoa entrar em seguida na mesma máquina.
    queryClient.clear();
    iniciarSaida(() => {
      void sair();
    });
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:translate-x-0",
          aberto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="grid size-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            BS
          </div>
          <span className="font-display text-base font-semibold">BS Logística</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setAberto(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                caminho === href
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <p className="truncate px-3 pb-2 text-xs text-muted-foreground" title={email}>
            {email}
          </p>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3"
            onClick={encerrarSessao}
            disabled={saindo}
          >
            <LogOut className="size-4" />
            {saindo ? "Saindo..." : "Sair"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <Button variant="outline" size="icon" onClick={() => setAberto((v) => !v)}>
            <Menu className="size-4" />
          </Button>
          <span className="font-display font-semibold">BS Logística</span>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
