-- Gate C · D1 · migration 055 — a data de execução do serviço precisa estar dentro da vigência do
-- contrato da operação.
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Tudo numa transação que
-- termina em ROLLBACK. NUNCA rodar contra Production nem homologação.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION E FALHA SEM ELA (RED da sessão 35).
--
-- A REGRA (decisão do responsável, 16/11/2026):
--   - a data de execução do serviço (a data da folha) fica entre o início e o fim do contrato da
--     operação, os dois INCLUSIVOS; contrato sem fim = vigência aberta;
--   - serviço executado dentro da vigência pode ser faturado depois, mesmo após o fim;
--   - lançamento histórico não é alterado nem recalculado, fatura emitida não muda;
--   - operação sem contrato segue as regras que já tinha (nenhuma restrição contratual nova);
--   - as datas do próprio contrato precisam ser plausíveis: fim >= início, anos de 1900 a 2100
--     (os mesmos limites que a tela já usa — `clientes/_dominio.ts`).
--
-- O QUE ESTE ARQUIVO NÃO PROVA, de propósito: adicionais de serviço (`billing_additionals`, por
-- período) e o legado de contêiner (`container_services`) — sem "data de execução" definida pela
-- regra aprovada (decisão pendente); o motor LIGADO (provado no E2E, spec 50 CN-D).

begin;

create temporary table _resultado (ordem serial, caso text, esperado text, obtido text, situacao text) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text)
returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido, case when _esperado is not distinct from _obtido then 'PASS' else 'FAIL' end);
end;
$$;

-- Executa `_sql` como `authenticated` com as claims da conta e devolve o valor, ou 'erro <sqlstate>'.
create or replace function pg_temp.como(_uid text, _sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', _uid, 'role', 'authenticated',
    'aal', 'aal1', 'session_id', 'e5' || substr(_uid, 3))::text, true);
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
-- Igual, mas devolve sqlstate, mensagem, detalhe e dica (o que as telas recebem).
create or replace function pg_temp.erro_como(_uid text, _sql text) returns text language plpgsql as $$
declare _m text; _d text; _h text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', _uid, 'role', 'authenticated',
    'aal', 'aal1', 'session_id', 'e5' || substr(_uid, 3))::text, true);
  set local role authenticated;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics _m = message_text, _d = pg_exception_detail, _h = pg_exception_hint;
    set local role postgres;
    return sqlstate || '|' || _m || '|' || coalesce(_d, '') || '|' || coalesce(_h, '');
  end;
  set local role postgres;
  return 'aceito';
end;
$$;
-- Resultado de cada chamada, gravado num comando e conferido no SEGUINTE (o retrato do comando da
-- escrita não enxerga a própria escrita — artefato já visto no CP-10, na 052 e na 053).
create temporary table _chamada (k text primary key, v text) on commit drop;

create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c550000-0000-4000-8000-0000000000a1', _sql) $$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c550000-0000-4000-8000-0000000000a2', _sql) $$;
create or replace function pg_temp.erro_adm(_sql text) returns text language sql as $$
  select pg_temp.erro_como('5c550000-0000-4000-8000-0000000000a1', _sql) $$;

-- Linha de apontamento (payload das RPCs). `_versao` só para as v2 (0 = nova).
create or replace function pg_temp.linha(_emp int, _status text, _versao bigint default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('employee_id', '5c55f000-0000-4000-8000-00000000000' || _emp,
    'status', _status, 'check_in', case when _status = 'absent' then null else '08:00' end,
    'check_out', case when _status = 'absent' then null else '17:00' end, 'break_minutes', 60,
    'versao_esperada', _versao)) $$;

-- Desliga/religa o gatilho da 055 só para fabricar o HISTÓRICO anterior à migration (registros que
-- já existiam quando ela chegou). Sem a 055 (RED) não há gatilho: nada a fazer.
create or replace function pg_temp.gatilho_055(_ligado boolean) returns void language plpgsql as $$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass
               and tgname = 'trg_timesheet_entries_bloqueia_fora_da_vigencia') then
    execute format('alter table public.timesheet_entries %s trigger trg_timesheet_entries_bloqueia_fora_da_vigencia',
      case when _ligado then 'enable' else 'disable' end);
  end if;
end $$;

insert into auth.users (id) values ('5c550000-0000-4000-8000-0000000000a1'), ('5c550000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('e5550000-0000-4000-8000-0000000000a1', '5c550000-0000-4000-8000-0000000000a1', null),
  ('e5550000-0000-4000-8000-0000000000a2', '5c550000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c550000-0000-4000-8000-0000000000a1', 'admin'), ('5c550000-0000-4000-8000-0000000000a2', 'operacional');

-- Motor por vigência desligado nesta transação (o runner já nasce assim; o banco do E2E não).
do $$
begin
  if (select vigencia_ativa from public.financial_engine_settings) then
    perform pg_temp.adm($q$select public.alterar_motor_vigencia(false, 'Gate C D1 sintético', true)::text$q$);
  end if;
end $$;

-- Fixture. K1: 02/03 a 20/03/2026 (fim inclusivo). K2: desde 02/03/2026, sem fim. Diária 200 por 8 h,
-- custo 120. Uma folha por operação e dia.
insert into public.clients (id, name) values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from, valid_to) values
  ('5c55d000-0000-4000-8000-0000000000d1', '5c55c000-0000-4000-8000-0000000000c1', 'D1 K1', 200, 8, 1.5, 10, '2026-03-02', '2026-03-20'),
  ('5c55d000-0000-4000-8000-0000000000d2', '5c55c000-0000-4000-8000-0000000000c1', 'D1 K2 aberto', 200, 8, 1.5, 10, '2026-03-02', null);
insert into public.operations (id, client_id, contract_id, type, name, agreed_amount) values
  ('5c55e000-0000-4000-8000-0000000000e1', '5c55c000-0000-4000-8000-0000000000c1', '5c55d000-0000-4000-8000-0000000000d1', 'fixed', 'D1 fixa K1', null),
  ('5c55e000-0000-4000-8000-0000000000e2', '5c55c000-0000-4000-8000-0000000000c1', '5c55d000-0000-4000-8000-0000000000d2', 'fixed', 'D1 fixa K2', null),
  ('5c55e000-0000-4000-8000-0000000000e3', '5c55c000-0000-4000-8000-0000000000c1', null, 'spot', 'D1 avulsa sem contrato', 150);
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('5c55a000-0000-4000-8000-000000000001', '5c55e000-0000-4000-8000-0000000000e1', 'Dia 08-17', '08:00', '17:00', 60, false),
  ('5c55a000-0000-4000-8000-000000000002', '5c55e000-0000-4000-8000-0000000000e2', 'Dia 08-17', '08:00', '17:00', 60, false),
  ('5c55a000-0000-4000-8000-000000000003', '5c55e000-0000-4000-8000-0000000000e3', 'Dia 08-17', '08:00', '17:00', 60, false);
insert into public.employees (id, name, daily_cost)
  select ('5c55f000-0000-4000-8000-00000000000' || n)::uuid, 'D1 E' || n, 120 from generate_series(1, 9) n;
insert into public.operation_team (operation_id, shift_id, employee_id, active)
  select '5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001',
         ('5c55f000-0000-4000-8000-00000000000' || n)::uuid, true from generate_series(1, 9) n;
insert into public.user_operation_access (user_id, operation_id) values
  ('5c550000-0000-4000-8000-0000000000a2', '5c55e000-0000-4000-8000-0000000000e1');
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c55b000-0000-4000-8000-000000000001', '5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-01', 'open'),
  ('5c55b000-0000-4000-8000-000000000002', '5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-02', 'open'),
  ('5c55b000-0000-4000-8000-000000000003', '5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-20', 'open'),
  ('5c55b000-0000-4000-8000-000000000004', '5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-21', 'open'),
  ('5c55b000-0000-4000-8000-000000000005', '5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-10', 'open'),
  ('5c55b000-0000-4000-8000-000000000006', '5c55e000-0000-4000-8000-0000000000e2', '5c55a000-0000-4000-8000-000000000002', '2030-01-10', 'open'),
  ('5c55b000-0000-4000-8000-000000000007', '5c55e000-0000-4000-8000-0000000000e3', '5c55a000-0000-4000-8000-000000000003', '2026-12-25', 'open');

-- ---------------------------------------------------------------------------
-- A. Catálogo
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. gatilho BEFORE INSERT OR UPDATE FOR EACH ROW, habilitado, nos apontamentos',
  '23|O|recusar_execucao_fora_da_vigencia',
  (select t.tgtype::text || '|' || t.tgenabled::text || '|' || p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.timesheet_entries'::regclass and t.tgname = 'trg_timesheet_entries_bloqueia_fora_da_vigencia'));
select pg_temp.registrar('A2. a função é SECURITY DEFINER da postgres e fixa o search_path',
  'true|postgres|true',
  (select p.prosecdef || '|' || pg_get_userbyid(p.proowner) || '|'
          || exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = to_regprocedure('public.recusar_execucao_fora_da_vigencia()')));
select pg_temp.registrar('A3. ninguém de fora executa a função (anon, authenticated, service_role, operacional, PUBLIC)', '0',
  (select case when to_regprocedure('public.recusar_execucao_fora_da_vigencia()') is null then 'função ausente'
     else ((select count(*) from unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r
              where has_function_privilege(r, to_regprocedure('public.recusar_execucao_fora_da_vigencia()'), 'EXECUTE'))
           + (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = to_regprocedure('public.recusar_execucao_fora_da_vigencia()')
                 and a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text end));
select pg_temp.registrar('A4. CHECK das datas do contrato existe e é NOT VALID (não reprova registro antigo)', 'c|false',
  (select contype::text || '|' || convalidated::text from pg_constraint
    where conrelid = 'public.contracts'::regclass and conname = 'contracts_vigencia_valida'));
select pg_temp.registrar('A5. o gatilho roda antes do de versão (zz_versao continua o último BEFORE)', 'true',
  (select ('trg_timesheet_entries_bloqueia_fora_da_vigencia' < 'trg_timesheet_entries_zz_versao')::text));

-- ---------------------------------------------------------------------------
-- B. Datas do contrato: gravação direta (PostgREST = authenticated) e pela RPC
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. contrato com início e fim válidos é aceito', 'aceito',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B1', '2026-01-01', '2026-12-31') returning 'aceito'$q$));
select pg_temp.registrar('B2. contrato sem data final é aceito (vigência aberta)', 'aceito',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B2', '2026-01-01', null) returning 'aceito'$q$));
insert into _chamada select 'B3',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B3', '2026-03-10', '2026-03-01') returning 'aceito'$q$);
select pg_temp.registrar('B3. fim antes do início é recusado (23514) e nada é gravado', 'erro 23514|0',
  (select v from _chamada where k = 'B3') || '|' || (select count(*)::text from public.contracts where name = 'D1 B3'));
select pg_temp.registrar('B4. fim no mesmo dia do início é aceito (o fim é inclusivo: contrato de um dia)', 'aceito',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B4', '2026-03-10', '2026-03-10') returning 'aceito'$q$));
select pg_temp.registrar('B5. fim no ano 0001 é recusado (23514)', 'erro 23514',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B5', '2026-11-01', '0001-01-01') returning 'aceito'$q$));
select pg_temp.registrar('B6. início no ano 0001 é recusado (23514), mesmo sem fim', 'erro 23514',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B6', '0001-01-01', null) returning 'aceito'$q$));
select pg_temp.registrar('B7. início depois de 2100 é recusado (23514)', 'erro 23514',
  pg_temp.adm($q$insert into public.contracts (client_id, name, valid_from, valid_to)
    values ('5c55c000-0000-4000-8000-0000000000c1', 'D1 B7', '2101-01-01', null) returning 'aceito'$q$));
insert into _chamada select 'B8',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c55c000-0000-4000-8000-0000000000c1', 'D1 B8', date '2026-03-10', date '2026-03-01', 'active', 200, 8, 1.5, 10, 'Cadastro inicial do contrato')::text$q$);
select pg_temp.registrar('B8. RPC criar_contrato_com_vigencia com fim antes do início é recusada; nem contrato nem vigência ficam',
  'erro 23514|0|0',
  (select v from _chamada where k = 'B8') || '|' || (select count(*)::text from public.contracts where name = 'D1 B8')
  || '|' || (select count(*)::text from public.contract_terms ct join public.contracts c on c.id = ct.contract_id where c.name = 'D1 B8'));
select pg_temp.registrar('B9. RPC com fim no ano 0001 é recusada (23514)', 'erro 23514',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c55c000-0000-4000-8000-0000000000c1', 'D1 B9', date '2026-11-01', date '0001-01-01', 'active', 200, 8, 1.5, 10, 'Cadastro inicial do contrato')::text$q$));
select pg_temp.registrar('B10. RPC com datas válidas continua criando contrato e vigência', 'true',
  (pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c55c000-0000-4000-8000-0000000000c1', 'D1 B10', date '2026-01-01', date '2026-06-30', 'active', 200, 8, 1.5, 10, 'Cadastro inicial do contrato')::text$q$)
     ~ '^[0-9a-f-]{36}$')::text);
insert into _chamada select 'B11',
  pg_temp.adm($q$update public.contracts set valid_to = '2025-12-31' where name = 'D1 B1' returning 'aceito'$q$);
select pg_temp.registrar('B11. alterar um contrato existente para fim antes do início é recusado; o fim fica como estava',
  'erro 23514|2026-12-31',
  (select v from _chamada where k = 'B11') || '|' || (select valid_to::text from public.contracts where name = 'D1 B1'));
select pg_temp.registrar('B12. alterar para outro fim válido é aceito', 'aceito',
  pg_temp.adm($q$update public.contracts set valid_to = '2026-06-30' where name = 'D1 B1' returning 'aceito'$q$));

-- ---------------------------------------------------------------------------
-- C. Data de execução × vigência: gravação direta pela API (admin)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.lancar(_folha int, _emp int, _status text default 'present') returns text language sql as $$
  select pg_temp.adm(format($f$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c55b000-0000-4000-8000-00000000000%s', '5c55f000-0000-4000-8000-00000000000%s', %L, %L, %L, 60)
    returning billed_amount, cost_amount) select 'aceito|' || coalesce(billed_amount::text, '-') || '|' || coalesce(cost_amount::text, '-') from i$f$,
    _folha, _emp, _status, case when _status = 'absent' then null else '08:00' end, case when _status = 'absent' then null else '17:00' end)) $$;

insert into _chamada select 'C1', pg_temp.lancar(1, 1);
select pg_temp.registrar('C1. execução ANTES do início (01/03) é recusada (23514) e nada é gravado', 'erro 23514|0',
  (select v from _chamada where k = 'C1') || '|' || (select count(*)::text from public.timesheet_entries
     where timesheet_id = '5c55b000-0000-4000-8000-000000000001' and employee_id = '5c55f000-0000-4000-8000-000000000001'));
select pg_temp.registrar('C2. execução NO PRIMEIRO DIA (02/03) é aceita, com os valores de antes (R$ 200 / R$ 120)', 'aceito|200.00|120.00',
  pg_temp.lancar(2, 1));
select pg_temp.registrar('C3. execução NO ÚLTIMO DIA (20/03, fim inclusivo) é aceita', 'aceito|200.00|120.00',
  pg_temp.lancar(3, 1));
insert into _chamada select 'C4', pg_temp.lancar(4, 1);
select pg_temp.registrar('C4. execução DEPOIS do fim (21/03) é recusada (23514) e nada é gravado', 'erro 23514|0',
  (select v from _chamada where k = 'C4') || '|' || (select count(*)::text from public.timesheet_entries
     where timesheet_id = '5c55b000-0000-4000-8000-000000000004'));
select pg_temp.registrar('C5. a mensagem diz a data e a vigência, sem texto cru do PostgreSQL; o detalhe identifica a regra',
  '23514|A data 21/03/2026 está fora da vigência do contrato desta operação (de 02/03/2026 até 20/03/2026). Lance só datas dentro da vigência ou ajuste a vigência do contrato.|vigencia_do_contrato|Serviço executado dentro da vigência pode ser faturado mesmo depois do fim do contrato.',
  pg_temp.erro_adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c55b000-0000-4000-8000-000000000004', '5c55f000-0000-4000-8000-000000000002', 'present', '08:00', '17:00', 60)$q$));
select pg_temp.registrar('C6. ausência fora da vigência é aceita (não é serviço executado; nada é cobrado)', 'aceito|0.00|0.00',
  pg_temp.lancar(4, 3, 'absent'));
select pg_temp.registrar('C7. contrato sem fim: data muito posterior ao início (10/01/2030) é aceita', 'aceito|200.00|120.00',
  pg_temp.lancar(6, 1));
select pg_temp.registrar('C8. operação SEM contrato (avulsa) não ganha restrição contratual (25/12/2026 aceito)', 'aceito',
  split_part(pg_temp.lancar(7, 1), '|', 1));

-- ---------------------------------------------------------------------------
-- D. Pelas RPCs das telas (admin v1/v2, operador v1/v2): fora recusado e atômico, dentro aceito
-- ---------------------------------------------------------------------------

create or replace function pg_temp.folhas_em(_data text) returns text language sql as $$
  select count(*)::text from public.timesheets where operation_id = '5c55e000-0000-4000-8000-0000000000e1' and work_date = _data::date $$;

insert into _chamada select 'D1',
  pg_temp.adm(format($q$select public.salvar_apontamento_admin('5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-23', %L::jsonb)::text$q$,
    jsonb_build_array(pg_temp.linha(4, 'present'))::text));
select pg_temp.registrar('D1. admin v1 fora da vigência: recusado (23514); nem folha nem apontamento ficam', 'erro 23514|0',
  (select v from _chamada where k = 'D1') || '|' || pg_temp.folhas_em('2026-03-23'));
insert into _chamada select 'D2',
  pg_temp.adm(format($q$select public.salvar_apontamento_admin_v2('5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-24', %L::jsonb)::text$q$,
    jsonb_build_array(pg_temp.linha(4, 'present', 0))::text));
select pg_temp.registrar('D2. admin v2 fora da vigência: recusado (23514); nem folha nem apontamento ficam', 'erro 23514|0',
  (select v from _chamada where k = 'D2') || '|' || pg_temp.folhas_em('2026-03-24'));
insert into _chamada select 'D3',
  pg_temp.adm(format($q$select public.salvar_apontamento_admin_v2('5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-05', %L::jsonb)::text$q$,
    jsonb_build_array(pg_temp.linha(4, 'present', 0))::text));
select pg_temp.registrar('D3. admin v2 dentro da vigência: gravado', 'true|1',
  ((select v from _chamada where k = 'D3') not like 'erro%')::text || '|' || pg_temp.folhas_em('2026-03-05'));
insert into _chamada select 'D4',
  pg_temp.ope(format($q$select public.salvar_apontamento_operacional('5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-25', %L::jsonb)::text$q$,
    jsonb_build_array(pg_temp.linha(5, 'present'))::text));
select pg_temp.registrar('D4. operador v1 fora da vigência: recusado (23514); nem folha nem apontamento ficam', 'erro 23514|0',
  (select v from _chamada where k = 'D4') || '|' || pg_temp.folhas_em('2026-03-25'));
insert into _chamada select 'D5',
  pg_temp.ope(format($q$select public.salvar_apontamento_operacional_v2('5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-26', %L::jsonb)::text$q$,
    jsonb_build_array(pg_temp.linha(5, 'present', 0))::text));
select pg_temp.registrar('D5. operador v2 fora da vigência: recusado (23514); nem folha nem apontamento ficam', 'erro 23514|0',
  (select v from _chamada where k = 'D5') || '|' || pg_temp.folhas_em('2026-03-26'));
insert into _chamada select 'D6',
  pg_temp.ope(format($q$select public.salvar_apontamento_operacional_v2('5c55e000-0000-4000-8000-0000000000e1', '5c55a000-0000-4000-8000-000000000001', '2026-03-06', %L::jsonb)::text$q$,
    jsonb_build_array(pg_temp.linha(5, 'present', 0))::text));
select pg_temp.registrar('D6. operador v2 dentro da vigência: gravado', 'true|1',
  ((select v from _chamada where k = 'D6') not like 'erro%')::text || '|' || pg_temp.folhas_em('2026-03-06'));

-- ---------------------------------------------------------------------------
-- E. Histórico anterior à regra: preservado; só uma NOVA decisão de cobrança passa pela regra
-- ---------------------------------------------------------------------------

-- Lançamento de 01/03 (antes do início de K1) que já existia quando a regra chegou.
select pg_temp.gatilho_055(false);
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
values ('5c55b100-0000-4000-8000-000000000001', '5c55b000-0000-4000-8000-000000000001', '5c55f000-0000-4000-8000-000000000008', 'present', '08:00', '17:00', 60);
select pg_temp.gatilho_055(true);
create temporary table _hist on commit drop as
  select billed_amount, cost_amount from public.timesheet_entries where id = '5c55b100-0000-4000-8000-000000000001';

select pg_temp.registrar('E1. o histórico fora da vigência continua lá, com os valores que tinha', '1|200.00|120.00',
  (select count(*)::text || '|' || max(billed_amount)::text || '|' || max(cost_amount)::text
     from public.timesheet_entries where id = '5c55b100-0000-4000-8000-000000000001'));
select pg_temp.registrar('E2. editar só a observação do histórico é aceito (não é nova cobrança)', 'aceito',
  pg_temp.adm($q$update public.timesheet_entries set notes = 'conferido' where id = '5c55b100-0000-4000-8000-000000000001' returning 'aceito'$q$));
insert into _chamada select 'E3',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '18:00' where id = '5c55b100-0000-4000-8000-000000000001' returning 'aceito'$q$);
select pg_temp.registrar('E3. alterar a jornada do histórico fora da vigência é recusado (seria nova cobrança fora dela); nada muda',
  'erro 23514|17:00:00',
  (select v from _chamada where k = 'E3') || '|' || (select check_out::text from public.timesheet_entries where id = '5c55b100-0000-4000-8000-000000000001'));
-- Mover a folha de 10/03 (com apontamento) para 22/03, fora da vigência.
insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
values ('5c55b000-0000-4000-8000-000000000005', '5c55f000-0000-4000-8000-000000000009', 'present', '08:00', '17:00', 60);
insert into _chamada select 'E4',
  pg_temp.adm($q$update public.timesheets set work_date = '2026-03-22' where id = '5c55b000-0000-4000-8000-000000000005' returning 'aceito'$q$);
select pg_temp.registrar('E4. mover para fora da vigência uma folha com apontamento é recusado (23514); a folha fica em 10/03',
  'erro 23514|2026-03-10',
  (select v from _chamada where k = 'E4') || '|' || (select work_date::text from public.timesheets where id = '5c55b000-0000-4000-8000-000000000005'));
select pg_temp.registrar('E5. encurtar a vigência de um contrato não altera lançamento já gravado (o de 10/01/2030 fica)', 'aceito|1|200.00',
  pg_temp.adm($q$update public.contracts set valid_to = '2029-12-31' where id = '5c55d000-0000-4000-8000-0000000000d2' returning 'aceito'$q$)
  || '|' || (select count(*)::text || '|' || max(billed_amount)::text from public.timesheet_entries
       where timesheet_id = '5c55b000-0000-4000-8000-000000000006'));

-- ---------------------------------------------------------------------------
-- F. Faturamento posterior: serviço executado na vigência sai na fatura depois do fim do contrato
-- ---------------------------------------------------------------------------

-- "Hoje" (CURRENT_DATE do runner) é bem depois de 20/03/2026, o fim de K1.
create temporary table _fatura on commit drop as
  select pg_temp.adm($q$select (public.gerar_fatura('5c55c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$) as id;
select pg_temp.registrar('F1. a fatura de 01–15/03 sai depois do fim do contrato, com o dia 02/03 (executado na vigência)', 'true|true',
  ((select id from _fatura) ~ '^[0-9a-f-]{36}$')::text || '|' ||
  ((select bool_and(e.invoice_id is not null) from public.timesheet_entries e
     where e.timesheet_id = '5c55b000-0000-4000-8000-000000000002'))::text);
select pg_temp.registrar('F2. os valores faturados são os gravados (R$ 200 / R$ 120 no dia 02/03); o histórico de 01/03 também, como estava',
  '200.00|120.00|true',
  (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries
     where timesheet_id = '5c55b000-0000-4000-8000-000000000002' and employee_id = '5c55f000-0000-4000-8000-000000000001')
  || '|' || ((select billed_amount from public.timesheet_entries where id = '5c55b100-0000-4000-8000-000000000001')
             = (select billed_amount from _hist))::text);
select pg_temp.registrar('F3. linha faturada continua imutável (42501), dentro ou fora da vigência', 'erro 42501',
  pg_temp.adm($q$update public.timesheet_entries set notes = 'x' where timesheet_id = '5c55b000-0000-4000-8000-000000000002'
    and employee_id = '5c55f000-0000-4000-8000-000000000001' returning 'aceito'$q$));

-- ---------------------------------------------------------------------------
-- L. Contrato antigo com datas inválidas (o caso 01/01/0001 do HML): a migration não o toca
-- ---------------------------------------------------------------------------

-- Fabrica o registro como ele existe hoje no HML: o CHECK NOT VALID não reprova o que já estava lá.
-- O ALTER TABLE exige que não haja evento pendente dos gatilhos adiáveis da 033 (taxa legada exige
-- vigência; com o motor desligado eles passam): dispara-os agora e volta ao modo adiado depois.
set constraints all immediate;
do $$
declare _def text;
begin
  select pg_get_constraintdef(oid) into _def from pg_constraint
   where conrelid = 'public.contracts'::regclass and conname = 'contracts_vigencia_valida';
  if _def is not null then
    alter table public.contracts drop constraint contracts_vigencia_valida;
  end if;
  insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from, valid_to)
  values ('5c55d000-0000-4000-8000-0000000000d9', '5c55c000-0000-4000-8000-0000000000c1', 'D1 legado', 250, 8, 1.5, 10, '2026-11-01', '0001-01-01');
  if _def is not null then
    execute format('alter table public.contracts add constraint contracts_vigencia_valida %s',
      regexp_replace(_def, '\s*NOT VALID\s*$', '') || ' not valid');
  end if;
end $$;
set constraints all deferred;
insert into public.operations (id, client_id, contract_id, type, name) values
  ('5c55e000-0000-4000-8000-0000000000e9', '5c55c000-0000-4000-8000-0000000000c1', '5c55d000-0000-4000-8000-0000000000d9', 'fixed', 'D1 fixa legado');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('5c55a000-0000-4000-8000-000000000009', '5c55e000-0000-4000-8000-0000000000e9', 'Dia 08-17', '08:00', '17:00', 60, false);
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c55b000-0000-4000-8000-000000000009', '5c55e000-0000-4000-8000-0000000000e9', '5c55a000-0000-4000-8000-000000000009', '2026-11-11', 'open');
select pg_temp.gatilho_055(false);
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
values ('5c55b100-0000-4000-8000-000000000009', '5c55b000-0000-4000-8000-000000000009', '5c55f000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', 60);
select pg_temp.gatilho_055(true);

select pg_temp.registrar('L1. o contrato antigo fica como estava (fim 01/01/0001, ativo)', '0001-01-01|active',
  (select valid_to::text || '|' || status::text from public.contracts where id = '5c55d000-0000-4000-8000-0000000000d9'));
select pg_temp.registrar('L2. o lançamento antigo dele também (R$ 250)', '1|250.00',
  (select count(*)::text || '|' || max(billed_amount)::text from public.timesheet_entries where id = '5c55b100-0000-4000-8000-000000000009'));
select pg_temp.registrar('L3. editar o contrato antigo sem corrigir as datas é recusado (o CHECK vale para a versão nova da linha)', 'erro 23514',
  pg_temp.adm($q$update public.contracts set name = 'D1 legado renomeado' where id = '5c55d000-0000-4000-8000-0000000000d9' returning 'aceito'$q$));
select pg_temp.registrar('L4. novo lançamento na operação do contrato antigo é recusado, dizendo que o fim está antes do início',
  '23514|O contrato desta operação tem fim (01/01/0001) antes do início (01/11/2026): nenhuma data está dentro da vigência. Corrija as datas do contrato antes de lançar.|vigencia_do_contrato',
  (select string_agg(p, '|' order by n) from unnest((string_to_array(pg_temp.erro_adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c55b000-0000-4000-8000-000000000009', '5c55f000-0000-4000-8000-000000000002', 'present', '08:00', '17:00', 60)$q$), '|'))[1:3])
    with ordinality as x(p, n)));
select pg_temp.registrar('L5. corrigir as datas do contrato antigo (sem fim) é aceito — o tratamento real depende de decisão', 'aceito',
  pg_temp.adm($q$update public.contracts set valid_to = null where id = '5c55d000-0000-4000-8000-0000000000d9' returning 'aceito'$q$));

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select situacao, caso, esperado, obtido from _resultado order by ordem;

do $$
declare _falhas int; _total int;
begin
  select count(*) filter (where situacao = 'FAIL'), count(*) into _falhas, _total from _resultado;
  if _falhas > 0 then
    raise exception 'Gate C D1 (055): % de % caso(s) divergente(s) — ver o relatório acima', _falhas, _total;
  end if;
  raise notice 'Gate C D1 (055): % casos conferidos; tudo será desfeito.', _total;
end $$;

rollback;
