-- REVERSÃO da migration 20261109120000_042_diaria_individual_e_bonus (FIN-PR-08).
--
-- Devolve derivar_valores_por_vigencia, a trava de colunas e estado_motor_vigencia aos corpos vigentes
-- antes da 042 (os da 041) e remove a diária individual, a fonte do preço no lançamento e o adicional
-- diário (as RPCs). NÃO toca: 035 a 041, tarifas por função e período, snapshots, fatura, RLS e
-- grants existentes.
--
-- REVERTER CÓDIGO, FUNÇÕES E DADOS SÃO COISAS DIFERENTES
--   * código: reverter o deploy do app (ele detecta `diaria_individual` e `bonus_diario`);
--   * funções: este script;
--   * dados: diária individual, a ligação de um lançamento a ela e o adicional diário gravado são
--     DADO FINANCEIRO. A reversão RECUSA se (a) existir qualquer diária individual, (b) algum
--     apontamento apontar para uma diária individual, (c) algum apontamento tiver adicional diário
--     maior que zero ou (d) houver trilha da 042. Em outras palavras: só se desfaz uma 042 que nunca
--     foi usada. Depois de usada, a decisão é de negócio, não de rollback.
--   * `price_source = 'funcao_periodo'` nasce da 042, mas é derivável de `contract_rate_terms_id`
--     (041, preservado): sua remoção não perde informação.
--
-- Executar só com autorização, como `postgres`, em uma transação.

begin;

do $pre$
begin
  if exists (select 1 from public.contract_employee_rates) then
    raise exception 'Reversão recusada: há diárias individuais cadastradas.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries where contract_employee_rate_id is not null or price_source = 'individual') then
    raise exception 'Reversão recusada: há apontamentos precificados por diária individual.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries where additional_amount > 0) then
    raise exception 'Reversão recusada: há apontamentos com adicional diário.' using errcode = '55000';
  end if;
  if exists (select 1 from public.financial_terms_audit where action like 'diaria_individual%' or action = 'apontamento_bonus_definido') then
    raise exception 'Reversão recusada: há trilha de diária individual ou de adicional diário.' using errcode = '55000';
  end if;
end;
$pre$;

-- Corpos vigentes antes da 042 (a mesma assinatura: privilégios preservados)
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

-- Estruturas da 042 (nada as referencia depois dos corpos acima)
alter table public.timesheet_entries
  drop constraint timesheet_entries_fonte_do_preco_coerente,
  drop constraint timesheet_entries_fonte_do_preco_valida;
drop index public.timesheet_entries_diaria_individual_idx;
alter table public.timesheet_entries
  drop column contract_employee_rate_id,
  drop column price_source;

drop function public.definir_bonus_do_apontamento(uuid, numeric, text, boolean);
drop function public.diaria_individual_na_data(uuid, uuid, date);
drop function public.aposentar_diaria_individual(uuid, text);
drop function public.corrigir_diaria_individual(uuid, date, date, numeric, text);
drop function public.encerrar_diaria_individual(uuid, date, text);
drop function public.encerrar_diaria_individual_interna(uuid, date, text);
drop function public.registrar_diaria_individual(uuid, uuid, date, numeric, text, date, boolean);

drop table public.contract_employee_rates;
drop function public.bloquear_exclusao_de_diaria_individual();

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

do $verificacao$
begin
  if to_regclass('public.contract_employee_rates') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_entries'
                 and column_name in ('contract_employee_rate_id', 'price_source')) then
    raise exception 'Reversão da 042 incompleta.';
  end if;
  if pg_get_functiondef('public.estado_motor_vigencia()'::regprocedure) like '%diaria_individual%' then
    raise exception 'Reversão da 042: estado_motor_vigencia ainda anuncia a diária individual.';
  end if;
end;
$verificacao$;

commit;
