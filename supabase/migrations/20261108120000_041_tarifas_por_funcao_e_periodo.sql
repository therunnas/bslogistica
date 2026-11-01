-- Tarifas comerciais por contrato + função + período do turno + vigência (FIN-PR-07, etapas 4 a 7).
-- SOMENTE LOCAL até autorização. Depende da 040 (snapshots protegidos).
--
-- A resolução de preço por função e período NASCE DESLIGADA. Aplicar esta migration não muda NENHUM
-- valor: com a resolução desligada o motor calcula exatamente como antes (diária genérica do contrato
-- ou valor acordado da operação). Ligar é uma decisão administrativa separada (alterar_resolucao_tarifas),
-- exige o motor por vigência ligado e, em HML ou Production, autorização própria.
--
-- O QUE MUDA
--   1. `contract_rate_terms`: tarifa versionada (contrato, função, período diurno/noturno, vigência,
--      diária numeric(12,2) > 0). Sem sobreposição entre versões ativas da mesma combinação, imutável
--      (só o ciclo de vida muda), sem exclusão, RLS de admin, escrita só por RPC com motivo e trilha.
--   2. RPCs: registrar_tarifa_contrato, encerrar_tarifa_contrato, corrigir_tarifa_contrato,
--      aposentar_tarifa_contrato (a tarifa JÁ USADA por apontamento não se corrige nem se apaga:
--      mudança comercial = nova versão), tarifa_contrato_na_data (leitura) e alterar_resolucao_tarifas.
--   3. `pricing_settings` (linha única): a chave da resolução, desligada por padrão.
--   4. `timesheet_entries.contract_rate_terms_id`: a versão de tarifa que precificou o lançamento.
--   5. `derivar_valores_por_vigencia` (corpo vigente: 036), SÓ com a resolução ligada: lê a tarifa pela
--      combinação (contrato + função snapshot + período snapshot + data trabalhada), grava o preço nos
--      snapshots existentes e recusa o lançamento se faltar snapshot ou tarifa (sem fallback, sem zero).
--      Operação sem contrato (valor acordado) segue a regra de antes. Núcleo V2, HE, sábado, custo,
--      componentes, competência e adicionais não mudam.
--   6. `estado_motor_vigencia` anuncia `tarifas_por_funcao` e `resolucao_tarifas`.
--
-- O QUE NÃO MUDA
--   gerar_fatura (a itemização por tarifa da 037 já separa dois preços), resumo, ajustes, leitores,
--   adicionais, derivar_valores_financeiros (motor antigo), faturas emitidas, apontamentos existentes.
--
-- REVERSÃO: docs/runbooks/rollback-tarifas-por-funcao.sql (recusa se existir tarifa, ligação a
-- apontamento ou resolução ligada).

begin;

-- ---------------------------------------------------------------------------
-- 1. Chave da resolução (linha única, desligada)
-- ---------------------------------------------------------------------------

create table public.pricing_settings (
  id                 boolean primary key default true,
  tarifas_por_funcao boolean not null default false,
  ativada_em         date,
  changed_at         timestamptz not null default now(),
  changed_by         uuid,
  reason             text,
  constraint pricing_settings_linha_unica check (id)
);
insert into public.pricing_settings (id) values (true);

create function public.proteger_pricing_settings()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'A chave das tarifas por função tem uma única linha e não é apagada.' using errcode = '42501';
end;
$$;
create trigger trg_pricing_settings_sem_delete before delete on public.pricing_settings
  for each row execute function public.proteger_pricing_settings();
create trigger trg_pricing_settings_sem_truncate before truncate on public.pricing_settings
  for each statement execute function public.proteger_pricing_settings();

alter table public.pricing_settings enable row level security;
create policy pricing_settings_leitura_admin on public.pricing_settings
  for select to authenticated using ((select public.has_role(auth.uid(), 'admin'::public.app_role)));
create policy pricing_settings_exige_mfa on public.pricing_settings
  as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()));
revoke all on table public.pricing_settings from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.pricing_settings to authenticated;

comment on table public.pricing_settings is
  'FIN-PR-07: chave da resolucao de preco por funcao e periodo (linha unica). Desligada por padrao; so alterar_resolucao_tarifas a muda.';

create function public.resolucao_de_tarifas_ativa()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((select p.tarifas_por_funcao from public.pricing_settings p where p.id), false)
     and public.motor_ativo();
$$;

-- ---------------------------------------------------------------------------
-- 2. Tarifas versionadas
-- ---------------------------------------------------------------------------

create table public.contract_rate_terms (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.contracts (id) on delete restrict,
  job_function_id uuid not null references public.job_functions (id) on delete restrict,
  shift_period    text not null,
  valid_from      date not null,
  valid_to        date,
  daily_rate      numeric(12,2) not null,
  active          boolean not null default true,
  origin          text not null,
  reason          text not null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  retired_at      timestamptz,
  replaced_by     uuid references public.contract_rate_terms (id),
  constraint contract_rate_terms_periodo_do_turno check (shift_period in ('diurno', 'noturno')),
  constraint contract_rate_terms_vigencia_valida check (valid_to is null or valid_to > valid_from),
  constraint contract_rate_terms_diaria_positiva check (daily_rate > 0),
  constraint contract_rate_terms_origem_valida check (origin in ('informada', 'correcao')),
  constraint contract_rate_terms_motivo_obrigatorio check (btrim(reason) <> ''),
  constraint contract_rate_terms_aposentadoria_coerente
    check ((active and retired_at is null and replaced_by is null) or (not active and retired_at is not null)),
  constraint contract_rate_terms_sem_sobreposicao
    exclude using gist (
      contract_id with =, job_function_id with =, shift_period with =,
      daterange(valid_from, valid_to, '[)') with &&
    ) where (active)
);

create index contract_rate_terms_busca_idx
  on public.contract_rate_terms (contract_id, job_function_id, shift_period, valid_from);

comment on table public.contract_rate_terms is
  'FIN-PR-07: tarifa comercial por contrato + funcao + periodo do turno + vigencia. Versionada e imutavel (so o ciclo de vida muda); nunca apagada; escrita so por RPC de admin com motivo e trilha. Nao e custo do colaborador.';

create trigger trg_contract_rate_terms_imutavel
  before update on public.contract_rate_terms
  for each row execute function public.proteger_versao_financeira();

create function public.bloquear_exclusao_de_tarifa()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Tarifa não é apagada: encerre ou aposente a versão.' using errcode = '42501';
end;
$$;
create trigger trg_contract_rate_terms_sem_delete before delete on public.contract_rate_terms
  for each row execute function public.bloquear_exclusao_de_tarifa();
create trigger trg_contract_rate_terms_sem_truncate before truncate on public.contract_rate_terms
  for each statement execute function public.bloquear_exclusao_de_tarifa();

alter table public.contract_rate_terms enable row level security;
create policy contract_rate_terms_leitura_admin on public.contract_rate_terms
  for select to authenticated using ((select public.has_role(auth.uid(), 'admin'::public.app_role)));
create policy contract_rate_terms_exige_mfa on public.contract_rate_terms
  as restrictive for select to authenticated using ((select public.mfa_cotidiano_ok()));
revoke all on table public.contract_rate_terms from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.contract_rate_terms to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trilha: novas ações
-- ---------------------------------------------------------------------------

alter table public.financial_terms_audit
  drop constraint financial_terms_audit_acao_valida,
  add constraint financial_terms_audit_acao_valida check (action in (
    'contrato_condicao_registrada',
    'contrato_condicao_corrigida',
    'contrato_condicao_encerrada',
    'contrato_condicao_aposentada',
    'colaborador_custo_registrado',
    'colaborador_custo_corrigido',
    'colaborador_custo_encerrado',
    'colaborador_custo_aposentado',
    'operacao_valor_registrado',
    'operacao_valor_corrigido',
    'operacao_valor_encerrado',
    'operacao_valor_aposentado',
    'motor_vigencia_ativado',
    'motor_vigencia_desativado',
    'colunas_legadas_sincronizadas',
    'apontamento_legado_regularizado',
    'adicional_registrado',
    'adicional_cancelado',
    'feriado_registrado',
    'feriado_aposentado',
    'apontamento_snapshots_corrigidos',
    'tarifa_registrada',
    'tarifa_corrigida',
    'tarifa_encerrada',
    'tarifa_aposentada',
    'tarifas_resolucao_ativada',
    'tarifas_resolucao_desativada'
  ));

-- ---------------------------------------------------------------------------
-- 4. Ligação do lançamento à tarifa que o precificou
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries
  add column contract_rate_terms_id uuid references public.contract_rate_terms (id);
create index timesheet_entries_tarifa_idx on public.timesheet_entries (contract_rate_terms_id)
  where contract_rate_terms_id is not null;
comment on column public.timesheet_entries.contract_rate_terms_id is
  'FIN-PR-07: versao de tarifa (contrato + funcao + periodo) que precificou o lancamento. Nulo = precificado pela diaria generica do contrato ou pelo valor acordado (resolucao desligada, anterior a 041 ou operacao sem contrato).';

-- Trava de colunas (corpo vigente: 040) + a ligação à tarifa
CREATE OR REPLACE FUNCTION public.bloquear_colunas_de_condicoes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
           or new.day_kind_snapshot is not null
           or new.billed_base_amount is not null
           or new.billed_overtime_amount is not null
           or new.billed_special_amount is not null
           or new.additional_amount is distinct from 0
           or new.calc_version is not null
           or new.job_function_id_snapshot is not null
           or new.shift_period_snapshot is not null
           or new.job_function_source is not null
           or new.contract_rate_terms_id is not null;
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
           or new.day_kind_snapshot is distinct from old.day_kind_snapshot
           or new.billed_base_amount is distinct from old.billed_base_amount
           or new.billed_overtime_amount is distinct from old.billed_overtime_amount
           or new.billed_special_amount is distinct from old.billed_special_amount
           or new.additional_amount is distinct from old.additional_amount
           or new.calc_version is distinct from old.calc_version
           or new.job_function_id_snapshot is distinct from old.job_function_id_snapshot
           or new.shift_period_snapshot is distinct from old.shift_period_snapshot
           or new.job_function_source is distinct from old.job_function_source
           or new.contract_rate_terms_id is distinct from old.contract_rate_terms_id;
  end if;

  if _mexeu then
    raise exception
      'As condições financeiras do apontamento são registradas pelo sistema e não podem ser gravadas diretamente.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. RPCs de tarifa
-- ---------------------------------------------------------------------------

create function public.registrar_tarifa_contrato(
  p_contract_id     uuid,
  p_job_function_id uuid,
  p_shift_period    text,
  p_valid_from      date,
  p_daily_rate      numeric,
  p_reason          text,
  p_valid_to        date    default null,
  p_encerrar_anterior boolean default false
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_aberta public.contract_rate_terms%rowtype;
  v_nova   public.contract_rate_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_contract_id is null or p_job_function_id is null or p_shift_period is null
     or p_valid_from is null or p_daily_rate is null then
    raise exception 'Contrato, função, período do turno, início da vigência e diária são obrigatórios.' using errcode = '22023';
  end if;
  if p_shift_period not in ('diurno', 'noturno') then
    raise exception 'O período do turno deve ser diurno ou noturno.' using errcode = '22023';
  end if;
  if p_daily_rate <= 0 or p_daily_rate <> round(p_daily_rate, 2) then
    raise exception 'A diária da tarifa deve ser maior que zero e ter no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contracts where id = p_contract_id) then
    raise exception 'Contrato não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.job_functions f where f.id = p_job_function_id and f.active) then
    raise exception 'A função não existe ou está inativa.' using errcode = '22023';
  end if;

  -- A mesma trava das versões de contrato e da leitura do motor (compartilhada): registrar uma
  -- tarifa não corre junto de um apontamento do contrato.
  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || p_contract_id::text, 0));

  if coalesce(p_encerrar_anterior, false) then
    select * into v_aberta from public.contract_rate_terms r
     where r.contract_id = p_contract_id and r.job_function_id = p_job_function_id
       and r.shift_period = p_shift_period and r.active and r.valid_to is null
       for update;
    if found and v_aberta.valid_from < p_valid_from then
      perform public.encerrar_tarifa_interna(v_aberta.id, p_valid_from, v_motivo);
    end if;
  end if;

  begin
    insert into public.contract_rate_terms
      (contract_id, job_function_id, shift_period, valid_from, valid_to, daily_rate, origin, reason, created_by)
    values
      (p_contract_id, p_job_function_id, p_shift_period, p_valid_from, p_valid_to, p_daily_rate, 'informada', v_motivo, auth.uid())
    returning * into v_nova;
  exception when exclusion_violation then
    raise exception 'A vigência informada se sobrepõe a outra tarifa ativa desta função e período no contrato.'
      using errcode = '23P01',
            hint = 'Encerre a tarifa anterior, informe a data final ou use p_encerrar_anterior.';
  end;

  perform public.condicoes_auditar('tarifa_registrada', 'contrato', p_contract_id, v_nova.id, null,
    to_jsonb(v_nova) || jsonb_build_object('retroativa', p_valid_from < (now() at time zone 'America/Sao_Paulo')::date), v_motivo);
  return v_nova.id;
end;
$$;

create function public.encerrar_tarifa_interna(p_rate_id uuid, p_valid_to date, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ant public.contract_rate_terms%rowtype;
  v_dep public.contract_rate_terms%rowtype;
begin
  select * into v_ant from public.contract_rate_terms where id = p_rate_id for update;
  if not found then
    raise exception 'Tarifa não encontrada.' using errcode = 'P0002';
  end if;
  if not v_ant.active then
    raise exception 'A tarifa está aposentada e não pode ser encerrada.' using errcode = '55000';
  end if;
  if p_valid_to <= v_ant.valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência (%).', v_ant.valid_from using errcode = '22023';
  end if;
  if v_ant.valid_to is not null and p_valid_to >= v_ant.valid_to then
    raise exception 'A data final só pode ser antecipada (atual: %).', v_ant.valid_to using errcode = '22023';
  end if;
  if exists (select 1 from public.timesheet_entries te where te.contract_rate_terms_id = p_rate_id and te.work_date >= p_valid_to) then
    raise exception 'Há apontamentos que usam esta tarifa em datas a partir de %; o encerramento os deixaria sem cobertura.', p_valid_to
      using errcode = '55000';
  end if;
  update public.contract_rate_terms set valid_to = p_valid_to where id = p_rate_id returning * into v_dep;
  perform public.condicoes_auditar('tarifa_encerrada', 'contrato', v_dep.contract_id, p_rate_id,
    to_jsonb(v_ant), to_jsonb(v_dep), p_reason);
end;
$$;

create function public.encerrar_tarifa_contrato(p_rate_id uuid, p_valid_to date, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_contrato uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_rate_id is null or p_valid_to is null then
    raise exception 'Tarifa e data final são obrigatórias.' using errcode = '22023';
  end if;
  select contract_id into v_contrato from public.contract_rate_terms where id = p_rate_id;
  if not found then
    raise exception 'Tarifa não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || v_contrato::text, 0));
  perform public.encerrar_tarifa_interna(p_rate_id, p_valid_to, v_motivo);
end;
$$;

-- Corrige uma tarifa AINDA NÃO USADA (valor, datas). Tarifa usada por apontamento nunca é editada:
-- a mudança comercial é uma versão nova (encerrar + registrar), para o preço histórico não se mover.
create function public.corrigir_tarifa_contrato(
  p_rate_id    uuid,
  p_valid_from date,
  p_valid_to   date,
  p_daily_rate numeric,
  p_reason     text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_ant    public.contract_rate_terms%rowtype;
  v_nova   public.contract_rate_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_rate_id is null or p_valid_from is null or p_daily_rate is null then
    raise exception 'Tarifa, início da vigência e diária são obrigatórios.' using errcode = '22023';
  end if;
  if p_daily_rate <= 0 or p_daily_rate <> round(p_daily_rate, 2) then
    raise exception 'A diária da tarifa deve ser maior que zero e ter no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;

  select * into v_ant from public.contract_rate_terms where id = p_rate_id;
  if not found then
    raise exception 'Tarifa não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || v_ant.contract_id::text, 0));
  select * into v_ant from public.contract_rate_terms where id = p_rate_id for update;
  if not v_ant.active then
    raise exception 'Só uma tarifa ativa pode ser corrigida.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries te where te.contract_rate_terms_id = p_rate_id) then
    raise exception 'Esta tarifa já precificou apontamentos e não se edita: registre uma versão nova (encerre esta e cadastre a seguinte).'
      using errcode = '55000';
  end if;

  update public.contract_rate_terms set active = false, retired_at = now() where id = p_rate_id;
  begin
    insert into public.contract_rate_terms
      (contract_id, job_function_id, shift_period, valid_from, valid_to, daily_rate, origin, reason, created_by)
    values
      (v_ant.contract_id, v_ant.job_function_id, v_ant.shift_period, p_valid_from, p_valid_to, p_daily_rate, 'correcao', v_motivo, auth.uid())
    returning * into v_nova;
  exception when exclusion_violation then
    raise exception 'A vigência corrigida se sobrepõe a outra tarifa ativa desta função e período.' using errcode = '23P01';
  end;
  update public.contract_rate_terms set replaced_by = v_nova.id where id = p_rate_id;

  perform public.condicoes_auditar('tarifa_corrigida', 'contrato', v_ant.contract_id, v_nova.id,
    to_jsonb(v_ant), to_jsonb(v_nova) || jsonb_build_object('substitui', p_rate_id), v_motivo);
  return v_nova.id;
end;
$$;

create function public.aposentar_tarifa_contrato(p_rate_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_ant public.contract_rate_terms%rowtype;
  v_dep public.contract_rate_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  select * into v_ant from public.contract_rate_terms where id = p_rate_id;
  if not found then
    raise exception 'Tarifa não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || v_ant.contract_id::text, 0));
  select * into v_ant from public.contract_rate_terms where id = p_rate_id for update;
  if not v_ant.active then
    raise exception 'A tarifa já está aposentada.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries te where te.contract_rate_terms_id = p_rate_id) then
    raise exception 'Esta tarifa já precificou apontamentos e não se aposenta: encerre a vigência.' using errcode = '55000';
  end if;
  update public.contract_rate_terms set active = false, retired_at = now() where id = p_rate_id returning * into v_dep;
  perform public.condicoes_auditar('tarifa_aposentada', 'contrato', v_ant.contract_id, p_rate_id,
    to_jsonb(v_ant), to_jsonb(v_dep), v_motivo);
end;
$$;

-- Leitura: a tarifa de uma combinação numa data (nenhuma, se não houver).
create function public.tarifa_contrato_na_data(
  p_contract_id uuid, p_job_function_id uuid, p_shift_period text, p_data date
) returns table (id uuid, daily_rate numeric, valid_from date, valid_to date)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.condicoes_exigir_admin_leitura();
  return query
    select r.id, r.daily_rate, r.valid_from, r.valid_to from public.contract_rate_terms r
     where r.contract_id = p_contract_id and r.job_function_id = p_job_function_id
       and r.shift_period = p_shift_period and r.active
       and daterange(r.valid_from, r.valid_to, '[)') @> p_data;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Ativação controlada
-- ---------------------------------------------------------------------------

create function public.alterar_resolucao_tarifas(
  p_ativar boolean,
  p_reason text,
  p_aceitar_contratos_sem_tarifa boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_ant    public.pricing_settings%rowtype;
  v_dep    public.pricing_settings%rowtype;
  v_sem    integer := 0;
  v_id     constant uuid := '00000000-0000-4000-8000-000000000041';
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_ativar is null then
    raise exception 'Informe se a resolução por função e período deve ser ligada ou desligada.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('motor_vigencia', 0));
  select * into v_ant from public.pricing_settings where id for update;
  if v_ant.tarifas_por_funcao = p_ativar then
    raise exception '%', case when p_ativar then 'A resolução por função e período já está ligada.' else 'A resolução por função e período já está desligada.' end
      using errcode = '55000';
  end if;

  if p_ativar then
    if not public.motor_ativo() then
      raise exception 'Ligue o motor por vigência antes de ligar a resolução por função e período.' using errcode = '55000';
    end if;
    if not exists (select 1 from public.contract_rate_terms where active) then
      raise exception 'Não há nenhuma tarifa cadastrada: ligar recusaria todo apontamento de contrato.' using errcode = '55000';
    end if;
    -- Contratos com operação ativa e nenhuma tarifa: seus apontamentos seriam recusados.
    select count(*) into v_sem
      from public.contracts c
     where exists (select 1 from public.operations o where o.contract_id = c.id and o.status = 'active')
       and not exists (select 1 from public.contract_rate_terms r where r.contract_id = c.id and r.active);
    if v_sem > 0 and not coalesce(p_aceitar_contratos_sem_tarifa, false) then
      raise exception 'Há % contrato(s) com operação ativa e nenhuma tarifa; os apontamentos deles seriam recusados.', v_sem
        using errcode = '55000',
              hint = 'Cadastre as tarifas ou ligue com p_aceitar_contratos_sem_tarifa = true.';
    end if;
    update public.pricing_settings
       set tarifas_por_funcao = true, ativada_em = (now() at time zone 'America/Sao_Paulo')::date,
           changed_at = now(), changed_by = auth.uid(), reason = v_motivo
     where id returning * into v_dep;
  else
    update public.pricing_settings
       set tarifas_por_funcao = false, changed_at = now(), changed_by = auth.uid(), reason = v_motivo
     where id returning * into v_dep;
  end if;

  perform public.condicoes_auditar(
    case when p_ativar then 'tarifas_resolucao_ativada' else 'tarifas_resolucao_desativada' end,
    'sistema', v_id, v_id, to_jsonb(v_ant),
    to_jsonb(v_dep) || jsonb_build_object('contratos_sem_tarifa', v_sem, 'aceitou', coalesce(p_aceitar_contratos_sem_tarifa, false)),
    v_motivo);
  return jsonb_build_object('ativa', v_dep.tarifas_por_funcao, 'ativada_em', v_dep.ativada_em, 'contratos_sem_tarifa', v_sem);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Motor por vigência (corpo vigente: 036) com a resolução condicionada
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derivar_valores_por_vigencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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

  -- FIN-PR-02: núcleo V2 (dia útil e sábado) e componentes persistidos
  _legado030     boolean;
  _n             record;

  -- FIN-PR-07: tarifa comercial por contrato + função + período do turno + data trabalhada
  _res           boolean := false;
  _tar           record;
  _cid           uuid;
  _calc_version  smallint := null;
  _c_base        numeric := null;
  _c_ot          numeric := null;
  _c_special     numeric := null;
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
      or new.timesheet_id  is distinct from old.timesheet_id
      -- FIN-PR-07: a função ou o período corrigidos são motivo de recálculo (só têm efeito no preço
      -- com a resolução ligada; desligada, o recálculo reproduz o valor congelado).
      or new.job_function_id_snapshot is distinct from old.job_function_id_snapshot
      or new.shift_period_snapshot    is distinct from old.shift_period_snapshot;

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
      new.billed_base_amount      := old.billed_base_amount;
      new.billed_overtime_amount  := old.billed_overtime_amount;
      new.billed_special_amount   := old.billed_special_amount;
      new.additional_amount       := old.additional_amount;
      new.calc_version            := old.calc_version;
      new.contract_rate_terms_id  := old.contract_rate_terms_id;
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
      new.contract_rate_terms_id  := null;
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
      new.contract_rate_terms_id  := old.contract_rate_terms_id;
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
    -- V2: a falta é zero em todos os componentes (a identidade fecha).
    new.billed_base_amount      := 0;
    new.billed_overtime_amount  := 0;
    new.billed_special_amount   := 0;
    new.additional_amount       := 0;
    new.calc_version            := 2;
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

  _res := public.resolucao_de_tarifas_ativa();
  _precificar := case
    when tg_op = 'INSERT' then true
    else new.timesheet_id is distinct from old.timesheet_id or old.status = 'absent'
      -- Correção de função/período num apontamento já precificado por contrato: com a resolução
      -- ligada o preço é resolvido de novo pela tarifa da combinação corrigida.
      or (_res and old.terms_origin = 'versao'
          and (new.job_function_id_snapshot is distinct from old.job_function_id_snapshot
               or new.shift_period_snapshot is distinct from old.shift_period_snapshot))
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

    -- FIN-PR-07: com a resolução ligada, o preço de contrato vem da TARIFA da combinação função +
    -- período (snapshots do lançamento) na data trabalhada. Nunca há fallback para a diária genérica
    -- nem para o cadastro de hoje: faltando snapshot ou tarifa, o lançamento é recusado. Operação
    -- sem contrato (valor acordado) segue a regra de antes.
    new.contract_rate_terms_id := null;
    if _res and _origem = 'versao' then
      if new.job_function_id_snapshot is null then
        raise exception 'Apontamento pendente de classificação: sem função trabalhada, a tarifa por função não pode ser aplicada em %.', _work_date
          using errcode = '55000',
                hint = 'Informe a função na alocação ou no apontamento (ou corrija-a com corrigir_snapshots_do_apontamento).';
      end if;
      if new.shift_period_snapshot is null then
        raise exception 'Apontamento pendente de classificação: o turno desta folha não tem período diurno/noturno.'
          using errcode = '55000',
                hint = 'Classifique o turno no cadastro e regularize o período do apontamento.';
      end if;
      select ct.contract_id into _cid from public.contract_terms ct where ct.id = _fonte.o_contract_terms_id;
      select * into _tar from public.contract_rate_terms r
       where r.contract_id = _cid and r.job_function_id = new.job_function_id_snapshot
         and r.shift_period = new.shift_period_snapshot and r.active
         and daterange(r.valid_from, r.valid_to, '[)') @> _work_date
         for share;
      if not found then
        raise exception 'Sem tarifa vigente em % para a função e o período do turno deste apontamento no contrato.', _work_date
          using errcode = 'P0002',
                hint = 'Cadastre a tarifa (função + período + vigência) no contrato antes de apontar; não há fallback para a diária genérica.';
      end if;
      _daily_rate := _tar.daily_rate;
      new.contract_rate_terms_id := _tar.id;
    end if;

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

  -- FIN-PR-02. Domingo e feriado FICAM FORA da V2 e seguem EXATAMENTE a 030 (a V2 deles entra no
  -- PR 09, depois de os leitores migrarem para os componentes). O domingo é "util" para
  -- `motor_tipo_do_dia` e continua sendo; aqui ele é separado só para a escolha do cálculo.
  _legado030 := _dia = 'feriado' or extract(isodow from _work_date) = 7;

  if _legado030 then
    -- 030, sem alteração -------------------------------------------------------------------------
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

    _calc_version := null;
    _c_base := null;
    _c_ot := null;
    _c_special := null;
  else
    -- Núcleo V2 (035): jornada de 8 h líquidas, divisor 8, HE diária 15/45, sábado de 4 h.
    -- Custo-hora acordado ausente: custo diário ÷ 8, sem fator (decidido pelo núcleo).
    _ot_hour_rate := round((_daily_rate::numeric / 8) * round(_ot_factor_efetivo::numeric, 2), 2)::double precision;
    select * into _n
      from public.nucleo_componentes_v2(
        new.status::text,
        _dia,
        new.check_in,
        new.check_out,
        coalesce(new.break_minutes, 0),
        round(_daily_rate::numeric * 100)::bigint,
        round(round(_ot_factor_efetivo::numeric, 2) * 100)::integer,
        200,
        round(coalesce(_ot_tolerance_min, 0))::integer,
        _modo,
        'minutos',
        0,
        round(_daily_cost::numeric * 100)::bigint,
        case when _ot_hourly is not null then round(_ot_hourly * 100)::bigint end);

    _worked        := _n.minutos_trabalhados;
    _overtime      := _n.he_minutos_pagos;
    _ot_cob        := _n.he_minutos_cobrados;
    _billed        := _n.total_centavos::numeric / 100;
    _cost          := _n.custo_total_centavos::numeric / 100;
    _c_base        := _n.base_centavos::numeric / 100;
    _c_ot          := _n.he_centavos::numeric / 100;
    _c_special     := _n.especial_centavos::numeric / 100;
    _calc_version  := 2;
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
  new.billed_base_amount      := _c_base;
  new.billed_overtime_amount  := _c_ot;
  new.billed_special_amount   := _c_special;
  new.additional_amount       := 0;
  new.calc_version            := _calc_version;

  new.terms_origin           := _origem;
  new.contract_terms_id      := _contract_terms_id;
  new.operation_terms_id     := _operation_terms_id;
  new.employee_cost_terms_id := _employee_terms_id;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Estado do motor (corpo vigente: 040) + a capacidade
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
    'periodo_contratual', true,
    -- FIN-PR-06 (039): catálogo de funções, função do colaborador e da alocação, período do turno.
    'funcoes_turno', true,
    -- FIN-PR-07 (040): função e período do turno gravados por apontamento (snapshots protegidos).
    'snapshots_funcao_periodo', true,
    -- FIN-PR-07 (041): tarifas por contrato + função + período; `resolucao_tarifas` = ligada E motor ligado.
    'tarifas_por_funcao', true,
    'resolucao_tarifas', public.resolucao_de_tarifas_ativa());
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
       and p.proname in ('proteger_pricing_settings', 'resolucao_de_tarifas_ativa', 'bloquear_exclusao_de_tarifa',
                         'registrar_tarifa_contrato', 'encerrar_tarifa_interna', 'encerrar_tarifa_contrato',
                         'corrigir_tarifa_contrato', 'aposentar_tarifa_contrato', 'tarifa_contrato_na_data',
                         'alterar_resolucao_tarifas')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('registrar_tarifa_contrato', 'encerrar_tarifa_contrato', 'corrigir_tarifa_contrato',
                   'aposentar_tarifa_contrato', 'tarifa_contrato_na_data', 'alterar_resolucao_tarifas') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.registrar_tarifa_contrato(uuid, uuid, text, date, numeric, text, date, boolean) is
  'Admin. Registra tarifa (contrato + funcao + periodo + vigencia + diaria) com motivo e trilha. Recusa sobreposicao.';
comment on function public.alterar_resolucao_tarifas(boolean, text, boolean) is
  'Admin. Liga/desliga a resolucao de preco por funcao e periodo (desligada por padrao). Ligar exige o motor por vigencia ligado e ao menos uma tarifa.';

-- ---------------------------------------------------------------------------
-- 10. Autoverificação
-- ---------------------------------------------------------------------------

do $verificacao$
begin
  if public.resolucao_de_tarifas_ativa() then
    raise exception '041: a resolução de tarifas deve nascer desligada.';
  end if;
  if exists (select 1 from public.timesheet_entries where contract_rate_terms_id is not null) then
    raise exception '041: nenhum apontamento existente deveria ter tarifa ligada.';
  end if;
  if has_table_privilege('authenticated', 'public.contract_rate_terms', 'INSERT')
     or has_table_privilege('authenticated', 'public.contract_rate_terms', 'UPDATE')
     or has_table_privilege('authenticated', 'public.contract_rate_terms', 'DELETE')
     or has_table_privilege('anon', 'public.contract_rate_terms', 'SELECT')
     or has_table_privilege('bslog_rpc_operacional', 'public.contract_rate_terms', 'SELECT')
     or has_table_privilege('authenticated', 'public.pricing_settings', 'UPDATE') then
    raise exception '041: tarifas e chave só se leem (admin) e só se escrevem por RPC.';
  end if;
  if has_function_privilege('authenticated', 'public.resolucao_de_tarifas_ativa()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.encerrar_tarifa_interna(uuid, date, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.registrar_tarifa_contrato(uuid, uuid, text, date, numeric, text, date, boolean)', 'EXECUTE') then
    raise exception '041: funções internas não são expostas e nada é exposto a anon.';
  end if;
end;
$verificacao$;

commit;
