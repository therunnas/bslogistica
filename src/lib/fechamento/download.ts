/**
 * O cliente HTTP do download do XLSX, do lado do navegador.
 *
 * Fala SÓ com `POST /api/fechamento/xlsx` e envia SÓ o recorte e a assinatura
 * que a tela exibiu. Nenhum valor financeiro viaja do navegador: o servidor
 * relê, confere a assinatura e gera o arquivo. Não importa React nem Supabase,
 * para a suíte exercitá-lo com um `fetch` falso.
 *
 * ERROS
 *
 * Toda resposta que não seja um XLSX vira `ErroDaApiDoFechamento`. A tela nunca
 * mostra o corpo cru: `mensagemDoDownload` escolhe uma frase fixa a partir do
 * código estável da API. `409 assinatura-divergente` é o caso que pede ação —
 * os dados mudaram, atualize o fechamento — e `pedeAtualizacao` o identifica.
 */

import { ErroDaApiDoFechamento, mensagemDoErro, type FiltrosDaBusca } from "./buscar";

export const TIPO_DO_XLSX_ESPERADO =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface PedidoDeXlsx extends FiltrosDaBusca {
  /** `meta.assinatura` do fechamento que a tela está mostrando. */
  assinatura: string;
}

export interface OpcoesDoDownload {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

export async function baixarXlsx(
  pedido: PedidoDeXlsx,
  opcoes: OpcoesDoDownload = {},
): Promise<Blob> {
  const requisitar = opcoes.fetchImpl ?? fetch;

  let resposta: Response;
  try {
    resposta = await requisitar("/api/fechamento/xlsx", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: TIPO_DO_XLSX_ESPERADO },
      body: JSON.stringify({
        cliente: pedido.clienteId,
        inicio: pedido.inicio,
        fim: pedido.fim,
        assinatura: pedido.assinatura,
      }),
      ...(opcoes.signal ? { signal: opcoes.signal } : {}),
    });
  } catch {
    throw new ErroDaApiDoFechamento(0, "rede", "Falha de rede ao baixar o arquivo.");
  }

  if (!resposta.ok) {
    let corpo: unknown = null;
    try {
      corpo = await resposta.json();
    } catch {
      corpo = null;
    }
    const detalhe = ehObjeto(corpo) && ehObjeto(corpo["erro"]) ? corpo["erro"] : null;
    const codigo =
      detalhe && typeof detalhe["codigo"] === "string" ? detalhe["codigo"] : "desconhecido";
    const mensagem = detalhe && typeof detalhe["mensagem"] === "string" ? detalhe["mensagem"] : "";
    throw new ErroDaApiDoFechamento(resposta.status, codigo, mensagem);
  }

  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().startsWith(TIPO_DO_XLSX_ESPERADO)) {
    throw new ErroDaApiDoFechamento(
      resposta.status,
      "resposta-invalida",
      "Resposta do download em formato inesperado.",
    );
  }

  return resposta.blob();
}

const MENSAGEM_DO_DOWNLOAD = "Não foi possível gerar o arquivo. Tente novamente.";

/** Os dados mudaram entre a tela e o download: é preciso atualizar o fechamento. */
export function pedeAtualizacao(erro: unknown): boolean {
  return erro instanceof ErroDaApiDoFechamento && erro.codigo === "assinatura-divergente";
}

/** A frase que a tela mostra. Nunca o corpo da resposta, nem stack, SQL ou id interno. */
export function mensagemDoDownload(erro: unknown): string {
  if (!(erro instanceof ErroDaApiDoFechamento)) return MENSAGEM_DO_DOWNLOAD;

  switch (erro.codigo) {
    case "assinatura-divergente":
      return "Os dados do fechamento foram alterados. Atualize o fechamento antes de baixar.";
    case "arquivo-grande":
      return "O arquivo ficou grande demais para baixar. Reduza o período e tente novamente.";
    case "nao-autenticado":
    case "acesso-negado":
    case "filtro-invalido":
    case "cliente-nao-encontrado":
    case "dado-inconsistente":
    case "leitura-incompleta":
      return mensagemDoErro(erro);
    default:
      return MENSAGEM_DO_DOWNLOAD;
  }
}
