import Image from "next/image";
import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MolduraAuth({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-18rem] right-[-12rem] h-[32rem] w-[32rem] rounded-full bg-primary/[0.035] blur-3xl dark:bg-primary/[0.055]" />
        <div className="absolute bottom-[-16rem] left-[-12rem] h-[28rem] w-[28rem] rounded-full bg-primary/[0.025] blur-3xl dark:bg-primary/[0.04]" />
      </div>

      <div className="relative flex min-h-screen w-full flex-col">
        <header className="flex items-center justify-between px-6 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-14 items-center justify-center rounded-xl border border-border bg-card">
              <Image
                src="/branding/bs-logo-temp.png"
                alt="BS Soluções Logísticas"
                width={1000}
                height={625}
                priority
                className="h-auto w-12 object-contain"
              />
            </div>

            <div>
              <p className="text-sm font-semibold tracking-[-0.02em] text-foreground">
                BS Soluções Logísticas
              </p>

              <p className="text-[11px] text-muted-foreground">Sistema interno</p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <LockKeyhole className="h-3.5 w-3.5 text-primary" />
            Acesso protegido
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-6 lg:pb-20">
          <div className="w-full max-w-md">
            <div className="mb-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                <LockKeyhole className="h-4 w-4" />
              </div>

              <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-[1.75rem]">
                {titulo}
              </h1>

              {descricao ? (
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{descricao}</p>
              ) : null}
            </div>

            <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_20px_70px_rgba(0,0,0,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
              <CardHeader className="sr-only">
                <CardTitle>{titulo}</CardTitle>

                {descricao ? <CardDescription>{descricao}</CardDescription> : null}
              </CardHeader>

              <CardContent className="space-y-5 p-5 sm:p-6">{children}</CardContent>
            </Card>

            <p className="mt-5 text-center text-[11px] text-muted-foreground">
              BS Soluções Logísticas · Ambiente interno
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
