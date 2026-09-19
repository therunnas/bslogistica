import { cache } from "react";

import { criarClienteServidor } from "@/integrations/supabase/server";
import type { Database } from "@/integrations/supabase/types";
import { decidirSituacaoMfa } from "@/lib/mfa";

export type Papel = Database["public"]["Enums"]["app_role"];

export type Acesso =
  | { situacao: "sem-sessao" }
  | { situacao: "sem-papel"; email: string }
  | { situacao: "mfa-indisponivel"; email: string; papeis: Papel[] }
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
 *
 * Memoizada com o `cache` do React, que dura **uma requisição**: o layout e a
 * página administrativa perguntam a mesma coisa na mesma passada, e sem isso
 * seriam duas idas ao Supabase para a mesma resposta. Não é estado global nem
 * cache entre usuários — a cada requisição a pergunta é feita de novo, à fonte
 * de sempre.
 */
export const lerAcesso = cache(async (): Promise<Acesso> => {
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
   * A tradução do resultado está em `decidirSituacaoMfa`, testável à parte. As
   * quatro saídas: falha na consulta, sem fator, com fator mas sessão em aal1,
   * e tudo em aal2. Só a última abre o painel.
   */
  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const situacao = decidirSituacaoMfa(nivel, Boolean(erroNivel));

  return situacao === "liberado"
    ? { situacao: "liberado", email, papeis }
    : { situacao, email, papeis };
});
