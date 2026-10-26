-- Regras financeiras confirmadas pela BS (C05-B8.10). SOMENTE LOCAL até autorização própria.
--
-- O QUE ENTRA (cada item é regra informada pelos responsáveis da BS; nada além disso)
--
--   1. ENTRADA IGUAL À SAÍDA. O cálculo soma 24 h quando a saída não é posterior à entrada (turno
--      que vira a meia-noite); a igualdade caía na mesma regra e virava jornada de 24 h. As telas
--      já recusavam (C05-B8.9); agora o BANCO recusa (23514), por qualquer via: tela, PostgREST
--      direto e RPC do operador. Vale com o motor ligado ou desligado. Linha sem os dois
--      horários, ou falta, não é afetada. Linha antiga que já tenha a igualdade continua editável
--      em nota; só não pode ser regravada com horários iguais.
--
--   2. HORA EXTRA PAGA POR VALOR-HORA ACORDADO. Cada versão de custo do colaborador
--      (`employee_cost_terms`) pode ter `ot_hourly_cost`: o valor-hora combinado com aquele
--      colaborador, que varia por função e negociação. O apontamento congela esse valor em
--      `ot_hourly_cost_snapshot` na primeira derivação, como já congela a diária e o custo.
--      Cobrança e custo são independentes: o fator do contrato continua só na cobrança.
--      NÃO se presume adicional universal de 50% sobre o custo. Versão SEM valor-hora acordado
--      mantém o comportamento anterior (diária de custo ÷ jornada, sem fator), visível na tela
--      como "sem valor-hora acordado"; nada é inventado.
--
--   3. SAÍDA ANTECIPADA: CUSTO PROPORCIONAL. A BS paga ao colaborador proporcionalmente às horas
--      trabalhadas. Com entrada e saída preenchidas e minutos trabalhados abaixo da jornada
--      prevista, o custo-base é `diária de custo × trabalhado ÷ previsto`. A COBRANÇA ao cliente
--      NÃO muda (diária inteira): a regra de cobrança por saída antecipada não foi definida.
--      Sem arredondamento de meia hora e sem tolerância na falta de minutos: o tratamento de
--      15 e 45 minutos e o momento do arredondamento estão pendentes de decisão da BS.
--      Presença sem os dois horários segue com a diária de custo inteira (regra pendente).
--
--   4. ADICIONAIS DE SERVIÇO SEPARADOS DA DIÁRIA. `billing_additionals` registra valores extras
--      do período (etiquetagem, separação, contêiner...) com motivo, valor, referência, período,
--      cliente e, opcionalmente, operação. Não cria diária, não altera a diária padrão e não
--      gera custo. Só por RPC (admin AAL2), com trilha; não se apaga: cancela-se com motivo.
--      `gerar_fatura` inclui os adicionais não faturados cujo período está DENTRO do período
--      da fatura, um item por adicional, e os vincula na mesma transação. Adicional faturado é
--      imutável e não pode ser cancelado.
--
--   5. `estado_motor_vigencia()` passa a informar `regras_bs = true`: as telas só oferecem o
--      valor-hora, a prévia com custo proporcional e os adicionais depois desta migration. Antes
--      dela, o código novo se comporta como o anterior.
--
-- O QUE NÃO ENTRA (pendente de decisão da BS; nenhum padrão silencioso)
--
--   arredondamento de meia hora (15 e 45 minutos) e se é diário ou depois de acumular a quinzena;
--   100% em feriado combinado com diária por 4 horas; sábado e domingo; cobrança ao cliente por
--   saída antecipada; preço avulso por serviço completo ou por trabalhador; parâmetros fixos da
--   operação sem contrato (8 h, fator 1, 10 min); presença ou substituição sem horário.
--
-- MOTOR ANTIGO
--
--   `derivar_valores_financeiros` (010) não é tocado: os itens 2 e 3 valem no motor por
--   vigência. Production só aplica as regras novas depois de ligar o motor.
--
-- REVERSÃO (ensaiada localmente na C05-B8.10: catálogo e dados voltaram idênticos aos da 028).
-- Só sem dado da 029: nenhum adicional, nenhum evento de adicional na trilha (append-only),
-- nenhum valor-hora em versão nem em apontamento; do contrário, recusar e não reverter.
--
--   drop trigger trg_timesheet_entries_bloqueia_horario_igual on public.timesheet_entries;
--   drop function public.recusar_entrada_igual_saida();
--   -- gerar_fatura: recriar o corpo da 009; estado_motor_vigencia e derivar_valores_por_vigencia:
--   -- recriar o corpo da 025; bloquear_colunas_de_condicoes: o da 022;
--   -- registrar/corrigir_custo_colaborador e criar_colaborador_com_vigencia: dropar as
--   -- assinaturas com p_ot_hourly_cost e recriar as da 023/026 (com os mesmos grants);
--   drop function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid);
--   drop function public.cancelar_adicional(uuid, text);
--   drop table public.billing_additionals;
--   drop function public.proteger_adicional();
--   alter table public.timesheet_entries drop column ot_hourly_cost_snapshot;
--   alter table public.employee_cost_terms drop column ot_hourly_cost;
--   -- e, só se a trilha não tiver evento de adicional, restaurar os CHECK da 025.


-- ---------------------------------------------------------------------------
-- 1. Trilha: eventos de adicional
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
    'adicional_registrado', 'adicional_cancelado'
  )),
  add constraint financial_terms_audit_entidade_valida check (entity_kind in
    ('contrato', 'colaborador', 'operacao', 'sistema', 'apontamento', 'adicional'));


-- ---------------------------------------------------------------------------
-- 2. Entrada igual à saída: recusada pelo banco
-- ---------------------------------------------------------------------------

create or replace function public.recusar_entrada_igual_saida()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'absent' or new.check_in is null or new.check_out is null then
    return new;
  end if;

  -- Mesma granularidade do cálculo: hora e minuto.
  if extract(hour from new.check_in) * 60 + extract(minute from new.check_in)
     <> extract(hour from new.check_out) * 60 + extract(minute from new.check_out) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Linha antiga com a igualdade: nota e faturamento seguem livres; recusa só regravar.
    if new.status is not distinct from old.status
       and new.check_in is not distinct from old.check_in
       and new.check_out is not distinct from old.check_out then
      return new;
    end if;
  else
    -- `INSERT ... ON CONFLICT DO UPDATE` dispara este BEFORE INSERT mesmo quando o resultado é
    -- UPDATE: a linha que já existe é decidida na fase de UPDATE, comparando com OLD.
    if exists (select 1 from public.timesheet_entries e where e.id = new.id)
       or exists (select 1 from public.timesheet_entries e
                   where e.timesheet_id = new.timesheet_id and e.employee_id = new.employee_id) then
      return new;
    end if;
  end if;

  raise exception 'Entrada igual à saída seria calculada como jornada de 24 horas. Corrija o horário antes de salvar.'
    using errcode = '23514',
          hint = 'Para turno que vira a meia-noite, a saída é menor que a entrada (ex.: 22:00 → 06:00).';
end;
$$;

-- Ordena junto dos outros `bloqueia_*`, antes do cálculo.
create trigger trg_timesheet_entries_bloqueia_horario_igual
  before insert or update on public.timesheet_entries
  for each row execute function public.recusar_entrada_igual_saida();


-- ---------------------------------------------------------------------------
-- 3. Valor-hora acordado da hora extra paga
-- ---------------------------------------------------------------------------

-- Coluna nova em versão existente: o gatilho de imutabilidade não dispara em ALTER TABLE, e as
-- versões já gravadas ficam com NULL ("sem valor-hora acordado"), como sempre foram.
alter table public.employee_cost_terms
  add column ot_hourly_cost numeric(12,2),
  add constraint employee_cost_terms_hora_extra_positiva
    check (ot_hourly_cost is null or ot_hourly_cost > 0);

alter table public.timesheet_entries
  add column ot_hourly_cost_snapshot numeric(12,2),
  add constraint timesheet_entries_ot_hourly_cost_snapshot_positivo
    check (ot_hourly_cost_snapshot is null or ot_hourly_cost_snapshot > 0);

comment on column public.employee_cost_terms.ot_hourly_cost is
  'Valor-hora acordado da hora extra PAGA ao colaborador nesta vigencia. NULL = sem valor acordado (custo da hora extra = diaria de custo / jornada, sem fator).';
comment on column public.timesheet_entries.ot_hourly_cost_snapshot is
  'Valor-hora da hora extra paga, congelado da versao de custo na primeira derivacao. Derivado pelo sistema; NULL = sem valor acordado.';

-- O snapshot novo também só o sistema grava (mesmo guard da 022, com a coluna nova).
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
           or new.ot_hourly_cost_snapshot is not null;
  else
    _mexeu := new.contract_terms_id is distinct from old.contract_terms_id
           or new.employee_cost_terms_id is distinct from old.employee_cost_terms_id
           or new.shift_hours_snapshot is distinct from old.shift_hours_snapshot
           or new.ot_factor_snapshot is distinct from old.ot_factor_snapshot
           or new.ot_tolerance_snapshot is distinct from old.ot_tolerance_snapshot
           or new.planned_minutes_snapshot is distinct from old.planned_minutes_snapshot
           or new.terms_origin is distinct from old.terms_origin
           or new.ot_hourly_cost_snapshot is distinct from old.ot_hourly_cost_snapshot;
  end if;

  if _mexeu then
    raise exception
      'As condições financeiras do apontamento são registradas pelo sistema e não podem ser gravadas diretamente.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Validação comum do valor-hora (NULL = sem valor acordado).
create or replace function public.condicoes_validar_hora_extra(p_valor numeric)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if p_valor is null then
    return null;
  end if;
  if p_valor <= 0 then
    raise exception 'O valor-hora da hora extra deve ser maior que zero (deixe vazio se não houver valor acordado).'
      using errcode = '22023';
  end if;
  if p_valor <> round(p_valor, 2) then
    raise exception 'O valor-hora da hora extra aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  return p_valor;
end;
$$;

-- As assinaturas antigas saem para não haver sobrecarga ambígua no PostgREST. O parâmetro novo
-- é o ÚLTIMO e tem DEFAULT: quem chama sem ele continua funcionando (sem valor acordado).
drop function public.registrar_custo_colaborador(uuid, date, numeric, text, date, boolean);
drop function public.corrigir_custo_colaborador(uuid, date, date, numeric, text);
drop function public.criar_colaborador_com_vigencia(text, text, text, text, text, numeric, date, text);

create function public.registrar_custo_colaborador(
  p_employee_id       uuid,
  p_valid_from        date,
  p_daily_cost        numeric,
  p_reason            text,
  p_valid_to          date    default null,
  p_encerrar_anterior boolean default false,
  p_ot_hourly_cost    numeric default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_hora   numeric;
  v_aberta public.employee_cost_terms%rowtype;
  v_novo   public.employee_cost_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  v_hora := public.condicoes_validar_hora_extra(p_ot_hourly_cost);

  if p_employee_id is null or p_valid_from is null or p_daily_cost is null then
    raise exception 'Colaborador, início da vigência e custo são obrigatórios.' using errcode = '22023';
  end if;
  if p_daily_cost <> round(p_daily_cost, 2) then
    raise exception 'O custo diário aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'Colaborador não encontrado.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_colaborador:' || p_employee_id::text, 0));

  if coalesce(p_encerrar_anterior, false) then
    select * into v_aberta
      from public.employee_cost_terms
     where employee_id = p_employee_id and active and valid_to is null
     for update;
    if found and v_aberta.valid_from < p_valid_from then
      perform public.condicoes_encerrar_colaborador_interno(v_aberta.id, p_valid_from, v_motivo);
    end if;
  end if;

  begin
    insert into public.employee_cost_terms
      (employee_id, valid_from, valid_to, daily_cost, ot_hourly_cost, origin, reason, created_by)
    values
      (p_employee_id, p_valid_from, p_valid_to, p_daily_cost, v_hora, 'informada', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência informada se sobrepõe a outra versão ativa deste colaborador.'
      using errcode = '23P01',
            hint = 'Encerre a versão anterior, informe a data final ou use p_encerrar_anterior.';
  end;

  perform public.condicoes_auditar('colaborador_custo_registrado', 'colaborador', p_employee_id, v_novo.id,
    null, to_jsonb(v_novo) || jsonb_build_object(
      'retroativa', p_valid_from < (now() at time zone 'America/Sao_Paulo')::date), v_motivo);

  return v_novo.id;
end;
$$;

-- Correção: o valor-hora é informado de novo, como o custo. NULL = a versão corrigida fica sem
-- valor acordado (a tela pré-preenche o valor da versão substituída).
create function public.corrigir_custo_colaborador(
  p_term_id        uuid,
  p_valid_from     date,
  p_valid_to       date,
  p_daily_cost     numeric,
  p_reason         text,
  p_ot_hourly_cost numeric default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo   text;
  v_hora     numeric;
  v_ant      public.employee_cost_terms%rowtype;
  v_apos     public.employee_cost_terms%rowtype;
  v_novo     public.employee_cost_terms%rowtype;
  v_employee uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  v_hora := public.condicoes_validar_hora_extra(p_ot_hourly_cost);

  if p_term_id is null or p_valid_from is null or p_daily_cost is null then
    raise exception 'Versão, início da vigência e custo são obrigatórios.' using errcode = '22023';
  end if;
  if p_daily_cost <> round(p_daily_cost, 2) then
    raise exception 'O custo diário aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;

  select employee_id into v_employee from public.employee_cost_terms where id = p_term_id;
  if not found then
    raise exception 'Versão de custo do colaborador não encontrada.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_colaborador:' || v_employee::text, 0));

  select * into v_ant from public.employee_cost_terms where id = p_term_id for update;
  if not v_ant.active then
    raise exception 'Só uma versão ativa pode ser corrigida.' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.timesheet_entries te
      join public.timesheets t on t.id = te.timesheet_id
     where te.employee_cost_terms_id = p_term_id
       and not (t.work_date >= p_valid_from and (p_valid_to is null or t.work_date < p_valid_to))
  ) then
    raise exception 'Há apontamentos que usam esta versão fora da nova vigência; a correção os deixaria sem cobertura.'
      using errcode = '55000';
  end if;

  update public.employee_cost_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_apos;

  begin
    insert into public.employee_cost_terms
      (employee_id, valid_from, valid_to, daily_cost, ot_hourly_cost, origin, reason, created_by)
    values
      (v_employee, p_valid_from, p_valid_to, p_daily_cost, v_hora, 'correcao', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência corrigida se sobrepõe a outra versão ativa deste colaborador.'
      using errcode = '23P01';
  end;

  update public.employee_cost_terms set replaced_by = v_novo.id where id = p_term_id
    returning * into v_apos;

  perform public.condicoes_auditar('colaborador_custo_corrigido', 'colaborador', v_employee, v_novo.id,
    to_jsonb(v_ant), to_jsonb(v_novo) || jsonb_build_object('substitui', p_term_id), v_motivo);

  return v_novo.id;
end;
$$;

create function public.criar_colaborador_com_vigencia(
  p_name           text,
  p_doc            text,
  p_role           text,
  p_phone          text,
  p_status         text,
  p_daily_cost     numeric,
  p_valid_from     date,
  p_reason         text,
  p_ot_hourly_cost numeric default null
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.employees (name, doc, role, phone, status, daily_cost)
  values (p_name, p_doc, p_role, p_phone, p_status::public.record_status, p_daily_cost)
  returning id into v_id;

  perform public.registrar_custo_colaborador(v_id, p_valid_from, p_daily_cost, p_reason,
    null, false, p_ot_hourly_cost);

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Motor por vigência: valor-hora acordado e custo proporcional
-- ---------------------------------------------------------------------------
--
-- Mesmo corpo da 025, com três mudanças marcadas (B8.10): o snapshot do valor-hora, o custo da
-- hora extra pelo valor acordado e o custo-base proporcional na saída antecipada.

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
      new.worked_minutes          := old.worked_minutes;
      new.overtime_minutes        := old.overtime_minutes;
      new.daily_rate_snapshot     := old.daily_rate_snapshot;
      new.ot_hour_rate_snapshot   := old.ot_hour_rate_snapshot;
      new.daily_cost_snapshot     := old.daily_cost_snapshot;
      new.ot_hourly_cost_snapshot := old.ot_hourly_cost_snapshot;
      new.billed_amount           := old.billed_amount;
      new.cost_amount             := old.cost_amount;
      return new;
    end if;
  end if;

  -- Apontamento LEGADO de presença/reposição (sem origem de preço) segue congelado para
  -- qualquer edição motriz, inclusive virar falta: zerá-lo apagaria o único registro do valor
  -- antigo, e voltar a presença o reprecificaria sem a prévia e a trilha da regularização.
  -- Só `regularizar_apontamento_legado` (que muda a origem) passa por aqui.
  if tg_op = 'UPDATE' and old.status <> 'absent'
     and old.terms_origin is null and new.terms_origin is null then
    raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
      using errcode = '55000',
            hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
  end if;

  -- Falta não gera diária trabalhada nem cobrança: não há preço a comprovar, então não exige
  -- vigência, não lê versão e não inventa referência nem snapshot. Valores zerados.
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
    new.worked_minutes   := 0;
    new.overtime_minutes := 0;
    new.billed_amount    := 0;
    new.cost_amount      := 0;
    return new;
  end if;

  -- Data, operação e turno vêm da FOLHA, nunca do payload.
  select t.work_date, t.operation_id, t.shift_id
    into _work_date, _operation, _shift
    from public.timesheets t
   where t.id = new.timesheet_id;
  if not found then
    return new; -- o trigger de chave recusa a folha inexistente (23503)
  end if;

  -- Apontamento NOVO, que MUDA DE FOLHA ou que SAI DE FALTA é precificado pelas versões da
  -- data trabalhada; os demais mantêm o preço já gravado.
  _precificar := case
    when tg_op = 'INSERT' then true
    else new.timesheet_id is distinct from old.timesheet_id or old.status = 'absent'
  end;

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
    -- B8.10: valor-hora acordado da versão de custo da data (NULL = sem valor acordado).
    select ot_hourly_cost into _ot_hourly from public.employee_cost_terms where id = _employee_terms_id;

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

      -- B8.10: o valor-hora segue a versão de custo do apontamento. Mesma versão: o congelado
      -- (de OLD; o payload não o informa). Versão nova (troca de colaborador ou regularização):
      -- o da versão nova.
      if _employee_terms_id is distinct from old.employee_cost_terms_id then
        select ot_hourly_cost into _ot_hourly from public.employee_cost_terms where id = _employee_terms_id;
      else
        _ot_hourly := old.ot_hourly_cost_snapshot;
      end if;
    else
      raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
        using errcode = '55000',
              hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
    end if;
  end if;

  -- A partir daqui, a aritmética da cobrança é a de `derivar_valores_financeiros` (010).
  _shift_hours_efetivo := case
    when _shift_hours is not null and _shift_hours > 0 then _shift_hours else 8
  end;
  _ot_factor_efetivo := case
    when _ot_factor is null or _ot_factor = 0 then 1 else _ot_factor
  end;

  _daily_rate        := coalesce(_daily_rate, 0);
  _daily_cost        := coalesce(_daily_cost, 0);
  _ot_hour_rate      := (_daily_rate / _shift_hours_efetivo) * _ot_factor_efetivo;
  -- B8.10: hora extra paga pelo valor-hora acordado; sem ele, diária de custo ÷ jornada.
  _ot_cost_hour_rate := case
    when _ot_hourly is not null then _ot_hourly::double precision
    else _daily_cost / _shift_hours_efetivo
  end;

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

    -- B8.10: saída antecipada paga proporcionalmente às horas trabalhadas (só com os dois
    -- horários; sem eles a regra está pendente e a diária de custo segue inteira). A cobrança
    -- ao cliente não muda.
    _base_cost := case
      when new.check_in is not null and new.check_out is not null and _worked < _planned_efetivo
        then _daily_cost * _worked / _planned_efetivo
      else _daily_cost
    end;

    _billed := round((( _daily_rate + _ot_horas * _ot_hour_rate) * 100)::numeric) / 100;
    _cost   := round((( _base_cost + _ot_horas * _ot_cost_hour_rate) * 100)::numeric) / 100;
  end if;

  new.worked_minutes          := _worked::integer;
  new.overtime_minutes        := _overtime::integer;
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
-- 5. Adicionais de serviço, separados da diária
-- ---------------------------------------------------------------------------

create table public.billing_additionals (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id),
  operation_id  uuid references public.operations (id),
  period_start  date not null,
  period_end    date not null,
  description   text not null,
  reference     text,
  amount        numeric(12,2) not null,
  invoice_id    uuid references public.invoices (id),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  canceled_at   timestamptz,
  canceled_by   uuid references auth.users (id) on delete set null,
  cancel_reason text,
  constraint billing_additionals_periodo_valido check (period_end >= period_start),
  constraint billing_additionals_valor_positivo check (amount > 0),
  constraint billing_additionals_descricao_valida
    check (char_length(btrim(description)) between 1 and 500),
  constraint billing_additionals_referencia_valida
    check (reference is null or char_length(btrim(reference)) between 1 and 200),
  constraint billing_additionals_cancelamento_coerente check (
    (canceled_at is null and cancel_reason is null)
    or (canceled_at is not null and char_length(btrim(cancel_reason)) > 0)),
  constraint billing_additionals_cancelado_sem_fatura check (canceled_at is null or invoice_id is null)
);

create index billing_additionals_cliente_periodo_idx
  on public.billing_additionals (client_id, period_start, period_end);
create index billing_additionals_fatura_idx
  on public.billing_additionals (invoice_id) where invoice_id is not null;
create index billing_additionals_operacao_idx
  on public.billing_additionals (operation_id) where operation_id is not null;

comment on table public.billing_additionals is
  'Valores adicionais de servico (etiquetagem, separacao, conteiner...) do periodo, separados da diaria. Escrita so por registrar_adicional/cancelar_adicional (admin AAL2, trilha); vinculo de fatura so por gerar_fatura. Nao se apaga.';

alter table public.billing_additionals enable row level security;

create policy billing_additionals_leitura_admin on public.billing_additionals
  for select to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

create policy billing_additionals_exige_admin_aal2 on public.billing_additionals
  as restrictive for all to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)))
  with check (((select auth.jwt() ->> 'aal') = 'aal2')
              and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

revoke all on table public.billing_additionals from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.billing_additionals to authenticated;

-- Imutável, sem DELETE nem TRUNCATE. Duas transições, uma vez cada:
--   cancelamento (não faturado) -> canceled_at/by/reason;
--   vínculo de fatura (não cancelado) -> invoice_id, só em execução como postgres (gerar_fatura).
create or replace function public.proteger_adicional()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Adicional de serviço não é apagado: cancele com motivo.' using errcode = '42501';
  end if;

  if old.invoice_id is not null then
    raise exception 'Adicional faturado é imutável.' using errcode = '42501';
  end if;
  if old.canceled_at is not null then
    raise exception 'Adicional cancelado é imutável.' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array['invoice_id', 'canceled_at', 'canceled_by', 'cancel_reason'])
     is distinct from (to_jsonb(old) - array['invoice_id', 'canceled_at', 'canceled_by', 'cancel_reason']) then
    raise exception 'Valor, motivo, referência, período e cliente de um adicional não mudam: cancele e registre outro.'
      using errcode = '42501';
  end if;

  if new.invoice_id is not null and current_user <> 'postgres' then
    raise exception 'O vínculo de fatura do adicional só nasce na geração da fatura.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_billing_additionals_imutavel
  before update or delete on public.billing_additionals
  for each row execute function public.proteger_adicional();

create trigger trg_billing_additionals_sem_truncate
  before truncate on public.billing_additionals
  for each statement execute function public.proteger_adicional();

create or replace function public.registrar_adicional(
  p_client_id    uuid,
  p_period_start date,
  p_period_end   date,
  p_description  text,
  p_amount       numeric,
  p_reference    text default null,
  p_operation_id uuid default null
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

  insert into public.billing_additionals
    (client_id, operation_id, period_start, period_end, description, reference, amount, created_by)
  values
    (p_client_id, p_operation_id, p_period_start, p_period_end, v_descricao, v_referencia, p_amount, auth.uid())
  returning * into v_novo;

  perform public.condicoes_auditar('adicional_registrado', 'adicional', v_novo.id, v_novo.id,
    null, to_jsonb(v_novo), v_descricao);

  return v_novo.id;
end;
$$;

create or replace function public.cancelar_adicional(
  p_additional_id uuid,
  p_reason        text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo  text;
  v_cliente uuid;
  v_ant     public.billing_additionals%rowtype;
  v_dep     public.billing_additionals%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_additional_id is null then
    raise exception 'O adicional é obrigatório.' using errcode = '22023';
  end if;

  select client_id into v_cliente from public.billing_additionals where id = p_additional_id;
  if not found then
    raise exception 'Adicional não encontrado.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_cliente::text, 0));

  select * into v_ant from public.billing_additionals where id = p_additional_id for update;
  if v_ant.invoice_id is not null then
    raise exception 'Adicional faturado é imutável e não pode ser cancelado.' using errcode = '55000';
  end if;
  if v_ant.canceled_at is not null then
    raise exception 'O adicional já está cancelado.' using errcode = '55000';
  end if;

  update public.billing_additionals
     set canceled_at = now(), canceled_by = auth.uid(), cancel_reason = v_motivo
   where id = p_additional_id
  returning * into v_dep;

  perform public.condicoes_auditar('adicional_cancelado', 'adicional', p_additional_id, p_additional_id,
    to_jsonb(v_ant), to_jsonb(v_dep), v_motivo);
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. gerar_fatura com os adicionais do período
-- ---------------------------------------------------------------------------
--
-- Corpo da 009 com três acréscimos: seleciona e trava os adicionais elegíveis, soma-os ao total
-- (um item por adicional) e os vincula. Sem adicional elegível, o resultado é idêntico ao de
-- antes. Fatura só de adicionais é aceita (preço avulso por serviço completo).

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
begin
  -- 1. Sessão autenticada, segundo fator e papel (SECURITY DEFINER roda acima da RLS).
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

  -- 2. Parâmetros
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

  -- 3. Serializa a geração por cliente até o fim da transação (a mesma chave trava o registro
  --    e o cancelamento de adicionais).
  perform pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));

  -- 4. Seleciona e trava os apontamentos elegíveis.
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

  -- 4b. Adicionais não cancelados e não faturados cujo período está DENTRO do da fatura.
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

  -- 5. Fatura. Os totais são somados aqui, a partir do que está gravado; o navegador não
  --    informa valor nenhum. Adicional entra no total, não em diárias, extras nem custo.
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
    coalesce(round(sum(te.overtime_minutes)::numeric / 60, 2), 0),
    coalesce(sum(te.billed_amount), 0) + _total_adic,
    coalesce(sum(te.cost_amount), 0)
  from public.timesheet_entries te
  where te.id = any(_ids)
  returning * into _fatura;

  -- 6. Itens: uma linha de diárias por operação (billed_amount - daily_rate_snapshot é o
  --    valor de hora extra, a mesma fórmula de src/lib/ledger.ts).
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

  -- 7. Itens: uma linha de horas extras por operação, só quando houver valor.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount
  )
  select
    _fatura.id,
    o.id,
    o.name || ' — horas extras',
    round(sum(te.overtime_minutes)::numeric / 60, 2),
    case
      when sum(te.overtime_minutes) > 0
        then round(
          sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
          / (sum(te.overtime_minutes)::numeric / 60), 2)
      else 0
    end,
    sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name
  having sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)) > 0;

  -- 7b. Itens: um por adicional, com motivo e referência.
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

  -- 8. Vínculo. `invoice_id IS NULL` é repetido de propósito.
  update public.timesheet_entries te
  set invoice_id = _fatura.id
  where te.id = any(_ids)
    and te.invoice_id is null;

  get diagnostics _vinculados = row_count;

  -- 9. Se vinculou menos do que selecionou, alguém alterou os dados no meio.
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
  'Gera uma fatura em transação única: seleciona apontamentos não faturados do '
  'cliente no período e os adicionais de serviço contidos no período, soma os '
  'totais no servidor, cria invoice e invoice_items e vincula tudo. Exige papel '
  'admin e sessão aal2. Qualquer falha desfaz tudo.';

revoke all on function public.gerar_fatura(uuid, date, date) from public;
revoke all on function public.gerar_fatura(uuid, date, date) from anon;
grant execute on function public.gerar_fatura(uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Estado do motor: anuncia as regras desta migration
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
                        else _novo = 'D' and _antigo = 'O' and _trav = 0 end,
    -- B8.10: valor-hora acordado, custo proporcional e adicionais disponíveis (migration 029).
    'regras_bs', true);
end;
$$;


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
       and p.proname in (
         'recusar_entrada_igual_saida', 'bloquear_colunas_de_condicoes', 'condicoes_validar_hora_extra',
         'registrar_custo_colaborador', 'corrigir_custo_colaborador', 'criar_colaborador_com_vigencia',
         'derivar_valores_por_vigencia', 'proteger_adicional', 'registrar_adicional',
         'cancelar_adicional', 'estado_motor_vigencia')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('registrar_custo_colaborador', 'corrigir_custo_colaborador', 'criar_colaborador_com_vigencia',
                   'registrar_adicional', 'cancelar_adicional', 'estado_motor_vigencia') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.registrar_custo_colaborador(uuid, date, numeric, text, date, boolean, numeric) is
  'Admin AAL2. Registra versao de custo do colaborador (custo diario e, opcional, valor-hora acordado da hora extra paga), com motivo e trilha.';
comment on function public.corrigir_custo_colaborador(uuid, date, date, numeric, text, numeric) is
  'Admin AAL2. Aposenta a versao e registra a correcao (custo diario e valor-hora acordado informados de novo; NULL = sem valor acordado).';
comment on function public.criar_colaborador_com_vigencia(text, text, text, text, text, numeric, date, text, numeric) is
  'Admin AAL2. Cria o colaborador e o custo inicial (com valor-hora opcional) na mesma transacao. SECURITY INVOKER; o custo vai pela registrar_custo_colaborador.';
comment on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid) is
  'Admin AAL2. Registra adicional de servico do periodo (motivo, valor, referencia, operacao opcional do cliente), separado da diaria, com trilha.';
comment on function public.cancelar_adicional(uuid, text) is
  'Admin AAL2. Cancela adicional nao faturado, com motivo e trilha. Adicional nao e apagado.';


-- ---------------------------------------------------------------------------
-- 9. Autoverificação (estrutural)
-- ---------------------------------------------------------------------------

do $verificacao$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_timesheet_entries_bloqueia_horario_igual'
                  and tgenabled = 'O' and not tgisinternal) then
    raise exception '029: o bloqueio de entrada igual à saída deve nascer habilitado.';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('registrar_custo_colaborador', 'corrigir_custo_colaborador', 'criar_colaborador_com_vigencia')) <> 3 then
    raise exception '029: as RPCs de custo devem ter uma única assinatura cada.';
  end if;
  if has_table_privilege('authenticated', 'public.billing_additionals', 'INSERT')
     or has_table_privilege('authenticated', 'public.billing_additionals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.billing_additionals', 'DELETE')
     or has_table_privilege('bslog_rpc_operacional', 'public.billing_additionals', 'SELECT') then
    raise exception '029: adicionais só se escrevem por RPC e o operacional não os lê.';
  end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'ot_hourly_cost_snapshot', 'SELECT') then
    raise exception '029: o operacional não lê o valor-hora da hora extra paga.';
  end if;
  -- O motor antigo não muda (as regras novas valem no motor por vigência).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname = 'derivar_valores_financeiros' and prosrc ilike '%ot_hourly%') then
    raise exception '029: o motor antigo (010) não deve ser alterado.';
  end if;
end;
$verificacao$;
