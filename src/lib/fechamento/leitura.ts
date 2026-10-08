/**
 * Leitura paginada do Fechamento: `timesheet_entries` de UM cliente em UM período.
 *
 * O Fechamento nunca lê tabela inteira. O recorte por cliente e por período
 * acontece no banco, e a leitura devolve o conjunto COMPLETO ou levanta erro:
 * não existe resposta parcial. O PostgREST corta silenciosamente qualquer
 * resposta em `max_rows` linhas (1000 em Production), então "veio menos do que
 * pedi" nunca é prova de que acabou — por isso o término não depende do tamanho
 * da página.
 *
 * COMO O CONJUNTO É PROVADO COMPLETO
 *
 *  1. A primeira página pede `count: exact`; o total `N` é o número de linhas do
 *     recorte, medido pelo banco.
 *  2. A leitura é por KEYSET: `id > último` com `ORDER BY id`. Uma linha criada
 *     ou apagada durante a leitura não desloca as páginas seguintes, que é o que
 *     `OFFSET` faria.
 *  3. A leitura termina quando as linhas lidas chegam a `N` — nunca porque uma
 *     página veio "menor que o pedido". Se o servidor cortar a página abaixo do
 *     pedido (cap menor que 500), o laço simplesmente avança pelo que veio.
 *  4. Página vazia antes de chegar a `N`, id repetido, id fora da ordem, mais
 *     linhas do que `N`: erro de integridade.
 *  5. Ao final, uma nova contagem (`head`) precisa dar o mesmo `N`. Se mudou,
 *     o dado se alterou no meio da leitura: a leitura inteira é refeita uma vez
 *     e, persistindo, falha.
 *
 * **A consulta nomeia os campos que usa; não há `select("*")`.** Os três valores
 * monetários saem como texto (`::text`), para a conversão em centavos nunca
 * passar por ponto flutuante.
 *
 * Este módulo só importa TIPOS: assim a suíte `test:fechamento-leitura` o carrega
 * direto, sem resolvedor, e a paginação é testada com uma fonte falsa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/** Tamanho de página pedido. Independe do `max_rows` do projeto. */
export const TAMANHO_DA_PAGINA = 500;

/** Teto técnico de linhas por leitura (31 dias de um cliente, com folga). */
export const TETO_DE_LINHAS = 20_000;

/** Teto de requisições por leitura, contra laço. */
export const TETO_DE_REQUISICOES = 60;

export type CodigoDeErroDeLeitura =
  | "consulta"
  | "contagem-ausente"
  | "periodo-grande"
  | "pagina-vazia-prematura"
  | "pagina-maior-que-o-pedido"
  | "id-invalido"
  | "id-repetido"
  | "ordem-violada"
  | "excedeu-a-contagem"
  | "requisicoes-excedidas"
  | "dados-mudaram";

export class ErroDeLeituraDoFechamento extends Error {
  readonly codigo: CodigoDeErroDeLeitura;

  constructor(codigo: CodigoDeErroDeLeitura, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeLeituraDoFechamento";
    this.codigo = codigo;
  }
}

/** Um cliente e um período, já validados por quem chama. */
export interface FiltroDoFechamento {
  clienteId: string;
  /** `YYYY-MM-DD`, inclusivo. */
  inicio: string;
  /** `YYYY-MM-DD`, inclusivo. */
  fim: string;
}

/** O que a consulta devolve por linha. Valores monetários chegam como texto. */
export interface LinhaBrutaDoFechamento {
  id: string;
  employee_id: string;
  status: "present" | "absent" | "replacement";
  check_in: string | null;
  check_out: string | null;
  worked_minutes: number;
  overtime_minutes: number;
  invoice_id: string | null;
  faturado: string;
  custo: string;
  taxa_da_diaria: string;
  employees: { id: string; name: string; role: string | null } | null;
  timesheets: {
    id: string;
    work_date: string;
    status: "open" | "closed";
    operation_id: string;
    operations: {
      id: string;
      client_id: string;
      name: string;
      contract_id: string | null;
    };
    shifts: { id: string; name: string } | null;
  };
}

/** O que a paginação precisa da fonte. A fonte real é o Supabase. */
export interface FonteDeLinhas {
  /**
   * Uma página em ordem crescente de `id`, estritamente depois de `cursor`
   * (`null` = desde o começo). `total` só é preenchido quando `contar` é
   * verdadeiro, e é a contagem do recorte inteiro.
   */
  lerPagina(pedido: {
    cursor: string | null;
    limite: number;
    contar: boolean;
  }): Promise<{ linhas: LinhaBrutaDoFechamento[]; total: number | null }>;

  /** Contagem do recorte inteiro, sem trazer linha nenhuma. */
  contar(): Promise<number>;
}

export interface OpcoesDeLeitura {
  tamanhoDaPagina?: number;
  tetoDeLinhas?: number;
  tetoDeRequisicoes?: number;
  /** Quantas vezes refazer a leitura inteira se o dado mudar no meio. */
  tentativas?: number;
}

/**
 * Lê o recorte inteiro, uma vez, ou levanta erro. Não verifica a recontagem —
 * isso é `lerFechamento`.
 */
async function lerRecorteUmaVez(
  fonte: FonteDeLinhas,
  tamanhoDaPagina: number,
  tetoDeLinhas: number,
  tetoDeRequisicoes: number,
): Promise<{ linhas: LinhaBrutaDoFechamento[]; total: number }> {
  const linhas: LinhaBrutaDoFechamento[] = [];
  const vistos = new Set<string>();
  let cursor: string | null = null;
  let total: number | null = null;
  let requisicoes = 0;

  for (;;) {
    if (total !== null && linhas.length === total) break;

    requisicoes += 1;
    if (requisicoes > tetoDeRequisicoes) {
      throw new ErroDeLeituraDoFechamento(
        "requisicoes-excedidas",
        `A leitura passou de ${tetoDeRequisicoes} requisições sem completar o conjunto.`,
      );
    }

    const primeira = total === null;
    const pagina = await fonte.lerPagina({
      cursor,
      limite: tamanhoDaPagina,
      contar: primeira,
    });

    if (primeira) {
      const contagem = pagina.total;
      if (contagem === null || !Number.isSafeInteger(contagem) || contagem < 0) {
        throw new ErroDeLeituraDoFechamento(
          "contagem-ausente",
          "O banco não informou a contagem do recorte; não dá para provar que a leitura está completa.",
        );
      }
      if (contagem > tetoDeLinhas) {
        throw new ErroDeLeituraDoFechamento(
          "periodo-grande",
          `O recorte tem ${contagem} lançamentos, acima do teto de ${tetoDeLinhas}. Reduza o período.`,
        );
      }
      total = contagem;
      if (total === 0) break;
    }

    if (pagina.linhas.length > tamanhoDaPagina) {
      throw new ErroDeLeituraDoFechamento(
        "pagina-maior-que-o-pedido",
        `A página trouxe ${pagina.linhas.length} linhas para um pedido de ${tamanhoDaPagina}.`,
      );
    }

    if (pagina.linhas.length === 0) {
      // total é conhecido aqui; chegar ao total já teria saído do laço.
      throw new ErroDeLeituraDoFechamento(
        "pagina-vazia-prematura",
        `A leitura acabou em ${linhas.length} de ${total} lançamentos: conjunto incompleto.`,
      );
    }

    for (const linha of pagina.linhas) {
      if (typeof linha.id !== "string" || linha.id === "") {
        throw new ErroDeLeituraDoFechamento("id-invalido", "Lançamento sem identificador.");
      }
      if (vistos.has(linha.id)) {
        throw new ErroDeLeituraDoFechamento(
          "id-repetido",
          `O lançamento ${linha.id} veio mais de uma vez.`,
        );
      }
      if (cursor !== null && linha.id <= cursor) {
        throw new ErroDeLeituraDoFechamento(
          "ordem-violada",
          `O lançamento ${linha.id} não vem depois de ${cursor}.`,
        );
      }
      vistos.add(linha.id);
      linhas.push(linha);
      cursor = linha.id;
    }

    if (total !== null && linhas.length > total) {
      throw new ErroDeLeituraDoFechamento(
        "excedeu-a-contagem",
        `Foram lidos ${linhas.length} lançamentos para uma contagem de ${total}.`,
      );
    }
  }

  return { linhas, total: total ?? 0 };
}

/**
 * Lê o recorte inteiro e prova que ele estava completo e estável: contagem
 * inicial = linhas lidas = contagem final.
 */
export async function lerFechamento(
  fonte: FonteDeLinhas,
  opcoes: OpcoesDeLeitura = {},
): Promise<LinhaBrutaDoFechamento[]> {
  const tamanhoDaPagina = opcoes.tamanhoDaPagina ?? TAMANHO_DA_PAGINA;
  const tetoDeLinhas = opcoes.tetoDeLinhas ?? TETO_DE_LINHAS;
  const tetoDeRequisicoes = opcoes.tetoDeRequisicoes ?? TETO_DE_REQUISICOES;
  const tentativas = Math.max(1, opcoes.tentativas ?? 2);

  let ultimoErro: ErroDeLeituraDoFechamento | null = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    const { linhas, total } = await lerRecorteUmaVez(
      fonte,
      tamanhoDaPagina,
      tetoDeLinhas,
      tetoDeRequisicoes,
    );

    const recontagem = await fonte.contar();
    if (recontagem === total) return linhas;

    ultimoErro = new ErroDeLeituraDoFechamento(
      "dados-mudaram",
      `O recorte tinha ${total} lançamentos no início da leitura e ${recontagem} no fim: os dados mudaram durante a leitura.`,
    );
  }

  throw ultimoErro as ErroDeLeituraDoFechamento;
}

/**
 * O `select`, nomeado campo a campo. O recorte é feito por `!inner` em cada nível
 * do caminho `timesheet_entries → timesheets → operations` — o mesmo caminho que
 * `gerar_fatura` usa, e a data é a da FOLHA (`timesheets.work_date`).
 */
export const SELECT_DO_FECHAMENTO = [
  "id",
  "employee_id",
  "status",
  "check_in",
  "check_out",
  "worked_minutes",
  "overtime_minutes",
  "invoice_id",
  "faturado:billed_amount::text",
  "custo:cost_amount::text",
  "taxa_da_diaria:daily_rate_snapshot::text",
  "employees(id, name, role)",
  "timesheets!inner(id, work_date, status, operation_id, operations!inner(id, client_id, name, contract_id), shifts(id, name))",
].join(", ");

/**
 * A fonte real. Usa o cliente da SESSÃO do admin, então a RLS (`aal2` e `admin`)
 * continua sendo a fronteira dos dados. Nenhum `service_role`.
 */
export function criarFonteSupabase(
  supabase: SupabaseClient<Database>,
  filtro: FiltroDoFechamento,
): FonteDeLinhas {
  return {
    async lerPagina({ cursor, limite, contar }) {
      // O recorte de cliente e período é repetido (e não compartilhado) na
      // contagem logo abaixo, de propósito: as duas consultas precisam do mesmo
      // filtro, e um teste confere que ele chega ao banco nas duas.
      let consulta = supabase
        .from("timesheet_entries")
        .select(SELECT_DO_FECHAMENTO, contar ? { count: "exact" } : undefined)
        .eq("timesheets.operations.client_id", filtro.clienteId)
        .gte("timesheets.work_date", filtro.inicio)
        .lte("timesheets.work_date", filtro.fim);
      if (cursor !== null) consulta = consulta.gt("id", cursor);

      const { data, error, count } = await consulta.order("id", { ascending: true }).limit(limite);

      if (error) {
        throw new ErroDeLeituraDoFechamento(
          "consulta",
          `Falha ao ler os lançamentos: ${error.message}`,
        );
      }

      return {
        linhas: (data ?? []) as unknown as LinhaBrutaDoFechamento[],
        total: contar ? (count ?? null) : null,
      };
    },

    async contar() {
      const { count, error } = await supabase
        .from("timesheet_entries")
        .select("id, timesheets!inner(id, operations!inner(id))", { count: "exact", head: true })
        .eq("timesheets.operations.client_id", filtro.clienteId)
        .gte("timesheets.work_date", filtro.inicio)
        .lte("timesheets.work_date", filtro.fim);

      if (error) {
        throw new ErroDeLeituraDoFechamento(
          "consulta",
          `Falha ao contar os lançamentos: ${error.message}`,
        );
      }
      if (count === null) {
        throw new ErroDeLeituraDoFechamento(
          "contagem-ausente",
          "O banco não informou a contagem final do recorte.",
        );
      }
      return count;
    },
  };
}
