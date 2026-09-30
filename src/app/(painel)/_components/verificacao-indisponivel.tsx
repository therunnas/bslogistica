"use client";

import { LogOut, RefreshCw, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sair } from "../_acoes";

export function VerificacaoIndisponivel({ email }: { email: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-primary/[0.08] blur-[120px]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-primary/[0.05] blur-[120px]"
      />

      <div className="relative flex min-h-screen items-center justify-center px-5 py-12">
        <section className="w-full max-w-[440px]">
          <div className="relative overflow-hidden rounded-[22px] border border-border bg-card/95 shadow-[0_32px_100px_rgba(0,0,0,0.12)] backdrop-blur-2xl">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

            <div className="p-7 text-center sm:p-9">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.07]">
                <ShieldQuestion className="h-5 w-5 text-primary" />
              </div>

              <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-foreground">
                Não foi possível verificar o segundo fator
              </h1>

              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Não conseguimos confirmar o estado de segurança da sua conta neste momento.
              </p>

              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Tente novamente. Se o problema continuar, saia e faça uma nova entrada no sistema.
              </p>

              <div className="mt-7 rounded-xl border border-border bg-secondary/50 px-4 py-3">
                <p className="text-xs text-muted-foreground">Conta conectada</p>

                <p className="mt-1 truncate text-sm font-medium text-foreground">{email}</p>
              </div>

              <Button
                type="button"
                className="mt-6 h-11 w-full rounded-xl"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </Button>

              <form action={sair} className="mt-3">
                <Button type="submit" variant="outline" className="h-11 w-full rounded-xl">
                  <LogOut className="h-4 w-4" />
                  Sair
                </Button>
              </form>
            </div>
          </div>

          <p className="mt-5 text-center text-[11px] text-muted-foreground">
            BS Soluções Logística · Ambiente interno protegido
          </p>
        </section>
      </div>
    </main>
  );
}
