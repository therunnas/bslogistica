#!/usr/bin/env bash
# FUNC-READY-01: fluxos de ponta a ponta contra um Supabase LOCAL isolado já em execução.
#
# Uso: FLUXOS_WORKDIR=<diretório com supabase/config.toml da stack local> bash scripts/testar-fluxos-local.sh
#
# Não sobe, não reseta e não aplica migrations: só lê `supabase status` do workdir informado. A URL da
# API precisa ser loopback e o Postgres é acessado só pelo container `supabase_db_<project_id>`.
# Nunca usa `--linked`, `db push` nem a identidade do repositório (SUPABASE_PROJECT_ID é ignorado).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${FLUXOS_WORKDIR:?Informe FLUXOS_WORKDIR (workdir da stack local isolada).}"
config="$FLUXOS_WORKDIR/supabase/config.toml"
[ -f "$config" ] || { echo "Sem $config." >&2; exit 2; }
project_id=$(grep -E '^project_id' "$config" | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
[ -n "$project_id" ] || { echo "project_id ausente em $config." >&2; exit 2; }

status=$(env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_ID supabase --workdir "$FLUXOS_WORKDIR" status -o env 2>/dev/null)
valor() { printf '%s\n' "$status" | sed -nE "s/^$1=\"(.*)\"$/\1/p"; }
API_URL=$(valor API_URL)
case "$API_URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo "API_URL não é local: $API_URL" >&2; exit 2 ;;
esac
ANON_KEY=$(valor ANON_KEY)
SERVICE_ROLE_KEY=$(valor SERVICE_ROLE_KEY)

API_URL="$API_URL" ANON_KEY="$ANON_KEY" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  CONTAINER="supabase_db_${project_id}" \
  node --experimental-strip-types --import ./scripts/_resolver-compat.mjs scripts/testar-fluxos-local.mjs
