/**
 * GATE-FIN-05 (sessão 22) — forma da migration 054 (expandir), sem banco.
 *
 * COMO RODAR:
 *
 *   npm run test:migration-054
 *
 * O comportamento (versão, contratos v2, confirmação de virada, legado, fatura) está na suíte SQL
 * `supabase/tests/054_versao_e_virada.sql` e na concorrência real
 * `scripts/testar-concorrencia-apontamento-local.py`. Esta suíte prova o que a leitura do arquivo
 * garante e que nenhum mecanismo proibido entrou:
 *
 *   A. envelope begin/commit e o contrato do executor remoto (como a 053);
 *   B. o operador ganha só um grant por coluna — SELECT(versao) — e nenhum de tabela; a troca de
 *      dono usa CREATE temporário revogado logo depois (o procedimento da 013);
 *   C. nenhuma isenção silenciosa: sem `current_user`, `session_user`, `current_setting`,
 *      `service_role` liberando caminho, nem bypass de versão por papel;
 *   D. expandir, não contrair: nada de 058 (DELETE revogado, versão obrigatória no legado, limite de
 *      jornada) e as RPCs antigas não são redefinidas nem removidas.
 */

import { readFileSync, readdirSync } from "node:fs";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const PASTA = new URL("../supabase/migrations/", import.meta.url);
const nome = readdirSync(PASTA).find((n) => /^\d{14}_054_/.test(n)) ?? null;
const bruto = nome ? readFileSync(new URL(nome, PASTA), "utf8") : "";
// Sem comentários: só o que executa.
const sql = bruto.replace(/--.*$/gm, "").toLowerCase();

console.log("\nA. Arquivo e envelope\n");

verificar(
  "A1. a migration 054 existe e vem depois da 053",
  nome?.slice(0, 14) > "20261120120000",
  true,
);
const comandos = sql
  .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, "$corpo$")
  .split(";")
  .map((c) => c.replace(/\s+/g, " ").trim())
  .filter(Boolean);
verificar(
  "A2. begin é o primeiro comando e commit o último",
  [comandos[0], comandos.at(-1)],
  ["begin", "commit"],
);
verificar(
  "A3. termina no próprio commit (contrato de aplicar-migration-api.py)",
  bruto.trimEnd().toLowerCase().endsWith("commit;"),
  true,
);
verificar(
  "A4. uma única transação no nível de cima",
  comandos.filter((c) => /^(begin|commit|rollback|end|savepoint|start transaction)\b/.test(c)),
  ["begin", "commit"],
);
verificar("A5. tem autoverificação de catálogo", /do \$verificacao\$/.test(sql), true);

console.log("\nB. Permissões e dono\n");

const grantsOperador = [...sql.matchAll(/grant\s+([^;]*?)\s+to\s+bslog_rpc_operacional\b/g)].map(
  (m) => m[1].replace(/\s+/g, " ").trim(),
);
verificar(
  "B1. ao operador: SELECT(versao) na tabela e EXECUTE só nos auxiliares que a v1 já usa; CREATE temporário",
  grantsOperador.filter((g) => !/^execute on function/.test(g)),
  ["select (versao) on table public.timesheet_entries", "create on schema public"],
);
verificar(
  "B2. o único grant de tabela inteira é SELECT da trilha nova para authenticated (a RLS a restringe ao admin)",
  [
    ...sql.matchAll(
      /grant\s+(all|select|insert|update|delete|truncate)(\s*,\s*\w+)*\s+on\s+(table\s+)?public\.[a-z_]+\s+to\s+[a-z_]+/g,
    ),
  ].map((m) => m[0].replace(/\s+/g, " ")),
  ["grant select on table public.apontamento_confirmacoes_virada to authenticated"],
);
verificar(
  "B3. o CREATE no schema é revogado logo depois da troca de dono",
  /grant create on schema public to bslog_rpc_operacional;[\s\S]*?alter function public\.salvar_apontamento_operacional_v2[\s\S]*?alter function public\.listar_apontamentos_do_operador_v2[\s\S]*?revoke create on schema public from bslog_rpc_operacional;/.test(
    sql,
  ),
  true,
);
verificar(
  "B4. nenhum privilégio novo para anon nem service_role",
  [...sql.matchAll(/grant[^;]*\bto\s+(anon|service_role)\b/g)].length,
  0,
);

console.log("\nC. Nenhuma isenção silenciosa\n");

verificar(
  "C1. nenhum desvio por identidade de sessão ou variável: current_user, session_user, current_setting",
  [...sql.matchAll(/\b(current_user|session_user|current_setting)\b/g)].map((m) => m[1]),
  [],
);
const corpos = [...sql.matchAll(/create or replace function[\s\S]*?\bas \$\$([\s\S]*?)\$\$/g)].map(
  (m) => m[1],
);
verificar("C2. as funções novas existem e são lidas pelo analisador (controle)", corpos.length, 9);
verificar(
  "C3. nenhum corpo de função menciona service_role, anon ou papel por nome (nenhuma exceção por papel)",
  corpos.filter((c) => /\b(service_role|anon|bslog_rpc_operacional|postgres)\b/.test(c)).length,
  0,
);

console.log("\nD. Expandir, não contrair\n");

verificar(
  "D1. as RPCs antigas não são redefinidas nem removidas",
  [
    ...sql.matchAll(
      /(create (or replace )?function|drop function( if exists)?)\s+public\.(salvar_apontamento_admin|salvar_apontamento_operacional|listar_apontamentos_do_operador)\s*\(/g,
    ),
  ].length,
  0,
);
verificar(
  "D2. sem itens da 058: DELETE do admin segue, nada revogado de authenticated em timesheet_entries",
  /revoke[^;]*on\s+(table\s+)?public\.timesheet_entries[^;]*from[^;]*authenticated/.test(sql),
  false,
);
verificar(
  "D3. sem limite comercial de jornada (nenhuma constante de horas na regra)",
  /(720|960|1440)\s*(minutos|min)|jornada_maxima|limite_jornada/.test(sql),
  false,
);
verificar(
  "D4. nenhuma escrita retroativa em apontamento ou fatura (a coluna nova nasce com default)",
  /\b(update|delete from)\s+public\.(timesheet_entries|invoices|invoice_items)\b/.test(
    sql.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, ""),
  ),
  false,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
