-- Vigência do valor acordado por operação e proteção dormente de turnos (C05-B, etapa 3.2).
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Uma operação SEM contrato é cobrada pelo `operations.agreed_amount` (a derivação usa
-- `daily_rate = agreed_amount`, jornada 8 h, fator 1, tolerância 10). Esse valor é uma
-- coluna mutável: reajustá-lo hoje reescreveria, no próximo recálculo, a diária de qualquer
-- apontamento antigo ainda não faturado. As migrations 022 e 023 deram histórico a contrato e
-- a colaborador; a regra de negócio (D1) exige o mesmo para o valor acordado, por data
-- trabalhada. Esta migration é aditiva e termina a EXPANSÃO do modelo: depois dela todas as
-- fontes do cálculo têm onde guardar sua história, e a derivação por vigência pode ser escrita.
--
-- O QUE ELA FAZ
--
--   1. `public.operation_terms`: versões do valor acordado por operação, com o mesmo desenho
--      de `contract_terms` (intervalo [valid_from, valid_to), exclusão GiST entre ativas,
--      aposentadoria, motivo, origem, autoria). Vazia: nenhum histórico é presumido.
--   2. `timesheet_entries.operation_terms_id`: referência anulável (NO ACTION) à versão usada.
--      Só o sistema a preenche (guard próprio, como as colunas da 022). `terms_origin =
--      'valor_acordado'`, já aceito pela 022, é o rótulo das linhas que a usarem.
--   3. RPCs administrativas de operação, espelho das de contrato da 023:
--        registrar_valor_acordado_operacao / corrigir_valor_acordado_operacao /
--        encerrar_valor_acordado_operacao / aposentar_valor_acordado_operacao /
--        valor_acordado_operacao_na_data  (admin AAL2)
--        exigir_valor_acordado_operacao_na_data  (interna, sem EXECUTE de API; P0002 sem
--        histórico, nunca cai em `operations.agreed_amount`)
--      Reutilizam, sem alterá-los, `condicoes_exigir_admin`, `condicoes_validar_motivo`,
--      `condicoes_auditar` e `proteger_versao_financeira` da 023.
--   4. Trilha: o CHECK de `financial_terms_audit` passa a aceitar a entidade 'operacao' e
--      quatro ações novas. Os eventos antigos e a imutabilidade da trilha ficam como estão.
--   5. Turnos (D2): `congelar_jornada_de_turno_usado()` e o trigger
--      `trg_shifts_congela_jornada_usada`, criado DESABILITADO. Quando habilitado, recusa
--      mudar início, fim, intervalo ou virada de meia-noite de um turno que já tem
--      apontamento, e o caminho passa a ser cadastrar um turno novo. Ver "TURNOS".
--
-- O QUE ELA NÃO FAZ (de propósito)
--
--   * Não substitui `derivar_valores_financeiros`, não altera `gerar_fatura`, não recalcula,
--     não preenche nenhum snapshot e não cria nenhuma versão. O dinheiro continua sendo
--     calculado exatamente como antes.
--   * Não altera `operations.agreed_amount` nem a tela de Operações: ela continua gravando o
--     valor por UPDATE direto. O bloqueio dessa edição fica para a migration de ativação,
--     junto com a interface.
--   * Não habilita o congelamento de turno: com o trigger desabilitado, o formulário de
--     turnos funciona como hoje.
--
-- TURNOS (D2)
--
--   A jornada prevista é lida do turno a cada recálculo. Editar o horário de um turno já usado
--   mudaria, no recálculo seguinte, a hora extra de apontamentos antigos, e mudaria a
--   interpretação de qualquer apontamento retroativo novo naquela folha. O menor mecanismo que
--   fecha isso é congelar a jornada do turno que já tem apontamento, mantendo editáveis o
--   nome e o status, e exigir um turno novo (e inativar o antigo) para mudar o horário. O
--   formulário de turnos já envia o objeto inteiro: um reenvio de horário IGUAL não é mudança
--   e não é recusado. A derivação futura grava `planned_minutes_snapshot` e reaproveita o
--   valor gravado enquanto o turno da folha não mudar. Habilitar o trigger exige que a tela
--   traduza o erro (SQLSTATE 23514) e ofereça "novo turno": dependência da ativação.
--
-- LIMITES CONHECIDOS (a tratar na migration de ativação)
--
--   * `operations.contract_id` continua mutável: trocar uma operação de "sem contrato" para
--     "com contrato" muda qual fonte a derivação escolhe para apontamentos NOVOS naquela
--     operação. Apontamentos já derivados guardam a origem em `terms_origin`.
--   * A verificação "turno usado" é uma leitura no momento da edição, sem trava: uma criação
--     de apontamento concorrente pode passar. O snapshot de jornada é a defesa em profundidade.
--
-- REVERSÃO (as tabelas novas estão vazias). Os dois últimos `alter table` restauram o CHECK
-- da trilha ao conjunto anterior e SÓ valem se a trilha não tiver nenhum evento de operação
-- (ela é append-only: não há como apagá-los). Havendo eventos, execute tudo MENOS esses dois
-- `alter table`: o CHECK ampliado apenas aceita mais valores e não afeta nada.
--
--   drop trigger trg_shifts_congela_jornada_usada on public.shifts;
--   drop function public.congelar_jornada_de_turno_usado();
--   drop function public.registrar_valor_acordado_operacao(uuid, date, numeric, text, date, boolean);
--   drop function public.corrigir_valor_acordado_operacao(uuid, date, date, numeric, text);
--   drop function public.encerrar_valor_acordado_operacao(uuid, date, text);
--   drop function public.aposentar_valor_acordado_operacao(uuid, text);
--   drop function public.valor_acordado_operacao_na_data(uuid, date);
--   drop function public.exigir_valor_acordado_operacao_na_data(uuid, date);
--   drop function public.condicoes_encerrar_operacao_interno(uuid, date, text);
--   drop trigger trg_timesheet_entries_bloqueia_condicoes_operacao on public.timesheet_entries;
--   drop function public.bloquear_coluna_de_valor_acordado();
--   alter table public.timesheet_entries drop column operation_terms_id;
--   drop table public.operation_terms;
--   alter table public.financial_terms_audit
--     drop constraint financial_terms_audit_acao_valida,
--     drop constraint financial_terms_audit_entidade_valida;
--   alter table public.financial_terms_audit
--     add constraint financial_terms_audit_acao_valida check (action in (
--       'contrato_condicao_registrada', 'contrato_condicao_corrigida',
--       'contrato_condicao_encerrada', 'contrato_condicao_aposentada',
--       'colaborador_custo_registrado', 'colaborador_custo_corrigido',
--       'colaborador_custo_encerrado', 'colaborador_custo_aposentado')),
--     add constraint financial_terms_audit_entidade_valida check (entity_kind in ('contrato', 'colaborador'));


-- ---------------------------------------------------------------------------
-- 1. Trilha: aceita a entidade 'operacao'
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
    'operacao_valor_encerrado', 'operacao_valor_aposentado'
  )),
  add constraint financial_terms_audit_entidade_valida check (entity_kind in ('contrato', 'colaborador', 'operacao'));


-- ---------------------------------------------------------------------------
-- 2. Versões do valor acordado por operação
-- ---------------------------------------------------------------------------

create table public.operation_terms (
  id             uuid primary key default gen_random_uuid(),
  operation_id   uuid not null references public.operations (id) on delete cascade,
  valid_from     date not null,
  valid_to       date,
  agreed_amount  numeric(12,2) not null,
  active         boolean not null default true,
  origin         text not null,
  reason         text not null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  retired_at     timestamptz,
  replaced_by    uuid references public.operation_terms (id),
  constraint operation_terms_periodo_valido
    check (valid_to is null or valid_to > valid_from),
  constraint operation_terms_valor_nao_negativo check (agreed_amount >= 0),
  constraint operation_terms_origem_valida
    check (origin in ('informada', 'migrada_por_prova', 'correcao')),
  constraint operation_terms_motivo_obrigatorio check (btrim(reason) <> ''),
  constraint operation_terms_aposentadoria_coerente
    check ((active and retired_at is null and replaced_by is null)
        or (not active and retired_at is not null)),
  constraint operation_terms_sem_sobreposicao
    exclude using gist (
      operation_id with =,
      daterange(valid_from, valid_to, '[)') with &&
    ) where (active)
);

create index operation_terms_busca_idx
  on public.operation_terms (operation_id, valid_from desc) where active;
create index operation_terms_substituida_por_idx
  on public.operation_terms (replaced_by) where replaced_by is not null;

alter table public.operation_terms enable row level security;

create policy operation_terms_leitura_admin on public.operation_terms
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  );

create policy operation_terms_exige_admin_aal2 on public.operation_terms
  as restrictive for all to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  with check (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  );

revoke all on table public.operation_terms from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.operation_terms to authenticated;

create trigger trg_operation_terms_imutavel
  before update on public.operation_terms
  for each row execute function public.proteger_versao_financeira();


-- ---------------------------------------------------------------------------
-- 3. Referência do apontamento à versão do valor acordado
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries
  add column operation_terms_id uuid references public.operation_terms (id);

create index idx_timesheet_entries_operation_terms
  on public.timesheet_entries (operation_terms_id) where operation_terms_id is not null;

create or replace function public.bloquear_coluna_de_valor_acordado()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Mesmo critério do guard da 022: só o sistema (postgres, service_role) preenche a
  -- referência. Reenviar o valor atual de um apontamento existente não é mudança.
  if current_user not in ('postgres', 'service_role') then
    if tg_op = 'INSERT' then
      if new.operation_terms_id is not null then
        raise exception 'A referência à versão do valor acordado é derivada pelo sistema e não pode ser informada.'
          using errcode = '42501';
      end if;
    elsif new.operation_terms_id is distinct from old.operation_terms_id then
      raise exception 'A referência à versão do valor acordado é derivada pelo sistema e não pode ser alterada.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bloquear_coluna_de_valor_acordado() from public, anon, authenticated, service_role;

-- O nome ordena antes de `trg_timesheet_entries_bloqueio_financeiro` e
-- `trg_timesheet_entries_calculo_financeiro` (disparo alfabético).
create trigger trg_timesheet_entries_bloqueia_condicoes_operacao
  before insert or update on public.timesheet_entries
  for each row execute function public.bloquear_coluna_de_valor_acordado();


-- ---------------------------------------------------------------------------
-- 4. Encerramento interno (sem verificação de papel: só as RPCs públicas chamam)
-- ---------------------------------------------------------------------------

create or replace function public.condicoes_encerrar_operacao_interno(
  p_term_id  uuid,
  p_valid_to date,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ant public.operation_terms%rowtype;
  v_dep public.operation_terms%rowtype;
begin
  select * into v_ant from public.operation_terms where id = p_term_id for update;
  if not found then
    raise exception 'Versão do valor acordado não encontrada.' using errcode = 'P0002';
  end if;
  if not v_ant.active then
    raise exception 'A versão está aposentada e não pode ser encerrada.' using errcode = '55000';
  end if;
  if p_valid_to <= v_ant.valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência (%).', v_ant.valid_from
      using errcode = '22023';
  end if;
  if v_ant.valid_to is not null and p_valid_to >= v_ant.valid_to then
    raise exception 'A data final só pode ser antecipada (atual: %).', v_ant.valid_to
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.timesheet_entries te
      join public.timesheets t on t.id = te.timesheet_id
     where te.operation_terms_id = p_term_id and t.work_date >= p_valid_to
  ) then
    raise exception 'Há apontamentos que usam esta versão em datas a partir de %; o encerramento os deixaria sem cobertura.', p_valid_to
      using errcode = '55000';
  end if;

  update public.operation_terms set valid_to = p_valid_to where id = p_term_id
    returning * into v_dep;

  perform public.condicoes_auditar('operacao_valor_encerrado', 'operacao', v_dep.operation_id, p_term_id,
    to_jsonb(v_ant), to_jsonb(v_dep), p_reason);
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. RPCs do valor acordado
-- ---------------------------------------------------------------------------

create or replace function public.registrar_valor_acordado_operacao(
  p_operation_id      uuid,
  p_valid_from        date,
  p_agreed_amount     numeric,
  p_reason            text,
  p_valid_to          date    default null,
  p_encerrar_anterior boolean default false
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo text;
  v_aberta public.operation_terms%rowtype;
  v_novo   public.operation_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);

  if p_operation_id is null or p_valid_from is null or p_agreed_amount is null then
    raise exception 'Operação, início da vigência e valor acordado são obrigatórios.' using errcode = '22023';
  end if;
  if p_agreed_amount <> round(p_agreed_amount, 2) then
    raise exception 'O valor acordado aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.operations where id = p_operation_id) then
    raise exception 'Operação não encontrada.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_operacao:' || p_operation_id::text, 0));

  if coalesce(p_encerrar_anterior, false) then
    select * into v_aberta
      from public.operation_terms
     where operation_id = p_operation_id and active and valid_to is null
     for update;
    if found and v_aberta.valid_from < p_valid_from then
      perform public.condicoes_encerrar_operacao_interno(v_aberta.id, p_valid_from, v_motivo);
    end if;
  end if;

  begin
    insert into public.operation_terms
      (operation_id, valid_from, valid_to, agreed_amount, origin, reason, created_by)
    values
      (p_operation_id, p_valid_from, p_valid_to, p_agreed_amount, 'informada', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência informada se sobrepõe a outra versão ativa desta operação.'
      using errcode = '23P01',
            hint = 'Encerre a versão anterior, informe a data final ou use p_encerrar_anterior.';
  end;

  perform public.condicoes_auditar('operacao_valor_registrado', 'operacao', p_operation_id, v_novo.id,
    null, to_jsonb(v_novo) || jsonb_build_object(
      'retroativa', p_valid_from < (now() at time zone 'America/Sao_Paulo')::date), v_motivo);

  return v_novo.id;
end;
$$;

create or replace function public.corrigir_valor_acordado_operacao(
  p_term_id       uuid,
  p_valid_from    date,
  p_valid_to      date,
  p_agreed_amount numeric,
  p_reason        text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo    text;
  v_ant       public.operation_terms%rowtype;
  v_apos      public.operation_terms%rowtype;
  v_novo      public.operation_terms%rowtype;
  v_operation uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);

  if p_term_id is null or p_valid_from is null or p_agreed_amount is null then
    raise exception 'Versão, início da vigência e valor acordado são obrigatórios.' using errcode = '22023';
  end if;
  if p_agreed_amount <> round(p_agreed_amount, 2) then
    raise exception 'O valor acordado aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'A data final deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;

  select operation_id into v_operation from public.operation_terms where id = p_term_id;
  if not found then
    raise exception 'Versão do valor acordado não encontrada.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('condicoes_operacao:' || v_operation::text, 0));

  select * into v_ant from public.operation_terms where id = p_term_id for update;
  if not v_ant.active then
    raise exception 'Só uma versão ativa pode ser corrigida.' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.timesheet_entries te
      join public.timesheets t on t.id = te.timesheet_id
     where te.operation_terms_id = p_term_id
       and not (t.work_date >= p_valid_from and (p_valid_to is null or t.work_date < p_valid_to))
  ) then
    raise exception 'Há apontamentos que usam esta versão fora da nova vigência; a correção os deixaria sem cobertura.'
      using errcode = '55000';
  end if;

  update public.operation_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_apos;

  begin
    insert into public.operation_terms
      (operation_id, valid_from, valid_to, agreed_amount, origin, reason, created_by)
    values
      (v_operation, p_valid_from, p_valid_to, p_agreed_amount, 'correcao', v_motivo, auth.uid())
    returning * into v_novo;
  exception when exclusion_violation then
    raise exception 'A vigência corrigida se sobrepõe a outra versão ativa desta operação.'
      using errcode = '23P01';
  end;

  update public.operation_terms set replaced_by = v_novo.id where id = p_term_id
    returning * into v_apos;

  perform public.condicoes_auditar('operacao_valor_corrigido', 'operacao', v_operation, v_novo.id,
    to_jsonb(v_ant), to_jsonb(v_novo) || jsonb_build_object('substitui', p_term_id), v_motivo);

  return v_novo.id;
end;
$$;

create or replace function public.encerrar_valor_acordado_operacao(
  p_term_id  uuid,
  p_valid_to date,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo    text;
  v_operation uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_term_id is null or p_valid_to is null then
    raise exception 'Versão e data final são obrigatórias.' using errcode = '22023';
  end if;
  select operation_id into v_operation from public.operation_terms where id = p_term_id;
  if not found then
    raise exception 'Versão do valor acordado não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_operacao:' || v_operation::text, 0));
  perform public.condicoes_encerrar_operacao_interno(p_term_id, p_valid_to, v_motivo);
end;
$$;

create or replace function public.aposentar_valor_acordado_operacao(
  p_term_id uuid,
  p_reason  text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo    text;
  v_operation uuid;
  v_ant       public.operation_terms%rowtype;
  v_dep       public.operation_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_term_id is null then
    raise exception 'A versão é obrigatória.' using errcode = '22023';
  end if;
  select operation_id into v_operation from public.operation_terms where id = p_term_id;
  if not found then
    raise exception 'Versão do valor acordado não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_operacao:' || v_operation::text, 0));

  select * into v_ant from public.operation_terms where id = p_term_id for update;
  if not v_ant.active then
    raise exception 'A versão já está aposentada.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries where operation_terms_id = p_term_id) then
    raise exception 'Há apontamentos que usam esta versão; use a correção, que registra a substituta.'
      using errcode = '55000';
  end if;

  update public.operation_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_dep;

  perform public.condicoes_auditar('operacao_valor_aposentado', 'operacao', v_operation, p_term_id,
    to_jsonb(v_ant), to_jsonb(v_dep), v_motivo);
end;
$$;

create or replace function public.valor_acordado_operacao_na_data(
  p_operation_id uuid,
  p_work_date    date
) returns setof public.operation_terms
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.condicoes_exigir_admin();
  if p_operation_id is null or p_work_date is null then
    raise exception 'Operação e data são obrigatórias.' using errcode = '22023';
  end if;
  -- Zero linhas = sem histórico nessa data. Nunca cai para operations.agreed_amount.
  return query
    select * from public.operation_terms
     where operation_id = p_operation_id and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date;
end;
$$;

create or replace function public.exigir_valor_acordado_operacao_na_data(
  p_operation_id uuid,
  p_work_date    date
) returns public.operation_terms
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_termo public.operation_terms%rowtype;
begin
  select * into v_termo from public.operation_terms
   where operation_id = p_operation_id and active
     and daterange(valid_from, valid_to, '[)') @> p_work_date;
  if not found then
    raise exception 'Sem valor acordado vigente em % para a operação informada.', p_work_date
      using errcode = 'P0002',
            hint = 'Registre a vigência com motivo antes de apontar nesta data; não há fallback para operations.agreed_amount.';
  end if;
  return v_termo;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Dono, privilégios e comentários
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
         'condicoes_encerrar_operacao_interno', 'registrar_valor_acordado_operacao',
         'corrigir_valor_acordado_operacao', 'encerrar_valor_acordado_operacao',
         'aposentar_valor_acordado_operacao', 'valor_acordado_operacao_na_data',
         'exigir_valor_acordado_operacao_na_data')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in (
         'registrar_valor_acordado_operacao', 'corrigir_valor_acordado_operacao',
         'encerrar_valor_acordado_operacao', 'aposentar_valor_acordado_operacao',
         'valor_acordado_operacao_na_data') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on table public.operation_terms is
  'Versoes do valor acordado por operacao (vigencia [valid_from, valid_to)). Escrita so pelas RPCs da 024; leitura por admin em AAL2. Vazia por desenho: nenhum historico e presumido; operations.agreed_amount segue sendo a coluna usada pelo calculo atual.';
comment on function public.exigir_valor_acordado_operacao_na_data(uuid, date) is
  'Interna (sem EXECUTE de API). Devolve a versao vigente na data ou levanta P0002; nunca cai para operations.agreed_amount.';


-- ---------------------------------------------------------------------------
-- 7. Turnos: congelamento da jornada de turno usado — criado DESABILITADO
-- ---------------------------------------------------------------------------

create or replace function public.congelar_jornada_de_turno_usado()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if (new.start_time        is distinct from old.start_time
      or new.end_time         is distinct from old.end_time
      or new.break_minutes    is distinct from old.break_minutes
      or new.crosses_midnight is distinct from old.crosses_midnight)
     and current_user not in ('postgres', 'service_role') then
    -- Só o admin chega aqui com permissão de mudar a jornada (o guard de 011 recusa os
    -- demais). Para ele, a leitura de apontamentos não depende de RLS.
    if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
      raise exception 'Jornada do turno define o cálculo e não pode ser alterada por este papel.'
        using errcode = '42501';
    end if;
    if exists (
      select 1
        from public.timesheets t
        join public.timesheet_entries te on te.timesheet_id = t.id
       where t.shift_id = old.id
    ) then
      raise exception 'Este turno já tem apontamentos; cadastre um turno novo em vez de alterar o horário do existente.'
        using errcode = '23514',
              hint = 'Nome e status continuam editáveis. Inative o turno antigo depois de criar o novo.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.congelar_jornada_de_turno_usado() from public, anon, authenticated, service_role;

create trigger trg_shifts_congela_jornada_usada
  before update on public.shifts
  for each row execute function public.congelar_jornada_de_turno_usado();

-- DESABILITADO de propósito: o formulário de turnos ainda não traduz o erro nem oferece
-- "novo turno". A migration de ativação o habilita junto com a interface.
alter table public.shifts disable trigger trg_shifts_congela_jornada_usada;


-- ---------------------------------------------------------------------------
-- 8. Autoverificação (estrutural; a migration não escreve dado)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.operation_terms'::regclass) then
    raise exception '024: RLS desligada em operation_terms';
  end if;
  select count(*) into _n from pg_policies where schemaname = 'public' and tablename = 'operation_terms';
  if _n <> 2 then
    raise exception '024: operation_terms deveria ter 2 policies, encontrei %', _n;
  end if;
  if has_table_privilege('authenticated', 'public.operation_terms', 'INSERT')
     or has_table_privilege('authenticated', 'public.operation_terms', 'UPDATE')
     or has_table_privilege('authenticated', 'public.operation_terms', 'DELETE')
     or has_table_privilege('service_role', 'public.operation_terms', 'SELECT')
     or has_table_privilege('anon', 'public.operation_terms', 'SELECT')
     or has_table_privilege('bslog_rpc_operacional', 'public.operation_terms', 'SELECT') then
    raise exception '024: privilégio indevido em operation_terms';
  end if;

  select count(*) into _n from pg_constraint
   where conrelid = 'public.operation_terms'::regclass and contype = 'x';
  if _n <> 1 then
    raise exception '024: operation_terms deveria ter 1 exclusão de sobreposição, encontrei %', _n;
  end if;

  select count(*) into _n from pg_attribute
   where attrelid = 'public.timesheet_entries'::regclass and attname = 'operation_terms_id'
     and not attnotnull and not atthasdef and not attisdropped;
  if _n <> 1 then
    raise exception '024: operation_terms_id deveria ser anulável e sem DEFAULT';
  end if;
  if exists (select 1 from public.timesheet_entries where operation_terms_id is not null) then
    raise exception '024: nenhum apontamento deveria referenciar versão do valor acordado';
  end if;

  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('registrar_valor_acordado_operacao', 'corrigir_valor_acordado_operacao',
       'encerrar_valor_acordado_operacao', 'aposentar_valor_acordado_operacao', 'valor_acordado_operacao_na_data')
     and p.prosecdef and p.proowner = 'postgres'::regrole
     and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public, pg_temp%'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE');
  if _n <> 5 then
    raise exception '024: as 5 RPCs deveriam ser do postgres, SECURITY DEFINER e executáveis só por authenticated, encontrei %', _n;
  end if;

  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('exigir_valor_acordado_operacao_na_data', 'condicoes_encerrar_operacao_interno')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if _n <> 0 then
    raise exception '024: % função(ões) interna(s) executável(is) por papel de API', _n;
  end if;

  select count(*) into _n from pg_trigger
   where not tgisinternal and tgname = 'trg_shifts_congela_jornada_usada' and tgenabled = 'D';
  if _n <> 1 then
    raise exception '024: o congelamento de turno deveria existir e estar DESABILITADO';
  end if;
  select count(*) into _n from pg_trigger
   where not tgisinternal and tgname in ('trg_operation_terms_imutavel', 'trg_timesheet_entries_bloqueia_condicoes_operacao')
     and tgenabled = 'O';
  if _n <> 2 then
    raise exception '024: os 2 triggers de proteção deveriam estar habilitados, encontrei %', _n;
  end if;

  -- Derivação, faturamento e coluna de origem: intocados.
  select count(*) into _n from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('derivar_valores_financeiros', 'gerar_fatura')
     and (prosrc ilike '%operation_terms%' or prosrc ilike '%contract_terms%' or prosrc ilike '%employee_cost_terms%');
  if _n <> 0 then
    raise exception '024: derivar_valores_financeiros e gerar_fatura não deveriam citar as versões ainda';
  end if;

  select count(*) into _n from public.operation_terms;
  if _n <> 0 then
    raise exception '024: operation_terms deveria estar vazia, encontrei % linhas', _n;
  end if;
end;
$verificacao$;
