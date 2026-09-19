-- 016 — acesso direto às tabelas de negócio passa a exigir AAL2 **e** admin
--
-- O QUE ESTA MIGRATION CORRIGE
--
-- As policies permissivas originais (migration de 03/09) liberam as tabelas de
-- negócio para `authenticated` por `public.is_staff()`, que é
--
--   SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
--
-- isto é: **qualquer papel atribuído**, não só `admin`. Enquanto o único papel
-- real era `admin`, isso e "é admin" coincidiam. Deixaram de coincidir quando a
-- `013` criou a superfície operacional e a `015` passou a aceitar o operador em
-- `aal2`: uma conta `operacional` que conclui o TOTP chega em `aal2`, a
-- RESTRICTIVE `*_exige_aal2` passa, a permissiva por `is_staff()` passa, e ela
-- alcança as dez tabelas **direto pelo PostgREST** — contornando a superfície
-- estreita inteira.
--
-- Medido no harness, antes desta migration, com uma conta só de papel
-- `operacional`: SELECT devolvia linha em `clients`, `contracts`, `employees`,
-- `operations`, `shifts`, `operation_team`, `timesheets`, `timesheet_entries`,
-- `invoices` e `invoice_items`; atravessavam `clients.doc`, `contact_name`,
-- `email`, `phone`, as quatro taxas do contrato, `employees.doc`, `phone` e
-- `daily_cost`, `operations.agreed_amount`, `billed_amount`, `cost_amount`, os
-- snapshots e `invoice_id`, e os totais de `invoices`/`invoice_items`; e o
-- UPDATE passava em `operations`, `shifts`, `timesheets`, `timesheet_entries` e
-- `operation_team`, com DELETE em `operation_team`. Nada disso é o que a
-- superfície operacional entrega — ela nunca deixou valor financeiro nem PII
-- atravessar.
--
-- O DESENHO, E POR QUE ESTE
--
-- Uma policy RESTRICTIVE nova por tabela, exigindo `admin`. RESTRICTIVE entra
-- em `AND` com tudo o que já existe, então o resultado é
--
--   acesso direto de `authenticated`  =  AAL2  E  admin
--
-- sem tocar em uma linha das policies permissivas, das `*_exige_aal2`, dos
-- grants, dos triggers ou das cinco RPCs. É a menor mudança que fecha o buraco,
-- e é aditiva: nada existente muda de significado.
--
-- POR QUE NÃO MEXER EM `is_staff()`
--
-- Redefinir `is_staff()` como "é admin" seria mais curto e muito pior: a função
-- é usada por policies de várias migrations aplicadas e por código que não está
-- nesta transação, e mudar o significado dela por baixo altera o
-- comportamento de tudo o que a chama, de uma vez, sem que nenhuma dessas
-- policies diga o que passou a valer. A RESTRICTIVE nova diz exatamente o que
-- faz, no lugar onde é lida.
--
-- O QUE FICA DE FORA, DE PROPÓSITO
--
-- `profiles` — cada conta lê e edita a própria linha, inclusive a operacional;
--              é o que a tela de sessão usa, e não carrega dado de negócio.
-- `user_roles` — é lida em AAL1, antes do MFA, pelo guard. Bloqueá-la cria o
--              deadlock já registrado no CLAUDE.md.
-- `user_operation_access` — já é admin + AAL2, por policy permissiva e por
--              RESTRICTIVE de mesmo predicado, desde a `013`.
--
-- AS CINCO RPCs NÃO SÃO AFETADAS. Elas pertencem a `bslog_rpc_operacional`,
-- que tem `BYPASSRLS`: policy nenhuma as alcança, nem esta. É por isso que o
-- operador continua apontando normalmente, em `aal1` e em `aal2`, pela mesma
-- superfície estreita — que passa a ser, de fato, a **única** porta dele.

-- ---------------------------------------------------------------------------
-- 1. As dez policies
-- ---------------------------------------------------------------------------
--
-- `(SELECT public.has_role(...))` entre parênteses, como nas `*_exige_aal2`: o
-- planejador trata a subconsulta como InitPlan e avalia uma vez por comando, e
-- não uma vez por linha.
--
-- `FOR ALL` com USING e WITH CHECK cobre as quatro operações: USING filtra
-- SELECT, UPDATE e DELETE; WITH CHECK alcança INSERT e o estado final do
-- UPDATE. Só USING deixaria INSERT passar.
--
-- `TO authenticated` é o alcance inteiro desta mudança: `postgres`,
-- `service_role` e `bslog_rpc_operacional` não são afetados por policy dirigida
-- a outro papel — e os dois últimos já não eram, por BYPASSRLS.

CREATE POLICY clients_exige_admin ON public.clients
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY contracts_exige_admin ON public.contracts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY employees_exige_admin ON public.employees
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY operations_exige_admin ON public.operations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY shifts_exige_admin ON public.shifts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY operation_team_exige_admin ON public.operation_team
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY timesheets_exige_admin ON public.timesheets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY timesheet_entries_exige_admin ON public.timesheet_entries
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY invoices_exige_admin ON public.invoices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

CREATE POLICY invoice_items_exige_admin ON public.invoice_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

COMMENT ON POLICY clients_exige_admin ON public.clients IS
  'RESTRICTIVE: acesso direto de authenticated as tabelas de negocio exige papel admin, alem do aal2 da policy *_exige_aal2. O papel operacional acessa dado operacional somente pelas cinco RPCs da superficie estreita (013/015), que rodam como bslog_rpc_operacional e nao passam por policy.';

-- ---------------------------------------------------------------------------
-- 2. Autoverificação — a migration recusa a si mesma se algo não bater
-- ---------------------------------------------------------------------------
--
-- Mesmo espírito da 013 e da 015: aplicar pela metade aqui seria pior do que
-- não aplicar, porque a promessa é de fechamento.

DO $verificacao$
DECLARE
  _tabelas text[] := ARRAY['clients','contracts','employees','operations','shifts',
                           'operation_team','timesheets','timesheet_entries',
                           'invoices','invoice_items'];
  _n int;
BEGIN
  -- 2.1 as dez policies existem, RESTRICTIVE, FOR ALL, TO authenticated
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname = tablename || '_exige_admin'
     AND tablename = ANY (_tabelas)
     AND permissive = 'RESTRICTIVE'
     AND cmd = 'ALL'
     AND roles = ARRAY['authenticated']::name[];
  IF _n <> 10 THEN
    RAISE EXCEPTION '016: esperava 10 policies *_exige_admin RESTRICTIVE/ALL/authenticated, encontrei %', _n;
  END IF;

  -- 2.2 as onze *_exige_aal2 continuam onde estavam
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname LIKE '%\_exige\_aal2'
     AND permissive = 'RESTRICTIVE';
  IF _n <> 11 THEN
    RAISE EXCEPTION '016: as 11 policies *_exige_aal2 deveriam seguir intactas, encontrei %', _n;
  END IF;

  -- 2.3 profiles, user_roles e user_operation_access NÃO ganharam a exigência
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname LIKE '%\_exige\_admin'
     AND tablename IN ('profiles','user_roles','user_operation_access');
  IF _n <> 0 THEN
    RAISE EXCEPTION '016: profiles, user_roles e user_operation_access ficam de fora, encontrei % policy', _n;
  END IF;

  -- 2.4 as cinco RPCs seguem existindo e pertencendo ao papel dedicado
  SELECT count(*) INTO _n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND r.rolname = 'bslog_rpc_operacional'
     AND p.proname IN ('listar_operacoes_do_operador','listar_turnos_do_operador',
                       'listar_equipe_do_operador','listar_apontamentos_do_operador',
                       'salvar_apontamento_operacional');
  IF _n <> 5 THEN
    RAISE EXCEPTION '016: as 5 RPCs deveriam seguir com dono bslog_rpc_operacional, encontrei %', _n;
  END IF;

  -- 2.5 o papel dedicado continua com BYPASSRLS — é o que mantém a RPC viva
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bslog_rpc_operacional' AND rolbypassrls) THEN
    RAISE EXCEPTION '016: bslog_rpc_operacional precisa manter BYPASSRLS';
  END IF;

  -- 2.6 nenhum privilégio de TABELA apareceu para o papel dedicado
  SELECT count(*) INTO _n
    FROM information_schema.table_privileges
   WHERE grantee = 'bslog_rpc_operacional';
  IF _n <> 0 THEN
    RAISE EXCEPTION '016: o papel dedicado nao pode ter privilegio de tabela, encontrei %', _n;
  END IF;

  -- 2.7 nem privilégio em coluna financeira
  SELECT count(*) INTO _n
    FROM information_schema.column_privileges
   WHERE grantee = 'bslog_rpc_operacional'
     AND column_name IN ('billed_amount','cost_amount','invoice_id','daily_cost',
                         'agreed_amount','daily_rate_snapshot','ot_hour_rate_snapshot',
                         'daily_cost_snapshot');
  IF _n <> 0 THEN
    RAISE EXCEPTION '016: coluna financeira nao pode ser concedida ao papel dedicado, encontrei %', _n;
  END IF;
END
$verificacao$;
