-- Migration 021 — integridade cliente-contrato-operação (C05-A).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez, DEPOIS de a
-- migration 021 estar aplicada. Tudo acontece dentro de uma transação que termina em
-- `rollback`, então nada é criado, alterado ou removido — inclusive em `auth.users`,
-- `auth.sessions` e nas constraints que os blocos G e H derrubam e recriam.
-- NUNCA rodar contra Production: o `rollback` protege, mas o arquivo escreve em
-- `auth.users`, `auth.sessions`, `operations`, `contracts` e `invoices`, e derruba a
-- chave composta dentro da transação.
--
-- O QUE ESTE ARQUIVO PROVA
--
-- A invariante "uma operação só referencia contrato do mesmo cliente", medida como o
-- PostgREST escreve: papel `authenticated`, claims de JWT com `session_id`, RLS e
-- triggers ativos (os mesmos cenários A1 a A8 da C05.1 do diagnóstico):
--
--   A1  par coerente                                   -> aceito
--   A2  contrato de outro cliente (INSERT)             -> recusado (23503)
--   A3  trocar só o cliente da operação                -> recusado (23503)
--   A4  trocar o cliente do contrato referenciado      -> recusado (23503)
--   A5  operação sem contrato                          -> aceita, inclusive trocando de cliente
--   A6  apagar contrato                                -> contract_id vira NULL, client_id fica
--   A7  troca conjunta de cliente e contrato           -> aceita; troca em dois passos -> recusada
--   A8  sem papel / operacional / admin em AAL1        -> continuam impedidos (RLS)
--   A9  apontamento faturado                           -> proteções existentes preservadas
--   G   dados LEGADOS inválidos: a migration não os altera; a chave entra NOT VALID
--       (editar um campo comum de uma linha legada NÃO é provável aqui: o PostgreSQL sempre reconfere a
--       chave de linhas criadas na própria transação, e a fixture é criada nesta. Isso foi medido à parte,
--       com a linha legada commitada em transação anterior: editar o nome é aceito; ver o relatório da C05.2A)
--   H   dados legados válidos: a validação funciona (automática e manual)
--   I   mensagens reais do banco (o texto que a interface traduz)
--   J   apagar cliente com contratos e operações continua em cascata
--   K   estrutura da chave composta e permanência da chave original
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Não prova a tela (isso é da suíte `test:integridade-contratos`, que confere a forma do
-- código e a tradução do erro). Não toca Production nem conta registros de lá: o cenário
-- de dados legados é fabricado aqui, dentro da transação, derrubando a chave.

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

-- Mede `_sql` sob um papel e uma claim montada à mão. Devolve o texto do resultado
-- ou 'erro <sqlstate>'.
create or replace function pg_temp.medir_como(
  _papel text, _uid text, _aal text, _sid text, _sql text
) returns text language plpgsql as $$
declare _r text; _claims jsonb;
begin
  _claims := jsonb_build_object('sub', _uid, 'role', 'authenticated', 'session_id', _sid, 'aal', _aal);
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

-- Como `medir_como`, mas devolve `sqlstate | constraint | mensagem` do erro.
create or replace function pg_temp.erro_de(
  _papel text, _uid text, _aal text, _sid text, _sql text
) returns text language plpgsql as $$
declare _r text; _claims jsonb; _s text; _c text; _m text;
begin
  _claims := jsonb_build_object('sub', _uid, 'role', 'authenticated', 'session_id', _sid, 'aal', _aal);
  perform set_config('request.jwt.claims', _claims::text, true);
  execute format('set local role %I', _papel);
  begin
    execute _sql into _r;
  exception when others then
    get stacked diagnostics _c = constraint_name, _m = message_text;
    _s := sqlstate;
    set local role postgres;
    return _s || ' | ' || coalesce(_c, '-') || ' | ' || _m;
  end;
  set local role postgres;
  return 'sem erro';
end;
$$;

create or replace function pg_temp.admin(_sql text) returns text language sql as $$
  select pg_temp.medir_como('authenticated', '5c050000-0000-4000-8000-0000000000a1', 'aal2',
                            'ec050000-0000-4000-8000-0000000000a1', _sql)
$$;

-- ---------------------------------------------------------------------------
-- Fixture
--
--   a1 ADM  admin, sessão AAL2     a2 OP  operacional     a3 SR  sem papel
--   clientes CA, CB, CC            contratos KA (de CA), KB (de CB)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('5c050000-0000-4000-8000-0000000000a1'),
  ('5c050000-0000-4000-8000-0000000000a2'),
  ('5c050000-0000-4000-8000-0000000000a3');

insert into auth.sessions (id, user_id, not_after) values
  ('ec050000-0000-4000-8000-0000000000a1', '5c050000-0000-4000-8000-0000000000a1', null),
  ('ec050000-0000-4000-8000-0000000000a2', '5c050000-0000-4000-8000-0000000000a2', null),
  ('ec050000-0000-4000-8000-0000000000a3', '5c050000-0000-4000-8000-0000000000a3', null);

insert into public.user_roles (user_id, role) values
  ('5c050000-0000-4000-8000-0000000000a1', 'admin'),
  ('5c050000-0000-4000-8000-0000000000a2', 'operacional');

insert into public.clients (id, name) values
  ('5c05c000-0000-4000-8000-0000000000ca', 'C05 marcador cliente A'),
  ('5c05c000-0000-4000-8000-0000000000cb', 'C05 marcador cliente B'),
  ('5c05c000-0000-4000-8000-0000000000cc', 'C05 marcador cliente C');

insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('5c05d000-0000-4000-8000-00000000000a', '5c05c000-0000-4000-8000-0000000000ca', 'KA do cliente A', 100, 8, 1.5, 10),
  ('5c05d000-0000-4000-8000-00000000000b', '5c05c000-0000-4000-8000-0000000000cb', 'KB do cliente B', 200, 8, 2.0, 10);

insert into public.operations (id, client_id, contract_id, name) values
  ('5c05e000-0000-4000-8000-000000000001', '5c05c000-0000-4000-8000-0000000000ca', '5c05d000-0000-4000-8000-00000000000a', 'C05 base coerente');

-- ---------------------------------------------------------------------------
-- A. A invariante, medida como o PostgREST escreve
-- ---------------------------------------------------------------------------

do $a$
declare
  _ca constant text := '5c05c000-0000-4000-8000-0000000000ca';
  _cb constant text := '5c05c000-0000-4000-8000-0000000000cb';
  _ka constant text := '5c05d000-0000-4000-8000-00000000000a';
  _kb constant text := '5c05d000-0000-4000-8000-00000000000b';
  _r text;
begin
  perform pg_temp.registrar('A1. operação do cliente A com o contrato do cliente A',
    '1', pg_temp.admin(format($q$with i as (insert into public.operations (id, client_id, contract_id, name) values ('5c05e000-0000-4000-8000-000000000011', %L, %L, 'A1') returning 1) select count(*)::text from i$q$, _ca, _ka)));

  perform pg_temp.registrar('A2. operação do cliente A com o contrato do cliente B (INSERT)',
    'erro 23503', pg_temp.admin(format($q$with i as (insert into public.operations (id, client_id, contract_id, name) values ('5c05e000-0000-4000-8000-000000000012', %L, %L, 'A2') returning 1) select count(*)::text from i$q$, _ca, _kb)));

  perform pg_temp.registrar('A2b. a linha recusada não existe',
    '0', (select count(*)::text from public.operations where id = '5c05e000-0000-4000-8000-000000000012'));

  perform pg_temp.registrar('A3. trocar só o cliente da operação (o contrato continua o do cliente A)',
    'erro 23503', pg_temp.admin(format($q$with u as (update public.operations set client_id = %L where id = '5c05e000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$, _cb)));

  perform pg_temp.registrar('A4. trocar o cliente de um contrato JÁ referenciado',
    'erro 23503', pg_temp.admin(format($q$with u as (update public.contracts set client_id = %L where id = %L returning 1) select count(*)::text from u$q$, _cb, _ka)));

  perform pg_temp.registrar('A4b. o contrato continua do cliente A',
    _ca, (select client_id::text from public.contracts where id = _ka::uuid));

  -- A5. sem contrato
  perform pg_temp.registrar('A5. operação sem contrato',
    '1', pg_temp.admin(format($q$with i as (insert into public.operations (id, client_id, contract_id, name, agreed_amount) values ('5c05e000-0000-4000-8000-000000000015', %L, null, 'A5', 500) returning 1) select count(*)::text from i$q$, _ca)));

  perform pg_temp.registrar('A5b. operação sem contrato troca de cliente livremente',
    '1', pg_temp.admin(format($q$with u as (update public.operations set client_id = %L where id = '5c05e000-0000-4000-8000-000000000015' returning 1) select count(*)::text from u$q$, _cb)));

  -- A6. apagar contrato desvincula e preserva o cliente da operação
  insert into public.contracts (id, client_id, name) values ('5c05d000-0000-4000-8000-000000000006', _ca::uuid, 'K6 a apagar');
  insert into public.operations (id, client_id, contract_id, name)
    values ('5c05e000-0000-4000-8000-000000000016', _ca::uuid, '5c05d000-0000-4000-8000-000000000006', 'A6');
  perform pg_temp.registrar('A6. apagar o contrato (admin)',
    '1', pg_temp.admin($q$with d as (delete from public.contracts where id = '5c05d000-0000-4000-8000-000000000006' returning 1) select count(*)::text from d$q$));
  select (contract_id is null)::text || '/' || (client_id = _ca::uuid)::text into _r
    from public.operations where id = '5c05e000-0000-4000-8000-000000000016';
  perform pg_temp.registrar('A6b. contract_id virou NULL e o client_id da operação foi preservado', 'true/true', _r);

  -- A7. troca conjunta
  insert into public.operations (id, client_id, contract_id, name)
    values ('5c05e000-0000-4000-8000-000000000017', _ca::uuid, _ka::uuid, 'A7'),
           ('5c05e000-0000-4000-8000-000000000018', _ca::uuid, _ka::uuid, 'A7b');
  perform pg_temp.registrar('A7. troca conjunta de cliente e contrato para um par válido (um UPDATE)',
    '1', pg_temp.admin(format($q$with u as (update public.operations set client_id = %L, contract_id = %L where id = '5c05e000-0000-4000-8000-000000000017' returning 1) select count(*)::text from u$q$, _cb, _kb)));
  perform pg_temp.registrar('A7b. a mesma troca em dois UPDATEs (cliente primeiro) é recusada: a troca precisa ser conjunta',
    'erro 23503', pg_temp.admin(format($q$with u as (update public.operations set client_id = %L where id = '5c05e000-0000-4000-8000-000000000018' returning 1) select count(*)::text from u$q$, _cb)));

  -- A8. quem não pode escrever continua sem poder
  perform pg_temp.registrar('A8a. sem papel não cria operação',
    'erro 42501', pg_temp.medir_como('authenticated', '5c050000-0000-4000-8000-0000000000a3', 'aal2', 'ec050000-0000-4000-8000-0000000000a3',
      format($q$with i as (insert into public.operations (id, client_id, contract_id, name) values ('5c05e000-0000-4000-8000-000000000021', %L, %L, 'x') returning 1) select count(*)::text from i$q$, _ca, _ka)));
  perform pg_temp.registrar('A8b. operacional (aal2) não cria operação',
    'erro 42501', pg_temp.medir_como('authenticated', '5c050000-0000-4000-8000-0000000000a2', 'aal2', 'ec050000-0000-4000-8000-0000000000a2',
      format($q$with i as (insert into public.operations (id, client_id, contract_id, name) values ('5c05e000-0000-4000-8000-000000000022', %L, %L, 'x') returning 1) select count(*)::text from i$q$, _ca, _ka)));
  perform pg_temp.registrar('A8c. admin em AAL1 não cria operação',
    'erro 42501', pg_temp.medir_como('authenticated', '5c050000-0000-4000-8000-0000000000a1', 'aal1', 'ec050000-0000-4000-8000-0000000000a1',
      format($q$with i as (insert into public.operations (id, client_id, contract_id, name) values ('5c05e000-0000-4000-8000-000000000023', %L, %L, 'x') returning 1) select count(*)::text from i$q$, _ca, _ka)));
  perform pg_temp.registrar('A8d. operacional (aal2) não altera o cliente de um contrato (RLS filtra: 0 linhas)',
    '0', pg_temp.medir_como('authenticated', '5c050000-0000-4000-8000-0000000000a2', 'aal2', 'ec050000-0000-4000-8000-0000000000a2',
      format($q$with u as (update public.contracts set client_id = %L where id = %L returning 1) select count(*)::text from u$q$, _cb, _ka)));
end;
$a$;

-- ---------------------------------------------------------------------------
-- A9. Apontamento faturado: o que já existia continua valendo
-- ---------------------------------------------------------------------------

do $a9$
declare
  _ca constant text := '5c05c000-0000-4000-8000-0000000000ca';
  _cb constant text := '5c05c000-0000-4000-8000-0000000000cb';
  _ka constant text := '5c05d000-0000-4000-8000-00000000000a';
  _antes text; _depois text;
begin
  insert into public.employees (id, name, daily_cost) values ('5c05f000-0000-4000-8000-000000000001', 'C05 colaborador', 60);
  insert into public.operations (id, client_id, contract_id, name)
    values ('5c05e000-0000-4000-8000-000000000091', _ca::uuid, _ka::uuid, 'A9 faturada');
  insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes)
    values ('5c05a000-0000-4000-8000-000000000091', '5c05e000-0000-4000-8000-000000000091', 'T', '06:00', '15:00', 60);
  insert into public.timesheets (id, operation_id, shift_id, work_date)
    values ('5c05b000-0000-4000-8000-000000000091', '5c05e000-0000-4000-8000-000000000091', '5c05a000-0000-4000-8000-000000000091', date '2026-01-15');
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, check_in, check_out, break_minutes)
    values ('5c05b100-0000-4000-8000-000000000091', '5c05b000-0000-4000-8000-000000000091', '5c05f000-0000-4000-8000-000000000001', 'present', '06:00', '17:00', 60);
  insert into public.invoices (id, client_id, period_start, period_end, status)
    values ('5c05b200-0000-4000-8000-000000000091', _ca::uuid, date '2026-01-01', date '2026-01-31', 'closed');
  update public.timesheet_entries set invoice_id = '5c05b200-0000-4000-8000-000000000091'
   where id = '5c05b100-0000-4000-8000-000000000091';

  select billed_amount::text || '/' || daily_rate_snapshot::text into _antes
    from public.timesheet_entries where id = '5c05b100-0000-4000-8000-000000000091';

  perform pg_temp.registrar('A9a. apontamento faturado continua imutável (editar notas)',
    'erro 42501', pg_temp.admin($q$with u as (update public.timesheet_entries set notes = 'x' where id = '5c05b100-0000-4000-8000-000000000091' returning 1) select count(*)::text from u$q$));
  perform pg_temp.registrar('A9b. operação com histórico faturado continua sem trocar de cliente (a proteção anterior age primeiro)',
    'erro 42501', pg_temp.admin(format($q$with u as (update public.operations set client_id = %L, contract_id = null where id = '5c05e000-0000-4000-8000-000000000091' returning 1) select count(*)::text from u$q$, _cb)));
  perform pg_temp.registrar('A9c. contrato usado em apontamento continua sem poder ser apagado',
    'erro 42501', pg_temp.admin(format($q$with d as (delete from public.contracts where id = %L returning 1) select count(*)::text from d$q$, _ka)));
  perform pg_temp.registrar('A9d. a chave nova não bloqueia a edição de taxas (comportamento anterior, fora do escopo da C05-A)',
    '1', pg_temp.admin(format($q$with u as (update public.contracts set daily_rate = 123 where id = %L returning 1) select count(*)::text from u$q$, _ka)));

  select billed_amount::text || '/' || daily_rate_snapshot::text into _depois
    from public.timesheet_entries where id = '5c05b100-0000-4000-8000-000000000091';
  perform pg_temp.registrar('A9e. o valor e a diária gravados no apontamento faturado não mudaram', _antes, _depois);
end;
$a9$;

-- ---------------------------------------------------------------------------
-- G. Dados LEGADOS inválidos. Fabricados aqui: a chave composta é derrubada dentro da
--    transação (estado anterior à migration), a linha inválida é criada, e os comandos
--    da migration são reaplicados.
-- ---------------------------------------------------------------------------

alter table public.operations drop constraint operations_contrato_do_cliente_fkey;

insert into public.operations (id, client_id, contract_id, name) values
  ('5c05e000-0000-4000-8000-0000000000e1', '5c05c000-0000-4000-8000-0000000000ca', '5c05d000-0000-4000-8000-00000000000b', 'LEGADO inválido 1'),
  ('5c05e000-0000-4000-8000-0000000000e2', '5c05c000-0000-4000-8000-0000000000ca', '5c05d000-0000-4000-8000-00000000000b', 'LEGADO inválido 2'),
  ('5c05e000-0000-4000-8000-0000000000e3', '5c05c000-0000-4000-8000-0000000000ca', '5c05d000-0000-4000-8000-00000000000b', 'LEGADO inválido 3');

create temporary table _legado_antes on commit drop as
  select id, md5(o::text) as impressao from public.operations o where name like 'LEGADO inválido%';

-- Os mesmos comandos da migration (cópia fiel).
alter table public.operations
  add constraint operations_contrato_do_cliente_fkey
  foreign key (contract_id, client_id)
  references public.contracts (id, client_id)
  on delete set null (contract_id)
  not valid;

do $validar$
declare
  _inconsistentes bigint;
begin
  select count(*) into _inconsistentes
    from public.operations o
    join public.contracts c on c.id = o.contract_id
   where o.client_id <> c.client_id;

  if _inconsistentes = 0 then
    alter table public.operations
      validate constraint operations_contrato_do_cliente_fkey;
  else
    raise warning
      '021: % operação(ões) com contrato de OUTRO cliente. Nada foi alterado; a constraint operations_contrato_do_cliente_fkey ficou NOT VALID (vale para novas escritas). Corrija cada linha por decisão empresarial e rode VALIDATE CONSTRAINT.',
      _inconsistentes;
  end if;
end;
$validar$;

do $g$
declare
  _ca constant text := '5c05c000-0000-4000-8000-0000000000ca';
  _cc constant text := '5c05c000-0000-4000-8000-0000000000cc';
  _ka constant text := '5c05d000-0000-4000-8000-00000000000a';
  _kb constant text := '5c05d000-0000-4000-8000-00000000000b';
  _estado text;
begin
  perform pg_temp.registrar('G1. com linha legada inválida a constraint NÃO é validada automaticamente (fica NOT VALID)',
    'false', (select convalidated::text from pg_constraint where conname = 'operations_contrato_do_cliente_fkey'));
  perform pg_temp.registrar('G2. a migration não alterou, desvinculou nem apagou nenhuma linha legada',
    '3', (select count(*)::text from public.operations o join _legado_antes a on a.id = o.id and a.impressao = md5(o::text)));
  perform pg_temp.registrar('G3. nova operação inconsistente continua recusada com a constraint NOT VALID',
    'erro 23503', pg_temp.admin(format($q$with i as (insert into public.operations (id, client_id, contract_id, name) values ('5c05e000-0000-4000-8000-0000000000e9', %L, %L, 'x') returning 1) select count(*)::text from i$q$, _ca, _kb)));
  perform pg_temp.registrar('G5. reescrever a linha legada para OUTRO par inválido é recusado',
    'erro 23503', pg_temp.admin(format($q$with u as (update public.operations set client_id = %L where id = '5c05e000-0000-4000-8000-0000000000e2' returning 1) select count(*)::text from u$q$, _cc)));
  perform pg_temp.registrar('G6. a linha legada pode ser corrigida para um par válido (cliente do contrato)',
    '1', pg_temp.admin(format($q$with u as (update public.operations set contract_id = %L where id = '5c05e000-0000-4000-8000-0000000000e2' returning 1) select count(*)::text from u$q$, _ka)));
  begin
    alter table public.operations validate constraint operations_contrato_do_cliente_fkey;
    _estado := 'validada';
  exception when others then
    _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('G7. VALIDATE ainda falha enquanto restar linha legada inválida (a 3ª)', 'erro 23503', _estado);
end;
$g$;

-- ---------------------------------------------------------------------------
-- H. Dados legados válidos: a validação funciona
-- ---------------------------------------------------------------------------

-- Corrige as linhas legadas restantes como `postgres` (decisão empresarial simulada:
-- desvincular), e valida manualmente.
update public.operations o set contract_id = null
  from public.contracts c
 where c.id = o.contract_id and c.client_id <> o.client_id and o.name like 'LEGADO%';

do $h$
declare _estado text;
begin
  begin
    alter table public.operations validate constraint operations_contrato_do_cliente_fkey;
    _estado := 'validada';
  exception when others then
    _estado := 'erro ' || sqlstate;
  end;
  perform pg_temp.registrar('H1. depois de corrigir as linhas legadas, VALIDATE CONSTRAINT funciona', 'validada', _estado);
  perform pg_temp.registrar('H1b. a constraint passou a validada',
    'true', (select convalidated::text from pg_constraint where conname = 'operations_contrato_do_cliente_fkey'));
end;
$h$;

-- Caminho automático da migration com zero inconsistências: derruba e reaplica.
alter table public.operations drop constraint operations_contrato_do_cliente_fkey;
alter table public.operations
  add constraint operations_contrato_do_cliente_fkey
  foreign key (contract_id, client_id)
  references public.contracts (id, client_id)
  on delete set null (contract_id)
  not valid;

do $validar$
declare
  _inconsistentes bigint;
begin
  select count(*) into _inconsistentes
    from public.operations o
    join public.contracts c on c.id = o.contract_id
   where o.client_id <> c.client_id;

  if _inconsistentes = 0 then
    alter table public.operations
      validate constraint operations_contrato_do_cliente_fkey;
  else
    raise warning '021: % operação(ões) com contrato de OUTRO cliente.', _inconsistentes;
  end if;
end;
$validar$;

select pg_temp.registrar('H2. com zero linhas inválidas o bloco da migration valida a constraint sozinho',
  'true', (select convalidated::text from pg_constraint where conname = 'operations_contrato_do_cliente_fkey'));

-- ---------------------------------------------------------------------------
-- I. As mensagens reais do banco (o que a interface recebe e traduz)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('I1. escrita de operação com contrato de outro cliente: SQLSTATE, constraint e mensagem',
  '23503 | operations_contrato_do_cliente_fkey | insert or update on table "operations" violates foreign key constraint "operations_contrato_do_cliente_fkey"',
  pg_temp.erro_de('authenticated', '5c050000-0000-4000-8000-0000000000a1', 'aal2', 'ec050000-0000-4000-8000-0000000000a1',
    $q$insert into public.operations (client_id, contract_id, name) values ('5c05c000-0000-4000-8000-0000000000ca', '5c05d000-0000-4000-8000-00000000000b', 'x')$q$));

select pg_temp.registrar('I2. troca de cliente de um contrato referenciado: SQLSTATE, constraint e mensagem',
  '23503 | operations_contrato_do_cliente_fkey | update or delete on table "contracts" violates foreign key constraint "operations_contrato_do_cliente_fkey" on table "operations"',
  pg_temp.erro_de('authenticated', '5c050000-0000-4000-8000-0000000000a1', 'aal2', 'ec050000-0000-4000-8000-0000000000a1',
    $q$update public.contracts set client_id = '5c05c000-0000-4000-8000-0000000000cb' where id = '5c05d000-0000-4000-8000-00000000000a'$q$));

-- ---------------------------------------------------------------------------
-- J. Apagar cliente (CASCADE) continua funcionando
-- ---------------------------------------------------------------------------

do $j$
begin
  insert into public.clients (id, name) values ('5c05c000-0000-4000-8000-0000000000cd', 'C05 marcador cliente D');
  insert into public.contracts (id, client_id, name) values ('5c05d000-0000-4000-8000-0000000000d1', '5c05c000-0000-4000-8000-0000000000cd', 'KD');
  insert into public.operations (id, client_id, contract_id, name)
    values ('5c05e000-0000-4000-8000-0000000000d1', '5c05c000-0000-4000-8000-0000000000cd', '5c05d000-0000-4000-8000-0000000000d1', 'OD');
  delete from public.clients where id = '5c05c000-0000-4000-8000-0000000000cd';
  perform pg_temp.registrar('J1. apagar um cliente sem fatura leva contratos e operações em cascata (como antes)',
    '0/0/0', (select (select count(*) from public.clients where id = '5c05c000-0000-4000-8000-0000000000cd')::text || '/'
                  || (select count(*) from public.contracts where id = '5c05d000-0000-4000-8000-0000000000d1')::text || '/'
                  || (select count(*) from public.operations where id = '5c05e000-0000-4000-8000-0000000000d1')::text));
exception when others then
  perform pg_temp.registrar('J1. apagar um cliente sem fatura leva contratos e operações em cascata (como antes)', '0/0/0', 'erro ' || sqlstate || ' ' || sqlerrm);
end;
$j$;

-- ---------------------------------------------------------------------------
-- K. Estrutura
-- ---------------------------------------------------------------------------

select pg_temp.registrar('K1. UNIQUE (id, client_id) em contracts',
  '1', (select count(*)::text from pg_constraint where conrelid = 'public.contracts'::regclass and conname = 'contracts_id_client_id_key' and contype = 'u'));

select pg_temp.registrar('K2. chave composta: MATCH SIMPLE, ON DELETE SET NULL só de contract_id, ON UPDATE NO ACTION',
  '1', (select count(*)::text from pg_constraint k
         where k.conname = 'operations_contrato_do_cliente_fkey' and k.confmatchtype = 's' and k.confdeltype = 'n' and k.confupdtype = 'a'
           and k.confdelsetcols = array[(select attnum from pg_attribute where attrelid = 'public.operations'::regclass and attname = 'contract_id')]));

select pg_temp.registrar('K3. a chave original de contract_id permanece',
  '1', (select count(*)::text from pg_constraint where conname = 'operations_contract_id_fkey' and confdeltype = 'n'));

select pg_temp.registrar('K4. contract_id aceita NULL e client_id não',
  'true/false', (select (not a.attnotnull)::text || '/' || (not b.attnotnull)::text
                   from pg_attribute a, pg_attribute b
                  where a.attrelid = 'public.operations'::regclass and a.attname = 'contract_id'
                    and b.attrelid = 'public.operations'::regclass and b.attname = 'client_id'));

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
    raise exception '016_integridade_cliente_contrato: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
