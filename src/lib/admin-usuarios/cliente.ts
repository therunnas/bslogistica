/**
 * O que `servico.ts` precisa de um cliente `service_role`, e nada mais.
 *
 * Contrato fechado, no mesmo espírito de `ClienteOperacional`
 * (`src/lib/operacional/rpc.ts`): métodos nomeados pelo que fazem, não um
 * `.from()` genérico repassado cru. Isso é o que permite
 * `scripts/testar-admin-usuarios.mjs` montar um objeto plano em memória — sem
 * rede, sem Supabase real — e ainda assim exercitar `servico.ts` de ponta a
 * ponta.
 *
 * `admin_audit_log` (migration 017) não está no `Database` gerado — mesma
 * lacuna já registrada para as RPCs da 013 no B2.1, e pelo mesmo motivo: este
 * ambiente não gera tipos do Supabase. `criarClienteAdministrativo` recebe o
 * cliente já tipado com `Database` (que conhece `user_roles` e `auth.admin`),
 * e só o repassa como `unknown` para a única chamada que o tipo canônico não
 * cobre — `admin_audit_log` —, com a forma mínima declarada logo abaixo, em
 * vez de sobrescrever o arquivo gerado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { ACAO_AUDITORIA } from "./tipos";
import type { Papel } from "./tipos";
import type { PapelBruto, UsuarioBruto } from "./dominio";
import { ErroPaginacao, lerTudoPaginado } from "../paginacao";
import type { OpcoesDePaginacao } from "../paginacao";

export interface ErroDaResposta {
  message: string;
  code?: string | undefined;
  details?: string | undefined;
  hint?: string | undefined;
}

export class ErroAdministrativo extends Error {
  readonly code?: string | undefined;

  constructor(erro: ErroDaResposta, operacao: string) {
    super(erro.message || `Falha em ${operacao}.`);
    this.name = "ErroAdministrativo";
    this.code = erro.code;
  }
}

/**
 * `resposta` fica `unknown` de propósito: as respostas reais do `supabase-js`
 * são uniões discriminadas onde `data` muda de forma entre o ramo de sucesso e
 * o de erro (ex.: `{ data: { user: User } }` vs. `{ data: { user: null } }`),
 * e o TypeScript não estreita isso a partir de um tipo genérico só pelo
 * `if (error)`. Cada chamador sabe o tipo esperado de `data` no ramo de
 * sucesso — que é exatamente o que ele passa como `T`.
 */
function exigirSucesso<T>(
  resposta: { data: unknown; error: ErroDaResposta | null },
  operacao: string,
): T {
  if (resposta.error) {
    throw new ErroAdministrativo(resposta.error, operacao);
  }
  return resposta.data as T;
}

interface LinhaDePapel {
  id: string;
  user_id: string;
  role: Papel;
}

interface AdminApiUser {
  id: string;
  email?: string | null | undefined;
  created_at: string;
  last_sign_in_at?: string | null | undefined;
  banned_until?: string | null | undefined;
}

/**
 * Lê uma tabela inteira pelo paginador da C03 e converte a falha para
 * `ErroAdministrativo`, o tipo que o resto deste módulo já lança. Erro do
 * PostgREST mantém a mensagem e o `code` originais; qualquer outra falha de
 * leitura (contagem divergente, resposta inválida, limite de páginas) vira
 * `ErroAdministrativo` com o código do paginador. Nunca devolve lista parcial.
 */
export async function lerTudoOuFalhar<T extends object>(
  opcoes: OpcoesDePaginacao<T>,
  operacao: string,
): Promise<T[]> {
  try {
    return (await lerTudoPaginado<T>(opcoes)).linhas;
  } catch (erro) {
    if (erro instanceof ErroPaginacao) {
      const causa = erro.cause as Partial<ErroDaResposta> | undefined;
      if (typeof causa?.message === "string") {
        throw new ErroAdministrativo(causa as ErroDaResposta, operacao);
      }
      throw new ErroAdministrativo({ message: erro.message, code: erro.codigo }, operacao);
    }
    throw erro;
  }
}

/** Contas por página da Auth Admin API e teto de páginas (10 mil contas). */
export const CONTAS_POR_PAGINA = 200;
export const MAX_PAGINAS_DE_CONTAS = 50;

/**
 * Lê TODAS as contas da Auth Admin API, página a página.
 *
 * A API pagina por número de página (`page`/`per_page`), não por cursor, então
 * uma conta criada ou removida durante a leitura desloca as páginas seguintes.
 * Por isso: o fim é provado por uma página VAZIA (página curta não basta), contas
 * repetidas entre páginas denunciam o deslocamento, e o total informado pela API
 * (`x-total-count`, quando existe) é conferido contra o lido. Divergência manda
 * reler UMA vez; persistindo, falha. Nunca devolve lista parcial.
 *
 * Os metadados `nextPage`/`lastPage` do `supabase-js` NÃO são usados: ele lê só o
 * primeiro dígito do número da página (`substring(0, 1)`), então passam a mentir
 * a partir da página 10. O `total` é lido por inteiro e é confiável; quando a API
 * não o informa (0), a leitura segue sem essa conferência.
 */
export async function lerTodasAsContas(
  buscarPagina: (
    pagina: number,
    porPagina: number,
  ) => PromiseLike<{ data: unknown; error: ErroDaResposta | null }>,
  opcoes: { porPagina?: number; maxPaginas?: number } = {},
): Promise<AdminApiUser[]> {
  const porPagina = opcoes.porPagina ?? CONTAS_POR_PAGINA;
  const maxPaginas = opcoes.maxPaginas ?? MAX_PAGINAS_DE_CONTAS;
  const operacao = "listar usuários";

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const vistas = new Map<string, AdminApiUser>();
    let repetidas = 0;
    let total: number | null = null;

    for (let pagina = 1; ; pagina++) {
      if (pagina > maxPaginas) {
        throw new ErroAdministrativo(
          {
            message: `Limite de ${maxPaginas} páginas de contas atingido sem confirmar o fim da lista.`,
            code: "LIMITE_PAGINAS",
          },
          operacao,
        );
      }

      const resposta = await buscarPagina(pagina, porPagina);
      if (resposta.error) {
        throw new ErroAdministrativo(resposta.error, operacao);
      }

      const dados = resposta.data as { users?: unknown; total?: unknown } | null | undefined;
      const contas = dados?.users;
      if (!Array.isArray(contas) || contas.length > porPagina) {
        throw new ErroAdministrativo(
          { message: `A página ${pagina} de contas veio inválida.`, code: "RESPOSTA_INVALIDA" },
          operacao,
        );
      }

      if (
        typeof dados?.total === "number" &&
        Number.isSafeInteger(dados.total) &&
        dados.total > 0
      ) {
        total = dados.total;
      }

      if (contas.length === 0) break;

      for (const conta of contas as AdminApiUser[]) {
        if (typeof conta?.id !== "string" || conta.id === "") {
          throw new ErroAdministrativo(
            {
              message: `A página ${pagina} trouxe uma conta sem identificador.`,
              code: "RESPOSTA_INVALIDA",
            },
            operacao,
          );
        }
        if (vistas.has(conta.id)) repetidas++;
        else vistas.set(conta.id, conta);
      }
    }

    const confere = repetidas === 0 && (total === null || vistas.size === total);
    if (confere) return [...vistas.values()];
  }

  throw new ErroAdministrativo(
    {
      message:
        "A lista de contas mudou durante a leitura e não estabilizou após reler; a leitura não está comprovadamente completa.",
      code: "LEITURA_INCOMPLETA",
    },
    operacao,
  );
}

export interface EntradaDeAuditoria {
  actorId: string;
  action: (typeof ACAO_AUDITORIA)[keyof typeof ACAO_AUDITORIA];
  targetUserId?: string | null | undefined;
  details?: Record<string, unknown> | undefined;
}

/**
 * A auditoria nunca pode transformar um sucesso real em "erro" reportado. Se
 * `registrarAuditoria` falhar DEPOIS que o estado já mudou de verdade — papel
 * concedido, operação atribuída, acesso revogado —, a falha vai para o
 * console e é engolida: o resultado que volta para o admin continua
 * refletindo o que aconteceu de fato no banco, não o que aconteceu na trilha
 * de auditoria. Usada por `servico.ts` e `operacoes.ts`.
 */
export async function auditarSemFalhar(
  cliente: { registrarAuditoria(entrada: EntradaDeAuditoria): Promise<void> },
  entrada: EntradaDeAuditoria,
): Promise<void> {
  try {
    await cliente.registrarAuditoria(entrada);
  } catch (erro) {
    console.error(
      "Falha ao registrar auditoria administrativa (ação já aplicada):",
      entrada.action,
      erro,
    );
  }
}

export interface ClienteAdministrativo {
  listarUsuarios(): Promise<UsuarioBruto[]>;
  convidarPorEmail(email: string, nomeCompleto: string | null): Promise<{ userId: string }>;
  banirUsuario(userId: string): Promise<void>;
  desbanirUsuario(userId: string): Promise<void>;
  listarPapeis(): Promise<PapelBruto[]>;
  concederPapel(userId: string, papel: Papel): Promise<void>;
  revogarPapel(userId: string, papel: Papel): Promise<void>;
  revogarTodosOsPapeis(userId: string): Promise<void>;
  registrarAuditoria(entrada: EntradaDeAuditoria): Promise<void>;
}

/**
 * A tabela que o `Database` gerado não conhece. Forma mínima: só as duas
 * operações que este módulo faz nela, ambas de escrita — ninguém aqui LÊ
 * `admin_audit_log` (é a tela do PR E que vai ler).
 */
interface ClienteComAuditoria {
  from(tabela: "admin_audit_log"): {
    insert(valores: {
      actor_id: string;
      action: string;
      target_user_id: string | null;
      details: Record<string, unknown>;
    }): PromiseLike<{ data: unknown; error: ErroDaResposta | null }>;
  };
}

export function criarClienteAdministrativo(
  supabase: SupabaseClient<Database>,
): ClienteAdministrativo {
  const comAuditoria = supabase as unknown as ClienteComAuditoria;

  return {
    async listarUsuarios() {
      const contas = await lerTodasAsContas((page, perPage) =>
        supabase.auth.admin.listUsers({ page, perPage }),
      );
      return contas.map((usuario) => ({
        id: usuario.id,
        email: usuario.email ?? null,
        created_at: usuario.created_at,
        last_sign_in_at: usuario.last_sign_in_at ?? null,
        banned_until: usuario.banned_until ?? null,
      }));
    },

    async convidarPorEmail(email, nomeCompleto) {
      const resposta = await supabase.auth.admin.inviteUserByEmail(email, {
        data: nomeCompleto ? { full_name: nomeCompleto } : {},
      });
      const dados = exigirSucesso<{ user: AdminApiUser | null }>(resposta, "convidar usuário");
      if (!dados.user) {
        throw new Error("O convite não devolveu o usuário criado.");
      }
      return { userId: dados.user.id };
    },

    async banirUsuario(userId) {
      const resposta = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      exigirSucesso(resposta, "banir usuário");
    },

    async desbanirUsuario(userId) {
      const resposta = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });
      exigirSucesso(resposta, "desbanir usuário");
    },

    async listarPapeis() {
      // Cursor por `id` (a tabela tem `id` único); a saída continua sendo só
      // `{ user_id, role }`, o que `PapelBruto` e o consumidor esperam.
      const linhas = await lerTudoOuFalhar<LinhaDePapel>(
        {
          lerPagina: async ({ depoisDe, limite }) => {
            let consulta = supabase.from("user_roles").select("id, user_id, role");
            if (depoisDe !== null) consulta = consulta.gt("id", depoisDe);
            const resposta = await consulta.order("id", { ascending: true }).limit(limite);
            if (resposta.error) throw resposta.error;
            return { linhas: resposta.data as LinhaDePapel[] };
          },
          contar: async () => {
            const resposta = await supabase
              .from("user_roles")
              .select("id", { count: "exact", head: true });
            if (resposta.error) throw resposta.error;
            return resposta.count as number;
          },
        },
        "listar papéis",
      );
      return linhas.map(({ user_id, role }) => ({ user_id, role }));
    },

    async concederPapel(userId, papel) {
      const resposta = await supabase.from("user_roles").insert({ user_id: userId, role: papel });
      // UNIQUE (user_id, role): conceder um papel já concedido é idempotente,
      // não erro — `23505` é o único código tolerado aqui.
      if (resposta.error && resposta.error.code !== "23505") {
        throw new ErroAdministrativo(resposta.error, "conceder papel");
      }
    },

    async revogarPapel(userId, papel) {
      const resposta = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", papel);
      exigirSucesso(resposta, "revogar papel");
    },

    async revogarTodosOsPapeis(userId) {
      const resposta = await supabase.from("user_roles").delete().eq("user_id", userId);
      exigirSucesso(resposta, "revogar todos os papéis");
    },

    async registrarAuditoria(entrada) {
      const resposta = await comAuditoria.from("admin_audit_log").insert({
        actor_id: entrada.actorId,
        action: entrada.action,
        target_user_id: entrada.targetUserId ?? null,
        details: entrada.details ?? {},
      });
      exigirSucesso(resposta, "registrar auditoria");
    },
  };
}
