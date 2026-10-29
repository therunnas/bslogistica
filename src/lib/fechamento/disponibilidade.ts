/**
 * O Fechamento só existe quando o banco o sustenta.
 *
 * Ele lê funções e tabelas das migrations 029 e 030 (`resumo_financeiro_periodo`,
 * `ajustes_de_arredondamento_acumulado`, `saldo_de_horas_do_periodo`, `billing_additionals`,
 * `invoice_items.kind`, `billed_overtime_minutes`). Num banco sem elas — Production na 028 — a
 * consulta falharia no meio do carregamento. Por isso a disponibilidade é decidida ANTES, pela
 * consulta oficial do estado do motor (`estado_motor_vigencia`), que também anuncia os recursos:
 *
 *   disponível  ⇔  a consulta respondeu, o estado é consistente, a 030 está anunciada
 *                  (`regras_definitivas = true`) e o motor novo está LIGADO (`ativo = true`).
 *
 * Qualquer outra coisa — erro, resposta fora do formato, 030 ausente, motor desligado ou estado
 * inconsistente — nega o acesso ao módulo. Negar é o padrão: "não sei" nunca vira "disponível".
 *
 * Este módulo só importa TIPOS e não usa `service_role`: a consulta usa o cliente da SESSÃO do
 * admin, e o próprio banco exige `admin` e AAL2 nela. A decisão (`decidirDisponibilidade`) é pura.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type MotivoDeIndisponibilidade =
  "verificacao-falhou" | "estado-desconhecido" | "sem-regras-definitivas" | "motor-desligado";

export type Disponibilidade =
  { disponivel: true } | { disponivel: false; motivo: MotivoDeIndisponibilidade };

/** Frases fixas, sem detalhe do banco. */
export const MENSAGEM_DE_INDISPONIBILIDADE: Record<MotivoDeIndisponibilidade, string> = {
  "verificacao-falhou":
    "Não foi possível verificar se o Fechamento está disponível neste ambiente. Tente novamente mais tarde.",
  "estado-desconhecido":
    "As regras financeiras não puderam ser confirmadas, então o Fechamento está indisponível.",
  "sem-regras-definitivas":
    "O Fechamento ainda não está disponível neste ambiente: as regras financeiras definitivas não foram instaladas.",
  "motor-desligado":
    "O Fechamento está indisponível enquanto as vigências financeiras não estiverem ativadas.",
};

/** Decide a partir da resposta e do erro de `estado_motor_vigencia`, tal como vieram. */
export function decidirDisponibilidade(data: unknown, erro: unknown): Disponibilidade {
  if (erro !== null && erro !== undefined) {
    return { disponivel: false, motivo: "verificacao-falhou" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { disponivel: false, motivo: "estado-desconhecido" };
  }
  const r = data as { ativo?: unknown; consistente?: unknown; regras_definitivas?: unknown };
  if (typeof r.ativo !== "boolean" || r.consistente !== true) {
    return { disponivel: false, motivo: "estado-desconhecido" };
  }
  if (r.regras_definitivas !== true) {
    return { disponivel: false, motivo: "sem-regras-definitivas" };
  }
  if (!r.ativo) return { disponivel: false, motivo: "motor-desligado" };
  return { disponivel: true };
}

/**
 * Consulta o banco e decide. Nunca lança: falha de rede, função ausente ou permissão negada viram
 * "verificação falhou", e o módulo fica indisponível.
 */
export async function verificarDisponibilidade(
  supabase: SupabaseClient<Database>,
): Promise<Disponibilidade> {
  try {
    const { data, error } = await supabase.rpc("estado_motor_vigencia");
    return decidirDisponibilidade(data, error);
  } catch {
    return { disponivel: false, motivo: "verificacao-falhou" };
  }
}
