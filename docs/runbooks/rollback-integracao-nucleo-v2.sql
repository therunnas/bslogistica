-- REVERSÃO da migration 20261103120000_036_integracao_nucleo_v2 (FIN-PR-02).
--
-- Desliga o núcleo V2 do motor e devolve ao banco o cálculo da 030 para dia útil e sábado, SEM tocar
-- na 035 (as funções `nucleo_*` continuam, sem uso) nem em nada que veio depois da 030.
--
-- O QUE ESTE SCRIPT RECRIA, com o corpo VIGENTE antes da 036 (nunca uma versão mais antiga):
--   * derivar_valores_por_vigencia  <- migration 030 (não foi redefinida depois)
--   * bloquear_colunas_de_condicoes <- migration 030 (idem)
--   * estado_motor_vigencia         <- migration 032 (traz condicoes_exigir_admin_leitura e o MFA opcional)
-- NÃO toca: autenticação, MFA (mfa_cotidiano_ok, condicoes_exigir_admin), guards administrativos, RLS,
-- policies, grants, gatilhos 031 e 033, proteções de histórico, gerar_fatura, os leitores.
--
-- REVERTER CÓDIGO, SCHEMA E DADOS SÃO COISAS DIFERENTES
--   * código: reverter o deploy do app (a prévia volta ao calcEntry quando o banco deixa de anunciar `nucleo_v2`);
--   * schema: este script;
--   * dados: lançamentos já gravados pela V2 NÃO são recalculados nem apagados. Por isso a reversão
--     RECUSA se houver lançamento de presença/reposição com calc_version = 2: reverter a regra com esses
--     valores no banco exige decisão própria (corrigir com motivo, ou restaurar backup), nunca um
--     `DROP` ou uma restauração destrutiva como atalho. Lançamentos de FALTA (tudo zero) são
--     neutralizados (voltam ao estado legado), o que não muda nenhum valor.
--
-- PRÉ-CONDIÇÃO verificada abaixo, dentro da transação. Executar só com autorização, como `postgres`.

begin;

do $pre$
declare
  _v2 integer;
begin
  select count(*) into _v2 from public.timesheet_entries
   where calc_version is not null and status <> 'absent';
  if _v2 > 0 then
    raise exception 'Reversão recusada: % lançamento(s) de presença/reposição já calculado(s) pela V2 (calc_version = 2). Os valores não são recalculados nem apagados.', _v2
      using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries where additional_amount <> 0) then
    raise exception 'Reversão recusada: há adicional diferente de zero (não existe nesta etapa).'
      using errcode = '55000';
  end if;
end;
$pre$;

-- Faltas gravadas pela V2 (zeros) voltam a legado. Folha fechada recusa a escrita (55000): reabra e repita.
update public.timesheet_entries
   set billed_base_amount = null, billed_overtime_amount = null, billed_special_amount = null, calc_version = null
 where calc_version is not null and status = 'absent';

-- ---------------------------------------------------------------------------
-- Funções: corpo vigente antes da 036
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

comment on function public.derivar_valores_por_vigencia() is
  'Trigger do motor por vigencia (habilitado so com a chave ligada). Fixa precos da data trabalhada na primeira derivacao e recalcula so quantidades depois. Sem versao vigente: P0002, sem fallback para a taxa atual.';

-- ---------------------------------------------------------------------------
-- Schema: as colunas e as constraints só caem agora que não guardam dado nenhum
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries
  drop constraint timesheet_entries_componentes_coerentes,
  drop constraint timesheet_entries_adicional_nao_negativo,
  drop constraint timesheet_entries_calc_version_valida,
  drop column calc_version,
  drop column additional_amount,
  drop column billed_special_amount,
  drop column billed_overtime_amount,
  drop column billed_base_amount;

do $pos$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'timesheet_entries'
                and column_name in ('billed_base_amount', 'billed_overtime_amount', 'billed_special_amount',
                                    'additional_amount', 'calc_version')) then
    raise exception 'Reversão incompleta: ainda há colunas da 036.';
  end if;
  if (select prosrc from pg_proc where proname = 'derivar_valores_por_vigencia' and pronamespace = 'public'::regnamespace) ~ 'nucleo_' then
    raise exception 'Reversão incompleta: a derivação ainda chama o núcleo.';
  end if;
end;
$pos$;

-- Conferir antes de confirmar. Para desfazer o ensaio: rollback.
commit;
