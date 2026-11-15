-- 054 — GATE-FIN-05: EXPANDIR. Versão dos apontamentos, contratos v2 com versão obrigatória e
-- confirmação de virada auditada. Prepara a correção do I1 e do I7 sem impor nada ao legado.
--
-- O QUE ENTRA:
--   1. `timesheet_entries.versao` (bigint, NOT NULL, default 1), mantida SÓ pelo banco: o gatilho
--      `trg_timesheet_entries_zz_versao` — o último BEFORE da tabela, pela ordem real do catálogo —
--      força 1 no INSERT e soma 1 no UPDATE quando alguma coluna muda de fato (exceto `updated_at`).
--      UPDATE sem mudança não sobe a versão; o cliente não escolhe a versão. Por rodar por último,
--      as travas que comparam a linha inteira (031, folha fechada; 011, faturado) não a veem mudar:
--      `gerar_fatura` vincula em folha fechada como antes, e o vínculo sobe a versão.
--   2. Contratos v2, com versão esperada OBRIGATÓRIA por linha (0 = linha nova):
--        `salvar_apontamento_admin_v2` (com a permissão de quem chama, como a v1);
--        `salvar_apontamento_operacional_v2` e `listar_apontamentos_do_operador_v2` (donas
--        `bslog_rpc_operacional`, como a v1 — nunca `postgres`, que escaparia das guardas financeiras).
--      A comparação é atômica: a linha é travada (`FOR UPDATE`) antes de comparar e gravar; a inclusão
--      simultânea do mesmo colaborador cai no índice único e é tratada sob a mesma regra. SEM
--      `ON CONFLICT`: no `INSERT … ON CONFLICT DO UPDATE` o EXCLUDED já passou pelos gatilhos BEFORE
--      INSERT e o `DO UPDATE` só leva as colunas nomeadas — uma "versão esperada" em coluna poderia
--      chegar nula à conferência, e o operador precisaria de permissão de escrita nela.
--        versão certa → grava ("atualizado");
--        versão obsoleta e conteúdo diferente → 40001, nada gravado;
--        conteúdo idêntico ao gravado (retentativa depois de resposta perdida) → "sem_alteracao", sem
--        subir a versão — a mudança concorrente não é mascarada: só é aceito o que já está gravado.
--   3. Confirmação de virada (saída antes da entrada fora de turno que vira o dia), só pelo ADMIN,
--      verificada no banco (`confirmar_virada_do_apontamento`: papel, MFA, versão) e gravada na trilha
--      `apontamento_confirmacoes_virada` com quem, quando, horários, turno e versão. Mudar horário,
--      status, folha ou colaborador invalida a confirmação na trilha (nunca a apaga); mudar a jornada
--      do turno também a deixa sem valor. A trilha não é gravável por nenhum papel da API e não
--      aceita alteração do que foi confirmado nem exclusão, nem pela dona.
--
-- O QUE NÃO ENTRA (é da 058, depois do aplicativo novo publicado e validado):
--   - versão obrigatória para os escritores antigos (RPCs v1, escrita direta, upsert da tela);
--   - confirmação obrigatória da virada; limite de jornada (decisão comercial pendente, DEC-CP05-01);
--   - revogar o DELETE direto do admin e o EXECUTE das RPCs v1.
--   Por isso I1 e I7 seguem RISCO na SQL 090: o legado ainda grava sem versão e sem confirmação.
--
-- NADA MUDA EM: diária, hora extra, custo, domingo/feriado, snapshots, faturamento, valores
-- gravados (nenhuma linha recalculada), RLS e grants das tabelas existentes, RPCs v1 (assinatura e
-- corpo intactos), regra da 053 e do motor (jornada zero continua como está).
--
-- PERMISSÕES NOVAS: `bslog_rpc_operacional` ganha SELECT(versao) em `timesheet_entries` (nenhuma
-- coluna financeira, nenhuma permissão de tabela inteira); `authenticated` ganha EXECUTE nas cinco
-- funções públicas novas e SELECT na trilha (a RLS a restringe ao admin com MFA em dia).
--
-- ROLLBACK: docs/runbooks/rollback-versao-e-confirmacao-de-virada.sql (remove funções e gatilhos;
-- preserva a coluna `versao` e a trilha; não apaga `schema_migrations`).

begin;

-- ---------------------------------------------------------------------------
-- 1. Versão
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries add column if not exists versao bigint not null default 1;
comment on column public.timesheet_entries.versao is
  '054: versão da linha, mantida só pelo banco (1 no INSERT; +1 a cada UPDATE com mudança efetiva). Base do controle otimista dos contratos v2.';

create or replace function public.versionar_apontamento()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.versao := 1;
  elsif (to_jsonb(new) - 'versao' - 'updated_at') is distinct from (to_jsonb(old) - 'versao' - 'updated_at') then
    new.versao := old.versao + 1;
  else
    new.versao := old.versao;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_timesheet_entries_zz_versao on public.timesheet_entries;
create trigger trg_timesheet_entries_zz_versao
  before insert or update on public.timesheet_entries
  for each row execute function public.versionar_apontamento();

-- ---------------------------------------------------------------------------
-- 2. Trilha de confirmações de virada
-- ---------------------------------------------------------------------------

create table if not exists public.apontamento_confirmacoes_virada (
  id                   uuid primary key default gen_random_uuid(),
  entry_id             uuid not null,
  timesheet_id         uuid not null,
  employee_id          uuid not null,
  work_date            date not null,
  shift_id             uuid,
  turno_inicio         time,
  turno_fim            time,
  turno_vira_o_dia     boolean not null,
  check_in             time not null,
  check_out            time not null,
  versao_confirmada    bigint not null,
  confirmado_por       uuid not null,
  confirmado_em        timestamptz not null default now(),
  invalidada_em        timestamptz,
  invalidada_na_versao bigint,
  motivo_invalidacao   text,
  constraint apontamento_confirmacoes_virada_motivo
    check (motivo_invalidacao is null or motivo_invalidacao in ('horarios_alterados', 'apontamento_excluido')),
  constraint apontamento_confirmacoes_virada_invalidacao_coerente
    check ((invalidada_em is null) = (motivo_invalidacao is null))
);
comment on table public.apontamento_confirmacoes_virada is
  '054: trilha das confirmações de virada (saída antes da entrada fora de turno que vira o dia), feitas pelo admin. Só inclusão e invalidação, pelo banco; sem FK para o apontamento, para sobreviver à exclusão dele.';
create index if not exists apontamento_confirmacoes_virada_entry_idx
  on public.apontamento_confirmacoes_virada (entry_id);

alter table public.apontamento_confirmacoes_virada enable row level security;
drop policy if exists apontamento_confirmacoes_virada_leitura_admin on public.apontamento_confirmacoes_virada;
create policy apontamento_confirmacoes_virada_leitura_admin on public.apontamento_confirmacoes_virada
  for select to authenticated
  using ((select public.has_role(auth.uid(), 'admin'::public.app_role)) and (select public.mfa_cotidiano_ok()));

revoke all on table public.apontamento_confirmacoes_virada from public, anon, authenticated, service_role;
grant select on table public.apontamento_confirmacoes_virada to authenticated;

create or replace function public.proteger_confirmacao_de_virada()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.invalidada_em is null and new.invalidada_em is not null
     and (to_jsonb(new) - 'invalidada_em' - 'invalidada_na_versao' - 'motivo_invalidacao')
         = (to_jsonb(old) - 'invalidada_em' - 'invalidada_na_versao' - 'motivo_invalidacao') then
    return new;
  end if;
  raise exception 'A trilha de confirmações de virada só aceita inclusão e invalidação: o que foi confirmado não muda nem é apagado.'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_apontamento_confirmacoes_virada_protege on public.apontamento_confirmacoes_virada;
create trigger trg_apontamento_confirmacoes_virada_protege
  before update or delete on public.apontamento_confirmacoes_virada
  for each row execute function public.proteger_confirmacao_de_virada();
drop trigger if exists trg_apontamento_confirmacoes_virada_truncate on public.apontamento_confirmacoes_virada;
create trigger trg_apontamento_confirmacoes_virada_truncate
  before truncate on public.apontamento_confirmacoes_virada
  for each statement execute function public.proteger_confirmacao_de_virada();

-- Mudança no que foi confirmado invalida a confirmação (registrada; nunca apagada).
create or replace function public.invalidar_confirmacao_de_virada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    update public.apontamento_confirmacoes_virada
       set invalidada_em = now(), invalidada_na_versao = old.versao, motivo_invalidacao = 'apontamento_excluido'
     where entry_id = old.id and invalidada_em is null;
    return old;
  end if;
  if new.check_in is distinct from old.check_in or new.check_out is distinct from old.check_out
     or new.status is distinct from old.status or new.timesheet_id is distinct from old.timesheet_id
     or new.employee_id is distinct from old.employee_id then
    update public.apontamento_confirmacoes_virada
       set invalidada_em = now(), invalidada_na_versao = new.versao, motivo_invalidacao = 'horarios_alterados'
     where entry_id = new.id and invalidada_em is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_timesheet_entries_zz_invalida_virada on public.timesheet_entries;
create trigger trg_timesheet_entries_zz_invalida_virada
  after update or delete on public.timesheet_entries
  for each row execute function public.invalidar_confirmacao_de_virada();

-- Classificação da virada de um apontamento. Interna: só as funções DEFINER abaixo a chamam.
--   sem_virada        — falta, horário incompleto, ou saída depois da entrada;
--   turno_vira_o_dia  — o turno da folha atravessa a meia-noite (marcado ou fim <= início);
--   confirmada        — há confirmação válida: não invalidada e com os MESMOS horários, folha e
--                       jornada do turno de quando foi feita;
--   pendente          — virada fora de turno que vira o dia, sem confirmação válida.
create or replace function public.classificar_virada_do_apontamento(p_entry_id uuid)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _e record;
begin
  select te.id, te.status, te.check_in, te.check_out, te.timesheet_id, t.shift_id,
         s.start_time, s.end_time, s.crosses_midnight
    into _e
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    left join public.shifts s on s.id = t.shift_id
   where te.id = p_entry_id;
  if not found then
    return null;
  end if;
  if _e.status = 'absent' or _e.check_in is null or _e.check_out is null
     or (extract(hour from _e.check_out) * 60 + extract(minute from _e.check_out))
        > (extract(hour from _e.check_in) * 60 + extract(minute from _e.check_in)) then
    return 'sem_virada';
  end if;
  if _e.shift_id is not null and (coalesce(_e.crosses_midnight, false)
     or (extract(hour from _e.end_time) * 60 + extract(minute from _e.end_time))
        <= (extract(hour from _e.start_time) * 60 + extract(minute from _e.start_time))) then
    return 'turno_vira_o_dia';
  end if;
  if exists (
    select 1 from public.apontamento_confirmacoes_virada c
     where c.entry_id = _e.id and c.invalidada_em is null
       and c.check_in = _e.check_in and c.check_out = _e.check_out
       and c.timesheet_id = _e.timesheet_id
       and c.shift_id is not distinct from _e.shift_id
       and c.turno_inicio is not distinct from _e.start_time
       and c.turno_fim is not distinct from _e.end_time
       and not c.turno_vira_o_dia) then
    return 'confirmada';
  end if;
  return 'pendente';
end;
$$;

create or replace function public.situacao_da_virada(p_entry_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _s text;
begin
  if auth.uid() is null or public.has_role(auth.uid(), 'admin'::public.app_role) is not true then
    raise exception 'Apenas administradores consultam a situação da virada.' using errcode = '42501';
  end if;
  if public.mfa_cotidiano_ok() is not true then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  _s := public.classificar_virada_do_apontamento(p_entry_id);
  if _s is null then
    raise exception 'Apontamento não encontrado.' using errcode = 'P0002';
  end if;
  return _s;
end;
$$;

create or replace function public.confirmar_virada_do_apontamento(p_entry_id uuid, p_versao bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
  _e   record;
  _s   text;
  _id  uuid;
begin
  if _uid is null or public.has_role(_uid, 'admin'::public.app_role) is not true then
    raise exception 'Apenas administradores confirmam a virada da meia-noite.' using errcode = '42501';
  end if;
  if public.mfa_cotidiano_ok() is not true then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;

  -- Trava a linha: a versão conferida é a que vale até o fim da transação.
  select te.id, te.versao, te.timesheet_id, te.employee_id, te.work_date, te.check_in, te.check_out,
         t.shift_id, s.start_time, s.end_time
    into _e
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    left join public.shifts s on s.id = t.shift_id
   where te.id = p_entry_id
     for update of te;
  if not found then
    raise exception 'Apontamento não encontrado.' using errcode = 'P0002';
  end if;
  if p_versao is null or _e.versao <> p_versao then
    raise exception 'Apontamento alterado por outra sessão (versão atual %, informada %). Recarregue antes de confirmar.',
      _e.versao, coalesce(p_versao::text, 'nenhuma') using errcode = '40001';
  end if;

  _s := public.classificar_virada_do_apontamento(p_entry_id);
  if _s = 'sem_virada' then
    raise exception 'Não há virada da meia-noite a confirmar neste apontamento.' using errcode = '22023';
  elsif _s = 'turno_vira_o_dia' then
    raise exception 'O turno desta folha já atravessa a meia-noite: não há o que confirmar.' using errcode = '22023';
  elsif _s = 'confirmada' then
    -- Idempotente: a mesma confirmação, sem linha nova.
    select c.id into _id from public.apontamento_confirmacoes_virada c
     where c.entry_id = _e.id and c.invalidada_em is null and c.check_in = _e.check_in and c.check_out = _e.check_out
     order by c.confirmado_em desc limit 1;
  else
    insert into public.apontamento_confirmacoes_virada
      (entry_id, timesheet_id, employee_id, work_date, shift_id, turno_inicio, turno_fim, turno_vira_o_dia,
       check_in, check_out, versao_confirmada, confirmado_por)
    values
      (_e.id, _e.timesheet_id, _e.employee_id, _e.work_date, _e.shift_id, _e.start_time, _e.end_time, false,
       _e.check_in, _e.check_out, _e.versao, _uid)
    returning id into _id;
  end if;

  return jsonb_build_object('confirmacao_id', _id, 'entry_id', _e.id, 'versao', _e.versao, 'situacao', 'confirmada');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Admin v2 (com a permissão de quem chama, como a v1; mesma guarda de entrada)
-- ---------------------------------------------------------------------------

create or replace function public.salvar_apontamento_admin_v2(p_operation_id uuid, p_shift_id uuid, p_work_date date, p_linhas jsonb)
returns jsonb
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _permitidas constant text[] := array['employee_id', 'status', 'check_in', 'check_out', 'break_minutes', 'notes',
                                       'versao_esperada', 'job_function_id', 'confirmar_virada'];
  _folha   public.timesheets%rowtype;
  _criada  boolean := false;
  _l       jsonb;
  _k       text;
  _emp     uuid;
  _status  public.attendance_status;
  _ent     time;
  _sai     time;
  _int     integer;
  _obs     text;
  _esp     bigint;
  _vistos  uuid[] := '{}';
  _atual   record;
  _id      uuid;
  _ver     bigint;
  _res     text;
  _cons    text;
  _saida   jsonb := '[]';
begin
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

  -- Validação de todas as linhas antes de qualquer escrita.
  for _l in select value from jsonb_array_elements(p_linhas) loop
    if jsonb_typeof(_l) <> 'object' then
      raise exception 'Cada linha deve ser um objeto JSON.' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(_l) loop
      if not (_k = any (_permitidas)) then
        raise exception 'Campo não permitido no apontamento: %.', _k using errcode = '22023';
      end if;
    end loop;
    if nullif(_l ->> 'employee_id', '') is null or (_l ->> 'status') is null then
      raise exception 'Cada linha exige colaborador e status.' using errcode = '22023';
    end if;
    if jsonb_typeof(_l -> 'versao_esperada') is distinct from 'number' or (_l ->> 'versao_esperada')::numeric < 0
       or (_l ->> 'versao_esperada')::numeric <> trunc((_l ->> 'versao_esperada')::numeric) then
      raise exception 'Cada linha exige versao_esperada: a versão lida (0 para linha nova).' using errcode = '22023';
    end if;
    if (_l ->> 'employee_id')::uuid = any (_vistos) then
      raise exception 'Colaborador repetido no mesmo apontamento.' using errcode = '22023';
    end if;
    _vistos := _vistos || (_l ->> 'employee_id')::uuid;
  end loop;

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
      select * into _folha from public.timesheets t
       where t.operation_id = p_operation_id and t.work_date = p_work_date
         and t.shift_id is not distinct from p_shift_id
       for share;
    end;
  end if;
  if _folha.status = 'closed' then
    raise exception 'A folha está fechada: reabra para gravar.' using errcode = '55000';
  end if;

  -- Ordem fixa (colaborador): duas chamadas concorrentes travam as linhas na mesma ordem.
  for _l in select value from jsonb_array_elements(p_linhas) order by value ->> 'employee_id' loop
    _emp    := (_l ->> 'employee_id')::uuid;
    _status := (_l ->> 'status')::public.attendance_status;
    _ent    := nullif(_l ->> 'check_in', '')::time;
    _sai    := nullif(_l ->> 'check_out', '')::time;
    _int    := coalesce((_l ->> 'break_minutes')::integer, 0);
    _obs    := nullif(_l ->> 'notes', '');
    _esp    := (_l ->> 'versao_esperada')::bigint;
    _res    := null;

    select e.id, e.versao, e.status, e.check_in, e.check_out, e.break_minutes, e.notes into _atual
      from public.timesheet_entries e
     where e.timesheet_id = _folha.id and e.employee_id = _emp
       for update;

    if not found then
      if _esp <> 0 then
        raise exception 'Apontamento alterado por outra sessão: a linha (versão %) não existe mais. Recarregue e refaça.', _esp
          using errcode = '40001';
      end if;
      begin
        perform set_config('bslog.funcao_do_apontamento', coalesce(nullif(_l ->> 'job_function_id', ''), ''), true);
        insert into public.timesheet_entries
          (timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes, notes)
        values
          (_folha.id, _emp, p_operation_id, p_work_date, _status, _ent, _sai, _int, _obs)
        returning id, versao into _id, _ver;
        perform set_config('bslog.funcao_do_apontamento', '', true);
        _res := 'inserido';
      exception when unique_violation then
        get stacked diagnostics _cons = constraint_name;
        perform set_config('bslog.funcao_do_apontamento', '', true);
        if _cons is distinct from 'timesheet_entries_timesheet_id_employee_id_key' then
          raise;
        end if;
        -- Outra sessão incluiu o mesmo colaborador e já confirmou: decide sobre a linha dela.
        select e.id, e.versao, e.status, e.check_in, e.check_out, e.break_minutes, e.notes into _atual
          from public.timesheet_entries e
         where e.timesheet_id = _folha.id and e.employee_id = _emp
           for update;
      end;
    end if;

    if _res is null then
      _id := _atual.id;
      _ver := _atual.versao;
      if _atual.status = _status and _atual.check_in is not distinct from _ent and _atual.check_out is not distinct from _sai
         and _atual.break_minutes = _int and _atual.notes is not distinct from _obs then
        _res := 'sem_alteracao';
      elsif _atual.versao = _esp then
        update public.timesheet_entries e
           set status = _status, check_in = _ent, check_out = _sai, break_minutes = _int, notes = _obs
         where e.id = _atual.id
        returning e.versao into _ver;
        _res := 'atualizado';
      else
        raise exception 'Apontamento alterado por outra sessão (versão atual %, esperada %). Recarregue e refaça a alteração.',
          _atual.versao, _esp using errcode = '40001';
      end if;
    end if;

    if coalesce((_l ->> 'confirmar_virada')::boolean, false) then
      -- situacao_da_virada (DEFINER, admin): a classificação interna não é executável por authenticated.
      if public.situacao_da_virada(_id) not in ('pendente', 'confirmada') then
        raise exception 'confirmar_virada só se aplica a saída antes da entrada fora de turno que vira o dia.'
          using errcode = '22023';
      end if;
      perform public.confirmar_virada_do_apontamento(_id, _ver);
    end if;

    _saida := _saida || jsonb_build_object('employee_id', _emp, 'entry_id', _id, 'versao', _ver, 'resultado', _res);
  end loop;

  return jsonb_build_object('timesheet_id', _folha.id, 'folha_criada', _criada, 'linhas', _saida);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Operador v2 (donas bslog_rpc_operacional, como a v1; mesmas guardas da v1)
-- ---------------------------------------------------------------------------

create or replace function public.listar_apontamentos_do_operador_v2(p_operation_id uuid, p_shift_id uuid, p_work_date date)
returns table (
  timesheet_id  uuid,
  shift_id      uuid,
  work_date     date,
  folha_status  public.timesheet_status,
  employee_id   uuid,
  status        public.attendance_status,
  check_in      time,
  check_out     time,
  break_minutes integer,
  notes         text,
  faturado      boolean,
  versao        bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if public.operador_autorizado(p_operation_id) is not true then
    raise exception 'Operação não autorizada para esta sessão.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shifts s where s.id = p_shift_id and s.operation_id = p_operation_id) then
    raise exception 'Turno informado não pertence à operação.' using errcode = '23514';
  end if;
  return query
    select t.id, t.shift_id, t.work_date, t.status,
           te.employee_id, te.status, te.check_in, te.check_out, te.break_minutes, te.notes,
           public.apontamento_faturado(te.timesheet_id, te.employee_id),
           te.versao
      from public.timesheets t
      left join public.timesheet_entries te on te.timesheet_id = t.id
     where t.operation_id = p_operation_id and t.shift_id = p_shift_id and t.work_date = p_work_date
     order by te.employee_id;
end;
$$;

create or replace function public.salvar_apontamento_operacional_v2(p_operation_id uuid, p_shift_id uuid, p_work_date date, p_linhas jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _permitidas constant text[] := array['employee_id', 'status', 'check_in', 'check_out', 'break_minutes', 'notes', 'versao_esperada'];
  _uid          uuid;
  _folha_id     uuid;
  _folha_status public.timesheet_status;
  _l            jsonb;
  _k            text;
  _emp          uuid;
  _status       text;
  _ent          time;
  _sai          time;
  _int          integer;
  _obs          text;
  _esp          bigint;
  _vistos       uuid[] := '{}';
  _atual        record;
  _ver          bigint;
  _res          text;
  _cons         text;
  _saida        jsonb := '[]';
begin
  -- As mesmas guardas da v1 (013), na mesma ordem: autorização antes de qualquer validação.
  if public.operador_autorizado(p_operation_id) is not true then
    raise exception 'Operação não autorizada para esta sessão.' using errcode = '42501';
  end if;
  _uid := public.uid_do_operador();
  if p_shift_id is null or p_work_date is null then
    raise exception 'Turno e data são obrigatórios.' using errcode = '22023';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'As linhas do apontamento devem vir num array JSON não vazio.' using errcode = '22023';
  end if;
  if public.travar_turno_da_operacao(p_shift_id, p_operation_id) is not true then
    raise exception 'Turno informado não pertence à operação.' using errcode = '23514';
  end if;

  for _l in select value from jsonb_array_elements(p_linhas) loop
    if jsonb_typeof(_l) <> 'object' then
      raise exception 'Cada linha do apontamento deve ser um objeto JSON.' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(_l) loop
      if not (_k = any (_permitidas)) then
        raise exception 'Campo não permitido no apontamento: %.', _k using errcode = '22023';
      end if;
    end loop;
    if not (_l ? 'employee_id') or not (_l ? 'status') then
      raise exception 'Cada linha exige employee_id e status.' using errcode = '22023';
    end if;
    if jsonb_typeof(_l -> 'versao_esperada') is distinct from 'number' or (_l ->> 'versao_esperada')::numeric < 0
       or (_l ->> 'versao_esperada')::numeric <> trunc((_l ->> 'versao_esperada')::numeric) then
      raise exception 'Cada linha exige versao_esperada: a versão lida (0 para linha nova).' using errcode = '22023';
    end if;
    if (_l ->> 'status') is null or (_l ->> 'status') not in ('present', 'absent', 'replacement') then
      raise exception 'Status de apontamento inválido: %.', coalesce(_l ->> 'status', 'nulo') using errcode = '22023';
    end if;
    if (_l ->> 'employee_id')::uuid = any (_vistos) then
      raise exception 'Colaborador repetido no mesmo apontamento: %.', _l ->> 'employee_id' using errcode = '22023';
    end if;
    _vistos := _vistos || (_l ->> 'employee_id')::uuid;
  end loop;

  select t.id, t.status into _folha_id, _folha_status
    from public.timesheets t
   where t.operation_id = p_operation_id and t.shift_id = p_shift_id and t.work_date = p_work_date
     for share;
  if _folha_id is null then
    begin
      insert into public.timesheets (operation_id, shift_id, work_date, created_by)
      values (p_operation_id, p_shift_id, p_work_date, _uid)
      returning id, status into _folha_id, _folha_status;
    exception when unique_violation then
      select t.id, t.status into _folha_id, _folha_status
        from public.timesheets t
       where t.operation_id = p_operation_id and t.shift_id = p_shift_id and t.work_date = p_work_date
         for share;
    end;
  end if;
  if _folha_status = 'closed'::public.timesheet_status then
    raise exception 'Folha fechada não recebe apontamento.' using errcode = '42501';
  end if;

  for _l in select value from jsonb_array_elements(p_linhas) order by value ->> 'employee_id' loop
    _emp    := (_l ->> 'employee_id')::uuid;
    _status := _l ->> 'status';
    _ent    := (_l ->> 'check_in')::time;
    _sai    := (_l ->> 'check_out')::time;
    _int    := coalesce((_l ->> 'break_minutes')::integer, 0);
    _obs    := _l ->> 'notes';
    _esp    := (_l ->> 'versao_esperada')::bigint;
    _res    := null;

    if not exists (
      select 1 from public.operation_team ot
       where ot.operation_id = p_operation_id and ot.shift_id = p_shift_id and ot.employee_id = _emp and ot.active
    ) then
      raise exception 'Colaborador % não está na equipe ativa deste turno.', _emp using errcode = '23514';
    end if;
    if public.apontamento_faturado(_folha_id, _emp) then
      raise exception 'Apontamento já faturado não pode ser alterado.' using errcode = '42501';
    end if;

    select te.versao, te.status, te.check_in, te.check_out, te.break_minutes, te.notes into _atual
      from public.timesheet_entries te
     where te.timesheet_id = _folha_id and te.employee_id = _emp
       for update;

    if not found then
      if _esp <> 0 then
        raise exception 'Apontamento alterado por outra sessão: a linha (versão %) não existe mais. Recarregue e refaça.', _esp
          using errcode = '40001';
      end if;
      begin
        insert into public.timesheet_entries (timesheet_id, employee_id, status, check_in, check_out, break_minutes, notes)
        values (_folha_id, _emp, _status::public.attendance_status, _ent, _sai, _int, _obs)
        returning versao into _ver;
        _res := 'inserido';
      exception when unique_violation then
        get stacked diagnostics _cons = constraint_name;
        if _cons is distinct from 'timesheet_entries_timesheet_id_employee_id_key' then
          raise;
        end if;
        select te.versao, te.status, te.check_in, te.check_out, te.break_minutes, te.notes into _atual
          from public.timesheet_entries te
         where te.timesheet_id = _folha_id and te.employee_id = _emp
           for update;
      end;
    end if;

    if _res is null then
      _ver := _atual.versao;
      if _atual.status::text = _status and _atual.check_in is not distinct from _ent and _atual.check_out is not distinct from _sai
         and _atual.break_minutes = _int and _atual.notes is not distinct from _obs then
        _res := 'sem_alteracao';
      elsif _atual.versao = _esp then
        update public.timesheet_entries te
           set status = _status::public.attendance_status, check_in = _ent, check_out = _sai, break_minutes = _int, notes = _obs
         where te.timesheet_id = _folha_id and te.employee_id = _emp
        returning te.versao into _ver;
        _res := 'atualizado';
      else
        raise exception 'Apontamento alterado por outra sessão (versão atual %, esperada %). Recarregue e refaça a alteração.',
          _atual.versao, _esp using errcode = '40001';
      end if;
    end if;

    _saida := _saida || jsonb_build_object('employee_id', _emp, 'versao', _ver, 'resultado', _res);
  end loop;

  return jsonb_build_object('timesheet_id', _folha_id, 'linhas', _saida);
end;
$$;

comment on function public.salvar_apontamento_admin_v2(uuid, uuid, date, jsonb) is
  '054: como salvar_apontamento_admin, com versao_esperada OBRIGATÓRIA por linha (0 = nova): versão obsoleta com conteúdo diferente = 40001; conteúdo idêntico = sem_alteracao. Aceita confirmar_virada (admin). Chave desconhecida = 22023.';
comment on function public.salvar_apontamento_operacional_v2(uuid, uuid, date, jsonb) is
  '054: como salvar_apontamento_operacional, com versao_esperada OBRIGATÓRIA por linha (0 = nova) e controle otimista atômico; aceita só as seis chaves da v1 mais versao_esperada (22023 para qualquer outra). Não escreve coluna financeira; não confirma virada.';
comment on function public.listar_apontamentos_do_operador_v2(uuid, uuid, date) is
  '054: listar_apontamentos_do_operador mais a versao de cada linha; nada financeiro.';
comment on function public.confirmar_virada_do_apontamento(uuid, bigint) is
  '054: o admin (MFA em dia) confirma a virada da meia-noite fora de turno que vira o dia, na versão informada (40001 se mudou). Gravado na trilha apontamento_confirmacoes_virada; idempotente.';
comment on function public.situacao_da_virada(uuid) is
  '054: sem_virada | turno_vira_o_dia | confirmada | pendente. Só admin.';

-- ---------------------------------------------------------------------------
-- 5. Privilégios e dono
-- ---------------------------------------------------------------------------

revoke all on function public.versionar_apontamento() from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.proteger_confirmacao_de_virada() from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.invalidar_confirmacao_de_virada() from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.classificar_virada_do_apontamento(uuid) from public, anon, authenticated, service_role, bslog_rpc_operacional;

revoke all on function public.situacao_da_virada(uuid) from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.confirmar_virada_do_apontamento(uuid, bigint) from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.salvar_apontamento_admin_v2(uuid, uuid, date, jsonb) from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.listar_apontamentos_do_operador_v2(uuid, uuid, date) from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on function public.salvar_apontamento_operacional_v2(uuid, uuid, date, jsonb) from public, anon, authenticated, service_role, bslog_rpc_operacional;

grant execute on function public.situacao_da_virada(uuid) to authenticated;
grant execute on function public.confirmar_virada_do_apontamento(uuid, bigint) to authenticated;
grant execute on function public.salvar_apontamento_admin_v2(uuid, uuid, date, jsonb) to authenticated;
grant execute on function public.listar_apontamentos_do_operador_v2(uuid, uuid, date) to authenticated;
grant execute on function public.salvar_apontamento_operacional_v2(uuid, uuid, date, jsonb) to authenticated;

-- O único privilégio novo do papel do operador: ler a versão. A versão é escrita pelo gatilho,
-- que não exige privilégio de coluna.
grant select (versao) on table public.timesheet_entries to bslog_rpc_operacional;

-- Troca de dono das duas RPCs do operador, pelo procedimento da 013: o novo dono precisa de CREATE
-- no schema durante o ALTER; concedido e revogado na mesma transação.
grant create on schema public to bslog_rpc_operacional;
alter function public.salvar_apontamento_operacional_v2(uuid, uuid, date, jsonb) owner to bslog_rpc_operacional;
alter function public.listar_apontamentos_do_operador_v2(uuid, uuid, date) owner to bslog_rpc_operacional;
revoke create on schema public from bslog_rpc_operacional;

-- ---------------------------------------------------------------------------
-- 6. Autoverificação: catálogo e comportamento do gatilho de versão (sem tocar dado real)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _r   text;
  _v   bigint;
begin
  if (select is_nullable || '|' || data_type || '|' || column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'timesheet_entries' and column_name = 'versao') <> 'NO|bigint|1' then
    raise exception '054: coluna versao fora do formato esperado.';
  end if;
  if exists (select 1 from public.timesheet_entries where versao is null or versao < 1) then
    raise exception '054: versão nula ou menor que 1.';
  end if;

  -- O gatilho da versão é o ÚLTIMO BEFORE ROW de INSERT e de UPDATE (ordem real: nome, em "C").
  select t.tgname into _r from pg_trigger t
   where t.tgrelid = 'public.timesheet_entries'::regclass and not t.tgisinternal
     and t.tgtype & 3 = 3 and t.tgtype & 16 = 16
   order by t.tgname collate "C" desc limit 1;
  if _r is distinct from 'trg_timesheet_entries_zz_versao' then
    raise exception '054: o gatilho da versão não é o último BEFORE UPDATE (é %).', _r;
  end if;
  select t.tgname into _r from pg_trigger t
   where t.tgrelid = 'public.timesheet_entries'::regclass and not t.tgisinternal
     and t.tgtype & 3 = 3 and t.tgtype & 4 = 4
   order by t.tgname collate "C" desc limit 1;
  if _r is distinct from 'trg_timesheet_entries_zz_versao' then
    raise exception '054: o gatilho da versão não é o último BEFORE INSERT (é %).', _r;
  end if;

  -- Donas, segurança e search_path.
  select string_agg(p.proname || ':' || case when p.prosecdef then 'D' else 'I' end || ':' || pg_get_userbyid(p.proowner)
                    || ':' || exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')::text, ',' order by p.proname)
    into _r
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('salvar_apontamento_admin_v2', 'salvar_apontamento_operacional_v2', 'listar_apontamentos_do_operador_v2',
                       'confirmar_virada_do_apontamento', 'situacao_da_virada', 'versionar_apontamento',
                       'invalidar_confirmacao_de_virada', 'proteger_confirmacao_de_virada', 'classificar_virada_do_apontamento');
  if _r <> 'classificar_virada_do_apontamento:I:postgres:true,confirmar_virada_do_apontamento:D:postgres:true,invalidar_confirmacao_de_virada:D:postgres:true,listar_apontamentos_do_operador_v2:D:bslog_rpc_operacional:true,proteger_confirmacao_de_virada:I:postgres:true,salvar_apontamento_admin_v2:I:postgres:true,salvar_apontamento_operacional_v2:D:bslog_rpc_operacional:true,situacao_da_virada:D:postgres:true,versionar_apontamento:I:postgres:true' then
    raise exception '054: donas/segurança fora do esperado: %', _r;
  end if;

  -- Ninguém de fora executa as internas; anon e PUBLIC não executam nenhuma.
  if exists (select 1 from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('versionar_apontamento', 'invalidar_confirmacao_de_virada', 'proteger_confirmacao_de_virada',
                                  'classificar_virada_do_apontamento')
                and has_function_privilege(r, p.oid, 'EXECUTE'))
     or exists (select 1 from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('salvar_apontamento_admin_v2', 'salvar_apontamento_operacional_v2', 'listar_apontamentos_do_operador_v2',
                                     'confirmar_virada_do_apontamento', 'situacao_da_virada')
                   and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE')
                        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                        or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception '054: EXECUTE fora do esperado.';
  end if;

  -- O operador: SELECT(versao) e nada além do que tinha; nenhuma permissão de tabela inteira.
  if not has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'versao', 'SELECT')
     or has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'versao', 'UPDATE')
     or has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'versao', 'INSERT')
     or exists (select 1 from information_schema.role_table_grants where grantee = 'bslog_rpc_operacional')
     or has_schema_privilege('bslog_rpc_operacional', 'public', 'CREATE')
     or has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'billed_amount', 'SELECT')
     or has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'invoice_id', 'SELECT') then
    raise exception '054: privilégios do papel do operador fora do esperado.';
  end if;

  -- A trilha: RLS ligada e nenhuma escrita por papel da API.
  if not (select relrowsecurity from pg_class where oid = 'public.apontamento_confirmacoes_virada'::regclass)
     or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r,
                       unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pr
                 where has_table_privilege(r, 'public.apontamento_confirmacoes_virada', pr)) then
    raise exception '054: a trilha de confirmações ficou gravável por papel da API.';
  end if;

  -- Comportamento do gatilho de versão numa tabela TEMPORÁRIA (nenhum dado real).
  create temporary table _verifica_054 (id int primary key, a text, versao bigint not null default 1, updated_at timestamptz) on commit drop;
  create trigger _verifica_054 before insert or update on pg_temp._verifica_054
    for each row execute function public.versionar_apontamento();
  insert into pg_temp._verifica_054 (id, a, versao) values (1, 'x', 99);
  update pg_temp._verifica_054 set a = 'y' where id = 1;
  update pg_temp._verifica_054 set a = 'y', updated_at = now() where id = 1;
  update pg_temp._verifica_054 set versao = 50 where id = 1;
  select versao into _v from pg_temp._verifica_054 where id = 1;
  if _v <> 2 then
    raise exception '054: gatilho de versão: esperado 2 (INSERT=1, mudança +1, sem mudança e versão do cliente ignoradas), obtido %.', _v;
  end if;
  drop table pg_temp._verifica_054;
end;
$verificacao$;

commit;
