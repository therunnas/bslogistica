"use server";

import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/integrations/supabase/server";

/**
 * Encerra a sessão.
 *
 * Roda no servidor porque a sessão vive em cookies: é o servidor que consegue
 * apagá-los de verdade. Sair pelo navegador deixaria o cookie de volta na
 * próxima renderização do servidor.
 */
export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
