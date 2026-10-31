-- Fechamento × migration 030 (C05-B8.19): o que o Fechamento soma fecha com o banco.
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que termina
-- em `rollback`. NUNCA rodar contra Production nem homologação: escreve em `auth.users`, nas tabelas
-- de negócio e na trilha, liga o motor e gera fatura dentro da transação.
--
-- O QUE ESTE ARQUIVO PROVA (valores calculados à mão, no cabeçalho de cada caso)
--
--   O Fechamento (src/lib/fechamento) lê `timesheet_entries` e SOMA o que o trigger gravou:
--   cobrado, custo, minutos cobrados e a decomposição diária/extra `greatest(cobrado − taxa, 0)`.
--   Os adicionais e o ajuste do arredondamento acumulado vêm das funções do banco. Aqui o mesmo
--   recorte é somado em SQL e comparado com:
--
--     Q  números esperados à mão (apontamentos, custo, horas, ajuste, adicional, receita)
--     R  `resumo_financeiro_periodo` (a fonte de Dashboard e Relatórios), antes e depois da fatura
--     F  `gerar_fatura`: totais e itens (diárias, horas extras, arredondamento, adicional)
--     S  saldo de horas: informativo, não altera valor algum
--     I  imutabilidade: o histórico faturado não muda com a leitura
--     K  segurança: operacional e admin sem MFA não leem as funções do Fechamento
--
--   `scripts/testar-fechamento-regras-030.mjs` lê ESTE arquivo e confere que os mesmos números
--   estão nos cenários TypeScript. Se um lado mudar sem o outro, uma das suítes acusa.
--
-- CENÁRIO — cliente FQ, quinzena 01–15/03/2026. Contrato: diária 120, jornada 8 h, hora extra ×1,5
-- (valor-hora cobrado 22,50), tolerância 10 min, MODO ACUMULADO, sábado de referência 4 h, feriado
-- ×2 no pagamento. Feriado cadastrado: 05/03. Custo diário: E1 80, E2 150, E3 80.
--
--   02/03 seg  E1  06:00–15:14  14 min a mais, acumulados (sem tolerância): 120 + 14/60 × 22,50 = 125,25
--   03/03 ter  E1  06:00–15:26  26 min a mais: 129,75      (E1 acumula 14 + 26 = 40 min → 30)
--   04/03 qua  E2  FALTA
--   05/03 qui  E3  06:00–13:00  FERIADO, 6 h: cobra 120 × 360/480 = 90,00; paga 6 × 80/8 × 2 = 120,00
--   06/03 sex  E3  06:00 sem saída: presença sem horário completo, diária cheia 120,00 / 80,00
--   07/03 sáb  E2  06:00–12:00  sábado, 6 h (ref. 4 h): 120 + 120/60 × 22,50 = 165,00; paga 150 × 360/480 = 112,50
--   08/03 dom  E1  06:00–15:00  domingo é dia comum (regra não confirmada): 120,00 / 80,00
--
--   apontamentos 125,25 + 129,75 + 90,00 + 120,00 + 165,00 + 120,00 = 750,00
--   custo        82,33 +  84,33 + 120,00 +  80,00 + 112,50 +  80,00 = 559,16
--   adicional    100,00 (registrado, sem fatura)
--   ajuste       E1: 40 min → 30 min, 15,00 → 11,25 = −3,75; E2: 120 min (hora cheia) 0,00; E3: 0
--   receita      750,00 + 100,00 − 3,75 = 846,25      resultado 287,09      margem 33,9%

begin;

create temporary table _resultado (
  ordem serial, caso text, esperado text, obtido text, situacao text
) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text) returns void
language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido, case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;

create or replace function pg_temp.medir_como(_papel text, _claims jsonb, _sql text) returns text language plpgsql as $$
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
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c400000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c400000-0000-4000-8000-0000000000a2', 'aal1', _sql)
$$;
create or replace function pg_temp.adm1(_sql text) returns text language sql as $$
  select pg_temp.como('5c400000-0000-4000-8000-0000000000a1', 'aal1', _sql)
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c400000-0000-4000-8000-0000000000a1'), ('5c400000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec400000-0000-4000-8000-0000000000a1', '5c400000-0000-4000-8000-0000000000a1', null),
  ('ec400000-0000-4000-8000-0000000000a2', '5c400000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c400000-0000-4000-8000-0000000000a1', 'admin'), ('5c400000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01B: o admin desta fixture TEM fator verificado. Assim "admin em AAL1" segue significando
-- TOTP pendente, que continua negado (conta SEM fator em AAL1 é coberta por 032_mfa_opcional.sql).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01B', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin';

insert into public.clients (id, name) values ('5c40c000-0000-4000-8000-0000000000c1', 'B819 cliente FQ');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c40d000-0000-4000-8000-0000000000d1', '5c40c000-0000-4000-8000-0000000000c1', 'FQ', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c40f000-0000-4000-8000-000000000001', 'E1', 80),
  ('5c40f000-0000-4000-8000-000000000002', 'E2', 150),
  ('5c40f000-0000-4000-8000-000000000003', 'E3', 80);
insert into public.operations (id, client_id, contract_id, name) values
  ('5c40e000-0000-4000-8000-0000000000a1', '5c40c000-0000-4000-8000-0000000000c1', '5c40d000-0000-4000-8000-0000000000d1', 'OPQ');
-- 06:00-15:00 com 60 min de intervalo: 480 min previstos
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5c40a000-0000-4000-8000-0000000000a1', '5c40e000-0000-4000-8000-0000000000a1', 'SQ', '06:00', '15:00', 60);

create or replace function pg_temp.folha(_cod text, _data date) returns void language sql as $$
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c40b000-0000-4000-8000-0000000000' || _cod)::uuid, '5c40e000-0000-4000-8000-0000000000a1',
          '5c40a000-0000-4000-8000-0000000000a1', _data)
$$;
create or replace function pg_temp.entrada(_cod text, _folha text, _colab text, _in text, _out text, _pausa int default 60, _status text default 'present')
returns text language plpgsql as $$
begin
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values (('5c40b100-0000-4000-8000-0000000000' || _cod)::uuid, ('5c40b000-0000-4000-8000-0000000000' || _folha)::uuid,
          ('5c40f000-0000-4000-8000-00000000000' || _colab)::uuid, _status::public.attendance_status,
          nullif(_in, '')::time, nullif(_out, '')::time, _pausa);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

select pg_temp.registrar('V0. vigências pelas RPCs: contrato FQ acumulado, sábado 4 h, feriado ×2; custos', 'ok',
  case when pg_temp.adm($q$select count(*)::text from (select public.registrar_condicao_contrato('5c40d000-0000-4000-8000-0000000000d1', date '2026-01-01', 120, 8, 1.5, 10, 'FQ', null, false, 'acumulado', 4, 2)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c40f000-0000-4000-8000-000000000001', date '2026-01-01', 80, 'E1')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c40f000-0000-4000-8000-000000000002', date '2026-01-01', 150, 'E2')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c40f000-0000-4000-8000-000000000003', date '2026-01-01', 80, 'E3')) x$q$) = '1'
       then 'ok' else 'falhou' end);
select pg_temp.registrar('V1. feriado de 05/03 registrado; motor ligado', 'true|true',
  (pg_temp.adm($q$select public.registrar_feriado(date '2026-03-05', 'Feriado de teste', 'Calendário B8.19')::text$q$) ~ '^[0-9a-f-]{36}$')::text
  || '|' || pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste B8.19') ->> 'ativo')$q$));

select pg_temp.folha('01', date '2026-03-02');
select pg_temp.folha('02', date '2026-03-03');
select pg_temp.folha('03', date '2026-03-04');
select pg_temp.folha('04', date '2026-03-05');
select pg_temp.folha('05', date '2026-03-06');
select pg_temp.folha('06', date '2026-03-07');
select pg_temp.folha('07', date '2026-03-08');

select pg_temp.registrar('V2. sete lançamentos gravados (seis com valor e uma falta)', 'ok|ok|ok|ok|ok|ok|ok',
  pg_temp.entrada('01', '01', '1', '06:00', '15:14')
  || '|' || pg_temp.entrada('02', '02', '1', '06:00', '15:26')
  || '|' || pg_temp.entrada('03', '03', '2', '', '', 60, 'absent')
  || '|' || pg_temp.entrada('04', '04', '3', '06:00', '13:00')
  || '|' || pg_temp.entrada('05', '05', '3', '06:00', '')
  || '|' || pg_temp.entrada('06', '06', '2', '06:00', '12:00', 0)
  || '|' || pg_temp.entrada('07', '07', '1', '06:00', '15:00'));

select pg_temp.registrar('V3. adicional de 100,00 registrado (ainda sem fatura)', 'true',
  (pg_temp.adm($q$select public.registrar_adicional('5c40c000-0000-4000-8000-0000000000c1', date '2026-03-01', date '2026-03-15', 'Etiquetagem', 100.00, 'REF-1')::text$q$) ~ '^[0-9a-f-]{36}$')::text);

-- O recorte do Fechamento: lançamentos do cliente cujo dia da folha cai no período.
create temporary view _fechamento as
  select te.*
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    join public.operations o on o.id = t.operation_id
   where o.client_id = '5c40c000-0000-4000-8000-0000000000c1'
     and t.work_date between date '2026-03-01' and date '2026-03-15';

-- ---------------------------------------------------------------------------
-- Q. O que o Fechamento soma, contra os números calculados à mão
-- ---------------------------------------------------------------------------

-- FIN-PR-02 (V2): o sábado de 6 h paga a HE acima de 4 h e o custo-base não é proporcional: 150,00 + 2 h × 18,75 = 187,50
-- (a 030 pagava 150 × 360/480 = 112,50 e nenhum excedente). Os demais lançamentos não mudam.
select pg_temp.registrar('Q1. valores por lançamento (cobrado|custo|trabalhados|excedente do custo|minutos cobrados|tipo do dia), em ordem de data',
  '125.25|82.33|494|14|14|util;129.75|84.33|506|26|26|util;0.00|0.00|0|0|0|-;90.00|120.00|360|0|0|feriado;120.00|80.00|0|0|0|util;165.00|187.50|360|120|120|sabado;120.00|80.00|480|0|0|util',
  (select string_agg(billed_amount || '|' || cost_amount || '|' || worked_minutes || '|' || overtime_minutes
                     || '|' || coalesce(billed_overtime_minutes::text, '-') || '|' || coalesce(day_kind_snapshot, '-'), ';' order by work_date)
     from _fechamento));
select pg_temp.registrar('Q2. apontamentos: Σ cobrado dos lançamentos que não são falta = 750,00; custo = 634,16 (V2: sábado pago a 187,50)', '750.00|634.16|6',
  (select sum(billed_amount)::text || '|' || sum(cost_amount)::text || '|' || count(*)::text from _fechamento where status <> 'absent'));
select pg_temp.registrar('Q3. horas extras COBRADAS (minutos cobrados) 160 min e excedente do CUSTO 160 min: o sábado (V2) cobra e paga 120 min acima de 4 h',
  '160|160',
  (select sum(coalesce(billed_overtime_minutes, overtime_minutes))::text || '|' || sum(overtime_minutes)::text from _fechamento where status <> 'absent'));
select pg_temp.registrar('Q4. decomposição: extra = Σ greatest(cobrado − taxa, 0) = 5,25 + 9,75 + 45,00 = 60,00; diária = 750,00 − 60,00 = 690,00 (a diária proporcional do feriado entra na diária)',
  '60.00|690.00',
  (select sum(greatest(billed_amount - daily_rate_snapshot, 0))::text || '|'
          || (sum(billed_amount) - sum(greatest(billed_amount - daily_rate_snapshot, 0)))::text
     from _fechamento where status <> 'absent'));
select pg_temp.registrar('Q5. presença sem horário completo: diária cheia, sem minutos (06/03: 120,00 / 80,00 / 0 min)', '120.00|80.00|0',
  (select billed_amount || '|' || cost_amount || '|' || worked_minutes from _fechamento where work_date = date '2026-03-06'));
select pg_temp.registrar('Q6. tipo do dia congelado: feriado (05/03), sábado (07/03), domingo comum (08/03)', 'feriado|sabado|util',
  (select string_agg(day_kind_snapshot, '|' order by work_date) from _fechamento
    where work_date in (date '2026-03-05', date '2026-03-07', date '2026-03-08')));
select pg_temp.registrar('Q7. a falta (04/03) não tem valor, custo nem minutos', '0.00|0.00|0|0',
  (select billed_amount || '|' || cost_amount || '|' || worked_minutes || '|' || overtime_minutes from _fechamento where status = 'absent'));

-- ---------------------------------------------------------------------------
-- R. resumo_financeiro_periodo e arredondamento acumulado, ANTES da fatura
-- ---------------------------------------------------------------------------

select pg_temp.registrar('R1. ajuste previsto por colaborador: E1 40 → 30 min (15,00 → 11,25 = −3,75); E2 120 min (hora cheia) 0,00; E3 sem minutos 0,00',
  'E1|40|30|15.00|11.25|-3.75;E2|120|120|45.00|45.00|0.00;E3|0|0|0.00|0.00|0.00',
  pg_temp.adm($q$select string_agg(colaborador || '|' || minutos_brutos || '|' || minutos_arredondados || '|' || valor_bruto || '|' || valor_arredondado || '|' || ajuste, ';' order by colaborador)
                   from public.ajustes_de_arredondamento_acumulado('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$));
select pg_temp.registrar('R2. resumo da quinzena: apontamentos 750,00 + adicionais 100,00 + ajuste previsto −3,75 = receita 846,25; a faturar 846,25; faturado 0,00',
  '750.00|100.00|0.00|-3.75|846.25|846.25|0.00|true',
  pg_temp.adm($q$select receita_apontamentos || '|' || adicionais || '|' || ajuste_faturado || '|' || ajuste_previsto || '|' || receita_total || '|' || a_faturar || '|' || faturado || '|' || ajuste_aplicavel
                   from public.resumo_financeiro_periodo('2026-03-01', '2026-03-15', '5c40c000-0000-4000-8000-0000000000c1')$q$));
select pg_temp.registrar('R3. o Fechamento soma o mesmo: apontamentos do recorte = apontamentos do resumo; custo 634,16; resultado 212,09', 'true|634.16|212.09',
  ((select sum(billed_amount) from _fechamento where status <> 'absent')
     = pg_temp.adm($q$select receita_apontamentos::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-15', '5c40c000-0000-4000-8000-0000000000c1')$q$)::numeric)::text
  || '|' || (select sum(cost_amount)::text from _fechamento where status <> 'absent')
  || '|' || (750.00 + 100.00 - 3.75 - (select sum(cost_amount) from _fechamento where status <> 'absent'))::text);
select pg_temp.registrar('R4. o adicional do período está na lista do Fechamento (1 não cancelado, 100,00, sem fatura)', '1|100.00|0',
  (select count(*)::text || '|' || coalesce(sum(amount), 0)::text || '|' || count(invoice_id)::text from public.billing_additionals
    where client_id = '5c40c000-0000-4000-8000-0000000000c1' and canceled_at is null
      and period_start >= date '2026-03-01' and period_end <= date '2026-03-15'));

-- ---------------------------------------------------------------------------
-- S. Saldo de horas: informativo
-- ---------------------------------------------------------------------------

select pg_temp.registrar('S1. saldo (apontamentos com entrada e saída): E1 3 lançamentos +40 min; E2 sábado +120 min (ref. 4 h); E3 só o feriado −120 min',
  'E1|3|40|0|40;E2|1|120|0|120;E3|1|0|120|-120',
  pg_temp.adm($q$select string_agg(colaborador || '|' || apontamentos || '|' || minutos_excedentes || '|' || minutos_faltantes || '|' || saldo, ';' order by colaborador)
                   from public.saldo_de_horas_do_periodo('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$));
select pg_temp.registrar('S2. o saldo não altera valor algum: o resumo continua o mesmo', '846.25',
  pg_temp.adm($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-15', '5c40c000-0000-4000-8000-0000000000c1')$q$));

-- ---------------------------------------------------------------------------
-- M. Mês inteiro: o Fechamento mensal arredonda o mês de uma vez; o resumo soma quinzenas
-- ---------------------------------------------------------------------------

select pg_temp.folha('08', date '2026-03-16');
select pg_temp.registrar('M1. E1 trabalha 40 min a mais em 16/03: lançamento gravado', 'ok',
  pg_temp.entrada('08', '08', '1', '06:00', '15:40'));
select pg_temp.registrar('M1b. e cobra 120 + 40/60 × 22,50 = 135,00 com 40 min cobrados', '135.00|40',
  (select billed_amount::text || '|' || billed_overtime_minutes::text from public.timesheet_entries where id = '5c40b100-0000-4000-8000-000000000008'));
select pg_temp.registrar('M2. fechamento 16–31/03 (2ª quinzena): E1 40 → 30 min, ajuste −3,75', 'E1|40|30|-3.75',
  pg_temp.adm($q$select string_agg(colaborador || '|' || minutos_brutos || '|' || minutos_arredondados || '|' || ajuste, ';')
                   from public.ajustes_de_arredondamento_acumulado('5c40c000-0000-4000-8000-0000000000c1', '2026-03-16', '2026-03-31')$q$));
select pg_temp.registrar('M3. fechamento do MÊS (01–31/03) numa vez: E1 14 + 26 + 40 = 80 min → 90 min, 30,00 → 33,75 = +3,75',
  'E1|80|90|30.00|33.75|3.75',
  pg_temp.adm($q$select string_agg(colaborador || '|' || minutos_brutos || '|' || minutos_arredondados || '|' || valor_bruto || '|' || valor_arredondado || '|' || ajuste, ';') filter (where colaborador = 'E1')
                   from public.ajustes_de_arredondamento_acumulado('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-31')$q$));
select pg_temp.registrar('M4. o resumo do mês soma as QUINZENAS (−3,75 + −3,75 = −7,50): é a diferença documentada entre a prévia do Dashboard e a fatura mensal, e nenhum lado é corrigido',
  '-7.50',
  pg_temp.adm($q$select ajuste_previsto::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-31', '5c40c000-0000-4000-8000-0000000000c1')$q$));

-- ---------------------------------------------------------------------------
-- F. Fatura da quinzena
-- ---------------------------------------------------------------------------

create temporary table _fat (id text);
insert into _fat select pg_temp.adm($q$select (public.gerar_fatura('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$);

select pg_temp.registrar('F1. fatura: total 846,25 (750,00 + adicional 100,00 − ajuste 3,75), custo 634,16, 2,50 h cobradas (160 − 10 min de ajuste)', '846.25|634.16|2.50',
  (select total_amount::text || '|' || total_cost::text || '|' || total_overtime::text from public.invoices where id::text = (select id from _fat)));
select pg_temp.registrar('F2. itens por tipo: diárias 690,00, horas extras 60,00, arredondamento −3,75, adicional 100,00 — a decomposição do Fechamento',
  '690.00|60.00|-3.75|100.00',
  (select coalesce(sum(amount) filter (where kind = 'diarias'), 0)::text || '|' || coalesce(sum(amount) filter (where kind = 'horas_extras'), 0)::text
          || '|' || coalesce(sum(amount) filter (where kind = 'arredondamento'), 0)::text || '|' || coalesce(sum(amount) filter (where kind = 'adicional'), 0)::text
     from public.invoice_items where invoice_id::text = (select id from _fat)));
select pg_temp.registrar('F3. itens fecham com o total e todos têm tipo', 'true|0',
  ((select sum(amount) from public.invoice_items where invoice_id::text = (select id from _fat))
     = (select total_amount from public.invoices where id::text = (select id from _fat)))::text
  || '|' || (select count(*)::text from public.invoice_items where invoice_id::text = (select id from _fat) and kind is null));
select pg_temp.registrar('F4. o item de arredondamento diz colaborador e minutos', 'Arredondamento acumulado de horas extras — E1 (40 min → 30 min)|-3.75',
  (select description || '|' || amount from public.invoice_items
    where invoice_id::text = (select id from _fat) and kind = 'arredondamento'));
select pg_temp.registrar('F5. seis lançamentos e o adicional ficaram vinculados; a falta e o lançamento de 16/03 ficaram de fora', '6|1|1|0',
  (select count(*)::text from public.timesheet_entries where invoice_id::text = (select id from _fat))
  || '|' || (select count(*)::text from public.billing_additionals where invoice_id::text = (select id from _fat))
  || '|' || (select count(*)::text from public.timesheet_entries where id = '5c40b100-0000-4000-8000-000000000008' and invoice_id is null)
  || '|' || (select count(*)::text from _fechamento where status = 'absent' and invoice_id is not null));
select pg_temp.registrar('R5. resumo depois da fatura: o ajuste migra de previsto para faturado (−3,75); a faturar 0,00; faturado = receita 846,25', '750.00|100.00|-3.75|0.00|846.25|0.00|846.25|true',
  pg_temp.adm($q$select receita_apontamentos || '|' || adicionais || '|' || ajuste_faturado || '|' || ajuste_previsto || '|' || receita_total || '|' || a_faturar || '|' || faturado || '|' || ajuste_aplicavel
                   from public.resumo_financeiro_periodo('2026-03-01', '2026-03-15', '5c40c000-0000-4000-8000-0000000000c1')$q$));
select pg_temp.registrar('R6. o item de arredondamento faturado está na lista do Fechamento (invoice_items kind=arredondamento do período), e a prévia da quinzena zerou', '1|-3.75|0',
  (select count(*)::text || '|' || coalesce(sum(it.amount), 0)::text
     from public.invoice_items it join public.invoices i on i.id = it.invoice_id
    where it.kind = 'arredondamento' and i.client_id = '5c40c000-0000-4000-8000-0000000000c1'
      and i.period_start >= date '2026-03-01' and i.period_end <= date '2026-03-15')
  || '|' || pg_temp.adm($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$));

-- ---------------------------------------------------------------------------
-- I. Imutabilidade do histórico
-- ---------------------------------------------------------------------------

select pg_temp.registrar('I1. apontamento faturado é imutável (42501); os valores do Fechamento não mudam', 'erro 42501|125.25|82.33',
  pg_temp.adm($q$with u as (update public.timesheet_entries set check_out = '15:00' where id = '5c40b100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$)
  || '|' || (select billed_amount::text from public.timesheet_entries where id = '5c40b100-0000-4000-8000-000000000001')
  || '|' || (select cost_amount::text from public.timesheet_entries where id = '5c40b100-0000-4000-8000-000000000001'));
select pg_temp.registrar('I2. fatura da mesma quinzena de novo: P0002 (nada a faturar)', 'erro P0002',
  pg_temp.adm($q$select (public.gerar_fatura('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$));

-- ---------------------------------------------------------------------------
-- K. Segurança: só admin com MFA lê as funções do Fechamento
-- ---------------------------------------------------------------------------

select pg_temp.registrar('K1. operacional (AAL1) e admin sem MFA recusados nas três funções (42501)', 'erro 42501|erro 42501|erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.ope($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.adm1($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.ope($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.adm1($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.ope($q$select count(*)::text from public.saldo_de_horas_do_periodo('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.adm1($q$select count(*)::text from public.saldo_de_horas_do_periodo('5c40c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$));
select pg_temp.registrar('K2. operacional não lê adicionais nem itens de fatura pelo PostgREST (RLS): 0 linhas', '0|0',
  pg_temp.ope($q$select count(*)::text from public.billing_additionals$q$)
  || '|' || pg_temp.ope($q$select count(*)::text from public.invoice_items$q$));

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao <> 'PASS' order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*) as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '029_fechamento_conciliacao: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
