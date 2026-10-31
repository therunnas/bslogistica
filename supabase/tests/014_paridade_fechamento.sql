-- Paridade do Fechamento com `gerar_fatura`.
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável), ou cole
-- o arquivo no SQL Editor de um banco local e rode de uma vez. Tudo acontece
-- numa transação que termina em `rollback`. NUNCA rode isto em Production:
-- `gerar_fatura` é mutável (cria fatura e vincula lançamentos).
--
-- O QUE ESTA SUÍTE PROVA
--
--   dados de negócio (contrato, operação, turno, folha, lançamento)
--     -> trigger `derivar_valores_financeiros` (NÃO gravamos billed/cost à mão)
--     -> `timesheet_entries` persistido
--     -> `gerar_fatura`
--
-- e que o resultado fecha, linha a linha e nos quatro totais, com o que o
-- núcleo TypeScript do Fechamento (`src/lib/fechamento/`) calcula sobre a
-- fixture ouro `scripts/fixtures/fechamento-paridade.json`:
--
--   total_dailies / total_overtime / total_amount / total_cost
--
-- COMO SQL E TYPESCRIPT FICAM LIGADOS
--
-- Os números esperados abaixo são COPIADOS da fixture ouro (campo `esperado`),
-- não recalculados aqui. `scripts/testar-fechamento-dominio.mjs` lê ESTE arquivo
-- e confere que cada lançamento da fixture (faturado, custo, taxa, minutos
-- extras) e os totais da fatura aparecem aqui com os mesmos valores. Se um lado
-- mudar sem o outro, uma das duas suítes acusa.
--
-- DIFERENÇAS DE CENÁRIO EM RELAÇÃO À FIXTURE (valores persistidos idênticos)
--
--  1. A fixture usa uma única operação `op-beta` para duas taxas (100,00 e
--     0,00), o que um banco real não permite: a taxa vem da operação. Aqui são
--     duas operações sem contrato (`beta`, com agreed_amount 100; `gama`, sem
--     agreed_amount, taxa 0). Os totais não mudam.
--  2. As datas dos lançamentos "já faturados" (e-04, e-06, e-12) são todas
--     2026-03-01, para que uma primeira chamada de `gerar_fatura` sobre esse
--     único dia crie a fatura deles DE VERDADE, em vez de simularmos
--     `invoice_id` à mão (o vínculo só nasce em `gerar_fatura`).
--  3. Os lançamentos fora da janela (outra data, outro cliente) e a terceira
--     chamada (que não acha nada) existem só aqui: provam a janela de datas, o
--     cliente e o comportamento de `gerar_fatura` sem elegíveis — o Fechamento,
--     nesse caso, mostra zeros em vez de levantar erro.

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


-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, email) values
  ('11111111-1111-4111-8111-111111111111', 'Admin de Teste', 'admin@example.invalid');

-- `has_role` do admin autenticado exige identidade utilizável (migration 020): usuário e sessão
-- existentes no Auth, e a sessão nas claims.
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111') on conflict do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('ec111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', null);

insert into public.user_roles (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin');

insert into public.clients (id, name) values
  ('33333333-3333-4333-8333-333333333333', 'Cliente Ouro'),
  ('33333333-3333-4333-8333-333333333399', 'Cliente de Outra Empresa');

-- Contratos: taxa, horas do turno, fator de hora extra e tolerância.
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('c0c0c0c0-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Alfa',    150.00, 8, 1.5, 10),
  ('c0c0c0c0-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Delta',     0.10, 8, 1.5, 10),
  ('c0c0c0c0-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Epsilon',   0.20, 8, 1.5, 10),
  ('c0c0c0c0-0000-4000-8000-000000000099', '33333333-3333-4333-8333-333333333399', 'Outro',   150.00, 8, 1.5, 10);

insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('0b0b0b0b-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c0c0c0c0-0000-4000-8000-000000000001', 'Operação Alfa',    null),
  ('0b0b0b0b-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', null,                                   'Operação Beta',   100),
  ('0b0b0b0b-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', null,                                   'Operação Gama',   null),
  ('0b0b0b0b-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'c0c0c0c0-0000-4000-8000-000000000002', 'Operação Delta',   null),
  ('0b0b0b0b-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', 'c0c0c0c0-0000-4000-8000-000000000003', 'Operação Épsilon', null),
  ('0b0b0b0b-0000-4000-8000-000000000099', '33333333-3333-4333-8333-333333333399', 'c0c0c0c0-0000-4000-8000-000000000099', 'Operação de Outro Cliente', null);

-- Turno diurno 06:00–15:00 com 60 de intervalo: 480 minutos previstos. As demais
-- operações não têm turno (a folha sem turno prevê as horas do contrato).
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5a5a5a5a-0000-4000-8000-000000000001', '0b0b0b0b-0000-4000-8000-000000000001', 'Manhã', '06:00:00', '15:00:00', 60),
  ('5a5a5a5a-0000-4000-8000-000000000099', '0b0b0b0b-0000-4000-8000-000000000099', 'Manhã', '06:00:00', '15:00:00', 60);

-- daily_cost: o custo previsto do colaborador por diária.
insert into public.employees (id, name, role, daily_cost) values
  ('e1e1e1e1-0000-4000-8000-0000000000a1', 'Ana Souza',   'Auxiliar',   90.05),
  ('e1e1e1e1-0000-4000-8000-0000000000b1', 'Bruno Lima',  null,        100.00),
  ('e1e1e1e1-0000-4000-8000-0000000000c1', 'Álvaro Dias', '   ',       120.00),
  ('e1e1e1e1-0000-4000-8000-0000000000d1', 'Carla Mota',  'Conferente', 80.00),
  ('e1e1e1e1-0000-4000-8000-0000000000e1', 'Fábio Reis',  'Auxiliar',    0.05),
  ('e1e1e1e1-0000-4000-8000-0000000000f1', 'Gabi Nunes',  'Auxiliar',   90.05),
  ('e1e1e1e1-0000-4000-8000-000000000011', 'Hugo Pires',  'Auxiliar',   90.05),
  ('e1e1e1e1-0000-4000-8000-000000000099', 'Zeca de Outro Cliente', null, 90.05);

-- Folhas (uma por operação, turno e data).
insert into public.timesheets (operation_id, shift_id, work_date) values
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-03-01'),
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-03-02'),
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-03-03'),
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-03-04'),
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-03-09'),
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-02-28'),
  ('0b0b0b0b-0000-4000-8000-000000000001', '5a5a5a5a-0000-4000-8000-000000000001', '2026-03-16'),
  ('0b0b0b0b-0000-4000-8000-000000000002', null, '2026-03-04'),
  ('0b0b0b0b-0000-4000-8000-000000000003', null, '2026-03-06'),
  ('0b0b0b0b-0000-4000-8000-000000000004', null, '2026-03-07'),
  ('0b0b0b0b-0000-4000-8000-000000000005', null, '2026-03-08'),
  ('0b0b0b0b-0000-4000-8000-000000000099', '5a5a5a5a-0000-4000-8000-000000000099', '2026-03-05');

-- Lançamentos. SÓ os dados de negócio: status, horário e intervalo. billed_amount,
-- cost_amount e os snapshots saem do trigger `derivar_valores_financeiros`.
-- Chave e-NN = lançamento NN da fixture ouro; d-N = isca fora de escopo.
insert into public.timesheet_entries
  (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
select v.id::uuid, t.id, v.emp::uuid, t.operation_id, t.work_date,
       v.status::public.attendance_status, v.cin::time, v.cout::time, v.brk
from (values
  -- já faturados (2026-03-01)
  ('e0e0e004-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000a1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-01', 'present',     '06:00', '15:00', 60),
  ('e0e0e006-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000b1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-01', 'present',     '06:00', '15:45', 60),
  ('e0e0e012-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-000000000011', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-01', 'present',     '06:00', '15:00', 60),
  -- a faturar
  ('e0e0e001-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000a1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-02', 'present',     '06:00', '15:00', 60),
  ('e0e0e005-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000b1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-02', 'replacement', '06:00', '15:00', 60),
  ('e0e0e002-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000a1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-03', 'present',     '06:00', '17:00', 60),
  ('e0e0e007-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000c1', '0b0b0b0b-0000-4000-8000-000000000002', '2026-03-04', 'present',     '08:00', '17:00', 60),
  ('e0e0e008-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000d1', '0b0b0b0b-0000-4000-8000-000000000003', '2026-03-06', 'present',     null,    null,    0),
  ('e0e0e009-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000e1', '0b0b0b0b-0000-4000-8000-000000000004', '2026-03-07', 'present',     '08:00', '17:00', 60),
  ('e0e0e010-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000e1', '0b0b0b0b-0000-4000-8000-000000000005', '2026-03-08', 'present',     '08:00', '17:00', 60),
  -- faltas (nunca entram na fatura)
  ('e0e0e003-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000a1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-04', 'absent',      null,    null,    0),
  ('e0e0e011-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000f1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-09', 'absent',      null,    null,    0),
  -- iscas: fora da janela de datas e de outro cliente
  ('d0d0d001-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000a1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-03-16', 'present',     '06:00', '15:00', 60),
  ('d0d0d002-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-0000000000a1', '0b0b0b0b-0000-4000-8000-000000000001', '2026-02-28', 'present',     '06:00', '15:00', 60),
  ('d0d0d003-0000-4000-8000-000000000000', 'e1e1e1e1-0000-4000-8000-000000000099', '0b0b0b0b-0000-4000-8000-000000000099', '2026-03-05', 'present',     '06:00', '15:00', 60)
) as v(id, emp, op, dt, status, cin, cout, brk)
join public.timesheets t on t.operation_id = v.op::uuid and t.work_date = v.dt::date;

-- ---------------------------------------------------------------------------
-- Esperado, COPIADO da fixture ouro (esperado.*). Não é recalculado aqui.
--   chave | faturado | custo | taxa da diária | minutos trabalhados | minutos extras
-- ---------------------------------------------------------------------------

create temporary table _esperado_linhas (
  chave text primary key, id uuid, billed numeric, cost numeric, taxa numeric, trabalhados integer, extras integer
) on commit drop;

insert into _esperado_linhas (chave, id, billed, cost, taxa, trabalhados, extras) values
  ('e-01', 'e0e0e001-0000-4000-8000-000000000000',  150.00,  90.05, 150.00, 480,   0),
  ('e-02', 'e0e0e002-0000-4000-8000-000000000000',  206.25, 112.56, 150.00, 600, 120),
  ('e-03', 'e0e0e003-0000-4000-8000-000000000000',    0.00,   0.00, 150.00,   0,   0),
  ('e-04', 'e0e0e004-0000-4000-8000-000000000000',  150.00,  90.05, 150.00, 480,   0),
  ('e-05', 'e0e0e005-0000-4000-8000-000000000000',  150.00, 100.00, 150.00, 480,   0),
  ('e-06', 'e0e0e006-0000-4000-8000-000000000000',  171.09, 109.38, 150.00, 525,  45),
  ('e-07', 'e0e0e007-0000-4000-8000-000000000000',  100.00, 120.00, 100.00, 480,   0),
  ('e-08', 'e0e0e008-0000-4000-8000-000000000000',    0.00,  80.00,   0.00,   0,   0),
  ('e-09', 'e0e0e009-0000-4000-8000-000000000000',    0.10,   0.05,   0.10, 480,   0),
  ('e-10', 'e0e0e010-0000-4000-8000-000000000000',    0.20,   0.05,   0.20, 480,   0),
  ('e-11', 'e0e0e011-0000-4000-8000-000000000000',    0.00,   0.00, 150.00,   0,   0),
  ('e-12', 'e0e0e012-0000-4000-8000-000000000000',  150.00,  90.05, 150.00, 480,   0);


-- ---------------------------------------------------------------------------
-- P. O TRIGGER produziu, linha a linha, os valores persistidos esperados.
-- ---------------------------------------------------------------------------

do $persistido$
declare
  _l record;
begin
  for _l in
    select e.chave,
           e.billed || '|' || e.cost || '|' || e.taxa || '|' || e.trabalhados || '|' || e.extras as esperado,
           coalesce(te.billed_amount || '|' || te.cost_amount || '|' || te.daily_rate_snapshot
                    || '|' || te.worked_minutes || '|' || te.overtime_minutes, 'LINHA AUSENTE') as obtido
    from _esperado_linhas e
    left join public.timesheet_entries te on te.id = e.id
    order by e.chave
  loop
    perform pg_temp.registrar(
      'P1. ' || _l.chave || ' (faturado|custo|taxa|trabalhados|extras) vindos do trigger',
      _l.esperado, _l.obtido);
  end loop;

  perform pg_temp.registrar('P2. nenhuma fatura existe antes da primeira chamada', '0',
    (select count(*) from public.invoices)::text);
  perform pg_temp.registrar('P3. nenhum lançamento nasce com invoice_id', '0',
    (select count(*) from public.timesheet_entries where invoice_id is not null)::text);
end;
$persistido$;


-- ---------------------------------------------------------------------------
-- Q0. O CONSOLIDADO que o Fechamento calcula (fixture: esperado.consolidado),
-- recomputado em SQL sobre os valores PERSISTIDOS, antes de qualquer fatura.
-- ---------------------------------------------------------------------------

do $consolidado$
declare
  _r record;
begin
  select count(*)                                                     as diarias,
         coalesce(sum(te.overtime_minutes), 0)                        as minutos,
         coalesce(sum(te.billed_amount), 0)                           as faturado,
         coalesce(sum(te.cost_amount), 0)                             as custo,
         coalesce(sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)), 0) as extra
    into _r
  from public.timesheet_entries te
  join public.timesheets  t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where o.client_id = '33333333-3333-4333-8333-333333333333'
    and t.work_date between '2026-03-01' and '2026-03-15'
    and te.status <> 'absent';

  perform pg_temp.registrar('Q0.1 consolidado: diárias (fixture 10)',            '10',     _r.diarias::text);
  perform pg_temp.registrar('Q0.2 consolidado: minutos extras (fixture 165)',     '165',    _r.minutos::text);
  perform pg_temp.registrar('Q0.3 consolidado: faturado (fixture 1077.64)',       '1077.64', _r.faturado::text);
  perform pg_temp.registrar('Q0.4 consolidado: custo (fixture 792.19)',           '792.19', _r.custo::text);
  perform pg_temp.registrar('Q0.5 consolidado: extra (fixture 77.34)',            '77.34',  _r.extra::text);
  perform pg_temp.registrar('Q0.6 consolidado: diária = faturado − extra (fixture 1000.30)', '1000.30', (_r.faturado - _r.extra)::text);
  perform pg_temp.registrar('Q0.7 as faltas existem no banco e ficam de fora', '2',
    (select count(*) from public.timesheet_entries
      where status = 'absent' and id in ('e0e0e003-0000-4000-8000-000000000000', 'e0e0e011-0000-4000-8000-000000000000'))::text);
end;
$consolidado$;


-- ---------------------------------------------------------------------------
-- S1. Primeira fatura: SÓ 2026-03-01. Cria o "já faturado" do jeito real.
-- Esperado = fixture esperado.jaFaturado: 3 diárias, 45 min (0,75 h),
-- 471,09 faturado, 289,48 custo.
-- ---------------------------------------------------------------------------

-- FIN-PR-05 (038): `gerar_fatura` só aceita uma competência inteira. A fatura de um único dia é
-- a fatura HISTÓRICA, emitida antes da 038 (que a preserva como está): para criá-la do jeito real,
-- a validação da competência é desligada só durante esta chamada, dentro da transação, e
-- restaurada logo depois (S1.0 confere). O resto da suíte usa a validação de verdade.
do $fatura_um$
declare
  _f public.invoices;
  _validacao text := pg_get_functiondef('public.validar_periodo_de_cobranca(uuid, date, date)'::regprocedure);
begin
  execute $sem$create or replace function public.validar_periodo_de_cobranca(p_client_id uuid, p_inicio date, p_fim date)
    returns text language sql stable set search_path = pg_catalog, public, pg_temp as $c$ select 'quinzenal'::text $c$$sem$;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2',
    'session_id', 'ec111111-1111-4111-8111-111111111111')::text, true);
  execute 'set local role authenticated';

  _f := public.gerar_fatura('33333333-3333-4333-8333-333333333333', '2026-03-01', '2026-03-01');

  execute 'reset role';
  execute _validacao;
  perform pg_temp.registrar('S1.0 validação da competência restaurada', 'true',
    (pg_get_functiondef('public.validar_periodo_de_cobranca(uuid, date, date)'::regprocedure) = _validacao)::text);

  perform pg_temp.registrar('S1.1 fatura 1: total_dailies',  '3.00',   _f.total_dailies::text);
  perform pg_temp.registrar('S1.2 fatura 1: total_overtime', '0.75',   _f.total_overtime::text);
  perform pg_temp.registrar('S1.3 fatura 1: total_amount',   '471.09', _f.total_amount::text);
  perform pg_temp.registrar('S1.4 fatura 1: total_cost',     '289.48', _f.total_cost::text);
end;
$fatura_um$;

reset role;

do $depois_um$
declare
  _inv1 uuid;
  _r record;
begin
  select id into _inv1 from public.invoices
   where client_id = '33333333-3333-4333-8333-333333333333' and period_end = '2026-03-01';

  perform pg_temp.registrar('S1.5 e-04, e-06 e e-12 foram vinculados à fatura 1', '3',
    (select count(*) from public.timesheet_entries
      where invoice_id = _inv1
        and id in ('e0e0e004-0000-4000-8000-000000000000', 'e0e0e006-0000-4000-8000-000000000000', 'e0e0e012-0000-4000-8000-000000000000'))::text);
  perform pg_temp.registrar('S1.6 só esses três têm invoice_id', '3',
    (select count(*) from public.timesheet_entries where invoice_id is not null)::text);

  -- "A faturar" do Fechamento = o que sobrou elegível (fixture esperado.aFaturar).
  select count(*)                                                     as diarias,
         coalesce(sum(te.overtime_minutes), 0)                        as minutos,
         coalesce(sum(te.billed_amount), 0)                           as faturado,
         coalesce(sum(te.cost_amount), 0)                             as custo,
         coalesce(sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)), 0) as extra
    into _r
  from public.timesheet_entries te
  join public.timesheets  t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where o.client_id = '33333333-3333-4333-8333-333333333333'
    and t.work_date between '2026-03-01' and '2026-03-15'
    and te.status <> 'absent'
    and te.invoice_id is null;

  perform pg_temp.registrar('Q1.1 a faturar: diárias (fixture 7)',        '7',      _r.diarias::text);
  perform pg_temp.registrar('Q1.2 a faturar: minutos extras (fixture 120)', '120',   _r.minutos::text);
  perform pg_temp.registrar('Q1.3 a faturar: faturado (fixture 606.55)',  '606.55', _r.faturado::text);
  perform pg_temp.registrar('Q1.4 a faturar: custo (fixture 502.71)',     '502.71', _r.custo::text);
  perform pg_temp.registrar('Q1.5 a faturar: extra (fixture 56.25)',      '56.25',  _r.extra::text);
  perform pg_temp.registrar('Q1.6 a faturar: diária (fixture 550.30)',    '550.30', (_r.faturado - _r.extra)::text);
end;
$depois_um$;


-- ---------------------------------------------------------------------------
-- S2. Segunda fatura: a quinzena inteira. Só o que sobrou: as 7 linhas
-- "a faturar". Esperado = fixture esperado.gerarFatura.
-- ---------------------------------------------------------------------------

do $fatura_dois$
declare
  _f public.invoices;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2',
    'session_id', 'ec111111-1111-4111-8111-111111111111')::text, true);
  execute 'set local role authenticated';

  _f := public.gerar_fatura('33333333-3333-4333-8333-333333333333', '2026-03-01', '2026-03-15');

  perform pg_temp.registrar('S2.1 fatura 2: total_dailies  (fixture total_dailies 7)',     '7.00',   _f.total_dailies::text);
  perform pg_temp.registrar('S2.2 fatura 2: total_overtime (fixture total_overtime 2.00)', '2.00',   _f.total_overtime::text);
  perform pg_temp.registrar('S2.3 fatura 2: total_amount   (fixture total_amount 606.55)', '606.55', _f.total_amount::text);
  perform pg_temp.registrar('S2.4 fatura 2: total_cost     (fixture total_cost 502.71)',   '502.71', _f.total_cost::text);
  perform pg_temp.registrar('S2.5 fatura 2: status', 'closed', _f.status::text);
  perform pg_temp.registrar('S2.6 fatura 2: período', '2026-03-01..2026-03-15',
    _f.period_start::text || '..' || _f.period_end::text);
end;
$fatura_dois$;

reset role;

do $depois_dois$
declare
  _inv1 uuid;
  _inv2 uuid;
begin
  select id into _inv1 from public.invoices
   where client_id = '33333333-3333-4333-8333-333333333333' and period_end = '2026-03-01';
  select id into _inv2 from public.invoices
   where client_id = '33333333-3333-4333-8333-333333333333' and period_end = '2026-03-15';

  perform pg_temp.registrar('S2.7 as 7 linhas a faturar foram vinculadas à fatura 2', '7',
    (select count(*) from public.timesheet_entries
      where invoice_id = _inv2
        and id in ('e0e0e001-0000-4000-8000-000000000000', 'e0e0e002-0000-4000-8000-000000000000',
                   'e0e0e005-0000-4000-8000-000000000000', 'e0e0e007-0000-4000-8000-000000000000',
                   'e0e0e008-0000-4000-8000-000000000000', 'e0e0e009-0000-4000-8000-000000000000',
                   'e0e0e010-0000-4000-8000-000000000000'))::text);
  perform pg_temp.registrar('S2.8 replacement (e-05) ENTRA na fatura', _inv2::text,
    (select invoice_id::text from public.timesheet_entries where id = 'e0e0e005-0000-4000-8000-000000000000'));
  perform pg_temp.registrar('S2.9 absent (e-03 e e-11) NÃO entra: invoice_id nulo', '2',
    (select count(*) from public.timesheet_entries
      where invoice_id is null and status = 'absent'
        and id in ('e0e0e003-0000-4000-8000-000000000000', 'e0e0e011-0000-4000-8000-000000000000'))::text);
  perform pg_temp.registrar('S2.10 já faturados seguem na fatura 1', '3',
    (select count(*) from public.timesheet_entries
      where invoice_id = _inv1
        and id in ('e0e0e004-0000-4000-8000-000000000000', 'e0e0e006-0000-4000-8000-000000000000', 'e0e0e012-0000-4000-8000-000000000000'))::text);
  perform pg_temp.registrar('S2.11 iscas fora da janela de datas seguem sem fatura', '2',
    (select count(*) from public.timesheet_entries
      where invoice_id is null
        and id in ('d0d0d001-0000-4000-8000-000000000000', 'd0d0d002-0000-4000-8000-000000000000'))::text);
  perform pg_temp.registrar('S2.12 isca de outro cliente segue sem fatura', '1',
    (select count(*) from public.timesheet_entries
      where invoice_id is null and id = 'd0d0d003-0000-4000-8000-000000000000')::text);
  perform pg_temp.registrar('S2.13 total de lançamentos vinculados: 3 + 7', '10',
    (select count(*) from public.timesheet_entries where invoice_id is not null)::text);

  -- A decomposição diária/extra do Fechamento é a MESMA dos itens da fatura.
  perform pg_temp.registrar('S2.14 itens "diárias" somam a diária do Fechamento (fixture 550.30)', '550.30',
    -- FIN-PR-03: os itens são lidos pelo TIPO; a descrição agora nomeia a tarifa (discriminação por preço).
    (select sum(amount) from public.invoice_items where invoice_id = _inv2 and kind = 'diarias')::text);
  perform pg_temp.registrar('S2.15 itens "horas extras" somam o extra do Fechamento (fixture 56.25)', '56.25',
    (select sum(amount) from public.invoice_items where invoice_id = _inv2 and kind = 'horas_extras')::text);
  perform pg_temp.registrar('S2.16 itens fecham com o total da fatura', '606.55',
    (select sum(amount) from public.invoice_items where invoice_id = _inv2)::text);
end;
$depois_dois$;


-- ---------------------------------------------------------------------------
-- S3. Sem elegíveis, gerar_fatura levanta P0002. O Fechamento, no mesmo
-- recorte, mostra zeros (diferença deliberada, documentada no cabeçalho).
-- ---------------------------------------------------------------------------

do $fatura_tres$
declare
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2',
    'session_id', 'ec111111-1111-4111-8111-111111111111')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.gerar_fatura('33333333-3333-4333-8333-333333333333', '2026-03-01', '2026-03-15');
    _estado := 'gerou fatura';
  exception when others then
    _estado := 'erro ' || sqlstate;
  end;

  perform pg_temp.registrar('S3.1 sem elegíveis: gerar_fatura levanta P0002', 'erro P0002', _estado);
end;
$fatura_tres$;

reset role;

do $apos_tres$
begin
  perform pg_temp.registrar('S3.2 e nenhuma fatura nova foi criada', '2',
    (select count(*) from public.invoices where client_id = '33333333-3333-4333-8333-333333333333')::text);
end;
$apos_tres$;


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
  raise notice '=== 014 — paridade do Fechamento com gerar_fatura ===';
  for _linha in select * from _resultado order by ordem loop
    raise notice '% % (esperado: % | obtido: %)',
      rpad(_linha.situacao, 5), _linha.caso, _linha.esperado, _linha.obtido;
  end loop;

  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  raise notice '';
  raise notice 'total: % casos, % falhas', (select count(*) from _resultado), _falhas;

  if _falhas > 0 then
    raise exception '014: % casos falharam', _falhas;
  end if;
end;
$relatorio$;

rollback;
