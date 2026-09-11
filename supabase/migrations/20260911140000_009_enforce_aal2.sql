-- Exige segundo fator (AAL2) na camada de autorização do banco.
--
-- O PROBLEMA
--
-- O guard do Next exige AAL2 para renderizar o painel, mas as policies olham
-- apenas papel: `is_staff()` e `has_role(auth.uid(), 'admin')` consultam
-- user_roles e nada mais. Um JWT de sessão AAL1 — a que existe entre o
-- signInWithPassword e o TOTP, e a que nasce da recuperação de senha — carrega
-- o mesmo `sub` e o mesmo `role: authenticated`. Ou seja: quem tem a senha
-- correta, mas ainda não passou pelo segundo fator, é barrado na interface e
-- não no banco — e alcança os dados direto pelo PostgREST ou pela RPC.
--
-- Na prática, hoje o MFA protege a tela, não os dados. É exatamente o cenário
-- para o qual o segundo fator existe: uma senha vazada.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Acrescenta uma policy RESTRICTIVE por tabela protegida. RESTRICTIVE combina
-- com AND sobre as PERMISSIVE existentes, então a regra passa a ser
-- "papel permitido E aal2". Nenhuma policy de papel é alterada, removida ou
-- substituída — as regras de admin, staff e operacional continuam exatamente
-- como estão, e esta camada só pode negar, nunca conceder.
--
-- E acrescenta a mesma exigência dentro de `gerar_fatura`, porque ela é
-- SECURITY DEFINER: roda acima da RLS, e por isso as policies não a alcançam.
--
-- FAIL CLOSED
--
-- `auth.jwt() ->> 'aal'` devolve NULL quando o claim não existe, e
-- `NULL = 'aal2'` é NULL, que a RLS trata como não-permitido. Então aal2 passa,
-- aal1 nega e claim ausente nega, sem precisar de COALESCE.
--
-- POR QUE user_roles FICA DE FORA
--
-- `src/app/(painel)/_autorizacao.ts` lê user_roles ainda em AAL1, para
-- descobrir o papel antes de encaminhar ao fluxo de MFA. Bloquear essa leitura
-- criaria um impasse: seria preciso AAL2 para chegar à tela que concede AAL2.
-- A tabela expõe apenas a própria linha do usuário (`user_roles_select_own`),
-- que é o mínimo necessário para essa decisão.
--
-- Esta migration não altera dados, não altera configuração de Auth, não mexe em
-- enrollment de MFA e não toca no fluxo de recuperação de senha.


-- ---------------------------------------------------------------------------
-- 1. Policies RESTRICTIVE — 11 tabelas
-- ---------------------------------------------------------------------------
--
-- `(SELECT auth.jwt() ...)` envolvido em subquery de propósito: o planner
-- avalia uma vez por comando em vez de uma vez por linha.
--
-- `FOR ALL` com USING e WITH CHECK cobre as quatro operações: USING filtra
-- SELECT, UPDATE e DELETE; WITH CHECK alcança INSERT e o estado final do
-- UPDATE. Só USING deixaria INSERT passar em AAL1.

CREATE POLICY profiles_exige_aal2 ON public.profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY clients_exige_aal2 ON public.clients
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY contracts_exige_aal2 ON public.contracts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY employees_exige_aal2 ON public.employees
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY operations_exige_aal2 ON public.operations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY shifts_exige_aal2 ON public.shifts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY operation_team_exige_aal2 ON public.operation_team
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY timesheets_exige_aal2 ON public.timesheets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY timesheet_entries_exige_aal2 ON public.timesheet_entries
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY invoices_exige_aal2 ON public.invoices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY invoice_items_exige_aal2 ON public.invoice_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');


COMMENT ON POLICY profiles_exige_aal2 ON public.profiles IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY clients_exige_aal2 ON public.clients IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY contracts_exige_aal2 ON public.contracts IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY employees_exige_aal2 ON public.employees IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY operations_exige_aal2 ON public.operations IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY shifts_exige_aal2 ON public.shifts IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY operation_team_exige_aal2 ON public.operation_team IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY timesheets_exige_aal2 ON public.timesheets IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY timesheet_entries_exige_aal2 ON public.timesheet_entries IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY invoices_exige_aal2 ON public.invoices IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';
COMMENT ON POLICY invoice_items_exige_aal2 ON public.invoice_items IS
  'Segundo fator obrigatório. RESTRICTIVE: soma com AND às policies de papel.';


-- ---------------------------------------------------------------------------
-- 2. gerar_fatura — verificação explícita de AAL2
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER roda acima da RLS: as policies acima não alcançam o que
-- acontece dentro desta função. A exigência precisa ser escrita aqui.
--
-- A função é reproduzida na íntegra porque CREATE OR REPLACE exige o corpo
-- completo. A ÚNICA diferença em relação à versão da migration
-- 20260905163000_005 é o bloco de AAL2 no passo 1. Assinatura, SECURITY
-- DEFINER, search_path, advisory lock, FOR UPDATE, cálculos, ordem das
-- escritas e verificação final de concorrência seguem idênticos.
--
-- `IS DISTINCT FROM` e não `<>`: com o claim ausente o valor é NULL, e `<>`
-- devolveria NULL — a condição do IF não dispararia e a função seguiria em
-- frente. `IS DISTINCT FROM` trata NULL como diferente e nega.

CREATE OR REPLACE FUNCTION public.gerar_fatura(
  _client_id    uuid,
  _period_start date,
  _period_end   date
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path fixo: função SECURITY DEFINER sem isso pode ser induzida a
-- resolver nomes em um schema controlado por quem chama.
SET search_path = public, pg_temp
AS $$
DECLARE
  _fatura      public.invoices;
  _ids         uuid[];
  _elegiveis   integer;
  _vinculados  integer;
BEGIN
  -- 1. Sessão autenticada. SECURITY DEFINER roda acima da RLS, então a
  --    autorização precisa ser explícita aqui e não pode ser delegada às policies.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada.'
      USING ERRCODE = '28000';
  END IF;

  -- Segundo fator. Vem antes da verificação de papel de propósito: uma sessão
  -- aal1 não deve sequer ter o papel consultado aqui.
  IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Autenticação de dois fatores obrigatória.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem gerar faturas.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Parâmetros
  IF _client_id IS NULL OR _period_start IS NULL OR _period_end IS NULL THEN
    RAISE EXCEPTION 'Cliente e período são obrigatórios.'
      USING ERRCODE = '22023';
  END IF;

  IF _period_start > _period_end THEN
    RAISE EXCEPTION 'Período inválido: início (%) posterior ao fim (%).',
      _period_start, _period_end
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Serializa a geração por cliente até o fim da transação. Uma segunda
  --    chamada simultânea espera aqui; quando prosseguir, os apontamentos já
  --    estarão vinculados e ela não encontrará nada elegível.
  PERFORM pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));

  -- 4. Seleciona e trava os apontamentos elegíveis.
  --    `FOR UPDATE OF te` trava só timesheet_entries, não as tabelas do join,
  --    impedindo que um Salvar de apontamento altere os valores no meio da
  --    apuração. `ORDER BY te.id` dá ordem determinística de travamento.
  SELECT coalesce(array_agg(x.id), '{}'::uuid[])
    INTO _ids
  FROM (
    SELECT te.id
    FROM public.timesheet_entries te
    JOIN public.timesheets t ON t.id = te.timesheet_id
    JOIN public.operations  o ON o.id = t.operation_id
    WHERE o.client_id     = _client_id
      AND t.work_date     BETWEEN _period_start AND _period_end
      AND te.status      <> 'absent'::public.attendance_status
      AND te.invoice_id  IS NULL
    ORDER BY te.id
    FOR UPDATE OF te
  ) x;

  _elegiveis := coalesce(array_length(_ids, 1), 0);

  IF _elegiveis = 0 THEN
    RAISE EXCEPTION 'Nenhum lançamento faturável no período para este cliente.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 5. Fatura. Os totais são somados aqui, a partir dos snapshots gravados no
  --    apontamento — o navegador não informa valor nenhum.
  INSERT INTO public.invoices (
    client_id, period_start, period_end, status,
    total_dailies, total_overtime, total_amount, total_cost
  )
  SELECT
    _client_id,
    _period_start,
    _period_end,
    'closed'::public.invoice_status,
    count(*),
    round(sum(te.overtime_minutes)::numeric / 60, 2),
    sum(te.billed_amount),
    sum(te.cost_amount)
  FROM public.timesheet_entries te
  WHERE te.id = ANY(_ids)
  RETURNING * INTO _fatura;

  -- 6. Itens: uma linha de diárias por operação.
  --    O valor de hora extra por lançamento é billed_amount - daily_rate_snapshot,
  --    a mesma fórmula usada em src/lib/ledger.ts. Como todas as colunas são
  --    numeric(12,2), diárias + extras fecham exatamente com o total da fatura.
  INSERT INTO public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount
  )
  SELECT
    _fatura.id,
    o.id,
    o.name || ' — diárias',
    count(*),
    round(
      (sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)))
      / count(*), 2),
    sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
  FROM public.timesheet_entries te
  JOIN public.timesheets t ON t.id = te.timesheet_id
  JOIN public.operations  o ON o.id = t.operation_id
  WHERE te.id = ANY(_ids)
  GROUP BY o.id, o.name;

  -- 7. Itens: uma linha de horas extras por operação, só quando houver valor.
  --    O CASE protege a divisão: um valor de extra sem minutos registrados
  --    ainda precisa entrar no item, senão a soma dos itens não fecharia com o
  --    total da fatura.
  INSERT INTO public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount
  )
  SELECT
    _fatura.id,
    o.id,
    o.name || ' — horas extras',
    round(sum(te.overtime_minutes)::numeric / 60, 2),
    CASE
      WHEN sum(te.overtime_minutes) > 0
        THEN round(
          sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
          / (sum(te.overtime_minutes)::numeric / 60), 2)
      ELSE 0
    END,
    sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
  FROM public.timesheet_entries te
  JOIN public.timesheets t ON t.id = te.timesheet_id
  JOIN public.operations  o ON o.id = t.operation_id
  WHERE te.id = ANY(_ids)
  GROUP BY o.id, o.name
  HAVING sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)) > 0;

  -- 8. Vínculo. `invoice_id IS NULL` é repetido de propósito: mesmo com o
  --    advisory lock e o FOR UPDATE, nada aqui sobrescreve um vínculo existente.
  UPDATE public.timesheet_entries te
  SET invoice_id = _fatura.id
  WHERE te.id = ANY(_ids)
    AND te.invoice_id IS NULL;

  GET DIAGNOSTICS _vinculados = ROW_COUNT;

  -- 9. Se vinculou menos do que selecionou, alguém alterou os dados no meio.
  --    A exceção desfaz fatura, itens e vínculos de uma vez.
  IF _vinculados <> _elegiveis THEN
    RAISE EXCEPTION 'Conflito de concorrência: % de % lançamentos vinculados.',
      _vinculados, _elegiveis
      USING ERRCODE = '40001';
  END IF;

  RETURN _fatura;
END;
$$;

COMMENT ON FUNCTION public.gerar_fatura(uuid, date, date) IS
  'Gera uma fatura em transação única: seleciona apontamentos não faturados do '
  'cliente no período, soma os totais no servidor, cria invoice e invoice_items '
  'e vincula os lançamentos. Exige papel admin e sessão aal2. Qualquer falha '
  'desfaz tudo.';

-- Os grants não mudam. Reafirmados aqui porque CREATE OR REPLACE preserva a
-- ACL existente, mas deixar explícito evita que uma leitura futura precise
-- caçar o estado em outra migration.
REVOKE ALL ON FUNCTION public.gerar_fatura(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gerar_fatura(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.gerar_fatura(uuid, date, date) TO authenticated;
