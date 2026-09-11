/**
 * Testes das decisões de recuperação de senha.
 *
 * COMO RODAR:
 *
 *   npm run test:recuperacao
 *
 * Mesmo formato do `testar-mfa.mjs`: sem framework, com o Node executando o
 * módulo TypeScript direto via `--experimental-strip-types`. Sai com código
 * diferente de zero em qualquer falha, para servir em CI.
 *
 * O que está coberto aqui são as decisões de SEGURANÇA do fluxo — que tipo de
 * token é aceito, para onde o navegador é mandado, o que a tela revela sobre a
 * existência de uma conta. O caminho feliz depende do Supabase e é verificado
 * manualmente contra a produção.
 */

import { readFileSync } from "node:fs";

import {
  BUSCA_LINK_INVALIDO,
  MENSAGEM_FALHA_AO_TROCAR,
  MENSAGEM_SENHAS_DIFERENTES,
  MENSAGEM_SENHA_FRACA,
  MENSAGEM_SENHA_REPETIDA,
  MENSAGEM_SENHA_VAZIA,
  MENSAGEM_SOLICITACAO_ENVIADA,
  ROTA_ESQUECI_SENHA,
  ROTA_REDEFINIR_SENHA,
  decidirAcessoRedefinicao,
  decidirConfirmacao,
  decidirRespostaDaSolicitacao,
  montarDestinoConfirmacao,
  normalizarAmr,
  traduzirErroDeSenha,
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

console.log("\nA. decidirConfirmacao — só type=recovery entra\n");

verificar(
  "A1. type=recovery com token -> verifica",
  decidirConfirmacao({ tokenHash: "abc123", type: "recovery" }),
  "verificar",
);
verificar(
  "A2. type=signup -> recusa",
  decidirConfirmacao({ tokenHash: "abc123", type: "signup" }),
  "recusar",
);
verificar(
  "A3. type=invite -> recusa",
  decidirConfirmacao({ tokenHash: "abc123", type: "invite" }),
  "recusar",
);
verificar(
  "A4. type=magiclink -> recusa",
  decidirConfirmacao({ tokenHash: "abc123", type: "magiclink" }),
  "recusar",
);
verificar(
  "A5. type=email_change -> recusa",
  decidirConfirmacao({ tokenHash: "abc123", type: "email_change" }),
  "recusar",
);
verificar(
  "A6. type ausente -> recusa",
  decidirConfirmacao({ tokenHash: "abc123", type: null }),
  "recusar",
);
verificar(
  "A7. type com caixa diferente -> recusa (comparação estrita)",
  decidirConfirmacao({ tokenHash: "abc123", type: "Recovery" }),
  "recusar",
);

console.log("\nB. decidirConfirmacao — token ausente não passa\n");

verificar(
  "B1. token null -> recusa",
  decidirConfirmacao({ tokenHash: null, type: "recovery" }),
  "recusar",
);
verificar(
  "B2. token vazio -> recusa",
  decidirConfirmacao({ tokenHash: "", type: "recovery" }),
  "recusar",
);
verificar(
  "B3. token só de espaços -> recusa",
  decidirConfirmacao({ tokenHash: "   ", type: "recovery" }),
  "recusar",
);
verificar(
  "B4. token undefined -> recusa",
  decidirConfirmacao({ tokenHash: undefined, type: "recovery" }),
  "recusar",
);

console.log("\nC. montarDestinoConfirmacao — destino fixo, sem open redirect\n");

verificar(
  "C1. sucesso vai para /redefinir-senha",
  montarDestinoConfirmacao("ok").pathname,
  ROTA_REDEFINIR_SENHA,
);
verificar(
  "C2. sucesso limpa a query (tira token_hash e type da URL)",
  montarDestinoConfirmacao("ok").search,
  "",
);
verificar(
  "C3. falha vai para /esqueci-senha",
  montarDestinoConfirmacao("falha").pathname,
  ROTA_ESQUECI_SENHA,
);
verificar(
  "C4. falha sinaliza link inválido",
  montarDestinoConfirmacao("falha").search,
  BUSCA_LINK_INVALIDO,
);

// A função não recebe nada da requisição: não há parâmetro por onde injetar
// um destino. Estes dois casos travam isso como contrato.
verificar(
  "C5. destino de sucesso é relativo, nunca absoluto",
  String(montarDestinoConfirmacao("ok").pathname.startsWith("/")) +
    "/" +
    String(montarDestinoConfirmacao("ok").pathname.startsWith("//")),
  "true/false",
);
verificar(
  "C6. destino de falha é relativo, nunca absoluto",
  String(montarDestinoConfirmacao("falha").pathname.startsWith("/")) +
    "/" +
    String(montarDestinoConfirmacao("falha").pathname.startsWith("//")),
  "true/false",
);
verificar(
  "C7. nenhum destino aponta para outro host",
  String(
    [montarDestinoConfirmacao("ok"), montarDestinoConfirmacao("falha")].some((d) =>
      /^[a-z]+:|^\/\//i.test(d.pathname),
    ),
  ),
  "false",
);

console.log("\nD. validarNovaSenha — confirmação precisa bater\n");

verificar("D1. senhas iguais -> válida", validarNovaSenha("abc12345", "abc12345").valida, true);
verificar(
  "D2. senhas diferentes -> inválida",
  validarNovaSenha("abc12345", "abc12346").valida,
  false,
);
verificar(
  "D3. senhas diferentes -> mensagem própria",
  validarNovaSenha("abc12345", "abc12346").mensagem,
  MENSAGEM_SENHAS_DIFERENTES,
);
verificar("D4. senha vazia -> inválida", validarNovaSenha("", "").valida, false);
verificar(
  "D5. senha vazia -> mensagem própria",
  validarNovaSenha("", "").mensagem,
  MENSAGEM_SENHA_VAZIA,
);
verificar(
  "D6. diferença só de espaço em branco ainda é diferença",
  validarNovaSenha("abc12345", "abc12345 ").valida,
  false,
);

console.log("\nE. decidirRespostaDaSolicitacao — não revela se a conta existe\n");

verificar("E1. sem erro -> mensagem genérica", decidirRespostaDaSolicitacao(null), "generica");
verificar(
  "E2. 400 (e-mail malformado ou desconhecido) -> mesma mensagem genérica",
  decidirRespostaDaSolicitacao({ status: 400 }),
  "generica",
);
verificar(
  "E3. 422 -> mesma mensagem genérica",
  decidirRespostaDaSolicitacao({ status: 422 }),
  "generica",
);
verificar(
  "E4. erro sem status -> mesma mensagem genérica",
  decidirRespostaDaSolicitacao({}),
  "generica",
);
verificar(
  "E5. 429 (limite de envio) -> falha temporária",
  decidirRespostaDaSolicitacao({ status: 429 }),
  "falha-temporaria",
);
verificar(
  "E6. 500 -> falha temporária",
  decidirRespostaDaSolicitacao({ status: 500 }),
  "falha-temporaria",
);
verificar(
  "E7. 503 -> falha temporária",
  decidirRespostaDaSolicitacao({ status: 503 }),
  "falha-temporaria",
);

// A mensagem pública não pode conter termo que denuncie a conta.
const termosProibidos = [
  "não encontrado",
  "nao encontrado",
  "não existe",
  "nao existe",
  "não cadastrado",
  "nao cadastrado",
  "inválido",
  "user",
];
verificar(
  "E8. mensagem genérica não afirma nada sobre a conta",
  String(termosProibidos.some((t) => MENSAGEM_SOLICITACAO_ENVIADA.toLowerCase().includes(t))),
  "false",
);
verificar(
  "E9. mensagem genérica é condicional ('se existir')",
  String(MENSAGEM_SOLICITACAO_ENVIADA.toLowerCase().startsWith("se existir")),
  "true",
);

console.log("\nF. traduzirErroDeSenha — nenhuma mensagem crua do GoTrue\n");

verificar(
  "F1. weak_password -> texto próprio",
  traduzirErroDeSenha("weak_password"),
  MENSAGEM_SENHA_FRACA,
);
verificar(
  "F2. same_password -> texto próprio",
  traduzirErroDeSenha("same_password"),
  MENSAGEM_SENHA_REPETIDA,
);
verificar(
  "F3. código desconhecido -> genérico (fail-closed)",
  traduzirErroDeSenha("alguma_coisa_nova_do_gotrue"),
  MENSAGEM_FALHA_AO_TROCAR,
);
verificar(
  "F4. código ausente -> genérico",
  traduzirErroDeSenha(undefined),
  MENSAGEM_FALHA_AO_TROCAR,
);
verificar("F5. código null -> genérico", traduzirErroDeSenha(null), MENSAGEM_FALHA_AO_TROCAR);

console.log("\nH. decidirAcessoRedefinicao — só sessão de recuperação abre o formulário\n");

// O caso que motivou esta verificação existir: sessão comum de login.
verificar(
  "H1. sessão de signInWithPassword (amr=password) -> NEGA",
  decidirAcessoRedefinicao({
    temUsuario: true,
    amr: [{ method: "password", timestamp: 1715766000 }],
  }),
  "negar",
);
verificar(
  "H2. sessão de login com MFA (amr=password+totp) -> NEGA",
  decidirAcessoRedefinicao({
    temUsuario: true,
    amr: [
      { method: "password", timestamp: 1715766000 },
      { method: "totp", timestamp: 1715766100 },
    ],
  }),
  "negar",
);
verificar(
  "H3. sessão de recuperação (amr=recovery) -> PERMITE",
  decidirAcessoRedefinicao({
    temUsuario: true,
    amr: [{ method: "recovery", timestamp: 1715766000 }],
  }),
  "permitir",
);
verificar(
  "H4. sem sessão -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: false, amr: [{ method: "recovery", timestamp: 1 }] }),
  "negar",
);
verificar(
  "H5. sem AMR -> NEGA (falha fechada)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: undefined }),
  "negar",
);
verificar(
  "H6. AMR vazio -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: true, amr: [] }),
  "negar",
);

// Allowlist de um item: nenhum outro método é tratado como equivalente a
// recovery, nem os que "parecem" vir de link de e-mail.
for (const metodo of [
  "otp",
  "magiclink",
  "email",
  "invite",
  "signup",
  "oauth",
  "sso/saml",
  "anonymous",
  "web3",
  "token_refresh",
  "metodo_que_ainda_nao_existe",
]) {
  verificar(
    `H7.${metodo} sozinho -> NEGA`,
    decidirAcessoRedefinicao({ temUsuario: true, amr: [{ method: metodo, timestamp: 1 }] }),
    "negar",
  );
}

verificar(
  "H8. token_refresh sem recovery -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["token_refresh"] }),
  "negar",
);
verificar(
  "H9. recovery acompanhado de outro método -> PERMITE (exigência é presença)",
  decidirAcessoRedefinicao({
    temUsuario: true,
    amr: [
      { method: "recovery", timestamp: 1 },
      { method: "otp", timestamp: 2 },
    ],
  }),
  "permitir",
);

// Formato RFC-8176 (string[]) precisa valer tanto quanto AMREntry[].
verificar(
  "H10. formato string[] com password -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["password"] }),
  "negar",
);
verificar(
  "H11. formato string[] com recovery -> PERMITE",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["recovery"] }),
  "permitir",
);
// Caso analisado, não acidental: recovery presente junto de password.
//
// Só se põe `recovery` no AMR quem consumiu um token válido enviado ao e-mail
// da conta. Quem fez isso provou posse da caixa de entrada, que é exatamente a
// credencial que o fluxo exige — a presença adicional de `password` não retira
// essa prova. O ataque que o guard fecha é a sessão comum SEM recovery, e essa
// continua negada (H1, H2, H10).
verificar(
  "H12. formato misto com recovery + password -> PERMITE (recovery foi provado)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["recovery", { method: "password" }] }),
  "permitir",
);
verificar(
  "H12b. formato misto SEM recovery -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["otp", { method: "password" }] }),
  "negar",
);

// Caixa e espaço: a normalização tolera variação de formatação do claim
// assinado, e não pode virar brecha. Comportamento definido e travado aqui.
verificar(
  "H13. ' recovery ' com espaços -> PERMITE (normalização apara)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: [" recovery "] }),
  "permitir",
);
verificar(
  "H14. 'RECOVERY' em caixa alta -> PERMITE (normalização baixa a caixa)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["RECOVERY"] }),
  "permitir",
);
verificar(
  "H14b. 'PASSWORD' em caixa alta -> NEGA (caixa não cria permissividade)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["PASSWORD"] }),
  "negar",
);
verificar(
  "H14c. 'recovery_extra' não é recovery -> NEGA (igualdade, não prefixo)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["recovery_extra"] }),
  "negar",
);
verificar(
  "H14d. 'xrecovery' não é recovery -> NEGA (igualdade, não substring)",
  decidirAcessoRedefinicao({ temUsuario: true, amr: ["xrecovery"] }),
  "negar",
);
verificar(
  "H15. amr não-array (objeto solto) -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: true, amr: { method: "recovery" } }),
  "negar",
);
verificar(
  "H16. amr com entradas inúteis -> NEGA",
  decidirAcessoRedefinicao({ temUsuario: true, amr: [null, 42, {}] }),
  "negar",
);

console.log("\nH-b. normalizarAmr — os dois formatos do claim\n");

verificar(
  "H17. AMREntry[] vira lista de métodos",
  normalizarAmr([
    { method: "password", timestamp: 1 },
    { method: "totp", timestamp: 2 },
  ]).join(","),
  "password,totp",
);
verificar(
  "H18. string[] passa direto",
  normalizarAmr(["password", "totp"]).join(","),
  "password,totp",
);
verificar("H19. entrada inválida vira lista vazia", normalizarAmr("password").length, 0);

console.log("\nG. Garantias estruturais — lidas do próprio código-fonte\n");

// Estas não são funções puras: são invariantes do fluxo que só existem no
// arquivo. Verificar por leitura do fonte é grosseiro, mas pega exatamente a
// regressão que importa — alguém remover o signOut, ou o fluxo de senha passar
// a mexer em MFA numa refatoração futura.
const formulario = readFileSync(
  new URL("../src/app/redefinir-senha/formulario-nova-senha.tsx", import.meta.url),
  "utf8",
);
const rota = readFileSync(new URL("../src/app/auth/confirm/route.ts", import.meta.url), "utf8");
const solicitacao = readFileSync(
  new URL("../src/app/esqueci-senha/page.tsx", import.meta.url),
  "utf8",
);

const posSignOut = formulario.indexOf("auth.signOut()");
const posUpdate = formulario.indexOf("auth.updateUser(");
const posReplace = formulario.indexOf("router.replace(");

verificar("G1. o formulário chama signOut", String(posSignOut !== -1), "true");
verificar("G2. signOut vem depois do updateUser", String(posUpdate < posSignOut), "true");
verificar("G3. signOut vem antes de voltar ao login", String(posSignOut < posReplace), "true");

/**
 * Remove comentários antes de procurar por padrões proibidos.
 *
 * Sem isto os testes acusavam os próprios comentários que explicam por que o
 * código NÃO faz aquelas coisas — "nada de MFA é tocado", "nunca error.message".
 * A invariante é sobre o código executado, não sobre a prosa em volta dele.
 *
 * Só remove bloco `/* *\/` e linha iniciada por `//`, para não estragar `://`
 * dentro de string.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("//"))
    .join("\n");
}

const arquivosDoFluxo = {
  formulario: semComentarios(formulario),
  rota: semComentarios(rota),
  solicitacao: semComentarios(solicitacao),
};
for (const [nome, fonte] of Object.entries(arquivosDoFluxo)) {
  verificar(
    `G4.${nome} não toca em MFA`,
    String(/\bmfa\b|unenroll|enroll\(|challengeAndVerify|listFactors/i.test(fonte)),
    "false",
  );
  verificar(
    `G5.${nome} não expõe error.message ao usuário`,
    String(/error\.message|erro\.message/.test(fonte)),
    "false",
  );
  verificar(
    `G6.${nome} não usa service_role`,
    String(/service_role|SERVICE_ROLE/.test(fonte)),
    "false",
  );
  verificar(`G7.${nome} não faz signUp`, String(/signUp\(/.test(fonte)), "false");
}

// A rota de confirmação não pode ler destino da requisição.
verificar(
  "G8. /auth/confirm não lê 'next' nem 'redirect_to' da query",
  String(/searchParams\.get\(\s*["'](next|redirect_to|redirectTo)["']/.test(rota)),
  "false",
);
verificar(
  "G9. /auth/confirm só lê token_hash e type",
  rota
    .match(/searchParams\.get\(\s*["']([^"']+)["']/g)
    .map((m) => m.replace(/.*["']([^"']+)["'].*/, "$1"))
    .sort()
    .join(","),
  "token_hash,type",
);
verificar(
  "G10. resetPasswordForEmail é chamado sem redirectTo",
  String(/resetPasswordForEmail\([^)]*redirectTo/.test(solicitacao)),
  "false",
);

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
