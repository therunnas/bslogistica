"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notificacoes";
import { validarNovaSenha } from "@/lib/recuperacao-senha";

import { redefinirSenha } from "./actions";

export function FormularioNovaSenha() {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function redefinir(evento: FormEvent) {
    evento.preventDefault();

    if (enviando) {
      return;
    }

    const validacao = validarNovaSenha(senha, confirmacao);

    if (!validacao.valida) {
      toast.error(validacao.mensagem);
      return;
    }

    setEnviando(true);

    const estado = await redefinirSenha({
      senha,
      confirmacao,
    });

    if (estado?.situacao === "erro") {
      toast.error(estado.mensagem);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={redefinir} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="senha">Nova senha</Label>

        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <Input
            id="senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(event) => setSenha(event.target.value)}
            required
            className="h-11 rounded-xl border-input bg-secondary/50 pl-10 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmacao">Confirmar nova senha</Label>

        <div className="relative">
          <ShieldCheck className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <Input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(event) => setConfirmacao(event.target.value)}
            required
            className="h-11 rounded-xl border-input bg-secondary/50 pl-10 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
          />
        </div>
      </div>

      <Button type="submit" className="h-11 w-full rounded-xl" disabled={enviando}>
        <ShieldCheck className="h-4 w-4" />

        {enviando ? "Aguarde..." : "Redefinir senha"}
      </Button>

      <div className="rounded-xl border border-border bg-secondary/35 px-4 py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          Após concluir a redefinição, você precisará entrar novamente no sistema.
        </p>
      </div>
    </form>
  );
}
