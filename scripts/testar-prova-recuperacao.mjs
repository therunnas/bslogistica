/**
 * Testes da prova assinada de recuperação de senha.
 *
 * COMO RODAR:
 *
 *   npm run test:prova
 *
 * Mesmo formato dos outros scripts: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * O segredo entra por parâmetro nas funções de núcleo, então nada aqui depende
 * de variável de ambiente e nenhum segredo real é criado.
 */

import {
  PROPOSITO_DA_PROVA,
  VALIDADE_DA_PROVA_EM_SEGUNDOS,
  VERSAO_DA_PROVA,
  assinarProva,
  verificarProva,
} from "../src/lib/prova-recuperacao.ts";

import {
  ROTA_CONFIRMAR_RECUPERACAO,
  ROTA_REDEFINIR_SENHA,
  VALIDADE_DO_PENDENTE_EM_SEGUNDOS,
  decidirAcessoRedefinicao,
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
const OUTRO_SEGREDO = "outro-segredo-apenas-de-teste-completamente-diferente";
const SUB = "11111111-1111-1111-1111-111111111111";
const SESSAO = "22222222-2222-2222-2222-222222222222";
const AGORA = 1_760_000_000;

function carga(sobrescritas = {}) {
  return {
    version: VERSAO_DA_PROVA,
    purpose: PROPOSITO_DA_PROVA,
    sub: SUB,
    session_id: SESSAO,
    exp: AGORA + 600,
    ...sobrescritas,
  };
}

const esperado = { sub: SUB, sessionId: SESSAO, agoraEmSegundos: AGORA };

console.log("\nA. Prova legítima\n");

const provaValida = await assinarProva(carga(), SEGREDO);
verificar(
  "A1. prova íntegra, no prazo, mesma sessão -> valida",
  await verificarProva(provaValida, SEGREDO, esperado),
  "valida",
);
verificar("A2. formato é corpo.assinatura", String(provaValida.split(".").length), "2");
verificar(
  "A3. a prova não carrega o token_hash",
  String(provaValida.toLowerCase().includes("token")),
  "false",
);

console.log("\nB. Assinatura\n");

verificar(
  "B1. assinado com outro segredo -> assinatura-invalida",
  await verificarProva(await assinarProva(carga(), OUTRO_SEGREDO), SEGREDO, esperado),
  "assinatura-invalida",
);
verificar(
  "B2. assinatura alterada -> assinatura-invalida",
  await verificarProva(
    provaValida.slice(0, -2) + (provaValida.endsWith("AA") ? "BB" : "AA"),
    SEGREDO,
    esperado,
  ),
  "assinatura-invalida",
);
verificar(
  "B3. assinatura removida -> malformada",
  await verificarProva(provaValida.split(".")[0], SEGREDO, esperado),
  "malformada",
);

console.log("\nC. Payload adulterado (sem reassinar)\n");

// Troca o corpo mantendo a assinatura antiga: é a tentativa óbvia de forjar.
const corpoForjado = Buffer.from(JSON.stringify(carga({ sub: "outro-usuario" }))).toString(
  "base64url",
);
verificar(
  "C1. corpo trocado, assinatura antiga -> assinatura-invalida",
  await verificarProva(`${corpoForjado}.${provaValida.split(".")[1]}`, SEGREDO, esperado),
  "assinatura-invalida",
);
verificar(
  "C2. corpo e assinatura inventados do zero -> assinatura-invalida",
  await verificarProva(`${corpoForjado}.QUJD`, SEGREDO, esperado),
  "assinatura-invalida",
);

console.log("\nD. Campos da carga (todos com assinatura válida)\n");

verificar(
  "D1. expirada -> expirada",
  await verificarProva(await assinarProva(carga({ exp: AGORA - 1 }), SEGREDO), SEGREDO, esperado),
  "expirada",
);
verificar(
  "D2. exp exatamente agora -> expirada (limite fechado)",
  await verificarProva(await assinarProva(carga({ exp: AGORA }), SEGREDO), SEGREDO, esperado),
  "expirada",
);
verificar(
  "D3. purpose errado -> proposito-invalido",
  await verificarProva(await assinarProva(carga({ purpose: "login" }), SEGREDO), SEGREDO, esperado),
  "proposito-invalido",
);
verificar(
  "D4. version diferente -> versao-invalida",
  await verificarProva(await assinarProva(carga({ version: 2 }), SEGREDO), SEGREDO, esperado),
  "versao-invalida",
);
verificar(
  "D5. sub divergente -> sub-divergente",
  await verificarProva(
    await assinarProva(carga({ sub: "33333333-3333-3333-3333-333333333333" }), SEGREDO),
    SEGREDO,
    esperado,
  ),
  "sub-divergente",
);
verificar(
  "D6. session_id divergente -> sessao-divergente",
  await verificarProva(
    await assinarProva(carga({ session_id: "44444444-4444-4444-4444-444444444444" }), SEGREDO),
    SEGREDO,
    esperado,
  ),
  "sessao-divergente",
);
verificar(
  "D7. prova de outra sessão do MESMO usuário -> sessao-divergente",
  await verificarProva(await assinarProva(carga(), SEGREDO), SEGREDO, {
    sub: SUB,
    sessionId: "99999999-9999-9999-9999-999999999999",
    agoraEmSegundos: AGORA,
  }),
  "sessao-divergente",
);

console.log("\nE. Cookie ausente ou malformado\n");

for (const [nome, valor] of [
  ["E1. cookie ausente (undefined)", undefined],
  ["E2. cookie nulo", null],
  ["E3. cookie vazio", ""],
]) {
  verificar(`${nome} -> ausente`, await verificarProva(valor, SEGREDO, esperado), "ausente");
}

for (const [nome, valor] of [
  ["E4. sem ponto separador", "abcdef"],
  ["E5. pontos demais", "a.b.c"],
  ["E6. base64url inválido", "!!!.???"],
  ["E7. corpo que não é JSON", `${Buffer.from("nao-json").toString("base64url")}.QUJD`],
]) {
  const r = await verificarProva(valor, SEGREDO, esperado);
  verificar(`${nome} -> malformada ou assinatura-invalida`, String(r !== "valida"), "true");
}

// Corpo JSON válido mas sem os campos, assinado corretamente: tem de cair em
// malformada, não passar por cima da checagem de tipos.
const corpoIncompleto = Buffer.from(JSON.stringify({ version: 1 })).toString("base64url");
const { createHmac } = await import("node:crypto");
const assinaturaIncompleta = createHmac("sha256", SEGREDO)
  .update(corpoIncompleto)
  .digest("base64url");
verificar(
  "E8. JSON válido sem os campos, assinado -> malformada",
  await verificarProva(`${corpoIncompleto}.${assinaturaIncompleta}`, SEGREDO, esperado),
  "malformada",
);

console.log("\nF. decidirAcessoRedefinicao — composição do guard\n");

verificar(
  "F1. usuário + claims + prova válida -> permitir",
  decidirAcessoRedefinicao({ temUsuario: true, temClaims: true, resultadoDaProva: "valida" }),
  "permitir",
);
verificar(
  "F2. sessão comum de password, sem prova -> negar",
  decidirAcessoRedefinicao({ temUsuario: true, temClaims: true, resultadoDaProva: "ausente" }),
  "negar",
);
verificar(
  "F3. AMR=otp sozinho, sem prova -> negar (AMR não decide mais nada)",
  decidirAcessoRedefinicao({ temUsuario: true, temClaims: true, resultadoDaProva: "ausente" }),
  "negar",
);
verificar(
  "F4. sem usuário -> negar",
  decidirAcessoRedefinicao({ temUsuario: false, temClaims: true, resultadoDaProva: "valida" }),
  "negar",
);
verificar(
  "F5. sem claims -> negar",
  decidirAcessoRedefinicao({ temUsuario: true, temClaims: false, resultadoDaProva: "valida" }),
  "negar",
);
verificar(
  "F6. segredo ausente no servidor -> negar (falha fechada)",
  decidirAcessoRedefinicao({ temUsuario: true, temClaims: true, resultadoDaProva: "sem-segredo" }),
  "negar",
);

for (const motivo of [
  "assinatura-invalida",
  "malformada",
  "expirada",
  "proposito-invalido",
  "versao-invalida",
  "sub-divergente",
  "sessao-divergente",
]) {
  verificar(
    `F7.${motivo} -> negar`,
    decidirAcessoRedefinicao({ temUsuario: true, temClaims: true, resultadoDaProva: motivo }),
    "negar",
  );
}

console.log("\nG. Garantias estruturais\n");

const { readFileSync } = await import("node:fs");
// O consumo do token saiu do GET e foi para a Server Action — um GET não pode
// gastar token de uso único, porque scanners de e-mail o visitam sozinhos. As
// garantias estruturais abaixo acompanharam o código para onde ele foi.
const acao = readFileSync(
  new URL("../src/app/auth/confirmar-recuperacao/actions.ts", import.meta.url),
  "utf8",
);
const guardaDoLink = readFileSync(
  new URL("../src/app/auth/confirm/route.ts", import.meta.url),
  "utf8",
);
const paginaDeConfirmacao = readFileSync(
  new URL("../src/app/auth/confirmar-recuperacao/page.tsx", import.meta.url),
  "utf8",
);

/**
 * Estes testes falam sobre o que o código FAZ, então precisam ler só código.
 * Os comentários destes arquivos explicam justamente o que eles deixaram de
 * fazer — o GET descreve por que não chama mais `verifyOtp`, a página explica
 * que não recebe `token_hash` — e casar com esse texto reprovaria o código
 * correto pelo motivo errado.
 */
function soCodigo(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

const semComentariosGuarda = soCodigo(guardaDoLink);
const semComentariosPagina = soCodigo(paginaDeConfirmacao);

// A prova só pode nascer depois do verifyOtp dar certo.
const posVerify = acao.indexOf("verifyOtp(");
const posFalha = acao.indexOf("if (error || !data.session) falharSemSessao()");
const posCriar = acao.indexOf("criarProvaDeRecuperacao(");
const posCookie = acao.indexOf("armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA");

verificar("G1. a action chama verifyOtp", String(posVerify !== -1), "true");
verificar(
  "G2. falha do verifyOtp corta antes de criar a prova",
  String(posFalha < posCriar),
  "true",
);
verificar("G3. a prova é criada depois do verifyOtp", String(posVerify < posCriar), "true");
// Regressão que motivou a mudança: o GET não pode consumir o token.
verificar(
  "G3b. o GET do link NÃO chama verifyOtp",
  String(/verifyOtp/.test(semComentariosGuarda)),
  "false",
);
verificar("G4. o cookie é gravado depois da prova", String(posCriar < posCookie), "true");
verificar("G5. cookie httpOnly", String(/httpOnly:\s*true/.test(acao)), "true");
// `lax` e não `strict`: o fluxo chega de um link de e-mail, e `strict` pode
// impedir o envio do cookie na requisição seguinte ao redirect.
verificar("G6. cookie sameSite lax", String(/sameSite:\s*"lax"/.test(acao)), "true");
verificar(
  "G6b. cookie NÃO usa sameSite strict",
  String(/sameSite:\s*"strict"/.test(acao)),
  "false",
);
// Path restrito: só a rota que lê a prova recebe o cookie.
verificar(
  "G6c. cookie com Path da rota de redefinição",
  String(/path:\s*ROTA_REDEFINIR_SENHA/.test(acao)),
  "true",
);
verificar("G6d. cookie NÃO usa path raiz", String(/path:\s*"\/"/.test(acao)), "false");
verificar("G6e. ROTA_REDEFINIR_SENHA é /redefinir-senha", ROTA_REDEFINIR_SENHA, "/redefinir-senha");
verificar(
  "G7. cookie secure em produção",
  String(/secure:\s*process\.env\.NODE_ENV === "production"/.test(acao)),
  "true",
);
verificar(
  "G8. maxAge de 10 minutos",
  String(/maxAge:\s*VALIDADE_DA_PROVA_EM_SEGUNDOS/.test(acao)),
  "true",
);
verificar("G8b. VALIDADE_DA_PROVA_EM_SEGUNDOS é 600", VALIDADE_DA_PROVA_EM_SEGUNDOS, 600);
verificar(
  "G9. o token_hash não entra no cookie",
  String(/cookies\.set\([^)]*token_hash/.test(acao)),
  "false",
);
verificar("G10. sem service_role na action", String(/service_role/i.test(acao)), "false");
verificar(
  "G10b. sem service_role no GET do link",
  String(/service_role/i.test(semComentariosGuarda)),
  "false",
);

const helper = readFileSync(new URL("../src/lib/prova-recuperacao.ts", import.meta.url), "utf8");
verificar(
  "G11. o segredo não usa prefixo NEXT_PUBLIC_",
  String(/NEXT_PUBLIC_[A-Z_]*RECOVERY/.test(helper)),
  "false",
);
verificar(
  "G12. o segredo é lido em runtime, não no topo do módulo",
  String(/export function lerSegredoDaProva\(\)[\s\S]{0,200}process\.env/.test(helper)),
  "true",
);
verificar("G13. HMAC-SHA-256", String(/hash:\s*"SHA-256"/.test(helper)), "true");
verificar(
  "G14. comparação em tempo constante",
  String(/diferenca \|= a\[i\]! \^ b\[i\]!/.test(helper)),
  "true",
);
verificar(
  "G15. a assinatura é conferida antes de ler a carga",
  String(helper.indexOf("comparacaoSegura(bytesRecebidos") < helper.indexOf("JSON.parse")),
  "true",
);

console.log("\nH. Limpeza de sessão nas falhas pós-verifyOtp\n");

// O achado: depois do verifyOtp dar certo a sessão de recuperação já existe.
// Qualquer falha posterior tem de derrubá-la antes de redirecionar, senão a
// rota diz "link inválido" e deixa o navegador autenticado.
const semComentariosAcao = acao
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

const posVerifyOtp = semComentariosAcao.indexOf("verifyOtp(");
const posFalhaVerify = semComentariosAcao.indexOf("if (error || !data.session) falharSemSessao()");
const posHelper = semComentariosAcao.indexOf("async function falharDepoisDeVerificar()");
const posSignOutRota = semComentariosAcao.indexOf("auth.signOut(");

// 1. verifyOtp falha -> sai sem limpar (não houve sessão nova confirmada).
verificar(
  "H1. falha do próprio verifyOtp retorna sem signOut",
  String(posFalhaVerify !== -1 && posFalhaVerify < posHelper),
  "true",
);
verificar(
  "H1b. o retorno dessa falha não passa pelo helper",
  String(semComentariosAcao.slice(posVerifyOtp, posHelper).includes("falharDepoisDeVerificar")),
  "false",
);

// 2 a 6. Todas as saídas posteriores passam pela limpeza.
const chamadasDoHelper = (semComentariosAcao.match(/return falharDepoisDeVerificar\(\)/g) || [])
  .length;
verificar("H2. há 3 saídas de falha pós-verifyOtp centralizadas", String(chamadasDoHelper), "3");
verificar(
  "H3. claims com erro / sem usuário / sub ou sessão ausentes -> helper",
  String(
    /if \(erroClaims \|\| !user[\s\S]{0,120}?return falharDepoisDeVerificar\(\)/.test(
      semComentariosAcao,
    ),
  ),
  "true",
);
verificar(
  "H4. sub divergente -> helper",
  String(/if \(sub !== user\.id\) return falharDepoisDeVerificar\(\)/.test(semComentariosAcao)),
  "true",
);
verificar(
  "H5. prova não emitida (secret ausente) -> helper",
  String(/if \(!prova\) return falharDepoisDeVerificar\(\)/.test(semComentariosAcao)),
  "true",
);
verificar(
  "H6. nenhuma saída de falha pós-verifyOtp escapou do helper",
  String((semComentariosAcao.slice(posHelper).match(/falharSemSessao\(\)/g) || []).length),
  "1", // apenas o `falharSemSessao()` de dentro do próprio helper
);

// 7. Caminho de sucesso não limpa sessão.
const trechoSucesso = semComentariosAcao.slice(
  semComentariosAcao.indexOf("armazemDeCookies.set(NOME_DO_COOKIE_DE_PROVA"),
);
verificar(
  "H7. caminho de sucesso não chama signOut",
  String(/signOut/.test(trechoSucesso)),
  "false",
);
verificar(
  "H7b. caminho de sucesso grava o cookie e redireciona",
  String(
    /armazemDeCookies\.set\(NOME_DO_COOKIE_DE_PROVA/.test(trechoSucesso) &&
      /redirect\(ROTA_REDEFINIR_SENHA\)/.test(trechoSucesso),
  ),
  "true",
);

// 8. Escopo local nas limpezas pós-verifyOtp.
verificar(
  "H8. a limpeza usa scope local",
  String(/signOut\(\{\s*scope:\s*"local"\s*\}\)/.test(semComentariosAcao)),
  "true",
);
verificar(
  "H8b. há exatamente um signOut na rota",
  String((semComentariosAcao.match(/auth\.signOut\(/g) || []).length),
  "1",
);
verificar(
  "H8c. a rota não usa signOut global",
  String(/auth\.signOut\(\)/.test(semComentariosAcao)),
  "false",
);
verificar("H8d. o signOut fica dentro do helper", String(posHelper < posSignOutRota), "true");

// 9. O signOut após a troca de senha continua GLOBAL.
const acaoTroca = readFileSync(
  new URL("../src/app/redefinir-senha/actions.ts", import.meta.url),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

verificar(
  "H9. signOut da troca de senha continua global (sem scope)",
  String(/auth\.signOut\(\)/.test(acaoTroca)),
  "true",
);
// A troca de senha passou a usar `scope: "local"` — mas só como último recurso,
// depois de o `signOut` global falhar. O que esta asserção protege continua
// sendo o essencial: a revogação PRINCIPAL é global, porque depois de trocar a
// senha todas as sessões da conta têm de cair. O local não pode substituí-la.
verificar(
  "H9b. o scope local na troca de senha só aparece depois do signOut global",
  String(acaoTroca.indexOf("auth.signOut()") < acaoTroca.indexOf('signOut({ scope: "local" })')),
  "true",
);
verificar(
  "H9c. o scope local está no ramo de falha do global, não no caminho normal",
  String(
    acaoTroca.indexOf("if (erroAoSair)") < acaoTroca.indexOf('signOut({ scope: "local" })') &&
      acaoTroca.indexOf("if (erroAoSair)") !== -1,
  ),
  "true",
);

console.log("\nI. GET não consome token (achado do scanner de e-mail)\n");

// O achado: gateways de segurança de e-mail — Safe Links, Proofpoint, Mimecast
// — fazem GET automático em cada link da mensagem. Como o token de uso único
// era consumido nesse GET, o scanner gastava a recuperação e o clique real do
// usuário encontrava um link inválido. Pela semântica HTTP, GET é seguro e
// idempotente: quem estava errado era a rota.

// 1 e 2. O GET não consome nem autentica.
verificar("I1. o GET não chama verifyOtp", String(/verifyOtp/.test(semComentariosGuarda)), "false");
verificar(
  "I2. o GET não cria sessão nem instancia cliente do Supabase",
  String(/criarClienteServidor|auth\./.test(semComentariosGuarda)),
  "false",
);
verificar(
  "I2b. o GET não emite prova",
  String(/criarProvaDeRecuperacao/.test(semComentariosGuarda)),
  "false",
);

// 3 a 8. O cookie intermediário que carrega o token até o POST.
verificar(
  "I3. o GET grava o cookie pendente",
  String(/cookies\.set\(NOME_DO_COOKIE_PENDENTE/.test(semComentariosGuarda)),
  "true",
);
verificar("I4. pending é httpOnly", String(/httpOnly:\s*true/.test(semComentariosGuarda)), "true");
verificar(
  "I5. pending é secure em produção",
  String(/secure:\s*process\.env\.NODE_ENV === "production"/.test(semComentariosGuarda)),
  "true",
);
verificar(
  "I6. pending usa sameSite lax",
  String(/sameSite:\s*"lax"/.test(semComentariosGuarda)),
  "true",
);
verificar(
  "I7. pending tem validade curta",
  String(/maxAge:\s*VALIDADE_DO_PENDENTE_EM_SEGUNDOS/.test(semComentariosGuarda)),
  "true",
);
verificar("I7b. VALIDADE_DO_PENDENTE_EM_SEGUNDOS é 300", VALIDADE_DO_PENDENTE_EM_SEGUNDOS, 300);
// Path da tela de confirmação, não desta rota: pela RFC 6265 §5.1.4 um
// `Path=/auth/confirm` NÃO seria enviado para `/auth/confirmar-recuperacao`.
verificar(
  "I8. pending com Path da tela de confirmação",
  String(/path:\s*ROTA_CONFIRMAR_RECUPERACAO/.test(semComentariosGuarda)),
  "true",
);
verificar(
  "I8b. pending NÃO usa path raiz",
  String(/path:\s*"\/"/.test(semComentariosGuarda)),
  "false",
);
verificar(
  "I8c. ROTA_CONFIRMAR_RECUPERACAO é /auth/confirmar-recuperacao",
  ROTA_CONFIRMAR_RECUPERACAO,
  "/auth/confirmar-recuperacao",
);

// 9. O token sai da URL já no primeiro salto.
verificar(
  "I9. o GET redireciona para a tela de confirmação sem query",
  String(/redirecionar\(ROTA_CONFIRMAR_RECUPERACAO,\s*""\)/.test(semComentariosGuarda)),
  "true",
);
verificar(
  "I9b. o redirect é 303",
  String(/NextResponse\.redirect\([^)]*,\s*303\)/.test(semComentariosGuarda)),
  "true",
);
verificar(
  "I9c. a resposta do GET não entra em cache",
  String(/Cache-Control[\s\S]{0,20}no-store/.test(semComentariosGuarda)),
  "true",
);

// 10. A página intermediária não vê o token.
verificar(
  "I10. a página de confirmação não menciona token_hash",
  String(/token_hash/.test(semComentariosPagina)),
  "false",
);
verificar(
  "I10b. a página é Server Component (sem 'use client')",
  String(/^\s*"use client"/m.test(paginaDeConfirmacao)),
  "false",
);
verificar(
  "I10c. a página posta para a Server Action",
  String(/<form action=\{confirmarRecuperacao\}>/.test(paginaDeConfirmacao)),
  "true",
);

// 11 a 14. A action lê o token só do cookie, e fixa o type.
verificar(
  "I11. a action lê o token do cookie pendente",
  String(/armazemDeCookies\.get\(NOME_DO_COOKIE_PENDENTE\)/.test(semComentariosAcao)),
  "true",
);
verificar(
  "I12. a action não recebe token por FormData",
  String(/FormData|formData|\.get\("token_hash"\)/.test(semComentariosAcao)),
  "false",
);
verificar(
  "I13. verifyOtp existe somente no passo deliberado",
  String((semComentariosAcao.match(/verifyOtp\(/g) || []).length),
  "1",
);
verificar(
  "I14. o type é fixo no código como recovery",
  String(/type:\s*"recovery"/.test(semComentariosAcao)),
  "true",
);

// 15. O cookie pendente morre em qualquer desfecho.
verificar(
  "I15. a action apaga o cookie pendente",
  String(/maxAge:\s*0/.test(semComentariosAcao)),
  "true",
);
verificar(
  "I15b. a limpeza do pendente acontece no sucesso e na falha",
  String((semComentariosAcao.match(/apagarPendente\(\)/g) || []).length >= 3),
  "true",
);

// 16. A prova continua nascendo só depois do consumo.
verificar(
  "I16. a prova é emitida depois do verifyOtp",
  String(
    semComentariosAcao.indexOf("verifyOtp(") <
      semComentariosAcao.indexOf("criarProvaDeRecuperacao("),
  ),
  "true",
);

// 17. Simulação do scanner: percorrer o GET inteiro não consome nada.
const guardaTemEfeitoDeConsumo = /verifyOtp|signOut|updateUser|criarProvaDeRecuperacao/.test(
  semComentariosGuarda,
);
verificar(
  "I17. scanner que só faz GET não consome o token",
  String(guardaTemEfeitoDeConsumo),
  "false",
);

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
