#!/usr/bin/env python3
"""Aplica UMA migration versionada num projeto Supabase pela Management API, com conferência
antes e depois. Usado no HML em 09/11/2026 (046–050) e previsto para Production 034 → 050
(docs/runbooks/producao-034-050.md).

Uso:
  python3 -I docs/runbooks/aplicar-migration-api.py <ref> <arquivo.sql> <versão-anterior-esperada>
      -> só confere (padrão): estado atual, versão anterior e se o arquivo pode ser aplicado.
  BS_CONFIRMO_PROJETO=<ref> python3 -I docs/runbooks/aplicar-migration-api.py <ref> <arquivo.sql> <versão-anterior> --executar
      -> aplica.

Garantias:
- Recusa se a última versão registrada no alvo não for a esperada (nada fora de ordem).
- Recusa se o arquivo não terminar no seu próprio COMMIT ou se a versão já estiver registrada.
- Executa o arquivo SEM alterá-lo e registra a versão em supabase_migrations.schema_migrations
  NA MESMA TRANSAÇÃO (o registro entra imediatamente antes do COMMIT do arquivo): ou entra tudo,
  ou nada.
- Depois: a versão nova é a última; nenhuma tabela de public perdeu linhas; nenhuma tabela de
  public ficou sem RLS; as flags financeiras não mudaram. Qualquer divergência sai com código 1
  (a migration já foi aplicada: PARAR e analisar, nunca reaplicar).

O token vem do proxy da sessão (cabeçalho Authorization injetado); este script não lê segredo.
"""
import json
import pathlib
import re
import subprocess
import sys

API = "https://api.supabase.com/v1/projects/{ref}/database/query"


def consulta(ref, sql, somente_leitura=True):
    url = API.format(ref=ref) + ("/read-only" if somente_leitura else "")
    saida = subprocess.run(
        ["curl", "-sS", "-m", "300", "-X", "POST", url, "-H", "Content-Type: application/json",
         "--data-binary", "@-"],
        input=json.dumps({"query": sql}), capture_output=True, text=True,
    )
    try:
        return json.loads(saida.stdout)
    except ValueError:
        return {"erro_bruto": saida.stdout[:500], "stderr": saida.stderr[:500]}


def foto(ref):
    versao = consulta(ref, "select max(version) v, count(*) n from supabase_migrations.schema_migrations")
    contagens = consulta(ref, (
        "select t.table_name n, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c "
        "from public.%I', t.table_name), false, true, '')))[1]::text::int c "
        "from information_schema.tables t where t.table_schema = 'public' and t.table_type = 'BASE TABLE'"))
    sem_rls = consulta(ref, (
        "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1"))
    # A tabela de tarifas só existe a partir da 041: consultá-la antes disso quebraria a leitura.
    motor = consulta(ref, (
        "select to_jsonb(f) - 'changed_at' - 'changed_by' as m from public.financial_engine_settings f limit 1"))
    existe = consulta(ref, "select to_regclass('public.pricing_settings') is not null as e")
    for parte in (versao, contagens, sem_rls, motor, existe):
        if not isinstance(parte, list):
            raise SystemExit(f"STOP: leitura falhou: {parte}")
    tarifas = None
    if existe[0]["e"]:
        lidas = consulta(ref, (
            "select to_jsonb(p) - 'changed_at' - 'changed_by' as t from public.pricing_settings p limit 1"))
        if not isinstance(lidas, list):
            raise SystemExit(f"STOP: leitura falhou: {lidas}")
        tarifas = lidas[0]["t"] if lidas else None
    return {
        "versao": versao[0]["v"], "migrations": versao[0]["n"],
        "contagens": {r["n"]: r["c"] for r in contagens},
        "sem_rls": [r["relname"] for r in sem_rls],
        "flags": {"motor": motor[0]["m"] if motor else None, "tarifas": tarifas},
    }


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    ref, arquivo, anterior = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
    executar = "--executar" in sys.argv[4:]
    m = re.match(r"(\d{14})_(.+)\.sql$", arquivo.name)
    if not m:
        raise SystemExit("STOP: nome de arquivo fora do padrão <versão>_<nome>.sql")
    versao, nome = m.group(1), m.group(2)
    sql = arquivo.read_text(encoding="utf-8")
    fim = sql.rstrip()
    if not fim.lower().endswith("commit;"):
        raise SystemExit("STOP: o arquivo não termina no próprio COMMIT")
    tag = f"$bsmig{versao}$"
    if tag in sql:
        raise SystemExit("STOP: marcador de citação já existe no arquivo")

    antes = foto(ref)
    print(json.dumps({"alvo": ref, "migration": arquivo.name, "antes": antes}, ensure_ascii=False))
    if antes["versao"] != anterior:
        raise SystemExit(f"STOP: última versão é {antes['versao']}, esperada {anterior}")
    if versao <= anterior:
        raise SystemExit("STOP: a migration não é posterior à última aplicada")
    if not executar:
        print("CONFERÊNCIA OK (nada aplicado). Para aplicar: --executar e BS_CONFIRMO_PROJETO=<ref>.")
        return
    import os
    if os.environ.get("BS_CONFIRMO_PROJETO") != ref:
        raise SystemExit("STOP: BS_CONFIRMO_PROJETO não confere com o projeto-alvo")

    pos = fim.lower().rfind("commit;")
    registro = (f"insert into supabase_migrations.schema_migrations(version, name, statements) "
                f"values ('{versao}', '{nome}', array[{tag}{sql}{tag}]);\n")
    resultado = consulta(ref, fim[:pos] + registro + fim[pos:] + "\n", somente_leitura=False)
    print(json.dumps({"aplicacao": resultado}, ensure_ascii=False)[:1500])

    depois = foto(ref)
    perdas = {t: (c, depois["contagens"].get(t)) for t, c in antes["contagens"].items()
              if depois["contagens"].get(t) is None or depois["contagens"][t] < c}
    novas = sorted(set(depois["contagens"]) - set(antes["contagens"]))
    motor_igual = (antes["flags"] or {}).get("motor") == (depois["flags"] or {}).get("motor")
    tarifas_antes = (antes["flags"] or {}).get("tarifas")
    tarifas_depois = (depois["flags"] or {}).get("tarifas") or {}
    # Chave nova (ex.: `dias_especiais_em_dobro`, 051) só é aceita se nascer desligada; as que já
    # existiam têm de continuar iguais.
    tarifas_igual = tarifas_antes is None or (
        all(tarifas_depois.get(k) == v for k, v in tarifas_antes.items())
        and all(v in (False, None) for k, v in tarifas_depois.items() if k not in tarifas_antes))
    ok = (depois["versao"] == versao and depois["migrations"] == antes["migrations"] + 1
          and not perdas and not depois["sem_rls"] and motor_igual and tarifas_igual)
    print(json.dumps({"depois": depois, "tabelas_novas": novas, "perdas": perdas,
                      "motor_igual": motor_igual, "tarifas_iguais": tarifas_igual}, ensure_ascii=False))
    print("RESULTADO:", "PASS" if ok else "FALHA — PARAR, NÃO REAPLICAR")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
