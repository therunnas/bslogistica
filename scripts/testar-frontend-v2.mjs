/**
 * GATE-FIN-06 — o aplicativo nos contratos v2 da migration 054 (versão e confirmação de virada).
 *
 *   npm run test:frontend-v2
 *
 * COMPORTAMENTO, não forma: os módulos de dados do administrador (`src/lib/apontamentos-admin-v2.ts`)
 * e do operador (`src/lib/operacional/rpc.ts`, `src/app/(painel)/operacional/_dominio.ts`) recebem o
 * cliente por parâmetro. Aqui recebem um cliente FALSO que registra cada chamada e explode em
 * `from()` (escrita direta seria fallback proibido). Cada caso executa a função de verdade.
 *
 * Os módulos são carregados dinamicamente e cada caso falha sozinho se a exportação não existir: é o
 * que permite medir o RED (app antigo, sem as v2) caso a caso, em vez de um único erro de import.
 * Só o bloco S lê a fonte das telas, para o que não se observa de fora (a caixa de confirmação do
 * operador e o caminho antigo do administrador).
 */

import { readFileSync } from "node:fs";

let passou = 0;
const falhas = [];

async function caso(nome, fn) {
  try {
    await fn();
    passou++;
    console.log(`  PASS  ${nome}`);
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    falhas.push(`${nome} — ${motivo}`);
    console.log(`  FAIL  ${nome} — ${motivo}`);
  }
}

function igual(obtido, esperado, rotulo = "") {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${rotulo ? `${rotulo}: ` : ""}esperado ${b}, obtido ${a}`);
}

async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

async function carregar(caminho) {
  try {
    return await import(caminho);
  } catch {
    return {};
  }
}

function exigir(modulo, nome) {
  const valor = modulo[nome];
  if (valor === undefined) throw new Error(`exportação ausente: ${nome}`);
  return valor;
}

/** Cliente falso: devolve as respostas na ordem; `from()` é proibido. */
function clienteFalso(...respostas) {
  const chamadas = [];
  return {
    chamadas,
    rpc(nome, parametros) {
      chamadas.push({ nome, parametros });
      return Promise.resolve(
        respostas.shift() ?? { data: null, error: { message: "sem resposta" } },
      );
    },
    from(tabela) {
      chamadas.push({ nome: `from:${tabela}` });
      throw new Error(`escrita direta em ${tabela}: fallback proibido`);
    },
  };
}

const OP = "11111111-1111-4111-8111-111111111111";
const TURNO = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const BIA = "44444444-4444-4444-8444-444444444444";
const FOLHA = "55555555-5555-4555-8555-555555555555";
const LA = "66666666-6666-4666-8666-666666666666";
const LB = "77777777-7777-4777-8777-777777777777";
const DATA = "2027-10-04";

const linha = (employeeId, entryId, extra = {}) => ({
  employeeId,
  entryId,
  status: "present",
  checkIn: "08:00",
  checkOut: "17:00",
  breakMinutes: 60,
  notes: "",
  ...extra,
});

const okAdmin = (linhas, folhaCriada = false) => ({
  data: { timesheet_id: FOLHA, folha_criada: folhaCriada, linhas },
  error: null,
});

const admin = await carregar("../src/lib/apontamentos-admin-v2.ts");
const salvarMod = await carregar("../src/lib/apontamentos-salvar.ts");
const rpcOp = await carregar("../src/lib/operacional/rpc.ts");
const dominio = await carregar("../src/app/(painel)/operacional/_dominio.ts");

// ---------------------------------------------------------------------------------------------
console.log("\nA. Administrador: só a v2, com a versão lida do banco\n");

const salvarDia = (cliente, extra = {}) =>
  exigir(admin, "salvarDiaAdminV2")(cliente, {
    operationId: OP,
    shiftId: TURNO,
    workDate: DATA,
    linhas: [linha(ANA, LA), linha(BIA, undefined)],
    versaoEsperada: (id) => (id === ANA ? 3 : 0),
    ...extra,
  });

await caso("A1. chama UMA RPC, salvar_apontamento_admin_v2, e nenhuma tabela", async () => {
  const c = clienteFalso(
    okAdmin([
      { employee_id: ANA, entry_id: LA, versao: 4, resultado: "atualizado" },
      { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
    ]),
  );
  await salvarDia(c);
  igual(
    c.chamadas.map((x) => x.nome),
    ["salvar_apontamento_admin_v2"],
  );
});

await caso("A2. cada linha leva versao_esperada: a lida (existente) e 0 (nova)", async () => {
  const c = clienteFalso(
    okAdmin([
      { employee_id: ANA, entry_id: LA, versao: 4, resultado: "atualizado" },
      { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
    ]),
  );
  await salvarDia(c);
  const enviadas = c.chamadas[0].parametros.p_linhas;
  igual(
    enviadas.map((l) => [l.employee_id, l.versao_esperada]),
    [
      [ANA, 3],
      [BIA, 0],
    ],
  );
  igual(Object.keys(c.chamadas[0].parametros).sort(), [
    "p_linhas",
    "p_operation_id",
    "p_shift_id",
    "p_work_date",
  ]);
});

await caso(
  "A3. versão desconhecida (banco sem a 054 ou leitura sem a coluna): recusa ANTES de chamar",
  async () => {
    exigir(admin, "salvarDiaAdminV2");
    const c = clienteFalso();
    const erro = await erroDe(() =>
      salvarDia(c, { versaoEsperada: (id) => (id === ANA ? null : 0) }),
    );
    if (!erro) throw new Error("não recusou");
    igual(c.chamadas.length, 0, "chamadas");
  },
);

for (const [rotulo, valor] of [
  ["negativa", -1],
  ["fracionária", 1.5],
  ["texto", "3"],
  ["indefinida", undefined],
]) {
  await caso(`A4.${rotulo} — versão ${rotulo} não vira payload`, async () => {
    exigir(admin, "salvarDiaAdminV2");
    const c = clienteFalso();
    const erro = await erroDe(() => salvarDia(c, { versaoEsperada: () => valor }));
    if (!erro) throw new Error("não recusou");
    igual(c.chamadas.length, 0, "chamadas");
  });
}

await caso(
  "A5. 40001: erro de CONFLITO, uma chamada só (sem retry nem troca de versão)",
  async () => {
    const c = clienteFalso({
      data: null,
      error: { code: "40001", message: "Apontamento alterado por outra sessão" },
    });
    const erro = await erroDe(() => salvarDia(c));
    igual(erro?.falha, "conflito", "falha");
    igual(erro?.code, "40001", "code");
    igual(c.chamadas.length, 1, "chamadas");
  },
);

await caso(
  "A6. banco sem a v2 (PGRST202): falha controlada, SEM v1 e SEM escrita direta",
  async () => {
    const c = clienteFalso({ data: null, error: { code: "PGRST202", message: "Could not find" } });
    const erro = await erroDe(() => salvarDia(c));
    igual(erro?.falha, "banco_sem_v2", "falha");
    igual(
      c.chamadas.map((x) => x.nome),
      ["salvar_apontamento_admin_v2"],
    );
  },
);

await caso(
  "A7. falha de rede (resposta perdida): classificada como resultado incerto",
  async () => {
    const c = clienteFalso({
      data: null,
      error: { code: "", message: "TypeError: Failed to fetch" },
    });
    const erro = await erroDe(() => salvarDia(c));
    igual(erro?.falha, "rede", "falha");
    igual(c.chamadas.length, 1, "chamadas");
  },
);

await caso(
  "A8. retorno lido explicitamente: inserido, atualizado e sem_alteracao por colaborador",
  async () => {
    const c = clienteFalso(
      okAdmin(
        [
          { employee_id: ANA, entry_id: LA, versao: 3, resultado: "sem_alteracao" },
          { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
        ],
        true,
      ),
    );
    const r = await salvarDia(c);
    igual(
      [r.timesheet_id, r.folha_criada, r.linhas.map((l) => `${l.resultado}:${l.versao}`)],
      [FOLHA, true, ["sem_alteracao:3", "inserido:1"]],
    );
  },
);

for (const [rotulo, dados] of [
  ["o id da folha da v1 (texto)", FOLHA],
  ["nulo", null],
  ["sem linhas", { timesheet_id: FOLHA, folha_criada: false }],
  [
    "resultado desconhecido",
    {
      timesheet_id: FOLHA,
      folha_criada: false,
      linhas: [
        { employee_id: ANA, entry_id: LA, versao: 4, resultado: "gravado" },
        { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
      ],
    },
  ],
  [
    "versão zero",
    {
      timesheet_id: FOLHA,
      folha_criada: false,
      linhas: [
        { employee_id: ANA, entry_id: LA, versao: 0, resultado: "atualizado" },
        { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
      ],
    },
  ],
  [
    "faltando um colaborador enviado",
    {
      timesheet_id: FOLHA,
      folha_criada: false,
      linhas: [{ employee_id: ANA, entry_id: LA, versao: 4, resultado: "atualizado" }],
    },
  ],
]) {
  await caso(
    `A9.${rotulo} — retorno fora do contrato é erro de contrato, não sucesso`,
    async () => {
      const c = clienteFalso({ data: dados, error: null });
      const erro = await erroDe(() => salvarDia(c));
      igual(erro?.falha, "contrato", "falha");
    },
  );
}

await caso(
  "A10. confirmar_virada só nas linhas confirmadas pelo admin, e só como true",
  async () => {
    const c = clienteFalso(
      okAdmin([
        { employee_id: ANA, entry_id: LA, versao: 4, resultado: "atualizado" },
        { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
      ]),
    );
    await salvarDia(c, { viradasConfirmadas: new Set([BIA]) });
    igual(
      c.chamadas[0].parametros.p_linhas.map((l) => [l.employee_id, l.confirmar_virada]),
      [
        [ANA, undefined],
        [BIA, true],
      ],
    );
  },
);

await caso(
  "A11. a mensagem de sucesso diz quando a linha já estava gravada (retry idempotente)",
  async () => {
    const msg = exigir(
      salvarMod,
      "mensagemDoResultado",
    )({
      timesheet_id: FOLHA,
      folha_criada: false,
      linhas: [{ employee_id: ANA, entry_id: LA, versao: 3, resultado: "sem_alteracao" }],
    });
    if (!/já estava gravad/.test(msg)) throw new Error(msg);
  },
);

await caso(
  "A12. depois de salvar: base da linha que segue suja = versão devolvida; limpa sai",
  async () => {
    const b = exigir(salvarMod, "basesAposSalvar")(
      new Map([
        [ANA, 3],
        [BIA, 0],
      ]),
      new Set([ANA]),
      {
        timesheet_id: FOLHA,
        folha_criada: false,
        linhas: [
          { employee_id: ANA, entry_id: LA, versao: 4, resultado: "atualizado" },
          { employee_id: BIA, entry_id: LB, versao: 1, resultado: "inserido" },
        ],
      },
    );
    igual([...b], [[ANA, 4]]);
  },
);

await caso(
  "A13. (controle) conflito visível: linha suja cuja base difere da versão atual do banco",
  async () => {
    const conflitos = exigir(salvarMod, "linhasEmConflito")(
      [ANA, BIA],
      new Map([
        [ANA, 3],
        [BIA, 1],
      ]),
      new Map([
        [ANA, 4],
        [BIA, 1],
      ]),
      new Map([
        [ANA, 4],
        [BIA, 1],
      ]),
    );
    igual(conflitos, [ANA]);
  },
);

await caso(
  "A14. reconciliação: linha suja igual ao gravado deixa de ser pendência (resposta perdida)",
  async () => {
    const d = exigir(salvarMod, "dirtyReconciliado")(
      new Set([ANA, BIA]),
      [linha(ANA, LA, { checkOut: "18:00" }), linha(BIA, LB, { checkOut: "18:00" })],
      [
        {
          id: LA,
          employee_id: ANA,
          status: "present",
          check_in: "08:00:00",
          check_out: "18:00:00",
          break_minutes: 60,
          notes: null,
        },
        {
          id: LB,
          employee_id: BIA,
          status: "present",
          check_in: "08:00:00",
          check_out: "17:00:00",
          break_minutes: 60,
          notes: null,
        },
      ],
    );
    igual([...d], [BIA]);
  },
);

await caso(
  "A15. versão do gravado: a do banco; linha nova 0; sem a coluna, desconhecida (null)",
  async () => {
    const v = exigir(salvarMod, "versaoDoGravado");
    igual(
      [v({ versao: 7 }), v(undefined), v({ updated_at: "2027-10-04T10:00:00Z" })],
      [7, 0, null],
    );
  },
);

await caso("A16. a situação e a confirmação da virada falam com as RPCs da 054", async () => {
  const c = clienteFalso(
    { data: "pendente", error: null },
    {
      data: { confirmacao_id: FOLHA, entry_id: LA, versao: 2, situacao: "confirmada" },
      error: null,
    },
  );
  const s = await exigir(admin, "consultarSituacaoDaVirada")(c, LA);
  const r = await exigir(admin, "confirmarViradaRegistrada")(c, LA, 2);
  igual(
    [s, r.situacao, c.chamadas.map((x) => [x.nome, x.parametros])],
    [
      "pendente",
      "confirmada",
      [
        ["situacao_da_virada", { p_entry_id: LA }],
        ["confirmar_virada_do_apontamento", { p_entry_id: LA, p_versao: 2 }],
      ],
    ],
  );
});

await caso("A17. confirmar com a versão errada (40001) é conflito, não sucesso", async () => {
  const c = clienteFalso({ data: null, error: { code: "40001", message: "alterado" } });
  const erro = await erroDe(() => exigir(admin, "confirmarViradaRegistrada")(c, LA, 1));
  igual(erro?.falha, "conflito");
});

// ---------------------------------------------------------------------------------------------
console.log("\nO. Operador: listagem e gravação v2, sem confirmação de virada\n");

const linhaLida = (extra = {}) => ({
  timesheet_id: FOLHA,
  shift_id: TURNO,
  work_date: DATA,
  folha_status: "open",
  employee_id: ANA,
  status: "present",
  check_in: "08:00:00",
  check_out: "17:00:00",
  break_minutes: 60,
  notes: null,
  faturado: false,
  versao: 2,
  ...extra,
});

await caso(
  "O1. a listagem chama listar_apontamentos_do_operador_v2 e devolve a versão",
  async () => {
    const c = clienteFalso({ data: [linhaLida()], error: null });
    const r = await exigir(rpcOp, "buscarApontamentosDoOperador")(c, OP, TURNO, DATA);
    igual([c.chamadas[0].nome, r[0].versao], ["listar_apontamentos_do_operador_v2", 2]);
  },
);

await caso("O1b. linha sem versão na listagem é quebra de contrato", async () => {
  const c = clienteFalso({ data: [linhaLida({ versao: undefined })], error: null });
  const erro = await erroDe(() =>
    exigir(rpcOp, "buscarApontamentosDoOperador")(c, OP, TURNO, DATA),
  );
  igual(erro?.name, "ErroDeContratoOperacional");
});

await caso(
  "O1c. (controle) folha vazia (linha só de folha, sem versão) continua legítima",
  async () => {
    const c = clienteFalso({
      data: [
        linhaLida({
          employee_id: null,
          status: null,
          check_in: null,
          check_out: null,
          break_minutes: null,
          faturado: false,
          versao: null,
        }),
      ],
      error: null,
    });
    const r = await exigir(rpcOp, "buscarApontamentosDoOperador")(c, OP, TURNO, DATA);
    igual(r.length, 1);
  },
);

await caso(
  "O10. a listagem recusa coluna fora do contrato (nada financeiro chega à tela)",
  async () => {
    const c = clienteFalso({ data: [linhaLida({ billed_amount: 240 })], error: null });
    const erro = await erroDe(() =>
      exigir(rpcOp, "buscarApontamentosDoOperador")(c, OP, TURNO, DATA),
    );
    igual(erro?.name, "ErroDeContratoOperacional");
  },
);

const okOperador = (linhas) => ({ data: { timesheet_id: FOLHA, linhas }, error: null });
const salvarOp = (cliente, linhas) =>
  exigir(rpcOp, "salvarApontamentoOperacional")(cliente, {
    operationId: OP,
    shiftId: TURNO,
    workDate: DATA,
    linhas,
  });

await caso(
  "O2. a gravação chama salvar_apontamento_operacional_v2 com versao_esperada por linha",
  async () => {
    const c = clienteFalso(okOperador([{ employee_id: ANA, versao: 1, resultado: "inserido" }]));
    await salvarOp(c, [{ employee_id: ANA, status: "present", versao_esperada: 0 }]);
    igual(
      [c.chamadas[0].nome, c.chamadas[0].parametros.p_linhas[0].versao_esperada],
      ["salvar_apontamento_operacional_v2", 0],
    );
  },
);

await caso("O2b. linha sem versao_esperada não é enviada", async () => {
  const c = clienteFalso();
  const erro = await erroDe(() => salvarOp(c, [{ employee_id: ANA, status: "present" }]));
  if (!erro) throw new Error("não recusou");
  igual(c.chamadas.length, 0, "chamadas");
});

await caso(
  "O7. o operador não envia confirmar_virada: a chave é recusada antes do banco",
  async () => {
    const c = clienteFalso();
    const erro = await erroDe(() =>
      salvarOp(c, [
        { employee_id: ANA, status: "present", versao_esperada: 1, confirmar_virada: true },
      ]),
    );
    if (!/confirmar_virada/.test(erro?.message ?? "")) throw new Error(String(erro?.message));
    igual(c.chamadas.length, 0, "chamadas");
  },
);

await caso("O3. o retorno v2 é lido: versão e resultado de cada linha", async () => {
  const c = clienteFalso(
    okOperador([
      { employee_id: ANA, versao: 2, resultado: "atualizado" },
      { employee_id: BIA, versao: 5, resultado: "sem_alteracao" },
    ]),
  );
  const r = await salvarOp(c, [
    { employee_id: ANA, status: "present", versao_esperada: 1 },
    { employee_id: BIA, status: "absent", versao_esperada: 4 },
  ]);
  igual(
    [
      r.timesheet_id,
      r.linhas.map((l) => `${l.employee_id === ANA ? "ana" : "bia"}:${l.resultado}:${l.versao}`),
    ],
    [FOLHA, ["ana:atualizado:2", "bia:sem_alteracao:5"]],
  );
});

await caso("O3b. o retorno da v1 (só o id da folha) é quebra de contrato", async () => {
  const c = clienteFalso({ data: FOLHA, error: null });
  const erro = await erroDe(() =>
    salvarOp(c, [{ employee_id: ANA, status: "present", versao_esperada: 0 }]),
  );
  igual(erro?.name, "ErroDeContratoOperacional");
});

await caso("O4. 40001 sobe como conflito, com mensagem específica (não a genérica)", async () => {
  const c = clienteFalso({ data: null, error: { code: "40001", message: "alterado" } });
  const erro = await erroDe(() =>
    salvarOp(c, [{ employee_id: ANA, status: "present", versao_esperada: 1 }]),
  );
  igual(erro?.code, "40001", "code");
  const msg = exigir(dominio, "mensagemDeErro")(erro);
  if (!/outra sessão/.test(msg)) throw new Error(msg);
  igual(c.chamadas.length, 1, "chamadas");
});

await caso(
  "O4b. banco sem a v2 (PGRST202): mensagem de versão do banco, sem chamar a v1",
  async () => {
    const c = clienteFalso({ data: null, error: { code: "PGRST202", message: "Could not find" } });
    const erro = await erroDe(() =>
      salvarOp(c, [{ employee_id: ANA, status: "present", versao_esperada: 1 }]),
    );
    const msg = exigir(dominio, "mensagemDeErro")(erro);
    if (!/054/.test(msg)) throw new Error(msg);
    igual(
      c.chamadas.map((x) => x.nome),
      ["salvar_apontamento_operacional_v2"],
    );
  },
);

const membro = (id, nome) => ({
  employee_id: id,
  employee_name: nome,
  employee_role: null,
  active: true,
});

await caso(
  "O5. o rascunho guarda a versão lida e as alterações a levam como versao_esperada",
  async () => {
    const rascunho = exigir(dominio, "montarRascunho")(
      [membro(ANA, "Ana"), membro(BIA, "Bia")],
      [linhaLida()],
      60,
    );
    igual(
      rascunho.map((l) => l.versao),
      [2, 0],
      "versões",
    );
    const editadas = rascunho.map((l) => ({ ...l, notes: "x" }));
    const envio = exigir(dominio, "linhasAlteradas")(editadas, [linhaLida()]);
    igual(
      envio.map((l) => [l.employee_id, l.versao_esperada]),
      [
        [ANA, 2],
        [BIA, 0],
      ],
    );
  },
);

await caso(
  "O6. edição sobre leitura antiga: a versão é a do início da edição (gera conflito, não sobrescreve)",
  async () => {
    const aplicar = exigir(dominio, "aplicarEdicao");
    const base1 = exigir(dominio, "montarRascunho")([membro(ANA, "Ana")], [linhaLida()], 60);
    let editadas = aplicar(new Map(), base1, ANA, { notes: "minha" });
    // Outra sessão gravou: a leitura nova traz a versão 3.
    const base2 = exigir(dominio, "montarRascunho")(
      [membro(ANA, "Ana")],
      [linhaLida({ versao: 3, notes: "dela" })],
      60,
    );
    editadas = aplicar(editadas, base2, ANA, { check_out: "17:30" });
    const tela = exigir(dominio, "linhasDaTela")(base2, editadas);
    igual([tela[0].notes, tela[0].check_out, tela[0].versao], ["minha", "17:30", 2]);
    igual(
      exigir(dominio, "conflitosDoRascunho")(editadas, [linhaLida({ versao: 3, notes: "dela" })]),
      [ANA],
    );
  },
);

await caso(
  "O6b. depois de gravar: linha igual ao enviado sai do rascunho; editada depois ganha a versão nova",
  async () => {
    const apos = exigir(dominio, "editadasAposSalvar");
    const editadas = new Map([
      [
        ANA,
        {
          ...exigir(dominio, "montarRascunho")([membro(ANA, "Ana")], [linhaLida()], 60)[0],
          notes: "a",
        },
      ],
      [BIA, { ...exigir(dominio, "montarRascunho")([membro(BIA, "Bia")], [], 60)[0], notes: "b2" }],
    ]);
    const r = apos(
      editadas,
      [
        {
          employee_id: ANA,
          status: "present",
          check_in: "08:00:00",
          check_out: "17:00:00",
          break_minutes: 60,
          notes: "a",
          versao_esperada: 2,
        },
        {
          employee_id: BIA,
          status: "present",
          check_in: null,
          check_out: null,
          break_minutes: 60,
          notes: "b1",
          versao_esperada: 0,
        },
      ],
      {
        timesheet_id: FOLHA,
        linhas: [
          { employee_id: ANA, versao: 3, resultado: "atualizado" },
          { employee_id: BIA, versao: 1, resultado: "inserido" },
        ],
      },
    );
    igual([[...r.keys()], r.get(BIA)?.versao], [[BIA], 1]);
  },
);

await caso(
  "O6c. resolver o conflito exige decisão: manter a minha adota a versão atual; usar o gravado descarta",
  async () => {
    const manter = exigir(dominio, "manterMinhaAlteracao");
    const usar = exigir(dominio, "usarOGravado");
    const base = exigir(dominio, "montarRascunho")([membro(ANA, "Ana")], [linhaLida()], 60);
    const editadas = exigir(dominio, "aplicarEdicao")(new Map(), base, ANA, { notes: "minha" });
    const atuais = [linhaLida({ versao: 5 })];
    igual(manter(editadas, ANA, atuais).get(ANA)?.versao, 5, "manter");
    igual(usar(editadas, ANA).has(ANA), false, "usar");
  },
);

// ---------------------------------------------------------------------------------------------
console.log("\nS. As telas não têm caminho antigo nem confirmação do operador\n");

const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const telaAdmin = semComentarios(
  readFileSync(
    new URL("../src/app/(painel)/apontamentos/painel-apontamentos.tsx", import.meta.url),
    "utf8",
  ),
);
const telaOp = semComentarios(
  readFileSync(
    new URL("../src/app/(painel)/operacional/painel-operacional.tsx", import.meta.url),
    "utf8",
  ),
);

await caso(
  "S1. a tela do admin não tem o caminho anterior (upsert, insert de folha nem v1)",
  async () => {
    igual(
      [
        /salvarPeloCaminhoAnterior/.test(telaAdmin),
        /\.upsert\(/.test(telaAdmin),
        /\.rpc\("salvar_apontamento_admin"/.test(telaAdmin),
        /from\("timesheets"\)\s*\.insert/.test(telaAdmin),
      ],
      [false, false, false, false],
    );
  },
);

await caso("S2. a tela do admin grava por salvarDiaAdminV2", async () => {
  igual(/salvarDiaAdminV2\(/.test(telaAdmin), true);
});

await caso("S3. a tela do operador não oferece a confirmação de virada", async () => {
  igual(/Confirmo que a jornada atravessou a meia-noite/.test(telaOp), false);
});

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
