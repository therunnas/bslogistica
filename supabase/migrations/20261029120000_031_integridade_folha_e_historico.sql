-- C06/C07 — integridade da folha e do histórico, e salvamento atômico do administrador.
--
-- LOCAL: não aplicada em nenhum banco remoto. Posterior à 030.
--
-- REPRODUZIDO em banco local (migrations até a 030):
--   1. admin AAL2 alterava e inseria apontamento em folha FECHADA (só a interface e a RPC do
--      operador a respeitavam);
--   2. excluir um colaborador ou uma operação apagava, em cascata, o histórico NÃO faturado
--      (o faturado já era protegido pelas migrations 011/028);
--   3. salvar o apontamento do admin eram duas escritas do navegador (folha, depois linhas):
--      falha entre elas deixava folha vazia e o retry esbarrava nos índices únicos.
-- Confirmado como JÁ correto (nada a corrigir): reabrir uma folha com apontamento faturado é
-- permitido e o faturado segue imutável (011); a regra de quando reabrir é decisão comercial.
--
-- O QUE FAZ
--   a) trigger: escrita (INSERT/UPDATE) em apontamento de folha fechada é recusada (55000), exceto
--      o vínculo com a fatura (`invoice_id`), que `gerar_fatura` grava em folha fechada; a folha é
--      lida com FOR SHARE, então fechar a folha e gravar nela não se cruzam;
--   b) triggers: excluir colaborador, operação ou folha com apontamento de presença/substituição
--      NÃO faturado é recusado (55000). Falta (sem valor) e cadastro sem histórico seguem livres.
--      O caminho é desativar o cadastro (`status`), não apagar;
--   c) RPC `salvar_apontamento_admin`: folha (criada ou existente) e linhas na MESMA transação,
--      idempotente (a linha é resolvida por colaborador na folha), `security invoker` (a RLS
--      continua valendo) e admin AAL2 exigido na entrada.
--
-- REVERSÃO: drop function public.salvar_apontamento_admin(uuid, uuid, date, jsonb);
--   drop trigger trg_timesheet_entries_bloqueia_folha_fechada on public.timesheet_entries;
--   drop trigger trg_employees_protege_historico on public.employees;
--   drop trigger trg_operations_protege_historico on public.operations;
--   drop trigger trg_timesheets_protege_historico on public.timesheets;
--   drop function public.bloquear_escrita_em_folha_fechada();
--   drop function public.proteger_historico_nao_faturado();

begin;

-- ---------------------------------------------------------------------------
-- a) Folha fechada não recebe escrita
-- ---------------------------------------------------------------------------

create or replace function public.bloquear_escrita_em_folha_fechada()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _status public.timesheet_status;
begin
  -- FOR SHARE: um fechamento concorrente (UPDATE da folha) espera esta escrita terminar, e uma
  -- escrita que começa depois do fechamento lê "closed" e é recusada.
  select t.status into _status from public.timesheets t where t.id = new.timesheet_id for share;

  if tg_op = 'UPDATE' then
    -- Só o vínculo com a fatura muda em folha fechada (gerar_fatura). Qualquer outra coluna, ou
    -- a troca de folha, é escrita.
    if (to_jsonb(new) - 'invoice_id' - 'updated_at') = (to_jsonb(old) - 'invoice_id' - 'updated_at')
       and new.timesheet_id = old.timesheet_id then
      return new;
    end if;
    if new.timesheet_id <> old.timesheet_id and exists (
         select 1 from public.timesheets t where t.id = old.timesheet_id and t.status = 'closed') then
      raise exception 'A folha de origem está fechada: o apontamento não pode ser movido.'
        using errcode = '55000', hint = 'Reabra a folha para corrigir.';
    end if;
  end if;

  if _status = 'closed' then
    raise exception 'A folha está fechada: o apontamento não pode ser % nela.',
      case tg_op when 'INSERT' then 'criado' else 'alterado' end
      using errcode = '55000', hint = 'Reabra a folha para corrigir.';
  end if;
  return new;
end;
$$;

revoke all on function public.bloquear_escrita_em_folha_fechada() from public, anon, authenticated, service_role;

drop trigger if exists trg_timesheet_entries_bloqueia_folha_fechada on public.timesheet_entries;
create trigger trg_timesheet_entries_bloqueia_folha_fechada
  before insert or update on public.timesheet_entries
  for each row execute function public.bloquear_escrita_em_folha_fechada();

-- ---------------------------------------------------------------------------
-- b) Histórico não faturado não some por exclusão de cadastro
-- ---------------------------------------------------------------------------

create or replace function public.proteger_historico_nao_faturado()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _tem boolean;
begin
  _tem := case tg_table_name
    when 'employees' then exists (
      select 1 from public.timesheet_entries e
       where e.employee_id = old.id and e.status <> 'absent' and e.invoice_id is null)
    when 'operations' then exists (
      select 1 from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
       where t.operation_id = old.id and e.status <> 'absent' and e.invoice_id is null)
    when 'timesheets' then exists (
      select 1 from public.timesheet_entries e
       where e.timesheet_id = old.id and e.status <> 'absent' and e.invoice_id is null)
  end;
  if _tem then
    raise exception 'Exclusão recusada: há apontamento não faturado vinculado a este cadastro.'
      using errcode = '55000',
            hint = 'O histórico financeiro não é apagado por exclusão de cadastro. Desative o cadastro em vez de excluir.';
  end if;
  return old;
end;
$$;

revoke all on function public.proteger_historico_nao_faturado() from public, anon, authenticated, service_role;

drop trigger if exists trg_employees_protege_historico on public.employees;
create trigger trg_employees_protege_historico
  before delete on public.employees
  for each row execute function public.proteger_historico_nao_faturado();
drop trigger if exists trg_operations_protege_historico on public.operations;
create trigger trg_operations_protege_historico
  before delete on public.operations
  for each row execute function public.proteger_historico_nao_faturado();
drop trigger if exists trg_timesheets_protege_historico on public.timesheets;
create trigger trg_timesheets_protege_historico
  before delete on public.timesheets
  for each row execute function public.proteger_historico_nao_faturado();

-- ---------------------------------------------------------------------------
-- c) Salvamento atômico do administrador
-- ---------------------------------------------------------------------------

create or replace function public.salvar_apontamento_admin(
  p_operation_id uuid,
  p_shift_id     uuid,
  p_work_date    date,
  p_linhas       jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _folha   public.timesheets%rowtype;
  _criada  boolean := false;
  _l       jsonb;
  _emp     uuid;
  _status  public.attendance_status;
  _existe  uuid;
  _n       integer := 0;
begin
  -- Invoker: a RLS já exige admin AAL2 nas tabelas; a entrada recusa cedo e com mensagem clara.
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  if (auth.jwt() ->> 'aal') is distinct from 'aal2' then
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
$$;

revoke all on function public.salvar_apontamento_admin(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.salvar_apontamento_admin(uuid, uuid, date, jsonb) to authenticated;

comment on function public.salvar_apontamento_admin(uuid, uuid, date, jsonb) is
  'Salva o apontamento do administrador: folha (criada ou existente) e linhas na mesma transação, idempotente por colaborador na folha. security invoker: a RLS vale; exige admin AAL2.';

commit;
