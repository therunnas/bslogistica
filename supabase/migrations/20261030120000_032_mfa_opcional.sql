-- AUTH-01B — MFA opcional (admin e operacional) com AAL2 mantido nas operações críticas.
--
-- LOCAL: não aplicada em nenhum banco remoto. Posterior à 031.
--
-- POLÍTICA
--   O segundo fator passa a ser opcional para os dois papéis. Conta SEM fator verificado trabalha em
--   AAL1; conta COM fator verificado continua exigindo o TOTP (AAL2): opcional não é dispensável.
--   O que muda aqui é só o piso do uso cotidiano. Toda operação classificada como crítica
--   continua exigindo AAL2 de verdade, dentro do banco.
--
-- CLASSIFICAÇÃO (decisão por objeto; na dúvida, ficou o mais forte)
--   A  cotidiano, passa a aceitar "AAL2 OU AAL1 de conta sem fator":
--        tabelas clients, contracts, employees, operations, shifts, timesheets, timesheet_entries,
--        operation_team, profiles (todas as operações, como hoje);
--        LEITURA de invoices, invoice_items, contract_terms, employee_cost_terms, operation_terms,
--        billing_additionals, financial_holidays;
--        RPCs só de leitura: resumo_financeiro_periodo, saldo_de_horas_do_periodo,
--        ajustes_de_arredondamento_acumulado, estado_motor_vigencia, condicao_contrato_na_data,
--        custo_colaborador_na_data, valor_acordado_operacao_na_data;
--        salvar_apontamento_admin (apontamento diário).
--   C  financeiro crítico, CONTINUA exigindo AAL2 (condicoes_exigir_admin() não foi tocada):
--        escrita em invoices/invoice_items; gerar_fatura; registrar/corrigir/encerrar/aposentar
--        condição de contrato, custo de colaborador e valor acordado; adicionais e feriados;
--        regularizar_apontamento_legado; sincronizar_colunas_legadas; alterar_motor_vigencia
--        (ativar e reverter o motor); pendencias/divergencias_implantacao_vigencias;
--        financial_engine_settings, financial_terms_audit.
--   D  identidade e segurança, CONTINUA exigindo AAL2: admin_audit_log, user_operation_access.
--        (A gestão de usuários e papéis roda por Server Action com service_role e exige AAL2 no
--        servidor; não passa por estas policies.)
--   DECISÃO PENDENTE (registrada, mantida estrita): criar contrato, colaborador ou operação já com a
--   vigência inicial (`criar_*_com_vigencia`) chama registrar_*: é alteração financeira (C) e por
--   isso exige AAL2 enquanto não houver decisão diferente.
--
-- COMO (mínimo e auditável)
--   1) mfa_cotidiano_ok(): AAL2, ou AAL1 com mfa_bloqueia_excecao_aal1() = false (sem fator
--      verificado, conta existente, sessão válida). Falha fechada: sem sessão, conta inexistente ou
--      estado desconhecido => false.
--   2) condicoes_exigir_admin_leitura(): o guard das RPCs de leitura (admin + identidade válida +
--      mfa_cotidiano_ok). A condicoes_exigir_admin() original NÃO foi alterada, então toda RPC não
--      listada continua estrita.
--   3) policies das tabelas A: ALTER POLICY da expressão (nomes preservados);
--      invoices/invoice_items: leitura A, escrita estrita; tabelas de vigência: leitura A (a escrita
--      direta nunca teve policy permissiva: só as RPCs, estritas, escrevem).
--
-- ORDEM DE IMPLANTAÇÃO: esta migration só AFROUXA o que foi classificado como A e só para contas SEM
--   fator; C e D não mudam. Por isso pode ir ANTES do aplicativo: o aplicativo antigo continua
--   exigindo o segundo fator do admin na interface, e o banco não abre nada crítico. Ver
--   docs/SEGURANCA.md (plano de implantação) e docs/runbooks/rollback-mfa-opcional.sql.

begin;

-- 1) helper do uso cotidiano -------------------------------------------------------------------
create or replace function public.mfa_cotidiano_ok()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
       auth.uid() is not null
   and exists (select 1 from auth.users u where u.id = auth.uid())
   and (
         (auth.jwt() ->> 'aal') = 'aal2'
      or ((auth.jwt() ->> 'aal') = 'aal1' and public.mfa_bloqueia_excecao_aal1() = false)
       ),
     false);
$$;

revoke all on function public.mfa_cotidiano_ok() from public, anon;
grant execute on function public.mfa_cotidiano_ok() to authenticated;

comment on function public.mfa_cotidiano_ok() is
  'AAL2, ou AAL1 de conta existente SEM fator verificado. Piso do uso cotidiano (AUTH-01B). Falha fechada. Operações críticas NÃO usam esta função: exigem AAL2 de fato.';

-- 2) guard das RPCs de leitura ---------------------------------------------------------------
create or replace function public.condicoes_exigir_admin_leitura()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  if not public.mfa_cotidiano_ok() then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  if not coalesce(public.identidade_atual_utilizavel(), false) then
    raise exception 'Conta ou sessão sem validade.' using errcode = '42501';
  end if;
  if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'Apenas administradores podem consultar condições financeiras.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.condicoes_exigir_admin_leitura() from public, anon, authenticated;

-- 3) policies ---------------------------------------------------------------------------------
-- 3a) tabelas A: mesma policy, nova expressão
alter policy clients_exige_aal2 on public.clients using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy contracts_exige_aal2 on public.contracts using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy employees_exige_aal2 on public.employees using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy operations_exige_aal2 on public.operations using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy shifts_exige_aal2 on public.shifts using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy timesheets_exige_aal2 on public.timesheets using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy timesheet_entries_exige_aal2 on public.timesheet_entries using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy operation_team_exige_aal2 on public.operation_team using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));
alter policy profiles_exige_aal2 on public.profiles using ((select public.mfa_cotidiano_ok())) with check ((select public.mfa_cotidiano_ok()));

-- 3b) invoices e invoice_items: LEITURA cotidiana, ESCRITA estrita (AAL2)
drop policy invoices_exige_aal2 on public.invoices;
create policy invoices_leitura_exige_mfa on public.invoices as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()));
create policy invoices_insert_exige_aal2 on public.invoices as restrictive for insert to authenticated with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
create policy invoices_update_exige_aal2 on public.invoices as restrictive for update to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
create policy invoices_delete_exige_aal2 on public.invoices as restrictive for delete to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
drop policy invoice_items_exige_aal2 on public.invoice_items;
create policy invoice_items_leitura_exige_mfa on public.invoice_items as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()));
create policy invoice_items_insert_exige_aal2 on public.invoice_items as restrictive for insert to authenticated with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
create policy invoice_items_update_exige_aal2 on public.invoice_items as restrictive for update to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)) with check ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));
create policy invoice_items_delete_exige_aal2 on public.invoice_items as restrictive for delete to authenticated using ((( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text));

-- 3c) tabelas de vigência: LEITURA cotidiana (admin + MFA em dia). Escrita direta não tem policy
--     permissiva (negada por padrão); quem escreve são as RPCs, que seguem estritas.
drop policy contract_terms_exige_admin_aal2 on public.contract_terms;
create policy contract_terms_leitura_exige_mfa on public.contract_terms as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy contract_terms_leitura_admin on public.contract_terms using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy employee_cost_terms_exige_admin_aal2 on public.employee_cost_terms;
create policy employee_cost_terms_leitura_exige_mfa on public.employee_cost_terms as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy employee_cost_terms_leitura_admin on public.employee_cost_terms using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy operation_terms_exige_admin_aal2 on public.operation_terms;
create policy operation_terms_leitura_exige_mfa on public.operation_terms as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy operation_terms_leitura_admin on public.operation_terms using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy billing_additionals_exige_admin_aal2 on public.billing_additionals;
create policy billing_additionals_leitura_exige_mfa on public.billing_additionals as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy billing_additionals_leitura_admin on public.billing_additionals using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
drop policy financial_holidays_exige_admin_aal2 on public.financial_holidays;
create policy financial_holidays_leitura_exige_mfa on public.financial_holidays as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));
alter policy financial_holidays_leitura_admin on public.financial_holidays using ((select public.mfa_cotidiano_ok()) and ( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- 4) funções reescritas (geradas do catálogo; só mudou a chamada do guard) ---------------------

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

CREATE OR REPLACE FUNCTION public.condicao_contrato_na_data(p_contract_id uuid, p_work_date date)
 RETURNS SETOF contract_terms
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  perform public.condicoes_exigir_admin_leitura();
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
  perform public.condicoes_exigir_admin_leitura();
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
  perform public.condicoes_exigir_admin_leitura();
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
  perform public.condicoes_exigir_admin_leitura();
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
  perform public.condicoes_exigir_admin_leitura();
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
  perform public.condicoes_exigir_admin_leitura();
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
  -- Invoker: a RLS exige admin com MFA em dia (AAL2, ou AAL1 de conta SEM fator); a entrada recusa cedo e com mensagem clara.
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  if not public.mfa_cotidiano_ok() then
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

-- 5) permissões inalteradas: CREATE OR REPLACE preserva dono, ACL e comentários das funções acima.

commit;
