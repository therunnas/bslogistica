-- Enforcement de AAL2 na camada de autorização do banco.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor do Supabase e execute de uma
-- vez. Tudo acontece dentro de uma transação que termina em `rollback`, então
-- nenhum dado é criado, alterado ou removido.
--
-- POR QUE O `set local role`: o SQL Editor conecta como `postgres`, dono das
-- tabelas, e nessa sessão a RLS **não é aplicada** — um teste ingênuo passa em
-- tudo sem provar nada. Cada bloco troca para `authenticated` e injeta
-- `request.jwt.claims`, de onde `auth.uid()` e `auth.jwt()` leem.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION, DE PROPÓSITO.
--
-- Ele afirma o comportamento SEGURO: sessão em aal1 não acessa dado de negócio.
-- Rodando contra o schema anterior à migration 009, os casos AAL1 FALHAM — e é
-- essa falha que documenta o buraco. Nenhuma expectativa foi invertida para
-- fabricar um PASS.
--
-- O relatório acumula todos os casos numa tabela temporária antes de levantar
-- exceção, para que a execução de baseline mostre a lista inteira do que está
-- desprotegido, e não apenas o primeiro caso.

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
) on commit drop;

-- `security definer` porque os blocos rodam sob `set local role authenticated`,
-- e esse papel não tem privilégio de escrita na tabela temporária, que pertence
-- ao `postgres`. A função grava o resultado como dona; isso não afeta o que
-- está sendo medido, já que as consultas de negócio acontecem fora dela.
create or replace function pg_temp.registrar(
  _caso text, _esperado text, _obtido text
) returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido,
          case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;


-- ---------------------------------------------------------------------------
-- Cenário mínimo. Mesmos UUIDs do 002, para leitura cruzada.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, email) values
  ('11111111-1111-4111-8111-111111111111', 'Admin de Teste',  'admin@example.invalid'),
  ('88888888-8888-4888-8888-888888888888', 'Operacional',     'operacional@example.invalid');

insert into public.user_roles (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('88888888-8888-4888-8888-888888888888', 'operacional');

-- C02 (migration 020): has_role()/is_staff() só autorizam uma identidade UTILIZÁVEL — conta
-- existente em auth.users, não banida nem excluída, e com a sessão do JWT viva em
-- auth.sessions. Por isso as contas das claims abaixo existem de verdade e cada claim
-- carrega o `session_id` da sessão correspondente (o UUID da conta com o primeiro
-- caractere trocado por 'e'). Não há exceção para fixture sem conta: isso seria
-- reproduzir o comportamento que a migration 020 removeu.
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('88888888-8888-4888-8888-888888888888')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id) values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('e8888888-8888-4888-8888-888888888888', '88888888-8888-4888-8888-888888888888');

-- Dois clientes: o principal sustenta operação, folha e apontamentos; o
-- descartável existe só para os DELETE de teste.
--
-- Isso é necessário porque no schema anterior à 009 os comandos destrutivos em
-- aal1 REALMENTE funcionam — é o buraco que este arquivo documenta. Se eles
-- mirassem o cliente principal, o ON DELETE CASCADE levaria junto operações,
-- folhas e apontamentos, e os blocos seguintes falhariam por falta de fixture
-- em vez de falharem pelo que pretendem medir.
insert into public.clients (id, name) values
  ('33333333-3333-4333-8333-333333333333', 'Cliente de Teste'),
  ('33333333-3333-4333-8333-33333333333d', 'Cliente Descartavel');

insert into public.contracts (id, client_id, name, daily_rate) values
  ('33333333-3333-4333-8333-333333333334', '33333333-3333-4333-8333-333333333333',
   'Contrato de Teste', 200);

insert into public.operations (id, client_id, name) values
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Operação de Teste');

-- Quatro colaboradores: o índice único permite uma diária faturável por
-- colaborador/operação/data, então cada apontamento de teste precisa do seu.
insert into public.employees (id, name, daily_cost) values
  ('55555555-5555-4555-8555-555555555555', 'Colaborador de Teste', 100),
  ('55555555-5555-4555-8555-555555555556', 'Colaborador Dois',     100),
  ('55555555-5555-4555-8555-555555555557', 'Colaborador Tres',     100),
  ('55555555-5555-4555-8555-555555555558', 'Colaborador Quatro',   100);

insert into public.invoices (id, client_id, period_start, period_end) values
  ('99999999-9999-4999-8999-999999999991', '33333333-3333-4333-8333-333333333333', current_date, current_date);

insert into public.timesheets (id, operation_id, work_date) values
  ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', current_date);

-- O apontamento principal precisa sobreviver até o fim: é ele que torna
-- `gerar_fatura` elegível nos casos K e L. O descartável existe para o DELETE
-- em aal1, que no baseline realmente apaga.
insert into public.timesheet_entries (id, timesheet_id, employee_id, billed_amount, cost_amount, daily_rate_snapshot) values
  ('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666',
   '55555555-5555-4555-8555-555555555555', 250.00, 100.00, 200.00),
  ('77777777-7777-4777-8777-77777777777c', '66666666-6666-4666-8666-666666666666',
   '55555555-5555-4555-8555-555555555557', 250.00, 100.00, 200.00);


-- ---------------------------------------------------------------------------
-- A, E, H. ADMIN EM AAL1 — não pode ler nada de negócio.
-- ---------------------------------------------------------------------------
-- SELECT barrado pela RLS não levanta erro: a cláusula USING apenas remove as
-- linhas do conjunto. Por isso os casos de leitura conferem contagem.

do $admin_aal1$
declare
  _n bigint;
  _afetadas integer;
  _bloqueou boolean;
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';

  select count(*) into _n from public.clients;
  perform pg_temp.registrar('A. admin aal1 SELECT clients', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.employees;
  perform pg_temp.registrar('A2. admin aal1 SELECT employees', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.contracts;
  perform pg_temp.registrar('A3. admin aal1 SELECT contracts', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.operations;
  perform pg_temp.registrar('A4. admin aal1 SELECT operations', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.timesheets;
  perform pg_temp.registrar('A5. admin aal1 SELECT timesheets', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.operation_team;
  perform pg_temp.registrar('A6. admin aal1 SELECT operation_team', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.invoices;
  perform pg_temp.registrar('E. admin aal1 SELECT invoices', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.invoice_items;
  perform pg_temp.registrar('E2. admin aal1 SELECT invoice_items', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.profiles;
  perform pg_temp.registrar('H. admin aal1 SELECT profiles', '0 linhas', _n || ' linhas');

  -- INSERT barrado pela RLS levanta 42501.
  _bloqueou := false;
  begin
    insert into public.clients (name) values ('Inserido em aal1');
  exception when others then _bloqueou := true; _estado := sqlstate;
  end;
  perform pg_temp.registrar('A7. admin aal1 INSERT clients [' || coalesce(_estado,'-') || ']', 'bloqueado', case when _bloqueou then 'bloqueado' else 'PASSOU' end);

  update public.clients set notes = 'editado em aal1'
   where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('A8. admin aal1 UPDATE clients', '0 linhas', _afetadas || ' linhas');

  delete from public.clients where id = '33333333-3333-4333-8333-33333333333d';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('A9. admin aal1 DELETE clients', '0 linhas', _afetadas || ' linhas');

  update public.invoices set total_amount = 999999
   where id = '99999999-9999-4999-8999-999999999991';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('E3. admin aal1 UPDATE invoices', '0 linhas', _afetadas || ' linhas');

  update public.profiles set full_name = 'alterado em aal1'
   where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('H2. admin aal1 UPDATE profiles', '0 linhas', _afetadas || ' linhas');
end
$admin_aal1$;


-- ---------------------------------------------------------------------------
-- B, F, I. ADMIN EM AAL2 — o comportamento atual precisa ser preservado.
-- ---------------------------------------------------------------------------

do $admin_aal2$
declare
  _n bigint;
  _afetadas integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  select count(*) into _n from public.clients;
  perform pg_temp.registrar('B. admin aal2 SELECT clients', 've linhas', case when _n > 0 then 've linhas' else 've 0' end);

  select count(*) into _n from public.employees;
  perform pg_temp.registrar('B2. admin aal2 SELECT employees', 've linhas', case when _n > 0 then 've linhas' else 've 0' end);

  select count(*) into _n from public.invoices;
  perform pg_temp.registrar('F. admin aal2 SELECT invoices', 've linhas', case when _n > 0 then 've linhas' else 've 0' end);

  select count(*) into _n from public.profiles;
  perform pg_temp.registrar('I. admin aal2 SELECT profiles', 've linhas', case when _n > 0 then 've linhas' else 've 0' end);

  insert into public.clients (id, name) values
    ('33333333-3333-4333-8333-33333333333a', 'Inserido em aal2');
  perform pg_temp.registrar('B3. admin aal2 INSERT clients', 'inseriu', 'inseriu');

  update public.clients set notes = 'editado em aal2'
   where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('B4. admin aal2 UPDATE clients', '1 linha', _afetadas || ' linha');

  delete from public.clients where id = '33333333-3333-4333-8333-33333333333a';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('B5. admin aal2 DELETE clients', '1 linha', _afetadas || ' linha');

  update public.profiles set full_name = 'Admin de Teste'
   where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('I2. admin aal2 UPDATE profiles proprio', '1 linha', _afetadas || ' linha');
exception when others then
  perform pg_temp.registrar('B/F/I. admin aal2 caminho feliz', 'sem erro',
                            'erro ' || sqlstate || ': ' || sqlerrm);
end
$admin_aal2$;


-- ---------------------------------------------------------------------------
-- C. OPERACIONAL EM AAL1 — não escreve apontamento.
-- ---------------------------------------------------------------------------

do $oper_aal1$
declare
  _n bigint;
  _afetadas integer;
  _bloqueou boolean;
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';

  select count(*) into _n from public.timesheet_entries;
  perform pg_temp.registrar('C. operacional aal1 SELECT timesheet_entries', '0 linhas', _n || ' linhas');

  _bloqueou := false;
  begin
    insert into public.timesheet_entries (id, timesheet_id, employee_id, notes)
    values ('77777777-7777-4777-8777-77777777777a',
            '66666666-6666-4666-8666-666666666666',
            '55555555-5555-4555-8555-555555555556', 'criado em aal1');
  exception when others then _bloqueou := true; _estado := sqlstate;
  end;
  perform pg_temp.registrar('C2. operacional aal1 INSERT timesheet_entries [' || coalesce(_estado,'-') || ']', 'bloqueado',
                            case when _bloqueou then 'bloqueado' else 'PASSOU' end);

  update public.timesheet_entries set notes = 'editado em aal1'
   where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('C3. operacional aal1 UPDATE timesheet_entries', '0 linhas', _afetadas || ' linhas');

  delete from public.timesheet_entries where id = '77777777-7777-4777-8777-77777777777c';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('C4. operacional aal1 DELETE timesheet_entries', '0 linhas', _afetadas || ' linhas');
end
$oper_aal1$;


-- ---------------------------------------------------------------------------
-- D. OPERACIONAL EM AAL2 — barrado por FALTA DE ADMIN, não por AAL.
--
-- CONTRATO ATUALIZADO PELA MIGRATION 016. Antes dela este bloco media o
-- oposto — que em aal2 o operador escrevia apontamento direto —, e aquilo não
-- vinha do papel: vinha da permissiva por `public.is_staff()`, verdadeira para
-- qualquer papel atribuído. A `016` acrescentou uma RESTRICTIVE por tabela
-- exigindo `admin`, e acesso direto passou a ser `aal2` E `admin`.
--
-- O ponto desta suíte continua o mesmo: medir o enforcement de **garantia**
-- somado ao de **autorização**. O bloco C, logo acima, prova que em aal1 ele é
-- barrado pelo AAL; este prova que em aal2, com o AAL satisfeito, ele continua
-- barrado — agora pelo papel. Os dois juntos são a diferença entre "falta
-- segundo fator" e "não é administrador".
--
-- O caminho legítimo do operador é a superfície de RPC da `013`/`015`, medida
-- em `009`, `011` e `012`. Nenhuma linha dela passa por policy.
-- ---------------------------------------------------------------------------

do $oper_aal2$
declare
  _n bigint;
  _afetadas integer;
  _bloqueou boolean;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  select count(*) into _n from public.timesheet_entries;
  perform pg_temp.registrar('D. operacional aal2 SELECT timesheet_entries', 've 0',
                            case when _n > 0 then 've linhas' else 've 0' end);

  -- INSERT sobe 42501 pela WITH CHECK da RESTRICTIVE; UPDATE e DELETE não
  -- levantam, simplesmente não encontram linha. São recusas de formas
  -- diferentes, e as duas contam.
  _bloqueou := false;
  begin
    insert into public.timesheet_entries (id, timesheet_id, employee_id, notes)
    values ('77777777-7777-4777-8777-77777777777b',
            '66666666-6666-4666-8666-666666666666',
            '55555555-5555-4555-8555-555555555558', 'criado em aal2');
  exception when others then _bloqueou := true;
  end;
  perform pg_temp.registrar('D2. operacional aal2 INSERT timesheet_entries', 'recusado',
                            case when _bloqueou then 'recusado' else 'inseriu' end);

  update public.timesheet_entries set notes = 'editado em aal2'
   where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('D3. operacional aal2 UPDATE timesheet_entries', '0 linhas', _afetadas || ' linhas');

  delete from public.timesheet_entries where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  perform pg_temp.registrar('D4. operacional aal2 DELETE timesheet_entries', '0 linhas', _afetadas || ' linhas');

  -- E o que distingue esta recusa da do bloco C: aqui o AAL está satisfeito.
  -- Quem barra é o papel.
  perform pg_temp.registrar('D5. o aal do operador em aal2 e aal2 mesmo', 'aal2',
                            coalesce(auth.jwt() ->> 'aal', 'sem claim'));
  perform pg_temp.registrar('D6. e ele nao e admin', 'false',
                            public.has_role(auth.uid(), 'admin'::public.app_role)::text);
exception when others then
  perform pg_temp.registrar('D. operacional aal2 caminho medido', 'sem erro inesperado',
                            'erro ' || sqlstate || ': ' || sqlerrm);
end
$oper_aal2$;


-- ---------------------------------------------------------------------------
-- G. CLAIM aal AUSENTE — fail closed.
-- ---------------------------------------------------------------------------
-- Este é o caso que justifica a comparação por igualdade: `NULL = 'aal2'` é
-- NULL, e a RLS trata NULL como não-permitido.

do $sem_aal$
declare
  _n bigint;
  _bloqueou boolean;
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into _n from public.clients;
  perform pg_temp.registrar('G. sem claim aal SELECT clients', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.timesheet_entries;
  perform pg_temp.registrar('G2. sem claim aal SELECT timesheet_entries', '0 linhas', _n || ' linhas');

  select count(*) into _n from public.profiles;
  perform pg_temp.registrar('G3. sem claim aal SELECT profiles', '0 linhas', _n || ' linhas');

  _bloqueou := false;
  begin
    insert into public.clients (name) values ('Inserido sem aal');
  exception when others then _bloqueou := true; _estado := sqlstate;
  end;
  perform pg_temp.registrar('G4. sem claim aal INSERT clients [' || coalesce(_estado,'-') || ']', 'bloqueado',
                            case when _bloqueou then 'bloqueado' else 'PASSOU' end);
end
$sem_aal$;


-- ---------------------------------------------------------------------------
-- J. user_roles EM AAL1 — precisa continuar legível.
-- ---------------------------------------------------------------------------
-- Esta é a exceção deliberada do enforcement. `_autorizacao.ts` lê o papel
-- ainda em aal1, antes de encaminhar ao MFA; bloquear aqui criaria um impasse
-- em que seria preciso aal2 para chegar à tela que concede aal2.

do $roles_aal1$
declare
  _n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';

  select count(*) into _n from public.user_roles;
  perform pg_temp.registrar('J. admin aal1 SELECT user_roles (propria linha)', '1 linha', _n || ' linha');

  -- e continua vendo só a própria linha, como antes
  select count(*) into _n from public.user_roles
   where user_id <> '11111111-1111-4111-8111-111111111111';
  perform pg_temp.registrar('J2. admin aal1 nao ve papel alheio', '0 linhas', _n || ' linhas');
end
$roles_aal1$;


-- ---------------------------------------------------------------------------
-- K, L. gerar_fatura — SECURITY DEFINER roda acima da RLS.
-- ---------------------------------------------------------------------------
-- As policies acima não alcançam o interior da função. Sem a verificação
-- explícita dentro dela, um admin em aal1 gera fatura normalmente.

do $fatura_aal1$
declare
  _estado text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.gerar_fatura(
      '33333333-3333-4333-8333-333333333333'::uuid, current_date - 1, current_date + 1);
    _estado := 'gerou a fatura';
  exception
    when insufficient_privilege then _estado := '42501';
    when others then _estado := sqlstate;
  end;

  perform pg_temp.registrar('K. gerar_fatura admin aal1', '42501', _estado);
end
$fatura_aal1$;

do $fatura_aal2$
declare
  _estado text;
  _fatura public.invoices;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    _fatura := public.gerar_fatura(
      '33333333-3333-4333-8333-333333333333'::uuid, current_date - 1, current_date + 1);
    _estado := case when _fatura.id is not null then 'gerou a fatura' else 'retorno vazio' end;
  exception when others then _estado := 'erro ' || sqlstate || ': ' || sqlerrm;
  end;

  perform pg_temp.registrar('L. gerar_fatura admin aal2', 'gerou a fatura', _estado);
end
$fatura_aal2$;


-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

do $reset$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $reset$;

select ordem, caso, esperado, obtido, situacao from _resultado order by ordem;

do $veredito$
declare
  _falhas bigint;
  _linha record;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';

  if _falhas > 0 then
    for _linha in select caso, esperado, obtido from _resultado where situacao = 'FAIL' order by ordem loop
      raise notice 'FAIL  %  — esperado: %, obtido: %', _linha.caso, _linha.esperado, _linha.obtido;
    end loop;
    raise exception '% caso(s) falharam. Antes da migration 009 isto e o BASELINE VULNERAVEL esperado; depois dela, e regressao.', _falhas;
  end if;

  raise notice 'ENFORCEMENT AAL2: PASS em todos os casos';
end
$veredito$;

rollback;
