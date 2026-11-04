import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const source = (name) => readFileSync(join(root, name), "utf8");
const python = (code, args = []) =>
  spawnSync("python3", ["-c", code, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });

test("OFF registra e rejeita erro em cada preparação, inclusive UPDATE sem linha", () => {
  const sql = source("scripts/fixtures/fin09/off.sql");
  assert.match(sql, /Fixture OFF: preparação % falhou/);
  assert.match(sql, /get diagnostics _linhas = row_count/i);
  assert.match(sql, /Fixture OFF: UPDATE esperado em exatamente uma linha/);
  for (const key of [
    "diaria-off",
    "tarifa-off",
    "feriado-off-09",
    "feriado-off-23",
    "motriz-off",
  ]) {
    assert.match(sql, new RegExp(`pg_temp\\.exec\\('${key}'`));
  }
});

test("catálogo permite corpo das cinco funções mas rejeita owner, ACL, definer e config em toda assinatura", () => {
  const result = python(`
import ast, copy
from pathlib import Path
source = Path('scripts/testar-dias-especiais-local.py').read_text()
module = ast.parse(source)
functions = [n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'compare_catalog']
assert functions, 'comparador de catálogo verificável ausente'
ns = {}
exec(compile(ast.Module(body=functions, type_ignores=[]), '<catalog>', 'exec'), ns)
compare = ns['compare_catalog']
for key in ['function:derivar_valores_por_vigencia()', 'function:estado_motor_vigencia()',
            'function:corrigir_condicao_contrato(uuid,date,date,numeric,numeric,numeric,integer,text,text,numeric,numeric)',
            'function:registrar_condicao_contrato(uuid,date,numeric,numeric,numeric,integer,text,date,boolean,text,numeric,numeric,text)']:
    base = {key: dict(owner='postgres', acl=['postgres=X'], security_definer=True, config=['search_path=public'])}
    base[key]['def'] = 'antigo'
    changed = copy.deepcopy(base); changed[key]['def'] = 'novo'
    compare(base, changed)
    for field, value in [('owner','intruso'),('acl',[]),('security_definer',False),('config',[])]:
        wrong = copy.deepcopy(changed); wrong[key][field] = value
        try: compare(base, wrong)
        except AssertionError as e: assert field in str(e), str(e)
        else: raise AssertionError('mudança de ' + field + ' passou silenciosamente: ' + key)
wrong = copy.deepcopy(changed); wrong['function:derivar_valores_por_vigencia(integer)'] = wrong[key]
try: compare(base, wrong)
except AssertionError: pass
else: raise AssertionError('assinatura inesperada passou silenciosamente')
special = 'function:registrar_condicao_contrato_especial(uuid,date,numeric,numeric,numeric,integer,text,date,boolean,text,numeric,numeric,text,text)'
new = {special: dict(owner='postgres', acl=['authenticated=X/postgres','postgres=X/postgres'],
                    security_definer=True, config=['search_path=pg_catalog, public, pg_temp'])}
new[special]['def'] = 'novo'
compare({}, new)
for field, value in [('owner','intruso'),('acl',[]),('security_definer',False),('config',[])]:
    wrong = copy.deepcopy(new); wrong[special][field] = value
    try: compare({}, wrong)
    except AssertionError as e: assert field in str(e), str(e)
    else: raise AssertionError('função nova permitiu ' + field + ' incorreto')
`);
  assert.equal(result.status, 0, result.stderr);
});

test("deadline mata grupo inteiro e propaga falha 124", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin10-timeout-"));
  try {
    const marker = join(dir, "orphan.txt");
    const result = spawnSync(
      "python3",
      [
        "scripts/_executar_local.py",
        "0.15",
        "python3",
        "-c",
        "import subprocess,time,sys; subprocess.Popen([sys.executable,'-c',sys.argv[1]]); time.sleep(10)",
        `import time; from pathlib import Path; time.sleep(0.6); Path(${JSON.stringify(marker)}).write_text('orfao')`,
      ],
      { cwd: root, encoding: "utf8", timeout: 6000 },
    );
    assert.equal(result.status, 124, result.stderr);
    assert.match(result.stderr, /Tempo limite/);
    execFileSync("python3", ["-c", "import time; time.sleep(0.8)"]);
    assert.throws(() => readFileSync(marker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runner Python usa deadline até em check=False e no reset", () => {
  const result = python(`
import ast, importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('_executar_local', 'scripts/_executar_local.py')
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
ns = dict(vars(helper)); ns['COMMAND_TIMEOUT'] = .1
module = ast.parse(Path('scripts/testar-dias-especiais-local.py').read_text())
functions = [n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'command']
exec(compile(ast.Module(body=functions, type_ignores=[]), '<runner>', 'exec'), ns)
try: ns['command']([sys.executable, '-c', 'import time; time.sleep(5)'], check=False)
except TimeoutError: pass
else: raise AssertionError('timeout virou resultado tolerado')
reset = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'reset042')
assert not any(isinstance(n, ast.Attribute) and n.attr == 'run' for n in ast.walk(reset)), 'reset ignora deadline compartilhado'
`);
  assert.equal(result.status, 0, result.stderr);
});

test("compatibilidade mantém oito cenários pinados e acrescenta 044", () => {
  const shell = source("scripts/testar-compatibilidade-deploy.sh");
  const start = shell.indexOf('echo "=== Cenário 1:');
  const end = shell.indexOf("\nif grep -qiE", start);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail\nexec 3>&1\nsupa(){ printf 'RESET %s\\n' "$*" >&3; }\nrodar(){ printf 'RUN %s\\n' "$*"; }\n${shell.slice(start, end)}`,
    ],
    { encoding: "utf8", timeout: 2000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const resets = result.stdout.split("\n").filter((line) => line.startsWith("RESET "));
  assert.deepEqual(
    resets.map((line) => line.match(/--version (\d+)/)?.[1]),
    [
      "20261101120000",
      "20261104120000",
      "20261105120000",
      "20261106120000",
      "20261107120000",
      "20261108120000",
      "20261109120000",
      "20261110120000",
      "20261111120000",
    ],
  );
  assert.equal(result.stdout.split("\n").filter((line) => line.startsWith("RUN ")).length, 9);
});

test("deadline externo também encerra grupo criado por helper descendente", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin10-nested-"));
  try {
    const marker = join(dir, "orphan.txt");
    const helper = join(root, "scripts/_executar_local.py");
    const result = spawnSync(
      "python3",
      [
        helper,
        "0.25",
        "python3",
        helper,
        "5",
        "python3",
        "-c",
        `import time; from pathlib import Path; time.sleep(0.8); Path(${JSON.stringify(marker)}).write_text('orfao')`,
      ],
      { cwd: root, encoding: "utf8", timeout: 6000 },
    );
    assert.equal(result.status, 124, result.stderr);
    execFileSync("python3", ["-c", "import time; time.sleep(1)"]);
    assert.throws(() => readFileSync(marker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI entrega logs antes do fim do comando para permitir inspeção do Next em execução", () => {
  const result = python(`
import select, subprocess, sys
p = subprocess.Popen([sys.executable, 'scripts/_executar_local.py', '5', sys.executable,
                      '-u', '-c', 'import time; print("pronto", flush=True); time.sleep(2)'],
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    readable, _, _ = select.select([p.stdout], [], [], 1)
    assert readable, 'logs ficaram retidos até o encerramento'
    assert p.stdout.readline().strip() == 'pronto'
finally:
    p.terminate(); p.communicate(timeout=2)
`);
  assert.equal(result.status, 0, result.stderr);
});

test("psql do runner Node propaga timeout 124 e envia SQL à fronteira local", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin10-node-"));
  const originalPath = process.env.PATH;
  try {
    const script = source("scripts/testar-compatibilidade-deploy.mjs");
    const begin = script.indexOf("const psql =");
    const end = script.indexOf("\n// ---", begin);
    const comPrazo = (prazo) =>
      new Function(
        "execFileSync",
        "CONTAINER",
        "COMMAND_TIMEOUT",
        "LOCAL_RUNNER",
        `${script.slice(begin, end)}; return psql;`,
      )(execFileSync, "container-sintetico", prazo, join(root, "scripts/_executar_local.py"));
    const fakeDocker = join(dir, "docker");
    writeFileSync(
      fakeDocker,
      "#!/usr/bin/env python3\nimport sys\nprint(sys.stdin.read().strip())\n",
      {
        mode: 0o755,
      },
    );
    process.env.PATH = `${dir}:${originalPath}`;
    assert.equal(comPrazo(30)("select 'fixture';"), "select 'fixture';");
    writeFileSync(fakeDocker, "#!/usr/bin/env python3\nimport time\ntime.sleep(5)\n");
    assert.throws(
      () => comPrazo(1)("select 1;"),
      (error) => error.status === 124,
    );
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("timeout ao iniciar Supabase encerra o shell sem tentativa alternativa", () => {
  const shell = source("scripts/testar-compatibilidade-deploy.sh");
  const start = shell.indexOf('echo "Subindo Supabase local..."');
  const end = shell.indexOf("\nstatus_local=", start);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail\nexec 3>&1\nsupa(){ echo TENTATIVA >&3; return 124; }\n${shell.slice(start, end)}`,
    ],
    { encoding: "utf8", timeout: 2000 },
  );
  assert.equal(result.status, 124, result.stderr);
  assert.equal(result.stdout.split("\n").filter((line) => line === "TENTATIVA").length, 1);
});

test("reset 042 usa CLI pinado e remove token somente no processo local", () => {
  const result = python(`
import ast, subprocess, tempfile
from pathlib import Path
module = ast.parse(Path('scripts/testar-dias-especiais-local.py').read_text())
fn = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'reset042')
calls = []
def command(args, **kwargs):
    calls.append((args, kwargs))
    return subprocess.CompletedProcess(args, 0, '', '')
with tempfile.TemporaryDirectory() as evidence:
    ns = dict(guard=lambda: None, command=command, EVIDENCE=Path(evidence), LOCAL=Path('/private/tmp/bs-fin09-local-fixture'))
    exec(compile(ast.Module(body=[fn], type_ignores=[]), '<reset>', 'exec'), ns)
    ns['reset042']()
args, options = calls[0]
assert args[:6] == ['env', '-u', 'SUPABASE_ACCESS_TOKEN', 'npx', '--yes', 'supabase@2.117.0'], args
assert args[6:] == ['db', 'reset', '--local', '--version', '20261109120000', '--workdir', '/private/tmp/bs-fin09-local-fixture'], args
assert options['timeout'] == 300
assert 'SUPABASE_ACCESS_TOKEN' not in options['env']
`);
  assert.equal(result.status, 0, result.stderr);
});

test("somente cenário 044 prepara localidade e cobertura sintética dos três âmbitos antes de ligar resolução", () => {
  const script = source("scripts/testar-compatibilidade-deploy.mjs");
  const begin = script.indexOf("// FIN10: cobertura exclusivamente sintética");
  assert.notEqual(begin, -1, "fixture territorial 044 ausente");
  const end = script.indexOf("\nconst motor =", begin);
  const commands = [];
  const prepare = new Function("cenario", "uid", "psql", script.slice(begin, end));
  prepare("banco-043", "ator-sintetico", (sql) => commands.push(sql));
  assert.equal(commands.length, 0);
  prepare("banco-044", "ator-sintetico", (sql) => commands.push(sql));
  assert.equal(commands.length, 1);
  assert.match(commands[0], /insert into public\.municipality_catalog/);
  assert.match(commands[0], /insert into public\.operation_location_terms/);
  assert.match(commands[0], /insert into public\.financial_calendar_coverage/);
  assert.match(commands[0], /'4200000'/);
  assert.match(commands[0], /2026/);
  for (const scope of ["nacional", "estadual", "municipal"]) {
    assert.match(commands[0], new RegExp(`'${scope}'`));
  }
  assert.match(commands[0], /'SINTETICA'/);
  assert.match(commands[0], /client_confirmed/);
  assert.match(commands[0], /true/);
});

for (const [scenario, inspectCode, inspectOutput, expectedCode] of [
  ["presente", 0, "true", 0],
  ["ausente", 1, "", 1],
  ["parado", 0, "false", 1],
  ["timeout", 124, "", 124],
]) {
  test(`inspect SQL local: ${scenario}, sem reset ou Docker real`, () => {
    const shell = source("scripts/testar-sql-local.sh");
    const start = shell.indexOf("estado=$(local_command 30 docker inspect");
    const end = shell.indexOf('\necho "Container local:', start);
    assert.ok(start > 0 && end > start);
    const fragment = shell.slice(start, end);
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
container=CONTAINER_SINTETICO
local_command() {
  [ "$*" = '30 docker inspect --format {{.State.Running}} CONTAINER_SINTETICO' ] || exit 99
  printf '%s' '${inspectOutput}'
  return ${inspectCode}
}
${fragment}
`,
      ],
      { encoding: "utf8", timeout: 2000 },
    );
    assert.equal(result.status, expectedCode, result.stderr);
    if (scenario === "presente") assert.equal(result.stderr, "");
    else assert.match(result.stderr, /container|Container/);
    if (scenario === "timeout") assert.match(result.stderr, /prazo|timeout/i);
    if (scenario === "ausente" || scenario === "parado") {
      assert.match(result.stderr, /não existe ou não está rodando/);
    }
  });
}
