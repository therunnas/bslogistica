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
  storage: StorageDeIntencoes = globalThis.sessionStorage,
) {
  sanearIntencoes(storage);
  const invalidar = () => {
    bloquear();
    sanearIntencoes(storage);
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
    invalidar,
    sair() {
      // O conteúdo é retirado antes da resposta do logout, inclusive se ela falhar.
      invalidar();
      try {
        canal?.postMessage("bloquear");
      } catch {
        // Sem canal, o marcador continua sem valores e o evento de Auth ainda protege a sessão.
      }
    },
    fechar() {
      if (canal) canal.onmessage = null;
      canal?.close();
    },
  };
}
