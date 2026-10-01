-- Fecha o GRANT herdado em admin_audit_log — achado na validação local das
-- 13 suítes SQL (supabase/tests/013_administracao_usuarios.sql, casos A6/A7).
--
-- O QUE ESTAVA ERRADO
--
-- O comentário da 017 (linhas 102-104) afirma que `authenticated` não tem
-- GRANT de INSERT/UPDATE/DELETE em admin_audit_log, e que por isso um INSERT
-- recusaria com 42501 antes mesmo de avaliar policy. Isso presume que a
-- tabela nasce sem privilégio para `anon`/`authenticated` — falso: o
-- bootstrap do Supabase mantém, no schema `public`,
--
--   ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO postgres, anon,
--   authenticated, service_role;
--
-- e `admin_audit_log` (criada pela 017, depois da 007) herda isso na hora do
-- CREATE TABLE. A 007 revogou esse default só para TRUNCATE — os demais
-- comandos continuam sendo concedidos a toda tabela nova. Medido em ambiente
-- local (Postgres 17.6, migrations 001-017 aplicadas do zero):
--
--   \dp public.admin_audit_log
--   anon=arwdxtm/postgres, authenticated=arwdxtm/postgres
--
-- (a=INSERT, r=SELECT, w=UPDATE, d=DELETE — TRUNCATE já ausente, por obra da
-- 007). A 013 já conhecia esse problema e por isso revoga explicitamente
-- antes de conceder, em `user_operation_access`; a 017 não repetiu o padrão.
--
-- POR QUE ISSO NÃO É, HOJE, UMA LINHA VAZADA
--
-- A RLS nega por padrão quando não há policy PERMISSIVE aplicável ao
-- comando: admin_audit_log só tem uma PERMISSIVE, `FOR SELECT`. Um INSERT,
-- UPDATE ou DELETE de `authenticated` roda (o GRANT existe) mas não casa
-- nenhuma linha — a suíte local mediu `0`, não erro, e nenhuma linha foi de
-- fato alterada ou apagada. Mesmo padrão que `docs/SEGURANCA.md` já aceita
-- para `anon` em geral e para `authenticated` em `user_roles`: a RLS é a
-- primeira tranca, e está provada em execução.
--
-- POR QUE FECHAR ASSIM MESMO
--
-- Essa segunda tranca é defesa em profundidade: se uma policy PERMISSIVE de
-- escrita for adicionada aqui no futuro — por engano, ou para outra
-- finalidade — e satisfizer a RESTRICTIVE `admin_audit_log_exige_admin_aal2`
-- (basta ser admin em AAL2, o que um admin legítimo já é), a trilha de
-- auditoria passaria a ser gravável por quem não é `service_role`. Com o
-- GRANT fechado, essa mesma falha futura continuaria batendo em 42501 antes
-- de a policy entrar em jogo.
--
-- O QUE NÃO MUDA
--
-- `service_role` continua com ALL (é quem grava, pelo backend do PR D,
-- em src/lib/admin-usuarios). `authenticated` continua lendo — é o que a
-- tela de auditoria do PR E precisa. `user_operation_access` já segue o
-- padrão correto desde a 013 e não é tocada aqui. Nenhuma policy, grant de
-- RPC ou regra financeira muda.

REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_audit_log FROM anon;
REVOKE ALL ON TABLE public.admin_audit_log FROM authenticated;
REVOKE ALL ON TABLE public.admin_audit_log FROM service_role;

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;


-- ---------------------------------------------------------------------------
-- Verificação (rodar depois, no SQL Editor ou local)
-- ---------------------------------------------------------------------------
--
-- Esperado: nem anon nem authenticated aparecem com INSERT/UPDATE/DELETE;
-- authenticated aparece só com SELECT; service_role mantém tudo.
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
--     AND grantee IN ('anon', 'authenticated', 'service_role')
--   ORDER BY grantee, privilege_type;
