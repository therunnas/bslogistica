-- REVERSÃO da migration 20261106120000_039_funcoes_e_periodo_do_turno (FIN-PR-06).
--
-- Devolve estado_motor_vigencia ao corpo da 038 e remove o catálogo de funções, as colunas novas de
-- colaborador, alocação e turno, os gatilhos e as RPCs da 039. NÃO toca: 035 a 038, cálculo, custo,
-- tarifa, snapshot, fatura, RLS e grants das tabelas existentes, autenticação, MFA.
--
-- REVERTER CÓDIGO, FUNÇÕES E DADOS SÃO COISAS DIFERENTES
--   * código: reverter o deploy do app. O app desta etapa detecta a capacidade (`funcoes_turno`) e
--     volta sozinho ao comportamento de antes num banco sem a 039;
--   * funções: este script;
--   * dados: remover as colunas apaga o que o administrador informou depois da 039. Por isso a
--     reversão RECUSA se existir (a) turno classificado, (b) função em alguma alocação, (c) função
--     de colaborador que NÃO seja o vínculo automático por texto exato (esse é derivável de
--     employees.role, que nunca foi alterado), ou (d) catálogo diferente do inicial (função criada,
--     renomeada ou inativada). Nesse caso a decisão é de negócio, não de rollback.
--
-- Executar só com autorização, como `postgres`, em uma transação.

begin;

do $pre$
begin
  if exists (select 1 from public.shifts where shift_period is not null) then
    raise exception 'Reversão recusada: há turno classificado como diurno/noturno.' using errcode = '55000';
  end if;
  if exists (select 1 from public.operation_team where job_function_id is not null) then
    raise exception 'Reversão recusada: há alocação com função.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.employees e
      left join public.job_functions f on f.id = e.job_function_id
     where e.job_function_id is not null
       and (e.role is null or public.normalizar_texto_chave(e.role) <> f.name_key)
  ) then
    raise exception 'Reversão recusada: há colaborador com função padrão escolhida pelo administrador.' using errcode = '55000';
  end if;
  if (select count(*) from public.job_functions) <> 4
     or exists (select 1 from public.job_functions
                 where not active or created_by is not null or updated_by is not null
                    or code not in ('auxiliar_producao', 'conferente', 'operador', 'administrativo')) then
    raise exception 'Reversão recusada: o catálogo de funções foi alterado depois da 039.' using errcode = '55000';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- Função com a mesma assinatura: corpo vigente antes da 039 (privilégios preservados)
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
    'periodo_contratual', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Gatilhos, colunas e catálogo
-- ---------------------------------------------------------------------------

drop trigger trg_shifts_classificacao on public.shifts;
drop trigger trg_employees_funcao_ativa on public.employees;
drop trigger trg_operation_team_funcao_ativa on public.operation_team;

alter table public.shifts
  drop constraint shifts_periodo_valido,
  drop column shift_period,
  drop column shift_period_set_by,
  drop column shift_period_set_at;

drop index public.employees_job_function_idx;
drop index public.operation_team_job_function_idx;
alter table public.employees drop column job_function_id;
alter table public.operation_team drop column job_function_id;

drop table public.job_functions;

drop function public.vincular_funcoes_exatas();
drop function public.mapear_funcoes_por_texto_interno();
drop function public.alterar_situacao_funcao(uuid, boolean);
drop function public.renomear_funcao(uuid, text);
drop function public.criar_funcao(text, text);
drop function public.funcoes_exigir_admin();
drop function public.validar_funcao_ativa();
drop function public.registrar_classificacao_do_turno();
drop function public.proteger_funcao();
drop function public.normalizar_texto_chave(text);

do $pos$
begin
  if to_regclass('public.job_functions') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and proname in ('criar_funcao', 'renomear_funcao', 'alterar_situacao_funcao', 'vincular_funcoes_exatas',
                                 'funcoes_exigir_admin', 'normalizar_texto_chave', 'validar_funcao_ativa',
                                 'mapear_funcoes_por_texto_interno', 'proteger_funcao', 'registrar_classificacao_do_turno')) then
    raise exception 'Reversão incompleta: objetos da 039 ainda existem.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and column_name in ('job_function_id', 'shift_period', 'shift_period_set_by', 'shift_period_set_at')) then
    raise exception 'Reversão incompleta: colunas da 039 ainda existem.';
  end if;
end;
$pos$;

-- Conferir antes de confirmar. Para desfazer o ensaio: rollback.
commit;
