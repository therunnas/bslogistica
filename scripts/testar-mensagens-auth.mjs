/**
 * Regressão dos defeitos do CP-01 (QA-BS-01) — autenticação e administração de usuários.
 *
 * COMO RODAR:
 *
 *   npm run test:mensagens-auth
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha.
 *
 * Cada bloco corresponde a um defeito reproduzido no E2E local (e2e/specs/40-autenticacao.spec.ts)
 * antes da correção:
 *
 *   A. login mostrava "Invalid login credentials" / "User is banned" (texto cru do GoTrue);
 *   B. código TOTP errado mostrava "Invalid TOTP code entered" no /mfa e na ativação;
 *   C. duplo clique em "Enviar convite" enviava dois convites; "Atribuir" executava duas vezes;
 *   D. convite para e-mail já cadastrado mostrava "A user with this email address has already been
 *      registered";
 *   E. duplo clique em "Continuar" (recuperação) gastava o token no 1º envio e o 2º mandava o
 *      próprio usuário para "link inválido";
 *   F. botões só de ícone (gerenciar usuário, remover operação) sem nome acessível.
 *
 * O comportamento ponta a ponta é provado no E2E; aqui ficam a função pura e a forma literal do
 * código, para a regressão ser pega antes do E2E.
 */

import { readFileSync } from "node:fs";

import {
  MENSAGEM_LOGIN_EMAIL_NAO_CONFIRMADO,
  MENSAGEM_LOGIN_FALHA,
  MENSAGEM_LOGIN_MUITAS_TENTATIVAS,
  MENSAGEM_LOGIN_RECUSADO,
  mensagemDeErroDeLogin,
} from "../src/lib/mensagens-de-login.ts";
import { criarTrava } from "../src/app/(painel)/usuarios/_trava.ts";
import { ErroAdministrativo } from "../src/lib/admin-usuarios/cliente.ts";
import {
  MENSAGEM_CONVITE_EMAIL_EXISTENTE,
  MENSAGEM_CONVITE_FALHA,
  MENSAGEM_CONVITE_LIMITE_DE_ENVIO,
  mensagemDeFalhaDoConvite,
} from "../src/lib/admin-usuarios/servico.ts";

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

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CRU = /invalid|credentials|banned|already|registered|code entered|expired|not found|failed/i;

// ---------------------------------------------------------------------------------------------
// A. Login
// ---------------------------------------------------------------------------------------------

verificar(
  "A1. senha errada (invalid_credentials) vira o texto em português",
  mensagemDeErroDeLogin({ code: "invalid_credentials", status: 400 }),
  MENSAGEM_LOGIN_RECUSADO,
);
verificar(
  "A2. conta revogada (user_banned) recebe o MESMO texto — o GoTrue confere o ban antes da senha",
  mensagemDeErroDeLogin({ code: "user_banned", status: 400 }),
  MENSAGEM_LOGIN_RECUSADO,
);
verificar(
  "A3. e-mail não confirmado tem texto próprio",
  mensagemDeErroDeLogin({ code: "email_not_confirmed" }),
  MENSAGEM_LOGIN_EMAIL_NAO_CONFIRMADO,
);
verificar(
  "A4. limite de tentativas (código ou 429) tem texto próprio",
  [
    mensagemDeErroDeLogin({ code: "over_request_rate_limit" }),
    mensagemDeErroDeLogin({ status: 429 }),
  ].join(" | "),
  `${MENSAGEM_LOGIN_MUITAS_TENTATIVAS} | ${MENSAGEM_LOGIN_MUITAS_TENTATIVAS}`,
);
verificar(
  "A5. erro desconhecido ou de rede cai no texto genérico, nunca no cru",
  [
    mensagemDeErroDeLogin({}),
    mensagemDeErroDeLogin({ code: "unexpected_failure", status: 500 }),
  ].join(" | "),
  `${MENSAGEM_LOGIN_FALHA} | ${MENSAGEM_LOGIN_FALHA}`,
);
verificar(
  "A6. nenhum texto de login contém palavra do provedor em inglês",
  [
    MENSAGEM_LOGIN_RECUSADO,
    MENSAGEM_LOGIN_EMAIL_NAO_CONFIRMADO,
    MENSAGEM_LOGIN_MUITAS_TENTATIVAS,
    MENSAGEM_LOGIN_FALHA,
  ].some((t) => CRU.test(t)),
  false,
);

const login = semComentarios(ler("src/app/login/page.tsx"));
verificar(
  "A7. a tela de login traduz o erro por mensagemDeErroDeLogin",
  /toast\.error\(mensagemDeErroDeLogin\(error\)\)/.test(login),
  true,
);
verificar("A8. a tela de login não exibe error.message", /error\.message/.test(login), false);

// ---------------------------------------------------------------------------------------------
// B. Código TOTP inválido
// ---------------------------------------------------------------------------------------------

const mfa = semComentarios(ler("src/app/mfa/painel-mfa.tsx"));
const config = semComentarios(ler("src/app/(painel)/configuracoes/painel-configuracoes.tsx"));
verificar(
  "B1. o desafio do /mfa traduz o código recusado",
  /challengeAndVerify[\s\S]{0,200}if \(error\) \{\s*toast\.error\(mensagemDeCodigoInvalido\(error\)\);/.test(
    mfa,
  ),
  true,
);
verificar(
  "B2. o /mfa não exibe error.message do challengeAndVerify",
  /toast\.error\(error\.message\)/.test(mfa),
  false,
);
verificar(
  "B3. a ativação em Configurações traduz o código recusado",
  /if \(error\) \{\s*toast\.error\(mensagemDeCodigoInvalido\(error\)\);\s*setCodigo\(""\);\s*setEnviando\(false\);/.test(
    config,
  ),
  true,
);
verificar(
  "B4. Configurações não exibe error.message do challengeAndVerify da ativação",
  /toast\.error\(error\.message\)/.test(config),
  false,
);

// ---------------------------------------------------------------------------------------------
// C. Ações duplicadas na administração de usuários
// ---------------------------------------------------------------------------------------------

const trava = criarTrava();
verificar(
  "C1. a trava aceita a primeira ação e recusa a segunda até liberar",
  [trava.tentar(), trava.tentar(), (trava.liberar(), trava.tentar())].join(","),
  "true,false,true",
);

const painel = semComentarios(ler("src/app/(painel)/usuarios/painel-usuarios.tsx"));
const gerenciar = semComentarios(ler("src/app/(painel)/usuarios/gerenciar-usuario.tsx"));

verificar(
  "C2. enviar convite passa pela trava e a libera no onSettled",
  /if \(!trava\.tentar\(\)\) return;\s*convidar\.mutate\([\s\S]{0,120}onSettled: trava\.liberar,/.test(
    painel,
  ),
  true,
);
verificar(
  "C3. o botão de convite continua desabilitado durante o envio (segunda barreira)",
  /disabled=\{!convite\.email \|\| convidar\.isPending\}/.test(painel),
  true,
);

const mutacoes = [...gerenciar.matchAll(/(\w+)\.mutate\(/g)].map((m) => m[1]);
const travadas = [
  ...gerenciar.matchAll(
    /if \(!trava\.tentar\(\)\) return;\s*(\w+)\.mutate\([\s\S]{0,140}?onSettled: trava\.liberar,/g,
  ),
].map((m) => m[1]);
verificar(
  "C4. toda mutation do diálogo de usuário passa pela trava e a libera",
  `${mutacoes.length}:${travadas.join(",")}`,
  `6:${mutacoes.join(",")}`,
);

// ---------------------------------------------------------------------------------------------
// D. Falha do convite
// ---------------------------------------------------------------------------------------------

const doAuth = (code, message) => new ErroAdministrativo({ code, message }, "convidar usuário");
verificar(
  "D1. e-mail já cadastrado vira texto em português com o caminho certo",
  mensagemDeFalhaDoConvite(
    doAuth("email_exists", "A user with this email address has already been registered"),
  ),
  MENSAGEM_CONVITE_EMAIL_EXISTENTE,
);
verificar(
  "D2. limite de envio de e-mail tem texto próprio",
  mensagemDeFalhaDoConvite(doAuth("over_email_send_rate_limit", "email rate limit exceeded")),
  MENSAGEM_CONVITE_LIMITE_DE_ENVIO,
);
verificar(
  "D3. qualquer outro erro do provedor cai no genérico, nunca no cru",
  mensagemDeFalhaDoConvite(doAuth("unexpected_failure", "Database error saving new user")),
  MENSAGEM_CONVITE_FALHA,
);
verificar(
  "D4. erro do próprio módulo (já em português) é preservado",
  mensagemDeFalhaDoConvite(new Error("O convite não devolveu o usuário criado.")),
  "O convite não devolveu o usuário criado.",
);
verificar(
  "D5. nenhum texto de convite contém palavra do provedor em inglês",
  [MENSAGEM_CONVITE_EMAIL_EXISTENTE, MENSAGEM_CONVITE_LIMITE_DE_ENVIO, MENSAGEM_CONVITE_FALHA].some(
    (t) => CRU.test(t),
  ),
  false,
);

// ---------------------------------------------------------------------------------------------
// E. Confirmação da recuperação com envio único
// ---------------------------------------------------------------------------------------------

const paginaConfirmar = ler("src/app/auth/confirmar-recuperacao/page.tsx");
const botaoConfirmar = semComentarios(
  ler("src/app/auth/confirmar-recuperacao/botao-confirmar.tsx"),
);
verificar(
  "E1. a página continua postando para a Server Action, agora pelo botão de envio único",
  /<form action=\{confirmarRecuperacao\}>\s*<BotaoConfirmarRecuperacao \/>\s*<\/form>/.test(
    paginaConfirmar,
  ),
  true,
);
verificar(
  "E2. o segundo clique é barrado por trava síncrona (ref) antes do envio",
  /if \(enviado\.current\) \{\s*evento\.preventDefault\(\);\s*return;\s*\}\s*enviado\.current = true;/.test(
    botaoConfirmar,
  ),
  true,
);
verificar(
  "E3. o botão fica desabilitado enquanto o envio está pendente",
  /disabled=\{pending\}/.test(botaoConfirmar) && /useFormStatus\(\)/.test(botaoConfirmar),
  true,
);
verificar(
  "E4. o botão não lida com o token (fica só no cookie httpOnly)",
  /token/i.test(botaoConfirmar),
  false,
);

// ---------------------------------------------------------------------------------------------
// F. Nome acessível dos botões de ícone
// ---------------------------------------------------------------------------------------------

verificar(
  "F1. o botão de engrenagem da lista tem nome acessível",
  /aria-label=\{`Gerenciar \$\{usuario\.email \?\? "usuário"\}`\}/.test(painel),
  true,
);
verificar(
  "F2. o botão de lixeira das operações tem nome acessível",
  /aria-label="Remover operação"/.test(gerenciar),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
