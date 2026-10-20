-- Migration 025 — motor financeiro por vigência com chave reversível (C05-B, etapa 4.3C).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez, DEPOIS de as
-- migrations 021 a 025 estarem aplicadas. Tudo acontece dentro de uma transação que termina
-- em `rollback`, então nada é criado, alterado ou removido — inclusive em `auth.users`,
-- `auth.sessions` e na chave do motor (ligada e desligada durante o teste, sempre revertida).
-- NUNCA rodar contra Production: o `rollback` protege, mas o arquivo escreve em `auth.users`,
-- nas tabelas de negócio, nas de versões e na trilha, e liga o motor dentro da transação.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  motor DESLIGADO: o cálculo é o de sempre, mesmo com versões cadastradas; nenhum
--      snapshot é preenchido; nenhum bloqueio novo vale; o formulário atual segue editando
--   B  ligar: pendências, quem pode, trilha, estado consistente
--   C  preço da DATA trabalhada; reajuste futuro e correção de versão não mudam o passado
--   D  hora extra recalculada com preços congelados; custo histórico; troca de colaborador
--   E  operação sem contrato (valor acordado versionado)
--   F  sem vigência: recusa P0002, sem fallback para a taxa atual
--   G  falta sem remuneração: sem vigência exigida, zerada, sem inventar preço; falta <-> presença
--   H  legado: o que continua livre, o que é recusado, e a regularização com prévia
--   I  faturado imutável
--   J  upsert do PostgREST (lote misto, só nota, sem alteração) e RPC do operador
--   K  `operations.contract_id` mutável: fonte ambígua, vínculo congelado, retroativo em
--      operação com legado
--   L  bloqueios de edição direta e congelamento de turno (só ligados)
--   M  desligar: colunas antigas ressincronizadas, motor antigo de volta, bloqueios soltos
--   N  as RPCs das migrations 023 e 024 seguem íntegras com o motor ligado
--   P  jornada histórica <= 0 (contrato antigo): vigência normalizada reproduz o motor antigo
--   O  permissões e inventário
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Concorrência entre sessões (um arquivo é uma sessão): foi medida à parte, com duas sessões.
-- A paridade em massa (23.862 casos pelo trigger real, motor desligado e ligado) também.

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

create or replace function pg_temp.adm(_chamada text) returns text language sql as $$
  select pg_temp.chamar('5c100000-0000-4000-8000-0000000000a1', 'aal2', _chamada)
$$;

create or replace function pg_temp.adm_valor(_sql text) returns text language sql as $$
  select pg_temp.como('5c100000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;

create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.valor_de(_sql text) returns text language plpgsql as $$
declare _r text;
begin
  execute _sql into _r;
  return coalesce(_r, 'nulo');
exception when others then
  return 'erro ' || sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c100000-0000-4000-8000-0000000000a1'),
  ('5c100000-0000-4000-8000-0000000000a2'),
  ('5c100000-0000-4000-8000-0000000000a3');
insert into auth.sessions (id, user_id, not_after) values
  ('ec100000-0000-4000-8000-0000000000a1', '5c100000-0000-4000-8000-0000000000a1', null),
  ('ec100000-0000-4000-8000-0000000000a2', '5c100000-0000-4000-8000-0000000000a2', null),
  ('ec100000-0000-4000-8000-0000000000a3', '5c100000-0000-4000-8000-0000000000a3', null);
insert into public.user_roles (user_id, role) values
  ('5c100000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c100000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c10c000-0000-4000-8000-0000000000c1', 'C05B43C cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c10d000-0000-4000-8000-0000000000d1', '5c10c000-0000-4000-8000-0000000000c1', 'K1', 120, 8, 1.5, 10),
  ('5c10d000-0000-4000-8000-0000000000d2', '5c10c000-0000-4000-8000-0000000000c1', 'K2', 150, 8, 1.5, 10),
  -- K3 e K4: contratos antigos com jornada <= 0 (a tabela `contracts` não tem CHECK); o motor antigo usa 8.
  ('5c10d000-0000-4000-8000-0000000000d3', '5c10c000-0000-4000-8000-0000000000c1', 'K3 jornada zero', 100, 0, 1.5, 10),
  ('5c10d000-0000-4000-8000-0000000000d4', '5c10c000-0000-4000-8000-0000000000c1', 'K4 jornada negativa', 90, -3, 1, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c10f000-0000-4000-8000-000000000001', 'E1', 80),
  ('5c10f000-0000-4000-8000-000000000002', 'E2', 60),
  ('5c10f000-0000-4000-8000-000000000003', 'E3', 80),
  ('5c10f000-0000-4000-8000-000000000004', 'E4 sem vigencia', 70),
  ('5c10f000-0000-4000-8000-000000000005', 'E5 com custo desde 2020', 66),
  ('5c10f000-0000-4000-8000-000000000006', 'E6 jornada historica', 50);

-- a1 OP-K (K1), a2 OP-A (K1), a3 OP-E (K1, sem apontamento), a4 OP-X (K2), a5 OP-L (K1, legado), a6 OP-N (sem contrato)
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c10e000-0000-4000-8000-0000000000a1', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d1', 'OP-K', null),
  ('5c10e000-0000-4000-8000-0000000000a2', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d1', 'OP-A', null),
  ('5c10e000-0000-4000-8000-0000000000a3', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d1', 'OP-E', null),
  ('5c10e000-0000-4000-8000-0000000000a4', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d2', 'OP-X', null),
  ('5c10e000-0000-4000-8000-0000000000a5', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d1', 'OP-L', null),
  ('5c10e000-0000-4000-8000-0000000000a6', '5c10c000-0000-4000-8000-0000000000c1', null, 'OP-N', 250),
  ('5c10e000-0000-4000-8000-0000000000a7', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d3', 'OP-Z', null),
  ('5c10e000-0000-4000-8000-0000000000a8', '5c10c000-0000-4000-8000-0000000000c1', '5c10d000-0000-4000-8000-0000000000d4', 'OP-W', null);
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5c10a000-0000-4000-8000-0000000000a1', '5c10e000-0000-4000-8000-0000000000a1', 'SK', '06:00', '15:00', 60),
  ('5c10a000-0000-4000-8000-0000000000a2', '5c10e000-0000-4000-8000-0000000000a2', 'SA', '06:00', '15:00', 60),
  ('5c10a000-0000-4000-8000-0000000000a3', '5c10e000-0000-4000-8000-0000000000a3', 'SE', '06:00', '15:00', 60),
  ('5c10a000-0000-4000-8000-0000000000a5', '5c10e000-0000-4000-8000-0000000000a5', 'SL', '06:00', '15:00', 60),
  ('5c10a000-0000-4000-8000-0000000000a6', '5c10e000-0000-4000-8000-0000000000a6', 'SN', '06:00', '15:00', 60),
  ('5c10a000-0000-4000-8000-0000000000a9', '5c10e000-0000-4000-8000-0000000000a1', 'SK livre', '07:00', '16:00', 60);

create or replace function pg_temp.folha(_cod text, _op text, _turno text, _data date) returns void language sql as $$
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c10b000-0000-4000-8000-0000000000' || _cod)::uuid, ('5c10e000-0000-4000-8000-0000000000' || _op)::uuid,
          ('5c10a000-0000-4000-8000-0000000000' || _turno)::uuid, _data)
$$;

create or replace function pg_temp.folha_sem_turno(_cod text, _op text, _data date) returns void language sql as $$
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c10b000-0000-4000-8000-0000000000' || _cod)::uuid, ('5c10e000-0000-4000-8000-0000000000' || _op)::uuid, null, _data)
$$;

create or replace function pg_temp.entrada(_cod text, _folha text, _colab text, _status text default 'present', _in text default '06:00', _out text default '17:00')
returns text language plpgsql as $$
begin
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values (('5c10b100-0000-4000-8000-0000000000' || _cod)::uuid, ('5c10b000-0000-4000-8000-0000000000' || _folha)::uuid,
          ('5c10f000-0000-4000-8000-00000000000' || _colab)::uuid, _status::public.attendance_status,
          nullif(_in, '')::time, nullif(_out, '')::time, 60);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.linha(_cod text) returns text language sql as $$
  select coalesce((select status || '|' || coalesce(check_in::text, '-') || '|' || coalesce(check_out::text, '-') || '|' || billed_amount::text || '|' || cost_amount::text
                     from public.timesheet_entries where id = ('5c10b100-0000-4000-8000-0000000000' || _cod)::uuid), 'ausente')
$$;

create or replace function pg_temp.valores(_cod text) returns text language sql as $$
  select coalesce((select billed_amount::text || '|' || cost_amount::text
                     from public.timesheet_entries where id = ('5c10b100-0000-4000-8000-0000000000' || _cod)::uuid), 'ausente')
$$;

create or replace function pg_temp.fixado(_cod text) returns text language sql as $$
  select coalesce((select coalesce(terms_origin, '-') || '|' || coalesce(daily_rate_snapshot::text, '-') || '|' || coalesce(daily_cost_snapshot::text, '-') || '|'
                          || coalesce(shift_hours_snapshot::text, '-') || '|' || coalesce(ot_factor_snapshot::text, '-') || '|' || coalesce(ot_tolerance_snapshot::text, '-') || '|'
                          || coalesce(planned_minutes_snapshot::text, '-')
                     from public.timesheet_entries where id = ('5c10b100-0000-4000-8000-0000000000' || _cod)::uuid), 'ausente')
$$;

create or replace function pg_temp.refs(_cod text) returns text language sql as $$
  select coalesce((select (contract_terms_id is not null)::text || '/' || (operation_terms_id is not null)::text || '/' || (employee_cost_terms_id is not null)::text
                     from public.timesheet_entries where id = ('5c10b100-0000-4000-8000-0000000000' || _cod)::uuid), 'ausente')
$$;

-- Edita como o admin da tela, por UPDATE direto; devolve 'N' (linhas) ou 'erro <sqlstate>'.
create or replace function pg_temp.editar(_cod text, _set text) returns text language sql as $$
  select pg_temp.adm_valor(format($q$with u as (update public.timesheet_entries set %s where id = %L returning 1) select count(*)::text from u$q$,
    _set, '5c10b100-0000-4000-8000-0000000000' || _cod))
$$;

-- O upsert da tela (carga nova) no formato que o PostgREST gera.
create or replace function pg_temp.upsert(_valores text) returns text language sql as $$
  select pg_temp.adm_valor(format($q$
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

create or replace function pg_temp.carga(_cod text, _folha text, _op text, _data text, _colab text, _status text default 'present', _in text default '06:00:00', _out text default '17:00:00', _notas text default null)
returns text language sql as $$
  select format($v$(%L, %L, %L, %L, date %L, %L::public.attendance_status, %L::time, %L::time, 60, %L)$v$,
    '5c10b100-0000-4000-8000-0000000000' || _cod, '5c10b000-0000-4000-8000-0000000000' || _folha, '5c10f000-0000-4000-8000-00000000000' || _colab,
    '5c10e000-0000-4000-8000-0000000000' || _op, _data, _status, _in, _out, _notas)
$$;

create or replace function pg_temp.motor(_ativar boolean, _extra text default '') returns text language sql as $$
  select pg_temp.adm(format('public.alterar_motor_vigencia(%L, %L%s)', _ativar, case when _ativar then 'Ligado no teste' else 'Desligado no teste' end, _extra))
$$;

create or replace function pg_temp.gatilhos() returns text language sql as $$
  select (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_financeiro') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_vigencia') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_contracts_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_employees_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_operations_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_shifts_congela_jornada_usada')
$$;

-- ---------------------------------------------------------------------------
-- A. Motor DESLIGADO
-- ---------------------------------------------------------------------------

select pg_temp.folha('01', 'a5', 'a5', date '2026-01-15');
select pg_temp.folha('02', 'a5', 'a5', date '2026-01-16');
select pg_temp.folha('03', 'a5', 'a5', date '2026-02-02');
select pg_temp.folha('0e', 'a5', 'a5', date '2025-11-01');

select pg_temp.registrar('A0. legado L1 (OP-L, 15/01, 06:00-17:00): 120 + 2h*22,50 = 165,00; custo 80 + 2h*10 = 100,00', 'ok|present|06:00:00|17:00:00|165.00|100.00',
  pg_temp.entrada('01', '01', '1') || '|' || pg_temp.linha('01'));
select pg_temp.registrar('A0b. legado L2 (OP-L, 16/01, 06:00-15:00): sem hora extra, 120,00 / custo 60,00 (E2)', 'ok|present|06:00:00|15:00:00|120.00|60.00',
  pg_temp.entrada('02', '02', '2', _out => '15:00') || '|' || pg_temp.linha('02'));
select pg_temp.registrar('A0c. legado L3 (OP-L, 02/02, E3): 165,00 / 100,00', 'ok|present|06:00:00|17:00:00|165.00|100.00',
  pg_temp.entrada('03', '03', '3') || '|' || pg_temp.linha('03'));
select pg_temp.registrar('A0d. legado L4 (OP-L, 01/11/2025, E4): data e colaborador que NUNCA terão vigência', 'ok|present|06:00:00|17:00:00|165.00|87.50',
  pg_temp.entrada('04', '0e', '4') || '|' || pg_temp.linha('04'));

select pg_temp.folha('1b', 'a5', 'a5', date '2026-01-17');
select pg_temp.registrar('A0e. legado L5 (OP-L, 17/01, E1, presença 06:00-17:00) e L6 (E2, FALTA): o motor antigo grava a falta zerada com as taxas atuais', 'ok|present|06:00:00|17:00:00|165.00|100.00|ok|absent|-|-|0.00|0.00|-|120.00|60.00|-|-|-|-',
  pg_temp.entrada('06', '1b', '1') || '|' || pg_temp.linha('06') || '|' || pg_temp.entrada('07', '1b', '2', 'absent', '', '') || '|' || pg_temp.linha('07') || '|' || pg_temp.fixado('07'));

select pg_temp.folha_sem_turno('1c', 'a7', date '2026-01-20');
select pg_temp.folha_sem_turno('1d', 'a8', date '2026-01-20');
select pg_temp.registrar('A0f. motor ANTIGO, contrato com jornada 0 (K3) e -3 (K4), sem turno: usa 8 h. K3: 100 + 2h*18,75 = 137,50; K4: 90 + 2h*11,25 = 112,50; custo 50 + 2h*6,25 = 62,50', 'ok|137.50|62.50|ok|112.50|62.50',
  pg_temp.entrada('91', '1c', '6') || '|' || pg_temp.valores('91') || '|' || pg_temp.entrada('92', '1d', '6') || '|' || pg_temp.valores('92'));

select pg_temp.registrar('A1. a chave nasce DESLIGADA, sem data de ativação', 'false|nulo',
  (select vigencia_ativa::text || '|' || coalesce(ativada_em::text, 'nulo') from public.financial_engine_settings));
select pg_temp.registrar('A2. desligado: motor antigo habilitado; motor novo, bloqueios e congelamento DESABILITADOS', 'O|D|D|D|D|D', pg_temp.gatilhos());
select pg_temp.registrar('A3. admin AAL2 vê o estado: desligado e consistente', 'false|true',
  (select (x ->> 'ativo') || '|' || (x ->> 'consistente') from (select pg_temp.adm_valor('select public.estado_motor_vigencia()::text')::jsonb x) q));

select pg_temp.registrar('A4. K1 v1 [01/01, 01/07/2026): 100 e v2 [01/07/2026, aberta): 130', '1|1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1.5, 10, 'v1 K1', date '2026-07-01')$q$)
  || '|' || pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d1', date '2026-07-01', 130, 8, 1.5, 10, 'v2 K1')$q$));
select pg_temp.registrar('A5. custo E1 v1 [01/01, 01/07): 70; v2 [01/07, aberta): 90; E2 aberta: 50; E3 aberta: 80', '1|1|1|1',
  pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000001', date '2026-01-01', 70, 'v1 E1', date '2026-07-01')$q$)
  || '|' || pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000001', date '2026-07-01', 90, 'v2 E1')$q$)
  || '|' || pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000002', date '2026-01-01', 50, 'E2')$q$)
  || '|' || pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000003', date '2026-01-01', 80, 'E3')$q$));
select pg_temp.registrar('A5b. K3 e K4 ganham vigência ADMINISTRATIVA com a jornada já normalizada (8 h = o que o motor antigo usava); E6 tem custo 50', '1|1|1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d3', date '2026-01-01', 100, 8, 1.5, 10, 'Jornada 0 normalizada para 8 h, como o motor antigo')$q$)
  || '|' || pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d4', date '2026-01-01', 90, 8, 1, 10, 'Jornada -3 normalizada para 8 h, como o motor antigo')$q$)
  || '|' || pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000006', date '2026-01-01', 50, 'E6')$q$));
select pg_temp.registrar('A6. OP-N (sem contrato) v1 [01/01, 01/07): 200; v2 [01/07, aberta): 260', '1|1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c10e000-0000-4000-8000-0000000000a6', date '2026-01-01', 200, 'v1 OP-N', date '2026-07-01')$q$)
  || '|' || pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c10e000-0000-4000-8000-0000000000a6', date '2026-07-01', 260, 'v2 OP-N')$q$));

select pg_temp.folha('0b', 'a5', 'a5', date '2026-02-03');
select pg_temp.registrar('A7. DESLIGADO, COM versões cadastradas: entrada nova usa as colunas atuais (120/80), não as versões (100/70): 165,00 / 100,00; origem e referências vazias', 'ok|present|06:00:00|17:00:00|165.00|100.00|-/-|false/false/false',
  pg_temp.entrada('05', '0b', '1') || '|' || pg_temp.linha('05') || '|' || split_part(pg_temp.fixado('05'), '|', 1) || '/' || split_part(pg_temp.fixado('05'), '|', 4) || '|' || pg_temp.refs('05'));
select pg_temp.registrar('A8. DESLIGADO, editar o horário de L1 recalcula com as colunas atuais, como sempre: 120 + 3h*22,50 = 187,50', '1|present|06:00:00|18:00:00|187.50|110.00',
  pg_temp.editar('01', $s$check_out = '18:00'$s$) || '|' || pg_temp.linha('01'));
update public.timesheet_entries set check_out = '17:00' where id = '5c10b100-0000-4000-8000-000000000001';
select pg_temp.registrar('A9. DESLIGADO, o formulário atual edita a taxa do contrato por UPDATE direto (nenhum bloqueio novo)', '1',
  pg_temp.adm_valor($q$with u as (update public.contracts set daily_rate = 121 where id = '5c10d000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$));
update public.contracts set daily_rate = 120 where id = '5c10d000-0000-4000-8000-0000000000d1';
select pg_temp.registrar('A10. DESLIGADO, edição direta do valor acordado e do custo diário segue livre', '1|1',
  pg_temp.adm_valor($q$with u as (update public.operations set agreed_amount = 251 where id = '5c10e000-0000-4000-8000-0000000000a6' returning 1) select count(*)::text from u$q$)
  || '|' || pg_temp.adm_valor($q$with u as (update public.employees set daily_cost = 81 where id = '5c10f000-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$));
update public.operations set agreed_amount = 250 where id = '5c10e000-0000-4000-8000-0000000000a6';
update public.employees set daily_cost = 80 where id = '5c10f000-0000-4000-8000-000000000003';
select pg_temp.registrar('A11. DESLIGADO, mudar o horário de turno usado segue livre (congelamento dormente)', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '15:10' where id = '5c10a000-0000-4000-8000-0000000000a5' returning 1) select count(*)::text from u$q$));
update public.shifts set end_time = '15:00' where id = '5c10a000-0000-4000-8000-0000000000a5';
select pg_temp.registrar('A12. DESLIGADO, mudar o contrato de operação com apontamento segue livre', '1',
  pg_temp.adm_valor($q$with u as (update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d2' where id = '5c10e000-0000-4000-8000-0000000000a5' returning 1) select count(*)::text from u$q$));
update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d1' where id = '5c10e000-0000-4000-8000-0000000000a5';
select pg_temp.registrar('A13. a derivação antiga e gerar_fatura não citam o motor novo nem as versões', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('derivar_valores_financeiros', 'gerar_fatura')
     and (prosrc ilike '%vigencia%' or prosrc ilike '%financial_engine_settings%' or prosrc ilike '%_terms%')));
select pg_temp.registrar('A14. DESLIGADO, nenhum apontamento tem origem de preço', '0',
  (select count(*)::text from public.timesheet_entries where terms_origin is not null));

-- ---------------------------------------------------------------------------
-- B. Ligar o motor
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. há pendência (K2, usado por OP-X, sem vigência): ligar é recusado, 55000', 'erro 55000', pg_temp.motor(true));
select pg_temp.registrar('B2. a lista de pendências é só o contrato K2', '1|contrato|K2',
  (select count(*)::text from public.motor_pendencias()) || '|' || (select tipo || '|' || nome from public.motor_pendencias() limit 1));
select pg_temp.registrar('B2b. admin AAL2 lê as pendências pela RPC', 'contrato|K2',
  pg_temp.adm_valor('select tipo || ''|'' || nome from public.pendencias_implantacao_vigencias() limit 1'));
select pg_temp.registrar('B3. a recusa não ligou nada', 'false|O|D', (select vigencia_ativa::text from public.financial_engine_settings) || '|'
  || (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_financeiro') || '|'
  || (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_vigencia'));
select pg_temp.registrar('B4. cadastrar a vigência de K2', '1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d2', date '2026-01-01', 150, 8, 1.5, 10, 'K2')$q$));
select pg_temp.registrar('B4b. e a pendência some', '0', (select count(*)::text from public.motor_pendencias()));
select pg_temp.registrar('B5. ligar sem motivo: 22023', 'erro 22023', pg_temp.adm($q$public.alterar_motor_vigencia(true, '  ')$q$));
select pg_temp.registrar('B6. ligar sem informar o sentido (nulo): 22023', 'erro 22023', pg_temp.adm($q$public.alterar_motor_vigencia(null, 'x')$q$));
select pg_temp.registrar('B7. operacional em AAL2 não liga (42501)', 'erro 42501', pg_temp.chamar('5c100000-0000-4000-8000-0000000000a2', 'aal2', $q$public.alterar_motor_vigencia(true, 'x')$q$));
select pg_temp.registrar('B8. admin em AAL1 não liga (42501)', 'erro 42501', pg_temp.chamar('5c100000-0000-4000-8000-0000000000a1', 'aal1', $q$public.alterar_motor_vigencia(true, 'x')$q$));
select pg_temp.registrar('B9. anônimo não liga (42501)', 'erro 42501',
  pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), $q$select count(*)::text from (select public.alterar_motor_vigencia(true, 'x')) x$q$));
select pg_temp.registrar('B10. a chave continua desligada depois das recusas', 'false', (select vigencia_ativa::text from public.financial_engine_settings));

select pg_temp.registrar('B11. LIGAR com motivo, admin AAL2', '1', pg_temp.motor(true));
select pg_temp.registrar('B12. ligado: motor novo, bloqueios e congelamento HABILITADOS; motor antigo DESABILITADO', 'D|O|O|O|O|O', pg_temp.gatilhos());
select pg_temp.registrar('B13. a chave registra ligada, a data de hoje (America/Sao_Paulo), o autor e o motivo', 'true|true|5c100000-0000-4000-8000-0000000000a1|Ligado no teste',
  (select vigencia_ativa::text || '|' || (ativada_em = (now() at time zone 'America/Sao_Paulo')::date)::text || '|' || changed_by::text || '|' || reason from public.financial_engine_settings));
select pg_temp.registrar('B14. estado consistente', 'true|true',
  (select (x ->> 'ativo') || '|' || (x ->> 'consistente') from (select pg_temp.adm_valor('select public.estado_motor_vigencia()::text')::jsonb x) q));
select pg_temp.registrar('B15. a trilha guarda o evento: antes desligado, depois ligado, 0 pendências, motivo', '1|motor_vigencia_ativado|sistema|false|true|0|Ligado no teste',
  (select count(*)::text || '|' || min(action) || '|' || min(entity_kind) || '|' || min(previous ->> 'vigencia_ativa') || '|' || min(new ->> 'vigencia_ativa') || '|' || min(new ->> 'pendencias') || '|' || min(reason)
     from public.financial_terms_audit where action = 'motor_vigencia_ativado'));
select pg_temp.registrar('B16. ligar de novo: 55000', 'erro 55000', pg_temp.motor(true));
select pg_temp.registrar('B17. ligar não recalculou nada: L1 segue 165,00 / 100,00 e sem origem', 'present|06:00:00|17:00:00|165.00|100.00|-', pg_temp.linha('01') || '|' || split_part(pg_temp.fixado('01'), '|', 1));

-- ---------------------------------------------------------------------------
-- C. Preço da data trabalhada
-- ---------------------------------------------------------------------------

select pg_temp.folha('04', 'a1', 'a1', date '2026-02-10');
select pg_temp.folha('05', 'a1', 'a1', date '2026-07-15');
select pg_temp.folha('08', 'a1', 'a1', date '2026-07-01');
select pg_temp.folha('09', 'a1', 'a1', date '2026-06-30');

select pg_temp.registrar('C1. 10/02 (contrato v1 = 100; custo E1 v1 = 70): 100 + 2h*18,75 = 137,50; custo 70 + 2h*8,75 = 87,50', 'ok|present|06:00:00|17:00:00|137.50|87.50',
  pg_temp.entrada('21', '04', '1') || '|' || pg_temp.linha('21'));
select pg_temp.registrar('C1b. fixou origem, diária, custo, jornada, fator, tolerância e jornada prevista', 'versao|100.00|70.00|8.00|1.50|10|480.00', pg_temp.fixado('21'));
select pg_temp.registrar('C1c. referências: contrato sim, valor acordado não, custo sim', 'true/false/true', pg_temp.refs('21'));
select pg_temp.registrar('C2. 15/07 (contrato v2 = 130; custo E1 v2 = 90): 130 + 2h*24,375 = 178,75; custo 90 + 2h*11,25 = 112,50', 'ok|present|06:00:00|17:00:00|178.75|112.50',
  pg_temp.entrada('22', '05', '1') || '|' || pg_temp.linha('22'));
select pg_temp.registrar('C2b. e a referência é a v2 do contrato (não a v1)', 'true',
  (select (contract_terms_id = (select id from public.contract_terms where contract_id = '5c10d000-0000-4000-8000-0000000000d1' and valid_from = date '2026-07-01'))::text
     from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000022'));
select pg_temp.registrar('C3. fronteira: 01/07 pertence à v2 (que começa nele): diária 130, sem hora extra', 'ok|130.00|80.00',
  pg_temp.entrada('23', '08', '3', _out => '15:00') || '|' || pg_temp.valores('23'));
select pg_temp.registrar('C3b. fronteira: 30/06 pertence à v1: diária 100', 'ok|100.00|80.00',
  pg_temp.entrada('24', '09', '3', _out => '15:00') || '|' || pg_temp.valores('24'));

select pg_temp.registrar('C4. reajuste futuro: v3 de K1 (999) a partir de 01/01/2040, encerrando a v2, e o custo de E1 sobe em 2040', '1|1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d1', date '2040-01-01', 999, 8, 1.5, 10, 'v3 K1', null, true)$q$)
  || '|' || pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000001', date '2040-01-01', 400, 'v3 E1', null, true)$q$));
update public.contracts set daily_rate = 777 where id = '5c10d000-0000-4000-8000-0000000000d1';
select pg_temp.registrar('C5. o reajuste (e a coluna antiga mudada pelo sistema) não altera os apontamentos anteriores', 'present|06:00:00|17:00:00|137.50|87.50|present|06:00:00|17:00:00|178.75|112.50',
  pg_temp.linha('21') || '|' || pg_temp.linha('22'));
select pg_temp.folha('0a', 'a1', 'a1', date '2026-02-12');
select pg_temp.registrar('C6. a coluna antiga do contrato (777) não influi: apontamento novo em 12/02 usa a v1 (100)', 'ok|137.50|50.00',
  pg_temp.entrada('25', '0a', '2') || '|' || split_part(pg_temp.valores('25'), '|', 1) || '|' || split_part(pg_temp.fixado('25'), '|', 3));
select pg_temp.folha('0c', 'a1', 'a1', date '2040-02-01');
select pg_temp.registrar('C7. em 2040 vale a v3 (999) e o custo v3 (400): 999 + 2h*187,3125 = 1373,63; custo 400 + 2h*50 = 500,00', 'ok|1373.63|500.00',
  pg_temp.entrada('26', '0c', '1') || '|' || pg_temp.valores('26'));

-- ---------------------------------------------------------------------------
-- D. Hora extra com preços congelados; correção; custo histórico; troca de colaborador
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D1. editar a saída de C1 para 18:00 recalcula SÓ a quantidade, com o preço congelado (100): 100 + 3h*18,75 = 156,25; custo 70 + 3h*8,75 = 96,25', '1|present|06:00:00|18:00:00|156.25|96.25',
  pg_temp.editar('21', $s$check_out = '18:00'$s$) || '|' || pg_temp.linha('21'));
select pg_temp.registrar('D2. corrigir a v1 do contrato (100 -> 105) depois do apontamento', '1',
  pg_temp.adm(format($q$public.corrigir_condicao_contrato(%L, date '2026-01-01', date '2026-07-01', 105, 8, 1.5, 10, 'Diária corrigida')$q$,
    (select id from public.contract_terms where contract_id = '5c10d000-0000-4000-8000-0000000000d1' and valid_from = date '2026-01-01' and active))));
select pg_temp.registrar('D3. depois da correção, C1 segue com o preço congelado (100), não a versão corrigida (105): saída 17:30 -> 100 + 2,5h*18,75 = 146,88; custo 70 + 2,5h*8,75 = 91,88', '1|present|06:00:00|17:30:00|146.88|91.88',
  pg_temp.editar('21', $s$check_out = '17:30'$s$) || '|' || pg_temp.linha('21'));
select pg_temp.registrar('D4. e a diária congelada continua 100', 'versao|100.00|70.00|8.00|1.50|10|480.00', pg_temp.fixado('21'));
select pg_temp.folha('0d', 'a1', 'a1', date '2026-02-13');
select pg_temp.registrar('D5. apontamento NOVO na data coberta pela versão corrigida usa 105: 105 + 2h*19,6875 = 144,38', 'ok|144.38',
  pg_temp.entrada('27', '0d', '3') || '|' || split_part(pg_temp.valores('27'), '|', 1));
select pg_temp.registrar('D6. custo histórico: trocar o colaborador de C1 (E1 -> E2, custo 50) recalcula o custo com a versão do NOVO colaborador na data, e preserva a receita: 50 + 2,5h*6,25 = 65,63', '1|present|06:00:00|17:30:00|146.88|65.63',
  pg_temp.editar('21', $s$employee_id = '5c10f000-0000-4000-8000-000000000002'$s$) || '|' || pg_temp.linha('21'));
select pg_temp.registrar('D6b. a referência de custo agora é a de E2', 'true',
  (select (e.employee_id = '5c10f000-0000-4000-8000-000000000002' and t.employee_id = '5c10f000-0000-4000-8000-000000000002')::text
     from public.timesheet_entries e join public.employee_cost_terms t on t.id = e.employee_cost_terms_id where e.id = '5c10b100-0000-4000-8000-000000000021'));
select pg_temp.registrar('D7. trocar para um colaborador SEM vigência (E4): recusado, P0002, nada muda', 'erro P0002|146.88|65.63',
  pg_temp.editar('21', $s$employee_id = '5c10f000-0000-4000-8000-000000000004'$s$) || '|' || split_part(pg_temp.valores('21'), '|', 1) || '|' || split_part(pg_temp.valores('21'), '|', 2));
select pg_temp.registrar('D8. o custo de E1 em 2040 (400) não alterou o apontamento de 15/07 (112,50); editar sua saída para 18:00 usa o custo congelado (90): 130 + 3h*24,375 = 203,13; custo 90 + 3h*11,25 = 123,75', '1|present|06:00:00|18:00:00|203.13|123.75',
  pg_temp.editar('22', $s$check_out = '18:00'$s$) || '|' || pg_temp.linha('22'));

-- ---------------------------------------------------------------------------
-- E. Operação sem contrato
-- ---------------------------------------------------------------------------

select pg_temp.folha('10', 'a6', 'a6', date '2026-02-10');
select pg_temp.folha('11', 'a6', 'a6', date '2026-08-01');
select pg_temp.registrar('E1. OP-N em 10/02 (valor acordado v1 = 200, jornada 8, fator 1, tolerância 10): 200 + 2h*25 = 250,00; custo 80 + 2h*10 = 100,00 (não usa operations.agreed_amount = 250 nem o contrato)', 'ok|present|06:00:00|17:00:00|250.00|100.00',
  pg_temp.entrada('31', '10', '3') || '|' || pg_temp.linha('31'));
select pg_temp.registrar('E1b. fixou valor_acordado, 200, 80, 8, 1, 10 e jornada 480', 'valor_acordado|200.00|80.00|8.00|1.00|10|480.00', pg_temp.fixado('31'));
select pg_temp.registrar('E1c. referências: contrato não, valor acordado sim, custo sim', 'false/true/true', pg_temp.refs('31'));
select pg_temp.registrar('E2. OP-N em 01/08 (v2 = 260), sem hora extra: 260,00 / 80,00', 'ok|260.00|80.00',
  pg_temp.entrada('32', '11', '3', _out => '15:00') || '|' || pg_temp.valores('32'));
update public.operations set agreed_amount = 999 where id = '5c10e000-0000-4000-8000-0000000000a6';
select pg_temp.registrar('E3. reajustar a coluna antiga do valor acordado (999, pelo sistema) não altera o apontamento anterior', '250.00|100.00', pg_temp.valores('31'));
select pg_temp.registrar('E4. editar a saída de E1 (18:00) usa o valor acordado congelado (200): 200 + 3h*25 = 275,00; custo 100 + ... = 80 + 3h*10 = 110,00', '1|present|06:00:00|18:00:00|275.00|110.00',
  pg_temp.editar('31', $s$check_out = '18:00'$s$) || '|' || pg_temp.linha('31'));
update public.operations set agreed_amount = 250 where id = '5c10e000-0000-4000-8000-0000000000a6';

-- ---------------------------------------------------------------------------
-- F. Sem vigência
-- ---------------------------------------------------------------------------

select pg_temp.folha('12', 'a1', 'a1', date '2025-12-31');
select pg_temp.registrar('F0. E5 tem custo vigente desde 2020 (para isolar a falta de vigência do CONTRATO e do VALOR ACORDADO)', '1',
  pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000005', date '2020-01-01', 55, 'E5 desde 2020')$q$));
select pg_temp.folha('13', 'a6', 'a6', date '2025-06-01');
select pg_temp.registrar('F1. OP-K em 31/12/2025 (antes da primeira vigência): recusado, P0002; as colunas atuais (777 e 80) NÃO são usadas como substitutas', 'P0002|0',
  pg_temp.entrada('41', '12', '1') || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c10b000-0000-4000-8000-000000000012'));
select pg_temp.registrar('F2. colaborador SEM vigência (E4) em data coberta pelo contrato: P0002', 'P0002', pg_temp.entrada('42', '04', '4'));
select pg_temp.registrar('F3. OP-N em 01/06/2025 (antes do valor acordado; o custo de E5 existe): P0002, sem cair em agreed_amount = 250', 'P0002', pg_temp.entrada('43', '13', '5'));
select pg_temp.registrar('F3b. OP-K em 31/12/2025 com colaborador que TEM custo vigente (E5): P0002 pela falta do CONTRATO, sem cair em contracts.daily_rate = 777', 'P0002|0',
  pg_temp.entrada('45', '12', '5') || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c10b000-0000-4000-8000-000000000012' and employee_id = '5c10f000-0000-4000-8000-000000000005'));
select pg_temp.registrar('F4. a mensagem diz a data e orienta o cadastro, sem número de taxa', 'true',
  (select (pg_temp.valor_de($q$insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values ('5c10b100-0000-4000-8000-000000000044', '5c10b000-0000-4000-8000-000000000012', '5c10f000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60)$q$) = 'erro P0002')::text));
select pg_temp.registrar('F5. sem apontamentos criados por essas tentativas', '0', (select count(*)::text from public.timesheet_entries where id::text like '5c10b100-0000-4000-8000-0000000000_4' and id::text not like '%24' and id::text not like '%04'));

-- ---------------------------------------------------------------------------
-- G. Falta: sem vigência exigida, zerada e sem inventar preço
-- ---------------------------------------------------------------------------

select pg_temp.folha('14', 'a1', 'a1', date '2026-02-11');
select pg_temp.folha('c0', 'a1', 'a1', date '2025-12-30');
select pg_temp.registrar('G1. falta em 11/02 (HÁ vigência): valores zerados e NADA fixado — nem origem, nem referências, nem snapshots novos', 'ok|absent|-|-|0.00|0.00|-|0.00|0.00|-|-|-|-|false/false/false',
  pg_temp.entrada('51', '14', '1', 'absent', '', '') || '|' || pg_temp.linha('51') || '|' || pg_temp.fixado('51') || '|' || pg_temp.refs('51'));
select pg_temp.registrar('G1b. falta SEM vigência de contrato (OP-K, 30/12/2025): aceita, zerada, sem referência', 'ok|absent|-|-|0.00|0.00|-|0.00|0.00|-|-|-|-|false/false/false',
  pg_temp.entrada('52', 'c0', '3', 'absent', '', '') || '|' || pg_temp.linha('52') || '|' || pg_temp.fixado('52') || '|' || pg_temp.refs('52'));
select pg_temp.registrar('G1c. falta de colaborador SEM custo vigente (E4), em data coberta pelo contrato: aceita', 'ok|absent|-|-|0.00|0.00|-|false/false/false',
  pg_temp.entrada('53', '04', '4', 'absent', '', '') || '|' || pg_temp.linha('53') || '|' || split_part(pg_temp.fixado('53'), '|', 1) || '|' || pg_temp.refs('53'));
select pg_temp.registrar('G1d. falta em OP-N antes do valor acordado (01/06/2025): aceita', 'ok|absent|-|-|0.00|0.00',
  pg_temp.entrada('54', '13', '5', 'absent', '', '') || '|' || pg_temp.linha('54'));
select pg_temp.registrar('G1e. a falta sem vigência não deixou nada no banco além da própria linha', '4|0',
  (select count(*)::text from public.timesheet_entries where id in ('5c10b100-0000-4000-8000-000000000051', '5c10b100-0000-4000-8000-000000000052', '5c10b100-0000-4000-8000-000000000053', '5c10b100-0000-4000-8000-000000000054'))
  || '|' || (select count(*)::text from public.timesheet_entries where id in ('5c10b100-0000-4000-8000-000000000051', '5c10b100-0000-4000-8000-000000000052', '5c10b100-0000-4000-8000-000000000053', '5c10b100-0000-4000-8000-000000000054')
       and (terms_origin is not null or contract_terms_id is not null or operation_terms_id is not null or employee_cost_terms_id is not null or planned_minutes_snapshot is not null)));
select pg_temp.registrar('G1f. UPSERT de falta nova sem vigência (formato do PostgREST): grava, zerada', '1|absent|-|-|0.00|0.00',
  pg_temp.upsert(pg_temp.carga('55', 'c0', 'a1', '2025-12-30', '1', 'absent', null, null)) || '|' || pg_temp.linha('55'));

select pg_temp.registrar('G2. falta -> presença COM vigência: precifica pela data (versão corrigida da v1 = 105 / 70), fixa origem e referências', '1|present|06:00:00|15:00:00|105.00|70.00|versao|105.00|70.00|8.00|1.50|10|480.00|true/false/true',
  pg_temp.editar('51', $s$status = 'present', check_in = '06:00', check_out = '15:00'$s$) || '|' || pg_temp.linha('51') || '|' || pg_temp.fixado('51') || '|' || pg_temp.refs('51'));
select pg_temp.registrar('G2b. falta -> presença SEM vigência de contrato: recusada (P0002) e a falta NÃO é modificada', 'erro P0002|absent|-|-|0.00|0.00|-|0.00|0.00|-|-|-|-|false/false/false',
  pg_temp.editar('52', $s$status = 'present', check_in = '06:00', check_out = '15:00'$s$) || '|' || pg_temp.linha('52') || '|' || pg_temp.fixado('52') || '|' || pg_temp.refs('52'));
select pg_temp.registrar('G2c. falta -> reposição de colaborador SEM custo (E4): recusada (P0002), linha intacta', 'erro P0002|absent|-|-|0.00|0.00|-',
  pg_temp.editar('53', $s$status = 'replacement', check_in = '06:00', check_out = '15:00'$s$) || '|' || pg_temp.linha('53') || '|' || split_part(pg_temp.fixado('53'), '|', 1));
select pg_temp.registrar('G2d. falta -> presença em OP-N antes do valor acordado: recusada (P0002), linha intacta', 'erro P0002|absent|-|-|0.00|0.00',
  pg_temp.editar('54', $s$status = 'present', check_in = '06:00', check_out = '15:00'$s$) || '|' || pg_temp.linha('54'));
select pg_temp.registrar('G2e. o mesmo pelo UPSERT do PostgREST: P0002 e a falta segue intacta', 'erro P0002|absent|-|-|0.00|0.00',
  pg_temp.upsert(pg_temp.carga('55', 'c0', 'a1', '2025-12-30', '1', 'present', '06:00:00', '15:00:00')) || '|' || pg_temp.linha('55'));

select pg_temp.registrar('G3. presença -> falta: zera e PRESERVA origem, referências e snapshots (não reprecifica)', '1|absent|-|-|0.00|0.00|versao|105.00|70.00|8.00|1.50|10|480.00|true/false/true',
  pg_temp.editar('51', $s$status = 'absent', check_in = null, check_out = null$s$) || '|' || pg_temp.linha('51') || '|' || pg_temp.fixado('51') || '|' || pg_temp.refs('51'));
select pg_temp.registrar('G3b. falta -> presença de novo: reprecifica pela vigência da data (06:00-17:00: 105 + 2h*19,6875 = 144,38; custo 87,50)', '1|present|06:00:00|17:00:00|144.38|87.50|versao',
  pg_temp.editar('51', $s$status = 'present', check_in = '06:00', check_out = '17:00'$s$) || '|' || pg_temp.linha('51') || '|' || split_part(pg_temp.fixado('51'), '|', 1));
select pg_temp.registrar('G3c. presença -> falta COM troca de colaborador (E1 -> E3): zera, preserva o preço da receita e limpa só o custo do colaborador anterior', '1|absent|-|-|0.00|0.00|versao|105.00|0.00|true/false/false',
  pg_temp.editar('51', $s$status = 'absent', check_in = null, check_out = null, employee_id = '5c10f000-0000-4000-8000-000000000003'$s$) || '|' || pg_temp.linha('51')
  || '|' || split_part(pg_temp.fixado('51'), '|', 1) || '|' || split_part(pg_temp.fixado('51'), '|', 2) || '|' || split_part(pg_temp.fixado('51'), '|', 3) || '|' || pg_temp.refs('51'));
select pg_temp.registrar('G3d. o horário digitado em uma falta é ignorado (valores seguem zerados)', '1|0.00|0.00',
  pg_temp.editar('51', $s$check_in = '06:00', check_out = '23:00'$s$) || '|' || pg_temp.valores('51'));
select pg_temp.registrar('G3e. nota da falta: livre, sem alterar nada', '1|absent|0.00|0.00',
  pg_temp.editar('51', $s$notes = 'atestado'$s$) || '|' || (select status::text from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000051') || '|' || pg_temp.valores('51'));
select pg_temp.registrar('G4. a regularização de legado recusa falta (55000): não há preço a regularizar', 'erro 55000',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000052')));

-- ---------------------------------------------------------------------------
-- H. Legado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('H1. legado: editar só a NOTA segue livre e não toca nos valores', '1|present|06:00:00|17:00:00|165.00|100.00|-',
  pg_temp.editar('01', $s$notes = 'conferido'$s$) || '|' || pg_temp.linha('01') || '|' || split_part(pg_temp.fixado('01'), '|', 1));
select pg_temp.registrar('H2. legado: editar o horário é recusado (55000): exigiria um preço não comprovado', 'erro 55000|165.00|100.00',
  pg_temp.editar('01', $s$check_out = '18:00'$s$) || '|' || split_part(pg_temp.valores('01'), '|', 1) || '|' || split_part(pg_temp.valores('01'), '|', 2));
select pg_temp.registrar('H3. legado: mudar o status (inclusive virar FALTA) é recusado (55000) e a linha segue como estava', 'erro 55000|present|06:00:00|17:00:00|165.00|100.00|-',
  pg_temp.editar('06', $s$status = 'absent', check_in = null, check_out = null$s$) || '|' || pg_temp.linha('06') || '|' || split_part(pg_temp.fixado('06'), '|', 1));
select pg_temp.registrar('H3b. falta legada (valor já zero) -> presença: preço novo pelas versões, recusado (55000) em operação com legado anterior à ativação; linha intacta', 'erro 55000|absent|-|-|0.00|0.00',
  pg_temp.editar('07', $s$status = 'present', check_in = '06:00', check_out = '15:00'$s$) || '|' || pg_temp.linha('07'));
select pg_temp.registrar('H3c. legado: a falta (07) NÃO conta como legado na regra de data: ela não impede lançar nem é regularizável (55000)', 'erro 55000',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000007')));
select pg_temp.registrar('H4. legado: trocar o colaborador é recusado (55000)', 'erro 55000', pg_temp.editar('01', $s$employee_id = '5c10f000-0000-4000-8000-000000000003'$s$));
select pg_temp.registrar('H5. legado: mudar só o intervalo é recusado (55000)', 'erro 55000', pg_temp.editar('01', $s$break_minutes = 30$s$));
select pg_temp.registrar('H6. o coincidir da taxa atual NÃO libera o legado: L3 (E3) tem versões na data (100/80) e continua recusado', 'erro 55000', pg_temp.editar('03', $s$check_out = '18:00'$s$));

insert into public.invoices (id, client_id, period_start, period_end, status)
  values ('5c10b200-0000-4000-8000-000000000001', '5c10c000-0000-4000-8000-0000000000c1', date '2026-01-01', date '2026-07-31', 'closed');
update public.timesheet_entries set invoice_id = '5c10b200-0000-4000-8000-000000000001' where id = '5c10b100-0000-4000-8000-000000000002';
select pg_temp.registrar('H7. legado: faturar (vínculo de fatura, como o gerar_fatura) preserva os valores gravados', '120.00|60.00|-', pg_temp.valores('02') || '|' || split_part(pg_temp.fixado('02'), '|', 1));

select pg_temp.registrar('H8. regularização, PRÉVIA (p_aplicar = false): mostra antes e depois e NÃO grava', 'false|165.00|100.00|144.38|87.50|versao|165.00|100.00|-',
  (select (x ->> 'aplicado') || '|' || (x -> 'antes' ->> 'billed_amount') || '|' || (x -> 'antes' ->> 'cost_amount') || '|' || (x -> 'depois' ->> 'billed_amount') || '|' || (x -> 'depois' ->> 'cost_amount') || '|' || (x ->> 'fonte')
          || '|' || split_part(pg_temp.valores('01'), '|', 1) || '|' || split_part(pg_temp.valores('01'), '|', 2) || '|' || split_part(pg_temp.fixado('01'), '|', 1)
     from (select pg_temp.adm_valor(format($q$select public.regularizar_apontamento_legado(%L, 'Conferido com o contrato', false)::text$q$, '5c10b100-0000-4000-8000-000000000001'))::jsonb x) q));
select pg_temp.registrar('H8b. a prévia não deixou trilha', '0', (select count(*)::text from public.financial_terms_audit where action = 'apontamento_legado_regularizado'));
select pg_temp.registrar('H9. regularização sem motivo: 22023', 'erro 22023',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, '  ', true)$q$, '5c10b100-0000-4000-8000-000000000001')));
select pg_temp.registrar('H9b. regularização por operacional: 42501', 'erro 42501',
  pg_temp.chamar('5c100000-0000-4000-8000-0000000000a2', 'aal2', format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000001')));
select pg_temp.registrar('H10. regularização APLICADA: o apontamento adota as versões da data (105 corrigida / 70) e os valores resultantes', 'true|144.38|87.50|versao|105.00|70.00|8.00|1.50|10|480.00|true/false/true',
  (select (x ->> 'aplicado') || '|' || split_part(pg_temp.valores('01'), '|', 1) || '|' || split_part(pg_temp.valores('01'), '|', 2) || '|' || pg_temp.fixado('01') || '|' || pg_temp.refs('01')
     from (select pg_temp.adm_valor(format($q$select public.regularizar_apontamento_legado(%L, 'Conferido com o contrato', true)::text$q$, '5c10b100-0000-4000-8000-000000000001'))::jsonb x) q));
select pg_temp.registrar('H11. a trilha guarda a regularização: ator, motivo, valores anteriores e novos', '1|apontamento|165.00|144.38|Conferido com o contrato|5c100000-0000-4000-8000-0000000000a1',
  (select count(*)::text || '|' || min(entity_kind) || '|' || min(previous ->> 'billed_amount') || '|' || min(new ->> 'billed_amount') || '|' || min(reason) || '|' || min(actor_id::text)
     from public.financial_terms_audit where action = 'apontamento_legado_regularizado'));
select pg_temp.registrar('H12. depois de regularizado, o horário pode ser editado com o preço adotado: saída 18:00 -> 105 + 3h*19,6875 = 164,06; custo 70 + 3h*8,75 = 96,25', '1|present|06:00:00|18:00:00|164.06|96.25',
  pg_temp.editar('01', $s$check_out = '18:00'$s$) || '|' || pg_temp.linha('01'));
select pg_temp.registrar('H13. regularizar apontamento já com origem: 55000', 'erro 55000',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000001')));
select pg_temp.registrar('H14. regularizar apontamento FATURADO: 55000 (imutável)', 'erro 55000',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000002')));
select pg_temp.registrar('H15. regularizar onde NÃO há vigência (L4: E4 em 01/11/2025): P0002 e nada muda', 'erro P0002|165.00|87.50|-',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000004'))
  || '|' || split_part(pg_temp.valores('04'), '|', 1) || '|' || split_part(pg_temp.valores('04'), '|', 2) || '|' || split_part(pg_temp.fixado('04'), '|', 1));
select pg_temp.registrar('H16. apontamento inexistente: P0002', 'erro P0002',
  pg_temp.adm($q$public.regularizar_apontamento_legado('5c10b100-0000-4000-8000-0000000000ff', 'x', true)$q$));

-- ---------------------------------------------------------------------------
-- I. Faturado imutável
-- ---------------------------------------------------------------------------

update public.timesheet_entries set invoice_id = '5c10b200-0000-4000-8000-000000000001' where id = '5c10b100-0000-4000-8000-000000000022';
select pg_temp.registrar('I1. apontamento faturado (criado com o motor ligado): editar o horário é recusado, 42501', 'erro 42501|203.13|123.75',
  pg_temp.editar('22', $s$check_out = '17:00'$s$) || '|' || split_part(pg_temp.valores('22'), '|', 1) || '|' || split_part(pg_temp.valores('22'), '|', 2));
select pg_temp.registrar('I2. editar a nota do faturado também é recusado, 42501', 'erro 42501', pg_temp.editar('22', $s$notes = 'x'$s$));
select pg_temp.registrar('I3. apagar o faturado é recusado, 42501', 'erro 42501',
  pg_temp.adm_valor($q$with d as (delete from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000022' returning 1) select count(*)::text from d$q$));
select pg_temp.registrar('I4. a fatura segue fechada e o vínculo intacto', 'closed|2',
  (select status::text from public.invoices where id = '5c10b200-0000-4000-8000-000000000001') || '|' || (select count(*)::text from public.timesheet_entries where invoice_id = '5c10b200-0000-4000-8000-000000000001'));

update public.timesheet_entries set invoice_id = '5c10b200-0000-4000-8000-000000000001' where id = '5c10b100-0000-4000-8000-000000000051';
select pg_temp.registrar('I5. faturado: presença -> falta é recusada (42501) e o valor fica', 'erro 42501|203.13',
  pg_temp.editar('22', $s$status = 'absent', check_in = null, check_out = null$s$) || '|' || split_part(pg_temp.valores('22'), '|', 1));
select pg_temp.registrar('I6. faturado: falta (já vinculada a fatura) -> presença é recusada (42501) e segue falta zerada', 'erro 42501|absent|06:00:00|23:00:00|0.00|0.00',
  pg_temp.editar('51', $s$status = 'present', check_in = '06:00', check_out = '15:00'$s$) || '|' || pg_temp.linha('51'));
select pg_temp.registrar('I7. faturado: nem a falta pode ser apagada ou trocar de colaborador (42501)', 'erro 42501|erro 42501',
  pg_temp.editar('51', $s$employee_id = '5c10f000-0000-4000-8000-000000000001'$s$) || '|'
  || pg_temp.adm_valor($q$with d as (delete from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000051' returning 1) select count(*)::text from d$q$));

-- ---------------------------------------------------------------------------
-- J. Upsert do PostgREST e RPC do operador
-- ---------------------------------------------------------------------------

select pg_temp.folha('15', 'a1', 'a1', date '2026-03-03');
select pg_temp.registrar('J0. apontamento existente 03/03 (E1) criado com o motor ligado (versão corrigida 105): 144,38 / 87,50', 'ok|144.38|87.50', pg_temp.entrada('61', '15', '1') || '|' || pg_temp.valores('61'));
select pg_temp.registrar('J1. LOTE misto num só comando: 1 existente + 2 novas (todas com id): 3 gravadas', '3',
  pg_temp.upsert(pg_temp.carga('61', '15', 'a1', '2026-03-03', '1', _notas => 'lote') || ', '
    || pg_temp.carga('62', '15', 'a1', '2026-03-03', '3') || ', ' || pg_temp.carga('63', '15', 'a1', '2026-03-03', '2')));
select pg_temp.registrar('J1b. as novas ganharam preço da data (E3: 105/80; E2: 105/50) e origem; a existente manteve 144,38 / 87,50', '144.38|87.50|144.38|100.00|144.38|62.50|versao|versao|versao',
  pg_temp.valores('61') || '|' || pg_temp.valores('62') || '|' || pg_temp.valores('63') || '|' || split_part(pg_temp.fixado('61'), '|', 1) || '|' || split_part(pg_temp.fixado('62'), '|', 1) || '|' || split_part(pg_temp.fixado('63'), '|', 1));
select pg_temp.registrar('J2. só a NOTA mudou: valores e preços congelados intactos', '1|144.38|87.50|versao|105.00|70.00',
  pg_temp.upsert(pg_temp.carga('61', '15', 'a1', '2026-03-03', '1', _notas => 'outra'))
  || '|' || split_part(pg_temp.valores('61'), '|', 1) || '|' || split_part(pg_temp.valores('61'), '|', 2) || '|' || split_part(pg_temp.fixado('61'), '|', 1) || '|' || split_part(pg_temp.fixado('61'), '|', 2) || '|' || split_part(pg_temp.fixado('61'), '|', 3));
select pg_temp.registrar('J3. reenviar SEM alteração: aceito e intacto', '1|144.38|87.50',
  pg_temp.upsert(pg_temp.carga('61', '15', 'a1', '2026-03-03', '1', _notas => 'outra')) || '|' || pg_temp.valores('61'));
select pg_temp.registrar('J4. horário alterado pelo upsert: recalcula com o preço congelado: 105 + 3h*19,6875 = 164,06; custo 96,25', '1|164.06|96.25',
  pg_temp.upsert(pg_temp.carga('61', '15', 'a1', '2026-03-03', '1', _out => '18:00:00', _notas => 'outra')) || '|' || pg_temp.valores('61'));
select pg_temp.registrar('J5. upsert de apontamento LEGADO só com a nota: aceito, valores e origem intactos', '1|165.00|100.00|-',
  pg_temp.upsert(pg_temp.carga('03', '03', 'a5', '2026-02-02', '3', _notas => 'legado ok')) || '|' || split_part(pg_temp.valores('03'), '|', 1) || '|' || split_part(pg_temp.valores('03'), '|', 2) || '|' || split_part(pg_temp.fixado('03'), '|', 1));
select pg_temp.registrar('J6. upsert de LEGADO com horário alterado + uma linha boa no mesmo lote: o lote INTEIRO é recusado (55000) e a linha boa não foi gravada', 'erro 55000|ausente',
  pg_temp.upsert(pg_temp.carga('03', '03', 'a5', '2026-02-02', '3', _out => '18:00:00') || ', ' || pg_temp.carga('64', '15', 'a1', '2026-03-03', '4'))
  || '|' || pg_temp.valores('64'));

insert into public.user_operation_access (user_id, operation_id) values ('5c100000-0000-4000-8000-0000000000a2', '5c10e000-0000-4000-8000-0000000000a1');
insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', '5c10f000-0000-4000-8000-000000000001', true);
select pg_temp.registrar('J7. RPC do OPERADOR (aal1) com vigência na data: grava', '1',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2026-03-04',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00","check_out":"17:00","break_minutes":60}]'::jsonb)) x$q$));
select pg_temp.registrar('J7b. e o preço vem da versão da data (144,38 / 87,50, origem versao); o operador não vê valor', '144.38|87.50|versao',
  (select billed_amount::text || '|' || cost_amount::text || '|' || terms_origin from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and t.work_date = date '2026-03-04'));
select pg_temp.registrar('J8. RPC do operador reenviando a MESMA linha (upsert interno): aceita', '1',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2026-03-04',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00","check_out":"17:00","break_minutes":60,"notes":"nota do operador"}]'::jsonb)) x$q$));
select pg_temp.registrar('J8b. sem recalcular: 144,38', '144.38',
  (select billed_amount::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and t.work_date = date '2026-03-04'));
select pg_temp.registrar('J9. RPC do operador em data SEM vigência (31/12/2025): P0002', 'erro P0002',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2025-12-31',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00","check_out":"17:00","break_minutes":60}]'::jsonb)) x$q$));
select pg_temp.registrar('J9b. e nada foi gravado naquela data', '0',
  (select count(*)::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id where t.work_date = date '2025-12-31' and t.operation_id = '5c10e000-0000-4000-8000-0000000000a1'));
select pg_temp.registrar('J9c. RPC do operador registra FALTA em data SEM vigência (29/12/2025): aceita', '1',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2025-12-29',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"absent","break_minutes":0}]'::jsonb)) x$q$));
select pg_temp.registrar('J9d. a falta saiu zerada e sem origem nem referências', 'absent|0.00|0.00|nulo|false',
  (select e.status::text || '|' || e.billed_amount::text || '|' || e.cost_amount::text || '|' || coalesce(e.terms_origin, 'nulo') || '|' || (e.contract_terms_id is not null or e.employee_cost_terms_id is not null)::text
     from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and t.work_date = date '2025-12-29'));
select pg_temp.registrar('J9e. o operador tenta virar essa falta em presença na mesma data sem vigência: P0002 e a falta fica como estava', 'erro P0002|absent|0.00',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2025-12-29',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00","check_out":"17:00","break_minutes":60}]'::jsonb)) x$q$)
  || '|' || (select e.status::text || '|' || e.billed_amount::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and t.work_date = date '2025-12-29'));
select pg_temp.registrar('J9f. com vigência (04/03), o operador vira presença -> falta: a chamada é aceita', '1',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2026-03-04',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"absent","break_minutes":0}]'::jsonb)) x$q$));
select pg_temp.registrar('J9g. e a linha zerou, preservando o preço congelado (origem versao, 105)', 'absent|0.00|0.00|versao|105.00',
  (select e.status::text || '|' || e.billed_amount::text || '|' || e.cost_amount::text || '|' || e.terms_origin || '|' || e.daily_rate_snapshot::text
     from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and t.work_date = date '2026-03-04'));
select pg_temp.registrar('J9h. o operador volta a presença: aceita', '1',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', $q$select count(*)::text from (select public.salvar_apontamento_operacional('5c10e000-0000-4000-8000-0000000000a1', '5c10a000-0000-4000-8000-0000000000a1', date '2026-03-04',
      '[{"employee_id":"5c10f000-0000-4000-8000-000000000001","status":"present","check_in":"06:00","check_out":"17:00","break_minutes":60}]'::jsonb)) x$q$));
select pg_temp.registrar('J9i. e reprecifica pela vigência da data: 144,38 / 87,50', 'present|144.38|87.50',
  (select e.status::text || '|' || e.billed_amount::text || '|' || e.cost_amount::text
     from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
    where t.operation_id = '5c10e000-0000-4000-8000-0000000000a1' and t.work_date = date '2026-03-04'));
select pg_temp.registrar('J10. o operador não lê nenhuma tabela de versões nem a chave', '0|0|0|0|0',
  pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', 'select count(*)::text from public.contract_terms') || '|'
  || pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', 'select count(*)::text from public.employee_cost_terms') || '|'
  || pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', 'select count(*)::text from public.operation_terms') || '|'
  || pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', 'select count(*)::text from public.financial_engine_settings') || '|'
  || pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal1', 'select count(*)::text from public.financial_terms_audit'));

-- ---------------------------------------------------------------------------
-- K. Vínculo de contrato mutável
-- ---------------------------------------------------------------------------

select pg_temp.registrar('K1. OP-K tem apontamentos: o contrato não muda (55000)', 'erro 55000',
  pg_temp.adm_valor($q$with u as (update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d2' where id = '5c10e000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('K1b. OP-L (com legado) também não muda de contrato (55000)', 'erro 55000',
  pg_temp.adm_valor($q$with u as (update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d2' where id = '5c10e000-0000-4000-8000-0000000000a5' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('K2. OP-E, sem apontamento, pode mudar de contrato (nenhum histórico é afetado)', '1',
  pg_temp.adm_valor($q$with u as (update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d2' where id = '5c10e000-0000-4000-8000-0000000000a3' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('K2b. reenviar o MESMO contrato junto de outra edição não é recusado (a tela reenvia o objeto inteiro)', '1',
  pg_temp.adm_valor($q$with u as (update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d1', name = 'OP-E' where id = '5c10e000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$));

select pg_temp.registrar('K3. fonte ambígua: OP-A (contrato K1) ganha um valor acordado que cobre a mesma data', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c10e000-0000-4000-8000-0000000000a2', date '2026-01-01', 999, 'valor acordado antigo')$q$));
select pg_temp.folha('16', 'a2', 'a2', date '2026-03-05');
select pg_temp.registrar('K3b. apontamento em data coberta por contrato E por valor acordado: recusado (55000), não escolhe sozinho', '55000|0',
  pg_temp.entrada('71', '16', '1') || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c10b000-0000-4000-8000-000000000016'));
select pg_temp.registrar('K3c. aposentar a vigência do valor acordado desfaz a ambiguidade: usa o contrato (105)', '1|ok|144.38',
  pg_temp.adm(format($q$public.aposentar_valor_acordado_operacao(%L, 'Lançado por engano')$q$,
    (select id from public.operation_terms where operation_id = '5c10e000-0000-4000-8000-0000000000a2' and active)))
  || '|' || pg_temp.entrada('71', '16', '1') || '|' || split_part(pg_temp.valores('71'), '|', 1));

select pg_temp.folha('17', 'a5', 'a5', date '2026-02-10');
select pg_temp.registrar('K4. retroativo anterior à ativação em operação que já tinha apontamento LEGADO (OP-L): recusado (55000); o vínculo daquele período é desconhecido', '55000|0',
  pg_temp.entrada('72', '17', '1') || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c10b000-0000-4000-8000-000000000017'));
select pg_temp.registrar('K4b. a mesma data em OP-K (sem legado) é aceita normalmente', 'ok', pg_temp.entrada('73', '04', '3'));
select pg_temp.registrar('K4c. FALTA na mesma data em OP-L: aceita (falta não é precificada nem depende do vínculo)', 'ok|absent|-|-|0.00|0.00',
  pg_temp.entrada('74', '17', '2', 'absent', '', '') || '|' || pg_temp.linha('74') );
select pg_temp.registrar('K4d. mas virar presença nela é recusado (55000): voltaria a precisar do vínculo desconhecido', 'erro 55000|absent',
  pg_temp.editar('74', $s$status = 'present', check_in = '06:00', check_out = '15:00'$s$) || '|' || (select status::text from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000074'));

-- ---------------------------------------------------------------------------
-- L. Bloqueios de edição direta e congelamento de turno (ligados)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('L1. editar a diária do contrato por UPDATE direto: 55000', 'erro 55000',
  pg_temp.adm_valor($q$with u as (update public.contracts set daily_rate = 500 where id = '5c10d000-0000-4000-8000-0000000000d2' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L1b. a tela reenvia o objeto inteiro com a MESMA taxa: aceito', '1',
  pg_temp.adm_valor($q$with u as (update public.contracts set daily_rate = 150, shift_hours = 8, ot_factor = 1.5, ot_tolerance_min = 10, name = 'K2' where id = '5c10d000-0000-4000-8000-0000000000d2' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L1c. nome e dados não financeiros do contrato continuam editáveis', '1',
  pg_temp.adm_valor($q$with u as (update public.contracts set name = 'K2 renomeado' where id = '5c10d000-0000-4000-8000-0000000000d2' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L2. editar o custo do colaborador por UPDATE direto: 55000', 'erro 55000',
  pg_temp.adm_valor($q$with u as (update public.employees set daily_cost = 500 where id = '5c10f000-0000-4000-8000-000000000003' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L3. editar o valor acordado da operação por UPDATE direto: 55000', 'erro 55000',
  pg_temp.adm_valor($q$with u as (update public.operations set agreed_amount = 500 where id = '5c10e000-0000-4000-8000-0000000000a6' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L4. mudar o horário de turno USADO (SK): 23514, com dica de novo turno', 'erro 23514',
  pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '15:30' where id = '5c10a000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L4b. turno SEM uso continua com horário editável', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '16:30' where id = '5c10a000-0000-4000-8000-0000000000a9' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L4c. o nome e o status do turno usado seguem editáveis', '1',
  pg_temp.adm_valor($q$with u as (update public.shifts set name = 'SK renomeado' where id = '5c10a000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('L5. cadastrar um turno novo na operação é livre', '1',
  pg_temp.adm_valor($q$with i as (insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values ('5c10a000-0000-4000-8000-0000000000ee', '5c10e000-0000-4000-8000-0000000000a1', 'SK novo', '06:30', '15:30', 60) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('L6. o sistema (postgres) segue isento dos bloqueios (já usado em C5 e E3)', 'sem erro',
  pg_temp.erro_de($q$update public.employees set daily_cost = 80 where id = '5c10f000-0000-4000-8000-000000000003'$q$));

-- ---------------------------------------------------------------------------
-- M. Desligar (rollback funcional)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('M0. antes de desligar, as colunas antigas estão defasadas das versões vigentes hoje (K1 777, E1 80, E2 60, OP-N 250)', '777.00|80.00|60.00|250.00',
  (select (select daily_rate::text from public.contracts where id = '5c10d000-0000-4000-8000-0000000000d1') || '|' || (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000001')
       || '|' || (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000002') || '|' || (select agreed_amount::text from public.operations where id = '5c10e000-0000-4000-8000-0000000000a6')));
select pg_temp.registrar('M0b. desligar sem motivo: 22023; por operacional: 42501', 'erro 22023|erro 42501',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, ' ')$q$) || '|' || pg_temp.chamar('5c100000-0000-4000-8000-0000000000a2', 'aal2', $q$public.alterar_motor_vigencia(false, 'x')$q$));

select pg_temp.registrar('M1. DESLIGAR com motivo', '1', pg_temp.motor(false));
select pg_temp.registrar('M2. desligado de novo: motor antigo habilitado; motor novo, bloqueios e congelamento desabilitados', 'O|D|D|D|D|D', pg_temp.gatilhos());
select pg_temp.registrar('M3. as colunas antigas voltaram a refletir a versão vigente HOJE (K1 130; E1 90; E2 50; OP-N 260); K2 150 e E3 80 já estavam certos', '130.00|90.00|50.00|260.00|150.00|80.00',
  (select (select daily_rate::text from public.contracts where id = '5c10d000-0000-4000-8000-0000000000d1') || '|' || (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000001')
       || '|' || (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000002') || '|' || (select agreed_amount::text from public.operations where id = '5c10e000-0000-4000-8000-0000000000a6')
       || '|' || (select daily_rate::text from public.contracts where id = '5c10d000-0000-4000-8000-0000000000d2') || '|' || (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000003')));
select pg_temp.registrar('M3b. o colaborador E4 (nunca teve versão) não foi tocado: 70', '70.00', (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000004'));
select pg_temp.registrar('M4. a trilha guarda o desligamento, o motivo e a sincronização', '1|motor_vigencia_desativado|false|Desligado no teste|true',
  (select count(*)::text || '|' || min(action) || '|' || min(new ->> 'vigencia_ativa') || '|' || min(reason) || '|' || ((min((new -> 'sincronizacao' ->> 'contratos')::int) >= 1))::text
     from public.financial_terms_audit where action = 'motor_vigencia_desativado'));
select pg_temp.registrar('M5. estado consistente (desligado)', 'false|true',
  (select (x ->> 'ativo') || '|' || (x ->> 'consistente') from (select pg_temp.adm_valor('select public.estado_motor_vigencia()::text')::jsonb x) q));
select pg_temp.registrar('M6. o apontamento faturado criado ligado mantém valores e referências (203,13 / 123,75)', '203.13|123.75|versao|true/false/true',
  split_part(pg_temp.valores('22'), '|', 1) || '|' || split_part(pg_temp.valores('22'), '|', 2) || '|' || split_part(pg_temp.fixado('22'), '|', 1) || '|' || pg_temp.refs('22'));
select pg_temp.registrar('M7. DESLIGADO, editar o horário de L3 (legado) volta a recalcular com as colunas ATUAIS ressincronizadas: 130 + 3h*24,375 = 203,13; custo 80 + 3h*10 = 110,00', '1|present|06:00:00|18:00:00|203.13|110.00',
  pg_temp.editar('03', $s$check_out = '18:00'$s$) || '|' || pg_temp.linha('03'));
select pg_temp.folha('18', 'a1', 'a1', date '2026-04-01');
select pg_temp.registrar('M8. DESLIGADO, apontamento novo volta a ser legado: colunas atuais (K1 130, E2 50) e sem origem: 130 + 2h*24,375 = 178,75; custo 50 + 2h*6,25 = 62,50', 'ok|178.75|62.50|-|false/false/false',
  pg_temp.entrada('81', '18', '2') || '|' || split_part(pg_temp.valores('81'), '|', 1) || '|' || split_part(pg_temp.valores('81'), '|', 2) || '|' || split_part(pg_temp.fixado('81'), '|', 1) || '|' || pg_temp.refs('81'));
select pg_temp.registrar('M9. DESLIGADO, os bloqueios foram soltos: taxa do contrato, custo, valor acordado, vínculo e horário de turno editáveis', '1|1|1|1|1',
  pg_temp.adm_valor($q$with u as (update public.contracts set daily_rate = 131 where id = '5c10d000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$) || '|'
  || pg_temp.adm_valor($q$with u as (update public.employees set daily_cost = 91 where id = '5c10f000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$) || '|'
  || pg_temp.adm_valor($q$with u as (update public.operations set agreed_amount = 261 where id = '5c10e000-0000-4000-8000-0000000000a6' returning 1) select count(*)::text from u$q$) || '|'
  || pg_temp.adm_valor($q$with u as (update public.operations set contract_id = '5c10d000-0000-4000-8000-0000000000d1' where id = '5c10e000-0000-4000-8000-0000000000a3' returning 1) select count(*)::text from u$q$) || '|'
  || pg_temp.adm_valor($q$with u as (update public.shifts set end_time = '15:40' where id = '5c10a000-0000-4000-8000-0000000000a1' returning 1) select count(*)::text from u$q$));
update public.shifts set end_time = '15:00' where id = '5c10a000-0000-4000-8000-0000000000a1';
select pg_temp.registrar('M10. regularizar apontamento com o motor DESLIGADO: 55000', 'erro 55000',
  pg_temp.adm(format($q$public.regularizar_apontamento_legado(%L, 'x', true)$q$, '5c10b100-0000-4000-8000-000000000003')));
select pg_temp.registrar('M11. sincronizar_colunas_legadas à mão (admin): idempotente e auditada; a segunda chamada não muda nada', 'true|0|0|0',
  (select ((x ->> 'contratos')::int >= 1)::text || '|' || (y ->> 'contratos') || '|' || (y ->> 'colaboradores') || '|' || (y ->> 'operacoes')
     from (select pg_temp.adm_valor($q$select public.sincronizar_colunas_legadas('Sincronização manual')::text$q$)::jsonb x,
                  pg_temp.adm_valor($q$select public.sincronizar_colunas_legadas('Sincronização manual 2')::text$q$)::jsonb y) q));
select pg_temp.registrar('M11b. e deixou 2 eventos na trilha', '2', (select count(*)::text from public.financial_terms_audit where action = 'colunas_legadas_sincronizadas'));

select pg_temp.registrar('M11c. desligar normalizou as colunas antigas com jornada <= 0 (K3: 0 -> 8; K4: -3 -> 8): a mesma jornada que o motor antigo já usava', '8.00|8.00',
  (select shift_hours::text from public.contracts where id = '5c10d000-0000-4000-8000-0000000000d3') || '|' || (select shift_hours::text from public.contracts where id = '5c10d000-0000-4000-8000-0000000000d4'));

select pg_temp.folha('19', 'a3', 'a3', date '2026-03-10');
select pg_temp.folha('1a', 'a1', 'a1', date '2026-03-11');
select pg_temp.registrar('M12. LIGAR de novo (sem pendências)', '1', pg_temp.motor(true));
select pg_temp.registrar('M12a. e voltar a precificar por vigência numa operação sem legado (OP-E, 10/03): 105 + 2h*19,6875 = 144,38', 'ok|144.38|versao',
  pg_temp.entrada('82', '19', '3') || '|' || split_part(pg_temp.valores('82'), '|', 1) || '|' || split_part(pg_temp.fixado('82'), '|', 1));
select pg_temp.registrar('M12c. OP-K ganhou um apontamento legado enquanto estava desligado (M8): lançar data anterior à nova ativação nela é recusado (55000)', '55000',
  pg_temp.entrada('83', '1a', '3'));
select pg_temp.registrar('M12b. com a segunda ativação, a trilha tem dois ativados e um desativado', '2|1',
  (select count(*) filter (where action = 'motor_vigencia_ativado')::text || '|' || count(*) filter (where action = 'motor_vigencia_desativado')::text from public.financial_terms_audit));

-- ---------------------------------------------------------------------------
-- N. RPCs das migrations 023 e 024 com o motor ligado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('N1. registrar condição de contrato, custo e valor acordado seguem funcionando (23/24)', '1|1|1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d2', date '2027-01-01', 160, 8, 1.5, 10, 'K2 2027', null, true)$q$) || '|'
  || pg_temp.adm($q$public.registrar_custo_colaborador('5c10f000-0000-4000-8000-000000000002', date '2027-01-01', 55, 'E2 2027', null, true)$q$) || '|'
  || pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c10e000-0000-4000-8000-0000000000a6', date '2027-01-01', 270, 'OP-N 2027', null, true)$q$));
select pg_temp.registrar('N2. registrar versões NÃO toca nas colunas antigas (K2 segue 150; E2 segue 50): o espelho é a sincronização explícita', '150.00|50.00',
  (select (select daily_rate::text from public.contracts where id = '5c10d000-0000-4000-8000-0000000000d2') || '|' || (select daily_cost::text from public.employees where id = '5c10f000-0000-4000-8000-000000000002')));
select pg_temp.registrar('N3. a consulta por data e as funções internas seguem corretas', '105.00|130.00',
  pg_temp.adm_valor($q$select daily_rate::text from public.condicao_contrato_na_data('5c10d000-0000-4000-8000-0000000000d1', date '2026-02-10')$q$) || '|'
  || pg_temp.adm_valor($q$select daily_rate::text from public.condicao_contrato_na_data('5c10d000-0000-4000-8000-0000000000d1', date '2026-08-10')$q$));
select pg_temp.registrar('N4. o aposentar bloqueia versão referenciada, mesmo com o motor novo (55000)', 'erro 55000',
  pg_temp.adm(format($q$public.aposentar_condicao_contrato(%L, 'x')$q$,
    (select contract_terms_id from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000022'))));

-- ---------------------------------------------------------------------------
-- P. Jornada histórica <= 0 (contrato antigo): a vigência administrativa normalizada
--    reproduz o motor antigo
-- ---------------------------------------------------------------------------

-- Datas posteriores à ativação: a regra R7 (retroativo em operação com legado) não se aplica.
select pg_temp.folha_sem_turno('c1', 'a7', date '2099-01-05');
select pg_temp.folha_sem_turno('c2', 'a8', date '2099-01-05');
select pg_temp.registrar('P1. motor NOVO ligado, jornada normalizada (8 h): os mesmos números do motor antigo (K3 137,50 / 62,50; K4 112,50 / 62,50)', 'ok|137.50|62.50|ok|112.50|62.50',
  pg_temp.entrada('93', 'c1', '6') || '|' || pg_temp.valores('93') || '|' || pg_temp.entrada('94', 'c2', '6') || '|' || pg_temp.valores('94'));
select pg_temp.registrar('P2. idêntico, linha a linha, ao que o motor antigo gravou (91 e 92): receita, custo, minutos, extras e diária-base', 'true|true',
  (select (a.billed_amount, a.cost_amount, a.worked_minutes, a.overtime_minutes, a.daily_rate_snapshot, a.ot_hour_rate_snapshot, a.daily_cost_snapshot)
          = (b.billed_amount, b.cost_amount, b.worked_minutes, b.overtime_minutes, b.daily_rate_snapshot, b.ot_hour_rate_snapshot, b.daily_cost_snapshot)
     from public.timesheet_entries a, public.timesheet_entries b where a.id = '5c10b100-0000-4000-8000-000000000091' and b.id = '5c10b100-0000-4000-8000-000000000093')::text
  || '|' || (select (a.billed_amount, a.cost_amount, a.worked_minutes, a.overtime_minutes, a.daily_rate_snapshot, a.ot_hour_rate_snapshot, a.daily_cost_snapshot)
          = (b.billed_amount, b.cost_amount, b.worked_minutes, b.overtime_minutes, b.daily_rate_snapshot, b.ot_hour_rate_snapshot, b.daily_cost_snapshot)
     from public.timesheet_entries a, public.timesheet_entries b where a.id = '5c10b100-0000-4000-8000-000000000092' and b.id = '5c10b100-0000-4000-8000-000000000094')::text);
select pg_temp.registrar('P3. a jornada gravada no apontamento é a normalizada (8 h, 480 min previstos), com origem e referência da vigência administrativa', 'versao|8.00|480.00|true',
  (select terms_origin || '|' || shift_hours_snapshot::text || '|' || (shift_hours_snapshot * 60)::text || '|' || (contract_terms_id is not null)::text
     from public.timesheet_entries where id = '5c10b100-0000-4000-8000-000000000093'));
select pg_temp.registrar('P4. a constraint NÃO foi afrouxada: versão com jornada 0 ou negativa é recusada (23514)', 'sem 23514 -> 23514|23514',
  'sem 23514 -> ' || pg_temp.erro_de($q$insert into public.contract_terms (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason)
      values ('5c10d000-0000-4000-8000-0000000000d3', date '2000-01-01', date '2000-02-01', 100, 0, 1.5, 10, 'informada', 'x')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.contract_terms (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason)
      values ('5c10d000-0000-4000-8000-0000000000d4', date '2000-01-01', date '2000-02-01', 100, -3, 1.5, 10, 'informada', 'x')$q$)
  );
select pg_temp.registrar('P5. nem a RPC administrativa aceita registrar jornada 0 (a normalização é explícita, nunca silenciosa)', 'erro 23514',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c10d000-0000-4000-8000-0000000000d3', date '2000-01-01', 100, 0, 1.5, 10, 'x', date '2000-02-01')$q$));

-- ---------------------------------------------------------------------------
-- O. Permissões e inventário
-- ---------------------------------------------------------------------------

do $perm$
declare
  _a1 constant text := '5c100000-0000-4000-8000-0000000000a1';
  _a2 constant text := '5c100000-0000-4000-8000-0000000000a2';
  _a3 constant text := '5c100000-0000-4000-8000-0000000000a3';
  _chamadas text[] := array[
    'select public.alterar_motor_vigencia(false, ''x'')::text',
    'select public.sincronizar_colunas_legadas(''x'')::text',
    'select public.estado_motor_vigencia()::text',
    'select public.regularizar_apontamento_legado(''5c10b100-0000-4000-8000-000000000003'', ''x'', false)::text',
    'select count(*)::text from public.pendencias_implantacao_vigencias()'];
  _c text;
  _n int := 0;
begin
  foreach _c in array _chamadas loop
    _n := _n + 1;
    perform pg_temp.registrar(format('O1. RPC %s: admin em AAL1 recusado (42501)', _n), 'erro 42501', pg_temp.como(_a1, 'aal1', _c));
    perform pg_temp.registrar(format('O2. RPC %s: operacional em AAL2 recusado (42501)', _n), 'erro 42501', pg_temp.como(_a2, 'aal2', _c));
    perform pg_temp.registrar(format('O3. RPC %s: sem papel em AAL2 recusado (42501)', _n), 'erro 42501', pg_temp.como(_a3, 'aal2', _c));
    perform pg_temp.registrar(format('O4. RPC %s: anônimo recusado (sem EXECUTE, 42501)', _n), 'erro 42501',
      pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), _c));
    perform pg_temp.registrar(format('O5. RPC %s: service_role recusado (sem EXECUTE, 42501)', _n), 'erro 42501',
      pg_temp.medir_como('service_role', jsonb_build_object('role', 'service_role', 'sub', _a1, 'aal', 'aal2'), _c));
    perform pg_temp.registrar(format('O6. RPC %s: sem sub no JWT recusado (28000)', _n), 'erro 28000',
      pg_temp.medir_como('authenticated', jsonb_build_object('role', 'authenticated', 'aal', 'aal2'), _c));
    perform pg_temp.registrar(format('O7. RPC %s: admin AAL2 com sessão inexistente recusado (42501)', _n), 'erro 42501',
      pg_temp.medir_como('authenticated', jsonb_build_object('sub', _a1, 'role', 'authenticated', 'aal', 'aal2', 'session_id', 'ec100000-0000-4000-8000-0000000000ff'), _c));
  end loop;
end;
$perm$;

select pg_temp.registrar('O8. admin AAL2 NÃO executa nenhuma das funções internas (sem EXECUTE)', 'erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.adm_valor($q$select public.motor_ativo()::text$q$) || '|'
  || pg_temp.adm_valor($q$select (public.motor_fonte_do_dia('5c10e000-0000-4000-8000-0000000000a1', date '2026-02-10')).o_origem$q$) || '|'
  || pg_temp.adm_valor($q$select public.motor_sincronizar_colunas_interno()::text$q$) || '|'
  || pg_temp.adm_valor($q$select count(*)::text from public.motor_pendencias()$q$));
select pg_temp.registrar('O9. a chave: admin AAL2 lê a linha; operacional lê zero', '1|0',
  pg_temp.adm_valor('select count(*)::text from public.financial_engine_settings') || '|' || pg_temp.como('5c100000-0000-4000-8000-0000000000a2', 'aal2', 'select count(*)::text from public.financial_engine_settings'));
select pg_temp.registrar('O10. ninguém escreve na chave pela API: UPDATE, DELETE e INSERT recusados', 'erro 42501|erro 42501|erro 42501',
  pg_temp.adm_valor($q$with u as (update public.financial_engine_settings set vigencia_ativa = false returning 1) select count(*)::text from u$q$) || '|'
  || pg_temp.adm_valor($q$with d as (delete from public.financial_engine_settings returning 1) select count(*)::text from d$q$) || '|'
  || pg_temp.adm_valor($q$with i as (insert into public.financial_engine_settings (id) values (false) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('O11. a chave não é apagada nem pelo dono: DELETE e TRUNCATE recusados', '42501',
  pg_temp.erro_de('delete from public.financial_engine_settings'));
select pg_temp.registrar('O11b. TRUNCATE recusado', '42501', pg_temp.erro_de('truncate public.financial_engine_settings'));
select pg_temp.registrar('O11c. e a linha única segue lá', '1', (select count(*)::text from public.financial_engine_settings));
select pg_temp.registrar('O12. 5 RPCs só para authenticated; 11 internas sem EXECUTE de API', '5|11',
  (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('estado_motor_vigencia', 'pendencias_implantacao_vigencias', 'alterar_motor_vigencia', 'sincronizar_colunas_legadas', 'regularizar_apontamento_legado')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')
      and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
  || '|' || (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('motor_ativo', 'motor_minutos_previstos', 'motor_fonte_do_dia', 'motor_custo_do_dia', 'motor_pendencias', 'motor_sincronizar_colunas_interno',
                        'derivar_valores_por_vigencia', 'bloquear_taxa_direta_contrato', 'bloquear_taxa_direta_colaborador', 'bloquear_taxa_direta_operacao', 'proteger_chave_do_motor')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')));
select pg_temp.registrar('O13. as 12 funções SECURITY DEFINER novas são do postgres, com search_path fixo; as 4 de gatilho/guarda são INVOKER', '12|4',
  (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proowner = 'postgres'::regrole
      and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%'
      and p.proname in ('motor_ativo', 'motor_minutos_previstos', 'motor_fonte_do_dia', 'motor_custo_do_dia', 'motor_pendencias', 'motor_sincronizar_colunas_interno',
                        'derivar_valores_por_vigencia', 'estado_motor_vigencia', 'pendencias_implantacao_vigencias', 'alterar_motor_vigencia', 'sincronizar_colunas_legadas', 'regularizar_apontamento_legado'))
  || '|' || (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and not p.prosecdef
      and p.proname in ('bloquear_taxa_direta_contrato', 'bloquear_taxa_direta_colaborador', 'bloquear_taxa_direta_operacao', 'proteger_chave_do_motor')));
select pg_temp.registrar('O14. a chave: RLS, 2 policies, nenhuma de escrita, só SELECT para authenticated', 'true|2|0|true',
  (select (select relrowsecurity from pg_class where oid = 'public.financial_engine_settings'::regclass)::text
       || '|' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'financial_engine_settings')::text
       || '|' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'financial_engine_settings' and cmd in ('INSERT', 'UPDATE', 'DELETE'))::text
       || '|' || (has_table_privilege('authenticated', 'public.financial_engine_settings', 'SELECT') and not has_table_privilege('authenticated', 'public.financial_engine_settings', 'INSERT')
                  and not has_table_privilege('service_role', 'public.financial_engine_settings', 'SELECT') and not has_table_privilege('bslog_rpc_operacional', 'public.financial_engine_settings', 'SELECT'))::text));
select pg_temp.registrar('O15. a trilha aceita as 16 ações e as 5 entidades; evento desconhecido continua recusado (23514)', '16|23514',
  (select count(*)::text from unnest(array['contrato_condicao_registrada', 'contrato_condicao_corrigida', 'contrato_condicao_encerrada', 'contrato_condicao_aposentada',
        'colaborador_custo_registrado', 'colaborador_custo_corrigido', 'colaborador_custo_encerrado', 'colaborador_custo_aposentado',
        'operacao_valor_registrado', 'operacao_valor_corrigido', 'operacao_valor_encerrado', 'operacao_valor_aposentado',
        'motor_vigencia_ativado', 'motor_vigencia_desativado', 'colunas_legadas_sincronizadas', 'apontamento_legado_regularizado']) a
      where pg_get_constraintdef((select oid from pg_constraint where conname = 'financial_terms_audit_acao_valida')) like '%' || a || '%')
  || '|' || pg_temp.erro_de($q$insert into public.financial_terms_audit (actor_id, action, entity_kind, entity_id, term_id, reason) values ('5c100000-0000-4000-8000-0000000000a1', 'motor_ligado_na_marra', 'sistema', '5c10c000-0000-4000-8000-0000000000c1', '5c10c000-0000-4000-8000-0000000000c1', 'x')$q$));
select pg_temp.registrar('O16. a derivação antiga (010) e gerar_fatura continuam sem citar o motor novo', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('derivar_valores_financeiros', 'gerar_fatura')
     and (prosrc ilike '%vigencia%' or prosrc ilike '%financial_engine_settings%' or prosrc ilike '%_terms%')));
select pg_temp.registrar('O17. todo evento do motor tem ator, motivo e entidade', '0',
  (select count(*)::text from public.financial_terms_audit where entity_kind in ('sistema', 'apontamento') and (actor_id is null or btrim(reason) = '' or entity_id is null or term_id is null)));
select pg_temp.registrar('O18. o estado final do teste (ligado) é consistente', 'true|true',
  (select (x ->> 'ativo') || '|' || (x ->> 'consistente') from (select pg_temp.adm_valor('select public.estado_motor_vigencia()::text')::jsonb x) q));

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
    raise exception '021_motor_vigencia: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
