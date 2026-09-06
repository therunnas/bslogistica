-- Hardening de privilégios: SEC-011 (EXECUTE excessivo) e SEC-009 (TRUNCATE).
--
-- A migration é puramente restritiva: só há REVOKE, mais um GRANT que reafirma
-- o privilégio que as policies já dependem. Nenhuma tabela, coluna, policy,
-- função ou linha é alterada, e nenhum papel ganha privilégio novo.


-- ---------------------------------------------------------------------------
-- SEC-011 — EXECUTE excessivo em funções auxiliares
-- ---------------------------------------------------------------------------
--
-- O Postgres concede EXECUTE a PUBLIC em toda função nova. `REVOKE ... FROM
-- anon` não desfaz isso: o privilégio continua chegando ao anon pela via do
-- PUBLIC. A migration 20260903175718 revogou de `anon` mas não de PUBLIC, então
-- is_staff() seguiu alcançável. Compare com has_role, que na 20260903173220 foi
-- revogada de `PUBLIC, anon` — ali o padrão certo já tinha sido aplicado.
--
-- Nada aqui altera a lógica das policies. `authenticated` mantém EXECUTE em
-- is_staff() porque as policies de SELECT das tabelas de negócio a chamam; sem
-- esse grant, o painel pararia de ler dados.

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- update_updated_at_column é função de trigger: chamada fora desse contexto ela
-- falha, então o EXECUTE a PUBLIC nunca foi um bypass — era superfície inútil
-- exposta em /rest/v1/rpc/. Os triggers continuam funcionando: o Postgres exige
-- EXECUTE de quem CRIA o trigger, e não reavalia o privilégio a cada disparo.
--
-- `authenticated` é preservado de propósito. Revogá-lo também seria defensável,
-- mas o ganho é nulo (a função já erra quando chamada diretamente) e o risco de
-- errar não é: se a premissa acima sobre triggers falhasse, todo UPDATE do
-- sistema quebraria. Fica no escopo mínimo que resolve o achado.

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon;


-- ---------------------------------------------------------------------------
-- SEC-009 — TRUNCATE concedido a anon e authenticated
-- ---------------------------------------------------------------------------
--
-- O bootstrap do Supabase deixa configurado, no schema public:
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
--
-- `ALL` inclui TRUNCATE. Os GRANT explícitos da 20260903173204 concedem apenas
-- SELECT, INSERT, UPDATE, DELETE — mas somam-se ao default, não o substituem.
-- Resultado: toda tabela criada depois disso nasce com TRUNCATE para anon e
-- authenticated.
--
-- Por que importa: TRUNCATE **não passa pela RLS**. Um DELETE de quem não é
-- staff é barrado pela policy; um TRUNCATE esvaziaria a tabela inteira sem
-- consultar policy nenhuma. Na prática o PostgREST não expõe TRUNCATE, então
-- alcançá-lo exige conexão direta ao Postgres — mas o privilégio está errado, e
-- removê-lo não custa nada.
--
-- service_role e postgres mantêm TRUNCATE: são os papéis administrativos usados
-- por manutenção e restauração.

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Sem isto, a próxima tabela criada volta a nascer com TRUNCATE. Esta linha
-- corrige a origem, e não só o estado atual. Vale para objetos criados pelo
-- papel que executa a migration (postgres), que é quem cria as tabelas aqui.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated;


-- ---------------------------------------------------------------------------
-- Verificação (rodar depois, no SQL Editor)
-- ---------------------------------------------------------------------------
--
-- SEC-011 — esperado: nem PUBLIC (=/...) nem anon aparecem com X nas duas ACLs.
--
--   SELECT p.proname, coalesce(array_to_string(p.proacl, ' ~ '), '(NULO = PUBLIC EXECUTA)') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN ('is_staff', 'update_updated_at_column');
--
-- SEC-009 — esperado: zero linhas.
--
--   SELECT table_name, grantee FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
--     AND grantee IN ('anon', 'authenticated');
