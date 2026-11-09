#!/usr/bin/env bash
# FIN-20D — concorrência da idempotência de `registrar_adicional_idempotente`, com sessões reais.
#
# SOMENTE Supabase LOCAL descartável (docker exec no container supabase_db_<project_id>; nenhuma rede).
# Os dados são CONFIRMADOS (COMMIT) porque a corrida precisa de transações simultâneas, e a fatura emitida é
# imutável: rode em banco recém-resetado e descarte depois.
#
# Corridas (RODADAS vezes cada):
#   R1  N chamadas SIMULTÂNEAS, mesma chave e mesmo payload (duplo clique / retry em paralelo);
#   R2  N chamadas simultâneas, mesma chave, DOIS payloads diferentes (valores 100,00 e 101,00);
#   R3  mesma chave usada por DOIS clientes diferentes ao mesmo tempo;
#   R4  registro idempotente (3 chamadas iguais) × gerar_fatura do mesmo cliente.
# Invariantes: exatamente UMA linha por chave; todo sucesso devolve o MESMO id; o perdedor leva 23505 (nunca
# uma segunda linha); uma trilha de auditoria por linha; adicional vinculado a no máximo uma fatura; soma dos
# itens = total; replay depois de faturado devolve o mesmo id e não mexe na fatura.
#
# Uso: scripts/testar-concorrencia-adicional.sh [project_id-do-stack-local] [rodadas]
set -uo pipefail

PROJECT_ID="${1:-}"
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(grep -E '^project_id' "$(dirname "$0")/../supabase/config.toml" | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
fi
RODADAS="${2:-6}"
CONTAINER="supabase_db_${PROJECT_ID}"
if [ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "Container local $CONTAINER não está rodando. Este script só usa Supabase local." >&2
  exit 2
fi
T=$(mktemp -d "${TMPDIR:-/tmp}/conc-adicional.XXXXXX"); trap 'rm -rf "$T"' EXIT
psql_() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }
CLAIMS='{"sub":"5c480000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1","session_id":"ec480000-0000-4000-8000-0000000000a1"}'
adm() { printf "begin; select set_config('request.jwt.claims','%s',true); set local role authenticated; %s commit;" "$CLAIMS" "$1"; }
cli() { printf '5c48c000-0000-4000-8000-%012d' "$1"; }
chave() { printf '5c48d000-0000-4000-8000-%012d' "$1"; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
eq()  { if [ "$2" = "$3" ]; then ok; else bad "$1: esperado [$3], obtido [$2]"; fi; }

echo "Preparando fixtures (commit) em $CONTAINER..."
psql_ <<SQL
insert into auth.users(id) values ('5c480000-0000-4000-8000-0000000000a1') on conflict do nothing;
insert into auth.sessions(id,user_id,not_after) values ('ec480000-0000-4000-8000-0000000000a1','5c480000-0000-4000-8000-0000000000a1',null) on conflict do nothing;
insert into public.user_roles(user_id,role) values ('5c480000-0000-4000-8000-0000000000a1','admin') on conflict do nothing;
insert into public.clients(id,name) select ('5c48c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'CLIENTE-CONC-048-'||n from generate_series(1,$((RODADAS*5))) n on conflict do nothing;
SQL
[ $? -eq 0 ] || { echo "falha ao preparar fixtures"; exit 3; }

reg() { # chave cliente valor
  printf "select public.registrar_adicional_idempotente('%s'::uuid,'%s'::uuid,'2026-02-01','2026-02-15','Adicional de corrida 048',%s)::text;" "$(chave "$1")" "$(cli "$2")" "$3"
}
fat() { printf "select (public.gerar_fatura('%s'::uuid,'2026-02-01','2026-02-15')).id::text;" "$(cli "$1")"; }

# Lança N comandos em paralelo (atraso aleatório curto) e espera todos. Saída em $T/<i>.out/.rc/.err
paralelo() {
  local i=0
  for cmd in "$@"; do
    i=$((i+1))
    ( sleep "0.0$((RANDOM % 4))"; psql_ -c "$cmd" >"$T/$i.out" 2>"$T/$i.err"; echo $? >"$T/$i.rc" ) &
  done
  wait
}
saida() { tail -1 "$T/$1.out" 2>/dev/null; }

echo "R1  N chamadas simultâneas, mesma chave e mesmo payload ($RODADAS rodadas × 6)"
for r in $(seq 1 "$RODADAS"); do
  k=$r; c=$r; rm -f "$T"/*.rc "$T"/*.out "$T"/*.err
  paralelo "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 100.00)")" \
           "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 100.00)")"
  sucessos=0; ids=""
  for i in 1 2 3 4 5 6; do [ "$(cat "$T/$i.rc")" = 0 ] && { sucessos=$((sucessos+1)); ids="$ids $(saida $i)"; }; done
  eq "R1 rodada $r: as 6 chamadas têm sucesso" "$sucessos" "6"
  eq "R1 rodada $r: todas devolvem o MESMO id" "$(echo $ids | tr ' ' '\n' | sort -u | wc -l | tr -d ' ')" "1"
  eq "R1 rodada $r: exatamente 1 linha para a chave" "$(psql_ -c "select count(*) from public.billing_additionals where idempotency_key='$(chave $k)'")" "1"
  eq "R1 rodada $r: o cliente tem 1 adicional de 100.00 (não 600.00)" "$(psql_ -c "select count(*)||'|'||sum(amount) from public.billing_additionals where client_id='$(cli $c)'")" "1|100.00"
  eq "R1 rodada $r: 1 evento de auditoria de registro" "$(psql_ -c "select count(*) from public.financial_terms_audit t join public.billing_additionals a on a.id=t.entity_id where t.action='adicional_registrado' and a.idempotency_key='$(chave $k)'")" "1"
done

echo "R2  mesma chave, dois payloads divergentes em paralelo ($RODADAS rodadas × 6)"
for r in $(seq 1 "$RODADAS"); do
  k=$((RODADAS + r)); c=$((RODADAS + r)); rm -f "$T"/*.rc "$T"/*.out "$T"/*.err
  paralelo "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 101.00)")" "$(adm "$(reg $k $c 100.00)")" \
           "$(adm "$(reg $k $c 101.00)")" "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 101.00)")"
  linhas=$(psql_ -c "select count(*) from public.billing_additionals where idempotency_key='$(chave $k)'")
  vencedor=$(psql_ -c "select amount from public.billing_additionals where idempotency_key='$(chave $k)'")
  vid=$(psql_ -c "select id from public.billing_additionals where idempotency_key='$(chave $k)'")
  eq "R2 rodada $r: exatamente 1 linha para a chave" "$linhas" "1"
  ok_certo=1
  for i in 1 2 3 4 5 6; do
    if [ $((i % 2)) -eq 1 ]; then valor="100.00"; else valor="101.00"; fi
    if [ "$(cat "$T/$i.rc")" = 0 ]; then
      { [ "$valor" = "$vencedor" ] && [ "$(saida $i)" = "$vid" ]; } || ok_certo=0
    else
      grep -q "23505\|Chave de idempot" "$T/$i.err" && [ "$valor" != "$vencedor" ] || ok_certo=0
    fi
  done
  eq "R2 rodada $r: quem tem o payload do vencedor recebe o MESMO id; o outro leva 23505" "$ok_certo" "1"
  eq "R2 rodada $r: 1 evento de auditoria de registro" "$(psql_ -c "select count(*) from public.financial_terms_audit t where t.action='adicional_registrado' and t.entity_id='$vid'")" "1"
done

echo "R3  mesma chave usada por DOIS clientes ao mesmo tempo ($RODADAS rodadas)"
for r in $(seq 1 "$RODADAS"); do
  k=$((2*RODADAS + r)); c1=$((2*RODADAS + r)); c2=$((3*RODADAS + r)); rm -f "$T"/*.rc "$T"/*.out "$T"/*.err
  paralelo "$(adm "$(reg $k $c1 100.00)")" "$(adm "$(reg $k $c2 100.00)")"
  eq "R3 rodada $r: exatamente 1 linha para a chave" "$(psql_ -c "select count(*) from public.billing_additionals where idempotency_key='$(chave $k)'")" "1"
  eq "R3 rodada $r: exatamente um dos clientes vence" "$(( ($(cat "$T/1.rc")==0) + ($(cat "$T/2.rc")==0) ))" "1"
  perdedor=1; [ "$(cat "$T/1.rc")" = 0 ] && perdedor=2
  grep -q "23505\|Chave de idempot" "$T/$perdedor.err"; eq "R3 rodada $r: o perdedor recebe 23505 (não duplica)" "$?" "0"
done

echo "R4  registro idempotente (3 iguais) × gerar_fatura do mesmo cliente ($RODADAS rodadas)"
for r in $(seq 1 "$RODADAS"); do
  k=$((4*RODADAS + r)); c=$((4*RODADAS + r)); k0=$((100 + r)); rm -f "$T"/*.rc "$T"/*.out "$T"/*.err
  psql_ -c "$(adm "$(reg $k0 $c 50.00)")" >/dev/null   # já existe 1 adicional elegível para a fatura
  paralelo "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 100.00)")" "$(adm "$(reg $k $c 100.00)")" "$(adm "$(fat $c)")"
  eq "R4 rodada $r: exatamente 1 linha para a chave" "$(psql_ -c "select count(*) from public.billing_additionals where idempotency_key='$(chave $k)'")" "1"
  for i in 1 2 3; do eq "R4 rodada $r: chamada $i do registro tem sucesso" "$(cat "$T/$i.rc")" "0"; done
  eq "R4 rodada $r: a fatura saiu" "$(cat "$T/4.rc")" "0"
  eq "R4 rodada $r: nenhum adicional em mais de uma fatura / sem lastro duplicado" "$(psql_ -c "select count(*) from (select id from public.billing_additionals where client_id='$(cli $c)' and invoice_id is not null group by id having count(*)>1) x")" "0"
  eq "R4 rodada $r: soma dos itens = total da fatura" "$(psql_ -c "select count(*) from public.invoices i where i.client_id='$(cli $c)' and i.total_amount <> (select coalesce(sum(amount),0) from public.invoice_items it where it.invoice_id=i.id)")" "0"
  total=$(psql_ -c "select coalesce(sum(total_amount),0) from public.invoices where client_id='$(cli $c)'")
  novo=$(psql_ -c "select (invoice_id is not null)::int from public.billing_additionals where idempotency_key='$(chave $k)'")
  if [ "$novo" = 1 ]; then eq "R4 rodada $r: o adicional novo entrou na fatura (50 + 100)" "$total" "150.00"; else eq "R4 rodada $r: o adicional novo ficou para a próxima fatura (só os 50)" "$total" "50.00"; fi
  # replay depois (a fatura pode já existir): mesmo id, sem nova linha, fatura inalterada
  vid=$(psql_ -c "select id from public.billing_additionals where idempotency_key='$(chave $k)'")
  eq "R4 rodada $r: replay devolve o mesmo id" "$(psql_ -c "$(adm "$(reg $k $c 100.00)")" | tail -1)" "$vid"
  eq "R4 rodada $r: replay não criou linha nem mexeu na fatura" "$(psql_ -c "select count(*)||'|'||coalesce((select sum(total_amount) from public.invoices where client_id='$(cli $c)'),0) from public.billing_additionals where idempotency_key='$(chave $k)'")" "1|$total"
done

echo "Pós-corrida: nenhuma chave repetida; todo adicional idempotente tem 1 evento de auditoria"
eq "nenhuma chave de idempotência repetida" "$(psql_ -c "select count(*) from (select idempotency_key from public.billing_additionals where idempotency_key is not null group by 1 having count(*)>1) x")" "0"
eq "cada adicional idempotente tem exatamente 1 evento de auditoria" "$(psql_ -c "select count(*) from public.billing_additionals a where a.idempotency_key is not null and (select count(*) from public.financial_terms_audit t where t.action='adicional_registrado' and t.entity_id=a.id) <> 1")" "0"

echo
echo "Resumo: $PASS PASS, $FAIL FAIL"
[ "$FAIL" -eq 0 ]
