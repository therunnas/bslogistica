"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notificacoes";
import { validarNovaSenha } from "@/lib/recuperacao-senha";

import { redefinirSenha } from "./actions";

/**
 * Formulário da nova senha.
 *
 * O formulário faz apenas a validação de UX.
 * A Server Action revalida a prova de recuperação e realiza
 * efetivamente a alteração da senha.
 *
 * A senha permanece somente no estado do componente e não é
 * enviada para logs, URL ou armazenamento local.
 */
export function FormularioNovaSenha() {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function redefinir(evento: React.FormEvent) {
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
        <Label htmlFor="senha" className="text-sm font-medium text-slate-900">
          Nova senha
        </Label>

        <Input
          id="senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          required
          placeholder="Digite sua nova senha"
          className="h-12 rounded-lg border-slate-300 bg-white px-4 shadow-sm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmacao" className="text-sm font-medium text-slate-900">
          Confirmar nova senha
        </Label>

        <Input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(evento) => setConfirmacao(evento.target.value)}
          required
          placeholder="Digite novamente sua nova senha"
          className="h-12 rounded-lg border-slate-300 bg-white px-4 shadow-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={enviando}
        className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823B43] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {enviando ? "Aguarde..." : "Redefinir senha"}
      </Button>
    </form>
  );
}
