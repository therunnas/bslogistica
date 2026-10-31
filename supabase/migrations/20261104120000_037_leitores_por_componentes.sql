-- Leitores financeiros pelos componentes do valor cobrado (FIN-PR-03). SOMENTE LOCAL até autorização.
--
-- Depende da 036 (colunas billed_base_amount, billed_overtime_amount, billed_special_amount,
-- additional_amount e calc_version). A 035, a 036 e esta são aplicadas juntas, numa etapa
-- controlada, com autorização própria.
--
-- O QUE MUDA
--   1. `componentes_do_lancamento(...)`: fonte única, em SQL, dos componentes de UM lançamento.
--      calc_version = 2 -> os gravados, sem derivar nada; componente ausente, negativo, especial junto
--      de diária/HE ou soma diferente do cobrado = ERRO (23514). calc_version nulo -> a regra da 030
--      (extra = GREATEST(cobrado − diária, 0); diária = cobrado − extra; sem especial; adicional
--      diferente de zero no legado = ERRO). Falta = zero. Espelho de `src/lib/componentes-financeiros.ts`.
--   2. `gerar_fatura` (corpo vigente da 034): os itens saem dos componentes; diárias discriminadas
--      por operação e TARIFA congelada (inteiras: quantidade × tarifa; proporcionais: item próprio);
--      HE por operação e valor-hora congelado; itens novos `horas_especiais` e `adicional_diario`
--      (só nascem com valor > 0: hoje nunca); conferência final Σ itens = total. Os TOTAIS da fatura
--      (lançamentos, horas, total, custo) são calculados como antes.
--   3. `ajustes_de_arredondamento_acumulado` (corpo vigente da 032): o valor bruto da HE é o
--      componente, não a diferença.
--   4. `invoice_items_tipo_valido`: aceita os dois tipos novos.
--
-- O QUE NÃO MUDA
--   Guards (MFA opcional `mfa_cotidiano_ok`, papel admin, identidade utilizável), RLS, grants, a
--   trava por cliente, a elegibilidade dos adicionais de serviço por período, a validação e o ajuste
--   do acumulado, a imutabilidade do faturado e da folha fechada, `resumo_financeiro_periodo` (já soma
--   o cobrado, sem inferir HE). Nenhum dado é alterado; faturas emitidas continuam como estão.
--
-- REVERSÃO: docs/runbooks/rollback-leitores-por-componentes.sql (recria gerar_fatura da 034 e o
-- ajuste da 032, devolve o CHECK de tipos — recusa se existir item dos tipos novos — e remove o helper).

begin;

-- ---------------------------------------------------------------------------
-- 1. Componentes de um lançamento
-- ---------------------------------------------------------------------------

create function public.componentes_do_lancamento(
  p_status      text,
  p_calc_version smallint,
  p_cobrado     numeric,
  p_diaria      numeric,
  p_base        numeric,
  p_extra       numeric,
  p_especial    numeric,
  p_adicional   numeric,
  out diaria    numeric,
  out extra     numeric,
  out especial  numeric,
  out adicional numeric
)
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_status = 'absent' then
    diaria := 0; extra := 0; especial := 0; adicional := 0;
    return;
  end if;

  if p_calc_version = 2 then
    if p_base is null or p_extra is null or p_especial is null or p_adicional is null
       or p_base < 0 or p_extra < 0 or p_especial < 0 or p_adicional < 0 then
      raise exception 'componentes: lançamento V2 com componente ausente ou negativo.' using errcode = '23514';
    end if;
    if p_base + p_extra + p_especial + p_adicional <> p_cobrado then
      raise exception 'componentes: lançamento V2 cujos componentes (% + % + % + %) não somam o cobrado (%).',
        p_base, p_extra, p_especial, p_adicional, p_cobrado using errcode = '23514';
    end if;
    if p_especial > 0 and (p_base > 0 or p_extra > 0) then
      raise exception 'componentes: horas especiais junto de diária ou hora extra.' using errcode = '23514';
    end if;
    diaria := p_base; extra := p_extra; especial := p_especial; adicional := p_adicional;
    return;
  end if;

  if p_calc_version is not null then
    raise exception 'componentes: versão de cálculo desconhecida (%).', p_calc_version using errcode = '23514';
  end if;
  if coalesce(p_adicional, 0) <> 0 then
    raise exception 'componentes: lançamento legado com adicional diário.' using errcode = '23514';
  end if;
  extra := greatest(p_cobrado - p_diaria, 0);
  diaria := p_cobrado - extra;
  especial := 0;
  adicional := 0;
end;
$$;

revoke all on function public.componentes_do_lancamento(text, smallint, numeric, numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated, service_role;

comment on function public.componentes_do_lancamento(text, smallint, numeric, numeric, numeric, numeric, numeric, numeric) is
  'FIN-PR-03: componentes cobrados de um lançamento. V2 = gravados e conferidos; legado = regra da 030. Espelho de componentes-financeiros.ts.';

-- ---------------------------------------------------------------------------
-- 2. Tipos de item da fatura
-- ---------------------------------------------------------------------------

alter table public.invoice_items
  drop constraint invoice_items_tipo_valido,
  add constraint invoice_items_tipo_valido
    check (kind is null or kind in ('diarias', 'horas_extras', 'arredondamento', 'adicional',
                                    'horas_especiais', 'adicional_diario'));

comment on column public.invoice_items.kind is
  'Tipo do item: diarias, horas_extras, arredondamento (acumulado), adicional (serviço por período), horas_especiais (domingo/feriado V2) ou adicional_diario. NULL = fatura anterior a 030.';

-- ---------------------------------------------------------------------------
-- 3. gerar_fatura (corpo vigente: 034) com itens pelos componentes
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


-- ---------------------------------------------------------------------------
-- 4. Ajuste do acumulado (corpo vigente: 032): valor bruto = componente de HE
-- ---------------------------------------------------------------------------

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
           c.extra as valor
      from public.timesheet_entries te
      cross join lateral public.componentes_do_lancamento(
        te.status::text, te.calc_version, te.billed_amount, te.daily_rate_snapshot,
        te.billed_base_amount, te.billed_overtime_amount, te.billed_special_amount, te.additional_amount) c
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


commit;
