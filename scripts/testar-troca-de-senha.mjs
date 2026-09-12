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
  MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS,
  ROTA_DASHBOARD,
  ROTA_LOGIN_SENHA_REDEFINIDA,
  ROTA_LOGIN_SESSOES_ATIVAS,
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
const pSignOut = action.indexOf('signOut({ scope: "others" })');
const pRedirect = action.indexOf("redirect(ROTA_LOGIN_SENHA_REDEFINIDA)");
const pLimpa = action.indexOf("armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA");

verificar("I2. a prova é revalidada na action", String(pValida !== -1), "true");
verificar("I3. revalidação antes do updateUser", String(pValida < pUpdate), "true");
verificar("I4. decisão antes do updateUser", String(pDecide < pUpdate), "true");
verificar(
  "I5. revogação das outras sessões depois do updateUser",
  String(pUpdate < pSignOut),
  "true",
);
verificar("I6. redirect por último", String(pSignOut < pRedirect), "true");
// A limpeza virou a função `apagarProva()`, declarada antes do `signOut` e
// chamada depois dele nos dois desfechos. O que esta asserção sempre quis dizer
// é que a prova só morre depois da tentativa de encerrar a sessão — então o que
// se mede é a CHAMADA, não a declaração.
// A ordem inverteu de proposito: a prova morre ANTES da revogacao remota, para
// que nenhuma falha de rede a deixe viva.
verificar(
  "J1. limpeza do cookie antes da revogação remota",
  String(action.indexOf("apagarProva();") < pSignOut),
  "true",
);
verificar(
  "J1b. a limpeza continua declarada como função própria, chamada uma vez",
  String(pLimpa !== -1 && (action.match(/apagarProva\(\);/g) || []).length),
  "1",
);
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

console.log("\nL. Estado da recuperação quando o signOut global falha\n");

// O achado: com o `updateUser` já bem-sucedido e o `signOut` global falhando, a
// action saía antes de apagar a prova. A senha tinha mudado, mas a sessão de
// recuperação e o `bs_recovery_proof` continuavam de pé por até 10 minutos — e
// a tela ainda dizia que a redefinição havia falhado, o que mandava o usuário
// repetir a mesma senha e colher `same_password`.
const acaoSemComentarios = action
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

const pUpdateUser = acaoSemComentarios.indexOf("auth.updateUser(");
const pErroUpdate = acaoSemComentarios.indexOf("traduzirErroDeSenha(error.code)");
const pSignOutOutras = acaoSemComentarios.indexOf('signOut({ scope: "others" })');
const pRamoDeFalha = acaoSemComentarios.indexOf("if (erroAoSair)");
const pSignOutLocal = acaoSemComentarios.indexOf('signOut({ scope: "local" })');
const pApagaProva = acaoSemComentarios.indexOf("apagarProva();");
const pRedirectFinal = acaoSemComentarios.indexOf("redirect(ROTA_LOGIN_SENHA_REDEFINIDA)");
const pDashboard = acaoSemComentarios.indexOf("redirect(ROTA_DASHBOARD)");

// 1 a 3. A NOVA ordem obrigatória depois do updateUser:
//   updateUser -> apagarProva -> signOut({ scope: "others" })
//
// A prova morre antes de qualquer chamada remota que possa falhar. Deixá-la
// viva num caminho de falha foi um achado de revisão.
verificar("L1. a prova é apagada depois do updateUser", String(pUpdateUser < pApagaProva), "true");
verificar(
  "L1b. a prova é apagada ANTES de revogar as outras sessões",
  String(pApagaProva < pSignOutOutras),
  "true",
);
verificar(
  "L1c. a prova é apagada uma única vez, no caminho comum",
  String((acaoSemComentarios.match(/apagarProva\(\);/g) || []).length),
  "1",
);

// 4 e 5. O caminho feliz revoga só as OUTRAS sessões.
verificar("L2. o caminho feliz usa scope others", String(pSignOutOutras !== -1), "true");
verificar(
  "L2b. o caminho feliz NÃO usa signOut global",
  String(/auth\.signOut\(\)/.test(acaoSemComentarios)),
  "false",
);

// 6. Falha ao revogar as outras: tenta limpeza local e avisa o usuário.
verificar(
  "L3. o ramo de falha tenta signOut local",
  String(pRamoDeFalha !== -1 && pSignOutLocal !== -1),
  "true",
);
verificar(
  "L3b. o ramo de falha vai para sessoes-ativas, não ao painel",
  String(
    acaoSemComentarios
      .slice(pRamoDeFalha, pRamoDeFalha + 400)
      .includes("redirect(ROTA_LOGIN_SESSOES_ATIVAS)"),
  ),
  "true",
);
verificar(
  "L4. o signOut local está em try/catch, para nunca impedir o que vem depois",
  String(
    /try \{\s*await supabase\.auth\.signOut\(\{ scope: "local" \}\);\s*\} catch/.test(
      acaoSemComentarios,
    ),
  ),
  "true",
);
verificar(
  "L4d. cookies internos sb-* não são manipulados à mão",
  String(/["'`]sb-/.test(acaoSemComentarios)),
  "false",
);

// 7 a 13. Revalidação antes do painel: nada é presumido sobre a sessão.
const trechoPosRevogacao = acaoSemComentarios.slice(pSignOutOutras);
verificar(
  "L5. getUser é chamado depois de revogar as outras",
  String(/getUser\(\)/.test(trechoPosRevogacao)),
  "true",
);
verificar(
  "L5b. o AAL é consultado depois de revogar as outras",
  String(/getAuthenticatorAssuranceLevel\(\)/.test(trechoPosRevogacao)),
  "true",
);
verificar(
  "L5c. exige o MESMO user.id de antes da troca",
  String(/usuarioDepois\?\.id === user!\.id/.test(trechoPosRevogacao)),
  "true",
);
verificar(
  "L5d. exige currentLevel aal2 para preservar a sessão",
  String(/nivelDepois\?\.currentLevel === "aal2"/.test(trechoPosRevogacao)),
  "true",
);
verificar(
  "L5e. erro ao consultar o AAL impede a preservação",
  String(/!erroNivelDepois/.test(trechoPosRevogacao)),
  "true",
);
verificar(
  "L5f. qualquer divergência cai no login, nunca no painel",
  String(
    /if \(!mesmoUsuario \|\| !continuaEmAal2\)[\s\S]{0,200}?redirect\(ROTA_LOGIN_SENHA_REDEFINIDA\)/.test(
      acaoSemComentarios,
    ),
  ),
  "true",
);
verificar(
  "L5g. o fallback também derruba a sessão local antes de mandar ao login",
  String(
    /if \(!mesmoUsuario \|\| !continuaEmAal2\)[\s\S]{0,160}?derrubarSessaoLocal\(\)/.test(
      acaoSemComentarios,
    ),
  ),
  "true",
);
verificar(
  "L6. o dashboard é o ÚLTIMO passo, depois de todas as validações",
  String(pDashboard > pSignOutOutras && pDashboard > pRedirectFinal),
  "true",
);
verificar(
  "L6b. há um único redirect ao painel na action",
  String((acaoSemComentarios.match(/redirect\(ROTA_DASHBOARD\)/g) || []).length),
  "1",
);
verificar("L6c. ROTA_DASHBOARD é /dashboard", ROTA_DASHBOARD, "/dashboard");

// 4. O desfecho parcial tem destino próprio, separado do sucesso normal.
//
// Antes ele voltava como estado para o formulário. Isso prendia o usuário: a
// senha já tinha mudado, o formulário não servia mais para nada e um F5 caía em
// /esqueci-senha, porque a prova acabara de ser apagada. Agora sai da tela.
verificar(
  "L5. o ramo de falha redireciona para o destino de sessões ativas",
  String(
    acaoSemComentarios
      .slice(pRamoDeFalha, pRedirectFinal)
      .includes("redirect(ROTA_LOGIN_SESSOES_ATIVAS)"),
  ),
  "true",
);
verificar(
  "L5b. o destino parcial é diferente do sucesso normal",
  String(ROTA_LOGIN_SESSOES_ATIVAS !== ROTA_LOGIN_SENHA_REDEFINIDA),
  "true",
);
verificar(
  "L5b2. o destino parcial carrega os dois parâmetros",
  ROTA_LOGIN_SESSOES_ATIVAS,
  "/login?senha-redefinida=1&sessoes-ativas=1",
);
verificar(
  "L5c. a mensagem afirma que a senha foi alterada",
  String(/senha alterada/i.test(MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS)),
  "true",
);
verificar(
  "L5d. a mensagem fala do encerramento de sessões",
  String(/sess(õ|o)es/i.test(MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS)),
  "true",
);
verificar(
  "L5e. a mensagem NÃO diz que a redefinição falhou",
  String(/não foi possível redefinir|falh/i.test(MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS)),
  "false",
);

// 9 e 10. O formulário não sobrevive à troca de senha.
const clienteSemComentarios = cliente.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
verificar(
  "L5f. o cliente não tem mais ramo de desfecho parcial (o redirect resolve)",
  String(/senha-alterada-sessoes-ativas/.test(clienteSemComentarios)),
  "false",
);
verificar(
  "L5g. o cliente só reabilita o botão no caminho de erro",
  String((clienteSemComentarios.match(/setEnviando\(false\)/g) || []).length),
  "1",
);
verificar(
  "L5h. a reabilitação está no ramo de erro",
  String(/situacao === "erro"[\s\S]{0,120}?setEnviando\(false\)/.test(clienteSemComentarios)),
  "true",
);
verificar(
  "L5i. o envio é bloqueado enquanto uma submissão está em curso",
  String(/if \(enviando\) return/.test(clienteSemComentarios)),
  "true",
);

// 6. Os dois desfechos de senha alterada saem da tela; nenhum deles volta
//    estado para um formulário que não serve mais.
verificar(
  "L6. o ramo de falha não devolve estado ao formulário",
  String(acaoSemComentarios.slice(pRamoDeFalha, pRedirectFinal).includes("return {")),
  "false",
);
verificar(
  "L6b. há apenas um redirect de sucesso normal na action",
  String((acaoSemComentarios.match(/redirect\(ROTA_LOGIN_SENHA_REDEFINIDA\)/g) || []).length),
  "1",
);
verificar(
  "L6c. há apenas um redirect de desfecho parcial na action",
  String((acaoSemComentarios.match(/redirect\(ROTA_LOGIN_SESSOES_ATIVAS\)/g) || []).length),
  "1",
);

// 7. updateUser falhando não passa por nada disso.
verificar(
  "L7. a falha do updateUser retorna antes do signOut",
  String(pUpdateUser < pErroUpdate && pErroUpdate < pSignOutOutras),
  "true",
);
// A declaração de `apagarProva()` fica entre o tratamento do erro e o
// `signOut`, então medir o intervalo inteiro acusaria a declaração como se
// fosse uma chamada. O que importa é o bloco do `if (error)`: dele tem de sair
// um return puro, sem limpar prova nem encerrar sessão — a senha não mudou.
const blocoErroUpdate = acaoSemComentarios.slice(
  acaoSemComentarios.indexOf("if (error) {", pUpdateUser),
  pErroUpdate,
);
verificar(
  "L7b. a falha do updateUser não apaga a prova nem encerra sessão",
  String(/apagarProva\(\);|signOut/.test(blocoErroUpdate)),
  "false",
);

console.log("\nN. Segundo fator antes da troca de senha\n");

// O achado de Production: o verifyOtp cria a sessão em aal1, e o GoTrue recusa
// PUT /user com 401 "AAL2 session is required to update email or password when
// MFA is enabled". A exigência é condicional — só para conta com fator.
const pNivelTroca = acaoSemComentarios.indexOf("getAuthenticatorAssuranceLevel()");
const pDecisaoMfa = acaoSemComentarios.indexOf("decidirMfaNaRecuperacao(");
const pUpdate2 = acaoSemComentarios.indexOf("auth.updateUser(");

verificar("N1. a action consulta o nível de garantia", String(pNivelTroca !== -1), "true");
verificar("N2. a consulta acontece ANTES do updateUser", String(pNivelTroca < pUpdate2), "true");
verificar("N2b. a decisão de MFA vem antes do updateUser", String(pDecisaoMfa < pUpdate2), "true");
verificar(
  "N3. fator pendente NÃO chama updateUser",
  String(/decisaoMfa === "desafiar-mfa"[\s\S]{0,160}?return \{/.test(acaoSemComentarios)),
  "true",
);
verificar(
  "N4. nível indisponível NÃO chama updateUser",
  String(/decisaoMfa === "falhar"[\s\S]{0,160}?return \{/.test(acaoSemComentarios)),
  "true",
);
// Conta sem fator segue em aal1: a action não exige aal2 incondicionalmente.
verificar(
  "N5. não há exigência incondicional de aal2 na action",
  String(/currentLevel !== "aal2"/.test(acaoSemComentarios)),
  "false",
);
verificar(
  "N5b. a decisão usa a função pura do recovery, não uma comparação solta",
  String(/decidirMfaNaRecuperacao\(\s*decidirSituacaoMfa\(/.test(acaoSemComentarios)),
  "true",
);

// A página também revalida, e manda ao desafio em vez de deixar o 401 acontecer.
const paginaTroca = readFileSync(
  new URL("../src/app/redefinir-senha/page.tsx", import.meta.url),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

verificar(
  "N6. a página redireciona ao desafio quando há fator pendente",
  String(/decisao === "desafiar-mfa"\) redirect\(ROTA_REDEFINIR_SENHA_MFA\)/.test(paginaTroca)),
  "true",
);
verificar(
  "N7. a página falha fechada quando o nível é indisponível",
  String(/decisao === "falhar"/.test(paginaTroca)),
  "true",
);
verificar(
  "N8. nenhuma rota da recuperação leva ao painel",
  String(/dashboard/.test(paginaTroca) || /dashboard/.test(acaoSemComentarios)),
  "false",
);

console.log("\nM. Login no desfecho parcial\n");

// O login redireciona para /dashboard quem já tem sessão. No desfecho parcial
// isso seria o pior comportamento possível: a sessão que sobreviveu ao signOut
// é justamente o problema, e mandar o usuário ao painel o faria pular o aviso e
// seguir com a sessão antiga, sem nunca usar a senha nova.
const login = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const loginSemComentarios = login
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

// 5 e 6. Mensagem persistente no card, não toast.
verificar(
  "M1. o login escolhe a mensagem pelo parâmetro de sessões ativas",
  String(loginSemComentarios.includes("MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS")),
  "true",
);
verificar(
  "M2. a mensagem parcial é renderizada, não exibida por toast",
  String(
    /\{sessoesAtivas \? MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS : MENSAGEM_SENHA_REDEFINIDA\}/.test(
      loginSemComentarios,
    ),
  ),
  "true",
);
verificar(
  "M2b. o aviso do login não usa toast",
  String(/toast\.(warning|info|success)\(/.test(loginSemComentarios)),
  "false",
);
verificar(
  "M2c. o aviso é anunciado como status acessível",
  String(/role="status"/.test(loginSemComentarios)),
  "true",
);

// 7. Sem auto-redirect nesse status.
verificar(
  "M3. o efeito lê o parâmetro de sessões ativas",
  String(loginSemComentarios.includes("PARAM_SESSOES_ATIVAS")),
  "true",
);
verificar(
  "M4. o efeito sai antes de consultar a sessão quando há sessões ativas",
  String(
    loginSemComentarios.indexOf("if (sessoesAtivas) return;") <
      loginSemComentarios.indexOf("auth.getUser()"),
  ),
  "true",
);
verificar(
  "M4b. a guarda vem antes de instanciar o cliente do navegador",
  String(
    loginSemComentarios.indexOf("if (sessoesAtivas) return;") <
      loginSemComentarios.indexOf("criarClienteNavegador()"),
  ),
  "true",
);

// 8. O comportamento normal continua intacto.
verificar(
  "M5. fora desse status o login segue redirecionando quem tem sessão",
  String(/if \(data\.user\) router\.replace\("\/dashboard"\)/.test(loginSemComentarios)),
  "true",
);
verificar(
  "M5b. o login continua com um único auto-redirect para o painel",
  String((loginSemComentarios.match(/router\.replace\("\/dashboard"\)/g) || []).length),
  "2", // o do efeito e o do submit bem-sucedido
);
verificar(
  "M6. o parâmetro é lido do location, sem exigir Suspense no componente",
  String(/new URLSearchParams\(window\.location\.search\)/.test(loginSemComentarios)),
  "true",
);

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
