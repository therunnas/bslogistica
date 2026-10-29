/**
 * Reversão do motor por vigência (RB-01): desligar pela interface, com o JWT real da sessão.
 *
 * COMO RODAR:  npm run test:reversao-motor
 *
 * Sem rede nem banco: um cliente de RPC simulado registra cada chamada. O banco real (estado,
 * gatilhos, travas, trilha, MFA e papéis) é da suíte SQL `supabase/tests/031_reversao_do_motor.sql`.
 *
 *   A  validação da entrada (motivo e frase DESLIGAR MOTOR)
 *   B  só desliga com o motor comprovadamente LIGADO; estado desconhecido recusa
 *   C  a RPC oficial: p_ativar=false, nunca aceita pendência, erros mapeados
 *   D  confirmação pelo estado depois de desligar; resposta duvidosa não vira sucesso
 *   E  chamada duplicada
 *   F  trava de servidor própria (BS_REVERSAO_MOTOR_HABILITADA) e ordem da Server Action
 *   G  interface: só no ramo "ligado", sem efeito ao carregar, ativação preservada
 */

import { readFileSync } from "node:fs";

import {
  FRASE_DE_CONFIRMACAO,
  FRASE_DE_REVERSAO,
  MOTIVO_MINIMO,
  VARIAVEL_DE_ATIVACAO,
  VARIAVEL_DE_REVERSAO,
  desligarMotorDeVigencia,
  ligarMotorDeVigencia,
  reversaoHabilitada,
  validarEntradaDeReversao,
} from "../src/lib/ativacao-motor.ts";

let passou = 0;
const falhas = [];
function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MOTIVO = "Reversão lógica autorizada após falha na validação da operação";
const ENTRADA = { motivo: MOTIVO, confirmacao: FRASE_DE_REVERSAO };
const LIGADO = { data: { ativo: true, consistente: true, ativada_em: "2026-10-29" }, error: null };
const DESLIGADO = { data: { ativo: false, consistente: true }, error: null };

/** Cliente simulado. `estados` é a sequência de respostas de estado_motor_vigencia. */
function cliente({ estados, alterar }) {
  const chamadas = [];
  let i = 0;
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push({ nome, args });
      if (nome === "estado_motor_vigencia") return estados[Math.min(i++, estados.length - 1)];
      if (nome === "alterar_motor_vigencia") return alterar;
      return { data: null, error: { code: "PGRST202", message: "inesperada" } };
    },
  };
}
const alterou = (c) => c.chamadas.filter((x) => x.nome === "alterar_motor_vigencia");

console.log("\nA. Entrada\n");
verificar(
  "A1. a frase é DESLIGAR MOTOR (e não a da ativação)",
  [FRASE_DE_REVERSAO, FRASE_DE_REVERSAO === FRASE_DE_CONFIRMACAO],
  ["DESLIGAR MOTOR", false],
);
verificar("A2. entrada válida", validarEntradaDeReversao(ENTRADA).ok, true);
verificar(
  "A3. a frase da ativação NÃO serve para desligar",
  validarEntradaDeReversao({ motivo: MOTIVO, confirmacao: FRASE_DE_CONFIRMACAO }).ok,
  false,
);
verificar(
  "A4. frase em minúsculas ou com texto a mais é recusada",
  [
    validarEntradaDeReversao({ motivo: MOTIVO, confirmacao: "desligar motor" }).ok,
    validarEntradaDeReversao({ motivo: MOTIVO, confirmacao: "DESLIGAR MOTOR agora" }).ok,
  ],
  [false, false],
);
verificar(
  "A5. motivo curto, vazio ou só espaços é recusado",
  ["", "   ", "x".repeat(MOTIVO_MINIMO - 1)].map(
    (m) => validarEntradaDeReversao({ motivo: m, confirmacao: FRASE_DE_REVERSAO }).ok,
  ),
  [false, false, false],
);
verificar(
  "A6. motivo acima do máximo é recusado",
  validarEntradaDeReversao({ motivo: "x".repeat(1001), confirmacao: FRASE_DE_REVERSAO }).ok,
  false,
);
verificar(
  "A7. entrada que não é objeto, nula ou com tipo errado é recusada",
  [null, "x", [], { motivo: 1, confirmacao: 2 }, undefined].map(
    (e) => validarEntradaDeReversao(e).ok,
  ),
  [false, false, false, false, false],
);

console.log("\nB. Só desliga com o motor comprovadamente ligado\n");
{
  const c = cliente({
    estados: [LIGADO, DESLIGADO],
    alterar: { data: { ativo: false, sincronizacao: { data: "2026-10-29" } }, error: null },
  });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar("B1. ligado → desliga (ok)", r.ok, true);
  verificar(
    "B2. ordem das chamadas: estado, alterar, estado",
    c.chamadas.map((x) => x.nome),
    ["estado_motor_vigencia", "alterar_motor_vigencia", "estado_motor_vigencia"],
  );
}
{
  const c = cliente({ estados: [DESLIGADO], alterar: { data: { ativo: false }, error: null } });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(
    "B3. já desligado: recusa 'ja-desligado' e NÃO chama a RPC de alteração",
    [r.ok, r.codigo, alterou(c).length],
    [false, "ja-desligado", 0],
  );
}
for (const [nome, estado] of [
  ["erro de leitura", { data: null, error: { code: "XX000" } }],
  ["resposta nula", { data: null, error: null }],
  ["resposta em lista", { data: [{ ativo: true, consistente: true }], error: null }],
  ["ativo não booleano", { data: { ativo: "true", consistente: true }, error: null }],
  ["inconsistente (gatilhos)", { data: { ativo: true, consistente: false }, error: null }],
  ["consistente ausente", { data: { ativo: true }, error: null }],
]) {
  const c = cliente({ estados: [estado], alterar: { data: { ativo: false }, error: null } });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(
    `B4. estado desconhecido (${nome}): recusa e não altera`,
    [r.ok, r.codigo, alterou(c).length],
    [false, "estado-desconhecido", 0],
  );
}
{
  const c = cliente({ estados: [LIGADO], alterar: { data: { ativo: false }, error: null } });
  const r = await desligarMotorDeVigencia(c, { motivo: "curto", confirmacao: FRASE_DE_REVERSAO });
  verificar(
    "B5. entrada inválida não toca o banco",
    [r.ok, r.codigo, c.chamadas.length],
    [false, "entrada-invalida", 0],
  );
}

console.log("\nC. A RPC oficial\n");
{
  const c = cliente({
    estados: [LIGADO, DESLIGADO],
    alterar: { data: { ativo: false }, error: null },
  });
  await desligarMotorDeVigencia(c, {
    motivo: `  ${MOTIVO}  `,
    confirmacao: ` ${FRASE_DE_REVERSAO} `,
  });
  const a = alterou(c)[0].args;
  verificar("C1. p_ativar=false, motivo aparado, p_aceitar_pendencias=false", a, {
    p_ativar: false,
    p_reason: MOTIVO,
    p_aceitar_pendencias: false,
  });
  verificar(
    "C2. nunca envia p_aceitar_pendencias=true nem identidade",
    JSON.stringify(c.chamadas).includes('"p_aceitar_pendencias":true') ||
      /p_user|p_actor|uid|service/i.test(JSON.stringify(c.chamadas)),
    false,
  );
}
for (const [codigo, esperado] of [
  ["42501", /segundo fator/],
  ["28000", /segundo fator/],
]) {
  const c = cliente({
    estados: [LIGADO],
    alterar: { data: null, error: { code: codigo, message: "x" } },
  });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(
    `C3. ${codigo} do banco: mensagem de MFA/papel`,
    [r.ok, r.codigo, esperado.test(r.mensagem)],
    [false, "recusada-pelo-banco", true],
  );
}
{
  const c = cliente({
    estados: [LIGADO],
    alterar: {
      data: null,
      error: { code: "55000", message: "O motor por vigência já está desligado." },
    },
  });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(
    "C4. 55000 mostra a frase do banco",
    [r.ok, r.mensagem],
    [false, "O motor por vigência já está desligado."],
  );
  const c2 = cliente({
    estados: [LIGADO],
    alterar: { data: null, error: { code: "XX000", message: "SELECT secreto FROM t" } },
  });
  const r2 = await desligarMotorDeVigencia(c2, ENTRADA);
  verificar(
    "C5. erro desconhecido do banco não vaza o detalhe",
    [r2.ok, /SELECT|secreto/.test(r2.mensagem)],
    [false, false],
  );
}

console.log("\nD. Confirmação pelo estado\n");
for (const [nome, alterar] of [
  ["resposta sem 'ativo'", { data: {}, error: null }],
  ["resposta ainda ativa", { data: { ativo: true }, error: null }],
  ["resposta nula", { data: null, error: null }],
  ["resposta em lista", { data: [{ ativo: false }], error: null }],
]) {
  const c = cliente({ estados: [LIGADO, DESLIGADO], alterar });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(`D1. ${nome}: NÃO é sucesso`, [r.ok, r.codigo], [false, "resposta-invalida"]);
}
for (const [nome, depois] of [
  ["o estado ainda mostra ligado", LIGADO],
  ["a releitura falha", { data: null, error: { code: "XX000" } }],
  ["a releitura é inconsistente", { data: { ativo: false, consistente: false }, error: null }],
]) {
  const c = cliente({
    estados: [LIGADO, depois],
    alterar: { data: { ativo: false }, error: null },
  });
  const r = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(
    `D2. RPC disse desligado mas ${nome}: não declara sucesso`,
    [r.ok, r.codigo],
    [false, "resposta-invalida"],
  );
}

console.log("\nE. Chamada duplicada\n");
{
  // Segunda chamada depois da primeira: o estado já é desligado, e a RPC nem é chamada.
  const estados = [LIGADO, DESLIGADO, DESLIGADO];
  const c = cliente({ estados, alterar: { data: { ativo: false }, error: null } });
  const a = await desligarMotorDeVigencia(c, ENTRADA);
  const b = await desligarMotorDeVigencia(c, ENTRADA);
  verificar(
    "E1. a segunda é recusada como 'ja-desligado' e só houve UMA alteração",
    [a.ok, b.ok, b.codigo, alterou(c).length],
    [true, false, "ja-desligado", 1],
  );
}

console.log("\nF. Trava de servidor e Server Action\n");
verificar(
  "F1. variável própria, distinta da da ativação",
  [VARIAVEL_DE_REVERSAO, VARIAVEL_DE_REVERSAO !== VARIAVEL_DE_ATIVACAO],
  ["BS_REVERSAO_MOTOR_HABILITADA", true],
);
verificar(
  "F2. só o texto exato 'true' abre",
  ["true", "TRUE", "1", "", undefined, null, " true"].map((v) => reversaoHabilitada(v)),
  [true, false, false, false, false, false, false],
);
const acao = semComentarios(ler("src/app/(painel)/implantacao-vigencias/_acoes.ts"));
const trecho = acao.slice(acao.indexOf("export async function desligarMotorAction"));
const ordem = (t, a, b) => t.indexOf(a) > -1 && t.indexOf(a) < t.indexOf(b);
verificar(
  "F3. a ação exige admin AAL2 ANTES da trava, e a trava ANTES de criar o cliente do banco",
  ordem(trecho, "exigirAdminAal2()", "reversaoHabilitada(") &&
    ordem(trecho, "reversaoHabilitada(", "criarClienteServidor()"),
  true,
);
verificar(
  "F4. a ação lê a variável da REVERSÃO, não a da ativação",
  trecho.includes("VARIAVEL_DE_REVERSAO") && !trecho.includes("VARIAVEL_DE_ATIVACAO"),
  true,
);
verificar(
  "F5. cliente da SESSÃO: nenhum service_role nem cliente administrativo",
  /service_role|integrations\/supabase\/admin|criarClienteAdmin|SUPABASE_SERVICE/i.test(
    acao + semComentarios(ler("src/lib/ativacao-motor.ts")),
  ),
  false,
);
verificar(
  "F6. a ação da ativação continua lendo a variável da ativação",
  /ligarMotorAction[\s\S]*?VARIAVEL_DE_ATIVACAO/.test(acao),
  true,
);
verificar(
  "F7. a página passa as duas travas lidas no servidor",
  /reversaoHabilitada=\{reversaoHabilitada\(process\.env\[VARIAVEL_DE_REVERSAO\]\)\}/.test(
    semComentarios(ler("src/app/(painel)/implantacao-vigencias/page.tsx")),
  ),
  true,
);

console.log("\nG. Interface\n");
const tela = semComentarios(ler("src/app/(painel)/implantacao-vigencias/desligar-motor.tsx"));
const ativar = semComentarios(ler("src/app/(painel)/implantacao-vigencias/ativar-motor.tsx"));
verificar(
  "G1. o desligamento só é montado no ramo do motor LIGADO",
  /estado\.tag === "ligado"[\s\S]*?<DesligarMotor habilitada=\{reversaoHabilitada\} \/>/.test(
    ativar,
  ) && (ativar.match(/<DesligarMotor/g) ?? []).length === 1,
  true,
);
verificar(
  "G2. não desliga ao carregar: sem useEffect e uma única mutação, no clique",
  !/useEffect/.test(tela) && (tela.match(/desligar\.mutate\(/g) ?? []).length === 1,
  true,
);
verificar(
  "G3. botão de confirmar só com entrada válida e sem requisição em curso (sem duplo clique)",
  /disabled=\{!entrada\.ok \|\| desligar\.isPending\}/.test(tela) &&
    /if \(!entrada\.ok\) return;/.test(tela),
  true,
);
verificar(
  "G4. janela fechada: nem botão nem diálogo, só o aviso",
  /if \(!habilitada\)[\s\S]*?MENSAGEM_REVERSAO_DESABILITADA[\s\S]*?return \(\s*<section/.test(tela),
  true,
);
verificar(
  "G5. relê o estado em qualquer desfecho (sucesso, recusa e erro)",
  (tela.match(/invalidateQueries\(\{ queryKey: CHAVE_DO_MOTOR \}\)/g) ?? []).length === 2,
  true,
);
verificar(
  "G6. o diálogo exige motivo e a frase",
  tela.includes("FRASE_DE_REVERSAO") && tela.includes("validarEntradaDeReversao"),
  true,
);
verificar(
  "G7. a ativação segue intacta: ligarMotorDeVigencia ainda só liga (p_ativar: true)",
  await (async () => {
    const c = cliente({
      estados: [DESLIGADO],
      alterar: { data: { ativo: true, ativada_em: "2026-10-29", pendencias: 0 }, error: null },
    });
    c.rpc = ((orig) => async (n, a) => {
      if (n === "pendencias_implantacao_vigencias" || n === "divergencias_implantacao_vigencias") {
        c.chamadas.push({ nome: n, args: a });
        return { data: [], error: null };
      }
      return orig(n, a);
    })(c.rpc.bind(c));
    const r = await ligarMotorDeVigencia(c, { motivo: MOTIVO, confirmacao: FRASE_DE_CONFIRMACAO });
    return [r.ok, alterou(c)[0].args.p_ativar, alterou(c)[0].args.p_aceitar_pendencias];
  })(),
  [true, true, false],
);
verificar(
  "G8. nenhuma migration nova nesta mudança",
  ler("package.json").includes("test:reversao-motor"),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
