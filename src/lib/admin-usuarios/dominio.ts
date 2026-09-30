/**
 * Regras puras do backend administrativo de usuários — sem rede, sem cliente
 * do Supabase. Mesma separação de `operacional/_dominio.ts`: o que pode ser
 * testado sem harness fica aqui, e `servico.ts`/`operacoes.ts` só orquestram
 * chamadas em cima do que este módulo decide.
 */

import type { Papel, UsuarioAdministrativo } from "./tipos";

export interface UsuarioBruto {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
}

export interface PapelBruto {
  user_id: string;
  role: Papel;
}

/**
 * `banned_until` no passado não é banimento — é o valor residual que o GoTrue
 * grava ao DESBANIR (`"none"` vira uma data já passada, não `null`, em algumas
 * versões da API). Comparar contra "agora" é o que faz reativação funcionar.
 */
export function estaBanido(bannedUntil: string | null, agora: Date = new Date()): boolean {
  if (!bannedUntil) return false;
  const data = new Date(bannedUntil);
  return !Number.isNaN(data.getTime()) && data.getTime() > agora.getTime();
}

/**
 * Junta identidade (Admin API) com papel (`user_roles`) em memória — nenhuma
 * das duas fontes sabe da outra. Usuário sem nenhuma linha em `user_roles`
 * aparece com `papeis: []` ("sem-papel" na terminologia do guard), não é
 * omitido: o admin precisa ver a conta órfã de papel para poder corrigi-la.
 */
export function combinarUsuariosEPapeis(
  usuarios: readonly UsuarioBruto[],
  papeis: readonly PapelBruto[],
  agora: Date = new Date(),
): UsuarioAdministrativo[] {
  const papeisPorUsuario = new Map<string, Papel[]>();

  for (const linha of papeis) {
    const lista = papeisPorUsuario.get(linha.user_id) ?? [];
    lista.push(linha.role);
    papeisPorUsuario.set(linha.user_id, lista);
  }

  return usuarios.map((usuario) => ({
    id: usuario.id,
    email: usuario.email,
    nomeCompleto: null,
    papeis: papeisPorUsuario.get(usuario.id) ?? [],
    banido: estaBanido(usuario.banned_until, agora),
    criadoEm: usuario.created_at,
    ultimoLoginEm: usuario.last_sign_in_at,
  }));
}

const FORMATO_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function exigirEmailValido(valor: unknown): string {
  if (typeof valor !== "string") {
    throw new Error("E-mail é obrigatório.");
  }
  const email = valor.trim().toLowerCase();
  if (email === "" || !FORMATO_DE_EMAIL.test(email)) {
    throw new Error("E-mail inválido.");
  }
  return email;
}

const PAPEIS_VALIDOS: readonly Papel[] = ["admin", "operacional"];

export function exigirPapelValido(valor: unknown): Papel {
  if (typeof valor !== "string" || !(PAPEIS_VALIDOS as readonly string[]).includes(valor)) {
    throw new Error(`Papel inválido: ${String(valor)}. Use "admin" ou "operacional".`);
  }
  return valor as Papel;
}

export type AcaoDePapel = "conceder" | "revogar";

const ACOES_DE_PAPEL_VALIDAS: readonly AcaoDePapel[] = ["conceder", "revogar"];

/**
 * `AlterarPapelEntrada.acao` chegava tipada como `"conceder" | "revogar"` no
 * TypeScript, mas isso não é validação de runtime — uma Server Action é um
 * endpoint POST como outro qualquer, e nada impede um corpo malformado
 * chegando como `unknown` de verdade. Sem esta checagem, qualquer valor
 * diferente de `"conceder"` caía implicitamente no `else` de revogação.
 */
export function exigirAcaoDePapel(valor: unknown): AcaoDePapel {
  if (typeof valor !== "string" || !(ACOES_DE_PAPEL_VALIDAS as readonly string[]).includes(valor)) {
    throw new Error(`Ação inválida: ${String(valor)}. Use "conceder" ou "revogar".`);
  }
  return valor as AcaoDePapel;
}

export function exigirUuid(valor: unknown, nome: string): string {
  const formato = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof valor !== "string" || !formato.test(valor)) {
    throw new Error(`Identificador inválido em ${nome}.`);
  }
  return valor;
}

/**
 * Duração de banimento "indefinido" aceita pelo GoTrue — não existe um valor
 * "para sempre" na API, então usa-se uma janela grande o bastante (~100 anos).
 * Revogação é sempre reversível por reativação explícita (ver `dominio` da
 * reativação): isso NÃO é uma exclusão, é impedir login enquanto ninguém
 * desfizer.
 */
export const DURACAO_BANIMENTO_INDEFINIDO = "876000h";

/** Valor que o GoTrue aceita para desbanir uma conta. */
export const DURACAO_SEM_BANIMENTO = "none";
