#!/usr/bin/env bash
# Compatibilidade de deploy dos leitores (FIN-PR-03): o app desta branch contra o banco LOCAL
#   1) até a 034 — o banco de Production hoje (sem 035, 036 e 037);
#   2) até a 037 — o banco depois da etapa controlada de migrations.
#
# NUNCA toca Production nem homologação: Supabase local descartável (`supabase start`,
# `db reset --local`) e um `next start` local apontado para ele. Cria uma conta de admin SÓ no Auth
# local, que some no reset seguinte. Não roda na CI (precisa de Docker).
#
# Uso: bash scripts/testar-compatibilidade-deploy.sh   (ao final o banco local fica até a 037)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker info >/dev/null 2>&1 || { echo "Docker não está disponível." >&2; exit 1; }

supa() { env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest "$@"; }

echo "Subindo Supabase local..."
supa start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime >/dev/null 2>&1 || supa start >/dev/null

eval "$(supa status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
export API_URL ANON_KEY SERVICE_ROLE_KEY CONTAINER="supabase_db_${project_id}"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "API_URL não é local: $API_URL" >&2; exit 1 ;; esac

tmp=$(mktemp -d)
porta=3987
servidor=""
trap '[ -n "$servidor" ] && kill "$servidor" 2>/dev/null; rm -rf "$tmp"' EXIT

echo "Build do app apontado para o Supabase local..."
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" NEXT_TELEMETRY_DISABLED=1
npm run build >"$tmp/build.log" 2>&1 || { tail -30 "$tmp/build.log" >&2; exit 1; }
npx next start -p "$porta" >"$tmp/next.log" 2>&1 &
servidor=$!
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$porta/login" && break; sleep 1; done
export BASE_URL="http://127.0.0.1:$porta"

rodar() {
  node --experimental-strip-types --import ./scripts/_resolver-compat.mjs scripts/testar-compatibilidade-deploy.mjs "$1" "$2"
}

echo ""
echo "=== Cenário 1: banco até a 034 (como Production hoje, sem 035/036/037) ==="
supa db reset --local --version 20261101120000 >/dev/null 2>&1
rodar "banco-034" "sem-componentes"

echo ""
echo "=== Cenário 2: banco até a 037 ==="
supa db reset --local >/dev/null 2>&1
rodar "banco-037" "com-componentes"

if grep -qiE "unhandled|TypeError|ReferenceError" "$tmp/next.log"; then
  echo "FALHOU: o servidor Next registrou erro:" >&2
  grep -iE "unhandled|TypeError|ReferenceError" "$tmp/next.log" | head -10 >&2
  exit 1
fi
echo ""
echo "PASS: o app desta branch funciona com o banco de Production de hoje (034) e com o banco até a 037."
