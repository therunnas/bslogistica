#!/usr/bin/env bash
# Ensaio local da migration 036 e da sua reversão (FIN-PR-02): catálogo E dados antes e depois.
#
# NUNCA toca Production nem homologação: usa só o Supabase LOCAL descartável (`supabase start`,
# `db reset --local`) e o container supabase_db_<project_id>, endereçado pelo nome exato, como
# `scripts/testar-sql-local.sh`.
#
# O QUE PROVA
#   1. a 036 só altera o que o desenho prevê: as três funções recriadas, as 5 colunas e as 3 constraints
#      da timesheet_entries; nenhuma policy, grant, gatilho, tabela ou outra função muda;
#   2. nenhuma linha existente (1.056 lançamentos sintéticos, parte deles já faturada) muda de valor:
#      o hash das colunas anteriores à 036 é o mesmo antes e depois;
#   3. a reversão RECUSA quando já existe lançamento calculado pela V2 e não altera nada ao recusar;
#   4. depois de a V2 sair, a reversão devolve o catálogo e os dados ao estado anterior à 036, inclusive
#      os corpos de função (nada do MFA, dos guards ou das proteções é revertido).
#
# Uso: bash scripts/comparar-catalogo-integracao.sh   (o banco local fica em 034 + 035, sem a 036)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker não está disponível." >&2
  exit 1
fi

project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
container="supabase_db_${project_id}"
migration="supabase/migrations/20261103120000_036_integracao_nucleo_v2.sql"
reversao="docs/runbooks/rollback-integracao-nucleo-v2.sql"
anterior="20261102120000" # a 035

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Subindo Supabase local..."
env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime >/dev/null 2>&1 || \
  env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest start >/dev/null

echo "Banco local até a 035 (db reset --local --version $anterior)..."
env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest db reset --local --version "$anterior" >/dev/null 2>&1

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
  union all
  select 'D|' || obj_description(p.oid, 'pg_proc') from pg_proc p
   where p.proname = 'derivar_valores_por_vigencia' and p.pronamespace = 'public'::regnamespace
) x order by line;
SQL
}

# Hash dos dados nas colunas que já existiam antes da 036 (as novas ficam de fora).
dados() {
  psql_local <<'SQL'
select count(*)::text || '|' || coalesce(md5(string_agg(
         (to_jsonb(e) - 'billed_base_amount' - 'billed_overtime_amount' - 'billed_special_amount'
                      - 'additional_amount' - 'calc_version')::text, ',' order by e.id)), '-')
       || '|' || count(*) filter (where invoice_id is not null)::text
       || '|' || coalesce(sum(billed_amount), 0)::text || '|' || coalesce(sum(cost_amount), 0)::text
  from public.timesheet_entries e;
SQL
}

echo "Semente sintética (1.056 lançamentos pela 030; os do contrato A já faturados)..."
node scripts/gerar-sql-integracao-v2.mjs semente | psql_local >/dev/null

impressao >"$tmp/antes.txt"
dados >"$tmp/dados_antes.txt"
echo "Antes da 036: $(wc -l <"$tmp/antes.txt" | tr -d ' ') objetos; dados: $(cut -d'|' -f1,3 "$tmp/dados_antes.txt")"

psql_local <"$migration" >/dev/null
impressao >"$tmp/depois.txt"
dados >"$tmp/dados_depois.txt"
echo "Depois da 036: $(wc -l <"$tmp/depois.txt" | tr -d ' ') objetos."

diff "$tmp/antes.txt" "$tmp/depois.txt" | grep -E '^[<>]' >"$tmp/diferenca.txt" || true
# O esperado: as 3 funções (corpo novo), o comentário da derivação, as 5 colunas, as 3 constraints. Mais nada.
inesperado=$(grep -vE '^[<>] (F\|public\.(derivar_valores_por_vigencia|bloquear_colunas_de_condicoes|estado_motor_vigencia)\(|D\||A\|(public\.)?timesheet_entries\|(billed_base_amount|billed_overtime_amount|billed_special_amount|additional_amount|calc_version)\||C\|(public\.)?timesheet_entries\|timesheet_entries_(calc_version_valida|adicional_nao_negativo|componentes_coerentes)\|)' "$tmp/diferenca.txt" || true)
echo ""
echo "Mudanças do catálogo na 036: $(wc -l <"$tmp/diferenca.txt" | tr -d ' ') linhas"
sed -E 's/\|[0-9a-f]{32}.*$//' "$tmp/diferenca.txt" | sed 's/^/  /'
if [ -n "$inesperado" ]; then
  echo "FALHOU: mudança de catálogo fora do esperado:" >&2
  printf '%s\n' "$inesperado" >&2
  exit 1
fi
if ! diff -q "$tmp/dados_antes.txt" "$tmp/dados_depois.txt" >/dev/null; then
  echo "FALHOU: a 036 alterou dados existentes." >&2
  cat "$tmp/dados_antes.txt" "$tmp/dados_depois.txt" >&2
  exit 1
fi
echo "Dados existentes: idênticos antes e depois da 036 (nenhum lançamento recalculado)."

echo ""
echo "Um lançamento novo, de dia útil, passa a ser calculado pela V2..."
psql_local <<'SQL' >"$tmp/novo.txt"
insert into public.timesheets (id, operation_id, shift_id, work_date)
  select '5c36b000-0000-4000-8000-0000000009ff', operacao, turno, date '2026-03-10' from (
    select distinct operacao, turno from (select ('5c36e000-0000-4000-8000-000000000002')::uuid operacao, ('5c36a000-0000-4000-8000-000000000002')::uuid turno) x) y;
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c36b100-0000-4000-8000-0000000009ff', '5c36b000-0000-4000-8000-0000000009ff',
          '5c36f000-0000-4000-8000-000000000001', 'present', '06:00', '15:15', 60);
select calc_version::text || '|' || billed_base_amount::text || '|' || billed_overtime_amount::text
  from public.timesheet_entries where id = '5c36b100-0000-4000-8000-0000000009ff';
SQL
echo "  V2 (esperado 2|133.33|12.50): $(cat "$tmp/novo.txt")"
[ "$(cat "$tmp/novo.txt")" = "2|133.33|12.50" ] || { echo "FALHOU: cálculo V2 do lançamento novo." >&2; exit 1; }

echo "A reversão deve RECUSAR com lançamento V2 gravado..."
if psql_local <"$reversao" >"$tmp/recusa.txt" 2>&1; then
  echo "FALHOU: a reversão deveria recusar." >&2
  exit 1
fi
grep -q "Reversão recusada" "$tmp/recusa.txt" || { echo "FALHOU: mensagem de recusa ausente:" >&2; cat "$tmp/recusa.txt" >&2; exit 1; }
impressao >"$tmp/apos_recusa.txt"
diff -q "$tmp/depois.txt" "$tmp/apos_recusa.txt" >/dev/null || { echo "FALHOU: a recusa alterou o catálogo." >&2; exit 1; }
echo "  recusada, sem efeito no catálogo."

echo "Removendo o lançamento de teste e revertendo..."
psql_local <<'SQL' >/dev/null
delete from public.timesheet_entries where id = '5c36b100-0000-4000-8000-0000000009ff';
delete from public.timesheets where id = '5c36b000-0000-4000-8000-0000000009ff';
SQL
psql_local <"$reversao" >/dev/null
impressao >"$tmp/revertido.txt"
dados >"$tmp/dados_revertido.txt"
if diff -q "$tmp/antes.txt" "$tmp/revertido.txt" >/dev/null; then
  catalogo="idêntico"
else
  catalogo="DIFERENTE"
  diff "$tmp/antes.txt" "$tmp/revertido.txt" | head -20
fi
if diff -q "$tmp/dados_antes.txt" "$tmp/dados_revertido.txt" >/dev/null; then dados_rev="idênticos"; else dados_rev="DIFERENTES"; fi
echo "Depois da reversão: catálogo $catalogo ao de antes da 036; dados $dados_rev."

if [ "$catalogo" != "idêntico" ] || [ "$dados_rev" != "idênticos" ]; then
  echo "FALHOU: a reversão não restaura o estado anterior à 036." >&2
  exit 1
fi
echo "PASS: a 036 só altera o previsto, não toca em dado existente, e a reversão restaura catálogo e dados."
