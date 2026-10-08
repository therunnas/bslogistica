/**
 * Camada HTTP do Fechamento: as decisões puras do Route Handler.
 *
 * O handler (`src/app/api/fechamento/route.ts`) só encadeia: acesso → filtros →
 * `carregarFechamento` → resposta. Tudo que é decisão mora aqui, sem Next e sem
 * Supabase, para a suíte exercitar sem subir servidor:
 *
 *  - `decidirAcesso`: quem entra;
 *  - `extrairFiltros`: o que a URL pode trazer;
 *  - `descreverErro`: erro interno → status HTTP e corpo seguro.
 *
 * O CORPO DE ERRO NUNCA VAZA INTERNOS. Mensagens de erro do núcleo citam ids de
 * lançamento e valores; mensagens do banco citam tabelas. Nada disso sai: o
 * cliente recebe um código estável e uma frase fixa. O detalhe vai para o log
 * do servidor, onde o administrador do sistema pode lê-lo.
 *
 * STATUS
 *
 *  - 400 filtro, período ou parâmetro inválido;
 *  - 401 sem sessão;
 *  - 403 sem papel `admin` ou sem segundo fator;
 *  - 404 cliente inexistente OU inacessível (a mesma resposta, de propósito);
 *  - 409 os dados mudaram durante a leitura (tente de novo);
 *  - 422 a leitura não pôde ser provada completa, ou há dado inconsistente;
 *  - 500 qualquer outra falha.
 */

import {
  ErroDeClienteInacessivel,
  ErroDeDadoDoFechamento,
  ErroDeDadoFinanceiro,
  ErroDeFiltroDoFechamento,
} from "./erros";
import { ErroDeLeituraDoFechamento } from "./leitura";

export interface CorpoDeErro {
  erro: { codigo: string; mensagem: string };
}

export interface RespostaDeErro {
  status: number;
  corpo: CorpoDeErro;
}

function erro(status: number, codigo: string, mensagem: string): RespostaDeErro {
  return { status, corpo: { erro: { codigo, mensagem } } };
}

/** Parâmetros que a V1 aceita. Qualquer outro é recusado. */
export const PARAMETROS_ACEITOS = ["cliente", "inicio", "fim"] as const;

/**
 * Quem pode chamar. Recebe a `situacao` de `lerAcesso()` (a única decisão de
 * acesso do projeto) e se o papel é `admin`. `liberado` já implica AAL2 para o
 * admin, então não há segunda checagem de nível aqui — recriá-la é como se
 * produz duas definições de "liberado".
 */
export function decidirAcesso(situacao: string, ehAdmin: boolean): RespostaDeErro | null {
  if (situacao === "sem-sessao") {
    return erro(401, "nao-autenticado", "Faça login para continuar.");
  }
  if (situacao !== "liberado" || !ehAdmin) {
    return erro(403, "acesso-negado", "Acesso negado.");
  }
  return null;
}

/**
 * Lê os três parâmetros da V1. Recusa parâmetro desconhecido, repetido ou
 * ausente: a URL não é um canal para ampliar o escopo da consulta.
 */
export function extrairFiltros(params: URLSearchParams): {
  clienteId: string;
  inicio: string;
  fim: string;
} {
  const aceitos = new Set<string>(PARAMETROS_ACEITOS);
  for (const nome of new Set(params.keys())) {
    if (!aceitos.has(nome)) {
      throw new ErroDeFiltroDoFechamento("parametro-invalido", "Parâmetro não suportado.");
    }
  }

  const unico = (nome: (typeof PARAMETROS_ACEITOS)[number]): string => {
    const valores = params.getAll(nome);
    if (valores.length !== 1 || valores[0] === undefined || valores[0] === "") {
      throw new ErroDeFiltroDoFechamento(
        "parametro-invalido",
        `Informe o parâmetro "${nome}" uma única vez.`,
      );
    }
    return valores[0];
  };

  return { clienteId: unico("cliente"), inicio: unico("inicio"), fim: unico("fim") };
}

/** Códigos de leitura que significam "o conjunto não pôde ser provado completo". */
const CODIGOS_DE_INTEGRIDADE = new Set([
  "contagem-ausente",
  "periodo-grande",
  "pagina-vazia-prematura",
  "pagina-maior-que-o-pedido",
  "id-invalido",
  "id-repetido",
  "ordem-violada",
  "excedeu-a-contagem",
  "requisicoes-excedidas",
]);

/** Traduz um erro do Fechamento em resposta. Nunca devolve a mensagem interna. */
export function descreverErro(causa: unknown): RespostaDeErro {
  if (causa instanceof ErroDeFiltroDoFechamento) {
    return erro(400, "filtro-invalido", causa.message);
  }
  if (causa instanceof ErroDeClienteInacessivel) {
    return erro(404, "cliente-nao-encontrado", "Cliente não encontrado.");
  }
  if (causa instanceof ErroDeLeituraDoFechamento) {
    if (causa.codigo === "dados-mudaram") {
      return erro(409, "dados-mudaram", "Os dados mudaram durante a leitura. Tente novamente.");
    }
    if (CODIGOS_DE_INTEGRIDADE.has(causa.codigo)) {
      return erro(
        422,
        "leitura-incompleta",
        "Não foi possível garantir que todos os lançamentos foram lidos.",
      );
    }
    return erro(500, "erro-interno", "Não foi possível carregar o fechamento.");
  }
  if (causa instanceof ErroDeDadoFinanceiro || causa instanceof ErroDeDadoDoFechamento) {
    return erro(
      422,
      "dado-inconsistente",
      "Há um lançamento com dado inconsistente; o fechamento não pode ser calculado.",
    );
  }
  return erro(500, "erro-interno", "Não foi possível carregar o fechamento.");
}

// ---------------------------------------------------------------------------
// Download do XLSX (POST /api/fechamento/xlsx)
//
// O corpo leva SÓ o recorte e a assinatura que a tela viu. Valor financeiro
// nenhum viaja do navegador: o servidor relê, recalcula a assinatura e só entrega
// o arquivo se ela coincidir com a enviada.

/** Campos que o corpo do POST aceita. Qualquer outro é recusado. */
export const CAMPOS_DO_XLSX = ["cliente", "inicio", "fim", "assinatura"] as const;

/** Tamanho máximo do corpo do POST: quatro campos curtos. */
export const TETO_DO_CORPO_DO_XLSX_EM_BYTES = 1024;

/**
 * Teto do arquivo. Funções da Vercel respondem com no máximo 4,5 MB; 4 MB deixa
 * folga para cabeçalhos. Acima disso é erro controlado, nunca arquivo cortado.
 */
export const TETO_DO_XLSX_EM_BYTES = 4_000_000;

export const MENSAGEM_ASSINATURA_DIVERGENTE =
  "Os dados do fechamento foram alterados. Atualize o fechamento antes de baixar.";

const FORMATO_DE_ASSINATURA = /^[0-9a-f]{64}$/;

/**
 * Valida o corpo do POST. Recusa o que não for objeto simples, campo
 * desconhecido, ausente ou que não seja texto. Lança `ErroDeFiltroDoFechamento`
 * (vira 400); o cliente e o período ainda passam por `validarFiltros`.
 */
export function extrairCorpoDoXlsx(corpo: unknown): {
  clienteId: string;
  inicio: string;
  fim: string;
  assinatura: string;
} {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new ErroDeFiltroDoFechamento("parametro-invalido", "Corpo da requisição inválido.");
  }
  const campos = corpo as Record<string, unknown>;

  const aceitos = new Set<string>(CAMPOS_DO_XLSX);
  for (const nome of Object.keys(campos)) {
    if (!aceitos.has(nome)) {
      throw new ErroDeFiltroDoFechamento("parametro-invalido", "Parâmetro não suportado.");
    }
  }

  const texto = (nome: (typeof CAMPOS_DO_XLSX)[number]): string => {
    const valor = campos[nome];
    if (typeof valor !== "string" || valor === "") {
      throw new ErroDeFiltroDoFechamento("parametro-invalido", `Informe o campo "${nome}".`);
    }
    return valor;
  };

  const assinatura = texto("assinatura").toLowerCase();
  if (!FORMATO_DE_ASSINATURA.test(assinatura)) {
    throw new ErroDeFiltroDoFechamento("parametro-invalido", "Assinatura inválida.");
  }

  return { clienteId: texto("cliente"), inicio: texto("inicio"), fim: texto("fim"), assinatura };
}

/** 409 quando a assinatura enviada não é a do snapshot atual. */
export function conferirAssinatura(enviada: string, atual: string): RespostaDeErro | null {
  if (enviada === atual) return null;
  return erro(409, "assinatura-divergente", MENSAGEM_ASSINATURA_DIVERGENTE);
}

/** 413 quando o arquivo passa do teto. O arquivo parcial nunca é entregue. */
export function conferirTamanhoDoXlsx(bytes: number): RespostaDeErro | null {
  if (bytes <= TETO_DO_XLSX_EM_BYTES) return null;
  return erro(
    413,
    "arquivo-grande",
    "O arquivo ficou grande demais para baixar. Reduza o período e tente novamente.",
  );
}

/** Cabeçalhos do download. O nome é reduzido a ASCII seguro, sem separador de caminho. */
export function cabecalhosDeDownload(nomeDoArquivo: string, tipo: string): Record<string, string> {
  const seguro = nomeDoArquivo.replace(/[^A-Za-z0-9._-]/g, "-");
  return {
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${seguro}"; filename*=UTF-8''${encodeURIComponent(seguro)}`,
    "Cache-Control": "no-store",
  };
}

/**
 * Lê o corpo da requisição como texto, com teto de bytes EFETIVO.
 *
 * `request.text()` acumula o corpo inteiro na memória e só depois se mede: um
 * corpo grande já foi lido quando a recusa chega. Aqui o corpo é lido por
 * pedaços e a leitura é cancelada assim que o total passa do teto — o que vale
 * também sem `Content-Length` (transferência em pedaços) e quando o cabeçalho
 * mente. Quando o cabeçalho existe e já excede o teto, recusa sem ler nada.
 *
 * Qualquer recusa é `ErroDeFiltroDoFechamento` (400), o mesmo contrato do corpo
 * inválido. Corpo vazio devolve "" e o JSON.parse de quem chama o recusa.
 */
export async function lerCorpoComLimite(request: Request, limiteEmBytes: number): Promise<string> {
  const invalido = () =>
    new ErroDeFiltroDoFechamento("parametro-invalido", "Corpo da requisição inválido.");

  const declarado = request.headers.get("content-length");
  if (declarado !== null) {
    const bytes = Number(declarado);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limiteEmBytes) throw invalido();
  }

  if (request.body === null) return "";

  const leitor = request.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limiteEmBytes) {
      await leitor.cancel().catch(() => undefined);
      throw invalido();
    }
    pedacos.push(value);
  }

  const inteiro = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    inteiro.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(inteiro);
  } catch {
    throw invalido();
  }
}
