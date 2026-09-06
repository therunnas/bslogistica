-- Invariável de negócio: um colaborador gera no máximo UMA diária faturável por
-- operação e data.
--
--   employee_id + operation_id + work_date  ->  no máximo 1 lançamento faturável
--
-- Trabalhar além da jornada prevista vira HORA EXTRA no lançamento existente,
-- nunca uma segunda diária. Dois turnos no mesmo dia continuam válidos — para
-- colaboradores diferentes.
--
-- Isto é integridade financeira, não controle de acesso. Nenhuma policy, papel
-- ou grant de tabela é alterado aqui.
--
-- ---------------------------------------------------------------------------
-- Por que não bastava o que já existia
-- ---------------------------------------------------------------------------
--
-- A chave da invariável atravessa duas tabelas: `operation_id` e `work_date`
-- moram em `timesheets`, `employee_id` e `status` moram em `timesheet_entries`.
-- O Postgres não expressa UNIQUE entre tabelas, e os dois uniques existentes
-- resolvem outra coisa:
--
--   UNIQUE (timesheet_id, employee_id)          -> só dentro da mesma folha
--   UNIQUE (operation_id, shift_id, work_date)  -> uma folha por turno, o que é
--                                                  correto e proposital
--
-- Daí um colaborador em dois turnos da mesma operação no mesmo dia render duas
-- diárias: são duas folhas legítimas, e cada lançamento recebe `daily_rate`
-- inteiro.
--
-- A solução traz a chave para dentro de `timesheet_entries`, onde um índice
-- único consegue enxergá-la. Índice, e não trigger de validação: só o índice é
-- avaliado no commit, então ele é o único que resiste a duas abas, a chamada
-- direta ao PostgREST e a concorrência — um `SELECT ... EXISTS` seguido de
-- INSERT não é atômico em READ COMMITTED e deixa as duas transações passarem.


-- ---------------------------------------------------------------------------
-- 1. Chave desnormalizada
-- ---------------------------------------------------------------------------
-- Coluna GENERATED não serve: não pode referenciar outra tabela. São colunas
-- comuns, mantidas exclusivamente por trigger — o cliente nunca as controla.

ALTER TABLE public.timesheet_entries
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS work_date    date;


-- ---------------------------------------------------------------------------
-- 2. Backfill a partir da folha pai
-- ---------------------------------------------------------------------------

UPDATE public.timesheet_entries te
   SET operation_id = t.operation_id,
       work_date    = t.work_date
  FROM public.timesheets t
 WHERE t.id = te.timesheet_id
   AND (te.operation_id IS DISTINCT FROM t.operation_id
        OR te.work_date IS DISTINCT FROM t.work_date);


-- ---------------------------------------------------------------------------
-- 3. Validação do backfill
-- ---------------------------------------------------------------------------
-- Antes de exigir NOT NULL e antes de criar o índice: se algum lançamento ficou
-- sem chave ou divergindo do pai, a migration para aqui e desfaz tudo, em vez
-- de aplicar um índice sobre dado inconsistente.

DO $backfill$
DECLARE
  _sem_chave  integer;
  _divergente integer;
BEGIN
  SELECT count(*) INTO _sem_chave
    FROM public.timesheet_entries
   WHERE operation_id IS NULL OR work_date IS NULL;

  IF _sem_chave > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % lançamento(s) sem operation_id/work_date.', _sem_chave;
  END IF;

  SELECT count(*) INTO _divergente
    FROM public.timesheet_entries te
    JOIN public.timesheets t ON t.id = te.timesheet_id
   WHERE te.operation_id IS DISTINCT FROM t.operation_id
      OR te.work_date    IS DISTINCT FROM t.work_date;

  IF _divergente > 0 THEN
    RAISE EXCEPTION 'Backfill inconsistente: % lançamento(s) divergem da folha pai.', _divergente;
  END IF;
END
$backfill$;

ALTER TABLE public.timesheet_entries
  ALTER COLUMN operation_id SET NOT NULL,
  ALTER COLUMN work_date    SET NOT NULL;


-- ---------------------------------------------------------------------------
-- 4. Sincronização: a chave vem sempre do pai, nunca do payload
-- ---------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE, sobrescrevendo em toda execução. Um POST ao
-- PostgREST informando `operation_id` ou `work_date` de outra operação tem os
-- valores substituídos pelos reais da folha referenciada em `timesheet_id`:
-- não há como escapar do índice forjando a chave.

CREATE OR REPLACE FUNCTION public.sincronizar_chave_da_diaria()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  _operation_id uuid;
  _work_date    date;
BEGIN
  SELECT t.operation_id, t.work_date
    INTO _operation_id, _work_date
    FROM public.timesheets t
   WHERE t.id = NEW.timesheet_id;

  -- Fail-closed: sem folha visível não há chave confiável para indexar.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha % não encontrada para o lançamento.', NEW.timesheet_id
      USING ERRCODE = '23503';
  END IF;

  NEW.operation_id := _operation_id;
  NEW.work_date    := _work_date;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sincronizar_chave_da_diaria() IS
  'Copia operation_id e work_date da folha pai para o lançamento, sobrescrevendo '
  'o que vier no payload. É o que impede forjar a chave da invariável de diária.';

DROP TRIGGER IF EXISTS trg_timesheet_entries_chave ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_chave
  BEFORE INSERT OR UPDATE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_chave_da_diaria();


-- ---------------------------------------------------------------------------
-- 5. Propagação: mover a folha move os lançamentos
-- ---------------------------------------------------------------------------
-- Trocar `operation_id` ou `work_date` de uma folha muda a chave de todos os
-- lançamentos dela. O UPDATE abaixo dispara o trigger do item 4 em cada filho,
-- que relê o pai já atualizado. Se a movimentação criar colisão, o índice
-- levanta 23505 dentro da mesma transação e o UPDATE da folha é desfeito junto
-- — recusa atômica, sem estado intermediário.

CREATE OR REPLACE FUNCTION public.propagar_chave_da_diaria()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.timesheet_entries
     SET operation_id = NEW.operation_id,
         work_date    = NEW.work_date
   WHERE timesheet_id = NEW.id;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.propagar_chave_da_diaria() IS
  'Repassa operation_id e work_date da folha para os lançamentos filhos. '
  'Colisão resultante é recusada pelo índice único na mesma transação.';

DROP TRIGGER IF EXISTS trg_timesheets_propaga_chave ON public.timesheets;
CREATE TRIGGER trg_timesheets_propaga_chave
  AFTER UPDATE OF operation_id, work_date ON public.timesheets
  FOR EACH ROW
  WHEN (OLD.operation_id IS DISTINCT FROM NEW.operation_id
        OR OLD.work_date IS DISTINCT FROM NEW.work_date)
  EXECUTE FUNCTION public.propagar_chave_da_diaria();


-- ---------------------------------------------------------------------------
-- 6. A invariável
-- ---------------------------------------------------------------------------
-- `absent` fica de fora: falta não é diária, e alguém pode faltar num turno e
-- trabalhar em outro. `present` e `replacement` contam — é exatamente o mesmo
-- recorte que public.gerar_fatura usa para faturar (status <> 'absent'), então
-- a função de faturamento não precisa de alteração nenhuma.
--
-- EXCEÇÃO HISTÓRICA — leia antes de mexer:
--
--   a453c848-3478-4388-858a-12546103d10b
--
-- Lançamento de 05/09/2026, operação f2cb1dfc-620f-4262-817f-3379590052bb,
-- turno Noturno, 480 min, R$ 180,00, JÁ FATURADO na invoice
-- c8452cd0-b76d-4c5a-91f4-a7033f609530. É anterior a esta invariável e o único
-- caso existente. Fica preservado exatamente como foi faturado: nada nele é
-- alterado, e a fatura não é recalculada.
--
-- O par dele — 5ebf2a8b-cf39-4862-869f-030e7f49377d, turno Matutino, 1200 min,
-- R$ 450,00 — permanece SOB o índice como a diária canônica do dia. O critério
-- é objetivo: sob a regra nova, a diária é a da maior jornada e o excedente
-- deveria ter virado hora extra. O excedente é o que sai do índice.
--
-- Esta exclusão NÃO autoriza novas duplicidades e NÃO é mecanismo de escape:
-- vale para um id literal, já existente e já faturado. Acrescentar outro id
-- aqui para "resolver" um conflito futuro é contornar a regra, não aplicá-la —
-- o caminho certo é lançar o período extra como hora extra na diária existente.

CREATE UNIQUE INDEX IF NOT EXISTS timesheet_entries_uma_diaria_por_operacao_dia
  ON public.timesheet_entries (employee_id, operation_id, work_date)
  WHERE status <> 'absent'::public.attendance_status
    AND id <> 'a453c848-3478-4388-858a-12546103d10b'::uuid;

COMMENT ON INDEX public.timesheet_entries_uma_diaria_por_operacao_dia IS
  'Uma diária faturável por colaborador, operação e data. Falta não conta. '
  'Exclui um id legado, já faturado e anterior à regra — exceção histórica, '
  'não mecanismo de escape para novas duplicidades.';


-- ---------------------------------------------------------------------------
-- 7. P1-1: uma única folha sem turno por operação e data
-- ---------------------------------------------------------------------------
-- UNIQUE (operation_id, shift_id, work_date) é NULLS DISTINCT, o padrão do
-- Postgres: NULL nunca é igual a NULL para efeito de unicidade, então N folhas
-- (operação, NULL, data) são aceitas hoje. O que evita isso é a busca da
-- aplicação — proteção de tela, não de banco. Este índice parcial fecha o
-- caminho no banco.

CREATE UNIQUE INDEX IF NOT EXISTS timesheets_uma_folha_sem_turno
  ON public.timesheets (operation_id, work_date)
  WHERE shift_id IS NULL;

COMMENT ON INDEX public.timesheets_uma_folha_sem_turno IS
  'Uma folha sem turno por operação e data. O UNIQUE de três colunas não cobre '
  'isso porque trata NULLs como distintos entre si.';


-- ---------------------------------------------------------------------------
-- 8. Grants das funções novas
-- ---------------------------------------------------------------------------
-- Mesmo padrão já aplicado em 007: o Postgres concede EXECUTE a PUBLIC em toda
-- função nova. São funções de trigger — chamá-las direto falha de qualquer
-- forma —, mas ficariam expostas em /rest/v1/rpc/ sem motivo. Triggers não
-- reavaliam EXECUTE a cada disparo, então revogar não os afeta.

REVOKE ALL ON FUNCTION public.sincronizar_chave_da_diaria() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sincronizar_chave_da_diaria() FROM anon;
REVOKE ALL ON FUNCTION public.propagar_chave_da_diaria()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propagar_chave_da_diaria()    FROM anon;
