-- MFA protege só o LOGIN (AUTH-01D.R1, migration 034).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou `psql -f`) DEPOIS das migrations 021 a 034,
-- SÓ em banco descartável/local (Supabase local: `supabase start`). Tudo termina em `rollback`.
-- NUNCA rodar contra Production ou homologação.
--
--   A  admin SEM fator em aal1 executa todas as funções administrativas e financeiras do papel
--   B  admin COM fator em aal1 (TOTP pendente) é barrado no banco, em tudo
--   C  admin COM fator em aal2 executa tudo do papel, sem novo código por operação
--   D  operacional (com ou sem fator, aal1 ou aal2) NUNCA alcança função de admin
--   E  falha fechada: sem claim, claim estranha, conta inexistente e anônimo
--   F  isolamento: papel e dados de terceiros continuam protegidos
--   G  forma: nenhuma policy/função de public lê aal2 cru (exceto o helper e o operacional); grants
--   H  a proteção da 033 (INSERT/UPDATE de taxa com o motor ligado) segue integral

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
) on commit drop;

create or replace function pg_temp.registrar(
  _caso text, _esperado text, _obtido text
) returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido,
          case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;

create or replace function pg_temp.medir_como(
  _papel text, _claims jsonb, _sql text
) returns text language plpgsql as $$
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

create or replace function pg_temp.chamar(_uid text, _aal text, _chamada text) returns text language sql as $$
  select pg_temp.como(_uid, _aal, format('select count(*)::text from (select %s) x', _chamada))
$$;



create or replace function pg_temp.por(_uid text, _aal text, _sql text) returns text language sql as $$
  select pg_temp.como(_uid, _aal, _sql)
$$;
-- 'passa' = o guard de MFA/papel não recusou (qualquer outro erro é de validação do negócio)
create or replace function pg_temp.guard(_uid text, _aal text, _sql text) returns text language sql as $$
  select case when pg_temp.como(_uid, _aal, _sql) = 'erro 42501' then 'nega' else 'passa' end
$$;

insert into auth.users (id) values ('5d000000-0000-4000-8000-000000000001'), ('5d000000-0000-4000-8000-000000000002'), ('5d000000-0000-4000-8000-000000000003'), ('5d000000-0000-4000-8000-000000000004');
insert into auth.sessions (id, user_id, not_after)
  select ('ec' || substr(id::text, 3))::uuid, id, null from auth.users where id::text like '5d000000%';
insert into public.user_roles (user_id, role) values ('5d000000-0000-4000-8000-000000000001', 'admin'), ('5d000000-0000-4000-8000-000000000002', 'admin'), ('5d000000-0000-4000-8000-000000000003', 'operacional'), ('5d000000-0000-4000-8000-000000000004', 'operacional');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('5dfac000-0000-4000-8000-000000000002', '5d000000-0000-4000-8000-000000000002', 't', 'totp', 'verified', now(), now()),
  ('5dfac000-0000-4000-8000-000000000004', '5d000000-0000-4000-8000-000000000004', 't', 'totp', 'verified', now(), now());
insert into public.clients (id, name) values ('5dc00000-0000-4000-8000-0000000000c1', 'AUTH01D cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5dc00000-0000-4000-8000-0000000000d1', '5dc00000-0000-4000-8000-0000000000c1', 'K', 100, 8, 1, 10);
insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason)
  values ('5dc00000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1, 10, 'informada', 'fixture AUTH01D');
insert into public.operations (id, client_id, contract_id, name) values ('5dc00000-0000-4000-8000-0000000000e1', '5dc00000-0000-4000-8000-0000000000c1', '5dc00000-0000-4000-8000-0000000000d1', 'OP');
insert into public.invoices (id, client_id, period_start, period_end) values ('5dc00000-0000-4000-8000-0000000000b1', '5dc00000-0000-4000-8000-0000000000c1', date '2026-01-01', date '2026-01-15');
insert into public.admin_audit_log (action) values ('auth01d_fixture');

-- chamadas administrativas/financeiras representativas (todas passam pelo guard de papel + MFA)
create or replace function pg_temp.lote(_uid text, _aal text) returns text language sql as $$
  select concat_ws('|',
    pg_temp.guard(_uid, _aal, $q$select public.gerar_fatura('5dc00000-0000-4000-8000-0000000000c1', date '2026-04-01', date '2026-04-15')::text$q$),
    pg_temp.guard(_uid, _aal, $q$select public.alterar_motor_vigencia(true, 'teste auth01d', true)::text$q$),
    pg_temp.guard(_uid, _aal, $q$select public.registrar_feriado(date '2026-12-25', 'Natal', 'teste')::text$q$),
    pg_temp.guard(_uid, _aal, $q$select public.registrar_condicao_contrato('5dc00000-0000-4000-8000-0000000000d1', date '2027-01-01', 120, 8, 1, 10, 'reajuste')::text$q$),
    pg_temp.guard(_uid, _aal, $q$select public.sincronizar_colunas_legadas('teste')::text$q$),
    pg_temp.guard(_uid, _aal, $q$select count(*)::text from public.pendencias_implantacao_vigencias()$q$),
    pg_temp.guard(_uid, _aal, $q$select public.salvar_apontamento_admin('5dc00000-0000-4000-8000-0000000000e1', null, date '2026-04-01', '[]'::jsonb)::text$q$))
$$;

-- A. admin SEM fator, aal1 ---------------------------------------------------------------------------
select pg_temp.registrar('A1. admin sem fator em aal1: gerar fatura, motor, feriado, condição, sync, pendências e apontamento passam o guard', 'passa|passa|passa|passa|passa|passa|passa', pg_temp.lote('5d000000-0000-4000-8000-000000000001', 'aal1'));
select pg_temp.registrar('A2. admin sem fator em aal1: escreve e lê invoices, auditorias, motor e acesso por operação', '1|2|1|1|1|true',
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.invoices (client_id, period_start, period_end) values ('5dc00000-0000-4000-8000-0000000000c1', date '2026-02-01', date '2026-02-15') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.invoices') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.admin_audit_log') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.financial_engine_settings') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.user_operation_access (user_id, operation_id) values ('5d000000-0000-4000-8000-000000000003', '5dc00000-0000-4000-8000-0000000000e1') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', 'select (count(*) > 0)::text from public.financial_terms_audit'));
select pg_temp.registrar('A3. admin sem fator em aal1: UPDATE e DELETE de fatura permitidos', '1|1',
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with u as (update public.invoices set notes = 'x' where id = '5dc00000-0000-4000-8000-0000000000b1' returning 1) select count(*)::text from u$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with d as (delete from public.invoices where id = '5dc00000-0000-4000-8000-0000000000b1' returning 1) select count(*)::text from d$q$));

-- B. admin COM fator, aal1 (TOTP pendente) ---------------------------------------------------------
select pg_temp.registrar('B1. admin com fator em aal1: toda a lista administrativa/financeira é recusada', 'nega|nega|nega|nega|nega|nega|nega', pg_temp.lote('5d000000-0000-4000-8000-000000000002', 'aal1'));
select pg_temp.registrar('B2. admin com fator em aal1: não lê nem escreve invoices, auditorias, motor, acesso por operação e cadastros', '0|0|0|0|erro 42501|erro 42501|0',
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.invoices') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.admin_audit_log') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.financial_engine_settings') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.financial_terms_audit') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', $q$with i as (insert into public.invoices (client_id, period_start, period_end) values ('5dc00000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', $q$with i as (insert into public.user_operation_access (user_id, operation_id) values ('5d000000-0000-4000-8000-000000000003', '5dc00000-0000-4000-8000-0000000000e1') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.clients'));
select pg_temp.registrar('B3. admin com fator em aal1: INSERT de taxa legada e UPDATE do cadastro também recusados', 'erro 42501|0',
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', $q$with i as (insert into public.contracts (client_id, name, daily_rate) values ('5dc00000-0000-4000-8000-0000000000c1', 'B3', 77) returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', $q$with u as (update public.clients set name = 'x' returning 1) select count(*)::text from u$q$));

-- C. admin COM fator, aal2 ---------------------------------------------------------------------------
select pg_temp.registrar('C1. admin com fator em aal2: executa toda a lista, sem novo código por operação', 'passa|passa|passa|passa|passa|passa|passa', pg_temp.lote('5d000000-0000-4000-8000-000000000002', 'aal2'));
select pg_temp.registrar('C2. admin com fator em aal2: lê invoices, auditorias, motor e cadastros', '1|1|1|1',
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.invoices') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.admin_audit_log') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.financial_engine_settings') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.clients'));

-- D. operacional: nunca função de admin, em nenhum nível ----------------------------------------------
select pg_temp.registrar('D1. operacional sem fator (aal1 e aal2): lista administrativa recusada', 'nega|nega|nega|nega|nega|nega|nega#nega|nega|nega|nega|nega|nega|nega',
  pg_temp.lote('5d000000-0000-4000-8000-000000000003', 'aal1') || '#' || pg_temp.lote('5d000000-0000-4000-8000-000000000003', 'aal2'));
select pg_temp.registrar('D2. operacional com fator (aal1 e aal2): lista administrativa recusada', 'nega|nega|nega|nega|nega|nega|nega#nega|nega|nega|nega|nega|nega|nega',
  pg_temp.lote('5d000000-0000-4000-8000-000000000004', 'aal1') || '#' || pg_temp.lote('5d000000-0000-4000-8000-000000000004', 'aal2'));
select pg_temp.registrar('D3. operacional não lê nem escreve invoices, auditorias, motor, acesso por operação e cadastros', '0|0|0|0|0|erro 42501|erro 42501',
  pg_temp.por('5d000000-0000-4000-8000-000000000003', 'aal1', 'select count(*)::text from public.invoices') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000003', 'aal1', 'select count(*)::text from public.admin_audit_log') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000003', 'aal2', 'select count(*)::text from public.financial_engine_settings') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000004', 'aal2', 'select count(*)::text from public.financial_terms_audit') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000004', 'aal2', 'select count(*)::text from public.clients') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000003', 'aal1', $q$with i as (insert into public.invoices (client_id, period_start, period_end) values ('5dc00000-0000-4000-8000-0000000000c1', date '2026-05-01', date '2026-05-15') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000004', 'aal2', $q$with i as (insert into public.user_operation_access (user_id, operation_id) values ('5d000000-0000-4000-8000-000000000004', '5dc00000-0000-4000-8000-0000000000e1') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('D4. escalada de papel por API direta: nenhum nível promove, concede ou remove papel (0 linhas ou 42501)', '0|erro 42501|erro 42501|0',
  pg_temp.por('5d000000-0000-4000-8000-000000000003', 'aal1', $q$with u as (update public.user_roles set role = 'admin' where user_id = '5d000000-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.user_roles (user_id, role) values ('5d000000-0000-4000-8000-000000000003', 'admin') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal2', $q$with i as (insert into public.user_roles (user_id, role) values ('5d000000-0000-4000-8000-000000000004', 'admin') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000004', 'aal2', $q$with d as (delete from public.user_roles where user_id = '5d000000-0000-4000-8000-000000000001' returning 1) select count(*)::text from d$q$));

select pg_temp.registrar('D5. depois das tentativas de escalada os papéis são exatamente os da fixture', '2|2',
  (select count(*) filter (where role = 'admin')::text || '|' || count(*) filter (where role = 'operacional')::text from public.user_roles where user_id::text like '5d000000%'));

-- E. falha fechada ---------------------------------------------------------------------------------------
select pg_temp.registrar('E1. o piso nega: sem claim aal, claim estranha, conta inexistente e anônimo', 'false|false|false|false|false',
  pg_temp.medir_como('authenticated', jsonb_build_object('sub', '5d000000-0000-4000-8000-000000000001', 'role', 'authenticated', 'session_id', 'ec' || substr('5d000000-0000-4000-8000-000000000001', 3)), 'select public.mfa_cotidiano_ok()::text') || '|' ||
  pg_temp.medir_como('authenticated', jsonb_build_object('sub', '5d000000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal3', 'session_id', 'ec' || substr('5d000000-0000-4000-8000-000000000001', 3)), 'select public.mfa_cotidiano_ok()::text') || '|' ||
  pg_temp.medir_como('authenticated', jsonb_build_object('sub', '5dffffff-0000-4000-8000-000000000000', 'role', 'authenticated', 'aal', 'aal1'), 'select public.mfa_cotidiano_ok()::text') || '|' ||
  pg_temp.medir_como('authenticated', jsonb_build_object('role', 'authenticated', 'aal', 'aal1'), 'select public.mfa_cotidiano_ok()::text') || '|' ||
  pg_temp.por('5d000000-0000-4000-8000-000000000002', 'aal1', 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('E2. anônimo não executa funções administrativas nem lê tabelas financeiras', 'erro 42501|0|erro 42501',
  pg_temp.medir_como('anon', '{"role":"anon"}'::jsonb, $q$select public.gerar_fatura('5dc00000-0000-4000-8000-0000000000c1', date '2026-04-01', date '2026-04-15')::text$q$) || '|' ||
  pg_temp.medir_como('anon', '{"role":"anon"}'::jsonb, 'select count(*)::text from public.invoices') || '|' ||
  pg_temp.medir_como('anon', '{"role":"anon"}'::jsonb, $q$select public.alterar_motor_vigencia(true, 'x', true)::text$q$));
-- G. forma -------------------------------------------------------------------------------------------------
select pg_temp.registrar('G1. nenhuma policy de public lê aal2 cru', '0',
  (select count(*)::text from pg_policies where schemaname = 'public' and coalesce(qual, '') || coalesce(with_check, '') like '%''aal2''%'));
select pg_temp.registrar('G2. só o helper e a elegibilidade do operacional escrevem aal2 literal em funções de public', 'mfa_cotidiano_ok,operador_elegivel_operacional',
  (select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%''aal2''%'));
select pg_temp.registrar('G3. nenhum grant novo: helper só authenticated; guard, gatilhos e função da 033 sem EXECUTE para anon/authenticated', 'false|true|false|false|false',
  has_function_privilege('anon', 'public.mfa_cotidiano_ok()', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.mfa_cotidiano_ok()', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.condicoes_exigir_admin()', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.exigir_aal2_taxa_legada()', 'execute')::text || '|' ||
  has_function_privilege('anon', 'public.exigir_vigencia_na_taxa_legada()', 'execute')::text);
select pg_temp.registrar('G4. as verificações de PAPEL seguem nas funções críticas', 'true',
  (select bool_and(prosrc ilike '%has_role%' or prosrc ilike '%condicoes_exigir_admin()%')::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('gerar_fatura', 'alterar_motor_vigencia', 'registrar_feriado', 'registrar_condicao_contrato', 'sincronizar_colunas_legadas', 'pendencias_implantacao_vigencias')));

-- H. 033 preservada --------------------------------------------------------------------------------------
select pg_temp.registrar('H1. os 3 gatilhos da 033 seguem habilitados e deferidos', '3',
  (select count(*)::text from pg_trigger where not tgisinternal and tgenabled = 'O' and tgdeferrable and tginitdeferred
      and tgname in ('trg_contracts_exige_vigencia_na_taxa', 'trg_employees_exige_vigencia_na_taxa', 'trg_operations_exige_vigencia_na_taxa')));
create or replace function pg_temp.com_commit(_uid text, _aal text, _sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal, 'session_id', 'ec' || substr(_uid, 3))::text, true);
  set local role authenticated;
  begin
    execute _sql into _r;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    set local role postgres;
    set constraints all deferred;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return coalesce(_r, 'nulo');
end;
$$;
select pg_temp.registrar('H2. motor LIGADO (A1 ligou): admin sem fator em aal1 não cria contrato com taxa sem vigência (55000) nem edita a diária (55000), mas cria pelo cadastro atômico', 'erro 55000|erro 55000|1',
  pg_temp.com_commit('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.contracts (client_id, name, daily_rate) values ('5dc00000-0000-4000-8000-0000000000c1', 'H2 direto', 150) returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.com_commit('5d000000-0000-4000-8000-000000000001', 'aal1', $q$with u as (update public.contracts set daily_rate = 999 where id = '5dc00000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$) || '|' ||
  pg_temp.com_commit('5d000000-0000-4000-8000-000000000001', 'aal1', $q$select count(*)::text from (select public.criar_contrato_com_vigencia('5dc00000-0000-4000-8000-0000000000c1', 'H2 atomico', date '2026-01-01', null, 'active', 130, 8, 1.5, 10, 'teste')) x$q$));

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
    raise exception '034_mfa_somente_login: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
