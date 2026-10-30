import { NextResponse } from "next/server";

import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { ehAdmin } from "@/app/(painel)/_papel";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { carregarFechamento, dependenciasComSupabase } from "@/lib/fechamento/carregar";
import { verificarDisponibilidade } from "@/lib/fechamento/disponibilidade";
import {
  decidirAcesso,
  negarSeIndisponivel,
  descreverErro,
  extrairFiltros,
} from "@/lib/fechamento/http";
import type { RespostaDeErro } from "@/lib/fechamento/http";

/**
 * GET /api/fechamento?cliente=<uuid>&inicio=AAAA-MM-DD&fim=AAAA-MM-DD
 *
 * Devolve o `FechamentoData` de UM cliente em UM período. Este arquivo só
 * encadeia: acesso → filtros → `carregarFechamento` → resposta. Não há regra
 * financeira aqui, e nenhum valor financeiro entra pela URL: a única entrada é
 * cliente e período.
 *
 * **Este endpoint se protege sozinho.** O layout do painel e o `exigirAdmin()`
 * da futura página governam o que a interface mostra; uma rota de API é
 * alcançável sem passar por nenhum dos dois. A decisão de acesso é a de sempre,
 * `lerAcesso()` — sem sessão, 401; sem papel `admin` ou com o segundo fator pendente, 403
 * (`lerAcesso()` só devolve "liberado" depois do TOTP, quando a conta tem fator). A RLS é a segunda barreira: a
 * leitura usa o cliente da sessão, nunca `service_role`.
 *
 * Sempre `no-store`: o fechamento precisa refletir apontamento, fechamento de
 * folha e fatura gerada no instante seguinte.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "Cache-Control": "no-store" } as const;

function responderErro({ status, corpo }: RespostaDeErro) {
  return NextResponse.json(corpo, { status, headers: SEM_CACHE });
}

export async function GET(request: Request) {
  const acesso = await lerAcesso();
  const negado = decidirAcesso(
    acesso.situacao,
    acesso.situacao === "liberado" && ehAdmin(acesso.papeis),
  );
  if (negado) return responderErro(negado);

  try {
    const supabase = await criarClienteServidor();
    // Antes de qualquer leitura: sem a 030 e o motor novo ligados, as funções do Fechamento
    // podem nem existir. Nega com 503 controlado; "não sei" também nega.
    const indisponivel = negarSeIndisponivel(await verificarDisponibilidade(supabase));
    if (indisponivel) return responderErro(indisponivel);

    const filtros = extrairFiltros(new URL(request.url).searchParams);
    const fechamento = await carregarFechamento(filtros, dependenciasComSupabase(supabase));

    return NextResponse.json(fechamento, { headers: SEM_CACHE });
  } catch (causa) {
    const resposta = descreverErro(causa);
    // O detalhe fica no log do servidor; a resposta só leva o código estável.
    if (resposta.status >= 422) {
      console.error(
        "[fechamento]",
        resposta.corpo.erro.codigo,
        causa instanceof Error ? `${causa.name}: ${causa.message}` : String(causa),
      );
    }
    return responderErro(resposta);
  }
}
