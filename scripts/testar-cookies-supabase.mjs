import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const arquivos = [
  {
    nome: "browser",
    caminho: "src/integrations/supabase/browser.ts",
    factory: "createBrowserClient",
  },
  {
    nome: "server",
    caminho: "src/integrations/supabase/server.ts",
    factory: "createServerClient",
  },
  {
    nome: "proxy",
    caminho: "src/proxy.ts",
    factory: "createServerClient",
  },
];

function chamadasDaFactory(fonte, nome) {
  const arquivo = ts.createSourceFile("cliente.ts", fonte, ts.ScriptTarget.Latest, true);
  const chamadas = [];

  function visitar(no) {
    if (ts.isCallExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === nome) {
      chamadas.push(no);
    }
    ts.forEachChild(no, visitar);
  }

  visitar(arquivo);
  return chamadas;
}

function cookieOptionsDaChamada(chamada) {
  const opcoes = chamada.arguments.at(-1);
  if (!opcoes || !ts.isObjectLiteralExpression(opcoes)) return undefined;

  const propriedade = opcoes.properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      ((ts.isIdentifier(item.name) && item.name.text === "cookieOptions") ||
        (ts.isStringLiteral(item.name) && item.name.text === "cookieOptions")),
  );

  return propriedade && ts.isPropertyAssignment(propriedade) ? propriedade.initializer : undefined;
}

function possuiPropriedade(opcoes, nome) {
  return (
    ts.isObjectLiteralExpression(opcoes) &&
    opcoes.properties.some(
      (item) =>
        (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
        ((ts.isIdentifier(item.name) && item.name.text === nome) ||
          (ts.isStringLiteral(item.name) && item.name.text === nome)),
    )
  );
}

for (const arquivo of arquivos) {
  const fonte = readFileSync(arquivo.caminho, "utf8");
  const chamadas = chamadasDaFactory(fonte, arquivo.factory);
  assert.equal(chamadas.length, 1, `${arquivo.nome}: deve haver uma criação de cliente`);

  const opcoes = chamadas[0].arguments.at(-1);
  const cookieOptions = cookieOptionsDaChamada(chamadas[0]);
  assert.ok(
    cookieOptions &&
      ts.isCallExpression(cookieOptions) &&
      ts.isIdentifier(cookieOptions.expression) &&
      cookieOptions.expression.text === "obterOpcoesCookieSupabase",
    `${arquivo.nome}: cliente deve receber a configuração compartilhada de cookie Secure`,
  );
  assert.equal(
    possuiPropriedade(opcoes, "auth"),
    false,
    `${arquivo.nome}: auth options inalteradas`,
  );
  console.log(`✓ ${arquivo.nome}: recebe configuração compartilhada de cookie`);
}

const { obterOpcoesCookieSupabase } =
  await import("../src/integrations/supabase/cookie-options.ts");

const producao = obterOpcoesCookieSupabase("production");
assert.equal(producao.secure, true, "Production deve ativar Secure");
assert.deepEqual(Object.keys(producao), ["secure"], "não deve sobrescrever defaults do SDK");
assert.equal("httpOnly" in producao, false, "não deve forçar HttpOnly");
assert.equal("sameSite" in producao, false, "não deve sobrescrever SameSite");
assert.equal("path" in producao, false, "não deve sobrescrever Path");
assert.equal("maxAge" in producao, false, "não deve sobrescrever MaxAge");
console.log("✓ Production: Secure ativo e demais defaults preservados");

for (const ambiente of ["development", "test", undefined]) {
  const desenvolvimento = obterOpcoesCookieSupabase(ambiente);
  assert.equal(desenvolvimento.secure, false, `${ambiente}: não deve exigir HTTPS local`);
  assert.deepEqual(Object.keys(desenvolvimento), ["secure"]);
}
console.log("✓ Desenvolvimento/teste: Secure desativado para localhost HTTP");

console.log("\n21 asserções aprovadas.");
