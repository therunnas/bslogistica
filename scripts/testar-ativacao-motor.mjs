/**
 * Testes da ativação administrativa do motor por vigência (C05-B8.6).
 *
 * COMO RODAR:
 *
 *   npm run test:ativacao-motor
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo TypeScript direto, sem
 * rede. Duas metades: o comportamento de `ligarMotorDeVigencia` contra um cliente de RPC simulado
 * (cada ramo de recusa e o caminho feliz) e a forma literal dos arquivos — a autorização vive no
 * servidor, a RPC roda com o cliente da sessão, nunca `service_role`, nunca aceita pendência.
 *
 * Os cenários de identidade (anônimo, operacional, admin em AAL1) são provados no banco, pela
 * suíte SQL `supabase/tests/026_ativacao_banco_vazio.sql`; aqui se prova que a Server Action
 * chama `exigirAdminAal2()` antes de qualquer outra coisa.
 */

import { readFileSync } from "node:fs";

import {
  FRASE_DE_CONFIRMACAO,
  MENSAGEM_ATIVACAO_DESABILITADA,
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  RPC_ATIVACAO,
  VARIAVEL_DE_ATIVACAO,
  ativacaoHabilitada,
  ligarMotorDeVigencia,
  validarEntradaDeAtivacao,
} from "../src/lib/ativacao-motor.ts";
import { RPC_VIGENCIAS } from "../src/lib/vigencias.ts";

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

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MOTIVO = "Ativação autorizada para o início da operação real";
const ENTRADA = { motivo: MOTIVO, confirmacao: FRASE_DE_CONFIRMACAO };

/** Cliente de RPC simulado: registra cada chamada e responde pelo nome. */
function cliente(respostas) {
  const chamadas = [];
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push({ nome, args });
      const r = respostas[nome];
      if (r === undefined)
        return { data: null, error: { code: "PGRST202", message: "sem resposta" } };
      return typeof r === "function" ? r(args) : r;
    },
  };
}

const ESTADO_DESLIGADO = {
  data: { ativo: false, consistente: true, ativada_em: null },
  error: null,
};
const VAZIO = { data: [], error: null };
const LIGADO_OK = {
  data: { ativo: true, ativada_em: "2026-10-24", pendencias: 0, sincronizacao: null },
  error: null,
};
const ok = () =>
  cliente({
    [RPC_ATIVACAO.estado]: ESTADO_DESLIGADO,
    [RPC_ATIVACAO.pendencias]: VAZIO,
    [RPC_ATIVACAO.divergencias]: VAZIO,
    [RPC_ATIVACAO.alterar]: LIGADO_OK,
  });
const escreveu = (c) => c.chamadas.some((x) => x.nome === RPC_ATIVACAO.alterar);

// ---------------------------------------------------------------------------
// A. Nomes e entrada
// ---------------------------------------------------------------------------

console.log("A. Nomes das RPCs e validação da entrada");

verificar(
  "A1. os nomes são os de RPC_VIGENCIAS.motor",
  [
    RPC_ATIVACAO.estado === RPC_VIGENCIAS.motor.estado,
    RPC_ATIVACAO.pendencias === RPC_VIGENCIAS.motor.pendencias,
    RPC_ATIVACAO.divergencias === RPC_VIGENCIAS.motor.divergencias,
    RPC_ATIVACAO.alterar === RPC_VIGENCIAS.motor.alterar,
  ],
  [true, true, true, true],
);
verificar("A2. entrada válida", validarEntradaDeAtivacao(ENTRADA), { ok: true, motivo: MOTIVO });
verificar(
  "A3. o motivo é aparado antes de seguir",
  validarEntradaDeAtivacao({ motivo: `  ${MOTIVO}  `, confirmacao: ` ${FRASE_DE_CONFIRMACAO} ` }),
  { ok: true, motivo: MOTIVO },
);
verificar(
  "A4. entradas que não são objeto são recusadas",
  [null, undefined, "x", 3, []].map((e) => validarEntradaDeAtivacao(e).ok),
  [false, false, false, false, false],
);
verificar(
  "A5. campos que não são texto são recusados",
  [
    { motivo: 1, confirmacao: FRASE_DE_CONFIRMACAO },
    { motivo: MOTIVO, confirmacao: 1 },
    { motivo: MOTIVO },
    { confirmacao: FRASE_DE_CONFIRMACAO },
  ].map((e) => validarEntradaDeAtivacao(e).ok),
  [false, false, false, false],
);
verificar(
  "A6. motivo ausente, em branco ou curto é recusado",
  ["", "   ", "x".repeat(MOTIVO_MINIMO - 1)].map(
    (m) => validarEntradaDeAtivacao({ motivo: m, confirmacao: FRASE_DE_CONFIRMACAO }).ok,
  ),
  [false, false, false],
);
verificar(
  "A7. motivo acima do limite é recusado, no limite passa",
  [
    validarEntradaDeAtivacao({
      motivo: "x".repeat(MOTIVO_MAXIMO + 1),
      confirmacao: FRASE_DE_CONFIRMACAO,
    }).ok,
    validarEntradaDeAtivacao({
      motivo: "x".repeat(MOTIVO_MAXIMO),
      confirmacao: FRASE_DE_CONFIRMACAO,
    }).ok,
  ],
  [false, true],
);
verificar(
  "A8. a frase de confirmação é exata: minúscula, parcial ou vazia não serve",
  [FRASE_DE_CONFIRMACAO.toLowerCase(), "LIGAR", "", "SIM"].map(
    (f) => validarEntradaDeAtivacao({ motivo: MOTIVO, confirmacao: f }).ok,
  ),
  [false, false, false, false],
);

// ---------------------------------------------------------------------------
// B. Caminho feliz
// ---------------------------------------------------------------------------

console.log("B. Ativação autorizada");

{
  const c = ok();
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar("B1. liga e devolve a data e as pendências reais da RPC", r, {
    ok: true,
    ativadaEm: "2026-10-24",
    pendencias: 0,
  });
  verificar(
    "B2. a ordem é estado, pendências e divergências, e só depois a RPC de escrita",
    c.chamadas.map((x) => x.nome),
    [RPC_ATIVACAO.estado, RPC_ATIVACAO.pendencias, RPC_ATIVACAO.divergencias, RPC_ATIVACAO.alterar],
  );
  const escrita = c.chamadas.filter((x) => x.nome === RPC_ATIVACAO.alterar);
  verificar("B3. exatamente uma chamada de escrita", escrita.length, 1);
  verificar(
    "B4. envia p_ativar = true, o motivo aparado e p_aceitar_pendencias = false",
    escrita[0].args,
    { p_ativar: true, p_reason: MOTIVO, p_aceitar_pendencias: false },
  );
  verificar(
    "B5. a escrita é a última chamada",
    c.chamadas[c.chamadas.length - 1].nome,
    RPC_ATIVACAO.alterar,
  );
}

// ---------------------------------------------------------------------------
// C. Recusas antes da escrita
// ---------------------------------------------------------------------------

console.log("C. Recusas antes de escrever");

{
  const c = ok();
  const r = await ligarMotorDeVigencia(c, { motivo: "", confirmacao: FRASE_DE_CONFIRMACAO });
  verificar(
    "C1. motivo ausente: recusa e nem consulta o banco",
    [r.ok, r.codigo, c.chamadas.length],
    [false, "entrada-invalida", 0],
  );
}
{
  const c = ok();
  const r = await ligarMotorDeVigencia(c, { motivo: MOTIVO, confirmacao: "" });
  verificar(
    "C2. confirmação cancelada/vazia: recusa e nem consulta o banco",
    [r.ok, r.codigo, c.chamadas.length],
    [false, "entrada-invalida", 0],
  );
}
{
  const c = cliente({
    [RPC_ATIVACAO.estado]: { data: { ativo: true, consistente: true }, error: null },
    [RPC_ATIVACAO.pendencias]: VAZIO,
    [RPC_ATIVACAO.divergencias]: VAZIO,
    [RPC_ATIVACAO.alterar]: LIGADO_OK,
  });
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar(
    "C3. motor já ligado: recusa sem escrever",
    [r.ok, r.codigo, escreveu(c)],
    [false, "ja-ligado", false],
  );
}
for (const [rotulo, estado] of [
  ["erro ao consultar", { data: null, error: { code: "42501", message: "x" } }],
  ["resposta que não é objeto", { data: "x", error: null }],
  ["ativo não booleano", { data: { ativo: "false", consistente: true }, error: null }],
  ["gatilhos inconsistentes", { data: { ativo: false, consistente: false }, error: null }],
  ["consistente ausente", { data: { ativo: false }, error: null }],
]) {
  const c = ok();
  c.chamadas.length = 0;
  const cc = cliente({
    [RPC_ATIVACAO.estado]: estado,
    [RPC_ATIVACAO.pendencias]: VAZIO,
    [RPC_ATIVACAO.divergencias]: VAZIO,
    [RPC_ATIVACAO.alterar]: LIGADO_OK,
  });
  const r = await ligarMotorDeVigencia(cc, ENTRADA);
  verificar(
    `C4. estado desconhecido (${rotulo}): nunca vira "desligado"`,
    [r.ok, r.codigo, escreveu(cc)],
    [false, "estado-desconhecido", false],
  );
}
{
  const c = cliente({
    [RPC_ATIVACAO.estado]: ESTADO_DESLIGADO,
    [RPC_ATIVACAO.pendencias]: { data: [{ tipo: "contrato", id: "x", nome: "K" }], error: null },
    [RPC_ATIVACAO.divergencias]: VAZIO,
    [RPC_ATIVACAO.alterar]: LIGADO_OK,
  });
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar(
    "C5. pendência existente: recusa sem escrever e diz a contagem",
    [r.ok, r.codigo, escreveu(c), /1 cadastro\(s\) sem vigência e 0 divergência/.test(r.mensagem)],
    [false, "bloqueios", false, true],
  );
}
{
  const c = cliente({
    [RPC_ATIVACAO.estado]: ESTADO_DESLIGADO,
    [RPC_ATIVACAO.pendencias]: VAZIO,
    [RPC_ATIVACAO.divergencias]: {
      data: [{ tipo: "contrato", id: "x", nome: "K", campos: ["daily_rate"] }],
      error: null,
    },
    [RPC_ATIVACAO.alterar]: LIGADO_OK,
  });
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar(
    "C6. divergência existente: recusa sem escrever",
    [r.ok, r.codigo, escreveu(c)],
    [false, "bloqueios", false],
  );
}
for (const [rotulo, pend, div] of [
  ["erro nas pendências", { data: null, error: { code: "42501" } }, VAZIO],
  ["erro nas divergências", VAZIO, { data: null, error: { code: "57014" } }],
  ["pendências que não são lista", { data: { x: 1 }, error: null }, VAZIO],
  ["divergências nulas", VAZIO, { data: null, error: null }],
]) {
  const c = cliente({
    [RPC_ATIVACAO.estado]: ESTADO_DESLIGADO,
    [RPC_ATIVACAO.pendencias]: pend,
    [RPC_ATIVACAO.divergencias]: div,
    [RPC_ATIVACAO.alterar]: LIGADO_OK,
  });
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar(
    `C7. conferência falha (${rotulo}): não vira "sem pendências"`,
    [r.ok, r.codigo, escreveu(c)],
    [false, "nao-conferido", false],
  );
}

// ---------------------------------------------------------------------------
// D. Recusas e falhas da RPC
// ---------------------------------------------------------------------------

console.log("D. Falhas da RPC de ativação");

for (const [rotulo, erro, codigoEsperado, trecho] of [
  [
    "sem admin/AAL2 (42501)",
    { code: "42501", message: "Apenas administradores podem gerir condições financeiras." },
    "recusada-pelo-banco",
    /segundo fator/,
  ],
  [
    "sessão não autenticada (28000)",
    { code: "28000", message: "Sessão não autenticada." },
    "recusada-pelo-banco",
    /segundo fator/,
  ],
  [
    "motivo recusado pelo banco (22023)",
    { code: "22023", message: "O motivo é obrigatório." },
    "recusada-pelo-banco",
    /motivo é obrigatório/,
  ],
  [
    "pendência na corrida (55000)",
    { code: "55000", message: "Há 1 cadastro(s) em uso sem vigência para hoje." },
    "recusada-pelo-banco",
    /cadastro\(s\) em uso sem vigência/,
  ],
  [
    "erro técnico qualquer",
    { code: "XX000", message: "detalhe interno com tabela public.x" },
    "recusada-pelo-banco",
    /Nada foi alterado/,
  ],
]) {
  const c = cliente({
    [RPC_ATIVACAO.estado]: ESTADO_DESLIGADO,
    [RPC_ATIVACAO.pendencias]: VAZIO,
    [RPC_ATIVACAO.divergencias]: VAZIO,
    [RPC_ATIVACAO.alterar]: { data: null, error: erro },
  });
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar(
    `D1. ${rotulo}: recusa com mensagem segura`,
    [r.ok, r.codigo, trecho.test(r.mensagem)],
    [false, codigoEsperado, true],
  );
  if (erro.code === "XX000") {
    verificar(
      "D2. erro técnico não vaza o texto interno do banco",
      /public\.x|detalhe interno/.test(r.mensagem),
      false,
    );
  }
}
for (const [rotulo, data] of [
  ["resposta nula", null],
  ["ativo falso", { ativo: false }],
  ["ativo ausente", { ativada_em: "2026-10-24" }],
  ["lista", []],
]) {
  const c = cliente({
    [RPC_ATIVACAO.estado]: ESTADO_DESLIGADO,
    [RPC_ATIVACAO.pendencias]: VAZIO,
    [RPC_ATIVACAO.divergencias]: VAZIO,
    [RPC_ATIVACAO.alterar]: { data, error: null },
  });
  const r = await ligarMotorDeVigencia(c, ENTRADA);
  verificar(
    `D3. a RPC não confirma ativo = true (${rotulo}): não declara sucesso`,
    [r.ok, r.codigo],
    [false, "resposta-invalida"],
  );
}

// ---------------------------------------------------------------------------
// E. Forma dos arquivos
// ---------------------------------------------------------------------------

console.log("E. Forma dos arquivos");

const acao = semComentarios(ler("src/app/(painel)/implantacao-vigencias/_acoes.ts"));
const lib = semComentarios(ler("src/lib/ativacao-motor.ts"));
const componente = semComentarios(ler("src/app/(painel)/implantacao-vigencias/ativar-motor.tsx"));
const painel = semComentarios(ler("src/app/(painel)/implantacao-vigencias/painel-implantacao.tsx"));
const pagina = semComentarios(ler("src/app/(painel)/implantacao-vigencias/page.tsx"));
const acaoBruta = ler("src/app/(painel)/implantacao-vigencias/_acoes.ts");

verificar("E1. a Server Action é 'use server'", /^"use server";/.test(acaoBruta), true);
verificar(
  "E2. exigirAdminAal2() é a primeira coisa da ação, antes de criar o cliente e de qualquer RPC",
  acao.indexOf("exigirAdminAal2()") > 0 &&
    acao.indexOf("exigirAdminAal2()") < acao.indexOf("criarClienteServidor()") &&
    acao.indexOf("exigirAdminAal2()") < acao.indexOf("ligarMotorDeVigencia("),
  true,
);
verificar(
  "E3. usa o cliente da sessão (criarClienteServidor), nunca service_role nem o cliente administrativo",
  /criarClienteServidor/.test(acao) &&
    !/service_role|criarClienteAdmin|SERVICE_ROLE/i.test(acao + lib + componente),
  true,
);
verificar(
  "E4. nada de identidade simulada: sem set_config, request.jwt nem auth.uid no cliente ou na ação",
  !/set_config|request\.jwt|auth\.uid|claims/.test(acao + lib + componente),
  true,
);
verificar(
  "E5. a RPC de escrita é chamada só em ativacao-motor.ts, com p_aceitar_pendencias = false e sem 'true' em lugar algum",
  /p_aceitar_pendencias: false/.test(lib) &&
    !/p_aceitar_pendencias:\s*true/.test(acao + lib + componente + painel) &&
    !/alterar_motor_vigencia|motor\.alterar|RPC_ATIVACAO\.alterar/.test(componente + painel + acao),
  true,
);
verificar(
  "E6. só liga: nenhuma chamada com p_ativar: false e nenhum botão de desligar/sincronizar/regularizar",
  !/p_ativar:\s*false/.test(lib) &&
    !/Desligar o motor|desligarMotor|sincronizar_colunas|regularizar_apontamento|sincronizarColunas/i.test(
      acao + lib + componente,
    ),
  true,
);
verificar(
  "E7. não liga ao carregar: a mutação só dispara no clique de confirmação",
  !/useEffect/.test(componente) && (componente.match(/ativar\.mutate\(/g) ?? []).length === 1,
  true,
);
verificar(
  "E8. o botão de confirmar só habilita com motivo e frase válidos e fora de uma ativação em curso",
  /disabled=\{!entrada\.ok \|\| ativar\.isPending\}/.test(componente),
  true,
);
verificar(
  "E9. o botão de abrir só habilita sem pendências nem divergências",
  /disabled=\{!semBloqueios\}/.test(componente),
  true,
);
verificar(
  "E10. a tela mostra o motivo real da recusa e relê o estado depois de qualquer desfecho",
  /setRecusa\(r\.mensagem\)/.test(componente) &&
    /invalidateQueries\(\{ queryKey: CHAVE_DO_MOTOR \}\)/.test(componente) &&
    /invalidateQueries\(\{ queryKey: CHAVE_DA_IMPLANTACAO \}\)/.test(componente),
  true,
);
verificar(
  "E11. a página segue protegida por exigirAdmin antes do componente",
  /exigirAdmin\(\)/.test(pagina) &&
    pagina.indexOf("exigirAdmin()") < pagina.indexOf("<PainelImplantacaoVigencias"),
  true,
);
verificar(
  "E12. o painel só monta o controle depois de ler pendências e divergências, passando o resumo",
  /<AtivarMotor[\s\S]*?semBloqueios=\{/.test(painel),
  true,
);
verificar(
  "E13. o módulo da ativação não importa Next.js nem o Supabase (puro, testável sem rede)",
  !/from "next|from "@supabase|from "@\/integrations/.test(lib),
  true,
);

// ---------------------------------------------------------------------------
// F. Trava de servidor da ativação (C05-B8.12)
// ---------------------------------------------------------------------------

console.log("F. Trava de servidor: a janela de ativação é fechada por padrão");

verificar(
  "F1. só o texto exato 'true' abre a janela; ausente, vazio, outra caixa, espaço e qualquer outro valor, não",
  [
    ativacaoHabilitada("true"),
    ativacaoHabilitada(undefined),
    ativacaoHabilitada(null),
    ativacaoHabilitada(""),
    ativacaoHabilitada("TRUE"),
    ativacaoHabilitada("True"),
    ativacaoHabilitada(" true"),
    ativacaoHabilitada("true "),
    ativacaoHabilitada("1"),
    ativacaoHabilitada("yes"),
    ativacaoHabilitada("false"),
  ],
  [true, false, false, false, false, false, false, false, false, false, false],
);
verificar(
  "F2. a variável é só de servidor: nome sem NEXT_PUBLIC e fora de qualquer arquivo de código do cliente",
  [
    VARIAVEL_DE_ATIVACAO,
    VARIAVEL_DE_ATIVACAO.startsWith("NEXT_PUBLIC_"),
    /NEXT_PUBLIC_BS_ATIVACAO/.test(ler("src/lib/ativacao-motor.ts") + ler(".env.example")),
    componente.includes(VARIAVEL_DE_ATIVACAO) || /process\.env/.test(componente + painel),
  ],
  ["BS_ATIVACAO_MOTOR_HABILITADA", false, false, false],
);
verificar(
  "F3. a Server Action recusa com a janela fechada: depois da autorização, antes de criar o cliente do banco e de qualquer RPC",
  /ativacaoHabilitada\(process\.env\[VARIAVEL_DE_ATIVACAO\]\)/.test(acao) &&
    /codigo: "desabilitada"/.test(acao) &&
    acao.indexOf("exigirAdminAal2()") < acao.indexOf("ativacaoHabilitada(") &&
    acao.indexOf("ativacaoHabilitada(") < acao.indexOf("criarClienteServidor()") &&
    acao.indexOf("ativacaoHabilitada(") < acao.indexOf("ligarMotorDeVigencia("),
  true,
);
verificar(
  "F4. a recusa tem código próprio e mensagem fixa (sem eco de entrada do cliente)",
  [
    /\| "desabilitada"/.test(lib),
    MENSAGEM_ATIVACAO_DESABILITADA.length > 40,
    /mensagem: MENSAGEM_ATIVACAO_DESABILITADA/.test(acao),
  ],
  [true, true, true],
);
verificar(
  "F5. a página lê a trava no servidor e a passa ao painel; o painel a repassa ao controle",
  /ativacaoHabilitada=\{ativacaoHabilitada\(process\.env\[VARIAVEL_DE_ATIVACAO\]\)\}/.test(
    pagina,
  ) && /habilitada=\{ativacaoHabilitada\}/.test(painel),
  true,
);
verificar(
  "F6. com a janela fechada o controle não tem botão nem diálogo: o retorno antecede o botão e o diálogo",
  /if \(!habilitada\) \{\s*return \(/.test(componente) &&
    componente.indexOf("if (!habilitada)") < componente.indexOf("Ligar o motor…") &&
    componente.indexOf("if (!habilitada)") < componente.indexOf("<Dialog"),
  true,
);
verificar(
  "F7. a trava não cria bypass: continua exigindo admin em AAL2, motivo, frase e a RPC oficial, sem service_role e sem aceitar pendência",
  /exigirAdminAal2\(\)/.test(acao) &&
    /p_aceitar_pendencias: false/.test(lib) &&
    !/service_role|SERVICE_ROLE|criarClienteAdmin/i.test(acao + lib + componente + pagina),
  true,
);
verificar(
  "F8. a variável está documentada no .env.example como desabilitada por padrão, sem valor ligado",
  /BS_ATIVACAO_MOTOR_HABILITADA/.test(ler(".env.example")) &&
    !/^BS_ATIVACAO_MOTOR_HABILITADA=true/m.test(ler(".env.example")),
  true,
);
verificar(
  "F9. continua sem botão de desligar e sem nova página: a rota é a mesma da B8.6",
  !/Desligar|desligar o motor/i.test(componente.replace(/Desligar depois exige/, "")) &&
    ler("src/app/(painel)/_components/app-shell.tsx").split("/implantacao-vigencias").length === 2,
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
