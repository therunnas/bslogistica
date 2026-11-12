#!/usr/bin/env bash
# Testes de ponta a ponta (Playwright) contra um Supabase LOCAL descartável e o app rodando em
# loopback. NUNCA toca HML nem Production:
#   - o project_id do config.toml precisa ter sido trocado por "bs-e2e-…" (o workflow faz isso);
#   - todo comando do Supabase CLI é --local; não existe `link`;
#   - as travas de e2e/guarda/ recusam qualquer referência a projeto real e bloqueiam rede externa
#     do servidor (rede.cjs) e do navegador (fixture do Playwright);
#   - o ambiente é destruído no fim (supabase stop --no-backup), passe ou falhe.
#
# Pré-requisitos: Docker em execução e `npm ci` feito. Uso: bash scripts/e2e-local.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

unset SUPABASE_PROJECT_ID SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD

CLI=(npx --yes supabase@2.117.0)
RESULTADOS="e2e-results"
ESTADO_DIR="$(mktemp -d)"
REDE_LOG="$RESULTADOS/rede-servidor.log"
APP_PID=""

encerrar() {
  local codigo=$?
  # O app roda num grupo de processos próprio (setsid): encerra o npx e o next-server juntos.
  if [ -n "$APP_PID" ]; then kill -- "-$APP_PID" 2>/dev/null || true; fi
  rm -rf "$ESTADO_DIR"
  echo "Encerrando o Supabase local (sem backup)..."
  "${CLI[@]}" stop --no-backup >/dev/null 2>&1 || true
  exit "$codigo"
}
trap encerrar EXIT

rm -rf "$RESULTADOS"
mkdir -p "$RESULTADOS"
: >"$REDE_LOG"

echo "1. Travas antes de qualquer escrita"
node e2e/guarda/testar-guardas.mjs
node e2e/guarda/verificar-ambiente.mjs
docker info >/dev/null

PROJETO=$(sed -nE 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)"$/\1/p' supabase/config.toml)
CONTAINER="supabase_db_${PROJETO}"

echo "2. Supabase local ($PROJETO)"
"${CLI[@]}" start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime,storage-api >/dev/null
"${CLI[@]}" db reset --local

STATUS=$("${CLI[@]}" status -o env)
valor() { printf '%s\n' "$STATUS" | sed -nE "s/^$1=\"?([^\"]*)\"?$/\1/p" | head -1; }
API_URL=$(valor API_URL)
ANON_KEY=$(valor ANON_KEY)
SERVICE_KEY=$(valor SERVICE_ROLE_KEY)

if [ "$API_URL" != "http://127.0.0.1:54321" ]; then
  echo "E2E INTERROMPIDO: API local inesperada ($API_URL)." >&2
  exit 1
fi
if [ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
  echo "E2E INTERROMPIDO: container $CONTAINER não está rodando." >&2
  exit 1
fi
echo "   identidade conferida: $CONTAINER em $API_URL"

echo "3. Usuários sintéticos locais (senhas geradas nesta execução, nunca impressas)"
ADMIN_EMAIL="e2e-admin@exemplo.test"
OPER_EMAIL="e2e-operacional@exemplo.test"
ADMIN_SENHA="E2e-$(openssl rand -hex 16)"
OPER_SENHA="E2e-$(openssl rand -hex 16)"

criar_usuario() {
  curl -sS --fail -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true}" |
    node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>process.stdout.write(JSON.parse(t).id))'
}
ADMIN_ID=$(criar_usuario "$ADMIN_EMAIL" "$ADMIN_SENHA")
OPER_ID=$(criar_usuario "$OPER_EMAIL" "$OPER_SENHA")

echo "4. Semente: papéis e configuração igual à Production (motor ON, resolução OFF, dobro ON)"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  -v admin_id="$ADMIN_ID" -v oper_id="$OPER_ID" \
  -v sessao_id="$(node -e 'console.log(crypto.randomUUID())')" \
  -f - <e2e/sql/semente-local.sql

echo "5. Build e app em loopback"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
PASSWORD_RECOVERY_PROOF_SECRET="$(openssl rand -hex 32)"
export PASSWORD_RECOVERY_PROOF_SECRET
node e2e/guarda/verificar-ambiente.mjs
npm run build >"$RESULTADOS/build.log" 2>&1 || {
  tail -50 "$RESULTADOS/build.log"
  exit 1
}

E2E_REDE_LOG="$REDE_LOG" NODE_OPTIONS="--require ./e2e/guarda/rede.cjs" \
  setsid npx next start -H 127.0.0.1 -p 3000 >"$RESULTADOS/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do
  if curl -s -o /dev/null http://127.0.0.1:3000/login; then break; fi
  sleep 1
done
curl -s -o /dev/null --fail http://127.0.0.1:3000/login

echo "6. Playwright"
set +e
E2E_ADMIN_EMAIL="$ADMIN_EMAIL" E2E_ADMIN_SENHA="$ADMIN_SENHA" \
  E2E_OPER_EMAIL="$OPER_EMAIL" E2E_OPER_SENHA="$OPER_SENHA" \
  E2E_DB_CONTAINER="$CONTAINER" E2E_ESTADO_DIR="$ESTADO_DIR" \
  env -u SUPABASE_SERVICE_ROLE_KEY -u PASSWORD_RECOVERY_PROOF_SECRET npx playwright test
RESULTADO=$?
set -e

echo "7. Rede do servidor durante os testes"
if [ -s "$REDE_LOG" ]; then
  echo "FALHA: o servidor tentou conexões externas (bloqueadas):" >&2
  cat "$REDE_LOG" >&2
  RESULTADO=1
else
  echo "   nenhuma conexão externa tentada pelo servidor."
fi

node e2e/relatorio.mjs || true

# Contexto de cada falha (árvore de acessibilidade da página, sem cookies nem tokens) no próprio log,
# para diagnosticar sem baixar o artefato.
for contexto in "$RESULTADOS"/artefatos-*/*/error-context.md; do
  [ -f "$contexto" ] || continue
  echo "----- $contexto"
  # Erro e árvore da página; o código-fonte do teste fica de fora (já está no repositório).
  awk '/^# Test source/{f=1} /^# Page snapshot/{f=0} !f' "$contexto" | sed -n '1,200p'
done
exit "$RESULTADO"
