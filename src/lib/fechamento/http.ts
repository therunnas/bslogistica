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
