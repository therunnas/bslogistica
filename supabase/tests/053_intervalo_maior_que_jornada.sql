-- GATE-FIN-03 · migration 053 — o intervalo não pode ser maior que o tempo entre entrada e saída.
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Tudo numa transação que
-- termina em ROLLBACK. NUNCA rodar contra Production nem homologação.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION E FALHA SEM ELA (RED da sessão 19): sem a 053, 19 de
-- 31 casos falham (A1–A3, B1, B1b, B2 em cascata do B1, B7, B9b, B10, B11, C1–C4, D3, E1, E3, F1,
-- F3) — o banco aceita o intervalo maior e zera a jornada (SQL 090 I5).
--
-- MOTOR. Roda com o motor por vigência DESLIGADO (o runner nasce assim; se ligado, é desligado na
-- transação), que é onde o I5 era aceito. Com o motor LIGADO o núcleo (035) já recusava a jornada
-- zerada com 22023 `nucleo:zero_minuto_com_horarios`, sem dizer o que corrigir; a 053 dispara antes
-- dele e vale nos dois estados. O caminho com o motor ligado é provado no E2E (spec 80, IJ1–IJ4),
-- inclusive o limite exato, que o núcleo continua recusando.
--
-- A REGRA (estrutural, sem decisão comercial): com status diferente de `absent` e entrada E saída
-- preenchidas, `break_minutes` não pode passar da duração bruta — a MESMA fórmula do motor
-- (014/036/048/051): hora*60+minuto; saída menor ou igual à entrada soma 1440.
--
-- O QUE CONTINUA VALENDO E É PROVADO AQUI: intervalo igual à duração (limite, jornada 0, aceito
-- pela 053; com o motor desligado é gravado, como antes); virada
-- legítima da meia-noite; intervalo zero; ausência; apontamento incompleto; correção e fatura de
-- linha histórica que já violava a regra (o trigger não revalida o que não mudou); valores
-- financeiros de dado válido idênticos aos de antes.
--
-- O QUE ESTE ARQUIVO NÃO PROVA, de propósito: jornada máxima (DEC-CP05-01, 054/058) nem saída antes
-- da entrada em turno diurno (I1) — 08:00→07:50 tem duração bruta 1430 e continua aceita.

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
-- Igual, mas devolve também a mensagem e a dica (o que a interface do admin mostra).
create or replace function pg_temp.mensagem_como(_uid text, _sql text) returns text language plpgsql as $$
declare _m text; _h text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', _uid, 'role', 'authenticated',
    'aal', 'aal1', 'session_id', 'e5' || substr(_uid, 3))::text, true);
  set local role authenticated;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics _m = message_text, _h = pg_exception_hint;
    set local role postgres;
    return sqlstate || '|' || _m || '|' || coalesce(_h, '');
  end;
  set local role postgres;
  return 'aceito';
end;
$$;
-- Resultado de cada chamada, gravado num comando e conferido no SEGUINTE: uma consulta no mesmo
-- comando da escrita enxerga o retrato de antes dela (artefato já visto no CP-10 e na 052).
create temporary table _chamada (k text primary key, v text) on commit drop;

-- Admin SEM fator verificado (AAL1 basta: MFA opcional, 034) e operador da operação.
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c530000-0000-4000-8000-0000000000a1', _sql) $$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c530000-0000-4000-8000-0000000000a2', _sql) $$;

insert into auth.users (id) values ('5c530000-0000-4000-8000-0000000000a1'), ('5c530000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('e5530000-0000-4000-8000-0000000000a1', '5c530000-0000-4000-8000-0000000000a1', null),
  ('e5530000-0000-4000-8000-0000000000a2', '5c530000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c530000-0000-4000-8000-0000000000a1', 'admin'), ('5c530000-0000-4000-8000-0000000000a2', 'operacional');

-- Motor por vigência desligado nesta transação (o runner já nasce assim; o banco do E2E não).
do $$
begin
  if (select vigencia_ativa from public.financial_engine_settings) then
    perform pg_temp.adm($q$select public.alterar_motor_vigencia(false, 'GATE-FIN-03 sintético', true)::text$q$);
  end if;
end $$;

-- Fixture: diária 200 por 8 h, custo 120. Uma folha por dia (unicidade diária por operação).
insert into public.clients (id, name) values ('5c53c000-0000-4000-8000-0000000000c1', 'GF03 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from) values
  ('5c53d000-0000-4000-8000-0000000000d1', '5c53c000-0000-4000-8000-0000000000c1', 'GF03 K', 200, 8, 1.5, 10, '2026-01-01');
insert into public.operations (id, client_id, contract_id, type, name) values
  ('5c53e000-0000-4000-8000-0000000000e1', '5c53c000-0000-4000-8000-0000000000c1', '5c53d000-0000-4000-8000-0000000000d1', 'fixed', 'GF03 fixa');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('5c53a000-0000-4000-8000-000000000001', '5c53e000-0000-4000-8000-0000000000e1', 'Dia 08-17', '08:00', '17:00', 60, false),
  ('5c53a000-0000-4000-8000-000000000002', '5c53e000-0000-4000-8000-0000000000e1', 'Noite 22-07', '22:00', '07:00', 60, true);
insert into public.employees (id, name, daily_cost)
  select ('5c53f000-0000-4000-8000-00000000000' || n)::uuid, 'GF03 E' || n, 120 from generate_series(1, 9) n;
insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000007', true),
  ('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000008', true);
insert into public.user_operation_access (user_id, operation_id) values
  ('5c530000-0000-4000-8000-0000000000a2', '5c53e000-0000-4000-8000-0000000000e1');
insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('5c53b000-0000-4000-8000-000000000001', '5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-02', 'open'),
  ('5c53b000-0000-4000-8000-000000000002', '5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000002', '2026-03-03', 'open'),
  ('5c53b000-0000-4000-8000-000000000003', '5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-04', 'open'),
  ('5c53b000-0000-4000-8000-000000000004', '5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-05', 'open');

-- ---------------------------------------------------------------------------
-- A. Catálogo
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. trigger BEFORE INSERT OR UPDATE FOR EACH ROW, habilitado, na tabela de apontamentos',
  '23|O|recusar_intervalo_maior_que_jornada',
  (select t.tgtype::text || '|' || t.tgenabled::text || '|' || p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.timesheet_entries'::regclass and t.tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior'));
select pg_temp.registrar('A2. a função é SECURITY DEFINER da postgres e fixa o search_path',
  'true|postgres|true',
  (select p.prosecdef || '|' || pg_get_userbyid(p.proowner) || '|'
          || exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = to_regprocedure('public.recusar_intervalo_maior_que_jornada()')));
select pg_temp.registrar('A3. ninguém de fora executa a função (anon, authenticated, service_role, operacional, PUBLIC)', '0',
  (select case when to_regprocedure('public.recusar_intervalo_maior_que_jornada()') is null then 'função ausente'
     else ((select count(*) from unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r
              where has_function_privilege(r, to_regprocedure('public.recusar_intervalo_maior_que_jornada()'), 'EXECUTE'))
           + (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = to_regprocedure('public.recusar_intervalo_maior_que_jornada()')
                 and a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text end));

-- ---------------------------------------------------------------------------
-- B. Escrita direta pela API (PostgREST = authenticated), admin
-- ---------------------------------------------------------------------------

insert into _chamada select 'B1',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000001', 'present', '08:00', '09:00', 61) returning 'aceito'$q$);
select pg_temp.registrar('B1. INSERT 08:00→09:00 com intervalo 61 é recusado (23514) e nada é gravado', 'erro 23514|0',
  (select v from _chamada where k = 'B1')
  || '|' || (select count(*)::text from public.timesheet_entries where employee_id = '5c53f000-0000-4000-8000-000000000001'));
select pg_temp.registrar('B1b. a mensagem diz o que corrigir, com os minutos, sem texto cru do PostgreSQL (a tela do admin a mostra como está)',
  '23514|O intervalo de 61 min é maior que o tempo entre a entrada e a saída (60 min). Corrija o intervalo ou os horários antes de salvar.|Para turno que vira a meia-noite, a saída é menor que a entrada (ex.: 22:00 → 06:00).',
  pg_temp.mensagem_como('5c530000-0000-4000-8000-0000000000a1', $q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000001', 'present', '08:00', '09:00', 61)$q$));
select pg_temp.registrar('B2. limite exato: intervalo IGUAL à duração (08:00→09:00 com 60) é aceito — jornada 0 (caso B, sem regra nova)', 'aceito|0',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000001', 'present', '08:00', '09:00', 60)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$));
select pg_temp.registrar('B3. intervalo zero é aceito (08:00→09:00 = 60 min trabalhados)', 'aceito|60',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000002', 'present', '08:00', '09:00', 0)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$));
select pg_temp.registrar('B4. valores financeiros de dado válido iguais aos de antes (08:00→17:00, 60: 480 min, sem HE, R$ 200 / R$ 120)',
  '480|0|200.00|120.00',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000003', 'present', '08:00', '17:00', 60)
    returning worked_minutes, overtime_minutes, billed_amount, cost_amount)
    select worked_minutes || '|' || overtime_minutes || '|' || billed_amount || '|' || cost_amount from i$q$));
select pg_temp.registrar('B5. virada legítima da meia-noite (22:00→07:00 com 60) é aceita com 480', 'aceito|480|200.00',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000002', '5c53f000-0000-4000-8000-000000000001', 'present', '22:00', '07:00', 60)
    returning worked_minutes, billed_amount) select 'aceito|' || worked_minutes || '|' || billed_amount from i$q$));
select pg_temp.registrar('B6. virada no limite (23:00→01:00 com 120) é aceita', 'aceito|0',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000002', '5c53f000-0000-4000-8000-000000000002', 'present', '23:00', '01:00', 120)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$));
select pg_temp.registrar('B7. virada com intervalo maior (23:00→01:00 com 121) é recusada', 'erro 23514',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000002', '5c53f000-0000-4000-8000-000000000003', 'present', '23:00', '01:00', 121) returning 'aceito'$q$));
select pg_temp.registrar('B8. ausência com horários e intervalo maior é aceita (o motor não usa intervalo de ausência)', 'aceito|0',
  pg_temp.adm($q$with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000004', 'absent', '08:00', '09:00', 300)
    returning worked_minutes) select 'aceito|' || worked_minutes from i$q$));
select pg_temp.registrar('B9. incompleto (sem saída) com intervalo 300 é aceito (não há duração para comparar; caso H)', 'aceito',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c53b000-0000-4000-8000-000000000001', '5c53f000-0000-4000-8000-000000000005', 'present', '08:00', null, 300) returning 'aceito'$q$));
insert into _chamada select 'B9b',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '09:00'
    where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000005' returning 'aceito'$q$);
select pg_temp.registrar('B9b. ao completar a saída (09:00) com o intervalo 300, o UPDATE é recusado e a saída segue vazia', 'erro 23514|nulo',
  (select v from _chamada where k = 'B9b')
  || '|' || coalesce((select check_out::text from public.timesheet_entries
    where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000005'), 'nulo'));
insert into _chamada select 'B10',
  pg_temp.adm($q$insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
    ('5c53b000-0000-4000-8000-000000000002', '5c53f000-0000-4000-8000-000000000005', 'present', '22:00', '07:00', 60),
    ('5c53b000-0000-4000-8000-000000000002', '5c53f000-0000-4000-8000-000000000006', 'present', '22:00', '23:00', 90) returning 'aceito'$q$);
select pg_temp.registrar('B10. INSERT de várias linhas com UMA inválida é recusado inteiro', 'erro 23514|0',
  (select v from _chamada where k = 'B10')
  || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c53b000-0000-4000-8000-000000000002'
               and employee_id in ('5c53f000-0000-4000-8000-000000000005', '5c53f000-0000-4000-8000-000000000006')));
insert into _chamada select 'B11',
  pg_temp.adm($q$insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    select id, timesheet_id, employee_id, status, check_in, check_out, 600 from public.timesheet_entries
     where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003'
    on conflict (id) do update set break_minutes = excluded.break_minutes returning 'aceito'$q$);
select pg_temp.registrar('B11. upsert pela chave (caminho anterior da tela: ON CONFLICT (id) DO UPDATE) com intervalo maior é recusado; a linha fica',
  'erro 23514|60',
  (select v from _chamada where k = 'B11')
  || '|' || (select break_minutes::text from public.timesheet_entries
    where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003'));

-- ---------------------------------------------------------------------------
-- C. UPDATE direto
-- ---------------------------------------------------------------------------

create temporary table _antes_c on commit drop as
  select worked_minutes, billed_amount, cost_amount, break_minutes, check_out from public.timesheet_entries
   where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003';
select pg_temp.registrar('C1. UPDATE que sobe o intervalo acima da duração (540 → 541) é recusado', 'erro 23514',
  pg_temp.adm($q$update public.timesheet_entries set break_minutes = 541
    where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003' returning 'aceito'$q$));
select pg_temp.registrar('C2. UPDATE que encolhe a saída (17:00 → 08:30) mantendo 60 é recusado', 'erro 23514',
  pg_temp.adm($q$update public.timesheet_entries set check_out = '08:30'
    where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003' returning 'aceito'$q$));
select pg_temp.registrar('C3. depois das recusas a linha e os valores ficaram como estavam', 'true',
  ((select (worked_minutes, billed_amount, cost_amount, break_minutes, check_out) from public.timesheet_entries
     where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003')
   = (select (worked_minutes, billed_amount, cost_amount, break_minutes, check_out) from _antes_c))::text);
select pg_temp.registrar('C4. UPDATE válido (intervalo 30) continua aceito e recalcula pela regra de sempre', '1|510',
  pg_temp.adm($q$with u as (update public.timesheet_entries set break_minutes = 30
    where timesheet_id = '5c53b000-0000-4000-8000-000000000001' and employee_id = '5c53f000-0000-4000-8000-000000000003' returning worked_minutes)
    select count(*) || '|' || max(worked_minutes) from u$q$));

-- ---------------------------------------------------------------------------
-- D. Linha HISTÓRICA que já violava (gravada antes da 053): não trava correção nem fatura
-- ---------------------------------------------------------------------------

do $$
begin
  -- Simula o legado: grava com o trigger da 053 desligado, só nesta transação (ROLLBACK no fim).
  if exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass
              and tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior') then
    alter table public.timesheet_entries disable trigger trg_timesheet_entries_bloqueia_intervalo_maior;
  end if;
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values ('5c53b100-0000-4000-8000-000000000001', '5c53b000-0000-4000-8000-000000000004',
          '5c53f000-0000-4000-8000-000000000009', 'present', '08:00', '09:00', 300);
  if exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass
              and tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior') then
    alter table public.timesheet_entries enable trigger trg_timesheet_entries_bloqueia_intervalo_maior;
  end if;
end $$;
create temporary table _hist on commit drop as
  select billed_amount, cost_amount, worked_minutes from public.timesheet_entries where id = '5c53b100-0000-4000-8000-000000000001';
select pg_temp.registrar('D1. o histórico violador continua editável no que não é jornada (observação)', '1',
  pg_temp.adm($q$with u as (update public.timesheet_entries set notes = 'conferido GF03'
    where id = '5c53b100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('D2. e os valores dele não mudaram (nada é recalculado por fora)', 'true',
  ((select (billed_amount, cost_amount, worked_minutes) from public.timesheet_entries where id = '5c53b100-0000-4000-8000-000000000001')
   = (select (billed_amount, cost_amount, worked_minutes) from _hist))::text);
select pg_temp.registrar('D3. mexer no intervalo dele para outro valor inválido é recusado', 'erro 23514',
  pg_temp.adm($q$update public.timesheet_entries set break_minutes = 200
    where id = '5c53b100-0000-4000-8000-000000000001' returning 'aceito'$q$));
select pg_temp.registrar('D4. corrigir para um valor válido é aceito (o caminho de correção existe)', '1|60',
  pg_temp.adm($q$with u as (update public.timesheet_entries set break_minutes = 0
    where id = '5c53b100-0000-4000-8000-000000000001' returning worked_minutes) select count(*) || '|' || max(worked_minutes) from u$q$));
-- Volta ao estado violador (pela dona, com o trigger desligado) para provar a fatura do legado.
do $$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass
              and tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior') then
    alter table public.timesheet_entries disable trigger trg_timesheet_entries_bloqueia_intervalo_maior;
  end if;
  update public.timesheet_entries set break_minutes = 300 where id = '5c53b100-0000-4000-8000-000000000001';
  if exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass
              and tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior') then
    alter table public.timesheet_entries enable trigger trg_timesheet_entries_bloqueia_intervalo_maior;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- E. RPC do admin (salvar_apontamento_admin, a tela do admin)
-- ---------------------------------------------------------------------------

insert into _chamada select 'E1',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-06',
    '[{"employee_id":"5c53f000-0000-4000-8000-000000000001","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60},
      {"employee_id":"5c53f000-0000-4000-8000-000000000002","status":"present","check_in":"08:00","check_out":"09:00","break_minutes":300}]'::jsonb))::text$q$);
select pg_temp.registrar('E1. RPC do admin com intervalo maior é recusada inteira (23514): nenhuma linha nem folha nova', 'erro 23514|0|0',
  (select v from _chamada where k = 'E1')
  || '|' || (select count(*)::text from public.timesheets where operation_id = '5c53e000-0000-4000-8000-0000000000e1' and work_date = '2026-03-06')
  || '|' || (select count(*)::text from public.timesheet_entries where work_date = '2026-03-06'));
select pg_temp.registrar('E2. RPC do admin no limite (60 em 60) e com virada válida salva normalmente', '2',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-06',
    '[{"employee_id":"5c53f000-0000-4000-8000-000000000001","status":"present","check_in":"08:00","check_out":"09:00","break_minutes":60},
      {"employee_id":"5c53f000-0000-4000-8000-000000000002","status":"present","check_in":"22:00","check_out":"07:00","break_minutes":60}]'::jsonb)) ->> 'gravadas'$q$));
insert into _chamada select 'E3',
  pg_temp.adm($q$select (public.salvar_apontamento_admin('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-06',
    '[{"employee_id":"5c53f000-0000-4000-8000-000000000001","status":"present","check_in":"08:00","check_out":"09:00","break_minutes":61}]'::jsonb))::text$q$);
select pg_temp.registrar('E3. RPC do admin que edita linha existente para intervalo maior é recusada; a linha fica', 'erro 23514|60',
  (select v from _chamada where k = 'E3')
  || '|' || (select break_minutes::text from public.timesheet_entries where work_date = '2026-03-06'
               and employee_id = '5c53f000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- F. RPC do operador (salvar_apontamento_operacional, dona bslog_rpc_operacional, ON CONFLICT)
-- ---------------------------------------------------------------------------

insert into _chamada select 'F1',
  pg_temp.ope($q$select public.salvar_apontamento_operacional('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-04',
    '[{"employee_id":"5c53f000-0000-4000-8000-000000000007","status":"present","check_in":"08:00","check_out":"09:00","break_minutes":61}]'::jsonb)::text$q$);
select pg_temp.registrar('F1. RPC do operador com intervalo maior é recusada (23514) e nada é gravado', 'erro 23514|0',
  (select v from _chamada where k = 'F1')
  || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c53b000-0000-4000-8000-000000000003'));
insert into _chamada select 'F2',
  pg_temp.ope($q$select public.salvar_apontamento_operacional('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-04',
    '[{"employee_id":"5c53f000-0000-4000-8000-000000000007","status":"present","check_in":"08:00","check_out":"09:00","break_minutes":60},
      {"employee_id":"5c53f000-0000-4000-8000-000000000008","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60}]'::jsonb)::text$q$);
select pg_temp.registrar('F2. RPC do operador no limite (60 em 60) e com o turno normal salva as duas linhas', 'ok|2',
  (select case when v like 'erro %' then v else 'ok' end from _chamada where k = 'F2')
  || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c53b000-0000-4000-8000-000000000003'));
insert into _chamada select 'F3',
  pg_temp.ope($q$select public.salvar_apontamento_operacional('5c53e000-0000-4000-8000-0000000000e1', '5c53a000-0000-4000-8000-000000000001', '2026-03-04',
    '[{"employee_id":"5c53f000-0000-4000-8000-000000000008","status":"present","check_in":"08:00","check_out":"09:00","break_minutes":61}]'::jsonb)::text$q$);
select pg_temp.registrar('F3. RPC do operador que edita (ON CONFLICT DO UPDATE) para intervalo maior é recusada; a linha fica', 'erro 23514|17:00:00|60',
  (select v from _chamada where k = 'F3')
  || '|' || (select check_out || '|' || break_minutes from public.timesheet_entries where timesheet_id = '5c53b000-0000-4000-8000-000000000003'
               and employee_id = '5c53f000-0000-4000-8000-000000000008'));

-- ---------------------------------------------------------------------------
-- G. Fatura: o histórico violador não trava a emissão (o vínculo não mexe em jornada)
-- ---------------------------------------------------------------------------

create temporary table _fatura on commit drop as
  select pg_temp.adm($q$select (public.gerar_fatura('5c53c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$) as id;
select pg_temp.registrar('G1. a fatura da quinzena sai, com o histórico violador vinculado e o valor dele como estava', 'true|true',
  ((select id from _fatura) ~ '^[0-9a-f-]{36}$')::text || '|' ||
  ((select (invoice_id is not null and billed_amount = (select billed_amount from _hist))
      from public.timesheet_entries where id = '5c53b100-0000-4000-8000-000000000001'))::text);

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select situacao, caso, esperado, obtido from _resultado order by ordem;

do $$
declare _falhas int; _total int;
begin
  select count(*) filter (where situacao = 'FAIL'), count(*) into _falhas, _total from _resultado;
  if _falhas > 0 then
    raise exception 'GATE-FIN-03 (053): % de % caso(s) divergente(s) — ver o relatório acima', _falhas, _total;
  end if;
  raise notice 'GATE-FIN-03 (053): % casos conferidos; tudo será desfeito.', _total;
end $$;

rollback;
