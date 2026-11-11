-- Migration 051 — domingo e feriado em dobro com a resolução desligada (FUNC-READY-02).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que termina em
-- `rollback`. NUNCA rodar contra Production nem homologação. Dados SINTÉTICOS (prefixo 5c51).
--
-- Fixture: K1 com preço-base 250, fator 1,5, jornada 8 h, sábado de 4 h, fator de feriado 2 (030); operação
-- sem contrato com valor acordado 200; colaborador com custo 150. Feriados LEGADOS em 12/10/2026 (segunda) e
-- 15/11/2026 (domingo). Motor ligado, resolução de tarifas DESLIGADA o tempo todo.
--
-- O QUE ESTE ARQUIVO PROVA
--   B  interruptor nasce desligado; com ele desligado, domingo e feriado seguem a 030 (iguais à 050)
--   S  o interruptor não é alterável nem legível como função pela API (authenticated)
--   C  ligado: domingo e feriado em dobro na cobrança e no custo; dia útil e sábado sem mudança; domingo
--      que é feriado conta uma vez; valor acordado também; linha gravada antes não muda sozinha
--   E  ligado: editar horário de especial V2 recalcula; edição só de notas preserva
--   D  desligado de novo: a trava R3 volta a recusar edição motriz de especial V2; domingo novo volta à 030

begin;

create temporary table _resultado (
  ordem serial, caso text, esperado text, obtido text, situacao text
) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text) returns void
language plpgsql as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, coalesce(_obtido, 'nulo'),
          case when _esperado = coalesce(_obtido, 'nulo') then 'PASS' else 'FAIL' end);
end;
$$;

-- Executa como admin sintético; devolve o valor do SELECT, 'linhas N' ou 'erro SQLSTATE'.
create or replace function pg_temp.adm(_sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '5c510000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
    'session_id', 'ec510000-0000-4000-8000-0000000000a1')::text, true);
  set local role authenticated;
  begin
    if lower(ltrim(_sql)) ~ '^(select|with)' then
      execute _sql into _r;
    else
      execute _sql;
      get diagnostics _r = row_count;
      _r := 'linhas ' || _r;
    end if;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return coalesce(_r, 'nulo');
end;
$$;
create or replace function pg_temp.u(_p text, _n int) returns uuid language sql as $$
  select (_p || lpad(_n::text, 12, '0'))::uuid
$$;
-- Folha _n na operação _op (1 = contrato, 2 = valor acordado), no turno da operação, na data _dia.
create or replace function pg_temp.folha(_n int, _op int, _dia date) returns text language sql as $$
  select pg_temp.adm(format($q$insert into public.timesheets (id, operation_id, shift_id, work_date) values (%L, %L, %L, %L)$q$,
    pg_temp.u('5c51b000-0000-4000-8000-', _n), pg_temp.u('5c51e000-0000-4000-8000-', _op),
    pg_temp.u('5c51a000-0000-4000-8000-', _op), _dia))
$$;
create or replace function pg_temp.apt(_n int, _ent text, _sai text) returns text language sql as $$
  select pg_temp.adm(format($q$insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values (%L, %L, %L, 'present', %L, %L, 60)$q$,
    pg_temp.u('5c51b100-0000-4000-8000-', _n), pg_temp.u('5c51b000-0000-4000-8000-', _n),
    pg_temp.u('5c51f000-0000-4000-8000-', 1), _ent, _sai))
$$;
create or replace function pg_temp.lanca(_n int, _op int, _dia date, _ent text, _sai text) returns text language sql as $$
  select pg_temp.folha(_n, _op, _dia) || '/' || pg_temp.apt(_n, _ent, _sai)
$$;
-- cobrado|custo|tipo do dia|versão do cálculo
create or replace function pg_temp.v(_n int) returns text language sql as $$
  select billed_amount::text || '|' || cost_amount::text || '|' || coalesce(day_kind_snapshot, 'nulo')
         || '|v' || coalesce(calc_version::text, '030')
    from public.timesheet_entries where id = pg_temp.u('5c51b100-0000-4000-8000-', _n)
$$;
create or replace function pg_temp.edita(_n int, _set text) returns text language sql as $$
  select pg_temp.adm(format('update public.timesheet_entries set %s where id = %L', _set, pg_temp.u('5c51b100-0000-4000-8000-', _n)))
$$;

-- ---------------------------------------------------------------------------
-- Fixture (motor ligado, resolução desligada)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c510000-0000-4000-8000-0000000000a1');
insert into auth.sessions (id, user_id, not_after) values
  ('ec510000-0000-4000-8000-0000000000a1', '5c510000-0000-4000-8000-0000000000a1', null);
insert into public.user_roles (user_id, role) values ('5c510000-0000-4000-8000-0000000000a1', 'admin');

insert into public.clients (id, name) values
  (pg_temp.u('5c51c000-0000-4000-8000-', 1), 'C51-1'), (pg_temp.u('5c51c000-0000-4000-8000-', 2), 'C51-2');
insert into public.employees (id, name, daily_cost) values (pg_temp.u('5c51f000-0000-4000-8000-', 1), 'E51-1', 150);
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  values (pg_temp.u('5c51f000-0000-4000-8000-', 1), date '2026-01-01', 150, true, 'informada', 'REC051');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values (pg_temp.u('5c51d000-0000-4000-8000-', 1), pg_temp.u('5c51c000-0000-4000-8000-', 1), 'K51', 250, 8, 1.5, 0);
insert into public.contract_terms
  (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason,
   ot_rounding_mode, saturday_shift_hours, holiday_pay_factor)
  values (pg_temp.u('5c51d000-0000-4000-8000-', 1), date '2026-01-01', 250, 8, 1.5, 0, true, 'informada', 'REC051',
          'diario', 4, 2);
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  (pg_temp.u('5c51e000-0000-4000-8000-', 1), pg_temp.u('5c51c000-0000-4000-8000-', 1), pg_temp.u('5c51d000-0000-4000-8000-', 1), 'OP51-K', null),
  (pg_temp.u('5c51e000-0000-4000-8000-', 2), pg_temp.u('5c51c000-0000-4000-8000-', 2), null, 'OP51-AVULSA', 200);
insert into public.operation_terms (operation_id, valid_from, agreed_amount, active, origin, reason)
  values (pg_temp.u('5c51e000-0000-4000-8000-', 2), date '2026-01-01', 200, true, 'informada', 'REC051');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight, shift_period) values
  (pg_temp.u('5c51a000-0000-4000-8000-', 1), pg_temp.u('5c51e000-0000-4000-8000-', 1), 'T51-1', '08:00', '17:00', 60, false, 'diurno'),
  (pg_temp.u('5c51a000-0000-4000-8000-', 2), pg_temp.u('5c51e000-0000-4000-8000-', 2), 'T51-2', '08:00', '17:00', 60, false, 'diurno');
insert into public.financial_holidays (holiday_date, name, reason, territory_scope) values
  (date '2026-10-12', 'FERIADO-SINT-051-SEGUNDA', 'REC051', 'legado'),
  (date '2026-11-15', 'FERIADO-SINT-051-DOMINGO', 'REC051', 'legado');

set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste REC051') ->> 'ativo')$q$));
select pg_temp.registrar('F1. resolução de tarifas desligada', 'false', public.resolucao_de_tarifas_ativa()::text);

-- ---------------------------------------------------------------------------
-- B. Interruptor desligado: igual à 050
-- ---------------------------------------------------------------------------
select pg_temp.registrar('B1. interruptor nasce desligado', 'false', public.dias_especiais_em_dobro_ativo()::text);
select pg_temp.registrar('B2. o estado anuncia o interruptor desligado', 'false',
  pg_temp.adm($q$select public.estado_motor_vigencia() ->> 'dias_especiais_em_dobro'$q$));
select pg_temp.registrar('B3. domingo 8 h desligado: dia comum (030)', 'linhas 1/linhas 1|250.00|150.00|util|v030',
  pg_temp.lanca(1, 1, date '2026-10-11', '08:00', '17:00') || '|' || pg_temp.v(1));
select pg_temp.registrar('B4. feriado 8 h desligado: fator só no custo (030)', 'linhas 1/linhas 1|250.00|300.00|feriado|v030',
  pg_temp.lanca(2, 1, date '2026-10-12', '08:00', '17:00') || '|' || pg_temp.v(2));

-- ---------------------------------------------------------------------------
-- S. Fronteira da API
-- ---------------------------------------------------------------------------
select pg_temp.registrar('S1. authenticated não altera o interruptor', 'erro 42501',
  pg_temp.adm($q$update public.pricing_settings set dias_especiais_em_dobro = true$q$));
select pg_temp.registrar('S2. authenticated não executa a função interna', 'erro 42501',
  pg_temp.adm($q$select public.dias_especiais_em_dobro_ativo()::text$q$));
select pg_temp.registrar('S3. authenticated (admin) lê a coluna', 'false',
  pg_temp.adm($q$select dias_especiais_em_dobro::text from public.pricing_settings$q$));

-- ---------------------------------------------------------------------------
-- C. Interruptor ligado (escrita direta como postgres, como na operação autorizada)
-- ---------------------------------------------------------------------------
update public.pricing_settings set dias_especiais_em_dobro = true, changed_at = now(), reason = 'Ligado no teste REC051';
select pg_temp.registrar('C0. ligado, resolução continua desligada', 'true|false|true',
  public.dias_especiais_em_dobro_ativo()::text || '|' || public.resolucao_de_tarifas_ativa()::text || '|'
  || pg_temp.adm($q$select public.estado_motor_vigencia() ->> 'dias_especiais_em_dobro'$q$));
select pg_temp.registrar('C1. domingo 8 h: 2 × 250 e 2 × 150', 'linhas 1/linhas 1|500.00|300.00|domingo|v2',
  pg_temp.lanca(3, 1, date '2026-10-18', '08:00', '17:00') || '|' || pg_temp.v(3));
select pg_temp.registrar('C2. segunda 8 h sem mudança', 'linhas 1/linhas 1|250.00|150.00|util|v2',
  pg_temp.lanca(4, 1, date '2026-10-19', '08:00', '17:00') || '|' || pg_temp.v(4));
select pg_temp.registrar('C3. sábado 4 h sem mudança', 'linhas 1/linhas 1|250.00|150.00|sabado|v2',
  pg_temp.lanca(5, 1, date '2026-10-17', '08:00', '12:00') || '|' || pg_temp.v(5));
select pg_temp.registrar('C4. domingo que é feriado conta uma vez', 'linhas 1/linhas 1|500.00|300.00|feriado|v2',
  pg_temp.lanca(6, 1, date '2026-11-15', '08:00', '17:00') || '|' || pg_temp.v(6));
select pg_temp.registrar('C5. domingo 8 h na operação sem contrato (valor acordado 200)', 'linhas 1/linhas 1|400.00|300.00|domingo|v2',
  pg_temp.lanca(7, 2, date '2026-10-25', '08:00', '17:00') || '|' || pg_temp.v(7));
select pg_temp.registrar('C6. domingo 4 h: horas efetivas em dobro', 'linhas 1/linhas 1|250.00|150.00|domingo|v2',
  pg_temp.lanca(8, 1, date '2026-11-01', '08:00', '13:00') || '|' || pg_temp.v(8));
select pg_temp.registrar('C7. domingo 10 h: horas efetivas em dobro', 'linhas 1/linhas 1|625.00|375.00|domingo|v2',
  pg_temp.lanca(9, 1, date '2026-11-08', '08:00', '19:00') || '|' || pg_temp.v(9));
select pg_temp.registrar('C8. feriado em dia de semana (sem contrato): horas em dobro', 'linhas 1/linhas 1|400.00|300.00|feriado|v2',
  pg_temp.lanca(10, 2, date '2026-10-12', '08:00', '17:00') || '|' || pg_temp.v(10));
select pg_temp.registrar('C9. linha gravada com o interruptor desligado não muda sozinha', '250.00|150.00|util|v030', pg_temp.v(1));

-- ---------------------------------------------------------------------------
-- E. Edição com o interruptor ligado
-- ---------------------------------------------------------------------------
select pg_temp.registrar('E1. editar horário de domingo V2: recalcula', 'linhas 1|250.00|150.00|domingo|v2',
  pg_temp.edita(3, $s$check_out = '13:00'$s$) || '|' || pg_temp.v(3));
select pg_temp.registrar('E2. só notas na linha gravada desligada: preservada', 'linhas 1|250.00|150.00|util|v030',
  pg_temp.edita(1, $s$notes = 'nota REC051'$s$) || '|' || pg_temp.v(1));
select pg_temp.registrar('E3. editar horário do domingo gravado desligado: passa ao dobro', 'linhas 1|531.25|318.75|domingo|v2',
  pg_temp.edita(1, $s$check_out = '17:30'$s$) || '|' || pg_temp.v(1));

-- ---------------------------------------------------------------------------
-- D. Desligado de novo
-- ---------------------------------------------------------------------------
update public.pricing_settings set dias_especiais_em_dobro = false, changed_at = now(), reason = 'Desligado no teste REC051';
select pg_temp.registrar('D1. desligado', 'false', public.dias_especiais_em_dobro_ativo()::text);
select pg_temp.registrar('D2. editar horário de especial V2 desligado: R3 recusa', 'erro 55000',
  pg_temp.edita(3, $s$check_out = '14:00'$s$));
select pg_temp.registrar('D3. só notas em especial V2 desligado: livre e preservado', 'linhas 1|250.00|150.00|domingo|v2',
  pg_temp.edita(3, $s$notes = 'nota REC051'$s$) || '|' || pg_temp.v(3));
select pg_temp.registrar('D4. domingo novo desligado volta à 030', 'linhas 1/linhas 1|250.00|150.00|util|v030',
  pg_temp.lanca(11, 1, date '2026-11-22', '08:00', '17:00') || '|' || pg_temp.v(11));

-- ---------------------------------------------------------------------------
select caso, situacao, esperado, obtido from _resultado order by ordem;
do $$
begin
  if exists (select 1 from _resultado where situacao = 'FAIL') then
    raise exception '051: % de % asserções FALHARAM.',
      (select count(*) from _resultado where situacao = 'FAIL'), (select count(*) from _resultado);
  end if;
end; $$;
select '051: ' || count(*) || ' asserções PASS; todas as fixtures serão desfeitas.' as resultado from _resultado;
rollback;
