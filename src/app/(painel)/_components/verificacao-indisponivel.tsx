"use client";

import { ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sair } from "../_acoes";

/**
 * Tela de quando não foi possível verificar o segundo fator.
 *
 * Não é o mesmo que "não tem fator". A consulta ao nível de garantia é uma
 * chamada de rede e pode falhar por motivo passageiro; quando falha, não se
 * sabe o estado do fator. Tratar isso como ausência mandava para o cadastro,
 * onde a conta que já tinha fator batia num erro sem saída.
 *
 * Falha fechada: o painel não é renderizado. O que se oferece aqui é tentar de
 * novo — e sair, para quem preferir recomeçar a sessão.
 *
 * A mensagem é deliberadamente neutra. O motivo técnico não ajuda quem está
 * tentando entrar e, num painel administrativo, detalhe de erro de auth é
 * informação que não precisa aparecer na tela.
 */
export function VerificacaoIndisponivel({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
          <ShieldQuestion className="size-6 text-muted-foreground" />
        </div>
        <h1 className="mt-5 font-display text-xl font-semibold">
          Não foi possível verificar o segundo fator
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Tente novamente. Se continuar, saia e entre outra vez.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Conectado como <span className="font-medium text-foreground">{email}</span>
        </p>

        <Button type="button" className="mt-6 w-full" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>

        <form action={sair} className="mt-2">
          <Button type="submit" variant="outline" className="w-full">
            Sair
          </Button>
        </form>
      </div>
    </div>
  );
}
