-- MFA opcional com AAL2 mantido nas operações críticas (AUTH-01B, migration 032).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 032 estarem aplicadas, SÓ em banco descartável/local. Tudo acontece numa transação que termina
-- em `rollback` (inclusive os registros em auth.users, auth.sessions e auth.mfa_factors).
-- NUNCA rodar contra Production ou homologação.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  o piso do uso cotidiano: AAL2, ou AAL1 de conta SEM fator verificado; falha fechada
--   B  tabelas cotidianas: admin sem fator trabalha em AAL1; com fator, só em AAL2; operacional
--      nunca vira admin
--   C  leitura de faturas e vigências em AAL1 sem fator; com fator, só em AAL2
--   D  escrita crítica NEGADA em AAL1, mesmo sem fator, e permitida em AAL2; auditoria e motor
--      (configuração) continuam só em AAL2
--   E  RPCs: leituras cotidianas aceitam AAL1 sem fator; operações críticas exigem AAL2
--   F  apontamento do admin (cotidiano)
--   G  fator removido / adicionado muda o piso na próxima requisição (sessão após a remoção)
--   H  forma: o que continua estrito, helpers sem permissão indevida

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


-- ---------------------------------------------------------------------------
-- Fixture: contas (admin sem fator, admin com fator, admin com fator NÃO verificado, operacional
-- sem fator, operacional com fator) e um cliente com contrato, operação, turno, colaborador,
-- fatura e vigência. Nenhum dado fica depois do rollback.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5a000000-0000-4000-8000-000000000001'),
  ('5a000000-0000-4000-8000-000000000002'),
  ('5a000000-0000-4000-8000-000000000003'),
  ('5a000000-0000-4000-8000-000000000004'),
  ('5a000000-0000-4000-8000-000000000005');
insert into auth.sessions (id, user_id, not_after)
  select ('ec' || substr(id::text, 3))::uuid, id, null from auth.users where id::text like '5a000000%';
insert into public.user_roles (user_id, role) values
  ('5a000000-0000-4000-8000-000000000001', 'admin'),
  ('5a000000-0000-4000-8000-000000000002', 'admin'),
  ('5a000000-0000-4000-8000-000000000003', 'admin'),
  ('5a000000-0000-4000-8000-000000000004', 'operacional'),
  ('5a000000-0000-4000-8000-000000000005', 'operacional');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('5afac000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000002', 't', 'totp', 'verified', now(), now()),
  ('5afac000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000003', 't', 'totp', 'unverified', now(), now()),
  ('5afac000-0000-4000-8000-000000000005', '5a000000-0000-4000-8000-000000000005', 't', 'totp', 'verified', now(), now());

insert into public.clients (id, name) values ('5ac00000-0000-4000-8000-0000000000c1', 'AUTH01B cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5ac00000-0000-4000-8000-0000000000d1', '5ac00000-0000-4000-8000-0000000000c1', 'K', 100, 8, 1, 10);
insert into public.operations (id, client_id, contract_id, name)
  values ('5ac00000-0000-4000-8000-0000000000e1', '5ac00000-0000-4000-8000-0000000000c1', '5ac00000-0000-4000-8000-0000000000d1', 'OP');
insert into public.shifts (id, operation_id, name, start_time, end_time)
  values ('5ac00000-0000-4000-8000-0000000000f1', '5ac00000-0000-4000-8000-0000000000e1', 'T1', '08:00', '16:00');
insert into public.employees (id, name) values ('5ac00000-0000-4000-8000-0000000000a1', 'Colaborador AUTH01B');
insert into public.invoices (id, client_id, period_start, period_end)
  values ('5ac00000-0000-4000-8000-0000000000b1', '5ac00000-0000-4000-8000-0000000000c1', date '2026-01-01', date '2026-01-15');
insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason)
  values ('5ac00000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1, 10, 'informada', 'fixture AUTH01B');
insert into public.admin_audit_log (action) values ('auth01b_fixture');

create or replace function pg_temp.por(_uid text, _aal text, _sql text) returns text language sql as $$
  select pg_temp.como(_uid, _aal, _sql)
$$;







-- A. Piso do uso cotidiano ---------------------------------------------------------------------
select pg_temp.registrar('A1. admin SEM fator em AAL1: piso cotidiano ok', 'true', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('A2. admin COM fator verificado em AAL1: NÃO (TOTP pendente)', 'false', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('A3. admin COM fator em AAL2: ok', 'true', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('A4. fator NÃO verificado não bloqueia (conta sem fator ativo)', 'true', pg_temp.por('5a000000-0000-4000-8000-000000000003', 'aal1', 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('A5. claim aal ausente: falha fechada', 'false',
  pg_temp.medir_como('authenticated', jsonb_build_object('sub', '5a000000-0000-4000-8000-000000000001', 'role', 'authenticated'), 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('A6. conta que não existe mais: falha fechada', 'false',
  pg_temp.por('5a000000-0000-4000-8000-0000000000ff', 'aal1', 'select public.mfa_cotidiano_ok()::text'));
select pg_temp.registrar('A7. anônimo não executa o helper', 'erro 42501',
  pg_temp.medir_como('anon', '{}'::jsonb, 'select public.mfa_cotidiano_ok()::text'));

-- B. Tabelas cotidianas ------------------------------------------------------------------------
select pg_temp.registrar('B1. admin sem fator em AAL1 enxerga clientes', '1', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.clients'));
select pg_temp.registrar('B2. admin COM fator em AAL1 não enxerga nada', '0', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.clients'));
select pg_temp.registrar('B3. admin COM fator em AAL2 enxerga', '1', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.clients'));
select pg_temp.registrar('B4. admin sem fator em AAL1 cadastra cliente', '1',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.clients (name) values ('AUTH01B novo') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('B5. operacional sem fator em AAL1 NÃO vira admin nas tabelas', '0', pg_temp.por('5a000000-0000-4000-8000-000000000004', 'aal1', 'select count(*)::text from public.clients'));
select pg_temp.registrar('B6. admin sem fator em AAL1: operações e colaboradores', '1|1',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.operations') || '|' || pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.employees'));
select pg_temp.registrar('B7. admin COM fator em AAL1 não cadastra cliente', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', $q$with i as (insert into public.clients (name) values ('AUTH01B negado') returning 1) select count(*)::text from i$q$));

-- C. Leitura de faturas e vigências ---------------------------------------------------------------
select pg_temp.registrar('C1. admin sem fator em AAL1 lê faturas', '1', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.invoices'));
select pg_temp.registrar('C2. admin COM fator em AAL1 não lê faturas', '0', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.invoices'));
select pg_temp.registrar('C3. admin sem fator em AAL1 lê vigências de contrato', '1', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.contract_terms'));
select pg_temp.registrar('C4. admin COM fator em AAL1 não lê vigências', '0', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.contract_terms'));
select pg_temp.registrar('C5. operacional não lê vigências em nenhum nível', '0|0',
  pg_temp.por('5a000000-0000-4000-8000-000000000004', 'aal1', 'select count(*)::text from public.contract_terms') || '|' || pg_temp.por('5a000000-0000-4000-8000-000000000005', 'aal2', 'select count(*)::text from public.contract_terms'));

-- D. Escrita crítica e auditoria ------------------------------------------------------------------
select pg_temp.registrar('D1. INSERT em invoices por admin sem fator em AAL1: NEGADO', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.invoices (client_id, period_start, period_end) values ('5ac00000-0000-4000-8000-0000000000c1', date '2026-02-01', date '2026-02-15') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('D2. UPDATE em invoices por admin sem fator em AAL1: 0 linhas', '0',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$with u as (update public.invoices set notes = 'sem mfa' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('D3. UPDATE em invoices em AAL2: permitido', '1',
  pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', $q$with u as (update public.invoices set notes = 'com mfa' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('D4. DELETE em invoices por admin sem fator em AAL1: 0 linhas e a fatura segue', '0|1',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$with d as (delete from public.invoices returning 1) select count(*)::text from d$q$) || '|' || (select count(*)::text from public.invoices));
select pg_temp.registrar('D5. escrita direta em vigência: sem policy permissiva, negada até em AAL2', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', $q$with i as (insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason) values ('5ac00000-0000-4000-8000-0000000000d1', date '2026-03-01', 1, 8, 1, 10, 'informada', 'direto') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('D6. configuração do motor: admin sem fator em AAL1 não enxerga', '0', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.financial_engine_settings'));
select pg_temp.registrar('D7. configuração do motor: admin em AAL2 enxerga', '1', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.financial_engine_settings'));
select pg_temp.registrar('D8. auditoria administrativa: sem fator em AAL1 não enxerga; AAL2 enxerga', '0|1',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.admin_audit_log') || '|' || pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.admin_audit_log'));
select pg_temp.registrar('D9. acesso por operação (user_operation_access): sem fator em AAL1 não escreve', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$with i as (insert into public.user_operation_access (user_id, operation_id) values ('5a000000-0000-4000-8000-000000000004', '5ac00000-0000-4000-8000-0000000000e1') returning 1) select count(*)::text from i$q$));

-- E. RPCs ----------------------------------------------------------------------------------------
select pg_temp.registrar('E1. estado do motor (leitura): admin sem fator em AAL1 ok', 'true', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select (public.estado_motor_vigencia() is not null)::text'));
select pg_temp.registrar('E2. estado do motor: admin COM fator em AAL1 negado', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select (public.estado_motor_vigencia() is not null)::text'));
select pg_temp.registrar('E3. estado do motor: operacional negado', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000004', 'aal1', 'select (public.estado_motor_vigencia() is not null)::text'));
select pg_temp.registrar('E4. estado do motor: admin em AAL2 ok', 'true', pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', 'select (public.estado_motor_vigencia() is not null)::text'));
select pg_temp.registrar('E5. resumo financeiro (leitura): AAL1 sem fator = AAL2, sem erro',
  pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', 'select count(*)::text from public.resumo_financeiro_periodo(date ''2026-01-01'', date ''2026-01-31'', null, null)'),
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.resumo_financeiro_periodo(date ''2026-01-01'', date ''2026-01-31'', null, null)'));
select pg_temp.registrar('E6. CRÍTICO negado em AAL1 mesmo SEM fator: ativar motor', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$select public.alterar_motor_vigencia(true, 'sem mfa', false)::text$q$));
select pg_temp.registrar('E7. CRÍTICO negado em AAL1 sem fator: gerar fatura', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$select public.gerar_fatura('5ac00000-0000-4000-8000-0000000000c1', date '2026-04-01', date '2026-04-15')::text$q$));
select pg_temp.registrar('E8. CRÍTICO negado em AAL1 sem fator: registrar feriado', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$select public.registrar_feriado(date '2026-12-25', 'Natal', 'Teste sem mfa')::text$q$));
select pg_temp.registrar('E9. CRÍTICO negado em AAL1 sem fator: registrar condição de contrato (reajuste)', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$select public.registrar_condicao_contrato('5ac00000-0000-4000-8000-0000000000d1', date '2026-05-01', 120, 8, 1, 10, 'Reajuste sem mfa', null, true, null, null, null)::text$q$));
select pg_temp.registrar('E10. CRÍTICO negado em AAL1 sem fator: sincronizar colunas', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$select public.sincronizar_colunas_legadas('sem mfa')::text$q$));
select pg_temp.registrar('E11. CRÍTICO negado em AAL1 sem fator: pendências da implantação', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.pendencias_implantacao_vigencias()'));
select pg_temp.registrar('E12. CRÍTICO em AAL2: o guard passa (o erro, se houver, é de validação, nunca 42501 de MFA)', 'true',
  (pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal2', $q$select public.registrar_feriado(date '2026-12-25', 'Natal', 'Teste com mfa')::text$q$) <> 'erro 42501')::text);
select pg_temp.registrar('E13. operacional em AAL2 não chega às RPCs administrativas', 'erro 42501', pg_temp.por('5a000000-0000-4000-8000-000000000005', 'aal2', 'select (public.estado_motor_vigencia() is not null)::text'));

-- F. Apontamento do admin ----------------------------------------------------------------------------
select pg_temp.registrar('F1. salvar apontamento: admin sem fator em AAL1 passa o guard', 'true',
  (pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', $q$select public.salvar_apontamento_admin('5ac00000-0000-4000-8000-0000000000e1', '5ac00000-0000-4000-8000-0000000000f1', date '2026-01-10', '[]'::jsonb)::text$q$) <> 'erro 42501')::text);
select pg_temp.registrar('F2. salvar apontamento: admin COM fator em AAL1 negado', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', $q$select public.salvar_apontamento_admin('5ac00000-0000-4000-8000-0000000000e1', '5ac00000-0000-4000-8000-0000000000f1', date '2026-01-10', '[]'::jsonb)::text$q$));
select pg_temp.registrar('F3. salvar apontamento: operacional negado', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000004', 'aal1', $q$select public.salvar_apontamento_admin('5ac00000-0000-4000-8000-0000000000e1', '5ac00000-0000-4000-8000-0000000000f1', date '2026-01-10', '[]'::jsonb)::text$q$));

-- G. Fator removido / adicionado -----------------------------------------------------------------
delete from auth.mfa_factors where id = '5afac000-0000-4000-8000-000000000002';
select pg_temp.registrar('G1. fator removido: o admin volta a trabalhar em AAL1 (a policy lê o banco, não o cookie)', 'true|2',
  pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select public.mfa_cotidiano_ok()::text') || '|' || pg_temp.por('5a000000-0000-4000-8000-000000000002', 'aal1', 'select count(*)::text from public.clients'));
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values ('5afac000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-000000000001', 't', 'totp', 'verified', now(), now());
select pg_temp.registrar('G2. fator cadastrado e verificado: AAL1 passa a ser barrado na hora', 'false|0',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select public.mfa_cotidiano_ok()::text') || '|' || pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal1', 'select count(*)::text from public.clients'));
select pg_temp.registrar('G3. com o fator, AAL2 continua liberando', 'true|2',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal2', 'select public.mfa_cotidiano_ok()::text') || '|' || pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal2', 'select count(*)::text from public.clients'));
select pg_temp.registrar('G4. cada um só enxerga o próprio fator (terceiro não vê auth.mfa_factors)', 'erro 42501',
  pg_temp.por('5a000000-0000-4000-8000-000000000001', 'aal2', 'select count(*)::text from auth.mfa_factors'));

-- H. Forma ----------------------------------------------------------------------------------------------
select pg_temp.registrar('H1. condicoes_exigir_admin() segue estrita (AAL2 escrito dentro)', 'true',
  (select (prosrc ilike '%''aal2''%')::text from pg_proc where proname = 'condicoes_exigir_admin' and pronamespace = 'public'::regnamespace));
select pg_temp.registrar('H2. gerar_fatura e alterar_motor_vigencia seguem estritas', 'true',
  (select bool_and(prosrc ilike '%''aal2''%' or prosrc ilike '%condicoes_exigir_admin()%')::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('gerar_fatura', 'alterar_motor_vigencia')));
select pg_temp.registrar('H3. nenhuma tabela estrita perdeu a exigência de AAL2', '4',
  (select count(*)::text from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace and not p.polpermissive
     and c.relname in ('financial_engine_settings', 'financial_terms_audit', 'admin_audit_log', 'user_operation_access') and pg_get_expr(p.polqual, p.polrelid) ilike '%aal2%'));
select pg_temp.registrar('H4. escrita em invoices/invoice_items: 3 policies estritas cada (insert, update, delete)', '6',
  (select count(*)::text from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace and not p.polpermissive
     and c.relname in ('invoices', 'invoice_items') and p.polcmd::text in ('a', 'w', 'd') and coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) ilike '%aal2%'));
select pg_temp.registrar('H5. helpers: anônimo não executa; o guard de leitura não é chamável por authenticated', 'false|false',
  has_function_privilege('anon', 'public.mfa_cotidiano_ok()', 'execute')::text || '|' || has_function_privilege('authenticated', 'public.condicoes_exigir_admin_leitura()', 'execute')::text);
select pg_temp.registrar('H6. o aplicativo (authenticated) executa o helper do piso', 'true',
  has_function_privilege('authenticated', 'public.mfa_cotidiano_ok()', 'execute')::text);

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
    raise exception '032_mfa_opcional: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
