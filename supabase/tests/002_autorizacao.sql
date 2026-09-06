-- Regressão de autorização: RLS, papéis e proteção do financeiro.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor do Supabase e execute de uma
-- vez. Tudo acontece dentro de uma transação que termina em `rollback`, então
-- nenhum dado de produção é criado, alterado ou removido. Se algum controle
-- falhar, o bloco correspondente levanta exceção com a mensagem do teste — e a
-- exceção também garante o rollback.
--
-- POR QUE O `set local role`: o SQL Editor conecta como `postgres`, que é dono
-- das tabelas e tem `relforcerowsecurity = false`. Nessa sessão a RLS **não é
-- aplicada**, e um teste ingênuo passa em tudo sem provar nada. Cada bloco
-- abaixo troca para o papel `authenticated` e injeta `request.jwt.claims`, que
-- é de onde `auth.uid()` lê o usuário. `set local` dentro de um bloco `do` é
-- revertido quando o bloco termina, então os cenários não vazam um para o outro.

begin;

-- ---------------------------------------------------------------------------
-- Cenário: dois usuários e um mínimo de dados de negócio.
-- ---------------------------------------------------------------------------
-- UUIDs fixos e reconhecíveis. `profiles` e `user_roles` não têm FK para
-- auth.users, então não é preciso criar conta de verdade para o teste.

insert into public.profiles (id, full_name, email) values
  ('11111111-1111-4111-8111-111111111111', 'Admin de Teste',  'admin@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'Sem Papel',       'sempapel@example.invalid');

insert into public.user_roles (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin');

insert into public.clients (id, name) values
  ('33333333-3333-4333-8333-333333333333', 'Cliente de Teste');

insert into public.operations (id, client_id, name) values
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Operação de Teste');

insert into public.employees (id, name, daily_cost) values
  ('55555555-5555-4555-8555-555555555555', 'Colaborador de Teste', 100);

insert into public.timesheets (id, operation_id, work_date) values
  ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', current_date);

insert into public.timesheet_entries (id, timesheet_id, employee_id, billed_amount, cost_amount) values
  ('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666',
   '55555555-5555-4555-8555-555555555555', 250.00, 100.00);


-- ---------------------------------------------------------------------------
-- 1. ADMIN — o caminho feliz precisa continuar funcionando.
-- ---------------------------------------------------------------------------

do $admin$
declare
  _n bigint;
  _afetadas integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'ADMIN: has_role devolveu falso para o admin';
  end if;

  select count(*) into _n from public.clients;
  if _n = 0 then raise exception 'ADMIN SELECT: admin não enxerga clientes'; end if;

  insert into public.clients (name) values ('Inserido pelo admin');

  update public.clients set notes = 'editado' where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 1 then raise exception 'ADMIN UPDATE: afetou % linhas, esperado 1', _afetadas; end if;

  delete from public.clients where name = 'Inserido pelo admin';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 1 then raise exception 'ADMIN DELETE: afetou % linhas, esperado 1', _afetadas; end if;

  raise notice 'ADMIN: PASS (select, insert, update, delete)';
end
$admin$;


-- ---------------------------------------------------------------------------
-- 2. AUTENTICADO SEM PAPEL — não lê e não escreve nada.
-- ---------------------------------------------------------------------------
-- UPDATE e DELETE barrados pela RLS **não levantam erro**: a cláusula USING
-- remove a linha do conjunto alvo e o comando termina afetando zero linhas. Por
-- isso o teste confere `row_count`, e não a ausência de exceção.

do $sempapel$
declare
  _n bigint;
  _afetadas integer;
  _bloqueou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if public.is_staff() then raise exception 'SEM PAPEL: is_staff devolveu verdadeiro'; end if;

  select count(*) into _n from public.clients;
  if _n <> 0 then raise exception 'SEM PAPEL SELECT clients: viu % linhas', _n; end if;
  select count(*) into _n from public.employees;
  if _n <> 0 then raise exception 'SEM PAPEL SELECT employees: viu % linhas', _n; end if;
  select count(*) into _n from public.timesheet_entries;
  if _n <> 0 then raise exception 'SEM PAPEL SELECT timesheet_entries: viu % linhas', _n; end if;
  select count(*) into _n from public.invoices;
  if _n <> 0 then raise exception 'SEM PAPEL SELECT invoices: viu % linhas', _n; end if;

  _bloqueou := false;
  begin
    insert into public.clients (name) values ('Não deveria entrar');
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'SEM PAPEL INSERT: conseguiu inserir cliente'; end if;

  update public.clients set name = 'sequestrado' where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'SEM PAPEL UPDATE: afetou % linhas', _afetadas; end if;

  delete from public.clients where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'SEM PAPEL DELETE: afetou % linhas', _afetadas; end if;

  raise notice 'SEM PAPEL: PASS (select vazio, insert/update/delete sem efeito)';
end
$sempapel$;


-- ---------------------------------------------------------------------------
-- 3. ANON — nenhum acesso a dado de negócio.
-- ---------------------------------------------------------------------------
-- Todas as policies são `to authenticated`; para `anon` não existe policy
-- alguma, e sem policy a RLS nega por padrão.

do $anon$
declare
  _n bigint;
  _negou boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';

  _negou := false;
  begin
    select count(*) into _n from public.clients;
    if _n <> 0 then raise exception 'ANON SELECT clients: viu % linhas', _n; end if;
    _negou := true;
  exception when insufficient_privilege then _negou := true;
  end;
  if not _negou then raise exception 'ANON: acesso a clients não foi negado'; end if;

  _negou := false;
  begin
    select count(*) into _n from public.timesheet_entries;
    if _n <> 0 then raise exception 'ANON SELECT timesheet_entries: viu % linhas', _n; end if;
    _negou := true;
  exception when insufficient_privilege then _negou := true;
  end;
  if not _negou then raise exception 'ANON: acesso a timesheet_entries não foi negado'; end if;

  raise notice 'ANON: PASS (nenhum dado de negócio)';
end
$anon$;


-- ---------------------------------------------------------------------------
-- 4. USER_ROLES — sem escrita, sem autoelevação.
-- ---------------------------------------------------------------------------
-- O bloqueio aqui é da RLS, não do GRANT. Medido no banco em 06/09/2026:
-- `authenticated` tem INSERT, UPDATE e DELETE em user_roles, herdados do
-- `GRANT ALL` das default privileges do Supabase — o GRANT explícito da
-- 20260903173204 concede só `select`, mas soma-se ao default em vez de
-- substituí-lo. Quem barra é a policy: só existe `user_roles_select_own`.
--
-- Daí duas semânticas diferentes, e é por isso que os testes abaixo não são
-- simétricos: o INSERT viola o WITH CHECK e levanta 42501; o UPDATE e o DELETE
-- não têm policy, o USING não casa nenhuma linha, e o comando termina afetando
-- zero linhas **sem erro nenhum**.

do $papeis$
declare
  _n bigint;
  _bloqueou boolean;
  _afetadas integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- só enxerga as próprias linhas: o usuário sem papel não tem nenhuma
  select count(*) into _n from public.user_roles;
  if _n <> 0 then raise exception 'USER_ROLES SELECT: viu % linhas alheias', _n; end if;

  _bloqueou := false;
  begin
    insert into public.user_roles (user_id, role)
      values ('22222222-2222-4222-8222-222222222222', 'admin');
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'AUTOELEVAÇÃO: conseguiu se conceder admin'; end if;

  update public.user_roles set user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'USER_ROLES UPDATE: afetou % linhas', _afetadas; end if;

  delete from public.user_roles;
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'USER_ROLES DELETE: afetou % linhas', _afetadas; end if;

  raise notice 'USER_ROLES: PASS (sem insert, update, delete ou autoelevação)';
end
$papeis$;


-- ---------------------------------------------------------------------------
-- 5. FINANCEIRO — quem não é autorizado não mexe em valor nem em vínculo.
-- ---------------------------------------------------------------------------

do $financeiro$
declare
  _afetadas integer;
  _billed numeric;
  _cost numeric;
  _invoice uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.timesheet_entries
     set billed_amount = 999999, cost_amount = 0, invoice_id = gen_random_uuid()
   where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'FINANCEIRO: usuário sem papel afetou % linhas', _afetadas; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  select billed_amount, cost_amount, invoice_id into _billed, _cost, _invoice
    from public.timesheet_entries where id = '77777777-7777-4777-8777-777777777777';

  if _billed <> 250.00 then raise exception 'FINANCEIRO: billed_amount virou %', _billed; end if;
  if _cost   <> 100.00 then raise exception 'FINANCEIRO: cost_amount virou %', _cost; end if;
  if _invoice is not null then raise exception 'FINANCEIRO: invoice_id virou %', _invoice; end if;

  raise notice 'FINANCEIRO: PASS (billed_amount, cost_amount e invoice_id intactos)';
end
$financeiro$;


-- ---------------------------------------------------------------------------
-- 6. gerar_fatura — continua admin-only.
-- ---------------------------------------------------------------------------
-- A função é SECURITY DEFINER: roda acima da RLS, então a autorização tem de
-- ser explícita dentro dela. O teste confere que ela recusa quem não é admin.

do $fatura$
declare
  _bloqueou boolean;
  _msg text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  _bloqueou := false;
  begin
    perform public.gerar_fatura(
      '33333333-3333-4333-8333-333333333333'::uuid,
      current_date - 1,
      current_date + 1
    );
  exception
    when insufficient_privilege then _bloqueou := true; _msg := sqlerrm;
    when others then raise exception 'GERAR_FATURA: erro inesperado (%): %', sqlstate, sqlerrm;
  end;

  if not _bloqueou then raise exception 'GERAR_FATURA: usuário sem papel conseguiu gerar fatura'; end if;

  raise notice 'GERAR_FATURA: PASS (recusou não-admin com 42501: %)', _msg;
end
$fatura$;


-- ---------------------------------------------------------------------------
-- 7. SEC-011 e SEC-009 — privilégios depois da migration 007.
-- ---------------------------------------------------------------------------
-- Roda como `postgres`, porque é leitura de catálogo, não teste de RLS.

do $grants$
declare
  _acl text;
  _n bigint;
begin
  execute 'reset role';

  for _acl in
    select coalesce(array_to_string(p.proacl, ' ~ '), 'NULO')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('is_staff', 'update_updated_at_column')
  loop
    if _acl = 'NULO' then
      raise exception 'SEC-011: ACL nula significa EXECUTE para PUBLIC';
    end if;
    -- um aclitem cujo grantee é vazio antes do "=" é o grant a PUBLIC
    if _acl ~ '(^|~ )=' then
      raise exception 'SEC-011: PUBLIC ainda tem privilégio (acl: %)', _acl;
    end if;
    if _acl like '%anon=%' then
      raise exception 'SEC-011: anon ainda tem privilégio (acl: %)', _acl;
    end if;
  end loop;

  select count(*) into _n
    from information_schema.role_table_grants
   where table_schema = 'public' and privilege_type = 'TRUNCATE'
     and grantee in ('anon', 'authenticated');
  if _n <> 0 then
    raise exception 'SEC-009: ainda existem % grants de TRUNCATE para anon/authenticated', _n;
  end if;

  raise notice 'SEC-011 e SEC-009: PASS (sem EXECUTE para PUBLIC/anon, sem TRUNCATE para anon/authenticated)';
end
$grants$;


select 'TODOS OS TESTES DE AUTORIZAÇÃO PASSARAM' as resultado;

rollback;
