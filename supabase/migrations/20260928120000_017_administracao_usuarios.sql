-- PR D — fundação de banco do backend administrativo de usuários.
--
-- O QUE ESTA MIGRATION ENTREGA
--
-- Duas coisas, as únicas que o PR D precisa do banco além do que já existe:
--
--   1. `public.admin_audit_log` — registro de toda alteração administrativa de
--      usuário/papel/atribuição de operação (convite, concessão e revogação de
--      papel, atribuição e remoção de operação, revogação de acesso).
--
--   2. um trigger em `public.user_roles` que recusa remover ou rebaixar a
--      ÚLTIMA linha `role = 'admin'` — a proteção do último administrador como
--      invariante de banco, não só checagem no servidor Next.
--
-- NÃO mexe em `user_operation_access` (já é admin+AAL2 desde a 013, e o PR D
-- usa essa tabela como está), não mexe nas cinco RPCs operacionais, não mexe em
-- nenhuma das 11 policies `*_exige_aal2` nem nas 10 `*_exige_admin` da `016`,
-- não altera `has_role`/`is_staff`, e não toca em nenhuma regra financeira.
--
-- POR QUE A PROTEÇÃO DO ÚLTIMO ADMIN PRECISA SER TRIGGER, E NÃO SÓ CÓDIGO
--
-- O backend do PR D escreve em `user_roles` como `service_role` — é a única
-- forma de escrever ali, porque a tabela não tem nenhuma policy de
-- INSERT/UPDATE/DELETE para `authenticated` (só `user_roles_select_own`, da
-- migration inicial). `service_role` ignora RLS por natureza. Uma checagem
-- só em TypeScript, antes da chamada, tem duas rachaduras: (a) corrida — duas
-- remoções do mesmo admin, quase simultâneas, cada uma vendo "ainda sobra um"
-- antes de a outra commitar; (b) não protege contra SQL direto, seja no SQL
-- Editor, seja num script futuro que escreva na tabela sem passar pelo
-- backend. "Nenhum caminho pode remover ou rebaixar o único administrador" só
-- é verdade se a garantia estiver no banco.
--
-- O trigger NÃO isenta `postgres` nem `service_role` — ao contrário das
-- guardas financeiras da 010/011, que isentam os dois de propósito porque
-- existe um caminho legítimo (`gerar_fatura`) que precisa rodar como
-- `postgres`. Aqui não há esse caminho: não existe operação legítima que deva
-- remover o último admin, de lugar nenhum, então a regra não tem exceção.
--
-- POR QUE `admin_audit_log` TEM ESCRITA SÓ POR `service_role`
--
-- Se `authenticated` pudesse inserir, um admin poderia escrever uma linha
-- fabricada na própria trilha de auditoria — ou, pior, um bug de RLS futuro
-- poderia deixar isso acontecer sem querer. A leitura é liberada para
-- admin+AAL2 (mesma forma das policies `*_exige_admin` da `016`), porque a
-- tela do PR E vai precisar mostrar o histórico; a escrita fica de fora de
-- propósito, e quem grava é sempre o backend do PR D, pelo cliente
-- `service_role`.


-- ---------------------------------------------------------------------------
-- 1. admin_audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
  ON public.admin_audit_log (target_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON public.admin_audit_log (created_at DESC);

COMMENT ON TABLE public.admin_audit_log IS
  'Auditoria de alteracao administrativa de usuario/papel/atribuicao de operacao (PR D). actor_id e target_user_id ficam NULL, nunca a linha, se a conta correspondente for apagada. Escrita somente por service_role; leitura por admin em AAL2.';

COMMENT ON COLUMN public.admin_audit_log.action IS
  'Identificador curto da acao, por exemplo convite_criado, papel_concedido, papel_revogado, acesso_revogado, acesso_reativado, operacao_atribuida, operacao_removida. Vocabulario mantido em src/lib/admin-usuarios, nao em CHECK: o significado pode crescer sem migration nova.';

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- PERMISSIVE: concede leitura a admin em AAL2. RESTRICTIVE com o mesmo
-- predicado: garante que uma permissiva futura mais frouxa (ex.: "cada um lê
-- as linhas em que é o alvo") não abra a trilha de auditoria para quem não é
-- admin. Mesmo padrão de `user_operation_access` (013): nome fora da família
-- `_exige_aal2`/`_exige_admin` de propósito, para não mudar as contagens que
-- `008`, `009` e `012` já asseveram como regressão.
CREATE POLICY admin_audit_log_leitura_admin ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY admin_audit_log_exige_admin_aal2 ON public.admin_audit_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Sem GRANT INSERT/UPDATE/DELETE para authenticated: a RESTRICTIVE acima
-- fecharia de qualquer forma, mas o GRANT nem chega a existir, então um
-- INSERT de `authenticated` recusa com 42501 antes mesmo de avaliar policy.
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;


-- ---------------------------------------------------------------------------
-- 2. Proteção do último admin — trigger em user_roles
-- ---------------------------------------------------------------------------
--
-- Dispara em UPDATE ou DELETE. Não precisa disparar em INSERT: inserir uma
-- linha nunca reduz a contagem de admins.
--
-- A regra: se a linha afetada (OLD) é `admin`, e depois da operação ela deixa
-- de existir como admin — DELETE, ou UPDATE que muda `role` para outra coisa
-- —, e não sobra NENHUMA outra linha `role = 'admin'` na tabela, recusa.
--
-- `id <> OLD.id`, não `user_id <> OLD.user_id`: a UNIQUE (user_id, role) já
-- impede duas linhas 'admin' para o mesmo usuário, então contar por `id`
-- exclui exatamente a linha sendo alterada/removida e nenhuma outra — inclusive
-- quando o próprio usuário também tem uma linha 'operacional' à parte, que não
-- é admin e não deveria contar OU descontar aqui.
--
-- A CORRIDA, E POR QUE `COUNT` SOZINHO NÃO BASTA
--
-- Sem serialização, duas transações concorrentes que removem admins
-- DIFERENTES passam as duas: T1 remove A vendo B ainda lá; T2 remove B vendo A
-- ainda lá — sob READ COMMITTED, cada uma lê o snapshot de ANTES do commit da
-- outra. As duas COMMITam, e o resultado é zero admins, exatamente o que esta
-- proteção existe para impedir. Não é hipotético: é a definição de corrida
-- entre duas transações que leem antes de a outra escrever.
--
-- `pg_advisory_xact_lock` serializa a DECISÃO, não a escrita da tabela: a
-- primeira transação a chegar aqui pega a trava, decide (vendo o estado real),
-- e libera automaticamente no COMMIT/ROLLBACK. A segunda BLOQUEIA até a
-- primeira terminar, e só então conta — a essa altura, se a primeira já
-- removeu um admin, a contagem reflete isso de verdade. Mesmo mecanismo, e
-- mesmo estilo de chave, do lock de bootstrap-admin em
-- `provision_bslog_user` (migration `004`): `hashtextextended('chave', 0)`
-- como argumento único de `pg_advisory_xact_lock`, para não colidir com
-- nenhum outro lock nomeado do projeto.
--
-- SEM EXCEÇÃO DE PAPEL — nem para isso. `pg_advisory_xact_lock` serializa
-- qualquer sessão que o chame, `postgres` e `service_role` inclusive: não há
-- "modo direto" que pule a fila.
-- ---------------------------------------------------------------------------

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

COMMENT ON FUNCTION public.proteger_ultimo_admin() IS
  'Recusa DELETE/UPDATE em user_roles que removeria a ultima linha role=admin. Serializado por pg_advisory_xact_lock contra corrida entre transacoes concorrentes. Sem excecao de papel — nao ha caminho legitimo para essa operacao, ao contrario das guardas financeiras da 010/011.';

DROP TRIGGER IF EXISTS trg_proteger_ultimo_admin ON public.user_roles;
CREATE TRIGGER trg_proteger_ultimo_admin
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_ultimo_admin();


-- ---------------------------------------------------------------------------
-- 3. Autoverificação
-- ---------------------------------------------------------------------------

DO $verificacao$
DECLARE
  _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'admin_audit_log';
  IF _n <> 1 THEN
    RAISE EXCEPTION '017: admin_audit_log deveria existir, encontrei %', _n;
  END IF;

  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'admin_audit_log';
  IF _n <> 2 THEN
    RAISE EXCEPTION '017: admin_audit_log deveria ter 2 policies, encontrei %', _n;
  END IF;

  SELECT count(*) INTO _n FROM pg_trigger
   WHERE tgname = 'trg_proteger_ultimo_admin' AND NOT tgisinternal;
  IF _n <> 1 THEN
    RAISE EXCEPTION '017: trigger trg_proteger_ultimo_admin deveria existir, encontrei %', _n;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'proteger_ultimo_admin'
     AND p.prosrc LIKE '%pg_advisory_xact_lock%';
  IF _n <> 1 THEN
    RAISE EXCEPTION '017: proteger_ultimo_admin deveria serializar com pg_advisory_xact_lock, encontrei %', _n;
  END IF;

  -- As 11 *_exige_aal2 e as 10 *_exige_admin não podem ter mudado de
  -- contagem — mesma asserção de regressão que 008/009/012 já fazem.
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname = 'public' AND policyname LIKE '%_exige_aal2';
  IF _n <> 11 THEN
    RAISE EXCEPTION '017: as 11 *_exige_aal2 nao podiam mudar, encontrei %', _n;
  END IF;

  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname = 'public' AND policyname LIKE '%_exige_admin';
  IF _n <> 10 THEN
    RAISE EXCEPTION '017: as 10 *_exige_admin (016) nao podiam mudar, encontrei %', _n;
  END IF;
END
$verificacao$;
