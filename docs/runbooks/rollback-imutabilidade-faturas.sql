-- FIN-20C. Origem: schema 046. Destino: 045 (guardas de fatura da migration 011).
-- REDUZ proteção: depois deste script, uma fatura cujo lastro é SÓ adicional/container volta a ser editável,
-- apagável e forjável por `authenticated` e `service_role`. Usar apenas se a 046 comprovadamente impedir uma
-- operação legítima, e reaplicar uma correção equivalente o quanto antes. Não use "para destravar" uma edição
-- de fatura emitida: corrija o dado pelo procedimento financeiro apropriado.
--
-- NÃO altera dado de negócio, `gerar_fatura`, RLS nem o histórico de migrations. Para o schema ficar
-- exatamente como na 045, apague depois o registro da 046 (com autorização):
--   delete from supabase_migrations.schema_migrations where version = '20261113120000';
--
-- Privilégios: restaura INSERT/UPDATE/DELETE em `invoices` e `invoice_items` para `authenticated` e
-- `service_role` (estado do HML antes da 046). Não concede nada a `anon`: no HML ele nunca teve DML nessas
-- tabelas (num Supabase local recém-criado os padrões da plataforma o concedem; a RLS nega de qualquer forma).
-- Janela sem geração de fatura em andamento: a trava abaixo falha na hora (55P03) em vez de esperar.
begin;
lock table public.invoices, public.invoice_items in access exclusive mode nowait;

-- Definições ORIGINAIS da migration 011, copiadas do texto da própria migration (SECURITY INVOKER; só
-- enxergam apontamento como lastro). O texto idêntico faz o hash do catálogo voltar ao da 045.

CREATE OR REPLACE FUNCTION public.bloquear_edicao_fatura_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _antes  jsonb;
  _depois jsonb;
  _campos text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.timesheet_entries te WHERE te.invoice_id = OLD.id
  ) THEN
    RETURN NEW;
  END IF;

  _antes  := to_jsonb(OLD) - 'updated_at';
  _depois := to_jsonb(NEW) - 'updated_at';

  IF _depois IS DISTINCT FROM _antes THEN
    SELECT string_agg(k, ', ' ORDER BY k)
      INTO _campos
      FROM jsonb_object_keys(_antes) AS k
     WHERE _antes -> k IS DISTINCT FROM _depois -> k;

    RAISE EXCEPTION
      'Fatura com lastro vinculado é imutável. Alterações recusadas em: %.',
      _campos
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_itens_fatura_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _faturas uuid[];
BEGIN
  -- No UPDATE entram as DUAS faturas: a de origem e a de destino. Mover um
  -- item para fora de uma fatura fechada é tão grave quanto editá-lo.
  _faturas :=
    CASE TG_OP
      WHEN 'DELETE' THEN ARRAY[OLD.invoice_id]
      WHEN 'INSERT' THEN ARRAY[NEW.invoice_id]
      ELSE ARRAY[OLD.invoice_id, NEW.invoice_id]
    END;

  IF EXISTS (
    SELECT 1
      FROM public.timesheet_entries te
     WHERE te.invoice_id = ANY(_faturas)
  ) THEN
    RAISE EXCEPTION
      'Itens de fatura com lastro vinculado são imutáveis.'
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_truncate_lastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.timesheet_entries te WHERE te.invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'TRUNCATE bloqueado: existe apontamento faturado. Lastro financeiro não é removível em massa.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NULL;
END;
$$;

revoke all on function public.bloquear_edicao_fatura_fechada() from public, anon, authenticated, service_role;
revoke all on function public.bloquear_itens_fatura_fechada() from public, anon, authenticated, service_role;
revoke all on function public.bloquear_truncate_lastro() from public, anon, authenticated, service_role;

comment on function public.bloquear_edicao_fatura_fechada() is
  'Congela a linha inteira de uma fatura que já tenha apontamento vinculado, comparando to_jsonb e ignorando apenas updated_at. Não atinge a construção em gerar_fatura, que vincula por último.';
comment on function public.bloquear_itens_fatura_fechada() is
  'Impede INSERT, UPDATE e DELETE de itens de fatura já com lastro vinculado, incluindo mover um item de uma fatura fechada para outra. Sem exceção de papel.';
comment on function public.bloquear_truncate_lastro() is
  'Recusa TRUNCATE em timesheet_entries e invoice_items enquanto existir apontamento faturado. TRUNCATE não executa gatilho de linha.';

drop trigger if exists trg_invoices_bloqueia_edicao_fechada on public.invoices;
create trigger trg_invoices_bloqueia_edicao_fechada
  before update on public.invoices
  for each row execute function public.bloquear_edicao_fatura_fechada();

grant insert, update, delete on table public.invoices, public.invoice_items to authenticated, service_role;
commit;
