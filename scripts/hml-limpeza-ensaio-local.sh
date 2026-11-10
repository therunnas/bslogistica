#!/usr/bin/env bash
# Ensaio LOCAL do expurgo de dados sintéticos do HML (docs/runbooks/limpeza-hml-sintetico.sql).
#
# Roda SOMENTE contra um Supabase local isolado (127.0.0.1) que este script reinicia e
# repovoa a partir do backup cifrado. Nunca se conecta ao HML nem a Production.
# Resultado: lista PASS/FAIL de cada verificação; sai com código != 0 se alguma falhar.
#
# Versão 050 (10/11/2026): expectativas da 050 (55 migrations, head 20261117120000) e teste C1b
# (raiz com prefixo sintético fora do inventário). Exige um backup NOVO do HML na 050; o backup
# de 06/11/2026 é da 045 e o preflight 050 o recusa. Ainda NÃO executado nesta versão.
#
# Uso: scripts/hml-limpeza-ensaio-local.sh <pasta-do-backup> <diretório-do-stack-local> [porta]
#   <diretório-do-stack-local>: o --workdir do `supabase start` do ensaio (project_id e portas próprios).
# Requer: psql, python3, supabase CLI, Docker, stack local já iniciado.
set -uo pipefail

BACKUP_DIR="${1:?informe a pasta do backup}"
WORKDIR="${2:?informe o --workdir do stack local}"
PORT="${3:-58322}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$REPO/docs/runbooks/limpeza-hml-sintetico.sql"
FPSQL="$REPO/docs/runbooks/hml-impressao-digital.sql"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/ensaio-limpeza.XXXXXX")"
chmod 700 "$OUT"
trap 'rm -rf "$OUT"' EXIT
export PGPASSWORD=postgres

if [[ "$PORT" != 5[0-9][0-9][0-9][0-9] ]]; then echo "Porta inesperada: $PORT" >&2; exit 2; fi
P=(psql -X -q -At -h 127.0.0.1 -p "$PORT" -U postgres -d postgres)
PA=(psql -X -q -At -h 127.0.0.1 -p "$PORT" -U supabase_admin -d postgres)

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

fp() { "${P[@]}" -f "$FPSQL" | grep -v '^BEGIN$\|^COMMIT$' >"$OUT/$1.json"; }
# Compara duas impressões digitais ignorando as chaves em $3.. (lista separada por vírgula, caminho com ponto).
mesmo() { python3 - "$OUT/$1.json" "$OUT/$2.json" "${3:-}" <<'PY'
import json, sys
def flat(d, p=""):
    o = {}
    for k, v in d.items():
        o.update(flat(v, p + k + ".") if isinstance(v, dict) else {p + k: v})
    return o
a = flat(json.load(open(sys.argv[1]))); b = flat(json.load(open(sys.argv[2])))
ign = set(filter(None, sys.argv[3].split(",")))
dif = [k for k in sorted(set(a) | set(b)) if k not in ign and not any(k.startswith(i + ".") for i in ign) and a.get(k) != b.get(k)]
if dif: print("diferencas:", ", ".join(dif)); sys.exit(1)
PY
}
contagem() { python3 -c "import json;print(json.load(open('$OUT/$1.json'))['contagem_public']['$2'])"; }
sim() { sed "s/set_config('bs_limpeza.executar', 'NAO', true)/set_config('bs_limpeza.executar', 'SIM', true)/" "$SQL" >"$OUT/sim.sql"; }
rodar() { "${P[@]}" -v ON_ERROR_STOP=1 -f "$1" >"$OUT/run.out" 2>"$OUT/run.err"; }
# Teste negativo: o script TEM de abortar. Se concluir, o estado do ensaio ficou comprometido: para tudo.
deve_abortar() { # nome  padrão-esperado-em-stderr
  if [ "$rc" -eq 0 ]; then bad "$1: executou quando devia abortar"; echo "Ensaio interrompido: estado comprometido."; exit 5; fi
  if grep -q "$2" "$OUT/run.err"; then ok "$1 (aborta: $(erro1 | cut -c1-170))"; else bad "$1: abortou por outro motivo: $(erro1)"; fi
}
erro1() { grep -h 'ERROR:' "$OUT/run.err" | head -1 | sed -E 's/^psql:[^ ]+ //' | cut -c1-200; }
reiniciar() {
  (cd "$WORKDIR" && env -u SUPABASE_ACCESS_TOKEN supabase db reset --local --workdir "$WORKDIR" --yes >/dev/null 2>&1) || { echo "falha ao reiniciar o stack local"; exit 4; }
  "$REPO/scripts/hml-restaurar-local.sh" "$BACKUP_DIR" "$PORT" >"$OUT/restauro.log" 2>&1 || { echo "falha na restauração"; cat "$OUT/restauro.log"; exit 4; }
}
LIMPAR="container_service_participants container_service_audit container_services billing_additionals invoice_items invoices timesheet_entries timesheets operation_team user_operation_access operation_location_terms operation_terms shifts operations contract_employee_rates contract_rate_terms contract_terms contracts employee_cost_terms employees clients financial_holidays financial_calendar_coverage"

echo "== A. Restauração limpa e cópia isolada"
reiniciar
check "stack local isolado: porta $PORT, project_id do ensaio" "docker ps --format '{{.Names}} {{.Ports}}' | grep -q 'supabase_db_bs-hml-ensaio-20b.*:$PORT->'"
fp base
check "cópia restaurada: 31 tabelas, contas presentes, migrations 55 / head 050" "python3 -c \"import json;d=json.load(open('$OUT/base.json'));assert d['catalogo']['tabelas']==31 and d['auth']['users']>=1 and d['migrations']['total']==55 and d['migrations']['head']=='20261117120000'\""
check "gatilho legado de cálculo está desabilitado na origem (1 desabilitado)" "[ \"\$(\"\${P[@]}\" -c \"select count(*) from pg_trigger where tgname='trg_timesheet_entries_calculo_financeiro' and tgenabled='D'\")\" = 1 ]"

echo "== B. Ensaio a seco (modo padrão NAO): não pode alterar nada"
rodar "$SQL"; rc=$?
check "a seco: executa e conclui (preflight + validação)" "[ $rc -eq 0 ] && grep -q 'ENSAIO A SECO' '$OUT/run.out'"
fp seco
check "a seco: impressão digital idêntica (inclui as contagens de todas as tabelas)" "mesmo base seco"

echo "== C. Testes negativos (cada um deve ABORTAR sem alterar nada)"
sim
# C1 dado real misturado
"${P[@]}" -c "insert into public.clients(name) values ('Cliente Real LTDA')" >/dev/null 2>&1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C1 cliente fora dos prefixos sintéticos" 'origem sintetica: clients'
"${P[@]}" -c "delete from public.clients where name='Cliente Real LTDA'" >/dev/null 2>&1
fp c1; check "C1 nada foi alterado (dado injetado removido, resto igual)" "mesmo base c1"
# C1b raiz com prefixo sintético, mas fora do inventário de 10/11/2026 (nome parecido não basta)
"${P[@]}" -c "insert into public.clients(name) values ('HOMOLOG-SINT-NAO-INVENTARIADO')" >/dev/null 2>&1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C1b cliente HOMOLOG-SINT fora do inventário" 'raizes: clientes'
"${P[@]}" -c "delete from public.clients where name='HOMOLOG-SINT-NAO-INVENTARIADO'" >/dev/null 2>&1
fp c1b; check "C1b nada foi alterado (dado injetado removido, resto igual)" "mesmo base c1b"
# C2 ambiente errado (conjunto de migrations diferente)
"${P[@]}" -c "insert into supabase_migrations.schema_migrations(version, name) values ('99999999999999','x')" >/dev/null 2>&1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C2 migrations diferentes do HML 050" 'ambiente: migrations'
"${P[@]}" -c "delete from supabase_migrations.schema_migrations where version='99999999999999'" >/dev/null 2>&1
# C3 tabela nova não classificada
"${P[@]}" -c "create table public.zz_nova_tabela(id int)" >/dev/null 2>&1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C3 tabela nova não classificada" 'catalogo: 31 tabelas'
"${P[@]}" -c "drop table public.zz_nova_tabela" >/dev/null 2>&1
# C4 concorrência: outra sessão segura uma trava
( "${P[@]}" -c "begin; lock table public.clients in access share mode; select pg_sleep(18); commit;" >/dev/null 2>&1 & )
sleep 2
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C4 tabela em uso por outra sessão" 'lock timeout'
sleep 18
# C5 falha na validação final (alteração indevida em tabela preservada) => rollback total
python3 - "$OUT/sim.sql" "$OUT/falha.sql" <<'PY'
import sys
t = open(sys.argv[1]).read()
marca = "-- 5. Validação integral"
inj = "UPDATE public.profiles SET full_name = coalesce(full_name, '') || 'x' WHERE id = (SELECT id FROM public.profiles ORDER BY id LIMIT 1);\n\n"
assert marca in t
open(sys.argv[2], "w").write(t.replace(marca, inj + marca, 1))
PY
rodar "$OUT/falha.sql"; rc=$?
deve_abortar "C5 tabela preservada alterada durante a execução" 'validacao final'
fp c5
check "C5 rollback total: dados, gatilhos e catálogo idênticos ao início" "mesmo base c5"
check "C5 gatilhos voltaram ao estado original (1 desabilitado, o legado)" "[ \"\$(\"\${P[@]}\" -c \"select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and t.tgenabled<>'O'\")\" = 1 ]"

echo "== D. Execução real na cópia (bs_limpeza.executar = SIM)"
rodar "$OUT/sim.sql"; rc=$?
check "D1 expurgo concluído (COMMIT) sem erro: $(erro1)" "[ $rc -eq 0 ] && grep -q 'EXECUTADO' '$OUT/run.out'"
fp pos
# D2 contagens esperadas
ok_cont=1
for t in $LIMPAR; do [ "$(contagem pos "$t")" = 0 ] || { ok_cont=0; echo "     contagem inesperada em $t: $(contagem pos "$t")"; }; done
check "D2 as 23 tabelas de negócio/calendário estão com 0 linhas" "[ $ok_cont -eq 1 ]"
check "D3 financial_terms_audit ficou só com 'sistema' (7)" "[ \"\$(contagem pos financial_terms_audit)\" = 7 ]"
check "D4 municipality_catalog ficou só com o oficial (1: Navegantes)" "[ \"\$(contagem pos municipality_catalog)\" = 1 ]"
check "D5 job_functions ficou só com as 4 padrão" "[ \"\$(contagem pos job_functions)\" = 4 ]"
check "D6 preservados com a MESMA contagem da cópia antes do expurgo (profiles, user_roles, admin_audit_log, motor 1, tarifas 1)" "[ \"\$(contagem pos profiles)-\$(contagem pos user_roles)-\$(contagem pos admin_audit_log)-\$(contagem pos financial_engine_settings)-\$(contagem pos pricing_settings)\" = \"\$(contagem base profiles)-\$(contagem base user_roles)-\$(contagem base admin_audit_log)-1-1\" ]"
# D7 impressão digital independente: só mudam as contagens e os hashes de catálogos parciais
check "D7 Auth, migrations, RLS, grants, funções, gatilhos, políticas, índices e restrições idênticos (impressão digital independente)" "mesmo base pos contagem_public,configuracao.funcoes_md5,configuracao.municipios_md5"
check "D8 Auth intacto: mesmas contas, identidades, fatores MFA e IDs da cópia antes do expurgo" "mesmo base pos contagem_public,configuracao,catalogo,migrations,identidade_public,extensoes"
check "D9 perfis e papéis idênticos (md5)" "mesmo base pos contagem_public,configuracao,catalogo,migrations,auth,extensoes"
check "D10 gatilho legado continua desabilitado (e só ele)" "[ \"\$(\"\${P[@]}\" -c \"select string_agg(tgname,',') from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and t.tgenabled<>'O'\")\" = trg_timesheet_entries_calculo_financeiro ]"

echo "== E. As proteções voltaram a valer nas tabelas esvaziadas"
"${P[@]}" -c "truncate public.financial_holidays" >/dev/null 2>"$OUT/e1.err"; check "E1 TRUNCATE em financial_holidays (vazia) é recusado" "grep -q 'ERROR' '$OUT/e1.err'"
"${P[@]}" -c "truncate public.financial_terms_audit" >/dev/null 2>"$OUT/e2.err"; check "E2 TRUNCATE na trilha de condições é recusado" "grep -q 'ERROR' '$OUT/e2.err'"
"${P[@]}" -c "delete from public.job_functions where code='operador'" >/dev/null 2>"$OUT/e3.err"; check "E3 DELETE de função-padrão é recusado" "grep -q 'ERROR' '$OUT/e3.err'"
"${P[@]}" -c "delete from public.financial_terms_audit" >/dev/null 2>"$OUT/e4.err"; check "E4 DELETE na trilha de condições é recusado" "grep -q 'ERROR' '$OUT/e4.err'"

echo "== F. Segunda execução (alvo já limpo) deve abortar"
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "F1 reexecução em alvo já limpo (assinatura do HML ausente)" 'assinatura sint'
fp f; check "F1 nada mudou na reexecução" "mesmo pos f"

echo "== G. Mesmo script enviado como UMA ÚNICA consulta (semântica da API de gerenciamento usada por supabase db query --linked)"
reiniciar
fp base2
cli() { "${P[@]}" -v ON_ERROR_STOP=1 -c "$(cat "$1")" >"$OUT/cli.out" 2>"$OUT/cli.err"; }
cli "$SQL"; rc=$?
check "G1 a seco em consulta única: conclui e informa ENSAIO A SECO" "[ $rc -eq 0 ] && grep -q 'ENSAIO A SECO' '$OUT/cli.out'"
fp seco2; check "G1 a seco em consulta única: nada alterado" "mesmo base2 seco2"
cli "$OUT/sim.sql"; rc=$?
check "G2 execução real em consulta única: conclui e informa EXECUTADO" "[ $rc -eq 0 ] && grep -q 'EXECUTADO' '$OUT/cli.out'"
fp pos2
check "G3 resultado idêntico ao resultado por psql (impressão digital completa)" "mesmo pos pos2"
check "G4 o relatório traz verificações e contagens antes/depois" "grep -q 'reprovadas' '$OUT/cli.out' && grep -q 'contagens_antes' '$OUT/cli.out' && grep -q 'contagens_depois' '$OUT/cli.out'"
cli "$OUT/sim.sql"; rc=$?
check "G5 reexecução em consulta única aborta (alvo já limpo)" "[ $rc -ne 0 ] && grep -qi 'abortada' '$OUT/cli.err'"

echo
echo "Resumo: $PASS PASS, $FAIL FAIL"
[ "$FAIL" -eq 0 ]
