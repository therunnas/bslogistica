-- Migration 042 — diária individual por colaborador + contrato e adicional diário (FIN-PR-08).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que
-- termina em `rollback`. NUNCA rodar contra Production nem homologação. Dados SINTÉTICOS (códigos
-- C01, K1, E1…; nenhum nome real de cliente, pessoa ou planilha).
--
-- Valores esperados CALCULADOS À MÃO com números redondos (hora = diária ÷ 8 × 1,5):
--   diária 260 -> hora 48,75   (individual do E1)     diária 240 -> hora 45,00 (padrão conferente)
--   diária 200 -> hora 37,50   (padrão operador)      diária 220 -> hora 41,25 (individual do E5)
--   diária 100 -> hora 18,75   (genérica do contrato)
--   1 h de excesso = 60 min cobrados; 2 h = 120 min.
--   Exemplo da regra: 260 + HE 1 h (48,75) + adicional 30 = 338,75; a base da HE continua 260.
--
-- O QUE ESTE ARQUIVO PROVA
--   I  diária individual: cadastro, validação, sobreposição, vigências, tabela imutável
--   D  resolução DESLIGADA: nada muda (individual cadastrada não é usada; adicional recusado)
--   R  resolução LIGADA: individual prevalece; padrão sem individual; contratos diferentes;
--      reajuste (dia anterior e dia exato); sem fonte = recusa; operação sem contrato
--   H  HE sobre a diária individual e sobre a padrão; domingo documentado
--   B  adicional diário: separado da HE, sem duplicação, preservado em recálculo, motivo/trilha
--   U  diária usada não se edita; a não usada, sim
--   F  fatura: itens, Σ itens = total, faturado e fatura histórica imutáveis
--   P  permissões e escrita direta
--   Z  desligar volta ao preço de antes

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
    if lower(ltrim(_sql)) ~ '^(select|with)' then
      execute _sql into _r;
    else
      execute _sql;
    end if;
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
    jsonb_build_object('sub', '5c420000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec420000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c420000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec420000-0000-4000-8000-0000000000a2'), _sql)
$$;
create or replace function pg_temp.anon(_sql text) returns text language sql as $$
  select pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), _sql)
$$;
create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return 'erro ' || sqlstate;
end;
$$;
create temporary table _exec (k text primary key, r text) on commit drop;
grant all on _exec to authenticated;
create or replace function pg_temp.exec(_k text, _sql text) returns void language sql as $$
  insert into _exec values (_k, pg_temp.adm(_sql))
$$;
create or replace function pg_temp.r(_k text) returns text language sql as $$
  select r from _exec where k = _k
$$;
create or replace function pg_temp.fn(_codigo text) returns uuid language sql as $$
  select id from public.job_functions where code = _codigo
$$;
create or replace function pg_temp.emp(_n text) returns uuid language sql as $$
  select ('5c42f000-0000-4000-8000-00000000000' || _n)::uuid
$$;

-- ---------------------------------------------------------------------------
-- Fixture (motor ligado, resolução desligada)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c420000-0000-4000-8000-0000000000a1'), ('5c420000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec420000-0000-4000-8000-0000000000a1', '5c420000-0000-4000-8000-0000000000a1', null),
  ('ec420000-0000-4000-8000-0000000000a2', '5c420000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c420000-0000-4000-8000-0000000000a1', 'admin'), ('5c420000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c42c000-0000-4000-8000-0000000000c1', 'C01');
-- K1 e K2: diária GENÉRICA 100 (a de antes), fator 1,5, jornada 8 h.
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c42d000-0000-4000-8000-0000000000d1', '5c42c000-0000-4000-8000-0000000000c1', 'K1', 100, 8, 1.5, 10),
  ('5c42d000-0000-4000-8000-0000000000d2', '5c42c000-0000-4000-8000-0000000000c1', 'K2', 100, 8, 1.5, 10);
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor)
  select c.id, date '2026-01-01', 100, 8, 1.5, 10, true, 'informada', 'IND', 'diario', 4, 2 from public.contracts c
   where c.id in ('5c42d000-0000-4000-8000-0000000000d1', '5c42d000-0000-4000-8000-0000000000d2');
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c42e000-0000-4000-8000-0000000000a1', '5c42c000-0000-4000-8000-0000000000c1', '5c42d000-0000-4000-8000-0000000000d1', 'OP1', null),
  ('5c42e000-0000-4000-8000-0000000000a2', '5c42c000-0000-4000-8000-0000000000c1', null, 'OP-SEM-CONTRATO', 200),
  ('5c42e000-0000-4000-8000-0000000000a3', '5c42c000-0000-4000-8000-0000000000c1', '5c42d000-0000-4000-8000-0000000000d2', 'OP3', null);
insert into public.operation_terms (operation_id, valid_from, agreed_amount, active, origin, reason) values
  ('5c42e000-0000-4000-8000-0000000000a2', date '2026-01-01', 200, true, 'informada', 'IND');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight, shift_period) values
  ('5c42a000-0000-4000-8000-0000000000a1', '5c42e000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60, false, 'diurno'),
  ('5c42a000-0000-4000-8000-0000000000a2', '5c42e000-0000-4000-8000-0000000000a1', 'S2', '22:00', '07:00', 60, true, 'noturno'),
  ('5c42a000-0000-4000-8000-0000000000a4', '5c42e000-0000-4000-8000-0000000000a2', 'S4', '06:00', '15:00', 60, false, 'diurno'),
  ('5c42a000-0000-4000-8000-0000000000a5', '5c42e000-0000-4000-8000-0000000000a3', 'S5', '06:00', '15:00', 60, false, 'diurno');
insert into public.employees (id, name, daily_cost) values
  (pg_temp.emp('1'), 'IND-E1', 80), (pg_temp.emp('2'), 'IND-E2', 80), (pg_temp.emp('3'), 'IND-E3', 80),
  (pg_temp.emp('4'), 'IND-E4', 80), (pg_temp.emp('5'), 'IND-E5', 80), (pg_temp.emp('6'), 'IND-E6', 80),
  (pg_temp.emp('7'), 'IND-E7', 80);
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select e.id, date '2026-01-01', 80, true, 'informada', 'IND' from public.employees e where e.name like 'IND-E%';
-- Funções: E1/E2/E3 conferente; E4/E5 operador; E6 auxiliar (sem tarifa); E7 SEM função.
insert into public.operation_team (operation_id, shift_id, employee_id, job_function_id)
  select o.id, null, pg_temp.emp(x.n), (select id from public.job_functions where code = x.f)
    from (values ('1', 'conferente'), ('2', 'conferente'), ('3', 'conferente'), ('4', 'operador'), ('5', 'operador'),
                 ('6', 'auxiliar_producao')) as x(n, f)
    cross join public.operations o where o.id = '5c42e000-0000-4000-8000-0000000000a1';
insert into public.operation_team (operation_id, shift_id, employee_id, job_function_id) values
  ('5c42e000-0000-4000-8000-0000000000a1', null, pg_temp.emp('7'), null);
insert into public.user_operation_access (user_id, operation_id)
  values ('5c420000-0000-4000-8000-0000000000a2', '5c42e000-0000-4000-8000-0000000000a1');

set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste IND') ->> 'ativo')$q$));

-- Salva uma linha (como a tela). _turno 'a1'/'a2'/'a4'/'a5'.
create or replace function pg_temp.salvar(_k text, _op text, _turno text, _data date, _emp text, _saida text, _ent text default '06:00', _status text default 'present', _fn text default '') returns void
language sql as $$
  select pg_temp.exec(_k, format($q$select public.salvar_apontamento_admin('5c42e000-0000-4000-8000-0000000000%s', %L, %L,
    jsonb_build_array(jsonb_build_object('employee_id', %L, 'status', %L,
      'check_in', %L, 'check_out', %L, 'break_minutes', 60) || case when %L = '' then '{}'::jsonb else jsonb_build_object('job_function_id', %L) end))::text$q$,
    _op, '5c42a000-0000-4000-8000-0000000000' || _turno, _data, pg_temp.emp(_emp)::text, _status,
    case when _status = 'absent' then null else _ent end, case when _status = 'absent' then null else _saida end, _fn, _fn))
$$;
-- cobrado|minutos HE|diária congelada|fonte|adicional|HE em R$
create or replace function pg_temp.v(_emp text, _data date) returns text language sql as $$
  select te.billed_amount::text || '|' || coalesce(te.billed_overtime_minutes::text, '-') || '|' || te.daily_rate_snapshot::text
         || '|' || coalesce(te.price_source, 'generica') || '|' || te.additional_amount::text || '|' || te.billed_overtime_amount::text
    from public.timesheet_entries te
   where te.employee_id = pg_temp.emp(_emp) and te.work_date = _data and te.operation_id = '5c42e000-0000-4000-8000-0000000000a1'
$$;
create or replace function pg_temp.id_de(_emp text, _data date) returns uuid language sql as $$
  select id from public.timesheet_entries where employee_id = pg_temp.emp(_emp) and work_date = _data and operation_id = '5c42e000-0000-4000-8000-0000000000a1'
$$;

-- ---------------------------------------------------------------------------
-- I. Diária individual
-- ---------------------------------------------------------------------------

create or replace function pg_temp.ind(_k text, _emp text, _de date, _valor numeric, _ate date default null, _enc boolean default false, _contrato text default 'd1') returns void language sql as $$
  select pg_temp.exec(_k, format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000%s', %L, %L, %s, 'Diária IND', %L, %L)::text$q$,
    _contrato, pg_temp.emp(_emp)::text, _de, _valor, _ate, _enc))
$$;
select pg_temp.ind('i1', '1', date '2026-01-01', 260);
select pg_temp.ind('i2', '3', date '2026-03-01', 220, date '2026-04-01');
select pg_temp.ind('i3', '3', date '2026-04-01', 225);
select pg_temp.ind('i4', '5', date '2026-01-01', 220);
select pg_temp.registrar('I1. quatro diárias individuais cadastradas, ativas, com origem e autor', '4|4|informada|true',
  (select count(*)::text || '|' || count(*) filter (where active)::text || '|' || min(origin) || '|' || bool_and(created_by = '5c420000-0000-4000-8000-0000000000a1')::text
     from public.contract_employee_rates));
select pg_temp.registrar('I2. uma linha de trilha por cadastro, com motivo', '4',
  (select count(*)::text from public.financial_terms_audit where action = 'diaria_individual_registrada' and reason = 'Diária IND'));
select pg_temp.registrar('I3. sobreposição do mesmo colaborador no mesmo contrato recusada (23P01); outro contrato e outro colaborador passam',
  'erro 23P01|erro 23P01|ok|ok',
  pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2026-03-01', 270, 'Sobreposta')::text$q$, pg_temp.emp('1')::text))
  || '|' || pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2025-12-01', 270, 'Sobreposta', date '2026-02-01')::text$q$, pg_temp.emp('1')::text))
  || '|' || case when pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d2', %L, date '2026-01-01', 270, 'Outro contrato')::text$q$, pg_temp.emp('2')::text))
                  ~ '^[0-9a-f-]{36}$' then 'ok' else 'falhou' end
  || '|' || case when pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2026-01-01', 215, 'Outro colaborador')::text$q$, pg_temp.emp('4')::text))
                  ~ '^[0-9a-f-]{36}$' then 'ok' else 'falhou' end);
select pg_temp.registrar('I4. valores e referências inválidos recusados: zero, negativo, 3 casas, vigência invertida, sem motivo (22023); colaborador e contrato inexistentes (P0002)',
  'erro 22023|erro 22023|erro 22023|erro 22023|erro 22023|erro P0002|erro P0002',
  pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2030-01-01', 0, 'x')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2030-01-01', -5, 'x')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2030-01-01', 10.005, 'x')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2030-01-01', 10, 'x', date '2029-01-01')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2030-01-01', 10, '  ')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.adm($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', gen_random_uuid(), date '2030-01-01', 10, 'x')::text$q$)
  || '|' || pg_temp.adm(format($q$select public.registrar_diaria_individual(gen_random_uuid(), %L, date '2030-01-01', 10, 'x')::text$q$, pg_temp.emp('6')::text)));
select pg_temp.registrar('I5. a tabela recusa direto (nem o dono): diária zero e vigência invertida (23514)', 'erro 23514|erro 23514',
  pg_temp.erro_de(format($q$insert into public.contract_employee_rates (contract_id, employee_id, valid_from, daily_rate, origin, reason) values ('5c42d000-0000-4000-8000-0000000000d1', %L, date '2031-01-01', 0, 'informada', 'x')$q$, pg_temp.emp('6')))
  || '|' || pg_temp.erro_de(format($q$insert into public.contract_employee_rates (contract_id, employee_id, valid_from, valid_to, daily_rate, origin, reason) values ('5c42d000-0000-4000-8000-0000000000d1', %L, date '2031-01-01', date '2030-01-01', 10, 'informada', 'x')$q$, pg_temp.emp('6'))));
select pg_temp.registrar('I6. diária individual não se apaga nem se reescreve (42501), inclusive para o dono; truncar é impossível (0A000: tabela referenciada por FK)', 'erro 42501|erro 42501|erro 0A000',
  pg_temp.erro_de($q$delete from public.contract_employee_rates$q$)
  || '|' || pg_temp.erro_de($q$update public.contract_employee_rates set daily_rate = 1$q$)
  || '|' || pg_temp.erro_de($q$truncate public.contract_employee_rates$q$));
select pg_temp.registrar('I7. a diária individual é PREÇO cobrado: employees.daily_cost e o custo vigente não mudam', '80.00|80.00',
  (select daily_cost::text from public.employees where id = pg_temp.emp('1'))
  || '|' || (select daily_cost::text from public.employee_cost_terms where employee_id = pg_temp.emp('1') and active));
select pg_temp.registrar('I8. leitura da diária vigente na data: 220 em 31/03, 225 em 01/04, nenhuma antes de 2026 (E3)', '220.00|225.00|nulo',
  pg_temp.adm(format($q$select daily_rate::text from public.diaria_individual_na_data('5c42d000-0000-4000-8000-0000000000d1', %L, date '2026-03-31')$q$, pg_temp.emp('3')::text))
  || '|' || pg_temp.adm(format($q$select daily_rate::text from public.diaria_individual_na_data('5c42d000-0000-4000-8000-0000000000d1', %L, date '2026-04-01')$q$, pg_temp.emp('3')::text))
  || '|' || pg_temp.adm(format($q$select daily_rate::text from public.diaria_individual_na_data('5c42d000-0000-4000-8000-0000000000d1', %L, date '2025-06-01')$q$, pg_temp.emp('3')::text)));

-- ---------------------------------------------------------------------------
-- D. Resolução DESLIGADA: nada muda
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D0. a resolução nasce desligada e o banco anuncia as capacidades novas', 'false|true|true|false',
  public.resolucao_de_tarifas_ativa()::text
  || '|' || (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'diaria_individual')$q$))
  || '|' || (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'bonus_diario')$q$))
  || '|' || (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'resolucao_tarifas')$q$)));
select pg_temp.salvar('d1', 'a1', 'a1', date '2026-02-02', '1', '16:00');
select pg_temp.salvar('d2', 'a1', 'a1', date '2026-02-02', '2', '15:00');
select pg_temp.registrar('D1. com diária individual cadastrada e a resolução desligada o preço é o de antes: genérica 100 + HE 1 h × 18,75 = 118,75, sem fonte e sem adicional',
  '118.75|60|100.00|generica|0.00|18.75', pg_temp.v('1', date '2026-02-02'));
select pg_temp.registrar('D2. o outro colaborador também: 100,00 (genérica)', '100.00|0|100.00|generica|0.00|0.00', pg_temp.v('2', date '2026-02-02'));
select pg_temp.registrar('D3. sem fonte de preço gravada (nem individual nem tarifa) no lançamento legado', '0',
  (select count(*)::text from public.timesheet_entries where contract_employee_rate_id is not null or price_source is not null or contract_rate_terms_id is not null));
select pg_temp.exec('d4', format($q$select (public.definir_bonus_do_apontamento(%L, 30, 'Acúmulo de função'))::text$q$, pg_temp.id_de('1', date '2026-02-02')));
select pg_temp.registrar('D4. adicional diário recusado com a resolução desligada (55000); additional_amount permanece 0', 'erro 55000|0.00|118.75',
  pg_temp.r('d4') || '|' || (select additional_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-02-02'))
  || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-02-02')));
select pg_temp.registrar('D5. escrita direta do adicional pelo admin (PostgREST) é recusada (42501)', 'erro 42501',
  pg_temp.adm(format($q$update public.timesheet_entries set additional_amount = 30 where id = %L$q$, pg_temp.id_de('1', date '2026-02-02'))));

select pg_temp.exec('d6', $q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1', date '2026-02-01', date '2026-02-15')).total_amount::text$q$);
create temporary table _fev on commit drop as
  select (select md5(string_agg(to_jsonb(te)::text, ',' order by te.id)) from public.timesheet_entries te where te.work_date < date '2026-03-01') as e,
         (select md5(string_agg(to_jsonb(i)::text, ',' order by i.id)) from public.invoices i) as f,
         (select md5(string_agg(to_jsonb(it)::text, ',' order by it.id)) from public.invoice_items it) as it;
select pg_temp.registrar('D6. fatura de fevereiro (legado, antes de ligar a resolução): 118,75 + 100,00', '218.75', pg_temp.r('d6'));

-- ---------------------------------------------------------------------------
-- A. Tarifas padrão e ativação
-- ---------------------------------------------------------------------------

create or replace function pg_temp.tarifa(_k text, _fn text, _per text, _de date, _valor numeric, _contrato text default 'd1') returns void language sql as $$
  select pg_temp.exec(_k, format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000%s', %L, %L, %L, %s, 'Tarifa IND')::text$q$,
    _contrato, pg_temp.fn(_fn), _per, _de, _valor))
$$;
select pg_temp.tarifa('t1', 'conferente', 'diurno', date '2026-01-01', 240);
select pg_temp.tarifa('t2', 'operador', 'diurno', date '2026-01-01', 200);
select pg_temp.tarifa('t3', 'conferente', 'diurno', date '2026-01-01', 300, 'd2');
select pg_temp.tarifa('t4', 'operador', 'diurno', date '2026-01-01', 190, 'd2');
select pg_temp.exec('a1', $q$select (public.alterar_resolucao_tarifas(true, 'Ligada no teste IND'))::text$q$);
select pg_temp.registrar('A1. admin liga a resolução (tarifas padrão cadastradas)', 'true',
  (pg_temp.r('a1') like '%"ativa": true%')::text);

-- ---------------------------------------------------------------------------
-- R. Resolução LIGADA: a individual prevalece
-- ---------------------------------------------------------------------------

select pg_temp.salvar('r1', 'a1', 'a1', date '2026-03-02', '1', '16:00');
select pg_temp.salvar('r2', 'a1', 'a1', date '2026-03-02', '2', '15:00');
select pg_temp.salvar('r3', 'a1', 'a1', date '2026-03-03', '2', '16:00');
select pg_temp.registrar('R1. individual prevalece: E1 (individual 260) = 260 + HE 1 h × 48,75 = 308,75, fonte individual, diária congelada 260',
  '308.75|60|260.00|individual|0.00|48.75', pg_temp.v('1', date '2026-03-02'));
select pg_temp.registrar('R2. sem individual vale a tarifa padrão da função: E2 conferente = 240,00 (fonte funcao_periodo)',
  '240.00|0|240.00|funcao_periodo|0.00|0.00', pg_temp.v('2', date '2026-03-02'));
select pg_temp.registrar('R3. duas diárias na MESMA função e no mesmo dia: conferentes 260,00 (individual) e 240,00 (padrão) sem exceção silenciosa',
  '308.75|240.00',
  (select string_agg(billed_amount::text, '|' order by employee_id) from public.timesheet_entries
    where work_date = date '2026-03-02' and operation_id = '5c42e000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('R4. ligação de auditoria: a individual aponta a versão do E1 (e não a tarifa); a padrão aponta a tarifa (e não a individual)',
  'true|true|true|true',
  (select (te.contract_employee_rate_id = (select r.id from public.contract_employee_rates r where r.employee_id = pg_temp.emp('1') and r.contract_id = '5c42d000-0000-4000-8000-0000000000d1')
           and te.contract_rate_terms_id is null)::text from public.timesheet_entries te where te.id = pg_temp.id_de('1', date '2026-03-02'))
  || '|' || (select (te.contract_rate_terms_id is not null and te.contract_employee_rate_id is null)::text from public.timesheet_entries te where te.id = pg_temp.id_de('2', date '2026-03-02'))
  || '|' || (select (te.contract_terms_id is not null)::text from public.timesheet_entries te where te.id = pg_temp.id_de('1', date '2026-03-02'))
  || '|' || (select (te.job_function_id_snapshot is not null and te.shift_period_snapshot = 'diurno')::text from public.timesheet_entries te where te.id = pg_temp.id_de('1', date '2026-03-02')));

-- Contratos diferentes: a individual de K1 não vale em K2.
select pg_temp.salvar('r5', 'a3', 'a5', date '2026-03-02', '1', '15:00', '06:00', 'present', pg_temp.fn('conferente')::text);
select pg_temp.salvar('r6', 'a3', 'a5', date '2026-03-02', '5', '15:00', '06:00', 'present', pg_temp.fn('operador')::text);
select pg_temp.salvar('r7', 'a1', 'a1', date '2026-03-02', '5', '15:00');
select pg_temp.registrar('R5. contratos diferentes: E1 no K2 (sem individual lá) = tarifa padrão do K2 (300,00), não os 260 do K1',
  '300.00|0|300.00|funcao_periodo|0.00|0.00',
  (select te.billed_amount::text || '|' || te.billed_overtime_minutes::text || '|' || te.daily_rate_snapshot::text || '|' || te.price_source || '|' || te.additional_amount::text || '|' || te.billed_overtime_amount::text
     from public.timesheet_entries te where te.employee_id = pg_temp.emp('1') and te.operation_id = '5c42e000-0000-4000-8000-0000000000a3' and te.work_date = date '2026-03-02'));
select pg_temp.registrar('R6. o mesmo colaborador (E5): individual 220 no K1 e tarifa padrão 190 no K2 no mesmo dia',
  '220.00|190.00',
  (select string_agg(billed_amount::text, '|' order by billed_amount desc) from public.timesheet_entries where employee_id = pg_temp.emp('5') and work_date = date '2026-03-02'));

-- Reajuste da individual (E3: 220 até 31/03, 225 desde 01/04)
select pg_temp.salvar('r8', 'a1', 'a1', date '2026-03-31', '3', '15:00');
select pg_temp.salvar('r9', 'a1', 'a1', date '2026-04-01', '3', '15:00');
select pg_temp.registrar('R7. vigência com reajuste: o dia ANTERIOR (31/03) cobra 220,00 e o dia EXATO do início (01/04) cobra 225,00',
  '220.00|0|220.00|individual|0.00|0.00|225.00|0|225.00|individual|0.00|0.00',
  pg_temp.v('3', date '2026-03-31') || '|' || pg_temp.v('3', date '2026-04-01'));

-- Individual não depende do período do turno (noturno sem tarifa de conferente noturna)
select pg_temp.salvar('r10', 'a1', 'a2', date '2026-03-04', '1', '07:00', '22:00');
select pg_temp.salvar('r11', 'a1', 'a2', date '2026-03-04', '2', '07:00', '22:00');
select pg_temp.registrar('R8. a individual vale também no turno noturno (E1 = 260,00); sem individual e sem tarifa noturna o apontamento é recusado (P0002) e nada é gravado',
  '260.00|0|260.00|individual|0.00|0.00|erro P0002|0',
  pg_temp.v('1', date '2026-03-04') || '|' || pg_temp.r('r11')
  || '|' || (select count(*)::text from public.timesheet_entries where employee_id = pg_temp.emp('2') and work_date = date '2026-03-04'));

-- Sem fonte válida e classificação obrigatória
select pg_temp.salvar('p1', 'a1', 'a1', date '2026-03-05', '6', '15:00');
select pg_temp.salvar('p2', 'a1', 'a1', date '2026-03-05', '7', '15:00');
select pg_temp.registrar('R9. função sem tarifa e sem individual (E6): P0002, sem fallback para a diária genérica; sem função (E7): pendente 55000; nada gravado',
  'erro P0002|erro 55000|0',
  pg_temp.r('p1') || '|' || pg_temp.r('p2')
  || '|' || (select count(*)::text from public.timesheet_entries where work_date = date '2026-03-05' and employee_id in (pg_temp.emp('6'), pg_temp.emp('7'))));
select pg_temp.ind('x1', '7', date '2026-01-01', 230);
select pg_temp.salvar('p3', 'a1', 'a1', date '2026-03-06', '7', '15:00');
select pg_temp.registrar('R10. a diária individual NÃO contorna a classificação: E7 tem individual, mas sem função trabalhada o apontamento segue pendente (55000)', 'erro 55000',
  pg_temp.r('p3'));
select pg_temp.ind('x2', '6', date '2026-03-01', 210);
select pg_temp.salvar('p4', 'a1', 'a1', date '2026-03-06', '6', '15:00');
select pg_temp.registrar('R11. função sem tarifa mas COM individual (E6): a individual é uma fonte válida = 210,00', '210.00|0|210.00|individual|0.00|0.00',
  pg_temp.v('6', date '2026-03-06'));

-- Operação sem contrato mantém o valor acordado (a individual é do contrato)
select pg_temp.salvar('o1', 'a2', 'a4', date '2026-03-02', '1', '15:00', '06:00', 'present', pg_temp.fn('conferente')::text);
select pg_temp.registrar('R12. operação sem contrato mantém o valor acordado (200,00), sem fonte, mesmo com individual em outro contrato', '200.00|0|200.00|generica|0.00|0.00',
  (select te.billed_amount::text || '|' || te.billed_overtime_minutes::text || '|' || te.daily_rate_snapshot::text || '|' || coalesce(te.price_source, 'generica') || '|' || te.additional_amount::text || '|' || te.billed_overtime_amount::text
     from public.timesheet_entries te where te.operation_id = '5c42e000-0000-4000-8000-0000000000a2'));

-- Troca de colaborador num apontamento não faturado reprecifica pela fonte do novo colaborador
select pg_temp.salvar('x3', 'a1', 'a1', date '2026-03-09', '4', '15:00');
update public.timesheet_entries set employee_id = pg_temp.emp('1') where id = pg_temp.id_de('4', date '2026-03-09');
select pg_temp.registrar('R13. apontamento de E4 (operador padrão 200) passado para E1 (individual 260) reprecifica: o preço acompanha o colaborador',
  '260.00|0|260.00|individual|0.00|0.00', pg_temp.v('1', date '2026-03-09'));

-- ---------------------------------------------------------------------------
-- H. HE sobre a individual e sobre a padrão; domingo documentado
-- ---------------------------------------------------------------------------

select pg_temp.salvar('h1', 'a1', 'a1', date '2026-03-10', '1', '17:00');
select pg_temp.salvar('h2', 'a1', 'a1', date '2026-03-10', '2', '17:00');
select pg_temp.salvar('h3', 'a1', 'a1', date '2026-03-10', '5', '16:00');
select pg_temp.registrar('H1. HE sobre a individual: 260 + 2 h × 48,75 = 357,50; sobre a padrão (240): 240 + 2 h × 45,00 = 330,00; individual 220: 220 + 41,25 = 261,25',
  '357.50|120|260.00|individual|0.00|97.50|330.00|120|240.00|funcao_periodo|0.00|90.00|261.25|60|220.00|individual|0.00|41.25',
  pg_temp.v('1', date '2026-03-10') || '|' || pg_temp.v('2', date '2026-03-10') || '|' || pg_temp.v('5', date '2026-03-10'));
select pg_temp.salvar('h4', 'a1', 'a1', date '2026-03-07', '1', '11:00');
select pg_temp.salvar('h5', 'a1', 'a1', date '2026-03-07', '2', '12:00');
select pg_temp.registrar('H2. sábado com referência de 4 h: 4 h líquidas = diária cheia da individual (260,00); 5 h na padrão = 240 + 1 h × 45,00 = 285,00',
  '260.00|0|260.00|individual|0.00|0.00|285.00|60|240.00|funcao_periodo|0.00|45.00',
  pg_temp.v('1', date '2026-03-07') || '|' || pg_temp.v('2', date '2026-03-07'));
select pg_temp.registrar('H3. componentes persistidos: base + HE + especial + adicional = cobrado em todos os lançamentos V2 com a resolução ligada', 'true',
  (select bool_and(billed_base_amount + billed_overtime_amount + billed_special_amount + additional_amount = billed_amount)::text
     from public.timesheet_entries where calc_version = 2 and work_date >= date '2026-03-01'));

-- ---------------------------------------------------------------------------
-- B. Adicional diário (bônus)
-- ---------------------------------------------------------------------------

create temporary table _custo on commit drop as
  select cost_amount from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02');
select pg_temp.exec('b1', format($q$select (public.definir_bonus_do_apontamento(%L, 30, 'Acúmulo de função'))::text$q$, pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('B1. adicional de R$ 30 separado da HE: 260 + HE 48,75 + adicional 30 = 338,75; a diária congelada (base da HE) continua 260',
  'true|338.75|60|260.00|individual|30.00|48.75', (pg_temp.r('b1') like '%338.75%')::text || '|' || pg_temp.v('1', date '2026-03-02'));
select pg_temp.registrar('B2. componentes: base 260 + HE 48,75 + especial 0 + adicional 30 = total 338,75 (identidade da 036)', '260.00|48.75|0.00|30.00|338.75|2',
  (select billed_base_amount::text || '|' || billed_overtime_amount::text || '|' || billed_special_amount::text || '|' || additional_amount::text || '|' || billed_amount::text || '|' || calc_version::text
     from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('B3. o adicional é COBRADO, não custo pago: o custo do apontamento não muda', 'true',
  ((select cost_amount from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')) = (select cost_amount from _custo))::text);
select pg_temp.registrar('B4. trilha: uma linha com motivo, antes (0,00) e depois (30,00)', '1|0.00|30.00',
  (select count(*)::text || '|' || min(previous ->> 'additional_amount') || '|' || min(new ->> 'additional_amount')
     from public.financial_terms_audit where action = 'apontamento_bonus_definido' and reason = 'Acúmulo de função'));
select pg_temp.exec('b5', format($q$select (public.definir_bonus_do_apontamento(%L, 30, 'De novo'))::text$q$, pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('B5. sem duplicação: segundo adicional sem confirmar a substituição é recusado (23505) e o total fica 338,75', 'erro 23505|338.75',
  pg_temp.r('b5') || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')));
-- Recalcular o apontamento (saída 17:00 = 2 h de excesso) preserva o adicional e NÃO o põe na base da HE.
select pg_temp.salvar('b6', 'a1', 'a1', date '2026-03-02', '1', '17:00');
select pg_temp.registrar('B6. salvar de novo o apontamento preserva o adicional e a HE segue só sobre a diária: 260 + 2 h × 48,75 + 30 = 387,50',
  '387.50|120|260.00|individual|30.00|97.50', pg_temp.v('1', date '2026-03-02'));
select pg_temp.exec('b7', format($q$select (public.definir_bonus_do_apontamento(%L, 40, 'Valor corrigido', true))::text$q$, pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('B7. substituir (confirmado): 40 em vez de 30 → 397,50; a trilha ganha uma segunda linha', '397.50|2',
  (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02'))
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'apontamento_bonus_definido'));
select pg_temp.exec('b8', format($q$select (public.definir_bonus_do_apontamento(%L, 0, 'Retirado', true))::text$q$, pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('B8. valor zero remove o adicional: 260 + 97,50 = 357,50', '357.50|0.00',
  (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02'))
  || '|' || (select additional_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.exec('b9', format($q$select (public.definir_bonus_do_apontamento(%L, 0, 'Nada a retirar'))::text$q$, pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('B9. remover onde não há adicional é recusado (22023)', 'erro 22023', pg_temp.r('b9'));
-- Apontamento sem HE
select pg_temp.exec('b10', format($q$select (public.definir_bonus_do_apontamento(%L, 30, 'Acúmulo sem HE'))::text$q$, pg_temp.id_de('2', date '2026-03-02')));
select pg_temp.registrar('B10. adicional sem HE: 240 + 30 = 270,00 (fonte funcao_periodo)', '270.00|0|240.00|funcao_periodo|30.00|0.00', pg_temp.v('2', date '2026-03-02'));
-- Validações
select pg_temp.salvar('b11', 'a1', 'a1', date '2026-03-11', '2', '15:00', '06:00', 'absent');
select pg_temp.registrar('B11. valor inválido (negativo, 3 casas, sem motivo): 22023; apontamento inexistente: P0002; falta: 55000',
  'erro 22023|erro 22023|erro 22023|erro P0002|erro 55000',
  pg_temp.adm(format($q$select (public.definir_bonus_do_apontamento(%L, -1, 'x'))::text$q$, pg_temp.id_de('3', date '2026-03-31')))
  || '|' || pg_temp.adm(format($q$select (public.definir_bonus_do_apontamento(%L, 10.005, 'x'))::text$q$, pg_temp.id_de('3', date '2026-03-31')))
  || '|' || pg_temp.adm(format($q$select (public.definir_bonus_do_apontamento(%L, 10, '  '))::text$q$, pg_temp.id_de('3', date '2026-03-31')))
  || '|' || pg_temp.adm($q$select (public.definir_bonus_do_apontamento(gen_random_uuid(), 10, 'x'))::text$q$)
  || '|' || pg_temp.adm(format($q$select (public.definir_bonus_do_apontamento(%L, 10, 'Falta'))::text$q$, pg_temp.id_de('2', date '2026-03-11'))));
-- Banco 042: domingo legado; 043: regra especial V2 com a mesma diária resolvida.
select pg_temp.salvar('s1', 'a1', 'a1', date '2026-03-08', '1', '15:00');
do $$ begin
  if pg_temp.adm($q$select (public.estado_motor_vigencia()->>'dias_especiais_v2')$q$) = 'true' then
    perform pg_temp.registrar('B12. domingo V2 após a 043: individual 260, especial 520, base/HE zero, custo 160',
      '520.00|2|individual|0.00|0.00|0.00|520.00|160.00',
      (select concat_ws('|',billed_amount,calc_version,price_source,additional_amount,billed_base_amount,billed_overtime_amount,billed_special_amount,cost_amount)
       from public.timesheet_entries where id=pg_temp.id_de('1',date '2026-03-08')));
  else
    perform pg_temp.registrar('B12. banco 042 mantém domingo legado e recusa bônus',
      '260.00|nulo|individual|0.00|erro 55000',
      (select concat_ws('|',billed_amount,coalesce(calc_version::text,'nulo'),price_source,additional_amount)
       from public.timesheet_entries where id=pg_temp.id_de('1',date '2026-03-08'))
      || '|' || pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,10,'Domingo')::text$q$,pg_temp.id_de('1',date '2026-03-08'))));
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- U. Diária individual usada não se edita; a não usada, sim
-- ---------------------------------------------------------------------------

create or replace function pg_temp.id_ind(_emp text, _de date) returns uuid language sql as $$
  select id from public.contract_employee_rates
   where employee_id = pg_temp.emp(_emp) and contract_id = '5c42d000-0000-4000-8000-0000000000d1' and valid_from = _de and active
$$;
select pg_temp.registrar('U1. diária JÁ USADA: corrigir, aposentar e encerrar antes de uma data usada são recusados (55000)', 'erro 55000|erro 55000|erro 55000',
  pg_temp.adm(format($q$select public.corrigir_diaria_individual(%L, date '2026-01-01', null, 999, 'Reajuste retroativo')::text$q$, pg_temp.id_ind('1', date '2026-01-01')))
  || '|' || pg_temp.adm(format($q$select public.aposentar_diaria_individual(%L, 'Não quero mais')::text$q$, pg_temp.id_ind('1', date '2026-01-01')))
  || '|' || pg_temp.adm(format($q$select public.encerrar_diaria_individual(%L, date '2026-03-03', 'Cortar antes do uso')::text$q$, pg_temp.id_ind('1', date '2026-01-01'))));
select pg_temp.ind('u2', '4', date '2026-05-01', 210, null, true);
select pg_temp.exec('u3', format($q$select public.corrigir_diaria_individual(%L, date '2026-05-01', null, 215, 'Valor combinado era 215')::text$q$, pg_temp.id_ind('4', date '2026-05-01')));
select pg_temp.registrar('U2. diária NÃO usada: a correção aposenta a versão e cria outra (215,00), com trilha', 'true|215.00|1|1',
  (pg_temp.r('u3') ~ '^[0-9a-f-]{36}$')::text
  || '|' || (select daily_rate::text from public.contract_employee_rates where employee_id = pg_temp.emp('4') and valid_from = date '2026-05-01' and active)
  || '|' || (select count(*)::text from public.contract_employee_rates where employee_id = pg_temp.emp('4') and valid_from = date '2026-05-01' and not active and replaced_by is not null)
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'diaria_individual_corrigida'));
select pg_temp.registrar('U3. registrar com p_encerrar_anterior encerrou a vigência aberta anterior do E4 em 01/05, sem apagar nada', '2026-05-01',
  (select valid_to::text from public.contract_employee_rates where employee_id = pg_temp.emp('4') and valid_from = date '2026-01-01'));
select pg_temp.exec('u4', format($q$select public.aposentar_diaria_individual(%L, 'Sem uso')::text$q$, pg_temp.id_ind('4', date '2026-05-01')));
select pg_temp.registrar('U4. diária não usada pode ser aposentada; aposentar de novo é recusado (55000)', '|erro 55000',
  pg_temp.r('u4') || '|' || pg_temp.adm(format($q$select public.aposentar_diaria_individual((select id from public.contract_employee_rates where employee_id = %L and valid_from = date '2026-05-01' and not active limit 1), 'de novo')::text$q$, pg_temp.emp('4')::text)));

-- ---------------------------------------------------------------------------
-- F. Fatura: itens, Σ itens = total, imutabilidade
-- ---------------------------------------------------------------------------

select pg_temp.exec('f1', $q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$);
select pg_temp.registrar('F1. fatura de 01–15/03 gerada pelo caminho normal', 'true', (pg_temp.r('f1') ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.registrar('F2. Σ itens = total da fatura, exatamente', 'true',
  ((select sum(amount) from public.invoice_items where invoice_id = pg_temp.r('f1')::uuid)
    = (select total_amount from public.invoices where id = pg_temp.r('f1')::uuid))::text);
select pg_temp.registrar('F3. o total da fatura = Σ dos valores cobrados dos lançamentos vinculados', 'true',
  ((select total_amount from public.invoices where id = pg_temp.r('f1')::uuid)
    = (select sum(billed_amount) from public.timesheet_entries where invoice_id = pg_temp.r('f1')::uuid))::text);
select pg_temp.registrar('F4. o adicional aparece UMA vez, em item próprio (adicional_diario = Σ additional_amount = 30,00), fora das HE', '30.00|30.00',
  (select coalesce(sum(amount), 0)::text from public.invoice_items where invoice_id = pg_temp.r('f1')::uuid and kind = 'adicional_diario')
  || '|' || (select sum(additional_amount)::text from public.timesheet_entries where invoice_id = pg_temp.r('f1')::uuid));
select pg_temp.registrar('F5. itens de diárias separam a individual (260, 220, 210) da padrão (240, 200, 300, 190), cada uma com seu valor unitário exato',
  'true',
  (select (array['190.00', '200.00', '210.00', '220.00', '240.00', '260.00', '300.00'] @> array_agg(distinct it.unit_price::text))::text
     from public.invoice_items it where it.invoice_id = pg_temp.r('f1')::uuid and it.kind = 'diarias' and it.description not like '%proporcionais%'));
select pg_temp.registrar('F6. a fatura de fevereiro, emitida antes de ligar a resolução, está IDÊNTICA (lançamentos, fatura e itens)', 'true',
  ((select e from _fev) = (select md5(string_agg(to_jsonb(te)::text, ',' order by te.id)) from public.timesheet_entries te where te.work_date < date '2026-03-01')
   and (select it from _fev) = (select md5(string_agg(to_jsonb(it)::text, ',' order by it.id)) from public.invoice_items it where it.invoice_id <> pg_temp.r('f1')::uuid)
   and (select f from _fev) = (select md5(string_agg(to_jsonb(i)::text, ',' order by i.id)) from public.invoices i where i.id <> pg_temp.r('f1')::uuid))::text);
select pg_temp.exec('f7', format($q$select (public.definir_bonus_do_apontamento(%L, 99, 'Depois da fatura', true))::text$q$, pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('F7. depois da fatura o adicional é recusado (55000) e o valor fica 357,50', 'erro 55000|357.50',
  pg_temp.r('f7') || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('F8. depois da fatura nem o dono do banco troca a fonte, o adicional nem o preço do lançamento (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.erro_de(format($q$update public.timesheet_entries set contract_employee_rate_id = null where id = %L$q$, pg_temp.id_de('1', date '2026-03-02')))
  || '|' || pg_temp.erro_de(format($q$update public.timesheet_entries set additional_amount = 1 where id = %L$q$, pg_temp.id_de('1', date '2026-03-02')))
  || '|' || pg_temp.erro_de(format($q$update public.timesheet_entries set daily_rate_snapshot = 1 where id = %L$q$, pg_temp.id_de('1', date '2026-03-02'))));
select pg_temp.registrar('F9. mudar a diária individual DEPOIS não reescreve o faturado: encerrar a vigência de 2026 do E1 em 01/04 não altera o lançamento', '357.50',
  (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')));

-- ---------------------------------------------------------------------------
-- P. Permissões e escrita direta
-- ---------------------------------------------------------------------------

select pg_temp.registrar('P1. operacional: não lê a diária individual, não cadastra, corrige, encerra, aposenta nem define adicional (0 linhas / 42501)',
  '0|erro 42501|erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.ope($q$select count(*)::text from public.contract_employee_rates$q$)
  || '|' || pg_temp.ope(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2040-01-01', 10, 'x')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.ope(format($q$select public.corrigir_diaria_individual(%L, date '2026-01-01', null, 1, 'x')::text$q$, pg_temp.id_ind('1', date '2026-01-01')))
  || '|' || pg_temp.ope(format($q$select public.encerrar_diaria_individual(%L, date '2040-01-01', 'x')::text$q$, pg_temp.id_ind('1', date '2026-01-01')))
  || '|' || pg_temp.ope(format($q$select public.aposentar_diaria_individual(%L, 'x')::text$q$, pg_temp.id_ind('1', date '2026-01-01')))
  || '|' || pg_temp.ope(format($q$select (public.definir_bonus_do_apontamento(%L, 5, 'x'))::text$q$, pg_temp.id_de('3', date '2026-03-31'))));
select pg_temp.registrar('P2. anon: sem leitura nem RPC (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.anon($q$select count(*)::text from public.contract_employee_rates$q$)
  || '|' || pg_temp.anon(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2040-01-01', 10, 'x')::text$q$, pg_temp.emp('6')::text))
  || '|' || pg_temp.anon(format($q$select (public.definir_bonus_do_apontamento(%L, 5, 'x'))::text$q$, pg_temp.id_de('3', date '2026-03-31'))));
select pg_temp.registrar('P3. nem o admin escreve direto na diária individual nem nas colunas de fonte do lançamento (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.adm(format($q$insert into public.contract_employee_rates (contract_id, employee_id, valid_from, daily_rate, origin, reason) values ('5c42d000-0000-4000-8000-0000000000d1', %L, date '2040-01-01', 1, 'informada', 'x')$q$, pg_temp.emp('6')))
  || '|' || pg_temp.adm($q$update public.contract_employee_rates set daily_rate = 1$q$)
  || '|' || pg_temp.adm(format($q$update public.timesheet_entries set price_source = 'funcao_periodo' where id = %L$q$, pg_temp.id_de('3', date '2026-03-31'))));
select pg_temp.registrar('P4. funções internas fechadas; RPCs só para authenticated', 'false|true|false|true|false',
  has_function_privilege('authenticated', 'public.encerrar_diaria_individual_interna(uuid, date, text)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.registrar_diaria_individual(uuid, uuid, date, numeric, text, date, boolean)', 'EXECUTE')::text
  || '|' || has_function_privilege('anon', 'public.definir_bonus_do_apontamento(uuid, numeric, text, boolean)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.definir_bonus_do_apontamento(uuid, numeric, text, boolean)', 'EXECUTE')::text
  || '|' || has_function_privilege('service_role', 'public.registrar_diaria_individual(uuid, uuid, date, numeric, text, date, boolean)', 'EXECUTE')::text);
select pg_temp.registrar('P5. a tabela só se lê (admin) e as RPCs são SECURITY DEFINER com search_path fixo', 'true|false|false|2',
  has_table_privilege('authenticated', 'public.contract_employee_rates', 'SELECT')::text
  || '|' || has_table_privilege('authenticated', 'public.contract_employee_rates', 'INSERT')::text
  || '|' || has_table_privilege('bslog_rpc_operacional', 'public.contract_employee_rates', 'SELECT')::text
  || '|' || (select count(*)::text from pg_policies where tablename = 'contract_employee_rates'));
select pg_temp.registrar('P6. todas as RPCs novas são SECURITY DEFINER com search_path fixo', 'true',
  (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))::text
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('registrar_diaria_individual', 'encerrar_diaria_individual_interna', 'encerrar_diaria_individual',
                        'corrigir_diaria_individual', 'aposentar_diaria_individual', 'diaria_individual_na_data', 'definir_bonus_do_apontamento')));

-- ---------------------------------------------------------------------------
-- Z. Desligar volta ao preço de antes para o que vier depois
-- ---------------------------------------------------------------------------

select pg_temp.exec('z1', $q$select (public.alterar_resolucao_tarifas(false, 'Desligada no teste IND'))::text$q$);
select pg_temp.salvar('z2', 'a1', 'a1', date '2026-03-16', '1', '16:00');
select pg_temp.registrar('Z1. desligada: o lançamento NOVO volta à diária genérica (100 + 18,75 = 118,75, sem fonte) e o já lançado fica', 'true|118.75|60|100.00|generica|0.00|18.75|357.50',
  (pg_temp.r('z1') like '%"ativa": false%')::text || '|' || pg_temp.v('1', date '2026-03-16')
  || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')));
select pg_temp.registrar('Z2. desligada: adicional diário recusado de novo (55000) mesmo em apontamento não faturado com diária individual cadastrada', 'erro 55000',
  pg_temp.adm(format($q$select (public.definir_bonus_do_apontamento(%L, 30, 'Desligada'))::text$q$, pg_temp.id_de('3', date '2026-03-31'))));

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
    raise exception '042_diaria_individual_e_bonus: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
