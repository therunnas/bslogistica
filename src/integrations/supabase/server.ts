import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./types";

/**
 * Cliente do Supabase para o servidor (Next.js).
 *
 * Usa a mesma chave publicável do navegador, e não a secreta: as consultas
 * seguem passando pela RLS em nome do usuário da sessão. É o que se quer —
 * o servidor não deve enxergar mais do que o usuário enxergaria.
 *
 * A sessão vive em cookies, que é como o @supabase/ssr mantém servidor e
 * navegador em acordo.
 */
export async function criarClienteServidor() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const chave = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !chave) {
    const faltando = [
      ...(!url ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
      ...(!chave ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(
      `Variáveis de ambiente do Supabase ausentes: ${faltando.join(", ")}. ` +
        "Defina-as no .env local e nas variáveis de ambiente da hospedagem.",
    );
  }

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
          // Server Components não podem gravar cookies. Quando a renovação da
          // sessão for movida para o middleware, é ele que grava — e aqui a
          // falha pode ser ignorada com segurança.
        }
      },
    },
  });
}
