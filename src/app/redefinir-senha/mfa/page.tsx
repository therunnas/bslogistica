import type { Metadata } from "next";
import type { ReactNode } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BSBrand } from "@/components/branding/bs-brand";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { decidirMfaNaRecuperacao, decidirSituacaoMfa } from "@/lib/mfa";
import { NOME_DO_COOKIE_DE_PROVA, validarProvaDeRecuperacao } from "@/lib/prova-recuperacao";
import {
  MENSAGEM_MFA_INDISPONIVEL,
  MENSAGEM_MFA_RECUPERACAO,
  ROTA_ESQUECI_SENHA,
  ROTA_REDEFINIR_SENHA,
  TITULO_MFA_RECUPERACAO,
  decidirAcessoRedefinicao,
} from "@/lib/recuperacao-senha";

import { FormularioMfaRecuperacao } from "./formulario-mfa";

export const metadata: Metadata = {
  title: TITULO_MFA_RECUPERACAO,
  robots: {
    index: false,
    follow: false,
  },
};

type MolduraMfaProps = {
  titulo: string;
  descricao: string;
  children: ReactNode;
};

function MolduraMfa({ titulo, descricao, children }: MolduraMfaProps) {
  return (
    <main className="flex min-h-screen flex-col bg-[#f4f7fa] px-6 py-8">
      {/* Marca */}
      <div className="mx-auto w-full max-w-6xl">
        <BSBrand variant="light" size="sm" align="start" priority />
      </div>

      {/* Conteúdo */}
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
            <div className="mb-7">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Verificação de segurança
              </p>

              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {titulo}
              </h1>

              <p className="mt-3 text-sm leading-6 text-slate-500">{descricao}</p>
            </div>

            {children}
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

/**
 * Segundo fator dentro da recuperação de senha.
 *
 * Fica sob /redefinir-senha porque o cookie bs_recovery_proof é emitido
 * com Path=/redefinir-senha e, portanto, cobre esta subárvore.
 *
 * O acesso exige:
 *
 * 1. usuário confirmado pelo Supabase;
 * 2. claims verificadas;
 * 3. prova de recuperação válida, vinculada ao usuário e à sessão.
 *
 * A página apenas decide o que renderizar.
 * A Server Action revalida as condições novamente no POST.
 *
 * Esta rota nunca cadastra fator, nunca remove fator, nunca exibe QR
 * e nunca encaminha diretamente ao painel.
 */
export default async function MfaDaRecuperacao() {
  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: claims } = await supabase.auth.getClaims();

  const sessionId = claims?.claims?.session_id;

  const armazemDeCookies = await cookies();

  const provaBruta = armazemDeCookies.get(NOME_DO_COOKIE_DE_PROVA)?.value;

  const resultadoDaProva =
    user && typeof sessionId === "string"
      ? await validarProvaDeRecuperacao(provaBruta, {
          sub: user.id,
          sessionId,
        })
      : "ausente";

  const acesso = decidirAcessoRedefinicao({
    temUsuario: Boolean(user),
    temClaims: typeof sessionId === "string",
    resultadoDaProva,
  });

  if (acesso === "negar") {
    redirect(ROTA_ESQUECI_SENHA);
  }

  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const decisao = decidirMfaNaRecuperacao(decidirSituacaoMfa(nivel ?? null, Boolean(erroNivel)));

  /**
   * Falha fechada.
   *
   * Não saber se existe fator não equivale a não existir.
   * Nesse caso, não permitimos continuar a redefinição.
   */
  if (decisao === "falhar") {
    return (
      <MolduraMfa titulo={TITULO_MFA_RECUPERACAO} descricao={MENSAGEM_MFA_INDISPONIVEL}>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm leading-6 text-slate-600">
            Recarregue a página em instantes. Se o problema continuar, solicite um novo link de
            recuperação.
          </p>
        </div>
      </MolduraMfa>
    );
  }

  /**
   * Conta sem fator ou sessão que já atingiu AAL2.
   * Não existe desafio adicional a executar.
   */
  if (decisao === "prosseguir") {
    redirect(ROTA_REDEFINIR_SENHA);
  }

  return (
    <MolduraMfa titulo={TITULO_MFA_RECUPERACAO} descricao={MENSAGEM_MFA_RECUPERACAO}>
      <FormularioMfaRecuperacao />
    </MolduraMfa>
  );
}
