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

import { ROTA_REDEFINIR_SENHA, decidirAcessoRedefinicao } from "../src/lib/recuperacao-senha.ts";

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
const rota = readFileSync(new URL("../src/app/auth/confirm/route.ts", import.meta.url), "utf8");

// A prova só pode nascer depois do verifyOtp dar certo.
const posVerify = rota.indexOf("verifyOtp(");
const posFalha = rota.indexOf('if (error || !data.session) return responder("falha")');
const posCriar = rota.indexOf("criarProvaDeRecuperacao(");
const posCookie = rota.indexOf("resposta.cookies.set(");

verificar("G1. a rota chama verifyOtp", String(posVerify !== -1), "true");
verificar(
  "G2. falha do verifyOtp corta antes de criar a prova",
  String(posFalha < posCriar),
  "true",
);
verificar("G3. a prova é criada depois do verifyOtp", String(posVerify < posCriar), "true");
verificar("G4. o cookie é gravado depois da prova", String(posCriar < posCookie), "true");
verificar("G5. cookie httpOnly", String(/httpOnly:\s*true/.test(rota)), "true");
// `lax` e não `strict`: o fluxo chega de um link de e-mail, e `strict` pode
// impedir o envio do cookie na requisição seguinte ao redirect.
verificar("G6. cookie sameSite lax", String(/sameSite:\s*"lax"/.test(rota)), "true");
verificar(
  "G6b. cookie NÃO usa sameSite strict",
  String(/sameSite:\s*"strict"/.test(rota)),
  "false",
);
// Path restrito: só a rota que lê a prova recebe o cookie.
verificar(
  "G6c. cookie com Path da rota de redefinição",
  String(/path:\s*ROTA_REDEFINIR_SENHA/.test(rota)),
  "true",
);
verificar("G6d. cookie NÃO usa path raiz", String(/path:\s*"\/"/.test(rota)), "false");
verificar("G6e. ROTA_REDEFINIR_SENHA é /redefinir-senha", ROTA_REDEFINIR_SENHA, "/redefinir-senha");
verificar(
  "G7. cookie secure em produção",
  String(/secure:\s*process\.env\.NODE_ENV === "production"/.test(rota)),
  "true",
);
verificar(
  "G8. maxAge de 10 minutos",
  String(/maxAge:\s*VALIDADE_DA_PROVA_EM_SEGUNDOS/.test(rota)),
  "true",
);
verificar("G8b. VALIDADE_DA_PROVA_EM_SEGUNDOS é 600", VALIDADE_DA_PROVA_EM_SEGUNDOS, 600);
verificar(
  "G9. o token_hash não entra no cookie",
  String(/cookies\.set\([^)]*token_hash/.test(rota)),
  "false",
);
verificar("G10. sem service_role na rota", String(/service_role/i.test(rota)), "false");

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
const semComentariosRota = rota
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

const posVerifyOtp = semComentariosRota.indexOf("verifyOtp(");
const posFalhaVerify = semComentariosRota.indexOf("if (error || !data.session) return responder(");
const posHelper = semComentariosRota.indexOf("async function falharDepoisDeVerificar()");
const posSignOutRota = semComentariosRota.indexOf("auth.signOut(");

// 1. verifyOtp falha -> sai sem limpar (não houve sessão nova confirmada).
verificar(
  "H1. falha do próprio verifyOtp retorna sem signOut",
  String(posFalhaVerify !== -1 && posFalhaVerify < posHelper),
  "true",
);
verificar(
  "H1b. o retorno dessa falha não passa pelo helper",
  String(semComentariosRota.slice(posVerifyOtp, posHelper).includes("falharDepoisDeVerificar")),
  "false",
);

// 2 a 6. Todas as saídas posteriores passam pela limpeza.
const chamadasDoHelper = (semComentariosRota.match(/return falharDepoisDeVerificar\(\)/g) || [])
  .length;
verificar("H2. há 3 saídas de falha pós-verifyOtp centralizadas", String(chamadasDoHelper), "3");
verificar(
  "H3. claims com erro / sem usuário / sub ou sessão ausentes -> helper",
  String(
    /if \(erroClaims \|\| !user[\s\S]{0,120}?return falharDepoisDeVerificar\(\)/.test(
      semComentariosRota,
    ),
  ),
  "true",
);
verificar(
  "H4. sub divergente -> helper",
  String(/if \(sub !== user\.id\) return falharDepoisDeVerificar\(\)/.test(semComentariosRota)),
  "true",
);
verificar(
  "H5. prova não emitida (secret ausente) -> helper",
  String(/if \(!prova\) return falharDepoisDeVerificar\(\)/.test(semComentariosRota)),
  "true",
);
verificar(
  "H6. nenhuma saída de falha pós-verifyOtp escapou do helper",
  String((semComentariosRota.slice(posHelper).match(/return responder\("falha"\)/g) || []).length),
  "1", // apenas o `return responder("falha")` de dentro do próprio helper
);

// 7. Caminho de sucesso não limpa sessão.
const trechoSucesso = semComentariosRota.slice(semComentariosRota.indexOf("const resposta ="));
verificar(
  "H7. caminho de sucesso não chama signOut",
  String(/signOut/.test(trechoSucesso)),
  "false",
);
verificar(
  "H7b. caminho de sucesso grava o cookie e redireciona",
  String(/resposta\.cookies\.set\(/.test(trechoSucesso) && /return resposta/.test(trechoSucesso)),
  "true",
);

// 8. Escopo local nas limpezas pós-verifyOtp.
verificar(
  "H8. a limpeza usa scope local",
  String(/signOut\(\{\s*scope:\s*"local"\s*\}\)/.test(semComentariosRota)),
  "true",
);
verificar(
  "H8b. há exatamente um signOut na rota",
  String((semComentariosRota.match(/auth\.signOut\(/g) || []).length),
  "1",
);
verificar(
  "H8c. a rota não usa signOut global",
  String(/auth\.signOut\(\)/.test(semComentariosRota)),
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
verificar(
  "H9b. a troca de senha não usa scope local",
  String(/signOut\(\{\s*scope:\s*"local"/.test(acaoTroca)),
  "false",
);

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
