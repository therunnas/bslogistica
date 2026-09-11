"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MolduraAuth } from "@/components/moldura-auth";
import {
  MENSAGEM_FALHA_GENERICA,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_SOLICITACAO_ENVIADA,
  ROTA_LOGIN,
  decidirRespostaDaSolicitacao,
} from "@/lib/recuperacao-senha";

/**
 * Aviso de link inválido, vindo de /auth/confirm.
 *
 * Em componente próprio porque `useSearchParams` obriga um limite de Suspense
 * — sem ele o build falha ao pré-renderizar esta rota estática.
 */
function AvisoLinkInvalido() {
  const parametros = useSearchParams();
  if (parametros.get("status") !== "link-invalido") return null;

  return (
    <p
      role="status"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground"
    >
      {MENSAGEM_LINK_INVALIDO}
    </p>
  );
}

/**
 * Solicitação do link de recuperação de senha.
 *
 * Rota pública: quem esqueceu a senha, por definição, não tem sessão. Não cria
 * conta e não faz signUp — o sistema não tem cadastro público, e este fluxo
 * serve só a quem o administrador já cadastrou.
 *
 * A tela nunca revela se o e-mail digitado tem conta. Sucesso, endereço
 * desconhecido e e-mail malformado terminam na mesma frase; só
 * indisponibilidade real muda o texto. Ver `decidirRespostaDaSolicitacao`.
 */
export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function solicitar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setAviso(null);

    const supabase = criarClienteNavegador();

    // Sem `redirectTo`: o destino sai do Site URL configurado no Supabase, que
    // já aponta para a produção. Passar um daqui exigiria mexer em
    // additional_redirect_urls e abriria uma superfície que não precisa existir.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());

    setAviso(
      decidirRespostaDaSolicitacao(error) === "falha-temporaria"
        ? MENSAGEM_FALHA_GENERICA
        : MENSAGEM_SOLICITACAO_ENVIADA,
    );
    setEnviando(false);
  }

  return (
    <MolduraAuth
      titulo="Recuperar senha"
      descricao="Informe o e-mail da sua conta e enviaremos um link para definir uma nova senha."
    >
      <Suspense fallback={null}>
        <AvisoLinkInvalido />
      </Suspense>

      <form onSubmit={solicitar} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar link de recuperação"}
        </Button>
      </form>

      {aviso ? (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {aviso}
        </p>
      ) : null}

      <p className="text-center text-sm">
        <Link
          href={ROTA_LOGIN}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          Voltar para entrar
        </Link>
      </p>
    </MolduraAuth>
  );
}
