#!/usr/bin/env python3
"""Prontidão do PostgREST LOCAL após `supabase db reset --local` e conferência estrita do alvo local.

Depois do reset o PostgREST recarrega o cache de schema de forma assíncrona. Enquanto a recarga não termina,
uma chamada a objeto novo falha com "Could not find ... in the schema cache" (PGRST202/PGRST205) mesmo que o
banco já o tenha, e objetos removidos pelo reset continuam visíveis.

O OpenAPI da raiz (`GET /rest/v1/`) NÃO serve como sinal: ele lista objetos novos enquanto o cache das
requisições ainda está defasado. O sinal é um CANÁRIO que passa pelo mesmo cache das requisições:
  1. cria `public._qa_pgrst_canario_<aleatório>()` — NOME ÚNICO por execução. Com nome fixo, um cache defasado
     que ainda guardasse o canário de uma execução anterior responderia 200 ao canário recriado (o PostgREST
     resolve pela assinatura em cache e executa no banco), um falso "pronto" comprovado na stack local;
  2. o canário só pode ser executado por `authenticated` (revogado de PUBLIC, anon e service_role);
  3. envia `NOTIFY pgrst, 'reload schema'` (de novo a cada 10 s: uma notificação emitida antes de o PostgREST
     voltar a escutar o canal se perde);
  4. chama a RPC como `authenticated` até HTTP 200. O cache é trocado de forma atômica: enxergar um nome que
     não existia antes desta execução prova que o cache carregado é posterior ao reset inteiro;
  5. remove o canário sempre (também em SIGTERM/SIGINT, que o executor local usa no prazo) e confere que não
     sobrou nenhum `_qa_pgrst_canario*`; sobras de uma execução morta por SIGKILL são removidas no início.
Sem espera fixa: o prazo é só o limite de desistência, e a falha mostra a última resposta e os logs.

Destino: só `http://127.0.0.1:<porta>` ou `http://localhost:<porta>` (porta 1–65535, sem credenciais, caminho,
query ou fragmento), validado ANTES de qualquer requisição. O transporte ignora proxies do ambiente e recusa
redirecionamento (o urllib padrão seguiria o redirecionamento reenviando `apikey` e `Authorization`).

Modos:
  _aguardar_postgrest.py --validar-url <api_url>
  _aguardar_postgrest.py --verificar-alvo <api_url> <project_id> <workdir>
      confere que supabase_db_<id> e supabase_kong_<id> estão rodando com o rótulo do CLI deste project_id e
      deste workdir, e que o Kong publica 8000/tcp exatamente na porta da API.
  ANON_KEY=<chave local> JWT_SECRET=<segredo local> _aguardar_postgrest.py <api_url> <project_id> <workdir> [prazo_s]
      espera a recarga; ANTES de qualquer SQL refaz o --verificar-alvo inteiro, então nunca escreve no banco de
      uma stack cuja API, rótulos ou workdir não sejam os desta execução.
Chave e segredo vêm do ambiente (não de argumento) para não aparecer na lista de processos. O JWT de papel
`authenticated` é assinado aqui com o segredo do Supabase LOCAL.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

PREFIXO = "_qa_pgrst_canario"
HOSTS_LOCAIS = ("127.0.0.1", "localhost")
_URL = re.compile(r"http://(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})/?")


class Recusado(Exception):
    """Destino ou alvo fora do permitido: nada é enviado."""


def validar_url(api_url):
    """Devolve (host, porta) de uma URL local estrita; qualquer outra forma é recusada."""
    if not isinstance(api_url, str) or not _URL.fullmatch(api_url):
        raise Recusado(f"API não é http://127.0.0.1:<porta> nem http://localhost:<porta>: {api_url!r}")
    host, porta = _URL.fullmatch(api_url).groups()
    porta = int(porta)
    if not 1 <= porta <= 65535:
        raise Recusado(f"porta fora de 1–65535: {porta}")
    return host, porta


class _SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Recusado(f"redirecionamento recusado (HTTP {code} para {newurl!r})")


_TRANSPORTE = urllib.request.build_opener(urllib.request.ProxyHandler({}), _SemRedirecionamento())


def docker_inspect(nome):
    r = subprocess.run(["docker", "inspect", nome], capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise Recusado(f"container {nome} não existe")
    return json.loads(r.stdout)[0]


def verificar_alvo(api_url, project_id, workdir):
    _, porta = validar_url(api_url)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", project_id or ""):
        raise Recusado(f"project_id inválido: {project_id!r}")
    workdir = os.path.realpath(workdir)
    for papel in ("db", "kong"):
        nome = f"supabase_{papel}_{project_id}"
        info = docker_inspect(nome)
        rotulos = info.get("Config", {}).get("Labels") or {}
        if not info.get("State", {}).get("Running"):
            raise Recusado(f"{nome} não está rodando")
        if rotulos.get("com.supabase.cli.project") != project_id:
            raise Recusado(f"{nome} pertence a outro projeto: {rotulos.get('com.supabase.cli.project')!r}")
        if os.path.realpath(rotulos.get("com.supabase.cli.workdir", "")) != workdir:
            raise Recusado(f"{nome} foi criado por outro workdir: {rotulos.get('com.supabase.cli.workdir')!r}")
        if papel == "kong":
            portas = {b.get("HostPort") for b in (info.get("NetworkSettings", {}).get("Ports") or {}).get("8000/tcp") or []}
            if str(porta) not in portas:
                raise Recusado(f"a API {api_url} não é a porta publicada por {nome} ({sorted(portas)})")


def psql(container, sql, prazo=20):
    r = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-q",
         "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=prazo,
    )
    if r.returncode != 0:
        raise RuntimeError(f"psql falhou: {r.stderr.strip()}")
    return r.stdout


def sql_criar_canario(nome):
    return (
        "begin;"
        f"create function public.{nome}() returns int language sql as 'select 1';"
        f"revoke all on function public.{nome}() from public, anon, service_role;"
        f"grant execute on function public.{nome}() to authenticated;"
        "commit;"
    )


# Remove TODO canário (o desta execução e sobras de execuções mortas) e devolve quantos restaram.
SQL_REMOVER_CANARIOS = f"""
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like '{PREFIXO}%' loop
    execute 'drop function ' || f;
  end loop;
end $$;
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like '{PREFIXO}%';
"""


def jwt_authenticated(segredo):
    def b64(dados):
        return base64.urlsafe_b64encode(dados).rstrip(b"=")

    cabecalho = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    corpo = b64(json.dumps({"role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 600}).encode())
    assinatura = b64(hmac.new(segredo.encode(), cabecalho + b"." + corpo, hashlib.sha256).digest())
    return (cabecalho + b"." + corpo + b"." + assinatura).decode()


def chamar_canario(api_url, nome, apikey, token):
    """Devolve (http_status, trecho). Falha de rede vira (0, erro). Redirecionamento levanta Recusado."""
    validar_url(api_url)  # nenhum segredo sai para destino não validado
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/rest/v1/rpc/{nome}",
        data=b"{}",
        method="POST",
        headers={"apikey": apikey, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with _TRANSPORTE.open(req, timeout=10) as resp:
            return resp.status, resp.read(200).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(200).decode(errors="replace")
    except Recusado:
        raise
    except Exception as e:  # noqa: BLE001 - conexão recusada, timeout durante recarga etc.
        return 0, str(e)


def logs_do_postgrest(container):
    rest = container.replace("supabase_db_", "supabase_rest_", 1)  # supabase_db_<id> -> supabase_rest_<id>
    r = subprocess.run(["docker", "logs", "--tail", "30", rest], capture_output=True, text=True, timeout=20)
    return (r.stdout + r.stderr).strip()


def _interromper(signum, _frame):
    raise SystemExit(128 + signum)  # executa os `finally`: o canário é removido também no prazo do executor


def aguardar(api_url, project_id, workdir, prazo, apikey, segredo):
    # Casar API, project_id, container e workdir ANTES de qualquer SQL: só o rótulo do container não basta,
    # porque toda stack do CLI (inclusive a de outra sessão) tem o rótulo coerente com o próprio nome.
    verificar_alvo(api_url, project_id, workdir)
    container = f"supabase_db_{project_id}"

    nome = f"{PREFIXO}_{secrets.token_hex(8)}"
    token = jwt_authenticated(segredo)
    inicio = time.monotonic()
    tentativas = 0
    ultimo = (None, "")
    restantes = None
    pronto = False
    try:
        psql(container, SQL_REMOVER_CANARIOS)
        psql(container, sql_criar_canario(nome))
        ultimo_notify = None
        while time.monotonic() - inicio < prazo:
            if ultimo_notify is None or time.monotonic() - ultimo_notify >= 10:
                psql(container, "NOTIFY pgrst, 'reload schema';")
                ultimo_notify = time.monotonic()
            tentativas += 1
            ultimo = chamar_canario(api_url, nome, apikey, token)
            if ultimo[0] == 200:
                pronto = True
                break
            time.sleep(0.5)
    except Recusado:
        raise
    except Exception as e:  # noqa: BLE001
        ultimo = (None, f"erro do verificador: {e}")
    finally:
        try:
            restantes = int(psql(container, SQL_REMOVER_CANARIOS + "NOTIFY pgrst, 'reload schema';").split()[-1])
        except Exception as e:  # noqa: BLE001
            print(f"  ERRO: não consegui remover o canário {nome}: {e}", file=sys.stderr)
            restantes = -1
        if restantes != 0:
            print(f"  ERRO: restaram canários no banco ({restantes}).", file=sys.stderr)

    # Pronto só com as duas provas: canário visível pelo cache E nenhum canário deixado no banco.
    if pronto and restantes == 0:
        print(
            f"PostgREST recarregou o schema pós-reset: canário {nome} visível em "
            f"{time.monotonic() - inicio:.1f}s ({tentativas} chamada(s)); canário removido."
        )
        return 0
    if pronto:
        print("PostgREST recarregou, mas a remoção do canário não foi comprovada.", file=sys.stderr)
        return 1

    print(f"PostgREST NÃO recarregou o schema em {prazo:.0f}s ({tentativas} chamadas).", file=sys.stderr)
    print(f"  última resposta do canário: HTTP {ultimo[0]} {ultimo[1]}", file=sys.stderr)
    try:
        print("  --- logs do PostgREST (30 linhas) ---\n" + logs_do_postgrest(container), file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"  (logs indisponíveis: {e})", file=sys.stderr)
    return 1


def main(argv):
    signal.signal(signal.SIGTERM, _interromper)
    signal.signal(signal.SIGINT, _interromper)
    try:
        if argv[:1] == ["--validar-url"] and len(argv) == 2:
            validar_url(argv[1])
            return 0
        if argv[:1] == ["--verificar-alvo"] and len(argv) == 4:
            verificar_alvo(*argv[1:])
            return 0
        apikey = os.environ.get("ANON_KEY", "")
        segredo = os.environ.get("JWT_SECRET", "")
        if len(argv) not in (3, 4) or argv[0].startswith("--") or not apikey or not segredo:
            print(__doc__, file=sys.stderr)
            return 2
        prazo = float(argv[3]) if len(argv) == 4 else 90.0
        return aguardar(argv[0], argv[1], argv[2], prazo, apikey, segredo)
    except Recusado as e:
        print(f"Recusado: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
