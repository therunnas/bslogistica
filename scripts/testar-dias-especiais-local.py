#!/usr/bin/env python3
"""FIN09: comparação OFF independente, catálogo e rollback. Apenas instância exclusiva desta execução.
Uso: python3 scripts/testar-dias-especiais-local.py /private/tmp/bs-fin09-local-<id>
Não provisiona nem remove recursos Docker. Recusa configuração ligada a projeto remoto.
"""
import difflib
import json
from pathlib import Path
import re
import subprocess
import sys

SOURCE = Path(__file__).resolve().parent.parent
LOCAL = Path(sys.argv[1]).resolve()
PROJECT = LOCAL.name
if not str(LOCAL).startswith('/private/tmp/bs-fin09-local-'):
    raise SystemExit('Workdir descartável FIN09 obrigatório')
CONFIG = (LOCAL / 'supabase/config.toml').read_text()
if re.search(r'^project_id\s*=\s*"([^"]+)"', CONFIG, re.M)[1] != PROJECT:
    raise SystemExit('project_id diverge da execução isolada')
if (LOCAL / 'supabase/.temp/project-ref').exists():
    raise SystemExit('Vínculo remoto não permitido')
CONTAINER = 'supabase_db_' + PROJECT
EVIDENCE = LOCAL / 'fin09-evidence'
EVIDENCE.mkdir(exist_ok=True)


def command(args, sql=None, check=True):
    r = subprocess.run(args, input=sql, text=True, capture_output=True)
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


def reset042():
    print('Preparando referência local até a 042...', flush=True)
    guard()
    import os
    env = dict(os.environ)
    env.pop('SUPABASE_ACCESS_TOKEN', None)
    r = subprocess.run(['supabase', 'db', 'reset', '--local', '--version', '20261109120000',
                        '--workdir', str(LOCAL)], text=True, capture_output=True, env=env)
    (EVIDENCE / 'reset042.log').write_text(r.stdout + r.stderr)
    if r.returncode:
        raise RuntimeError('Reset local falhou; ver log no diretório de evidências')
    guard()


MIGRATION = 'supabase/migrations/20261110120000_043_dias_especiais_v2.sql'
ROLLBACK = 'docs/runbooks/rollback-dias-especiais-v2.sql'
TABLES = ['clients', 'contracts', 'employees', 'operations', 'shifts', 'job_functions', 'operation_team',
          'contract_terms', 'employee_cost_terms', 'operation_terms', 'contract_rate_terms',
          'contract_employee_rates', 'timesheets', 'timesheet_entries', 'invoices', 'invoice_items',
          'financial_holidays', 'billing_additionals', 'pricing_settings', 'financial_engine_settings']


def data(include_special=False):
    raw = {}
    for table in TABLES:
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
                    ({'created_at', 'updated_at', 'changed_at', 'shift_period_set_at'} | (set() if include_special else {'special_rounding_mode'}))}
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


reset042()
file('scripts/fixtures/fin09/off.sql')
base = catalog()
save('catalogo-042.json', base)
reference = data()
save('off-042.json', reference)
file(MIGRATION)
equal(reference, data(), 'instalar 043 não altera dados financeiros históricos OFF')
new = catalog()
save('catalogo-043.json', new)
changes = {k: {'before': base.get(k), 'after': new.get(k)} for k in base.keys() | new.keys() if base.get(k) != new.get(k)}
save('catalogo-diff.json', changes)
allowed = {'column:contract_terms.special_rounding_mode',
           'constraint:contract_terms.contract_terms_arredondamento_especial_valido',
           'constraint:timesheet_entries.timesheet_entries_tipo_do_dia_valido'}
functions = ['derivar_valores_por_vigencia', 'estado_motor_vigencia', 'corrigir_condicao_contrato', 'registrar_condicao_contrato_especial']
for k in changes:
    if k in allowed or (k.startswith('function:') and any(k.startswith('function:' + f + '(') for f in functions)):
        continue
    if k.startswith('dependency:') and ('contract_terms_arredondamento_especial_valido' in k or 'registrar_condicao_contrato_especial' in k):
        continue
    raise AssertionError('Mudança inesperada no catálogo: ' + k)
print('PASS: catálogo altera apenas coluna, domínio, classificador e quatro funções previstas; RLS/grants/owners antigos intactos', flush=True)
file(ROLLBACK)
equal(base, catalog(), 'rollback permitido restaura catálogo exato 042')
equal(reference, data(), 'rollback permitido preserva dados, snapshots, bônus e faturas')
reset042()
file(MIGRATION)
file('scripts/fixtures/fin09/off.sql')
obtained = data()
save('off-043.json', obtained)
equal(reference, obtained, 'paridade financeira OFF exata: novos lançamentos, snapshots, históricos e fatura')
reset042()
file(MIGRATION)
file('supabase/tests/043_dias_especiais_v2.sql', commit=True)
before_block = data(include_special=True)
r = sql((SOURCE / ROLLBACK).read_text(), check=False)
(EVIDENCE / 'rollback-bloqueado.log').write_text(r.stdout + r.stderr)
assert r.returncode != 0 and '55000' in r.stderr and 'Reversão recusada' in r.stderr, r.stderr
print('PASS: rollback recusa uso incompatível 55000', flush=True)
equal(before_block, data(include_special=True), 'rollback bloqueado não altera valores nem snapshots')
equal(new, catalog(), 'rollback bloqueado preserva catálogo 043')
print('Evidências:', EVIDENCE, flush=True)
