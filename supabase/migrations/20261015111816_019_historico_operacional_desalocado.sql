-- Histórico operacional após remoção física do vínculo em operation_team.
-- Preparada para revisão: não aplicar sem autorização própria.
--
-- Os parâmetros e as onze colunas anteriores permanecem na mesma ordem.
-- Nome/função são os atuais de employees, não snapshots da data trabalhada.
-- Só entram colaboradores das linhas da folha autorizada, nunca a equipe de
-- outra operação ou de outra data. Folha sem linhas mantém a linha-sentinela.
--
-- A mudança de RETURNS TABLE exige recriação. A transação impede que outras
-- sessões observem a ausência da função ou seus privilégios de criação.
-- Dependências de chamadas dinâmicas/PLpgSQL podem não constar em pg_depend;
-- a revisão dos consumidores continua necessária antes de aplicar.

BEGIN;
SET LOCAL search_path = pg_catalog, public;

DO $migration$
DECLARE
  _antes pg_catalog.pg_proc%ROWTYPE;
  _depois pg_catalog.pg_proc%ROWTYPE;
  _owner oid := 'bslog_rpc_operacional'::regrole;
  _authenticated oid := 'authenticated'::regrole;
  _acl_antes text[];
  _acl_depois text[];
  _dependentes text;
  _create_temporario boolean := false;
BEGIN
  -- O executor esperado é o mesmo das migrations anteriores, sem pressupor
  -- superusuário: a transferência de posse exige membership e CREATE.
  IF current_user <> 'postgres'
     OR NOT pg_has_role(current_user, _owner, 'MEMBER') THEN
    RAISE EXCEPTION '019: executor inesperado ou sem membership no owner da RPC.';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname = 'listar_apontamentos_do_operador') <> 1 THEN
    RAISE EXCEPTION '019: RPC ausente ou com sobrecargas inesperadas.';
  END IF;

  SELECT * INTO STRICT _antes
    FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.listar_apontamentos_do_operador(uuid,uuid,date)');

  IF _antes.prokind <> 'f'
     OR _antes.pronargs <> 3
     OR _antes.pronargdefaults <> 0
     OR _antes.provariadic <> 0
     OR NOT _antes.proretset
     OR _antes.prorettype <> 'record'::regtype
     OR _antes.proallargtypes IS DISTINCT FROM ARRAY[
       'uuid'::regtype::oid, 'uuid'::regtype::oid, 'date'::regtype::oid,
       'uuid'::regtype::oid, 'uuid'::regtype::oid, 'date'::regtype::oid,
       'public.timesheet_status'::regtype::oid, 'uuid'::regtype::oid,
       'public.attendance_status'::regtype::oid, 'time'::regtype::oid,
       'time'::regtype::oid, 'integer'::regtype::oid, 'text'::regtype::oid,
       'boolean'::regtype::oid
     ]
     OR _antes.proargmodes IS DISTINCT FROM
       array_fill('i'::"char", ARRAY[3]) || array_fill('t'::"char", ARRAY[11])
     OR _antes.proargnames IS DISTINCT FROM ARRAY[
       'p_operation_id', 'p_shift_id', 'p_work_date',
       'timesheet_id', 'shift_id', 'work_date', 'folha_status', 'employee_id',
       'status', 'check_in', 'check_out', 'break_minutes', 'notes', 'faturado'
     ] THEN
    RAISE EXCEPTION '019: assinatura ou retorno diferente do contrato anterior.';
  END IF;

  IF _antes.proowner <> _owner
     OR NOT _antes.prosecdef
     OR _antes.provolatile <> 's'
     OR _antes.proparallel <> 'u'
     OR _antes.proisstrict
     OR _antes.proleakproof
     OR _antes.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
     OR _antes.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
     -- Hash exato de prosrc da migration 013: aborta inclusive diante de
     -- alterações locais ao corpo, em vez de sobrescrever regras desconhecidas.
     OR md5(_antes.prosrc) <> '5d3fb6306bb41fca3ce53111e2e7d19f' THEN
    RAISE EXCEPTION '019: owner, atributos, search_path ou corpo da RPC divergentes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = _owner
       AND (rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole
            OR rolreplication OR NOT rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(papel)
     WHERE pg_has_role(r.papel, _owner, 'MEMBER')
  ) OR NOT has_schema_privilege(_owner, 'public', 'USAGE')
    OR has_schema_privilege(_owner, 'public', 'CREATE') THEN
    RAISE EXCEPTION '019: atributos, memberships ou privilégios de schema do owner divergentes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM aclexplode(coalesce(_antes.proacl, acldefault('f', _owner))) AS a
     WHERE a.grantor <> _owner OR a.grantee NOT IN (_owner, _authenticated)
        OR a.privilege_type <> 'EXECUTE' OR a.is_grantable
  ) OR (SELECT count(*) FROM aclexplode(coalesce(_antes.proacl, acldefault('f', _owner)))) <> 2
    OR NOT has_function_privilege(_authenticated, _antes.oid, 'EXECUTE')
    OR has_function_privilege('anon', _antes.oid, 'EXECUTE')
    OR has_function_privilege('service_role', _antes.oid, 'EXECUTE') THEN
    RAISE EXCEPTION '019: ACL da RPC diferente de owner + authenticated, sem grant option.';
  END IF;

  SELECT array_agg(format('%s:%s:%s:%s', a.grantor, a.grantee,
                          a.privilege_type, a.is_grantable) ORDER BY a.grantor, a.grantee,
                          a.privilege_type, a.is_grantable)
    INTO _acl_antes
    FROM aclexplode(_antes.proacl) AS a;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['id', 'name', 'role']) AS c(coluna)
     WHERE NOT has_column_privilege(_owner, 'public.employees', c.coluna, 'SELECT')
  ) OR has_table_privilege(_owner, 'public.employees', 'SELECT')
    OR NOT has_function_privilege(_owner, 'public.operador_autorizado(uuid)', 'EXECUTE')
    OR NOT has_function_privilege(_owner, 'public.apontamento_faturado(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '019: grants por coluna ou execução dos helpers divergentes.';
  END IF;

  -- Recusa inclusive dependências automáticas que RESTRICT poderia remover.
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), '; ')
    INTO _dependentes
    FROM pg_catalog.pg_depend AS d
   WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass AND d.refobjid = _antes.oid;
  IF _dependentes IS NOT NULL THEN
    RAISE EXCEPTION '019: dependentes inesperados da RPC: %.', _dependentes;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS d
     WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = _antes.oid
       AND d.deptype <> 'n'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_seclabel AS s
     WHERE s.classoid = 'pg_catalog.pg_proc'::regclass AND s.objoid = _antes.oid
  ) THEN
    RAISE EXCEPTION '019: RPC vinculada a extensão/objeto interno ou com security label.';
  END IF;

  EXECUTE 'DROP FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date) RESTRICT';
  EXECUTE $recriar$
CREATE FUNCTION public.listar_apontamentos_do_operador(
  p_operation_id uuid,
  p_shift_id     uuid,
  p_work_date    date
)
RETURNS TABLE (
  timesheet_id  uuid,
  shift_id      uuid,
  work_date     date,
  folha_status  public.timesheet_status,
  employee_id   uuid,
  status        public.attendance_status,
  check_in      time,
  check_out     time,
  break_minutes integer,
  notes         text,
  faturado      boolean,
  employee_name text,
  employee_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $rpc$
BEGIN
  IF public.operador_autorizado(p_operation_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Operação não autorizada para esta sessão.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shifts s
     WHERE s.id = p_shift_id AND s.operation_id = p_operation_id
  ) THEN
    RAISE EXCEPTION 'Turno informado não pertence à operação.'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
    SELECT t.id, t.shift_id, t.work_date, t.status,
           te.employee_id, te.status, te.check_in, te.check_out,
           te.break_minutes, te.notes,
           public.apontamento_faturado(te.timesheet_id, te.employee_id),
           e.name, e.role
      FROM public.timesheets t
      LEFT JOIN public.timesheet_entries te ON te.timesheet_id = t.id
      LEFT JOIN public.employees e ON e.id = te.employee_id
     WHERE t.operation_id = p_operation_id
       AND t.shift_id     = p_shift_id
       AND t.work_date    = p_work_date
     ORDER BY te.employee_id;
END;
$rpc$;
  $recriar$;

  -- Defaults da plataforma podem conceder EXECUTE ao criar a função. Nada
  -- fica visível fora desta transação antes destas revogações e verificações.
  REVOKE ALL ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)
    FROM PUBLIC, anon, authenticated, service_role;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p,
      LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
     WHERE p.oid = 'public.listar_apontamentos_do_operador(uuid,uuid,date)'::regprocedure
       AND (a.grantee <> p.proowner OR a.grantor <> p.proowner
            OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)
  ) THEN
    RAISE EXCEPTION '019: default ACL inesperada na RPC recriada; transação recusada.';
  END IF;
  GRANT EXECUTE ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)
    TO authenticated;

  -- Mesmo padrão da 013: CREATE só para a transferência, sem grant permanente.
  IF NOT has_schema_privilege(_owner, 'public', 'CREATE') THEN
    GRANT CREATE ON SCHEMA public TO bslog_rpc_operacional;
    _create_temporario := true;
  END IF;
  ALTER FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)
    OWNER TO bslog_rpc_operacional;
  IF _create_temporario THEN
    REVOKE CREATE ON SCHEMA public FROM bslog_rpc_operacional;
  END IF;

  COMMENT ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date) IS
    'Folha e linhas autorizadas por operacao/turno/data, com nome e funcao atuais dos colaboradores apontados, mesmo apos desalocacao. Sem documentos, contatos ou valores financeiros; faturado permanece boolean derivado. Preserva operador_autorizado, AAL e owner dedicado.';

  SELECT * INTO STRICT _depois FROM pg_catalog.pg_proc
   WHERE oid = 'public.listar_apontamentos_do_operador(uuid,uuid,date)'::regprocedure;
  SELECT array_agg(format('%s:%s:%s:%s', a.grantor, a.grantee,
                          a.privilege_type, a.is_grantable) ORDER BY a.grantor, a.grantee,
                          a.privilege_type, a.is_grantable)
    INTO _acl_depois FROM aclexplode(_depois.proacl) AS a;

  IF _depois.proowner <> _antes.proowner
     OR _acl_depois IS DISTINCT FROM _acl_antes
     OR _depois.proargtypes IS DISTINCT FROM _antes.proargtypes
     OR _depois.proallargtypes IS DISTINCT FROM
       _antes.proallargtypes || ARRAY['text'::regtype::oid, 'text'::regtype::oid]
     OR _depois.proargnames IS DISTINCT FROM
       _antes.proargnames || ARRAY['employee_name', 'employee_role']
     OR _depois.proargmodes IS DISTINCT FROM
       _antes.proargmodes || ARRAY['t'::"char", 't'::"char"]
     OR NOT _depois.proretset OR _depois.prorettype <> _antes.prorettype
     OR _depois.prosecdef IS DISTINCT FROM _antes.prosecdef
     OR _depois.provolatile IS DISTINCT FROM _antes.provolatile
     OR _depois.proparallel IS DISTINCT FROM _antes.proparallel
     OR _depois.proisstrict IS DISTINCT FROM _antes.proisstrict
     OR _depois.proleakproof IS DISTINCT FROM _antes.proleakproof
     OR _depois.prolang <> _antes.prolang
     OR _depois.proconfig IS DISTINCT FROM _antes.proconfig
     OR has_schema_privilege(_owner, 'public', 'CREATE') THEN
    RAISE EXCEPTION '019: pós-condições de contrato, owner, ACL ou segurança divergentes.';
  END IF;
END;
$migration$;

-- Entregue somente no COMMIT de uma aplicação futura, nunca na preparação do
-- arquivo. O consumidor TypeScript/interface ainda precisa de etapa própria.
NOTIFY pgrst, 'reload schema';
COMMIT;
