import type { Metadata } from "next";

import Image from "next/image";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import {
  MENSAGEM_CONFIRMAR_RECUPERACAO,
  MENSAGEM_LINK_INVALIDO,
  NOME_DO_COOKIE_PENDENTE,
  ROTA_ESQUECI_SENHA,
  ROTULO_CONFIRMAR_RECUPERACAO,
  TITULO_CONFIRMAR_RECUPERACAO,
} from "@/lib/recuperacao-senha";

import { confirmarRecuperacao } from "./actions";

export const metadata: Metadata = {
  title: TITULO_CONFIRMAR_RECUPERACAO,
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Confirmação deliberada antes de consumir o token de recuperação.
 *
 * Esta tela existe para que o consumo do token aconteça por POST.
 *
 * Scanners de gateway de e-mail podem visitar automaticamente URLs
 * presentes nas mensagens. Se o token fosse consumido diretamente no GET,
 * ele poderia ser invalidado antes mesmo de o usuário clicar no link.
 *
 * O clique em "Continuar" representa a intenção real do usuário.
 *
 * Server Component puro, sem "use client":
 * o form envia diretamente para a Server Action.
 *
 * O token_hash nunca é enviado ao navegador nem exibido nesta página.
 * Ele permanece no cookie httpOnly criado anteriormente e é lido apenas
 * no servidor durante a confirmação.
 */
export default async function ConfirmarRecuperacaoPage() {
  const armazemDeCookies = await cookies();

  const pendente = armazemDeCookies.get(NOME_DO_COOKIE_PENDENTE)?.value;

  const temRecuperacaoPendente = typeof pendente === "string" && pendente.trim() !== "";

  return (
    <main className="flex min-h-screen flex-col bg-[#f4f7fa] px-6 py-8">
      {/* Marca */}
      <div className="mx-auto flex w-full max-w-6xl">
        <Image
          src="/branding/bs-logo-oficial.png"
          alt="BS Soluções Logística"
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
                {TITULO_CONFIRMAR_RECUPERACAO}
              </h1>

              <p className="mt-3 text-sm leading-6 text-slate-500">
                {temRecuperacaoPendente ? MENSAGEM_CONFIRMAR_RECUPERACAO : MENSAGEM_LINK_INVALIDO}
              </p>
            </div>

            {temRecuperacaoPendente ? (
              <form action={confirmarRecuperacao}>
                <Button
                  type="submit"
                  className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823B43] hover:text-white"
                >
                  {ROTULO_CONFIRMAR_RECUPERACAO}
                </Button>
              </form>
            ) : (
              <Button
                asChild
                className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823B43] hover:text-white"
              >
                <a href={ROTA_ESQUECI_SENHA}>Solicitar novo link</a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <p className="text-center text-xs text-slate-500">
        © {new Date().getFullYear()} BS Soluções Logística
      </p>
    </main>
  );
}
