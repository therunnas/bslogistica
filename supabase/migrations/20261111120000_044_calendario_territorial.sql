-- FIN-PR-10. Calendário territorial; sem carga de feriados, backfill ou ativação comercial.
begin;

create function public.calendario_uf_do_ibge(p_codigo text) returns text
language sql immutable set search_path = pg_catalog as $$
 select case left(p_codigo,2)
 when '11' then 'RO' when '12' then 'AC' when '13' then 'AM' when '14' then 'RR'
 when '15' then 'PA' when '16' then 'AP' when '17' then 'TO' when '21' then 'MA'
 when '22' then 'PI' when '23' then 'CE' when '24' then 'RN' when '25' then 'PB'
 when '26' then 'PE' when '27' then 'AL' when '28' then 'SE' when '29' then 'BA'
 when '31' then 'MG' when '32' then 'ES' when '33' then 'RJ' when '35' then 'SP'
 when '41' then 'PR' when '42' then 'SC' when '43' then 'RS' when '50' then 'MS'
 when '51' then 'MT' when '52' then 'GO' when '53' then 'DF' end;
$$;
create function public.calendario_fonte_oficial(p_url text) returns boolean
language sql immutable set search_path = pg_catalog as $$
 select coalesce(p_url ~ '^https://([A-Za-z0-9-]+\.)+(gov|jus|leg)\.br(/[^[:space:]]*)?$',false);
$$;
create function public.calendario_territorio_valido(p_ambito text,p_uf text,p_municipio text) returns boolean
language sql immutable set search_path = pg_catalog,public as $$
 select coalesce(case p_ambito
 when 'nacional' then p_uf is null and p_municipio is null
 when 'distrital' then p_uf='DF' and p_municipio is null
 when 'estadual' then p_uf = any(array['AC','AL','AP','AM','BA','CE','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) and p_municipio is null
 when 'municipal' then p_uf<>'DF' and p_municipio ~ '^[0-9]{7}$' and public.calendario_uf_do_ibge(p_municipio)=p_uf
 else false end,false);
$$;

-- Identidades oficiais: catálogo sem calendário implícito. Cadastro exige conferência IBGE pelo admin.
create table public.municipality_catalog (
 code text primary key,
 name text not null check(char_length(btrim(name)) between 1 and 150),
 state_code text not null,
 official_url text not null,
 created_at timestamptz not null default now(),
 constraint municipality_catalog_codigo_uf check(code ~ '^[0-9]{7}$' and public.calendario_uf_do_ibge(code) is not null and public.calendario_uf_do_ibge(code)=state_code),
 constraint municipality_catalog_fonte check(official_url='https://servicodados.ibge.gov.br/api/v1/localidades/municipios/'||code)
);
create table public.operation_location_terms (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.operations(id) on delete restrict,
 municipality_code text not null references public.municipality_catalog(code) on delete restrict,
 valid_from date not null,
 valid_to date,
 active boolean not null default true check(active),
 reason text not null check(char_length(btrim(reason)) between 1 and 1000),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint operation_location_terms_periodo check(valid_to is null or valid_to>valid_from),
 constraint operation_location_terms_sobreposicao exclude using gist(operation_id with =,daterange(valid_from,valid_to,'[)') with &&)
);
create index operation_location_terms_busca on public.operation_location_terms(operation_id,valid_from desc);
create table public.financial_calendar_coverage (
 id uuid primary key default gen_random_uuid(),
 calendar_year integer not null check(calendar_year between 1 and 9999),
 territory_scope text not null,
 state_code text,
 municipality_code text references public.municipality_catalog(code) on delete restrict,
 legal_act text not null check(char_length(btrim(legal_act)) between 1 and 2000),
 official_url text not null check(public.calendario_fonte_oficial(official_url)),
 client_confirmed boolean not null default false,
 active boolean not null default true,
 reason text not null check(char_length(btrim(reason)) between 1 and 1000),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 retired_at timestamptz,
 retired_by uuid references auth.users(id) on delete set null,
 retire_reason text,
 constraint financial_calendar_coverage_territorio check(public.calendario_territorio_valido(territory_scope,state_code,municipality_code)),
 constraint financial_calendar_coverage_cliente check(territory_scope<>'municipal' or client_confirmed),
 constraint financial_calendar_coverage_aposentadoria check((active and retired_at is null and retire_reason is null) or(not active and retired_at is not null and char_length(btrim(retire_reason)) between 1 and 1000))
);
create unique index financial_calendar_coverage_ativa on public.financial_calendar_coverage(calendar_year,territory_scope,coalesce(state_code,''),coalesce(municipality_code,'')) where active;

alter table public.financial_holidays
 add column territory_scope text not null default 'legado',
 add column state_code text,
 add column municipality_code text references public.municipality_catalog(code) on delete restrict,
 add column legal_act text,
 add column official_url text,
 add column verification_status text not null default 'pendente',
 add column holiday_kind text not null default 'feriado',
 add column is_movable boolean not null default false,
 add column client_confirmed boolean not null default false,
 add constraint financial_holidays_territorio check(territory_scope='legado' and state_code is null and municipality_code is null or public.calendario_territorio_valido(territory_scope,state_code,municipality_code)),
 add constraint financial_holidays_verificacao check(verification_status in('pendente','confirmado') and holiday_kind in('feriado','ponto_facultativo')),
 add constraint financial_holidays_fonte_territorial check(territory_scope='legado' or coalesce(char_length(btrim(legal_act)),0)>0 and public.calendario_fonte_oficial(official_url)),
 add constraint financial_holidays_confirmacao check(territory_scope='legado' or verification_status<>'confirmado' or holiday_kind='feriado' and (territory_scope<>'municipal' or client_confirmed));
drop index public.financial_holidays_um_ativo_por_data;
create unique index financial_holidays_um_ativo_por_territorio on public.financial_holidays(holiday_date,territory_scope,coalesce(state_code,''),coalesce(municipality_code,''),holiday_kind) where active;
alter table public.timesheet_entries add column territorial_calendar_snapshot jsonb;

-- Mantém todas as ações anteriores e acrescenta somente os eventos desta etapa.
alter table public.financial_terms_audit
  drop constraint financial_terms_audit_acao_valida,
  add constraint financial_terms_audit_acao_valida check (action in (
    'contrato_condicao_registrada',
    'contrato_condicao_corrigida',
    'contrato_condicao_encerrada',
    'contrato_condicao_aposentada',
    'colaborador_custo_registrado',
    'colaborador_custo_corrigido',
    'colaborador_custo_encerrado',
    'colaborador_custo_aposentado',
    'operacao_valor_registrado',
    'operacao_valor_corrigido',
    'operacao_valor_encerrado',
    'operacao_valor_aposentado',
    'motor_vigencia_ativado',
    'motor_vigencia_desativado',
    'colunas_legadas_sincronizadas',
    'apontamento_legado_regularizado',
    'adicional_registrado',
    'adicional_cancelado',
    'feriado_registrado',
    'feriado_aposentado',
    'apontamento_snapshots_corrigidos',
    'tarifa_registrada',
    'tarifa_corrigida',
    'tarifa_encerrada',
    'tarifa_aposentada',
    'tarifas_resolucao_ativada',
    'tarifas_resolucao_desativada',
    'diaria_individual_registrada',
    'diaria_individual_corrigida',
    'diaria_individual_encerrada',
    'diaria_individual_aposentada',
    'apontamento_bonus_definido',
    'municipio_catalogado',
    'local_operacao_registrado',
    'local_operacao_encerrado',
    'feriado_territorial_registrado',
    'cobertura_calendario_confirmada',
    'cobertura_calendario_aposentada'
  ));


-- Não é dado operacional necessário: só admin lê catálogo, versões e cobertura. As cinco RPCs não mudam.
do $$ declare t text; begin
 foreach t in array array['municipality_catalog','operation_location_terms','financial_calendar_coverage'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,bslog_rpc_operacional',t);
  execute format('grant select on table public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using ((select public.has_role(auth.uid(),''admin''::public.app_role)) and (select public.mfa_cotidiano_ok()))',t||'_leitura_admin',t);
 end loop;
end; $$;

-- O lastro territorial é append-only. Só encerramento de vigência / aposentadoria coerente são aceitos.
create function public.proteger_lastro_territorial() returns trigger
language plpgsql set search_path = pg_catalog,public,pg_temp as $$
begin
 if tg_op in('DELETE','TRUNCATE') then raise exception 'Lastro territorial não pode ser apagado.' using errcode='42501'; end if;
 if tg_table_name='operation_location_terms' then
  if new.valid_to is not null
    and (old.valid_to is null or new.valid_to<old.valid_to) and new.valid_to>old.valid_from
    and (to_jsonb(new)-'valid_to')=(to_jsonb(old)-'valid_to') then return new; end if;
 elsif tg_table_name='financial_calendar_coverage' then
  if (to_jsonb(new)-array['active','retired_at','retired_by','retire_reason'])=(to_jsonb(old)-array['active','retired_at','retired_by','retire_reason'])
    and old.active and not new.active and new.retired_at is not null and btrim(new.retire_reason)<>'' then return new; end if;
 end if;
 raise exception 'Lastro territorial imutável: registre nova vigência ou aposente com motivo.' using errcode='42501';
end; $$;
do $$ declare t text; begin
 foreach t in array array['municipality_catalog','operation_location_terms','financial_calendar_coverage'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.proteger_lastro_territorial()',t||'_imutavel',t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function public.proteger_lastro_territorial()',t||'_sem_truncate',t);
 end loop;
end; $$;

create function public.catalogar_municipio(p_codigo text,p_nome text,p_uf text,p_fonte_url text,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare motivo text; eid uuid:=gen_random_uuid(); anterior public.municipality_catalog%rowtype;
begin
 perform public.condicoes_exigir_admin(); motivo:=public.condicoes_validar_motivo(p_reason);
 if p_codigo is null or p_nome is null or p_uf is null or p_fonte_url is null then raise exception 'Identidade IBGE e fonte são obrigatórias.' using errcode='22023'; end if;
 if p_codigo !~ '^[0-9]{7}$' or public.calendario_uf_do_ibge(p_codigo) is distinct from p_uf
    or p_fonte_url<>'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/'||p_codigo or btrim(p_nome)='' then
  raise exception 'Identidade IBGE, UF e fonte canônica devem coincidir.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('calendario_municipio:'||p_codigo,0));
 select * into anterior from public.municipality_catalog where code=p_codigo;
 if found then
  if anterior.name<>btrim(p_nome) or anterior.state_code<>p_uf or anterior.official_url<>p_fonte_url then
   raise exception 'Código IBGE já cadastrado com outra identidade; não é permitido substituir histórico.' using errcode='55000';
  end if;
  return null;
 end if;
 insert into public.municipality_catalog(code,name,state_code,official_url) values(p_codigo,btrim(p_nome),p_uf,p_fonte_url);
 perform public.condicoes_auditar('municipio_catalogado','feriado',eid,eid,null,jsonb_build_object('code',p_codigo,'name',btrim(p_nome),'state_code',p_uf,'official_url',p_fonte_url),motivo);
 return eid;
end; $$;

create function public.registrar_local_operacao(p_operation_id uuid,p_municipality_code text,p_valid_from date,p_reason text,p_encerrar_anterior boolean default false,p_valid_to date default null) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare motivo text; anterior public.operation_location_terms%rowtype; novo public.operation_location_terms%rowtype;
begin
 perform public.condicoes_exigir_admin(); motivo:=public.condicoes_validar_motivo(p_reason);
 if p_operation_id is null or p_municipality_code is null or p_valid_from is null then raise exception 'Operação, município IBGE e início são obrigatórios.' using errcode='22023'; end if;
 -- Mesmo lock do faturamento / edições críticas de apontamento; depois lock da operação.
 perform pg_advisory_xact_lock(hashtextextended((select client_id::text from public.operations where id=p_operation_id),0));
 perform pg_advisory_xact_lock(hashtextextended('local_operacao:'||p_operation_id::text,0));
 if not exists(select 1 from public.operations where id=p_operation_id) or not exists(select 1 from public.municipality_catalog where code=p_municipality_code) then raise exception 'Operação ou município não cadastrado.' using errcode='P0002'; end if;
 if exists(select 1 from public.timesheet_entries te join public.timesheets ts on ts.id=te.timesheet_id
    where ts.operation_id=p_operation_id and te.territorial_calendar_snapshot is not null
    and ts.work_date>=p_valid_from and (p_valid_to is null or ts.work_date<p_valid_to)) then
  raise exception 'Há apontamentos com local congelado neste período; a nova vigência não pode reescrever o histórico.' using errcode='55000'; end if;
 if coalesce(p_encerrar_anterior,false) then
  select * into anterior from public.operation_location_terms where operation_id=p_operation_id and valid_to is null for update;
  if found and anterior.valid_from<p_valid_from then
   if p_valid_to is not null and exists(select 1 from public.timesheet_entries te join public.timesheets ts on ts.id=te.timesheet_id
      where ts.operation_id=p_operation_id and te.territorial_calendar_snapshot is not null and ts.work_date>=p_valid_to) then
    raise exception 'Há apontamentos com local congelado após o período; encerrar a vigência anterior alteraria o histórico.' using errcode='55000';
   end if;
   update public.operation_location_terms set valid_to=p_valid_from where id=anterior.id;
   perform public.condicoes_auditar('local_operacao_encerrado','operacao',p_operation_id,anterior.id,to_jsonb(anterior),jsonb_build_object('valid_to',p_valid_from),motivo);
  end if;
 end if;
 insert into public.operation_location_terms(operation_id,municipality_code,valid_from,valid_to,reason,created_by)
 values(p_operation_id,p_municipality_code,p_valid_from,p_valid_to,motivo,auth.uid()) returning * into novo;
 perform public.condicoes_auditar('local_operacao_registrado','operacao',p_operation_id,novo.id,null,to_jsonb(novo),motivo);
 return novo.id;
end; $$;

create function public.registrar_feriado_territorial(p_dados jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare motivo text; novo public.financial_holidays%rowtype;
begin
 perform public.condicoes_exigir_admin(); motivo:=public.condicoes_validar_motivo(p_reason);
 if jsonb_typeof(p_dados) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_dados) k where k not in('holiday_date','name','territory_scope','state_code','municipality_code','legal_act','official_url','verification_status','holiday_kind','is_movable','client_confirmed'))
    or coalesce(p_dados->>'territory_scope','') not in('nacional','estadual','municipal','distrital') then raise exception 'Registro territorial inválido.' using errcode='22023'; end if;
 if not public.calendario_territorio_valido(p_dados->>'territory_scope',p_dados->>'state_code',p_dados->>'municipality_code')
    or not public.calendario_fonte_oficial(p_dados->>'official_url') or coalesce(btrim(p_dados->>'legal_act'),'')=''
    or p_dados->>'verification_status'='confirmado' and (coalesce(p_dados->>'holiday_kind','feriado')<>'feriado' or p_dados->>'territory_scope'='municipal' and not coalesce((p_dados->>'client_confirmed')::boolean,false)) then
  raise exception 'Território, fonte oficial ou confirmação municipal inválidos.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('feriados',0));
 insert into public.financial_holidays(holiday_date,name,reason,created_by,territory_scope,state_code,municipality_code,legal_act,official_url,verification_status,holiday_kind,is_movable,client_confirmed)
 values((p_dados->>'holiday_date')::date,btrim(p_dados->>'name'),motivo,auth.uid(),p_dados->>'territory_scope',p_dados->>'state_code',p_dados->>'municipality_code',btrim(p_dados->>'legal_act'),p_dados->>'official_url',coalesce(p_dados->>'verification_status','pendente'),coalesce(p_dados->>'holiday_kind','feriado'),coalesce((p_dados->>'is_movable')::boolean,false),coalesce((p_dados->>'client_confirmed')::boolean,false)) returning * into novo;
 perform public.condicoes_auditar('feriado_territorial_registrado','feriado',novo.id,novo.id,null,to_jsonb(novo),motivo);
 return novo.id;
end; $$;
create function public.confirmar_cobertura_calendario(p_dados jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare motivo text; novo public.financial_calendar_coverage%rowtype;
begin
 perform public.condicoes_exigir_admin(); motivo:=public.condicoes_validar_motivo(p_reason);
 if jsonb_typeof(p_dados) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_dados) k where k not in('calendar_year','territory_scope','state_code','municipality_code','legal_act','official_url','client_confirmed')) then raise exception 'Cobertura territorial inválida.' using errcode='22023'; end if;
 if not public.calendario_territorio_valido(p_dados->>'territory_scope',p_dados->>'state_code',p_dados->>'municipality_code')
    or not public.calendario_fonte_oficial(p_dados->>'official_url') or coalesce(btrim(p_dados->>'legal_act'),'')=''
    or p_dados->>'territory_scope'='municipal' and not coalesce((p_dados->>'client_confirmed')::boolean,false) then
  raise exception 'Cobertura exige território, norma, fonte oficial e conferência municipal do cliente.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('feriados',0));
 insert into public.financial_calendar_coverage(calendar_year,territory_scope,state_code,municipality_code,legal_act,official_url,client_confirmed,reason,created_by)
 values((p_dados->>'calendar_year')::integer,p_dados->>'territory_scope',p_dados->>'state_code',p_dados->>'municipality_code',btrim(p_dados->>'legal_act'),p_dados->>'official_url',coalesce((p_dados->>'client_confirmed')::boolean,false),motivo,auth.uid()) returning * into novo;
 perform public.condicoes_auditar('cobertura_calendario_confirmada','feriado',novo.id,novo.id,null,to_jsonb(novo),motivo);
 return novo.id;
end; $$;
create function public.aposentar_cobertura_calendario(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare motivo text; anterior public.financial_calendar_coverage%rowtype; novo public.financial_calendar_coverage%rowtype;
begin
 perform public.condicoes_exigir_admin(); motivo:=public.condicoes_validar_motivo(p_reason);
 perform pg_advisory_xact_lock(hashtextextended('feriados',0));
 select * into anterior from public.financial_calendar_coverage where id=p_id for update;
 if not found then raise exception 'Cobertura não encontrada.' using errcode='P0002'; end if;
 if not anterior.active then raise exception 'Cobertura já aposentada.' using errcode='55000'; end if;
 update public.financial_calendar_coverage set active=false,retired_at=now(),retired_by=auth.uid(),retire_reason=motivo where id=p_id returning * into novo;
 perform public.condicoes_auditar('cobertura_calendario_aposentada','feriado',p_id,p_id,to_jsonb(anterior),to_jsonb(novo),motivo);
end; $$;

-- A assinatura antiga continua atendendo o legado/OFF, sem enxergar feriado de outro território.
create or replace function public.motor_tipo_do_dia(p_data date) returns text
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select case when exists(select 1 from public.financial_holidays where holiday_date=p_data and active and territory_scope='legado') then 'feriado'
 when extract(isodow from p_data)=6 then 'sabado' else 'util' end;
$$;
create function public.calendario_da_operacao_interno(p_operation_id uuid,p_data date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare local public.operation_location_terms%rowtype; cidade public.municipality_catalog%rowtype; coberturas jsonb; feriados jsonb; incompleto boolean;
begin
 select * into local from public.operation_location_terms where operation_id=p_operation_id and active and daterange(valid_from,valid_to,'[)') @> p_data;
 if not found then return jsonb_build_object('status','localidade_ausente','municipality_code',null,'state_code',null,'location_term_id',null,'holiday_ids','[]'::jsonb,'coverage_ids','[]'::jsonb,'day_kind',null); end if;
 select * into strict cidade from public.municipality_catalog where code=local.municipality_code;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into coberturas from public.financial_calendar_coverage c
 where active and calendar_year=extract(year from p_data)::integer and (territory_scope='nacional' or territory_scope='distrital' and cidade.state_code='DF' and state_code='DF' or territory_scope='estadual' and cidade.state_code<>'DF' and state_code=cidade.state_code or territory_scope='municipal' and cidade.state_code<>'DF' and municipality_code=cidade.code);
 select exists(select 1 from public.financial_holidays h where active and holiday_kind='feriado' and verification_status='pendente'
 and extract(year from holiday_date)=extract(year from p_data) and (territory_scope='nacional' or territory_scope='distrital' and cidade.state_code='DF' and state_code='DF' or territory_scope='estadual' and cidade.state_code<>'DF' and state_code=cidade.state_code or territory_scope='municipal' and cidade.state_code<>'DF' and municipality_code=cidade.code)) into incompleto;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into feriados from public.financial_holidays h
 where active and holiday_kind='feriado' and verification_status='confirmado' and holiday_date=p_data
 and (territory_scope='nacional' or territory_scope='distrital' and cidade.state_code='DF' and state_code='DF' or territory_scope='estadual' and cidade.state_code<>'DF' and state_code=cidade.state_code or territory_scope='municipal' and cidade.state_code<>'DF' and municipality_code=cidade.code and client_confirmed);
 return jsonb_build_object('status',case when jsonb_array_length(coberturas)=case when cidade.state_code='DF' then 2 else 3 end and not incompleto then 'confirmado' else 'pendente' end,
 'municipality_code',cidade.code,'state_code',cidade.state_code,'location_term_id',local.id,'municipality_name',cidade.name,
 'holiday_ids',feriados,'coverage_ids',coberturas,'day_kind',case when jsonb_array_length(coberturas)<>case when cidade.state_code='DF' then 2 else 3 end or incompleto then null when jsonb_array_length(feriados)>0 then 'feriado' when extract(isodow from p_data)=7 then 'domingo' when extract(isodow from p_data)=6 then 'sabado' else 'util' end);
end; $$;
create function public.consultar_calendario_operacao(p_operation_id uuid,p_data date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 perform public.condicoes_exigir_admin_leitura();
 return public.calendario_da_operacao_interno(p_operation_id,p_data);
end; $$;
create function public.motor_tipo_do_dia(p_data date,p_operation_id uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb;
begin
 c:=public.calendario_da_operacao_interno(p_operation_id,p_data);
 if c->>'status'<>'confirmado' then raise exception 'Calendário territorial pendente: confirme o local real e as coberturas do ano: nacional e distrital no DF; nacional, estadual e municipal nas demais UFs.' using errcode='55000'; end if;
 return c->>'day_kind';
end; $$;

-- Segmentação técnica, sem fórmula financeira. Não inventa a posição do intervalo.
create function public.segmentar_jornada_civil(p_data date,p_entrada time,p_saida time,p_intervalo_min integer,p_intervalo_inicio time default null,p_intervalo_fim time default null) returns jsonb
language plpgsql immutable set search_path=pg_catalog,public,pg_temp as $$
declare inicio timestamp; fim timestamp; bi timestamp; bf timestamp; d date; ini timestamp; fin timestamp; bruto integer; liquido integer; total integer; partes jsonb:='[]'; desconhecido boolean;
begin
 if p_data is null or p_intervalo_min is null or p_intervalo_min<0 then raise exception 'Data e duração do intervalo são obrigatórias e válidas.' using errcode='22023'; end if;
 if p_entrada is null or p_saida is null then return jsonb_build_object('status','incompleta','worked_minutes',0,'segments','[]'::jsonb); end if;
 -- Mesma precisão do núcleo 035: HH:MM; segundos não criam minutos adicionais.
 inicio:=date_trunc('minute',p_data+p_entrada); fim:=date_trunc('minute',p_data+p_saida);
 if inicio=fim then raise exception 'Entrada igual à saída não representa jornada válida.' using errcode='23514'; end if;
 if fim<inicio then fim:=fim+interval '1 day'; end if;
 total:=extract(epoch from(fim-inicio))::integer/60-p_intervalo_min;
 if total<0 or (p_intervalo_inicio is null)<>(p_intervalo_fim is null) then raise exception 'Intervalo incompatível com a jornada.' using errcode='22023'; end if;
 if p_intervalo_inicio is not null then
  bi:=date_trunc('minute',p_data+p_intervalo_inicio); if bi<inicio then bi:=bi+interval '1 day'; end if;
  bf:=date_trunc('minute',bi::date+p_intervalo_fim); if bf<bi then bf:=bf+interval '1 day'; end if;
  if bi<inicio or bf>fim or extract(epoch from(bf-bi))::integer<>p_intervalo_min*60 then raise exception 'Horário do intervalo deve pertencer à jornada e coincidir com sua duração.' using errcode='22023'; end if;
 end if;
 desconhecido:=inicio::date<>fim::date and p_intervalo_min>0 and bi is null;
 for d in select generate_series(inicio::date,(fim-interval '1 microsecond')::date,interval '1 day')::date loop
  ini:=greatest(inicio,d::timestamp); fin:=least(fim,(d+1)::timestamp);
  bruto:=extract(epoch from(fin-ini))::integer/60;
  liquido:=case when desconhecido then null when bi is null then bruto-case when inicio::date=fim::date then p_intervalo_min else 0 end
    else bruto-greatest(0,extract(epoch from(least(fin,bf)-greatest(ini,bi)))::integer/60) end;
  partes:=partes||jsonb_build_array(jsonb_build_object('date',d,'gross_minutes',bruto,'worked_minutes',liquido));
 end loop;
 return jsonb_build_object('status',case when desconhecido then 'intervalo_sem_horario' else 'confirmado' end,'worked_minutes',total,'segments',partes);
end; $$;

create function public.proteger_snapshot_territorial() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='INSERT' then
  if new.territorial_calendar_snapshot is not null then raise exception 'Snapshot territorial é derivado pelo banco.' using errcode='42501'; end if;
 elsif new.territorial_calendar_snapshot is distinct from old.territorial_calendar_snapshot then
  raise exception 'Snapshot territorial congelado não aceita alteração direta.' using errcode='42501';
 elsif old.territorial_calendar_snapshot is not null and new.timesheet_id is distinct from old.timesheet_id then
  raise exception 'Local e data já congelados; registre o lançamento no contexto correto sem mover o histórico.' using errcode='55000';
 end if;
 return new;
end; $$;
create trigger trg_timesheet_entries_ba_snapshot_territorial before insert or update on public.timesheet_entries for each row execute function public.proteger_snapshot_territorial();

-- A 011 já protege operação/turno; data civil passa a integrar o lastro territorial.
create function public.proteger_data_territorial_folha() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if new.work_date is not distinct from old.work_date then return new; end if;
 perform 1 from public.timesheets where id=old.id for no key update;
 if exists(select 1 from public.timesheet_entries where timesheet_id=old.id and territorial_calendar_snapshot is not null) then
  raise exception 'A data civil da folha possui calendário territorial congelado e não pode ser alterada.' using errcode='55000';
 end if;
 return new;
end; $$;
-- Posterior à guarda de faturados: mantém o SQLSTATE e o bloqueio histórico da 011.
create trigger trg_timesheets_bz_data_territorial before update of work_date on public.timesheets for each row execute function public.proteger_data_territorial_folha();

CREATE OR REPLACE FUNCTION public.derivar_valores_por_vigencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  _work_date   date;
  _operation   uuid;
  _shift       uuid;
  _motriz      boolean;
  _precificar  boolean;
  _fonte       record;
  _custo       record;
  _ativacao    date;

  _origem              text;
  _contract_terms_id   uuid;
  _operation_terms_id  uuid;
  _employee_terms_id   uuid;

  _daily_rate       double precision;
  _shift_hours      double precision;
  _ot_factor        double precision;
  _ot_tolerance_min double precision;
  _daily_cost       double precision;
  _planned          double precision;
  _ot_hourly        numeric;

  -- B8.15
  _dia            text;
  _modo           text := 'diario';
  _sabado_horas   double precision;
  _fator_feriado  double precision;
  _planned_cob    double precision;
  _base_cob       double precision;
  _excesso_cob    double precision;
  _ot_cob         double precision := 0;
  _completo       boolean;

  _planned_efetivo     double precision;
  _shift_hours_efetivo double precision;
  _ot_factor_efetivo   double precision;
  _ot_hour_rate        double precision;
  _ot_cost_hour_rate   double precision;
  _base_cost           double precision;

  _inicio    double precision;
  _fim       double precision;
  _worked    double precision := 0;
  _excess    double precision;
  _overtime  double precision := 0;
  _ot_horas  double precision;

  _billed numeric;
  _cost   numeric;

  -- FIN-PR-02: núcleo V2 (dia útil e sábado) e componentes persistidos
  _legado030     boolean;
  _modo_especial text := 'minutos';
  _preco_especial numeric;
  _custo_especial numeric;
  _n             record;

  -- FIN-PR-07: tarifa comercial por contrato + função + período do turno + data trabalhada
  _territorial jsonb;
  _segmentos jsonb;
  _dias jsonb;
  _civil jsonb;
  _segmento jsonb;
  _capturar_local boolean;
  _res           boolean := false;
  _tar           record;
  _cid           uuid;

  -- FIN-PR-08: diária individual e adicional diário (bônus)
  _ind           record;
  _bonus         numeric := 0;
  _c_adic        numeric := 0;
  _calc_version  smallint := null;
  _c_base        numeric := null;
  _c_ot          numeric := null;
  _c_special     numeric := null;
begin
  -- `INSERT ... ON CONFLICT DO UPDATE` dispara este BEFORE INSERT mesmo quando o resultado final
  -- é UPDATE: a linha que já existe é tratada na fase de UPDATE.
  if tg_op = 'INSERT' then
    if exists (select 1 from public.timesheet_entries e where e.id = new.id)
       or exists (select 1 from public.timesheet_entries e
                   where e.timesheet_id = new.timesheet_id and e.employee_id = new.employee_id) then
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    _motriz :=
         new.status        is distinct from old.status
      or new.check_in      is distinct from old.check_in
      or new.check_out     is distinct from old.check_out
      or new.break_minutes is distinct from old.break_minutes
      or new.employee_id   is distinct from old.employee_id
      or new.timesheet_id  is distinct from old.timesheet_id
      -- FIN-PR-07: a função ou o período corrigidos são motivo de recálculo (só têm efeito no preço
      -- com a resolução ligada; desligada, o recálculo reproduz o valor congelado).
      or new.job_function_id_snapshot is distinct from old.job_function_id_snapshot
      or new.shift_period_snapshot    is distinct from old.shift_period_snapshot;

    -- Sem coluna motriz, e sem a regularização: preserva o gravado, como a 010.
    if not _motriz and new.terms_origin is not distinct from old.terms_origin then
      new.worked_minutes          := old.worked_minutes;
      new.overtime_minutes        := old.overtime_minutes;
      new.billed_overtime_minutes := old.billed_overtime_minutes;
      new.day_kind_snapshot       := old.day_kind_snapshot;
      new.daily_rate_snapshot     := old.daily_rate_snapshot;
      new.ot_hour_rate_snapshot   := old.ot_hour_rate_snapshot;
      new.daily_cost_snapshot     := old.daily_cost_snapshot;
      new.ot_hourly_cost_snapshot := old.ot_hourly_cost_snapshot;
      -- FIN-PR-08: o adicional diário só muda por definir_bonus_do_apontamento (a trava de colunas
      -- barra qualquer outro escritor). Quando muda, o total é recomposto pela identidade
      -- base + HE + especial + adicional; sem mudança, o gravado fica como estava.
      new.billed_amount           := case
        when new.additional_amount is distinct from old.additional_amount and old.calc_version = 2
          then old.billed_base_amount + old.billed_overtime_amount + old.billed_special_amount + new.additional_amount
        else old.billed_amount end;
      new.cost_amount             := old.cost_amount;
      new.billed_base_amount      := old.billed_base_amount;
      new.billed_overtime_amount  := old.billed_overtime_amount;
      new.billed_special_amount   := old.billed_special_amount;
      new.calc_version            := old.calc_version;
      new.contract_rate_terms_id  := old.contract_rate_terms_id;
      new.contract_employee_rate_id := old.contract_employee_rate_id;
      new.price_source            := old.price_source;
      return new;
    end if;

    -- R3: a edição exige recálculo. OFF não pode converter um especial V2 nem apagar seu bônus.
    -- O retorno anterior mantém intactas as edições sem mudança financeira.
    if old.invoice_id is null and old.calc_version = 2
       and old.day_kind_snapshot in ('domingo', 'feriado')
       and not public.resolucao_de_tarifas_ativa() then
      raise exception 'Este lançamento foi calculado pelo V2 de dias especiais. A resolução de tarifas precisa estar ligada para editar horários, intervalo, status, colaborador ou condições financeiras.'
        using errcode = '55000';
    end if;
  end if;

  -- Apontamento LEGADO de presença/reposição segue congelado para qualquer edição motriz.
  if tg_op = 'UPDATE' and old.status <> 'absent'
     and old.terms_origin is null and new.terms_origin is null then
    raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
      using errcode = '55000',
            hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
  end if;

  -- Falta: nada a precificar, valores zerados.
  if new.status = 'absent' then
    if tg_op = 'UPDATE' and old.territorial_calendar_snapshot is not null then
      new.territorial_calendar_snapshot := jsonb_set(old.territorial_calendar_snapshot, '{segments}',
        jsonb_build_object('status', 'incompleta', 'worked_minutes', 0, 'segments', '[]'::jsonb));
    end if;
    if tg_op = 'INSERT' then
      new.contract_rate_terms_id  := null;
      new.contract_employee_rate_id := null;
      new.price_source            := null;
      new.contract_terms_id       := null;
      new.operation_terms_id      := null;
      new.employee_cost_terms_id  := null;
      new.shift_hours_snapshot    := null;
      new.ot_factor_snapshot      := null;
      new.ot_tolerance_snapshot   := null;
      new.planned_minutes_snapshot := null;
      new.terms_origin            := null;
      new.ot_hourly_cost_snapshot := null;
      new.day_kind_snapshot       := null;
      new.daily_rate_snapshot     := 0;
      new.ot_hour_rate_snapshot   := 0;
      new.daily_cost_snapshot     := 0;
    else
      new.contract_rate_terms_id  := old.contract_rate_terms_id;
      new.contract_employee_rate_id := old.contract_employee_rate_id;
      new.price_source            := old.price_source;
      new.contract_terms_id       := old.contract_terms_id;
      new.operation_terms_id      := old.operation_terms_id;
      new.shift_hours_snapshot    := old.shift_hours_snapshot;
      new.ot_factor_snapshot      := old.ot_factor_snapshot;
      new.ot_tolerance_snapshot   := old.ot_tolerance_snapshot;
      new.planned_minutes_snapshot := old.planned_minutes_snapshot;
      new.terms_origin            := old.terms_origin;
      new.day_kind_snapshot       := old.day_kind_snapshot;
      new.daily_rate_snapshot     := old.daily_rate_snapshot;
      new.ot_hour_rate_snapshot   := old.ot_hour_rate_snapshot;
      if new.employee_id is distinct from old.employee_id then
        new.employee_cost_terms_id  := null;
        new.daily_cost_snapshot     := 0;
        new.ot_hourly_cost_snapshot := null;
      else
        new.employee_cost_terms_id  := old.employee_cost_terms_id;
        new.daily_cost_snapshot     := old.daily_cost_snapshot;
        new.ot_hourly_cost_snapshot := old.ot_hourly_cost_snapshot;
      end if;
    end if;
    new.worked_minutes          := 0;
    new.overtime_minutes        := 0;
    new.billed_overtime_minutes := 0;
    new.billed_amount           := 0;
    new.cost_amount             := 0;
    -- V2: a falta é zero em todos os componentes (a identidade fecha).
    new.billed_base_amount      := 0;
    new.billed_overtime_amount  := 0;
    new.billed_special_amount   := 0;
    new.additional_amount       := 0;
    new.calc_version            := 2;
    return new;
  end if;

  -- Data, operação e turno vêm da FOLHA, nunca do payload.
  select t.work_date, t.operation_id, t.shift_id
    into _work_date, _operation, _shift
    from public.timesheets t
   where t.id = new.timesheet_id;
  if not found then
    return new;
  end if;

  _res := public.resolucao_de_tarifas_ativa();
  _precificar := case
    when tg_op = 'INSERT' then true
    else new.timesheet_id is distinct from old.timesheet_id or old.status = 'absent'
      -- Converter explicitamente um especial legado para V2 exige resolver a fonte comercial:
      -- não reutilizar a diária genérica congelada enquanto a resolução estava OFF.
      or (_res and old.calc_version is distinct from 2
          and (old.day_kind_snapshot = 'feriado' or extract(isodow from _work_date) = 7))
      -- Correção de função/período num apontamento já precificado por contrato: com a resolução
      -- ligada o preço é resolvido de novo pela tarifa da combinação corrigida.
      or (_res and old.terms_origin = 'versao'
          and (new.job_function_id_snapshot is distinct from old.job_function_id_snapshot
               or new.shift_period_snapshot is distinct from old.shift_period_snapshot
               -- FIN-PR-08: a diária individual depende do colaborador: trocar o colaborador de um
               -- apontamento ainda não faturado reprecifica pela fonte do novo colaborador.
               or new.employee_id is distinct from old.employee_id))
  end;

  -- FIN-PR-10: só novas presenças ON capturam território. Nada é preenchido retroativamente.
  _capturar_local := tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status = 'absent' and old.territorial_calendar_snapshot is null);
  if (_res and _capturar_local) or new.territorial_calendar_snapshot is not null then
    perform pg_advisory_xact_lock(hashtextextended((select client_id::text from public.operations where id = _operation), 0));
    perform pg_advisory_xact_lock(hashtextextended('local_operacao:' || _operation::text, 0));
    _segmentos := public.segmentar_jornada_civil(_work_date, new.check_in, new.check_out, coalesce(new.break_minutes, 0));
    if _res and _capturar_local then
      _territorial := public.calendario_da_operacao_interno(_operation, _work_date);
      if _territorial->>'status' <> 'confirmado' then
        raise exception 'Calendário territorial pendente: confirme local real e cobertura oficial do ano antes de apontar com resolução ligada.' using errcode = '55000';
      end if;
      _dias := jsonb_build_array(_territorial || jsonb_build_object('date', _work_date));
      for _segmento in select value from jsonb_array_elements(_segmentos->'segments') loop
        if (_segmento->>'date')::date <> _work_date then
          _civil := public.calendario_da_operacao_interno(_operation, (_segmento->>'date')::date);
          if _civil->>'status' <> 'confirmado' then
            raise exception 'Calendário territorial pendente na segunda data civil da jornada.' using errcode = '55000';
          end if;
          if _civil->>'day_kind' <> _territorial->>'day_kind' then
            raise exception 'Turno misto por data civil: regra comercial por segmento e distribuição do intervalo precisam ser confirmadas. Nenhuma cobrança foi estimada.' using errcode = '55000';
          end if;
          _dias := _dias || jsonb_build_array(_civil || jsonb_build_object('date', _segmento->>'date'));
        end if;
      end loop;
      new.territorial_calendar_snapshot := jsonb_build_object('version', 1,
        'location', jsonb_build_object('location_term_id', _territorial->'location_term_id',
          'municipality_code', _territorial->'municipality_code', 'municipality_name', _territorial->'municipality_name', 'state_code', _territorial->'state_code'),
        'days', _dias, 'segments', _segmentos);
    else
      -- Reedição autorizada conserva local, normas/IDs e classificação já congelados.
      _territorial := new.territorial_calendar_snapshot->'days'->0;
      -- OFF conserva integralmente o cálculo anterior e só sincroniza quantidades técnicas.
      if _res then
      for _segmento in select value from jsonb_array_elements(_segmentos->'segments') loop
        select value into _civil from jsonb_array_elements(new.territorial_calendar_snapshot->'days')
          where value->>'date' = _segmento->>'date';
        if _civil is null or _civil->>'day_kind' <> _territorial->>'day_kind' then
          raise exception 'Reedição atravessa data civil sem classificação homogênea congelada; regra comercial do turno misto pendente.' using errcode = '55000';
        end if;
      end loop;
      end if;
      new.territorial_calendar_snapshot := jsonb_set(new.territorial_calendar_snapshot, '{segments}', _segmentos);
    end if;
  end if;

  _origem := new.terms_origin;
  _contract_terms_id := new.contract_terms_id;
  _operation_terms_id := new.operation_terms_id;
  _employee_terms_id := new.employee_cost_terms_id;

  if _precificar then
    select ativada_em into _ativacao from public.financial_engine_settings where id;
    if _ativacao is not null and _work_date < _ativacao
       and exists (select 1 from public.timesheet_entries e
                     join public.timesheets s on s.id = e.timesheet_id
                    where s.operation_id = _operation and e.terms_origin is null
                      and e.status <> 'absent'
                      and e.id is distinct from new.id) then
      raise exception 'Esta operação tem apontamentos anteriores à ativação do histórico de vigências; o vínculo de contrato daquele período é desconhecido.'
        using errcode = '55000',
              hint = 'Regularize os apontamentos legados da operação antes de lançar datas anteriores a ' || _ativacao || '.';
    end if;

    select * into _fonte from public.motor_fonte_do_dia(_operation, _work_date);
    select * into _custo from public.motor_custo_do_dia(new.employee_id, _work_date);

    _origem := _fonte.o_origem;
    _contract_terms_id := _fonte.o_contract_terms_id;
    _operation_terms_id := _fonte.o_operation_terms_id;
    _employee_terms_id := _custo.o_employee_cost_terms_id;

    _daily_rate := _fonte.o_daily_rate;

    -- FIN-PR-07: com a resolução ligada, o preço de contrato vem da TARIFA da combinação função +
    -- período (snapshots do lançamento) na data trabalhada. Nunca há fallback para a diária genérica
    -- nem para o cadastro de hoje: faltando snapshot ou tarifa, o lançamento é recusado. Operação
    -- sem contrato (valor acordado) segue a regra de antes.
    new.contract_rate_terms_id := null;
    new.contract_employee_rate_id := null;
    new.price_source := null;
    if _res and _origem = 'versao' then
      if new.job_function_id_snapshot is null then
        raise exception 'Apontamento pendente de classificação: sem função trabalhada, a tarifa por função não pode ser aplicada em %.', _work_date
          using errcode = '55000',
                hint = 'Informe a função na alocação ou no apontamento (ou corrija-a com corrigir_snapshots_do_apontamento).';
      end if;
      if new.shift_period_snapshot is null then
        raise exception 'Apontamento pendente de classificação: o turno desta folha não tem período diurno/noturno.'
          using errcode = '55000',
                hint = 'Classifique o turno no cadastro e regularize o período do apontamento.';
      end if;
      select ct.contract_id into _cid from public.contract_terms ct where ct.id = _fonte.o_contract_terms_id;
      -- FIN-PR-08, 1º: a diária INDIVIDUAL do colaborador neste contrato, vigente na data trabalhada
      -- (preço cobrado do cliente; nunca a de outro contrato nem o custo do colaborador). A HE sai
      -- dela. Os snapshots acima continuam obrigatórios: a classificação não é contornada.
      select * into _ind from public.contract_employee_rates ir
       where ir.contract_id = _cid and ir.employee_id = new.employee_id and ir.active
         and daterange(ir.valid_from, ir.valid_to, '[)') @> _work_date
         for share;
      if found then
        _daily_rate := _ind.daily_rate;
        new.contract_employee_rate_id := _ind.id;
        new.price_source := 'individual';
      else
        -- 2º: a tarifa padrão por função e período (041).
        select * into _tar from public.contract_rate_terms r
         where r.contract_id = _cid and r.job_function_id = new.job_function_id_snapshot
           and r.shift_period = new.shift_period_snapshot and r.active
           and daterange(r.valid_from, r.valid_to, '[)') @> _work_date
           for share;
        -- 3º: nenhuma fonte válida.
        if not found then
          raise exception 'Sem diária individual nem tarifa padrão vigente em % para este colaborador, função e período do turno no contrato.', _work_date
            using errcode = 'P0002',
                  hint = 'Cadastre a diária individual do colaborador ou a tarifa da função e do período no contrato antes de apontar; não há fallback para a diária genérica.';
        end if;
        _daily_rate := _tar.daily_rate;
        new.contract_rate_terms_id := _tar.id;
        new.price_source := 'funcao_periodo';
      end if;
    end if;

    _shift_hours := _fonte.o_shift_hours;
    _ot_factor := _fonte.o_ot_factor;
    _ot_tolerance_min := _fonte.o_ot_tolerance_min;
    _daily_cost := _custo.o_daily_cost;
    _planned := public.motor_minutos_previstos(_shift);
    select ot_hourly_cost into _ot_hourly from public.employee_cost_terms where id = _employee_terms_id;
    -- B8.15: o tipo do dia é fixado na precificação.
    _dia := case when _res and new.territorial_calendar_snapshot is not null
      then new.territorial_calendar_snapshot->'days'->0->>'day_kind'
      else public.motor_tipo_do_dia(_work_date) end;

    new.shift_hours_snapshot := _fonte.o_shift_hours;
    new.ot_factor_snapshot := _fonte.o_ot_factor;
    new.ot_tolerance_snapshot := _fonte.o_ot_tolerance_min;
    new.planned_minutes_snapshot := _planned::numeric;
  else
    if new.terms_origin in ('versao', 'valor_acordado')
       and new.daily_rate_snapshot is not null and new.shift_hours_snapshot is not null
       and new.ot_factor_snapshot is not null and new.ot_tolerance_snapshot is not null
       and new.planned_minutes_snapshot is not null and new.daily_cost_snapshot is not null then
      _daily_rate := new.daily_rate_snapshot;
      _shift_hours := new.shift_hours_snapshot;
      _ot_factor := new.ot_factor_snapshot;
      _ot_tolerance_min := new.ot_tolerance_snapshot;
      _planned := new.planned_minutes_snapshot;
      _daily_cost := new.daily_cost_snapshot;

      if new.employee_id is distinct from old.employee_id then
        select * into _custo from public.motor_custo_do_dia(new.employee_id, _work_date);
        _employee_terms_id := _custo.o_employee_cost_terms_id;
        _daily_cost := _custo.o_daily_cost;
      end if;

      if _employee_terms_id is distinct from old.employee_cost_terms_id then
        select ot_hourly_cost into _ot_hourly from public.employee_cost_terms where id = _employee_terms_id;
      else
        _ot_hourly := old.ot_hourly_cost_snapshot;
      end if;
      -- B8.15: o tipo do dia fica o congelado (apontamento anterior à 030: calculado agora).
      _dia := coalesce(old.day_kind_snapshot, public.motor_tipo_do_dia(_work_date));
    else
      raise exception 'Apontamento anterior ao histórico de vigências: alterar horário, intervalo, status ou colaborador exigiria um preço que não foi comprovado.'
        using errcode = '55000',
              hint = 'Um administrador pode regularizá-lo com regularizar_apontamento_legado (prévia, motivo e trilha). Notas e faturamento seguem livres.';
    end if;
  end if;

  -- B8.15: parâmetros de horas da versão do contrato (imutável). Valor acordado: neutros.
  if _contract_terms_id is not null then
    select ct.ot_rounding_mode, ct.saturday_shift_hours, ct.holiday_pay_factor
      into _modo, _sabado_horas, _fator_feriado
      from public.contract_terms ct where ct.id = _contract_terms_id;
  end if;
  _modo := coalesce(_modo, 'diario');

  _shift_hours_efetivo := case
    when _shift_hours is not null and _shift_hours > 0 then _shift_hours else 8
  end;
  _ot_factor_efetivo := case
    when _ot_factor is null or _ot_factor = 0 then 1 else _ot_factor
  end;

  _daily_rate        := coalesce(_daily_rate, 0);
  _daily_cost        := coalesce(_daily_cost, 0);
  -- A hora cobrada é diária ÷ jornada CONTRATUAL, também no sábado.
  _ot_hour_rate      := (_daily_rate / _shift_hours_efetivo) * _ot_factor_efetivo;
  _ot_cost_hour_rate := case
    when _ot_hourly is not null then _ot_hourly::double precision
    else _daily_cost / _shift_hours_efetivo
  end;

  _completo := new.check_in is not null and new.check_out is not null;
  if not _completo then
    _worked := 0;
  else
    _inicio := extract(hour from new.check_in)  * 60 + extract(minute from new.check_in);
    _fim    := extract(hour from new.check_out) * 60 + extract(minute from new.check_out);
    if _fim <= _inicio then
      _fim := _fim + 1440;
    end if;
    _worked := greatest(0, _fim - _inicio - coalesce(new.break_minutes, 0));
  end if;

  _planned_efetivo := case
    when _planned is null or _planned = 0 then _shift_hours_efetivo * 60 else _planned
  end;

  -- FIN-PR-09: OFF percorre exatamente a 042. Não muda o classificador histórico.
  -- Só lançamentos elegíveis com resolução ON entram no ramo especial do núcleo 035.
  _legado030 := (_dia = 'feriado' or extract(isodow from _work_date) = 7) and not _res;
  if _res and _dia <> 'feriado' and extract(isodow from _work_date) = 7 then
    _dia := 'domingo';
  end if;
  if _res and _dia in ('domingo', 'feriado') then
    if _contract_terms_id is not null then
      select special_rounding_mode into _modo_especial
        from public.contract_terms where id = _contract_terms_id;
    end if;
    -- Fontes NUMERIC independentes; o ramo legado mantém sua aritmética intacta.
    if not _precificar then
      _preco_especial := new.daily_rate_snapshot;
      _custo_especial := new.daily_cost_snapshot;
      if _employee_terms_id is distinct from old.employee_cost_terms_id then
        select daily_cost into _custo_especial from public.employee_cost_terms where id = _employee_terms_id;
      end if;
    else
      if new.contract_employee_rate_id is not null then
        select daily_rate into _preco_especial from public.contract_employee_rates where id = new.contract_employee_rate_id;
      elsif new.contract_rate_terms_id is not null then
        select daily_rate into _preco_especial from public.contract_rate_terms where id = new.contract_rate_terms_id;
      elsif _operation_terms_id is not null then
        select agreed_amount into _preco_especial from public.operation_terms where id = _operation_terms_id;
      end if;
      select daily_cost into _custo_especial from public.employee_cost_terms where id = _employee_terms_id;
    end if;
    if _preco_especial is null or _custo_especial is null then
      raise exception 'Dia especial sem preço comercial ou custo vigente comprovado.' using errcode = 'P0002';
    end if;
  end if;

  if _legado030 then
    -- 030, sem alteração -------------------------------------------------------------------------
    -- CUSTO (029): excedente à jornada, após tolerância, em minutos exatos.
    _excess   := _worked - _planned_efetivo;
    _overtime := case
      when _excess > coalesce(_ot_tolerance_min, 0) then _excess else 0
    end;
    _ot_horas := _overtime / 60.0;
    _base_cost := case
      when _completo and _worked < _planned_efetivo
        then _daily_cost * _worked / _planned_efetivo
      else _daily_cost
    end;

    -- COBRANÇA (B8.15): jornada de referência (sábado, se o contrato definir), proporcional abaixo
    -- dela e hora extra arredondada no dia (modo diario) ou bruta (modo acumulado).
    _planned_cob := case
      when _dia = 'sabado' and _sabado_horas is not null then _sabado_horas * 60
      else _planned_efetivo
    end;
    _base_cob := case
      when _completo and _worked < _planned_cob then _daily_rate * _worked / _planned_cob
      else _daily_rate
    end;
    _excesso_cob := greatest(_worked - _planned_cob, 0);
    _ot_cob := case
      when _modo = 'acumulado' then _excesso_cob
      when _excesso_cob > coalesce(_ot_tolerance_min, 0)
        then public.arredondar_minutos_extras(_excesso_cob::integer)
      else 0
    end;

    _billed := round((( _base_cob + (_ot_cob / 60.0) * _ot_hour_rate) * 100)::numeric) / 100;

    -- PAGAMENTO no feriado (B8.15): horas trabalhadas × custo-hora × fator, quando o contrato define.
    if _dia = 'feriado' and _fator_feriado is not null and _completo then
      _cost := round(((( _worked / 60.0) * (_daily_cost / _shift_hours_efetivo) * _fator_feriado) * 100)::numeric) / 100;
    else
      _cost := round((( _base_cost + _ot_horas * _ot_cost_hour_rate) * 100)::numeric) / 100;
    end if;

    _calc_version := null;
    _c_base := null;
    _c_ot := null;
    _c_special := null;
  else
    -- Adicional diário (FIN-PR-08): fora da base da HE e do valor-hora; preservado quando o
    -- apontamento é recalculado. Só definir_bonus_do_apontamento o grava (nasce 0).
    _bonus := case when tg_op = 'UPDATE' then coalesce(old.additional_amount, 0) else 0 end;
    -- Núcleo V2 (035): jornada de 8 h líquidas, divisor 8, HE diária 15/45, sábado de 4 h.
    -- Custo-hora acordado ausente: custo diário ÷ 8, sem fator (decidido pelo núcleo).
    _ot_hour_rate := round((_daily_rate::numeric / 8) * round(_ot_factor_efetivo::numeric, 2), 2)::double precision;
    select * into _n
      from public.nucleo_componentes_v2(
        new.status::text,
        _dia,
        new.check_in,
        new.check_out,
        coalesce(new.break_minutes, 0),
        round(coalesce(_preco_especial, _daily_rate::numeric) * 100)::bigint,
        round(round(_ot_factor_efetivo::numeric, 2) * 100)::integer,
        200,
        round(coalesce(_ot_tolerance_min, 0))::integer,
        _modo,
        _modo_especial,
        round(_bonus * 100)::bigint,
        round(coalesce(_custo_especial, _daily_cost::numeric) * 100)::bigint,
        case when _ot_hourly is not null then round(_ot_hourly * 100)::bigint end);

    _worked        := _n.minutos_trabalhados;
    _overtime      := _n.he_minutos_pagos;
    _ot_cob        := _n.he_minutos_cobrados;
    _billed        := _n.total_centavos::numeric / 100;
    _cost          := _n.custo_total_centavos::numeric / 100;
    _c_base        := _n.base_centavos::numeric / 100;
    _c_ot          := _n.he_centavos::numeric / 100;
    _c_special     := _n.especial_centavos::numeric / 100;
    _c_adic        := _n.adicional_centavos::numeric / 100;
    _calc_version  := 2;
  end if;

  new.worked_minutes          := _worked::integer;
  new.overtime_minutes        := _overtime::integer;
  new.billed_overtime_minutes := _ot_cob::integer;
  new.day_kind_snapshot       := _dia;
  new.daily_rate_snapshot     := _daily_rate::numeric;
  new.ot_hour_rate_snapshot   := _ot_hour_rate::numeric;
  new.daily_cost_snapshot     := _daily_cost::numeric;
  new.ot_hourly_cost_snapshot := _ot_hourly;
  new.billed_amount           := _billed;
  new.cost_amount             := _cost;
  new.billed_base_amount      := _c_base;
  new.billed_overtime_amount  := _c_ot;
  new.billed_special_amount   := _c_special;
  new.additional_amount       := _c_adic;
  new.calc_version            := _calc_version;

  new.terms_origin           := _origem;
  new.contract_terms_id      := _contract_terms_id;
  new.operation_terms_id     := _operation_terms_id;
  new.employee_cost_terms_id := _employee_terms_id;

  return new;
end;
$function$;

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
    'funcoes_turno', true,
    -- FIN-PR-07 (040): função e período do turno gravados por apontamento (snapshots protegidos).
    'snapshots_funcao_periodo', true,
    -- FIN-PR-07 (041): tarifas por contrato + função + período; `resolucao_tarifas` = ligada E motor ligado.
    'tarifas_por_funcao', true,
    'resolucao_tarifas', public.resolucao_de_tarifas_ativa(),
    -- FIN-PR-08 (042): diária individual por colaborador + contrato e adicional diário (bônus).
    'diaria_individual', true,
    'bonus_diario', true,
    'dias_especiais_v2', true,
    'calendario_territorial', true);
end;
$function$;

-- Novas funções internas não são endpoints; RPCs administrativas conferem papel e piso MFA.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as assinatura,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
 ('calendario_uf_do_ibge','calendario_fonte_oficial','calendario_territorio_valido','proteger_lastro_territorial','catalogar_municipio','registrar_local_operacao','registrar_feriado_territorial','confirmar_cobertura_calendario','aposentar_cobertura_calendario','calendario_da_operacao_interno','consultar_calendario_operacao','segmentar_jornada_civil','proteger_snapshot_territorial','proteger_data_territorial_folha')
 or p.pronamespace='public'::regnamespace and p.proname='motor_tipo_do_dia' and p.pronargs=2 loop
  execute format('alter function %s owner to postgres',f.assinatura);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,bslog_rpc_operacional',f.assinatura);
  if f.proname in('catalogar_municipio','registrar_local_operacao','registrar_feriado_territorial','confirmar_cobertura_calendario','aposentar_cobertura_calendario','consultar_calendario_operacao') then
   execute format('grant execute on function %s to authenticated',f.assinatura);
  end if;
 end loop;
end; $$;
commit;
