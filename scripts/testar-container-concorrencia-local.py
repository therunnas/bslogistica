#!/usr/bin/env python3
"""FIN11B: concorrência real em Supabase LOCAL descartável já migrado.

Uso: python3 scripts/testar-container-concorrencia-local.py /private/tmp/bs-fin11-local-XXXX
Não inicia/reset banco. Confere path, project_id, labels, volume e rede antes de
qualquer SQL. Fixtures sintéticas são COMMITadas para visibilidade entre sessões;
a limpeza pertence ao descarte desse projeto local, não há DELETE de auditoria.
"""

import concurrent.futures
import json
import pathlib
import re
import subprocess
import sys
import time


def fail(message):
    raise RuntimeError(message)


def docker(*args, stdin=None, timeout=20):
    return subprocess.run(
        ["docker", *args], input=stdin, capture_output=True, text=True, timeout=timeout,
    )


def assert_target(directory):
    path = pathlib.Path(directory).resolve()
    if not re.fullmatch(r"/private/tmp/bs-fin11-local-[a-z0-9]+", str(path)):
        fail("Alvo precisa ser o diretório local descartável FIN11B autorizado.")
    project = path.name
    config = path / "supabase" / "config.toml"
    if not config.is_file() or not re.search(
        rf'^project_id\s*=\s*"{re.escape(project)}"\s*$', config.read_text(), re.M,
    ):
        fail("project_id diverge do diretório descartável.")
    if (path / "supabase" / ".temp" / "project-ref").exists():
        fail("Alvo com project-ref remoto não é permitido.")
    container = "supabase_db_" + project
    inspected = docker("inspect", container)
    if inspected.returncode:
        fail("Não foi possível inspecionar o único container alvo.")
    data = json.loads(inspected.stdout)
    if len(data) != 1:
        fail("Inventário do container divergente.")
    info = data[0]
    labels = info["Config"].get("Labels", {})
    if labels.get("com.supabase.cli.project") != project:
        fail("Label project divergente.")
    if labels.get("com.supabase.cli.workdir") != str(path):
        fail("Label workdir divergente.")
    mounts = info.get("Mounts", [])
    if len(mounts) != 1 or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != container:
        fail("Volume não pertence exclusivamente ao projeto local.")
    networks = info["NetworkSettings"].get("Networks", {})
    if list(networks) != ["supabase_network_" + project]:
        fail("Rede não pertence exclusivamente ao projeto local.")
    if not info["State"].get("Running"):
        fail("Container alvo não está em execução.")
    return container


TARGET = assert_target(sys.argv[1] if len(sys.argv) == 2 else "")
ADMIN = "5c45a100-0000-4000-8000-000000000001"
SESSION = "ec45a100-0000-4000-8000-000000000001"
EMPLOYEE = "5c45f100-0000-4000-8000-000000000001"
CLIENTS = [f"5c45c100-0000-4000-8000-{n:012d}" for n in range(1, 4)]
KEYS = [f"5c45d100-0000-4000-8000-{n:012d}" for n in range(1, 4)]
CLAIMS = json.dumps({"sub": ADMIN, "role": "authenticated", "aal": "aal1", "session_id": SESSION})
AUTH = f"select set_config('request.jwt.claims','{CLAIMS}',true); set local role authenticated;"


def sql(statement, expect_error=None):
    result = docker(
        "exec", "-i", TARGET, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", stdin=statement,
    )
    if expect_error:
        if result.returncode == 0 or expect_error not in result.stderr:
            fail(f"Esperava SQLSTATE {expect_error}; retorno={result.returncode}; {result.stderr}")
    elif result.returncode:
        fail("SQL local falhou: " + result.stderr)
    return result.stdout.strip()


def payload(client):
    return json.dumps({
        "clienteId": client, "operacaoId": None, "solicitadoEm": "2026-02-02",
        "executadoEm": "2026-02-03", "descricao": "Concorrência sintética FIN11B",
        "quantidade": 3, "receitaCentavos": 10001, "custoTotalCentavos": 3003,
        "referencia": "CONCORRENCIA-SINTETICA-045", "modalidadeCusto": "por_pessoa",
        "competenciaCobranca": None,
        "participantes": [{"colaboradorId": EMPLOYEE, "custoCentavos": 3003}],
    }, ensure_ascii=False)


def register(client, key):
    return f"select public.registrar_servico_container('{payload(client)}'::jsonb,'{key}','Concorrência sintética 045')::text;"


def transaction(statement, app, hold=False):
    # A primeira sessão segura a trava transacional depois da mutação. A segunda
    # precisa esperar essa mesma trava; pg_stat_activity prova a sobreposição.
    return (
        f"begin; set local statement_timeout='12s'; set local application_name='{app}'; "
        + AUTH + statement + ("select pg_sleep(3);" if hold else "") + "commit;"
    )


def wait_for_lock(app):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        active = sql(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event_type='Lock';")
        if active == "1":
            return
        time.sleep(0.05)
    fail("A segunda sessão não demonstrou espera por trava; concorrência não comprovada.")


def run_order(first_sql, second_sql, name, second_error=None):
    first_app = "fin11b_" + name + "_first"
    second_app = "fin11b_" + name + "_second"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(sql, transaction(first_sql, first_app, hold=True))
        # Espera a primeira sessão chegar ao pg_sleep, garantindo a posse da trava.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if sql(f"select count(*) from pg_stat_activity where application_name='{first_app}' and wait_event='PgSleep';") == "1":
                break
            time.sleep(0.05)
        else:
            first.result()
            fail("Primeira sessão não segurou a trava durante a prova.")
        second = pool.submit(sql, transaction(second_sql, second_app), second_error)
        wait_for_lock(second_app)
        first_result, second_result = first.result(), second.result()
    return first_result, second_result


# Fixture própria, sem ON CONFLICT: executar duas vezes no mesmo banco falha antes
# de reutilizar dados de outra execução. Todas as entidades têm UUIDs exatos.
sql(f"""
begin;
insert into auth.users(id) values('{ADMIN}');
insert into auth.sessions(id,user_id,not_after) values('{SESSION}','{ADMIN}',null);
insert into public.user_roles(user_id,role) values('{ADMIN}','admin');
insert into public.employees(id,name,daily_cost) values('{EMPLOYEE}','CONCORRENCIA-SINTETICA-045',80);
insert into public.clients(id,name) values
 ('{CLIENTS[0]}','CONCORRENCIA-045-1'),('{CLIENTS[1]}','CONCORRENCIA-045-2'),('{CLIENTS[2]}','CONCORRENCIA-045-3');
commit;
""")

# Mesma chave + mesmo payload em duas sessões realmente simultâneas.
first, second = run_order(register(CLIENTS[0], KEYS[0]), register(CLIENTS[0], KEYS[0]), "idempotencia")
ids1 = re.findall(r"(?m)^[0-9a-f-]{36}$", first)
ids2 = re.findall(r"(?m)^[0-9a-f-]{36}$", second)
if len(ids1) != 1 or ids1 != ids2:
    fail("Idempotência concorrente não retornou o mesmo UUID.")
counts = sql(f"""
select (select count(*) from public.container_services where client_id='{CLIENTS[0]}')||'|'||
 (select count(*) from public.billing_additionals where client_id='{CLIENTS[0]}')||'|'||
 (select count(*) from public.container_service_participants where service_id='{ids1[0]}')||'|'||
 (select count(*) from public.container_service_audit where service_id='{ids1[0]}' and action='registered');
""")
if counts != "1|1|1|1":
    fail("Idempotência concorrente duplicou lastro: " + counts)
print("PASS concorrência real: mesma chave retorna mesmo UUID, um serviço/receita/participante/auditoria")

# Ambas as ordens de cancelamento × fatura, com espera real na trava do cliente.
for n, cancel_first in [(1, True), (2, False)]:
    service = sql(transaction(register(CLIENTS[n], KEYS[n]), "fin11b_prepare")).splitlines()[-1]
    cancel = f"select public.cancelar_servico_container('{service}','Cancelamento concorrente sintético');"
    invoice = f"select (public.gerar_fatura('{CLIENTS[n]}','2026-02-01','2026-02-15')).id::text;"
    if cancel_first:
        run_order(cancel, invoice, "cancel_vence", "P0002")
        state = sql(f"""select (s.canceled_at is not null)::text||'|'||(a.canceled_at is not null)::text||'|'||
         (a.invoice_id is null)::text||'|'||(select count(*) from public.invoices where client_id=s.client_id)
         from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id where s.id='{service}';""")
        if state != "true|true|true|0":
            fail("Cancelamento vencedor deixou fatura inconsistente: " + state)
        print("PASS corrida real: cancelamento vence; fatura recusa P0002 e nenhum vínculo nasce")
    else:
        run_order(invoice, cancel, "fatura_vence", "55000")
        state = sql(f"""select (s.canceled_at is null)::text||'|'||(a.canceled_at is null)::text||'|'||i.total_amount||'|'||i.total_cost||'|'||
         (select count(*) from public.invoice_items where invoice_id=i.id)
         from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id
         join public.invoices i on i.id=a.invoice_id where s.id='{service}';""")
        if state != "true|true|100.01|30.03|1":
            fail("Fatura vencedora perdeu receita/custo/imutabilidade: " + state)
        print("PASS corrida real: fatura vence; cancelamento recusa 55000 e receita/custo ficam congelados")
print("FIN11B: 3 provas de concorrência real PASS; fixtures somente no projeto descartável informado.")
