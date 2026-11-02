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


-- Regressão FIN-PR-09: trocar o caminho especial pelo legado deve falhar aqui.
select pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1', %L, date '2026-01-01', 260, 'INDIVIDUAL_TESTE_A')$q$, pg_temp.emp('1')));
select pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2026-01-01', 250, 'TARIFA_TESTE_A')$q$, pg_temp.fn('conferente')));
select pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d2', %L, 'diurno', date '2026-01-01', 300, 'TARIFA_TESTE_B')$q$, pg_temp.fn('conferente')));
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(true, 'RESOLUCAO_TESTE_A')$q$);
do $$ begin
  if not public.resolucao_de_tarifas_ativa() then
    raise exception 'Fixture inválida: resolução comercial não foi ligada.';
  end if;
end; $$;
-- 06–08, intervalo 60 => 60 minutos efetivos (domingo).
select pg_temp.salvar('especial-a', 'a1', 'a1', date '2026-03-01', '1', '08:00');
do $$
declare e public.timesheet_entries%rowtype;
begin
  select * into strict e from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-01');
  if (e.calc_version, e.day_kind_snapshot, e.billed_base_amount, e.billed_overtime_amount,
      e.billed_special_amount, e.additional_amount, e.billed_amount, e.cost_amount)
     is distinct from (2::smallint, 'domingo'::text, 0::numeric, 0::numeric, 65::numeric, 0::numeric, 65::numeric, 20::numeric) then
    raise exception 'FIN09 RED domingo integrado: esperado V2/domingo/base=0/HE=0/especial=65/bonus=0/total=65/custo=20; obtido %',
      jsonb_build_object('versao',e.calc_version,'dia',e.day_kind_snapshot,'base',e.billed_base_amount,'he',e.billed_overtime_amount,'especial',e.billed_special_amount,'bonus',e.additional_amount,'total',e.billed_amount,'custo',e.cost_amount);
  end if;
end;
$$;
-- Asserções imediatas: nenhum erro de fixture pode se transformar em PASS.
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception '%: esperado %, obtido %', caso, esperado, obtido;
  end if;
  raise notice 'PASS: %', caso;
end; $$;
create function pg_temp.money(e uuid) returns text language sql as $$
 select concat_ws('|',billed_amount,cost_amount,billed_base_amount,billed_overtime_amount,billed_special_amount,
   additional_amount,worked_minutes,overtime_minutes,billed_overtime_minutes,day_kind_snapshot,calc_version)
 from public.timesheet_entries where id=e
$$;
create function pg_temp.save(k text, d date, emp text, ent text, sai text, pausa integer default 0,
  op text default 'a1', turno text default 'a1', fn text default '', status text default 'present')
returns text language plpgsql as $$
declare r text;
begin
  r:=pg_temp.adm(format($q$select public.salvar_apontamento_admin('5c42e000-0000-4000-8000-0000000000%s',
    '5c42a000-0000-4000-8000-0000000000%s', %L,
    jsonb_build_array(jsonb_build_object('employee_id',%L,'status',%L,'check_in',%L,'check_out',%L,'break_minutes',%s)
    || case when %L='' then '{}'::jsonb else jsonb_build_object('job_function_id',%L) end))::text$q$,
    op,turno,d,pg_temp.emp(emp),status,ent,sai,pausa,fn,fn));
  insert into _exec values(k,r);
  return r;
end; $$;
select pg_temp.assert_eq('01 domingo individual 260 / custo 80 / intervalo 60', pg_temp.money(pg_temp.id_de('1','2026-03-01')),
  '65.00|20.00|0.00|0.00|65.00|0.00|60|0|0|domingo|2');
select pg_temp.assert_eq('02 fonte individual, contrato, custo, função e período congelados',
  (select (price_source='individual' and daily_rate_snapshot=260 and daily_cost_snapshot=80
    and contract_employee_rate_id is not null and contract_rate_terms_id is null
    and contract_terms_id is not null and employee_cost_terms_id is not null
    and job_function_id_snapshot=pg_temp.fn('conferente') and shift_period_snapshot='diurno')::text
   from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01')), 'true');
select pg_temp.adm($q$select public.registrar_feriado('2026-03-02','FERIADO_TESTE_A','FERIADO_TESTE_A')$q$);
select pg_temp.adm($q$select public.registrar_feriado('2026-03-08','FERIADO_TESTE_B','FERIADO_TESTE_B')$q$);
select pg_temp.save('holiday','2026-03-02','1','06:00','08:00');
select pg_temp.assert_eq('03 feriado 120 minutos', pg_temp.money(pg_temp.id_de('1','2026-03-02')),
 '130.00|40.00|0.00|0.00|130.00|0.00|120|0|0|feriado|2');
select pg_temp.save('both','2026-03-08','1','06:00','07:00');
select pg_temp.assert_eq('04 domingo e feriado usa fator 2 uma vez', pg_temp.money(pg_temp.id_de('1','2026-03-08')),
 '65.00|20.00|0.00|0.00|65.00|0.00|60|0|0|feriado|2');
select pg_temp.save('standard','2026-03-01','2','06:00','07:00');
select pg_temp.assert_eq('05 sem individual usa padrão 250',
 (select billed_amount::text||'|'||daily_rate_snapshot||'|'||price_source from public.timesheet_entries where id=pg_temp.id_de('2','2026-03-01')),
 '62.50|250.00|funcao_periodo');
select pg_temp.assert_eq('06 sem fonte não aceita zero ou genérica', pg_temp.save('no-rate','2026-03-01','6','06:00','07:00'),'erro P0002');
select pg_temp.assert_eq('07 tarifa de outra função não atende operador', pg_temp.save('no-function','2026-03-01','4','06:00','07:00'),'erro P0002');
select pg_temp.assert_eq('08 tarifa diurna não atende turno noturno', pg_temp.save('no-night','2026-03-01','2','22:00','23:00',0,'a1','a2'),'erro P0002');
select pg_temp.assert_eq('09 fora da vigência não usa valor atual', pg_temp.save('no-date','2025-12-28','2','06:00','07:00'),'erro P0002');
select pg_temp.save('other-contract','2026-03-01','1','06:00','07:00',0,'a3','a5',pg_temp.fn('conferente')::text);
select pg_temp.assert_eq('10 individual de outro contrato não atravessa',
 (select billed_amount::text||'|'||price_source from public.timesheet_entries where employee_id=pg_temp.emp('1') and operation_id='5c42e000-0000-4000-8000-0000000000a3' and work_date='2026-03-01'), '75.00|funcao_periodo');
select pg_temp.save('no-contract','2026-03-01','1','06:00','07:00',0,'a2','a4');
select pg_temp.assert_eq('11 operação sem contrato usa valor acordado 200, custo independente',
 (select billed_amount::text||'|'||cost_amount||'|'||daily_rate_snapshot||'|'||terms_origin from public.timesheet_entries where employee_id=pg_temp.emp('1') and operation_id='5c42e000-0000-4000-8000-0000000000a2' and work_date='2026-03-01'), '50.00|20.00|200.00|valor_acordado');
select pg_temp.assert_eq('12 jornada incompleta recusada', pg_temp.save('incomplete','2026-03-15','1','06:00',null),'erro 22023');
select pg_temp.assert_eq('13 entrada igual saída recusada', pg_temp.save('equal','2026-03-15','1','06:00','06:00'),'erro 23514');
select pg_temp.save('midnight','2026-03-15','1','23:30','01:30',60);
select pg_temp.assert_eq('14 virada e intervalo, sem HE comum', pg_temp.money(pg_temp.id_de('1','2026-03-15')),
 '65.00|20.00|0.00|0.00|65.00|0.00|60|0|0|domingo|2');
select pg_temp.save('absent','2026-03-15','2',null,null,0,'a1','a1','','absent');
select pg_temp.assert_eq('15 ausência zero, sem fonte inventada',
 (select (billed_amount=0 and cost_amount=0 and additional_amount=0 and worked_minutes=0 and calc_version=2 and contract_terms_id is null)::text from public.timesheet_entries where id=pg_temp.id_de('2','2026-03-15')), 'true');
-- Bônus passa uma única vez, inclusive em recálculos.
select pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'BONUS_TESTE_A')$q$,pg_temp.id_de('1','2026-03-01')));
select pg_temp.assert_eq('16 bônus domingo sem multiplicador nem custo', pg_temp.money(pg_temp.id_de('1','2026-03-01')),
 '95.00|20.00|0.00|0.00|65.00|30.00|60|0|0|domingo|2');
select pg_temp.assert_eq('17 substituição exige confirmação', pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,40,'SUBSTITUICAO_TESTE')$q$,pg_temp.id_de('1','2026-03-01'))),'erro 23505');
select pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,40,'SUBSTITUICAO_TESTE',true)$q$,pg_temp.id_de('1','2026-03-01')));
select pg_temp.assert_eq('18 substituição não acumula', (select billed_amount::text||'|'||additional_amount from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01')),'105.00|40.00');
select pg_temp.save('recalc-bonus','2026-03-01','1','06:00','08:00',60);
select pg_temp.assert_eq('19 recálculo preserva bônus uma vez', (select billed_amount::text||'|'||additional_amount from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01')),'105.00|40.00');
select pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'BONUS_FERIADO')$q$,pg_temp.id_de('1','2026-03-02')));
select pg_temp.assert_eq('20 bônus feriado fora do especial', (select billed_amount::text||'|'||billed_special_amount||'|'||cost_amount from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-02')),'160.00|130.00|40.00');
select pg_temp.assert_eq('21 motivo vazio recusado',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,' ',true)$q$,pg_temp.id_de('1','2026-03-02'))),'erro 22023');
select pg_temp.assert_eq('22 monetário inválido recusado',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30.001,'INVALIDO',true)$q$,pg_temp.id_de('1','2026-03-02'))),'erro 22023');
select pg_temp.assert_eq('23 bônus ausência recusado',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'FALTA')$q$,pg_temp.id_de('2','2026-03-15'))),'erro 55000');
-- Fronteiras independentes: valores literais em centavos, não calculados pelo núcleo sob teste.
do $$
declare r record; obt numeric; custo numeric;
begin
 for r in select * from (values (14,1517,467),(15,1625,500),(16,1733,533),(44,4767,1467),(45,4875,1500),(46,4983,1533),(59,6392,1967),(60,6500,2000),(74,8017,2467),(75,8125,2500),(105,11375,3500)) v(m,c,cp)
 loop
  perform pg_temp.save('exact-'||r.m,'2026-03-22','1','06:00',(time '06:00'+r.m*interval '1 minute')::text);
  select billed_amount*100,cost_amount*100 into strict obt,custo from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-22');
  perform pg_temp.assert_eq('24 minutos exatos '||r.m,obt::text||'|'||custo::text,r.c::numeric(12,2)::text||'|'||r.cp::numeric(12,2)::text);
 end loop;
end; $$;
-- Nova versão: modo especial independente do modo acumulado da HE comum.
select pg_temp.adm($q$select public.registrar_condicao_contrato_especial('5c42d000-0000-4000-8000-0000000000d1','2026-04-01',100,8,1.5,10,'ARREDONDAMENTO_TESTE',null,true,'acumulado',4,2,'quinzenal','meia_hora_15_45')$q$);
select pg_temp.assert_eq('25 nova condição especial e configuração independente',
 (select special_rounding_mode||'|'||ot_rounding_mode from public.contract_terms where contract_id='5c42d000-0000-4000-8000-0000000000d1' and valid_from='2026-04-01'), 'meia_hora_15_45|acumulado');
select pg_temp.assert_eq('26 domínio na RPC',pg_temp.adm($q$select public.registrar_condicao_contrato_especial('5c42d000-0000-4000-8000-0000000000d1','2030-01-01',100,8,1.5,10,'INVALIDO',null,false,'diario',null,null,null,'invalido')$q$),'erro 22023');
select pg_temp.assert_eq('27 versão imutável mesmo para dono', pg_temp.erro_de($q$update public.contract_terms set special_rounding_mode='minutos' where contract_id='5c42d000-0000-4000-8000-0000000000d1' and valid_from='2026-04-01'$q$),'erro 42501');
do $$
declare r record; e public.timesheet_entries%rowtype;
begin
 for r in select * from (values (14,0,467),(15,3250,500),(16,3250,533),(44,3250,1467),(45,6500,1500),(46,6500,1533),(59,6500,1967),(60,6500,2000),(74,6500,2467),(75,9750,2500),(105,13000,3500)) v(m,c,cp)
 loop
  perform pg_temp.save('rounded-'||r.m,'2026-04-05','1','06:00',(time '06:00'+r.m*interval '1 minute')::text);
  select * into strict e from public.timesheet_entries where id=pg_temp.id_de('1','2026-04-05');
  perform pg_temp.assert_eq('28 fronteira 15/45 '||r.m,(e.billed_amount*100)::text||'|'||(e.cost_amount*100)::text,r.c::numeric(12,2)::text||'|'||r.cp::numeric(12,2)::text);
  perform pg_temp.assert_eq('29 zero base/HE mesmo com modo comum acumulado '||r.m,(e.billed_base_amount=0 and e.billed_overtime_amount=0 and e.billed_overtime_minutes=0 and e.overtime_minutes=0)::text,'true');
 end loop;
end; $$;
-- Resolução OFF: bônus recusado e domingo novo continua legado.
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(false,'OFF_TESTE')$q$);
select pg_temp.assert_eq('30 bônus OFF recusado',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'OFF_TESTE',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 55000');
select pg_temp.save('legacy-sunday','2026-05-03','1','06:00','07:00');
select pg_temp.assert_eq('31 OFF não força V2 especial', (select (calc_version is null and day_kind_snapshot='util' and billed_special_amount is null and additional_amount=0)::text from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-03')),'true');
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(true,'ON_TESTE')$q$);
select pg_temp.assert_eq('32 bônus em legado recusado mesmo ON',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'LEGADO_TESTE')$q$,pg_temp.id_de('1','2026-05-03'))),'erro 55000');
-- Uma edição motriz explícita converte legado elegível e resolve o preço vigente.
select pg_temp.save('legacy-conversion','2026-05-03','1','06:00','08:00');
select pg_temp.assert_eq('56 converter legado não usa diária genérica com resolução ON',
 (select billed_amount::text||'|'||daily_rate_snapshot||'|'||price_source||'|'||calc_version from public.timesheet_entries where id=pg_temp.id_de('1','2026-05-03')),
 '130.00|260.00|individual|2');
-- Segurança: identidades sintéticas e sessões locais. Sem mudança de política MFA.
insert into auth.users(id) values ('5c420000-0000-4000-8000-0000000000a3');
insert into auth.sessions(id,user_id) values ('ec420000-0000-4000-8000-0000000000a3','5c420000-0000-4000-8000-0000000000a3');
select pg_temp.assert_eq('33 operacional não define bônus',pg_temp.ope(format($q$select public.definir_bonus_do_apontamento(%L,30,'NEGADO',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
select pg_temp.assert_eq('34 anon não executa bônus',pg_temp.anon(format($q$select public.definir_bonus_do_apontamento(%L,30,'NEGADO',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
select pg_temp.assert_eq('35 sem papel não define bônus',pg_temp.medir_como('authenticated',jsonb_build_object('sub','5c420000-0000-4000-8000-0000000000a3','session_id','ec420000-0000-4000-8000-0000000000a3','aal','aal1'),format($q$select public.definir_bonus_do_apontamento(%L,30,'NEGADO',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
select pg_temp.assert_eq('36 sessão inválida nega',pg_temp.medir_como('authenticated',jsonb_build_object('sub','5c420000-0000-4000-8000-0000000000a1','aal','aal2'),format($q$select public.definir_bonus_do_apontamento(%L,30,'NEGADO',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,friendly_name,created_at,updated_at) values ('5c420000-0000-4000-8000-0000000000f1','5c420000-0000-4000-8000-0000000000a1','totp','verified','SINTETICO_NAO_UTILIZAVEL','MFA_TESTE',now(),now());
select pg_temp.assert_eq('37 admin AAL1 com fator nega',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'NEGADO',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
select pg_temp.assert_eq('38 admin AAL2 com fator autoriza',
 (pg_temp.medir_como('authenticated',jsonb_build_object('sub','5c420000-0000-4000-8000-0000000000a1','session_id','ec420000-0000-4000-8000-0000000000a1','aal','aal2'),format($q$select public.definir_bonus_do_apontamento(%L,30,'AAL2_TESTE',true)$q$,pg_temp.id_de('1','2026-03-01'))) not like 'erro %')::text,'true');
-- Remove somente o fator sintético para continuar como admin sem fator (AAL1).
delete from auth.mfa_factors where id='5c420000-0000-4000-8000-0000000000f1';
select pg_temp.assert_eq('39 grants mínimos nova RPC',
 (has_function_privilege('authenticated','public.registrar_condicao_contrato_especial(uuid,date,numeric,numeric,numeric,integer,text,date,boolean,text,numeric,numeric,text,text)','EXECUTE') and not has_function_privilege('anon','public.registrar_condicao_contrato_especial(uuid,date,numeric,numeric,numeric,integer,text,date,boolean,text,numeric,numeric,text,text)','EXECUTE') and not has_function_privilege('bslog_rpc_operacional','public.registrar_condicao_contrato_especial(uuid,date,numeric,numeric,numeric,integer,text,date,boolean,text,numeric,numeric,text,text)','EXECUTE'))::text,'true');
select pg_temp.assert_eq('40 RLS impede leitura do operacional',pg_temp.ope('select count(*)::text from public.timesheet_entries'),'0');
select pg_temp.assert_eq('41 componentes somam total em centavos', (select bool_and(round((billed_base_amount+billed_overtime_amount+billed_special_amount+additional_amount)*100)=round(billed_amount*100))::text from public.timesheet_entries where calc_version=2),'true');
-- Centavo fracionário e mudança de vigência de custo: oráculos independentes.
select pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1',%L,'2026-01-01',260.02,'MONETARIO_TESTE')$q$,pg_temp.emp('3')));
select pg_temp.save('half-cent','2026-03-01','3','06:00','07:00');
select pg_temp.assert_eq('50 arredondamento monetário 260,02 / 4 = 65,005 arredonda 65,01',
 (select billed_amount::text from public.timesheet_entries where id=pg_temp.id_de('3','2026-03-01')),'65.01');
select pg_temp.adm(format($q$select public.registrar_custo_colaborador(%L,'2026-06-01',96,'CUSTO_FUTURO_TESTE',null,true)$q$,pg_temp.emp('1')));
select pg_temp.save('cost-version','2026-06-07','1','06:00','07:00');
select pg_temp.assert_eq('51 custo usa vigência própria na data e preço continua 260',
 (select billed_amount::text||'|'||cost_amount||'|'||daily_cost_snapshot||'|'||daily_rate_snapshot from public.timesheet_entries where id=pg_temp.id_de('1','2026-06-07')),'65.00|24.00|96.00|260.00');
select pg_temp.assert_eq('52 snapshot anterior mantém custo 80 e especial 20',
 (select daily_cost_snapshot::text||'|'||cost_amount from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01')),'80.00|20.00');
select pg_temp.adm($q$select public.corrigir_condicao_contrato((select id from public.contract_terms where contract_id='5c42d000-0000-4000-8000-0000000000d1' and valid_from='2026-04-01' and active),'2026-04-01',null,100,8,1.5,10,'CORRECAO_MODO_TESTE','acumulado',4,2)$q$);
select pg_temp.assert_eq('53 correção pela assinatura antiga preserva modo especial',
 (select special_rounding_mode from public.contract_terms where contract_id='5c42d000-0000-4000-8000-0000000000d1' and valid_from='2026-04-01' and active),'meia_hora_15_45');
select pg_temp.assert_eq('54 nova RPC revalida papel operacional',pg_temp.ope($q$select public.registrar_condicao_contrato_especial('5c42d000-0000-4000-8000-0000000000d1','2031-01-01',100,8,1.5,10,'NEGADO')$q$),'erro 42501');
select pg_temp.assert_eq('55 nova RPC recusa anon',pg_temp.anon($q$select public.registrar_condicao_contrato_especial('5c42d000-0000-4000-8000-0000000000d1','2031-01-01',100,8,1.5,10,'NEGADO')$q$),'erro 42501');
-- Fatura, imutabilidade e snapshots históricos.
select pg_temp.exec('invoice', $q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1','2026-03-01','2026-03-15')).id::text$q$);
select pg_temp.assert_eq('42 fatura gerada', (pg_temp.r('invoice') ~ '^[0-9a-f-]{36}$')::text,'true');
select pg_temp.assert_eq('43 soma itens = fatura centavo a centavo', (select (i.total_amount*100=(select sum(it.amount*100) from public.invoice_items it where it.invoice_id=i.id))::text from public.invoices i where id=pg_temp.r('invoice')::uuid),'true');
select pg_temp.assert_eq('44 especial e bônus separados na fatura', (select (count(*) filter(where kind='horas_especiais')>0 and count(*) filter(where kind='adicional_diario')>0 and count(*) filter(where kind in ('diarias','horas_extras','arredondamento'))=0)::text from public.invoice_items where invoice_id=pg_temp.r('invoice')::uuid),'true');
create temporary table _frozen as select id,to_jsonb(te) as j from public.timesheet_entries te where invoice_id=pg_temp.r('invoice')::uuid;
do $$
declare col text; v text;
begin
 for col,v in select * from (values ('check_in',quote_literal('05:00')),('check_out',quote_literal('09:00')),('break_minutes','0'),('cost_amount','999'),('billed_amount','999'),('additional_amount','999'),('day_kind_snapshot',quote_literal('util')),('daily_rate_snapshot','999'),('daily_cost_snapshot','999'),('price_source',quote_literal('funcao_periodo')),('contract_employee_rate_id','null'),('contract_terms_id','null'),('employee_cost_terms_id','null'),('job_function_id_snapshot','null'),('shift_period_snapshot','null'),('calc_version','null'),('invoice_id','null')) x(c,v)
 loop
  perform pg_temp.assert_eq('45 faturado imutável: '||col,pg_temp.adm(format('update public.timesheet_entries set %I=%s where id=%L',col,v,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
 end loop;
end; $$;
select pg_temp.assert_eq('46 lastro não se exclui',pg_temp.adm(format('delete from public.timesheet_entries where id=%L',pg_temp.id_de('1','2026-03-01'))),'erro 42501');
select pg_temp.assert_eq('47 bônus faturado recusado',pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,40,'FATURADO',true)$q$,pg_temp.id_de('1','2026-03-01'))),'erro 55000');
select pg_temp.adm($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1','5c42f000-0000-4000-8000-000000000001','2026-07-01',300,'FUTURO_TESTE',null,true)$q$);
select pg_temp.adm($q$select public.aposentar_feriado((select id from public.financial_holidays where holiday_date='2026-03-02' and active),'FUTURO_CALENDARIO_TESTE')$q$);
select pg_temp.assert_eq('48 futuro preço/calendário/modo não reprecifica faturados', (select bool_and(to_jsonb(te)=f.j)::text from _frozen f join public.timesheet_entries te using(id)),'true');
select pg_temp.assert_eq('49 auditoria bônus presente', (select (count(*)>=4)::text from public.financial_terms_audit where action='apontamento_bonus_definido'),'true');
select pg_temp.exec('invoice-rounded',$q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1','2026-04-01','2026-04-15')).id::text$q$);
select pg_temp.assert_eq('57 especial com arredondamento e HE acumulada não cria ajuste extra',
 (select total_amount::text||'|'||(select sum(amount)::text from public.invoice_items where invoice_id=i.id)||'|'||(select count(*)::text from public.invoice_items where invoice_id=i.id and kind='arredondamento') from public.invoices i where id=pg_temp.r('invoice-rounded')::uuid),
 '130.00|130.00|0');
rollback;
