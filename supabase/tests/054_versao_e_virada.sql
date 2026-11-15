-- GATE-FIN-05 · migration 054 — EXPANDIR: versão dos apontamentos, contratos v2 e confirmação de virada.
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Tudo numa transação que
-- termina em ROLLBACK. NUNCA rodar contra Production nem homologação.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION E FALHA SEM ELA (RED da sessão 22).
--
-- Cada caso diz a que gate pertence:
--   054  — exigência desta expansão (versão monotônica, contratos v2 com versão obrigatória,
--          confirmação de virada auditada e invalidável, legado intacto, fatura igual);
--   058  — o que SÓ a contração vai exigir. Aqui o caso registra o comportamento ATUAL do legado
--          (ainda aceito), para a CI acusar quando a 058 o mudar. I1 e I7 seguem RISCO na SQL 090.
--
-- A concorrência REAL (duas conexões, intercalação controlada) não cabe numa transação única:
-- está em `scripts/testar-concorrencia-apontamento-local.py`.
--
-- Motor por vigência: roda DESLIGADO (o runner nasce assim; se ligado, é desligado aqui), como a 053.

begin;

create temporary table _resultado (ordem serial, gate text, caso text, esperado text, obtido text, situacao text) on commit drop;
create temporary table _chamada (k text primary key, v text) on commit drop;

create or replace function pg_temp.registrar(_gate text, _caso text, _esperado text, _obtido text)
returns void language plpgsql security definer as $$
begin
  insert into _resultado (gate, caso, esperado, obtido, situacao)
  values (_gate, _caso, _esperado, _obtido, case when _esperado is not distinct from _obtido then 'PASS' else 'FAIL' end);
end;
$$;

-- Executa `_sql` como `authenticated` com as claims da conta; devolve o valor ou 'erro <sqlstate>'.
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
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c540000-0000-4000-8000-0000000000a1', _sql) $$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c540000-0000-4000-8000-0000000000a2', _sql) $$;
create or replace function pg_temp.sem(_sql text) returns text language sql as $$
  select pg_temp.como('5c540000-0000-4000-8000-0000000000a3', _sql) $$;
create or replace function pg_temp.ope2(_sql text) returns text language sql as $$
  select pg_temp.como('5c540000-0000-4000-8000-0000000000a4', _sql) $$;
-- Como a dona (postgres), mas com as claims do admin; devolve o valor ou o erro.
create or replace function pg_temp.dono(_sql text) returns text language plpgsql as $$
declare _r text;
begin
  begin
    execute _sql into _r;
  exception when others then
    return 'erro ' || sqlstate;
  end;
  return coalesce(_r, 'nulo');
end;
$$;

-- Guarda o resultado de uma chamada; a conferência vem em OUTRO comando (no mesmo comando a
-- leitura veria o retrato de antes da escrita).
create or replace function pg_temp.guardar(_k text, _v text) returns void language sql as $$
  insert into _chamada values (_k, _v) $$;
create or replace function pg_temp.v(_k text) returns text language sql as $$
  select v from _chamada where k = _k $$;

-- Linha do payload v2.
create or replace function pg_temp.linha(_emp text, _status text, _ent text, _sai text, _int int, _versao bigint, _extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('employee_id', '5c54f000-0000-4000-8000-00000000000' || _emp,
    'status', _status, 'check_in', _ent, 'check_out', _sai, 'break_minutes', _int, 'notes', null,
    'versao_esperada', _versao)) || _extra $$;
-- Chamada v2 que devolve "resultado|versao" da primeira linha.
create or replace function pg_temp.sql_v2(_funcao text, _op text, _turno text, _data text, _linhas jsonb) returns text language sql as $$
  select format($f$select (r -> 'linhas' -> 0 ->> 'resultado') || '|' || (r -> 'linhas' -> 0 ->> 'versao')
    from (select public.%s(%L::uuid, %s, %L::date, %L::jsonb) as r) x$f$,
    _funcao, '5c54e000-0000-4000-8000-0000000000' || _op,
    case when _turno is null then 'null::uuid' else quote_literal('5c54a000-0000-4000-8000-00000000000' || _turno) || '::uuid' end,
    _data, _linhas::text) $$;
create or replace function pg_temp.admv2(_turno text, _data text, _linhas jsonb) returns text language sql as $$
  select pg_temp.adm(pg_temp.sql_v2('salvar_apontamento_admin_v2', 'e1', _turno, _data, _linhas)) $$;
create or replace function pg_temp.opev2(_turno text, _data text, _linhas jsonb) returns text language sql as $$
  select pg_temp.ope(pg_temp.sql_v2('salvar_apontamento_operacional_v2', 'e1', _turno, _data, _linhas)) $$;

-- Leitura da linha gravada (como dona, para conferir o estado real).
create or replace function pg_temp.gravado(_emp text, _data text) returns text language sql as $$
  select coalesce((select te.check_in || '-' || te.check_out || '/' || te.break_minutes || '/v'
      || coalesce(to_jsonb(te) ->> 'versao', '?')
    from public.timesheet_entries te
   where te.employee_id = ('5c54f000-0000-4000-8000-00000000000' || _emp)::uuid
     and te.work_date = _data::date
     and te.operation_id = '5c54e000-0000-4000-8000-0000000000e1'), 'ausente') $$;
create or replace function pg_temp.id_de(_emp text, _data text) returns uuid language sql as $$
  select te.id from public.timesheet_entries te
   where te.employee_id = ('5c54f000-0000-4000-8000-00000000000' || _emp)::uuid and te.work_date = _data::date
     and te.operation_id = '5c54e000-0000-4000-8000-0000000000e1' $$;
create or replace function pg_temp.versao_de(_emp text, _data text) returns bigint language sql as $$
  select (to_jsonb(te) ->> 'versao')::bigint from public.timesheet_entries te
   where te.employee_id = ('5c54f000-0000-4000-8000-00000000000' || _emp)::uuid and te.work_date = _data::date
     and te.operation_id = '5c54e000-0000-4000-8000-0000000000e1' $$;
create or replace function pg_temp.situacao(_emp text, _data text) returns text language sql as $$
  select pg_temp.adm(format('select public.situacao_da_virada(%L::uuid)', pg_temp.id_de(_emp, _data))) $$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c540000-0000-4000-8000-0000000000a1'), ('5c540000-0000-4000-8000-0000000000a2'),
  ('5c540000-0000-4000-8000-0000000000a3'), ('5c540000-0000-4000-8000-0000000000a4');
insert into auth.sessions (id, user_id, not_after) values
  ('e5540000-0000-4000-8000-0000000000a1', '5c540000-0000-4000-8000-0000000000a1', null),
  ('e5540000-0000-4000-8000-0000000000a2', '5c540000-0000-4000-8000-0000000000a2', null),
  ('e5540000-0000-4000-8000-0000000000a3', '5c540000-0000-4000-8000-0000000000a3', null),
  ('e5540000-0000-4000-8000-0000000000a4', '5c540000-0000-4000-8000-0000000000a4', null);
insert into public.user_roles (user_id, role) values
  ('5c540000-0000-4000-8000-0000000000a1', 'admin'), ('5c540000-0000-4000-8000-0000000000a2', 'operacional'),
  ('5c540000-0000-4000-8000-0000000000a4', 'operacional');

do $$
begin
  if (select vigencia_ativa from public.financial_engine_settings) then
    perform pg_temp.adm($q$select public.alterar_motor_vigencia(false, 'GATE-FIN-05 sintético', true)::text$q$);
  end if;
end $$;

insert into public.clients (id, name) values
  ('5c54c000-0000-4000-8000-0000000000c1', 'GF05 cliente'), ('5c54c000-0000-4000-8000-0000000000c2', 'GF05 outro');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from) values
  ('5c54d000-0000-4000-8000-0000000000d1', '5c54c000-0000-4000-8000-0000000000c1', 'GF05 K', 200, 8, 1.5, 10, '2026-01-01');
insert into public.operations (id, client_id, contract_id, type, name) values
  ('5c54e000-0000-4000-8000-0000000000e1', '5c54c000-0000-4000-8000-0000000000c1', '5c54d000-0000-4000-8000-0000000000d1', 'fixed', 'GF05 fixa'),
  ('5c54e000-0000-4000-8000-0000000000e2', '5c54c000-0000-4000-8000-0000000000c2', null, 'spot', 'GF05 outra');
update public.operations set agreed_amount = 150 where id = '5c54e000-0000-4000-8000-0000000000e2';
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('5c54a000-0000-4000-8000-000000000001', '5c54e000-0000-4000-8000-0000000000e1', 'Dia 08-17', '08:00', '17:00', 60, false),
  ('5c54a000-0000-4000-8000-000000000002', '5c54e000-0000-4000-8000-0000000000e1', 'Noite 22-07', '22:00', '07:00', 60, true),
  ('5c54a000-0000-4000-8000-000000000003', '5c54e000-0000-4000-8000-0000000000e2', 'Outra 08-17', '08:00', '17:00', 60, false);
insert into public.employees (id, name, daily_cost)
  select ('5c54f000-0000-4000-8000-00000000000' || n)::uuid, 'GF05 E' || n, 120 from generate_series(1, 9) n;
insert into public.operation_team (operation_id, shift_id, employee_id, active)
  select '5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', ('5c54f000-0000-4000-8000-00000000000' || n)::uuid, true
    from generate_series(1, 6) n;
insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000002', '5c54f000-0000-4000-8000-000000000007', true),
  ('5c54e000-0000-4000-8000-0000000000e2', '5c54a000-0000-4000-8000-000000000003', '5c54f000-0000-4000-8000-000000000009', true);
insert into public.user_operation_access (user_id, operation_id) values
  ('5c540000-0000-4000-8000-0000000000a2', '5c54e000-0000-4000-8000-0000000000e1'),
  ('5c540000-0000-4000-8000-0000000000a4', '5c54e000-0000-4000-8000-0000000000e2');

-- ---------------------------------------------------------------------------
-- A. Catálogo (054)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('054', 'A1. coluna versao bigint, NOT NULL, default 1', 'bigint|NO|1',
  (select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'timesheet_entries' and column_name = 'versao'));
select pg_temp.registrar('054', 'A2. o gatilho da versão é o ÚLTIMO BEFORE ROW de INSERT e de UPDATE (ordem real do catálogo)',
  'trg_timesheet_entries_zz_versao|trg_timesheet_entries_zz_versao',
  (select (select t.tgname from pg_trigger t where t.tgrelid = 'public.timesheet_entries'::regclass and not t.tgisinternal
             and t.tgtype & 2 = 2 and t.tgtype & 1 = 1 and t.tgtype & 4 = 4 order by t.tgname collate "C" desc limit 1)
     || '|' ||
          (select t.tgname from pg_trigger t where t.tgrelid = 'public.timesheet_entries'::regclass and not t.tgisinternal
             and t.tgtype & 2 = 2 and t.tgtype & 1 = 1 and t.tgtype & 16 = 16 order by t.tgname collate "C" desc limit 1)));
select pg_temp.registrar('054', 'A3. funções novas: segurança, dona e search_path',
  'confirmar_virada_do_apontamento:DEFINER:postgres:true,listar_apontamentos_do_operador_v2:DEFINER:bslog_rpc_operacional:true,salvar_apontamento_admin_v2:INVOKER:postgres:true,salvar_apontamento_operacional_v2:DEFINER:bslog_rpc_operacional:true,situacao_da_virada:DEFINER:postgres:true',
  (select string_agg(p.proname || ':' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end || ':' || pg_get_userbyid(p.proowner)
            || ':' || exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')::text, ',' order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('salvar_apontamento_admin_v2', 'salvar_apontamento_operacional_v2', 'listar_apontamentos_do_operador_v2',
                        'confirmar_virada_do_apontamento', 'situacao_da_virada')));
select pg_temp.registrar('054', 'A4. EXECUTE: só authenticated nas 5 públicas; nenhuma para anon/PUBLIC/service_role; funções de gatilho para ninguém',
  '5|0|0',
  (select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('salvar_apontamento_admin_v2', 'salvar_apontamento_operacional_v2', 'listar_apontamentos_do_operador_v2',
                               'confirmar_virada_do_apontamento', 'situacao_da_virada')
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not has_function_privilege('anon', p.oid, 'EXECUTE')
             and not has_function_privilege('service_role', p.oid, 'EXECUTE')
             and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                              where a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
     || '|' || (select count(*) from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('versionar_apontamento', 'invalidar_confirmacao_de_virada', 'proteger_confirmacao_de_virada', 'classificar_virada_do_apontamento')
                   and has_function_privilege(r, p.oid, 'EXECUTE'))::text
     || '|' || (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('versionar_apontamento', 'invalidar_confirmacao_de_virada', 'proteger_confirmacao_de_virada', 'classificar_virada_do_apontamento')
                   and a.grantee = 0 and a.privilege_type = 'EXECUTE')::text));
select pg_temp.registrar('054', 'A5. operador: um único grant novo, SELECT(versao); 56 grants por coluna; nenhum de tabela; nada financeiro',
  'true|56|0|0',
  (select (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_entries' and column_name = 'versao')
          and has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'versao', 'SELECT'))::text
     || '|' || (select count(*) from information_schema.column_privileges where grantee = 'bslog_rpc_operacional')::text
     || '|' || (select count(*) from information_schema.role_table_grants where grantee = 'bslog_rpc_operacional')::text
     || '|' || (select count(*) from information_schema.column_privileges where grantee = 'bslog_rpc_operacional'
                 and (column_name in ('billed_amount', 'cost_amount', 'invoice_id', 'daily_rate_snapshot', 'daily_cost_snapshot',
                                      'ot_hour_rate_snapshot', 'daily_cost', 'agreed_amount', 'daily_rate')
                      or (table_name = 'timesheet_entries' and column_name = 'versao' and privilege_type <> 'SELECT')))::text));
select pg_temp.registrar('054', 'A6. trilha de confirmações: RLS ligada, só SELECT para authenticated, nenhuma escrita para anon/authenticated/service_role/operador',
  'true|true|0',
  (select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.apontamento_confirmacoes_virada'))::text, 'ausente')
     || '|' || coalesce(has_table_privilege('authenticated', to_regclass('public.apontamento_confirmacoes_virada'), 'SELECT')::text, 'ausente')
     || '|' || (select count(*) from unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r,
                  unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pr
                 where to_regclass('public.apontamento_confirmacoes_virada') is not null
                   and has_table_privilege(r, 'public.apontamento_confirmacoes_virada', pr))::text));
select pg_temp.registrar('054', 'A7. contratos e corpos antigos intactos (assinatura, dona e md5 de v1, gerar_fatura, motor e travas)',
  'derivar_valores_financeiros()|6db0c22a4cbeb69db1fcbc83a020043a|postgres,derivar_valores_por_vigencia()|ca82edcbbf819e026bc47a231934c9f4|postgres,gerar_fatura(_client_id uuid, _period_start date, _period_end date)|b7ddafbd6b0276f99ebf8eac8147a50a|postgres,listar_apontamentos_do_operador(p_operation_id uuid, p_shift_id uuid, p_work_date date)|5d3fb6306bb41fca3ce53111e2e7d19f|bslog_rpc_operacional,recusar_intervalo_maior_que_jornada()|9cb09244be7b37e6e108eb7e4baaa6e1|postgres,salvar_apontamento_admin(p_operation_id uuid, p_shift_id uuid, p_work_date date, p_linhas jsonb)|691bda93479e57074ea0fa99a6d3e028|postgres,salvar_apontamento_operacional(p_operation_id uuid, p_shift_id uuid, p_work_date date, p_linhas jsonb)|e296968f04a8e02cf08028a57b74ee23|bslog_rpc_operacional',
  (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || md5(p.prosrc) || '|' || pg_get_userbyid(p.proowner), ',' order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('salvar_apontamento_admin', 'salvar_apontamento_operacional', 'listar_apontamentos_do_operador', 'gerar_fatura',
                        'derivar_valores_por_vigencia', 'derivar_valores_financeiros', 'recusar_intervalo_maior_que_jornada')));

-- ---------------------------------------------------------------------------
-- B. Versão monotônica, mantida só pelo banco (054)
-- ---------------------------------------------------------------------------

select pg_temp.guardar('B1', pg_temp.adm($q$with i as (insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('5c54b000-0000-4000-8000-000000000001', '5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-12')
  returning 1) select count(*)::text from i$q$));
select pg_temp.guardar('B1b', pg_temp.adm($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c54b100-0000-4000-8000-000000000001', '5c54b000-0000-4000-8000-000000000001', '5c54f000-0000-4000-8000-000000000005', 'present', '08:00', '17:00', 60)
  returning to_jsonb(timesheet_entries) ->> 'versao') select * from i$q$));
select pg_temp.registrar('054', 'B1. INSERT nasce na versão 1', '1', pg_temp.v('B1b'));
select pg_temp.registrar('054', 'B2. INSERT com versão no payload é ignorado: o banco força 1',
  '1', pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes, versao)
    values ('5c54b000-0000-4000-8000-000000000001', '5c54f000-0000-4000-8000-000000000006', 'present', '08:00', '17:00', 60, 999)
    returning versao) select versao::text from i$q$));
select pg_temp.registrar('054', 'B3. UPDATE com mudança efetiva: versão +1', '2',
  pg_temp.adm($q$with u as (update public.timesheet_entries set check_out = '16:00' where id = '5c54b100-0000-4000-8000-000000000001'
    returning versao) select versao::text from u$q$));
select pg_temp.registrar('054', 'B4. UPDATE sem mudança efetiva (mesmos valores): a versão NÃO muda', '2',
  pg_temp.adm($q$with u as (update public.timesheet_entries set check_out = '16:00', break_minutes = 60 where id = '5c54b100-0000-4000-8000-000000000001'
    returning versao) select versao::text from u$q$));
select pg_temp.registrar('054', 'B5. o cliente não escolhe a versão: UPDATE só de versao = 50 não muda nada', '2',
  pg_temp.adm($q$with u as (update public.timesheet_entries set versao = 50 where id = '5c54b100-0000-4000-8000-000000000001'
    returning versao) select versao::text from u$q$));
select pg_temp.registrar('054', 'B6. mudar só a observação também é mudança efetiva: versão +1', '3',
  pg_temp.adm($q$with u as (update public.timesheet_entries set notes = 'obs' where id = '5c54b100-0000-4000-8000-000000000001'
    returning versao) select versao::text from u$q$));

-- ---------------------------------------------------------------------------
-- C. RPC do admin v2: versão esperada obrigatória (054)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('054', 'C1. linha nova com versao_esperada 0: inserida na versão 1', 'inserido|1',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '17:00', 60, 0))));
select pg_temp.registrar('054', 'C2. alteração com a versão certa (1): atualizada, versão 2', 'atualizado|2',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '18:00', 60, 1))));
select pg_temp.guardar('C3', pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '16:00', 60, 1))));
select pg_temp.registrar('054', 'C3. versão obsoleta (1) com payload DIFERENTE: conflito 40001 e a linha fica', 'erro 40001|08:00:00-18:00:00/60/v2',
  pg_temp.v('C3') || '|' || pg_temp.gravado('1', '2026-03-02'));
select pg_temp.registrar('054', 'C4. retentativa idêntica com a versão obsoleta (resposta perdida): sem alteração, versão NÃO sobe', 'sem_alteracao|2',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '18:00', 60, 1))));
select pg_temp.registrar('054', 'C5. repetição idêntica com a versão certa: sem alteração, versão NÃO sobe', 'sem_alteracao|2',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '18:00', 60, 2))));
select pg_temp.registrar('054', 'C6. sem versao_esperada na linha: recusado (22023)', 'erro 22023',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '18:00', 60, null))));
select pg_temp.registrar('054', 'C7. chave desconhecida no v2: recusado (22023)', 'erro 22023',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '18:00', 60, 2, '{"billed_amount": 1}'))));
select pg_temp.guardar('C8', pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '17:00', 60, 5))));
select pg_temp.registrar('054', 'C8. versão esperada > 0 para linha que não existe: conflito 40001 e nada é criado', 'erro 40001|ausente',
  pg_temp.v('C8') || '|' || pg_temp.gravado('2', '2026-03-02'));
select pg_temp.registrar('054', 'C9. versão 0 (nova) mas a linha já existe com outro conteúdo: conflito 40001', 'erro 40001',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '09:00', '17:00', 60, 0))));
select pg_temp.registrar('054', 'C10. sem papel e operacional não usam a RPC do admin (42501)', 'erro 42501|erro 42501',
  pg_temp.sem(pg_temp.sql_v2('salvar_apontamento_admin_v2', 'e1', '1', '2026-03-02', jsonb_build_array(pg_temp.linha('3', 'present', '08:00', '17:00', 60, 0))))
  || '|' || pg_temp.ope(pg_temp.sql_v2('salvar_apontamento_admin_v2', 'e1', '1', '2026-03-02', jsonb_build_array(pg_temp.linha('3', 'present', '08:00', '17:00', 60, 0)))));
-- Mesmo dado pelo v1 (f5) e pelo v2 (f6): valores derivados idênticos.
select pg_temp.adm($q$select public.salvar_apontamento_admin('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-02',
  '[{"employee_id":"5c54f000-0000-4000-8000-000000000005","status":"present","check_in":"08:00","check_out":"18:30","break_minutes":60,"notes":null}]'::jsonb)::text$q$);
select pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('6', 'present', '08:00', '18:30', 60, 0)));
select pg_temp.registrar('054', 'C11. mesmos horários pelo v1 e pelo v2: jornada, HE, receita e custo idênticos ao centavo', 'true|570|90|256.25|142.50',
  (select (a.worked_minutes = b.worked_minutes and a.overtime_minutes = b.overtime_minutes and a.billed_amount = b.billed_amount and a.cost_amount = b.cost_amount)::text
          || '|' || b.worked_minutes || '|' || b.overtime_minutes || '|' || b.billed_amount || '|' || b.cost_amount
     from public.timesheet_entries a, public.timesheet_entries b
    where a.id = pg_temp.id_de('5', '2026-03-02') and b.id = pg_temp.id_de('6', '2026-03-02')));
select pg_temp.registrar('054', 'C12. duas linhas numa chamada: ambas gravadas, cada uma com a sua versão',
  'inserido|inserido', pg_temp.adm(format($f$select string_agg(l ->> 'resultado', '|' order by l ->> 'employee_id')
    from jsonb_array_elements((select public.salvar_apontamento_admin_v2('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-02', %L::jsonb)) -> 'linhas') l$f$,
    jsonb_build_array(pg_temp.linha('4', 'present', '08:00', '17:00', 60, 0), pg_temp.linha('3', 'absent', null, null, 0, 0))::text)));

-- ---------------------------------------------------------------------------
-- D. RPCs do operador v2 (054)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('054', 'D1. operador: linha nova (0) inserida na versão 1', 'inserido|1',
  pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '17:00', 60, 0))));
select pg_temp.registrar('054', 'D2. operador: versão certa atualiza (2)', 'atualizado|2',
  pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '16:00', 60, 1))));
select pg_temp.guardar('D3', pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '15:00', 60, 1))));
select pg_temp.registrar('054', 'D3. operador: versão obsoleta com payload diferente: 40001 e a linha fica', 'erro 40001|08:00:00-16:00:00/60/v2',
  pg_temp.v('D3') || '|' || pg_temp.gravado('1', '2026-03-03'));
select pg_temp.registrar('054', 'D4. operador: retentativa idêntica com versão obsoleta: sem alteração, versão não sobe', 'sem_alteracao|2',
  pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '16:00', 60, 1))));
select pg_temp.registrar('054', 'D5. operador: sem versao_esperada, com confirmar_virada ou com chave financeira: 22023',
  'erro 22023|erro 22023|erro 22023',
  pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '17:00', 60, null)))
  || '|' || pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '07:50', 0, 0, '{"confirmar_virada": true}')))
  || '|' || pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '17:00', 60, 0, '{"billed_amount": 1}'))));
select pg_temp.registrar('054', 'D6. admin não usa a RPC do operador; operador de outra operação também não (42501)', 'erro 42501|erro 42501',
  pg_temp.adm(pg_temp.sql_v2('salvar_apontamento_operacional_v2', 'e1', '1', '2026-03-03', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '17:00', 60, 0))))
  || '|' || pg_temp.ope2(pg_temp.sql_v2('salvar_apontamento_operacional_v2', 'e1', '1', '2026-03-03', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '17:00', 60, 0)))));
select pg_temp.registrar('054', 'D7. operador: colaborador fora da equipe ativa do turno (23514)', 'erro 23514',
  pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('8', 'present', '08:00', '17:00', 60, 0))));
select pg_temp.registrar('054', 'D8. listagem v2 do operador: colunas do v1 + versao, nada financeiro',
  'TABLE(timesheet_id uuid, shift_id uuid, work_date date, folha_status timesheet_status, employee_id uuid, status attendance_status, check_in time without time zone, check_out time without time zone, break_minutes integer, notes text, faturado boolean, versao bigint)',
  coalesce(pg_get_function_result(to_regprocedure('public.listar_apontamentos_do_operador_v2(uuid,uuid,date)')), 'ausente'));
select pg_temp.registrar('054', 'D9. a listagem v2 devolve a versão gravada', '2',
  pg_temp.ope($q$select versao::text from public.listar_apontamentos_do_operador_v2('5c54e000-0000-4000-8000-0000000000e1',
    '5c54a000-0000-4000-8000-000000000001', '2026-03-03') where employee_id = '5c54f000-0000-4000-8000-000000000001'$q$));

-- ---------------------------------------------------------------------------
-- E. Virada: confirmação auditada e invalidável (054). Ausência de confirmação NÃO bloqueia (058).
-- ---------------------------------------------------------------------------

select pg_temp.registrar('058', 'E1. [ainda aceito; a 058 vai exigir] virada no turno diurno sem confirmação é gravada pelo v2', 'inserido|1',
  pg_temp.admv2('1', '2026-03-04', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '07:50', 0, 0))));
select pg_temp.admv2('2', '2026-03-05', jsonb_build_array(pg_temp.linha('7', 'present', '22:00', '07:00', 60, 0)));
select pg_temp.admv2('1', '2026-03-04', jsonb_build_array(pg_temp.linha('2', 'present', '08:00', '17:00', 60, 0)));
select pg_temp.registrar('054', 'E2. situação: virada no diurno sem confirmação = pendente; noturno = turno_vira_o_dia; normal = sem_virada',
  'pendente|turno_vira_o_dia|sem_virada',
  pg_temp.situacao('1', '2026-03-04') || '|' || pg_temp.situacao('7', '2026-03-05') || '|' || pg_temp.situacao('2', '2026-03-04'));
select pg_temp.registrar('054', 'E3. operador e sem papel não confirmam virada (42501)', 'erro 42501|erro 42501',
  pg_temp.ope(format('select public.confirmar_virada_do_apontamento(%L::uuid, 1)::text', pg_temp.id_de('1', '2026-03-04')))
  || '|' || pg_temp.sem(format('select public.confirmar_virada_do_apontamento(%L::uuid, 1)::text', pg_temp.id_de('1', '2026-03-04'))));
select pg_temp.registrar('054', 'E4. confirmação com versão obsoleta: 40001', 'erro 40001',
  pg_temp.adm(format('select public.confirmar_virada_do_apontamento(%L::uuid, 7)::text', pg_temp.id_de('1', '2026-03-04'))));
select pg_temp.registrar('054', 'E5. sem virada ou turno noturno: não há o que confirmar (22023)', 'erro 22023|erro 22023',
  pg_temp.adm(format('select public.confirmar_virada_do_apontamento(%L::uuid, 1)::text', pg_temp.id_de('2', '2026-03-04')))
  || '|' || pg_temp.adm(format('select public.confirmar_virada_do_apontamento(%L::uuid, 1)::text', pg_temp.id_de('7', '2026-03-05'))));
select pg_temp.guardar('E6', pg_temp.adm(format($f$select r ->> 'confirmacao_id' from (select public.confirmar_virada_do_apontamento(%L::uuid, 1) r) x$f$, pg_temp.id_de('1', '2026-03-04'))));
select pg_temp.registrar('054', 'E6. admin confirma com a versão certa: confirmada; trilha com quem, horários, turno e versão',
  'confirmada|true|08:00:00|07:50:00|true|false|1',
  pg_temp.situacao('1', '2026-03-04') || '|'
  || pg_temp.dono(format($f$select (c.confirmado_por = '5c540000-0000-4000-8000-0000000000a1')::text || '|' || c.check_in || '|' || c.check_out
       || '|' || (c.shift_id = '5c54a000-0000-4000-8000-000000000001')::text || '|' || c.turno_vira_o_dia || '|' || c.versao_confirmada
     from public.apontamento_confirmacoes_virada c where c.id::text = %L$f$, pg_temp.v('E6'))));
select pg_temp.registrar('054', 'E7. confirmar de novo o mesmo estado devolve a MESMA confirmação (idempotente, sem nova linha)', 'true|1',
  (pg_temp.adm(format($f$select r ->> 'confirmacao_id' from (select public.confirmar_virada_do_apontamento(%L::uuid, 1) r) x$f$, pg_temp.id_de('1', '2026-03-04'))) = pg_temp.v('E6'))::text
  || '|' || pg_temp.dono(format('select count(*)::text from public.apontamento_confirmacoes_virada where entry_id = %L::uuid', pg_temp.id_de('1', '2026-03-04'))));
select pg_temp.adm(format($f$update public.timesheet_entries set notes = 'só observação' where id = %L::uuid returning 'x'$f$, pg_temp.id_de('1', '2026-03-04')));
select pg_temp.registrar('054', 'E8. mudar só a observação não invalida a confirmação', 'confirmada', pg_temp.situacao('1', '2026-03-04'));
select pg_temp.guardar('E9', pg_temp.opev2('1', '2026-03-04', jsonb_build_array(
  jsonb_build_object('employee_id', '5c54f000-0000-4000-8000-000000000001', 'status', 'present', 'check_in', '08:00', 'check_out', '07:40',
                     'break_minutes', 0, 'notes', 'só observação', 'versao_esperada', pg_temp.versao_de('1', '2026-03-04')))));
select pg_temp.registrar('054', 'E9. o operador mexe no horário: a confirmação é invalidada na trilha (motivo e versão) e a situação volta a pendente',
  'atualizado|pendente|horarios_alterados|true',
  split_part(pg_temp.v('E9'), '|', 1) || '|' || pg_temp.situacao('1', '2026-03-04') || '|'
  || pg_temp.dono(format($f$select c.motivo_invalidacao || '|' || (c.invalidada_em is not null and c.invalidada_na_versao = %s)::text
     from public.apontamento_confirmacoes_virada c where c.id::text = %L$f$, coalesce(pg_temp.versao_de('1', '2026-03-04'), -1), pg_temp.v('E6'))));
select pg_temp.adm(format($f$update public.timesheet_entries set check_out = '07:50' where id = %L::uuid returning 'x'$f$, pg_temp.id_de('1', '2026-03-04')));
select pg_temp.registrar('054', 'E10. voltar ao horário confirmado NÃO revalida a confirmação invalidada (exige nova)', 'pendente', pg_temp.situacao('1', '2026-03-04'));
select pg_temp.registrar('054', 'E11. admin v2 com confirmar_virada: grava e confirma na mesma chamada', 'inserido|1|confirmada',
  pg_temp.admv2('1', '2026-03-04', jsonb_build_array(pg_temp.linha('3', 'present', '08:00', '07:00', 0, 0, '{"confirmar_virada": true}')))
  || '|' || pg_temp.situacao('3', '2026-03-04'));
select pg_temp.guardar('E12', pg_temp.admv2('1', '2026-03-04', jsonb_build_array(pg_temp.linha('4', 'present', '08:00', '17:00', 60, 0, '{"confirmar_virada": true}'))));
select pg_temp.registrar('054', 'E12. confirmar_virada numa linha sem virada recusa a chamada inteira (22023) e nada é gravado', 'erro 22023|ausente',
  pg_temp.v('E12') || '|' || pg_temp.gravado('4', '2026-03-04'));
select pg_temp.guardar('E13a', pg_temp.admv2(null, '2026-03-06', jsonb_build_array(pg_temp.linha('1', 'present', '22:00', '06:00', 60, 0))));
select pg_temp.guardar('E13b', pg_temp.situacao('1', '2026-03-06'));
select pg_temp.guardar('E13c', pg_temp.adm(format($f$select (public.confirmar_virada_do_apontamento(%L::uuid, 1)) ->> 'situacao'$f$, pg_temp.id_de('1', '2026-03-06'))));
select pg_temp.registrar('054', 'E13. avulsa sem turno: a virada é pendente até o admin confirmar', 'inserido|1|pendente|confirmada|confirmada',
  pg_temp.v('E13a') || '|' || pg_temp.v('E13b') || '|' || pg_temp.v('E13c') || '|' || pg_temp.situacao('1', '2026-03-06'));
select pg_temp.registrar('054', 'E14. a trilha não é gravável por ninguém de fora (42501); nem a dona altera o confirmado ou apaga',
  'erro 42501|erro 42501|erro 42501|erro 55000|erro 55000',
  pg_temp.adm(format($f$insert into public.apontamento_confirmacoes_virada (entry_id, check_in, check_out, versao_confirmada, confirmado_por)
     values (%L::uuid, '08:00', '07:00', 1, '5c540000-0000-4000-8000-0000000000a1') returning 'x'$f$, pg_temp.id_de('2', '2026-03-04')))
  || '|' || pg_temp.adm($q$update public.apontamento_confirmacoes_virada set check_out = '06:00' returning 'x'$q$)
  || '|' || pg_temp.adm($q$delete from public.apontamento_confirmacoes_virada returning 'x'$q$)
  || '|' || pg_temp.dono($q$update public.apontamento_confirmacoes_virada set check_out = '06:00' returning 'x'$q$)
  || '|' || pg_temp.dono($q$delete from public.apontamento_confirmacoes_virada returning 'x'$q$));
select pg_temp.registrar('054', 'E15. a trilha é legível pelo admin e invisível para operador e sem papel', 'true|0|0',
  (pg_temp.adm($q$select (count(*) > 0)::text from public.apontamento_confirmacoes_virada$q$))
  || '|' || pg_temp.ope($q$select count(*)::text from public.apontamento_confirmacoes_virada$q$)
  || '|' || pg_temp.sem($q$select count(*)::text from public.apontamento_confirmacoes_virada$q$));

-- ---------------------------------------------------------------------------
-- F. Legado intacto durante a expansão (054) — e o que só a 058 vai recusar
-- ---------------------------------------------------------------------------

select pg_temp.adm($q$select public.salvar_apontamento_admin('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-09',
  '[{"employee_id":"5c54f000-0000-4000-8000-000000000001","status":"present","check_in":"08:00:00","check_out":"17:00:00","break_minutes":60,"notes":null}]'::jsonb)::text$q$);
select pg_temp.adm($q$select public.salvar_apontamento_admin('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-09',
  '[{"employee_id":"5c54f000-0000-4000-8000-000000000001","status":"present","check_in":"08:00:00","check_out":"17:30:00","break_minutes":60,"notes":null}]'::jsonb)::text$q$);
select pg_temp.registrar('054', 'F1. RPC antiga do admin (payload do site ecd67f2): grava; a versão sobe sozinha (1 → 2)', '08:00:00-17:30:00/60/v2',
  pg_temp.gravado('1', '2026-03-09'));
select pg_temp.ope($q$select public.salvar_apontamento_operacional('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-09',
  '[{"employee_id":"5c54f000-0000-4000-8000-000000000002","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60}]'::jsonb)::text$q$);
select pg_temp.ope($q$select public.salvar_apontamento_operacional('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-09',
  '[{"employee_id":"5c54f000-0000-4000-8000-000000000002","status":"present","check_in":"08:00","check_out":"16:00","break_minutes":60}]'::jsonb)::text$q$);
select pg_temp.registrar('054', 'F2. RPC antiga do operador (ON CONFLICT): grava; a versão sobe sozinha', '08:00:00-16:00:00/60/v2',
  pg_temp.gravado('2', '2026-03-09'));
select pg_temp.adm(format($f$insert into public.timesheet_entries (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes)
  select %L::uuid, t.id, '5c54f000-0000-4000-8000-000000000003', t.operation_id, t.work_date, 'present', '08:00', '17:00', 60, null
    from public.timesheets t where t.operation_id = '5c54e000-0000-4000-8000-0000000000e1' and t.work_date = '2026-03-09'
  on conflict (id) do update set check_out = excluded.check_out returning 'x'$f$, '5c54b100-0000-4000-8000-000000000003'));
select pg_temp.adm($q$insert into public.timesheet_entries (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes)
  select '5c54b100-0000-4000-8000-000000000003', t.id, '5c54f000-0000-4000-8000-000000000003', t.operation_id, t.work_date, 'present', '08:00', '15:00', 60, null
    from public.timesheets t where t.operation_id = '5c54e000-0000-4000-8000-0000000000e1' and t.work_date = '2026-03-09'
  on conflict (id) do update set check_out = excluded.check_out returning 'x'$q$);
select pg_temp.registrar('054', 'F3. upsert antigo da tela (ON CONFLICT (id) DO UPDATE): grava; versão 1 → 2', '08:00:00-15:00:00/60/v2',
  pg_temp.gravado('3', '2026-03-09'));
select pg_temp.registrar('058', 'F4. [I7 legado, a 058 vai recusar] escrita direta sem versão ainda sobrescreve em silêncio', '1',
  pg_temp.adm($q$with u as (update public.timesheet_entries set check_out = '14:00'
    where id = '5c54b100-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$));
select pg_temp.adm($q$select public.salvar_apontamento_admin('5c54e000-0000-4000-8000-0000000000e1', '5c54a000-0000-4000-8000-000000000001', '2026-03-09',
  '[{"employee_id":"5c54f000-0000-4000-8000-000000000004","status":"present","check_in":"08:00","check_out":"07:50","break_minutes":0}]'::jsonb)::text$q$);
select pg_temp.registrar('058', 'F5. [I1 legado, a 058 vai exigir confirmação] RPC antiga grava virada no diurno sem confirmação', 'pendente',
  pg_temp.situacao('4', '2026-03-09'));
select pg_temp.adm(format('select public.confirmar_virada_do_apontamento(%L::uuid, %s)::text', pg_temp.id_de('4', '2026-03-09'), pg_temp.versao_de('4', '2026-03-09')));
select pg_temp.guardar('F6', pg_temp.adm(format($f$with d as (delete from public.timesheet_entries where id = %L::uuid returning 1) select count(*)::text from d$f$, pg_temp.id_de('4', '2026-03-09'))));
select pg_temp.registrar('054', 'F6. DELETE direto do admin segue no contrato (revogação na 058); a trilha fica e é invalidada', '1|1|apontamento_excluido',
  pg_temp.v('F6') || '|'
  || pg_temp.dono($q$select count(*) || '|' || max(motivo_invalidacao) from public.apontamento_confirmacoes_virada
       where employee_id = '5c54f000-0000-4000-8000-000000000004' and work_date = '2026-03-09'$q$));

-- ---------------------------------------------------------------------------
-- G. Fechamento e fatura com a 054 (054): nada financeiro muda
-- ---------------------------------------------------------------------------

select pg_temp.admv2('1', '2026-03-11', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '17:00', 60, 0)));
select pg_temp.adm($q$with u as (update public.timesheets set status = 'closed' where operation_id = '5c54e000-0000-4000-8000-0000000000e1'
  and work_date = '2026-03-11' returning 1) select count(*)::text from u$q$);
select pg_temp.registrar('054', 'G1. folha fechada: o v2 recusa gravar (55000)', 'erro 55000',
  pg_temp.admv2('1', '2026-03-11', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '16:00', 60, 1))));
create temporary table _antes_fatura on commit drop as
  select te.id, te.billed_amount, te.cost_amount, (to_jsonb(te) ->> 'versao')::bigint as versao
    from public.timesheet_entries te join public.operations o on o.id = te.operation_id
   where o.client_id = '5c54c000-0000-4000-8000-0000000000c1' and te.work_date between '2026-03-01' and '2026-03-15' and te.status <> 'absent';
select pg_temp.guardar('G2', pg_temp.adm($q$select (public.gerar_fatura('5c54c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$));
select pg_temp.registrar('054', 'G2. a fatura sai, inclusive sobre a folha FECHADA: total = Σ valores de antes, ao centavo; todos vinculados', 'true|true|true',
  (pg_temp.v('G2') ~ '^[0-9a-f-]{36}$')::text || '|'
  || ((select total_amount from public.invoices where id::text = pg_temp.v('G2')) = (select sum(billed_amount) from _antes_fatura))::text || '|'
  || (not exists (select 1 from _antes_fatura a join public.timesheet_entries te on te.id = a.id where te.invoice_id is null))::text);
select pg_temp.registrar('054', 'G3. o vínculo da fatura sobe a versão (+1) sem mudar valor nenhum', 'true|true',
  (select bool_and((to_jsonb(te) ->> 'versao')::bigint = a.versao + 1) from _antes_fatura a join public.timesheet_entries te on te.id = a.id)::text || '|'
  || (select bool_and(te.billed_amount = a.billed_amount and te.cost_amount = a.cost_amount) from _antes_fatura a join public.timesheet_entries te on te.id = a.id)::text);
select pg_temp.registrar('054', 'G4. faturado é imutável também pelos v2 (admin e operador: 42501)', 'erro 42501|erro 42501',
  pg_temp.admv2('1', '2026-03-02', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '17:00', 60, pg_temp.versao_de('1', '2026-03-02'))))
  || '|' || pg_temp.opev2('1', '2026-03-03', jsonb_build_array(pg_temp.linha('1', 'present', '08:00', '17:00', 60, pg_temp.versao_de('1', '2026-03-03')))));
select pg_temp.registrar('054', 'G5. diária de 8 h ao centavo pelo v2 (R$ 200 / R$ 120) e virada confirmada cobrada como antes',
  '200.00|120.00|1380',
  (select billed_amount || '|' || cost_amount from public.timesheet_entries where id = pg_temp.id_de('1', '2026-03-11')) || '|'
  || (select worked_minutes::text from public.timesheet_entries where id = pg_temp.id_de('3', '2026-03-04')));

-- ---------------------------------------------------------------------------
-- H. Mudança na definição do turno também invalida a confirmação (054)
-- ---------------------------------------------------------------------------

select pg_temp.dono($q$update public.shifts set end_time = '18:00' where id = '5c54a000-0000-4000-8000-000000000001' returning 'x'$q$);
select pg_temp.registrar('054', 'H1. o turno confirmado mudou de horário: a confirmação deixa de valer (pendente)', 'pendente',
  pg_temp.situacao('3', '2026-03-04'));

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select gate, situacao, caso, esperado, obtido from _resultado order by ordem;

do $$
declare _falhas int; _n054 int; _n058 int;
begin
  select count(*) filter (where situacao = 'FAIL'), count(*) filter (where gate = '054'), count(*) filter (where gate = '058')
    into _falhas, _n054, _n058 from _resultado;
  if _falhas > 0 then
    raise exception 'GATE-FIN-05 (054): % caso(s) divergente(s) — ver o relatório acima', _falhas;
  end if;
  raise notice 'GATE-FIN-05 (054): % casos da 054 e % registros do legado (exigência da 058) conferidos; tudo será desfeito.', _n054, _n058;
end $$;

rollback;
