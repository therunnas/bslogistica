-- Condições financeiras versionadas — EXPANSÃO do esquema (C05-B, etapa 1 de 3).
--
-- REGRA EMPRESARIAL (definida pelo responsável)
--
--   Cada apontamento usa as condições financeiras vigentes na DATA TRABALHADA, mesmo
--   que seja lançado, editado ou faturado depois. Preço novo não altera dia anterior,
--   receita e custo seguem a mesma política temporal, e apontamento faturado continua
--   imutável.
--
-- POR QUE ESTA MIGRATION É SÓ ESTRUTURA
--
--   Hoje `derivar_valores_financeiros()` (migration 010) lê o contrato, o custo do
--   colaborador e o turno ATUAIS a cada recálculo, e `contracts.valid_from/valid_to`
--   não entram em conta nenhuma. Medido na C05.1: reajustar o contrato e depois
--   corrigir o horário de um dia antigo mudou o valor do dia em R$ 87,50. Corrigir isso
--   exige três passos. Esta migration é o PRIMEIRO e não muda nenhum comportamento:
--
--     022  (esta)  tabelas de versões, colunas anuláveis no apontamento, RLS e privilégios
--     023          RPCs administrativas de nova vigência e a função de migração por prova
--     024          trigger de derivação versionado (a troca de comportamento)
--
--   Depois de aplicada, derivação, faturamento, prévia e telas se comportam exatamente
--   como antes: a suíte de paridade com o trigger real (23.862 casos) e as suítes SQL
--   existentes rodam iguais com e sem esta migration.
--
-- O QUE ENTRA
--
--   public.contract_terms        versões de preço e jornada de um contrato
--   public.employee_cost_terms   versões do custo diário de um colaborador
--   timesheet_entries            7 colunas ANULÁVEIS: referência à versão aplicada, cópia dos
--                                parâmetros usados e a origem das condições. NULL significa
--                                "legado": o valor gravado vale como está.
--
-- VIGÊNCIA
--
--   Intervalo `[valid_from, valid_to)` em `date` (fim exclusivo; `valid_to` NULL = aberta).
--   `work_date` é `date` sem fuso, então a comparação é data com data, sem conversão. O
--   "hoje" de negócio das RPCs seguintes é `(now() at time zone 'America/Sao_Paulo')::date`,
--   nunca `current_date`, que usaria o fuso da sessão (UTC).
--
--   NÃO SOBREPOSIÇÃO: `EXCLUDE USING gist (contract_id WITH =, daterange(...) WITH &&)
--   WHERE (active)`. É a garantia final sob concorrência: se duas transações tentam gravar
--   vigências que se tocam, a segunda ESPERA a primeira e depois falha com 23P01. Vigências
--   adjacentes ([jan, fev) e [fev, mar)) são válidas. Versão aposentada (`active = false`)
--   sai da conta e fica como referência imutável de quem a usou. Exige a extensão
--   `btree_gist` (confiável; `postgres` tem CREATE no banco; verificado na homologação).
--
-- O QUE NÃO ENTRA, DE PROPÓSITO
--
--   - Nenhuma linha em nenhuma tabela: nada de vigência presumida ou retroativa. A
--     migração por prova e as vigências informadas vêm na 023, por ação explícita.
--   - Nenhuma alteração em triggers financeiros, em `gerar_fatura`, em `contracts`,
--     `employees`, `operations`, `shifts` ou nos valores gravados.
--   - Política de operação sem contrato (`agreed_amount`) e congelamento de turno usado:
--     ficam para a 024, junto da troca do trigger. A coluna `terms_origin` já prevê o
--     valor 'valor_acordado'.
--
-- ESCRITA
--
--   Nenhuma interface escreve nas tabelas novas: há UMA policy de leitura (admin em AAL2) e
--   nenhuma de escrita; os privilégios de `anon`, `authenticated`, `service_role` e do papel
--   operacional são revogados e só `authenticated` recebe SELECT. As RPCs da 023 passam a
--   ser a única porta de escrita. As 7 colunas novas do apontamento também não podem ser
--   escritas por quem chega pela API: o trigger `trg_timesheet_entries_bloqueia_condicoes`
--   recusa (42501) qualquer valor não nulo vindo de `authenticated`. O nome o faz disparar
--   ANTES de `trg_timesheet_entries_bloqueio_financeiro` e de `..._calculo_financeiro`, para
--   que a derivação da 024 possa preencher as colunas sem ser barrada por ele.
--
-- COMPATIBILIDADE COM A APLICAÇÃO ATUAL
--
--   `select *` em `timesheet_entries` passa a trazer 7 campos nulos a mais; nenhum código os
--   lê. Nenhum payload atual os envia. `bloquear_edicao_financeira` e `bloquear_edicao_faturada`
--   seguem iguais (a segunda compara a linha inteira em JSON e continua recusando qualquer
--   mudança em apontamento faturado).
--
-- LOCKS: `ADD COLUMN` anulável sem DEFAULT não reescreve a tabela. As chaves estrangeiras e
-- os índices parciais novos são criados sobre colunas todas NULL. `CREATE TABLE` e a
-- extensão não bloqueiam tabela existente. A chave estrangeira pede SHARE ROW EXCLUSIVE em
-- `timesheet_entries` até o COMMIT; nenhuma linha existente é reescrita (a conferência da chave
-- estrangeira percorre colunas todas NULL).
--
-- REVERSÃO (nenhum dado de negócio é afetado; as tabelas novas estão vazias):
--
--   drop trigger trg_timesheet_entries_bloqueia_condicoes on public.timesheet_entries;
--   drop function public.bloquear_colunas_de_condicoes();
--   alter table public.timesheet_entries
--     drop column terms_origin, drop column planned_minutes_snapshot,
--     drop column ot_tolerance_snapshot, drop column ot_factor_snapshot,
--     drop column shift_hours_snapshot, drop column employee_cost_terms_id,
--     drop column contract_terms_id;
--   drop table public.employee_cost_terms;
--   drop table public.contract_terms;
--   -- drop extension btree_gist;  (criada por esta migration; só se nenhuma outra coisa a usar)

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Versões das condições do contrato
-- ---------------------------------------------------------------------------

create table public.contract_terms (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.contracts (id) on delete cascade,
  valid_from       date not null,
  valid_to         date,
  daily_rate       numeric(12,2) not null,
  shift_hours      numeric(5,2) not null,
  ot_factor        numeric(5,2) not null,
  ot_tolerance_min integer not null,
  active           boolean not null default true,
  origin           text not null,
  reason           text not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  retired_at       timestamptz,
  replaced_by      uuid references public.contract_terms (id),
  constraint contract_terms_periodo_valido
    check (valid_to is null or valid_to > valid_from),
  constraint contract_terms_diaria_nao_negativa check (daily_rate >= 0),
  constraint contract_terms_jornada_positiva check (shift_hours > 0),
  constraint contract_terms_fator_nao_negativo check (ot_factor >= 0),
  constraint contract_terms_tolerancia_nao_negativa check (ot_tolerance_min >= 0),
  constraint contract_terms_origem_valida
    check (origin in ('informada', 'migrada_por_prova', 'correcao')),
  constraint contract_terms_motivo_obrigatorio check (btrim(reason) <> ''),
  constraint contract_terms_aposentadoria_coerente
    check ((active and retired_at is null and replaced_by is null)
        or (not active and retired_at is not null)),
  constraint contract_terms_sem_sobreposicao
    exclude using gist (
      contract_id with =,
      daterange(valid_from, valid_to, '[)') with &&
    ) where (active)
);

create index contract_terms_busca_idx
  on public.contract_terms (contract_id, valid_from desc) where active;
create index contract_terms_substituida_por_idx
  on public.contract_terms (replaced_by) where replaced_by is not null;

-- ---------------------------------------------------------------------------
-- Versões do custo diário do colaborador
-- ---------------------------------------------------------------------------

create table public.employee_cost_terms (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  valid_from   date not null,
  valid_to     date,
  daily_cost   numeric(12,2) not null,
  active       boolean not null default true,
  origin       text not null,
  reason       text not null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  retired_at   timestamptz,
  replaced_by  uuid references public.employee_cost_terms (id),
  constraint employee_cost_terms_periodo_valido
    check (valid_to is null or valid_to > valid_from),
  constraint employee_cost_terms_custo_nao_negativo check (daily_cost >= 0),
  constraint employee_cost_terms_origem_valida
    check (origin in ('informada', 'migrada_por_prova', 'correcao')),
  constraint employee_cost_terms_motivo_obrigatorio check (btrim(reason) <> ''),
  constraint employee_cost_terms_aposentadoria_coerente
    check ((active and retired_at is null and replaced_by is null)
        or (not active and retired_at is not null)),
  constraint employee_cost_terms_sem_sobreposicao
    exclude using gist (
      employee_id with =,
      daterange(valid_from, valid_to, '[)') with &&
    ) where (active)
);

create index employee_cost_terms_busca_idx
  on public.employee_cost_terms (employee_id, valid_from desc) where active;
create index employee_cost_terms_substituida_por_idx
  on public.employee_cost_terms (replaced_by) where replaced_by is not null;

-- ---------------------------------------------------------------------------
-- Colunas anuláveis no apontamento. NULL = legado: o valor gravado vale como está.
-- ON DELETE NO ACTION (padrão): a conferência acontece no fim do comando, então apagar um
-- colaborador ou cliente, que leva os apontamentos junto em cascata, continua funcionando.
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries
  add column contract_terms_id      uuid references public.contract_terms (id),
  add column employee_cost_terms_id uuid references public.employee_cost_terms (id),
  add column shift_hours_snapshot   numeric(5,2),
  add column ot_factor_snapshot     numeric(5,2),
  add column ot_tolerance_snapshot  integer,
  add column planned_minutes_snapshot numeric(8,2),
  add column terms_origin           text;

alter table public.timesheet_entries
  add constraint timesheet_entries_terms_origin_valida
    check (terms_origin is null or terms_origin in ('versao', 'valor_acordado', 'legado')),
  add constraint timesheet_entries_shift_hours_snapshot_positiva
    check (shift_hours_snapshot is null or shift_hours_snapshot > 0),
  add constraint timesheet_entries_ot_factor_snapshot_nao_negativo
    check (ot_factor_snapshot is null or ot_factor_snapshot >= 0),
  add constraint timesheet_entries_ot_tolerance_snapshot_nao_negativa
    check (ot_tolerance_snapshot is null or ot_tolerance_snapshot >= 0),
  add constraint timesheet_entries_planned_minutes_snapshot_nao_negativo
    check (planned_minutes_snapshot is null or planned_minutes_snapshot >= 0);

create index idx_timesheet_entries_contract_terms
  on public.timesheet_entries (contract_terms_id) where contract_terms_id is not null;
create index idx_timesheet_entries_employee_cost_terms
  on public.timesheet_entries (employee_cost_terms_id) where employee_cost_terms_id is not null;

-- ---------------------------------------------------------------------------
-- RLS e privilégios mínimos. Uma policy de leitura; nenhuma de escrita.
-- ---------------------------------------------------------------------------

alter table public.contract_terms enable row level security;
alter table public.employee_cost_terms enable row level security;

create policy contract_terms_leitura_admin on public.contract_terms
  for select to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

create policy contract_terms_exige_admin_aal2 on public.contract_terms
  as restrictive for all to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)))
  with check (((select auth.jwt() ->> 'aal') = 'aal2')
              and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

create policy employee_cost_terms_leitura_admin on public.employee_cost_terms
  for select to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

create policy employee_cost_terms_exige_admin_aal2 on public.employee_cost_terms
  as restrictive for all to authenticated
  using (((select auth.jwt() ->> 'aal') = 'aal2')
         and (select public.has_role(auth.uid(), 'admin'::public.app_role)))
  with check (((select auth.jwt() ->> 'aal') = 'aal2')
              and (select public.has_role(auth.uid(), 'admin'::public.app_role)));

-- O default ACL de tabela nova em `public` varia entre ambientes (já visto na 018): o
-- contrato de privilégio fica explícito aqui.
revoke all on table public.contract_terms from public, anon, authenticated, service_role, bslog_rpc_operacional;
revoke all on table public.employee_cost_terms from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.contract_terms to authenticated;
grant select on table public.employee_cost_terms to authenticated;

-- ---------------------------------------------------------------------------
-- As colunas novas do apontamento só o sistema preenche (a derivação da 024).
-- ---------------------------------------------------------------------------

create or replace function public.bloquear_colunas_de_condicoes()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  _mexeu boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    _mexeu := new.contract_terms_id is not null
           or new.employee_cost_terms_id is not null
           or new.shift_hours_snapshot is not null
           or new.ot_factor_snapshot is not null
           or new.ot_tolerance_snapshot is not null
           or new.planned_minutes_snapshot is not null
           or new.terms_origin is not null;
  else
    _mexeu := new.contract_terms_id is distinct from old.contract_terms_id
           or new.employee_cost_terms_id is distinct from old.employee_cost_terms_id
           or new.shift_hours_snapshot is distinct from old.shift_hours_snapshot
           or new.ot_factor_snapshot is distinct from old.ot_factor_snapshot
           or new.ot_tolerance_snapshot is distinct from old.ot_tolerance_snapshot
           or new.planned_minutes_snapshot is distinct from old.planned_minutes_snapshot
           or new.terms_origin is distinct from old.terms_origin;
  end if;

  if _mexeu then
    raise exception
      'As condições financeiras do apontamento são registradas pelo sistema e não podem ser gravadas diretamente.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.bloquear_colunas_de_condicoes() from public, anon, authenticated, service_role;

create trigger trg_timesheet_entries_bloqueia_condicoes
  before insert or update on public.timesheet_entries
  for each row execute function public.bloquear_colunas_de_condicoes();

comment on table public.contract_terms is
  'Versões de preço e jornada de um contrato, com vigência [valid_from, valid_to) em date. Imutáveis; correção cria nova versão. Sem escrita pela API (RPCs da 023).';
comment on table public.employee_cost_terms is
  'Versões do custo diário de um colaborador, com vigência [valid_from, valid_to) em date. Imutáveis; correção cria nova versão. Sem escrita pela API (RPCs da 023).';
comment on column public.timesheet_entries.contract_terms_id is
  'Versão de contrato aplicada ao apontamento. NULL = legado (valor gravado vale como está).';
comment on column public.timesheet_entries.terms_origin is
  'versao | valor_acordado | legado. NULL = legado anterior à C05-B.';

-- ---------------------------------------------------------------------------
-- Autoverificação (estrutura; não depende de dados)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _n int;
begin
  if not exists (select 1 from pg_extension where extname = 'btree_gist') then
    raise exception '022: extensão btree_gist ausente';
  end if;

  select count(*) into _n from pg_constraint
   where conname in ('contract_terms_sem_sobreposicao', 'employee_cost_terms_sem_sobreposicao') and contype = 'x';
  if _n <> 2 then
    raise exception '022: as duas exclusões de sobreposição deveriam existir (achei %)', _n;
  end if;

  select count(*) into _n from pg_class
   where oid in ('public.contract_terms'::regclass, 'public.employee_cost_terms'::regclass) and relrowsecurity;
  if _n <> 2 then
    raise exception '022: RLS deveria estar ativa nas duas tabelas novas';
  end if;

  select count(*) into _n from pg_policies
   where schemaname = 'public' and tablename in ('contract_terms', 'employee_cost_terms') and cmd in ('INSERT', 'UPDATE', 'DELETE');
  if _n <> 0 then
    raise exception '022: não deveria haver policy de escrita nas tabelas novas';
  end if;

  select count(*) into _n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('contract_terms', 'employee_cost_terms')
     and ((grantee in ('anon', 'service_role', 'bslog_rpc_operacional', 'PUBLIC'))
       or (grantee = 'authenticated' and privilege_type <> 'SELECT'));
  if _n <> 0 then
    raise exception '022: privilégios acima do mínimo nas tabelas novas (%)', _n;
  end if;

  select count(*) into _n from pg_attribute
   where attrelid = 'public.timesheet_entries'::regclass
     and attname in ('contract_terms_id', 'employee_cost_terms_id', 'shift_hours_snapshot', 'ot_factor_snapshot',
                     'ot_tolerance_snapshot', 'planned_minutes_snapshot', 'terms_origin')
     and not attnotnull and attidentity = '' and atthasdef = false;
  if _n <> 7 then
    raise exception '022: as 7 colunas novas deveriam ser anuláveis e sem DEFAULT (achei %)', _n;
  end if;

  if exists (
    select 1 from public.timesheet_entries
     where contract_terms_id is not null or employee_cost_terms_id is not null or terms_origin is not null
        or shift_hours_snapshot is not null or ot_factor_snapshot is not null
        or ot_tolerance_snapshot is not null or planned_minutes_snapshot is not null
  ) then
    raise exception '022: nenhum apontamento existente deveria ter condições preenchidas';
  end if;

  if (select count(*) from public.contract_terms) + (select count(*) from public.employee_cost_terms) <> 0 then
    raise exception '022: as tabelas de versões deveriam nascer vazias';
  end if;

  select count(*) into _n from pg_trigger
   where tgrelid = 'public.timesheet_entries'::regclass and tgname = 'trg_timesheet_entries_bloqueia_condicoes' and tgenabled = 'O';
  if _n <> 1 then
    raise exception '022: trigger de proteção das colunas novas ausente';
  end if;
end;
$verificacao$;
