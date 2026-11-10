-- Impressão digital do banco (somente leitura).
--
-- Devolve UMA linha com um JSON que resume migrations, contagens, Auth e o
-- catálogo (tabelas, RLS, funções, gatilhos, políticas, índices, restrições,
-- privilégios). Serve para comparar três estados do mesmo banco:
--   1. o HML remoto, antes de qualquer alteração;
--   2. a cópia restaurada em Supabase local isolado;
--   3. o estado depois do expurgo (cópia local no ensaio; HML na execução real).
--
-- Só SELECT, dentro de transação READ ONLY. Não imprime e-mail, senha, token
-- nem conteúdo de linha: apenas contagens e hashes md5 de definições.
-- Uso (HML, com a referência explícita):
--   supabase db query --linked --project-ref qbnfcmrxmssnwkhaitgd -f hml-impressao-digital.sql -o json
-- Ver docs/runbooks/limpeza-hml-sintetico.md.

BEGIN TRANSACTION READ ONLY;

SELECT jsonb_build_object(
  'migrations', (
    SELECT jsonb_build_object(
      'total', count(*),
      'head', max(version),
      'md5', md5(coalesce(string_agg(version, ',' ORDER BY version), ''))
    ) FROM supabase_migrations.schema_migrations
  ),
  'contagem_public', (
    SELECT jsonb_object_agg(t.table_name, (xpath('/row/c/text()',
             query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text::int
           ORDER BY t.table_name)
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ),
  'auth', jsonb_build_object(
    'users', (SELECT count(*) FROM auth.users),
    'identities', (SELECT count(*) FROM auth.identities),
    'mfa_factors', (SELECT count(*) FROM auth.mfa_factors),
    -- Hash dos IDs (não do conteúdo): prova que as MESMAS contas existem.
    'users_ids_md5', (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM auth.users)
  ),
  'identidade_public', jsonb_build_object(
    'profiles_md5', (SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) FROM public.profiles p),
    'user_roles_md5', (SELECT md5(coalesce(string_agg(r::text, '|' ORDER BY r.user_id, r.role), '')) FROM public.user_roles r)
  ),
  'configuracao', jsonb_build_object(
    'motor_md5', (SELECT md5(coalesce(string_agg(s::text, '|'), '')) FROM public.financial_engine_settings s),
    'tarifas_md5', (SELECT md5(coalesce(string_agg(s::text, '|'), '')) FROM public.pricing_settings s),
    'funcoes_md5', (SELECT md5(coalesce(string_agg(j::text, '|' ORDER BY j.code), '')) FROM public.job_functions j),
    'municipios_md5', (SELECT md5(coalesce(string_agg(m::text, '|' ORDER BY m.code), '')) FROM public.municipality_catalog m),
    'auditoria_admin_md5', (SELECT md5(coalesce(string_agg(a::text, '|' ORDER BY a.id), '')) FROM public.admin_audit_log a)
  ),
  'catalogo', jsonb_build_object(
    'tabelas', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'),
    'tabelas_com_rls', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity),
    'funcoes', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'gatilhos', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace),
    'gatilhos_desabilitados', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND t.tgenabled <> 'O'),
    'politicas', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
    'indices', (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'),
    'restricoes', (SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace),
    'fn_md5', (SELECT md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                  || md5(p.prosrc) || p.prosecdef::text || coalesce(p.proconfig::text, ''), '|'
                  ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), ''))
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'fn_donos_md5', (SELECT md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                  || pg_get_userbyid(p.proowner), '|' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), ''))
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'fn_privilegios_md5', (SELECT md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                  || coalesce(p.proacl::text, ''), '|' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), ''))
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'gatilhos_md5', (SELECT md5(coalesce(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), '|'
                  ORDER BY c.relname, t.tgname), ''))
               FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
               WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace),
    'politicas_md5', (SELECT md5(coalesce(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text
                  || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname), ''))
               FROM pg_policies WHERE schemaname = 'public'),
    'rls_md5', (SELECT md5(coalesce(string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text, '|' ORDER BY c.relname), ''))
               FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'),
    'privilegios_tabela_md5', (SELECT md5(coalesce(string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), '|' ORDER BY c.relname), ''))
               FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'S', 'v')),
    'privilegios_coluna_md5', (SELECT md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, '|' ORDER BY c.relname, a.attname), ''))
               FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
               WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL),
    'donos_tabela_md5', (SELECT md5(coalesce(string_agg(c.relname || ':' || pg_get_userbyid(c.relowner), '|' ORDER BY c.relname), ''))
               FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'),
    'colunas_md5', (SELECT md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
                  || ':' || coalesce(column_default, ''), '|' ORDER BY table_name, ordinal_position), ''))
               FROM information_schema.columns WHERE table_schema = 'public'),
    'event_triggers_md5', (SELECT md5(coalesce(string_agg(e.evtname || ':' || e.evtevent || ':' || e.evtenabled::text || ':' || coalesce(e.evttags::text, '') || ':' || p.proname, '|'
                  ORDER BY e.evtname), ''))
               FROM pg_event_trigger e JOIN pg_proc p ON p.oid = e.evtfoid),
    'indices_md5', (SELECT md5(coalesce(string_agg(indexdef, '|' ORDER BY indexname), '')) FROM pg_indexes WHERE schemaname = 'public'),
    'restricoes_md5', (SELECT md5(coalesce(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), '|'
                  ORDER BY conrelid::regclass::text, conname), ''))
               FROM pg_constraint WHERE connamespace = 'public'::regnamespace)
  ),
  'extensoes', (SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension)
) AS impressao_digital;

COMMIT;
