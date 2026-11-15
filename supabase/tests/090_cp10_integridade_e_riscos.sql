-- QA-BS-01 · CP-10 — segurança, integridade e riscos financeiros, provados no banco.
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Tudo numa transação que
-- termina em ROLLBACK. NUNCA rodar contra Production nem homologação.
--
-- Cada caso tem uma CLASSE:
--   SEGURO  — a proteção existe no banco e foi exercida aqui (o teste falha se ela sumir);
--   RISCO   — RISCO REPRODUZIDO: o banco ACEITA hoje algo que a política financeira não deveria
--             aceitar sem controle. O "esperado" é o comportamento ATUAL, para que a CI acuse
--             quando ele mudar. Corrigir exige migration/RPC com autorização própria
--             (docs/qa/CP-10-seguranca-integridade-infraestrutura.md); ao aprovar a correção, a
--             asserção do caso passa a ser a nova regra.
--
--   S  superfície: catálogo e varredura das funções SECURITY DEFINER por papel
--   I  integridade do apontamento (AUT-CP05-01)
--   F  faturamento (AUT-CP07-01, DEC-CP07-01/02)
--   D  duplicidade financeira (DEC-CP06-04)
--   C  RPC legada de contêiner (AUT-CP06-01)
--   K  contrato encerrado (DEC-CP02-01)
--
-- Motor por vigência: a suíte roda no banco recém-migrado do runner SQL, onde o motor nasce
-- DESLIGADO (025); se estiver ligado (banco do E2E), é desligado dentro desta transação. As
-- proteções e os riscos medidos aqui não dependem do motor; o CN-D com o motor ligado é provado
-- no E2E (spec 50).

begin;

create temporary table _resultado (
  ordem serial, classe text, caso text, esperado text, obtido text, situacao text
) on commit drop;

create or replace function pg_temp.registrar(_classe text, _caso text, _esperado text, _obtido text)
returns void language plpgsql security definer as $$
begin
  insert into _resultado (classe, caso, esperado, obtido, situacao)
  values (_classe, _caso, _esperado, _obtido,
          case when _esperado is not distinct from _obtido then 'PASS' else 'FAIL' end);
end;
$$;

create or replace function pg_temp.medir_como(_claims jsonb, _sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', _claims::text, true);
  set local role authenticated;
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
create or replace function pg_temp.como(_uid text, _sql text) returns text language sql as $$
  select pg_temp.medir_como(
    jsonb_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal1', 'session_id', 'ec' || substr(_uid, 3)),
    _sql)
$$;
-- Admin SEM fator verificado (AAL1 basta: MFA opcional, 034). Operacional e conta sem papel.
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c100000-0000-4000-8000-0000000000a1', _sql) $$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c100000-0000-4000-8000-0000000000a2', _sql) $$;
create or replace function pg_temp.sem(_sql text) returns text language sql as $$
  select pg_temp.como('5c100000-0000-4000-8000-0000000000a3', _sql) $$;
-- GATE-FIN-02 (052): registro antigo de contêiner como FIXTURE histórica — a função chamada pela dona
-- (postgres), com as claims do admin; dentro dela (SECURITY DEFINER) nada muda.
create or replace function pg_temp.dono(_sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '5c100000-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'aal', 'aal1', 'session_id', 'ec100000-0000-4000-8000-0000000000a1')::text, true);
  begin
    execute _sql into _r;
  exception when others then
    return 'erro ' || sqlstate;
  end;
  return coalesce(_r, 'nulo');
end;
$$;

insert into auth.users (id) values
  ('5c100000-0000-4000-8000-0000000000a1'), ('5c100000-0000-4000-8000-0000000000a2'),
  ('5c100000-0000-4000-8000-0000000000a3');
insert into auth.sessions (id, user_id, not_after) values
  ('ec100000-0000-4000-8000-0000000000a1', '5c100000-0000-4000-8000-0000000000a1', null),
  ('ec100000-0000-4000-8000-0000000000a2', '5c100000-0000-4000-8000-0000000000a2', null),
  ('ec100000-0000-4000-8000-0000000000a3', '5c100000-0000-4000-8000-0000000000a3', null);
insert into public.user_roles (user_id, role) values
  ('5c100000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c100000-0000-4000-8000-0000000000a2', 'operacional');

do $$
begin
  if (select vigencia_ativa from public.financial_engine_settings) then
    perform pg_temp.adm($q$select public.alterar_motor_vigencia(false, 'CP-10 sintético', true)::text$q$);
  end if;
end $$;
select pg_temp.registrar('SEGURO', 'P0. motor por vigência desligado nesta transação', 'false',
  (select vigencia_ativa::text from public.financial_engine_settings));

-- ---------------------------------------------------------------------------
-- S. Superfície
-- ---------------------------------------------------------------------------

select pg_temp.registrar('SEGURO', 'S1. toda função SECURITY DEFINER de public fixa o search_path', '0',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));
select pg_temp.registrar('SEGURO', 'S2. nenhuma função SECURITY DEFINER executável por anon ou PUBLIC', '0',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or coalesce(aclcontains(p.proacl, makeaclitem(0, p.proowner, 'EXECUTE', false)), true))));
select pg_temp.registrar('SEGURO', 'S3. toda tabela de public tem RLS ativa e ao menos uma policy', '0',
  (select count(*)::text from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid))));

-- S4–S6: cada função DEFINER que authenticated executa é chamada com argumentos NULL por três
-- contas. Sem papel e operacional precisam ser recusados (42501) — salvo as que respondem só
-- sobre o próprio chamador e a lista do próprio operador. O admin é o controle: passa da guarda
-- (o erro passa a ser do payload nulo), menos nas RPCs do operador.
create temporary table _varredura (quem text, funcao text, estado text) on commit drop;
grant insert on _varredura to authenticated;
do $$
declare r record; quem text; uid text; st text;
begin
  foreach quem in array array['sem_papel', 'operacional', 'admin'] loop
    uid := case quem when 'admin' then '5c100000-0000-4000-8000-0000000000a1'
                     when 'operacional' then '5c100000-0000-4000-8000-0000000000a2'
                     else '5c100000-0000-4000-8000-0000000000a3' end;
    for r in
      select p.proname,
        (select string_agg(format('NULL::%s', format_type(t, null)), ', ' order by o)
           from unnest(p.proargtypes) with ordinality u(t, o)) as nulos
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    loop
      st := pg_temp.como(uid, format('select 1::text from public.%I(%s) limit 1', r.proname, coalesce(r.nulos, '')));
      insert into _varredura values (quem, r.proname, case when st like 'erro %' then substr(st, 6) else 'OK' end);
    end loop;
  end loop;
end $$;
select pg_temp.registrar('SEGURO', 'S4. sem papel: toda DEFINER recusa (42501), salvo as que respondem sobre o próprio chamador',
  'identidade_atual_utilizavel,mfa_bloqueia_excecao_aal1,mfa_cotidiano_ok',
  (select string_agg(funcao, ',' order by funcao) from _varredura where quem = 'sem_papel' and estado <> '42501'));
select pg_temp.registrar('SEGURO', 'S5. operacional: idem, mais a própria lista de operações',
  'identidade_atual_utilizavel,listar_operacoes_do_operador,mfa_bloqueia_excecao_aal1,mfa_cotidiano_ok',
  (select string_agg(funcao, ',' order by funcao) from _varredura where quem = 'operacional' and estado <> '42501'));
select pg_temp.registrar('SEGURO', 'S6. controle: o admin só é recusado pelo papel nas 5 RPCs do operador',
  'listar_apontamentos_do_operador,listar_equipe_do_operador,listar_operacoes_do_operador,listar_turnos_do_operador,salvar_apontamento_operacional',
  (select string_agg(funcao, ',' order by funcao) from _varredura where quem = 'admin' and estado = '42501'));
select pg_temp.registrar('SEGURO', 'S7. a varredura não é vazia (mais de 50 funções por conta)', 'true',
  ((select count(*) from _varredura where quem = 'admin') > 50)::text);

-- ---------------------------------------------------------------------------
-- Fixture de negócio (motor desligado: diária da operação e custo do colaborador)
-- ---------------------------------------------------------------------------

insert into public.clients (id, name) values
  ('5c10c000-0000-4000-8000-0000000000c1', 'CP10 cliente fixo'),
  ('5c10c000-0000-4000-8000-0000000000c2', 'CP10 cliente avulso'),
  ('5c10c000-0000-4000-8000-0000000000c3', 'CP10 cliente contrato encerrado');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from, valid_to) values
  ('5c10d000-0000-4000-8000-0000000000d1', '5c10c000-0000-4000-8000-0000000000c1', 'K1', 200, 8, 1.5, 10, '2026-01-01', null),
  ('5c10d000-0000-4000-8000-0000000000d3', '5c10c000-0000-4000-8000-0000000000c3', 'K3 encerra 10/03', 300, 8, 1.5, 10, '2026-01-01', '2026-03-10');
update public.contracts set status = 'inactive' where id = '5c10d000-0000-4000-8000-0000000000d3';
insert into public.employees (id, name, daily_cost) values
  ('5c10f000-0000-4000-8000-000000000001', 'CP10 E1', 120), ('5c10f000-0000-4000-8000-000000000002', 'CP10 E2', 130),
  ('5c10f000-0000-4000-8000-000000000003', 'CP10 E3', 140);
insert into public.operations (id, client_id, contract_id, type, name, agreed_amount, operation_date) values
  ('5c10e000-0000-4000-8000-0000000000a1', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d1', 'fixed', 'CP10 fixa', null, null),
  ('5c10e000-0000-4000-8000-0000000000a2', '5c10c000-0000-4000-8000-0000000000c2', null, 'spot', 'CP10 Contêiner 40 pés', 250, '2026-03-04'),
  ('5c10e000-0000-4000-8000-0000000000a3', '5c10c000-0000-4000-8000-0000000000c3', '5c10d000-0000-4000-8000-0000000000d3', 'fixed', 'CP10 contrato encerrado', null, null);
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('5c10a000-0000-4000-8000-000000000001', '5c10e000-0000-4000-8000-0000000000a1', 'Dia 08-17', '08:00', '17:00', 60, false),
  ('5c10a000-0000-4000-8000-000000000002', '5c10e000-0000-4000-8000-0000000000a1', 'Noite 22-07', '22:00', '07:00', 60, true);
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c10b000-0000-4000-8000-000000000001', '5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-000000000001', '2026-03-02', 'open'),
  ('5c10b000-0000-4000-8000-000000000002', '5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-000000000002', '2026-03-03', 'open'),
  ('5c10b000-0000-4000-8000-000000000003', '5c10e000-0000-4000-8000-0000000000a2', null, '2026-03-04', 'open'),
  ('5c10b000-0000-4000-8000-000000000004', '5c10e000-0000-4000-8000-0000000000a3', null, '2026-03-12', 'open'),
  ('5c10b000-0000-4000-8000-000000000005', '5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-000000000001', '2026-03-05', 'open');

-- ---------------------------------------------------------------------------
-- I. Integridade do apontamento (escrita direta do admin pela API = PostgREST)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('RISCO', 'I1. AUT-CP05-01: admin grava pela API saída ANTES da entrada em turno diurno (08:00→07:50) e vira jornada de 23h50',
  'aceito|1430',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b100-0000-4000-8000-000000000001', '5c10b000-0000-4000-8000-000000000001', '5c10f000-0000-4000-8000-000000000001', 'present', '08:00', '07:50', 0)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$));
select pg_temp.registrar('RISCO', 'I1b. e o valor cobrado sai inflado pela hora extra da jornada impossível (maior que a diária)', 'true',
  ((select billed_amount from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000001') > 200)::text);
select pg_temp.registrar('SEGURO', 'I2. virada legítima da meia-noite no turno noturno (22:00→07:00) é aceita com 8 h',
  'aceito|480',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b000-0000-4000-8000-000000000002', '5c10f000-0000-4000-8000-000000000002', 'present', '22:00', '07:00', 60)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$));
select pg_temp.registrar('SEGURO', 'I3. entrada igual à saída é recusada pelo banco', 'erro 23514',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b000-0000-4000-8000-000000000005', '5c10f000-0000-4000-8000-000000000003', 'present', '08:00', '08:00', 0) returning 'aceito'$q$));
select pg_temp.registrar('SEGURO', 'I4. intervalo negativo é recusado (014)', 'erro 23514',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b000-0000-4000-8000-000000000005', '5c10f000-0000-4000-8000-000000000003', 'present', '08:00', '17:00', -30) returning 'aceito'$q$));
-- GATE-FIN-03 (053): o intervalo maior que o tempo entre entrada e saída é recusado pelo banco.
-- Antes da 053 era RISCO ('aceito|0': jornada zerada e a diária cobrada). Cobertura completa
-- (limite exato, virada, ausência, UPDATE, RPCs) em supabase/tests/053_intervalo_maior_que_jornada.sql.
-- A chamada e a contagem em comandos separados: no mesmo comando a contagem veria o retrato anterior.
create temporary table _i5 on commit drop as
  select pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b000-0000-4000-8000-000000000005', '5c10f000-0000-4000-8000-000000000003', 'present', '08:00', '09:00', 300)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$) as r;
select pg_temp.registrar('SEGURO', 'I5. intervalo maior que a jornada (08:00→09:00 com 300 min) é recusado pelo banco (053) e nada é gravado',
  'erro 23514|0',
  (select r from _i5)
  || '|' || (select count(*)::text from public.timesheet_entries
              where timesheet_id = '5c10b000-0000-4000-8000-000000000005' and employee_id = '5c10f000-0000-4000-8000-000000000003'));
select pg_temp.registrar('SEGURO', 'I6. duplo envio: o mesmo colaborador na mesma folha não gera segunda linha (unicidade diária)', 'erro 23505',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b000-0000-4000-8000-000000000001', '5c10f000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', 60) returning 'aceito'$q$));
-- I7: duas abas — a escrita direta não tem controle de versão no banco: a segunda vence em silêncio.
select pg_temp.adm($q$update public.timesheet_entries set check_out = '16:00' where id = '5c10b100-0000-4000-8000-000000000001' returning 'a'$q$);
select pg_temp.registrar('RISCO', 'I7. versão obsoleta: a 2ª gravação (feita sobre a leitura anterior) sobrescreve a 1ª sem erro — sem controle de versão no banco',
  '1|17:00:00',
  pg_temp.adm($q$with u as (update public.timesheet_entries set check_in = '08:00', check_out = '17:00', break_minutes = 60
    where id = '5c10b100-0000-4000-8000-000000000001' returning check_out) select count(*) || '|' || max(check_out) from u$q$));
select pg_temp.registrar('SEGURO', 'I8. operacional e sem papel não gravam apontamento direto (a folha nem é visível: 23503)', 'erro 23503|erro 23503',
  pg_temp.ope($q$insert into public.timesheet_entries (timesheet_id, employee_id, status) values ('5c10b000-0000-4000-8000-000000000005', '5c10f000-0000-4000-8000-000000000002', 'present') returning 'x'$q$)
  || '|' || pg_temp.sem($q$insert into public.timesheet_entries (timesheet_id, employee_id, status) values ('5c10b000-0000-4000-8000-000000000005', '5c10f000-0000-4000-8000-000000000002', 'present') returning 'x'$q$));
select pg_temp.registrar('SEGURO', 'I9. o valor do payload não é fonte: billed_amount enviado é sobrescrito pela derivação', 'true',
  (pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes, billed_amount, cost_amount)
    values ('5c10b000-0000-4000-8000-000000000005', '5c10f000-0000-4000-8000-000000000002', 'present', '08:00', '17:00', 60, 99999, 0)
    returning billed_amount) select billed_amount::text from i$q$)::numeric < 99999)::text);

-- ---------------------------------------------------------------------------
-- F. Faturamento
-- ---------------------------------------------------------------------------

-- "Conferência" na tela = soma do que é faturável neste instante.
create temporary table _conferido on commit drop as
  select coalesce(sum(te.billed_amount), 0) as total from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id join public.operations o on o.id = t.operation_id
   where o.client_id = '5c10c000-0000-4000-8000-0000000000c1' and t.work_date between '2026-03-01' and '2026-03-15'
     and te.status <> 'absent' and te.invoice_id is null;
-- Depois da conferência e antes da emissão: um lançamento novo e um adicional novo.
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c10b000-0000-4000-8000-000000000006', '5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-000000000001', '2026-03-09', 'open');
select pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c10b000-0000-4000-8000-000000000006', '5c10f000-0000-4000-8000-000000000003', 'present', '08:00', '17:00', 60) returning 'x'$q$);
select pg_temp.adm($q$select public.registrar_adicional_idempotente('5c10a0d0-0000-4000-8000-000000000001', '5c10c000-0000-4000-8000-0000000000c1',
  '2026-03-09', '2026-03-09', 'Taxa extra CP10', 75, 'OS-CP10-1', null, '2026-03-01', '2026-03-15')::text$q$);

select pg_temp.registrar('RISCO', 'F1. AUT-CP07-01: gerar_fatura não recebe o total conferido — não há como o banco recusar valor diferente do aprovado',
  '_client_id uuid, _period_start date, _period_end date',
  (select pg_get_function_identity_arguments('public.gerar_fatura'::regproc)));
create temporary table _f1 on commit drop as select pg_temp.adm($q$select (public.gerar_fatura('5c10c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$) as id;
select pg_temp.registrar('RISCO', 'F2. a fatura sai com o lançamento E o adicional criados depois da conferência (total > conferido)', 'true',
  ((select total_amount from public.invoices where id = (select id from _f1)::uuid) > (select total from _conferido) + 75)::text);
select pg_temp.registrar('SEGURO', 'F3. itens da fatura somam o total e os lançamentos ficaram vinculados', 'true',
  ((select sum(amount) from public.invoice_items where invoice_id = (select id from _f1)::uuid)
     = (select total_amount from public.invoices where id = (select id from _f1)::uuid)
   and not exists (select 1 from public.timesheet_entries te join public.timesheets t on t.id = te.timesheet_id
                    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and te.status <> 'absent' and te.invoice_id is null))::text);
select pg_temp.registrar('RISCO', 'F4. DEC-CP07-01: o dia ABERTO (folhas em status open) foi faturado sem bloqueio', '0',
  (select count(*)::text from public.timesheets where operation_id = '5c10e000-0000-4000-8000-0000000000a1' and status <> 'open'));
select pg_temp.registrar('SEGURO', 'F5. repetir a emissão sem nada novo não cria fatura vazia nem duplicada (P0002)', 'erro P0002',
  pg_temp.adm($q$select (public.gerar_fatura('5c10c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$));
select pg_temp.registrar('SEGURO', 'F6. competência que não é a do cliente (01–20) e período invertido são recusados', 'erro 22023|erro 22023',
  pg_temp.adm($q$select (public.gerar_fatura('5c10c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-20')).id::text$q$)
  || '|' || pg_temp.adm($q$select (public.gerar_fatura('5c10c000-0000-4000-8000-0000000000c1', '2026-03-15', '2026-03-01')).id::text$q$));
-- Lançamento NOVO no período já faturado (esquecido): vira fatura complementar.
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c10b000-0000-4000-8000-000000000007', '5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-000000000001', '2026-03-10', 'open');
select pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c10b000-0000-4000-8000-000000000007', '5c10f000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', 60) returning 'x'$q$);
create temporary table _f7 on commit drop as
  select pg_temp.adm($q$select (public.gerar_fatura('5c10c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$) as id;
select pg_temp.registrar('RISCO', 'F7. DEC-CP07-02: lançamento novo em período já faturado é aceito e gera 2ª fatura na mesma competência', 'true|2',
  ((select id from _f7) ~ '^[0-9a-f-]{36}$')::text || '|' ||
  (select count(*)::text from public.invoices where client_id = '5c10c000-0000-4000-8000-0000000000c1' and period_start = '2026-03-01'));
select pg_temp.registrar('SEGURO', 'F8. lançamento faturado: UPDATE e DELETE recusados também para o admin', 'erro 42501|erro 42501',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '18:00' where id = '5c10b100-0000-4000-8000-000000000001' returning 'x'$q$)
  || '|' || pg_temp.adm($q$delete from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000001' returning 'x'$q$));
create temporary table _antes on commit drop as
  select billed_amount, cost_amount, daily_rate_snapshot, daily_cost_snapshot from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000001';
select pg_temp.adm($q$update public.employees set daily_cost = 999 where id = '5c10f000-0000-4000-8000-000000000001' returning 'x'$q$);
select pg_temp.adm($q$update public.contracts set daily_rate = 999 where id = '5c10d000-0000-4000-8000-0000000000d1' returning 'x'$q$);
select pg_temp.registrar('SEGURO', 'F9. custo e diária alterados depois da fatura não mudam receita, custo nem snapshots do faturado', 'true',
  ((select (billed_amount, cost_amount, daily_rate_snapshot, daily_cost_snapshot) from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000001')
     = (select (billed_amount, cost_amount, daily_rate_snapshot, daily_cost_snapshot) from _antes))::text);
select pg_temp.registrar('SEGURO', 'F10. a fatura não é gravável pela API, nem pelo admin (046)', 'erro 42501|erro 42501',
  pg_temp.adm($q$update public.invoices set total_amount = 1 where id = (select id::uuid from _f1) returning 'x'$q$)
  || '|' || pg_temp.adm($q$delete from public.invoice_items where invoice_id = (select id::uuid from _f1) returning 'x'$q$));
select pg_temp.registrar('RISCO', 'F11. DEC-CP07-03: reabrir a folha de um dia faturado continua permitido (o faturado segue imutável)', '1',
  pg_temp.adm($q$with u as (update public.timesheets set status = 'open' where id = '5c10b000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('RISCO', 'F12. DEC-CP07-03: não existe cancelamento nem estorno de fatura (nenhuma função de cancelar fatura)', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '(cancelar|estornar|anular)_fatura'));

-- ---------------------------------------------------------------------------
-- D. Duplicidade financeira (avulsa)
-- ---------------------------------------------------------------------------

select pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c10b000-0000-4000-8000-000000000003', '5c10f000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', 60),
         ('5c10b000-0000-4000-8000-000000000003', '5c10f000-0000-4000-8000-000000000002', 'present', '08:00', '17:00', 60) returning 'x'$q$);
select pg_temp.registrar('SEGURO', 'D1. mesma chave de idempotência e mesmo payload: um único adicional', 'true',
  (pg_temp.adm($q$select public.registrar_adicional_idempotente('5c10a0d0-0000-4000-8000-0000000000d1', '5c10c000-0000-4000-8000-0000000000c2', '2026-03-04', '2026-03-04', 'Contêiner 40 pés', 500, 'CNT-1', '5c10e000-0000-4000-8000-0000000000a2', '2026-03-01', '2026-03-15')::text$q$)
   = pg_temp.adm($q$select public.registrar_adicional_idempotente('5c10a0d0-0000-4000-8000-0000000000d1', '5c10c000-0000-4000-8000-0000000000c2', '2026-03-04', '2026-03-04', 'Contêiner 40 pés', 500, 'CNT-1', '5c10e000-0000-4000-8000-0000000000a2', '2026-03-01', '2026-03-15')::text$q$))::text);
select pg_temp.registrar('SEGURO', 'D2. mesma chave com payload diferente é recusada', 'erro 23505',
  pg_temp.adm($q$select public.registrar_adicional_idempotente('5c10a0d0-0000-4000-8000-0000000000d1', '5c10c000-0000-4000-8000-0000000000c2', '2026-03-04', '2026-03-04', 'Contêiner 40 pés', 600, 'CNT-1', '5c10e000-0000-4000-8000-0000000000a2', '2026-03-01', '2026-03-15')::text$q$));
select pg_temp.registrar('RISCO', 'D3. DEC-CP06-04: outro adicional IGUAL (mesmo serviço, referência e valor) com outra chave é aceito', 'true',
  (pg_temp.adm($q$select public.registrar_adicional_idempotente('5c10a0d0-0000-4000-8000-0000000000d2', '5c10c000-0000-4000-8000-0000000000c2', '2026-03-04', '2026-03-04', 'Contêiner 40 pés', 500, 'CNT-1', '5c10e000-0000-4000-8000-0000000000a2', '2026-03-01', '2026-03-15')::text$q$) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.registrar('RISCO', 'D4. registro antigo de contêiner da MESMA operação avulsa também é aceito (a tela só avisa)', 'true',
  (pg_temp.dono(format($q$select public.registrar_servico_container(%L::jsonb, '5c10a0d0-0000-4000-8000-0000000000d3', 'CP10 duplicidade')::text$q$,
    jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', '5c10e000-0000-4000-8000-0000000000a2',
      'solicitadoEm', '2026-03-04', 'executadoEm', '2026-03-04', 'descricao', 'Contêiner 40 pés', 'quantidade', 1,
      'receitaCentavos', 50000, 'custoTotalCentavos', 10000, 'referencia', 'CNT-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))))) ~ '^[0-9a-f-]{36}$')::text);
create temporary table _f2 on commit drop as select pg_temp.adm($q$select (public.gerar_fatura('5c10c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')).id::text$q$) as id;
select pg_temp.registrar('RISCO', 'D5. a fatura do avulso cobra o MESMO contêiner 4 vezes: 2 diárias (500) + 2 adicionais (1000) + registro antigo (500) = 2000',
  '2000.00', (select total_amount::text from public.invoices where id = (select id from _f2)::uuid));

-- ---------------------------------------------------------------------------
-- C. RPC legada de contêiner (AUT-CP06-01)
-- ---------------------------------------------------------------------------

-- 052 (GATE-FIN-02): o cadastro NOVO pela API está encerrado também no banco. O registro antigo usado
-- nos casos abaixo entra como fixture pela dona (o mesmo caminho que `corrigir_servico_container` usa
-- por dentro); correção e cancelamento do histórico seguem pela API do admin.
create temporary table _antes_c1 on commit drop as select count(*) as n from public.container_services;
create temporary table _tentativa_c1 on commit drop as select pg_temp.adm(format($q$select public.registrar_servico_container(%L::jsonb, '5c10a0d0-0000-4000-8000-0000000000c9', 'CP10 legado pela API')::text$q$,
    jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', null,
      'solicitadoEm', '2026-03-20', 'executadoEm', '2026-03-20', 'descricao', 'Contêiner legado CP10', 'quantidade', 1,
      'receitaCentavos', 30000, 'custoTotalCentavos', 10000, 'referencia', 'LEG-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))))) as r;
select pg_temp.registrar('SEGURO', 'C1. AUT-CP06-01 (052): o admin NÃO cria registro de contêiner pela RPC legada (42501) e nada é gravado',
  'erro 42501|0',
  (select r from _tentativa_c1) || '|' || ((select count(*) from public.container_services) - (select n from _antes_c1))::text);
create temporary table _c1 on commit drop as select pg_temp.dono(format($q$select public.registrar_servico_container(%L::jsonb, '5c10a0d0-0000-4000-8000-0000000000c1', 'CP10 legado')::text$q$,
    jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', null,
      'solicitadoEm', '2026-03-20', 'executadoEm', '2026-03-20', 'descricao', 'Contêiner legado CP10', 'quantidade', 1,
      'receitaCentavos', 30000, 'custoTotalCentavos', 10000, 'referencia', 'LEG-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))))) as id;
select pg_temp.registrar('SEGURO', 'C1b. a função continua existindo e criando pela DONA (fixture histórica; é o caminho interno da correção), com o adicional de R$ 300',
  'true|300.00', ((select id from _c1) ~ '^[0-9a-f-]{36}$')::text || '|' ||
  coalesce((select a.amount::text from public.container_services cs join public.billing_additionals a on a.id = cs.billing_additional_id
             where cs.id = (select id from _c1)::uuid), 'sem adicional'));
select pg_temp.registrar('SEGURO', 'C2. repetir a chamada com a mesma chave devolve o mesmo registro (idempotente)', 'true',
  (pg_temp.dono(format($q$select public.registrar_servico_container(%L::jsonb, '5c10a0d0-0000-4000-8000-0000000000c1', 'CP10 legado')::text$q$,
    jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', null,
      'solicitadoEm', '2026-03-20', 'executadoEm', '2026-03-20', 'descricao', 'Contêiner legado CP10', 'quantidade', 1,
      'receitaCentavos', 30000, 'custoTotalCentavos', 10000, 'referencia', 'LEG-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))))) = (select id from _c1))::text);
select pg_temp.registrar('SEGURO', 'C3. payload inválido é recusado', 'true',
  (pg_temp.dono($q$select public.registrar_servico_container('{"clienteId":"x"}'::jsonb, gen_random_uuid(), 'CP10 inválido')::text$q$) like 'erro %')::text);
select pg_temp.registrar('SEGURO', 'C4. nenhum papel externo chama a RPC legada: admin, operacional e sem papel 42501; anônimo e service_role sem EXECUTE',
  'erro 42501|erro 42501|erro 42501|false|false|false',
  pg_temp.adm($q$select public.registrar_servico_container('{}'::jsonb, gen_random_uuid(), 'x')::text$q$)
  || '|' || pg_temp.ope($q$select public.registrar_servico_container('{}'::jsonb, gen_random_uuid(), 'x')::text$q$)
  || '|' || pg_temp.sem($q$select public.registrar_servico_container('{}'::jsonb, gen_random_uuid(), 'x')::text$q$)
  || '|' || has_function_privilege('anon', 'public.registrar_servico_container(jsonb,uuid,text)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.registrar_servico_container(jsonb,uuid,text)', 'EXECUTE')::text
  || '|' || has_function_privilege('service_role', 'public.registrar_servico_container(jsonb,uuid,text)', 'EXECUTE')::text);
-- Correção e cancelamento do histórico (pela API do admin) continuam funcionando depois da 052.
create temporary table _c5 on commit drop as select pg_temp.adm(format($q$select public.corrigir_servico_container(%L::uuid, %L::jsonb, '5c10a0d0-0000-4000-8000-0000000000c5', 'CP10 correção: valor')::text$q$,
    (select id from _c1), jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', null,
      'solicitadoEm', '2026-03-20', 'executadoEm', '2026-03-20', 'descricao', 'Contêiner legado CP10', 'quantidade', 1,
      'receitaCentavos', 30000, 'custoTotalCentavos', 10000, 'referencia', 'LEG-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))) || jsonb_build_object('receitaCentavos', 32000))) as id;
select pg_temp.registrar('SEGURO', 'C5. a correção de registro antigo disponível segue pela API: um único substituto ativo, adicional de R$ 320, original cancelado, trilha corrected',
  'true|1|320.00|true|1',
  ((select id from _c5) ~ '^[0-9a-f-]{36}$')::text
  || '|' || (select count(*)::text from public.container_services where client_id = '5c10c000-0000-4000-8000-0000000000c2'
               and description = 'Contêiner legado CP10' and canceled_at is null)
  || '|' || coalesce((select a.amount::text from public.container_services cs join public.billing_additionals a on a.id = cs.billing_additional_id
                        where cs.id = (select id from _c5)::uuid), 'sem adicional')
  || '|' || ((select canceled_at is not null from public.container_services where id = (select id from _c1)::uuid))::text
  || '|' || (select count(*)::text from public.container_service_audit where service_id = (select id from _c1)::uuid and action = 'corrected'));
select pg_temp.registrar('SEGURO', 'C6. repetir a correção com a mesma chave devolve o mesmo substituto (idempotente)', 'true',
  (pg_temp.adm(format($q$select public.corrigir_servico_container(%L::uuid, %L::jsonb, '5c10a0d0-0000-4000-8000-0000000000c5', 'CP10 correção: valor')::text$q$,
    (select id from _c1), jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', null,
      'solicitadoEm', '2026-03-20', 'executadoEm', '2026-03-20', 'descricao', 'Contêiner legado CP10', 'quantidade', 1,
      'receitaCentavos', 30000, 'custoTotalCentavos', 10000, 'referencia', 'LEG-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))) || jsonb_build_object('receitaCentavos', 32000))) = (select id from _c5))::text);
select pg_temp.registrar('SEGURO', 'C7. registro CANCELADO não é corrigido (55000)', 'erro 55000',
  pg_temp.adm(format($q$select public.corrigir_servico_container(%L::uuid, %L::jsonb, gen_random_uuid(), 'CP10 correção indevida')::text$q$,
    (select id from _c1), jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', null,
      'solicitadoEm', '2026-03-20', 'executadoEm', '2026-03-20', 'descricao', 'Contêiner legado CP10', 'quantidade', 1,
      'receitaCentavos', 30000, 'custoTotalCentavos', 10000, 'referencia', 'LEG-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))) || jsonb_build_object('receitaCentavos', 99900))));
select pg_temp.registrar('SEGURO', 'C8. registro FATURADO (o do D4, na fatura do D5) não é corrigido (55000)', 'erro 55000',
  pg_temp.adm(format($q$select public.corrigir_servico_container(%L::uuid, %L::jsonb, gen_random_uuid(), 'CP10 correção de faturado')::text$q$,
    (select cs.id from public.container_services cs join public.billing_additionals a on a.id = cs.billing_additional_id
      where a.invoice_id = (select id from _f2)::uuid limit 1),
    jsonb_build_object('clienteId', '5c10c000-0000-4000-8000-0000000000c2', 'operacaoId', '5c10e000-0000-4000-8000-0000000000a2',
      'solicitadoEm', '2026-03-04', 'executadoEm', '2026-03-04', 'descricao', 'Contêiner 40 pés', 'quantidade', 1,
      'receitaCentavos', 99900, 'custoTotalCentavos', 10000, 'referencia', 'CNT-1', 'modalidadeCusto', 'total_distribuido',
      'competenciaCobranca', null, 'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', '5c10f000-0000-4000-8000-000000000003', 'custoCentavos', 10000))))));
create temporary table _c9 on commit drop as
  select pg_temp.adm(format($q$select public.cancelar_servico_container(%L::uuid, 'CP10 cancelamento do substituto')::text$q$, (select id from _c5))) as r;
select pg_temp.registrar('SEGURO', 'C9. o cancelamento do histórico segue pela API do admin (o substituto da correção), com trilha canceled', 'true|true|1',
  ((select r from _c9) not like 'erro %')::text
  || '|' || (select canceled_at is not null from public.container_services where id = (select id from _c5)::uuid)::text
  || '|' || (select count(*)::text from public.container_service_audit where service_id = (select id from _c5)::uuid and action = 'canceled'));

-- ---------------------------------------------------------------------------
-- K. Contrato encerrado (DEC-CP02-01)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('RISCO', 'K1. DEC-CP02-01: dia DEPOIS do fim do contrato (inativo, fim 10/03, dia 12/03) é lançado e cobrado pela diária dele',
  'aceito|300.00',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c10b000-0000-4000-8000-000000000004', '5c10f000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', 60)
    returning billed_amount) select 'aceito|' || billed_amount from i$q$));

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select classe, situacao, caso, esperado, obtido from _resultado order by ordem;

do $$
declare _falhas int; _seguro int; _risco int;
begin
  select count(*) filter (where situacao = 'FAIL'), count(*) filter (where classe = 'SEGURO'),
         count(*) filter (where classe = 'RISCO')
    into _falhas, _seguro, _risco from _resultado;
  if _falhas > 0 then
    raise exception 'CP-10: % caso(s) divergente(s) — ver o relatório acima', _falhas;
  end if;
  raise notice 'CP-10: % casos SEGURO e % RISCO REPRODUZIDO conferidos; tudo será desfeito.', _seguro, _risco;
end $$;

rollback;
