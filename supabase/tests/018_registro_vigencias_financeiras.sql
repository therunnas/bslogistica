-- Migration 023 — registro controlado de vigências financeiras (C05-B, etapa 3.1).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez, DEPOIS de as
-- migrations 021, 022 e 023 estarem aplicadas. Tudo acontece dentro de uma transação que
-- termina em `rollback`, então nada é criado, alterado ou removido — inclusive em
-- `auth.users` e `auth.sessions`. NUNCA rodar contra Production: o `rollback` protege, mas o
-- arquivo escreve em `auth.users`, `auth.sessions`, nas tabelas de negócio, nas de versões e
-- na trilha de auditoria.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A..G  registro, vigência futura, adjacência, sobreposição, intervalo e valores inválidos,
--         registro retroativo, correção rastreável
--   H..L  quem pode: admin AAL2 sim; admin AAL1, operacional, sem papel, anônimo, service_role,
--         sessão inválida e sem sessão, não
--   M     escrita direta nas tabelas de versões e na trilha: recusada
--   O     consulta por work_date, inclusive as fronteiras do intervalo e a ausência de
--         histórico (zero linhas; a função interna levanta P0002; nunca cai na taxa atual)
--   P     imutabilidade das versões e da trilha, também para o dono
--   Q     versão referenciada por apontamento: não some, não é aposentada, não perde cobertura
--   R..T  o cálculo atual, as faturas e os apontamentos antigos não mudam
--   U     custo do colaborador (mesmo desenho)
--   V     inventário de privilégios e de funções
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Concorrência entre sessões (um arquivo é uma sessão): foi medida à parte, com duas sessões.

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

-- Chama uma expressão (função que devolve valor ou void) e devolve '1' se não deu erro.
create or replace function pg_temp.chamar(_uid text, _aal text, _chamada text) returns text language sql as $$
  select pg_temp.como(_uid, _aal, format('select count(*)::text from (select %s) x', _chamada))
$$;

create or replace function pg_temp.adm(_chamada text) returns text language sql as $$
  select pg_temp.chamar('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', _chamada)
$$;

-- Executa um SELECT como admin AAL2 e devolve o primeiro valor ('nulo' se não houver linha).
create or replace function pg_temp.adm_valor(_sql text) returns text language sql as $$
  select pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;

-- Executa um SELECT como postgres e devolve o primeiro valor ou 'erro <sqlstate>'.
create or replace function pg_temp.valor_de(_sql text) returns text language plpgsql as $$
declare _r text;
begin
  execute _sql into _r;
  return coalesce(_r, 'nulo');
exception when others then
  return 'erro ' || sqlstate;
end;
$$;

create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture
--
--   a1 ADM (admin)   a2 OP (operacional)   a3 SR (sem papel)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c0c0000-0000-4000-8000-0000000000a1'),
  ('5c0c0000-0000-4000-8000-0000000000a2'),
  ('5c0c0000-0000-4000-8000-0000000000a3');

insert into auth.sessions (id, user_id, not_after) values
  ('ec0c0000-0000-4000-8000-0000000000a1', '5c0c0000-0000-4000-8000-0000000000a1', null),
  ('ec0c0000-0000-4000-8000-0000000000a2', '5c0c0000-0000-4000-8000-0000000000a2', null),
  ('ec0c0000-0000-4000-8000-0000000000a3', '5c0c0000-0000-4000-8000-0000000000a3', null);

insert into public.user_roles (user_id, role) values
  ('5c0c0000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c0c0000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c0cc000-0000-4000-8000-0000000000ca', 'C05B3 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c0cd000-0000-4000-8000-00000000000a', '5c0cc000-0000-4000-8000-0000000000ca', 'KA C05B3', 120, 8, 1.5, 10),
  ('5c0cd000-0000-4000-8000-00000000000b', '5c0cc000-0000-4000-8000-0000000000ca', 'KB C05B3', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c0cf000-0000-4000-8000-000000000001', 'C05B3 colaborador 1', 80);

-- Apontamento criado ANTES de qualquer versão (referência do cálculo atual).
insert into public.operations (id, client_id, contract_id, name)
  values ('5c0ce000-0000-4000-8000-000000000001', '5c0cc000-0000-4000-8000-0000000000ca', '5c0cd000-0000-4000-8000-00000000000a', 'C05B3 operação');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
  values ('5c0ca000-0000-4000-8000-000000000001', '5c0ce000-0000-4000-8000-000000000001', 'T', '06:00', '15:00', 60);
insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('5c0cb000-0000-4000-8000-000000000001', '5c0ce000-0000-4000-8000-000000000001', '5c0ca000-0000-4000-8000-000000000001', date '2026-01-15'),
  ('5c0cb000-0000-4000-8000-000000000002', '5c0ce000-0000-4000-8000-000000000001', '5c0ca000-0000-4000-8000-000000000001', date '2026-01-16');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
  ('5c0cb100-0000-4000-8000-000000000001', '5c0cb000-0000-4000-8000-000000000001', '5c0cf000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60),
  ('5c0cb100-0000-4000-8000-000000000002', '5c0cb000-0000-4000-8000-000000000002', '5c0cf000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);

create temporary table _base on commit drop as
select (select md5(string_agg(c::text, ';' order by c.id)) from public.contracts c) as contratos,
       (select md5(string_agg(e::text, ';' order by e.id)) from public.employees e) as colaboradores,
       (select md5(string_agg(t::text, ';' order by t.id)) from public.timesheets t) as folhas;

select pg_temp.registrar('R0. apontamento de referência derivado como sempre (120 + 2h*22,50 = 165,00; custo 80 + 2h*10 = 100,00)',
  '165.00|100.00', (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0cb100-0000-4000-8000-000000000001'));

create temporary table _entradas_antes on commit drop as
select id, to_jsonb(te) as linha from public.timesheet_entries te;

-- ---------------------------------------------------------------------------
-- A..G. Contrato: registro, vigência futura, adjacência, sobreposição, inválidos, correção
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. admin AAL2 registra a primeira vigência (T1: 01/01/2026, aberta, diária 100)', '1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000a', date '2026-01-01', 100, 8, 1.5, 10, 'Contrato inicial')$q$));

select pg_temp.registrar('A2. a versão nasce ativa, aberta, origem informada, com o autor e o motivo',
  'true|nulo|informada|5c0c0000-0000-4000-8000-0000000000a1|Contrato inicial',
  (select active::text || '|' || coalesce(valid_to::text, 'nulo') || '|' || origin || '|' || created_by::text || '|' || reason
     from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01'));

select pg_temp.registrar('A3. gravou o evento de auditoria com ator, ação, entidade, valores novos e motivo',
  '1|contrato_condicao_registrada|contrato|5c0c0000-0000-4000-8000-0000000000a1|100.00|Contrato inicial',
  (select count(*)::text || '|' || min(action) || '|' || min(entity_kind) || '|' || min(actor_id::text) || '|' || min(new ->> 'daily_rate') || '|' || min(reason)
     from public.financial_terms_audit where entity_id = '5c0cd000-0000-4000-8000-00000000000a'));

-- B. vigência futura
select pg_temp.registrar('B1. nova versão aberta sobre a aberta anterior, sem pedir para encerrar: recusada (23P01)', 'erro 23P01',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000a', date '2040-01-01', 130, 8, 1.5, 10, 'Reajuste 2040')$q$));
select pg_temp.registrar('B1b. nada mudou depois da recusa (1 versão, ainda aberta)', '1|nulo',
  (select count(*)::text || '|' || coalesce(max(valid_to)::text, 'nulo') from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a'));
select pg_temp.registrar('B2. com p_encerrar_anterior a futura (T2: 01/01/2040) é aceita', '1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000a', date '2040-01-01', 130, 8, 1.5, 10, 'Reajuste 2040', null, true)$q$));
select pg_temp.registrar('B3. T1 foi encerrada na data inicial de T2 (fim exclusivo)', '2040-01-01',
  (select valid_to::text from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01'));
select pg_temp.registrar('B4. o encerramento automático também ficou na trilha, com valores anteriores e novos',
  '1|nulo|2040-01-01',
  (select count(*)::text || '|' || coalesce(min(previous ->> 'valid_to'), 'nulo') || '|' || min(new ->> 'valid_to')
     from public.financial_terms_audit where action = 'contrato_condicao_encerrada' and entity_id = '5c0cd000-0000-4000-8000-00000000000a'));

-- C. adjacente (retroativa)
select pg_temp.registrar('C1. versão retroativa ADJACENTE antes de T1 (T0: [01/12/2025, 01/01/2026)) é aceita', '1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000a', date '2025-12-01', 90, 8, 1.5, 10, 'Histórico informado pelo administrador', date '2026-01-01')$q$));
select pg_temp.registrar('C2. o evento marca a versão como retroativa; a futura não é retroativa', 'true|false',
  (select (select (new ->> 'retroativa') from public.financial_terms_audit where action = 'contrato_condicao_registrada' and new ->> 'valid_from' = '2025-12-01')
       || '|' ||
          (select (new ->> 'retroativa') from public.financial_terms_audit where action = 'contrato_condicao_registrada' and new ->> 'valid_from' = '2040-01-01')));

-- D. sobreposição
select pg_temp.registrar('D1. versão que sobrepõe T1 ([01/03/2026, 01/04/2026)) é recusada (23P01)', 'erro 23P01',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000a', date '2026-03-01', 111, 8, 1.5, 10, 'x', date '2026-04-01')$q$));
select pg_temp.registrar('D2. versão que cobre várias existentes é recusada', 'erro 23P01',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000a', date '2025-06-01', 111, 8, 1.5, 10, 'x', date '2045-01-01')$q$));
select pg_temp.registrar('D3. as mesmas datas em OUTRO contrato são válidas', '1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2026-03-01', 111, 8, 1.5, 10, 'Contrato B', date '2026-04-01')$q$));
select pg_temp.registrar('D4. depois das recusas só existem T0, T1 e T2 no contrato A', '3',
  (select count(*)::text from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a'));

-- E. inválidos
select pg_temp.registrar('E1. fim igual ao início (intervalo vazio): 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', 100, 8, 1.5, 10, 'x', date '2030-01-01')$q$));
select pg_temp.registrar('E2. fim antes do início: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-02-01', 100, 8, 1.5, 10, 'x', date '2030-01-01')$q$));
select pg_temp.registrar('E3. diária negativa: 23514', 'erro 23514',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', -1, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E4. jornada zero: 23514', 'erro 23514',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', 100, 0, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E5. tolerância negativa: 23514', 'erro 23514',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', 100, 8, 1.5, -1, 'x')$q$));
select pg_temp.registrar('E6. três casas decimais na diária: 22023 (nada de arredondar em silêncio)', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', 100.005, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E7. motivo em branco: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', 100, 8, 1.5, 10, '   ')$q$));
select pg_temp.registrar('E8. motivo nulo: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2030-01-01', 100, 8, 1.5, 10, null)$q$));
select pg_temp.registrar('E9. início nulo: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', null, 100, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E10. contrato inexistente: P0002', 'erro P0002',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-0000000000ff', date '2030-01-01', 100, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('E11. motivo acima de 1000 caracteres: 22023', 'erro 22023',
  pg_temp.adm(format('public.registrar_condicao_contrato(%L, date %L, 100, 8, 1.5, 10, %L)', '5c0cd000-0000-4000-8000-00000000000b', '2030-01-01', repeat('x', 1001))));
select pg_temp.registrar('E12. nenhuma das recusas gravou versão nem auditoria (contrato B: só D3)', '1|1',
  (select (select count(*) from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000b')::text || '|'
       || (select count(*) from public.financial_terms_audit where entity_id = '5c0cd000-0000-4000-8000-00000000000b')::text));

-- G. correção rastreável
do $g$
declare
  _t0 uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2025-12-01');
  _t1 uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01');
  _novo uuid;
begin
  perform pg_temp.registrar('G1. corrigir T0 (diária 90 -> 95, mesmo intervalo)', '1',
    pg_temp.adm(format('public.corrigir_condicao_contrato(%L, date %L, date %L, 95, 8, 1.5, 10, %L)', _t0, '2025-12-01', '2026-01-01', 'Valor lançado errado')));
  select id into _novo from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2025-12-01' and active;
  perform pg_temp.registrar('G2. a antiga ficou aposentada, com data e sucessora; a nova é origem correcao',
    'false|true|true|correcao|95.00',
    (select (a.active)::text || '|' || (a.retired_at is not null)::text || '|' || (a.replaced_by = n.id)::text || '|' || n.origin || '|' || n.daily_rate::text
       from public.contract_terms a, public.contract_terms n where a.id = _t0 and n.id = _novo));
  perform pg_temp.registrar('G3. a trilha guarda a correção com os valores anteriores e novos e o motivo',
    '90.00|95.00|Valor lançado errado',
    (select (previous ->> 'daily_rate') || '|' || (new ->> 'daily_rate') || '|' || reason
       from public.financial_terms_audit where action = 'contrato_condicao_corrigida' and entity_id = '5c0cd000-0000-4000-8000-00000000000a'));
  perform pg_temp.registrar('G4. a consulta na data devolve a corrigida, nunca a aposentada',
    '95.00', pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', '5c0cd000-0000-4000-8000-00000000000a', '2025-12-15')));
  perform pg_temp.registrar('G5. corrigir para um intervalo que sobrepõe outra versão ativa: 23P01', 'erro 23P01',
    pg_temp.adm(format('public.corrigir_condicao_contrato(%L, date %L, null, 100, 8, 1.5, 10, %L)', _t1, '2025-12-15', 'x')));
  perform pg_temp.registrar('G6. a recusa não deixou a versão pela metade (T1 continua ativa, sem sucessora)', 'true|nulo',
    (select active::text || '|' || coalesce(replaced_by::text, 'nulo') from public.contract_terms where id = _t1));
  perform pg_temp.registrar('G7. versão aposentada não pode ser corrigida: 55000', 'erro 55000',
    pg_temp.adm(format('public.corrigir_condicao_contrato(%L, date %L, date %L, 99, 8, 1.5, 10, %L)', _t0, '2025-12-01', '2026-01-01', 'x')));
  perform pg_temp.registrar('G8. versão inexistente: P0002', 'erro P0002',
    pg_temp.adm(format('public.corrigir_condicao_contrato(%L, date %L, null, 99, 8, 1.5, 10, %L)', '5c0cd000-0000-4000-8000-0000000000fe', '2030-01-01', 'x')));
end;
$g$;

-- encerrar / aposentar (contrato B, sem apontamentos)
do $e$
declare
  _b uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000b' and valid_from = date '2026-03-01');
  _b2 uuid;
begin
  perform pg_temp.registrar('G9. encerrar T(B) antes do fim atual ([01/03, 01/04) -> 15/03)', '1',
    pg_temp.adm(format('public.encerrar_condicao_contrato(%L, date %L, %L)', _b, '2026-03-15', 'Contrato encerrado antes')));
  perform pg_temp.registrar('G10. o fim ficou em 15/03', '2026-03-15', (select valid_to::text from public.contract_terms where id = _b));
  perform pg_temp.registrar('G11. estender a data final não é encerrar: 22023', 'erro 22023',
    pg_temp.adm(format('public.encerrar_condicao_contrato(%L, date %L, %L)', _b, '2026-03-20', 'x')));
  perform pg_temp.registrar('G12. fim no início da vigência: 22023', 'erro 22023',
    pg_temp.adm(format('public.encerrar_condicao_contrato(%L, date %L, %L)', _b, '2026-03-01', 'x')));
  perform pg_temp.registrar('G13. aposentar uma versão sem apontamentos', '1',
    pg_temp.adm(format('public.aposentar_condicao_contrato(%L, %L)', _b, 'Lançada no contrato errado')));
  perform pg_temp.registrar('G14. ficou inativa, com data, sem sucessora', 'false|true|nulo',
    (select active::text || '|' || (retired_at is not null)::text || '|' || coalesce(replaced_by::text, 'nulo') from public.contract_terms where id = _b));
  perform pg_temp.registrar('G15. aposentar de novo: 55000', 'erro 55000',
    pg_temp.adm(format('public.aposentar_condicao_contrato(%L, %L)', _b, 'x')));
  perform pg_temp.registrar('G16. encerrar versão aposentada: 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_condicao_contrato(%L, date %L, %L)', _b, '2026-03-10', 'x')));
  perform pg_temp.registrar('G17. a faixa aposentada fica livre para uma nova vigência', '1',
    pg_temp.adm($q$public.registrar_condicao_contrato('5c0cd000-0000-4000-8000-00000000000b', date '2026-03-01', 115, 8, 1.5, 10, 'Refeita', date '2026-04-01')$q$));
  perform pg_temp.registrar('G18. ao todo a trilha do contrato B tem registro, encerramento, aposentadoria e novo registro',
    'contrato_condicao_aposentada,contrato_condicao_encerrada,contrato_condicao_registrada,contrato_condicao_registrada',
    (select string_agg(action, ',' order by action) from public.financial_terms_audit where entity_id = '5c0cd000-0000-4000-8000-00000000000b'));
end;
$e$;

-- ---------------------------------------------------------------------------
-- H..L. Quem pode
-- ---------------------------------------------------------------------------

do $auth$
declare
  _a1 constant text := '5c0c0000-0000-4000-8000-0000000000a1';
  _a2 constant text := '5c0c0000-0000-4000-8000-0000000000a2';
  _a3 constant text := '5c0c0000-0000-4000-8000-0000000000a3';
  _t1 uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01');
  _e1 constant text := '5c0cf000-0000-4000-8000-000000000001';
  _chamadas text[];
  _c text;
  _n int := 0;
  _bad text;
begin
  _chamadas := array[
    format('public.registrar_condicao_contrato(%L, date %L, 100, 8, 1.5, 10, %L)', '5c0cd000-0000-4000-8000-00000000000b', '2031-01-01', 'x'),
    format('public.corrigir_condicao_contrato(%L, date %L, null, 100, 8, 1.5, 10, %L)', _t1, '2026-01-01', 'x'),
    format('public.encerrar_condicao_contrato(%L, date %L, %L)', _t1, '2030-01-01', 'x'),
    format('public.aposentar_condicao_contrato(%L, %L)', _t1, 'x'),
    format('public.condicao_contrato_na_data(%L, date %L)', '5c0cd000-0000-4000-8000-00000000000a', '2026-02-01'),
    format('public.registrar_custo_colaborador(%L, date %L, 80, %L)', _e1, '2031-01-01', 'x'),
    format('public.corrigir_custo_colaborador(%L, date %L, null, 80, %L)', _t1, '2026-01-01', 'x'),
    format('public.encerrar_custo_colaborador(%L, date %L, %L)', _t1, '2030-01-01', 'x'),
    format('public.aposentar_custo_colaborador(%L, %L)', _t1, 'x'),
    format('public.custo_colaborador_na_data(%L, date %L)', _e1, '2026-02-01')
  ];
  foreach _c in array _chamadas loop
    _n := _n + 1;
    perform pg_temp.registrar(format('H/I. RPC %s: admin em AAL1 recusado (42501)', _n), 'erro 42501', pg_temp.chamar(_a1, 'aal1', _c));
    perform pg_temp.registrar(format('J. RPC %s: operacional em AAL2 recusado (42501)', _n), 'erro 42501', pg_temp.chamar(_a2, 'aal2', _c));
    perform pg_temp.registrar(format('J2. RPC %s: operacional em AAL1 recusado (42501)', _n), 'erro 42501', pg_temp.chamar(_a2, 'aal1', _c));
    perform pg_temp.registrar(format('K. RPC %s: sem papel em AAL2 recusado (42501)', _n), 'erro 42501', pg_temp.chamar(_a3, 'aal2', _c));
    perform pg_temp.registrar(format('L. RPC %s: anônimo recusado (sem EXECUTE, 42501)', _n), 'erro 42501',
      pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), format('select count(*)::text from (select %s) x', _c)));
    perform pg_temp.registrar(format('L2. RPC %s: service_role recusado (sem EXECUTE, 42501)', _n), 'erro 42501',
      pg_temp.medir_como('service_role', jsonb_build_object('role', 'service_role', 'sub', _a1, 'aal', 'aal2'), format('select count(*)::text from (select %s) x', _c)));
    perform pg_temp.registrar(format('L3. RPC %s: sem sub no JWT recusado (28000)', _n), 'erro 28000',
      pg_temp.medir_como('authenticated', jsonb_build_object('role', 'authenticated', 'aal', 'aal2'), format('select count(*)::text from (select %s) x', _c)));
    perform pg_temp.registrar(format('L4. RPC %s: admin AAL2 com sessão inexistente recusado (42501)', _n), 'erro 42501',
      pg_temp.medir_como('authenticated',
        jsonb_build_object('sub', _a1, 'role', 'authenticated', 'aal', 'aal2', 'session_id', 'ec0c0000-0000-4000-8000-0000000000ff'),
        format('select count(*)::text from (select %s) x', _c)));
    perform pg_temp.registrar(format('L5. RPC %s: admin AAL2 sem claim aal recusado (42501)', _n), 'erro 42501',
      pg_temp.medir_como('authenticated',
        jsonb_build_object('sub', _a1, 'role', 'authenticated', 'session_id', 'ec0c0000-0000-4000-8000-0000000000a1'),
        format('select count(*)::text from (select %s) x', _c)));
  end loop;

  -- Conta banida/excluída: a sessão deixa de valer
  update auth.users set banned_until = now() + interval '1 day' where id = _a1::uuid;
  perform pg_temp.registrar('L6. admin AAL2 com conta banida recusado (42501)', 'erro 42501', pg_temp.chamar(_a1, 'aal2', _chamadas[5]));
  update auth.users set banned_until = null where id = _a1::uuid;
  perform pg_temp.registrar('L7. e voltando a conta ao normal ele volta a poder', '1', pg_temp.chamar(_a1, 'aal2', _chamadas[5]));

  -- nada foi gravado por nenhuma tentativa recusada
  select string_agg(distinct d, ',') into _bad from (
    select 'contratos' as d where (select count(*) from public.contract_terms where valid_from = date '2031-01-01') <> 0
    union all select 'colaboradores' where (select count(*) from public.employee_cost_terms) <> 0) x;
  perform pg_temp.registrar('L8. nenhuma tentativa recusada gravou versão', 'nulo', coalesce(_bad, 'nulo'));
end;
$auth$;


-- ---------------------------------------------------------------------------
-- M. Escrita direta nas tabelas de versões e na trilha
-- ---------------------------------------------------------------------------

select pg_temp.registrar('M1. admin AAL2 NÃO insere versão pela API', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2',
    $q$with i as (insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason) values ('5c0cd000-0000-4000-8000-00000000000b', date '2050-01-01', 1, 8, 1, 0, 'informada', 'x') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('M2. admin AAL2 NÃO altera versão pela API', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', $q$with u as (update public.contract_terms set daily_rate = 1 returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('M3. admin AAL2 NÃO apaga versão pela API', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', $q$with d as (delete from public.contract_terms returning 1) select count(*)::text from d$q$));
select pg_temp.registrar('M4. admin AAL2 NÃO insere versão de custo pela API', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2',
    $q$with i as (insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, origin, reason) values ('5c0cf000-0000-4000-8000-000000000001', date '2050-01-01', 1, 'informada', 'x') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('M5. admin AAL2 NÃO escreve na trilha pela API (INSERT)', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2',
    $q$with i as (insert into public.financial_terms_audit (actor_id, action, entity_kind, entity_id, term_id, reason) values ('5c0c0000-0000-4000-8000-0000000000a1', 'contrato_condicao_registrada', 'contrato', '5c0cd000-0000-4000-8000-00000000000a', '5c0cd000-0000-4000-8000-00000000000a', 'forjado') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('M6. admin AAL2 NÃO altera a trilha (UPDATE)', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', $q$with u as (update public.financial_terms_audit set reason = 'apagado' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('M7. admin AAL2 NÃO apaga da trilha (DELETE)', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', $q$with d as (delete from public.financial_terms_audit returning 1) select count(*)::text from d$q$));
select pg_temp.registrar('M8. admin AAL2 NÃO esvazia a trilha (TRUNCATE)', 'erro 42501',
  pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal2', 'truncate public.financial_terms_audit'));
select pg_temp.registrar('M9. anônimo não lê as versões nem a trilha', 'erro 42501|erro 42501',
  pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), 'select count(*)::text from public.contract_terms')
  || '|' || pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), 'select count(*)::text from public.financial_terms_audit'));

-- ---------------------------------------------------------------------------
-- O. Consulta por work_date e ausência de histórico
-- ---------------------------------------------------------------------------

do $o$
declare
  _ka constant text := '5c0cd000-0000-4000-8000-00000000000a';
  _kb constant text := '5c0cd000-0000-4000-8000-00000000000b';
begin
  perform pg_temp.registrar('O1. um dia antes do primeiro histórico: ZERO linhas (nada de taxa atual)', 'nulo',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2025-11-30')));
  perform pg_temp.registrar('O2. início de T0 (fronteira inclusiva)', '95.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2025-12-01')));
  perform pg_temp.registrar('O3. último dia de T0', '95.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2025-12-31')));
  perform pg_temp.registrar('O4. 01/01/2026 pertence a T1, que COMEÇA nele, e não a T0, que termina nele', '100.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2026-01-01')));
  perform pg_temp.registrar('O5. último dia de T1', '100.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2039-12-31')));
  perform pg_temp.registrar('O6. início de T2', '130.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2040-01-01')));
  perform pg_temp.registrar('O7. versão aberta vale para qualquer data futura', '130.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _ka, '2099-01-01')));
  perform pg_temp.registrar('O8. lacuna entre versões do contrato B (28/02): zero linhas', 'nulo',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _kb, '2026-02-28')));
  perform pg_temp.registrar('O9. fim exclusivo de B (01/04): zero linhas', 'nulo',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _kb, '2026-04-01')));
  perform pg_temp.registrar('O10. último dia de B (31/03)', '115.00',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L)', _kb, '2026-03-31')));
  perform pg_temp.registrar('O11. a taxa ATUAL do contrato (120) não aparece em nenhuma consulta de data sem histórico', 'nulo',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, date %L) where daily_rate = 120', _ka, '2025-11-30')));
  perform pg_temp.registrar('O12. a função interna levanta P0002 quando não há histórico (contrato A, 30/11/2025)', 'P0002',
    pg_temp.erro_de(format('select (public.exigir_condicao_contrato_na_data(%L, date %L)).id', _ka, '2025-11-30')));
  perform pg_temp.registrar('O13. a interna devolve a versão quando há histórico', '100.00',
    pg_temp.valor_de(format('select (public.exigir_condicao_contrato_na_data(%L, date %L)).daily_rate::text', _ka, '2026-06-01')));
  perform pg_temp.registrar('O14. admin AAL2 NÃO executa a função interna (sem EXECUTE)', 'erro 42501',
    pg_temp.adm_valor(format('select (public.exigir_condicao_contrato_na_data(%L, date %L)).id::text', _ka, '2026-06-01')));
  perform pg_temp.registrar('O15. nem a interna de custo', 'erro 42501',
    pg_temp.adm_valor(format('select (public.exigir_custo_colaborador_na_data(%L, date %L)).id::text', '5c0cf000-0000-4000-8000-000000000001', '2026-06-01')));
  perform pg_temp.registrar('O16. consulta com data nula: 22023', 'erro 22023',
    pg_temp.adm_valor(format('select daily_rate::text from public.condicao_contrato_na_data(%L, null)', _ka)));
end;
$o$;

-- ---------------------------------------------------------------------------
-- P. Imutabilidade (vale também para o dono)
-- ---------------------------------------------------------------------------

do $p$
declare
  _t1  uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01');
  _t0v uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2025-12-01' and not active);
  _bv  uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000b' and valid_from = date '2026-03-01' and active);
begin
  perform pg_temp.registrar('P1. diária de uma versão não muda (nem para o dono)', '42501', pg_temp.erro_de(format('update public.contract_terms set daily_rate = 1 where id = %L', _t1)));
  perform pg_temp.registrar('P2. início da vigência não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set valid_from = date %L where id = %L', '2026-01-02', _t1)));
  perform pg_temp.registrar('P3. motivo não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set reason = %L where id = %L', 'reescrito', _t1)));
  perform pg_temp.registrar('P4. origem não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set origin = %L where id = %L', 'correcao', _t1)));
  perform pg_temp.registrar('P5. contrato da versão não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set contract_id = %L where id = %L', '5c0cd000-0000-4000-8000-00000000000b', _t1)));
  perform pg_temp.registrar('P6. autoria não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set created_by = null where id = %L', _t1)));
  perform pg_temp.registrar('P7. data final não se estende', '42501', pg_temp.erro_de(format('update public.contract_terms set valid_to = date %L where id = %L', '2041-01-01', _t1)));
  perform pg_temp.registrar('P8. data final não volta a ser aberta', '42501', pg_temp.erro_de(format('update public.contract_terms set valid_to = null where id = %L', _t1)));
  perform pg_temp.registrar('P9. versão aposentada não volta a ficar ativa', '42501', pg_temp.erro_de(format('update public.contract_terms set active = true, retired_at = null where id = %L', _t0v)));
  perform pg_temp.registrar('P10. sucessora já apontada não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set replaced_by = null where id = %L', _t0v)));
  perform pg_temp.registrar('P11. versão ativa não ganha sucessora', '42501', pg_temp.erro_de(format('update public.contract_terms set replaced_by = %L where id = %L', _t1, _t1)));
  perform pg_temp.registrar('P12. data de aposentadoria não muda', '42501', pg_temp.erro_de(format('update public.contract_terms set retired_at = now() + interval %L where id = %L', '1 day', _t0v)));
  perform pg_temp.registrar('P13. aposentar sem data: recusado', '42501', pg_temp.erro_de(format('update public.contract_terms set active = false where id = %L', _bv)));
  perform pg_temp.registrar('P14. antecipar a data final de uma versão ativa é a única mudança aceita', 'sem erro', pg_temp.erro_de(format('update public.contract_terms set valid_to = date %L where id = %L', '2026-03-20', _bv)));
  perform pg_temp.registrar('P15. a trilha não aceita UPDATE nem do dono', '42501', pg_temp.erro_de($q$update public.financial_terms_audit set reason = 'x'$q$));
  perform pg_temp.registrar('P16. a trilha não aceita DELETE nem do dono', '42501', pg_temp.erro_de('delete from public.financial_terms_audit'));
  perform pg_temp.registrar('P17. a trilha não aceita TRUNCATE nem do dono', '42501', pg_temp.erro_de('truncate public.financial_terms_audit'));
  perform pg_temp.registrar('P18. nenhuma recusa alterou as versões (T1 inalterada)', '100.00|2040-01-01|true',
    (select daily_rate::text || '|' || valid_to::text || '|' || active::text from public.contract_terms where id = _t1));
end;
$p$;

-- ---------------------------------------------------------------------------
-- Q..T. Versão referenciada por apontamento, cálculo atual, faturas e apontamentos antigos
-- ---------------------------------------------------------------------------

-- Preparo (como postgres, que é o único que escreve essas colunas): os dois apontamentos
-- referenciam T1. Não há derivação por versão nesta migration, então a referência é manual.
update public.timesheet_entries
   set contract_terms_id = (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01'),
       terms_origin = 'versao'
 where id in ('5c0cb100-0000-4000-8000-000000000001', '5c0cb100-0000-4000-8000-000000000002');

insert into public.invoices (id, client_id, period_start, period_end, status)
  values ('5c0cb200-0000-4000-8000-000000000001', '5c0cc000-0000-4000-8000-0000000000ca', date '2026-01-01', date '2026-01-31', 'closed');
update public.timesheet_entries set invoice_id = '5c0cb200-0000-4000-8000-000000000001' where id = '5c0cb100-0000-4000-8000-000000000002';

create temporary table _antes_q on commit drop as
select (select md5(string_agg(te::text, ';' order by te.id)) from public.timesheet_entries te) as apontamentos,
       (select md5(i::text) from public.invoices i where i.id = '5c0cb200-0000-4000-8000-000000000001') as fatura,
       (select md5(string_agg(ii::text, ';' order by ii.id)) from public.invoice_items ii) as itens;

do $q$
declare
  _t1 uuid := (select id from public.contract_terms where contract_id = '5c0cd000-0000-4000-8000-00000000000a' and valid_from = date '2026-01-01');
begin
  perform pg_temp.registrar('Q1. versão referenciada por apontamento NÃO pode ser apagada (23503)', '23503',
    pg_temp.erro_de(format('delete from public.contract_terms where id = %L', _t1)));
  perform pg_temp.registrar('Q2. aposentar versão referenciada: 55000', 'erro 55000',
    pg_temp.adm(format('public.aposentar_condicao_contrato(%L, %L)', _t1, 'x')));
  perform pg_temp.registrar('Q3. encerrar antes de um apontamento que a usa (10/01 < 15/01): 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_condicao_contrato(%L, date %L, %L)', _t1, '2026-01-10', 'x')));
  perform pg_temp.registrar('Q4. encerrar no mesmo dia de um apontamento que a usa (16/01): 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_condicao_contrato(%L, date %L, %L)', _t1, '2026-01-16', 'x')));
  perform pg_temp.registrar('Q5. corrigir para um intervalo que deixa um apontamento de fora: 55000', 'erro 55000',
    pg_temp.adm(format('public.corrigir_condicao_contrato(%L, date %L, date %L, 101, 8, 1.5, 10, %L)', _t1, '2026-01-16', '2040-01-01', 'x')));
  perform pg_temp.registrar('Q6. as recusas não mudaram nada (apontamentos, fatura, itens)', 'true',
    (select (a.apontamentos = (select md5(string_agg(te::text, ';' order by te.id)) from public.timesheet_entries te)
             and a.fatura = (select md5(i::text) from public.invoices i where i.id = '5c0cb200-0000-4000-8000-000000000001')
             and a.itens is not distinct from (select md5(string_agg(ii::text, ';' order by ii.id)) from public.invoice_items ii))::text from _antes_q a));
  perform pg_temp.registrar('Q7. corrigir cobrindo todas as datas referenciadas é aceito (diária 101)', '1',
    pg_temp.adm(format('public.corrigir_condicao_contrato(%L, date %L, date %L, 101, 8, 1.5, 10, %L)', _t1, '2026-01-01', '2040-01-01', 'Diária corrigida depois de referenciada')));
  perform pg_temp.registrar('Q8. T1 ficou aposentada com sucessora e SEGUE existindo (continua referenciada)', 'false|true|true',
    (select active::text || '|' || (replaced_by is not null)::text || '|' || (select (count(*) = 2)::text from public.timesheet_entries where contract_terms_id = _t1)
       from public.contract_terms where id = _t1));
  perform pg_temp.registrar('Q9. mesmo aposentada, a versão referenciada não pode ser apagada (23503)', '23503',
    pg_temp.erro_de(format('delete from public.contract_terms where id = %L', _t1)));
end;
$q$;

select pg_temp.registrar('R1. o apontamento antigo continua com os valores derivados de sempre (165,00 / 100,00)',
  '165.00|100.00', (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0cb100-0000-4000-8000-000000000001'));
select pg_temp.registrar('R2. os dois apontamentos seguem apontando para a versão ANTIGA (a correção não os re-aponta nem recalcula)', '2',
  (select count(*)::text from public.timesheet_entries te join public.contract_terms ct on ct.id = te.contract_terms_id
    where not ct.active and ct.valid_from = date '2026-01-01'));
do $r3$
declare _u text; _v text;
begin
  _u := pg_temp.adm_valor($q$with u as (update public.timesheet_entries set check_out = '17:30' where id = '5c0cb100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$);
  select billed_amount::text || '|' || cost_amount::text into _v from public.timesheet_entries where id = '5c0cb100-0000-4000-8000-000000000001';
  perform pg_temp.registrar('R3. editar o horário do apontamento recalcula com a taxa ATUAL do contrato (120), como antes: 120 + 2,5h*22,50 = 176,25',
    '1|176.25|105.00', _u || '|' || _v);
end;
$r3$;
select pg_temp.registrar('R4. contratos, colaboradores e folhas não foram tocados pelas RPCs', 'true',
  (select (b.contratos = (select md5(string_agg(c::text, ';' order by c.id)) from public.contracts c)
       and b.colaboradores = (select md5(string_agg(e::text, ';' order by e.id)) from public.employees e)
       and b.folhas = (select md5(string_agg(t::text, ';' order by t.id)) from public.timesheets t))::text from _base b));

select pg_temp.registrar('S1. a fatura existente continua idêntica depois de todas as RPCs', 'true',
  (select (a.fatura = (select md5(i::text) from public.invoices i where i.id = '5c0cb200-0000-4000-8000-000000000001'))::text from _antes_q a));
select pg_temp.registrar('S2. o apontamento faturado continua com o mesmo vínculo e os mesmos valores', '5c0cb200-0000-4000-8000-000000000001|165.00|100.00',
  (select invoice_id::text || '|' || billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0cb100-0000-4000-8000-000000000002'));
select pg_temp.registrar('S3. e continua imutável para o admin', 'erro 42501',
  pg_temp.adm_valor($q$with u as (update public.timesheet_entries set notes = 'y' where id = '5c0cb100-0000-4000-8000-000000000002' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('S4. nenhuma RPC criou fatura nem item', '1|0',
  (select (select count(*) from public.invoices where client_id = '5c0cc000-0000-4000-8000-0000000000ca')::text || '|' || (select count(*) from public.invoice_items where invoice_id = '5c0cb200-0000-4000-8000-000000000001')::text));

select pg_temp.registrar('T1. apontamentos antigos intactos, exceto as colunas de referência que o preparo do teste preencheu', 'true',
  (select (count(*) = 0)::text from (
     select a.id, a.linha - array['contract_terms_id', 'terms_origin', 'invoice_id', 'billed_amount', 'cost_amount', 'check_out', 'worked_minutes', 'overtime_minutes', 'updated_at'] as antes,
            to_jsonb(te) - array['contract_terms_id', 'terms_origin', 'invoice_id', 'billed_amount', 'cost_amount', 'check_out', 'worked_minutes', 'overtime_minutes', 'updated_at'] as depois
       from _entradas_antes a join public.timesheet_entries te on te.id = a.id) x
   where x.antes is distinct from x.depois));
select pg_temp.registrar('T2. nenhuma das 7 colunas novas foi preenchida por RPC além do preparo manual do teste (colunas de snapshot e custo seguem NULL)', '0',
  (select count(*)::text from public.timesheet_entries
    where employee_cost_terms_id is not null or shift_hours_snapshot is not null or ot_factor_snapshot is not null
       or ot_tolerance_snapshot is not null or planned_minutes_snapshot is not null));

-- ---------------------------------------------------------------------------
-- U. Custo do colaborador
-- ---------------------------------------------------------------------------

do $u$
declare
  _e constant uuid := '5c0cf000-0000-4000-8000-000000000001';
  _u1 uuid; _u0 uuid; _u0n uuid; _r text;
begin
  perform pg_temp.registrar('U1. registrar a primeira vigência de custo (01/01/2026, aberta, 70)', '1',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 70, %L)', _e, '2026-01-01', 'Custo inicial')));
  select id into _u1 from public.employee_cost_terms where employee_id = _e and valid_from = date '2026-01-01';
  perform pg_temp.registrar('U2. nova aberta sobre a aberta: 23P01', 'erro 23P01',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 90, %L)', _e, '2040-01-01', 'x')));
  _r := pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 90, %L, null, true)', _e, '2040-01-01', 'Reajuste 2040'));
  perform pg_temp.registrar('U3. com p_encerrar_anterior a futura é aceita e a anterior fecha na data', '1|2040-01-01',
    _r || '|' || (select valid_to::text from public.employee_cost_terms where id = _u1));
  perform pg_temp.registrar('U4. retroativa adjacente [01/12/2025, 01/01/2026) é aceita', '1',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 60, %L, date %L)', _e, '2025-12-01', 'Histórico informado', '2026-01-01')));
  select id into _u0 from public.employee_cost_terms where employee_id = _e and valid_from = date '2025-12-01';
  perform pg_temp.registrar('U5. sobreposição: 23P01', 'erro 23P01',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 60, %L, date %L)', _e, '2026-02-01', 'x', '2026-03-01')));
  perform pg_temp.registrar('U6. custo negativo: 23514', 'erro 23514',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, -1, %L)', _e, '2030-01-01', 'x')));
  perform pg_temp.registrar('U7. três casas decimais: 22023', 'erro 22023',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 70.001, %L)', _e, '2030-01-01', 'x')));
  perform pg_temp.registrar('U8. motivo em branco: 22023', 'erro 22023',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 70, %L)', _e, '2030-01-01', ' ')));
  perform pg_temp.registrar('U9. intervalo invertido: 22023', 'erro 22023',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 70, %L, date %L)', _e, '2030-02-01', 'x', '2030-01-01')));
  perform pg_temp.registrar('U10. colaborador inexistente: P0002', 'erro P0002',
    pg_temp.adm(format('public.registrar_custo_colaborador(%L, date %L, 70, %L)', '5c0cf000-0000-4000-8000-0000000000ff', '2030-01-01', 'x')));
  perform pg_temp.registrar('U11. corrigir a retroativa (60 -> 65)', '1',
    pg_temp.adm(format('public.corrigir_custo_colaborador(%L, date %L, date %L, 65, %L)', _u0, '2025-12-01', '2026-01-01', 'Custo corrigido')));
  select id into _u0n from public.employee_cost_terms where employee_id = _e and valid_from = date '2025-12-01' and active;
  perform pg_temp.registrar('U12. a antiga ficou aposentada com sucessora; a nova é origem correcao', 'false|true|correcao|65.00',
    (select a.active::text || '|' || (a.replaced_by = n.id)::text || '|' || n.origin || '|' || n.daily_cost::text
       from public.employee_cost_terms a, public.employee_cost_terms n where a.id = _u0 and n.id = _u0n));
  perform pg_temp.registrar('U13. consultas por data: antes (zero linhas), T0 corrigida, T1, T2', 'nulo|65.00|70.00|90.00',
    pg_temp.adm_valor(format('select daily_cost::text from public.custo_colaborador_na_data(%L, date %L)', _e, '2025-11-30'))
    || '|' || pg_temp.adm_valor(format('select daily_cost::text from public.custo_colaborador_na_data(%L, date %L)', _e, '2025-12-15'))
    || '|' || pg_temp.adm_valor(format('select daily_cost::text from public.custo_colaborador_na_data(%L, date %L)', _e, '2026-01-01'))
    || '|' || pg_temp.adm_valor(format('select daily_cost::text from public.custo_colaborador_na_data(%L, date %L)', _e, '2040-01-01')));
  perform pg_temp.registrar('U14. a interna levanta P0002 sem histórico (não cai em employees.daily_cost = 80)', 'P0002',
    pg_temp.erro_de(format('select (public.exigir_custo_colaborador_na_data(%L, date %L)).id', _e, '2025-11-30')));
  perform pg_temp.registrar('U15. o custo atual do colaborador (80) não foi tocado', '80.00',
    (select daily_cost::text from public.employees where id = _e));

  -- versão de custo referenciada
  update public.timesheet_entries set employee_cost_terms_id = _u1, terms_origin = 'versao'
   where id = '5c0cb100-0000-4000-8000-000000000001';
  perform pg_temp.registrar('U16. aposentar versão de custo referenciada: 55000', 'erro 55000',
    pg_temp.adm(format('public.aposentar_custo_colaborador(%L, %L)', _u1, 'x')));
  perform pg_temp.registrar('U17. encerrar antes do apontamento que a usa: 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_custo_colaborador(%L, date %L, %L)', _u1, '2026-01-10', 'x')));
  perform pg_temp.registrar('U18. corrigir sem cobrir o apontamento: 55000', 'erro 55000',
    pg_temp.adm(format('public.corrigir_custo_colaborador(%L, date %L, date %L, 71, %L)', _u1, '2026-02-01', '2040-01-01', 'x')));
  perform pg_temp.registrar('U19. versão referenciada não pode ser apagada (23503)', '23503',
    pg_temp.erro_de(format('delete from public.employee_cost_terms where id = %L', _u1)));
  perform pg_temp.registrar('U20. corrigir cobrindo é aceito', '1',
    pg_temp.adm(format('public.corrigir_custo_colaborador(%L, date %L, date %L, 71, %L)', _u1, '2026-01-01', '2040-01-01', 'Custo corrigido depois de referenciado')));
  perform pg_temp.registrar('U21. encerrar e aposentar numa versão sem apontamento (a retroativa corrigida)', '1|1',
    pg_temp.adm(format('public.encerrar_custo_colaborador(%L, date %L, %L)', _u0n, '2025-12-20', 'Colaborador saiu'))
    || '|' || pg_temp.adm(format('public.aposentar_custo_colaborador(%L, %L)', _u0n, 'Lançamento indevido')));
  perform pg_temp.registrar('U22. o custo gravado no apontamento não mudou (165,00 mudou só pela edição do horário: custo 105,00)', '105.00',
    (select cost_amount::text from public.timesheet_entries where id = '5c0cb100-0000-4000-8000-000000000001'));
  perform pg_temp.registrar('U23. a trilha do colaborador tem os 4 tipos de evento',
    'colaborador_custo_aposentado,colaborador_custo_corrigido,colaborador_custo_encerrado,colaborador_custo_registrado',
    (select string_agg(distinct action, ',' order by action) from public.financial_terms_audit where entity_kind = 'colaborador'));
  perform pg_temp.registrar('U24. a imutabilidade vale para o custo (valor não muda)', '42501',
    pg_temp.erro_de(format('update public.employee_cost_terms set daily_cost = 1 where id = %L', _u1)));
end;
$u$;

-- ---------------------------------------------------------------------------
-- V. Inventário de privilégios, funções e leitura
-- ---------------------------------------------------------------------------

select pg_temp.registrar('V1. as 10 RPCs de API executam só para authenticated (nunca anon, service_role, PUBLIC nem o papel operacional)', '10',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('registrar_condicao_contrato', 'corrigir_condicao_contrato', 'encerrar_condicao_contrato', 'aposentar_condicao_contrato', 'condicao_contrato_na_data',
                        'registrar_custo_colaborador', 'corrigir_custo_colaborador', 'encerrar_custo_colaborador', 'aposentar_custo_colaborador', 'custo_colaborador_na_data')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')
      and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)));
select pg_temp.registrar('V2. as 7 internas não executam para nenhum papel de API', '0',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('exigir_condicao_contrato_na_data', 'exigir_custo_colaborador_na_data', 'condicoes_exigir_admin', 'condicoes_validar_motivo', 'condicoes_auditar',
                        'condicoes_encerrar_contrato_interno', 'condicoes_encerrar_colaborador_interno')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE'))));
select pg_temp.registrar('V3. as 16 funções SECURITY DEFINER são do postgres, com search_path fixo', '16',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proowner = 'postgres'::regrole
      and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%'
      and p.proname in ('registrar_condicao_contrato', 'corrigir_condicao_contrato', 'encerrar_condicao_contrato', 'aposentar_condicao_contrato', 'condicao_contrato_na_data', 'exigir_condicao_contrato_na_data',
                        'registrar_custo_colaborador', 'corrigir_custo_colaborador', 'encerrar_custo_colaborador', 'aposentar_custo_colaborador', 'custo_colaborador_na_data', 'exigir_custo_colaborador_na_data',
                        'condicoes_exigir_admin', 'condicoes_auditar', 'condicoes_encerrar_contrato_interno', 'condicoes_encerrar_colaborador_interno')));
select pg_temp.registrar('V4. os 10 triggers de timesheet_entries anteriores à 023 seguem habilitados, mais o guard da 022 (11); a 023 não criou nenhum (o da 024, se aplicada, fica de fora da conta)', '11',
  (select count(*)::text from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass and not tgisinternal and tgenabled = 'O'
      and tgname <> 'trg_timesheet_entries_bloqueia_condicoes_operacao'));
select pg_temp.registrar('V5. a derivação financeira e gerar_fatura não citam as versões (continuam como estavam)', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('derivar_valores_financeiros', 'gerar_fatura')
     and (prosrc ilike '%contract_terms%' or prosrc ilike '%employee_cost_terms%' or prosrc ilike '%financial_terms_audit%')));
select pg_temp.registrar('V6. trilha: RLS ativa, 2 policies, nenhuma de escrita, só SELECT para authenticated', 'true|2|0|true',
  (select (select relrowsecurity from pg_class where oid = 'public.financial_terms_audit'::regclass)::text
       || '|' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'financial_terms_audit')::text
       || '|' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'financial_terms_audit' and cmd in ('INSERT', 'UPDATE', 'DELETE'))::text
       || '|' || (has_table_privilege('authenticated', 'public.financial_terms_audit', 'SELECT')
                  and not has_table_privilege('authenticated', 'public.financial_terms_audit', 'INSERT')
                  and not has_table_privilege('service_role', 'public.financial_terms_audit', 'SELECT')
                  and not has_table_privilege('bslog_rpc_operacional', 'public.financial_terms_audit', 'SELECT'))::text));
select pg_temp.registrar('V7. admin AAL2 lê a trilha e as versões; admin AAL1, operacional e sem papel leem zero', 'true|0|0|0|true',
  (pg_temp.adm_valor('select (count(*) > 0)::text from public.financial_terms_audit'))
  || '|' || pg_temp.como('5c0c0000-0000-4000-8000-0000000000a1', 'aal1', 'select count(*)::text from public.financial_terms_audit')
  || '|' || pg_temp.como('5c0c0000-0000-4000-8000-0000000000a2', 'aal2', 'select count(*)::text from public.financial_terms_audit')
  || '|' || pg_temp.como('5c0c0000-0000-4000-8000-0000000000a3', 'aal2', 'select count(*)::text from public.financial_terms_audit')
  || '|' || pg_temp.adm_valor('select (count(*) > 0)::text from public.contract_terms'));
select pg_temp.registrar('V8. todo evento tem ator, motivo e entidade; nenhum ator é nulo', '0',
  (select count(*)::text from public.financial_terms_audit where actor_id is null or btrim(reason) = '' or entity_id is null or term_id is null));
select pg_temp.registrar('V9. eventos de escrita guardam os valores novos; correção e encerramento guardam também os anteriores', '0',
  (select count(*)::text from public.financial_terms_audit
    where new is null or (action like '%corrig%' and previous is null) or (action like '%encerrad%' and previous is null) or (action like '%aposentad%' and previous is null)));
select pg_temp.registrar('V10. todas as versões criadas pelas RPCs têm autor (created_by = admin do teste)', '0',
  (select count(*)::text from public.contract_terms where created_by is distinct from '5c0c0000-0000-4000-8000-0000000000a1')
  );

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao <> 'PASS' order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '018_registro_vigencias_financeiras: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
