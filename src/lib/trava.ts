import { useEffect, useState } from "react";

/**
 * Trava SÍNCRONA contra clique duplo (e Enter repetido) em ações que gravam.
 *
 * `disabled={mutation.isPending}` sozinho não basta: o `isPending` do TanStack Query só chega ao
 * componente no próximo ciclo de notificação, e dois cliques no mesmo instante passam os dois
 * antes disso. Comprovado no E2E local: no CP-01, um duplo clique em "Enviar convite" chamou a
 * Server Action duas vezes e "Atribuir" registrou `operacao_atribuida` duas vezes; no CP-02,
 * "Salvar cliente" criou dois clientes (D3) e "Salvar contrato" dois contratos.
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

/**
 * Trava de formulário que FECHA o diálogo ao gravar. Depois do sucesso o diálogo continua montado
 * durante a animação de saída, com o botão focado e o formulário preenchido: liberar a trava no
 * `onSettled` deixava um clique ou Enter nesse intervalo gravar de novo (CI do acd1747: o CL3 criou
 * dois clientes; reproduzido no E2E D3b para cliente, colaborador, operação e turno).
 *
 * Regra de uso: libere só no `onError` (para tentar de novo); no sucesso a trava fica ocupada e só
 * se solta quando o diálogo abre outra vez.
 */
export function useTravaDoDialogo(aberto: boolean): Trava {
  const trava = useTrava();
  useEffect(() => {
    if (aberto) trava.liberar();
  }, [aberto, trava]);
  return trava;
}
