import { useState } from "react";

/**
 * Trava SÍNCRONA contra clique duplo nas ações administrativas de usuário.
 *
 * `disabled={mutation.isPending}` sozinho não basta: o `isPending` do TanStack Query só chega ao
 * componente no próximo ciclo de notificação, e dois cliques no mesmo instante passam os dois
 * antes disso. Comprovado no E2E local do CP-01: um duplo clique em "Enviar convite" chamou a
 * Server Action duas vezes (dois e-mails de convite, duas linhas `convite_criado` na auditoria) e
 * "Atribuir" registrou `operacao_atribuida` duas vezes.
 *
 * A trava fica num objeto estável por componente: a primeira ação ocupa, as demais são
 * ignoradas até a primeira terminar (`onSettled`). O botão continua desabilitado pelo
 * `isPending` — a trava é a primeira barreira, não a única.
 */
export interface Trava {
  tentar(): boolean;
  liberar(): void;
}

export function criarTrava(): Trava {
  let ocupada = false;
  return {
    tentar() {
      if (ocupada) return false;
      ocupada = true;
      return true;
    },
    liberar() {
      ocupada = false;
    },
  };
}

export function useTrava(): Trava {
  const [trava] = useState(criarTrava);
  return trava;
}
