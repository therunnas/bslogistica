-- Migration 024 — valor acordado por operação e congelamento dormente de turno (C05-B, etapa 3.2).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez, DEPOIS de as
-- migrations 021, 022, 023 e 024 estarem aplicadas. Tudo acontece dentro de uma transação que
-- termina em `rollback`, então nada é criado, alterado ou removido — inclusive em
-- `auth.users` e `auth.sessions`. NUNCA rodar contra Production: o `rollback` protege, mas o
-- arquivo escreve em `auth.users`, `auth.sessions`, nas tabelas de negócio, nas de versões e
-- na trilha de auditoria.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A..G  registro, vigência futura, adjacência, sobreposição, inválidos, retroativo, correção,
--         encerramento e aposentadoria do valor acordado da operação
--   H..L  quem pode (admin AAL2 sim; os demais não) e escrita direta recusada
--   O     consulta por work_date: fronteiras, lacuna e ausência de histórico (nunca cai em
--         operations.agreed_amount)
--   P     imutabilidade e trilha (entidade 'operacao'; eventos antigos seguem aceitos)
--   Q     versão referenciada: não some, não é aposentada, não perde cobertura
--   R..T  operação SEM contrato calcula como antes; edição direta de agreed_amount segue
--         valendo (transitório); faturas e apontamentos antigos intactos
--   U     coluna operation_terms_id: só o sistema a preenche
--   W     turnos: o congelamento nasce DESABILITADO (formulário atual intacto); habilitado,
--         recusa mudar jornada de turno usado (23514) e deixa nome, status e turno novo livres
--   V     inventário de privilégios, funções e triggers; compatibilidade com a 022 e a 023
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
  select pg_temp.chamar('5c0d0000-0000-4000-8000-0000000000a1', 'aal2', _chamada)
$$;

-- Executa um SELECT como admin AAL2 e devolve o primeiro valor ('nulo' se não houver linha).
create or replace function pg_temp.adm_valor(_sql text) returns text language sql as $$
  select pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal2', _sql)
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
  ('5c0d0000-0000-4000-8000-0000000000a1'),
  ('5c0d0000-0000-4000-8000-0000000000a2'),
  ('5c0d0000-0000-4000-8000-0000000000a3');

insert into auth.sessions (id, user_id, not_after) values
  ('ec0d0000-0000-4000-8000-0000000000a1', '5c0d0000-0000-4000-8000-0000000000a1', null),
  ('ec0d0000-0000-4000-8000-0000000000a2', '5c0d0000-0000-4000-8000-0000000000a2', null),
  ('ec0d0000-0000-4000-8000-0000000000a3', '5c0d0000-0000-4000-8000-0000000000a3', null);

insert into public.user_roles (user_id, role) values
  ('5c0d0000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c0d0000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01B: o admin desta fixture TEM fator verificado. Assim "admin em AAL1" segue significando
-- TOTP pendente, que continua negado (conta SEM fator em AAL1 é coberta por 032_mfa_opcional.sql).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01B', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin';

insert into public.clients (id, name) values ('5c0dc000-0000-4000-8000-0000000000ca', 'C05B3b cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5c0dd000-0000-4000-8000-00000000000a', '5c0dc000-0000-4000-8000-0000000000ca', 'K C05B3b', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c0df000-0000-4000-8000-000000000001', 'C05B3b colaborador', 80);

-- ON: operação SEM contrato (valor acordado 250); OK: operação COM contrato
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c0de000-0000-4000-8000-0000000000a1', '5c0dc000-0000-4000-8000-0000000000ca', null, 'ON sem contrato', 250),
  ('5c0de000-0000-4000-8000-0000000000a2', '5c0dc000-0000-4000-8000-0000000000ca', null, 'ON2 sem contrato', 300),
  ('5c0de000-0000-4000-8000-0000000000b1', '5c0dc000-0000-4000-8000-0000000000ca', '5c0dd000-0000-4000-8000-00000000000a', 'OK com contrato', null);
-- S1 usado (por ON), S2 sem uso, S3 usado (por ON2)
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5c0da000-0000-4000-8000-000000000001', '5c0de000-0000-4000-8000-0000000000a1', 'S1', '06:00', '15:00', 60),
  ('5c0da000-0000-4000-8000-000000000002', '5c0de000-0000-4000-8000-0000000000a1', 'S2', '07:00', '16:00', 60),
  ('5c0da000-0000-4000-8000-000000000003', '5c0de000-0000-4000-8000-0000000000a2', 'S3', '06:00', '15:00', 60);
insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('5c0db000-0000-4000-8000-000000000001', '5c0de000-0000-4000-8000-0000000000a1', '5c0da000-0000-4000-8000-000000000001', date '2026-01-15'),
  ('5c0db000-0000-4000-8000-000000000002', '5c0de000-0000-4000-8000-0000000000a1', '5c0da000-0000-4000-8000-000000000001', date '2026-01-16'),
  ('5c0db000-0000-4000-8000-000000000003', '5c0de000-0000-4000-8000-0000000000a2', '5c0da000-0000-4000-8000-000000000003', date '2026-01-15');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
  ('5c0db100-0000-4000-8000-000000000001', '5c0db000-0000-4000-8000-000000000001', '5c0df000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60),
  ('5c0db100-0000-4000-8000-000000000002', '5c0db000-0000-4000-8000-000000000002', '5c0df000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60),
  ('5c0db100-0000-4000-8000-000000000003', '5c0db000-0000-4000-8000-000000000003', '5c0df000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);

create temporary table _base on commit drop as
select (select md5(string_agg(o::text, ';' order by o.id)) from public.operations o) as operacoes,
       (select md5(string_agg(c::text, ';' order by c.id)) from public.contracts c) as contratos,
       (select md5(string_agg(s::text, ';' order by s.id)) from public.shifts s) as turnos,
       (select md5(string_agg(t::text, ';' order by t.id)) from public.timesheets t) as folhas;
create temporary table _entradas_antes on commit drop as
select id, to_jsonb(te) as linha from public.timesheet_entries te;

select pg_temp.registrar('R0. operação SEM contrato derivada como sempre: diária = valor acordado 250; 250 + 2h*31,25 = 312,50; custo 80 + 2h*10 = 100,00',
  '312.50|100.00|250.00', (select billed_amount::text || '|' || cost_amount::text || '|' || daily_rate_snapshot::text from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- A..G. Operação sem contrato: registro, vigência futura, adjacência, sobreposição,
--       inválidos, retroativo, correção, encerramento e aposentadoria
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. admin AAL2 registra a primeira vigência do valor acordado (T1: 01/01/2026, aberta, 100)', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a1', date '2026-01-01', 100, 'Valor inicial')$q$));
select pg_temp.registrar('A2. a versão nasce ativa, aberta, origem informada, com o autor e o motivo',
  'true|nulo|informada|5c0d0000-0000-4000-8000-0000000000a1|Valor inicial|100.00',
  (select active::text || '|' || coalesce(valid_to::text, 'nulo') || '|' || origin || '|' || created_by::text || '|' || reason || '|' || agreed_amount::text
     from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01'));
select pg_temp.registrar('A3. gravou o evento de auditoria (entidade operacao, ator, valores novos, motivo)',
  '1|operacao_valor_registrado|operacao|5c0d0000-0000-4000-8000-0000000000a1|100.00|Valor inicial',
  (select count(*)::text || '|' || min(action) || '|' || min(entity_kind) || '|' || min(actor_id::text) || '|' || min(new ->> 'agreed_amount') || '|' || min(reason)
     from public.financial_terms_audit where entity_id = '5c0de000-0000-4000-8000-0000000000a1'));

select pg_temp.registrar('B1. nova versão aberta sobre a aberta, sem pedir para encerrar: 23P01', 'erro 23P01',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a1', date '2040-01-01', 130, 'Reajuste 2040')$q$));
select pg_temp.registrar('B2. com p_encerrar_anterior a futura (T2: 01/01/2040) é aceita', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a1', date '2040-01-01', 130, 'Reajuste 2040', null, true)$q$));
select pg_temp.registrar('B3. T1 foi encerrada na data inicial de T2 (fim exclusivo)', '2040-01-01',
  (select valid_to::text from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01'));
select pg_temp.registrar('B4. o encerramento automático ficou na trilha, com valores anteriores e novos', '1|nulo|2040-01-01',
  (select count(*)::text || '|' || coalesce(min(previous ->> 'valid_to'), 'nulo') || '|' || min(new ->> 'valid_to')
     from public.financial_terms_audit where action = 'operacao_valor_encerrado' and entity_id = '5c0de000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('C1. versão retroativa ADJACENTE antes de T1 ([01/12/2025, 01/01/2026), 90) é aceita', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a1', date '2025-12-01', 90, 'Histórico informado pelo administrador', date '2026-01-01')$q$));
select pg_temp.registrar('C2. o evento marca a retroativa; a futura não é retroativa', 'true|false',
  (select (select new ->> 'retroativa' from public.financial_terms_audit where action = 'operacao_valor_registrado' and new ->> 'valid_from' = '2025-12-01')
       || '|' || (select new ->> 'retroativa' from public.financial_terms_audit where action = 'operacao_valor_registrado' and new ->> 'valid_from' = '2040-01-01')));
select pg_temp.registrar('D1. versão que sobrepõe T1 ([01/03, 01/04/2026)): 23P01', 'erro 23P01',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a1', date '2026-03-01', 111, 'x', date '2026-04-01')$q$));
select pg_temp.registrar('D2. versão que cobre várias existentes: 23P01', 'erro 23P01',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a1', date '2025-06-01', 111, 'x', date '2045-01-01')$q$));
select pg_temp.registrar('D3. as mesmas datas em OUTRA operação são válidas', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2026-03-01', 310, 'Operação 2', date '2026-04-01')$q$));
select pg_temp.registrar('D4. depois das recusas só existem T0, T1 e T2 na operação', '3',
  (select count(*)::text from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1'));

select pg_temp.registrar('E1. fim igual ao início: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-01-01', 100, 'x', date '2030-01-01')$q$));
select pg_temp.registrar('E2. fim antes do início: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-02-01', 100, 'x', date '2030-01-01')$q$));
select pg_temp.registrar('E3. valor negativo: 23514', 'erro 23514',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-01-01', -1, 'x')$q$));
select pg_temp.registrar('E4. três casas decimais: 22023 (nada de arredondar em silêncio)', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-01-01', 100.005, 'x')$q$));
select pg_temp.registrar('E5. motivo em branco: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-01-01', 100, '   ')$q$));
select pg_temp.registrar('E6. motivo nulo: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-01-01', 100, null)$q$));
select pg_temp.registrar('E7. início nulo: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', null, 100, 'x')$q$));
select pg_temp.registrar('E8. valor nulo: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2030-01-01', null, 'x')$q$));
select pg_temp.registrar('E9. operação inexistente: P0002', 'erro P0002',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000ff', date '2030-01-01', 100, 'x')$q$));
select pg_temp.registrar('E10. motivo acima de 1000 caracteres: 22023', 'erro 22023',
  pg_temp.adm(format('public.registrar_valor_acordado_operacao(%L, date %L, 100, %L)', '5c0de000-0000-4000-8000-0000000000a2', '2030-01-01', repeat('x', 1001))));
select pg_temp.registrar('E11. nenhuma recusa gravou versão nem auditoria na operação 2 (só D3)', '1|1',
  (select (select count(*) from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a2')::text || '|'
       || (select count(*) from public.financial_terms_audit where entity_id = '5c0de000-0000-4000-8000-0000000000a2')::text));
select pg_temp.registrar('E12. operação COM contrato também aceita histórico de valor acordado (a escolha da fonte é da derivação)', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000b1', date '2026-01-01', 50, 'Histórico antes do contrato')$q$));

do $g$
declare
  _t0 uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2025-12-01');
  _t1 uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01');
  _b  uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a2' and valid_from = date '2026-03-01');
  _novo uuid;
begin
  perform pg_temp.registrar('G1. corrigir T0 (90 -> 95, mesmo intervalo)', '1',
    pg_temp.adm(format('public.corrigir_valor_acordado_operacao(%L, date %L, date %L, 95, %L)', _t0, '2025-12-01', '2026-01-01', 'Valor lançado errado')));
  select id into _novo from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2025-12-01' and active;
  perform pg_temp.registrar('G2. a antiga ficou aposentada com data e sucessora; a nova é origem correcao', 'false|true|true|correcao|95.00',
    (select a.active::text || '|' || (a.retired_at is not null)::text || '|' || (a.replaced_by = n.id)::text || '|' || n.origin || '|' || n.agreed_amount::text
       from public.operation_terms a, public.operation_terms n where a.id = _t0 and n.id = _novo));
  perform pg_temp.registrar('G3. a trilha guarda a correção com valores anteriores e novos e o motivo', '90.00|95.00|Valor lançado errado',
    (select (previous ->> 'agreed_amount') || '|' || (new ->> 'agreed_amount') || '|' || reason
       from public.financial_terms_audit where action = 'operacao_valor_corrigido' and entity_id = '5c0de000-0000-4000-8000-0000000000a1'));
  perform pg_temp.registrar('G4. a consulta na data devolve a corrigida, nunca a aposentada', '95.00',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', '5c0de000-0000-4000-8000-0000000000a1', '2025-12-15')));
  perform pg_temp.registrar('G5. corrigir para um intervalo que sobrepõe outra versão ativa: 23P01', 'erro 23P01',
    pg_temp.adm(format('public.corrigir_valor_acordado_operacao(%L, date %L, null, 100, %L)', _t1, '2025-12-15', 'x')));
  perform pg_temp.registrar('G6. a recusa não deixou a versão pela metade (T1 ativa, sem sucessora)', 'true|nulo',
    (select active::text || '|' || coalesce(replaced_by::text, 'nulo') from public.operation_terms where id = _t1));
  perform pg_temp.registrar('G7. versão aposentada não pode ser corrigida: 55000', 'erro 55000',
    pg_temp.adm(format('public.corrigir_valor_acordado_operacao(%L, date %L, date %L, 99, %L)', _t0, '2025-12-01', '2026-01-01', 'x')));
  perform pg_temp.registrar('G8. versão inexistente: P0002', 'erro P0002',
    pg_temp.adm(format('public.corrigir_valor_acordado_operacao(%L, date %L, null, 99, %L)', '5c0de000-0000-4000-8000-0000000000fe', '2030-01-01', 'x')));
  perform pg_temp.registrar('G9. encerrar a versão da operação 2 antes do fim atual ([01/03, 01/04) -> 15/03)', '1',
    pg_temp.adm(format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _b, '2026-03-15', 'Operação encerrou antes')));
  perform pg_temp.registrar('G10. o fim ficou em 15/03', '2026-03-15', (select valid_to::text from public.operation_terms where id = _b));
  perform pg_temp.registrar('G11. estender a data final não é encerrar: 22023', 'erro 22023',
    pg_temp.adm(format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _b, '2026-03-20', 'x')));
  perform pg_temp.registrar('G12. fim no início da vigência: 22023', 'erro 22023',
    pg_temp.adm(format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _b, '2026-03-01', 'x')));
  perform pg_temp.registrar('G13. aposentar uma versão sem apontamentos', '1',
    pg_temp.adm(format('public.aposentar_valor_acordado_operacao(%L, %L)', _b, 'Lançada na operação errada')));
  perform pg_temp.registrar('G14. ficou inativa, com data, sem sucessora', 'false|true|nulo',
    (select active::text || '|' || (retired_at is not null)::text || '|' || coalesce(replaced_by::text, 'nulo') from public.operation_terms where id = _b));
  perform pg_temp.registrar('G15. aposentar de novo: 55000', 'erro 55000',
    pg_temp.adm(format('public.aposentar_valor_acordado_operacao(%L, %L)', _b, 'x')));
  perform pg_temp.registrar('G16. encerrar versão aposentada: 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _b, '2026-03-10', 'x')));
  perform pg_temp.registrar('G17. a faixa aposentada fica livre para uma nova vigência (315)', '1',
    pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c0de000-0000-4000-8000-0000000000a2', date '2026-03-01', 315, 'Refeita', date '2026-04-01')$q$));
  perform pg_temp.registrar('G18. a trilha da operação 2: registro, encerramento, aposentadoria e novo registro',
    'operacao_valor_aposentado,operacao_valor_encerrado,operacao_valor_registrado,operacao_valor_registrado',
    (select string_agg(action, ',' order by action) from public.financial_terms_audit where entity_id = '5c0de000-0000-4000-8000-0000000000a2'));
end;
$g$;

-- ---------------------------------------------------------------------------
-- H..L. Quem pode
-- ---------------------------------------------------------------------------

do $auth$
declare
  _a1 constant text := '5c0d0000-0000-4000-8000-0000000000a1';
  _a2 constant text := '5c0d0000-0000-4000-8000-0000000000a2';
  _a3 constant text := '5c0d0000-0000-4000-8000-0000000000a3';
  _t1 uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01');
  _chamadas text[];
  _c text;
  _n int := 0;
begin
  _chamadas := array[
    format('public.registrar_valor_acordado_operacao(%L, date %L, 100, %L)', '5c0de000-0000-4000-8000-0000000000a2', '2031-01-01', 'x'),
    format('public.corrigir_valor_acordado_operacao(%L, date %L, null, 100, %L)', _t1, '2026-01-01', 'x'),
    format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _t1, '2030-01-01', 'x'),
    format('public.aposentar_valor_acordado_operacao(%L, %L)', _t1, 'x'),
    format('public.valor_acordado_operacao_na_data(%L, date %L)', '5c0de000-0000-4000-8000-0000000000a1', '2026-02-01')
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
        jsonb_build_object('sub', _a1, 'role', 'authenticated', 'aal', 'aal2', 'session_id', 'ec0d0000-0000-4000-8000-0000000000ff'),
        format('select count(*)::text from (select %s) x', _c)));
    perform pg_temp.registrar(format('L5. RPC %s: admin AAL2 sem claim aal recusado (42501)', _n), 'erro 42501',
      pg_temp.medir_como('authenticated',
        jsonb_build_object('sub', _a1, 'role', 'authenticated', 'session_id', 'ec0d0000-0000-4000-8000-0000000000a1'),
        format('select count(*)::text from (select %s) x', _c)));
  end loop;
  update auth.users set banned_until = now() + interval '1 day' where id = _a1::uuid;
  perform pg_temp.registrar('L6. admin AAL2 com conta banida recusado (42501)', 'erro 42501', pg_temp.chamar(_a1, 'aal2', _chamadas[5]));
  update auth.users set banned_until = null where id = _a1::uuid;
  perform pg_temp.registrar('L7. e voltando a conta ao normal ele volta a poder', '1', pg_temp.chamar(_a1, 'aal2', _chamadas[5]));
  perform pg_temp.registrar('L8. nenhuma tentativa recusada gravou versão (nada em 2031)', '0',
    (select count(*)::text from public.operation_terms where valid_from = date '2031-01-01'));
end;
$auth$;

-- ---------------------------------------------------------------------------
-- M. Escrita direta
-- ---------------------------------------------------------------------------

select pg_temp.registrar('M1. admin AAL2 NÃO insere versão pela API', 'erro 42501',
  pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal2',
    $q$with i as (insert into public.operation_terms (operation_id, valid_from, agreed_amount, origin, reason) values ('5c0de000-0000-4000-8000-0000000000a2', date '2050-01-01', 1, 'informada', 'x') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('M2. admin AAL2 NÃO altera versão pela API', 'erro 42501',
  pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal2', $q$with u as (update public.operation_terms set agreed_amount = 1 returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('M3. admin AAL2 NÃO apaga versão pela API', 'erro 42501',
  pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal2', $q$with d as (delete from public.operation_terms returning 1) select count(*)::text from d$q$));
select pg_temp.registrar('M4. admin AAL2 NÃO forja evento na trilha com a entidade operacao', 'erro 42501',
  pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal2',
    $q$with i as (insert into public.financial_terms_audit (actor_id, action, entity_kind, entity_id, term_id, reason) values ('5c0d0000-0000-4000-8000-0000000000a1', 'operacao_valor_registrado', 'operacao', '5c0de000-0000-4000-8000-0000000000a1', '5c0de000-0000-4000-8000-0000000000a1', 'forjado') returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('M5. anônimo não lê as versões', 'erro 42501',
  pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), 'select count(*)::text from public.operation_terms'));
select pg_temp.registrar('M6. operacional, admin AAL1 e sem papel leem zero versões; admin AAL2 lê', '0|0|0|true',
  pg_temp.como('5c0d0000-0000-4000-8000-0000000000a2', 'aal2', 'select count(*)::text from public.operation_terms')
  || '|' || pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal1', 'select count(*)::text from public.operation_terms')
  || '|' || pg_temp.como('5c0d0000-0000-4000-8000-0000000000a3', 'aal2', 'select count(*)::text from public.operation_terms')
  || '|' || pg_temp.adm_valor('select (count(*) > 0)::text from public.operation_terms'));

-- ---------------------------------------------------------------------------
-- O. Consulta por work_date
-- ---------------------------------------------------------------------------

do $o$
declare
  _a constant text := '5c0de000-0000-4000-8000-0000000000a1';
  _b constant text := '5c0de000-0000-4000-8000-0000000000a2';
begin
  perform pg_temp.registrar('O1. um dia antes do primeiro histórico: ZERO linhas (nada de agreed_amount)', 'nulo',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _a, '2025-11-30')));
  perform pg_temp.registrar('O2. início de T0 (fronteira inclusiva)', '95.00',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _a, '2025-12-01')));
  perform pg_temp.registrar('O3. 01/01/2026 pertence a T1, que COMEÇA nele', '100.00',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _a, '2026-01-01')));
  perform pg_temp.registrar('O4. último dia de T1', '100.00',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _a, '2039-12-31')));
  perform pg_temp.registrar('O5. início de T2 e qualquer data futura (aberta)', '130.00|130.00',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _a, '2040-01-01'))
    || '|' || pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _a, '2099-01-01')));
  perform pg_temp.registrar('O6. lacuna da operação 2 (28/02) e fim exclusivo (01/04): zero linhas; 31/03 = 315', 'nulo|nulo|315.00',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _b, '2026-02-28'))
    || '|' || pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _b, '2026-04-01'))
    || '|' || pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L)', _b, '2026-03-31')));
  perform pg_temp.registrar('O7. o agreed_amount atual (250/300) não aparece em consulta nenhuma de data sem histórico', 'nulo',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, date %L) where agreed_amount in (250, 300)', _a, '2025-11-30')));
  perform pg_temp.registrar('O8. a função interna levanta P0002 sem histórico', 'P0002',
    pg_temp.erro_de(format('select (public.exigir_valor_acordado_operacao_na_data(%L, date %L)).id', _a, '2025-11-30')));
  perform pg_temp.registrar('O9. a interna devolve a versão quando há histórico', '100.00',
    pg_temp.valor_de(format('select (public.exigir_valor_acordado_operacao_na_data(%L, date %L)).agreed_amount::text', _a, '2026-06-01')));
  perform pg_temp.registrar('O10. admin AAL2 NÃO executa a interna (sem EXECUTE)', 'erro 42501',
    pg_temp.adm_valor(format('select (public.exigir_valor_acordado_operacao_na_data(%L, date %L)).id::text', _a, '2026-06-01')));
  perform pg_temp.registrar('O11. consulta com data nula: 22023', 'erro 22023',
    pg_temp.adm_valor(format('select agreed_amount::text from public.valor_acordado_operacao_na_data(%L, null)', _a)));
end;
$o$;

-- ---------------------------------------------------------------------------
-- P. Imutabilidade e trilha
-- ---------------------------------------------------------------------------

do $p$
declare
  _t1  uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01');
  _t0v uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2025-12-01' and not active);
begin
  perform pg_temp.registrar('P1. valor da versão não muda (nem para o dono)', '42501', pg_temp.erro_de(format('update public.operation_terms set agreed_amount = 1 where id = %L', _t1)));
  perform pg_temp.registrar('P2. início da vigência não muda', '42501', pg_temp.erro_de(format('update public.operation_terms set valid_from = date %L where id = %L', '2026-01-02', _t1)));
  perform pg_temp.registrar('P3. motivo não muda', '42501', pg_temp.erro_de(format('update public.operation_terms set reason = %L where id = %L', 'reescrito', _t1)));
  perform pg_temp.registrar('P4. operação da versão não muda', '42501', pg_temp.erro_de(format('update public.operation_terms set operation_id = %L where id = %L', '5c0de000-0000-4000-8000-0000000000a2', _t1)));
  perform pg_temp.registrar('P5. autoria não muda', '42501', pg_temp.erro_de(format('update public.operation_terms set created_by = null where id = %L', _t1)));
  perform pg_temp.registrar('P6. data final não se estende', '42501', pg_temp.erro_de(format('update public.operation_terms set valid_to = date %L where id = %L', '2041-01-01', _t1)));
  perform pg_temp.registrar('P7. versão aposentada não volta a ficar ativa', '42501', pg_temp.erro_de(format('update public.operation_terms set active = true, retired_at = null where id = %L', _t0v)));
  perform pg_temp.registrar('P8. sucessora já apontada não muda', '42501', pg_temp.erro_de(format('update public.operation_terms set replaced_by = null where id = %L', _t0v)));
  perform pg_temp.registrar('P9. a trilha não aceita UPDATE, DELETE nem TRUNCATE nem do dono', '42501|42501|42501',
    pg_temp.erro_de($q$update public.financial_terms_audit set reason = 'x'$q$) || '|' || pg_temp.erro_de('delete from public.financial_terms_audit') || '|' || pg_temp.erro_de('truncate public.financial_terms_audit'));
  perform pg_temp.registrar('P10. a trilha continua recusando entidade desconhecida (23514)', '23514',
    pg_temp.erro_de($q$insert into public.financial_terms_audit (actor_id, action, entity_kind, entity_id, term_id, reason) values ('5c0d0000-0000-4000-8000-0000000000a1', 'operacao_valor_registrado', 'turno', '5c0de000-0000-4000-8000-0000000000a1', '5c0de000-0000-4000-8000-0000000000a1', 'x')$q$));
  perform pg_temp.registrar('P11. e ação desconhecida (23514)', '23514',
    pg_temp.erro_de($q$insert into public.financial_terms_audit (actor_id, action, entity_kind, entity_id, term_id, reason) values ('5c0d0000-0000-4000-8000-0000000000a1', 'operacao_valor_apagado', 'operacao', '5c0de000-0000-4000-8000-0000000000a1', '5c0de000-0000-4000-8000-0000000000a1', 'x')$q$));
  perform pg_temp.registrar('P12. todas as 12 ações continuam aceitas pelo CHECK da trilha (entidades antigas e nova)', '12',
    (select count(*)::text from unnest(array['contrato_condicao_registrada', 'contrato_condicao_corrigida', 'contrato_condicao_encerrada', 'contrato_condicao_aposentada',
        'colaborador_custo_registrado', 'colaborador_custo_corrigido', 'colaborador_custo_encerrado', 'colaborador_custo_aposentado',
        'operacao_valor_registrado', 'operacao_valor_corrigido', 'operacao_valor_encerrado', 'operacao_valor_aposentado']) a
      where pg_get_constraintdef((select oid from pg_constraint where conname = 'financial_terms_audit_acao_valida')) like '%' || a || '%'));
  perform pg_temp.registrar('P13. T1 inalterada depois das recusas', '100.00|2040-01-01|true',
    (select agreed_amount::text || '|' || valid_to::text || '|' || active::text from public.operation_terms where id = _t1));
end;
$p$;

-- ---------------------------------------------------------------------------
-- Q..T. Versão referenciada, compatibilidade com contrato nulo, faturas e apontamentos antigos
-- ---------------------------------------------------------------------------

update public.timesheet_entries
   set operation_terms_id = (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01'),
       terms_origin = 'valor_acordado'
 where id in ('5c0db100-0000-4000-8000-000000000001', '5c0db100-0000-4000-8000-000000000002');

insert into public.invoices (id, client_id, period_start, period_end, status)
  values ('5c0db200-0000-4000-8000-000000000001', '5c0dc000-0000-4000-8000-0000000000ca', date '2026-01-01', date '2026-01-31', 'closed');
update public.timesheet_entries set invoice_id = '5c0db200-0000-4000-8000-000000000001' where id = '5c0db100-0000-4000-8000-000000000002';

create temporary table _antes_q on commit drop as
select (select md5(string_agg(te::text, ';' order by te.id)) from public.timesheet_entries te) as apontamentos,
       (select md5(i::text) from public.invoices i where i.id = '5c0db200-0000-4000-8000-000000000001') as fatura;

do $q$
declare
  _t1 uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a1' and valid_from = date '2026-01-01');
begin
  perform pg_temp.registrar('Q1. versão referenciada NÃO pode ser apagada (23503)', '23503', pg_temp.erro_de(format('delete from public.operation_terms where id = %L', _t1)));
  perform pg_temp.registrar('Q2. aposentar versão referenciada: 55000', 'erro 55000', pg_temp.adm(format('public.aposentar_valor_acordado_operacao(%L, %L)', _t1, 'x')));
  perform pg_temp.registrar('Q3. encerrar antes de um apontamento que a usa (10/01): 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _t1, '2026-01-10', 'x')));
  perform pg_temp.registrar('Q4. encerrar no mesmo dia de um apontamento que a usa (16/01): 55000', 'erro 55000',
    pg_temp.adm(format('public.encerrar_valor_acordado_operacao(%L, date %L, %L)', _t1, '2026-01-16', 'x')));
  perform pg_temp.registrar('Q5. corrigir deixando um apontamento de fora: 55000', 'erro 55000',
    pg_temp.adm(format('public.corrigir_valor_acordado_operacao(%L, date %L, date %L, 101, %L)', _t1, '2026-01-16', '2040-01-01', 'x')));
  perform pg_temp.registrar('Q6. as recusas não mudaram nada (apontamentos e fatura)', 'true',
    (select (a.apontamentos = (select md5(string_agg(te::text, ';' order by te.id)) from public.timesheet_entries te)
             and a.fatura = (select md5(i::text) from public.invoices i where i.id = '5c0db200-0000-4000-8000-000000000001'))::text from _antes_q a));
  perform pg_temp.registrar('Q7. corrigir cobrindo todas as datas referenciadas é aceito (valor 101)', '1',
    pg_temp.adm(format('public.corrigir_valor_acordado_operacao(%L, date %L, date %L, 101, %L)', _t1, '2026-01-01', '2040-01-01', 'Valor corrigido depois de referenciado')));
  perform pg_temp.registrar('Q8. T1 aposentada com sucessora e SEGUE referenciada pelos 2 apontamentos', 'false|true|true',
    (select active::text || '|' || (replaced_by is not null)::text || '|' || ((select count(*) from public.timesheet_entries where operation_terms_id = _t1) = 2)::text
       from public.operation_terms where id = _t1));
  perform pg_temp.registrar('Q9. mesmo aposentada, não pode ser apagada (23503)', '23503', pg_temp.erro_de(format('delete from public.operation_terms where id = %L', _t1)));
end;
$q$;

select pg_temp.registrar('R1. o apontamento antigo mantém os valores derivados de sempre depois de todas as RPCs (312,50 / 100,00)', '312.50|100.00',
  (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000001'));

do $r$
declare _u text; _v text;
begin
  _u := pg_temp.adm_valor($q$with u as (update public.timesheet_entries set check_out = '18:00' where id = '5c0db100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$);
  select billed_amount::text || '|' || cost_amount::text into _v from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000001';
  perform pg_temp.registrar('R2. editar o horário recalcula com o agreed_amount ATUAL (250), como antes: 250 + 3h*31,25 = 343,75; custo 110,00 (as versões 100/130 não interferem)',
    '1|343.75|110.00', _u || '|' || _v);
  _u := pg_temp.adm_valor($q$with u as (update public.operations set agreed_amount = 260 where id = '5c0de000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$);
  perform pg_temp.registrar('R3. a edição direta de operations.agreed_amount pela tela segue funcionando (transitório)', '1', _u);
  _u := pg_temp.adm_valor($q$with u as (update public.timesheet_entries set check_out = '17:30' where id = '5c0db100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$);
  select billed_amount::text || '|' || cost_amount::text into _v from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000001';
  perform pg_temp.registrar('R4. e o recálculo seguinte usa o novo valor ATUAL (260): 260 + 2,5h*32,50 = 341,25; custo 105,00', '1|341.25|105.00', _u || '|' || _v);
end;
$r$;

select pg_temp.registrar('R5. contratos, turnos e folhas não foram tocados pelas RPCs', 'true',
  (select (b.contratos = (select md5(string_agg(c::text, ';' order by c.id)) from public.contracts c)
       and b.turnos = (select md5(string_agg(s::text, ';' order by s.id)) from public.shifts s)
       and b.folhas = (select md5(string_agg(t::text, ';' order by t.id)) from public.timesheets t))::text from _base b));
select pg_temp.registrar('R6. nas operações só mudou o agreed_amount que o teste alterou de propósito (ON: 250 -> 260)', '260.00|300.00|nulo',
  (select (select agreed_amount::text from public.operations where id = '5c0de000-0000-4000-8000-0000000000a1') || '|'
       || (select agreed_amount::text from public.operations where id = '5c0de000-0000-4000-8000-0000000000a2') || '|'
       || (select coalesce(agreed_amount::text, 'nulo') from public.operations where id = '5c0de000-0000-4000-8000-0000000000b1')));
do $r7$
begin
  insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
    values ('5c0da000-0000-4000-8000-0000000000c1', '5c0de000-0000-4000-8000-0000000000b1', 'SK', '06:00', '15:00', 60);
  insert into public.timesheets (id, operation_id, shift_id, work_date)
    values ('5c0db000-0000-4000-8000-0000000000c1', '5c0de000-0000-4000-8000-0000000000b1', '5c0da000-0000-4000-8000-0000000000c1', date '2026-01-20');
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c0db100-0000-4000-8000-0000000000c1', '5c0db000-0000-4000-8000-0000000000c1', '5c0df000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);
  perform pg_temp.registrar('R7. operação COM contrato deriva do contrato (120 + 2h*22,50 = 165,00; custo 100,00) mesmo com versão de valor acordado (50) cadastrada', '165.00|100.00',
    (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0db100-0000-4000-8000-0000000000c1'));
end;
$r7$;

select pg_temp.registrar('S1. a fatura existente continua idêntica', 'true',
  (select (a.fatura = (select md5(i::text) from public.invoices i where i.id = '5c0db200-0000-4000-8000-000000000001'))::text from _antes_q a));
select pg_temp.registrar('S2. o apontamento faturado mantém vínculo e valores', '5c0db200-0000-4000-8000-000000000001|312.50|100.00',
  (select invoice_id::text || '|' || billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000002'));
select pg_temp.registrar('S3. e continua imutável para o admin', 'erro 42501',
  pg_temp.adm_valor($q$with u as (update public.timesheet_entries set notes = 'y' where id = '5c0db100-0000-4000-8000-000000000002' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('S4. nenhuma RPC criou fatura nem item', '1|0',
  (select (select count(*) from public.invoices where client_id = '5c0dc000-0000-4000-8000-0000000000ca')::text || '|' || (select count(*) from public.invoice_items where invoice_id = '5c0db200-0000-4000-8000-000000000001')::text));
select pg_temp.registrar('T1. o apontamento da operação 2 (nunca tocado) está idêntico ao de antes', 'true',
  (select (a.linha = to_jsonb(te))::text from _entradas_antes a join public.timesheet_entries te on te.id = a.id where a.id = '5c0db100-0000-4000-8000-000000000003'));
select pg_temp.registrar('T2. o apontamento 1 só diferiu no que o teste mudou de propósito (referência, horário e valores recalculados)', 'true',
  (select (count(*) = 0)::text from (
     select a.linha - array['operation_terms_id', 'terms_origin', 'invoice_id', 'billed_amount', 'cost_amount', 'check_out', 'worked_minutes', 'overtime_minutes', 'daily_rate_snapshot', 'ot_hour_rate_snapshot', 'updated_at'] as antes,
            to_jsonb(te) - array['operation_terms_id', 'terms_origin', 'invoice_id', 'billed_amount', 'cost_amount', 'check_out', 'worked_minutes', 'overtime_minutes', 'daily_rate_snapshot', 'ot_hour_rate_snapshot', 'updated_at'] as depois
       from _entradas_antes a join public.timesheet_entries te on te.id = a.id where a.id <> '5c0db100-0000-4000-8000-000000000003') x
   where x.antes is distinct from x.depois));
select pg_temp.registrar('T3. nenhuma outra coluna de condições foi preenchida por RPC', '0',
  (select count(*)::text from public.timesheet_entries
    where contract_terms_id is not null or employee_cost_terms_id is not null or shift_hours_snapshot is not null or ot_factor_snapshot is not null
       or ot_tolerance_snapshot is not null or planned_minutes_snapshot is not null));

-- ---------------------------------------------------------------------------
-- U. A coluna operation_terms_id só é preenchida pelo sistema
-- ---------------------------------------------------------------------------

do $u$
declare
  _vig uuid := (select id from public.operation_terms where operation_id = '5c0de000-0000-4000-8000-0000000000a2' and active limit 1);
  _r text; _v text;
begin
  perform pg_temp.registrar('U1. admin AAL2 NÃO cria apontamento com operation_terms_id', 'erro 42501',
    pg_temp.adm_valor(format($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes, operation_terms_id) values ('5c0db100-0000-4000-8000-0000000000e1', '5c0db000-0000-4000-8000-000000000003', '5c0df000-0000-4000-8000-000000000001', 'present', '06:00', '15:00', 60, %L) returning 1) select count(*)::text from i$q$, _vig)));
  perform pg_temp.registrar('U2. admin AAL2 NÃO altera a referência de um apontamento existente', 'erro 42501',
    pg_temp.adm_valor(format($q$with u as (update public.timesheet_entries set operation_terms_id = %L where id = '5c0db100-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$, _vig)));
  perform pg_temp.registrar('U3. o sistema (postgres) preenche', 'sem erro',
    pg_temp.erro_de(format($q$update public.timesheet_entries set operation_terms_id = %L, terms_origin = 'valor_acordado' where id = '5c0db100-0000-4000-8000-000000000003'$q$, _vig)));
  perform pg_temp.registrar('U4. admin AAL2 NÃO apaga a referência (voltar a NULL também é alteração)', 'erro 42501',
    pg_temp.adm_valor($q$with u as (update public.timesheet_entries set operation_terms_id = null where id = '5c0db100-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('U5. reenviar o MESMO valor junto de uma edição legítima não é recusado (a tela reenvia o objeto inteiro)', '1',
    pg_temp.adm_valor(format($q$with u as (update public.timesheet_entries set operation_terms_id = %L, notes = 'ok' where id = '5c0db100-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$, _vig)));
  _r := pg_temp.adm_valor($q$with u as (update public.timesheet_entries set check_out = '18:00' where id = '5c0db100-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$);
  select billed_amount::text || '|' || cost_amount::text into _v from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000003';
  perform pg_temp.registrar('U6. o recálculo do apontamento da operação 2 segue o agreed_amount ATUAL (300) e ignora a versão (315): 300 + 3h*37,50 = 412,50; custo 110,00', '1|412.50|110.00', _r || '|' || _v);
end;
$u$;

-- ---------------------------------------------------------------------------
-- W. Turnos: o congelamento nasce DESABILITADO; habilitado, protege só a jornada de turno usado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('W1. o trigger de congelamento existe e está DESABILITADO', 'D',
  (select tgenabled::text from pg_trigger where tgname = 'trg_shifts_congela_jornada_usada' and not tgisinternal));
select pg_temp.registrar('W2. DESABILITADO, o formulário atual funciona: admin muda o horário de um turno USADO (S1: fim 15:00 -> 15:30)', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '15:30' where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
update public.shifts set end_time = '15:00' where id = '5c0da000-0000-4000-8000-000000000001';

alter table public.shifts enable trigger trg_shifts_congela_jornada_usada;

select pg_temp.registrar('W3. habilitado: mudar o fim de turno USADO é recusado (23514)', 'erro 23514',
  pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '15:30' where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W4. mudar o início: 23514', 'erro 23514',
  pg_temp.adm_valor($q$with u as (update public.shifts set start_time = '05:00' where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W5. mudar o intervalo: 23514', 'erro 23514',
  pg_temp.adm_valor($q$with u as (update public.shifts set break_minutes = 30 where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W6. mudar a virada de meia-noite: 23514', 'erro 23514',
  pg_temp.adm_valor($q$with u as (update public.shifts set crosses_midnight = true where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W7. o nome continua editável no turno usado', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set name = 'S1 renomeado' where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W8. o status continua editável (inativar o turno antigo)', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set status = 'inactive' where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W9. a tela reenvia o objeto inteiro com o MESMO horário: aceito', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set name = 'S1', start_time = '06:00:00', end_time = '15:00:00', break_minutes = 60, crosses_midnight = false, status = 'active' where id = '5c0da000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W10. turno SEM uso continua com horário editável', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '16:30' where id = '5c0da000-0000-4000-8000-000000000002' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W11. cadastrar um turno novo na mesma operação é livre', '1',
  pg_temp.adm_valor($q$with i as (insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values ('5c0da000-0000-4000-8000-0000000000e9', '5c0de000-0000-4000-8000-0000000000a1', 'S novo', '06:30', '15:30', 60) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('W12. operacional não enxerga turno (RLS): a mudança de jornada afeta ZERO linhas, como antes', '0',
  pg_temp.como('5c0d0000-0000-4000-8000-0000000000a2', 'aal2', $q$with u as (update public.shifts set end_time = '15:30' where id = '5c0da000-0000-4000-8000-000000000002' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('W13. o sistema (postgres) é isento, como nas outras proteções', 'sem erro',
  pg_temp.erro_de($q$update public.shifts set end_time = '15:10' where id = '5c0da000-0000-4000-8000-000000000001'$q$));
select pg_temp.registrar('W14. as recusas não alteraram o apontamento nem a jornada gravada', '312.50|100.00|15:10:00',
  (select (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0db100-0000-4000-8000-000000000002') || '|' || (select end_time::text from public.shifts where id = '5c0da000-0000-4000-8000-000000000001')));

alter table public.shifts disable trigger trg_shifts_congela_jornada_usada;
select pg_temp.registrar('W15. desabilitar de novo restaura o estado entregue', 'D',
  (select tgenabled::text from pg_trigger where tgname = 'trg_shifts_congela_jornada_usada' and not tgisinternal));

-- ---------------------------------------------------------------------------
-- V. Inventário e compatibilidade com a 022 e a 023
-- ---------------------------------------------------------------------------

select pg_temp.registrar('V1. as 5 RPCs de API executam só para authenticated (nunca anon, service_role, PUBLIC nem o papel operacional)', '5',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('registrar_valor_acordado_operacao', 'corrigir_valor_acordado_operacao', 'encerrar_valor_acordado_operacao', 'aposentar_valor_acordado_operacao', 'valor_acordado_operacao_na_data')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')
      and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)));
select pg_temp.registrar('V2. as 2 internas não executam para nenhum papel de API', '0',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('exigir_valor_acordado_operacao_na_data', 'condicoes_encerrar_operacao_interno')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE'))));
select pg_temp.registrar('V3. as 7 funções SECURITY DEFINER novas são do postgres, com search_path fixo', '7',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proowner = 'postgres'::regrole
      and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%'
      and p.proname in ('registrar_valor_acordado_operacao', 'corrigir_valor_acordado_operacao', 'encerrar_valor_acordado_operacao', 'aposentar_valor_acordado_operacao',
                        'valor_acordado_operacao_na_data', 'exigir_valor_acordado_operacao_na_data', 'condicoes_encerrar_operacao_interno')));
select pg_temp.registrar('V4. timesheet_entries: 10 triggers originais + guard da 022 + guard da 024 + recusa de horário igual da 029 + folha fechada da 031 + snapshots da 040 = 15, todos habilitados', '15',
  (select count(*)::text from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass and not tgisinternal and tgenabled = 'O'));
select pg_temp.registrar('V5. shifts: 4 triggers originais + o da classificação do turno (039) habilitados + o congelamento DESABILITADO', '5|1',
  (select count(*) filter (where tgenabled = 'O')::text || '|' || count(*) filter (where tgenabled = 'D')::text from pg_trigger where tgrelid = 'public.shifts'::regclass and not tgisinternal));
select pg_temp.registrar('V6. a derivação financeira e gerar_fatura não citam as versões', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('derivar_valores_financeiros', 'gerar_fatura')
     and (prosrc ilike '%operation_terms%' or prosrc ilike '%contract_terms%' or prosrc ilike '%employee_cost_terms%')));
select pg_temp.registrar('V7. operation_terms: RLS, 2 policies, nenhuma de escrita, só SELECT para authenticated, 1 exclusão de sobreposição', 'true|2|0|true|1',
  (select (select relrowsecurity from pg_class where oid = 'public.operation_terms'::regclass)::text
       || '|' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'operation_terms')::text
       || '|' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'operation_terms' and cmd in ('INSERT', 'UPDATE', 'DELETE'))::text
       || '|' || (has_table_privilege('authenticated', 'public.operation_terms', 'SELECT') and not has_table_privilege('authenticated', 'public.operation_terms', 'INSERT')
                  and not has_table_privilege('service_role', 'public.operation_terms', 'SELECT') and not has_table_privilege('bslog_rpc_operacional', 'public.operation_terms', 'SELECT'))::text
       || '|' || (select count(*) from pg_constraint where conrelid = 'public.operation_terms'::regclass and contype = 'x')::text));
select pg_temp.registrar('V8. a 022 e a 023 seguem de pé: RPC de contrato registra e consulta depois da 024', '1|100.00',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c0dd000-0000-4000-8000-00000000000a', date '2026-01-01', 100, 8, 1.5, 10, 'smoke 023')$q$)
  || '|' || pg_temp.adm_valor($q$select daily_rate::text from public.condicao_contrato_na_data('5c0dd000-0000-4000-8000-00000000000a', date '2026-05-01')$q$));
select pg_temp.registrar('V9. operation_terms_id é anulável, sem DEFAULT, com FK NO ACTION', 'true|true|a',
  (select (not a.attnotnull)::text || '|' || (not a.atthasdef)::text || '|' || (select confdeltype::text from pg_constraint where conrelid = 'public.timesheet_entries'::regclass and confrelid = 'public.operation_terms'::regclass)
     from pg_attribute a where a.attrelid = 'public.timesheet_entries'::regclass and a.attname = 'operation_terms_id'));
select pg_temp.registrar('V10. admin AAL2 lê a trilha da operação; os demais leem zero', 'true|0|0',
  pg_temp.adm_valor($q$select (count(*) > 0)::text from public.financial_terms_audit where entity_kind = 'operacao'$q$)
  || '|' || pg_temp.como('5c0d0000-0000-4000-8000-0000000000a2', 'aal2', 'select count(*)::text from public.financial_terms_audit')
  || '|' || pg_temp.como('5c0d0000-0000-4000-8000-0000000000a1', 'aal1', 'select count(*)::text from public.financial_terms_audit'));
select pg_temp.registrar('V11. todo evento de operação tem ator, motivo e valores novos', '0',
  (select count(*)::text from public.financial_terms_audit where entity_kind = 'operacao' and (actor_id is null or btrim(reason) = '' or new is null)));

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
    raise exception '019_valores_acordados_operacao: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
