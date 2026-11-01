-- Snapshots de função e período do turno por apontamento (FIN-PR-07, etapa 2). SOMENTE LOCAL até autorização.
--
-- Depende da 039. É a PRIMEIRA metade do FIN-PR-07: guardar, no lançamento, a função EFETIVAMENTE
-- trabalhada e o período do turno daquele dia, e protegê-los, ANTES de qualquer tarifa existir
-- (a tabela de tarifas e a resolução de preço vêm na migration seguinte). NENHUM VALOR MUDA: o
-- cálculo (derivar_valores_*, núcleo V2), a fatura e o Fechamento não conhecem estas colunas.
--
-- O QUE MUDA
--   1. `timesheet_entries.job_function_id_snapshot`, `.shift_period_snapshot`, `.job_function_source`
--      ('alocacao' = veio da alocação; 'informada' = informada no salvamento do admin;
--      'corrigida' = corrigida depois, com motivo e trilha). Nulos em todo apontamento existente:
--      nada é reconstruído a partir do cadastro de hoje.
--   2. Gatilho `trg_timesheet_entries_bz_snapshots_funcao_periodo` (depois da trava de colunas,
--      antes dos cálculos): grava os snapshots NO BANCO. Período = classificação do turno da folha
--      no momento do lançamento (nunca inferida do horário; turno sem classificação = nulo). Função
--      = a informada pelo admin no salvamento ou, sem ela, a da alocação ativa do colaborador na
--      operação; sem informação confiável fica NULA (a função padrão do colaborador é só sugestão
--      de tela). Falta não tem snapshot.
--   3. `bloquear_colunas_de_condicoes` passa a recusar escrita direta nas três colunas (PostgREST
--      incluído): só o gatilho e a RPC de correção as gravam. Depois do vínculo com a fatura
--      `bloquear_edicao_faturada` já recusa QUALQUER coluna, inclusive estas.
--   4. `corrigir_snapshots_do_apontamento`: único fluxo de correção de apontamento NÃO faturado
--      (admin, motivo, trava do cliente = a mesma de gerar_fatura, linha travada, trilha).
--   5. `salvar_apontamento_admin`: linha NOVA aceita `job_function_id` (confere a função). Linha
--      existente não muda por aqui. O operacional não informa função (vale a da alocação).
--   6. `estado_motor_vigencia` anuncia `snapshots_funcao_periodo`.
--
-- O QUE NÃO MUDA
--   derivar_valores_financeiros, derivar_valores_por_vigencia, o núcleo V2, gerar_fatura, resumo,
--   ajustes, leitores, competência (038), RLS e grants das tabelas existentes, faturas emitidas.
--
-- REVERSÃO: docs/runbooks/rollback-snapshots-funcao-periodo.sql (recusa se algum snapshot existir).

begin;

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries
  add column job_function_id_snapshot uuid references public.job_functions (id) on delete restrict,
  add column shift_period_snapshot    text,
  add column job_function_source      text,
  add constraint timesheet_entries_periodo_snapshot_valido
    check (shift_period_snapshot is null or shift_period_snapshot in ('diurno', 'noturno')),
  add constraint timesheet_entries_funcao_origem_valida
    check (job_function_source is null or job_function_source in ('alocacao', 'informada', 'corrigida')),
  add constraint timesheet_entries_funcao_com_origem
    check ((job_function_id_snapshot is null) = (job_function_source is null));

create index timesheet_entries_funcao_snapshot_idx
  on public.timesheet_entries (job_function_id_snapshot) where job_function_id_snapshot is not null;

comment on column public.timesheet_entries.job_function_id_snapshot is
  'FIN-PR-07: funcao EFETIVAMENTE trabalhada no lancamento (alocacao, informada ou corrigida). Nulo = sem informacao confiavel (nunca inventada) ou apontamento anterior a 040. Imutavel apos a fatura; so o gatilho e corrigir_snapshots_do_apontamento a gravam.';
comment on column public.timesheet_entries.shift_period_snapshot is
  'FIN-PR-07: periodo do turno (diurno/noturno) da folha NO MOMENTO do lancamento. Nulo = turno sem classificacao ou apontamento anterior a 040. Nao e inferido do horario.';
comment on column public.timesheet_entries.job_function_source is
  'FIN-PR-07: origem do snapshot de funcao: alocacao, informada (salvamento do admin) ou corrigida (RPC auditada).';

-- ---------------------------------------------------------------------------
-- 2. Trilha: nova ação
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
    'apontamento_snapshots_corrigidos'
  ));

-- ---------------------------------------------------------------------------
-- 3. Trava de colunas (corpo vigente: 036) + as três colunas novas
-- ---------------------------------------------------------------------------

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
           or new.job_function_source is not null;
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
           or new.job_function_source is distinct from old.job_function_source;
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
-- 4. Captura dos snapshots (gatilho próprio: o motor não é tocado)
-- ---------------------------------------------------------------------------

create function public.capturar_snapshots_funcao_periodo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _op        uuid;
  _shift     uuid;
  _in        uuid;
  _aloc      uuid;
  _recaptura boolean;
begin
  -- INSERT ... ON CONFLICT DO UPDATE dispara este BEFORE INSERT mesmo quando o resultado é UPDATE:
  -- a linha que já existe é tratada na fase de UPDATE.
  if tg_op = 'INSERT' then
    if exists (select 1 from public.timesheet_entries e where e.id = new.id)
       or exists (select 1 from public.timesheet_entries e
                   where e.timesheet_id = new.timesheet_id and e.employee_id = new.employee_id) then
      return new;
    end if;
    _recaptura := true;
  else
    _recaptura := new.timesheet_id is distinct from old.timesheet_id
               or new.employee_id is distinct from old.employee_id
               or (old.status = 'absent' and new.status <> 'absent');
  end if;

  -- Falta: nada trabalhado, nada a congelar (e ao virar falta o gravado fica como estava).
  if new.status = 'absent' then
    if tg_op = 'INSERT' then
      new.job_function_id_snapshot := null;
      new.shift_period_snapshot := null;
      new.job_function_source := null;
    else
      new.job_function_id_snapshot := old.job_function_id_snapshot;
      new.shift_period_snapshot := old.shift_period_snapshot;
      new.job_function_source := old.job_function_source;
    end if;
    return new;
  end if;

  if _recaptura then
    select t.operation_id, t.shift_id into _op, _shift from public.timesheets t where t.id = new.timesheet_id;
    if not found then
      return new;
    end if;

    -- Período: o do turno da FOLHA, classificado no cadastro. Sem turno ou sem classificação: nulo.
    new.shift_period_snapshot := (select s.shift_period from public.shifts s where s.id = _shift);

    -- Função: a informada pelo admin neste salvamento ou a da alocação ativa. Sem uma delas, nula.
    _in := nullif(current_setting('bslog.funcao_do_apontamento', true), '')::uuid;
    if _in is not null then
      if not exists (select 1 from public.job_functions f where f.id = _in and f.active) then
        raise exception 'A função informada não existe ou está inativa.' using errcode = '23514';
      end if;
      new.job_function_id_snapshot := _in;
      new.job_function_source := 'informada';
    else
      select ot.job_function_id into _aloc
        from public.operation_team ot
       where ot.employee_id = new.employee_id and ot.operation_id = _op and ot.active
       order by (ot.shift_id is not distinct from _shift) desc, ot.created_at
       limit 1;
      new.job_function_id_snapshot := _aloc;
      new.job_function_source := case when _aloc is null then null else 'alocacao' end;
    end if;
  else
    -- Sem recaptura o snapshot é o gravado. Só um fluxo de sistema o muda (a RPC de correção ou o
    -- dono do banco): a trava de colunas barra qualquer outro escritor, e depois da fatura a trava
    -- da edição faturada barra todos.
    if new.job_function_id_snapshot is distinct from old.job_function_id_snapshot
       and new.job_function_id_snapshot is not null
       and not exists (select 1 from public.job_functions f where f.id = new.job_function_id_snapshot and f.active) then
      raise exception 'A função informada não existe ou está inativa.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Depois de `bloqueia_*` (a trava vê o que o cliente enviou, não o que o gatilho grava) e antes de
-- `calculo_*` (a tarifa por função, na migration seguinte, lê estes snapshots).
create trigger trg_timesheet_entries_bz_snapshots_funcao_periodo
  before insert or update on public.timesheet_entries
  for each row execute function public.capturar_snapshots_funcao_periodo();

-- ---------------------------------------------------------------------------
-- 5. Correção auditada de apontamento NÃO faturado
-- ---------------------------------------------------------------------------

create function public.corrigir_snapshots_do_apontamento(
  p_entry_id          uuid,
  p_job_function_id   uuid,
  p_atualizar_periodo boolean,
  p_reason            text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _motivo  text;
  _cliente uuid;
  e        record;
  _per     text;
  _antes   jsonb;
  _depois  jsonb;
begin
  perform public.condicoes_exigir_admin();
  _motivo := public.condicoes_validar_motivo(p_reason);
  if p_entry_id is null or (p_job_function_id is null and not coalesce(p_atualizar_periodo, false)) then
    raise exception 'Informe a função a corrigir e/ou peça a atualização do período.' using errcode = '22023';
  end if;

  select o.client_id into _cliente
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    join public.operations o on o.id = t.operation_id
   where te.id = p_entry_id;
  if not found then
    raise exception 'Apontamento não encontrado.' using errcode = 'P0002';
  end if;

  -- A mesma trava de gerar_fatura: correção e faturamento do cliente não correm juntos.
  perform pg_advisory_xact_lock(hashtextextended(_cliente::text, 0));

  select te.*, t.shift_id as w_shift into e
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
   where te.id = p_entry_id
     for update of te;
  if e.invoice_id is not null then
    raise exception 'Apontamento faturado é imutável: função e período não se corrigem.' using errcode = '55000';
  end if;
  if e.status = 'absent' then
    raise exception 'Falta não tem função nem período.' using errcode = '55000';
  end if;

  _antes := jsonb_build_object('job_function_id_snapshot', e.job_function_id_snapshot,
    'shift_period_snapshot', e.shift_period_snapshot, 'job_function_source', e.job_function_source);

  if p_job_function_id is not null then
    if not exists (select 1 from public.job_functions f where f.id = p_job_function_id and f.active) then
      raise exception 'A função informada não existe ou está inativa.' using errcode = '22023';
    end if;
    update public.timesheet_entries
       set job_function_id_snapshot = p_job_function_id, job_function_source = 'corrigida'
     where id = p_entry_id;
  end if;

  if coalesce(p_atualizar_periodo, false) then
    _per := (select s.shift_period from public.shifts s where s.id = e.w_shift);
    if _per is null then
      raise exception 'O turno da folha não tem classificação diurno/noturno: classifique o turno antes.' using errcode = '22023';
    end if;
    update public.timesheet_entries set shift_period_snapshot = _per where id = p_entry_id;
  end if;

  select jsonb_build_object('job_function_id_snapshot', te.job_function_id_snapshot,
           'shift_period_snapshot', te.shift_period_snapshot, 'job_function_source', te.job_function_source)
    into _depois from public.timesheet_entries te where te.id = p_entry_id;

  perform public.condicoes_auditar('apontamento_snapshots_corrigidos', 'apontamento', p_entry_id, p_entry_id,
    _antes, _depois, _motivo);

  return jsonb_build_object('antes', _antes, 'depois', _depois);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. salvar_apontamento_admin (corpo vigente: 030) com a função informada na linha NOVA
-- ---------------------------------------------------------------------------

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
      -- FIN-PR-07: a função trabalhada, se informada, vai ao gatilho de snapshots só para ESTA linha
      -- (variável local da transação, zerada logo depois). Sem ela, vale a função da alocação.
      perform set_config('bslog.funcao_do_apontamento', coalesce(nullif(_l ->> 'job_function_id', ''), ''), true);
      insert into public.timesheet_entries
        (timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes)
      values
        (_folha.id, _emp, p_operation_id, p_work_date, _status,
         nullif(_l ->> 'check_in', '')::time, nullif(_l ->> 'check_out', '')::time,
         coalesce((_l ->> 'break_minutes')::integer, 0), nullif(_l ->> 'notes', ''));
      perform set_config('bslog.funcao_do_apontamento', '', true);
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

-- ---------------------------------------------------------------------------
-- 7. Estado do motor (corpo vigente: 039) + a capacidade
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
    'snapshots_funcao_periodo', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Dono e privilégios
-- ---------------------------------------------------------------------------

do $privilegios$
declare
  _f record;
begin
  for _f in
    select p.oid::regprocedure as assinatura, p.proname as nome
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('capturar_snapshots_funcao_periodo', 'corrigir_snapshots_do_apontamento')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome = 'corrigir_snapshots_do_apontamento' then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.corrigir_snapshots_do_apontamento(uuid, uuid, boolean, text) is
  'Admin. Corrige a funcao trabalhada e/ou atualiza o periodo do turno de um apontamento NAO faturado, com motivo e trilha. Faturado e imutavel.';
comment on function public.capturar_snapshots_funcao_periodo() is
  'FIN-PR-07: grava, no lancamento, o periodo do turno da folha e a funcao (informada ou da alocacao). Nunca inventa; nao toca em valor.';

-- ---------------------------------------------------------------------------
-- 9. Autoverificação
-- ---------------------------------------------------------------------------

do $verificacao$
begin
  if exists (select 1 from public.timesheet_entries
              where job_function_id_snapshot is not null or shift_period_snapshot is not null or job_function_source is not null) then
    raise exception '040: nenhum apontamento existente deveria ter snapshot de função ou período.';
  end if;
  if has_function_privilege('authenticated', 'public.capturar_snapshots_funcao_periodo()', 'EXECUTE')
     or has_function_privilege('anon', 'public.corrigir_snapshots_do_apontamento(uuid, uuid, boolean, text)', 'EXECUTE') then
    raise exception '040: o gatilho é interno e a correção não é de anon.';
  end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'job_function_id_snapshot', 'SELECT') then
    raise exception '040: o operacional não lê os snapshots.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('derivar_valores_por_vigencia', 'derivar_valores_financeiros', 'gerar_fatura')
              and (prosrc ilike '%job_function%' or prosrc ilike '%shift_period%')) then
    raise exception '040: o cálculo e a fatura não conhecem os snapshots.';
  end if;
end;
$verificacao$;

commit;
