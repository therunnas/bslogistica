/**
 * Transporte do registro de adicional (FIN-20D, migration 047).
 *
 * O registro passa SEMPRE pela RPC idempotente, com a chave da intenção. A RPC antiga (sem chave) só é
 * usada quando a nova NÃO EXISTE no banco (PGRST202: banco anterior à 047) — a janela entre publicar o
 * frontend e aplicar a migration, em que a antiga ainda existe. Qualquer outro erro (chave recusada,
 * sem permissão, validação, rede) é propagado: nada contorna a proteção. Depois da 047 a antiga não é
 * executável pela API; se o fallback ocorresse, falharia fechado com 42501.
 */

import { RPC_ADICIONAIS } from "./adicionais";

export const CODIGO_DA_RPC_AUSENTE = "PGRST202";
export const CODIGO_DE_CHAVE_REUTILIZADA = "23505";
export const MENSAGEM_CHAVE_REUTILIZADA =
  "Este envio repete uma tentativa anterior com dados diferentes. Feche o formulário e registre o adicional de novo.";

export type ErroDaRpc = { code?: string; message?: string } | null;
export type ChamadaDeRpc = (
  nome: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: ErroDaRpc }>;

type Parametros = Record<string, string | number | null>;

/** Parâmetros nomeados da RPC: referência, operação e competência só quando existem. */
export function argumentosDoRegistro(params: Parametros): Record<string, unknown> {
  return {
    p_client_id: params["p_client_id"],
    p_period_start: params["p_period_start"],
    p_period_end: params["p_period_end"],
    p_description: params["p_description"],
    p_amount: params["p_amount"],
    ...(params["p_reference"] != null ? { p_reference: params["p_reference"] } : {}),
    ...(params["p_operation_id"] != null ? { p_operation_id: params["p_operation_id"] } : {}),
    ...("p_billing_period_start" in params
      ? {
          p_billing_period_start: params["p_billing_period_start"],
          p_billing_period_end: params["p_billing_period_end"],
        }
      : {}),
  };
}

function idDaResposta(data: unknown): string {
  if (typeof data !== "string") throw new Error("Resposta inesperada ao registrar o adicional.");
  return data;
}

/** Registra o adicional e devolve o id (o mesmo, em qualquer retry da mesma chave). */
export async function registrarAdicional(
  chamar: ChamadaDeRpc,
  params: Parametros,
  chave: string,
): Promise<string> {
  const args = argumentosDoRegistro(params);
  const nova = await chamar(RPC_ADICIONAIS.registrar, { p_idempotency_key: chave, ...args });
  if (nova.error === null) return idDaResposta(nova.data);
  if (nova.error.code !== CODIGO_DA_RPC_AUSENTE) throw nova.error;

  // Banco anterior à 047: só aqui a RPC antiga (sem chave) é chamada.
  const antiga = await chamar(RPC_ADICIONAIS.registrarAntiga, args);
  if (antiga.error !== null) throw antiga.error;
  return idDaResposta(antiga.data);
}
