"use client";

import Image from "next/image";
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
  Settings,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";

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

/**
 * A navegação de cada papel.
 *
 * As sete telas administrativas são administrativas de fato, não por rótulo:
 * dashboard, relatórios e faturamento mostram receita, custo e margem; clientes
 * traz as regras de cobrança; colaboradores, o custo por diária; operações
 * administra a estrutura; e apontamentos é a tela administrativa, com o
 * financeiro junto. Por isso a lista inteira troca por papel, em vez de ser
 * filtrada item a item — nenhuma delas serve ao operacional.
 *
 * O operacional tem uma tela, e é a dele: `/operacional`, separada da
 * administrativa e alimentada só pelas RPCs da migration 013.
 *
 * `/usuarios` (PR E) NÃO está nesta lista, de propósito: gerenciar contas não
 * é uma tarefa do dia a dia como as sete acima — é administração da própria
 * área administrativa, e por isso mora no menu de conta, no rodapé, junto do
 * "Sair". Ver `ITEM_USUARIOS` e o rodapé de `AppShell`.
 */
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

/**
 * A entrada de administração de contas — só no menu de conta do admin, nunca
 * na navegação principal nem para o operacional. Fica fora de `NAVEGACAO`
 * para que a contagem de links da navegação principal (usada em
 * `scripts/testar-papel.mjs`) não precise saber da existência desta tela.
 */
const ITEM_USUARIOS = { href: "/usuarios", label: "Usuários", icon: UserCog } as const;

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
          {/* Logo provisória do MVP. `alt` vazio de propósito: o nome já está
              no texto ao lado, e repeti-lo faria o leitor de tela anunciar a
              marca duas vezes. */}
          <Image
            src="/branding/bs-logo-oficial.png"
            alt=""
            width={1000}
            height={625}
            priority
            className="h-7 w-auto shrink-0"
          />
          <span className="truncate font-display text-sm font-semibold">
            BS Soluções Logísticas
          </span>
        </div>
        {/* Sem link nenhum, o `<nav>` inteiro sai da árvore: uma lista vazia
            com a mesma altura só pareceria um menu quebrado. O `flex-1` migra
            para o espaçador, e o rodapé com e-mail e Sair continua no pé da
            barra. */}
        {navegacao.length > 0 ? (
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {navegacao.map(({ href, label, icon: Icon }) => (
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
        ) : (
          <div className="flex-1" />
        )}
        <div className="border-t border-border p-3">
          {papel === "admin" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-3 px-3">
                  <Settings className="size-4 shrink-0" />
                  <span className="truncate text-left" title={email}>
                    {email}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium" title={email}>
                    {email}
                  </p>
                  <p className="text-xs text-muted-foreground">Administrador</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={ITEM_USUARIOS.href} onClick={() => setAberto(false)}>
                    <ITEM_USUARIOS.icon className="size-4" />
                    {ITEM_USUARIOS.label}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={encerrarSessao} disabled={saindo}>
                  <LogOut className="size-4" />
                  {saindo ? "Saindo..." : "Sair"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
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
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <Button variant="outline" size="icon" onClick={() => setAberto((v) => !v)}>
            <Menu className="size-4" />
          </Button>
          <Image
            src="/branding/bs-logo-oficial.png"
            alt=""
            width={1000}
            height={625}
            className="h-7 w-auto shrink-0"
          />
          <span className="truncate font-display text-sm font-semibold">
            BS Soluções Logísticas
          </span>
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
