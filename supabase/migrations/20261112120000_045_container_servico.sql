-- FIN-PR-11B: execução avulsa, receita única e obrigação de custo por participante.
-- Apenas schema versionado; não autoriza aplicação em HML/Production.
begin;

create table public.container_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  operation_id uuid references public.operations(id),
  requested_on date not null,
  executed_on date not null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity bigint not null check (quantity between 1 and 9007199254740991),
  revenue_cents bigint not null check (revenue_cents between 1 and 999999999999),
  cost_total_cents bigint not null check (cost_total_cents between 0 and 999999999999),
  reference text check (reference is null or char_length(btrim(reference)) between 1 and 200),
  cost_mode text not null check (cost_mode in ('por_pessoa', 'total_distribuido')),
  billing_additional_id uuid not null unique references public.billing_additionals(id),
  idempotency_key uuid not null,
  request_payload jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  canceled_at timestamptz,
  canceled_by uuid,
  cancel_reason text,
  unique (client_id, idempotency_key),
  check (requested_on < executed_on),
  check ((canceled_at is null and canceled_by is null and cancel_reason is null)
    or (canceled_at is not null and canceled_by is not null
        and char_length(btrim(cancel_reason)) between 1 and 1000))
);

create table public.container_service_participants (
  service_id uuid not null references public.container_services(id),
  employee_id uuid not null references public.employees(id),
  cost_cents bigint not null check (cost_cents between 0 and 999999999999),
  primary key (service_id, employee_id)
);

-- Identidade do ator fica sem FK: remover uma conta não apaga nem reescreve a trilha.
create table public.container_service_audit (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null,
  action text not null check (action in ('registered', 'canceled')),
  actor_id uuid not null,
  actor_session_id text,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index container_services_client_execution_idx on public.container_services(client_id, executed_on);
create index container_service_participants_employee_idx on public.container_service_participants(employee_id);
create index container_service_audit_service_idx on public.container_service_audit(service_id, created_at);

comment on table public.container_services is
  'Serviço avulso de containers; receita cobrada uma única vez por billing_additionals. Custo devido não significa pagamento realizado.';

do $$
declare v_table text;
begin
  foreach v_table in array array['container_services', 'container_service_participants', 'container_service_audit'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.mfa_cotidiano_ok()) and (select public.has_role(auth.uid(), ''admin''::public.app_role)))', v_table || '_read_admin', v_table);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_cotidiano_ok()) and (select public.has_role(auth.uid(), ''admin''::public.app_role))) with check ((select public.mfa_cotidiano_ok()) and (select public.has_role(auth.uid(), ''admin''::public.app_role)))', v_table || '_require_admin', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role, bslog_rpc_operacional', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
  end loop;
end;
$$;

create function public.normalizar_payload_container(p_dados jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_item jsonb;
  v_comp jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_client uuid;
  v_operation uuid;
  v_requested date;
  v_executed date;
  v_start date;
  v_end date;
  v_number numeric;
  v_total numeric := 0;
  v_participants jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_dados) is distinct from 'object'
     or not (p_dados ?& array['clienteId','operacaoId','solicitadoEm','executadoEm','descricao',
       'quantidade','receitaCentavos','custoTotalCentavos','referencia','participantes',
       'modalidadeCusto','competenciaCobranca'])
     or exists (select 1 from jsonb_object_keys(p_dados) k where k <> all(array[
       'clienteId','operacaoId','solicitadoEm','executadoEm','descricao','quantidade',
       'receitaCentavos','custoTotalCentavos','referencia','participantes','modalidadeCusto','competenciaCobranca'])) then
    raise exception 'Payload de container incompleto ou com campos desconhecidos.' using errcode = '22023';
  end if;
  foreach v_key in array array['clienteId','solicitadoEm','executadoEm','descricao','modalidadeCusto'] loop
    if jsonb_typeof(p_dados -> v_key) is distinct from 'string' then
      raise exception 'Campo textual inválido: %.', v_key using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array array['operacaoId','referencia'] loop
    if jsonb_typeof(p_dados -> v_key) not in ('string', 'null') then
      raise exception 'Campo opcional inválido: %.', v_key using errcode = '22023';
    end if;
  end loop;
  v_client := (p_dados ->> 'clienteId')::uuid;
  v_operation := (p_dados ->> 'operacaoId')::uuid;
  if (p_dados ->> 'solicitadoEm') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (p_dados ->> 'executadoEm') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Informe datas civis ISO válidas.' using errcode = '22023';
  end if;
  v_requested := (p_dados ->> 'solicitadoEm')::date;
  v_executed := (p_dados ->> 'executadoEm')::date;
  if v_requested >= v_executed then
    raise exception 'O serviço precisa ser solicitado até o dia anterior à execução.' using errcode = '22023';
  end if;
  if char_length(btrim(p_dados ->> 'descricao')) not between 1 and 500
     or char_length(btrim(coalesce(p_dados ->> 'referencia', ''))) > 200
     or (p_dados ->> 'modalidadeCusto') not in ('por_pessoa', 'total_distribuido') then
    raise exception 'Descrição, referência ou modalidade de custo inválida.' using errcode = '22023';
  end if;
  foreach v_key in array array['quantidade','receitaCentavos','custoTotalCentavos'] loop
    if jsonb_typeof(p_dados -> v_key) is distinct from 'number' then
      raise exception 'Valor inteiro obrigatório: %.', v_key using errcode = '22023';
    end if;
    v_number := (p_dados ->> v_key)::numeric;
    if v_number <> trunc(v_number) or v_number < (case when v_key = 'custoTotalCentavos' then 0 else 1 end)
       or v_number > (case when v_key = 'quantidade' then 9007199254740991 else 999999999999 end) then
      raise exception 'Valor inteiro fora do limite: %.', v_key using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_dados -> 'participantes') is distinct from 'array'
     or jsonb_array_length(p_dados -> 'participantes') = 0 then
    raise exception 'Informe os participantes do serviço.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_dados -> 'participantes') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or not (v_item ?& array['colaboradorId','custoCentavos'])
       or exists (select 1 from jsonb_object_keys(v_item) k where k <> all(array['colaboradorId','custoCentavos']))
       or jsonb_typeof(v_item -> 'colaboradorId') is distinct from 'string'
       or jsonb_typeof(v_item -> 'custoCentavos') is distinct from 'number' then
      raise exception 'Participante inválido ou com campos desconhecidos.' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'colaboradorId')::uuid;
    v_number := (v_item ->> 'custoCentavos')::numeric;
    if v_number <> trunc(v_number) or v_number < 0 or v_number > 999999999999 or v_id = any(v_ids) then
      raise exception 'Custo inválido ou participante duplicado.' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_total := v_total + v_number;
    v_participants := v_participants || jsonb_build_array(jsonb_build_object('colaboradorId', v_id, 'custoCentavos', v_number::bigint));
  end loop;
  if v_total > 999999999999 or v_total <> (p_dados ->> 'custoTotalCentavos')::numeric then
    raise exception 'A soma dos participantes deve igualar o custo total informado.' using errcode = '22023';
  end if;
  if p_dados -> 'competenciaCobranca' <> 'null'::jsonb then
    v_comp := p_dados -> 'competenciaCobranca';
    if jsonb_typeof(v_comp) is distinct from 'object'
       or not (v_comp ?& array['inicio','fim'])
       or exists (select 1 from jsonb_object_keys(v_comp) k where k <> all(array['inicio','fim']))
       or jsonb_typeof(v_comp -> 'inicio') is distinct from 'string'
       or jsonb_typeof(v_comp -> 'fim') is distinct from 'string'
       or (v_comp ->> 'inicio') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_comp ->> 'fim') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Competência de cobrança inválida.' using errcode = '22023';
    end if;
    v_start := (v_comp ->> 'inicio')::date;
    v_end := (v_comp ->> 'fim')::date;
    if v_start > v_end then
      raise exception 'Competência de cobrança invertida.' using errcode = '22023';
    end if;
    v_comp := jsonb_build_object('inicio', v_start, 'fim', v_end);
  end if;
  select jsonb_agg(value order by value ->> 'colaboradorId') into v_participants from jsonb_array_elements(v_participants);
  return jsonb_build_object('clienteId', v_client, 'operacaoId', v_operation,
    'solicitadoEm', v_requested, 'executadoEm', v_executed,
    'descricao', btrim(p_dados ->> 'descricao'), 'quantidade', (p_dados ->> 'quantidade')::bigint,
    'receitaCentavos', (p_dados ->> 'receitaCentavos')::bigint, 'custoTotalCentavos', v_total::bigint,
    'referencia', nullif(btrim(p_dados ->> 'referencia'), ''), 'participantes', v_participants,
    'modalidadeCusto', p_dados ->> 'modalidadeCusto', 'competenciaCobranca', v_comp);
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    raise exception 'Identificador, data ou valor de container inválido.' using errcode = '22023';
end;
$$;

create function public.proteger_servico_container()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'O lastro de container não é apagado.' using errcode = '42501';
  end if;
  if tg_table_name <> 'container_services' then
    raise exception 'Participantes e auditoria de container são imutáveis.' using errcode = '42501';
  end if;
  if old.canceled_at is not null or exists (
    select 1 from public.billing_additionals where id = old.billing_additional_id and invoice_id is not null
  ) then
    raise exception 'Serviço cancelado ou faturado é imutável.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['canceled_at','canceled_by','cancel_reason'])
     is distinct from (to_jsonb(old) - array['canceled_at','canceled_by','cancel_reason'])
     or new.canceled_at is null or new.canceled_by is distinct from auth.uid()
     or nullif(btrim(new.cancel_reason), '') is null then
    raise exception 'Serviço de container só admite cancelamento com motivo.' using errcode = '42501';
  end if;
  perform public.condicoes_exigir_admin();
  return new;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['container_services', 'container_service_participants', 'container_service_audit'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.proteger_servico_container()', v_table || '_immutable', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.proteger_servico_container()', v_table || '_no_truncate', v_table);
  end loop;
end;
$$;

-- cancelar_adicional continua com a mesma assinatura/ACL. Um adicional de container
-- só cancela quando a entidade de execução já registra a mesma transição na transação.
-- Não usa GUC: o chamador não consegue forjar a autorização com set_config.
create function public.proteger_cancelamento_adicional_container()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.canceled_at is distinct from old.canceled_at
     and exists (select 1 from public.container_services where billing_additional_id = old.id)
     and not exists (select 1 from public.container_services where billing_additional_id = old.id
       and canceled_at is not null and canceled_at = new.canceled_at
       and canceled_by is not distinct from new.canceled_by
       and cancel_reason is not distinct from new.cancel_reason) then
    raise exception 'Cancele o serviço de container pela RPC própria.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger billing_additionals_container_cancel_guard before update on public.billing_additionals
  for each row execute function public.proteger_cancelamento_adicional_container();

create function public.registrar_servico_container(p_dados jsonb, p_idempotency_key uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payload jsonb;
  v_reason text;
  v_client uuid;
  v_existing public.container_services%rowtype;
  v_new public.container_services%rowtype;
  v_additional uuid;
begin
  perform public.condicoes_exigir_admin();
  v_reason := public.condicoes_validar_motivo(p_reason);
  if p_idempotency_key is null then
    raise exception 'A chave de idempotência é obrigatória.' using errcode = '22023';
  end if;
  v_payload := public.normalizar_payload_container(p_dados);
  v_client := (v_payload ->> 'clienteId')::uuid;
  -- Mesma trava de registrar_adicional/cancelar_adicional/gerar_fatura.
  perform pg_advisory_xact_lock(hashtextextended(v_client::text, 0));
  select * into v_existing from public.container_services
    where client_id = v_client and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload is distinct from v_payload then
      raise exception 'Chave de idempotência já usada com outro payload.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  if exists (select 1 from jsonb_array_elements(v_payload -> 'participantes') p
    where not exists (select 1 from public.employees e where e.id = (p ->> 'colaboradorId')::uuid)) then
    raise exception 'Colaborador participante não encontrado.' using errcode = 'P0002';
  end if;
  v_additional := public.registrar_adicional(v_client, (v_payload ->> 'executadoEm')::date,
    (v_payload ->> 'executadoEm')::date, v_payload ->> 'descricao',
    (v_payload ->> 'receitaCentavos')::numeric / 100, v_payload ->> 'referencia',
    (v_payload ->> 'operacaoId')::uuid, (v_payload #>> '{competenciaCobranca,inicio}')::date,
    (v_payload #>> '{competenciaCobranca,fim}')::date);
  insert into public.container_services(client_id,operation_id,requested_on,executed_on,description,
    quantity,revenue_cents,cost_total_cents,reference,cost_mode,billing_additional_id,idempotency_key,
    request_payload,created_by)
  values (v_client,(v_payload ->> 'operacaoId')::uuid,(v_payload ->> 'solicitadoEm')::date,
    (v_payload ->> 'executadoEm')::date,v_payload ->> 'descricao',(v_payload ->> 'quantidade')::bigint,
    (v_payload ->> 'receitaCentavos')::bigint,(v_payload ->> 'custoTotalCentavos')::bigint,
    v_payload ->> 'referencia',v_payload ->> 'modalidadeCusto',v_additional,p_idempotency_key,v_payload,auth.uid())
  returning * into v_new;
  insert into public.container_service_participants(service_id,employee_id,cost_cents)
    select v_new.id,(p ->> 'colaboradorId')::uuid,(p ->> 'custoCentavos')::bigint
    from jsonb_array_elements(v_payload -> 'participantes') p;
  insert into public.container_service_audit(service_id,action,actor_id,actor_session_id,reason,after_data)
    values(v_new.id,'registered',auth.uid(),auth.jwt() ->> 'session_id',v_reason,to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function public.cancelar_servico_container(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client uuid;
  v_reason text;
  v_before public.container_services%rowtype;
  v_after public.container_services%rowtype;
  v_additional public.billing_additionals%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_reason := public.condicoes_validar_motivo(p_reason);
  if p_id is null then
    raise exception 'O serviço é obrigatório.' using errcode = '22023';
  end if;
  select client_id into v_client from public.container_services where id = p_id;
  if not found then
    raise exception 'Serviço de container não encontrado.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_client::text, 0));
  select * into v_before from public.container_services where id = p_id for update;
  select * into v_additional from public.billing_additionals where id = v_before.billing_additional_id for update;
  if v_before.canceled_at is not null or v_additional.canceled_at is not null or v_additional.invoice_id is not null then
    raise exception 'Serviço cancelado ou faturado não pode ser cancelado.' using errcode = '55000';
  end if;
  update public.container_services set canceled_at = now(),canceled_by = auth.uid(),cancel_reason = v_reason
    where id = p_id returning * into v_after;
  perform public.cancelar_adicional(v_before.billing_additional_id, v_reason);
  insert into public.container_service_audit(service_id,action,actor_id,actor_session_id,reason,before_data,after_data)
    values(p_id,'canceled',auth.uid(),auth.jwt() ->> 'session_id',v_reason,to_jsonb(v_before),to_jsonb(v_after));
end;
$$;

revoke all on function public.normalizar_payload_container(jsonb), public.proteger_servico_container(),
  public.proteger_cancelamento_adicional_container(), public.registrar_servico_container(jsonb,uuid,text),
  public.cancelar_servico_container(uuid,text) from public,anon,authenticated,service_role,bslog_rpc_operacional;
grant execute on function public.registrar_servico_container(jsonb,uuid,text),
  public.cancelar_servico_container(uuid,text) to authenticated;

-- O corpo de gerar_fatura038 segue abaixo com delta único de custo avulso.

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
      -- FIN-PR-11B: custo avulso congelado dos MESMOS adicionais selecionados para cobrança.
      + (select coalesce(sum(cs.cost_total_cents), 0)::numeric / 100
           from public.container_services cs where cs.billing_additional_id = any(_adicionais))
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

commit;
