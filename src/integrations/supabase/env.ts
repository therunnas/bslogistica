import { sinaisDe, verificarDestinoSupabase, type SinaisDeAmbiente } from "@/lib/ambiente";

/**
 * Os sinais de ambiente de quem está executando esta leitura.
 *
 * Servidor: os sinais de execução da Vercel e `VERCEL_ENV`, lidos um a um.
 * Navegador: só o que o build publicou em `NEXT_PUBLIC_AMBIENTE` — depois de
 * `next.config.ts` validá-lo —, porque as variáveis da Vercel não existem lá. Vazio
 * significa build feito fora da Vercel (local, CI, E2E).
 */
function sinaisDoAmbiente(): SinaisDeAmbiente {
  if (typeof window !== "undefined") {
    return sinaisDe({ VERCEL_ENV: process.env["NEXT_PUBLIC_AMBIENTE"] || undefined });
  }
  return sinaisDe({
    VERCEL_ENV: process.env["VERCEL_ENV"],
    VERCEL: process.env["VERCEL"],
    VERCEL_URL: process.env["VERCEL_URL"],
    VERCEL_REGION: process.env["VERCEL_REGION"],
    VERCEL_DEPLOYMENT_ID: process.env["VERCEL_DEPLOYMENT_ID"],
    VERCEL_PROJECT_ID: process.env["VERCEL_PROJECT_ID"],
  });
}

/**
 * Variáveis públicas do Supabase, lidas em um só lugar.
 *
 * As duas são públicas por natureza: viajam no JavaScript da página. Quem
 * protege os dados é a RLS do banco, não o sigilo delas. A chave secreta
 * (service_role) é usada exclusivamente no servidor pela integração
 * administrativa e nunca deve aparecer numa variável NEXT_PUBLIC_ — o prefixo
 * faz o Next embutir o valor no bundle do navegador.
 *
 * Antes de devolver, aplica o isolamento entre ambientes (`src/lib/ambiente.ts`):
 * fora de Production na Vercel, o destino precisa ser próprio e nunca o projeto
 * Supabase de Production; na Vercel com ambiente indefinido, lança. Vale no build
 * (que pré-renderiza páginas) e em cada requisição do servidor.
 */
export function lerAmbienteSupabase() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const chave = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  verificarDestinoSupabase(sinaisDoAmbiente(), { url, chave });

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

  return { url, chave };
}
