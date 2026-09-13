-- Estado de MFA verificável pelo banco — `public.mfa_bloqueia_excecao_aal1()`.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`, então nada é
-- criado, alterado ou removido — inclusive no schema `auth`.
--
-- POR QUE ESTE ARQUIVO TOCA `auth.users` E `auth.mfa_factors`
--
-- Ao contrário de `002` e `005`, que se apoiam em `profiles`/`user_roles` (sem
-- FK para `auth.users`), aqui a fixture PRECISA de contas reais: a FK
-- `mfa_factors_user_id_fkey` aponta para `auth.users`. Só a coluna `id` é
-- obrigatória, então as linhas são mínimas e não carregam e-mail, senha, nem
-- qualquer dado pessoal. NUNCA rodar contra Production — o `rollback` protege,
-- mas o arquivo escreve em schema de autenticação e não há motivo para correr
-- esse risco.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION, DE PROPÓSITO.
--
-- Rodando contra o schema anterior à 012, TODOS os casos falham com
-- "function public.mfa_bloqueia_excecao_aal1() does not exist" — é essa falha
-- que documenta a ausência do primitivo. Nenhuma expectativa foi invertida para
-- fabricar um PASS.
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Que AAL1 está liberado para `operacional`. Não está, e o PR A não libera: as
-- 11 policies `*_exige_aal2` continuam globais. O bloco J confere isso.

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
) on commit drop;

-- `security definer` pelo mesmo motivo do 005: os blocos rodam sob
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

-- Chama a função sob o papel `authenticated` com os claims de um usuário, e
-- devolve o resultado como texto. Encapsulado porque a troca de papel precisa
-- ser revertida mesmo quando a chamada levanta exceção — do contrário o bloco
-- seguinte rodaria com o papel errado e mediria outra coisa.
create or replace function pg_temp.consultar(_uid text)
returns text language plpgsql as $$
declare _r boolean;
begin
  if _uid is null then
    perform set_config('request.jwt.claims',
      json_build_object('role','anon')::text, true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role','authenticated', 'aal','aal1')::text, true);
  end if;
  execute 'set local role authenticated';
  begin
    select public.mfa_bloqueia_excecao_aal1() into _r;
  exception when others then
    execute 'set local role postgres';
    return 'erro ' || sqlstate;
  end;
  execute 'set local role postgres';
  return coalesce(_r::text, 'nulo');
end;
$$;


-- ---------------------------------------------------------------------------
-- Fixture: quatro contas, cada uma num estado de MFA diferente.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),  -- sem fator
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),  -- só unverified
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),  -- verified (totp)
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');  -- unverified + verified

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('f0000001-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'pendente', 'totp', 'unverified', now(), now()),
  ('f0000002-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'ativo', 'totp', 'verified', now(), now()),
  ('f0000003-0000-4000-8000-000000000003', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'antigo', 'totp', 'unverified', now(), now()),
  ('f0000004-0000-4000-8000-000000000004', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'novo', 'totp', 'verified', now(), now());


-- ---------------------------------------------------------------------------
-- A a E. Semântica por estado de fator.
-- ---------------------------------------------------------------------------

do $semantica$
begin
  perform pg_temp.registrar('A. anon / uid nulo bloqueia a excecao',
    'true', pg_temp.consultar(null));

  perform pg_temp.registrar('B. autenticado SEM fator nao bloqueia',
    'false', pg_temp.consultar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));

  perform pg_temp.registrar('C. somente fator unverified nao bloqueia',
    'false', pg_temp.consultar('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));

  perform pg_temp.registrar('D. fator verified bloqueia',
    'true', pg_temp.consultar('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));

  perform pg_temp.registrar('E. unverified + verified bloqueia',
    'true', pg_temp.consultar('dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
end;
$semantica$;


-- ---------------------------------------------------------------------------
-- F e G. Isolamento por `auth.uid()`.
--
-- O fator de C é verificado. Se a função olhasse a tabela inteira em vez de
-- filtrar por `auth.uid()`, A e B passariam a devolver `true` — é exatamente
-- essa confusão que os dois casos abaixo medem.
-- ---------------------------------------------------------------------------

do $isolamento$
declare _sem_fator text; _verificado text;
begin
  _sem_fator  := pg_temp.consultar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  _verificado := pg_temp.consultar('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

  perform pg_temp.registrar(
    'F. fator verificado de OUTRO usuario nao contamina', 'false', _sem_fator);

  perform pg_temp.registrar(
    'G. duas contas no mesmo teste dao respostas distintas',
    'false|true', _sem_fator || '|' || _verificado);
end;
$isolamento$;


-- ---------------------------------------------------------------------------
-- H. Privilégio de execução.
-- ---------------------------------------------------------------------------

do $execute$
declare _oid oid;
begin
  select p.oid into _oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mfa_bloqueia_excecao_aal1';

  perform pg_temp.registrar('H1. authenticated TEM execute', 'true',
    has_function_privilege('authenticated', _oid, 'EXECUTE')::text);

  perform pg_temp.registrar('H2. anon NAO tem execute', 'false',
    has_function_privilege('anon', _oid, 'EXECUTE')::text);

  perform pg_temp.registrar('H3. PUBLIC NAO tem execute', 'false',
    has_function_privilege('public', _oid, 'EXECUTE')::text);

  perform pg_temp.registrar('H4. service_role NAO tem execute', 'false',
    has_function_privilege('service_role', _oid, 'EXECUTE')::text);
end;
$execute$;


-- ---------------------------------------------------------------------------
-- I. O efeito SECURITY DEFINER é real.
--
-- Prova em duas metades: `authenticated` NÃO lê a tabela diretamente, mas
-- CONSEGUE a resposta através da função. Sem isso, um PASS no bloco D poderia
-- estar apenas refletindo um privilégio de leitura que não deveria existir.
-- ---------------------------------------------------------------------------

do $definer$
declare _leitura_direta text; _pela_funcao text; _secdef boolean; _owner text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                      'role','authenticated','aal','aal1')::text, true);
  execute 'set local role authenticated';
  begin
    execute 'select count(*)::text from auth.mfa_factors' into _leitura_direta;
  exception when others then
    _leitura_direta := 'recusado ' || sqlstate;
  end;
  execute 'set local role postgres';

  perform pg_temp.registrar(
    'I1. authenticated NAO le auth.mfa_factors direto',
    'recusado 42501', _leitura_direta);

  _pela_funcao := pg_temp.consultar('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  perform pg_temp.registrar(
    'I2. mas obtem a resposta PELA funcao', 'true', _pela_funcao);

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into _secdef, _owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mfa_bloqueia_excecao_aal1';

  perform pg_temp.registrar('I3. e SECURITY DEFINER', 'true', _secdef::text);
  perform pg_temp.registrar('I4. owner e postgres', 'postgres', _owner);
end;
$definer$;


-- ---------------------------------------------------------------------------
-- J. Superfície e escopo.
--
-- J1/J2: a interface é um booleano sem parâmetro — não há como pedir por outro
-- usuário nem receber segredo, telefone ou id de fator.
-- J3: `search_path` fixo, o vetor clássico de SECURITY DEFINER.
-- J4: o PR A não relaxou nada — as 11 policies continuam RESTRICTIVE.
-- ---------------------------------------------------------------------------

do $superficie$
declare _nargs int; _rettype text; _config text; _aal2 int;
begin
  select p.pronargs, pg_get_function_result(p.oid),
         coalesce(array_to_string(p.proconfig, ','), '(nenhum)')
    into _nargs, _rettype, _config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mfa_bloqueia_excecao_aal1';

  perform pg_temp.registrar('J1. nao aceita parametro', '0', _nargs::text);
  perform pg_temp.registrar('J2. retorna apenas boolean', 'boolean', _rettype);
  perform pg_temp.registrar('J3. search_path fixo',
    'search_path=pg_catalog, public', _config);

  select count(*) into _aal2
    from pg_policies
   where schemaname = 'public'
     and policyname like '%exige_aal2%'
     and permissive = 'RESTRICTIVE';

  perform pg_temp.registrar(
    'J4. as 11 policies aal2 continuam RESTRICTIVE', '11', _aal2::text);
end;
$superficie$;


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
    raise exception '008_estado_mfa: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
