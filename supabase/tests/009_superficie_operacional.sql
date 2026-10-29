-- Superfície operacional AAL1 — `user_operation_access`, helpers e as cinco RPCs.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor, ou execute contra o banco
-- local, e rode de uma vez. Tudo acontece dentro de uma transação que termina
-- em `rollback`: nada é criado, alterado ou removido — inclusive no schema
-- `auth`.
--
-- POR QUE ESTE ARQUIVO TOCA `auth.users`: como o `008`, a fixture precisa de
-- contas reais, porque `auth.mfa_factors` e `public.user_operation_access` têm
-- FK para `auth.users`. Só `id` é obrigatório, então as linhas são mínimas e
-- não carregam e-mail, senha nem qualquer dado pessoal. NUNCA rodar contra
-- Production — o `rollback` protege, mas não há motivo para correr o risco.
--
-- POR QUE O `set local role`: o SQL Editor e o `db query` conectam como
-- `postgres`, dono das tabelas, e nessa sessão a RLS NÃO é aplicada — um teste
-- ingênuo passa em tudo sem provar nada. Cada medição troca para
-- `authenticated` (ou `anon`) e injeta `request.jwt.claims`, de onde
-- `auth.uid()` e `auth.jwt()` leem.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION, DE PROPÓSITO.
--
-- Contra o schema anterior à 013, os casos que chamam as RPCs falham com
-- `erro 42883` ("função não existe") e os de schema/grants falham por ausência
-- da tabela e das funções. Nenhuma expectativa foi invertida para fabricar um
-- PASS.
--
-- O QUE ESTE ARQUIVO NÃO PROVA: que a UI usa a superfície. Não usa — o PR B1
-- entrega só o banco. E não prova que AAL1 foi liberado nas tabelas: não foi, e
-- os casos do bloco H medem exatamente isso.

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
) on commit drop;

-- `security definer` pelo mesmo motivo do 005 e do 008: os blocos rodam sob
-- `set local role authenticated`, que não escreve na temporária do `postgres`.
create or replace function pg_temp.registrar(
  _caso text, _esperado text, _obtido text
) returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido,
          case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;

-- Executa `_sql` (uma consulta de uma coluna) sob o papel e os claims pedidos,
-- devolvendo o resultado como texto ou `erro <sqlstate>`. A troca de papel é
-- revertida mesmo quando a chamada levanta exceção — do contrário a medição
-- seguinte rodaria com o papel errado e mediria outra coisa.
create or replace function pg_temp.medir(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
declare _r text; _papel text; _claims jsonb;
begin
  if _uid is null then
    _claims := jsonb_build_object('role', 'anon');
    _papel  := 'anon';
  else
    _claims := jsonb_build_object('sub', _uid, 'session_id', 'e' || substr(_uid::text, 2), 'role', 'authenticated');
    if _aal is not null then
      _claims := _claims || jsonb_build_object('aal', _aal);
    end if;
    _papel := 'authenticated';
  end if;

  perform set_config('request.jwt.claims', _claims::text, true);
  execute 'set local role ' || _papel;
  begin
    execute _sql into _r;
  exception when others then
    execute 'set local role postgres';
    return 'erro ' || sqlstate;
  end;
  execute 'set local role postgres';
  return coalesce(_r, 'nulo');
end;
$$;

-- Executa SQL SEM trocar de papel, ou seja com `current_user = postgres` — que e
-- exatamente o contexto em que as RPCs SECURITY DEFINER rodam. E o unico jeito
-- de medir quais guardas de 010/011 ainda disparam por dentro da superficie e
-- quais ficam neutralizadas pela isencao de `postgres`.
create or replace function pg_temp.como_postgres(_sql text)
returns text language plpgsql as $$
declare _r text;
begin
  begin
    execute _sql into _r;
  exception when others then
    return 'erro ' || sqlstate;
  end;
  return coalesce(_r, 'nulo');
end;
$$;

-- Executa SQL sob o papel dono das RPCs. Depois da 013 esse papel e
-- `bslog_rpc_operacional`, entao isto reproduz FIELMENTE o contexto de dentro de
-- uma delas: mesmo `current_user`, mesmos privilegios, mesmo BYPASSRLS.
create or replace function pg_temp.como_rpc(_sql text)
returns text language plpgsql as $$
declare _r text;
begin
  execute 'set local role bslog_rpc_operacional';
  begin
    execute _sql into _r;
  exception when others then
    execute 'set local role postgres';
    return 'erro ' || sqlstate;
  end;
  execute 'set local role postgres';
  return coalesce(_r, 'nulo');
end;
$$;

-- Executa SQL como `service_role`, que ignora RLS por definicao: o que decide
-- ali sao as guardas de trigger, nao a policy.
create or replace function pg_temp.como_service_role(_sql text)
returns text language plpgsql as $$
declare _r text;
begin
  execute 'set local role service_role';
  begin
    execute _sql into _r;
  exception when others then
    execute 'set local role postgres';
    return 'erro ' || sqlstate;
  end;
  execute 'set local role postgres';
  return coalesce(_r, 'nulo');
end;
$$;

-- Atalho para a RPC de escrita: devolve `ok` ou `erro <sqlstate>`.
create or replace function pg_temp.salvar(
  _uid text, _aal text, _op text, _turno text, _data text, _linhas jsonb
) returns text language plpgsql as $$
declare _r text;
begin
  _r := pg_temp.medir(_uid, _aal, format(
    'select public.salvar_apontamento_operacional(%L::uuid, %L::uuid, %L::date, %L::jsonb)::text',
    _op, _turno, _data, _linhas::text));
  return case when _r like 'erro %' then _r else 'ok' end;
end;
$$;


-- ---------------------------------------------------------------------------
-- Fixture
--
-- Cinco contas, cada uma num estado de autorização diferente, e duas operações
-- do mesmo cliente — uma atribuída, outra não. É a operação NÃO atribuída que
-- dá sentido à metade dos casos: sem ela, "autorizado" e "existe" se
-- confundem.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('0a000000-0000-4000-8000-000000000001'),  -- operacional, sem MFA      (OP1)
  ('0a000000-0000-4000-8000-000000000002'),  -- operacional, MFA verified (OP2)
  ('0a000000-0000-4000-8000-000000000003'),  -- admin                     (ADM)
  ('0a000000-0000-4000-8000-000000000004'),  -- sem papel                 (SEM)
  ('0a000000-0000-4000-8000-000000000005'),  -- operacional, sera apagado (DEL)
  ('0a000000-0000-4000-8000-000000000006');  -- admin + operacional       (DUP)

-- C02 (migration 020): has_role()/is_staff() só autorizam uma identidade UTILIZÁVEL — conta
-- existente em auth.users, não banida nem excluída, e com a sessão do JWT viva em
-- auth.sessions. Por isso as contas das claims abaixo existem de verdade e cada claim
-- carrega o `session_id` da sessão correspondente (o UUID da conta com o primeiro
-- caractere trocado por 'e'). Não há exceção para fixture sem conta: isso seria
-- reproduzir o comportamento que a migration 020 removeu.
insert into auth.sessions (id, user_id) values
  ('ea000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000002'),
  ('ea000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000003'),
  ('ea000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000004'),
  ('ea000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000005'),
  ('ea000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000006');

insert into auth.mfa_factors
  (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values
  ('0f000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000002',
   'ativo', 'totp', 'verified', now(), now());

-- `profiles` NAO e inserido aqui: o trigger `on_bslog_auth_user_created` ja
-- provisiona uma linha por conta criada em `auth.users`. Inserir de novo
-- colidiria com a PK — e o papel continua sendo atribuicao separada, como o
-- `001` afirma.

insert into public.user_roles (user_id, role) values
  ('0a000000-0000-4000-8000-000000000001', 'operacional'),
  ('0a000000-0000-4000-8000-000000000002', 'operacional'),
  ('0a000000-0000-4000-8000-000000000003', 'admin'),
  ('0a000000-0000-4000-8000-000000000005', 'operacional'),
  ('0a000000-0000-4000-8000-000000000006', 'admin'),
  ('0a000000-0000-4000-8000-000000000006', 'operacional');

insert into public.clients (id, name, doc, phone, email) values
  ('0c000000-0000-4000-8000-000000000001', 'Cliente Alfa', '00.000.000/0001-00',
   '(11) 90000-0000', 'financeiro@alfa.invalid');

insert into public.contracts
  (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from)
values
  ('0d000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   'Contrato Alfa', 150.00, 8, 1.5, 10, '2026-01-01');

insert into public.operations
  (id, client_id, contract_id, name, site, type, operation_date, agreed_amount)
values
  ('0e000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000001', 'Operacao Atribuida', 'Galpao 1',
   'fixed', '2026-09-10', 9999.00),
  ('0e000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000001', 'Operacao Alheia', 'Galpao 2',
   'fixed', '2026-09-10', 7777.00);

insert into public.shifts
  (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
values
  ('0b000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   'Turno A', '08:00', '17:00', 60, false),
  ('0b000000-0000-4000-8000-000000000002', '0e000000-0000-4000-8000-000000000001',
   'Turno B', '18:00', '02:00', 30, true),
  ('0b000000-0000-4000-8000-000000000009', '0e000000-0000-4000-8000-000000000002',
   'Turno Alheio', '08:00', '17:00', 60, false);

insert into public.employees (id, name, role, doc, phone, daily_cost) values
  ('05000000-0000-4000-8000-000000000001', 'Colab Um',     'ajudante', '111', '(11) 1', 90.00),
  ('05000000-0000-4000-8000-000000000002', 'Colab Dois',   'conferente','222', '(11) 2', 100.00),
  ('05000000-0000-4000-8000-000000000003', 'Colab Fora',   'ajudante', '333', '(11) 3', 80.00),
  ('05000000-0000-4000-8000-000000000004', 'Colab Inativo','ajudante', '444', '(11) 4', 70.00);

insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000001', true),
  ('0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000002', true),
  ('0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000004', false);

-- As atribuições. ADM e DUP também recebem a operação de propósito: é o que
-- prova que a recusa deles vem do PAPEL, e não de faltar atribuição.
insert into public.user_operation_access (user_id, operation_id, created_by) values
  ('0a000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000003'),
  ('0a000000-0000-4000-8000-000000000002', '0e000000-0000-4000-8000-000000000001', null),
  ('0a000000-0000-4000-8000-000000000003', '0e000000-0000-4000-8000-000000000001', null),
  ('0a000000-0000-4000-8000-000000000004', '0e000000-0000-4000-8000-000000000001', null),
  ('0a000000-0000-4000-8000-000000000005', '0e000000-0000-4000-8000-000000000001', null),
  ('0a000000-0000-4000-8000-000000000006', '0e000000-0000-4000-8000-000000000001', null);


-- ---------------------------------------------------------------------------
-- A. Quem alcança a superfície, e quem não alcança.
--
-- A primeira linha é a única que deve responder; todas as outras medem uma
-- forma diferente de NÃO ser o operador daquela operação.
-- ---------------------------------------------------------------------------

do $acesso$
declare
  _op  constant text := '0e000000-0000-4000-8000-000000000001';
  _op2 constant text := '0e000000-0000-4000-8000-000000000002';
  _t   constant text := '0b000000-0000-4000-8000-000000000001';
  _sql_ops   constant text := 'select count(*)::text from public.listar_operacoes_do_operador()';
begin
  perform pg_temp.registrar('A1. operacional aal1 sem MFA e atribuido LISTA 1 operacao',
    '1', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1', _sql_ops));

  perform pg_temp.registrar('A2. ... e alcanca os turnos da operacao atribuida',
    '2', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A3. operacao NAO atribuida nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op2)));

  perform pg_temp.registrar('A4. uuid de operacao inexistente nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.listar_turnos_do_operador(''99999999-9999-4999-8999-999999999999''::uuid)'));

  perform pg_temp.registrar('A5. operation_id nulo nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.listar_turnos_do_operador(null::uuid)'));

  perform pg_temp.registrar('A6. operacional COM fator verificado em aal1 nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000002', 'aal1',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  -- A7 e A8 MUDARAM DE RESPOSTA NA MIGRATION 015, e a mudanca e deliberada.
  --
  -- Ate a 014 estes dois casos esperavam 42501, porque a superficie aceitava
  -- SOMENTE aal1. Isso se revelou um defeito na auditoria do PR C: um
  -- operacional que ativa o segundo fator e conclui o TOTP chega em aal2 e era
  -- recusado pela propria superficie — a tela ficava inutil exatamente para
  -- quem seguiu a politica de seguranca. A 015 passou a aceitar o nivel MAIOR
  -- na MESMA superficie estreita, sem ampliar dado nenhum.
  --
  -- A expectativa nao foi invertida para fabricar PASS: o contrato mudou, e o
  -- teste 011 mede a mudanca inteira, inclusive a prova de que
  -- `operador_elegivel_aal1()` continua respondendo exatamente o que respondia.
  perform pg_temp.registrar('A7. operacional com fator verificado em aal2 e aceito (015)',
    '2', pg_temp.medir('0a000000-0000-4000-8000-000000000002', 'aal2',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A8. operacional sem MFA em aal2 tambem e aceito (015)',
    '2', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal2',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A9. sem claim aal nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000001', null,
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  -- A9 pegou um fail-open real na primeira versao da 013: sem o claim `aal` a
  -- cadeia de AND dos helpers devolvia NULL, `IF NOT NULL` nao disparava e a
  -- RPC seguia. A9b cobre a escrita pelo mesmo vetor.
  perform pg_temp.registrar('A9b. sem claim aal a ESCRITA tambem nega',
    'erro 42501', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', null, _op, _t, '2026-09-20',
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb));

  perform pg_temp.registrar('A10. admin em aal1 nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal1',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A11. admin em aal2 nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A12. quem acumula admin+operacional nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000006', 'aal1',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A13. sem papel nega',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000004', 'aal1',
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A14. anon nega',
    'erro 42501', pg_temp.medir(null, null,
      format('select count(*)::text from public.listar_turnos_do_operador(%L::uuid)', _op)));

  perform pg_temp.registrar('A15. anon tambem nao lista operacoes',
    'erro 42501', pg_temp.medir(null, null, _sql_ops));

  perform pg_temp.registrar('A16. turno de OUTRA operacao com operacao atribuida nega',
    'erro 23514', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select count(*)::text from public.listar_equipe_do_operador(%L::uuid, ''0b000000-0000-4000-8000-000000000009''::uuid)', _op)));
end;
$acesso$;


-- ---------------------------------------------------------------------------
-- B. Conta apagada com token ainda válido.
--
-- Mesmo cenário do bloco L do `008`: o PostgREST valida a ASSINATURA do JWT e
-- não consulta o GoTrue a cada requisição, então o token de uma conta apagada
-- continua aceito até expirar. Aqui há uma proteção a mais que no `008` — a FK
-- de `user_operation_access` cascateia —, e o teste confere as duas metades.
-- ---------------------------------------------------------------------------

do $apagado$
declare _antes text; _depois text; _atribuicoes int; _papel int;
begin
  _antes := pg_temp.medir('0a000000-0000-4000-8000-000000000005', 'aal1',
    'select count(*)::text from public.listar_operacoes_do_operador()');
  perform pg_temp.registrar('B1. conta viva, operacional e atribuida LISTA', '1', _antes);

  delete from auth.users where id = '0a000000-0000-4000-8000-000000000005';

  select count(*) into _atribuicoes from public.user_operation_access
   where user_id = '0a000000-0000-4000-8000-000000000005';
  perform pg_temp.registrar('B2. o CASCADE levou a atribuicao', '0', _atribuicoes::text);

  select count(*) into _papel from public.user_roles
   where user_id = '0a000000-0000-4000-8000-000000000005';
  perform pg_temp.registrar('B3. mas o papel ficou orfao, como ja se sabia', '1', _papel::text);

  _depois := pg_temp.medir('0a000000-0000-4000-8000-000000000005', 'aal1',
    'select count(*)::text from public.listar_operacoes_do_operador()');
  perform pg_temp.registrar('B4. conta APAGADA com token vivo nega', 'erro 42501', _depois);
end;
$apagado$;


-- ---------------------------------------------------------------------------
-- C. O contrato das RPCs — o que NÃO atravessa.
--
-- Medido sobre a assinatura declarada, e não sobre uma amostra de dados: uma
-- coluna proibida que aparecesse só em certas linhas escaparia de um teste por
-- amostragem, mas não do `RETURNS TABLE`.
-- ---------------------------------------------------------------------------

do $contrato$
declare
  _r        text;
  _proibido text;
  _fn       text;
  _achados  text := '';
begin
  foreach _fn in array array[
    'listar_operacoes_do_operador',
    'listar_turnos_do_operador',
    'listar_equipe_do_operador',
    'listar_apontamentos_do_operador'
  ] loop
    select pg_get_function_result(p.oid) into _r
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = _fn;

    foreach _proibido in array array[
      'client_id', 'contract_id', 'agreed_amount', 'daily_rate', 'shift_hours',
      'ot_factor', 'ot_tolerance_min', 'daily_cost', 'billed_amount',
      'cost_amount', 'snapshot', 'invoice_id', 'worked_minutes',
      'overtime_minutes', 'doc', 'phone', 'email'
    ] loop
      if coalesce(_r, '') like '%' || _proibido || '%' then
        _achados := _achados || _fn || '.' || _proibido || ' ';
      end if;
    end loop;
  end loop;

  perform pg_temp.registrar(
    'C1. nenhuma coluna proibida na assinatura das 4 RPCs de leitura',
    '(nenhuma)', coalesce(nullif(btrim(_achados), ''), '(nenhuma)'));

  select pg_get_function_result(p.oid) into _r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'listar_operacoes_do_operador';
  perform pg_temp.registrar('C2. operacoes devolve cliente_nome',
    'true', (coalesce(_r, '') like '%cliente_nome text%')::text);

  select pg_get_function_result(p.oid) into _r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'listar_apontamentos_do_operador';
  perform pg_temp.registrar('C3. apontamentos devolve faturado boolean',
    'true', (coalesce(_r, '') like '%faturado boolean%')::text);

  perform pg_temp.registrar('C4. a RPC de escrita nao devolve linha de negocio',
    'uuid', (select pg_get_function_result(p.oid)
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'salvar_apontamento_operacional'));
end;
$contrato$;


-- ---------------------------------------------------------------------------
-- D. Os dados que o operador REALMENTE recebe.
-- ---------------------------------------------------------------------------

do $dados$
declare
  _op constant text := '0e000000-0000-4000-8000-000000000001';
  _t  constant text := '0b000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.registrar('D1. o nome do cliente atravessa',
    'Cliente Alfa', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select cliente_nome from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('D2. e so a operacao atribuida, nao a irma do mesmo cliente',
    'Operacao Atribuida', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select string_agg(name, '', '' order by name) from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('D3. a equipe vem com nome e funcao, inclusive a inativa',
    'Colab Dois:conferente:true|Colab Inativo:ajudante:false|Colab Um:ajudante:true',
    pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select string_agg(employee_name || '':'' || employee_role || '':'' || active::text, ''|'' order by employee_name) from public.listar_equipe_do_operador(%L::uuid, %L::uuid)', _op, _t)));

  perform pg_temp.registrar('D4. turno da operacao vem com a jornada',
    'Turno A:08:00:00:17:00:00:60:false',
    pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select name || '':'' || start_time::text || '':'' || end_time::text || '':'' || break_minutes::text || '':'' || crosses_midnight::text from public.listar_turnos_do_operador(%L::uuid) where name = ''Turno A''', _op)));
end;
$dados$;


-- ---------------------------------------------------------------------------
-- E. Escrita: o que é aceito.
-- ---------------------------------------------------------------------------

do $escrita_ok$
declare
  _op   constant text := '0e000000-0000-4000-8000-000000000001';
  _t    constant text := '0b000000-0000-4000-8000-000000000001';
  _dia  constant text := '2026-09-15';
  _r    text;
  _n    int;
  _vals text;
begin
  _r := pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
    '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","check_in":"08:00","check_out":"18:00","break_minutes":60,"notes":"ok"},
      {"employee_id":"05000000-0000-4000-8000-000000000002","status":"absent"}]'::jsonb);
  perform pg_temp.registrar('E1. campos operacionais validos gravam', 'ok', _r);

  select count(*) into _n
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date;
  perform pg_temp.registrar('E2. as duas linhas existem no banco', '2', _n::text);

  -- A folha foi criada pela propria RPC, com created_by do operador.
  perform pg_temp.registrar('E3. a folha nasceu aberta e com created_by do operador',
    'open|0a000000-0000-4000-8000-000000000001',
    (select t.status::text || '|' || coalesce(t.created_by::text, 'nulo')
       from public.timesheets t
      where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date));

  -- Os valores vieram do trigger da 010, e nao do payload: nove horas
  -- trabalhadas contra oito de jornada, com tolerancia de 10 min, dao 60 min
  -- de extra; 150.00 de diaria + 1h * (150/8 * 1.5) = 178.13.
  select te.billed_amount::text || '|' || te.cost_amount::text || '|' ||
         te.overtime_minutes::text || '|' || te.daily_rate_snapshot::text
    into _vals
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date
     and te.employee_id = '05000000-0000-4000-8000-000000000001';
  perform pg_temp.registrar('E4. a 010 derivou os valores da linha gravada pela RPC',
    '178.13|101.25|60|150.00', _vals);

  -- Falta nao gera valor, e continua sendo a 010 quem decide.
  select te.billed_amount::text || '|' || te.cost_amount::text
    into _vals
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date
     and te.employee_id = '05000000-0000-4000-8000-000000000002';
  perform pg_temp.registrar('E5. falta gravada pela RPC vale zero', '0.00|0.00', _vals);

  -- A chave desnormalizada veio da folha, nao do payload (trigger da 008).
  select te.operation_id::text || '|' || te.work_date::text into _vals
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date
     and te.employee_id = '05000000-0000-4000-8000-000000000001';
  perform pg_temp.registrar('E6. a chave diaria foi sincronizada pela folha',
    _op || '|' || _dia, _vals);

  -- Regravar a mesma folha atualiza a linha existente, sem duplicar.
  _r := pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
    '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60,"notes":"corrigido"}]'::jsonb);
  perform pg_temp.registrar('E7. regravar a mesma linha e aceito', 'ok', _r);

  select count(*) into _n
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date;
  perform pg_temp.registrar('E8. e nao duplicou a linha', '2', _n::text);

  select te.notes || '|' || te.billed_amount::text || '|' || te.overtime_minutes::text
    into _vals
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date
     and te.employee_id = '05000000-0000-4000-8000-000000000001';
  perform pg_temp.registrar('E9. a correcao rederivou o valor, sem hora extra',
    'corrigido|150.00|0', _vals);

  -- A linha que o operador NAO mandou continua onde estava: a RPC nao apaga.
  select count(*) into _n
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date
     and te.employee_id = '05000000-0000-4000-8000-000000000002';
  perform pg_temp.registrar('E10. linha ausente do payload nao e apagada', '1', _n::text);

  -- E a leitura devolve o que foi gravado, com faturado = false.
  perform pg_temp.registrar('E11. a leitura devolve as duas linhas, nao faturadas',
    '2|false',
    pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select count(*)::text || ''|'' || bool_or(faturado)::text from public.listar_apontamentos_do_operador(%L::uuid, %L::uuid, %L::date)', _op, _t, _dia)));
end;
$escrita_ok$;


-- ---------------------------------------------------------------------------
-- F. Escrita: o que é recusado.
--
-- Cada caso mede um vetor diferente de payload hostil ou errado. O `F13`
-- fecha o conjunto: depois de todas as recusas, nada foi gravado.
-- ---------------------------------------------------------------------------

do $escrita_nao$
declare
  _op   constant text := '0e000000-0000-4000-8000-000000000001';
  _op2  constant text := '0e000000-0000-4000-8000-000000000002';
  _t    constant text := '0b000000-0000-4000-8000-000000000001';
  _t2   constant text := '0b000000-0000-4000-8000-000000000009';
  _dia  constant text := '2026-09-16';
  _n    int;
begin
  perform pg_temp.registrar('F1. billed_amount no JSON recusa a chamada',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","billed_amount":9999}]'::jsonb));

  perform pg_temp.registrar('F2. cost_amount no JSON recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","cost_amount":1}]'::jsonb));

  perform pg_temp.registrar('F3. invoice_id no JSON recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","invoice_id":"0c000000-0000-4000-8000-000000000001"}]'::jsonb));

  perform pg_temp.registrar('F4. timesheet_id no JSON recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","timesheet_id":"0c000000-0000-4000-8000-000000000001"}]'::jsonb));

  perform pg_temp.registrar('F5. operation_id no JSON recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      format('[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","operation_id":"%s"}]', _op2)::jsonb));

  perform pg_temp.registrar('F6. snapshot no JSON recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","daily_rate_snapshot":1}]'::jsonb));

  perform pg_temp.registrar('F7. colaborador fora da equipe recusa',
    'erro 23514', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000003","status":"present"}]'::jsonb));

  perform pg_temp.registrar('F8. colaborador INATIVO na equipe recusa',
    'erro 23514', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000004","status":"present"}]'::jsonb));

  perform pg_temp.registrar('F9. turno de outra operacao recusa',
    'erro 23514', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t2, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb));

  perform pg_temp.registrar('F10. operacao nao atribuida recusa',
    'erro 42501', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op2, _t2, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb));

  perform pg_temp.registrar('F11. admin em aal2 nao escreve por esta porta',
    'erro 42501', pg_temp.salvar('0a000000-0000-4000-8000-000000000003', 'aal2', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb));

  perform pg_temp.registrar('F12. status invalido recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"inventado"}]'::jsonb));

  perform pg_temp.registrar('F13. colaborador repetido no mesmo payload recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"},
        {"employee_id":"05000000-0000-4000-8000-000000000001","status":"absent"}]'::jsonb));

  perform pg_temp.registrar('F14. array vazio recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[]'::jsonb));

  perform pg_temp.registrar('F15. payload que nao e array recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}'::jsonb));

  perform pg_temp.registrar('F16. turno nulo recusa',
    'erro 22023', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, null, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb));

  -- Depois de dezesseis recusas, o dia 16 continua sem nenhuma linha E sem
  -- folha: a recusa acontece antes de qualquer escrita, e a transacao da RPC
  -- desfaz ate a folha que ela mesma criou.
  select count(*) into _n from public.timesheets t
   where t.operation_id = _op::uuid and t.work_date = _dia::date;
  perform pg_temp.registrar('F17. nenhuma folha foi criada pelas recusas', '0', _n::text);

  select count(*) into _n from public.timesheet_entries te where te.work_date = _dia::date;
  perform pg_temp.registrar('F18. e nenhuma linha foi gravada', '0', _n::text);
end;
$escrita_nao$;


-- ---------------------------------------------------------------------------
-- G. O lastro faturado continua congelado — as guardas de 010 e 011 valem
--    também para quem entra pela RPC.
--
-- Importa porque, dentro de uma função SECURITY DEFINER de `postgres`,
-- `current_user` é `postgres`, e as guardas que ISENTAM `postgres`
-- (`bloquear_edicao_financeira`, `bloquear_vinculo_fora_do_faturamento`) não
-- disparam. O que protege aqui é o contrato da RPC e a guarda que não isenta
-- ninguém.
-- ---------------------------------------------------------------------------

do $faturado$
declare
  _op  constant text := '0e000000-0000-4000-8000-000000000001';
  _t   constant text := '0b000000-0000-4000-8000-000000000001';
  _dia constant text := '2026-09-15';
  _r   text;
  _antes numeric;
  _depois numeric;
begin
  -- Fatura gerada pelo caminho legitimo: admin em aal2, pela RPC de sempre.
  _r := pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2',
    format('select (public.gerar_fatura(''0c000000-0000-4000-8000-000000000001''::uuid, %L::date, %L::date)).id::text', _dia, _dia));
  perform pg_temp.registrar('G1. admin aal2 gera a fatura normalmente',
    'true', (_r not like 'erro %')::text);

  select te.billed_amount into _antes
    from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000001'
     and te.work_date = _dia::date;

  perform pg_temp.registrar('G2. a linha faturada nao aceita nova gravacao pela RPC',
    'erro 42501', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"absent"}]'::jsonb));

  select te.billed_amount into _depois
    from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000001'
     and te.work_date = _dia::date;
  perform pg_temp.registrar('G3. e o valor faturado nao mudou',
    _antes::text, _depois::text);

  perform pg_temp.registrar('G4. a leitura mostra faturado = true, sem o id da fatura',
    'true', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('select bool_or(faturado)::text from public.listar_apontamentos_do_operador(%L::uuid, %L::uuid, %L::date) where employee_id = ''05000000-0000-4000-8000-000000000001''', _op, _t, _dia)));
end;
$faturado$;


-- ---------------------------------------------------------------------------
-- H. O que o PR B1 NÃO relaxou.
--
-- É o bloco que impede esta migration de virar, por descuido, a liberação de
-- AAL1 que ela promete não ser.
-- ---------------------------------------------------------------------------

do $nao_relaxou$
declare _n int; _folha uuid; _op constant text := '0e000000-0000-4000-8000-000000000001';
begin
  select count(*) into _n
    from pg_policies
   where schemaname = 'public'
     and policyname like '%exige_aal2%'
     and permissive = 'RESTRICTIVE';
  perform pg_temp.registrar('H1. as 15 policies aal2 continuam RESTRICTIVE (AUTH-01B: 9 cotidianas + 6 de escrita estrita de invoices e invoice_items)', '15', _n::text);

  perform pg_temp.registrar('H2. operacional aal1 NAO le operations direto',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.operations'));

  perform pg_temp.registrar('H3. operacional aal1 NAO le employees direto',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.employees'));

  perform pg_temp.registrar('H4. operacional aal1 NAO le contracts direto',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.contracts'));

  perform pg_temp.registrar('H5. operacional aal1 NAO le timesheet_entries direto',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.timesheet_entries'));

  -- A folha e lida aqui como `postgres`, de proposito: sob `authenticated` em
  -- aal1 o SELECT devolveria zero linhas e o INSERT nao chegaria a ser tentado,
  -- medindo a leitura em vez da escrita.
  select t.id into _folha from public.timesheets t where t.work_date = '2026-09-15';

  -- 23503 e nao 42501, e a diferenca e informacao, nao defeito: o trigger
  -- `sincronizar_chave_da_diaria` roda BEFORE INSERT como SECURITY INVOKER,
  -- procura a folha pai sob a RLS do chamador, nao a enxerga em aal1 e recusa
  -- com 23503 antes de o WITH CHECK da policy ser avaliado. A escrita direta
  -- continua fechada; o que muda e qual camada fecha primeiro.
  perform pg_temp.registrar('H6. operacional aal1 NAO escreve timesheet_entries direto',
    'erro 23503', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status) values (%L::uuid, ''05000000-0000-4000-8000-000000000003''::uuid, ''present''::public.attendance_status) returning 1) select count(*)::text from i', _folha)));

  select count(*) into _n from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000003';
  perform pg_temp.registrar('H6b. e nenhuma linha entrou por esse caminho', '0', _n::text);

  perform pg_temp.registrar('H7. operacional aal1 NAO le user_operation_access',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('H8. admin em aal1 NAO le user_operation_access',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal1',
      'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('H9. admin em aal2 LE user_operation_access',
    '5', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2',
      'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('H10. operacional aal1 NAO se atribui uma operacao',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      format('with i as (insert into public.user_operation_access (user_id, operation_id) values (''0a000000-0000-4000-8000-000000000001''::uuid, %L::uuid) returning 1) select count(*)::text from i', '0e000000-0000-4000-8000-000000000002')));

  perform pg_temp.registrar('H11. operacional aal1 NAO apaga a propria atribuicao',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'with d as (delete from public.user_operation_access returning 1) select count(*)::text from d'));

  perform pg_temp.registrar('H12. e a atribuicao continua la',
    '5', (select count(*)::text from public.user_operation_access));

  -- Cobertura POSITIVA: sem ela a tela administrativa do PR B2 nasceria
  -- quebrada e o teste nao teria como perceber — uma policy que nega tudo
  -- passaria em todos os casos negativos acima.
  perform pg_temp.registrar('H13. admin em aal2 ATRIBUI uma operacao',
    '1', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2',
      'with i as (insert into public.user_operation_access (user_id, operation_id, created_by) values (''0a000000-0000-4000-8000-000000000004''::uuid, ''0e000000-0000-4000-8000-000000000002''::uuid, ''0a000000-0000-4000-8000-000000000003''::uuid) returning 1) select count(*)::text from i'));

  perform pg_temp.registrar('H14. e REVOGA a que acabou de criar',
    '1', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2',
      'with d as (delete from public.user_operation_access where operation_id = ''0e000000-0000-4000-8000-000000000002''::uuid returning 1) select count(*)::text from d'));

  perform pg_temp.registrar('H15. admin em aal1 NAO atribui',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal1',
      'with i as (insert into public.user_operation_access (user_id, operation_id) values (''0a000000-0000-4000-8000-000000000004''::uuid, ''0e000000-0000-4000-8000-000000000002''::uuid) returning 1) select count(*)::text from i'));

  perform pg_temp.registrar('H16. operacional aal1 NAO altera a propria atribuicao',
    '0', pg_temp.medir('0a000000-0000-4000-8000-000000000001', 'aal1',
      'with u as (update public.user_operation_access set created_by = null returning 1) select count(*)::text from u'));

  perform pg_temp.registrar('H17. a atribuicao concedida em H13 sumiu com o H14, e o resto ficou',
    '5', (select count(*)::text from public.user_operation_access));
end;
$nao_relaxou$;


-- ---------------------------------------------------------------------------
-- I. Privilégios e forma das funções.
-- ---------------------------------------------------------------------------

do $privilegios$
declare
  _fn      text;
  _args    text;
  _oid     oid;
  _erros   text := '';
  _internas text := '';
begin
  -- As cinco RPCs: EXECUTE so para authenticated.
  foreach _fn in array array[
    'listar_operacoes_do_operador()',
    'listar_turnos_do_operador(uuid)',
    'listar_equipe_do_operador(uuid, uuid)',
    'listar_apontamentos_do_operador(uuid, uuid, date)',
    'salvar_apontamento_operacional(uuid, uuid, date, jsonb)'
  ] loop
    _oid := ('public.' || _fn)::regprocedure::oid;
    if not has_function_privilege('authenticated', _oid, 'EXECUTE') then
      _erros := _erros || _fn || ':authenticated-sem-execute ';
    end if;
    if has_function_privilege('anon', _oid, 'EXECUTE') then
      _erros := _erros || _fn || ':anon ';
    end if;
    if has_function_privilege('public', _oid, 'EXECUTE') then
      _erros := _erros || _fn || ':PUBLIC ';
    end if;
    if has_function_privilege('service_role', _oid, 'EXECUTE') then
      _erros := _erros || _fn || ':service_role ';
    end if;
  end loop;

  perform pg_temp.registrar('I1. as 5 RPCs: execute so para authenticated',
    '(nenhum)', coalesce(nullif(btrim(_erros), ''), '(nenhum)'));

  -- Os helpers sao internos: ninguem da API executa nenhum deles.
  foreach _fn in array array[
    'operador_elegivel_aal1()',
    'operador_autorizado(uuid)',
    'uid_do_operador()',
    'travar_turno_da_operacao(uuid, uuid)',
    'apontamento_faturado(uuid, uuid)'
  ] loop
    _oid := ('public.' || _fn)::regprocedure::oid;
    if has_function_privilege('authenticated', _oid, 'EXECUTE') then
      _internas := _internas || _fn || ':authenticated ';
    end if;
    if has_function_privilege('anon', _oid, 'EXECUTE') then
      _internas := _internas || _fn || ':anon ';
    end if;
    if has_function_privilege('public', _oid, 'EXECUTE') then
      _internas := _internas || _fn || ':PUBLIC ';
    end if;
    if has_function_privilege('service_role', _oid, 'EXECUTE') then
      _internas := _internas || _fn || ':service_role ';
    end if;
  end loop;

  perform pg_temp.registrar('I2. os 5 helpers nao sao executaveis pela API',
    '(nenhum)', coalesce(nullif(btrim(_internas), ''), '(nenhum)'));

  -- SECURITY DEFINER e search_path nas sete. O DONO e conferido no bloco N,
  -- porque agora sao dois grupos: as 5 RPCs pertencem ao papel dedicado e os 4
  -- helpers seguem com postgres.
  _erros := '';
  select string_agg(p.proname || ':' ||
           case when p.prosecdef then 'secdef' else 'INVOKER' end || ':' ||
           coalesce(array_to_string(p.proconfig, ','), '(nenhum)'), ' ' order by p.proname)
    into _erros
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('operador_elegivel_aal1', 'operador_autorizado', 'uid_do_operador',
                       'travar_turno_da_operacao', 'apontamento_faturado',
                       'listar_operacoes_do_operador',
                       'listar_turnos_do_operador', 'listar_equipe_do_operador',
                       'listar_apontamentos_do_operador', 'salvar_apontamento_operacional')
     and not (p.prosecdef
              and pg_get_userbyid(p.proowner) in ('postgres', 'bslog_rpc_operacional')
              and coalesce(array_to_string(p.proconfig, ''), '') = 'search_path=pg_catalog, public');

  perform pg_temp.registrar(
    'I3. as 10 funcoes sao SECURITY DEFINER com search_path fixo',
    '(nenhuma fora do padrao)', coalesce(_erros, '(nenhuma fora do padrao)'));

  -- Volatilidade: leitura STABLE, escrita VOLATILE.
  perform pg_temp.registrar('I4. as 4 leituras sao STABLE', '4',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.provolatile = 's'
        and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                          'listar_equipe_do_operador', 'listar_apontamentos_do_operador')));

  perform pg_temp.registrar('I5. a escrita e VOLATILE', 'v',
    (select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'salvar_apontamento_operacional'));
end;
$privilegios$;


-- ---------------------------------------------------------------------------
-- J. Schema e grants de `user_operation_access`.
-- ---------------------------------------------------------------------------

do $schema$
declare _r text;
begin
  perform pg_temp.registrar('J1. RLS ativa na tabela', 'true',
    (select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'user_operation_access'));

  perform pg_temp.registrar('J2. chave primaria composta', 'user_id, operation_id',
    (select string_agg(a.attname, ', ' order by k.ord)
       from pg_constraint con
       join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      where con.conrelid = 'public.user_operation_access'::regclass
        and con.contype = 'p'));

  perform pg_temp.registrar('J3. indice adicional por operation_id', 'true',
    (select exists (select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'user_operation_access'
         and indexdef like '%(operation_id)%'))::text);

  select string_agg(con.confdeltype::text, '' order by a.attname)
    into _r
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
   where con.conrelid = 'public.user_operation_access'::regclass
     and con.contype = 'f';
  -- created_by -> SET NULL ('n'), operation_id -> CASCADE ('c'), user_id -> CASCADE ('c')
  perform pg_temp.registrar('J4. FKs: created_by SET NULL, operation_id e user_id CASCADE',
    'ncc', _r);

  perform pg_temp.registrar('J5. authenticated tem os quatro verbos, sem TRUNCATE',
    'true|true|true|true|false',
    has_table_privilege('authenticated', 'public.user_operation_access', 'SELECT')::text || '|' ||
    has_table_privilege('authenticated', 'public.user_operation_access', 'INSERT')::text || '|' ||
    has_table_privilege('authenticated', 'public.user_operation_access', 'UPDATE')::text || '|' ||
    has_table_privilege('authenticated', 'public.user_operation_access', 'DELETE')::text || '|' ||
    has_table_privilege('authenticated', 'public.user_operation_access', 'TRUNCATE')::text);

  perform pg_temp.registrar('J6. anon nao tem privilegio nenhum na tabela',
    'false|false|false|false',
    has_table_privilege('anon', 'public.user_operation_access', 'SELECT')::text || '|' ||
    has_table_privilege('anon', 'public.user_operation_access', 'INSERT')::text || '|' ||
    has_table_privilege('anon', 'public.user_operation_access', 'UPDATE')::text || '|' ||
    has_table_privilege('anon', 'public.user_operation_access', 'DELETE')::text);

  perform pg_temp.registrar('J7. service_role tambem nao',
    'false|false|false|false',
    has_table_privilege('service_role', 'public.user_operation_access', 'SELECT')::text || '|' ||
    has_table_privilege('service_role', 'public.user_operation_access', 'INSERT')::text || '|' ||
    has_table_privilege('service_role', 'public.user_operation_access', 'UPDATE')::text || '|' ||
    has_table_privilege('service_role', 'public.user_operation_access', 'DELETE')::text);

  perform pg_temp.registrar('J8. duas policies, uma delas RESTRICTIVE',
    'user_operation_access_admin:PERMISSIVE user_operation_access_somente_admin_aal2:RESTRICTIVE',
    (select string_agg(policyname || ':' || permissive, ' ' order by policyname)
       from pg_policies where schemaname = 'public' and tablename = 'user_operation_access'));

  -- A superficie tem exatamente estas funcoes: nenhuma de exclusao foi criada.
  perform pg_temp.registrar('J9. nao existe RPC de exclusao na superficie', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (p.proname like '%operador%' or p.proname like '%operacional%')
        and (p.proname like 'excluir%' or p.proname like 'apagar%' or p.proname like 'remover%'
             or p.proname like 'delete%')));
end;
$schema$;


-- ---------------------------------------------------------------------------
-- K. O GATE DAS MIGRATIONS 010/011 — o que vale por dentro da superfície.
--
-- POR QUE ESTE BLOCO EXISTE. As guardas de 010 e 011 se dividem em duas
-- famílias: as que perguntam `current_user NOT IN ('postgres','service_role')`
-- e as que não perguntam nada. Enquanto as RPCs pertenciam a `postgres`, a
-- primeira família NÃO disparava sobre a escrita do operador — medido, e é o
-- que motivou o papel dedicado.
--
-- Agora as cinco RPCs pertencem a `bslog_rpc_operacional`. Cada caso abaixo
-- roda sob ESSE papel, que é exatamente o `current_user` de dentro delas, e
-- mede se a proteção se aplica.
--
-- Onde ainda sobrar apenas o contrato da RPC, o caso registra isso
-- explicitamente — não como aprovação, mas como o tripwire que obriga a
-- decisão a ser consciente.
-- ---------------------------------------------------------------------------

do $camada2$
declare
  _op    constant text := '0e000000-0000-4000-8000-000000000001';
  _op2   constant text := '0e000000-0000-4000-8000-000000000002';
  _t     constant text := '0b000000-0000-4000-8000-000000000001';
  _t2    constant text := '0b000000-0000-4000-8000-000000000002';
  _dia   constant text := '2026-09-15';
  _e_fat uuid;
  _e_liv uuid;
  _fatura uuid;
  _folha uuid;
  _folha_vazia uuid;
  _antes numeric;
  _r text;
begin
  select te.id, te.invoice_id, te.billed_amount, te.timesheet_id
    into _e_fat, _fatura, _antes, _folha
    from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000001'
     and te.work_date = _dia::date;

  select te.id into _e_liv
    from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000002'
     and te.work_date = _dia::date;

  -- K1. EDICAO FINANCEIRA. Antes do owner dedicado isto passava sem erro
  -- nenhum, porque `bloquear_edicao_financeira` isenta `postgres`. Agora e
  -- recusado duas vezes: pelo privilegio de coluna, que o papel nao tem, e pela
  -- guarda, que voltou a se aplicar.
  perform pg_temp.registrar('K1. no contexto da RPC, UPDATE de billed_amount e RECUSADO',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set billed_amount = 9999 where id = %L::uuid returning 1) select count(*)::text from u', _e_liv)));

  perform pg_temp.registrar('K2. e o valor continua o derivado', '0.00',
    (select billed_amount::text from public.timesheet_entries where id = _e_liv));

  perform pg_temp.registrar('K3. snapshot idem',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set daily_rate_snapshot = 1 where id = %L::uuid returning 1) select count(*)::text from u', _e_liv)));

  perform pg_temp.registrar('K4. cost_amount idem',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set cost_amount = 1 where id = %L::uuid returning 1) select count(*)::text from u', _e_liv)));

  -- K5. VINCULO DE FATURA — o caso central deste gate. Como `postgres` isto
  -- FUNCIONAVA: `bloquear_vinculo_fora_do_faturamento` exige `postgres` para
  -- vincular e `protect_timesheet_invoice_link` isenta `postgres`. No contexto
  -- da RPC, agora, e recusado — e nao por falta de `invoice_id` no contrato
  -- JSON, mas pelo banco.
  perform pg_temp.registrar('K5. no contexto da RPC, criar vinculo de fatura e RECUSADO',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set invoice_id = %L::uuid where id = %L::uuid returning 1) select count(*)::text from u', _fatura, _e_liv)));

  perform pg_temp.registrar('K5b. e a linha continua sem fatura', 'true',
    (select (invoice_id is null)::text from public.timesheet_entries where id = _e_liv));

  perform pg_temp.registrar('K6. desvincular tambem e recusado',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set invoice_id = null where id = %L::uuid returning 1) select count(*)::text from u', _e_fat)));

  -- K7 a K9. A linha faturada continua imutavel: `bloquear_edicao_faturada`
  -- compara a linha inteira e nunca isentou ninguem.
  perform pg_temp.registrar('K7. editar linha faturada e recusado',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set status = ''absent''::public.attendance_status where id = %L::uuid returning 1) select count(*)::text from u', _e_fat)));

  perform pg_temp.registrar('K8. apagar linha faturada e recusado — e o papel nem tem DELETE',
    'erro 42501', pg_temp.como_rpc(format(
      'with d as (delete from public.timesheet_entries where id = %L::uuid returning 1) select count(*)::text from d', _e_fat)));

  perform pg_temp.registrar('K9. o valor faturado segue intocado',
    _antes::text, (select billed_amount::text from public.timesheet_entries where id = _e_fat));

  -- K10 e K11. Mover folha. A guarda de fontes isenta `postgres`, mas o papel
  -- dedicado nao e isento — e, antes dela, o privilegio de coluna ja recusa:
  -- ele so tem UPDATE em `timesheets(notes)`.
  perform pg_temp.registrar('K10. mover folha COM apontamento e recusado',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheets set operation_id = %L::uuid, shift_id = null where id = %L::uuid returning 1) select count(*)::text from u', _op2, _folha)));

  insert into public.timesheets (operation_id, shift_id, work_date)
  values (_op::uuid, _t2::uuid, '2026-09-19') returning id into _folha_vazia;

  perform pg_temp.registrar('K11. mover folha VAZIA tambem e recusado agora (antes passava)',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheets set operation_id = %L::uuid where id = %L::uuid returning 1) select count(*)::text from u', _op2, _folha_vazia)));

  perform pg_temp.registrar('K12. e reabrir folha fechada tambem, por falta de privilegio na coluna',
    'erro 42501', pg_temp.como_rpc(format(
      'with u as (update public.timesheets set status = ''open''::public.timesheet_status where id = %L::uuid returning 1) select count(*)::text from u', _folha_vazia)));

  delete from public.timesheets where id = _folha_vazia;

  -- K13. Par operacao/turno: invariante estrutural, sem isencao de papel.
  perform pg_temp.registrar('K13. folha com turno de outra operacao e recusada',
    'erro 23514', pg_temp.como_rpc(format(
      'with i as (insert into public.timesheets (operation_id, shift_id, work_date) values (%L::uuid, ''0b000000-0000-4000-8000-000000000009''::uuid, ''2026-09-21'') returning 1) select count(*)::text from i', _op)));

  -- K14. EQUIPE: nao existe invariante de banco nenhuma ligando
  -- `timesheet_entries` a `operation_team` — nem para o admin. A regra e SO da
  -- RPC, e este caso existe para que isso nao se esqueca.
  select t.id into _folha from public.timesheets t
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = _dia::date;

  perform pg_temp.registrar('K14. apontar colaborador FORA da equipe passa no banco (regra e so da RPC)',
    '1', pg_temp.como_rpc(format(
      'with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status) values (%L::uuid, ''05000000-0000-4000-8000-000000000003''::uuid, ''absent''::public.attendance_status) returning 1) select count(*)::text from i', _folha)));

  delete from public.timesheet_entries
   where timesheet_id = _folha and employee_id = '05000000-0000-4000-8000-000000000003';

  -- K15 e K16. Folha fechada: idem — regra da RPC, nao do banco.
  _r := pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, '2026-09-17',
    '[{"employee_id":"05000000-0000-4000-8000-000000000002","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60}]'::jsonb);
  perform pg_temp.registrar('K15a. folha nova do dia 17 gravada pela RPC', 'ok', _r);

  select t.id into _folha_vazia from public.timesheets t
   where t.operation_id = _op::uuid and t.shift_id = _t::uuid and t.work_date = '2026-09-17';
  update public.timesheets set status = 'closed'::public.timesheet_status where id = _folha_vazia;

  perform pg_temp.registrar('K15. a RPC recusa gravar em folha fechada',
    'erro 42501', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t, '2026-09-17',
      '[{"employee_id":"05000000-0000-4000-8000-000000000002","status":"absent"}]'::jsonb));

  perform pg_temp.registrar('K16. desde a 031 o banco sozinho TAMBÉM recusa escrever linha de folha fechada (55000)',
    'erro 55000', pg_temp.como_rpc(format(
      'with u as (update public.timesheet_entries set notes = ''x'' where timesheet_id = %L::uuid returning 1) select count(*)::text from u', _folha_vazia)));

  -- K17 e K18. Indices unicos nao consultam papel nenhum.
  update public.operation_team set active = false
   where operation_id = _op::uuid and shift_id = _t::uuid
     and employee_id = '05000000-0000-4000-8000-000000000001';
  insert into public.operation_team (operation_id, shift_id, employee_id, active)
  values (_op::uuid, _t2::uuid, '05000000-0000-4000-8000-000000000001', true);

  perform pg_temp.registrar('K17. segunda diaria no mesmo dia pela RPC e recusada pelo indice',
    'erro 23505', pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1', _op, _t2, _dia,
      '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","check_in":"18:00","check_out":"02:00"}]'::jsonb));

  perform pg_temp.registrar('K18. segunda alocacao ATIVA do mesmo colaborador e recusada',
    'erro 23505', pg_temp.como_postgres(format(
      'with i as (insert into public.operation_team (operation_id, shift_id, employee_id, active) values (%L::uuid, %L::uuid, ''05000000-0000-4000-8000-000000000001''::uuid, true) returning 1) select count(*)::text from i', _op2, '0b000000-0000-4000-8000-000000000009')));
end;
$camada2$;


-- ---------------------------------------------------------------------------
-- L. `current_user` MEDIDO pelo caminho real da escrita.
--
-- Não é o catálogo dizendo quem é o dono: é um trigger espião instalado sobre
-- `timesheet_entries` durante uma chamada de verdade da RPC, registrando o
-- `current_user` que as guardas de 010/011 enxergam naquele instante. Mesmo
-- método que a 011 usou para provar que dentro de `gerar_fatura` ele era
-- `postgres`.
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, obrigatoriamente: um `security definer` aqui responderia o
-- dono da propria sonda, e nao quem esta escrevendo. E grava num GUC em vez de
-- numa tabela porque o papel das RPCs nao tem — nem deve ter — privilegio de
-- escrita na temporaria do postgres.
create or replace function pg_temp.registrar_current_user()
returns trigger language plpgsql security invoker as $$
begin
  perform set_config('bslog.espiao_current_user', current_user::text, false);
  return new;
end;
$$;

do $espiao$
declare _r text; _quem text;
begin
  create trigger trg_espiao_current_user
    before insert on public.timesheet_entries
    for each row execute function pg_temp.registrar_current_user();

  _r := pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1',
    '0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002',
    '2026-09-23',
    '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present","check_in":"18:00","check_out":"02:00"}]'::jsonb);

  drop trigger trg_espiao_current_user on public.timesheet_entries;

  perform pg_temp.registrar('L1. a gravacao aconteceu', 'ok', _r);

  _quem := nullif(current_setting('bslog.espiao_current_user', true), '');

  perform pg_temp.registrar('L2. current_user MEDIDO dentro da escrita',
    'bslog_rpc_operacional', coalesce(_quem, 'nada registrado'));

  perform pg_temp.registrar('L3. e portanto NAO e postgres nem service_role', 'false',
    (coalesce(_quem, '') in ('postgres', 'service_role'))::text);
end;
$espiao$;


-- ---------------------------------------------------------------------------
-- M. O papel de execução — atributos, membership e privilégios.
-- ---------------------------------------------------------------------------

do $papel$
declare _r record; _erros text := '';
begin
  select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
         rolbypassrls, rolinherit
    into _r
    from pg_roles where rolname = 'bslog_rpc_operacional';

  perform pg_temp.registrar('M1. NOLOGIN', 'false', _r.rolcanlogin::text);
  perform pg_temp.registrar('M2. NOSUPERUSER', 'false', _r.rolsuper::text);
  perform pg_temp.registrar('M3. NOCREATEDB', 'false', _r.rolcreatedb::text);
  perform pg_temp.registrar('M4. NOCREATEROLE', 'false', _r.rolcreaterole::text);
  perform pg_temp.registrar('M5. NOREPLICATION', 'false', _r.rolreplication::text);
  perform pg_temp.registrar('M6. NOINHERIT', 'false', _r.rolinherit::text);
  perform pg_temp.registrar('M7. BYPASSRLS, o unico atributo forte', 'true', _r.rolbypassrls::text);

  perform pg_temp.registrar('M8. nao e membro de anon/authenticated/service_role', 'false|false|false',
    pg_has_role('bslog_rpc_operacional', 'anon', 'USAGE')::text || '|' ||
    pg_has_role('bslog_rpc_operacional', 'authenticated', 'USAGE')::text || '|' ||
    pg_has_role('bslog_rpc_operacional', 'service_role', 'USAGE')::text);

  perform pg_temp.registrar('M9. e nenhum papel da API e membro dele', 'false|false|false',
    pg_has_role('anon', 'bslog_rpc_operacional', 'USAGE')::text || '|' ||
    pg_has_role('authenticated', 'bslog_rpc_operacional', 'USAGE')::text || '|' ||
    pg_has_role('service_role', 'bslog_rpc_operacional', 'USAGE')::text);

  -- Privilegios de tabela: o inventario completo, em uma linha.
  perform pg_temp.registrar('M10. sem DELETE nas tabelas que a RPC escreve', 'false|false',
    has_table_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'DELETE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.timesheets', 'DELETE')::text);

  perform pg_temp.registrar('M11. sem TRUNCATE em lugar nenhum', 'false|false|false',
    has_table_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'TRUNCATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.timesheets', 'TRUNCATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.operations', 'TRUNCATE')::text);

  perform pg_temp.registrar('M12. sem escrita nas tabelas administrativas',
    'false|false|false|false|false',
    has_table_privilege('bslog_rpc_operacional', 'public.operations', 'UPDATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.shifts', 'UPDATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.employees', 'UPDATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.clients', 'UPDATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.user_operation_access', 'UPDATE')::text);

  perform pg_temp.registrar('M13. sem acesso nenhum a invoices e invoice_items',
    'false|false|false|false',
    has_table_privilege('bslog_rpc_operacional', 'public.invoices', 'SELECT')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.invoices', 'UPDATE')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.invoice_items', 'SELECT')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.contracts', 'SELECT')::text);

  perform pg_temp.registrar('M14. sem leitura de user_roles e de profiles', 'false|false',
    has_table_privilege('bslog_rpc_operacional', 'public.user_roles', 'SELECT')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'public.profiles', 'SELECT')::text);

  -- Privilegio por COLUNA: e isto que torna estrutural a proibicao de escrever
  -- valor financeiro ou vinculo de fatura.
  perform pg_temp.registrar('M15. NENHUM privilegio em invoice_id', 'false|false',
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'invoice_id', 'INSERT')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'invoice_id', 'UPDATE')::text);

  perform pg_temp.registrar('M16. NENHUM privilegio nas colunas financeiras',
    'false|false|false|false|false',
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'billed_amount', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'cost_amount', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'daily_rate_snapshot', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'ot_hour_rate_snapshot', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'daily_cost_snapshot', 'UPDATE')::text);

  perform pg_temp.registrar('M17. e as seis colunas operacionais ele TEM',
    'true|true|true|true|true|true',
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'employee_id', 'INSERT')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'status', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'check_in', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'check_out', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'break_minutes', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'notes', 'UPDATE')::text);

  -- Em `timesheets` e `shifts` o unico UPDATE e `updated_at`, e existe so para
  -- satisfazer o privilegio que o PostgreSQL cobra para travar linha com
  -- FOR SHARE. Nenhuma coluna de negocio esta ao alcance.
  perform pg_temp.registrar('M18. em timesheets: INSERT das 4 colunas e UPDATE so de updated_at',
    'true|true|false|false|false|false',
    has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'operation_id', 'INSERT')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'updated_at', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'status', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'work_date', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'notes', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'operation_id', 'UPDATE')::text);

  perform pg_temp.registrar('M18b. em shifts: nenhum INSERT e UPDATE so de updated_at',
    'false|true|false|false|false',
    has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'name', 'INSERT')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'updated_at', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'start_time', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'end_time', 'UPDATE')::text || '|' ||
    has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'break_minutes', 'UPDATE')::text);

  -- Nenhuma TABELA do schema auth: a identidade vem de `uid_do_operador()`.
  perform pg_temp.registrar('M19. sem SELECT em auth.users e auth.mfa_factors', 'false|false',
    has_table_privilege('bslog_rpc_operacional', 'auth.users', 'SELECT')::text || '|' ||
    has_table_privilege('bslog_rpc_operacional', 'auth.mfa_factors', 'SELECT')::text);

  -- ZERO dependencia do schema `auth`. Production nao concede USAGE ali, e o
  -- desenho nao precisa: identidade e autorizacao vem dos helpers de postgres.
  perform pg_temp.registrar('M20. SEM usage no schema auth', 'false',
    has_schema_privilege('bslog_rpc_operacional', 'auth', 'USAGE')::text);

  -- O privilegio de EXECUTE em `auth.uid()` chega por PUBLIC e por isso o
  -- catalogo responde `true` para qualquer papel — a pergunta util e outra: o
  -- papel CONSEGUE chamar? Sem USAGE no schema, nao consegue, e e isso que se
  -- mede. Comportamento, nao ACL.
  perform pg_temp.registrar('M21. na pratica o papel NAO alcanca auth.uid()',
    'erro 42501', pg_temp.como_rpc('select auth.uid()::text'));

  perform pg_temp.registrar('M21b. nem le auth.users', 'erro 42501',
    pg_temp.como_rpc('select count(*)::text from auth.users'));

  perform pg_temp.registrar('M22. nem EXECUTE em has_role', 'false',
    has_function_privilege('bslog_rpc_operacional',
      'public.has_role(uuid, public.app_role)', 'EXECUTE')::text);
end;
$papel$;


-- ---------------------------------------------------------------------------
-- N. Donos e execução das sete funções.
-- ---------------------------------------------------------------------------

do $donos$
declare _r text;
begin
  select string_agg(p.proname || '=' || pg_get_userbyid(p.proowner), ' ' order by p.proname)
    into _r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                       'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                       'salvar_apontamento_operacional');
  perform pg_temp.registrar('N1. as 5 RPCs pertencem ao papel dedicado',
    'listar_apontamentos_do_operador=bslog_rpc_operacional listar_equipe_do_operador=bslog_rpc_operacional listar_operacoes_do_operador=bslog_rpc_operacional listar_turnos_do_operador=bslog_rpc_operacional salvar_apontamento_operacional=bslog_rpc_operacional',
    _r);

  select string_agg(p.proname || '=' || pg_get_userbyid(p.proowner), ' ' order by p.proname)
    into _r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('operador_elegivel_aal1', 'operador_autorizado',
                       'uid_do_operador', 'travar_turno_da_operacao',
                       'apontamento_faturado');
  perform pg_temp.registrar('N2. os 5 helpers seguem com postgres',
    'apontamento_faturado=postgres operador_autorizado=postgres operador_elegivel_aal1=postgres travar_turno_da_operacao=postgres uid_do_operador=postgres',
    _r);

  -- Nenhum helper escreve: a justificativa do owner postgres depende disso.
  select coalesce(string_agg(p.proname, ' '), '(nenhum)') into _r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('operador_elegivel_aal1', 'operador_autorizado',
                       'uid_do_operador', 'travar_turno_da_operacao',
                       'apontamento_faturado')
     and (p.prosrc ~* '(insert|update|delete|truncate)\s');
  perform pg_temp.registrar('N3. nenhum helper de postgres contem comando de escrita',
    '(nenhum)', _r);
end;
$donos$;


-- ---------------------------------------------------------------------------
-- O. A aposentadoria do trigger legado `protect_timesheet_invoice_link`.
--
-- Ele saiu porque forçava qualquer papel que escrevesse apontamento a ter
-- `USAGE` no schema `auth` — privilégio que Production não concede —, e porque
-- não protegia mais nada: o conjunto de quem ele permitia sempre continha o de
-- quem a 011 permite.
--
-- Este bloco exercita as QUATRO transições de `invoice_id`, para os dois papéis
-- que o legado isentava e a 011 não isenta. Se a remoção tivesse afrouxado
-- alguma coisa, é aqui que apareceria.
-- ---------------------------------------------------------------------------

do $legado$
declare
  _dia constant text := '2026-09-15';
  _e_fat uuid; _e_liv uuid; _fatura uuid; _folha uuid;
begin
  perform pg_temp.registrar('O1. a funcao legada nao existe mais', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'protect_timesheet_invoice_link'));

  perform pg_temp.registrar('O2. e o trigger dela tambem nao', '0',
    (select count(*)::text from pg_trigger
      where tgname = 'trg_timesheet_entries_protect_invoice_link'));

  perform pg_temp.registrar('O3. as guardas da 011 continuam todas la', '4',
    (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'timesheet_entries' and not t.tgisinternal
        and t.tgname in ('trg_timesheet_entries_bloqueia_vinculo_direto',
                         'trg_timesheet_entries_bloqueia_desvinculo',
                         'trg_timesheet_entries_bloqueia_edicao_faturada',
                         'trg_timesheet_entries_bloqueia_delete_faturado')));

  select te.id, te.invoice_id, te.timesheet_id into _e_fat, _fatura, _folha
    from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000001'
     and te.work_date = _dia::date;

  select te.id into _e_liv
    from public.timesheet_entries te
   where te.employee_id = '05000000-0000-4000-8000-000000000002'
     and te.work_date = _dia::date;

  -- ADMIN em aal2 — o papel que o legado ISENTAVA. As quatro transicoes.
  perform pg_temp.registrar('O4. admin aal2: UPDATE NULL -> fatura e recusado',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2', format(
      'with u as (update public.timesheet_entries set invoice_id = %L::uuid where id = %L::uuid returning 1) select count(*)::text from u', _fatura, _e_liv)));

  perform pg_temp.registrar('O5. admin aal2: UPDATE fatura -> NULL e recusado',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2', format(
      'with u as (update public.timesheet_entries set invoice_id = null where id = %L::uuid returning 1) select count(*)::text from u', _e_fat)));

  perform pg_temp.registrar('O6. admin aal2: INSERT ja com vinculo e recusado',
    'erro 42501', pg_temp.medir('0a000000-0000-4000-8000-000000000003', 'aal2', format(
      'with i as (insert into public.timesheet_entries (timesheet_id, employee_id, status, invoice_id) values (%L::uuid, ''05000000-0000-4000-8000-000000000003''::uuid, ''present''::public.attendance_status, %L::uuid) returning 1) select count(*)::text from i', _folha, _fatura)));

  -- SERVICE_ROLE — o outro papel que o legado isentava. Ela ignora RLS por
  -- definicao, entao aqui e a guarda que decide, e nao a policy.
  perform pg_temp.registrar('O7. service_role: UPDATE NULL -> fatura e recusado',
    'erro 42501', pg_temp.como_service_role(format(
      'with u as (update public.timesheet_entries set invoice_id = %L::uuid where id = %L::uuid returning 1) select count(*)::text from u', _fatura, _e_liv)));

  perform pg_temp.registrar('O8. service_role: UPDATE fatura -> NULL e recusado',
    'erro 42501', pg_temp.como_service_role(format(
      'with u as (update public.timesheet_entries set invoice_id = null where id = %L::uuid returning 1) select count(*)::text from u', _e_fat)));

  perform pg_temp.registrar('O9. e o vinculo original continua exatamente onde estava',
    _fatura::text, (select invoice_id::text from public.timesheet_entries where id = _e_fat));

  perform pg_temp.registrar('O10. a linha livre continua livre', 'true',
    (select (invoice_id is null)::text from public.timesheet_entries where id = _e_liv));
end;
$legado$;


-- ---------------------------------------------------------------------------
-- P. Leitura por COLUNA — o papel não enxerga dinheiro.
--
-- `GRANT SELECT ON TABLE` daria ao dono das RPCs a tabela inteira: `daily_cost`,
-- `agreed_amount`, `billed_amount`, `cost_amount`, os três snapshots e
-- `invoice_id`. As RPCs não devolvem nada disso — mas "o código não usa" não é
-- proteção, e era assim que estava até esta rodada. Agora o SELECT é por coluna.
--
-- Cada caso aparece duas vezes, de propósito: o que o CATÁLOGO diz, e o que
-- acontece quando o papel TENTA. Metadado sozinho não prova acesso negado.
-- ---------------------------------------------------------------------------

do $colunas$
declare _erros text := '';
  _t constant text := 'public.timesheet_entries';
begin
  -- 1. O catálogo, para as colunas que precisam estar fechadas.
  if has_column_privilege('bslog_rpc_operacional', _t, 'invoice_id', 'SELECT')            then _erros := _erros || 'invoice_id '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'billed_amount', 'SELECT')         then _erros := _erros || 'billed_amount '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'cost_amount', 'SELECT')           then _erros := _erros || 'cost_amount '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'daily_rate_snapshot', 'SELECT')   then _erros := _erros || 'daily_rate_snapshot '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'ot_hour_rate_snapshot', 'SELECT') then _erros := _erros || 'ot_hour_rate_snapshot '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'daily_cost_snapshot', 'SELECT')   then _erros := _erros || 'daily_cost_snapshot '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'worked_minutes', 'SELECT')        then _erros := _erros || 'worked_minutes '; end if;
  if has_column_privilege('bslog_rpc_operacional', _t, 'overtime_minutes', 'SELECT')      then _erros := _erros || 'overtime_minutes '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.employees', 'daily_cost', 'SELECT')    then _erros := _erros || 'employees.daily_cost '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.employees', 'doc', 'SELECT')           then _erros := _erros || 'employees.doc '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.employees', 'phone', 'SELECT')         then _erros := _erros || 'employees.phone '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.operations', 'agreed_amount', 'SELECT') then _erros := _erros || 'operations.agreed_amount '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.operations', 'contract_id', 'SELECT')   then _erros := _erros || 'operations.contract_id '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.clients', 'doc', 'SELECT')              then _erros := _erros || 'clients.doc '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.clients', 'phone', 'SELECT')            then _erros := _erros || 'clients.phone '; end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.clients', 'email', 'SELECT')            then _erros := _erros || 'clients.email '; end if;
  if has_table_privilege('bslog_rpc_operacional', 'public.contracts', 'SELECT')                    then _erros := _erros || 'contracts '; end if;

  perform pg_temp.registrar('P1. nenhuma coluna financeira ou sensivel e legivel pelo papel',
    '(nenhuma)', coalesce(nullif(btrim(_erros), ''), '(nenhuma)'));

  -- 2. E as que a superficie precisa continuam legiveis.
  _erros := '';
  if not has_column_privilege('bslog_rpc_operacional', _t, 'status', 'SELECT')        then _erros := _erros || 'entries.status '; end if;
  if not has_column_privilege('bslog_rpc_operacional', _t, 'check_in', 'SELECT')      then _erros := _erros || 'entries.check_in '; end if;
  if not has_column_privilege('bslog_rpc_operacional', _t, 'notes', 'SELECT')         then _erros := _erros || 'entries.notes '; end if;
  if not has_column_privilege('bslog_rpc_operacional', 'public.employees', 'name', 'SELECT')      then _erros := _erros || 'employees.name '; end if;
  if not has_column_privilege('bslog_rpc_operacional', 'public.clients', 'name', 'SELECT')        then _erros := _erros || 'clients.name '; end if;
  if not has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'start_time', 'SELECT')   then _erros := _erros || 'shifts.start_time '; end if;
  if not has_column_privilege('bslog_rpc_operacional', 'public.timesheets', 'work_date', 'SELECT') then _erros := _erros || 'timesheets.work_date '; end if;

  perform pg_temp.registrar('P2. e as colunas operacionais continuam legiveis',
    '(nenhuma faltando)', coalesce(nullif(btrim(_erros), ''), '(nenhuma faltando)'));
end;
$colunas$;

do $comportamento$
begin
  -- 3. O que acontece quando o papel TENTA ler. Comportamento, nao metadado.
  perform pg_temp.registrar('P3. o papel NAO le employees.daily_cost', 'erro 42501',
    pg_temp.como_rpc('select daily_cost::text from public.employees limit 1'));

  perform pg_temp.registrar('P4. NAO le operations.agreed_amount', 'erro 42501',
    pg_temp.como_rpc('select agreed_amount::text from public.operations limit 1'));

  perform pg_temp.registrar('P5. NAO le timesheet_entries.billed_amount', 'erro 42501',
    pg_temp.como_rpc('select billed_amount::text from public.timesheet_entries limit 1'));

  perform pg_temp.registrar('P6. NAO le timesheet_entries.cost_amount', 'erro 42501',
    pg_temp.como_rpc('select cost_amount::text from public.timesheet_entries limit 1'));

  perform pg_temp.registrar('P7. NAO le timesheet_entries.invoice_id', 'erro 42501',
    pg_temp.como_rpc('select invoice_id::text from public.timesheet_entries limit 1'));

  perform pg_temp.registrar('P8. NAO le os snapshots', 'erro 42501',
    pg_temp.como_rpc('select daily_rate_snapshot::text from public.timesheet_entries limit 1'));

  perform pg_temp.registrar('P9. NAO le contracts', 'erro 42501',
    pg_temp.como_rpc('select daily_rate::text from public.contracts limit 1'));

  perform pg_temp.registrar('P10. NAO le documento nem telefone do colaborador', 'erro 42501',
    pg_temp.como_rpc('select doc from public.employees limit 1'));

  perform pg_temp.registrar('P11. NAO le documento do cliente', 'erro 42501',
    pg_temp.como_rpc('select doc from public.clients limit 1'));

  perform pg_temp.registrar('P12. nem `select *`, que alcancaria tudo', 'erro 42501',
    pg_temp.como_rpc('select (t.*)::text from public.timesheet_entries t limit 1'));

  -- 4. E o que ele precisa ler, le.
  perform pg_temp.registrar('P13. mas LE o nome do colaborador', 'Colab Um',
    pg_temp.como_rpc('select name from public.employees where id = ''05000000-0000-4000-8000-000000000001''::uuid'));

  perform pg_temp.registrar('P14. e o nome do cliente', 'Cliente Alfa',
    pg_temp.como_rpc('select name from public.clients limit 1'));
end;
$comportamento$;


-- ---------------------------------------------------------------------------
-- Q. A folha validada fica travada até o fim da gravação.
--
-- Levantado na review do Codex no PR #26. Sem `FOR SHARE` nas duas buscas da
-- folha, existia janela entre validar e gravar: sob READ COMMITTED um admin
-- podia COMMITAR `status = 'closed'` — e a linha entraria numa folha fechada,
-- porque a verificação já tinha passado sobre o valor velho — ou, com a folha
-- ainda vazia, mover `operation_id`, e a linha nasceria numa operação para a
-- qual o operador nunca foi autorizado, com os valores derivados do contrato
-- dela.
--
-- Concorrência de verdade precisa de duas sessões, e este arquivo roda numa só.
-- O que dá para guardar aqui é a FORMA LITERAL — as duas buscas terminando em
-- `FOR SHARE` —, no mesmo espírito das suítes de auth que asseveram a forma do
-- código e não só o comportamento. A demonstração com duas conexões (a segunda
-- bloqueando em `lock_timeout`) está registrada no PR.
-- ---------------------------------------------------------------------------

do $trava$
declare _src text; _travadas int; _sem_trava int;
begin
  select p.prosrc into _src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'salvar_apontamento_operacional';

  -- Quantas buscas da folha terminam travando a linha.
  select count(*) into _travadas
    from regexp_matches(_src, 'work_date\s*=\s*p_work_date\s*FOR SHARE', 'g');

  perform pg_temp.registrar('Q1. as DUAS buscas da folha travam a linha com FOR SHARE',
    '2', _travadas::text);

  -- E nenhuma ficou para trás.
  select count(*) into _sem_trava
    from regexp_matches(_src, 'work_date\s*=\s*p_work_date\s*;', 'g');

  perform pg_temp.registrar('Q2. e nenhuma busca da folha ficou sem trava',
    '0', _sem_trava::text);

  -- A trava do turno continua fora da RPC, no helper de postgres, para nao
  -- exigir UPDATE em `shifts` do papel de execucao.
  select p.prosrc into _src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travar_turno_da_operacao';

  perform pg_temp.registrar('Q3. o turno segue travado dentro do helper', 'true',
    (_src like '%FOR SHARE%')::text);

  -- E a gravacao continua funcionando com as travas no lugar: o papel tem
  -- UPDATE(updated_at) em `timesheets`, que e o privilegio que o PostgreSQL
  -- cobra para travar linha.
  perform pg_temp.registrar('Q4. a RPC grava normalmente com as travas', 'ok',
    pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1',
      '0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
      '2026-09-25',
      '[{"employee_id":"05000000-0000-4000-8000-000000000002","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60}]'::jsonb));
end;
$trava$;


-- ---------------------------------------------------------------------------
-- R. O privilégio de schema do papel de execução — e a janela de `CREATE`.
--
-- POR QUE ESTE BLOCO EXISTE. A primeira tentativa de aplicar a 013 em Production
-- falhou com `42501 / permission denied for schema public`, no primeiro dos
-- cinco `ALTER FUNCTION ... OWNER TO`: o PostgreSQL exige que o NOVO DONO tenha
-- `CREATE` no schema onde o objeto vive, porque transferir a posse equivale a
-- ele criar o objeto ali. O rollback desfez tudo e Production ficou intacta.
--
-- O harness local não pegou porque nele as migrations rodam como um `postgres`
-- SUPERUSUÁRIO, e superusuário pula a verificação. O `postgres` do Supabase não
-- é superusuário. Reproduzido depois com executor não-superusuário: sem
-- `CREATE`, recusa com 42501; com ele, passa.
--
-- A correção concede `CREATE` imediatamente antes das cinco trocas e o revoga
-- imediatamente depois. O que este bloco guarda é o ESTADO FINAL — a janela não
-- pode sobreviver à migration.
-- ---------------------------------------------------------------------------

do $schema_papel$
declare _src text; _grants int; _revokes int;
begin
  perform pg_temp.registrar('R1. USAGE no schema public', 'true',
    has_schema_privilege('bslog_rpc_operacional', 'public', 'USAGE')::text);

  perform pg_temp.registrar('R2. CREATE no schema public NAO sobrou', 'false',
    has_schema_privilege('bslog_rpc_operacional', 'public', 'CREATE')::text);

  perform pg_temp.registrar('R3. e nada no schema auth', 'false',
    has_schema_privilege('bslog_rpc_operacional', 'auth', 'USAGE')::text);

  -- O papel nao consegue criar objeto em public, que e o que CREATE significa.
  perform pg_temp.registrar('R4. na pratica, o papel NAO cria objeto em public',
    'erro 42501', pg_temp.como_rpc('create table public._sonda_r4 (id int)'));

  perform pg_temp.registrar('R5. e nenhuma tabela sonda ficou para tras', '0',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = '_sonda_r4'));

  -- As 5 RPCs chegaram ao dono certo — que e o que a janela existia para
  -- permitir. Se a janela sumisse sem a transferencia, isto cairia.
  perform pg_temp.registrar('R6. as 5 RPCs pertencem ao papel dedicado', '5',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'bslog_rpc_operacional'
        and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                          'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                          'salvar_apontamento_operacional')));

  perform pg_temp.registrar('R7. e as 5 continuam SECURITY DEFINER', '5',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and pg_get_userbyid(p.proowner) = 'bslog_rpc_operacional'
        and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                          'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                          'salvar_apontamento_operacional')));

  -- E a gravacao continua funcionando depois da transferencia.
  perform pg_temp.registrar('R8. a RPC de escrita segue operando', 'ok',
    pg_temp.salvar('0a000000-0000-4000-8000-000000000001', 'aal1',
      '0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
      '2026-09-27',
      '[{"employee_id":"05000000-0000-4000-8000-000000000002","status":"present","check_in":"08:00","check_out":"17:00","break_minutes":60}]'::jsonb));
end;
$schema_papel$;


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
    raise exception '009_superficie_operacional: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
