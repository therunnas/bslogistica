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

import { existsSync, readFileSync } from "node:fs";

import {
  decidirAcesso,
  decidirSituacaoMfa,
  decidirFluxoMfa,
  decidirMfaNaRecuperacao,
  interpretarBloqueioDeExcecao,
} from "../src/lib/mfa.ts";

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

// ===========================================================================
// PR C — a decisão role-aware de acesso ao painel
// ===========================================================================
//
// A matriz inteira, caso a caso. `decidirAcesso` recebe o papel EFETIVO: quem
// acumula admin + operacional já chega como "admin", resolvido por
// `resolverPapelEfetivo` e exercitado em `npm run test:papel`.

console.log("\ndecidirAcesso — a matriz do PR C\n");

const MATRIZ = [
  ["C1.  admin + aal1 + fator verificado", "admin", "aal1", "exige-fator", "mfa-pendente"],
  ["C2.  admin + aal2", "admin", "aal2", "sem-fator", "liberado"],
  ["C3.  operacional sem fator + aal1", "operacional", "aal1", "sem-fator", "liberado"],
  ["C4.  operacional sem fator + aal2", "operacional", "aal2", "sem-fator", "liberado"],
  ["C5.  operacional com fator + aal1", "operacional", "aal1", "exige-fator", "mfa-pendente"],
  ["C6.  operacional com fator + aal2", "operacional", "aal2", "exige-fator", "liberado"],
  ["C7.  admin+operacional (efetivo admin) + aal1", "admin", "aal1", "exige-fator", "mfa-pendente"],
  ["C8.  admin+operacional (efetivo admin) + aal2", "admin", "aal2", "exige-fator", "liberado"],
  ["C9.  sem papel", "sem-papel", "aal2", "sem-fator", "sem-papel"],
  ["C10. falha da RPC de MFA (admin)", "admin", "aal1", "indeterminado", "mfa-indisponivel"],
  [
    "C11. falha da RPC de MFA (operacional)",
    "operacional",
    "aal1",
    "indeterminado",
    "mfa-indisponivel",
  ],
  ["C12. claim aal ausente", "operacional", null, "sem-fator", "mfa-indisponivel"],
  ["C13. claim aal indefinida", "admin", undefined, "sem-fator", "mfa-indisponivel"],
  ["C14. claim aal desconhecida", "operacional", "aal3", "sem-fator", "mfa-indisponivel"],
  ["C15. claim aal vazia", "operacional", "", "sem-fator", "mfa-indisponivel"],
  // Não estava na matriz enviada, e é o único caso em que `mfa-ausente` ainda
  // nasce: administrador que ainda não cadastrou fator. Ele NÃO é liberado — vai
  // para /mfa cadastrar. Mandá-lo como "mfa-pendente" quebraria o cadastro, que
  // `decidirFluxoMfa` recusa quando não há fator verificado.
  ["C16. admin + aal1 sem fator -> cadastro", "admin", "aal1", "sem-fator", "mfa-ausente"],
];

for (const [caso, papel, nivel, fator, esperado] of MATRIZ) {
  verificar(caso, decidirAcesso(papel, nivel, fator), esperado);
}

// C17 — varredura exaustiva: `liberado` só pode sair de aal2 com papel, ou de
// aal1 com papel operacional e SEM fator verificado. Qualquer outra combinação
// que liberasse seria concessão indevida, e esta varredura pega inclusive a que
// ninguém pensou em escrever como caso.
{
  let indevidas = 0;
  for (const papel of ["admin", "operacional", "sem-papel"]) {
    for (const nivel of ["aal1", "aal2", "aal3", "", null, undefined]) {
      for (const fator of ["sem-fator", "exige-fator", "indeterminado"]) {
        if (decidirAcesso(papel, nivel, fator) !== "liberado") continue;
        const previsto =
          papel !== "sem-papel" &&
          (nivel === "aal2" ||
            (nivel === "aal1" && papel === "operacional" && fator === "sem-fator"));
        if (!previsto) indevidas++;
      }
    }
  }
  verificar("C17. nenhuma liberação fora da regra em 54 combinações", String(indevidas), "0");
}

// ---------------------------------------------------------------------------
// REGRESSÕES EXIGIDAS — cada uma falha se a política for afrouxada
// ---------------------------------------------------------------------------

console.log("\nregressões da política\n");

// R-C1 — admin nunca é liberado em AAL1, com fator, sem fator ou sem saber.
for (const fator of ["sem-fator", "exige-fator", "indeterminado"]) {
  verificar(
    `R-C1. admin + aal1 (${fator}) nunca é liberado`,
    String(decidirAcesso("admin", "aal1", fator) === "liberado"),
    "false",
  );
}

// R-C2 — operacional COM fator verificado não trabalha em AAL1. É a diferença
// entre "MFA opcional" e "MFA dispensável".
verificar(
  "R-C2. operacional com fator + aal1 -> mfa-pendente",
  decidirAcesso("operacional", "aal1", "exige-fator"),
  "mfa-pendente",
);

// R-C3 — e o operacional SEM fator não pode ser recusado: recusá-lo obrigaria
// a cadastrar MFA, que é justamente o que a política não quer.
verificar(
  "R-C3. operacional sem fator + aal1 -> liberado",
  decidirAcesso("operacional", "aal1", "sem-fator"),
  "liberado",
);
verificar(
  "R-C4. operacional sem fator + aal1 nunca vai para cadastro",
  String(decidirAcesso("operacional", "aal1", "sem-fator") === "mfa-ausente"),
  "false",
);

// R-C5 — falha da RPC não é liberação, e também não é "conta sem fator".
for (const papel of ["admin", "operacional"]) {
  verificar(
    `R-C5. ${papel} + aal1 + RPC falhou -> mfa-indisponivel`,
    decidirAcesso(papel, "aal1", "indeterminado"),
    "mfa-indisponivel",
  );
}

// R-C6 — `interpretarBloqueioDeExcecao` é o ponto onde a falha vira "não sei".
// Só o booleano literal `false` abre a exceção de AAL1.
const RESPOSTAS = [
  ["true", true, false, "exige-fator"],
  ["false", false, false, "sem-fator"],
  ["null", null, false, "indeterminado"],
  ["undefined", undefined, false, "indeterminado"],
  ['string "false"', "false", false, "indeterminado"],
  ['string "true"', "true", false, "indeterminado"],
  ["0", 0, false, "indeterminado"],
  ["objeto", {}, false, "indeterminado"],
  ["erro com data=false", false, true, "indeterminado"],
  ["erro com data=true", true, true, "indeterminado"],
];

for (const [nome, data, erro, esperado] of RESPOSTAS) {
  verificar(
    `R-C6. resposta ${nome} -> ${esperado}`,
    interpretarBloqueioDeExcecao(data, erro),
    esperado,
  );
}

// R-C7 — a armadilha concreta: `Boolean(null)` é `false`, e `false` é o valor
// que LIBERA a exceção. Se alguém trocar a interpretação por uma coerção, a
// falha de leitura vira concessão. Este caso é a regressão dessa troca.
verificar(
  "R-C7. null não vira sem-fator (falha nunca concede)",
  String(decidirAcesso("operacional", "aal1", interpretarBloqueioDeExcecao(null, false))),
  "mfa-indisponivel",
);

// ---------------------------------------------------------------------------
// FORMA LITERAL — o que não se observa de fora sem navegador
// ---------------------------------------------------------------------------

console.log("\nforma literal do guard central\n");

const ler = (caminho) => (existsSync(caminho) ? readFileSync(caminho, "utf8") : "");

/** O arquivo sem comentários: evita casar com a própria explicação. */
const semComentarios = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const autorizacao = ler("src/app/(painel)/_autorizacao.ts");
const codigoAutorizacao = semComentarios(autorizacao);

verificar("F1. _autorizacao.ts existe", String(autorizacao.length > 0), "true");

verificar(
  "F2. a decisão central chama decidirAcesso",
  String(codigoAutorizacao.includes("decidirAcesso(")),
  "true",
);

verificar(
  "F3. o estado do fator vem da RPC da 012",
  String(codigoAutorizacao.includes("mfa_bloqueia_excecao_aal1")),
  "true",
);

verificar(
  "F4. a resposta da RPC passa por interpretarBloqueioDeExcecao",
  String(codigoAutorizacao.includes("interpretarBloqueioDeExcecao(")),
  "true",
);

// F5 — a regressão do nextLevel: ele não pode aparecer em CÓDIGO deste arquivo.
// Em comentário pode, e aparece de propósito, explicando por que não se usa.
verificar(
  "F5. nextLevel não aparece no código do guard",
  String(codigoAutorizacao.includes("nextLevel")),
  "false",
);

// F6 — a afirmação falsa que existia aqui não pode voltar em nenhuma forma:
// `getAuthenticatorAssuranceLevel()` sem argumento NÃO valida nextLevel contra
// o servidor. Ela é derivada de `session.user.factors`, que vem do cookie.
verificar(
  "F6. a afirmação incorreta sobre nextLevel não voltou",
  String(/nextLevel[\s\S]{0,80}(validad|vem do servidor|não do cookie)/i.test(autorizacao)),
  "false",
);

verificar(
  "F7. o guard central ainda não usa decidirSituacaoMfa",
  String(codigoAutorizacao.includes("decidirSituacaoMfa")),
  "false",
);

verificar(
  "F8. o papel efetivo vem de resolverPapelEfetivo",
  String(codigoAutorizacao.includes("resolverPapelEfetivo(")),
  "true",
);

// F9 — centralização: ninguém além do guard central lê nível de garantia ou
// pergunta o estado de MFA ao banco dentro do painel. Duas definições de
// "liberado" é o que produz laço entre /mfa, /dashboard e /operacional.
const DEPENDENTES = [
  "src/app/(painel)/layout.tsx",
  "src/app/(painel)/dashboard/page.tsx",
  "src/app/(painel)/_exigir-admin.tsx",
  "src/app/(painel)/_exigir-operacional.tsx",
  "src/app/mfa/page.tsx",
  // PR F: /configuracoes lê lerAcesso() como qualquer outra rota — não ganha
  // exceção nem consulta o nível de garantia por conta própria.
  "src/app/(painel)/configuracoes/page.tsx",
];

for (const caminho of DEPENDENTES) {
  const codigo = semComentarios(ler(caminho));
  verificar(
    `F9. ${caminho} não recalcula o nível`,
    String(codigo.includes("AssuranceLevel")),
    "false",
  );
  verificar(
    `F10. ${caminho} não consulta a RPC de MFA por conta própria`,
    String(codigo.includes("mfa_bloqueia_excecao_aal1")),
    "false",
  );
  verificar(
    `F11. ${caminho} lê a decisão de lerAcesso`,
    String(codigo.includes("lerAcesso")),
    "true",
  );
}

// F12 — a superfície operacional não foi tocada por este PR: nada de migration,
// RPC nova ou coluna financeira entrando pelo guard.
verificar(
  "F12. o guard não fala com as RPCs operacionais",
  String(/listar_\w+_do_operador|salvar_apontamento_operacional/.test(autorizacao)),
  "false",
);
verificar(
  "F13. o guard não menciona service_role",
  String(codigoAutorizacao.includes("service_role")),
  "false",
);

// F14 — o fluxo de recuperação continua com a decisão dele, intocada. Ali
// `nextLevel` ainda existe, e está documentado: aquela decisão não concede
// acesso a dado nenhum, e quem recusa a troca de senha sem AAL2 é o GoTrue.
const libMfa = ler("src/lib/mfa.ts");
verificar(
  "F14. decidirSituacaoMfa continua existindo para a recuperação",
  String(libMfa.includes("export function decidirSituacaoMfa(")),
  "true",
);
verificar(
  "F15. decidirAcesso não recebe nextLevel",
  String(/export function decidirAcesso\([\s\S]{0,200}nextLevel/.test(libMfa)),
  "false",
);

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
