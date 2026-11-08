/**
 * FUNC-READY-01 — fluxos operacionais e financeiros de ponta a ponta, contra um Supabase LOCAL isolado.
 *
 * COMO RODAR: `FLUXOS_WORKDIR=<workdir da stack local> bash scripts/testar-fluxos-local.sh`.
 * NUNCA aponta para HML nem Production: a URL vem do `supabase status` do workdir informado e é recusada
 * se não for loopback; a leitura de conferência usa `psql` DENTRO do container `supabase_db_<project_id>`.
 * Não reseta nada: cria um cliente, contrato, colaboradores e operações próprios, com prefixo único.
 *
 * Cada fluxo é feito como a tela faz (sessão real de admin, mesmas RPCs e os mesmos montadores de payload
 * de `src/lib`) e conferido no que ficou GRAVADO: valores, snapshots, vínculos, trilha e recusas.
 *
 *   CO  colaborador: custo por vigência, reajuste pelo cadastro, reflexo nos apontamentos, lista = motor
 *   OP  operação fixa (contrato) e avulsa (valor acordado), equipe, diária, HE, falta; prévia = banco
 *   CT  contrato: precedência diária individual > tarifa da função > preço-base (resolução ligada)
 *   CN  containers: registrar, repetir, conflitar, cancelar, corrigir, faturar, proteger o faturado
 *   FA  faturamento: pendente → fatura → unicidade → imutabilidade → conciliação (resumo e Fechamento)
 */

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { calcEntryComNucleo } from "../src/lib/previa-v2.ts";
import { custosVigentesPorColaborador, planejarNovoCusto } from "../src/lib/colaborador-custo.ts";
import { registrarServicoContainer } from "../src/lib/container-servico-backend.ts";
import { montarRegistroDeAdicional } from "../src/lib/adicionais.ts";
import { registrarAdicional } from "../src/lib/adicionais-registro.ts";
import { montarCargaDaRpc } from "../src/lib/apontamentos-salvar.ts";
import { carregarFechamento, dependenciasComSupabase } from "../src/lib/fechamento/carregar.ts";
import { lerResumoFinanceiro } from "../src/lib/resumo-financeiro.ts";
import { camposDePeriodoDoTurno, montarAlocacao } from "../src/lib/funcoes.ts";
import { montarRegistroDeTarifa } from "../src/lib/tarifas.ts";
import { montarRegistroDeDiaria } from "../src/lib/diaria-individual.ts";
import {
  interpretarNucleoV2,
  interpretarRegrasDaBs,
  interpretarRegrasDefinitivas,
  interpretarPeriodoContratual,
} from "../src/lib/vigencias-ui.ts";
import { montarCadastroAtomico, montarRegistro } from "../src/lib/vigencias-ui.ts";
import { prepararLoteDeContainers } from "../src/lib/container-servico.ts";

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY, CONTAINER } = process.env;
if (!API_URL || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API_URL)) {
  console.error("API_URL ausente ou não local: este teste só roda contra o Supabase local.");
  process.exit(2);
}
if (!CONTAINER || !/^supabase_db_[a-z0-9-]+$/.test(CONTAINER)) {
  console.error("CONTAINER do Postgres local ausente ou inválido.");
  process.exit(2);
}

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
const secao = (t) => console.log(`\n${t}`);

/** Leitura de conferência: o que está GRAVADO, como `postgres`, dentro do container local. */
const psql = (sql) =>
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-F", "|"],
    { input: sql, encoding: "utf8" },
  ).trim();
const linha = (sql) => psql(sql).split("|");
const num = (sql) => Number(psql(sql));
const cents = (v) => Math.round(Number(v) * 100);

// ---------------------------------------------------------------------------
// Sessão real de admin (conta só no Auth local)
// ---------------------------------------------------------------------------
const RUN = `FR01-${Date.now().toString(36)}`;
const servico = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `fluxos-${RUN.toLowerCase()}@bslog.test`;
const senha = randomBytes(18).toString("base64url");
const criado = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true });
if (criado.error) throw criado.error;
psql(`insert into public.user_roles (user_id, role) values ('${criado.data.user.id}', 'admin');`);
const db = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
const entrou = await db.auth.signInWithPassword({ email, password: senha });
if (entrou.error) throw entrou.error;

const est = await db.rpc("estado_motor_vigencia");
if (est.error) throw est.error;
const E = est.data;
const regrasBs = interpretarRegrasDaBs(E, null);
const regrasDefinitivas = interpretarRegrasDefinitivas(E, null);
const periodoContratual = interpretarPeriodoContratual(E, null);
const nucleoV2 = interpretarNucleoV2(E, null);
const precoBaseRecuo = E?.preco_base_recuo === true;
const resolucaoInicial = E?.resolucao_tarifas === true;
console.log(
  `Execução ${RUN} · motor=${E?.ativo} regrasBs=${regrasBs} definitivas=${regrasDefinitivas} ` +
    `período=${periodoContratual} v2=${nucleoV2} resolução=${resolucaoInicial} recuoBase=${precoBaseRecuo}`,
);
if (E?.ativo !== true) {
  const lig = await db.rpc("alterar_motor_vigencia", { p_ativar: true, p_reason: `${RUN} motor` });
  if (lig.error) throw lig.error;
}
if (resolucaoInicial) {
  const des = await db.rpc("alterar_resolucao_tarifas", {
    p_ativar: false,
    p_reason: `${RUN} início`,
  });
  if (des.error) throw des.error;
}

const formVigencia = (inicio, valores, motivo) => ({
  inicio,
  motivo,
  valores,
  encerrarAnterior: false,
  fim: "",
  regrasBs,
  regrasDefinitivas,
  periodoContratual,
});
/** Versões ativas de custo, lidas como a lista do cadastro lê (PostgREST, sessão do admin). */
const lerVersoesDeCusto = async (cliente, colaborador) => {
  const r = await cliente
    .from("employee_cost_terms")
    .select("*")
    .eq("employee_id", colaborador)
    .eq("active", true);
  if (r.error) throw r.error;
  return r.data;
};
const rpc = async (nome, params) => {
  const r = await db.rpc(nome, params);
  return r;
};
const exigir = (r, o) => {
  if (r.error) throw new Error(`${o}: ${r.error.code} ${r.error.message}`);
  return r.data;
};

// ---------------------------------------------------------------------------
// Cadastros pelo caminho da tela
// ---------------------------------------------------------------------------
secao("Cadastros (pelo caminho das telas)");
const cli = exigir(
  await db
    .from("clients")
    .insert({ name: `${RUN} Cliente` })
    .select("id")
    .single(),
  "cliente",
);
const C = cli.id;
const contrato = montarCadastroAtomico(
  "contrato",
  { client_id: C, name: `${RUN} Contrato`, valid_to: null, status: "active" },
  formVigencia(
    "2026-09-01",
    {
      daily_rate: "150,00",
      shift_hours: "8",
      ot_factor: "1,5",
      ot_tolerance_min: "10",
      ot_rounding_mode: "diario",
      saturday_shift_hours: "",
      holiday_pay_factor: "",
      closing_period: "quinzenal",
    },
    `${RUN} cadastro do contrato`,
  ),
);
const K = exigir(await rpc(contrato.rpc, contrato.params), "contrato");
const novoColaborador = async (nome, custo) => {
  const m = montarCadastroAtomico(
    "colaborador",
    { name: `${RUN} ${nome}`, doc: null, role: null, phone: null, status: "active" },
    formVigencia("2026-09-01", { daily_cost: custo, ot_hourly_cost: "" }, `${RUN} cadastro`),
  );
  return exigir(await rpc(m.rpc, m.params), `colaborador ${nome}`);
};
const A = await novoColaborador("Ana", "100,00");
const B = await novoColaborador("Bruno", "90,00");
const D = await novoColaborador("Dora", "80,00");
// Um colaborador fica ativo em UMA operação por vez (operation_team_um_ativo_por_colaborador).
const V = await novoColaborador("Vera", "70,00");
const opFixa = exigir(
  await db
    .from("operations")
    .insert({ client_id: C, contract_id: K, type: "fixed", name: `${RUN} Fixa` })
    .select("id")
    .single(),
  "operação fixa",
).id;
const avulsa = montarCadastroAtomico(
  "operacao",
  {
    client_id: C,
    type: "spot",
    name: `${RUN} Avulsa`,
    site: null,
    operation_date: null,
    status: "active",
    notes: null,
    contract_id: null,
  },
  formVigencia("2026-09-01", { agreed_amount: "200,00" }, `${RUN} valor acordado`),
);
const opAvulsa = exigir(await rpc(avulsa.rpc, avulsa.params), "operação avulsa");
const turno = async (op) =>
  exigir(
    await db
      .from("shifts")
      .insert({
        operation_id: op,
        name: "Diurno",
        start_time: "06:00:00",
        end_time: "15:00:00",
        break_minutes: 60,
        crosses_midnight: false,
        ...camposDePeriodoDoTurno("diurno", true),
      })
      .select("id")
      .single(),
    "turno",
  ).id;
const TF = await turno(opFixa);
const TA = await turno(opAvulsa);
// Calendário territorial sintético (configuração administrativa), só se ainda não existir na stack local.
psql(`
insert into public.municipality_catalog (code, name, state_code, official_url)
  select '4200000', 'MUNICIPIO_TESTE_044', 'SC', 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4200000'
   where not exists (select 1 from public.municipality_catalog where code = '4200000');
insert into public.financial_calendar_coverage
  (calendar_year, territory_scope, state_code, municipality_code, legal_act, official_url, client_confirmed, reason, created_by)
  select 2026, v.escopo, v.uf, v.mun, 'SINTETICA', 'https://exemplo.gov.br/calendario/sintetico', true,
         'FIXTURE_SINTETICA_FLUXOS', '${criado.data.user.id}'::uuid
    from (values ('nacional', null, null), ('estadual', 'SC', null), ('municipal', 'SC', '4200000')) v(escopo, uf, mun)
   where not exists (select 1 from public.financial_calendar_coverage c
                      where c.calendar_year = 2026 and c.territory_scope = v.escopo);
`);
for (const op of [opFixa, opAvulsa]) {
  exigir(
    await rpc("registrar_local_operacao", {
      p_operation_id: op,
      p_municipality_code: "4200000",
      p_valid_from: "2026-01-01",
      p_reason: `${RUN} localidade`,
      p_encerrar_anterior: false,
    }),
    "localidade",
  );
}
const funcoes = exigir(await db.from("job_functions").select("id, code"), "funções");
const fid = (c) => funcoes.find((f) => f.code === c)?.id ?? null;
for (const [emp, f] of [
  [A, "conferente"],
  [B, "operador"],
  [D, "auxiliar_producao"],
]) {
  exigir(
    await db
      .from("operation_team")
      .insert(montarAlocacao({ operationId: opFixa, employeeId: emp, shiftId: TF }, fid(f), true)),
    "equipe fixa",
  );
}
exigir(
  await db
    .from("operation_team")
    .insert(
      montarAlocacao(
        { operationId: opAvulsa, employeeId: V, shiftId: TA },
        fid("conferente"),
        true,
      ),
    ),
  "equipe avulsa",
);
verificar(
  "CAD1. cadastros gravados: contrato com vigência, 4 custos, operação avulsa com valor acordado, 4 alocações",
  [
    num(`select count(*) from contract_terms where contract_id='${K}' and active`),
    num(
      `select count(*) from employee_cost_terms where employee_id in ('${A}','${B}','${D}','${V}') and active`,
    ),
    num(`select count(*) from operation_terms where operation_id='${opAvulsa}' and active`),
    num(`select count(*) from operation_team where operation_id in ('${opFixa}','${opAvulsa}')`),
  ],
  [1, 4, 1, 4],
);

/** Lança um dia como a tela de apontamentos: RPC do admin + carga montada pelo app. */
const lancar = (op, shift, data, linhas) =>
  rpc("salvar_apontamento_admin", {
    p_operation_id: op,
    p_shift_id: shift,
    p_work_date: data,
    p_linhas: montarCargaDaRpc(
      linhas.map(([emp, entrada, saida, status = "present"]) => ({
        employeeId: emp,
        entryId: undefined,
        status,
        checkIn: entrada ?? "",
        checkOut: saida ?? "",
        breakMinutes: status === "absent" ? 0 : 60,
        notes: "",
      })),
      new Map(linhas.map(([emp]) => [emp, funcaoDe(emp)])),
    ),
  });
const funcaoDe = (emp) =>
  emp === A ? fid("conferente") : emp === B ? fid("operador") : fid("auxiliar_producao");
const entrada = (op, emp, data) =>
  linha(
    `select e.billed_amount, e.cost_amount, coalesce(e.billed_overtime_amount, 0), e.daily_rate_snapshot,
            e.daily_cost_snapshot, coalesce(e.price_source,'-'), e.invoice_id is not null, e.id
       from timesheet_entries e join timesheets t on t.id = e.timesheet_id
      where t.operation_id='${op}' and e.employee_id='${emp}' and t.work_date='${data}'`,
  );
const previa = (diaria, custo, inicio, fim, status = "present") =>
  calcEntryComNucleo({
    status,
    checkIn: inicio,
    checkOut: fim,
    breakMinutes: status === "absent" ? 0 : 60,
    plannedMinutes: 480,
    rules: { daily_rate: diaria, shift_hours: 8, ot_factor: 1.5, ot_tolerance_min: 10 },
    employeeDailyCost: custo,
    employeeOtHourCost: null,
    proportionalCost: regrasBs,
    ...(regrasDefinitivas ? { roundingMode: "diario", dayKind: "util", nucleoV2 } : {}),
  });

// ---------------------------------------------------------------------------
// OP — operação fixa e avulsa, resolução DESLIGADA (preço-base / valor acordado)
// ---------------------------------------------------------------------------
secao("OP. Operações e apontamentos");
const s1 = await lancar(opFixa, TF, "2026-09-01", [
  [A, "06:00", "15:00"],
  [B, "06:00", "16:00"],
  [D, null, null, "absent"],
]);
verificar("OP1. dia da operação fixa salvo pela RPC do admin", s1.error?.message ?? "ok", "ok");
const a1 = entrada(opFixa, A, "2026-09-01");
const b1 = entrada(opFixa, B, "2026-09-01");
const d1 = entrada(opFixa, D, "2026-09-01");
verificar(
  "OP2. jornada cheia: diária = preço-base 150,00; custo = custo vigente 100,00",
  [Number(a1[0]), Number(a1[1])],
  [150, 100],
);
const pb = previa(150, 90, "06:00", "16:00");
verificar(
  "OP3. 1 h extra: o banco grava o mesmo valor da prévia da tela (cobrado e custo)",
  [cents(b1[0]), cents(b1[1])],
  [cents(pb.billedAmount), cents(pb.costAmount)],
);
verificar(
  "OP4. HE cobrada > 0 e dentro do total",
  [Number(b1[2]) > 0, cents(b1[0]) === cents(150) + cents(b1[2])],
  [true, true],
);
verificar("OP5. falta: nada cobrado nem custo", [Number(d1[0]), Number(d1[1])], [0, 0]);
const s2 = await lancar(opAvulsa, TA, "2026-09-02", [[V, "06:00", "15:00"]]);
const av = entrada(opAvulsa, V, "2026-09-02");
verificar(
  "OP6. avulsa sem contrato: cobra o valor acordado 200,00 por diária; custo da Vera 70,00",
  [s2.error?.message ?? "ok", Number(av[0]), Number(av[1])],
  ["ok", 200, 70],
);
const repetido = await lancar(opFixa, TF, "2026-09-01", [[A, "06:00", "15:00"]]);
verificar(
  "OP7. repetir o mesmo dia não duplica a diária (uma linha por colaborador e data)",
  [
    repetido.error?.message ?? "ok",
    num(`select count(*) from timesheet_entries e join timesheets t on t.id=e.timesheet_id
          where t.operation_id='${opFixa}' and e.employee_id='${A}' and t.work_date='2026-09-01'`),
  ],
  ["ok", 1],
);

// ---------------------------------------------------------------------------
// CO — custo do colaborador
// ---------------------------------------------------------------------------
secao("CO. Colaboradores: custo, histórico e reflexo");
const HOJE = linha(`select (now() at time zone 'America/Sao_Paulo')::date`)[0];
const versoesA = await lerVersoesDeCusto(db, A);
const plano = planejarNovoCusto({
  versoes: versoesA,
  custoAtual: 100,
  novoCusto: "120,00",
  inicio: HOJE,
  motivo: `${RUN} reajuste`,
  hoje: HOJE,
  regrasBs,
  regrasDefinitivas,
  periodoContratual,
});
verificar("CO1. o planejador da tela aceita o reajuste a partir de hoje", plano.erros, []);
const reg = montarRegistro("colaborador", A, plano.form);
const r1 = await rpc(reg.rpc, reg.params);
verificar("CO2. reajuste gravado pela RPC de vigência", r1.error?.message ?? "ok", "ok");
verificar(
  "CO3. histórico: versão anterior encerrada em hoje (fim exclusivo), nova versão em aberto com motivo",
  linha(
    `select count(*) filter (where valid_to='${HOJE}' and daily_cost=100),
            count(*) filter (where valid_from='${HOJE}' and valid_to is null and daily_cost=120 and reason='${RUN} reajuste')
       from employee_cost_terms where employee_id='${A}' and active`,
  ).map(Number),
  [1, 1],
);
verificar(
  "CO4. o apontamento ANTERIOR não foi recalculado (custo 100,00 congelado)",
  Number(entrada(opFixa, A, "2026-09-01")[1]),
  100,
);
const repetirMesmaData = planejarNovoCusto({
  versoes: await lerVersoesDeCusto(db, A),
  custoAtual: 120,
  novoCusto: "130,00",
  inicio: HOJE,
  motivo: "x",
  hoje: HOJE,
  regrasBs,
  regrasDefinitivas,
  periodoContratual,
});
verificar(
  "CO5. segundo reajuste na mesma data é barrado antes do envio",
  repetirMesmaData.form,
  null,
);
const mapa = custosVigentesPorColaborador(await lerVersoesDeCusto(db, A), HOJE);
verificar(
  "CO6. o custo da lista (versão vigente hoje) é o custo que o motor usa hoje",
  mapa.get(A),
  Number(psql(`select o_daily_cost from public.motor_custo_do_dia('${A}', '${HOJE}')`)),
);
verificar(
  "CO7. o cadastro legado (employees.daily_cost) não é a fonte: continua 100,00 e não manda",
  Number(psql(`select daily_cost from employees where id='${A}'`)),
  100,
);

// ---------------------------------------------------------------------------
// CN — containers
// ---------------------------------------------------------------------------
secao("CN. Containers");
const lote = (o = {}) => ({
  clienteId: C,
  operacaoId: opFixa,
  solicitadoEm: "2026-09-02",
  executadoEm: "2026-09-03",
  descricao: `${RUN} descarga`,
  quantidade: 2,
  totalCobrado: "300,00",
  referencia: `${RUN}-REF`,
  participantes: [
    { colaboradorId: A, valorDevido: "40,00" },
    { colaboradorId: B, valorDevido: "35,00" },
  ],
  modalidadeCusto: "total_distribuido",
  totalDistribuido: "75,00",
  ...(periodoContratual
    ? { competenciaCobranca: { inicio: "2026-09-01", fim: "2026-09-15" } }
    : {}),
  ...o,
});
const K1 = randomUUID();
const sv1 = await registrarServicoContainer(db, lote(), K1, `${RUN} registro`);
const sv1b = await registrarServicoContainer(db, lote(), K1, `${RUN} registro`);
const conflito = await registrarServicoContainer(db, lote({ quantidade: 3 }), K1, "x").catch(
  (e) => e,
);
verificar(
  "CN1. registrar; repetir a MESMA intenção devolve o mesmo serviço; mesma chave com outro conteúdo é recusada",
  [
    sv1 === sv1b,
    conflito?.code,
    num(`select count(*) from container_services where client_id='${C}'`),
  ],
  [true, "23505", 1],
);
verificar(
  "CN2. receita única (um adicional) e custo congelado por participante",
  linha(
    `select s.revenue_cents, s.cost_total_cents, b.amount,
            (select count(*) from container_service_participants p where p.service_id=s.id)
       from container_services s join billing_additionals b on b.id=s.billing_additional_id
      where s.id='${sv1}'`,
  ).map(Number),
  [30000, 7500, 300, 2],
);
const direto = await db
  .from("container_services")
  .update({ quantity: 9 })
  .eq("id", sv1)
  .select("id");
verificar(
  "CN3. alteração direta pela API não passa (sem permissão de escrita)",
  [
    Boolean(direto.error) || (direto.data ?? []).length === 0,
    num(`select quantity from container_services where id='${sv1}'`),
  ],
  [true, 2],
);
const sv2 = await registrarServicoContainer(
  db,
  lote({ descricao: `${RUN} cancelar` }),
  randomUUID(),
  `${RUN} r2`,
);
const can = await rpc("cancelar_servico_container", { p_id: sv2, p_reason: `${RUN} cancelado` });
verificar(
  "CN4. cancelar antes de faturar: serviço e adicional cancelados, trilha com motivo",
  [
    can.error?.message ?? "ok",
    linha(
      `select s.canceled_at is not null, b.canceled_at is not null,
              (select count(*) from container_service_audit a where a.service_id=s.id and a.action='canceled')
         from container_services s join billing_additionals b on b.id=s.billing_additional_id where s.id='${sv2}'`,
    ),
  ],
  ["ok", ["t", "t", "1"]],
);
// Correção sem cancelar e recriar à mão (049): troca atômica, com vínculo e trilha.
const temCorrecao =
  num(`select count(*) from pg_proc where proname='corrigir_servico_container'`) > 0;
let svCorrigido = sv1;
if (temCorrecao) {
  const KC = randomUUID();
  const corr = await rpc("corrigir_servico_container", {
    p_id: sv1,
    p_dados: prepararLoteDeContainers(lote({ quantidade: 3, totalCobrado: "450,00" })),
    p_idempotency_key: KC,
    p_reason: `${RUN} quantidade errada`,
  });
  svCorrigido = corr.data ?? sv1;
  const repete = await rpc("corrigir_servico_container", {
    p_id: sv1,
    p_dados: prepararLoteDeContainers(lote({ quantidade: 3, totalCobrado: "450,00" })),
    p_idempotency_key: KC,
    p_reason: `${RUN} quantidade errada`,
  });
  verificar(
    "CN5. corrigir: substituto com os dados novos; original cancelado com o motivo; vínculo na trilha; repetir não duplica",
    [
      corr.error?.message ?? "ok",
      repete.data === corr.data,
      linha(
        `select n.quantity, n.revenue_cents, o.canceled_at is not null, ob.canceled_at is not null,
                (select count(*) from container_service_audit a where a.action='corrected'
                   and a.service_id='${sv1}' and a.after_data->>'id' = n.id::text)
           from container_services n, container_services o
           join billing_additionals ob on ob.id = o.billing_additional_id
          where n.id='${corr.data}' and o.id='${sv1}'`,
      ),
      num(`select count(*) from container_services where client_id='${C}' and canceled_at is null`),
    ],
    ["ok", true, ["3", "45000", "t", "t", "1"], 1],
  );
  const outroCliente = await rpc("corrigir_servico_container", {
    p_id: svCorrigido,
    p_dados: prepararLoteDeContainers(lote({ clienteId: "00000000-0000-4000-8000-000000000000" })),
    p_idempotency_key: randomUUID(),
    p_reason: "trocar cliente",
  });
  verificar("CN6. corrigir não troca o cliente (22023)", outroCliente.error?.code, "22023");
} else {
  verificar(
    "CN5. corrigir um serviço sem cancelar e recriar à mão (RPC de correção)",
    "ausente",
    "disponível",
  );
}

// ---------------------------------------------------------------------------
// FA — faturamento: pendente → fatura → unicidade → imutabilidade → conciliação
// ---------------------------------------------------------------------------
secao("FA. Faturamento");
const formAd = {
  clienteId: C,
  operacaoId: "",
  inicio: "2026-09-04",
  fim: "2026-09-04",
  motivo: `${RUN} etiquetagem`,
  referencia: "",
  valor: "12,34",
  ...(periodoContratual ? { competencia: { inicio: "2026-09-01", fim: "2026-09-15" } } : {}),
};
const adic = await registrarAdicional(
  (n, a) => db.rpc(n, a),
  montarRegistroDeAdicional(formAd),
  randomUUID(),
);
verificar("FA1. adicional avulso registrado pelo transporte do app", typeof adic, "string");
await lancar(opFixa, TF, "2026-09-03", [[A, "06:00", "15:00"]]);
const pend = linha(
  `select coalesce(sum(e.billed_amount),0), coalesce(sum(e.cost_amount),0), count(*) filter (where e.invoice_id is null)
     from timesheet_entries e join timesheets t on t.id=e.timesheet_id join operations o on o.id=t.operation_id
    where o.client_id='${C}' and t.work_date between '2026-09-01' and '2026-09-15' and e.status <> 'absent'`,
);
const custoContainer = num(
  `select coalesce(sum(cost_total_cents),0) from container_services where client_id='${C}' and canceled_at is null`,
);
const adicionais = num(
  `select coalesce(sum(amount)*100,0) from billing_additionals where client_id='${C}' and canceled_at is null`,
);
const esperadoTotal = cents(pend[0]) + adicionais;
const esperadoCusto = cents(pend[1]) + custoContainer;
const resumo = await rpc("resumo_financeiro_periodo", {
  p_inicio: "2026-09-01",
  p_fim: "2026-09-15",
  p_client_id: C,
});
const rs = lerResumoFinanceiro(Array.isArray(resumo.data) ? resumo.data[0] : resumo.data);
const filtros = { clienteId: C, inicio: "2026-09-01", fim: "2026-09-15" };
const antes = await carregarFechamento(filtros, dependenciasComSupabase(db));
verificar(
  "FA2. pendente antes de faturar: tudo em aberto; Fechamento a faturar = apontamentos + adicionais + containers",
  [
    Number(pend[2]),
    antes.financeiro.aFaturarCentavos,
    rs ? cents(rs.receitaApontamentos) : resumo.error?.message,
  ],
  [4, esperadoTotal, cents(pend[0])],
);
const mesInteiro = await rpc("gerar_fatura", {
  _client_id: C,
  _period_start: "2026-09-01",
  _period_end: "2026-09-30",
});
verificar(
  "FA3. competência fora da quinzena do contrato é recusada (22023)",
  mesInteiro.error?.code,
  "22023",
);
const f1 = await rpc("gerar_fatura", {
  _client_id: C,
  _period_start: "2026-09-01",
  _period_end: "2026-09-15",
});
const inv = f1.data?.id;
verificar(
  "FA4. fatura emitida: Σ itens = total = apontamentos + adicional + container; custo inclui o container",
  [
    f1.error?.message ?? "ok",
    cents(num(`select coalesce(sum(amount),0) from invoice_items where invoice_id='${inv}'`)),
    cents(num(`select total_amount from invoices where id='${inv}'`)),
    cents(num(`select total_cost from invoices where id='${inv}'`)),
  ],
  ["ok", esperadoTotal, esperadoTotal, esperadoCusto],
);
const f2 = await rpc("gerar_fatura", {
  _client_id: C,
  _period_start: "2026-09-01",
  _period_end: "2026-09-15",
});
verificar(
  "FA5. unicidade: gerar de novo não cria segunda fatura",
  [Boolean(f2.error), num(`select count(*) from invoices where client_id='${C}'`)],
  [true, 1],
);
const editar = await lancar(opFixa, TF, "2026-09-01", [[A, "06:00", "17:00"]]);
const cancelarFaturado = await rpc("cancelar_servico_container", {
  p_id: svCorrigido,
  p_reason: "tarde",
});
let corrigirFaturado = { error: { code: "n/a" } };
if (temCorrecao) {
  corrigirFaturado = await rpc("corrigir_servico_container", {
    p_id: svCorrigido,
    p_dados: prepararLoteDeContainers(lote({ quantidade: 5 })),
    p_idempotency_key: randomUUID(),
    p_reason: "tarde",
  });
}
verificar(
  "FA6. imutabilidade: apontamento faturado, cancelamento e correção de container faturado são recusados; valores intactos",
  [
    Boolean(editar.error),
    cancelarFaturado.error?.code,
    temCorrecao ? corrigirFaturado.error?.code : "55000",
    Number(entrada(opFixa, A, "2026-09-01")[0]),
  ],
  [true, "55000", "55000", 150],
);
const depois = await carregarFechamento(filtros, dependenciasComSupabase(db));
verificar(
  "FA7. conciliação: depois de faturar, Fechamento mostra tudo faturado e nada a faturar",
  [depois.financeiro.jaFaturadoCentavos, depois.financeiro.aFaturarCentavos],
  [esperadoTotal, 0],
);

// ---------------------------------------------------------------------------
// CT — precedência de preço com a resolução LIGADA (outubro)
// ---------------------------------------------------------------------------
secao("CT. Contrato: diária individual > tarifa da função > preço-base");
const t1 = await rpc(
  "registrar_tarifa_contrato",
  montarRegistroDeTarifa({
    contratoId: K,
    funcaoId: fid("operador"),
    periodo: "diurno",
    inicio: "2026-10-01",
    valor: "170,00",
    motivo: `${RUN} tarifa`,
  }),
);
const d1i = await rpc(
  "registrar_diaria_individual",
  montarRegistroDeDiaria({
    contratoId: K,
    colaboradorId: A,
    inicio: "2026-10-01",
    valor: "260,00",
    motivo: `${RUN} individual`,
  }),
);
verificar(
  "CT1. tarifa da função e diária individual cadastradas",
  [t1.error?.message ?? "ok", d1i.error?.message ?? "ok"],
  ["ok", "ok"],
);
const off = await lancar(opFixa, TF, "2026-10-06", [[A, "06:00", "15:00"]]);
verificar(
  "CT2. resolução DESLIGADA: individual e tarifa não valem; cobra o preço-base 150,00",
  [off.error?.message ?? "ok", Number(entrada(opFixa, A, "2026-10-06")[0])],
  ["ok", 150],
);
const liga = await rpc("alterar_resolucao_tarifas", { p_ativar: true, p_reason: `${RUN} liga` });
const ligada = await rpc("estado_motor_vigencia");
verificar(
  "CT3. a resolução liga mesmo com contratos sem tarifa (eles ficam no preço-base) e o banco anuncia o recuo",
  [liga.error?.message ?? "ok", ligada.data?.resolucao_tarifas, ligada.data?.preco_base_recuo],
  ["ok", true, true],
);
const on = await lancar(opFixa, TF, "2026-10-07", [
  [A, "06:00", "15:00"],
  [B, "06:00", "15:00"],
]);
const semTarifa = await lancar(opFixa, TF, "2026-10-08", [[D, "06:00", "15:00"]]);
const a7 = entrada(opFixa, A, "2026-10-07");
const b7 = entrada(opFixa, B, "2026-10-07");
verificar(
  "CT4. ligada: Ana (com diária individual) = 260,00; Bruno (operador) = tarifa 170,00",
  [on.error?.message ?? "ok", Number(a7[0]), a7[5], Number(b7[0]), b7[5]],
  ["ok", 260, "individual", 170, "funcao_periodo"],
);
const d8 = entrada(opFixa, D, "2026-10-08");
verificar(
  "CT5. ligada: Dora (função sem tarifa e sem individual) = preço-base do contrato 150,00",
  [semTarifa.error?.code ?? "ok", d8.length > 1 ? Number(d8[0]) : null],
  ["ok", 150],
);
const he = await lancar(opFixa, TF, "2026-10-09", [[D, "06:00", "16:00"]]);
const d9 = entrada(opFixa, D, "2026-10-09");
verificar(
  "CT6. a HE sobre o preço-base usa o mesmo cálculo da prévia (base 150,00)",
  [he.error?.code ?? "ok", d9.length > 1 ? cents(d9[0]) : null],
  ["ok", cents(previa(150, 80, "06:00", "16:00").billedAmount)],
);

// Restaura o estado da resolução encontrado no início.
await rpc("alterar_resolucao_tarifas", {
  p_ativar: resolucaoInicial,
  p_reason: `${RUN} restaura`,
});

console.log(`\n${passou} verificações passaram, ${falhas.length} falharam.`);
if (falhas.length) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
