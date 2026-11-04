#!/usr/bin/env python3
"""Executa um comando local com prazo e encerra todos os seus descendentes."""
import math
import os
import signal
import subprocess
import sys
import time


def run_local(args, *, timeout, input=None, env=None, capture_output=True):
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Prazo local deve ser positivo e finito')
    process = subprocess.Popen(args, stdin=subprocess.PIPE if input is not None else None,
                               stdout=subprocess.PIPE if capture_output else None,
                               stderr=subprocess.PIPE if capture_output else None,
                               text=True, env=env, start_new_session=True)

    def stop_group():
        try:
            # SIGTERM deixa helpers descendentes encerrarem seus próprios grupos.
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass
        time.sleep(0.25)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def interrupted(signum, _frame):
        stop_group()
        process.wait()
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        try:
            stdout, stderr = process.communicate(input=input, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            stop_group()
            process.communicate()
            raise TimeoutError(f'Tempo limite local de {timeout:g}s excedido: {args[0]}') from error
        return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
    finally:
        stop_group()
        process.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    try:
        result = run_local(sys.argv[2:], timeout=float(sys.argv[1]), capture_output=False)
        raise SystemExit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
    except TimeoutError as error:
        print(error, file=sys.stderr)
        raise SystemExit(124)
