import { sanearIntencoes } from "./container-servico-intencao";

type StorageDeIntencoes = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
type Canal = {
  onmessage: ((evento: MessageEvent) => void) | null;
  postMessage: (mensagem: string) => void;
  close: () => void;
};

/** O canal transmite apenas invalidação; nunca sessão, identidade ou conteúdo financeiro. */
export function observarPrivacidadeContainers(
  canal: Canal | null,
  bloquear: () => void,
  storage?: StorageDeIntencoes,
) {
  const sanear = () => {
    try {
      sanearIntencoes(storage ?? globalThis.sessionStorage);
      return true;
    } catch {
      // A indisponibilidade pertence ao recurso local, não à autorização do painel.
      return false;
    }
  };
  const armazenamentoSeguro = sanear();
  const invalidar = () => {
    bloquear();
    return sanear();
  };
  if (canal)
    canal.onmessage = () => {
      try {
        invalidar();
      } catch {
        // O conteúdo já foi bloqueado; falha de storage não pode reabri-lo.
      }
    };
  return {
    armazenamentoSeguro,
    invalidar,
    sair() {
      // O conteúdo é retirado antes da resposta do logout, inclusive se ela falhar.
      let seguro = false;
      try {
        seguro = invalidar();
      } finally {
        try {
          canal?.postMessage("bloquear");
        } catch {
          // Sem canal, a proteção local e o observador de Auth continuam ativos.
        }
      }
      return seguro;
    },
    fechar() {
      if (canal) canal.onmessage = null;
      canal?.close();
    },
  };
}
