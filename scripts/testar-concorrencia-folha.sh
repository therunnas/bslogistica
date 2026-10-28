#!/usr/bin/env bash
# Concorrência entre FECHAR a folha e GRAVAR apontamento nela (C06, migration 031).
#
# Roda SÓ contra o Supabase LOCAL descartável (container supabase_db_<project_id>, resolvido do
# config.toml), com duas sessões psql de verdade. Cria dados com UUIDs fixos e NÃO os remove:
# use um banco recém-resetado (`supabase db reset --local`). Nunca contra Production/homologação.
#
# Esperado:
#   caso 1 (gravação em curso, fechamento concorrente): o fechamento ESPERA a gravação terminar
#          (≈3 s) e o resultado é "closed|1" — a linha foi gravada antes do fechamento.
#   caso 2 (fechamento em curso, gravação concorrente): a gravação ESPERA o fechamento terminar
#          (≈3 s) e é RECUSADA (55000) — resultado "closed|0". Nunca fica linha em folha fechada.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
container="supabase_db_${project_id}"
[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null)" = "true" ] || { echo "container $container não está rodando" >&2; exit 1; }
p() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A "$@"; }

p <<'SQL'
insert into public.clients (id,name) values ('5c80c000-0000-4000-8000-0000000000c1','conc');
insert into public.contracts (id,client_id,name,daily_rate,shift_hours,ot_factor,ot_tolerance_min) values ('5c80d000-0000-4000-8000-0000000000d1','5c80c000-0000-4000-8000-0000000000c1','K',100,8,1.5,10);
insert into public.employees (id,name,daily_cost) values ('5c80f000-0000-4000-8000-000000000001','E1',80),('5c80f000-0000-4000-8000-000000000002','E2',80);
insert into public.operations (id,client_id,contract_id,name) values ('5c80e000-0000-4000-8000-0000000000a1','5c80c000-0000-4000-8000-0000000000c1','5c80d000-0000-4000-8000-0000000000d1','OP');
insert into public.timesheets (id,operation_id,work_date,status) values ('5c80b000-0000-4000-8000-000000000001','5c80e000-0000-4000-8000-0000000000a1','2026-03-02','open'),('5c80b000-0000-4000-8000-000000000002','5c80e000-0000-4000-8000-0000000000a1','2026-03-03','open');
SQL

resultado() { p -c "select (select status from public.timesheets where id='$1')||'|'||(select count(*) from public.timesheet_entries where timesheet_id='$1')"; }

echo "caso 1: gravação em curso, fechamento concorrente"
( p -c "begin; insert into public.timesheet_entries (timesheet_id,employee_id,status,check_in,check_out,break_minutes) values ('5c80b000-0000-4000-8000-000000000001','5c80f000-0000-4000-8000-000000000001','present','06:00','15:00',60); select pg_sleep(4); commit;" >/dev/null 2>&1 ) &
sleep 1; t0=$(date +%s); p -c "update public.timesheets set status='closed' where id='5c80b000-0000-4000-8000-000000000001'"; t1=$(date +%s); wait
echo "  fechamento esperou $((t1-t0))s; resultado: $(resultado 5c80b000-0000-4000-8000-000000000001) (esperado closed|1)"

echo "caso 2: fechamento em curso, gravação concorrente"
( p -c "begin; update public.timesheets set status='closed' where id='5c80b000-0000-4000-8000-000000000002'; select pg_sleep(4); commit;" >/dev/null 2>&1 ) &
sleep 1; t0=$(date +%s); p -c "insert into public.timesheet_entries (timesheet_id,employee_id,status,check_in,check_out,break_minutes) values ('5c80b000-0000-4000-8000-000000000002','5c80f000-0000-4000-8000-000000000002','present','06:00','15:00',60)" 2>&1 | head -1 || true; t1=$(date +%s); wait
echo "  gravação esperou $((t1-t0))s; resultado: $(resultado 5c80b000-0000-4000-8000-000000000002) (esperado closed|0)"
