-- FIN-PR-10. SOMENTE Supabase local descartável; fixture 100% sintética.
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
create or replace function pg_temp.exec(_k text, _sql text) returns void language plpgsql as $$
declare r text;
begin
 r := pg_temp.adm(_sql);
 if r like 'erro %' then raise exception 'Preparo 044 % falhou: %',_k,r; end if;
 insert into _exec values(_k,r);
end; $$;
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



-- RED integrado: a 043 considera o feriado global; a 044 deve considerar o local real.
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
 if obtido is distinct from esperado then raise exception '%: esperado %, obtido %',caso,esperado,coalesce(obtido,'NULL'); end if;
 raise notice 'PASS: %',caso;
end; $$;
select pg_temp.assert_eq('preparo: motor ligado',public.motor_ativo()::text,'true');
select pg_temp.exec('FERIADO_LEGADO',$q$select public.registrar_feriado('2026-02-03','FERIADO_TESTE_ITAJAI','FIXTURE_SINTETICA_044')::text$q$);
select pg_temp.assert_eq('preparo: registro histórico válido',(pg_temp.r('FERIADO_LEGADO') ~ '^[0-9a-f-]{36}$')::text,'true');
do $$
begin
 if to_regclass('public.municipality_catalog') is not null then
  execute $q$insert into public.municipality_catalog(code,name,state_code,official_url) values
   ('4208203','MUNICIPIO_TESTE_A','SC','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4208203'),
   ('4211306','MUNICIPIO_TESTE_B','SC','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4211306'),
   ('4202008','MUNICIPIO_TESTE_C','SC','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4202008'),
   ('4202909','MUNICIPIO_TESTE_D','SC','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4202909'),
   ('4202107','MUNICIPIO_TESTE_E','SC','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4202107'),
   ('4207106','MUNICIPIO_TESTE_F','SC','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4207106'),
   ('4106902','MUNICIPIO_TESTE_FORA_SC','PR','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4106902')$q$;
  execute $q$insert into public.operation_location_terms(operation_id,municipality_code,valid_from,reason) values
   ('5c42e000-0000-4000-8000-0000000000a1','4208203','2026-01-01','FIXTURE_SINTETICA_044'),
   ('5c42e000-0000-4000-8000-0000000000a3','4211306','2026-01-01','FIXTURE_SINTETICA_044')$q$;
  execute $q$insert into public.financial_calendar_coverage(calendar_year,territory_scope,state_code,municipality_code,legal_act,official_url,client_confirmed,reason) values
   (2026,'nacional',null,null,'ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_SINTETICA_044'),
   (2026,'estadual','SC',null,'ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_SINTETICA_044'),
   (2026,'estadual','PR',null,'ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_SINTETICA_044')$q$;
  execute $q$insert into public.financial_calendar_coverage(calendar_year,territory_scope,state_code,municipality_code,legal_act,official_url,client_confirmed,reason)
   select 2026,'municipal',state_code,code,'ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_SINTETICA_044' from public.municipality_catalog$q$;
  execute $q$insert into public.financial_holidays(holiday_date,name,reason,territory_scope,state_code,municipality_code,legal_act,official_url,verification_status,client_confirmed)
   values('2026-02-03','FERIADO_TESTE_ITAJAI','FIXTURE_SINTETICA_044','municipal','SC','4208203','ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true)$q$;
 end if;
end; $$;
create function pg_temp.classificar(d date,op uuid) returns text language plpgsql as $$
declare r text;
begin
 if to_regprocedure('public.motor_tipo_do_dia(date,uuid)') is null then
  return public.motor_tipo_do_dia(d);
 end if;
 execute 'select public.motor_tipo_do_dia($1,$2)' into r using d,op;
 return r;
end; $$;
select pg_temp.assert_eq('RED feriado municipal de Itajaí não pode contaminar Navegantes',
 pg_temp.classificar('2026-02-03','5c42e000-0000-4000-8000-0000000000a3'),'util');

-- Todos os eventos abaixo são sintéticos. Nenhuma data constitui cadastro jurídico real.
create function pg_temp.assert_ok(caso text,r text) returns void language plpgsql as $$
begin
 if r is null or r like 'erro %' then raise exception '%: preparo/chamada falhou: %',caso,r; end if;
 raise notice 'PASS: %',caso;
end; $$;
create function pg_temp.save(k text,d date,emp text,ent text,sai text,pausa integer default 0,
 op text default 'a1',turno text default 'a1',fn text default '',status text default 'present')
returns text language plpgsql as $$
declare r text;
begin
 r := pg_temp.adm(format($q$select public.salvar_apontamento_admin('5c42e000-0000-4000-8000-0000000000%s',
  '5c42a000-0000-4000-8000-0000000000%s',%L,
  jsonb_build_array(jsonb_build_object('employee_id',%L,'status',%L,'check_in',%L,'check_out',%L,'break_minutes',%s)
  || case when %L='' then '{}'::jsonb else jsonb_build_object('job_function_id',%L) end))::text$q$,
  op,turno,d,pg_temp.emp(emp),status,ent,sai,pausa,fn,fn));
 insert into _exec values(k,r);
 return r;
end; $$;
create function pg_temp.money(e uuid) returns text language sql as $$
 select concat_ws('|',billed_amount,cost_amount,billed_base_amount,billed_overtime_amount,
  billed_special_amount,additional_amount,worked_minutes,day_kind_snapshot,calc_version)
 from public.timesheet_entries where id=e
$$;

-- Sete localidades: seis municípios de SC, um de PR; a operação a2 fica sem local propositalmente.
insert into public.operations(id,client_id,contract_id,name)
 select ('5c42e000-0000-4000-8000-0000000000a'||x.n)::uuid,
  '5c42c000-0000-4000-8000-0000000000c1','5c42d000-0000-4000-8000-0000000000d1',
  'OPERACAO_SINTETICA_'||x.n
 from (values('4'),('5'),('6'),('7'),('8')) x(n);
insert into public.operation_location_terms(operation_id,municipality_code,valid_from,reason)
 select ('5c42e000-0000-4000-8000-0000000000a'||x.n)::uuid,x.m,'2026-01-01','FIXTURE_SINTETICA_044'
 from (values('4','4202008'),('5','4202909'),('6','4202107'),('7','4207106'),('8','4106902')) x(n,m);
insert into public.financial_calendar_coverage(calendar_year,territory_scope,state_code,municipality_code,
 legal_act,official_url,client_confirmed,reason)
 select 2027,territory_scope,state_code,municipality_code,'ATO_SINTETICO','https://exemplo.gov.br/calendario',
 true,'FIXTURE_SINTETICA_044' from public.financial_calendar_coverage where calendar_year=2026;
insert into public.financial_holidays(holiday_date,name,reason,territory_scope,state_code,municipality_code,
 legal_act,official_url,verification_status,client_confirmed,holiday_kind,is_movable)
 values
 ('2026-02-04','NACIONAL_SINTETICO','FIXTURE_SINTETICA_044','nacional',null,null,'ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false),
 ('2026-02-05','ESTADUAL_SC_SINTETICO','FIXTURE_SINTETICA_044','estadual','SC',null,'ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false),
 ('2026-02-06','SOBREPOSICAO_NACIONAL_SINTETICA','FIXTURE_SINTETICA_044','nacional',null,null,'ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false),
 ('2026-02-06','SOBREPOSICAO_SC_SINTETICA','FIXTURE_SINTETICA_044','estadual','SC',null,'ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false),
 ('2026-02-06','SOBREPOSICAO_MUNICIPAL_SINTETICA','FIXTURE_SINTETICA_044','municipal','SC','4208203','ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false),
 ('2026-02-08','DOMINGO_FERIADO_SINTETICO','FIXTURE_SINTETICA_044','nacional',null,null,'ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false),
 ('2026-02-10','FACULTATIVO_SINTETICO','FIXTURE_SINTETICA_044','municipal','SC','4208203','ATO_SINTETICO','https://exemplo.gov.br/calendario','pendente',false,'ponto_facultativo',false),
 ('2026-02-11','MOVEL_CONFIRMADO_SINTETICO','FIXTURE_SINTETICA_044','nacional',null,null,'ATO_ANUAL_SINTETICO_2026','https://exemplo.gov.br/calendario','confirmado',true,'feriado',true),
 ('2026-02-12','VIRADA_MISTA_SINTETICA','FIXTURE_SINTETICA_044','nacional',null,null,'ATO_SINTETICO','https://exemplo.gov.br/calendario','confirmado',true,'feriado',false);

-- Territorialidade e ausência de informação: nenhuma falha pode virar dia útil presumido.
select pg_temp.assert_eq('01 municipal Itajaí aplica somente em Itajaí',pg_temp.classificar('2026-02-03','5c42e000-0000-4000-8000-0000000000a1'),'feriado');
select pg_temp.assert_eq('02 nacional alcança SC',pg_temp.classificar('2026-02-04','5c42e000-0000-4000-8000-0000000000a1'),'feriado');
select pg_temp.assert_eq('03 nacional alcança PR',pg_temp.classificar('2026-02-04','5c42e000-0000-4000-8000-0000000000a8'),'feriado');
select pg_temp.assert_eq('04 feriado SC não alcança PR',pg_temp.classificar('2026-02-05','5c42e000-0000-4000-8000-0000000000a8'),'util');
do $$
declare r record;
begin
 for r in select * from (values('a1'),('a3'),('a4'),('a5'),('a6'),('a7')) x(op) loop
  perform pg_temp.assert_eq('05 estadual alcança cada um dos seis municípios SC: '||r.op,
   pg_temp.classificar('2026-02-05',('5c42e000-0000-4000-8000-0000000000'||r.op)::uuid),'feriado');
 end loop;
end; $$;
select pg_temp.assert_eq('06 sem local não presume útil',pg_temp.erro_de($q$select public.motor_tipo_do_dia('2026-02-04','5c42e000-0000-4000-8000-0000000000a2')$q$),'erro 55000');
select pg_temp.assert_eq('07 consulta sem local informa status e tipo nulo',
 pg_temp.adm($q$select (r->>'status')||'|'||((r->>'day_kind') is null)::text from (select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a2','2026-02-04') r) x$q$),
 'localidade_ausente|true');
select pg_temp.assert_eq('08 sem cobertura anual não presume útil',pg_temp.erro_de($q$select public.motor_tipo_do_dia('2028-02-04','5c42e000-0000-4000-8000-0000000000a1')$q$),'erro 55000');
select pg_temp.assert_eq('09 consulta sem cobertura informa pendência e tipo nulo',
 pg_temp.adm($q$select (r->>'status')||'|'||((r->>'day_kind') is null)::text from (select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a1','2028-02-04') r) x$q$),
 'pendente|true');
-- A pendência relevante impede certificar o ano inteiro; isole o cenário antes de continuar.
insert into public.financial_holidays(holiday_date,name,reason,territory_scope,state_code,municipality_code,
 legal_act,official_url,verification_status,client_confirmed,holiday_kind,is_movable)
 values('2026-02-09','PENDENTE_SINTETICO','FIXTURE_SINTETICA_044','municipal','SC','4208203',
 'ATO_SINTETICO','https://exemplo.gov.br/calendario','pendente',false,'feriado',false);
select pg_temp.assert_eq('10 feriado pendente não presume útil',pg_temp.erro_de($q$select public.motor_tipo_do_dia('2026-02-09','5c42e000-0000-4000-8000-0000000000a1')$q$),'erro 55000');
select pg_temp.assert_eq('11 pendência municipal de Itajaí não contamina Navegantes',pg_temp.classificar('2026-02-09','5c42e000-0000-4000-8000-0000000000a3'),'util');
select pg_temp.assert_eq('11b pendência anual bloqueia também outra data do mesmo território',
 pg_temp.erro_de($q$select public.motor_tipo_do_dia('2026-02-03','5c42e000-0000-4000-8000-0000000000a1')$q$),'erro 55000');
select pg_temp.exec('aposentar-pendencia-classificador',$q$select public.aposentar_feriado(
 (select id from public.financial_holidays where name='PENDENTE_SINTETICO' and active),
 'FIM_CENARIO_PENDENCIA_SINTETICA_044')$q$);
select pg_temp.assert_eq('12 ponto facultativo não se transforma em feriado',pg_temp.classificar('2026-02-10','5c42e000-0000-4000-8000-0000000000a1'),'util');
select pg_temp.assert_eq('13 móvel explicitamente confirmado no ano',pg_temp.classificar('2026-02-11','5c42e000-0000-4000-8000-0000000000a1'),'feriado');
select pg_temp.assert_eq('14 móvel não se replica automaticamente no próximo ano',pg_temp.classificar('2027-02-11','5c42e000-0000-4000-8000-0000000000a1'),'util');
select pg_temp.assert_eq('15 domingo sem feriado permanece domingo',pg_temp.classificar('2026-02-15','5c42e000-0000-4000-8000-0000000000a1'),'domingo');
select pg_temp.assert_eq('16 sábado sem feriado permanece sábado',pg_temp.classificar('2026-02-07','5c42e000-0000-4000-8000-0000000000a1'),'sabado');

-- Segmentação civil: minutos literais independentes da implementação.
select pg_temp.assert_eq('17 jornada comum 540 brutos - 60 intervalo = 480',
 (select (s->>'status')||'|'||(s->>'worked_minutes')||'|'||(s#>>'{segments,0,date}')||'|'||(s#>>'{segments,0,gross_minutes}')||'|'||(s#>>'{segments,0,worked_minutes}')
  from (select public.segmentar_jornada_civil('2026-02-16','06:00','15:00',60) s) x),
 'confirmado|480|2026-02-16|540|480');
select pg_temp.assert_eq('18 virada sem intervalo: 30 minutos + 90 minutos',
 (select (s->>'status')||'|'||(s->>'worked_minutes')||'|'||(s#>>'{segments,0,date}')||'|'||(s#>>'{segments,0,gross_minutes}')||'|'||(s#>>'{segments,0,worked_minutes}')||'|'||(s#>>'{segments,1,date}')||'|'||(s#>>'{segments,1,worked_minutes}')
  from (select public.segmentar_jornada_civil('2026-02-16','23:30','01:30',0) s) x),
 'confirmado|120|2026-02-16|30|30|2026-02-17|90');
select pg_temp.assert_eq('19 intervalo conhecido 23:45–00:45 distribui 15 + 45 efetivos',
 (select (s->>'status')||'|'||(s->>'worked_minutes')||'|'||(s#>>'{segments,0,worked_minutes}')||'|'||(s#>>'{segments,1,worked_minutes}')
  from (select public.segmentar_jornada_civil('2026-02-16','23:30','01:30',60,'23:45','00:45') s) x),
 'confirmado|60|15|45');
select pg_temp.assert_eq('20 intervalo sem horário mantém total exato sem rateio inventado',
 (select (s->>'status')||'|'||(s->>'worked_minutes')||'|'||((s#>>'{segments,0,worked_minutes}') is null)::text||'|'||((s#>>'{segments,1,worked_minutes}') is null)::text
  from (select public.segmentar_jornada_civil('2026-02-16','23:30','01:30',60) s) x),
 'intervalo_sem_horario|60|true|true');
select pg_temp.assert_eq('21 duração do intervalo deve conferir',pg_temp.erro_de($q$select public.segmentar_jornada_civil('2026-02-16','23:30','01:30',60,'23:45','00:30')$q$),'erro 22023');
select pg_temp.assert_eq('22 intervalo fora da jornada recusado',pg_temp.erro_de($q$select public.segmentar_jornada_civil('2026-02-16','23:30','01:30',60,'22:00','23:00')$q$),'erro 22023');
select pg_temp.assert_eq('23 intervalo com um único limite recusado',pg_temp.erro_de($q$select public.segmentar_jornada_civil('2026-02-16','23:30','01:30',60,'23:45',null)$q$),'erro 22023');
select pg_temp.assert_eq('24 jornada incompleta explicitamente sinalizada',public.segmentar_jornada_civil('2026-02-16','06:00',null,0)->>'status','incompleta');

-- A segmentação deve usar a mesma precisão de minuto do núcleo financeiro 035.
select pg_temp.assert_eq('24b segmentos e núcleo035 concordam quando o TIME contém segundos',
 (public.segmentar_jornada_civil('2026-02-16','06:00:59','07:00:01',0)->>'worked_minutes'),
 public.nucleo_minutos_trabalhados('06:00:59','07:00:01',0)::text);

-- Primeiro, resolução OFF: o cadastro territorial não muda o contrato financeiro legado.
select pg_temp.assert_eq('25 resolução começa desligada',public.resolucao_de_tarifas_ativa()::text,'false');
select pg_temp.assert_ok('26 OFF nacional territorial não altera nova linha',pg_temp.save('off-national','2026-02-04','2','06:00','15:00',60));
select pg_temp.assert_eq('27 OFF mantém diária genérica100, custo80 e não congela calendário territorial',
 (select (billed_amount=100 and cost_amount=80 and calc_version=2 and day_kind_snapshot='util'
  and billed_special_amount=0 and territorial_calendar_snapshot is null)::text
  from public.timesheet_entries where id=pg_temp.id_de('2','2026-02-04')),'true');
create temporary table _off_anterior as select id,to_jsonb(t) j from public.timesheet_entries t where id=pg_temp.id_de('2','2026-02-04');
select pg_temp.exec('individual-044',format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1',%L,'2026-01-01',260,'FIXTURE_SINTETICA_044')$q$,pg_temp.emp('1')));
select pg_temp.exec('tarifa-044',format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d1',%L,'diurno','2026-01-01',250,'FIXTURE_SINTETICA_044')$q$,pg_temp.fn('conferente')));
select pg_temp.exec('tarifa-k2-044',format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d2',%L,'diurno','2026-01-01',300,'FIXTURE_SINTETICA_044')$q$,pg_temp.fn('conferente')));
select pg_temp.exec('on-044',$q$select public.alterar_resolucao_tarifas(true,'FIXTURE_SINTETICA_044')$q$);
select pg_temp.assert_eq('28 resolução efetivamente ligada',public.resolucao_de_tarifas_ativa()::text,'true');
select pg_temp.assert_ok('29 municipal: 60 minutos especiais',pg_temp.save('on-municipal','2026-02-03','1','06:00','07:00'));
select pg_temp.assert_eq('30 municipal mantém FIN09:260/8×2×1h e custo80/8×2×1h',pg_temp.money(pg_temp.id_de('1','2026-02-03')),
 '65.00|20.00|0.00|0.00|65.00|0.00|60|feriado|2');
-- O contexto da folha também é lastro: a linha não pode continuar em Itajaí/03-02
-- enquanto o cabeçalho é movido para outra data, operação ou turno.
create temporary table _folha_contexto_044 as
 select t.id,to_jsonb(t) folha,
  (select jsonb_agg(to_jsonb(e) order by e.id) from public.timesheet_entries e where e.timesheet_id=t.id) entradas
 from public.timesheets t where t.id=(select timesheet_id from public.timesheet_entries where id=pg_temp.id_de('1','2026-02-03'));
select pg_temp.assert_eq('30a folha com lastro territorial não muda a data',
 pg_temp.adm(format($q$update public.timesheets set work_date='2026-02-10'
  where id=(select timesheet_id from public.timesheet_entries where id=%L)$q$,pg_temp.id_de('1','2026-02-03'))),'erro 55000');
select pg_temp.assert_eq('30a rejeição preserva cabeçalho, linhas e snapshots',
 (select (to_jsonb(t)=f.folha and f.entradas=(select jsonb_agg(to_jsonb(e) order by e.id)
   from public.timesheet_entries e where e.timesheet_id=t.id))::text
  from _folha_contexto_044 f join public.timesheets t using(id)),'true');
select pg_temp.assert_eq('30b folha com lastro territorial não muda a operação',
 pg_temp.adm(format($q$update public.timesheets set operation_id='5c42e000-0000-4000-8000-0000000000a3'
  where id=(select timesheet_id from public.timesheet_entries where id=%L)$q$,pg_temp.id_de('1','2026-02-03'))),'erro 42501');
select pg_temp.assert_eq('30b rejeição preserva cabeçalho, linhas e snapshots',
 (select (to_jsonb(t)=f.folha and f.entradas=(select jsonb_agg(to_jsonb(e) order by e.id)
   from public.timesheet_entries e where e.timesheet_id=t.id))::text
  from _folha_contexto_044 f join public.timesheets t using(id)),'true');
select pg_temp.assert_eq('30c folha com lastro territorial não muda o turno',
 pg_temp.adm(format($q$update public.timesheets set shift_id='5c42a000-0000-4000-8000-0000000000a2'
  where id=(select timesheet_id from public.timesheet_entries where id=%L)$q$,pg_temp.id_de('1','2026-02-03'))),'erro 42501');
select pg_temp.assert_eq('30c rejeição preserva cabeçalho, linhas e snapshots',
 (select (to_jsonb(t)=f.folha and f.entradas=(select jsonb_agg(to_jsonb(e) order by e.id)
   from public.timesheet_entries e where e.timesheet_id=t.id))::text
  from _folha_contexto_044 f join public.timesheets t using(id)),'true');
select pg_temp.assert_ok('31 nacional: 60 minutos especiais',pg_temp.save('on-national','2026-02-04','1','06:00','07:00'));
select pg_temp.assert_eq('32 nacional usa o mesmo núcleo financeiro',pg_temp.money(pg_temp.id_de('1','2026-02-04')),
 '65.00|20.00|0.00|0.00|65.00|0.00|60|feriado|2');
select pg_temp.assert_ok('33 sobreposição tripla salva uma única cobrança',pg_temp.save('on-overlap','2026-02-06','1','06:00','07:00'));
select pg_temp.assert_eq('34 nacional+estadual+municipal aplica fator2 uma vez',pg_temp.money(pg_temp.id_de('1','2026-02-06')),
 '65.00|20.00|0.00|0.00|65.00|0.00|60|feriado|2');
select pg_temp.assert_eq('35 lastro registra três feriados da sobreposição',
 (select jsonb_array_length(territorial_calendar_snapshot#>'{days,0,holiday_ids}')::text from public.timesheet_entries where id=pg_temp.id_de('1','2026-02-06')),'3');
select pg_temp.assert_ok('36 domingo com feriado salva',pg_temp.save('on-sunday','2026-02-08','1','06:00','07:00'));
select pg_temp.assert_eq('37 domingo+feriado aplica fator2 uma vez',pg_temp.money(pg_temp.id_de('1','2026-02-08')),
 '65.00|20.00|0.00|0.00|65.00|0.00|60|feriado|2');
select pg_temp.assert_eq('38 ON sem local bloqueia nova presença',pg_temp.save('on-no-location','2026-02-04','1','06:00','07:00',0,'a2','a4'),'erro 55000');
select pg_temp.assert_eq('39 ON sem cobertura bloqueia nova presença',pg_temp.save('on-no-coverage','2028-02-04','1','06:00','07:00'),'erro 55000');
insert into public.financial_holidays(holiday_date,name,reason,territory_scope,state_code,municipality_code,
 legal_act,official_url,verification_status,client_confirmed,holiday_kind,is_movable)
 values('2026-02-09','PENDENTE_INTEGRACAO_SINTETICO','FIXTURE_SINTETICA_044','municipal','SC','4208203',
 'ATO_SINTETICO','https://exemplo.gov.br/calendario','pendente',false,'feriado',false);
select pg_temp.assert_eq('40 ON com feriado pendente bloqueia nova presença',pg_temp.save('on-pending','2026-02-09','1','06:00','07:00'),'erro 55000');
select pg_temp.assert_eq('41 tentativas bloqueadas não gravam apontamento',
 (select count(*)::text from public.timesheet_entries where (operation_id='5c42e000-0000-4000-8000-0000000000a2' and employee_id=pg_temp.emp('1') and work_date='2026-02-04')
  or (operation_id='5c42e000-0000-4000-8000-0000000000a1' and employee_id=pg_temp.emp('1') and work_date in('2028-02-04','2026-02-09'))),'0');
select pg_temp.exec('aposentar-pendencia-integracao',$q$select public.aposentar_feriado(
 (select id from public.financial_holidays where name='PENDENTE_INTEGRACAO_SINTETICO' and active),
 'FIM_CENARIO_PENDENCIA_SINTETICA_044')$q$);
select pg_temp.assert_eq('42 virada feriado/útil exige decisão comercial',pg_temp.save('mixed-holiday','2026-02-12','1','23:30','01:30',0),'erro 55000');
select pg_temp.assert_eq('43 virada útil/sábado exige decisão comercial',pg_temp.save('mixed-weekend','2026-02-13','1','23:30','01:30',0),'erro 55000');
select pg_temp.assert_eq('44 virada mista com intervalo não alocado continua bloqueada',pg_temp.save('mixed-break','2026-02-12','1','23:30','01:30',60),'erro 55000');
select pg_temp.assert_ok('45 virada útil/útil sem rateio do intervalo preserva regraFIN09',pg_temp.save('same-kind','2026-02-16','1','23:30','01:30',60));
select pg_temp.assert_eq('46 snapshot guarda datas civis reais, total60 e intervalo desconhecido',
 (select (territorial_calendar_snapshot#>>'{segments,status}')||'|'||(territorial_calendar_snapshot#>>'{segments,worked_minutes}')||'|'
   ||(territorial_calendar_snapshot#>>'{days,0,date}')||'|'||(territorial_calendar_snapshot#>>'{days,1,date}')||'|'
   ||(territorial_calendar_snapshot#>>'{days,0,day_kind}')||'|'||(territorial_calendar_snapshot#>>'{days,1,day_kind}')
  from public.timesheet_entries where id=pg_temp.id_de('1','2026-02-16')),
 'intervalo_sem_horario|60|2026-02-16|2026-02-17|util|util');
select pg_temp.assert_eq('47 snapshot inclui versão, local, município, UF e três coberturas',
 (select ((territorial_calendar_snapshot->>'version')::int=1
  and territorial_calendar_snapshot#>>'{location,municipality_code}'='4208203'
  and territorial_calendar_snapshot#>>'{location,state_code}'='SC'
  and (territorial_calendar_snapshot#>>'{location,location_term_id}') is not null
  and jsonb_array_length(territorial_calendar_snapshot#>'{days,0,coverage_ids}')=3)::text
 from public.timesheet_entries where id=pg_temp.id_de('1','2026-02-03')),'true');
select pg_temp.assert_eq('48 ON não migra linha OFF anterior',
 (select (to_jsonb(t)=o.j)::text from _off_anterior o join public.timesheet_entries t using(id)),'true');

-- Expansão a outro estado por RPC, sem hardcode de municípios de SC no resolvedor.
select pg_temp.exec('catalogar-pr',$q$select public.catalogar_municipio('4104808','MUNICIPIO_NOVO_TESTE_PR','PR',
 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4104808','FIXTURE_SINTETICA_044')$q$);
insert into public.operations(id,client_id,contract_id,name) values
 ('5c42e000-0000-4000-8000-0000000000a9','5c42c000-0000-4000-8000-0000000000c1','5c42d000-0000-4000-8000-0000000000d1','OPERACAO_NOVA_SINTETICA_PR');
select pg_temp.exec('local-pr',$q$select public.registrar_local_operacao(
 p_operation_id=>'5c42e000-0000-4000-8000-0000000000a9',p_municipality_code=>'4104808',p_valid_from=>'2026-01-01',p_reason=>'FIXTURE_SINTETICA_044')$q$);
select pg_temp.exec('cobertura-pr',$q$select public.confirmar_cobertura_calendario(
 '{"calendar_year":2026,"territory_scope":"municipal","state_code":"PR","municipality_code":"4104808","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/calendario","client_confirmed":true}',
 'FIXTURE_SINTETICA_044')$q$);
select pg_temp.exec('feriado-pr',$q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-03-10","name":"MUNICIPAL_PR_SINTETICO","territory_scope":"municipal","state_code":"PR","municipality_code":"4104808","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/calendario","client_confirmed":true,"verification_status":"confirmado","holiday_kind":"feriado","is_movable":false}',
 'FIXTURE_SINTETICA_044')$q$);
select pg_temp.assert_eq('49 local novo fora de SC aceita nacional',pg_temp.classificar('2026-02-04','5c42e000-0000-4000-8000-0000000000a9'),'feriado');
select pg_temp.assert_eq('50 local novo de PR não herda estadualSC',pg_temp.classificar('2026-02-05','5c42e000-0000-4000-8000-0000000000a9'),'util');
select pg_temp.assert_eq('51 local novo de PR recebe seu próprio municipal',pg_temp.classificar('2026-03-10','5c42e000-0000-4000-8000-0000000000a9'),'feriado');
select pg_temp.assert_eq('52 municipalPR não contamina Itajaí',pg_temp.classificar('2026-03-10','5c42e000-0000-4000-8000-0000000000a1'),'util');
select pg_temp.assert_eq('53 consulta RPC retorna o local real e lastro completo',
 pg_temp.adm($q$select (r->>'status')||'|'||(r->>'municipality_code')||'|'||(r->>'state_code')||'|'||(r->>'day_kind')||'|'||jsonb_array_length(r->'coverage_ids')
  from (select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a9','2026-03-10') r) x$q$),
 'confirmado|4104808|PR|feriado|3');

-- Metadata inválido não produz cadastro nem auditoria de sucesso.
create temporary table _audit_invalid_before as select count(*) n from public.financial_terms_audit;
select pg_temp.assert_eq('54 município e UF incompatíveis recusados',pg_temp.adm($q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-03-11","name":"INVALIDO_SINTETICO","territory_scope":"municipal","state_code":"SC","municipality_code":"4104808","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/calendario","client_confirmed":true,"verification_status":"confirmado","holiday_kind":"feriado","is_movable":false}',
 'FIXTURE_SINTETICA_044')$q$),'erro 22023');
select pg_temp.assert_eq('55 confirmação sem fonte oficial recusada',pg_temp.adm($q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-03-11","name":"INVALIDO_SINTETICO","territory_scope":"nacional","legal_act":"ATO_SINTETICO","official_url":"https://example.com/calendario","client_confirmed":true,"verification_status":"confirmado","holiday_kind":"feriado","is_movable":true}',
 'FIXTURE_SINTETICA_044')$q$),'erro 22023');
select pg_temp.assert_eq('56 cobertura municipal sem confirmação do cliente recusada',pg_temp.adm($q$select public.confirmar_cobertura_calendario(
 '{"calendar_year":2032,"territory_scope":"municipal","state_code":"SC","municipality_code":"4211306","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/calendario","client_confirmed":false}',
 'FIXTURE_SINTETICA_044')$q$),'erro 22023');
select pg_temp.assert_eq('57 falhas de validação não geram auditoria de sucesso',
 (select ((select count(*) from public.financial_terms_audit)=n)::text from _audit_invalid_before),'true');

-- Cada sonda roda a chamada verdadeira e reverte somente seus próprios efeitos após sucesso.
-- Falhas continuam com o SQLSTATE original; a matriz não troca exceção por PASS.
create function pg_temp.sondar(_sql text) returns text language plpgsql as $$
begin
 begin
  execute _sql;
  raise exception 'SONDA_SUCESSO' using errcode='ZX001';
 exception
  when sqlstate 'ZX001' then return 'ok';
  when others then return 'erro '||sqlstate;
 end;
end; $$;
insert into auth.users(id) values ('5c420000-0000-4000-8000-0000000000a3'),('5c420000-0000-4000-8000-0000000000a4');
insert into auth.sessions(id,user_id,not_after) values
 ('ec420000-0000-4000-8000-0000000000a3','5c420000-0000-4000-8000-0000000000a3',null),
 ('ec420000-0000-4000-8000-0000000000a4','5c420000-0000-4000-8000-0000000000a4',null);
insert into public.user_roles(user_id,role) values ('5c420000-0000-4000-8000-0000000000a4','admin');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,friendly_name,created_at,updated_at) values
 ('5c420000-0000-4000-8000-0000000000f4','5c420000-0000-4000-8000-0000000000a4','totp','verified','SINTETICO_NAO_UTILIZAVEL','MFA_TESTE_044',now(),now());
insert into public.financial_calendar_coverage(calendar_year,territory_scope,legal_act,official_url,client_confirmed,reason)
 values(2090,'nacional','ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_SINTETICA_SEGURANCA_044');
-- Alvo exclusivo da sonda, ativo e em outro ano: não interfere no calendário de 2026.
insert into public.financial_holidays(holiday_date,name,reason,territory_scope,legal_act,official_url,
 verification_status,client_confirmed)
 values('2091-02-02','SONDA_APOSENTAR_SINTETICO','FIXTURE_SINTETICA_SEGURANCA_044','nacional',
 'ATO_SINTETICO','https://exemplo.gov.br/calendario','pendente',false);
create temporary table _rpc_044(nome text,sql text);
insert into _rpc_044 values
 ('catalogar_municipio',$q$select public.catalogar_municipio('4305108','MUNICIPIO_SONDA_RS','RS','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4305108','SONDA_SINTETICA_044')$q$),
 ('registrar_feriado_territorial',$q$select public.registrar_feriado_territorial('{"holiday_date":"2091-02-01","name":"SONDA_FERIADO_SINTETICO","territory_scope":"nacional","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/calendario","client_confirmed":true,"verification_status":"confirmado","holiday_kind":"feriado","is_movable":false}','SONDA_SINTETICA_044')$q$),
 ('confirmar_cobertura_calendario',$q$select public.confirmar_cobertura_calendario('{"calendar_year":2091,"territory_scope":"nacional","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/calendario","client_confirmed":true}','SONDA_SINTETICA_044')$q$),
 ('aposentar_cobertura_calendario',$q$select public.aposentar_cobertura_calendario((select id from public.financial_calendar_coverage where calendar_year=2090 and territory_scope='nacional'),'SONDA_SINTETICA_044')$q$),
 ('registrar_local_operacao',$q$select public.registrar_local_operacao(p_operation_id=>'5c42e000-0000-4000-8000-0000000000a2',p_municipality_code=>'4208203',p_valid_from=>'2032-01-01',p_reason=>'SONDA_SINTETICA_044')$q$),
 ('consultar_calendario_operacao',$q$select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a1','2026-02-04')$q$),
 ('aposentar_feriado',$q$select public.aposentar_feriado((select id from public.financial_holidays where name='SONDA_APOSENTAR_SINTETICO' and active),'SONDA_SINTETICA_044')$q$);
do $$
declare ident record; rpc record; claims jsonb; obtido text; esperado text; auditorias bigint;
begin
 for ident in select * from (values
  ('admin sem fator','authenticated','a1','aal1',true,true),
  ('admin com fator AAL1','authenticated','a4','aal1',true,false),
  ('admin com fator AAL2','authenticated','a4','aal2',true,true),
  ('operacional','authenticated','a2','aal1',true,false),
  ('anon','anon','a1','aal1',false,false),
  ('sem papel','authenticated','a3','aal1',true,false),
  ('sessão inválida','authenticated','a1','aal2',false,false)
 ) x(nome,papel,usr,aal,sessao_valida,permitido) loop
  claims := jsonb_build_object('sub','5c420000-0000-4000-8000-0000000000'||ident.usr,'role',ident.papel,'aal',ident.aal);
  if ident.sessao_valida then
   claims := claims||jsonb_build_object('session_id','ec420000-0000-4000-8000-0000000000'||ident.usr);
  end if;
  esperado := case when ident.permitido then 'ok' else 'erro 42501' end;
  for rpc in select * from _rpc_044 order by nome loop
   select count(*) into auditorias from public.financial_terms_audit;
   obtido := pg_temp.medir_como(ident.papel,claims,format('select pg_temp.sondar(%L)',rpc.sql));
   perform pg_temp.assert_eq('58 RPC '||rpc.nome||' / '||ident.nome,obtido,esperado);
   perform pg_temp.assert_eq('59 nenhum efeito/auditoria residual da sonda '||rpc.nome||' / '||ident.nome,
    ((select count(*) from public.financial_terms_audit)=auditorias)::text,'true');
  end loop;
 end loop;
end; $$;
select pg_temp.assert_eq('60 operacional não lê catálogo diretamente',pg_temp.ope('select count(*)::text from public.municipality_catalog'),'0');
select pg_temp.assert_eq('61 operacional não lê locais diretamente',pg_temp.ope('select count(*)::text from public.operation_location_terms'),'0');
select pg_temp.assert_eq('62 operacional não lê cobertura diretamente',pg_temp.ope('select count(*)::text from public.financial_calendar_coverage'),'0');
select pg_temp.assert_eq('63 escrita direta no catálogo negada mesmo ao admin',pg_temp.adm($q$insert into public.municipality_catalog(code,name,state_code,official_url) values('4305108','INVALIDO_SINTETICO','RS','https://exemplo.gov.br/calendario')$q$),'erro 42501');
select pg_temp.assert_eq('64 escrita direta de local negada mesmo ao admin',pg_temp.adm($q$update public.operation_location_terms set reason='INVALIDO_SINTETICO' where operation_id='5c42e000-0000-4000-8000-0000000000a1'$q$),'erro 42501');
select pg_temp.assert_eq('65 escrita direta de cobertura negada mesmo ao admin',pg_temp.adm($q$update public.financial_calendar_coverage set reason='INVALIDO_SINTETICO' where calendar_year=2090$q$),'erro 42501');

-- Alterações futuras de local/calendário não reescrevem o lastro de linhas já emitidas.
create temporary table _calendar_frozen as
 select id,territorial_calendar_snapshot calendar,billed_amount,cost_amount from public.timesheet_entries
 where id in(pg_temp.id_de('1','2026-02-03'),pg_temp.id_de('1','2026-02-04'),pg_temp.id_de('1','2026-02-06'),pg_temp.id_de('1','2026-02-08'));
select pg_temp.exec('novo-local',$q$select public.registrar_local_operacao(
 p_operation_id=>'5c42e000-0000-4000-8000-0000000000a1',p_municipality_code=>'4211306',p_valid_from=>'2026-05-01',
 p_reason=>'LOCAL_FUTURO_SINTETICO_044',p_encerrar_anterior=>true)$q$);
select pg_temp.assert_eq('66 vigência antiga mantém município anterior',pg_temp.adm($q$select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a1','2026-02-04')->>'municipality_code'$q$),'4208203');
select pg_temp.assert_eq('67 nova vigência usa o novo município',pg_temp.adm($q$select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a1','2026-05-04')->>'municipality_code'$q$),'4211306');
select pg_temp.assert_ok('68 nova presença usa nova localidade',pg_temp.save('new-location','2026-05-04','1','06:00','15:00',60));
select pg_temp.assert_eq('69 novo snapshot guarda Navegantes',
 (select territorial_calendar_snapshot#>>'{location,municipality_code}' from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04')),'4211306');
select pg_temp.exec('aposentar-municipal',$q$select public.aposentar_feriado((select id from public.financial_holidays where name='FERIADO_TESTE_ITAJAI' and territory_scope='municipal'),'CALENDARIO_FUTURO_SINTETICO_044')$q$);
select pg_temp.assert_eq('70 calendário atual muda mas snapshot anterior não',
 (select bool_and(t.territorial_calendar_snapshot=f.calendar and t.billed_amount=f.billed_amount and t.cost_amount=f.cost_amount)::text
  from _calendar_frozen f join public.timesheet_entries t using(id)),'true');
select pg_temp.assert_eq('71 notas não alteram lastro territorial',pg_temp.adm(format($q$update public.timesheet_entries set notes='NOTA_SINTETICA_044' where id=%L$q$,pg_temp.id_de('1','2026-02-03'))),'nulo');
select pg_temp.assert_eq('72 edição não motriz preserva snapshot completo',
 (select (t.territorial_calendar_snapshot=f.calendar)::text from _calendar_frozen f join public.timesheet_entries t using(id) where t.id=pg_temp.id_de('1','2026-02-03')),'true');
select pg_temp.assert_eq('73 admin não pode forjar snapshot territorial',pg_temp.adm(format($q$update public.timesheet_entries set territorial_calendar_snapshot='{}' where id=%L$q$,pg_temp.id_de('1','2026-02-03'))),'erro 42501');

-- Faturamento reaproveita os componentes já congelados, sem classificação atual retroativa.
select pg_temp.exec('fatura-044',$q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1','2026-02-01','2026-02-15')).id::text$q$);
select pg_temp.assert_eq('74 fatura gerada', (pg_temp.r('fatura-044') ~ '^[0-9a-f-]{36}$')::text,'true');
select pg_temp.assert_eq('75 soma dos itens confere com fatura em centavos',
 (select (round(total_amount*100)=(select sum(round(amount*100)) from public.invoice_items where invoice_id=i.id))::text
  from public.invoices i where id=pg_temp.r('fatura-044')::uuid),'true');
create temporary table _invoiced_frozen as select id,to_jsonb(t) j from public.timesheet_entries t where invoice_id=pg_temp.r('fatura-044')::uuid;
select pg_temp.assert_eq('76 snapshot faturado imutável pelo admin',pg_temp.adm(format($q$update public.timesheet_entries set territorial_calendar_snapshot='{}' where id=%L$q$,pg_temp.id_de('1','2026-02-03'))),'erro 42501');
select pg_temp.assert_eq('77 motriz faturada imutável',pg_temp.adm(format($q$update public.timesheet_entries set check_out='08:00' where id=%L$q$,pg_temp.id_de('1','2026-02-03'))),'erro 42501');
select pg_temp.assert_eq('78 lastro faturado não se exclui',pg_temp.adm(format($q$delete from public.timesheet_entries where id=%L$q$,pg_temp.id_de('1','2026-02-03'))),'erro 42501');
select pg_temp.exec('aposentar-cobertura',$q$select public.aposentar_cobertura_calendario(
 (select id from public.financial_calendar_coverage where calendar_year=2026 and territory_scope='municipal' and municipality_code='4208203'),
 'COBERTURA_FUTURA_SINTETICA_044')$q$);
select pg_temp.assert_eq('79 aposentar cobertura não reescreve faturado',
 (select bool_and(to_jsonb(t)=f.j)::text from _invoiced_frozen f join public.timesheet_entries t using(id)),'true');
select pg_temp.assert_eq('80 cobertura aposentada produz pendência para nova consulta',
 pg_temp.adm($q$select (r->>'status')||'|'||((r->>'day_kind') is null)::text from (select public.consultar_calendario_operacao('5c42e000-0000-4000-8000-0000000000a1','2026-02-04') r) x$q$),
 'pendente|true');

-- OFF continua independente da presença de local e de feriados territoriais novos.
select pg_temp.exec('off-final',$q$select public.alterar_resolucao_tarifas(false,'OFF_FINAL_SINTETICO_044')$q$);
select pg_temp.assert_ok('81 OFF sem local aceita nova linha pelo contrato legado',pg_temp.save('off-no-location','2026-05-03','1','06:00','15:00',60,'a2','a4'));
select pg_temp.assert_eq('82 OFF preserva valor acordado200/custo80 e não cria snapshot territorial',
 (select (billed_amount=200 and cost_amount=80 and calc_version is null and territorial_calendar_snapshot is null)::text
  from public.timesheet_entries where employee_id=pg_temp.emp('1') and operation_id='5c42e000-0000-4000-8000-0000000000a2' and work_date='2026-05-03'),'true');
select pg_temp.assert_eq('83 OFF mantém todos os faturados intactos',
 (select bool_and(to_jsonb(t)=f.j)::text from _invoiced_frozen f join public.timesheet_entries t using(id)),'true');
-- OFF mantém a quantidade do snapshot em sincronia, sem mudar fontes/classificação ou dinheiro.
create temporary table _proveniencia_off as select territorial_calendar_snapshot-'segments' j
 from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04');
select pg_temp.assert_eq('83b OFF dia útil permite editar horário',
 pg_temp.adm(format($q$update public.timesheet_entries set check_out='14:00' where id=%L$q$,pg_temp.id_de('1','2026-05-04'))),'nulo');
select pg_temp.assert_eq('83c OFF parcial conserva núcleo035:420min/227,50/70',
 (select concat_ws('|',worked_minutes,billed_amount,cost_amount,calc_version) from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04')),'420|227.50|70.00|2');
select pg_temp.assert_eq('83d OFF minutos técnicos do snapshot acompanham a jornada atual',
 (select territorial_calendar_snapshot#>>'{segments,worked_minutes}' from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04')),'420');
select pg_temp.assert_eq('83e OFF conserva local, IDs e classificação congelados',
 (select ((territorial_calendar_snapshot-'segments')=(select j from _proveniencia_off))::text from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04')),'true');
select pg_temp.assert_eq('83f falta autorizada em dia útil conserva cobrança zero',
 pg_temp.adm(format($q$update public.timesheet_entries set status='absent' where id=%L$q$,pg_temp.id_de('1','2026-05-04'))),'nulo');
select pg_temp.assert_eq('83g falta também registra zero minutos técnicos',
 (select concat_ws('|',worked_minutes,billed_amount,cost_amount,territorial_calendar_snapshot#>>'{segments,worked_minutes}') from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04')),'0|0.00|0.00|0');
select pg_temp.assert_eq('83h falta conserva proveniência congelada',
 (select ((territorial_calendar_snapshot-'segments')=(select j from _proveniencia_off))::text from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-04')),'true');
-- R1: Brasília/DF é identidade IBGE, sem município jurídico (CF, art. 32).
select pg_temp.exec('catalogo-df',$q$select public.catalogar_municipio('5300108','LOCALIDADE_TESTE_DF','DF',
 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/5300108','FIXTURE_DF_SINTETICA')$q$);
insert into public.operations(id,client_id,contract_id,name) values
 ('5c42e000-0000-4000-8000-0000000000b1','5c42c000-0000-4000-8000-0000000000c1','5c42d000-0000-4000-8000-0000000000d1','OPERACAO_TESTE_DF');
insert into public.shifts(id,operation_id,name,start_time,end_time,break_minutes,crosses_midnight,shift_period) values
 ('5c42a000-0000-4000-8000-0000000000b1','5c42e000-0000-4000-8000-0000000000b1','TURNO_TESTE_DF','06:00','07:00',0,false,'diurno');
insert into public.employees(id,name,daily_cost) values(pg_temp.emp('8'),'COLABORADOR_TESTE_DF',80);
insert into public.employee_cost_terms(employee_id,valid_from,daily_cost,active,origin,reason)
 values(pg_temp.emp('8'),'2026-01-01',80,true,'informada','FIXTURE_DF_SINTETICA');
select pg_temp.exec('diaria-df',format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1',%L,'2026-01-01',260,'FIXTURE_DF_SINTETICA')$q$,pg_temp.emp('8')));
insert into public.operation_team(operation_id,employee_id,job_function_id) values
 ('5c42e000-0000-4000-8000-0000000000b1',pg_temp.emp('8'),pg_temp.fn('conferente'));
select pg_temp.exec('local-df',$q$select public.registrar_local_operacao('5c42e000-0000-4000-8000-0000000000b1','5300108','2026-01-01','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.assert_eq('R1 DF nacional sem distrital deixa cobertura pendente',
 public.calendario_da_operacao_interno('5c42e000-0000-4000-8000-0000000000b1','2026-02-04')->>'status','pendente');
select pg_temp.assert_eq('R1 DF aceita âmbito distrital explícito sem município',
 public.calendario_territorio_valido('distrital','DF',null)::text,'true');
select pg_temp.assert_eq('R1 DF não admite município jurídico fictício',
 public.calendario_territorio_valido('municipal','DF','5300108')::text,'false');
select pg_temp.assert_eq('R1 DF não é âmbito estadual',public.calendario_territorio_valido('estadual','DF',null)::text,'false');
select pg_temp.assert_eq('R1 distrital não aceita outra UF',public.calendario_territorio_valido('distrital','SC',null)::text,'false');
select pg_temp.assert_eq('R1 distrital não aceita código municipal',public.calendario_territorio_valido('distrital','DF','5300108')::text,'false');
select pg_temp.exec('cobertura-df',$q$select public.confirmar_cobertura_calendario(
 '{"calendar_year":2026,"territory_scope":"distrital","state_code":"DF","legal_act":"ATO_DISTRITAL_SINTETICO","official_url":"https://exemplo.df.gov.br/calendario"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.assert_eq('R1 DF exige somente nacional e distrital, preservando código5300108',
 (select concat_ws('|',r->>'status',r->>'municipality_code',r->>'state_code',jsonb_array_length(r->'coverage_ids'))
 from (select public.calendario_da_operacao_interno('5c42e000-0000-4000-8000-0000000000b1','2026-02-04') r) x),'confirmado|5300108|DF|2');
select pg_temp.assert_eq('R1 DF recebe feriado nacional',pg_temp.classificar('2026-02-04','5c42e000-0000-4000-8000-0000000000b1'),'feriado');
select pg_temp.assert_eq('R1 DF não herda estadual SC',pg_temp.classificar('2026-02-05','5c42e000-0000-4000-8000-0000000000b1'),'util');
select pg_temp.exec('feriado-df',$q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-10-05","name":"FERIADO_DISTRITAL_SINTETICO","territory_scope":"distrital","state_code":"DF","legal_act":"ATO_DISTRITAL_SINTETICO","official_url":"https://exemplo.df.gov.br/ato","verification_status":"confirmado"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.assert_eq('R1 DF aplica distrital',pg_temp.classificar('2026-10-05','5c42e000-0000-4000-8000-0000000000b1'),'feriado');
select pg_temp.assert_eq('R1 distrital não contamina SC',pg_temp.classificar('2026-10-05','5c42e000-0000-4000-8000-0000000000a3'),'util');
select pg_temp.assert_eq('R1 DF ano sem cobertura continua pendente',
 public.calendario_da_operacao_interno('5c42e000-0000-4000-8000-0000000000b1','2028-02-04')->>'status','pendente');
select pg_temp.exec('df-pendente',$q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2027-10-05","name":"DISTRITAL_PENDENTE_SINTETICO","territory_scope":"distrital","state_code":"DF","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.df.gov.br/ato","verification_status":"pendente"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.exec('df-2027',$q$select public.confirmar_cobertura_calendario(
 '{"calendar_year":2027,"territory_scope":"distrital","state_code":"DF","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.df.gov.br/ato"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.assert_eq('R1 DF feriado pendente impede falso dia útil',
 ((public.calendario_da_operacao_interno('5c42e000-0000-4000-8000-0000000000b1','2027-10-06')->>'day_kind') is null)::text,'true');
select pg_temp.exec('df-facultativo',$q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-10-06","name":"FACULTATIVO_DF_SINTETICO","territory_scope":"distrital","state_code":"DF","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.df.gov.br/ato","verification_status":"pendente","holiday_kind":"ponto_facultativo"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.assert_eq('R1 DF facultativo não vira feriado',pg_temp.classificar('2026-10-06','5c42e000-0000-4000-8000-0000000000b1'),'util');
select pg_temp.assert_ok('R1 DF OFF nova presença ignora distrital',pg_temp.save('df-off','2026-10-05','8','06:00','15:00',60,'b1','b1'));
select pg_temp.assert_eq('R1 DF OFF conserva regra043 sem snapshot territorial',
 (select (billed_amount=100 and cost_amount=80 and billed_special_amount=0 and territorial_calendar_snapshot is null)::text from public.timesheet_entries where operation_id='5c42e000-0000-4000-8000-0000000000b1' and work_date='2026-10-05'),'true');
select pg_temp.exec('df-overlap-nacional',$q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-10-11","name":"NACIONAL_SOBREPOSTO_DF_SINTETICO","territory_scope":"nacional","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.gov.br/ato","verification_status":"confirmado"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.exec('df-overlap-distrital',$q$select public.registrar_feriado_territorial(
 '{"holiday_date":"2026-10-11","name":"DISTRITAL_SOBREPOSTO_SINTETICO","territory_scope":"distrital","state_code":"DF","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.df.gov.br/ato","verification_status":"confirmado"}','FIXTURE_DF_SINTETICA')$q$);
select pg_temp.exec('df-on-config',$q$select public.alterar_resolucao_tarifas(true,'FIXTURE_DF_SINTETICA')$q$);
select pg_temp.assert_ok('R1 DF ON mantém fórmulaFIN09',pg_temp.save('df-on','2026-10-11','8','06:00','07:00',0,'b1','b1'));
select pg_temp.assert_eq('R1 DF especial65 custo20 sem base nem HE',
 (select pg_temp.money(id) from public.timesheet_entries where operation_id='5c42e000-0000-4000-8000-0000000000b1' and work_date='2026-10-11'),'65.00|20.00|0.00|0.00|65.00|0.00|60|feriado|2');

select pg_temp.assert_eq('R1 DF sobreposição nacional+distrital+domingo cobra uma vez',
 (select concat_ws('|',jsonb_array_length(territorial_calendar_snapshot#>'{days,0,holiday_ids}'),
 jsonb_array_length(territorial_calendar_snapshot#>'{days,0,coverage_ids}'),territorial_calendar_snapshot#>>'{location,municipality_code}',billed_special_amount)
 from public.timesheet_entries where operation_id='5c42e000-0000-4000-8000-0000000000b1' and work_date='2026-10-11'),'2|2|5300108|65.00');
-- Mesma guarda nas RPCs distritais: recusas não deixam ocorrência, cobertura ou auditoria.
do $$
declare ident record; rpc record; claims jsonb; obtido text; esperado text; antes jsonb;
begin
 for ident in select * from (values
  ('admin sem fator','authenticated','a1','aal1',true,true),
  ('admin com fator AAL1','authenticated','a4','aal1',true,false),
  ('admin com fator AAL2','authenticated','a4','aal2',true,true),
  ('operacional','authenticated','a2','aal1',true,false),
  ('anon','anon','a1','aal1',false,false),
  ('sem papel','authenticated','a3','aal1',true,false),
  ('sessão inválida','authenticated','a1','aal2',false,false)
 ) x(nome,papel,usr,aal,sessao_valida,permitido) loop
  claims:=jsonb_build_object('sub','5c420000-0000-4000-8000-0000000000'||ident.usr,'role',ident.papel,'aal',ident.aal);
  if ident.sessao_valida then claims:=claims||jsonb_build_object('session_id','ec420000-0000-4000-8000-0000000000'||ident.usr); end if;
  esperado:=case when ident.permitido then 'ok' else 'erro 42501' end;
  for rpc in select * from (values
   ('feriado distrital',$q$select public.registrar_feriado_territorial('{"holiday_date":"2095-02-01","name":"SONDA_DISTRITAL_SINTETICA","territory_scope":"distrital","state_code":"DF","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.df.gov.br/ato","verification_status":"confirmado"}','SONDA_DF_SINTETICA')$q$),
   ('cobertura distrital',$q$select public.confirmar_cobertura_calendario('{"calendar_year":2095,"territory_scope":"distrital","state_code":"DF","legal_act":"ATO_SINTETICO","official_url":"https://exemplo.df.gov.br/ato"}','SONDA_DF_SINTETICA')$q$)
  ) x(nome,sql) loop
   select jsonb_build_array((select count(*) from public.financial_terms_audit),(select count(*) from public.financial_holidays),(select count(*) from public.financial_calendar_coverage)) into antes;
   obtido:=pg_temp.medir_como(ident.papel,claims,format('select pg_temp.sondar(%L)',rpc.sql));
   perform pg_temp.assert_eq('R1 DF '||rpc.nome||' / '||ident.nome,obtido,esperado);
   perform pg_temp.assert_eq('R1 DF sem escrita/auditoria residual '||rpc.nome||' / '||ident.nome,
    (antes=jsonb_build_array((select count(*) from public.financial_terms_audit),(select count(*) from public.financial_holidays),(select count(*) from public.financial_calendar_coverage)))::text,'true');
  end loop;
 end loop;
end; $$;
select pg_temp.exec('fatura-df',$q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1','2026-10-01','2026-10-15')).id::text$q$);
select pg_temp.assert_eq('R1 DF itens e total da fatura conferem em centavos',
 (select (round(total_amount*100)=16500 and round(total_amount*100)=(select sum(round(amount*100)) from public.invoice_items where invoice_id=i.id))::text
 from public.invoices i where id=pg_temp.r('fatura-df')::uuid),'true');
create temporary table _df_faturado as select id,to_jsonb(t) j from public.timesheet_entries t where invoice_id=pg_temp.r('fatura-df')::uuid;
select pg_temp.exec('aposentar-df',format($q$select public.aposentar_feriado(%L,'APOSENTADORIA_DF_SINTETICA')$q$,pg_temp.r('feriado-df')));
select pg_temp.exec('aposentar-cobertura-df',$q$select public.aposentar_cobertura_calendario(
 (select id from public.financial_calendar_coverage where territory_scope='distrital' and calendar_year=2026),'APOSENTADORIA_DF_SINTETICA')$q$);
select pg_temp.assert_eq('R1 DF nova consulta com cobertura aposentada é pendente',
 public.calendario_da_operacao_interno('5c42e000-0000-4000-8000-0000000000b1','2026-10-11')->>'status','pendente');
select pg_temp.assert_eq('R1 DF aposentadoria não reprecifica fatura nem snapshots',
 (select bool_and(to_jsonb(t)=f.j)::text from _df_faturado f join public.timesheet_entries t using(id)),'true');
select pg_temp.assert_eq('R1 DF alteração de horário faturado recusada',pg_temp.adm($q$update public.timesheet_entries set check_out='08:00' where operation_id='5c42e000-0000-4000-8000-0000000000b1' and work_date='2026-10-11'$q$),'erro 42501');
select pg_temp.assert_eq('R1 DF alteração de snapshot faturado recusada',pg_temp.adm($q$update public.timesheet_entries set territorial_calendar_snapshot='{}' where operation_id='5c42e000-0000-4000-8000-0000000000b1' and work_date='2026-10-11'$q$),'erro 42501');

-- R2: encerrar vigência aberta não pode deixar snapshot posterior sem lastro.
create temporary table _r2_antes as select (select jsonb_agg(to_jsonb(t) order by id) from public.operation_location_terms t) locais, (select jsonb_agg(to_jsonb(t) order by id) from public.timesheet_entries t) apontamentos, (select count(*) from public.financial_terms_audit) auditorias;
select pg_temp.assert_eq('R2 snapshot posterior impede encerrar vigência aberta',
 pg_temp.adm($q$select public.registrar_local_operacao('5c42e000-0000-4000-8000-0000000000b1','5300108','2026-10-06','R2_FIXTURE_SINTETICA',true,'2026-10-10')$q$),'erro 55000');
select pg_temp.assert_eq('R2 recusa preserva vigências, snapshots e auditoria',
 (select (locais=(select jsonb_agg(to_jsonb(t) order by id) from public.operation_location_terms t) and apontamentos=(select jsonb_agg(to_jsonb(t) order by id) from public.timesheet_entries t) and auditorias=(select count(*) from public.financial_terms_audit))::text from _r2_antes),'true');
select pg_temp.assert_ok('R2 período limitado sem snapshots é permitido',pg_temp.adm($q$select public.registrar_local_operacao('5c42e000-0000-4000-8000-0000000000a4','4208203','2026-10-06','R2_FIXTURE_SINTETICA',true,'2026-10-10')$q$));
select pg_temp.assert_ok('R2 período aberto sem snapshots é permitido',pg_temp.adm($q$select public.registrar_local_operacao('5c42e000-0000-4000-8000-0000000000a5','4208203','2026-10-06','R2_FIXTURE_SINTETICA',true,null)$q$));
select pg_temp.assert_eq('84 todos os preparos declarativos passaram',
 (select count(*)::text from _resultado where situacao='FAIL'),'0');
rollback;
