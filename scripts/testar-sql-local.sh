#!/usr/bin/env bash
# Roda todas as suítes de supabase/tests/ contra um Supabase LOCAL descartável.
#
# NUNCA toca Production: usa só `supabase start`/`db reset --local` (nenhum
# `--linked`, nenhum `db push`/`db pull`), e executa os arquivos via `psql`
# dentro do container Postgres local, endereçado pelo nome do container, não
# por host/porta configurável — não há como este script alcançar uma rede que
# não seja o Docker local.
#
# Pré-requisito: Docker Desktop com o daemon rodando. O script para e explica
# se não estiver.
#
# Uso: scripts/testar-sql-local.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Ambiente do processo não pode sobrepor a identidade do config.toml isolado.
unset SUPABASE_PROJECT_ID

local_command() { python3 scripts/_executar_local.py "$@"; }

if ! local_command 30 docker info >/dev/null 2>&1; then
  echo "Docker não está disponível (daemon não respondeu a 'docker info')." >&2
  echo "Inicie o Docker Desktop e rode este script de novo." >&2
  exit 1
fi

echo "Subindo Supabase local..."
local_command 300 env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@2.117.0 start -x studio,realtime,logflare,vector,postgres-meta,imgproxy,mailpit,edge-runtime,storage-api >/dev/null

echo "Aplicando as migrations do zero (supabase db reset --local)..."
local_command 300 env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@2.117.0 db reset --local

# O container local segue a convenção supabase_db_<project_id>. Resolve o
# project_id do config.toml DESTE repositório e monta o nome exato — nunca um
# filtro parcial (docker ps --filter "name=supabase_db_" | head -1), que
# pegaria o container de outro projeto Supabase local se houver mais de um
# rodando ao mesmo tempo na máquina. Sem fallback: se o nome exato não
# existir e estiver rodando, o script para.
project_id=$(grep -E '^project_id' supabase/config.toml | sed -E 's/^project_id[[:space:]]*=[[:space:]]*"(.*)"$/\1/')
if [ -z "$project_id" ]; then
  echo "Não consegui ler project_id de supabase/config.toml." >&2
  exit 1
fi

container="supabase_db_${project_id}"
estado=$(local_command 30 docker inspect --format '{{.State.Running}}' "$container") || {
  codigo=$?
  if [ "$codigo" -eq 124 ]; then
    echo "Tempo limite ao inspecionar o container $container; prazo excedido." >&2
    exit 124
  fi
  echo "O container $container não existe ou não está rodando." >&2
  echo "Confira 'supabase start' e 'docker ps' — este script não usa outro container." >&2
  exit "$codigo"
}
if [ "$estado" != "true" ]; then
  echo "O container $container não existe ou não está rodando." >&2
  echo "Confira 'supabase start' e 'docker ps' — este script não usa outro container." >&2
  exit 1
fi

echo "Container local: $container (project_id: $project_id)"

falhou=""
for arquivo in supabase/tests/*.sql; do
  nome=$(basename "$arquivo")
  echo ""
  echo "=== $nome ==="
  if ! local_command 180 docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q < "$arquivo"; then
    echo "FALHOU: $nome" >&2
    falhou="$nome"
    break
  fi
  echo "PASS: $nome"
done

if [ -n "$falhou" ]; then
  echo ""
  echo "Parou em $falhou. Veja a saída acima para o erro." >&2
  exit 1
fi

echo ""
echo "PASS: todas as suítes SQL locais."
