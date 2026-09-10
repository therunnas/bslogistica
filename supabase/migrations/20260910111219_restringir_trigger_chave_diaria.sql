-- A função sincronizar_chave_da_diaria() deve validar todo INSERT e toda
-- alteração da chave diária. Ela não deve rodar em updates exclusivamente
-- financeiros, inclusive no ON DELETE SET NULL da FK de invoice_id.

DROP TRIGGER IF EXISTS trg_timesheet_entries_chave
  ON public.timesheet_entries;

CREATE TRIGGER trg_timesheet_entries_chave
  BEFORE INSERT OR UPDATE OF timesheet_id, operation_id, work_date
  ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_chave_da_diaria();

COMMENT ON TRIGGER trg_timesheet_entries_chave ON public.timesheet_entries IS
  'Sincroniza operation_id e work_date somente ao inserir ou alterar a chave diária.';
