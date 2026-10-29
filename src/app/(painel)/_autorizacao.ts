import { cache } from "react";

import { criarClienteServidor } from "@/integrations/supabase/server";
import type { Database } from "@/integrations/supabase/types";
import type { EstadoDoFator } from "@/lib/mfa";
import { decidirAcesso, interpretarBloqueioDeExcecao } from "@/lib/mfa";
import { resolverPapelEfetivo } from "./_papel";

export type Papel = Database["public"]["Enums"]["app_role"];

export type Acesso =
  | { situacao: "sem-sessao" }
  | { situacao: "sem-papel"; email: string }
  | { situacao: "mfa-indisponivel"; email: string; papeis: Papel[] }
  | { situacao: "mfa-pendente"; email: string; papeis: Papel[] }
  | { situacao: "liberado"; email: string; papeis: Papel[]; nivel: NivelAcesso };

/**
 * O nível de garantia da sessão que foi liberada (AUTH-01B).
 *
 * "Liberado" já não implica AAL2: conta sem fator trabalha em AAL1. Quem protege uma operação
 * crítica pergunta o `nivel`, nunca a situação.
 */
export type NivelAcesso = "aal1" | "aal2";

/** Nome da função da migration 012, como o PostgREST a expõe. */
export const RPC_ESTADO_DE_MFA = "mfa_bloqueia_excecao_aal1";

/**
 * O mínimo que este módulo precisa de um cliente Supabase para chamar a RPC.
 *
 * Mesmo motivo do molde que a camada de dados do B2.1 já usa: o `Database`
 * gerado conhece apenas `gerar_fatura`, `has_role` e `is_staff`, então o
 * `.rpc()` tipado recusaria o nome da função da 012. A afirmação de
 * compatibilidade fica num lugar só, com o motivo escrito — e este arquivo
 * continua sem importar nada daquela camada.
 */
interface ClienteComRpc {
  rpc(nome: string): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Estado do fator, direto do banco.
 *
 * `public.mfa_bloqueia_excecao_aal1()` é `SECURITY DEFINER` e lê
 * `auth.mfa_factors`, tabela que `authenticated` não enxerga. O usuário não tem
 * como forjar essa resposta, que é exatamente o que faltava para distinguir
 * quem nunca ativou MFA de quem ativou e ainda não fez o TOTP — e o que
 * `nextLevel`, vindo do cookie, não podia responder.
 *
 * Só é chamada quando a resposta depende dela, isto é, em `aal1`: em `aal2` a
 * decisão já está tomada para os dois papéis, e perguntar seria uma ida à rede
 * por página renderizada; com nível desconhecido, a decisão já fecha.
 *
 * Qualquer falha vira `indeterminado`, nunca `sem-fator`: a resposta segura é a
 * que exige o segundo fator. O `try` cobre o que o `error` da resposta não
 * cobre — rede fora, timeout, corpo ilegível.
 */
async function lerEstadoDoFator(supabase: unknown): Promise<EstadoDoFator> {
  try {
    const { data, error } = await (supabase as ClienteComRpc).rpc(RPC_ESTADO_DE_MFA);
    return interpretarBloqueioDeExcecao(data, Boolean(error));
  } catch {
    return interpretarBloqueioDeExcecao(null, true);
  }
}

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
 * **É o único lugar que decide `liberado`.** Layout, `/mfa`, dashboard e os
 * dois guards leem daqui; nenhum deles recalcula papel, nível ou estado de
 * fator por conta própria. Duas definições de "liberado" é como se produz laço
 * entre `/mfa`, `/dashboard` e `/operacional`.
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
  const papel = resolverPapelEfetivo(papeis);

  /**
   * Nível de garantia da sessão.
   *
   * Desta chamada usamos **somente `currentLevel`**, que sai da claim `aal` do
   * token — o mesmo token que o `getUser()` acima já validou contra o servidor
   * do Supabase, e que é assinado.
   *
   * `nextLevel` é ignorado de propósito. Ele é calculado a partir de
   * `session.user.factors`, isto é, do conteúdo do cookie, e por isso não é
   * fonte confiável para **conceder** acesso. Uma versão anterior deste arquivo
   * afirmava aqui que `getAuthenticatorAssuranceLevel()` sem argumento validava
   * `nextLevel` contra o servidor: isso era falso, e a afirmação não deve
   * voltar. Quem responde sobre o estado do fator agora é o banco, logo abaixo.
   */
  const { data: nivel, error: erroNivel } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const nivelAtual = erroNivel ? null : (nivel?.currentLevel ?? null);

  const estadoDoFator = nivelAtual === "aal1" ? await lerEstadoDoFator(supabase) : "indeterminado";

  const decisao = decidirAcesso(papel, nivelAtual, estadoDoFator);

  if (decisao === "sem-papel") return { situacao: "sem-papel", email };

  if (decisao === "liberado") {
    return {
      situacao: "liberado",
      email,
      papeis,
      nivel: nivelAtual === "aal2" ? "aal2" : "aal1",
    };
  }

  return { situacao: decisao, email, papeis };
});
