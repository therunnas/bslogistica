/**
 * GATE-FIN-04B (sessão 21) — contrato transacional da migration 053.
 *
 * COMO RODAR:
 *
 *   npm run test:migration-053-transacao
 *
 * O executor remoto documentado (`docs/runbooks/aplicar-migration-api.py`) só aplica um arquivo que
 * termina no próprio `COMMIT;`: ele insere o registro em `supabase_migrations.schema_migrations`
 * imediatamente antes desse COMMIT, para que migration e registro entrem na mesma transação. A 053
 * nasceu sem `begin;`/`commit;` (as 045–052 têm) e seria recusada por ele. Esta suíte prova, SEM
 * executar o script e sem banco:
 *
 *   A. o primeiro comando executável da 053 é `begin;`;
 *   B. o último comando executável é `commit;` e o arquivo termina nele;
 *   C. há exatamente uma transação no nível de cima: nenhum outro begin/commit/rollback/savepoint
 *      fora dos corpos `$...$` (os `begin` do PL/pgSQL não contam);
 *   D. as regras do executor: nome `<versão>_<nome>.sql`, versão posterior à anterior, marcador
 *      `$bsmig<versão>$` ausente e, montado o texto como ele monta, o registro cai DENTRO da
 *      transação.
 *
 * A atomicidade em falha injetada (E) e a aplicação bem-sucedida (F) exigem PostgreSQL: estão em
 * `scripts/testar-053-transacional-local.sh`, contra o Supabase local.
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
const ARQUIVO = "20261120120000_053_recusar_intervalo_maior_que_jornada.sql";
const ler = (nome) => readFileSync(new URL(nome, PASTA), "utf8");

/**
 * Comandos do nível de cima, em minúsculas e com espaço normalizado: sem comentários (`--` e
 * `/* *\/`), sem literais `'...'` e sem os corpos `$tag$...$tag$` (função, DO), onde o `begin` do
 * PL/pgSQL não é controle de transação.
 */
export function comandosDoNivelDeCima(sql) {
  let limpo = "";
  let i = 0;
  while (i < sql.length) {
    const resto = sql.slice(i);
    if (resto.startsWith("--")) {
      const fim = sql.indexOf("\n", i);
      i = fim === -1 ? sql.length : fim;
      continue;
    }
    if (resto.startsWith("/*")) {
      const fim = sql.indexOf("*/", i + 2);
      i = fim === -1 ? sql.length : fim + 2;
      limpo += " ";
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      i = j + 1;
      limpo += "''";
      continue;
    }
    const dolar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(resto);
    if (dolar) {
      const fim = sql.indexOf(dolar[0], i + dolar[0].length);
      i = fim === -1 ? sql.length : fim + dolar[0].length;
      limpo += "$corpo$";
      continue;
    }
    limpo += sql[i];
    i++;
  }
  return limpo
    .split(";")
    .map((c) => c.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

const CONTROLE = /^(begin|start transaction|commit|end|rollback|abort|savepoint|release)\b/;

function contrato(nome) {
  const sql = ler(nome);
  const comandos = comandosDoNivelDeCima(sql);
  const controles = comandos.filter((c) => CONTROLE.test(c));
  return {
    primeiro: comandos[0] ?? null,
    ultimo: comandos.at(-1) ?? null,
    controles,
    terminaNoCommit: sql.trimEnd().toLowerCase().endsWith("commit;"),
  };
}

console.log("\nA–C. Envelope transacional da 053\n");

const c053 = contrato(ARQUIVO);
verificar("A. o primeiro comando executável da 053 é begin", c053.primeiro, "begin");
verificar("B. o último comando executável da 053 é commit", c053.ultimo, "commit");
verificar(
  "B2. o arquivo termina no próprio commit (regra literal do executor: rstrip().lower().endswith('commit;'))",
  c053.terminaNoCommit,
  true,
);
verificar(
  "C. exatamente uma transação no nível de cima: só begin e commit, nenhum rollback, savepoint ou commit intermediário",
  c053.controles,
  ["begin", "commit"],
);

console.log("\nD. Contrato de docs/runbooks/aplicar-migration-api.py (sem executá-lo)\n");

const versoes = readdirSync(PASTA)
  .filter((n) => n.endsWith(".sql"))
  .sort();
const padrao = /^(\d{14})_(.+)\.sql$/.exec(ARQUIVO);
verificar("D1. nome no padrão <versão>_<nome>.sql", padrao !== null, true);
const anterior = versoes[versoes.indexOf(ARQUIVO) - 1];
verificar(
  "D2. a versão é posterior à anterior (a 052) — o executor recusa fora de ordem",
  [anterior, padrao[1] > /^(\d{14})/.exec(anterior)[1]],
  ["20261119120000_052_encerrar_cadastro_container_legado.sql", true],
);
const sql053 = ler(ARQUIVO);
verificar(
  "D3. o marcador de citação do registro não aparece no arquivo",
  sql053.includes(`$bsmig${padrao[1]}$`),
  false,
);
// Montagem idêntica à do executor: o registro entra imediatamente antes do ÚLTIMO commit.
const fim = sql053.trimEnd();
const pos = fim.toLowerCase().lastIndexOf("commit;");
const montado =
  fim.slice(0, pos) +
  `insert into supabase_migrations.schema_migrations(version, name, statements) values ('${padrao[1]}', '${padrao[2]}', array[$bsmig${padrao[1]}$...$bsmig${padrao[1]}$]);\n` +
  fim.slice(pos) +
  "\n";
const cMontado = comandosDoNivelDeCima(montado);
verificar(
  "D4. montado como o executor monta: begin … registro da versão … commit, numa única transação",
  [
    cMontado[0],
    cMontado.at(-2)?.startsWith("insert into supabase_migrations.schema_migrations"),
    cMontado.at(-1),
    cMontado.filter((c) => CONTROLE.test(c)),
  ],
  ["begin", true, "commit", ["begin", "commit"]],
);

console.log(
  "\nControle do analisador: as 045–052, já aplicadas pelo executor, cumprem o mesmo contrato\n",
);

const anteriores = versoes.filter((n) => /_0(4[5-9]|5[0-2])_/.test(n));
verificar(
  "K1. 045–052: begin primeiro, commit último, uma transação, terminam no commit",
  anteriores
    .map((n) => [n.slice(15, 18), contrato(n)])
    .filter(
      ([, c]) =>
        c.primeiro !== "begin" ||
        c.ultimo !== "commit" ||
        JSON.stringify(c.controles) !== '["begin","commit"]' ||
        !c.terminaNoCommit,
    )
    .map(([n]) => n),
  [],
);
verificar("K2. o analisador viu as 8 migrations de controle", anteriores.length, 8);
verificar(
  "K3. o analisador ignora begin do PL/pgSQL, comentários e literais",
  comandosDoNivelDeCima(
    "-- begin;\n/* commit; */ select 'begin;'; do $x$ begin perform 1; end $x$; create function f() returns int language plpgsql as $$ begin return 1; end $$;",
  ),
  ["select ''", "do $corpo$", "create function f() returns int language plpgsql as $corpo$"],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
