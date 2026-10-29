/**
 * Regras do tema claro/escuro: a FONTE ÚNICA de decisão.
 *
 * Duas peças aplicam o tema e precisam concordar: `public/theme-script.js` (roda antes da
 * hidratação, para não piscar) e `ThemeProvider` (depois). O script é um arquivo estático e não
 * importa este módulo; por isso `scripts/testar-tema.mjs` executa o script e confere que ele
 * decide exatamente o que as funções daqui decidem, com a mesma lista de rotas.
 *
 * REGRAS
 *   - Sem preferência salva: CLARO. O tema do sistema operacional NÃO é consultado.
 *   - Preferência salva ("light" ou "dark"): vale em TODOS os módulos do painel, sempre.
 *   - Telas de autenticação (login, MFA, recuperação de senha) ficam sempre claras e nunca
 *     alteram nem apagam a preferência.
 *
 * Por que a lista é das rotas SEM tema (e não das COM tema): uma lista das que têm tema esquece
 * módulos novos. Foi o defeito de origem: `/fechamento` e `/implantacao-vigencias` não estavam
 * na lista, então o tema voltava ao claro ao abri-los. Com a lista inversa, todo módulo novo do
 * painel já herda o tema, e `testar-tema.mjs` confere cada pasta de `src/app/(painel)`.
 */

export type Tema = "light" | "dark";

/** Chave da preferência no armazenamento do navegador. */
export const CHAVE_TEMA = "bs-theme";

/** Rotas que ficam SEMPRE claras (fora do painel). `/` só redireciona. */
export const ROTAS_SEM_TEMA = [
  "/",
  "/login",
  "/mfa",
  "/esqueci-senha",
  "/redefinir-senha",
  "/auth",
] as const;

export function rotaUsaTemaDoPainel(caminho: string): boolean {
  return !ROTAS_SEM_TEMA.some((rota) =>
    rota === "/" ? caminho === "/" : caminho === rota || caminho.startsWith(`${rota}/`),
  );
}

/** Só "light" e "dark" são preferências válidas; qualquer outra coisa é ignorada. */
export function temaValido(valor: unknown): Tema | null {
  return valor === "light" || valor === "dark" ? valor : null;
}

/** Sem preferência válida, claro. Nunca olha o sistema operacional. */
export function temaDaPreferencia(salvo: unknown): Tema {
  return temaValido(salvo) ?? "light";
}

/** O tema que vai para a tela: a preferência no painel, claro fora dele. */
export function temaAplicado(caminho: string, preferido: Tema): Tema {
  return rotaUsaTemaDoPainel(caminho) ? preferido : "light";
}

/** Lê a preferência de um armazenamento qualquer; qualquer falha vira "sem preferência". */
export function lerPreferencia(armazenamento: { getItem(chave: string): string | null }): Tema {
  try {
    return temaDaPreferencia(armazenamento.getItem(CHAVE_TEMA));
  } catch {
    return "light";
  }
}
