/**
 * Interfaces das condições financeiras versionadas (U3 a U7) — C05-B4.6.
 *
 * COMO RODAR:
 *
 *   npm run test:interfaces-vigencia
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o TypeScript direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha. Não usa
 * rede nem banco.
 *
 * TRÊS METADES:
 *
 *   - comportamento das funções puras (`vigencias-ui.ts`, `apontamentos-financeiro.ts`,
 *     `erros-banco.ts`): estado do motor (e o que NUNCA vira "desligado"), versão aplicável à
 *     data, validação do formulário de vigência, valor de cada linha de apontamento por estado,
 *     proteção da jornada de turno;
 *   - forma literal das telas, porque elas não se observam de fora sem navegador: o que é
 *     enviado ao banco em cada estado, de onde vem o valor mostrado, o que não é oferecido;
 *   - ligação com o banco: nomes e parâmetros das RPCs conferidos contra as migrations.
 *
 * O QUE ESTA SUÍTE NÃO PROVA: o banco nem a renderização. O comportamento do motor é das suítes
 * SQL 021 (local e homologação); a renderização, de uma verificação manual com sessão de admin.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { somarLinhas, valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";
import { calcEntry } from "../src/lib/billing.ts";
import {
  MENSAGEM_TURNO_PROTEGIDO,
  ehTurnoProtegido,
  mensagemDoErro,
} from "../src/lib/erros-banco.ts";
import { RPC_VIGENCIAS } from "../src/lib/vigencias.ts";
import {
  CAMPOS_DA_VIGENCIA,
  PARAM_DO_ID,
  RPC_DE_CADASTRO,
  RPC_DE_REGISTRO,
  avisoDoMotor,
  classificarInicio,
  hojeEmSaoPaulo,
  interpretarEstadoDoMotor,
  jornadaDoTurnoProtegida,
  lerNumero,
  modoDeEdicaoDeTaxa,
  montarCadastroAtomico,
  montarRegistro,
  novoTurnoAPartir,
  podeCadastrarComTaxa,
  podeRegistrarVigencia,
  resolverCondicaoDoDia,
  situacaoDaVersao,
  turnoTemApontamentos,
  validarNovaVigencia,
  versaoNaData,
  versoesAmbiguasNaData,
} from "../src/lib/vigencias-ui.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const o = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const e = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  if (o === e) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${e}, obtido ${o}`);
    console.log(`  FAIL  ${caso} — esperado ${e}, obtido ${o}`);
  }
}

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// A. Estado do motor
// ---------------------------------------------------------------------------

console.log("A. Estado do motor: só `desligado` comprovado libera a edição direta");

const OK_DESLIGADO = { ativo: false, consistente: true, ativada_em: null };
const OK_LIGADO = { ativo: true, consistente: true, ativada_em: "2026-10-22" };

verificar(
  "A1. resposta íntegra e desligada -> desligado",
  interpretarEstadoDoMotor(OK_DESLIGADO, null).tag,
  "desligado",
);
verificar(
  "A2. resposta íntegra e ligada -> ligado, com a data",
  interpretarEstadoDoMotor(OK_LIGADO, null),
  { tag: "ligado", ativadaEm: "2026-10-22" },
);
for (const [rotulo, erro] of [
  ["permissão (42501)", { code: "42501", message: "x" }],
  ["sem sessão (28000)", { code: "28000" }],
  ["rede/PostgREST", { code: "PGRST000", message: "x" }],
  ["erro sem código", { message: "falhou" }],
  ["erro não-objeto", "boom"],
]) {
  verificar(
    `A3. ${rotulo} -> desconhecido (nunca desligado)`,
    interpretarEstadoDoMotor(OK_DESLIGADO, erro).tag,
    "desconhecido",
  );
}
for (const [rotulo, dado] of [
  ["nulo", null],
  ["indefinido", undefined],
  ["lista", []],
  ["texto", "ok"],
  ["sem `ativo`", { consistente: true }],
  ["`ativo` em texto", { ativo: "false", consistente: true }],
  ["`consistente` falso", { ativo: false, consistente: false }],
  ["`consistente` ausente", { ativo: false }],
  ["`consistente` em texto", { ativo: false, consistente: "true" }],
]) {
  verificar(
    `A4. resposta ${rotulo} -> desconhecido`,
    interpretarEstadoDoMotor(dado, null).tag,
    "desconhecido",
  );
}
verificar(
  "A5. o motivo do desconhecido por permissão é explicado",
  /permissão/i.test(interpretarEstadoDoMotor(null, { code: "42501" }).motivo),
  true,
);

const DESLIGADO = { tag: "desligado" };
const LIGADO = { tag: "ligado", ativadaEm: "2026-10-22" };
const DESCONHECIDO = { tag: "desconhecido", motivo: "x" };
const CARREGANDO = { tag: "carregando" };

verificar(
  "A6. modo de edição de taxa por estado",
  [DESLIGADO, LIGADO, DESCONHECIDO, CARREGANDO].map(modoDeEdicaoDeTaxa),
  ["direta", "por-vigencia", "bloqueada", "bloqueada"],
);
verificar(
  "A7. cadastro novo com taxa só com estado conhecido",
  [DESLIGADO, LIGADO, DESCONHECIDO, CARREGANDO].map(podeCadastrarComTaxa),
  [true, true, false, false],
);
verificar(
  "A8. registrar vigência só com estado conhecido",
  [DESLIGADO, LIGADO, DESCONHECIDO, CARREGANDO].map(podeRegistrarVigencia),
  [true, true, false, false],
);
verificar(
  "A9. o aviso do desconhecido é de alerta e diz 'somente para leitura'",
  [avisoDoMotor(DESCONHECIDO).nivel, /somente para leitura/.test(avisoDoMotor(DESCONHECIDO).texto)],
  ["alerta", true],
);
verificar(
  "A10. os avisos de desligado e ligado explicam o efeito",
  [
    /taxas atuais/.test(avisoDoMotor(DESLIGADO).texto),
    /vigência da data trabalhada/.test(avisoDoMotor(LIGADO).texto),
  ],
  [true, true],
);

// ---------------------------------------------------------------------------
// B. Datas e versões
// ---------------------------------------------------------------------------

console.log("B. Datas e versões");

verificar(
  "B1. hoje em São Paulo respeita o fuso (02:30 UTC ainda é o dia anterior)",
  hojeEmSaoPaulo(new Date("2026-10-23T02:30:00Z")),
  "2026-10-22",
);
verificar(
  "B2. e 03:00 UTC já é o dia seguinte",
  hojeEmSaoPaulo(new Date("2026-10-23T03:00:00Z")),
  "2026-10-23",
);

const base = {
  origin: "informada",
  reason: "r",
  created_at: "2026-01-01T00:00:00Z",
  retired_at: null,
};
const v1 = { ...base, id: "v1", valid_from: "2026-01-01", valid_to: "2026-07-01", active: true };
const v2 = { ...base, id: "v2", valid_from: "2026-07-01", valid_to: null, active: true };
const vr = {
  ...base,
  id: "vr",
  valid_from: "2026-01-01",
  valid_to: null,
  active: false,
  retired_at: "2026-02-01T00:00:00Z",
};
verificar("B3. início inclusivo", versaoNaData([v1, v2], "2026-01-01")?.id, "v1");
verificar("B4. fim exclusivo: 01/07 já é da v2", versaoNaData([v1, v2], "2026-07-01")?.id, "v2");
verificar("B5. véspera do fim é da v1", versaoNaData([v1, v2], "2026-06-30")?.id, "v1");
verificar("B6. antes da primeira: nenhuma", versaoNaData([v1, v2], "2025-12-31"), null);
verificar("B7. versão aposentada nunca vale", versaoNaData([vr], "2026-03-01"), null);
verificar(
  "B8. duas ativas cobrindo a data: ambíguo, a tela não escolhe",
  [
    versaoNaData([v1, { ...v2, valid_from: "2026-03-01" }], "2026-04-01"),
    versoesAmbiguasNaData([v1, { ...v2, valid_from: "2026-03-01" }], "2026-04-01"),
  ],
  [null, true],
);
verificar(
  "B9. situação da versão",
  [v1, v2, { ...v2, valid_from: "2027-01-01" }, vr].map((v) => situacaoDaVersao(v, "2026-10-22")),
  ["encerrada", "vigente", "futura", "aposentada"],
);
verificar(
  "B10. alteração imediata x vigência futura",
  [
    classificarInicio("2026-10-22", "2026-10-22"),
    classificarInicio("2026-10-23", "2026-10-22"),
    classificarInicio("2026-10-01", "2026-10-22"),
  ],
  ["hoje", "futura", "passada"],
);

// ---------------------------------------------------------------------------
// C. Formulário de vigência
// ---------------------------------------------------------------------------

console.log("C. Formulário de nova vigência");

const FORM_CONTRATO = {
  inicio: "2026-11-01",
  motivo: "Reajuste anual",
  valores: { daily_rate: "130,50", shift_hours: "8", ot_factor: "1.5", ot_tolerance_min: "10" },
  encerrarAnterior: true,
};
verificar("C1. formulário válido passa", validarNovaVigencia("contrato", FORM_CONTRATO), []);
verificar(
  "C2. motivo vazio ou só espaços é recusado",
  [
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, motivo: "" }).length,
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, motivo: "   " }).length,
  ],
  [1, 1],
);
verificar(
  "C3. data inválida é recusada",
  [
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, inicio: "" }).length > 0,
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, inicio: "2026-13-45" }).length > 0,
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, inicio: "01/11/2026" }).length > 0,
  ],
  [true, true, true],
);
verificar(
  "C4. diária negativa, vazia ou com texto é recusada",
  ["-1", "", "abc", "1.234,56"].map(
    (d) =>
      validarNovaVigencia("contrato", {
        ...FORM_CONTRATO,
        valores: { ...FORM_CONTRATO.valores, daily_rate: d },
      }).length > 0,
  ),
  [true, true, true, true],
);
verificar(
  "C5. mais de duas casas decimais é recusado",
  validarNovaVigencia("contrato", {
    ...FORM_CONTRATO,
    valores: { ...FORM_CONTRATO.valores, daily_rate: "10,123" },
  }).length,
  1,
);
verificar(
  "C6. jornada zero é recusada (a vigência exige jornada positiva)",
  validarNovaVigencia("contrato", {
    ...FORM_CONTRATO,
    valores: { ...FORM_CONTRATO.valores, shift_hours: "0" },
  }).length,
  1,
);
verificar(
  "C7. tolerância tem de ser inteira",
  [
    validarNovaVigencia("contrato", {
      ...FORM_CONTRATO,
      valores: { ...FORM_CONTRATO.valores, ot_tolerance_min: "10.5" },
    }).length,
    validarNovaVigencia("contrato", {
      ...FORM_CONTRATO,
      valores: { ...FORM_CONTRATO.valores, ot_tolerance_min: "0" },
    }).length,
  ],
  [1, 0],
);
verificar(
  "C8. fator zero é aceito (o banco aceita >= 0)",
  validarNovaVigencia("contrato", {
    ...FORM_CONTRATO,
    valores: { ...FORM_CONTRATO.valores, ot_factor: "0" },
  }),
  [],
);
verificar(
  "C9. custo e valor acordado: um campo cada",
  [CAMPOS_DA_VIGENCIA.colaborador.length, CAMPOS_DA_VIGENCIA.operacao.length],
  [1, 1],
);
verificar(
  "C10. lerNumero aceita vírgula e recusa milhar e negativo",
  [lerNumero("12,5"), lerNumero("12.5"), lerNumero("1.234,56"), lerNumero("-3"), lerNumero(" 7 ")],
  [12.5, 12.5, null, null, 7],
);

const reg = montarRegistro("contrato", "c-1", FORM_CONTRATO);
verificar(
  "C11. montarRegistro (contrato): RPC e parâmetros nomeados",
  [reg.rpc, reg.params],
  [
    "registrar_condicao_contrato",
    {
      p_contract_id: "c-1",
      p_valid_from: "2026-11-01",
      p_reason: "Reajuste anual",
      p_valid_to: null,
      p_encerrar_anterior: true,
      p_daily_rate: 130.5,
      p_shift_hours: 8,
      p_ot_factor: 1.5,
      p_ot_tolerance_min: 10,
    },
  ],
);
verificar(
  "C12. montarRegistro (colaborador e operação)",
  [
    montarRegistro("colaborador", "e-1", {
      inicio: "2026-11-01",
      motivo: "m",
      valores: { daily_cost: "90" },
      encerrarAnterior: false,
    }),
    montarRegistro("operacao", "o-1", {
      inicio: "2026-11-01",
      motivo: "m",
      valores: { agreed_amount: "250,00" },
      encerrarAnterior: true,
    }).params.p_agreed_amount,
  ],
  [
    {
      rpc: "registrar_custo_colaborador",
      params: {
        p_employee_id: "e-1",
        p_valid_from: "2026-11-01",
        p_reason: "m",
        p_valid_to: null,
        p_encerrar_anterior: false,
        p_daily_cost: 90,
      },
    },
    250,
  ],
);
verificar(
  "C13. montarRegistro recusa formulário inválido e entidade vazia",
  [
    (() => {
      try {
        montarRegistro("contrato", "c-1", { ...FORM_CONTRATO, motivo: "" });
        return "aceitou";
      } catch {
        return "recusou";
      }
    })(),
    (() => {
      try {
        montarRegistro("contrato", "", FORM_CONTRATO);
        return "aceitou";
      } catch {
        return "recusou";
      }
    })(),
  ],
  ["recusou", "recusou"],
);
verificar(
  "C14. o motivo enviado é aparado",
  montarRegistro("contrato", "c-1", { ...FORM_CONTRATO, motivo: "  Reajuste  " }).params.p_reason,
  "Reajuste",
);

// Os nomes e parâmetros conferem com as migrations.
const sqlTodas = [
  "20261020180000_023_registro_vigencias_financeiras.sql",
  "20261020210000_024_valores_acordados_operacao.sql",
]
  .map((f) => ler(`supabase/migrations/${f}`).replace(/^\s*--.*$/gm, ""))
  .join("\n");
function parametrosDoSql(nome) {
  const m = sqlTodas.match(
    new RegExp(`create or replace function public\\.${nome}\\(([\\s\\S]*?)\\)\\s*returns`),
  );
  return m ? [...m[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]).sort() : null;
}
for (const tipo of ["contrato", "colaborador", "operacao"]) {
  const enviados = Object.keys(
    montarRegistro(tipo, "x", {
      inicio: "2026-11-01",
      motivo: "m",
      encerrarAnterior: true,
      valores: Object.fromEntries(CAMPOS_DA_VIGENCIA[tipo].map((c) => [c.chave, "1"])),
    }).params,
  ).sort();
  verificar(
    `C15. ${tipo}: a RPC existe e os parâmetros enviados são exatamente os dela`,
    [
      RPC_DE_REGISTRO[tipo] === RPC_VIGENCIAS[tipo].registrar,
      JSON.stringify(enviados) === JSON.stringify(parametrosDoSql(RPC_DE_REGISTRO[tipo])),
    ],
    [true, true],
  );
  verificar(
    `C16. ${tipo}: o id vai no parâmetro certo`,
    enviados.includes(PARAM_DO_ID[tipo]),
    true,
  );
}

// ---------------------------------------------------------------------------
// D. Condição aplicável à data trabalhada
// ---------------------------------------------------------------------------

// Regressão do QA de navegador (C05-B4.8): o formulário precisa permitir o FIM da vigência, para
// registrar um período passado quando já existe uma versão futura (senão o banco recusa a sobreposição).
verificar(
  "C17. fim da vigência: vazio = em aberto (p_valid_to nulo)",
  montarRegistro("contrato", "c-1", FORM_CONTRATO).params.p_valid_to,
  null,
);
verificar(
  "C18. fim informado vai em p_valid_to",
  montarRegistro("contrato", "c-1", { ...FORM_CONTRATO, fim: "2026-12-31" }).params.p_valid_to,
  "2026-12-31",
);
verificar(
  "C19. fim anterior ou igual ao início é recusado; data inválida também",
  [
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, fim: "2026-11-01" }).length,
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, fim: "2026-10-01" }).length,
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, fim: "xx" }).length,
    validarNovaVigencia("contrato", { ...FORM_CONTRATO, fim: "2026-12-01" }).length,
  ],
  [1, 1, 1, 0],
);
verificar(
  "C20. a tela oferece o campo de fim e o envia",
  /vigencia-fim-nova/.test(ler("src/app/(painel)/_components/vigencias.tsx")) &&
    /fim: fimNova/.test(ler("src/app/(painel)/_components/vigencias.tsx")),
  true,
);

console.log("D. Condição aplicável à data trabalhada (U3)");

const tc = (id, de, ate, taxa) => ({
  ...base,
  id,
  valid_from: de,
  valid_to: ate,
  active: true,
  daily_rate: taxa,
  shift_hours: 8,
  ot_factor: 1.5,
  ot_tolerance_min: 10,
});
const to = (id, de, ate, valor) => ({
  ...base,
  id,
  valid_from: de,
  valid_to: ate,
  active: true,
  agreed_amount: valor,
});
const tk = (id, de, ate, custo) => ({
  ...base,
  id,
  valid_from: de,
  valid_to: ate,
  active: true,
  daily_cost: custo,
});
const CUSTOS = [tk("k1", "2026-01-01", null, 70)];

const c1 = resolverCondicaoDoDia({
  data: "2026-03-01",
  contratoId: "C",
  termosContrato: [tc("t1", "2026-01-01", "2026-07-01", 100), tc("t2", "2026-07-01", null, 130)],
  termosOperacao: [],
  termosCusto: CUSTOS,
});
verificar(
  "D1. contrato: a versão da DATA, não a mais recente",
  [c1.ok, c1.regras?.daily_rate, c1.custoDiario],
  [true, 100, 70],
);
verificar(
  "D2. a origem diz o tipo e o período",
  /^Contrato · vigência 01\/01\/2026 → 01\/07\/2026$/.test(c1.origem),
  true,
);
const c2 = resolverCondicaoDoDia({
  data: "2026-08-01",
  contratoId: "C",
  termosContrato: [tc("t1", "2026-01-01", "2026-07-01", 100), tc("t2", "2026-07-01", null, 130)],
  termosOperacao: [],
  termosCusto: CUSTOS,
});
verificar(
  "D3. depois do reajuste: a nova taxa; a origem diz 'em aberto'",
  [c2.regras?.daily_rate, /em aberto/.test(c2.origem)],
  [130, true],
);
const c3 = resolverCondicaoDoDia({
  data: "2026-03-01",
  contratoId: null,
  termosContrato: [],
  termosOperacao: [to("o1", "2026-01-01", null, 200)],
  termosCusto: CUSTOS,
});
verificar(
  "D4. sem contrato: valor acordado, jornada 8, fator 1, tolerância 10",
  [c3.ok, c3.regras],
  [true, { daily_rate: 200, shift_hours: 8, ot_factor: 1, ot_tolerance_min: 10 }],
);
const c4 = resolverCondicaoDoDia({
  data: "2026-03-01",
  contratoId: "C",
  termosContrato: [tc("t1", "2026-01-01", null, 100)],
  termosOperacao: [to("o1", "2026-01-01", null, 200)],
  termosCusto: CUSTOS,
});
verificar(
  "D5. contrato e valor acordado na mesma data: ambíguo, recusado",
  [c4.ok, /ambígua/.test(c4.motivo ?? "")],
  [false, true],
);
const c5 = resolverCondicaoDoDia({
  data: "2025-12-31",
  contratoId: "C",
  termosContrato: [tc("t1", "2026-01-01", null, 100)],
  termosOperacao: [],
  termosCusto: CUSTOS,
});
verificar(
  "D6. sem vigência: recusa e diz que a taxa atual NÃO é usada",
  [
    c5.ok,
    /taxa atual do cadastro não é usada/.test(c5.motivo ?? ""),
    /31\/12\/2025/.test(c5.motivo ?? ""),
  ],
  [false, true, true],
);
const c6 = resolverCondicaoDoDia({
  data: "2026-03-01",
  contratoId: "C",
  termosContrato: [tc("t1", "2026-01-01", null, 100)],
  termosOperacao: [],
  termosCusto: [],
});
verificar(
  "D7. sem custo do colaborador na data: recusa",
  [c6.ok, /custo vigente/.test(c6.motivo ?? "")],
  [false, true],
);
const c7 = resolverCondicaoDoDia({
  data: "2026-03-01",
  contratoId: null,
  termosContrato: [tc("t1", "2026-01-01", null, 100)],
  termosOperacao: [],
  termosCusto: CUSTOS,
});
verificar(
  "D8. operação sem contrato ignora versões de contrato e fica sem vigência",
  [c7.ok, /a operação/.test(c7.motivo ?? "")],
  [false, true],
);
verificar(
  "D9. valores numéricos em texto (numeric do PostgREST) são convertidos",
  resolverCondicaoDoDia({
    data: "2026-03-01",
    contratoId: "C",
    termosContrato: [tc("t1", "2026-01-01", null, "100.50")],
    termosOperacao: [],
    termosCusto: [tk("k", "2026-01-01", null, "70.25")],
  }).regras?.daily_rate,
  100.5,
);

// ---------------------------------------------------------------------------
// E. Valor de cada linha de apontamento
// ---------------------------------------------------------------------------

console.log("E. Valor de cada linha de apontamento (U3)");

const CADASTRO = { daily_rate: 999, shift_hours: 8, ot_factor: 3, ot_tolerance_min: 10 }; // absurdo de propósito
const CALC = ({ regras, custoDiario, plannedMinutes }) =>
  calcEntry({
    status: "present",
    checkIn: "06:00",
    checkOut: "17:00",
    breakMinutes: 60,
    plannedMinutes,
    rules: regras,
    employeeDailyCost: custoDiario,
  });
const CONDICAO = {
  ok: true,
  regras: { daily_rate: 100, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 },
  custoDiario: 70,
  origem: "Contrato · vigência 01/01/2026 → em aberto",
};
const GRAVADO = {
  status: "present",
  billed_amount: 137.5,
  cost_amount: 87.5,
  overtime_minutes: 120,
  daily_rate_snapshot: 100,
  daily_cost_snapshot: 70,
  shift_hours_snapshot: 8,
  ot_factor_snapshot: 1.5,
  ot_tolerance_snapshot: 10,
  planned_minutes_snapshot: 480,
  terms_origin: "versao",
};
const entrada = (extra) =>
  valorDaLinha({
    estado: LIGADO,
    status: "present",
    gravada: false,
    tocada: false,
    gravado: null,
    regrasDoCadastro: CADASTRO,
    custoDoCadastro: 555,
    condicaoDoDia: CONDICAO,
    plannedMinutes: 480,
    calcular: CALC,
    ...extra,
  });

const referencia = CALC({ regras: CADASTRO, custoDiario: 555, plannedMinutes: 480 });
const d1 = entrada({ estado: DESLIGADO, gravada: true, tocada: false, gravado: GRAVADO });
verificar(
  "E1. DESLIGADO: sempre a prévia de sempre com as taxas do cadastro (inclusive em linha gravada)",
  [d1.tipo, d1.billed, d1.cost, d1.overtime, d1.bloqueiaSalvar],
  ["previa", referencia.billedAmount, referencia.costAmount, referencia.overtimeMinutes, false],
);
const l1 = entrada({ gravada: true, tocada: false, gravado: GRAVADO });
verificar(
  "E2. LIGADO, linha gravada e não tocada: os valores do BANCO",
  [l1.tipo, l1.billed, l1.cost, l1.overtime, l1.origem],
  ["banco", 137.5, 87.5, 120, "Vigência do contrato"],
);
const l2 = entrada({ gravada: true, tocada: true, gravado: GRAVADO });
verificar(
  "E3. LIGADO, gravada e editada: prévia com o PREÇO CONGELADO (100/70), nunca o do cadastro (999/555)",
  [l2.tipo, l2.billed, l2.cost, l2.bloqueiaSalvar],
  ["previa", 137.5, 87.5, false],
);
const congelado150 = { ...GRAVADO, daily_rate_snapshot: 150, daily_cost_snapshot: 80 };
const l2b = entrada({
  gravada: true,
  tocada: true,
  gravado: congelado150,
  condicaoDoDia: CONDICAO,
});
verificar(
  "E4. a vigência de hoje (100) NÃO substitui o snapshot (150) numa linha gravada",
  l2b.billed > 137.5,
  true,
);
const l3 = entrada({
  gravada: true,
  tocada: true,
  gravado: { ...GRAVADO, terms_origin: null, daily_rate_snapshot: 120, shift_hours_snapshot: null },
});
verificar(
  "E5. LIGADO, legado editado: indisponível e o salvamento fica bloqueado",
  [l3.tipo, l3.bloqueiaSalvar, /regulariza/i.test(l3.aviso ?? "")],
  ["indisponivel", true, true],
);
const l3b = entrada({ gravada: true, tocada: false, gravado: { ...GRAVADO, terms_origin: null } });
verificar(
  "E6. LIGADO, legado NÃO editado: mostra o que o banco tem, origem 'Legado'",
  [l3b.tipo, l3b.billed, l3b.origem],
  ["banco", 137.5, "Legado (sem vigência registrada)"],
);
const l4 = entrada({});
verificar(
  "E7. LIGADO, linha nova: prévia pela vigência da data, com a origem",
  [l4.tipo, l4.billed, l4.cost, l4.origem],
  ["previa", 137.5, 87.5, CONDICAO.origem],
);
const l5 = entrada({
  condicaoDoDia: { ok: false, motivo: "Sem condição financeira vigente em 31/12/2025" },
});
verificar(
  "E8. LIGADO, linha nova sem vigência: indisponível, bloqueia o salvamento e mostra o motivo",
  [l5.tipo, l5.bloqueiaSalvar, l5.aviso],
  ["indisponivel", true, "Sem condição financeira vigente em 31/12/2025"],
);
const l5b = entrada({ condicaoDoDia: null });
verificar(
  "E9. LIGADO, vigências ainda carregando: indisponível e bloqueado (nunca usa o cadastro)",
  [l5b.tipo, l5b.bloqueiaSalvar, l5b.billed],
  ["indisponivel", true, 0],
);
const l6 = entrada({ status: "absent", condicaoDoDia: { ok: false, motivo: "sem vigência" } });
verificar(
  "E10. LIGADO, FALTA nova sem vigência: zero e NÃO bloqueia",
  [l6.tipo, l6.billed, l6.cost, l6.bloqueiaSalvar],
  ["previa", 0, 0, false],
);
const l7 = entrada({
  status: "present",
  gravada: true,
  tocada: true,
  gravado: {
    ...GRAVADO,
    status: "absent",
    billed_amount: 0,
    cost_amount: 0,
    overtime_minutes: 0,
    terms_origin: null,
    daily_rate_snapshot: 0,
    daily_cost_snapshot: 0,
    shift_hours_snapshot: null,
    ot_factor_snapshot: null,
    ot_tolerance_snapshot: null,
    planned_minutes_snapshot: null,
  },
});
verificar(
  "E11. LIGADO, falta -> presença: reprecifica pela vigência da data",
  [l7.tipo, l7.billed, /reprecifica/i.test(l7.aviso ?? "")],
  ["previa", 137.5, true],
);
const l7b = entrada({
  status: "present",
  gravada: true,
  tocada: true,
  gravado: {
    ...GRAVADO,
    status: "absent",
    billed_amount: 0,
    cost_amount: 0,
    overtime_minutes: 0,
    terms_origin: null,
    daily_rate_snapshot: 0,
    daily_cost_snapshot: 0,
    shift_hours_snapshot: null,
    ot_factor_snapshot: null,
    ot_tolerance_snapshot: null,
    planned_minutes_snapshot: null,
  },
  condicaoDoDia: { ok: false, motivo: "Sem vigência" },
});
verificar(
  "E12. LIGADO, falta -> presença sem vigência: bloqueia (o banco recusaria com P0002)",
  [l7b.tipo, l7b.bloqueiaSalvar],
  ["indisponivel", true],
);
const l8 = entrada({ status: "absent", gravada: true, tocada: true, gravado: GRAVADO });
verificar(
  "E13. LIGADO, presença -> falta: zero",
  [l8.tipo, l8.billed, l8.cost, l8.overtime, l8.bloqueiaSalvar],
  ["previa", 0, 0, 0, false],
);
const l8b = entrada({
  status: "absent",
  gravada: true,
  tocada: true,
  gravado: { ...GRAVADO, terms_origin: null },
});
verificar(
  "E13b. LIGADO, legado presença -> falta: indisponível e bloqueado (o banco recusa com 55000)",
  [l8b.tipo, l8b.billed, l8b.bloqueiaSalvar, /regulariza/i.test(l8b.aviso ?? "")],
  ["indisponivel", 0, true, true],
);
const l8c = entrada({
  status: "absent",
  gravada: true,
  tocada: true,
  gravado: { ...GRAVADO, status: "absent", terms_origin: null },
});
verificar(
  "E13c. LIGADO, falta já gravada permanece falta: zero e NÃO bloqueia",
  [l8c.tipo, l8c.billed, l8c.bloqueiaSalvar],
  ["previa", 0, false],
);
for (const estado of [DESCONHECIDO, CARREGANDO]) {
  const g = entrada({ estado, gravada: true, tocada: false, gravado: GRAVADO });
  const n = entrada({ estado });
  const t = entrada({ estado, gravada: true, tocada: true, gravado: GRAVADO });
  verificar(
    `E14. ${estado.tag}: gravada = valores do banco; nova ou editada = indisponível (sem prévia, sem usar o cadastro)`,
    [g.tipo, g.billed, n.tipo, n.billed, t.tipo, n.bloqueiaSalvar],
    ["banco", 137.5, "indisponivel", 0, "indisponivel", false],
  );
}
const soma = somarLinhas([l1, l4, l5, l8]);
verificar(
  "E15. a soma ignora linhas indisponíveis e as conta",
  [soma.billed, soma.cost, soma.overtime, soma.indisponiveis],
  [275, 175, 240, 1],
);
verificar(
  "E16. com o motor LIGADO o cadastro nunca interfere: variar o cadastro não muda nenhum valor",
  (() => {
    const a = entrada({});
    const b = entrada({ regrasDoCadastro: { ...CADASTRO, daily_rate: 1 }, custoDoCadastro: 1 });
    const c = entrada({ gravada: true, tocada: true, gravado: GRAVADO });
    const d = entrada({
      gravada: true,
      tocada: true,
      gravado: GRAVADO,
      regrasDoCadastro: { ...CADASTRO, daily_rate: 1 },
      custoDoCadastro: 1,
    });
    return [a.billed === b.billed, c.billed === d.billed];
  })(),
  [true, true],
);

// ---------------------------------------------------------------------------
// F. Turnos (U7)
// ---------------------------------------------------------------------------

console.log("F. Turnos (U7)");

const ERRO_TURNO = {
  code: "23514",
  message:
    "Este turno já tem apontamentos; cadastre um turno novo em vez de alterar o horário do existente.",
};
verificar(
  "F1. reconhece a recusa do trigger (23514 + mensagem)",
  ehTurnoProtegido(ERRO_TURNO),
  true,
);
verificar(
  "F2. não confunde com outro 23514 nem com outro código",
  [
    ehTurnoProtegido({ code: "23514", message: "violates check constraint shifts_break" }),
    ehTurnoProtegido({ code: "42501", message: ERRO_TURNO.message }),
    ehTurnoProtegido(null),
    ehTurnoProtegido("x"),
  ],
  [false, false, false, false],
);
verificar(
  "F3. a tela mostra a explicação, não a mensagem crua",
  mensagemDoErro(ERRO_TURNO),
  MENSAGEM_TURNO_PROTEGIDO,
);
verificar(
  "F4. outro 23514 segue com o texto genérico",
  mensagemDoErro({ code: "23514", message: 'new row violates check constraint "x"' }),
  "Os dados informados não atendem a uma regra de validação.",
);
verificar(
  "F5. a explicação diz o que fazer e o que continua editável",
  [
    /turno novo/.test(MENSAGEM_TURNO_PROTEGIDO),
    /inative o antigo/.test(MENSAGEM_TURNO_PROTEGIDO),
    /Nome e status continuam editáveis/.test(MENSAGEM_TURNO_PROTEGIDO),
  ],
  [true, true, true],
);
const folhas = [
  { id: "f1", shift_id: "s1" },
  { id: "f2", shift_id: "s2" },
  { id: "f3", shift_id: null },
];
verificar(
  "F6. turno usado = tem folha COM linha; folha vazia não conta",
  [
    turnoTemApontamentos("s1", folhas, [{ timesheet_id: "f1" }]),
    turnoTemApontamentos("s2", folhas, [{ timesheet_id: "f1" }]),
    turnoTemApontamentos("s1", folhas, []),
  ],
  [true, false, false],
);
verificar(
  "F7. jornada protegida: usado + (ligado | desconhecido | carregando); desligado preserva o formulário antigo",
  [
    jornadaDoTurnoProtegida(DESLIGADO, true),
    jornadaDoTurnoProtegida(LIGADO, true),
    jornadaDoTurnoProtegida(DESCONHECIDO, true),
    jornadaDoTurnoProtegida(CARREGANDO, true),
    jornadaDoTurnoProtegida(LIGADO, false),
  ],
  [false, true, true, true, false],
);
const turno = {
  id: "s1",
  name: "Manhã",
  start_time: "06:00:00",
  end_time: "15:00:00",
  break_minutes: 60,
  crosses_midnight: false,
  operation_id: "o1",
};
verificar(
  "F8. novo turno a partir do existente: mesmo horário, nome '(novo)', sem id, ativo",
  novoTurnoAPartir(turno),
  {
    id: "",
    operation_id: "o1",
    name: "Manhã (novo)",
    start_time: "06:00",
    end_time: "15:00",
    break_minutes: 60,
    crosses_midnight: false,
    status: "active",
  },
);

// ---------------------------------------------------------------------------
// G. Forma das telas
// ---------------------------------------------------------------------------

console.log("G. Forma das telas");

const clientes = ler("src/app/(painel)/clientes/painel-clientes.tsx");
const colaboradores = ler("src/app/(painel)/colaboradores/painel-colaboradores.tsx");
const operacoes = ler("src/app/(painel)/operacoes/painel-operacoes.tsx");
const apontamentos = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
const dados = ler("src/lib/vigencias-dados.ts");
const ui = ler("src/lib/vigencias-ui.ts");
const componente = ler("src/app/(painel)/_components/vigencias.tsx");
const operacional = ler("src/app/(painel)/operacional/painel-operacional.tsx");

for (const [nome, fonte] of [
  ["Clientes", clientes],
  ["Colaboradores", colaboradores],
  ["Operações", operacoes],
  ["Apontamentos", apontamentos],
]) {
  verificar(
    `G1. ${nome}: lê o estado do motor e mostra a faixa de aviso`,
    /useEstadoDoMotor\(\)/.test(fonte) && /<AvisoDoMotor estado=\{estadoDoMotor\} \/>/.test(fonte),
    true,
  );
}
verificar(
  "G2. Clientes: as colunas de taxa só entram no payload com o motor desligado (ou contrato novo com o motor ligado)",
  /if \(\s*modoDeTaxa === "direta" \|\| \(!contractForm\.id && modoDeTaxa === "por-vigencia"\)\s*\) \{\s*payload\["daily_rate"\]/.test(
    clientes,
  ) && !/daily_rate: Number\(contractForm\.daily_rate\) \|\| 0,\s*\n\s*shift_hours/.test(clientes),
  true,
);
verificar(
  "G3. Clientes: taxa de contrato existente fica travada fora do modo direto; novo contrato bloqueado com estado desconhecido",
  /const taxaTravada =\s*modoDeTaxa !== "direta"/.test(clientes) &&
    /modoDeTaxa === "bloqueada"/.test(clientes),
  true,
);
verificar(
  "G4. Clientes: contrato novo com o motor ligado nasce com a vigência inicial (RPC)",
  /useCriarComVigencia\("contrato", \["contracts"\]/.test(clientes) &&
    /Cadastro inicial do contrato/.test(clientes),
  true,
);
verificar(
  "G5. Clientes: o histórico de vigências do contrato aparece no formulário do contrato existente",
  /<HistoricoDeVigencias\s+tipo="contrato"/.test(clientes),
  true,
);
verificar(
  "G6. Colaboradores: o custo só entra no payload com o motor desligado (ou cadastro novo com motor ligado)",
  /modoDeCusto === "direta" \|\| \(!form\.id && modoDeCusto === "por-vigencia"\)/.test(
    colaboradores,
  ) && !/daily_cost: Number\(form\.daily_cost\) \|\| 0,\s*\n\s*status/.test(colaboradores),
  true,
);
verificar(
  "G7. Colaboradores: histórico do custo e registro de reajuste",
  /<HistoricoDeVigencias\s+tipo="colaborador"/.test(colaboradores) &&
    /useCriarComVigencia\("colaborador", \["employees"\]/.test(colaboradores),
  true,
);
verificar(
  "G8. Operações: valor acordado só no payload com o motor desligado (ou operação nova); contract_id nunca é alterado pela lógica",
  /const enviaValor =\s+modoDeValor === "direta"/.test(operacoes) &&
    /contract_id: opForm\.contract_id \|\| null/.test(operacoes) &&
    !/payload\["contract_id"\]/.test(operacoes),
  true,
);
verificar(
  "G9. Operações: histórico do valor acordado só para operação SEM contrato",
  /opForm\.id && !opForm\.contract_id \?[\s\S]{0,200}<HistoricoDeVigencias\s+tipo="operacao"/.test(
    operacoes,
  ),
  true,
);
verificar(
  "G10. Operações (U7): turno usado com jornada protegida só envia nome e status, trava os campos e oferece novo turno",
  /if \(!jornadaTravada\) \{\s*payload\["start_time"\]/.test(operacoes) &&
    /disabled=\{jornadaTravada\}/.test(operacoes) &&
    /Criar novo turno a partir deste/.test(operacoes) &&
    /novoTurnoAPartir\(atual\)/.test(operacoes),
  true,
);
verificar(
  "G11. Operações (U7): o congelamento NÃO é habilitado por código algum nesta etapa",
  /enable trigger|enable\s+trg_shifts_congela/i.test(operacoes + dados + componente + ui),
  false,
);
verificar(
  "G12. Apontamentos: o valor mostrado vem de valorDaLinha; totais por somarLinhas; salvamento bloqueado por linha sem condição",
  /valorDaLinha\(\{/.test(apontamentos) &&
    /somarLinhas\(/.test(apontamentos) &&
    /linhasBloqueadas\.length > 0/.test(apontamentos),
  true,
);
verificar(
  "G13. Apontamentos: continua salvando só linhas alteradas, sem valor financeiro no payload (U1 e U2)",
  /linhasParaSalvar\(/.test(apontamentos) &&
    /montarCarga\(/.test(apontamentos) &&
    !/billed_amount|cost_amount|daily_rate_snapshot/.test(
      apontamentos.slice(
        apontamentos.indexOf("montarCarga("),
        apontamentos.indexOf("montarCarga(") + 600,
      ),
    ),
  true,
);
verificar(
  "G14. Apontamentos: busca as versões só com o motor LIGADO",
  /habilitado: estadoDoMotor\.tag === "ligado"/.test(apontamentos),
  true,
);
verificar(
  "G15. A tela do operador não importa vigências, motor nem valor financeiro",
  /vigencias|financial_engine|apontamentos-financeiro|AvisoDoMotor/.test(operacional),
  false,
);

// ---------------------------------------------------------------------------
// H. Camada de dados e segurança da transição
// ---------------------------------------------------------------------------

console.log("H. Camada de dados e segurança da transição");

verificar(
  'H1. falha da consulta NUNCA vira desligado: o único `tag: "desligado"` está em interpretarEstadoDoMotor',
  (ui.match(/tag: "desligado"/g) ?? []).length === 2 &&
    /\? \{ tag: "ligado"[^}]*\}\s*:\s*\{ tag: "desligado" \}/.test(ui) &&
    !/tag: "desligado"/.test(dados),
  true,
);
verificar(
  "H2. erro de consulta cai no ramo desconhecido (isError e erro do RPC)",
  /consulta\.isError\) return interpretarEstadoDoMotor\(null/.test(dados) &&
    /interpretarEstadoDoMotor\(consulta\.data\.data, consulta\.data\.error\)/.test(dados),
  true,
);
verificar(
  "H2b. a consulta do estado não tem valor inicial nem placeholder: sem resposta é `carregando`, nunca `desligado`",
  !/placeholderData|initialData/.test(dados) &&
    /if \(!consulta\.data\) return \{ tag: "carregando" \}/.test(dados),
  true,
);
verificar(
  "H3. a camada de dados só chama RPCs conhecidas e só LÊ as tabelas de versões",
  !/\.(update|upsert|delete)\(/.test(dados) &&
    /RPC_VIGENCIAS\.motor\.estado/.test(dados) &&
    /RPC_VIGENCIAS\[tipo\]\.encerrar/.test(dados) &&
    /RPC_VIGENCIAS\[tipo\]\.aposentar/.test(dados),
  true,
);
verificar(
  "H4. nenhuma chamada de ativação, sincronização ou regularização nas telas/dados",
  /alterar_motor_vigencia|sincronizar_colunas_legadas|regularizar_apontamento_legado|RPC_VIGENCIAS\.motor\.(alterar|sincronizarColunas|regularizarApontamento)/.test(
    dados + componente + clientes + colaboradores + operacoes + apontamentos,
  ),
  false,
);
verificar(
  "H5. nenhum segredo ou service_role na camada de dados",
  /service_role|SUPABASE_SERVICE|SECRET/i.test(dados + componente),
  false,
);
verificar(
  "H6. o componente de histórico usa só os hooks (sem acesso direto ao banco)",
  !/\.from\(|\.rpc\(|criarClienteNavegador/.test(componente),
  true,
);
verificar(
  "H7. motivo é exigido na tela antes de qualquer RPC (formulário, encerrar e aposentar)",
  /motivoFim\.trim\(\) === ""/.test(componente) &&
    /motivoApos\.trim\(\) === ""/.test(componente) &&
    /erros\.length > 0/.test(componente),
  true,
);
verificar(
  "H8. o cadastro novo com motor ligado é UMA chamada atômica: a tela não faz INSERT da entidade",
  dados.includes("montarCadastroAtomico(tipo, v.linha, v.form)") && !/\.insert\(/.test(dados),
  true,
);
verificar(
  "H9. a mensagem de 'cadastro criado, mas a vigência não foi registrada' deixou de existir: não há estado parcial",
  !/O cadastro foi criado, mas a vigência inicial não foi registrada/.test(dados),
  true,
);
verificar(
  "H10. a camada de dados usa o cliente tipado do Database gerado, sem o tipo mínimo provisório",
  !/ClienteMinimo/.test(dados) && /const cliente = \(\) => criarClienteNavegador\(\);/.test(dados),
  true,
);

// ---------------------------------------------------------------------------
// I. Migrations intactas, suíte e CI
// ---------------------------------------------------------------------------

console.log("I. Migrations intactas, scripts e CI");

const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();
verificar(
  "I1. a 028 (contrato da operação protegido) é a última migration, a 027, a 026 e a 025 não são a última e a 019 está ausente",
  [
    migrations.length,
    migrations[migrations.length - 1],
    migrations.some((m) => m.includes("_019_")),
  ],
  [33, "20261023120000_028_protege_contrato_da_operacao.sql", false],
);
verificar(
  "I2. a migration 025 não foi alterada (SHA-256 aprovado na homologação)",
  createHash("sha256")
    .update(
      readFileSync(
        new URL(
          "../supabase/migrations/20261021100000_025_motor_financeiro_por_vigencia.sql",
          import.meta.url,
        ),
      ),
    )
    .digest("hex"),
  "a480b46c307f84cefd6d9fefecdcc8d306b496c60380f51cbbbb52eff009620b",
);
const pacote = JSON.parse(ler("package.json"));
verificar(
  "I3. o script test:interfaces-vigencia existe",
  typeof pacote.scripts["test:interfaces-vigencia"],
  "string",
);
const ci = ler(".github/workflows/ci.yml");
verificar(
  "I4. o CI executa a suíte e conserva todas as outras",
  /npm run test:interfaces-vigencia/.test(ci) &&
    Object.keys(pacote.scripts)
      .filter((n) => n.startsWith("test:"))
      .every((n) => ci.includes(`npm run ${n}`)),
  true,
);

// ---------------------------------------------------------------------------
// J. Cadastro atômico de entidade + vigência inicial (C05-B5.1, migration 026)
// ---------------------------------------------------------------------------

console.log("J. Cadastro atômico (026)");

const sql026 = ler("supabase/migrations/20261022120000_026_cadastro_atomico_com_vigencia.sql");
const corpoSql = sql026.replace(/^\s*--.*$/gm, "");
verificar(
  "J1. a 026 define as três funções de cadastro, todas SECURITY INVOKER (sem SECURITY DEFINER)",
  [
    /create or replace function public\.criar_contrato_com_vigencia\(/.test(corpoSql),
    /create or replace function public\.criar_colaborador_com_vigencia\(/.test(corpoSql),
    /create or replace function public\.criar_operacao_com_vigencia\(/.test(corpoSql),
    (corpoSql.match(/security invoker/g) ?? []).length,
    /security definer/i.test(corpoSql),
  ],
  [true, true, true, 3, false],
);
verificar(
  "J2. cada função registra a vigência pela RPC existente (023/024), na mesma chamada",
  /perform public\.registrar_condicao_contrato\(/.test(corpoSql) &&
    /perform public\.registrar_custo_colaborador\(/.test(corpoSql) &&
    /perform public\.registrar_valor_acordado_operacao\(/.test(corpoSql),
  true,
);
verificar(
  "J3. EXECUTE só para authenticated; revoga de public, anon, service_role e do papel operacional",
  /revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
    corpoSql,
  ) &&
    /grant execute on function %s to authenticated/.test(corpoSql) &&
    !/grant [^;]*(anon|service_role|public)/.test(corpoSql.replace(/revoke[^;]*;/g, "")),
  true,
);
verificar(
  "J4. a 026 não altera policy, tabela, trigger nem grant de tabela (só cria as três funções)",
  !/create policy|drop policy|alter table|create trigger|drop trigger|grant [^;]* on table|drop function|create table/i.test(
    corpoSql,
  ),
  true,
);
verificar(
  "J5. nenhuma migration 021–025 foi tocada pela 026 (a 025 mantém o SHA aprovado — ver I2)",
  ["_021_", "_022_", "_023_", "_024_", "_025_"].every(
    (n) => migrations.filter((m) => m.includes(n)).length === 1,
  ),
  true,
);
const paramsDoSql = (nome) =>
  [
    ...corpoSql.match(new RegExp(`function public\\.${nome}\\(([^)]*)\\)`))[1].matchAll(/\bp_\w+/g),
  ].map((m) => m[0]);
const cadastro = (tipo, linha, form) => montarCadastroAtomico(tipo, linha, form);
const FORM_C = {
  inicio: "2026-01-01",
  motivo: "Cadastro inicial do contrato",
  valores: { daily_rate: "120", shift_hours: "8", ot_factor: "1.5", ot_tolerance_min: "10" },
  encerrarAnterior: false,
};
const LINHA_C = {
  client_id: "cli-1",
  name: "KA",
  valid_from: "2026-01-01",
  valid_to: null,
  status: "active",
};
const FORM_K = {
  inicio: "2026-02-01",
  motivo: "Cadastro inicial do colaborador",
  valores: { daily_cost: "80" },
  encerrarAnterior: false,
};
const LINHA_K = { name: "Ana", doc: null, role: "Ajudante", phone: null, status: "active" };
const FORM_O = {
  inicio: "2026-03-01",
  motivo: "Cadastro inicial da operação",
  valores: { agreed_amount: "100" },
  encerrarAnterior: false,
};
const LINHA_O = {
  client_id: "cli-1",
  contract_id: null,
  type: "fixed",
  name: "Op",
  site: null,
  operation_date: null,
  status: "active",
  notes: null,
};
for (const [tipo, rpc, linha, form] of [
  ["contrato", "criar_contrato_com_vigencia", LINHA_C, FORM_C],
  ["colaborador", "criar_colaborador_com_vigencia", LINHA_K, FORM_K],
  ["operacao", "criar_operacao_com_vigencia", LINHA_O, FORM_O],
]) {
  const r = cadastro(tipo, linha, form);
  verificar(
    `J6. ${tipo}: a RPC é ${rpc} (RPC_DE_CADASTRO)`,
    [r.rpc, RPC_DE_CADASTRO[tipo]],
    [rpc, rpc],
  );
  verificar(
    `J7. ${tipo}: os parâmetros enviados são exatamente os da função SQL (nomes e quantidade)`,
    Object.keys(r.params).sort(),
    paramsDoSql(rpc).sort(),
  );
}
verificar(
  "J8. contrato: números lidos do formulário, fim do contrato vem do cadastro e a vigência nasce no início informado",
  cadastro("contrato", { ...LINHA_C, valid_to: "2027-01-01" }, FORM_C).params,
  {
    p_client_id: "cli-1",
    p_name: "KA",
    p_valid_from: "2026-01-01",
    p_valid_to: "2027-01-01",
    p_status: "active",
    p_daily_rate: 120,
    p_shift_hours: 8,
    p_ot_factor: 1.5,
    p_ot_tolerance_min: 10,
    p_reason: "Cadastro inicial do contrato",
  },
);
verificar(
  "J9. colaborador: custo numérico, início da vigência do formulário, vazios viram nulo",
  cadastro("colaborador", { ...LINHA_K, doc: "" }, FORM_K).params,
  {
    p_name: "Ana",
    p_doc: null,
    p_role: "Ajudante",
    p_phone: null,
    p_status: "active",
    p_daily_cost: 80,
    p_valid_from: "2026-02-01",
    p_reason: "Cadastro inicial do colaborador",
  },
);
verificar(
  "J10. operação: valor acordado numérico, sem contrato",
  cadastro("operacao", LINHA_O, FORM_O).params["p_agreed_amount"],
  100,
);
const lanca = (fn) => {
  try {
    fn();
    return "não lançou";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};
verificar(
  "J11. operação COM contrato é recusada antes de qualquer chamada",
  lanca(() => cadastro("operacao", { ...LINHA_O, contract_id: "c-1" }, FORM_O)),
  "Operação com contrato usa o preço do contrato, sem valor acordado.",
);
verificar(
  "J12. formulário inválido (sem motivo) é recusado antes de qualquer chamada, nos três tipos",
  [
    lanca(() => cadastro("contrato", LINHA_C, { ...FORM_C, motivo: " " })),
    lanca(() => cadastro("colaborador", LINHA_K, { ...FORM_K, motivo: "" })),
    lanca(() => cadastro("operacao", LINHA_O, { ...FORM_O, motivo: "" })),
  ],
  ["O motivo é obrigatório.", "O motivo é obrigatório.", "O motivo é obrigatório."],
);
verificar(
  "J13. valor negativo ou com três casas é recusado antes de qualquer chamada",
  [
    lanca(() => cadastro("colaborador", LINHA_K, { ...FORM_K, valores: { daily_cost: "-1" } })) !==
      "não lançou",
    lanca(() =>
      cadastro("contrato", LINHA_C, {
        ...FORM_C,
        valores: { ...FORM_C.valores, daily_rate: "10.123" },
      }),
    ) !== "não lançou",
  ],
  [true, true],
);
verificar(
  "J14. as três telas chamam useCriarComVigencia só com o tipo e as chaves de cache (sem nome de tabela)",
  /useCriarComVigencia\("contrato", \["contracts"\]\)/.test(clientes) &&
    /useCriarComVigencia\("colaborador", \["employees"\]\)/.test(colaboradores) &&
    /useCriarComVigencia\("operacao", \["operations"\]\)/.test(operacoes),
  true,
);
const tipos = ler("src/integrations/supabase/types.ts");
verificar(
  "J15. types.ts gerado do schema local traz tabelas de vigências, auditoria, motor e as RPCs das migrations 021–026",
  [
    "contract_terms",
    "employee_cost_terms",
    "operation_terms",
    "financial_terms_audit",
    "financial_engine_settings",
    "user_operation_access",
    "admin_audit_log",
    "criar_contrato_com_vigencia",
    "criar_colaborador_com_vigencia",
    "criar_operacao_com_vigencia",
    "registrar_condicao_contrato",
    "registrar_custo_colaborador",
    "registrar_valor_acordado_operacao",
    "alterar_motor_vigencia",
    "estado_motor_vigencia",
    "regularizar_apontamento_legado",
    "contract_terms_id",
    "operation_terms_id",
    "employee_cost_terms_id",
    "terms_origin",
    "planned_minutes_snapshot",
  ].filter((nome) => !new RegExp(`\\b${nome}\\b`).test(tipos)),
  [],
);
verificar(
  "J16. types.ts mantém o PostgrestVersion e o gerar_fatura (nada existente foi perdido)",
  /PostgrestVersion: "14\.5"/.test(tipos) && /gerar_fatura: \{/.test(tipos),
  true,
);
verificar(
  "J17. nenhum valor financeiro novo passa a ser aceito do cliente em tabela: a tela não faz INSERT em tabela de versões nem de entidade na camada de dados",
  !/\.from\("(contract_terms|employee_cost_terms|operation_terms)"\)\s*\.(insert|update|delete)/.test(
    dados,
  ),
  true,
);

// ---------------------------------------------------------------------------
// K. Início do custo do colaborador novo (C05-B8.9)
// ---------------------------------------------------------------------------

console.log("K. Início do custo do colaborador novo");

verificar(
  "K1. colaborador novo com o motor ligado: a vigência inicial usa a data escolhida, não 'hoje' fixo",
  /inicio: inicioDoCusto,\s*motivo: "Cadastro inicial do colaborador"/.test(colaboradores) &&
    !/inicio: hojeEmSaoPaulo\(\),\s*motivo: "Cadastro inicial do colaborador"/.test(colaboradores),
  true,
);
verificar(
  "K2. o campo de data só aparece no cadastro NOVO com o motor ligado (existente muda por nova vigência)",
  /\{!form\.id && modoDeCusto === "por-vigencia" \? \(\s*<div className="space-y-2">\s*<Label htmlFor="employee-cost-from">/.test(
    colaboradores,
  ),
  true,
);
verificar(
  "K3. a data volta para hoje a cada novo cadastro e sem data o salvamento fica bloqueado",
  /setForm\(empty\);\s*setInicioDoCusto\(hojeEmSaoPaulo\(\)\);/.test(colaboradores) &&
    /!form\.id && modoDeCusto === "por-vigencia" && !inicioDoCusto/.test(colaboradores),
  true,
);
const cadastroRetroativo = montarCadastroAtomico(
  "colaborador",
  { name: "X", status: "active", daily_cost: 80 },
  {
    inicio: "2026-10-01",
    motivo: "Cadastro inicial do colaborador",
    valores: { daily_cost: "80" },
    encerrarAnterior: false,
  },
);
verificar(
  "K4. a data escolhida chega à RPC atômica como p_valid_from (a mesma que valida e audita)",
  [cadastroRetroativo.rpc, cadastroRetroativo.params.p_valid_from],
  ["criar_colaborador_com_vigencia", "2026-10-01"],
);
let semData = "";
try {
  montarCadastroAtomico(
    "colaborador",
    { name: "X", status: "active" },
    {
      inicio: "",
      motivo: "Cadastro inicial do colaborador",
      valores: { daily_cost: "80" },
      encerrarAnterior: false,
    },
  );
} catch (e) {
  semData = e instanceof Error ? "recusado" : "";
}
verificar(
  "K5. sem data de início o cadastro atômico é recusado antes de chegar ao banco",
  semData,
  "recusado",
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
