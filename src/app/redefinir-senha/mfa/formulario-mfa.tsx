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
 * O componente não fala com o Supabase: ele só coleta o código e chama a Server
 * Action. `challengeAndVerify`, a leitura dos fatores e a reemissão da prova
 * acontecem no servidor — aqui não existe cliente do Supabase, nem id de fator,
 * nem prova, nem token.
 *
 * O código não vai para log, URL nem armazenamento local: vive no estado do
 * componente e some quando a tela sai.
 */
export function FormularioMfaRecuperacao() {
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    setEnviando(true);

    // No sucesso a action redireciona para /redefinir-senha e esta promessa não
    // devolve estado — só o caminho de erro chega de volta aqui.
    const estado = await confirmarSegundoFator({ codigo });

    if (estado?.situacao === "erro") {
      toast.error(estado.mensagem);
      setCodigo("");
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={confirmar} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="codigo">Código do aplicativo</Label>
        <Input
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Confirmando..." : "Confirmar"}
      </Button>
    </form>
  );
}
