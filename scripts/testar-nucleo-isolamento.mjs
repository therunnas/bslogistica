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
 * ATENÇÃO À PRÓXIMA ETAPA: a FIN-PR-02 liga o núcleo ao motor de propósito. Os casos I1 e I2 vão
 * falhar então, e devem ser trocados pela nova fronteira de uso, não apagados.
 *
 *   I  ninguém usa o núcleo (TypeScript e SQL)
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
verificar("I1. nenhum arquivo de src/ importa nucleo-financeiro", usosTs, []);
const migrations = readdirSync(join(raiz, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const outrasComNucleo = migrations.filter(
  (f) => f !== MIGRATION_DO_NUCLEO && /nucleo_/.test(fonte(`supabase/migrations/${f}`)),
);
verificar("I2. nenhuma outra migration menciona nucleo_*", outrasComNucleo, []);

// ---------------------------------------------------------------------------
console.log("\nM. Migration 035: aditiva e pura");
const sql = fonte(`supabase/migrations/${MIGRATION_DO_NUCLEO}`);
const semComentarios = sql.replace(/--[^\n]*/g, "");
const ultima = migrations[migrations.length - 1];
verificar(
  "M1. é a última migration, número 035, timestamp > 20261101120000 (034)",
  [
    ultima,
    /^(\d{14})_035_/.exec(MIGRATION_DO_NUCLEO)?.[1] > "20261101120000",
    migrations.filter((f) => /_035_/.test(f)).length,
  ],
  [MIGRATION_DO_NUCLEO, true, 1],
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
