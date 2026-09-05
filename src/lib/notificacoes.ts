import { toast as sonner, type ExternalToast } from "sonner";

/**
 * Camada fina sobre o `toast` do sonner, só para dar duração por tipo.
 *
 * O sonner aceita uma duração global e uma por chamada, mas não uma por tipo.
 * Sem isto, ou todo mundo dura o mesmo tempo — e aí ou o sucesso demora demais
 * ou o erro some antes de ser lido — ou seria preciso repetir `{ duration }` em
 * cada uma das chamadas espalhadas pelas telas.
 *
 * Cada chamada ainda pode sobrescrever passando `duration` nas opções.
 */
const DURACAO = {
  /** Confirmação simples: some rápido, o usuário já sabe o que fez. */
  sucesso: 2500,
  /** Precisa ser lido com calma, às vezes tem detalhe técnico. */
  erro: 5500,
  /** Meio-termo: informa algo que o usuário não pediu explicitamente. */
  info: 4000,
} as const;

export const toast = {
  success: (mensagem: string, opcoes?: ExternalToast) =>
    sonner.success(mensagem, { duration: DURACAO.sucesso, ...opcoes }),
  error: (mensagem: string, opcoes?: ExternalToast) =>
    sonner.error(mensagem, { duration: DURACAO.erro, ...opcoes }),
  info: (mensagem: string, opcoes?: ExternalToast) =>
    sonner.info(mensagem, { duration: DURACAO.info, ...opcoes }),
  warning: (mensagem: string, opcoes?: ExternalToast) =>
    sonner.warning(mensagem, { duration: DURACAO.info, ...opcoes }),
};
