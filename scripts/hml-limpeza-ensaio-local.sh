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
# Correção de 10/11/2026 (sessão 02):
#   - todo preparo de teste negativo (inserir, criar, travar) e toda limpeza dele são conferidos
#     pela saída exata; preparo não comprovado INTERROMPE o ensaio (exit 6), nunca vira PASS;
#   - C1c: feriado legado de nome desconhecido com legal_act NULL tem de ser recusado;
#   - a restauração só vale se o log não tiver erro fora da lista aceita e se a impressão digital
#     da cópia for igual à do HML tirada junto com o backup (exceto as diferenças documentadas).
#
# Correção de 10/11/2026 (sessão 03): IDENTIDADE DO DESTINO ANTES DE QUALQUER COMANDO DESTRUTIVO.
#   verificar_destino() roda no início, antes de cada `supabase db reset` (dentro de reiniciar(),
#   inclusive na etapa G), de novo depois do reset e antes da restauração, e antes das seções C e D.
#   Exige, todos juntos (a porta sozinha não prova nada): project_id ÚNICO e igual ao do ensaio no
#   config.toml do workdir, [db] port igual à porta, nenhum SUPABASE_PROJECT_ID no ambiente ou nos
#   .env do workdir, o container supabase_db_<project_id> rodando com o rótulo do projeto, publicando
#   a 5432 só nessa porta e sendo o ÚNICO que publica a porta, `supabase status` do workdir com o
#   banco em 127.0.0.1:<porta> e o servidor que responde em 127.0.0.1:<porta> com o IP desse
#   container. Qualquer divergência ENCERRA na hora (exit 7), sem reset, restauração ou escrita.
#
# Uso: KEYCHAIN_ITEM=<item-do-backup-050> \
#      scripts/hml-limpeza-ensaio-local.sh <pasta-do-backup> <diretório-do-stack-local> [porta] [impressão-do-HML]
#   <diretório-do-stack-local>: o --workdir do `supabase start` do ensaio (project_id e portas próprios).
#   [impressão-do-HML]: saída de docs/runbooks/hml-impressao-digital.sql no HML, tirada junto com o
#     dump (padrão: <pasta-do-backup>/impressao-digital-hml.json). Sem ela, o ensaio não começa.
# Requer: psql, python3, supabase CLI, Docker, stack local já iniciado.
set -uo pipefail

BACKUP_DIR="${1:?informe a pasta do backup}"
WORKDIR="${2:?informe o --workdir do stack local}"
PORT="${3:-58322}"
ORIGEM_FP="${4:-$BACKUP_DIR/impressao-digital-hml.json}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$REPO/docs/runbooks/limpeza-hml-sintetico.sql"
FPSQL="$REPO/docs/runbooks/hml-impressao-digital.sql"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/ensaio-limpeza.XXXXXX")"
chmod 700 "$OUT"
trap 'rm -rf "$OUT"' EXIT
export PGPASSWORD=postgres

if [[ "$PORT" != 5[0-9][0-9][0-9][0-9] ]]; then echo "Porta inesperada: $PORT" >&2; exit 2; fi
if [ ! -s "$ORIGEM_FP" ]; then echo "Impressão digital do HML ausente: $ORIGEM_FP" >&2; exit 2; fi
cp "$ORIGEM_FP" "$OUT/origem.json"
P=(psql -X -q -At -h 127.0.0.1 -p "$PORT" -U postgres -d postgres)
PA=(psql -X -q -At -h 127.0.0.1 -p "$PORT" -U supabase_admin -d postgres)

# Identidade do único destino aceito. Constantes de propósito: não vêm de argumento nem de ambiente.
ENSAIO_PROJECT_ID="bs-hml-ensaio-20b"
ENSAIO_CONTAINER="supabase_db_$ENSAIO_PROJECT_ID"
# A CLI dá precedência a SUPABASE_PROJECT_ID sobre o config.toml: nunca herdar do ambiente.
SB=(env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_ID -u SUPABASE_DB_PASSWORD supabase)

# Destino errado é fatal, nunca um FAIL acumulado: encerra antes de qualquer comando destrutivo.
recusar_destino() { # motivo
  echo "DESTINO RECUSADO ($DESTINO_MOMENTO): $1" >&2
  echo "Nada foi resetado, restaurado ou escrito a partir deste ponto. Resumo parcial: ${PASS:-0} PASS, ${FAIL:-0} FAIL" >&2
  exit 7
}
verificar_destino() { # momento
  DESTINO_MOMENTO="$1"
  local cfg="$WORKDIR/supabase/config.toml" n pid porta_cfg arq rodando rotulo mapa nomes status ips ipdb
  [[ "$PORT" == 5[0-9][0-9][0-9][0-9] ]] || recusar_destino "porta fora da faixa do ensaio: $PORT"
  [ -f "$cfg" ] || recusar_destino "workdir sem supabase/config.toml: $WORKDIR"
  n=$(grep -cE '^[[:space:]]*project_id[[:space:]]*=' "$cfg")
  [ "$n" = 1 ] || recusar_destino "config.toml com $n linhas project_id (esperada 1)"
  pid=$(sed -nE 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"([^"]*)"[[:space:]]*(#.*)?$/\1/p' "$cfg")
  [ "$pid" = "$ENSAIO_PROJECT_ID" ] || recusar_destino "project_id do workdir é '$pid', não '$ENSAIO_PROJECT_ID'"
  porta_cfg=$(awk '/^[[:space:]]*\[/{s=$0; gsub(/[[:space:]]/, "", s)} s=="[db]" && /^[[:space:]]*port[[:space:]]*=/{sub(/^[^=]*=[[:space:]]*/, ""); sub(/[^0-9].*$/, ""); print; exit}' "$cfg")
  [ "$porta_cfg" = "$PORT" ] || recusar_destino "[db] port do config.toml é '$porta_cfg', não $PORT"
  [ -z "${SUPABASE_PROJECT_ID+x}" ] || recusar_destino "SUPABASE_PROJECT_ID definido no ambiente"
  for arq in "$WORKDIR/.env" "$WORKDIR/supabase/.env" "$WORKDIR/.env.local" "$WORKDIR/supabase/.env.local"; do
    if [ -e "$arq" ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?SUPABASE_PROJECT_ID[[:space:]]*=' "$arq"; then
      recusar_destino "$arq define SUPABASE_PROJECT_ID"
    fi
  done
  rodando=$(docker inspect -f '{{.State.Running}}' "$ENSAIO_CONTAINER" 2>/dev/null) || recusar_destino "instância ausente: container $ENSAIO_CONTAINER não existe"
  [ "$rodando" = true ] || recusar_destino "instância parada: $ENSAIO_CONTAINER (Running=$rodando)"
  rotulo=$(docker inspect -f '{{index .Config.Labels "com.supabase.cli.project"}}' "$ENSAIO_CONTAINER" 2>/dev/null)
  [ "$rotulo" = "$ENSAIO_PROJECT_ID" ] || recusar_destino "container $ENSAIO_CONTAINER com rótulo de projeto '$rotulo'"
  mapa=$(docker port "$ENSAIO_CONTAINER" 5432/tcp 2>/dev/null)
  [ -n "$mapa" ] || recusar_destino "container $ENSAIO_CONTAINER não publica a 5432"
  if printf '%s\n' "$mapa" | grep -vqE ":$PORT$"; then recusar_destino "container $ENSAIO_CONTAINER publica a 5432 em outra porta: $(printf '%s' "$mapa" | tr '\n' ' ')"; fi
  nomes=$(docker ps --filter "publish=$PORT" --format '{{.Names}}' 2>/dev/null)
  [ "$nomes" = "$ENSAIO_CONTAINER" ] || recusar_destino "porta $PORT publicada por '$(printf '%s' "$nomes" | tr '\n' ' ')', não só por $ENSAIO_CONTAINER"
  status=$(cd "$WORKDIR" && "${SB[@]}" status --workdir "$WORKDIR" -o env 2>/dev/null) || recusar_destino "supabase status do workdir falhou (stack não iniciada?)"
  printf '%s\n' "$status" | grep -qE "^DB_URL=\"?postgresql://[^@]+@127\.0\.0\.1:$PORT/" || recusar_destino "supabase status do workdir não aponta o banco para 127.0.0.1:$PORT"
  ips=" $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$ENSAIO_CONTAINER" 2>/dev/null) "
  ipdb=$("${P[@]}" -c "select host(inet_server_addr())" 2>/dev/null) || recusar_destino "nenhum banco responde em 127.0.0.1:$PORT"
  [ -n "$ipdb" ] && [[ "$ips" == *" $ipdb "* ]] || recusar_destino "o banco em 127.0.0.1:$PORT ($ipdb) não é o container $ENSAIO_CONTAINER ($ips)"
  echo "  destino conferido ($1): $ENSAIO_CONTAINER em 127.0.0.1:$PORT"
}

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
def carregar(c):
    d = json.load(open(c))
    if isinstance(d, dict) and "rows" in d: d = d["rows"]
    if isinstance(d, list):
        if len(d) != 1: print("impressao digital com", len(d), "linhas:", c); sys.exit(1)
        d = d[0]
        if isinstance(d, dict) and len(d) == 1: d = next(iter(d.values()))
    if isinstance(d, str): d = json.loads(d)
    return d
a = flat(carregar(sys.argv[1])); b = flat(carregar(sys.argv[2]))
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
# Preparo/limpeza de teste: o SQL tem de terminar sem erro e imprimir EXATAMENTE o esperado.
# Qualquer outra coisa interrompe o ensaio: um teste negativo sem o dado injetado provaria nada,
# e um resíduo de teste anterior poderia fazer o seguinte abortar "pelo motivo certo" por acaso.
exigir() { # nome  sql  saída-esperada
  local saida r
  saida="$("${P[@]}" -v ON_ERROR_STOP=1 -c "$2" 2>"$OUT/prep.err")"; r=$?
  if [ "$r" -ne 0 ] || [ "$saida" != "$3" ]; then
    bad "$1: preparo não comprovado (rc=$r, saída='$saida', esperada='$3') $(grep -h 'ERROR:' "$OUT/prep.err" | head -1 | cut -c1-150)"
    echo "Ensaio interrompido: preparo de teste não comprovado. Resumo parcial: $PASS PASS, $FAIL FAIL"; exit 6
  fi
}
# Terminar não basta: a restauração (que não para no primeiro erro) só vale se o log trouxer todas
# as etapas, nenhum erro fora da lista aceita e se a cópia for igual à impressão digital do HML.
ERROS_ACEITOS='role "supabase_realtime_admin" does not exist'
validar_restauro() { # rótulo
  if python3 - "$OUT/restauro.log" "$ERROS_ACEITOS" <<'PY'
import re, sys
log = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
aceitos = [a for a in sys.argv[2].split("|") if a]
falhas, vistas, i = [], {}, 0
for marca in ("cifrados OK", "texto em claro OK", "Restauração concluída"):
    if not any(marca in l for l in log): falhas.append("marca ausente: " + marca)
while i < len(log):
    m = re.match(r"^    ([a-z-]+): ([0-9]+) erro\(s\)$", log[i]); i += 1
    if m:
        etapa, n, linhas = m.group(1), int(m.group(2)), []
        while i < len(log) and re.match(r"^       *[0-9]+ ", log[i]):
            c, txt = log[i].split(None, 1); linhas.append((int(c), txt)); i += 1
        vistas[etapa] = n
        if n and sum(c for c, _ in linhas) != n: falhas.append(f"{etapa}: {n} erro(s), nem todos listados no log")
        for c, txt in linhas:
            if not any(a in txt for a in aceitos): falhas.append(f"{etapa}: erro nao aceito: {txt[:100]}")
        continue
    m = re.match(r"^    privilégios reaplicados: [0-9]+ instruções, ([0-9]+) erro\(s\)$", log[i - 1])
    if m:
        vistas["privilegios"] = int(m.group(1))
        if int(m.group(1)): falhas.append("privilegios: " + m.group(1) + " erro(s) na reaplicacao (o log nao os lista)")
for e in ("roles", "schema-public", "migrations", "data-public", "data-auth", "privilegios"):
    if e not in vistas: falhas.append("etapa sem resumo no log: " + e)
if falhas: print("\n".join("     " + f for f in falhas)); sys.exit(1)
PY
  then ok "$1: log da restauração com todas as etapas e só erros aceitos"
  else bad "$1: restauração com erro não aceito ou incompleta"; echo "Ensaio interrompido: restauração não comprovada. Resumo parcial: $PASS PASS, $FAIL FAIL"; exit 4
  fi
  fp "restauro-$1"
  # Diferenças conhecidas e aceitas (runbook, seção 6): privilégios de função da reconciliação e o
  # event trigger ensure_rls, que o pg_dump não traz. Qualquer outra diferença invalida a cópia.
  if mesmo origem "restauro-$1" "catalogo.fn_privilegios_md5,catalogo.event_triggers_md5"; then
    ok "$1: cópia igual à impressão digital do HML (exceto fn_privilegios_md5 e event_triggers_md5)"
  else bad "$1: cópia diverge da impressão digital do HML"; echo "Ensaio interrompido: restauração não comprovada. Resumo parcial: $PASS PASS, $FAIL FAIL"; exit 4
  fi
}
# Único ponto do script com `db reset`: a identidade é conferida imediatamente antes (fatal) e de
# novo depois, antes da restauração (o reset recria o container).
reiniciar() { # rótulo
  verificar_destino "antes do reset $1"
  (cd "$WORKDIR" && "${SB[@]}" db reset --local --workdir "$WORKDIR" --yes >/dev/null 2>&1) || { echo "falha ao reiniciar o stack local"; exit 4; }
  verificar_destino "depois do reset $1, antes da restauração"
  "$REPO/scripts/hml-restaurar-local.sh" "$BACKUP_DIR" "$PORT" >"$OUT/restauro.log" 2>&1 || { echo "falha na restauração"; cat "$OUT/restauro.log"; exit 4; }
  validar_restauro "$1"
}
LIMPAR="container_service_participants container_service_audit container_services billing_additionals invoice_items invoices timesheet_entries timesheets operation_team user_operation_access operation_location_terms operation_terms shifts operations contract_employee_rates contract_rate_terms contract_terms contracts employee_cost_terms employees clients financial_holidays financial_calendar_coverage"

echo "== A. Restauração limpa e cópia isolada"
verificar_destino "início"
reiniciar A
ok "stack local isolado: $ENSAIO_CONTAINER, project_id e porta $PORT conferidos antes e depois do reset"
fp base
check "cópia restaurada: 31 tabelas, contas presentes, migrations 55 / head 050" "python3 -c \"import json;d=json.load(open('$OUT/base.json'));assert d['catalogo']['tabelas']==31 and d['auth']['users']>=1 and d['migrations']['total']==55 and d['migrations']['head']=='20261117120000'\""
check "gatilho legado de cálculo está desabilitado na origem (1 desabilitado)" "[ \"\$(\"\${P[@]}\" -c \"select count(*) from pg_trigger where tgname='trg_timesheet_entries_calculo_financeiro' and tgenabled='D'\")\" = 1 ]"

echo "== B. Ensaio a seco (modo padrão NAO): não pode alterar nada"
rodar "$SQL"; rc=$?
check "a seco: executa e conclui (preflight + validação)" "[ $rc -eq 0 ] && grep -q 'ENSAIO A SECO' '$OUT/run.out'"
fp seco
check "a seco: impressão digital idêntica (inclui as contagens de todas as tabelas)" "mesmo base seco"

echo "== C. Testes negativos (cada um deve ABORTAR sem alterar nada)"
verificar_destino "antes da seção C"
sim
# C1 dado real misturado
exigir "C1 preparo: marcador ainda ausente" "select count(*) from public.clients where name='Cliente Real LTDA'" 0
exigir "C1 preparo: 1 cliente inserido" "with i as (insert into public.clients(name) values ('Cliente Real LTDA') returning 1) select count(*) from i" 1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C1 cliente fora dos prefixos sintéticos" 'origem sintetica: clients'
exigir "C1 limpeza: exatamente 1 cliente removido" "with d as (delete from public.clients where name='Cliente Real LTDA' returning 1) select count(*) from d" 1
fp c1; check "C1 nada foi alterado (dado injetado removido, resto igual)" "mesmo base c1"
# C1b raiz com prefixo sintético, mas fora do inventário de 10/11/2026 (nome parecido não basta)
exigir "C1b preparo: marcador ainda ausente" "select count(*) from public.clients where name='HOMOLOG-SINT-NAO-INVENTARIADO'" 0
exigir "C1b preparo: 1 cliente inserido" "with i as (insert into public.clients(name) values ('HOMOLOG-SINT-NAO-INVENTARIADO') returning 1) select count(*) from i" 1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C1b cliente HOMOLOG-SINT fora do inventário" 'raizes: clientes'
# O prefixo é sintético: a 3.6 aceita a raiz; só a 3.6b (inventário por ID) pode tê-la recusado.
check "C1b recusado pelo inventário, não pela origem" "! grep -q 'origem sintetica: clients' '$OUT/run.err'"
exigir "C1b limpeza: exatamente 1 cliente removido" "with d as (delete from public.clients where name='HOMOLOG-SINT-NAO-INVENTARIADO' returning 1) select count(*) from d" 1
fp c1b; check "C1b nada foi alterado (dado injetado removido, resto igual)" "mesmo base c1b"
# C1c feriado legado (anterior à 044: territory_scope 'legado', legal_act NULL) de nome desconhecido.
#     Com NOT (legal_act LIKE ...) a linha saía da contagem por NULL e seria apagada. Tem de abortar.
#     Feriado não se apaga (gatilho de imutabilidade), então o dado entra numa transação externa que
#     o próprio aborto desfaz ao fechar a conexão; a impressão digital depois confirma.
exigir "C1c preparo: data de teste sem feriado" "select count(*) from public.financial_holidays where holiday_date='2099-12-30'" 0
{ printf '%s\n' "BEGIN;" \
    "SELECT 'PREPARO_C1C=' || count(*) FROM (WITH i AS (INSERT INTO public.financial_holidays(holiday_date, name, reason) VALUES ('2099-12-30', 'Feriado Desconhecido Legado', 'ensaio C1c') RETURNING legal_act, territory_scope) SELECT 1 FROM i WHERE legal_act IS NULL AND territory_scope = 'legado') x;"
  cat "$OUT/sim.sql"; } >"$OUT/c1c.sql"
rodar "$OUT/c1c.sql"; rc=$?
if ! grep -qx 'PREPARO_C1C=1' "$OUT/run.out"; then
  bad "C1c preparo não comprovado: o feriado com legal_act NULL não foi inserido"; echo "Ensaio interrompido. Resumo parcial: $PASS PASS, $FAIL FAIL"; exit 6
fi
deve_abortar "C1c feriado legado com legal_act NULL e nome desconhecido" 'origem sintetica: financial_holidays'
exigir "C1c limpeza: feriado de teste desfeito com a transação" "select count(*) from public.financial_holidays where holiday_date='2099-12-30'" 0
fp c1c; check "C1c nada foi alterado (transação desfeita, resto igual)" "mesmo base c1c"
# C2 ambiente errado (conjunto de migrations diferente)
exigir "C2 preparo: 1 versão inserida" "with i as (insert into supabase_migrations.schema_migrations(version, name) values ('99999999999999','x') returning 1) select count(*) from i" 1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C2 migrations diferentes do HML 050" 'ambiente: migrations'
exigir "C2 limpeza: exatamente 1 versão removida" "with d as (delete from supabase_migrations.schema_migrations where version='99999999999999' returning 1) select count(*) from d" 1
fp c2; check "C2 nada foi alterado" "mesmo base c2"
# C3 tabela nova não classificada
exigir "C3 preparo: tabela criada" "create table public.zz_nova_tabela(id int); select count(*) from pg_tables where schemaname='public' and tablename='zz_nova_tabela'" 1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C3 tabela nova não classificada" 'catalogo: 31 tabelas'
exigir "C3 limpeza: tabela removida" "drop table public.zz_nova_tabela; select count(*) from pg_tables where schemaname='public' and tablename='zz_nova_tabela'" 0
fp c3; check "C3 nada foi alterado" "mesmo base c3"
# C4 concorrência: outra sessão segura uma trava
# A sessão da trava é identificada por application_name: a conferência não confunde com autovacuum.
( PGAPPNAME=bs-ensaio-c4 "${P[@]}" -c "begin; lock table public.clients in access share mode; select pg_sleep(18); commit;" >/dev/null 2>&1 & )
sleep 2
exigir "C4 preparo: outra sessão segura a trava em clients" "select (count(*) >= 1)::int from pg_locks l join pg_class c on c.oid = l.relation join pg_stat_activity a on a.pid = l.pid where c.relname = 'clients' and c.relnamespace = 'public'::regnamespace and l.granted and a.application_name = 'bs-ensaio-c4'" 1
rodar "$OUT/sim.sql"; rc=$?
deve_abortar "C4 tabela em uso por outra sessão" 'lock timeout'
sleep 18
exigir "C4 limpeza: sessão da trava encerrada" "select count(*) from pg_stat_activity where application_name = 'bs-ensaio-c4'" 0
fp c4; check "C4 nada foi alterado" "mesmo base c4"
# C5 falha na validação final (alteração indevida em tabela preservada) => rollback total
exigir "C5 preparo: existe perfil para alterar" "select (count(*) >= 1)::int from public.profiles" 1
python3 - "$OUT/sim.sql" "$OUT/falha.sql" <<'PY' || { bad "C5 preparo: injeção no script falhou"; echo "Ensaio interrompido. Resumo parcial: $PASS PASS, $FAIL FAIL"; exit 6; }
import sys
t = open(sys.argv[1]).read()
marca = "-- 5. Validação integral"
inj = "UPDATE public.profiles SET full_name = coalesce(full_name, '') || 'x' WHERE id = (SELECT id FROM public.profiles ORDER BY id LIMIT 1);\n\n"
assert t.count(marca) == 1
open(sys.argv[2], "w").write(t.replace(marca, inj + marca, 1))
PY
rodar "$OUT/falha.sql"; rc=$?
deve_abortar "C5 tabela preservada alterada durante a execução" 'validacao final:.*mudou: identidade'
fp c5
check "C5 rollback total: dados, gatilhos e catálogo idênticos ao início" "mesmo base c5"
check "C5 gatilhos voltaram ao estado original (1 desabilitado, o legado)" "[ \"\$(\"\${P[@]}\" -c \"select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and t.tgenabled<>'O'\")\" = 1 ]"

echo "== D. Execução real na cópia (bs_limpeza.executar = SIM)"
verificar_destino "antes da seção D"
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
reiniciar G
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
