-- Migration 048 — preço-base do contrato como 3º nível da precedência (FUNC-READY-01).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que termina em
-- `rollback`. NUNCA rodar contra Production nem homologação. Dados SINTÉTICOS (C01, K1, E1…).
--
-- Mesma fixture da suíte 042 (prefixo 5c48): K1/K2 com preço-base 100, fator 1,5, jornada 8 h (hora = 18,75).
-- E1/E2/E3 conferente; E4/E5 operador; E6 auxiliar; E7 sem função. Tarifa só do conferente diurno (240);
-- diária individual só do E1 (260). O operador e o auxiliar NÃO têm tarifa.
--
-- O QUE ESTE ARQUIVO PROVA
--   A  ligar a resolução sem nenhuma tarifa e com contratos sem tarifa deixou de ser recusado; o banco anuncia
--   P  precedência: individual (260) > tarifa (240) > preço-base (100), com fonte e vínculo coerentes
--   H  HE sobre o preço-base sai da diária resolvida (100 + 18,75)
--   C  classificação continua obrigatória (sem função = 55000); operação sem contrato = valor acordado
--   E  dia especial (domingo) precificado pelo preço-base, sem P0002
--   Z  desligar volta à diária genérica para todos

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
    jsonb_build_object('sub', '5c480000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec480000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c480000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec480000-0000-4000-8000-0000000000a2'), _sql)
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
  select ('5c48f000-0000-4000-8000-00000000000' || _n)::uuid
$$;

-- ---------------------------------------------------------------------------
-- Fixture (motor ligado, resolução desligada)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c480000-0000-4000-8000-0000000000a1'), ('5c480000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec480000-0000-4000-8000-0000000000a1', '5c480000-0000-4000-8000-0000000000a1', null),
  ('ec480000-0000-4000-8000-0000000000a2', '5c480000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c480000-0000-4000-8000-0000000000a1', 'admin'), ('5c480000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c48c000-0000-4000-8000-0000000000c1', 'C01');
-- K1 e K2: diária GENÉRICA 100 (a de antes), fator 1,5, jornada 8 h.
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c48d000-0000-4000-8000-0000000000d1', '5c48c000-0000-4000-8000-0000000000c1', 'K1', 100, 8, 1.5, 10),
  ('5c48d000-0000-4000-8000-0000000000d2', '5c48c000-0000-4000-8000-0000000000c1', 'K2', 100, 8, 1.5, 10);
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor)
  select c.id, date '2026-01-01', 100, 8, 1.5, 10, true, 'informada', 'REC', 'diario', 4, 2 from public.contracts c
   where c.id in ('5c48d000-0000-4000-8000-0000000000d1', '5c48d000-0000-4000-8000-0000000000d2');
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c48e000-0000-4000-8000-0000000000a1', '5c48c000-0000-4000-8000-0000000000c1', '5c48d000-0000-4000-8000-0000000000d1', 'OP1', null),
  ('5c48e000-0000-4000-8000-0000000000a2', '5c48c000-0000-4000-8000-0000000000c1', null, 'OP-SEM-CONTRATO', 200),
  ('5c48e000-0000-4000-8000-0000000000a3', '5c48c000-0000-4000-8000-0000000000c1', '5c48d000-0000-4000-8000-0000000000d2', 'OP3', null);
insert into public.operation_terms (operation_id, valid_from, agreed_amount, active, origin, reason) values
  ('5c48e000-0000-4000-8000-0000000000a2', date '2026-01-01', 200, true, 'informada', 'REC');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight, shift_period) values
  ('5c48a000-0000-4000-8000-0000000000a1', '5c48e000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60, false, 'diurno'),
  ('5c48a000-0000-4000-8000-0000000000a2', '5c48e000-0000-4000-8000-0000000000a1', 'S2', '22:00', '07:00', 60, true, 'noturno'),
  ('5c48a000-0000-4000-8000-0000000000a4', '5c48e000-0000-4000-8000-0000000000a2', 'S4', '06:00', '15:00', 60, false, 'diurno'),
  ('5c48a000-0000-4000-8000-0000000000a5', '5c48e000-0000-4000-8000-0000000000a3', 'S5', '06:00', '15:00', 60, false, 'diurno');
insert into public.employees (id, name, daily_cost) values
  (pg_temp.emp('1'), 'REC-E1', 80), (pg_temp.emp('2'), 'REC-E2', 80), (pg_temp.emp('3'), 'REC-E3', 80),
  (pg_temp.emp('4'), 'REC-E4', 80), (pg_temp.emp('5'), 'REC-E5', 80), (pg_temp.emp('6'), 'REC-E6', 80),
  (pg_temp.emp('7'), 'REC-E7', 80);
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select e.id, date '2026-01-01', 80, true, 'informada', 'REC' from public.employees e where e.name like 'REC-E%';
-- Funções: E1/E2/E3 conferente; E4/E5 operador; E6 auxiliar (sem tarifa); E7 SEM função.
insert into public.operation_team (operation_id, shift_id, employee_id, job_function_id)
  select o.id, null, pg_temp.emp(x.n), (select id from public.job_functions where code = x.f)
    from (values ('1', 'conferente'), ('2', 'conferente'), ('3', 'conferente'), ('4', 'operador'), ('5', 'operador'),
                 ('6', 'auxiliar_producao')) as x(n, f)
    cross join public.operations o where o.id = '5c48e000-0000-4000-8000-0000000000a1';
insert into public.operation_team (operation_id, shift_id, employee_id, job_function_id) values
  ('5c48e000-0000-4000-8000-0000000000a1', null, pg_temp.emp('7'), null);
insert into public.user_operation_access (user_id, operation_id)
  values ('5c480000-0000-4000-8000-0000000000a2', '5c48e000-0000-4000-8000-0000000000a1');

-- Precondições territoriais somente quando a 044 estiver instalada.
-- São dados sintéticos explícitos; os oráculos financeiros e a ativação da resolução permanecem os da suíte.
do $$
declare ano integer;
begin
 if to_regclass('public.municipality_catalog') is not null then
  execute $q$insert into public.municipality_catalog(code,name,state_code,official_url)
   values('4200000','MUNICIPIO_TESTE_044','SC',
    'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4200000')$q$;
  execute $q$insert into public.operation_location_terms(operation_id,municipality_code,valid_from,reason)
   select id,'4200000',date '2020-01-01','FIXTURE_LOCALIDADE_SINTETICA_044'
    from public.operations where client_id='5c48c000-0000-4000-8000-0000000000c1'$q$;
  foreach ano in array array[2026] loop
   execute $q$insert into public.financial_calendar_coverage
    (calendar_year,territory_scope,state_code,municipality_code,legal_act,official_url,client_confirmed,reason)
    values($1,'nacional',null,null,'ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_LOCALIDADE_SINTETICA_044'),
          ($1,'estadual','SC',null,'ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_LOCALIDADE_SINTETICA_044'),
          ($1,'municipal','SC','4200000','ATO_SINTETICO','https://exemplo.gov.br/calendario',true,'FIXTURE_LOCALIDADE_SINTETICA_044')$q$ using ano;
  end loop;
 end if;
end; $$;

set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste REC') ->> 'ativo')$q$));

-- Salva uma linha (como a tela). _turno 'a1'/'a2'/'a4'/'a5'.
create or replace function pg_temp.salvar(_k text, _op text, _turno text, _data date, _emp text, _saida text, _ent text default '06:00', _status text default 'present', _fn text default '') returns void
language sql as $$
  select pg_temp.exec(_k, format($q$select public.salvar_apontamento_admin('5c48e000-0000-4000-8000-0000000000%s', %L, %L,
    jsonb_build_array(jsonb_build_object('employee_id', %L, 'status', %L,
      'check_in', %L, 'check_out', %L, 'break_minutes', 60) || case when %L = '' then '{}'::jsonb else jsonb_build_object('job_function_id', %L) end))::text$q$,
    _op, '5c48a000-0000-4000-8000-0000000000' || _turno, _data, pg_temp.emp(_emp)::text, _status,
    case when _status = 'absent' then null else _ent end, case when _status = 'absent' then null else _saida end, _fn, _fn))
$$;
-- cobrado|minutos HE|diária congelada|fonte|adicional|HE em R$
create or replace function pg_temp.v(_emp text, _data date) returns text language sql as $$
  select te.billed_amount::text || '|' || coalesce(te.billed_overtime_minutes::text, '-') || '|' || te.daily_rate_snapshot::text
         || '|' || coalesce(te.price_source, 'generica') || '|' || te.additional_amount::text || '|' || te.billed_overtime_amount::text
    from public.timesheet_entries te
   where te.employee_id = pg_temp.emp(_emp) and te.work_date = _data and te.operation_id = '5c48e000-0000-4000-8000-0000000000a1'
$$;

-- ---------------------------------------------------------------------------
-- A. Ativação sem tarifa (antes: 55000 "nenhuma tarifa" / "seriam recusados")
-- ---------------------------------------------------------------------------
select pg_temp.exec('a1', $q$select (public.alterar_resolucao_tarifas(true, 'Ligada sem tarifa no teste REC') ->> 'ativa')$q$);
select pg_temp.registrar('A1. liga sem nenhuma tarifa cadastrada e com contratos sem tarifa', 'true', pg_temp.r('a1'));
select pg_temp.registrar('A2. o estado anuncia a resolução ligada e o recuo no preço-base', 'true|true',
  pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'resolucao_tarifas') || '|' || (public.estado_motor_vigencia() ->> 'preco_base_recuo')$q$));

-- Tarifa do conferente diurno (240) e diária individual do E1 (260), pelas RPCs com motivo.
select pg_temp.exec('t1', format($q$select public.registrar_tarifa_contrato(p_contract_id => '5c48d000-0000-4000-8000-0000000000d1',
  p_job_function_id => %L, p_shift_period => 'diurno', p_valid_from => date '2026-01-01', p_daily_rate => 240,
  p_reason => 'Tarifa REC', p_encerrar_anterior => true)::text$q$, pg_temp.fn('conferente')));
select pg_temp.exec('i1', format($q$select public.registrar_diaria_individual(p_contract_id => '5c48d000-0000-4000-8000-0000000000d1',
  p_employee_id => %L, p_valid_from => date '2026-01-01', p_daily_rate => 260, p_reason => 'Individual REC',
  p_encerrar_anterior => true)::text$q$, pg_temp.emp('1')));
select pg_temp.registrar('A3. tarifa e diária individual cadastradas', 'ok|ok',
  (case when pg_temp.r('t1') like 'erro%' then pg_temp.r('t1') else 'ok' end) || '|' ||
  (case when pg_temp.r('i1') like 'erro%' then pg_temp.r('i1') else 'ok' end));

-- ---------------------------------------------------------------------------
-- P. Precedência na mesma data (terça 2026-03-03), turno diurno S1
-- ---------------------------------------------------------------------------
select pg_temp.salvar('p1', 'a1', 'a1', date '2026-03-03', '1', '15:00', '06:00', 'present', pg_temp.fn('conferente')::text);
select pg_temp.salvar('p2', 'a1', 'a1', date '2026-03-03', '2', '15:00', '06:00', 'present', pg_temp.fn('conferente')::text);
select pg_temp.salvar('p4', 'a1', 'a1', date '2026-03-03', '4', '15:00', '06:00', 'present', pg_temp.fn('operador')::text);
select pg_temp.salvar('p6', 'a1', 'a1', date '2026-03-03', '6', '15:00', '06:00', 'present', pg_temp.fn('auxiliar_producao')::text);
select pg_temp.registrar('P1. E1 com diária individual = 260 (fonte individual)', '260.00|0|260.00|individual',
  split_part(pg_temp.v('1', date '2026-03-03'), '|', 1) || '|' || split_part(pg_temp.v('1', date '2026-03-03'), '|', 2) || '|' ||
  split_part(pg_temp.v('1', date '2026-03-03'), '|', 3) || '|' || split_part(pg_temp.v('1', date '2026-03-03'), '|', 4));
select pg_temp.registrar('P2. E2 conferente sem individual = tarifa 240 (fonte funcao_periodo)', '240.00|funcao_periodo',
  split_part(pg_temp.v('2', date '2026-03-03'), '|', 1) || '|' || split_part(pg_temp.v('2', date '2026-03-03'), '|', 4));
select pg_temp.registrar('P3. E4 operador SEM tarifa = preço-base 100 (antes: P0002), fonte genérica, sem vínculo de tarifa',
  '100.00|generica|true',
  split_part(pg_temp.v('4', date '2026-03-03'), '|', 1) || '|' || split_part(pg_temp.v('4', date '2026-03-03'), '|', 4) || '|' ||
  (select (te.contract_rate_terms_id is null and te.contract_employee_rate_id is null and te.contract_terms_id is not null)::text
     from public.timesheet_entries te where te.employee_id = pg_temp.emp('4') and te.work_date = date '2026-03-03'));
select pg_temp.registrar('P4. E6 auxiliar sem tarifa = preço-base 100', '100.00',
  split_part(pg_temp.v('6', date '2026-03-03'), '|', 1));

-- ---------------------------------------------------------------------------
-- H. HE sobre o preço-base (quarta 2026-03-04): 1 h -> 100 + 18,75
-- ---------------------------------------------------------------------------
select pg_temp.salvar('h4', 'a1', 'a1', date '2026-03-04', '4', '16:00', '06:00', 'present', pg_temp.fn('operador')::text);
select pg_temp.registrar('H1. HE de 1 h sobre o preço-base: 118,75 (HE 18,75)', '118.75|18.75',
  split_part(pg_temp.v('4', date '2026-03-04'), '|', 1) || '|' || split_part(pg_temp.v('4', date '2026-03-04'), '|', 6));

-- ---------------------------------------------------------------------------
-- C. Classificação continua obrigatória; operação sem contrato segue o valor acordado
-- ---------------------------------------------------------------------------
select pg_temp.salvar('c7', 'a1', 'a1', date '2026-03-04', '7', '15:00');
select pg_temp.registrar('C1. sem função continua pendente (55000), nada gravado', 'erro 55000|0',
  pg_temp.r('c7') || '|' || (select count(*)::text from public.timesheet_entries where employee_id = pg_temp.emp('7')));
select pg_temp.exec('c5', format($q$select public.salvar_apontamento_admin('5c48e000-0000-4000-8000-0000000000a2', '5c48a000-0000-4000-8000-0000000000a4', date '2026-03-04',
  jsonb_build_array(jsonb_build_object('employee_id', %L, 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60, 'job_function_id', %L)))::text$q$,
  pg_temp.emp('5'), pg_temp.fn('operador')));
select pg_temp.registrar('C2. operação sem contrato: valor acordado 200', '200.00',
  (select te.billed_amount::text from public.timesheet_entries te where te.employee_id = pg_temp.emp('5') and te.work_date = date '2026-03-04'));

-- ---------------------------------------------------------------------------
-- E. Domingo (2026-03-08) pelo preço-base: sem P0002 e com a diária-base congelada
-- ---------------------------------------------------------------------------
select pg_temp.salvar('e4', 'a1', 'a1', date '2026-03-08', '4', '15:00', '06:00', 'present', pg_temp.fn('operador')::text);
select pg_temp.registrar('E1. domingo do operador sem tarifa: gravado, diária congelada 100', 'ok|100.00',
  (case when pg_temp.r('e4') like 'erro%' then pg_temp.r('e4') else 'ok' end) || '|' ||
  coalesce((select te.daily_rate_snapshot::text from public.timesheet_entries te where te.employee_id = pg_temp.emp('4') and te.work_date = date '2026-03-08'), 'nada'));

-- ---------------------------------------------------------------------------
-- Z. Desligar: volta à diária genérica para todos (a individual e a tarifa deixam de valer)
-- ---------------------------------------------------------------------------
select pg_temp.exec('z1', $q$select (public.alterar_resolucao_tarifas(false, 'Desligada no teste REC') ->> 'ativa')$q$);
select pg_temp.salvar('z2', 'a1', 'a1', date '2026-03-05', '2', '15:00', '06:00', 'present', pg_temp.fn('conferente')::text);
select pg_temp.registrar('Z1. desligada: E2 conferente volta a 100 (genérica)', 'false|100.00|generica',
  pg_temp.r('z1') || '|' || split_part(pg_temp.v('2', date '2026-03-05'), '|', 1) || '|' || split_part(pg_temp.v('2', date '2026-03-05'), '|', 4));

-- ---------------------------------------------------------------------------
select caso, situacao, esperado, obtido from _resultado order by ordem;
do $$
begin
  if exists (select 1 from _resultado where situacao = 'FAIL') then
    raise exception '048: % de % asserções FALHARAM.',
      (select count(*) from _resultado where situacao = 'FAIL'), (select count(*) from _resultado);
  end if;
end; $$;
select '048: ' || count(*) || ' asserções PASS; todas as fixtures serão desfeitas.' as resultado from _resultado;
rollback;
