import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "bs-deployment-policy-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const command = new URL("./validate-vercel-deployment-policy.mjs", import.meta.url);
const valid = '{"framework":"nextjs","git":{"deploymentEnabled":{"main":false}}}';
const cases = [
  ["aceita main bloqueada com demais branches habilitadas por padrão", valid, 0],
  [
    "aceita campos alheios à política sem removê-los",
    '{"$schema":"https://openapi.vercel.sh/vercel.json","framework":"nextjs","buildCommand":"npm run build","git":{"deploymentEnabled":{"main":false}}}',
    0,
  ],
  ["recusa regra ausente", '{"framework":"nextjs"}', 1],
  ["recusa mapa vazio", '{"framework":"nextjs","git":{"deploymentEnabled":{}}}', 1],
  ["recusa main habilitada", '{"framework":"nextjs","git":{"deploymentEnabled":{"main":true}}}', 1],
  [
    "recusa booleano global que desliga os Previews",
    '{"framework":"nextjs","git":{"deploymentEnabled":false}}',
    1,
  ],
  [
    "recusa booleano global que habilita main",
    '{"framework":"nextjs","git":{"deploymentEnabled":true}}',
    1,
  ],
  [
    "recusa glob concorrente que reabilita main",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"main":false,"**":true}}}',
    1,
  ],
  [
    "recusa glob concorrente que bloqueia Previews",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"main":false,"preview/*":false}}}',
    1,
  ],
  [
    "recusa regra extra mesmo com valor true",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"main":false,"preview/*":true}}}',
    1,
  ],
  [
    "recusa branch incorreta",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"Main":false}}}',
    1,
  ],
  [
    "recusa string em lugar do booleano false",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"main":"false"}}}',
    1,
  ],
  [
    "recusa array em lugar do mapa de branches",
    '{"framework":"nextjs","git":{"deploymentEnabled":[false]}}',
    1,
  ],
  ["recusa framework removido", '{"git":{"deploymentEnabled":{"main":false}}}', 1],
  [
    "recusa framework alterado",
    '{"framework":"vite","git":{"deploymentEnabled":{"main":false}}}',
    1,
  ],
  ["recusa JSON inválido", '{"framework":"nextjs",', 1],
  ["recusa raiz nula", "null", 1],
  ["recusa git nulo", '{"framework":"nextjs","git":null}', 1],
  [
    "recusa chave de branch duplicada e ambígua",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"main":true,"main":false}}}',
    1,
  ],
  [
    "recusa git duplicado mesmo se o último parecer seguro",
    '{"framework":"nextjs","git":{"deploymentEnabled":true},"git":{"deploymentEnabled":{"main":false}}}',
    1,
  ],
  [
    "recusa duplicidade com escape Unicode",
    '{"framework":"nextjs","git":{"deploymentEnabled":{"ma\\u0069n":true,"main":false}}}',
    1,
  ],
];

for (const [index, [name, source, status]] of cases.entries()) {
  test(name, () => {
    const file = join(directory, `${index}.json`);
    writeFileSync(file, source);
    const result = spawnSync(process.execPath, [command.pathname, file], { encoding: "utf8" });
    assert.equal(result.status, status);
    assert.match(status === 0 ? result.stdout : result.stderr, status === 0 ? /^PASS:/ : /^FAIL:/);
  });
}

test("arquivo ilegível falha sem exibir conteúdo ou stack trace", () => {
  const result = spawnSync(process.execPath, [command.pathname, join(directory, "missing.json")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL:/);
  assert.doesNotMatch(result.stderr, /ENOENT|at file:|node:internal/);
});
