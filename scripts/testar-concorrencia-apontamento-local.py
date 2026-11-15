#!/usr/bin/env python3
"""GATE-FIN-05 (sessão 22) — concorrência REAL dos apontamentos, em duas conexões PostgreSQL.

COMO RODAR (depois de `scripts/testar-sql-local.sh`, com o Supabase local de pé):

  python3 -I scripts/testar-concorrencia-apontamento-local.py

NUNCA toca HML nem Production: só `docker exec` no container `supabase_db_<project_id>` lido do
`supabase/config.toml` (o mesmo endereçamento de `testar-sql-local.sh`), sem host, porta ou token.

Diferente das suítes SQL (uma transação só) e do E2E com duas abas (que prova a tela, não o banco):
aqui duas sessões `psql` independentes, A e B, abrem transações próprias, e uma terceira (O, só
leitura) espera em `pg_stat_activity` até a sessão B estar de fato BLOQUEADA por lock antes de A
confirmar. A intercalação é determinística.

Cada execução cria a sua fixture sintética com UUIDs novos (o banco local é descartável) e NÃO apaga
nada: o cenário de fatura deixa lançamentos faturados, que são imutáveis por desenho.

  S1  admin × admin — atualização obsoleta, em sequência;
  S2  admin × admin — intercalado: B espera o lock de A e, quando A confirma, recebe 40001;
  S3  operador × operador — intercalado, RPC v2 do operador;
  S4  admin × operador — intercalado;
  S5  PostgREST (escrita direta, legado) × RPC v2 — o legado ainda vence (a 058 vai exigir), mas
      a versão sobe e o v2 seguinte detecta: 40001;
  S6  inclusão simultânea do mesmo colaborador (versão 0): conflito, ou idempotente se igual;
  S7  retentativa depois de resposta perdida: idêntica = sem alteração (versão não sobe);
      diferente = 40001;
  S8  fechamento do dia × gravação, nas duas ordens;
  S9  emissão de fatura × gravação: a fatura espera, sai com o valor confirmado, ao centavo; depois,
      o faturado é imutável também pelo v2.
"""
import json
import pathlib
import queue
import re
import subprocess
import sys
import threading
import time
import uuid

RAIZ = pathlib.Path(__file__).resolve().parent.parent
resultados = []


def verificar(caso, obtido, esperado):
    ok = obtido == esperado
    resultados.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {caso}" + ("" if ok else f" — esperado {esperado!r}, obtido {obtido!r}"))


def container():
    texto = (RAIZ / "supabase/config.toml").read_text(encoding="utf-8")
    m = re.search(r'^project_id\s*=\s*"([^"]+)"', texto, re.M)
    if not m:
        raise SystemExit("STOP: project_id ausente em supabase/config.toml")
    nome = f"supabase_db_{m.group(1)}"
    estado = subprocess.run(["docker", "inspect", "--format", "{{.State.Running}}", nome],
                            capture_output=True, text=True, timeout=30)
    if estado.returncode != 0 or estado.stdout.strip() != "true":
        raise SystemExit(f"STOP: o container local {nome} não existe ou não está rodando")
    return nome


C = container()


class Sessao:
    """Uma conexão psql persistente (uma sessão PostgreSQL de verdade)."""

    def __init__(self, nome):
        self.nome = nome
        self.p = subprocess.Popen(
            ["docker", "exec", "-i", "-e", f"PGAPPNAME={nome}", C, "psql", "-U", "postgres", "-d", "postgres",
             "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=0", "-v", "VERBOSITY=verbose"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.fila = queue.Queue()
        threading.Thread(target=self._ler, daemon=True).start()
        self.n = 0
        self.pendente = None
        self.enviar("\\set VERBOSITY verbose")

    def _ler(self):
        for linha in self.p.stdout:
            self.fila.put(linha.rstrip("\n"))

    def mandar(self, sql):
        """Envia sem esperar (para comandos que vão bloquear)."""
        self.n += 1
        self.pendente = f"__FIM_{self.nome}_{self.n}__"
        # O código do resultado vem da variável :SQLSTATE do psql, escrita no stdout logo depois do
        # comando: a ordem é a do próprio stdout (o stderr do docker exec chega por outro canal).
        self.p.stdin.write(sql.rstrip().rstrip(";") + ";\n\\echo __ST__ :SQLSTATE\n\\echo " + self.pendente + "\n")
        self.p.stdin.flush()

    def receber(self, prazo=60):
        """Lê até o marcador: devolve 'erro <sqlstate>' ou o valor (última linha não vazia)."""
        linhas, fim = [], time.time() + prazo
        while True:
            restante = fim - time.time()
            if restante <= 0:
                raise SystemExit(f"STOP: sessão {self.nome} não respondeu em {prazo}s")
            linha = self.fila.get(timeout=restante)
            if linha == self.pendente:
                break
            linhas.append(linha)
        estado = [l.split(" ", 1)[1].strip() for l in linhas if l.startswith("__ST__ ")]
        if not estado:
            raise SystemExit(f"STOP: sessão {self.nome} sem SQLSTATE")
        if estado[-1] != "00000":
            return "erro " + estado[-1]
        valores = [l for l in linhas if l.strip() and not l.startswith("__ST__ ")]
        return valores[-1] if valores else ""

    def enviar(self, sql, prazo=60):
        self.mandar(sql)
        return self.receber(prazo)

    def fechar(self):
        try:
            self.p.stdin.close()
        except Exception:
            pass
        self.p.wait(timeout=30)


O = Sessao("obs_gf05")
A = Sessao("ses_a_gf05")
B = Sessao("ses_b_gf05")


def esperar_bloqueio(sessao, prazo=15):
    fim = time.time() + prazo
    while time.time() < fim:
        if O.enviar(f"select count(*) from pg_stat_activity where application_name = '{sessao.nome}' "
                    "and state = 'active' and wait_event_type = 'Lock'") == "1":
            return True
        time.sleep(0.1)
    return False


RUN = uuid.uuid4().hex[:8]


def u(tipo, n):
    """UUID determinístico desta execução: 'gf05' + run + tipo + número."""
    return str(uuid.UUID(f"{RUN}{tipo:0>4}{n:0>20}"[:32]))


ADM, OPE = u("a", 1), u("a", 2)
CLI, CLI_F = u("c", 1), u("c", 2)
OP, OP_F = u("e", 1), u("e", 2)
TURNO, TURNO_F = u("5", 1), u("5", 2)
EMP = [u("f", n) for n in range(1, 10)]


def claims(uid):
    return json.dumps({"sub": uid, "role": "authenticated", "aal": "aal1", "session_id": u("d", int(uid[-2:], 16))})


def como(uid):
    return f"set local role authenticated; select set_config('request.jwt.claims', '{claims(uid)}', true)"


def linha(emp, ent, sai, intervalo, versao, status="present"):
    return {"employee_id": emp, "status": status, "check_in": ent, "check_out": sai, "break_minutes": intervalo,
            "notes": None, "versao_esperada": versao}


def v2(funcao, op, turno, data, linhas):
    return (f"select (r -> 'linhas' -> 0 ->> 'resultado') || '|' || (r -> 'linhas' -> 0 ->> 'versao') from "
            f"(select public.{funcao}('{op}'::uuid, '{turno}'::uuid, '{data}'::date, '{json.dumps(linhas)}'::jsonb) r) x")


def adm_v2(data, linhas, op=OP, turno=TURNO):
    return v2("salvar_apontamento_admin_v2", op, turno, data, linhas)


def ope_v2(data, linhas):
    return v2("salvar_apontamento_operacional_v2", OP, TURNO, data, linhas)


def estado(emp, data, op=OP):
    return O.enviar(f"select check_in || '-' || check_out || '/v' || coalesce(to_jsonb(te) ->> 'versao', '?') "
                    f"from public.timesheet_entries te where employee_id = '{emp}' and work_date = '{data}' and operation_id = '{op}'")


def versao(emp, data, op=OP):
    v = O.enviar(f"select to_jsonb(te) ->> 'versao' from public.timesheet_entries te where employee_id = '{emp}' "
                 f"and work_date = '{data}' and operation_id = '{op}'")
    return int(v) if v.isdigit() else -1


def transacao(sessao, uid, sql):
    """Uma chamada numa transação própria, confirmada (ou desfeita, se falhar)."""
    sessao.enviar("begin")
    sessao.enviar(como(uid))
    r = sessao.enviar(sql)
    sessao.enviar("rollback" if r.startswith("erro") else "commit")
    return r


# ---------------------------------------------------------------------------
# Fixture (confirmada; o banco local é descartável)
# ---------------------------------------------------------------------------

print(f"\nContainer local: {C} · execução {RUN}\n")
equipe = ", ".join(f"('{OP}', '{TURNO}', '{e}', true)" for e in EMP[:6])
r = O.enviar(f"""begin;
insert into auth.users (id) values ('{ADM}'), ('{OPE}');
insert into auth.sessions (id, user_id, not_after) values ('{u("d", 1)}', '{ADM}', null), ('{u("d", 2)}', '{OPE}', null);
insert into public.user_roles (user_id, role) values ('{ADM}', 'admin'), ('{OPE}', 'operacional');
insert into public.clients (id, name) values ('{CLI}', 'GF05-CONC {RUN}'), ('{CLI_F}', 'GF05-CONC-F {RUN}');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from) values
  ('{u("b", 1)}', '{CLI}', 'K', 200, 8, 1.5, 10, '2026-01-01'), ('{u("b", 2)}', '{CLI_F}', 'KF', 200, 8, 1.5, 10, '2026-01-01');
insert into public.operations (id, client_id, contract_id, type, name) values
  ('{OP}', '{CLI}', '{u("b", 1)}', 'fixed', 'GF05-CONC {RUN}'), ('{OP_F}', '{CLI_F}', '{u("b", 2)}', 'fixed', 'GF05-CONC-F {RUN}');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('{TURNO}', '{OP}', 'Dia', '08:00', '17:00', 60, false), ('{TURNO_F}', '{OP_F}', 'Dia', '08:00', '17:00', 60, false);
insert into public.employees (id, name, daily_cost) select x, 'GF05-CONC ' || x, 120 from unnest(array['{"','".join(EMP)}']::uuid[]) x;
insert into public.operation_team (operation_id, shift_id, employee_id, active) values {equipe};
insert into public.user_operation_access (user_id, operation_id) values ('{OPE}', '{OP}');
commit""")
if (MOTOR := O.enviar("select vigencia_ativa from public.financial_engine_settings")) == "t":
    raise SystemExit("STOP: este teste espera o motor por vigência desligado (banco do runner SQL)")

# ---------------------------------------------------------------------------
print("S1. admin × admin — atualização obsoleta (sequencial)\n")
D = "2026-04-01"
verificar("S1a. A inclui (versão 0 → 1)", transacao(A, ADM, adm_v2(D, [linha(EMP[0], "08:00", "17:00", 60, 0)])), "inserido|1")
verificar("S1b. A altera com a versão 1 (→ 2)", transacao(A, ADM, adm_v2(D, [linha(EMP[0], "08:00", "18:00", 60, 1)])), "atualizado|2")
verificar("S1c. B, que leu a versão 1, grava outro conteúdo: 40001", transacao(B, ADM, adm_v2(D, [linha(EMP[0], "08:00", "16:00", 60, 1)])), "erro 40001")
verificar("S1d. vale o que A gravou", estado(EMP[0], D), "08:00:00-18:00:00/v2")

# ---------------------------------------------------------------------------
print("\nS2. admin × admin — intercalado, B bloqueado no lock de A\n")
A.enviar("begin"); A.enviar(como(ADM))
verificar("S2a. A altera com a versão 2 (ainda sem confirmar)", A.enviar(adm_v2(D, [linha(EMP[0], "07:00", "18:00", 60, 2)])), "atualizado|3")
B.enviar("begin"); B.enviar(como(ADM))
B.mandar(adm_v2(D, [linha(EMP[0], "09:00", "18:00", 60, 2)]))
verificar("S2b. B, com a mesma versão 2, fica bloqueado esperando A (lock real)", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S2c. A confirma; B acorda e recebe 40001 (sem perder a gravação de A)", B.receber(), "erro 40001")
B.enviar("rollback")
verificar("S2d. vale o que A gravou, versão 3", estado(EMP[0], D), "07:00:00-18:00:00/v3")

# ---------------------------------------------------------------------------
print("\nS3. operador × operador — intercalado (RPC v2 do operador)\n")
D = "2026-04-02"
verificar("S3a. operador inclui", transacao(A, OPE, ope_v2(D, [linha(EMP[1], "08:00", "17:00", 60, 0)])), "inserido|1")
A.enviar("begin"); A.enviar(como(OPE))
verificar("S3b. sessão A do operador altera (sem confirmar)", A.enviar(ope_v2(D, [linha(EMP[1], "08:00", "16:00", 60, 1)])), "atualizado|2")
B.enviar("begin"); B.enviar(como(OPE))
B.mandar(ope_v2(D, [linha(EMP[1], "08:00", "15:00", 60, 1)]))
verificar("S3c. sessão B do operador fica bloqueada", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S3d. B recebe 40001", B.receber(), "erro 40001")
B.enviar("rollback")
verificar("S3e. vale A", estado(EMP[1], D), "08:00:00-16:00:00/v2")

# ---------------------------------------------------------------------------
print("\nS4. admin × operador — intercalado\n")
A.enviar("begin"); A.enviar(como(ADM))
verificar("S4a. admin altera com a versão 2 (sem confirmar)", A.enviar(adm_v2(D, [linha(EMP[1], "08:00", "17:30", 60, 2)])), "atualizado|3")
B.enviar("begin"); B.enviar(como(OPE))
B.mandar(ope_v2(D, [linha(EMP[1], "08:00", "15:00", 60, 2)]))
verificar("S4b. o operador fica bloqueado", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S4c. o operador recebe 40001", B.receber(), "erro 40001")
B.enviar("rollback")
verificar("S4d. vale o admin", estado(EMP[1], D), "08:00:00-17:30:00/v3")

# ---------------------------------------------------------------------------
print("\nS5. PostgREST direto (legado, sem versão) × RPC v2\n")
D = "2026-04-03"
transacao(A, ADM, adm_v2(D, [linha(EMP[2], "08:00", "17:00", 60, 0)]))
A.enviar("begin"); A.enviar(como(ADM))
verificar("S5a. v2 altera com a versão 1 (sem confirmar)", A.enviar(adm_v2(D, [linha(EMP[2], "08:00", "18:00", 60, 1)])), "atualizado|2")
B.enviar("begin"); B.enviar(como(ADM))
B.mandar(f"with x as (update public.timesheet_entries set check_out = '16:00' where employee_id = '{EMP[2]}' and work_date = '{D}' returning 1) select count(*) from x")
verificar("S5b. a escrita direta espera o lock do v2", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S5c. [LEGADO, a 058 vai recusar] a escrita direta sem versão ainda sobrescreve", B.receber(), "1")
B.enviar("commit")
verificar("S5d. mas a versão sobe (3) — o banco registra a mudança", estado(EMP[2], D), "08:00:00-16:00:00/v3")
verificar("S5e. o v2 que ainda acha que é a versão 2 recebe 40001", transacao(A, ADM, adm_v2(D, [linha(EMP[2], "08:00", "18:30", 60, 2)])), "erro 40001")

# ---------------------------------------------------------------------------
print("\nS6. inclusão simultânea do mesmo colaborador (versão 0)\n")
D = "2026-04-06"
A.enviar("begin"); A.enviar(como(ADM))
verificar("S6a. A inclui (sem confirmar)", A.enviar(adm_v2(D, [linha(EMP[3], "08:00", "17:00", 60, 0)])), "inserido|1")
B.enviar("begin"); B.enviar(como(OPE))
B.mandar(ope_v2(D, [linha(EMP[3], "08:00", "16:00", 60, 0)]))
verificar("S6b. B (operador) inclui o mesmo colaborador e espera o índice único", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S6c. conteúdo diferente: 40001, sem segunda linha", B.receber(), "erro 40001")
B.enviar("rollback")
verificar("S6d. uma linha só, a de A", O.enviar(f"select count(*) || '|' || max(check_out) from public.timesheet_entries where employee_id = '{EMP[3]}' and work_date = '{D}'"), "1|17:00:00")
D2 = "2026-04-07"
A.enviar("begin"); A.enviar(como(ADM))
A.enviar(adm_v2(D2, [linha(EMP[3], "08:00", "17:00", 60, 0)]))
B.enviar("begin"); B.enviar(como(ADM))
B.mandar(adm_v2(D2, [linha(EMP[3], "08:00", "17:00", 60, 0)]))
verificar("S6e. mesma inclusão idêntica em paralelo: B espera", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S6f. conteúdo idêntico: B vê sem alteração, versão 1 (não duplica)", B.receber(), "sem_alteracao|1")
B.enviar("commit")

# ---------------------------------------------------------------------------
print("\nS7. retentativa depois de resposta perdida\n")
D = "2026-04-08"
transacao(A, ADM, adm_v2(D, [linha(EMP[4], "08:00", "17:00", 60, 0)]))
verificar("S7a. A grava a versão 1 → 2 e 'perde a resposta'", transacao(A, ADM, adm_v2(D, [linha(EMP[4], "08:00", "18:00", 60, 1)])), "atualizado|2")
verificar("S7b. A repete o MESMO pedido (versão 1): sem alteração, versão continua 2", transacao(A, ADM, adm_v2(D, [linha(EMP[4], "08:00", "18:00", 60, 1)])), "sem_alteracao|2")
verificar("S7c. o mesmo pedido pelo operador também é idempotente", transacao(B, OPE, ope_v2(D, [linha(EMP[4], "08:00", "18:00", 60, 1)])), "sem_alteracao|2")
verificar("S7d. versão 1 com conteúdo diferente: 40001", transacao(A, ADM, adm_v2(D, [linha(EMP[4], "08:00", "19:00", 60, 1)])), "erro 40001")
verificar("S7e. a versão não subiu com as repetições", versao(EMP[4], D), 2)

# ---------------------------------------------------------------------------
print("\nS8. fechamento do dia × gravação\n")
D = "2026-04-09"
transacao(A, ADM, adm_v2(D, [linha(EMP[5], "08:00", "17:00", 60, 0)]))
FOLHA = O.enviar(f"select id from public.timesheets where operation_id = '{OP}' and work_date = '{D}'")
A.enviar("begin"); A.enviar(como(ADM))
verificar("S8a. A grava (sem confirmar; trava a folha FOR SHARE)", A.enviar(adm_v2(D, [linha(EMP[5], "08:00", "16:00", 60, 1)])), "atualizado|2")
B.enviar("begin"); B.enviar(como(ADM))
B.mandar(f"with x as (update public.timesheets set status = 'closed' where id = '{FOLHA}' returning 1) select count(*) from x")
verificar("S8b. fechar o dia espera a gravação em curso", esperar_bloqueio(B), True)
A.enviar("commit")
verificar("S8c. A confirma; o fechamento acontece depois", B.receber(), "1")
B.enviar("commit")
verificar("S8d. gravar depois de fechado: 55000 (nada muda)", transacao(A, ADM, adm_v2(D, [linha(EMP[5], "08:00", "15:00", 60, 2)])), "erro 55000")
verificar("S8e. vale a gravação de antes do fechamento", estado(EMP[5], D), "08:00:00-16:00:00/v2")
D = "2026-04-10"
transacao(A, ADM, adm_v2(D, [linha(EMP[5], "08:00", "17:00", 60, 0)]))
FOLHA = O.enviar(f"select id from public.timesheets where operation_id = '{OP}' and work_date = '{D}'")
B.enviar("begin"); B.enviar(como(ADM))
B.enviar(f"update public.timesheets set status = 'closed' where id = '{FOLHA}'")
A.enviar("begin"); A.enviar(como(OPE))
A.mandar(ope_v2(D, [linha(EMP[5], "08:00", "16:00", 60, 1)]))
verificar("S8f. ordem inversa: o operador espera o fechamento em curso", esperar_bloqueio(A), True)
B.enviar("commit")
verificar("S8g. o fechamento confirma; o operador é recusado (42501), nada gravado", A.receber(), "erro 42501")
A.enviar("rollback")
verificar("S8h. a linha ficou como estava", estado(EMP[5], D), "08:00:00-17:00:00/v1")

# ---------------------------------------------------------------------------
print("\nS9. emissão de fatura × gravação\n")
D = "2026-04-13"
for i, emp in enumerate(EMP[6:8]):
    O.enviar(f"insert into public.operation_team (operation_id, shift_id, employee_id, active) values ('{OP_F}', '{TURNO_F}', '{emp}', true)")
    transacao(A, ADM, adm_v2(D, [linha(emp, "08:00", "17:00", 60, 0)], op=OP_F, turno=TURNO_F))
A.enviar("begin"); A.enviar(como(ADM))
verificar("S9a. A estende a jornada (sem confirmar) — vira HE", A.enviar(adm_v2(D, [linha(EMP[6], "08:00", "19:00", 60, 1)], op=OP_F, turno=TURNO_F)), "atualizado|2")
B.enviar("begin"); B.enviar(como(ADM))
B.mandar(f"select (public.gerar_fatura('{CLI_F}', '2026-04-01', '2026-04-15')).id")
verificar("S9b. a emissão espera a gravação em curso", esperar_bloqueio(B), True)
A.enviar("commit")
FATURA = B.receber()
verificar("S9c. a fatura sai depois", bool(re.match(r"^[0-9a-f-]{36}$", FATURA)), True)
B.enviar("commit")
verificar("S9d. ao centavo: total = Σ dos lançamentos já com a HE confirmada (275.00 + 200.00); versões +1 do vínculo",
          O.enviar(f"select i.total_amount || '|' || string_agg(te.billed_amount::text || '/v' || (to_jsonb(te) ->> 'versao'), ',' order by te.billed_amount desc) "
                   f"from public.invoices i join public.timesheet_entries te on te.invoice_id = i.id where i.id = '{FATURA}' group by i.total_amount"),
          "475.00|275.00/v3,200.00/v2")
verificar("S9e. depois de faturado, nem o v2 com a versão certa altera (42501)",
          transacao(A, ADM, adm_v2(D, [linha(EMP[6], "08:00", "17:00", 60, 3)], op=OP_F, turno=TURNO_F)), "erro 42501")

for s in (A, B, O):
    s.fechar()
total, ok = len(resultados), sum(resultados)
print(f"\n{ok} de {total} verificações passaram.\n")
sys.exit(0 if ok == total else 1)
