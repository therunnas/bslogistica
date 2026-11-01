/**
 * Período contratual e janela de cobrança (FIN-PR-05).
 *
 * COMO RODAR:  npm run test:periodo-contratual
 *
 * Sem rede e sem banco. A prova com banco é a suíte SQL `038_periodo_contratual.sql`, o ensaio
 * `scripts/comparar-catalogo-periodo.sh` e a compatibilidade de deploy
 * `scripts/testar-compatibilidade-deploy.sh` (bancos até a 034, até a 037 e até a 038).
 *
 *   P  calendário da competência (espelho de `janela_de_cobranca_valida`)
 *   A  adicionais: competência separada da execução; regra antiga sem competência
 *   V  contrato: frequência só com o anúncio do banco; vazio = herda
 *   F  Fechamento: recorte e frequência só com a 038; alertas pela frequência
 *   M  migration 038 e runbook: aditiva, só o previsto, corpos vigentes preservados
 *   C  telas e CI
 */

import { readFileSync, readdirSync } from "node:fs";

import {
  adicionalElegivel,
  adicionalForaDoPeriodo,
  janelaDeCobrancaDoAdicional,
  montarRegistroDeAdicional,
  validarAdicional,
} from "../src/lib/adicionais.ts";
import { detectarAlertas } from "../src/lib/fechamento/alertas.ts";
import { buscarDadosDoBanco, lerAdicionais, lerFrequencia } from "../src/lib/fechamento/banco.ts";
import { carregarFechamento } from "../src/lib/fechamento/carregar.ts";
import {
  competenciaQueContem,
  competenciasDoMes,
  ehCompetencia,
} from "../src/lib/fechamento/periodo.ts";
import {
  camposDaVigencia,
  camposDoCadastroInicialDeContrato,
  errosDosParametros030,
  interpretarPeriodoContratual,
  montarCadastroAtomico,
  montarRegistro,
  PARAMETROS_030_INICIAIS,
} from "../src/lib/vigencias-ui.ts";
import { corpoDaFuncao } from "./gerar-sql-nucleo-financeiro.mjs";

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
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
console.log("P. Calendário da competência");
// As mesmas janelas da suíte SQL (P1 e P2), com o mesmo resultado.
verificar(
  "P1. válidas: quinzenas (31, 30, fev 28, fev 29 bissexto), mês (31, 30, fev 28), dezembro",
  [
    ["quinzenal", "2026-03-01", "2026-03-15"],
    ["quinzenal", "2026-03-16", "2026-03-31"],
    ["quinzenal", "2026-04-16", "2026-04-30"],
    ["quinzenal", "2027-02-16", "2027-02-28"],
    ["quinzenal", "2028-02-16", "2028-02-29"],
    ["mensal", "2026-03-01", "2026-03-31"],
    ["mensal", "2026-04-01", "2026-04-30"],
    ["mensal", "2027-02-01", "2027-02-28"],
    ["mensal", "2026-12-01", "2026-12-31"],
  ].map(([f, i, e]) => ehCompetencia(f, i, e)),
  [true, true, true, true, true, true, true, true, true],
);
verificar(
  "P2. inválidas: parcial, 2ª quinzena curta, mês no quinzenal, quinzena no mensal, virada de ano, invertida, data inexistente",
  [
    ["quinzenal", "2026-03-02", "2026-03-10"],
    ["quinzenal", "2026-04-16", "2026-04-29"],
    ["quinzenal", "2027-02-16", "2027-02-27"],
    ["quinzenal", "2028-02-16", "2028-02-28"],
    ["quinzenal", "2026-03-01", "2026-03-31"],
    ["mensal", "2026-03-16", "2026-03-31"],
    ["mensal", "2026-12-16", "2027-01-15"],
    ["quinzenal", "2026-03-15", "2026-03-01"],
    ["mensal", "2027-02-01", "2027-02-29"],
  ].map(([f, i, e]) => ehCompetencia(f, i, e)),
  [false, false, false, false, false, false, false, false, false],
);
verificar(
  "P3. competência que contém a data (fev comum, fev bissexto, 31/12, 01/01, mensal em fev bissexto)",
  [
    competenciaQueContem("quinzenal", "2027-02-20"),
    competenciaQueContem("quinzenal", "2028-02-29"),
    competenciaQueContem("quinzenal", "2026-12-31"),
    competenciaQueContem("quinzenal", "2027-01-01"),
    competenciaQueContem("mensal", "2028-02-10"),
  ],
  [
    { inicio: "2027-02-16", fim: "2027-02-28" },
    { inicio: "2028-02-16", fim: "2028-02-29" },
    { inicio: "2026-12-16", fim: "2026-12-31" },
    { inicio: "2027-01-01", fim: "2027-01-15" },
    { inicio: "2028-02-01", fim: "2028-02-29" },
  ],
);
verificar(
  "P4. competências do mês: duas quinzenas ou o mês",
  [competenciasDoMes("quinzenal", 2026, 4), competenciasDoMes("mensal", 2026, 11)],
  [
    [
      { inicio: "2026-04-01", fim: "2026-04-15" },
      { inicio: "2026-04-16", fim: "2026-04-30" },
    ],
    [{ inicio: "2026-11-01", fim: "2026-11-30" }],
  ],
);

// ---------------------------------------------------------------------------
console.log("\nA. Adicionais");
const ADI = {
  id: "a",
  client_id: "c1",
  operation_id: null,
  period_start: "2026-11-03",
  period_end: "2026-11-05",
  description: "Etiquetagem",
  reference: null,
  amount: "50.00",
  invoice_id: null,
  created_at: "2026-10-20T00:00:00Z",
  canceled_at: null,
  cancel_reason: null,
};
const antes = { ...ADI, billing_period_start: "2026-10-16", billing_period_end: "2026-10-31" };
verificar(
  "A1. cobrado ANTES da execução: entra na 2ª quinzena de outubro, não em novembro",
  [
    adicionalElegivel(antes, "c1", "2026-10-16", "2026-10-31"),
    adicionalElegivel(antes, "c1", "2026-11-01", "2026-11-15"),
    adicionalForaDoPeriodo(antes, "c1", "2026-11-01", "2026-11-15"),
  ],
  [true, false, false],
);
verificar(
  "A2. sem competência (banco antigo ou adicional anterior à 038): a execução decide, como antes",
  [
    adicionalElegivel(ADI, "c1", "2026-11-01", "2026-11-15"),
    adicionalElegivel({ ...ADI, period_end: "2026-11-20" }, "c1", "2026-11-01", "2026-11-15"),
    adicionalForaDoPeriodo({ ...ADI, period_end: "2026-11-20" }, "c1", "2026-11-01", "2026-11-15"),
    adicionalElegivel(
      { ...ADI, billing_period_start: null, billing_period_end: null },
      "c1",
      "2026-11-01",
      "2026-11-15",
    ),
  ],
  [true, false, true, true],
);
verificar(
  "A3. faturado, cancelado e outro cliente não entram",
  [
    adicionalElegivel({ ...antes, invoice_id: "f" }, "c1", "2026-10-16", "2026-10-31"),
    adicionalElegivel(
      { ...antes, canceled_at: "x", cancel_reason: "y" },
      "c1",
      "2026-10-16",
      "2026-10-31",
    ),
    adicionalElegivel(antes, "c2", "2026-10-16", "2026-10-31"),
  ],
  [false, false, false],
);
verificar(
  "A4. janela de cobrança: competência, ou a execução sem ela",
  [janelaDeCobrancaDoAdicional(antes), janelaDeCobrancaDoAdicional(ADI)],
  [
    { inicio: "2026-10-16", fim: "2026-10-31" },
    { inicio: "2026-11-03", fim: "2026-11-05" },
  ],
);
const FORM_ADI = {
  clienteId: "c1",
  operacaoId: "",
  inicio: "2026-11-03",
  fim: "2026-11-05",
  motivo: "Etiquetagem",
  referencia: "",
  valor: "50",
};
verificar(
  "A5. sem a 038 os parâmetros de competência não vão (o banco antigo não os tem)",
  Object.keys(montarRegistroDeAdicional(FORM_ADI)).filter((k) => k.startsWith("p_billing")),
  [],
);
verificar(
  "A6. com a 038 a competência escolhida vai, separada da execução",
  (() => {
    const p = montarRegistroDeAdicional({
      ...FORM_ADI,
      competencia: { inicio: "2026-10-16", fim: "2026-10-31" },
    });
    return [p.p_period_start, p.p_period_end, p.p_billing_period_start, p.p_billing_period_end];
  })(),
  ["2026-11-03", "2026-11-05", "2026-10-16", "2026-10-31"],
);
verificar(
  "A7. competência ausente ou atravessando o mês: a tela recusa (o banco revalida a janela)",
  [
    validarAdicional({ ...FORM_ADI, competencia: { inicio: "", fim: "" } }),
    validarAdicional({ ...FORM_ADI, competencia: { inicio: "2026-10-16", fim: "2026-11-15" } }),
  ],
  [
    ["Escolha a competência de cobrança."],
    ["A competência de cobrança fica dentro de um único mês."],
  ],
);

// ---------------------------------------------------------------------------
console.log("\nV. Frequência no contrato");
verificar(
  "V1. anúncio: só `periodo_contratual === true` liga; erro, ausência, texto e nulo, não",
  [
    interpretarPeriodoContratual({ periodo_contratual: true }, null),
    interpretarPeriodoContratual({ periodo_contratual: "true" }, null),
    interpretarPeriodoContratual({}, null),
    interpretarPeriodoContratual(null, null),
    interpretarPeriodoContratual({ periodo_contratual: true }, { message: "x" }),
  ],
  [true, false, false, false, false],
);
verificar(
  "V2. o campo de frequência só existe com o anúncio",
  [
    camposDaVigencia("contrato", true, true, false).some((c) => c.chave === "closing_period"),
    camposDaVigencia("contrato", true, true, true).some((c) => c.chave === "closing_period"),
  ],
  [false, true],
);
const FORM_VIG = {
  inicio: "2026-12-01",
  motivo: "Reajuste",
  valores: { daily_rate: "100", shift_hours: "8", ot_factor: "1.5", ot_tolerance_min: "10" },
  encerrarAnterior: true,
  regrasBs: true,
  regrasDefinitivas: true,
};
verificar(
  "V3. nova versão: vazio não envia (herda), escolhida envia, sem anúncio nunca envia",
  [
    "p_closing_period" in
      montarRegistro("contrato", "k", { ...FORM_VIG, periodoContratual: true }).params,
    montarRegistro("contrato", "k", {
      ...FORM_VIG,
      periodoContratual: true,
      valores: { ...FORM_VIG.valores, closing_period: "mensal" },
    }).params.p_closing_period,
    "p_closing_period" in
      montarRegistro("contrato", "k", {
        ...FORM_VIG,
        valores: { ...FORM_VIG.valores, closing_period: "mensal" },
      }).params,
  ],
  [false, "mensal", false],
);
verificar(
  "V4. frequência fora das opções: a tela recusa",
  (() => {
    try {
      montarRegistro("contrato", "k", {
        ...FORM_VIG,
        periodoContratual: true,
        valores: { ...FORM_VIG.valores, closing_period: "semanal" },
      });
      return "sem erro";
    } catch (e) {
      return e.message;
    }
  })(),
  "Frequência de fechamento e faturamento: escolha uma das opções.",
);
verificar(
  "V5. cadastro inicial: frequência só com a 030 e a 038; padrão quinzenal; vai na RPC atômica",
  [
    camposDoCadastroInicialDeContrato(true, false).map((c) => c.chave),
    camposDoCadastroInicialDeContrato(true, true).map((c) => c.chave),
    camposDoCadastroInicialDeContrato(false, true).map((c) => c.chave),
    PARAMETROS_030_INICIAIS.closing_period,
    errosDosParametros030({ ...PARAMETROS_030_INICIAIS, shift_hours: "8" }, true),
    montarCadastroAtomico(
      "contrato",
      { client_id: "c", name: "K", status: "active" },
      {
        ...FORM_VIG,
        inicio: "2026-01-01",
        motivo: "Cadastro inicial do contrato",
        regrasBs: false,
        periodoContratual: true,
        valores: { ...FORM_VIG.valores, ...PARAMETROS_030_INICIAIS, closing_period: "mensal" },
      },
    ).params.p_closing_period,
  ],
  [
    ["ot_rounding_mode", "saturday_shift_hours", "holiday_pay_factor"],
    ["ot_rounding_mode", "saturday_shift_hours", "holiday_pay_factor", "closing_period"],
    [],
    "quinzenal",
    [],
    "mensal",
  ],
);

// ---------------------------------------------------------------------------
console.log("\nF. Fechamento");
const LINHA_ADI = {
  id: "a",
  description: "Etiquetagem",
  reference: null,
  operation_id: null,
  period_start: "2026-11-03",
  period_end: "2026-11-05",
  invoice_id: null,
  valor: "50.00",
};
verificar(
  "F1. adicional sem as colunas da 038: a forma é a de antes; com elas, a competência vem junto",
  [
    Object.keys(lerAdicionais([LINHA_ADI])[0]).sort(),
    lerAdicionais([
      { ...LINHA_ADI, billing_period_start: "2026-10-16", billing_period_end: "2026-10-31" },
    ])[0].competenciaInicio,
    lerAdicionais([{ ...LINHA_ADI, billing_period_start: null, billing_period_end: null }])[0]
      .competenciaInicio,
  ],
  [
    ["descricao", "faturaId", "fim", "id", "inicio", "operacaoId", "referencia", "valorCentavos"],
    "2026-10-16",
    null,
  ],
);
verificar(
  "F2. frequência: uma linha conhecida; o resto é erro",
  [
    lerFrequencia([{ frequencia: "mensal", inicio: "2026-03-01", fim: "2026-03-31" }]),
    (() => {
      try {
        lerFrequencia([{ frequencia: "semanal" }]);
        return "sem erro";
      } catch (e) {
        return e.name;
      }
    })(),
    (() => {
      try {
        lerFrequencia([]);
        return "sem erro";
      } catch (e) {
        return e.name;
      }
    })(),
  ],
  ["mensal", "ErroDeDadoDoFechamento", "ErroDeDadoDoFechamento"],
);
const RESUMO = [
  {
    receita_apontamentos: 0,
    adicionais: 0,
    ajuste_faturado: 0,
    ajuste_previsto: 0,
    receita_total: 0,
    a_faturar: 0,
    faturado: 0,
    ajuste_aplicavel: true,
  },
];
const fonteBanco = (frequencia) => ({
  resumo: async () => RESUMO,
  ajustesPrevistos: async () => [],
  saldoDeHoras: async () => [],
  adicionais: async () => [],
  ajustesFaturados: async () => [],
  ...(frequencia === undefined
    ? {}
    : { frequencia: async () => [{ frequencia, inicio: "2026-03-01", fim: "2026-03-31" }] }),
});
const FILTRO = { clienteId: "c", inicio: "2026-03-01", fim: "2026-03-31" };
verificar(
  "F3. a frequência só entra nos dados do banco quando a fonte a tem (banco com a 038)",
  [
    "frequencia" in (await buscarDadosDoBanco(fonteBanco(undefined), FILTRO)),
    (await buscarDadosDoBanco(fonteBanco("mensal"), FILTRO)).frequencia,
  ],
  [false, "mensal"],
);
const pedidosDoBanco = [];
for (const periodo of [false, true, undefined]) {
  try {
    await carregarFechamento(
      {
        clienteId: "00000000-0000-4000-8000-000000000001",
        inicio: "2026-03-01",
        fim: "2026-03-15",
      },
      {
        buscarCliente: async () => ({ id: "x", name: "X" }),
        criarFonte: () => ({
          lerPagina: async () => ({ linhas: [], total: 0 }),
          contar: async () => 0,
        }),
        criarFonteDoBanco: (p) => {
          pedidosDoBanco.push(p);
          return fonteBanco(undefined);
        },
        agora: () => new Date("2026-03-20T00:00:00Z"),
        ...(periodo === undefined ? {} : { lerPeriodoContratual: async () => periodo }),
      },
    );
  } catch {
    // só importa o que a fonte do banco recebeu
  }
}
verificar(
  "F4. a fonte do banco recebe a decisão do banco (sem a dependência = como antes)",
  pedidosDoBanco,
  [false, true, false],
);
const AJUSTE = {
  employeeId: "e",
  colaborador: "PER-E1",
  valorHoraCentavos: 3000,
  minutosBrutos: 40,
  minutosArredondados: 30,
  valorBrutoCentavos: 2000,
  valorArredondadoCentavos: 1500,
  ajusteCentavos: -500,
};
const bancoCom = (frequencia) => ({
  resumo: {},
  ajustesPrevistos: [AJUSTE],
  ajustesFaturados: [],
  adicionais: [],
  saldoDeHoras: [],
  ...(frequencia === undefined ? {} : { frequencia }),
});
const divergeAjuste = [
  { codigo: "ajuste-previsto", fechamentoCentavos: -500, bancoCentavos: 1000, confere: false },
];
const codigos = (inicio, fim, frequencia) =>
  detectarAlertas([], { inicio, fim, banco: bancoCom(frequencia), conciliacao: divergeAjuste })
    .map((a) => `${a.codigo}:${a.severidade}`)
    .sort();
verificar(
  "F5. alertas pela frequência: mensal no mês confere com o resumo; quinzenal no mês ou mensal na quinzena não é competência",
  [
    codigos("2026-03-01", "2026-03-31", "mensal"),
    codigos("2026-03-01", "2026-03-15", "mensal"),
    codigos("2026-03-01", "2026-03-31", "quinzenal"),
    codigos("2026-03-01", "2026-03-15", "quinzenal"),
  ],
  [
    ["divergencia-conciliacao:critico"],
    ["periodo-fora-de-fechamento:atencao", "previa-por-quinzena:atencao"],
    ["periodo-fora-de-fechamento:atencao", "previa-por-quinzena:atencao"],
    ["divergencia-conciliacao:critico"],
  ],
);
verificar(
  "F6. banco sem a 038: a regra de antes (o mês fatura; a prévia é por quinzena)",
  [codigos("2026-03-01", "2026-03-31", undefined), codigos("2026-03-01", "2026-03-15", undefined)],
  [["previa-por-quinzena:atencao"], ["divergencia-conciliacao:critico"]],
);

// ---------------------------------------------------------------------------
console.log("\nM. Migration 038 e runbook");
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const NOME = "20261105120000_038_periodo_contratual.sql";
const m038 = ler(`supabase/migrations/${NOME}`);
const m037 = ler("supabase/migrations/20261104120000_037_leitores_por_componentes.sql");
verificar(
  "M1. número 038 uma vez, timestamp > 037 (20261104120000), entre a 037 e a 039 na sequência; 019 fora",
  [
    migrations.filter((f) => /_038_/.test(f)).length,
    NOME.slice(0, 14) > "20261104120000",
    migrations.some((f) => /_019_/.test(f)),
    migrations[migrations.indexOf(NOME) - 1]?.includes("_037_"),
    migrations[migrations.indexOf(NOME) + 1]?.includes("_039_"),
  ],
  [1, true, false, true, true],
);
const semComentarios = m038.replace(/--[^\n]*/g, "");
// Comandos da própria migration, fora dos corpos de função (que só rodam quando chamados).
const comandos = semComentarios.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
verificar(
  "M2. aditiva: nenhum DROP de tabela/coluna/policy, nenhum DELETE/UPDATE/TRUNCATE de dado, nenhum grant a anon",
  [
    /drop\s+(table|column|policy|trigger)/i.test(comandos),
    /\b(delete\s+from|truncate)\b/i.test(comandos),
    /\bupdate\s+public\.\w+\s+set\b/i.test(comandos),
    /grant[^;]*\banon\b/i.test(comandos),
    /disable\s+trigger/i.test(comandos),
  ],
  [false, false, false, false, false],
);
verificar(
  "M3. só três funções são recriadas por DROP (assinatura nova, com default); nenhuma outra",
  [...semComentarios.matchAll(/drop function public\.(\w+)\(/g)].map((m) => m[1]).sort(),
  ["criar_contrato_com_vigencia", "registrar_adicional", "registrar_condicao_contrato"],
);
const gf037 = corpoDaFuncao(m037, "gerar_fatura");
const gf038 = corpoDaFuncao(m038, "gerar_fatura");
const VALIDACAO = `
  -- FIN-PR-05: só uma competência inteira da frequência do cliente (quinzena ou mês), lida depois
  -- da trava: uma mudança de frequência do mesmo cliente não corre junto.
  perform public.validar_periodo_de_cobranca(_client_id, _period_start, _period_end);
`;
const ELEGIBILIDADE_037 = `      and a.period_start >= _period_start
      and a.period_end   <= _period_end
`;
const ELEGIBILIDADE_038 = `      and case when a.billing_period_start is not null
               then a.billing_period_start >= _period_start and a.billing_period_end <= _period_end
               else a.period_start >= _period_start and a.period_end <= _period_end end
`;
const COMENTARIO_038 = `  -- Adicionais pela competência de cobrança; sem competência (anteriores à 038), pela execução
  -- inteira dentro do período, como antes.
`;
verificar(
  "M4. gerar_fatura = corpo da 037 + validação da competência depois da trava + adicional pela competência",
  [
    gf038.indexOf("pg_advisory_xact_lock(hashtextextended(_client_id::text, 0))") <
      gf038.indexOf("validar_periodo_de_cobranca") &&
      gf038.indexOf("validar_periodo_de_cobranca") < gf038.indexOf("for update of te"),
    gf038
      .replace(VALIDACAO, "")
      .replace(ELEGIBILIDADE_038, ELEGIBILIDADE_037)
      .replace(COMENTARIO_038, "") === gf037,
  ],
  [true, true],
);
verificar(
  "M5. gerar_fatura mantém guards, travas, acumulado e Σ itens = total; não cita o motor por vigência (O16)",
  [
    /mfa_cotidiano_ok\(\)/.test(gf038),
    /has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/.test(gf038),
    (gf038.match(/for update of/g) ?? []).length,
    /validar_fechamento_acumulado\(_client_id, _period_start, _period_end, _ids\)/.test(gf038),
    /Itens da fatura não somam o total/.test(gf038),
    /vigencia|financial_engine_settings|.terms/i.test(gf038),
  ],
  [true, true, 2, true, true, false],
);
const definidas = (nome) => new RegExp(`create function public\\.${nome}\\(`, "i").test(m038);
verificar(
  "M6. funções internas sem SECURITY DEFINER; a de leitura usa o guard de leitura; as de escrita, o estrito",
  [
    [
      "janela_de_cobranca_valida",
      "frequencia_de_fechamento",
      "validar_periodo_de_cobranca",
      "periodo_contratual_conferir",
    ].map((n) => definidas(n) && !/security definer/i.test(corpoComCabecalho(n))),
    /condicoes_exigir_admin_leitura\(\)/.test(corpoDaFuncao(m038, "competencia_de_cobranca")),
    /condicoes_exigir_admin\(\)/.test(corpoDaFuncao(m038, "registrar_condicao_contrato")),
    /condicoes_exigir_admin\(\)/.test(corpoDaFuncao(m038, "registrar_adicional")),
  ],
  [[true, true, true, true], true, true, true],
);
function corpoComCabecalho(nome) {
  const i = m038.search(new RegExp(`create function public\\.${nome}\\(`, "i"));
  const fim = m038.indexOf("$$;", m038.indexOf("$$", i) + 2);
  return m038.slice(i, fim);
}
verificar(
  "M7. resumo financeiro: adicional pela competência (coalesce) e ajuste previsto pela frequência",
  [
    /coalesce\(a\.billing_period_start, a\.period_start\) >= p_inicio/.test(
      corpoDaFuncao(m038, "resumo_financeiro_periodo"),
    ),
    /frequencia_de_fechamento\(c\.cli, m::date\)/.test(
      corpoDaFuncao(m038, "resumo_financeiro_periodo"),
    ),
    /'periodo_contratual', true/.test(corpoDaFuncao(m038, "estado_motor_vigencia")),
  ],
  [true, true, true],
);

const ra038 = corpoDaFuncao(m038, "registrar_adicional");
verificar(
  "M8. registrar_adicional: sem competência grava a que contém a execução ou recusa (22023); nunca grava nula",
  [
    /else\s+-- Sem competência/.test(ra038),
    /raise exception 'A execução de % a % não cabe numa competência %/.test(ra038),
    /errcode = '22023'/.test(ra038.slice(ra038.indexOf("não cabe numa competência"))),
    /v_cob_inicio, v_cob_fim\)\s+returning/.test(ra038),
    /p_billing_period_start, p_billing_period_end\)\s+returning/.test(ra038),
  ],
  [true, true, true, true, false],
);
const runbook = ler("docs/runbooks/rollback-periodo-contratual.sql");
const m036 = ler("supabase/migrations/20261103120000_036_integracao_nucleo_v2.sql");
const m032 = ler("supabase/migrations/20261030120000_032_mfa_opcional.sql");
const m030 = ler("supabase/migrations/20261028120000_030_regras_definitivas_bs.sql");
const m029 = ler("supabase/migrations/20261026120000_029_regras_financeiras_bs.sql");
verificar(
  "R1. o runbook devolve os corpos vigentes antes da 038 (037, 032, 036, 030, 029)",
  [
    corpoDaFuncao(runbook, "gerar_fatura") === gf037,
    corpoDaFuncao(runbook, "resumo_financeiro_periodo") ===
      corpoDaFuncao(m032, "resumo_financeiro_periodo"),
    corpoDaFuncao(runbook, "estado_motor_vigencia") ===
      corpoDaFuncao(m036, "estado_motor_vigencia"),
    corpoDaFuncao(runbook, "registrar_condicao_contrato") ===
      corpoDaFuncao(m030, "registrar_condicao_contrato"),
    corpoDaFuncao(runbook, "corrigir_condicao_contrato") ===
      corpoDaFuncao(m030, "corrigir_condicao_contrato"),
    corpoDaFuncao(runbook, "criar_contrato_com_vigencia") ===
      corpoDaFuncao(m030, "criar_contrato_com_vigencia"),
    corpoDaFuncao(runbook, "registrar_adicional") === corpoDaFuncao(m029, "registrar_adicional"),
  ],
  [true, true, true, true, true, true, true],
);
verificar(
  "R2. o runbook RECUSA antes de remover dado (frequência mensal ou competência) e roda numa transação",
  [
    runbook.indexOf("Reversão recusada") < runbook.indexOf("drop column"),
    /closing_period <> 'quinzenal'/.test(runbook),
    /billing_period_start is not null/.test(runbook),
    /^begin;$/m.test(runbook) && /^commit;$/m.test(runbook),
  ],
  [true, true, true, true],
);

// ---------------------------------------------------------------------------
console.log("\nC. Telas, compatibilidade e CI");
const banco = ler("src/lib/fechamento/banco.ts");
const faturamento = ler("src/app/(painel)/faturamento/painel-faturamento.tsx");
const telaAdicionais = ler("src/app/(painel)/faturamento/adicionais.tsx");
const dadosAdicionais = ler("src/lib/adicionais-dados.ts");
verificar(
  "C1. Fechamento: colunas e RPC da 038 só com o anúncio do banco",
  [
    /periodoContratual \? `\$\{colunas\}, billing_period_start, billing_period_end` : colunas/.test(
      banco,
    ),
    /if \(periodoContratual\) \{\s*fonte\.frequencia = /.test(banco),
  ],
  [true, true],
);
verificar(
  "C2. Faturamento: frequência só com o anúncio; gerar exige a competência inteira",
  [
    /useCompetenciaDeCobranca\(selectedClient, start, periodoContratual\)/.test(faturamento),
    /!periodoContratual \|\| \(frequencia !== null && ehCompetencia\(frequencia, start, end\)\)/.test(
      faturamento,
    ),
    /!periodoEhCompetencia;/.test(faturamento),
  ],
  [true, true, true],
);
verificar(
  "C3. adicionais: a competência só é pedida e enviada com o anúncio do banco",
  [
    /\.\.\.\(periodoContratual \? \{ competencia: /.test(telaAdicionais),
    /"p_billing_period_start" in params/.test(dadosAdicionais),
  ],
  [true, true],
);
const pacote = JSON.parse(ler("package.json"));
const ci = ler(".github/workflows/ci.yml");
verificar(
  "C4. script npm e passo de CI",
  [pacote.scripts["test:periodo-contratual"], ci.includes("npm run test:periodo-contratual")],
  [
    "node --experimental-strip-types --import ./scripts/_resolver-ts.mjs scripts/testar-periodo-contratual.mjs",
    true,
  ],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
