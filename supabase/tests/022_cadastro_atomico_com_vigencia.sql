-- Migration 026 — cadastro atômico de entidade + vigência inicial (C05-B5.1).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 026 estarem aplicadas, SÓ em banco descartável/homologação. Tudo acontece numa transação que
-- termina em `rollback` (inclusive os registros em auth.users e auth.sessions e a troca do motor).
-- NUNCA rodar contra Production.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  contrato: cria entidade e vigência juntas, com auditoria; falha da vigência desfaz tudo
--   B  colaborador: idem
--   C  operação sem contrato: idem; recusa valor ausente
--   D  com o motor LIGADO as três funções funcionam e o motor não é alterado
--   E  quem pode: admin AAL2 sim; admin AAL1, operacional, sem papel, anônimo e service_role não,
--      e nada é criado quando recusado
--   F  desenho: SECURITY INVOKER, dono postgres, EXECUTE só para authenticated, search_path fixo
--   G  nada é recalculado: apontamentos e faturas existentes ficam byte a byte iguais
--
-- O QUE NÃO PROVA: concorrência entre sessões; nem a camada HTTP (PostgREST), exercitada à parte.

begin;

create temporary table _resultado (ordem serial, caso text, esperado text, obtido text, situacao text) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text) returns void
language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido, case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;

-- Executa SQL com um papel e claims; devolve 'ok' ou 'erro <sqlstate>'. O bloco com EXCEPTION é um
-- subtransação: o que a chamada gravou antes do erro é desfeito, exatamente como numa chamada real.
create or replace function pg_temp.medir_como(_papel text, _claims jsonb, _sql text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', _claims::text, true);
  execute format('set local role %I', _papel);
  begin
    execute _sql;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return 'ok';
end;
$$;

create or replace function pg_temp.como(_uid text, _aal text, _sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal, 'session_id', 'ec' || substr(_uid, 3)), _sql)
$$;
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c0c0000-0000-4000-8000-0000000000b1', 'aal2', _sql)
$$;

-- Fixture: b1 admin, b2 operacional, b3 sem papel, b4 admin usado só em AAL1.
insert into auth.users (id) values
  ('5c0c0000-0000-4000-8000-0000000000b1'), ('5c0c0000-0000-4000-8000-0000000000b2'),
  ('5c0c0000-0000-4000-8000-0000000000b3');
insert into auth.sessions (id, user_id, not_after) values
  ('ec0c0000-0000-4000-8000-0000000000b1', '5c0c0000-0000-4000-8000-0000000000b1', null),
  ('ec0c0000-0000-4000-8000-0000000000b2', '5c0c0000-0000-4000-8000-0000000000b2', null),
  ('ec0c0000-0000-4000-8000-0000000000b3', '5c0c0000-0000-4000-8000-0000000000b3', null);
insert into public.user_roles (user_id, role) values
  ('5c0c0000-0000-4000-8000-0000000000b1', 'admin'),
  ('5c0c0000-0000-4000-8000-0000000000b2', 'operacional');

-- AUTH-01D.R1: o admin desta fixture TEM fator verificado. "Admin em AAL1" segue significando TOTP
-- pendente (barrado no banco). Conta SEM fator em AAL1 trabalha normalmente: ver 034_mfa_somente_login.sql.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01D', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin'
     and not exists (select 1 from auth.mfa_factors f where f.user_id = ur.user_id);

insert into public.clients (id, name) values ('5c0cc000-0000-4000-8000-0000000000cb', 'C05B5 cliente');

-- Dados que NÃO podem mudar (apontamento e fatura existentes, criados antes de tudo).
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5c0cd000-0000-4000-8000-0000000000b0', '5c0cc000-0000-4000-8000-0000000000cb', 'Contrato legado', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values ('5c0cf000-0000-4000-8000-0000000000b0', 'Colaborador legado', 80);
insert into public.operations (id, client_id, contract_id, name)
  values ('5c0ce000-0000-4000-8000-0000000000b0', '5c0cc000-0000-4000-8000-0000000000cb', '5c0cd000-0000-4000-8000-0000000000b0', 'Operação legada');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
  values ('5c0ca000-0000-4000-8000-0000000000b0', '5c0ce000-0000-4000-8000-0000000000b0', 'T', '06:00', '15:00', 60);
insert into public.timesheets (id, operation_id, shift_id, work_date)
  values ('5c0cb000-0000-4000-8000-0000000000b0', '5c0ce000-0000-4000-8000-0000000000b0', '5c0ca000-0000-4000-8000-0000000000b0', date '2026-01-15');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c0cb100-0000-4000-8000-0000000000b0', '5c0cb000-0000-4000-8000-0000000000b0', '5c0cf000-0000-4000-8000-0000000000b0', 'present', '06:00', '17:00', 60);

create temporary table _antes on commit drop as
select (select md5(string_agg(te::text, ';' order by te.id)) from public.timesheet_entries te) as entradas,
       (select md5(string_agg(i::text, ';' order by i.id)) from public.invoices i) as faturas,
       (select count(*) from public.contracts)::int as contratos,
       (select count(*) from public.employees)::int as colaboradores,
       (select count(*) from public.operations)::int as operacoes;

-- ---------------------------------------------------------------------------
-- A. Contrato
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. admin AAL2 cria contrato + vigência inicial numa chamada', 'ok',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato A1', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'Cadastro inicial do contrato')$q$));
select pg_temp.registrar('A2. o contrato e UMA versão aberta nasceram juntos, com os mesmos valores',
  '1|1|2026-01-01|nulo|100.00|8.00|1.50|10|informada',
  (select (select count(*) from public.contracts where name = 'Contrato A1')::text || '|' || count(*)::text || '|' || min(t.valid_from)::text || '|' || coalesce(min(t.valid_to)::text, 'nulo')
          || '|' || min(t.daily_rate)::text || '|' || min(t.shift_hours)::text || '|' || min(t.ot_factor)::text || '|' || min(t.ot_tolerance_min)::text || '|' || min(t.origin)
     from public.contract_terms t join public.contracts c on c.id = t.contract_id where c.name = 'Contrato A1'));
select pg_temp.registrar('A3. a trilha registrou o evento com o ator admin e o motivo', '1|5c0c0000-0000-4000-8000-0000000000b1|Cadastro inicial do contrato',
  (select count(*)::text || '|' || min(a.actor_id::text) || '|' || min(a.reason)
     from public.financial_terms_audit a join public.contracts c on c.id = a.entity_id
    where c.name = 'Contrato A1' and a.action = 'contrato_condicao_registrada'));

-- falha da primeira vigência => nenhum contrato
select pg_temp.registrar('A4. motivo vazio: a chamada falha (22023)', 'erro 22023',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato A4', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, '   ')$q$));
select pg_temp.registrar('A5. ROLLBACK integral: o contrato A4 NÃO ficou (nem versão)', '0|0',
  (select (select count(*) from public.contracts where name = 'Contrato A4')::text || '|' || (select count(*) from public.contract_terms t join public.contracts c on c.id = t.contract_id where c.name = 'Contrato A4')::text));
select pg_temp.registrar('A6. valor com três casas decimais: falha e desfaz (22023)', 'erro 22023|0',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato A6', date '2026-01-01', null, 'active', 100.123, 8, 1.5, 10, 'x')$q$)
  || '|' || (select count(*) from public.contracts where name = 'Contrato A6')::text);
select pg_temp.registrar('A7. jornada zero: a CHECK da tabela recusa (23514) e nada é criado', 'erro 23514|0',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato A7', date '2026-01-01', null, 'active', 100, 0, 1.5, 10, 'x')$q$)
  || '|' || (select count(*) from public.contracts where name = 'Contrato A7')::text);
select pg_temp.registrar('A8. cliente inexistente: falha no INSERT (23503) e nada é criado', 'erro 23503|0',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000ff', 'Contrato A8', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x')$q$)
  || '|' || (select count(*) from public.contracts where name = 'Contrato A8')::text);
select pg_temp.registrar('A9. status inválido: falha (22P02) e nada é criado', 'erro 22P02|0',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato A9', date '2026-01-01', null, 'nao-existe', 100, 8, 1.5, 10, 'x')$q$)
  || '|' || (select count(*) from public.contracts where name = 'Contrato A9')::text);
select pg_temp.registrar('A10. as recusas não deixaram evento na trilha além do A1', '1',
  (select count(*)::text from public.financial_terms_audit where actor_id = '5c0c0000-0000-4000-8000-0000000000b1' and action = 'contrato_condicao_registrada'));

-- ---------------------------------------------------------------------------
-- B. Colaborador
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. admin AAL2 cria colaborador + custo inicial', 'ok',
  pg_temp.adm($q$select public.criar_colaborador_com_vigencia('Colab B1', '123', 'Ajudante', '1199', 'active', 80, date '2026-01-01', 'Cadastro inicial do colaborador')$q$));
select pg_temp.registrar('B2. colaborador e UMA versão aberta de custo, com os dados informados', '1|1|2026-01-01|nulo|80.00|Ajudante|123',
  (select (select count(*) from public.employees where name = 'Colab B1')::text || '|' || count(*)::text || '|' || min(t.valid_from)::text || '|' || coalesce(min(t.valid_to)::text, 'nulo') || '|' || min(t.daily_cost)::text
          || '|' || min(e.role) || '|' || min(e.doc)
     from public.employee_cost_terms t join public.employees e on e.id = t.employee_id where e.name = 'Colab B1'));
select pg_temp.registrar('B3. auditoria do custo inicial', '1',
  (select count(*)::text from public.financial_terms_audit a join public.employees e on e.id = a.entity_id
    where e.name = 'Colab B1' and a.action = 'colaborador_custo_registrado' and a.actor_id = '5c0c0000-0000-4000-8000-0000000000b1'));
select pg_temp.registrar('B4. custo negativo: a CHECK da tabela recusa (23514) e nada é criado', 'erro 23514|0',
  pg_temp.adm($q$select public.criar_colaborador_com_vigencia('Colab B4', null, null, null, 'active', -1, date '2026-01-01', 'x')$q$)
  || '|' || (select count(*) from public.employees where name = 'Colab B4')::text);
select pg_temp.registrar('B5. motivo vazio: falha e desfaz o colaborador', 'erro 22023|0',
  pg_temp.adm($q$select public.criar_colaborador_com_vigencia('Colab B5', null, null, null, 'active', 80, date '2026-01-01', '')$q$)
  || '|' || (select count(*) from public.employees where name = 'Colab B5')::text);
select pg_temp.registrar('B6. início da vigência ausente: falha e desfaz', 'erro 22023|0',
  pg_temp.adm($q$select public.criar_colaborador_com_vigencia('Colab B6', null, null, null, 'active', 80, null, 'x')$q$)
  || '|' || (select count(*) from public.employees where name = 'Colab B6')::text);

-- ---------------------------------------------------------------------------
-- C. Operação sem contrato
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. admin AAL2 cria operação sem contrato + valor acordado inicial', 'ok',
  pg_temp.adm($q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'fixed', 'Operação C1', 'Doca 1', null, 'active', 'obs', 100, date '2026-01-01', 'Cadastro inicial da operação')$q$));
select pg_temp.registrar('C2. operação sem contrato com UMA versão aberta de valor acordado', '1|nulo|1|2026-01-01|nulo|100.00|100.00|Doca 1',
  (select (select count(*) from public.operations where name = 'Operação C1')::text || '|' || coalesce(min(o.contract_id::text), 'nulo') || '|' || count(*)::text || '|' || min(t.valid_from)::text
          || '|' || coalesce(min(t.valid_to)::text, 'nulo') || '|' || min(t.agreed_amount)::text || '|' || min(o.agreed_amount)::text || '|' || min(o.site)
     from public.operation_terms t join public.operations o on o.id = t.operation_id where o.name = 'Operação C1'));
select pg_temp.registrar('C3. auditoria do valor acordado inicial', '1',
  (select count(*)::text from public.financial_terms_audit a join public.operations o on o.id = a.entity_id
    where o.name = 'Operação C1' and a.action = 'operacao_valor_registrado' and a.actor_id = '5c0c0000-0000-4000-8000-0000000000b1'));
select pg_temp.registrar('C4. valor acordado ausente: recusado (22023), nada criado', 'erro 22023|0',
  pg_temp.adm($q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'fixed', 'Operação C4', null, null, 'active', null, null, date '2026-01-01', 'x')$q$)
  || '|' || (select count(*) from public.operations where name = 'Operação C4')::text);
select pg_temp.registrar('C5. motivo vazio: falha e desfaz a operação', 'erro 22023|0',
  pg_temp.adm($q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'fixed', 'Operação C5', null, null, 'active', null, 100, date '2026-01-01', ' ')$q$)
  || '|' || (select count(*) from public.operations where name = 'Operação C5')::text);
select pg_temp.registrar('C6. valor acordado negativo: a CHECK da tabela recusa (23514) e nada é criado', 'erro 23514|0',
  pg_temp.adm($q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'fixed', 'Operação C6', null, null, 'active', null, -5, date '2026-01-01', 'x')$q$)
  || '|' || (select count(*) from public.operations where name = 'Operação C6')::text);
select pg_temp.registrar('C7. tipo inválido: falha (22P02) e nada é criado', 'erro 22P02|0',
  pg_temp.adm($q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'x', 'Operação C7', null, null, 'active', null, 100, date '2026-01-01', 'x')$q$)
  || '|' || (select count(*) from public.operations where name = 'Operação C7')::text);

-- ---------------------------------------------------------------------------
-- D. Motor LIGADO (o motor é religado ao fim; a transação inteira é revertida)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D0. motor desligado antes do teste', 'false', (select vigencia_ativa::text from public.financial_engine_settings));
-- AUTH-01C.1: verifica os eventos deferidos da 033 antes de o motor fazer ALTER TABLE na mesma transação.
set constraints all immediate;
set constraints all deferred;

select pg_temp.registrar('D1. admin AAL2 liga o motor (pré-condição do bloco)', 'ok',
  pg_temp.adm($q$select public.alterar_motor_vigencia(true, 'Teste do cadastro atômico', true)$q$));
select pg_temp.registrar('D2. contrato com o motor LIGADO: criado com a vigência', 'ok',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato D2', date '2026-02-01', null, 'active', 110, 8, 1.5, 10, 'Cadastro inicial do contrato')$q$));
select pg_temp.registrar('D3. colaborador com o motor LIGADO: criado com o custo', 'ok',
  pg_temp.adm($q$select public.criar_colaborador_com_vigencia('Colab D3', null, null, null, 'active', 75, date '2026-02-01', 'Cadastro inicial do colaborador')$q$));
select pg_temp.registrar('D4. operação sem contrato com o motor LIGADO: criada com o valor', 'ok',
  pg_temp.adm($q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'spot', 'Operação D4', null, date '2026-02-01', 'active', null, 90, date '2026-02-01', 'Cadastro inicial da operação')$q$));
select pg_temp.registrar('D5. as três entidades têm exatamente UMA versão ativa cada', '1|1|1',
  (select (select count(*) from public.contract_terms t join public.contracts c on c.id = t.contract_id where c.name = 'Contrato D2' and t.active)::text
     || '|' || (select count(*) from public.employee_cost_terms t join public.employees e on e.id = t.employee_id where e.name = 'Colab D3' and t.active)::text
     || '|' || (select count(*) from public.operation_terms t join public.operations o on o.id = t.operation_id where o.name = 'Operação D4' and t.active)::text));
select pg_temp.registrar('D6. falha da vigência com o motor LIGADO também desfaz o contrato', 'erro 22023|0',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato D6', date '2026-02-01', null, 'active', 110, 8, 1.5, 10, '')$q$)
  || '|' || (select count(*) from public.contracts where name = 'Contrato D6')::text);
select pg_temp.registrar('D7. com o motor ligado, nenhuma entidade criada pelas funções fica sem vigência', '0',
  (select (select count(*) from public.contracts c where c.name in ('Contrato D2', 'Contrato A1') and not exists (select 1 from public.contract_terms t where t.contract_id = c.id))
        + (select count(*) from public.employees e where e.name in ('Colab D3', 'Colab B1') and not exists (select 1 from public.employee_cost_terms t where t.employee_id = e.id))
        + (select count(*) from public.operations o where o.name in ('Operação D4', 'Operação C1') and not exists (select 1 from public.operation_terms t where t.operation_id = o.id)))::text);
select pg_temp.registrar('D8. as funções não mudaram o estado do motor (continua ligado)', 'true', (select vigencia_ativa::text from public.financial_engine_settings));
select pg_temp.registrar('D9. o apontamento legado não foi recalculado nem ganhou versão (ainda sem referência de vigência)', 'nulo',
  (select coalesce(contract_terms_id::text, 'nulo') from public.timesheet_entries where id = '5c0cb100-0000-4000-8000-0000000000b0'));
set constraints all immediate;
set constraints all deferred;
select pg_temp.registrar('D10. desliga o motor de volta', 'ok',
  pg_temp.adm($q$select public.alterar_motor_vigencia(false, 'Fim do teste do cadastro atômico')$q$));

-- ---------------------------------------------------------------------------
-- E. Quem pode
-- ---------------------------------------------------------------------------

create temporary table _n on commit drop as select
  (select count(*) from public.contracts) as c, (select count(*) from public.employees) as e, (select count(*) from public.operations) as o;

select pg_temp.registrar('E1. admin em AAL1 é recusado', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000b1', 'aal1', $q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato E1', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E2. operacional (AAL1) é recusado', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000b2', 'aal1', $q$select public.criar_colaborador_com_vigencia('Colab E2', null, null, null, 'active', 80, date '2026-01-01', 'x')$q$));
select pg_temp.registrar('E3. operacional em AAL2 também é recusado', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000b2', 'aal2', $q$select public.criar_operacao_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'fixed', 'Operação E3', null, null, 'active', null, 100, date '2026-01-01', 'x')$q$));
select pg_temp.registrar('E4. conta sem papel é recusada', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000b3', 'aal2', $q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato E4', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E5. anônimo não tem EXECUTE', 'erro 42501',
  pg_temp.medir_como('anon', '{"role":"anon"}'::jsonb, $q$select public.criar_colaborador_com_vigencia('Colab E5', null, null, null, 'active', 80, date '2026-01-01', 'x')$q$));
select pg_temp.registrar('E6. service_role não tem EXECUTE', 'erro 42501',
  pg_temp.medir_como('service_role', '{"role":"service_role"}'::jsonb, $q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato E6', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E7. sessão inexistente (session_id que não está em auth.sessions) é recusada', 'erro 42501',
  pg_temp.medir_como('authenticated', jsonb_build_object('sub', '5c0c0000-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal2', 'session_id', 'ec0c0000-0000-4000-8000-0000000000ff'),
    $q$select public.criar_contrato_com_vigencia('5c0cc000-0000-4000-8000-0000000000cb', 'Contrato E7', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E8. nada foi criado por nenhuma chamada recusada', '0|0|0',
  (select ((select count(*) from public.contracts) - c)::text || '|' || ((select count(*) from public.employees) - e)::text || '|' || ((select count(*) from public.operations) - o)::text from _n));

-- ---------------------------------------------------------------------------
-- F. Desenho
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. SECURITY INVOKER (não elevam privilégio), dono postgres, search_path fixo', '3|0|3|3',
  (select count(*)::text || '|' || count(*) filter (where p.prosecdef)::text || '|' || count(*) filter (where p.proowner = 'postgres'::regrole)::text
          || '|' || count(*) filter (where p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%')::text
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('criar_contrato_com_vigencia', 'criar_colaborador_com_vigencia', 'criar_operacao_com_vigencia')));
select pg_temp.registrar('F2. EXECUTE só para authenticated (e o dono)', 'true|false|false|false|false',
  (select has_function_privilege('authenticated', 'public.criar_contrato_com_vigencia(uuid,text,date,date,text,numeric,numeric,numeric,integer,text,text,numeric,numeric,text)', 'execute')::text
     || '|' || has_function_privilege('anon', 'public.criar_contrato_com_vigencia(uuid,text,date,date,text,numeric,numeric,numeric,integer,text,text,numeric,numeric,text)', 'execute')::text
     || '|' || has_function_privilege('service_role', 'public.criar_colaborador_com_vigencia(text,text,text,text,text,numeric,date,text,numeric)', 'execute')::text
     || '|' || has_function_privilege('bslog_rpc_operacional', 'public.criar_operacao_com_vigencia(uuid,text,text,text,date,text,text,numeric,date,text)', 'execute')::text
     || '|' || has_function_privilege('anon', 'public.criar_operacao_com_vigencia(uuid,text,text,text,date,text,text,numeric,date,text)', 'execute')::text));

-- ---------------------------------------------------------------------------
-- G. Nada recalculado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('G1. apontamentos existentes ficam byte a byte iguais', 'true',
  (select ((select md5(string_agg(te::text, ';' order by te.id)) from public.timesheet_entries te) = entradas)::text from _antes));
select pg_temp.registrar('G2. faturas existentes ficam iguais (nenhuma)', 'true',
  (select (coalesce((select md5(string_agg(i::text, ';' order by i.id)) from public.invoices i), '') = coalesce(faturas, ''))::text from _antes));
select pg_temp.registrar('G3. as entidades legadas continuam SEM versão (nenhuma vigência presumida)', '0',
  (select ((select count(*) from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-0000000000b0')
         + (select count(*) from public.employee_cost_terms where employee_id = '5c0cf000-0000-4000-8000-0000000000b0'))::text));

select ordem, situacao, caso, esperado, obtido from _resultado where situacao <> 'PASS' order by ordem;
select count(*) filter (where situacao = 'PASS') as passou, count(*) filter (where situacao = 'FAIL') as falhou, count(*) as total from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '022_cadastro_atomico_com_vigencia: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
