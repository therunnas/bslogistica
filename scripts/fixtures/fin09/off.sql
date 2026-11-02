-- FIN-PR-09. SOMENTE Supabase local descartável; fixture 100% sintética.
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



select pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1',%L,'2026-01-01',260,'INDIVIDUAL_OFF_TESTE')$q$,pg_temp.emp('1')));
select pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d1',%L,'diurno','2026-01-01',250,'PADRAO_OFF_TESTE')$q$,pg_temp.fn('conferente')));
select pg_temp.adm($q$select public.registrar_feriado('2026-03-09','FERIADO_OFF_TESTE','FERIADO_OFF_TESTE')$q$);
select pg_temp.adm($q$select public.registrar_feriado('2026-03-23','FERIADO_OFF_TESTE','FERIADO_OFF_TESTE')$q$);
do $$
declare d date; e text; saida text; status text;
begin
 if public.resolucao_de_tarifas_ativa() then raise exception 'OFF obrigatório'; end if;
 foreach d in array array[date '2026-03-02',date '2026-03-07',date '2026-03-08',date '2026-03-09',date '2026-03-16',date '2026-03-21',date '2026-03-22',date '2026-03-23'] loop
   for e,saida,status in select * from (values ('1','08:00','present'),('2','15:00','present'),('3','16:15','replacement'),('4',null,'absent'),('5',null,'present')) x(e,s,st) loop
     perform pg_temp.salvar(d::text||'-'||e,'a1','a1',d,e,saida,'06:00',status);
   end loop;
 end loop;
 if exists(select 1 from _exec where r like 'erro %') then raise exception 'Fixture OFF não salvou: %',(select string_agg(k||':'||r,',') from _exec where r like 'erro %'); end if;
end; $$;
select pg_temp.exec('fatura-off', $q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1','2026-03-01','2026-03-15')).id::text$q$);
do $$ begin
 if pg_temp.r('fatura-off') !~ '^[0-9a-f-]{36}$' then raise exception 'Fatura OFF não gerou: %',pg_temp.r('fatura-off'); end if;
end; $$;
-- Motriz autorizada em não faturado: deve usar os mesmos snapshots nos dois schemas.
select pg_temp.adm(format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-22')));
commit;
