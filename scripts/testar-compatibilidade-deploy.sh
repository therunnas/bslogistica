#!/usr/bin/env bash
# Compatibilidade de deploy (FIN-PR-03, 05, 06, 07, 08, 09 e 10): o app desta branch contra o banco LOCAL
#   1) até a 034 — referência histórica 034 (sem 035 em diante);
#   2) até a 037 — leitores pelos componentes, sem o período contratual;
#   3) até a 038 — período contratual e janela de cobrança;
#   4) até a 039 — catálogo de funções e período do turno;
#   5) até a 040 — snapshots de função e período por apontamento;
#   6) até a 041 — tarifas por função e período (resolução desligada e, no fim, ligada);
#   7) até a 042 — diária individual e adicional diário (resolução desligada = valores iguais;
#      ligada: a individual prevalece, HE sobre ela, adicional separado, faturamento concorrente).
#   8) até a 043 — dias especiais V2;
#   9) até a 044 — calendário territorial.
#  10) até a 045 — backend de containers e interface administrativa;
#  11) até a 046 — imutabilidade de fatura sem apontamento e escrita direta revogada (o app só lê as tabelas);
#  12) até a 047 — idempotência do registro de adicional (RPC nova com chave; a antiga deixa de ser executável pela API).
#
# NUNCA toca Production nem homologação: Supabase local descartável (`supabase start`,
# `db reset --local`) e um `next start` local apontado para ele. Cria uma conta de admin SÓ no Auth
# local, que some no reset seguinte. Não roda na CI (precisa de Docker).
#
# Cada `db reset` é seguido de uma espera por PRONTIDÃO REAL do PostgREST (scripts/_aguardar_postgrest.py):
# o cache de schema dele é recarregado de forma assíncrona e, sob carga, a suíte via "Could not find ... in the
# schema cache" num schema que o banco já tinha. A espera cria um canário depois do reset, pede a recarga e só
# libera quando a RPC do canário responde pelo cache; desiste por prazo, com diagnóstico — nunca por sleep fixo.
#
# Isolamento: por padrão usa `supabase/config.toml` do repositório. Para rodar numa stack local própria (outro
# project_id e portas), sem tocar nos containers de outras sessões, aponte SUPABASE_WORKDIR para um diretório
# de projeto Supabase local. O runner imprime o alvo e recusa API que não seja 127.0.0.1/localhost.
#
# Uso: bash scripts/testar-compatibilidade-deploy.sh   (ao final o banco local fica até a 047)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Ambiente do processo não pode sobrepor a identidade do config.toml isolado.
unset SUPABASE_PROJECT_ID

local_command() { python3 scripts/_executar_local.py "$@"; }

local_command 30 docker info >/dev/null 2>&1 || { codigo=$?; echo "Docker indisponível ou fora do prazo." >&2; exit "$codigo"; }

workdir_args=()
config=supabase/config.toml
if [ -n "${SUPABASE_WORKDIR:-}" ]; then
  [ -f "$SUPABASE_WORKDIR/supabase/config.toml" ] || { echo "SUPABASE_WORKDIR sem supabase/config.toml: $SUPABASE_WORKDIR" >&2; exit 1; }
  workdir_args=(--workdir "$SUPABASE_WORKDIR")
  config="$SUPABASE_WORKDIR/supabase/config.toml"
fi
supa() { local_command 300 env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@2.117.0 ${workdir_args[@]+"${workdir_args[@]}"} "$@"; }

echo "Subindo Supabase local..."
supa start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime,storage-api >/dev/null 2>&1 || { codigo=$?; if [ "$codigo" -eq 124 ]; then exit 124; fi; supa start >/dev/null; }

status_local=$(supa status -o env 2>/dev/null)
eval "$(printf '%s\n' "$status_local" | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET)=')"
unset status_local
project_id=$(grep -E '^project_id' "$config" | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
export API_URL ANON_KEY SERVICE_ROLE_KEY JWT_SECRET CONTAINER="supabase_db_${project_id}"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "API_URL não é local: $API_URL" >&2; exit 1 ;; esac
local_command 30 docker inspect --format '{{.State.Running}}' "$CONTAINER" | grep -qx true || { echo "Container $CONTAINER não está rodando." >&2; exit 1; }
echo "Alvo local: project_id=$project_id container=$CONTAINER api=$API_URL (config: $config)"

tmp=$(mktemp -d)
porta=3987
servidor=""
cleanup() {
  if [ -n "$servidor" ]; then
    kill "$servidor" 2>/dev/null || true
    wait "$servidor" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

echo "Build do app apontado para o Supabase local..."
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" NEXT_TELEMETRY_DISABLED=1
local_command 300 npm run build >"$tmp/build.log" 2>&1 || { tail -30 "$tmp/build.log" >&2; exit 1; }
python3 scripts/_executar_local.py 7200 npx next start -p "$porta" >"$tmp/next.log" 2>&1 &
servidor=$!
pronto=false
for _ in $(seq 1 60); do
  if curl --connect-timeout 1 --max-time 2 -fs -o /dev/null "http://127.0.0.1:$porta/login"; then pronto=true; break; fi
  kill -0 "$servidor" 2>/dev/null || { echo "Servidor local encerrou antes de ficar pronto." >&2; exit 1; }
  sleep 1
done
[ "$pronto" = true ] || { echo "Servidor local não ficou pronto dentro do prazo." >&2; exit 124; }
export BASE_URL="http://127.0.0.1:$porta"

# Reset local até a versão $1 e espera o PostgREST refletir exatamente o schema resultante.
resetar() {
  supa db reset --local --version "$1" >"$tmp/reset-$1.log" 2>&1 || { tail -30 "$tmp/reset-$1.log" >&2; echo "db reset --version $1 falhou." >&2; exit 1; }
  local_command 150 python3 scripts/_aguardar_postgrest.py "$API_URL" "$CONTAINER" 90 || { echo "PostgREST não ficou pronto após o reset $1." >&2; exit 1; }
}

rodar() {
  local_command 300 node --experimental-strip-types --import ./scripts/_resolver-compat.mjs scripts/testar-compatibilidade-deploy.mjs "$1" "$2" "$3" "$4" "$5" "$6" "$7"
}

echo ""
echo "=== Cenário 1: banco até a 034 (referência histórica, sem 035 em diante) ==="
resetar 20261101120000
rodar "banco-034" "sem-componentes" "sem-periodo" "sem-funcoes" "sem-snap" "sem-tarifas" "sem-diaria"

echo ""
echo "=== Cenário 2: banco até a 037 (sem o período contratual) ==="
resetar 20261104120000
rodar "banco-037" "com-componentes" "sem-periodo" "sem-funcoes" "sem-snap" "sem-tarifas" "sem-diaria"

echo ""
echo "=== Cenário 3: banco até a 038 (sem funções e período do turno) ==="
resetar 20261105120000
rodar "banco-038" "com-componentes" "com-periodo" "sem-funcoes" "sem-snap" "sem-tarifas" "sem-diaria"

echo ""
echo "=== Cenário 4: banco até a 039 (funções e período do turno, sem snapshots) ==="
resetar 20261106120000
rodar "banco-039" "com-componentes" "com-periodo" "com-funcoes" "sem-snap" "sem-tarifas" "sem-diaria"

echo ""
echo "=== Cenário 5: banco até a 040 (snapshots de função e período) ==="
resetar 20261107120000
rodar "banco-040" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "sem-tarifas" "sem-diaria"

echo ""
echo "=== Cenário 6: banco até a 041 (tarifas por função; resolução desligada e depois ligada) ==="
resetar 20261108120000
rodar "banco-041" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "sem-diaria"

echo ""
echo "=== Cenário 7: banco até a 042 (diária individual e adicional diário) ==="
resetar 20261109120000
rodar "banco-042" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "com-diaria"

echo "=== Cenário 8: banco até a 043 (dias especiais V2) ==="
resetar 20261110120000
rodar "banco-043" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "com-diaria"

echo "=== Cenário 9: banco até a 044 (calendário territorial) ==="
resetar 20261111120000
rodar "banco-044" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "com-diaria"

echo "=== Cenário 10: banco até a 045 (containers) ==="
resetar 20261112120000
rodar "banco-045" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "com-diaria"

echo "=== Cenário 11: banco até a 046 (imutabilidade de fatura; escrita direta revogada) ==="
resetar 20261113120000
rodar "banco-046" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "com-diaria"

echo "=== Cenário 12: banco até a 047 (idempotência do registro de adicional) ==="
resetar 20261114120000
rodar "banco-047" "com-componentes" "com-periodo" "com-funcoes" "com-snap" "com-tarifas" "com-diaria"

if grep -qiE "unhandled|TypeError|ReferenceError" "$tmp/next.log"; then
  echo "FALHOU: o servidor Next registrou erro:" >&2
  grep -iE "unhandled|TypeError|ReferenceError" "$tmp/next.log" | head -10 >&2
  exit 1
fi
echo ""
echo "PASS: compatibilidade local com os schemas 034, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046 e 047, incluindo páginas de containers e ausência segura da capacidade antes da 045. Isso não comprova o schema de Production."
