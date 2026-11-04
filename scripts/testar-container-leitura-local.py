#!/usr/bin/env python3
"""Leitura FIN11C pela API LOCAL, sem gravar ou resetar banco.

Uso: python3 scripts/testar-container-leitura-local.py /private/tmp/bs-fin11-local-<id>
Requer fixtures sintéticas da suíte 045 previamente COMMITadas pelo harness local.
Credenciais locais e JWT sintético ficam somente na memória dos processos.
"""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location(
    'local_guard', Path(__file__).with_name('testar-container-paridade-local.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.guard()
assert re.fullmatch(r'bs-fin11-local-c1[a-z0-9]+', guard.PROJECT), 'Alvo exclusivo FIN11C obrigatório'
counts = json.loads(guard.sql("""select jsonb_build_object(
 'services',(select count(*) from public.container_services),
 'synthetic_actors',(select count(*) from auth.users where id='5c450000-0000-4000-8000-0000000000a1'),
 'synthetic_services',(select count(*) from public.container_services where created_by='5c450000-0000-4000-8000-0000000000a1'));""").stdout)
assert counts == {'services': 4, 'synthetic_actors': 1, 'synthetic_services': 4}, 'Fixtures 045 exclusivas obrigatórias'
env = dict(os.environ)
env.pop('SUPABASE_ACCESS_TOKEN', None)
env.pop('SUPABASE_PROJECT_ID', None)
result = subprocess.run(
    ['npx', '--yes', 'supabase@2.117.0', 'status', '-o', 'json', '--workdir', str(guard.LOCAL)],
    env=env, capture_output=True, text=True, timeout=30)
assert result.returncode == 0, 'CLI local não respondeu'
keys = json.loads(result.stdout)
assert re.fullmatch(r'http://127\.0\.0\.1:\d+', keys['API_URL']), 'API precisa ser loopback'
config = (guard.LOCAL / 'supabase/config.toml').read_text()
api_port = re.search(r'\[api\][\s\S]*?^port\s*=\s*(\d+)', config, re.M)[1]
assert keys['API_URL'].endswith(':' + api_port), 'Porta API diverge do config isolado'


def encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')


header = encode(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
body = encode(json.dumps({
    'sub': '5c450000-0000-4000-8000-0000000000a1', 'role': 'authenticated', 'aal': 'aal1',
    'session_id': 'ec450000-0000-4000-8000-0000000000a1', 'exp': int(time.time()) + 300,
}).encode())
data = header + b'.' + body
token = (data + b'.' + encode(hmac.new(keys['JWT_SECRET'].encode(), data, hashlib.sha256).digest())).decode()
env.update(FIN11C_TEST_API=keys['API_URL'], FIN11C_TEST_ANON=keys['ANON_KEY'], FIN11C_TEST_JWT=token)
script = """
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {listarContainers,detalharContainer,recuperarRegistroContainer} from './src/lib/container-servico-dados.ts';
const db=createClient(process.env.FIN11C_TEST_API,process.env.FIN11C_TEST_ANON,{
 global:{headers:{Authorization:'Bearer '+process.env.FIN11C_TEST_JWT}},
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const lista=await listarContainers(db,{}); assert.equal(lista.servicos.length,4);
for(const s of lista.servicos){
 const detalhe=await detalharContainer(db,s.id);
 assert.equal(detalhe.participantes.length,2);
 assert.equal(detalhe.participantes.reduce((n,p)=>n+p.cost_cents,0),s.cost_total_cents);
 assert.ok(detalhe.auditoria.length>=1);
}
const r=await db.from('container_services').select('id,client_id,idempotency_key,request_payload').limit(1);
assert.ifError(r.error); const s=r.data[0];
assert.deepEqual(await recuperarRegistroContainer(db,s.client_id,s.idempotency_key,s.request_payload),
 {estado:'registrado',id:s.id});
console.log('PASS API local real: 4 serviços, detalhes/participantes/auditoria e reconciliação sob RLS admin AAL1 sem fator');
"""
guard.guard()
result = subprocess.run(
    ['node', '--experimental-strip-types', '--import', './scripts/_resolver-ts.mjs', '--input-type=module', '-e', script],
    cwd=guard.SOURCE, env=env, capture_output=True, text=True, timeout=40)
if result.returncode:
    raise SystemExit('Falha no teste de leitura pela API local; nenhum dado foi modificado')
print(result.stdout.strip())
