/**
 * Decisões do segundo fator, isoladas em funções puras.
 *
 * Elas moram aqui, e não dentro do guard e da tela, por um motivo prático: sem
 * framework de teste no projeto, lógica embutida em Server Component e em
 * `useCallback` só é exercitável clicando. Extraída, é verificável por script.
 *
 * Nenhuma destas funções fala com o Supabase. Elas recebem o que já foi lido e
 * respondem para onde ir — o que também deixa explícito que a decisão não
 * depende de e-mail, papel ou qualquer outro dado além do estado do fator.
 */

export type NivelDeGarantia = "aal1" | "aal2" | (string & {});

export interface NivelMfa {
  currentLevel: NivelDeGarantia | null;
  nextLevel: NivelDeGarantia | null;
}

export type SituacaoMfa = "mfa-indisponivel" | "mfa-ausente" | "mfa-pendente" | "liberado";

/**
 * Para onde mandar quem já tem sessão e papel.
 *
 * `houveErro` é o caso que motivou esta função existir. Consultar o nível é uma
 * chamada de rede; quando ela falha, não se sabe se há fator ou não. Tratar
 * "não sei" como "não tem" mandava um admin com fator verificado para o
 * cadastro, onde o `enroll` era recusado por nome duplicado e a tela travava.
 *
 * Falha e ausência passam a ser coisas diferentes. As duas continuam fechando o
 * painel — nenhuma libera acesso, nenhuma rebaixa para aal1 —, mas só a ausência
 * leva ao cadastro.
 */
export function decidirSituacaoMfa(nivel: NivelMfa | null, houveErro: boolean): SituacaoMfa {
  if (houveErro || !nivel) return "mfa-indisponivel";
  if (nivel.nextLevel !== "aal2") return "mfa-ausente";
  if (nivel.currentLevel !== "aal2") return "mfa-pendente";
  return "liberado";
}

export type DecisaoMfaNaRecuperacao = "desafiar-mfa" | "prosseguir" | "falhar";

/**
 * O que a recuperação de senha deve fazer, dada a situação do segundo fator.
 *
 * POR QUE ISTO EXISTE
 *
 * O `verifyOtp({ type: "recovery" })` cria a sessão em aal1. Quando a conta tem
 * TOTP verificado, o próprio Supabase recusa a troca de senha nessa sessão:
 * `PUT /user` devolve 401 "AAL2 session is required to update email or password
 * when MFA is enabled". Não é regra nossa, é do GoTrue — e a resposta certa é
 * satisfazer o segundo fator, nunca contorná-lo.
 *
 * A exigência é CONDICIONAL, e é por isso que esta função existe separada de
 * um simples `aal === "aal2"`:
 *
 * - `mfa-pendente` (aal1, mas a conta tem fator) -> desafiar, e só então trocar;
 * - `liberado` (já aal2) -> o fator já foi satisfeito, segue;
 * - `mfa-ausente` (a conta não tem fator) -> o 401 não acontece, segue em aal1.
 *   Exigir aal2 aqui travaria a recuperação de quem nunca cadastrou MFA;
 * - `mfa-indisponivel` -> falha fechada. Não saber se há fator não é o mesmo que
 *   não haver: seguir levaria ao mesmo 401, agora sem diagnóstico.
 */
export function decidirMfaNaRecuperacao(situacao: SituacaoMfa): DecisaoMfaNaRecuperacao {
  if (situacao === "mfa-pendente") return "desafiar-mfa";
  if (situacao === "mfa-indisponivel") return "falhar";
  return "prosseguir";
}

export type FluxoMfa = "desafio" | "cadastro" | "sem-fator-esperado";

/**
 * O que a tela de MFA deve fazer, uma vez que já leu os fatores da conta.
 *
 * O fator verificado manda no fluxo, venha o que vier na etapa calculada pelo
 * guard: se existe um, o caminho é desafio. É isso que impede chamar `enroll`
 * sobre uma conta que já tem fator — a origem do travamento anterior.
 *
 * `sem-fator-esperado` é a incoerência: o guard afirmou que há fator, a lista
 * não trouxe nenhum verificado. Não é caso de cadastrar por conta própria; é
 * caso de avisar e deixar recarregar.
 */
export function decidirFluxoMfa(
  temFatorVerificado: boolean,
  etapa: "mfa-ausente" | "mfa-pendente",
): FluxoMfa {
  if (temFatorVerificado) return "desafio";
  if (etapa === "mfa-pendente") return "sem-fator-esperado";
  return "cadastro";
}
