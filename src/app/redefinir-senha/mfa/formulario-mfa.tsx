"use client";

import { useState, type FormEvent } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notificacoes";

import { confirmarSegundoFator } from "./actions";

export function FormularioMfaRecuperacao() {
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar(evento: FormEvent) {
    evento.preventDefault();

    if (enviando) {
      return;
    }

    setEnviando(true);

    const estado = await confirmarSegundoFator({
      codigo,
    });

    if (estado?.situacao === "erro") {
      toast.error(estado.mensagem);
      setCodigo("");
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={confirmar} className="space-y-5">
      <div className="rounded-xl border border-border bg-secondary/35 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
            <Smartphone className="h-4 w-4" />
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">Verificação em duas etapas</p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Informe o código exibido no aplicativo autenticador vinculado à sua conta.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="codigo">Código do aplicativo</Label>

        <Input
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          value={codigo}
          onChange={(event) => setCodigo(event.target.value)}
          required
          autoFocus
          className="h-12 rounded-xl border-input bg-secondary/50 text-center font-mono text-lg tracking-[0.3em] text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
        />
      </div>

      <Button type="submit" className="h-11 w-full rounded-xl" disabled={enviando}>
        <ShieldCheck className="h-4 w-4" />

        {enviando ? "Confirmando..." : "Confirmar código"}
      </Button>
    </form>
  );
}
