/**
 * Condições financeiras versionadas — expansão do esquema: forma da migration 022 (C05-B).
 *
 * COMO RODAR:
 *
 *   npm run test:condicoes-expansao
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha. Não
 * usa rede nem banco.
 *
 * O QUE ESTA SUÍTE PROVA: a forma literal da migration. A 022 é só EXPANSÃO: cria
 * tabelas e colunas novas, não escreve dado, não derruba nada que existe, não toca a
 * função de derivação financeira e não concede escrita a ninguém. Também prova que a
 * suíte SQL existe, é transacional e falha de verdade, e que o CI a executa.
 *
 * O QUE ELA NÃO PROVA: o comportamento. Que as vigências não se sobrepõem, que a RLS
 * barra quem não é admin em AAL2 e que o resultado financeiro não mudou é da suíte SQL
 * `017_condicoes_financeiras_expansao.sql`, que roda contra PostgreSQL.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${esperado}, obtido ${obtido}`);
    console.log(`  FAIL  ${caso} — esperado ${esperado}, obtido ${obtido}`);
  }
}

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

const NOME = "20261020150000_022_condicoes_financeiras_expansao.sql";
const arquivos = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();

// ---------------------------------------------------------------------------
// A. Identidade da migration
// ---------------------------------------------------------------------------

console.log("A. Identidade da migration");

verificar("A1. a migration existe", arquivos.includes(NOME), true);
verificar(
  "A2. o número 022 aparece uma vez só",
  arquivos.filter((a) => a.includes("_022_")).length,
  1,
);
verificar(
  "A3. o timestamp é posterior ao de todas as outras migrations",
  arquivos.filter((a) => a !== NOME).every((a) => a.split("_")[0] < NOME.split("_")[0]),
  true,
);
verificar(
  "A4. a migration 019 (Fechamento) não foi trazida para este conjunto",
  arquivos.some((a) => a.includes("_019_")),
  false,
);
verificar(
  "A5. não existem as migrations 023 e 024 (RPCs e derivação são etapas seguintes)",
  arquivos.some((a) => a.includes("_023_") || a.includes("_024_")),
  false,
);

const migration = ler(`supabase/migrations/${NOME}`);
// Só o SQL executável: sem comentários de linha, sem literais e sem o corpo `$...$`.
const semComentarios = migration.replace(/^\s*--.*$/gm, "");
const codigo = semComentarios.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();

// ---------------------------------------------------------------------------
// B. É só expansão
// ---------------------------------------------------------------------------

console.log("B. Só expansão: nada existente é removido nem reescrito");

verificar(
  "B1. nenhum comando escreve dado (insert, update, delete, truncate)",
  /(?<!on )(?<!of )\b(insert into|update\s+\w|delete from|truncate)\b/.test(
    codigo
      // o corpo da autoverificação e do guard lê e compara; não grava
      .replace(/create or replace function[\s\S]*?\$\w*\$;/g, ""),
  ),
  false,
);
verificar(
  "B2. nada é derrubado (drop table, column, constraint, policy, trigger, function)",
  /\bdrop\s+(table|column|constraint|policy|trigger|function|index|extension)\b/.test(codigo),
  false,
);
verificar(
  "B3. nenhuma coluna existente é alterada ou renomeada",
  /alter column|rename (column|to)|alter type/.test(codigo),
  false,
);
verificar(
  "B4. a função de derivação financeira não é recriada nem citada",
  /derivar_valores_financeiros|calcular_valores_financeiros/.test(codigo),
  false,
);
verificar(
  "B5. os triggers financeiros existentes não são desabilitados",
  /disable trigger|disable row level/.test(codigo),
  false,
);
verificar(
  "B6. contracts e employees não são tocados (as taxas atuais continuam onde estão)",
  /(alter table|update|from|into)\s+public\.(contracts|employees)\b/.test(
    codigo.replace(/references public\.(contracts|employees)/g, ""),
  ),
  false,
);
verificar(
  "B7. nenhuma função SECURITY DEFINER é criada (sem RPC nesta etapa)",
  /security definer/.test(codigo),
  false,
);

// ---------------------------------------------------------------------------
// C. Tabelas, vigência e colunas
// ---------------------------------------------------------------------------

console.log("C. Tabelas, vigências e colunas novas");

verificar(
  "C1. cria public.contract_terms",
  /create table public\.contract_terms\b/.test(codigo),
  true,
);
verificar(
  "C2. cria public.employee_cost_terms",
  /create table public\.employee_cost_terms\b/.test(codigo),
  true,
);
verificar("C3. usa btree_gist para a exclusão", /btree_gist/.test(codigo), true);
verificar(
  "C4. contract_terms exclui sobreposição por contrato, só entre versões ativas",
  /exclude using gist[^;]*contract_id with =[^;]*with &&[^;]*where \(active\)/.test(
    semComentarios.toLowerCase().replace(/\s+/g, " "),
  ),
  true,
);
verificar(
  "C5. employee_cost_terms exclui sobreposição por colaborador, só entre ativas",
  /exclude using gist[^;]*employee_id with =[^;]*with &&[^;]*where \(active\)/.test(
    semComentarios.toLowerCase().replace(/\s+/g, " "),
  ),
  true,
);
verificar(
  "C6. o fim da vigência é exclusivo (intervalo semiaberto)",
  (semComentarios.match(/'\[\)'/g) ?? []).length >= 2,
  true,
);
verificar(
  "C7. a versão nunca nasce sem motivo (reason não vazio)",
  (codigo.match(/reason\s+text\s+not null/g) ?? []).length === 2 &&
    /btrim\(reason\) <> ''/.test(codigo.replace(/\s+/g, " ")),
  true,
);
verificar(
  "C8. a origem é um conjunto fechado (informada, migrada_por_prova, correcao)",
  /origin in \('', '', ''\)/.test(codigo.replace(/\s+/g, " ")) &&
    ["informada", "migrada_por_prova", "correcao"].every((o) => semComentarios.includes(`'${o}'`)),
  true,
);
verificar(
  "C9. dinheiro e fatores em numeric, nunca float",
  !/\b(float|double precision|real)\b/.test(codigo),
  true,
);
verificar(
  "C10. as 7 colunas novas do apontamento existem",
  [
    "contract_terms_id",
    "employee_cost_terms_id",
    "shift_hours_snapshot",
    "ot_factor_snapshot",
    "ot_tolerance_snapshot",
    "planned_minutes_snapshot",
    "terms_origin",
  ].every((c) => new RegExp(`add column ${c}\\b`).test(codigo)),
  true,
);
verificar(
  "C11. as colunas novas nascem anuláveis e sem DEFAULT (legado fica NULL)",
  !/add column[^,;]*(not null|default)/.test(codigo),
  true,
);
verificar(
  "C12. as referências do apontamento às versões não têm cascata (NO ACTION)",
  !/references public\.(contract_terms|employee_cost_terms) \(id\)\s+on delete/.test(
    codigo.replace(/\s+/g, " "),
  ),
  true,
);
verificar(
  "C13. a origem do apontamento aceita só versao, valor_acordado, legado",
  /terms_origin in \('', '', ''\)/.test(codigo.replace(/\s+/g, " ")) &&
    ["versao", "valor_acordado", "legado"].every((o) => semComentarios.includes(`'${o}'`)),
  true,
);

// ---------------------------------------------------------------------------
// D. Segurança
// ---------------------------------------------------------------------------

console.log("D. RLS, privilégios e guard das colunas");

verificar(
  "D1. RLS ativa nas duas tabelas",
  /alter table public\.contract_terms enable row level security/.test(codigo) &&
    /alter table public\.employee_cost_terms enable row level security/.test(codigo),
  true,
);
verificar(
  "D2. nenhuma policy de escrita (insert, update, delete)",
  /create policy[^;]*for (insert|update|delete)\b/.test(codigo.replace(/\s+/g, " ")),
  false,
);
verificar(
  "D3. existe policy RESTRICTIVE exigindo aal2 e admin em cada tabela",
  (codigo.match(/as restrictive/g) ?? []).length === 2 &&
    /aal2/.test(semComentarios) &&
    /has_role/.test(semComentarios),
  true,
);
verificar(
  "D4. a única concessão é SELECT para authenticated",
  (codigo.match(/\bgrant\b[^;]*;/g) ?? [])
    .filter((g) => !/execute on function/.test(g))
    .every((g) =>
      /^grant select on table public\.(contract_terms|employee_cost_terms) to authenticated;$/.test(
        g.replace(/\s+/g, " "),
      ),
    ),
  true,
);
verificar(
  "D5. nada é concedido a anon, service_role ou ao papel das RPCs operacionais",
  /\bgrant\b[^;]*\bto\b[^;]*(anon|service_role|bslog_rpc_operacional|public)\b/.test(codigo),
  false,
);
verificar(
  "D6. revoga tudo das tabelas novas antes de conceder",
  (codigo.match(/revoke all on table public\.(contract_terms|employee_cost_terms)/g) ?? [])
    .length === 2,
  true,
);
verificar(
  "D7. o guard das colunas novas é SECURITY INVOKER e levanta 42501",
  /bloquear_colunas_de_condicoes/.test(codigo) && /42501/.test(semComentarios),
  true,
);
verificar(
  "D8. o trigger do guard cria-se BEFORE INSERT OR UPDATE em timesheet_entries",
  /create trigger trg_timesheet_entries_bloqueia_condicoes\s+before insert or update on public\.timesheet_entries/.test(
    codigo,
  ),
  true,
);
verificar(
  "D9. o nome do trigger ordena antes dos triggers financeiros existentes (disparo alfabético)",
  "trg_timesheet_entries_bloqueia_condicoes" < "trg_timesheet_entries_bloqueio_financeiro" &&
    "trg_timesheet_entries_bloqueia_condicoes" < "trg_timesheet_entries_calculo_financeiro",
  true,
);
verificar(
  "D10. a autoverificação final existe e falha com exception",
  /do \$verificacao\$/.test(semComentarios) && /raise exception/.test(semComentarios),
  true,
);
verificar(
  "D11. a migration documenta o script de reversão (em comentário, não executável)",
  /^--\s+drop table public\.contract_terms;/m.test(migration) &&
    /^--\s+drop function public\.bloquear_colunas_de_condicoes\(\);/m.test(migration),
  true,
);

// ---------------------------------------------------------------------------
// E. A suíte SQL e o CI
// ---------------------------------------------------------------------------

console.log("E. Suíte SQL, scripts e CI");

const CAMINHO_SQL = "supabase/tests/017_condicoes_financeiras_expansao.sql";
verificar(
  "E1. a suíte SQL existe",
  existsSync(new URL(`../${CAMINHO_SQL}`, import.meta.url)),
  true,
);
const sql = ler(CAMINHO_SQL);
for (const rotulo of [
  "S1.",
  "S3.",
  "S5.",
  "S6.",
  "S7.",
  "V2.",
  "V3.",
  "V5.",
  "V7.",
  "V8.",
  "V14.",
  "V15.",
  "R1.",
  "R2.",
  "R3a.",
  "R4.",
  "R5a.",
  "R5b.",
  "R5c.",
  "R6.",
  "R7.",
  "E1.",
  "E3.",
  "E6.",
  "F1b.",
  "F3.",
  "F4c.",
  "F5.",
]) {
  verificar(`E2. a suíte SQL cobre o caso ${rotulo}`, sql.includes(`registrar('${rotulo}`), true);
}
verificar(
  "E3. a suíte SQL é transacional e termina em rollback",
  /^begin;/m.test(sql) && /rollback;\s*$/.test(sql),
  true,
);
verificar(
  "E4. a suíte SQL nunca confirma nada",
  /(?<!on )\bcommit\b/i.test(sql.replace(/^\s*--.*$/gm, "")),
  false,
);
verificar(
  "E5. a suíte SQL falha de verdade quando um caso falha",
  /raise exception '017_condicoes_financeiras_expansao/.test(sql),
  true,
);

const pacote = JSON.parse(ler("package.json"));
verificar(
  "E6. o script test:condicoes-expansao existe",
  typeof pacote.scripts["test:condicoes-expansao"],
  "string",
);
verificar(
  "E7. as suítes anteriores continuam disponíveis",
  Object.keys(pacote.scripts).filter((n) => n.startsWith("test:")).length >= 20,
  true,
);
const ci = ler(".github/workflows/ci.yml");
verificar("E8. o CI executa a suíte nova", /npm run test:condicoes-expansao/.test(ci), true);
verificar(
  "E9. o CI conserva todas as suítes de package.json",
  Object.keys(pacote.scripts)
    .filter((n) => n.startsWith("test:"))
    .every((n) => ci.includes(`npm run ${n}`)),
  true,
);
verificar(
  "E10. o CI continua sem secrets e com permissões de leitura",
  /permissions:\s*\n\s*contents: read/.test(ci) && !/secrets\./.test(ci),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
