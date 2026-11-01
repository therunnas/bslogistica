#!/usr/bin/env bash
# Ensaio local da migration 040 e da sua reversão (FIN-PR-07, etapa 2): catálogo E dados antes e depois.
#
# NUNCA toca Production nem homologação: só o Supabase LOCAL descartável e o container
# supabase_db_<project_id>, endereçado pelo nome exato.
#
# O QUE PROVA
#   1. a 040 só acrescenta: três colunas e três CHECKs nos apontamentos, o gatilho de captura, a RPC de
#      correção, a nova ação da trilha e os novos corpos de bloquear_colunas_de_condicoes,
#      salvar_apontamento_admin e estado_motor_vigencia; nenhum outro gatilho, policy ou grant;
#   2. nenhum dado muda: lançamentos (todas as colunas existentes), faturas JÁ EMITIDAS, itens, versões
#      de contrato, adicionais, turnos, equipe e colaboradores ficam idênticos; os snapshots novos
#      nascem NULOS em todo apontamento existente (nada é reconstruído pelo cadastro de hoje);
#   3. a reversão RECUSA se houver snapshot e, sem ele, devolve catálogo e dados.
#
# Uso: bash scripts/comparar-catalogo-snapshots.sh   (o banco local fica até a 039)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker info >/dev/null 2>&1 || { echo "Docker não está disponível." >&2; exit 1; }

project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
container="supabase_db_${project_id}"
migration="supabase/migrations/20261107120000_040_snapshots_funcao_periodo.sql"
reversao="docs/runbooks/rollback-snapshots-funcao-periodo.sql"
anterior="20261106120000" # a 039

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

supa() { env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest "$@"; }
echo "Subindo Supabase local..."
supa start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime >/dev/null 2>&1 || supa start >/dev/null
echo "Banco local até a 039 (db reset --local --version $anterior)..."
supa db reset --local --version "$anterior" >/dev/null 2>&1

[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null)" = "true" ] || { echo "container $container não está rodando" >&2; exit 1; }
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

# Hash dos dados: lançamentos, faturas, itens, versões, adicionais, turnos, equipe e colaboradores
# (todas as colunas, exceto as que a 039 cria e employees.updated_at).
dados() {
  psql_local <<'SQL'
select (select count(*) || '|' || coalesce(md5(string_agg((to_jsonb(e) - 'job_function_id_snapshot' - 'shift_period_snapshot' - 'job_function_source')::text, ',' order by e.id)), '-') from public.timesheet_entries e)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(i)::text, ',' order by i.id)), '-') from public.invoices i)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, ',' order by t.id)), '-') from public.invoice_items t)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(c)::text, ',' order by c.id)), '-') from public.contract_terms c)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(a)::text, ',' order by a.id)), '-') from public.billing_additionals a)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), '-') from public.shifts s)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(q)::text, ',' order by q.id)), '-') from public.operation_team q)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(to_jsonb(m)::text, ',' order by m.id)), '-') from public.employees m)
       || '|' || (select count(*) || '|' || coalesce(md5(string_agg(m.role, ',' order by m.id)), '-') from public.employees m);
SQL
}

echo "Semente sintética, um adicional e uma FATURA EMITIDA pelo gerar_fatura de antes da 040..."
node scripts/gerar-sql-integracao-v2.mjs semente | psql_local >/dev/null
psql_local <<'SQL' >/dev/null
begin;
create or replace function pg_temp.adm(_sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '5c360000-0000-4000-8000-0000000000a1', 'role', 'authenticated',
    'aal', 'aal1', 'session_id', 'ec360000-0000-4000-8000-0000000000a1')::text, true);
  set local role authenticated;
  execute _sql into _r;
  set local role postgres;
  return _r;
end;
$$;
select pg_temp.adm($q$select (public.gerar_fatura('5c36c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$);
select pg_temp.adm($q$select public.registrar_adicional('5c36c000-0000-4000-8000-0000000000c1', date '2026-04-03', date '2026-04-04', 'Adicional sintético', 12.34)::text$q$);
commit;
SQL
echo "  faturas e itens emitidos: $(psql_local -c "select count(*) || ' faturas, ' || (select count(*) from public.invoice_items) || ' itens' from public.invoices")"

impressao >"$tmp/antes.txt"
dados >"$tmp/dados_antes.txt"
echo "Antes da 040: $(wc -l <"$tmp/antes.txt" | tr -d ' ') objetos."

psql_local <"$migration" >/dev/null
impressao >"$tmp/depois.txt"
dados >"$tmp/dados_depois.txt"
echo "Depois da 040: $(wc -l <"$tmp/depois.txt" | tr -d ' ') objetos."

diff "$tmp/antes.txt" "$tmp/depois.txt" | grep -E '^[<>]' >"$tmp/diferenca.txt" || true
inesperado=$(grep -vE '^[<>] (F\|public\.(estado_motor_vigencia|bloquear_colunas_de_condicoes|salvar_apontamento_admin|capturar_snapshots_funcao_periodo|corrigir_snapshots_do_apontamento)\(|T\|(public\.)?timesheet_entries\|trg_timesheet_entries_bz_snapshots_funcao_periodo\||C\|(public\.)?(timesheet_entries\|timesheet_entries_(periodo_snapshot_valido|funcao_origem_valida|funcao_com_origem|job_function_id_snapshot_fkey)\||financial_terms_audit\|financial_terms_audit_acao_valida\|)|A\|(public\.)?timesheet_entries\|(job_function_id_snapshot|shift_period_snapshot|job_function_source)\|)' "$tmp/diferenca.txt" || true)
echo ""
echo "Mudanças do catálogo na 040: $(wc -l <"$tmp/diferenca.txt" | tr -d ' ') linhas"
sed -E 's/\|[0-9a-f]{32}.*$//' "$tmp/diferenca.txt" | sed 's/^/  /'
[ -z "$inesperado" ] || { echo "FALHOU: mudança fora do esperado:" >&2; printf '%s\n' "$inesperado" >&2; exit 1; }
diff -q "$tmp/dados_antes.txt" "$tmp/dados_depois.txt" >/dev/null || { echo "FALHOU: a 040 alterou dados." >&2; exit 1; }
echo "Dados: lançamentos, faturas emitidas, itens, versões, adicionais, turnos, equipe e colaboradores idênticos antes e depois da 040 (fora das colunas novas)."
snap=$(psql_local -c "select count(*) from public.timesheet_entries where job_function_id_snapshot is not null or shift_period_snapshot is not null or job_function_source is not null")
[ "$snap" = "0" ] || { echo "FALHOU: apontamentos existentes ganharam snapshot ($snap)." >&2; exit 1; }
echo "Snapshots: nenhum apontamento existente foi reconstruído pelo cadastro (todos nulos)."

echo ""
echo "A reversão deve RECUSAR com correção de snapshot na trilha (ensaio em transação desfeita)..."
sed -e '/^begin;$/d' -e '/^commit;$/d' "$reversao" >"$tmp/reversao_corpo.sql"
{
  echo "begin;"
  echo "insert into public.financial_terms_audit (actor_id, action, entity_kind, entity_id, term_id, reason) values (gen_random_uuid(), 'apontamento_snapshots_corrigidos', 'apontamento', gen_random_uuid(), gen_random_uuid(), 'sintético');"
  cat "$tmp/reversao_corpo.sql"
  echo "rollback;"
} >"$tmp/recusa.sql"
if psql_local <"$tmp/recusa.sql" >"$tmp/recusa.txt" 2>&1; then echo "FALHOU: a reversão deveria recusar." >&2; exit 1; fi
grep -q "Reversão recusada" "$tmp/recusa.txt" || { cat "$tmp/recusa.txt" >&2; exit 1; }
impressao >"$tmp/apos_recusa.txt"
diff -q "$tmp/depois.txt" "$tmp/apos_recusa.txt" >/dev/null || { echo "FALHOU: a recusa alterou o catálogo." >&2; exit 1; }
echo "  recusada, sem efeito."

echo "Revertendo..."
psql_local <"$reversao" >/dev/null
impressao >"$tmp/revertido.txt"
dados >"$tmp/dados_revertido.txt"
if diff -q "$tmp/antes.txt" "$tmp/revertido.txt" >/dev/null; then catalogo="idêntico"; else catalogo="DIFERENTE"; diff "$tmp/antes.txt" "$tmp/revertido.txt" | head -20; fi
if diff -q "$tmp/dados_antes.txt" "$tmp/dados_revertido.txt" >/dev/null; then dados_rev="idênticos"; else dados_rev="DIFERENTES"; fi
echo "Depois da reversão: catálogo $catalogo ao de antes da 040; dados $dados_rev."
[ "$catalogo" = "idêntico" ] && [ "$dados_rev" = "idênticos" ] || { echo "FALHOU: a reversão não restaura o estado anterior." >&2; exit 1; }
echo "PASS: a 040 só acrescenta snapshots protegidos, não toca em dado financeiro nem em fatura emitida, e a reversão restaura catálogo e dados."
