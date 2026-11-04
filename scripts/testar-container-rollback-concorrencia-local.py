#!/usr/bin/env python3
"""FIN11B: prova fail-closed do rollback sob escrita concorrente, somente local.

Uso: python3 scripts/testar-container-rollback-concorrencia-local.py /private/tmp/bs-fin11-local-<id>
Exige schema 045 instalado. Não reseta banco nem altera fixtures persistidas.
"""
import importlib.util
from pathlib import Path
import selectors
import subprocess
import os
import signal
import argparse


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('workdir')
parser.add_argument('--baseline', choices=['/private/tmp/fin11-rollback-before-lock.sql'])
args = parser.parse_args()


spec = importlib.util.spec_from_file_location(
    'fin11_parity', Path(__file__).with_name('testar-container-paridade-local.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.guard()
before_catalog = runner.catalog()
before_data = runner.data(include_containers=True)
assert all(not before_data[table] for table in runner.NEW_TABLES), 'A prova exige as três tabelas novas vazias'
rollback_path = Path(args.baseline) if args.baseline else runner.SOURCE / runner.ROLLBACK
rollback_source = rollback_path.read_text()
prefix_end = rollback_source.index('CREATE OR REPLACE FUNCTION public.gerar_fatura(')
# Somente BEGIN + travas + DO de pré-condições. Nunca executa CREATE/DROP nesta prova.
rollback_prefix = rollback_source[:prefix_end] + 'rollback;\n'

# Simula a trava ROW EXCLUSIVE que um registro/cancelamento mantém na tabela.
# Não depende de sleep ou de observar uma corrida; READY só sai após adquirir a trava.
for table in sorted(runner.NEW_TABLES):
    runner.guard()
    holder = subprocess.Popen(
        ['docker', 'exec', '-i', runner.CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres',
         '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, start_new_session=True)
    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)
    previous_handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        holder.stdin.write(f"begin; lock table public.{table} in row exclusive mode; select 'READY';\n")
        holder.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(holder.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=15):
                raise TimeoutError('A sessão concorrente não confirmou a trava em 15s')
            assert holder.stdout.readline().strip() == 'READY', 'Sessão concorrente não adquiriu a trava'
        result = runner.sql(rollback_prefix, check=False)
        label = 'baseline-' if args.baseline else ''
        (runner.EVIDENCE / ('rollback-concorrente-' + label + table + '.log')).write_text(result.stdout + result.stderr)
        assert result.returncode != 0 and '55P03' in result.stderr, result.stderr
        print('PASS: rollback recusa escritor concorrente em ' + table + ' com 55P03', flush=True)
        holder.stdin.write('rollback;\n\\q\n')
        holder.stdin.flush()
        holder.communicate(timeout=15)
        assert holder.returncode == 0, 'Sessão concorrente não encerrou corretamente'
    finally:
        if holder.poll() is None:
            os.killpg(holder.pid, signal.SIGTERM)
            try:
                holder.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(holder.pid, signal.SIGKILL)
                holder.communicate()
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
    runner.equal(before_catalog, runner.catalog(), 'rollback concorrente preserva catálogo ' + table)
    runner.equal(before_data, runner.data(include_containers=True), 'rollback concorrente preserva dados ' + table)
print('Evidências:', runner.EVIDENCE, flush=True)
