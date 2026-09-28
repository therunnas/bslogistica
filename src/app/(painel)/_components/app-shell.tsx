"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { useTema } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { sair } from "../_acoes";
import type { PapelEfetivo } from "../_papel";

const NAVEGACAO = {
  admin: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/apontamentos", label: "Apontamentos", icon: CalendarCheck },
    { href: "/operacoes", label: "Operações", icon: Wrench },
    { href: "/clientes", label: "Clientes e contratos", icon: Building2 },
    { href: "/colaboradores", label: "Colaboradores", icon: Users },
    { href: "/faturamento", label: "Faturamento", icon: FileText },
    { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  ],
  operacional: [{ href: "/operacional", label: "Apontamentos", icon: CalendarCheck }],
  "sem-papel": [],
} as const;

export function AppShell({
  children,
  email,
  papel,
}: {
  children: ReactNode;
  email: string;
  papel: PapelEfetivo;
}) {
  const navegacao = NAVEGACAO[papel];

  const caminho = usePathname();
  const queryClient = useQueryClient();

  const { tema, definirTema, pronto } = useTema();

  const [menuMobileAberto, setMenuMobileAberto] = useState(false);
  const [saindo, iniciarSaida] = useTransition();

  const paginaAtual =
    [...navegacao].find(({ href }) => href === caminho)?.label ?? "Painel interno";

  const papelVisivel =
    papel === "admin" ? "Administrador" : papel === "operacional" ? "Operacional" : "Sem perfil";

  function encerrarSessao() {
    queryClient.clear();

    iniciarSaida(() => {
      void sair();
    });
  }

  function abrirMenuMobile() {
    setMenuMobileAberto(true);
  }

  function fecharMenuMobile() {
    setMenuMobileAberto(false);
  }

  useEffect(() => {
    if (!menuMobileAberto) {
      return;
    }

    function fecharComEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setMenuMobileAberto(false);
      }
    }

    const overflowAnterior = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", fecharComEscape);

    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", fecharComEscape);
    };
  }, [menuMobileAberto]);

  useEffect(() => {
    setMenuMobileAberto(false);
  }, [caminho]);

  useEffect(() => {
    const mediaDesktop = window.matchMedia("(min-width: 1024px)");

    function sincronizarComDesktop(evento: MediaQueryListEvent) {
      if (evento.matches) {
        setMenuMobileAberto(false);
      }
    }

    if (mediaDesktop.matches) {
      setMenuMobileAberto(false);
    }

    mediaDesktop.addEventListener("change", sincronizarComDesktop);

    return () => {
      mediaDesktop.removeEventListener("change", sincronizarComDesktop);
    };
  }, []);

  function SidebarContent({ mobile = false }: { mobile?: boolean }) {
    return (
      <>
        <div className="flex h-20 shrink-0 items-center border-b border-sidebar-border px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded-xl border border-border bg-white px-2 shadow-sm">
              <Image
                src="/branding/bs-logo-temp.png"
                alt=""
                width={1000}
                height={625}
                priority
                className="h-auto w-full object-contain"
              />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
                BS Soluções Logísticas
              </p>

              <p className="mt-0.5 text-[11px] text-muted-foreground">Sistema interno</p>
            </div>
          </div>

          {mobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative z-20 ml-auto shrink-0 rounded-xl"
              onClick={fecharMenuMobile}
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </Button>
          ) : null}
        </div>

        {navegacao.length > 0 ? (
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
            <p className="mb-3 px-3 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Navegação
            </p>

            <div className="space-y-1">
              {navegacao.map(({ href, label, icon: Icon }) => {
                const ativo = caminho === href;

                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => {
                      if (mobile) {
                        fecharMenuMobile();
                      }
                    }}
                    className={cn(
                      "group relative flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm font-medium transition-all duration-150",
                      ativo
                        ? "border-primary/20 bg-primary/[0.08] text-sidebar-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {ativo ? (
                      <span className="absolute top-1/2 left-0 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
                    ) : null}

                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        ativo ? "text-primary" : "text-muted-foreground",
                      )}
                    />

                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : (
          <div className="flex-1" />
        )}

        <div className="shrink-0 border-t border-sidebar-border p-3">
          <div className="mb-3">
            <p className="mb-2 px-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Aparência
            </p>

            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-secondary/50 p-1">
              <button
                type="button"
                disabled={!pronto}
                onClick={() => definirTema("light")}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-all",
                  tema === "light"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Sun className="h-3.5 w-3.5" />
                Claro
              </button>

              <button
                type="button"
                disabled={!pronto}
                onClick={() => definirTema("dark")}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-all",
                  tema === "dark"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Moon className="h-3.5 w-3.5" />
                Escuro
              </button>
            </div>
          </div>

          <div className="mb-2 rounded-xl border border-border bg-secondary/40 p-3">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />

              <span className="text-[11px] font-medium text-muted-foreground">{papelVisivel}</span>
            </div>

            <p className="truncate text-xs text-muted-foreground" title={email}>
              {email}
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full justify-start gap-3 rounded-xl text-muted-foreground"
            onClick={encerrarSessao}
            disabled={saindo}
          >
            <LogOut className="h-4 w-4" />

            {saindo ? "Saindo..." : "Sair"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      {menuMobileAberto ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={fecharMenuMobile}
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            className="absolute inset-y-0 left-0 z-10 flex w-[min(88vw,20rem)] flex-col border-r border-sidebar-border bg-sidebar shadow-[24px_0_80px_rgba(0,0,0,0.28)]"
            onClick={(evento) => evento.stopPropagation()}
          >
            <SidebarContent mobile />
          </aside>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen min-h-0 w-[17.5rem] flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <SidebarContent />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border bg-background/90 px-4 backdrop-blur-xl lg:px-8">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mr-3 shrink-0 rounded-xl lg:hidden"
            onClick={abrirMenuMobile}
            aria-label="Abrir menu"
            aria-expanded={menuMobileAberto}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {paginaAtual}
            </p>

            <p className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">
              BS Soluções Logísticas
            </p>
          </div>
        </header>

        <div className="relative min-w-0 overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-64 right-[-14rem] h-[34rem] w-[34rem] rounded-full bg-primary/[0.04] blur-[130px]"
          />

          <main className="relative min-w-0 overflow-x-hidden p-4 md:p-6 xl:p-8">{children}</main>
        </div>
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
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground md:text-3xl">
          {title}
        </h1>

        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
