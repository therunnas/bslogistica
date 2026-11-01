-- `break_minutes` não é negativo — a invariante que a migration 014 fechou.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`, então nada é
-- criado, alterado ou removido.
--
-- ESTE TESTE FOI ESCRITO JUNTO COM A MIGRATION, E FALHA SEM ELA. Contra o
-- schema anterior à 014 os blocos A, B, C e D falham: as constraints não
-- existem e as escritas negativas passam. Nenhuma expectativa foi invertida
-- para fabricar um PASS.
--
-- O PONTO DO ARQUIVO É A PARIDADE. A regra precisa valer nos DOIS caminhos de
-- escrita — o admin em AAL2, direto na tabela, e o operador em AAL1, pela RPC
-- —, porque a autoridade é a tabela e não a função. Testar só a RPC deixaria o
-- admin livre para inflar o valor derivado, que foi exatamente o estado
-- anterior.
--
-- O QUE ESTE ARQUIVO NÃO PROVA: que existe teto. Não existe, de propósito —
-- `break_minutes` maior que a jornada continua aceito e é absorvido pelo
-- `GREATEST(0, …)` da 010. Teto é decisão separada, registrada no PROGRESS.md.

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
) on commit drop;

-- `security definer` pelo mesmo motivo do 005, do 008 e do 009: os blocos
-- rodam sob `set local role authenticated`, que não escreve na temporária do
-- `postgres`.
create or replace function pg_temp.registrar(
  _caso text, _esperado text, _obtido text
) returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido,
          case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;

-- Executa `_sql` sob o papel e os claims pedidos e devolve 'ok' ou
-- 'erro <sqlstate>'. O bloco `exception` cria um savepoint implícito, então a
-- recusa de um caso não aborta a transação inteira; e o papel volta a
-- `postgres` mesmo quando a chamada levanta, senão o caso seguinte mediria
-- outra coisa.
create or replace function pg_temp.executar(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
declare _claims jsonb;
begin
  _claims := jsonb_build_object('sub', _uid, 'session_id', 'e' || substr(_uid::text, 2), 'role', 'authenticated', 'aal', _aal);
  perform set_config('request.jwt.claims', _claims::text, true);
  set local role authenticated;
  begin
    execute _sql;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return 'ok';
end;
$$;

-- Mesma ideia, para uma consulta de uma coluna.
create or replace function pg_temp.medir(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', _uid, 'session_id', 'e' || substr(_uid::text, 2), 'role', 'authenticated', 'aal', _aal)::text, true);
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


-- ---------------------------------------------------------------------------
-- Fixture
--
-- Duas contas: um admin, que escreve direto na tabela em AAL2, e um operador
-- sem MFA, que só alcança a superfície pela RPC em AAL1. O contrato é o mesmo
-- usado na medição que motivou a 014, para que os números do bloco E possam
-- ser conferidos à mão.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('0a000000-0000-4000-8000-000000000001'),   -- operacional, sem MFA
  ('0a000000-0000-4000-8000-000000000003');   -- admin

-- C02 (migration 020): has_role()/is_staff() só autorizam uma identidade UTILIZÁVEL — conta
-- existente em auth.users, não banida nem excluída, e com a sessão do JWT viva em
-- auth.sessions. Por isso as contas das claims abaixo existem de verdade e cada claim
-- carrega o `session_id` da sessão correspondente (o UUID da conta com o primeiro
-- caractere trocado por 'e'). Não há exceção para fixture sem conta: isso seria
-- reproduzir o comportamento que a migration 020 removeu.
insert into auth.sessions (id, user_id) values
  ('ea000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000003');

insert into public.user_roles (user_id, role) values
  ('0a000000-0000-4000-8000-000000000001', 'operacional'),
  ('0a000000-0000-4000-8000-000000000003', 'admin');

insert into public.clients (id, name) values
  ('0c000000-0000-4000-8000-000000000001', 'Cliente Alfa');

insert into public.contracts
  (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from)
values
  ('0d000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   'Contrato Alfa', 150.00, 8, 1.5, 10, '2026-01-01');

insert into public.operations (id, client_id, contract_id, name, site, type, operation_date)
values
  ('0e000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000001', 'Operacao', 'Galpao', 'fixed', '2026-09-10');

insert into public.shifts
  (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
values
  ('0b000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   'Turno A', '08:00', '17:00', 60, false);

insert into public.employees (id, name, role, daily_cost) values
  ('05000000-0000-4000-8000-000000000001', 'Colab Um', 'ajudante', 90.00);

insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000001', true);

insert into public.user_operation_access (user_id, operation_id) values
  ('0a000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001');

insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('07000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000001', '2026-09-10');


-- ---------------------------------------------------------------------------
-- A. As constraints existem, e com a definição pretendida
-- ---------------------------------------------------------------------------

do $bloco_a$
declare _def text;
begin
  select pg_get_constraintdef(c.oid) into _def
    from pg_constraint c
   where c.conname = 'timesheet_entries_break_minutes_nao_negativo'
     and c.contype = 'c'
     and c.conrelid = 'public.timesheet_entries'::regclass;
  perform pg_temp.registrar(
    'A1. constraint de timesheet_entries existe', 'true', (_def is not null)::text);
  perform pg_temp.registrar(
    'A2. e confere break_minutes >= 0', 'true',
    coalesce(_def ~ 'break_minutes >= 0', false)::text);

  select pg_get_constraintdef(c.oid) into _def
    from pg_constraint c
   where c.conname = 'shifts_break_minutes_nao_negativo'
     and c.contype = 'c'
     and c.conrelid = 'public.shifts'::regclass;
  perform pg_temp.registrar(
    'A3. constraint de shifts existe', 'true', (_def is not null)::text);
  perform pg_temp.registrar(
    'A4. e confere break_minutes >= 0', 'true',
    coalesce(_def ~ 'break_minutes >= 0', false)::text);

  -- `NOT VALID` não foi usado: Production estava vazia nas duas tabelas quando
  -- a 014 foi desenhada, então não havia legado a proteger.
  perform pg_temp.registrar(
    'A5. as duas constraints estao validadas', '2',
    (select count(*)::text from pg_constraint
      where conname in ('timesheet_entries_break_minutes_nao_negativo',
                        'shifts_break_minutes_nao_negativo')
        and convalidated));
end;
$bloco_a$;


-- ---------------------------------------------------------------------------
-- B. O caminho do ADMIN, em AAL2, direto na tabela
-- ---------------------------------------------------------------------------

do $bloco_b$
declare _adm text := '0a000000-0000-4000-8000-000000000003';
begin
  perform pg_temp.registrar('B1. INSERT do admin com break -120 e recusado', 'erro 23514',
    pg_temp.executar(_adm, 'aal2', $sql$
      insert into public.timesheet_entries
        (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
      values ('07000000-0000-4000-8000-000000000001',
              '05000000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', -120)
    $sql$));

  perform pg_temp.registrar('B2. INSERT do admin com break -1 e recusado', 'erro 23514',
    pg_temp.executar(_adm, 'aal2', $sql$
      insert into public.timesheet_entries
        (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
      values ('07000000-0000-4000-8000-000000000001',
              '05000000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', -1)
    $sql$));

  perform pg_temp.registrar('B3. INSERT do admin com break 0 e aceito', 'ok',
    pg_temp.executar(_adm, 'aal2', $sql$
      insert into public.timesheet_entries
        (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
      values ('07000000-0000-4000-8000-000000000001',
              '05000000-0000-4000-8000-000000000001', 'present', '08:00', '17:00', 0)
    $sql$));

  perform pg_temp.registrar('B4. UPDATE do admin para break 60 e aceito', 'ok',
    pg_temp.executar(_adm, 'aal2', $sql$
      update public.timesheet_entries set break_minutes = 60
       where timesheet_id = '07000000-0000-4000-8000-000000000001'
    $sql$));

  perform pg_temp.registrar('B5. UPDATE do admin para break -30 e recusado', 'erro 23514',
    pg_temp.executar(_adm, 'aal2', $sql$
      update public.timesheet_entries set break_minutes = -30
       where timesheet_id = '07000000-0000-4000-8000-000000000001'
    $sql$));

  perform pg_temp.registrar('B6. e a linha continua com o valor valido', '60',
    (select break_minutes::text from public.timesheet_entries
      where timesheet_id = '07000000-0000-4000-8000-000000000001'));
end;
$bloco_b$;


-- ---------------------------------------------------------------------------
-- E. A derivação financeira não mudou para dado válido
--
-- Vem antes dos blocos C e D no arquivo? Não: vem aqui, logo depois do B,
-- porque reaproveita a linha que o admin acabou de gravar. Os números são os
-- mesmos medidos antes da 014, conferidos à mão: jornada 08:00–17:00 são 540
-- minutos brutos; com intervalo de 60 sobram 480, que é exatamente a jornada
-- prevista do turno, então não há excedente. Com intervalo 0 sobram 540, o
-- excedente de 60 passa a tolerância de 10 e vira hora extra a
-- (150 / 8) * 1,5 = R$ 28,125 por hora.
-- ---------------------------------------------------------------------------

do $bloco_e$
declare _linha text;
begin
  select worked_minutes || '|' || overtime_minutes || '|' || billed_amount || '|' || cost_amount
    into _linha from public.timesheet_entries
   where timesheet_id = '07000000-0000-4000-8000-000000000001';
  perform pg_temp.registrar(
    'E1. break 60: derivacao identica a de antes da 014', '480|0|150.00|90.00', _linha);

  update public.timesheet_entries set break_minutes = 0
   where timesheet_id = '07000000-0000-4000-8000-000000000001';

  select worked_minutes || '|' || overtime_minutes || '|' || billed_amount || '|' || cost_amount
    into _linha from public.timesheet_entries
   where timesheet_id = '07000000-0000-4000-8000-000000000001';
  perform pg_temp.registrar(
    'E2. break 0: derivacao identica a de antes da 014', '540|60|178.13|101.25', _linha);

  delete from public.timesheet_entries
   where timesheet_id = '07000000-0000-4000-8000-000000000001';
end;
$bloco_e$;


-- ---------------------------------------------------------------------------
-- C. O caminho do OPERADOR, em AAL1, pela RPC
--
-- A RPC não ganhou verificação de sinal, de propósito: quem recusa é a
-- constraint, e o `23514` sobe por dentro do `SECURITY DEFINER` sem ser
-- traduzido.
-- ---------------------------------------------------------------------------

do $bloco_c$
declare _op text := '0a000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.registrar('C1. RPC com break -120 e recusada', 'erro 23514',
    pg_temp.executar(_op, 'aal1', $sql$
      select public.salvar_apontamento_operacional(
        '0e000000-0000-4000-8000-000000000001',
        '0b000000-0000-4000-8000-000000000001',
        '2026-09-10',
        '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present",
           "check_in":"08:00","check_out":"17:00","break_minutes":-120}]'::jsonb)
    $sql$));

  perform pg_temp.registrar('C2. nada foi gravado pela chamada recusada', '0',
    (select count(*)::text from public.timesheet_entries));

  perform pg_temp.registrar('C3. RPC com break 0 e aceita', 'ok',
    pg_temp.executar(_op, 'aal1', $sql$
      select public.salvar_apontamento_operacional(
        '0e000000-0000-4000-8000-000000000001',
        '0b000000-0000-4000-8000-000000000001',
        '2026-09-10',
        '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present",
           "check_in":"08:00","check_out":"17:00","break_minutes":0}]'::jsonb)
    $sql$));

  perform pg_temp.registrar('C4. RPC com break 45 e aceita', 'ok',
    pg_temp.executar(_op, 'aal1', $sql$
      select public.salvar_apontamento_operacional(
        '0e000000-0000-4000-8000-000000000001',
        '0b000000-0000-4000-8000-000000000001',
        '2026-09-10',
        '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present",
           "check_in":"08:00","check_out":"17:00","break_minutes":45}]'::jsonb)
    $sql$));

  perform pg_temp.registrar('C5. e o valor valido chegou a tabela', '45',
    (select break_minutes::text from public.timesheet_entries));

  perform pg_temp.registrar('C6. RPC com break -1 e recusada', 'erro 23514',
    pg_temp.executar(_op, 'aal1', $sql$
      select public.salvar_apontamento_operacional(
        '0e000000-0000-4000-8000-000000000001',
        '0b000000-0000-4000-8000-000000000001',
        '2026-09-10',
        '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present",
           "check_in":"08:00","check_out":"17:00","break_minutes":-1}]'::jsonb)
    $sql$));

  perform pg_temp.registrar('C7. a linha anterior segue intacta apos a recusa', '45',
    (select break_minutes::text from public.timesheet_entries));

  delete from public.timesheet_entries;
end;
$bloco_c$;


-- ---------------------------------------------------------------------------
-- D. `shifts`
-- ---------------------------------------------------------------------------

do $bloco_d$
declare _adm text := '0a000000-0000-4000-8000-000000000003';
begin
  perform pg_temp.registrar('D1. INSERT de turno com break -30 e recusado', 'erro 23514',
    pg_temp.executar(_adm, 'aal2', $sql$
      insert into public.shifts (operation_id, name, start_time, end_time, break_minutes)
      values ('0e000000-0000-4000-8000-000000000001', 'Turno C', '06:00', '14:00', -30)
    $sql$));

  perform pg_temp.registrar('D2. INSERT de turno com break 0 e aceito', 'ok',
    pg_temp.executar(_adm, 'aal2', $sql$
      insert into public.shifts (operation_id, name, start_time, end_time, break_minutes)
      values ('0e000000-0000-4000-8000-000000000001', 'Turno D', '06:00', '14:00', 0)
    $sql$));

  perform pg_temp.registrar('D3. INSERT de turno com break 30 e aceito', 'ok',
    pg_temp.executar(_adm, 'aal2', $sql$
      insert into public.shifts (operation_id, name, start_time, end_time, break_minutes)
      values ('0e000000-0000-4000-8000-000000000001', 'Turno E', '06:00', '14:00', 30)
    $sql$));

  perform pg_temp.registrar('D4. UPDATE de turno para break -1 e recusado', 'erro 23514',
    pg_temp.executar(_adm, 'aal2', $sql$
      update public.shifts set break_minutes = -1
       where id = '0b000000-0000-4000-8000-000000000001'
    $sql$));

  perform pg_temp.registrar('D5. o turno da fixture segue com 60', '60',
    (select break_minutes::text from public.shifts
      where id = '0b000000-0000-4000-8000-000000000001'));

  delete from public.shifts where name in ('Turno D', 'Turno E');
end;
$bloco_d$;


-- ---------------------------------------------------------------------------
-- F. O que a 014 NÃO podia ter mexido
--
-- Uma migration que fecha uma invariante de coluna não tem motivo para tocar em
-- autorização. Os blocos F, G e H medem isso em vez de confiar na leitura do
-- diff.
-- ---------------------------------------------------------------------------

do $bloco_f$
begin
  perform pg_temp.registrar('F1. 15 policies *_exige_aal2 continuam existindo (AUTH-01B: 9 cotidianas + 6 de escrita estrita de invoices e invoice_items)', '15',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%_exige_aal2'));

  perform pg_temp.registrar('F2. e todas continuam RESTRICTIVE', '15',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%_exige_aal2'
        and permissive = 'RESTRICTIVE'));

  -- Eram 13 até a migration 017 (PR D): as 12 de sempre mais
  -- `user_operation_access`, da 013. A 017 acrescenta `admin_audit_log`, com
  -- RLS ativa desde a criação — passa a 14. Constante atualizada de propósito,
  -- não relaxada: continua contando TODAS as tabelas com RLS ativa, e uma
  -- tabela nova sem RLS faria este caso FALHAR do mesmo jeito que antes. A 022
  -- acrescenta `contract_terms` e `employee_cost_terms`, ambas com RLS ativa desde a
  -- criação — passa a 16, pelo mesmo critério. A 023 acrescenta `financial_terms_audit`
  -- (trilha das vigências financeiras), também com RLS desde a criação — passa a 17. A 024
  -- acrescenta `operation_terms` (versões do valor acordado), com RLS desde a criação — 18.
  -- A 025 acrescenta `financial_engine_settings` (a chave do motor por vigência), também com
  -- RLS desde a criação — 19. A 029 acrescenta `billing_additionals` (adicionais de serviço),
  -- com RLS desde a criação — 20. A 030 acrescenta `financial_holidays` (calendário de feriados),
  -- com RLS desde a criação — 21. A 039 acrescenta `job_functions` (catálogo de funções), com RLS
  -- desde a criação — 22. A 041 acrescenta `contract_rate_terms` (tarifas) e `pricing_settings` (chave da
  -- resolução), ambas com RLS desde a criação — 24.
  perform pg_temp.registrar('F3. as 24 tabelas de public seguem com RLS ativa', '24',
    (select count(*)::text from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity));
end;
$bloco_f$;


-- ---------------------------------------------------------------------------
-- G. As cinco RPCs operacionais, intactas
-- ---------------------------------------------------------------------------

do $bloco_g$
declare _rpcs text[] := array[
  'listar_operacoes_do_operador', 'listar_turnos_do_operador',
  'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
  'salvar_apontamento_operacional'];
begin
  perform pg_temp.registrar('G1. as cinco continuam SECURITY DEFINER', '5',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = any (_rpcs) and p.prosecdef));

  perform pg_temp.registrar('G2. e o dono continua sendo o papel dedicado', '5',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = any (_rpcs)
        and pg_get_userbyid(p.proowner) = 'bslog_rpc_operacional'));

  perform pg_temp.registrar('G3. authenticated continua podendo executar as cinco', '5',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = any (_rpcs)
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')));

  perform pg_temp.registrar('G4. anon continua sem executar nenhuma', '0',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = any (_rpcs)
        and has_function_privilege('anon', p.oid, 'EXECUTE')));

  perform pg_temp.registrar('G5. service_role continua sem executar nenhuma', '0',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = any (_rpcs)
        and has_function_privilege('service_role', p.oid, 'EXECUTE')));

  -- A 014 não recriou a RPC, então o corpo dela não pode ter mudado: continua
  -- sem verificação de sinal, e é a constraint que recusa.
  perform pg_temp.registrar('G6. a RPC de escrita segue sem verificar sinal', 'false',
    (select (p.prosrc ~* 'break_minutes[^;]*<\s*0')::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'salvar_apontamento_operacional'));
end;
$bloco_g$;


-- ---------------------------------------------------------------------------
-- H. O papel de execução não ganhou privilégio
-- ---------------------------------------------------------------------------

do $bloco_h$
declare _colunas text[] := array[
  'billed_amount', 'cost_amount', 'invoice_id',
  'daily_rate_snapshot', 'ot_hour_rate_snapshot', 'daily_cost_snapshot',
  'worked_minutes', 'overtime_minutes'];
  _coluna text;
  _achou  int := 0;
begin
  foreach _coluna in array _colunas
  loop
    if has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries',
                            _coluna, 'SELECT, INSERT, UPDATE') then
      _achou := _achou + 1;
    end if;
  end loop;
  perform pg_temp.registrar(
    'H1. nenhum privilegio em coluna financeira de timesheet_entries', '0', _achou::text);

  perform pg_temp.registrar('H2. e nenhum em employees.daily_cost', 'false',
    has_column_privilege('bslog_rpc_operacional', 'public.employees',
                         'daily_cost', 'SELECT, INSERT, UPDATE')::text);

  perform pg_temp.registrar('H3. e nenhum em operations.agreed_amount', 'false',
    has_column_privilege('bslog_rpc_operacional', 'public.operations',
                         'agreed_amount', 'SELECT, INSERT, UPDATE')::text);

  perform pg_temp.registrar('H4. contracts segue fora do alcance', 'false',
    has_table_privilege('bslog_rpc_operacional', 'public.contracts', 'SELECT')::text);

  perform pg_temp.registrar('H5. e nenhum DELETE em timesheet_entries', 'false',
    has_table_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'DELETE')::text);
end;
$bloco_h$;


-- ---------------------------------------------------------------------------
-- I. Nada além das duas constraints entrou
-- ---------------------------------------------------------------------------

do $bloco_i$
begin
  -- A lista inteira, e não a contagem: assim um trigger acrescentado, removido
  -- ou renomeado pela 014 apareceria. Os dois conjuntos são os do schema com as
  -- 19 migrations, lidos do catálogo antes da 014. A 022 acrescenta um (o guard das
  -- colunas de condições financeiras): são 11, e os 10 originais seguem intactos. A 024
  -- acrescenta o da coluna `operation_terms_id` (valor acordado versionado): são 12. A 025
  -- acrescenta o motor por vigência, criado DESABILITADO (a lista conta o trigger, esteja
  -- habilitado ou não): são 13. A 029 acrescenta a recusa de entrada igual à saída: são 14. A 031 acrescenta a recusa de
  -- escrita em folha fechada: são 15.
  -- A 040 acrescenta o gatilho que grava os snapshots de função e período (sem tocar em valor): são 16.
  perform pg_temp.registrar('I1. os 16 triggers de timesheet_entries, intactos (um deles dormente; a 031 acrescenta o da folha fechada, a 040 o dos snapshots)',
    'trg_timesheet_entries_ancora_folha, trg_timesheet_entries_bloqueia_condicoes, '
    'trg_timesheet_entries_bloqueia_condicoes_operacao, '
    'trg_timesheet_entries_bloqueia_delete_faturado, '
    'trg_timesheet_entries_bloqueia_desvinculo, trg_timesheet_entries_bloqueia_edicao_faturada, '
    'trg_timesheet_entries_bloqueia_folha_fechada, '
    'trg_timesheet_entries_bloqueia_horario_igual, '
    'trg_timesheet_entries_bloqueia_truncate, trg_timesheet_entries_bloqueia_vinculo_direto, '
    'trg_timesheet_entries_bloqueio_financeiro, trg_timesheet_entries_bz_snapshots_funcao_periodo, '
    'trg_timesheet_entries_calculo_financeiro, '
    'trg_timesheet_entries_calculo_vigencia, '
    'trg_timesheet_entries_chave, trg_timesheet_entries_updated',
    (select string_agg(t.tgname, ', ' order by t.tgname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relname = 'timesheet_entries'
        and c.relnamespace = 'public'::regnamespace));

  -- Os 4 originais de shifts seguem intactos. A 024 acrescenta o congelamento de jornada de
  -- turno usado, criado DESABILITADO (a lista conta o trigger, esteja habilitado ou não).
  -- A 039 acrescenta o gatilho que registra quem classificou o período do turno (cadastro puro).
  perform pg_temp.registrar('I2. os 6 triggers de shifts, intactos (um deles dormente)',
    'trg_shifts_bloqueia_delete_usado, trg_shifts_bloqueia_fontes, '
    'trg_shifts_bloqueia_mover_referenciado, trg_shifts_classificacao, '
    'trg_shifts_congela_jornada_usada, trg_shifts_updated',
    (select string_agg(t.tgname, ', ' order by t.tgname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relname = 'shifts'
        and c.relnamespace = 'public'::regnamespace));

  -- Exatamente uma constraint CHECK por tabela: a da 014, e nada mais. As cinco da
  -- 022 (valores das colunas novas de condições financeiras) ficam de fora pelo nome,
  -- para que qualquer OUTRA constraint continue fazendo este caso falhar. A da 029 (valor-hora
  -- da hora extra paga, positivo) também fica de fora pelo nome, e as duas da 030 (minutos cobrados
  -- e tipo do dia).
  perform pg_temp.registrar('I3. um unico CHECK em timesheet_entries, fora as 5 da 022, a da 029, as 2 da 030, as 3 da 036 e as 3 da 040', '1',
    (select count(*)::text from pg_constraint
      where conrelid = 'public.timesheet_entries'::regclass and contype = 'c'
        and conname not in ('timesheet_entries_terms_origin_valida',
                            'timesheet_entries_shift_hours_snapshot_positiva',
                            'timesheet_entries_ot_factor_snapshot_nao_negativo',
                            'timesheet_entries_ot_tolerance_snapshot_nao_negativa',
                            'timesheet_entries_planned_minutes_snapshot_nao_negativo',
                            'timesheet_entries_ot_hourly_cost_snapshot_positivo',
                            'timesheet_entries_minutos_cobrados_nao_negativos',
                            'timesheet_entries_tipo_do_dia_valido',
                            'timesheet_entries_calc_version_valida',
                            'timesheet_entries_adicional_nao_negativo',
                            'timesheet_entries_componentes_coerentes',
                            'timesheet_entries_periodo_snapshot_valido',
                            'timesheet_entries_funcao_origem_valida',
                            'timesheet_entries_funcao_com_origem')));

  -- O da 014 (pausa não negativa) e o da 039 (período diurno/noturno).
  perform pg_temp.registrar('I4. dois CHECKs em shifts', '2',
    (select count(*)::text from pg_constraint
      where conrelid = 'public.shifts'::regclass and contype = 'c'));

  -- A coluna não mudou de forma: continua inteira, obrigatória e com default 0.
  perform pg_temp.registrar('I5. a coluna segue integer NOT NULL DEFAULT 0 nas duas', '2',
    (select count(*)::text from information_schema.columns
      where table_schema = 'public' and column_name = 'break_minutes'
        and data_type = 'integer' and is_nullable = 'NO' and column_default = '0'));
end;
$bloco_i$;


-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '010_hardening_break_minutes: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
