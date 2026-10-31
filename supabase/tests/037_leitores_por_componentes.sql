-- Migration 037 — leitores financeiros pelos componentes (FIN-PR-03).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que
-- termina em `rollback`. NUNCA rodar contra Production nem homologação. Dados sintéticos.
--
-- O QUE ESTE ARQUIVO PROVA (valores esperados calculados à mão)
--   A  dia útil V2 · B sábado V2 · C domingo legado · D feriado legado · E acumulado
--   F  calc_version nulo (lançamento gravado antes da 036) · G calc_version 2
--   H  diária proporcional · I HE 15/45 · J HE pelo componente
--   K  horas especiais e adicional SINTÉTICOS: a leitura antiga erra, a nova acerta
--   L  dois preços na mesma operação (vigências) discriminados na fatura
--   N  Σ itens = total da fatura; Σ componentes = cobrado · P resumo financeiro
--   Q  permissões · R integridade (componente ausente ou que não fecha = erro)

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

create or replace function pg_temp.medir_como(_papel text, _claims jsonb, _sql text) returns text language plpgsql as $$
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
    jsonb_build_object('sub', '5c370000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec370000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c370000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec370000-0000-4000-8000-0000000000a2'), _sql)
$$;
create or replace function pg_temp.anon(_sql text) returns text language sql as $$
  select pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), _sql)
$$;
create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c370000-0000-4000-8000-0000000000a1'), ('5c370000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec370000-0000-4000-8000-0000000000a1', '5c370000-0000-4000-8000-0000000000a1', null),
  ('ec370000-0000-4000-8000-0000000000a2', '5c370000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c370000-0000-4000-8000-0000000000a1', 'admin'), ('5c370000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c37c000-0000-4000-8000-0000000000c1', 'LEI cliente sintético');
-- K1 diário (133,33 até 04/03; 150,00 a partir de 05/03; feriado paga ×2); K2 acumulado (120,00)
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c37d000-0000-4000-8000-0000000000d1', '5c37c000-0000-4000-8000-0000000000c1', 'K1', 150, 8, 1.5, 10),
  ('5c37d000-0000-4000-8000-0000000000d2', '5c37c000-0000-4000-8000-0000000000c1', 'K2', 120, 8, 1.5, 10);
insert into public.contract_terms
  (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor) values
  ('5c37d000-0000-4000-8000-0000000000d1', date '2026-01-01', date '2026-03-05', 133.33, 8, 1.5, 10, true, 'informada', 'LEI', 'diario', 4, 2),
  ('5c37d000-0000-4000-8000-0000000000d1', date '2026-03-05', null,              150.00, 8, 1.5, 10, true, 'informada', 'LEI', 'diario', 4, 2),
  ('5c37d000-0000-4000-8000-0000000000d2', date '2026-01-01', null,              120.00, 8, 1.5, 10, true, 'informada', 'LEI', 'acumulado', 4, 2);
insert into public.operations (id, client_id, contract_id, name) values
  ('5c37e000-0000-4000-8000-0000000000a1', '5c37c000-0000-4000-8000-0000000000c1', '5c37d000-0000-4000-8000-0000000000d1', 'OP1'),
  ('5c37e000-0000-4000-8000-0000000000a2', '5c37c000-0000-4000-8000-0000000000c1', '5c37d000-0000-4000-8000-0000000000d2', 'OP2');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5c37a000-0000-4000-8000-0000000000a1', '5c37e000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60),
  ('5c37a000-0000-4000-8000-0000000000a2', '5c37e000-0000-4000-8000-0000000000a2', 'S2', '06:00', '15:00', 60);
insert into public.financial_holidays (holiday_date, name, reason) values (date '2026-03-06', 'Feriado LEI', 'LEI sintético');
insert into public.employees (id, name, daily_cost)
  select ('5c37f000-0000-4000-8000-00000000000' || i)::uuid, 'LEI-E' || i, 111.11 from generate_series(1, 8) i;
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select ('5c37f000-0000-4000-8000-00000000000' || i)::uuid, date '2026-01-01', 111.11, true, 'informada', 'LEI'
    from generate_series(1, 8) i;

select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste LEI') ->> 'ativo')$q$));

create or replace function pg_temp.folha(_cod text, _op text, _data date) returns void language sql as $$
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c37b000-0000-4000-8000-0000000000' || _cod)::uuid, ('5c37e000-0000-4000-8000-0000000000' || _op)::uuid,
          ('5c37a000-0000-4000-8000-0000000000' || _op)::uuid, _data)
$$;
create or replace function pg_temp.id_e(_cod text) returns uuid language sql as $$
  select ('5c37b100-0000-4000-8000-0000000000' || _cod)::uuid
$$;
create or replace function pg_temp.entrada(_cod text, _folha text, _colab text, _in text, _out text, _pausa int default 60, _status text default 'present')
returns text language plpgsql as $$
begin
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values (pg_temp.id_e(_cod), ('5c37b000-0000-4000-8000-0000000000' || _folha)::uuid,
          ('5c37f000-0000-4000-8000-00000000000' || _colab)::uuid, _status::public.attendance_status,
          nullif(_in, '')::time, nullif(_out, '')::time, _pausa);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
-- billed|calc|base|he|especial|adicional
create or replace function pg_temp.v(_cod text) returns text language sql as $$
  select concat_ws('|', billed_amount::text, coalesce(calc_version::text, '-'), coalesce(billed_base_amount::text, '-'),
                   coalesce(billed_overtime_amount::text, '-'), coalesce(billed_special_amount::text, '-'), additional_amount::text)
    from public.timesheet_entries where id = pg_temp.id_e(_cod)
$$;
-- componentes pela função da 037: diaria|extra|especial|adicional
create or replace function pg_temp.c(_cod text) returns text language sql as $$
  select concat_ws('|', c.diaria::text, c.extra::text, c.especial::text, c.adicional::text)
    from public.timesheet_entries te
    cross join lateral public.componentes_do_lancamento(te.status::text, te.calc_version, te.billed_amount,
      te.daily_rate_snapshot, te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
      te.additional_amount) c
   where te.id = pg_temp.id_e(_cod)
$$;
-- a leitura ANTIGA (antes da 037): diária|extra
create or replace function pg_temp.antiga(_cod text) returns text language sql as $$
  select (billed_amount - greatest(billed_amount - daily_rate_snapshot, 0))::text || '|'
         || greatest(billed_amount - daily_rate_snapshot, 0)::text
    from public.timesheet_entries where id = pg_temp.id_e(_cod)
$$;

select pg_temp.folha('01', 'a1', date '2026-03-02');  -- segunda
select pg_temp.folha('02', 'a1', date '2026-03-03');  -- terça
select pg_temp.folha('05', 'a1', date '2026-03-05');  -- quinta, tarifa nova
select pg_temp.folha('06', 'a1', date '2026-03-06');  -- sexta, feriado
select pg_temp.folha('07', 'a1', date '2026-03-07');  -- sábado
select pg_temp.folha('08', 'a1', date '2026-03-08');  -- domingo
select pg_temp.folha('21', 'a2', date '2026-03-02');  -- acumulado

select pg_temp.registrar('F1. lançamentos gravados', 'ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok',
  concat_ws(',',
    pg_temp.entrada('01', '01', '1', '06:00', '15:15'),
    pg_temp.entrada('02', '01', '2', '06:00', '15:45'),
    pg_temp.entrada('03', '01', '3', '06:00', '11:00'),
    pg_temp.entrada('04', '02', '1', '06:00', '15:00'),
    pg_temp.entrada('05', '05', '1', '06:00', '15:00'),
    pg_temp.entrada('06', '05', '2', '06:00', '15:15'),
    pg_temp.entrada('07', '06', '4', '06:00', '15:00'),
    pg_temp.entrada('08', '07', '5', '06:00', '10:00', 0),
    pg_temp.entrada('09', '08', '6', '06:00', '15:15'),
    pg_temp.entrada('10', '01', '8', '', '', 0, 'absent'),
    pg_temp.entrada('11', '21', '1', '06:00', '15:14'),
    pg_temp.entrada('12', '21', '2', '06:00', '15:26'),
    pg_temp.entrada('13', '05', '3', '06:00', '15:00'),
    pg_temp.entrada('15', '08', '7', '06:00', '12:00', 0)));

-- ---------------------------------------------------------------------------
-- Dados SINTÉTICOS: só para provar os leitores (o motor desta etapa não os produz). O gatilho de
-- cálculo fica desligado SÓ dentro desta transação, para os valores não serem recalculados.
-- ---------------------------------------------------------------------------
alter table public.timesheet_entries disable trigger trg_timesheet_entries_calculo_vigencia;
-- F: lançamento gravado antes da 036 (legado), mesmos valores
update public.timesheet_entries set calc_version = null, billed_base_amount = null, billed_overtime_amount = null,
       billed_special_amount = null where id = pg_temp.id_e('04');
-- K: adicional diário de 35,00 num lançamento V2 (diária 150,00)
update public.timesheet_entries set additional_amount = 35.00, billed_amount = billed_amount + 35.00 where id = pg_temp.id_e('13');
-- K: domingo como horas especiais V2 (sem diária nem HE), com o valor que estava gravado
update public.timesheet_entries set calc_version = 2, billed_base_amount = 0, billed_overtime_amount = 0,
       billed_special_amount = billed_amount where id = pg_temp.id_e('15');
alter table public.timesheet_entries enable trigger trg_timesheet_entries_calculo_vigencia;

-- ---------------------------------------------------------------------------
-- A a J. Componentes gravados e lidos
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1/I1. útil, excedente 15 = 30 min: 133,33 + 12,50 (V2)', '145.83|2|133.33|12.50|0.00|0.00', pg_temp.v('01'));
select pg_temp.registrar('I2. útil, excedente 45 = 60 min: 133,33 + 25,00 (V2)', '158.33|2|133.33|25.00|0.00|0.00', pg_temp.v('02'));
select pg_temp.registrar('H1. saída antecipada: diária proporcional 133,33 × 240/480 = 66,67, sem HE', '66.67|2|66.67|0.00|0.00|0.00', pg_temp.v('03'));
select pg_temp.registrar('B1. sábado 4 h: diária inteira (V2)', '150.00|2|150.00|0.00|0.00|0.00', pg_temp.v('08'));
select pg_temp.registrar('C1. domingo 8h15: regra da 030 (resto 15 -> 0), legado', '150.00|-|-|-|-|0.00', pg_temp.v('09'));
select pg_temp.registrar('D1. feriado 8 h: regra da 030 (diária inteira), legado', '150.00|-|-|-|-|0.00', pg_temp.v('07'));
select pg_temp.registrar('D2. feriado: custo da 030 = 8 h × 111,11/8 × 2 = 222,22', '222.22',
  (select cost_amount::text from public.timesheet_entries where id = pg_temp.id_e('07')));
select pg_temp.registrar('E1. acumulado: 14 min brutos = 5,25 de HE gravada', '125.25|2|120.00|5.25|0.00|0.00', pg_temp.v('11'));
select pg_temp.registrar('F1b. legado (antes da 036): componentes nulos, mesmos valores', '133.33|-|-|-|-|0.00', pg_temp.v('04'));
select pg_temp.registrar('J1. HE pelo componente: a função devolve o gravado (V2)', '133.33|12.50|0.00|0.00', pg_temp.c('01'));
select pg_temp.registrar('F2. legado: a função decompõe pela regra da 030', '133.33|0.00|0|0', pg_temp.c('04'));
select pg_temp.registrar('C2. domingo legado NÃO vira hora especial', '150.00|0.00|0|0', pg_temp.c('09'));
select pg_temp.registrar('G1. falta: tudo zero', '0|0|0|0', pg_temp.c('10'));
select pg_temp.registrar('N1. Σ componentes = cobrado em todos os lançamentos (V2 e legado)', '0',
  (select count(*)::text from public.timesheet_entries te
     cross join lateral public.componentes_do_lancamento(te.status::text, te.calc_version, te.billed_amount,
       te.daily_rate_snapshot, te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
       te.additional_amount) c
    where te.timesheet_id::text like '5c37b000%' and c.diaria + c.extra + c.especial + c.adicional <> te.billed_amount));

-- ---------------------------------------------------------------------------
-- K. Componentes sintéticos: a leitura antiga erra; a nova acerta
-- ---------------------------------------------------------------------------

select pg_temp.registrar('K1. adicional diário: a leitura ANTIGA classifica os 35,00 como hora extra', '150.00|35.00', pg_temp.antiga('13'));
select pg_temp.registrar('K2. adicional diário: a leitura NOVA separa (diária 150, HE 0, adicional 35)', '150.00|0.00|0.00|35.00', pg_temp.c('13'));
select pg_temp.registrar('K3. horas especiais: a leitura ANTIGA as chama de diária', '112.50|0', pg_temp.antiga('15'));
select pg_temp.registrar('K4. horas especiais: a leitura NOVA as separa', '0.00|0.00|112.50|0.00', pg_temp.c('15'));

-- ---------------------------------------------------------------------------
-- R. Integridade: o que não fecha é erro, nunca "consertado"
-- ---------------------------------------------------------------------------

select pg_temp.registrar('R1. V2 com componente ausente: erro 23514', '23514',
  pg_temp.erro_de($q$select public.componentes_do_lancamento('present', 2::smallint, 100, 100, 100, null, 0, 0)$q$));
select pg_temp.registrar('R2. V2 cujos componentes não somam o cobrado: erro 23514', '23514',
  pg_temp.erro_de($q$select public.componentes_do_lancamento('present', 2::smallint, 100, 100, 90, 5, 0, 0)$q$));
select pg_temp.registrar('R3. horas especiais junto de diária: erro 23514', '23514',
  pg_temp.erro_de($q$select public.componentes_do_lancamento('present', 2::smallint, 100, 100, 50, 0, 50, 0)$q$));
select pg_temp.registrar('R4. legado com adicional: erro 23514', '23514',
  pg_temp.erro_de($q$select public.componentes_do_lancamento('present', null::smallint, 100, 100, null, null, null, 5)$q$));
select pg_temp.registrar('R5. versão desconhecida: erro 23514', '23514',
  pg_temp.erro_de($q$select public.componentes_do_lancamento('present', 3::smallint, 100, 100, 100, 0, 0, 0)$q$));

-- ---------------------------------------------------------------------------
-- E2. Ajuste do acumulado lê o componente
-- ---------------------------------------------------------------------------

create temporary table _ajustes on commit drop as
  select * from public.ajustes_de_arredondamento_acumulado('5c37c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15');
select pg_temp.registrar('E2. ajuste do acumulado: E1 14 -> 0 (−5,25); E2 26 -> 30 (+1,50); valor bruto = componente de HE',
  'LEI-E1|14|0|5.25|-5.25;LEI-E2|26|30|9.75|1.50',
  (select string_agg(colaborador || '|' || minutos_brutos || '|' || minutos_arredondados || '|' || valor_bruto || '|' || ajuste, ';' order by colaborador)
     from _ajustes));

-- ---------------------------------------------------------------------------
-- P. Resumo financeiro (fonte compartilhada)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('P1. resumo: receita dos apontamentos = Σ cobrado (inclusive adicional e especiais) = 1.820,72', '1820.72|-3.75',
  pg_temp.adm($q$select receita_apontamentos::text || '|' || ajuste_previsto::text
                   from public.resumo_financeiro_periodo(date '2026-03-01', date '2026-03-15', '5c37c000-0000-4000-8000-0000000000c1')$q$));

-- ---------------------------------------------------------------------------
-- Q. Permissões
-- ---------------------------------------------------------------------------

select pg_temp.registrar('Q1. anon e authenticated não executam componentes_do_lancamento', 'false|false|false',
  has_function_privilege('anon', 'public.componentes_do_lancamento(text, smallint, numeric, numeric, numeric, numeric, numeric, numeric)', 'execute')::text
  || '|' || has_function_privilege('authenticated', 'public.componentes_do_lancamento(text, smallint, numeric, numeric, numeric, numeric, numeric, numeric)', 'execute')::text
  || '|' || has_function_privilege('service_role', 'public.componentes_do_lancamento(text, smallint, numeric, numeric, numeric, numeric, numeric, numeric)', 'execute')::text);
select pg_temp.registrar('Q2. operacional não gera fatura (42501)', 'erro 42501',
  pg_temp.ope($q$select (public.gerar_fatura('5c37c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$));
select pg_temp.registrar('Q3. anon não gera fatura', 'erro 42501',
  pg_temp.anon($q$select (public.gerar_fatura('5c37c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$));

-- ---------------------------------------------------------------------------
-- L e N. Fatura pelos componentes
-- ---------------------------------------------------------------------------

create temporary table _fatura (id uuid) on commit drop;
insert into _fatura select pg_temp.adm($q$select (public.gerar_fatura('5c37c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$)::uuid;
create temporary table _itens on commit drop as
  select it.* from public.invoice_items it join _fatura f on f.id = it.invoice_id;

select pg_temp.registrar('N2. total da fatura = Σ cobrado + ajuste = 1.820,72 − 3,75 = 1.816,97; Σ itens = total', '1816.97|1816.97',
  (select i.total_amount::text || '|' || (select sum(amount) from _itens)::text from public.invoices i join _fatura f on f.id = i.id));
select pg_temp.registrar('N3. totais do cabeçalho como antes: 13 lançamentos; 2,50 h = (30 + 60 + 30 + 40 − 10 min de ajuste) / 60', '13.00|2.50',
  (select i.total_dailies::text || '|' || i.total_overtime::text from public.invoices i join _fatura f on f.id = i.id));
select pg_temp.registrar('L1. diárias por TARIFA: 133,33 × 3; 66,67 proporcional; 150,00 × 6 (OP1); 120,00 × 2 (OP2)',
  '3.00|133.33|399.99;6.00|150.00|900.00;1.00|66.67|66.67;2.00|120.00|240.00',
  (select string_agg(quantity::text || '|' || unit_price::text || '|' || amount::text, ';'
                     order by operation_id, description)
     from _itens where kind = 'diarias'));
select pg_temp.registrar('L2. as diárias nomeiam a tarifa e o caso proporcional', 'OP1 — diárias (tarifa 133,33);OP1 — diárias (tarifa 150,00);OP1 — diárias proporcionais (tarifa 133,33);OP2 — diárias (tarifa 120,00)',
  (select string_agg(description, ';' order by description) from _itens where kind = 'diarias'));
select pg_temp.registrar('J2. horas extras por valor-hora: OP1 25,00 → 1,50 h = 37,50; OP1 28,13 → 0,50 h = 14,06; OP2 22,50 → 0,67 h = 15,00',
  '1.50|37.50;0.50|14.06;0.67|15.00',
  (select string_agg(quantity::text || '|' || amount::text, ';' order by operation_id, description)
     from _itens where kind = 'horas_extras'));
select pg_temp.registrar('K5. fatura: horas especiais (112,50) e adicional diário (35,00) em itens próprios, fora da HE', 'adicional_diario|35.00;horas_especiais|112.50',
  (select string_agg(kind || '|' || amount::text, ';' order by kind) from _itens where kind in ('horas_especiais', 'adicional_diario')));
select pg_temp.registrar('N4. arredondamento do acumulado: −3,75 em itens por colaborador', '-3.75',
  (select sum(amount)::text from _itens where kind = 'arredondamento'));
select pg_temp.registrar('N5. Σ itens por tipo = Σ componentes por tipo', 'ok',
  (select case when (select sum(amount) from _itens where kind = 'diarias') = sum(c.diaria)
                and (select sum(amount) from _itens where kind = 'horas_extras') = sum(c.extra)
                and (select sum(amount) from _itens where kind = 'horas_especiais') = sum(c.especial)
                and (select sum(amount) from _itens where kind = 'adicional_diario') = sum(c.adicional)
               then 'ok' else 'divergente' end
     from public.timesheet_entries te
     cross join lateral public.componentes_do_lancamento(te.status::text, te.calc_version, te.billed_amount,
       te.daily_rate_snapshot, te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
       te.additional_amount) c
    where te.invoice_id = (select id from _fatura)));

-- M. Faturado continua imutável
select pg_temp.registrar('M1. lançamento faturado: editar a saída é recusado (42501)', 'erro 42501',
  pg_temp.adm(format($q$with u as (update public.timesheet_entries set check_out = '16:00' where id = %L returning 1) select count(*)::text from u$q$, pg_temp.id_e('01'))));
select pg_temp.registrar('M2. faturar de novo o mesmo período: nada a faturar (P0002)', 'erro P0002',
  pg_temp.adm($q$select (public.gerar_fatura('5c37c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$));

-- ---------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao = 'FAIL' order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '037_leitores_por_componentes: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
