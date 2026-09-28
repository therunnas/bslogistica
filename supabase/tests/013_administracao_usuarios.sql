-- Migration 017 — admin_audit_log e a proteção do último admin em
-- user_roles (PR D).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`, então nada é
-- criado, alterado ou removido — inclusive em `auth.users`. NUNCA rodar contra
-- Production: o `rollback` protege, mas o arquivo escreve em `auth.users` e
-- `auth.mfa_factors` não tem motivo para correr esse risco ali.
--
-- ESTE TESTE FOI ESCRITO ANTES DE RODAR CONTRA O SCHEMA SEM A 017 SER
-- CONSIDERADO SUFICIENTE: contra o schema anterior à 017, os blocos A e B
-- falham com "relation admin_audit_log does not exist" / "function
-- proteger_ultimo_admin does not exist" — é essa falha que documenta a
-- ausência das duas entregas. Nenhuma expectativa foi invertida para
-- fabricar um PASS.
--
-- O QUE ESTE ARQUIVO NÃO PROVA
--
-- Não prova o backend TypeScript do PR D (convite, listagem, Server Actions) —
-- isso é `npm run test:admin-usuarios`, sem rede, sobre módulos com cliente
-- injetado, no mesmo molde de `scripts/testar-operacional.mjs`. Este arquivo
-- prova só as duas invariantes que só o banco pode garantir: a trilha de
-- auditoria não é gravável por `authenticated`, e o último admin não sai de
-- `user_roles` por caminho nenhum — nem o do backend, nem SQL direto.

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

-- Generalização do `medir` do teste 012: recebe também o PAPEL sob o qual
-- rodar, porque o caso B8 precisa medir a mesma operação como `postgres` e
-- como `service_role` — os dois papéis que as guardas financeiras da 010/011
-- isentam, e que aqui NÃO são isentos.
create or replace function pg_temp.medir_como(
  _papel text, _uid text, _aal text, _sql text
) returns text language plpgsql as $$
declare _r text; _claims jsonb;
begin
  if _uid is null then
    _claims := jsonb_build_object('role', 'anon');
  else
    _claims := jsonb_build_object('sub', _uid, 'role', 'authenticated');
    if _aal is not null then
      _claims := _claims || jsonb_build_object('aal', _aal);
    end if;
  end if;
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

create or replace function pg_temp.medir(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
begin
  return pg_temp.medir_como('authenticated', _uid, _aal, _sql);
end;
$$;


-- ---------------------------------------------------------------------------
-- Fixture
--
-- Dois admins independentes (sobra sempre um quando se apaga o outro) mais um
-- operacional puro e um acumulador (admin + operacional), para os casos que
-- precisam do acumulador como ÚLTIMO admin.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('17000000-0000-4000-8000-000000000001'),  -- ADM_A
  ('17000000-0000-4000-8000-000000000002'),  -- ADM_B
  ('17000000-0000-4000-8000-000000000003'),  -- OP
  ('17000000-0000-4000-8000-000000000004'),  -- ACUMULADOR (admin + operacional)
  ('17000000-0000-4000-8000-000000000005');  -- NOVO_ADMIN, só para o caso B9

insert into public.user_roles (user_id, role) values
  ('17000000-0000-4000-8000-000000000001', 'admin'),
  ('17000000-0000-4000-8000-000000000002', 'admin'),
  ('17000000-0000-4000-8000-000000000003', 'operacional'),
  ('17000000-0000-4000-8000-000000000004', 'admin'),
  ('17000000-0000-4000-8000-000000000004', 'operacional');

insert into public.admin_audit_log (actor_id, action, target_user_id, details) values
  ('17000000-0000-4000-8000-000000000001', 'papel_concedido',
   '17000000-0000-4000-8000-000000000003', '{"papel":"operacional"}'::jsonb);


-- ---------------------------------------------------------------------------
-- A. admin_audit_log — leitura só admin+AAL2, escrita só service_role
-- ---------------------------------------------------------------------------

do $bloco_a$
declare _adm text := '17000000-0000-4000-8000-000000000001';
        _op  text := '17000000-0000-4000-8000-000000000003';
begin
  perform pg_temp.registrar('A1. admin aal2 le admin_audit_log', '1',
    pg_temp.medir(_adm, 'aal2', 'select count(*)::text from public.admin_audit_log'));

  perform pg_temp.registrar('A2. admin aal1 nao le', '0',
    pg_temp.medir(_adm, 'aal1', 'select count(*)::text from public.admin_audit_log'));

  perform pg_temp.registrar('A3. operacional aal2 nao le', '0',
    pg_temp.medir(_op, 'aal2', 'select count(*)::text from public.admin_audit_log'));

  perform pg_temp.registrar('A4. operacional aal1 nao le', '0',
    pg_temp.medir(_op, 'aal1', 'select count(*)::text from public.admin_audit_log'));

  perform pg_temp.registrar('A5. admin aal2 nao insere (sem GRANT)', 'erro 42501',
    pg_temp.medir(_adm, 'aal2',
      $sql$with i as (insert into public.admin_audit_log (action) values ('forjado') returning 1)
           select count(*)::text from i$sql$));

  perform pg_temp.registrar('A6. admin aal2 nao apaga a propria auditoria', 'erro 42501',
    pg_temp.medir(_adm, 'aal2',
      'with d as (delete from public.admin_audit_log returning 1) select count(*)::text from d'));

  perform pg_temp.registrar('A7. admin aal2 nao altera a propria auditoria', 'erro 42501',
    pg_temp.medir(_adm, 'aal2',
      $sql$with u as (update public.admin_audit_log set action = 'adulterado' returning 1)
           select count(*)::text from u$sql$));

  -- `select ... from i`, não da tabela: um SELECT direto na tabela dentro do
  -- mesmo comando usa o snapshot de INÍCIO do comando e não enxergaria a linha
  -- que o próprio INSERT acabou de criar.
  perform pg_temp.registrar('A8. service_role consegue gravar (bypassa RLS)', '1',
    pg_temp.medir_como('service_role', null, null,
      $sql$with i as (insert into public.admin_audit_log (action) values ('papel_revogado') returning 1)
           select count(*)::text from i$sql$));

  perform pg_temp.registrar('A9. e a linha do A8 esta mesmo la', '2',
    (select count(*)::text from public.admin_audit_log));
end;
$bloco_a$;


-- ---------------------------------------------------------------------------
-- B. Proteção do último admin — user_roles não perde o último 'admin'
--
-- Blocos com SAVEPOINT: cada cenário de "é o último" reduz de verdade a
-- contagem de admins para 1, testa a recusa, e desfaz — para não contaminar
-- os casos seguintes, que também precisam de dois admins de sobra.
-- ---------------------------------------------------------------------------

do $bloco_b$
declare _a text := '17000000-0000-4000-8000-000000000001';
        _b text := '17000000-0000-4000-8000-000000000002';
        _acumulador text := '17000000-0000-4000-8000-000000000004';
begin
  -- B1: com dois admins de sobra, apagar um funciona.
  perform pg_temp.registrar('B1. apaga admin quando sobra outro', '1',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with d as (delete from public.user_roles
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from d$sql$, _b)));

  -- devolve o admin B para os casos seguintes.
  insert into public.user_roles (user_id, role) values (_b::uuid, 'admin');

  -- B4: rebaixar admin -> operacional quando sobra outro admin funciona.
  perform pg_temp.registrar('B4. rebaixa admin quando sobra outro', '1',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with u as (update public.user_roles set role = 'operacional'
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from u$sql$, _b)));

  -- devolve o papel admin ao B, para não deixar só um admin nos blocos acima.
  update public.user_roles set role = 'admin' where user_id = _b::uuid and role = 'operacional';

  -- B7: UPDATE que mantém role='admin' na mesma linha nunca é bloqueio —
  -- passa pelo atalho do trigger, não pela contagem.
  perform pg_temp.registrar('B7. update sem trocar de admin nao e bloqueado', '1',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with u as (update public.user_roles set role = 'admin'
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from u$sql$, _a)));

  -- B9: INSERT de novo admin nunca dispara o trigger (só UPDATE/DELETE) — se
  -- disparasse em INSERT, este INSERT explodiria com 42501, porque na hora em
  -- que ele roda já existem admins de sobra e o teste do OLD.role não faria
  -- sentido para INSERT (OLD é nulo). O ponto é só: o INSERT tem que sobreviver.
  perform pg_temp.registrar('B9. insert de admin nao aciona o trigger', '1',
    pg_temp.medir_como('postgres', null, null,
      $sql$with i as (insert into public.user_roles (user_id, role)
                       values ('17000000-0000-4000-8000-000000000005', 'admin')
                       returning 1)
           select count(*)::text from i$sql$));
end;
$bloco_b$;

-- Limpa o admin do B9: sobram 3 admins (A, B, acumulador) neste ponto, então
-- este DELETE não é "o último" e passa livre pela mesma trigger.
delete from public.user_roles
 where user_id = '17000000-0000-4000-8000-000000000005' and role = 'admin';

-- ---- Agora reduz para o ÚLTIMO admin de verdade: só o acumulador. ----
--
-- Sem SAVEPOINT aqui de propósito: um `rollback to savepoint` desfaria também
-- os `insert` em `_resultado` feitos depois dele, e os casos B2/B3/B5/B6/B8
-- sumiriam do relatório em vez de aparecer como PASS. Em vez disso, o estado é
-- restaurado por INSERT normal logo depois do bloco, o que mantém os
-- resultados já registrados.

delete from public.user_roles
 where user_id = '17000000-0000-4000-8000-000000000001' and role = 'admin';
delete from public.user_roles
 where user_id = '17000000-0000-4000-8000-000000000002' and role = 'admin';

do $bloco_b_ultimo$
declare _acumulador text := '17000000-0000-4000-8000-000000000004';
begin
  perform pg_temp.registrar('B_setup. sobra exatamente um admin', '1',
    (select count(*)::text from public.user_roles where role = 'admin'));

  -- B2: apagar o último admin é recusado.
  perform pg_temp.registrar('B2. apaga o ultimo admin: recusado', 'erro 42501',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with d as (delete from public.user_roles
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from d$sql$, _acumulador)));

  -- B3: rebaixar o último admin é recusado.
  perform pg_temp.registrar('B3. rebaixa o ultimo admin: recusado', 'erro 42501',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with u as (update public.user_roles set role = 'operacional'
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from u$sql$, _acumulador)));

  -- B5: o acumulador continua sendo o último admin depois das duas
  -- tentativas recusadas acima — a proteção realmente impediu a escrita.
  perform pg_temp.registrar('B5. acumulador continua admin', '1',
    (select count(*)::text from public.user_roles
      where user_id = _acumulador::uuid and role = 'admin'));

  -- B6: apagar a linha 'operacional' do acumulador (que não é 'admin') nunca
  -- é bloqueada por esta trigger — ela só olha para role = 'admin'.
  perform pg_temp.registrar('B6. apaga operacional do acumulador: permitido', '1',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with d as (delete from public.user_roles
                              where user_id = %L and role = 'operacional' returning 1)
                  select count(*)::text from d$sql$, _acumulador)));

  -- B8: a trigger NÃO isenta postgres nem service_role — ao contrário das
  -- guardas financeiras da 010/011. Medido nos dois papéis diretamente.
  perform pg_temp.registrar('B8a. postgres tambem e recusado no ultimo admin', 'erro 42501',
    pg_temp.medir_como('postgres', null, null,
      format($sql$with d as (delete from public.user_roles
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from d$sql$, _acumulador)));

  perform pg_temp.registrar('B8b. service_role tambem e recusado no ultimo admin', 'erro 42501',
    pg_temp.medir_como('service_role', null, null,
      format($sql$with d as (delete from public.user_roles
                              where user_id = %L and role = 'admin' returning 1)
                  select count(*)::text from d$sql$, _acumulador)));
end;
$bloco_b_ultimo$;

-- Restaura o estado para o bloco C: devolve os dois admins e a linha
-- 'operacional' do acumulador que o B6 removeu.
insert into public.user_roles (user_id, role) values
  ('17000000-0000-4000-8000-000000000001', 'admin'),
  ('17000000-0000-4000-8000-000000000002', 'admin'),
  ('17000000-0000-4000-8000-000000000004', 'operacional');


-- ---------------------------------------------------------------------------
-- B9-lock. Serialização do último admin — forma literal
--
-- O QUE ESTE BLOCO NÃO PROVA
--
-- Uma transação só, como esta suíte inteira, não reproduz duas transações
-- concorrentes — não existe "segunda sessão" dentro de uma `DO` block. A
-- prova de que a corrida está fechada de verdade foi feita à parte, com duas
-- sessões `psql` reais contra este mesmo harness, timing medido por
-- `clock_timestamp()`:
--
--   S1 (t=0.000s)  BEGIN; DELETE admin A; segura a transação aberta 4s.
--   S2 (t=1.000s)  BEGIN; DELETE admin B — BLOQUEIA na trava.
--   S1 (t=4.000s)  COMMIT (libera a trava; A já não é admin).
--   S2 (t≈4.000s)  desbloqueia, reconta, vê zero admins restantes,
--                  recusa com 42501 — 3006ms de espera medidos no próprio
--                  `\timing` do psql, não estimados.
--
-- Estado final medido: só B continua admin. CONTROLE NEGATIVO, no mesmo
-- harness: a mesma sequência contra uma cópia da função SEM
-- `pg_advisory_xact_lock` faz o DELETE de S2 retornar em 2.4ms (sem
-- bloquear) e COMMITar — estado final medido: ZERO admins. É a corrida
-- descrita no checkout #13.1, reproduzida antes de fechá-la.
-- ---------------------------------------------------------------------------

do $bloco_lock$
begin
  perform pg_temp.registrar(
    'B9-lock. proteger_ultimo_admin serializa com pg_advisory_xact_lock',
    'true',
    (select (prosrc like '%pg_advisory_xact_lock%')::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'proteger_ultimo_admin'));

  perform pg_temp.registrar(
    'B9-lock2. a chave do lock e especifica deste projeto (bslog/ultimo-admin)',
    'true',
    (select (prosrc like '%bslog/ultimo-admin%')::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'proteger_ultimo_admin'));
end;
$bloco_lock$;


-- ---------------------------------------------------------------------------
-- C. Nada que já existia mudou de forma
-- ---------------------------------------------------------------------------

do $bloco_c$
begin
  perform pg_temp.registrar('C1. as 11 *_exige_aal2 continuam 11', '11',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%_exige_aal2'));

  perform pg_temp.registrar('C2. as 10 *_exige_admin (016) continuam 10', '10',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%_exige_admin'));

  perform pg_temp.registrar('C3. admin_audit_log tem exatamente 2 policies', '2',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'admin_audit_log'));

  perform pg_temp.registrar('C4. user_operation_access continua com 2 policies', '2',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'user_operation_access'));

  perform pg_temp.registrar('C5. as 5 RPCs operacionais seguem com o dono dedicado', '5',
    (select count(*)::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public' and r.rolname = 'bslog_rpc_operacional'));

  perform pg_temp.registrar('C6. has_role nao foi redefinida', 'true',
    (select (prosecdef = false)::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'has_role'));
end;
$bloco_c$;


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
    raise exception '013_administracao_usuarios: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
