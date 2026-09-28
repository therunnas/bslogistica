/**
 * O que `servico.ts` precisa de um cliente `service_role`, e nada mais.
 *
 * Contrato fechado, no mesmo espírito de `ClienteOperacional`
 * (`src/lib/operacional/rpc.ts`): métodos nomeados pelo que fazem, não um
 * `.from()` genérico repassado cru. Isso é o que permite
 * `scripts/testar-admin-usuarios.mjs` montar um objeto plano em memória — sem
 * rede, sem Supabase real — e ainda assim exercitar `servico.ts` de ponta a
 * ponta.
 *
 * `admin_audit_log` (migration 017) não está no `Database` gerado — mesma
 * lacuna já registrada para as RPCs da 013 no B2.1, e pelo mesmo motivo: este
 * ambiente não gera tipos do Supabase. `criarClienteAdministrativo` recebe o
 * cliente já tipado com `Database` (que conhece `user_roles` e `auth.admin`),
 * e só o repassa como `unknown` para a única chamada que o tipo canônico não
 * cobre — `admin_audit_log` —, com a forma mínima declarada logo abaixo, em
 * vez de sobrescrever o arquivo gerado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { ACAO_AUDITORIA } from "./tipos";
import type { Papel } from "./tipos";
import type { PapelBruto, UsuarioBruto } from "./dominio";

export interface ErroDaResposta {
  message: string;
  code?: string | undefined;
  details?: string | undefined;
  hint?: string | undefined;
}

export class ErroAdministrativo extends Error {
  readonly code?: string | undefined;

  constructor(erro: ErroDaResposta, operacao: string) {
    super(erro.message || `Falha em ${operacao}.`);
    this.name = "ErroAdministrativo";
    this.code = erro.code;
  }
}

/**
 * `resposta` fica `unknown` de propósito: as respostas reais do `supabase-js`
 * são uniões discriminadas onde `data` muda de forma entre o ramo de sucesso e
 * o de erro (ex.: `{ data: { user: User } }` vs. `{ data: { user: null } }`),
 * e o TypeScript não estreita isso a partir de um tipo genérico só pelo
 * `if (error)`. Cada chamador sabe o tipo esperado de `data` no ramo de
 * sucesso — que é exatamente o que ele passa como `T`.
 */
function exigirSucesso<T>(
  resposta: { data: unknown; error: ErroDaResposta | null },
  operacao: string,
): T {
  if (resposta.error) {
    throw new ErroAdministrativo(resposta.error, operacao);
  }
  return resposta.data as T;
}

interface AdminApiUser {
  id: string;
  email?: string | null | undefined;
  created_at: string;
  last_sign_in_at?: string | null | undefined;
  banned_until?: string | null | undefined;
}

export interface EntradaDeAuditoria {
  actorId: string;
  action: (typeof ACAO_AUDITORIA)[keyof typeof ACAO_AUDITORIA];
  targetUserId?: string | null | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface ClienteAdministrativo {
  listarUsuarios(): Promise<UsuarioBruto[]>;
  convidarPorEmail(email: string, nomeCompleto: string | null): Promise<{ userId: string }>;
  banirUsuario(userId: string): Promise<void>;
  desbanirUsuario(userId: string): Promise<void>;
  listarPapeis(): Promise<PapelBruto[]>;
  concederPapel(userId: string, papel: Papel): Promise<void>;
  revogarPapel(userId: string, papel: Papel): Promise<void>;
  revogarTodosOsPapeis(userId: string): Promise<void>;
  registrarAuditoria(entrada: EntradaDeAuditoria): Promise<void>;
}

/**
 * A tabela que o `Database` gerado não conhece. Forma mínima: só as duas
 * operações que este módulo faz nela, ambas de escrita — ninguém aqui LÊ
 * `admin_audit_log` (é a tela do PR E que vai ler).
 */
interface ClienteComAuditoria {
  from(tabela: "admin_audit_log"): {
    insert(valores: {
      actor_id: string;
      action: string;
      target_user_id: string | null;
      details: Record<string, unknown>;
    }): PromiseLike<{ data: unknown; error: ErroDaResposta | null }>;
  };
}

/** No máximo 200 contas por página: folga generosa para uma equipe pequena. */
const CONTAS_POR_PAGINA = 200;

export function criarClienteAdministrativo(
  supabase: SupabaseClient<Database>,
): ClienteAdministrativo {
  const comAuditoria = supabase as unknown as ClienteComAuditoria;

  return {
    async listarUsuarios() {
      const resposta = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: CONTAS_POR_PAGINA,
      });
      const dados = exigirSucesso<{ users: AdminApiUser[] }>(resposta, "listar usuários");
      return dados.users.map((usuario) => ({
        id: usuario.id,
        email: usuario.email ?? null,
        created_at: usuario.created_at,
        last_sign_in_at: usuario.last_sign_in_at ?? null,
        banned_until: usuario.banned_until ?? null,
      }));
    },

    async convidarPorEmail(email, nomeCompleto) {
      const resposta = await supabase.auth.admin.inviteUserByEmail(email, {
        data: nomeCompleto ? { full_name: nomeCompleto } : {},
      });
      const dados = exigirSucesso<{ user: AdminApiUser | null }>(resposta, "convidar usuário");
      if (!dados.user) {
        throw new Error("O convite não devolveu o usuário criado.");
      }
      return { userId: dados.user.id };
    },

    async banirUsuario(userId) {
      const resposta = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      exigirSucesso(resposta, "banir usuário");
    },

    async desbanirUsuario(userId) {
      const resposta = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });
      exigirSucesso(resposta, "desbanir usuário");
    },

    async listarPapeis() {
      const resposta = await supabase.from("user_roles").select("user_id, role");
      return exigirSucesso<PapelBruto[]>(resposta, "listar papéis");
    },

    async concederPapel(userId, papel) {
      const resposta = await supabase.from("user_roles").insert({ user_id: userId, role: papel });
      // UNIQUE (user_id, role): conceder um papel já concedido é idempotente,
      // não erro — `23505` é o único código tolerado aqui.
      if (resposta.error && resposta.error.code !== "23505") {
        throw new ErroAdministrativo(resposta.error, "conceder papel");
      }
    },

    async revogarPapel(userId, papel) {
      const resposta = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", papel);
      exigirSucesso(resposta, "revogar papel");
    },

    async revogarTodosOsPapeis(userId) {
      const resposta = await supabase.from("user_roles").delete().eq("user_id", userId);
      exigirSucesso(resposta, "revogar todos os papéis");
    },

    async registrarAuditoria(entrada) {
      const resposta = await comAuditoria.from("admin_audit_log").insert({
        actor_id: entrada.actorId,
        action: entrada.action,
        target_user_id: entrada.targetUserId ?? null,
        details: entrada.details ?? {},
      });
      exigirSucesso(resposta, "registrar auditoria");
    },
  };
}
