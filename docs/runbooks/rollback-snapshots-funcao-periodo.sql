-- REVERSÃO da migration 20261107120000_040_snapshots_funcao_periodo (FIN-PR-07, etapa 2).
--
-- Devolve a trava de colunas, salvar_apontamento_admin e estado_motor_vigencia aos corpos vigentes
-- antes da 040 (030/036, 030 e 039) e remove os snapshots de função e período do apontamento.
-- NÃO toca: cálculo, fatura, 035 a 039, RLS, grants.
--
-- REVERTER CÓDIGO, FUNÇÕES E DADOS SÃO COISAS DIFERENTES
--   * código: reverter o deploy do app (ele detecta a capacidade `snapshots_funcao_periodo`);
--   * funções: este script;
--   * dados: os snapshots são DADO FINANCEIRO (a função e o período em que cada serviço foi
--     prestado). A reversão RECUSA se qualquer apontamento tiver snapshot, ou se existir correção
--     auditada de snapshot: remover as colunas apagaria o histórico que sustenta o preço.
--
-- Executar só com autorização, como `postgres`, em uma transação.

begin;

do $pre$
begin
  if exists (select 1 from public.timesheet_entries
              where job_function_id_snapshot is not null or shift_period_snapshot is not null
                 or job_function_source is not null) then
    raise exception 'Reversão recusada: há apontamentos com snapshot de função ou período.' using errcode = '55000';
  end if;
  if exists (select 1 from public.financial_terms_audit where action = 'apontamento_snapshots_corrigidos') then
    raise exception 'Reversão recusada: há correção auditada de snapshot na trilha.' using errcode = '55000';
  end if;
end;
$pre$;

drop trigger trg_timesheet_entries_bz_snapshots_funcao_periodo on public.timesheet_entries;
drop function public.capturar_snapshots_funcao_periodo();
drop function public.corrigir_snapshots_do_apontamento(uuid, uuid, boolean, text);

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
           or new.calc_version is not null;
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
           or new.calc_version is distinct from old.calc_version;
  end if;

  if _mexeu then
    raise exception
      'As condições financeiras do apontamento são registradas pelo sistema e não podem ser gravadas diretamente.'
      using errcode = '42501';
  end if;

  return new;
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
    'funcoes_turno', true);
end;
$function$;

alter table public.timesheet_entries
  drop constraint timesheet_entries_funcao_com_origem,
  drop constraint timesheet_entries_funcao_origem_valida,
  drop constraint timesheet_entries_periodo_snapshot_valido;
drop index public.timesheet_entries_funcao_snapshot_idx;
alter table public.timesheet_entries
  drop column job_function_id_snapshot,
  drop column shift_period_snapshot,
  drop column job_function_source;

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
    'feriado_aposentado'
  ));

do $pos$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_entries'
              and column_name in ('job_function_id_snapshot', 'shift_period_snapshot', 'job_function_source')) then
    raise exception 'Reversão incompleta: colunas da 040 ainda existem.';
  end if;
end;
$pos$;

-- Conferir antes de confirmar. Para desfazer o ensaio: rollback.
commit;
