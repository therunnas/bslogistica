-- Valores financeiros de `timesheet_entries` são derivados pelo banco.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor do Supabase, ou execute
-- contra o banco local, e rode de uma vez. Tudo acontece dentro de uma
-- transação que termina em `rollback`: nenhum dado é criado, alterado ou
-- removido.
--
-- POR QUE O `set local role`: o SQL Editor conecta como `postgres`, dono das
-- tabelas, e nessa sessão a RLS **não é aplicada**. Cada bloco troca para
-- `authenticated` e injeta `request.jwt.claims`, de onde `auth.uid()` e
-- `auth.jwt()` leem. Os claims usam `aal2` porque esse é o único estado que
-- hoje alcança as tabelas de negócio — o objetivo aqui não é AAL, é coluna.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION, DE PROPÓSITO.
--
-- Ele afirma o comportamento SEGURO: o valor gravado é o DERIVADO, não o que
-- veio no payload. Rodando contra o schema anterior à migration 010, os casos
-- B1 a B5 FALHAM — e é essa falha que documenta o buraco. Nenhuma expectativa
-- foi invertida para fabricar um PASS.
--
-- OS NÚMEROS ESPERADOS DE PARIDADE NÃO FORAM CALCULADOS À MÃO. Saíram da
-- execução do próprio `calcEntry()` de `src/lib/billing.ts`, com estas
-- entradas, e estão reproduzidos aqui como constantes. Se a implementação SQL
-- divergir do TypeScript em qualquer caso, o bloco P acusa.

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
) on commit drop;

-- `security definer` porque os blocos rodam sob `set local role authenticated`,
-- e esse papel não tem privilégio de escrita na tabela temporária.
create or replace function pg_temp.registrar(
  _caso text, _esperado text, _obtido text
) returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido,
          case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;


-- ---------------------------------------------------------------------------
-- Cenário. Mesmos UUIDs de admin e operacional do 005, para leitura cruzada.
--
-- O ATOR DOS BLOCOS É O ADMIN, e desde a migration 016 isso deixou de ser
-- detalhe: acesso direto às tabelas de negócio passou a exigir `aal2` E
-- `admin`, então o operador não escreve mais apontamento por fora — o caminho
-- dele é a superfície de RPC da `013`/`015`. Esta suíte nunca foi sobre quem
-- escreve: ela mede a DERIVAÇÃO FINANCEIRA, que é do trigger e independe do
-- papel de quem disparou o comando. Os valores esperados não mudaram uma
-- casa decimal; o que mudou foi o `sub` dos claims, de `8888…` para `1111…`.
-- Quem prova a recusa do operador é `002`, `005` e `012`.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, email) values
  ('11111111-1111-4111-8111-111111111111', 'Admin de Teste', 'admin@example.invalid'),
  ('88888888-8888-4888-8888-888888888888', 'Operacional',    'operacional@example.invalid');

insert into public.user_roles (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('88888888-8888-4888-8888-888888888888', 'operacional');

-- C02 (migration 020): has_role()/is_staff() só autorizam uma identidade UTILIZÁVEL — conta
-- existente em auth.users, não banida nem excluída, e com a sessão do JWT viva em
-- auth.sessions. Por isso as contas das claims abaixo existem de verdade e cada claim
-- carrega o `session_id` da sessão correspondente (o UUID da conta com o primeiro
-- caractere trocado por 'e'). Não há exceção para fixture sem conta: isso seria
-- reproduzir o comportamento que a migration 020 removeu.
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id) values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

insert into public.clients (id, name) values
  ('33333333-3333-4333-8333-333333333333', 'Cliente de Teste');

-- Regras exatamente iguais às usadas na extração dos números de paridade.
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('33333333-3333-4333-8333-333333333334', '33333333-3333-4333-8333-333333333333',
   'Contrato de Teste', 200, 8, 1.5, 10);

-- Operação COM contrato (casos A a E) e operação SEM contrato (caso F), esta
-- última exercitando o fallback `agreed_amount` / 8h / fator 1 / tolerância 10.
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333334', 'Operação com Contrato', null),
  ('44444444-4444-4444-8444-44444444444f', '33333333-3333-4333-8333-333333333333',
   null, 'Operação sem Contrato', 150),
  -- Isca do bloco G: nenhuma folha aponta para ela. Só existe para ser enviada
  -- no payload e provar que o payload não manda no valor.
  ('44444444-4444-4444-8444-44444444444c', '33333333-3333-4333-8333-333333333333',
   null, 'Operação CARA (isca)', 999999);

-- Turno diurno: 06:00–15:00 com 60 de intervalo -> 480 minutos previstos.
-- Turno noturno: 22:00–06:00 virando o dia, sem intervalo -> 480 minutos.
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '44444444-4444-4444-8444-444444444444',
   'Diurno',  '06:00:00', '15:00:00', 60, false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '44444444-4444-4444-8444-444444444444',
   'Noturno', '22:00:00', '06:00:00',  0, true),
  -- Turno PRÓPRIO da operação sem contrato, com jornada idêntica à do Diurno.
  -- Até a migration 011 a folha do caso F apontava para o Diurno, que pertence
  -- à OUTRA operação: exatamente o par inválido que a 011 passou a recusar. A
  -- fixture só conseguia existir porque a invariante não existia. Mesmos
  -- 06:00–15:00 com 60 de intervalo, então os 480 minutos previstos e todos os
  -- números do caso F seguem iguais.
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf', '44444444-4444-4444-8444-44444444444f',
   'Diurno sem contrato', '06:00:00', '15:00:00', 60, false);

insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('66666666-6666-4666-8666-666666666661', '44444444-4444-4444-8444-444444444444',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date),
  ('66666666-6666-4666-8666-666666666662', '44444444-4444-4444-8444-444444444444',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date),
  ('66666666-6666-4666-8666-66666666666f', '44444444-4444-4444-8444-44444444444f',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf', current_date);

-- Um colaborador por caso: o índice único permite uma diária faturável por
-- colaborador/operação/data.
insert into public.employees (id, name, daily_cost) values
  ('55555555-5555-4555-8555-55555555550a', 'Colaborador A', 120),
  ('55555555-5555-4555-8555-55555555550b', 'Colaborador B', 120),
  ('55555555-5555-4555-8555-55555555550c', 'Colaborador C', 120),
  ('55555555-5555-4555-8555-55555555550d', 'Colaborador D', 120),
  ('55555555-5555-4555-8555-55555555550e', 'Colaborador E', 120),
  ('55555555-5555-4555-8555-55555555550f', 'Colaborador F', 120),
  ('55555555-5555-4555-8555-555555555511', 'Colaborador Edicao',  120),
  ('55555555-5555-4555-8555-555555555512', 'Colaborador Notas',   120),
  ('55555555-5555-4555-8555-555555555513', 'Colaborador Fatura',  120),
  ('55555555-5555-4555-8555-555555555514', 'Colaborador Vinculo', 120),
  ('55555555-5555-4555-8555-555555555515', 'Colaborador Forjado', 120),
  ('55555555-5555-4555-8555-555555555516', 'Colaborador Sem Op',  120);

insert into public.invoices (id, client_id, period_start, period_end) values
  ('99999999-9999-4999-8999-999999999991', '33333333-3333-4333-8333-333333333333',
   current_date, current_date);


-- ---------------------------------------------------------------------------
-- B. PAYLOAD FORJADO — o valor gravado tem de ser o derivado.
--
-- Caso de referência: turno diurno, 06:00–17:00, 60 de intervalo.
-- calcEntry: worked=600, ot=120, billed=275.00, cost=150.00.
-- ---------------------------------------------------------------------------

do $forjado$
declare
  _billed numeric;
  _cost   numeric;
  _worked integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- B1/B2. INSERT mandando valores inventados nas duas colunas.
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status,
     check_in, check_out, break_minutes, billed_amount, cost_amount)
  values
    ('77777777-7777-4777-8777-7777777770b1', '66666666-6666-4666-8666-666666666661',
     '55555555-5555-4555-8555-55555555550b', '44444444-4444-4444-8444-444444444444',
     current_date, 'present', '06:00:00', '17:00:00', 60, 99999.00, 0.00);

  select billed_amount, cost_amount, worked_minutes
    into _billed, _cost, _worked
    from public.timesheet_entries
   where id = '77777777-7777-4777-8777-7777777770b1';

  perform pg_temp.registrar('B1. INSERT com billed_amount forjado', '275.00', to_char(_billed, 'FM999999990.00'));
  perform pg_temp.registrar('B2. INSERT com cost_amount forjado',   '150.00', to_char(_cost,   'FM999999990.00'));
  perform pg_temp.registrar('B2b. worked_minutes derivado',         '600',    _worked::text);
end;
$forjado$;


-- ---------------------------------------------------------------------------
-- B3 a B5. UPDATE puramente financeiro — tem de ser recusado com 42501.
-- ---------------------------------------------------------------------------

do $edicao_financeira$
declare
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.timesheet_entries set billed_amount = 99999.00
     where id = '77777777-7777-4777-8777-7777777770b1';
    _estado := 'aceitou';
  exception
    when insufficient_privilege then _estado := 'recusou 42501';
    when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('B3. UPDATE isolado de billed_amount', 'recusou 42501', _estado);

  begin
    update public.timesheet_entries set cost_amount = 0.00
     where id = '77777777-7777-4777-8777-7777777770b1';
    _estado := 'aceitou';
  exception
    when insufficient_privilege then _estado := 'recusou 42501';
    when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('B4. UPDATE isolado de cost_amount', 'recusou 42501', _estado);

  begin
    update public.timesheet_entries set daily_rate_snapshot = 1.00
     where id = '77777777-7777-4777-8777-7777777770b1';
    _estado := 'aceitou';
  exception
    when insufficient_privilege then _estado := 'recusou 42501';
    when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('B5. UPDATE isolado de snapshot', 'recusou 42501', _estado);
end;
$edicao_financeira$;


-- ---------------------------------------------------------------------------
-- C. EDIÇÃO LEGÍTIMA — coluna motriz recalcula; `notes` preserva.
-- ---------------------------------------------------------------------------

do $edicao_legitima$
declare
  _billed numeric;
  _cost   numeric;
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- Nasce sem hora extra: 06:00–15:00 -> billed 200.00.
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status,
     check_in, check_out, break_minutes)
  values
    ('77777777-7777-4777-8777-777777777711', '66666666-6666-4666-8666-666666666661',
     '55555555-5555-4555-8555-555555555511', '44444444-4444-4444-8444-444444444444',
     current_date, 'present', '06:00:00', '15:00:00', 60);

  -- C1. Estende a saída em duas horas: coluna motriz, tem de recalcular.
  update public.timesheet_entries set check_out = '17:00:00'
   where id = '77777777-7777-4777-8777-777777777711';

  select billed_amount into _billed from public.timesheet_entries
   where id = '77777777-7777-4777-8777-777777777711';
  perform pg_temp.registrar('C1. UPDATE de coluna motriz recalcula', '275.00', to_char(_billed, 'FM999999990.00'));

  -- C2. Edição de `notes` reenviando valores financeiros divergentes, que é o
  -- que a tela faz quando o contrato mudou depois. Não pode recusar, e não pode
  -- deixar o valor do payload entrar: preserva o que já estava gravado.
  begin
    update public.timesheet_entries
       set notes = 'observacao operacional', billed_amount = 1.00, cost_amount = 1.00
     where id = '77777777-7777-4777-8777-777777777711';
    _estado := 'aceitou';
  exception
    when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('C2. UPDATE de notes é aceito', 'aceitou', _estado);

  select billed_amount, cost_amount into _billed, _cost from public.timesheet_entries
   where id = '77777777-7777-4777-8777-777777777711';
  perform pg_temp.registrar('C2b. notes preserva billed_amount', '275.00', to_char(_billed, 'FM999999990.00'));
  perform pg_temp.registrar('C2c. notes preserva cost_amount',   '150.00', to_char(_cost,   'FM999999990.00'));
end;
$edicao_legitima$;


-- ---------------------------------------------------------------------------
-- D. ADMIN — o fluxo legítimo da tela continua funcionando.
-- ---------------------------------------------------------------------------

do $admin$
declare
  _billed numeric;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status,
     check_in, check_out, break_minutes, worked_minutes, overtime_minutes,
     daily_rate_snapshot, ot_hour_rate_snapshot, daily_cost_snapshot,
     billed_amount, cost_amount)
  values
    ('77777777-7777-4777-8777-7777777770a1', '66666666-6666-4666-8666-666666666661',
     '55555555-5555-4555-8555-55555555550a', '44444444-4444-4444-8444-444444444444',
     current_date, 'present', '06:00:00', '15:00:00', 60, 480, 0,
     200.00, 37.50, 120.00, 200.00, 120.00);

  select billed_amount into _billed from public.timesheet_entries
   where id = '77777777-7777-4777-8777-7777777770a1';
  perform pg_temp.registrar('D1. admin grava pelo fluxo da tela', '200.00', to_char(_billed, 'FM999999990.00'));
end;
$admin$;


-- ---------------------------------------------------------------------------
-- E. FATURAMENTO — vincular fatura não pode recalcular snapshot.
-- ---------------------------------------------------------------------------

do $fatura$
declare
  _antes_billed numeric;
  _antes_rate   numeric;
  _depois_billed numeric;
  _depois_rate   numeric;
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status,
     check_in, check_out, break_minutes)
  values
    ('77777777-7777-4777-8777-777777777713', '66666666-6666-4666-8666-666666666661',
     '55555555-5555-4555-8555-555555555513', '44444444-4444-4444-8444-444444444444',
     current_date, 'present', '06:00:00', '17:00:00', 60);

  -- E2. Um não-admin continua sem poder mexer no vínculo. Proteção que já
  -- existia antes desta migration e não pode ter sido afetada.
  begin
    update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999991'
     where id = '77777777-7777-4777-8777-777777777713';
    _estado := 'aceitou';
  exception
    when insufficient_privilege then _estado := 'recusou 42501';
    when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('E2. invoice_id segue protegido para não-admin', 'recusou 42501', _estado);

  reset role;

  select billed_amount, daily_rate_snapshot into _antes_billed, _antes_rate
    from public.timesheet_entries where id = '77777777-7777-4777-8777-777777777713';

  -- Mudança de contrato DEPOIS do apontamento. Se o vínculo recalculasse, o
  -- snapshot mudaria junto — que é exatamente o que não pode acontecer.
  update public.contracts set daily_rate = 999
   where id = '33333333-3333-4333-8333-333333333334';

  -- E1. Como `postgres`, igual ao que `gerar_fatura` faz por ser SECURITY DEFINER.
  update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999991'
   where id = '77777777-7777-4777-8777-777777777713';

  select billed_amount, daily_rate_snapshot into _depois_billed, _depois_rate
    from public.timesheet_entries where id = '77777777-7777-4777-8777-777777777713';

  perform pg_temp.registrar('E1. vincular fatura não altera billed_amount',
    to_char(_antes_billed, 'FM999999990.00'), to_char(_depois_billed, 'FM999999990.00'));
  perform pg_temp.registrar('E1b. vincular fatura não altera snapshot',
    to_char(_antes_rate, 'FM999999990.00'), to_char(_depois_rate, 'FM999999990.00'));

  update public.contracts set daily_rate = 200
   where id = '33333333-3333-4333-8333-333333333334';
end;
$fatura$;


-- ---------------------------------------------------------------------------
-- F. operation_team continua funcional — esta migration não a toca.
-- ---------------------------------------------------------------------------

do $equipe$
declare
  _n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  insert into public.operation_team (operation_id, employee_id)
  values ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-55555555550c');

  select count(*) into _n from public.operation_team
   where operation_id = '44444444-4444-4444-8444-444444444444';
  perform pg_temp.registrar('F1. operation_team segue gravável por staff', '1 linhas', _n || ' linhas');
end;
$equipe$;


-- ---------------------------------------------------------------------------
-- P. PARIDADE calcEntry (TypeScript) × SQL.
--
-- Os valores esperados saíram da execução do próprio `calcEntry()`. Qualquer
-- divergência aqui significa que as duas implementações da regra financeira
-- derivaram — e é motivo para parar antes do merge.
-- ---------------------------------------------------------------------------

do $paridade$
declare
  _b numeric; _c numeric; _w integer; _o integer; _r numeric; _h numeric;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- A. jornada exata -> billed 200.00 / cost 120.00
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777771a1', '66666666-6666-4666-8666-666666666661',
    '55555555-5555-4555-8555-55555555550d', '44444444-4444-4444-8444-444444444444',
    current_date, 'present', '06:00:00', '15:00:00', 60);
  select billed_amount, cost_amount, worked_minutes, overtime_minutes, daily_rate_snapshot, ot_hour_rate_snapshot
    into _b, _c, _w, _o, _r, _h
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777771a1';
  perform pg_temp.registrar('P-A. jornada exata',
    '200.00|120.00|480|0|200.00|37.50',
    concat_ws('|', to_char(_b,'FM999999990.00'), to_char(_c,'FM999999990.00'),
      _w::text, _o::text, to_char(_r,'FM999999990.00'), to_char(_h,'FM999999990.00')));

  -- B. duas horas extras -> billed 275.00 / cost 150.00  (já coberto em B1, repetido aqui como paridade explícita)
  select billed_amount, cost_amount, worked_minutes, overtime_minutes
    into _b, _c, _w, _o
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777770b1';
  perform pg_temp.registrar('P-B. hora extra 2h',
    '275.00|150.00|600|120',
    concat_ws('|', to_char(_b,'FM999999990.00'), to_char(_c,'FM999999990.00'), _w::text, _o::text));

  -- C. cinco minutos, dentro da tolerância de 10 -> sem hora extra
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777771c1', '66666666-6666-4666-8666-666666666661',
    '55555555-5555-4555-8555-55555555550e', '44444444-4444-4444-8444-444444444444',
    current_date, 'present', '06:00:00', '15:05:00', 60);
  select billed_amount, cost_amount, worked_minutes, overtime_minutes
    into _b, _c, _w, _o
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777771c1';
  perform pg_temp.registrar('P-C. dentro da tolerancia',
    '200.00|120.00|485|0',
    concat_ws('|', to_char(_b,'FM999999990.00'), to_char(_c,'FM999999990.00'), _w::text, _o::text));

  -- D. falta -> zera receita e custo, mas mantém os snapshots
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777771d1', '66666666-6666-4666-8666-666666666661',
    '55555555-5555-4555-8555-55555555550f', '44444444-4444-4444-8444-444444444444',
    current_date, 'absent', null, null, 0);
  select billed_amount, cost_amount, worked_minutes, overtime_minutes, daily_rate_snapshot, ot_hour_rate_snapshot
    into _b, _c, _w, _o, _r, _h
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777771d1';
  perform pg_temp.registrar('P-D. falta',
    '0.00|0.00|0|0|200.00|37.50',
    concat_ws('|', to_char(_b,'FM999999990.00'), to_char(_c,'FM999999990.00'),
      _w::text, _o::text, to_char(_r,'FM999999990.00'), to_char(_h,'FM999999990.00')));

  -- E. turno que vira a meia-noite -> 480 trabalhados, sem hora extra
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777771e1', '66666666-6666-4666-8666-666666666662',
    '55555555-5555-4555-8555-555555555512', '44444444-4444-4444-8444-444444444444',
    current_date, 'present', '22:00:00', '06:00:00', 0);
  select billed_amount, cost_amount, worked_minutes, overtime_minutes
    into _b, _c, _w, _o
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777771e1';
  perform pg_temp.registrar('P-E. vira meia-noite',
    '200.00|120.00|480|0',
    concat_ws('|', to_char(_b,'FM999999990.00'), to_char(_c,'FM999999990.00'), _w::text, _o::text));

  -- F. operação sem contrato -> fallback agreed_amount / 8h / fator 1 / tolerância 10
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777771f1', '66666666-6666-4666-8666-66666666666f',
    '55555555-5555-4555-8555-555555555514', '44444444-4444-4444-8444-44444444444f',
    current_date, 'present', '06:00:00', '17:00:00', 60);
  select billed_amount, cost_amount, worked_minutes, overtime_minutes, daily_rate_snapshot, ot_hour_rate_snapshot
    into _b, _c, _w, _o, _r, _h
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777771f1';
  perform pg_temp.registrar('P-F. sem contrato (fallback)',
    '187.50|150.00|600|120|150.00|18.75',
    concat_ws('|', to_char(_b,'FM999999990.00'), to_char(_c,'FM999999990.00'),
      _w::text, _o::text, to_char(_r,'FM999999990.00'), to_char(_h,'FM999999990.00')));
end;
$paridade$;


-- ---------------------------------------------------------------------------
-- G. OPERAÇÃO FORJADA NO PAYLOAD.
--
-- A folha manda. O `operation_id` que o cliente envia não pode influenciar
-- valor nenhum — nem quando aponta para outra operação, nem quando vem nulo.
--
-- Sem a correção, o cálculo lê `NEW.operation_id` e o trigger de chave, que
-- roda depois, conserta só a chave: a linha termina com a operação certa e o
-- dinheiro da operação forjada.
-- ---------------------------------------------------------------------------

do $forjar_operacao$
declare
  _op     uuid;
  _billed numeric;
  _rate   numeric;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- G1. Folha da operação COM CONTRATO (diária 200), payload apontando para a
  -- operação CARA (agreed 999999). O legítimo é 200.00.
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status,
     check_in, check_out, break_minutes)
  values
    ('77777777-7777-4777-8777-77777777719a', '66666666-6666-4666-8666-666666666661',
     '55555555-5555-4555-8555-555555555515', '44444444-4444-4444-8444-44444444444c',
     current_date, 'present', '06:00:00', '15:00:00', 60);

  select operation_id, billed_amount, daily_rate_snapshot
    into _op, _billed, _rate
    from public.timesheet_entries where id = '77777777-7777-4777-8777-77777777719a';

  perform pg_temp.registrar('G1. operação forjada não muda billed_amount', '200.00', to_char(_billed, 'FM999999990.00'));
  perform pg_temp.registrar('G1b. operação forjada não muda o snapshot',   '200.00', to_char(_rate,   'FM999999990.00'));
  perform pg_temp.registrar('G1c. operation_id final é o da folha',
    '44444444-4444-4444-8444-444444444444', _op::text);

  -- G2. Mesmo cenário com `operation_id` omitido: a folha continua mandando.
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, work_date, status,
     check_in, check_out, break_minutes)
  values
    ('77777777-7777-4777-8777-77777777719b', '66666666-6666-4666-8666-666666666661',
     '55555555-5555-4555-8555-555555555516', current_date, 'present', '06:00:00', '15:00:00', 60);

  select operation_id, billed_amount into _op, _billed
    from public.timesheet_entries where id = '77777777-7777-4777-8777-77777777719b';

  perform pg_temp.registrar('G2. operation_id omitido usa a operação da folha', '200.00', to_char(_billed, 'FM999999990.00'));
  perform pg_temp.registrar('G2b. operation_id preenchido pela folha',
    '44444444-4444-4444-8444-444444444444', _op::text);
end;
$forjar_operacao$;


-- ---------------------------------------------------------------------------
-- H. NÃO-NEGATIVIDADE DAS FONTES.
--
-- Enquanto um valor de origem puder ser negativo, `Math.round` do JavaScript e
-- `round(numeric)` do PostgreSQL divergem no meio centavo — o JavaScript
-- arredonda para +infinito e o numeric para longe do zero. Fechar a entrada
-- resolve na raiz, sem mexer na fórmula.
--
-- `shift_hours` fica de FORA de propósito: valor <= 0 já é substituído por 8
-- pela própria regra, então não produz valor negativo e uma constraint ali
-- seria redundante.
-- ---------------------------------------------------------------------------

do $nao_negatividade$
declare
  _estado text;
begin
  reset role;

  begin
    insert into public.contracts (id, client_id, name, daily_rate)
    values ('33333333-3333-4333-8333-3333333333e1', '33333333-3333-4333-8333-333333333333', 'Neg', -1);
    _estado := 'aceitou';
  exception when check_violation then _estado := 'recusou 23514';
            when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H1. daily_rate negativo', 'recusou 23514', _estado);

  begin
    insert into public.contracts (id, client_id, name, daily_rate, ot_factor)
    values ('33333333-3333-4333-8333-3333333333e2', '33333333-3333-4333-8333-333333333333', 'Neg', 100, -1);
    _estado := 'aceitou';
  exception when check_violation then _estado := 'recusou 23514';
            when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H2. ot_factor negativo', 'recusou 23514', _estado);

  -- Vetor que a auditoria encontrou: tolerância negativa faz `excess > tol`
  -- valer para jornada INCOMPLETA, e a hora extra sai negativa.
  begin
    insert into public.contracts (id, client_id, name, daily_rate, ot_tolerance_min)
    values ('33333333-3333-4333-8333-3333333333e3', '33333333-3333-4333-8333-333333333333', 'Neg', 100, -600);
    _estado := 'aceitou';
  exception when check_violation then _estado := 'recusou 23514';
            when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H3. ot_tolerance_min negativo', 'recusou 23514', _estado);

  begin
    insert into public.employees (id, name, daily_cost)
    values ('55555555-5555-4555-8555-5555555555e4', 'Neg', -1);
    _estado := 'aceitou';
  exception when check_violation then _estado := 'recusou 23514';
            when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H4. daily_cost negativo', 'recusou 23514', _estado);

  begin
    insert into public.operations (id, client_id, name, agreed_amount)
    values ('44444444-4444-4444-8444-4444444444e5', '33333333-3333-4333-8333-333333333333', 'Neg', -1);
    _estado := 'aceitou';
  exception when check_violation then _estado := 'recusou 23514';
            when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H5. agreed_amount negativo', 'recusou 23514', _estado);

  -- O zero continua válido: é o padrão das colunas e tem sentido de negócio.
  begin
    insert into public.contracts (id, client_id, name, daily_rate, ot_factor, ot_tolerance_min)
    values ('33333333-3333-4333-8333-3333333333e6', '33333333-3333-4333-8333-333333333333', 'Zero', 0, 0, 0);
    insert into public.employees (id, name, daily_cost)
    values ('55555555-5555-4555-8555-5555555555e6', 'Zero', 0);
    insert into public.operations (id, client_id, name, agreed_amount)
    values ('44444444-4444-4444-8444-4444444444e6', '33333333-3333-4333-8333-333333333333', 'Zero', 0);
    _estado := 'aceitou';
  exception when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H6. zero continua permitido', 'aceitou', _estado);

  -- E `shift_hours` negativo segue aceito: não gera valor negativo, e a regra
  -- já o substitui por 8.
  begin
    insert into public.contracts (id, client_id, name, daily_rate, shift_hours)
    values ('33333333-3333-4333-8333-3333333333e7', '33333333-3333-4333-8333-333333333333', 'SH', 100, -8);
    _estado := 'aceitou';
  exception when others then _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H7. shift_hours negativo segue aceito (sem constraint redundante)', 'aceitou', _estado);
end;
$nao_negatividade$;


-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

do $relatorio$
declare
  _linha record;
  _falhas integer;
begin
  reset role;
  raise notice '';
  raise notice '=== 006 — valores financeiros derivados ===';
  for _linha in select * from _resultado order by ordem loop
    raise notice '% % (esperado: % | obtido: %)',
      rpad(_linha.situacao, 5), _linha.caso, _linha.esperado, _linha.obtido;
  end loop;

  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  raise notice '';
  raise notice 'total: % casos, % falhas', (select count(*) from _resultado), _falhas;

  if _falhas > 0 then
    raise exception '006: % casos falharam', _falhas;
  end if;
end;
$relatorio$;

rollback;
