-- Migration 040 — snapshots de função e período do turno por apontamento (FIN-PR-07, etapa 3).
--
-- CHECKPOINT BLOQUEANTE: nenhuma tarifa pode ser ligada se qualquer caso daqui falhar.
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que
-- termina em `rollback`. NUNCA rodar contra Production nem homologação. Dados sintéticos.
--
-- O QUE ESTE ARQUIVO PROVA
--   S  captura no lançamento: função da alocação, função informada (diferente da padrão), função
--      ausente (nunca inventada), período do turno correto, turno sem classificação, sem turno, falta
--   R  mudanças de cadastro depois do lançamento NÃO reescrevem o snapshot (reclassificação do
--      turno, função padrão do colaborador, função da alocação); apontamento histórico preservado
--   C  correção antes da fatura: só pela RPC auditada; depois da fatura, recusada pelo banco
--   D  escrita direta nos snapshots recusada (admin, anon, operacional, dono do banco após a fatura)
--   K  concorrência (a trava é a de gerar_fatura), isolamento entre clientes, auditoria
--   O  operacional sem escalada de privilégios
--   F  nenhum valor financeiro muda

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
    jsonb_build_object('sub', '5c400000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec400000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c400000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec400000-0000-4000-8000-0000000000a2'), _sql)
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
-- Roda como admin e GUARDA o resultado: efeito e conferência em comandos separados.
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
-- Fixture (motor ligado)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c400000-0000-4000-8000-0000000000a1'), ('5c400000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec400000-0000-4000-8000-0000000000a1', '5c400000-0000-4000-8000-0000000000a1', null),
  ('ec400000-0000-4000-8000-0000000000a2', '5c400000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c400000-0000-4000-8000-0000000000a1', 'admin'), ('5c400000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values
  ('5c40c000-0000-4000-8000-0000000000c1', 'C01'), ('5c40c000-0000-4000-8000-0000000000c2', 'C02');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c40d000-0000-4000-8000-0000000000d1', '5c40c000-0000-4000-8000-0000000000c1', 'K1', 100, 8, 1.5, 10),
  ('5c40d000-0000-4000-8000-0000000000d2', '5c40c000-0000-4000-8000-0000000000c2', 'K2', 120, 8, 1.5, 10);
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor) values
  ('5c40d000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1.5, 10, true, 'informada', 'SNAP', 'diario', 4, 2),
  ('5c40d000-0000-4000-8000-0000000000d2', date '2026-01-01', 120, 8, 1.5, 10, true, 'informada', 'SNAP', 'diario', 4, 2);
insert into public.operations (id, client_id, contract_id, name) values
  ('5c40e000-0000-4000-8000-0000000000a1', '5c40c000-0000-4000-8000-0000000000c1', '5c40d000-0000-4000-8000-0000000000d1', 'OP1'),
  ('5c40e000-0000-4000-8000-0000000000a2', '5c40c000-0000-4000-8000-0000000000c2', '5c40d000-0000-4000-8000-0000000000d2', 'OP2');
-- S1 diurno, S2 noturno (cruza a meia-noite), S3 SEM classificação (histórico), S9 do outro cliente.
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight, shift_period) values
  ('5c40a000-0000-4000-8000-0000000000a1', '5c40e000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60, false, 'diurno'),
  ('5c40a000-0000-4000-8000-0000000000a2', '5c40e000-0000-4000-8000-0000000000a1', 'S2', '22:00', '07:00', 60, true, 'noturno'),
  ('5c40a000-0000-4000-8000-0000000000a3', '5c40e000-0000-4000-8000-0000000000a1', 'S3', '06:00', '15:00', 60, false, null),
  ('5c40a000-0000-4000-8000-0000000000a9', '5c40e000-0000-4000-8000-0000000000a2', 'S9', '06:00', '15:00', 60, false, 'diurno');
-- Funções padrão: E1 operador, E2 conferente (a alocação de E2 NÃO tem função: o padrão não é usado).
insert into public.employees (id, name, role, daily_cost, job_function_id) values
  ('5c40f000-0000-4000-8000-000000000001', 'SNAP-E1', 'Operador', 80, (select id from public.job_functions where code = 'operador')),
  ('5c40f000-0000-4000-8000-000000000002', 'SNAP-E2', 'Conferente', 80, (select id from public.job_functions where code = 'conferente')),
  ('5c40f000-0000-4000-8000-000000000003', 'SNAP-E3', null, 80, null),
  ('5c40f000-0000-4000-8000-000000000004', 'SNAP-E4', null, 80, null),
  ('5c40f000-0000-4000-8000-000000000005', 'SNAP-E5', null, 80, null),
  ('5c40f000-0000-4000-8000-000000000009', 'SNAP-E9', null, 80, null);
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select e.id, date '2026-01-01', 80, true, 'informada', 'SNAP' from public.employees e where e.name like 'SNAP-E%';
-- Alocações: E1 -> conferente (diferente do padrão operador); E2 sem função; E3 -> auxiliar; E5 -> auxiliar.
insert into public.operation_team (id, operation_id, shift_id, employee_id, job_function_id) values
  ('5c40b000-0000-4000-8000-000000000001', '5c40e000-0000-4000-8000-0000000000a1', null, '5c40f000-0000-4000-8000-000000000001', (select id from public.job_functions where code = 'conferente')),
  ('5c40b000-0000-4000-8000-000000000002', '5c40e000-0000-4000-8000-0000000000a1', null, '5c40f000-0000-4000-8000-000000000002', null),
  ('5c40b000-0000-4000-8000-000000000003', '5c40e000-0000-4000-8000-0000000000a1', null, '5c40f000-0000-4000-8000-000000000003', (select id from public.job_functions where code = 'auxiliar_producao')),
  ('5c40b000-0000-4000-8000-000000000005', '5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', '5c40f000-0000-4000-8000-000000000005', (select id from public.job_functions where code = 'auxiliar_producao')),
  ('5c40b000-0000-4000-8000-000000000009', '5c40e000-0000-4000-8000-0000000000a2', null, '5c40f000-0000-4000-8000-000000000009', (select id from public.job_functions where code = 'operador'));
insert into public.user_operation_access (user_id, operation_id)
  values ('5c400000-0000-4000-8000-0000000000a2', '5c40e000-0000-4000-8000-0000000000a1');

set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste SNAP') ->> 'ativo')$q$));

-- Colunas financeiras de um apontamento, SEM os snapshots novos e sem carimbos.
create or replace function pg_temp.fin(_id text) returns text language sql as $$
  select (to_jsonb(te) - array['id', 'timesheet_id', 'employee_id', 'created_at', 'updated_at',
           'job_function_id_snapshot', 'shift_period_snapshot', 'job_function_source'])::text
    from public.timesheet_entries te where te.id = _id::uuid
$$;
create or replace function pg_temp.snap(_emp text, _data date) returns text language sql as $$
  select coalesce(f.code, '-') || ':' || coalesce(te.job_function_source, '-') || ':' || coalesce(te.shift_period_snapshot, '-')
    from public.timesheet_entries te left join public.job_functions f on f.id = te.job_function_id_snapshot
   where te.employee_id = ('5c40f000-0000-4000-8000-00000000000' || _emp)::uuid and te.work_date = _data
$$;

-- ---------------------------------------------------------------------------
-- S. Captura no lançamento (pelo RPC do admin, como a tela)
-- ---------------------------------------------------------------------------

select pg_temp.exec('s1', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-02',
  jsonb_build_array(
    jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '06:00', 'check_out', '15:20', 'break_minutes', 60),
    jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000002', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60),
    jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000003', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60,
       'job_function_id', (select id from public.job_functions where code = 'operador'))))::text$q$);
select pg_temp.registrar('S1. snapshot gravado: E1 conferente (alocação, diferente do padrão operador), turno diurno',
  'conferente:alocacao:diurno', pg_temp.snap('1', date '2026-03-02'));
select pg_temp.registrar('S2. E2: alocação SEM função e padrão conferente => função NULA (o padrão não é usado nem inventado)',
  '-:-:diurno', pg_temp.snap('2', date '2026-03-02'));
select pg_temp.registrar('S3. E3: função informada (operador) diferente da alocação (auxiliar)', 'operador:informada:diurno',
  pg_temp.snap('3', date '2026-03-02'));
select pg_temp.registrar('S4. a variável de transporte da função não vaza para a sessão', 'true',
  (coalesce(current_setting('bslog.funcao_do_apontamento', true), '') = '')::text);

select pg_temp.exec('s5', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a2', date '2026-03-03',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '22:00', 'check_out', '07:00', 'break_minutes', 60)))::text$q$);
select pg_temp.exec('s6', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a3', date '2026-03-04',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60)))::text$q$);
select pg_temp.exec('s7', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', null, date '2026-03-05',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60)))::text$q$);
select pg_temp.registrar('S5. período obtido do turno CERTO: S2 (cruza a meia-noite) noturno', 'conferente:alocacao:noturno',
  pg_temp.snap('1', date '2026-03-03'));
select pg_temp.registrar('S6. turno SEM classificação: período nulo (nunca "diurno" por padrão)', 'conferente:alocacao:-',
  pg_temp.snap('1', date '2026-03-04'));
select pg_temp.registrar('S7. folha sem turno: período nulo', 'conferente:alocacao:-', pg_temp.snap('1', date '2026-03-05'));

select pg_temp.exec('s8', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-06',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000004', 'status', 'absent')))::text$q$);
select pg_temp.registrar('S8. falta não tem snapshot', '-:-:-', pg_temp.snap('4', date '2026-03-06'));
select pg_temp.exec('s9', $q$update public.timesheet_entries set status = 'present', check_in = '06:00', check_out = '15:00', break_minutes = 60
  where employee_id = '5c40f000-0000-4000-8000-000000000004' and work_date = date '2026-03-06'$q$);
select pg_temp.registrar('S9. falta que vira presença é capturada de novo (sem alocação: função nula, período diurno)', 'nulo|-:-:diurno',
  pg_temp.r('s9') || '|' || pg_temp.snap('4', date '2026-03-06'));
select pg_temp.exec('s10', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-09',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000005', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60,
    'job_function_id', (select id from public.job_functions where code = 'administrativo'))))::text$q$);
select pg_temp.exec('s10b', $q$select public.alterar_situacao_funcao((select id from public.job_functions where code = 'administrativo'), false)::text$q$);
select pg_temp.exec('s10c', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-10',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000005', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60,
    'job_function_id', (select id from public.job_functions where code = 'administrativo'))))::text$q$);
select pg_temp.registrar('S10. função informada: ativa grava; INATIVA é recusada (23514) e nada é gravado', 'administrativo:informada:diurno|erro 23514|0',
  pg_temp.snap('5', date '2026-03-09') || '|' || pg_temp.r('s10c')
  || '|' || (select count(*)::text from public.timesheet_entries where employee_id = '5c40f000-0000-4000-8000-000000000005' and work_date = date '2026-03-10'));
select pg_temp.exec('s10d', $q$select public.alterar_situacao_funcao((select id from public.job_functions where code = 'administrativo'), true)::text$q$);

-- ---------------------------------------------------------------------------
-- R. Mudanças de cadastro depois do lançamento não reescrevem o snapshot
-- ---------------------------------------------------------------------------

create temporary table _antes on commit drop as
  select pg_temp.snap('1', date '2026-03-02') as e1, pg_temp.snap('1', date '2026-03-03') as e1n,
         pg_temp.fin(te.id::text) as fin_e1
    from public.timesheet_entries te
   where te.employee_id = '5c40f000-0000-4000-8000-000000000001' and te.work_date = date '2026-03-02';

select pg_temp.exec('r1', $q$update public.shifts set shift_period = 'noturno' where name = 'S1'$q$);
select pg_temp.exec('r1b', $q$update public.shifts set shift_period = 'diurno' where name = 'S2'$q$);
select pg_temp.registrar('R1. reclassificar o turno depois NÃO muda o snapshot de lançamentos antigos (S1 virou noturno, S2 diurno)',
  'nulo|nulo|conferente:alocacao:diurno|conferente:alocacao:noturno',
  pg_temp.r('r1') || '|' || pg_temp.r('r1b') || '|' || pg_temp.snap('1', date '2026-03-02') || '|' || pg_temp.snap('1', date '2026-03-03'));
select pg_temp.exec('r1c', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-11',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60)))::text$q$);
select pg_temp.registrar('R2. lançamento NOVO depois da reclassificação usa a classificação vigente (S1 noturno)', 'conferente:alocacao:noturno',
  pg_temp.snap('1', date '2026-03-11'));
select pg_temp.exec('r1d', $q$update public.shifts set shift_period = 'diurno' where name = 'S1'$q$);
select pg_temp.exec('r1e', $q$update public.shifts set shift_period = 'noturno' where name = 'S2'$q$);

select pg_temp.exec('r3', format($q$update public.employees set job_function_id = %L where name = 'SNAP-E1'$q$, pg_temp.fn('administrativo')));
select pg_temp.registrar('R3. mudar a função PADRÃO do colaborador não muda o snapshot', 'nulo|conferente:alocacao:diurno',
  pg_temp.r('r3') || '|' || pg_temp.snap('1', date '2026-03-02'));
select pg_temp.exec('r4', format($q$update public.operation_team set job_function_id = %L where id = '5c40b000-0000-4000-8000-000000000001'$q$, pg_temp.fn('auxiliar_producao')));
select pg_temp.registrar('R4. mudar a função da ALOCAÇÃO não muda o snapshot antigo', 'nulo|conferente:alocacao:diurno',
  pg_temp.r('r4') || '|' || pg_temp.snap('1', date '2026-03-02'));
select pg_temp.exec('r4b', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-12',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60)))::text$q$);
select pg_temp.registrar('R5. lançamento novo depois da mudança da alocação usa a função nova', 'auxiliar_producao:alocacao:diurno',
  pg_temp.snap('1', date '2026-03-12'));
select pg_temp.exec('r6', $q$update public.timesheet_entries set notes = 'obs', check_out = '15:30'
  where employee_id = '5c40f000-0000-4000-8000-000000000001' and work_date = date '2026-03-02'$q$);
select pg_temp.registrar('R6. editar horário/nota do apontamento NÃO recaptura (continua o snapshot do lançamento)', 'nulo|conferente:alocacao:diurno',
  pg_temp.r('r6') || '|' || pg_temp.snap('1', date '2026-03-02'));

-- Apontamento HISTÓRICO (anterior à 040): simulado zerando os snapshots como o dono do banco.
select pg_temp.exec('r7', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-13',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000003', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60)))::text$q$);
update public.timesheet_entries set job_function_id_snapshot = null, job_function_source = null, shift_period_snapshot = null
 where employee_id = '5c40f000-0000-4000-8000-000000000003' and work_date = date '2026-03-13';
select pg_temp.exec('r7b', $q$update public.timesheet_entries set notes = 'ajuste', check_out = '16:00'
  where employee_id = '5c40f000-0000-4000-8000-000000000003' and work_date = date '2026-03-13'$q$);
select pg_temp.registrar('R7. apontamento histórico (sem snapshot) é PRESERVADO: editar não reconstrói pelo cadastro de hoje', 'nulo|-:-:-',
  pg_temp.r('r7b') || '|' || pg_temp.snap('3', date '2026-03-13'));

-- ---------------------------------------------------------------------------
-- C. Correção antes da fatura: só pelo fluxo permitido
-- ---------------------------------------------------------------------------

create or replace function pg_temp.id_de(_emp text, _data date) returns text language sql as $$
  select id::text from public.timesheet_entries
   where employee_id = ('5c40f000-0000-4000-8000-00000000000' || _emp)::uuid and work_date = _data
$$;
select pg_temp.exec('c1', format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'Função conferida com o encarregado'))::text$q$,
  pg_temp.id_de('2', date '2026-03-02'), pg_temp.fn('conferente')));
select pg_temp.registrar('C1. corrigir a função de um apontamento NÃO faturado pela RPC (admin, motivo)', 'conferente:corrigida:diurno',
  pg_temp.snap('2', date '2026-03-02'));
select pg_temp.registrar('C2. a correção deixa trilha: ação, entidade, antes e depois, motivo e ator', '1|-|conferente|Função conferida com o encarregado|true',
  (select count(*)::text || '|' || coalesce(a.previous ->> 'job_function_id_snapshot', '-') || '|'
          || (select code from public.job_functions where id = (a.new ->> 'job_function_id_snapshot')::uuid) || '|' || a.reason
          || '|' || (a.actor_id = '5c400000-0000-4000-8000-0000000000a1')::text
     from public.financial_terms_audit a where a.action = 'apontamento_snapshots_corrigidos'
      and a.entity_id = pg_temp.id_de('2', date '2026-03-02')::uuid group by a.previous, a.new, a.reason, a.actor_id));
select pg_temp.registrar('C3. a correção segura a MESMA trava de gerar_fatura (advisory lock do cliente na transação)', 'true',
  (select count(*) >= 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid())::text);
select pg_temp.registrar('C4. sem motivo, função inativa ou nada a corrigir: recusados (22023)', 'erro 22023|erro 22023|erro 22023',
  pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, '  '))::text$q$, pg_temp.id_de('2', date '2026-03-02'), pg_temp.fn('operador')))
  || '|' || pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, null, false, 'x'))::text$q$, pg_temp.id_de('2', date '2026-03-02')))
  || '|' || pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, gen_random_uuid(), false, 'x'))::text$q$, pg_temp.id_de('2', date '2026-03-02'))));
select pg_temp.exec('c5a', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-18',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000002', 'status', 'absent')))::text$q$);
select pg_temp.registrar('C5. atualizar o período de turno SEM classificação é recusado (22023); falta é recusada (55000)', 'erro 22023|erro 55000',
  pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, null, true, 'x'))::text$q$, pg_temp.id_de('1', date '2026-03-04')))
  || '|' || pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'x'))::text$q$,
       pg_temp.id_de('2', date '2026-03-18'), pg_temp.fn('operador'))));
select pg_temp.exec('c6a', $q$update public.shifts set shift_period = 'diurno' where name = 'S3'$q$);
select pg_temp.exec('c6', format($q$select (public.corrigir_snapshots_do_apontamento(%L, null, true, 'Turno S3 confirmado como diurno'))::text$q$, pg_temp.id_de('1', date '2026-03-04')));
select pg_temp.registrar('C6. depois de o administrador classificar o turno, o período do histórico é regularizado com motivo e trilha',
  'conferente:alocacao:diurno|1',
  pg_temp.snap('1', date '2026-03-04') || '|' || (select count(*)::text from public.financial_terms_audit
    where action = 'apontamento_snapshots_corrigidos' and reason = 'Turno S3 confirmado como diurno'));

-- ---------------------------------------------------------------------------
-- D. Escrita direta recusada
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D1. admin NÃO grava o snapshot direto pela tabela (UPDATE) — 42501', 'erro 42501|erro 42501|erro 42501',
  pg_temp.adm(format($q$update public.timesheet_entries set job_function_id_snapshot = %L, job_function_source = 'corrigida' where id = %L$q$, pg_temp.fn('operador'), pg_temp.id_de('2', date '2026-03-02')))
  || '|' || pg_temp.adm(format($q$update public.timesheet_entries set shift_period_snapshot = 'noturno' where id = %L$q$, pg_temp.id_de('2', date '2026-03-02')))
  || '|' || pg_temp.adm(format($q$update public.timesheet_entries set job_function_source = 'informada' where id = %L$q$, pg_temp.id_de('2', date '2026-03-02'))));
select pg_temp.registrar('D2. admin não INSERE já com snapshot (42501)', 'erro 42501',
  pg_temp.adm(format($q$insert into public.timesheet_entries (timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, job_function_id_snapshot, job_function_source)
    select t.id, '5c40f000-0000-4000-8000-000000000009', t.operation_id, t.work_date, 'present', '06:00', '15:00', 60, %L, 'informada'
      from public.timesheets t where t.work_date = date '2026-03-02' limit 1$q$, pg_temp.fn('operador'))));
select pg_temp.registrar('D3. anon e operacional não gravam nem corrigem (0 linhas por RLS / 42501 na RPC)', 'nulo|erro 42501|0|erro 42501',
  pg_temp.anon(format($q$update public.timesheet_entries set shift_period_snapshot = 'noturno' where id = %L$q$, pg_temp.id_de('2', date '2026-03-02')))
  || '|' || pg_temp.anon(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'x'))::text$q$, pg_temp.id_de('2', date '2026-03-02'), pg_temp.fn('operador')))
  || '|' || pg_temp.ope($q$with u as (update public.timesheet_entries set shift_period_snapshot = 'noturno' returning 1) select count(*)::text from u$q$)
  || '|' || pg_temp.ope(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'x'))::text$q$, pg_temp.id_de('2', date '2026-03-02'), pg_temp.fn('operador'))));

-- ---------------------------------------------------------------------------
-- O. Operacional sem escalada
-- ---------------------------------------------------------------------------

select pg_temp.exec_ope('o1', $q$select public.salvar_apontamento_operacional('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-16',
    '[{"employee_id":"5c40f000-0000-4000-8000-000000000005","status":"present","check_in":"06:00","check_out":"15:00","break_minutes":60}]'::jsonb)::text$q$);
select pg_temp.registrar('O1. operador grava apontamento: o snapshot vem da ALOCAÇÃO (E5: auxiliar), período diurno',
  'true|auxiliar_producao:alocacao:diurno',
  (pg_temp.r('o1') ~ '^[0-9a-f-]{36}$')::text || '|' || pg_temp.snap('5', date '2026-03-16'));
select pg_temp.exec_ope('o2a', format($q$select public.salvar_apontamento_operacional('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-17',
    '[{"employee_id":"5c40f000-0000-4000-8000-000000000005","status":"present","check_in":"06:00","check_out":"15:00","break_minutes":60,"job_function_id":"%s"}]'::jsonb)::text$q$, pg_temp.fn('operador')));
select pg_temp.exec_ope('o2b', $q$select public.salvar_apontamento_operacional('5c40e000-0000-4000-8000-0000000000a1', '5c40a000-0000-4000-8000-0000000000a1', date '2026-03-17',
    '[{"employee_id":"5c40f000-0000-4000-8000-000000000005","status":"present","check_in":"06:00","check_out":"15:00","break_minutes":60,"shift_period_snapshot":"noturno"}]'::jsonb)::text$q$);
select pg_temp.registrar('O2. operador NÃO informa função nem snapshot no payload (campo fora da lista permitida) e nada é gravado', 'erro 22023|erro 22023|0',
  pg_temp.r('o2a') || '|' || pg_temp.r('o2b')
  || '|' || (select count(*)::text from public.timesheet_entries where work_date = date '2026-03-17'));

-- ---------------------------------------------------------------------------
-- K. Isolamento entre clientes
-- ---------------------------------------------------------------------------

select pg_temp.exec('k1', $q$select public.salvar_apontamento_admin('5c40e000-0000-4000-8000-0000000000a2', '5c40a000-0000-4000-8000-0000000000a9', date '2026-03-02',
  jsonb_build_array(jsonb_build_object('employee_id', '5c40f000-0000-4000-8000-000000000009', 'status', 'present', 'check_in', '06:00', 'check_out', '15:00', 'break_minutes', 60)))::text$q$);
create temporary table _c1 on commit drop as
  select md5(string_agg(to_jsonb(te)::text, ',' order by te.id)) as h from public.timesheet_entries te
   where te.operation_id = '5c40e000-0000-4000-8000-0000000000a1';
select pg_temp.exec('k2', format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'Cliente 2: função conferida'))::text$q$,
  pg_temp.id_de('9', date '2026-03-02'), pg_temp.fn('conferente')));
select pg_temp.registrar('K1. corrigir o apontamento do cliente 2 NÃO toca nos apontamentos do cliente 1; o do cliente 2 muda',
  'true|conferente:corrigida:diurno',
  ((select h from _c1) = (select md5(string_agg(to_jsonb(te)::text, ',' order by te.id)) from public.timesheet_entries te
      where te.operation_id = '5c40e000-0000-4000-8000-0000000000a1'))::text
  || '|' || pg_temp.snap('9', date '2026-03-02'));

-- ---------------------------------------------------------------------------
-- F. Nenhum valor financeiro muda
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. E1 (02/03): as colunas financeiras são IDÊNTICAS depois de reclassificar turno, mudar função padrão e alocação e editar o apontamento (só o horário editado)',
  'true',
  (select ((to_jsonb(te) - array['id','timesheet_id','employee_id','created_at','updated_at','job_function_id_snapshot','shift_period_snapshot','job_function_source',
      'check_out','notes','billed_amount','cost_amount','worked_minutes','overtime_minutes','billed_overtime_minutes','billed_overtime_amount','billed_base_amount','ot_hour_rate_snapshot'])::text
    = (to_jsonb(te) - array['id','timesheet_id','employee_id','created_at','updated_at','job_function_id_snapshot','shift_period_snapshot','job_function_source',
      'check_out','notes','billed_amount','cost_amount','worked_minutes','overtime_minutes','billed_overtime_minutes','billed_overtime_amount','billed_base_amount','ot_hour_rate_snapshot'])::text)::text
     from public.timesheet_entries te where te.id = pg_temp.id_de('1', date '2026-03-02')::uuid));
select pg_temp.registrar('F2. E2 e E3 (mesmo horário, 02/03): mesmo valor com função nula, informada ou da alocação', '100.00|100.00',
  (select string_agg(billed_amount::text, '|' order by employee_id) from public.timesheet_entries
    where work_date = date '2026-03-02' and employee_id in ('5c40f000-0000-4000-8000-000000000002', '5c40f000-0000-4000-8000-000000000003')));
select pg_temp.registrar('F3. o cálculo, a fatura e as leituras não conhecem os snapshots', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace
    -- derivar_valores_por_vigencia fica de fora desde a 041 (lê o snapshot só com a resolução ligada).
    and proname in ('derivar_valores_financeiros', 'gerar_fatura', 'ajustes_de_arredondamento_acumulado',
                    'resumo_financeiro_periodo', 'nucleo_componentes_v2', 'componentes_do_lancamento', 'motor_fonte_do_dia')
    and (prosrc ilike '%job_function%' or prosrc ilike '%shift_period%')));
select pg_temp.registrar('F4. a ordem de disparo: trava de colunas -> snapshots -> cálculos', 'true',
  (select (array_position(array_agg(tgname order by tgname), 'trg_timesheet_entries_bloqueia_condicoes')
         < array_position(array_agg(tgname order by tgname), 'trg_timesheet_entries_bz_snapshots_funcao_periodo')
       and array_position(array_agg(tgname order by tgname), 'trg_timesheet_entries_bz_snapshots_funcao_periodo')
         < array_position(array_agg(tgname order by tgname), 'trg_timesheet_entries_calculo_financeiro')
       and array_position(array_agg(tgname order by tgname), 'trg_timesheet_entries_bz_snapshots_funcao_periodo')
         < array_position(array_agg(tgname order by tgname), 'trg_timesheet_entries_calculo_vigencia'))::text
     from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass and not tgisinternal));

-- ---------------------------------------------------------------------------
-- I. Depois da fatura: imutável (e a correção é recusada)
-- ---------------------------------------------------------------------------

select pg_temp.exec('i1', $q$select (public.gerar_fatura('5c40c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).total_amount::text$q$);
select pg_temp.registrar('I1. fatura gerada normalmente (os snapshots não atrapalham o vínculo)', 'true',
  (pg_temp.r('i1') ~ '^[0-9.]+$')::text);
select pg_temp.registrar('I2. depois da fatura: a RPC de correção recusa (55000)', 'erro 55000|erro 55000',
  pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, %L, false, 'tarde demais'))::text$q$, pg_temp.id_de('2', date '2026-03-02'), pg_temp.fn('operador')))
  || '|' || pg_temp.adm(format($q$select (public.corrigir_snapshots_do_apontamento(%L, null, true, 'tarde demais'))::text$q$, pg_temp.id_de('1', date '2026-03-02'))));
select pg_temp.registrar('I3. depois da fatura: nem o dono do banco altera função ou período (42501)', 'erro 42501|erro 42501',
  pg_temp.erro_de(format($q$update public.timesheet_entries set job_function_id_snapshot = %L, job_function_source = 'corrigida' where id = %L$q$, pg_temp.fn('operador'), pg_temp.id_de('2', date '2026-03-02')))
  || '|' || pg_temp.erro_de(format($q$update public.timesheet_entries set shift_period_snapshot = 'noturno' where id = %L$q$, pg_temp.id_de('1', date '2026-03-02'))));
select pg_temp.registrar('I4. depois da fatura: admin direto na tabela também recusado (42501)', 'erro 42501',
  pg_temp.adm(format($q$update public.timesheet_entries set shift_period_snapshot = 'noturno' where id = %L$q$, pg_temp.id_de('1', date '2026-03-02'))));
select pg_temp.registrar('I5. reclassificar/editar cadastro depois da fatura não toca o faturado', 'conferente:alocacao:diurno|conferente:corrigida:diurno',
  pg_temp.snap('1', date '2026-03-02') || '|' || pg_temp.snap('2', date '2026-03-02'));
select pg_temp.registrar('I6. Σ itens = total da fatura', 'true',
  ((select sum(it.amount) from public.invoice_items it join public.invoices i on i.id = it.invoice_id where i.client_id = '5c40c000-0000-4000-8000-0000000000c1')
    = (select sum(total_amount) from public.invoices where client_id = '5c40c000-0000-4000-8000-0000000000c1'))::text);

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
    raise exception '040_snapshots_funcao_periodo: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
