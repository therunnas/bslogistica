#!/usr/bin/env bash
# Roda as 13 suítes de supabase/tests/ contra um Supabase LOCAL descartável.
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

if ! docker info >/dev/null 2>&1; then
  echo "Docker não está disponível (daemon não respondeu a 'docker info')." >&2
  echo "Inicie o Docker Desktop e rode este script de novo." >&2
  exit 1
fi

echo "Subindo Supabase local..."
env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest start >/dev/null

echo "Aplicando as migrations do zero (supabase db reset --local)..."
env -u SUPABASE_ACCESS_TOKEN npx --yes supabase@latest db reset --local

container=$(docker ps --filter "name=supabase_db_" --format "{{.Names}}" | head -1)
if [ -z "$container" ]; then
  echo "Não encontrei o container supabase_db_* rodando localmente." >&2
  exit 1
fi

host=$(docker port "$container" 5432/tcp 2>/dev/null || true)
echo "Container local: $container (porta: ${host:-desconhecida, só acessível via docker exec})"

falhou=""
for arquivo in supabase/tests/*.sql; do
  nome=$(basename "$arquivo")
  echo ""
  echo "=== $nome ==="
  if ! docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q < "$arquivo"; then
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
echo "13/13 PASS."
