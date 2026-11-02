import { NextResponse } from "next/server";
import { lerAcesso } from "@/app/(painel)/_autorizacao";
import { ehAdmin } from "@/app/(painel)/_papel";
import { interpretarMunicipios, UFS } from "@/lib/calendario-territorial";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Proxy de leitura, sem persistência. Só consulta a origem fixa oficial do IBGE. */
export async function GET(request: Request) {
  const acesso = await lerAcesso();
  if (acesso.situacao === "sem-sessao")
    return NextResponse.json({ erro: "Sessão necessária." }, { status: 401, headers });
  if (acesso.situacao !== "liberado" || !ehAdmin(acesso.papeis))
    return NextResponse.json(
      { erro: "Acesso administrativo necessário." },
      { status: 403, headers },
    );
  const uf = new URL(request.url).searchParams.get("uf") ?? "";
  if (!UFS.includes(uf as (typeof UFS)[number]))
    return NextResponse.json({ erro: "UF inválida." }, { status: 400, headers });
  try {
    const resposta = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
      { signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error" },
    );
    if (!resposta.ok) throw new Error("IBGE indisponível");
    return NextResponse.json(interpretarMunicipios(await resposta.json(), uf), { headers });
  } catch {
    return NextResponse.json(
      {
        erro: "Não foi possível consultar o IBGE. Tente novamente; não é permitido cadastrar localidade por texto livre.",
      },
      { status: 502, headers },
    );
  }
}
