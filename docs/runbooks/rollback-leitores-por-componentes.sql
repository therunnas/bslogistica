-- REVERSÃO da migration 20261104120000_037_leitores_por_componentes (FIN-PR-03).
--
-- Devolve os leitores à forma anterior: gerar_fatura com o corpo VIGENTE antes da 037 (034, com o
-- guard de MFA opcional `mfa_cotidiano_ok`) e o ajuste do acumulado com o corpo da 032 (guard de
-- leitura). NÃO toca: 035, 036, autenticação, MFA, guards, RLS, policies, grants, gatilhos 031/033.
--
-- REVERTER CÓDIGO, FUNÇÕES E DADOS SÃO COISAS DIFERENTES
--   * código: reverter o deploy do app. O app desta etapa lê o modelo antigo num banco sem a 036,
--     então funciona com ou sem esta reversão;
--   * funções: este script;
--   * dados: nada é apagado nem recalculado. Faturas emitidas com a 037 continuam como foram emitidas
--     (itens discriminados por tarifa). Por isso a reversão RECUSA se já existir item de um tipo novo
--     (horas_especiais, adicional_diario): devolver o CHECK antigo exigiria apagar ou reescrever
--     dados financeiros, o que não é rollback seguro.
--   * consumidores: os leitores TypeScript (componentes-financeiros.ts) continuam corretos com os
--     corpos antigos, que derivam a HE enquanto não houver adicional nem horas especiais.
--
-- Executar só com autorização, como `postgres`, em uma transação.

begin;

do $pre$
begin
  if exists (select 1 from public.invoice_items where kind in ('horas_especiais', 'adicional_diario')) then
    raise exception 'Reversão recusada: há itens de fatura dos tipos novos (horas_especiais/adicional_diario).'
      using errcode = '55000';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- Funções: corpo vigente antes da 037
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gerar_fatura(_client_id uuid, _period_start date, _period_end date)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _fatura       public.invoices;
  _ids          uuid[];
  _adicionais   uuid[];
  _elegiveis    integer;
  _n_adicionais integer;
  _vinculados   integer;
  _total_adic   numeric(12,2);
  _total_ajuste numeric(12,2);
  _minutos_ajuste integer;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.'
      using errcode = '28000';
  end if;

  -- Política definitiva (034): o MFA protege só o login. Conta com fator verificado em aal1 segue barrada.
  if not public.mfa_cotidiano_ok() then
    raise exception 'Autenticação de dois fatores obrigatória.'
      using errcode = '42501';
  end if;

  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Apenas administradores podem gerar faturas.'
      using errcode = '42501';
  end if;

  if _client_id is null or _period_start is null or _period_end is null then
    raise exception 'Cliente e período são obrigatórios.'
      using errcode = '22023';
  end if;

  if _period_start > _period_end then
    raise exception 'Período inválido: início (%) posterior ao fim (%).',
      _period_start, _period_end
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.clients where id = _client_id) then
    raise exception 'Cliente não encontrado.'
      using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));

  select coalesce(array_agg(x.id), '{}'::uuid[])
    into _ids
  from (
    select te.id
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    join public.operations  o on o.id = t.operation_id
    where o.client_id     = _client_id
      and t.work_date     between _period_start and _period_end
      and te.status      <> 'absent'::public.attendance_status
      and te.invoice_id  is null
    order by te.id
    for update of te
  ) x;

  select coalesce(array_agg(x.id), '{}'::uuid[])
    into _adicionais
  from (
    select a.id
    from public.billing_additionals a
    where a.client_id    = _client_id
      and a.period_start >= _period_start
      and a.period_end   <= _period_end
      and a.canceled_at  is null
      and a.invoice_id   is null
    order by a.id
    for update of a
  ) x;

  _elegiveis := coalesce(array_length(_ids, 1), 0);
  _n_adicionais := coalesce(array_length(_adicionais, 1), 0);

  if _elegiveis = 0 and _n_adicionais = 0 then
    raise exception 'Nenhum lançamento faturável no período para este cliente.'
      using errcode = 'P0002';
  end if;

  select coalesce(sum(a.amount), 0) into _total_adic
    from public.billing_additionals a where a.id = any(_adicionais);

  -- B8.17: o arredondamento acumulado só vale sobre um período de fechamento inteiro e sem
  -- fracionamento do mesmo colaborador entre faturas.
  perform public.validar_fechamento_acumulado(_client_id, _period_start, _period_end, _ids);

  -- B8.15: arredondamento acumulado, calculado sobre os MESMOS apontamentos travados acima (a
  -- função é estável e as linhas estão travadas: as duas leituras abaixo dão o mesmo resultado).
  select coalesce(sum(j.ajuste), 0), coalesce(sum(j.minutos_arredondados - j.minutos_brutos), 0)
    into _total_ajuste, _minutos_ajuste
    from public.ajustes_de_arredondamento_acumulado(_client_id, _period_start, _period_end, _ids) j;

  insert into public.invoices (
    client_id, period_start, period_end, status,
    total_dailies, total_overtime, total_amount, total_cost
  )
  select
    _client_id,
    _period_start,
    _period_end,
    'closed'::public.invoice_status,
    count(*),
    round((coalesce(sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes)), 0) + _minutos_ajuste)::numeric / 60, 2),
    coalesce(sum(te.billed_amount), 0) + _total_adic + _total_ajuste,
    coalesce(sum(te.cost_amount), 0)
  from public.timesheet_entries te
  where te.id = any(_ids)
  returning * into _fatura;

  -- Diárias por operação (billed_amount - hora extra; na saída antecipada, a diária proporcional).
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    o.id,
    o.name || ' — diárias',
    count(*),
    round(
      (sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)))
      / count(*), 2),
    sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)),
    'diarias'
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name;

  -- Horas extras por operação, pelos minutos COBRADOS.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    o.id,
    o.name || ' — horas extras',
    round(sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes))::numeric / 60, 2),
    case
      when sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes)) > 0
        then round(
          sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
          / (sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes))::numeric / 60), 2)
      else 0
    end,
    sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)),
    'horas_extras'
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name
  having sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)) > 0;

  -- B8.15: um item por colaborador com arredondamento acumulado diferente de zero.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    null,
    'Arredondamento acumulado de horas extras — ' || j.colaborador
      || ' (' || j.minutos_brutos || ' min → ' || j.minutos_arredondados || ' min)',
    round((j.minutos_arredondados - j.minutos_brutos)::numeric / 60, 2),
    j.valor_hora,
    j.ajuste,
    'arredondamento'
  from public.ajustes_de_arredondamento_acumulado(_client_id, _period_start, _period_end, _ids) j
  where j.ajuste <> 0
  order by j.colaborador, j.employee_id;

  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    a.operation_id,
    'Adicional — ' || a.description || coalesce(' (ref. ' || a.reference || ')', ''),
    1,
    a.amount,
    a.amount,
    'adicional'
  from public.billing_additionals a
  where a.id = any(_adicionais)
  order by a.period_start, a.id;

  update public.timesheet_entries te
  set invoice_id = _fatura.id
  where te.id = any(_ids)
    and te.invoice_id is null;

  get diagnostics _vinculados = row_count;

  if _vinculados <> _elegiveis then
    raise exception 'Conflito de concorrência: % de % lançamentos vinculados.',
      _vinculados, _elegiveis
      using errcode = '40001';
  end if;

  update public.billing_additionals a
  set invoice_id = _fatura.id
  where a.id = any(_adicionais)
    and a.invoice_id is null
    and a.canceled_at is null;

  get diagnostics _vinculados = row_count;

  if _vinculados <> _n_adicionais then
    raise exception 'Conflito de concorrência: % de % adicionais vinculados.',
      _vinculados, _n_adicionais
      using errcode = '40001';
  end if;

  return _fatura;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ajustes_de_arredondamento_acumulado(p_client_id uuid, p_inicio date, p_fim date, p_apontamentos uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(employee_id uuid, colaborador text, valor_hora numeric, minutos_brutos integer, minutos_arredondados integer, valor_bruto numeric, valor_arredondado numeric, ajuste numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin_leitura();
  if p_client_id is null or p_inicio is null or p_fim is null or p_inicio > p_fim then
    raise exception 'Cliente e período válidos são obrigatórios.' using errcode = '22023';
  end if;

  return query
  with base as (
    select te.employee_id as emp,
           te.ot_hour_rate_snapshot as taxa,
           te.billed_overtime_minutes as minutos,
           greatest(te.billed_amount - te.daily_rate_snapshot, 0) as valor
      from public.timesheet_entries te
      join public.timesheets t on t.id = te.timesheet_id
      join public.operations o on o.id = t.operation_id
      join public.contract_terms ct on ct.id = te.contract_terms_id
     where o.client_id = p_client_id
       and t.work_date between p_inicio and p_fim
       and te.status <> 'absent'::public.attendance_status
       and ct.ot_rounding_mode = 'acumulado'
       and te.billed_overtime_minutes is not null
       and case when p_apontamentos is null then te.invoice_id is null
                else te.id = any(p_apontamentos) end
  ), grupo as (
    select b.emp, b.taxa, sum(b.minutos)::integer as mb, sum(b.valor) as vb
      from base b
     group by b.emp, b.taxa
  )
  select g.emp,
         e.name,
         round(g.taxa, 2),
         g.mb,
         public.arredondar_minutos_extras(g.mb),
         g.vb,
         round(public.arredondar_minutos_extras(g.mb) / 60.0 * g.taxa, 2),
         round(public.arredondar_minutos_extras(g.mb) / 60.0 * g.taxa, 2) - g.vb
    from grupo g
    join public.employees e on e.id = g.emp
   order by e.name, g.emp, g.taxa;
end;
$function$;

-- ---------------------------------------------------------------------------
-- CHECK dos tipos de item e comentário da 030
-- ---------------------------------------------------------------------------

alter table public.invoice_items
  drop constraint invoice_items_tipo_valido,
  add constraint invoice_items_tipo_valido
    check (kind is null or kind in ('diarias', 'horas_extras', 'arredondamento', 'adicional'));

comment on column public.invoice_items.kind is
  'Tipo do item: diarias, horas_extras, arredondamento (acumulado) ou adicional. NULL = fatura anterior a 030.';

-- O helper sai por último: nenhuma função o usa depois dos corpos acima.
drop function public.componentes_do_lancamento(text, smallint, numeric, numeric, numeric, numeric, numeric, numeric);

do $pos$
begin
  if exists (select 1 from pg_proc where proname = 'componentes_do_lancamento') then
    raise exception 'Reversão incompleta: o helper ainda existe.';
  end if;
  if exists (select 1 from pg_proc p where p.proname in ('gerar_fatura', 'ajustes_de_arredondamento_acumulado')
               and p.prosrc ~ 'componentes_do_lancamento') then
    raise exception 'Reversão incompleta: um leitor ainda usa o helper.';
  end if;
end;
$pos$;

-- Conferir antes de confirmar. Para desfazer o ensaio: rollback.
commit;
