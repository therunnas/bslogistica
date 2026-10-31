/**
 * Gera o SQL da integração do núcleo V2 ao motor (FIN-PR-02).
 *
 * COMO RODAR
 *   node scripts/gerar-sql-integracao-v2.mjs baseline   > /tmp/baseline.sql   (roda NO BANCO ATÉ A 035)
 *   node scripts/gerar-sql-integracao-v2.mjs teste                            (grava supabase/tests/036_*.sql)
 *
 * O `baseline` mede o motor ATUAL (030) numa grade sintética, para a fixture
 * `scripts/fixtures/derivar-030-baseline.json`: é a prova de que domingo e feriado não mudaram e a
 * base das diferenças legado × V2 documentadas. O `teste` embute a mesma grade, com o esperado de
 * cada caso: domingo e feriado = baseline (idêntico à 030); dia útil e sábado = oráculo V2.
 * `test:integracao-isolamento` confere que o arquivo versionado é igual ao que este gerador produz.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { oraculoV2 } from "./_oraculo-financeiro.mjs";
import {
  CONFIGURACOES,
  CUSTO_CENTAVOS,
  DIARIA_CENTAVOS,
  DIAS,
  FATOR_FERIADO,
  TIPO_GRAVADO,
  entradaV2,
  gradeDeIntegracao,
  reais,
  textoDoResultado,
} from "./_integracao-grade.mjs";

const raiz = new URL("../", import.meta.url);
export const CAMINHO_DO_TESTE = "supabase/tests/036_integracao_nucleo_v2.sql";
export const CAMINHO_DO_BASELINE = "scripts/fixtures/derivar-030-baseline.json";

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const doze = (n) => String(n).padStart(12, "0");
const idDe = (prefixo, n) => `'${prefixo}-0000-4000-8000-${doze(n)}'`;

const indiceCfg = (cfg) => CONFIGURACOES.findIndex((c) => c.cfg === cfg) + 1;
const indiceDia = (dia) => DIAS.findIndex((d) => d.dia === dia) + 1;

const ADMIN = "5c360000-0000-4000-8000-0000000000a1";
const SESSAO = "ec360000-0000-4000-8000-0000000000a1";
const CLIENTE = "5c36c000-0000-4000-8000-0000000000c1";

// ---------------------------------------------------------------------------
// Preparação comum (baseline e teste)
// ---------------------------------------------------------------------------

function sqlDePreparacao(casos) {
  const linhasCasos = casos.map((c) => {
    const i = indiceCfg(c.cfg);
    const d = indiceDia(c.dia);
    return `  (${c.n}, ${q(c.cfg)}, ${q(c.dia)}, date ${q(c.data)}, ${c.valorHora}, ${q(c.padrao)}, ${q(
      c.status,
    )}, ${c.entrada === null ? "null::time" : `${q(c.entrada)}::time`}, ${
      c.saida === null ? "null::time" : `${q(c.saida)}::time`
    }, ${c.intervalo}, ${idDe("5c36b000", i * 10 + d)}::uuid, ${idDe("5c36e000", i)}::uuid, ${idDe(
      "5c36a000",
      i,
    )}::uuid, ${idDe("5c36f000", c.n)}::uuid)`;
  });

  const contratos = CONFIGURACOES.map((c, k) => {
    const i = k + 1;
    return { c, i };
  });

  return `create or replace function pg_temp.medir_como(_papel text, _claims jsonb, _sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', _claims::text, true);
  execute format('set local role %I', _papel);
  begin
    execute _sql into _r;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return coalesce(_r, 'nulo');
end;
$$;
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '${ADMIN}', 'role', 'authenticated', 'aal', 'aal1', 'session_id', '${SESSAO}'), _sql)
$$;
create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end;
$$;

-- Admin sem fator verificado (MFA opcional, AUTH-01): aal1 basta.
insert into auth.users (id) values ('${ADMIN}');
insert into auth.sessions (id, user_id, not_after) values ('${SESSAO}', '${ADMIN}', null);
insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');

insert into public.clients (id, name) values ('${CLIENTE}', 'INT cliente sintético');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
${contratos
  .map(
    ({ c, i }) =>
      `  (${idDe("5c36d000", i)}, '${CLIENTE}', 'K${c.cfg}', ${reais(DIARIA_CENTAVOS)}, 8, 1.5, ${c.tolerancia})`,
  )
  .join(",\n")};
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor) values
${contratos
  .map(
    ({ c, i }) =>
      `  (${idDe("5c36d000", i)}, date '2026-01-01', ${reais(DIARIA_CENTAVOS)}, 8, 1.5, ${c.tolerancia}, true, 'informada', 'INT sintético', ${q(
        c.modo,
      )}, ${c.sabado === null ? "null" : c.sabado}, ${FATOR_FERIADO})`,
  )
  .join(",\n")};
insert into public.operations (id, client_id, contract_id, name) values
${contratos
  .map(
    ({ c, i }) => `  (${idDe("5c36e000", i)}, '${CLIENTE}', ${idDe("5c36d000", i)}, 'OP${c.cfg}')`,
  )
  .join(",\n")};
-- 06:00-15:00 com 60 min de intervalo: 480 min previstos
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
${contratos
  .map(
    ({ c, i }) =>
      `  (${idDe("5c36a000", i)}, ${idDe("5c36e000", i)}, 'S${c.cfg}', '06:00', '15:00', 60)`,
  )
  .join(",\n")};
insert into public.financial_holidays (holiday_date, name, reason) values (date '${DIAS.find((d) => d.dia === "feriado").data}', 'Feriado INT', 'INT sintético');

create temporary table _casos (
  n integer primary key, cfg text, dia text, data date, valor_hora boolean, padrao text, status text,
  entrada time, saida time, intervalo integer, folha uuid, operacao uuid, turno uuid, colaborador uuid
) on commit drop;
insert into _casos values
${linhasCasos.join(",\n")};

insert into public.employees (id, name, daily_cost)
  select colaborador, 'INT-C' || n, ${reais(CUSTO_CENTAVOS)} from _casos;
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason, ot_hourly_cost)
  select colaborador, date '2026-01-01', ${reais(CUSTO_CENTAVOS)}, true, 'informada', 'INT sintético',
         case when valor_hora then 25.00 end
    from _casos;
insert into public.timesheets (id, operation_id, shift_id, work_date)
  select distinct folha, operacao, turno, data from _casos;

select pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado na grade de integração') ->> 'ativo')$q$) as motor_ligado;

create temporary table _obtido (n integer primary key, texto text) on commit drop;

create or replace function pg_temp.rodar() returns void language plpgsql as $$
declare
  c record;
  v text;
  _id uuid;
begin
  for c in select * from _casos order by n loop
    _id := ('5c36b100-0000-4000-8000-' || lpad(c.n::text, 12, '0'))::uuid;
    begin
      insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
      values (_id, c.folha, c.colaborador, c.status::public.attendance_status, c.entrada, c.saida, c.intervalo);
      select concat_ws('|', e.billed_amount::text, e.cost_amount::text, e.worked_minutes::text,
                       e.overtime_minutes::text, coalesce(e.billed_overtime_minutes::text, '-'),
                       coalesce(e.day_kind_snapshot, '-'))
        into v from public.timesheet_entries e where e.id = _id;
    exception when others then
      v := 'erro:' || sqlstate
           || case when sqlstate = '22023' then ':' || coalesce(substring(sqlerrm from '^nucleo:([a-z_0-9]+):'), '?') else '' end;
    end;
    insert into _obtido values (c.n, v);
  end loop;
end;
$$;
select pg_temp.rodar();
`;
}

// ---------------------------------------------------------------------------
// semente (banco até a 035, COMMITADA): dados para provar que a 036 não toca nos existentes
// ---------------------------------------------------------------------------

const FATURA_SEMENTE = "5c36ff00-0000-4000-8000-000000000001";

/** Grade COMMITADA no banco local até a 035, com os lançamentos do contrato A já faturados. */
export function sqlDaSemente() {
  const casos = gradeDeIntegracao();
  return `-- Semente sintética para o ensaio da 036 (banco local descartável até a 035). COMMITA.
begin;
${sqlDePreparacao(casos)}
insert into public.invoices (id, client_id, period_start, period_end, status, total_dailies, total_overtime, total_amount, total_cost)
  values ('${FATURA_SEMENTE}', '${CLIENTE}', date '2026-03-01', date '2026-03-15', 'closed', 0, 0, 0, 0);
update public.timesheet_entries e set invoice_id = '${FATURA_SEMENTE}'
  from _casos c
 where e.id = ('5c36b100-0000-4000-8000-' || lpad(c.n::text, 12, '0'))::uuid and c.cfg = 'A' and c.status <> 'absent';
commit;
`;
}

// ---------------------------------------------------------------------------
// baseline (banco até a 035)
// ---------------------------------------------------------------------------

export function sqlDoBaseline() {
  const casos = gradeDeIntegracao();
  return `-- Medição do motor ATUAL (030) na grade de integração. Rodar só no banco local até a 035.
begin;
${sqlDePreparacao(casos)}
select jsonb_build_object('casos', jsonb_agg(jsonb_build_object('n', n, 'r', texto) order by n))::text from _obtido;
rollback;
`;
}

// ---------------------------------------------------------------------------
// teste (banco até a 036)
// ---------------------------------------------------------------------------

/** Texto esperado do caso: domingo e feriado = baseline; útil e sábado = oráculo V2. */
export function esperadoDoCaso(c, baseline) {
  if (c.dia === "domingo" || c.dia === "feriado") return baseline.get(c.n);
  const igual =
    c.entrada !== null && c.saida !== null && c.entrada.slice(0, 5) === c.saida.slice(0, 5);
  if (igual && c.status !== "absent") return "erro:23514";
  const r = oraculoV2(entradaV2(c));
  if (r.erro) return `erro:22023:${r.erro}`;
  return textoDoResultado(r, c.status === "absent" ? "-" : TIPO_GRAVADO[c.dia]);
}

export function lerBaseline() {
  const j = JSON.parse(readFileSync(new URL(CAMINHO_DO_BASELINE, raiz), "utf8"));
  return new Map(j.casos.map((x) => [x.n, x.r]));
}

export function sqlDoTeste() {
  const casos = gradeDeIntegracao();
  const baseline = lerBaseline();
  const esperados = casos.map((c) => {
    const util = c.dia === "util" || c.dia === "sabado";
    let base = "-";
    let he = "-";
    if (util && c.status !== "absent" && !esperadoDoCaso(c, baseline).startsWith("erro:")) {
      const r = oraculoV2(entradaV2(c));
      base = reais(r.baseCentavos);
      he = reais(r.heCentavos);
    } else if (util && c.status === "absent") {
      base = "0.00";
      he = "0.00";
    }
    return `  (${c.n}, ${q(esperadoDoCaso(c, baseline))}, ${q(`${base}|${he}`)}, ${util})`;
  });

  return `-- GERADO por scripts/gerar-sql-integracao-v2.mjs. NÃO EDITAR À MÃO: altere o gerador e rode
-- \`node scripts/gerar-sql-integracao-v2.mjs teste\`. \`test:integracao-isolamento\` acusa deriva.
--
-- Migration 036 — integração do núcleo V2 ao motor (FIN-PR-02).
--
-- COMO RODAR: \`bash scripts/testar-sql-local.sh\` (Supabase LOCAL descartável). Uma transação que
-- termina em \`rollback\`. NUNCA rodar contra Production nem homologação.
--
-- O QUE ESTE ARQUIVO PROVA, com ${casos.length} lançamentos sintéticos (6 contratos × 4 tipos de dia × padrões de horário)
--   G  grade: DOMINGO e FERIADO = o resultado medido da 030 (fixture ${CAMINHO_DO_BASELINE});
--      DIA ÚTIL e SÁBADO = oráculo V2 independente
--   C  componentes: identidade, domingo/feriado sem componentes (legado), especial e adicional zero
--   L  os leitores atuais seguem classificando diária e hora extra (billed − diária = componentes)
--   X  efeitos: guardas, edição motriz × não motriz, folha fechada, faturado imutável, fatura,
--      arredondamento acumulado e resumo financeiro sobre os mesmos dados
--
begin;

create temporary table _resultado (
  ordem serial, caso text, esperado text, obtido text, situacao text
) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text) returns void
language plpgsql as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, coalesce(_obtido, 'nulo'),
          case when _esperado = coalesce(_obtido, 'nulo') then 'PASS' else 'FAIL' end);
end;
$$;

${sqlDePreparacao(casos)}
create temporary table _esperado (n integer primary key, texto text, componentes text, util boolean) on commit drop;
insert into _esperado values
${esperados.join(",\n")};

-- ---------------------------------------------------------------------------
-- G. Grade
-- ---------------------------------------------------------------------------

select pg_temp.registrar('G' || lpad(o.n::text, 4, '0') || ' ' || c.cfg || '/' || c.dia || '/' || c.padrao
         || case when c.valor_hora then '/vh' else '' end, e.texto, o.texto)
  from _obtido o join _esperado e using (n) join _casos c using (n) order by o.n;

select pg_temp.registrar('G0. a grade rodou ${casos.length} lançamentos', '${casos.length}', (select count(*)::text from _obtido));
select pg_temp.registrar('G1. recusas da V2 são as de zero minuto e nenhuma outra no dia útil/sábado', 'erro:22023:zero_minuto_com_horarios',
  (select string_agg(distinct o.texto, ',') from _obtido o join _casos c using (n)
    where c.dia in ('util', 'sabado') and o.texto like 'erro:22023%'));

-- ---------------------------------------------------------------------------
-- C. Componentes persistidos
-- ---------------------------------------------------------------------------

create temporary table _linhas on commit drop as
  select c.n, c.dia, c.cfg, e.* from public.timesheet_entries e
   join _casos c on e.id = ('5c36b100-0000-4000-8000-' || lpad(c.n::text, 12, '0'))::uuid;

select pg_temp.registrar('C1. dia útil e sábado gravados pela V2 têm calc_version = 2', '0',
  (select count(*)::text from _linhas where dia in ('util', 'sabado') and calc_version is distinct from 2));
select pg_temp.registrar('C2. domingo e feriado seguem a 030: calc_version e componentes nulos (a falta é zero em ambas)', '0',
  (select count(*)::text from _linhas where dia in ('domingo', 'feriado') and status <> 'absent'
     and (calc_version is not null or billed_base_amount is not null or billed_overtime_amount is not null
          or billed_special_amount is not null)));
select pg_temp.registrar('C3. identidade: billed = base + HE + especial + adicional (V2)', '0',
  (select count(*)::text from _linhas where calc_version = 2
     and billed_amount <> billed_base_amount + billed_overtime_amount + billed_special_amount + additional_amount));
select pg_temp.registrar('C4. horas especiais e adicional são zero neste PR (em todas as linhas)', '0',
  (select count(*)::text from _linhas where additional_amount <> 0 or coalesce(billed_special_amount, 0) <> 0));
select pg_temp.registrar('C5. componentes da V2 = oráculo (base|HE)', '0',
  (select count(*)::text from _linhas l join _esperado e using (n)
    where e.util and l.calc_version = 2 and e.componentes <> '-|-'
      and l.billed_base_amount::text || '|' || l.billed_overtime_amount::text <> e.componentes));
select pg_temp.registrar('C6. a falta é V2 com tudo zero', '0',
  (select count(*)::text from _linhas where status = 'absent' and dia in ('util', 'sabado')
     and (calc_version is distinct from 2 or billed_amount <> 0 or billed_base_amount <> 0 or billed_overtime_amount <> 0)));

-- ---------------------------------------------------------------------------
-- L. Os leitores atuais derivam HE por billed − diária: continua certo no útil e no sábado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('L1. HE derivada (billed − diária, piso 0) = componente de HE em todo lançamento V2', '0',
  (select count(*)::text from _linhas where calc_version = 2 and status <> 'absent'
     and greatest(billed_amount - daily_rate_snapshot, 0) <> billed_overtime_amount));
select pg_temp.registrar('L2. diária derivada (billed − HE derivada) = componente de diária em todo lançamento V2', '0',
  (select count(*)::text from _linhas where calc_version = 2 and status <> 'absent'
     and billed_amount - greatest(billed_amount - daily_rate_snapshot, 0) <> billed_base_amount));
select pg_temp.registrar('L3. o snapshot da diária é a diária do contrato em todo lançamento de presença', '0',
  (select count(*)::text from _linhas where status <> 'absent' and daily_rate_snapshot <> ${reais(DIARIA_CENTAVOS)}));
select pg_temp.registrar('L4. o valor-hora cobrado é diária ÷ 8 × 1,5 (divisor 8 também no sábado)', '0',
  (select count(*)::text from _linhas where calc_version = 2 and status <> 'absent'
     and ot_hour_rate_snapshot <> round(${reais(DIARIA_CENTAVOS)}::numeric / 8 * 1.5, 2)));

-- ---------------------------------------------------------------------------
-- X. Efeitos, guardas e consumidores
-- ---------------------------------------------------------------------------

${sqlDosEfeitos()}

-- ---------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao = 'FAIL' order by ordem limit 60;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '036_integracao_nucleo_v2: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
`;
}

// ---------------------------------------------------------------------------
// Efeitos: escritos à mão, sobre os mesmos dados
// ---------------------------------------------------------------------------

/** Texto `billed|cost|worked|ot|botmin|calc|base|he` de um caso de dia útil/sábado, pelo oráculo. */
function linhaEsperada(c) {
  const r = oraculoV2(entradaV2(c));
  return [
    reais(r.totalCentavos),
    reais(r.custoTotalCentavos),
    r.minutosTrabalhados,
    r.heMinutosPagos,
    r.heMinutosCobrados,
    2,
    reais(r.baseCentavos),
    reais(r.heCentavos),
  ].join("|");
}

function sqlDosEfeitos() {
  const casos = gradeDeIntegracao();
  const ref = (dia, padrao) =>
    casos.find((c) => c.cfg === "B" && !c.valorHora && c.dia === dia && c.padrao === padrao);
  const r480 = ref("util", "w480");
  const r495 = ref("util", "w495");
  const r525 = ref("util", "w525");
  const editado = { ...r495, saida: "15:45" };
  const sab = ref("sabado", "w255");
  const dom = ref("domingo", "w495");
  const fer = ref("feriado", "w480");

  const upd = (n, set) =>
    `pg_temp.adm(format($q$with u as (update public.timesheet_entries set ${set} where id = %L returning 1) select count(*)::text from u$q$, pg_temp.id_de(${n})))`;

  return `create or replace function pg_temp.id_de(_n integer) returns uuid language sql as $$
  select ('5c36b100-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid
$$;
create or replace function pg_temp.linha(_n integer) returns text language sql as $$
  select concat_ws('|', billed_amount::text, cost_amount::text, worked_minutes::text, overtime_minutes::text,
                   coalesce(billed_overtime_minutes::text, '-'), coalesce(calc_version::text, '-'),
                   coalesce(billed_base_amount::text, '-'), coalesce(billed_overtime_amount::text, '-'))
    from public.timesheet_entries where id = pg_temp.id_de(_n)
$$;

-- X1 a X4. Guardas: as colunas novas só o sistema grava
select pg_temp.registrar('X1. UPDATE direto de billed_base_amount por admin é recusado', 'erro 42501', ${upd(r480.n, "billed_base_amount = 1")});
select pg_temp.registrar('X2. UPDATE direto de calc_version por admin é recusado', 'erro 42501', ${upd(r480.n, "calc_version = null")});
select pg_temp.registrar('X3. UPDATE direto de additional_amount por admin é recusado (neutro neste PR)', 'erro 42501', ${upd(r480.n, "additional_amount = 5")});
select pg_temp.registrar('X4. INSERT com componente preenchido por admin é recusado', 'erro 42501',
  pg_temp.adm(format($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, billed_overtime_amount)
    select gen_random_uuid(), folha, colaborador, 'present', 9 from _casos where n = %s returning 1) select count(*)::text from i$q$, ${r480.n})));
select pg_temp.registrar('X4b. INSERT com adicional diferente de zero por admin é recusado', 'erro 42501',
  pg_temp.adm(format($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, additional_amount)
    select gen_random_uuid(), folha, colaborador, 'present', 3 from _casos where n = %s returning 1) select count(*)::text from i$q$, ${r480.n})));

-- X5 a X7. Edição não motriz preserva tudo; a motriz recalcula pela V2 (ato explícito)
select pg_temp.registrar('X5. antes da edição: útil 8h15 grava os componentes da V2', '${linhaEsperada(r495)}', pg_temp.linha(${r495.n}));
select pg_temp.registrar('X6. editar só a nota não recalcula nada', 'ok|${linhaEsperada(r495)}',
  case when ${upd(r495.n, "notes = 'x'")} = '1' then 'ok|' || pg_temp.linha(${r495.n}) else 'falhou' end);
select pg_temp.registrar('X7. editar a saída (coluna motriz) recalcula pela V2: 8h45', '${linhaEsperada(editado)}',
  case when ${upd(r495.n, "check_out = '15:45'")} = '1' then pg_temp.linha(${r495.n}) else 'falhou' end);

-- X8 e X9. Folha fechada
select pg_temp.registrar('X8. folha fechada: editar a saída é recusado (55000)', 'fechou|erro 55000',
  (select case when pg_temp.adm(format($q$with u as (update public.timesheets set status = 'closed' where id = %L returning 1) select count(*)::text from u$q$, folha)) = '1'
               then 'fechou|' || ${upd(r495.n, "check_out = '16:00'")} else 'nao fechou' end
     from _casos where n = ${r495.n}));
select pg_temp.registrar('X9. reabrir a folha', '1',
  (select pg_temp.adm(format($q$with u as (update public.timesheets set status = 'open' where id = %L returning 1) select count(*)::text from u$q$, folha)) from _casos where n = ${r495.n}));

-- X10 a X13. Arredondamento acumulado (contrato D), antes de faturar
create temporary table _ajustes on commit drop as
  select j.*, c.n from public.ajustes_de_arredondamento_acumulado('${CLIENTE}', date '2026-03-01', date '2026-03-15') j
    join _casos c on c.colaborador = j.employee_id;
select pg_temp.registrar('X10. acumulado: minutos brutos lidos = minutos cobrados gravados', '0',
  (select count(*)::text from _ajustes a join public.timesheet_entries e on e.id = pg_temp.id_de(a.n)
    where a.minutos_brutos <> e.billed_overtime_minutes));
select pg_temp.registrar('X11. acumulado: valor bruto lido = HE gravada (componente na V2, derivada no legado)', '0',
  (select count(*)::text from _ajustes a join public.timesheet_entries e on e.id = pg_temp.id_de(a.n)
    where a.valor_bruto <> case when e.calc_version = 2 then e.billed_overtime_amount
                                else greatest(e.billed_amount - e.daily_rate_snapshot, 0) end));
select pg_temp.registrar('X12. acumulado: 14 + 26 = 40 -> 30 (função de sempre, intacta)', '30', public.arredondar_minutos_extras(14 + 26)::text);
select pg_temp.registrar('X13. só o contrato acumulado entra no ajuste', 'D',
  (select string_agg(distinct c.cfg, ',') from _ajustes a join _casos c on c.colaborador = a.employee_id));

-- X14 a X18. Fatura e resumo sobre os mesmos dados
create temporary table _soma on commit drop as
  select coalesce(sum(billed_amount) filter (where status <> 'absent'), 0) as billed,
         coalesce(sum(case when calc_version = 2 then billed_base_amount
                           else billed_amount - greatest(billed_amount - daily_rate_snapshot, 0) end) filter (where status <> 'absent'), 0) as diarias,
         coalesce(sum(case when calc_version = 2 then billed_overtime_amount
                           else greatest(billed_amount - daily_rate_snapshot, 0) end) filter (where status <> 'absent'), 0) as extras,
         count(*) filter (where status <> 'absent') as lancamentos,
         coalesce(sum(coalesce(billed_overtime_minutes, overtime_minutes)) filter (where status <> 'absent'), 0) as minutos
    from public.timesheet_entries where invoice_id is null;
create temporary table _antes_fatura on commit drop as
  select id, md5((to_jsonb(e) - 'invoice_id' - 'updated_at')::text) as h from public.timesheet_entries e;
select pg_temp.registrar('X14. resumo financeiro: receita dos apontamentos = soma do cobrado', 'ok',
  (select case when pg_temp.adm($q$select receita_apontamentos::text from public.resumo_financeiro_periodo(date '2026-03-01', date '2026-03-15', '${CLIENTE}')$q$) = s.billed::text
               then 'ok' else pg_temp.adm($q$select receita_apontamentos::text from public.resumo_financeiro_periodo(date '2026-03-01', date '2026-03-15', '${CLIENTE}')$q$) || ' <> ' || s.billed::text end
     from _soma s));
create temporary table _fatura (id uuid) on commit drop;
insert into _fatura select pg_temp.adm($q$select (public.gerar_fatura('${CLIENTE}', date '2026-03-01', date '2026-03-15')).id::text$q$)::uuid;
select pg_temp.registrar('X15. a fatura foi gerada', '1', (select count(*)::text from _fatura));
select pg_temp.registrar('X16. fatura: total = diárias + horas extras + arredondamento acumulado (itens fecham com o total)', 'ok',
  (select case when i.total_amount = (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = i.id)
                and i.total_amount = s.billed + (select coalesce(sum(ajuste), 0) from _ajustes)
               then 'ok' else i.total_amount::text || ' / itens ' || (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = i.id)::text || ' / esperado ' || (s.billed + (select coalesce(sum(ajuste), 0) from _ajustes))::text end
     from public.invoices i, _fatura f, _soma s where i.id = f.id));
select pg_temp.registrar('X17. fatura: item de diárias = soma das diárias (componente na V2) e item de HE = soma da HE', 'ok',
  (select case when (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = f.id and kind = 'diarias') = s.diarias
                and (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = f.id and kind = 'horas_extras') = s.extras
               then 'ok' else 'diarias ' || (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = f.id and kind = 'diarias')::text || ' <> ' || s.diarias::text
                              || ' / extras ' || (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = f.id and kind = 'horas_extras')::text || ' <> ' || s.extras::text end
     from _fatura f, _soma s));
select pg_temp.registrar('X18. fatura: lançamentos = presenças e substituições', 'ok',
  (select case when i.total_dailies = s.lancamentos then 'ok' else i.total_dailies::text || ' <> ' || s.lancamentos::text end
     from public.invoices i, _fatura f, _soma s where i.id = f.id));
select pg_temp.registrar('X19. gerar a fatura não recalculou nenhum lançamento (só o vínculo mudou)', '0',
  (select count(*)::text from _antes_fatura a join public.timesheet_entries e on e.id = a.id
    where md5((to_jsonb(e) - 'invoice_id' - 'updated_at')::text) <> a.h));

-- X20 a X23. Faturado imutável
select pg_temp.registrar('X20. faturado: editar a saída é recusado (42501)', 'erro 42501', ${upd(r495.n, "check_out = '16:30'")});
select pg_temp.registrar('X21. faturado: nem o postgres altera um componente (gatilho da linha inteira)', '42501',
  pg_temp.erro_de(format($q$update public.timesheet_entries set billed_base_amount = billed_base_amount + 1 where id = %L$q$, pg_temp.id_de(${r495.n}))));
select pg_temp.registrar('X22. faturado: editar a nota também é recusado', 'erro 42501', ${upd(r495.n, "notes = 'y'")});
select pg_temp.registrar('X23. a linha faturada continua a mesma depois das tentativas', '${linhaEsperada(editado)}', pg_temp.linha(${r495.n}));

-- X24 a X27. Domingo e feriado: fora deste PR (a medida da 030 é a verdade; ver a grade)
select pg_temp.registrar('X24. domingo 8h15 (excedente 15): a 030 arredonda para 0; a V2 daria 30', '${dom.n}:15|0',
  '${dom.n}:' || (select overtime_minutes::text from public.timesheet_entries where id = pg_temp.id_de(${dom.n})) || '|' ||
  (select billed_overtime_minutes::text from public.timesheet_entries where id = pg_temp.id_de(${dom.n})));
select pg_temp.registrar('X25. feriado 8h: custo 8 h × (111.11 ÷ 8) × 2 = 222.22 e cobrança de diária inteira', '${baselineDoFeriado(fer)}',
  (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = pg_temp.id_de(${fer.n})));
select pg_temp.registrar('X26. sábado 4h15 (sem horas especiais): HE de 30 min com divisor 8', '${linhaEsperada(sab)}', pg_temp.linha(${sab.n}));
select pg_temp.registrar('X27. estado do motor anuncia o núcleo V2', 'true|true|true',
  (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'nucleo_v2')$q$) || '|' ||
   pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'regras_definitivas')$q$) || '|' ||
   pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'consistente')$q$)));
`;
}

function baselineDoFeriado(caso) {
  const r = lerBaseline().get(caso.n).split("|");
  return `${r[0]}|${r[1]}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const modo = process.argv[2];
  if (modo === "baseline") process.stdout.write(sqlDoBaseline());
  else if (modo === "semente") process.stdout.write(sqlDaSemente());
  else if (modo === "teste") {
    writeFileSync(new URL(CAMINHO_DO_TESTE, raiz), sqlDoTeste());
    console.log(`gerado: ${CAMINHO_DO_TESTE}`);
  } else {
    console.error("uso: gerar-sql-integracao-v2.mjs baseline|semente|teste");
    process.exit(2);
  }
}
