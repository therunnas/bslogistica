-- Motor financeiro por vigência, com chave de ativação reversível (C05-B, etapa 4.3C).
--
-- As migrations 022 a 024 deram HISTÓRICO às três fontes do preço: o contrato
-- (`contract_terms`), o valor acordado da operação sem contrato (`operation_terms`) e o custo
-- do colaborador (`employee_cost_terms`). Esta migration escreve o motor que as USA: cada
-- apontamento passa a fixar, na primeira derivação, os preços vigentes na data trabalhada
-- (`timesheets.work_date`), e uma edição posterior recalcula só as QUANTIDADES com esses
-- preços congelados. Reajuste futuro não reescreve diária antiga.
--
-- NASCE DESLIGADO. O motor novo só existe como trigger DESABILITADO. Com a chave desligada o
-- banco se comporta exatamente como antes: a função `derivar_valores_financeiros` (010) e o
-- trigger `trg_timesheet_entries_calculo_financeiro` não são tocados, nenhum bloqueio novo
-- vale, nenhuma versão nem snapshot é preenchido, nada é recalculado.
--
-- COMO A CHAVE FUNCIONA
--
--   `alterar_motor_vigencia(ligar, motivo)` (admin AAL2, auditado) troca, numa transação, o
--   estado de seis triggers e grava a linha de `financial_engine_settings`:
--
--                                              desligado     ligado
--     timesheet_entries.calculo_financeiro     habilitado    DESABILITADO   (motor antigo)
--     timesheet_entries.calculo_vigencia       DESABILITADO  habilitado     (motor novo)
--     contracts / employees / operations       DESABILITADO  habilitados    (sem edição direta de taxa)
--     shifts.congela_jornada_usada (024)       DESABILITADO  habilitado
--
--   `ALTER TABLE ... DISABLE/ENABLE TRIGGER` toma SHARE ROW EXCLUSIVE em `timesheet_entries`:
--   a troca espera as gravações em andamento e as próximas já nascem no modo novo. Escolhi
--   trocar triggers, e não ler a chave a cada linha, para que o motor antigo fique
--   BYTE A BYTE como está e o desligado seja provadamente idêntico.
--
-- A DERIVAÇÃO POR VIGÊNCIA (ligada)
--
--   Preço (diária, jornada contratada, fator, tolerância, custo, jornada prevista do turno):
--     * apontamento NOVO ou que MUDA DE FOLHA: lê as versões da data trabalhada, na ordem
--       contrato -> valor acordado da operação, e o custo do colaborador; grava referências
--       (`contract_terms_id`, `operation_terms_id`, `employee_cost_terms_id`), snapshots
--       (`*_snapshot`) e `terms_origin` ('versao' ou 'valor_acordado');
--     * edição de horário, intervalo ou status: preços dos snapshots gravados; recalcula só
--       minutos trabalhados, extras e valores;
--     * troca de COLABORADOR: custo da versão do novo colaborador na data; receita preservada;
--     * `UPDATE` sem coluna motriz: preserva tudo, como a 010.
--   Falta (`absent`) tem os valores zerados, mas também fixa referências e snapshots.
--   Sem versão vigente na data: recusa com P0002, sem fallback para a taxa atual.
--
-- FONTE DO PREÇO E `operations.contract_id` MUTÁVEL
--
--   Não existe histórico de QUANDO a operação teve ou deixou de ter contrato. Para não inventar
--   essa data: (1) se contrato e valor acordado têm versão na mesma data, o caso é ambíguo e é
--   RECUSADO (55000); (2) com o motor ligado, `contract_id` de operação que já tem apontamento
--   não muda (55000); (3) apontamento retroativo a data anterior à ativação, em operação que
--   já tinha apontamento legado, é recusado (55000): o vínculo daquele período é desconhecido.
--
-- LEGADO
--
--   Apontamento sem origem (`terms_origin` nulo) é legado. Nota e faturamento continuam
--   livres. Edição de horário, intervalo, status ou colaborador é RECUSADA (55000): exigiria
--   um preço que ninguém comprovou. NÃO se presume taxa histórica por coincidir com a atual.
--   A saída é `regularizar_apontamento_legado(entry, motivo, aplicar)` (admin AAL2): adota as
--   versões cadastradas para a data, com PRÉVIA (aplicar = false não grava nada) e trilha.
--
-- TAXAS ATUAIS NAS COLUNAS ANTIGAS
--
--   `contracts.daily_rate` etc. e `operations.agreed_amount` deixam de ser a fonte do cálculo
--   quando o motor está ligado. Para o desligamento ser seguro, `sincronizar_colunas_legadas`
--   (e o próprio desligamento) copiam para elas a versão vigente HOJE. As RPCs das migrations
--   023 e 024 NÃO foram alteradas: espelhar dentro delas mudaria o cálculo do motor desligado
--   (e quebraria o que a 023/024 garantem e a homologação já tem). Menor solução segura:
--   sincronização explícita, auditada e idempotente.
--
-- REVERSÃO (nenhum dado de negócio é afetado; antes, desligar o motor: o desligamento já
-- ressincroniza as colunas antigas):
--
--   drop trigger trg_timesheet_entries_calculo_vigencia on public.timesheet_entries;
--   drop trigger trg_contracts_bloqueia_taxa_direta on public.contracts;
--   drop trigger trg_employees_bloqueia_taxa_direta on public.employees;
--   drop trigger trg_operations_bloqueia_taxa_direta on public.operations;
--   drop function public.derivar_valores_por_vigencia();
--   drop function public.bloquear_taxa_direta_contrato();
--   drop function public.bloquear_taxa_direta_colaborador();
--   drop function public.bloquear_taxa_direta_operacao();
--   drop function public.alterar_motor_vigencia(boolean, text, boolean);
--   drop function public.sincronizar_colunas_legadas(text);
--   drop function public.pendencias_implantacao_vigencias();
--   drop function public.estado_motor_vigencia();
--   drop function public.regularizar_apontamento_legado(uuid, text, boolean);
--   drop function public.motor_ativo();
--   drop function public.motor_pendencias();
--   drop function public.motor_sincronizar_colunas_interno();
--   drop function public.motor_minutos_previstos(uuid);
--   drop function public.motor_fonte_do_dia(uuid, date);
--   drop function public.motor_custo_do_dia(uuid, date);
--   drop trigger trg_financial_engine_settings_sem_delete on public.financial_engine_settings;
--   drop function public.proteger_chave_do_motor();
--   drop table public.financial_engine_settings;
--   -- e, SÓ se a trilha não tiver nenhum evento do motor (ela é append-only), restaurar os dois CHECK:
--   alter table public.financial_terms_audit
--     drop constraint financial_terms_audit_acao_valida,
--     drop constraint financial_terms_audit_entidade_valida;
--   alter table public.financial_terms_audit
--     add constraint financial_terms_audit_acao_valida check (action in (
--       'contrato_condicao_registrada', 'contrato_condicao_corrigida',
--       'contrato_condicao_encerrada', 'contrato_condicao_aposentada',
--       'colaborador_custo_registrado', 'colaborador_custo_corrigido',
--       'colaborador_custo_encerrado', 'colaborador_custo_aposentado',
--       'operacao_valor_registrado', 'operacao_valor_corrigido',
--       'operacao_valor_encerrado', 'operacao_valor_aposentado')),
--     add constraint financial_terms_audit_entidade_valida check (entity_kind in ('contrato', 'colaborador', 'operacao'));


-- ---------------------------------------------------------------------------
-- 1. Trilha: eventos do motor
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
    'colunas_legadas_sincronizadas', 'apontamento_legado_regularizado'
  )),
  add constraint financial_terms_audit_entidade_valida check (entity_kind in
    ('contrato', 'colaborador', 'operacao', 'sistema', 'apontamento'));


-- ---------------------------------------------------------------------------
-- 2. A chave (linha única, só as RPCs escrevem)
-- ---------------------------------------------------------------------------

create table public.financial_engine_settings (
  id             boolean primary key default true,
  vigencia_ativa boolean not null default false,
  ativada_em     date,
  changed_at     timestamptz not null default now(),
  changed_by     uuid,
  reason         text,
  constraint financial_engine_settings_linha_unica check (id)
);

-- A única linha nasce DESLIGADA. É a configuração inicial, não dado de negócio.
insert into public.financial_engine_settings (id, vigencia_ativa) values (true, false);

alter table public.financial_engine_settings enable row level security;

create policy financial_engine_settings_leitura_admin on public.financial_engine_settings
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  );

create policy financial_engine_settings_exige_admin_aal2 on public.financial_engine_settings
  as restrictive for all to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  with check (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  );

revoke all on table public.financial_engine_settings from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.financial_engine_settings to authenticated;

create or replace function public.proteger_chave_do_motor()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'A chave do motor financeiro tem uma única linha e não é apagada.'
    using errcode = '42501';
end;
$$;

revoke all on function public.proteger_chave_do_motor() from public, anon, authenticated, service_role;

create trigger trg_financial_engine_settings_sem_delete
  before delete or truncate on public.financial_engine_settings
  for each statement execute function public.proteger_chave_do_motor();


-- ---------------------------------------------------------------------------
-- 3. Helpers internos (sem EXECUTE de API)
-- ---------------------------------------------------------------------------

create or replace function public.motor_ativo()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((select vigencia_ativa from public.financial_engine_settings where id), false);
$$;

-- Jornada prevista do turno em minutos (espelha `shiftPlannedMinutes`); turno nulo = 0.
create or replace function public.motor_minutos_previstos(p_shift_id uuid)
returns double precision
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _inicio double precision;
  _fim    double precision;
  s       record;
begin
  if p_shift_id is null then
    return 0;
  end if;
  select start_time, end_time, break_minutes, crosses_midnight into s
    from public.shifts where id = p_shift_id;
  if not found then
    return 0;
  end if;
  _inicio := extract(hour from s.start_time) * 60 + extract(minute from s.start_time);
  _fim    := extract(hour from s.end_time)   * 60 + extract(minute from s.end_time);
  if coalesce(s.crosses_midnight, false) or _fim <= _inicio then
    _fim := _fim + 1440;
  end if;
  return greatest(0, _fim - _inicio - coalesce(s.break_minutes, 0));
end;
$$;

-- A versão de PREÇO vigente na data, com trava compartilhada (advisory, a mesma chave das RPCs)
-- e FOR SHARE na linha lida.
create or replace function public.motor_fonte_do_dia(
  p_operation_id uuid,
  p_work_date    date,
  out o_origem             text,
  out o_contract_terms_id  uuid,
  out o_operation_terms_id uuid,
  out o_daily_rate         numeric,
  out o_shift_hours        numeric,
  out o_ot_factor          numeric,
  out o_ot_tolerance_min   integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _contract uuid;
  ct public.contract_terms%rowtype;
  ot public.operation_terms%rowtype;
  _tem_ct boolean := false;
  _tem_ot boolean := false;
begin
  select contract_id into _contract from public.operations where id = p_operation_id;

  -- Trava COMPARTILHADA na mesma chave que as RPCs das migrations 023 e 024 tomam em modo
  -- exclusivo: uma correção, um encerramento ou um registro de vigência em andamento termina
  -- antes de este apontamento ler a versão (e é relido com um instantâneo novo, sem recusa
  -- passageira), e um encerramento só prossegue depois de este apontamento ser confirmado
  -- (a checagem de cobertura o enxerga). Várias derivações em paralelo não se bloqueiam.
  if _contract is not null then
    perform pg_advisory_xact_lock_shared(hashtextextended('condicoes_contrato:' || _contract::text, 0));
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('condicoes_operacao:' || p_operation_id::text, 0));

  if _contract is not null then
    select * into ct from public.contract_terms
     where contract_id = _contract and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date
       for share;
    _tem_ct := found;
  end if;

  select * into ot from public.operation_terms
   where operation_id = p_operation_id and active
     and daterange(valid_from, valid_to, '[)') @> p_work_date
     for share;
  _tem_ot := found;

  if _tem_ct and _tem_ot then
    raise exception 'Fonte do preço ambígua em %: há vigência de contrato e de valor acordado da operação para a mesma data.', p_work_date
      using errcode = '55000',
            hint = 'Aposente ou encerre uma das duas vigências para que a data tenha uma fonte só.';
  elsif _tem_ct then
    o_origem := 'versao';
    o_contract_terms_id := ct.id;
    o_daily_rate := ct.daily_rate;
    o_shift_hours := ct.shift_hours;
    o_ot_factor := ct.ot_factor;
    o_ot_tolerance_min := ct.ot_tolerance_min;
  elsif _tem_ot then
    -- Operação sem contrato: jornada 8 h, fator 1 e tolerância 10 min, como sempre.
    o_origem := 'valor_acordado';
    o_operation_terms_id := ot.id;
    o_daily_rate := ot.agreed_amount;
    o_shift_hours := 8;
    o_ot_factor := 1;
    o_ot_tolerance_min := 10;
  elsif _contract is not null then
    raise exception 'Sem condições contratuais vigentes em % para o contrato da operação.', p_work_date
      using errcode = 'P0002',
            hint = 'Registre a vigência com motivo antes de apontar nesta data; não há fallback para a taxa atual.';
  else
    raise exception 'Sem valor acordado vigente em % para a operação.', p_work_date
      using errcode = 'P0002',
            hint = 'Registre a vigência com motivo antes de apontar nesta data; não há fallback para operations.agreed_amount.';
  end if;
end;
$$;

create or replace function public.motor_custo_do_dia(
  p_employee_id uuid,
  p_work_date   date,
  out o_employee_cost_terms_id uuid,
  out o_daily_cost             numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  et public.employee_cost_terms%rowtype;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('condicoes_colaborador:' || p_employee_id::text, 0));
  select * into et from public.employee_cost_terms
   where employee_id = p_employee_id and active
     and daterange(valid_from, valid_to, '[)') @> p_work_date
     for share;
  if not found then
    raise exception 'Sem custo vigente em % para o colaborador.', p_work_date
      using errcode = 'P0002',
            hint = 'Registre a vigência com motivo antes de apontar nesta data; não há fallback para employees.daily_cost.';
  end if;
  o_employee_cost_terms_id := et.id;
  o_daily_cost := et.daily_cost;
end;
$$;

-- Cadastros em uso sem versão que cubra HOJE (America/Sao_Paulo).
create or replace function public.motor_pendencias()
returns table (tipo text, id uuid, nome text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select 'contrato'::text, c.id, c.name
    from public.contracts c, hoje
   where exists (select 1 from public.operations o where o.contract_id = c.id)
     and not exists (select 1 from public.contract_terms t
                      where t.contract_id = c.id and t.active and daterange(t.valid_from, t.valid_to, '[)') @> hoje.d)
  union all
  select 'colaborador'::text, e.id, e.name
    from public.employees e, hoje
   where exists (select 1 from public.operation_team m where m.employee_id = e.id and m.active)
     and not exists (select 1 from public.employee_cost_terms t
                      where t.employee_id = e.id and t.active and daterange(t.valid_from, t.valid_to, '[)') @> hoje.d)
  union all
  select 'operacao_sem_contrato'::text, o.id, o.name
    from public.operations o, hoje
   where o.contract_id is null
     and not exists (select 1 from public.operation_terms t
                      where t.operation_id = o.id and t.active and daterange(t.valid_from, t.valid_to, '[)') @> hoje.d);
$$;

-- Copia a versão vigente HOJE para as colunas antigas. Devolve quantas linhas mudaram.
create or replace function public.motor_sincronizar_colunas_interno()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  _c integer;
  _e integer;
  _o integer;
begin
  update public.contracts c
     set daily_rate = t.daily_rate, shift_hours = t.shift_hours, ot_factor = t.ot_factor, ot_tolerance_min = t.ot_tolerance_min
    from public.contract_terms t
   where t.contract_id = c.id and t.active and daterange(t.valid_from, t.valid_to, '[)') @> _hoje
     and (c.daily_rate, c.shift_hours, c.ot_factor, c.ot_tolerance_min)
         is distinct from (t.daily_rate, t.shift_hours, t.ot_factor, t.ot_tolerance_min);
  get diagnostics _c = row_count;

  update public.employees e
     set daily_cost = t.daily_cost
    from public.employee_cost_terms t
   where t.employee_id = e.id and t.active and daterange(t.valid_from, t.valid_to, '[)') @> _hoje
     and e.daily_cost is distinct from t.daily_cost;
  get diagnostics _e = row_count;

  update public.operations o
     set agreed_amount = t.agreed_amount
    from public.operation_terms t
   where t.operation_id = o.id and t.active and daterange(t.valid_from, t.valid_to, '[)') @> _hoje
     and o.agreed_amount is distinct from t.agreed_amount;
  get diagnostics _o = row_count;

  return jsonb_build_object('data', _hoje, 'contratos', _c, 'colaboradores', _e, 'operacoes', _o);
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. A derivação por vigência (trigger criado DESABILITADO)
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

  _planned_efetivo     double precision;
  _shift_hours_efetivo double precision;
  _ot_factor_efetivo   double precision;
  _ot_hour_rate        double precision;
  _ot_cost_hour_rate   double precision;

  _inicio    double precision;
  _fim       double precision;
  _worked    double precision := 0;
  _excess    double precision;
  _overtime  double precision := 0;
  _ot_horas  double precision;

  _billed numeric;
  _cost   numeric;
begin
  -- `INSERT ... ON CONFLICT DO UPDATE` (o upsert do PostgREST e a RPC do operador) dispara
  -- este BEFORE INSERT mesmo quando o resultado final é UPDATE. A linha que já existe é
  -- tratada na fase de UPDATE; aqui só se repassa, para não exigir vigência (nem recalcular)
  -- de um apontamento que está apenas sendo reenviado.
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

    -- Sem coluna motriz, e sem a regularização (a origem só muda pela mão do sistema):
    -- preserva o gravado, como a 010. É o que mantém o snapshot congelado.
    if not _motriz and new.terms_origin is not distinct from old.terms_origin then
      new.worked_minutes        := old.worked_minutes;
      new.overtime_minutes      := old.overtime_minutes;
      new.daily_rate_snapshot   := old.daily_rate_snapshot;
      new.ot_hour_rate_snapshot := old.ot_hour_rate_snapshot;
      new.daily_cost_snapshot   := old.daily_cost_snapshot;
      new.billed_amount         := old.billed_amount;
      new.cost_amount           := old.cost_amount;
      return new;
    end if;
  end if;

  -- Data, operação e turno vêm da FOLHA, nunca do payload.
  select t.work_date, t.operation_id, t.shift_id
    into _work_date, _operation, _shift
    from public.timesheets t
   where t.id = new.timesheet_id;
  if not found then
    return new; -- o trigger de chave recusa a folha inexistente (23503)
  end if;

  _precificar := tg_op = 'INSERT' or new.timesheet_id is distinct from old.timesheet_id;

  _origem := new.terms_origin;
  _contract_terms_id := new.contract_terms_id;
  _operation_terms_id := new.operation_terms_id;
  _employee_terms_id := new.employee_cost_terms_id;

  if _precificar then
    -- Retroativo a uma data anterior à ativação, em operação que já tinha apontamento
    -- legado: o vínculo contrato/valor acordado daquele período é desconhecido.
    select ativada_em into _ativacao from public.financial_engine_settings where id;
    if _ativacao is not null and _work_date < _ativacao
       and exists (select 1 from public.timesheet_entries e
                     join public.timesheets s on s.id = e.timesheet_id
                    where s.operation_id = _operation and e.terms_origin is null
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

    new.shift_hours_snapshot := _fonte.o_shift_hours;
    new.ot_factor_snapshot := _fonte.o_ot_factor;
    new.ot_tolerance_snapshot := _fonte.o_ot_tolerance_min;
    new.planned_minutes_snapshot := _planned::numeric;
  else
    -- Edição de apontamento existente: os PREÇOS vêm do próprio apontamento.
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
    else
      raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
        using errcode = '55000',
              hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
    end if;
  end if;

  -- A partir daqui, a aritmética é a de `derivar_valores_financeiros` (010), sem alteração.
  _shift_hours_efetivo := case
    when _shift_hours is not null and _shift_hours > 0 then _shift_hours else 8
  end;
  _ot_factor_efetivo := case
    when _ot_factor is null or _ot_factor = 0 then 1 else _ot_factor
  end;

  _daily_rate        := coalesce(_daily_rate, 0);
  _daily_cost        := coalesce(_daily_cost, 0);
  _ot_hour_rate      := (_daily_rate / _shift_hours_efetivo) * _ot_factor_efetivo;
  _ot_cost_hour_rate := _daily_cost / _shift_hours_efetivo;

  if new.status = 'absent' then
    _worked   := 0;
    _overtime := 0;
    _billed   := 0;
    _cost     := 0;
  else
    if new.check_in is null or new.check_out is null then
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

    _excess   := _worked - _planned_efetivo;
    _overtime := case
      when _excess > coalesce(_ot_tolerance_min, 0) then _excess else 0
    end;
    _ot_horas := _overtime / 60.0;

    _billed := round((( _daily_rate + _ot_horas * _ot_hour_rate) * 100)::numeric) / 100;
    _cost   := round((( _daily_cost + _ot_horas * _ot_cost_hour_rate) * 100)::numeric) / 100;
  end if;

  new.worked_minutes        := _worked::integer;
  new.overtime_minutes      := _overtime::integer;
  new.daily_rate_snapshot   := _daily_rate::numeric;
  new.ot_hour_rate_snapshot := _ot_hour_rate::numeric;
  new.daily_cost_snapshot   := _daily_cost::numeric;
  new.billed_amount         := _billed;
  new.cost_amount           := _cost;

  new.terms_origin           := _origem;
  new.contract_terms_id      := _contract_terms_id;
  new.operation_terms_id     := _operation_terms_id;
  new.employee_cost_terms_id := _employee_terms_id;

  return new;
end;
$$;

revoke all on function public.derivar_valores_por_vigencia() from public, anon, authenticated, service_role;

-- `calculo_vigencia` ordena depois de `bloqueia_*` (os guards olham o payload do cliente
-- antes) e antes de `chave`. DESABILITADO: o motor antigo continua sendo o ativo.
create trigger trg_timesheet_entries_calculo_vigencia
  before insert or update on public.timesheet_entries
  for each row execute function public.derivar_valores_por_vigencia();

alter table public.timesheet_entries disable trigger trg_timesheet_entries_calculo_vigencia;


-- ---------------------------------------------------------------------------
-- 5. Sem edição direta de taxa (triggers criados DESABILITADOS)
-- ---------------------------------------------------------------------------

create or replace function public.bloquear_taxa_direta_contrato()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if (new.daily_rate is distinct from old.daily_rate
      or new.shift_hours is distinct from old.shift_hours
      or new.ot_factor is distinct from old.ot_factor
      or new.ot_tolerance_min is distinct from old.ot_tolerance_min)
     and current_user not in ('postgres', 'service_role') then
    raise exception 'As condições financeiras do contrato mudam por registro de vigência (data de início e motivo), não por edição direta.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.bloquear_taxa_direta_colaborador()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.daily_cost is distinct from old.daily_cost
     and current_user not in ('postgres', 'service_role') then
    raise exception 'O custo diário do colaborador muda por registro de vigência (data de início e motivo), não por edição direta.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.bloquear_taxa_direta_operacao()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;
  if new.agreed_amount is distinct from old.agreed_amount then
    raise exception 'O valor acordado da operação muda por registro de vigência (data de início e motivo), não por edição direta.'
      using errcode = '55000';
  end if;
  -- Sem histórico de quando a operação teve ou deixou de ter contrato, o vínculo não muda
  -- depois que existe apontamento.
  if new.contract_id is distinct from old.contract_id
     and exists (select 1 from public.timesheets t
                   join public.timesheet_entries e on e.timesheet_id = t.id
                  where t.operation_id = old.id) then
    raise exception 'O contrato de uma operação que já tem apontamentos não pode mudar: não há histórico de quando o vínculo valia.'
      using errcode = '55000',
            hint = 'Crie uma nova operação para o novo contrato.';
  end if;
  return new;
end;
$$;

revoke all on function public.bloquear_taxa_direta_contrato() from public, anon, authenticated, service_role;
revoke all on function public.bloquear_taxa_direta_colaborador() from public, anon, authenticated, service_role;
revoke all on function public.bloquear_taxa_direta_operacao() from public, anon, authenticated, service_role;

create trigger trg_contracts_bloqueia_taxa_direta
  before update of daily_rate, shift_hours, ot_factor, ot_tolerance_min on public.contracts
  for each row execute function public.bloquear_taxa_direta_contrato();
create trigger trg_employees_bloqueia_taxa_direta
  before update of daily_cost on public.employees
  for each row execute function public.bloquear_taxa_direta_colaborador();
create trigger trg_operations_bloqueia_taxa_direta
  before update of agreed_amount, contract_id on public.operations
  for each row execute function public.bloquear_taxa_direta_operacao();

alter table public.contracts  disable trigger trg_contracts_bloqueia_taxa_direta;
alter table public.employees  disable trigger trg_employees_bloqueia_taxa_direta;
alter table public.operations disable trigger trg_operations_bloqueia_taxa_direta;


-- ---------------------------------------------------------------------------
-- 6. RPCs administrativas
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
    -- as seis chaves de trigger estão como a linha diz?
    'consistente', case when s.vigencia_ativa
                        then _novo = 'O' and _antigo = 'D' and _trav = 4
                        else _novo = 'D' and _antigo = 'O' and _trav = 0 end);
end;
$$;

create or replace function public.pendencias_implantacao_vigencias()
returns table (tipo text, id uuid, nome text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.condicoes_exigir_admin();
  return query select p.tipo, p.id, p.nome from public.motor_pendencias() p order by p.tipo, p.nome;
end;
$$;

create or replace function public.alterar_motor_vigencia(
  p_ativar              boolean,
  p_reason              text,
  p_aceitar_pendencias  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _motivo text;
  v_ant   public.financial_engine_settings%rowtype;
  v_dep   public.financial_engine_settings%rowtype;
  _pend   integer := 0;
  _sync   jsonb := null;
  _id     constant uuid := '00000000-0000-4000-8000-000000000025';
begin
  perform public.condicoes_exigir_admin();
  _motivo := public.condicoes_validar_motivo(p_reason);
  if p_ativar is null then
    raise exception 'Informe se o motor deve ser ligado ou desligado.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('motor_vigencia', 0));
  select * into v_ant from public.financial_engine_settings where id for update;

  if v_ant.vigencia_ativa = p_ativar then
    raise exception '%', case when p_ativar then 'O motor por vigência já está ligado.' else 'O motor por vigência já está desligado.' end
      using errcode = '55000';
  end if;

  if p_ativar then
    select count(*) into _pend from public.motor_pendencias();
    if _pend > 0 and not coalesce(p_aceitar_pendencias, false) then
      raise exception 'Há % cadastro(s) em uso sem vigência para hoje; apontamentos remuneráveis deles serão recusados.', _pend
        using errcode = '55000',
              hint = 'Veja pendencias_implantacao_vigencias(), registre as vigências, ou ligue com p_aceitar_pendencias = true.';
    end if;

    alter table public.timesheet_entries disable trigger trg_timesheet_entries_calculo_financeiro;
    alter table public.timesheet_entries enable  trigger trg_timesheet_entries_calculo_vigencia;
    alter table public.contracts         enable  trigger trg_contracts_bloqueia_taxa_direta;
    alter table public.employees         enable  trigger trg_employees_bloqueia_taxa_direta;
    alter table public.operations        enable  trigger trg_operations_bloqueia_taxa_direta;
    alter table public.shifts            enable  trigger trg_shifts_congela_jornada_usada;

    update public.financial_engine_settings
       set vigencia_ativa = true, ativada_em = (now() at time zone 'America/Sao_Paulo')::date,
           changed_at = now(), changed_by = auth.uid(), reason = _motivo
     where id returning * into v_dep;
  else
    -- Desligar: as colunas antigas voltam a refletir a versão vigente hoje, porque o motor
    -- antigo volta a calcular a partir delas.
    _sync := public.motor_sincronizar_colunas_interno();

    alter table public.timesheet_entries disable trigger trg_timesheet_entries_calculo_vigencia;
    alter table public.timesheet_entries enable  trigger trg_timesheet_entries_calculo_financeiro;
    alter table public.contracts         disable trigger trg_contracts_bloqueia_taxa_direta;
    alter table public.employees         disable trigger trg_employees_bloqueia_taxa_direta;
    alter table public.operations        disable trigger trg_operations_bloqueia_taxa_direta;
    alter table public.shifts            disable trigger trg_shifts_congela_jornada_usada;

    update public.financial_engine_settings
       set vigencia_ativa = false, changed_at = now(), changed_by = auth.uid(), reason = _motivo
     where id returning * into v_dep;
  end if;

  perform public.condicoes_auditar(
    case when p_ativar then 'motor_vigencia_ativado' else 'motor_vigencia_desativado' end,
    'sistema', _id, _id,
    to_jsonb(v_ant),
    to_jsonb(v_dep) || jsonb_build_object('pendencias', _pend, 'aceitou_pendencias', coalesce(p_aceitar_pendencias, false),
                                          'sincronizacao', _sync),
    _motivo);

  return jsonb_build_object('ativo', v_dep.vigencia_ativa, 'ativada_em', v_dep.ativada_em,
                            'pendencias', _pend, 'sincronizacao', _sync);
end;
$$;

create or replace function public.sincronizar_colunas_legadas(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _motivo text;
  _res    jsonb;
  _id     constant uuid := '00000000-0000-4000-8000-000000000025';
begin
  perform public.condicoes_exigir_admin();
  _motivo := public.condicoes_validar_motivo(p_reason);
  perform pg_advisory_xact_lock(hashtextextended('motor_vigencia', 0));
  _res := public.motor_sincronizar_colunas_interno();
  perform public.condicoes_auditar('colunas_legadas_sincronizadas', 'sistema', _id, _id, null, _res, _motivo);
  return _res;
end;
$$;

create or replace function public.regularizar_apontamento_legado(
  p_entry_id uuid,
  p_reason   text,
  p_aplicar  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _motivo  text;
  e        record;
  _fonte   record;
  _custo   record;
  _planned double precision;
  _antes   jsonb;
  _depois  jsonb;
  _atual   jsonb;
begin
  perform public.condicoes_exigir_admin();
  _motivo := public.condicoes_validar_motivo(p_reason);
  if p_entry_id is null then
    raise exception 'O apontamento é obrigatório.' using errcode = '22023';
  end if;
  if not public.motor_ativo() then
    raise exception 'Ligue o motor por vigência antes de regularizar apontamentos.' using errcode = '55000';
  end if;

  select te.*, s.work_date as w_date, s.operation_id as w_operation, s.shift_id as w_shift
    into e
    from public.timesheet_entries te
    join public.timesheets s on s.id = te.timesheet_id
   where te.id = p_entry_id
     for update of te;
  if not found then
    raise exception 'Apontamento não encontrado.' using errcode = 'P0002';
  end if;
  if e.invoice_id is not null then
    raise exception 'Apontamento faturado é imutável.' using errcode = '55000';
  end if;
  if e.terms_origin in ('versao', 'valor_acordado') then
    raise exception 'O apontamento já tem origem de preço (%); não é legado.', e.terms_origin using errcode = '55000';
  end if;

  select * into _fonte from public.motor_fonte_do_dia(e.w_operation, e.w_date);
  select * into _custo from public.motor_custo_do_dia(e.employee_id, e.w_date);
  _planned := public.motor_minutos_previstos(e.w_shift);

  _antes := jsonb_build_object('billed_amount', e.billed_amount, 'cost_amount', e.cost_amount,
    'daily_rate_snapshot', e.daily_rate_snapshot, 'daily_cost_snapshot', e.daily_cost_snapshot,
    'overtime_minutes', e.overtime_minutes, 'terms_origin', e.terms_origin);

  -- A atualização roda numa subtransação: sem `p_aplicar`, é desfeita e só a prévia sai.
  begin
    update public.timesheet_entries
       set contract_terms_id = _fonte.o_contract_terms_id,
           operation_terms_id = _fonte.o_operation_terms_id,
           employee_cost_terms_id = _custo.o_employee_cost_terms_id,
           shift_hours_snapshot = _fonte.o_shift_hours,
           ot_factor_snapshot = _fonte.o_ot_factor,
           ot_tolerance_snapshot = _fonte.o_ot_tolerance_min,
           planned_minutes_snapshot = _planned::numeric,
           daily_rate_snapshot = _fonte.o_daily_rate,
           daily_cost_snapshot = _custo.o_daily_cost,
           terms_origin = _fonte.o_origem
     where id = p_entry_id
     returning jsonb_build_object('billed_amount', billed_amount, 'cost_amount', cost_amount,
       'daily_rate_snapshot', daily_rate_snapshot, 'daily_cost_snapshot', daily_cost_snapshot,
       'overtime_minutes', overtime_minutes, 'terms_origin', terms_origin) into _depois;

    if not coalesce(p_aplicar, false) then
      raise exception 'previa' using errcode = 'ZZ025';
    end if;
  exception when sqlstate 'ZZ025' then
    null;
  end;

  if coalesce(p_aplicar, false) then
    perform public.condicoes_auditar('apontamento_legado_regularizado', 'apontamento', p_entry_id,
      coalesce(_fonte.o_contract_terms_id, _fonte.o_operation_terms_id), _antes, _depois, _motivo);
  end if;

  return jsonb_build_object('aplicado', coalesce(p_aplicar, false), 'antes', _antes, 'depois', _depois,
                            'fonte', _fonte.o_origem);
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Dono, privilégios e comentários
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
         'motor_ativo', 'motor_minutos_previstos', 'motor_fonte_do_dia', 'motor_custo_do_dia',
         'motor_pendencias', 'motor_sincronizar_colunas_interno', 'derivar_valores_por_vigencia',
         'estado_motor_vigencia', 'pendencias_implantacao_vigencias', 'alterar_motor_vigencia',
         'sincronizar_colunas_legadas', 'regularizar_apontamento_legado')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('estado_motor_vigencia', 'pendencias_implantacao_vigencias', 'alterar_motor_vigencia',
                   'sincronizar_colunas_legadas', 'regularizar_apontamento_legado') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on table public.financial_engine_settings is
  'Chave do motor financeiro por vigencia (linha unica, nasce DESLIGADA). Escrita so por alterar_motor_vigencia (admin AAL2, motivo, trilha); leitura por admin em AAL2.';
comment on function public.derivar_valores_por_vigencia() is
  'Trigger do motor por vigencia (habilitado so com a chave ligada). Fixa precos da data trabalhada na primeira derivacao e recalcula so quantidades depois. Sem versao vigente: P0002, sem fallback para a taxa atual.';
comment on function public.regularizar_apontamento_legado(uuid, text, boolean) is
  'Admin AAL2. Adota as versoes cadastradas para a data de um apontamento legado nao faturado. p_aplicar = false so devolve a previa. Exige o motor ligado.';


-- ---------------------------------------------------------------------------
-- 8. Autoverificação (estrutural; só a linha de configuração é dado)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _n int;
begin
  if (select vigencia_ativa from public.financial_engine_settings where id) then
    raise exception '025: a chave deveria nascer DESLIGADA';
  end if;
  select count(*) into _n from public.financial_engine_settings;
  if _n <> 1 then
    raise exception '025: a chave deveria ter uma única linha, encontrei %', _n;
  end if;

  -- Estado desligado: motor antigo habilitado; motor novo, bloqueios e congelamento desabilitados.
  select count(*) into _n from pg_trigger
   where not tgisinternal
     and ((tgname = 'trg_timesheet_entries_calculo_financeiro' and tgenabled = 'O')
       or (tgname in ('trg_timesheet_entries_calculo_vigencia', 'trg_contracts_bloqueia_taxa_direta',
                      'trg_employees_bloqueia_taxa_direta', 'trg_operations_bloqueia_taxa_direta',
                      'trg_shifts_congela_jornada_usada') and tgenabled = 'D'));
  if _n <> 6 then
    raise exception '025: os 6 triggers deveriam estar no estado DESLIGADO, encontrei % corretos', _n;
  end if;

  -- O motor antigo não foi tocado.
  select count(*) into _n from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('derivar_valores_financeiros', 'gerar_fatura')
     and (prosrc ilike '%derivar_valores_por_vigencia%' or prosrc ilike '%financial_engine_settings%'
          or prosrc ilike '%operation_terms%' or prosrc ilike '%contract_terms%' or prosrc ilike '%employee_cost_terms%');
  if _n <> 0 then
    raise exception '025: derivar_valores_financeiros e gerar_fatura não deveriam ter mudado';
  end if;

  -- Privilégios: 5 RPCs só para authenticated; internas sem nenhum papel de API.
  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('estado_motor_vigencia', 'pendencias_implantacao_vigencias', 'alterar_motor_vigencia',
                       'sincronizar_colunas_legadas', 'regularizar_apontamento_legado')
     and p.prosecdef and p.proowner = 'postgres'::regrole
     and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE');
  if _n <> 5 then
    raise exception '025: as 5 RPCs deveriam ser do postgres, SECURITY DEFINER e executáveis só por authenticated, encontrei %', _n;
  end if;
  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('motor_ativo', 'motor_minutos_previstos', 'motor_fonte_do_dia', 'motor_custo_do_dia',
                       'motor_pendencias', 'motor_sincronizar_colunas_interno', 'derivar_valores_por_vigencia',
                       'bloquear_taxa_direta_contrato', 'bloquear_taxa_direta_colaborador',
                       'bloquear_taxa_direta_operacao', 'proteger_chave_do_motor')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE'));
  if _n <> 0 then
    raise exception '025: % função(ões) interna(s) executável(is) por papel de API', _n;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.financial_engine_settings'::regclass) then
    raise exception '025: RLS desligada na chave';
  end if;
  if has_table_privilege('authenticated', 'public.financial_engine_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.financial_engine_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.financial_engine_settings', 'DELETE')
     or has_table_privilege('service_role', 'public.financial_engine_settings', 'SELECT')
     or has_table_privilege('anon', 'public.financial_engine_settings', 'SELECT') then
    raise exception '025: privilégio indevido na chave';
  end if;

  select count(*) into _n from public.timesheet_entries where terms_origin is not null;
  if _n <> 0 then
    raise exception '025: nenhum apontamento deveria ter origem de preço, encontrei %', _n;
  end if;
end;
$verificacao$;
