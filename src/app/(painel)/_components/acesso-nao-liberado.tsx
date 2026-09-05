import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sair } from "../_acoes";

/**
 * Tela de quem entrou mas ainda não tem papel atribuído.
 *
 * Acontece quando a conta existe no Supabase Auth mas ninguém definiu se ela é
 * admin ou operacional. A RLS já impediria a leitura dos dados; isto apenas
 * explica a situação em vez de mostrar um painel vazio e sem sentido.
 */
export function AcessoNaoLiberado({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
          <ShieldAlert className="size-6 text-muted-foreground" />
        </div>
        <h1 className="mt-5 font-display text-xl font-semibold">Acesso não liberado</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Sua conta foi criada, mas ainda não tem permissão de uso. Peça ao administrador do sistema
          para liberar o seu acesso.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Conectado como <span className="font-medium text-foreground">{email}</span>
        </p>
        <form action={sair} className="mt-6">
          <Button type="submit" variant="outline" className="w-full">
            Sair
          </Button>
        </form>
      </div>
    </div>
  );
}
