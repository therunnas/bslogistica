-- FIN-20C: fatura emitida é imutável MESMO sem apontamento (só adicional, só container ou mista).
-- Teste transacional, exclusivo do Supabase local descartável; desfaz todas as fixtures.
--
-- RED no baseline 045: as guardas de fatura (migration 011) só enxergam `timesheet_entries.invoice_id`.
-- Uma fatura cujo lastro é só `billing_additionals` (adicional avulso ou serviço de container) fica
-- editável, e `authenticated`/`service_role` ainda têm INSERT/UPDATE/DELETE direto nas tabelas de fatura.
BEGIN;

create temporary table _checks (caso text) on commit drop;
create temporary table _falhas (caso text, esperado text, obtido text) on commit drop;
-- As asserções registram a falha e SEGUEM, para o RED mostrar todos os casos; o fim da suíte falha se houver alguma.
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    insert into _falhas values (caso, esperado, obtido);
    raise notice 'FALHA %: esperado [%], obtido [%]', caso, esperado, obtido;
  else
    insert into _checks values(caso);
  end if;
end; $$;
-- Compara só o início do resultado (código e começo da mensagem).
create function pg_temp.assert_prefixo(caso text, obtido text, prefixo text) returns void language plpgsql as $$
begin
  if left(coalesce(obtido, '<nulo>'), length(prefixo)) is distinct from prefixo then
    insert into _falhas values (caso, prefixo || '…', obtido);
    raise notice 'FALHA %: esperado começar com [%], obtido [%]', caso, prefixo, obtido;
  else
    insert into _checks values(caso);
  end if;
end; $$;

-- Executa o comando como `papel`, DESFAZ sempre o efeito e devolve 'ok' ou 'erro <sqlstate>: <mensagem>'.
create function pg_temp.tentar(papel text, claims jsonb, comando text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', claims::text, true);
  execute format('set local role %I', papel);
  begin
    execute comando;
    raise exception using errcode = 'ZX046';
  exception
    when sqlstate 'ZX046' then r := 'ok';
    when others then r := 'erro ' || sqlstate || ': ' || left(sqlerrm, 90);
  end;
  set local role postgres;
  return r;
end; $$;
create function pg_temp.claims(ator text default 'a1', nivel text default 'aal1') returns jsonb language sql as $$
  select jsonb_build_object('sub','5c460000-0000-4000-8000-0000000000'||ator,
    'role','authenticated','aal',nivel,'session_id','ec460000-0000-4000-8000-0000000000'||ator)
$$;
create function pg_temp.adm(comando text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', pg_temp.claims()::text, true);
  set local role authenticated;
  begin
    execute comando into r;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate || ': ' || left(sqlerrm, 90);
  end;
  set local role postgres;
  return coalesce(r, 'nulo');
end; $$;
-- Executa uma consulta escalar como `papel` e devolve o texto (ou 'erro <sqlstate>').
create function pg_temp.como(papel text, claims jsonb, comando text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', claims::text, true);
  execute format('set local role %I', papel);
  begin
    execute comando into r;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return coalesce(r, 'nulo');
end; $$;
create temporary table _ids(k text primary key, id uuid not null) on commit drop;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from _ids where _ids.k = $1 $$;
create function pg_temp.emp(n integer) returns uuid language sql as $$ select ('5c46f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.cli(n integer) returns uuid language sql as $$ select ('5c46c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.payload(cliente integer) returns jsonb language sql as $$
  select jsonb_build_object('clienteId',pg_temp.cli(cliente),'operacaoId',null,
    'solicitadoEm','2026-02-02','executadoEm','2026-02-03',
    'descricao','Descarga sintética FIN20C','quantidade',2,'receitaCentavos',12000,
    'custoTotalCentavos',3000,'referencia','ORDEM-SINTETICA-046','modalidadeCusto','total_distribuido',
    'competenciaCobranca',null,'participantes',jsonb_build_array(
      jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1000),
      jsonb_build_object('colaboradorId',pg_temp.emp(2),'custoCentavos',2000)))
$$;
create function pg_temp.guardar(k text, r text) returns void language plpgsql as $$
begin
  if r !~ '^[0-9a-f-]{36}$' then raise exception 'Preparo FIN20C % falhou: %', k, r; end if;
  insert into _ids values(k, r::uuid);
end; $$;
create function pg_temp.adicional(k text, cliente integer, inicio date, fim date, valor numeric) returns void language sql as $$
  select pg_temp.guardar(k, pg_temp.adm(format('select public.registrar_adicional(%L::uuid,%L::date,%L::date,%L,%s)::text',
    pg_temp.cli(cliente), inicio, fim, 'Etiquetagem sintética 046 '||k, valor)))
$$;
create function pg_temp.container(k text, cliente integer) returns void language sql as $$
  select pg_temp.guardar(k, pg_temp.adm(format('select public.registrar_servico_container(%L::jsonb,gen_random_uuid(),%L)::text',
    pg_temp.payload(cliente), 'Registro sintético 046')))
$$;
create function pg_temp.faturar(k text, cliente integer, inicio date, fim date) returns void language sql as $$
  select pg_temp.guardar(k, pg_temp.adm(format('select (public.gerar_fatura(%L::uuid,%L::date,%L::date)).id::text',
    pg_temp.cli(cliente), inicio, fim)))
$$;

-- Contas e sessões exclusivamente sintéticas. a1 admin (sem fator de MFA), a2 operacional.
insert into auth.users(id) values ('5c460000-0000-4000-8000-0000000000a1'),('5c460000-0000-4000-8000-0000000000a2');
insert into auth.sessions(id,user_id,not_after)
 select ('ec460000-0000-4000-8000-0000000000a'||n)::uuid, ('5c460000-0000-4000-8000-0000000000a'||n)::uuid, null from generate_series(1,2) n;
insert into public.user_roles(user_id,role) values
 ('5c460000-0000-4000-8000-0000000000a1','admin'),('5c460000-0000-4000-8000-0000000000a2','operacional');
insert into public.clients(id,name) select pg_temp.cli(n),'CLIENTE-SINTETICO-046-'||n from generate_series(1,3) n;
insert into public.employees(id,name,daily_cost) select pg_temp.emp(n),'COLAB-SINTETICO-046-'||n,80 from generate_series(1,3) n;
insert into public.employee_cost_terms(employee_id,valid_from,daily_cost,active,origin,reason)
 select pg_temp.emp(n),'2026-01-01',80,true,'informada','Fixture sintética 046' from generate_series(1,3) n;
insert into public.operations(id,client_id,name,agreed_amount) values ('5c46e000-0000-4000-8000-000000000001',pg_temp.cli(3),'MISTA-046',200);
insert into public.operation_terms(operation_id,valid_from,agreed_amount,active,origin,reason)
 values ('5c46e000-0000-4000-8000-000000000001','2026-01-01',200,true,'informada','Fixture sintética 046');
insert into public.shifts(id,operation_id,name,start_time,end_time,break_minutes)
 values ('5c46a000-0000-4000-8000-000000000001','5c46e000-0000-4000-8000-000000000001','TURNO-046','06:00','15:00',60);
set constraints all immediate;
select pg_temp.assert_eq('motor de vigência ligado para a fixture',
 pg_temp.adm($q$select public.alterar_motor_vigencia(true,'Fixture sintética FIN20C')->>'ativo'$q$),'true');

-- ===========================================================================
-- Estágio 1: faturas SEM nenhum apontamento (só adicional e só container).
-- ===========================================================================
select pg_temp.adicional('adicional-a', 1, '2026-02-01', '2026-02-15', 50.00);
select pg_temp.container('container-c', 2);
select pg_temp.faturar('fatura-a', 1, '2026-02-01', '2026-02-15');
select pg_temp.faturar('fatura-c', 2, '2026-02-01', '2026-02-15');

select pg_temp.assert_eq('premissa: fatura A não tem apontamento vinculado',
 (select count(*)::text from public.timesheet_entries where invoice_id = pg_temp.id('fatura-a')), '0');
select pg_temp.assert_eq('premissa: fatura C não tem apontamento vinculado',
 (select count(*)::text from public.timesheet_entries where invoice_id = pg_temp.id('fatura-c')), '0');
select pg_temp.assert_eq('premissa: lastro de A é o adicional avulso',
 (select a.invoice_id::text from public.billing_additionals a where a.id = pg_temp.id('adicional-a')), pg_temp.id('fatura-a')::text);
select pg_temp.assert_eq('premissa: lastro de C é o adicional do serviço de container',
 (select a.invoice_id::text from public.container_services s join public.billing_additionals a on a.id = s.billing_additional_id
   where s.id = pg_temp.id('container-c')), pg_temp.id('fatura-c')::text);

-- TRUNCATE em massa: a guarda de 011 só olha apontamento faturado; aqui só há adicionais faturados.
select pg_temp.assert_prefixo('TRUNCATE invoice_items recusado com fatura só de adicionais',
 pg_temp.tentar('postgres', '{}'::jsonb, 'truncate table public.invoice_items'), 'erro 42501');

-- ===========================================================================
-- Estágio 2: fatura MISTA (apontamento + adicional manual + container) e fatura posterior.
-- ===========================================================================
insert into public.timesheets(id,operation_id,shift_id,work_date) values
 ('5c46b000-0000-4000-8000-000000000001','5c46e000-0000-4000-8000-000000000001','5c46a000-0000-4000-8000-000000000001','2026-02-03');
insert into public.timesheet_entries(id,timesheet_id,employee_id,status,check_in,check_out,break_minutes) values
 ('5c46b100-0000-4000-8000-000000000001','5c46b000-0000-4000-8000-000000000001',pg_temp.emp(3),'present','06:00','15:00',60);
select pg_temp.adicional('adicional-m', 3, '2026-02-01', '2026-02-15', 30.00);
select pg_temp.container('container-m', 3);
select pg_temp.faturar('fatura-m', 3, '2026-02-01', '2026-02-15');
select pg_temp.assert_eq('premissa: fatura mista tem apontamento vinculado',
 (select count(*)::text from public.timesheet_entries where invoice_id = pg_temp.id('fatura-m')), '1');

-- ===========================================================================
-- Bateria 1: tentativas no NÍVEL DO GATILHO (executor `postgres`, que ignora GRANT e RLS).
-- Cada fatura, de qualquer lastro, tem de recusar edição, exclusão e mexida nos itens.
-- ===========================================================================
do $$
declare
  f record;
  outra uuid;
begin
  for f in select * from (values ('A só adicional','fatura-a','fatura-c'),('C só container','fatura-c','fatura-a'),('M mista','fatura-m','fatura-a')) x(rotulo,k,outra_k) loop
    outra := pg_temp.id(f.outra_k);
    perform pg_temp.assert_prefixo(f.rotulo||': UPDATE de total recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoices set total_amount = total_amount + 1 where id = %L', pg_temp.id(f.k))),
      'erro 42501: Fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': UPDATE de status recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoices set status = ''draft'' where id = %L', pg_temp.id(f.k))),
      'erro 42501: Fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': UPDATE de notas recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoices set notes = ''adulterada'' where id = %L', pg_temp.id(f.k))),
      'erro 42501: Fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': DELETE da fatura recusado pela guarda de imutabilidade',
      pg_temp.tentar('postgres','{}'::jsonb, format('delete from public.invoices where id = %L', pg_temp.id(f.k))),
      'erro 42501: Fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': UPDATE de item recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoice_items set amount = amount + 1 where invoice_id = %L', pg_temp.id(f.k))),
      'erro 42501: Itens de fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': DELETE de item recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('delete from public.invoice_items where invoice_id = %L', pg_temp.id(f.k))),
      'erro 42501: Itens de fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': INSERT de item forjado recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('insert into public.invoice_items(invoice_id,description,quantity,unit_price,amount,kind) values (%L,''item forjado'',1,1,1,''adicional'')', pg_temp.id(f.k))),
      'erro 42501: Itens de fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': mover item para outra fatura recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoice_items set invoice_id = %L where invoice_id = %L', outra, pg_temp.id(f.k))),
      'erro 42501: Itens de fatura com lastro vinculado');
    perform pg_temp.assert_prefixo(f.rotulo||': mover item de outra fatura para esta recusado',
      pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoice_items set invoice_id = %L where invoice_id = %L', pg_temp.id(f.k), outra)),
      'erro 42501: Itens de fatura com lastro vinculado');
  end loop;
end; $$;

-- ===========================================================================
-- Bateria 2: ESCRITA DIRETA pelos papéis da API. Nenhum deles escreve em fatura: só RPC (gerar_fatura).
-- ===========================================================================
do $$
declare
  f record;
  papel text;
  claims jsonb;
begin
  for papel, claims in select * from (values ('authenticated', pg_temp.claims()), ('service_role', '{}'::jsonb), ('anon', '{}'::jsonb)) x(p,c) loop
    for f in select * from (values ('A','fatura-a'),('C','fatura-c'),('M','fatura-m')) x(rotulo,k) loop
      perform pg_temp.assert_prefixo(papel||' / fatura '||f.rotulo||': UPDATE direto sem privilégio',
        pg_temp.tentar(papel, claims, format('update public.invoices set total_amount = total_amount + 1 where id = %L', pg_temp.id(f.k))),
        'erro 42501: permission denied');
      perform pg_temp.assert_prefixo(papel||' / fatura '||f.rotulo||': DELETE direto sem privilégio',
        pg_temp.tentar(papel, claims, format('delete from public.invoices where id = %L', pg_temp.id(f.k))),
        'erro 42501: permission denied');
      perform pg_temp.assert_prefixo(papel||' / fatura '||f.rotulo||': UPDATE de item direto sem privilégio',
        pg_temp.tentar(papel, claims, format('update public.invoice_items set amount = amount + 1 where invoice_id = %L', pg_temp.id(f.k))),
        'erro 42501: permission denied');
      perform pg_temp.assert_prefixo(papel||' / fatura '||f.rotulo||': DELETE de item direto sem privilégio',
        pg_temp.tentar(papel, claims, format('delete from public.invoice_items where invoice_id = %L', pg_temp.id(f.k))),
        'erro 42501: permission denied');
      perform pg_temp.assert_prefixo(papel||' / fatura '||f.rotulo||': INSERT de item direto sem privilégio',
        pg_temp.tentar(papel, claims, format('insert into public.invoice_items(invoice_id,description,quantity,unit_price,amount,kind) values (%L,''item forjado'',1,1,1,''adicional'')', pg_temp.id(f.k))),
        'erro 42501: permission denied');
    end loop;
    perform pg_temp.assert_prefixo(papel||': INSERT direto de fatura forjada sem privilégio',
      pg_temp.tentar(papel, claims, format('insert into public.invoices(client_id,period_start,period_end,status,total_amount) values (%L,''2026-04-01'',''2026-04-15'',''closed'',1)', pg_temp.cli(1))),
      'erro 42501: permission denied');
  end loop;
end; $$;

-- Privilégios de tabela (catálogo): só leitura para quem consulta; nenhuma escrita nem TRUNCATE para a API.
select pg_temp.assert_eq('authenticated NÃO tem INSERT/UPDATE/DELETE/TRUNCATE em invoices nem invoice_items',
 (select bool_or(has_table_privilege('authenticated', t, p))::text
  from unnest(array['public.invoices','public.invoice_items']) t, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p), 'false');
select pg_temp.assert_eq('service_role NÃO tem INSERT/UPDATE/DELETE/TRUNCATE em invoices nem invoice_items',
 (select bool_or(has_table_privilege('service_role', t, p))::text
  from unnest(array['public.invoices','public.invoice_items']) t, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p), 'false');
select pg_temp.assert_eq('anon NÃO tem INSERT/UPDATE/DELETE/TRUNCATE em invoices nem invoice_items',
 (select bool_or(has_table_privilege('anon', t, p))::text
  from unnest(array['public.invoices','public.invoice_items']) t, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p), 'false');

-- Leituras legítimas preservadas.
select pg_temp.assert_prefixo('admin continua LENDO faturas',
 pg_temp.tentar('authenticated', pg_temp.claims(), 'select count(*) from public.invoices'), 'ok');
select pg_temp.assert_prefixo('admin continua LENDO itens de fatura',
 pg_temp.tentar('authenticated', pg_temp.claims(), 'select count(*) from public.invoice_items'), 'ok');
select pg_temp.assert_eq('admin enxerga as 3 faturas na leitura (RLS por papel inalterada)',
 pg_temp.adm('select count(*)::text from public.invoices'), '3');
select pg_temp.assert_eq('operacional continua sem enxergar fatura (RLS por papel inalterada)',
 pg_temp.como('authenticated', pg_temp.claims('a2'), 'select count(*)::text from public.invoices'), '0');

-- ===========================================================================
-- Bateria 3: manipulação dos VÍNCULOS financeiros (regressão: já protegidos, têm de continuar).
-- ===========================================================================
select pg_temp.assert_prefixo('adicional faturado não desvincula (A)',
 pg_temp.tentar('postgres','{}'::jsonb, format('update public.billing_additionals set invoice_id = null where id = %L', pg_temp.id('adicional-a'))),
 'erro 42501: Adicional faturado é imutável');
select pg_temp.assert_prefixo('adicional faturado não muda de fatura',
 pg_temp.tentar('postgres','{}'::jsonb, format('update public.billing_additionals set invoice_id = %L where id = %L', pg_temp.id('fatura-m'), pg_temp.id('adicional-a'))),
 'erro 42501: Adicional faturado é imutável');
select pg_temp.assert_prefixo('adicional faturado não é apagado',
 pg_temp.tentar('postgres','{}'::jsonb, format('delete from public.billing_additionals where id = %L', pg_temp.id('adicional-a'))),
 'erro 42501: Adicional de serviço não é apagado');
select pg_temp.assert_prefixo('adicional faturado não é cancelado por update direto',
 pg_temp.tentar('postgres','{}'::jsonb, format('update public.billing_additionals set canceled_at = now(), cancel_reason = ''x'' where id = %L', pg_temp.id('adicional-a'))),
 'erro 42501: Adicional faturado é imutável');
select pg_temp.assert_prefixo('admin não cancela adicional faturado pela RPC',
 pg_temp.adm(format('select public.cancelar_adicional(%L::uuid,%L)::text', pg_temp.id('adicional-a'), 'tentativa 046')), 'erro ');
select pg_temp.assert_prefixo('apontamento faturado não desvincula da fatura mista',
 pg_temp.tentar('postgres','{}'::jsonb, 'update public.timesheet_entries set invoice_id = null where id = ''5c46b100-0000-4000-8000-000000000001'''), 'erro 42501');
select pg_temp.assert_prefixo('serviço de container faturado não é cancelado por update direto',
 pg_temp.tentar('postgres','{}'::jsonb, format('update public.container_services set canceled_at = now(), cancel_reason = ''x'' where id = %L', pg_temp.id('container-c'))),
 'erro 42501: Serviço cancelado ou faturado é imutável');
select pg_temp.assert_prefixo('serviço de container faturado não é apagado',
 pg_temp.tentar('postgres','{}'::jsonb, format('delete from public.container_services where id = %L', pg_temp.id('container-c'))),
 'erro 42501: O lastro de container não é apagado');
select pg_temp.assert_prefixo('admin não cancela serviço de container faturado pela RPC',
 pg_temp.adm(format('select public.cancelar_servico_container(%L::uuid,%L)::text', pg_temp.id('container-c'), 'tentativa 046')), 'erro ');

-- ===========================================================================
-- Construção legítima não é atingida: fatura ainda SEM lastro (janela de construção do gerar_fatura)
-- continua editável por quem a constrói, e uma nova fatura de adicional é gerada e já nasce protegida.
-- ===========================================================================
select pg_temp.assert_prefixo('fatura sem lastro (em construção) continua editável pelo dono',
 pg_temp.tentar('postgres','{}'::jsonb,
  $c$do $x$ begin
       insert into public.invoices(id,client_id,period_start,period_end,status,total_amount) values ('5c46d000-0000-4000-8000-000000000001',
         '5c46c000-0000-4000-8000-000000000001','2026-03-01','2026-03-15','closed',10);
       update public.invoices set total_amount = 20 where id = '5c46d000-0000-4000-8000-000000000001';
       insert into public.invoice_items(invoice_id,description,quantity,unit_price,amount,kind) values ('5c46d000-0000-4000-8000-000000000001','em construção',1,20,20,'adicional');
     end $x$$c$), 'ok');
select pg_temp.adicional('adicional-a2', 1, '2026-02-16', '2026-02-28', 70.00);
select pg_temp.faturar('fatura-a2', 1, '2026-02-16', '2026-02-28');
select pg_temp.assert_eq('gerar_fatura segue funcionando: nova fatura só de adicional fecha em centavos',
 (select i.total_amount::text||'|'||(select sum(it.amount)::text from public.invoice_items it where it.invoice_id = i.id) from public.invoices i where i.id = pg_temp.id('fatura-a2')), '70.00|70.00');
select pg_temp.assert_prefixo('a fatura nova (só adicional) já nasce imutável',
 pg_temp.tentar('postgres','{}'::jsonb, format('update public.invoices set total_amount = 1 where id = %L', pg_temp.id('fatura-a2'))),
 'erro 42501: Fatura com lastro vinculado');

-- ===========================================================================
-- Estado final: nada do que foi tentado alterou o lastro.
-- ===========================================================================
select pg_temp.assert_eq('soma dos itens = total em todas as faturas geradas',
 (select bool_and(i.total_amount = (select sum(it.amount) from public.invoice_items it where it.invoice_id = i.id))::text
  from public.invoices i where i.id in (pg_temp.id('fatura-a'),pg_temp.id('fatura-c'),pg_temp.id('fatura-m'),pg_temp.id('fatura-a2'))), 'true');
select pg_temp.assert_eq('totais conferem com os valores registrados',
 (select string_agg(i.total_amount::text, '|' order by i.client_id, i.period_start) from public.invoices i
   where i.id in (pg_temp.id('fatura-a'),pg_temp.id('fatura-c'),pg_temp.id('fatura-m'),pg_temp.id('fatura-a2'))),
 '50.00|70.00|120.00|350.00');
select pg_temp.assert_eq('nenhum adicional faturado ficou cancelado ou sem fatura',
 (select count(*)::text from public.billing_additionals a
   where a.id in (pg_temp.id('adicional-a'),pg_temp.id('adicional-m'),pg_temp.id('adicional-a2')) and (a.invoice_id is null or a.canceled_at is not null)), '0');
select pg_temp.assert_eq('cada serviço de container faturado está ligado à fatura do cliente',
 (select count(*)::text from public.container_services s join public.billing_additionals a on a.id = s.billing_additional_id
   join public.invoices i on i.id = a.invoice_id where i.client_id <> s.client_id), '0');

do $$
begin
  if exists (select 1 from _falhas) then
    raise exception 'FIN20C: % de % asserções FALHARAM (veja os NOTICE acima).',
      (select count(*) from _falhas), (select count(*) from _falhas) + (select count(*) from _checks);
  end if;
end; $$;
select 'FIN20C: '||count(*)||' asserções PASS; todas as fixtures serão desfeitas.' as resultado from _checks;
ROLLBACK;
