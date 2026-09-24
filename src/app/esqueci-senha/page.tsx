"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ArrowLeft, Mail, Send } from "lucide-react";

import { MolduraAuth } from "@/components/moldura-auth";
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
    <div
      role="status"
      className="rounded-xl border border-destructive/20 bg-destructive/[0.07] px-4 py-3"
    >
      <p className="text-sm font-medium text-destructive">Link de recuperação inválido</p>

      <p className="mt-1 text-xs leading-5 text-muted-foreground">{MENSAGEM_LINK_INVALIDO}</p>
    </div>
  );
}

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function solicitar(evento: FormEvent) {
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
    <MolduraAuth
      titulo="Recuperar senha"
      descricao="Informe o e-mail da sua conta para receber as instruções de recuperação."
    >
      <Suspense fallback={null}>
        <AvisoLinkInvalido />
      </Suspense>

      <form onSubmit={solicitar} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>

          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="h-11 rounded-xl border-input bg-secondary/50 pl-10 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
            />
          </div>
        </div>

        <Button type="submit" className="h-11 w-full rounded-xl" disabled={enviando}>
          <Send className="h-4 w-4" />

          {enviando ? "Enviando..." : "Enviar link de recuperação"}
        </Button>
      </form>

      {aviso ? (
        <div role="status" className="rounded-xl border border-border bg-secondary/40 px-4 py-3">
          <p className="text-xs leading-5 text-muted-foreground">{aviso}</p>
        </div>
      ) : null}

      <div className="border-t border-border pt-5">
        <Link
          href={ROTA_LOGIN}
          className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para entrar
        </Link>
      </div>
    </MolduraAuth>
  );
}
