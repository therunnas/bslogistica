import { criarClienteServidor } from "@/integrations/supabase/server";
import type { Database } from "@/integrations/supabase/types";

export type Papel = Database["public"]["Enums"]["app_role"];

export type Acesso =
  | { situacao: "sem-sessao" }
  | { situacao: "sem-papel"; email: string }
  | { situacao: "liberado"; email: string; papeis: Papel[] };

/**
 * Descobre a situação de acesso de quem está requisitando, no servidor.
 *
 * A leitura de user_roles passa pela RLS como qualquer outra: a política
 * permite que cada um enxergue apenas a própria linha, que é exatamente o
 * necessário aqui. Nenhuma chave privilegiada é usada.
 *
 * Isto decide o que a interface mostra. Quem impede o acesso aos dados é a
 * RLS no banco — se este arquivo tivesse um bug, as tabelas continuariam
 * protegidas.
 */
export async function lerAcesso(): Promise<Acesso> {
  const supabase = await criarClienteServidor();

  // getUser valida o token contra o servidor do Supabase. getSession leria
  // apenas o cookie, que pode ter sido forjado.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { situacao: "sem-sessao" };

  const email = user.email ?? "";
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

  if (error || !data || data.length === 0) return { situacao: "sem-papel", email };

  return { situacao: "liberado", email, papeis: data.map((linha) => linha.role) };
}
