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
  decidirConfirmacao,
  decidirRespostaDaSolicitacao,
  montarDestinoConfirmacao,
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
// E4 foi invertido depois da revisão do PR #13 (Codex, P2). Erro sem status
// HTTP significa que não houve resposta: offline, DNS, CORS, transporte
// interrompido. A requisição pode nem ter chegado ao Supabase, e mostrar a
// mensagem de "você receberá as instruções" seria mentira. Como o servidor não
// respondeu, também não há o que vazar sobre a conta.
verificar(
  "E4. erro sem status -> falha temporária (não houve resposta HTTP)",
  decidirRespostaDaSolicitacao({}),
  "falha-temporaria",
);
verificar(
  "E4b. status undefined -> falha temporária",
  decidirRespostaDaSolicitacao({ status: undefined }),
  "falha-temporaria",
);
verificar(
  "E4c. status 0 -> falha temporária (AuthRetryableFetchError)",
  decidirRespostaDaSolicitacao({ status: 0 }),
  "falha-temporaria",
);
verificar(
  "E4d. status negativo -> falha temporária",
  decidirRespostaDaSolicitacao({ status: -1 }),
  "falha-temporaria",
);
verificar(
  "E4e. status não-numérico -> falha temporária",
  decidirRespostaDaSolicitacao({ status: "400" }),
  "falha-temporaria",
);
// E5, E6 e E7 foram invertidos depois do segundo achado do Codex no PR #13.
//
// O /recover mascara conta inexistente com sucesso, mas conta EXISTENTE entra
// no caminho de envio — e é lá que surgem o cooldown por usuário (429) e a
// falha de SMTP (5xx). Esses status só acontecem para quem tem conta, então
// dar a eles um texto diferente transformaria a tela num oráculo: bastaria
// reenviar o mesmo endereço e observar se a mensagem muda.
verificar(
  "E5. 429 (cooldown por usuário) -> genérica, senão vira oráculo",
  decidirRespostaDaSolicitacao({ status: 429 }),
  "generica",
);
verificar(
  "E6. 500 (falha de SMTP só ocorre com conta existente) -> genérica",
  decidirRespostaDaSolicitacao({ status: 500 }),
  "generica",
);
verificar("E7. 503 -> genérica", decidirRespostaDaSolicitacao({ status: 503 }), "generica");
verificar("E7b. 401 -> genérica", decidirRespostaDaSolicitacao({ status: 401 }), "generica");
verificar("E7c. 404 -> genérica", decidirRespostaDaSolicitacao({ status: 404 }), "generica");
// A fronteira única: só ausência de resposta HTTP escapa do genérico.
verificar(
  "E7d. qualquer status positivo -> genérica",
  [200, 301, 400, 418, 429, 500, 502, 503, 599]
    .map((s) => decidirRespostaDaSolicitacao({ status: s }))
    .every((r) => r === "generica")
    .toString(),
  "true",
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
