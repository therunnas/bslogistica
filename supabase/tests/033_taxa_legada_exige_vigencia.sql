-- Integridade das taxas legadas com o motor ligado ou desligado (AUTH-01C.1, migration 033).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 033 estarem aplicadas, SÓ em banco descartável/local. Tudo acontece numa transação que termina
-- em `rollback`. NUNCA rodar contra Production.
--
-- O gatilho da 033 é um CONSTRAINT TRIGGER deferido (verifica no commit). Como o arquivo termina em
-- rollback, cada caso força a verificação com `set constraints all immediate` (pg_temp.com_commit),
-- que é exatamente o que o commit faria.
--
-- O QUE ESTE ARQUIVO PROVA
--   A  motor DESLIGADO: regras legadas e AAL2 da 032 preservados (INSERT e UPDATE)
--   B  motor LIGADO: INSERT direto com taxa e sem vigência falha (55000), em AAL2 também; a linha não
--      nasce; UPDATE direto segue recusado; AAL1 não contorna
--   C  cadastro legítimo (criar_*_com_vigencia) funciona e espelha a vigência nas colunas legadas
--   D  vigência de valor diferente ou de outra entidade não legitima o INSERT
--   E  linha sem taxa (defaults) segue livre; postgres/service_role seguem isentos
--   F  forma: gatilhos deferidos, função sem EXECUTE, sem bypass para authenticated; motor religado

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



create or replace function pg_temp.por(_uid text, _aal text, _sql text) returns text language sql as $$
  select pg_temp.como(_uid, _aal, _sql)
$$;

-- executa _sql como o papel e FORÇA a verificação deferida (o que o commit faria)
create or replace function pg_temp.com_commit(_uid text, _aal text, _sql text) returns text language plpgsql as $$
declare _r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal, 'session_id', 'ec' || substr(_uid, 3))::text, true);
  set local role authenticated;
  begin
    execute _sql into _r;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    set local role postgres;
    set constraints all deferred;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return coalesce(_r, 'nulo');
end;
$$;

insert into auth.users (id) values ('5b000000-0000-4000-8000-000000000001'), ('5b000000-0000-4000-8000-000000000002'), ('5b000000-0000-4000-8000-000000000003');
insert into auth.sessions (id, user_id, not_after)
  select ('ec' || substr(id::text, 3))::uuid, id, null from auth.users where id::text like '5b000000%';
insert into public.user_roles (user_id, role) values ('5b000000-0000-4000-8000-000000000001', 'admin'), ('5b000000-0000-4000-8000-000000000002', 'admin'), ('5b000000-0000-4000-8000-000000000003', 'operacional');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values ('5bfac000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-000000000001', 't', 'totp', 'verified', now(), now());
insert into public.clients (id, name) values ('5bc00000-0000-4000-8000-0000000000c1', 'AUTH01C1 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('5bc00000-0000-4000-8000-0000000000d1', '5bc00000-0000-4000-8000-0000000000c1', 'K base', 100, 8, 1, 10);
insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason)
  values ('5bc00000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1, 10, 'informada', 'fixture AUTH01C1');
insert into public.contracts (id, client_id, name) values ('5bc00000-0000-4000-8000-0000000000d2', '5bc00000-0000-4000-8000-0000000000c1', 'K sem vigencia');

create or replace function pg_temp.ins_contrato(_nome text, _taxa numeric) returns text language sql as $$
  select format($q$with i as (insert into public.contracts (client_id, name, daily_rate) values ('5bc00000-0000-4000-8000-0000000000c1', %L, %s) returning 1) select count(*)::text from i$q$, _nome, _taxa)
$$;
create or replace function pg_temp.n(_tabela text, _nome text) returns text language plpgsql as $$
declare _r text;
begin execute format('select count(*)::text from public.%I where name = %L', _tabela, _nome) into _r; return _r; end;
$$;

-- ---------------------------------------------------------------------------
-- A. Motor DESLIGADO
-- ---------------------------------------------------------------------------
select pg_temp.registrar('A0. motor desligado no início', 'false', (select vigencia_ativa::text from public.financial_engine_settings));
select pg_temp.registrar('A1. AAL2: INSERT de contrato com diária passa (regra legada)', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', pg_temp.ins_contrato('A1 contrato', 50)));
select pg_temp.registrar('A2. AAL2: INSERT de colaborador com custo passa', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.employees (name, daily_cost) values ('A2 colab', 40) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('A3. AAL2: INSERT de operação com valor acordado passa', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.operations (client_id, name, agreed_amount) values ('5bc00000-0000-4000-8000-0000000000c1', 'A3 op', 70) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('A4. AAL2: UPDATE direto da diária passa com o motor desligado', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with u as (update public.contracts set daily_rate = 105 where id = '5bc00000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('A5. AAL1 sem fator: INSERT com diária segue negado (032)', 'erro 42501',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', pg_temp.ins_contrato('A5 contrato', 60)));
select pg_temp.registrar('A6. AAL1 sem fator: UPDATE da diária segue negado (032)', 'erro 42501',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', $q$with u as (update public.contracts set daily_rate = 106 where id = '5bc00000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('A7. AAL1 sem fator: contrato sem taxa continua cotidiano', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', $q$with i as (insert into public.contracts (client_id, name) values ('5bc00000-0000-4000-8000-0000000000c1', 'A7 sem taxa') returning 1) select count(*)::text from i$q$));
update public.contracts set daily_rate = 100 where id = '5bc00000-0000-4000-8000-0000000000d1';

-- Liga o motor (admin em AAL2, como em produção)
select pg_temp.registrar('B0. motor ligado pelo admin AAL2', 'ok',
  (select case when pg_temp.por('5b000000-0000-4000-8000-000000000001', 'aal2', $q$select public.alterar_motor_vigencia(true, 'AUTH01C.1 teste', true)::text$q$) like 'erro%' then 'erro' else 'ok' end) );
select pg_temp.registrar('B0b. estado do motor após ligar', 'true', (select vigencia_ativa::text from public.financial_engine_settings));

-- ---------------------------------------------------------------------------
-- B. Motor LIGADO
-- ---------------------------------------------------------------------------
select pg_temp.registrar('B1. AAL2: INSERT direto de contrato com diária e SEM vigência falha (55000)', 'erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', pg_temp.ins_contrato('B1 contrato', 150)));
select pg_temp.registrar('B1b. a linha não nasceu', '0', pg_temp.n('contracts', 'B1 contrato'));
select pg_temp.registrar('B2. AAL2: INSERT direto de colaborador com custo e SEM vigência falha (55000)', 'erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.employees (name, daily_cost) values ('B2 colab', 90) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('B2b. a linha não nasceu', '0', pg_temp.n('employees', 'B2 colab'));
select pg_temp.registrar('B3. AAL2: INSERT direto de operação com valor acordado e SEM vigência falha (55000)', 'erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.operations (client_id, name, agreed_amount) values ('5bc00000-0000-4000-8000-0000000000c1', 'B3 op', 80) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('B3b. a linha não nasceu', '0', pg_temp.n('operations', 'B3 op'));
select pg_temp.registrar('B4. contrato com outro campo financeiro fora do default (jornada 9) e sem vigência: 55000', 'erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.contracts (client_id, name, shift_hours) values ('5bc00000-0000-4000-8000-0000000000c1', 'B4 contrato', 9) returning 1) select count(*)::text from i$q$));
select pg_temp.registrar('B5. AAL1 sem fator: INSERT com diária segue negado (42501, 032)', 'erro 42501',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', pg_temp.ins_contrato('B5 contrato', 60)));
select pg_temp.registrar('B6. AAL2: UPDATE direto da diária segue recusado (55000, 025)', 'erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with u as (update public.contracts set daily_rate = 999 where id = '5bc00000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('B7. AAL1: UPDATE direto também recusado', 'erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', $q$with u as (update public.contracts set daily_rate = 999 where id = '5bc00000-0000-4000-8000-0000000000d1' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('B8. UPDATE direto de custo e de valor acordado também recusados', 'erro 55000|erro 55000',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with u as (update public.employees set daily_cost = 1 where name = 'A2 colab' returning 1) select count(*)::text from u$q$) || '|' ||
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with u as (update public.operations set agreed_amount = 1 where name = 'A3 op' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('B9. operacional não insere nada (RLS)', 'erro 42501',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000003', 'aal2', pg_temp.ins_contrato('B9 contrato', 10)));
select pg_temp.registrar('B10. a diária do contrato base não mudou', '100.00', (select daily_rate::text from public.contracts where id = '5bc00000-0000-4000-8000-0000000000d1'));

-- ---------------------------------------------------------------------------
-- C. Cadastro legítimo com vigência
-- ---------------------------------------------------------------------------
select pg_temp.registrar('C1. criar_contrato_com_vigencia (AAL2) funciona', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$select count(*)::text from (select public.criar_contrato_com_vigencia('5bc00000-0000-4000-8000-0000000000c1', 'C1 contrato', date '2026-01-01', null, 'active', 130, 8, 1.5, 10, 'AUTH01C1')) x$q$));
select pg_temp.registrar('C1b. a vigência existe e o espelho legado é igual', '1|130.00|130.00',
  (select count(*)::text || '|' || min(c.daily_rate)::text || '|' || min(t.daily_rate)::text from public.contracts c join public.contract_terms t on t.contract_id = c.id where c.name = 'C1 contrato'));
select pg_temp.registrar('C2. criar_colaborador_com_vigencia (AAL2) funciona', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$select count(*)::text from (select public.criar_colaborador_com_vigencia('C2 colab', null, null, null, 'active', 55, date '2026-01-01', 'AUTH01C1')) x$q$));
select pg_temp.registrar('C2b. a vigência de custo existe e o espelho legado é igual', '1|55.00|55.00',
  (select count(*)::text || '|' || min(e.daily_cost)::text || '|' || min(t.daily_cost)::text from public.employees e join public.employee_cost_terms t on t.employee_id = e.id where e.name = 'C2 colab'));
select pg_temp.registrar('C3. criar_operacao_com_vigencia (AAL2) funciona', '1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$select count(*)::text from (select public.criar_operacao_com_vigencia('5bc00000-0000-4000-8000-0000000000c1', 'fixed', 'C3 op', null, date '2026-01-01', 'active', null, 75, date '2026-01-01', 'AUTH01C1')) x$q$));
select pg_temp.registrar('C3b. a vigência do valor acordado existe e o espelho legado é igual', '1|75.00|75.00',
  (select count(*)::text || '|' || min(o.agreed_amount)::text || '|' || min(t.agreed_amount)::text from public.operations o join public.operation_terms t on t.operation_id = o.id where o.name = 'C3 op'));
select pg_temp.registrar('C4. criar_contrato_com_vigencia em AAL1 sem fator: negado, nada nasce', 'erro 42501|0',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', $q$select count(*)::text from (select public.criar_contrato_com_vigencia('5bc00000-0000-4000-8000-0000000000c1', 'C4 contrato', date '2026-01-01', null, 'active', 130, 8, 1.5, 10, 'x')) x$q$) || '|' || pg_temp.n('contracts', 'C4 contrato'));
select pg_temp.registrar('C5. cadastro com vigência inválida (motivo vazio) desfaz a entidade (atomicidade)', 'erro 22023|0',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$select count(*)::text from (select public.criar_contrato_com_vigencia('5bc00000-0000-4000-8000-0000000000c1', 'C5 contrato', date '2026-01-01', null, 'active', 130, 8, 1.5, 10, '  ')) x$q$) || '|' || pg_temp.n('contracts', 'C5 contrato'));
select pg_temp.registrar('C6. a trilha financeira registrou os cadastros legítimos', 'true',
  (select (count(*) >= 3)::text from public.financial_terms_audit));

-- ---------------------------------------------------------------------------
-- D. Vigência que não corresponde não legitima o INSERT
-- ---------------------------------------------------------------------------
create or replace function pg_temp.misto_valor_diferente() returns text language plpgsql as $$
declare _id uuid;
begin
  insert into public.contracts (client_id, name, daily_rate) values ('5bc00000-0000-4000-8000-0000000000c1', 'D1 contrato', 200) returning id into _id;
  perform public.registrar_condicao_contrato(_id, date '2026-01-01', 90, 8, 1, 10, 'vigência de valor diferente');
  return 'ok';
end;
$$;
create or replace function pg_temp.misto_outra_entidade() returns text language plpgsql as $$
declare _id uuid;
begin
  insert into public.contracts (client_id, name, daily_rate) values ('5bc00000-0000-4000-8000-0000000000c1', 'D2 contrato', 200) returning id into _id;
  perform public.registrar_condicao_contrato('5bc00000-0000-4000-8000-0000000000d2', date '2026-01-01', 200, 8, 1, 10, 'vigência da OUTRA entidade');
  return 'ok';
end;
$$;
select pg_temp.registrar('D1. vigência de valor diferente na mesma transação NÃO legitima o INSERT', 'erro 55000|0',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', 'select pg_temp.misto_valor_diferente()') || '|' || pg_temp.n('contracts', 'D1 contrato'));
select pg_temp.registrar('D2. vigência de OUTRO contrato não legitima o INSERT', 'erro 55000|0',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', 'select pg_temp.misto_outra_entidade()') || '|' || pg_temp.n('contracts', 'D2 contrato'));

-- ---------------------------------------------------------------------------
-- E. Linhas sem taxa e papéis isentos
-- ---------------------------------------------------------------------------
select pg_temp.registrar('E1. AAL2: contrato, colaborador e operação SEM taxa (defaults) seguem livres', '1|1|1',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.contracts (client_id, name) values ('5bc00000-0000-4000-8000-0000000000c1', 'E1 contrato') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.employees (name) values ('E1 colab') returning 1) select count(*)::text from i$q$) || '|' ||
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', $q$with i as (insert into public.operations (client_id, name) values ('5bc00000-0000-4000-8000-0000000000c1', 'E1 op') returning 1) select count(*)::text from i$q$));
insert into public.contracts (client_id, name, daily_rate) values ('5bc00000-0000-4000-8000-0000000000c1', 'E2 contrato', 77);
select pg_temp.registrar('E2. postgres (migrations, dono do projeto) segue isento com o motor ligado', '1', pg_temp.n('contracts', 'E2 contrato'));
set constraints all immediate;
set constraints all deferred;
select pg_temp.registrar('E3. service_role segue isento (Admin API)', '1',
  pg_temp.medir_como('service_role', '{"role":"service_role"}'::jsonb,
    $q$with i as (insert into public.employees (name, daily_cost) values ('E3 colab', 33) returning 1) select count(*)::text from i$q$));

set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- F. Forma e reversão do motor
-- ---------------------------------------------------------------------------
select pg_temp.registrar('F1. os 3 gatilhos são CONSTRAINT TRIGGER deferidos, habilitados e AFTER INSERT', '3',
  (select count(*)::text from pg_trigger where not tgisinternal and tgenabled = 'O' and tgconstraint <> 0 and tgdeferrable and tginitdeferred
      and (tgtype & 4) > 0 and (tgtype & 2) = 0
      and tgname in ('trg_contracts_exige_vigencia_na_taxa', 'trg_employees_exige_vigencia_na_taxa', 'trg_operations_exige_vigencia_na_taxa')));
select pg_temp.registrar('F2. a função não é executável por anon nem authenticated', 'false|false',
  has_function_privilege('anon', 'public.exigir_vigencia_na_taxa_legada()', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.exigir_vigencia_na_taxa_legada()', 'execute')::text);
select pg_temp.registrar('F3. a função é SECURITY INVOKER com search_path fixo', 'false|true',
  (select prosecdef::text || '|' || (proconfig is not null and proconfig::text like '%search_path%')::text::text from pg_proc where proname = 'exigir_vigencia_na_taxa_legada'));
select pg_temp.registrar('F4. a 032 segue instalada (helper e gatilhos AAL2)', '1|3',
  (select count(*)::text from pg_proc where proname = 'mfa_cotidiano_ok') || '|' || (select count(*)::text from pg_trigger where tgname like 'trg_%_exige_aal2_taxa_legada'));
select pg_temp.registrar('F5. motor DESLIGADO de novo: a regra da 033 deixa de agir (INSERT com taxa em AAL2 passa)', 'true|1',
  (select (pg_temp.por('5b000000-0000-4000-8000-000000000001', 'aal2', $q$select public.alterar_motor_vigencia(false, 'AUTH01C.1 teste reverso')::text$q$) not like 'erro%')::text)
  || '|' || pg_temp.com_commit('5b000000-0000-4000-8000-000000000001', 'aal2', pg_temp.ins_contrato('F5 contrato', 44)));
select pg_temp.registrar('F6. com o motor desligado AAL1 sem fator segue sem poder informar taxa', 'erro 42501',
  pg_temp.com_commit('5b000000-0000-4000-8000-000000000002', 'aal1', pg_temp.ins_contrato('F6 contrato', 45)));

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
    raise exception '033_taxa_legada_exige_vigencia: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
