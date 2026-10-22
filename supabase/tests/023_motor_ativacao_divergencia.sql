-- Migration 027 — ligar o motor recusa divergência entre coluna e vigência (C05-B5.5).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 027 estarem aplicadas, SÓ em banco descartável/homologação. Tudo acontece numa transação que
-- termina em `rollback` (inclusive os registros em auth.users e auth.sessions e a troca do motor).
-- NUNCA rodar contra Production.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  sem divergência: a divergência de decimais, fator e jornada normalizada não bloqueia nada
--   B  divergência de contrato (diária, fator decimal, jornada), colaborador (centavos) e operação
--   C  vigência futura, vigência ausente e operação com contrato NÃO são divergência
--   D  a recusa (ligando com p_aceitar_pendencias = true, para isolar a divergência): 55000, motor
--      segue desligado, gatilhos no estado anterior, colunas intactas, sem trilha de ativação e
--      sem sincronização residual; aceitar pendências não libera divergência
--   E  quem vê a lista: admin AAL2 sim; admin AAL1, operacional e anônimo não
--   F  correção explícita (coluna alinhada com o motor desligado) e depois ligar funciona
--   G  correção por sincronizar_colunas_legadas, com trilha
--   H  a trilha da ativação guarda a contagem de divergências (0)
--   I  desligar não mudou de comportamento; permissões das funções novas

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
  select pg_temp.chamar('5c600000-0000-4000-8000-0000000000a1', 'aal2', _chamada)
$$;

create or replace function pg_temp.motor(_ativar boolean, _extra text default '') returns text language sql as $$
  select pg_temp.adm(format('public.alterar_motor_vigencia(%L, %L%s)', _ativar, case when _ativar then 'Ligado no teste' else 'Desligado no teste' end, _extra))
$$;

create or replace function pg_temp.gatilhos() returns text language sql as $$
  select (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_financeiro') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_timesheet_entries_calculo_vigencia') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_contracts_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_employees_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_operations_bloqueia_taxa_direta') || '|'
      || (select tgenabled::text from pg_trigger where tgname = 'trg_shifts_congela_jornada_usada')
$$;

-- A mensagem de erro de uma chamada feita como admin AAL2.
create or replace function pg_temp.mensagem_de(_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '5c600000-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'aal', 'aal2', 'session_id', 'ec600000-0000-4000-8000-0000000000a1')::text, true);
  set local role authenticated;
  begin
    execute _sql;
  exception when others then
    set local role postgres;
    return sqlerrm;
  end;
  set local role postgres;
  return 'sem erro';
end;
$$;

-- Os campos divergentes de um cadastro, como a lista interna os devolve.
create or replace function pg_temp.campos(_nome text) returns text language sql as $$
  select coalesce((select array_to_string(campos, ',') from public.motor_divergencias() where nome = _nome), '-')
$$;

create or replace function pg_temp.colunas() returns text language sql as $$
  select (select string_agg(daily_rate::text || '/' || shift_hours::text || '/' || ot_factor::text || '/' || ot_tolerance_min::text, ';' order by name) from public.contracts)
      || '|' || (select string_agg(daily_cost::text, ';' order by name) from public.employees)
      || '|' || (select string_agg(coalesce(agreed_amount::text, 'nulo'), ';' order by name) from public.operations)
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c600000-0000-4000-8000-0000000000a1'),
  ('5c600000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec600000-0000-4000-8000-0000000000a1', '5c600000-0000-4000-8000-0000000000a1', null),
  ('ec600000-0000-4000-8000-0000000000a2', '5c600000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c600000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c600000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c60c000-0000-4000-8000-0000000000c1', 'C05B55 cliente');

-- Contratos: KA igual à vigência; KB jornada 0 e fator 0 (legado) contra vigência 8 e 1; KC só tem
-- vigência FUTURA; KD não tem vigência alguma.
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c60d000-0000-4000-8000-0000000000d1', '5c60c000-0000-4000-8000-0000000000c1', 'KA', 100.10, 8, 1.50, 10),
  ('5c60d000-0000-4000-8000-0000000000d2', '5c60c000-0000-4000-8000-0000000000c1', 'KB jornada e fator legados', 90, 0, 0, 5),
  ('5c60d000-0000-4000-8000-0000000000d3', '5c60c000-0000-4000-8000-0000000000c1', 'KC so futura', 111, 8, 1, 0),
  ('5c60d000-0000-4000-8000-0000000000d4', '5c60c000-0000-4000-8000-0000000000c1', 'KD sem vigencia', 222, 8, 1, 0);
insert into public.employees (id, name, daily_cost) values
  ('5c60f000-0000-4000-8000-000000000001', 'EA', 60.05),
  ('5c60f000-0000-4000-8000-000000000002', 'EB sem vigencia', 70);
-- OA sem contrato, igual à vigência; OB com contrato (valor acordado ignorado); OC sem vigência.
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c60e000-0000-4000-8000-0000000000a1', '5c60c000-0000-4000-8000-0000000000c1', null, 'OA', 200.25),
  ('5c60e000-0000-4000-8000-0000000000a2', '5c60c000-0000-4000-8000-0000000000c1', '5c60d000-0000-4000-8000-0000000000d1', 'OB com contrato', 999),
  ('5c60e000-0000-4000-8000-0000000000a3', '5c60c000-0000-4000-8000-0000000000c1', null, 'OC sem vigencia', 333);

select pg_temp.adm($q$public.registrar_condicao_contrato('5c60d000-0000-4000-8000-0000000000d1', date '2020-01-01', 100.10, 8, 1.50, 10, 'KA')$q$);
select pg_temp.adm($q$public.registrar_condicao_contrato('5c60d000-0000-4000-8000-0000000000d2', date '2020-01-01', 90, 8, 1, 5, 'KB normalizada')$q$);
select pg_temp.adm($q$public.registrar_condicao_contrato('5c60d000-0000-4000-8000-0000000000d3', ((now() at time zone 'America/Sao_Paulo')::date + 10), 555, 8, 1, 0, 'KC futura')$q$);
select pg_temp.adm($q$public.registrar_custo_colaborador('5c60f000-0000-4000-8000-000000000001', date '2020-01-01', 60.05, 'EA')$q$);
select pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c60e000-0000-4000-8000-0000000000a1', date '2020-01-01', 200.25, 'OA')$q$);

select pg_temp.registrar('Z0. fixture: 3 vigências de contrato, 1 de custo, 1 de valor acordado', '3|1|1',
  (select (select count(*) from public.contract_terms)::text || '|' || (select count(*) from public.employee_cost_terms)::text
          || '|' || (select count(*) from public.operation_terms)::text));
select pg_temp.registrar('Z1. o motor nasce desligado nesta fixture', 'false|D|O',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || split_part(pg_temp.gatilhos(), '|', 2) || '|' || split_part(pg_temp.gatilhos(), '|', 1));

-- ---------------------------------------------------------------------------
-- A. Sem divergência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. nenhuma divergência: colunas = vigência, jornada 0 = 8 e fator 0 = 1, vigência futura, ausente e operação com contrato', '0',
  (select count(*)::text from public.motor_divergencias()));
select pg_temp.registrar('A2. KB (jornada 0, fator 0) NÃO diverge da vigência normalizada (8 h, fator 1): é o mesmo preço', '-', pg_temp.campos('KB jornada e fator legados'));
select pg_temp.registrar('A3. KC (só vigência futura) não é comparada com a coluna', '-', pg_temp.campos('KC so futura'));
select pg_temp.registrar('A4. KD, EB e OC (sem vigência) não são divergência: seguem como pendência (025)', '-|-|-',
  pg_temp.campos('KD sem vigencia') || '|' || pg_temp.campos('EB sem vigencia') || '|' || pg_temp.campos('OC sem vigencia'));
select pg_temp.registrar('A5. OB (operação COM contrato) com valor acordado diferente de qualquer vigência: não conta', '-', pg_temp.campos('OB com contrato'));

-- ---------------------------------------------------------------------------
-- B. Divergências
-- ---------------------------------------------------------------------------

update public.contracts set daily_rate = 100.11 where id = '5c60d000-0000-4000-8000-0000000000d1';
select pg_temp.registrar('B1. diferença de UM centavo na diária do contrato é divergência', 'daily_rate', pg_temp.campos('KA'));
update public.contracts set daily_rate = 100.10, ot_factor = 1.55 where id = '5c60d000-0000-4000-8000-0000000000d1';
select pg_temp.registrar('B2. fator de hora extra 1,55 contra 1,50 é divergência', 'ot_factor', pg_temp.campos('KA'));
update public.contracts set ot_factor = 1.50, shift_hours = 7.5, ot_tolerance_min = 15 where id = '5c60d000-0000-4000-8000-0000000000d1';
select pg_temp.registrar('B3. jornada e tolerância divergentes aparecem juntas', 'shift_hours,ot_tolerance_min', pg_temp.campos('KA'));
update public.contracts set shift_hours = 8, ot_tolerance_min = 10 where id = '5c60d000-0000-4000-8000-0000000000d1';
update public.employees set daily_cost = 60.06 where id = '5c60f000-0000-4000-8000-000000000001';
select pg_temp.registrar('B4. custo do colaborador com UM centavo de diferença é divergência', 'daily_cost', pg_temp.campos('EA'));
update public.operations set agreed_amount = 200.26 where id = '5c60e000-0000-4000-8000-0000000000a1';
select pg_temp.registrar('B5. valor acordado de operação sem contrato com UM centavo de diferença é divergência', 'agreed_amount', pg_temp.campos('OA'));
select pg_temp.registrar('B6. o inventário traz exatamente 2 cadastros (EA e OA) e o contrato voltou a ser igual', 'colaborador:EA|operacao_sem_contrato:OA',
  (select string_agg(tipo || ':' || nome, '|' order by tipo) from public.motor_divergencias()));
update public.contracts set daily_rate = 100.11 where id = '5c60d000-0000-4000-8000-0000000000d1';

-- ---------------------------------------------------------------------------
-- D. A recusa
-- ---------------------------------------------------------------------------

create temporary table _antes on commit drop as
  select pg_temp.colunas() as colunas, pg_temp.gatilhos() as gatilhos,
         (select count(*) from public.financial_terms_audit) as trilha,
         (select count(*) from public.contract_terms) + (select count(*) from public.employee_cost_terms)
           + (select count(*) from public.operation_terms) as versoes;

-- Existe uma pendência (OC, sem vigência): D1 a D7 ligam ACEITANDO pendências, para que só a divergência possa recusar.
select pg_temp.registrar('D1. ligar aceitando a pendência, com 3 divergências: recusado, 55000', 'erro 55000',
  pg_temp.motor(true, ', true'));
select pg_temp.registrar('D2. sem aceitar a pendência continua recusado (a pendência é checada antes)', 'erro 55000', pg_temp.motor(true));
select pg_temp.registrar('D3. a chave continua desligada e sem data de ativação', 'false|nulo',
  (select vigencia_ativa::text || '|' || coalesce(ativada_em::text, 'nulo') from public.financial_engine_settings));
select pg_temp.registrar('D4. os seis gatilhos ficaram como estavam (rollback do ALTER TABLE)', (select gatilhos from _antes), pg_temp.gatilhos());
select pg_temp.registrar('D5. nenhuma coluna foi sobrescrita', (select colunas from _antes), pg_temp.colunas());
select pg_temp.registrar('D6. nenhuma trilha nova (nem ativação, nem sincronização) e nenhuma vigência criada', 'sim|sim',
  case when (select count(*) from public.financial_terms_audit) = (select trilha from _antes) then 'sim' else 'nao' end || '|' ||
  case when (select count(*) from public.contract_terms) + (select count(*) from public.employee_cost_terms)
            + (select count(*) from public.operation_terms) = (select versoes from _antes) then 'sim' else 'nao' end);
select pg_temp.registrar('D7. a mensagem da divergência informa só quantidades, sem nome de cadastro', 'sim|sim',
  case when pg_temp.mensagem_de($q$select public.alterar_motor_vigencia(true, 'Ligar no teste', true)$q$) like 'Há 3 cadastro(s) (contratos: 1, colaboradores: 1, operações sem contrato: 1)%' then 'sim' else 'nao' end || '|' ||
  case when pg_temp.mensagem_de($q$select public.alterar_motor_vigencia(true, 'Ligar no teste', true)$q$) !~ '(KA|EA|OA|KB|OB)' then 'sim' else 'nao' end);

-- ---------------------------------------------------------------------------
-- E. Quem vê a lista
-- ---------------------------------------------------------------------------

select pg_temp.registrar('E1. admin AAL2 lista as divergências (3)', '3',
  pg_temp.como('5c600000-0000-4000-8000-0000000000a1', 'aal2', 'select count(*)::text from public.divergencias_implantacao_vigencias()'));
select pg_temp.registrar('E2. admin em AAL1 é recusado (42501)', 'erro 42501',
  pg_temp.como('5c600000-0000-4000-8000-0000000000a1', 'aal1', 'select count(*)::text from public.divergencias_implantacao_vigencias()'));
select pg_temp.registrar('E3. operacional é recusado (42501), mesmo em AAL2', 'erro 42501',
  pg_temp.como('5c600000-0000-4000-8000-0000000000a2', 'aal2', 'select count(*)::text from public.divergencias_implantacao_vigencias()'));
select pg_temp.registrar('E4. anônimo não executa (42501)', 'erro 42501',
  pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), 'select count(*)::text from public.divergencias_implantacao_vigencias()'));
select pg_temp.registrar('E5. ligar como admin AAL1 e como operacional continua recusado (42501)', 'erro 42501|erro 42501',
  pg_temp.chamar('5c600000-0000-4000-8000-0000000000a1', 'aal1', $q$public.alterar_motor_vigencia(true, 'x')$q$) || '|' ||
  pg_temp.chamar('5c600000-0000-4000-8000-0000000000a2', 'aal2', $q$public.alterar_motor_vigencia(true, 'x')$q$));
select pg_temp.registrar('E6. a lista interna não é executável por nenhum papel de API', 'false|false|false|false',
  has_function_privilege('authenticated', 'public.motor_divergencias()', 'execute')::text || '|' ||
  has_function_privilege('anon', 'public.motor_divergencias()', 'execute')::text || '|' ||
  has_function_privilege('service_role', 'public.motor_divergencias()', 'execute')::text || '|' ||
  has_function_privilege('bslog_rpc_operacional', 'public.motor_divergencias()', 'execute')::text);

-- ---------------------------------------------------------------------------
-- F. Correção explícita e ativação
-- ---------------------------------------------------------------------------

update public.contracts set daily_rate = 100.10 where id = '5c60d000-0000-4000-8000-0000000000d1';
update public.employees set daily_cost = 60.05 where id = '5c60f000-0000-4000-8000-000000000001';
select pg_temp.registrar('F1. corrigir só o contrato e o colaborador: sobra a operação', 'operacao_sem_contrato:OA',
  (select string_agg(tipo || ':' || nome, '|') from public.motor_divergencias()));
select pg_temp.registrar('F2. ainda recusa com 1 divergência (pendência aceita)', 'erro 55000', pg_temp.motor(true, ', true'));
-- G. Correção por sincronizar_colunas_legadas (explícita, com motivo e trilha)
select pg_temp.registrar('G1. sincronizar_colunas_legadas copia a vigência para a coluna da operação (1 linha)', '1',
  pg_temp.adm($q$public.sincronizar_colunas_legadas('Alinhar valor acordado no teste')$q$));
select pg_temp.registrar('G2. a coluna passou a ser a vigência e a trilha guarda o evento', '200.25|1',
  (select agreed_amount::text from public.operations where id = '5c60e000-0000-4000-8000-0000000000a1')
  || '|' || (select count(*)::text from public.financial_terms_audit where action = 'colunas_legadas_sincronizadas'));
select pg_temp.registrar('G3. sem divergências', '0', (select count(*)::text from public.motor_divergencias()));

create temporary table _pre on commit drop as select pg_temp.colunas() as colunas;

select pg_temp.registrar('F3. ligar agora é aceito, com a pendência de OC (sem vigência) aceita explicitamente', '1',
  pg_temp.motor(true, ', true'));
select pg_temp.registrar('F4. ligado: motor novo, bloqueios e congelamento habilitados; motor antigo desabilitado', 'D|O|O|O|O|O', pg_temp.gatilhos());
select pg_temp.registrar('F5. as colunas não mudaram na ativação', (select colunas from _pre), pg_temp.colunas());

-- H. Trilha
select pg_temp.registrar('H1. a trilha da ativação guarda 0 divergências, 1 pendência aceita e o motivo', '1|0|1|Ligado no teste',
  (select count(*)::text || '|' || min(new ->> 'divergencias') || '|' || min(new ->> 'pendencias') || '|' || min(reason)
     from public.financial_terms_audit where action = 'motor_vigencia_ativado'));
select pg_temp.registrar('H2. ligado: a edição direta de taxa segue recusada (025 preservada)', 'erro 55000',
  pg_temp.como('5c600000-0000-4000-8000-0000000000a1', 'aal2', $q$with u as (update public.contracts set daily_rate = 1 where id = '5c60d000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$));

-- I. Desligar e permissões
select pg_temp.registrar('I1. desligar segue funcionando (sincroniza e desabilita)', '1', pg_temp.motor(false));
select pg_temp.registrar('I2. desligado: motor antigo habilitado, bloqueios desabilitados', 'O|D|D|D|D|D', pg_temp.gatilhos());
select pg_temp.registrar('I3. permissões: a lista e a ativação só para authenticated; dono postgres; SECURITY DEFINER; search_path fixo', '2',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('divergencias_implantacao_vigencias', 'alterar_motor_vigencia')
      and p.prosecdef and p.proowner = 'postgres'::regrole
      and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')));
select pg_temp.registrar('I4. gerar_fatura e derivar_valores_financeiros não foram tocados', '0',
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('derivar_valores_financeiros', 'gerar_fatura')
      and (prosrc ilike '%motor_divergencias%' or prosrc ilike '%financial_engine_settings%')));

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
    raise exception '023_motor_ativacao_divergencia: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
