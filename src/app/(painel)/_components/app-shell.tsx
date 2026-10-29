"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { BSLogo } from "@/components/branding/bs-logo";
import { useTema } from "@/components/theme-provider";
import { useFechamentoDisponivel } from "@/lib/vigencias-dados";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    { href: "/fechamento", label: "Fechamento", icon: ClipboardCheck },
    { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  ],
  operacional: [
    {
      href: "/operacional",
      label: "Apontamentos",
      icon: CalendarCheck,
    },
  ],
  "sem-papel": [],
} as const;

const ITEM_USUARIOS = {
  href: "/usuarios",
  label: "Usuários",
  icon: UserCog,
} as const;

const ITEM_SEGURANCA = {
  href: "/configuracoes",
  label: "Segurança",
  icon: ShieldCheck,
} as const;

// Rota técnica de manutenção (implantação e reversão do cálculo por vigência): NÃO está no menu.
// Fica aqui só para o título da página; o acesso é decidido no servidor (`exigirAdmin`, admin com
// AAL2), e ausência de link não é controle de acesso.
const ROTA_TECNICA_IMPLANTACAO = {
  href: "/implantacao-vigencias",
  label: "Implantação das vigências",
  icon: History,
} as const;

const MENU_DE_CONTA = {
  admin: [ITEM_USUARIOS, ITEM_SEGURANCA],
  operacional: [ITEM_SEGURANCA],
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
  // O Fechamento só aparece quando o banco o sustenta (030 e motor novo ligado). Esconder o link
  // é conveniência: a página e as APIs negam no servidor.
  const fechamentoDisponivel = useFechamentoDisponivel(papel === "admin");
  const navegacao = NAVEGACAO[papel].filter(
    (item) => item.href !== "/fechamento" || fechamentoDisponivel,
  );
  const itensDeConta = MENU_DE_CONTA[papel];

  const caminho = usePathname();
  const queryClient = useQueryClient();

  const { tema, definirTema, pronto } = useTema();

  const [menuMobileAberto, setMenuMobileAberto] = useState(false);
  const [saindo, iniciarSaida] = useTransition();

  const paginaAtual =
    [...navegacao, ...itensDeConta, ROTA_TECNICA_IMPLANTACAO].find(({ href }) => href === caminho)
      ?.label ?? "Painel interno";

  const papelVisivel =
    papel === "admin" ? "Administrador" : papel === "operacional" ? "Operacional" : "Sem perfil";

  function encerrarSessao() {
    queryClient.clear();

    iniciarSaida(() => {
      void sair();
    });
  }

  function fecharMenuMobile() {
    setMenuMobileAberto(false);
  }

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
        <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-4">
          <div className="flex min-w-0 flex-col justify-center gap-1.5">
            <BSLogo fundo="tema" priority className="w-32 shrink-0" />

            <p className="text-[10px] leading-none text-muted-foreground">Sistema interno</p>
          </div>

          {mobile ? (
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto shrink-0 rounded-lg"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </DialogPrimitive.Close>
          ) : null}
        </div>

        {navegacao.length > 0 ? (
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Navegação
            </p>

            <div className="space-y-1">
              {navegacao.map(({ href, label, icon: Icon }) => {
                const ativo = caminho === href;

                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={ativo ? "page" : undefined}
                    onClick={() => {
                      if (mobile) {
                        fecharMenuMobile();
                      }
                    }}
                    className={cn(
                      "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      ativo
                        ? "bg-primary/[0.10] text-sidebar-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
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
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Aparência
            </p>

            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-secondary/40 p-1">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full justify-start gap-3 rounded-lg px-3 text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4 shrink-0" />

                <span className="min-w-0 flex-1 truncate text-left text-xs" title={email}>
                  {email}
                </span>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium text-foreground" title={email}>
                  {email}
                </p>

                <p className="mt-0.5 text-xs text-muted-foreground">{papelVisivel}</p>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              {itensDeConta.map(({ href, label, icon: Icon }) => (
                <DropdownMenuItem key={href} asChild>
                  <Link
                    href={href}
                    onClick={() => {
                      if (mobile) {
                        fecharMenuMobile();
                      }
                    }}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                </DropdownMenuItem>
              ))}

              {itensDeConta.length > 0 ? <DropdownMenuSeparator /> : null}

              <DropdownMenuItem
                onClick={encerrarSessao}
                disabled={saindo}
                className="cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                {saindo ? "Saindo..." : "Sair"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </>
    );
  }

  return (
    <DialogPrimitive.Root open={menuMobileAberto} onOpenChange={setMenuMobileAberto}>
      <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] lg:hidden" />

          <DialogPrimitive.Content
            className="fixed inset-y-0 left-0 z-50 flex w-[min(88vw,16rem)] flex-col border-r border-sidebar-border bg-sidebar shadow-[24px_0_80px_rgba(0,0,0,0.28)] outline-none lg:hidden"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Menu de navegação</DialogPrimitive.Title>

            <SidebarContent mobile />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>

        <aside className="sticky top-0 hidden h-screen min-h-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <SidebarContent />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border bg-background/90 px-4 backdrop-blur-xl lg:px-8">
            <DialogPrimitive.Trigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mr-3 shrink-0 rounded-lg lg:hidden"
                aria-label="Abrir menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </DialogPrimitive.Trigger>

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
    </DialogPrimitive.Root>
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
