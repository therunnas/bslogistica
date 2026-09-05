/**
 * Variáveis públicas do Supabase, lidas em um só lugar.
 *
 * As duas são públicas por natureza: viajam no JavaScript da página. Quem
 * protege os dados é a RLS do banco, não o sigilo delas. A chave secreta
 * (service_role) não é usada por esta aplicação e nunca deve aparecer numa
 * variável NEXT_PUBLIC_ — o prefixo faz o Next embutir o valor no bundle do
 * navegador.
 */
export function lerAmbienteSupabase() {
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

  return { url, chave };
}
