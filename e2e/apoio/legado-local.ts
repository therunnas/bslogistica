import { execFileSync } from "node:child_process";

import type { SupabaseClient } from "@supabase/supabase-js";

import { URL_SUPABASE_LOCAL } from "../guarda/regras.mjs";

/**
 * EXCEÇÃO DE TESTE DOCUMENTADA (GATE-FIN-02, migration 052).
 *
 * Desde a 052 a RPC legada `registrar_servico_container` não é executável por `authenticated`: o
 * cadastro de contêiner por esse caminho está encerrado também no banco (AUT-CP06-01). As specs 90,
 * 95 e 97 precisam de REGISTROS ANTIGOS como fixture — o histórico que Operações consulta, corrige e
 * cancela, e que alimenta os cenários de cobrança em dobro (DEC-CP06-04) e de competência (CP-08).
 * Eles representam dado histórico, não uma ação da tela.
 *
 * Este é o ÚNICO ponto do E2E que grava no banco fora da interface. Limites:
 *   - só roda contra o container Docker local do E2E (`supabase_db_bs-e2e-…`, o mesmo de
 *     `psqlSomenteLeitura`), e só com a API local em loopback;
 *   - executa UM comando fixo: a própria RPC, como a dona da função (`postgres`), com as claims do
 *     JWT real do admin injetadas — a função continua conferindo papel, piso de MFA, payload e
 *     idempotência, e a trilha registra o admin como autor;
 *   - os parâmetros entram como variáveis do psql (`:'var'`, citadas pelo próprio psql), nunca
 *     concatenados no SQL; não aceita SQL arbitrário nem conexão de rede;
 *   - não existe nada parecido no aplicativo: nenhuma rota, Server Action ou função de teste.
 *
 * Mesmo formato de retorno de `api.rpc(...)`, para a troca nas specs ser de uma linha.
 */

const PREFIXO_DO_CONTAINER = "supabase_db_bs-e2e-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMANDO = `begin;
select set_config('request.jwt.claims', :'claims', true);
select public.registrar_servico_container(:'dados'::jsonb, :'chave'::uuid, :'motivo')::text;
commit;
`;

export interface ParametrosDoRegistroAntigo {
  p_dados: unknown;
  p_idempotency_key: string;
  p_reason: string;
}

function containerLocal(): string {
  const container = process.env["E2E_DB_CONTAINER"] ?? "";
  if (!container.startsWith(PREFIXO_DO_CONTAINER)) {
    throw new Error("E2E_DB_CONTAINER ausente ou fora do projeto local bs-e2e-: escrita recusada.");
  }
  if (process.env["NEXT_PUBLIC_SUPABASE_URL"] !== URL_SUPABASE_LOCAL) {
    throw new Error("A API do Supabase não é a local em loopback: escrita recusada.");
  }
  const rodando = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", container], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (rodando !== "true") throw new Error(`O container local ${container} não está rodando.`);
  return container;
}

function claimsDoAdmin(token: string): string {
  const parte = token.split(".")[1];
  if (!parte) throw new Error("JWT do admin inválido.");
  const claims = JSON.parse(Buffer.from(parte, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  if (claims["role"] !== "authenticated" || typeof claims["sub"] !== "string") {
    throw new Error("O JWT não é de uma conta autenticada.");
  }
  return JSON.stringify(claims);
}

/** Cria um registro ANTIGO de contêiner no banco local, como fixture histórica (ver acima). */
export async function registrarRegistroAntigoLocal(
  api: SupabaseClient,
  p: ParametrosDoRegistroAntigo,
): Promise<{ data: string | null; error: Error | null }> {
  if (!UUID.test(p.p_idempotency_key)) throw new Error("Chave de idempotência inválida.");
  const token = (await api.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Sessão do admin ausente.");
  const container = containerLocal();
  try {
    const saida = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `claims=${claimsDoAdmin(token)}`,
        "-v",
        `dados=${JSON.stringify(p.p_dados)}`,
        "-v",
        `chave=${p.p_idempotency_key}`,
        "-v",
        `motivo=${p.p_reason}`,
        "-f",
        "-",
      ],
      { input: COMANDO, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const id = saida
      .split("\n")
      .map((l) => l.trim())
      .find((l) => UUID.test(l));
    if (!id) return { data: null, error: new Error(`Registro antigo não criado: ${saida}`) };
    return { data: id, error: null };
  } catch (causa) {
    const detalhe =
      causa instanceof Error && "stderr" in causa
        ? String((causa as { stderr: unknown }).stderr)
        : "";
    return {
      data: null,
      error: new Error(`Registro antigo recusado: ${detalhe || String(causa)}`),
    };
  }
}
