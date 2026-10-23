-- Migration 028 — o contrato da operação não muda depois que há histórico financeiro (C05-B5.6).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 028 estarem aplicadas, SÓ em banco descartável/homologação. Tudo acontece numa transação que
-- termina em `rollback` (inclusive os registros em auth.users e auth.sessions e a troca do motor).
-- NUNCA rodar contra Production.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  motor DESLIGADO, sem histórico: trocar, preencher e remover o contrato segue livre
--   B  motor DESLIGADO, com histórico (apontamento ou valor acordado): trocar, preencher e remover
--      são recusados (55000); o texto manda criar uma nova operação
--   C  UPDATE que não muda contract_id (mesmo valor, nome, status) segue livre
--   D  contrato de outro cliente segue recusado pela 021 (23503), com e sem histórico
--   E  nada do histórico muda: apontamentos, snapshots, vigências e a trilha
--   F  papéis: admin AAL1, operacional e anônimo não mudam nada; postgres é isento
--   G  motor LIGADO: as mesmas regras
--   H  apagar contrato com apontamento segue recusado; o trigger existe e está habilitado nos dois
--      estados; permissões da função nova

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

create or replace function pg_temp.adm(_chamada text) returns text language sql as $$
  select pg_temp.como('5c800000-0000-4000-8000-0000000000a1', 'aal2', format('select count(*)::text from (select %s) x', _chamada))
$$;

-- UPDATE de contract_id como admin AAL2: devolve o número de linhas afetadas ou 'erro <SQLSTATE>'.
create or replace function pg_temp.trocar(_op text, _contrato text) returns text language sql as $$
  select pg_temp.como('5c800000-0000-4000-8000-0000000000a1', 'aal2',
    format('with u as (update public.operations set contract_id = %s where id = %L returning 1) select count(*)::text from u',
           case when _contrato = 'null' then 'null' else quote_literal(_contrato) end, _op))
$$;

-- DELETE de contrato como admin AAL2: linhas apagadas ou 'erro <SQLSTATE>'.
create or replace function pg_temp.apagar_contrato(_contrato text) returns text language sql as $$
  select pg_temp.como('5c800000-0000-4000-8000-0000000000a1', 'aal2',
    format('with d as (delete from public.contracts where id = %L returning 1) select count(*)::text from d', _contrato))
$$;

create or replace function pg_temp.estado_contratos() returns text language sql as $$
  select (select string_agg(coalesce(c.name, '-'), ',' order by o.name)
            from public.operations o left join public.contracts c on c.id = o.contract_id
           where o.name like 'O5%' or o.name like 'O6%' or o.name like 'O7%')
      || '|' || (select count(*)::text from public.contract_terms where contract_id in
                  ('5c80d000-0000-4000-8000-0000000000d4', '5c80d000-0000-4000-8000-0000000000d5', '5c80d000-0000-4000-8000-0000000000d7'))
      || '|' || (select count(*)::text from public.operation_terms where operation_id = '5c80e000-0000-4000-8000-0000000000a5')
$$;

create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.motor(_ativar boolean, _extra text default '') returns text language sql as $$
  select pg_temp.adm(format('public.alterar_motor_vigencia(%L, %L%s)', _ativar, case when _ativar then 'Ligado no teste' else 'Desligado no teste' end, _extra))
$$;

create or replace function pg_temp.mensagem_de(_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '5c800000-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'aal', 'aal2', 'session_id', 'ec800000-0000-4000-8000-0000000000a1')::text, true);
  set local role authenticated;
  begin
    execute _sql;
  exception when others then
    set local role postgres;
    return sqlerrm;
  end;
  set local role postgres;
  return 'sem erro';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture (motor desligado)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c800000-0000-4000-8000-0000000000a1'),
  ('5c800000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec800000-0000-4000-8000-0000000000a1', '5c800000-0000-4000-8000-0000000000a1', null),
  ('ec800000-0000-4000-8000-0000000000a2', '5c800000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c800000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c800000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values
  ('5c80c000-0000-4000-8000-0000000000c1', 'C05B56 cliente 1'),
  ('5c80c000-0000-4000-8000-0000000000c2', 'C05B56 cliente 2');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c80d000-0000-4000-8000-0000000000d1', '5c80c000-0000-4000-8000-0000000000c1', 'KA', 100, 8, 1.5, 10),
  ('5c80d000-0000-4000-8000-0000000000d2', '5c80c000-0000-4000-8000-0000000000c1', 'KB', 130, 8, 1.5, 10),
  ('5c80d000-0000-4000-8000-0000000000d3', '5c80c000-0000-4000-8000-0000000000c2', 'KX outro cliente', 150, 8, 1.5, 10);
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c80d000-0000-4000-8000-0000000000d4', '5c80c000-0000-4000-8000-0000000000c1', 'KD contrato com vigencia de valor acordado', 110, 8, 1.5, 10),
  ('5c80d000-0000-4000-8000-0000000000d5', '5c80c000-0000-4000-8000-0000000000c1', 'KE contrato sem historico', 120, 8, 1.5, 10),
  ('5c80d000-0000-4000-8000-0000000000d6', '5c80c000-0000-4000-8000-0000000000c1', 'KF contrato sem operacao', 125, 8, 1.5, 10),
  ('5c80d000-0000-4000-8000-0000000000d7', '5c80c000-0000-4000-8000-0000000000c1', 'KG contrato sem historico (motor ligado)', 126, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c80f000-0000-4000-8000-000000000001', 'EA', 60);
-- O1 com contrato, sem histórico; O2 sem contrato com valor acordado cadastrado; O3 com contrato e
-- apontamento; O4 sem contrato e sem histórico.
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c80e000-0000-4000-8000-0000000000a1', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d1', 'O1 sem historico', null),
  ('5c80e000-0000-4000-8000-0000000000a2', '5c80c000-0000-4000-8000-0000000000c1', null, 'O2 valor acordado', 200),
  ('5c80e000-0000-4000-8000-0000000000a3', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d1', 'O3 apontamento', null),
  ('5c80e000-0000-4000-8000-0000000000a4', '5c80c000-0000-4000-8000-0000000000c1', null, 'O4 sem historico', 300),
  ('5c80e000-0000-4000-8000-0000000000a5', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d4', 'O5 contrato KD e valor acordado', null),
  ('5c80e000-0000-4000-8000-0000000000a6', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d5', 'O6 contrato KE sem historico', null),
  ('5c80e000-0000-4000-8000-0000000000a7', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d7', 'O7 contrato KG sem historico', null);

select pg_temp.adm($q$public.registrar_condicao_contrato('5c80d000-0000-4000-8000-0000000000d1', date '2020-01-01', 100, 8, 1.5, 10, 'KA')$q$);
select pg_temp.adm($q$public.registrar_condicao_contrato('5c80d000-0000-4000-8000-0000000000d2', date '2020-01-01', 130, 8, 1.5, 10, 'KB')$q$);
select pg_temp.adm($q$public.registrar_condicao_contrato('5c80d000-0000-4000-8000-0000000000d4', date '2020-01-01', 110, 8, 1.5, 10, 'KD')$q$);
select pg_temp.adm($q$public.registrar_condicao_contrato('5c80d000-0000-4000-8000-0000000000d5', date '2020-01-01', 120, 8, 1.5, 10, 'KE')$q$);
select pg_temp.adm($q$public.registrar_condicao_contrato('5c80d000-0000-4000-8000-0000000000d7', date '2020-01-01', 126, 8, 1.5, 10, 'KG')$q$);
select pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c80e000-0000-4000-8000-0000000000a5', date '2020-01-01', 400, 'O5 valor acordado com contrato')$q$);
select pg_temp.adm($q$public.registrar_custo_colaborador('5c80f000-0000-4000-8000-000000000001', date '2020-01-01', 60, 'EA')$q$);
select pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c80e000-0000-4000-8000-0000000000a2', date '2020-01-01', 200, 'O2')$q$);

insert into public.timesheets (id, operation_id, shift_id, work_date)
  values ('5c80b000-0000-4000-8000-000000000003', '5c80e000-0000-4000-8000-0000000000a3', null, date '2026-01-10');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c80b100-0000-4000-8000-000000000003', '5c80b000-0000-4000-8000-000000000003',
          '5c80f000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);

create temporary table _historico on commit drop as
  select e.id, e.billed_amount, e.cost_amount, e.daily_rate_snapshot, e.daily_cost_snapshot, e.terms_origin::text as origem
    from public.timesheet_entries e;
create temporary table _estado_antes on commit drop as
  select (select count(*) from public.operation_terms) as n_op_terms,
         (select count(*) from public.contract_terms where contract_id not in ('5c80d000-0000-4000-8000-0000000000d5', '5c80d000-0000-4000-8000-0000000000d7')) as n_ct_terms,
         (select count(*) from public.financial_terms_audit where action not like 'motor_vigencia%') as n_trilha;

create or replace function pg_temp.historico_igual() returns text language sql as $$
  select case when
    (select count(*) from public.timesheet_entries e join _historico h on h.id = e.id
      where e.billed_amount is not distinct from h.billed_amount and e.cost_amount is not distinct from h.cost_amount
        and e.daily_rate_snapshot is not distinct from h.daily_rate_snapshot
        and e.daily_cost_snapshot is not distinct from h.daily_cost_snapshot
        and e.terms_origin::text is not distinct from h.origem) = (select count(*) from _historico)
    and (select count(*) from public.operation_terms) = (select n_op_terms from _estado_antes)
    and (select count(*) from public.contract_terms where contract_id not in ('5c80d000-0000-4000-8000-0000000000d5', '5c80d000-0000-4000-8000-0000000000d7')) = (select n_ct_terms from _estado_antes)
    and (select count(*) from public.financial_terms_audit where action not like 'motor_vigencia%') = (select n_trilha from _estado_antes)
  then 'igual' else 'mudou' end
$$;

select pg_temp.registrar('Z0. motor desligado e o trigger novo habilitado', 'false|O',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' ||
  (select tgenabled::text from pg_trigger where tgname = 'trg_operations_protege_contrato'));

-- ---------------------------------------------------------------------------
-- A. Motor DESLIGADO, sem histórico
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. O1 (contrato, sem histórico) troca KA -> KB', '1', pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a1', '5c80d000-0000-4000-8000-0000000000d2'));
select pg_temp.registrar('A2. O1 remove o contrato', '1', pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a1', 'null'));
select pg_temp.registrar('A3. O4 (sem contrato, sem histórico) recebe KA', '1', pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a4', '5c80d000-0000-4000-8000-0000000000d1'));
update public.operations set contract_id = '5c80d000-0000-4000-8000-0000000000d1' where id = '5c80e000-0000-4000-8000-0000000000a1';
update public.operations set contract_id = null where id = '5c80e000-0000-4000-8000-0000000000a4';

-- ---------------------------------------------------------------------------
-- B. Motor DESLIGADO, com histórico
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. O3 (apontamento) troca KA -> KB: recusado', 'erro 55000', pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', '5c80d000-0000-4000-8000-0000000000d2'));
select pg_temp.registrar('B2. O3 remove o contrato: recusado', 'erro 55000', pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', 'null'));
select pg_temp.registrar('B3. O2 (valor acordado cadastrado) recebe KA: recusado', 'erro 55000', pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a2', '5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('B4. a mensagem manda criar uma nova operação', 'sim',
  case when pg_temp.mensagem_de($q$update public.operations set contract_id = null where id = '5c80e000-0000-4000-8000-0000000000a3'$q$) like '%Crie uma nova operação%' then 'sim' else 'nao' end);
select pg_temp.registrar('B5. nada foi gravado: contratos como estavam', 'KA|-|KA',
  (select string_agg(coalesce(c.name, '-'), '|' order by o.name)
     from public.operations o left join public.contracts c on c.id = o.contract_id
    where o.name in ('O1 sem historico', 'O2 valor acordado', 'O3 apontamento')));

-- ---------------------------------------------------------------------------
-- C. UPDATE sem mudar contract_id
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. reenviar o MESMO contract_id (como a tela faz) em operação com histórico: aceito', '1',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', '5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('C2. reenviar null em operação sem contrato com histórico: aceito', '1',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a2', 'null'));
select pg_temp.registrar('C3. nome, local e status da operação com histórico seguem editáveis', '1',
  pg_temp.como('5c800000-0000-4000-8000-0000000000a1', 'aal2',
    $q$with u as (update public.operations set name = 'O3 apontamento', site = 'Doca 2', status = 'active' where id = '5c80e000-0000-4000-8000-0000000000a3' returning 1) select count(*)::text from u$q$));

-- ---------------------------------------------------------------------------
-- D. Contrato de outro cliente
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D1. sem histórico: contrato de outro cliente segue recusado pela 021 (23503)', 'erro 23503',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a1', '5c80d000-0000-4000-8000-0000000000d3'));
select pg_temp.registrar('D2. com histórico: recusado (a regra nova vem antes da chave composta)', 'erro 55000',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', '5c80d000-0000-4000-8000-0000000000d3'));

-- E. Histórico preservado
select pg_temp.registrar('E1. apontamento, snapshots, origem, vigências e trilha idênticos', 'igual', pg_temp.historico_igual());

-- ---------------------------------------------------------------------------
-- F. Papéis
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. admin em AAL1 não muda o contrato (0 linhas ou erro)', '0',
  case when pg_temp.como('5c800000-0000-4000-8000-0000000000a1', 'aal1',
    $q$with u as (update public.operations set contract_id = null where id = '5c80e000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$) in ('0', 'erro 42501') then '0' else 'mudou' end);
select pg_temp.registrar('F2. operacional não muda o contrato (0 linhas ou erro)', '0',
  case when pg_temp.como('5c800000-0000-4000-8000-0000000000a2', 'aal2',
    $q$with u as (update public.operations set contract_id = null where id = '5c80e000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$) in ('0', 'erro 42501') then '0' else 'mudou' end);
select pg_temp.registrar('F3. anônimo não muda o contrato', '0',
  case when pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'),
    $q$with u as (update public.operations set contract_id = null where id = '5c80e000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$) in ('0', 'erro 42501') then '0' else 'mudou' end);
select pg_temp.registrar('F4. O1 continua em KA depois das tentativas', 'KA',
  (select c.name from public.operations o join public.contracts c on c.id = o.contract_id where o.name = 'O1 sem historico'));
select pg_temp.registrar('F5. o sistema (postgres) é isento, como nos demais bloqueios financeiros', 'sem erro',
  pg_temp.erro_de($q$update public.operations set contract_id = '5c80d000-0000-4000-8000-0000000000d2' where id = '5c80e000-0000-4000-8000-0000000000a3'$q$));
update public.operations set contract_id = '5c80d000-0000-4000-8000-0000000000d1' where id = '5c80e000-0000-4000-8000-0000000000a3';

-- ---------------------------------------------------------------------------
-- J. Exclusão de contrato (motor DESLIGADO)
-- ---------------------------------------------------------------------------

create temporary table _contratos_antes on commit drop as select pg_temp.estado_contratos() as estado;

select pg_temp.registrar('J1. KD: operação com valor acordado cadastrado e SEM apontamento: excluir o contrato é recusado', 'erro 55000',
  pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d4'));
select pg_temp.registrar('J2. nada foi apagado nem desvinculado (contrato, vínculo, vigências de contrato e de valor acordado)', (select estado from _contratos_antes), pg_temp.estado_contratos());
select pg_temp.registrar('J3. KA: operação com apontamento: excluir segue recusado (011)', 'erro 42501',
  pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('J4. o sistema (postgres) também é recusado: a exclusão não tem isenção de papel', '55000',
  pg_temp.erro_de($q$delete from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d4'$q$));
select pg_temp.registrar('J5. a mensagem manda inativar o contrato', 'sim',
  case when pg_temp.mensagem_de($q$delete from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d4'$q$) like '%Inative o contrato%' then 'sim' else 'nao' end);
select pg_temp.registrar('J6. admin em AAL1, operacional e anônimo não apagam contrato (0 linhas ou erro)', '0|0|0',
  (select string_agg(case when r in ('0', 'erro 42501') then '0' else 'apagou' end, '|') from (
     select pg_temp.como('5c800000-0000-4000-8000-0000000000a1', 'aal1', $q$with d as (delete from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d5' returning 1) select count(*)::text from d$q$) as r
     union all select pg_temp.como('5c800000-0000-4000-8000-0000000000a2', 'aal2', $q$with d as (delete from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d5' returning 1) select count(*)::text from d$q$)
     union all select pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), $q$with d as (delete from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d5' returning 1) select count(*)::text from d$q$)) q));
select pg_temp.registrar('J7. contrato SEM operação nenhuma: exclusão permitida', '1', pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d6'));
select pg_temp.registrar('J8. KE: operação ligada sem histórico: exclusão do contrato permitida', '1', pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d5'));
select pg_temp.registrar('J8b. e a operação ficou sem contrato (SET NULL preservado)', '-',
  (select coalesce(c.name, '-') from public.operations o left join public.contracts c on c.id = o.contract_id where o.name like 'O6%'));
select pg_temp.registrar('J9. as vigências de KE saíram junto (cascata já existente), as de KD seguem', '1',
  (select count(*)::text from public.contract_terms where contract_id = '5c80d000-0000-4000-8000-0000000000d4'));

-- ---------------------------------------------------------------------------
-- G. Motor LIGADO
-- ---------------------------------------------------------------------------

select pg_temp.registrar('G0. LIGAR (aceitando a pendência de O4, sem valor acordado cadastrado)', '1', pg_temp.motor(true, ', true'));
select pg_temp.registrar('G1. ligado e o trigger novo continua habilitado', 'true|O',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' ||
  (select tgenabled::text from pg_trigger where tgname = 'trg_operations_protege_contrato'));
select pg_temp.registrar('G2. ligado, sem histórico: O1 troca KA -> KB e volta', '1|1',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a1', '5c80d000-0000-4000-8000-0000000000d2') || '|' ||
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a1', '5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('G3. ligado, com apontamento: troca e remoção recusadas', 'erro 55000|erro 55000',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', '5c80d000-0000-4000-8000-0000000000d2') || '|' ||
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', 'null'));
select pg_temp.registrar('G4. ligado, com valor acordado cadastrado e SEM apontamento (lacuna da 025): recebe contrato recusado', 'erro 55000',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a2', '5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('G5. ligado, sem histórico: O4 recebe KA e volta', '1|1',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a4', '5c80d000-0000-4000-8000-0000000000d1') || '|' ||
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a4', 'null'));
select pg_temp.registrar('G6. ligado, contrato de outro cliente: 23503 sem histórico e 55000 com histórico', 'erro 23503|erro 55000',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a1', '5c80d000-0000-4000-8000-0000000000d3') || '|' ||
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', '5c80d000-0000-4000-8000-0000000000d3'));
select pg_temp.registrar('G7. ligado, reenviar o mesmo contract_id segue aceito', '1',
  pg_temp.trocar('5c80e000-0000-4000-8000-0000000000a3', '5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('G8. histórico idêntico depois de tudo', 'igual', pg_temp.historico_igual());

-- J (continuação). Exclusão de contrato com o motor LIGADO
create temporary table _contratos_antes_on on commit drop as select pg_temp.estado_contratos() as estado;
select pg_temp.registrar('J10. ligado: KD (valor acordado cadastrado, sem apontamento): excluir recusado', 'erro 55000',
  pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d4'));
select pg_temp.registrar('J11. ligado: KA (apontamento): excluir recusado', 'erro 42501',
  pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d1'));
select pg_temp.registrar('J12. ligado: nada mudou', (select estado from _contratos_antes_on), pg_temp.estado_contratos());
select pg_temp.registrar('J13. ligado: KG (operação sem histórico): exclusão do contrato permitida', '1', pg_temp.apagar_contrato('5c80d000-0000-4000-8000-0000000000d7'));
select pg_temp.registrar('J13b. ligado: e a operação ficou sem contrato', '-',
  (select coalesce(c.name, '-') from public.operations o left join public.contracts c on c.id = o.contract_id where o.name like 'O7%'));


-- ---------------------------------------------------------------------------
-- H. Remoção de contrato e permissões
-- ---------------------------------------------------------------------------

select pg_temp.registrar('H1. apagar o contrato de uma operação com apontamento segue recusado (011)', 'erro',
  case when pg_temp.erro_de($q$delete from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d1'$q$) = 'sem erro' then 'sem erro' else 'erro' end);
select pg_temp.registrar('H2. o contrato KA e a operação O3 continuam ligados', 'KA',
  (select c.name from public.operations o join public.contracts c on c.id = o.contract_id where o.name = 'O3 apontamento'));
select pg_temp.registrar('H3. permissões: função de trigger sem EXECUTE para papel de API, dono postgres, search_path fixo', '1|false|false|false|false',
  (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proteger_contrato_da_operacao'
      and p.proowner = 'postgres'::regrole and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%')
  || '|' || has_function_privilege('authenticated', 'public.proteger_contrato_da_operacao()', 'execute')::text
  || '|' || has_function_privilege('anon', 'public.proteger_contrato_da_operacao()', 'execute')::text
  || '|' || has_function_privilege('service_role', 'public.proteger_contrato_da_operacao()', 'execute')::text
  || '|' || has_function_privilege('bslog_rpc_operacional', 'public.proteger_contrato_da_operacao()', 'execute')::text);
select pg_temp.registrar('H4. desligar o motor funciona e não desabilita o trigger novo', '1|O',
  pg_temp.motor(false) || '|' || (select tgenabled::text from pg_trigger where tgname = 'trg_operations_protege_contrato'));

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
    raise exception '024_protege_contrato_da_operacao: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
