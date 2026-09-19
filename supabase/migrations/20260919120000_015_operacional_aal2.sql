-- O operador com MFA concluído também é operador.
--
-- O DEFEITO, ENCONTRADO NA AUDITORIA DO PR C
--
-- `public.operador_elegivel_aal1()`, da migration 013, exige literalmente
-- `(auth.jwt() ->> 'aal') = 'aal1'`. Ela é o primitivo da EXCEÇÃO de AAL1, e
-- essa exigência é correta para o que ela significa.
--
-- O problema é que os dois helpers que governam as cinco RPCs — o de
-- autorização por operação e o de identidade — foram amarrados justamente
-- nela. Consequência: um `operacional` que ativa o segundo fator e conclui o
-- TOTP chega em `aal2` e passa a ser RECUSADO pela própria superfície
-- operacional, com `42501` em todas as cinco chamadas. A tela fica inútil
-- exatamente para quem seguiu a política de segurança.
--
-- A sessão AAL2 é MAIS forte que a AAL1. Não há nada a rebaixar, nenhum
-- segundo token a emitir e nenhum relogin a pedir: o que faltava era a
-- superfície aceitar o nível mais alto.
--
-- O QUE ESTA MIGRATION FAZ, E O QUE ELA NÃO FAZ
--
-- Ela acrescenta `public.operador_elegivel_operacional()` — a elegibilidade
-- GERAL da superfície — e reaponta os dois helpers centrais para ela. As cinco
-- RPCs não são reescritas: nenhuma delas verifica `aal` por conta própria, e
-- todas passam por `operador_autorizado()` e/ou `uid_do_operador()`, o que foi
-- conferido função a função antes desta migration existir.
--
-- `operador_elegivel_aal1()` fica INTACTA. Seu nome e seu contrato dizem
-- "elegível à exceção de AAL1", e transformá-la em "aal1 ou aal2" corromperia o
-- significado de um primitivo que outras decisões podem vir a consultar. Ela
-- continua respondendo exatamente o que respondia — e o teste `011` prova isso
-- caso a caso, para que a mudança não passe por cima do contrato antigo.
--
-- **Nenhum dado novo atravessa.** Mesmas cinco RPCs, mesmo papel dono, mesmas
-- colunas, mesmos grants por coluna, mesmos triggers, mesma derivação
-- financeira, mesmas 11 policies `*_exige_aal2`. A única diferença é o nível de
-- garantia aceito pela mesma superfície estreita. Em AAL2 o operador não passa
-- a ler `employees.daily_cost`, `operations.agreed_amount`, `contracts`,
-- `billed_amount`, `cost_amount`, `invoice_id` nem snapshot — o papel dono não
-- tem privilégio nessas colunas, e privilégio não se contorna com claim.
--
-- Sem tabela nova, sem coluna nova, sem trigger novo, sem policy nova, sem
-- grant de tabela e sem cleanup de dado.

-- ---------------------------------------------------------------------------
-- 1. A elegibilidade geral da superfície operacional
--
-- Fail-closed no mesmo formato da 013: `coalesce(..., false)`, porque um JWT
-- sem o claim `aal` faz a comparação devolver NULL e a cadeia inteira de `AND`
-- devolver NULL — e NULL não é `false` para um `IF`. Esse foi um fail-open real
-- medido antes do merge da 013, e a forma existe para não repeti-lo.
--
-- A condição de AAL1 continua carregando a verificação de MFA: quem TEM fator
-- verificado e ainda está em `aal1` não é elegível — precisa concluir o
-- segundo fator. Em `aal2` o fator já foi satisfeito por definição, e perguntar
-- de novo a `mfa_bloqueia_excecao_aal1()` recusaria justamente quem cumpriu a
-- política.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operador_elegivel_operacional()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
       auth.uid() IS NOT NULL
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid())
   AND public.has_role(auth.uid(), 'operacional'::public.app_role)
   AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
   AND (
         (
               (auth.jwt() ->> 'aal') = 'aal1'
           AND public.mfa_bloqueia_excecao_aal1() = false
         )
      OR (auth.jwt() ->> 'aal') = 'aal2'
       ),
     false);
$$;

ALTER FUNCTION public.operador_elegivel_operacional() OWNER TO postgres;

COMMENT ON FUNCTION public.operador_elegivel_operacional() IS
  'Responde se a SESSAO atual e um operador valido para a superficie operacional, em qualquer nivel de garantia aceito: aal1 sem MFA bloqueando, ou aal2. Exige uid presente, conta existente, papel operacional e NAO admin. Nao recebe parametro e nao decide operacao. Nao amplia dado nenhum: a superficie continua sendo as cinco RPCs. Interna: executavel apenas por bslog_rpc_operacional.';

-- Mesmo regime de privilégio dos demais helpers internos da 013: ninguém da
-- API alcança esta função direto. Quem a executa é o papel dono das RPCs, e
-- `postgres`, que é o dono dela.
REVOKE ALL ON FUNCTION public.operador_elegivel_operacional() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.operador_elegivel_operacional() TO bslog_rpc_operacional;


-- ---------------------------------------------------------------------------
-- 2. Os dois helpers centrais passam a consultar a elegibilidade geral
--
-- É a única mudança de comportamento desta migration. As cinco RPCs continuam
-- byte a byte como estão: elas perguntam a estes dois, e mais nada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operador_autorizado(p_operation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
       p_operation_id IS NOT NULL
   AND public.operador_elegivel_operacional()
   AND EXISTS (
     SELECT 1
       FROM public.user_operation_access a
      WHERE a.user_id      = auth.uid()
        AND a.operation_id = p_operation_id
   ),
     false);
$$;

COMMENT ON FUNCTION public.operador_autorizado(uuid) IS
  'Responde se a sessao atual e operador elegivel a superficie operacional — aal1 sem MFA bloqueando, ou aal2 — E tem a operacao informada atribuida em user_operation_access. Nao aceita user_id: a decisao e sempre sobre auth.uid(). Interna: executavel apenas por bslog_rpc_operacional.';

CREATE OR REPLACE FUNCTION public.uid_do_operador()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.operador_elegivel_operacional() THEN auth.uid() END;
$$;

COMMENT ON FUNCTION public.uid_do_operador() IS
  'Devolve auth.uid() somente quando a sessao e um operador elegivel a superficie operacional, em aal1 sem MFA bloqueando ou em aal2, e NULL caso contrario. Existe para que as RPCs da superficie nao precisem alcancar o schema auth. Interna: executavel apenas por bslog_rpc_operacional.';


-- ---------------------------------------------------------------------------
-- 3. Autoverificação
--
-- Recusa a migration se o desenho não tiver ficado de pé. Confere o que esta
-- mudança pode quebrar — e, principalmente, o que ela NÃO podia tocar.
-- ---------------------------------------------------------------------------

DO $verificacao$
DECLARE
  _erros text[] := '{}'::text[];
  _prosrc text;
BEGIN
  -- O primitivo da exceção AAL1 continua exigindo aal1, e só aal1.
  SELECT p.prosrc INTO _prosrc
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'operador_elegivel_aal1';

  IF _prosrc IS NULL THEN
    _erros := _erros || 'operador_elegivel_aal1 desapareceu';
  ELSIF _prosrc !~ '''aal1''' OR _prosrc ~ '''aal2''' THEN
    _erros := _erros || 'operador_elegivel_aal1 teve a semantica alterada';
  END IF;

  -- O helper novo existe, é SECURITY DEFINER e é de postgres.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'operador_elegivel_operacional'
       AND p.prosecdef
       AND pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    _erros := _erros || 'operador_elegivel_operacional ausente, sem security definer ou com dono errado';
  END IF;

  -- Ele é interno: nenhum papel da API o executa.
  IF EXISTS (
    SELECT 1 FROM pg_proc p, unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'operador_elegivel_operacional'
       AND has_function_privilege(papel, p.oid, 'EXECUTE')
  ) THEN
    _erros := _erros || 'operador_elegivel_operacional executavel por papel da API';
  END IF;

  -- Os dois helpers centrais passaram a consultar a elegibilidade geral.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('operador_autorizado', 'uid_do_operador')
       AND p.prosrc !~ 'operador_elegivel_operacional'
  ) THEN
    _erros := _erros || 'helper central ainda preso a operador_elegivel_aal1';
  END IF;

  -- As cinco RPCs continuam de pé, SECURITY DEFINER e do papel dedicado.
  IF (
    SELECT count(*) FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                         'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                         'salvar_apontamento_operacional')
       AND p.prosecdef
       AND pg_get_userbyid(p.proowner) = 'bslog_rpc_operacional'
  ) <> 5 THEN
    _erros := _erros || 'as cinco RPCs nao estao intactas';
  END IF;

  -- Nada de financeiro foi concedido ao papel dono.
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['billed_amount', 'cost_amount', 'invoice_id',
                               'daily_rate_snapshot', 'ot_hour_rate_snapshot',
                               'daily_cost_snapshot']) AS coluna
     WHERE has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries',
                                coluna, 'SELECT, INSERT, UPDATE')
  ) THEN
    _erros := _erros || 'papel de execucao ganhou privilegio em coluna financeira';
  END IF;

  -- E as 11 policies de AAL2 seguem onde estavam.
  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND policyname LIKE '%\_exige\_aal2'
       AND permissive = 'RESTRICTIVE'
  ) <> 11 THEN
    _erros := _erros || 'as 11 policies *_exige_aal2 nao estao intactas';
  END IF;

  IF array_length(_erros, 1) > 0 THEN
    RAISE EXCEPTION '015: verificacao final falhou -> %', array_to_string(_erros, '; ');
  END IF;
END
$verificacao$;
