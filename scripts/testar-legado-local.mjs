/**
 * GATE-FIN-02 (migration 052) — a fixture de registro antigo de contêiner do E2E.
 *
 * COMO RODAR:
 *
 *   npm run test:legado-local
 *
 * Desde a 052 a RPC legada `registrar_servico_container` não é executável por `authenticated`. As
 * specs 90, 95 e 97 criam o histórico por `e2e/apoio/legado-local.ts`, a única escrita do E2E fora
 * da interface. Esta suíte prova, sem Docker, que essa exceção é estreita:
 *   A. recusa container fora do projeto local, API fora do loopback e chave inválida — antes de
 *      chamar o Docker;
 *   B. executa um comando fixo (só a RPC, como a dona), com parâmetros como variáveis do psql;
 *   C. nenhuma spec chama a RPC legada como admin pela API; a única chamada pela API é a recusa do
 *      operacional;
 *   D. o aplicativo não ganhou caminho de teste.
 */

import { readFileSync, readdirSync } from "node:fs";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const a = typeof obtido === "string" ? obtido : JSON.stringify(obtido);
  const b = typeof esperado === "string" ? esperado : JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const { registrarRegistroAntigoLocal } = await import("../e2e/apoio/legado-local.ts");

const TOKEN = [
  "x",
  Buffer.from(
    JSON.stringify({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated" }),
  ).toString("base64url"),
  "y",
].join(".");
const api = { auth: { getSession: async () => ({ data: { session: { access_token: TOKEN } } }) } };
const PARAMETROS = {
  p_dados: {},
  p_idempotency_key: "5c10a0d0-0000-4000-8000-000000000001",
  p_reason: "x",
};

async function recusa(env, parametros = PARAMETROS) {
  const antes = { ...process.env };
  Object.assign(process.env, env);
  try {
    await registrarRegistroAntigoLocal(api, parametros);
    return "aceitou";
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  } finally {
    for (const k of Object.keys(env)) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
}

console.log("\nA. Guardas antes do Docker\n");

const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
verificar(
  "A1. container fora do projeto local do E2E é recusado",
  /fora do projeto local bs-e2e-/.test(
    await recusa({ ...LOCAL, E2E_DB_CONTAINER: "supabase_db_ehkduqokntemtmqzdrbd" }),
  ),
  true,
);
verificar(
  "A2. sem E2E_DB_CONTAINER é recusado",
  /fora do projeto local bs-e2e-/.test(await recusa({ ...LOCAL, E2E_DB_CONTAINER: "" })),
  true,
);
verificar(
  "A3. API fora do loopback (HML) é recusada mesmo com o container local",
  /não é a local em loopback/.test(
    await recusa({
      E2E_DB_CONTAINER: "supabase_db_bs-e2e-x",
      NEXT_PUBLIC_SUPABASE_URL: "https://qbnfcmrxmssnwkhaitgd.supabase.co",
    }),
  ),
  true,
);
verificar(
  "A4. chave de idempotência que não é UUID é recusada (nada vai ao psql como texto livre)",
  /Chave de idempotência inválida/.test(
    await recusa(
      { ...LOCAL, E2E_DB_CONTAINER: "supabase_db_bs-e2e-x" },
      { ...PARAMETROS, p_idempotency_key: "'; drop table x; --" },
    ),
  ),
  true,
);

console.log("\nB. Comando fixo\n");

const helper = ler("e2e/apoio/legado-local.ts");
const comando = /const COMANDO = `([\s\S]*?)`;/.exec(helper)?.[1] ?? "";
verificar(
  "B1. o comando é só: claims do admin + a RPC legada, numa transação",
  comando
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
  [
    "begin;",
    "select set_config('request.jwt.claims', :'claims', true);",
    "select public.registrar_servico_container(:'dados'::jsonb, :'chave'::uuid, :'motivo')::text;",
    "commit;",
  ],
);
verificar(
  "B2. os parâmetros entram como variáveis do psql, nunca no texto do SQL",
  ["claims=", "dados=", "chave=", "motivo="].every((v) => helper.includes(`\`${v}\${`)) &&
    !/COMANDO\s*\+|\$\{[^}]*\}[^`]*registrar_servico_container/.test(helper),
  true,
);
verificar(
  "B3. roda o psql dentro do container (docker exec), sem host nem porta",
  /"exec",\s*"-i",\s*container,\s*"psql"/.test(helper) && !/"-h"|"--host"|"-p"/.test(helper),
  true,
);

console.log("\nC. Specs\n");

const specs = readdirSync(new URL("../e2e/specs/", import.meta.url)).filter((n) =>
  n.endsWith(".ts"),
);
const chamadasPelaApi = specs.flatMap((n) => {
  const fonte = ler(`e2e/specs/${n}`);
  return [...fonte.matchAll(/api\.rpc\("registrar_servico_container"/g)].map((m) => {
    const antes = fonte.slice(Math.max(0, m.index - 900), m.index);
    return `${n}:${/sessaoApi\("OPER"\)/.test(antes) ? "OPER" : "outro"}`;
  });
});
verificar(
  "C1. a única chamada da RPC legada pela API é a recusa do operacional (spec 90)",
  chamadasPelaApi,
  ["90-servicos-avulsos.spec.ts:OPER"],
);
verificar(
  "C2. specs 90, 95 e 97 criam o histórico pelo helper local",
  [
    "90-servicos-avulsos.spec.ts",
    "95-fechamento-faturamento.spec.ts",
    "97-dashboard-relatorios-exportacoes.spec.ts",
  ].map((n) => (ler(`e2e/specs/${n}`).match(/registrarRegistroAntigoLocal\(api,/g) ?? []).length),
  [2, 2, 1],
);

console.log("\nD. Aplicativo\n");

const src = readdirSync(new URL("../src/", import.meta.url), { recursive: true })
  .filter((n) => /\.(ts|tsx)$/.test(n))
  .filter((n) => /legado-local|registrarRegistroAntigoLocal/.test(ler(`src/${n}`)));
verificar("D1. nada no app importa o helper de teste", src, []);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
