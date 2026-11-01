-- Migration 029 — regras financeiras confirmadas pela BS (C05-B8.10).
--
-- COMO RODAR: `scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Tudo acontece numa
-- transação que termina em `rollback`. NUNCA rodar contra Production nem homologação: o arquivo
-- escreve em `auth.users`, nas tabelas de negócio e na trilha, e liga o motor dentro da transação.
--
-- O QUE ESTE ARQUIVO PROVA (valores esperados calculados à mão, não pelo motor)
--
--   Z  motor DESLIGADO: entrada = saída recusada; custo legado intacto (sem proporcional)
--   A  diária normal, falta, substituição (apontamento próprio, sem duplicar nem vincular)
--   B  saída antecipada: custo proporcional; cobrança proporcional desde a 030 (confirmada pela BS
--      na C05-B8.15; antes era diária inteira); presença sem horário: diária cheia
--   C  hora extra cobrada (fator do contrato) e paga (valor-hora acordado, independente)
--   D  colaboradores com custos diferentes na mesma operação
--   E  mudança de vigência: valor-hora congelado no apontamento
--   F  operação sem contrato (valor acordado)
--   G  adicionais: registro, validação, cancelamento, trilha, acesso indevido
--   H  fatura: adicionais separados da diária, conciliação receita/custo/margem, congelamento
--   I  entrada = saída com o motor ligado (admin, upsert, RPC do operador) e virada de meia-noite
--   J  acesso indevido via API aos campos e RPCs novas
--   K  inventário: estado do motor, grants, motor antigo intacto

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

-- admin AAL2, operacional, admin AAL1
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.como('5c290000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.como('5c290000-0000-4000-8000-0000000000a2', 'aal1', _sql)
$$;
create or replace function pg_temp.adm1(_sql text) returns text language sql as $$
  select pg_temp.como('5c290000-0000-4000-8000-0000000000a1', 'aal1', _sql)
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
  ('5c290000-0000-4000-8000-0000000000a1'),
  ('5c290000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec290000-0000-4000-8000-0000000000a1', '5c290000-0000-4000-8000-0000000000a1', null),
  ('ec290000-0000-4000-8000-0000000000a2', '5c290000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c290000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c290000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01D.R1: o admin desta fixture TEM fator verificado. "Admin em AAL1" segue significando TOTP
-- pendente (barrado no banco). Conta SEM fator em AAL1 trabalha normalmente: ver 034_mfa_somente_login.sql.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01D', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin'
     and not exists (select 1 from auth.mfa_factors f where f.user_id = ur.user_id);


insert into public.clients (id, name) values
  ('5c29c000-0000-4000-8000-0000000000c1', 'B810 cliente'),
  ('5c29c000-0000-4000-8000-0000000000c2', 'B810 outro cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c29d000-0000-4000-8000-0000000000d1', '5c29c000-0000-4000-8000-0000000000c1', 'K1', 120, 8, 1.5, 10);
-- E4 já está com o custo da vigência de HOJE (110): o motor recusa ligar com divergência.
insert into public.employees (id, name, role, daily_cost) values
  ('5c29f000-0000-4000-8000-000000000001', 'E1 conferente', 'Conferente', 80),
  ('5c29f000-0000-4000-8000-000000000002', 'E2 conferente', 'Conferente', 60),
  ('5c29f000-0000-4000-8000-000000000003', 'E3 substituto', 'Conferente', 80),
  ('5c29f000-0000-4000-8000-000000000004', 'E4 operador', 'Operador', 110),
  ('5c29f000-0000-4000-8000-000000000007', 'E7 operador', 'Operador', 90);
-- k OPK (K1), l OPL (K1, legado do motor desligado), n OPN (sem contrato), x OPX (outro cliente)
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c29e000-0000-4000-8000-0000000000a1', '5c29c000-0000-4000-8000-0000000000c1', '5c29d000-0000-4000-8000-0000000000d1', 'OPK', null),
  ('5c29e000-0000-4000-8000-0000000000a2', '5c29c000-0000-4000-8000-0000000000c1', '5c29d000-0000-4000-8000-0000000000d1', 'OPL', null),
  ('5c29e000-0000-4000-8000-0000000000a3', '5c29c000-0000-4000-8000-0000000000c1', null, 'OPN avulsa', 250),
  ('5c29e000-0000-4000-8000-0000000000a4', '5c29c000-0000-4000-8000-0000000000c2', null, 'OPX outro cliente', 300);
-- turnos 06:00-15:00 com 60 min de intervalo: 480 min previstos
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes) values
  ('5c29a000-0000-4000-8000-0000000000a1', '5c29e000-0000-4000-8000-0000000000a1', 'SK', '06:00', '15:00', 60),
  ('5c29a000-0000-4000-8000-0000000000a2', '5c29e000-0000-4000-8000-0000000000a2', 'SL', '06:00', '15:00', 60),
  ('5c29a000-0000-4000-8000-0000000000a3', '5c29e000-0000-4000-8000-0000000000a3', 'SN', '06:00', '15:00', 60),
  ('5c29a000-0000-4000-8000-0000000000a4', '5c29e000-0000-4000-8000-0000000000a4', 'SX', '06:00', '15:00', 60);

create or replace function pg_temp.folha(_cod text, _op text, _data date) returns void language sql as $$
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c29b000-0000-4000-8000-0000000000' || _cod)::uuid, ('5c29e000-0000-4000-8000-0000000000' || _op)::uuid,
          ('5c29a000-0000-4000-8000-0000000000' || _op)::uuid, _data)
$$;

-- Insere como o sistema (postgres): o cálculo é o mesmo; devolve 'ok' ou o SQLSTATE.
create or replace function pg_temp.entrada(_cod text, _folha text, _colab text, _status text default 'present', _in text default '06:00', _out text default '15:00', _pausa int default 60)
returns text language plpgsql as $$
begin
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values (('5c29b100-0000-4000-8000-0000000000' || _cod)::uuid, ('5c29b000-0000-4000-8000-0000000000' || _folha)::uuid,
          ('5c29f000-0000-4000-8000-00000000000' || _colab)::uuid, _status::public.attendance_status,
          nullif(_in, '')::time, nullif(_out, '')::time, _pausa);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.id_entrada(_cod text) returns uuid language sql as $$
  select ('5c29b100-0000-4000-8000-0000000000' || _cod)::uuid
$$;

-- billed|cost|worked|overtime|ot_hourly_cost_snapshot
create or replace function pg_temp.valores(_cod text) returns text language sql as $$
  select coalesce((select billed_amount::text || '|' || cost_amount::text || '|' || worked_minutes::text || '|' || overtime_minutes::text
                          || '|' || coalesce(ot_hourly_cost_snapshot::text, '-')
                     from public.timesheet_entries where id = pg_temp.id_entrada(_cod)), 'ausente')
$$;

create or replace function pg_temp.editar(_cod text, _set text) returns text language sql as $$
  select pg_temp.adm(format($q$with u as (update public.timesheet_entries set %s where id = %L returning 1) select count(*)::text from u$q$,
    _set, pg_temp.id_entrada(_cod)))
$$;

create or replace function pg_temp.adicional(_cliente text, _ini text, _fim text, _motivo text, _valor text, _ref text default null, _op text default null)
returns text language sql as $$
  select pg_temp.adm(format('select public.registrar_adicional(%L, %L, %L, %L, %s, %L, %L)::text',
    '5c29c000-0000-4000-8000-0000000000' || _cliente, _ini, _fim, _motivo, _valor, _ref,
    case when _op is null then null else '5c29e000-0000-4000-8000-0000000000' || _op end))
$$;

-- ---------------------------------------------------------------------------
-- Z. Motor DESLIGADO
-- ---------------------------------------------------------------------------

select pg_temp.folha('01', 'a2', date '2026-02-02');

select pg_temp.registrar('Z1. motor desligado: entrada = saída recusada pelo banco (23514), também para o sistema',
  '23514|ausente', pg_temp.entrada('01', '01', '1', _in => '08:00', _out => '08:00') || '|' || pg_temp.valores('01'));
select pg_temp.registrar('Z2. motor desligado, admin pela API: entrada = saída recusada (23514)', 'erro 23514',
  pg_temp.adm($q$with x as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c29b000-0000-4000-8000-000000000001', '5c29f000-0000-4000-8000-000000000002', 'present', '08:00', '08:00:30', 0) returning 1) select count(*)::text from x$q$));
select pg_temp.registrar('Z3. motor desligado, saída antecipada (06:00-11:00): motor antigo intacto, custo da diária inteira 120,00 / 80,00',
  'ok|120.00|80.00|240|0|-', pg_temp.entrada('02', '01', '1', _out => '11:00') || '|' || pg_temp.valores('02'));
select pg_temp.registrar('Z4. virada de meia-noite (22:00-06:00, 60 min) segue aceita: 420 min', 'ok|420',
  pg_temp.entrada('03', '01', '3', _in => '22:00', _out => '06:00') || '|' || split_part(pg_temp.valores('03'), '|', 3));

-- Linha antiga com a igualdade (anterior à 029): só é possível desligando o bloqueio, aqui.
alter table public.timesheet_entries disable trigger trg_timesheet_entries_bloqueia_horario_igual;
select pg_temp.entrada('04', '01', '4', _in => '07:00', _out => '07:00');
alter table public.timesheet_entries enable trigger trg_timesheet_entries_bloqueia_horario_igual;
select pg_temp.registrar('Z5. linha antiga com a igualdade: nota editável; regravar o horário igual, não', '1|erro 23514',
  pg_temp.editar('04', $s$notes = 'conferido'$s$) || '|' || pg_temp.editar('04', $s$check_in = '07:00', check_out = '07:00', status = 'replacement'$s$));
select pg_temp.registrar('Z6. e corrigir o horário dessa linha é aceito', '1',
  pg_temp.editar('04', $s$check_out = '16:00'$s$));

-- ---------------------------------------------------------------------------
-- Vigências (pelas RPCs, como a tela) e ligar o motor
-- ---------------------------------------------------------------------------

select pg_temp.registrar('V1. vigências registradas pelas RPCs (contrato, 5 custos, 2 valores acordados, reajuste de E4)', 'ok',
  case when pg_temp.adm($q$select count(*)::text from (select public.registrar_condicao_contrato('5c29d000-0000-4000-8000-0000000000d1', date '2026-01-01', 120, 8, 1.5, 10, 'Contrato K1')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000001', date '2026-01-01', 80, 'Custo E1', null, false, 25)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000002', date '2026-01-01', 60, 'Custo E2 sem valor-hora')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000003', date '2026-01-01', 80, 'Custo E3', null, false, 25)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000004', date '2026-01-01', 100, 'Custo E4', null, false, 30)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000004', date '2026-06-01', 110, 'Reajuste E4', null, true, 35)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000007', date '2026-01-01', 90, 'Custo E7', null, false, 20)) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_valor_acordado_operacao('5c29e000-0000-4000-8000-0000000000a3', date '2026-01-01', 250, 'Avulsa')) x$q$) = '1'
        and pg_temp.adm($q$select count(*)::text from (select public.registrar_valor_acordado_operacao('5c29e000-0000-4000-8000-0000000000a4', date '2026-01-01', 300, 'Avulsa outro cliente')) x$q$) = '1'
       then 'ok' else 'falhou' end);
select pg_temp.registrar('V2. valor-hora gravado nas versões (E1 25, E2 sem, E4 30 até 01/06 e 35 depois)', '25.00|-|30.00/2026-06-01|35.00',
  (select coalesce(ot_hourly_cost::text, '-') from public.employee_cost_terms where employee_id = '5c29f000-0000-4000-8000-000000000001')
  || '|' || (select coalesce(ot_hourly_cost::text, '-') from public.employee_cost_terms where employee_id = '5c29f000-0000-4000-8000-000000000002')
  || '|' || (select ot_hourly_cost::text || '/' || valid_to::text from public.employee_cost_terms where employee_id = '5c29f000-0000-4000-8000-000000000004' and valid_from = date '2026-01-01')
  || '|' || (select ot_hourly_cost::text from public.employee_cost_terms where employee_id = '5c29f000-0000-4000-8000-000000000004' and valid_from = date '2026-06-01'));
select pg_temp.registrar('V3. motor ligado sem pendências', 'true',
  (pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste B8.10') ->> 'ativo')$q$)));

select pg_temp.folha('11', 'a1', date '2026-03-02');
select pg_temp.folha('12', 'a1', date '2026-03-03');
select pg_temp.folha('13', 'a1', date '2026-07-01');
select pg_temp.folha('14', 'a3', date '2026-03-02');
select pg_temp.folha('15', 'a4', date '2026-03-20');

-- ---------------------------------------------------------------------------
-- A. Diária normal, falta, substituição
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. diária normal (E1, 06:00-15:00): 120,00 / 80,00, sem hora extra; valor-hora congelado 25',
  'ok|120.00|80.00|480|0|25.00', pg_temp.entrada('11', '11', '1') || '|' || pg_temp.valores('11'));
select pg_temp.registrar('A2. falta (E2): nenhuma diária, 0 / 0, sem snapshot', 'ok|0.00|0.00|0|0|-',
  pg_temp.entrada('12', '11', '2', _status => 'absent', _in => '', _out => '') || '|' || pg_temp.valores('12'));
select pg_temp.registrar('A3. substituto (E3, reposição) com apontamento próprio: 120,00 / 80,00', 'ok|120.00|80.00|480|0|25.00',
  pg_temp.entrada('13', '11', '3', _status => 'replacement') || '|' || pg_temp.valores('13'));
select pg_temp.registrar('A4. a falta de E2 continua 0/0 e a folha tem 2 diárias, sem duplicar nem vincular', '0.00|0.00|2|240.00',
  split_part(pg_temp.valores('12'), '|', 1) || '|' || split_part(pg_temp.valores('12'), '|', 2)
  || '|' || (select count(*)::text from public.timesheet_entries where timesheet_id = '5c29b000-0000-4000-8000-000000000011' and status <> 'absent')
  || '|' || (select sum(billed_amount)::text from public.timesheet_entries where timesheet_id = '5c29b000-0000-4000-8000-000000000011'));

-- ---------------------------------------------------------------------------
-- B. Saída antecipada
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. saída antecipada (E1, 06:00-11:00 = 240 de 480): cobra 120 × 240/480 = 60,00 (030), paga 80 × 240/480 = 40,00',
  'ok|60.00|40.00|240|0|25.00', pg_temp.entrada('21', '12', '1', _out => '11:00') || '|' || pg_temp.valores('21'));
select pg_temp.registrar('B2. 5 minutos a menos (06:00-14:55 = 475): sem tolerância nem arredondamento: cobra 118,75 (030), paga 79,17',
  'ok|118.75|79.17|475|0|25.00', pg_temp.entrada('22', '13', '1', _out => '14:55') || '|' || pg_temp.valores('22'));
select pg_temp.registrar('B3. presença SEM saída (E2): regra pendente, sem proporcional (diária de custo inteira, 60) e sem hora extra',
  'ok|120.00|60.00|0|0|-', pg_temp.entrada('23', '13', '2', _out => '') || '|' || pg_temp.valores('23'));
select pg_temp.registrar('B4. editar a saída antecipada para o turno completo volta ao custo da diária: 80,00', '1|120.00|80.00',
  pg_temp.editar('21', $s$check_out = '15:00'$s$) || '|' || split_part(pg_temp.valores('21'), '|', 1) || '|' || split_part(pg_temp.valores('21'), '|', 2));
select pg_temp.registrar('B5. e de volta à saída antecipada: 40,00', '1|40.00',
  pg_temp.editar('21', $s$check_out = '11:00'$s$) || '|' || split_part(pg_temp.valores('21'), '|', 2));

-- ---------------------------------------------------------------------------
-- C/D. Hora extra cobrada e paga; custos diferentes na mesma operação
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. E2 sem valor-hora (06:00-17:00, 2 h extra): cobra 120 + 2 × 22,50 = 165,00; paga 60 + 2 × 7,50 = 75,00',
  'ok|165.00|75.00|600|120|-', pg_temp.entrada('24', '12', '2', _out => '17:00') || '|' || pg_temp.valores('24'));
select pg_temp.registrar('C2. E3 com valor-hora 25 (mesmo horário): cobra 165,00 (independente); paga 80 + 2 × 25 = 130,00',
  'ok|165.00|130.00|600|120|25.00', pg_temp.entrada('25', '12', '3', _out => '17:00') || '|' || pg_temp.valores('25'));
select pg_temp.registrar('C3. tolerância de 10 min: 06:00-15:08 não gera hora extra paga nem cobrada', 'ok|120.00|80.00|488|0|25.00',
  pg_temp.entrada('26', '13', '3', _out => '15:08') || '|' || pg_temp.valores('26'));
select pg_temp.registrar('D1. mesma operação e função, custos diferentes: a cobrança é a mesma (165), o custo não (75 x 130)', '165.00=165.00|75.00<>130.00',
  split_part(pg_temp.valores('24'), '|', 1) || '=' || split_part(pg_temp.valores('25'), '|', 1)
  || '|' || split_part(pg_temp.valores('24'), '|', 2) || '<>' || split_part(pg_temp.valores('25'), '|', 2));
select pg_temp.registrar('C4. o fator 1,5 não entra no custo: ot_hour_rate_snapshot da cobrança 22,50; custo da hora = valor acordado', '22.5|25.00',
  (select trim(trailing '0' from ot_hour_rate_snapshot::text) || '|' || ot_hourly_cost_snapshot::text from public.timesheet_entries where id = pg_temp.id_entrada('25')));

-- ---------------------------------------------------------------------------
-- E. Mudança de vigência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('E1. E4 em 03/03 (versão 100 / 30 por hora), 06:00-17:00: 165,00 / 160,00', 'ok|165.00|160.00|600|120|30.00',
  pg_temp.entrada('27', '12', '4', _out => '17:00') || '|' || pg_temp.valores('27'));
select pg_temp.registrar('E2. E4 em 01/07 (reajuste 110 / 35): 165,00 / 180,00', 'ok|165.00|180.00|600|120|35.00',
  pg_temp.entrada('28', '13', '4', _out => '17:00') || '|' || pg_temp.valores('28'));
select pg_temp.registrar('E3. editar o apontamento de 03/03 (3 h extra) usa o preço CONGELADO: 120 + 3 × 22,50 = 187,50; 100 + 3 × 30 = 190,00', '1|187.50|190.00|660|180|30.00',
  pg_temp.editar('27', $s$check_out = '18:00'$s$) || '|' || pg_temp.valores('27'));
select pg_temp.registrar('E4. corrigir a versão de E4 em uso fora da cobertura é recusado (55000); o apontamento não muda', 'erro 55000|187.50|190.00',
  pg_temp.adm($q$select public.corrigir_custo_colaborador((select id from public.employee_cost_terms where employee_id = '5c29f000-0000-4000-8000-000000000004' and valid_from = date '2026-01-01'),
     date '2026-04-01', date '2026-06-01', 100, 'Correção que descobriria março', 40)::text$q$)
  || '|' || split_part(pg_temp.valores('27'), '|', 1) || '|' || split_part(pg_temp.valores('27'), '|', 2));
select pg_temp.registrar('E5. trocar o colaborador do apontamento (E4 -> E7) pega o custo e o valor-hora da versão de E7: 90 + 3 × 20 = 150,00; cobrança preservada', '1|187.50|150.00|660|180|20.00',
  pg_temp.editar('27', $s$employee_id = '5c29f000-0000-4000-8000-000000000007'$s$) || '|' || pg_temp.valores('27'));

-- ---------------------------------------------------------------------------
-- F. Operação sem contrato (valor acordado)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. avulsa, saída antecipada (E1, 06:00-11:00): cobra metade do valor acordado, 125,00 (030); paga 40,00', 'ok|125.00|40.00|240|0|25.00',
  pg_temp.entrada('31', '14', '1', _out => '11:00') || '|' || pg_temp.valores('31'));
select pg_temp.registrar('F2. avulsa, hora extra (E2): 250 + 2 × 31,25 = 312,50 (fator 1, ainda fixo: pendente); paga 75,00', 'ok|312.50|75.00|600|120|-',
  pg_temp.entrada('32', '14', '2', _out => '17:00') || '|' || pg_temp.valores('32'));

-- ---------------------------------------------------------------------------
-- G. Adicionais
-- ---------------------------------------------------------------------------

create temporary table _adic (k text primary key, id text);
insert into _adic values ('A1', pg_temp.adicional('c1', '2026-03-01', '2026-03-15', 'Etiquetagem de 2.000 volumes', '350', 'OS 123', 'a1'));
-- FIN-PR-05 (038): execução que atravessa quinzenas exige a competência de cobrança (sem ela, a RPC
-- recusa). A2 é cobrado na 2ª quinzena: continua fora da fatura da 1ª, que é o que H5 mede.
insert into _adic values ('A2', pg_temp.adm($q$select public.registrar_adicional('5c29c000-0000-4000-8000-0000000000c1', '2026-03-10', '2026-03-20', 'Separação de pedidos', 100, null, null, '2026-03-16', '2026-03-31')::text$q$));
insert into _adic values ('A3', pg_temp.adicional('c1', '2026-03-05', '2026-03-05', 'Contêiner 40 pés', '500', 'CNT-9'));
insert into _adic values ('A4', pg_temp.adicional('c2', '2026-03-16', '2026-03-31', 'Carreta completa (serviço fechado)', '400', null, 'a4'));

select pg_temp.registrar('G1. quatro adicionais registrados pela RPC, sem criar diária', '4|0',
  (select count(*)::text from _adic where id ~ '^[0-9a-f-]{36}$')
  || '|' || (select count(*)::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id where t.work_date = date '2026-03-05'));
select pg_temp.registrar('G2. validações: operação de outro cliente, valor zero, três casas, motivo vazio, período invertido (todos 22023); cliente inexistente P0002',
  'erro 22023|erro 22023|erro 22023|erro 22023|erro 22023|erro P0002',
  pg_temp.adicional('c1', '2026-03-01', '2026-03-15', 'x', '10', null, 'a4')
  || '|' || pg_temp.adicional('c1', '2026-03-01', '2026-03-15', 'x', '0')
  || '|' || pg_temp.adicional('c1', '2026-03-01', '2026-03-15', 'x', '10.005')
  || '|' || pg_temp.adicional('c1', '2026-03-01', '2026-03-15', '   ', '10')
  || '|' || pg_temp.adicional('c1', '2026-03-15', '2026-03-01', 'x', '10')
  || '|' || pg_temp.adicional('ff', '2026-03-01', '2026-03-15', 'x', '10'));
select pg_temp.registrar('G3. operacional e admin em AAL1 não registram adicional (42501)', 'erro 42501|erro 42501',
  pg_temp.ope($q$select public.registrar_adicional('5c29c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15', 'x', 10)::text$q$)
  || '|' || pg_temp.adm1($q$select public.registrar_adicional('5c29c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15', 'x', 10)::text$q$));
select pg_temp.registrar('G4. API direta: admin não insere, não altera e não apaga adicional (42501); operacional lê 0 linhas', 'erro 42501|erro 42501|erro 42501|0',
  pg_temp.adm($q$with x as (insert into public.billing_additionals (client_id, period_start, period_end, description, amount) values ('5c29c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15', 'x', 10) returning 1) select count(*)::text from x$q$)
  || '|' || pg_temp.adm(format($q$with x as (update public.billing_additionals set amount = 1 where id = %L returning 1) select count(*)::text from x$q$, (select id from _adic where k = 'A1')))
  || '|' || pg_temp.adm(format($q$with x as (delete from public.billing_additionals where id = %L returning 1) select count(*)::text from x$q$, (select id from _adic where k = 'A1')))
  || '|' || pg_temp.ope('select count(*)::text from public.billing_additionals'));
select pg_temp.registrar('G5. nem o sistema (postgres) altera o valor nem apaga um adicional (42501)', '42501|42501',
  pg_temp.erro_de(format($q$update public.billing_additionals set amount = 1 where id = %L$q$, (select id from _adic where k = 'A1')))
  || '|' || pg_temp.erro_de(format($q$delete from public.billing_additionals where id = %L$q$, (select id from _adic where k = 'A1'))));
select pg_temp.registrar('G6. cancelar A3 com motivo; cancelar de novo é recusado (55000); sem motivo, 22023', 'ok|erro 55000|erro 22023',
  case when pg_temp.adm(format($q$select count(*)::text from (select public.cancelar_adicional(%L, 'Contêiner não chegou')) x$q$, (select id from _adic where k = 'A3'))) = '1' then 'ok' else 'falhou' end
  || '|' || pg_temp.adm(format($q$select count(*)::text from (select public.cancelar_adicional(%L, 'de novo')) x$q$, (select id from _adic where k = 'A3')))
  || '|' || pg_temp.adm(format($q$select count(*)::text from (select public.cancelar_adicional(%L, '  ')) x$q$, (select id from _adic where k = 'A2'))));
select pg_temp.registrar('G7. trilha: 4 registros e 1 cancelamento, com ator, motivo e valor', '4|1|0',
  (select count(*)::text from public.financial_terms_audit where action = 'adicional_registrado')
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'adicional_cancelado')
  || '|' || (select count(*)::text from public.financial_terms_audit where entity_kind = 'adicional'
               and (actor_id is null or btrim(reason) = '' or (action = 'adicional_registrado' and (new ->> 'amount') is null))));

-- ---------------------------------------------------------------------------
-- H. Fatura, conciliação e congelamento
-- ---------------------------------------------------------------------------

-- Elegível de C1 em 01-15/03: 11 (120/80), 13 (120/80), 21 (60/40), 24 (165/75), 25 (165/130),
-- 27 (187,50/150), 31 (125/40), 32 (312,50/75) = receita 1.255,00, custo 670,00, 8 diárias
-- (21 e 31 são saídas antecipadas: cobrança proporcional desde a 030).
-- Adicional dentro do período: só A1 (350). A2 é cobrado na 2ª quinzena; A3 está cancelado.
create temporary table _fat (id text);
insert into _fat select pg_temp.adm($q$select (public.gerar_fatura('5c29c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$);

select pg_temp.registrar('H1. fatura de C1 em 01-15/03: 8 diárias, total 1.255,00 + 350,00 = 1.605,00, custo 670,00', '8.00|1605.00|670.00',
  (select total_dailies::text || '|' || total_amount::text || '|' || total_cost::text from public.invoices where id::text = (select id from _fat)));
select pg_temp.registrar('H2. itens fecham com o total, e o adicional é item próprio com motivo e referência', '1605.00|1|Adicional — Etiquetagem de 2.000 volumes (ref. OS 123)|350.00',
  (select sum(amount)::text from public.invoice_items where invoice_id::text = (select id from _fat))
  || '|' || (select count(*)::text from public.invoice_items where invoice_id::text = (select id from _fat) and description like 'Adicional%')
  || '|' || (select description || '|' || amount::text from public.invoice_items where invoice_id::text = (select id from _fat) and description like 'Adicional%'));
select pg_temp.registrar('H3. conciliação: total = receita dos apontamentos + adicionais; margem = total - custo = 935,00', 'true|935.00',
  (select (i.total_amount = (select sum(billed_amount) from public.timesheet_entries where invoice_id = i.id)
                          + (select sum(amount) from public.billing_additionals where invoice_id = i.id))::text
          || '|' || (i.total_amount - i.total_cost)::text
     from public.invoices i where i.id::text = (select id from _fat)));
-- FIN-PR-03: itens lidos pelo TIPO; a descrição passou a nomear a tarifa.
select pg_temp.registrar('H4. o adicional não virou diária nem hora extra: itens de diárias somam 1.035,00 em 8 (extras 220,00 à parte)', '1035.00|8.00|220.00',
  (select sum(amount)::text || '|' || sum(quantity)::text from public.invoice_items where invoice_id::text = (select id from _fat) and kind = 'diarias')
  || '|' || (select sum(amount)::text from public.invoice_items where invoice_id::text = (select id from _fat) and kind = 'horas_extras'));
select pg_temp.registrar('H5. A1 vinculado; A2 (cobrado na 2ª quinzena) e A3 (cancelado) não', 'true|false|false',
  (select (invoice_id::text = (select id from _fat))::text from public.billing_additionals where id::text = (select id from _adic where k = 'A1'))
  || '|' || (select (invoice_id is not null)::text from public.billing_additionals where id::text = (select id from _adic where k = 'A2'))
  || '|' || (select (invoice_id is not null)::text from public.billing_additionals where id::text = (select id from _adic where k = 'A3')));
select pg_temp.registrar('H6. faturado congela: cancelar A1 (55000), editar apontamento faturado (42501), gerar de novo (P0002)', 'erro 55000|erro 42501|erro P0002',
  pg_temp.adm(format($q$select count(*)::text from (select public.cancelar_adicional(%L, 'tarde demais')) x$q$, (select id from _adic where k = 'A1')))
  || '|' || pg_temp.editar('11', $s$check_out = '17:00'$s$)
  || '|' || pg_temp.adm($q$select (public.gerar_fatura('5c29c000-0000-4000-8000-0000000000c1', '2026-03-01', '2026-03-15')).id::text$q$));
insert into _fat select pg_temp.adm($q$select (public.gerar_fatura('5c29c000-0000-4000-8000-0000000000c2', '2026-03-16', '2026-03-31')).id::text$q$);
select pg_temp.registrar('H7. fatura só de adicional (C2, serviço fechado 16-31/03): 0 diárias, 400,00, custo 0, 1 item', '0.00|400.00|0.00|1',
  (select total_dailies::text || '|' || total_amount::text || '|' || total_cost::text || '|'
          || (select count(*)::text from public.invoice_items where invoice_id = i.id)
     from public.invoices i where i.client_id = '5c29c000-0000-4000-8000-0000000000c2'));
select pg_temp.registrar('H8. a fatura com adicional não se apaga (o vínculo é lastro)', '23503',
  pg_temp.erro_de($q$delete from public.invoices where client_id = '5c29c000-0000-4000-8000-0000000000c2'$q$));
select pg_temp.registrar('H9. sem apontamento nem adicional elegível: P0002 (inalterado)', 'erro P0002',
  pg_temp.adm($q$select (public.gerar_fatura('5c29c000-0000-4000-8000-0000000000c2', '2026-04-01', '2026-04-15')).id::text$q$));

-- ---------------------------------------------------------------------------
-- I. Entrada = saída com o motor ligado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('I1. admin pela API, insert com entrada = saída: 23514', 'erro 23514',
  pg_temp.adm($q$with x as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c29b000-0000-4000-8000-000000000012', '5c29f000-0000-4000-8000-000000000004', 'present', '08:00', '08:00', 0) returning 1) select count(*)::text from x$q$));
select pg_temp.registrar('I2. editar um apontamento (não faturado) para entrada = saída: 23514, e ele não muda', 'erro 23514|118.75|79.17',
  pg_temp.editar('22', $s$check_in = '14:55'$s$) || '|' || split_part(pg_temp.valores('22'), '|', 1) || '|' || split_part(pg_temp.valores('22'), '|', 2));
select pg_temp.registrar('I3. falta com horários iguais não é afetada (falta não mede jornada)', 'ok',
  pg_temp.entrada('41', '13', '7', _status => 'absent', _in => '08:00', _out => '08:00'));

insert into public.user_operation_access (user_id, operation_id) values ('5c290000-0000-4000-8000-0000000000a2', '5c29e000-0000-4000-8000-0000000000a3');
insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('5c29e000-0000-4000-8000-0000000000a3', '5c29a000-0000-4000-8000-0000000000a3', '5c29f000-0000-4000-8000-000000000003', true);
select pg_temp.registrar('I4. RPC do operador com entrada = saída: recusada', 'erro',
  split_part(pg_temp.ope($q$select count(*)::text from (select public.salvar_apontamento_operacional('5c29e000-0000-4000-8000-0000000000a3', '5c29a000-0000-4000-8000-0000000000a3', date '2026-03-04',
      '[{"employee_id":"5c29f000-0000-4000-8000-000000000003","status":"present","check_in":"09:00","check_out":"09:00","break_minutes":0}]'::jsonb)) x$q$), ' ', 1));
select pg_temp.registrar('I4b. e nada foi gravado na data', '0',
  (select count(*)::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id where t.work_date = date '2026-03-04'));
select pg_temp.registrar('I5. RPC do operador, saída antecipada (06:00-11:00): grava', '1',
  pg_temp.ope($q$select count(*)::text from (select public.salvar_apontamento_operacional('5c29e000-0000-4000-8000-0000000000a3', '5c29a000-0000-4000-8000-0000000000a3', date '2026-03-04',
      '[{"employee_id":"5c29f000-0000-4000-8000-000000000003","status":"present","check_in":"06:00","check_out":"11:00","break_minutes":60}]'::jsonb)) x$q$));
select pg_temp.registrar('I5b. pela RPC do operador: custo e cobrança proporcionais (030): 125,00 / 40,00', '125.00|40.00',
  (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id where t.work_date = date '2026-03-04'));
select pg_temp.registrar('I6. o operador não lê valor: listar_apontamentos_do_operador não devolve valor-hora, custo nem cobrança', 'false',
  (select exists (select 1 from unnest(p.proargnames) a where a ilike '%ot_hourly%' or a ilike '%cost%' or a ilike '%billed%' or a ilike '%amount%')::text
     from pg_proc p where p.oid = 'public.listar_apontamentos_do_operador(uuid, uuid, date)'::regprocedure));

-- ---------------------------------------------------------------------------
-- J. Acesso indevido via API
-- ---------------------------------------------------------------------------

select pg_temp.registrar('J1. admin não grava o snapshot do valor-hora (insert e update: 42501)', 'erro 42501|erro 42501',
  pg_temp.adm($q$with x as (insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes, ot_hourly_cost_snapshot)
    values ('5c29b000-0000-4000-8000-000000000011', '5c29f000-0000-4000-8000-000000000007', 'present', '06:00', '17:00', 60, 999) returning 1) select count(*)::text from x$q$)
  || '|' || pg_temp.editar('25', 'ot_hourly_cost_snapshot = 999'));
select pg_temp.registrar('J2. admin não muda o valor-hora de uma versão existente (imutável, 42501 para todos)', '42501',
  pg_temp.erro_de($q$update public.employee_cost_terms set ot_hourly_cost = 999 where employee_id = '5c29f000-0000-4000-8000-000000000001'$q$));
select pg_temp.registrar('J3. valor-hora inválido (zero, negativo, três casas): 22023; operacional não registra custo (42501)', 'erro 22023|erro 22023|erro 22023|erro 42501',
  pg_temp.adm($q$select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000002', date '2027-01-01', 60, 'x', null, false, 0)::text$q$)
  || '|' || pg_temp.adm($q$select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000002', date '2027-01-01', 60, 'x', null, false, -5)::text$q$)
  || '|' || pg_temp.adm($q$select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000002', date '2027-01-01', 60, 'x', null, false, 20.123)::text$q$)
  || '|' || pg_temp.ope($q$select public.registrar_custo_colaborador('5c29f000-0000-4000-8000-000000000002', date '2027-01-01', 60, 'x', null, false, 20)::text$q$));
insert into _adic values ('E5', pg_temp.adm($q$select public.criar_colaborador_com_vigencia('E5 novo', null, 'Conferente', null, 'active', 70, date '2026-10-01', 'Admissão', 22.5)::text$q$));
insert into _adic values ('E6', pg_temp.adm($q$select public.criar_colaborador_com_vigencia('E6 antigo', null, null, null, 'active', 50, date '2026-10-01', 'Admissão')::text$q$));
select pg_temp.registrar('J4. cadastro atômico com valor-hora: colaborador e versão juntos (motor ligado)', '1|22.50',
  (select count(*)::text from public.employees where id::text = (select id from _adic where k = 'E5'))
  || '|' || (select ot_hourly_cost::text from public.employee_cost_terms t join public.employees e on e.id = t.employee_id where e.name = 'E5 novo'));
select pg_temp.registrar('J5. chamada antiga (sem p_ot_hourly_cost) continua aceita e fica sem valor acordado', '1|-',
  (select count(*)::text from public.employees where id::text = (select id from _adic where k = 'E6'))
  || '|' || (select coalesce(ot_hourly_cost::text, '-') from public.employee_cost_terms t join public.employees e on e.id = t.employee_id where e.name = 'E6 antigo'));
insert into _adic values ('E5c', pg_temp.adm($q$select public.corrigir_custo_colaborador((select t.id from public.employee_cost_terms t join public.employees e on e.id = t.employee_id where e.name = 'E5 novo'),
       date '2026-10-01', null, 70, 'Valor-hora renegociado', 24)::text$q$));
select pg_temp.registrar('J6. correção de versão sem uso informa o valor-hora de novo (E5: 22,50 -> 24,00)', '24.00|correcao',
  (select ot_hourly_cost::text || '|' || origin from public.employee_cost_terms where id::text = (select id from _adic where k = 'E5c')));

-- ---------------------------------------------------------------------------
-- K. Inventário
-- ---------------------------------------------------------------------------

select pg_temp.registrar('K1. estado do motor anuncia as regras da 029', 'true|true|true',
  (select (x ->> 'ativo') || '|' || (x ->> 'consistente') || '|' || (x ->> 'regras_bs') from (select pg_temp.adm('select public.estado_motor_vigencia()::text')::jsonb x) q));
select pg_temp.registrar('K2. adicionais: RLS ligada, só SELECT para authenticated, nada para service_role e operacional', 'true|true|false|false|false',
  (select relrowsecurity::text from pg_class where oid = 'public.billing_additionals'::regclass)
  || '|' || has_table_privilege('authenticated', 'public.billing_additionals', 'SELECT')::text
  || '|' || has_table_privilege('authenticated', 'public.billing_additionals', 'INSERT')::text
  || '|' || has_table_privilege('service_role', 'public.billing_additionals', 'SELECT')::text
  || '|' || has_table_privilege('bslog_rpc_operacional', 'public.billing_additionals', 'SELECT')::text);
select pg_temp.registrar('K3. RPCs novas: authenticated executa, anon não; internas sem EXECUTE de API', 'true|false|false|false',
  has_function_privilege('authenticated', 'public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('anon', 'public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.recusar_entrada_igual_saida()', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.proteger_adicional()', 'EXECUTE')::text);
select pg_temp.registrar('K4. o motor antigo (010) não foi alterado e gerar_fatura não cita o motor novo', '0|0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'derivar_valores_financeiros'
     and (prosrc ilike '%ot_hourly%' or prosrc ilike '%_base_cost%'))
  || '|' || (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'gerar_fatura'
     and (prosrc ilike '%vigencia%' or prosrc ilike '%financial_engine_settings%' or prosrc ilike '%_terms%')));

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
    raise exception '027_regras_financeiras_bs: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
