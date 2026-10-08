/**
 * Testes da integridade dos apontamentos (etapa 4.6.13).
 *
 * COMO RODAR:
 *
 *   npm run test:apontamentos
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs` (o Fechamento compartilha valor entre módulos).
 * Sai com código diferente de zero em qualquer falha.
 *
 * O DEFEITO QUE ESTA SUÍTE TRAVA
 *
 * Ana e Bruno apontados em 08/10 (Ana Presente, Bruno Falta), dia fechado,
 * R$ 160 / R$ 80. Carla entra na equipe depois. A tela montava o rascunho a
 * partir da equipe *atual* e dava `"present"` a quem não tinha registro: Carla
 * aparecia Presente no dia fechado e a prévia subia para R$ 320. Nada disso
 * estava gravado.
 *
 * BLOCOS
 *
 *   A. o caso relatado, passo a passo
 *   B. dia aberto: não apontado não cobra
 *   C. decisões explícitas (Presente, Falta, Substituição)
 *   D. histórico: o gravado vale mais que o contrato e a equipe de hoje
 *   E. sem diária duplicada
 *   F. correspondência com o Fechamento
 *   G. forma literal da tela
 */

import { readFileSync } from "node:fs";

import { agregarFechamento } from "../src/lib/fechamento/agregar.ts";
import { normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";
import {
  contarNaoApontadas,
  linhasASalvar,
  montarLinhasDoServidor,
  totalizar,
  valoresDaLinha,
} from "../src/lib/apontamentos/rascunho.ts";
import { calcEntry, shiftPlannedMinutes } from "../src/lib/billing.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
    console.log(`  FAIL  ${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
  }
}

const igual = (caso, obtido, esperado) =>
  verificar(caso, JSON.stringify(obtido), JSON.stringify(esperado));

// ---------------------------------------------------------------------------
// Cenário: contrato de R$ 160 a diária, turno 08:00–16:00 sem intervalo,
// colaboradores com custo de R$ 80.
// ---------------------------------------------------------------------------

const TURNO = {
  start_time: "08:00:00",
  end_time: "16:00:00",
  break_minutes: 0,
  crosses_midnight: false,
};

const REGRAS = { daily_rate: 160, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 };
const CUSTO = 80;
const PLANEJADO = shiftPlannedMinutes(TURNO);

const ANA = "emp-ana";
const BRUNO = "emp-bruno";
const CARLA = "emp-carla";

/** O que o trigger do banco gravaria: a mesma conta, feita uma vez, no salvamento. */
function gravar(id, employeeId, status, extra = {}) {
  const calc = calcEntry({
    status,
    checkIn: extra.checkIn ?? "08:00",
    checkOut: extra.checkOut ?? "16:00",
    breakMinutes: 0,
    plannedMinutes: PLANEJADO,
    rules: extra.regras ?? REGRAS,
    employeeDailyCost: extra.custo ?? CUSTO,
  });
  return {
    id,
    employee_id: employeeId,
    status,
    check_in: status === "absent" ? null : "08:00:00",
    check_out: status === "absent" ? null : "16:00:00",
    break_minutes: 0,
    worked_minutes: calc.workedMinutes,
    overtime_minutes: calc.overtimeMinutes,
    billed_amount: calc.billedAmount,
    cost_amount: calc.costAmount,
    notes: null,
  };
}

const REG_ANA = gravar("e-ana", ANA, "present");
const REG_BRUNO = gravar("e-bruno", BRUNO, "absent");
const GRAVADOS = [REG_ANA, REG_BRUNO];

const membro = (id) => ({ employee_id: id });
const EQUIPE_COM_CARLA = [membro(ANA), membro(BRUNO), membro(CARLA)];

/**
 * A tela inteira, sem React: monta as linhas, calcula valores e soma — com as
 * mesmas funções que o componente chama, na mesma ordem.
 */
function tela({
  membros,
  registros,
  fechado,
  editadas = new Set(),
  regras = REGRAS,
  custo = CUSTO,
  ajustar = (linhas) => linhas,
}) {
  const linhas = ajustar(montarLinhasDoServidor({ membros, registros, turno: TURNO, fechado }));
  const computadas = linhas.map((linha) => {
    const calc =
      linha.status === null
        ? null
        : calcEntry({
            status: linha.status,
            checkIn: linha.checkIn || null,
            checkOut: linha.checkOut || null,
            breakMinutes: linha.breakMinutes,
            plannedMinutes: PLANEJADO,
            rules: regras,
            employeeDailyCost: custo,
          });
    const valores = valoresDaLinha({
      linha,
      registro: registros.find((r) => r.id === linha.entryId),
      editada: editadas.has(linha.employeeId),
      fechado,
      previa: calc,
    });
    return { linha, valores };
  });
  const totais = totalizar(
    computadas.map(({ linha, valores }) => ({ status: linha.status, valores })),
  );
  return { linhas, computadas, totais, aGravar: linhasASalvar(linhas, editadas) };
}

const ids = (linhas) => linhas.map((l) => l.employeeId);

// ---------------------------------------------------------------------------
console.log("A. o caso relatado");

verificar("A0. fixture: Ana presente fatura 160", REG_ANA.billed_amount, 160);
verificar("A0. fixture: Ana presente custa 80", REG_ANA.cost_amount, 80);
verificar("A0. fixture: Bruno falta fatura 0", REG_BRUNO.billed_amount, 0);

{
  // 1–2. Ana e Bruno salvos em 08/10, dia fechado, com a equipe de então.
  const antes = tela({ membros: [membro(ANA), membro(BRUNO)], registros: GRAVADOS, fechado: true });
  verificar("A1. antes da Carla: faturado 160", antes.totais.billed, 160);
  verificar("A1. antes da Carla: custo 80", antes.totais.cost, 80);

  // 3–7. Carla entra na equipe depois.
  const depois = tela({ membros: EQUIPE_COM_CARLA, registros: GRAVADOS, fechado: true });
  igual("A4. dia fechado continua com 2 registros (Ana, Bruno)", ids(depois.linhas), [ANA, BRUNO]);
  verificar("A4. a contagem é 2", depois.linhas.length, 2);
  verificar("A5. faturamento exibido permanece R$ 160", depois.totais.billed, 160);
  verificar("A6. custo exibido permanece R$ 80", depois.totais.cost, 80);
  verificar("A6. uma diária (Ana); Bruno é falta", depois.totais.dailies, 1);
  verificar("A7. nada a gravar para a Carla", depois.aGravar.length, 0);
  verificar("A7. Carla não aparece no dia fechado", ids(depois.linhas).includes(CARLA), false);
  verificar(
    "A7. nem como linha de interface",
    depois.linhas.some((l) => l.entryId === undefined),
    false,
  );

  // O defeito original, reproduzido de propósito: com a regra antiga (membro sem
  // registro = Presente) o mesmo dia daria 320. A suíte prova que a conta que
  // gerou o 320 é a que não existe mais.
  const antigaCarla = calcEntry({
    status: "present",
    checkIn: "08:00",
    checkOut: "16:00",
    breakMinutes: 0,
    plannedMinutes: PLANEJADO,
    rules: REGRAS,
    employeeDailyCost: CUSTO,
  });
  verificar(
    "A8. sanidade: Carla Presente por omissão levaria o dia a 320 (o defeito)",
    depois.totais.billed + antigaCarla.billedAmount,
    320,
  );
}

// ---------------------------------------------------------------------------
console.log("B. dia aberto: não apontado não cobra");

{
  const aberto = tela({ membros: EQUIPE_COM_CARLA, registros: GRAVADOS, fechado: false });
  const carla = aberto.linhas.find((l) => l.employeeId === CARLA);
  verificar("B1. Carla aparece, mas sem decisão (status null)", carla?.status, null);
  verificar("B1. e sem registro gravado", carla?.entryId, undefined);
  verificar("B2. não vira 'Falta' por omissão", carla?.status === "absent", false);
  verificar("B2. nem 'Presente' por omissão", carla?.status === "present", false);
  verificar("B3. dia aberto não cobra o não apontado: faturado 160", aberto.totais.billed, 160);
  verificar("B3. custo 80", aberto.totais.cost, 80);
  verificar("B3. diárias 1", aberto.totais.dailies, 1);
  verificar("B4. a tela conta 1 não apontado", contarNaoApontadas(aberto.linhas), 1);
  verificar("B5. salvar sem escolher nada não grava a Carla", aberto.aGravar.length, 0);

  // Tocar o horário sem decidir presença continua sem gravar nada.
  const mexida = tela({
    membros: EQUIPE_COM_CARLA,
    registros: GRAVADOS,
    fechado: false,
    editadas: new Set([CARLA]),
  });
  verificar("B6. linha editada mas sem decisão não é gravada", mexida.aGravar.length, 0);
}

{
  // Dia sem folha nenhuma: equipe inteira não apontada, total zero.
  const vazio = tela({ membros: EQUIPE_COM_CARLA, registros: [], fechado: false });
  verificar("B7. sem folha: ninguém cobrado", vazio.totais.billed, 0);
  verificar("B7. sem folha: custo zero", vazio.totais.cost, 0);
  verificar("B7. sem folha: nenhuma diária", vazio.totais.dailies, 0);
  verificar("B7. sem folha: 3 não apontados", contarNaoApontadas(vazio.linhas), 3);
  verificar("B7. sem folha: nada a gravar", vazio.aGravar.length, 0);
}

// ---------------------------------------------------------------------------
console.log("C. decisões explícitas");

const decidir = (employeeId, status) => (linhas) =>
  linhas.map((l) => (l.employeeId === employeeId ? { ...l, status } : l));

{
  // 11. Presença explicitamente escolhida gera a diária correta.
  const presente = tela({
    membros: EQUIPE_COM_CARLA,
    registros: GRAVADOS,
    fechado: false,
    editadas: new Set([CARLA]),
    ajustar: decidir(CARLA, "present"),
  });
  verificar("C1. Carla marcada Presente: faturado 320", presente.totais.billed, 320);
  verificar("C1. custo 160", presente.totais.cost, 160);
  verificar("C1. 2 diárias", presente.totais.dailies, 2);
  igual("C1. grava só a Carla", ids(presente.aGravar), [CARLA]);
  verificar("C1. com status 'present'", presente.aGravar[0]?.status, "present");

  // 12. Falta registrada gera valor zero.
  const falta = tela({
    membros: EQUIPE_COM_CARLA,
    registros: GRAVADOS,
    fechado: false,
    editadas: new Set([CARLA]),
    ajustar: decidir(CARLA, "absent"),
  });
  verificar("C2. Carla marcada Falta: faturado segue 160", falta.totais.billed, 160);
  verificar("C2. custo segue 80", falta.totais.cost, 80);
  verificar("C2. diárias seguem 1", falta.totais.dailies, 1);
  igual("C2. a falta, sendo decisão, é gravada", ids(falta.aGravar), [CARLA]);
  verificar(
    "C2. valor da falta gravada é zero",
    REG_BRUNO.billed_amount + REG_BRUNO.cost_amount,
    0,
  );

  // 13. Substituição registrada gera a diária pela regra existente.
  const substituicao = tela({
    membros: EQUIPE_COM_CARLA,
    registros: GRAVADOS,
    fechado: false,
    editadas: new Set([CARLA]),
    ajustar: decidir(CARLA, "replacement"),
  });
  verificar("C3. Substituição gera a diária (160)", substituicao.totais.billed, 320);
  verificar("C3. conta como diária", substituicao.totais.dailies, 2);
  const regra = calcEntry({
    status: "replacement",
    checkIn: "08:00",
    checkOut: "16:00",
    breakMinutes: 0,
    plannedMinutes: PLANEJADO,
    rules: REGRAS,
    employeeDailyCost: CUSTO,
  });
  verificar(
    "C3. mesmo valor que calcEntry dá a 'replacement' (regra inalterada)",
    regra.billedAmount,
    160,
  );
}

{
  // Reabrir o dia e salvar não grava a Carla sozinha.
  const reaberto = tela({ membros: EQUIPE_COM_CARLA, registros: GRAVADOS, fechado: false });
  verificar("C4. reabrir não cria registro para quem ninguém apontou", reaberto.aGravar.length, 0);
}

// ---------------------------------------------------------------------------
console.log("D. histórico");

{
  // 8. Remover colaborador da equipe atual não apaga o histórico já registrado.
  for (const fechado of [true, false]) {
    const semBruno = tela({ membros: [membro(ANA)], registros: GRAVADOS, fechado });
    igual(
      `D1. Bruno fora da equipe (${fechado ? "fechado" : "aberto"}): o registro continua`,
      ids(semBruno.linhas),
      [ANA, BRUNO],
    );
    verificar(`D1. (${fechado ? "fechado" : "aberto"}) faturado 160`, semBruno.totais.billed, 160);
  }
  const semNinguem = tela({ membros: [], registros: GRAVADOS, fechado: true });
  igual("D2. equipe vazia hoje, dia fechado: os dois registros continuam", ids(semNinguem.linhas), [
    ANA,
    BRUNO,
  ]);
  verificar("D2. e o total", semNinguem.totais.billed, 160);

  // 9. Mudança de valores contratuais não recalcula o que foi gravado.
  const NOVO = { daily_rate: 300, shift_hours: 8, ot_factor: 2, ot_tolerance_min: 0 };
  for (const fechado of [true, false]) {
    const reajustado = tela({
      membros: EQUIPE_COM_CARLA,
      registros: GRAVADOS,
      fechado,
      regras: NOVO,
      custo: 150,
    });
    verificar(
      `D3. diária e custo mudam (${fechado ? "fechado" : "aberto"}): faturado gravado 160`,
      reajustado.totais.billed,
      160,
    );
    verificar(
      `D3. (${fechado ? "fechado" : "aberto"}) custo gravado 80`,
      reajustado.totais.cost,
      80,
    );
  }

  // O valor mostrado para linha gravada e intocada é o gravado, não a prévia.
  const prévia = calcEntry({
    status: "present",
    checkIn: "08:00",
    checkOut: "16:00",
    breakMinutes: 0,
    plannedMinutes: PLANEJADO,
    rules: { daily_rate: 300, shift_hours: 8, ot_factor: 2, ot_tolerance_min: 0 },
    employeeDailyCost: 150,
  });
  verificar("D4. sanidade: a prévia com o contrato novo seria 300", prévia.billedAmount, 300);

  // Hora extra gravada também vem do gravado.
  const comExtra = gravar("e-extra", ANA, "present", { checkOut: "18:00" });
  const dia = tela({ membros: [membro(ANA)], registros: [comExtra], fechado: true });
  verificar("D5. hora extra gravada é preservada", dia.totais.overtime, comExtra.overtime_minutes);
  verificar("D5. e vale mais que 0", comExtra.overtime_minutes > 0, true);
  verificar("D5. faturado = o gravado", dia.totais.billed, comExtra.billed_amount);

  // Linha editada, em dia aberto, mostra a prévia (é para isso que ela serve).
  const editado = tela({
    membros: [membro(ANA)],
    registros: [REG_ANA],
    fechado: false,
    editadas: new Set([ANA]),
    regras: { daily_rate: 300, shift_hours: 8, ot_factor: 2, ot_tolerance_min: 0 },
    custo: 150,
  });
  verificar("D6. linha editada em dia aberto mostra a prévia (300)", editado.totais.billed, 300);

  // Dia fechado ignora edição: nada em andamento altera o gravado.
  const fechadoEditado = tela({
    membros: [membro(ANA)],
    registros: [REG_ANA],
    fechado: true,
    editadas: new Set([ANA]),
    regras: { daily_rate: 300, shift_hours: 8, ot_factor: 2, ot_tolerance_min: 0 },
    custo: 150,
  });
  verificar(
    "D7. dia fechado ignora edição e mantém o gravado (160)",
    fechadoEditado.totais.billed,
    160,
  );
}

// ---------------------------------------------------------------------------
console.log("E. sem diária duplicada");

{
  const duplicada = montarLinhasDoServidor({
    membros: [membro(ANA), membro(ANA), membro(BRUNO)],
    registros: [REG_ANA, REG_BRUNO],
    turno: TURNO,
    fechado: false,
  });
  igual("E1. colaborador repetido na equipe vira uma linha só", ids(duplicada), [ANA, BRUNO]);

  const emDobro = montarLinhasDoServidor({
    membros: [membro(ANA)],
    registros: [REG_ANA, { ...REG_ANA, id: "e-ana-2" }],
    turno: TURNO,
    fechado: true,
  });
  verificar("E2. registro repetido não gera duas linhas", emDobro.length, 1);

  const aberta = montarLinhasDoServidor({
    membros: EQUIPE_COM_CARLA,
    registros: GRAVADOS,
    turno: TURNO,
    fechado: false,
  });
  verificar("E3. nenhum colaborador aparece duas vezes", new Set(ids(aberta)).size, aberta.length);
}

// ---------------------------------------------------------------------------
console.log("F. correspondência com o Fechamento");

{
  /** Linha como a leitura do Fechamento a entrega: valores monetários em texto. */
  const bruta = (registro, nome) => ({
    id: registro.id,
    employee_id: registro.employee_id,
    status: registro.status,
    check_in: registro.check_in,
    check_out: registro.check_out,
    worked_minutes: registro.worked_minutes,
    overtime_minutes: registro.overtime_minutes,
    invoice_id: null,
    faturado: registro.billed_amount.toFixed(2),
    custo: registro.cost_amount.toFixed(2),
    taxa_da_diaria: "160.00",
    employees: { id: registro.employee_id, name: nome, role: "Auxiliar" },
    timesheets: {
      id: "ts-1",
      work_date: "2026-10-08",
      status: "closed",
      operation_id: "op-1",
      operations: { id: "op-1", client_id: "cli-1", name: "Operação 1", contract_id: "ctr-1" },
      shifts: { id: "sh-1", name: "Manhã" },
    },
  });

  const fechamento = agregarFechamento(
    normalizarLinhas([bruta(REG_ANA, "Ana"), bruta(REG_BRUNO, "Bruno")]),
    {
      clienteId: "cli-1",
      clienteNome: "Cliente 1",
      inicio: "2026-10-01",
      fim: "2026-10-15",
      geradoEm: "2026-10-16T12:00:00.000Z",
      assinatura: "assinatura-de-teste",
    },
  );

  const dia = tela({ membros: EQUIPE_COM_CARLA, registros: GRAVADOS, fechado: true });

  verificar(
    "F1. Fechamento: faturado do período = total da tela do dia fechado",
    fechamento.consolidado.faturadoCentavos,
    Math.round(dia.totais.billed * 100),
  );
  verificar(
    "F2. Fechamento: custo = total da tela",
    fechamento.consolidado.custoCentavos,
    Math.round(dia.totais.cost * 100),
  );
  verificar(
    "F3. Fechamento: diárias = diárias da tela",
    fechamento.consolidado.diarias,
    dia.totais.dailies,
  );
  verificar("F4. Fechamento: 1 falta (Bruno)", fechamento.faltas, 1);
  verificar("F5. Fechamento não conhece a Carla", fechamento.colaboradores.length, 2);
}

// ---------------------------------------------------------------------------
console.log("G. forma literal");

const painel = readFileSync("src/app/(painel)/apontamentos/painel-apontamentos.tsx", "utf8");
const modulo = readFileSync("src/lib/apontamentos/rascunho.ts", "utf8");
const migration008 = readFileSync(
  "supabase/migrations/20260906180000_008_unicidade_diaria.sql",
  "utf8",
);

verificar(
  'G1. a tela não dá mais "present" por omissão',
  /\?\?\s*"present"/.test(painel) || /\?\?\s*"present"/.test(modulo),
  false,
);
verificar(
  "G2. a tela monta o rascunho por montarLinhasDoServidor",
  /montarLinhasDoServidor\(\{/.test(painel),
  true,
);
verificar("G3. o dia fechado é passado ao montador", /fechado:\s*isClosed/.test(painel), true);
verificar(
  "G4. os valores vêm de valoresDaLinha (gravado antes do recálculo)",
  /valoresDaLinha\(\{/.test(painel),
  true,
);
verificar("G5. os totais vêm de totalizar", /totalizar\(/.test(painel), true);
verificar("G6. só linhasASalvar decide o que é gravado", /linhasASalvar\(/.test(painel), true);
verificar(
  "G7. salvar recusa dia fechado dentro da mutação, não só no botão",
  /if \(isClosed\)\s*\{\s*throw new Error/.test(painel),
  true,
);
verificar(
  "G8. fechar o dia recusa alteração pendente",
  /status === "closed" && aSalvar\.length/.test(painel),
  true,
);
verificar(
  "G9. o select aceita 'não apontado' (value vazio, sem default)",
  /value=\{row\.status \?\? ""\}/.test(painel),
  true,
);
verificar(
  "G10. campos de horário ficam travados até haver decisão",
  (painel.match(/row\.status === null \|\| row\.status === "absent"/g) ?? []).length === 3,
  true,
);
verificar(
  "G11. a guarda local contra diária duplicada permanece",
  /diariaEmOutraFolha/.test(painel) && /ehViolacaoDeDiaria/.test(painel),
  true,
);
verificar(
  "G12. o índice de unicidade citado pela tela existe na migration 008",
  migration008.includes("timesheet_entries_uma_diaria_por_operacao_dia"),
  true,
);
verificar(
  "G13. a tela ainda grava só em timesheets/timesheet_entries pelo cliente do navegador",
  (painel.match(/\.from\("(\w+)"\)/g) ?? []).sort().join() ===
    ['.from("timesheet_entries")', '.from("timesheets")', '.from("timesheets")'].sort().join(),
  true,
);
verificar(
  "G14. o módulo não importa regra financeira com valor (só tipos de billing)",
  /import type \{[^}]*\} from "\.\.\/billing"/.test(modulo) &&
    !/import \{[^}]*\} from "\.\.\/billing"/.test(modulo),
  true,
);

// ---------------------------------------------------------------------------
console.log(`\n${passou} passaram, ${falhas.length} falharam.`);

if (falhas.length) {
  console.log("\nFalhas:");
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
