-- FIN-PR-11B. SOMENTE ambiente local descartável. Nunca usar CASCADE.
-- Origem: schema 045 desta branch. Destino: 044, preservando o catálogo anterior.
-- Não usar após migrations posteriores sem nova análise das dependências.
-- Recusa uso, cancelamento ou auditoria: nenhum lastro avulso pode ser descartado.
-- Exige janela sem registros, cancelamentos ou faturamentos concorrentes.
-- As travas precedem a leitura e permanecem até COMMIT: operação em andamento
-- faz a reversão falhar imediatamente com 55P03; não aguardar nem apagar dados.
begin;
lock table public.container_services, public.container_service_participants,
  public.container_service_audit in access exclusive mode nowait;
do $$
begin
  if exists(select 1 from public.container_services)
     or exists(select 1 from public.container_service_participants)
     or exists(select 1 from public.container_service_audit) then
    raise exception 'Reversão recusada: há serviços, participantes ou auditoria de containers. Preserve o histórico.' using errcode = '55000';
  end if;
end;
$$;

-- Restaura exatamente o corpo vigente da 038; assinaturas e ACL existentes são preservadas.
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

  -- FIN-PR-05: só uma competência inteira da frequência do cliente (quinzena ou mês), lida depois
  -- da trava: uma mudança de frequência do mesmo cliente não corre junto.
  perform public.validar_periodo_de_cobranca(_client_id, _period_start, _period_end);

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

  -- Adicionais pela competência de cobrança; sem competência (anteriores à 038), pela execução
  -- inteira dentro do período, como antes.
  select coalesce(array_agg(x.id), '{}'::uuid[])
    into _adicionais
  from (
    select a.id
    from public.billing_additionals a
    where a.client_id    = _client_id
      and case when a.billing_period_start is not null
               then a.billing_period_start >= _period_start and a.billing_period_end <= _period_end
               else a.period_start >= _period_start and a.period_end <= _period_end end
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

drop trigger billing_additionals_container_cancel_guard on public.billing_additionals;
drop function public.cancelar_servico_container(uuid,text);
drop function public.registrar_servico_container(jsonb,uuid,text);
drop function public.normalizar_payload_container(jsonb);
drop function public.proteger_cancelamento_adicional_container();
drop table public.container_service_audit;
drop table public.container_service_participants;
drop table public.container_services;
drop function public.proteger_servico_container();
commit;
