-- Regras financeiras definitivas confirmadas pela BS (C05-B8.15). SOMENTE LOCAL até autorização.
--
-- Depende da 029. Vale no motor por vigência; o motor antigo (010) não é tocado.
--
-- O QUE ENTRA (só o que a BS confirmou)
--
--   1. ARREDONDAMENTO DA HORA EXTRA COBRADA, aplicado aos minutos residuais de cada hora, com as
--      horas completas preservadas: até 15 min, descarta; 16 a 45, 30 min; 46 a 59, a hora
--      seguinte (`arredondar_minutos_extras`). É regra de COBRANÇA: o custo segue em minutos
--      exatos, porque a aplicação ao pagamento não foi confirmada.
--        * modo 'diario' (padrão, clientes comuns): no próprio apontamento, depois da tolerância
--          do contrato;
--        * modo 'acumulado' (ex.: Aceville): o apontamento guarda os minutos excedentes BRUTOS, sem
--          tolerância e sem arredondar, e o fechamento soma os do período por colaborador e
--          arredonda uma única vez (14 + 26 = 40 -> 30). A diferença vira item próprio da fatura,
--          calculado por `ajustes_de_arredondamento_acumulado`, a mesma função da prévia.
--      O modo é parâmetro da vigência do contrato (`contract_terms.ot_rounding_mode`).
--      `timesheet_entries.billed_overtime_minutes` guarda os minutos COBRADOS do dia;
--      `overtime_minutes` continua sendo o excedente à jornada (após tolerância), base do custo.
--
--   2. SAÍDA ANTECIPADA: COBRANÇA PROPORCIONAL. Com entrada e saída e minutos trabalhados (já sem
--      o intervalo) abaixo da jornada de referência, a cobrança é `diária × trabalhado ÷
--      referência` (8 h previstas, 4 trabalhadas = meia diária). O custo proporcional da 029 segue.
--
--   3. SÁBADO: jornada de referência da COBRANÇA por contrato (`contract_terms.saturday_shift_hours`,
--      ex.: 4). Acima dela, hora extra com o fator do contrato, sobre a hora `diária ÷ jornada
--      contratual` (8 h), nunca `diária ÷ 4`. Abaixo dela, a cobrança é proporcional (item 2).
--      O PAGAMENTO no sábado não muda (regra não confirmada). Domingo: dia comum (não confirmado).
--
--   4. FERIADO: PAGAMENTO com adicional (`contract_terms.holiday_pay_factor`, ex.: 2 = +100%):
--      custo = horas trabalhadas × (custo diário ÷ jornada contratual) × fator. Diária R$ 150,
--      8 h, 6 h trabalhadas, fator 2 = R$ 225. A COBRANÇA no feriado não muda (não confirmada).
--      Calendário em `financial_holidays`, mantido por admin AAL2 com motivo e trilha.
--      O tipo do dia (útil, sábado, feriado) fica congelado no apontamento (`day_kind_snapshot`).
--
--   5. SALDO DE HORAS (compensação, ex.: Dynamis): `saldo_de_horas_do_periodo` mostra, por
--      colaborador, excedentes e faltantes brutos do período. É INFORMATIVO: como a compensação se
--      aplica à cobrança e ao custo não foi confirmado, nenhum valor muda por causa dela.
--
-- Parâmetros novos nascem neutros: modo 'diario', sem regra de sábado, sem fator de feriado.
-- Apontamentos já gravados não mudam; só o que for precificado ou editado depois.
--
-- REVERSÃO (só sem feriado registrado, sem versão com parâmetro novo e sem apontamento
-- precificado com eles; a trilha é append-only):
--   recriar derivar_valores_por_vigencia, gerar_fatura, estado_motor_vigencia e
--   bloquear_colunas_de_condicoes com o corpo da 029; dropar as assinaturas novas de
--   registrar/corrigir_condicao_contrato e criar_contrato_com_vigencia e recriar as da 023/026;
--   drop function public.ajustes_de_arredondamento_acumulado(uuid, date, date, uuid[]);
--   drop function public.saldo_de_horas_do_periodo(uuid, date, date);
--   drop function public.registrar_feriado(date, text, text);
--   drop function public.aposentar_feriado(uuid, text);
--   drop function public.motor_tipo_do_dia(date);
--   drop function public.arredondar_minutos_extras(integer);
--   drop table public.financial_holidays; drop function public.proteger_feriado();
--   alter table public.timesheet_entries drop column billed_overtime_minutes, drop column day_kind_snapshot;
--   alter table public.contract_terms drop column ot_rounding_mode,
--     drop column saturday_shift_hours, drop column holiday_pay_factor;
--   e restaurar os CHECK da trilha da 029.


-- ---------------------------------------------------------------------------
-- 1. Trilha: eventos de feriado
-- ---------------------------------------------------------------------------

alter table public.financial_terms_audit
  drop constraint financial_terms_audit_acao_valida,
  drop constraint financial_terms_audit_entidade_valida;

alter table public.financial_terms_audit
  add constraint financial_terms_audit_acao_valida check (action in (
    'contrato_condicao_registrada', 'contrato_condicao_corrigida',
    'contrato_condicao_encerrada', 'contrato_condicao_aposentada',
    'colaborador_custo_registrado', 'colaborador_custo_corrigido',
    'colaborador_custo_encerrado', 'colaborador_custo_aposentado',
    'operacao_valor_registrado', 'operacao_valor_corrigido',
    'operacao_valor_encerrado', 'operacao_valor_aposentado',
    'motor_vigencia_ativado', 'motor_vigencia_desativado',
    'colunas_legadas_sincronizadas', 'apontamento_legado_regularizado',
    'adicional_registrado', 'adicional_cancelado',
    'feriado_registrado', 'feriado_aposentado'
  )),
  add constraint financial_terms_audit_entidade_valida check (entity_kind in
    ('contrato', 'colaborador', 'operacao', 'sistema', 'apontamento', 'adicional', 'feriado'));


-- ---------------------------------------------------------------------------
-- 2. Parâmetros na vigência do contrato e colunas derivadas do apontamento
-- ---------------------------------------------------------------------------

-- Versões existentes recebem os valores neutros; o gatilho de imutabilidade não dispara em ALTER.
alter table public.contract_terms
  add column ot_rounding_mode     text not null default 'diario',
  add column saturday_shift_hours numeric(5,2),
  add column holiday_pay_factor   numeric(5,2),
  add constraint contract_terms_modo_arredondamento_valido
    check (ot_rounding_mode in ('diario', 'acumulado')),
  add constraint contract_terms_sabado_valido
    check (saturday_shift_hours is null or (saturday_shift_hours > 0 and saturday_shift_hours <= shift_hours)),
  add constraint contract_terms_fator_feriado_valido
    check (holiday_pay_factor is null or (holiday_pay_factor >= 1 and holiday_pay_factor <= 5));

comment on column public.contract_terms.ot_rounding_mode is
  'Arredondamento da hora extra COBRADA: diario (no apontamento, depois da tolerancia) ou acumulado (no fechamento, sobre a soma do periodo, sem tolerancia diaria).';
comment on column public.contract_terms.saturday_shift_hours is
  'Jornada de referencia da COBRANCA no sabado (ex.: 4). NULL = sabado e dia comum. A hora cobrada continua diaria / jornada contratual.';
comment on column public.contract_terms.holiday_pay_factor is
  'Fator do PAGAMENTO em feriado (2 = adicional de 100%): horas trabalhadas x custo diario / jornada x fator. NULL = sem regra de feriado.';

alter table public.timesheet_entries
  add column billed_overtime_minutes integer,
  add column day_kind_snapshot       text,
  add constraint timesheet_entries_minutos_cobrados_nao_negativos
    check (billed_overtime_minutes is null or billed_overtime_minutes >= 0),
  add constraint timesheet_entries_tipo_do_dia_valido
    check (day_kind_snapshot is null or day_kind_snapshot in ('util', 'sabado', 'feriado'));

comment on column public.timesheet_entries.billed_overtime_minutes is
  'Minutos de hora extra COBRADOS no dia (arredondados no modo diario; brutos no modo acumulado). Derivado pelo sistema. NULL = apontamento anterior a 030.';
comment on column public.timesheet_entries.day_kind_snapshot is
  'Tipo do dia trabalhado no momento da precificacao (util, sabado, feriado). Derivado e congelado pelo sistema.';

-- As colunas novas do apontamento também só o sistema grava.
create or replace function public.bloquear_colunas_de_condicoes()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  _mexeu boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    _mexeu := new.contract_terms_id is not null
           or new.employee_cost_terms_id is not null
           or new.shift_hours_snapshot is not null
           or new.ot_factor_snapshot is not null
           or new.ot_tolerance_snapshot is not null
           or new.planned_minutes_snapshot is not null
           or new.terms_origin is not null
           or new.ot_hourly_cost_snapshot is not null
           or new.billed_overtime_minutes is not null
           or new.day_kind_snapshot is not null;
  else
    _mexeu := new.contract_terms_id is distinct from old.contract_terms_id
           or new.employee_cost_terms_id is distinct from old.employee_cost_terms_id
           or new.shift_hours_snapshot is distinct from old.shift_hours_snapshot
           or new.ot_factor_snapshot is distinct from old.ot_factor_snapshot
           or new.ot_tolerance_snapshot is distinct from old.ot_tolerance_snapshot
           or new.planned_minutes_snapshot is distinct from old.planned_minutes_snapshot
           or new.terms_origin is distinct from old.terms_origin
           or new.ot_hourly_cost_snapshot is distinct from old.ot_hourly_cost_snapshot
           or new.billed_overtime_minutes is distinct from old.billed_overtime_minutes
           or new.day_kind_snapshot is distinct from old.day_kind_snapshot;
  end if;

  if _mexeu then
    raise exception
      'As condições financeiras do apontamento são registradas pelo sistema e não podem ser gravadas diretamente.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Arredondamento e calendário
-- ---------------------------------------------------------------------------

-- Minutos residuais de cada hora: até 15 descarta; 16 a 45 vira 30; 46 a 59 vira a hora seguinte.
create or replace function public.arredondar_minutos_extras(p_minutos integer)
returns integer
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when p_minutos <= 0 then 0
    when p_minutos % 60 <= 15 then (p_minutos / 60) * 60
    when p_minutos % 60 <= 45 then (p_minutos / 60) * 60 + 30
    else (p_minutos / 60 + 1) * 60
  end;
$$;

create table public.financial_holidays (
  id            uuid primary key default gen_random_uuid(),
  holiday_date  date not null,
  name          text not null,
  active        boolean not null default true,
  reason        text not null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  retired_at    timestamptz,
  retired_by    uuid references auth.users (id) on delete set null,
  retire_reason text,
  constraint financial_holidays_nome_valido check (char_length(btrim(name)) between 1 and 120),
  constraint financial_holidays_motivo_valido check (char_length(btrim(reason)) between 1 and 1000),
  constraint financial_holidays_aposentadoria_coerente check (
    (active and retired_at is null and retire_reason is null)
    or (not active and retired_at is not null and char_length(btrim(retire_reason)) > 0))
);

create unique index financial_holidays_um_ativo_por_data
  on public.financial_holidays (holiday_date) where active;

comment on table public.financial_holidays is
  'Calendario de feriados do motor financeiro. Escrita so por registrar_feriado/aposentar_feriado (admin AAL2, motivo, trilha). Nao se apaga. O tipo do dia fica congelado no apontamento.';

alter table public.financial_holidays enable row level security;

create policy financial_holidays_leitura_admin on public.financial_holidays
  for select to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

create policy financial_holidays_exige_admin_aal2 on public.financial_holidays
  as restrictive for all to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)))
  with check (((select auth.jwt() ->> 'aal') = 'aal2')
              and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

revoke all on table public.financial_holidays from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.financial_holidays to authenticated;

-- Só a aposentadoria (uma vez, com motivo) muda uma linha; nada se apaga.
create or replace function public.proteger_feriado()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Feriado não é apagado: aposente com motivo.' using errcode = '42501';
  end if;
  if not old.active then
    raise exception 'Feriado aposentado é imutável.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['active', 'retired_at', 'retired_by', 'retire_reason'])
     is distinct from (to_jsonb(old) - array['active', 'retired_at', 'retired_by', 'retire_reason'])
     or new.active then
    raise exception 'Data, nome e motivo de um feriado não mudam: aposente e registre outro.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_financial_holidays_imutavel
  before update or delete on public.financial_holidays
  for each row execute function public.proteger_feriado();

create trigger trg_financial_holidays_sem_truncate
  before truncate on public.financial_holidays
  for each statement execute function public.proteger_feriado();

-- Tipo do dia trabalhado: feriado cadastrado tem precedência sobre sábado; domingo é dia comum.
create or replace function public.motor_tipo_do_dia(p_data date)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when exists (select 1 from public.financial_holidays h where h.holiday_date = p_data and h.active) then 'feriado'
    when extract(isodow from p_data) = 6 then 'sabado'
    else 'util'
  end;
$$;

create or replace function public.registrar_feriado(
  p_data   date,
  p_nome   text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_novo   public.financial_holidays%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_data is null or v_nome = '' then
    raise exception 'Data e nome do feriado são obrigatórios.' using errcode = '22023';
  end if;
  if char_length(v_nome) > 120 then
    raise exception 'O nome do feriado deve ter no máximo 120 caracteres.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feriados', 0));
  begin
    insert into public.financial_holidays (holiday_date, name, reason, created_by)
    values (p_data, v_nome, v_motivo, auth.uid())
    returning * into v_novo;
  exception when unique_violation then
    raise exception 'Já existe feriado ativo em %.', p_data using errcode = '23505';
  end;
  perform public.condicoes_auditar('feriado_registrado', 'feriado', v_novo.id, v_novo.id,
    null, to_jsonb(v_novo), v_motivo);
  return v_novo.id;
end;
$$;

create or replace function public.aposentar_feriado(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_ant    public.financial_holidays%rowtype;
  v_dep    public.financial_holidays%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_id is null then
    raise exception 'O feriado é obrigatório.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feriados', 0));
  select * into v_ant from public.financial_holidays where id = p_id for update;
  if not found then
    raise exception 'Feriado não encontrado.' using errcode = 'P0002';
  end if;
  if not v_ant.active then
    raise exception 'O feriado já está aposentado.' using errcode = '55000';
  end if;
  update public.financial_holidays
     set active = false, retired_at = now(), retired_by = auth.uid(), retire_reason = v_motivo
   where id = p_id
  returning * into v_dep;
  perform public.condicoes_auditar('feriado_aposentado', 'feriado', p_id, p_id,
    to_jsonb(v_ant), to_jsonb(v_dep), v_motivo);
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. RPCs de condição do contrato com os parâmetros novos
-- ---------------------------------------------------------------------------

create or replace function public.condicoes_validar_parametros_de_horas(
  p_modo        text,
  p_sabado      numeric,
  p_feriado     numeric,
  p_shift_hours numeric
) returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if p_modo is null or p_modo not in ('diario', 'acumulado') then
    raise exception 'Modo de arredondamento inválido: use diario ou acumulado.' using errcode = '22023';
  end if;
  if p_sabado is not null and (p_sabado <= 0 or p_sabado > p_shift_hours or p_sabado <> round(p_sabado, 2)) then
    raise exception 'A jornada de sábado deve ser positiva, no máximo a jornada do contrato e com até duas casas.'
      using errcode = '22023';
  end if;
  if p_feriado is not null and (p_feriado < 1 or p_feriado > 5 or p_feriado <> round(p_feriado, 2)) then
    raise exception 'O fator de feriado deve estar entre 1 e 5, com até duas casas (2 = adicional de 100%%).'
      using errcode = '22023';
  end if;
end;
$$;

drop function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean);
drop function public.corrigir_condicao_contrato(uuid, date, date, numeric, numeric, numeric, integer, text);
drop function public.criar_contrato_com_vigencia(uuid, text, date, date, text, numeric, numeric, numeric, integer, text);

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
  p_holiday_pay_factor   numeric default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;

create function public.corrigir_condicao_contrato(
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
  p_holiday_pay_factor   numeric default null
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
    null, false, p_ot_rounding_mode, p_saturday_shift_hours, p_holiday_pay_factor);

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Motor por vigência (corpo da 029 com as regras desta migration, marcadas B8.15)
-- ---------------------------------------------------------------------------

create or replace function public.derivar_valores_por_vigencia()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _work_date   date;
  _operation   uuid;
  _shift       uuid;
  _motriz      boolean;
  _precificar  boolean;
  _fonte       record;
  _custo       record;
  _ativacao    date;

  _origem              text;
  _contract_terms_id   uuid;
  _operation_terms_id  uuid;
  _employee_terms_id   uuid;

  _daily_rate       double precision;
  _shift_hours      double precision;
  _ot_factor        double precision;
  _ot_tolerance_min double precision;
  _daily_cost       double precision;
  _planned          double precision;
  _ot_hourly        numeric;

  -- B8.15
  _dia            text;
  _modo           text := 'diario';
  _sabado_horas   double precision;
  _fator_feriado  double precision;
  _planned_cob    double precision;
  _base_cob       double precision;
  _excesso_cob    double precision;
  _ot_cob         double precision := 0;
  _completo       boolean;

  _planned_efetivo     double precision;
  _shift_hours_efetivo double precision;
  _ot_factor_efetivo   double precision;
  _ot_hour_rate        double precision;
  _ot_cost_hour_rate   double precision;
  _base_cost           double precision;

  _inicio    double precision;
  _fim       double precision;
  _worked    double precision := 0;
  _excess    double precision;
  _overtime  double precision := 0;
  _ot_horas  double precision;

  _billed numeric;
  _cost   numeric;
begin
  -- `INSERT ... ON CONFLICT DO UPDATE` dispara este BEFORE INSERT mesmo quando o resultado final
  -- é UPDATE: a linha que já existe é tratada na fase de UPDATE.
  if tg_op = 'INSERT' then
    if exists (select 1 from public.timesheet_entries e where e.id = new.id)
       or exists (select 1 from public.timesheet_entries e
                   where e.timesheet_id = new.timesheet_id and e.employee_id = new.employee_id) then
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    _motriz :=
         new.status        is distinct from old.status
      or new.check_in      is distinct from old.check_in
      or new.check_out     is distinct from old.check_out
      or new.break_minutes is distinct from old.break_minutes
      or new.employee_id   is distinct from old.employee_id
      or new.timesheet_id  is distinct from old.timesheet_id;

    -- Sem coluna motriz, e sem a regularização: preserva o gravado, como a 010.
    if not _motriz and new.terms_origin is not distinct from old.terms_origin then
      new.worked_minutes          := old.worked_minutes;
      new.overtime_minutes        := old.overtime_minutes;
      new.billed_overtime_minutes := old.billed_overtime_minutes;
      new.day_kind_snapshot       := old.day_kind_snapshot;
      new.daily_rate_snapshot     := old.daily_rate_snapshot;
      new.ot_hour_rate_snapshot   := old.ot_hour_rate_snapshot;
      new.daily_cost_snapshot     := old.daily_cost_snapshot;
      new.ot_hourly_cost_snapshot := old.ot_hourly_cost_snapshot;
      new.billed_amount           := old.billed_amount;
      new.cost_amount             := old.cost_amount;
      return new;
    end if;
  end if;

  -- Apontamento LEGADO de presença/reposição segue congelado para qualquer edição motriz.
  if tg_op = 'UPDATE' and old.status <> 'absent'
     and old.terms_origin is null and new.terms_origin is null then
    raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
      using errcode = '55000',
            hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
  end if;

  -- Falta: nada a precificar, valores zerados.
  if new.status = 'absent' then
    if tg_op = 'INSERT' then
      new.contract_terms_id       := null;
      new.operation_terms_id      := null;
      new.employee_cost_terms_id  := null;
      new.shift_hours_snapshot    := null;
      new.ot_factor_snapshot      := null;
      new.ot_tolerance_snapshot   := null;
      new.planned_minutes_snapshot := null;
      new.terms_origin            := null;
      new.ot_hourly_cost_snapshot := null;
      new.day_kind_snapshot       := null;
      new.daily_rate_snapshot     := 0;
      new.ot_hour_rate_snapshot   := 0;
      new.daily_cost_snapshot     := 0;
    else
      new.contract_terms_id       := old.contract_terms_id;
      new.operation_terms_id      := old.operation_terms_id;
      new.shift_hours_snapshot    := old.shift_hours_snapshot;
      new.ot_factor_snapshot      := old.ot_factor_snapshot;
      new.ot_tolerance_snapshot   := old.ot_tolerance_snapshot;
      new.planned_minutes_snapshot := old.planned_minutes_snapshot;
      new.terms_origin            := old.terms_origin;
      new.day_kind_snapshot       := old.day_kind_snapshot;
      new.daily_rate_snapshot     := old.daily_rate_snapshot;
      new.ot_hour_rate_snapshot   := old.ot_hour_rate_snapshot;
      if new.employee_id is distinct from old.employee_id then
        new.employee_cost_terms_id  := null;
        new.daily_cost_snapshot     := 0;
        new.ot_hourly_cost_snapshot := null;
      else
        new.employee_cost_terms_id  := old.employee_cost_terms_id;
        new.daily_cost_snapshot     := old.daily_cost_snapshot;
        new.ot_hourly_cost_snapshot := old.ot_hourly_cost_snapshot;
      end if;
    end if;
    new.worked_minutes          := 0;
    new.overtime_minutes        := 0;
    new.billed_overtime_minutes := 0;
    new.billed_amount           := 0;
    new.cost_amount             := 0;
    return new;
  end if;

  -- Data, operação e turno vêm da FOLHA, nunca do payload.
  select t.work_date, t.operation_id, t.shift_id
    into _work_date, _operation, _shift
    from public.timesheets t
   where t.id = new.timesheet_id;
  if not found then
    return new;
  end if;

  _precificar := case
    when tg_op = 'INSERT' then true
    else new.timesheet_id is distinct from old.timesheet_id or old.status = 'absent'
  end;

  _origem := new.terms_origin;
  _contract_terms_id := new.contract_terms_id;
  _operation_terms_id := new.operation_terms_id;
  _employee_terms_id := new.employee_cost_terms_id;

  if _precificar then
    select ativada_em into _ativacao from public.financial_engine_settings where id;
    if _ativacao is not null and _work_date < _ativacao
       and exists (select 1 from public.timesheet_entries e
                     join public.timesheets s on s.id = e.timesheet_id
                    where s.operation_id = _operation and e.terms_origin is null
                      and e.status <> 'absent'
                      and e.id is distinct from new.id) then
      raise exception 'Esta operação tem apontamentos anteriores à ativação do histórico de vigências; o vínculo de contrato daquele período é desconhecido.'
        using errcode = '55000',
              hint = 'Regularize os apontamentos legados da operação antes de lançar datas anteriores a ' || _ativacao || '.';
    end if;

    select * into _fonte from public.motor_fonte_do_dia(_operation, _work_date);
    select * into _custo from public.motor_custo_do_dia(new.employee_id, _work_date);

    _origem := _fonte.o_origem;
    _contract_terms_id := _fonte.o_contract_terms_id;
    _operation_terms_id := _fonte.o_operation_terms_id;
    _employee_terms_id := _custo.o_employee_cost_terms_id;

    _daily_rate := _fonte.o_daily_rate;
    _shift_hours := _fonte.o_shift_hours;
    _ot_factor := _fonte.o_ot_factor;
    _ot_tolerance_min := _fonte.o_ot_tolerance_min;
    _daily_cost := _custo.o_daily_cost;
    _planned := public.motor_minutos_previstos(_shift);
    select ot_hourly_cost into _ot_hourly from public.employee_cost_terms where id = _employee_terms_id;
    -- B8.15: o tipo do dia é fixado na precificação.
    _dia := public.motor_tipo_do_dia(_work_date);

    new.shift_hours_snapshot := _fonte.o_shift_hours;
    new.ot_factor_snapshot := _fonte.o_ot_factor;
    new.ot_tolerance_snapshot := _fonte.o_ot_tolerance_min;
    new.planned_minutes_snapshot := _planned::numeric;
  else
    if new.terms_origin in ('versao', 'valor_acordado')
       and new.daily_rate_snapshot is not null and new.shift_hours_snapshot is not null
       and new.ot_factor_snapshot is not null and new.ot_tolerance_snapshot is not null
       and new.planned_minutes_snapshot is not null and new.daily_cost_snapshot is not null then
      _daily_rate := new.daily_rate_snapshot;
      _shift_hours := new.shift_hours_snapshot;
      _ot_factor := new.ot_factor_snapshot;
      _ot_tolerance_min := new.ot_tolerance_snapshot;
      _planned := new.planned_minutes_snapshot;
      _daily_cost := new.daily_cost_snapshot;

      if new.employee_id is distinct from old.employee_id then
        select * into _custo from public.motor_custo_do_dia(new.employee_id, _work_date);
        _employee_terms_id := _custo.o_employee_cost_terms_id;
        _daily_cost := _custo.o_daily_cost;
      end if;

      if _employee_terms_id is distinct from old.employee_cost_terms_id then
        select ot_hourly_cost into _ot_hourly from public.employee_cost_terms where id = _employee_terms_id;
      else
        _ot_hourly := old.ot_hourly_cost_snapshot;
      end if;
      -- B8.15: o tipo do dia fica o congelado (apontamento anterior à 030: calculado agora).
      _dia := coalesce(old.day_kind_snapshot, public.motor_tipo_do_dia(_work_date));
    else
      raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
        using errcode = '55000',
              hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
    end if;
  end if;

  -- B8.15: parâmetros de horas da versão do contrato (imutável). Valor acordado: neutros.
  if _contract_terms_id is not null then
    select ct.ot_rounding_mode, ct.saturday_shift_hours, ct.holiday_pay_factor
      into _modo, _sabado_horas, _fator_feriado
      from public.contract_terms ct where ct.id = _contract_terms_id;
  end if;
  _modo := coalesce(_modo, 'diario');

  _shift_hours_efetivo := case
    when _shift_hours is not null and _shift_hours > 0 then _shift_hours else 8
  end;
  _ot_factor_efetivo := case
    when _ot_factor is null or _ot_factor = 0 then 1 else _ot_factor
  end;

  _daily_rate        := coalesce(_daily_rate, 0);
  _daily_cost        := coalesce(_daily_cost, 0);
  -- A hora cobrada é diária ÷ jornada CONTRATUAL, também no sábado.
  _ot_hour_rate      := (_daily_rate / _shift_hours_efetivo) * _ot_factor_efetivo;
  _ot_cost_hour_rate := case
    when _ot_hourly is not null then _ot_hourly::double precision
    else _daily_cost / _shift_hours_efetivo
  end;

  _completo := new.check_in is not null and new.check_out is not null;
  if not _completo then
    _worked := 0;
  else
    _inicio := extract(hour from new.check_in)  * 60 + extract(minute from new.check_in);
    _fim    := extract(hour from new.check_out) * 60 + extract(minute from new.check_out);
    if _fim <= _inicio then
      _fim := _fim + 1440;
    end if;
    _worked := greatest(0, _fim - _inicio - coalesce(new.break_minutes, 0));
  end if;

  _planned_efetivo := case
    when _planned is null or _planned = 0 then _shift_hours_efetivo * 60 else _planned
  end;

  -- CUSTO (029): excedente à jornada, após tolerância, em minutos exatos.
  _excess   := _worked - _planned_efetivo;
  _overtime := case
    when _excess > coalesce(_ot_tolerance_min, 0) then _excess else 0
  end;
  _ot_horas := _overtime / 60.0;
  _base_cost := case
    when _completo and _worked < _planned_efetivo
      then _daily_cost * _worked / _planned_efetivo
    else _daily_cost
  end;

  -- COBRANÇA (B8.15): jornada de referência (sábado, se o contrato definir), proporcional abaixo
  -- dela e hora extra arredondada no dia (modo diario) ou bruta (modo acumulado).
  _planned_cob := case
    when _dia = 'sabado' and _sabado_horas is not null then _sabado_horas * 60
    else _planned_efetivo
  end;
  _base_cob := case
    when _completo and _worked < _planned_cob then _daily_rate * _worked / _planned_cob
    else _daily_rate
  end;
  _excesso_cob := greatest(_worked - _planned_cob, 0);
  _ot_cob := case
    when _modo = 'acumulado' then _excesso_cob
    when _excesso_cob > coalesce(_ot_tolerance_min, 0)
      then public.arredondar_minutos_extras(_excesso_cob::integer)
    else 0
  end;

  _billed := round((( _base_cob + (_ot_cob / 60.0) * _ot_hour_rate) * 100)::numeric) / 100;

  -- PAGAMENTO no feriado (B8.15): horas trabalhadas × custo-hora × fator, quando o contrato define.
  if _dia = 'feriado' and _fator_feriado is not null and _completo then
    _cost := round(((( _worked / 60.0) * (_daily_cost / _shift_hours_efetivo) * _fator_feriado) * 100)::numeric) / 100;
  else
    _cost := round((( _base_cost + _ot_horas * _ot_cost_hour_rate) * 100)::numeric) / 100;
  end if;

  new.worked_minutes          := _worked::integer;
  new.overtime_minutes        := _overtime::integer;
  new.billed_overtime_minutes := _ot_cob::integer;
  new.day_kind_snapshot       := _dia;
  new.daily_rate_snapshot     := _daily_rate::numeric;
  new.ot_hour_rate_snapshot   := _ot_hour_rate::numeric;
  new.daily_cost_snapshot     := _daily_cost::numeric;
  new.ot_hourly_cost_snapshot := _ot_hourly;
  new.billed_amount           := _billed;
  new.cost_amount             := _cost;

  new.terms_origin           := _origem;
  new.contract_terms_id      := _contract_terms_id;
  new.operation_terms_id     := _operation_terms_id;
  new.employee_cost_terms_id := _employee_terms_id;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Fechamento: arredondamento acumulado e saldo de horas
-- ---------------------------------------------------------------------------

-- Um cálculo só, usado pela prévia (apontamentos não faturados do período) e por gerar_fatura
-- (exatamente os apontamentos que ela vai vincular). Por colaborador e valor-hora cobrado:
--   ajuste = round2(arredondar(Σ minutos brutos) / 60 × valor-hora) − Σ valor de hora extra já cobrado.
create or replace function public.ajustes_de_arredondamento_acumulado(
  p_client_id    uuid,
  p_inicio       date,
  p_fim          date,
  p_apontamentos uuid[] default null
) returns table (
  employee_id          uuid,
  colaborador          text,
  valor_hora           numeric,
  minutos_brutos       integer,
  minutos_arredondados integer,
  valor_bruto          numeric,
  valor_arredondado    numeric,
  ajuste               numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;

-- Informativo (compensação entre dias): excedentes e faltantes brutos à jornada de referência da
-- cobrança, por colaborador, só em apontamentos com entrada e saída. Não altera valor algum.
create or replace function public.saldo_de_horas_do_periodo(
  p_client_id uuid,
  p_inicio    date,
  p_fim       date
) returns table (
  employee_id        uuid,
  colaborador        text,
  apontamentos       integer,
  minutos_excedentes integer,
  minutos_faltantes  integer,
  saldo              integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;


-- ---------------------------------------------------------------------------
-- 7. gerar_fatura com o arredondamento acumulado
-- ---------------------------------------------------------------------------
--
-- Corpo da 029 com três acréscimos: horas extras pelos minutos COBRADOS, o ajuste de
-- arredondamento acumulado (item próprio por colaborador) e o total com ele. Sem contrato em modo
-- acumulado, o resultado é o mesmo da 029.

create or replace function public.gerar_fatura(
  _client_id    uuid,
  _period_start date,
  _period_end   date
)
returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    invoice_id, operation_id, description, quantity, unit_price, amount
  )
  select
    _fatura.id,
    o.id,
    o.name || ' — diárias',
    count(*),
    round(
      (sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)))
      / count(*), 2),
    sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name;

  -- Horas extras por operação, pelos minutos COBRADOS.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount
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
    sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name
  having sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)) > 0;

  -- B8.15: um item por colaborador com arredondamento acumulado diferente de zero.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount
  )
  select
    _fatura.id,
    null,
    'Arredondamento acumulado de horas extras — ' || j.colaborador
      || ' (' || j.minutos_brutos || ' min → ' || j.minutos_arredondados || ' min)',
    round((j.minutos_arredondados - j.minutos_brutos)::numeric / 60, 2),
    j.valor_hora,
    j.ajuste
  from public.ajustes_de_arredondamento_acumulado(_client_id, _period_start, _period_end, _ids) j
  where j.ajuste <> 0
  order by j.colaborador, j.employee_id;

  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount
  )
  select
    _fatura.id,
    a.operation_id,
    'Adicional — ' || a.description || coalesce(' (ref. ' || a.reference || ')', ''),
    1,
    a.amount,
    a.amount
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
$$;

comment on function public.gerar_fatura(uuid, date, date) is
  'Gera uma fatura em transação única: apontamentos não faturados do cliente no '
  'período, adicionais de serviço contidos no período e o arredondamento acumulado '
  'de horas extras; soma os totais no servidor, cria invoice e invoice_items e '
  'vincula tudo. Exige papel admin e sessão aal2. Qualquer falha desfaz tudo.';

revoke all on function public.gerar_fatura(uuid, date, date) from public;
revoke all on function public.gerar_fatura(uuid, date, date) from anon;
grant execute on function public.gerar_fatura(uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Estado do motor: anuncia as regras desta migration
-- ---------------------------------------------------------------------------

create or replace function public.estado_motor_vigencia()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;


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
         'bloquear_colunas_de_condicoes', 'arredondar_minutos_extras', 'proteger_feriado',
         'motor_tipo_do_dia', 'registrar_feriado', 'aposentar_feriado',
         'condicoes_validar_parametros_de_horas', 'registrar_condicao_contrato',
         'corrigir_condicao_contrato', 'criar_contrato_com_vigencia', 'derivar_valores_por_vigencia',
         'ajustes_de_arredondamento_acumulado', 'saldo_de_horas_do_periodo', 'estado_motor_vigencia')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('registrar_feriado', 'aposentar_feriado', 'registrar_condicao_contrato',
                   'corrigir_condicao_contrato', 'criar_contrato_com_vigencia',
                   'ajustes_de_arredondamento_acumulado', 'saldo_de_horas_do_periodo',
                   'estado_motor_vigencia') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean, text, numeric, numeric) is
  'Admin AAL2. Registra versao das condicoes do contrato (diaria, jornada, fator, tolerancia, modo de arredondamento, jornada de sabado e fator de feriado), com motivo e trilha.';
comment on function public.registrar_feriado(date, text, text) is
  'Admin AAL2. Registra feriado no calendario do motor, com motivo e trilha. Um ativo por data.';
comment on function public.aposentar_feriado(uuid, text) is
  'Admin AAL2. Aposenta feriado com motivo e trilha. Apontamentos ja precificados mantem o tipo do dia congelado.';
comment on function public.ajustes_de_arredondamento_acumulado(uuid, date, date, uuid[]) is
  'Admin AAL2. Arredondamento acumulado da hora extra cobrada por colaborador (contratos em modo acumulado). Sem lista: apontamentos nao faturados do periodo (previa); com lista: os da fatura.';
comment on function public.saldo_de_horas_do_periodo(uuid, date, date) is
  'Admin AAL2. Informativo: excedentes e faltantes brutos a jornada de referencia, por colaborador. Nao altera valores.';


-- ---------------------------------------------------------------------------
-- 10. Autoverificação (estrutural)
-- ---------------------------------------------------------------------------

do $verificacao$
begin
  if public.arredondar_minutos_extras(14) <> 0 or public.arredondar_minutos_extras(15) <> 0
     or public.arredondar_minutos_extras(16) <> 30 or public.arredondar_minutos_extras(44) <> 30
     or public.arredondar_minutos_extras(45) <> 30 or public.arredondar_minutos_extras(46) <> 60
     or public.arredondar_minutos_extras(40) <> 30 or public.arredondar_minutos_extras(135) <> 120 then
    raise exception '030: a regra de arredondamento não confere com a informada pela BS.';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('registrar_condicao_contrato', 'corrigir_condicao_contrato', 'criar_contrato_com_vigencia')) <> 3 then
    raise exception '030: as RPCs de condição do contrato devem ter uma única assinatura cada.';
  end if;
  if has_table_privilege('authenticated', 'public.financial_holidays', 'INSERT')
     or has_table_privilege('authenticated', 'public.financial_holidays', 'UPDATE')
     or has_table_privilege('bslog_rpc_operacional', 'public.financial_holidays', 'SELECT') then
    raise exception '030: feriados só se escrevem por RPC e o operacional não os lê.';
  end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'billed_overtime_minutes', 'SELECT') then
    raise exception '030: o operacional não lê minutos cobrados.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname = 'derivar_valores_financeiros' and prosrc ilike '%arredondar%') then
    raise exception '030: o motor antigo (010) não deve ser alterado.';
  end if;
end;
$verificacao$;
