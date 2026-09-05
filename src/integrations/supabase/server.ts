import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { lerAmbienteSupabase } from "./env";
import type { Database } from "./types";

/**
 * Cliente do Supabase para Server Components, Route Handlers e Server Actions.
 *
 * Usa a mesma chave publicável do navegador, e não a secreta: as consultas
 * seguem passando pela RLS em nome do usuário da sessão. É o comportamento
 * desejado — o servidor não deve enxergar mais do que o usuário enxergaria.
 */
export async function criarClienteServidor() {
  const { url, chave } = lerAmbienteSupabase();
  const armazemDeCookies = await cookies();

  return createServerClient<Database>(url, chave, {
    cookies: {
      getAll() {
        return armazemDeCookies.getAll();
      },
      setAll(cookiesParaGravar) {
        try {
          for (const { name, value, options } of cookiesParaGravar) {
            armazemDeCookies.set(name, value, options);
          }
        } catch {
          // Server Component não pode gravar cookie. Quem renova a sessão é o
          // proxy.ts, então ignorar aqui é seguro: a sessão já foi atualizada
          // antes desta renderização começar.
        }
      },
    },
  });
}
