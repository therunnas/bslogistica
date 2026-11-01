-- Migration 038 — período contratual e janela de cobrança (FIN-PR-05).
--
-- COMO RODAR: `bash scripts/testar-sql-local.sh` (Supabase LOCAL descartável). Uma transação que
-- termina em `rollback`. NUNCA rodar contra Production nem homologação. Dados sintéticos.
--
-- O QUE ESTE ARQUIVO PROVA (valores esperados calculados à mão)
--   P  calendário: quinzenas, mês, fevereiro comum e bissexto, meses de 30/31, virada de ano
--   Q  C01 quinzenal (padrão): 1ª e 2ª quinzena faturam; o mês, um período parcial e um que
--      atravessa o mês são recusados
--   M  CLI-MENSAL: só o mês fatura; a quinzena é recusada; o acumulado é do mês inteiro
--   N  cliente sem contrato (operação com valor acordado): quinzenal
--   A  adicionais: mesma competência, cobrado ANTES da execução, faturado não fatura de novo,
--      cancelado não entra, legado (sem competência) segue a regra antiga, competência inválida
--      recusada, dois clientes não se misturam, fatura só de adicional
--   F  mudança de frequência: futura, só a partir do dia 1, nunca sobre competência faturada nem
--      deixando adicional incompatível; herança na nova versão; correção preserva; fatura histórica
--      intacta
--   X  configuração mista: recusada na escrita e na leitura
--   R  resumo financeiro pela competência e pela frequência
--   S  Σ itens = total em toda fatura desta suíte · segurança e auditoria

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
create or replace function pg_temp.adm(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c380000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec380000-0000-4000-8000-0000000000a1'), _sql)
$$;
create or replace function pg_temp.ope(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated',
    jsonb_build_object('sub', '5c380000-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal1',
                       'session_id', 'ec380000-0000-4000-8000-0000000000a2'), _sql)
$$;
create or replace function pg_temp.anon(_sql text) returns text language sql as $$
  select pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), _sql)
$$;
create or replace function pg_temp.erro_de(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return 'sem erro';
exception when others then
  return 'erro ' || sqlstate;
end;
$$;

-- Ids sintéticos: clientes c1..c6, operações, contratos (devolvidos pelas RPCs).
create or replace function pg_temp.cli(_k text) returns uuid language sql as $$
  select ('5c38c000-0000-4000-8000-0000000000' || _k)::uuid
$$;
create temporary table _ids (k text primary key, id uuid not null) on commit drop;
grant select on _ids to authenticated;

-- Fatura: total|lançamentos|Σ itens = total.
create or replace function pg_temp.fatura(_cli text, _ini date, _fim date) returns text language plpgsql as $$
declare _r text;
begin
  _r := pg_temp.adm(format($q$select (public.gerar_fatura(%L, %L, %L)).id::text$q$, pg_temp.cli(_cli), _ini, _fim));
  if _r like 'erro %' then
    return _r;
  end if;
  return (select i.total_amount::text || '|' || i.total_dailies::integer::text || '|'
                 || case when (select coalesce(sum(it.amount), 0) from public.invoice_items it where it.invoice_id = i.id)
                              = i.total_amount then 'fecha' else 'NAO FECHA' end
            from public.invoices i where i.id = _r::uuid);
end;
$$;

create or replace function pg_temp.competencia(_cli text, _data date) returns text language sql as $$
  select pg_temp.adm(format($q$select frequencia || '|' || inicio || '|' || fim from public.competencia_de_cobranca(%L, %L)$q$,
    pg_temp.cli(_cli), _data))
$$;

create or replace function pg_temp.adicional(_k text, _cli text, _exec_ini date, _exec_fim date, _valor numeric,
                                              _cob_ini date, _cob_fim date) returns text language plpgsql as $$
declare _r text;
begin
  _r := pg_temp.adm(format($q$select public.registrar_adicional(%L, %L, %L, 'ADI sintético ' || %L, %s, null, null, %L, %L)::text$q$,
    pg_temp.cli(_cli), _exec_ini, _exec_fim, _k, _valor, _cob_ini, _cob_fim));
  if _r like 'erro %' then
    return _r;
  end if;
  insert into _ids values (_k, _r::uuid);
  return 'ok';
end;
$$;

-- Como `adicional`, mas devolve também a competência gravada (ok|início|fim), ou o erro.
create or replace function pg_temp.adicional_c(_k text, _cli text, _exec_ini date, _exec_fim date, _valor numeric,
                                                _cob_ini date, _cob_fim date) returns text language plpgsql as $$
declare _r text;
begin
  _r := pg_temp.adicional(_k, _cli, _exec_ini, _exec_fim, _valor, _cob_ini, _cob_fim);
  if _r <> 'ok' then
    return _r;
  end if;
  return 'ok|' || (select a.billing_period_start::text || '|' || a.billing_period_end::text
                     from public.billing_additionals a where a.id = (select id from _ids where k = _k));
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('5c380000-0000-4000-8000-0000000000a1'), ('5c380000-0000-4000-8000-0000000000a2');
insert into auth.sessions (id, user_id, not_after) values
  ('ec380000-0000-4000-8000-0000000000a1', '5c380000-0000-4000-8000-0000000000a1', null),
  ('ec380000-0000-4000-8000-0000000000a2', '5c380000-0000-4000-8000-0000000000a2', null);
insert into public.user_roles (user_id, role) values
  ('5c380000-0000-4000-8000-0000000000a1', 'admin'), ('5c380000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values
  (pg_temp.cli('c1'), 'C01'), (pg_temp.cli('c2'), 'CLI-MENSAL'), (pg_temp.cli('c3'), 'C03 sem contrato'),
  (pg_temp.cli('c4'), 'C04 muda frequência'), (pg_temp.cli('c5'), 'C05'), (pg_temp.cli('c6'), 'C06 dois contratos');

insert into public.employees (id, name, daily_cost)
  select ('5c38f000-0000-4000-8000-00000000000' || i)::uuid, 'PER-E' || i, 80 from generate_series(1, 4) i;
insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, active, origin, reason)
  select ('5c38f000-0000-4000-8000-00000000000' || i)::uuid, date '2026-01-01', 80, true, 'informada', 'PER'
    from generate_series(1, 4) i;

-- Contratos pela RPC atômica. C01 sem frequência informada (padrão quinzenal); CLI-MENSAL mensal e
-- com arredondamento acumulado; C04 quinzenal; C06 com DOIS contratos quinzenais (permitido).
insert into _ids select 'kq', pg_temp.adm($q$select public.criar_contrato_com_vigencia(
  pg_temp.cli('c1'), 'K-Q', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'PER cadastro')::text$q$)::uuid;
insert into _ids select 'km', pg_temp.adm($q$select public.criar_contrato_com_vigencia(
  pg_temp.cli('c2'), 'K-M', date '2026-01-01', null, 'active', 160, 8, 1.5, 10, 'PER cadastro',
  'acumulado', null, null, 'mensal')::text$q$)::uuid;
insert into _ids select 'k4', pg_temp.adm($q$select public.criar_contrato_com_vigencia(
  pg_temp.cli('c4'), 'K-4', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'PER cadastro')::text$q$)::uuid;
insert into _ids select 'k6a', pg_temp.adm($q$select public.criar_contrato_com_vigencia(
  pg_temp.cli('c6'), 'K-6A', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'PER cadastro')::text$q$)::uuid;
insert into _ids select 'k6b', pg_temp.adm($q$select public.criar_contrato_com_vigencia(
  pg_temp.cli('c6'), 'K-6B', date '2026-01-01', null, 'active', 100, 8, 1.5, 10, 'PER cadastro')::text$q$)::uuid;

select pg_temp.registrar('Q0. frequência gravada: padrão quinzenal (C01, C04, C06) e mensal (CLI-MENSAL)',
  'K-4:quinzenal|K-6A:quinzenal|K-6B:quinzenal|K-M:mensal|K-Q:quinzenal',
  (select string_agg(c.name || ':' || ct.closing_period, '|' order by c.name)
     from public.contract_terms ct join public.contracts c on c.id = ct.contract_id
    where c.client_id in (pg_temp.cli('c1'), pg_temp.cli('c2'), pg_temp.cli('c4'), pg_temp.cli('c6'))));

insert into public.operations (id, client_id, contract_id, name)
  select '5c38e000-0000-4000-8000-0000000000a1'::uuid, pg_temp.cli('c1'), (select id from _ids where k = 'kq'), 'OP-Q'
  union all
  select '5c38e000-0000-4000-8000-0000000000a2'::uuid, pg_temp.cli('c2'), (select id from _ids where k = 'km'), 'OP-M';
-- Operação SEM contrato (C03): preço pelo valor acordado por vigência.
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('5c38e000-0000-4000-8000-0000000000a3', pg_temp.cli('c3'), null, 'OP-SEM', 200);
insert into public.operation_terms (operation_id, valid_from, agreed_amount, active, origin, reason) values
  ('5c38e000-0000-4000-8000-0000000000a3', date '2026-01-01', 200, true, 'informada', 'PER');
insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
  select ('5c38a000-0000-4000-8000-0000000000a' || i)::uuid, ('5c38e000-0000-4000-8000-0000000000a' || i)::uuid,
         'T' || i, '06:00', '15:00', 60
    from generate_series(1, 3) i;

-- Os gatilhos adiados das inserções acima disparam agora: ligar o motor altera gatilhos de tabela.
set constraints all immediate;
select pg_temp.registrar('F0. motor ligado', 'true',
  pg_temp.adm($q$select (public.alterar_motor_vigencia(true, 'Ligado no teste PER') ->> 'ativo')$q$));

create or replace function pg_temp.entrada(_cod text, _op text, _data date, _colab text, _saida text) returns void
language plpgsql as $$
begin
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values (('5c38b000-0000-4000-8000-0000000000' || _cod)::uuid, ('5c38e000-0000-4000-8000-0000000000a' || _op)::uuid,
          ('5c38a000-0000-4000-8000-0000000000a' || _op)::uuid, _data);
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
  values (('5c38b100-0000-4000-8000-0000000000' || _cod)::uuid, ('5c38b000-0000-4000-8000-0000000000' || _cod)::uuid,
          ('5c38f000-0000-4000-8000-00000000000' || _colab)::uuid, 'present', '06:00', _saida::time, 60);
end;
$$;

select pg_temp.entrada('01', '1', date '2026-03-03', '1', '15:00');  -- C01, 1ª quinzena
select pg_temp.entrada('02', '1', date '2026-03-17', '1', '15:00');  -- C01, 2ª quinzena
select pg_temp.entrada('03', '2', date '2026-03-02', '2', '15:20');  -- CLI-MENSAL, 20 min acumulados
select pg_temp.entrada('04', '2', date '2026-03-20', '2', '15:20');  -- CLI-MENSAL, 20 min acumulados
select pg_temp.entrada('05', '3', date '2026-03-04', '3', '15:00');  -- C03, operação sem contrato

select pg_temp.registrar('F1. lançamentos precificados: 100 | 100 | 170 (20 min) | 170 (20 min) | 200',
  '100.00|100.00|170.00:20|170.00:20|200.00',
  (select string_agg(te.billed_amount::text || case when te.billed_overtime_minutes > 0 then ':' || te.billed_overtime_minutes else '' end,
                     '|' order by te.id)
     from public.timesheet_entries te where te.id::text like '5c38b100-%'));

-- Fatura HISTÓRICA (anterior à 038, período arbitrário), gravada como a 037 gravava: a 038 não a toca.
insert into public.invoices (id, client_id, period_start, period_end, status, total_dailies, total_overtime, total_amount, total_cost)
values ('5c38ff00-0000-4000-8000-000000000001', pg_temp.cli('c3'), date '2026-02-03', date '2026-02-09', 'closed', 0, 0, 7.00, 0);
insert into public.invoice_items (invoice_id, description, quantity, unit_price, amount, kind)
values ('5c38ff00-0000-4000-8000-000000000001', 'Histórico sintético', 1, 7, 7.00, 'adicional');
create temporary table _historico on commit drop as
  select md5(string_agg(to_jsonb(i)::text, ',' order by i.id)) as h
    from public.invoices i where i.id = '5c38ff00-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- P. Calendário da competência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('P1. janelas válidas: 1ª/2ª quinzena (31, 30, fev 28, fev 29 bissexto), mês (31, 30, fev 28/29), dezembro',
  'true|true|true|true|true|true|true|true|true',
  (select string_agg(public.janela_de_cobranca_valida(f, i, e)::text, '|' order by o)
     from (values (1, 'quinzenal', date '2026-03-01', date '2026-03-15'), (2, 'quinzenal', date '2026-03-16', date '2026-03-31'),
                  (3, 'quinzenal', date '2026-04-16', date '2026-04-30'), (4, 'quinzenal', date '2027-02-16', date '2027-02-28'),
                  (5, 'quinzenal', date '2028-02-16', date '2028-02-29'), (6, 'mensal', date '2026-03-01', date '2026-03-31'),
                  (7, 'mensal', date '2026-04-01', date '2026-04-30'), (8, 'mensal', date '2027-02-01', date '2027-02-28'),
                  (9, 'mensal', date '2026-12-01', date '2026-12-31')) v(o, f, i, e)));
select pg_temp.registrar('P2. janelas inválidas: parcial, 2ª quinzena curta (abr 29, fev 27, fev bissexto 28), mês para quinzenal, quinzena para mensal, virada de ano, frequência desconhecida, invertida',
  'false|false|false|false|false|false|false|false|false',
  (select string_agg(public.janela_de_cobranca_valida(f, i, e)::text, '|' order by o)
     from (values (1, 'quinzenal', date '2026-03-02', date '2026-03-10'), (2, 'quinzenal', date '2026-04-16', date '2026-04-29'),
                  (3, 'quinzenal', date '2027-02-16', date '2027-02-27'), (4, 'quinzenal', date '2028-02-16', date '2028-02-28'),
                  (5, 'quinzenal', date '2026-03-01', date '2026-03-31'), (6, 'mensal', date '2026-03-16', date '2026-03-31'),
                  (7, 'mensal', date '2026-12-16', date '2027-01-15'), (8, 'semanal', date '2026-03-01', date '2026-03-07'),
                  (9, 'quinzenal', date '2026-03-15', date '2026-03-01')) v(o, f, i, e)));
select pg_temp.registrar('P3. competência que contém a data: C01 (fev comum, fev bissexto, 31/12, 01/01) e CLI-MENSAL (fev bissexto, abril)',
  'quinzenal|2027-02-16|2027-02-28;quinzenal|2028-02-16|2028-02-29;quinzenal|2026-12-16|2026-12-31;quinzenal|2027-01-01|2027-01-15;mensal|2028-02-01|2028-02-29;mensal|2026-04-01|2026-04-30',
  pg_temp.competencia('c1', date '2027-02-20') || ';' || pg_temp.competencia('c1', date '2028-02-29') || ';'
  || pg_temp.competencia('c1', date '2026-12-31') || ';' || pg_temp.competencia('c1', date '2027-01-01') || ';'
  || pg_temp.competencia('c2', date '2028-02-10') || ';' || pg_temp.competencia('c2', date '2026-04-15'));
select pg_temp.registrar('P4. virada de ano e período que atravessa o mês: recusados (22023)', 'erro 22023|erro 22023',
  pg_temp.fatura('c1', date '2026-12-16', date '2027-01-15') || '|' || pg_temp.fatura('c1', date '2026-03-10', date '2026-04-09'));

-- ---------------------------------------------------------------------------
-- A. Adicionais (registro)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. cobrado ANTES da execução: executado em 03–05/11, competência 2ª quinzena de outubro', 'ok',
  pg_temp.adicional('a1', 'c1', date '2026-11-03', date '2026-11-05', 50, date '2026-10-16', date '2026-10-31'));
select pg_temp.registrar('A2. mesma competência da execução (1ª quinzena de março)', 'ok',
  pg_temp.adicional('a2', 'c1', date '2026-03-05', date '2026-03-06', 30, date '2026-03-01', date '2026-03-15'));
select pg_temp.registrar('A3. adicional que será cancelado (1ª quinzena de março)', 'ok',
  pg_temp.adicional('a3', 'c1', date '2026-03-05', date '2026-03-05', 20, date '2026-03-01', date '2026-03-15'));
select pg_temp.registrar('A4. sem competência, execução dentro da 2ª quinzena: grava a competência automática (16–31/03)',
  'ok|2026-03-16|2026-03-31',
  pg_temp.adicional_c('a4', 'c1', date '2026-03-20', date '2026-03-25', 15, null, null));
select pg_temp.registrar('A5. sem competência, execução que atravessa as quinzenas (10–20/11): recusado (22023), nada gravado',
  'erro 22023|0',
  pg_temp.adicional('a5', 'c1', date '2026-11-10', date '2026-11-20', 12, null, null)
  || '|' || (select count(*)::text from public.billing_additionals
              where client_id = pg_temp.cli('c1') and period_start = date '2026-11-10'));
select pg_temp.registrar('A5b. sem competência, execução dentro da 1ª quinzena (cliente sem contrato): grava 01–15/04',
  'ok|2026-04-01|2026-04-15',
  pg_temp.adicional_c('a5b', 'c5', date '2026-04-02', date '2026-04-03', 9, null, null));
select pg_temp.registrar('A5c. CLI-MENSAL sem competência, execução de 10 a 20/04: grava o mês (01–30/04)',
  'ok|2026-04-01|2026-04-30',
  pg_temp.adicional_c('a5c', 'c2', date '2026-04-10', date '2026-04-20', 9, null, null));
select pg_temp.registrar('A5d. CLI-MENSAL sem competência, execução atravessando o mês (25/04–05/05): recusado (22023)',
  'erro 22023',
  pg_temp.adicional('a5d', 'c2', date '2026-04-25', date '2026-05-05', 9, null, null));
-- Adicionais HISTÓRICOS (gravados antes da 038, sem competência): linhas como a 029 gravava.
insert into public.billing_additionals (id, client_id, period_start, period_end, description, amount) values
  ('5c38ad00-0000-4000-8000-000000000001', pg_temp.cli('c1'), date '2026-03-21', date '2026-03-22', 'Histórico dentro da 2ª quinzena', 8),
  ('5c38ad00-0000-4000-8000-000000000002', pg_temp.cli('c1'), date '2026-03-10', date '2026-03-20', 'Histórico que cruza as quinzenas', 12);
insert into _ids values ('h1', '5c38ad00-0000-4000-8000-000000000001'), ('h2', '5c38ad00-0000-4000-8000-000000000002');
select pg_temp.registrar('A6. CLI-MENSAL: competência do mês', 'ok',
  pg_temp.adicional('a6', 'c2', date '2026-03-10', date '2026-03-10', 25, date '2026-03-01', date '2026-03-31'));
select pg_temp.registrar('A7. outro cliente (C05, sem contrato), mesma competência de C01', 'ok',
  pg_temp.adicional('a7', 'c5', date '2026-03-02', date '2026-03-02', 40, date '2026-03-01', date '2026-03-15'));
select pg_temp.registrar('A8. competência inválida: mês para quinzenal, quinzena para mensal, parcial, atravessa o mês, só o início (22023)',
  'erro 22023|erro 22023|erro 22023|erro 22023|erro 22023',
  pg_temp.adicional('x1', 'c1', date '2026-03-02', date '2026-03-02', 1, date '2026-03-01', date '2026-03-31') || '|'
  || pg_temp.adicional('x2', 'c2', date '2026-03-02', date '2026-03-02', 1, date '2026-03-01', date '2026-03-15') || '|'
  || pg_temp.adicional('x3', 'c1', date '2026-03-02', date '2026-03-02', 1, date '2026-03-10', date '2026-03-20') || '|'
  || pg_temp.adicional('x4', 'c1', date '2026-03-02', date '2026-03-02', 1, date '2026-03-16', date '2026-04-15') || '|'
  || pg_temp.adicional('x5', 'c1', date '2026-03-02', date '2026-03-02', 1, date '2026-03-01', null));
select pg_temp.registrar('A9. a competência e a execução ficam gravadas separadas (A1)', '2026-11-03|2026-11-05|2026-10-16|2026-10-31',
  (select period_start || '|' || period_end || '|' || billing_period_start || '|' || billing_period_end
     from public.billing_additionals where id = (select id from _ids where k = 'a1')));
select pg_temp.registrar('A10. cancelamento continua pela RPC (A3)', '',
  pg_temp.adm(format($q$select public.cancelar_adicional(%L, 'PER cancelado')::text$q$, (select id from _ids where k = 'a3'))));

-- ---------------------------------------------------------------------------
-- Q. C01 quinzenal
-- ---------------------------------------------------------------------------

select pg_temp.registrar('Q1. C01: o mês inteiro é recusado (22023), nada é faturado', 'erro 22023|0',
  pg_temp.fatura('c1', date '2026-03-01', date '2026-03-31')
  || '|' || (select count(*)::text from public.invoices where client_id = pg_temp.cli('c1')));
select pg_temp.registrar('Q2. C01: período parcial (02–10/03) recusado (22023)', 'erro 22023',
  pg_temp.fatura('c1', date '2026-03-02', date '2026-03-10'));
select pg_temp.registrar('Q3. C01 1ª quinzena: 100 (lançamento) + 30 (A2); A3 cancelado e H2 (histórico que cruza) fora; Σ itens fecha',
  '130.00|1|fecha', pg_temp.fatura('c1', date '2026-03-01', date '2026-03-15'));
select pg_temp.registrar('Q4. C01 2ª quinzena: 100 + 15 (A4, competência automática) + 8 (H1 histórico, regra antiga); H2 continua fora',
  '123.00|1|fecha', pg_temp.fatura('c1', date '2026-03-16', date '2026-03-31'));
select pg_temp.registrar('Q5. faturar de novo a mesma competência: nada a faturar (P0002)', 'erro P0002',
  pg_temp.fatura('c1', date '2026-03-01', date '2026-03-15'));
select pg_temp.registrar('Q6. situação dos adicionais: A2, A4 e H1 faturados, A3 cancelado, H2 (histórico) a faturar e intacto',
  'a2:faturado|a3:cancelado|a4:faturado|h1:faturado|h2:a faturar',
  (select string_agg(i.k || ':' || case when a.invoice_id is not null then 'faturado'
                                        when a.canceled_at is not null then 'cancelado' else 'a faturar' end, '|' order by i.k)
     from _ids i join public.billing_additionals a on a.id = i.id where i.k in ('a2', 'a3', 'a4', 'h1', 'h2')));
select pg_temp.registrar('Q7. históricos não foram reescritos: continuam sem competência', '0',
  (select count(*)::text from public.billing_additionals
    where id in ((select id from _ids where k = 'h1'), (select id from _ids where k = 'h2')) and billing_period_start is not null));

-- ---------------------------------------------------------------------------
-- A (cont.). Cobrança antes da execução e fatura só de adicional
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A11. C01 2ª quinzena de OUTUBRO: só o A1 (executado em novembro), sem lançamento',
  '50.00|0|fecha', pg_temp.fatura('c1', date '2026-10-16', date '2026-10-31'));
select pg_temp.registrar('A12. novembro (quando foi executado) não cobra o A1 de novo (P0002)', 'erro P0002',
  pg_temp.fatura('c1', date '2026-11-01', date '2026-11-15'));
select pg_temp.registrar('A13. dois clientes: C05 fatura só o próprio adicional (40); C01 não o levou', '40.00|0|fecha|0',
  pg_temp.fatura('c5', date '2026-03-01', date '2026-03-15')
  || '|' || (select count(*)::text from public.invoice_items it join public.invoices i on i.id = it.invoice_id
              where i.client_id = pg_temp.cli('c1') and it.amount = 40));

-- ---------------------------------------------------------------------------
-- M. CLI-MENSAL
-- ---------------------------------------------------------------------------

select pg_temp.registrar('R1. resumo de março (CLI-MENSAL), antes da fatura: ajuste previsto pelo MÊS (40 → 30 min = −5,00), adicional 25',
  '-5.00|25.00|360.00',
  pg_temp.adm($q$select ajuste_previsto::text || '|' || adicionais::text || '|' || a_faturar::text
                 from public.resumo_financeiro_periodo(date '2026-03-01', date '2026-03-31', pg_temp.cli('c2'))$q$));
select pg_temp.registrar('M1. CLI-MENSAL: a 1ª quinzena é recusada (22023)', 'erro 22023',
  pg_temp.fatura('c2', date '2026-03-01', date '2026-03-15'));
select pg_temp.registrar('M2. CLI-MENSAL março: 340 + ajuste acumulado do mês (−5,00) + A6 (25) = 360,00; Σ itens fecha',
  '360.00|2|fecha', pg_temp.fatura('c2', date '2026-03-01', date '2026-03-31'));
select pg_temp.registrar('M3. item de arredondamento único do mês: 40 min → 30 min',
  '1|-5.00', (select count(*)::text || '|' || sum(it.amount)::text from public.invoice_items it join public.invoices i on i.id = it.invoice_id
               where i.client_id = pg_temp.cli('c2') and it.kind = 'arredondamento'));

-- ---------------------------------------------------------------------------
-- N. Sem contrato
-- ---------------------------------------------------------------------------

select pg_temp.registrar('N1. cliente sem contrato: quinzenal', 'quinzenal|2026-03-16|2026-03-31',
  pg_temp.competencia('c3', date '2026-03-20'));
select pg_temp.registrar('N2. operação sem contrato: o mês é recusado, a quinzena fatura (200)', 'erro 22023|200.00|1|fecha',
  pg_temp.fatura('c3', date '2026-03-01', date '2026-03-31') || '|' || pg_temp.fatura('c3', date '2026-03-01', date '2026-03-15'));

-- ---------------------------------------------------------------------------
-- F. Mudança de frequência (C04)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('F2. C04: adicional na 1ª quinzena de novembro, faturado', 'ok|10.00|0|fecha',
  pg_temp.adicional('b1', 'c4', date '2026-11-05', date '2026-11-05', 10, date '2026-11-01', date '2026-11-15')
  || '|' || pg_temp.fatura('c4', date '2026-11-01', date '2026-11-15'));
create temporary table _fatura_c4 on commit drop as
  select md5(string_agg(to_jsonb(i)::text, ',' order by i.id))
         || md5((select string_agg(to_jsonb(it)::text, ',' order by it.id) from public.invoice_items it
                  where it.invoice_id in (select id from public.invoices where client_id = pg_temp.cli('c4')))) as h
    from public.invoices i where i.client_id = pg_temp.cli('c4');

-- Frequência|origem da versão devolvida por uma RPC (ou o erro, como veio).
create or replace function pg_temp.versao(_r text) returns text language sql as $$
  select case when _r ~ '^[0-9a-f-]{36}$'
              then (select ct.closing_period || '|' || ct.origin from public.contract_terms ct where ct.id = _r::uuid)
              else _r end
$$;

create or replace function pg_temp.reg4(_inicio date, _freq text, _diaria numeric default 100) returns text language sql as $$
  select pg_temp.adm(format($q$select public.registrar_condicao_contrato(%L, %L, %s, 8, 1.5, 10, 'PER mudança',
    null, true, 'diario', null, null, %L)::text$q$, (select id from _ids where k = 'k4'), _inicio, _diaria, _freq))
$$;

select pg_temp.registrar('F3. mensal a partir de 01/11 (mês com fatura): recusado (55000)', 'erro 55000',
  pg_temp.reg4(date '2026-11-01', 'mensal'));
select pg_temp.registrar('F4. mensal a partir de 10/11 (meio do mês): recusado como mista (55000)', 'erro 55000',
  pg_temp.reg4(date '2026-11-10', 'mensal'));
select pg_temp.registrar('F5. adicional a faturar na 1ª quinzena de janeiro/2027', 'ok',
  pg_temp.adicional('b2', 'c4', date '2027-01-05', date '2027-01-05', 11, date '2027-01-01', date '2027-01-15'));
select pg_temp.registrar('F6. mensal a partir de 01/12 deixaria o adicional de janeiro incompatível: recusado (55000)', 'erro 55000',
  pg_temp.reg4(date '2026-12-01', 'mensal'));
select pg_temp.registrar('F7. cancelado o adicional, a mudança FUTURA para mensal a partir de 01/12 passa', '|ok',
  pg_temp.adm(format($q$select public.cancelar_adicional(%L, 'PER competência')::text$q$, (select id from _ids where k = 'b2')))
  || '|' || case when pg_temp.reg4(date '2026-12-01', 'mensal') ~ '^[0-9a-f-]{36}$' then 'ok' else 'falhou' end);
select pg_temp.registrar('F8. competências antes e depois da mudança: novembro quinzenal, dezembro e janeiro mensais',
  'quinzenal|2026-11-16|2026-11-30;mensal|2026-12-01|2026-12-31;mensal|2027-01-01|2027-01-31',
  pg_temp.competencia('c4', date '2026-11-20') || ';' || pg_temp.competencia('c4', date '2026-12-10') || ';'
  || pg_temp.competencia('c4', date '2027-01-05'));
select pg_temp.registrar('F9. reajuste no meio do mês SEM informar frequência: herda mensal e passa', 'mensal|informada',
  pg_temp.versao(pg_temp.adm(format($q$select public.registrar_condicao_contrato(%L, date '2027-02-10', 110, 8, 1.5, 10,
      'PER reajuste', null, true)::text$q$, (select id from _ids where k = 'k4')))));
select pg_temp.registrar('F10. voltar a quinzenal no meio do mês (10/03/2027): recusado como mista (55000)', 'erro 55000',
  pg_temp.reg4(date '2027-03-10', 'quinzenal', 110));
select pg_temp.registrar('F11. voltar a quinzenal a partir de 01/04/2027: passa', 'ok',
  case when pg_temp.reg4(date '2027-04-01', 'quinzenal', 110) ~ '^[0-9a-f-]{36}$' then 'ok' else 'falhou' end);
select pg_temp.registrar('F12. correção da versão de abril preserva a frequência (quinzenal)', 'quinzenal|correcao',
  pg_temp.versao(pg_temp.adm(format($q$select public.corrigir_condicao_contrato(%L, date '2027-04-01', null, 115, 8, 1.5, 10, 'PER correção')::text$q$,
      (select ct2.id from public.contract_terms ct2 where ct2.contract_id = (select id from _ids where k = 'k4')
          and ct2.active and ct2.valid_from = date '2027-04-01')))));
select pg_temp.registrar('F13. a fatura de novembro (quinzenal) ficou intacta', 'true',
  ((select h from _fatura_c4) = (select md5(string_agg(to_jsonb(i)::text, ',' order by i.id))
         || md5((select string_agg(to_jsonb(it)::text, ',' order by it.id) from public.invoice_items it
                  where it.invoice_id in (select id from public.invoices where client_id = pg_temp.cli('c4'))))
     from public.invoices i where i.client_id = pg_temp.cli('c4')))::text);
select pg_temp.registrar('F14. a fatura histórica de período arbitrário (C03) ficou intacta', 'true',
  ((select h from _historico) = (select md5(string_agg(to_jsonb(i)::text, ',' order by i.id))
                                   from public.invoices i where i.id = '5c38ff00-0000-4000-8000-000000000001'))::text);
select pg_temp.registrar('F15. frequência inválida (semanal): recusada (22023)', 'erro 22023',
  pg_temp.reg4(date '2027-06-01', 'semanal', 110));

-- ---------------------------------------------------------------------------
-- X. Configuração mista
-- ---------------------------------------------------------------------------

select pg_temp.registrar('X1. dois contratos do mesmo cliente com a mesma frequência: competência normal', 'quinzenal|2026-05-01|2026-05-15',
  pg_temp.competencia('c6', date '2026-05-02'));
select pg_temp.registrar('X2. mensal num dos dois contratos (o outro segue quinzenal): recusado (55000)', 'erro 55000',
  pg_temp.adm(format($q$select public.registrar_condicao_contrato(%L, date '2026-05-01', 100, 8, 1.5, 10, 'PER mista',
    null, true, 'diario', null, null, 'mensal')::text$q$, (select id from _ids where k = 'k6b'))));
-- Estado misto forçado por fora das RPCs (como postgres): a leitura também recusa.
update public.contract_terms set valid_to = date '2026-06-01'
 where contract_id = (select id from _ids where k = 'k6b') and active and valid_to is null;
insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason, closing_period)
select id, date '2026-06-01', 100, 8, 1.5, 10, 'informada', 'PER forçado', 'mensal' from _ids where k = 'k6b';
select pg_temp.registrar('X3. estado misto forçado: a fatura e a competência recusam (55000)', 'erro 55000|erro 55000',
  pg_temp.fatura('c6', date '2026-06-01', date '2026-06-15') || '|' || pg_temp.competencia('c6', date '2026-06-10'));

-- ---------------------------------------------------------------------------
-- R. Resumo financeiro pela competência
-- ---------------------------------------------------------------------------

select pg_temp.registrar('R2. C01 outubro conta o A1 (competência de outubro, executado em novembro); novembro não',
  '50.00|0.00',
  pg_temp.adm($q$select adicionais::text from public.resumo_financeiro_periodo(date '2026-10-01', date '2026-10-31', pg_temp.cli('c1'))$q$)
  || '|' || pg_temp.adm($q$select adicionais::text from public.resumo_financeiro_periodo(date '2026-11-01', date '2026-11-30', pg_temp.cli('c1'))$q$));
select pg_temp.registrar('R3. C01 março: adicionais faturados e a faturar (30 + 15 + 8 + 12 do histórico que cruza = 65; o cancelado fora)',
  '65.00|12.00',
  pg_temp.adm($q$select adicionais::text || '|' || (a_faturar)::text
                 from public.resumo_financeiro_periodo(date '2026-03-01', date '2026-03-31', pg_temp.cli('c1'))$q$));

-- ---------------------------------------------------------------------------
-- S. Integridade, segurança e auditoria
-- ---------------------------------------------------------------------------

select pg_temp.registrar('S1. toda fatura desta suíte: Σ itens = total', '0',
  (select count(*)::text from public.invoices i
    where i.client_id in (select pg_temp.cli(k) from unnest(array['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) k)
      and i.total_amount <> (select coalesce(sum(it.amount), 0) from public.invoice_items it where it.invoice_id = i.id)));
select pg_temp.registrar('S2. funções internas sem EXECUTE para authenticated; leitura sem anon',
  'false|false|false|false|true|false|true|false',
  has_function_privilege('authenticated', 'public.janela_de_cobranca_valida(text, date, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.frequencia_de_fechamento(uuid, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.validar_periodo_de_cobranca(uuid, date, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.periodo_contratual_conferir(uuid, date, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.competencia_de_cobranca(uuid, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('anon', 'public.competencia_de_cobranca(uuid, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('authenticated', 'public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date)', 'EXECUTE')::text
  || '|' || has_function_privilege('service_role', 'public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean, text, numeric, numeric, text)', 'EXECUTE')::text);
select pg_temp.registrar('S3. operacional: competência, adicional e condição recusados (42501); anon também', 'erro 42501|erro 42501|erro 42501|erro 42501',
  pg_temp.ope($q$select frequencia from public.competencia_de_cobranca(pg_temp.cli('c1'), date '2026-03-01')$q$)
  || '|' || pg_temp.ope($q$select public.registrar_adicional(pg_temp.cli('c1'), date '2026-03-02', date '2026-03-02', 'x', 1, null, null, date '2026-03-01', date '2026-03-15')::text$q$)
  || '|' || pg_temp.ope(format($q$select public.registrar_condicao_contrato(%L, date '2027-08-01', 100, 8, 1.5, 10, 'x', null, true, 'diario', null, null, 'mensal')::text$q$, (select id from _ids where k = 'kq')))
  || '|' || pg_temp.anon($q$select frequencia from public.competencia_de_cobranca('5c38c000-0000-4000-8000-0000000000c1', date '2026-03-01')$q$));
select pg_temp.registrar('S4. a frequência de uma versão não muda por UPDATE (admin sem privilégio; dono barrado pela imutabilidade)',
  'erro 42501|erro 42501',
  pg_temp.adm(format($q$with u as (update public.contract_terms set closing_period = 'mensal' where contract_id = %L returning 1) select count(*)::text from u$q$,
    (select id from _ids where k = 'kq')))
  || '|' || pg_temp.erro_de(format($q$update public.contract_terms set closing_period = 'mensal' where contract_id = %L$q$, (select id from _ids where k = 'kq'))));
select pg_temp.registrar('S5. a competência de um adicional a faturar não muda por UPDATE (dono barrado)', 'erro 42501',
  pg_temp.erro_de(format($q$update public.billing_additionals set billing_period_start = date '2026-03-16', billing_period_end = date '2026-03-31' where id = %L$q$,
    (select id from _ids where k = 'h2'))));
select pg_temp.registrar('S6. CHECK: competência sem fim, invertida ou atravessando o mês é recusada na tabela (23514)', 'erro 23514|erro 23514|erro 23514',
  pg_temp.erro_de($q$insert into public.billing_additionals (client_id, period_start, period_end, description, amount, billing_period_start) values (pg_temp.cli('c1'), date '2026-03-01', date '2026-03-01', 'x', 1, date '2026-03-01')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.billing_additionals (client_id, period_start, period_end, description, amount, billing_period_start, billing_period_end) values (pg_temp.cli('c1'), date '2026-03-01', date '2026-03-01', 'x', 1, date '2026-03-15', date '2026-03-01')$q$)
  || '|' || pg_temp.erro_de($q$insert into public.billing_additionals (client_id, period_start, period_end, description, amount, billing_period_start, billing_period_end) values (pg_temp.cli('c1'), date '2026-03-01', date '2026-03-01', 'x', 1, date '2026-03-16', date '2026-04-15')$q$));
select pg_temp.registrar('S7. trilha: a versão registrada e o adicional levam frequência e competência',
  'mensal|2026-10-16',
  (select a.new ->> 'closing_period' from public.financial_terms_audit a
    where a.action = 'contrato_condicao_registrada' and a.entity_id = (select id from _ids where k = 'km'))
  || '|' || (select a.new ->> 'billing_period_start' from public.financial_terms_audit a
              where a.action = 'adicional_registrado' and a.entity_id = (select id from _ids where k = 'a1')));
select pg_temp.registrar('S8. o banco anuncia o período contratual', 'true',
  pg_temp.adm($q$select (public.estado_motor_vigencia() ->> 'periodo_contratual')$q$));
select pg_temp.registrar('S9. competencia_de_cobranca é SECURITY DEFINER com search_path fixo; internas são INVOKER',
  'true|false|false|false',
  (select string_agg(p.prosecdef::text, '|' order by array_position(array['competencia_de_cobranca', 'frequencia_de_fechamento',
          'validar_periodo_de_cobranca', 'periodo_contratual_conferir'], p.proname::text))
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('competencia_de_cobranca', 'frequencia_de_fechamento', 'validar_periodo_de_cobranca', 'periodo_contratual_conferir')));

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
    raise exception '038_periodo_contratual: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
