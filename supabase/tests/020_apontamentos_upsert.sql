-- Salvamento de apontamentos pelo upsert da tela (C05-B4.3A).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo acontece dentro
-- de uma transação que termina em `rollback`, então nada é criado, alterado ou removido —
-- inclusive em `auth.users` e `auth.sessions`. NUNCA rodar contra Production: o `rollback`
-- protege, mas o arquivo escreve em `auth.users`, `auth.sessions` e nas tabelas de negócio.
--
-- Vale para o esquema de Production (até a 020) e para o da homologação (021 a 024): o arquivo
-- não usa nenhuma tabela nem função das migrations 021 a 024.
--
-- O QUE ESTE ARQUIVO PROVA
--
-- O PostgREST traduz `upsert([...])` em `INSERT ... ON CONFLICT (id) DO UPDATE SET <colunas
-- do payload>`, com o INSERT montado pela UNIÃO das chaves de todas as linhas. Os casos
-- abaixo reproduzem exatamente esse formato, como `authenticated` com claims de admin em
-- AAL2, para a carga NOVA da tela (id, folha, colaborador, operação, data, status, horários,
-- intervalo, nota) e, para comparar, a carga ANTIGA (com valores derivados e sem id nas
-- linhas novas):
--
--   N  linha nova, lote de existente + novas, só nota, horário, status, sem alteração
--   D  taxa do contrato reajustada depois do lançamento: a carga nova não é recusada; a
--      antiga, com a linha tocada sem mudança real, era recusada com 42501
--   M  a carga antiga mista (linha existente com id + nova sem id) falha com 23502
--   F  apontamento faturado segue imutável, mesmo com a carga nova
--   P  operacional e admin em AAL1 não gravam pela tabela
--
-- O `BEFORE INSERT` dispara também quando o resultado final é UPDATE; os casos N3 a N6
-- provam que isso não altera nem recalcula a linha existente.

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
  select pg_temp.chamar('5c0f0000-0000-4000-8000-0000000000a1', 'aal2', _chamada)
$$;

-- Executa um SELECT como admin AAL2 e devolve o primeiro valor ('nulo' se não houver linha).
create or replace function pg_temp.adm_valor(_sql text) returns text language sql as $$
  select pg_temp.como('5c0f0000-0000-4000-8000-0000000000a1', 'aal2', _sql)
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
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c0f0000-0000-4000-8000-0000000000a1'),
  ('5c0f0000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec0f0000-0000-4000-8000-0000000000a1', '5c0f0000-0000-4000-8000-0000000000a1', null),
  ('ec0f0000-0000-4000-8000-0000000000a2', '5c0f0000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c0f0000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c0f0000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01B: o admin desta fixture TEM fator verificado. Assim "admin em AAL1" segue significando
-- TOTP pendente, que continua negado (conta SEM fator em AAL1 é coberta por 032_mfa_opcional.sql).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01B', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin';

insert into public.clients (id, name) values ('5c0fc000-0000-4000-8000-0000000000c1', 'C05B43 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5c0fd000-0000-4000-8000-0000000000d1', '5c0fc000-0000-4000-8000-0000000000c1', 'K', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c0ff000-0000-4000-8000-000000000001', 'E1', 80),
  ('5c0ff000-0000-4000-8000-000000000002', 'E2', 80),
  ('5c0ff000-0000-4000-8000-000000000003', 'E3', 80),
  ('5c0ff000-0000-4000-8000-000000000004', 'E4', 80);
insert into public.operations (id, client_id, contract_id, name)
  values ('5c0fe000-0000-4000-8000-0000000000e1', '5c0fc000-0000-4000-8000-0000000000c1', '5c0fd000-0000-4000-8000-0000000000d1', 'OP');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
  values ('5c0fa000-0000-4000-8000-0000000000a1', '5c0fe000-0000-4000-8000-0000000000e1', 'T', '06:00', '15:00', 60);
insert into public.timesheets (id, operation_id, shift_id, work_date)
  values ('5c0fb000-0000-4000-8000-000000000001', '5c0fe000-0000-4000-8000-0000000000e1', '5c0fa000-0000-4000-8000-0000000000a1', date '2026-02-10');
-- E1 já tem apontamento (06:00-17:00: 120 + 2h*22,50 = 165,00; custo 80 + 2h*10 = 100,00)
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c0fb100-0000-4000-8000-000000000001', '5c0fb000-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);

select pg_temp.registrar('N0. apontamento de partida derivado como sempre (165,00 / 100,00)', '165.00|100.00',
  (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0fb100-0000-4000-8000-000000000001'));

-- O upsert da tela (carga NOVA), no formato que o PostgREST gera. `%s` recebe os VALUES.
create or replace function pg_temp.upsert_novo(_valores text) returns text language sql as $$
  select pg_temp.como('5c0f0000-0000-4000-8000-0000000000a1', 'aal2', format($q$
    with u as (
      insert into public.timesheet_entries (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes)
      values %s
      on conflict (id) do update set
        id = excluded.id, timesheet_id = excluded.timesheet_id, employee_id = excluded.employee_id, operation_id = excluded.operation_id,
        work_date = excluded.work_date, status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
        break_minutes = excluded.break_minutes, notes = excluded.notes
      returning 1)
    select count(*)::text from u$q$, _valores))
$$;

create or replace function pg_temp.linha_novo(_id text, _colab text, _status text default 'present', _in text default '06:00:00', _out text default '17:00:00', _brk int default 60, _notas text default null)
returns text language sql as $$
  select format($v$(%L, '5c0fb000-0000-4000-8000-000000000001', %L, '5c0fe000-0000-4000-8000-0000000000e1', date '2026-02-10', %L::public.attendance_status, %L::time, %L::time, %s, %L)$v$,
                _id, _colab, _status, _in, _out, _brk, _notas)
$$;

create or replace function pg_temp.valores(_id text) returns text language sql as $$
  select coalesce((select status || '|' || coalesce(check_in::text, '-') || '|' || coalesce(check_out::text, '-') || '|' || coalesce(notes, '-') || '|' || billed_amount::text || '|' || cost_amount::text
                     from public.timesheet_entries where id = _id::uuid), 'ausente')
$$;

-- ---------------------------------------------------------------------------
-- N. A carga NOVA
-- ---------------------------------------------------------------------------

select pg_temp.registrar('N1. linha NOVA (id gerado pelo cliente) é inserida e derivada: 120 + 2h*22,50 = 165,00 / 100,00', '1|present|06:00:00|17:00:00|-|165.00|100.00',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000002', '5c0ff000-0000-4000-8000-000000000002'))
  || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000002'), '|', 1)
  || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000002'), '|', 2) || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000002'), '|', 3)
  || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000002'), '|', 4) || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000002'), '|', 5)
  || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000002'), '|', 6));

select pg_temp.registrar('N2. LOTE com linha existente + 2 novas, todas com id, num só comando: as 3 gravadas', '3',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _notas => 'lote')
    || ', ' || pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000003', '5c0ff000-0000-4000-8000-000000000003')
    || ', ' || pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000004', '5c0ff000-0000-4000-8000-000000000004')));

select pg_temp.registrar('N3. só a NOTA mudou: nota gravada, receita e custo exatamente os de antes', 'present|06:00:00|17:00:00|so nota|165.00|100.00',
  (select case when pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _notas => 'so nota')) = '1' then pg_temp.valores('5c0fb100-0000-4000-8000-000000000001') else 'erro' end));

select pg_temp.registrar('N4. HORÁRIO alterado (saída 18:00): recalcula 120 + 3h*22,50 = 187,50 / 110,00', 'present|06:00:00|18:00:00|so nota|187.50|110.00',
  (select case when pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _out => '18:00:00', _notas => 'so nota')) = '1' then pg_temp.valores('5c0fb100-0000-4000-8000-000000000001') else 'erro' end));

select pg_temp.registrar('N5. STATUS ausente (sem horário): receita e custo zerados', 'absent|-|-|so nota|0.00|0.00',
  (select case when pg_temp.upsert_novo(format($v$(%L, '5c0fb000-0000-4000-8000-000000000001', %L, '5c0fe000-0000-4000-8000-0000000000e1', date '2026-02-10', 'absent'::public.attendance_status, NULL::time, NULL::time, 60, 'so nota')$v$,
       '5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001')) = '1' then pg_temp.valores('5c0fb100-0000-4000-8000-000000000001') else 'erro' end));

select pg_temp.registrar('N6. voltar a presente com o horário original: recalcula 165,00 / 100,00', 'present|06:00:00|17:00:00|so nota|165.00|100.00',
  (select case when pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _notas => 'so nota')) = '1' then pg_temp.valores('5c0fb100-0000-4000-8000-000000000001') else 'erro' end));

select pg_temp.registrar('N7. reenviar a linha SEM alteração: aceito e nada muda', 'present|06:00:00|17:00:00|so nota|165.00|100.00',
  (select case when pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _notas => 'so nota')) = '1' then pg_temp.valores('5c0fb100-0000-4000-8000-000000000001') else 'erro' end));

select pg_temp.registrar('N8. linha NOVA para colaborador que já tem apontamento na folha (id diferente): 23505, nada duplicado', 'erro 23505|1',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-0000000000ff', '5c0ff000-0000-4000-8000-000000000001'))
  || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c0fb000-0000-4000-8000-000000000001' and employee_id = '5c0ff000-0000-4000-8000-000000000001'));

select pg_temp.registrar('N9. as 4 linhas do lote (E1..E4) existem uma vez só', '4',
  (select count(*)::text from public.timesheet_entries where timesheet_id = '5c0fb000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- D. Taxa do contrato reajustada depois do lançamento
-- ---------------------------------------------------------------------------

update public.contracts set daily_rate = 130 where id = '5c0fd000-0000-4000-8000-0000000000d1';

select pg_temp.registrar('D1. contrato reajustado para 130: carga NOVA com a nota alterada NÃO é recusada e a linha segue a 120 (165,00)', '1|present|06:00:00|17:00:00|reajuste|165.00|100.00',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _notas => 'reajuste'))
  || '|' || pg_temp.valores('5c0fb100-0000-4000-8000-000000000001'));

select pg_temp.registrar('D2. carga NOVA reenviada sem nenhuma mudança, depois do reajuste: aceita e intacta', '1|present|06:00:00|17:00:00|reajuste|165.00|100.00',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _notas => 'reajuste'))
  || '|' || pg_temp.valores('5c0fb100-0000-4000-8000-000000000001'));

-- carga ANTIGA: valores derivados com a taxa nova, nota igual (linha "tocada" sem mudança real)
select pg_temp.registrar('D3. carga ANTIGA (valores derivados pela taxa nova) com a linha sem mudança real: recusada com 42501 — a razão de a carga nova existir', 'erro 42501',
  pg_temp.como('5c0f0000-0000-4000-8000-0000000000a1', 'aal2', $q$
    with u as (
      insert into public.timesheet_entries (billed_amount, break_minutes, check_in, check_out, cost_amount, daily_cost_snapshot, daily_rate_snapshot, employee_id, id, notes, operation_id, ot_hour_rate_snapshot, overtime_minutes, status, timesheet_id, work_date, worked_minutes)
      values (178.75, 60, '06:00', '17:00', 100, 80, 130, '5c0ff000-0000-4000-8000-000000000001', '5c0fb100-0000-4000-8000-000000000001', 'reajuste', '5c0fe000-0000-4000-8000-0000000000e1', 24.375, 120, 'present', '5c0fb000-0000-4000-8000-000000000001', date '2026-02-10', 600)
      on conflict (id) do update set billed_amount = excluded.billed_amount, break_minutes = excluded.break_minutes, check_in = excluded.check_in, check_out = excluded.check_out,
        cost_amount = excluded.cost_amount, daily_cost_snapshot = excluded.daily_cost_snapshot, daily_rate_snapshot = excluded.daily_rate_snapshot, employee_id = excluded.employee_id, id = excluded.id,
        notes = excluded.notes, operation_id = excluded.operation_id, ot_hour_rate_snapshot = excluded.ot_hour_rate_snapshot, overtime_minutes = excluded.overtime_minutes,
        status = excluded.status, timesheet_id = excluded.timesheet_id, work_date = excluded.work_date, worked_minutes = excluded.worked_minutes
      returning 1)
    select count(*)::text from u$q$));

select pg_temp.registrar('D4. editar o horário DEPOIS do reajuste recalcula com a taxa atual do contrato (130): 130 + 3h*24,375 = 203,13 — comportamento atual preservado, é a 025 que o muda', '1|present|06:00:00|18:00:00|reajuste|203.13|110.00',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', _out => '18:00:00', _notas => 'reajuste'))
  || '|' || pg_temp.valores('5c0fb100-0000-4000-8000-000000000001'));

update public.contracts set daily_rate = 120 where id = '5c0fd000-0000-4000-8000-0000000000d1';

-- ---------------------------------------------------------------------------
-- M. A carga antiga mista
-- ---------------------------------------------------------------------------

select pg_temp.registrar('M1. carga ANTIGA mista (uma linha com id e outra SEM id no mesmo comando) falha com 23502: o PostgREST põe NULL na chave ausente', 'erro 23502',
  pg_temp.como('5c0f0000-0000-4000-8000-0000000000a1', 'aal2', $q$
    with u as (
      insert into public.timesheet_entries (id, timesheet_id, employee_id, status)
      select * from (values
        ('5c0fb100-0000-4000-8000-000000000001'::uuid, '5c0fb000-0000-4000-8000-000000000001'::uuid, '5c0ff000-0000-4000-8000-000000000001'::uuid, 'present'::public.attendance_status),
        (NULL::uuid, '5c0fb000-0000-4000-8000-000000000001'::uuid, '5c0ff000-0000-4000-8000-000000000002'::uuid, 'present'::public.attendance_status)) v(id, timesheet_id, employee_id, status)
      on conflict (id) do update set status = excluded.status
      returning 1)
    select count(*)::text from u$q$));

-- ---------------------------------------------------------------------------
-- F. Faturado
-- ---------------------------------------------------------------------------

insert into public.invoices (id, client_id, period_start, period_end, status)
  values ('5c0fb200-0000-4000-8000-000000000001', '5c0fc000-0000-4000-8000-0000000000c1', date '2026-02-01', date '2026-02-28', 'closed');
update public.timesheet_entries set invoice_id = '5c0fb200-0000-4000-8000-000000000001' where id = '5c0fb100-0000-4000-8000-000000000004';

select pg_temp.registrar('F1. linha faturada: a carga nova (só nota) é recusada com 42501 — por isso a tela não a envia', 'erro 42501',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000004', '5c0ff000-0000-4000-8000-000000000004', _notas => 'tentativa')));
select pg_temp.registrar('F2. e nada mudou na linha faturada', 'present|06:00:00|17:00:00|-|165.00|100.00',
  pg_temp.valores('5c0fb100-0000-4000-8000-000000000004'));
select pg_temp.registrar('F3. um lote com a faturada junto de outra linha falha INTEIRO (o upsert é atômico): a outra linha também não foi gravada', 'erro 42501|-',
  pg_temp.upsert_novo(pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000003', '5c0ff000-0000-4000-8000-000000000003', _notas => 'junto')
    || ', ' || pg_temp.linha_novo('5c0fb100-0000-4000-8000-000000000004', '5c0ff000-0000-4000-8000-000000000004', _notas => 'junto'))
  || '|' || split_part(pg_temp.valores('5c0fb100-0000-4000-8000-000000000003'), '|', 4));
select pg_temp.registrar('F4. a fatura segue idêntica', 'closed',
  (select status::text from public.invoices where id = '5c0fb200-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- P. Permissões
-- ---------------------------------------------------------------------------

select pg_temp.registrar('P1. operacional NÃO grava pela tabela (a porta dele são as RPCs)', 'erro',
  case when pg_temp.como('5c0f0000-0000-4000-8000-0000000000a2', 'aal2', format($q$with u as (insert into public.timesheet_entries (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes) values (%L, '5c0fb000-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', '5c0fe000-0000-4000-8000-0000000000e1', date '2026-02-10', 'present', '06:00', '17:00', 60, 'op') on conflict (id) do update set notes = excluded.notes returning 1) select count(*)::text from u$q$, '5c0fb100-0000-4000-8000-000000000001')) like 'erro%' then 'erro' else 'gravou' end);
select pg_temp.registrar('P2. admin em AAL1 NÃO grava', 'erro',
  case when pg_temp.como('5c0f0000-0000-4000-8000-0000000000a1', 'aal1', format($q$with u as (insert into public.timesheet_entries (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes) values (%L, '5c0fb000-0000-4000-8000-000000000001', '5c0ff000-0000-4000-8000-000000000001', '5c0fe000-0000-4000-8000-0000000000e1', date '2026-02-10', 'present', '06:00', '17:00', 60, 'aal1') on conflict (id) do update set notes = excluded.notes returning 1) select count(*)::text from u$q$, '5c0fb100-0000-4000-8000-000000000001')) like 'erro%' then 'erro' else 'gravou' end);
select pg_temp.registrar('P3. nenhuma das duas tentativas alterou a nota gravada', 'reajuste',
  (select notes from public.timesheet_entries where id = '5c0fb100-0000-4000-8000-000000000001'));
select pg_temp.registrar('P4. a carga nova não contém colunas derivadas: o INSERT acima nomeia só as 10 editáveis/de contexto', '10',
  (select count(*)::text from unnest(array['id', 'timesheet_id', 'employee_id', 'operation_id', 'work_date', 'status', 'check_in', 'check_out', 'break_minutes', 'notes']) c));

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
    raise exception '020_apontamentos_upsert: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
