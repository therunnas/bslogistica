-- ROLLBACK da migration 032 (AUTH-01B): volta ao MFA obrigatório para toda a superfície.
-- NÃO é migration e NÃO fica em supabase/migrations: não executar sem autorização.
-- Ordem: reverter o APLICATIVO primeiro (para ele voltar a exigir AAL2 do admin), depois rodar isto.
-- Efeito: contas sem fator voltam a ser barradas nas tabelas/RPCs. Dados não mudam.

begin;

alter policy clients_exige_aal2 on public.clients using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy contracts_exige_aal2 on public.contracts using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy employees_exige_aal2 on public.employees using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy operations_exige_aal2 on public.operations using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy shifts_exige_aal2 on public.shifts using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy timesheets_exige_aal2 on public.timesheets using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy timesheet_entries_exige_aal2 on public.timesheet_entries using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy operation_team_exige_aal2 on public.operation_team using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
alter policy profiles_exige_aal2 on public.profiles using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
drop policy invoices_leitura_exige_mfa on public.invoices;
drop policy invoices_insert_exige_aal2 on public.invoices;
drop policy invoices_update_exige_aal2 on public.invoices;
drop policy invoices_delete_exige_aal2 on public.invoices;
create policy invoices_exige_aal2 on public.invoices as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
drop policy invoice_items_leitura_exige_mfa on public.invoice_items;
drop policy invoice_items_insert_exige_aal2 on public.invoice_items;
drop policy invoice_items_update_exige_aal2 on public.invoice_items;
drop policy invoice_items_delete_exige_aal2 on public.invoice_items;
create policy invoice_items_exige_aal2 on public.invoice_items as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
drop policy contract_terms_leitura_exige_mfa on public.contract_terms;
create policy contract_terms_exige_admin_aal2 on public.contract_terms as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy contract_terms_leitura_admin on public.contract_terms using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy employee_cost_terms_leitura_exige_mfa on public.employee_cost_terms;
create policy employee_cost_terms_exige_admin_aal2 on public.employee_cost_terms as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy employee_cost_terms_leitura_admin on public.employee_cost_terms using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy operation_terms_leitura_exige_mfa on public.operation_terms;
create policy operation_terms_exige_admin_aal2 on public.operation_terms as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy operation_terms_leitura_admin on public.operation_terms using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy billing_additionals_leitura_exige_mfa on public.billing_additionals;
create policy billing_additionals_exige_admin_aal2 on public.billing_additionals as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy billing_additionals_leitura_admin on public.billing_additionals using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy financial_holidays_leitura_exige_mfa on public.financial_holidays;
create policy financial_holidays_exige_admin_aal2 on public.financial_holidays as restrictive for all to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy financial_holidays_leitura_admin on public.financial_holidays using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

CREATE OR REPLACE FUNCTION public.ajustes_de_arredondamento_acumulado(p_client_id uuid, p_inicio date, p_fim date, p_apontamentos uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(employee_id uuid, colaborador text, valor_hora numeric, minutos_brutos integer, minutos_arredondados integer, valor_bruto numeric, valor_arredondado numeric, ajuste numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin();
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

CREATE OR REPLACE FUNCTION public.condicao_contrato_na_data(p_contract_id uuid, p_work_date date)
 RETURNS SETOF contract_terms
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin();
  if p_contract_id is null or p_work_date is null then
    raise exception 'Contrato e data são obrigatórios.' using errcode = '22023';
  end if;
  -- Zero linhas = sem histórico nessa data. Nunca cai para a taxa atual do contrato.
  return query
    select * from public.contract_terms
     where contract_id = p_contract_id and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date;
end;
$function$;

CREATE OR REPLACE FUNCTION public.custo_colaborador_na_data(p_employee_id uuid, p_work_date date)
 RETURNS SETOF employee_cost_terms
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin();
  if p_employee_id is null or p_work_date is null then
    raise exception 'Colaborador e data são obrigatórios.' using errcode = '22023';
  end if;
  return query
    select * from public.employee_cost_terms
     where employee_id = p_employee_id and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date;
end;
$function$;

CREATE OR REPLACE FUNCTION public.valor_acordado_operacao_na_data(p_operation_id uuid, p_work_date date)
 RETURNS SETOF operation_terms
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin();
  if p_operation_id is null or p_work_date is null then
    raise exception 'Operação e data são obrigatórias.' using errcode = '22023';
  end if;
  -- Zero linhas = sem histórico nessa data. Nunca cai para operations.agreed_amount.
  return query
    select * from public.operation_terms
     where operation_id = p_operation_id and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date;
end;
$function$;

CREATE OR REPLACE FUNCTION public.estado_motor_vigencia()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  s public.financial_engine_settings%rowtype;
  _novo char;
  _antigo char;
  _trav integer;
begin
  perform public.condicoes_exigir_admin();
  select * into s from public.financial_engine_settings where id;
  select tgenabled into _novo from pg_trigger where tgname = 'trg_timesheet_entries_calculo_vigencia' and not tgisinternal;
  select tgenabled into _antigo from pg_trigger where tgname = 'trg_timesheet_entries_calculo_financeiro' and not tgisinternal;
  select count(*) into _trav from pg_trigger
   where not tgisinternal and tgenabled = 'O'
     and tgname in ('trg_contracts_bloqueia_taxa_direta', 'trg_employees_bloqueia_taxa_direta',
                    'trg_operations_bloqueia_taxa_direta', 'trg_shifts_congela_jornada_usada');
  return jsonb_build_object(
    'ativo', s.vigencia_ativa,
    'ativada_em', s.ativada_em,
    'alterado_em', s.changed_at,
    'motivo', s.reason,
    'consistente', case when s.vigencia_ativa
                        then _novo = 'O' and _antigo = 'D' and _trav = 4
                        else _novo = 'D' and _antigo = 'O' and _trav = 0 end,
    'regras_bs', true,
    -- B8.15: arredondamento, saída antecipada cobrada, sábado, feriado e saldo de horas (030).
    'regras_definitivas', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resumo_financeiro_periodo(p_inicio date, p_fim date, p_client_id uuid DEFAULT NULL::uuid, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(receita_apontamentos numeric, adicionais numeric, ajuste_faturado numeric, ajuste_previsto numeric, receita_total numeric, a_faturar numeric, faturado numeric, ajuste_aplicavel boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  _apont      numeric;
  _apont_pend numeric;
  _adic       numeric;
  _adic_pend  numeric;
  _aj_fat     numeric := 0;
  _aj_prev    numeric := 0;
  _fat        numeric := 0;
begin
  perform public.condicoes_exigir_admin();
  if p_inicio is null or p_fim is null or p_inicio > p_fim then
    raise exception 'Período válido é obrigatório.' using errcode = '22023';
  end if;

  select coalesce(sum(te.billed_amount), 0),
         coalesce(sum(te.billed_amount) filter (where te.invoice_id is null), 0)
    into _apont, _apont_pend
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    join public.operations o on o.id = t.operation_id
   where t.work_date between p_inicio and p_fim
     and te.status <> 'absent'::public.attendance_status
     and (p_client_id is null or o.client_id = p_client_id)
     and (p_operation_id is null or o.id = p_operation_id);

  select coalesce(sum(a.amount), 0),
         coalesce(sum(a.amount) filter (where a.invoice_id is null), 0)
    into _adic, _adic_pend
    from public.billing_additionals a
   where a.period_start >= p_inicio and a.period_end <= p_fim
     and a.canceled_at is null
     and (p_client_id is null or a.client_id = p_client_id)
     and (p_operation_id is null or a.operation_id = p_operation_id);

  if p_operation_id is null then
    select coalesce(sum(it.amount), 0) into _aj_fat
      from public.invoice_items it
      join public.invoices i on i.id = it.invoice_id
     where it.kind = 'arredondamento'
       and i.period_start >= p_inicio and i.period_end <= p_fim
       and (p_client_id is null or i.client_id = p_client_id);

    select coalesce(sum(i.total_amount), 0) into _fat
      from public.invoices i
     where i.period_start >= p_inicio and i.period_end <= p_fim
       and (p_client_id is null or i.client_id = p_client_id);

    -- Quinzenas inteiras dentro do período, por cliente com hora extra acumulada sem fatura.
    select coalesce(sum(a.ajuste), 0) into _aj_prev
      from (
        select distinct o.client_id as cli
          from public.timesheet_entries te
          join public.timesheets t on t.id = te.timesheet_id
          join public.operations o on o.id = t.operation_id
          join public.contract_terms ct on ct.id = te.contract_terms_id
         where t.work_date between p_inicio and p_fim
           and te.invoice_id is null
           and ct.ot_rounding_mode = 'acumulado'
           and coalesce(te.billed_overtime_minutes, 0) > 0
           and (p_client_id is null or o.client_id = p_client_id)
      ) c
      cross join (
        select m::date as qi, (m + interval '14 days')::date as qf
          from generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') m
        union all
        select (m + interval '15 days')::date, (m + interval '1 month - 1 day')::date
          from generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') m
      ) q
      cross join lateral public.ajustes_de_arredondamento_acumulado(c.cli, q.qi, q.qf) a
     where q.qi >= p_inicio and q.qf <= p_fim;
  end if;

  return query select
    round(_apont, 2),
    round(_adic, 2),
    round(_aj_fat, 2),
    round(_aj_prev, 2),
    round(_apont + _adic + _aj_fat + _aj_prev, 2),
    round(_apont_pend + _adic_pend + _aj_prev, 2),
    round(_fat, 2),
    p_operation_id is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.saldo_de_horas_do_periodo(p_client_id uuid, p_inicio date, p_fim date)
 RETURNS TABLE(employee_id uuid, colaborador text, apontamentos integer, minutos_excedentes integer, minutos_faltantes integer, saldo integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin();
  if p_client_id is null or p_inicio is null or p_fim is null or p_inicio > p_fim then
    raise exception 'Cliente e período válidos são obrigatórios.' using errcode = '22023';
  end if;

  return query
  with base as (
    select te.employee_id as emp,
           te.worked_minutes::numeric as trabalhado,
           case
             when te.day_kind_snapshot = 'sabado' and ct.saturday_shift_hours is not null
               then ct.saturday_shift_hours * 60
             else coalesce(nullif(te.planned_minutes_snapshot, 0), coalesce(te.shift_hours_snapshot, 8) * 60)
           end as referencia
      from public.timesheet_entries te
      join public.timesheets t on t.id = te.timesheet_id
      join public.operations o on o.id = t.operation_id
      left join public.contract_terms ct on ct.id = te.contract_terms_id
     where o.client_id = p_client_id
       and t.work_date between p_inicio and p_fim
       and te.status <> 'absent'::public.attendance_status
       and te.check_in is not null and te.check_out is not null
  ), grupo as (
    select b.emp,
           count(*)::integer as n,
           sum(greatest(b.trabalhado - b.referencia, 0))::integer as mais,
           sum(greatest(b.referencia - b.trabalhado, 0))::integer as menos
      from base b
     group by b.emp
  )
  select g.emp, e.name, g.n, g.mais, g.menos, g.mais - g.menos
    from grupo g
    join public.employees e on e.id = g.emp
   order by e.name, g.emp;
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_apontamento_admin(p_operation_id uuid, p_shift_id uuid, p_work_date date, p_linhas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  _folha   public.timesheets%rowtype;
  _criada  boolean := false;
  _l       jsonb;
  _emp     uuid;
  _status  public.attendance_status;
  _existe  uuid;
  _n       integer := 0;
begin
  -- Invoker: a RLS já exige admin AAL2 nas tabelas; a entrada recusa cedo e com mensagem clara.
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  if (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Apenas administradores podem salvar o apontamento por esta função.' using errcode = '42501';
  end if;

  if p_operation_id is null or p_work_date is null then
    raise exception 'Operação e data são obrigatórias.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' or jsonb_array_length(p_linhas) = 0
     or jsonb_array_length(p_linhas) > 500 then
    raise exception 'Informe de 1 a 500 linhas.' using errcode = '22023';
  end if;

  select * into _folha from public.timesheets t
   where t.operation_id = p_operation_id and t.work_date = p_work_date
     and t.shift_id is not distinct from p_shift_id
   for share;

  if not found then
    begin
      insert into public.timesheets (operation_id, shift_id, work_date, status)
      values (p_operation_id, p_shift_id, p_work_date, 'open')
      returning * into _folha;
      _criada := true;
    exception when unique_violation then
      -- Outra sessão (ou um retry) criou a folha entre a leitura e a escrita: usa a existente.
      select * into _folha from public.timesheets t
       where t.operation_id = p_operation_id and t.work_date = p_work_date
         and t.shift_id is not distinct from p_shift_id;
    end;
  end if;

  if _folha.status = 'closed' then
    raise exception 'A folha está fechada: reabra para gravar.' using errcode = '55000';
  end if;

  for _l in select * from jsonb_array_elements(p_linhas) loop
    _emp := nullif(_l ->> 'employee_id', '')::uuid;
    _status := (_l ->> 'status')::public.attendance_status;
    if _emp is null or _status is null then
      raise exception 'Cada linha exige colaborador e status.' using errcode = '22023';
    end if;

    -- A linha é do colaborador NA FOLHA: um retry com outro id não duplica.
    select e.id into _existe from public.timesheet_entries e
     where e.timesheet_id = _folha.id and e.employee_id = _emp;

    if _existe is null then
      insert into public.timesheet_entries
        (timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes)
      values
        (_folha.id, _emp, p_operation_id, p_work_date, _status,
         nullif(_l ->> 'check_in', '')::time, nullif(_l ->> 'check_out', '')::time,
         coalesce((_l ->> 'break_minutes')::integer, 0), nullif(_l ->> 'notes', ''));
    else
      update public.timesheet_entries e
         set status = _status,
             check_in = nullif(_l ->> 'check_in', '')::time,
             check_out = nullif(_l ->> 'check_out', '')::time,
             break_minutes = coalesce((_l ->> 'break_minutes')::integer, 0),
             notes = nullif(_l ->> 'notes', '')
       where e.id = _existe;
    end if;
    _n := _n + 1;
  end loop;

  return jsonb_build_object('timesheet_id', _folha.id, 'gravadas', _n, 'folha_criada', _criada);
end;
$function$;

drop function public.condicoes_exigir_admin_leitura();
drop function public.mfa_cotidiano_ok();

commit;
