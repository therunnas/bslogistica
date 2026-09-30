-- O acesso direto às tabelas de negócio exige AAL2 **e** admin — migration 016.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`.
--
-- O QUE ELE PROVA
--
-- Antes da `016`, uma conta com papel `operacional` que concluísse o TOTP
-- chegava em `aal2`, passava pela RESTRICTIVE `*_exige_aal2`, passava pela
-- permissiva por `public.is_staff()` — que é `EXISTS` de linha em `user_roles`,
-- verdadeiro para **qualquer** papel — e alcançava as dez tabelas de negócio
-- direto pelo PostgREST, contornando a superfície estreita da `013`/`015`.
-- Medido: lia `clients.doc`, `contact_name`, `email`, `phone`, as taxas do
-- contrato, `employees.doc`, `phone`, `daily_cost`, `operations.agreed_amount`,
-- `billed_amount`, `cost_amount`, os snapshots e `invoice_id`; e escrevia em
-- `operations`, `shifts`, `timesheets`, `timesheet_entries` e `operation_team`.
--
-- Este arquivo mede as três coisas que a correção precisa garantir ao mesmo
-- tempo, e que é fácil quebrar uma ao consertar a outra:
--
--   1. o operador não alcança tabela de negócio direto — nem em aal1, nem em
--      aal2, nem para ler PII, nem para ler dinheiro, nem para escrever;
--   2. as cinco RPCs continuam funcionando para ele, nos dois níveis: a porta
--      estreita não pode ter sido fechada junto com a larga;
--   3. o admin em AAL2 continua com o acesso administrativo de sempre, e o
--      enforcement de AAL2 do admin continua valendo.
--
-- CONTRA O SCHEMA SEM A 016 este arquivo falha nos blocos B, C e D — o operador
-- em `aal2` lê e escreve o que não devia. Nenhuma expectativa foi invertida
-- para fabricar PASS.
--
-- Ele toca `auth.users` pelo mesmo motivo do `008`, do `009` e do `011`: a
-- fixture precisa de contas reais por causa das FKs de `auth`. Só `id` é
-- obrigatório, então as linhas são mínimas e não carregam dado pessoal.

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

-- Executa `_sql` como `authenticated`, sob os claims pedidos. É o papel que o
-- PostgREST usa, então é o único jeito honesto de medir o que uma sessão real
-- alcança.
create or replace function pg_temp.medir(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
declare _r text; _claims jsonb;
begin
  if _uid is null then
    _claims := jsonb_build_object('role', 'anon');
  else
    _claims := jsonb_build_object('sub', _uid, 'role', 'authenticated');
    if _aal is not null then
      _claims := _claims || jsonb_build_object('aal', _aal);
    end if;
  end if;
  perform set_config('request.jwt.claims', _claims::text, true);
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
-- Quatro contas: operacional puro, admin puro, acumulador e uma sem papel.
-- Linhas com PII e com dinheiro de verdade, porque o ponto é provar que elas
-- NÃO atravessam.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('0a000000-0000-4000-8000-000000000001'),  -- OP  — só operacional
  ('0a000000-0000-4000-8000-000000000003'),  -- ADM — só admin
  ('0a000000-0000-4000-8000-000000000006'),  -- DUP — admin + operacional
  ('0a000000-0000-4000-8000-000000000009');  -- NUL — sem papel

insert into public.user_roles (user_id, role) values
  ('0a000000-0000-4000-8000-000000000001', 'operacional'),
  ('0a000000-0000-4000-8000-000000000003', 'admin'),
  ('0a000000-0000-4000-8000-000000000006', 'admin'),
  ('0a000000-0000-4000-8000-000000000006', 'operacional');

insert into public.clients (id, name, doc, contact_name, email, phone) values
  ('0c000000-0000-4000-8000-000000000001', 'Cliente Alfa', '12.345.678/0001-90',
   'Contato Alfa', 'contato@alfa.test', '11 90000-0000');

insert into public.contracts
  (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from)
values
  ('0d000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   'Contrato Alfa', 150.00, 8, 1.5, 10, '2026-01-01');

insert into public.operations
  (id, client_id, contract_id, name, site, type, operation_date, agreed_amount)
values
  ('0e000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000001', 'Operacao Atribuida', 'Galpao 1',
   'fixed', '2026-09-10', 9999.00);

insert into public.shifts
  (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
values
  ('0b000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   'Turno A', '08:00', '17:00', 60, false);

insert into public.employees (id, name, role, doc, phone, daily_cost) values
  ('05000000-0000-4000-8000-000000000001', 'Colab Um', 'ajudante',
   '111.222.333-44', '11 91111-1111', 90.00);

insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000001', true);

insert into public.timesheets (id, operation_id, shift_id, work_date, status) values
  ('0aa00000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000001', '2026-09-10', 'open');

insert into public.timesheet_entries
  (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
values
  ('0ab00000-0000-4000-8000-000000000001', '0aa00000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000001', 'present',
   '2026-09-10 08:00+00', '2026-09-10 17:00+00', 60);

insert into public.invoices
  (id, client_id, period_start, period_end, status, total_amount)
values
  ('0ac00000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   '2026-09-01', '2026-09-30', 'draft', 4321.00);

insert into public.invoice_items
  (id, invoice_id, operation_id, description, quantity, unit_price, amount)
values
  ('0ad00000-0000-4000-8000-000000000001', '0ac00000-0000-4000-8000-000000000001',
   '0e000000-0000-4000-8000-000000000001', 'Diarias', 1, 4321.00, 4321.00);

-- Atribuição da superfície estreita: o operador e o acumulador recebem, para
-- que a recusa do acumulador venha do PAPEL e não de faltar atribuição.
insert into public.user_operation_access (user_id, operation_id) values
  ('0a000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000006', '0e000000-0000-4000-8000-000000000001');


-- ---------------------------------------------------------------------------
-- A. Operador em AAL1 — zero leitura direta (contrato que já valia)
--
-- Este bloco não é novidade da 016: em aal1 quem barra é a `*_exige_aal2`. Ele
-- está aqui para que a suíte prove o contrato INTEIRO num arquivo só, e para
-- que uma futura mudança que afrouxe o aal1 caia aqui.
-- ---------------------------------------------------------------------------

do $bloco_a$
declare _t text; _i int := 0;
begin
  foreach _t in array array['clients','contracts','employees','operations','shifts',
                            'operation_team','timesheets','timesheet_entries',
                            'invoices','invoice_items']
  loop
    _i := _i + 1;
    perform pg_temp.registrar(
      format('A%s. operador aal1 nao le %s', _i, _t), '0',
      pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
                    format('select count(*)::text from public.%I', _t)));
  end loop;
end;
$bloco_a$;


-- ---------------------------------------------------------------------------
-- B. Operador em AAL2 — zero leitura direta (o que a 016 fecha)
--
-- Sem a `016`, cada um destes devolve `1`.
-- ---------------------------------------------------------------------------

do $bloco_b$
declare _t text; _i int := 0;
begin
  foreach _t in array array['clients','contracts','employees','operations','shifts',
                            'operation_team','timesheets','timesheet_entries',
                            'invoices','invoice_items']
  loop
    _i := _i + 1;
    perform pg_temp.registrar(
      format('B%s. operador aal2 nao le %s', _i, _t), '0',
      pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2',
                    format('select count(*)::text from public.%I', _t)));
  end loop;
end;
$bloco_b$;


-- ---------------------------------------------------------------------------
-- C. Operador em AAL2 — nem PII, nem dinheiro
--
-- Contar linha é uma coisa; alcançar o valor é a que interessa. Cada caso pede
-- a coluna diretamente, e `nulo` aqui significa "a linha não existe para esta
-- sessão" — não existe leitura parcial.
-- ---------------------------------------------------------------------------

do $bloco_c$
declare _c record; _i int := 0;
begin
  for _c in
    select * from (values
      ('clients.doc',                'select doc from public.clients limit 1'),
      ('clients.contact_name',       'select contact_name from public.clients limit 1'),
      ('clients.email',              'select email from public.clients limit 1'),
      ('clients.phone',              'select phone from public.clients limit 1'),
      ('contracts.daily_rate',       'select daily_rate::text from public.contracts limit 1'),
      ('contracts.shift_hours',      'select shift_hours::text from public.contracts limit 1'),
      ('contracts.ot_factor',        'select ot_factor::text from public.contracts limit 1'),
      ('contracts.ot_tolerance_min', 'select ot_tolerance_min::text from public.contracts limit 1'),
      ('employees.doc',              'select doc from public.employees limit 1'),
      ('employees.phone',            'select phone from public.employees limit 1'),
      ('employees.daily_cost',       'select daily_cost::text from public.employees limit 1'),
      ('operations.agreed_amount',   'select agreed_amount::text from public.operations limit 1'),
      ('operations.contract_id',     'select contract_id::text from public.operations limit 1'),
      ('operations.client_id',       'select client_id::text from public.operations limit 1'),
      ('entries.billed_amount',      'select billed_amount::text from public.timesheet_entries limit 1'),
      ('entries.cost_amount',        'select cost_amount::text from public.timesheet_entries limit 1'),
      ('entries.worked_minutes',     'select worked_minutes::text from public.timesheet_entries limit 1'),
      ('entries.overtime_minutes',   'select overtime_minutes::text from public.timesheet_entries limit 1'),
      ('entries.daily_rate_snapshot','select daily_rate_snapshot::text from public.timesheet_entries limit 1'),
      ('entries.cost_snapshot',      'select daily_cost_snapshot::text from public.timesheet_entries limit 1'),
      ('entries.invoice_id',         'select coalesce(invoice_id::text, ''sem fatura'') from public.timesheet_entries limit 1'),
      ('invoices.total_amount',      'select total_amount::text from public.invoices limit 1'),
      ('invoice_items.amount',       'select amount::text from public.invoice_items limit 1')
    ) as v(rotulo, sql)
  loop
    _i := _i + 1;
    perform pg_temp.registrar(
      format('C%s. operador aal2 nao alcanca %s', _i, _c.rotulo), 'nulo',
      pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2', _c.sql));
  end loop;
end;
$bloco_c$;


-- ---------------------------------------------------------------------------
-- D. Operador em AAL2 — nenhuma escrita direta
--
-- Sem a `016`, os cinco primeiros devolvem `1`: a permissiva por `is_staff()`
-- era `FOR ALL` nessas tabelas, então dava UPDATE e DELETE.
-- ---------------------------------------------------------------------------

do $bloco_d$
declare _c record; _i int := 0;
begin
  for _c in
    select * from (values
      ('UPDATE operations',  'with u as (update public.operations set name = ''INVADIDO'' returning 1) select count(*)::text from u'),
      ('UPDATE shifts',      'with u as (update public.shifts set name = ''INVADIDO'' returning 1) select count(*)::text from u'),
      ('UPDATE timesheets',  'with u as (update public.timesheets set notes = ''INVADIDO'' returning 1) select count(*)::text from u'),
      ('UPDATE entries',     'with u as (update public.timesheet_entries set notes = ''INVADIDO'' returning 1) select count(*)::text from u'),
      ('UPDATE team',        'with u as (update public.operation_team set active = false returning 1) select count(*)::text from u'),
      ('DELETE team',        'with d as (delete from public.operation_team returning 1) select count(*)::text from d'),
      ('DELETE entries',     'with d as (delete from public.timesheet_entries returning 1) select count(*)::text from d'),
      ('UPDATE clients',     'with u as (update public.clients set name = ''INVADIDO'' returning 1) select count(*)::text from u'),
      ('UPDATE employees',   'with u as (update public.employees set daily_cost = 1 returning 1) select count(*)::text from u')
    ) as v(rotulo, sql)
  loop
    _i := _i + 1;
    perform pg_temp.registrar(
      format('D%s. operador aal2 nao escreve: %s', _i, _c.rotulo), '0',
      pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2', _c.sql));
  end loop;

  -- INSERT é recusado por privilégio, e não por linha: a WITH CHECK da
  -- RESTRICTIVE nova sobe como 42501.
  perform pg_temp.registrar('D10. operador aal2 nao insere operacao', 'erro 42501',
    pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2',
      'with i as (insert into public.operations (client_id, contract_id, name, site, type, operation_date)
                  values (''0c000000-0000-4000-8000-000000000001'',
                          ''0d000000-0000-4000-8000-000000000001'',
                          ''NOVA'', ''X'', ''fixed'', ''2026-09-11'') returning 1)
       select count(*)::text from i'));

  -- Aqui o SQLSTATE é incidental e não vale como contrato: o INSERT morre antes
  -- da WITH CHECK, num trigger da 010 que resolve a folha e não a enxerga mais
  -- para esta sessão — `23503`, não `42501`. O que precisa ser verdade é que
  -- **nenhuma linha nasce**, e é isso que o caso mede.
  perform pg_temp.registrar('D11. operador aal2 nao insere apontamento', 'recusado',
    case when pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2',
      'with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status)
                  values (''0aa00000-0000-4000-8000-000000000001'',
                          ''05000000-0000-4000-8000-000000000001'', ''absent'') returning 1)
       select count(*)::text from i') like 'erro %'
         then 'recusado' else 'ATRAVESSOU' end);

  perform pg_temp.registrar('D12. e a tabela segue com uma linha so', '1',
    (select count(*)::text from public.timesheet_entries));
end;
$bloco_d$;


-- ---------------------------------------------------------------------------
-- E. As cinco RPCs continuam funcionando — a porta estreita não foi fechada
--
-- É a metade que importa tanto quanto a outra: a `016` fecha a porta larga sem
-- encostar na estreita, porque `bslog_rpc_operacional` tem BYPASSRLS e policy
-- nenhuma o alcança.
-- ---------------------------------------------------------------------------

do $bloco_e$
declare _op text := '0a000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.registrar('E1. RPC operacoes em aal1', '1',
    pg_temp.medir(_op, 'aal1', 'select count(*)::text from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('E2. RPC operacoes em aal2', '1',
    pg_temp.medir(_op, 'aal2', 'select count(*)::text from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('E3. RPC turnos em aal2', '1',
    pg_temp.medir(_op, 'aal2',
      'select count(*)::text from public.listar_turnos_do_operador(''0e000000-0000-4000-8000-000000000001'')'));

  perform pg_temp.registrar('E4. RPC equipe em aal2', '1',
    pg_temp.medir(_op, 'aal2',
      'select count(*)::text from public.listar_equipe_do_operador(
         ''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'')'));

  perform pg_temp.registrar('E5. RPC apontamentos em aal2', '1',
    pg_temp.medir(_op, 'aal2',
      'select count(*)::text from public.listar_apontamentos_do_operador(
         ''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'', ''2026-09-10'')'));

  -- A escrita pela RPC continua chegando na tabela — é o caminho real do
  -- operador, e o que o bloco D acabou de provar ser impossível por fora.
  perform pg_temp.registrar('E6. RPC salva apontamento em aal2', 'ok',
    pg_temp.medir(_op, 'aal2',
      'select case when public.salvar_apontamento_operacional(
          ''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'',
          ''2026-09-10''::date,
          ''[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"absent"}]''::jsonb
        ) is not null then ''ok'' else ''nulo'' end'));

  -- E o operador continua sem alcançar operação que não lhe foi atribuída.
  perform pg_temp.registrar('E7. RPC recusa operacao nao atribuida', 'erro 42501',
    pg_temp.medir(_op, 'aal2',
      'select count(*)::text from public.listar_turnos_do_operador(''0e000000-0000-4000-8000-00000000009f'')'));
end;
$bloco_e$;


-- ---------------------------------------------------------------------------
-- F. Admin — o acesso administrativo não foi tocado
-- ---------------------------------------------------------------------------

do $bloco_f$
declare _adm text := '0a000000-0000-4000-8000-000000000003'; _t text; _i int := 0;
begin
  foreach _t in array array['clients','contracts','employees','operations','shifts',
                            'operation_team','timesheets','timesheet_entries',
                            'invoices','invoice_items']
  loop
    _i := _i + 1;
    perform pg_temp.registrar(
      format('F%s. admin aal2 le %s', _i, _t), '1',
      pg_temp.medir(_adm, 'aal2', format('select count(*)::text from public.%I', _t)));
  end loop;

  perform pg_temp.registrar('F11. admin aal2 escreve em operations', '1',
    pg_temp.medir(_adm, 'aal2',
      'with u as (update public.operations set site = ''Galpao 2'' returning 1) select count(*)::text from u'));

  perform pg_temp.registrar('F12. admin aal2 escreve em clients', '1',
    pg_temp.medir(_adm, 'aal2',
      'with u as (update public.clients set notes = ''ok'' returning 1) select count(*)::text from u'));

  -- O enforcement de AAL2 do admin continua sendo o que era.
  perform pg_temp.registrar('F13. admin aal1 continua barrado', '0',
    pg_temp.medir(_adm, 'aal1', 'select count(*)::text from public.clients'));
end;
$bloco_f$;


-- ---------------------------------------------------------------------------
-- G. Acumulador e conta sem papel
--
-- `admin` + `operacional` é ADMIN, no banco e na interface: mantém o acesso
-- administrativo e **não** é elegível à superfície operacional. A conta sem
-- papel não alcança nada.
-- ---------------------------------------------------------------------------

do $bloco_g$
declare _dup text := '0a000000-0000-4000-8000-000000000006';
        _nul text := '0a000000-0000-4000-8000-000000000009';
begin
  perform pg_temp.registrar('G1. acumulador aal2 mantem acesso administrativo', '1',
    pg_temp.medir(_dup, 'aal2', 'select count(*)::text from public.clients'));

  perform pg_temp.registrar('G2. acumulador aal2 escreve como admin', '1',
    pg_temp.medir(_dup, 'aal2',
      'with u as (update public.clients set notes = ''dup'' returning 1) select count(*)::text from u'));

  perform pg_temp.registrar('G3. acumulador nao e elegivel a RPC, em aal1', 'erro 42501',
    pg_temp.medir(_dup, 'aal1', 'select count(*)::text from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('G4. acumulador nao e elegivel a RPC, em aal2', 'erro 42501',
    pg_temp.medir(_dup, 'aal2', 'select count(*)::text from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('G5. conta sem papel nao le tabela', '0',
    pg_temp.medir(_nul, 'aal2', 'select count(*)::text from public.clients'));

  perform pg_temp.registrar('G6. conta sem papel nao usa a RPC', 'erro 42501',
    pg_temp.medir(_nul, 'aal2', 'select count(*)::text from public.listar_operacoes_do_operador()'));
end;
$bloco_g$;


-- ---------------------------------------------------------------------------
-- H. `user_operation_access` continua admin + AAL2
-- ---------------------------------------------------------------------------

do $bloco_h$
begin
  perform pg_temp.registrar('H1. operador nao le user_operation_access em aal1', '0',
    pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
                  'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('H2. nem em aal2', '0',
    pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2',
                  'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('H3. admin em aal2 le user_operation_access', '2',
    pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2',
                  'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('H4. e a tabela nao ganhou policy *_exige_admin', '0',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'user_operation_access'
        and policyname like '%\_exige\_admin'));
end;
$bloco_h$;


-- ---------------------------------------------------------------------------
-- I. A forma da correção — o que a 016 criou, e o que ela NÃO tocou
-- ---------------------------------------------------------------------------

do $bloco_i$
begin
  perform pg_temp.registrar('I1. dez policies *_exige_admin RESTRICTIVE', '10',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%\_exige\_admin'
        and permissive = 'RESTRICTIVE' and cmd = 'ALL'
        and roles = array['authenticated']::name[]));

  perform pg_temp.registrar('I2. as onze *_exige_aal2 seguem intactas', '11',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%\_exige\_aal2'
        and permissive = 'RESTRICTIVE'));

  perform pg_temp.registrar('I3. profiles ficou de fora', '0',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'profiles'
        and policyname like '%\_exige\_admin'));

  perform pg_temp.registrar('I4. user_roles ficou de fora', '0',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'user_roles'
        and policyname like '%\_exige\_admin'));

  perform pg_temp.registrar('I5. as cinco RPCs seguem com o dono dedicado', '5',
    (select count(*)::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public' and r.rolname = 'bslog_rpc_operacional'
        and p.proname in ('listar_operacoes_do_operador','listar_turnos_do_operador',
                          'listar_equipe_do_operador','listar_apontamentos_do_operador',
                          'salvar_apontamento_operacional')));

  perform pg_temp.registrar('I6. o papel dedicado mantem BYPASSRLS', 'true',
    (select rolbypassrls::text from pg_roles where rolname = 'bslog_rpc_operacional'));

  perform pg_temp.registrar('I7. nenhum privilegio de TABELA para o papel dedicado', '0',
    (select count(*)::text from information_schema.table_privileges
      where grantee = 'bslog_rpc_operacional'));

  perform pg_temp.registrar('I8. nenhuma coluna financeira concedida a ele', '0',
    (select count(*)::text from information_schema.column_privileges
      where grantee = 'bslog_rpc_operacional'
        and column_name in ('billed_amount','cost_amount','invoice_id','daily_cost',
                            'agreed_amount','daily_rate_snapshot','ot_hour_rate_snapshot',
                            'daily_cost_snapshot')));

  perform pg_temp.registrar('I9. as constraints da 014 seguem de pe', '2',
    (select count(*)::text from pg_constraint
      where conname in ('timesheet_entries_break_minutes_nao_negativo',
                        'shifts_break_minutes_nao_negativo')));

  perform pg_temp.registrar('I10. is_staff nao foi redefinida', 'true',
    (select (prosrc like '%user_roles%' and prosrc not like '%app_role%')::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_staff'));
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
    raise exception '012_restringir_postgrest_operacional: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
