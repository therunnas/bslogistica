-- Período contratual e janela de cobrança (FIN-PR-05). SOMENTE LOCAL até autorização.
--
-- Depende da 037 (gerar_fatura itemizado pelos componentes). A 035, a 036, a 037 e esta são
-- aplicadas juntas, numa etapa controlada, com autorização própria.
--
-- REGRA DE NEGÓCIO
--   * A frequência de fechamento é do CONTRATO, nunca do nome do cliente: `contract_terms.closing_period`
--     ('quinzenal' | 'mensal'), versionada com as demais condições. Padrão: quinzenal.
--   * Período contratual = competência de fechamento e faturamento:
--       quinzenal  01–15 e 16–último dia do mês;
--       mensal     01–último dia do mês.
--     A competência nunca atravessa o mês. Fevereiro (28/29), meses de 30/31 e a virada de ano saem do
--     calendário do próprio banco.
--   * Frequência por CLIENTE e MÊS (nesta fase, um contrato por cliente): a das versões ativas dos
--     contratos do cliente que tocam o mês. Nenhuma versão no mês (cliente ou operação sem contrato)
--     = quinzenal. Duas frequências no mesmo mês = configuração mista, recusada na escrita e,
--     por defesa, na leitura (55000). Por isso a frequência só muda a partir do dia 1 de um mês.
--   * Competência faturada é história: a frequência não muda sobre mês que já tem fatura do
--     cliente, nem deixa adicional a faturar com competência incompatível.
--   * `gerar_fatura` só aceita uma competência inteira da frequência do cliente.
--   * Adicional de serviço por período ganha a competência de COBRANÇA (`billing_period_start/end`),
--     separada do período de EXECUÇÃO (`period_start/end`). Pode ser cobrado antes da execução, e a
--     execução pode cair fora da competência (executado em novembro, cobrado na 2ª quinzena de outubro).
--     Adicional antigo (sem competência) mantém a regra de antes: execução inteira dentro da fatura.
--     Nada histórico é reinterpretado.
--
-- O QUE MUDA
--   1. `contract_terms.closing_period` (default 'quinzenal'; nenhuma linha reescrita).
--   2. `billing_additionals.billing_period_start/end` (nulos nos existentes) + CHECK de coerência.
--   3. Funções internas: `janela_de_cobranca_valida` (pura), `frequencia_de_fechamento`,
--      `validar_periodo_de_cobranca` e `periodo_contratual_conferir` (escrita da condição).
--   4. RPC de leitura `competencia_de_cobranca(cliente, data)` para as telas.
--   5. `registrar_condicao_contrato` e `criar_contrato_com_vigencia` ganham `p_closing_period`
--      (default NULL = herda a versão anterior do contrato, ou quinzenal); `corrigir_condicao_contrato`
--      preserva a frequência da versão corrigida. As três conferem a regra acima.
--   6. `registrar_adicional` ganha `p_billing_period_start/end` (default NULL = regra antiga).
--   7. `gerar_fatura` (corpo da 037): valida a competência e escolhe os adicionais pela competência.
--   8. `resumo_financeiro_periodo` (corpo da 032): adicionais pela competência; ajuste previsto pelas
--      competências da frequência de cada cliente.
--   9. `estado_motor_vigencia` anuncia `periodo_contratual` (detecção de capacidade do app).
--
-- O QUE NÃO MUDA
--   Guards (`mfa_cotidiano_ok`, `has_role`, `condicoes_exigir_admin`), RLS, policies, a trava por
--   cliente (advisory lock), FOR UPDATE, `validar_fechamento_acumulado`, a itemização da 037 e a
--   conferência Σ itens = total, a imutabilidade do faturado. Nenhuma fatura, item, lançamento ou
--   adicional existente é alterado.
--
-- REVERSÃO: docs/runbooks/rollback-periodo-contratual.sql (recusa se houver versão mensal ou
-- adicional com competência: remover as colunas apagaria dado financeiro).

begin;

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

alter table public.contract_terms
  add column closing_period text not null default 'quinzenal',
  add constraint contract_terms_frequencia_valida check (closing_period in ('quinzenal', 'mensal'));

comment on column public.contract_terms.closing_period is
  'FIN-PR-05: frequencia de fechamento e faturamento (quinzenal: 01-15 e 16-ultimo; mensal: 01-ultimo). Versionada; muda so a partir do dia 1 de um mes sem fatura.';

alter table public.billing_additionals
  add column billing_period_start date,
  add column billing_period_end   date,
  add constraint billing_additionals_competencia_coerente check (
    (billing_period_start is null and billing_period_end is null)
    or (billing_period_start is not null and billing_period_end is not null
        and billing_period_end >= billing_period_start
        and date_trunc('month', billing_period_start) = date_trunc('month', billing_period_end)));

create index billing_additionals_cliente_competencia_idx
  on public.billing_additionals (client_id, billing_period_start, billing_period_end)
  where billing_period_start is not null;

comment on column public.billing_additionals.billing_period_start is
  'FIN-PR-05: inicio da competencia de COBRANCA (uma janela da frequencia do cliente). NULL = adicional anterior a 038: cobrado quando o periodo de execucao cabe inteiro na fatura.';
comment on column public.billing_additionals.billing_period_end is
  'FIN-PR-05: fim da competencia de COBRANCA. Independente do periodo de execucao (period_start/end).';

-- ---------------------------------------------------------------------------
-- 2. Calendário da competência
-- ---------------------------------------------------------------------------

-- Pura: a janela é UMA competência inteira da frequência? Espelho de `src/lib/periodo-contratual.ts`.
create function public.janela_de_cobranca_valida(p_frequencia text, p_inicio date, p_fim date)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
       p_inicio <= p_fim
   and date_trunc('month', p_inicio) = date_trunc('month', p_fim)
   and case p_frequencia
         when 'quinzenal' then
              (extract(day from p_inicio) = 1 and extract(day from p_fim) = 15)
           or (extract(day from p_inicio) = 16
               and p_fim = (date_trunc('month', p_inicio) + interval '1 month - 1 day')::date)
         when 'mensal' then
               extract(day from p_inicio) = 1
           and p_fim = (date_trunc('month', p_inicio) + interval '1 month - 1 day')::date
         else false
       end,
     false);
$$;

-- Frequência do cliente no mês de `p_data`. Interna: só as funções SECURITY DEFINER abaixo a chamam.
create function public.frequencia_de_fechamento(p_client_id uuid, p_data date)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _ini date := date_trunc('month', p_data)::date;
  _prox date := (date_trunc('month', p_data) + interval '1 month')::date;
  _f text[];
begin
  if p_client_id is null or p_data is null then
    raise exception 'Cliente e data são obrigatórios.' using errcode = '22023';
  end if;

  select array_agg(distinct ct.closing_period order by ct.closing_period) into _f
    from public.contract_terms ct
    join public.contracts c on c.id = ct.contract_id
   where c.client_id = p_client_id
     and ct.active
     and ct.valid_from < _prox
     and (ct.valid_to is null or ct.valid_to > _ini);

  if _f is null then
    return 'quinzenal';
  end if;
  if array_length(_f, 1) > 1 then
    raise exception 'O cliente tem frequências de fechamento diferentes (%) em %/%.',
      array_to_string(_f, ' e '), lpad(extract(month from _ini)::text, 2, '0'), extract(year from _ini)
      using errcode = '55000',
            hint = 'A frequência é do contrato e vale para o mês inteiro: ajuste as condições do contrato.';
  end if;
  return _f[1];
end;
$$;

-- Recusa (22023) período que não é uma competência inteira do cliente. Devolve a frequência.
create function public.validar_periodo_de_cobranca(p_client_id uuid, p_inicio date, p_fim date)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _freq text;
begin
  if p_inicio is null or p_fim is null or p_inicio > p_fim then
    raise exception 'Período de cobrança inválido.' using errcode = '22023';
  end if;
  if date_trunc('month', p_inicio) <> date_trunc('month', p_fim) then
    raise exception 'O período % a % atravessa o mês: a competência de cobrança fica dentro de um único mês.',
      to_char(p_inicio, 'DD/MM/YYYY'), to_char(p_fim, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  _freq := public.frequencia_de_fechamento(p_client_id, p_inicio);
  if not public.janela_de_cobranca_valida(_freq, p_inicio, p_fim) then
    raise exception 'O período % a % não é uma competência % do cliente.',
      to_char(p_inicio, 'DD/MM/YYYY'), to_char(p_fim, 'DD/MM/YYYY'), _freq
      using errcode = '22023',
            hint = case _freq when 'mensal' then 'Contrato mensal: use do dia 1 ao último dia do mês.'
                              else 'Contrato quinzenal: use 1 a 15 ou 16 ao último dia do mês.' end;
  end if;
  return _freq;
end;
$$;

-- Conferência de uma versão recém-gravada de condição de contrato. Interna.
--   * misto: nenhuma outra versão ativa do cliente com frequência diferente no mesmo mês;
--   * mudança (a frequência difere da versão anterior do cliente, ou do padrão quinzenal) em
--     [p_desde, p_ate): recusa se já houver fatura do cliente nesses meses ou adicional a faturar com
--     competência incompatível. p_desde nulo = sem mudança a conferir (correção sem novos meses).
-- Toma a trava do cliente (a mesma de gerar_fatura e registrar_adicional): frequência, adicional e
-- fatura do mesmo cliente não correm juntos.
create function public.periodo_contratual_conferir(p_term_id uuid, p_desde date, p_ate date)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v       public.contract_terms%rowtype;
  _cli    uuid;
  _ini    date;
  _fim    date;
  _ant    text;
  _outra  text;
begin
  select * into v from public.contract_terms where id = p_term_id;
  select client_id into _cli from public.contracts where id = v.contract_id;
  perform pg_advisory_xact_lock(hashtextextended(_cli::text, 0));

  -- Meses tocados pela versão: [_ini, _fim), _fim nulo = em aberto.
  _ini := date_trunc('month', v.valid_from)::date;
  _fim := case when v.valid_to is null then null
               else (date_trunc('month', v.valid_to - 1) + interval '1 month')::date end;

  select string_agg(distinct ct.closing_period, ', ') into _outra
    from public.contract_terms ct
    join public.contracts c on c.id = ct.contract_id
   where c.client_id = _cli
     and ct.active
     and ct.id <> v.id
     and ct.closing_period <> v.closing_period
     and date_trunc('month', ct.valid_from) < coalesce(_fim, 'infinity'::date)
     and (ct.valid_to is null
          or (date_trunc('month', ct.valid_to - 1) + interval '1 month')::date > _ini);
  if _outra is not null then
    raise exception 'A frequência % conflita com outra condição %, do mesmo cliente, no mesmo mês.', v.closing_period, _outra
      using errcode = '55000',
            hint = 'A frequência vale para o mês inteiro: a mudança começa no dia 1 de um mês, sem outra versão no mesmo mês.';
  end if;

  if p_desde is null then
    return;
  end if;

  select ct.closing_period into _ant
    from public.contract_terms ct
    join public.contracts c on c.id = ct.contract_id
   where c.client_id = _cli
     and ct.active
     and ct.id <> v.id
     and ct.valid_from < v.valid_from
   order by ct.valid_from desc, ct.created_at desc
   limit 1;
  if coalesce(_ant, 'quinzenal') = v.closing_period then
    return;
  end if;

  if exists (
    select 1 from public.invoices i
     where i.client_id = _cli
       and i.period_end >= p_desde
       and (p_ate is null or i.period_start < p_ate)
  ) then
    raise exception 'O cliente já tem fatura a partir de %: a frequência de fechamento não muda sobre competência faturada.',
      to_char(p_desde, 'DD/MM/YYYY')
      using errcode = '55000',
            hint = 'Registre a mudança a partir do primeiro mês ainda sem fatura.';
  end if;

  if exists (
    select 1 from public.billing_additionals a
     where a.client_id = _cli
       and a.invoice_id is null
       and a.canceled_at is null
       and a.billing_period_start is not null
       and a.billing_period_start >= p_desde
       and (p_ate is null or a.billing_period_start < p_ate)
       and not public.janela_de_cobranca_valida(v.closing_period, a.billing_period_start, a.billing_period_end)
  ) then
    raise exception 'Há adicional a faturar com competência incompatível com a frequência %.', v.closing_period
      using errcode = '55000',
            hint = 'Cancele o adicional e registre-o de novo na competência da nova frequência.';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. RPC de leitura para as telas
-- ---------------------------------------------------------------------------

create function public.competencia_de_cobranca(p_client_id uuid, p_data date)
returns table (frequencia text, inicio date, fim date)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _freq text;
  _mes  date := date_trunc('month', p_data)::date;
  _ult  date := (date_trunc('month', p_data) + interval '1 month - 1 day')::date;
begin
  perform public.condicoes_exigir_admin_leitura();
  if p_client_id is null or p_data is null then
    raise exception 'Cliente e data são obrigatórios.' using errcode = '22023';
  end if;
  _freq := public.frequencia_de_fechamento(p_client_id, p_data);
  return query select
    _freq,
    case when _freq = 'quinzenal' and extract(day from p_data) > 15 then _mes + 15 else _mes end,
    case when _freq = 'quinzenal' and extract(day from p_data) <= 15 then _mes + 14 else _ult end;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. RPCs de condição do contrato com a frequência
-- ---------------------------------------------------------------------------

drop function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean, text, numeric, numeric);
drop function public.criar_contrato_com_vigencia(uuid, text, date, date, text, numeric, numeric, numeric, integer, text, text, numeric, numeric);

create function public.registrar_condicao_contrato(
  p_contract_id          uuid,
  p_valid_from           date,
  p_daily_rate           numeric,
  p_shift_hours          numeric,
  p_ot_factor            numeric,
  p_ot_tolerance_min     integer,
  p_reason               text,
  p_valid_to             date    default null,
  p_encerrar_anterior    boolean default false,
  p_ot_rounding_mode     text    default 'diario',
  p_saturday_shift_hours numeric default null,
  p_holiday_pay_factor   numeric default null,
  p_closing_period       text    default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_aberta public.contract_terms%rowtype;
  v_novo   public.contract_terms%rowtype;
  v_freq   text;
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
  if p_closing_period is not null and p_closing_period not in ('quinzenal', 'mensal') then
    raise exception 'Frequência de fechamento inválida: use quinzenal ou mensal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contracts where id = p_contract_id) then
    raise exception 'Contrato não encontrado.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || p_contract_id::text, 0));

  -- Sem frequência informada: herda a da versão anterior deste contrato (ou quinzenal).
  v_freq := coalesce(p_closing_period,
    (select ct.closing_period from public.contract_terms ct
      where ct.contract_id = p_contract_id and ct.active and ct.valid_from < p_valid_from
      order by ct.valid_from desc limit 1),
    'quinzenal');

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
       ot_rounding_mode, saturday_shift_hours, holiday_pay_factor, closing_period, origin, reason, created_by)
    values
      (p_contract_id, p_valid_from, p_valid_to, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min,
       p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor, v_freq, 'informada', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência informada se sobrepõe a outra versão ativa deste contrato.'
      using errcode = '23P01',
            hint = 'Encerre a versão anterior, informe a data final ou use p_encerrar_anterior.';
  end;

  perform public.periodo_contratual_conferir(v_novo.id, date_trunc('month', p_valid_from)::date,
    case when p_valid_to is null then null
         else (date_trunc('month', p_valid_to - 1) + interval '1 month')::date end);

  perform public.condicoes_auditar('contrato_condicao_registrada', 'contrato', p_contract_id, v_novo.id,
    null, to_jsonb(v_novo) || jsonb_build_object(
      'retroativa', p_valid_from < (now() at time zone 'America/Sao_Paulo')::date), v_motivo);

  return v_novo.id;
end;
$$;

-- A frequência da versão corrigida é preservada: mudar a frequência é registrar uma versão nova.
create or replace function public.corrigir_condicao_contrato(
  p_term_id              uuid,
  p_valid_from           date,
  p_valid_to             date,
  p_daily_rate           numeric,
  p_shift_hours          numeric,
  p_ot_factor            numeric,
  p_ot_tolerance_min     integer,
  p_reason               text,
  p_ot_rounding_mode     text    default 'diario',
  p_saturday_shift_hours numeric default null,
  p_holiday_pay_factor   numeric default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_ant    public.contract_terms%rowtype;
  v_apos   public.contract_terms%rowtype;
  v_novo   public.contract_terms%rowtype;
  v_contract uuid;
  v_desde  date;
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
       ot_rounding_mode, saturday_shift_hours, holiday_pay_factor, closing_period, origin, reason, created_by)
    values
      (v_contract, p_valid_from, p_valid_to, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min,
       p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor, v_ant.closing_period, 'correcao', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência corrigida se sobrepõe a outra versão ativa deste contrato.'
      using errcode = '23P01';
  end;

  update public.contract_terms set replaced_by = v_novo.id where id = p_term_id
    returning * into v_apos;

  -- Só os meses que a correção passa a cobrir antes do início antigo mudam de frequência.
  v_desde := date_trunc('month', p_valid_from)::date;
  perform public.periodo_contratual_conferir(v_novo.id,
    case when v_desde < date_trunc('month', v_ant.valid_from)::date then v_desde end,
    date_trunc('month', v_ant.valid_from)::date);

  perform public.condicoes_auditar('contrato_condicao_corrigida', 'contrato', v_contract, v_novo.id,
    to_jsonb(v_ant), to_jsonb(v_novo) || jsonb_build_object('substitui', p_term_id), v_motivo);

  return v_novo.id;
end;
$$;

create function public.criar_contrato_com_vigencia(
  p_client_id            uuid,
  p_name                 text,
  p_valid_from           date,
  p_valid_to             date,
  p_status               text,
  p_daily_rate           numeric,
  p_shift_hours          numeric,
  p_ot_factor            numeric,
  p_ot_tolerance_min     integer,
  p_reason               text,
  p_ot_rounding_mode     text    default 'diario',
  p_saturday_shift_hours numeric default null,
  p_holiday_pay_factor   numeric default null,
  p_closing_period       text    default null
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
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
    null, false, p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor, p_closing_period);

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Adicional com competência de cobrança
-- ---------------------------------------------------------------------------

drop function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid);

create function public.registrar_adicional(
  p_client_id            uuid,
  p_period_start         date,
  p_period_end           date,
  p_description          text,
  p_amount               numeric,
  p_reference            text default null,
  p_operation_id         uuid default null,
  p_billing_period_start date default null,
  p_billing_period_end   date default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
  if (p_billing_period_start is null) <> (p_billing_period_end is null) then
    raise exception 'Informe o início e o fim da competência de cobrança, ou nenhum dos dois.' using errcode = '22023';
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

  -- A competência é uma janela inteira da frequência do cliente; a execução pode estar fora dela.
  if p_billing_period_start is not null then
    perform public.validar_periodo_de_cobranca(p_client_id, p_billing_period_start, p_billing_period_end);
  end if;

  insert into public.billing_additionals
    (client_id, operation_id, period_start, period_end, description, reference, amount, created_by,
     billing_period_start, billing_period_end)
  values
    (p_client_id, p_operation_id, p_period_start, p_period_end, v_descricao, v_referencia, p_amount, auth.uid(),
     p_billing_period_start, p_billing_period_end)
  returning * into v_novo;

  perform public.condicoes_auditar('adicional_registrado', 'adicional', v_novo.id, v_novo.id,
    null, to_jsonb(v_novo), v_descricao);

  return v_novo.id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. gerar_fatura (corpo vigente: 037) pela competência
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


-- ---------------------------------------------------------------------------
-- 7. resumo_financeiro_periodo (corpo vigente: 032) pela competência
-- ---------------------------------------------------------------------------

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

  -- FIN-PR-05: o adicional entra pela competência de cobrança (o mesmo critério de gerar_fatura);
  -- sem competência (anterior à 038), pela execução inteira dentro do filtro.
  select coalesce(sum(a.amount), 0),
         coalesce(sum(a.amount) filter (where a.invoice_id is null), 0)
    into _adic, _adic_pend
    from public.billing_additionals a
   where coalesce(a.billing_period_start, a.period_start) >= p_inicio
     and coalesce(a.billing_period_end, a.period_end) <= p_fim
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

    -- Competências inteiras dentro do período, pela frequência de cada cliente (quinzenas ou o mês),
    -- por cliente com hora extra acumulada sem fatura.
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
      cross join lateral (
        select w.qi, w.qf
          from generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') m
          cross join lateral (select public.frequencia_de_fechamento(c.cli, m::date) as f) fr
          cross join lateral (values
            (m::date, case when fr.f = 'mensal' then (m + interval '1 month - 1 day')::date
                           else (m + interval '14 days')::date end),
            ((m + interval '15 days')::date, (m + interval '1 month - 1 day')::date)) w(qi, qf)
         where fr.f = 'quinzenal' or w.qi = m::date
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


-- ---------------------------------------------------------------------------
-- 8. Estado do motor: anuncia o período contratual
-- ---------------------------------------------------------------------------

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
    'nucleo_v2', true,
    -- FIN-PR-05 (038): frequência no contrato e competência de cobrança dos adicionais.
    'periodo_contratual', true);
end;
$function$;


-- ---------------------------------------------------------------------------
-- 9. Dono e privilégios
-- ---------------------------------------------------------------------------

do $privilegios$
declare
  _f record;
begin
  for _f in
    select p.oid::regprocedure as assinatura, p.proname as nome
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'janela_de_cobranca_valida', 'frequencia_de_fechamento', 'validar_periodo_de_cobranca',
         'periodo_contratual_conferir', 'competencia_de_cobranca', 'registrar_condicao_contrato',
         'criar_contrato_com_vigencia', 'registrar_adicional')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('competencia_de_cobranca', 'registrar_condicao_contrato', 'criar_contrato_com_vigencia',
                   'registrar_adicional') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean, text, numeric, numeric, text) is
  'Admin AAL2. Registra versao das condicoes do contrato (diaria, jornada, fator, tolerancia, modo de arredondamento, jornada de sabado, fator de feriado e frequencia de fechamento), com motivo e trilha.';
comment on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date) is
  'Admin AAL2. Registra adicional de servico: periodo de EXECUCAO e, opcionalmente, competencia de COBRANCA (janela da frequencia do cliente). Trilha.';
comment on function public.competencia_de_cobranca(uuid, date) is
  'Admin (leitura). Frequencia de fechamento do cliente no mes da data e a competencia que contem a data.';
comment on function public.janela_de_cobranca_valida(text, date, date) is
  'Interna, pura. A janela e uma competencia inteira da frequencia (quinzenal: 01-15/16-ultimo; mensal: 01-ultimo).';
comment on function public.frequencia_de_fechamento(uuid, date) is
  'Interna. Frequencia do cliente no mes: a das versoes ativas dos contratos; sem versao = quinzenal; duas = erro 55000.';
comment on function public.validar_periodo_de_cobranca(uuid, date, date) is
  'Interna de gerar_fatura e registrar_adicional. Recusa (22023) periodo que nao e competencia inteira do cliente.';
comment on function public.periodo_contratual_conferir(uuid, date, date) is
  'Interna das RPCs de condicao do contrato. Recusa frequencia mista no mes e mudanca sobre competencia faturada.';


-- ---------------------------------------------------------------------------
-- 10. Autoverificação (estrutural) e diagnóstico dos dados existentes
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _desalinhadas integer;
  _presos integer;
begin
  if not (public.janela_de_cobranca_valida('quinzenal', '2026-02-01', '2026-02-15')
      and public.janela_de_cobranca_valida('quinzenal', '2026-02-16', '2026-02-28')
      and public.janela_de_cobranca_valida('quinzenal', '2028-02-16', '2028-02-29')
      and public.janela_de_cobranca_valida('mensal', '2026-04-01', '2026-04-30')
      and public.janela_de_cobranca_valida('mensal', '2026-12-01', '2026-12-31'))
     or public.janela_de_cobranca_valida('quinzenal', '2026-02-16', '2026-02-27')
     or public.janela_de_cobranca_valida('quinzenal', '2028-02-16', '2028-02-28')
     or public.janela_de_cobranca_valida('quinzenal', '2026-03-01', '2026-03-31')
     or public.janela_de_cobranca_valida('mensal', '2026-03-01', '2026-03-15')
     or public.janela_de_cobranca_valida('mensal', '2026-12-16', '2027-01-15')
     or public.janela_de_cobranca_valida('semanal', '2026-03-01', '2026-03-07') then
    raise exception '038: o calendário da competência não confere.';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('registrar_condicao_contrato', 'corrigir_condicao_contrato', 'criar_contrato_com_vigencia',
                       'registrar_adicional')) <> 4 then
    raise exception '038: as RPCs alteradas devem ter uma única assinatura cada.';
  end if;
  -- O teste O16 (suíte 021) exige que gerar_fatura não cite o motor por vigência.
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'gerar_fatura'
              and (prosrc ilike '%vigencia%' or prosrc ilike '%financial_engine_settings%' or prosrc ilike '%_terms%')) then
    raise exception '038: gerar_fatura não deve citar o motor por vigência.';
  end if;
  if has_function_privilege('authenticated', 'public.validar_periodo_de_cobranca(uuid, date, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.frequencia_de_fechamento(uuid, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.periodo_contratual_conferir(uuid, date, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.competencia_de_cobranca(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date)', 'EXECUTE') then
    raise exception '038: as funções internas não são expostas e nada é exposto a anon.';
  end if;
  if exists (select 1 from public.contract_terms where closing_period <> 'quinzenal')
     or exists (select 1 from public.billing_additionals where billing_period_start is not null) then
    raise exception '038: nenhum dado existente deveria ter frequência ou competência diferente do padrão.';
  end if;

  -- Diagnóstico (não altera nada): faturas antigas fora da competência quinzenal e adicionais
  -- antigos a faturar que não cabem numa quinzena (só faturáveis cancelando e registrando de novo).
  select count(*) into _desalinhadas from public.invoices i
   where not public.janela_de_cobranca_valida('quinzenal', i.period_start, i.period_end);
  select count(*) into _presos from public.billing_additionals a
   where a.invoice_id is null and a.canceled_at is null
     and not (date_trunc('month', a.period_start) = date_trunc('month', a.period_end)
              and (extract(day from a.period_start) >= 16 or extract(day from a.period_end) <= 15));
  raise notice '038: % fatura(s) emitida(s) fora de quinzena (preservadas como estão); % adicional(is) a faturar sem quinzena que o contenha.',
    _desalinhadas, _presos;
end;
$verificacao$;

commit;
