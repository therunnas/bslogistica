-- Reversão controlada do motor por vigência (RB-01).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 031 estarem aplicadas, SÓ em banco descartável/homologação. Tudo acontece numa transação que
-- termina em `rollback` (inclusive os registros em auth.users e auth.sessions e a troca do motor).
-- NUNCA rodar contra Production.
--
-- A RPC `alterar_motor_vigencia(false, motivo)` é a mesma que a tela "Desligar motor" chama, com o
-- JWT da sessão (aqui simulado só neste teste, em banco descartável). A trilha é
-- `financial_terms_audit` (não `admin_audit_log`).
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  motor ligado como ponto de partida (banco vazio, gatilhos do motor novo)
--   B  quem NÃO desliga: anônimo, operacional AAL2, admin AAL1 e desligar sem motivo; nada muda
--   C  admin AAL2 desliga: chave, seis gatilhos de volta, estado consistente, dados intactos
--   D  trilha: ação, entidade, ator, sessão, motivo, estado anterior e novo
--   E  chamada duplicada: 55000, sem segundo evento na trilha
--   F  ida e volta: liga de novo e desliga de novo, sempre consistente
--   G  com cadastro em uso (pendência aceita no ligar): desligar não altera nenhum dado de negócio

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
-- Fixture: só identidades (admin AAL2, operacional). O motor é ligado pela RPC oficial.
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

create or replace function pg_temp.estado() returns text language sql as $$
  select (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.gatilhos()
$$;

-- ---------------------------------------------------------------------------
-- A. Ponto de partida: motor ligado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. desligado de fábrica', 'false|O|D|D|D|D|D', pg_temp.estado());
select pg_temp.registrar('A2. admin AAL2 liga (pré-condição do teste)', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, 'Ativação de partida do teste', false)$q$));
select pg_temp.registrar('A3. ligado: motor antigo desabilitado, novo e quatro travas habilitados', 'true|D|O|O|O|O|O', pg_temp.estado());
select pg_temp.registrar('A4. estado ligado e consistente pela RPC lida pelo admin', 'true|true',
  (public.estado_motor_vigencia() ->> 'ativo') || '|' || (public.estado_motor_vigencia() ->> 'consistente'));
select pg_temp.registrar('A5. dados de negócio: nenhum', '0/0/0/0/0/0/0/0/0/0/0', pg_temp.negocio());

-- ---------------------------------------------------------------------------
-- B. Quem não desliga
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. anônimo não desliga', 'erro 42501',
  pg_temp.medir_como('anon', '{}'::jsonb, $q$select public.alterar_motor_vigencia(false, 'x')::text$q$));
select pg_temp.registrar('B2. operacional em AAL2 não desliga', 'erro 42501',
  pg_temp.chamar('5c800000-0000-4000-8000-0000000000a2', 'aal2', $q$public.alterar_motor_vigencia(false, 'Tentativa do operacional')$q$));
select pg_temp.registrar('B3. admin em AAL1 não desliga', 'erro 42501',
  pg_temp.chamar('5c800000-0000-4000-8000-0000000000a1', 'aal1', $q$public.alterar_motor_vigencia(false, 'Tentativa em AAL1')$q$));
select pg_temp.registrar('B4. admin AAL2 sem motivo: 22023', 'erro 22023',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, '   ')$q$));
select pg_temp.registrar('B5. nenhuma recusa trocou o motor', 'true|D|O|O|O|O|O', pg_temp.estado());
select pg_temp.registrar('B6. nenhuma recusa gravou evento de desativação', '0',
  (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_desativado'));

-- ---------------------------------------------------------------------------
-- C. Admin AAL2 desliga
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. admin AAL2 desliga com motivo', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, 'Reversão controlada autorizada (teste)')$q$));
select pg_temp.registrar('C2. chave desligada e seis gatilhos de volta ao estado de fábrica', 'false|O|D|D|D|D|D', pg_temp.estado());
select pg_temp.registrar('C3. estado desligado e consistente', 'false|true',
  (public.estado_motor_vigencia() ->> 'ativo') || '|' || (public.estado_motor_vigencia() ->> 'consistente'));
select pg_temp.registrar('C4. a chave guarda o motivo e quem desligou', 'Reversão controlada autorizada (teste)|true',
  (select reason from public.financial_engine_settings) || '|'
  || (select (changed_by = '5c800000-0000-4000-8000-0000000000a1')::text from public.financial_engine_settings));
select pg_temp.registrar('C5. desligar não criou dado de negócio', '0/0/0/0/0/0/0/0/0/0/0', pg_temp.negocio());

-- ---------------------------------------------------------------------------
-- D. Trilha (financial_terms_audit)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D1. um evento de desativação, na entidade "sistema"', '1|sistema',
  (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_desativado')
  || '|' || (select entity_kind from public.financial_terms_audit where action = 'motor_vigencia_desativado'));
select pg_temp.registrar('D2. ator e sessão do admin', 'true|true',
  (select (actor_id = '5c800000-0000-4000-8000-0000000000a1')::text from public.financial_terms_audit where action = 'motor_vigencia_desativado')
  || '|' || (select (actor_session_id is not null)::text from public.financial_terms_audit where action = 'motor_vigencia_desativado'));
select pg_temp.registrar('D3. motivo registrado', 'Reversão controlada autorizada (teste)',
  (select reason from public.financial_terms_audit where action = 'motor_vigencia_desativado'));
select pg_temp.registrar('D4. antes: ligado; depois: desligado', 'true|false',
  (select previous ->> 'vigencia_ativa' from public.financial_terms_audit where action = 'motor_vigencia_desativado')
  || '|' || (select new ->> 'vigencia_ativa' from public.financial_terms_audit where action = 'motor_vigencia_desativado'));
select pg_temp.registrar('D5. a trilha de desativação não aceitou pendência', 'false',
  (select new ->> 'aceitou_pendencias' from public.financial_terms_audit where action = 'motor_vigencia_desativado'));

-- ---------------------------------------------------------------------------
-- E. Chamada duplicada
-- ---------------------------------------------------------------------------

select pg_temp.registrar('E1. desligar com o motor já desligado: 55000', 'erro 55000',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, 'Segundo desligamento')$q$));
select pg_temp.registrar('E2. sem segundo evento e sem troca de estado', '1|false|O|D|D|D|D|D',
  (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_desativado') || '|' || pg_temp.estado());

-- ---------------------------------------------------------------------------
-- F. Ida e volta
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. liga de novo', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, 'Segunda ativação do teste', false)$q$));
select pg_temp.registrar('F2. ligado e consistente', 'true|D|O|O|O|O|O|true',
  pg_temp.estado() || '|' || (public.estado_motor_vigencia() ->> 'consistente'));
select pg_temp.registrar('F3. desliga de novo', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, 'Segunda reversão do teste')$q$));
select pg_temp.registrar('F4. desligado e consistente', 'false|O|D|D|D|D|D|true',
  pg_temp.estado() || '|' || (public.estado_motor_vigencia() ->> 'consistente'));
select pg_temp.registrar('F5. trilha: 2 ativações e 2 desativações', '2|2',
  (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_ativado')
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'motor_vigencia_desativado'));

-- ---------------------------------------------------------------------------
-- G. Com cadastro em uso (pendência aceita no ligar): desligar não mexe nos dados
-- ---------------------------------------------------------------------------

insert into public.clients (id, name) values ('5c80c000-0000-4000-8000-0000000000c1', 'RB01 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5c80d000-0000-4000-8000-0000000000d1', '5c80c000-0000-4000-8000-0000000000c1', 'K em uso', 100, 8, 1, 10);
insert into public.operations (id, client_id, contract_id, name)
  values ('5c80e000-0000-4000-8000-0000000000e1', '5c80c000-0000-4000-8000-0000000000c1', '5c80d000-0000-4000-8000-0000000000d1', 'OP em uso');

create temporary table _antes on commit drop as
  select pg_temp.negocio() as negocio,
         (select daily_rate::text from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d1') as taxa;

select pg_temp.registrar('G1. liga aceitando a pendência', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(true, 'Ativação com cadastro em uso (teste)', true)$q$));
select pg_temp.registrar('G2. desliga com cadastro em uso', '1',
  pg_temp.adm($q$public.alterar_motor_vigencia(false, 'Reversão com cadastro em uso (teste)')$q$));
select pg_temp.registrar('G3. estado de fábrica e consistente', 'false|O|D|D|D|D|D|true',
  pg_temp.estado() || '|' || (public.estado_motor_vigencia() ->> 'consistente'));
select pg_temp.registrar('G4. nenhum dado de negócio mudou entre antes de ligar e depois de desligar', 'true|true',
  (select (negocio = pg_temp.negocio())::text from _antes) || '|'
  || (select (taxa = (select daily_rate::text from public.contracts where id = '5c80d000-0000-4000-8000-0000000000d1'))::text from _antes));

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
    raise exception '031_reversao_do_motor: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
