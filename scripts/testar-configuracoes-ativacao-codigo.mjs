/**
 * Regressão S19D-DEF-002: ao ATIVAR a verificação em duas etapas com um código errado, a tela de
 * Segurança mostrava a mensagem crua do Supabase ("Invalid TOTP code entered"), em inglês. A
 * DESATIVAÇÃO já traduzia o mesmo erro com `mensagemDeCodigoInvalido`. As duas passam a usar a
 * mesma tradução; a decisão (fator continua pendente, nada é ativado) não muda.
 * Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const tela = readFileSync(
  path.join(root, "src/app/(painel)/configuracoes/painel-configuracoes.tsx"),
  "utf8",
);

test("ativação com código recusado usa a mensagem traduzida", () => {
  const verificacao = tela.indexOf(
    "supabase.auth.mfa.challengeAndVerify({\n      factorId: idDoFator",
  );
  assert.ok(verificacao > 0, "verificação da ativação não encontrada");
  const trecho = tela.slice(verificacao, tela.indexOf("return;", verificacao));
  assert.match(trecho, /toast\.error\(mensagemDeCodigoInvalido\(error\)\)/);
  assert.doesNotMatch(trecho, /toast\.error\(error\.message\)/);
});

test("nenhum caminho de código TOTP mostra a mensagem crua do Supabase", () => {
  const chamadas = [...tela.matchAll(/challengeAndVerify\(/g)].length;
  const traduzidas = [...tela.matchAll(/toast\.error\(mensagemDeCodigoInvalido\(/g)].length;
  assert.equal(chamadas, 2);
  assert.equal(traduzidas, chamadas);
});
