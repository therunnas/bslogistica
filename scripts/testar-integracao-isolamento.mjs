/**
 * Integração do núcleo V2 ao motor — FORMA E FRONTEIRAS (FIN-PR-02).
 *
 * COMO RODAR:  npm run test:integracao-isolamento
 *
 * Sem rede e sem banco. Prova, pelo texto das migrations e do código, que a 036 faz só o que o
 * desenho diz e que o resto ficou como estava. O ensaio com banco (catálogo e dados antes/depois,
 * reversão) é `scripts/comparar-catalogo-integracao.sh`; o comportamento, `test:integracao-v2` e a
 * suíte SQL 036.
 *
 *   M  a 036: posição, comandos permitidos, funções recriadas, colunas e constraints
 *   L  o cálculo de domingo/feriado na 036 é o bloco da 030, sem uma letra a mais
 *   G  a guarda e o estado do motor são os corpos vigentes com só os acréscimos previstos
 *   R  o runbook de reversão recria os corpos VIGENTES (030 e 032) e não toca na 035
 *   S  o teste SQL gerado não derivou; a fixture da 030 está completa
 *   C  telas e CI
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import { CAMINHO_DO_TESTE, sqlDoTeste } from "./gerar-sql-integracao-v2.mjs";
import { corpoDaFuncao } from "./gerar-sql-nucleo-financeiro.mjs";
import { gradeDeIntegracao } from "./_integracao-grade.mjs";

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

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const md5 = (t) => createHash("md5").update(t, "utf8").digest("hex");
const NOME = "20261103120000_036_integracao_nucleo_v2.sql";
const sql = ler(`supabase/migrations/${NOME}`);
const m030 = ler("supabase/migrations/20261028120000_030_regras_definitivas_bs.sql");
const m032 = ler("supabase/migrations/20261030120000_032_mfa_opcional.sql");
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();

// ---------------------------------------------------------------------------
console.log("M. A migration 036");
verificar(
  "M1. número 036 uma só vez, timestamp > 035 (20261102120000) e < 037 (20261104120000); a 019 continua fora",
  [
    NOME.slice(0, 14) < "20261104120000",
    migrations.filter((f) => /_036_/.test(f)).length,
    NOME.slice(0, 14) > "20261102120000",
    migrations.some((f) => /_019_/.test(f)),
  ],
  [true, 1, true, false],
);

const semComentarios = sql.replace(/--[^\n]*/g, "");
const semCorpos = semComentarios.replace(/\$(function)?\$[\s\S]*?\$(function)?\$/gi, "$corpo$");
const comandos = semCorpos
  .split(";")
  .map((c) => c.trim().replace(/\s+/g, " ").toLowerCase())
  .filter((c) => c !== "");
const tipos = [
  ...new Set(
    comandos.map((c) =>
      c
        .split(" ")
        .slice(0, 3)
        .join(" ")
        .replace(/ public\..*$/, ""),
    ),
  ),
].sort();
verificar("M2. só begin, alter table, create or replace function, comment on e commit", tipos, [
  "alter table",
  "begin",
  "comment on column",
  "comment on function",
  "commit",
  "create or replace",
]);
verificar(
  "M3. nenhum drop, grant, revoke, policy, trigger, insert, update ou delete",
  /\b(drop|grant|revoke|policy|create\s+trigger|insert\s+into|update\s+public|delete\s+from|truncate)\b/i.test(
    semCorpos,
  ),
  false,
);
const recriadas = [...sql.matchAll(/create or replace function public\.(\w+)\(/gi)]
  .map((m) => m[1])
  .sort();
verificar(
  "M4. recria exatamente derivar_valores_por_vigencia, bloquear_colunas_de_condicoes e estado_motor_vigencia",
  recriadas,
  ["bloquear_colunas_de_condicoes", "derivar_valores_por_vigencia", "estado_motor_vigencia"],
);
verificar(
  "M5. o ALTER TABLE é só em timesheet_entries: 5 colunas e 3 constraints",
  [
    (semCorpos.match(/alter table public\.(\w+)/gi) ?? []).map((t) => t.toLowerCase()),
    (semCorpos.match(/add column/gi) ?? []).length,
    (semCorpos.match(/add constraint/gi) ?? []).length,
  ],
  [["alter table public.timesheet_entries"], 5, 3],
);
verificar(
  "M6. o CHECK de componentes não aceita componente nulo na V2 (is not null explícito)",
  /calc_version = 2\s+and billed_base_amount is not null and billed_overtime_amount is not null\s+and billed_special_amount is not null/.test(
    sql,
  ),
  true,
);
const derivar = corpoDaFuncao(sql, "derivar_valores_por_vigencia");
verificar(
  "M7. a derivação chama nucleo_componentes_v2 uma vez, com especial 200 inerte, adicional 0 e 'minutos'",
  [
    (derivar.match(/nucleo_componentes_v2\(/g) ?? []).length,
    /\n\s+200,\n/.test(derivar),
    /'minutos',\n\s+0,\n/.test(derivar),
  ],
  [1, true, true],
);
verificar(
  "M8. a escolha do cálculo: feriado OU domingo (isodow 7) seguem a 030",
  /_legado030 := _dia = 'feriado' or extract\(isodow from _work_date\) = 7;/.test(derivar),
  true,
);
verificar(
  "M9. não referencia autenticação, sessão nem MFA (o guard continua sendo o da 030/032/034)",
  /auth\.|mfa_|aal|has_role|condicoes_exigir/.test(derivar),
  false,
);

// ---------------------------------------------------------------------------
console.log("\nL. Domingo e feriado: o bloco da 030, intacto");
const derivar030 = corpoDaFuncao(m030, "derivar_valores_por_vigencia");
const ini = "  -- CUSTO (029): excedente à jornada, após tolerância, em minutos exatos.";
const fim = "  new.worked_minutes          := _worked::integer;";
const bloco030 = derivar030.slice(derivar030.indexOf(ini), derivar030.indexOf(fim)).trimEnd();
const no036 = bloco030
  .split("\n")
  .map((l) => (l.trim() ? "  " + l : l))
  .join("\n");
verificar(
  "L1. o cálculo da 030 (custo, cobrança, feriado) está no ramo legado da 036, byte a byte",
  derivar.includes(no036),
  true,
);
verificar(
  "L2. o bloco antigo tem o arredondamento antigo e o fator de feriado no custo",
  [/arredondar_minutos_extras/.test(no036), /_fator_feriado/.test(no036)],
  [true, true],
);
const restante036 = derivar.replace(no036, "");
verificar(
  "L3. fora do ramo legado, a derivação não usa mais o arredondamento antigo",
  /arredondar_minutos_extras/.test(restante036),
  false,
);

// ---------------------------------------------------------------------------
console.log("\nG. Guarda e estado do motor: corpos vigentes + só os acréscimos");
const guarda030 = corpoDaFuncao(m030, "bloquear_colunas_de_condicoes");
const guarda036 = corpoDaFuncao(sql, "bloquear_colunas_de_condicoes");
const tirarNovas = (t) =>
  t
    .split("\n")
    .filter(
      (l) =>
        !/billed_base_amount|billed_overtime_amount|billed_special_amount|additional_amount|calc_version/.test(
          l,
        ),
    )
    .join("\n")
    .replace(/or new\.day_kind_snapshot is not null\n/, "or new.day_kind_snapshot is not null;\n")
    .replace(
      /or new\.day_kind_snapshot is distinct from old\.day_kind_snapshot\n/,
      "or new.day_kind_snapshot is distinct from old.day_kind_snapshot;\n",
    );
verificar(
  "G1. a guarda é a da 030 mais as 5 colunas novas (INSERT e UPDATE)",
  [
    tirarNovas(guarda036) === guarda030,
    guarda036.split("\n").filter((l) => /calc_version/.test(l)).length,
  ],
  [true, 2],
);
const estado032 = corpoDaFuncao(m032, "estado_motor_vigencia");
const estado036 = corpoDaFuncao(sql, "estado_motor_vigencia");
verificar(
  "G2. o estado do motor é o da 032 (guard de leitura) mais a chave nucleo_v2",
  [
    estado036.includes("perform public.condicoes_exigir_admin_leitura();"),
    estado036.replace(
      ",\n    -- FIN-PR-02 (036): dia útil e sábado calculados pelo núcleo V2 (035).\n    'nucleo_v2', true);",
      ");",
    ) === estado032,
  ],
  [true, true],
);

// ---------------------------------------------------------------------------
console.log("\nR. Reversão");
const runbook = ler("docs/runbooks/rollback-integracao-nucleo-v2.sql");
verificar(
  "R1. o runbook recria os corpos vigentes: derivar e guarda da 030, estado da 032",
  [
    md5(corpoDaFuncao(runbook, "derivar_valores_por_vigencia")) === md5(derivar030),
    md5(corpoDaFuncao(runbook, "bloquear_colunas_de_condicoes")) === md5(guarda030),
    md5(corpoDaFuncao(runbook, "estado_motor_vigencia")) === md5(estado032),
  ],
  [true, true, true],
);
verificar(
  "R2. o runbook não toca na 035 nem em MFA, guards de admin, policies ou grants",
  /nucleo_(arredondar|componentes|minutos)|mfa_cotidiano_ok|condicoes_exigir_admin\(|policy|grant|revoke/i.test(
    runbook.replace(/--[^\n]*/g, "").replace(corpoDaFuncao(runbook, "estado_motor_vigencia"), ""),
  ),
  false,
);
verificar(
  "R3. recusa se houver presença calculada pela V2 e só então derruba colunas",
  [
    /calc_version is not null and status <> 'absent'/.test(runbook),
    runbook.indexOf("raise exception 'Reversão recusada") <
      runbook.indexOf("drop column calc_version"),
  ],
  [true, true],
);

// ---------------------------------------------------------------------------
console.log("\nS. Teste SQL e fixture");
verificar(
  `S1. ${CAMINHO_DO_TESTE} = saída do gerador (sem deriva)`,
  ler(CAMINHO_DO_TESTE) === sqlDoTeste(),
  true,
);
const fixture = JSON.parse(ler("scripts/fixtures/derivar-030-baseline.json"));
verificar(
  "S2. a medida da 030 cobre a grade inteira (1.056 casos, mesma numeração)",
  [fixture.casos.length, fixture.casos.every((c, i) => c.n === i + 1), gradeDeIntegracao().length],
  [1056, true, 1056],
);

// ---------------------------------------------------------------------------
console.log("\nC. Telas e CI");
const painel = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
verificar(
  "C1. a prévia do apontamento usa calcEntryComNucleo, com o anúncio e o domingo",
  [
    /calcEntryComNucleo\(\{/.test(painel),
    /nucleoV2: horas\?\.v2 === true/.test(painel),
    /domingo: domingoDaFolha/.test(painel),
  ],
  [true, true, true],
);
verificar(
  "C2. billing.ts (regra anterior) não importa o núcleo",
  /nucleo-financeiro/.test(ler("src/lib/billing.ts")),
  false,
);
const pacote = JSON.parse(ler("package.json"));
const ci = ler(".github/workflows/ci.yml");
for (const suite of ["test:integracao-v2", "test:integracao-isolamento"]) {
  verificar(
    `C3. ${suite} no package.json e na CI`,
    [Boolean(pacote.scripts[suite]), ci.includes(`npm run ${suite}`)],
    [true, true],
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
