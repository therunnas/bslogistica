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
--
-- POR QUE O CLAIM `aal: aal2`: desde a migration 009 as tabelas de negócio têm
-- uma policy RESTRICTIVE que exige segundo fator. Cada cenário aqui representa
-- um usuário que já concluiu o login completo, então o claim é acrescentado
-- para que os testes continuem medindo o que sempre mediram — papel e
-- privilégio. Sem ele, tudo seria negado pelo AAL e as asserções passariam
-- pelo motivo errado, mascarando regressão de papel. O enforcement de AAL2 em
-- si é verificado em 005_enforcement_aal2.sql. O bloco `anon` não recebe o
-- claim: para `anon` não existe policy alguma.

begin;

-- ---------------------------------------------------------------------------
-- Cenário: três usuários e um mínimo de dados de negócio.
-- ---------------------------------------------------------------------------
-- UUIDs fixos e reconhecíveis. `profiles` e `user_roles` não têm FK para
-- auth.users, então não é preciso criar conta de verdade para o teste.

insert into public.profiles (id, full_name, email) values
  ('11111111-1111-4111-8111-111111111111', 'Admin de Teste',  'admin@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'Sem Papel',       'sempapel@example.invalid'),
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
  ('22222222-2222-4222-8222-222222222222'),
  ('88888888-8888-4888-8888-888888888888')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id) values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('e2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
  ('e8888888-8888-4888-8888-888888888888', '88888888-8888-4888-8888-888888888888');

insert into public.clients (id, name) values
  ('33333333-3333-4333-8333-333333333333', 'Cliente de Teste');

-- `agreed_amount` importa desde a migration 010: sem contrato, é dele que sai a
-- diária no fallback, e é o que faz o apontamento abaixo ser derivado em 250.00.
insert into public.operations (id, client_id, name, agreed_amount) values
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Operação de Teste', 250);

insert into public.employees (id, name, daily_cost) values
  ('55555555-5555-4555-8555-555555555555', 'Colaborador de Teste', 100),
  ('55555555-5555-4555-8555-555555555556', 'Colaborador Dois',     100),
  ('55555555-5555-4555-8555-555555555557', 'Colaborador Três',     100);

insert into public.invoices (id, client_id, period_start, period_end) values
  ('99999999-9999-4999-8999-999999999991', '33333333-3333-4333-8333-333333333333', current_date, current_date),
  ('99999999-9999-4999-8999-999999999992', '33333333-3333-4333-8333-333333333333', current_date, current_date);

insert into public.timesheets (id, operation_id, work_date) values
  ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', current_date);

-- Desde a migration 010 os valores financeiros são DERIVADOS pelo banco, então
-- gravá-los à mão aqui não teria efeito. O apontamento passa a carregar as
-- colunas que a tela sempre envia, e a derivação produz exatamente os 250.00 e
-- 100.00 que os casos adiante conferem: sem contrato, a diária vem do
-- `agreed_amount` da operação (250), e o custo vem do colaborador (100). Sem
-- entrada e sem saída não há hora extra.
insert into public.timesheet_entries
  (id, timesheet_id, employee_id, operation_id, work_date, status) values
  ('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666',
   '55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444',
   current_date, 'present'),
  -- Descartável, para os testes de vínculo. Precisa ser um apontamento
  -- SEPARADO desde a migration 011: vincular à fatura é irreversível, e o
  -- `...777` acima é conferido depois como NÃO faturado por três blocos.
  ('77777777-7777-4777-8777-777777777779', '66666666-6666-4666-8666-666666666666',
   '55555555-5555-4555-8555-555555555557', '44444444-4444-4444-8444-444444444444',
   current_date, 'present');

-- O vínculo é criado AQUI, como `postgres`, que é o mesmo contexto em que
-- `gerar_fatura` roda por ser SECURITY DEFINER. Desde a migration 011 não há
-- outro caminho: nem admin autenticado cria vínculo, e é isso que o bloco do
-- admin passa a afirmar.
update public.timesheet_entries
   set invoice_id = '99999999-9999-4999-8999-999999999991'
 where id = '77777777-7777-4777-8777-777777777779';


-- ---------------------------------------------------------------------------
-- 1. ADMIN — o caminho feliz precisa continuar funcionando.
-- ---------------------------------------------------------------------------

do $admin$
declare
  _n bigint;
  _afetadas integer;
  _bloqueou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

  -- O vínculo de fatura NÃO é operação administrativa genérica. Até a
  -- migration 011 este bloco afirmava o contrário — que o admin vinculava
  -- direto — e era por aí que se criava lastro inconsistente: um apontamento
  -- ligado a uma fatura que não tem item nem total para ele. Agora o único
  -- caminho é `gerar_fatura`.
  _bloqueou := false;
  begin
    update public.timesheet_entries
       set invoice_id = '99999999-9999-4999-8999-999999999991'
     where id = '77777777-7777-4777-8777-777777777777';
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'ADMIN FINANCEIRO: criou vínculo de fatura direto'; end if;

  -- E o vínculo já existente é de mão única. Até a migration 011 este bloco
  -- desfazia o vínculo como limpeza, e essa limpeza era o próprio buraco:
  -- desvincular e só então apagar contornava o bloqueio de exclusão de lastro.
  -- Agora nem o admin desfaz — nem para NULL, nem para outra fatura.
  _bloqueou := false;
  begin
    update public.timesheet_entries
       set invoice_id = null
     where id = '77777777-7777-4777-8777-777777777779';
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'ADMIN FINANCEIRO: desfez vínculo de fatura'; end if;

  _bloqueou := false;
  begin
    update public.timesheet_entries
       set invoice_id = '99999999-9999-4999-8999-999999999992'
     where id = '77777777-7777-4777-8777-777777777779';
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'ADMIN FINANCEIRO: trocou a fatura do apontamento'; end if;

  raise notice 'ADMIN: PASS (CRUD administrativo; vínculo de fatura fora do alcance do admin e irreversível)';
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
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'session_id', 'e2222222-2222-4222-8222-222222222222', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
-- 3. OPERACIONAL — nenhum acesso direto às tabelas de negócio.
--
-- ESTE BLOCO MUDOU DE CONTRATO NA MIGRATION 016, e a mudança é deliberada.
--
-- Antes dela, este bloco media o oposto: que o `operacional` em aal2 enxergava
-- clientes, operações e apontamentos e podia editar apontamento direto. Aquilo
-- não vinha do papel — vinha de `public.is_staff()`, que é `EXISTS` de linha em
-- `user_roles` e por isso é verdadeiro para **qualquer** papel atribuído.
-- Enquanto só existia `admin`, "é staff" e "é admin" coincidiam. Deixaram de
-- coincidir quando a `013` criou a superfície operacional e a `015` passou a
-- aceitar o operador em `aal2`.
--
-- A `016` fecha isso: acesso direto de `authenticated` passa a exigir `aal2` E
-- `admin`. O caminho do operador é a superfície estreita de RPC — medida em
-- `009`, `011` e `012` —, e não a tabela.
--
-- As asserções de NÃO-PODER deste bloco não mudaram: ele continua sem
-- administrar cadastro, sem conceder grant, sem se autoelevar, sem tocar
-- `invoice_id` e sem gerar fatura. O que mudou são as de PODER, que a `016`
-- revogou. A 012 mede a superfície inteira; aqui fica o que esta suíte sempre
-- fez — papel a papel, no contexto geral de autorização.
-- ---------------------------------------------------------------------------

do $operacional$
declare
  _n bigint;
  _afetadas integer;
  _bloqueou boolean;
  _invoice uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- `is_staff()` continua verdadeiro para ele, e é justamente por isso que a
  -- `016` precisou existir: ela não redefiniu a função, acrescentou a exigência
  -- de papel onde faltava.
  if not public.is_staff() then raise exception 'OPERACIONAL: is_staff devolveu falso'; end if;
  if public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'OPERACIONAL: has_role devolveu admin';
  end if;

  select count(*) into _n from public.clients;
  if _n <> 0 then raise exception 'OPERACIONAL SELECT: enxergou % cliente(s) direto', _n; end if;
  select count(*) into _n from public.operations;
  if _n <> 0 then raise exception 'OPERACIONAL SELECT: enxergou % operação(ões) direto', _n; end if;
  select count(*) into _n from public.timesheet_entries;
  if _n <> 0 then raise exception 'OPERACIONAL SELECT: enxergou % apontamento(s) direto', _n; end if;
  select count(*) into _n from public.contracts;
  if _n <> 0 then raise exception 'OPERACIONAL SELECT: enxergou % contrato(s) direto', _n; end if;
  select count(*) into _n from public.invoices;
  if _n <> 0 then raise exception 'OPERACIONAL SELECT: enxergou % fatura(s) direto', _n; end if;

  update public.operations
     set notes = 'editado pelo operacional'
   where id = '44444444-4444-4444-8444-444444444444';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL UPDATE operação: afetou % linhas', _afetadas; end if;

  update public.timesheet_entries
     set notes = 'apontamento operacional'
   where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL UPDATE apontamento: afetou % linhas', _afetadas; end if;

  -- INSERT é recusado por privilégio, e não por linha: a WITH CHECK da
  -- RESTRICTIVE nova sobe como 42501, do mesmo jeito que já subia para o
  -- apontamento nascido com vínculo de fatura.
  _bloqueou := false;
  begin
    insert into public.timesheet_entries (
      id, timesheet_id, employee_id, invoice_id, notes
    ) values (
      '77777777-7777-4777-8777-777777777778',
      '66666666-6666-4666-8666-666666666666',
      '55555555-5555-4555-8555-555555555556',
      '99999999-9999-4999-8999-999999999991',
      'vínculo injetado'
    );
  exception when others then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'OPERACIONAL INSERT: criou apontamento já faturado'; end if;

  _bloqueou := false;
  begin
    insert into public.timesheet_entries (id, timesheet_id, employee_id, notes)
    values (
      '77777777-7777-4777-8777-777777777778',
      '66666666-6666-4666-8666-666666666666',
      '55555555-5555-4555-8555-555555555556',
      'criado pelo operacional'
    );
  exception when others then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'OPERACIONAL INSERT: criou apontamento direto'; end if;

  delete from public.timesheet_entries
   where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL DELETE: apagou % apontamento(s)', _afetadas; end if;

  update public.clients
     set name = 'cliente sequestrado'
   where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL ADMIN: alterou cadastro de cliente'; end if;

  update public.profiles
     set full_name = 'admin sequestrado'
   where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL USUÁRIOS: alterou perfil alheio'; end if;

  if has_table_privilege('anon', 'public.clients', 'TRUNCATE') then
    raise exception 'OPERACIONAL GRANTS: fixture começou com TRUNCATE indevido';
  end if;
  execute 'grant truncate on public.clients to anon';
  if has_table_privilege('anon', 'public.clients', 'TRUNCATE') then
    raise exception 'OPERACIONAL GRANTS: conseguiu conceder TRUNCATE';
  end if;

  update public.invoices
     set total_amount = 999999
   where id = '99999999-9999-4999-8999-999999999991';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL FINANCEIRO: alterou fatura'; end if;

  _bloqueou := false;
  begin
    insert into public.user_roles (user_id, role)
    values ('88888888-8888-4888-8888-888888888888', 'admin');
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'OPERACIONAL AUTOELEVAÇÃO: concedeu admin a si'; end if;

  -- O vínculo de fatura continua fora do alcance dele. Antes a recusa vinha do
  -- guard da 011; agora a linha nem é alcançada — e o efeito medido é o mesmo:
  -- nenhuma alteração, e o vínculo segue nulo.
  update public.timesheet_entries
     set invoice_id = '99999999-9999-4999-8999-999999999991'
   where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics _afetadas = row_count;
  if _afetadas <> 0 then raise exception 'OPERACIONAL FINANCEIRO: alterou invoice_id'; end if;

  execute 'set local role postgres';
  select invoice_id into _invoice
    from public.timesheet_entries
   where id = '77777777-7777-4777-8777-777777777777';
  if _invoice is not null then raise exception 'OPERACIONAL FINANCEIRO: vínculo persistiu como %', _invoice; end if;
  execute 'set local role authenticated';

  _bloqueou := false;
  begin
    perform public.gerar_fatura(
      '33333333-3333-4333-8333-333333333333'::uuid,
      current_date - 1,
      current_date + 1
    );
  exception when insufficient_privilege then _bloqueou := true;
  end;
  if not _bloqueou then raise exception 'OPERACIONAL FINANCEIRO: conseguiu gerar fatura'; end if;

  -- E em aal1 nada muda: lá quem barra é a `*_exige_aal2`, desde a 009.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into _n from public.operations;
  if _n <> 0 then raise exception 'OPERACIONAL aal1 SELECT: enxergou % operação(ões)', _n; end if;

  raise notice 'OPERACIONAL: PASS (sem acesso direto, sem admin, sem elevação, sem financeiro)';
end
$operacional$;


-- ---------------------------------------------------------------------------
-- 4. ANON — nenhum acesso a dado de negócio.
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
-- 5. USER_ROLES — sem escrita, sem autoelevação.
-- ---------------------------------------------------------------------------
-- O schema atual concede somente SELECT em `user_roles` para `authenticated`,
-- então INSERT/UPDATE/DELETE são normalmente recusados pelo GRANT com 42501.
-- O teste também aceita o comportamento seguro de uma configuração futura em
-- que exista o privilégio de tabela, mas a RLS filtre UPDATE/DELETE para zero
-- linhas. Em ambos os casos, qualquer modificação efetiva é uma falha.

do $papeis$
declare
  _n bigint;
  _bloqueou boolean;
  _afetadas integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'session_id', 'e2222222-2222-4222-8222-222222222222', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

  _bloqueou := false;
  _afetadas := 0;
  begin
    update public.user_roles set user_id = '22222222-2222-4222-8222-222222222222';
    get diagnostics _afetadas = row_count;
  exception when insufficient_privilege then
    _bloqueou := true;
    raise notice 'USER_ROLES UPDATE: PASS (bloqueado por privilégio de tabela, SQLSTATE 42501)';
  end;
  if not _bloqueou and _afetadas <> 0 then
    raise exception 'USER_ROLES UPDATE: modificou % linhas', _afetadas;
  elsif not _bloqueou then
    raise notice 'USER_ROLES UPDATE: PASS (RLS filtrou o comando para zero linhas)';
  end if;

  _bloqueou := false;
  _afetadas := 0;
  begin
    delete from public.user_roles;
    get diagnostics _afetadas = row_count;
  exception when insufficient_privilege then
    _bloqueou := true;
    raise notice 'USER_ROLES DELETE: PASS (bloqueado por privilégio de tabela, SQLSTATE 42501)';
  end;
  if not _bloqueou and _afetadas <> 0 then
    raise exception 'USER_ROLES DELETE: modificou % linhas', _afetadas;
  elsif not _bloqueou then
    raise notice 'USER_ROLES DELETE: PASS (RLS filtrou o comando para zero linhas)';
  end if;

  raise notice 'USER_ROLES: PASS (sem insert, update, delete ou autoelevação)';
end
$papeis$;


-- ---------------------------------------------------------------------------
-- 6. FINANCEIRO — quem não é autorizado não mexe em valor nem em vínculo.
-- ---------------------------------------------------------------------------

do $financeiro$
declare
  _afetadas integer;
  _billed numeric;
  _cost numeric;
  _invoice uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'session_id', 'e2222222-2222-4222-8222-222222222222', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
-- 7. gerar_fatura — continua admin-only.
-- ---------------------------------------------------------------------------
-- A função é SECURITY DEFINER: roda acima da RLS, então a autorização tem de
-- ser explícita dentro dela. O teste confere que ela recusa quem não é admin.

do $fatura$
declare
  _bloqueou boolean;
  _msg text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'session_id', 'e2222222-2222-4222-8222-222222222222', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
-- 8. Event trigger de RLS e privilégios endurecidos.
-- ---------------------------------------------------------------------------
-- Roda como `postgres`, porque é leitura de catálogo, não teste de RLS.

do $grants$
declare
  _acl text;
  _n bigint;
begin
  execute 'reset role';

  execute 'create table public.rls_auto_enable_probe (id integer)';
  if not (
    select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'rls_auto_enable_probe'
  ) then
    raise exception 'RLS AUTO: tabela nova em public nasceu sem RLS';
  end if;
  execute 'drop table public.rls_auto_enable_probe';

  for _acl in
    select coalesce(array_to_string(p.proacl, ' ~ '), 'NULO')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'is_staff',
         'update_updated_at_column',
         'rls_auto_enable',
         'protect_timesheet_invoice_link'
       )
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

  raise notice 'RLS AUTO, SEC-011 e SEC-009: PASS';
end
$grants$;


select 'TODOS OS TESTES DE AUTORIZAÇÃO PASSARAM' as resultado;

rollback;
