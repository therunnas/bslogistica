/**
 * Testes da camada de dados operacional AAL1 (B2.1).
 *
 * COMO RODAR:
 *
 *   npm run test:operacional
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * DUAS METADES, E ELAS SE COMPLETAM:
 *
 *   - forma literal dos arquivos (blocos A e B), para o que não se observa de
 *     fora: que a camada não abre `from(...)`, não importa cálculo financeiro,
 *     não nomeia coluna proibida e que os hooks travam a chamada com os
 *     predicados certos. O projeto já asseve forma literal nas suítes de auth,
 *     pelo mesmo motivo — é o que impede uma regressão de passar por reescrita
 *     silenciosa. Vêm primeiro de propósito: não dependem de nada e continuam
 *     valendo mesmo que a metade seguinte estoure;
 *   - comportamento (blocos C a H), com um cliente falso injetado: nomes das
 *     RPCs, parâmetros, recusa de chamada incompleta, forma do payload e
 *     propagação de erro. Nada de rede, nada de banco, nada de navegador.
 */

import { readFileSync } from "node:fs";

import { chavesOperacionais, RAIZ_OPERACIONAL } from "../src/lib/operacional/chaves.ts";
import {
  buscarApontamentosDoOperador,
  buscarEquipeDoOperador,
  buscarOperacoesDoOperador,
  buscarTurnosDoOperador,
  CAMPOS_DA_LINHA,
  montarLinhasDoApontamento,
  podeListarApontamentos,
  podeListarEquipe,
  podeListarTurnos,
  RPC_OPERACIONAL,
  salvarApontamentoOperacional,
} from "../src/lib/operacional/rpc.ts";

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

/** Executa e devolve a mensagem do erro, ou `null` se não levantou. */
async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  }
}

/**
 * Cliente falso.
 *
 * `from` existe só para explodir: se alguma leitura desta camada trocar a RPC
 * por acesso direto à tabela, o teste falha em vez de passar em silêncio.
 */
function clienteFalso(resposta = { data: [], error: null }) {
  const chamadas = [];
  return {
    chamadas,
    rpc(nome, parametros) {
      chamadas.push({ nome, parametros });
      return Promise.resolve(resposta);
    },
    from() {
      throw new Error("acesso direto a tabela no caminho operacional");
    },
  };
}

const OPERACAO = "11111111-1111-1111-1111-111111111111";
const TURNO = "22222222-2222-2222-2222-222222222222";
const OUTRO_TURNO = "33333333-3333-3333-3333-333333333333";
const COLABORADOR = "44444444-4444-4444-4444-444444444444";
const DATA = "2026-09-18";

const fontes = Object.fromEntries(
  ["tipos", "chaves", "rpc", "queries", "mutations"].map((nome) => [
    nome,
    readFileSync(new URL(`../src/lib/operacional/${nome}.ts`, import.meta.url), "utf8"),
  ]),
);
const todasAsFontes = Object.values(fontes).join("\n");

console.log("\nA. A camada não alcança tabela, financeiro nem o caminho do admin\n");

verificar("A1. nenhum from(...) na camada operacional", /\.from\s*\(/.test(todasAsFontes), false);
verificar(
  "A2. nenhum select(...) na camada operacional",
  /\.select\s*\(/.test(todasAsFontes),
  false,
);
verificar(
  "A3. não importa o cálculo financeiro",
  /from\s+"[^"]*billing"/.test(todasAsFontes),
  false,
);
verificar("A4. não importa o ledger", /from\s+"[^"]*ledger"/.test(todasAsFontes), false);
verificar(
  "A5. não importa os hooks administrativos",
  /from\s+"@\/lib\/(queries|mutations)"/.test(todasAsFontes),
  false,
);

for (const coluna of [
  "billed_amount",
  "cost_amount",
  "invoice_id",
  "daily_cost",
  "daily_rate",
  "agreed_amount",
  "shift_hours",
  "ot_factor",
  "ot_tolerance_min",
]) {
  verificar(
    `A6.${coluna} — a camada não nomeia a coluna em lugar nenhum`,
    new RegExp(`\\b${coluna}\\b`).test(todasAsFontes),
    false,
  );
}

verificar(
  "A7. não menciona a tabela de contratos",
  /["'`]contracts["'`]/.test(todasAsFontes),
  false,
);
verificar(
  "A8. cinco chamadas de banco, uma por RPC do contrato",
  (todasAsFontes.match(/cliente\.rpc\(/g) ?? []).length,
  5,
);
verificar(
  "A9. e cada nome de RPC vem da constante, nunca escrito à mão",
  /cliente\.rpc\("/.test(todasAsFontes),
  false,
);

console.log("\nB. Os hooks travam a chamada e invalidam o contexto certo\n");

verificar(
  "B1. o hook de turnos usa o predicado de turnos",
  /enabled:\s*podeListarTurnos\(operationId\)/.test(fontes.queries),
  true,
);
verificar(
  "B2. o hook de equipe usa o predicado de equipe",
  /enabled:\s*podeListarEquipe\(operationId,\s*shiftId\)/.test(fontes.queries),
  true,
);
verificar(
  "B3. o hook de apontamentos usa o predicado de apontamentos",
  /enabled:\s*podeListarApontamentos\(operationId,\s*shiftId,\s*workDate\)/.test(fontes.queries),
  true,
);
verificar(
  "B4. só a listagem de operações não tem trava — ela não depende de nada",
  (fontes.queries.match(/enabled:/g) ?? []).length,
  3,
);
verificar(
  "B5. a escrita invalida a chave daquele contexto",
  /chavesOperacionais\.apontamentos\(operationId,\s*shiftId,\s*workDate\)/.test(fontes.mutations),
  true,
);
verificar(
  "B6. e não derruba o cache inteiro",
  (fontes.mutations.match(/invalidateQueries/g) ?? []).length,
  1,
);
verificar(
  "B7. existe uma única mutation nesta camada",
  (fontes.mutations.match(/useMutation\(/g) ?? []).length,
  1,
);
verificar(
  "B8. e ela grava pela RPC de escrita, sem caminho de exclusão",
  /salvarApontamentoOperacional\(clienteOperacional\(\), escrita\)/.test(fontes.mutations),
  true,
);
verificar(
  "B9. a camada não decide autorização — quem decide é o banco",
  /getAuthenticatorAssuranceLevel\(|\.nextLevel|has_role\(|is_staff\(/.test(todasAsFontes),
  false,
);
console.log("\nC. As quatro leituras falam por RPC, e só por RPC\n");

{
  const cliente = clienteFalso();
  await buscarOperacoesDoOperador(cliente);
  verificar(
    "C1. operações chamam a RPC do contrato",
    cliente.chamadas[0].nome,
    RPC_OPERACIONAL.operacoes,
  );
  verificar("C2. operações não recebem parâmetro", cliente.chamadas[0].parametros, undefined);
}

{
  const cliente = clienteFalso();
  await buscarTurnosDoOperador(cliente, OPERACAO);
  verificar(
    "C3. turnos chamam a RPC do contrato",
    cliente.chamadas[0].nome,
    RPC_OPERACIONAL.turnos,
  );
  verificar(
    "C4. turnos passam a operação",
    cliente.chamadas[0].parametros.p_operation_id,
    OPERACAO,
  );
  verificar(
    "C5. turnos não passam mais nada",
    Object.keys(cliente.chamadas[0].parametros).join(","),
    "p_operation_id",
  );
}

{
  const cliente = clienteFalso();
  await buscarEquipeDoOperador(cliente, OPERACAO, TURNO);
  verificar("C6. equipe chama a RPC do contrato", cliente.chamadas[0].nome, RPC_OPERACIONAL.equipe);
  verificar(
    "C7. equipe passa operação e turno, nessa ordem",
    Object.keys(cliente.chamadas[0].parametros).join(","),
    "p_operation_id,p_shift_id",
  );
}

{
  const cliente = clienteFalso();
  await buscarApontamentosDoOperador(cliente, OPERACAO, TURNO, DATA);
  verificar(
    "C8. apontamentos chamam a RPC do contrato",
    cliente.chamadas[0].nome,
    RPC_OPERACIONAL.apontamentos,
  );
  verificar(
    "C9. apontamentos passam operação, turno e data",
    Object.keys(cliente.chamadas[0].parametros).join(","),
    "p_operation_id,p_shift_id,p_work_date",
  );
  verificar("C10. a data vai como veio", cliente.chamadas[0].parametros.p_work_date, DATA);
}

{
  const cliente = clienteFalso({ data: [{ id: OPERACAO }], error: null });
  const lista = await buscarOperacoesDoOperador(cliente);
  verificar("C11. a resposta chega como lista", lista.length, 1);
}

{
  const cliente = clienteFalso({ data: null, error: null });
  const lista = await buscarOperacoesDoOperador(cliente);
  verificar("C12. resposta nula vira lista vazia, não explode", lista.length, 0);
}

console.log("\nD. A escrita usa salvar_apontamento_operacional\n");

{
  const cliente = clienteFalso({ data: "folha-1", error: null });
  const folha = await salvarApontamentoOperacional(cliente, {
    operationId: OPERACAO,
    shiftId: TURNO,
    workDate: DATA,
    linhas: [{ employee_id: COLABORADOR, status: "present" }],
  });
  verificar(
    "D1. a escrita chama a RPC do contrato",
    cliente.chamadas[0].nome,
    RPC_OPERACIONAL.salvar,
  );
  verificar(
    "D2. a escrita passa os quatro parâmetros da assinatura",
    Object.keys(cliente.chamadas[0].parametros).join(","),
    "p_operation_id,p_shift_id,p_work_date,p_linhas",
  );
  verificar("D3. devolve o id da folha que a RPC retornou", folha, "folha-1");
  verificar("D4. nenhuma segunda chamada acontece", cliente.chamadas.length, 1);
}

console.log("\nE. Parâmetro obrigatório impede chamada incompleta\n");

verificar("E1. sem operação não se listam turnos", podeListarTurnos(null), false);
verificar("E2. operação vazia não habilita turnos", podeListarTurnos("   "), false);
verificar("E3. com operação, turnos podem carregar", podeListarTurnos(OPERACAO), true);
verificar("E4. equipe exige os dois identificadores", podeListarEquipe(OPERACAO, null), false);
verificar("E5. equipe com operação e turno carrega", podeListarEquipe(OPERACAO, TURNO), true);
verificar(
  "E6. apontamentos exigem também a data",
  podeListarApontamentos(OPERACAO, TURNO, null),
  false,
);
verificar(
  "E7. apontamentos recusam data fora do formato",
  podeListarApontamentos(OPERACAO, TURNO, "18/09/2026"),
  false,
);
verificar(
  "E8. apontamentos com os três parâmetros carregam",
  podeListarApontamentos(OPERACAO, TURNO, DATA),
  true,
);

{
  const cliente = clienteFalso();
  const erro = await erroDe(() => buscarTurnosDoOperador(cliente, ""));
  verificar(
    "E9. operação vazia levanta antes de chamar",
    erro,
    "Parâmetro obrigatório ausente: operationId.",
  );
  verificar("E10. e nenhuma chamada foi feita ao banco", cliente.chamadas.length, 0);
}

{
  const cliente = clienteFalso();
  const erro = await erroDe(() => buscarEquipeDoOperador(cliente, OPERACAO, ""));
  verificar(
    "E11. turno vazio levanta antes de chamar",
    erro,
    "Parâmetro obrigatório ausente: shiftId.",
  );
  verificar("E12. e nenhuma chamada foi feita ao banco", cliente.chamadas.length, 0);
}

{
  const cliente = clienteFalso();
  const erro = await erroDe(() =>
    buscarApontamentosDoOperador(cliente, OPERACAO, TURNO, "18/09/2026"),
  );
  verificar(
    "E13. data fora do formato levanta antes de chamar",
    erro,
    "Data inválida em workDate: use o formato AAAA-MM-DD.",
  );
  verificar("E14. e nenhuma chamada foi feita ao banco", cliente.chamadas.length, 0);
}

{
  const cliente = clienteFalso();
  const erro = await erroDe(() =>
    salvarApontamentoOperacional(cliente, {
      operationId: OPERACAO,
      shiftId: "",
      workDate: DATA,
      linhas: [{ employee_id: COLABORADOR, status: "present" }],
    }),
  );
  verificar(
    "E15. escrita sem turno levanta antes de chamar",
    erro,
    "Parâmetro obrigatório ausente: shiftId.",
  );
  verificar("E16. e nada foi gravado", cliente.chamadas.length, 0);
}

console.log("\nF. O payload carrega os seis campos, e só eles\n");

verificar("F1. o contrato tem seis campos", CAMPOS_DA_LINHA.length, 6);
verificar(
  "F2. e são exatamente os da migration 013",
  [...CAMPOS_DA_LINHA].join(","),
  "employee_id,status,check_in,check_out,break_minutes,notes",
);

{
  const [linha] = montarLinhasDoApontamento([
    { employee_id: COLABORADOR, status: "present", check_in: "08:00", notes: "chegou cedo" },
  ]);
  verificar("F3. a linha normalizada tem seis chaves", Object.keys(linha).length, 6);
  verificar(
    "F4. e são as seis permitidas",
    Object.keys(linha).sort().join(","),
    [...CAMPOS_DA_LINHA].sort().join(","),
  );
  verificar("F5. campo opcional ausente vira nulo explícito", linha.check_out, null);
  verificar("F6. o que veio preenchido é preservado", linha.check_in, "08:00");
}

for (const proibido of [
  "billed_amount",
  "cost_amount",
  "invoice_id",
  "daily_cost",
  "daily_rate",
  "agreed_amount",
  "timesheet_id",
  "operation_id",
]) {
  const erro = await erroDe(() =>
    montarLinhasDoApontamento([{ employee_id: COLABORADOR, status: "present", [proibido]: 1 }]),
  );
  verificar(
    `F7.${proibido} — chave não autorizada recusa a chamada inteira`,
    erro,
    `Campo não permitido no apontamento: ${proibido}.`,
  );
}

{
  const erro = await erroDe(() => montarLinhasDoApontamento([]));
  verificar("F8. lista vazia não vira chamada", erro, "Nenhuma linha para gravar.");
}

{
  const erro = await erroDe(() => montarLinhasDoApontamento([{ status: "present" }]));
  verificar(
    "F9. linha sem colaborador é recusada",
    erro,
    "Parâmetro obrigatório ausente: employee_id.",
  );
}

{
  const cliente = clienteFalso({ data: "folha-1", error: null });
  await salvarApontamentoOperacional(cliente, {
    operationId: OPERACAO,
    shiftId: TURNO,
    workDate: DATA,
    linhas: [{ employee_id: COLABORADOR, status: "absent" }],
  });
  const enviado = cliente.chamadas[0].parametros.p_linhas[0];
  verificar("F10. o que sobe ao banco tem seis chaves", Object.keys(enviado).length, 6);
  verificar(
    "F11. e nenhuma fora do contrato",
    Object.keys(enviado).every((c) => CAMPOS_DA_LINHA.includes(c)),
    true,
  );
}

console.log("\nG. Erro da RPC é erro, nunca sucesso silencioso\n");

{
  const cliente = clienteFalso({
    data: null,
    error: { message: "Operação não autorizada para esta sessão." },
  });
  const erro = await erroDe(() => buscarTurnosDoOperador(cliente, OPERACAO));
  verificar(
    "G1. recusa de autorização propaga a mensagem",
    erro,
    "Operação não autorizada para esta sessão.",
  );
}

{
  const cliente = clienteFalso({
    data: null,
    error: { message: "Turno informado não pertence à operação." },
  });
  const erro = await erroDe(() => buscarEquipeDoOperador(cliente, OPERACAO, OUTRO_TURNO));
  verificar(
    "G2. turno de outra operação propaga",
    erro,
    "Turno informado não pertence à operação.",
  );
}

{
  const cliente = clienteFalso({
    data: [],
    error: { message: "Folha fechada não recebe apontamento." },
  });
  const erro = await erroDe(() =>
    salvarApontamentoOperacional(cliente, {
      operationId: OPERACAO,
      shiftId: TURNO,
      workDate: DATA,
      linhas: [{ employee_id: COLABORADOR, status: "present" }],
    }),
  );
  verificar(
    "G3. folha fechada propaga em vez de fingir sucesso",
    erro,
    "Folha fechada não recebe apontamento.",
  );
}

{
  const cliente = clienteFalso({ data: [], error: { message: "" } });
  const erro = await erroDe(() => buscarOperacoesDoOperador(cliente));
  verificar(
    "G4. erro sem mensagem ainda é erro",
    erro,
    `Falha na chamada ${RPC_OPERACIONAL.operacoes}.`,
  );
}

console.log("\nH. As chaves de cache isolam operação, turno e data\n");

verificar(
  "H1. tudo começa pela raiz operacional",
  chavesOperacionais.operacoes()[0],
  RAIZ_OPERACIONAL,
);
verificar(
  "H2. a raiz não colide com as chaves do admin",
  ["clients", "operations", "shifts", "timesheets", "timesheet_entries"].includes(RAIZ_OPERACIONAL),
  false,
);
verificar(
  "H3. turnos de operações diferentes têm chaves diferentes",
  JSON.stringify(chavesOperacionais.turnos(OPERACAO)) ===
    JSON.stringify(chavesOperacionais.turnos(TURNO)),
  false,
);
verificar(
  "H4. equipe do mesmo par é a mesma chave",
  JSON.stringify(chavesOperacionais.equipe(OPERACAO, TURNO)) ===
    JSON.stringify(chavesOperacionais.equipe(OPERACAO, TURNO)),
  true,
);
verificar(
  "H5. equipe de turnos diferentes não se confunde",
  JSON.stringify(chavesOperacionais.equipe(OPERACAO, TURNO)) ===
    JSON.stringify(chavesOperacionais.equipe(OPERACAO, OUTRO_TURNO)),
  false,
);
verificar(
  "H6. apontamentos de datas diferentes não se confundem",
  JSON.stringify(chavesOperacionais.apontamentos(OPERACAO, TURNO, DATA)) ===
    JSON.stringify(chavesOperacionais.apontamentos(OPERACAO, TURNO, "2026-09-19")),
  false,
);
verificar(
  "H7. a chave de apontamento carrega os três eixos",
  chavesOperacionais.apontamentos(OPERACAO, TURNO, DATA).length,
  5,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
