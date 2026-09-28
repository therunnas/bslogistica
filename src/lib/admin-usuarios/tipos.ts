/**
 * Tipos do backend administrativo de usuários (PR D).
 *
 * `Papel` vem do enum gerado (`app_role`), porque `user_roles` já está no
 * `Database` canônico. `admin_audit_log` e a Admin API do GoTrue não estão —
 * a primeira nasceu na migration 017, sem geração de tipos disponível neste
 * ambiente (mesma limitação registrada no B2.1 para as RPCs da 013); a
 * segunda é parte do `supabase-js`, não do schema do Postgres. Por isso os
 * dois têm forma própria aqui, em vez de importada de `types.ts` — o mesmo
 * padrão de `src/lib/operacional/tipos.ts`.
 */

import type { Database } from "@/integrations/supabase/types";

export type Papel = Database["public"]["Enums"]["app_role"];

export interface UsuarioAdministrativo {
  id: string;
  email: string | null;
  nomeCompleto: string | null;
  papeis: Papel[];
  banido: boolean;
  criadoEm: string;
  ultimoLoginEm: string | null;
}

export interface AtribuicaoDeOperacao {
  operationId: string;
  criadoEm: string;
}

export type ResultadoConvite =
  { situacao: "convidado"; userId: string } | { situacao: "erro"; mensagem: string };

export type ResultadoAlteracaoDePapel =
  | { situacao: "concedido" }
  | { situacao: "revogado" }
  | { situacao: "ultimo-admin"; mensagem: string }
  | { situacao: "erro"; mensagem: string };

export type ResultadoRevogacaoDeAcesso =
  | { situacao: "revogado" }
  | { situacao: "ultimo-admin"; mensagem: string }
  | { situacao: "erro"; mensagem: string };

export type ResultadoReativacao =
  { situacao: "reativado" } | { situacao: "erro"; mensagem: string };

export type ResultadoAtribuicaoDeOperacao =
  { situacao: "atribuida" } | { situacao: "erro"; mensagem: string };

export type ResultadoRemocaoDeOperacao =
  { situacao: "removida" } | { situacao: "erro"; mensagem: string };

/** Vocabulário de `admin_audit_log.action`. Mantido em código, não em CHECK. */
export const ACAO_AUDITORIA = {
  convite: "convite_criado",
  papelConcedido: "papel_concedido",
  papelRevogado: "papel_revogado",
  acessoRevogado: "acesso_revogado",
  acessoReativado: "acesso_reativado",
  operacaoAtribuida: "operacao_atribuida",
  operacaoRemovida: "operacao_removida",
} as const;

export type AcaoDeAuditoria = (typeof ACAO_AUDITORIA)[keyof typeof ACAO_AUDITORIA];
