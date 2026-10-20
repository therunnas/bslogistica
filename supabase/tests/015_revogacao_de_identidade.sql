-- Migration 020 — revogação de identidade (C02).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`, então nada é
-- criado, alterado ou removido — inclusive em `auth.users` e `auth.sessions`.
-- NUNCA rodar contra Production: o `rollback` protege, mas o arquivo escreve em
-- `auth.users`, `auth.sessions` e `auth.mfa_factors`, e o bloco F mexe nas
-- linhas de papel `admin`.
--
-- O QUE ESTE ARQUIVO PROVA
--
-- Os cinco cenários reproduzidos com JWTs reais na L2-C02-B, agora como
-- regressão no banco:
--
--   T1  conta BANIDA com papel preservado        -> bloco B
--   T2  conta EXCLUÍDA (papel órfão, sem FK)     -> bloco C
--   T3  remoção do papel, revogação imediata     -> bloco D (já funcionava)
--   T4  último admin conta só identidade ativa   -> bloco F
--   T5  sessão ENCERRADA (signOut global)        -> bloco E
--
-- mais as identidades legítimas (A), a forma e os privilégios das funções (G) e
-- os três bloqueadores apontados na L2-C02-C2:
--
--   B1  `session_id` inválido => `false`, NUNCA exceção (22P02)  -> blocos E e E_B1
--   B2  policies `(SELECT has_role/is_staff)` autorizam EXATAMENTE como antes
--       (matriz identidade x tabela x operação)                  -> bloco H
--   B3  JWT revogado não lê nem altera a própria linha de
--       `profiles` e `user_roles`                                -> bloco I
--
-- As claims de cada medição carregam `session_id` e as contas e sessões existem
-- de verdade: este arquivo NÃO tem fixture sem conta nem exceção para fazer um
-- teste antigo passar. A recusa de identidade inutilizável é o comportamento
-- que a migration 020 introduz.
--
-- HERMETISMO
--
-- As medições usam marcadores próprios ('C02 marcador') e contas próprias, então
-- não dependem de quantas linhas o banco já tem. A exceção é o bloco F, que só
-- faz sentido com ZERO admins fora desta suíte: se houver, o bloco é PULADO e
-- isso aparece no relatório (situação PULADO), em vez de apagar o papel de um
-- admin que não é desta fixture.
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Não prova a assinatura criptográfica do JWT (isso é do PostgREST), nem a
-- regra do GoTrue de recusar token de conta banida em /auth/v1/user — isso foi
-- medido na L2-C02-B. Não mede desempenho: o plano de EXPLAIN é à parte (o ganho
-- das policies `(SELECT ...)` é verificado por plano, não por resultado). Não cobre
-- JSON de claims inválido (`request.jwt.claims` que não é JSON): o PostgREST só
-- entrega JSON válido e `auth.uid()`/`auth.jwt()` falham antes de qualquer helper.

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

create or replace function pg_temp.pular(_caso text, _motivo text)
returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, '(não executado)', _motivo, 'PULADO');
end;
$$;

-- Mede `_sql` sob um papel e uma claim montada à mão.
--   _sid : valor da claim `session_id`; NULL omite a claim.
-- Devolve o texto do resultado, ou 'erro <sqlstate>'.
create or replace function pg_temp.medir_como(
  _papel text, _uid text, _aal text, _sid text, _sql text
) returns text language plpgsql as $$
declare _r text; _claims jsonb;
begin
  if _uid is null then
    _claims := jsonb_build_object('role', 'anon');
  else
    _claims := jsonb_build_object('sub', _uid, 'role', 'authenticated');
    if _sid is not null then
      _claims := _claims || jsonb_build_object('session_id', _sid);
    end if;
    if _aal is not null then
      _claims := _claims || jsonb_build_object('aal', _aal);
    end if;
  end if;
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

-- Caso comum: `authenticated` com a SESSÃO DA PRÓPRIA CONTA ('e' + resto do UUID).
create or replace function pg_temp.como(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
begin
  return pg_temp.medir_como('authenticated', _uid, _aal, 'e' || substr(_uid, 2), _sql);
end;
$$;

-- Como `medir_como`, mas com as claims inteiras montadas pelo chamador: serve para
-- `session_id` que não é texto (número, objeto, null JSON) ou claim ausente.
create or replace function pg_temp.medir_claims(
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

-- Sondas. Todas rodam sob RLS como a identidade medida.
create or replace function pg_temp.sondas() returns table (k text, sql text)
language sql as $$
  values
    ('papel_admin', $q$select public.has_role(auth.uid(), 'admin'::public.app_role)::text$q$),
    ('staff',       $q$select public.is_staff()::text$q$),
    ('clientes',    $q$select count(*)::text from public.clients where name = 'C02 marcador'$q$),
    -- período invertido: a função recusa DEPOIS das guardas de AAL2 e papel e ANTES
    -- de qualquer escrita. 22023 = passou nas guardas; 42501 = barrada nelas.
    ('fatura',      $q$select (public.gerar_fatura('00000000-0000-0000-0000-000000000000'::uuid, date '2026-02-01', date '2026-01-01')).id::text$q$),
    ('operacoes',   $q$select count(*)::text from public.listar_operacoes_do_operador()$q$),
    -- Operação ATRIBUÍDA aos operadores da fixture (…a2). Lista vazia: a função recusa
    -- DEPOIS da autorização e ANTES de qualquer escrita. 22023 = autorizada; 42501 = barrada.
    ('salvar',      $q$select public.salvar_apontamento_operacional('2c00c000-0000-4000-8000-0000000000a2'::uuid, '2c00c000-0000-4000-8000-0000000000b2'::uuid, date '2026-10-01', '[]'::jsonb)::text$q$)
$$;

create or replace function pg_temp.sonda(_k text) returns text language sql as $$
  select sql from pg_temp.sondas() where k = _k
$$;


-- ---------------------------------------------------------------------------
-- Fixture
--
-- 14 contas reais em auth.users, uma sessão cada (menos a 15, que NÃO existe) e
-- papéis em user_roles. O UUID da sessão é o da conta com o 1º caractere
-- trocado por 'e'.
--
--   01 ADM_OK            admin, legítimo, nunca alterado até o bloco F
--   02 OP_SEM_MFA        operacional, sem fator, com a operação atribuída
--   03 OP_COM_MFA        operacional, fator verificado, com a operação
--   04 SEM_PAPEL
--   05 ADM_BAN           admin -> banido (T1)
--   06 ADM_DEL           admin -> excluído, papel órfão (T2)
--   07 ADM_SOFT          admin -> deleted_at (exclusão lógica)
--   08 ADM_SESSAO        admin -> sessão encerrada (T5)
--   09 ADM_REVOGADO      admin -> papel removido (T3)
--   10 ADM_EXPIRADO      admin com sessão vencida (not_after no passado)
--   11 OP_BAN            operacional -> banido (T1)
--   12 OP_DEL            operacional -> excluído (T2)
--   13 ADM_BAN_PASSADO   admin com banned_until NO PASSADO (utilizável)
--   14 ADM_OUTRA_SESSAO  admin cujo JWT traz a sessão de OUTRA conta
--   15 ADM_INEXISTENTE   papel admin SEM conta em auth.users, desde o início
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('2c000000-0000-4000-8000-000000000001'),
  ('2c000000-0000-4000-8000-000000000002'),
  ('2c000000-0000-4000-8000-000000000003'),
  ('2c000000-0000-4000-8000-000000000004'),
  ('2c000000-0000-4000-8000-000000000005'),
  ('2c000000-0000-4000-8000-000000000006'),
  ('2c000000-0000-4000-8000-000000000007'),
  ('2c000000-0000-4000-8000-000000000008'),
  ('2c000000-0000-4000-8000-000000000009'),
  ('2c000000-0000-4000-8000-000000000010'),
  ('2c000000-0000-4000-8000-000000000011'),
  ('2c000000-0000-4000-8000-000000000012'),
  ('2c000000-0000-4000-8000-000000000013'),
  ('2c000000-0000-4000-8000-000000000014');

insert into auth.sessions (id, user_id, not_after) values
  ('ec000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', null),
  ('ec000000-0000-4000-8000-000000000002', '2c000000-0000-4000-8000-000000000002', null),
  ('ec000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000003', null),
  ('ec000000-0000-4000-8000-000000000004', '2c000000-0000-4000-8000-000000000004', null),
  ('ec000000-0000-4000-8000-000000000005', '2c000000-0000-4000-8000-000000000005', null),
  ('ec000000-0000-4000-8000-000000000006', '2c000000-0000-4000-8000-000000000006', null),
  ('ec000000-0000-4000-8000-000000000007', '2c000000-0000-4000-8000-000000000007', null),
  ('ec000000-0000-4000-8000-000000000008', '2c000000-0000-4000-8000-000000000008', null),
  ('ec000000-0000-4000-8000-000000000009', '2c000000-0000-4000-8000-000000000009', null),
  ('ec000000-0000-4000-8000-000000000010', '2c000000-0000-4000-8000-000000000010', now() - interval '1 hour'),
  ('ec000000-0000-4000-8000-000000000011', '2c000000-0000-4000-8000-000000000011', null),
  ('ec000000-0000-4000-8000-000000000012', '2c000000-0000-4000-8000-000000000012', null),
  ('ec000000-0000-4000-8000-000000000013', '2c000000-0000-4000-8000-000000000013', null),
  ('ec000000-0000-4000-8000-000000000014', '2c000000-0000-4000-8000-000000000014', null);

insert into auth.mfa_factors
  (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values
  ('2f000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000003',
   'ativo', 'totp', 'verified', now(), now());

insert into public.user_roles (user_id, role) values
  ('2c000000-0000-4000-8000-000000000001', 'admin'),
  ('2c000000-0000-4000-8000-000000000002', 'operacional'),
  ('2c000000-0000-4000-8000-000000000003', 'operacional'),
  ('2c000000-0000-4000-8000-000000000005', 'admin'),
  ('2c000000-0000-4000-8000-000000000006', 'admin'),
  ('2c000000-0000-4000-8000-000000000007', 'admin'),
  ('2c000000-0000-4000-8000-000000000008', 'admin'),
  ('2c000000-0000-4000-8000-000000000009', 'admin'),
  ('2c000000-0000-4000-8000-000000000010', 'admin'),
  ('2c000000-0000-4000-8000-000000000011', 'operacional'),
  ('2c000000-0000-4000-8000-000000000012', 'operacional'),
  ('2c000000-0000-4000-8000-000000000013', 'admin'),
  ('2c000000-0000-4000-8000-000000000014', 'admin'),
  ('2c000000-0000-4000-8000-000000000015', 'admin');

-- Conta 13: banimento que JÁ TERMINOU. banned_until no passado não bane.
update auth.users set banned_until = now() - interval '1 day'
 where id = '2c000000-0000-4000-8000-000000000013';

insert into public.clients (id, name) values
  ('2c00c000-0000-4000-8000-0000000000a1', 'C02 marcador');

insert into public.operations (id, client_id, name, agreed_amount) values
  ('2c00c000-0000-4000-8000-0000000000a2', '2c00c000-0000-4000-8000-0000000000a1', 'C02 operação', 100);

insert into public.user_operation_access (user_id, operation_id, created_by) values
  ('2c000000-0000-4000-8000-000000000002', '2c00c000-0000-4000-8000-0000000000a2', null),
  ('2c000000-0000-4000-8000-000000000003', '2c00c000-0000-4000-8000-0000000000a2', null),
  ('2c000000-0000-4000-8000-000000000011', '2c00c000-0000-4000-8000-0000000000a2', null),
  ('2c000000-0000-4000-8000-000000000012', '2c00c000-0000-4000-8000-0000000000a2', null);

-- Uma linha de cada tabela de negócio, para a matriz do bloco H. Mesmas colunas e
-- formas das suítes 004 e 013. `…b1` é um turno descartável (o DELETE do bloco H).
insert into public.contracts (id, client_id, name)
values ('2c00c000-0000-4000-8000-0000000000a3', '2c00c000-0000-4000-8000-0000000000a1', 'C02 contrato');
insert into public.shifts (id, operation_id, name, start_time, end_time) values
  ('2c00c000-0000-4000-8000-0000000000a4', '2c00c000-0000-4000-8000-0000000000a2', 'C02 turno', '08:00', '17:00'),
  ('2c00c000-0000-4000-8000-0000000000b1', '2c00c000-0000-4000-8000-0000000000a2', 'C02 turno descartavel', '18:00', '22:00');
insert into public.employees (id, name, daily_cost)
values ('2c00c000-0000-4000-8000-0000000000a5', 'C02 colaborador', 100);
insert into public.operation_team (id, operation_id, shift_id, employee_id)
values ('2c00c000-0000-4000-8000-0000000000a6', '2c00c000-0000-4000-8000-0000000000a2',
        '2c00c000-0000-4000-8000-0000000000a4', '2c00c000-0000-4000-8000-0000000000a5');
insert into public.timesheets (id, operation_id, shift_id, work_date)
values ('2c00c000-0000-4000-8000-0000000000a7', '2c00c000-0000-4000-8000-0000000000a2',
        '2c00c000-0000-4000-8000-0000000000a4', date '2099-04-04');
insert into public.timesheet_entries (id, timesheet_id, employee_id, billed_amount, cost_amount)
values ('2c00c000-0000-4000-8000-0000000000a8', '2c00c000-0000-4000-8000-0000000000a7',
        '2c00c000-0000-4000-8000-0000000000a5', 250, 100);
insert into public.invoices (id, client_id, period_start, period_end, total_amount)
values ('2c00c000-0000-4000-8000-0000000000a9', '2c00c000-0000-4000-8000-0000000000a1',
        date '2099-04-01', date '2099-04-30', 250);
insert into public.invoice_items (id, invoice_id, operation_id, description, quantity, unit_price, amount)
values ('2c00c000-0000-4000-8000-0000000000b0', '2c00c000-0000-4000-8000-0000000000a9',
        '2c00c000-0000-4000-8000-0000000000a2', 'C02 item', 1, 250, 250);
insert into public.admin_audit_log (actor_id, action, target_user_id, details)
values (null, 'C02 marcador', null, '{}'::jsonb);

-- Uma linha de profile por conta da fixture (o onboarding pode já ter criado algumas)
-- e uma ÓRFÃ, da conta 15, que não existe em auth.users (profiles não tem FK).
insert into public.profiles (id, full_name)
select u.id, 'C02 ' || right(u.id::text, 2) from auth.users u
 where u.id::text like '2c000000-0000-4000-8000-0000000000%'
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values ('2c000000-0000-4000-8000-000000000015', 'C02 15')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- A. Identidades legítimas continuam funcionando
-- ---------------------------------------------------------------------------

do $bloco_a$
declare
  _adm  text := '2c000000-0000-4000-8000-000000000001';
  _op   text := '2c000000-0000-4000-8000-000000000002';
  _opm  text := '2c000000-0000-4000-8000-000000000003';
  _sem  text := '2c000000-0000-4000-8000-000000000004';
begin
  perform pg_temp.registrar('A1a. admin aal2: has_role admin', 'true',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('A1b. admin aal2: is_staff', 'true',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('staff')));
  perform pg_temp.registrar('A1c. admin aal2 le o cliente marcador', '1',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('A1d. admin aal2 passa as guardas de gerar_fatura (22023)', 'erro 22023',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('fatura')));

  perform pg_temp.registrar('A2a. admin aal1: has_role continua true (aal nao entra em has_role)', 'true',
    pg_temp.como(_adm, 'aal1', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('A2b. admin aal1: a RESTRICTIVE de aal2 continua fechando os dados', '0',
    pg_temp.como(_adm, 'aal1', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('A2c. admin aal1: gerar_fatura barra no segundo fator (42501)', 'erro 42501',
    pg_temp.como(_adm, 'aal1', pg_temp.sonda('fatura')));

  perform pg_temp.registrar('A3a. operador aal1 sem MFA lista a operacao', '1',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('operacoes')));
  perform pg_temp.registrar('A3b. operador aal1 sem MFA passa a autorizacao de salvar (22023)', 'erro 22023',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('salvar')));
  perform pg_temp.registrar('A3c. operador nao le tabela de negocio', '0',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('A3d. operador nao e admin', 'false',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('A3e. operador e staff', 'true',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('staff')));

  perform pg_temp.registrar('A4a. operador COM MFA em aal1: barrado', 'erro 42501',
    pg_temp.como(_opm, 'aal1', pg_temp.sonda('operacoes')));
  perform pg_temp.registrar('A4b. operador COM MFA em aal2: libera', '1',
    pg_temp.como(_opm, 'aal2', pg_temp.sonda('operacoes')));

  perform pg_temp.registrar('A5a. sem papel: has_role admin', 'false',
    pg_temp.como(_sem, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('A5b. sem papel: is_staff', 'false',
    pg_temp.como(_sem, 'aal2', pg_temp.sonda('staff')));
  perform pg_temp.registrar('A5c. sem papel nao le dados', '0',
    pg_temp.como(_sem, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('A5d. sem papel: RPC operacional barrada', 'erro 42501',
    pg_temp.como(_sem, 'aal2', pg_temp.sonda('operacoes')));
  perform pg_temp.registrar('A5e. sem papel: gerar_fatura barrada', 'erro 42501',
    pg_temp.como(_sem, 'aal2', pg_temp.sonda('fatura')));

  perform pg_temp.registrar('A6a. anon nao le dados', '0',
    pg_temp.medir_como('anon', null, null, null, pg_temp.sonda('clientes')));
  perform pg_temp.registrar('A6b. anon nao executa has_role', 'erro 42501',
    pg_temp.medir_como('anon', null, null, null, pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('A6c. anon nao executa gerar_fatura', 'erro 42501',
    pg_temp.medir_como('anon', null, null, null, pg_temp.sonda('fatura')));
  perform pg_temp.registrar('A6d. anon nao executa a RPC operacional', 'erro 42501',
    pg_temp.medir_como('anon', null, null, null, pg_temp.sonda('operacoes')));
end;
$bloco_a$;


-- ---------------------------------------------------------------------------
-- B. T1 — conta BANIDA, papel preservado
-- ---------------------------------------------------------------------------

do $bloco_b_antes$
begin
  perform pg_temp.registrar('B0a. admin (antes do ban) le dados', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000005', 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('B0b. operador (antes do ban) lista a operacao', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000011', 'aal1', pg_temp.sonda('operacoes')));
end;
$bloco_b_antes$;

update auth.users set banned_until = now() + interval '876000 hours'
 where id in ('2c000000-0000-4000-8000-000000000005', '2c000000-0000-4000-8000-000000000011');

do $bloco_b$
declare
  _adm text := '2c000000-0000-4000-8000-000000000005';
  _op  text := '2c000000-0000-4000-8000-000000000011';
begin
  perform pg_temp.registrar('B1a. admin banido: has_role admin', 'false',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('B1b. admin banido: is_staff', 'false',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('staff')));
  perform pg_temp.registrar('B1c. admin banido NAO le dados com o JWT antigo', '0',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('B1d. admin banido: gerar_fatura barrada (42501)', 'erro 42501',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('fatura')));
  perform pg_temp.registrar('B1e. o papel do banido continua em user_roles (a revogacao nao depende dele sumir)', '1',
    (select count(*)::text from public.user_roles where user_id = _adm::uuid and role = 'admin'));
  perform pg_temp.registrar('B1f. a sessao do banido continua em auth.sessions (so o ban a barra)', '1',
    (select count(*)::text from auth.sessions where user_id = _adm::uuid));

  perform pg_temp.registrar('B2a. operador banido: RPC operacional barrada', 'erro 42501',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('operacoes')));
  perform pg_temp.registrar('B2b. operador banido: salvar barrada antes de qualquer escrita', 'erro 42501',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('salvar')));
  perform pg_temp.registrar('B2c. a atribuicao do operador banido continua (so o ban a barra)', '1',
    (select count(*)::text from public.user_operation_access where user_id = _op::uuid));

  perform pg_temp.registrar('B3a. banimento JA TERMINADO (banned_until no passado): admin utilizavel', 'true',
    pg_temp.como('2c000000-0000-4000-8000-000000000013', 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('B3b. ... e le dados', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000013', 'aal2', pg_temp.sonda('clientes')));
end;
$bloco_b$;

-- Reativação: o fluxo da aplicação desbane a conta (banned_until volta ao passado
-- ou a null). A conta recupera o acesso SEM novo papel, porque o papel nunca saiu.
update auth.users set banned_until = null
 where id in ('2c000000-0000-4000-8000-000000000005', '2c000000-0000-4000-8000-000000000011');

do $bloco_b_reativa$
begin
  perform pg_temp.registrar('B4a. admin desbanido recupera o acesso', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000005', 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('B4b. operador desbanido recupera o acesso', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000011', 'aal1', pg_temp.sonda('operacoes')));
end;
$bloco_b_reativa$;


-- ---------------------------------------------------------------------------
-- C. T2 — conta EXCLUÍDA (papel órfão) e exclusão lógica
-- ---------------------------------------------------------------------------

do $bloco_c_antes$
begin
  perform pg_temp.registrar('C0a. admin (antes de excluir) le dados', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000006', 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('C0b. operador (antes de excluir) lista a operacao', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000012', 'aal1', pg_temp.sonda('operacoes')));
end;
$bloco_c_antes$;

delete from auth.users
 where id in ('2c000000-0000-4000-8000-000000000006', '2c000000-0000-4000-8000-000000000012');
update auth.users set deleted_at = now()
 where id = '2c000000-0000-4000-8000-000000000007';

do $bloco_c$
declare
  _adm text := '2c000000-0000-4000-8000-000000000006';
  _op  text := '2c000000-0000-4000-8000-000000000012';
  _soft text := '2c000000-0000-4000-8000-000000000007';
  _inex text := '2c000000-0000-4000-8000-000000000015';
begin
  perform pg_temp.registrar('C1a. admin excluido deixou o papel ORFAO em user_roles', '1',
    (select count(*)::text from public.user_roles where user_id = _adm::uuid and role = 'admin'));
  perform pg_temp.registrar('C1b. ... e a conta nao existe mais em auth.users', '0',
    (select count(*)::text from auth.users where id = _adm::uuid));
  perform pg_temp.registrar('C1c. admin excluido: has_role admin', 'false',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('C1d. admin excluido NAO le dados com o JWT antigo', '0',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('C1e. admin excluido: gerar_fatura barrada (42501)', 'erro 42501',
    pg_temp.como(_adm, 'aal2', pg_temp.sonda('fatura')));

  perform pg_temp.registrar('C2a. operador excluido: RPC operacional barrada', 'erro 42501',
    pg_temp.como(_op, 'aal1', pg_temp.sonda('operacoes')));
  perform pg_temp.registrar('C2b. a atribuicao do operador excluido saiu por CASCADE', '0',
    (select count(*)::text from public.user_operation_access where user_id = _op::uuid));

  perform pg_temp.registrar('C3a. exclusao LOGICA (deleted_at): has_role admin', 'false',
    pg_temp.como(_soft, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('C3b. exclusao logica nao le dados', '0',
    pg_temp.como(_soft, 'aal2', pg_temp.sonda('clientes')));

  perform pg_temp.registrar('C4a. CONTA INEXISTENTE com papel admin desde o inicio: has_role', 'false',
    pg_temp.como(_inex, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('C4b. conta inexistente: is_staff', 'false',
    pg_temp.como(_inex, 'aal2', pg_temp.sonda('staff')));
  perform pg_temp.registrar('C4c. conta inexistente nao le dados', '0',
    pg_temp.como(_inex, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('C4d. conta inexistente: RPC operacional barrada', 'erro 42501',
    pg_temp.como(_inex, 'aal2', pg_temp.sonda('operacoes')));
end;
$bloco_c$;


-- ---------------------------------------------------------------------------
-- D. T3 — remoção do papel revoga NA HORA (já funcionava; vira regressão)
-- ---------------------------------------------------------------------------

do $bloco_d_antes$
begin
  perform pg_temp.registrar('D0. admin com papel le dados', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000009', 'aal2', pg_temp.sonda('clientes')));
end;
$bloco_d_antes$;

-- Há outro admin utilizável (ADM_OK), então o trigger do último admin deixa passar.
delete from public.user_roles
 where user_id = '2c000000-0000-4000-8000-000000000009' and role = 'admin';

do $bloco_d$
declare _id text := '2c000000-0000-4000-8000-000000000009';
begin
  perform pg_temp.registrar('D1a. papel removido: has_role admin', 'false',
    pg_temp.como(_id, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('D1b. papel removido: nao le dados (mesmo JWT, mesma sessao)', '0',
    pg_temp.como(_id, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('D1c. papel removido: gerar_fatura barrada', 'erro 42501',
    pg_temp.como(_id, 'aal2', pg_temp.sonda('fatura')));
  perform pg_temp.registrar('D1d. a conta continua ativa (so o papel saiu)', 'true',
    pg_temp.medir_como('service_role', null, null, null,
      format($sql$select public.conta_ativa(%L::uuid)::text$sql$, _id)));
  perform pg_temp.registrar('D1e. a sessao continua viva (so o papel saiu)', '1',
    (select count(*)::text from auth.sessions where user_id = _id::uuid));
end;
$bloco_d$;


-- ---------------------------------------------------------------------------
-- E. T5 — SESSÃO encerrada, ausente, alheia, vencida ou malformada
-- ---------------------------------------------------------------------------

do $bloco_e_antes$
begin
  perform pg_temp.registrar('E0. admin com sessao viva le dados', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000008', 'aal2', pg_temp.sonda('clientes')));
end;
$bloco_e_antes$;

-- signOut global: o Auth remove a linha da sessão.
delete from auth.sessions where id = 'ec000000-0000-4000-8000-000000000008';

do $bloco_e$
declare
  _sess text := '2c000000-0000-4000-8000-000000000008';
  _ok   text := '2c000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.registrar('E1a. sessao encerrada: has_role admin', 'false',
    pg_temp.como(_sess, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E1b. sessao encerrada: nao le dados com o JWT antigo', '0',
    pg_temp.como(_sess, 'aal2', pg_temp.sonda('clientes')));
  perform pg_temp.registrar('E1c. sessao encerrada: gerar_fatura barrada', 'erro 42501',
    pg_temp.como(_sess, 'aal2', pg_temp.sonda('fatura')));
  perform pg_temp.registrar('E1d. a CONTA continua ativa e o papel continua (so a sessao saiu)', 'true',
    pg_temp.medir_como('service_role', null, null, null,
      format($sql$select (public.conta_ativa(%L::uuid)
                          and exists (select 1 from public.user_roles where user_id = %L::uuid and role = 'admin'))::text$sql$, _sess, _sess)));

  perform pg_temp.registrar('E2. JWT SEM claim session_id: barrado', 'false',
    pg_temp.medir_como('authenticated', _ok, 'aal2', null, pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E3. session_id inexistente: barrado', 'false',
    pg_temp.medir_como('authenticated', _ok, 'aal2', 'ec000000-0000-4000-8000-0000000000ff', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E4. session_id MALFORMADO falha FECHADO, sem excecao de cast', 'false',
    pg_temp.medir_como('authenticated', _ok, 'aal2', 'nao-e-um-uuid', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E5. session_id vazio: barrado', 'false',
    pg_temp.medir_como('authenticated', _ok, 'aal2', '', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E6. sessao de OUTRA conta no JWT: barrado', 'false',
    pg_temp.medir_como('authenticated', '2c000000-0000-4000-8000-000000000014', 'aal2',
      'ec000000-0000-4000-8000-000000000001', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E7. sessao VENCIDA (not_after no passado): barrado', 'false',
    pg_temp.como('2c000000-0000-4000-8000-000000000010', 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E8. a mesma conta com a sessao CERTA continua liberada', 'true',
    pg_temp.como(_ok, 'aal2', pg_temp.sonda('papel_admin')));
  perform pg_temp.registrar('E9. dados bloqueados tambem sem session_id', '0',
    pg_temp.medir_como('authenticated', _ok, 'aal2', null, pg_temp.sonda('clientes')));
  perform pg_temp.registrar('E10. RPC operacional bloqueada sem session_id', 'erro 42501',
    pg_temp.medir_como('authenticated', '2c000000-0000-4000-8000-000000000002', 'aal1', null, pg_temp.sonda('operacoes')));
end;
$bloco_e$;


-- ---------------------------------------------------------------------------
-- E_B1. session_id INVÁLIDO nunca vira exceção (B1 da L2-C02-C2)
--
-- A versão SQL da helper dava 22P02 ("invalid input syntax for type uuid") porque a
-- chave do índice de auth.sessions é avaliada na inicialização do plano, antes do
-- `CASE`. Aqui cada valor inválido é medido em TRÊS caminhos — a helper direto, a
-- RLS (sob policy) e a RPC operacional — e o esperado é sempre o valor fechado:
-- `false`, `0` ou `42501`. Qualquer outro SQLSTATE (22P02 em especial) reprova.
-- ---------------------------------------------------------------------------

do $bloco_e_b1$
declare
  _adm text := '2c000000-0000-4000-8000-000000000001';
  _op  text := '2c000000-0000-4000-8000-000000000002';
  _bom text := 'ec000000-0000-4000-8000-000000000001';
  _caso record;
  _c_adm jsonb;
  _c_op  jsonb;
begin
  for _caso in
    select * from (values
      ('numero',                 to_jsonb(123)),
      ('null JSON',              'null'::jsonb),
      ('booleano',               'true'::jsonb),
      ('array com o UUID certo', jsonb_build_array(_bom)),
      ('objeto',                 jsonb_build_object('id', _bom)),
      ('texto longo (100 mil caracteres)', to_jsonb(repeat('a', 100000))),
      ('UUID entre chaves',      to_jsonb('{' || _bom || '}')),
      ('UUID sem hifens',        to_jsonb(replace(_bom, '-', ''))),
      ('UUID com espaco no fim', to_jsonb(_bom || ' ')),
      ('texto "null"',           to_jsonb('null'::text)),
      ('injecao de SQL',         to_jsonb($i$'; drop table public.clients; --$i$::text))
    ) as t(rotulo, valor)
  loop
    _c_adm := jsonb_build_object('sub', _adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', _caso.valor);
    _c_op  := jsonb_build_object('sub', _op,  'role', 'authenticated', 'aal', 'aal1', 'session_id', _caso.valor);
    perform pg_temp.registrar('E_B1 [' || _caso.rotulo || '] helper direto => false', 'false',
      pg_temp.medir_claims('authenticated', _c_adm, $q$select public.identidade_atual_utilizavel()::text$q$));
    perform pg_temp.registrar('E_B1 [' || _caso.rotulo || '] has_role => false (sem 22P02)', 'false',
      pg_temp.medir_claims('authenticated', _c_adm, pg_temp.sonda('papel_admin')));
    perform pg_temp.registrar('E_B1 [' || _caso.rotulo || '] RLS devolve 0 linhas (sem 22P02)', '0',
      pg_temp.medir_claims('authenticated', _c_adm, pg_temp.sonda('clientes')));
    perform pg_temp.registrar('E_B1 [' || _caso.rotulo || '] is_staff do operador => false', 'false',
      pg_temp.medir_claims('authenticated', _c_op, pg_temp.sonda('staff')));
    perform pg_temp.registrar('E_B1 [' || _caso.rotulo || '] RPC operacional barrada em 42501 (nao 22P02)', 'erro 42501',
      pg_temp.medir_claims('authenticated', _c_op, pg_temp.sonda('operacoes')));
  end loop;

  perform pg_temp.registrar('E_B1 [sub ausente, session_id valido] => false', 'false',
    pg_temp.medir_claims('authenticated', jsonb_build_object('role', 'authenticated', 'aal', 'aal2', 'session_id', _bom),
      $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [session_id em MAIUSCULAS, conta e sessao certas] => true (UUID e case-insensitive)', 'true',
    pg_temp.medir_claims('authenticated', jsonb_build_object('sub', _adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', upper(_bom)),
      $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [session_id correto] => true (controle positivo)', 'true',
    pg_temp.medir_claims('authenticated', jsonb_build_object('sub', _adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', _bom),
      $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [sessao de OUTRA conta] helper direto => false', 'false',
    pg_temp.medir_claims('authenticated',
      jsonb_build_object('sub', '2c000000-0000-4000-8000-000000000014', 'role', 'authenticated', 'aal', 'aal2', 'session_id', _bom),
      $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [sessao encerrada] helper direto => false', 'false',
    pg_temp.como('2c000000-0000-4000-8000-000000000008', 'aal2', $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [sessao vencida] helper direto => false', 'false',
    pg_temp.como('2c000000-0000-4000-8000-000000000010', 'aal2', $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [conta inexistente, sessao inexistente] helper direto => false', 'false',
    pg_temp.como('2c000000-0000-4000-8000-000000000015', 'aal2', $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('E_B1 [anon] helper direto => 42501 (sem EXECUTE)', 'erro 42501',
    pg_temp.medir_como('anon', null, null, null, $q$select public.identidade_atual_utilizavel()::text$q$));
end;
$bloco_e_b1$;


-- ---------------------------------------------------------------------------
-- H. B2 — as policies `(SELECT has_role/is_staff)` autorizam como antes
--
-- Equivalência medida por RESULTADO, não por texto: a mesma leitura e a mesma
-- escrita, em 12 tabelas de negócio, para 12 identidades. O "como antes" tem duas
-- partes: (1) quem tinha acesso continua tendo, com a contagem REAL das linhas
-- (esperado = o que o postgres enxerga); (2) quem não tinha continua sem — incluindo
-- as quatro identidades revogadas, que a migration 020 passou a barrar.
--
-- Nenhum caso aqui depende do desempenho: o ganho do InitPlan é de plano, e o plano
-- é medido à parte.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.leituras() returns table (k text, sql text)
language sql as $$
  values
    ('clients',               $q$select count(*)::text from public.clients where id = '2c00c000-0000-4000-8000-0000000000a1'$q$),
    ('contracts',             $q$select count(*)::text from public.contracts where id = '2c00c000-0000-4000-8000-0000000000a3'$q$),
    ('operations',            $q$select count(*)::text from public.operations where id = '2c00c000-0000-4000-8000-0000000000a2'$q$),
    ('shifts',                $q$select count(*)::text from public.shifts where id = '2c00c000-0000-4000-8000-0000000000a4'$q$),
    ('employees',             $q$select count(*)::text from public.employees where id = '2c00c000-0000-4000-8000-0000000000a5'$q$),
    ('operation_team',        $q$select count(*)::text from public.operation_team where id = '2c00c000-0000-4000-8000-0000000000a6'$q$),
    ('timesheets',            $q$select count(*)::text from public.timesheets where id = '2c00c000-0000-4000-8000-0000000000a7'$q$),
    ('timesheet_entries',     $q$select count(*)::text from public.timesheet_entries where id = '2c00c000-0000-4000-8000-0000000000a8'$q$),
    ('invoices',              $q$select count(*)::text from public.invoices where id = '2c00c000-0000-4000-8000-0000000000a9'$q$),
    ('invoice_items',         $q$select count(*)::text from public.invoice_items where id = '2c00c000-0000-4000-8000-0000000000b0'$q$),
    ('admin_audit_log',       $q$select count(*)::text from public.admin_audit_log where action = 'C02 marcador'$q$),
    ('user_operation_access', $q$select count(*)::text from public.user_operation_access where operation_id = '2c00c000-0000-4000-8000-0000000000a2'$q$)
$$;

-- Leitura nas 12 tabelas. `_liberado`: o esperado é a contagem real; senão, 0.
create or replace function pg_temp.matriz_leituras(
  _rotulo text, _uid text, _aal text, _sid text, _liberado boolean
) returns void language plpgsql as $$
declare _k text; _sql text; _esp text; _obt text;
begin
  for _k, _sql in select l.k, l.sql from pg_temp.leituras() l loop
    if _liberado then
      execute _sql into _esp;
      perform pg_temp.registrar(_rotulo || ' / ' || _k || ' (controle: a fixture existe)', 'true', (_esp::int > 0)::text);
    else
      _esp := '0';
    end if;
    _obt := pg_temp.medir_como('authenticated', _uid, _aal, _sid, _sql);
    perform pg_temp.registrar(_rotulo || ' LE ' || _k, _esp, _obt);
  end loop;
end;
$$;

-- Escrita: INSERT, UPDATE e DELETE por policy. `_admin`: liberado.
-- UPDATE e DELETE barrados pela RLS não levantam erro: afetam 0 linhas. INSERT
-- barrado levanta 42501.
create or replace function pg_temp.matriz_escritas(
  _rotulo text, _uid text, _aal text, _sid text, _admin boolean
) returns void language plpgsql as $$
begin
  perform pg_temp.registrar(_rotulo || ' INSERT clients', case when _admin then '1' else 'erro 42501' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with i as (insert into public.clients (name) values ('C02 inserido') returning 1) select count(*)::text from i$q$));
  perform pg_temp.registrar(_rotulo || ' INSERT operations (policy operations_insert_admin)', case when _admin then '1' else 'erro 42501' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with i as (insert into public.operations (client_id, name) values ('2c00c000-0000-4000-8000-0000000000a1', 'C02 op inserida') returning 1) select count(*)::text from i$q$));
  perform pg_temp.registrar(_rotulo || ' UPDATE contracts', case when _admin then '1' else '0' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with u as (update public.contracts set name = name where id = '2c00c000-0000-4000-8000-0000000000a3' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar(_rotulo || ' UPDATE operations (policy operations_update_staff)', case when _admin then '1' else '0' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with u as (update public.operations set name = name where id = '2c00c000-0000-4000-8000-0000000000a2' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar(_rotulo || ' UPDATE employees', case when _admin then '1' else '0' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with u as (update public.employees set name = name where id = '2c00c000-0000-4000-8000-0000000000a5' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar(_rotulo || ' UPDATE timesheet_entries (policy timesheet_entries_staff)', case when _admin then '1' else '0' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with u as (update public.timesheet_entries set notes = 'C02' where id = '2c00c000-0000-4000-8000-0000000000a8' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar(_rotulo || ' DELETE shifts (policy shifts_delete_admin)', case when _admin then '1' else '0' end,
    pg_temp.medir_como('authenticated', _uid, _aal, _sid,
      $q$with d as (delete from public.shifts where id = '2c00c000-0000-4000-8000-0000000000b1' returning 1) select count(*)::text from d$q$));
end;
$$;

-- Prepara as identidades que ainda não estão revogadas: re-bane a conta 05 (o bloco B
-- a desbaniu).
update auth.users set banned_until = now() + interval '876000 hours'
 where id = '2c000000-0000-4000-8000-000000000005';

do $bloco_h$
declare
  _uid text; _rot text; _aal text; _sid text;
  _barradas text[][] := array[
    -- uid(final), nivel, rotulo
    array['01', 'aal1', 'admin AAL1'],
    array['02', 'aal1', 'operador AAL1'],
    array['03', 'aal2', 'operador com MFA AAL2'],
    array['04', 'aal2', 'sem papel AAL2'],
    array['05', 'aal2', 'admin BANIDO'],
    array['06', 'aal2', 'admin EXCLUIDO'],
    array['07', 'aal2', 'admin exclusao LOGICA'],
    array['08', 'aal2', 'admin SESSAO encerrada'],
    array['09', 'aal2', 'admin PAPEL removido'],
    array['10', 'aal2', 'admin sessao VENCIDA'],
    array['15', 'aal2', 'papel admin SEM conta']
  ];
  i int;
  _k text; _sql text; _obt text;
begin
  -- Barradas primeiro: o DELETE do turno descartável precisa encontrar a linha para
  -- que o 0 signifique "a RLS filtrou", e não "ela nao existia".
  for i in 1 .. array_length(_barradas, 1) loop
    _uid := '2c000000-0000-4000-8000-0000000000' || _barradas[i][1];
    _aal := _barradas[i][2];
    _sid := 'e' || substr(_uid, 2);
    _rot := 'H [' || _barradas[i][3] || ']';
    perform pg_temp.matriz_leituras(_rot, _uid, _aal, _sid, false);
    perform pg_temp.matriz_escritas(_rot, _uid, _aal, _sid, false);
  end loop;

  -- JWT sem session_id: nem o admin legítimo passa.
  _uid := '2c000000-0000-4000-8000-000000000001';
  perform pg_temp.matriz_leituras('H [admin AAL2 SEM session_id]', _uid, 'aal2', null, false);
  perform pg_temp.matriz_escritas('H [admin AAL2 SEM session_id]', _uid, 'aal2', null, false);

  -- anon: sem privilégio de tabela (42501) ou sem linhas — nunca dados.
  for _k, _sql in select l.k, l.sql from pg_temp.leituras() l loop
    _obt := pg_temp.medir_como('anon', null, null, null, _sql);
    perform pg_temp.registrar('H [anon] LE ' || _k || ' (0 linhas ou 42501)', 'true',
      (_obt in ('0', 'erro 42501'))::text);
  end loop;

  -- Por último, o admin legítimo em AAL2: tudo liberado, com a contagem real.
  perform pg_temp.matriz_leituras('H [admin AAL2]', _uid, 'aal2', 'ec000000-0000-4000-8000-000000000001', true);
  perform pg_temp.matriz_escritas('H [admin AAL2]', _uid, 'aal2', 'ec000000-0000-4000-8000-000000000001', true);
end;
$bloco_h$;

-- H. A FORMA: nenhuma policy foi criada, removida ou trocada de tipo; RLS e FORCE RLS
-- ficam como estavam; e nenhuma chamada a has_role()/is_staff() ficou solta (por
-- linha) nas policies de public.
-- O inventário inclui as 4 policies e as 2 tabelas da migration 022 (contract_terms e
-- employee_cost_terms, leitura só de admin em AAL2); sem a 022 aplicada, H-F1 a H-F7 divergem.
do $bloco_h_forma$
declare _n int; _sobra int;
begin
  perform pg_temp.registrar('H-F1. public tem 54 policies', '54',
    (select count(*)::text from pg_policies where schemaname = 'public'));
  perform pg_temp.registrar('H-F2. 25 RESTRICTIVE e 29 PERMISSIVE', '25/29',
    (select count(*) filter (where permissive = 'RESTRICTIVE') || '/' || count(*) filter (where permissive = 'PERMISSIVE')
       from pg_policies where schemaname = 'public'));

  -- Inventário exato (tabela, nome, tipo, comando) em AMBAS as direções: nada sumiu,
  -- nada foi criado, nada mudou de PERMISSIVE/RESTRICTIVE nem de comando.
  with esperado(tabela, nome, tipo, cmd) as (values
      ('admin_audit_log', 'admin_audit_log_exige_admin_aal2', 'RESTRICTIVE', 'ALL'),
      ('admin_audit_log', 'admin_audit_log_leitura_admin', 'PERMISSIVE', 'SELECT'),
      ('clients', 'clients_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('clients', 'clients_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('clients', 'clients_select_staff', 'PERMISSIVE', 'SELECT'),
      ('clients', 'clients_write_admin', 'PERMISSIVE', 'ALL'),
      ('contract_terms', 'contract_terms_exige_admin_aal2', 'RESTRICTIVE', 'ALL'),
      ('contract_terms', 'contract_terms_leitura_admin', 'PERMISSIVE', 'SELECT'),
      ('contracts', 'contracts_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('contracts', 'contracts_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('contracts', 'contracts_select_staff', 'PERMISSIVE', 'SELECT'),
      ('contracts', 'contracts_write_admin', 'PERMISSIVE', 'ALL'),
      ('employee_cost_terms', 'employee_cost_terms_exige_admin_aal2', 'RESTRICTIVE', 'ALL'),
      ('employee_cost_terms', 'employee_cost_terms_leitura_admin', 'PERMISSIVE', 'SELECT'),
      ('employees', 'employees_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('employees', 'employees_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('employees', 'employees_select_staff', 'PERMISSIVE', 'SELECT'),
      ('employees', 'employees_write_admin', 'PERMISSIVE', 'ALL'),
      ('invoice_items', 'invoice_items_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('invoice_items', 'invoice_items_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('invoice_items', 'invoice_items_select_staff', 'PERMISSIVE', 'SELECT'),
      ('invoice_items', 'invoice_items_write_admin', 'PERMISSIVE', 'ALL'),
      ('invoices', 'invoices_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('invoices', 'invoices_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('invoices', 'invoices_select_staff', 'PERMISSIVE', 'SELECT'),
      ('invoices', 'invoices_write_admin', 'PERMISSIVE', 'ALL'),
      ('operation_team', 'operation_team_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('operation_team', 'operation_team_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('operation_team', 'operation_team_staff', 'PERMISSIVE', 'ALL'),
      ('operations', 'operations_delete_admin', 'PERMISSIVE', 'DELETE'),
      ('operations', 'operations_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('operations', 'operations_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('operations', 'operations_insert_admin', 'PERMISSIVE', 'INSERT'),
      ('operations', 'operations_select_staff', 'PERMISSIVE', 'SELECT'),
      ('operations', 'operations_update_staff', 'PERMISSIVE', 'UPDATE'),
      ('profiles', 'profiles_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('profiles', 'profiles_insert_own', 'PERMISSIVE', 'INSERT'),
      ('profiles', 'profiles_select_own_or_admin', 'PERMISSIVE', 'SELECT'),
      ('profiles', 'profiles_update_own', 'PERMISSIVE', 'UPDATE'),
      ('shifts', 'shifts_delete_admin', 'PERMISSIVE', 'DELETE'),
      ('shifts', 'shifts_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('shifts', 'shifts_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('shifts', 'shifts_insert_admin', 'PERMISSIVE', 'INSERT'),
      ('shifts', 'shifts_select_staff', 'PERMISSIVE', 'SELECT'),
      ('shifts', 'shifts_update_staff', 'PERMISSIVE', 'UPDATE'),
      ('timesheet_entries', 'timesheet_entries_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('timesheet_entries', 'timesheet_entries_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('timesheet_entries', 'timesheet_entries_staff', 'PERMISSIVE', 'ALL'),
      ('timesheets', 'timesheets_exige_aal2', 'RESTRICTIVE', 'ALL'),
      ('timesheets', 'timesheets_exige_admin', 'RESTRICTIVE', 'ALL'),
      ('timesheets', 'timesheets_staff', 'PERMISSIVE', 'ALL'),
      ('user_operation_access', 'user_operation_access_admin', 'PERMISSIVE', 'ALL'),
      ('user_operation_access', 'user_operation_access_somente_admin_aal2', 'RESTRICTIVE', 'ALL'),
      ('user_roles', 'user_roles_select_own', 'PERMISSIVE', 'SELECT')
  ), atual as (
    select tablename, policyname, permissive, cmd from pg_policies where schemaname = 'public'
  )
  select (select count(*) from (select * from esperado except select * from atual) a)
       + (select count(*) from (select * from atual except select * from esperado) b)
    into _n;
  perform pg_temp.registrar('H-F3. inventario de policies identico ao anterior (tabela, nome, tipo, comando)', '0', _n::text);

  perform pg_temp.registrar('H-F4. todas as policies seguem TO authenticated', '54',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and roles = array['authenticated']::name[]));

  perform pg_temp.registrar('H-F5. as 16 tabelas seguem com RLS ligada', '16',
    (select count(*)::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity));
  perform pg_temp.registrar('H-F6. e nenhuma passou a FORCE RLS', '0',
    (select count(*)::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relforcerowsecurity));

  perform pg_temp.registrar('H-F7. 40 policies seguem chamando has_role()/is_staff()', '40',
    (select count(*)::text from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(has_role|is_staff)\('));

  -- Remove as chamadas EMBRULHADAS em subconsulta e confere que não sobrou nenhuma
  -- solta. O Postgres imprime `( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)`.
  select count(*) into _sobra
    from pg_policies p
   where p.schemaname = 'public'
     and regexp_replace(
           regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
             '\( SELECT (public\.)?has_role\(auth\.uid\(\), ''admin''::(public\.)?app_role\) AS has_role\)', '', 'g'),
           '\( SELECT (public\.)?is_staff\(\) AS is_staff\)', '', 'g')
         ~ '(has_role|is_staff)\(';
  perform pg_temp.registrar('H-F8. nenhuma chamada a has_role()/is_staff() solta (por linha) nas policies', '0', _sobra::text);

  perform pg_temp.registrar('H-F9. as 11 *_exige_aal2 seguem iguais (so olham o claim aal)', '11',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%\_exige\_aal2' and permissive = 'RESTRICTIVE'
        and qual = '(( SELECT (auth.jwt() ->> ''aal''::text)) = ''aal2''::text)'
        and with_check = qual));
end;
$bloco_h_forma$;


-- ---------------------------------------------------------------------------
-- I. B3 — JWT revogado não lê nem altera a PRÓPRIA linha de profiles e user_roles
--
-- Antes: `profiles_*_own` e `user_roles_select_own` comparavam só `auth.uid()`. Um
-- admin banido, excluído ou deslogado, ainda em AAL2, lia e editava o próprio
-- profile e lia o próprio papel. Agora a identidade utilizável é exigida; o usuário
-- ATIVO continua vendo e editando a própria linha, no nível que a arquitetura pede
-- (profiles: AAL2; user_roles: qualquer nível, o guard lê em AAL1).
-- ---------------------------------------------------------------------------

create or replace function pg_temp.q_perfil(_uid text) returns text language sql as $$
  select format($q$select count(*)::text from public.profiles where id = %L::uuid$q$, _uid)
$$;
create or replace function pg_temp.q_perfil_upd(_uid text) returns text language sql as $$
  select format($q$with u as (update public.profiles set full_name = 'C02 alterado' where id = %L::uuid returning 1) select count(*)::text from u$q$, _uid)
$$;
create or replace function pg_temp.q_perfil_ins(_uid text) returns text language sql as $$
  select format($q$with i as (insert into public.profiles (id, full_name) values (%L::uuid, 'C02 inserido') returning 1) select count(*)::text from i$q$, _uid)
$$;
create or replace function pg_temp.q_papel(_uid text) returns text language sql as $$
  select format($q$select count(*)::text from public.user_roles where user_id = %L::uuid$q$, _uid)
$$;

do $bloco_i_legitimo$
declare
  _adm text := '2c000000-0000-4000-8000-000000000001';
  _opm text := '2c000000-0000-4000-8000-000000000003';
  _sem text := '2c000000-0000-4000-8000-000000000004';
  _op  text := '2c000000-0000-4000-8000-000000000002';
  _todos int;
begin
  select count(*) into _todos from public.profiles where id::text like '2c000000-0000-4000-8000-0000000000%';

  perform pg_temp.registrar('I1a. admin AAL2 le o proprio profile', '1', pg_temp.como(_adm, 'aal2', pg_temp.q_perfil(_adm)));
  perform pg_temp.registrar('I1b. admin AAL2 le TODOS os profiles da fixture (ramo admin)', _todos::text,
    pg_temp.como(_adm, 'aal2', $q$select count(*)::text from public.profiles where id::text like '2c000000-0000-4000-8000-0000000000%'$q$));
  perform pg_temp.registrar('I1c. admin AAL2 atualiza o proprio profile', '1', pg_temp.como(_adm, 'aal2', pg_temp.q_perfil_upd(_adm)));
  perform pg_temp.registrar('I1d. admin AAL1: a RESTRICTIVE de aal2 segue fechando profiles', '0', pg_temp.como(_adm, 'aal1', pg_temp.q_perfil(_adm)));
  perform pg_temp.registrar('I1e. admin AAL1 NAO atualiza profile', '0', pg_temp.como(_adm, 'aal1', pg_temp.q_perfil_upd(_adm)));

  perform pg_temp.registrar('I2a. conta ATIVA SEM PAPEL em AAL2 le o proprio profile', '1', pg_temp.como(_sem, 'aal2', pg_temp.q_perfil(_sem)));
  perform pg_temp.registrar('I2b. ... e atualiza', '1', pg_temp.como(_sem, 'aal2', pg_temp.q_perfil_upd(_sem)));
  perform pg_temp.registrar('I2c. ... mas nao ve profile alheio', '0', pg_temp.como(_sem, 'aal2', pg_temp.q_perfil(_adm)));
  perform pg_temp.registrar('I2d. ... e nao atualiza profile alheio', '0', pg_temp.como(_sem, 'aal2', pg_temp.q_perfil_upd(_adm)));
  perform pg_temp.registrar('I3a. operador com MFA em AAL2 le o proprio profile', '1', pg_temp.como(_opm, 'aal2', pg_temp.q_perfil(_opm)));
  perform pg_temp.registrar('I3b. operador com MFA nao ve profile alheio', '0', pg_temp.como(_opm, 'aal2', pg_temp.q_perfil(_adm)));

  -- INSERT próprio: só quem é a conta, ativa. Remove o profile da conta 04 (postgres) para
  -- a inserção não colidir com a linha que o onboarding/fixture já criou.
  delete from public.profiles where id = _sem::uuid;
  perform pg_temp.registrar('I4a. conta ATIVA insere o PROPRIO profile (AAL2)', '1', pg_temp.como(_sem, 'aal2', pg_temp.q_perfil_ins(_sem)));
  perform pg_temp.registrar('I4b. conta ativa NAO insere profile de OUTRA conta', 'erro 42501', pg_temp.como(_sem, 'aal2', pg_temp.q_perfil_ins(_op)));
  perform pg_temp.registrar('I4c. conta ativa em AAL1 NAO insere profile (RESTRICTIVE aal2)', 'erro 42501',
    pg_temp.como('2c000000-0000-4000-8000-000000000003', 'aal1', pg_temp.q_perfil_ins('2c000000-0000-4000-8000-000000000003')));

  -- user_roles: legível em AAL1 (o guard) e só a própria linha.
  perform pg_temp.registrar('I5a. admin AAL1 le o proprio papel (o guard depende disto)', '1', pg_temp.como(_adm, 'aal1', pg_temp.q_papel(_adm)));
  perform pg_temp.registrar('I5b. admin AAL2 le o proprio papel', '1', pg_temp.como(_adm, 'aal2', pg_temp.q_papel(_adm)));
  perform pg_temp.registrar('I5c. operador AAL1 le o proprio papel', '1', pg_temp.como(_op, 'aal1', pg_temp.q_papel(_op)));
  perform pg_temp.registrar('I5d. conta sem papel le 0 linhas', '0', pg_temp.como(_sem, 'aal2', pg_temp.q_papel(_sem)));
  perform pg_temp.registrar('I5e. admin NAO le o papel de OUTRA conta (continua so a propria linha)', '0', pg_temp.como(_adm, 'aal2', pg_temp.q_papel(_op)));
  perform pg_temp.registrar('I5f. user_roles segue sem escrita por authenticated', 'erro 42501',
    pg_temp.como(_adm, 'aal2', format($q$with i as (insert into public.user_roles (user_id, role) values (%L::uuid, 'admin') returning 1) select count(*)::text from i$q$, _sem)));
end;
$bloco_i_legitimo$;

-- Revogadas: banida (05), excluída (06), exclusão lógica (07), sessão encerrada (08),
-- sessão vencida (10), papel admin SEM conta (15) e papel removido (09, conta ativa).
do $bloco_i_revogado$
declare
  _lista text[][] := array[
    array['05', 'admin BANIDO'],
    array['06', 'admin EXCLUIDO'],
    array['07', 'admin exclusao LOGICA'],
    array['08', 'admin SESSAO encerrada'],
    array['10', 'admin sessao VENCIDA'],
    array['15', 'papel admin SEM conta']
  ];
  i int; _uid text; _r text;
  _todos text := $q$select count(*)::text from public.profiles where id::text like '2c000000-0000-4000-8000-0000000000%'$q$;
begin
  for i in 1 .. array_length(_lista, 1) loop
    _uid := '2c000000-0000-4000-8000-0000000000' || _lista[i][1];
    _r := 'I6 [' || _lista[i][2] || ']';
    perform pg_temp.registrar(_r || ' (controle) o profile EXISTE para o postgres', '1',
      (select count(*)::text from public.profiles where id = _uid::uuid));
    perform pg_temp.registrar(_r || ' NAO le o proprio profile', '0', pg_temp.como(_uid, 'aal2', pg_temp.q_perfil(_uid)));
    perform pg_temp.registrar(_r || ' NAO atualiza o proprio profile', '0', pg_temp.como(_uid, 'aal2', pg_temp.q_perfil_upd(_uid)));
    perform pg_temp.registrar(_r || ' NAO insere profile proprio', 'erro 42501', pg_temp.como(_uid, 'aal2', pg_temp.q_perfil_ins(_uid)));
    perform pg_temp.registrar(_r || ' NAO le profiles alheios (ramo admin fechado)', '0', pg_temp.como(_uid, 'aal2', _todos));
    perform pg_temp.registrar(_r || ' (controle) o papel EXISTE para o postgres', '1',
      (select count(*)::text from public.user_roles where user_id = _uid::uuid));
    perform pg_temp.registrar(_r || ' NAO le o proprio papel', '0', pg_temp.como(_uid, 'aal2', pg_temp.q_papel(_uid)));
    perform pg_temp.registrar(_r || ' NAO le o proprio papel em AAL1 tambem', '0', pg_temp.como(_uid, 'aal1', pg_temp.q_papel(_uid)));
  end loop;

  -- 09: conta ativa, sessão viva, papel removido (T3): lê o profile (é a conta dele) e não
  -- tem papel para ler.
  perform pg_temp.registrar('I7a. papel removido (conta ativa): le o proprio profile', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000009', 'aal2', pg_temp.q_perfil('2c000000-0000-4000-8000-000000000009')));
  perform pg_temp.registrar('I7b. ... e ve SO a propria linha (nao e mais admin)', '1',
    pg_temp.como('2c000000-0000-4000-8000-000000000009', 'aal2', _todos));
  perform pg_temp.registrar('I7c. ... e nao tem papel para ler', '0',
    pg_temp.como('2c000000-0000-4000-8000-000000000009', 'aal2', pg_temp.q_papel('2c000000-0000-4000-8000-000000000009')));

  -- JWT sem session_id: nem a conta legítima lê a própria linha.
  perform pg_temp.registrar('I8a. JWT SEM session_id nao le o proprio profile', '0',
    pg_temp.medir_como('authenticated', '2c000000-0000-4000-8000-000000000001', 'aal2', null, pg_temp.q_perfil('2c000000-0000-4000-8000-000000000001')));
  perform pg_temp.registrar('I8b. JWT SEM session_id nao le o proprio papel', '0',
    pg_temp.medir_como('authenticated', '2c000000-0000-4000-8000-000000000001', 'aal1', null, pg_temp.q_papel('2c000000-0000-4000-8000-000000000001')));
  perform pg_temp.registrar('I8c. session_id MALFORMADO: profile devolve 0 (sem 22P02)', '0',
    pg_temp.medir_como('authenticated', '2c000000-0000-4000-8000-000000000001', 'aal2', 'nao-e-um-uuid', pg_temp.q_perfil('2c000000-0000-4000-8000-000000000001')));
  perform pg_temp.registrar('I8d. session_id MALFORMADO: papel devolve 0 (sem 22P02)', '0',
    pg_temp.medir_como('authenticated', '2c000000-0000-4000-8000-000000000001', 'aal1', 'nao-e-um-uuid', pg_temp.q_papel('2c000000-0000-4000-8000-000000000001')));

  perform pg_temp.registrar('I9a. anon nao le profiles (0 ou 42501)', 'true',
    (pg_temp.medir_como('anon', null, null, null, $q$select count(*)::text from public.profiles$q$) in ('0', 'erro 42501'))::text);
  perform pg_temp.registrar('I9b. anon nao le user_roles (0 ou 42501)', 'true',
    (pg_temp.medir_como('anon', null, null, null, $q$select count(*)::text from public.user_roles$q$) in ('0', 'erro 42501'))::text);
end;
$bloco_i_revogado$;

-- Reativação: desbanir a conta 05 devolve a leitura da própria linha, sem nada novo.
-- É o controle de que a recusa acima vem do ESTADO da conta, e não de a linha não
-- existir ou de a policy estar fechada para todos.
update auth.users set banned_until = null where id = '2c000000-0000-4000-8000-000000000005';

do $bloco_i_reativa$
declare _uid text := '2c000000-0000-4000-8000-000000000005';
begin
  perform pg_temp.registrar('I10a. conta desbanida volta a ler o proprio profile', '1', pg_temp.como(_uid, 'aal2', pg_temp.q_perfil(_uid)));
  perform pg_temp.registrar('I10b. ... e o proprio papel', '1', pg_temp.como(_uid, 'aal2', pg_temp.q_papel(_uid)));
  perform pg_temp.registrar('I10c. ... e atualiza o proprio profile', '1', pg_temp.como(_uid, 'aal2', pg_temp.q_perfil_upd(_uid)));
end;
$bloco_i_reativa$;

-- RESÍDUO ACEITO (documentado, não corrigido): `mfa_bloqueia_excecao_aal1()` é
-- SECURITY DEFINER e responde só sobre o PRÓPRIO chamador (um boolean sobre a
-- existência de fator verificado). Uma conta banida ainda consegue perguntar isso.
-- Fechá-la para identidade inutilizável mudaria o contrato dela (usada para BLOQUEAR a
-- exceção de AAL1) e não expõe dado de ninguém. O teste fixa o comportamento atual
-- para que uma mudança futura seja deliberada.
do $bloco_i_residuo$
begin
  perform pg_temp.registrar('I11. RESIDUO ACEITO: conta excluida ainda consulta o PROPRIO estado de fator (devolve boolean, sem erro)', 'true',
    (pg_temp.como('2c000000-0000-4000-8000-000000000006', 'aal2', $q$select public.mfa_bloqueia_excecao_aal1()::text$q$) in ('true', 'false'))::text);
end;
$bloco_i_residuo$;


-- ---------------------------------------------------------------------------
-- G. Forma, privilégios e superfície
-- ---------------------------------------------------------------------------

do $bloco_g$
declare
  _outro text := '2c000000-0000-4000-8000-000000000013';
begin
  perform pg_temp.registrar('G1. has_role continua SECURITY INVOKER (nao vira oraculo)', 'true',
    (select (not prosecdef)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'has_role'));
  perform pg_temp.registrar('G2. is_staff continua SECURITY INVOKER', 'true',
    (select (not prosecdef)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'is_staff'));
  perform pg_temp.registrar('G3. as 2 helpers sao SECURITY DEFINER do postgres com search_path fixo', '2',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('conta_ativa', 'identidade_atual_utilizavel')
        and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
        and coalesce(array_to_string(p.proconfig, ''), '') = 'search_path=pg_catalog, public'));

  perform pg_temp.registrar('G4a. conta_ativa(uuid): authenticated NAO executa', 'false',
    has_function_privilege('authenticated', 'public.conta_ativa(uuid)', 'EXECUTE')::text);
  perform pg_temp.registrar('G4b. conta_ativa(uuid): anon NAO executa', 'false',
    has_function_privilege('anon', 'public.conta_ativa(uuid)', 'EXECUTE')::text);
  perform pg_temp.registrar('G4c. conta_ativa(uuid): PUBLIC NAO executa', 'false',
    has_function_privilege('public', 'public.conta_ativa(uuid)', 'EXECUTE')::text);
  perform pg_temp.registrar('G4d. conta_ativa(uuid): service_role executa (trigger do ultimo admin)', 'true',
    has_function_privilege('service_role', 'public.conta_ativa(uuid)', 'EXECUTE')::text);

  perform pg_temp.registrar('G5a. identidade_atual_utilizavel(): authenticated executa', 'true',
    has_function_privilege('authenticated', 'public.identidade_atual_utilizavel()', 'EXECUTE')::text);
  perform pg_temp.registrar('G5b. identidade_atual_utilizavel(): service_role executa', 'true',
    has_function_privilege('service_role', 'public.identidade_atual_utilizavel()', 'EXECUTE')::text);
  perform pg_temp.registrar('G5c. identidade_atual_utilizavel(): anon NAO executa', 'false',
    has_function_privilege('anon', 'public.identidade_atual_utilizavel()', 'EXECUTE')::text);
  perform pg_temp.registrar('G5d. identidade_atual_utilizavel(): PUBLIC NAO executa', 'false',
    has_function_privilege('public', 'public.identidade_atual_utilizavel()', 'EXECUTE')::text);

  perform pg_temp.registrar('G6. bslog_rpc_operacional NAO ganhou EXECUTE em nada novo nem em has_role/is_staff', '0',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('conta_ativa', 'identidade_atual_utilizavel', 'has_role', 'is_staff')
        and has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')));

  perform pg_temp.registrar('G7a. authenticated chamando conta_ativa: negado (42501)', 'erro 42501',
    pg_temp.como('2c000000-0000-4000-8000-000000000001', 'aal2',
      $q$select public.conta_ativa('2c000000-0000-4000-8000-000000000001'::uuid)::text$q$));
  perform pg_temp.registrar('G7b. anon chamando identidade_atual_utilizavel: negado (42501)', 'erro 42501',
    pg_temp.medir_como('anon', null, null, null, $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('G7c. service_role chamando conta_ativa: responde', 'true',
    pg_temp.medir_como('service_role', null, null, null,
      $q$select public.conta_ativa('2c000000-0000-4000-8000-000000000001'::uuid)::text$q$));

  perform pg_temp.registrar('G8. has_role NAO e oraculo: admin pergunta pelo papel de OUTRA conta e recebe false', 'false',
    pg_temp.como('2c000000-0000-4000-8000-000000000001', 'aal2',
      format($q$select public.has_role(%L::uuid, 'admin'::public.app_role)::text$q$, _outro)));
  perform pg_temp.registrar('G9. identidade_atual_utilizavel() responde sobre o proprio chamador', 'true',
    pg_temp.como('2c000000-0000-4000-8000-000000000001', 'aal2', $q$select public.identidade_atual_utilizavel()::text$q$));
  perform pg_temp.registrar('G10. o trigger de ultimo admin continua instalado', '1',
    (select count(*)::text from pg_trigger
      where tgname = 'trg_proteger_ultimo_admin' and not tgisinternal));
  perform pg_temp.registrar('G12. as 2 helpers e has_role/is_staff sao STABLE', '4',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('conta_ativa', 'identidade_atual_utilizavel', 'has_role', 'is_staff')
        and p.provolatile = 's'));
  perform pg_temp.registrar('G13. identidade_atual_utilizavel e PL/pgSQL (o cast so roda depois do IF; em SQL puro dava 22P02)', 'plpgsql',
    (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
      where p.pronamespace = 'public'::regnamespace and p.proname = 'identidade_atual_utilizavel'));
  perform pg_temp.registrar('G14. so 2 funcoes novas em public alem das originais: conta_ativa e identidade_atual_utilizavel', '2',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('conta_ativa', 'identidade_atual_utilizavel')));
  perform pg_temp.registrar('G11. proteger_ultimo_admin usa conta_ativa e mantem o advisory lock', 'true',
    (select (prosrc like '%conta_ativa%' and prosrc like '%pg_advisory_xact_lock%')::text
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proteger_ultimo_admin'));
end;
$bloco_g$;


-- ---------------------------------------------------------------------------
-- F. T4 — o último administrador é o último UTILIZÁVEL
--
-- Só roda se NÃO houver admin fora desta suíte: o bloco apaga linhas de papel
-- admin da própria fixture para isolar o cenário, e nunca toca o de outra conta.
-- ---------------------------------------------------------------------------

do $bloco_f_pre$
declare _alheios int;
begin
  select count(*) into _alheios
    from public.user_roles
   where role = 'admin'
     and user_id::text not like '2c000000-0000-4000-8000-0000000000%';
  if _alheios > 0 then
    perform pg_temp.pular('F. T4 (ultimo admin utilizavel)',
      _alheios || ' admin(s) fora desta suite: rode o bloco F em banco sem outros admins');
  end if;
end;
$bloco_f_pre$;

-- Isolamento do cenário (só quando a fixture é dona de TODOS os admins).
do $bloco_f_setup$
declare _alheios int;
begin
  select count(*) into _alheios
    from public.user_roles
   where role = 'admin'
     and user_id::text not like '2c000000-0000-4000-8000-0000000000%';
  if _alheios = 0 then
    -- Mantém ADM_OK (utilizável) e as linhas já inutilizáveis (05 após re-ban, 06 órfã,
    -- 07 exclusão lógica, 15 sem conta). Remove os demais admins utilizáveis; há
    -- sempre ADM_OK de sobra, então o trigger deixa passar.
    delete from public.user_roles
     where role = 'admin'
       and user_id in ('2c000000-0000-4000-8000-000000000008',
                       '2c000000-0000-4000-8000-000000000010',
                       '2c000000-0000-4000-8000-000000000013',
                       '2c000000-0000-4000-8000-000000000014');
    update auth.users set banned_until = now() + interval '876000 hours'
     where id = '2c000000-0000-4000-8000-000000000005';

    perform pg_temp.registrar('F1a. admins em user_roles: 5 linhas (1 utilizavel + 4 inutilizaveis)', '5',
      (select count(*)::text from public.user_roles where role = 'admin'));
    perform pg_temp.registrar('F1b. so 1 desses admins e utilizavel', '1',
      (select count(*)::text from public.user_roles r
        where r.role = 'admin' and public.conta_ativa(r.user_id)));

    -- O caso que o trigger ANTIGO errava: ele contava as 4 linhas inutilizaveis como
    -- "sobrou admin" e deixava remover o unico utilizavel.
    perform pg_temp.registrar('F2. apagar o UNICO admin utilizavel e recusado (postgres)', 'erro 42501',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000001' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));
    perform pg_temp.registrar('F3. rebaixar o unico admin utilizavel e recusado', 'erro 42501',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with u as (update public.user_roles set role = 'operacional'
                         where user_id = '2c000000-0000-4000-8000-000000000001' and role = 'admin' returning 1)
             select count(*)::text from u$sql$));
    perform pg_temp.registrar('F4. service_role tambem e recusado (a recusa nao e falta de EXECUTE: ver F6)', 'erro 42501',
      pg_temp.medir_como('service_role', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000001' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));

    perform pg_temp.registrar('F5. apagar a linha de um admin BANIDO e permitido', '1',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000005' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));
    perform pg_temp.registrar('F6. apagar o papel ORFAO como service_role e permitido (prova que o trigger executa conta_ativa nesse papel)', '1',
      pg_temp.medir_como('service_role', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000006' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));
    perform pg_temp.registrar('F7a. apagar a linha de exclusao LOGICA e permitido', '1',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000007' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));
    perform pg_temp.registrar('F7b. apagar o papel de conta SEM registro em auth.users e permitido', '1',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000015' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));

    perform pg_temp.registrar('F8. sobrou so ADM_OK: apagar continua recusado', 'erro 42501',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000001' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));

    -- Sem NENHUM admin utilizável: limpar a linha inutilizável é permitido e
    -- conceder admin a outra conta (INSERT) nunca dispara o trigger.
    update auth.users set banned_until = now() + interval '876000 hours'
     where id = '2c000000-0000-4000-8000-000000000001';
    perform pg_temp.registrar('F9a. nenhum admin utilizavel: remover a linha inutilizavel e permitido (limpeza)', '1',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with d as (delete from public.user_roles
                         where user_id = '2c000000-0000-4000-8000-000000000001' and role = 'admin' returning 1)
             select count(*)::text from d$sql$));
    perform pg_temp.registrar('F9b. conceder admin continua possivel (caminho de recuperacao)', '1',
      pg_temp.medir_como('postgres', null, null, null,
        $sql$with i as (insert into public.user_roles (user_id, role)
                         values ('2c000000-0000-4000-8000-000000000004', 'admin') returning 1)
             select count(*)::text from i$sql$));
  end if;
end;
$bloco_f_setup$;


-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado order by ordem;

select count(*) filter (where situacao = 'PASS')   as passou,
       count(*) filter (where situacao = 'FAIL')   as falhou,
       count(*) filter (where situacao = 'PULADO') as pulado,
       count(*)                                    as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '015_revogacao_de_identidade: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
