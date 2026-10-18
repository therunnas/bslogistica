/**
 * Paginador por cursor para leituras da Data API (PostgREST).
 *
 * POR QUE EXISTE (C03). O PostgREST do projeto corta toda resposta em
 * `max_rows = 1000`, em silêncio: uma leitura sem paginação devolve as primeiras
 * 1000 linhas como se fossem o conjunto inteiro. Este módulo lê o conjunto até
 * o fim confirmado ou falha com erro explícito. Nunca devolve resultado parcial.
 *
 * COMO LÊ. Cursor na chave única e imutável (`id`), ordem `id ASC`:
 * cada página pede "linhas com id maior que o último visto". Não usa `OFFSET`,
 * que pula e duplica linhas quando há inserção ou exclusão entre as páginas.
 * O fim é provado por uma página VAZIA; página curta não encerra a leitura, porque
 * um teto remoto menor que o limite pedido também devolve página curta.
 *
 * O QUE GARANTE
 *  - toda linha que existe durante a leitura inteira aparece uma única vez;
 *  - a ordem é estritamente crescente em `id` (a ordem de exibição é de quem usa);
 *  - nenhum retorno parcial: qualquer falha lança `ErroPaginacao`;
 *  - com `contar`, um conjunto lido diferente do contado é detectado, relido uma
 *    vez e, persistindo, vira erro.
 *
 * O QUE NÃO GARANTE (limites declarados, não corrigíveis aqui)
 *  - NÃO é um snapshot. Cada requisição é uma transação própria. Contagem igual
 *    antes e depois NÃO prova que o conjunto não mudou: uma exclusão mais uma
 *    inserção preservam a contagem e passam sem aviso. O `marcador` opcional
 *    reduz essa janela, mas é detecção, não isolamento.
 *  - Linha inserida com `id` menor que o cursor corrente não entra naquela
 *    leitura (UUID não é monotônico). A contagem final é o que denuncia isso.
 *  - Valores de linhas lidas em momentos diferentes podem ser de instantes
 *    diferentes. Coerência transacional entre linhas ou tabelas exige uma única
 *    instrução SQL (RPC); está fora deste módulo.
 *
 * INDEPENDÊNCIA. Sem React, sem React Query, sem Supabase, sem rede: as leituras
 * entram por função injetada. Um adaptador de PostgREST faz, por página,
 * `.order("id").limit(limite)` e, quando houver cursor, `.gt("id", depoisDe)`,
 * somando os filtros da consulta. Os `id` precisam vir na mesma ordem do banco
 * (uuid em texto minúsculo), que é o que a comparação de texto abaixo supõe.
 */

export type CodigoErroPaginacao =
  | "PARAMETRO_INVALIDO"
  | "PAGINA_FALHOU"
  | "RESPOSTA_INVALIDA"
  | "RESPOSTA_EXCEDE_LIMITE"
  | "CURSOR_INVALIDO"
  | "CURSOR_SEM_AVANCO"
  | "ORDEM_INVALIDA"
  | "LIMITE_PAGINAS"
  | "CONTAGEM_FALHOU"
  | "CONTAGEM_INVALIDA"
  | "CONTAGEM_DIVERGENTE"
  | "MARCADOR_FALHOU"
  | "MARCADOR_DIVERGENTE";

export class ErroPaginacao extends Error {
  readonly codigo: CodigoErroPaginacao;
  /** Números úteis ao diagnóstico (nunca linhas). */
  readonly detalhes: Readonly<Record<string, number | string | null>> | undefined;

  constructor(
    codigo: CodigoErroPaginacao,
    mensagem: string,
    opcoes?: { cause?: unknown; detalhes?: Record<string, number | string | null> },
  ) {
    super(mensagem, opcoes?.cause === undefined ? undefined : { cause: opcoes.cause });
    this.name = "ErroPaginacao";
    this.codigo = codigo;
    this.detalhes = opcoes?.detalhes;
  }
}

export interface PedidoDePagina {
  /** `id` da última linha já lida; `null` na primeira página. */
  readonly depoisDe: string | null;
  /** Máximo de linhas que a página pode trazer. */
  readonly limite: number;
}

export interface RespostaDePagina<T> {
  readonly linhas: readonly T[];
}

export interface OpcoesDePaginacao<T> {
  /** Lê UMA página: linhas com `id` maior que `depoisDe`, em `id ASC`, até `limite`. */
  readonly lerPagina: (pedido: PedidoDePagina) => Promise<RespostaDePagina<T>>;
  /**
   * Contagem exata do MESMO conjunto filtrado. Sem ela a leitura acontece, mas
   * `completudeVerificada` fica `false`: não há como afirmar que está completa.
   */
  readonly contar?: () => Promise<number>;
  /**
   * Verificação opcional de mudança (por exemplo, `max(updated_at)`), lida antes
   * e depois. Nem toda tabela tem uma coluna assim, então não é requisito. É
   * detecção de escrita concorrente, não substitui snapshot.
   */
  readonly marcador?: () => Promise<string | null>;
  /** Extrai o `id` da linha. Padrão: a propriedade `id`. */
  readonly extrairId?: (linha: T) => unknown;
  /** Linhas por página. Padrão 500; entre 1 e 1000. */
  readonly tamanhoPagina?: number;
  /** Teto de páginas por tentativa (guarda contra laço). Padrão 200. */
  readonly maxPaginas?: number;
}

export interface ResultadoDePaginacao<T> {
  readonly linhas: T[];
  /** Requisições de página feitas na tentativa que valeu (inclui a vazia final). */
  readonly paginas: number;
  /** Contagem confirmada, ou `null` se `contar` não foi informado. */
  readonly contagem: number | null;
  /**
   * `true` só quando `contar` foi informado e confere com o lido. Não significa
   * consistência de snapshot: ver o cabeçalho do módulo.
   */
  readonly completudeVerificada: boolean;
  /** 0 ou 1: releituras feitas por divergência detectada. */
  readonly releituras: 0 | 1;
}

const TAMANHO_PADRAO = 500;
const TAMANHO_MAXIMO = 1000;
const MAX_PAGINAS_PADRAO = 200;
const MAX_TENTATIVAS = 2; // a leitura original e, no máximo, uma releitura

function inteiroEntre(valor: unknown, minimo: number, maximo: number): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= minimo && valor <= maximo;
}

function contagemValida(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0;
}

function idDe<T>(linha: T, extrair: (linha: T) => unknown): string {
  const id = extrair(linha);
  if (typeof id !== "string" || id.length === 0) {
    throw new ErroPaginacao(
      "CURSOR_INVALIDO",
      "Linha sem identificador textual utilizável como cursor.",
    );
  }
  return id;
}

async function contarOuFalhar(contar: () => Promise<number>): Promise<number> {
  let valor: unknown;
  try {
    valor = await contar();
  } catch (causa) {
    throw new ErroPaginacao("CONTAGEM_FALHOU", "Não foi possível contar os registros.", {
      cause: causa,
    });
  }
  if (!contagemValida(valor)) {
    throw new ErroPaginacao(
      "CONTAGEM_INVALIDA",
      "A contagem devolvida não é um inteiro não negativo; não serve para confirmar a leitura.",
    );
  }
  return valor;
}

async function marcadorOuFalhar(marcador: () => Promise<string | null>): Promise<string | null> {
  try {
    return await marcador();
  } catch (causa) {
    throw new ErroPaginacao("MARCADOR_FALHOU", "Não foi possível ler o marcador de alteração.", {
      cause: causa,
    });
  }
}

interface Tentativa<T> {
  linhas: T[];
  paginas: number;
  contagemAntes: number | null;
  contagemDepois: number | null;
  marcadorAntes: string | null;
  marcadorDepois: string | null;
}

async function lerUmaVez<T>(
  opcoes: OpcoesDePaginacao<T>,
  tamanho: number,
  maxPaginas: number,
  extrair: (linha: T) => unknown,
): Promise<Tentativa<T>> {
  const contagemAntes = opcoes.contar ? await contarOuFalhar(opcoes.contar) : null;
  const marcadorAntes = opcoes.marcador ? await marcadorOuFalhar(opcoes.marcador) : null;

  const linhas: T[] = [];
  let cursor: string | null = null;
  let paginas = 0;

  for (;;) {
    if (paginas >= maxPaginas) {
      throw new ErroPaginacao(
        "LIMITE_PAGINAS",
        `Limite de ${maxPaginas} páginas atingido sem confirmar o fim da leitura.`,
        { detalhes: { maxPaginas, lidas: linhas.length } },
      );
    }
    paginas++;

    let resposta: RespostaDePagina<T>;
    try {
      resposta = await opcoes.lerPagina({ depoisDe: cursor, limite: tamanho });
    } catch (causa) {
      throw new ErroPaginacao("PAGINA_FALHOU", `Falha ao ler a página ${paginas}.`, {
        cause: causa,
        detalhes: { pagina: paginas, lidas: linhas.length },
      });
    }

    const pagina = resposta?.linhas;
    if (!Array.isArray(pagina)) {
      throw new ErroPaginacao(
        "RESPOSTA_INVALIDA",
        `A página ${paginas} não trouxe uma lista de linhas.`,
      );
    }
    if (pagina.length > tamanho) {
      throw new ErroPaginacao(
        "RESPOSTA_EXCEDE_LIMITE",
        `A página ${paginas} trouxe mais linhas (${pagina.length}) que o limite pedido (${tamanho}).`,
        { detalhes: { pagina: paginas, recebidas: pagina.length, limite: tamanho } },
      );
    }

    // Página vazia é a única prova de fim.
    if (pagina.length === 0) break;

    let anterior: string | null = cursor;
    for (const linha of pagina as readonly T[]) {
      const id = idDe(linha, extrair);
      if (anterior !== null && id <= anterior) {
        // Na primeira linha da página, o anterior é o cursor: a fonte ignorou o cursor
        // ou repetiu a página. Nas demais, a ordem ou a unicidade foi violada.
        const semAvanco = anterior === cursor;
        throw new ErroPaginacao(
          semAvanco ? "CURSOR_SEM_AVANCO" : "ORDEM_INVALIDA",
          semAvanco
            ? `A página ${paginas} não avançou o cursor (resposta repetida ou cursor ignorado).`
            : `A página ${paginas} não está em ordem estritamente crescente de id.`,
          { detalhes: { pagina: paginas } },
        );
      }
      anterior = id;
      linhas.push(linha);
    }
    cursor = anterior;
  }

  const contagemDepois = opcoes.contar ? await contarOuFalhar(opcoes.contar) : null;
  const marcadorDepois = opcoes.marcador ? await marcadorOuFalhar(opcoes.marcador) : null;

  return { linhas, paginas, contagemAntes, contagemDepois, marcadorAntes, marcadorDepois };
}

/**
 * Lê o conjunto inteiro, página a página. Ver o cabeçalho do módulo para garantias
 * e limites. Lança `ErroPaginacao` em qualquer falha; nunca devolve parcial.
 */
export async function lerTudoPaginado<T extends object>(
  opcoes: OpcoesDePaginacao<T>,
): Promise<ResultadoDePaginacao<T>> {
  if (typeof opcoes?.lerPagina !== "function") {
    throw new ErroPaginacao(
      "PARAMETRO_INVALIDO",
      "`lerPagina` é obrigatório e precisa ser uma função.",
    );
  }
  const tamanho = opcoes.tamanhoPagina ?? TAMANHO_PADRAO;
  if (!inteiroEntre(tamanho, 1, TAMANHO_MAXIMO)) {
    throw new ErroPaginacao(
      "PARAMETRO_INVALIDO",
      `\`tamanhoPagina\` precisa ser um inteiro entre 1 e ${TAMANHO_MAXIMO}.`,
    );
  }
  const maxPaginas = opcoes.maxPaginas ?? MAX_PAGINAS_PADRAO;
  if (!inteiroEntre(maxPaginas, 1, Number.MAX_SAFE_INTEGER)) {
    throw new ErroPaginacao(
      "PARAMETRO_INVALIDO",
      "`maxPaginas` precisa ser um inteiro maior que zero.",
    );
  }
  const extrair = opcoes.extrairId ?? ((linha: T) => (linha as { id?: unknown }).id);

  let ultima: Tentativa<T> | null = null;
  let motivo: "contagem" | "marcador" = "contagem";

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const t = await lerUmaVez(opcoes, tamanho, maxPaginas, extrair);
    ultima = t;

    const marcadorMudou = opcoes.marcador !== undefined && t.marcadorAntes !== t.marcadorDepois;
    const contagemDiverge =
      opcoes.contar !== undefined &&
      (t.contagemAntes !== t.contagemDepois || t.linhas.length !== t.contagemDepois);

    if (!marcadorMudou && !contagemDiverge) {
      return {
        linhas: t.linhas,
        paginas: t.paginas,
        contagem: t.contagemDepois,
        completudeVerificada: opcoes.contar !== undefined,
        releituras: tentativa === 1 ? 0 : 1,
      };
    }
    motivo = contagemDiverge ? "contagem" : "marcador";
  }

  const t = ultima as Tentativa<T>;
  const detalhes = {
    tentativas: MAX_TENTATIVAS,
    lidas: t.linhas.length,
    contagemAntes: t.contagemAntes,
    contagemDepois: t.contagemDepois,
  };
  if (motivo === "marcador") {
    throw new ErroPaginacao(
      "MARCADOR_DIVERGENTE",
      "Os dados mudaram durante a leitura e não estabilizaram após a releitura.",
      { detalhes },
    );
  }
  throw new ErroPaginacao(
    "CONTAGEM_DIVERGENTE",
    "A quantidade lida não confere com a contagem, mesmo após a releitura; a leitura não está comprovadamente completa.",
    { detalhes },
  );
}
