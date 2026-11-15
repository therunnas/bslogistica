#!/usr/bin/env python3
"""GATE-FIN-04B (sessão 21) — atomicidade da migration 053 no PostgreSQL LOCAL.

COMO RODAR (depois de `scripts/testar-sql-local.sh`, com o Supabase local de pé):

  python3 -I scripts/testar-053-transacional-local.py

NUNCA toca HML nem Production: só `docker exec` no container `supabase_db_<project_id>` lido do
`supabase/config.toml` deste repositório (o mesmo endereçamento de `testar-sql-local.sh`), sem host,
porta, token ou API. NÃO executa `docs/runbooks/aplicar-migration-api.py`: reproduz aqui, em texto,
a montagem que ele faz, e envia ao banco local como uma consulta única — que é como a Management
API recebe o texto.

O arquivo original da 053 nunca é alterado: cada caso usa uma cópia em memória.

  P. pré-condição: a 053 aplicada pelo `db reset`; o rollback documentado a remove (estado 052);
  E1. executor de arquivo (psql -f, comando a comando) com falha injetada antes do COMMIT:
      NADA da 053 pode sobrar (sem o envelope, os comandos anteriores já teriam sido gravados);
  E2. montagem do executor remoto (registro da versão antes do COMMIT) + falha injetada logo antes
      do COMMIT, numa consulta única: nem objetos nem registro;
  C.  nenhuma transação aninhada ou órfã: o PostgreSQL não avisa "already/no transaction";
  F.  montagem do executor remoto sem falha: objetos, catálogo e registro (com o texto exato do
      arquivo) presentes, e a suíte SQL 053 (31 casos) passa;
  Z.  limpeza: só o registro de versão fictício, por chave exata e com asserção.

Sai com código 1 se qualquer caso falhar.
"""
import pathlib
import re
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
MIGRATION = RAIZ / "supabase/migrations/20261120120000_053_recusar_intervalo_maior_que_jornada.sql"
ROLLBACK = RAIZ / "docs/runbooks/rollback-recusar-intervalo-maior-que-jornada.sql"
SUITE = RAIZ / "supabase/tests/053_intervalo_maior_que_jornada.sql"
VERSAO_REAL = "20261120120000"
VERSAO_FICTICIA = "29991231235959"  # nunca existe: o registro do teste não colide com o real
FALHA = ("do $falha$ begin raise exception 'GATE-FIN-04B: falha injetada antes do COMMIT'; "
         "end $falha$;\n")

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
PSQL = ["docker", "exec", "-i", C, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"]


def arquivo(texto):
    """Executor de arquivo: psql -f, comando a comando, parando no primeiro erro."""
    p = subprocess.run(PSQL + ["-q", "-f", "-"], input=texto, capture_output=True, text=True, timeout=180)
    return p.returncode, p.stdout + p.stderr


def consulta_unica(texto):
    """Uma única mensagem Query (protocolo simples), como a Management API recebe o texto."""
    p = subprocess.run(PSQL + ["-q", "-c", texto], capture_output=True, text=True, timeout=180)
    return p.returncode, p.stdout + p.stderr


def valor(sql):
    p = subprocess.run(PSQL + ["-At", "-c", sql], capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise SystemExit(f"STOP: leitura falhou: {p.stderr.strip()}")
    return p.stdout.strip()


def estado_053():
    return valor(
        "select (to_regprocedure('public.recusar_intervalo_maior_que_jornada()') is not null)::text || '|' || "
        "exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass "
        "and tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior')::text || '|' || "
        f"exists (select 1 from supabase_migrations.schema_migrations where version = '{VERSAO_FICTICIA}')::text")


def montar_como_o_executor(sql, injetar):
    """A mesma montagem de docs/runbooks/aplicar-migration-api.py (linhas 86–110), em texto."""
    fim = sql.rstrip()
    if not fim.lower().endswith("commit;"):
        return None
    tag = f"$bsmig{VERSAO_FICTICIA}$"
    if tag in sql:
        return None
    pos = fim.lower().rfind("commit;")
    registro = (f"insert into supabase_migrations.schema_migrations(version, name, statements) "
                f"values ('{VERSAO_FICTICIA}', 'teste_gate_fin_04b', array[{tag}{sql}{tag}]);\n")
    return fim[:pos] + registro + (FALHA if injetar else "") + fim[pos:] + "\n"


def com_falha_antes_do_commit(sql):
    fim = sql.rstrip()
    pos = fim.lower().rfind("commit;")
    if fim.lower().endswith("commit;"):
        return fim[:pos] + FALHA + fim[pos:] + "\n"
    return fim + "\n" + FALHA  # sem envelope: a falha vem depois de tudo


def limpar_ficticio():
    """Remove SÓ o registro de versão fictício, por chave exata e com asserção (no máximo 1 linha)."""
    rc, _ = arquivo(f"""begin;
do $z$
declare _n int;
begin
  delete from supabase_migrations.schema_migrations where version = '{VERSAO_FICTICIA}';
  get diagnostics _n = row_count;
  if _n > 1 then raise exception 'limpeza removeria % linhas', _n; end if;
end $z$;
commit;
""")
    return rc


AVISOS = re.compile(r"there is already a transaction in progress|there is no transaction in progress", re.I)

original = MIGRATION.read_text(encoding="utf-8")

print(f"\nContainer local: {C}\n\nP. Pré-condição\n")
# Uma execução anterior interrompida pode ter deixado o registro fictício: removê-lo é seguro (a
# versão 29991231235959 não existe fora deste teste).
limpar_ficticio()
verificar("P1. a 053 está aplicada pelo db reset e o registro fictício não existe", estado_053(), "true|true|false")
verificar("P2. o registro real da 053 existe", valor(
    f"select count(*) from supabase_migrations.schema_migrations where version = '{VERSAO_REAL}'"), "1")
rc, _ = arquivo(ROLLBACK.read_text(encoding="utf-8"))
verificar("P3. o rollback documentado remove função e gatilho (estado 052)", (rc, estado_053()), (0, "false|false|false"))

print("\nE1. Executor de arquivo (psql -f) com falha injetada antes do COMMIT\n")
rc, saida = arquivo(com_falha_antes_do_commit(original))
verificar("E1a. a execução falha na falha injetada", (rc != 0, "falha injetada" in saida), (True, True))
verificar("E1b. rollback integral: nem a função nem o gatilho da 053 ficaram", estado_053(), "false|false|false")
if estado_053() != "false|false|false":
    arquivo(ROLLBACK.read_text(encoding="utf-8"))  # volta ao estado 052 para os casos seguintes

print("\nE2. Montagem do executor remoto + falha injetada logo antes do COMMIT (consulta única)\n")
montado = montar_como_o_executor(original, injetar=True)
verificar("E2a. o arquivo cumpre o contrato do executor (termina no COMMIT, sem o marcador)", montado is not None, True)
if montado is not None:
    rc, saida = consulta_unica(montado)
    verificar("E2b. a execução falha na falha injetada", (rc != 0, "falha injetada" in saida), (True, True))
    verificar("E2c. rollback integral: nem objetos nem o registro da versão", estado_053(), "false|false|false")

print("\nC + F. Montagem do executor remoto, sem falha (consulta única)\n")
montado = montar_como_o_executor(original, injetar=False)
if montado is None:
    verificar("F0. a montagem do executor é possível", False, True)
else:
    rc, saida = consulta_unica(montado)
    verificar("F1. a aplicação conclui sem erro", rc, 0)
    verificar("C1. nenhum aviso de transação aninhada ou órfã", AVISOS.findall(saida), [])
    verificar("F2. função, gatilho e registro da versão presentes, juntos", estado_053(), "true|true|true")
    verificar("F3. gatilho BEFORE INSERT OR UPDATE FOR EACH ROW habilitado; função DEFINER da postgres com search_path", valor(
        "select t.tgtype::text || '|' || t.tgenabled::text || '|' || p.prosecdef::text || '|' || pg_get_userbyid(p.proowner) || '|' || "
        "exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') from pg_trigger t "
        "join pg_proc p on p.oid = t.tgfoid where t.tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior'"),
        "23|O|true|postgres|true")
    verificar("F4. ninguém de fora executa a função (anon, authenticated, service_role, operacional, PUBLIC)", valor(
        "select (select count(*) from unnest(array['anon','authenticated','service_role','bslog_rpc_operacional']) r "
        "where has_function_privilege(r, 'public.recusar_intervalo_maior_que_jornada()'::regprocedure, 'EXECUTE')) + "
        "(select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a "
        "where p.oid = 'public.recusar_intervalo_maior_que_jornada()'::regprocedure and a.grantee = 0 "
        "and a.privilege_type = 'EXECUTE')"), "0")
    verificar("F5. o registro guarda o texto exato do arquivo", valor(
        f"select statements[1] = $t${original}$t$ from supabase_migrations.schema_migrations "
        f"where version = '{VERSAO_FICTICIA}'"), "t")
    rc, saida = arquivo(SUITE.read_text(encoding="utf-8"))
    verificar("F6. a suíte SQL 053 passa sobre a 053 aplicada assim (31 casos)",
              (rc, "GATE-FIN-03 (053): 31 casos conferidos" in saida), (0, True))

print("\nZ. Limpeza (só o registro fictício, por chave exata)\n")
rc = limpar_ficticio()
verificar("Z1. sem registro fictício; o registro real da 053 intacto", (rc, valor(
    f"select count(*) filter (where version = '{VERSAO_FICTICIA}') || '|' || "
    f"count(*) filter (where version = '{VERSAO_REAL}') from supabase_migrations.schema_migrations")), (0, "0|1"))
if estado_053().startswith("false"):
    arquivo(original)  # o RED pode deixar o banco sem a 053: devolve o estado do db reset
verificar("Z2. o banco termina com a 053 aplicada, como o db reset a deixou", estado_053(), "true|true|false")

total, ok = len(resultados), sum(resultados)
print(f"\n{ok} de {total} verificações passaram.\n")
sys.exit(0 if ok == total else 1)
