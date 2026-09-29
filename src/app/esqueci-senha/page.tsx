"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarClienteNavegador } from "@/integrations/supabase/browser";

import {
  MENSAGEM_FALHA_GENERICA,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_SOLICITACAO_ENVIADA,
  ROTA_LOGIN,
  decidirRespostaDaSolicitacao,
} from "@/lib/recuperacao-senha";

function AvisoLinkInvalido() {
  const parametros = useSearchParams();

  if (parametros.get("status") !== "link-invalido") {
    return null;
  }

  return (
    <p
      role="status"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
    >
      {MENSAGEM_LINK_INVALIDO}
    </p>
  );
}

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function solicitar(evento: React.FormEvent) {
    evento.preventDefault();

    if (enviando) {
      return;
    }

    setEnviando(true);
    setAviso(null);

    const supabase = criarClienteNavegador();

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());

    setAviso(
      decidirRespostaDaSolicitacao(error) === "falha-temporaria"
        ? MENSAGEM_FALHA_GENERICA
        : MENSAGEM_SOLICITACAO_ENVIADA,
    );

    setEnviando(false);
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f4f7fa] px-6 py-8">
      {/* Marca */}
      <div className="mx-auto flex w-full max-w-6xl">
        <Image
          src="/branding/bs-logo-oficial.png"
          alt="BS Soluções Logísticas"
          width={1000}
          height={625}
          priority
          className="h-auto w-28 object-contain sm:w-32"
        />
      </div>

      {/* Conteúdo */}
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
            <div className="mb-7">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Recuperação de acesso
              </p>

              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                Recuperar senha
              </h1>

              <p className="mt-3 text-sm leading-6 text-slate-500">
                Informe o e-mail da sua conta e enviaremos um link para definir uma nova senha.
              </p>
            </div>

            <div className="space-y-5">
              <Suspense fallback={null}>
                <AvisoLinkInvalido />
              </Suspense>

              <form onSubmit={solicitar} className="space-y-5">
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

                <Button
                  type="submit"
                  disabled={enviando}
                  className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823b43]"
                >
                  {enviando ? "Enviando..." : "Enviar link de recuperação"}
                </Button>
              </form>

              {aviso ? (
                <p
                  role="status"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600"
                >
                  {aviso}
                </p>
              ) : null}

              <div className="border-t border-slate-200 pt-5">
                <p className="text-center text-sm">
                  <a
                    href={ROTA_LOGIN}
                    className="cursor-pointer text-slate-500 transition-colors hover:text-slate-950 hover:underline"
                  >
                    Voltar para entrar
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <p className="text-center text-xs text-slate-500">
        © {new Date().getFullYear()} BS Soluções Logísticas
      </p>
    </main>
  );
}
