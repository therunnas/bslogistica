-- Integridade da folha e do histórico + salvamento atômico do admin (C06/C07, migration 031).
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Transação com rollback.
-- NUNCA rodar contra Production nem homologação.
--
--   F  folha fechada não recebe escrita (admin direto), mas `gerar_fatura` grava o vínculo da fatura
--   H  excluir cadastro com histórico NÃO faturado é recusado; faturado segue imutável; reabrir
--      uma folha com apontamento faturado continua permitido (decisão comercial pendente)
--   A  `salvar_apontamento_admin`: folha e linhas na mesma transação, retry sem duplicar,
--      falha parcial sem folha vazia, papéis e MFA
--   R  relatório

begin;

create temporary table _resultado (
  ordem serial, caso text, esperado text, obtido text, situacao text
) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text) returns void
language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido, case when _esperado = _obtido then 'PASS' else 'FAIL' end);
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
create or replace function pg_temp.como(_uid text, _aal text, _sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal, 'session_id', 'ec' || substr(_uid, 3)), _sql)
$$;
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c700000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c700000-0000-4000-8000-0000000000a2', 'aal1', _sql)
$$;
create or replace function pg_temp.adm1(_sql text) returns text language sql as $$
  select pg_temp.como('5c700000-0000-4000-8000-0000000000a1', 'aal1', _sql)
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c700000-0000-4000-8000-0000000000a1'), ('5c700000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec700000-0000-4000-8000-0000000000a1', '5c700000-0000-4000-8000-0000000000a1', null),
  ('ec700000-0000-4000-8000-0000000000a2', '5c700000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c700000-0000-4000-8000-0000000000a1', 'admin'), ('5c700000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01B: o admin desta fixture TEM fator verificado. Assim "admin em AAL1" segue significando
-- TOTP pendente, que continua negado (conta SEM fator em AAL1 é coberta por 032_mfa_opcional.sql).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01B', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin';

insert into public.clients (id, name) values ('5c70c000-0000-4000-8000-0000000000c1', 'C06 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c70d000-0000-4000-8000-0000000000d1', '5c70c000-0000-4000-8000-0000000000c1', 'K', 100, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c70f000-0000-4000-8000-000000000001', 'E1', 80), ('5c70f000-0000-4000-8000-000000000002', 'E2', 80),
  ('5c70f000-0000-4000-8000-000000000003', 'E3', 80), ('5c70f000-0000-4000-8000-000000000004', 'E4 so falta', 80),
  ('5c70f000-0000-4000-8000-000000000005', 'E5 sem historico', 80);
insert into public.operations (id, client_id, contract_id, name) values
  ('5c70e000-0000-4000-8000-0000000000a1', '5c70c000-0000-4000-8000-0000000000c1', '5c70d000-0000-4000-8000-0000000000d1', 'OP1'),
  ('5c70e000-0000-4000-8000-0000000000a2', '5c70c000-0000-4000-8000-0000000000c1', '5c70d000-0000-4000-8000-0000000000d1', 'OP2 sem historico'),
  ('5c70e000-0000-4000-8000-0000000000a3', '5c70c000-0000-4000-8000-0000000000c1', '5c70d000-0000-4000-8000-0000000000d1', 'OP3 so falta'),
  ('5c70e000-0000-4000-8000-0000000000a4', '5c70c000-0000-4000-8000-0000000000c1', '5c70d000-0000-4000-8000-0000000000d1', 'OP4 salvar');

-- folhas abertas, apontamentos, e só depois o fechamento (a folha fechada não aceita escrita)
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c70b000-0000-4000-8000-000000000001', '5c70e000-0000-4000-8000-0000000000a1', null, '2026-03-02', 'open'),
  -- FIN-PR-05 (038): as folhas abertas ficam na 2ª quinzena, fora da competência que F5 fatura.
  ('5c70b000-0000-4000-8000-000000000002', '5c70e000-0000-4000-8000-0000000000a1', null, '2026-03-17', 'open'),
  ('5c70b000-0000-4000-8000-000000000003', '5c70e000-0000-4000-8000-0000000000a3', null, '2026-03-18', 'open');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
  ('5c70b100-0000-4000-8000-000000000001', '5c70b000-0000-4000-8000-000000000001', '5c70f000-0000-4000-8000-000000000001', 'present', '06:00', '15:00', 60),
  ('5c70b100-0000-4000-8000-000000000002', '5c70b000-0000-4000-8000-000000000002', '5c70f000-0000-4000-8000-000000000002', 'present', '06:00', '15:00', 60),
  ('5c70b100-0000-4000-8000-000000000003', '5c70b000-0000-4000-8000-000000000003', '5c70f000-0000-4000-8000-000000000004', 'absent', null, null, 0);
update public.timesheets set status = 'closed' where id = '5c70b000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- F. Folha fechada
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. admin AAL2 não altera apontamento de folha FECHADA (55000)', 'erro 55000',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '16:00' where id = '5c70b100-0000-4000-8000-000000000001'$q$));
select pg_temp.registrar('F2. nem cria apontamento em folha fechada (55000)', 'erro 55000',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes) values ('5c70b000-0000-4000-8000-000000000001', '5c70f000-0000-4000-8000-000000000003', 'present', '06:00', '15:00', 60)$q$));
select pg_temp.registrar('F3. nem move o apontamento da folha fechada para uma aberta (55000)', 'erro 55000',
  pg_temp.adm($q$update public.timesheet_entries set timesheet_id = '5c70b000-0000-4000-8000-000000000002' where id = '5c70b100-0000-4000-8000-000000000001'$q$));
select pg_temp.registrar('F4. folha aberta segue editável (1 linha)', '1',
  pg_temp.adm($q$with u as (update public.timesheet_entries set check_out = '16:00' where id = '5c70b100-0000-4000-8000-000000000002' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('F5. gerar_fatura grava o vínculo da fatura mesmo em folha FECHADA', 'ok',
  case when pg_temp.adm($q$select (public.gerar_fatura('5c70c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).total_amount::text$q$) ~ '^[0-9.]+$' then 'ok' else 'falhou' end);
select pg_temp.registrar('F6. o apontamento da folha fechada ficou vinculado à fatura', '1',
  (select count(invoice_id)::text from public.timesheet_entries where id = '5c70b100-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- H. Histórico e reabertura
-- ---------------------------------------------------------------------------

select pg_temp.registrar('H1. reabrir folha com apontamento FATURADO continua permitido (decisão comercial pendente: não bloqueado)', '1',
  pg_temp.adm($q$with u as (update public.timesheets set status = 'open' where id = '5c70b000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('H2. e o faturado segue imutável depois de reaberta (42501)', 'erro 42501',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '16:00' where id = '5c70b100-0000-4000-8000-000000000001'$q$));
select pg_temp.registrar('H3. excluir colaborador com apontamento NÃO faturado: recusado (55000), histórico preservado', 'erro 55000|1',
  pg_temp.adm($q$delete from public.employees where id = '5c70f000-0000-4000-8000-000000000002'$q$)
  || '|' || (select count(*)::text from public.timesheet_entries where employee_id = '5c70f000-0000-4000-8000-000000000002'));
select pg_temp.registrar('H4. excluir operação com histórico: recusado (55000), folhas e apontamentos preservados', 'erro 55000|2|2',
  pg_temp.adm($q$delete from public.operations where id = '5c70e000-0000-4000-8000-0000000000a1'$q$)
  || '|' || (select count(*)::text from public.timesheets where operation_id = '5c70e000-0000-4000-8000-0000000000a1')
  || '|' || (select count(*)::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id where t.operation_id = '5c70e000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('H5. excluir o CLIENTE com histórico: recusado (a cascata passa pelas operações)', 'true',
  (pg_temp.adm($q$delete from public.clients where id = '5c70c000-0000-4000-8000-0000000000c1'$q$) ~ '^erro (55000|42501)')::text);
select pg_temp.registrar('H6. excluir a folha com apontamento não faturado: recusado (55000)', 'erro 55000',
  pg_temp.adm($q$delete from public.timesheets where id = '5c70b000-0000-4000-8000-000000000002'$q$));
select pg_temp.registrar('H7. colaborador só com FALTA e cadastro sem histórico podem ser excluídos (1|1)', '1|1',
  pg_temp.adm($q$with d as (delete from public.employees where id = '5c70f000-0000-4000-8000-000000000004' returning 1) select count(*)::text from d$q$)
  || '|' || pg_temp.adm($q$with d as (delete from public.employees where id = '5c70f000-0000-4000-8000-000000000005' returning 1) select count(*)::text from d$q$));
select pg_temp.registrar('H8. operação sem histórico e operação só com falta podem ser excluídas (1|1)', '1|1',
  pg_temp.adm($q$with d as (delete from public.operations where id = '5c70e000-0000-4000-8000-0000000000a2' returning 1) select count(*)::text from d$q$)
  || '|' || pg_temp.adm($q$with d as (delete from public.operations where id = '5c70e000-0000-4000-8000-0000000000a3' returning 1) select count(*)::text from d$q$));
select pg_temp.registrar('H9. excluir colaborador com apontamento FATURADO segue recusado (42501 ou 55000)', 'true',
  (pg_temp.adm($q$delete from public.employees where id = '5c70f000-0000-4000-8000-000000000001'$q$) ~ '^erro (42501|55000)')::text);

-- ---------------------------------------------------------------------------
-- A. salvar_apontamento_admin
-- ---------------------------------------------------------------------------

create temporary table _p (j text);
grant select on _p to authenticated;
insert into _p values ('[{"employee_id":"5c70f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00:00","check_out":"15:00:00","break_minutes":60},{"employee_id":"5c70f000-0000-4000-8000-000000000003","status":"absent"}]');
create or replace function pg_temp.cont(_op text) returns text language sql as $$
  select (select count(*) from public.timesheets where operation_id = _op::uuid)::text || '|'
      || (select count(*) from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id where t.operation_id = _op::uuid)::text
$$;

select pg_temp.registrar('A1. cria a folha E as linhas na mesma chamada (folha criada, 2 gravadas, 1 folha, 2 linhas)', 'true|2|1|2',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-04-01', (select j::jsonb from _p)) ->> 'folha_criada')$q$)
  || '|2|' || pg_temp.cont('5c70e000-0000-4000-8000-0000000000a4'));
select pg_temp.registrar('A2. retry idêntico: a mesma folha, sem duplicar folha nem linha (folha_criada false, 1 folha, 2 linhas)', 'false|1|2',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-04-01', (select j::jsonb from _p)) ->> 'folha_criada')$q$)
  || '|' || pg_temp.cont('5c70e000-0000-4000-8000-0000000000a4'));
select pg_temp.registrar('A3. chamada com só uma linha grava só ela (1 gravada)', '1',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-04-01', '[{"employee_id":"5c70f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00:00","check_out":"16:00:00","break_minutes":60}]'::jsonb) ->> 'gravadas')$q$));
select pg_temp.registrar('A3b. E1 passou a sair às 16:00 e a outra linha (falta de E3) ficou intacta', '16:00:00|absent',
  (select check_out::text from public.timesheet_entries where employee_id = '5c70f000-0000-4000-8000-000000000001' and work_date = '2026-04-01')
  || '|' || (select status::text from public.timesheet_entries where employee_id = '5c70f000-0000-4000-8000-000000000003' and work_date = '2026-04-01'));
select pg_temp.registrar('A4. falha parcial (segunda linha com colaborador inexistente): NADA persiste, nem a folha', 'true|0|0',
  (pg_temp.adm($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-05-04', '[{"employee_id":"5c70f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00:00","check_out":"15:00:00","break_minutes":60},{"employee_id":"5c70f000-0000-4000-8000-0000000000ff","status":"present"}]'::jsonb)::text$q$) ~ '^erro 23503')::text
  || '|' || (select count(*)::text from public.timesheets where work_date = '2026-05-04')
  || '|' || (select count(*)::text from public.timesheet_entries where work_date = '2026-05-04'));
select pg_temp.registrar('A5. depois da falha o retry com dados válidos cria a folha', 'true',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-05-04', '[{"employee_id":"5c70f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00:00","check_out":"15:00:00","break_minutes":60}]'::jsonb) ->> 'folha_criada')$q$));
select pg_temp.registrar('A5b. exatamente uma folha e uma linha', '1|1',
  (select count(*)::text from public.timesheets where work_date = '2026-05-04') || '|' || (select count(*)::text from public.timesheet_entries where work_date = '2026-05-04'));

-- A faturar a folha de 01/04 e testar a linha faturada dentro do lote
select pg_temp.registrar('A6. gerar_fatura de 01–15/04 (E1 presente em 01/04) funciona sobre o que o RPC gravou', 'ok',
  case when pg_temp.adm($q$select (public.gerar_fatura('5c70c000-0000-4000-8000-0000000000c1', '2026-04-01', '2026-04-15')).total_amount::text$q$) ~ '^[0-9.]+$' then 'ok' else 'falhou' end);
select pg_temp.registrar('A7. linha faturada no lote: erro 42501 e NADA do lote persiste (E3 segue falta)', 'erro 42501|absent',
  pg_temp.adm($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-04-01', '[{"employee_id":"5c70f000-0000-4000-8000-000000000003","status":"present","check_in":"06:00:00","check_out":"15:00:00","break_minutes":60},{"employee_id":"5c70f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00:00","check_out":"18:00:00","break_minutes":60}]'::jsonb)::text$q$)
  || '|' || (select status::text from public.timesheet_entries where employee_id = '5c70f000-0000-4000-8000-000000000003' and work_date = '2026-04-01'));
update public.timesheets set status = 'closed' where operation_id = '5c70e000-0000-4000-8000-0000000000a4' and work_date = '2026-04-01';
select pg_temp.registrar('A8. folha fechada: o RPC recusa (55000)', 'erro 55000',
  pg_temp.adm($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-04-01', (select j::jsonb from _p))::text$q$));
select pg_temp.registrar('A9. operacional (AAL1) e admin sem MFA recusados (42501)', 'erro 42501|erro 42501',
  pg_temp.ope($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-06-01', (select j::jsonb from _p))::text$q$)
  || '|' || pg_temp.adm1($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-06-01', (select j::jsonb from _p))::text$q$));
select pg_temp.registrar('A10. anon sem EXECUTE; authenticated com; nada foi criado pelos recusados', 'false|true|0',
  has_function_privilege('anon', 'public.salvar_apontamento_admin(uuid,uuid,date,jsonb)', 'execute')::text
  || '|' || has_function_privilege('authenticated', 'public.salvar_apontamento_admin(uuid,uuid,date,jsonb)', 'execute')::text
  || '|' || (select count(*)::text from public.timesheets where work_date = '2026-06-01'));
select pg_temp.registrar('A11. entrada inválida: array vazio, não-array e status ausente (22023)', 'erro 22023|erro 22023|erro 22023',
  pg_temp.adm($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-06-02', '[]'::jsonb)::text$q$)
  || '|' || pg_temp.adm($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-06-02', '{"a":1}'::jsonb)::text$q$)
  || '|' || pg_temp.adm($q$select public.salvar_apontamento_admin('5c70e000-0000-4000-8000-0000000000a4', null, date '2026-06-02', '[{"employee_id":"5c70f000-0000-4000-8000-000000000001"}]'::jsonb)::text$q$));
select pg_temp.registrar('A12. o trigger de folha fechada e as proteções de histórico não dão EXECUTE a ninguém (só dispara)', 'false|false',
  has_function_privilege('authenticated', 'public.bloquear_escrita_em_folha_fechada()', 'execute')::text
  || '|' || has_function_privilege('authenticated', 'public.proteger_historico_nao_faturado()', 'execute')::text);

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao <> 'PASS' order by ordem;
select count(*) filter (where situacao = 'PASS') as passou, count(*) filter (where situacao = 'FAIL') as falhou, count(*) as total from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '030_integridade_folha_e_historico: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
