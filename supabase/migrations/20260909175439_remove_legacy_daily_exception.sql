-- O novo projeto parte vazio: a invariável final não carrega a exceção de uma
-- linha pertencente ao banco antigo, já excluído.

BEGIN;

DROP INDEX IF EXISTS public.timesheet_entries_uma_diaria_por_operacao_dia;

CREATE UNIQUE INDEX timesheet_entries_uma_diaria_por_operacao_dia
  ON public.timesheet_entries (employee_id, operation_id, work_date)
  WHERE status <> 'absent'::public.attendance_status;

COMMENT ON INDEX public.timesheet_entries_uma_diaria_por_operacao_dia IS
  'No máximo uma diária faturável por colaborador, operação e data. '
  'Lançamentos com status absent não contam como diária.';

COMMIT;
