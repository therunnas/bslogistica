-- Migration 041 — tarifas por contrato + função + período do turno + vigência (FIN-PR-07, etapas 4 a 7).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que
-- termina em `rollback`. NUNCA rodar contra Production nem homologação. Dados sintéticos.
--
-- Valores esperados CALCULADOS À MÃO com números redondos:
--   diária 160 -> hora 160/8 x 1,5 = 30,00; 20 min de excesso cobram 30 min = 15,00
--   diária 200 -> hora 37,50; 30 min = 18,75     diária 120 -> hora 22,50; 30 min = 11,25
--   diária 144 -> hora 27,00; 30 min = 13,50     diária 176 -> hora 33,00; 30 min = 16,50
--
-- O QUE ESTE ARQUIVO PROVA
--   T  tarifa: cadastro, validação, vigências, sobreposição, uso, correção/encerramento/aposentadoria
--   D  resolução DESLIGADA: nenhum valor muda (estado inicial)
--   R  resolução LIGADA: diurno, noturno, duas funções no mesmo turno, mesma função em turnos
--      diferentes, reajuste (dia anterior e dia exato), pendências explícitas (sem função, turno sem
--      classificação, sem tarifa), operação sem contrato
--   M  motor V2 preservado: diária, HE 1,5 com 15/45, sábado de 4 h; custo independente do preço
--   F  fatura: duas tarifas, Σ itens = total, fatura histórica e faturado imutáveis
--   C  correção de apontamento não faturado recalcula pela combinação corrigida, com trilha
--   P  permissões: admin, operacional, anon; escrita direta recusada

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
    jsonb_build_object('sub', '5c410000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec410000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c410000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec410000-0000-4000-8000-0000000000a2'), _sql)
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
create or replace function pg_temp.exec_ope(_k text, _sql text) returns void language sql as $$
  insert into _exec values (_k, pg_temp.ope(_sql))
$$;
create or replace function pg_temp.r(_k text) returns text language sql as $$
  select r from _exec where k = _k
$$;
create or replace function pg_temp.fn(_codigo text) returns uuid language sql as $$
  select id from public.job_functions where code = _codigo
$$;

-- ---------------------------------------------------------------------------
-- Fixture (motor ligado, resolução desligada)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c410000-0000-4000-8000-0000000000a1'), ('5c410000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec410000-0000-4000-8000-0000000000a1', '5c410000-0000-4000-8000-0000000000a1', null),
  ('ec410000-0000-4000-8000-0000000000a2', '5c410000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c410000-0000-4000-8000-0000000000a1', 'admin'), ('5c410000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c41c000-0000-4000-8000-0000000000c1', 'C01');
-- Contrato com diária GENÉRICA 100 (a de antes), fator 1,5, jornada 8 h.
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c41d000-0000-4000-8000-0000000000d1', '5c41c000-0000-4000-8000-0000000000c1', 'K1', 100, 8, 1.5, 10);
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor) values
  ('5c41d000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1.5, 10, true, 'informada', 'TAR', 'diario', 4, 2);
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c41e000-0000-4000-8000-0000000000a1', '5c41c000-0000-4000-8000-0000000000c1', '5c41d000-0000-4000-8000-0000000000d1', 'OP1', null),
  ('5c41e000-0000-4000-8000-0000000000a2', '5c41c000-0000-4000-8000-0000000000c1', null, 'OP-SEM-CONTRATO', 200);
insert into public.operation_terms (operation_id, valid_from, agreed_amount, active, origin, reason) values
  ('5c41e000-0000-4000-8000-0000000000a2', date '2026-01-01', 200, true, 'informada', 'TAR');
-- S1 diurno, S2 noturno (cruza a meia-noite), S3 SEM classificação, S4 diurno da operação sem contrato.
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight, shift_period) values
  ('5c41a000-0000-4000-8000-0000000000a1', '5c41e000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60, false, 'diurno'),
  ('5c41a000-0000-4000-8000-0000000000a2', '5c41e000-0000-4000-8000-0000000000a1', 'S2', '22:00', '07:00', 60, true, 'noturno'),
  ('5c41a000-0000-4000-8000-0000000000a3', '5c41e000-0000-4000-8000-0000000000a1', 'S3', '06:00', '15:00', 60, false, null),
  ('5c41a000-0000-4000-8000-0000000000a4', '5c41e000-0000-4000-8000-0000000000a2', 'S4', '06:00', '15:00', 60, false, 'diurno');
insert into public.employees (id, name, daily_cost) values
  ('5c41f000-0000-4000-8000-000000000001', 'TAR-E1', 80), ('5c41f000-0000-4000-8000-000000000002', 'TAR-E2', 80),
  ('5c41f000-0000-4000-8000-000000000003', 'TAR-E3', 80), ('5c41f000-0000-4000-8000-000000000004', 'TAR-E4', 80),
  ('5c41f000-0000-4000-8000-000000000005', 'TAR-E5', 80), ('5c41f000-0000-4000-8000-000000000006', 'TAR-E6', 80);
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select e.id, date '2026-01-01', 80, true, 'informada', 'TAR' from public.employees e where e.name like 'TAR-E%';
-- Alocações: E1 conferente, E2 operador, E3 SEM função, E4 auxiliar (função sem tarifa), E5 conferente na op. sem contrato.
insert into public.operation_team (operation_id, shift_id, employee_id, job_function_id) values
  ('5c41e000-0000-4000-8000-0000000000a1', '5c41a000-0000-4000-8000-0000000000a1', '5c41f000-0000-4000-8000-000000000001', (select id from public.job_functions where code = 'conferente')),
  ('5c41e000-0000-4000-8000-0000000000a1', null, '5c41f000-0000-4000-8000-000000000002', (select id from public.job_functions where code = 'operador')),
  ('5c41e000-0000-4000-8000-0000000000a1', '5c41a000-0000-4000-8000-0000000000a1', '5c41f000-0000-4000-8000-000000000003', null),
  ('5c41e000-0000-4000-8000-0000000000a1', null, '5c41f000-0000-4000-8000-000000000004', (select id from public.job_functions where code = 'auxiliar_producao')),
  ('5c41e000-0000-4000-8000-0000000000a2', null, '5c41f000-0000-4000-8000-000000000005', (select id from public.job_functions where code = 'conferente'));
insert into public.user_operation_access (user_id, operation_id)
  values ('5c410000-0000-4000-8000-0000000000a2', '5c41e000-0000-4000-8000-0000000000a1');

set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste TAR') ->> 'ativo')$q$));

-- Salva uma linha (como a tela). _fn = função informada (ou ''); _ent = entrada.
create or replace function pg_temp.salvar(_k text, _op text, _turno text, _data date, _emp text, _saida text, _fn text default '', _ent text default '06:00') returns void
language sql as $$
  select pg_temp.exec(_k, format($q$select public.salvar_apontamento_admin('5c41e000-0000-4000-8000-0000000000%s', %s, %L,
    jsonb_build_array(jsonb_build_object('employee_id', '5c41f000-0000-4000-8000-00000000000%s', 'status', 'present',
      'check_in', %L, 'check_out', %L, 'break_minutes', 60) || case when %L = '' then '{}'::jsonb else jsonb_build_object('job_function_id', %L) end))::text$q$,
    _op, case when _turno = '' then 'null' else quote_literal('5c41a000-0000-4000-8000-0000000000' || _turno) end, _data, _emp, _ent, _saida, _fn, _fn))
$$;
-- billed|minutos HE cobrados|diária congelada|tarifa
create or replace function pg_temp.v(_emp text, _data date) returns text language sql as $$
  select te.billed_amount::text || '|' || coalesce(te.billed_overtime_minutes::text, '-') || '|' || te.daily_rate_snapshot::text
         || '|' || case when te.contract_rate_terms_id is null then 'generica' else 'tarifa' end
    from public.timesheet_entries te
   where te.employee_id = ('5c41f000-0000-4000-8000-00000000000' || _emp)::uuid and te.work_date = _data
$$;

-- ---------------------------------------------------------------------------
-- T. Tarifas
-- ---------------------------------------------------------------------------

create or replace function pg_temp.tarifa(_k text, _fn text, _per text, _de date, _valor numeric, _enc boolean default false) returns void language sql as $$
  select pg_temp.exec(_k, format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, %L, %L, %s, 'Tarifa TAR', null, %L)::text$q$,
    pg_temp.fn(_fn), _per, _de, _valor, _enc))
$$;
select pg_temp.tarifa('t1', 'conferente', 'diurno', date '2026-01-01', 160);
select pg_temp.tarifa('t2', 'conferente', 'noturno', date '2026-01-01', 200);
select pg_temp.tarifa('t3', 'operador', 'diurno', date '2026-01-01', 120);
select pg_temp.tarifa('t4', 'operador', 'noturno', date '2026-01-01', 144);
select pg_temp.registrar('T1. quatro tarifas cadastradas (conferente e operador, diurno e noturno), ativas, com origem e autor',
  '4|4|informada|true',
  (select count(*)::text || '|' || count(*) filter (where active)::text || '|' || min(origin) || '|' || bool_and(created_by = '5c410000-0000-4000-8000-0000000000a1')::text
     from public.contract_rate_terms));
select pg_temp.registrar('T2. tarifa sem trilha não existe: uma linha de auditoria por cadastro, com motivo', '4',
  (select count(*)::text from public.financial_terms_audit where action = 'tarifa_registrada' and reason = 'Tarifa TAR'));
select pg_temp.registrar('T3. sobreposição na mesma combinação recusada (23P01); outra combinação e outro período do turno passam',
  'erro 23P01|erro 23P01|ok',
  pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2026-03-01', 170, 'Sobreposta')::text$q$, pg_temp.fn('conferente')))
  || '|' || pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2025-12-01', 170, 'Sobreposta', date '2026-02-01')::text$q$, pg_temp.fn('conferente')))
  || '|' || case when pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'noturno', date '2025-01-01', 90, 'Antes', date '2026-01-01')::text$q$, pg_temp.fn('operador')))
                  ~ '^[0-9a-f-]{36}$' then 'ok' else 'falhou' end);
select pg_temp.registrar('T4. valores e referências inválidos recusados: zero, negativo, 3 casas, período fora de diurno/noturno, vigência invertida, função inexistente (22023), contrato inexistente (P0002)',
  'erro 22023|erro 22023|erro 22023|erro 22023|erro 22023|erro 22023|erro P0002',
  pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2030-01-01', 0, 'x')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2030-01-01', -5, 'x')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2030-01-01', 10.005, 'x')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'tarde', date '2030-01-01', 10, 'x')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.adm(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2030-01-01', 10, 'x', date '2029-01-01')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.adm($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', gen_random_uuid(), 'diurno', date '2030-01-01', 10, 'x')::text$q$)
  || '|' || pg_temp.adm(format($q$select public.registrar_tarifa_contrato(gen_random_uuid(), %L, 'diurno', date '2030-01-01', 10, 'x')::text$q$, pg_temp.fn('operador'))));
select pg_temp.registrar('T5. a tabela recusa direto (nem o dono): diária zero, período inválido, vigência invertida (23514)', 'erro 23514|erro 23514|erro 23514',
  pg_temp.erro_de($q$insert into public.contract_rate_terms (contract_id, job_function_id, shift_period, valid_from, daily_rate, origin, reason) values ('5c41d000-0000-4000-8000-0000000000d1', (select id from public.job_functions where code = 'administrativo'), 'diurno', date '2031-01-01', 0, 'informada', 'x')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.contract_rate_terms (contract_id, job_function_id, shift_period, valid_from, daily_rate, origin, reason) values ('5c41d000-0000-4000-8000-0000000000d1', (select id from public.job_functions where code = 'administrativo'), 'tarde', date '2031-01-01', 10, 'informada', 'x')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.contract_rate_terms (contract_id, job_function_id, shift_period, valid_from, valid_to, daily_rate, origin, reason) values ('5c41d000-0000-4000-8000-0000000000d1', (select id from public.job_functions where code = 'administrativo'), 'diurno', date '2031-01-01', date '2030-01-01', 10, 'informada', 'x')$q$));
select pg_temp.registrar('T6. tarifa não se apaga nem se reescreve (42501), inclusive para o dono', 'erro 42501|erro 42501|erro 42501',
  pg_temp.erro_de($q$delete from public.contract_rate_terms$q$)
  || '|' || pg_temp.erro_de($q$update public.contract_rate_terms set daily_rate = 1$q$)
  || '|' || pg_temp.erro_de($q$update public.contract_rate_terms set shift_period = 'noturno' where shift_period = 'diurno'$q$));

-- ---------------------------------------------------------------------------
-- D. Resolução DESLIGADA (estado inicial): nada muda
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D0. a resolução nasce desligada e o banco anuncia a capacidade', 'false|true|false',
  public.resolucao_de_tarifas_ativa()::text
  || '|' || (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'tarifas_por_funcao')$q$))
  || '|' || (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'resolucao_tarifas')$q$)));
select pg_temp.salvar('d1', 'a1', 'a1', date '2026-02-02', '1', '15:20');
select pg_temp.salvar('d2', 'a1', 'a1', date '2026-02-02', '2', '15:00');
select pg_temp.salvar('d3', 'a1', 'a2', date '2026-02-03', '1', '07:00', '', '22:00');
select pg_temp.salvar('d4', 'a1', 'a1', date '2026-02-04', '3', '15:00');
select pg_temp.registrar('D1. com as tarifas cadastradas e a resolução desligada, o preço é o de antes: diária genérica 100 (E1 com 20 min = 100 + 30 min × 18,75 ÷ 60 = 109,38)',
  '109.38|30|100.00|generica', pg_temp.v('1', date '2026-02-02'));
select pg_temp.registrar('D2. E2 100,00; noturno 100,00; colaborador SEM função (E3) é precificado normalmente (nada é pendente)',
  '100.00|0|100.00|generica|100.00|0|100.00|generica|100.00|0|100.00|generica',
  pg_temp.v('2', date '2026-02-02') || '|' || pg_temp.v('1', date '2026-02-03') || '|' || pg_temp.v('3', date '2026-02-04'));
select pg_temp.registrar('D3. custo: 80 + 20 min × 80/8 ÷ 60 = 83,33', '83.33',
  (select cost_amount::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-02-02'));

select pg_temp.exec('d5', $q$select (public.gerar_fatura('5c41c000-0000-4000-8000-0000000000c1', date '2026-02-01', date '2026-02-15')).total_amount::text$q$);
create temporary table _fev on commit drop as
  select (select md5(string_agg(to_jsonb(te)::text, ',' order by te.id)) from public.timesheet_entries te where te.work_date < date '2026-03-01') as e,
         (select md5(string_agg(to_jsonb(i)::text, ',' order by i.id)) from public.invoices i) as f,
         (select md5(string_agg(to_jsonb(it)::text, ',' order by it.id)) from public.invoice_items it) as it;
select pg_temp.registrar('D4. fatura de fevereiro (legado, antes de ligar a resolução): 109,38 + 100 + 100 + 100', '409.38', pg_temp.r('d5'));

-- ---------------------------------------------------------------------------
-- A. Ativação controlada
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. operacional não liga a resolução (42501); sem motivo, 22023', 'erro 42501|erro 22023',
  pg_temp.ope($q$select (public.alterar_resolucao_tarifas(true, 'tentativa'))::text$q$)
  || '|' || pg_temp.adm($q$select (public.alterar_resolucao_tarifas(true, '  '))::text$q$));
select pg_temp.exec('a2', $q$select (public.alterar_resolucao_tarifas(true, 'Ligada no teste TAR'))::text$q$);
select pg_temp.registrar('A2. admin liga (motor ligado e tarifas existem); estado e trilha refletem', 'true|true|1',
  (pg_temp.r('a2') like '%"ativa": true%')::text
  || '|' || (pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'resolucao_tarifas')$q$) = 'true')::text
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'tarifas_resolucao_ativada'));
select pg_temp.registrar('A3. ligar de novo é recusado (55000)', 'erro 55000',
  pg_temp.adm($q$select (public.alterar_resolucao_tarifas(true, 'de novo'))::text$q$));

-- ---------------------------------------------------------------------------
-- R. Resolução LIGADA
-- ---------------------------------------------------------------------------

select pg_temp.salvar('r1', 'a1', 'a1', date '2026-03-02', '1', '15:20');
select pg_temp.salvar('r2', 'a1', 'a2', date '2026-03-03', '1', '07:00', '', '22:00');
select pg_temp.salvar('r3', 'a1', 'a1', date '2026-03-02', '2', '15:00');
select pg_temp.salvar('r4', 'a1', 'a2', date '2026-03-03', '2', '07:00', '', '22:00');
select pg_temp.registrar('R1. diurno: conferente 160 + HE 20 min (30 min cobradas × 30,00/h) = 175,00', '175.00|30|160.00|tarifa', pg_temp.v('1', date '2026-03-02'));
select pg_temp.registrar('R2. noturno: conferente 200,00 (8 h líquidas, sem HE)', '200.00|0|200.00|tarifa', pg_temp.v('1', date '2026-03-03'));
select pg_temp.registrar('R3. duas funções no MESMO turno e dia: conferente 175,00 e operador 120,00', '175.00|120.00',
  (select string_agg(billed_amount::text, '|' order by employee_id) from public.timesheet_entries
    where work_date = date '2026-03-02' and operation_id = '5c41e000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('R4. a mesma função em turnos diferentes: operador diurno 120,00 e noturno 144,00', '120.00|0|120.00|tarifa|144.00|0|144.00|tarifa',
  pg_temp.v('2', date '2026-03-02') || '|' || pg_temp.v('2', date '2026-03-03'));

-- Reajuste: conferente diurno passa a 176 a partir de 01/04 (a anterior é encerrada, nunca editada).
select pg_temp.tarifa('t5', 'conferente', 'diurno', date '2026-04-01', 176, true);
select pg_temp.salvar('r5', 'a1', 'a1', date '2026-03-31', '1', '15:00');
select pg_temp.salvar('r6', 'a1', 'a1', date '2026-04-01', '1', '15:00');
select pg_temp.registrar('R5. vigência com reajuste: o dia ANTERIOR (31/03) cobra 160,00 e o dia EXATO do início (01/04) cobra 176,00',
  '160.00|0|160.00|tarifa|176.00|0|176.00|tarifa', pg_temp.v('1', date '2026-03-31') || '|' || pg_temp.v('1', date '2026-04-01'));
select pg_temp.registrar('R6. a tarifa antiga foi ENCERRADA em 01/04 (nunca editada) e a nova começa em 01/04', '2026-04-01|2026-04-01|176.00',
  (select valid_to::text from public.contract_rate_terms where job_function_id = pg_temp.fn('conferente') and shift_period = 'diurno' and valid_from = date '2026-01-01')
  || '|' || (select valid_from::text || '|' || daily_rate::text from public.contract_rate_terms where job_function_id = pg_temp.fn('conferente') and shift_period = 'diurno' and valid_from = date '2026-04-01'));

-- Pendências explícitas (nunca zero, nunca fallback)
select pg_temp.salvar('p1', 'a1', 'a1', date '2026-03-06', '3', '15:00');
select pg_temp.salvar('p2', 'a1', 'a3', date '2026-03-05', '1', '15:00');
select pg_temp.salvar('p3', 'a1', 'a1', date '2026-03-04', '4', '15:00');
select pg_temp.salvar('p4', 'a1', 'a1', date '2026-03-04', '6', '15:00', (select id::text from public.job_functions where code = 'administrativo'));
select pg_temp.registrar('R7. SEM função trabalhada: recusado como pendente de classificação (55000), nada gravado', 'erro 55000|0',
  pg_temp.r('p1') || '|' || (select count(*)::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000003' and work_date = date '2026-03-06'));
select pg_temp.registrar('R8. turno SEM classificação: pendente (55000); nunca precificado como diurno', 'erro 55000|0',
  pg_temp.r('p2') || '|' || (select count(*)::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-03-05'));
select pg_temp.registrar('R9. função SEM tarifa no contrato (auxiliar, administrativo): P0002, sem fallback para a diária genérica e nada gravado', 'erro P0002|erro P0002|0',
  pg_temp.r('p3') || '|' || pg_temp.r('p4') || '|'
  || (select count(*)::text from public.timesheet_entries where work_date = date '2026-03-04' and employee_id in ('5c41f000-0000-4000-8000-000000000004', '5c41f000-0000-4000-8000-000000000006')));

-- Operação SEM contrato: valor acordado, a regra de antes (a função do snapshot não preça nada)
select pg_temp.salvar('o1', 'a2', 'a4', date '2026-03-02', '5', '15:00');
select pg_temp.registrar('R10. operação sem contrato mantém o valor acordado (200,00) com a resolução ligada', '200.00|0|200.00|generica',
  pg_temp.v('5', date '2026-03-02'));

-- ---------------------------------------------------------------------------
-- M. Motor V2 preservado e custo independente do preço
-- ---------------------------------------------------------------------------

select pg_temp.salvar('m1', 'a1', 'a1', date '2026-03-05', '2', '15:10');
select pg_temp.salvar('m2', 'a1', 'a1', date '2026-03-10', '1', '15:50');
select pg_temp.salvar('m3', 'a1', 'a1', date '2026-03-07', '1', '11:00');
select pg_temp.salvar('m4', 'a1', 'a1', date '2026-03-07', '2', '12:00');
select pg_temp.registrar('M1. arredondamento 15/45: 10 min de excesso não cobram (120,00, 0 min); 50 min cobram 60 (160 + 30,00 = 190,00)',
  '120.00|0|120.00|tarifa|190.00|60|160.00|tarifa', pg_temp.v('2', date '2026-03-05') || '|' || pg_temp.v('1', date '2026-03-10'));
select pg_temp.registrar('M2. sábado com referência de 4 h: 4 h = diária cheia (160,00); 5 h = 120 + 1 h × 22,50 = 142,50',
  '160.00|0|160.00|tarifa|142.50|60|120.00|tarifa', pg_temp.v('1', date '2026-03-07') || '|' || pg_temp.v('2', date '2026-03-07'));
select pg_temp.registrar('M3. componentes V2 persistidos: base 160,00 + HE 15,00 + especial 0 = 175,00, versão 2', '160.00|15.00|0.00|2|175.00',
  (select billed_base_amount::text || '|' || billed_overtime_amount::text || '|' || billed_special_amount::text || '|' || calc_version::text || '|' || billed_amount::text
     from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-03-02'));
select pg_temp.registrar('M4. o custo NÃO depende do preço: o mesmo apontamento de E1 custa 83,33 com a diária genérica (fev) e com a tarifa (mar)',
  '83.33|83.33',
  (select cost_amount::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-02-02')
  || '|' || (select cost_amount::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-03-02'));
select pg_temp.registrar('M5. horas e minutos idênticos com e sem tarifa: 20 min de excesso viram 30 min cobradas nos dois casos', '30|30',
  (select billed_overtime_minutes::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-02-02')
  || '|' || (select billed_overtime_minutes::text from public.timesheet_entries where employee_id = '5c41f000-0000-4000-8000-000000000001' and work_date = date '2026-03-02'));

-- ---------------------------------------------------------------------------
-- C. Correção de apontamento NÃO faturado recalcula pela combinação corrigida
-- ---------------------------------------------------------------------------

select pg_temp.salvar('c1', 'a1', 'a1', date '2026-03-09', '3', '15:00', (select id::text from public.job_functions where code = 'conferente'));
create or replace function pg_temp.id_de(_emp text, _data date) returns text language sql as $$
  select id::text from public.timesheet_entries
   where employee_id = ('5c41f000-0000-4000-8000-00000000000' || _emp)::uuid and work_date = _data
$$;
select pg_temp.registrar('C1. função informada no salvamento: E3 vira conferente diurno = 160,00', '160.00|0|160.00|tarifa', pg_temp.v('3', date '2026-03-09'));
select pg_temp.exec('c2', format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'Era operador, não conferente'))::text$q$,
  pg_temp.id_de('3', date '2026-03-09'), pg_temp.fn('operador')));
select pg_temp.registrar('C2. corrigir a função (antes da fatura) recalcula pela tarifa do operador diurno: 120,00, ligado à tarifa certa',
  '120.00|0|120.00|tarifa|true',
  pg_temp.v('3', date '2026-03-09') || '|'
  || (select (te.contract_rate_terms_id = (select r.id from public.contract_rate_terms r where r.job_function_id = pg_temp.fn('operador') and r.shift_period = 'diurno' and r.active and r.valid_from = date '2026-01-01'))::text
        from public.timesheet_entries te where te.id = pg_temp.id_de('3', date '2026-03-09')::uuid));
select pg_temp.registrar('C3. corrigir para função SEM tarifa é recusado (P0002) e o apontamento fica como estava (120,00, operador)',
  'erro P0002|120.00|operador',
  pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'Tentativa sem tarifa'))::text$q$, pg_temp.id_de('3', date '2026-03-09'), pg_temp.fn('auxiliar_producao')))
  || '|' || (select te.billed_amount::text || '|' || f.code from public.timesheet_entries te join public.job_functions f on f.id = te.job_function_id_snapshot where te.id = pg_temp.id_de('3', date '2026-03-09')::uuid));
select pg_temp.registrar('C4. reclassificar o turno depois NÃO reprecifica o que já foi lançado (E1 03-02 continua 175,00)', '175.00',
  (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')::uuid));
select pg_temp.exec('c5', $q$update public.shifts set shift_period = 'noturno' where name = 'S1'$q$);
select pg_temp.registrar('C5. nem depois de reclassificar S1 como noturno: o lançamento de 02/03 continua 175,00 (diurno, 160,00)', '175.00|160.00',
  (select billed_amount::text || '|' || daily_rate_snapshot::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')::uuid));
select pg_temp.exec('c6', $q$update public.shifts set shift_period = 'diurno' where name = 'S1'$q$);

-- ---------------------------------------------------------------------------
-- U. Tarifa usada não se edita; a não usada, sim
-- ---------------------------------------------------------------------------

create or replace function pg_temp.id_tarifa(_fn text, _per text, _de date) returns uuid language sql as $$
  select id from public.contract_rate_terms where job_function_id = pg_temp.fn(_fn) and shift_period = _per and valid_from = _de and active
$$;
select pg_temp.registrar('U1. tarifa JÁ USADA: corrigir, aposentar e encerrar antes de uma data usada são recusados (55000)', 'erro 55000|erro 55000|erro 55000',
  pg_temp.adm(format($q$select public.corrigir_tarifa_contrato(%L, date '2026-01-01', null, 999, 'Reajuste retroativo')::text$q$, pg_temp.id_tarifa('conferente', 'noturno', date '2026-01-01')))
  || '|' || pg_temp.adm(format($q$select public.aposentar_tarifa_contrato(%L, 'Não quero mais')::text$q$, pg_temp.id_tarifa('conferente', 'noturno', date '2026-01-01')))
  || '|' || pg_temp.adm(format($q$select public.encerrar_tarifa_contrato(%L, date '2026-03-03', 'Cortar antes do uso')::text$q$, pg_temp.id_tarifa('conferente', 'noturno', date '2026-01-01'))));
select pg_temp.tarifa('u2', 'administrativo', 'diurno', date '2026-05-01', 90);
select pg_temp.exec('u3', format($q$select public.corrigir_tarifa_contrato(%L, date '2026-05-01', null, 95, 'Valor combinado era 95')::text$q$, pg_temp.id_tarifa('administrativo', 'diurno', date '2026-05-01')));
select pg_temp.registrar('U2. tarifa NÃO usada: a correção aposenta a versão e cria outra (95,00), com trilha', 'true|95.00|1|1',
  (pg_temp.r('u3') ~ '^[0-9a-f-]{36}$')::text
  || '|' || (select daily_rate::text from public.contract_rate_terms where job_function_id = pg_temp.fn('administrativo') and active)
  || '|' || (select count(*)::text from public.contract_rate_terms where job_function_id = pg_temp.fn('administrativo') and not active and replaced_by is not null)
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'tarifa_corrigida'));
select pg_temp.exec('u4', format($q$select public.aposentar_tarifa_contrato(%L, 'Sem uso')::text$q$, pg_temp.id_tarifa('administrativo', 'diurno', date '2026-05-01')));
select pg_temp.registrar('U3. tarifa não usada pode ser aposentada; depois dela, a função segue sem tarifa vigente', '|0',
  pg_temp.r('u4') || '|' || (select count(*)::text from public.contract_rate_terms where job_function_id = pg_temp.fn('administrativo') and active));

select pg_temp.registrar('U4. leitura da tarifa vigente na data: 160,00 em 31/03, 176,00 em 01/04, nenhuma antes de 2026', '160.00|176.00|nulo',
  pg_temp.adm(format($q$select daily_rate::text from public.tarifa_contrato_na_data('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2026-03-31')$q$, pg_temp.fn('conferente')))
  || '|' || pg_temp.adm(format($q$select daily_rate::text from public.tarifa_contrato_na_data('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2026-04-01')$q$, pg_temp.fn('conferente')))
  || '|' || pg_temp.adm(format($q$select daily_rate::text from public.tarifa_contrato_na_data('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2025-06-01')$q$, pg_temp.fn('conferente'))));

-- ---------------------------------------------------------------------------
-- F. Fatura: duas tarifas, Σ itens = total, histórico imutável
-- ---------------------------------------------------------------------------

select pg_temp.exec('f1', $q$select (public.gerar_fatura('5c41c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).id::text$q$);
select pg_temp.registrar('F1. fatura de 01–15/03 gerada pelo caminho normal', 'true', (pg_temp.r('f1') ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.registrar('F2. os itens de diárias da OP1 separam as quatro tarifas (120, 144, 160 e 200), cada uma com a quantidade × tarifa exata',
  '120.00|144.00|160.00|200.00',
  (select string_agg(distinct it.unit_price::text, '|' order by it.unit_price::text)
     from public.invoice_items it where it.invoice_id = pg_temp.r('f1')::uuid and it.kind = 'diarias'
      and it.operation_id = '5c41e000-0000-4000-8000-0000000000a1' and it.description not like '%proporcionais%'));
select pg_temp.registrar('F3. Σ itens = total da fatura, exatamente', 'true',
  ((select sum(amount) from public.invoice_items where invoice_id = pg_temp.r('f1')::uuid)
    = (select total_amount from public.invoices where id = pg_temp.r('f1')::uuid))::text);
select pg_temp.registrar('F4. o total da fatura = Σ dos valores cobrados dos lançamentos vinculados', 'true',
  ((select total_amount from public.invoices where id = pg_temp.r('f1')::uuid)
    = (select sum(billed_amount) from public.timesheet_entries where invoice_id = pg_temp.r('f1')::uuid))::text);
select pg_temp.registrar('F5. a fatura de fevereiro, emitida antes de ligar a resolução, está IDÊNTICA (lançamentos, fatura e itens)', 'true',
  ((select e from _fev) = (select md5(string_agg(to_jsonb(te)::text, ',' order by te.id)) from public.timesheet_entries te where te.work_date < date '2026-03-01')
   and (select it from _fev) = (select md5(string_agg(to_jsonb(it)::text, ',' order by it.id)) from public.invoice_items it where it.invoice_id <> pg_temp.r('f1')::uuid)
   and (select f from _fev) = (select md5(string_agg(to_jsonb(i)::text, ',' order by i.id)) from public.invoices i where i.id <> pg_temp.r('f1')::uuid))::text);
select pg_temp.registrar('F6. depois da fatura: nem o dono do banco troca a tarifa nem o preço do lançamento faturado (42501)', 'erro 42501|erro 42501',
  pg_temp.erro_de(format($q$update public.timesheet_entries set contract_rate_terms_id = null where id = %L$q$, pg_temp.id_de('1', date '2026-03-02')))
  || '|' || pg_temp.erro_de(format($q$update public.timesheet_entries set daily_rate_snapshot = 1 where id = %L$q$, pg_temp.id_de('1', date '2026-03-02'))));
select pg_temp.registrar('F7. depois da fatura, corrigir função/período é recusado (55000) e o valor fica', 'erro 55000|175.00',
  pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'tarde'))::text$q$, pg_temp.id_de('1', date '2026-03-02'), pg_temp.fn('operador')))
  || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')::uuid));

-- ---------------------------------------------------------------------------
-- P. Permissões e escrita direta
-- ---------------------------------------------------------------------------

select pg_temp.exec_ope('p5', $q$select public.salvar_apontamento_operacional('5c41e000-0000-4000-8000-0000000000a1', '5c41a000-0000-4000-8000-0000000000a1', date '2026-03-11',
  '[{"employee_id":"5c41f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00","check_out":"15:00","break_minutes":60}]'::jsonb)::text$q$);
select pg_temp.exec_ope('p6', $q$select public.salvar_apontamento_operacional('5c41e000-0000-4000-8000-0000000000a1', '5c41a000-0000-4000-8000-0000000000a1', date '2026-03-11',
  '[{"employee_id":"5c41f000-0000-4000-8000-000000000003","status":"present","check_in":"06:00","check_out":"15:00","break_minutes":60}]'::jsonb)::text$q$);
select pg_temp.registrar('P1. operador grava pela RPC operacional: o preço vem da tarifa da alocação (E1 conferente = 160,00); sem função (E3), pendente (55000)',
  'true|160.00|erro 55000',
  (pg_temp.r('p5') ~ '^[0-9a-f-]{36}$')::text || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-11')::uuid)
  || '|' || pg_temp.r('p6'));
select pg_temp.registrar('P2. operacional: não lê tarifas nem a chave, não cadastra, corrige, encerra, aposenta nem liga (0 linhas / 42501)',
  '0|0|erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.ope($q$select count(*)::text from public.contract_rate_terms$q$)
  || '|' || pg_temp.ope($q$select count(*)::text from public.pricing_settings$q$)
  || '|' || pg_temp.ope(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2040-01-01', 10, 'x')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.ope(format($q$select public.corrigir_tarifa_contrato(%L, date '2026-01-01', null, 1, 'x')::text$q$, pg_temp.id_tarifa('operador', 'diurno', date '2026-01-01')))
  || '|' || pg_temp.ope(format($q$select public.encerrar_tarifa_contrato(%L, date '2040-01-01', 'x')::text$q$, pg_temp.id_tarifa('operador', 'diurno', date '2026-01-01')))
  || '|' || pg_temp.ope($q$select (public.alterar_resolucao_tarifas(false, 'x'))::text$q$));
select pg_temp.registrar('P3. anon: sem leitura nem RPC (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.anon($q$select count(*)::text from public.contract_rate_terms$q$)
  || '|' || pg_temp.anon(format($q$select public.registrar_tarifa_contrato('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2040-01-01', 10, 'x')::text$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.anon($q$select (public.alterar_resolucao_tarifas(false, 'x'))::text$q$));
select pg_temp.registrar('P4. nem o admin escreve direto: tarifa, chave e preço do lançamento (42501)', 'erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.adm(format($q$insert into public.contract_rate_terms (contract_id, job_function_id, shift_period, valid_from, daily_rate, origin, reason) values ('5c41d000-0000-4000-8000-0000000000d1', %L, 'diurno', date '2040-01-01', 1, 'informada', 'x')$q$, pg_temp.fn('operador')))
  || '|' || pg_temp.adm($q$update public.contract_rate_terms set daily_rate = 1$q$)
  || '|' || pg_temp.adm($q$update public.pricing_settings set tarifas_por_funcao = false$q$)
  || '|' || pg_temp.adm(format($q$update public.timesheet_entries set contract_rate_terms_id = %L where id = %L$q$, pg_temp.id_tarifa('conferente', 'noturno', date '2026-01-01'), pg_temp.id_de('3', date '2026-03-09'))));
select pg_temp.registrar('P5. funções internas fechadas; RPCs só para authenticated', 'false|false|false|true|true|false',
  has_function_privilege('authenticated', 'public.resolucao_de_tarifas_ativa()', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.encerrar_tarifa_interna(uuid, date, text)', 'EXECUTE')::text
  || '|' || has_function_privilege('anon', 'public.alterar_resolucao_tarifas(boolean, text, boolean)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.alterar_resolucao_tarifas(boolean, text, boolean)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.registrar_tarifa_contrato(uuid, uuid, text, date, numeric, text, date, boolean)', 'EXECUTE')::text
  || '|' || has_function_privilege('service_role', 'public.registrar_tarifa_contrato(uuid, uuid, text, date, numeric, text, date, boolean)', 'EXECUTE')::text);

-- ---------------------------------------------------------------------------
-- Desligar volta ao preço de antes para o que vier depois; o já lançado não muda
-- ---------------------------------------------------------------------------

select pg_temp.exec('z1', $q$select (public.alterar_resolucao_tarifas(false, 'Desligada no teste TAR'))::text$q$);
select pg_temp.salvar('z2', 'a1', 'a1', date '2026-03-12', '2', '15:00');
select pg_temp.registrar('Z1. desligada: o lançamento NOVO volta à diária genérica (100,00) e o já lançado fica (175,00)', 'true|100.00|0|100.00|generica|175.00',
  (pg_temp.r('z1') like '%"ativa": false%')::text || '|' || pg_temp.v('2', date '2026-03-12')
  || '|' || (select billed_amount::text from public.timesheet_entries where id = pg_temp.id_de('1', date '2026-03-02')::uuid));

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
    raise exception '041_tarifas_por_funcao_e_periodo: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
