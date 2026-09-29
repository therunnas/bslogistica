import type { ReactNode } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BSBrand } from "@/components/branding/bs-brand";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { decidirMfaNaRecuperacao, decidirSituacaoMfa } from "@/lib/mfa";
import { NOME_DO_COOKIE_DE_PROVA, validarProvaDeRecuperacao } from "@/lib/prova-recuperacao";
import {
  MENSAGEM_MFA_INDISPONIVEL,
  ROTA_ESQUECI_SENHA,
  ROTA_REDEFINIR_SENHA_MFA,
  decidirAcessoRedefinicao,
} from "@/lib/recuperacao-senha";

import { FormularioNovaSenha } from "./formulario-nova-senha";

type MolduraRedefinicaoProps = {
  titulo: string;
  descricao: string;
  children: ReactNode;
};

function MolduraRedefinicao({ titulo, descricao, children }: MolduraRedefinicaoProps) {
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
                Segurança da conta
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
        © {new Date().getFullYear()} BS Soluções Logística
      </p>
    </main>
  );
}

/**
 * Definição da nova senha.
 *
 * Fica FORA de (painel) de propósito. O layout do painel exige papel e AAL2,
 * e quem chega aqui tem apenas a sessão de recuperação criada em
 * /auth/confirmar-recuperacao.
 *
 * Esta rota não renderiza dados de negócio e não afrouxa as proteções do painel.
 *
 * O acesso à redefinição exige simultaneamente:
 *
 * 1. getUser() — valida o usuário no Supabase;
 * 2. getClaims() — obtém o session_id verificado;
 * 3. prova assinada de recuperação — vinculada ao usuário e à sessão.
 *
 * Quando existe MFA verificado na conta, o usuário também é encaminhado para
 * o desafio de segundo fator antes da alteração da senha.
 */
export default async function RedefinirSenha() {
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

  /**
   * MFA condicional.
   *
   * Contas que possuem fator MFA verificado precisam concluir AAL2 antes
   * da alteração da senha. Contas sem fator podem continuar normalmente.
   */
  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const decisao = decidirMfaNaRecuperacao(decidirSituacaoMfa(nivel ?? null, Boolean(erroNivel)));

  if (decisao === "desafiar-mfa") {
    redirect(ROTA_REDEFINIR_SENHA_MFA);
  }

  /**
   * Falha fechada.
   *
   * Se não for possível determinar corretamente a situação do MFA,
   * nenhuma alteração de senha é permitida.
   */
  if (decisao === "falhar") {
    return (
      <MolduraRedefinicao titulo="Definir nova senha" descricao={MENSAGEM_MFA_INDISPONIVEL}>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm leading-6 text-slate-600">
            Recarregue a página em instantes. Se o problema continuar, solicite um novo link de
            recuperação.
          </p>
        </div>
      </MolduraRedefinicao>
    );
  }

  return (
    <MolduraRedefinicao
      titulo="Definir nova senha"
      descricao="Escolha uma nova senha para a sua conta. Depois disso você entrará novamente."
    >
      <FormularioNovaSenha />
    </MolduraRedefinicao>
  );
}
