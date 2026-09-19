-- ---------------------------------------------------------------------------
-- PREFLIGHT DA MIGRATION 014 — break_minutes
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Ele vive em `supabase/preflight/`, que o
-- CLI não aplica: `db push` só olha `supabase/migrations/`. Rodá-lo não altera
-- nada.
--
-- É ESTRITAMENTE READ-ONLY, e de duas formas: a transação abre com
-- `READ ONLY`, que faz o PostgreSQL recusar qualquer escrita com 25006, e
-- termina em `rollback`. Não há INSERT, UPDATE, DELETE, ALTER, CREATE, DROP
-- nem TRUNCATE em lugar nenhum.
--
-- COMO RODAR (do diretório do projeto, com a sessão já autenticada):
--
--   env -u SUPABASE_ACCESS_TOKEN npx supabase db query \
--     -f supabase/preflight/014_break_minutes_preflight.sql --linked
--
-- O `-f` importa: `db query` com SQL inline executa só a primeira linha.
--
-- POR QUE ELE EXISTE. A migration 014 vai fechar no banco a invariante de
-- sinal de `break_minutes`. Um `CHECK` sobre tabela que já tenha linha
-- violando FALHA na aplicação — e linha faturada é imutável desde a 011, então
-- não dá para corrigir o histórico por UPDATE. O desenho da 014 depende de
-- saber, antes, se existe dado incompatível.
--
-- O que ele NÃO faz: não decide a constraint, não expõe dado pessoal e não
-- devolve nenhuma linha identificável — só contagens e extremos.
-- ---------------------------------------------------------------------------

begin transaction read only;

-- ---------------------------------------------------------------------------
-- 1. Os números. Uma linha só, em JSON, para caber em qualquer transporte.
--
-- `duracao_bruta` segue a MESMA semântica da migration 010, e não uma
-- aproximação: para o apontamento, `check_out <= check_in` soma 1440; para o
-- turno, soma 1440 quando `crosses_midnight` ou `end_time <= start_time`.
-- ---------------------------------------------------------------------------

with entradas as (
  select
    te.break_minutes,
    te.invoice_id,
    t.status as folha_status,
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
    end as duracao_bruta
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
),
turnos as (
  select
    s.break_minutes,
    (
      (extract(hour from s.end_time) * 60 + extract(minute from s.end_time))
      + case
          when coalesce(s.crosses_midnight, false)
            or (extract(hour from s.end_time) * 60 + extract(minute from s.end_time))
             <= (extract(hour from s.start_time) * 60 + extract(minute from s.start_time))
          then 1440 else 0
        end
    ) - (extract(hour from s.start_time) * 60 + extract(minute from s.start_time))
      as duracao_bruta
  from public.shifts s
)
select jsonb_pretty(jsonb_build_object(
  'medido_em', now(),

  'A_timesheet_entries', (
    select jsonb_build_object(
      'total',                         count(*),
      'negativos',                     count(*) filter (where break_minutes < 0),
      'minimo',                        min(break_minutes),
      'maximo',                        max(break_minutes),
      'acima_de_1440',                 count(*) filter (where break_minutes > 1440),
      'negativos_faturados',           count(*) filter (where break_minutes < 0 and invoice_id is not null),
      'negativos_em_folha_aberta',     count(*) filter (where break_minutes < 0 and folha_status = 'open'),
      'negativos_em_folha_fechada',    count(*) filter (where break_minutes < 0 and folha_status = 'closed'),
      'com_horario_completo',          count(*) filter (where duracao_bruta is not null),
      'break_maior_que_duracao',       count(*) filter (where duracao_bruta is not null and break_minutes > duracao_bruta),
      'break_maior_que_duracao_faturado',
        count(*) filter (where duracao_bruta is not null and break_minutes > duracao_bruta and invoice_id is not null)
    ) from entradas
  ),

  'B_shifts', (
    select jsonb_build_object(
      'total',                    count(*),
      'negativos',                count(*) filter (where break_minutes < 0),
      'minimo',                   min(break_minutes),
      'maximo',                   max(break_minutes),
      'acima_de_1440',            count(*) filter (where break_minutes > 1440),
      'break_maior_que_duracao',  count(*) filter (where break_minutes > duracao_bruta),
      'duracao_bruta_minima',     min(duracao_bruta),
      'duracao_bruta_maxima',     max(duracao_bruta)
    ) from turnos
  )
)) as "1. contagens";

-- ---------------------------------------------------------------------------
-- 2. Estrutura: constraints hoje existentes nas duas tabelas.
--    Esperado, pelo que o repositório mostra: NENHUMA do tipo CHECK.
-- ---------------------------------------------------------------------------

select conrelid::regclass::text as tabela,
       conname,
       case contype when 'c' then 'CHECK' when 'p' then 'PK' when 'f' then 'FK'
                    when 'u' then 'UNIQUE' else contype::text end as tipo,
       pg_get_constraintdef(oid) as definicao
  from pg_constraint
 where conrelid in ('public.timesheet_entries'::regclass, 'public.shifts'::regclass)
 order by 1, 3, 2;

-- ---------------------------------------------------------------------------
-- 3. Colunas: tipo, nulabilidade e default.
-- ---------------------------------------------------------------------------

select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and column_name  = 'break_minutes'
 order by table_name;

-- ---------------------------------------------------------------------------
-- 4. Triggers que disparam quando `break_minutes` muda.
--
--    `tgattr` vazio significa "qualquer coluna": o trigger dispara também
--    quando só `break_minutes` mudou. Quando há colunas nomeadas, elas são
--    listadas em `colunas_do_of`.
-- ---------------------------------------------------------------------------

select c.relname as tabela,
       t.tgname  as trigger,
       p.proname as funcao,
       case when t.tgattr::int2[] = '{}'::int2[] then 'qualquer coluna'
            else (select string_agg(a.attname, ', ')
                    from unnest(t.tgattr::int2[]) as col(num)
                    join pg_attribute a on a.attrelid = c.oid and a.attnum = col.num)
       end as colunas_do_of,
       t.tgenabled as habilitado
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc  p on p.oid = t.tgfoid
 where not t.tgisinternal
   and c.relname in ('timesheet_entries', 'shifts')
   and c.relnamespace = 'public'::regnamespace
 order by 1, 2;

-- ---------------------------------------------------------------------------
-- 5. As duas funções que tocam `break_minutes`, conferidas por conteúdo.
--
--    Não devolve o corpo inteiro: devolve tamanho, md5 e a resposta às duas
--    perguntas que importam — a derivação subtrai o valor? a RPC confere o
--    sinal? É o que diz se Production bate com o repositório.
-- ---------------------------------------------------------------------------

select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_userbyid(p.proowner)               as dono,
       p.prosecdef                               as security_definer,
       length(p.prosrc)                          as tamanho_do_corpo,
       md5(p.prosrc)                             as md5_do_corpo,
       (p.prosrc like '%GREATEST(0, _fim - _inicio - COALESCE(NEW.break_minutes, 0))%')
         as derivacao_subtrai_break,
       (p.prosrc ~* 'break_minutes[^;]*<\s*0' or p.prosrc ~* 'break_minutes[^;]*>=\s*0')
         as tem_verificacao_de_sinal
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('derivar_valores_financeiros', 'salvar_apontamento_operacional')
 order by 1;

rollback;
