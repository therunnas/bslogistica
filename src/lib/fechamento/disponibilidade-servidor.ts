/**
 * A verificação de disponibilidade para a PÁGINA (Server Component), com o cliente da sessão do
 * servidor. Fica fora de `page.tsx` para a tela não importar Supabase. Não usa `service_role`.
 */

import { criarClienteServidor } from "@/integrations/supabase/server";

import { verificarDisponibilidade, type Disponibilidade } from "./disponibilidade";

export async function verificarDisponibilidadeNoServidor(): Promise<Disponibilidade> {
  return verificarDisponibilidade(await criarClienteServidor());
}
