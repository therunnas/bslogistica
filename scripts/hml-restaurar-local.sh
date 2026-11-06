#!/usr/bin/env bash
# Restaura o backup cifrado do HML num Supabase LOCAL ISOLADO (ensaio de limpeza).
#
# Nunca toca o HML nem Production: o destino é sempre 127.0.0.1, numa porta que o
# operador informa, e o script RECUSA um banco que já tenha tabelas em `public`.
# Ordem e ajustes: docs/runbooks/backup-production.md (seção 3) e
# docs/runbooks/limpeza-hml-sintetico.md.
#
# Uso:   scripts/hml-restaurar-local.sh <pasta-do-backup> [porta-do-banco-local]
# Pré:   stack local própria já iniciada (project_id e portas exclusivos, sem migrations);
#        senha do backup no Chaveiro (item informado em KEYCHAIN_ITEM).
# Saída: contagem de erros por etapa e as primeiras linhas "ERROR:" (sem DETAIL, que
#        pode conter valores). Nenhum dado, e-mail ou senha é impresso.
set -euo pipefail
umask 077

BACKUP_DIR="${1:?informe a pasta do backup}"
PORT="${2:-58322}"
HOST="127.0.0.1"
KEYCHAIN_ITEM="${KEYCHAIN_ITEM:-bs-backup-hml-2026-11-06-045}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -X -q -h "$HOST" -p "$PORT" -U supabase_admin -d postgres)

if [[ "$PORT" != 5[0-9][0-9][0-9][0-9] ]]; then echo "Porta inesperada: $PORT" >&2; exit 2; fi
# Guarda: banco vazio. Um HML/Production restaurado por engano em cima de dados é irreversível.
tabelas=$("${PSQL[@]}" -Atc "select count(*) from pg_tables where schemaname='public'")
if [[ "$tabelas" != "0" ]]; then echo "Destino já tem $tabelas tabelas em public: recusado." >&2; exit 3; fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/hml-restauracao.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
chmod 700 "$tmp"

echo "1/7 conferindo hashes dos arquivos cifrados"
(cd "$BACKUP_DIR" && shasum -a 256 -c SHA256-enc.txt >/dev/null) && echo "    cifrados OK"
PASS=$(security find-generic-password -a "$USER" -s "$KEYCHAIN_ITEM" -w)
export PASS
for f in "$BACKUP_DIR"/*.sql.enc; do
  b=$(basename "$f" .enc)
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$f" -out "$tmp/$b" -pass env:PASS
done
unset PASS
(cd "$tmp" && shasum -a 256 -c "$BACKUP_DIR/SHA256-plain.txt" >/dev/null) && echo "    texto em claro OK (hash confere)"

# Executa um arquivo SQL, não para no primeiro erro (como no ensaio de Production) e resume.
rodar() { # nome  arquivo  [PGOPTIONS]
  local nome="$1" arq="$2" opts="${3:-}"
  PGOPTIONS="$opts" "${PSQL[@]}" -v ON_ERROR_STOP=0 -f "$arq" >"$tmp/$nome.out" 2>"$tmp/$nome.err" || true
  local n; n=$(grep -c '^psql:.*ERROR:' "$tmp/$nome.err" || true)
  echo "    $nome: $n erro(s)"
  { grep -h 'ERROR:' "$tmp/$nome.err" || true; } | sed -E 's/^psql:[^ ]+ //' | cut -c1-110 | sort | uniq -c | sort -rn | head -5 | sed 's/^/      /'
}

echo "2/7 extensões e papéis"
"${PSQL[@]}" -c 'create extension if not exists btree_gist with schema extensions' >/dev/null
"${PSQL[@]}" -c 'create extension if not exists pgcrypto with schema extensions' >/dev/null
"${PSQL[@]}" -c 'create extension if not exists "uuid-ossp" with schema extensions' >/dev/null
rodar roles "$tmp/schema-roles.sql"

echo "3/7 esquema public"
rodar schema-public "$tmp/schema-public.sql"

echo "4/7 histórico de migrations"
"${PSQL[@]}" -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
alter table supabase_migrations.schema_migrations owner to postgres;
SQL
rodar migrations "$tmp/data-migrations.sql"

echo "5/7 dados de public (session_replication_role=replica: sem recalcular gatilhos nem validar FK na carga)"
rodar data-public "$tmp/data-public.sql" "-c session_replication_role=replica"

echo "6/7 dados de auth"
# A versão local do GoTrue pode não ter colunas que o HML tem (ex.: one_time_tokens.expires_at).
"${PSQL[@]}" -q -c "alter table auth.one_time_tokens add column if not exists expires_at timestamptz" 2>/dev/null || true
rodar data-auth "$tmp/data-auth.sql" "-c session_replication_role=replica"

echo "7/7 reconciliar privilégios (o dump traz GRANT, mas não os REVOKE sobre os padrões do Supabase)"
"${PSQL[@]}" -q <<'SQL'
revoke all on all tables    in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from anon, authenticated, service_role;
SQL
# Reaplica só os GRANT/REVOKE/ALTER DEFAULT PRIVILEGES do dump (uma instrução por linha no pg_dump).
grep -E '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES) ' "$tmp/schema-public.sql" >"$tmp/privilegios.sql" || true
"${PSQL[@]}" -v ON_ERROR_STOP=0 -f "$tmp/privilegios.sql" >/dev/null 2>"$tmp/regrants.err" || true
echo "    privilégios reaplicados: $(wc -l <"$tmp/privilegios.sql" | tr -d ' ') instruções, $(grep -c 'ERROR:' "$tmp/regrants.err" || true) erro(s)"
# O pg_dump não traz event triggers. O `ensure_rls` (migration 20260903200000) fica de fora: no
# Postgres local ele exige dono superusuário e a função pertence a `postgres`. Só dispara em
# CREATE TABLE, que o expurgo não usa; é diferença conhecida (event_triggers_md5) e documentada.
echo "Restauração concluída (logs apagados ao sair)."
