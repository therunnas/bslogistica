-- 053 — GATE-FIN-03: o intervalo não pode ser maior que o tempo entre a entrada e a saída.
--
-- PROBLEMA (CP-10, SQL 090 I5). Com entrada e saída preenchidas, `break_minutes` maior que a
-- duração bruta zera a jornada (`greatest(0, …)`). Com o motor por vigência DESLIGADO, o
-- apontamento era gravado assim e a diária cobrada; com o motor LIGADO, o núcleo (035) recusava
-- a jornada zerada com 22023 `nucleo:zero_minuto_com_horarios`, mensagem técnica que não diz o
-- que corrigir. O motor é um interruptor (`alterar_motor_vigencia`, reversão da 031): a regra não
-- pode depender dele. A 014 deixou o teto de propósito para depois ("teto estrutural precisaria
-- de trigger").
--
-- REGRA (estrutural, sem decisão comercial): status diferente de `absent`, entrada E saída
-- preenchidas e `break_minutes` maior que a duração bruta → recusa com 23514 e mensagem em
-- português (a tela do admin a mostra como está; a do operador mostra a explicação fixa do 23514).
-- A duração bruta é a MESMA do motor (014/036/048/051): hora*60+minuto; saída menor ou igual à
-- entrada soma 1440.
--
-- O QUE NÃO MUDA:
--   - intervalo IGUAL à duração (jornada 0) passa por esta regra; com o motor ligado o núcleo
--     continua a recusá-lo, como antes. Nenhuma regra nova para ele;
--   - virada legítima da meia-noite, intervalo zero, ausência e apontamento incompleto;
--   - nenhum cálculo: diária, hora extra, custo, domingo/feriado, faturamento;
--   - nenhum dado: o histórico que já viola NÃO é revalidado enquanto entrada, saída, intervalo e
--     status não mudarem — observação, vínculo de fatura e leitura seguem livres (preflight:
--     supabase/preflight/053_intervalo_maior_que_jornada_preflight.sql);
--   - nenhuma permissão, RLS, assinatura de RPC ou contrato;
--   - jornada máxima (DEC-CP05-01, 054/058) e saída antes da entrada em turno diurno (I1): fora.
--
-- MECANISMO: trigger BEFORE INSERT OR UPDATE, no padrão de `recusar_entrada_igual_saida` (029).
-- Pelo nome dispara antes do motor (`trg_timesheet_entries_calculo_vigencia`) e depois da trava de
-- entrada igual à saída. Não há caminho que o pule: escrita direta (PostgREST), as RPCs do admin
-- e do operador e o upsert anterior da tela passam todos pela tabela. Como na 029, a recusa no
-- INSERT de uma linha que já existe (upsert, ON CONFLICT) fica para o UPDATE que se segue.
--
-- ROLLBACK: docs/runbooks/rollback-recusar-intervalo-maior-que-jornada.sql (DROP do trigger e da
-- função; nenhum dado).

create or replace function public.recusar_intervalo_maior_que_jornada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _inicio integer;
  _fim    integer;
  _bruto  integer;
begin
  if new.status = 'absent' or new.check_in is null or new.check_out is null
     or new.break_minutes is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Histórico: só revalida quando a jornada é regravada.
    if new.status is not distinct from old.status
       and new.check_in is not distinct from old.check_in
       and new.check_out is not distinct from old.check_out
       and new.break_minutes is not distinct from old.break_minutes then
      return new;
    end if;
  else
    -- Upsert de linha existente: a decisão é do UPDATE do ON CONFLICT (padrão da 029).
    if exists (select 1 from public.timesheet_entries e where e.id = new.id)
       or exists (select 1 from public.timesheet_entries e
                   where e.timesheet_id = new.timesheet_id and e.employee_id = new.employee_id) then
      return new;
    end if;
  end if;

  -- Mesma granularidade e mesma virada do motor: hora e minuto; saída <= entrada soma 1440.
  _inicio := extract(hour from new.check_in)::integer * 60 + extract(minute from new.check_in)::integer;
  _fim := extract(hour from new.check_out)::integer * 60 + extract(minute from new.check_out)::integer;
  if _fim <= _inicio then
    _fim := _fim + 1440;
  end if;
  _bruto := _fim - _inicio;

  if new.break_minutes <= _bruto then
    return new;
  end if;

  raise exception 'O intervalo de % min é maior que o tempo entre a entrada e a saída (% min). Corrija o intervalo ou os horários antes de salvar.',
      new.break_minutes, _bruto
    using errcode = '23514',
          hint = 'Para turno que vira a meia-noite, a saída é menor que a entrada (ex.: 22:00 → 06:00).';
end;
$$;

comment on function public.recusar_intervalo_maior_que_jornada() is
  '053: recusa (23514) intervalo maior que a duração bruta entre entrada e saída (fórmula do motor). Ignora ausência e apontamento incompleto; não revalida histórico cuja jornada não mudou.';

drop trigger if exists trg_timesheet_entries_bloqueia_intervalo_maior on public.timesheet_entries;
create trigger trg_timesheet_entries_bloqueia_intervalo_maior
  before insert or update on public.timesheet_entries
  for each row execute function public.recusar_intervalo_maior_que_jornada();

alter function public.recusar_intervalo_maior_que_jornada() owner to postgres;
revoke all on function public.recusar_intervalo_maior_que_jornada()
  from public, anon, authenticated, service_role, bslog_rpc_operacional;

-- ---------------------------------------------------------------------------
-- Autoverificação: catálogo e comportamento (sem tocar dado real)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _f   oid := 'public.recusar_intervalo_maior_que_jornada()'::regprocedure;
  _r   text;
  _caso record;
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.timesheet_entries'::regclass
                    and t.tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior'
                    and t.tgfoid = _f and t.tgenabled = 'O' and t.tgtype = 23) then
    raise exception '053: trigger ausente ou fora do formato BEFORE INSERT OR UPDATE FOR EACH ROW.';
  end if;
  if not (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
                 and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
            from pg_proc p where p.oid = _f) then
    raise exception '053: a função deve ser SECURITY DEFINER da postgres com search_path fixo.';
  end if;
  if exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional']) r
              where has_function_privilege(r, _f, 'EXECUTE'))
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = _f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '053: nenhum papel externo pode executar a função.';
  end if;

  -- Comportamento: a mesma função num gatilho de tabela TEMPORÁRIA (sem FK, sem outros gatilhos,
  -- sem nenhuma linha real), descartada no fim.
  create temporary table _verifica_053 (
    id uuid primary key default gen_random_uuid(), timesheet_id uuid, employee_id uuid,
    status public.attendance_status not null, check_in time, check_out time,
    break_minutes integer not null default 0
  ) on commit drop;
  create trigger _verifica_053 before insert or update on pg_temp._verifica_053
    for each row execute function public.recusar_intervalo_maior_que_jornada();

  for _caso in
    select * from (values
      ('present', '08:00'::time, '09:00'::time, 61,  'recusa'),
      ('present', '08:00', '09:00', 60,  'aceita'),   -- limite exato
      ('present', '08:00', '17:00', 60,  'aceita'),
      ('present', '22:00', '07:00', 540, 'aceita'),   -- virada, limite
      ('present', '23:00', '01:00', 121, 'recusa'),   -- virada acima
      ('replacement', '08:00', '09:00', 61, 'recusa'),
      ('absent',  '08:00', '09:00', 300, 'aceita'),
      ('present', '08:00', null,    300, 'aceita')    -- incompleto
    ) v(st, ent, sai, intervalo, esperado)
  loop
    begin
      insert into pg_temp._verifica_053 (timesheet_id, employee_id, status, check_in, check_out, break_minutes)
      values (gen_random_uuid(), gen_random_uuid(), _caso.st::public.attendance_status, _caso.ent, _caso.sai, _caso.intervalo);
      _r := 'aceita';
    exception when check_violation then
      _r := 'recusa';
    end;
    if _r <> _caso.esperado then
      raise exception '053: % %→% com intervalo %: esperado %, obtido %.',
        _caso.st, _caso.ent, _caso.sai, _caso.intervalo, _caso.esperado, _r;
    end if;
  end loop;

  -- UPDATE: regravar a jornada revalida; mexer em outra coisa não.
  update pg_temp._verifica_053 set timesheet_id = gen_random_uuid() where check_out = '09:00' and break_minutes = 60;
  begin
    update pg_temp._verifica_053 set break_minutes = 61 where check_out = '09:00' and break_minutes = 60 and status = 'present';
    raise exception '053: UPDATE para intervalo maior deveria ser recusado.';
  exception when check_violation then
    null;
  end;

  drop table pg_temp._verifica_053;
end;
$verificacao$;
