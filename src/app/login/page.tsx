"use client";

import Image from "next/image";
import Link from "next/link";

import { useRouter, useSearchParams } from "next/navigation";

import { Suspense, useEffect, useState } from "react";

import { ArrowRight, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { criarClienteNavegador } from "@/integrations/supabase/browser";

import {
  MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS,
  MENSAGEM_SENHA_REDEFINIDA,
  PARAM_SESSOES_ATIVAS,
  ROTA_ESQUECI_SENHA,
} from "@/lib/recuperacao-senha";

import { toast } from "@/lib/notificacoes";

function AvisoSenhaRedefinida() {
  const parametros = useSearchParams();

  if (parametros.get("senha-redefinida") !== "1") {
    return null;
  }

  const sessoesAtivas = parametros.get(PARAM_SESSOES_ATIVAS) === "1";

  return (
    <p
      role="status"
      className="rounded-xl border border-border bg-secondary/70 px-4 py-3 text-sm leading-6 text-foreground"
    >
      {sessoesAtivas ? MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS : MENSAGEM_SENHA_REDEFINIDA}
    </p>
  );
}

export default function Login() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const sessoesAtivas =
      new URLSearchParams(window.location.search).get(PARAM_SESSOES_ATIVAS) === "1";

    if (sessoesAtivas) return;

    const supabase = criarClienteNavegador();

    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.replace("/dashboard");
      }
    });
  }, [router]);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();

    setEnviando(true);

    const supabase = criarClienteNavegador();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      toast.error(error.message);
      setEnviando(false);
      return;
    }

    router.refresh();
    router.replace("/dashboard");
  }

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

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex min-h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 items-center rounded-xl border border-border bg-white px-3 shadow-lg">
              <Image
                src="/branding/bs-logo-temp.png"
                alt="BS Soluções Logísticas"
                width={1000}
                height={625}
                priority
                className="h-auto w-24 object-contain"
              />
            </div>

            <div className="hidden sm:block">
              <p className="text-sm font-semibold tracking-tight text-foreground">
                BS Soluções Logísticas
              </p>

              <p className="text-xs text-muted-foreground">Sistema interno</p>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground backdrop-blur-xl sm:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Acesso protegido
          </div>
        </header>

        <div className="grid flex-1 items-center gap-16 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:py-8">
          <section className="hidden max-w-2xl lg:block">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-3 py-1.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_rgba(225,29,46,0.6)]" />
              Ambiente operacional
            </div>

            <h1 className="max-w-[11ch] text-5xl font-semibold leading-[0.98] tracking-[-0.05em] text-foreground xl:text-7xl">
              Operação sob controle.
            </h1>

            <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground xl:text-lg">
              Gestão operacional, colaboradores, escalas, apontamentos e faturamento em um único
              ambiente interno.
            </p>

            <div className="mt-10 grid max-w-lg gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/60">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                </div>
                Controle de acesso por perfil e autenticação protegida
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/60">
                  <LockKeyhole className="h-4 w-4 text-primary" />
                </div>
                Ambiente exclusivo para usuários autorizados
              </div>
            </div>
          </section>

          <section className="mx-auto w-full max-w-[440px]">
            <div className="relative overflow-hidden rounded-[22px] border border-border bg-card/95 shadow-[0_32px_100px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

              <div className="p-6 sm:p-8 lg:p-9">
                <div className="mb-8">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary/70">
                    <LockKeyhole className="h-5 w-5 text-primary" />
                  </div>

                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
                    Acessar sistema
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Entre com suas credenciais para acessar o painel interno.
                  </p>
                </div>

                <Suspense fallback={null}>
                  <AvisoSenhaRedefinida />
                </Suspense>

                <form onSubmit={entrar} className="mt-6 space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium text-foreground">
                      E-mail
                    </Label>

                    <div className="relative">
                      <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="nome@empresa.com.br"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="h-12 rounded-xl border-input bg-secondary/70 pl-10 text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="senha" className="text-sm font-medium text-foreground">
                        Senha
                      </Label>

                      <Link
                        href={ROTA_ESQUECI_SENHA}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                      >
                        Esqueci minha senha
                      </Link>
                    </div>

                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                      <Input
                        id="senha"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        required
                        className="h-12 rounded-xl border-input bg-secondary/70 pl-10 text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={enviando}
                    className="group h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_10px_30px_rgba(225,29,46,0.18)] transition-all hover:bg-primary/90"
                  >
                    {enviando ? (
                      "Aguarde..."
                    ) : (
                      <>
                        Entrar
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="mt-7 border-t border-border pt-6">
                  <p className="text-center text-xs leading-5 text-muted-foreground">
                    Precisa de acesso? Entre em contato com o administrador do sistema.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-5 text-center text-[11px] text-muted-foreground">
              BS Soluções Logísticas · Ambiente interno
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
