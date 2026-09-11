/**
 * Testes da troca de senha server-side.
 *
 * COMO RODAR:
 *
 *   npm run test:troca
 *
 * O que está coberto: a decisão de autorização no INSTANTE DO ENVIO, que é o
 * ponto do achado P2 — a prova era conferida só na renderização da página, e
 * uma aba deixada aberta continuava trocando a senha depois de ela expirar.
 *
 * A action em si toca rede e cookies, então o que se verifica dela é a ordem
 * das operações, lida do próprio fonte. A decisão é função pura e é testada
 * diretamente.
 */

import { readFileSync } from "node:fs";

import {
  PROPOSITO_DA_PROVA,
  VALIDADE_DA_PROVA_EM_SEGUNDOS,
  VERSAO_DA_PROVA,
  assinarProva,
  verificarProva,
} from "../src/lib/prova-recuperacao.ts";

import {
  MENSAGEM_RECUPERACAO_INVALIDA,
  decidirTrocaDeSenha,
  validarNovaSenha,
} from "../src/lib/recuperacao-senha.ts";

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

const SEGREDO = "segredo-apenas-de-teste-com-mais-de-32-bytes-aqui";
const SUB = "11111111-1111-1111-1111-111111111111";
const SESSAO = "22222222-2222-2222-2222-222222222222";

/** Instante em que a página foi aberta e a prova foi emitida. */
const ABERTURA = 1_760_000_000;

function carga(sobrescritas = {}) {
  return {
    version: VERSAO_DA_PROVA,
    purpose: PROPOSITO_DA_PROVA,
    sub: SUB,
    session_id: SESSAO,
    exp: ABERTURA + VALIDADE_DA_PROVA_EM_SEGUNDOS,
    ...sobrescritas,
  };
}

/** Simula o envio: revalida a prova com o relógio do instante do envio. */
async function envio({ prova, sub = SUB, sessionId = SESSAO, emSegundos, senha, confirmacao }) {
  const resultadoDaProva = await verificarProva(prova, SEGREDO, {
    sub,
    sessionId,
    agoraEmSegundos: emSegundos,
  });
  const decisao = decidirTrocaDeSenha({
    temUsuario: sub !== null,
    temClaims: sessionId !== null,
    resultadoDaProva,
    senhaValida: validarNovaSenha(senha, confirmacao).valida,
  });
  return { resultadoDaProva, decisao, atualizaria: decisao === "prosseguir" };
}

const provaValida = await assinarProva(carga(), SEGREDO);
const SENHA = "senha-nova-123";

console.log("\nA. Prova válida, dentro do prazo\n");

const a = await envio({
  prova: provaValida,
  emSegundos: ABERTURA + 60,
  senha: SENHA,
  confirmacao: SENHA,
});
verificar("A1. decisão -> prosseguir", a.decisao, "prosseguir");
verificar("A2. updateUser seria chamado", String(a.atualizaria), "true");

console.log("\nB. O caso do achado: prova expira com a página já aberta\n");

// Página aberta em ABERTURA, prova válida naquele instante.
const aoAbrir = await verificarProva(provaValida, SEGREDO, {
  sub: SUB,
  sessionId: SESSAO,
  agoraEmSegundos: ABERTURA + 1,
});
verificar("B1. ao abrir a página a prova era válida", aoAbrir, "valida");

// Usuário deixa a aba aberta e envia 11 minutos depois.
const b = await envio({
  prova: provaValida,
  emSegundos: ABERTURA + VALIDADE_DA_PROVA_EM_SEGUNDOS + 1,
  senha: SENHA,
  confirmacao: SENHA,
});
verificar("B2. no envio a prova já expirou", b.resultadoDaProva, "expirada");
verificar("B3. decisão -> recuperacao-invalida", b.decisao, "recuperacao-invalida");
verificar("B4. updateUser NÃO seria chamado", String(b.atualizaria), "false");

// Limite exato: no segundo do exp já não vale.
const bLimite = await envio({
  prova: provaValida,
  emSegundos: ABERTURA + VALIDADE_DA_PROVA_EM_SEGUNDOS,
  senha: SENHA,
  confirmacao: SENHA,
});
verificar("B5. exatamente no exp -> não atualiza", String(bLimite.atualizaria), "false");

console.log("\nC a H. Demais recusas no envio\n");

const casos = [
  ["C. cookie ausente", { prova: undefined }],
  ["D. assinatura inválida", { prova: provaValida.slice(0, -2) + "ZZ" }],
  ["E. sub divergente", { prova: provaValida, sub: "33333333-3333-3333-3333-333333333333" }],
  ["F. session_id divergente", { prova: provaValida, sessionId: "44444444-4444-4444-4444-4444" }],
  ["G1. purpose inválido", { prova: await assinarProva(carga({ purpose: "login" }), SEGREDO) }],
  ["G2. version inválida", { prova: await assinarProva(carga({ version: 99 }), SEGREDO) }],
  ["H1. sem usuário", { prova: provaValida, sub: null }],
  ["H2. sem claims/sessão", { prova: provaValida, sessionId: null }],
];

for (const [nome, extra] of casos) {
  const r = await envio({
    emSegundos: ABERTURA + 60,
    senha: SENHA,
    confirmacao: SENHA,
    ...extra,
  });
  verificar(`${nome} -> updateUser NÃO é chamado`, String(r.atualizaria), "false");
  verificar(`${nome} -> decisão recuperacao-invalida`, r.decisao, "recuperacao-invalida");
}

console.log("\nL. Senha divergente continua rejeitada no servidor\n");

const l = await envio({
  prova: provaValida,
  emSegundos: ABERTURA + 60,
  senha: SENHA,
  confirmacao: "outra-coisa",
});
verificar("L1. decisão -> senha-invalida", l.decisao, "senha-invalida");
verificar("L2. updateUser NÃO seria chamado", String(l.atualizaria), "false");

const lVazia = await envio({
  prova: provaValida,
  emSegundos: ABERTURA + 60,
  senha: "",
  confirmacao: "",
});
verificar("L3. senha vazia -> senha-invalida", lVazia.decisao, "senha-invalida");

// A autorização vem antes do formato: prova ruim não vira erro de senha.
const ordem = await envio({
  prova: undefined,
  emSegundos: ABERTURA + 60,
  senha: SENHA,
  confirmacao: "divergente",
});
verificar(
  "L4. prova inválida tem precedência sobre senha divergente",
  ordem.decisao,
  "recuperacao-invalida",
);

console.log("\nI a K. Garantias estruturais da action e do cliente\n");

const action = readFileSync(
  new URL("../src/app/redefinir-senha/actions.ts", import.meta.url),
  "utf8",
);
const cliente = readFileSync(
  new URL("../src/app/redefinir-senha/formulario-nova-senha.tsx", import.meta.url),
  "utf8",
);

verificar("I1. a action declara 'use server'", String(action.startsWith('"use server"')), "true");

const pValida = action.indexOf("validarProvaDeRecuperacao(");
const pDecide = action.indexOf("decidirTrocaDeSenha(");
const pUpdate = action.indexOf("auth.updateUser(");
const pSignOut = action.indexOf("auth.signOut()");
const pRedirect = action.indexOf("redirect(ROTA_LOGIN_SENHA_REDEFINIDA)");
const pLimpa = action.indexOf("armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA");

verificar("I2. a prova é revalidada na action", String(pValida !== -1), "true");
verificar("I3. revalidação antes do updateUser", String(pValida < pUpdate), "true");
verificar("I4. decisão antes do updateUser", String(pDecide < pUpdate), "true");
verificar("I5. signOut depois do updateUser", String(pUpdate < pSignOut), "true");
verificar("I6. redirect por último", String(pSignOut < pRedirect), "true");
verificar("J1. limpeza do cookie depois do signOut", String(pSignOut < pLimpa), "true");
verificar("J2. limpeza com maxAge 0", String(/maxAge:\s*0/.test(action)), "true");
verificar(
  "J3. limpeza com o mesmo Path do Set-Cookie original",
  String(/path:\s*ROTA_REDEFINIR_SENHA/.test(action)),
  "true",
);
verificar("J4. limpeza mantém httpOnly", String(/httpOnly:\s*true/.test(action)), "true");
verificar("J5. limpeza mantém sameSite lax", String(/sameSite:\s*"lax"/.test(action)), "true");

// Em caso de erro a action retorna antes de qualquer signOut/redirect.
const trechoErro = action.slice(action.indexOf("if (error) {"), pSignOut);
verificar(
  "J6. falha do updateUser retorna sem signOut de sucesso",
  String(trechoErro.includes('return { situacao: "erro"')),
  "true",
);

verificar(
  "K1. o cliente NÃO chama auth.updateUser",
  String(/auth\.updateUser/.test(cliente)),
  "false",
);
verificar("K2. o cliente NÃO chama signOut", String(/signOut/.test(cliente)), "false");
verificar(
  "K3. o cliente não importa o client do Supabase",
  String(/integrations\/supabase/.test(cliente)),
  "false",
);
verificar("K4. o cliente chama a Server Action", String(/redefinirSenha\(/.test(cliente)), "true");
verificar(
  "K5. o cliente não envia token nem conteúdo de prova",
  String(/access_token|bs_recovery_proof|PASSWORD_RECOVERY/.test(cliente)),
  "false",
);
verificar(
  "K6. a action não expõe error.message",
  String(/error\.message/.test(action.replace(/\/\/.*$/gm, ""))),
  "false",
);
verificar(
  "K7. mensagem pública única para falha de autorização",
  String(action.includes("MENSAGEM_RECUPERACAO_INVALIDA")),
  "true",
);
verificar(
  "K8. a mensagem não revela motivo criptográfico",
  String(/assinatura|hmac|expirad|session_id/i.test(MENSAGEM_RECUPERACAO_INVALIDA)),
  "false",
);
verificar("K9. sem service_role na action", String(/service_role/i.test(action)), "false");

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
