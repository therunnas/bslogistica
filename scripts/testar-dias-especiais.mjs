import assert from "node:assert/strict";
import { normalizarLinha } from "../src/lib/fechamento/normalizar.ts";
import { detectarAlertas } from "../src/lib/fechamento/alertas.ts";
import { resumoDoDia } from "../src/lib/diaria-individual.ts";
import { interpretarDiasEspeciaisV2 } from "../src/lib/vigencias-ui.ts";
import { valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";
import { agregarFechamento } from "../src/lib/fechamento/agregar.ts";
import {
  tabelaPorColaborador,
  tabelaDetalhamentoDiario,
  csvDoFechamento,
} from "../src/lib/fechamento/exportacao.ts";
import { bancoCoerente } from "./_fechamento-banco.mjs";

for (const dia of ["domingo", "feriado"]) {
  const linha = normalizarLinha({
    id: "ESPECIAL_TESTE_A",
    employee_id: "COLABORADOR_TESTE_A",
    status: "present",
    check_in: "06:00",
    check_out: "07:00",
    worked_minutes: 60,
    overtime_minutes: 0,
    billed_overtime_minutes: 0,
    invoice_id: null,
    faturado: "95.00",
    custo: "20.00",
    taxa_da_diaria: "260.00",
    employees: { id: "COLABORADOR_TESTE_A", name: "COLABORADOR_TESTE_A", role: "conferente" },
    timesheets: {
      id: "FOLHA_TESTE_A",
      work_date: "2026-03-01",
      status: "closed",
      operation_id: "OPERACAO_TESTE_A",
      operations: {
        id: "OPERACAO_TESTE_A",
        client_id: "CLIENTE_TESTE_A",
        name: "OPERACAO_TESTE_A",
        contract_id: "CONTRATO_TESTE_A",
      },
      shifts: { id: "TURNO_TESTE_A", name: "TURNO_TESTE_A" },
    },
    day_kind_snapshot: dia,
    calc_version: 2,
    base: "0.00",
    he: "0.00",
    especial: "65.00",
    adicional_diario: "30.00",
  });
  assert.deepEqual(
    [
      linha.tipoDoDia,
      linha.diariaCentavos,
      linha.extraCentavos,
      linha.especialCentavos,
      linha.adicionalDiarioCentavos,
      linha.faturadoCentavos,
      linha.custoCentavos,
    ],
    [dia, 0, 0, 6500, 3000, 9500, 2000],
  );
  const fechamento = agregarFechamento([linha], {
    clienteId: "CLIENTE_TESTE_A",
    clienteNome: "CLIENTE_TESTE_A",
    inicio: "2026-03-01",
    fim: "2026-03-15",
    geradoEm: "2026-03-16T12:00:00Z",
    assinatura: "SINTETICA",
    banco: bancoCoerente([linha]),
  });
  for (const tabela of [tabelaPorColaborador(fechamento), tabelaDetalhamentoDiario(fechamento)]) {
    assert.deepEqual(
      tabela.colunas.slice(-2).map((c) => c.titulo),
      ["Horas especiais", "Adicional diário"],
    );
    assert.deepEqual(tabela.linhas[0].slice(-2), [6500, 3000]);
  }
  assert.equal(csvDoFechamento(fechamento, "colaborador").includes('"65,00"'), true);

  const alertas = detectarAlertas([linha], {
    banco: bancoCoerente([linha]),
    conciliacao: [],
    inicio: "2026-03-01",
    fim: "2026-03-15",
  });
  assert.equal(
    alertas.some((a) => ["domingo-regra-pendente", "feriado-cobranca-pendente"].includes(a.codigo)),
    false,
  );
}
console.log("PASS: domingo/feriado V2 no Fechamento, componentes e alertas.");

// A prévia legada não representa dias especiais com resolução ON. Salvar consulta o banco.
const regras = { daily_rate: 260, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 };
const entrada = {
  estado: { tag: "ligado", ativadaEm: null },
  status: "present",
  gravada: false,
  tocada: true,
  gravado: null,
  regrasDoCadastro: regras,
  custoDoCadastro: 80,
  condicaoDoDia: { ok: true, regras, custoDiario: 80, origem: "versao" },
  plannedMinutes: 480,
  calcular: () => ({ billedAmount: 32.5, costAmount: 10, overtimeMinutes: 0 }),
};
for (const dia of [
  { domingo: true, tipoDoDia: "util" },
  { domingo: false, tipoDoDia: "feriado" },
]) {
  const resultado = valorDaLinha({ ...entrada, ...dia, diasEspeciaisV2: true });
  assert.equal(resultado.tipo, "indisponivel");
  assert.equal(resultado.bloqueiaSalvar, false);
  assert.equal(valorDaLinha({ ...entrada, ...dia, diasEspeciaisV2: false }).billed, 32.5);
}
console.log("PASS: prévia especial aguarda o banco; OFF e bancos anteriores preservados.");

for (const [data, erro, esperado] of [
  [{ dias_especiais_v2: true, resolucao_tarifas: true }, null, true],
  [{ dias_especiais_v2: true, resolucao_tarifas: false }, null, false],
  [{ resolucao_tarifas: true }, null, false],
  [{ dias_especiais_v2: true, resolucao_tarifas: true }, { message: "rede" }, false],
  [null, null, false],
  [{ dias_especiais_v2: 1, resolucao_tarifas: true }, null, false],
]) {
  assert.equal(interpretarDiasEspeciaisV2(data, erro), esperado);
}

assert.equal(
  resumoDoDia({
    billed_special_amount: "65.00",
    billed_amount: "95.00",
    additional_amount: "30.00",
  }).especial,
  65,
);
