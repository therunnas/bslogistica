/**
 * O cliente HTTP do Fechamento, do lado do navegador.
 *
 * Fala SÓ com `GET /api/fechamento`. Não importa Supabase: a leitura, a RLS e o
 * cálculo estão do outro lado da API, e a tela nunca monta consulta nem soma
 * valor. Também não importa React, para a suíte exercitá-lo com um `fetch`
 * falso.
 *
 * ERROS
 *
 * Toda resposta que não seja 2xx vira `ErroDaApiDoFechamento`; nada vira lista
 * vazia. A tela NUNCA exibe o corpo cru da resposta: `mensagemDoErro` escolhe uma
 * frase fixa a partir do código estável da API (a única mensagem do servidor
 * reaproveitada é a de filtro inválido, escrita para o usuário).
 */

import { VERSAO_DO_FECHAMENTO, type FechamentoData } from "./tipos";

export interface FiltrosDaBusca {
  clienteId: string;
  /** `YYYY-MM-DD`. */
  inicio: string;
  /** `YYYY-MM-DD`. */
  fim: string;
}

export class ErroDaApiDoFechamento extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDaApiDoFechamento";
    this.status = status;
    this.codigo = codigo;
  }
}

export interface OpcoesDaBusca {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function ehFinanceiro(valor: unknown): boolean {
  return (
    ehObjeto(valor) &&
    [
      "apontamentosCentavos",
      "adicionaisCentavos",
      "ajusteFaturadoCentavos",
      "ajustePrevistoCentavos",
      "ajusteCentavos",
      "receitaCentavos",
      "custoCentavos",
      "resultadoCentavos",
      "aFaturarCentavos",
      "jaFaturadoCentavos",
    ].every((campo) => Number.isSafeInteger(valor[campo]))
  );
}

function ehValores(valor: unknown): boolean {
  return (
    ehObjeto(valor) &&
    [
      "diarias",
      "minutosExtras",
      "minutosExtrasCobrados",
      "diariaCentavos",
      "extraCentavos",
      "custoCentavos",
      "faturadoCentavos",
      "resultadoCentavos",
    ].every((campo) => Number.isSafeInteger(valor[campo]))
  );
}

/** Confere só a forma que a tela usa. Corpo inesperado é erro, não dado. */
export function ehFechamentoData(valor: unknown): valor is FechamentoData {
  return (
    ehObjeto(valor) &&
    valor["versao"] === VERSAO_DO_FECHAMENTO &&
    ehObjeto(valor["meta"]) &&
    typeof valor["meta"]["clienteNome"] === "string" &&
    typeof valor["meta"]["inicio"] === "string" &&
    typeof valor["meta"]["fim"] === "string" &&
    typeof valor["meta"]["geradoEm"] === "string" &&
    ehValores(valor["consolidado"]) &&
    ehValores(valor["aFaturar"]) &&
    ehValores(valor["jaFaturado"]) &&
    ehFinanceiro(valor["financeiro"]) &&
    Array.isArray(valor["conciliacao"]) &&
    Array.isArray(valor["adicionais"]) &&
    Array.isArray(valor["ajustesAcumulados"]) &&
    Array.isArray(valor["ajustesFaturados"]) &&
    Array.isArray(valor["saldoDeHoras"]) &&
    Number.isSafeInteger(valor["faltas"]) &&
    Array.isArray(valor["colaboradores"]) &&
    Array.isArray(valor["detalhes"]) &&
    Array.isArray(valor["alertas"])
  );
}

function ehCancelamento(erro: unknown): boolean {
  return ehObjeto(erro) && erro["name"] === "AbortError";
}

export async function buscarFechamento(
  filtros: FiltrosDaBusca,
  opcoes: OpcoesDaBusca = {},
): Promise<FechamentoData> {
  const consulta = new URLSearchParams({
    cliente: filtros.clienteId,
    inicio: filtros.inicio,
    fim: filtros.fim,
  });
  const requisitar = opcoes.fetchImpl ?? fetch;

  let resposta: Response;
  try {
    resposta = await requisitar(`/api/fechamento?${consulta.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      ...(opcoes.signal ? { signal: opcoes.signal } : {}),
    });
  } catch (erro) {
    // O cancelamento (troca de filtro) não é falha: segue como está para o TanStack ignorar.
    if (ehCancelamento(erro)) throw erro;
    throw new ErroDaApiDoFechamento(0, "rede", "Falha de rede ao carregar o fechamento.");
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }

  if (!resposta.ok) {
    const detalhe = ehObjeto(corpo) && ehObjeto(corpo["erro"]) ? corpo["erro"] : null;
    const codigo =
      detalhe && typeof detalhe["codigo"] === "string" ? detalhe["codigo"] : "desconhecido";
    const mensagem = detalhe && typeof detalhe["mensagem"] === "string" ? detalhe["mensagem"] : "";
    throw new ErroDaApiDoFechamento(resposta.status, codigo, mensagem);
  }

  if (!ehFechamentoData(corpo)) {
    throw new ErroDaApiDoFechamento(
      resposta.status,
      "resposta-invalida",
      "Resposta do fechamento em formato inesperado.",
    );
  }
  return corpo;
}

const MENSAGEM_PADRAO = "Não foi possível carregar o fechamento. Tente novamente.";

/** A frase que a tela mostra. Nunca o corpo da resposta, nem stack, SQL ou id interno. */
export function mensagemDoErro(erro: unknown): string {
  if (!(erro instanceof ErroDaApiDoFechamento)) return MENSAGEM_PADRAO;

  switch (erro.codigo) {
    case "nao-autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "acesso-negado":
      return "Você não tem permissão para ver o fechamento.";
    case "filtro-invalido":
      return erro.message !== "" ? erro.message : "Confira o cliente e o período informados.";
    case "cliente-nao-encontrado":
      return "Cliente não encontrado.";
    case "dados-mudaram":
      return "Os dados mudaram durante a leitura. Tente novamente.";
    case "leitura-incompleta":
      return "Não foi possível garantir que todos os lançamentos foram lidos. Tente novamente ou reduza o período.";
    case "dado-inconsistente":
      return "Há um lançamento com dado inconsistente, e o fechamento não pode ser calculado. Avise o suporte.";
    default:
      return MENSAGEM_PADRAO;
  }
}

const NAO_REPETIVEIS = new Set([
  "nao-autenticado",
  "acesso-negado",
  "filtro-invalido",
  "cliente-nao-encontrado",
  "dado-inconsistente",
]);

/** "Tentar novamente" só faz sentido quando repetir pode dar certo. */
export function podeTentarDeNovo(erro: unknown): boolean {
  return !(erro instanceof ErroDaApiDoFechamento) || !NAO_REPETIVEIS.has(erro.codigo);
}
