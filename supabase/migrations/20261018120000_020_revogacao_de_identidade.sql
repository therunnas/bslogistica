-- C02 — A autorização passa a depender da identidade viva, não só da linha de papel.
--
-- PROBLEMA (reproduzido na homologação local, com JWTs reais — L2-C02-B)
--
-- `has_role()` e `is_staff()` liam apenas `public.user_roles`. O PostgREST valida
-- a ASSINATURA do JWT e não consulta o Auth a cada requisição, então um token já
-- emitido seguia autorizado depois de:
--
--   T1  a conta ser BANIDA (papel mantido)             -> admin lia faturas e
--                                                         executava gerar_fatura;
--   T2  a conta ser EXCLUÍDA (papel órfão, sem FK)     -> idem;
--   T5  a sessão ser ENCERRADA (signOut global)        -> idem.
--
-- Só a REMOÇÃO DO PAPEL (T3) já revogava na hora, porque o papel é lido ao vivo.
-- O Auth recusa esses tokens em `/auth/v1/user` (guard e Server Actions já
-- ficavam a salvo); a RLS e as RPCs não.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. `conta_ativa(uuid)`            conta existe em auth.users, não está excluída
--                                     (`deleted_at`) e não está banida
--                                     (`banned_until` no futuro).
--   2. `identidade_atual_utilizavel()` conta ativa E a sessão do JWT corrente existe
--                                     em auth.sessions, pertence à conta e não
--                                     expirou (`not_after`). Falha FECHADA: JWT sem
--                                     `session_id`, com `session_id` vazio,
--                                     malformado ou de outra conta => false, nunca
--                                     exceção (nenhum cast inválido => 22P02).
--   3. `has_role()` / `is_staff()`    passam a exigir a identidade utilizável
--                                     quando avaliam o PRÓPRIO chamador.
--   4. `proteger_ultimo_admin()`      conta só admins com conta ativa e deixa
--                                     remover a linha de uma conta já inutilizável.
--   5. Policies (ALTER POLICY, só a expressão)
--        a. 25 policies que chamavam `has_role()`/`is_staff()` SEM subconsulta
--           passam a `(SELECT ...)`: a verificação não depende da linha, então o
--           Postgres a avalia UMA vez por comando (InitPlan) em vez de uma por
--           linha. Mesma semântica; é o que evita a regressão de ~20x medida na
--           L2-C02-C2 (count de timesheet_entries: 101 ms -> 2 s).
--        b. `profiles_insert_own`, `profiles_update_own`, `profiles_select_own_or_admin`
--           e `user_roles_select_own` passam a exigir a identidade utilizável: antes
--           comparavam só `auth.uid()` e um JWT revogado ainda lia/alterava a
--           própria linha.
--
-- DECISÕES QUE NÃO SÃO ÓBVIAS
--
--   * `has_role()` CONTINUA `SECURITY INVOKER` (20260903175718: "no RLS bypass;
--     relies on own-row read policy"). Torná-la DEFINER reabriria um oráculo: qualquer
--     autenticado poderia perguntar o papel de qualquer UUID. A leitura de
--     auth.users/auth.sessions, que `authenticated` não enxerga, fica numa helper
--     DEFINER SEM PARÂMETRO, que só avalia o chamador — não serve de oráculo.
--
--   * `identidade_atual_utilizavel()` é PL/pgSQL de propósito. Em SQL puro o `CASE`
--     NÃO protege o cast: a chave do índice de `auth.sessions` é avaliada na
--     INICIALIZAÇÃO do plano, antes do `CASE`, e um `session_id` malformado dava
--     22P02 (reproduzido na L2-C02-C2). No `IF` sequencial do PL/pgSQL o cast só roda
--     depois da regex. Também é ~4x mais barata por chamada que a versão SQL
--     aninhada (uma consulta só, plano em cache de sessão).
--
--   * `conta_ativa(uuid)`, que aceita um UUID qualquer, é executável SÓ por
--     `service_role` (o trigger do último admin roda com esse papel ou com
--     `postgres`). `authenticated` e `anon` não a alcançam, pela API ou por SQL.
--
--   * A sessão só é exigida quando `_user_id` é o próprio `auth.uid()`: é a única
--     situação em que existe "a sessão atual" para conferir. Avaliar o papel de
--     OUTRA conta (via service_role/postgres, sem JWT) continua sendo só leitura de
--     `user_roles`; nenhum ponto de chamada do repositório faz isso hoje.
--
--   * Esta migration NÃO limpa papéis órfãos (sem trigger em auth.users). A limpeza
--     controlada é pendência registrada (PROGRESS.md).
--
--   * As RPCs operacionais (dono `bslog_rpc_operacional`) NÃO chamam `has_role()`
--     diretamente: passam por `operador_elegivel_*`, DEFINER do `postgres`, que a
--     chamam. Por isso `bslog_rpc_operacional` não ganha EXECUTE em nada novo e os
--     grants dele ficam como estavam.
--
--   * As policies `*_exige_aal2` (RESTRICTIVE) só olham o claim `aal` e NÃO foram
--     tocadas, nem as 10 `*_exige_admin`, que já usavam `(SELECT has_role(...))`.
--     Nenhuma policy foi criada, removida ou trocada de PERMISSIVE/RESTRICTIVE;
--     RLS ligada e FORCE RLS ficam como estavam; nenhum grant de tabela muda.
--
-- POR QUE `(SELECT ...)` É EQUIVALENTE
--
-- `has_role(auth.uid(), 'admin')` e `is_staff()` não referenciam coluna da linha:
-- dependem só do claim do JWT e do estado de user_roles/auth.* na foto do comando.
-- Como subconsulta não correlacionada, o Postgres a calcula uma vez e reaproveita
-- o resultado; os dois valores coincidem para toda linha. Nenhuma condição que
-- dependa da linha foi promovida (`id = auth.uid()` continua comparando a coluna).
--
-- ROLLBACK
--
-- Esta migration é reversível por migration NOVA (nunca editando esta, uma vez
-- aplicada): restaurar os corpos de `has_role()`, `is_staff()` e
-- `proteger_ultimo_admin()` das migrations 20260903175718 e 20260928120000;
-- `ALTER POLICY` das 29 policies de volta à expressão anterior (sem `(SELECT ...)`,
-- e sem `identidade_atual_utilizavel()` nas 4 de profiles/user_roles); e
-- `DROP FUNCTION` das duas helpers. O rollback REABRE a vulnerabilidade C02
-- (token de conta banida, excluída ou deslogada seguia autorizado até o `exp`).
--
-- COMPATIBILIDADE
--
-- Não depende da migration 019 nem do módulo de fechamento. Só usa objetos que a
-- `main` já tem. As policies do fechamento (019), se ainda chamarem has_role()/
-- is_staff() sem subconsulta, continuam corretas e podem ser embrulhadas depois.


-- ---------------------------------------------------------------------------
-- 1. conta_ativa(uuid) — só service_role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.conta_ativa(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
       p_user_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM auth.users u
          WHERE u.id = p_user_id
            AND u.deleted_at IS NULL
            AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
       ),
     false);
$$;

ALTER FUNCTION public.conta_ativa(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.conta_ativa(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conta_ativa(uuid) TO service_role;

COMMENT ON FUNCTION public.conta_ativa(uuid) IS
  'Conta existente, nao excluida (deleted_at) e nao banida (banned_until no futuro). Aceita UUID qualquer, por isso so service_role executa (trigger do ultimo admin). Falha fechada: NULL ou conta inexistente => false.';


-- ---------------------------------------------------------------------------
-- 2. identidade_atual_utilizavel() — avalia só o chamador
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.identidade_atual_utilizavel()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid text := auth.jwt() ->> 'session_id';
  v_ok  boolean;
BEGIN
  -- Ordem importa: o cast `v_sid::uuid` abaixo só roda se ESTE `IF` não retornou.
  -- Ausente, vazio, malformado, objeto/array/número no claim (o `->>` devolve o
  -- texto): tudo cai aqui e vira `false`.
  IF v_uid IS NULL
     OR v_sid IS NULL
     OR v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  -- Conta ativa (mesmo critério de `conta_ativa`) E sessão da mesma conta, não
  -- vencida. Uma consulta, duas chaves primárias. Nenhuma linha => `v_ok` fica NULL.
  SELECT true
    INTO v_ok
    FROM auth.sessions s
    JOIN auth.users u ON u.id = s.user_id
   WHERE s.id = v_sid::uuid
     AND s.user_id = v_uid
     AND u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
     AND (s.not_after IS NULL OR s.not_after > pg_catalog.now());

  RETURN coalesce(v_ok, false);
END;
$$;

ALTER FUNCTION public.identidade_atual_utilizavel() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.identidade_atual_utilizavel() FROM PUBLIC, anon, authenticated, service_role;
-- Os mesmos papéis que já executam has_role()/is_staff(), que a chamam. O
-- Postgres confere EXECUTE ao montar a expressão, mesmo que o ramo não rode.
GRANT EXECUTE ON FUNCTION public.identidade_atual_utilizavel() TO authenticated, service_role;

COMMENT ON FUNCTION public.identidade_atual_utilizavel() IS
  'Conta do JWT corrente ativa E sessao (claim session_id) existente em auth.sessions, da mesma conta e nao expirada. Sem parametro: so responde sobre o chamador, nao serve de oraculo. Falha fechada (false, nunca excecao) para session_id ausente, vazio, malformado, inexistente, de outra conta, encerrado ou vencido.';


-- ---------------------------------------------------------------------------
-- 3. has_role() e is_staff() — continuam SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE preserva os grants (authenticated e service_role).

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(
       EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
   AND (_user_id IS DISTINCT FROM auth.uid() OR public.identidade_atual_utilizavel()),
     false);
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(
       EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
   AND public.identidade_atual_utilizavel(),
     false);
$$;

COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS
  'Papel existe em user_roles E, quando _user_id e o proprio auth.uid(), a identidade atual e utilizavel (conta ativa + sessao viva). SECURITY INVOKER de proposito: nao e oraculo de papel alheio.';
COMMENT ON FUNCTION public.is_staff() IS
  'Qualquer papel em user_roles para auth.uid() E identidade atual utilizavel (conta ativa + sessao viva).';


-- ---------------------------------------------------------------------------
-- 4. proteger_ultimo_admin() — conta só identidades utilizáveis
-- ---------------------------------------------------------------------------
-- Antes: `count(*)` de linhas role='admin'. Uma conta banida ou excluída (papel
-- órfão) contava como "sobrou admin", e o trigger deixava remover o ÚNICO admin
-- utilizável. Agora só contam admins com `conta_ativa`.
--
-- A sessão NÃO entra aqui: o que importa é existir alguém que POSSA entrar, e
-- uma conta ativa sempre pode abrir uma sessão nova.
--
-- Remover a linha de uma conta que JÁ É inutilizável não reduz o número de
-- admins utilizáveis, então passa — é o que permite limpar um papel órfão mesmo
-- quando ele é o único que resta. Conceder admin (INSERT) nunca dispara o trigger.

CREATE OR REPLACE FUNCTION public.proteger_ultimo_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  restantes int;
BEGIN
  IF OLD.role <> 'admin'::public.app_role THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;

  -- Serializa a decisão entre transações concorrentes. Liberado sozinho no
  -- COMMIT ou ROLLBACK desta transação — nunca precisa (nem pode) ser
  -- liberado manualmente aqui dentro.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bslog/ultimo-admin', 0)
  );

  IF NOT public.conta_ativa(OLD.user_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO restantes
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::public.app_role
    AND ur.id <> OLD.id
    AND public.conta_ativa(ur.user_id);

  IF restantes = 0 THEN
    RAISE EXCEPTION 'Não é possível remover ou rebaixar o único administrador utilizável restante.'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.proteger_ultimo_admin() IS
  'Recusa DELETE/UPDATE em user_roles que removeria o ultimo admin UTILIZAVEL (conta ativa). Linha de conta ja inutilizavel pode ser removida. Serializado por pg_advisory_xact_lock. Sem excecao de papel: nao isenta postgres nem service_role.';


-- ---------------------------------------------------------------------------
-- 5. Policies — só a expressão (ALTER POLICY); nome, comando, papéis e
--    PERMISSIVE/RESTRICTIVE não mudam
-- ---------------------------------------------------------------------------
-- 5a. Verificação constante => `(SELECT ...)` (InitPlan: uma avaliação por comando).
--     Cada policy abaixo tinha `has_role(auth.uid(), 'admin')` ou `is_staff()` solto.
--     A parte `aal` já era `(SELECT auth.jwt() ->> 'aal')` e fica como estava.
--     SELECT/DELETE só têm USING; INSERT só tem WITH CHECK; ALL tem os dois.

-- admin_audit_log ------------------------------------------------------------
ALTER POLICY admin_audit_log_exige_admin_aal2 ON public.admin_audit_log
  USING (((SELECT auth.jwt() ->> 'aal') = 'aal2')
         AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK (((SELECT auth.jwt() ->> 'aal') = 'aal2')
              AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
ALTER POLICY admin_audit_log_leitura_admin ON public.admin_audit_log
  USING (((SELECT auth.jwt() ->> 'aal') = 'aal2')
         AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

-- clients, contracts, employees, invoices, invoice_items ----------------------
ALTER POLICY clients_select_staff ON public.clients
  USING ((SELECT public.is_staff()));
ALTER POLICY clients_write_admin ON public.clients
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY contracts_select_staff ON public.contracts
  USING ((SELECT public.is_staff()));
ALTER POLICY contracts_write_admin ON public.contracts
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY employees_select_staff ON public.employees
  USING ((SELECT public.is_staff()));
ALTER POLICY employees_write_admin ON public.employees
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY invoices_select_staff ON public.invoices
  USING ((SELECT public.is_staff()));
ALTER POLICY invoices_write_admin ON public.invoices
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY invoice_items_select_staff ON public.invoice_items
  USING ((SELECT public.is_staff()));
ALTER POLICY invoice_items_write_admin ON public.invoice_items
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

-- operations, shifts, operation_team, timesheets, timesheet_entries -----------
ALTER POLICY operations_select_staff ON public.operations
  USING ((SELECT public.is_staff()));
ALTER POLICY operations_update_staff ON public.operations
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY operations_insert_admin ON public.operations
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
ALTER POLICY operations_delete_admin ON public.operations
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY shifts_select_staff ON public.shifts
  USING ((SELECT public.is_staff()));
ALTER POLICY shifts_update_staff ON public.shifts
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY shifts_insert_admin ON public.shifts
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
ALTER POLICY shifts_delete_admin ON public.shifts
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY operation_team_staff ON public.operation_team
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY timesheets_staff ON public.timesheets
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY timesheet_entries_staff ON public.timesheet_entries
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

-- user_operation_access -------------------------------------------------------
ALTER POLICY user_operation_access_admin ON public.user_operation_access
  USING (((SELECT auth.jwt() ->> 'aal') = 'aal2')
         AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK (((SELECT auth.jwt() ->> 'aal') = 'aal2')
              AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
ALTER POLICY user_operation_access_somente_admin_aal2 ON public.user_operation_access
  USING (((SELECT auth.jwt() ->> 'aal') = 'aal2')
         AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK (((SELECT auth.jwt() ->> 'aal') = 'aal2')
              AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

-- 5b. Linhas PRÓPRIAS exigem identidade utilizável. `id = auth.uid()` continua
--     comparando a COLUNA com o claim; só o claim virou `(SELECT auth.uid())`. As
--     três policies de `profiles` seguem sob a RESTRICTIVE `profiles_exige_aal2`.
--     `user_roles` fica FORA do enforcement de AAL2 de propósito (o guard lê o
--     papel em AAL1); `identidade_atual_utilizavel()` não depende do nível `aal`,
--     então o guard e o cadastro do primeiro fator seguem funcionando.
--     `has_role()` (INVOKER) lê `user_roles` sob esta policy: para um JWT revogado
--     a leitura já volta vazia, e a própria `has_role()` ainda confere a identidade
--     (defesa em profundidade para quem não passa por RLS).

ALTER POLICY profiles_insert_own ON public.profiles
  WITH CHECK (id = (SELECT auth.uid()) AND (SELECT public.identidade_atual_utilizavel()));
ALTER POLICY profiles_update_own ON public.profiles
  USING (id = (SELECT auth.uid()) AND (SELECT public.identidade_atual_utilizavel()))
  WITH CHECK (id = (SELECT auth.uid()) AND (SELECT public.identidade_atual_utilizavel()));
ALTER POLICY profiles_select_own_or_admin ON public.profiles
  USING ((id = (SELECT auth.uid()) AND (SELECT public.identidade_atual_utilizavel()))
         OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
ALTER POLICY user_roles_select_own ON public.user_roles
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.identidade_atual_utilizavel()));


-- ---------------------------------------------------------------------------
-- 6. Autoverificação (estrutura e privilégios; não depende de dados)
-- ---------------------------------------------------------------------------

DO $verificacao$
DECLARE
  _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('conta_ativa', 'identidade_atual_utilizavel')
     AND p.prosecdef
     AND pg_get_userbyid(p.proowner) = 'postgres'
     AND coalesce(array_to_string(p.proconfig, ''), '') = 'search_path=pg_catalog, public';
  IF _n <> 2 THEN
    RAISE EXCEPTION '020: as 2 helpers deveriam ser SECURITY DEFINER do postgres com search_path fixo, encontrei %', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('has_role', 'is_staff')
     AND NOT p.prosecdef;
  IF _n <> 2 THEN
    RAISE EXCEPTION '020: has_role e is_staff deveriam continuar SECURITY INVOKER, encontrei % invoker', _n;
  END IF;

  IF has_function_privilege('authenticated', 'public.conta_ativa(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.conta_ativa(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.conta_ativa(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '020: conta_ativa(uuid) nao pode ser executavel por authenticated, anon nem PUBLIC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.conta_ativa(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '020: service_role precisa executar conta_ativa(uuid) (trigger do ultimo admin)';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.identidade_atual_utilizavel()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.identidade_atual_utilizavel()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.identidade_atual_utilizavel()', 'EXECUTE')
     OR has_function_privilege('public', 'public.identidade_atual_utilizavel()', 'EXECUTE') THEN
    RAISE EXCEPTION '020: identidade_atual_utilizavel() deve ser executavel por authenticated e service_role, e so por eles';
  END IF;

  IF has_function_privilege('bslog_rpc_operacional', 'public.conta_ativa(uuid)', 'EXECUTE')
     OR has_function_privilege('bslog_rpc_operacional', 'public.identidade_atual_utilizavel()', 'EXECUTE') THEN
    RAISE EXCEPTION '020: bslog_rpc_operacional nao pode ganhar EXECUTE nas helpers novas';
  END IF;

  SELECT count(*) INTO _n FROM pg_trigger
   WHERE tgname = 'trg_proteger_ultimo_admin' AND NOT tgisinternal;
  IF _n <> 1 THEN
    RAISE EXCEPTION '020: trg_proteger_ultimo_admin deveria continuar existindo, encontrei %', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'proteger_ultimo_admin'
     AND p.prosrc LIKE '%conta_ativa%'
     AND p.prosrc LIKE '%pg_advisory_xact_lock%';
  IF _n <> 1 THEN
    RAISE EXCEPTION '020: proteger_ultimo_admin deveria usar conta_ativa e manter o advisory lock';
  END IF;

  -- As 4 policies de linha própria referenciam a identidade utilizável (o nome da
  -- função aparece literalmente na expressão, então a checagem não depende do
  -- formato com que o Postgres imprime a subconsulta).
  SELECT count(*) INTO _n
    FROM pg_policy pol
   WHERE (pol.polrelid, pol.polname) IN (
           ('public.profiles'::regclass::oid,   'profiles_insert_own'),
           ('public.profiles'::regclass::oid,   'profiles_update_own'),
           ('public.profiles'::regclass::oid,   'profiles_select_own_or_admin'),
           ('public.user_roles'::regclass::oid, 'user_roles_select_own'))
     AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
          || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
         LIKE '%identidade_atual_utilizavel%';
  IF _n <> 4 THEN
    RAISE EXCEPTION '020: as 4 policies de linha propria deveriam exigir identidade_atual_utilizavel(), encontrei %', _n;
  END IF;

  -- Nenhuma policy foi criada nem removida, e as RESTRICTIVE continuam sendo 23
  -- (11 *_exige_aal2, 10 *_exige_admin, admin_audit_log e user_operation_access).
  SELECT count(*) INTO _n FROM pg_policy pol
   WHERE pol.polrelid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace)
     AND NOT pol.polpermissive;
  IF _n <> 23 THEN
    RAISE EXCEPTION '020: esperava 23 policies RESTRICTIVE em public, encontrei %', _n;
  END IF;
END;
$verificacao$;
