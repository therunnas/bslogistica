-- ---------------------------------------------------------------------------
-- PREFLIGHT DA MIGRATION 055 — vigência do contrato (Gate C, D1)
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Vive em `supabase/preflight/`, que o CLI não aplica.
--
-- ESTRITAMENTE READ-ONLY: `begin transaction read only` (o PostgreSQL recusa qualquer escrita com
-- 25006) e `rollback` no fim. Devolve só contagens agregadas: nenhum nome, valor financeiro, horário
-- ou linha identificável. Serve ANTES e DEPOIS da 055. Sessão 35: rodado SOMENTE no Supabase local.
-- Em HML e em Production, só com autorização própria por ambiente e pelo transporte de leitura
-- autorizado naquele gate. Local:
--
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres -X \
--     < supabase/preflight/055_vigencia_do_contrato_preflight.sql
--
-- O que ele informa e por quê:
--   - contratos cujas datas a 055 passaria a recusar numa gravação NOVA (fim antes do início, ano
--     fora de 1900–2100): a 055 não os altera (CHECK NOT VALID), mas qualquer edição deles exige
--     corrigir as datas antes — é a fila da decisão sobre o registro antigo (DEC-CP02-03);
--   - apontamentos de serviço já gravados FORA da vigência do contrato da operação, faturados ou
--     não: ficam como estão (histórico); só uma nova decisão de cobrança sobre eles é recusada;
--   - quantos estão em operação sem contrato (fora da regra) e quantas ausências fora da vigência;
--   - o que a regra NÃO cobre e depende de decisão: adicionais e serviços de contêiner ligados a
--     operação com contrato cujo período/data cai fora da vigência.
-- ---------------------------------------------------------------------------

begin transaction read only;

with contratos as (
  select c.id, c.valid_from, c.valid_to,
         (c.valid_to is not null and c.valid_to < c.valid_from) as fim_antes,
         (c.valid_from not between date '1900-01-01' and date '2100-12-31'
          or (c.valid_to is not null and c.valid_to not between date '1900-01-01' and date '2100-12-31')) as ano_fora
    from public.contracts c
), apont as (
  select e.status, e.invoice_id is not null as faturado, o.contract_id is null as sem_contrato,
         case when o.contract_id is null then null
              else not (t.work_date >= k.valid_from and (k.valid_to is null or t.work_date <= k.valid_to)) end as fora
    from public.timesheet_entries e
    join public.timesheets t on t.id = e.timesheet_id
    join public.operations o on o.id = t.operation_id
    left join public.contracts k on k.id = o.contract_id
), adicionais as (
  select count(*) filter (where k.id is not null and (a.period_start < k.valid_from
           or (k.valid_to is not null and a.period_end > k.valid_to))) as fora
    from public.billing_additionals a
    left join public.operations o on o.id = a.operation_id
    left join public.contracts k on k.id = o.contract_id
   where a.canceled_at is null
), conteiner as (
  select count(*) filter (where k.id is not null and (s.executed_on < k.valid_from
           or (k.valid_to is not null and s.executed_on > k.valid_to))) as fora
    from public.container_services s
    left join public.operations o on o.id = s.operation_id
    left join public.contracts k on k.id = o.contract_id
   where s.canceled_at is null
)
select jsonb_pretty(jsonb_build_object(
  'migration_055_aplicada', exists (select 1 from pg_trigger where tgname = 'trg_timesheet_entries_bloqueia_fora_da_vigencia'),
  'contratos', (select jsonb_build_object(
      'total', count(*),
      'sem_fim', count(*) filter (where valid_to is null),
      'fim_antes_do_inicio', count(*) filter (where fim_antes),
      'ano_fora_de_1900_2100', count(*) filter (where ano_fora),
      'que_a_055_recusaria_numa_edicao', count(*) filter (where fim_antes or ano_fora)) from contratos),
  'apontamentos', (select jsonb_build_object(
      'total', count(*),
      'em_operacao_sem_contrato', count(*) filter (where sem_contrato),
      'servico_fora_da_vigencia', count(*) filter (where fora and status <> 'absent'),
      'servico_fora_da_vigencia_faturado', count(*) filter (where fora and status <> 'absent' and faturado),
      'servico_fora_da_vigencia_nao_faturado', count(*) filter (where fora and status <> 'absent' and not faturado),
      'ausencia_fora_da_vigencia', count(*) filter (where fora and status = 'absent')) from apont),
  'fora_do_escopo_da_055', jsonb_build_object(
      'adicionais_ativos_fora_da_vigencia', (select fora from adicionais),
      'servicos_conteiner_ativos_fora_da_vigencia', (select fora from conteiner))
)) as "055 preflight";

rollback;
