"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { BSBrand } from "@/components/branding/bs-brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { toast } from "@/lib/notificacoes";

import {
  MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS,
  MENSAGEM_SENHA_REDEFINIDA,
  PARAM_SESSOES_ATIVAS,
  ROTA_ESQUECI_SENHA,
} from "@/lib/recuperacao-senha";

function AvisoSenhaRedefinida() {
  const parametros = useSearchParams();

  if (parametros.get("senha-redefinida") !== "1") {
    return null;
  }

  const sessoesAtivas = parametros.get(PARAM_SESSOES_ATIVAS) === "1";

  return (
    <p
      role="status"
      className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground"
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

    if (sessoesAtivas) {
      return;
    }

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
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-2">
      {/* ÁREA DE LOGIN */}
      <section className="relative z-10 flex min-h-screen flex-col bg-[#f4f7fa] px-6 py-8 sm:px-10 lg:px-16 xl:px-24">
        {/* Marca somente em telas menores */}
        <div className="mb-12 lg:hidden">
          <BSBrand variant="light" size="sm" align="start" priority />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[448px]">
            <div className="mb-8">
              <h1 className="font-display text-[27px] font-semibold tracking-tight text-slate-950">
                Acesso ao sistema
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-[15px]">
                Entre com suas credenciais para continuar.
              </p>
            </div>

            <Suspense fallback={null}>
              <AvisoSenhaRedefinida />
            </Suspense>

            <form onSubmit={entrar} className="mt-7 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-900">
                  E-mail
                </Label>

                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(evento) => setEmail(evento.target.value)}
                  required
                  placeholder="seuemail@empresa.com.br"
                  className="h-12 rounded-lg border-slate-300 bg-white px-4 shadow-sm"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="senha" className="text-sm font-medium text-slate-900">
                    Senha
                  </Label>

                  <a
                    href={ROTA_ESQUECI_SENHA}
                    className="relative z-20 inline-flex cursor-pointer items-center py-1 text-sm text-slate-500 transition-colors hover:text-slate-950 hover:underline"
                  >
                    Esqueci minha senha
                  </a>
                </div>

                <Input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(evento) => setSenha(evento.target.value)}
                  required
                  placeholder="Digite sua senha"
                  className="h-12 rounded-lg border-slate-300 bg-white px-4 shadow-sm"
                />
              </div>

              <Button
                type="submit"
                disabled={enviando}
                className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823b43] hover:text-white"
              >
                {enviando ? "Aguarde..." : "Entrar"}
              </Button>
            </form>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <p className="text-center text-xs text-slate-500">
                Acesso exclusivo a usuários autorizados.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-1 text-center text-xs text-slate-500 lg:text-left">
          © {new Date().getFullYear()} BS Soluções Logística
        </p>
      </section>

      {/* ÁREA INSTITUCIONAL */}
      <section className="relative hidden min-h-screen overflow-hidden bg-[#0d0d0d] lg:flex lg:flex-col">
        {/* Elementos gráficos discretos */}
        <div className="pointer-events-none absolute -right-36 -top-36 h-[430px] w-[430px] rounded-full border border-white/[0.04]" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-[300px] w-[300px] rounded-full border border-white/[0.04]" />

        {/* Brilho vermelho discreto */}
        <div className="pointer-events-none absolute bottom-24 left-20 h-40 w-40 rounded-full bg-red-700/[0.06] blur-3xl" />

        <div className="relative z-10 flex min-h-screen flex-col px-16 pb-8 pt-14 xl:px-20 xl:pb-8 xl:pt-16">
          {/* Marca */}
          <div className="mx-auto">
            <BSBrand variant="dark" size="lg" align="center" priority />
          </div>

          {/* Conteúdo principal */}
          <div className="flex flex-1 items-start pt-14 xl:pt-16">
            <div className="max-w-xl">
              <h2 className="font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.025em] text-white xl:text-[36px]">
                Gestão operacional
                <br />
                em um só lugar.
              </h2>

              <p className="mt-9 max-w-md text-[15px] leading-7 text-white/60">
                Pessoas, operações e resultados conectados em uma plataforma centralizada.
              </p>
            </div>
          </div>

          {/* Rodapé */}
          <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-6">
            <p className="text-xs text-white/40">Sistema interno de gestão</p>

            <p className="text-xs text-white/35">BS Soluções Logística</p>
          </div>
        </div>
      </section>
    </main>
  );
}
