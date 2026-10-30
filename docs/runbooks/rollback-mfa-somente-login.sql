-- ROLLBACK da migration 034 (AUTH-01D.R1): volta ao estado 032+033 (operações críticas em AAL2 literal).
-- NÃO é migration e NÃO fica em supabase/migrations: não executar sem autorização.
-- Ordem: reverter o APLICATIVO primeiro (para ele voltar a exigir AAL2 do admin nas telas críticas), depois isto.
-- Não toca a 032 (helpers/policies cotidianas) nem a 033 (gatilhos de vigência).
-- Efeito: contas sem fator verificado voltam a ser barradas nas operações críticas. Dados não mudam.

begin;

CREATE OR REPLACE FUNCTION public.condicoes_exigir_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  -- Segundo fator antes do papel: uma sessão aal1 nem tem o papel consultado.
  if (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  if not coalesce(public.identidade_atual_utilizavel(), false) then
    raise exception 'Conta ou sessão sem validade.' using errcode = '42501';
  end if;
  if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'Apenas administradores podem gerir condições financeiras.' using errcode = '42501';
  end if;
end;
$function$;

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

  if (auth.jwt() ->> 'aal') is distinct from 'aal2' then
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

CREATE OR REPLACE FUNCTION public.exigir_aal2_taxa_legada()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  _mudou boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;
  -- INSERT: vale o que foge do default da coluna (a linha nasce sem taxa); UPDATE: vale o que mudou.
  if tg_table_name = 'contracts' then
    _mudou := case when tg_op = 'INSERT'
      then new.daily_rate is distinct from 0 or new.shift_hours is distinct from 8
        or new.ot_factor is distinct from 1 or new.ot_tolerance_min is distinct from 10
      else new.daily_rate is distinct from old.daily_rate
        or new.shift_hours is distinct from old.shift_hours
        or new.ot_factor is distinct from old.ot_factor
        or new.ot_tolerance_min is distinct from old.ot_tolerance_min end;
  elsif tg_table_name = 'employees' then
    _mudou := case when tg_op = 'INSERT'
      then new.daily_cost is distinct from 0
      else new.daily_cost is distinct from old.daily_cost end;
  else
    _mudou := case when tg_op = 'INSERT'
      then new.agreed_amount is not null
      else new.agreed_amount is distinct from old.agreed_amount end;
  end if;
  if _mudou and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Informar ou alterar condições financeiras exige a verificação em duas etapas (dois fatores).'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

alter policy admin_audit_log_exige_admin_aal2 on public.admin_audit_log using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy admin_audit_log_leitura_admin on public.admin_audit_log using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_engine_settings_exige_admin_aal2 on public.financial_engine_settings using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_engine_settings_leitura_admin on public.financial_engine_settings using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_terms_audit_exige_admin_aal2 on public.financial_terms_audit using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_terms_audit_leitura_admin on public.financial_terms_audit using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy invoice_items_delete_exige_aal2 on public.invoice_items using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy invoice_items_insert_exige_aal2 on public.invoice_items with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy invoice_items_update_exige_aal2 on public.invoice_items using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy invoices_delete_exige_aal2 on public.invoices using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy invoices_insert_exige_aal2 on public.invoices with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy invoices_update_exige_aal2 on public.invoices using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy user_operation_access_admin on public.user_operation_access using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy user_operation_access_somente_admin_aal2 on public.user_operation_access using (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));

commit;
