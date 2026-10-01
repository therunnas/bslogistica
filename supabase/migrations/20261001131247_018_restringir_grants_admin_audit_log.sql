-- Normaliza o GRANT de admin_audit_log pelo princípio de menor privilégio —
-- achado na validação local das 13 suítes SQL
-- (supabase/tests/013_administracao_usuarios.sql, casos A6/A7).
--
-- O QUE FOI MEDIDO, E ONDE
--
-- No ambiente LOCAL (Supabase CLI, Postgres 17.6, migrations 001-017
-- aplicadas do zero), `anon` e `authenticated` tinham INSERT/UPDATE/DELETE
-- de fato concedidos em admin_audit_log:
--
--   \dp public.admin_audit_log
--   anon=arwdxtm/postgres, authenticated=arwdxtm/postgres
--
-- herdado do default ACL que o CLI local configura para tabela nova em
-- `public` (a=INSERT, r=SELECT, w=UPDATE, d=DELETE — TRUNCATE já ausente,
-- por obra da 007). **Checado depois, direto no catálogo de Production**
-- (pg_class.relacl e pg_default_acl, antes desta migration ser aplicada lá):
-- o default ACL de Production para tabela nova em `public` é mais estreito —
-- concede só `xtm` (REFERENCES, TRIGGER, MAINTAIN) a `anon`/`authenticated`,
-- nunca incluiu INSERT/UPDATE/DELETE. Ou seja: **o GRANT de escrita indevido
-- existiu no harness local, não em Production** — o comentário original da
-- 017 (linhas 102-104), que presumia não haver GRANT nenhum além de SELECT,
-- estava certo quanto a Production e errado só quanto ao harness local. Não
-- foi possível provar qual script de bootstrap da plataforma hospedada gera
-- esse default mais estreito; nenhuma migration deste repositório o explica
-- (a 007 revogou só TRUNCATE do default).
--
-- POR QUE FECHAR ASSIM MESMO
--
-- O `xtm` residual (REFERENCES/TRIGGER/MAINTAIN) que `anon`/`authenticated`
-- têm em Production não é usado por nenhuma FK ou trigger do projeto — é
-- superfície desnecessária, mesma categoria que `docs/SEGURANCA.md` já
-- documenta para `anon` em geral. Fechar via REVOKE/GRANT explícito, no
-- mesmo padrão que a 013 já usa em `user_operation_access`, é defesa em
-- profundidade: deixa o contrato de privilégio auto-contido na migration,
-- em vez de depender de um default ACL de plataforma que já se mostrou
-- diferente entre ambientes.
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
