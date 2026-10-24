-- Ativação do motor por vigência com o banco de negócio VAZIO (C05-B8.6).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 028 estarem aplicadas, SÓ em banco descartável/homologação. Tudo acontece numa transação que
-- termina em `rollback` (inclusive os registros em auth.users e auth.sessions e a troca do motor).
-- NUNCA rodar contra Production.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  banco de negócio vazio: zero pendências, zero divergências, motor desligado
--   B  quem NÃO liga: anônimo, operacional AAL2, admin AAL1 (42501/28000) e quem liga sem motivo
--   C  admin AAL2 liga com p_aceitar_pendencias = false: seis gatilhos trocados, estado
--      consistente, trilha com 0 pendências e sem aceite, nada de negócio criado
--   D  ligar de novo é recusado (55000)
--   E  desligar (reversão controlada no teste): gatilhos de volta, trilha, nada de negócio criado
--   F  com uma pendência, ligar sem aceitar é recusado (55000) e não troca nada

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
  select pg_temp.chamar('5c800000-0000-4000-8000-0000000000a1', 'aal2', _chamada)
$$;

create or replace function pg_temp.gatilhos() returns text language sql as $$
  select (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_financeiro') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_vigencia') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_contracts_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_employees_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_operations_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_shifts_congela_jornada_usada')
$$;

create or replace function pg_temp.negocio() returns text language sql as $$
  select (select count(*) from public.clients)::text || '/' || (select count(*) from public.contracts)::text
      || '/' || (select count(*) from public.employees)::text || '/' || (select count(*) from public.operations)::text
      || '/' || (select count(*) from public.shifts)::text || '/' || (select count(*) from public.timesheets)::text
      || '/' || (select count(*) from public.timesheet_entries)::text
      || '/' || (select count(*) from public.contract_terms)::text || '/' || (select count(*) from public.employee_cost_terms)::text
      || '/' || (select count(*) from public.operation_terms)::text || '/' || (select count(*) from public.invoices)::text
$$;

-- ---------------------------------------------------------------------------
-- Fixture: só identidades (admin AAL2, operacional). Nenhum dado de negócio.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c800000-0000-4000-8000-0000000000a1'),
  ('5c800000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec800000-0000-4000-8000-0000000000a1', '5c800000-0000-4000-8000-0000000000a1', null),
  ('ec800000-0000-4000-8000-0000000000a2', '5c800000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c800000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c800000-0000-4000-8000-0000000000a2', 'operacional');

-- ---------------------------------------------------------------------------
-- A. Banco de negócio vazio
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. nenhum dado de negócio nem vigência nem fatura', '0/0/0/0/0/0/0/0/0/0/0', pg_temp.negocio());
select pg_temp.registrar('A2. zero pendências', '0', (select count(*)::text from public.motor_pendencias()));
select pg_temp.registrar('A3. zero divergências', '0', (select count(*)::text from public.motor_divergencias()));
select pg_temp.registrar('A4. o motor nasce desligado, com o motor antigo habilitado', 'false|O|D|D|D|D|D',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.gatilhos());
select pg_temp.registrar('A5. admin AAL2 lê zero pendências e zero divergências pelas RPCs de implantação', '0|0',
  pg_temp.adm('public.pendencias_implantacao_vigencias()') || '|' || pg_temp.adm('public.divergencias_implantacao_vigencias()'));

-- ---------------------------------------------------------------------------
-- B. Quem não liga
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. anônimo não liga', 'erro 42501',
  pg_temp.medir_como('anon', '{}'::jsonb, $q$select public.alterar_motor_vigencia(true, 'x')::text$q$));
select pg_temp.registrar('B2. operacional em AAL2 não liga', 'erro 42501',
  pg_temp.chamar('5c800000-0000-4000-8000-0000000000a2', 'aal2', $q$public.alterar_motor_vigencia(true, 'Tentativa do operacional')$q$));
select pg_temp.registrar('B3. admin em AAL1 não liga', 'erro 42501',
  pg_temp.chamar('5c800000-0000-4000-8000-0000000000a1', 'aal1', $q$public.alterar_motor_vigencia(true, 'Tentativa em AAL1')$q$));
select pg_temp.registrar('B4. admin AAL2 sem motivo: 22023', 'erro 22023',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, '   ')$q$));
select pg_temp.registrar('B5. nenhuma recusa trocou o motor', 'false|O|D|D|D|D|D',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.gatilhos());

-- ---------------------------------------------------------------------------
-- C. Admin AAL2 liga sem aceitar pendências
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. admin AAL2 liga com p_aceitar_pendencias = false', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, 'Ativação no banco vazio (teste)', false)$q$));
select pg_temp.registrar('C2. chave ligada, motor antigo desabilitado, motor novo e bloqueios habilitados', 'true|D|O|O|O|O|O',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.gatilhos());
select pg_temp.registrar('C3. a ativação gravou a data', 'true',
  (select (ativada_em = (now() at time zone 'America/Sao_Paulo')::date)::text from public.financial_engine_settings));
select pg_temp.registrar('C4. o estado do motor é ligado e consistente', 'true|true',
  (pg_temp.adm('public.estado_motor_vigencia()') is not null)::text || '|'
  || coalesce((select (public.estado_motor_vigencia() ->> 'consistente') = 'true' and (public.estado_motor_vigencia() ->> 'ativo') = 'true'),false)::text);
select pg_temp.registrar('C5. a trilha tem um evento de ativação, com 0 pendências e sem aceite', '1|0|false',
  (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_ativado')
  || '|' || (select coalesce((new ->> 'pendencias'), 'nulo') from public.financial_terms_audit where action = 'motor_vigencia_ativado')
  || '|' || (select coalesce((new ->> 'aceitou_pendencias'), 'nulo') from public.financial_terms_audit where action = 'motor_vigencia_ativado'));
select pg_temp.registrar('C6. a trilha guarda quem ativou (a sessão do admin)', 'true',
  (select (actor_id = '5c800000-0000-4000-8000-0000000000a1')::text from public.financial_terms_audit where action = 'motor_vigencia_ativado'));
select pg_temp.registrar('C7. ligar não criou dado de negócio', '0/0/0/0/0/0/0/0/0/0/0', pg_temp.negocio());

-- ---------------------------------------------------------------------------
-- D. Ligar de novo
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D1. ligar com o motor já ligado: 55000', 'erro 55000',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, 'Segunda ativação')$q$));

-- ---------------------------------------------------------------------------
-- E. Desligar (reversão controlada, só no teste)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('E1. admin AAL2 desliga', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, 'Reversão no teste')$q$));
select pg_temp.registrar('E2. gatilhos de volta ao estado inicial', 'false|O|D|D|D|D|D',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.gatilhos());
select pg_temp.registrar('E3. a trilha tem ativação e desativação', '1|1',
  (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_ativado')
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_desativado'));
select pg_temp.registrar('E4. desligar não criou dado de negócio', '0/0/0/0/0/0/0/0/0/0/0', pg_temp.negocio());

-- ---------------------------------------------------------------------------
-- F. Com pendência, ligar sem aceitar é recusado
-- ---------------------------------------------------------------------------

insert into public.clients (id, name) values ('5c80c000-0000-4000-8000-0000000000c1', 'C05B86 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5c80d000-0000-4000-8000-0000000000d1', '5c80c000-0000-4000-8000-0000000000c1', 'K sem vigencia', 100, 8, 1, 10);
insert into public.operations (id, client_id, contract_id, name)
  values ('5c80e000-0000-4000-8000-0000000000e1', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d1', 'OP em uso');

select pg_temp.registrar('F1. há uma pendência (contrato em uso sem vigência)', '1', (select count(*)::text from public.motor_pendencias()));
select pg_temp.registrar('F2. ligar sem aceitar pendências: 55000', 'erro 55000',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, 'Ligar com pendência', false)$q$));
select pg_temp.registrar('F3. a recusa não trocou nada', 'false|O|D|D|D|D|D',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.gatilhos());

-- ---------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao = 'FAIL' order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '026_ativacao_banco_vazio: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
