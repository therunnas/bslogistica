/**
 * Núcleo financeiro puro — ISOLAMENTO E REGRESSÃO (FIN-PR-01).
 *
 * COMO RODAR:  npm run test:nucleo-isolamento
 *
 * Prova, pela forma do código, que o núcleo novo NÃO está ligado a nada nesta etapa e que a
 * migration 035 só acrescenta funções puras. Sem rede e sem banco; o lado do catálogo (funções
 * existentes com o corpo idêntico, nenhum uso por função ou gatilho) está na suíte SQL 035 e em
 * `scripts/comparar-catalogo-nucleo.sh`.
 *
 * FIN-PR-02: o núcleo foi ligado ao motor de propósito (migration 036). Os casos I1 e I2 deixaram
 * de dizer "ninguém usa" e passaram a fixar a FRONTEIRA DE USO: no TypeScript só `previa-v2.ts`
 * (a prévia da tela) importa o núcleo; no SQL só a 036 (a derivação do motor) o chama. A suíte
 * `test:integracao-isolamento` guarda o resto da ligação.
 *
 *   I  a fronteira de uso do núcleo (TypeScript e SQL)
 *   M  a migration 035 é estritamente aditiva e pura
 *   S  o teste SQL versionado é exatamente o que o gerador produz
 *   N  o núcleo TypeScript não importa nada e não faz conta de dinheiro em ponto flutuante
 *   C  as suítes novas estão no package.json e na CI
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAMINHO_DO_SQL,
  MIGRATION_DO_NUCLEO,
  gerarSqlDoNucleo,
} from "./gerar-sql-nucleo-financeiro.mjs";

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

const raiz = fileURLToPath(new URL("../", import.meta.url));
const fonte = (caminho) => readFileSync(join(raiz, caminho), "utf8");

function arquivosDe(diretorio, extensoes) {
  const saida = [];
  for (const nome of readdirSync(join(raiz, diretorio))) {
    const relativo = join(diretorio, nome);
    if (statSync(join(raiz, relativo)).isDirectory())
      saida.push(...arquivosDe(relativo, extensoes));
    else if (extensoes.some((e) => nome.endsWith(e))) saida.push(relativo);
  }
  return saida;
}

// ---------------------------------------------------------------------------
console.log("I. Ninguém usa o núcleo nesta etapa");
const usosTs = arquivosDe("src", [".ts", ".tsx"]).filter(
  (f) => f !== join("src", "lib", "nucleo-financeiro.ts") && /nucleo-financeiro/.test(fonte(f)),
);
verificar("I1. só a prévia (previa-v2.ts) importa nucleo-financeiro em src/", usosTs, [
  join("src", "lib", "previa-v2.ts"),
]);
const migrations = readdirSync(join(raiz, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const outrasComNucleo = migrations.filter(
  (f) => f !== MIGRATION_DO_NUCLEO && /nucleo_/.test(fonte(`supabase/migrations/${f}`)),
);
verificar(
  "I2. só a 036 (integração ao motor) menciona nucleo_* além da 035 — a 038, a 039 e a 040, só a chave anunciada",
  outrasComNucleo,
  [
    "20261103120000_036_integracao_nucleo_v2.sql",
    "20261105120000_038_periodo_contratual.sql",
    "20261106120000_039_funcoes_e_periodo_do_turno.sql",
    "20261107120000_040_snapshots_funcao_periodo.sql",
    // A 041 redefine o motor por vigência (que chama o núcleo) só para acrescentar a tarifa por função.
    "20261108120000_041_tarifas_por_funcao_e_periodo.sql",
    // A 042 redefine o motor por vigência (que chama o núcleo) para a diária individual e o adicional diário.
    "20261109120000_042_diaria_individual_e_bonus.sql",
  ],
);
verificar(
  "I2b. a 038, a 039 e a 040 só citam nucleo_ na chave 'nucleo_v2' de estado_motor_vigencia (nenhuma função do núcleo)",
  [
    "20261105120000_038_periodo_contratual.sql",
    "20261106120000_039_funcoes_e_periodo_do_turno.sql",
    "20261107120000_040_snapshots_funcao_periodo.sql",
  ].map((f) =>
    [...fonte(`supabase/migrations/${f}`).matchAll(/nucleo_[a-z0-9_]*/g)].map((m) => m[0]),
  ),
  [["nucleo_v2"], ["nucleo_v2"], ["nucleo_v2"]],
);

// ---------------------------------------------------------------------------
console.log("\nM. Migration 035: aditiva e pura");
const sql = fonte(`supabase/migrations/${MIGRATION_DO_NUCLEO}`);
const semComentarios = sql.replace(/--[^\n]*/g, "");
verificar(
  "M1. a 035 existe uma vez, com timestamp > 20261101120000 (034) e < o da 036",
  [
    /^(\d{14})_035_/.exec(MIGRATION_DO_NUCLEO)?.[1] > "20261101120000",
    /^(\d{14})_035_/.exec(MIGRATION_DO_NUCLEO)?.[1] < "20261103120000",
    migrations.filter((f) => /_035_/.test(f)).length,
  ],
  [true, true, 1],
);

// Os corpos das funções são retirados para olhar só os comandos de nível superior.
const nivelSuperior = semComentarios.replace(/\$\$[\s\S]*?\$\$/g, "$$corpo$$");
const comandos = nivelSuperior
  .split(";")
  .map((c) => c.trim().replace(/\s+/g, " ").toLowerCase())
  .filter((c) => c !== "");
const tiposDeComando = [
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
verificar("M2. só begin, create function, revoke, comment on function e commit", tiposDeComando, [
  "begin",
  "comment on function",
  "commit",
  "create function",
  "revoke all on",
]);
verificar(
  "M3. nenhum create or replace, alter, drop, grant, insert, update, delete, trigger, policy ou table",
  /\b(create\s+or\s+replace|alter|drop|grant|insert|update|delete|truncate|create\s+(trigger|policy|table|view|index))\b/i.test(
    nivelSuperior,
  ),
  false,
);
const criadas = [...sql.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]).sort();
verificar("M4. cria exatamente as seis funções nucleo_*", criadas, [
  "nucleo_arredondar_centavos",
  "nucleo_arredondar_he_diaria",
  "nucleo_componentes_legado_010",
  "nucleo_componentes_v2",
  "nucleo_minutos_previstos",
  "nucleo_minutos_trabalhados",
]);
const blocos = [...sql.matchAll(/create function public\.(\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)];
verificar(
  "M5. todas IMMUTABLE, com search_path = pg_catalog, sem SECURITY DEFINER",
  blocos.map(([cabecalho]) => [
    /\bimmutable\b/.test(cabecalho),
    /set search_path = pg_catalog\n/.test(cabecalho),
    /security definer/.test(cabecalho),
  ]),
  blocos.map(() => [true, true, false]),
);
verificar(
  "M6. nenhum corpo lê tabela, auth, relógio ou outra função de public",
  blocos
    .filter(([, , corpo]) =>
      /\bauth\.|public\.(?!nucleo_)|\b(select|insert|update|delete|perform|execute|now|current_\w+)\b/i.test(
        corpo.replace(/--[^\n]*/g, ""),
      ),
    )
    .map(([, nome]) => nome),
  [],
);
verificar(
  "M7. EXECUTE revogado de public, anon, authenticated e service_role nas seis",
  (sql.match(/from public, anon, authenticated, service_role;/g) ?? []).length,
  6,
);
verificar(
  "M8. a migration envolve tudo numa transação",
  [/^\s*begin;/m.test(semComentarios), /commit;\s*$/.test(semComentarios)],
  [true, true],
);
verificar(
  "M9. o runbook de reversão existe e remove as seis funções",
  (
    fonte("docs/runbooks/rollback-nucleo-financeiro.sql").match(
      /^drop function public\.nucleo_/gm,
    ) ?? []
  ).length,
  6,
);

// ---------------------------------------------------------------------------
console.log("\nS. Teste SQL gerado");
verificar(
  `S1. ${CAMINHO_DO_SQL} = saída do gerador (sem deriva)`,
  fonte(CAMINHO_DO_SQL) === gerarSqlDoNucleo(),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nN. Núcleo TypeScript");
const ts = fonte("src/lib/nucleo-financeiro.ts");
verificar("N1. sem importação em tempo de execução", /^\s*import\s(?!type\b)/m.test(ts), false);
verificar(
  "N2. sem Math.round, toFixed, parseFloat nem Number(...) sobre dinheiro em ponto flutuante",
  /Math\.round|toFixed|parseFloat|toPrecision/.test(ts),
  false,
);
verificar(
  "N3. a conta de dinheiro é em BigInt",
  (ts.match(/arredondarCentavos\(/g) ?? []).length >= 7 &&
    /function arredondarCentavos\(numerador: bigint, denominador: bigint\)/.test(ts),
  true,
);

// ---------------------------------------------------------------------------
console.log("\nC. Scripts e CI");
const pacote = JSON.parse(fonte("package.json"));
const ci = fonte(".github/workflows/ci.yml");
for (const suite of ["test:nucleo-v2", "test:nucleo-legado", "test:nucleo-isolamento"]) {
  verificar(
    `C1. ${suite} existe no package.json e roda na CI`,
    [Boolean(pacote.scripts[suite]), ci.includes(`npm run ${suite}`)],
    [true, true],
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
