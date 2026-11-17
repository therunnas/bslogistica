-- Gate C / D1 — vigência do contrato no BANCO. SOMENTE LOCAL + CI até autorização própria para HML
-- e Production.
--
-- REGRA (decisão do responsável, 16/11/2026):
--   - a data de execução do serviço (a data da folha) precisa estar dentro da vigência do contrato
--     da operação: entre o início e o fim, os dois INCLUSIVOS; contrato sem fim = vigência aberta;
--   - serviço executado dentro da vigência pode ser faturado depois, mesmo após o fim do contrato;
--   - lançamentos históricos não são alterados nem recalculados; fatura emitida não muda;
--   - operação sem contrato segue as regras que já tinha.
--
-- DEFEITO (D1, Gate C). As datas do contrato eram conferidas só na tela (CP-02, D-CP02-02): a API e
-- `criar_contrato_com_vigencia` aceitavam fim antes do início e ano 0001 (o contrato TESTE-MANUAL do
-- HML tem fim 01/01/0001). E o fim do contrato não limitava nada: um dia depois dele era lançado e
-- cobrado (DEC-CP02-01, CN-D).
--
-- O QUE ESTA MIGRATION FAZ
--   1. `contracts_vigencia_valida` (CHECK, NOT VALID): início e fim entre 1900 e 2100 (os limites da
--      tela) e fim >= início. NOT VALID de propósito: o PostgreSQL não confere as linhas que já
--      existem, então o registro antigo inválido do HML continua lá, intocado; toda gravação NOVA
--      (inclusão ou edição de qualquer coluna da linha) passa a cumprir a regra. Validar o que já
--      existe (`validate constraint`) fica para depois da decisão sobre o registro antigo.
--   2. `recusar_execucao_fora_da_vigencia()` + gatilho BEFORE INSERT OR UPDATE nos apontamentos:
--      recusa (23514, detalhe `vigencia_do_contrato`) apontamento de serviço (status diferente de
--      `absent`) cuja folha está fora da vigência do contrato da operação. Lê a data e a operação da
--      própria folha (o payload não decide). Num UPDATE, só revalida quando muda o que decide a
--      cobrança daquele dia: folha, colaborador, status, entrada, saída, intervalo ou a chave
--      (data/operação, repassada pela folha — mover uma folha com apontamento para fora da vigência
--      cai aqui). Observação, vínculo de fatura (`gerar_fatura`), versão e leitura seguem livres:
--      histórico fora da vigência continua editável nesses campos e faturável como estava.
--
-- O QUE NÃO MUDA: cálculo de diária, hora extra, custo, domingo/feriado, snapshots, faturamento,
-- RLS, grants de tabela, RPCs, motor por vigência, migrations 001–054. Nenhuma linha é lida para
-- alterar, nem escrita. Sem isenção por papel (`postgres` incluído), `current_user`, variável de
-- sessão ou `service_role`.
--
-- FORA DO ESCOPO (decisão pendente, sem presunção): adicionais de serviço (`billing_additionals`,
-- cobrados por período) e o legado de contêiner (`container_services`, só a correção segue aberta);
-- alterar a vigência de um contrato ou o contrato de uma operação não revalida o que já foi lançado.
--
-- REVERSÃO: docs/runbooks/rollback-vigencia-do-contrato.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Datas do contrato
-- ---------------------------------------------------------------------------

alter table public.contracts drop constraint if exists contracts_vigencia_valida;
alter table public.contracts add constraint contracts_vigencia_valida check (
  valid_from between date '1900-01-01' and date '2100-12-31'
  and (valid_to is null
       or (valid_to between date '1900-01-01' and date '2100-12-31' and valid_to >= valid_from))
) not valid;

comment on constraint contracts_vigencia_valida on public.contracts is
  '055 (D1): início e fim entre 1900 e 2100 e fim >= início (fim inclusivo; sem fim = vigência aberta). NOT VALID: não confere registros anteriores à 055; vale para toda gravação nova.';

-- ---------------------------------------------------------------------------
-- 2. Data de execução dentro da vigência
-- ---------------------------------------------------------------------------

create or replace function public.recusar_execucao_fora_da_vigencia()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _data     date;
  _operacao uuid;
  _inicio   date;
  _fim      date;
begin
  -- Falta não é serviço executado: nada é cobrado.
  if new.status = 'absent' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Histórico: só revalida quando muda o que decide a cobrança do dia.
    if new.timesheet_id is not distinct from old.timesheet_id
       and new.employee_id is not distinct from old.employee_id
       and new.status is not distinct from old.status
       and new.check_in is not distinct from old.check_in
       and new.check_out is not distinct from old.check_out
       and new.break_minutes is not distinct from old.break_minutes
       and new.work_date is not distinct from old.work_date
       and new.operation_id is not distinct from old.operation_id then
      return new;
    end if;
  else
    -- Upsert de linha existente: a decisão é do UPDATE do ON CONFLICT (padrão da 029 e da 053).
    if exists (select 1 from public.timesheet_entries e where e.id = new.id)
       or exists (select 1 from public.timesheet_entries e
                   where e.timesheet_id = new.timesheet_id and e.employee_id = new.employee_id) then
      return new;
    end if;
  end if;

  -- A data e a operação vêm da folha, nunca do payload.
  select t.work_date, t.operation_id into _data, _operacao
    from public.timesheets t where t.id = new.timesheet_id;
  if not found then
    return new; -- sem folha, a chave da diária (008) recusa com 23503
  end if;

  select c.valid_from, c.valid_to into _inicio, _fim
    from public.operations o join public.contracts c on c.id = o.contract_id
   where o.id = _operacao;
  if not found then
    return new; -- operação sem contrato: segue as próprias regras
  end if;

  if _fim is not null and _fim < _inicio then
    raise exception 'O contrato desta operação tem fim (%) antes do início (%): nenhuma data está dentro da vigência. Corrija as datas do contrato antes de lançar.',
        to_char(_fim, 'DD/MM/YYYY'), to_char(_inicio, 'DD/MM/YYYY')
      using errcode = '23514',
            detail = 'vigencia_do_contrato',
            hint = 'Serviço executado dentro da vigência pode ser faturado mesmo depois do fim do contrato.';
  end if;

  if _data >= _inicio and (_fim is null or _data <= _fim) then
    return new;
  end if;

  raise exception 'A data % está fora da vigência do contrato desta operação (%). Lance só datas dentro da vigência ou ajuste a vigência do contrato.',
      to_char(_data, 'DD/MM/YYYY'),
      case when _fim is null then 'desde ' || to_char(_inicio, 'DD/MM/YYYY')
           else 'de ' || to_char(_inicio, 'DD/MM/YYYY') || ' até ' || to_char(_fim, 'DD/MM/YYYY') end
    using errcode = '23514',
          detail = 'vigencia_do_contrato',
          hint = 'Serviço executado dentro da vigência pode ser faturado mesmo depois do fim do contrato.';
end;
$$;

comment on function public.recusar_execucao_fora_da_vigencia() is
  '055 (D1): recusa (23514, detalhe vigencia_do_contrato) apontamento de serviço cuja folha está fora da vigência do contrato da operação (início e fim inclusivos; sem fim = aberta). Ignora ausência e operação sem contrato; não revalida histórico cujo dia de cobrança não mudou.';

drop trigger if exists trg_timesheet_entries_bloqueia_fora_da_vigencia on public.timesheet_entries;
create trigger trg_timesheet_entries_bloqueia_fora_da_vigencia
  before insert or update on public.timesheet_entries
  for each row execute function public.recusar_execucao_fora_da_vigencia();

alter function public.recusar_execucao_fora_da_vigencia() owner to postgres;
revoke all on function public.recusar_execucao_fora_da_vigencia()
  from public, anon, authenticated, service_role, bslog_rpc_operacional;

-- ---------------------------------------------------------------------------
-- Autoverificação (catálogo)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _f regprocedure := 'public.recusar_execucao_fora_da_vigencia()'::regprocedure;
  _papel text;
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.timesheet_entries'::regclass
                    and t.tgname = 'trg_timesheet_entries_bloqueia_fora_da_vigencia'
                    and t.tgfoid = _f and t.tgenabled = 'O' and t.tgtype = 23) then
    raise exception '055: gatilho ausente, desabilitado ou fora do formato (BEFORE INSERT OR UPDATE FOR EACH ROW).';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = _f and p.prosecdef
                   and pg_get_userbyid(p.proowner) = 'postgres'
                   and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception '055: a função deveria ser SECURITY DEFINER da postgres com search_path fixo.';
  end if;
  foreach _papel in array array['anon', 'authenticated', 'service_role', 'bslog_rpc_operacional'] loop
    if has_function_privilege(_papel, _f, 'EXECUTE') then
      raise exception '055: % executa a função do gatilho.', _papel;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = _f and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception '055: há EXECUTE da função do gatilho além da dona (inclusive PUBLIC).';
  end if;
  if not exists (select 1 from pg_constraint k
                  where k.conrelid = 'public.contracts'::regclass and k.conname = 'contracts_vigencia_valida'
                    and k.contype = 'c' and not k.convalidated) then
    raise exception '055: CHECK contracts_vigencia_valida ausente ou validado (deveria ser NOT VALID).';
  end if;
  -- O gatilho de versão (054) continua o último BEFORE da tabela.
  if (select max(t.tgname) from pg_trigger t
       where t.tgrelid = 'public.timesheet_entries'::regclass and not t.tgisinternal
         and (t.tgtype & 2) = 2) <> 'trg_timesheet_entries_zz_versao' then
    raise exception '055: trg_timesheet_entries_zz_versao deixou de ser o último gatilho BEFORE.';
  end if;
end;
$verificacao$;

commit;
