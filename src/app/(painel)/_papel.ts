/**
 * Papel efetivo de uma sessão.
 *
 * `user_roles` permite mais de uma linha por usuário, então "o papel" não é um
 * campo: é uma decisão. Ela mora aqui, em função pura, para não virar
 * `papeis.includes("admin")` espalhado por cada tela — que é como regras assim
 * divergem entre si com o tempo.
 *
 * **`admin` + `operacional` é tratado como ADMIN**, e isso não é conveniência:
 * é o mesmo que o banco decidiu. `public.operador_elegivel_aal1()`, da migration
 * 013, exige explicitamente **não** ser admin para conceder a exceção de AAL1,
 * justamente para que acumular o papel operacional nunca abra uma rota de
 * privilégio menor a quem já é administrador. A interface precisa concordar com
 * isso, ou as duas camadas dariam respostas diferentes para a mesma conta.
 *
 * Módulo sem importação de valor, de propósito: só tipos, que somem na
 * compilação. É o que permite exercitar a decisão em Node puro, como as outras
 * suítes do projeto fazem.
 */

import type { Papel } from "./_autorizacao";

export type PapelEfetivo = "admin" | "operacional" | "sem-papel";

export function resolverPapelEfetivo(papeis: readonly Papel[] | null | undefined): PapelEfetivo {
  if (!Array.isArray(papeis) || papeis.length === 0) return "sem-papel";
  if (papeis.includes("admin")) return "admin";
  if (papeis.includes("operacional")) return "operacional";
  return "sem-papel";
}

/** Atalho legível para o único privilégio que o B2.2 governa. */
export const ehAdmin = (papeis: readonly Papel[] | null | undefined): boolean =>
  resolverPapelEfetivo(papeis) === "admin";
