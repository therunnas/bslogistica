#!/usr/bin/env python3
"""FIN10: comparação OFF independente, catálogo e rollback. Apenas instância exclusiva desta execução.
Uso: python3 scripts/testar-calendario-territorial-local.py /private/tmp/bs-fin10-local-<id>
Não provisiona nem remove recursos Docker. Recusa configuração ligada a projeto remoto.
"""
import difflib
import json
from pathlib import Path
import re
from _executar_local import run_local
import sys

SOURCE = Path(__file__).resolve().parent.parent
LOCAL = Path(sys.argv[1]).resolve()
PROJECT = LOCAL.name
if not str(LOCAL).startswith('/private/tmp/bs-fin10-local-'):
    raise SystemExit('Workdir descartável FIN10 obrigatório')
CONFIG = (LOCAL / 'supabase/config.toml').read_text()
if re.search(r'^project_id\s*=\s*"([^"]+)"', CONFIG, re.M)[1] != PROJECT:
    raise SystemExit('project_id diverge da execução isolada')
if (LOCAL / 'supabase/.temp/project-ref').exists():
    raise SystemExit('Vínculo remoto não permitido')
CONTAINER = 'supabase_db_' + PROJECT
EVIDENCE = LOCAL / 'fin10-evidence'
EVIDENCE.mkdir(exist_ok=True)


COMMAND_TIMEOUT = 120


def command(args, sql=None, check=True, timeout=None, env=None):
    r = run_local(args, input=sql, timeout=COMMAND_TIMEOUT if timeout is None else timeout, env=env)
    if check and r.returncode:
        raise RuntimeError(r.stderr[-2500:])
    return r


def guard():
    state = json.loads(command(['docker', 'inspect', CONTAINER]).stdout)[0]
    labels = state['Config']['Labels']
    assert labels['com.supabase.cli.project'] == PROJECT
    assert Path(labels['com.supabase.cli.workdir']).resolve() == LOCAL
    assert state['State']['Running']
    assert all(m.get('Name') == CONTAINER for m in state['Mounts'])
    assert set(state['NetworkSettings']['Networks']) == {'supabase_network_' + PROJECT}


def sql(text, check=True):
    guard()
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres',
                    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], text, check)


def file(name, commit=False):
    text = (SOURCE / name).read_text()
    if commit:
        assert text.rstrip().endswith('rollback;')
        text = text.rstrip()[:-len('rollback;')] + 'commit;\n'
    r = sql(text)
    (EVIDENCE / (Path(name).name + '.log')).write_text(r.stdout + r.stderr)
    return r


def reset043():
    print('Preparando referência local até a 043...', flush=True)
    guard()
    import os
    env = dict(os.environ)
    env.pop('SUPABASE_ACCESS_TOKEN', None)
    env.pop('SUPABASE_PROJECT_ID', None)
    r = command(['env', '-u', 'SUPABASE_ACCESS_TOKEN', 'npx', '--yes', 'supabase@2.117.0',
                 'db', 'reset', '--local', '--version', '20261110120000',
                 '--workdir', str(LOCAL)], check=False, timeout=300, env=env)
    (EVIDENCE / 'reset043.log').write_text(r.stdout + r.stderr)
    if r.returncode:
        raise RuntimeError('Reset local falhou; ver log no diretório de evidências')
    guard()


MIGRATION = 'supabase/migrations/20261111120000_044_calendario_territorial.sql'
ROLLBACK = 'docs/runbooks/rollback-calendario-territorial.sql'
TABLES = ['clients', 'contracts', 'employees', 'operations', 'shifts', 'job_functions', 'operation_team',
          'contract_terms', 'employee_cost_terms', 'operation_terms', 'contract_rate_terms',
          'contract_employee_rates', 'timesheets', 'timesheet_entries', 'invoices', 'invoice_items',
          'financial_holidays', 'billing_additionals', 'pricing_settings', 'financial_engine_settings']


def data(include_special=False):
    raw = {}
    for table in TABLES + (['municipality_catalog','operation_location_terms','financial_calendar_coverage'] if include_special else []):
        raw[table] = json.loads(sql(f"select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.{table} t;").stdout)
    refs = {}
    keys = {
        'job_functions': ['code'], 'operation_team': ['operation_id', 'shift_id', 'employee_id'], 'contract_terms': ['contract_id', 'valid_from'],
        'employee_cost_terms': ['employee_id', 'valid_from'], 'operation_terms': ['operation_id', 'valid_from'],
        'contract_rate_terms': ['contract_id', 'job_function_id', 'shift_period', 'valid_from'],
        'contract_employee_rates': ['contract_id', 'employee_id', 'valid_from'],
        'timesheets': ['operation_id', 'shift_id', 'work_date'],
        'timesheet_entries': ['timesheet_id', 'employee_id'], 'invoices': ['client_id', 'period_start', 'period_end'],
        'invoice_items': ['invoice_id', 'kind', 'operation_id', 'description'], 'financial_holidays': ['holiday_date'],
    }
    for table, fields in keys.items():
        for row in raw[table]:
            refs[row['id']] = table + ':' + '|'.join(str(refs.get(row.get(k), row.get(k))) for k in fields)
    def normalize(v):
        if isinstance(v, str):
            return refs.get(v, v)
        if isinstance(v, list):
            return sorted((normalize(i) for i in v), key=lambda x: json.dumps(x, sort_keys=True))
        if isinstance(v, dict):
            # Apenas metadados voláteis e a coluna nova, inexistente no oráculo 042.
            return {k: normalize(x) for k, x in sorted(v.items()) if k not in
                    ({'created_at', 'updated_at', 'changed_at', 'shift_period_set_at'} | (set() if include_special else {'territorial_calendar_snapshot','territory_scope','state_code','municipality_code','legal_act','official_url','verification_status','holiday_kind','is_movable','client_confirmed'}))}
        return v
    return normalize(raw)


def catalog():
    return json.loads(sql((SOURCE / 'scripts/fixtures/fin09/catalogo.sql').read_text()).stdout)


def save(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def equal(a, b, label):
    if a != b:
        diff = '\n'.join(difflib.unified_diff(json.dumps(a, indent=2, sort_keys=True).splitlines(),
                                              json.dumps(b, indent=2, sort_keys=True).splitlines()))
        (EVIDENCE / 'failure.diff').write_text(diff)
        raise AssertionError(label + ': divergência; ver failure.diff')
    print('PASS:', label, flush=True)


NEW_TABLES = {'municipality_catalog','operation_location_terms','financial_calendar_coverage'}
RPCS = {'catalogar_municipio(text,text,text,text,text)','registrar_local_operacao(uuid,text,date,text,boolean,date)',
        'registrar_feriado_territorial(jsonb,text)','confirmar_cobertura_calendario(jsonb,text)',
        'aposentar_cobertura_calendario(uuid,text)','consultar_calendario_operacao(uuid,date)'}
INTERNAL = {'calendario_uf_do_ibge(text)','calendario_fonte_oficial(text)',
            'calendario_territorio_valido(text,text,text)','proteger_lastro_territorial()',
            'calendario_da_operacao_interno(uuid,date)','motor_tipo_do_dia(date,uuid)',
            'segmentar_jornada_civil(date,time without time zone,time without time zone,integer,time without time zone,time without time zone)',
            'proteger_snapshot_territorial()','proteger_data_territorial_folha()'}
INVOKER = {'calendario_uf_do_ibge(text)','calendario_fonte_oficial(text)',
           'calendario_territorio_valido(text,text,text)','proteger_lastro_territorial()',
           'segmentar_jornada_civil(date,time without time zone,time without time zone,integer,time without time zone,time without time zone)',
           'proteger_snapshot_territorial()','proteger_data_territorial_folha()'}
CHANGED = {'function:derivar_valores_por_vigencia()','function:estado_motor_vigencia()',
           'function:motor_tipo_do_dia(date)'}
NEW_HOLIDAY_COLUMNS = {'territory_scope','state_code','municipality_code','legal_act','official_url',
                       'verification_status','holiday_kind','is_movable','client_confirmed'}


def compare_catalog(base, new):
    changes = {}
    for key in sorted(base.keys() | new.keys()):
        before, after = base.get(key), new.get(key)
        if before == after:
            continue
        changes[key] = {'before':before,'after':after}
        if key.startswith('function:'):
            if before is not None and after is not None:
                assert key in CHANGED, 'Corpo não previsto: ' + key
                equal({k:v for k,v in before.items() if k!='def'},
                      {k:v for k,v in after.items() if k!='def'}, 'owner/ACL/definer/config preservados ' + key)
                continue
            sig=key[len('function:'):]
            assert before is None and sig in RPCS|INTERNAL, 'Assinatura inesperada: ' + key
            config=['search_path=pg_catalog, public, pg_temp']
            if sig in {'calendario_uf_do_ibge(text)','calendario_fonte_oficial(text)'}: config=['search_path=pg_catalog']
            if sig=='calendario_territorio_valido(text,text,text)': config=['search_path=pg_catalog, public']
            expected={'owner':'postgres','acl':(['authenticated=X/postgres','postgres=X/postgres'] if sig in RPCS else ['postgres=X/postgres']),
                      'security_definer':sig not in INVOKER,'config':config}
            equal(expected,{k:after.get(k) for k in expected},'privilégio mínimo da nova assinatura '+sig)
            continue
        if key.startswith('table:') and key[6:] in NEW_TABLES and before is None:
            assert after['owner']=='postgres' and after['rls'] is True and after['force_rls'] is False
            # A ACL do dono varia por versão (PG17 acrescenta MAINTAIN/m).
            # Preserve a do postgres no catálogo anterior; nenhum outro papel ganha escrita.
            owner_acl=next(v for v in base['table:financial_holidays']['acl'] if v.startswith('postgres='))
            assert set(after['acl'])=={owner_acl,'authenticated=r/postgres'},key
            continue
        if key.startswith(('column:','constraint:','trigger:')):
            table=key.split(':',1)[1].split('.',1)[0]
            if table in NEW_TABLES and before is None:
                continue
            if key=='column:timesheet_entries.territorial_calendar_snapshot' and before is None:
                continue
            if table=='financial_holidays' and before is None:
                if key.startswith('column:') and key.split('.')[-1] in NEW_HOLIDAY_COLUMNS:
                    continue
                if key.startswith('constraint:financial_holidays.financial_holidays_'):
                    continue
            if key in {'trigger:timesheet_entries.trg_timesheet_entries_ba_snapshot_territorial','trigger:timesheets.trg_timesheets_bz_data_territorial'} and before is None:
                continue
        if key=='constraint:financial_terms_audit.financial_terms_audit_acao_valida':
            old_actions=set(re.findall(r"'([^']+)'",before))
            new_actions=set(re.findall(r"'([^']+)'",after))
            assert new_actions==old_actions|{'municipio_catalogado','local_operacao_registrado','local_operacao_encerrado','feriado_territorial_registrado','cobertura_calendario_confirmada','cobertura_calendario_aposentada'},key
            continue
        if key.startswith('index:'):
            name=key[6:]
            if name.startswith(tuple(NEW_TABLES)) and before is None:
                continue
            if name=='financial_holidays_um_ativo_por_data' and after is None or name=='financial_holidays_um_ativo_por_territorio' and before is None:
                continue
        if key.startswith('policy:') and key.split(':',1)[1].split('.')[0] in NEW_TABLES and before is None:
            assert after['roles']==['authenticated'] and after['cmd']=='SELECT' and 'mfa_cotidiano_ok' in after['qual'] and 'has_role' in after['qual'] and 'admin' in after['qual'],key
            continue
        if key.startswith('dependency:') and before is None:
            subjects={'financial_terms_audit_acao_valida'}|NEW_TABLES|{x.split('(')[0] for x in RPCS|INTERNAL}|{'financial_holidays_territorio','financial_holidays_verificacao','financial_holidays_fonte_territorial','financial_holidays_confirmacao','financial_holidays_municipality_code_fkey'}
            if any(x in key for x in subjects):
                continue
        raise AssertionError('Mudança inesperada no catálogo: '+key)
    return changes


reset043()
file('scripts/fixtures/fin09/off.sql')
base=catalog(); reference=data()
save('catalogo-043.json',base); save('off-043.json',reference)
file(MIGRATION)
equal(reference,data(),'instalar 044 preserva todos os dados financeiros OFF')
new=catalog(); save('catalogo-044.json',new)
save('catalogo-diff.json',compare_catalog(base,new))
print('PASS: catálogo 043–044 dentro do escopo; funções por assinatura e metadados, RLS, grants, owners e auditoria conferidos',flush=True)
file(ROLLBACK)
equal(base,catalog(),'rollback permitido restaura catálogo exato da 043')
equal(reference,data(),'rollback permitido preserva dados financeiros e snapshots')
reset043(); file(MIGRATION); file('scripts/fixtures/fin09/off.sql')
obtained=data(); save('off-044.json',obtained)
equal(reference,obtained,'paridade financeira OFF exata 043–044: novos lançamentos, históricos, snapshots, componentes e fatura')
# A 044 não deve afetar sequer o oráculo original 042–043: prova adicional no runner FIN09.
reset043(); file(MIGRATION); file('supabase/tests/044_calendario_territorial.sql',commit=True)
before=data(include_special=True); before_catalog=catalog()
r=sql((SOURCE/ROLLBACK).read_text(),check=False)
(EVIDENCE/'rollback-bloqueado.log').write_text(r.stdout+r.stderr)
assert r.returncode!=0 and '55000' in r.stderr and 'Reversão recusada' in r.stderr,r.stderr
print('PASS: rollback incompatível bloqueado com 55000',flush=True)
equal(before,data(include_special=True),'rollback recusado preserva todos os dados e snapshots territoriais')
equal(before_catalog,catalog(),'rollback recusado preserva catálogo integral')
print('Evidências:',EVIDENCE,flush=True)
