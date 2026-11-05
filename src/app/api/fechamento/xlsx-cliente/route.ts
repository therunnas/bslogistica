import { NextResponse } from "next/server";

import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { ehAdmin } from "@/app/(painel)/_papel";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { carregarFechamento, dependenciasComSupabase } from "@/lib/fechamento/carregar";
import { verificarDisponibilidade } from "@/lib/fechamento/disponibilidade";
import { ErroDeFiltroDoFechamento } from "@/lib/fechamento/erros";
import { nomeDoArquivo } from "@/lib/fechamento/exportacao";
import { SUFIXO_DO_ARQUIVO_DO_CLIENTE } from "@/lib/fechamento/exportacao-cliente";
import {
  TETO_DO_CORPO_DO_XLSX_EM_BYTES,
  cabecalhosDeDownload,
  conferirAssinatura,
  conferirTamanhoDoXlsx,
  decidirAcesso,
  descreverErro,
  extrairCorpoDoXlsx,
  lerCorpoComLimite,
  negarSeIndisponivel,
} from "@/lib/fechamento/http";
import type { RespostaDeErro } from "@/lib/fechamento/http";
import { TIPO_DO_XLSX } from "@/lib/fechamento/xlsx";
import { gerarXlsxDoCliente } from "@/lib/fechamento/xlsx-cliente";

/**
 * POST /api/fechamento/xlsx-cliente
 *
 * Corpo JSON: `{ cliente, inicio, fim, assinatura }` — o mesmo de `/api/fechamento/xlsx`. Devolve
 * o XLSX PARA O CLIENTE (modelo Dynamis): lançamentos por colaborador e data, serviços avulsos e
 * resumo por colaborador, sem custo, resultado nem margem.
 *
 * Mesmo encadeamento da rota interna: acesso → disponibilidade → corpo → `carregarFechamento` →
 * conferência da assinatura → `gerarXlsxDoCliente`. Nenhum valor financeiro entra pelo corpo; o
 * arquivo nasce do `FechamentoData` relido agora, sob RLS e com o cliente da SESSÃO — nunca
 * `service_role`. A assinatura garante que o cliente recebe exatamente o que a tela mostrou.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "Cache-Control": "no-store" } as const;

function responderErro({ status, corpo }: RespostaDeErro) {
  return NextResponse.json(corpo, { status, headers: SEM_CACHE });
}

/** Lê o corpo JSON com teto de tamanho. Lança `ErroDeFiltroDoFechamento`. */
async function lerCorpo(request: Request): Promise<unknown> {
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().startsWith("application/json")) {
    throw new ErroDeFiltroDoFechamento("parametro-invalido", "Corpo da requisição inválido.");
  }

  const texto = await lerCorpoComLimite(request, TETO_DO_CORPO_DO_XLSX_EM_BYTES);

  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new ErroDeFiltroDoFechamento("parametro-invalido", "Corpo da requisição inválido.");
  }
}

export async function POST(request: Request) {
  const acesso = await lerAcesso();
  const negado = decidirAcesso(
    acesso.situacao,
    acesso.situacao === "liberado" && ehAdmin(acesso.papeis),
  );
  if (negado) return responderErro(negado);

  try {
    const supabase = await criarClienteServidor();
    const indisponivel = negarSeIndisponivel(await verificarDisponibilidade(supabase));
    if (indisponivel) return responderErro(indisponivel);

    const { assinatura, ...filtros } = extrairCorpoDoXlsx(await lerCorpo(request));
    const fechamento = await carregarFechamento(filtros, dependenciasComSupabase(supabase));

    const divergente = conferirAssinatura(assinatura, fechamento.meta.assinatura);
    if (divergente) return responderErro(divergente);

    const arquivo = await gerarXlsxDoCliente(fechamento);

    const grande = conferirTamanhoDoXlsx(arquivo.length);
    if (grande) return responderErro(grande);

    return new NextResponse(new Uint8Array(arquivo), {
      status: 200,
      headers: cabecalhosDeDownload(
        nomeDoArquivo(fechamento.meta, "xlsx", SUFIXO_DO_ARQUIVO_DO_CLIENTE),
        TIPO_DO_XLSX,
      ),
    });
  } catch (causa) {
    const resposta = descreverErro(causa);
    if (resposta.status >= 422) {
      console.error(
        "[fechamento-xlsx-cliente]",
        resposta.corpo.erro.codigo,
        causa instanceof Error ? `${causa.name}: ${causa.message}` : String(causa),
      );
    }
    return responderErro(resposta);
  }
}
