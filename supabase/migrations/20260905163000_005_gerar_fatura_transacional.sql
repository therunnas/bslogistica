-- Substitui a geração de fatura em três escritas do navegador por uma única
-- transação no Postgres.
--
-- O fluxo anterior fazia INSERT invoices, INSERT invoice_items e UPDATE
-- timesheet_entries.invoice_id em chamadas separadas, sem transação e sem
-- filtrar apontamento já faturado. Qualquer falha no meio deixava estado
-- parcial, e refaturar o mesmo período movia o vínculo para a fatura nova,
-- deixando a anterior órfã. Ver docs/divida-tecnica/faturamento-nao-transacional.md
--
-- Esta migration é aditiva: cria uma função e ajusta seus grants. Nenhuma
-- tabela, coluna, enum, policy ou linha é alterada.

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
  'e vincula os lançamentos. Exige papel admin. Qualquer falha desfaz tudo.';

-- Nenhum papel anônimo executa isto, e o padrão do Postgres (EXECUTE para
-- PUBLIC) é removido explicitamente.
REVOKE ALL ON FUNCTION public.gerar_fatura(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gerar_fatura(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.gerar_fatura(uuid, date, date) TO authenticated;
