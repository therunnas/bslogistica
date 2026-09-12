/**
 * Testes das decisões de segundo fator.
 *
 * COMO RODAR:
 *
 *   npm run test:mfa
 *
 * Sem framework: o projeto não tem nenhum, e instalar um só para estas funções
 * seria desproporcional. O Node executa o módulo TypeScript direto, via
 * `--experimental-strip-types` — daí a exigência de Node 22.6+ para rodar os
 * testes, embora a aplicação em si continue valendo a partir do 20.9.
 *
 * Sai com código diferente de zero em qualquer falha, para servir em CI.
 */

import { decidirSituacaoMfa, decidirFluxoMfa, decidirMfaNaRecuperacao } from "../src/lib/mfa.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${esperado}, obtido ${obtido}`);
    console.log(`  FAIL  ${caso} — esperado ${esperado}, obtido ${obtido}`);
  }
}

console.log("\ndecidirSituacaoMfa — para onde mandar quem tem sessão e papel\n");

// CASO 1 — conta sem nenhum fator verificado: nextLevel não sobe para aal2.
verificar(
  "1. sem fator -> cadastro",
  decidirSituacaoMfa({ currentLevel: "aal1", nextLevel: "aal1" }, false),
  "mfa-ausente",
);

// CASO 2 — tem fator, mas a sessão ainda não passou pelo código.
verificar(
  "2. fator verificado + sessão aal1 -> desafio",
  decidirSituacaoMfa({ currentLevel: "aal1", nextLevel: "aal2" }, false),
  "mfa-pendente",
);

// CASO 3 — os dois em aal2: nada a pedir.
verificar(
  "3. fator verificado + sessão aal2 -> painel liberado",
  decidirSituacaoMfa({ currentLevel: "aal2", nextLevel: "aal2" }, false),
  "liberado",
);

// CASO 4 — a consulta falhou. Não se sabe se há fator: nem painel, nem cadastro.
verificar(
  "4. erro na consulta de nível -> indisponível (fail-closed)",
  decidirSituacaoMfa({ currentLevel: "aal2", nextLevel: "aal2" }, true),
  "mfa-indisponivel",
);
verificar("4b. nível nulo -> indisponível", decidirSituacaoMfa(null, false), "mfa-indisponivel");
verificar(
  "4c. erro NÃO vira cadastro",
  decidirSituacaoMfa(null, true) === "mfa-ausente" ? "virou cadastro" : "não virou cadastro",
  "não virou cadastro",
);
verificar(
  "4d. erro NÃO libera o painel",
  decidirSituacaoMfa(null, true) === "liberado" ? "liberou" : "não liberou",
  "não liberou",
);

// CASO 6 — sessão em aal2 não pede MFA de novo, quantas vezes for consultada.
verificar(
  "6. navegação/refresh com aal2 -> continua liberado",
  [1, 2, 3]
    .map(() => decidirSituacaoMfa({ currentLevel: "aal2", nextLevel: "aal2" }, false))
    .every((s) => s === "liberado")
    ? "sempre liberado"
    : "pediu MFA de novo",
  "sempre liberado",
);

// Sessão sem claim de nível: trata como aal1, ou seja, ainda falta o código.
verificar(
  "extra. currentLevel nulo com fator -> desafio",
  decidirSituacaoMfa({ currentLevel: null, nextLevel: "aal2" }, false),
  "mfa-pendente",
);

console.log("\ndecidirFluxoMfa — o que a tela faz depois de ler os fatores\n");

// CASO 5 — o ponto central da correção: com fator verificado, nunca cadastrar.
verificar(
  "5. fator verificado + etapa 'cadastro' -> desafio (enroll NÃO é chamado)",
  decidirFluxoMfa(true, "mfa-ausente"),
  "desafio",
);
verificar(
  "5b. fator verificado + etapa 'desafio' -> desafio",
  decidirFluxoMfa(true, "mfa-pendente"),
  "desafio",
);
verificar(
  "1b. sem fator + etapa 'cadastro' -> cadastro",
  decidirFluxoMfa(false, "mfa-ausente"),
  "cadastro",
);
verificar(
  "extra. sem fator mas guard disse que havia -> incoerência, não cadastra",
  decidirFluxoMfa(false, "mfa-pendente"),
  "sem-fator-esperado",
);

console.log("\nR. Segundo fator dentro da recuperação de senha\n");

// O achado que motivou este bloco: `verifyOtp({ type: "recovery" })` cria a
// sessão em aal1, e o Supabase recusa a troca de senha nela quando a conta tem
// MFA — `PUT /user` devolve 401 "AAL2 session is required to update email or
// password when MFA is enabled". A exigência é CONDICIONAL: só vale para quem
// tem fator verificado.

verificar(
  "R1. aal1 com fator verificado -> desafiar-mfa",
  decidirMfaNaRecuperacao(decidirSituacaoMfa({ currentLevel: "aal1", nextLevel: "aal2" }, false)),
  "desafiar-mfa",
);
verificar(
  "R2. aal2 -> prosseguir",
  decidirMfaNaRecuperacao(decidirSituacaoMfa({ currentLevel: "aal2", nextLevel: "aal2" }, false)),
  "prosseguir",
);
// Conta sem fator segue em aal1: exigir aal2 aqui travaria a recuperação de
// quem nunca cadastrou MFA, e para ela o 401 do GoTrue não acontece.
verificar(
  "R3. conta sem fator verificado -> prosseguir em aal1",
  decidirMfaNaRecuperacao(decidirSituacaoMfa({ currentLevel: "aal1", nextLevel: "aal1" }, false)),
  "prosseguir",
);
// Erro na consulta não é ausência de fator: fail closed.
verificar(
  "R4. erro ao consultar o nível -> falhar",
  decidirMfaNaRecuperacao(decidirSituacaoMfa(null, true)),
  "falhar",
);
verificar(
  "R4b. nível ausente sem erro declarado -> falhar",
  decidirMfaNaRecuperacao(decidirSituacaoMfa(null, false)),
  "falhar",
);
verificar(
  "R4c. erro tem precedência sobre nível aparentemente válido",
  decidirMfaNaRecuperacao(decidirSituacaoMfa({ currentLevel: "aal1", nextLevel: "aal2" }, true)),
  "falhar",
);

// No recovery existem só três saídas, e nenhuma delas cadastra fator.
for (const situacao of ["mfa-pendente", "mfa-ausente", "mfa-indisponivel", "liberado"]) {
  verificar(
    `R5. ${situacao} -> saída válida do recovery (nunca cadastro)`,
    String(["desafiar-mfa", "prosseguir", "falhar"].includes(decidirMfaNaRecuperacao(situacao))),
    "true",
  );
}

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
