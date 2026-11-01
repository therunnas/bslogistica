#!/usr/bin/env bash
# Ensaio local da migration 041 e da sua reversão (FIN-PR-07, etapas 4 a 7): catálogo E dados antes e depois.
#
# NUNCA toca Production nem homologação: só o Supabase LOCAL descartável e o container
# supabase_db_<project_id>, endereçado pelo nome exato.
#
# O QUE PROVA
#   1. a 041 só acrescenta: as tabelas de tarifa e da chave, as RPCs, a coluna de ligação do
#      lançamento à tarifa e os novos corpos de derivar_valores_por_vigencia, bloquear_colunas_de_condicoes
#      e estado_motor_vigencia; nenhum outro gatilho, policy ou grant existente muda;
#   2. nenhum dado muda e, COM A RESOLUÇÃO DESLIGADA (estado inicial), o MESMO apontamento criado
#      depois da 041 tem exatamente as mesmas colunas financeiras que o criado antes (prova financeira
#      antes/depois), e as faturas já emitidas ficam idênticas;
#   3. a reversão RECUSA quando há tarifa e, sem ela, devolve catálogo e dados.
#
# Uso: bash scripts/comparar-catalogo-tarifas.sh   (o banco local fica até a 040)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker info >/dev/null 2>&1 || { echo "Docker não está disponível." >&2; exit 1; }

project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
container="supabase_db_${project_id}"
migration="supabase/migrations/20261108120000_041_tarifas_por_funcao_e_periodo.sql"
reversao="docs/runbooks/rollback-tarifas-por-funcao.sql"
anterior="20261107120000" # a 040

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

supa() { env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest "$@"; }
echo "Subindo Supabase local..."
supa start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime >/dev/null 2>&1 || supa start >/dev/null
echo "Banco local até a 040 (db reset --local --version $anterior)..."
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
# (todas as colunas, exceto as que a 041 cria).
dados() {
  psql_local <<'SQL'
select (select count(*) || '|' || coalesce(md5(string_agg((to_jsonb(e) - 'contract_rate_terms_id')::text, ',' order by e.id)), '-') from public.timesheet_entries e)
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

echo "Semente sintética, um adicional e uma FATURA EMITIDA pelo gerar_fatura de antes da 041..."
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
echo "Antes da 041: $(wc -l <"$tmp/antes.txt" | tr -d ' ') objetos."

psql_local <"$migration" >/dev/null
impressao >"$tmp/depois.txt"
dados >"$tmp/dados_depois.txt"
echo "Depois da 041: $(wc -l <"$tmp/depois.txt" | tr -d ' ') objetos."

diff "$tmp/antes.txt" "$tmp/depois.txt" | grep -E '^[<>]' >"$tmp/diferenca.txt" || true
inesperado=$(grep -vE '^[<>] (F\|public\.(estado_motor_vigencia|bloquear_colunas_de_condicoes|derivar_valores_por_vigencia|proteger_pricing_settings|resolucao_de_tarifas_ativa|bloquear_exclusao_de_tarifa|registrar_tarifa_contrato|encerrar_tarifa_interna|encerrar_tarifa_contrato|corrigir_tarifa_contrato|aposentar_tarifa_contrato|tarifa_contrato_na_data|alterar_resolucao_tarifas)\(|P\|public\.(contract_rate_terms|pricing_settings)\||T\|(public\.)?(contract_rate_terms|pricing_settings)\||C\|(public\.)?(contract_rate_terms\||pricing_settings\||timesheet_entries\|timesheet_entries_contract_rate_terms_id_fkey\||financial_terms_audit\|financial_terms_audit_acao_valida\|)|R\|(public\.)?(contract_rate_terms|pricing_settings)\||A\|(public\.)?(contract_rate_terms\||pricing_settings\||timesheet_entries\|contract_rate_terms_id\|))' "$tmp/diferenca.txt" || true)
echo ""
echo "Mudanças do catálogo na 041: $(wc -l <"$tmp/diferenca.txt" | tr -d ' ') linhas"
sed -E 's/\|[0-9a-f]{32}.*$//' "$tmp/diferenca.txt" | sed 's/^/  /'
[ -z "$inesperado" ] || { echo "FALHOU: mudança fora do esperado:" >&2; printf '%s\n' "$inesperado" >&2; exit 1; }
diff -q "$tmp/dados_antes.txt" "$tmp/dados_depois.txt" >/dev/null || { echo "FALHOU: a 041 alterou dados." >&2; exit 1; }
echo "Dados: lançamentos, faturas emitidas, itens, versões, adicionais, turnos, equipe e colaboradores idênticos antes e depois da 041 (fora da coluna nova)."
ligados=$(psql_local -c "select count(*) from public.timesheet_entries where contract_rate_terms_id is not null")
resolucao=$(psql_local -c "select tarifas_por_funcao from public.pricing_settings")
[ "$ligados" = "0" ] && [ "$resolucao" = "f" ] || { echo "FALHOU: a 041 deve nascer sem tarifa ligada e com a resolução desligada ($ligados, $resolucao)." >&2; exit 1; }
echo "Estado inicial: resolução desligada e nenhum apontamento ligado a tarifa."

# Prova financeira antes/depois: o MESMO apontamento (mesma entrada, 14 dias depois, colaborador novo
# com o mesmo custo), criado DEPOIS da 041 com a resolução desligada, tem exatamente as mesmas colunas
# financeiras que o criado ANTES (um apontamento de dia útil da semente, calculado pelo motor da 036).
prova=$(psql_local <<'SQL'
begin;
create temporary table _modelo on commit drop as
  select te.*, t.operation_id as w_op, t.shift_id as w_shift, t.work_date as w_date
    from public.timesheet_entries te join public.timesheets t on t.id = te.timesheet_id
   where te.status = 'present' and te.day_kind_snapshot = 'util' and te.calc_version = 2
     and extract(isodow from te.work_date) between 1 and 5 and te.billed_overtime_minutes > 0
   order by te.id limit 1;
insert into public.employees (id, name, daily_cost)
  select 'dd000000-0000-4000-8000-000000000001', 'PROVA-DEPOIS', ec.daily_cost
    from _modelo m join public.employee_cost_terms ec on ec.employee_id = m.employee_id and ec.active;
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason, ot_hourly_cost)
  select 'dd000000-0000-4000-8000-000000000001', ec.valid_from, ec.daily_cost, true, 'informada', 'prova', ec.ot_hourly_cost
    from _modelo m join public.employee_cost_terms ec on ec.employee_id = m.employee_id and ec.active;
insert into public.timesheets (id, operation_id, shift_id, work_date)
  select 'dd000000-0000-4000-8000-000000000002', w_op, w_shift, w_date + 14 from _modelo;
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  select 'dd000000-0000-4000-8000-000000000003', 'dd000000-0000-4000-8000-000000000002', 'dd000000-0000-4000-8000-000000000001',
         status, check_in, check_out, break_minutes from _modelo;
select (select md5(to_jsonb(x)::text) from (
         select billed_amount, cost_amount, worked_minutes, overtime_minutes, billed_overtime_minutes, daily_rate_snapshot,
                ot_hour_rate_snapshot, daily_cost_snapshot, ot_hourly_cost_snapshot, billed_base_amount, billed_overtime_amount,
                billed_special_amount, additional_amount, calc_version, day_kind_snapshot, shift_hours_snapshot,
                ot_factor_snapshot, ot_tolerance_snapshot, planned_minutes_snapshot, terms_origin
           from _modelo) x)
    || '|' ||
       (select md5(to_jsonb(y)::text) from (
         select billed_amount, cost_amount, worked_minutes, overtime_minutes, billed_overtime_minutes, daily_rate_snapshot,
                ot_hour_rate_snapshot, daily_cost_snapshot, ot_hourly_cost_snapshot, billed_base_amount, billed_overtime_amount,
                billed_special_amount, additional_amount, calc_version, day_kind_snapshot, shift_hours_snapshot,
                ot_factor_snapshot, ot_tolerance_snapshot, planned_minutes_snapshot, terms_origin
           from public.timesheet_entries where id = 'dd000000-0000-4000-8000-000000000003') y)
    || '|' || (select coalesce(contract_rate_terms_id::text, 'nulo') from public.timesheet_entries where id = 'dd000000-0000-4000-8000-000000000003');
rollback;
SQL
)
antes_h=${prova%%|*}; resto=${prova#*|}; depois_h=${resto%%|*}; ligacao=${resto#*|}
[ -n "$antes_h" ] && [ "$antes_h" = "$depois_h" ] && [ "$ligacao" = "nulo" ] || { echo "FALHOU: a mesma entrada financeira produziu valores diferentes depois da 041 ($prova)." >&2; exit 1; }
echo "Prova financeira: o mesmo apontamento criado depois da 041 (resolução desligada) tem as mesmas 20 colunas financeiras que o criado antes."

echo ""
echo "A reversão deve RECUSAR com tarifa cadastrada (ensaio em transação desfeita)..."
sed -e '/^begin;$/d' -e '/^commit;$/d' "$reversao" >"$tmp/reversao_corpo.sql"
{
  echo "begin;"
  echo "insert into public.contract_rate_terms (contract_id, job_function_id, shift_period, valid_from, daily_rate, origin, reason) select c.id, (select id from public.job_functions where code = 'operador'), 'diurno', date '2030-01-01', 100, 'informada', 'sintético' from public.contracts c limit 1;"
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
echo "Depois da reversão: catálogo $catalogo ao de antes da 041; dados $dados_rev."
[ "$catalogo" = "idêntico" ] && [ "$dados_rev" = "idênticos" ] || { echo "FALHOU: a reversão não restaura o estado anterior." >&2; exit 1; }
echo "PASS: a 041 só acrescenta tarifas e a resolução desligada, não toca em dado financeiro nem em fatura emitida, e a reversão restaura catálogo e dados."
