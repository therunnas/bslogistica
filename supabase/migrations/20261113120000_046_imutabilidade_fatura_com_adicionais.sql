-- FIN-20C — Imutabilidade da fatura emitida, com ou sem apontamento.
--
-- DEFEITO (baseline 045). As guardas da migration 011 chamam uma fatura de "fechada" quando existe
-- `timesheet_entries.invoice_id = fatura`. Desde a 029 uma fatura também pode ter como lastro SÓ
-- `billing_additionals.invoice_id` (adicional avulso ou serviço de container, 045). Nesse caso a guarda
-- não enxerga lastro nenhum: total, status, notas e itens da fatura emitida podiam ser editados,
-- apagados ou forjados pelo PostgREST (`authenticated` e `service_role` têm INSERT/UPDATE/DELETE em
-- `invoices` e `invoice_items` desde a 20260903173204, e a aplicação só LÊ essas tabelas).
--
-- CORREÇÃO (aditiva; nenhuma linha é lida, escrita ou movida):
--   1. "Fatura com lastro" passa a ser: apontamento vinculado OU adicional vinculado. Vale nas três
--      guardas (UPDATE/DELETE da fatura, itens, TRUNCATE em massa).
--   2. O gatilho de `invoices` passa a cobrir também DELETE, de forma explícita. Antes a exclusão só era
--      barrada de modo incidental (FK `billing_additionals.invoice_id` e efeitos em cascata).
--   3. As funções de guarda viram SECURITY DEFINER com search_path fixo: a pergunta "esta fatura tem
--      lastro?" não pode depender da RLS de quem escreve (um admin sem MFA enxergaria zero adicionais
--      sob a policy de `billing_additionals` e a fatura pareceria "aberta").
--   4. Revoga INSERT/UPDATE/DELETE/TRUNCATE de `anon`, `authenticated` e `service_role` em `invoices` e
--      `invoice_items`. Quem escreve fatura é `gerar_fatura` (SECURITY DEFINER, dono `postgres`), que não
--      é afetada. Mantém SELECT (Fechamento, Faturamento, Relatórios).
--
-- NÃO ATINGE a construção da fatura: `gerar_fatura` cria fatura e itens e SÓ NO FIM grava os vínculos
-- (045, passos finais). Antes dos vínculos a fatura não tem lastro, logo as guardas não disparam;
-- depois, ela está congelada. Tudo numa transação: a fatura não existe para ninguém antes do COMMIT,
-- então não há janela visível sem congelamento e nenhum lock novo entra no grafo de deadlock.
--
-- NÃO ALTERA dados, regras comerciais, RLS, `gerar_fatura`, `billing_additionals` nem Containers
-- (já imutáveis: `proteger_adicional` e `proteger_servico_container`).
-- Rollback: docs/runbooks/rollback-imutabilidade-faturas.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Fatura (UPDATE e, agora, DELETE).
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_edicao_fatura_fechada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _antes  jsonb;
  _depois jsonb;
  _campos text;
begin
  if not (
    exists (select 1 from public.timesheet_entries te where te.invoice_id = old.id)
    or exists (select 1 from public.billing_additionals a where a.invoice_id = old.id)
  ) then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Fatura com lastro vinculado é imutável e não pode ser excluída.'
      using errcode = '42501';
  end if;

  _antes  := to_jsonb(old) - 'updated_at';
  _depois := to_jsonb(new) - 'updated_at';

  if _depois is distinct from _antes then
    select string_agg(k, ', ' order by k)
      into _campos
      from jsonb_object_keys(_antes) as k
     where _antes -> k is distinct from _depois -> k;

    raise exception
      'Fatura com lastro vinculado é imutável. Alterações recusadas em: %.',
      _campos
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Itens da fatura (INSERT, UPDATE, DELETE; no UPDATE valem a fatura de origem e a de destino).
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_itens_fatura_fechada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _faturas uuid[];
begin
  _faturas :=
    case tg_op
      when 'DELETE' then array[old.invoice_id]
      when 'INSERT' then array[new.invoice_id]
      else array[old.invoice_id, new.invoice_id]
    end;

  if exists (select 1 from public.timesheet_entries te where te.invoice_id = any(_faturas))
     or exists (select 1 from public.billing_additionals a where a.invoice_id = any(_faturas)) then
    raise exception
      'Itens de fatura com lastro vinculado são imutáveis.'
      using errcode = '42501';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. TRUNCATE em massa de apontamentos e itens de fatura (TRUNCATE não passa pelos gatilhos de linha).
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_truncate_lastro()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if exists (select 1 from public.timesheet_entries te where te.invoice_id is not null)
     or exists (select 1 from public.billing_additionals a where a.invoice_id is not null) then
    raise exception
      'TRUNCATE bloqueado: existe apontamento ou adicional faturado. Lastro financeiro não é removível em massa.'
      using errcode = '42501';
  end if;

  return null;
end;
$$;

-- As funções de guarda não são chamáveis por papel nenhum da API (só disparam como gatilho).
revoke all on function public.bloquear_edicao_fatura_fechada() from public, anon, authenticated, service_role;
revoke all on function public.bloquear_itens_fatura_fechada() from public, anon, authenticated, service_role;
revoke all on function public.bloquear_truncate_lastro() from public, anon, authenticated, service_role;

comment on function public.bloquear_edicao_fatura_fechada() is
  'Congela a linha inteira de uma fatura com lastro (apontamento OU adicional vinculado) e recusa a exclusão, comparando to_jsonb e ignorando apenas updated_at. Não atinge a construção em gerar_fatura, que vincula por último. SECURITY DEFINER: independe da RLS de quem escreve. FIN-20C (046).';
comment on function public.bloquear_itens_fatura_fechada() is
  'Impede INSERT, UPDATE e DELETE de itens de fatura com lastro (apontamento OU adicional vinculado), incluindo mover um item de ou para uma fatura fechada. Sem exceção de papel. FIN-20C (046).';
comment on function public.bloquear_truncate_lastro() is
  'Recusa TRUNCATE em timesheet_entries e invoice_items enquanto existir apontamento OU adicional faturado. TRUNCATE não executa gatilho de linha. FIN-20C (046).';

-- O gatilho de `invoices` passa a incluir DELETE (mesmo nome; as outras guardas mantêm a definição).
drop trigger if exists trg_invoices_bloqueia_edicao_fechada on public.invoices;
create trigger trg_invoices_bloqueia_edicao_fechada
  before update or delete on public.invoices
  for each row execute function public.bloquear_edicao_fatura_fechada();

-- ---------------------------------------------------------------------------
-- 4. Nenhum papel da API escreve em fatura: só gerar_fatura (dono postgres). Leitura preservada.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on table public.invoices, public.invoice_items
  from public, anon, authenticated, service_role;
grant select on table public.invoices, public.invoice_items to authenticated, service_role;

commit;
