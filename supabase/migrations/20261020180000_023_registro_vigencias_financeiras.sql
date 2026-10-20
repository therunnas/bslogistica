-- Registro controlado de vigências financeiras (C05-B, etapa 3.1).
--
-- A migration 022 criou o ESQUEMA (`contract_terms`, `employee_cost_terms`, 7 colunas de
-- snapshot em `timesheet_entries`). Esta migration cria a ÚNICA porta de escrita nele:
-- RPCs administrativas que registram, corrigem, encerram e aposentam versões, mais a trilha
-- de auditoria que as acompanha. Nenhum cálculo financeiro usa as versões ainda.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. `financial_terms_audit`: trilha append-only (quem, quando, ação, valores anteriores e
--      novos, motivo). Escrita só pelas RPCs; leitura por admin em AAL2.
--   2. Imutabilidade das versões: os valores, o contrato/colaborador, a data inicial, a
--      origem, o motivo e a autoria nunca mudam. Só são aceitas três transições: encerrar
--      (ou encurtar) a data final, aposentar (active true -> false com retired_at) e apontar
--      `replaced_by` uma vez.
--   3. RPCs de escrita, SECURITY DEFINER do `postgres`, para contrato e para colaborador:
--        registrar_condicao_contrato / registrar_custo_colaborador
--        corrigir_condicao_contrato  / corrigir_custo_colaborador
--        encerrar_condicao_contrato  / encerrar_custo_colaborador
--        aposentar_condicao_contrato / aposentar_custo_colaborador
--   4. Consulta da condição aplicável a uma `work_date`:
--        condicao_contrato_na_data / custo_colaborador_na_data   (admin AAL2; 0 ou 1 linha)
--        exigir_condicao_contrato_na_data / exigir_custo_colaborador_na_data
--          (internas, para a derivação futura: SEM chamador de API; levantam P0002 quando
--           não há versão vigente na data — nunca devolvem a taxa atual no lugar)
--
-- O QUE ESTA MIGRATION NÃO FAZ (de propósito)
--
--   * Não substitui `derivar_valores_financeiros`, não altera `gerar_fatura`, não recalcula
--     nem preenche nenhum apontamento. As versões existem e são consultáveis; o dinheiro
--     continua sendo calculado exatamente como antes. A ativação é a migration de derivação
--     por vigência, posterior à expansão do valor acordado (024).
--   * Não bloqueia a edição direta de `contracts.daily_rate` etc. nem de `employees.daily_cost`.
--     As telas de Clientes/Contratos e Colaboradores gravam esses campos por `UPDATE` direto
--     (`useSaveRow`); um bloqueio isolado quebraria os formulários. O bloqueio, junto com o
--     mecanismo de compatibilidade da interface, fica para a migration de ativação.
--   * Não cria versão nenhuma: as tabelas continuam vazias. Não há versão fictícia para datas
--     históricas desconhecidas e não há fallback para a taxa atual.
--   * Não mexe em `operations.agreed_amount` nem em `shifts`. Versionar o valor acordado
--     exige uma tabela nova, que precisa existir ANTES da derivação; e o congelamento de turno
--     já usado é regra da fase de ativação. Ambos ficam registrados no PROGRESS.md.
--
-- REGRAS DE VIGÊNCIA
--
--   * Intervalo semiaberto [valid_from, valid_to); `valid_to` nulo = aberta.
--   * Sobreposição entre versões ATIVAS do mesmo contrato/colaborador é impossível (a
--     exclusão da 022 é a barreira real; as RPCs só traduzem o erro, 23P01).
--   * Lacunas são permitidas e significam "sem histórico": a derivação futura recusará, não
--     inventará.
--   * Uma RPC nunca aperta o intervalo de uma versão de modo que um apontamento que a
--     referencia (contract_terms_id / employee_cost_terms_id) fique fora dela, e nunca
--     aposenta versão referenciada sem substituta que cubra as datas (55000).
--   * Valores com mais casas que a coluna aceita são recusados (22023), não arredondados.
--
-- CONCORRÊNCIA
--
--   Toda escrita toma `pg_advisory_xact_lock` por contrato/colaborador antes de ler e
--   decidir; a exclusão GiST continua sendo a barreira final se algo escapar.
--
-- SEGURANÇA
--
--   Cada RPC valida DENTRO dela: sessão autenticada (28000), AAL2 (42501), identidade e
--   sessão utilizáveis e papel admin (42501) — o mesmo padrão de `gerar_fatura`. Funções
--   `SECURITY DEFINER` rodam acima da RLS, então policy não as protege. `search_path` fixo,
--   EXECUTE só para `authenticated` nas RPCs públicas, nada para anon, service_role, PUBLIC
--   nem o papel operacional; helpers e funções `exigir_*` sem nenhum EXECUTE de API.
--
-- AUDITORIA
--
--   `admin_audit_log` (017) é a trilha de usuário/papel/atribuição: alvo é uma conta
--   (`target_user_id` com FK para auth.users) e quem grava é o backend por service_role.
--   Eventos financeiros têm outro alvo (contrato/colaborador/versão), precisam de valores
--   anteriores e novos e são gravados dentro da transação da própria RPC. Reaproveitá-la
--   forçaria o alvo em `details` sem integridade; por isso a tabela própria.
--
-- REVERSÃO (as tabelas de versões estão vazias; a trilha, se tiver linhas, deve ser
-- exportada antes — é append-only de propósito):
--
--   drop function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean);
--   drop function public.corrigir_condicao_contrato(uuid, date, date, numeric, numeric, numeric, integer, text);
--   drop function public.encerrar_condicao_contrato(uuid, date, text);
--   drop function public.aposentar_condicao_contrato(uuid, text);
--   drop function public.condicao_contrato_na_data(uuid, date);
--   drop function public.exigir_condicao_contrato_na_data(uuid, date);
--   drop function public.registrar_custo_colaborador(uuid, date, numeric, text, date, boolean);
--   drop function public.corrigir_custo_colaborador(uuid, date, date, numeric, text);
--   drop function public.encerrar_custo_colaborador(uuid, date, text);
--   drop function public.aposentar_custo_colaborador(uuid, text);
--   drop function public.custo_colaborador_na_data(uuid, date);
--   drop function public.exigir_custo_colaborador_na_data(uuid, date);
--   drop function public.condicoes_encerrar_contrato_interno(uuid, date, text);
--   drop function public.condicoes_encerrar_colaborador_interno(uuid, date, text);
--   drop function public.condicoes_auditar(text, text, uuid, uuid, jsonb, jsonb, text);
--   drop function public.condicoes_validar_motivo(text);
--   drop function public.condicoes_exigir_admin();
--   drop trigger trg_contract_terms_imutavel on public.contract_terms;
--   drop trigger trg_employee_cost_terms_imutavel on public.employee_cost_terms;
--   drop function public.proteger_versao_financeira();
--   drop table public.financial_terms_audit;
--   drop function public.proteger_trilha_de_condicoes();


-- ---------------------------------------------------------------------------
-- 1. Trilha de auditoria (append-only)
-- ---------------------------------------------------------------------------

create table public.financial_terms_audit (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  actor_id         uuid not null,
  actor_session_id text,
  action           text not null,
  entity_kind      text not null,
  entity_id        uuid not null,
  term_id          uuid not null,
  previous         jsonb,
  new              jsonb,
  reason           text not null,
  constraint financial_terms_audit_acao_valida check (action in (
    'contrato_condicao_registrada', 'contrato_condicao_corrigida',
    'contrato_condicao_encerrada', 'contrato_condicao_aposentada',
    'colaborador_custo_registrado', 'colaborador_custo_corrigido',
    'colaborador_custo_encerrado', 'colaborador_custo_aposentado'
  )),
  constraint financial_terms_audit_entidade_valida check (entity_kind in ('contrato', 'colaborador')),
  constraint financial_terms_audit_motivo_obrigatorio check (btrim(reason) <> '')
);

-- Sem FK de propósito: a trilha sobrevive à exclusão do contrato, do colaborador, da versão
-- e da conta do ator. Uma FK com SET NULL/CASCADE tentaria alterar a linha da trilha.

create index financial_terms_audit_entidade_idx
  on public.financial_terms_audit (entity_kind, entity_id, occurred_at desc);

alter table public.financial_terms_audit enable row level security;

create policy financial_terms_audit_leitura_admin on public.financial_terms_audit
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  );

create policy financial_terms_audit_exige_admin_aal2 on public.financial_terms_audit
  as restrictive for all to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  with check (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and (select public.has_role(auth.uid(), 'admin'::public.app_role))
  );

revoke all on table public.financial_terms_audit from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.financial_terms_audit to authenticated;

create or replace function public.proteger_trilha_de_condicoes()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Sem exceção de papel: nem o dono altera a trilha. Correção de lançamento errado é um
  -- novo evento, nunca uma edição do anterior.
  raise exception 'A trilha de auditoria das condições financeiras é imutável.'
    using errcode = '42501';
end;
$$;

revoke all on function public.proteger_trilha_de_condicoes() from public, anon, authenticated, service_role;

create trigger trg_financial_terms_audit_imutavel
  before update or delete on public.financial_terms_audit
  for each row execute function public.proteger_trilha_de_condicoes();

create trigger trg_financial_terms_audit_sem_truncate
  before truncate on public.financial_terms_audit
  for each statement execute function public.proteger_trilha_de_condicoes();


-- ---------------------------------------------------------------------------
-- 2. Imutabilidade das versões
-- ---------------------------------------------------------------------------

create or replace function public.proteger_versao_financeira()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Tudo, exceto as quatro colunas de ciclo de vida, é imutável — inclusive para o dono.
  if (to_jsonb(new) - array['valid_to', 'active', 'retired_at', 'replaced_by'])
     is distinct from (to_jsonb(old) - array['valid_to', 'active', 'retired_at', 'replaced_by']) then
    raise exception 'Valores, vigência inicial, origem, motivo e autoria de uma versão financeira não podem ser alterados; registre uma correção.'
      using errcode = '42501';
  end if;

  -- Data final: só fechar uma versão aberta ou encurtar uma fechada, e só enquanto ativa.
  if new.valid_to is distinct from old.valid_to then
    if not old.active or new.valid_to is null
       or (old.valid_to is not null and new.valid_to >= old.valid_to) then
      raise exception 'A data final de uma versão só pode ser definida ou antecipada, e apenas enquanto ela estiver ativa.'
        using errcode = '42501';
    end if;
  end if;

  -- Aposentadoria: ativa -> inativa, uma vez, com retired_at.
  if new.active is distinct from old.active then
    if not old.active or new.active or new.retired_at is null then
      raise exception 'Uma versão aposentada não volta a ficar ativa.'
        using errcode = '42501';
    end if;
  end if;
  if new.retired_at is distinct from old.retired_at
     and not (old.active and not new.active and old.retired_at is null) then
    raise exception 'A data de aposentadoria é definida uma única vez, junto com a aposentadoria.'
      using errcode = '42501';
  end if;

  -- Sucessora: NULL -> valor, uma vez, só em versão já aposentada.
  if new.replaced_by is distinct from old.replaced_by
     and (old.replaced_by is not null or new.active) then
    raise exception 'A versão sucessora é apontada uma única vez, depois da aposentadoria.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.proteger_versao_financeira() from public, anon, authenticated, service_role;

create trigger trg_contract_terms_imutavel
  before update on public.contract_terms
  for each row execute function public.proteger_versao_financeira();

create trigger trg_employee_cost_terms_imutavel
  before update on public.employee_cost_terms
  for each row execute function public.proteger_versao_financeira();


-- ---------------------------------------------------------------------------
-- 3. Helpers internos (sem EXECUTE de API)
-- ---------------------------------------------------------------------------

create or replace function public.condicoes_exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  -- Segundo fator antes do papel: uma sessão aal1 nem tem o papel consultado.
  if (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  if not coalesce(public.identidade_atual_utilizavel(), false) then
    raise exception 'Conta ou sessão sem validade.' using errcode = '42501';
  end if;
  if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'Apenas administradores podem gerir condições financeiras.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.condicoes_validar_motivo(p_reason text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := btrim(coalesce(p_reason, ''));
begin
  if v_motivo = '' then
    raise exception 'O motivo é obrigatório.' using errcode = '22023';
  end if;
  if char_length(v_motivo) > 1000 then
    raise exception 'O motivo deve ter no máximo 1000 caracteres.' using errcode = '22023';
  end if;
  return v_motivo;
end;
$$;

create or replace function public.condicoes_auditar(
  p_action   text,
  p_kind     text,
  p_entity   uuid,
  p_term     uuid,
  p_previous jsonb,
  p_new      jsonb,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.financial_terms_audit
    (actor_id, actor_session_id, action, entity_kind, entity_id, term_id, previous, new, reason)
  values
    (auth.uid(), auth.jwt() ->> 'session_id', p_action, p_kind, p_entity, p_term, p_previous, p_new, p_reason);
end;
$$;

-- Encerra (define ou antecipa a data final de) uma versão de contrato. Sem verificação de
-- papel: só as RPCs públicas, que já verificaram, chamam.
create or replace function public.condicoes_encerrar_contrato_interno(
  p_term_id  uuid,
  p_valid_to date,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ant public.contract_terms%rowtype;
  v_dep public.contract_terms%rowtype;
begin
  select * into v_ant from public.contract_terms where id = p_term_id for update;
  if not found then
    raise exception 'Versão de condição contratual não encontrada.' using errcode = 'P0002';
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
     where te.contract_terms_id = p_term_id and t.work_date >= p_valid_to
  ) then
    raise exception 'Há apontamentos que usam esta versão em datas a partir de %; o encerramento os deixaria sem cobertura.', p_valid_to
      using errcode = '55000';
  end if;

  update public.contract_terms set valid_to = p_valid_to where id = p_term_id
    returning * into v_dep;

  perform public.condicoes_auditar('contrato_condicao_encerrada', 'contrato', v_dep.contract_id, p_term_id,
    to_jsonb(v_ant), to_jsonb(v_dep), p_reason);
end;
$$;

create or replace function public.condicoes_encerrar_colaborador_interno(
  p_term_id  uuid,
  p_valid_to date,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ant public.employee_cost_terms%rowtype;
  v_dep public.employee_cost_terms%rowtype;
begin
  select * into v_ant from public.employee_cost_terms where id = p_term_id for update;
  if not found then
    raise exception 'Versão de custo do colaborador não encontrada.' using errcode = 'P0002';
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
     where te.employee_cost_terms_id = p_term_id and t.work_date >= p_valid_to
  ) then
    raise exception 'Há apontamentos que usam esta versão em datas a partir de %; o encerramento os deixaria sem cobertura.', p_valid_to
      using errcode = '55000';
  end if;

  update public.employee_cost_terms set valid_to = p_valid_to where id = p_term_id
    returning * into v_dep;

  perform public.condicoes_auditar('colaborador_custo_encerrado', 'colaborador', v_dep.employee_id, p_term_id,
    to_jsonb(v_ant), to_jsonb(v_dep), p_reason);
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. RPCs de condições do contrato
-- ---------------------------------------------------------------------------

create or replace function public.registrar_condicao_contrato(
  p_contract_id        uuid,
  p_valid_from         date,
  p_daily_rate         numeric,
  p_shift_hours        numeric,
  p_ot_factor          numeric,
  p_ot_tolerance_min   integer,
  p_reason             text,
  p_valid_to           date    default null,
  p_encerrar_anterior  boolean default false
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
      (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason, created_by)
    values
      (p_contract_id, p_valid_from, p_valid_to, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min,
       'informada', v_motivo, auth.uid())
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

create or replace function public.corrigir_condicao_contrato(
  p_term_id          uuid,
  p_valid_from       date,
  p_valid_to         date,
  p_daily_rate       numeric,
  p_shift_hours      numeric,
  p_ot_factor        numeric,
  p_ot_tolerance_min integer,
  p_reason           text
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

  -- 1) aposenta a antiga (sai da conta da exclusão), 2) insere a nova, 3) aponta a sucessora
  update public.contract_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_apos;

  begin
    insert into public.contract_terms
      (contract_id, valid_from, valid_to, daily_rate, shift_hours, ot_factor, ot_tolerance_min, origin, reason, created_by)
    values
      (v_contract, p_valid_from, p_valid_to, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min,
       'correcao', v_motivo, auth.uid())
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

create or replace function public.encerrar_condicao_contrato(
  p_term_id  uuid,
  p_valid_to date,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo   text;
  v_contract uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_term_id is null or p_valid_to is null then
    raise exception 'Versão e data final são obrigatórias.' using errcode = '22023';
  end if;
  select contract_id into v_contract from public.contract_terms where id = p_term_id;
  if not found then
    raise exception 'Versão de condição contratual não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || v_contract::text, 0));
  perform public.condicoes_encerrar_contrato_interno(p_term_id, p_valid_to, v_motivo);
end;
$$;

create or replace function public.aposentar_condicao_contrato(
  p_term_id uuid,
  p_reason  text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo   text;
  v_contract uuid;
  v_ant      public.contract_terms%rowtype;
  v_dep      public.contract_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_term_id is null then
    raise exception 'A versão é obrigatória.' using errcode = '22023';
  end if;
  select contract_id into v_contract from public.contract_terms where id = p_term_id;
  if not found then
    raise exception 'Versão de condição contratual não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_contrato:' || v_contract::text, 0));

  select * into v_ant from public.contract_terms where id = p_term_id for update;
  if not v_ant.active then
    raise exception 'A versão já está aposentada.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries where contract_terms_id = p_term_id) then
    raise exception 'Há apontamentos que usam esta versão; use a correção, que registra a substituta.'
      using errcode = '55000';
  end if;

  update public.contract_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_dep;

  perform public.condicoes_auditar('contrato_condicao_aposentada', 'contrato', v_contract, p_term_id,
    to_jsonb(v_ant), to_jsonb(v_dep), v_motivo);
end;
$$;

create or replace function public.condicao_contrato_na_data(
  p_contract_id uuid,
  p_work_date   date
) returns setof public.contract_terms
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.condicoes_exigir_admin();
  if p_contract_id is null or p_work_date is null then
    raise exception 'Contrato e data são obrigatórios.' using errcode = '22023';
  end if;
  -- Zero linhas = sem histórico nessa data. Nunca cai para a taxa atual do contrato.
  return query
    select * from public.contract_terms
     where contract_id = p_contract_id and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date;
end;
$$;

create or replace function public.exigir_condicao_contrato_na_data(
  p_contract_id uuid,
  p_work_date   date
) returns public.contract_terms
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_termo public.contract_terms%rowtype;
begin
  select * into v_termo from public.contract_terms
   where contract_id = p_contract_id and active
     and daterange(valid_from, valid_to, '[)') @> p_work_date;
  if not found then
    raise exception 'Sem condições contratuais vigentes em % para o contrato informado.', p_work_date
      using errcode = 'P0002',
            hint = 'Registre a vigência com motivo antes de apontar nesta data; não há fallback para a taxa atual.';
  end if;
  return v_termo;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. RPCs de custo do colaborador
-- ---------------------------------------------------------------------------

create or replace function public.registrar_custo_colaborador(
  p_employee_id       uuid,
  p_valid_from        date,
  p_daily_cost        numeric,
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
  v_aberta public.employee_cost_terms%rowtype;
  v_novo   public.employee_cost_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);

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
      (employee_id, valid_from, valid_to, daily_cost, origin, reason, created_by)
    values
      (p_employee_id, p_valid_from, p_valid_to, p_daily_cost, 'informada', v_motivo, auth.uid())
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

create or replace function public.corrigir_custo_colaborador(
  p_term_id    uuid,
  p_valid_from date,
  p_valid_to   date,
  p_daily_cost numeric,
  p_reason     text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo   text;
  v_ant      public.employee_cost_terms%rowtype;
  v_apos     public.employee_cost_terms%rowtype;
  v_novo     public.employee_cost_terms%rowtype;
  v_employee uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);

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
      (employee_id, valid_from, valid_to, daily_cost, origin, reason, created_by)
    values
      (v_employee, p_valid_from, p_valid_to, p_daily_cost, 'correcao', v_motivo, auth.uid())
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

create or replace function public.encerrar_custo_colaborador(
  p_term_id  uuid,
  p_valid_to date,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo   text;
  v_employee uuid;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_term_id is null or p_valid_to is null then
    raise exception 'Versão e data final são obrigatórias.' using errcode = '22023';
  end if;
  select employee_id into v_employee from public.employee_cost_terms where id = p_term_id;
  if not found then
    raise exception 'Versão de custo do colaborador não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_colaborador:' || v_employee::text, 0));
  perform public.condicoes_encerrar_colaborador_interno(p_term_id, p_valid_to, v_motivo);
end;
$$;

create or replace function public.aposentar_custo_colaborador(
  p_term_id uuid,
  p_reason  text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_motivo   text;
  v_employee uuid;
  v_ant      public.employee_cost_terms%rowtype;
  v_dep      public.employee_cost_terms%rowtype;
begin
  perform public.condicoes_exigir_admin();
  v_motivo := public.condicoes_validar_motivo(p_reason);
  if p_term_id is null then
    raise exception 'A versão é obrigatória.' using errcode = '22023';
  end if;
  select employee_id into v_employee from public.employee_cost_terms where id = p_term_id;
  if not found then
    raise exception 'Versão de custo do colaborador não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('condicoes_colaborador:' || v_employee::text, 0));

  select * into v_ant from public.employee_cost_terms where id = p_term_id for update;
  if not v_ant.active then
    raise exception 'A versão já está aposentada.' using errcode = '55000';
  end if;
  if exists (select 1 from public.timesheet_entries where employee_cost_terms_id = p_term_id) then
    raise exception 'Há apontamentos que usam esta versão; use a correção, que registra a substituta.'
      using errcode = '55000';
  end if;

  update public.employee_cost_terms set active = false, retired_at = now() where id = p_term_id
    returning * into v_dep;

  perform public.condicoes_auditar('colaborador_custo_aposentado', 'colaborador', v_employee, p_term_id,
    to_jsonb(v_ant), to_jsonb(v_dep), v_motivo);
end;
$$;

create or replace function public.custo_colaborador_na_data(
  p_employee_id uuid,
  p_work_date   date
) returns setof public.employee_cost_terms
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.condicoes_exigir_admin();
  if p_employee_id is null or p_work_date is null then
    raise exception 'Colaborador e data são obrigatórios.' using errcode = '22023';
  end if;
  return query
    select * from public.employee_cost_terms
     where employee_id = p_employee_id and active
       and daterange(valid_from, valid_to, '[)') @> p_work_date;
end;
$$;

create or replace function public.exigir_custo_colaborador_na_data(
  p_employee_id uuid,
  p_work_date   date
) returns public.employee_cost_terms
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_termo public.employee_cost_terms%rowtype;
begin
  select * into v_termo from public.employee_cost_terms
   where employee_id = p_employee_id and active
     and daterange(valid_from, valid_to, '[)') @> p_work_date;
  if not found then
    raise exception 'Sem custo vigente em % para o colaborador informado.', p_work_date
      using errcode = 'P0002',
            hint = 'Registre a vigência com motivo antes de apontar nesta data; não há fallback para o custo atual.';
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
         'condicoes_exigir_admin', 'condicoes_validar_motivo', 'condicoes_auditar',
         'condicoes_encerrar_contrato_interno', 'condicoes_encerrar_colaborador_interno',
         'registrar_condicao_contrato', 'corrigir_condicao_contrato', 'encerrar_condicao_contrato',
         'aposentar_condicao_contrato', 'condicao_contrato_na_data', 'exigir_condicao_contrato_na_data',
         'registrar_custo_colaborador', 'corrigir_custo_colaborador', 'encerrar_custo_colaborador',
         'aposentar_custo_colaborador', 'custo_colaborador_na_data', 'exigir_custo_colaborador_na_data')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    -- Só as RPCs de API têm EXECUTE, e só para authenticated. Helpers e `exigir_*` não têm
    -- nenhum: são chamados por funções do mesmo dono.
    if _f.nome in (
         'registrar_condicao_contrato', 'corrigir_condicao_contrato', 'encerrar_condicao_contrato',
         'aposentar_condicao_contrato', 'condicao_contrato_na_data',
         'registrar_custo_colaborador', 'corrigir_custo_colaborador', 'encerrar_custo_colaborador',
         'aposentar_custo_colaborador', 'custo_colaborador_na_data') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on table public.financial_terms_audit is
  'Trilha append-only das alteracoes de vigencias financeiras (contrato e custo de colaborador): ator, acao, valores anteriores e novos, motivo. Escrita so pelas RPCs; leitura por admin em AAL2; sem FK, sobrevive a exclusao de contrato, colaborador e conta.';
comment on function public.registrar_condicao_contrato(uuid, date, numeric, numeric, numeric, integer, text, date, boolean) is
  'Admin AAL2. Registra uma versao das condicoes do contrato (origem informada). Sobreposicao com versao ativa: 23P01. p_encerrar_anterior=true fecha a versao aberta anterior na data inicial.';
comment on function public.exigir_condicao_contrato_na_data(uuid, date) is
  'Interna (sem EXECUTE de API). Devolve a versao vigente na data ou levanta P0002; nunca cai para a taxa atual de contracts.';
comment on function public.exigir_custo_colaborador_na_data(uuid, date) is
  'Interna (sem EXECUTE de API). Devolve a versao de custo vigente na data ou levanta P0002; nunca cai para employees.daily_cost.';


-- ---------------------------------------------------------------------------
-- 7. Autoverificação (estrutural; a migration não escreve dado)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _n int;
begin
  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (
       'registrar_condicao_contrato', 'corrigir_condicao_contrato', 'encerrar_condicao_contrato',
       'aposentar_condicao_contrato', 'condicao_contrato_na_data', 'exigir_condicao_contrato_na_data',
       'registrar_custo_colaborador', 'corrigir_custo_colaborador', 'encerrar_custo_colaborador',
       'aposentar_custo_colaborador', 'custo_colaborador_na_data', 'exigir_custo_colaborador_na_data',
       'condicoes_exigir_admin', 'condicoes_validar_motivo', 'condicoes_auditar',
       'condicoes_encerrar_contrato_interno', 'condicoes_encerrar_colaborador_interno')
     and (p.proowner <> 'postgres'::regrole
          or (p.prosecdef is distinct from (p.proname <> 'condicoes_validar_motivo'))
          or coalesce(array_to_string(p.proconfig, ','), '') not like 'search_path=%');
  if _n <> 0 then
    raise exception '023: % função(ões) fora do padrão (dono postgres, SECURITY DEFINER, search_path fixo)', _n;
  end if;

  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('registrar_condicao_contrato', 'corrigir_condicao_contrato', 'encerrar_condicao_contrato',
       'aposentar_condicao_contrato', 'condicao_contrato_na_data', 'registrar_custo_colaborador',
       'corrigir_custo_colaborador', 'encerrar_custo_colaborador', 'aposentar_custo_colaborador',
       'custo_colaborador_na_data')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE');
  if _n <> 10 then
    raise exception '023: as 10 RPCs deveriam executar só para authenticated, encontrei %', _n;
  end if;

  select count(*) into _n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('exigir_condicao_contrato_na_data', 'exigir_custo_colaborador_na_data',
       'condicoes_exigir_admin', 'condicoes_validar_motivo', 'condicoes_auditar',
       'condicoes_encerrar_contrato_interno', 'condicoes_encerrar_colaborador_interno')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if _n <> 0 then
    raise exception '023: % função(ões) interna(s) executável(is) por papel de API', _n;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.financial_terms_audit'::regclass) then
    raise exception '023: RLS desligada na trilha';
  end if;
  if has_table_privilege('authenticated', 'public.financial_terms_audit', 'INSERT')
     or has_table_privilege('authenticated', 'public.financial_terms_audit', 'UPDATE')
     or has_table_privilege('authenticated', 'public.financial_terms_audit', 'DELETE')
     or has_table_privilege('service_role', 'public.financial_terms_audit', 'INSERT')
     or has_table_privilege('anon', 'public.financial_terms_audit', 'SELECT') then
    raise exception '023: privilégio indevido na trilha';
  end if;

  select count(*) into _n from pg_trigger
   where not tgisinternal and tgenabled = 'O'
     and tgname in ('trg_contract_terms_imutavel', 'trg_employee_cost_terms_imutavel',
                    'trg_financial_terms_audit_imutavel', 'trg_financial_terms_audit_sem_truncate');
  if _n <> 4 then
    raise exception '023: deveriam existir 4 triggers de imutabilidade habilitados, encontrei %', _n;
  end if;

  -- A derivação financeira não foi tocada: continua sem citar as versões.
  select count(*) into _n from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'derivar_valores_financeiros'
     and (prosrc ilike '%contract_terms%' or prosrc ilike '%employee_cost_terms%');
  if _n <> 0 then
    raise exception '023: derivar_valores_financeiros não deveria citar as versões ainda';
  end if;

  select count(*) into _n from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'gerar_fatura'
     and (prosrc ilike '%contract_terms%' or prosrc ilike '%employee_cost_terms%');
  if _n <> 0 then
    raise exception '023: gerar_fatura não deveria citar as versões';
  end if;

  select count(*) into _n from (
    select 1 from public.contract_terms union all select 1 from public.employee_cost_terms
    union all select 1 from public.financial_terms_audit) t;
  if _n <> 0 then
    raise exception '023: tabelas de versões e trilha deveriam estar vazias, encontrei % linhas', _n;
  end if;
end;
$verificacao$;
