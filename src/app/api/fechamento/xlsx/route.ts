import { NextResponse } from "next/server";

import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { ehAdmin } from "@/app/(painel)/_papel";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { carregarFechamento, dependenciasComSupabase } from "@/lib/fechamento/carregar";
import { ErroDeFiltroDoFechamento } from "@/lib/fechamento/erros";
import { nomeDoArquivo } from "@/lib/fechamento/exportacao";
import {
  TETO_DO_CORPO_DO_XLSX_EM_BYTES,
  cabecalhosDeDownload,
  conferirAssinatura,
  conferirTamanhoDoXlsx,
  decidirAcesso,
  descreverErro,
  extrairCorpoDoXlsx,
  lerCorpoComLimite,
} from "@/lib/fechamento/http";
import type { RespostaDeErro } from "@/lib/fechamento/http";
import { TIPO_DO_XLSX, gerarXlsxDoFechamento } from "@/lib/fechamento/xlsx";

/**
 * POST /api/fechamento/xlsx
 *
 * Corpo JSON: `{ cliente, inicio, fim, assinatura }`. Devolve o XLSX do
 * fechamento de UM cliente em UM período.
 *
 * Este arquivo só encadeia: acesso → corpo → `carregarFechamento` → conferência
 * da assinatura → `gerarXlsxDoFechamento`. Não há regra financeira aqui, e
 * nenhum valor financeiro entra pelo corpo: o arquivo nasce do mesmo
 * `FechamentoData` que a tela exibe, relido do banco agora.
 *
 * **A assinatura é conferência de frescor.** A tela guarda a assinatura dos
 * dados que mostrou; se o servidor, relendo, obtém outra (um apontamento mudou,
 * uma fatura foi gerada), responde 409 e não entrega o arquivo — o usuário baixa
 * exatamente o que viu, ou é avisado de que mudou.
 *
 * Como em `GET /api/fechamento`, a rota se protege sozinha: `lerAcesso()` (sem
 * sessão 401; sem `admin` ou sem segundo fator 403) e a leitura pelo cliente da
 * SESSÃO, sob RLS — nunca `service_role`. O corpo de erro é sempre um código
 * estável e uma frase fixa: nada de stack, SQL ou token.
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

  // Leitura por pedaços, cancelada ao passar do teto: nada de acumular o corpo antes de medir.
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
    const { assinatura, ...filtros } = extrairCorpoDoXlsx(await lerCorpo(request));
    const supabase = await criarClienteServidor();
    const fechamento = await carregarFechamento(filtros, dependenciasComSupabase(supabase));

    const divergente = conferirAssinatura(assinatura, fechamento.meta.assinatura);
    if (divergente) return responderErro(divergente);

    const arquivo = await gerarXlsxDoFechamento(fechamento);

    const grande = conferirTamanhoDoXlsx(arquivo.length);
    if (grande) return responderErro(grande);

    return new NextResponse(new Uint8Array(arquivo), {
      status: 200,
      headers: cabecalhosDeDownload(nomeDoArquivo(fechamento.meta, "xlsx"), TIPO_DO_XLSX),
    });
  } catch (causa) {
    const resposta = descreverErro(causa);
    // O detalhe fica no log do servidor; a resposta só leva o código estável.
    if (resposta.status >= 422) {
      console.error(
        "[fechamento-xlsx]",
        resposta.corpo.erro.codigo,
        causa instanceof Error ? `${causa.name}: ${causa.message}` : String(causa),
      );
    }
    return responderErro(resposta);
  }
}
