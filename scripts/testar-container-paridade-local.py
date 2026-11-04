#!/usr/bin/env python3
"""FIN11B: comparação OFF independente, catálogo e rollback. Apenas instância exclusiva desta execução.
Uso: python3 scripts/testar-container-paridade-local.py /private/tmp/bs-fin11-local-<id>
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
if not str(LOCAL).startswith('/private/tmp/bs-fin11-local-'):
    raise SystemExit('Workdir descartável FIN11 obrigatório')
CONFIG = (LOCAL / 'supabase/config.toml').read_text()
if re.search(r'^project_id\s*=\s*"([^"]+)"', CONFIG, re.M)[1] != PROJECT:
    raise SystemExit('project_id diverge da execução isolada')
if (LOCAL / 'supabase/.temp/project-ref').exists():
    raise SystemExit('Vínculo remoto não permitido')
CONTAINER = 'supabase_db_' + PROJECT
EVIDENCE = LOCAL / 'fin11-evidence'
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
    assert state['Mounts'] and all(m.get('Name') == CONTAINER for m in state['Mounts'])
    assert set(state['NetworkSettings']['Networks']) == {'supabase_network_' + PROJECT}


def sql(text, check=True):
    guard()
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres',
                    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], text, check)


def file(name, commit=False):
    text = (SOURCE / name).read_text()
    if commit:
        assert text.rstrip().lower().endswith('rollback;')
        text = text.rstrip()[:-len('rollback;')] + 'commit;\n'
    r = sql(text)
    (EVIDENCE / (Path(name).name + '.log')).write_text(r.stdout + r.stderr)
    return r


def reset044():
    print('Preparando referência local até a 044...', flush=True)
    guard()
    import os
    env = dict(os.environ)
    env.pop('SUPABASE_ACCESS_TOKEN', None)
    env.pop('SUPABASE_PROJECT_ID', None)
    r = command(['env', '-u', 'SUPABASE_ACCESS_TOKEN', '-u', 'SUPABASE_PROJECT_ID',
                 'npx', '--yes', 'supabase@2.117.0', 'db', 'reset', '--local',
                 '--version', '20261111120000', '--workdir', str(LOCAL)],
                check=False, timeout=300, env=env)
    (EVIDENCE / 'reset044.log').write_text(r.stdout + r.stderr)
    if r.returncode:
        raise RuntimeError('Reset local falhou; ver log no diretório de evidências')
    guard()


MIGRATION = 'supabase/migrations/20261112120000_045_container_servico.sql'
ROLLBACK = 'docs/runbooks/rollback-container-servico.sql'
TABLES = ['clients', 'contracts', 'employees', 'operations', 'shifts', 'job_functions', 'operation_team',
          'contract_terms', 'employee_cost_terms', 'operation_terms', 'contract_rate_terms',
          'contract_employee_rates', 'timesheets', 'timesheet_entries', 'invoices', 'invoice_items',
          'financial_holidays', 'billing_additionals', 'pricing_settings', 'financial_engine_settings',
          'municipality_catalog', 'operation_location_terms', 'financial_calendar_coverage',
          'financial_terms_audit']
NEW_TABLES = {'container_services', 'container_service_participants', 'container_service_audit'}


def data(include_containers=False):
    raw = {}
    for table in TABLES + (sorted(NEW_TABLES) if include_containers else []):
        raw[table] = json.loads(sql(f"select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.{table} t;").stdout, parse_float=str)
    refs = {}
    keys = {
        'job_functions': ['code'], 'operation_team': ['operation_id', 'shift_id', 'employee_id'], 'contract_terms': ['contract_id', 'valid_from'],
        'employee_cost_terms': ['employee_id', 'valid_from'], 'operation_terms': ['operation_id', 'valid_from'],
        'contract_rate_terms': ['contract_id', 'job_function_id', 'shift_period', 'valid_from'],
        'contract_employee_rates': ['contract_id', 'employee_id', 'valid_from'],
        'billing_additionals': ['client_id','period_start','period_end','description','reference'],
        'operation_location_terms': ['operation_id','valid_from'],
        'financial_calendar_coverage': ['territory_scope','state_code','municipality_code','period_start','period_end'],
        'container_services': ['client_id','idempotency_key'],
        'timesheets': ['operation_id', 'shift_id', 'work_date'],
        'timesheet_entries': ['timesheet_id', 'employee_id'], 'invoices': ['client_id', 'period_start', 'period_end'],
        'invoice_items': ['invoice_id', 'kind', 'operation_id', 'description'], 'financial_holidays': ['holiday_date'],
        # Auditoria depende dos IDs lógicos de todas as entidades anteriores.
        'financial_terms_audit': ['action','entity_kind','entity_id','term_id','reason'],
        'container_service_audit': ['service_id','action','reason'],
    }
    for table, fields in keys.items():
        for row in raw.get(table, []):
            refs[row['id']] = table + ':' + '|'.join(str(refs.get(row.get(k), row.get(k))) for k in fields)
    def normalize(v):
        if isinstance(v, str):
            return refs.get(v, v)
        if isinstance(v, list):
            return sorted((normalize(i) for i in v), key=lambda x: json.dumps(x, sort_keys=True))
        if isinstance(v, dict):
            # Somente timestamps voláteis. Valores, minutos, fontes e snapshots ficam integrais.
            return {k: normalize(x) for k, x in sorted(v.items()) if k not in
                    {'created_at', 'updated_at', 'changed_at', 'shift_period_set_at', 'occurred_at'}}
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


RPCS = {'registrar_servico_container(jsonb,uuid,text)', 'cancelar_servico_container(uuid,text)'}
INTERNAL = {'normalizar_payload_container(jsonb)', 'proteger_servico_container()',
            'proteger_cancelamento_adicional_container()'}
INVOICE_OLD = '    coalesce(sum(te.cost_amount), 0)\n  from public.timesheet_entries te'
INVOICE_NEW = '''    coalesce(sum(te.cost_amount), 0)
      -- FIN-PR-11B: custo avulso congelado dos MESMOS adicionais selecionados para cobrança.
      + (select coalesce(sum(cs.cost_total_cents), 0)::numeric / 100
           from public.container_services cs where cs.billing_additional_id = any(_adicionais))
  from public.timesheet_entries te'''


def compare_catalog(base, new):
    changes = {}
    for key in sorted(base.keys() | new.keys()):
        before, after = base.get(key), new.get(key)
        if before == after:
            continue
        changes[key] = {'before': before, 'after': after}
        if key == 'function:gerar_fatura(uuid,date,date)':
            assert before is not None and after is not None, key
            equal({k: v for k, v in before.items() if k != 'def'},
                  {k: v for k, v in after.items() if k != 'def'},
                  'gerar_fatura preserva owner/ACL/definer/config')
            assert before['def'].count(INVOICE_OLD) == 1, 'Oráculo 038 inesperado'
            equal(before['def'].replace(INVOICE_OLD, INVOICE_NEW), after['def'],
                  'gerar_fatura só acrescenta custo congelado dos adicionais selecionados')
            continue
        if key.startswith('function:'):
            signature = key[len('function:'):]
            assert before is None and signature in RPCS | INTERNAL, key
            expected = {
                'owner': 'postgres', 'security_definer': signature in RPCS,
                'acl': ['authenticated=X/postgres', 'postgres=X/postgres'] if signature in RPCS else ['postgres=X/postgres'],
                'config': ['search_path=pg_catalog, public, pg_temp'],
            }
            equal(expected, {k: after.get(k) for k in expected}, 'menor privilégio ' + signature)
            continue
        if key.startswith('table:') and key[6:] in NEW_TABLES and before is None:
            owner_acl = next(v for v in base['table:billing_additionals']['acl'] if v.startswith('postgres='))
            assert after['owner'] == 'postgres' and after['rls'] is True and after['force_rls'] is False, key
            assert set(after['acl']) == {owner_acl, 'authenticated=r/postgres'}, key
            continue
        if key.startswith(('column:', 'constraint:', 'trigger:')):
            table = key.split(':', 1)[1].split('.', 1)[0]
            if table in NEW_TABLES and before is None:
                continue
            if key == 'trigger:billing_additionals.billing_additionals_container_cancel_guard' and before is None:
                assert after == {
                    'def': 'CREATE TRIGGER billing_additionals_container_cancel_guard BEFORE UPDATE ON billing_additionals FOR EACH ROW EXECUTE FUNCTION proteger_cancelamento_adicional_container()',
                    'enabled': 'O',
                }, key
                continue
        if key.startswith('index:') and before is None and key[6:].startswith(tuple(NEW_TABLES)):
            continue
        if key.startswith('policy:') and before is None:
            table, policy = key.split(':', 1)[1].split('.', 1)
            assert table in NEW_TABLES and after['roles'] == ['authenticated'], key
            assert 'mfa_cotidiano_ok' in after['qual'] and 'has_role' in after['qual'] and 'admin' in after['qual'], key
            if policy == table + '_read_admin':
                assert after['cmd'] == 'SELECT' and after['permissive'] == 'PERMISSIVE' and after['with_check'] is None, key
            else:
                assert policy == table + '_require_admin', key
                assert after['cmd'] == 'ALL' and after['permissive'] == 'RESTRICTIVE', key
                assert after['with_check'] == after['qual'], key
            continue
        if key.startswith('dependency:') and before is None:
            subjects = NEW_TABLES | {x.split('(')[0] for x in RPCS | INTERNAL}
            if any(subject in key for subject in subjects):
                continue
        raise AssertionError('Mudança inesperada no catálogo: ' + key)
    return changes


if __name__ == '__main__':
    reset044()
    file('scripts/fixtures/fin09/off.sql')
    base = catalog()
    reference = data()
    save('catalogo-044.json', base)
    save('off-044.json', reference)
    file(MIGRATION)
    equal(reference, data(), 'instalação 045 preserva dados históricos OFF, fontes, minutos e snapshots')
    new = catalog()
    save('catalogo-045.json', new)
    save('catalogo-diff.json', compare_catalog(base, new))
    print('PASS: catálogo 044–045 dentro da allowlist de tabelas/RLS/grants/RPCs e delta de custo', flush=True)
    file(ROLLBACK)
    equal(base, catalog(), 'rollback permitido restaura catálogo exato 044')
    equal(reference, data(), 'rollback permitido preserva dados financeiros e auditoria')

    reset044()
    file(MIGRATION)
    file('scripts/fixtures/fin09/off.sql')
    obtained = data()
    save('off-045.json', obtained)
    equal(reference, obtained, 'paridade OFF exata 044–045 para novos lançamentos, históricos e fatura sem containers')

    reset044()
    file(MIGRATION)
    file('supabase/tests/045_container_servico.sql', commit=True)
    before = data(include_containers=True)
    before_catalog = catalog()
    r = sql((SOURCE / ROLLBACK).read_text(), check=False)
    (EVIDENCE / 'rollback-bloqueado.log').write_text(r.stdout + r.stderr)
    assert r.returncode != 0 and '55000' in r.stderr and 'Reversão recusada' in r.stderr, r.stderr
    print('PASS: rollback incompatível bloqueado com 55000', flush=True)
    equal(before, data(include_containers=True), 'rollback recusado preserva serviço, participantes, faturas e auditoria')
    equal(before_catalog, catalog(), 'rollback recusado preserva catálogo integral')
    print('Evidências:', EVIDENCE, flush=True)
