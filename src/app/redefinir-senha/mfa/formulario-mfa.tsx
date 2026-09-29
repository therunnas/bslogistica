"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notificacoes";

import { confirmarSegundoFator } from "./actions";

/**
 * Campo do código TOTP.
 *
 * O componente não fala diretamente com o Supabase.
 * Ele apenas coleta o código e chama a Server Action.
 *
 * challengeAndVerify, leitura dos fatores e reemissão da prova
 * continuam acontecendo exclusivamente no servidor.
 *
 * O código permanece apenas no estado do componente e não é
 * enviado para logs, URL ou armazenamento local.
 */
export function FormularioMfaRecuperacao() {
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar(evento: React.FormEvent) {
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
      <div className="space-y-2">
        <Label htmlFor="codigo" className="text-sm font-medium text-slate-900">
          Código do aplicativo
        </Label>

        <Input
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          value={codigo}
          onChange={(evento) => setCodigo(evento.target.value)}
          required
          maxLength={6}
          className="h-12 rounded-lg border-slate-300 bg-white px-4 text-center text-lg tracking-[0.35em] shadow-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={enviando}
        className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823B43] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {enviando ? "Confirmando..." : "Confirmar"}
      </Button>
    </form>
  );
}
