#!/usr/bin/env python3
"""Espera o PostgREST LOCAL recarregar o cache de schema depois de um `supabase db reset --local`.

Depois do reset o PostgREST recarrega o cache de schema de forma assíncrona. Enquanto a recarga não termina,
qualquer chamada a um objeto novo falha com "Could not find ... in the schema cache" (PGRST202/PGRST205),
mesmo que o banco já o tenha, e objetos removidos pelo reset continuam visíveis. A suíte de compatibilidade
via isso de forma intermitente.

ATENÇÃO — o OpenAPI da raiz (`GET /rest/v1/`) NÃO serve como sinal de prontidão: ele lista objetos do banco
mesmo quando o cache que atende às requisições está defasado (verificado: com os event triggers de recarga
desativados, a raiz listava a função nova enquanto a chamada da RPC devolvia PGRST202).

Por isso este verificador usa um CANÁRIO que passa pelo mesmo cache das requisições:
  1. cria `public._qa_pgrst_canario()` no banco (depois do reset) e a concede a `authenticated`;
  2. envia `NOTIFY pgrst, 'reload schema'` (de novo a cada 10 s: uma notificação emitida antes de o PostgREST
     voltar a escutar o canal se perde, e esperar sozinho não a traria de volta);
  3. chama a RPC como `authenticated` até obter HTTP 200. O PostgREST troca o cache de forma atômica, então
     enxergar um objeto criado DEPOIS do reset prova que o cache carregado é posterior ao reset inteiro;
  4. remove o canário (sempre, inclusive em falha) e pede nova recarga, sem esperar por ela.
Sem espera fixa: o prazo é só o limite de desistência, e a falha lista o último erro e os logs do PostgREST.

Só aceita alvo local: API em 127.0.0.1/localhost e container `supabase_db_*`. Nunca toca remoto.

Uso: ANON_KEY=<chave local> JWT_SECRET=<segredo local> _aguardar_postgrest.py <api_url> <container_db> [prazo_s]
Chave e segredo vêm do ambiente (não de argumento) para não aparecer na lista de processos. O JWT de papel
`authenticated` é assinado aqui com o segredo do Supabase LOCAL; nada é enviado a um serviço remoto.
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

CANARIO = "_qa_pgrst_canario"


def psql(container, sql, prazo=20):
    r = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-q",
         "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=prazo,
    )
    if r.returncode != 0:
        raise RuntimeError(f"psql falhou: {r.stderr.strip()}")
    return r.stdout


def jwt_authenticated(segredo):
    def b64(dados):
        return base64.urlsafe_b64encode(dados).rstrip(b"=")

    cabecalho = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    corpo = b64(json.dumps({"role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 600}).encode())
    assinatura = b64(hmac.new(segredo.encode(), cabecalho + b"." + corpo, hashlib.sha256).digest())
    return (cabecalho + b"." + corpo + b"." + assinatura).decode()


def chamar_canario(api_url, apikey, token):
    """Devolve (http_status, trecho_da_resposta). Falha de rede vira (0, erro)."""
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/rest/v1/rpc/{CANARIO}",
        data=b"{}",
        method="POST",
        headers={"apikey": apikey, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read(200).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(200).decode(errors="replace")
    except Exception as e:  # noqa: BLE001 - conexão recusada, timeout durante recarga etc.
        return 0, str(e)


def logs_do_postgrest(container):
    rest = container.replace("supabase_db_", "supabase_rest_", 1)  # supabase_db_<id> -> supabase_rest_<id>
    r = subprocess.run(["docker", "logs", "--tail", "30", rest], capture_output=True, text=True, timeout=20)
    return (r.stdout + r.stderr).strip()


def main():
    apikey = os.environ.get("ANON_KEY", "")
    segredo = os.environ.get("JWT_SECRET", "")
    if len(sys.argv) < 3 or not apikey or not segredo:
        print(__doc__, file=sys.stderr)
        return 2
    api_url, container = sys.argv[1:3]
    prazo = float(sys.argv[3]) if len(sys.argv) > 3 else 90.0
    if not (api_url.startswith("http://127.0.0.1:") or api_url.startswith("http://localhost:")):
        print(f"Recusado: API não é local ({api_url}).", file=sys.stderr)
        return 2
    if not container.startswith("supabase_db_"):
        print(f"Recusado: container inesperado ({container}).", file=sys.stderr)
        return 2

    token = jwt_authenticated(segredo)
    inicio = time.monotonic()
    tentativas = 0
    ultimo = (None, "")
    try:
        psql(
            container,
            f"drop function if exists public.{CANARIO}();"
            f"create function public.{CANARIO}() returns int language sql as 'select 1';"
            f"grant execute on function public.{CANARIO}() to authenticated;",
        )
        ultimo_notify = None
        while time.monotonic() - inicio < prazo:
            if ultimo_notify is None or time.monotonic() - ultimo_notify >= 10:
                psql(container, "NOTIFY pgrst, 'reload schema';")
                ultimo_notify = time.monotonic()
            tentativas += 1
            ultimo = chamar_canario(api_url, apikey, token)
            if ultimo[0] == 200:
                print(
                    f"PostgREST recarregou o schema pós-reset: canário visível em "
                    f"{time.monotonic() - inicio:.1f}s ({tentativas} chamada(s))."
                )
                return 0
            time.sleep(0.5)
    except Exception as e:  # noqa: BLE001
        ultimo = (None, f"erro do verificador: {e}")
    finally:
        try:
            psql(container, f"drop function if exists public.{CANARIO}(); NOTIFY pgrst, 'reload schema';")
        except Exception as e:  # noqa: BLE001
            print(f"  aviso: não consegui remover o canário: {e}", file=sys.stderr)

    print(f"PostgREST NÃO recarregou o schema em {prazo:.0f}s ({tentativas} chamadas).", file=sys.stderr)
    print(f"  última resposta do canário: HTTP {ultimo[0]} {ultimo[1]}", file=sys.stderr)
    try:
        print("  --- logs do PostgREST (30 linhas) ---\n" + logs_do_postgrest(container), file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"  (logs indisponíveis: {e})", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
