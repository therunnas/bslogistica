import { criarClienteServidor } from "@/integrations/supabase/server";
import type { Database } from "@/integrations/supabase/types";

export type Papel = Database["public"]["Enums"]["app_role"];

export type Acesso =
  | { situacao: "sem-sessao" }
  | { situacao: "sem-papel"; email: string }
  | { situacao: "mfa-ausente"; email: string; papeis: Papel[] }
  | { situacao: "mfa-pendente"; email: string; papeis: Papel[] }
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

  const papeis = data.map((linha) => linha.role);

  /**
   * Segundo fator.
   *
   * getAuthenticatorAssuranceLevel serve como verificação de servidor e não
   * como enfeite de interface: por dentro ela chama getUser(jwt), que valida o
   * token contra o Supabase, e calcula `nextLevel` a partir de `user.factors`
   * filtrados por `status === 'verified'` — dado que vem do servidor, não do
   * cookie. `currentLevel` sai da claim `aal` do mesmo token já validado.
   *
   * Três situações:
   *
   * - `nextLevel` diferente de aal2 -> a conta não tem nenhum fator verificado
   *   e precisa cadastrar o primeiro;
   * - `nextLevel` aal2 com `currentLevel` abaixo disso -> tem fator, mas a
   *   sessão parou na senha e falta o código;
   * - ambos em aal2 -> entrou com os dois fatores.
   *
   * Erro ao consultar cai no mesmo caminho de quem não tem fator: manda para
   * /mfa em vez de liberar o painel. Falhar fechado, e sem trancar ninguém
   * para fora — a tela de cadastro continua alcançável.
   */
  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (erroNivel || !nivel) return { situacao: "mfa-ausente", email, papeis };
  if (nivel.nextLevel !== "aal2") return { situacao: "mfa-ausente", email, papeis };
  if (nivel.currentLevel !== "aal2") return { situacao: "mfa-pendente", email, papeis };

  return { situacao: "liberado", email, papeis };
}
