-- O papel operacional gerencia apontamentos, mas o vínculo com uma fatura é
-- financeiro. O trigger protege INSERT e UPDATE sem retirar os demais campos
-- operacionais da policy timesheet_entries_staff.

CREATE OR REPLACE FUNCTION public.protect_timesheet_invoice_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _mudou_vinculo boolean :=
    CASE
      WHEN TG_OP = 'INSERT' THEN NEW.invoice_id IS NOT NULL
      ELSE NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    END;
BEGIN
  IF _mudou_vinculo
     AND current_user NOT IN ('postgres', 'service_role')
     AND NOT COALESCE(
       public.has_role(auth.uid(), 'admin'::public.app_role),
       false
     ) THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar o vínculo de fatura.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_timesheet_invoice_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_timesheet_invoice_link() FROM anon;
REVOKE ALL ON FUNCTION public.protect_timesheet_invoice_link() FROM authenticated;
REVOKE ALL ON FUNCTION public.protect_timesheet_invoice_link() FROM service_role;

DROP TRIGGER IF EXISTS trg_timesheet_entries_protect_invoice_link
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_protect_invoice_link
  BEFORE INSERT OR UPDATE OF invoice_id ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.protect_timesheet_invoice_link();

COMMENT ON FUNCTION public.protect_timesheet_invoice_link() IS
  'Impede usuários não administradores de criar ou alterar invoice_id em apontamentos.';
