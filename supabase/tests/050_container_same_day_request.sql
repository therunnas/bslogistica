-- FUNC-01: teste transacional, exclusivo do Supabase local descartável.
-- Executar em 045→050 e em 045→046–049→050; só banco local sintético.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.registrar_servico_container(jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'FUNC01 feature missing: registrar_servico_container(jsonb,uuid,text)';
  END IF;
  IF to_regprocedure('public.cancelar_servico_container(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'FUNC01 feature missing: cancelar_servico_container(uuid,text)';
  END IF;
END;
$$;

create temporary table _checks (caso text) on commit drop;
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception 'FUNC01 %: esperado %, obtido %', caso, esperado, obtido;
  end if;
  insert into _checks values(caso);
end; $$;

create function pg_temp.medir(papel text, claims jsonb, comando text, desfazer boolean default false)
returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', claims::text, true);
  execute format('set local role %I',papel);
  begin
    if lower(ltrim(comando)) ~ '^(select|with)' then execute comando into r;
    else execute comando; end if;
    if desfazer then raise exception using errcode='ZX050'; end if;
  exception
    when sqlstate 'ZX050' then null;
    when others then
      set local role postgres;
      return 'erro '||sqlstate;
  end;
  set local role postgres;
  return coalesce(r,'nulo');
end; $$;
create function pg_temp.claims(ator text default 'a1', nivel text default 'aal1') returns jsonb language sql as $$
  select jsonb_build_object('sub','5c500000-0000-4000-8000-0000000000'||ator,
    'role','authenticated','aal',nivel,'session_id','ec500000-0000-4000-8000-0000000000'||ator)
$$;
create function pg_temp.adm(comando text) returns text language sql as $$
  select pg_temp.medir('authenticated',pg_temp.claims(),comando)
$$;
create temporary table _ids(k text primary key,id uuid not null) on commit drop;
grant select on _ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from _ids where _ids.k=$1 $$;
create function pg_temp.emp(n integer) returns uuid language sql as $$
  select ('5c50f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.cli(n integer) returns uuid language sql as $$
  select ('5c50c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.payload(altera jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('clienteId',pg_temp.cli(1),'operacaoId',null,
    'solicitadoEm','2026-02-03','executadoEm','2026-02-03',
    'descricao','Descarga sintética FUNC01','quantidade',3,'receitaCentavos',10001,
    'custoTotalCentavos',3003,'referencia','ORDEM-SINTETICA-050','modalidadeCusto','total_distribuido',
    'competenciaCobranca',null,'participantes',jsonb_build_array(
      jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1001),
      jsonb_build_object('colaboradorId',pg_temp.emp(2),'custoCentavos',2002))) || altera
$$;
create function pg_temp.registrar(dados jsonb, chave uuid default gen_random_uuid(), motivo text default 'Registro sintético 050')
returns text language sql as $$
  select pg_temp.medir('postgres',pg_temp.claims(),format('select public.registrar_servico_container(%L::jsonb,%L::uuid,%L)::text',dados,chave,motivo))
$$;
create function pg_temp.salvar(k text, dados jsonb, chave uuid default gen_random_uuid()) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.registrar(dados,chave);
  if r !~ '^[0-9a-f-]{36}$' then raise exception 'Preparo FUNC01 % falhou: %',k,r; end if;
  insert into _ids values(k,r::uuid);
end; $$;
create function pg_temp.cancelar(k text, motivo text default 'Cancelamento sintético 050') returns text language sql as $$
  select pg_temp.adm(format('select public.cancelar_servico_container(%L::uuid,%L)',pg_temp.id(k),motivo))
$$;
create function pg_temp.faturar(k text, cliente integer, inicio date, fim date) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.adm(format('select (public.gerar_fatura(%L::uuid,%L::date,%L::date)).id::text',pg_temp.cli(cliente),inicio,fim));
  if r !~ '^[0-9a-f-]{36}$' then raise exception 'Fatura FUNC01 % falhou: %',k,r; end if;
  insert into _ids values(k,r::uuid);
end; $$;

-- Contas/sessões exclusivamente sintéticas. a4 tem TOTP verificado; a3 não tem papel.
insert into auth.users(id) values
 ('5c500000-0000-4000-8000-0000000000a1'),('5c500000-0000-4000-8000-0000000000a2'),
 ('5c500000-0000-4000-8000-0000000000a3'),('5c500000-0000-4000-8000-0000000000a4');
insert into auth.sessions(id,user_id,not_after)
 select ('ec500000-0000-4000-8000-0000000000a'||n)::uuid,
        ('5c500000-0000-4000-8000-0000000000a'||n)::uuid,null from generate_series(1,4) n;
insert into public.user_roles(user_id,role) values
 ('5c500000-0000-4000-8000-0000000000a1','admin'),
 ('5c500000-0000-4000-8000-0000000000a2','operacional'),
 ('5c500000-0000-4000-8000-0000000000a4','admin');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,friendly_name,created_at,updated_at) values
 ('5c500000-0000-4000-8000-0000000000f4','5c500000-0000-4000-8000-0000000000a4',
  'totp','verified','SINTETICO_NAO_UTILIZAVEL','MFA_TESTE_050',now(),now());
insert into public.clients(id,name) select pg_temp.cli(n),'CLIENTE-SINTETICO-050-'||n from generate_series(1,4) n;
insert into public.employees(id,name,daily_cost) select pg_temp.emp(n),'COLAB-SINTETICO-050-'||n,80 from generate_series(1,3) n;
insert into public.employee_cost_terms(employee_id,valid_from,daily_cost,active,origin,reason)
 select pg_temp.emp(n),'2026-01-01',80,true,'informada','Fixture sintética 050' from generate_series(1,3) n;
insert into public.operations(id,client_id,name,agreed_amount) values
 ('5c50e000-0000-4000-8000-000000000001',pg_temp.cli(2),'MISTA-050',200),
 ('5c50e000-0000-4000-8000-000000000002',pg_temp.cli(4),'OUTRO-CLIENTE-050',200);
insert into public.operation_terms(operation_id,valid_from,agreed_amount,active,origin,reason) values
 ('5c50e000-0000-4000-8000-000000000001','2026-01-01',200,true,'informada','Fixture sintética 050'),
 ('5c50e000-0000-4000-8000-000000000002','2026-01-01',200,true,'informada','Fixture sintética 050');
insert into public.shifts(id,operation_id,name,start_time,end_time,break_minutes) values
 ('5c50a000-0000-4000-8000-000000000001','5c50e000-0000-4000-8000-000000000001','TURNO-050','06:00','15:00',60);
set constraints all immediate;
select pg_temp.assert_eq('motor de vigência ligado para fixture',
 pg_temp.adm($q$select public.alterar_motor_vigencia(true,'Fixture sintética FUNC01')->>'ativo'$q$),'true');
select pg_temp.assert_eq('resolução comercial permanece OFF',public.resolucao_de_tarifas_ativa()::text,'false');
insert into public.timesheets(id,operation_id,shift_id,work_date) values
 ('5c50b000-0000-4000-8000-000000000001','5c50e000-0000-4000-8000-000000000001','5c50a000-0000-4000-8000-000000000001','2026-02-03');
insert into public.timesheet_entries(id,timesheet_id,employee_id,status,check_in,check_out,break_minutes) values
 ('5c50b100-0000-4000-8000-000000000001','5c50b000-0000-4000-8000-000000000001',pg_temp.emp(3),'present','06:00','15:00',60);
create temporary table _off on commit drop as
 select to_jsonb(te) as snapshot from public.timesheet_entries te where id='5c50b100-0000-4000-8000-000000000001';
select pg_temp.assert_eq('OFF mantém receita200/custo80 da diária existente',
 (select billed_amount::text||'|'||cost_amount::text from public.timesheet_entries where id='5c50b100-0000-4000-8000-000000000001'),'200.00|80.00');


-- O CHECK precisa mudar de verdade, não apenas o formulário ou o normalizador.
select pg_temp.assert_eq('CHECK permite datas iguais',
 (select count(*)::text from pg_constraint where conrelid='public.container_services'::regclass
  and conname='container_services_request_execution_check'
  and pg_get_expr(conbin,conrelid)='(requested_on <= executed_on)'),'1');
select pg_temp.assert_eq('normalizador conserva immutable e invoker',
 (select (provolatile='i' and not prosecdef)::text from pg_proc
  where oid='public.normalizar_payload_container(jsonb)'::regprocedure),'true');
select pg_temp.assert_eq('normalizador não ganhou grant para authenticated',
 has_function_privilege('authenticated','public.normalizar_payload_container(jsonb)','EXECUTE')::text,'false');
select pg_temp.assert_eq('pedido anterior continua válido',
 public.normalizar_payload_container(pg_temp.payload('{"solicitadoEm":"2026-02-02"}'))->>'solicitadoEm','2026-02-02');
select pg_temp.assert_eq('mesmo dia bissexto válido',
 public.normalizar_payload_container(pg_temp.payload('{"solicitadoEm":"2028-02-29","executadoEm":"2028-02-29"}'))->>'executadoEm','2028-02-29');

do $$
declare data text; campo text; antes text;
begin
 select count(*)||'|'||(select count(*) from public.billing_additionals)||'|'||(select count(*) from public.container_service_audit)
 into antes from public.container_services;
 foreach campo in array array['solicitadoEm','executadoEm'] loop
  foreach data in array array['2026-02-30','2026-02-29','2026-13-01','2026-2-03','0000-01-01','invalida',''] loop
   perform pg_temp.assert_eq('data inválida em '||campo||':'||data,
    pg_temp.registrar(pg_temp.payload(jsonb_build_object(campo,data))),'erro 22023');
  end loop;
 end loop;
 perform pg_temp.assert_eq('pedido posterior recusado',pg_temp.registrar(pg_temp.payload('{"solicitadoEm":"2026-02-04"}')),'erro 22023');
 perform pg_temp.assert_eq('falhas de data sem gravação parcial',
  (select count(*)||'|'||(select count(*) from public.billing_additionals)||'|'||(select count(*) from public.container_service_audit)
   from public.container_services),antes);
end;
$$;

select pg_temp.salvar('mesmo-dia',pg_temp.payload(),'5c50d000-0000-4000-8000-000000000001');
select pg_temp.assert_eq('registro igual mantém datas, receita e custo',
 (select (requested_on=executed_on and revenue_cents=10001 and cost_total_cents=3003)::text
  from public.container_services where id=pg_temp.id('mesmo-dia')),'true');
select pg_temp.assert_eq('participantes preservam soma e centavos',
 (select (count(*)=2 and sum(cost_cents)=3003)::text from public.container_service_participants where service_id=pg_temp.id('mesmo-dia')),'true');
select pg_temp.assert_eq('receita uma única vez e auditoria com ator',
 (select (a.amount=100.01 and a.invoice_id is null and
   (select count(*) from public.container_service_audit au where au.service_id=s.id and au.action='registered'
    and au.actor_id='5c500000-0000-4000-8000-0000000000a1'::uuid)=1)::text
 from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id
 where s.id=pg_temp.id('mesmo-dia')),'true');
select pg_temp.assert_eq('reenvio da mesma chave retorna original',
 pg_temp.registrar(pg_temp.payload(),'5c50d000-0000-4000-8000-000000000001'),pg_temp.id('mesmo-dia')::text);
select pg_temp.assert_eq('chave igual e payload diferente recusados',
 pg_temp.registrar(pg_temp.payload('{"descricao":"Outro payload sintético"}'),'5c50d000-0000-4000-8000-000000000001'),'erro 23505');
select pg_temp.assert_eq('reenvio não duplica serviço nem trilha',
 (select count(*)||'|'||(select count(*) from public.container_service_audit where service_id=pg_temp.id('mesmo-dia'))
 from public.container_services where id=pg_temp.id('mesmo-dia')),'1|1');

-- As mesmas datas válidas continuam inacessíveis a perfis não autorizados.
do $$
declare ator text; comando text; antes text;
begin
 comando:=format('select public.registrar_servico_container(%L::jsonb,%L::uuid,%L)',pg_temp.payload(),gen_random_uuid(),'Tentativa sintética 050');
 select count(*)::text into antes from public.container_services;
 perform pg_temp.assert_eq('anon negado',pg_temp.medir('anon','{}',comando),'erro 42501');
 foreach ator in array array['a2','a3','a4'] loop
  perform pg_temp.assert_eq('operacional/sem papel/MFA AAL1 negado:'||ator,
   pg_temp.medir('authenticated',pg_temp.claims(ator),comando),'erro 42501');
 end loop;
 perform pg_temp.assert_eq('autorizações não produziram registro',
  (select count(*)::text from public.container_services),antes);
end;
$$;

-- Sem 049: o fluxo atual é cancelar + registrar. Com 049: troca auditada atômica.
select pg_temp.salvar('corrigir-original',pg_temp.payload('{"solicitadoEm":"2026-02-02","referencia":"CORRIGIR-050"}'));
do $$
declare dados jsonb; novo text; comando text;
begin
 dados:=pg_temp.payload('{"descricao":"Correção sintética 050","referencia":"CORRIGIDO-050"}');
 if to_regprocedure('public.corrigir_servico_container(uuid,jsonb,uuid,text)') is not null then
  comando:=format('select public.corrigir_servico_container(%L::uuid,%L::jsonb,%L::uuid,%L)::text',
   pg_temp.id('corrigir-original'),dados,'5c50d000-0000-4000-8000-000000000002','Correção sintética 050');
  novo:=pg_temp.adm(comando);
  perform pg_temp.assert_eq('049 devolve substituto', (novo ~ '^[0-9a-f-]{36}$')::text,'true');
  insert into _ids values('corrigido',novo::uuid);
  perform pg_temp.assert_eq('049 correção idempotente',pg_temp.adm(comando),novo);
  perform pg_temp.assert_eq('049 auditoria vínculo original/substituto',
   (select count(*)::text from public.container_service_audit where service_id=pg_temp.id('corrigir-original')
    and action='corrected' and after_data->>'id'=novo),'1');
  raise notice 'FUNC01: correcao_049 PRESENTE, troca/replay auditados PASS';
 else
  perform pg_temp.assert_eq('045 cancela original antes de recriar',pg_temp.cancelar('corrigir-original'),'');
  perform pg_temp.salvar('corrigido',dados,'5c50d000-0000-4000-8000-000000000002');
  raise notice 'FUNC01: correcao_049 AUSENTE; cancelar e registrar do baseline045 PASS';
 end if;
 perform pg_temp.assert_eq('correção admite solicitação igual à execução',
  (select (requested_on=executed_on and revenue_cents=10001 and cost_total_cents=3003)::text
   from public.container_services where id=pg_temp.id('corrigido')),'true');
 perform pg_temp.assert_eq('original e receita permanecem cancelados',
  (select (s.canceled_at is not null and a.canceled_at is not null)::text from public.container_services s
   join public.billing_additionals a on a.id=s.billing_additional_id where s.id=pg_temp.id('corrigir-original')),'true');
end;
$$;

select pg_temp.salvar('faturado',pg_temp.payload(jsonb_build_object('clienteId',pg_temp.cli(4))));
select pg_temp.faturar('fatura',4,'2026-02-01','2026-02-15');
create temporary table _faturado on commit drop as
 select to_jsonb(s) as snapshot from public.container_services s where id=pg_temp.id('faturado');
select pg_temp.assert_eq('serviço mesmo dia faturado não cancela',pg_temp.cancelar('faturado'),'erro 55000');
do $$
begin
 if to_regprocedure('public.corrigir_servico_container(uuid,jsonb,uuid,text)') is not null then
  perform pg_temp.assert_eq('049 não corrige serviço faturado',
   pg_temp.adm(format('select public.corrigir_servico_container(%L::uuid,%L::jsonb,%L::uuid,%L)',pg_temp.id('faturado'),
    pg_temp.payload(jsonb_build_object('clienteId',pg_temp.cli(4),'descricao','Tentativa faturada 050')),gen_random_uuid(),'Correção faturada sintética')),'erro 55000');
 end if;
end;
$$;
select pg_temp.assert_eq('snapshot faturado intacto',
 (select (to_jsonb(s)=(select snapshot from _faturado))::text from public.container_services s where id=pg_temp.id('faturado')),'true');
select pg_temp.assert_eq('fatura e itens mantêm receita e custo exatos',
 (select (total_amount=100.01 and total_cost=30.03 and total_amount=(select sum(amount) from public.invoice_items where invoice_id=i.id))::text
  from public.invoices i where id=pg_temp.id('fatura')),'true');
select pg_temp.assert_eq('OFF continua sem alteração financeira',
 (select (to_jsonb(te)=(select snapshot from _off))::text from public.timesheet_entries te where id='5c50b100-0000-4000-8000-000000000001'),'true');
select 'FUNC01-050: '||count(*)||' asserções PASS; fixtures sintéticas desfeitas.' as resultado from _checks;
ROLLBACK;
