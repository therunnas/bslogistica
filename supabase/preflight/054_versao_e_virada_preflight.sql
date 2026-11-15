-- ---------------------------------------------------------------------------
-- PREFLIGHT DA MIGRATION 054 — versão dos apontamentos e confirmação de virada
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Vive em `supabase/preflight/`, que o CLI não aplica.
--
-- ESTRITAMENTE READ-ONLY: `begin transaction read only` (o PostgreSQL recusa qualquer escrita com
-- 25006) e `rollback` no fim. Sem INSERT, UPDATE, DELETE, ALTER, CREATE, DROP ou TRUNCATE. Devolve
-- só contagens agregadas: nenhum nome, valor financeiro, horário ou linha identificável.
--
-- Serve ANTES e DEPOIS da 054 (a coluna `versao` e a trilha são lidas sem quebrar quando ainda não
-- existem). GATE-FIN-05 (sessão 22): rodado SOMENTE no Supabase local. Em HML e em Production, só com
-- autorização própria por ambiente e pelo transporte de leitura autorizado naquele gate. Local:
--
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres -X \
--     < supabase/preflight/054_versao_e_virada_preflight.sql
--
-- O que ele informa e por quê:
--   - quantos apontamentos existem e quantos já têm versão (depois da 054 todos nascem em 1);
--   - quantas viradas (saída <= entrada) existem e onde: turno que vira o dia, turno diurno, sem
--     turno; quantas faturadas — a 058 vai exigir confirmação para as de turno diurno/sem turno, e
--     esta é a fila que alguém terá de decidir (confirmar, corrigir ou aceitar como histórico);
--   - quantas confirmações válidas e invalidadas existem na trilha;
--   - casos que exigem decisão comercial ainda aberta: jornada zero (intervalo = duração),
--     presença incompleta, turno com intervalo inválido;
--   - um histograma NEUTRO de duração bruta (insumo para o DEC-CP05-01; não é regra nem limite).
-- ---------------------------------------------------------------------------

begin transaction read only;

with base as (
  select te.status, te.invoice_id, t.shift_id,
         to_jsonb(te) ? 'versao' as tem_versao,
         (to_jsonb(te) ->> 'versao')::bigint as versao,
         te.check_in, te.check_out, te.break_minutes,
         s.start_time, s.end_time, s.crosses_midnight,
         extract(hour from te.check_in) * 60 + extract(minute from te.check_in) as ini,
         extract(hour from te.check_out) * 60 + extract(minute from te.check_out) as fim
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    left join public.shifts s on s.id = t.shift_id
),
classe as (
  select *,
         (status <> 'absent' and check_in is not null and check_out is not null and fim <= ini) as virada,
         (shift_id is not null and (coalesce(crosses_midnight, false)
           or extract(hour from end_time) * 60 + extract(minute from end_time)
              <= extract(hour from start_time) * 60 + extract(minute from start_time))) as turno_vira,
         case when check_in is null or check_out is null then null
              else fim - ini + case when fim <= ini then 1440 else 0 end end as bruta
    from base
)
select jsonb_pretty(jsonb_build_object(
  'medido_em', now(),
  'migration_054_aplicada', to_regprocedure('public.salvar_apontamento_admin_v2(uuid,uuid,date,jsonb)') is not null,
  'apontamentos', (select count(*) from classe),
  'versao', (select jsonb_build_object(
      'coluna_existe', bool_or(tem_versao),
      'versao_1', count(*) filter (where versao = 1),
      'versao_maior_que_1', count(*) filter (where versao > 1),
      'sem_versao', count(*) filter (where versao is null)) from classe),
  'viradas', (select jsonb_build_object(
      'total', count(*) filter (where virada),
      'em_turno_que_vira_o_dia', count(*) filter (where virada and turno_vira),
      'em_turno_diurno', count(*) filter (where virada and shift_id is not null and not turno_vira),
      'sem_turno', count(*) filter (where virada and shift_id is null),
      'faturadas', count(*) filter (where virada and invoice_id is not null),
      'exigiriam_confirmacao_na_058', count(*) filter (where virada and not coalesce(turno_vira, false))) from classe),
  'confirmacoes', case when to_regclass('public.apontamento_confirmacoes_virada') is null then null else jsonb_build_object(
      'validas', (xpath('/row/c/text()', query_to_xml(
        'select count(*) as c from public.apontamento_confirmacoes_virada where invalidada_em is null', false, true, '')))[1]::text::int,
      'invalidadas', (xpath('/row/c/text()', query_to_xml(
        'select count(*) as c from public.apontamento_confirmacoes_virada where invalidada_em is not null', false, true, '')))[1]::text::int)
    end,
  'decisao_futura', (select jsonb_build_object(
      'jornada_zero_intervalo_igual_duracao', count(*) filter (where status <> 'absent' and bruta is not null and break_minutes = bruta),
      'presenca_sem_saida', count(*) filter (where status <> 'absent' and check_in is not null and check_out is null),
      'presenca_sem_horario', count(*) filter (where status <> 'absent' and check_in is null and check_out is null)) from classe),
  'turnos_com_intervalo_maior_ou_igual_a_duracao', (select count(*) from public.shifts s
     where s.break_minutes >= (extract(hour from s.end_time) * 60 + extract(minute from s.end_time))
           - (extract(hour from s.start_time) * 60 + extract(minute from s.start_time))
           + case when coalesce(s.crosses_midnight, false)
                   or extract(hour from s.end_time) * 60 + extract(minute from s.end_time)
                      <= extract(hour from s.start_time) * 60 + extract(minute from s.start_time) then 1440 else 0 end),
  'histograma_duracao_bruta_neutro', (select jsonb_build_object(
      'ate_8h', count(*) filter (where bruta <= 480),
      'de_8h_a_10h', count(*) filter (where bruta > 480 and bruta <= 600),
      'de_10h_a_12h', count(*) filter (where bruta > 600 and bruta <= 720),
      'de_12h_a_16h', count(*) filter (where bruta > 720 and bruta <= 960),
      'de_16h_a_20h', count(*) filter (where bruta > 960 and bruta <= 1200),
      'acima_de_20h', count(*) filter (where bruta > 1200)) from classe where status <> 'absent')
)) as "054 preflight";

rollback;
