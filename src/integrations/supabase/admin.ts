import { createClient } from "@supabase/supabase-js";

import { sinaisDe, verificarChaveDeServico } from "@/lib/ambiente";

import { lerAmbienteSupabase } from "./env";
import type { Database } from "./types";

/**
 * Cliente do Supabase com a chave `service_role`, para o backend
 * administrativo de usuários (PR D).
 *
 * NUNCA importar este módulo de um Client Component. Ele só deve ser
 * referenciado por Server Actions (`"use server"`) e por scripts de teste em
 * Node — os únicos dois lugares que `src/lib/admin-usuarios/` alcança. O valor
 * de `SUPABASE_SERVICE_ROLE_KEY` não tem o prefixo `NEXT_PUBLIC_`, então o
 * Next não o embute no bundle do navegador; mesmo assim, a garantia real é
 * arquitetural — este arquivo não é importado por nada que rode no cliente.
 *
 * Por que precisa existir: `service_role` ignora RLS, e duas coisas do PR D
 * exigem exatamente isso —
 *
 *   - `auth.admin.*` (listar contas, convidar por e-mail, banir/desbanir):
 *     não existe outra forma de chamar a Admin API do GoTrue;
 *   - escrever em `public.user_roles`: a tabela só tem
 *     `user_roles_select_own` (SELECT da própria linha). Não há NENHUMA
 *     policy de INSERT/UPDATE/DELETE para `authenticated` — nem para admin em
 *     AAL2 —, de propósito, então só `service_role` grava papel.
 *
 * `public.user_operation_access`, ao contrário, JÁ tem policy `FOR ALL` para
 * admin em AAL2 desde a migration 013 — por isso
 * `src/lib/admin-usuarios/operacoes.ts` usa `criarClienteServidor()` (a
 * sessão real do admin), não este cliente. Menos código correndo com
 * privilégio total é menos superfície.
 *
 * `autoRefreshToken`/`persistSession` desligados: este cliente nunca autentica
 * como usuário nenhum, não tem sessão para renovar nem para guardar.
 */
export function criarClienteAdmin() {
  const { url } = lerAmbienteSupabase();
  const chave = lerChaveDeServico();

  return createClient<Database>(url, chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function lerChaveDeServico(): string {
  const chave = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!chave) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ausente. Defina-a no .env local e nas variáveis de " +
        "ambiente da hospedagem — sem ela, nenhuma operação administrativa de usuários funciona.",
    );
  }

  // Fora de Production na Vercel, a chave privilegiada de Production é barrada.
  verificarChaveDeServico(
    sinaisDe({
      VERCEL_ENV: process.env["VERCEL_ENV"],
      VERCEL: process.env["VERCEL"],
      VERCEL_URL: process.env["VERCEL_URL"],
      VERCEL_REGION: process.env["VERCEL_REGION"],
      VERCEL_DEPLOYMENT_ID: process.env["VERCEL_DEPLOYMENT_ID"],
      VERCEL_PROJECT_ID: process.env["VERCEL_PROJECT_ID"],
    }),
    chave,
  );

  return chave;
}
