#!/usr/bin/env bash
# FIN-20C — concorrência entre geração de fatura, cancelamento e geração duplicada, com sessões reais.
#
# SOMENTE Supabase LOCAL descartável: fala com o container `supabase_db_<project_id>` por `docker exec`
# (nenhuma rede, nenhum --linked). Diferente das suítes SQL, aqui os dados são CONFIRMADOS (COMMIT), porque
# a corrida precisa de transações simultâneas; e, como a fatura emitida é imutável, eles não podem ser
# apagados. Rode em banco recém-resetado (`supabase db reset --local`) e descarte depois.
#
# Corridas (RODADAS vezes cada, com atraso aleatório para variar o entrelaçamento):
#   R1  gerar_fatura × cancelar_adicional do único adicional do cliente;
#   R2  gerar_fatura × cancelar_servico_container do único serviço do cliente;
#   R3  gerar_fatura × gerar_fatura (mesmo cliente e período, duas sessões).
# Invariantes (valem para qualquer entrelaçamento):
#   - exatamente UMA das duas operações vence (R1, R2: ou a fatura sai, ou o cancelamento vence);
#   - nunca um adicional cancelado E faturado; nunca um item cobrado duas vezes;
#   - fatura = soma dos itens = valor do adicional; fatura emitida fica imutável;
#   - R3: exatamente uma fatura, total uma vez só.
#
# Uso: scripts/testar-concorrencia-fatura.sh [project_id-do-stack-local] [rodadas]
set -uo pipefail

PROJECT_ID="${1:-}"
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(grep -E '^project_id' "$(dirname "$0")/../supabase/config.toml" | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
fi
RODADAS="${2:-8}"
CONTAINER="supabase_db_${PROJECT_ID}"
if [ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "Container local $CONTAINER não está rodando. Este script só usa Supabase local." >&2
  exit 2
fi
T=$(mktemp -d "${TMPDIR:-/tmp}/conc-fatura.XXXXXX"); trap 'rm -rf "$T"' EXIT
psql_() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }
CLAIMS='{"sub":"5c470000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1","session_id":"ec470000-0000-4000-8000-0000000000a1"}'
adm() { printf "begin; select set_config('request.jwt.claims','%s',true); set local role authenticated; %s commit;" "$CLAIMS" "$1"; }
# GATE-FIN-02 (052): registro antigo de contêiner como fixture histórica, pela dona da função.
dono() { printf "begin; select set_config('request.jwt.claims','%s',true); %s commit;" "$CLAIMS" "$1"; }
cli() { printf '5c47c000-0000-4000-8000-%012d' "$1"; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
eq()  { if [ "$2" = "$3" ]; then ok; else bad "$1: esperado [$3], obtido [$2]"; fi; }

echo "Preparando fixtures (commit) em $CONTAINER..."
psql_ <<SQL
insert into auth.users(id) values ('5c470000-0000-4000-8000-0000000000a1') on conflict do nothing;
insert into auth.sessions(id,user_id,not_after) values ('ec470000-0000-4000-8000-0000000000a1','5c470000-0000-4000-8000-0000000000a1',null) on conflict do nothing;
insert into public.user_roles(user_id,role) values ('5c470000-0000-4000-8000-0000000000a1','admin') on conflict do nothing;
insert into public.employees(id,name,daily_cost) values ('5c47f000-0000-4000-8000-000000000001','COLAB-CONC-047-1',80),('5c47f000-0000-4000-8000-000000000002','COLAB-CONC-047-2',80) on conflict do nothing;
insert into public.employee_cost_terms(employee_id,valid_from,daily_cost,active,origin,reason)
  select id,'2026-01-01',80,true,'informada','Fixture sintética concorrência' from public.employees where name like 'COLAB-CONC-047-%'
  and not exists (select 1 from public.employee_cost_terms t where t.employee_id = employees.id);
insert into public.clients(id,name) select ('5c47c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'CLIENTE-CONC-047-'||n from generate_series(1,$((RODADAS*3))) n on conflict do nothing;
SQL
[ $? -eq 0 ] || { echo "falha ao preparar fixtures"; exit 3; }

sql_adicional() { printf "select public.registrar_adicional_idempotente(gen_random_uuid(),'%s'::uuid,'2026-02-01','2026-02-15','Adicional de corrida',100.00)::text;" "$(cli "$1")"; }
sql_container() { printf "select public.registrar_servico_container(jsonb_build_object('clienteId','%s','operacaoId',null,'solicitadoEm','2026-02-02','executadoEm','2026-02-03','descricao','Container de corrida','quantidade',1,'receitaCentavos',10000,'custoTotalCentavos',2000,'referencia','CONC-047','modalidadeCusto','total_distribuido','competenciaCobranca',null,'participantes',jsonb_build_array(jsonb_build_object('colaboradorId','5c47f000-0000-4000-8000-000000000001','custoCentavos',1000),jsonb_build_object('colaboradorId','5c47f000-0000-4000-8000-000000000002','custoCentavos',1000))),gen_random_uuid(),'corrida 047')::text;" "$(cli "$1")"; }
sql_fatura() { printf "select (public.gerar_fatura('%s'::uuid,'2026-02-01','2026-02-15')).id::text;" "$(cli "$1")"; }

correr() { # rótulo  comando-A  comando-B   -> escreve $T/A.rc/.out e $T/B.rc/.out
  ( sleep "0.0$((RANDOM % 5))"; psql_ -c "$2" >"$T/A.out" 2>"$T/A.err"; echo $? >"$T/A.rc" ) &
  ( sleep "0.0$((RANDOM % 5))"; psql_ -c "$3" >"$T/B.out" 2>"$T/B.err"; echo $? >"$T/B.rc" ) &
  wait
}

vitorias_f=0; vitorias_c=0
echo "R1  gerar_fatura × cancelar_adicional ($RODADAS rodadas)"
for r in $(seq 1 "$RODADAS"); do
  c=$r
  adic=$(psql_ -c "$(adm "$(sql_adicional "$c")")" | tail -1)
  correr R1 "$(adm "$(sql_fatura "$c")")" "$(adm "select public.cancelar_adicional('$adic'::uuid,'corrida')::text;")"
  rcA=$(cat "$T/A.rc"); rcB=$(cat "$T/B.rc")
  eq "R1 rodada $r: exatamente uma das operações vence" "$(( (rcA==0) + (rcB==0) ))" "1"
  est=$(psql_ -c "select (a.invoice_id is not null)::int||'|'||(a.canceled_at is not null)::int||'|'||(select count(*) from public.invoices where client_id='$(cli "$c")')||'|'||coalesce((select sum(amount)::text from public.invoice_items it join public.invoices i on i.id=it.invoice_id where i.client_id='$(cli "$c")'),'0') from public.billing_additionals a where a.id='$adic'")
  if [ "$rcA" = 0 ]; then vitorias_f=$((vitorias_f+1)); eq "R1 rodada $r: fatura venceu => faturado, não cancelado, 1 fatura, itens 100.00" "$est" "1|0|1|100.00"
  else vitorias_c=$((vitorias_c+1)); eq "R1 rodada $r: cancelamento venceu => cancelado, sem fatura, sem itens" "$est" "0|1|0|0"; fi
done
echo "    fatura venceu $vitorias_f vez(es); cancelamento venceu $vitorias_c"

vitorias_f=0; vitorias_c=0
echo "R2  gerar_fatura × cancelar_servico_container ($RODADAS rodadas)"
for r in $(seq 1 "$RODADAS"); do
  c=$((RODADAS + r))
  srv=$(psql_ -c "$(dono "$(sql_container "$c")")" | tail -1)
  correr R2 "$(adm "$(sql_fatura "$c")")" "$(adm "select public.cancelar_servico_container('$srv'::uuid,'corrida')::text;")"
  rcA=$(cat "$T/A.rc"); rcB=$(cat "$T/B.rc")
  eq "R2 rodada $r: exatamente uma das operações vence" "$(( (rcA==0) + (rcB==0) ))" "1"
  est=$(psql_ -c "select (a.invoice_id is not null)::int||'|'||(s.canceled_at is not null)::int||'|'||(a.canceled_at is not null)::int||'|'||(select count(*) from public.invoices where client_id='$(cli "$c")') from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id where s.id='$srv'")
  if [ "$rcA" = 0 ]; then vitorias_f=$((vitorias_f+1)); eq "R2 rodada $r: fatura venceu => faturado, serviço e adicional não cancelados, 1 fatura" "$est" "1|0|0|1"
  else vitorias_c=$((vitorias_c+1)); eq "R2 rodada $r: cancelamento venceu => serviço e adicional cancelados, sem fatura" "$est" "0|1|1|0"; fi
done
echo "    fatura venceu $vitorias_f vez(es); cancelamento venceu $vitorias_c"

echo "R3  gerar_fatura × gerar_fatura, mesmo cliente e período ($RODADAS rodadas)"
for r in $(seq 1 "$RODADAS"); do
  c=$((2*RODADAS + r))
  psql_ -c "$(adm "$(sql_adicional "$c")")" >/dev/null
  correr R3 "$(adm "$(sql_fatura "$c")")" "$(adm "$(sql_fatura "$c")")"
  rcA=$(cat "$T/A.rc"); rcB=$(cat "$T/B.rc")
  eq "R3 rodada $r: exatamente uma geração vence" "$(( (rcA==0) + (rcB==0) ))" "1"
  est=$(psql_ -c "select (select count(*) from public.invoices where client_id='$(cli "$c")')||'|'||(select sum(total_amount) from public.invoices where client_id='$(cli "$c")')||'|'||(select count(*) from public.invoice_items it join public.invoices i on i.id=it.invoice_id where i.client_id='$(cli "$c")')")
  eq "R3 rodada $r: uma única fatura, cobrada uma só vez (100.00, 1 item)" "$est" "1|100.00|1"
done

echo "Pós-corrida: todas as faturas geradas estão imutáveis (guarda de 046) e consistentes"
imut=$(psql_ -c "select count(*) from public.invoices i where i.client_id::text like '5c47c000-%' and (select count(*) from public.billing_additionals a where a.invoice_id=i.id) > 0")
total=$(psql_ -c "select count(*) from public.invoices i where i.client_id::text like '5c47c000-%'")
eq "toda fatura da corrida tem adicional vinculado" "$imut" "$total"
edit=$(psql_ -c "do \$x\$ declare n int := 0; r record; begin for r in select id from public.invoices where client_id::text like '5c47c000-%' loop begin update public.invoices set total_amount = total_amount + 1 where id = r.id; n := n + 1; exception when sqlstate '42501' then null; end; end loop; if n > 0 then raise exception 'faturas editaveis: %', n; end if; end \$x\$;" 2>&1; echo $?)
eq "nenhuma fatura da corrida é editável (nível do gatilho)" "$(echo "$edit" | tail -1)" "0"
dup=$(psql_ -c "select count(*) from (select a.id from public.billing_additionals a where a.invoice_id is not null group by a.id having count(*) > 1) x")
eq "nenhum adicional vinculado mais de uma vez" "$dup" "0"
inc=$(psql_ -c "select count(*) from public.billing_additionals a where a.invoice_id is not null and a.canceled_at is not null")
eq "nenhum adicional faturado e cancelado ao mesmo tempo" "$inc" "0"
soma=$(psql_ -c "select count(*) from public.invoices i where i.client_id::text like '5c47c000-%' and i.total_amount <> (select coalesce(sum(amount),0) from public.invoice_items it where it.invoice_id=i.id)")
eq "soma dos itens = total em todas as faturas" "$soma" "0"

echo
echo "Resumo: $PASS PASS, $FAIL FAIL"
[ "$FAIL" -eq 0 ]
