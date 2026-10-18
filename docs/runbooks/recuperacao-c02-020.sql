-- RECUPERACAO EMERGENCIAL DA MIGRATION 20261018120000_020_revogacao_de_identidade (C02).
-- *** REVERTER A 020 REABRE A VULNERABILIDADE C02 ***: JWT de conta banida, excluida ou deslogada volta a ser
-- autorizado pela RLS e pelas RPCs ate o `exp`. Use so como medida excepcional, com decisao de quem responde
-- pelo projeto, e planeje a correcao definitiva (roll-forward) em seguida.
--
-- O QUE FAZ: restaura has_role(), is_staff() e proteger_ultimo_admin() ao corpo de 20260903175718 e 20260928120000;
-- volta as 29 policies a expressao anterior; remove conta_ativa() e identidade_atual_utilizavel().
-- O QUE NAO FAZ: nao toca dados de negocio, usuarios, papeis, sessoes, grants de tabela, RLS/FORCE RLS,
-- migration 019 nem supabase_migrations.schema_migrations (o historico se trata a parte, por migration compensatoria).
--
-- COMO RODAR: arquivo inteiro, UMA execucao, como `postgres`. Tudo (pre-condicoes, mudancas e autoverificacao) esta
-- numa transacao: qualquer divergencia aborta e nada muda. Confirme o COMMIT consultando, em outra aba,
-- `to_regprocedure('public.identidade_atual_utilizavel()')` (deve ser NULL).
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- 0. Pre-condicoes: so reverte exatamente o que a 020 instalou
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE _n int; _h text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'recuperacao 020: executor deve ser postgres (e %)', current_user;
  END IF;
  IF to_regprocedure('public.conta_ativa(uuid)') IS NULL OR to_regprocedure('public.identidade_atual_utilizavel()') IS NULL THEN
    RAISE EXCEPTION 'recuperacao 020: helpers ausentes (a 020 nao esta aplicada, ou a recuperacao ja rodou); nada a fazer';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND ((p.proname = 'conta_ativa' AND md5(p.prosrc) = 'cd95a4197626581ef0bb329d06a3f24a')
       OR (p.proname = 'identidade_atual_utilizavel' AND md5(p.prosrc) = '9df11554556a84c3379681fefcfc5bbd')
       OR (p.proname = 'has_role' AND md5(p.prosrc) = 'be34616bab3c5127045d92e66e3b5c5d')
       OR (p.proname = 'is_staff' AND md5(p.prosrc) = '2fead5917b8dd04bcd3c408848b3ddcf')
       OR (p.proname = 'proteger_ultimo_admin' AND md5(p.prosrc) = '0ebfa8cc1a7631eeeb5295cf4b7075b7'));
  IF _n <> 5 THEN
    RAISE EXCEPTION 'recuperacao 020: os 5 corpos de funcao nao sao os da 020 (encontrei % de 5); alguem alterou o estado depois da 020', _n;
  END IF;
  -- nenhuma OUTRA funcao pode chamar as helpers (apagar quebraria em silencio, corpo PL/pgSQL nao entra em pg_depend)
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p.prosrc ~* '(conta_ativa|identidade_atual_utilizavel)'
     AND NOT (p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('conta_ativa','identidade_atual_utilizavel','has_role','is_staff','proteger_ultimo_admin'));
  IF _n <> 0 THEN
    RAISE EXCEPTION 'recuperacao 020: % funcao(oes) alem das esperadas referenciam as helpers', _n;
  END IF;
  -- dependentes SQL declarados: so podem ser as policies de profiles/user_roles
  SELECT count(*) INTO _n FROM pg_depend d
   WHERE d.refobjid IN ('public.conta_ativa(uuid)'::regprocedure, 'public.identidade_atual_utilizavel()'::regprocedure)
     AND d.deptype = 'n' AND d.classid <> 'pg_policy'::regclass;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'recuperacao 020: % dependente(s) inesperado(s) das helpers fora de policies', _n;
  END IF;
  SELECT count(*) INTO _n FROM pg_policies WHERE schemaname = 'public';
  IF _n <> 50 THEN RAISE EXCEPTION 'recuperacao 020: esperava 50 policies em public, encontrei %', _n; END IF;
  SELECT count(*) INTO _n FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE';
  IF _n <> 23 THEN RAISE EXCEPTION 'recuperacao 020: esperava 23 policies RESTRICTIVE, encontrei %', _n; END IF;
  SELECT md5(string_agg(policyname || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-'), E'\n' ORDER BY policyname COLLATE "C")) INTO _h FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('admin_audit_log_exige_admin_aal2','admin_audit_log_leitura_admin','clients_select_staff','clients_write_admin','contracts_select_staff','contracts_write_admin','employees_select_staff','employees_write_admin','invoices_select_staff','invoices_write_admin','invoice_items_select_staff','invoice_items_write_admin','operations_select_staff','operations_update_staff','operations_insert_admin','operations_delete_admin','shifts_select_staff','shifts_update_staff','shifts_insert_admin','shifts_delete_admin','operation_team_staff','timesheets_staff','timesheet_entries_staff','user_operation_access_admin','user_operation_access_somente_admin_aal2','profiles_insert_own','profiles_update_own','profiles_select_own_or_admin','user_roles_select_own');
  IF _h IS DISTINCT FROM '39f95ab3444702c7094abae713c2ce26' THEN
    RAISE EXCEPTION 'recuperacao 020: as 29 policies nao estao como a 020 as deixou (hash %)', _h;
  END IF;
  SELECT count(*) INTO _n FROM pg_trigger WHERE tgname = 'trg_proteger_ultimo_admin' AND NOT tgisinternal;
  IF _n <> 1 THEN RAISE EXCEPTION 'recuperacao 020: trigger trg_proteger_ultimo_admin ausente'; END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Policies: expressao original (catalogo gerado so pelas 24 migrations da main)
--    As 4 de linha propria saem primeiro da dependencia de identidade_atual_utilizavel().
-- ---------------------------------------------------------------------------
ALTER POLICY admin_audit_log_exige_admin_aal2 ON public.admin_audit_log
  USING (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)));
ALTER POLICY admin_audit_log_leitura_admin ON public.admin_audit_log
  USING (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)));
ALTER POLICY clients_select_staff ON public.clients
  USING (is_staff());
ALTER POLICY clients_write_admin ON public.clients
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY contracts_select_staff ON public.contracts
  USING (is_staff());
ALTER POLICY contracts_write_admin ON public.contracts
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY employees_select_staff ON public.employees
  USING (is_staff());
ALTER POLICY employees_write_admin ON public.employees
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY invoices_select_staff ON public.invoices
  USING (is_staff());
ALTER POLICY invoices_write_admin ON public.invoices
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY invoice_items_select_staff ON public.invoice_items
  USING (is_staff());
ALTER POLICY invoice_items_write_admin ON public.invoice_items
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY operations_select_staff ON public.operations
  USING (is_staff());
ALTER POLICY operations_update_staff ON public.operations
  USING (is_staff())
  WITH CHECK (is_staff());
ALTER POLICY operations_insert_admin ON public.operations
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY operations_delete_admin ON public.operations
  USING (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY shifts_select_staff ON public.shifts
  USING (is_staff());
ALTER POLICY shifts_update_staff ON public.shifts
  USING (is_staff())
  WITH CHECK (is_staff());
ALTER POLICY shifts_insert_admin ON public.shifts
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY shifts_delete_admin ON public.shifts
  USING (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY operation_team_staff ON public.operation_team
  USING (is_staff())
  WITH CHECK (is_staff());
ALTER POLICY timesheets_staff ON public.timesheets
  USING (is_staff())
  WITH CHECK (is_staff());
ALTER POLICY timesheet_entries_staff ON public.timesheet_entries
  USING (is_staff())
  WITH CHECK (is_staff());
ALTER POLICY user_operation_access_admin ON public.user_operation_access
  USING (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)));
ALTER POLICY user_operation_access_somente_admin_aal2 ON public.user_operation_access
  USING (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND has_role(auth.uid(), 'admin'::app_role)));
ALTER POLICY profiles_insert_own ON public.profiles
  WITH CHECK ((id = auth.uid()));
ALTER POLICY profiles_update_own ON public.profiles
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));
ALTER POLICY profiles_select_own_or_admin ON public.profiles
  USING (((id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
ALTER POLICY user_roles_select_own ON public.user_roles
  USING ((user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Funcoes: corpo EXATO do historico versionado (CREATE OR REPLACE preserva owner e ACL)
-- ---------------------------------------------------------------------------
-- 20260903175718_49252bbc: has_role e is_staff (SECURITY INVOKER, search_path = public)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid());
$$;

-- 20260928120000_017: ultimo admin (contagem de linhas, com advisory lock)
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

  SELECT count(*) INTO restantes
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
    AND id <> OLD.id;

  IF restantes = 0 THEN
    RAISE EXCEPTION 'Não é possível remover ou rebaixar o único administrador restante.'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- comentarios: a 020 comentou has_role/is_staff (antes sem comentario) e reescreveu o de proteger_ultimo_admin
COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS NULL;
COMMENT ON FUNCTION public.is_staff() IS NULL;
COMMENT ON FUNCTION public.proteger_ultimo_admin() IS
'Recusa DELETE/UPDATE em user_roles que removeria a ultima linha role=admin. Serializado por pg_advisory_xact_lock contra corrida entre transacoes concorrentes. Sem excecao de papel — nao ha caminho legitimo para essa operacao, ao contrario das guardas financeiras da 010/011.';

-- ---------------------------------------------------------------------------
-- 3. Remove as helpers (RESTRICT: aborta se algo ainda depender delas)
-- ---------------------------------------------------------------------------
DROP FUNCTION public.identidade_atual_utilizavel() RESTRICT;
DROP FUNCTION public.conta_ativa(uuid) RESTRICT;

-- ---------------------------------------------------------------------------
-- 4. Autoverificacao: se qualquer item divergir, a transacao inteira e desfeita
-- ---------------------------------------------------------------------------
DO $pos$
DECLARE _n int; _h text; _acl text;
BEGIN
  IF to_regprocedure('public.conta_ativa(uuid)') IS NOT NULL OR to_regprocedure('public.identidade_atual_utilizavel()') IS NOT NULL THEN
    RAISE EXCEPTION 'recuperacao 020: helpers ainda existem';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND ((p.proname = 'has_role' AND md5(p.prosrc) = '4e852b30ef52ba5263c4e11d1aec8cf0' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR (p.proname = 'is_staff' AND md5(p.prosrc) = '3de3f52763de2b7c25ca64e81c69a098' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR (p.proname = 'proteger_ultimo_admin' AND md5(p.prosrc) = '94f7ede94e766abc6fc3a4bda2d43573' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']))
     AND pg_get_userbyid(p.proowner) = 'postgres';
  IF _n <> 3 THEN RAISE EXCEPTION 'recuperacao 020: as 3 funcoes nao voltaram ao corpo original (% de 3)', _n; END IF;
  SELECT md5(string_agg(policyname || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-'), E'\n' ORDER BY policyname COLLATE "C")) INTO _h FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('admin_audit_log_exige_admin_aal2','admin_audit_log_leitura_admin','clients_select_staff','clients_write_admin','contracts_select_staff','contracts_write_admin','employees_select_staff','employees_write_admin','invoices_select_staff','invoices_write_admin','invoice_items_select_staff','invoice_items_write_admin','operations_select_staff','operations_update_staff','operations_insert_admin','operations_delete_admin','shifts_select_staff','shifts_update_staff','shifts_insert_admin','shifts_delete_admin','operation_team_staff','timesheets_staff','timesheet_entries_staff','user_operation_access_admin','user_operation_access_somente_admin_aal2','profiles_insert_own','profiles_update_own','profiles_select_own_or_admin','user_roles_select_own');
  IF _h IS DISTINCT FROM '43cb8c6a36439592428f46093f369fcf' THEN
    RAISE EXCEPTION 'recuperacao 020: as 29 policies nao voltaram a expressao original (hash %)', _h;
  END IF;
  SELECT count(*) INTO _n FROM pg_policies WHERE schemaname = 'public';
  IF _n <> 50 THEN RAISE EXCEPTION 'recuperacao 020: policies em public = % (esperado 50)', _n; END IF;
  SELECT count(*) INTO _n FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE';
  IF _n <> 23 THEN RAISE EXCEPTION 'recuperacao 020: RESTRICTIVE = % (esperado 23)', _n; END IF;
  SELECT count(*) INTO _n FROM pg_policies WHERE schemaname = 'public'
     AND (coalesce(qual,'') || coalesce(with_check,'')) ~ '(identidade_atual_utilizavel|conta_ativa)';
  IF _n <> 0 THEN RAISE EXCEPTION 'recuperacao 020: % policy(ies) ainda referencia(m) as helpers', _n; END IF;
  SELECT count(DISTINCT d.objid) INTO _n FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
   WHERE d.classid = 'pg_policy'::regclass AND p.proname IN ('has_role','is_staff') AND p.pronamespace = 'public'::regnamespace;
  IF _n <> 36 THEN RAISE EXCEPTION 'recuperacao 020: policies dependentes de has_role/is_staff = % (esperado 36)', _n; END IF;
  IF NOT (has_function_privilege('authenticated','public.has_role(uuid,public.app_role)','EXECUTE')
          AND has_function_privilege('service_role','public.has_role(uuid,public.app_role)','EXECUTE')
          AND has_function_privilege('authenticated','public.is_staff()','EXECUTE')
          AND has_function_privilege('service_role','public.is_staff()','EXECUTE'))
     OR has_function_privilege('anon','public.has_role(uuid,public.app_role)','EXECUTE')
     OR has_function_privilege('anon','public.is_staff()','EXECUTE')
     OR has_function_privilege('public','public.has_role(uuid,public.app_role)','EXECUTE')
     OR has_function_privilege('public','public.is_staff()','EXECUTE')
     OR has_function_privilege('bslog_rpc_operacional','public.has_role(uuid,public.app_role)','EXECUTE')
     OR has_function_privilege('bslog_rpc_operacional','public.is_staff()','EXECUTE') THEN
    RAISE EXCEPTION 'recuperacao 020: grants de has_role/is_staff diferentes do original';
  END IF;
  SELECT proacl::text INTO _acl FROM pg_proc WHERE oid = 'public.proteger_ultimo_admin()'::regprocedure;
  IF _acl IS DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'recuperacao 020: ACL de proteger_ultimo_admin diferente (%)', _acl; END IF;
  IF obj_description('public.has_role(uuid,public.app_role)'::regprocedure, 'pg_proc') IS NOT NULL
     OR obj_description('public.is_staff()'::regprocedure, 'pg_proc') IS NOT NULL THEN
    RAISE EXCEPTION 'recuperacao 020: comentarios de has_role/is_staff deveriam estar vazios';
  END IF;
  SELECT count(*) INTO _n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;
  IF _n <> 14 THEN RAISE EXCEPTION 'recuperacao 020: RLS/FORCE RLS divergentes (% de 14)', _n; END IF;
  SELECT count(*) INTO _n FROM pg_trigger WHERE tgname = 'trg_proteger_ultimo_admin' AND NOT tgisinternal;
  IF _n <> 1 THEN RAISE EXCEPTION 'recuperacao 020: trigger do ultimo admin ausente'; END IF;
END
$pos$;

COMMIT;
