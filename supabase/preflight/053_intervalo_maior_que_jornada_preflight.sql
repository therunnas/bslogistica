-- ---------------------------------------------------------------------------
-- PREFLIGHT DA MIGRATION 053 — intervalo maior que o tempo entre entrada e saída
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Ele vive em `supabase/preflight/`, que o
-- CLI não aplica. Rodá-lo não altera nada.
--
-- É ESTRITAMENTE READ-ONLY: a transação abre com `READ ONLY` (o PostgreSQL
-- recusa qualquer escrita com 25006) e termina em `rollback`. Não há INSERT,
-- UPDATE, DELETE, ALTER, CREATE, DROP nem TRUNCATE. Devolve só contagens —
-- nenhum nome, valor financeiro ou linha identificável.
--
-- GATE-FIN-03 (sessão 19): rodado SOMENTE no Supabase LOCAL descartável. Em
-- HML e em Production ele exige autorização própria, por ambiente, e o
-- transporte de leitura autorizado naquele gate (não está autorizado aqui).
-- Local, com o projeto do E2E de pé:
--
--   docker exec -i supabase_db_bs-e2e-<id> psql -U postgres -d postgres -X \
--     < supabase/preflight/053_intervalo_maior_que_jornada_preflight.sql
--
-- POR QUE ELE EXISTE. A 053 recusa, por trigger, gravar `break_minutes` maior
-- que a duração bruta entre entrada e saída. O trigger NÃO revalida linha
-- existente que não tenha mudado entrada, saída, intervalo ou status — então o
-- histórico violador não impede a aplicação nem a fatura. Mas ele precisa ser
-- CONTADO antes, porque essas linhas seguem com jornada zerada e diária cobrada
-- (o efeito do I5) e só a pessoa responsável decide o que fazer com elas. Este
-- arquivo não corrige nada.
--
-- `duracao_bruta` segue a MESMA fórmula do motor (014/036/048/051) e da 053:
-- hora*60+minuto; se a saída for menor ou igual à entrada, soma 1440.
-- ---------------------------------------------------------------------------

begin transaction read only;

with entradas as (
  select
    te.status,
    te.break_minutes,
    te.invoice_id,
    t.status as folha_status,
    t.shift_id,
    o.type as tipo_operacao,
    case
      when te.check_in is null or te.check_out is null then null
      else (
        (extract(hour from te.check_out) * 60 + extract(minute from te.check_out))
        + case
            when (extract(hour from te.check_out) * 60 + extract(minute from te.check_out))
               <= (extract(hour from te.check_in)  * 60 + extract(minute from te.check_in))
            then 1440 else 0
          end
      ) - (extract(hour from te.check_in) * 60 + extract(minute from te.check_in))
    end as duracao_bruta,
    (te.check_in is not null and te.check_out is not null
      and (extract(hour from te.check_out) * 60 + extract(minute from te.check_out))
       <= (extract(hour from te.check_in)  * 60 + extract(minute from te.check_in))) as vira_meia_noite
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations o on o.id = t.operation_id
),
violacoes as (
  -- Exatamente o que a 053 recusaria se a linha fosse gravada de novo.
  select * from entradas
   where status <> 'absent' and duracao_bruta is not null and break_minutes > duracao_bruta
)
select jsonb_pretty(jsonb_build_object(
  'medido_em', now(),
  'total_de_apontamentos', (select count(*) from entradas),
  'com_entrada_e_saida', (select count(*) from entradas where duracao_bruta is not null),
  'violacoes', (select jsonb_build_object(
      'total',                 count(*),
      'faturadas',             count(*) filter (where invoice_id is not null),
      'nao_faturadas',         count(*) filter (where invoice_id is null),
      'folha_aberta',          count(*) filter (where folha_status = 'open'),
      'folha_fechada',         count(*) filter (where folha_status = 'closed'),
      'operacao_fixa',         count(*) filter (where tipo_operacao = 'fixed'),
      'operacao_avulsa',       count(*) filter (where tipo_operacao = 'spot'),
      'com_turno',             count(*) filter (where shift_id is not null),
      'sem_turno',             count(*) filter (where shift_id is null),
      'virando_a_meia_noite',  count(*) filter (where vira_meia_noite),
      'status_present',        count(*) filter (where status = 'present'),
      'status_replacement',    count(*) filter (where status = 'replacement'),
      'maior_excesso_min',     max(break_minutes - duracao_bruta)
    ) from violacoes),
  -- Casos que a 053 NÃO recusa, contados para o relatório (não são violação):
  'limite_exato_intervalo_igual_a_duracao',
    (select count(*) from entradas where status <> 'absent' and duracao_bruta is not null and break_minutes = duracao_bruta),
  'ausencia_com_intervalo_maior', (select count(*) from entradas where status = 'absent' and duracao_bruta is not null and break_minutes > duracao_bruta),
  'incompleto_com_intervalo_positivo', (select count(*) from entradas where duracao_bruta is null and break_minutes > 0)
)) as "1. contagens";

-- 2. O trigger da 053 já existe neste banco? (antes da 053: nenhuma linha)
select t.tgname as trigger, p.proname as funcao, t.tgenabled as habilitado
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.timesheet_entries'::regclass
   and not t.tgisinternal
   and p.proname = 'recusar_intervalo_maior_que_jornada';

rollback;
