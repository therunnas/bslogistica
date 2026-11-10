-- =============================================================================
-- LIMPEZA DOS DADOS SINTÉTICOS DO HML (bs-logistica-homologacao)
--
-- NÃO EXECUTAR sem autorização específica da pessoa responsável, na janela
-- combinada, depois de backup restaurável (ver limpeza-hml-sintetico.md).
-- A versão 045 deste script foi ensaiada SOMENTE em cópia local restaurada do backup
-- (06/11/2026). Esta versão 050 (10/11/2026) AINDA NÃO FOI ENSAIADA: ver a seção 6
-- do runbook. Não executar no HML antes do ensaio local com 0 FAIL.
--
-- NULL não é false: toda verificação de origem conta como FORA qualquer linha cuja condição
-- de origem sintética não seja comprovadamente verdadeira, com `(condição) IS NOT TRUE`.
-- `NOT (...)`, `NOT LIKE` e `NOT IN` devolvem NULL diante de coluna nula, e o FILTER deixaria
-- a linha fora da contagem (fail-open). Corrigido em 10/11/2026 (feriado legado sem `legal_act`).
--
-- Estado esperado do banco-alvo (migration head 050, 55 migrations): é verificado
-- pelo preflight abaixo; qualquer divergência ABORTA sem alterar nada.
--
-- Como funciona (tudo em UMA transação):
--   1. trava de execução única + travas de tabela (com timeout);
--   2. preflight obrigatório: assinatura do ambiente, todas as tabelas
--      classificadas, ORIGEM SINTÉTICA de cada linha a remover, estado dos gatilhos;
--   3. fotografia (impressão digital) do que deve ficar intacto;
--   4. SÓ SE a linha `bs_limpeza.executar` valer 'SIM': desabilita (um a um, só os
--      que estavam habilitados) os gatilhos de proteção das tabelas-alvo, esvazia a
--      lista EXPLÍCITA de tabelas (TRUNCATE sem CASCADE), remove os resíduos
--      parciais e religa exatamente os gatilhos que desligou;
--   5. validação integral: o que deve permanecer é idêntico à fotografia, os
--      gatilhos voltaram ao estado original e as contagens são as esperadas;
--   6. COMMIT. Qualquer falha em qualquer etapa lança exceção; a transação é
--      desfeita por inteiro (fail-closed). Nada fica pela metade.
--
-- MODO PADRÃO: 'NAO' (ensaio a seco). Faz o preflight, a fotografia e a validação
-- sem alterar nenhum dado. Para executar de verdade, a ÚNICA edição permitida é
-- trocar 'NAO' por 'SIM' na linha marcada abaixo (aparece no diff da revisão).
--
-- Preservado, sem exceção: Auth (auth.*), profiles, user_roles, admin_audit_log,
-- financial_engine_settings, pricing_settings, supabase_migrations, RLS, grants,
-- funções, gatilhos (inclusive o que já está desabilitado), as 4 funções-padrão de
-- trabalho, municípios com fonte oficial do IBGE e a trilha de configuração
-- (financial_terms_audit, entity_kind = 'sistema').
--
-- Execução remota prevista (ref explícito, nunca --db-url de outro projeto):
--   supabase db query --linked --project-ref qbnfcmrxmssnwkhaitgd -f limpeza-hml-sintetico.sql -o json
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';
SET LOCAL idle_in_transaction_session_timeout = '300s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

-- >>> ÚNICA LINHA A EDITAR NA EXECUÇÃO REAL: troque 'NAO' por 'SIM' <<<
SELECT set_config('bs_limpeza.executar', 'NAO', true);

-- ---------------------------------------------------------------------------
-- 0. Classificação EXPLÍCITA de todas as tabelas de public (31). Tabela nova,
--    removida ou não listada aborta o script (fail-closed).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE bs_tabelas (nome text PRIMARY KEY, destino text NOT NULL CHECK (destino IN ('LIMPAR', 'PARCIAL', 'PRESERVAR')))
  ON COMMIT DROP;
INSERT INTO bs_tabelas (nome, destino) VALUES
  -- Dados de negócio sintéticos: esvaziadas por completo.
  ('container_service_participants', 'LIMPAR'),
  ('container_service_audit',        'LIMPAR'),
  ('container_services',             'LIMPAR'),
  ('billing_additionals',            'LIMPAR'),
  ('invoice_items',                  'LIMPAR'),
  ('invoices',                       'LIMPAR'),
  ('timesheet_entries',              'LIMPAR'),
  ('timesheets',                     'LIMPAR'),
  ('operation_team',                 'LIMPAR'),
  ('user_operation_access',          'LIMPAR'),
  ('operation_location_terms',       'LIMPAR'),
  ('operation_terms',                'LIMPAR'),
  ('shifts',                         'LIMPAR'),
  ('operations',                     'LIMPAR'),
  ('contract_employee_rates',        'LIMPAR'),
  ('contract_rate_terms',            'LIMPAR'),
  ('contract_terms',                 'LIMPAR'),
  ('contracts',                      'LIMPAR'),
  ('employee_cost_terms',            'LIMPAR'),
  ('employees',                      'LIMPAR'),
  ('clients',                        'LIMPAR'),
  -- Calendário: todas as linhas observadas são fixtures (ATO_SINTETICO / exemplo.gov.br).
  ('financial_holidays',             'LIMPAR'),
  ('financial_calendar_coverage',    'LIMPAR'),
  -- Parciais: só os resíduos sintéticos saem.
  ('financial_terms_audit',          'PARCIAL'),  -- sai tudo, exceto entity_kind = 'sistema'
  ('municipality_catalog',           'PARCIAL'),  -- sai só nome 'E2E-%'; ficam os com fonte oficial IBGE
  ('job_functions',                  'PARCIAL'),  -- sai só código 'e2e_%'; ficam as 4 funções-padrão
  -- Identidade e configuração: intocadas.
  ('profiles',                       'PRESERVAR'),
  ('user_roles',                     'PRESERVAR'),
  ('admin_audit_log',                'PRESERVAR'),
  ('financial_engine_settings',      'PRESERVAR'),
  ('pricing_settings',               'PRESERVAR');

-- ---------------------------------------------------------------------------
-- 1. Execução única e travas. Falha rápida (lock_timeout) se alguém usar as tabelas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('bs/limpeza-hml-sintetico', 0)) THEN
    RAISE EXCEPTION 'limpeza abortada: outra execução está em andamento';
  END IF;

  -- Tabelas-alvo: exclusivo. Tabelas preservadas: compartilhado (ninguém altera durante a limpeza).
  FOR r IN SELECT nome, destino FROM bs_tabelas ORDER BY nome LOOP
    IF r.destino = 'PRESERVAR' THEN
      EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', r.nome);
    ELSE
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', r.nome);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Impressão digital do que deve permanecer idêntico (catálogo, identidade,
--    configuração). Calculada antes e depois; precisa ser igual.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.bs_fp() RETURNS jsonb
LANGUAGE sql STABLE AS
$f$
  SELECT jsonb_build_object(
    'migrations', (SELECT jsonb_build_object('total', count(*), 'head', max(version),
                      'md5', md5(coalesce(string_agg(version, ',' ORDER BY version), '')))
                   FROM supabase_migrations.schema_migrations),
    'auth', jsonb_build_object(
      'users', (SELECT count(*) FROM auth.users),
      'identities', (SELECT count(*) FROM auth.identities),
      'mfa_factors', (SELECT count(*) FROM auth.mfa_factors),
      'users_ids_md5', (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM auth.users)),
    'identidade', jsonb_build_object(
      'profiles_md5', (SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) FROM public.profiles p),
      'user_roles_md5', (SELECT md5(coalesce(string_agg(r::text, '|' ORDER BY r.user_id, r.role), '')) FROM public.user_roles r)),
    'configuracao', jsonb_build_object(
      'motor_md5', (SELECT md5(coalesce(string_agg(s::text, '|'), '')) FROM public.financial_engine_settings s),
      'tarifas_md5', (SELECT md5(coalesce(string_agg(s::text, '|'), '')) FROM public.pricing_settings s),
      'funcoes_padrao_md5', (SELECT md5(coalesce(string_agg(j::text, '|' ORDER BY j.code), ''))
                             FROM public.job_functions j WHERE (j.code LIKE 'e2e\_%' ESCAPE '\') IS NOT TRUE),
      'municipios_oficiais_md5', (SELECT md5(coalesce(string_agg(m::text, '|' ORDER BY m.code), ''))
                                  FROM public.municipality_catalog m WHERE (m.name LIKE 'E2E-%') IS NOT TRUE),
      'auditoria_admin_md5', (SELECT md5(coalesce(string_agg(a::text, '|' ORDER BY a.id), '')) FROM public.admin_audit_log a),
      'auditoria_sistema_md5', (SELECT md5(coalesce(string_agg(a::text, '|' ORDER BY a.id), ''))
                                FROM public.financial_terms_audit a WHERE a.entity_kind = 'sistema')),
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
      -- Inclui o ESTADO (habilitado/desabilitado) de cada gatilho: o desabilitado de antes continua desabilitado.
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
      'indices_md5', (SELECT md5(coalesce(string_agg(indexdef, '|' ORDER BY indexname), '')) FROM pg_indexes WHERE schemaname = 'public'),
      'restricoes_md5', (SELECT md5(coalesce(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), '|'
                    ORDER BY conrelid::regclass::text, conname), ''))
                 FROM pg_constraint WHERE connamespace = 'public'::regnamespace)),
    'extensoes', (SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension)
  )
$f$;

-- Contagens do que será removido (antes e depois).
CREATE FUNCTION pg_temp.bs_contagens() RETURNS jsonb
LANGUAGE plpgsql STABLE AS
$f$
DECLARE
  r record;
  j jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  FOR r IN SELECT nome FROM bs_tabelas ORDER BY nome LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.nome) INTO n;
    j := j || jsonb_build_object(r.nome, n);
  END LOOP;
  RETURN j || jsonb_build_object(
    'financial_terms_audit.sistema', (SELECT count(*) FROM public.financial_terms_audit WHERE entity_kind = 'sistema'),
    'municipality_catalog.e2e', (SELECT count(*) FROM public.municipality_catalog WHERE name LIKE 'E2E-%'),
    'job_functions.e2e', (SELECT count(*) FROM public.job_functions WHERE code LIKE 'e2e\_%' ESCAPE '\'));
END
$f$;

CREATE TEMP TABLE bs_base ON COMMIT DROP AS
  SELECT pg_temp.bs_fp() AS fp, pg_temp.bs_contagens() AS contagens;

-- Estado original de cada gatilho de usuário das tabelas-alvo (religar EXATAMENTE isto).
CREATE TEMP TABLE bs_gatilhos ON COMMIT DROP AS
  SELECT c.relname::text AS tabela, t.tgname::text AS gatilho, t.tgenabled::text AS estado
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN bs_tabelas b ON b.nome = c.relname AND b.destino IN ('LIMPAR', 'PARCIAL')
   WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace;

-- ---------------------------------------------------------------------------
-- 3. PREFLIGHT. Cada verificação grava (nome, ok, detalhe). Ao final, qualquer ok = false aborta.
--    O detalhe traz só contagens e nomes de verificação, nunca conteúdo de linha.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE bs_checks (ordem serial, nome text NOT NULL, ok boolean NOT NULL, detalhe text) ON COMMIT DROP;

-- 3.1 Ambiente-alvo: o conjunto de migrations é o do HML (050). Production (034), o HML ainda
--     na 045 ou outro banco reprova. O md5 é o das 55 versões de supabase/migrations/ da main
--     (3cda0e5); o da 045 (688388431cd0e6bcc024814fceef8fcd) era o das 50 primeiras, mesma regra.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'ambiente: migrations = HML 050',
       (count(*) = 55 AND max(version) = '20261117120000' AND md5(string_agg(version, ',' ORDER BY version)) = '01ca91361b85841984ee708716ee60ac'),
       'total=' || count(*) || ' head=' || coalesce(max(version), '-')
  FROM supabase_migrations.schema_migrations;

-- 3.2 Ambiente-alvo: assinatura de dados do HML (cliente e contas sintéticas conhecidos).
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'ambiente: assinatura sintética do HML',
       (EXISTS (SELECT 1 FROM public.clients WHERE name = 'HML-TESTE Cliente')
        AND (SELECT count(*) FROM auth.users WHERE email LIKE '%@e2e-sintetico.invalid') >= 1),
       'cliente_hml=' || EXISTS (SELECT 1 FROM public.clients WHERE name = 'HML-TESTE Cliente')::text;

-- 3.3 Todas as tabelas de public estão classificadas (nada novo, nada faltando).
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'catalogo: 31 tabelas, todas classificadas',
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') = 31
       AND NOT EXISTS (SELECT 1 FROM pg_tables p WHERE p.schemaname = 'public' AND (p.tablename IN (SELECT nome FROM bs_tabelas)) IS NOT TRUE)
       AND NOT EXISTS (SELECT 1 FROM bs_tabelas b WHERE NOT EXISTS (SELECT 1 FROM pg_tables p WHERE p.schemaname = 'public' AND p.tablename = b.nome)),
       'tabelas_public=' || (SELECT count(*) FROM pg_tables WHERE schemaname = 'public');

-- 3.4 Quem executa é dono das tabelas-alvo (condição para ALTER TABLE ... DISABLE TRIGGER) e RLS não é FORÇADA.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'permissao: executor é dono das tabelas-alvo e RLS não é forçada',
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN bs_tabelas b ON b.nome = c.relname
                    WHERE c.relnamespace = 'public'::regnamespace AND (b.destino = 'PRESERVAR') IS NOT TRUE
                      AND (pg_get_userbyid(c.relowner) = current_user AND NOT c.relforcerowsecurity) IS NOT TRUE),
       'executor=' || current_user;

-- 3.5 Estados de gatilho conhecidos (apenas habilitado 'O' ou desabilitado 'D').
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'gatilhos: estados apenas O ou D',
       NOT EXISTS (SELECT 1 FROM bs_gatilhos WHERE (estado IN ('O', 'D')) IS NOT TRUE),
       'habilitados=' || count(*) FILTER (WHERE estado = 'O') || ' desabilitados=' || count(*) FILTER (WHERE estado = 'D')
  FROM bs_gatilhos;

-- 3.6 ORIGEM SINTÉTICA: nenhuma linha das tabelas-alvo pode ser rastreada fora de uma raiz sintética.
--     Raízes: clientes e colaboradores com prefixo sintético conhecido. Para acrescentar um
--     prefixo, é preciso editar este script (e passar pela revisão). HOMOLOG-SINT (050): raízes
--     criadas nas homologações de 09–10/11/2026 (HOMOLOG-SINT-UI, -AV e -AV2), presas por ID em 3.6b.
--     `(x IN (...)) IS NOT TRUE` em vez de `x NOT IN (...)`: chave nula ou subconsulta com nulo
--     dariam NULL, e a linha escaparia da contagem (NULL não é false). Nula aqui conta como fora.
WITH sc AS (SELECT id FROM public.clients WHERE name ~ '^(HML-TESTE|AUTH01C2|E2E-S11|E2E-S19B|HOMOLOG-SINT)'),
     se AS (SELECT id FROM public.employees WHERE name ~ '^(HML-TESTE|AUTH01C2|E2E-S11|E2E-S19B|HOMOLOG-SINT)'),
     so AS (SELECT id FROM public.operations WHERE client_id IN (SELECT id FROM sc)),
     sk AS (SELECT id FROM public.contracts WHERE client_id IN (SELECT id FROM sc)),
     sts AS (SELECT id FROM public.timesheets WHERE operation_id IN (SELECT id FROM so)),
     sinv AS (SELECT id FROM public.invoices WHERE client_id IN (SELECT id FROM sc)),
     ssv AS (SELECT id FROM public.container_services WHERE client_id IN (SELECT id FROM sc)),
     fora AS (
       SELECT 'clients' t, count(*) FILTER (WHERE (id IN (SELECT id FROM sc)) IS NOT TRUE) n FROM public.clients
       UNION ALL SELECT 'employees', count(*) FILTER (WHERE (id IN (SELECT id FROM se)) IS NOT TRUE) FROM public.employees
       UNION ALL SELECT 'contracts', count(*) FILTER (WHERE (client_id IN (SELECT id FROM sc)) IS NOT TRUE) FROM public.contracts
       UNION ALL SELECT 'operations', count(*) FILTER (WHERE (client_id IN (SELECT id FROM sc)) IS NOT TRUE) FROM public.operations
       UNION ALL SELECT 'shifts', count(*) FILTER (WHERE (operation_id IN (SELECT id FROM so)) IS NOT TRUE) FROM public.shifts
       UNION ALL SELECT 'operation_team', count(*) FILTER (WHERE (operation_id IN (SELECT id FROM so) AND employee_id IN (SELECT id FROM se)) IS NOT TRUE) FROM public.operation_team
       UNION ALL SELECT 'operation_terms', count(*) FILTER (WHERE (operation_id IN (SELECT id FROM so)) IS NOT TRUE) FROM public.operation_terms
       UNION ALL SELECT 'operation_location_terms', count(*) FILTER (WHERE (operation_id IN (SELECT id FROM so)) IS NOT TRUE) FROM public.operation_location_terms
       UNION ALL SELECT 'user_operation_access', count(*) FILTER (WHERE (operation_id IN (SELECT id FROM so)) IS NOT TRUE) FROM public.user_operation_access
       UNION ALL SELECT 'employee_cost_terms', count(*) FILTER (WHERE (employee_id IN (SELECT id FROM se)) IS NOT TRUE) FROM public.employee_cost_terms
       UNION ALL SELECT 'contract_terms', count(*) FILTER (WHERE (contract_id IN (SELECT id FROM sk)) IS NOT TRUE) FROM public.contract_terms
       UNION ALL SELECT 'contract_rate_terms', count(*) FILTER (WHERE (contract_id IN (SELECT id FROM sk)) IS NOT TRUE) FROM public.contract_rate_terms
       UNION ALL SELECT 'contract_employee_rates', count(*) FILTER (WHERE (contract_id IN (SELECT id FROM sk) AND employee_id IN (SELECT id FROM se)) IS NOT TRUE) FROM public.contract_employee_rates
       UNION ALL SELECT 'timesheets', count(*) FILTER (WHERE (operation_id IN (SELECT id FROM so)) IS NOT TRUE) FROM public.timesheets
       UNION ALL SELECT 'timesheet_entries', count(*) FILTER (WHERE (timesheet_id IN (SELECT id FROM sts) AND employee_id IN (SELECT id FROM se)) IS NOT TRUE) FROM public.timesheet_entries
       UNION ALL SELECT 'invoices', count(*) FILTER (WHERE (client_id IN (SELECT id FROM sc)) IS NOT TRUE) FROM public.invoices
       UNION ALL SELECT 'invoice_items', count(*) FILTER (WHERE (invoice_id IN (SELECT id FROM sinv)) IS NOT TRUE) FROM public.invoice_items
       UNION ALL SELECT 'billing_additionals', count(*) FILTER (WHERE (client_id IN (SELECT id FROM sc)) IS NOT TRUE) FROM public.billing_additionals
       UNION ALL SELECT 'container_services', count(*) FILTER (WHERE (client_id IN (SELECT id FROM sc)) IS NOT TRUE) FROM public.container_services
       UNION ALL SELECT 'container_service_participants', count(*) FILTER (WHERE (service_id IN (SELECT id FROM ssv) AND employee_id IN (SELECT id FROM se)) IS NOT TRUE) FROM public.container_service_participants
       UNION ALL SELECT 'container_service_audit', count(*) FILTER (WHERE (service_id IN (SELECT id FROM ssv)) IS NOT TRUE) FROM public.container_service_audit
     )
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'origem sintetica: ' || t, n = 0, 'linhas_fora_da_origem=' || n FROM fora;

-- 3.6b Raízes iguais ao inventário somente leitura de 10/11/2026 (HML 050). Nome parecido não basta:
--      os 10 clientes são presos por ID; os colaboradores, por contagem exata por prefixo, e os
--      HOMOLOG-SINT (criados nas homologações registradas no HANDOFF), também por ID. Qualquer raiz
--      nova ou faltante, mesmo com prefixo sintético, ABORTA: refazer o inventário e revisar o script.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'raizes: clientes = 10 IDs do inventario de 10/11/2026',
       (SELECT coalesce(array_agg(id::text ORDER BY id), '{}') FROM public.clients) = ARRAY[
         '10f8d99d-77c7-43c2-bff8-3f4a3436ba6a', '2e36c08d-e768-44cc-98b6-e1cb5f85595c',
         '37c4b132-24ce-4431-b643-0cf74bc85e49', '3be10a1e-f1e1-4576-8734-98b1965b2e1f',
         '54967da8-f7e9-4e75-8bf0-3c52f25a52f3', '54d7a178-0cf4-4755-aa13-5ac301d0d4d4',
         '76313ccf-9503-42f4-8745-7b4708fee4f4', '80fb168b-1bc8-4444-9797-30d505428515',
         'a7c38a8c-4901-4750-a0a0-68b3d3c64882', 'aa6e42f0-b2f2-45d6-b40b-cf1ddcca45e6'],
       'clientes=' || (SELECT count(*) FROM public.clients);
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'raizes: colaboradores por prefixo = inventario de 10/11/2026',
       (SELECT jsonb_object_agg(p, n) FROM (
          SELECT coalesce(substring(name from '^(HML-TESTE|AUTH01C2|E2E-S11|E2E-S19B|HOMOLOG-SINT)'), 'FORA') p, count(*) n
            FROM public.employees GROUP BY 1) x)
         = '{"E2E-S11": 5, "E2E-S19B": 2, "HML-TESTE": 2, "HOMOLOG-SINT": 5}'::jsonb,
       'colaboradores=' || (SELECT count(*) FROM public.employees);
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'raizes: colaboradores HOMOLOG-SINT = 5 IDs registrados',
       (SELECT coalesce(array_agg(id::text ORDER BY id), '{}') FROM public.employees WHERE name LIKE 'HOMOLOG-SINT%') = ARRAY[
         '0d65d945-3065-4436-86c7-966244bd0e0b', '215b53f5-813d-4c55-b401-c3e86f6382f7',
         '8b93a3d0-0d2c-479c-ac9c-56f41607dbaf', 'cc8ceb99-f92a-4d0f-b995-0796f1cd8944',
         'e7ea1aea-1824-44ab-9343-dccd67d15b84'],
       'homolog=' || (SELECT count(*) FROM public.employees WHERE name LIKE 'HOMOLOG-SINT%');

-- 3.7 Calendário: só fixtures (fonte sintética). Registro com fonte oficial real impede a limpeza.
--     Os feriados legados (anteriores à 044) têm legal_act NULL: com `NOT (legal_act LIKE ... OR ...)`
--     um legado de nome desconhecido dava NOT (NULL OR false) = NULL e saía da contagem, e seria
--     apagado. Com `(...) IS NOT TRUE`, só fica dentro a linha comprovadamente sintética.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'origem sintetica: financial_holidays',
       count(*) FILTER (WHERE (legal_act LIKE 'E2E-%' OR name LIKE 'E2E-%' OR name LIKE 'AUTH01C2%') IS NOT TRUE) = 0,
       'linhas_fora_da_origem=' || count(*) FILTER (WHERE (legal_act LIKE 'E2E-%' OR name LIKE 'E2E-%' OR name LIKE 'AUTH01C2%') IS NOT TRUE)
  FROM public.financial_holidays;
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'origem sintetica: financial_calendar_coverage',
       count(*) FILTER (WHERE (legal_act LIKE 'E2E-%' AND official_url = 'https://exemplo.gov.br/calendario') IS NOT TRUE) = 0,
       'linhas_fora_da_origem=' || count(*) FILTER (WHERE (legal_act LIKE 'E2E-%' AND official_url = 'https://exemplo.gov.br/calendario') IS NOT TRUE)
  FROM public.financial_calendar_coverage;

-- 3.8 Municípios: o que não for 'E2E-%' precisa ter fonte oficial do IBGE (e permanece).
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'municipios: nao sinteticos tem fonte oficial IBGE (e ficam)',
       count(*) FILTER (WHERE (name LIKE 'E2E-%') IS NOT TRUE
                          AND (official_url = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/' || code) IS NOT TRUE) = 0,
       'sinteticos=' || count(*) FILTER (WHERE name LIKE 'E2E-%') || ' oficiais=' || count(*) FILTER (WHERE (name LIKE 'E2E-%') IS NOT TRUE)
  FROM public.municipality_catalog;

-- 3.9 Funções de trabalho: só as 4 padrão ou 'e2e_%'. Qualquer outra (possivelmente real) aborta.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'funcoes: apenas 4 padrao + e2e_',
       count(*) FILTER (WHERE (code IN ('auxiliar_producao', 'conferente', 'operador', 'administrativo') OR code LIKE 'e2e\_%' ESCAPE '\') IS NOT TRUE) = 0
       AND count(*) FILTER (WHERE code IN ('auxiliar_producao', 'conferente', 'operador', 'administrativo')) = 4,
       'padrao=' || count(*) FILTER (WHERE code IN ('auxiliar_producao', 'conferente', 'operador', 'administrativo'))
         || ' e2e=' || count(*) FILTER (WHERE code LIKE 'e2e\_%' ESCAPE '\')
  FROM public.job_functions;

-- 3.10 Trilha de condições (exceto 'sistema'): cada linha liga-se a entidade sintética, a ator '.invalid'
--      ou a motivo com marcador de teste. 'sistema' (configuração global) é preservada.
WITH ids AS (
  SELECT id FROM public.contracts UNION SELECT id FROM public.employees UNION SELECT id FROM public.operations
  UNION SELECT id FROM public.billing_additionals UNION SELECT id FROM public.financial_holidays
  UNION SELECT id FROM public.financial_calendar_coverage UNION SELECT id FROM public.contract_terms
  UNION SELECT id FROM public.contract_rate_terms UNION SELECT id FROM public.contract_employee_rates
  UNION SELECT id FROM public.employee_cost_terms UNION SELECT id FROM public.operation_terms
  UNION SELECT id FROM public.operation_location_terms UNION SELECT id FROM public.timesheet_entries
  UNION SELECT id FROM public.timesheets UNION SELECT id FROM public.container_services
)
--      `(...) IS NOT TRUE`: entity_id/term_id/reason nulos não podem tornar a linha invisível à contagem.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'origem sintetica: financial_terms_audit (exceto sistema)',
       count(*) FILTER (WHERE (a.entity_id IN (SELECT id FROM ids) OR a.term_id IN (SELECT id FROM ids)
                                   OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.actor_id AND u.email LIKE '%.invalid')
                                   OR a.reason ~ '^(E2E|HML|AUTH01C|S19|S11)') IS NOT TRUE) = 0,
       'linhas_fora_da_origem=' || count(*) FILTER (WHERE (a.entity_id IN (SELECT id FROM ids) OR a.term_id IN (SELECT id FROM ids)
                                   OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.actor_id AND u.email LIKE '%.invalid')
                                   OR a.reason ~ '^(E2E|HML|AUTH01C|S19|S11)') IS NOT TRUE)
  FROM public.financial_terms_audit a WHERE a.entity_kind <> 'sistema';

-- 3.10b Trilha com tipo de entidade nulo é desconhecida: nem é removida (DELETE usa <> 'sistema')
--       nem pode ser classificada. Bloqueia.
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'trilha: nenhuma linha com entity_kind nulo',
       count(*) = 0, 'sem_tipo=' || count(*)
  FROM public.financial_terms_audit WHERE entity_kind IS NULL;

-- 3.11 Pelo menos uma conta administrativa REAL (e-mail que não termina em .invalid) permanece com papel admin.
--      `(u.email LIKE '%.invalid') IS FALSE`: e-mail nulo não conta como admin real (só pode reprovar).
INSERT INTO bs_checks (nome, ok, detalhe)
SELECT 'identidade: existe admin real preservado',
       EXISTS (SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
                WHERE r.role = 'admin' AND (u.email LIKE '%.invalid') IS FALSE),
       'admins_reais=' || (SELECT count(*) FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
                            WHERE r.role = 'admin' AND (u.email LIKE '%.invalid') IS FALSE);

-- 3.12 Veredito do preflight: qualquer reprovação aborta (mensagem só com nomes das verificações).
DO $$
DECLARE
  falhas text;
BEGIN
  SELECT string_agg(nome, '; ' ORDER BY ordem) INTO falhas FROM bs_checks WHERE NOT ok;
  IF falhas IS NOT NULL THEN
    RAISE EXCEPTION 'limpeza abortada no preflight; verificacoes reprovadas: %', falhas;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Expurgo (somente com bs_limpeza.executar = 'SIM'). Sem CASCADE: se alguma tabela
--    fora da lista referenciar uma tabela da lista, o TRUNCATE falha e tudo é desfeito.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF current_setting('bs_limpeza.executar', true) IS DISTINCT FROM 'SIM' THEN
    RAISE NOTICE 'ensaio a seco: nenhuma linha foi alterada';
    RETURN;
  END IF;

  -- 4.1 Desabilita, um a um, SOMENTE os gatilhos que estavam habilitados. Os já desabilitados
  --     (ex.: trg_timesheet_entries_calculo_financeiro, desligado pelo motor ativo) não são tocados.
  --     Na 050 isso inclui os gatilhos BEFORE TRUNCATE de timesheet_entries e invoice_items, que
  --     desde a 046 (bloquear_truncate_lastro) recusam TRUNCATE com apontamento OU adicional
  --     faturado, e a guarda de invoices, que desde a 046 cobre também DELETE.
  FOR r IN SELECT tabela, gatilho FROM bs_gatilhos WHERE estado = 'O' ORDER BY tabela, gatilho LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.tabela, r.gatilho);
  END LOOP;

  -- 4.2 Lista explícita, uma única instrução, sem CASCADE e sem RESTART IDENTITY.
  TRUNCATE TABLE
    public.container_service_participants,
    public.container_service_audit,
    public.container_services,
    public.billing_additionals,
    public.invoice_items,
    public.invoices,
    public.timesheet_entries,
    public.timesheets,
    public.operation_team,
    public.user_operation_access,
    public.operation_location_terms,
    public.operation_terms,
    public.shifts,
    public.operations,
    public.contract_employee_rates,
    public.contract_rate_terms,
    public.contract_terms,
    public.contracts,
    public.employee_cost_terms,
    public.employees,
    public.clients,
    public.financial_holidays,
    public.financial_calendar_coverage;

  -- 4.3 Resíduos parciais, com condição explícita.
  DELETE FROM public.financial_terms_audit WHERE entity_kind <> 'sistema';
  DELETE FROM public.municipality_catalog  WHERE name LIKE 'E2E-%';
  DELETE FROM public.job_functions         WHERE code LIKE 'e2e\_%' ESCAPE '\';

  -- 4.4 Religa EXATAMENTE os gatilhos desligados no passo 4.1.
  FOR r IN SELECT tabela, gatilho FROM bs_gatilhos WHERE estado = 'O' ORDER BY tabela, gatilho LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.tabela, r.gatilho);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Validação integral antes do COMMIT. Falhou qualquer item: exceção e rollback total.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  executar boolean := current_setting('bs_limpeza.executar', true) = 'SIM';
  antes jsonb;
  depois jsonb;
  c_antes jsonb;
  c_depois jsonb;
  k text;
  esperado bigint;
  falhas text := '';
BEGIN
  SELECT fp, contagens INTO antes, c_antes FROM bs_base;
  depois := pg_temp.bs_fp();
  c_depois := pg_temp.bs_contagens();

  -- 5.1 Tudo que deve permanecer (catálogo, RLS, grants, funções, gatilhos e seus estados, Auth,
  --     perfis, papéis, configuração, migrations) é idêntico à fotografia.
  FOR k IN SELECT jsonb_object_keys(antes) LOOP
    IF antes -> k IS DISTINCT FROM depois -> k THEN
      falhas := falhas || ' [mudou: ' || k || ']';
    END IF;
  END LOOP;

  -- 5.2 Estado individual de cada gatilho das tabelas-alvo igual ao original.
  IF EXISTS (
    SELECT 1 FROM bs_gatilhos g
      LEFT JOIN (SELECT c.relname::text AS tabela, t.tgname::text AS gatilho, t.tgenabled::text AS estado
                   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace) a
        ON a.tabela = g.tabela AND a.gatilho = g.gatilho
     WHERE a.estado IS DISTINCT FROM g.estado
  ) THEN
    falhas := falhas || ' [estado de gatilho divergente]';
  END IF;

  -- 5.3 Contagens esperadas, tabela a tabela.
  FOR k IN SELECT nome FROM bs_tabelas ORDER BY nome LOOP
    esperado := CASE
      WHEN NOT executar THEN (c_antes ->> k)::bigint
      WHEN k = 'financial_terms_audit' THEN (c_antes ->> 'financial_terms_audit.sistema')::bigint
      WHEN k = 'municipality_catalog'  THEN (c_antes ->> k)::bigint - (c_antes ->> 'municipality_catalog.e2e')::bigint
      WHEN k = 'job_functions'         THEN (c_antes ->> k)::bigint - (c_antes ->> 'job_functions.e2e')::bigint
      WHEN (SELECT destino FROM bs_tabelas WHERE nome = k) = 'LIMPAR' THEN 0
      ELSE (c_antes ->> k)::bigint            -- PRESERVAR
    END;
    IF (c_depois ->> k)::bigint IS DISTINCT FROM esperado THEN
      falhas := falhas || ' [contagem ' || k || ']';
    END IF;
  END LOOP;

  IF falhas <> '' THEN
    RAISE EXCEPTION 'limpeza abortada na validacao final:%', falhas;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Relatório (contagens e resultado; nenhuma linha de dados) e COMMIT.
-- ---------------------------------------------------------------------------
SELECT jsonb_build_object(
  'modo', CASE WHEN current_setting('bs_limpeza.executar', true) = 'SIM' THEN 'EXECUTADO' ELSE 'ENSAIO A SECO (nada alterado)' END,
  'verificacoes', (SELECT jsonb_build_object('total', count(*), 'reprovadas', count(*) FILTER (WHERE NOT ok)) FROM bs_checks),
  'contagens_antes', (SELECT contagens FROM bs_base),
  'contagens_depois', pg_temp.bs_contagens(),
  'gatilhos_desabilitados_antes', (SELECT fp -> 'catalogo' -> 'gatilhos_desabilitados' FROM bs_base),
  'gatilhos_desabilitados_depois', pg_temp.bs_fp() -> 'catalogo' -> 'gatilhos_desabilitados',
  'resultado', 'OK: preflight e validacao integral aprovados'
) AS relatorio;

COMMIT;
