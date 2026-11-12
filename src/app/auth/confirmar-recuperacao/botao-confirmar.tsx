"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { ROTULO_CONFIRMAR_RECUPERACAO } from "@/lib/recuperacao-senha";

/**
 * Botão "Continuar" da confirmação de recuperação, com envio ÚNICO.
 *
 * O token do link é de uso único. Antes, um duplo clique postava o formulário duas vezes: o
 * primeiro `verifyOtp` consumia o token e criava a sessão, o segundo encontrava o token gasto e
 * mandava para "link inválido" — o próprio usuário invalidava o link que acabara de usar
 * (reproduzido no E2E do CP-01, R12).
 *
 * A trava é síncrona (um `ref`, marcado no próprio clique): o `pending` do `useFormStatus` só chega
 * depois do envio começar e não alcança um segundo clique imediato. Enter no formulário também
 * passa por aqui (o envio implícito clica no botão de envio). A Server Action sempre termina em
 * redirecionamento, então a página não volta a precisar do botão.
 *
 * O token continua só no cookie httpOnly: este componente não recebe nem envia nada além do clique.
 */
export function BotaoConfirmarRecuperacao() {
  const { pending } = useFormStatus();
  const enviado = useRef(false);

  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(evento) => {
        if (enviado.current) {
          evento.preventDefault();
          return;
        }
        enviado.current = true;
      }}
      className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823B43] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Aguarde..." : ROTULO_CONFIRMAR_RECUPERACAO}
    </Button>
  );
}
