-- FIN-PR-11B: teste transacional, exclusivo do Supabase local descartável.
-- RED intencional no baseline 044: a RPC pública ainda não existe.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.registrar_servico_container(jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'FIN11B feature missing: registrar_servico_container(jsonb,uuid,text)';
  END IF;
  IF to_regprocedure('public.cancelar_servico_container(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'FIN11B feature missing: cancelar_servico_container(uuid,text)';
  END IF;
END;
$$;

create temporary table _checks (caso text) on commit drop;
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception 'FIN11B %: esperado %, obtido %', caso, esperado, obtido;
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
    if desfazer then raise exception using errcode='ZX045'; end if;
  exception
    when sqlstate 'ZX045' then null;
    when others then
      set local role postgres;
      return 'erro '||sqlstate;
  end;
  set local role postgres;
  return coalesce(r,'nulo');
end; $$;
create function pg_temp.claims(ator text default 'a1', nivel text default 'aal1') returns jsonb language sql as $$
  select jsonb_build_object('sub','5c450000-0000-4000-8000-0000000000'||ator,
    'role','authenticated','aal',nivel,'session_id','ec450000-0000-4000-8000-0000000000'||ator)
$$;
create function pg_temp.adm(comando text) returns text language sql as $$
  select pg_temp.medir('authenticated',pg_temp.claims(),comando)
$$;
create temporary table _ids(k text primary key,id uuid not null) on commit drop;
grant select on _ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from _ids where _ids.k=$1 $$;
create function pg_temp.emp(n integer) returns uuid language sql as $$
  select ('5c45f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.cli(n integer) returns uuid language sql as $$
  select ('5c45c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.payload(altera jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('clienteId',pg_temp.cli(1),'operacaoId',null,
    'solicitadoEm','2026-02-03','executadoEm','2026-02-03',
    'descricao','Descarga sintética FIN11B','quantidade',3,'receitaCentavos',10001,
    'custoTotalCentavos',3003,'referencia','ORDEM-SINTETICA-045','modalidadeCusto','total_distribuido',
    'competenciaCobranca',null,'participantes',jsonb_build_array(
      jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1001),
      jsonb_build_object('colaboradorId',pg_temp.emp(2),'custoCentavos',2002))) || altera
$$;
-- GATE-FIN-02 (052): o registro antigo de contêiner é DADO HISTÓRICO de fixture; desde a 052 a RPC
-- não é executável por authenticated. A fixture chama a função como a dona (postgres), com as claims do
-- admin: dentro dela (SECURITY DEFINER) nada muda — mesma guarda, mesmos gatilhos, mesma trilha.
create function pg_temp.dono(comando text) returns text language sql as $$
  select pg_temp.medir('postgres',pg_temp.claims(),comando)
$$;
create function pg_temp.registrar(dados jsonb, chave uuid default gen_random_uuid(), motivo text default 'Registro sintético 045')
returns text language sql as $$
  select pg_temp.dono(format('select public.registrar_servico_container(%L::jsonb,%L::uuid,%L)::text',dados,chave,motivo))
$$;
create function pg_temp.salvar(k text, dados jsonb, chave uuid default gen_random_uuid()) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.registrar(dados,chave);
  if r !~ '^[0-9a-f-]{36}$' then raise exception 'Preparo FIN11B % falhou: %',k,r; end if;
  insert into _ids values(k,r::uuid);
end; $$;
create function pg_temp.cancelar(k text, motivo text default 'Cancelamento sintético 045') returns text language sql as $$
  select pg_temp.adm(format('select public.cancelar_servico_container(%L::uuid,%L)',pg_temp.id(k),motivo))
$$;
create function pg_temp.faturar(k text, cliente integer, inicio date, fim date) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.adm(format('select (public.gerar_fatura(%L::uuid,%L::date,%L::date)).id::text',pg_temp.cli(cliente),inicio,fim));
  if r !~ '^[0-9a-f-]{36}$' then raise exception 'Fatura FIN11B % falhou: %',k,r; end if;
  insert into _ids values(k,r::uuid);
end; $$;

-- Contas/sessões exclusivamente sintéticas. a4 tem TOTP verificado; a3 não tem papel.
insert into auth.users(id) values
 ('5c450000-0000-4000-8000-0000000000a1'),('5c450000-0000-4000-8000-0000000000a2'),
 ('5c450000-0000-4000-8000-0000000000a3'),('5c450000-0000-4000-8000-0000000000a4');
insert into auth.sessions(id,user_id,not_after)
 select ('ec450000-0000-4000-8000-0000000000a'||n)::uuid,
        ('5c450000-0000-4000-8000-0000000000a'||n)::uuid,null from generate_series(1,4) n;
insert into public.user_roles(user_id,role) values
 ('5c450000-0000-4000-8000-0000000000a1','admin'),
 ('5c450000-0000-4000-8000-0000000000a2','operacional'),
 ('5c450000-0000-4000-8000-0000000000a4','admin');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,friendly_name,created_at,updated_at) values
 ('5c450000-0000-4000-8000-0000000000f4','5c450000-0000-4000-8000-0000000000a4',
  'totp','verified','SINTETICO_NAO_UTILIZAVEL','MFA_TESTE_045',now(),now());
insert into public.clients(id,name) select pg_temp.cli(n),'CLIENTE-SINTETICO-045-'||n from generate_series(1,4) n;
insert into public.employees(id,name,daily_cost) select pg_temp.emp(n),'COLAB-SINTETICO-045-'||n,80 from generate_series(1,3) n;
insert into public.employee_cost_terms(employee_id,valid_from,daily_cost,active,origin,reason)
 select pg_temp.emp(n),'2026-01-01',80,true,'informada','Fixture sintética 045' from generate_series(1,3) n;
insert into public.operations(id,client_id,name,agreed_amount) values
 ('5c45e000-0000-4000-8000-000000000001',pg_temp.cli(2),'MISTA-045',200),
 ('5c45e000-0000-4000-8000-000000000002',pg_temp.cli(4),'OUTRO-CLIENTE-045',200);
insert into public.operation_terms(operation_id,valid_from,agreed_amount,active,origin,reason) values
 ('5c45e000-0000-4000-8000-000000000001','2026-01-01',200,true,'informada','Fixture sintética 045'),
 ('5c45e000-0000-4000-8000-000000000002','2026-01-01',200,true,'informada','Fixture sintética 045');
insert into public.shifts(id,operation_id,name,start_time,end_time,break_minutes) values
 ('5c45a000-0000-4000-8000-000000000001','5c45e000-0000-4000-8000-000000000001','TURNO-045','06:00','15:00',60);
set constraints all immediate;
select pg_temp.assert_eq('motor de vigência ligado para fixture',
 pg_temp.adm($q$select public.alterar_motor_vigencia(true,'Fixture sintética FIN11B')->>'ativo'$q$),'true');
select pg_temp.assert_eq('resolução comercial permanece OFF',public.resolucao_de_tarifas_ativa()::text,'false');
insert into public.timesheets(id,operation_id,shift_id,work_date) values
 ('5c45b000-0000-4000-8000-000000000001','5c45e000-0000-4000-8000-000000000001','5c45a000-0000-4000-8000-000000000001','2026-02-03');
insert into public.timesheet_entries(id,timesheet_id,employee_id,status,check_in,check_out,break_minutes) values
 ('5c45b100-0000-4000-8000-000000000001','5c45b000-0000-4000-8000-000000000001',pg_temp.emp(3),'present','06:00','15:00',60);
create temporary table _off on commit drop as
 select to_jsonb(te) as snapshot from public.timesheet_entries te where id='5c45b100-0000-4000-8000-000000000001';
select pg_temp.assert_eq('OFF mantém receita200/custo80 da diária existente',
 (select billed_amount::text||'|'||cost_amount::text from public.timesheet_entries where id='5c45b100-0000-4000-8000-000000000001'),'200.00|80.00');

-- FUNC-01: a fixture principal agora pede e executa no mesmo dia. Os testes de
-- replay, auditoria, valores, cancelamento, fatura e permissões abaixo cobrem essa regra.
select pg_temp.assert_eq('normalizador aceita pedido no mesmo dia',
 public.normalizar_payload_container(pg_temp.payload())->>'solicitadoEm','2026-02-03');
select pg_temp.assert_eq('pedido anterior à execução continua válido',
 public.normalizar_payload_container(pg_temp.payload('{"solicitadoEm":"2026-02-02"}'))->>'solicitadoEm','2026-02-02');

-- Validação de dados não depende do adaptador: chamadas diretas à RPC.
do $$
declare c record; antes text;
begin
 select count(*)||'|'||(select count(*) from public.billing_additionals)||'|'||(select count(*) from public.container_service_audit)
 into antes from public.container_services;
 for c in select * from (values
  ('quantidade zero','{"quantidade":0}'::jsonb),
  ('quantidade fracionária','{"quantidade":1.5}'),
  ('quantidade string','{"quantidade":"3"}'),
  ('receita fracionária em centavos','{"receitaCentavos":100.01}'),
  ('receita string','{"receitaCentavos":"10001"}'),
  ('receita negativa','{"receitaCentavos":-1}'),
  ('receita zero','{"receitaCentavos":0}'),
  ('receita excede numeric12,2','{"receitaCentavos":1000000000000}'),
  ('custo total excede numeric12,2','{"custoTotalCentavos":1000000000000}'),
  ('soma do rateio diverge','{"custoTotalCentavos":3002}'),
  ('solicitação dois dias depois','{"solicitadoEm":"2026-02-05"}'),
  ('solicitação posterior','{"solicitadoEm":"2026-02-04"}'),
  ('data civil inexistente','{"solicitadoEm":"2026-02-30"}'),
  ('sem participantes','{"participantes":[]}'),
  ('sem descrição','{"descricao":"  "}'),
  ('modo inexistente','{"modalidadeCusto":"automatico"}'),
  ('campo financeiro não permitido','{"paid":true}'),
  ('competência parcial','{"competenciaCobranca":{"inicio":"2026-02-02","fim":"2026-02-15"}}'),
  ('competência incompleta','{"competenciaCobranca":{"inicio":"2026-02-01"}}'),
  ('operação de outro cliente','{"operacaoId":"5c45e000-0000-4000-8000-000000000002"}')
 ) as x(caso,alteracao) loop
  perform pg_temp.assert_eq('rejeita '||c.caso,pg_temp.registrar(pg_temp.payload(c.alteracao)),'erro 22023');
 end loop;
 perform pg_temp.assert_eq('rejeita colaborador repetido',pg_temp.registrar(pg_temp.payload(jsonb_build_object('participantes',
  jsonb_build_array(jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1001),
                    jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',2002))))),'erro 22023');
 perform pg_temp.assert_eq('rejeita custo individual negativo',pg_temp.registrar(pg_temp.payload(jsonb_build_object('participantes',
  jsonb_build_array(jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',-1))))),'erro 22023');
 perform pg_temp.assert_eq('rejeita custo individual fracionário',pg_temp.registrar(pg_temp.payload(jsonb_build_object('participantes',
  jsonb_build_array(jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1.5))))),'erro 22023');
 perform pg_temp.assert_eq('rejeita chave extra no participante',pg_temp.registrar(pg_temp.payload(jsonb_build_object('participantes',
  jsonb_build_array(jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',3003,'pago',true))))),'erro 22023');
 perform pg_temp.assert_eq('cliente inexistente',pg_temp.registrar(pg_temp.payload(jsonb_build_object('clienteId',pg_temp.cli(9)))),'erro P0002');
 perform pg_temp.assert_eq('colaborador inexistente',pg_temp.registrar(pg_temp.payload(jsonb_build_object('participantes',
  jsonb_build_array(jsonb_build_object('colaboradorId',pg_temp.emp(9),'custoCentavos',3003))))),'erro P0002');
 perform pg_temp.assert_eq('motivo obrigatório',pg_temp.registrar(pg_temp.payload(),gen_random_uuid(),'   '),'erro 22023');
 perform pg_temp.assert_eq('chave obrigatória',pg_temp.registrar(pg_temp.payload(),null),'erro 22023');
 perform pg_temp.assert_eq('validações não deixam receita ou auditoria parcial',
  (select count(*)||'|'||(select count(*) from public.billing_additionals)||'|'||(select count(*) from public.container_service_audit)
   from public.container_services),antes);
end; $$;

-- Registro atômico: receita100,01 e custos10,01+20,02 independentes da quantidade3.
select pg_temp.salvar('principal',pg_temp.payload(),'5c45d000-0000-4000-8000-000000000001');
select pg_temp.assert_eq('quantidade e dinheiro exatos no serviço',
 (select quantity||'|'||revenue_cents||'|'||cost_total_cents from public.container_services where id=pg_temp.id('principal')),'3|10001|3003');
select pg_temp.assert_eq('custos por colaborador preservam centavos',
 (select string_agg(employee_id::text||':'||cost_cents,'|' order by employee_id) from public.container_service_participants where service_id=pg_temp.id('principal')),
 pg_temp.emp(1)::text||':1001|'||pg_temp.emp(2)::text||':2002');
select pg_temp.assert_eq('receita usa um único adicional100,01 sem gerar diária',
 (select a.amount::text||'|'||(select count(*) from public.container_services s2 where s2.billing_additional_id=a.id)||'|'||
   (select count(*) from public.timesheet_entries where employee_id in (pg_temp.emp(1),pg_temp.emp(2)))
  from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id where s.id=pg_temp.id('principal')),'100.01|1|0');
select pg_temp.assert_eq('registro audita ator motivo e dados',
 (select (count(*)=1 and bool_and(actor_id='5c450000-0000-4000-8000-0000000000a1'::uuid and reason='Registro sintético 045' and after_data is not null))::text
  from public.container_service_audit where service_id=pg_temp.id('principal') and action='registered'),'true');
select pg_temp.assert_eq('retry idêntico retorna o mesmo UUID',
 pg_temp.registrar(pg_temp.payload(),'5c45d000-0000-4000-8000-000000000001'),pg_temp.id('principal')::text);
select pg_temp.assert_eq('retry com participantes reordenados é idêntico',
 pg_temp.registrar(pg_temp.payload(jsonb_build_object('participantes',jsonb_build_array(
  jsonb_build_object('colaboradorId',pg_temp.emp(2),'custoCentavos',2002),
  jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1001)))),'5c45d000-0000-4000-8000-000000000001'),pg_temp.id('principal')::text);
select pg_temp.assert_eq('retry com valor divergente bloqueia',
 pg_temp.registrar(pg_temp.payload('{"receitaCentavos":10002}'),'5c45d000-0000-4000-8000-000000000001'),'erro 23505');
select pg_temp.assert_eq('retry não duplica serviço participantes receita ou trilha',
 (select count(*)||'|'||(select count(*) from public.container_service_participants)||'|'||
   (select count(*) from public.billing_additionals)||'|'||(select count(*) from public.container_service_audit)
 from public.container_services),'1|2|1|1');

-- As duas RPCs repetem autorização e piso MFA; sondas aceitas são desfeitas.
do $$
declare ident record; comando text; obtido text; esperado text; rpc text; claims jsonb;
begin
 for ident in select * from (values
  ('admin sem MFA AAL1','authenticated','a1','aal1',true),
  ('admin com MFA AAL1','authenticated','a4','aal1',false),
  ('admin com MFA AAL2','authenticated','a4','aal2',true),
  ('operacional AAL1','authenticated','a2','aal1',false),
  ('operacional AAL2','authenticated','a2','aal2',false),
  ('sem papel','authenticated','a3','aal1',false),
  ('sessão ausente','authenticated','a5','aal1',false),
  ('claim AAL ausente','authenticated','a1',null,false),
  ('anon','anon',null,null,false)
 ) as t(nome,papel,ator,nivel,permitido) loop
  claims:=case when ident.papel='anon' then '{"role":"anon"}'::jsonb else pg_temp.claims(ident.ator,ident.nivel) end;
  foreach rpc in array array['registrar','cancelar'] loop
   comando:=case when rpc='registrar' then format('select public.registrar_servico_container(%L::jsonb,%L::uuid,%L)::text',
    pg_temp.payload(),gen_random_uuid(),'Sonda sintética segurança')
    else format('select public.cancelar_servico_container(%L::uuid,%L)',pg_temp.id('principal'),'Sonda sintética cancelamento') end;
   obtido:=pg_temp.medir(ident.papel,claims,comando,true);
   if ident.permitido then
    perform pg_temp.assert_eq(rpc||' permite '||ident.nome,
      (case when rpc='registrar' then obtido ~ '^[0-9a-f-]{36}$' else obtido='' end)::text,'true');
   else
    perform pg_temp.assert_eq(rpc||' bloqueia '||ident.nome,(obtido in ('erro 42501','erro 28000'))::text,'true');
   end if;
  end loop;
 end loop;
end; $$;

-- DML direto não substitui RPC, inclusive para admin autenticado.
select pg_temp.assert_eq('admin não atualiza serviço diretamente',
 pg_temp.adm(format('update public.container_services set quantity=99 where id=%L',pg_temp.id('principal'))),'erro 42501');
select pg_temp.assert_eq('admin não exclui serviço diretamente',
 pg_temp.adm(format('delete from public.container_services where id=%L',pg_temp.id('principal'))),'erro 42501');
select pg_temp.assert_eq('admin não atualiza custo diretamente',
 pg_temp.adm(format('update public.container_service_participants set cost_cents=0 where service_id=%L',pg_temp.id('principal'))),'erro 42501');
select pg_temp.assert_eq('admin não apaga auditoria',
 pg_temp.adm(format('delete from public.container_service_audit where service_id=%L',pg_temp.id('principal'))),'erro 42501');
select pg_temp.assert_eq('sem grant INSERT UPDATE DELETE TRUNCATE nas três tabelas',
 (select bool_and(not has_table_privilege('authenticated',t,p))::text
  from unnest(array['public.container_services','public.container_service_participants','public.container_service_audit']) t
  cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p),'true');
select pg_temp.assert_eq('operacional não lê valores financeiros diretamente',
 pg_temp.medir('authenticated',pg_temp.claims('a2'), 'select count(*)::text from public.container_services'),'0');
select pg_temp.assert_eq('admin lê serviço com piso MFA satisfeito',
 pg_temp.adm('select count(*)::text from public.container_services'),'1');
select pg_temp.assert_eq('admin com MFA pendente não lê serviço',
 pg_temp.medir('authenticated',pg_temp.claims('a4','aal1'),'select count(*)::text from public.container_services'),'0');

-- A RPC legada não pode cancelar isoladamente a receita de um container ativo.
select pg_temp.assert_eq('cancelar adicional vinculado exige fluxo container',
 pg_temp.adm(format('select public.cancelar_adicional(%L::uuid,%L)',
  (select billing_additional_id from public.container_services where id=pg_temp.id('principal')),'Tentativa legado sintética')),'erro 42501');
select pg_temp.assert_eq('tentativa legada conserva serviço e receita ativos',
 (select (s.canceled_at is null and a.canceled_at is null)::text from public.container_services s
 join public.billing_additionals a on a.id=s.billing_additional_id where s.id=pg_temp.id('principal')),'true');

-- Cancelamento não destrói custo, receita nem auditoria, e não fatura o cancelado.
select pg_temp.salvar('cancelado',pg_temp.payload('{"referencia":"CANCELAR-045"}'),'5c45d000-0000-4000-8000-000000000002');
select pg_temp.assert_eq('cancelamento antes de faturar permitido',pg_temp.cancelar('cancelado'),'');
select pg_temp.assert_eq('cancelamento preserva custo e cancela a receita',
 (select (s.canceled_at is not null and a.canceled_at is not null and a.invoice_id is null and s.cost_total_cents=3003 and
    (select count(*) from public.container_service_participants p where p.service_id=s.id)=2)::text
  from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id where s.id=pg_temp.id('cancelado')),'true');
select pg_temp.assert_eq('cancelamento tem before after ator motivo',
 (select (count(*)=1 and bool_and(before_data is not null and after_data is not null and
   actor_id='5c450000-0000-4000-8000-0000000000a1'::uuid and reason='Cancelamento sintético 045'))::text
  from public.container_service_audit where service_id=pg_temp.id('cancelado') and action='canceled'),'true');
select pg_temp.assert_eq('cancelamento repetido é recusado',pg_temp.cancelar('cancelado'),'erro 55000');
select pg_temp.assert_eq('retry após cancelamento só retorna o original',
 pg_temp.registrar(pg_temp.payload('{"referencia":"CANCELAR-045"}'),'5c45d000-0000-4000-8000-000000000002'),pg_temp.id('cancelado')::text);
select pg_temp.assert_eq('cancelamento inexistente não produz trilha',
 pg_temp.adm($q$select public.cancelar_servico_container('5c45d000-0000-4000-8000-000000000099','Cancelamento sintético')$q$),'erro P0002');

-- Competência de cobrança pode preceder a execução; client3 só tem container.
select pg_temp.salvar('antecipado',pg_temp.payload(jsonb_build_object('clienteId',pg_temp.cli(3),
 'competenciaCobranca',jsonb_build_object('inicio','2026-01-16','fim','2026-01-31'))));
select pg_temp.assert_eq('competência preservada na receita038',
 (select a.period_start||'|'||a.billing_period_start||'|'||a.billing_period_end
 from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id where s.id=pg_temp.id('antecipado')),
 '2026-02-03|2026-01-16|2026-01-31');
select pg_temp.faturar('fatura-antecipado',3,'2026-01-16','2026-01-31');
select pg_temp.assert_eq('fatura somente container: receita100,01 custo30,03 sem diárias',
 (select total_amount||'|'||total_cost||'|'||total_dailies||'|'||total_overtime from public.invoices where id=pg_temp.id('fatura-antecipado')),
 '100.01|30.03|0.00|0.00');
select pg_temp.assert_eq('item avulso único mantém total sem inventar tarifa unitária',
 (select count(*)||'|'||sum(amount)||'|'||min(quantity)||'|'||min(kind)
  from public.invoice_items where invoice_id=pg_temp.id('fatura-antecipado')),'1|100.01|1.00|adicional');
select pg_temp.assert_eq('cancelar container faturado bloqueia',pg_temp.cancelar('antecipado'),'erro 55000');
select pg_temp.assert_eq('adicional faturado também não cancela pela API legada',
 pg_temp.adm(format('select public.cancelar_adicional(%L::uuid,%L)',
  (select billing_additional_id from public.container_services where id=pg_temp.id('antecipado')),'Cancelamento bloqueado')),'erro 55000');
select pg_temp.assert_eq('não fatura novamente em competência da execução',
 pg_temp.adm(format('select (public.gerar_fatura(%L::uuid,%L::date,%L::date)).id::text',pg_temp.cli(3),'2026-02-01','2026-02-15')),'erro P0002');

-- Cliente2 combina diária já existente e container. Nenhuma alteração no snapshot.
select pg_temp.salvar('misto',pg_temp.payload(jsonb_build_object('clienteId',pg_temp.cli(2),
 'operacaoId','5c45e000-0000-4000-8000-000000000001','modalidadeCusto','por_pessoa')));
select pg_temp.assert_eq('registrar container não recalcula nem modifica diária OFF',
 (select (to_jsonb(te)=(select snapshot from _off))::text from public.timesheet_entries te where id='5c45b100-0000-4000-8000-000000000001'),'true');
select pg_temp.faturar('fatura-mista',2,'2026-02-01','2026-02-15');
select pg_temp.assert_eq('fatura mista soma receita e custo uma única vez',
 (select total_amount||'|'||total_cost||'|'||total_dailies from public.invoices where id=pg_temp.id('fatura-mista')),'300.01|110.03|1.00');
select pg_temp.assert_eq('faturamento só adiciona invoice_id ao snapshot OFF',
 (select ((to_jsonb(te)-'invoice_id')=((select snapshot from _off)-'invoice_id'))::text
 from public.timesheet_entries te where id='5c45b100-0000-4000-8000-000000000001'),'true');
select pg_temp.assert_eq('fatura mista não incorpora custo de outro cliente',
 (select count(*)::text from public.container_services s join public.billing_additionals a on a.id=s.billing_additional_id
 where a.invoice_id=pg_temp.id('fatura-mista') and s.client_id<>pg_temp.cli(2)),'0');

select pg_temp.faturar('fatura-principal',1,'2026-02-01','2026-02-15');
select pg_temp.assert_eq('cancelado não entra na fatura principal',
 (select total_amount||'|'||total_cost from public.invoices where id=pg_temp.id('fatura-principal')),'100.01|30.03');
select pg_temp.assert_eq('retry após fatura mantém UUID e não cria receita',
 pg_temp.registrar(pg_temp.payload(),'5c45d000-0000-4000-8000-000000000001'),pg_temp.id('principal')::text);
select pg_temp.assert_eq('resolução comercial continua OFF após container e fatura',public.resolucao_de_tarifas_ativa()::text,'false');
select pg_temp.assert_eq('soma dos itens fecha em centavos em todas as faturas045',
 (select bool_and(i.total_amount=(select sum(it.amount) from public.invoice_items it where it.invoice_id=i.id))::text
 from public.invoices i where i.id in (pg_temp.id('fatura-principal'),pg_temp.id('fatura-mista'),pg_temp.id('fatura-antecipado'))),'true');
select 'FIN11B: '||count(*)||' asserções PASS; todas as fixtures serão desfeitas.' as resultado from _checks;
ROLLBACK;
