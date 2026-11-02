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


-- R1: esta asserção falha se a RPC antiga voltar ao default em vez de herdar a versão anterior.
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception '%: esperado %, obtido %', caso, esperado, coalesce(obtido, '<NULL>');
  end if;
  raise notice 'PASS: %', caso;
end; $$;
create function pg_temp.condicao(k text, contrato text, inicio date, modo text default null,
  fim date default null, encerrar boolean default false) returns void language plpgsql as $$
declare r text;
begin
  if modo is null then
    r := pg_temp.adm(format($q$select public.registrar_condicao_contrato(%L,%L,110,8,1.5,10,%L,%L,%L)::text$q$,
      contrato,inicio,'R1_TESTE_'||k,fim,encerrar));
  else
    r := pg_temp.adm(format($q$select public.registrar_condicao_contrato_especial(%L,%L,110,8,1.5,10,%L,%L,%L,
      'diario',4,2,'quinzenal',%L)::text$q$,contrato,inicio,'R1_TESTE_'||k,fim,encerrar,modo));
  end if;
  if r !~ '^[0-9a-f-]{36}$' then raise exception 'Fixture condição % recusada: %',k,r; end if;
  insert into _exec values(k,r);
end; $$;
select pg_temp.assert_eq('F0 motor local ligado',public.motor_ativo()::text,'true');
select pg_temp.condicao('A','5c42d000-0000-4000-8000-0000000000d1','2026-04-01','meia_hora_15_45',null,true);
create temporary table _anterior as select to_jsonb(t)-'valid_to' as j from public.contract_terms t where id=pg_temp.r('A')::uuid;
select pg_temp.condicao('B','5c42d000-0000-4000-8000-0000000000d1','2026-08-01',null,null,true);
select pg_temp.assert_eq('R1 reajuste pela RPC antiga herda 15/45',
  (select special_rounding_mode from public.contract_terms where id=pg_temp.r('B')::uuid),'meia_hora_15_45');
select pg_temp.assert_eq('R1 versão anterior preservada, exceto encerramento autorizado',
  (select ((to_jsonb(t)-'valid_to')=(select j from _anterior))::text from public.contract_terms t where id=pg_temp.r('A')::uuid),'true');
select pg_temp.condicao('MIN','5c42d000-0000-4000-8000-0000000000d2','2026-04-01',null,null,true);
select pg_temp.assert_eq('R1 reajuste herda minutos',
  (select special_rounding_mode from public.contract_terms where id=pg_temp.r('MIN')::uuid),'minutos');
insert into public.contracts(id,client_id,name,daily_rate,shift_hours,ot_factor,ot_tolerance_min) values
 ('5c42d000-0000-4000-8000-0000000000d3','5c42c000-0000-4000-8000-0000000000c1','CONTRATO_TESTE_SEM_ANTERIOR',100,8,1.5,10),
 ('5c42d000-0000-4000-8000-0000000000d4','5c42c000-0000-4000-8000-0000000000c1','CONTRATO_TESTE_RETROATIVO',100,8,1.5,10);
select pg_temp.condicao('SEM','5c42d000-0000-4000-8000-0000000000d3','2026-01-01');
select pg_temp.assert_eq('R1 contrato sem anterior usa minutos',
  (select special_rounding_mode from public.contract_terms where id=pg_temp.r('SEM')::uuid),'minutos');
select pg_temp.condicao('RETRO0','5c42d000-0000-4000-8000-0000000000d4','2025-10-01','minutos','2026-01-01');
select pg_temp.condicao('RETRO1','5c42d000-0000-4000-8000-0000000000d4','2026-01-01','meia_hora_15_45','2026-03-01');
select pg_temp.condicao('FUTURA','5c42d000-0000-4000-8000-0000000000d4','2026-09-01','minutos');
select pg_temp.condicao('RETRO','5c42d000-0000-4000-8000-0000000000d4','2026-03-01',null,'2026-09-01');
select pg_temp.assert_eq('R1 retroativa herda imediatamente anterior, não a futura nem a mais antiga',
  (select special_rounding_mode from public.contract_terms where id=pg_temp.r('RETRO')::uuid),'meia_hora_15_45');
select pg_temp.condicao('EXPLICITA','5c42d000-0000-4000-8000-0000000000d1','2026-10-01','minutos',null,true);
select pg_temp.assert_eq('R1 RPC nova continua aceitando escolha explícita',
  (select special_rounding_mode from public.contract_terms where id=pg_temp.r('EXPLICITA')::uuid),'minutos');
select pg_temp.exec('CORR',format($q$select public.corrigir_condicao_contrato(%L,'2026-08-01','2026-10-01',110,8,1.5,10,'R1_CORRECAO')::text$q$,pg_temp.r('B')));
select pg_temp.assert_eq('R1 correção contratual continua preservando modo',
  (select special_rounding_mode from public.contract_terms where id=pg_temp.r('CORR')::uuid),'meia_hora_15_45');
-- R3: recálculo de especial V2 com resolução OFF nunca pode converter nem apagar bônus.
select pg_temp.adm(format($q$select public.registrar_diaria_individual('5c42d000-0000-4000-8000-0000000000d1',%L,'2026-01-01',260,'R3_INDIVIDUAL')$q$,pg_temp.emp('1')));
select pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d1',%L,'diurno','2026-01-01',250,'R3_PADRAO')$q$,pg_temp.fn('conferente')));
select pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c42d000-0000-4000-8000-0000000000d2',%L,'diurno','2026-01-01',300,'R3_PADRAO_B')$q$,pg_temp.fn('conferente')));
select pg_temp.adm($q$select public.registrar_feriado('2026-03-02','FERIADO_TESTE_R3','FERIADO_TESTE_R3')$q$);
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(true,'R3_ON')$q$);
select pg_temp.assert_eq('R3 fixture resolução ON',public.resolucao_de_tarifas_ativa()::text,'true');
select pg_temp.salvar('R3_DOM','a1','a1','2026-03-01','1','08:00');
select pg_temp.salvar('R3_FER','a1','a1','2026-03-02','1','08:00');
select pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'R3_BONUS')$q$,pg_temp.id_de('1','2026-03-01')));
select pg_temp.adm(format($q$select public.definir_bonus_do_apontamento(%L,30,'R3_BONUS')$q$,pg_temp.id_de('1','2026-03-02')));
select pg_temp.assert_eq('R3 fixture domingo V2 e bônus 30',
 (select billed_amount::text||'|'||cost_amount||'|'||billed_special_amount||'|'||additional_amount||'|'||calc_version
  from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01')),'95.00|20.00|65.00|30.00|2');
create function pg_temp.financeiro(e uuid) returns jsonb language sql as $$
 select to_jsonb(t)-array['notes','updated_at'] from public.timesheet_entries t where id=e
$$;
create temporary table _r3_antes as select id,pg_temp.financeiro(id) as j from public.timesheet_entries
 where id in (pg_temp.id_de('1','2026-03-01'),pg_temp.id_de('1','2026-03-02'));
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(false,'R3_OFF')$q$);
select pg_temp.assert_eq('R3 fixture resolução OFF',public.resolucao_de_tarifas_ativa()::text,'false');
select pg_temp.exec('R3_EDIT_OFF',format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-01')));
do $$
declare e public.timesheet_entries%rowtype;
begin
 if pg_temp.r('R3_EDIT_OFF') <> 'erro 55000' then
  select * into strict e from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01');
  raise exception 'R3 RED edição especial OFF: esperado erro 55000; obtido %, calc_version %, bonus %, cobrado %',
    pg_temp.r('R3_EDIT_OFF'),coalesce(e.calc_version::text,'NULL'),e.additional_amount,e.billed_amount;
 end if;
 perform pg_temp.assert_eq('R3a rejeita horário e preserva todos os valores e snapshots',
  (select bool_and(pg_temp.financeiro(id)=j)::text from _r3_antes),'true');
end; $$;
do $$
declare e record; mudanca text;
begin
 for e in select id from _r3_antes loop
  foreach mudanca in array array['check_in=''05:00''','check_out=''10:00''','break_minutes=0',
     'status=''absent''','employee_id=''5c42f000-0000-4000-8000-000000000003'''] loop
   perform pg_temp.assert_eq('R3a domingo/feriado bloqueia '||mudanca,
    pg_temp.adm(format('update public.timesheet_entries set %s where id=%L',mudanca,e.id)),'erro 55000');
   perform pg_temp.assert_eq('R3a rejeição não altera valores, versão, bônus nem proveniência',
    (select bool_and(pg_temp.financeiro(id)=j)::text from _r3_antes),'true');
  end loop;
 end loop;
end; $$;
select pg_temp.adm(format($q$update public.timesheet_entries set notes='R3_NOTA_SEM_RECALCULO' where id=%L$q$,pg_temp.id_de('1','2026-03-01')));
select pg_temp.assert_eq('R3b notas permitidas com financeiro intacto',
 (select (notes='R3_NOTA_SEM_RECALCULO' and pg_temp.financeiro(t.id)=a.j)::text from public.timesheet_entries t
  join _r3_antes a using(id) where t.id=pg_temp.id_de('1','2026-03-01')),'true');
select pg_temp.salvar('R3_LEGADO','a1','a1','2026-03-15','1','08:00');
select pg_temp.assert_eq('R3d fixture legado nasce OFF',
 (select (calc_version is null and additional_amount=0)::text from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-15')),'true');
select pg_temp.salvar('R3_UTIL','a1','a1','2026-03-17','1','08:00');
select pg_temp.salvar('R3_SABADO','a1','a1','2026-03-21','1','08:00');
select pg_temp.adm(format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-17')));
select pg_temp.adm(format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-21')));
select pg_temp.assert_eq('R3f útil OFF mantém 042',
 (select billed_amount::text||'|'||cost_amount||'|'||billed_special_amount||'|'||additional_amount||'|'||calc_version from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-17')),'25.00|20.00|0.00|0.00|2');
select pg_temp.assert_eq('R3f sábado OFF mantém 042',
 (select billed_amount::text||'|'||cost_amount||'|'||billed_special_amount||'|'||additional_amount||'|'||calc_version from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-21')),'100.00|80.00|0.00|0.00|2');
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(true,'R3_RELIGAR')$q$);
select pg_temp.adm(format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-01')));
select pg_temp.adm(format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-02')));
select pg_temp.assert_eq('R3c religar recalcula domingo e mantém bônus 30',
 (select billed_amount::text||'|'||cost_amount||'|'||billed_special_amount||'|'||additional_amount||'|'||calc_version from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-01')),'160.00|40.00|130.00|30.00|2');
select pg_temp.assert_eq('R3c religar recalcula feriado e mantém bônus 30',
 (select billed_amount::text||'|'||cost_amount||'|'||billed_special_amount||'|'||additional_amount||'|'||calc_version from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-02')),'160.00|40.00|130.00|30.00|2');
select pg_temp.adm(format($q$update public.timesheet_entries set check_out='09:00' where id=%L$q$,pg_temp.id_de('1','2026-03-15')));
select pg_temp.assert_eq('R3d legado OFF continua convertendo para V2 depois de ligar',
 (select billed_amount::text||'|'||daily_rate_snapshot||'|'||price_source||'|'||calc_version from public.timesheet_entries where id=pg_temp.id_de('1','2026-03-15')),'130.00|260.00|individual|2');
select pg_temp.exec('R3_FATURA',$q$select (public.gerar_fatura('5c42c000-0000-4000-8000-0000000000c1','2026-03-01','2026-03-15')).id::text$q$);
select pg_temp.assert_eq('R3e fixture fatura gerada',(pg_temp.r('R3_FATURA') ~ '^[0-9a-f-]{36}$')::text,'true');
create temporary table _r3_faturados as select id,pg_temp.financeiro(id) as j from public.timesheet_entries where invoice_id=pg_temp.r('R3_FATURA')::uuid;
select pg_temp.adm($q$select public.alterar_resolucao_tarifas(false,'R3_OFF_FATURADO')$q$);
select pg_temp.assert_eq('R3e faturado continua imutável OFF',pg_temp.adm(format($q$update public.timesheet_entries set check_out='10:00' where id=%L$q$,pg_temp.id_de('1','2026-03-01'))),'erro 42501');
select pg_temp.assert_eq('R3e todos os faturados preservados',
 (select bool_and(pg_temp.financeiro(id)=j)::text from _r3_faturados),'true');

-- R2: somente cobertura da RPC nova. A guarda e a política de MFA não mudam.
insert into auth.users(id) values ('5c420000-0000-4000-8000-0000000000a3');
insert into auth.sessions(id,user_id) values ('ec420000-0000-4000-8000-0000000000a3','5c420000-0000-4000-8000-0000000000a3');
insert into public.contracts(id,client_id,name,daily_rate,shift_hours,ot_factor,ot_tolerance_min)
 select ('5c42d000-0000-4000-8000-0000000000f'||n)::uuid,'5c42c000-0000-4000-8000-0000000000c1',
  'CONTRATO_TESTE_R2_'||n,100,8,1.5,10 from generate_series(1,7) n;
create function pg_temp.r2_claims(ator text,aal text) returns jsonb language sql as $$
 select jsonb_build_object('sub','5c420000-0000-4000-8000-0000000000a'||ator,'role','authenticated',
  'aal',aal,'session_id','ec420000-0000-4000-8000-0000000000a'||ator)
$$;
create function pg_temp.r2_sql(n integer,caso text) returns text language sql as $$
 select format($q$select public.registrar_condicao_contrato_especial(%L,'2026-01-01',100,8,1.5,10,%L,
  null,false,'diario',4,2,'quinzenal','meia_hora_15_45')::text$q$,'5c42d000-0000-4000-8000-0000000000f'||n,caso)
$$;
create function pg_temp.r2_snapshot() returns jsonb language sql as $$
 select jsonb_build_object('versoes',(select jsonb_agg(to_jsonb(t) order by id) from public.contract_terms t),
  'auditoria',(select jsonb_agg(to_jsonb(a) order by id) from public.financial_terms_audit a))
$$;
create function pg_temp.r2_recusar(caso text,n integer,papel text,claims jsonb) returns void language plpgsql as $$
declare antes jsonb := pg_temp.r2_snapshot(); r text;
begin
 r := pg_temp.medir_como(papel,claims,pg_temp.r2_sql(n,caso));
 perform pg_temp.assert_eq(caso||' retorna 42501',r,'erro 42501');
 perform pg_temp.assert_eq(caso||' nenhuma versão criada',
  (select count(*)::text from public.contract_terms where contract_id=('5c42d000-0000-4000-8000-0000000000f'||n)::uuid),'0');
 perform pg_temp.assert_eq(caso||' nenhuma linha de auditoria criada',
  (select count(*)::text from public.financial_terms_audit where reason=caso),'0');
 perform pg_temp.assert_eq(caso||' versões e trilha inteiras inalteradas',(pg_temp.r2_snapshot()=antes)::text,'true');
end; $$;
create function pg_temp.r2_permitir(caso text,n integer,claims jsonb) returns void language plpgsql as $$
declare r text;
begin
 r := pg_temp.medir_como('authenticated',claims,pg_temp.r2_sql(n,caso));
 perform pg_temp.assert_eq(caso||' retorna versão',(r ~ '^[0-9a-f-]{36}$')::text,'true');
 perform pg_temp.assert_eq(caso||' cria uma versão com modo e autor corretos',
  (select count(*)::text from public.contract_terms where contract_id=('5c42d000-0000-4000-8000-0000000000f'||n)::uuid
   and id=r::uuid and special_rounding_mode='meia_hora_15_45' and created_by='5c420000-0000-4000-8000-0000000000a1'),'1');
 perform pg_temp.assert_eq(caso||' cria uma auditoria com ator e sessão',
  (select count(*)::text from public.financial_terms_audit where reason=caso and action='contrato_condicao_registrada'
   and term_id=r::uuid and actor_id='5c420000-0000-4000-8000-0000000000a1'
   and actor_session_id='ec420000-0000-4000-8000-0000000000a1'),'1');
end; $$;
select pg_temp.r2_permitir('R2_ADMIN_AAL1_SEM_FATOR',1,pg_temp.r2_claims('1','aal1'));
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,friendly_name,created_at,updated_at) values
 ('5c420000-0000-4000-8000-0000000000f1','5c420000-0000-4000-8000-0000000000a1','totp','verified',
  'SINTETICO_NAO_UTILIZAVEL','R2_FATOR_TESTE',now(),now());
select pg_temp.r2_recusar('R2_ADMIN_AAL1_COM_FATOR',2,'authenticated',pg_temp.r2_claims('1','aal1'));
select pg_temp.r2_permitir('R2_ADMIN_AAL2_COM_FATOR',3,pg_temp.r2_claims('1','aal2'));
select pg_temp.r2_recusar('R2_OPERACIONAL',4,'authenticated',pg_temp.r2_claims('2','aal1'));
select pg_temp.r2_recusar('R2_SEM_PAPEL',5,'authenticated',pg_temp.r2_claims('3','aal1'));
select pg_temp.r2_recusar('R2_ANON',6,'anon',jsonb_build_object('role','anon'));
select pg_temp.r2_recusar('R2_SESSAO_INVALIDA',7,'authenticated',pg_temp.r2_claims('1','aal2')||jsonb_build_object('session_id',null));

rollback;
