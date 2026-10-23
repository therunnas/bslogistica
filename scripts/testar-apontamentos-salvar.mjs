/**
 * Salvamento de apontamentos: payload limpo (U1) e só linhas alteradas (U2) — C05-B4.3A.
 *
 * COMO RODAR:
 *
 *   npm run test:apontamentos-salvar
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo TypeScript direto
 * via `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha. Não
 * usa rede nem banco.
 *
 * TRÊS METADES:
 *
 *   - comportamento das funções puras de `src/lib/apontamentos-salvar.ts`: o que é uma linha
 *     alterada, quais linhas entram no salvamento e exatamente quais colunas vão no upsert;
 *   - forma literal da tela, porque ela não se observa de fora sem navegador: a tela monta a
 *     carga por essas funções, não envia valor derivado e mostra o erro do banco;
 *   - tradução dos erros financeiros conhecidos, para o administrador e para o operador.
 *
 * O QUE ESTA SUÍTE NÃO PROVA: o banco. O comportamento do upsert contra o PostgREST real
 * (linha nova junto de existente, nota, horário, status, sem alteração, taxa reajustada) foi
 * medido à parte, num PostgREST local, e o do banco é da suíte SQL
 * `supabase/tests/020_apontamentos_upsert.sql`.
 */

import { readdirSync, readFileSync } from "node:fs";

import {
  COLUNAS_ENVIADAS,
  colaboradoresFaturados,
  linhaFoiAlterada,
  linhaGravadaFoiAlterada,
  linhasParaSalvar,
  montarCarga,
  soHoraEMinuto,
} from "../src/lib/apontamentos-salvar.ts";
import { valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";
import { mensagemDoErro } from "../src/lib/erros-banco.ts";
import { mensagemDeErro } from "../src/app/(painel)/operacional/_dominio.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const igual = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (igual) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    const detalhe = `esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`;
    falhas.push(`${caso} — ${detalhe}`);
    console.log(`  FAIL  ${caso} — ${detalhe}`);
  }
}

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const gravado = (extra = {}) => ({
  id: "e1",
  employee_id: "c1",
  status: "present",
  check_in: "06:00:00",
  check_out: "15:00:00",
  break_minutes: 60,
  notes: null,
  invoice_id: null,
  ...extra,
});
const linha = (extra = {}) => ({
  employeeId: "c1",
  entryId: "e1",
  status: "present",
  checkIn: "06:00",
  checkOut: "15:00",
  breakMinutes: 60,
  notes: "",
  ...extra,
});

// ---------------------------------------------------------------------------
// A. Linha alterada
// ---------------------------------------------------------------------------

console.log("A. Uma linha foi alterada?");

verificar(
  "A1. igual ao servidor (06:00 = 06:00:00, nota nula = vazia): não",
  linhaFoiAlterada(linha(), gravado()),
  false,
);
verificar(
  "A2. horário de entrada diferente: sim",
  linhaFoiAlterada(linha({ checkIn: "06:30" }), gravado()),
  true,
);
verificar(
  "A3. horário de saída diferente: sim",
  linhaFoiAlterada(linha({ checkOut: "18:00" }), gravado()),
  true,
);
verificar(
  "A4. intervalo diferente: sim",
  linhaFoiAlterada(linha({ breakMinutes: 30 }), gravado()),
  true,
);
verificar(
  "A5. status diferente: sim",
  linhaFoiAlterada(linha({ status: "replacement" }), gravado()),
  true,
);
verificar(
  "A6. só a nota diferente: sim",
  linhaFoiAlterada(linha({ notes: "chegou atrasado" }), gravado()),
  true,
);
verificar(
  "A7. nota apagada (era texto, agora vazia): sim",
  linhaFoiAlterada(linha({ notes: "" }), gravado({ notes: "x" })),
  true,
);
verificar(
  "A8. nota com espaço no fim é diferente (não se apara em silêncio): sim",
  linhaFoiAlterada(linha({ notes: "x " }), gravado({ notes: "x" })),
  true,
);
verificar(
  "A9. falta com os horários da tela preenchidos, servidor sem horário: não (falta não grava horário)",
  linhaFoiAlterada(
    linha({ status: "absent", checkIn: "06:00", checkOut: "15:00" }),
    gravado({ status: "absent", check_in: null, check_out: null }),
  ),
  false,
);
verificar("A10. virar falta: sim", linhaFoiAlterada(linha({ status: "absent" }), gravado()), true);
verificar(
  "A11. intervalo NaN na tela conta como 0 e difere de 60: sim",
  linhaFoiAlterada(linha({ breakMinutes: Number.NaN }), gravado()),
  true,
);
verificar(
  "A12. horário do servidor nulo e campo vazio na tela: não",
  linhaFoiAlterada(
    linha({ checkIn: "", checkOut: "" }),
    gravado({ check_in: null, check_out: null }),
  ),
  false,
);
verificar(
  "A13. soHoraEMinuto normaliza HH:MM:SS e nulo",
  [
    soHoraEMinuto("08:00:00"),
    soHoraEMinuto("08:00"),
    soHoraEMinuto(null),
    soHoraEMinuto(undefined),
  ],
  ["08:00", "08:00", "", ""],
);

// ---------------------------------------------------------------------------
// B. Quais linhas entram no salvamento
// ---------------------------------------------------------------------------

console.log("B. Quais linhas entram");

const ids = (lista) => lista.map((l) => l.employeeId);
const tres = [
  linha({ employeeId: "c1", entryId: "e1" }),
  linha({ employeeId: "c2", entryId: "e2" }),
  linha({ employeeId: "c3", entryId: undefined }),
];
const servidor = [gravado(), gravado({ id: "e2", employee_id: "c2" })];

verificar(
  "B1. nada tocado: só a linha nova entra",
  ids(linhasParaSalvar(tres, new Set(), servidor)),
  ["c3"],
);
verificar(
  "B2. linha existente tocada mas IDÊNTICA ao servidor (só recebeu foco): não entra",
  ids(linhasParaSalvar(tres, new Set(["c1"]), servidor)),
  ["c3"],
);
verificar(
  "B3. linha existente tocada e alterada: entra, junto da nova",
  ids(linhasParaSalvar([linha({ notes: "oi" }), tres[1], tres[2]], new Set(["c1"]), servidor)),
  ["c1", "c3"],
);
verificar(
  "B4. linha alterada mas NÃO tocada (mudança vinda de uma releitura): não entra",
  ids(linhasParaSalvar([linha({ notes: "oi" }), tres[1], tres[2]], new Set(), servidor)),
  ["c3"],
);
verificar(
  "B5. as duas existentes alteradas e tocadas, mais a nova: as três entram, na ordem",
  ids(
    linhasParaSalvar(
      [
        linha({ checkOut: "16:00" }),
        linha({ employeeId: "c2", entryId: "e2", status: "absent" }),
        tres[2],
      ],
      new Set(["c1", "c2"]),
      servidor,
    ),
  ),
  ["c1", "c2", "c3"],
);
verificar(
  "B6. linha faturada nunca entra, mesmo tocada e alterada",
  ids(
    linhasParaSalvar([linha({ notes: "mudou" })], new Set(["c1"]), [
      gravado({ invoice_id: "fat-1" }),
    ]),
  ),
  [],
);
verificar(
  "B7. servidor sem a linha (leitura velha): a tocada entra, porque não há como provar que é idêntica",
  ids(linhasParaSalvar([linha()], new Set(["c1"]), [])),
  ["c1"],
);
verificar("B8. lista vazia: nada", linhasParaSalvar([], new Set(["c1"]), servidor), []);
verificar(
  "B9. colaboradores faturados",
  [
    ...colaboradoresFaturados([
      gravado({ invoice_id: "f" }),
      gravado({ id: "e2", employee_id: "c2" }),
    ]),
  ],
  ["c1"],
);
verificar(
  "B10. só a nota mudou: a linha entra, e a carga dela leva só colunas editáveis (nada financeiro é reenviado)",
  Object.keys(
    montarCarga(
      linhasParaSalvar([linha({ notes: "oi" })], new Set(["c1"]), servidor)[0],
      { timesheetId: "f1", operationId: "o1", workDate: "2026-02-10" },
      () => "novo",
    ),
  ).sort(),
  [...COLUNAS_ENVIADAS].sort(),
);

// ---------------------------------------------------------------------------
// C. A carga do upsert
// ---------------------------------------------------------------------------

console.log("C. A carga");

const contexto = { timesheetId: "f1", operationId: "o1", workDate: "2026-02-10" };
let geradas = 0;
const gerar = () => `novo-${++geradas}`;
const existente = montarCarga(linha({ notes: "oi" }), contexto, gerar);
const geradasAposExistente = geradas;
const nova = montarCarga(linha({ entryId: undefined, employeeId: "c9" }), contexto, gerar);
const ausente = montarCarga(linha({ status: "absent", notes: "" }), contexto, gerar);

verificar(
  "C1. as colunas da carga são exatamente as editáveis mais o contexto da folha",
  Object.keys(existente),
  [...COLUNAS_ENVIADAS],
);
verificar(
  "C2. COLUNAS_ENVIADAS",
  [...COLUNAS_ENVIADAS],
  [
    "id",
    "timesheet_id",
    "employee_id",
    "operation_id",
    "work_date",
    "status",
    "check_in",
    "check_out",
    "break_minutes",
    "notes",
  ],
);
const PROIBIDAS = [
  "billed_amount",
  "cost_amount",
  "worked_minutes",
  "overtime_minutes",
  "daily_rate_snapshot",
  "ot_hour_rate_snapshot",
  "daily_cost_snapshot",
  "invoice_id",
  "contract_terms_id",
  "employee_cost_terms_id",
  "operation_terms_id",
  "shift_hours_snapshot",
  "ot_factor_snapshot",
  "ot_tolerance_snapshot",
  "planned_minutes_snapshot",
  "terms_origin",
  "created_at",
  "updated_at",
];
verificar(
  "C3. nenhuma coluna derivada, snapshot, referência de versão, vínculo de fatura ou metadado na carga",
  PROIBIDAS.filter((c) => c in existente || c in nova || c in ausente),
  [],
);
verificar(
  "C4. linha existente mantém o próprio id e não gera outro",
  [existente.id, geradasAposExistente],
  ["e1", 0],
);
verificar(
  "C5. linha nova ganha id gerado (uma geração por linha nova)",
  [nova.id, geradas],
  ["novo-1", 1],
);
verificar(
  "C6. TODAS as linhas têm as mesmas chaves (o PostgREST une as chaves e põe NULL na ausente)",
  [Object.keys(existente), Object.keys(ausente)],
  [Object.keys(nova), Object.keys(nova)],
);
verificar(
  "C7. horários saem como HH:MM:00",
  [existente.check_in, existente.check_out],
  ["06:00:00", "15:00:00"],
);
verificar("C8. falta não grava horário", [ausente.check_in, ausente.check_out], [null, null]);
verificar(
  "C9. nota vazia vira NULL; nota com texto é mantida",
  [ausente.notes, existente.notes],
  [null, "oi"],
);
verificar(
  "C10. folha e colaborador vão na carga",
  [existente.timesheet_id, existente.employee_id, existente.operation_id, existente.work_date],
  ["f1", "c1", "o1", "2026-02-10"],
);
verificar(
  "C11. horário vazio fora de falta vira NULL",
  [
    montarCarga(linha({ checkIn: "", checkOut: "" }), contexto, gerar).check_in,
    montarCarga(linha({ checkIn: "", checkOut: "" }), contexto, gerar).check_out,
  ],
  [null, null],
);
verificar(
  "C12. intervalo NaN vira 0 (nunca NULL)",
  montarCarga(linha({ breakMinutes: Number.NaN }), contexto, gerar).break_minutes,
  0,
);
verificar(
  "C13. entrada vinda do servidor com segundos não gera 06:00:00:00",
  montarCarga(linha({ checkIn: "06:00:00" }), contexto, gerar).check_in,
  "06:00:00",
);

// ---------------------------------------------------------------------------
// D. Forma da tela
// ---------------------------------------------------------------------------

console.log("D. Forma da tela");

const tela = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
const telaSemComentarios = semComentarios(tela);
const salvar = telaSemComentarios.slice(
  telaSemComentarios.indexOf("const saveAll = useMutation("),
  telaSemComentarios.indexOf("const toggleStatus = useMutation("),
);

verificar(
  "D1. a tela importa as funções do módulo",
  /from "@\/lib\/apontamentos-salvar"/.test(tela) &&
    ["linhasParaSalvar", "montarCarga", "colaboradoresFaturados"].every((n) => tela.includes(n)),
  true,
);
verificar("D2. o salvamento monta a carga por montarCarga", /montarCarga\(/.test(salvar), true);
verificar(
  "D3. o salvamento não envia nenhum valor derivado nem snapshot (nem lê o cálculo da prévia)",
  [
    "billed_amount",
    "cost_amount",
    "worked_minutes",
    "overtime_minutes",
    "daily_rate_snapshot",
    "ot_hour_rate_snapshot",
    "daily_cost_snapshot",
    "calc.",
  ].filter((c) => salvar.includes(c)),
  [],
);
verificar(
  "D4. continua usando upsert numa só chamada (atômico)",
  (salvar.match(/\.upsert\(/g) ?? []).length === 1 && /\.upsert\(payload\)/.test(salvar),
  true,
);
verificar(
  "D5. o id das linhas novas vem de crypto.randomUUID",
  /globalThis\.crypto\.randomUUID\(\)/.test(salvar),
  true,
);
verificar(
  "D6. quais linhas salvar vem de linhasParaSalvar, e não de 'dirty' sozinho",
  /linhasParaSalvar\(/.test(telaSemComentarios) &&
    !/!row\.entryId \|\| \(draft\?\.dirty/.test(telaSemComentarios),
  true,
);
verificar(
  "D7. o erro mostrado vem de mensagemDoErro (e não de um texto genérico que esconde o motivo)",
  /toast\.error\(mensagemDoErro\(error\)\)/.test(salvar),
  true,
);
verificar(
  "D8. linha faturada tem os campos desabilitados",
  (telaSemComentarios.match(/faturados\.has\(row\.employeeId\)/g) ?? []).length === 4,
  true,
);
verificar(
  "D9. o rascunho continua guardando as linhas tocadas (nada digitado é perdido numa releitura)",
  /dirty\.add\(employeeId\)/.test(telaSemComentarios) &&
    /atual\.dirty\.has\(linha\.employeeId\)/.test(telaSemComentarios),
  true,
);
verificar(
  "D10. depois de salvar, as linhas tocadas são limpas e as consultas relidas",
  /dirty: new Set<string>\(\)/.test(telaSemComentarios) &&
    /invalidateQueries\(\{\s*queryKey: \["timesheet_entries"\]/.test(telaSemComentarios),
  true,
);
verificar(
  "D11. COMPATIBILIDADE com Production: a tela não chama RPC nem tabela das migrations 021 a 024",
  [
    "contract_terms",
    "employee_cost_terms",
    "operation_terms",
    "financial_terms_audit",
    "registrar_",
    "corrigir_",
    "valor_acordado",
    "_na_data",
    ".rpc(",
  ].filter((c) => telaSemComentarios.includes(c)),
  [],
);
const modulo = ler("src/lib/apontamentos-salvar.ts");
verificar(
  "D12. o módulo não importa nada em tempo de execução (só tipos)",
  (modulo.match(/^import (?!type)/gm) ?? []).length,
  0,
);
verificar(
  "D13. o módulo não cita tabela nem RPC das migrations 021 a 024 no código",
  ["contract_terms", "employee_cost_terms", "operation_terms", ".rpc("].filter((c) =>
    semComentarios(modulo).includes(c),
  ),
  [],
);

// ---------------------------------------------------------------------------
// E. Erros financeiros
// ---------------------------------------------------------------------------

console.log("E. Mensagens de erro");

const PT_SEM_VIGENCIA =
  "Sem condições contratuais vigentes em 2026-01-05 para o contrato informado.";
verificar(
  "E1. P0002 em português do projeto é mantido",
  mensagemDoErro({ code: "P0002", message: PT_SEM_VIGENCIA }),
  PT_SEM_VIGENCIA,
);
verificar(
  "E2. P0002 cru (inglês) vira texto genérico",
  /vigência/.test(mensagemDoErro({ code: "P0002", message: "no data found" })) ||
    /Não há registro/.test(mensagemDoErro({ code: "P0002", message: "relation does not exist" })),
  true,
);
verificar(
  "E3. 55000 em português é mantido",
  mensagemDoErro({ code: "55000", message: "A versão já está aposentada." }),
  "A versão já está aposentada.",
);
verificar(
  "E4. 55000 cru vira texto genérico",
  mensagemDoErro({ code: "55000", message: "object not in prerequisite state: violates" }),
  "Esta operação não é possível no estado atual do registro.",
);
verificar(
  "E5. 23P01 cru do PostgreSQL vira texto genérico",
  mensagemDoErro({
    code: "23P01",
    message: 'conflicting key value violates exclusion constraint "x"',
  }),
  "O período informado se sobrepõe a outro já cadastrado.",
);
verificar(
  "E6. 23P01 da RPC (português) é mantido",
  mensagemDoErro({
    code: "23P01",
    message: "A vigência informada se sobrepõe a outra versão ativa deste contrato.",
  }),
  "A vigência informada se sobrepõe a outra versão ativa deste contrato.",
);
verificar(
  "E7. 22023 cru vira texto genérico",
  mensagemDoErro({ code: "22023", message: "invalid input value" }),
  "Valor ou período inválido. Revise os campos informados.",
);
verificar(
  "E8. 23514 cru vira texto genérico",
  mensagemDoErro({ code: "23514", message: 'new row violates check constraint "c"' }),
  "Os dados informados não atendem a uma regra de validação.",
);
verificar(
  "E9. 23514 do congelamento de turno (português) é mantido",
  mensagemDoErro({
    code: "23514",
    message:
      "Este turno já tem apontamentos; cadastre um turno novo em vez de alterar o horário do existente.",
  }).startsWith("Este turno já tem apontamentos"),
  true,
);
verificar(
  "E10. 42501 continua devolvendo o texto de sempre (contrato anterior preservado)",
  mensagemDoErro({
    code: "42501",
    message:
      "Valores financeiros do apontamento são calculados pelo sistema e não podem ser alterados diretamente.",
  }),
  "Valores financeiros do apontamento são calculados pelo sistema e não podem ser alterados diretamente.",
);
verificar(
  "E11. código desconhecido continua mostrando o texto do banco (nada é escondido)",
  mensagemDoErro({ code: "XX000", message: "algo inesperado" }),
  "algo inesperado",
);
verificar(
  "E12. sem código e sem mensagem: texto padrão",
  mensagemDoErro({}),
  "Não foi possível concluir a operação.",
);
verificar(
  "E13. nenhuma mensagem genérica carrega número, moeda ou taxa",
  ["P0002", "55000", "23P01", "22023", "23514"]
    .map((c) => mensagemDoErro({ code: c, message: "violates" }))
    .filter((m) => /R\$|\d/.test(m)),
  [],
);
// Operador
const comValor = "Sem condições vigentes: diária R$ 120,00, custo R$ 80,00";
verificar(
  "E14. operador: P0002 tem texto fixo e não ecoa a mensagem do banco",
  mensagemDeErro({ code: "P0002", message: comValor }),
  "Não há condições financeiras cadastradas para esta data. Avise o administrador.",
);
verificar(
  "E15. operador: 55000 tem texto fixo",
  /não pode ser alterado no estado atual/.test(
    mensagemDeErro({ code: "55000", message: comValor }),
  ),
  true,
);
verificar(
  "E16. operador: 23P01 tem texto fixo",
  /conflito no cadastro/.test(mensagemDeErro({ code: "23P01", message: comValor })),
  true,
);
verificar(
  "E17. operador: nenhum desses textos contém valor, moeda ou a mensagem original",
  ["P0002", "55000", "23P01"]
    .map((c) => mensagemDeErro({ code: c, message: comValor }))
    .filter((m) => /R\$|\d|diária|custo/i.test(m)),
  [],
);
verificar(
  "E18. operador: os códigos antigos seguem iguais",
  [
    mensagemDeErro({ code: "23505" }).includes("registro conflitante"),
    mensagemDeErro({ code: "22023" }).includes("inválidos"),
  ],
  [true, true],
);

// ---------------------------------------------------------------------------
// F. Scripts e CI
// ---------------------------------------------------------------------------

console.log("F. Scripts e CI");

const pacote = JSON.parse(ler("package.json"));
verificar(
  "F1. o script test:apontamentos-salvar existe",
  typeof pacote.scripts["test:apontamentos-salvar"],
  "string",
);
const ci = ler(".github/workflows/ci.yml");
verificar("F2. o CI executa a suíte nova", /npm run test:apontamentos-salvar/.test(ci), true);
verificar(
  "F3. o CI conserva todas as suítes de package.json",
  Object.keys(pacote.scripts)
    .filter((n) => n.startsWith("test:"))
    .every((n) => ci.includes(`npm run ${n}`)),
  true,
);
verificar(
  "F4. a correção do salvamento não depende de migration: as 021 a 024 existem e a única 026 é a do cadastro atômico",
  ["_021_", "_022_", "_023_", "_024_"].every((n) =>
    readdirSync(new URL("../supabase/migrations/", import.meta.url)).some((a) => a.includes(n)),
  ) &&
    readdirSync(new URL("../supabase/migrations/", import.meta.url))
      .filter((a) => a.includes("_026_"))
      .every((a) => a.endsWith("_026_cadastro_atomico_com_vigencia.sql")),
  true,
);

const CAMINHO_SQL = "supabase/tests/020_apontamentos_upsert.sql";
const sql = ler(CAMINHO_SQL);
verificar(
  "F5. a suíte SQL do upsert existe e é transacional (termina em rollback, nunca confirma)",
  /^begin;/m.test(sql) &&
    /rollback;\s*$/.test(sql) &&
    !/(?<!on )\bcommit\b/i.test(sql.replace(/^\s*--.*$/gm, "")),
  true,
);
verificar(
  "F6. a suíte SQL falha de verdade quando um caso falha",
  /raise exception '020_apontamentos_upsert/.test(sql),
  true,
);
verificar(
  "F7. a suíte SQL cobre carga nova, lote misto, só nota, horário, status, sem alteração, reajuste, carga antiga, faturado e permissões",
  [
    "N1.",
    "N2.",
    "N3.",
    "N4.",
    "N5.",
    "N7.",
    "N8.",
    "D1.",
    "D2.",
    "D3.",
    "D4.",
    "M1.",
    "F1.",
    "F3.",
    "P1.",
    "P2.",
  ].every((r) => sql.includes(`registrar('${r}`)),
  true,
);
verificar(
  "F8. a suíte SQL não usa nenhuma tabela nem função das migrations 021 a 024 (vale para Production e para a homologação)",
  [
    "contract_terms",
    "employee_cost_terms",
    "operation_terms",
    "financial_terms_audit",
    "registrar_condicao",
    "_na_data",
  ].filter((c) => sql.replace(/^\s*--.*$/gm, "").includes(c)),
  [],
);

// ---------------------------------------------------------------------------
// G. Alteração real, não interação (achado P2 do PR #68)
// ---------------------------------------------------------------------------

console.log("G. Alteração real, não interação");

const nenhuma = new Set();
const tocou = (...ids) => new Set(ids);

verificar(
  "G1. linha gravada sem edição: não foi alterada",
  linhaGravadaFoiAlterada(linha(), nenhuma, gravado()),
  false,
);
verificar(
  "G2. linha gravada, editada e DEVOLVIDA ao original: tocada, mas não alterada",
  linhaGravadaFoiAlterada(linha({ checkOut: "15:00" }), tocou("c1"), gravado()),
  false,
);
verificar(
  "G3. a normalização do horário vale (08:00 = 08:00:00; nota nula = nota vazia)",
  linhaGravadaFoiAlterada(
    linha({ checkIn: "06:00", checkOut: "15:00", notes: "" }),
    tocou("c1"),
    gravado({ check_in: "06:00:00", check_out: "15:00:00", notes: null }),
  ),
  false,
);
verificar(
  "G4. alteração real de horário, intervalo, nota e status: alterada",
  [
    linhaGravadaFoiAlterada(linha({ checkOut: "16:00" }), tocou("c1"), gravado()),
    linhaGravadaFoiAlterada(linha({ breakMinutes: 30 }), tocou("c1"), gravado()),
    linhaGravadaFoiAlterada(linha({ notes: "atraso" }), tocou("c1"), gravado()),
    linhaGravadaFoiAlterada(linha({ status: "absent" }), tocou("c1"), gravado()),
  ],
  [true, true, true, true],
);
verificar(
  "G5. editar sem tocar (estado inconsistente) não vale como alteração; linha nova não é 'gravada'",
  [
    linhaGravadaFoiAlterada(linha({ checkOut: "16:00" }), nenhuma, gravado()),
    linhaGravadaFoiAlterada(linha({ entryId: undefined }), tocou("c1"), undefined),
  ],
  [false, false],
);
verificar(
  "G6. o servidor não tem mais a linha (leitura velha): vale como alterada, como no salvamento",
  linhaGravadaFoiAlterada(linha(), tocou("c1"), undefined),
  true,
);

const tresLinhas = [
  linha({ employeeId: "c1", entryId: "e1" }), // tocada e devolvida ao original
  linha({ employeeId: "c2", entryId: "e2", checkOut: "17:00" }), // alteração real
  linha({ employeeId: "c3", entryId: "e3" }), // não tocada
];
const tresGravados = [
  gravado({ id: "e1", employee_id: "c1" }),
  gravado({ id: "e2", employee_id: "c2" }),
  gravado({ id: "e3", employee_id: "c3" }),
];
const tocadas3 = tocou("c1", "c2");
verificar(
  "G7. várias linhas, algumas devolvidas ao original: só a alteração real é alterada",
  tresLinhas.map((l, i) => linhaGravadaFoiAlterada(l, tocadas3, tresGravados[i])),
  [false, true, false],
);
verificar(
  "G8. o salvamento envia exatamente as linhas que o critério chama de alteradas",
  [
    linhasParaSalvar(tresLinhas, tocadas3, tresGravados).map((l) => l.employeeId),
    tresLinhas
      .filter((l, i) => linhaGravadaFoiAlterada(l, tocadas3, tresGravados[i]))
      .map((l) => l.employeeId),
  ].map((ids) => ids.join(",")),
  ["c2", "c2"],
);

// O valor mostrado e o bloqueio do salvamento usam o mesmo critério (legado com o motor ligado).
const LIGADO = { tag: "ligado", ativadaEm: null };
const DESLIGADO = { tag: "desligado" };
const CALC = () => ({ billedAmount: 1, costAmount: 1, overtimeMinutes: 0 });
const LEGADO = {
  status: "present",
  billed_amount: 137.5,
  cost_amount: 87.5,
  overtime_minutes: 0,
  daily_rate_snapshot: 100,
  daily_cost_snapshot: 70,
  shift_hours_snapshot: null,
  ot_factor_snapshot: 1,
  ot_tolerance_snapshot: 10,
  planned_minutes_snapshot: null,
  terms_origin: null,
};
const valor = (estado, tocada) =>
  valorDaLinha({
    estado,
    status: "present",
    gravada: true,
    tocada,
    gravado: LEGADO,
    regrasDoCadastro: { daily_rate: 999, shift_hours: 8, ot_factor: 3, ot_tolerance_min: 10 },
    custoDoCadastro: 555,
    condicaoDoDia: null,
    plannedMinutes: 480,
    calcular: CALC,
  });
const devolvida = linhaGravadaFoiAlterada(linha(), tocou("c1"), gravado());
const editada = linhaGravadaFoiAlterada(linha({ checkOut: "16:00" }), tocou("c1"), gravado());
const v1 = valor(LIGADO, devolvida);
verificar(
  "G9. motor LIGADO, legado editado e devolvido ao original: mostra o banco e NÃO bloqueia o salvamento",
  [v1.tipo, v1.billed, v1.bloqueiaSalvar],
  ["banco", 137.5, false],
);
const v2 = valor(LIGADO, editada);
verificar(
  "G10. motor LIGADO, legado com alteração real: continua indisponível e bloqueado",
  [v2.tipo, v2.bloqueiaSalvar],
  ["indisponivel", true],
);
const v3 = valor(DESLIGADO, devolvida);
const v4 = valor(DESLIGADO, editada);
verificar(
  "G11. motor DESLIGADO: a prévia de sempre, igual com ou sem alteração, sem bloqueio",
  [v3.tipo, v3.bloqueiaSalvar, v4.tipo, v4.bloqueiaSalvar, v3.billed === v4.billed],
  ["previa", false, "previa", false, true],
);

const telaApontamentos = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
verificar(
  "G12. a tela passa à prévia de preço a alteração real (mesma função do salvamento), não o conjunto 'tocadas'",
  /tocada: linhaGravadaFoiAlterada\(row, draft\?\.dirty \?\? new Set<string>\(\), gravado \?\? undefined\)/.test(
    telaApontamentos,
  ) && !/tocada: draft\?\.dirty\.has/.test(telaApontamentos),
  true,
);
verificar(
  "G13. linhasParaSalvar usa o mesmo critério (uma definição só de 'alterada')",
  /return linhaGravadaFoiAlterada\(linha, tocadas, gravado\);/.test(
    ler("src/lib/apontamentos-salvar.ts"),
  ),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
