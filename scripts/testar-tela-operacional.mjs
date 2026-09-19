/**
 * Testes da tela operacional de apontamentos (B2.3).
 *
 * COMO RODAR:
 *
 *   npm run test:tela-operacional
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * DUAS METADES:
 *
 *   - forma literal dos arquivos primeiro (blocos A e B), porque o isolamento da
 *     tela administrativa e do financeiro não se observa de fora: é ausência de
 *     importação, e ausência só se mede lendo o arquivo. Vêm antes por não
 *     depender de nada;
 *   - comportamento das funções puras de `_dominio.ts` (C a H): junção da equipe
 *     com os apontamentos, o que entra no payload, os estados travados, o
 *     intervalo e a tradução dos códigos de erro.
 *
 * O que NÃO está aqui, e não dá para estar: a tela rodando contra o banco. Não
 * existe conta operacional, e a política de AAL ainda é do PR C — a prova ponta
 * a ponta é a matriz do PR G.
 */

import { readFileSync } from "node:fs";

import {
  apontamentosPorColaborador,
  escolhaAutomatica,
  folhaEstaFechada,
  linhasAlteradas,
  mensagemDeErro,
  montarRascunho,
  normalizarIntervalo,
} from "../src/app/(painel)/operacional/_dominio.ts";

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

const fontes = {
  dominio: ler("src/app/(painel)/operacional/_dominio.ts"),
  tela: ler("src/app/(painel)/operacional/painel-operacional.tsx"),
  pagina: ler("src/app/(painel)/operacional/page.tsx"),
  guard: ler("src/app/(painel)/_exigir-operacional.tsx"),
  restrito: ler("src/app/(painel)/_components/acesso-operacional-restrito.tsx"),
  dashboard: ler("src/app/(painel)/dashboard/page.tsx"),
  shell: ler("src/app/(painel)/_components/app-shell.tsx"),
  layout: ler("src/app/(painel)/layout.tsx"),
  mfaLib: ler("src/lib/mfa.ts"),
  autorizacao: ler("src/app/(painel)/_autorizacao.ts"),
  login: ler("src/app/login/page.tsx"),
};
const caminhoOperacional = fontes.dominio + fontes.tela + fontes.pagina;

console.log("\nA. A tela operacional não alcança o administrativo nem o financeiro\n");

for (const proibido of [
  "billing",
  "ledger",
  "lib/queries",
  "lib/mutations",
  "painel-apontamentos",
]) {
  verificar(
    `A1.${proibido} — não é importado`,
    new RegExp(`from "[^"]*${proibido}"`).test(caminhoOperacional),
    false,
  );
}
verificar("A2. nenhum from(...) na tela", /\.from\s*\(/.test(caminhoOperacional), false);
verificar("A3. nenhum select(...) na tela", /\.select\s*\(/.test(caminhoOperacional), false);
for (const coluna of [
  "billed_amount",
  "cost_amount",
  "invoice_id",
  "daily_cost",
  "daily_rate",
  "agreed_amount",
  "shift_hours",
  "ot_factor",
]) {
  verificar(
    `A4.${coluna} — a coluna não é nomeada em lugar nenhum`,
    new RegExp(`\\b${coluna}\\b`).test(caminhoOperacional),
    false,
  );
}
verificar(
  "A5. nem receita, custo ou margem aparecem na tela",
  /receita|margem|faturamento|a faturar/i.test(semComentarios(fontes.tela)),
  false,
);
verificar("A6. nem formatação de dinheiro", /\bbrl\b/.test(caminhoOperacional), false);
verificar(
  "A7. os cinco hooks da camada B2.1 são a fonte de dados",
  [
    "useOperacoesDoOperador",
    "useTurnosDoOperador",
    "useEquipeDoOperador",
    "useApontamentosDoOperador",
    "useSalvarApontamentoOperacional",
  ].filter((hook) => fontes.tela.includes(hook)).length,
  5,
);
verificar(
  "A8. e o payload é montado pela camada, não à mão aqui",
  /montarLinhasDoApontamento|JSON\.stringify/.test(fontes.tela),
  false,
);
verificar(
  "A9. nenhum service_role em lugar nenhum",
  /service_role|SERVICE_ROLE/.test(caminhoOperacional + fontes.guard + fontes.restrito),
  false,
);

console.log("\nB. Guard, roteamento e navegação\n");

verificar(
  "B1. a rota chama o guard antes da tela",
  /const bloqueio = await exigirOperacional\(\);\s*\n\s*if \(bloqueio\) return bloqueio;/.test(
    fontes.pagina,
  ),
  true,
);
verificar(
  "B2. e o guard vem antes do painel",
  fontes.pagina.includes("await exigirOperacional()") &&
    fontes.pagina.indexOf("await exigirOperacional()") <
      fontes.pagina.indexOf("<PainelOperacional />"),
  true,
);
verificar(
  "B3. o guard usa a regra central de papel",
  /resolverPapelEfetivo\(acesso\.papeis\) !== "operacional"/.test(fontes.guard),
  true,
);
verificar(
  "B4. e NÃO decide por papeis.includes",
  /papeis\.includes/.test(semComentarios(fontes.guard)),
  false,
);
verificar(
  "B5. fecha em qualquer situação que não seja liberado",
  /acesso\.situacao !== "liberado"/.test(fontes.guard),
  true,
);
verificar(
  "B6. devolve a tela de área operacional restrita",
  /<AcessoOperacionalRestrito \/>/.test(fontes.guard),
  true,
);
verificar(
  "B7. que não é a de área administrativa restrita",
  /AcessoAdministrativoRestrito/.test(fontes.guard),
  false,
);
verificar(
  "B8. a mensagem manda o admin ao painel administrativo",
  /Área operacional restrita/.test(fontes.restrito) &&
    /Utilize o painel administrativo/.test(fontes.restrito),
  true,
);
verificar(
  "B9. e não vaza detalhe técnico",
  /RLS|aal1|aal2|RPC|SECURITY DEFINER|user_roles/.test(semComentarios(fontes.restrito)),
  false,
);
verificar(
  "B10. /dashboard redireciona o operacional",
  /resolverPapelEfetivo\(acesso\.papeis\) === "operacional"\)\s*\{?\s*\n?\s*redirect\("\/operacional"\)/.test(
    fontes.dashboard,
  ),
  true,
);
verificar(
  "B11. e o admin segue para o painel administrativo",
  /const bloqueio = await exigirAdmin\(\);/.test(fontes.dashboard) &&
    fontes.dashboard.includes("<PainelDashboard />"),
  true,
);
verificar(
  "B12. o guard administrativo continua depois do roteamento",
  fontes.dashboard.indexOf('redirect("/operacional")') <
    fontes.dashboard.indexOf("await exigirAdmin()"),
  true,
);
verificar(
  "B13. a decisão de papel NÃO foi duplicada no login",
  /resolverPapelEfetivo|papeis|operacional/.test(fontes.login),
  false,
);
verificar(
  "B14. o login continua mandando todo mundo a /dashboard",
  (fontes.login.match(/router\.replace\("\/dashboard"\)/g) ?? []).length,
  2,
);
verificar(
  "B15. o admin mantém os sete links",
  (fontes.shell.match(/\{ href: "\/[a-z]+", label/g) ?? []).length,
  8,
);
verificar(
  "B16. e o operacional tem exatamente um",
  /operacional: \[\{ href: "\/operacional", label: "Apontamentos", icon: CalendarCheck \}\]/.test(
    fontes.shell,
  ),
  true,
);
verificar("B17. sem papel não recebe link nenhum", /"sem-papel": \[\]/.test(fontes.shell), true);
verificar(
  "B18. o <nav> só existe quando há link",
  /\{navegacao\.length > 0 \? \(\s*<nav/.test(fontes.shell),
  true,
);
verificar(
  "B19. nenhum link desabilitado como placeholder",
  /disabled.*href|href.*disabled/.test(fontes.shell),
  false,
);

console.log("\nC. MFA, AAL e o restante seguem intocados\n");

verificar(
  "C1. o layout continua fechando o painel sem AAL2",
  /situacao === "mfa-ausente" \|\| acesso\.situacao === "mfa-pendente"\) redirect\("\/mfa"\)/.test(
    fontes.layout,
  ),
  true,
);
verificar(
  "C2. nenhum aal foi tocado pelo B2.3",
  /aal1|aal2/i.test(
    semComentarios(fontes.guard) +
      semComentarios(caminhoOperacional) +
      semComentarios(fontes.dashboard),
  ),
  false,
);
verificar(
  "C3. nextLevel não virou enforcement",
  /nextLevel/.test(caminhoOperacional + fontes.guard + fontes.dashboard),
  false,
);
verificar(
  "C4. a autorização continua lendo apenas user_roles",
  (fontes.autorizacao.match(/\.from\("(\w+)"\)/g) ?? []).join(","),
  '.from("user_roles")',
);
verificar(
  "C5. decidirSituacaoMfa continua com as quatro saídas",
  ["mfa-indisponivel", "mfa-ausente", "mfa-pendente", "liberado"].filter((s) =>
    fontes.mfaLib.includes(s),
  ).length,
  4,
);

console.log("\nD. Seleção automática e intervalo\n");

verificar("D1. uma opção só é selecionada sozinha", escolhaAutomatica([{ id: "a" }]), "a");
verificar(
  "D2. duas opções deixam a escolha para o usuário",
  escolhaAutomatica([{ id: "a" }, { id: "b" }]),
  null,
);
verificar("D3. lista vazia não seleciona nada", escolhaAutomatica([]), null);
verificar("D4. lista ausente não seleciona nada", escolhaAutomatica(undefined), null);

verificar("D5. intervalo negativo é recusado pela UX", normalizarIntervalo(-30), 0);
verificar("D6. e -1 também", normalizarIntervalo(-1), 0);
verificar("D7. texto negativo do input idem", normalizarIntervalo("-120"), 0);
verificar("D8. zero é válido", normalizarIntervalo(0), 0);
verificar("D9. positivo passa", normalizarIntervalo(45), 45);
verificar("D10. texto positivo do input passa", normalizarIntervalo("60"), 60);
verificar("D11. sem teto inventado", normalizarIntervalo(5000), 5000);
verificar("D12. valor quebrado vira zero", normalizarIntervalo("abc"), 0);
verificar("D13. vazio vira zero", normalizarIntervalo(""), 0);
verificar("D14. nulo vira zero", normalizarIntervalo(null), 0);

console.log("\nE. Rascunho: equipe × apontamentos\n");

const EQUIPE = [
  { employee_id: "e1", employee_name: "Um", employee_role: "ajudante", active: true },
  { employee_id: "e2", employee_name: "Dois", employee_role: null, active: true },
  { employee_id: "e3", employee_name: "Saiu", employee_role: "ajudante", active: false },
];

const folha = (extra = {}) => ({
  timesheet_id: "t1",
  shift_id: "s1",
  work_date: "2026-09-18",
  folha_status: "open",
  employee_id: null,
  status: null,
  check_in: null,
  check_out: null,
  break_minutes: null,
  notes: null,
  faturado: false,
  ...extra,
});

{
  const rascunho = montarRascunho(EQUIPE, [], 60);
  verificar("E1. só a equipe ativa entra quando não há apontamento", rascunho.length, 2);
  verificar("E2. o intervalo padrão vem do turno", rascunho[0].break_minutes, 60);
  verificar("E3. o padrão de situação é presente", rascunho[0].status, "present");
  verificar("E4. horários começam vazios", rascunho[0].check_in + "|" + rascunho[0].check_out, "|");
  verificar("E5. nada nasce faturado", rascunho[0].faturado, false);
}

{
  // Quem saiu da equipe aparece SE já tiver apontamento: o histórico não
  // desaparece, mas linha nova para ele seria recusada pelo banco.
  const rascunho = montarRascunho(EQUIPE, [folha({ employee_id: "e3", status: "present" })], 60);
  verificar("E6. quem saiu aparece se já tem apontamento", rascunho.length, 3);
  verificar(
    "E7. e vem marcado como fora da equipe",
    rascunho.find((l) => l.employee_id === "e3").ativo,
    false,
  );
}

{
  const rascunho = montarRascunho(EQUIPE, [], 60);
  verificar(
    "E8. quem saiu e não tem apontamento não aparece",
    rascunho.some((l) => l.employee_id === "e3"),
    false,
  );
}

{
  const gravado = folha({
    employee_id: "e1",
    status: "absent",
    check_in: "08:00:00",
    check_out: "17:00:00",
    break_minutes: 30,
    notes: "atestado",
    faturado: true,
  });
  const rascunho = montarRascunho(EQUIPE, [gravado], 60);
  const linha = rascunho.find((l) => l.employee_id === "e1");
  verificar("E9. o que está gravado prevalece sobre o padrão", linha.break_minutes, 30);
  verificar("E10. a situação gravada é preservada", linha.status, "absent");
  verificar("E11. a observação gravada é preservada", linha.notes, "atestado");
  verificar("E12. e o faturado chega do banco", linha.faturado, true);
}

verificar("E13. folha vazia não é folha fechada", folhaEstaFechada([folha()]), false);
verificar(
  "E14. folha fechada é reconhecida",
  folhaEstaFechada([folha({ folha_status: "closed" })]),
  true,
);
verificar("E15. sem folha, nada está fechado", folhaEstaFechada([]), false);
verificar("E16. resposta ausente idem", folhaEstaFechada(undefined), false);
verificar(
  "E17. a linha só de folha não conta como apontamento",
  apontamentosPorColaborador([folha()]).size,
  0,
);

console.log("\nF. Payload: só o que mudou, só os seis campos\n");

{
  const rascunho = montarRascunho(EQUIPE, [], 60);
  const pendentes = linhasAlteradas(rascunho, []);
  verificar("F1. linha nova entra no payload", pendentes.length, 2);
  verificar(
    "F2. e carrega exatamente os seis campos",
    Object.keys(pendentes[0]).sort().join(","),
    "break_minutes,check_in,check_out,employee_id,notes,status",
  );
  verificar("F3. horário vazio vira nulo explícito", pendentes[0].check_in, null);
  verificar("F4. observação vazia vira nulo explícito", pendentes[0].notes, null);
}

{
  const gravados = [
    folha({ employee_id: "e1", status: "present", check_in: "08:00:00", break_minutes: 60 }),
    folha({ employee_id: "e2", status: "present", check_in: "08:00:00", break_minutes: 60 }),
  ];
  const rascunho = montarRascunho(EQUIPE, gravados, 60);
  verificar("F5. nada mudou -> payload vazio", linhasAlteradas(rascunho, gravados).length, 0);

  const editado = rascunho.map((l) =>
    l.employee_id === "e2" ? { ...l, notes: "chegou tarde" } : l,
  );
  const pendentes = linhasAlteradas(editado, gravados);
  verificar("F6. só a linha editada entra", pendentes.length, 1);
  verificar("F7. e é a linha certa", pendentes[0].employee_id, "e2");
}

{
  const gravados = [folha({ employee_id: "e1", status: "present", check_in: "08:00:00" })];
  const rascunho = montarRascunho(EQUIPE, gravados, 60);
  // "08:00" e "08:00:00" são o mesmo horário: sem isso toda linha gravada
  // pareceria alterada e o payload reescreveria a folha inteira.
  verificar(
    "F8. segundos no horário não contam como alteração",
    linhasAlteradas(rascunho, gravados).some((l) => l.employee_id === "e1"),
    false,
  );
}

{
  const gravados = [folha({ employee_id: "e1", status: "present", faturado: true })];
  const rascunho = montarRascunho(EQUIPE, gravados, 60).map((l) =>
    l.employee_id === "e1" ? { ...l, notes: "tentando editar" } : l,
  );
  verificar(
    "F9. linha faturada nunca entra no payload",
    linhasAlteradas(rascunho, gravados).some((l) => l.employee_id === "e1"),
    false,
  );
}

{
  const gravados = [folha({ employee_id: "e3", status: "present" })];
  const rascunho = montarRascunho(EQUIPE, gravados, 60).map((l) =>
    l.employee_id === "e3" ? { ...l, notes: "tentando editar" } : l,
  );
  verificar(
    "F10. colaborador fora da equipe ativa também não entra",
    linhasAlteradas(rascunho, gravados).some((l) => l.employee_id === "e3"),
    false,
  );
}

{
  const rascunho = montarRascunho(EQUIPE, [], 60).map((l) => ({ ...l, break_minutes: -90 }));
  const pendentes = linhasAlteradas(rascunho, []);
  verificar("F11. intervalo negativo é normalizado antes de subir", pendentes[0].break_minutes, 0);
}

console.log("\nG. Folha fechada e linha faturada travam a edição\n");

// A tela decide o travamento por estado conhecido da leitura, não por erro:
// quem está fechado ou faturado nem chega a gerar payload.
{
  const gravados = [folha({ employee_id: "e1", status: "present", folha_status: "closed" })];
  const rascunho = montarRascunho(EQUIPE, gravados, 60);
  verificar("G1. folha fechada é detectada pela leitura", folhaEstaFechada(gravados), true);
  verificar(
    "G2. e a tela desabilita o salvar pela folha fechada",
    /disabled=\{fechada \|\| salvar\.isPending \|\| pendentes\.length === 0\}/.test(fontes.tela),
    true,
  );
  verificar(
    "G3. a linha é travada por folha fechada, faturado ou fora da equipe",
    /const travada = fechada \|\| linha\.faturado \|\| !linha\.ativo;/.test(fontes.tela),
    true,
  );
  verificar("G4. e o rascunho ainda é montado, para leitura", rascunho.length > 0, true);
}
verificar(
  "G5. o aviso de folha fechada tem o texto acordado",
  /Folha fechada pelo administrador\./.test(fontes.tela),
  true,
);
verificar(
  "G6. a marca de faturado é booleana, sem id de fatura",
  /Faturado/.test(fontes.tela),
  true,
);

console.log("\nH. Estados vazios e tradução de erro\n");

verificar(
  "H1. nenhuma operação atribuída",
  /Nenhuma operação atribuída a você\. Procure o administrador\./.test(fontes.tela),
  true,
);
verificar(
  "H2. operação sem turno, com o texto EXATO",
  fontes.tela.includes("Nenhum turno configurado para esta operação."),
  true,
);
verificar(
  "H3. turno sem equipe",
  /Nenhum colaborador alocado neste turno\./.test(fontes.tela),
  true,
);
verificar(
  "H4. falha de leitura oferece tentar de novo",
  /Tentar novamente/.test(fontes.tela),
  true,
);

// O SQLSTATE é categoria de UX. Cada um desses códigos cobre MAIS DE UMA causa,
// então a mensagem não afirma nenhuma delas.
const msg42501 = mensagemDeErro({
  code: "42501",
  message: "Folha fechada não recebe apontamento.",
});
verificar(
  "H5. 42501 não afirma uma causa específica",
  /apenas|somente|porque a folha|sem acesso à operação$/.test(msg42501),
  false,
);
verificar(
  "H6. 42501 cobre alteração impedida E falta de acesso",
  /não pode ser alterado/.test(msg42501) && /não tem acesso/.test(msg42501),
  true,
);
verificar(
  "H7. e não repete a mensagem crua do banco",
  msg42501.includes("Folha fechada não recebe apontamento."),
  false,
);

const msg23514 = mensagemDeErro({ code: "23514", message: "violates check constraint" });
verificar(
  "H8. 23514 manda revisar turno, equipe e intervalo",
  /turno/.test(msg23514) && /equipe/.test(msg23514) && /intervalo/.test(msg23514),
  true,
);
verificar(
  "H9. e NÃO afirma que o colaborador está fora da equipe",
  /fora da equipe|não pertence/.test(msg23514),
  false,
);

verificar(
  "H10. 22023 fala de dados inválidos",
  /Dados do apontamento inválidos/.test(mensagemDeErro({ code: "22023" })),
  true,
);
verificar(
  "H11. 23505 é conflito genérico",
  /registro conflitante/.test(mensagemDeErro({ code: "23505" })),
  true,
);
verificar(
  "H12. e não afirma diária duplicada na data",
  /diária|mesma data/i.test(mensagemDeErro({ code: "23505" })),
  false,
);
verificar(
  "H13. erro sem código cai na mensagem dele",
  mensagemDeErro(new Error("rede caiu")),
  "rede caiu",
);
verificar(
  "H14. erro sem código e sem mensagem tem texto de reserva",
  mensagemDeErro({}),
  "Não foi possível salvar o apontamento. Tente novamente.",
);
verificar(
  "H15. a tradução NÃO classifica por texto da exceção",
  /message\.includes|message\.match|\.message\s*===/.test(fontes.dominio),
  false,
);
verificar(
  "H16. ela decide por code, e por mais nada",
  /switch \(codigo\)/.test(fontes.dominio),
  true,
);
verificar(
  "H17. o erro do salvar passa pela tradução",
  /onError: \(erro\) => toast\.error\(mensagemDeErro\(erro\)\)/.test(fontes.tela),
  true,
);
verificar(
  "H18. e o rascunho não é limpo no erro",
  /onError:[^}]*setRascunho/.test(fontes.tela),
  false,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
