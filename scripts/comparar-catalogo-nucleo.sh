#!/usr/bin/env bash
# Compara o catálogo do banco LOCAL antes da migration 035, depois dela e depois da reversão
# (FIN-PR-01). Prova que a 035 só ACRESCENTA as funções nucleo_* e que o runbook a desfaz
# por completo.
#
# NUNCA toca Production nem homologação: usa só o Supabase LOCAL descartável
# (`supabase start`, `db reset --local`) e o container supabase_db_<project_id>, endereçado pelo
# nome exato, como `scripts/testar-sql-local.sh`.
#
# Uso: scripts/comparar-catalogo-nucleo.sh
# Ao final o banco local fica no estado de 034 + 035 + reversão; rode `scripts/testar-sql-local.sh`
# depois, que refaz o banco do zero.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker não está disponível." >&2
  exit 1
fi

project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
container="supabase_db_${project_id}"
migration="supabase/migrations/20261102120000_035_nucleo_financeiro_puro.sql"
reversao="docs/runbooks/rollback-nucleo-financeiro.sql"
anterior="20261101120000" # a 034

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Subindo Supabase local..."
env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest start >/dev/null

echo "Banco local até a 034 (db reset --local --version $anterior)..."
env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest db reset --local --version "$anterior" >/dev/null

[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null)" = "true" ] || {
  echo "container $container não está rodando" >&2
  exit 1
}
psql_local() { docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }

impressao() {
  psql_local <<'SQL'
select line from (
  select 'F|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
         || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '-') as line
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and p.prokind in ('f', 'p')
  union all
  select 'P|' || schemaname || '.' || tablename || '|' || policyname || '|'
         || md5(row(permissive, roles, cmd, qual, with_check)::text)
    from pg_policies
  union all
  select 'T|' || tgrelid::regclass || '|' || tgname || '|' || tgenabled::text || '|' || md5(pg_get_triggerdef(oid))
    from pg_trigger where not tgisinternal
  union all
  select 'C|' || conrelid::regclass || '|' || conname || '|' || md5(pg_get_constraintdef(oid))
    from pg_constraint where conrelid <> 0
  union all
  select 'R|' || c.oid::regclass || '|' || c.relkind::text || '|' || c.relrowsecurity || '|' || coalesce(c.relacl::text, '-')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'A|' || a.attrelid::regclass || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
         || '|' || a.attnotnull || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'E|' || evtname || '|' || evtenabled::text || '|' || evtfoid::regproc from pg_event_trigger
) x order by line;
SQL
}

impressao >"$tmp/antes.txt"
echo "Antes (034): $(wc -l <"$tmp/antes.txt" | tr -d ' ') objetos."

psql_local <"$migration" >/dev/null
impressao >"$tmp/depois.txt"
echo "Depois da 035: $(wc -l <"$tmp/depois.txt" | tr -d ' ') objetos."

diff "$tmp/antes.txt" "$tmp/depois.txt" >"$tmp/diferenca.txt" || true
removidos=$(grep -c '^<' "$tmp/diferenca.txt" || true)
acrescentados=$(grep '^>' "$tmp/diferenca.txt" || true)
fora_do_nucleo=$(printf '%s\n' "$acrescentados" | grep -v '^$' | grep -vc 'public\.nucleo_' || true)

echo ""
echo "Objetos removidos ou alterados pela 035: $removidos"
echo "Objetos acrescentados pela 035:"
printf '%s\n' "$acrescentados" | sed -E 's/\|[0-9a-f]{32}\|.*$//' | sed 's/^/  /'
echo "Acrescentados fora de nucleo_*: $fora_do_nucleo"

psql_local <"$reversao" >/dev/null
impressao >"$tmp/revertido.txt"
if diff -q "$tmp/antes.txt" "$tmp/revertido.txt" >/dev/null; then
  revertido="idêntico"
else
  revertido="DIFERENTE"
  diff "$tmp/antes.txt" "$tmp/revertido.txt" | head -20
fi
echo "Catálogo depois da reversão: $revertido ao de antes."

if [ "$removidos" != "0" ] || [ "$fora_do_nucleo" != "0" ] || [ "$revertido" != "idêntico" ]; then
  echo "FALHOU: a 035 não é estritamente aditiva ou a reversão não restaura o catálogo." >&2
  exit 1
fi
echo "PASS: a 035 só acrescenta nucleo_* e a reversão restaura o catálogo."
