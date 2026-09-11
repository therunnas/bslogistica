import type { Metadata } from "next";
import { cookies } from "next/headers";

import { MolduraAuth } from "@/components/moldura-auth";
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
  // O layout raiz já declara noindex para todo o app; repetido aqui porque
  // esta tela nasce de um link enviado por e-mail e não pode acabar indexada
  // por um caminho que ninguém previu.
  robots: { index: false, follow: false },
};

/**
 * Confirmação deliberada antes de consumir o token de recuperação.
 *
 * Esta tela existe para que exista um POST. O token de uso único era gasto no
 * GET do link, e scanners de gateway de e-mail — que visitam cada URL da
 * mensagem automaticamente — queimavam a recuperação antes do usuário clicar.
 * Um clique aqui é o que separa a varredura automática da intenção real.
 *
 * Server Component puro, sem `"use client"`: o `<form action={...}>` do Next
 * posta direto para a Server Action e funciona sem JavaScript no navegador.
 * Isso importa além da robustez — é o que mantém o token fora do bundle.
 *
 * A página NÃO recebe nem exibe o `token_hash`. Ele fica no cookie `httpOnly`
 * gravado pelo GET e só é lido no servidor, dentro da action. Aqui apenas se
 * verifica que o cookie existe, para não oferecer um botão que falharia.
 */
export default async function ConfirmarRecuperacaoPage() {
  const armazemDeCookies = await cookies();
  const pendente = armazemDeCookies.get(NOME_DO_COOKIE_PENDENTE)?.value;

  // Sem cookie: link aberto direto, cookie expirado (5 min) ou descartado pelo
  // navegador. Mensagem única, igual à de token inválido — esta tela não conta
  // qual dos casos aconteceu.
  if (typeof pendente !== "string" || pendente.trim() === "") {
    return (
      <MolduraAuth titulo={TITULO_CONFIRMAR_RECUPERACAO} descricao={MENSAGEM_LINK_INVALIDO}>
        <Button asChild className="w-full">
          <a href={ROTA_ESQUECI_SENHA}>Solicitar novo link</a>
        </Button>
      </MolduraAuth>
    );
  }

  return (
    <MolduraAuth titulo={TITULO_CONFIRMAR_RECUPERACAO} descricao={MENSAGEM_CONFIRMAR_RECUPERACAO}>
      <form action={confirmarRecuperacao}>
        <Button type="submit" className="w-full">
          {ROTULO_CONFIRMAR_RECUPERACAO}
        </Button>
      </form>
    </MolduraAuth>
  );
}
