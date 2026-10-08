import { verificarDestinoSupabase } from "@/lib/ambiente";

/**
 * Variáveis públicas do Supabase, lidas em um só lugar.
 *
 * As duas são públicas por natureza: viajam no JavaScript da página. Quem
 * protege os dados é a RLS do banco, não o sigilo delas. A chave secreta
 * (service_role) é usada exclusivamente no servidor pela integração
 * administrativa e nunca deve aparecer numa variável NEXT_PUBLIC_ — o prefixo
 * faz o Next embutir o valor no bundle do navegador.
 */
export function lerAmbienteSupabase() {
  // O gate só roda no SERVIDOR (VERCEL_ENV e BS_PREVIEW_SHARED_SUPABASE não existem
  // no navegador — a segunda é de propósito sem NEXT_PUBLIC_). No navegador a URL
  // já foi aceita pelo gate do build (next.config.ts), que é quem decide.
  const ambiente = process.env["VERCEL_ENV"];
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const chave = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  const faltando = [
    ...(!url ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
    ...(!chave ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];

  if (!url || !chave) {
    throw new Error(
      `Variáveis de ambiente do Supabase ausentes: ${faltando.join(", ")}. ` +
        "Defina-as no .env local e nas variáveis de ambiente da hospedagem.",
    );
  }

  // Fora de Production na Vercel, o projeto Supabase de Production é barrado.
  // Vale no build (que pré-renderiza páginas) e em cada requisição.
  verificarDestinoSupabase(ambiente, url, process.env["BS_PREVIEW_SHARED_SUPABASE"]);

  return { url, chave };
}
