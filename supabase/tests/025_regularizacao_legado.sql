-- Regularização do legado financeiro (C05-B5.7): fluxo administrativo com as RPCs que já existem
-- (023, 024 e 025/027). Nenhuma migration nova: este arquivo prova que o conjunto atual basta
-- para tirar um cadastro legado da pendência SEM presumir preço, sem recalcular apontamento e sem
-- reescrever fatura.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor (ou use `psql -f`) DEPOIS de as migrations 021
-- a 028 estarem aplicadas, SÓ em banco descartável/homologação. Tudo acontece numa transação que
-- termina em `rollback` (inclusive os registros em auth.users e auth.sessions e a troca do motor).
-- NUNCA rodar contra Production.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   A  diagnóstico: contrato, colaborador e operação sem contrato legados aparecem como pendência;
--      operação COM contrato não aparece sozinha; só admin AAL2 enxerga a lista
--   B  ligar o motor com pendência é recusado; o motor segue desligado
--   C  entradas inválidas e sobreposição são recusadas, sem gravar nada
--   D  regularização válida (data e motivo escolhidos pelo administrador): sai da pendência, grava
--      a trilha, não cria nada que ninguém tenha informado
--   E  vigência só futura não resolve a pendência de hoje
--   F  valor diferente da coluna vira divergência e bloqueia a ativação, mesmo aceitando pendências
--   G  apontamento antigo e fatura antiga seguem com os mesmos valores em todas as etapas
--   H  ativação autorizada só depois da correção explícita; admin AAL1 e operacional recusados
--   I  o apontamento legado continua legado (sem origem), congelado e sem recálculo

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

create or replace function pg_temp.adm_valor(_sql text) returns text language sql as $$
  select pg_temp.como('5c900000-0000-4000-8000-0000000000a1', 'aal2', _sql)
$$;

create or replace function pg_temp.adm(_chamada text) returns text language sql as $$
  select pg_temp.adm_valor(format('select count(*)::text from (select %s) x', _chamada))
$$;

create or replace function pg_temp.motor(_ativar boolean, _extra text default '') returns text language sql as $$
  select pg_temp.adm(format('public.alterar_motor_vigencia(%L, %L%s)', _ativar, 'Ligado no teste de legado', _extra))
$$;

create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end;
$$;

-- As linhas de uma lista de implantação como 'tipo:nome|...', na ordem do banco.
create or replace function pg_temp.lista(_fn text, _uid text, _aal text) returns text language sql as $$
  select pg_temp.como(_uid, _aal,
    format('select coalesce(string_agg(tipo || '':'' || nome, ''|'' order by tipo, nome), ''-'') from public.%I()', _fn))
$$;

-- ---------------------------------------------------------------------------
-- Fixture: cadastros LEGADOS (criados por INSERT direto, sem nenhuma vigência)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c900000-0000-4000-8000-0000000000a1'),
  ('5c900000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec900000-0000-4000-8000-0000000000a1', '5c900000-0000-4000-8000-0000000000a1', null),
  ('ec900000-0000-4000-8000-0000000000a2', '5c900000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c900000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c900000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values ('5c90c000-0000-4000-8000-0000000000c1', 'C05B57 cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c90d000-0000-4000-8000-0000000000d1', '5c90c000-0000-4000-8000-0000000000c1', 'KL contrato legado', 100, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c90f000-0000-4000-8000-000000000001', 'EL colaborador legado', 60),
  ('5c90f000-0000-4000-8000-000000000002', 'EN colaborador sem uso', 55);
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c90e000-0000-4000-8000-0000000000a1', '5c90c000-0000-4000-8000-0000000000c1', '5c90d000-0000-4000-8000-0000000000d1', 'OL operacao com contrato', null),
  ('5c90e000-0000-4000-8000-0000000000a2', '5c90c000-0000-4000-8000-0000000000c1', null, 'OS operacao sem contrato', 250);
insert into public.operation_team (operation_id, employee_id, active) values
  ('5c90e000-0000-4000-8000-0000000000a1', '5c90f000-0000-4000-8000-000000000001', true);

-- Apontamentos antigos, calculados pelo motor antigo (motor desligado), um deles faturado.
insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('5c90b000-0000-4000-8000-000000000001', '5c90e000-0000-4000-8000-0000000000a1', null, date '2026-01-10'),
  ('5c90b000-0000-4000-8000-000000000002', '5c90e000-0000-4000-8000-0000000000a1', null, date '2026-01-11');
insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values
  ('5c90b100-0000-4000-8000-000000000001', '5c90b000-0000-4000-8000-000000000001', '5c90f000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60),
  ('5c90b100-0000-4000-8000-000000000002', '5c90b000-0000-4000-8000-000000000002', '5c90f000-0000-4000-8000-000000000001', 'present', '06:00', '15:00', 60);
insert into public.invoices (id, client_id, period_start, period_end, status)
  values ('5c90a000-0000-4000-8000-000000000001', '5c90c000-0000-4000-8000-0000000000c1', date '2026-01-01', date '2026-01-31', 'closed');
-- O vínculo de fatura só nasce como `postgres`, contexto do `gerar_fatura`.
set local role postgres;
update public.timesheet_entries set invoice_id = '5c90a000-0000-4000-8000-000000000001' where id = '5c90b100-0000-4000-8000-000000000002';

create temporary table _antes on commit drop as
  select e.id, e.billed_amount, e.cost_amount, e.daily_rate_snapshot, e.daily_cost_snapshot,
         e.terms_origin::text as origem, e.invoice_id,
         (select total_amount from public.invoices where id = '5c90a000-0000-4000-8000-000000000001') as total_fatura
    from public.timesheet_entries e;

create or replace function pg_temp.historico_igual() returns text language sql as $$
  select case when
    (select count(*) from public.timesheet_entries e join _antes a on a.id = e.id
      where e.billed_amount is not distinct from a.billed_amount and e.cost_amount is not distinct from a.cost_amount
        and e.daily_rate_snapshot is not distinct from a.daily_rate_snapshot
        and e.daily_cost_snapshot is not distinct from a.daily_cost_snapshot
        and e.terms_origin::text is not distinct from a.origem
        and e.invoice_id is not distinct from a.invoice_id) = (select count(*) from _antes)
    and (select total_amount from public.invoices where id = '5c90a000-0000-4000-8000-000000000001')
        is not distinct from (select max(total_fatura) from _antes)
  then 'igual' else 'mudou' end
$$;

select pg_temp.registrar('Z0. fixture: 2 apontamentos legados com valor calculado e 1 faturado', 'true|true',
  (select bool_and(billed_amount > 0 and terms_origin is null)::text from public.timesheet_entries) || '|' ||
  (select (invoice_id is not null)::text from public.timesheet_entries where id = '5c90b100-0000-4000-8000-000000000002'));

-- ---------------------------------------------------------------------------
-- A. Diagnóstico
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. pendências (admin AAL2): colaborador EL em uso, contrato KL em uso, operação sem contrato OS',
  'colaborador:EL colaborador legado|contrato:KL contrato legado|operacao_sem_contrato:OS operacao sem contrato',
  pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2'));
select pg_temp.registrar('A2. o colaborador sem uso (EN) e a operação com contrato (OL) não aparecem sozinhos', 'nao|nao',
  case when pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2') like '%EN colaborador%' then 'sim' else 'nao' end || '|' ||
  case when pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2') like '%OL operacao%' then 'sim' else 'nao' end);
select pg_temp.registrar('A3. divergências: nenhuma, porque ainda não há vigência para comparar', '-',
  pg_temp.lista('divergencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2'));
select pg_temp.registrar('A4. admin em AAL1 e operacional não enxergam as listas (42501)', 'erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal1') || '|' ||
  pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a2', 'aal2') || '|' ||
  pg_temp.lista('divergencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal1') || '|' ||
  pg_temp.lista('divergencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a2', 'aal2'));
select pg_temp.registrar('A5. anônimo não executa as listas', 'erro 42501',
  pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), 'select count(*)::text from public.pendencias_implantacao_vigencias()'));

-- ---------------------------------------------------------------------------
-- B. Ligar com pendência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('B1. ligar com 3 pendências sem aceitá-las: recusado (55000)', 'erro 55000', pg_temp.motor(true));
select pg_temp.registrar('B2. o motor continua desligado e o apontamento antigo igual', 'false|igual',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.historico_igual());

-- ---------------------------------------------------------------------------
-- C. Entradas inválidas e sobreposição
-- ---------------------------------------------------------------------------

select pg_temp.registrar('C1. motivo em branco: 22023', 'erro 22023',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c90d000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1.5, 10, ' ')$q$));
select pg_temp.registrar('C2. diária negativa: 23514', 'erro 23514',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c90d000-0000-4000-8000-0000000000d1', date '2026-01-01', -1, 8, 1.5, 10, 'x')$q$));
select pg_temp.registrar('C3. custo com três casas decimais: 22023 (nada é arredondado em silêncio)', 'erro 22023',
  pg_temp.adm($q$public.registrar_custo_colaborador('5c90f000-0000-4000-8000-000000000001', date '2026-01-01', 70.123, 'x')$q$));
select pg_temp.registrar('C4. nada foi gravado pelas tentativas inválidas', '0|0|0',
  (select count(*)::text from public.contract_terms) || '|' || (select count(*)::text from public.employee_cost_terms) || '|' || (select count(*)::text from public.operation_terms));

-- ---------------------------------------------------------------------------
-- D. Regularização válida (data, valor e motivo escolhidos pelo administrador)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('D1. o administrador registra a vigência do contrato KL, com os valores que ele confirmou', '1',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c90d000-0000-4000-8000-0000000000d1', date '2026-01-01', 100, 8, 1.5, 10, 'Conferido com o contrato assinado')$q$));
select pg_temp.registrar('D2. a vigência nasceu aberta, com o início informado, e a trilha guardou o motivo', '2026-01-01|nulo|1|Conferido com o contrato assinado',
  (select valid_from::text || '|' || coalesce(valid_to::text, 'nulo') from public.contract_terms) || '|' ||
  (select count(*)::text from public.financial_terms_audit where action = 'contrato_condicao_registrada') || '|' ||
  (select min(reason) from public.financial_terms_audit where action = 'contrato_condicao_registrada'));
select pg_temp.registrar('D3. o contrato KL saiu da lista de pendências', 'colaborador:EL colaborador legado|operacao_sem_contrato:OS operacao sem contrato',
  pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2'));
select pg_temp.registrar('D4. nova vigência do mesmo contrato que se sobrepõe, sem pedir para encerrar: recusada (23P01)', 'erro 23P01',
  pg_temp.adm($q$public.registrar_condicao_contrato('5c90d000-0000-4000-8000-0000000000d1', date '2026-06-01', 130, 8, 1.5, 10, 'Reajuste')$q$));
select pg_temp.registrar('D5. a sobreposição não gravou nada', '1', (select count(*)::text from public.contract_terms));
select pg_temp.registrar('D6. admin em AAL1 e operacional não registram vigência (42501)', 'erro 42501|erro 42501',
  pg_temp.como('5c900000-0000-4000-8000-0000000000a1', 'aal1', $q$select count(*)::text from (select public.registrar_custo_colaborador('5c90f000-0000-4000-8000-000000000001', date '2026-01-01', 60, 'x')) x$q$) || '|' ||
  pg_temp.como('5c900000-0000-4000-8000-0000000000a2', 'aal2', $q$select count(*)::text from (select public.registrar_custo_colaborador('5c90f000-0000-4000-8000-000000000001', date '2026-01-01', 60, 'x')) x$q$));

-- ---------------------------------------------------------------------------
-- E. Vigência só futura não resolve a pendência de hoje
-- ---------------------------------------------------------------------------

select pg_temp.registrar('E1. registrar o custo de EL só para o futuro', '1',
  pg_temp.adm($q$public.registrar_custo_colaborador('5c90f000-0000-4000-8000-000000000001', ((now() at time zone 'America/Sao_Paulo')::date + 30), 60, 'Reajuste futuro')$q$));
select pg_temp.registrar('E2. EL continua pendente hoje (vigência futura não conta)', 'colaborador:EL colaborador legado|operacao_sem_contrato:OS operacao sem contrato',
  pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2'));

-- ---------------------------------------------------------------------------
-- F. Valor diferente da coluna vira divergência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F1. registrar o valor acordado de OS com valor DIFERENTE da coluna (250 -> 275), vigente desde 2026-01-01', '1',
  pg_temp.adm($q$public.registrar_valor_acordado_operacao('5c90e000-0000-4000-8000-0000000000a2', date '2026-01-01', 275, 'Valor confirmado com o cliente')$q$));
select pg_temp.registrar('F2. a operação OS vira divergência (agreed_amount) e deixa a pendência', 'operacao_sem_contrato:OS operacao sem contrato|colaborador:EL colaborador legado',
  pg_temp.lista('divergencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2') || '|' ||
  pg_temp.lista('pendencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2'));
select pg_temp.registrar('F3. a coluna antiga não foi sobrescrita nem a vigência alterada', '250.00|275.00',
  (select agreed_amount::text from public.operations where id = '5c90e000-0000-4000-8000-0000000000a2') || '|' ||
  (select agreed_amount::text from public.operation_terms));
select pg_temp.registrar('F4. ligar aceitando as pendências, com a divergência aberta: recusado (55000)', 'erro 55000',
  pg_temp.motor(true, ', true'));
select pg_temp.registrar('F5. motor desligado, nada alterado', 'false|igual',
  (select vigencia_ativa::text from public.financial_engine_settings) || '|' || pg_temp.historico_igual());

-- ---------------------------------------------------------------------------
-- H. Correção explícita e ativação autorizada
-- ---------------------------------------------------------------------------

-- O administrador decide que a coluna é que estava desatualizada (motor desligado: edição direta
-- permitida, como a tela faz). A alternativa seria registrar outra vigência.
update public.operations set agreed_amount = 275 where id = '5c90e000-0000-4000-8000-0000000000a2';
select pg_temp.registrar('H1. divergência corrigida de forma explícita: lista vazia', '-',
  pg_temp.lista('divergencias_implantacao_vigencias', '5c900000-0000-4000-8000-0000000000a1', 'aal2'));
select pg_temp.registrar('H2. ligar como admin em AAL1 e como operacional: recusado (42501)', 'erro 42501|erro 42501',
  pg_temp.como('5c900000-0000-4000-8000-0000000000a1', 'aal1', $q$select count(*)::text from (select public.alterar_motor_vigencia(true, 'x', true)) x$q$) || '|' ||
  pg_temp.como('5c900000-0000-4000-8000-0000000000a2', 'aal2', $q$select count(*)::text from (select public.alterar_motor_vigencia(true, 'x', true)) x$q$));
select pg_temp.registrar('H3. ligar sem aceitar a pendência que sobrou (EL): recusado (55000)', 'erro 55000', pg_temp.motor(true));
select pg_temp.registrar('H4. com a pendência de EL aceita de forma explícita: ligado', '1', pg_temp.motor(true, ', true'));
select pg_temp.registrar('H5. a trilha da ativação guarda 1 pendência aceita e 0 divergências', '1|1|0|true',
  (select count(*)::text || '|' || min(new ->> 'pendencias') || '|' || min(new ->> 'divergencias') || '|' || min(new ->> 'aceitou_pendencias')
     from public.financial_terms_audit where action = 'motor_vigencia_ativado'));

-- ---------------------------------------------------------------------------
-- I. O legado continua legado
-- ---------------------------------------------------------------------------

select pg_temp.registrar('I1. apontamentos e fatura antigos seguem idênticos, sem origem de preço', 'igual|2',
  pg_temp.historico_igual() || '|' || (select count(*)::text from public.timesheet_entries where terms_origin is null));
select pg_temp.registrar('I2. editar o horário de apontamento legado continua recusado (55000): ninguém comprovou o preço', 'erro 55000',
  pg_temp.adm_valor($q$with u as (update public.timesheet_entries set check_out = '18:00' where id = '5c90b100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
select pg_temp.registrar('I3. a prévia da regularização recusa enquanto não há custo vigente na data do apontamento (P0002): nada é presumido', 'erro P0002|igual',
  pg_temp.adm_valor($q$select public.regularizar_apontamento_legado('5c90b100-0000-4000-8000-000000000001', 'Prévia', false)::text$q$) || '|' || pg_temp.historico_igual());
select pg_temp.registrar('I3b. o administrador registra o custo de EL para o período do apontamento (até a vigência futura já cadastrada)', '1',
  pg_temp.adm($q$public.registrar_custo_colaborador('5c90f000-0000-4000-8000-000000000001', date '2026-01-01', 60, 'Custo do período confirmado', ((now() at time zone 'America/Sao_Paulo')::date + 30))$q$));
select pg_temp.registrar('I3c. agora a prévia funciona e NÃO grava (p_aplicar = false)', 'false|igual',
  (select (pg_temp.adm_valor($q$select public.regularizar_apontamento_legado('5c90b100-0000-4000-8000-000000000001', 'Prévia', false)::text$q$)::jsonb ->> 'aplicado')) || '|' || pg_temp.historico_igual());
select pg_temp.registrar('I4. o apontamento faturado não pode ser regularizado (55000)', 'erro 55000',
  pg_temp.adm($q$public.regularizar_apontamento_legado('5c90b100-0000-4000-8000-000000000002', 'Faturado', true)$q$));

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
    raise exception '025_regularizacao_legado: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
