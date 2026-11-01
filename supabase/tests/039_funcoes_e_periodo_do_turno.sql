-- Migration 039 — catálogo de funções e período do turno (FIN-PR-06).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que
-- termina em `rollback`. NUNCA rodar contra Production nem homologação. Dados sintéticos.
--
-- O QUE ESTE ARQUIVO PROVA
--   C  catálogo: quatro funções, códigos e nomes únicos (maiúsculas, acento, espaço), cadastro,
--      renomear, inativar sem excluir, referenciada preservada, sem exclusão nem troca de código
--   M  mapeamento por texto: exato vinculado, ambíguo/desconhecido/vazio não, texto original preservado
--   A  colaborador sem função, com função padrão; alocação herdando (valor explícito), diferente,
--      histórica intacta; inativa só não entra em escolha nova
--   T  turno: diurno, noturno, cruzando a meia-noite, histórico sem classificação, jornada congelada
--   F  equivalência financeira: o mesmo apontamento gera os mesmos valores, componentes e snapshots
--      com ou sem função, alocação e classificação; apontamento antigo sem campo novo
--   P  permissões: admin, operacional, anon; colunas novas fora do papel operacional; auditoria

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
    jsonb_build_object('sub', '5c3b0000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec3b0000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c3b0000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec3b0000-0000-4000-8000-0000000000a2'), _sql)
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

-- Roda como admin e GUARDA o resultado: o efeito e a conferência ficam em comandos separados (um
-- subselect da mesma expressão seria avaliado antes do efeito).
create temporary table _exec (k text primary key, r text) on commit drop;
grant all on _exec to authenticated;
create or replace function pg_temp.exec(_k text, _sql text) returns void language sql as $$
  insert into _exec values (_k, pg_temp.adm(_sql))
$$;
create or replace function pg_temp.r(_k text) returns text language sql as $$
  select r from _exec where k = _k
$$;

-- Função do catálogo pelo código.
create or replace function pg_temp.fn(_codigo text) returns uuid language sql as $$
  select id from public.job_functions where code = _codigo
$$;

-- ---------------------------------------------------------------------------
-- Fixture (motor por vigência LIGADO: a jornada do turno usado fica congelada)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c3b0000-0000-4000-8000-0000000000a1'), ('5c3b0000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec3b0000-0000-4000-8000-0000000000a1', '5c3b0000-0000-4000-8000-0000000000a1', null),
  ('ec3b0000-0000-4000-8000-0000000000a2', '5c3b0000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c3b0000-0000-4000-8000-0000000000a1', 'admin'), ('5c3b0000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c3bc000-0000-4000-8000-0000000000c1', 'C01');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c3bd000-0000-4000-8000-0000000000d1', '5c3bc000-0000-4000-8000-0000000000c1', 'K1', 100, 8, 1.5, 10);
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor) values
  ('5c3bd000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1.5, 10, true, 'informada', 'FUN', 'diario', 4, 2);
insert into public.operations (id, client_id, contract_id, name) values
  ('5c3be000-0000-4000-8000-0000000000a1', '5c3bc000-0000-4000-8000-0000000000c1', '5c3bd000-0000-4000-8000-0000000000d1', 'OP1');
-- S1 dia (06–15), S2 noturno que cruza a meia-noite (22–07), S3 que cruza a meia-noite e é DIURNO
-- de propósito (a classificação não vem do horário), S4 histórico sem classificação.
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('5c3ba000-0000-4000-8000-0000000000a1', '5c3be000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60, false),
  ('5c3ba000-0000-4000-8000-0000000000a2', '5c3be000-0000-4000-8000-0000000000a1', 'S2', '22:00', '07:00', 60, true),
  ('5c3ba000-0000-4000-8000-0000000000a3', '5c3be000-0000-4000-8000-0000000000a1', 'S3', '23:00', '08:00', 60, true),
  ('5c3ba000-0000-4000-8000-0000000000a4', '5c3be000-0000-4000-8000-0000000000a1', 'S4', '06:00', '15:00', 60, false);
-- Colaboradores: textos de cargo variados (E1 exato, E2 exato com acento/caixa/espaço, E3 ambíguo,
-- E4 desconhecido, E5 vazio, E6 nulo, E7 e E8 para a equivalência financeira).
insert into public.employees (id, name, role, daily_cost) values
  ('5c3bf000-0000-4000-8000-000000000001', 'FUN-E1', 'Conferente', 80),
  ('5c3bf000-0000-4000-8000-000000000002', 'FUN-E2', '  AUXILIAR de producao ', 80),
  ('5c3bf000-0000-4000-8000-000000000003', 'FUN-E3', 'Ajudante', 80),
  ('5c3bf000-0000-4000-8000-000000000004', 'FUN-E4', 'Auxiliar de produção e limpeza', 80),
  ('5c3bf000-0000-4000-8000-000000000005', 'FUN-E5', '   ', 80),
  ('5c3bf000-0000-4000-8000-000000000006', 'FUN-E6', null, 80),
  ('5c3bf000-0000-4000-8000-000000000007', 'FUN-E7', 'Operador', 80),
  ('5c3bf000-0000-4000-8000-000000000008', 'FUN-E8', 'Operador', 80);
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select e.id, date '2026-01-01', 80, true, 'informada', 'FUN' from public.employees e where e.name like 'FUN-E%';

set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste FUN') ->> 'ativo')$q$));

-- Alocação HISTÓRICA (como antes da 039: sem função).
insert into public.operation_team (id, operation_id, shift_id, employee_id) values
  ('5c3bb000-0000-4000-8000-000000000001', '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1', '5c3bf000-0000-4000-8000-000000000001');

-- Apontamentos: E7 e E8 no S1, mesmo horário, com 20 min de hora extra (a mesma entrada financeira).
insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('5c3bb100-0000-4000-8000-000000000001', '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1', date '2026-03-03'),
  ('5c3bb100-0000-4000-8000-000000000002', '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1', date '2026-03-04');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
  ('5c3bb200-0000-4000-8000-000000000007', '5c3bb100-0000-4000-8000-000000000001', '5c3bf000-0000-4000-8000-000000000007', 'present', '06:00', '15:20', 60),
  ('5c3bb200-0000-4000-8000-000000000008', '5c3bb100-0000-4000-8000-000000000001', '5c3bf000-0000-4000-8000-000000000008', 'present', '06:00', '15:20', 60),
  ('5c3bb200-0000-4000-8000-000000000001', '5c3bb100-0000-4000-8000-000000000002', '5c3bf000-0000-4000-8000-000000000001', 'present', '06:00', '15:00', 60);

-- Colunas financeiras de um apontamento (tudo que o motor deriva), como texto comparável.
create or replace function pg_temp.fin(_id text) returns text language sql as $$
  select (to_jsonb(te) - array['id', 'timesheet_id', 'employee_id', 'created_at', 'updated_at'])::text
    from public.timesheet_entries te where te.id = _id::uuid
$$;
create temporary table _antes on commit drop as
  select pg_temp.fin('5c3bb200-0000-4000-8000-000000000007') as e7,
         pg_temp.fin('5c3bb200-0000-4000-8000-000000000008') as e8,
         pg_temp.fin('5c3bb200-0000-4000-8000-000000000001') as e1;

-- ---------------------------------------------------------------------------
-- C. Catálogo
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. catálogo inicial com quatro funções ativas e códigos estáveis',
  'administrativo|auxiliar_producao|conferente|operador|4',
  (select string_agg(code, '|' order by code) || '|' || count(*) filter (where active)::text from public.job_functions));
select pg_temp.registrar('C2. o catálogo não tem preço nem percentual (só as colunas cadastrais)',
  'active,code,created_at,created_by,id,name,name_key,updated_at,updated_by',
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'job_functions'));
select pg_temp.registrar('C3. código único e nome único ignorando maiúsculas, acento e espaço (23505)',
  'erro 23505|erro 23505|erro 23505|erro 23505',
  pg_temp.erro_de($q$insert into public.job_functions (code, name) values ('conferente', 'Outra')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.job_functions (code, name) values ('outra_a', 'CONFERENTE')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.job_functions (code, name) values ('outra_b', 'Auxiliar  de  Producao')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.job_functions (code, name) values ('outra_c', ' operadór ')$q$));
select pg_temp.exec('c4', $q$select public.criar_funcao('Motorista de Empilhadeira')::text$q$);
select pg_temp.registrar('C4. cadastro de nova função pelo admin: código derivado do nome, ativa', 'ok|motorista_de_empilhadeira|true',
  case when pg_temp.r('c4') ~ '^[0-9a-f-]{36}$' then 'ok' else pg_temp.r('c4') end
  || '|' || (select code from public.job_functions where name = 'Motorista de Empilhadeira')
  || '|' || (select active::text from public.job_functions where name = 'Motorista de Empilhadeira'));
select pg_temp.registrar('C5. nova função duplicada (caixa/acento) ou inválida: recusada pela RPC', 'erro 23505|erro 22023|erro 22023|erro 22023',
  pg_temp.adm($q$select public.criar_funcao('MOTORISTA de empilhadéira')::text$q$)
  || '|' || pg_temp.adm($q$select public.criar_funcao('   ')::text$q$)
  || '|' || pg_temp.adm($q$select public.criar_funcao('!!!')::text$q$)
  || '|' || pg_temp.adm($q$select public.criar_funcao('Fiscal', '9X')::text$q$));
select pg_temp.exec('c6a', format($q$select public.renomear_funcao(%L, 'Conferente de carga')::text$q$, pg_temp.fn('conferente')));
select pg_temp.registrar('C6a. renomear preserva identificador e código', '|conferente|Conferente de carga',
  pg_temp.r('c6a') || '|' || (select code || '|' || name from public.job_functions where id = pg_temp.fn('conferente')));
select pg_temp.registrar('C6b. renomear para um nome que já existe (ignorando caixa) é recusado', 'erro 23505',
  pg_temp.adm(format($q$select public.renomear_funcao(%L, 'operador')::text$q$, pg_temp.fn('conferente'))));
-- devolve o nome (o mapeamento por texto depende dele)
select pg_temp.exec('c6c', format($q$select public.renomear_funcao(%L, 'Conferente')::text$q$, pg_temp.fn('conferente')));
select pg_temp.registrar('C7. exclusão e troca de código recusadas, inclusive para o dono (42501); TRUNCATE recusado (tabela referenciada)', 'erro 42501|erro 42501|erro 0A000',
  pg_temp.erro_de($q$delete from public.job_functions where code = 'operador'$q$)
  || '|' || pg_temp.erro_de($q$update public.job_functions set code = 'outro' where code = 'operador'$q$)
  || '|' || pg_temp.erro_de($q$truncate public.job_functions$q$));

-- ---------------------------------------------------------------------------
-- M. Mapeamento por texto exato
-- ---------------------------------------------------------------------------

select pg_temp.registrar('M1. vincular exatas: E1 (Conferente), E2 (caixa/acento/espaço), E7 e E8 (Operador) = 4',
  '4',
  pg_temp.adm($q$select public.vincular_funcoes_exatas()::text$q$));
select pg_temp.registrar('M2. ligados à função certa; ambíguo, desconhecido, vazio e nulo continuam SEM vínculo',
  'FUN-E1:conferente|FUN-E2:auxiliar_producao|FUN-E3:-|FUN-E4:-|FUN-E5:-|FUN-E6:-|FUN-E7:operador|FUN-E8:operador',
  (select string_agg(e.name || ':' || coalesce(f.code, '-'), '|' order by e.name)
     from public.employees e left join public.job_functions f on f.id = e.job_function_id where e.name like 'FUN-E%'));
select pg_temp.registrar('M3. o texto original de employees.role foi preservado',
  'Conferente|  AUXILIAR de producao |Ajudante|Auxiliar de produção e limpeza|   |nulo',
  (select string_agg(coalesce(e.role, 'nulo'), '|' order by e.name) from public.employees e where e.name in ('FUN-E1', 'FUN-E2', 'FUN-E3', 'FUN-E4', 'FUN-E5', 'FUN-E6')));
select pg_temp.registrar('M4. repetir não vincula de novo nem troca vínculo existente', '0',
  pg_temp.adm($q$select public.vincular_funcoes_exatas()::text$q$));
select pg_temp.registrar('M5a. colaborador SEM função definida é aceito (E3, texto ambíguo)', 'sem',
  (select case when e.job_function_id is null then 'sem' else 'com' end from public.employees e where e.name = 'FUN-E3'));
select pg_temp.exec('m5', $q$update public.employees set job_function_id = (select id from public.job_functions where code = 'auxiliar_producao') where name = 'FUN-E3'$q$);
select pg_temp.registrar('M5b. função padrão escolhida pelo administrador é gravada (E3)', 'nulo|auxiliar_producao',
  pg_temp.r('m5') || '|' || (select f.code from public.employees e join public.job_functions f on f.id = e.job_function_id where e.name = 'FUN-E3'));


-- ---------------------------------------------------------------------------
-- A. Função na alocação
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. alocação histórica (anterior à 039) preservada: sem função', 'nulo',
  (select job_function_id::text from public.operation_team where id = '5c3bb000-0000-4000-8000-000000000001'));
select pg_temp.exec('a2', format($q$insert into public.operation_team (id, operation_id, shift_id, employee_id, job_function_id)
      select '5c3bb000-0000-4000-8000-000000000002', %L, %L, e.id, e.job_function_id from public.employees e where e.name = 'FUN-E2'$q$,
      '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('A2. nova alocação HERDANDO a função padrão (valor explícito, como a tela envia)', 'nulo|auxiliar_producao',
  pg_temp.r('a2') || '|' || (select f.code from public.operation_team t join public.job_functions f on f.id = t.job_function_id
              where t.id = '5c3bb000-0000-4000-8000-000000000002'));
select pg_temp.exec('a3', format($q$insert into public.operation_team (id, operation_id, shift_id, employee_id, job_function_id)
      select '5c3bb000-0000-4000-8000-000000000003', %L, %L, e.id, %L from public.employees e where e.name = 'FUN-E3'$q$,
      '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1', pg_temp.fn('operador')));
select pg_temp.registrar('A3. alocação com função DIFERENTE da padrão (E3: padrão auxiliar, alocado como operador); a padrão não muda',
  'nulo|operador|auxiliar_producao',
  pg_temp.r('a3') || '|' || (select f.code from public.operation_team t join public.job_functions f on f.id = t.job_function_id
              where t.id = '5c3bb000-0000-4000-8000-000000000003')
  || '|' || (select f.code from public.employees e join public.job_functions f on f.id = e.job_function_id where e.name = 'FUN-E3'));
select pg_temp.exec('a4', format($q$insert into public.operation_team (id, operation_id, shift_id, employee_id)
      select '5c3bb000-0000-4000-8000-000000000005', %L, %L, e.id from public.employees e where e.name = 'FUN-E5'$q$,
      '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('A4. alocação sem função continua válida (E5)', 'nulo|nulo',
  pg_temp.r('a4') || '|' || coalesce((select job_function_id::text from public.operation_team where id = '5c3bb000-0000-4000-8000-000000000005'), 'nulo'));
-- E5 recebe a função "administrativo" (ativa); depois a função é inativada.
select pg_temp.exec('a5a', format($q$update public.employees set job_function_id = %L where name = 'FUN-E5'$q$, pg_temp.fn('administrativo')));
select pg_temp.exec('a5b', format($q$update public.operation_team set job_function_id = %L where id = '5c3bb000-0000-4000-8000-000000000005'$q$, pg_temp.fn('administrativo')));
select pg_temp.registrar('A5. colaborador e alocação com função ativa', 'nulo|nulo|administrativo|administrativo',
  pg_temp.r('a5a') || '|' || pg_temp.r('a5b')
  || '|' || (select f.code from public.employees e join public.job_functions f on f.id = e.job_function_id where e.name = 'FUN-E5')
  || '|' || (select f.code from public.operation_team t join public.job_functions f on f.id = t.job_function_id where t.id = '5c3bb000-0000-4000-8000-000000000005'));
select pg_temp.exec('a6', format($q$select public.alterar_situacao_funcao(%L, false)::text$q$, pg_temp.fn('administrativo')));
select pg_temp.registrar('A6. inativar não exclui; a função inativa é RECUSADA em escolha nova (23514)', '|1|false|erro 23514|erro 23514',
  pg_temp.r('a6')
  || '|' || (select count(*)::text from public.job_functions where code = 'administrativo')
  || '|' || (select active::text from public.job_functions where code = 'administrativo')
  || '|' || pg_temp.adm(format($q$update public.employees set job_function_id = %L where name = 'FUN-E6'$q$, pg_temp.fn('administrativo')))
  || '|' || pg_temp.adm(format($q$insert into public.operation_team (operation_id, shift_id, employee_id, job_function_id)
       select %L, %L, e.id, %L from public.employees e where e.name = 'FUN-E6'$q$,
       '5c3be000-0000-4000-8000-0000000000a1', '5c3ba000-0000-4000-8000-0000000000a1', pg_temp.fn('administrativo'))));
select pg_temp.registrar('A7. a função REFERENCIADA e inativada continua nas referências existentes, e o colaborador segue editável',
  'administrativo|administrativo|nulo',
  (select f.code from public.employees e join public.job_functions f on f.id = e.job_function_id where e.name = 'FUN-E5')
  || '|' || (select f.code from public.operation_team t join public.job_functions f on f.id = t.job_function_id
              where t.id = '5c3bb000-0000-4000-8000-000000000005')
  || '|' || pg_temp.adm($q$update public.employees set phone = '0000' where name = 'FUN-E5'$q$));
select pg_temp.registrar('A8. função referenciada não é apagada (nem pela chave estrangeira RESTRICT)', 'erro 42501|2',
  pg_temp.erro_de(format($q$delete from public.job_functions where id = %L$q$, pg_temp.fn('administrativo')))
  || '|' || (select count(*)::text from (select 1 from public.employees where job_function_id = pg_temp.fn('administrativo')
                                          union all select 1 from public.operation_team where job_function_id = pg_temp.fn('administrativo')) x));
select pg_temp.exec('a9', format($q$select public.alterar_situacao_funcao(%L, true)::text$q$, pg_temp.fn('administrativo')));
select pg_temp.registrar('A9. reativar a função', '|true',
  pg_temp.r('a9') || '|' || (select active::text from public.job_functions where code = 'administrativo'));

-- ---------------------------------------------------------------------------
-- T. Período do turno
-- ---------------------------------------------------------------------------

select pg_temp.registrar('T1. turnos históricos SEM classificação (inclusive os que cruzam a meia-noite)', '4|0',
  (select count(*) filter (where shift_period is null)::text || '|' || count(*) filter (where shift_period is not null)::text
     from public.shifts where name in ('S1', 'S2', 'S3', 'S4')));

-- Turnos novos classificados pelo admin (comandos separados: a conferência vem depois).
select pg_temp.registrar('T2a. inserir turno diurno e noturno pelo admin', 'nulo|nulo',
  pg_temp.adm($q$insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, shift_period)
     values ('5c3ba000-0000-4000-8000-0000000000a5', '5c3be000-0000-4000-8000-0000000000a1', 'S5', '06:00', '14:00', 0, 'diurno')$q$)
  || '|' || pg_temp.adm($q$insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, shift_period)
     values ('5c3ba000-0000-4000-8000-0000000000a6', '5c3be000-0000-4000-8000-0000000000a1', 'S6', '18:00', '02:00', 0, 'noturno')$q$));
select pg_temp.registrar('T2b. gravados diurno e noturno, com quem classificou e quando', 'S5:diurno:true:true|S6:noturno:true:true',
  (select string_agg(name || ':' || shift_period || ':' || (shift_period_set_by = '5c3b0000-0000-4000-8000-0000000000a1')::text
                     || ':' || (shift_period_set_at is not null)::text, '|' order by name)
     from public.shifts where name in ('S5', 'S6')));
select pg_temp.registrar('T3. valor fora de diurno/noturno recusado (23514)', 'erro 23514|erro 23514',
  pg_temp.erro_de($q$update public.shifts set shift_period = 'tarde' where name = 'S5'$q$)
  || '|' || pg_temp.erro_de($q$update public.shifts set shift_period = '' where name = 'S5'$q$));
-- Cruzar a meia-noite NÃO decide o período: S2 e S3 cruzam; S3 é classificado DIURNO de propósito.
select pg_temp.registrar('T4a. classificar turnos históricos que cruzam a meia-noite (S2 noturno, S3 diurno)', 'nulo|nulo',
  pg_temp.adm($q$update public.shifts set shift_period = 'noturno' where name = 'S2'$q$)
  || '|' || pg_temp.adm($q$update public.shifts set shift_period = 'diurno' where name = 'S3'$q$));
select pg_temp.registrar('T4b. S2 noturno e S3 diurno, ambos cruzando a meia-noite; S4 segue sem classificação',
  'S2:true:noturno|S3:true:diurno|S4:false:-',
  (select string_agg(name || ':' || crosses_midnight::text || ':' || coalesce(shift_period, '-'), '|' order by name)
     from public.shifts where name in ('S2', 'S3', 'S4')));
select pg_temp.registrar('T5a. classificar S1 (turno JÁ USADO em apontamento) como diurno é permitido', 'nulo',
  pg_temp.adm($q$update public.shifts set shift_period = 'diurno' where name = 'S1'$q$));
select pg_temp.registrar('T5b. horário, pausa, travessia, nome e status de S1 não mudaram', '06:00:00|15:00:00|60|false|S1|active|diurno',
  (select start_time::text || '|' || end_time::text || '|' || break_minutes::text || '|' || crosses_midnight::text || '|' || name
          || '|' || status::text || '|' || shift_period from public.shifts where name = 'S1'));
select pg_temp.registrar('T6. jornada CONGELADA do turno usado preservada: mudar o horário continua recusado (23514)', 'erro 23514|erro 23514',
  pg_temp.adm($q$update public.shifts set start_time = '07:00' where name = 'S1'$q$)
  || '|' || pg_temp.adm($q$update public.shifts set crosses_midnight = true where name = 'S1'$q$));
select pg_temp.registrar('T7. nome e status do turno usado seguem editáveis', 'nulo',
  pg_temp.adm($q$update public.shifts set name = 'S1' where name = 'S1'$q$));
select pg_temp.exec('t8', $q$update public.shifts set end_time = '03:00' where name = 'S6'$q$);
select pg_temp.registrar('T8. turno sem uso: o horário continua editável pelo admin e a classificação não muda', 'nulo|noturno|03:00:00',
  pg_temp.r('t8') || '|' || (select shift_period || '|' || end_time::text from public.shifts where name = 'S6'));
select pg_temp.exec('t9', $q$update public.shifts set shift_period = null where name = 'S6'$q$);
select pg_temp.registrar('T9. desclassificar volta a nulo e limpa quem/quando', 'nulo|nulo|nulo|nulo',
  pg_temp.r('t9')
  || '|' || coalesce((select shift_period from public.shifts where name = 'S6'), 'nulo')
  || '|' || coalesce((select shift_period_set_by::text from public.shifts where name = 'S6'), 'nulo')
  || '|' || coalesce((select shift_period_set_at::text from public.shifts where name = 'S6'), 'nulo'));
select pg_temp.registrar('T10. o período vem do turno ligado à folha, não da função da pessoa: E7 (operador) trabalha em turno diurno',
  'diurno|operador',
  (select s.shift_period || '|' || f.code
     from public.timesheet_entries te
     join public.timesheets t on t.id = te.timesheet_id
     join public.shifts s on s.id = t.shift_id
     join public.employees e on e.id = te.employee_id
     join public.job_functions f on f.id = e.job_function_id
    where te.id = '5c3bb200-0000-4000-8000-000000000007'));

-- ---------------------------------------------------------------------------
-- F. Nenhuma mudança financeira
-- ---------------------------------------------------------------------------

-- Reaplica o cálculo (UPDATE sem mudar o horário) depois de TODAS as mudanças cadastrais acima.
select pg_temp.registrar('F1a. recalcular os apontamentos pelo gatilho do banco', 'nulo|nulo|nulo',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '15:20' where id = '5c3bb200-0000-4000-8000-000000000007'$q$)
  || '|' || pg_temp.adm($q$update public.timesheet_entries set check_out = '15:20' where id = '5c3bb200-0000-4000-8000-000000000008'$q$)
  || '|' || pg_temp.adm($q$update public.timesheet_entries set check_out = '15:00' where id = '5c3bb200-0000-4000-8000-000000000001'$q$));
select pg_temp.registrar('F1. o mesmo apontamento gera os MESMOS valores, componentes e snapshots antes e depois (cobrado, custo, taxas, componentes, versão)',
  'true|true|true',
  ((select e7 from _antes) is not distinct from pg_temp.fin('5c3bb200-0000-4000-8000-000000000007'))::text
  || '|' || ((select e8 from _antes) is not distinct from pg_temp.fin('5c3bb200-0000-4000-8000-000000000008'))::text
  || '|' || ((select e1 from _antes) is not distinct from pg_temp.fin('5c3bb200-0000-4000-8000-000000000001'))::text);
select pg_temp.registrar('F2. E7 (com função, alocação e turno classificado) = E8 nas colunas financeiras', '1',
  (select count(distinct (to_jsonb(te) - array['id', 'employee_id', 'created_at', 'updated_at', 'employee_cost_terms_id'])::text)::text
     from public.timesheet_entries te where te.id in ('5c3bb200-0000-4000-8000-000000000007', '5c3bb200-0000-4000-8000-000000000008')));
select pg_temp.registrar('F3. billed_amount e cost_amount preservados: diária 100 + 30 min cobrados (20 min arredondam para 30 pela regra 15/45 = 9,38); custo 80 + 20 min a 10/h (3,33)', '109.38|83.33',
  (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c3bb200-0000-4000-8000-000000000007'));
select pg_temp.registrar('F4. apontamento antigo sem campo novo: a tabela de apontamentos não ganhou nenhuma coluna de função nem de período', '0',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name in ('timesheets', 'timesheet_entries', 'invoices', 'invoice_items')
      and (column_name like '%job_function%' or column_name like '%shift_period%')));
select pg_temp.registrar('F5. nenhuma função financeira cita função nem período do turno', '0',
  (select count(*)::text from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('derivar_valores_por_vigencia', 'derivar_valores_financeiros', 'gerar_fatura', 'ajustes_de_arredondamento_acumulado',
                      'resumo_financeiro_periodo', 'validar_fechamento_acumulado', 'nucleo_componentes_v2', 'componentes_do_lancamento',
                      'validar_periodo_de_cobranca', 'frequencia_de_fechamento', 'registrar_adicional', 'saldo_de_horas_do_periodo')
      and (prosrc ilike '%job_function%' or prosrc ilike '%shift_period%')));
select pg_temp.exec('f6', $q$select (public.gerar_fatura('5c3bc000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15')).total_amount::text$q$);
select pg_temp.registrar('F6. gerar_fatura inalterada: Σ itens = total = Σ cobrado dos três apontamentos (109,38 + 109,38 + 100)', '318.76|318.76|318.76',
  pg_temp.r('f6')
  || '|' || (select sum(it.amount)::text from public.invoice_items it join public.invoices i on i.id = it.invoice_id
              where i.client_id = '5c3bc000-0000-4000-8000-0000000000c1')
  || '|' || (select sum(billed_amount)::text from public.timesheet_entries where timesheet_id in
              ('5c3bb100-0000-4000-8000-000000000001', '5c3bb100-0000-4000-8000-000000000002')));

-- ---------------------------------------------------------------------------
-- P. Permissões e segurança
-- ---------------------------------------------------------------------------

select pg_temp.registrar('P1. admin autorizado: lê o catálogo e cria função', '5|ok',
  pg_temp.adm($q$select count(*)::text from public.job_functions$q$)
  || '|' || case when pg_temp.adm($q$select public.criar_funcao('Fiscal de doca')::text$q$) ~ '^[0-9a-f-]{36}$' then 'ok' else 'falhou' end);
select pg_temp.registrar('P2. operacional: não lê o catálogo, não cria, não vincula, não altera função nem período (0 linhas / 42501)',
  '0|erro 42501|erro 42501|0|0',
  pg_temp.ope($q$select count(*)::text from public.job_functions$q$)
  || '|' || pg_temp.ope($q$select public.criar_funcao('Intruso')::text$q$)
  || '|' || pg_temp.ope($q$select public.vincular_funcoes_exatas()::text$q$)
  || '|' || pg_temp.ope($q$with u as (update public.employees set job_function_id = null returning 1) select count(*)::text from u$q$)
  || '|' || pg_temp.ope($q$with u as (update public.shifts set shift_period = 'noturno' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('P3. anon: sem leitura nem escrita (42501)', 'erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.anon($q$select count(*)::text from public.job_functions$q$)
  || '|' || pg_temp.anon($q$insert into public.job_functions (code, name) values ('anon_x', 'Anon X')$q$)
  || '|' || pg_temp.anon($q$select public.criar_funcao('Anon')::text$q$)
  || '|' || pg_temp.anon($q$select public.alterar_situacao_funcao(gen_random_uuid(), false)::text$q$));
select pg_temp.registrar('P4. nem o admin escreve direto no catálogo: só pelas RPCs (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.adm($q$insert into public.job_functions (code, name) values ('direto', 'Direto')$q$)
  || '|' || pg_temp.adm($q$update public.job_functions set active = false where code = 'operador'$q$)
  || '|' || pg_temp.adm($q$delete from public.job_functions where code = 'operador'$q$));
select pg_temp.registrar('P5. o papel operacional não lê as colunas novas (grants por coluna intactos)', 'false|false|false|false',
  has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'shift_period', 'SELECT')::text
  || '|' || has_column_privilege('bslog_rpc_operacional', 'public.employees', 'job_function_id', 'SELECT')::text
  || '|' || has_column_privilege('bslog_rpc_operacional', 'public.operation_team', 'job_function_id', 'SELECT')::text
  || '|' || has_table_privilege('bslog_rpc_operacional', 'public.job_functions', 'SELECT')::text);
select pg_temp.registrar('P6. RPCs do catálogo: authenticated sim, anon e service_role não; internas sem EXECUTE de API',
  'true|false|false|true|false|false|false|false',
  has_function_privilege('authenticated', 'public.criar_funcao(text, text)', 'EXECUTE')::text
  || '|' || has_function_privilege('anon', 'public.criar_funcao(text, text)', 'EXECUTE')::text
  || '|' || has_function_privilege('service_role', 'public.criar_funcao(text, text)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.vincular_funcoes_exatas()', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.funcoes_exigir_admin()', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.mapear_funcoes_por_texto_interno()', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.validar_funcao_ativa()', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.normalizar_texto_chave(text)', 'EXECUTE')::text);
select pg_temp.registrar('P7. RLS ligada no catálogo (leitura admin + piso de MFA); RPCs SECURITY DEFINER com search_path fixo', 'true|2|4',
  (select relrowsecurity::text from pg_class where oid = 'public.job_functions'::regclass)
  || '|' || (select count(*)::text from pg_policies where tablename = 'job_functions')
  || '|' || (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('criar_funcao', 'renomear_funcao', 'alterar_situacao_funcao', 'vincular_funcoes_exatas')
        and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%'));
select pg_temp.registrar('P8. auditoria mínima: quem criou/alterou a função e quando', 'true|true',
  (select (created_by = '5c3b0000-0000-4000-8000-0000000000a1')::text from public.job_functions where code = 'motorista_de_empilhadeira')
  || '|' || (select (updated_by = '5c3b0000-0000-4000-8000-0000000000a1' and updated_at >= created_at)::text from public.job_functions where code = 'administrativo'));
select pg_temp.registrar('P9. o banco anuncia a capacidade e mantém as anteriores', 'true|true|true|true',
  pg_temp.adm($q$select (x ->> 'funcoes_turno') || '|' || (x ->> 'periodo_contratual') || '|' || (x ->> 'nucleo_v2') || '|' || (x ->> 'regras_definitivas')
                 from (select public.estado_motor_vigencia() x) q$q$));

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
    raise exception '039_funcoes_e_periodo_do_turno: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
