-- REVERSÃO da migration 20261105120000_038_periodo_contratual (FIN-PR-05).
--
-- Devolve as funções ao corpo VIGENTE antes da 038 (gerar_fatura da 037, resumo_financeiro_periodo
-- da 032, estado_motor_vigencia da 036, RPCs de condição do contrato da 030, registrar_adicional da
-- 029) e remove os objetos novos. NÃO toca: 035, 036, 037, autenticação, MFA, guards, RLS,
-- policies, gatilhos.
--
-- REVERTER CÓDIGO, FUNÇÕES E DADOS SÃO COISAS DIFERENTES
--   * código: reverter o deploy do app. O app desta etapa detecta a capacidade
--     (`periodo_contratual`) e volta sozinho ao comportamento de antes num banco sem a 038;
--   * funções: este script;
--   * dados: nada é apagado nem recalculado. Faturas emitidas com a 038 continuam como foram
--     emitidas (são competências inteiras, válidas também antes dela). Remover as colunas novas,
--     porém, apagaria a frequência de um contrato mensal ou a competência de um adicional: por
--     isso a reversão RECUSA se existir versão de contrato com frequência diferente de quinzenal
--     ou adicional com competência de cobrança. Nesse caso, a decisão é de negócio, não de rollback.
--
-- Executar só com autorização, como `postgres`, em uma transação.

begin;

do $pre$
begin
  if exists (select 1 from public.contract_terms where closing_period <> 'quinzenal') then
    raise exception 'Reversão recusada: há versão de contrato com frequência de fechamento diferente de quinzenal.'
      using errcode = '55000';
  end if;
  if exists (select 1 from public.billing_additionals where billing_period_start is not null) then
    raise exception 'Reversão recusada: há adicional com competência de cobrança registrada.'
      using errcode = '55000';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- RPCs com assinatura nova: volta a assinatura anterior (030 e 029), com os mesmos privilégios
-- ---------------------------------------------------------------------------

drop function public.criar_contrato_com_vigencia(uuid, text, date, date, text, numeric, numeric, numeric, integer, text, text, numeric, numeric, text);
drop function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean, text, numeric, numeric, text);
drop function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date);

CREATE OR REPLACE FUNCTION public.registrar_condicao_contrato(p_contract_id uuid, p_valid_from date, p_daily_rate numeric, p_shift_hours numeric, p_ot_factor numeric, p_ot_tolerance_min integer, p_reason text, p_valid_to date DEFAULT NULL::date, p_encerrar_anterior boolean DEFAULT false, p_ot_rounding_mode text DEFAULT 'diario'::text, p_saturday_shift_hours numeric DEFAULT NULL::numeric, p_holiday_pay_factor numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_motivo text;
  v_aberta public.contract_terms%rowtype;
  v_novo   public.contract_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);

  if p_contract_id is null or p_valid_from is null or p_daily_rate is null or p_shift_hours is null
     or p_ot_factor is null or p_ot_tolerance_min is null then
    raise exception 'Contrato, início da vigência e as quatro condições são obrigatórios.' using errcode = '22023';
  end if;
  if p_daily_rate <> round(p_daily_rate, 2) or p_shift_hours <> round(p_shift_hours, 2)
     or p_ot_factor <> round(p_ot_factor, 2) then
    raise exception 'Diária, jornada e fator aceitam no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;
  perform public.condicoes_validar_parametros_de_horas(p_ot_rounding_mode, p_saturday_shift_hours,
    p_holiday_pay_factor, p_shift_hours);
  if not exists (select 1 from public.contracts where id = p_contract_id) then
    raise exception 'Contrato não encontrado.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || p_contract_id::text, 0));

  if coalesce(p_encerrar_anterior, false) then
    select * into v_aberta
      from public.contract_terms
     where contract_id = p_contract_id and active and valid_to is null
     for update;
    if found and v_aberta.valid_from < p_valid_from then
      perform public.condicoes_encerrar_contrato_interno(v_aberta.id, p_valid_from, v_motivo);
    end if;
  end if;

  begin
    insert into public.contract_terms
      (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min,
       ot_rounding_mode, saturday_shift_hours, holiday_pay_factor, origin, reason, created_by)
    values
      (p_contract_id, p_valid_from, p_valid_to, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min,
       p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor, 'informada', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência informada se sobrepõe a outra versão ativa deste contrato.'
      using errcode = '23P01',
            hint = 'Encerre a versão anterior, informe a data final ou use p_encerrar_anterior.';
  end;

  perform public.condicoes_auditar('contrato_condicao_registrada', 'contrato', p_contract_id, v_novo.id,
    null, to_jsonb(v_novo) || jsonb_build_object(
      'retroativa', p_valid_from < (now() at time zone 'America/Sao_Paulo')::date), v_motivo);

  return v_novo.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_contrato_com_vigencia(p_client_id uuid, p_name text, p_valid_from date, p_valid_to date, p_status text, p_daily_rate numeric, p_shift_hours numeric, p_ot_factor numeric, p_ot_tolerance_min integer, p_reason text, p_ot_rounding_mode text DEFAULT 'diario'::text, p_saturday_shift_hours numeric DEFAULT NULL::numeric, p_holiday_pay_factor numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  insert into public.contracts
    (client_id, name, valid_from, valid_to, status, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values
    (p_client_id, p_name, p_valid_from, p_valid_to, p_status::public.record_status,
     p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min)
  returning id into v_id;

  -- Uma exceção daqui desfaz o INSERT acima: é a mesma transação.
  perform public.registrar_condicao_contrato(
    v_id, p_valid_from, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min, p_reason,
    null, false, p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_adicional(p_client_id uuid, p_period_start date, p_period_end date, p_description text, p_amount numeric, p_reference text DEFAULT NULL::text, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_descricao  text := btrim(coalesce(p_description, ''));
  v_referencia text := nullif(btrim(coalesce(p_reference, '')), '');
  v_novo       public.billing_additionals%rowtype;
begin
  perform public.condicoes_exigir_admin();

  if p_client_id is null or p_period_start is null or p_period_end is null or p_amount is null then
    raise exception 'Cliente, período e valor são obrigatórios.' using errcode = '22023';
  end if;
  if v_descricao = '' then
    raise exception 'O motivo do adicional é obrigatório.' using errcode = '22023';
  end if;
  if char_length(v_descricao) > 500 then
    raise exception 'O motivo do adicional deve ter no máximo 500 caracteres.' using errcode = '22023';
  end if;
  if v_referencia is not null and char_length(v_referencia) > 200 then
    raise exception 'A referência deve ter no máximo 200 caracteres.' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Período inválido: início (%) posterior ao fim (%).', p_period_start, p_period_end
      using errcode = '22023';
  end if;
  if p_amount <= 0 then
    raise exception 'O valor do adicional deve ser maior que zero.' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'O valor do adicional aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
  if p_operation_id is not null
     and not exists (select 1 from public.operations where id = p_operation_id and client_id = p_client_id) then
    raise exception 'A operação informada não pertence ao cliente.' using errcode = '22023';
  end if;

  -- A mesma trava de `gerar_fatura`: um registro não corre junto com a fatura do cliente.
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));

  insert into public.billing_additionals
    (client_id, operation_id, period_start, period_end, description, reference, amount, created_by)
  values
    (p_client_id, p_operation_id, p_period_start, p_period_end, v_descricao, v_referencia, p_amount, auth.uid())
  returning * into v_novo;

  perform public.condicoes_auditar('adicional_registrado', 'adicional', v_novo.id, v_novo.id,
    null, to_jsonb(v_novo), v_descricao);

  return v_novo.id;
end;
$function$;

do $privilegios$
declare
  _f record;
begin
  for _f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('registrar_condicao_contrato', 'criar_contrato_com_vigencia', 'registrar_adicional')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    execute format('grant execute on function %s to authenticated', _f.assinatura);
  end loop;
end;
$privilegios$;

comment on function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean, text, numeric, numeric) is
  'Admin AAL2. Registra versao das condicoes do contrato (diaria, jornada, fator, tolerancia, modo de arredondamento, jornada de sabado e fator de feriado), com motivo e trilha.';
comment on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid) is
  'Admin AAL2. Registra adicional de servico do periodo (motivo, valor, referencia, operacao opcional do cliente), separado da diaria, com trilha.';

-- ---------------------------------------------------------------------------
-- Funções com a mesma assinatura: corpo vigente antes da 038 (privilégios preservados)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.corrigir_condicao_contrato(p_term_id uuid, p_valid_from date, p_valid_to date, p_daily_rate numeric, p_shift_hours numeric, p_ot_factor numeric, p_ot_tolerance_min integer, p_reason text, p_ot_rounding_mode text DEFAULT 'diario'::text, p_saturday_shift_hours numeric DEFAULT NULL::numeric, p_holiday_pay_factor numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_motivo text;
  v_ant    public.contract_terms%rowtype;
  v_apos   public.contract_terms%rowtype;
  v_novo   public.contract_terms%rowtype;
  v_contract uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);

  if p_term_id is null or p_valid_from is null or p_daily_rate is null or p_shift_hours is null
     or p_ot_factor is null or p_ot_tolerance_min is null then
    raise exception 'Versão, início da vigência e as quatro condições são obrigatórios.' using errcode = '22023';
  end if;
  if p_daily_rate <> round(p_daily_rate, 2) or p_shift_hours <> round(p_shift_hours, 2)
     or p_ot_factor <> round(p_ot_factor, 2) then
    raise exception 'Diária, jornada e fator aceitam no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;
  perform public.condicoes_validar_parametros_de_horas(p_ot_rounding_mode, p_saturday_shift_hours,
    p_holiday_pay_factor, p_shift_hours);

  select contract_id into v_contract from public.contract_terms where id = p_term_id;
  if not found then
    raise exception 'Versão de condição contratual não encontrada.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || v_contract::text, 0));

  select * into v_ant from public.contract_terms where id = p_term_id for update;
  if not v_ant.active then
    raise exception 'Só uma versão ativa pode ser corrigida.' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.timesheet_entries te
      join public.timesheets t on t.id = te.timesheet_id
     where te.contract_terms_id = p_term_id
       and not (t.work_date >= p_valid_from and (p_valid_to is null or t.work_date < p_valid_to))
  ) then
    raise exception 'Há apontamentos que usam esta versão fora da nova vigência; a correção os deixaria sem cobertura.'
      using errcode = '55000';
  end if;

  update public.contract_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_apos;

  begin
    insert into public.contract_terms
      (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min,
       ot_rounding_mode, saturday_shift_hours, holiday_pay_factor, origin, reason, created_by)
    values
      (v_contract, p_valid_from, p_valid_to, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min,
       p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor, 'correcao', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência corrigida se sobrepõe a outra versão ativa deste contrato.'
      using errcode = '23P01';
  end;

  update public.contract_terms set replaced_by = v_novo.id where id = p_term_id
    returning * into v_apos;

  perform public.condicoes_auditar('contrato_condicao_corrigida', 'contrato', v_contract, v_novo.id,
    to_jsonb(v_ant), to_jsonb(v_novo) || jsonb_build_object('substitui', p_term_id), v_motivo);

  return v_novo.id;
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

  -- FIN-PR-03: os itens saem dos COMPONENTES de cada lançamento (`componentes_do_lancamento`): V2
  -- lê os gravados; legado decompõe pela regra da 030. Nenhum item deriva a hora extra pela diferença
  -- entre totais, e as diárias são discriminadas pela tarifa congelada em cada lançamento.

  -- Diárias por operação e TARIFA congelada. Diária inteira: quantidade × tarifa, exato. Diária
  -- proporcional (saída antecipada): item próprio, com o preço médio só como informação.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    x.operation_id,
    x.operacao || ' — diárias' || case when x.proporcional then ' proporcionais' else '' end
      || ' (tarifa ' || replace(x.taxa::text, '.', ',') || ')',
    count(*),
    case when x.proporcional then round(sum(x.diaria) / count(*), 2) else x.taxa end,
    sum(x.diaria),
    'diarias'
  from (select f.*, f.diaria <> f.taxa as proporcional from (select te.id, o.id as operation_id, o.name as operacao,
                te.daily_rate_snapshot as taxa, te.ot_hour_rate_snapshot as taxa_he,
                coalesce(te.billed_overtime_minutes, te.overtime_minutes) as minutos_he,
                c.diaria, c.extra, c.especial, c.adicional
           from public.timesheet_entries te
           join public.timesheets t on t.id = te.timesheet_id
           join public.operations  o on o.id = t.operation_id
           cross join lateral public.componentes_do_lancamento(
             te.status::text, te.calc_version, te.billed_amount, te.daily_rate_snapshot,
             te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
             te.additional_amount) c
          where te.id = any(_ids)) f) x
  group by x.operation_id, x.operacao, x.taxa, x.proporcional
  having sum(x.diaria) > 0 or not x.proporcional
  order by x.operacao, x.operation_id, x.taxa, x.proporcional;

  -- Horas extras por operação e valor-hora congelado, pelos minutos COBRADOS.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    x.operation_id,
    x.operacao || ' — horas extras (hora ' || replace(x.taxa_he::text, '.', ',') || ')',
    round(sum(x.minutos_he)::numeric / 60, 2),
    case
      when sum(x.minutos_he) > 0 then round(sum(x.extra) / (sum(x.minutos_he)::numeric / 60), 2)
      else 0
    end,
    sum(x.extra),
    'horas_extras'
  from (select te.id, o.id as operation_id, o.name as operacao,
                te.daily_rate_snapshot as taxa, te.ot_hour_rate_snapshot as taxa_he,
                coalesce(te.billed_overtime_minutes, te.overtime_minutes) as minutos_he,
                c.diaria, c.extra, c.especial, c.adicional
           from public.timesheet_entries te
           join public.timesheets t on t.id = te.timesheet_id
           join public.operations  o on o.id = t.operation_id
           cross join lateral public.componentes_do_lancamento(
             te.status::text, te.calc_version, te.billed_amount, te.daily_rate_snapshot,
             te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
             te.additional_amount) c
          where te.id = any(_ids)) x
  group by x.operation_id, x.operacao, x.taxa_he
  having sum(x.extra) > 0
  order by x.operacao, x.operation_id, x.taxa_he;

  -- Horas especiais de domingo/feriado (V2). Até o PR 09 o motor grava zero: nenhum item nasce.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    x.operation_id,
    x.operacao || ' — horas especiais de domingo e feriado (tarifa ' || replace(x.taxa::text, '.', ',') || ')',
    count(*),
    round(sum(x.especial) / count(*), 2),
    sum(x.especial),
    'horas_especiais'
  from (select te.id, o.id as operation_id, o.name as operacao,
                te.daily_rate_snapshot as taxa, te.ot_hour_rate_snapshot as taxa_he,
                coalesce(te.billed_overtime_minutes, te.overtime_minutes) as minutos_he,
                c.diaria, c.extra, c.especial, c.adicional
           from public.timesheet_entries te
           join public.timesheets t on t.id = te.timesheet_id
           join public.operations  o on o.id = t.operation_id
           cross join lateral public.componentes_do_lancamento(
             te.status::text, te.calc_version, te.billed_amount, te.daily_rate_snapshot,
             te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
             te.additional_amount) c
          where te.id = any(_ids)) x
  where x.especial > 0
  group by x.operation_id, x.operacao, x.taxa
  order by x.operacao, x.operation_id, x.taxa;

  -- Adicional DIÁRIO (fora da base da HE). Não confundir com o adicional de serviço por período
  -- (`billing_additionals`, item 'adicional' logo abaixo). Até o PR 08 é sempre zero.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    x.operation_id,
    x.operacao || ' — adicional diário',
    count(*),
    round(sum(x.adicional) / count(*), 2),
    sum(x.adicional),
    'adicional_diario'
  from (select te.id, o.id as operation_id, o.name as operacao,
                te.daily_rate_snapshot as taxa, te.ot_hour_rate_snapshot as taxa_he,
                coalesce(te.billed_overtime_minutes, te.overtime_minutes) as minutos_he,
                c.diaria, c.extra, c.especial, c.adicional
           from public.timesheet_entries te
           join public.timesheets t on t.id = te.timesheet_id
           join public.operations  o on o.id = t.operation_id
           cross join lateral public.componentes_do_lancamento(
             te.status::text, te.calc_version, te.billed_amount, te.daily_rate_snapshot,
             te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount,
             te.additional_amount) c
          where te.id = any(_ids)) x
  where x.adicional > 0
  group by x.operation_id, x.operacao
  order by x.operacao, x.operation_id;

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

  -- FIN-PR-03: Σ itens = total da fatura, exatamente. Um agrupamento novo nunca muda o total.
  if (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = _fatura.id)
     <> _fatura.total_amount then
    raise exception 'Itens da fatura não somam o total (%).', _fatura.total_amount
      using errcode = '23514';
  end if;

  return _fatura;
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
    'regras_definitivas', true,
    -- FIN-PR-02 (036): dia útil e sábado calculados pelo núcleo V2 (035).
    'nucleo_v2', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Objetos novos: saem por último (nenhuma função os usa depois dos corpos acima)
-- ---------------------------------------------------------------------------

drop function public.competencia_de_cobranca(uuid, date);
drop function public.periodo_contratual_conferir(uuid, date, date);
drop function public.validar_periodo_de_cobranca(uuid, date, date);
drop function public.frequencia_de_fechamento(uuid, date);
drop function public.janela_de_cobranca_valida(text, date, date);

drop index public.billing_additionals_cliente_competencia_idx;
alter table public.billing_additionals
  drop constraint billing_additionals_competencia_coerente,
  drop column billing_period_start,
  drop column billing_period_end;
alter table public.contract_terms
  drop constraint contract_terms_frequencia_valida,
  drop column closing_period;

do $pos$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('competencia_de_cobranca', 'periodo_contratual_conferir', 'validar_periodo_de_cobranca',
                              'frequencia_de_fechamento', 'janela_de_cobranca_valida')) then
    raise exception 'Reversão incompleta: funções da 038 ainda existem.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'contract_terms' and column_name = 'closing_period')
                or (table_name = 'billing_additionals' and column_name in ('billing_period_start', 'billing_period_end')))) then
    raise exception 'Reversão incompleta: colunas da 038 ainda existem.';
  end if;
end;
$pos$;

-- Conferir antes de confirmar. Para desfazer o ensaio: rollback.
commit;
