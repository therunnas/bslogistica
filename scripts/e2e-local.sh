#!/usr/bin/env bash
# Testes de ponta a ponta (Playwright) contra um Supabase LOCAL descartável e o app rodando em
# loopback. NUNCA toca HML nem Production:
#   - o project_id do config.toml precisa ter sido trocado por "bs-e2e-…" (o workflow faz isso);
#   - todo comando do Supabase CLI é local; não existe `link`;
#   - as travas de e2e/guarda/ recusam qualquer referência a projeto real e bloqueiam rede externa
#     do servidor (rede.cjs) e do navegador (fixture do Playwright);
#   - nada destrutivo acontece antes das validações de identidade e destino (passo 1); uma
#     instância do Supabase que já existia é recusada, nunca reaproveitada nem apagada;
#   - no fim (passe ou falhe) só é encerrado o que ESTA execução criou: o app que ela subiu e o
#     Supabase local do projeto dela (`stop --project-id <projeto> --no-backup`). Se a execução
#     parou nas validações, não há reset nem stop.
#
# Pré-requisitos: Docker em execução e `npm ci` feito. Uso: bash scripts/e2e-local.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

unset SUPABASE_PROJECT_ID SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD

CLI=(npx --yes supabase@2.117.0)
RESULTADOS="e2e-results"
REDE_LOG="$RESULTADOS/rede-servidor.log"
# Portas do Supabase local (API, banco, Studio, e-mail) e do app: ocupadas = instância alheia.
PORTAS_LOCAIS=(54321 54322 54323 54324 3000)
ROTULO_DO_PROJETO="com.supabase.cli.project"

# Recursos desta execução. Ficam vazios/0 até serem criados: o encerramento só mexe no que marcou.
PROJETO=""
ESTADO_DIR=""
APP_PID=""
SUPABASE_PROPRIO=0

interromper() {
  echo "E2E INTERROMPIDO: $*" >&2
  exit 1
}

encerrar() {
  local codigo=$?
  trap - EXIT
  # O app roda num grupo de processos próprio (controle de tarefas do bash, `set -m`): encerra o
  # npx e o next-server juntos. O segundo `kill` cobre o líder caso o grupo já não exista.
  if [ -n "$APP_PID" ]; then
    kill -- "-$APP_PID" 2>/dev/null || true
    kill "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$ESTADO_DIR" ]; then rm -rf "$ESTADO_DIR"; fi
  # Stop só do Supabase que esta execução subiu, pelo project_id dela (nunca o padrão do config,
  # nunca --all), e de novo conferido o prefixo local.
  if [ "$SUPABASE_PROPRIO" = "1" ] && [[ "$PROJETO" =~ ^bs-e2e-[a-z0-9-]+$ ]]; then
    echo "Encerrando o Supabase local desta execução ($PROJETO, sem backup)..."
    "${CLI[@]}" stop --project-id "$PROJETO" --no-backup >/dev/null 2>&1 || true
  else
    echo "Nenhum Supabase desta execução para encerrar (nada foi parado)."
  fi
  exit "$codigo"
}
trap encerrar EXIT

echo "1. Travas e identidade, antes de qualquer operação destrutiva"
node e2e/guarda/testar-guardas.mjs
node e2e/guarda/verificar-ambiente.mjs
docker info >/dev/null || interromper "Docker indisponível."

PROJETO_LIDO=$(sed -nE 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)"$/\1/p' supabase/config.toml)
[[ "$PROJETO_LIDO" =~ ^bs-e2e-[a-z0-9-]+$ ]] ||
  interromper "project_id \"$PROJETO_LIDO\" não é um projeto local do E2E (bs-e2e-…)."
[ ! -e supabase/.temp/project-ref ] || interromper "existe vínculo remoto (supabase/.temp/project-ref)."
CONTAINER="supabase_db_${PROJETO_LIDO}"

# Instância preexistente (de qualquer projeto): não é desta execução e não pode ser zerada.
EXISTENTES=$(
  {
    docker ps -a --filter "label=$ROTULO_DO_PROJETO" --format '{{.Names}}'
    docker ps -a --filter "name=supabase_" --format '{{.Names}}'
  } | sort -u
)
[ -z "$EXISTENTES" ] ||
  interromper "já existe Supabase local em execução ou parado (não é desta execução): $(echo "$EXISTENTES" | tr '\n' ' ')"
for porta in "${PORTAS_LOCAIS[@]}"; do
  if (: <"/dev/tcp/127.0.0.1/$porta") 2>/dev/null; then
    interromper "a porta local $porta já está em uso por outro processo."
  fi
done
echo "   destino conferido: projeto $PROJETO_LIDO, sem vínculo remoto, sem instância anterior"

echo "2. Supabase local ($PROJETO_LIDO)"
rm -rf "$RESULTADOS"
mkdir -p "$RESULTADOS"
: >"$REDE_LOG"
ESTADO_DIR="$(mktemp -d)"
# A partir daqui o Supabase deste project_id é desta execução: nada existia antes (passo 1).
PROJETO="$PROJETO_LIDO"
SUPABASE_PROPRIO=1
# Auth local alinhado à Production no que o CP-01 exercita, SÓ pelo ambiente deste processo (o
# config.toml não tem [auth] de propósito e não é alterado): TOTP habilitado, cadastro público
# desligado. O capturador local de e-mail (Mailpit, 127.0.0.1:54324) sobe para convite e
# recuperação; nenhuma mensagem sai da VM.
SUPABASE_AUTH_MFA_TOTP_ENROLL_ENABLED=true SUPABASE_AUTH_MFA_TOTP_VERIFY_ENABLED=true \
  SUPABASE_AUTH_ENABLE_SIGNUP=false \
  "${CLI[@]}" start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,edge-runtime,storage-api >/dev/null

STATUS=$("${CLI[@]}" status -o env)
valor() { printf '%s\n' "$STATUS" | sed -nE "s/^$1=\"?([^\"]*)\"?$/\1/p" | head -1; }
API_URL=$(valor API_URL)
ANON_KEY=$(valor ANON_KEY)
SERVICE_KEY=$(valor SERVICE_ROLE_KEY)

# Identidade da instância que subiu, ANTES do reset: URL local, container rodando e rótulo do
# projeto desta execução.
[ "$API_URL" = "http://127.0.0.1:54321" ] || interromper "API local inesperada ($API_URL)."
[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" = "true" ] ||
  interromper "container $CONTAINER não está rodando."
ROTULO=$(docker inspect --format "{{index .Config.Labels \"$ROTULO_DO_PROJETO\"}}" "$CONTAINER")
[ "$ROTULO" = "$PROJETO" ] ||
  interromper "o container $CONTAINER pertence a \"$ROTULO\", não a este projeto ($PROJETO)."
echo "   identidade conferida: $CONTAINER ($PROJETO) em $API_URL"

"${CLI[@]}" db reset --local
[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" = "true" ] ||
  interromper "container $CONTAINER não voltou depois do reset."

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
# Contas do CP-01 (autenticação e permissões), todas sintéticas e locais: um segundo admin (MFA,
# recuperação com MFA, último admin), uma conta sem papel, um operacional que será revogado e um
# operacional para a recuperação de senha sem MFA.
ADMIN2_EMAIL="e2e-admin2@exemplo.test"
SEMPAPEL_EMAIL="e2e-sem-papel@exemplo.test"
REVOGAR_EMAIL="e2e-revogar@exemplo.test"
RECUPERA_EMAIL="e2e-recupera@exemplo.test"
ADMIN2_SENHA="E2e-$(openssl rand -hex 16)"
SEMPAPEL_SENHA="E2e-$(openssl rand -hex 16)"
REVOGAR_SENHA="E2e-$(openssl rand -hex 16)"
RECUPERA_SENHA="E2e-$(openssl rand -hex 16)"
ADMIN2_ID=$(criar_usuario "$ADMIN2_EMAIL" "$ADMIN2_SENHA")
criar_usuario "$SEMPAPEL_EMAIL" "$SEMPAPEL_SENHA" >/dev/null
REVOGAR_ID=$(criar_usuario "$REVOGAR_EMAIL" "$REVOGAR_SENHA")
RECUPERA_ID=$(criar_usuario "$RECUPERA_EMAIL" "$RECUPERA_SENHA")

echo "4. Semente: papéis e configuração igual à Production (motor ON, resolução OFF, dobro ON)"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  -v admin_id="$ADMIN_ID" -v oper_id="$OPER_ID" -v admin2_id="$ADMIN2_ID" \
  -v revogar_id="$REVOGAR_ID" -v recupera_id="$RECUPERA_ID" \
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

# Grupo de processos próprio para o app SEM `setsid` (ausente no macOS): com o controle de tarefas
# do bash ligado só aqui (`set -m`), o processo em segundo plano vira líder do próprio grupo — no
# bash do Linux e no bash 3.2 do macOS. O encerramento derruba o grupo inteiro (npx + next-server).
set -m
E2E_REDE_LOG="$REDE_LOG" NODE_OPTIONS="--require ./e2e/guarda/rede.cjs" \
  npx next start -H 127.0.0.1 -p 3000 >"$RESULTADOS/app.log" 2>&1 &
APP_PID=$!
set +m
GRUPO_DO_APP=$(ps -o pgid= -p "$APP_PID" | tr -d ' ')
[ "$GRUPO_DO_APP" = "$APP_PID" ] ||
  interromper "o app não ficou num grupo de processos próprio (pgid ${GRUPO_DO_APP:-?}); sem isso o encerramento não alcança o next-server."
for _ in $(seq 1 60); do
  if curl -s -o /dev/null http://127.0.0.1:3000/login; then break; fi
  sleep 1
done
curl -s -o /dev/null --fail http://127.0.0.1:3000/login

echo "6. Playwright"
set +e
E2E_ADMIN_EMAIL="$ADMIN_EMAIL" E2E_ADMIN_SENHA="$ADMIN_SENHA" \
  E2E_OPER_EMAIL="$OPER_EMAIL" E2E_OPER_SENHA="$OPER_SENHA" \
  E2E_ADMIN2_EMAIL="$ADMIN2_EMAIL" E2E_ADMIN2_SENHA="$ADMIN2_SENHA" \
  E2E_SEMPAPEL_EMAIL="$SEMPAPEL_EMAIL" E2E_SEMPAPEL_SENHA="$SEMPAPEL_SENHA" \
  E2E_REVOGAR_EMAIL="$REVOGAR_EMAIL" E2E_REVOGAR_SENHA="$REVOGAR_SENHA" \
  E2E_RECUPERA_EMAIL="$RECUPERA_EMAIL" E2E_RECUPERA_SENHA="$RECUPERA_SENHA" \
  E2E_MAILPIT_URL="http://127.0.0.1:54324" \
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

# Contexto das falhas INESPERADAS (árvore de acessibilidade da página, sem cookies nem tokens) no
# próprio log, para diagnosticar sem baixar o artefato. Falha conhecida (test.fail) fica de fora.
if [ -s "$RESULTADOS/contextos-das-falhas.txt" ]; then
  while IFS= read -r contexto; do
    [ -f "$contexto" ] || continue
    echo "----- $contexto"
    awk '/^# Test source/{f=1} /^# Page snapshot/{f=0} !f' "$contexto" | sed -n '1,200p'
  done <"$RESULTADOS/contextos-das-falhas.txt"
fi
exit "$RESULTADO"
