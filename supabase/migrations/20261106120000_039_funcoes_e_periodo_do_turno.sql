-- Catálogo de funções e período do turno (FIN-PR-06). SOMENTE LOCAL até autorização.
--
-- Depende da 038. A 035 a 039 são aplicadas juntas, numa etapa controlada, com autorização própria.
--
-- É ESTRUTURA CADASTRAL. Nenhum cálculo financeiro muda: nem diária, hora extra, custo, tarifa,
-- snapshot, fatura, Fechamento, competência (038) ou adicional. Preço por contrato + função +
-- período do turno + vigência pertence ao FIN-PR-07.
--
-- O QUE MUDA
--   1. `job_functions`: catálogo institucional (id, código estável e único, nome, ativa/inativa,
--      metadados de auditoria). Quatro funções iniciais. Nome único ignorando maiúsculas, acento,
--      espaço e pontuação. Nunca é apagada nem trocada de código; inativar a tira das novas escolhas
--      e preserva as referências. Sem preço nem percentual.
--   2. `employees.job_function_id`: função PADRÃO do colaborador (opcional). `employees.role` (texto)
--      é preservado. Texto que, normalizado, é IGUAL ao nome de uma função oficial é vinculado aqui;
--      qualquer outro (ajudante, "aux. produção", plural, vazio) fica sem vínculo para revisão.
--   3. `operation_team.job_function_id`: função na ALOCAÇÃO (opcional; pode diferir da padrão).
--      Alocações existentes ficam como estão (nulas).
--   4. `shifts.shift_period` ('diurno' | 'noturno', nulo = não classificado) e quem/quando
--      classificou. Nenhum turno existente é classificado, nem por horário nem por cruzar a meia-noite.
--   5. RPCs administrativas do catálogo (criar, renomear, ativar/inativar, vincular correspondências
--      exatas) e `estado_motor_vigencia`
--      anuncia `funcoes_turno` (detecção de capacidade do app).
--
-- O QUE NÃO MUDA
--   Corpos de derivar_valores_por_vigencia, gerar_fatura, resumo_financeiro_periodo,
--   ajustes_de_arredondamento_acumulado e demais funções financeiras; RLS e grants das tabelas
--   existentes (colunas novas não são concedidas ao papel operacional); a proteção que congela a
--   jornada de turno usado; faturas, itens, lançamentos, custos.
--
-- REVERSÃO: docs/runbooks/rollback-funcoes-turno.sql (recusa se houver função escolhida pelo
-- administrador, função de alocação, turno classificado ou catálogo alterado).

begin;

-- ---------------------------------------------------------------------------
-- 1. Chave de comparação (maiúsculas, acento, espaço e pontuação não distinguem)
-- ---------------------------------------------------------------------------

create function public.normalizar_texto_chave(p_texto text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
           lower(translate(coalesce(p_texto, ''),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '[^a-z0-9]+', '', 'g');
$$;

revoke all on function public.normalizar_texto_chave(text) from public, anon, authenticated, service_role;

comment on function public.normalizar_texto_chave(text) is
  'FIN-PR-06: chave de comparacao de nomes (sem maiusculas, acentos, espacos e pontuacao). Espelho de normalizarTextoChave em funcoes.ts.';

-- ---------------------------------------------------------------------------
-- 2. Catálogo de funções
-- ---------------------------------------------------------------------------

create table public.job_functions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  name       text not null,
  name_key   text generated always as (public.normalizar_texto_chave(name)) stored,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint job_functions_codigo_valido check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint job_functions_nome_valido check (btrim(name) <> '' and char_length(name) <= 80),
  constraint job_functions_nome_com_chave check (name_key <> ''),
  constraint job_functions_codigo_unico unique (code),
  constraint job_functions_nome_unico unique (name_key)
);

comment on table public.job_functions is
  'FIN-PR-06: catalogo institucional de funcoes. Escrita so por criar_funcao/renomear_funcao/alterar_situacao_funcao (admin). Nao se apaga: inativa-se. Sem preco nem percentual (tarifas: FIN-PR-07).';

create function public.proteger_funcao()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Função não é apagada: inative-a.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.code is distinct from old.code
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'Identificador, código e criação de uma função não mudam.' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_job_functions_protegida
  before update or delete on public.job_functions
  for each row execute function public.proteger_funcao();
create trigger trg_job_functions_sem_truncate
  before truncate on public.job_functions
  for each statement execute function public.proteger_funcao();

alter table public.job_functions enable row level security;

create policy job_functions_leitura_admin on public.job_functions
  for select to authenticated
  using ((select public.has_role(auth.uid(), 'admin'::public.app_role)));

create policy job_functions_exige_mfa on public.job_functions
  as restrictive for all to authenticated
  using ((select public.mfa_cotidiano_ok()))
  with check ((select public.mfa_cotidiano_ok()));

revoke all on table public.job_functions from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant select on table public.job_functions to authenticated;

-- Catálogo inicial (aprovado). Ajudante, limpeza, batedor, pátio e etiquetagem entram em "Auxiliar
-- de produção" sem função própria.
insert into public.job_functions (code, name) values
  ('auxiliar_producao', 'Auxiliar de produção'),
  ('conferente', 'Conferente'),
  ('operador', 'Operador'),
  ('administrativo', 'Administrativo');

-- ---------------------------------------------------------------------------
-- 3. Guard e RPCs do catálogo
-- ---------------------------------------------------------------------------

create function public.funcoes_exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  if not public.mfa_cotidiano_ok() then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  if not coalesce(public.identidade_atual_utilizavel(), false) then
    raise exception 'Conta ou sessão sem validade.' using errcode = '42501';
  end if;
  if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'Apenas administradores podem gerir o catálogo de funções.' using errcode = '42501';
  end if;
end;
$$;

create function public.criar_funcao(p_name text, p_code text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_nome   text := btrim(coalesce(p_name, ''));
  v_codigo text;
  v_id     uuid;
begin
  perform public.funcoes_exigir_admin();
  if v_nome = '' then
    raise exception 'O nome da função é obrigatório.' using errcode = '22023';
  end if;
  if char_length(v_nome) > 80 then
    raise exception 'O nome da função deve ter no máximo 80 caracteres.' using errcode = '22023';
  end if;
  if public.normalizar_texto_chave(v_nome) = '' then
    raise exception 'O nome da função deve ter letras ou números.' using errcode = '22023';
  end if;

  -- Código estável: o informado ou o derivado do nome (sem acento, minúsculo, com sublinhado).
  v_codigo := coalesce(nullif(btrim(p_code), ''),
    regexp_replace(
      lower(translate(v_nome,
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9]+', '_', 'g'));
  v_codigo := btrim(left(v_codigo, 40), '_');
  if v_codigo !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Código inválido: use letras minúsculas, números e sublinhado, começando por letra.'
      using errcode = '22023';
  end if;

  begin
    insert into public.job_functions (code, name) values (v_codigo, v_nome) returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe uma função com este nome ou código.' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create function public.renomear_funcao(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_nome text := btrim(coalesce(p_name, ''));
begin
  perform public.funcoes_exigir_admin();
  if p_id is null or v_nome = '' or char_length(v_nome) > 80
     or public.normalizar_texto_chave(v_nome) = '' then
    raise exception 'Informe a função e um nome de até 80 caracteres.' using errcode = '22023';
  end if;
  begin
    update public.job_functions set name = v_nome where id = p_id;
  exception when unique_violation then
    raise exception 'Já existe uma função com este nome.' using errcode = '23505';
  end;
  if not found then
    raise exception 'Função não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.alterar_situacao_funcao(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.funcoes_exigir_admin();
  if p_id is null or p_active is null then
    raise exception 'Informe a função e a situação.' using errcode = '22023';
  end if;
  update public.job_functions set active = p_active where id = p_id;
  if not found then
    raise exception 'Função não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Função do colaborador e da alocação
-- ---------------------------------------------------------------------------

alter table public.employees
  add column job_function_id uuid references public.job_functions (id) on delete restrict;
alter table public.operation_team
  add column job_function_id uuid references public.job_functions (id) on delete restrict;

create index employees_job_function_idx on public.employees (job_function_id) where job_function_id is not null;
create index operation_team_job_function_idx on public.operation_team (job_function_id) where job_function_id is not null;

comment on column public.employees.job_function_id is
  'FIN-PR-06: funcao PADRAO do colaborador (opcional). employees.role (texto) e preservado e nao e fonte de calculo.';
comment on column public.operation_team.job_function_id is
  'FIN-PR-06: funcao na ALOCACAO (opcional; pode diferir da padrao do colaborador). Informativa: nao recalcula apontamentos. A funcao trabalhada em cada dia exigira snapshot proprio antes de qualquer preco (FIN-PR-07).';

-- Só funções ATIVAS entram numa escolha nova; referências existentes a função depois inativada
-- permanecem. Função inexistente fica para a chave estrangeira (23503).
create function public.validar_funcao_ativa()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.job_function_id is not null
     and (tg_op = 'INSERT' or new.job_function_id is distinct from old.job_function_id)
     and exists (select 1 from public.job_functions f where f.id = new.job_function_id and not f.active) then
    raise exception 'A função escolhida está inativa.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_employees_funcao_ativa
  before insert or update of job_function_id on public.employees
  for each row execute function public.validar_funcao_ativa();
create trigger trg_operation_team_funcao_ativa
  before insert or update of job_function_id on public.operation_team
  for each row execute function public.validar_funcao_ativa();

-- Vínculo por correspondência EXATA (após normalizar maiúsculas, acento, espaço e pontuação). O texto
-- original de `role` não é tocado; o que não casa fica sem vínculo, para revisão do administrador.
-- Só liga colaborador SEM função e só a função ATIVA; nunca troca um vínculo já existente.
create function public.mapear_funcoes_por_texto_interno()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _mapeados integer;
begin
  update public.employees e
     set job_function_id = f.id
    from public.job_functions f
   where e.job_function_id is null
     and e.role is not null
     and f.active
     and public.normalizar_texto_chave(e.role) = f.name_key;
  get diagnostics _mapeados = row_count;
  return _mapeados;
end;
$$;

-- Mesma regra, a pedido do administrador (colaborador cadastrado depois, só com o texto).
create function public.vincular_funcoes_exatas()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.funcoes_exigir_admin();
  return public.mapear_funcoes_por_texto_interno();
end;
$$;

do $mapeamento$
declare
  _mapeados integer := public.mapear_funcoes_por_texto_interno();
  _pendentes integer;
  _textos integer;
begin
  select count(*), count(distinct public.normalizar_texto_chave(role)) into _pendentes, _textos
    from public.employees
   where job_function_id is null and public.normalizar_texto_chave(role) <> '';
  raise notice '039: % colaborador(es) vinculado(s) por correspondência exata; % sem vínculo (% texto(s) distinto(s)) aguardam revisão.',
    _mapeados, _pendentes, _textos;
end;
$mapeamento$;

-- ---------------------------------------------------------------------------
-- 5. Período do turno
-- ---------------------------------------------------------------------------

alter table public.shifts
  add column shift_period        text,
  add column shift_period_set_by uuid,
  add column shift_period_set_at timestamptz,
  add constraint shifts_periodo_valido check (shift_period is null or shift_period in ('diurno', 'noturno'));

comment on column public.shifts.shift_period is
  'FIN-PR-06: classificacao explicita diurno/noturno (nulo = nao classificado). E dado de cadastro: nao e inferida do horario nem de cruzar a meia-noite, e e confirmada pelo administrador. Nao muda jornada nem calculo.';

create function public.registrar_classificacao_do_turno()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' or new.shift_period is distinct from old.shift_period then
    new.shift_period_set_by := case when new.shift_period is null then null else auth.uid() end;
    new.shift_period_set_at := case when new.shift_period is null then null else now() end;
  else
    new.shift_period_set_by := old.shift_period_set_by;
    new.shift_period_set_at := old.shift_period_set_at;
  end if;
  return new;
end;
$$;

create trigger trg_shifts_classificacao
  before insert or update on public.shifts
  for each row execute function public.registrar_classificacao_do_turno();

-- ---------------------------------------------------------------------------
-- 6. Estado do motor: anuncia a capacidade (corpo vigente: 038)
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
    'periodo_contratual', true,
    -- FIN-PR-06 (039): catálogo de funções, função do colaborador e da alocação, período do turno.
    'funcoes_turno', true);
end;
$function$;


-- ---------------------------------------------------------------------------
-- 7. Dono e privilégios
-- ---------------------------------------------------------------------------

do $privilegios$
declare
  _f record;
begin
  for _f in
    select p.oid::regprocedure as assinatura, p.proname as nome
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('funcoes_exigir_admin', 'criar_funcao', 'renomear_funcao', 'alterar_situacao_funcao',
                         'validar_funcao_ativa', 'proteger_funcao', 'registrar_classificacao_do_turno',
                         'mapear_funcoes_por_texto_interno', 'vincular_funcoes_exatas')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('criar_funcao', 'renomear_funcao', 'alterar_situacao_funcao', 'vincular_funcoes_exatas') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.criar_funcao(text, text) is
  'Admin. Cria funcao no catalogo (codigo estavel derivado do nome, ou informado). Recusa nome duplicado ignorando maiusculas, acento e espaco.';
comment on function public.vincular_funcoes_exatas() is
  'Admin. Liga colaboradores sem funcao cujo texto de cargo, normalizado, e IGUAL ao nome de uma funcao ativa. Nada ambiguo e ligado; devolve quantos foram ligados.';
comment on function public.renomear_funcao(uuid, text) is
  'Admin. Renomeia a funcao; o codigo e o identificador nao mudam.';
comment on function public.alterar_situacao_funcao(uuid, boolean) is
  'Admin. Ativa ou inativa a funcao. Inativa nao entra em escolhas novas e preserva as referencias existentes.';

-- ---------------------------------------------------------------------------
-- 8. Autoverificação
-- ---------------------------------------------------------------------------

do $verificacao$
begin
  if (select count(*) from public.job_functions) <> 4 then
    raise exception '039: o catalogo inicial deve ter quatro funcoes.';
  end if;
  if public.normalizar_texto_chave(' AUXILIAR de Produção ') <> 'auxiliardeproducao'
     or public.normalizar_texto_chave('Conferente') <> public.normalizar_texto_chave('conferênte') then
    raise exception '039: a normalizacao de nomes nao confere.';
  end if;
  if has_table_privilege('authenticated', 'public.job_functions', 'INSERT')
     or has_table_privilege('authenticated', 'public.job_functions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.job_functions', 'DELETE')
     or has_table_privilege('anon', 'public.job_functions', 'SELECT')
     or has_table_privilege('bslog_rpc_operacional', 'public.job_functions', 'SELECT') then
    raise exception '039: o catalogo so se le (admin) e so se escreve por RPC.';
  end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.shifts', 'shift_period', 'SELECT')
     or has_column_privilege('bslog_rpc_operacional', 'public.employees', 'job_function_id', 'SELECT')
     or has_column_privilege('bslog_rpc_operacional', 'public.operation_team', 'job_function_id', 'SELECT') then
    raise exception '039: o operacional nao le as colunas novas.';
  end if;
  if exists (select 1 from public.shifts where shift_period is not null) then
    raise exception '039: nenhum turno existente deveria ter sido classificado.';
  end if;
  if exists (select 1 from public.operation_team where job_function_id is not null) then
    raise exception '039: nenhuma alocacao existente deveria ter funcao.';
  end if;
end;
$verificacao$;

commit;
