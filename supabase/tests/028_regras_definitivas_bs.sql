-- Migration 030 — regras financeiras definitivas da BS (C05-B8.15).
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que termina
-- em `rollback`. NUNCA rodar contra Production nem homologação: escreve em `auth.users`, nas tabelas
-- de negócio e na trilha, e liga o motor dentro da transação.
--
-- O QUE ESTE ARQUIVO PROVA (valores esperados calculados à mão)
--
--   R  arredondamento: 14, 15, 16, 44, 45, 46 e horas completas preservadas
--   D  cliente comum: arredondamento diário na COBRANÇA, depois da tolerância; custo em minutos exatos
--   E  saída antecipada: cobrança e custo proporcionais (8 h previstas, 4 trabalhadas = meia diária)
--   S  sábado com jornada de referência de 4 h; hora = diária ÷ 8; pagamento inalterado
--   H  feriado: pagamento 6 h × 150/8 × 2 = 225; cobrança inalterada; tipo do dia congelado
--   A  Aceville: minutos brutos sem tolerância, acumulados no fechamento (14 + 26 = 40 -> 30)
--   F  fatura: ajuste auditável, itens fecham com o total, sem cobrança duplicada
--   C  Dynamis: saldo de horas informativo (-30 e +30), sem alterar valores
--   V  parâmetros na vigência: validação, imutabilidade e chamada antiga
--   P  preservação: motor desligado, vigência nova não muda o já precificado
--   X  conciliação e fracionamento (B8.17): períodos, ajuste ± 0, fatura única, resumo do banco
--   K  segurança das RPCs e inventário

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
  select pg_temp.como('5c300000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c300000-0000-4000-8000-0000000000a2', 'aal1', _sql)
$$;
create or replace function pg_temp.adm1(_sql text) returns text language sql as $$
  select pg_temp.como('5c300000-0000-4000-8000-0000000000a1', 'aal1', _sql)
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

insert into auth.users (id) values ('5c300000-0000-4000-8000-0000000000a1'), ('5c300000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec300000-0000-4000-8000-0000000000a1', '5c300000-0000-4000-8000-0000000000a1', null),
  ('ec300000-0000-4000-8000-0000000000a2', '5c300000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c300000-0000-4000-8000-0000000000a1', 'admin'), ('5c300000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01B: o admin desta fixture TEM fator verificado. Assim "admin em AAL1" segue significando
-- TOTP pendente, que continua negado (conta SEM fator em AAL1 é coberta por 032_mfa_opcional.sql).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01B', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin';

-- c1 cliente comum (K1: diário, sábado 4 h, feriado ×2); c2 Aceville (KA: acumulado)
insert into public.clients (id, name) values
  ('5c30c000-0000-4000-8000-0000000000c1', 'B815 cliente comum'),
  ('5c30c000-0000-4000-8000-0000000000c2', 'B815 Aceville');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c30d000-0000-4000-8000-0000000000d1', '5c30c000-0000-4000-8000-0000000000c1', 'K1', 120, 8, 1.5, 10),
  ('5c30d000-0000-4000-8000-0000000000d2', '5c30c000-0000-4000-8000-0000000000c2', 'KA', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c30f000-0000-4000-8000-000000000001', 'E1', 80),
  ('5c30f000-0000-4000-8000-000000000002', 'E2 feriado', 150),
  ('5c30f000-0000-4000-8000-000000000003', 'E3', 80),
  ('5c30f000-0000-4000-8000-000000000004', 'E4 Dynamis', 80);
insert into public.operations (id, client_id, contract_id, name) values
  ('5c30e000-0000-4000-8000-0000000000a1', '5c30c000-0000-4000-8000-0000000000c1', '5c30d000-0000-4000-8000-0000000000d1', 'OPK'),
  ('5c30e000-0000-4000-8000-0000000000a2', '5c30c000-0000-4000-8000-0000000000c2', '5c30d000-0000-4000-8000-0000000000d2', 'OPA'),
  ('5c30e000-0000-4000-8000-0000000000a3', '5c30c000-0000-4000-8000-0000000000c1', '5c30d000-0000-4000-8000-0000000000d1', 'OPL legado');
-- 06:00-15:00 com 60 min de intervalo: 480 min previstos
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5c30a000-0000-4000-8000-0000000000a1', '5c30e000-0000-4000-8000-0000000000a1', 'SK', '06:00', '15:00', 60),
  ('5c30a000-0000-4000-8000-0000000000a2', '5c30e000-0000-4000-8000-0000000000a2', 'SA', '06:00', '15:00', 60),
  ('5c30a000-0000-4000-8000-0000000000a3', '5c30e000-0000-4000-8000-0000000000a3', 'SL', '06:00', '15:00', 60);

create or replace function pg_temp.folha(_cod text, _op text, _data date) returns void language sql as $$
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c30b000-0000-4000-8000-0000000000' || _cod)::uuid, ('5c30e000-0000-4000-8000-0000000000' || _op)::uuid,
          ('5c30a000-0000-4000-8000-0000000000' || _op)::uuid, _data)
$$;
create or replace function pg_temp.entrada(_cod text, _folha text, _colab text, _in text, _out text, _pausa int default 60, _status text default 'present')
returns text language plpgsql as $$
begin
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values (('5c30b100-0000-4000-8000-0000000000' || _cod)::uuid, ('5c30b000-0000-4000-8000-0000000000' || _folha)::uuid,
          ('5c30f000-0000-4000-8000-00000000000' || _colab)::uuid, _status::public.attendance_status,
          nullif(_in, '')::time, nullif(_out, '')::time, _pausa);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
create or replace function pg_temp.id_e(_cod text) returns uuid language sql as $$
  select ('5c30b100-0000-4000-8000-0000000000' || _cod)::uuid
$$;
-- billed|cost|worked|overtime(custo)|billed_overtime|tipo do dia
create or replace function pg_temp.v(_cod text) returns text language sql as $$
  select coalesce((select billed_amount::text || '|' || cost_amount::text || '|' || worked_minutes || '|' || overtime_minutes
                          || '|' || coalesce(billed_overtime_minutes::text, '-') || '|' || coalesce(day_kind_snapshot, '-')
                     from public.timesheet_entries where id = pg_temp.id_e(_cod)), 'ausente')
$$;
create or replace function pg_temp.editar(_cod text, _set text) returns text language sql as $$
  select pg_temp.adm(format($q$with u as (update public.timesheet_entries set %s where id = %L returning 1) select count(*)::text from u$q$,
    _set, pg_temp.id_e(_cod)))
$$;

-- ---------------------------------------------------------------------------
-- R. Arredondamento
-- ---------------------------------------------------------------------------

select pg_temp.registrar('R1. residuais: 0,14,15,16,30,44,45,46,59 -> 0,0,0,30,30,30,30,60,60', '0,0,0,30,30,30,30,60,60',
  (select string_agg(public.arredondar_minutos_extras(m)::text, ',' order by o) from unnest(array[0,14,15,16,30,44,45,46,59]) with ordinality u(m, o)));
select pg_temp.registrar('R2. horas completas preservadas: 60,74,75,76,105,106,134,135,136 -> 60,60,60,90,90,120,120,120,150', '60,60,60,90,90,120,120,120,150',
  (select string_agg(public.arredondar_minutos_extras(m)::text, ',' order by o) from unnest(array[60,74,75,76,105,106,134,135,136]) with ordinality u(m, o)));
select pg_temp.registrar('R3. Aceville: 14 + 26 = 40 acumulados -> 30', '30', public.arredondar_minutos_extras(14 + 26)::text);
select pg_temp.registrar('R4. negativo ou zero -> 0', '0|0', public.arredondar_minutos_extras(-30)::text || '|' || public.arredondar_minutos_extras(0)::text);

-- ---------------------------------------------------------------------------
-- P0. Motor DESLIGADO: nada muda (motor antigo, sem arredondamento nem proporcional)
-- ---------------------------------------------------------------------------

select pg_temp.folha('00', 'a3', date '2026-02-02');
select pg_temp.registrar('P0. motor desligado, saída antecipada: cálculo antigo (diária cheia, sem colunas novas)', 'ok|120.00|80.00|240|0|-|-',
  pg_temp.entrada('00', '00', '1', '06:00', '11:00') || '|' || pg_temp.v('00'));

-- ---------------------------------------------------------------------------
-- Vigências, feriado e motor ligado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('V0. vigências registradas pelas RPCs (K1 diário/sábado 4/feriado 2; KA acumulado; custos)', 'ok',
  case when pg_temp.adm($q$select count(*)::text from (select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d1', date '2026-01-01', 120, 8, 1.5, 10, 'K1', null, false, 'diario', 4, 2)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d2', date '2026-01-01', 120, 8, 1.5, 10, 'KA', null, false, 'acumulado')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c30f000-0000-4000-8000-000000000001', date '2026-01-01', 80, 'E1', null, false, 25)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c30f000-0000-4000-8000-000000000002', date '2026-01-01', 150, 'E2')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c30f000-0000-4000-8000-000000000003', date '2026-01-01', 80, 'E3')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c30f000-0000-4000-8000-000000000004', date '2026-01-01', 80, 'E4')) x$q$) = '1'
       then 'ok' else 'falhou' end);
select pg_temp.registrar('V1. a versão grava os parâmetros (diario|4.00|2.00 e acumulado|-|-)', 'diario|4.00|2.00;acumulado|-|-',
  (select string_agg(ot_rounding_mode || '|' || coalesce(saturday_shift_hours::text, '-') || '|' || coalesce(holiday_pay_factor::text, '-'), ';' order by contract_id)
     from public.contract_terms where contract_id in ('5c30d000-0000-4000-8000-0000000000d1', '5c30d000-0000-4000-8000-0000000000d2')));
create temporary table _fer (id text);
insert into _fer select pg_temp.adm($q$select public.registrar_feriado(date '2026-03-05', 'Feriado de teste', 'Calendário B8.15')::text$q$);
select pg_temp.registrar('V2. feriado registrado pela RPC; o tipo do dia de 05/03 é feriado, de 07/03 sábado e de 08/03 (domingo) útil', 'true|feriado|sabado|util',
  ((select id from _fer) ~ '^[0-9a-f-]{36}$')::text || '|' || public.motor_tipo_do_dia(date '2026-03-05') || '|'
  || public.motor_tipo_do_dia(date '2026-03-07') || '|' || public.motor_tipo_do_dia(date '2026-03-08'));
select pg_temp.registrar('V3. motor ligado sem pendências', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste B8.15') ->> 'ativo')$q$));

select pg_temp.folha('01', 'a1', date '2026-03-02');
select pg_temp.folha('02', 'a1', date '2026-03-03');
select pg_temp.folha('03', 'a1', date '2026-03-04');
select pg_temp.folha('04', 'a1', date '2026-03-05');
select pg_temp.folha('05', 'a1', date '2026-03-06');
select pg_temp.folha('06', 'a1', date '2026-03-07');
select pg_temp.folha('07', 'a1', date '2026-03-08');
select pg_temp.folha('11', 'a2', date '2026-03-02');
select pg_temp.folha('12', 'a2', date '2026-03-03');
select pg_temp.folha('13', 'a2', date '2026-03-05');
select pg_temp.folha('14', 'a1', date '2026-03-09');

-- ---------------------------------------------------------------------------
-- D. Cliente comum: arredondamento diário (cobrança), custo exato
-- ---------------------------------------------------------------------------

-- valor-hora cobrado = 120 / 8 × 1,5 = 22,50; E1 custo-hora acordado 25
select pg_temp.registrar('D1. 14 min a mais (> tolerância 10): cobra 0 min (120,00); paga 14 min exatos: 80 + 14/60 × 25 = 85,83', 'ok|120.00|85.83|494|14|0|util',
  pg_temp.entrada('01', '01', '1', '06:00', '15:14') || '|' || pg_temp.v('01'));
select pg_temp.registrar('D2. 16 min a mais: cobra 30 min = 120 + 0,5 × 22,50 = 131,25; paga 16 min: 80 + 16/60 × 25 = 86,67', 'ok|131.25|86.67|496|16|30|util',
  pg_temp.entrada('02', '02', '1', '06:00', '15:16') || '|' || pg_temp.v('02'));
-- FIN-PR-02 (V2): 45 min de excedente passam a valer 60 min (a 030 arredondava o resto 45 para 30).
select pg_temp.registrar('D3. 45 min a mais: cobra 60 min = 120 + 22,50 = 142,50 (V2: 45 vale a hora seguinte); paga 45 min: 80 + 18,75 = 98,75', 'ok|142.50|98.75|525|45|60|util',
  pg_temp.entrada('03', '03', '1', '06:00', '15:45') || '|' || pg_temp.v('03'));
select pg_temp.registrar('D4. 46 min a mais: cobra 60 min = 142,50; paga 46 min: 80 + 19,17 = 99,17', 'ok|142.50|99.17|526|46|60|util',
  pg_temp.entrada('05', '05', '1', '06:00', '15:46') || '|' || pg_temp.v('05'));
select pg_temp.registrar('D5. 8 min a mais (≤ tolerância): nada cobrado nem pago', 'ok|120.00|80.00|488|0|0|util',
  pg_temp.entrada('06', '01', '3', '06:00', '15:08') || '|' || pg_temp.v('06'));
-- FIN-PR-02 (V2): o resto de 15 min passa a valer 30 min (a 030 descartava o resto 15).
select pg_temp.registrar('D6. 1h15 a mais (75 min): cobra 90 min = 120 + 33,75 = 153,75 (V2: resto 15 vale 30)', 'ok|153.75|555|90',
  pg_temp.entrada('07', '14', '1', '06:00', '16:15') || '|' || split_part(pg_temp.v('07'), '|', 1) || '|' || split_part(pg_temp.v('07'), '|', 3) || '|' || split_part(pg_temp.v('07'), '|', 5));

-- ---------------------------------------------------------------------------
-- E. Saída antecipada: cobrança e custo proporcionais
-- ---------------------------------------------------------------------------

select pg_temp.registrar('E1. 8 h previstas, 4 trabalhadas (06-11 com 60 min de intervalo): meia diária cobrada 60,00 e paga 40,00', 'ok|60.00|40.00|240|0|0|util',
  pg_temp.entrada('08', '02', '3', '06:00', '11:00') || '|' || pg_temp.v('08'));
select pg_temp.registrar('E2. o intervalo é respeitado: 06-10 sem intervalo também são 4 h = 60,00 / 40,00', 'ok|60.00|40.00|240',
  pg_temp.entrada('09', '03', '3', '06:00', '10:00', 0) || '|' || split_part(pg_temp.v('09'), '|', 1) || '|' || split_part(pg_temp.v('09'), '|', 2) || '|' || split_part(pg_temp.v('09'), '|', 3));
select pg_temp.registrar('E3. presença sem saída: diária cheia cobrada e paga (regra de presença), sem proporcional', 'ok|120.00|80.00|0|0|0|util',
  pg_temp.entrada('10', '05', '3', '06:00', '') || '|' || pg_temp.v('10'));
select pg_temp.registrar('E4. corrigir a saída para o turno cheio volta à diária cheia (preço congelado)', '1|120.00|80.00',
  pg_temp.editar('08', $s$check_out = '15:00'$s$) || '|' || split_part(pg_temp.v('08'), '|', 1) || '|' || split_part(pg_temp.v('08'), '|', 2));

-- ---------------------------------------------------------------------------
-- S. Sábado (K1: jornada de referência 4 h)
-- ---------------------------------------------------------------------------

-- FIN-PR-02 (V2): no sábado a HE também é paga acima de 4 h e o custo-base não é proporcional (a 030 pagava 80 × 360/480 = 60,00).
-- Aqui o colaborador tem valor-hora acordado de 25,00: custo = 80,00 + 2 h × 25,00 = 130,00.
select pg_temp.registrar('S1. sábado 6 h (06-12, sem intervalo): 2 h extras sobre a hora diária ÷ 8: 120 + 2 × 22,50 = 165,00; pagamento V2: 80 + 2 h × 25 = 130,00', 'ok|165.00|130.00|360|120|120|sabado',
  pg_temp.entrada('11', '06', '1', '06:00', '12:00', 0) || '|' || pg_temp.v('11'));
-- FIN-PR-02 (V2): até 4 h no sábado vale a DIÁRIA INTEIRA, cobrada e paga (a 030 era proporcional à referência: 90,00 / 30,00).
select pg_temp.registrar('S2. sábado 3 h: diária inteira (V2): 120,00 cobrados e 80,00 pagos', 'ok|120.00|80.00|180|0|0|sabado',
  pg_temp.entrada('12', '06', '3', '06:00', '09:00', 0) || '|' || pg_temp.v('12'));
select pg_temp.registrar('S3. sábado 4h16: 16 min a mais arredondados para 30: 120 + 11,25 = 131,25', 'ok|131.25|256|30|sabado',
  pg_temp.entrada('13', '06', '4', '06:00', '10:16', 0) || '|' || split_part(pg_temp.v('13'), '|', 1) || '|' || split_part(pg_temp.v('13'), '|', 3) || '|' || split_part(pg_temp.v('13'), '|', 5) || '|' || split_part(pg_temp.v('13'), '|', 6));
select pg_temp.registrar('S4. a hora extra de sábado NÃO usa diária ÷ 4 (seria 45,00 a hora): ot_hour_rate_snapshot = 22,5', '22.5',
  (select trim(trailing '0' from trim(trailing '.' from ot_hour_rate_snapshot::text)) from public.timesheet_entries where id = pg_temp.id_e('11')));
select pg_temp.registrar('S5. domingo é dia comum (regra não confirmada): 8 h = 120,00', 'ok|120.00|80.00|480|0|0|util',
  pg_temp.entrada('14', '07', '3', '06:00', '15:00') || '|' || pg_temp.v('14'));
select pg_temp.registrar('S6. contrato sem regra de sábado (KA): sábado comum', 'util-ou-sabado-sem-regra',
  case when (select saturday_shift_hours from public.contract_terms where contract_id = '5c30d000-0000-4000-8000-0000000000d2') is null
       then 'util-ou-sabado-sem-regra' else 'falhou' end);

-- ---------------------------------------------------------------------------
-- H. Feriado (K1: pagamento × 2)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('H1. feriado, diária de custo 150, base 8 h, 6 h trabalhadas: paga 6 × 150/8 × 2 = 225,00; cobrança inalterada (proporcional: 90,00)', 'ok|90.00|225.00|360|0|0|feriado',
  pg_temp.entrada('15', '04', '2', '06:00', '13:00') || '|' || pg_temp.v('15'));
select pg_temp.registrar('H2. feriado em contrato sem fator (KA): pagamento comum (80,00)', 'ok|120.00|80.00|feriado',
  pg_temp.entrada('16', '13', '3', '06:00', '15:00') || '|' || split_part(pg_temp.v('16'), '|', 1) || '|' || split_part(pg_temp.v('16'), '|', 2) || '|' || split_part(pg_temp.v('16'), '|', 6));
select pg_temp.registrar('H3. feriado duplicado: 23505; operacional e admin AAL1 não registram (42501)', 'erro 23505|erro 42501|erro 42501',
  pg_temp.adm($q$select public.registrar_feriado(date '2026-03-05', 'Outro', 'x')::text$q$)
  || '|' || pg_temp.ope($q$select public.registrar_feriado(date '2026-04-21', 'Tiradentes', 'x')::text$q$)
  || '|' || pg_temp.adm1($q$select public.registrar_feriado(date '2026-04-21', 'Tiradentes', 'x')::text$q$));
select pg_temp.registrar('H4. aposentar o feriado: o apontamento mantém o tipo do dia congelado e, editado, segue pago como feriado (7 h = 262,50)', '1|1|feriado|105.00|262.50',
  pg_temp.adm(format($q$select count(*)::text from (select public.aposentar_feriado(%L, 'Teste')) x$q$, (select id from _fer)))
  || '|' || pg_temp.editar('15', $s$check_out = '14:00'$s$)
  || '|' || split_part(pg_temp.v('15'), '|', 6) || '|' || split_part(pg_temp.v('15'), '|', 1) || '|' || split_part(pg_temp.v('15'), '|', 2));
select pg_temp.registrar('H5. feriado não se apaga nem se edita (42501), nem pelo sistema', '42501|42501',
  pg_temp.erro_de(format($q$delete from public.financial_holidays where id = %L$q$, (select id from _fer)))
  || '|' || pg_temp.erro_de(format($q$update public.financial_holidays set name = 'x' where id = %L$q$, (select id from _fer))));

-- ---------------------------------------------------------------------------
-- A. Aceville: acumulado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. dia 1, 14 min a mais: SEM tolerância e sem arredondar: cobra 14 min = 120 + 5,25 = 125,25', 'ok|125.25|494|14',
  pg_temp.entrada('21', '11', '1', '06:00', '15:14') || '|' || split_part(pg_temp.v('21'), '|', 1) || '|' || split_part(pg_temp.v('21'), '|', 3) || '|' || split_part(pg_temp.v('21'), '|', 5));
select pg_temp.registrar('A2. dia 2, 26 min a mais: 120 + 9,75 = 129,75', 'ok|129.75|26',
  pg_temp.entrada('22', '12', '1', '06:00', '15:26') || '|' || split_part(pg_temp.v('22'), '|', 1) || '|' || split_part(pg_temp.v('22'), '|', 5));
select pg_temp.registrar('A3. E3, 50 min a mais num dia: bruto 50', 'ok|138.75|50',
  pg_temp.entrada('23', '11', '3', '06:00', '15:50') || '|' || split_part(pg_temp.v('23'), '|', 1) || '|' || split_part(pg_temp.v('23'), '|', 5));
select pg_temp.registrar('A4. prévia do fechamento: E1 40 -> 30 min, 15,00 -> 11,25, ajuste -3,75; E3 50 -> 60, 18,75 -> 22,50, ajuste +3,75',
  'E1|40|30|15.00|11.25|-3.75;E3|50|60|18.75|22.50|3.75',
  pg_temp.adm($q$select string_agg(colaborador || '|' || minutos_brutos || '|' || minutos_arredondados || '|' || valor_bruto || '|' || valor_arredondado || '|' || ajuste, ';' order by colaborador)
                 from public.ajustes_de_arredondamento_acumulado('5c30c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')$q$));
select pg_temp.registrar('A5. o cliente comum não tem ajuste acumulado (arredondou no dia)', '0',
  pg_temp.adm($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c30c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')$q$));

-- ---------------------------------------------------------------------------
-- F. Fatura: ajuste auditável, sem duplicidade
-- ---------------------------------------------------------------------------

create temporary table _fat (cliente text, id text);
insert into _fat select 'c2', pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')).id::text$q$);
-- c2: 125,25 + 129,75 + 138,75 + 120,00 (H2) = 513,75; ajustes -3,75 + 3,75 = 0
select pg_temp.registrar('F1. fatura Aceville: total = Σ apontamentos 513,75 + Σ ajustes 0,00; itens fecham com o total', '513.75|513.75|2',
  (select total_amount::text from public.invoices where id::text = (select id from _fat where cliente = 'c2'))
  || '|' || (select sum(amount)::text from public.invoice_items where invoice_id::text = (select id from _fat where cliente = 'c2'))
  || '|' || (select count(*)::text from public.invoice_items where invoice_id::text = (select id from _fat where cliente = 'c2') and description like 'Arredondamento acumulado%'));
select pg_temp.registrar('F2. o item de ajuste diz colaborador e minutos (40 min → 30 min) e vale -3,75', 'Arredondamento acumulado de horas extras — E1 (40 min → 30 min)|-3.75|-0.17',
  (select description || '|' || amount || '|' || quantity from public.invoice_items
    where invoice_id::text = (select id from _fat where cliente = 'c2') and description like '%E1%'));
select pg_temp.registrar('F3. horas extras da fatura pelos minutos cobrados ajustados: (14 + 26 + 50 + 0 - 10 + 10) / 60 = 1,50', '1.50',
  (select total_overtime::text from public.invoices where id::text = (select id from _fat where cliente = 'c2')));
select pg_temp.registrar('F4. sem duplicidade: a prévia de Aceville fica vazia e gerar de novo é P0002', '0|erro P0002',
  pg_temp.adm($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c30c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')).id::text$q$));
select pg_temp.registrar('F5. os apontamentos faturados continuam com os valores brutos (snapshots não mudam)', '125.25|129.75',
  split_part(pg_temp.v('21'), '|', 1) || '|' || split_part(pg_temp.v('22'), '|', 1));
insert into _fat select 'c1', pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$);
select pg_temp.registrar('F6. fatura do cliente comum: sem item de ajuste, total = Σ apontamentos, itens fecham', 'true|0|true',
  (select (i.total_amount = (select sum(billed_amount) from public.timesheet_entries where invoice_id = i.id))::text
          || '|' || (select count(*) from public.invoice_items where invoice_id = i.id and description like 'Arredondamento%')::text
          || '|' || ((select sum(amount) from public.invoice_items where invoice_id = i.id) = i.total_amount)::text
     from public.invoices i where i.id::text = (select id from _fat where cliente = 'c1')));
-- FIN-PR-03: itens lidos pelo TIPO; a descrição passou a nomear a tarifa.
select pg_temp.registrar('F7. conciliação do cliente comum: diárias proporcionais entram no item de diárias e as extras pelos minutos cobrados', 'true',
  (select ((select sum(amount) from public.invoice_items where invoice_id = i.id and kind = 'diarias')
           + coalesce((select sum(amount) from public.invoice_items where invoice_id = i.id and kind = 'horas_extras'), 0)
           = i.total_amount)::text
     from public.invoices i where i.id::text = (select id from _fat where cliente = 'c1')));

-- ---------------------------------------------------------------------------
-- C. Dynamis: saldo informativo
-- ---------------------------------------------------------------------------

select pg_temp.folha('31', 'a1', date '2026-03-16');
select pg_temp.folha('32', 'a1', date '2026-03-17');
select pg_temp.registrar('C1. -30 num dia (proporcional 112,50) e +30 no outro (131,25): valores do dia não mudam', 'ok|ok|112.50|131.25',
  pg_temp.entrada('31', '31', '4', '06:00', '14:30') || '|' || pg_temp.entrada('32', '32', '4', '06:00', '15:30')
  || '|' || split_part(pg_temp.v('31'), '|', 1) || '|' || split_part(pg_temp.v('32'), '|', 1));
select pg_temp.registrar('C2. saldo do período (informativo): excedentes 30, faltantes 30, saldo 0', 'E4 Dynamis|2|30|30|0',
  pg_temp.adm($q$select colaborador || '|' || apontamentos || '|' || minutos_excedentes || '|' || minutos_faltantes || '|' || saldo
                 from public.saldo_de_horas_do_periodo('5c30c000-0000-4000-8000-0000000000c1', '2026-03-16', '2026-03-31')$q$));

-- ---------------------------------------------------------------------------
-- X. Conciliação e fracionamento (B8.17): Aceville 16–31/03 e abril
-- ---------------------------------------------------------------------------

select pg_temp.registrar('X0. acumulados de 14,15,16,30,32,40,45,46,60 min -> 0,0,30,30,30,30,30,60,60', '0,0,30,30,30,30,30,60,60',
  (select string_agg(public.arredondar_minutos_extras(m)::text, ',' order by o) from unnest(array[14,15,16,30,32,40,45,46,60]) with ordinality u(m, o)));

select pg_temp.folha('41', 'a2', date '2026-03-16');
select pg_temp.folha('42', 'a2', date '2026-03-17');
select pg_temp.folha('43', 'a2', date '2026-03-18');
select pg_temp.folha('45', 'a2', date '2026-04-01');
select pg_temp.registrar('X1. entradas da quinzena brutas: E1 16 min (126,00) duas vezes, E3 46 min (137,25), E4 30 min (131,25)', 'ok|ok|ok|ok|126.00|126.00|137.25|131.25',
  pg_temp.entrada('51', '41', '1', '06:00', '15:16') || '|' || pg_temp.entrada('52', '42', '1', '06:00', '15:16')
  || '|' || pg_temp.entrada('53', '41', '3', '06:00', '15:46') || '|' || pg_temp.entrada('54', '42', '4', '06:00', '15:30')
  || '|' || split_part(pg_temp.v('51'), '|', 1) || '|' || split_part(pg_temp.v('52'), '|', 1)
  || '|' || split_part(pg_temp.v('53'), '|', 1) || '|' || split_part(pg_temp.v('54'), '|', 1));
select pg_temp.registrar('X2. prévia 16–31/03: E1 32 -> 30 (ajuste negativo -0,75), E3 46 -> 60 (positivo +5,25), E4 30 -> 30 (zero)',
  'E1|32|30|-0.75;E3|46|60|5.25;E4 Dynamis|30|30|0.00',
  pg_temp.adm($q$select string_agg(colaborador || '|' || minutos_brutos || '|' || minutos_arredondados || '|' || ajuste, ';' order by colaborador)
                 from public.ajustes_de_arredondamento_acumulado('5c30c000-0000-4000-8000-0000000000c2', '2026-03-16', '2026-03-31')$q$));
-- FIN-PR-05 (038): o período fracionado é recusado antes, por não ser uma competência (22023).
select pg_temp.registrar('X3. período fracionado (16–20/03) com hora extra acumulada: recusado (22023, competência), nada faturado', 'erro 22023|0',
  pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c2', '2026-03-16', '2026-03-20')).id::text$q$)
  || '|' || (select count(*)::text from public.timesheet_entries
              where invoice_id is not null and id in (pg_temp.id_e('51'), pg_temp.id_e('52'), pg_temp.id_e('53'), pg_temp.id_e('54'))));
insert into _fat select 'c2b', pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c2', '2026-03-16', '2026-03-31')).id::text$q$);
select pg_temp.registrar('X4. fatura do fechamento inteiro 16–31/03: total 525,00 (520,50 + ajustes 4,50); 2,00 h; item de ajuste só para E1 e E3',
  '525.00|2.00|2|4.50',
  (select total_amount::text || '|' || total_overtime::text from public.invoices where id::text = (select id from _fat where cliente = 'c2b'))
  || '|' || (select count(*)::text from public.invoice_items where invoice_id::text = (select id from _fat where cliente = 'c2b') and kind = 'arredondamento')
  || '|' || (select coalesce(sum(amount), 0)::text from public.invoice_items where invoice_id::text = (select id from _fat where cliente = 'c2b') and kind = 'arredondamento'));
select pg_temp.registrar('X5. itens fecham com o total e todos têm tipo', 'true|0',
  ((select sum(amount) from public.invoice_items where invoice_id::text = (select id from _fat where cliente = 'c2b'))
     = (select total_amount from public.invoices where id::text = (select id from _fat where cliente = 'c2b')))::text
  || '|' || (select count(*)::text from public.invoice_items where invoice_id::text = (select id from _fat where cliente = 'c2b') and kind is null));
select pg_temp.registrar('X6. fatura duplicada do mesmo período recusada (P0002); apontamento faturado imutável (42501)', 'erro P0002|erro 42501',
  pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c2', '2026-03-16', '2026-03-31')).id::text$q$)
  || '|' || pg_temp.editar('51', $s$check_out = '15:00'$s$));
select pg_temp.registrar('X7. março do cliente, tudo faturado: apontamentos 1.034,25 + adicionais 0 + ajuste faturado 4,50 = 1.038,75; previsto 0; a faturar 0; faturado 1.038,75 (= receita)',
  '1034.25|0.00|4.50|0.00|1038.75|0.00|1038.75|true',
  pg_temp.adm($q$select receita_apontamentos || '|' || adicionais || '|' || ajuste_faturado || '|' || ajuste_previsto || '|' || receita_total || '|' || a_faturar || '|' || faturado || '|' || ajuste_aplicavel
                   from public.resumo_financeiro_periodo('2026-03-01', '2026-03-31', '5c30c000-0000-4000-8000-0000000000c2')$q$));
select pg_temp.registrar('X8. hora extra tardia (E1, 16 min em 18/03) em período já faturado para E1: recusada (55000), sem fatura', 'ok|erro 55000|0',
  pg_temp.entrada('55', '43', '1', '06:00', '15:16')
  || '|' || pg_temp.adm($q$select (public.gerar_fatura('5c30c000-0000-4000-8000-0000000000c2', '2026-03-16', '2026-03-31')).id::text$q$)
  || '|' || (select count(*)::text from public.timesheet_entries where id = pg_temp.id_e('55') and invoice_id is not null));
select pg_temp.registrar('X9. abril sem fatura (E1 16 min): apontamentos 126,00 + previsto +5,25 = 131,25; a faturar 131,25; faturado 0',
  'ok|126.00|0.00|0.00|5.25|131.25|131.25|0.00|true',
  pg_temp.entrada('56', '45', '1', '06:00', '15:16')
  || '|' || pg_temp.adm($q$select receita_apontamentos || '|' || adicionais || '|' || ajuste_faturado || '|' || ajuste_previsto || '|' || receita_total || '|' || a_faturar || '|' || faturado || '|' || ajuste_aplicavel
                   from public.resumo_financeiro_periodo('2026-04-01', '2026-04-30', '5c30c000-0000-4000-8000-0000000000c2')$q$));
select pg_temp.registrar('X10. com filtro de operação o ajuste não se aplica (por colaborador, não por operação): ajustes 0 e aviso', '126.00|0.00|0.00|126.00|false',
  pg_temp.adm($q$select receita_apontamentos || '|' || ajuste_faturado || '|' || ajuste_previsto || '|' || receita_total || '|' || ajuste_aplicavel
                   from public.resumo_financeiro_periodo('2026-04-01', '2026-04-30', '5c30c000-0000-4000-8000-0000000000c2', '5c30e000-0000-4000-8000-0000000000a2')$q$));
select pg_temp.registrar('X11. sem filtro de cliente, a receita total é a soma dos clientes (Dashboard = Relatórios = Σ clientes)', 'true',
  ((select pg_temp.adm($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-04-30')$q$)::numeric)
   = (select pg_temp.adm($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-04-30', '5c30c000-0000-4000-8000-0000000000c1')$q$)::numeric
    + pg_temp.adm($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-04-30', '5c30c000-0000-4000-8000-0000000000c2')$q$)::numeric))::text);
select pg_temp.registrar('X12. a fatura é a fonte do faturado: Σ faturas do cliente em março-abril = faturado do resumo', 'true',
  ((select coalesce(sum(total_amount), 0) from public.invoices where client_id = '5c30c000-0000-4000-8000-0000000000c2')
    = pg_temp.adm($q$select faturado::text from public.resumo_financeiro_periodo('2026-03-01', '2026-04-30', '5c30c000-0000-4000-8000-0000000000c2')$q$)::numeric)::text);
select pg_temp.registrar('X13. segurança: operacional e admin AAL1 não leem o resumo (42501); a validação é interna (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.ope($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-31')$q$)
  || '|' || pg_temp.adm1($q$select receita_total::text from public.resumo_financeiro_periodo('2026-03-01', '2026-03-31')$q$)
  || '|' || pg_temp.adm($q$select public.validar_fechamento_acumulado('5c30c000-0000-4000-8000-0000000000c2', date '2026-03-16', date '2026-03-31', '{}'::uuid[])::text$q$));
select pg_temp.registrar('X14. custo preservado: o custo dos apontamentos não tem ajuste de arredondamento (E1 16 min a 25/h: 80 + 16/60 × 25)', '86.67',
  split_part(pg_temp.v('51'), '|', 2));

-- ---------------------------------------------------------------------------
-- V. Parâmetros da vigência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('V4. validação: modo inválido, sábado acima da jornada, fator < 1, três casas (22023)', 'erro 22023|erro 22023|erro 22023|erro 22023',
  pg_temp.adm($q$select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d1', date '2027-01-01', 120, 8, 1.5, 10, 'x', null, false, 'mensal')::text$q$)
  || '|' || pg_temp.adm($q$select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d1', date '2027-01-01', 120, 8, 1.5, 10, 'x', null, false, 'diario', 9)::text$q$)
  || '|' || pg_temp.adm($q$select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d1', date '2027-01-01', 120, 8, 1.5, 10, 'x', null, false, 'diario', null, 0.5)::text$q$)
  || '|' || pg_temp.adm($q$select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d1', date '2027-01-01', 120, 8, 1.5, 10, 'x', null, false, 'diario', 4.125)::text$q$));
select pg_temp.registrar('V5. a versão é imutável: nem o sistema muda o modo (42501)', '42501',
  pg_temp.erro_de($q$update public.contract_terms set ot_rounding_mode = 'acumulado' where contract_id = '5c30d000-0000-4000-8000-0000000000d1'$q$));
create temporary table _k (id text);
insert into _k select pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K antigo', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'Chamada antiga')::text$q$);
select pg_temp.registrar('V6. chamada antiga (sem os parâmetros novos) continua aceita e nasce neutra (diario|-|-)', 'diario|-|-',
  (select ot_rounding_mode || '|' || coalesce(saturday_shift_hours::text, '-') || '|' || coalesce(holiday_pay_factor::text, '-')
     from public.contract_terms where contract_id::text = (select id from _k)));

-- Cadastro inicial do contrato pela RPC atômica (B8.21): a tela envia os três parâmetros da 030.
create temporary table _kn (id text);
insert into _kn select pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K novo 030', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'Cadastro inicial do contrato', 'acumulado', 4, 2)::text$q$);
select pg_temp.registrar('V7. cadastro inicial com os parâmetros da 030 persiste na vigência inicial (acumulado|4.00|2.00), uma versão só', 'acumulado|4.00|2.00|1',
  (select ot_rounding_mode || '|' || coalesce(saturday_shift_hours::text, '-') || '|' || coalesce(holiday_pay_factor::text, '-') || '|'
          || (select count(*)::text from public.contract_terms where contract_id::text = (select id from _kn))
     from public.contract_terms where contract_id::text = (select id from _kn)));
insert into _kn select pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K padrão 030', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'Cadastro inicial do contrato', 'diario')::text$q$);
select pg_temp.registrar('V8. cadastro inicial só com o modo (sem sábado nem feriado): diario|-|-', 'diario|-|-',
  (select ot_rounding_mode || '|' || coalesce(saturday_shift_hours::text, '-') || '|' || coalesce(holiday_pay_factor::text, '-')
     from public.contract_terms where contract_id = (select c.id from public.contracts c where c.name = 'K padrão 030')));
select pg_temp.registrar('V9. cadastro inicial inválido é recusado e NADA persiste (sábado acima da jornada 22023; modo inválido 22023; fator < 1 22023)', 'erro 22023|erro 22023|erro 22023|0',
  pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K inválido', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x', 'diario', 9)::text$q$)
  || '|' || pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K inválido', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x', 'mensal')::text$q$)
  || '|' || pg_temp.adm($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K inválido', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x', 'diario', null, 0.5)::text$q$)
  || '|' || (select count(*)::text from public.contracts where name = 'K inválido'));
select pg_temp.registrar('V10. operacional e admin AAL1 não cadastram contrato (42501); o contrato não ganha colunas da 030', 'erro 42501|erro 42501|0',
  pg_temp.ope($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K proibido', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x', 'acumulado', 4, 2)::text$q$)
  || '|' || pg_temp.adm1($q$select public.criar_contrato_com_vigencia('5c30c000-0000-4000-8000-0000000000c1', 'K proibido', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'x', 'acumulado', 4, 2)::text$q$)
  || '|' || (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'contracts'
              and column_name in ('ot_rounding_mode', 'saturday_shift_hours', 'holiday_pay_factor')));

-- ---------------------------------------------------------------------------
-- P. Preservação do histórico
-- ---------------------------------------------------------------------------

-- FIN-PR-02: o segundo valor é o do caso D6 (153,75 pela V2; era 142,50 na 030).
select pg_temp.registrar('P1. vigência nova de K1 (acumulado, sem sábado) a partir de 01/04 não muda o já precificado', '1|131.25|153.75',
  pg_temp.adm($q$select count(*)::text from (select public.registrar_condicao_contrato('5c30d000-0000-4000-8000-0000000000d1', date '2026-04-01', 130, 8, 1.5, 10, 'Reajuste', null, true, 'acumulado')) x$q$)
  || '|' || split_part(pg_temp.v('02'), '|', 1) || '|' || split_part(pg_temp.v('07'), '|', 1));
select pg_temp.registrar('P2. o apontamento legado do motor desligado continua como gravado', '120.00|80.00|-|-',
  split_part(pg_temp.v('00'), '|', 1) || '|' || split_part(pg_temp.v('00'), '|', 2) || '|' || split_part(pg_temp.v('00'), '|', 5) || '|' || split_part(pg_temp.v('00'), '|', 6));
select pg_temp.registrar('P3. apontamento faturado é imutável (42501)', 'erro 42501',
  pg_temp.editar('21', $s$check_out = '15:00'$s$));

-- ---------------------------------------------------------------------------
-- K. Segurança e inventário
-- ---------------------------------------------------------------------------

select pg_temp.registrar('K1. operacional e admin AAL1 não chamam as funções do fechamento (42501)', 'erro 42501|erro 42501|erro 42501',
  pg_temp.ope($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c30c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')$q$)
  || '|' || pg_temp.ope($q$select count(*)::text from public.saldo_de_horas_do_periodo('5c30c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-31')$q$)
  || '|' || pg_temp.adm1($q$select count(*)::text from public.ajustes_de_arredondamento_acumulado('5c30c000-0000-4000-8000-0000000000c2', '2026-03-01', '2026-03-15')$q$));
select pg_temp.registrar('K2. admin não grava minutos cobrados nem tipo do dia (42501)', 'erro 42501|erro 42501',
  pg_temp.editar('31', 'billed_overtime_minutes = 999') || '|' || pg_temp.editar('31', $s$day_kind_snapshot = 'feriado'$s$));
select pg_temp.registrar('K3. feriados: RLS, só SELECT para authenticated, nada para o operacional; operacional lê 0', 'true|true|false|false|0',
  (select relrowsecurity::text from pg_class where oid = 'public.financial_holidays'::regclass)
  || '|' || has_table_privilege('authenticated', 'public.financial_holidays', 'SELECT')::text
  || '|' || has_table_privilege('authenticated', 'public.financial_holidays', 'INSERT')::text
  || '|' || has_table_privilege('bslog_rpc_operacional', 'public.financial_holidays', 'SELECT')::text
  || '|' || pg_temp.ope('select count(*)::text from public.financial_holidays'));
select pg_temp.registrar('K4. execução: anon não executa nada novo; internas sem EXECUTE de API', 'false|false|false|false',
  has_function_privilege('anon', 'public.ajustes_de_arredondamento_acumulado(uuid, date, date, uuid[])', 'EXECUTE')::text
  || '|' || has_function_privilege('anon', 'public.registrar_feriado(date, text, text)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.motor_tipo_do_dia(date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.condicoes_validar_parametros_de_horas(text, numeric, numeric, numeric)', 'EXECUTE')::text);
select pg_temp.registrar('K5. trilha: feriado registrado e aposentado; condições com os parâmetros novos no registro', '1|1|true',
  (select count(*)::text from public.financial_terms_audit where action = 'feriado_registrado')
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'feriado_aposentado')
  || '|' || exists (select 1 from public.financial_terms_audit where action = 'contrato_condicao_registrada' and new ? 'ot_rounding_mode')::text);
select pg_temp.registrar('K6. estado do motor anuncia regras_definitivas; o motor antigo (010) não foi tocado; gerar_fatura não cita o motor novo', 'true|0|0',
  (select (x ->> 'regras_definitivas') from (select pg_temp.adm('select public.estado_motor_vigencia()::text')::jsonb x) q)
  || '|' || (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'derivar_valores_financeiros' and prosrc ilike '%arredondar%')
  || '|' || (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'gerar_fatura'
              and (prosrc ilike '%vigencia%' or prosrc ilike '%financial_engine_settings%' or prosrc ilike '%_terms%')));

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
    raise exception '028_regras_definitivas_bs: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
