-- Migration 022 — condições financeiras versionadas, EXPANSÃO do esquema (C05-B, etapa 1).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez, DEPOIS de a
-- migration 022 estar aplicada. Tudo acontece dentro de uma transação que termina em
-- `rollback`, então nada é criado, alterado ou removido — inclusive em `auth.users` e
-- `auth.sessions`. NUNCA rodar contra Production: o `rollback` protege, mas o arquivo
-- escreve em `auth.users`, `auth.sessions`, nas tabelas de negócio e nas tabelas novas.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   S   estrutura: tabelas, RLS, exclusões de sobreposição, colunas anuláveis, trigger
--   V   vigência: intervalo [valid_from, valid_to), adjacência, sobreposição, versão
--       aposentada, constraints de valor, referência imutável e cascata de exclusão
--   R   segurança: quem lê, quem NÃO escreve (admin AAL2 inclusive), privilégios por papel
--   E   as 7 colunas novas do apontamento: só o sistema as preenche
--   F   o comportamento financeiro NÃO mudou: criar, editar horário, editar notas, valor
--       derivado direto e apontamento faturado dão os mesmos números e as mesmas recusas
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Não prova o comportamento versionado (isso é da 024) nem as RPCs (023): aqui as tabelas
-- novas são escritas como `postgres` só para exercitar as constraints. Não mede concorrência
-- entre sessões (um arquivo é uma sessão): isso foi medido à parte, com duas sessões.

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

-- Mede `_sql` sob um papel e uma claim montada à mão. Devolve o texto do resultado ou
-- 'erro <sqlstate>'.
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

create or replace function pg_temp.admin2(_sql text) returns text language sql as $$
  select pg_temp.como('5c0b0000-0000-4000-8000-0000000000a1', 'aal2', _sql)
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
--
--   a1 ADM (admin, AAL2)   a2 OP (operacional)   a3 SR (sem papel)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c0b0000-0000-4000-8000-0000000000a1'),
  ('5c0b0000-0000-4000-8000-0000000000a2'),
  ('5c0b0000-0000-4000-8000-0000000000a3');

insert into auth.sessions (id, user_id, not_after) values
  ('ec0b0000-0000-4000-8000-0000000000a1', '5c0b0000-0000-4000-8000-0000000000a1', null),
  ('ec0b0000-0000-4000-8000-0000000000a2', '5c0b0000-0000-4000-8000-0000000000a2', null),
  ('ec0b0000-0000-4000-8000-0000000000a3', '5c0b0000-0000-4000-8000-0000000000a3', null);

insert into public.user_roles (user_id, role) values
  ('5c0b0000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c0b0000-0000-4000-8000-0000000000a2', 'operacional');

-- AUTH-01B: o admin desta fixture TEM fator verificado. Assim "admin em AAL1" segue significando
-- TOTP pendente, que continua negado (conta SEM fator em AAL1 é coberta por 032_mfa_opcional.sql).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  select gen_random_uuid(), ur.user_id, 'fixture AUTH01B', 'totp', 'verified', now(), now()
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'admin';

-- ---------------------------------------------------------------------------
-- S. Estrutura (antes de qualquer escrita nas tabelas novas)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('S1. as duas tabelas de versões nascem VAZIAS (nenhuma vigência presumida)',
  '0/0', (select (select count(*) from public.contract_terms)::text || '/' || (select count(*) from public.employee_cost_terms)::text));

select pg_temp.registrar('S2. nenhum apontamento existente tem condições preenchidas (legado = NULL)',
  '0', (select count(*)::text from public.timesheet_entries
         where contract_terms_id is not null or employee_cost_terms_id is not null or terms_origin is not null
            or shift_hours_snapshot is not null or ot_factor_snapshot is not null
            or ot_tolerance_snapshot is not null or planned_minutes_snapshot is not null));

select pg_temp.registrar('S3. RLS ativa nas duas tabelas novas',
  '2', (select count(*)::text from pg_class where oid in ('public.contract_terms'::regclass, 'public.employee_cost_terms'::regclass) and relrowsecurity));

select pg_temp.registrar('S4. as 7 colunas novas do apontamento são anuláveis e sem DEFAULT',
  '7', (select count(*)::text from pg_attribute
         where attrelid = 'public.timesheet_entries'::regclass
           and attname in ('contract_terms_id', 'employee_cost_terms_id', 'shift_hours_snapshot', 'ot_factor_snapshot', 'ot_tolerance_snapshot', 'planned_minutes_snapshot', 'terms_origin')
           and not attnotnull and not atthasdef));

select pg_temp.registrar('S5. exclusões de sobreposição existem (contract_terms e employee_cost_terms)',
  '2', (select count(*)::text from pg_constraint where conname in ('contract_terms_sem_sobreposicao', 'employee_cost_terms_sem_sobreposicao') and contype = 'x'));

select pg_temp.registrar('S6. trigger de proteção das colunas novas existe e dispara ANTES do bloqueio financeiro e da derivação',
  'true', (select (min(case when tgname = 'trg_timesheet_entries_bloqueia_condicoes' then tgname end) < min(case when tgname = 'trg_timesheet_entries_bloqueio_financeiro' then tgname end)
              and min(case when tgname = 'trg_timesheet_entries_bloqueia_condicoes' then tgname end) < min(case when tgname = 'trg_timesheet_entries_calculo_financeiro' then tgname end))::text
             from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass and not tgisinternal));

select pg_temp.registrar('S7. os triggers financeiros anteriores continuam todos presentes e habilitados',
  '7', (select count(*)::text from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass and not tgisinternal and tgenabled = 'O'
         and tgname in ('trg_timesheet_entries_bloqueio_financeiro', 'trg_timesheet_entries_calculo_financeiro', 'trg_timesheet_entries_bloqueia_edicao_faturada',
                        'trg_timesheet_entries_bloqueia_delete_faturado', 'trg_timesheet_entries_bloqueia_desvinculo',
                        'trg_timesheet_entries_bloqueia_vinculo_direto', 'trg_timesheet_entries_chave')));

-- ---------------------------------------------------------------------------
-- V. Vigência
-- ---------------------------------------------------------------------------

insert into public.clients (id, name) values ('5c0bc000-0000-4000-8000-0000000000ca', 'C05B marcador cliente');
insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c0bd000-0000-4000-8000-00000000000a', '5c0bc000-0000-4000-8000-0000000000ca', 'KA C05B', 100, 8, 1.5, 10),
  ('5c0bd000-0000-4000-8000-00000000000b', '5c0bc000-0000-4000-8000-0000000000ca', 'KB C05B', 120, 8, 1.5, 10);
insert into public.employees (id, name, daily_cost) values
  ('5c0bf000-0000-4000-8000-000000000001', 'C05B colaborador 1', 60),
  ('5c0bf000-0000-4000-8000-000000000002', 'C05B colaborador 2', 80);

create or replace function pg_temp.versao(
  _contrato text, _de text, _ate text, _ativa boolean default true, _motivo text default 'teste', _origem text default 'informada',
  _diaria numeric default 100, _jornada numeric default 8, _fator numeric default 1.5, _tol int default 10
) returns text language plpgsql as $$
begin
  insert into public.contract_terms (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason, retired_at)
  values (_contrato::uuid, _de::date, _ate::date, _diaria, _jornada, _fator, _tol, _ativa, _origem, _motivo, case when _ativa then null else now() end);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

do $v$
declare
  _a constant text := '5c0bd000-0000-4000-8000-00000000000a';
  _b constant text := '5c0bd000-0000-4000-8000-00000000000b';
begin
  perform pg_temp.registrar('V1. versão [01/01, 01/02)', 'ok', pg_temp.versao(_a, '2026-01-01', '2026-02-01'));
  perform pg_temp.registrar('V2. versão ADJACENTE [01/02, 01/03) é válida (fim exclusivo)', 'ok', pg_temp.versao(_a, '2026-02-01', '2026-03-01'));
  perform pg_temp.registrar('V3. versão que SOBREPÕE [15/01, 15/02) é recusada', '23P01', pg_temp.versao(_a, '2026-01-15', '2026-02-15'));
  perform pg_temp.registrar('V4. versão aberta [01/03, ...) depois da última', 'ok', pg_temp.versao(_a, '2026-03-01', null));
  perform pg_temp.registrar('V5. nova versão que sobrepõe a ABERTA é recusada', '23P01', pg_temp.versao(_a, '2026-06-01', '2026-07-01'));
  perform pg_temp.registrar('V5b. outra aberta no mesmo contrato é recusada', '23P01', pg_temp.versao(_a, '2027-01-01', null));
  perform pg_temp.registrar('V6. as MESMAS datas em OUTRO contrato são válidas', 'ok', pg_temp.versao(_b, '2026-01-01', '2026-02-01'));
  perform pg_temp.registrar('V7. versão APOSENTADA sobreposta não conflita (sai da conta)', 'ok', pg_temp.versao(_a, '2026-01-10', '2026-02-10', false));
  perform pg_temp.registrar('V8. fim anterior ao início é recusado', '23514', pg_temp.versao(_b, '2026-05-01', '2026-04-01'));
  perform pg_temp.registrar('V8b. fim IGUAL ao início (intervalo vazio) é recusado', '23514', pg_temp.versao(_b, '2026-05-01', '2026-05-01'));
  perform pg_temp.registrar('V9a. diária negativa recusada', '23514', pg_temp.versao(_b, '2027-01-01', null, true, 'x', 'informada', -1));
  perform pg_temp.registrar('V9b. jornada zero recusada', '23514', pg_temp.versao(_b, '2027-01-01', null, true, 'x', 'informada', 100, 0));
  perform pg_temp.registrar('V9c. fator negativo recusado', '23514', pg_temp.versao(_b, '2027-01-01', null, true, 'x', 'informada', 100, 8, -1));
  perform pg_temp.registrar('V9d. tolerância negativa recusada', '23514', pg_temp.versao(_b, '2027-01-01', null, true, 'x', 'informada', 100, 8, 1.5, -5));
  perform pg_temp.registrar('V10a. motivo em branco recusado', '23514', pg_temp.versao(_b, '2027-01-01', null, true, '   '));
  perform pg_temp.registrar('V10b. origem inválida recusada', '23514', pg_temp.versao(_b, '2027-01-01', null, true, 'x', 'palpite'));
  perform pg_temp.registrar('V10c. origem migrada_por_prova é aceita', 'ok', pg_temp.versao(_b, '2027-01-01', null, true, 'prova: 12 apontamentos reproduzidos', 'migrada_por_prova'));
end;
$v$;

select pg_temp.registrar('V11. aposentadoria incoerente recusada (ativa com retired_at)',
  '23514', pg_temp.erro_de($q$insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason, retired_at)
    values ('5c0bd000-0000-4000-8000-00000000000a', date '2030-01-01', 1, 8, 1, 0, true, 'informada', 'x', now())$q$));
select pg_temp.registrar('V11b. aposentadoria incoerente recusada (inativa sem retired_at)',
  '23514', pg_temp.erro_de($q$insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, active, origin, reason)
    values ('5c0bd000-0000-4000-8000-00000000000a', date '2030-01-01', 1, 8, 1, 0, false, 'informada', 'x')$q$));

-- Fronteira do intervalo: 01/02 pertence à versão que COMEÇA nele, não à que termina nele.
select pg_temp.registrar('V12. data de fronteira (01/02) pertence à versão que começa nela',
  '2026-02-01', (select valid_from::text from public.contract_terms
                  where contract_id = '5c0bd000-0000-4000-8000-00000000000a' and active
                    and daterange(valid_from, valid_to, '[)') @> date '2026-02-01'));
select pg_temp.registrar('V12b. 31/01 pertence à versão anterior',
  '2026-01-01', (select valid_from::text from public.contract_terms
                  where contract_id = '5c0bd000-0000-4000-8000-00000000000a' and active
                    and daterange(valid_from, valid_to, '[)') @> date '2026-01-31'));

-- employee_cost_terms
do $c$
declare _e constant text := '5c0bf000-0000-4000-8000-000000000001';
begin
  insert into public.employee_cost_terms (employee_id, valid_from, valid_to, daily_cost, origin, reason)
    values (_e::uuid, date '2026-01-01', date '2026-02-01', 60, 'informada', 'teste');
  perform pg_temp.registrar('V13. custo: versão adjacente é válida',
    'ok', (select case when pg_temp.erro_de(format($q$insert into public.employee_cost_terms (employee_id, valid_from, valid_to, daily_cost, origin, reason) values (%L, date '2026-02-01', null, 65, 'informada', 'teste')$q$, _e)) = 'sem erro' then 'ok' else 'erro' end));
  perform pg_temp.registrar('V13b. custo: sobreposição recusada (23P01)',
    '23P01', pg_temp.erro_de(format($q$insert into public.employee_cost_terms (employee_id, valid_from, valid_to, daily_cost, origin, reason) values (%L, date '2026-01-15', date '2026-01-20', 70, 'informada', 'teste')$q$, _e)));
  perform pg_temp.registrar('V13c. custo: valor negativo recusado',
    '23514', pg_temp.erro_de(format($q$insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, origin, reason) values (%L, date '2031-01-01', -1, 'informada', 'teste')$q$, _e)));
  perform pg_temp.registrar('V13d. custo: outro colaborador nas mesmas datas é válido',
    'sem erro', pg_temp.erro_de($q$insert into public.employee_cost_terms (employee_id, valid_from, valid_to, daily_cost, origin, reason) values ('5c0bf000-0000-4000-8000-000000000002', date '2026-01-01', date '2026-02-01', 80, 'informada', 'teste')$q$));
end;
$c$;

-- Referência imutável e cascata de exclusão (comando único: NO ACTION confere no fim).
do $r$
begin
  insert into public.operations (id, client_id, contract_id, name)
    values ('5c0be000-0000-4000-8000-000000000001', '5c0bc000-0000-4000-8000-0000000000ca', '5c0bd000-0000-4000-8000-00000000000a', 'C05B operação');
  insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
    values ('5c0ba000-0000-4000-8000-000000000001', '5c0be000-0000-4000-8000-000000000001', 'T', '06:00', '15:00', 60);
  insert into public.timesheets (id, operation_id, shift_id, work_date)
    values ('5c0bb000-0000-4000-8000-000000000001', '5c0be000-0000-4000-8000-000000000001', '5c0ba000-0000-4000-8000-000000000001', date '2026-01-15');
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c0bb100-0000-4000-8000-000000000001', '5c0bb000-0000-4000-8000-000000000001', '5c0bf000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);
end;
$r$;

-- (como postgres, a derivação da 024 ainda não existe: o apontamento recebe a referência à mão)
update public.timesheet_entries
   set contract_terms_id = (select id from public.contract_terms where contract_id = '5c0bd000-0000-4000-8000-00000000000a' and active and valid_from = date '2026-01-01'),
       terms_origin = 'versao'
 where id = '5c0bb100-0000-4000-8000-000000000001';

select pg_temp.registrar('V14. versão referenciada por apontamento NÃO pode ser apagada (23503)',
  '23503', pg_temp.erro_de($q$delete from public.contract_terms where id = (select contract_terms_id from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-000000000001')$q$));

do $d$
begin
  insert into public.employees (id, name, daily_cost) values ('5c0bf000-0000-4000-8000-000000000009', 'C05B colaborador a apagar', 50);
  insert into public.employee_cost_terms (id, employee_id, valid_from, daily_cost, origin, reason)
    values ('5c0b9000-0000-4000-8000-000000000009', '5c0bf000-0000-4000-8000-000000000009', date '2026-01-01', 50, 'informada', 'teste');
  insert into public.timesheets (id, operation_id, shift_id, work_date)
    values ('5c0bb000-0000-4000-8000-000000000009', '5c0be000-0000-4000-8000-000000000001', '5c0ba000-0000-4000-8000-000000000001', date '2026-01-16');
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c0bb100-0000-4000-8000-000000000009', '5c0bb000-0000-4000-8000-000000000009', '5c0bf000-0000-4000-8000-000000000009', 'present', '06:00', '15:00', 60);
  update public.timesheet_entries set employee_cost_terms_id = '5c0b9000-0000-4000-8000-000000000009' where id = '5c0bb100-0000-4000-8000-000000000009';
  -- Desde a 031, excluir colaborador com apontamento NÃO faturado é recusado (histórico preservado).
  begin
    delete from public.employees where id = '5c0bf000-0000-4000-8000-000000000009';
  exception when sqlstate '55000' then null; end;
  perform pg_temp.registrar('V15. apagar colaborador com apontamento não faturado é recusado (031): colaborador, versão e apontamento preservados',
    '1/1/1', (select (select count(*) from public.employees where id = '5c0bf000-0000-4000-8000-000000000009')::text || '/'
                  || (select count(*) from public.employee_cost_terms where id = '5c0b9000-0000-4000-8000-000000000009')::text || '/'
                  || (select count(*) from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-000000000009')::text));
exception when others then
  perform pg_temp.registrar('V15. apagar colaborador com apontamento não faturado é recusado (031)', '1/1/1', 'erro ' || sqlstate || ' ' || sqlerrm);
end;
$d$;

-- ---------------------------------------------------------------------------
-- R. Segurança e privilégios
-- ---------------------------------------------------------------------------

do $s$
declare
  _a1 constant text := '5c0b0000-0000-4000-8000-0000000000a1';
  _a2 constant text := '5c0b0000-0000-4000-8000-0000000000a2';
  _a3 constant text := '5c0b0000-0000-4000-8000-0000000000a3';
  _total text := (select count(*)::text from public.contract_terms);
begin
  perform pg_temp.registrar('R1. admin em AAL2 lê todas as versões do contrato',
    _total, pg_temp.admin2('select count(*)::text from public.contract_terms'));
  perform pg_temp.registrar('R1b. admin em AAL2 lê as versões de custo',
    (select count(*)::text from public.employee_cost_terms), pg_temp.admin2('select count(*)::text from public.employee_cost_terms'));
  perform pg_temp.registrar('R2. admin em AAL1 não lê nenhuma', '0', pg_temp.como(_a1, 'aal1', 'select count(*)::text from public.contract_terms'));
  perform pg_temp.registrar('R3a. operacional (AAL2) não lê nenhuma', '0', pg_temp.como(_a2, 'aal2', 'select count(*)::text from public.contract_terms'));
  perform pg_temp.registrar('R3b. sem papel não lê nenhuma', '0', pg_temp.como(_a3, 'aal2', 'select count(*)::text from public.contract_terms'));
  perform pg_temp.registrar('R3c. operacional não lê as versões de custo', '0', pg_temp.como(_a2, 'aal2', 'select count(*)::text from public.employee_cost_terms'));
  perform pg_temp.registrar('R4. anônimo é barrado (sem privilégio)', 'erro 42501',
    pg_temp.medir_como('anon', jsonb_build_object('role', 'anon'), 'select count(*)::text from public.contract_terms'));
  perform pg_temp.registrar('R5a. admin em AAL2 NÃO insere versão pela API (sem privilégio e sem policy)', 'erro 42501',
    pg_temp.admin2($q$with i as (insert into public.contract_terms (contract_id, valid_from, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason) values ('5c0bd000-0000-4000-8000-00000000000b', date '2040-01-01', 1, 8, 1, 0, 'informada', 'x') returning 1) select count(*)::text from i$q$));
  perform pg_temp.registrar('R5b. admin em AAL2 NÃO altera versão pela API', 'erro 42501',
    pg_temp.admin2($q$with u as (update public.contract_terms set daily_rate = 1 returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('R5c. admin em AAL2 NÃO apaga versão pela API', 'erro 42501',
    pg_temp.admin2($q$with d as (delete from public.contract_terms returning 1) select count(*)::text from d$q$));
  perform pg_temp.registrar('R5d. admin em AAL2 NÃO escreve versão de custo pela API', 'erro 42501',
    pg_temp.admin2($q$with i as (insert into public.employee_cost_terms (employee_id, valid_from, daily_cost, origin, reason) values ('5c0bf000-0000-4000-8000-000000000002', date '2040-01-01', 1, 'informada', 'x') returning 1) select count(*)::text from i$q$));
  perform pg_temp.registrar('R5e. as tabelas continuam como estavam depois das tentativas', _total, (select count(*)::text from public.contract_terms));
end;
$s$;

select pg_temp.registrar('R6. privilégios: só authenticated tem SELECT; ninguém escreve (anon, authenticated, service_role, papel operacional, PUBLIC)',
  'true', (select (
    has_table_privilege('authenticated', 'public.contract_terms', 'SELECT') and has_table_privilege('authenticated', 'public.employee_cost_terms', 'SELECT')
    and not exists (
      select 1 from (values ('anon'), ('authenticated'), ('service_role'), ('bslog_rpc_operacional')) r(papel),
                    (values ('public.contract_terms'), ('public.employee_cost_terms')) t(tabela),
                    (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
       where has_table_privilege(r.papel, t.tabela, p.priv))
    and not has_table_privilege('anon', 'public.contract_terms', 'SELECT')
    and not has_table_privilege('service_role', 'public.contract_terms', 'SELECT')
    and not has_table_privilege('bslog_rpc_operacional', 'public.contract_terms', 'SELECT')
    and not has_table_privilege('bslog_rpc_operacional', 'public.employee_cost_terms', 'SELECT'))::text));

select pg_temp.registrar('R7. nenhuma policy de escrita nas tabelas novas',
  '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('contract_terms', 'employee_cost_terms') and cmd in ('INSERT', 'UPDATE', 'DELETE')));

select pg_temp.registrar('R8. o papel operacional não ganhou privilégio em nenhuma coluna nova do apontamento',
  '0', (select count(*)::text from information_schema.column_privileges
         where table_schema = 'public' and table_name = 'timesheet_entries' and grantee = 'bslog_rpc_operacional'
           and column_name in ('contract_terms_id', 'employee_cost_terms_id', 'shift_hours_snapshot', 'ot_factor_snapshot', 'ot_tolerance_snapshot', 'planned_minutes_snapshot', 'terms_origin')));

-- ---------------------------------------------------------------------------
-- E. As colunas novas do apontamento: só o sistema preenche
-- ---------------------------------------------------------------------------

do $e$
declare
  _kt text := (select id::text from public.contract_terms where contract_id = '5c0bd000-0000-4000-8000-00000000000a' and active and valid_from = date '2026-01-01');
begin
  perform pg_temp.registrar('E1. admin em AAL2 NÃO preenche contract_terms_id num apontamento novo', 'erro 42501',
    pg_temp.admin2(format($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes, contract_terms_id) values ('5c0bb100-0000-4000-8000-0000000000e1', '5c0bb000-0000-4000-8000-000000000001', '5c0bf000-0000-4000-8000-000000000002', 'present', '06:00', '15:00', 60, %L) returning 1) select count(*)::text from i$q$, _kt)));
  perform pg_temp.registrar('E2. admin em AAL2 NÃO preenche terms_origin num apontamento novo', 'erro 42501',
    pg_temp.admin2($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes, terms_origin) values ('5c0bb100-0000-4000-8000-0000000000e2', '5c0bb000-0000-4000-8000-000000000001', '5c0bf000-0000-4000-8000-000000000002', 'present', '06:00', '15:00', 60, 'versao') returning 1) select count(*)::text from i$q$));
  perform pg_temp.registrar('E3. admin em AAL2 NÃO altera as condições de um apontamento existente', 'erro 42501',
    pg_temp.admin2($q$with u as (update public.timesheet_entries set shift_hours_snapshot = 12 where id = '5c0bb100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('E4. admin em AAL2 NÃO apaga a referência (voltar a NULL também é alteração)', 'erro 42501',
    pg_temp.admin2($q$with u as (update public.timesheet_entries set contract_terms_id = null where id = '5c0bb100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('E5. admin em AAL2 edita as notas de um apontamento COM condições gravadas (sem tocar nelas)', '1',
    pg_temp.admin2($q$with u as (update public.timesheet_entries set notes = 'ok' where id = '5c0bb100-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('E6. o sistema (postgres) PODE preencher as condições', 'ok',
    (select case when pg_temp.erro_de($q$update public.timesheet_entries set ot_tolerance_snapshot = 10, planned_minutes_snapshot = 480 where id = '5c0bb100-0000-4000-8000-000000000001'$q$) = 'sem erro' then 'ok' else 'erro' end));
end;
$e$;

-- ---------------------------------------------------------------------------
-- F. O comportamento financeiro NÃO mudou
-- ---------------------------------------------------------------------------

do $f$
declare
  _antes text;
begin
  insert into public.operations (id, client_id, contract_id, name)
    values ('5c0be000-0000-4000-8000-0000000000f1', '5c0bc000-0000-4000-8000-0000000000ca', '5c0bd000-0000-4000-8000-00000000000b', 'C05B F');
  insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
    values ('5c0ba000-0000-4000-8000-0000000000f1', '5c0be000-0000-4000-8000-0000000000f1', 'T', '06:00', '15:00', 60);
  insert into public.timesheets (id, operation_id, shift_id, work_date)
    values ('5c0bb000-0000-4000-8000-0000000000f1', '5c0be000-0000-4000-8000-0000000000f1', '5c0ba000-0000-4000-8000-0000000000f1', date '2026-01-15');

  -- contrato KB: R$120, 8h, fator 1,5, tolerância 10; colaborador 2: custo 80; 06:00-17:00 com 60 de intervalo = 120 min extras
  perform pg_temp.registrar('F1. criar apontamento como admin: derivação idêntica à de sempre',
    '1', pg_temp.admin2($q$with i as (insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes) values ('5c0bb100-0000-4000-8000-0000000000f1', '5c0bb000-0000-4000-8000-0000000000f1', '5c0bf000-0000-4000-8000-000000000002', 'present', '06:00', '17:00', 60) returning 1) select count(*)::text from i$q$));

  perform pg_temp.registrar('F1b. valores derivados (receita 120+2h*22,50=165,00; custo 80+2h*10=100,00; diária 120; hora extra 22,50; custo 80)',
    '165.00|100.00|120.00|22.50|80.00|120',
    (select billed_amount::text || '|' || cost_amount::text || '|' || daily_rate_snapshot::text || '|' || ot_hour_rate_snapshot::text || '|' || daily_cost_snapshot::text || '|' || overtime_minutes::text
       from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-0000000000f1'));

  perform pg_temp.registrar('F1c. as condições do apontamento novo continuam NULL (a 022 não deriva nada)',
    'null/null/null/null/null/null/null',
    (select coalesce(contract_terms_id::text, 'null') || '/' || coalesce(employee_cost_terms_id::text, 'null') || '/' || coalesce(shift_hours_snapshot::text, 'null') || '/'
         || coalesce(ot_factor_snapshot::text, 'null') || '/' || coalesce(ot_tolerance_snapshot::text, 'null') || '/' || coalesce(planned_minutes_snapshot::text, 'null') || '/' || coalesce(terms_origin, 'null')
       from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-0000000000f1'));

  select billed_amount::text || '|' || cost_amount::text into _antes from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-0000000000f1';

  perform pg_temp.registrar('F2. editar só as notas preserva os valores',
    '1', pg_temp.admin2($q$with u as (update public.timesheet_entries set notes = 'n' where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('F2b. valores preservados',
    _antes, (select billed_amount::text || '|' || cost_amount::text from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-0000000000f1'));

  perform pg_temp.registrar('F3. gravar a receita direto continua recusado (valor derivado)',
    'erro 42501', pg_temp.admin2($q$with u as (update public.timesheet_entries set billed_amount = 999 where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from u$q$));

  -- a 022 NÃO muda o recálculo com as taxas atuais (isso é da 024): reajusta o contrato e edita o horário
  update public.contracts set daily_rate = 150 where id = '5c0bd000-0000-4000-8000-00000000000b';
  perform pg_temp.registrar('F4. editar o horário depois do reajuste recalcula com a taxa ATUAL, como antes da migration (R$150 + 2h*28,125 = 206,25)',
    '1', pg_temp.admin2($q$with u as (update public.timesheet_entries set check_out = '17:00:00', break_minutes = 60, status = 'present', check_in = '06:00:00' where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('F4b. (sem mudança de coluna motriz não recalcula; muda o horário para forçar)',
    '1', pg_temp.admin2($q$with u as (update public.timesheet_entries set check_out = '17:30' where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('F4c. valor após editar o horário (30 min a mais, taxa atual: 150 + 2,5h*28,125 = 220,3125 -> 220,31)',
    '220.31', (select billed_amount::text from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-0000000000f1'));

  -- faturado
  insert into public.invoices (id, client_id, period_start, period_end, status)
    values ('5c0bb200-0000-4000-8000-0000000000f1', '5c0bc000-0000-4000-8000-0000000000ca', date '2026-01-01', date '2026-01-31', 'closed');
  update public.timesheet_entries set invoice_id = '5c0bb200-0000-4000-8000-0000000000f1' where id = '5c0bb100-0000-4000-8000-0000000000f1';
  perform pg_temp.registrar('F5. apontamento faturado continua imutável (editar notas)',
    'erro 42501', pg_temp.admin2($q$with u as (update public.timesheet_entries set notes = 'y' where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('F5b. apontamento faturado continua sem poder ser apagado',
    'erro 42501', pg_temp.admin2($q$with d as (delete from public.timesheet_entries where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from d$q$));
  perform pg_temp.registrar('F5c. faturado também recusa preencher condições (nem o sistema altera linha faturada pelo caminho da API)',
    'erro 42501', pg_temp.admin2($q$with u as (update public.timesheet_entries set terms_origin = 'versao' where id = '5c0bb100-0000-4000-8000-0000000000f1' returning 1) select count(*)::text from u$q$));
end;
$f$;

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '017_condicoes_financeiras_expansao: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
