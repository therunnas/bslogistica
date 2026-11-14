-- FIN-20D: idempotência do registro de adicionais (duplo clique, reenvio, timeout seguido de retry).
-- Teste transacional, exclusivo do Supabase local descartável; desfaz todas as fixtures.
--
-- RED no baseline 046: `registrar_adicional` não tem chave de idempotência, então a mesma chamada duas
-- vezes cobra duas vezes (dois adicionais, duas trilhas), e a RPC é executável por `authenticated`.
-- A correção (047) cria `registrar_adicional_idempotente` e fecha o caminho legado.
BEGIN;

create temporary table _checks (caso text) on commit drop;
create temporary table _falhas (caso text, esperado text, obtido text) on commit drop;
create function pg_temp.assert_eq(caso text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    insert into _falhas values (caso, esperado, obtido);
    raise notice 'FALHA %: esperado [%], obtido [%]', caso, esperado, obtido;
  else insert into _checks values(caso); end if;
end; $$;
create function pg_temp.assert_prefixo(caso text, obtido text, prefixo text) returns void language plpgsql as $$
begin
  if left(coalesce(obtido, '<nulo>'), length(prefixo)) is distinct from prefixo then
    insert into _falhas values (caso, prefixo || '…', obtido);
    raise notice 'FALHA %: esperado começar com [%], obtido [%]', caso, prefixo, obtido;
  else insert into _checks values(caso); end if;
end; $$;

-- Executa como `papel` com as claims dadas; devolve o texto do resultado escalar ou 'erro <sqlstate>: <msg>'.
create function pg_temp.como(papel text, claims jsonb, comando text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', claims::text, true);
  execute format('set local role %I', papel);
  begin
    execute comando into r;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate || ': ' || left(sqlerrm, 90);
  end;
  set local role postgres;
  return coalesce(r, 'nulo');
end; $$;
-- Executa e DESFAZ sempre; devolve 'ok' ou 'erro <sqlstate>: <msg>'.
create function pg_temp.tentar(papel text, claims jsonb, comando text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', claims::text, true);
  execute format('set local role %I', papel);
  begin
    execute comando;
    raise exception using errcode = 'ZX047';
  exception
    when sqlstate 'ZX047' then r := 'ok';
    when others then r := 'erro ' || sqlstate || ': ' || left(sqlerrm, 90);
  end;
  set local role postgres;
  return r;
end; $$;
create function pg_temp.claims(ator text default 'a1', nivel text default 'aal1') returns jsonb language sql as $$
  select jsonb_build_object('sub','5c470000-0000-4000-8000-0000000000'||ator,
    'role','authenticated','aal',nivel,'session_id','ec470000-0000-4000-8000-0000000000'||ator)
$$;
create function pg_temp.adm(comando text) returns text language sql as $$
  select pg_temp.como('authenticated', pg_temp.claims(), comando)
$$;
create function pg_temp.cli(n integer) returns uuid language sql as $$ select ('5c47c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.emp(n integer) returns uuid language sql as $$ select ('5c47f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.chave(n integer) returns uuid language sql as $$ select ('5c47d000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create temporary table _ids(k text primary key, id uuid not null) on commit drop;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from _ids where _ids.k = $1 $$;

-- RPC nova: devolve o texto do uuid ou 'erro ...'. Parâmetros nomeados, como o PostgREST.
create function pg_temp.idem(chave uuid, cliente integer, inicio date, fim date, descricao text, valor numeric,
  referencia text default null, operacao uuid default null, comp_ini date default null, comp_fim date default null)
returns text language sql as $$
  select pg_temp.adm(format(
    'select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => %L::date, p_period_end => %L::date, p_description => %L, p_amount => %s::numeric, p_reference => %L, p_operation_id => %L::uuid, p_billing_period_start => %L::date, p_billing_period_end => %L::date)::text',
    chave, pg_temp.cli(cliente), inicio, fim, descricao, valor, referencia, operacao, comp_ini, comp_fim))
$$;
-- Guarda o id devolvido (RED: se a RPC não existir, registra a falha e segue com um id fictício).
create function pg_temp.guardar(k text, r text) returns void language plpgsql as $$
begin
  if r !~ '^[0-9a-f-]{36}$' then
    insert into _falhas values ('preparo ' || k, 'uuid', r);
    raise notice 'FALHA preparo %: obtido [%]', k, r;
    insert into _ids values (k, gen_random_uuid());
  else insert into _ids values (k, r::uuid); end if;
end; $$;
-- Consulta dinâmica: devolve o resultado escalar ou 'erro <sqlstate>'. Permite ao RED enumerar tudo
-- mesmo antes de as colunas novas existirem.
create function pg_temp.q(consulta text) returns text language plpgsql as $$
declare r text;
begin
  execute consulta into r;
  return coalesce(r, 'nulo');
exception when others then return 'erro ' || sqlstate;
end; $$;
create function pg_temp.n_linhas(chave uuid) returns text language plpgsql as $$
begin return pg_temp.q(format('select count(*)::text from public.billing_additionals where idempotency_key = %L', chave)); end; $$;
create function pg_temp.n_auditoria(adicional uuid) returns text language plpgsql as $$
begin return pg_temp.q(format('select count(*)::text from public.financial_terms_audit where action = ''adicional_registrado'' and entity_id = %L', adicional)); end; $$;
create function pg_temp.faturar(k text, cliente integer, inicio date, fim date) returns void language sql as $$
  select pg_temp.guardar(k, pg_temp.adm(format('select (public.gerar_fatura(%L::uuid,%L::date,%L::date)).id::text', pg_temp.cli(cliente), inicio, fim)))
$$;

-- Fixtures sintéticas. a1 admin (sem fator de MFA), a2 operacional, a3 sem papel, a4 admin com TOTP verificado.
insert into auth.users(id) select ('5c470000-0000-4000-8000-0000000000a'||n)::uuid from generate_series(1,4) n;
insert into auth.sessions(id,user_id,not_after)
 select ('ec470000-0000-4000-8000-0000000000a'||n)::uuid, ('5c470000-0000-4000-8000-0000000000a'||n)::uuid, null from generate_series(1,4) n;
insert into public.user_roles(user_id,role) values
 ('5c470000-0000-4000-8000-0000000000a1','admin'),('5c470000-0000-4000-8000-0000000000a2','operacional'),('5c470000-0000-4000-8000-0000000000a4','admin');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,friendly_name,created_at,updated_at) values
 ('5c470000-0000-4000-8000-0000000000f4','5c470000-0000-4000-8000-0000000000a4','totp','verified','SINTETICO_NAO_UTILIZAVEL','MFA_TESTE_047',now(),now());
insert into public.clients(id,name) select pg_temp.cli(n),'CLIENTE-SINTETICO-047-'||n from generate_series(1,5) n;
insert into public.employees(id,name,daily_cost) select pg_temp.emp(n),'COLAB-SINTETICO-047-'||n,80 from generate_series(1,3) n;
insert into public.employee_cost_terms(employee_id,valid_from,daily_cost,active,origin,reason)
 select pg_temp.emp(n),'2026-01-01',80,true,'informada','Fixture sintética 047' from generate_series(1,3) n;
insert into public.operations(id,client_id,name,agreed_amount) values
 ('5c47e000-0000-4000-8000-000000000001',pg_temp.cli(3),'MISTA-047',200),
 ('5c47e000-0000-4000-8000-000000000002',pg_temp.cli(4),'OUTRO-CLIENTE-047',200);
insert into public.operation_terms(operation_id,valid_from,agreed_amount,active,origin,reason) values
 ('5c47e000-0000-4000-8000-000000000001','2026-01-01',200,true,'informada','Fixture sintética 047'),
 ('5c47e000-0000-4000-8000-000000000002','2026-01-01',200,true,'informada','Fixture sintética 047');
insert into public.shifts(id,operation_id,name,start_time,end_time,break_minutes)
 values ('5c47a000-0000-4000-8000-000000000001','5c47e000-0000-4000-8000-000000000001','TURNO-047','06:00','15:00',60);
set constraints all immediate;
select pg_temp.assert_eq('motor de vigência ligado para a fixture',
 pg_temp.adm($q$select public.alterar_motor_vigencia(true,'Fixture sintética FIN20D')->>'ativo'$q$),'true');

-- ===========================================================================
-- A. Idempotência: duplo clique, reenvio e retry após timeout devolvem o MESMO adicional.
-- ===========================================================================
select pg_temp.guardar('a1', pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00));
select pg_temp.assert_eq('1ª chamada cria 1 adicional ligado à chave', pg_temp.n_linhas(pg_temp.chave(1)), '1');
select pg_temp.assert_eq('o registro guarda chave e payload normalizado',
 pg_temp.q(format('select (idempotency_key = %L and request_payload is not null and amount = 100.00 and created_by = ''5c470000-0000-4000-8000-0000000000a1''::uuid)::text from public.billing_additionals where id = %L', pg_temp.chave(1), pg_temp.id('a1'))), 'true');
select pg_temp.assert_eq('a 1ª chamada gera 1 evento de auditoria', pg_temp.n_auditoria(pg_temp.id('a1')), '1');

select pg_temp.assert_eq('duplo clique: mesma chave e mesmos dados devolvem o mesmo id',
 pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00), pg_temp.id('a1')::text);
select pg_temp.assert_eq('reenvio HTTP idêntico devolve o mesmo id',
 pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00), pg_temp.id('a1')::text);
select pg_temp.assert_eq('retry com a mesma intenção escrita de outro jeito (espaços, 100 vs 100.00, referência vazia) devolve o mesmo id',
 pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', '  Etiquetagem sintética 047  ', 100, '   '), pg_temp.id('a1')::text);
select pg_temp.assert_eq('nenhuma repetição cria linha', pg_temp.n_linhas(pg_temp.chave(1)), '1');
select pg_temp.assert_eq('nenhuma repetição duplica a trilha financeira', pg_temp.n_auditoria(pg_temp.id('a1')), '1');
select pg_temp.assert_eq('o cliente tem 1 adicional de R$ 100 a faturar (não R$ 200)',
 (select count(*)||'|'||sum(amount) from public.billing_additionals where client_id = pg_temp.cli(1)), '1|100.00');

-- Mesma chave com payload DIFERENTE: recusa 23505, nada é criado nem auditado.
do $$
declare c record; antes text;
begin
  antes := (select count(*)||'|'||(select count(*) from public.financial_terms_audit) from public.billing_additionals);
  for c in select * from (values
    ('valor',        pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.01)),
    ('descrição',    pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Outra descrição', 100.00)),
    ('início',       pg_temp.idem(pg_temp.chave(1), 1, '2026-02-02', '2026-02-15', 'Etiquetagem sintética 047', 100.00)),
    ('fim',          pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-14', 'Etiquetagem sintética 047', 100.00)),
    ('referência',   pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00, 'REF-X')),
    ('cliente',      pg_temp.idem(pg_temp.chave(1), 2, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00)),
    ('competência',  pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00, null, null, '2026-02-01', '2026-02-15'))
  ) x(campo, r) loop
    perform pg_temp.assert_prefixo('mesma chave com '||c.campo||' diferente: recusa 23505', c.r, 'erro 23505');
  end loop;
  perform pg_temp.assert_eq('recusas não criam adicional nem trilha',
    (select count(*)||'|'||(select count(*) from public.financial_terms_audit) from public.billing_additionals), antes);
end; $$;

-- Duas operações LEGÍTIMAS, mesmos valores, chaves diferentes: dois adicionais.
select pg_temp.guardar('a2', pg_temp.idem(pg_temp.chave(2), 2, '2026-02-01', '2026-02-15', 'Separação de pedidos', 80.00));
select pg_temp.guardar('a3', pg_temp.idem(pg_temp.chave(3), 2, '2026-02-01', '2026-02-15', 'Separação de pedidos', 80.00));
select pg_temp.assert_eq('chaves diferentes com dados iguais criam DOIS adicionais (operações distintas)',
 (select count(*)||'|'||sum(amount) from public.billing_additionals where client_id = pg_temp.cli(2)), '2|160.00');
select pg_temp.assert_eq('cada operação legítima tem a sua trilha',
 pg_temp.n_auditoria(pg_temp.id('a2'))||'|'||pg_temp.n_auditoria(pg_temp.id('a3')), '1|1');
select pg_temp.assert_eq('os dois ids são distintos', (pg_temp.id('a2') <> pg_temp.id('a3'))::text, 'true');

-- Validação do chamador.
select pg_temp.assert_prefixo('chave nula é recusada (22023)',
 pg_temp.adm(format('select public.registrar_adicional_idempotente(p_idempotency_key => null::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''x'', p_amount => 1::numeric)::text', pg_temp.cli(1))),
 'erro 22023');
select pg_temp.assert_prefixo('valor com 3 casas é recusado como antes (22023)',
 pg_temp.idem(pg_temp.chave(4), 1, '2026-02-01', '2026-02-15', 'x', 1.005), 'erro 22023');
select pg_temp.assert_eq('recusa de validação não consome a chave nem cria linha', pg_temp.n_linhas(pg_temp.chave(4)), '0');
select pg_temp.assert_prefixo('cliente inexistente continua P0002',
 pg_temp.idem(pg_temp.chave(5), 9, '2026-02-01', '2026-02-15', 'x', 1), 'erro P0002');

-- ===========================================================================
-- B. Segurança: caminho legado fechado; autorização da RPC nova igual à antiga.
-- ===========================================================================
select pg_temp.assert_prefixo('RPC legada (9 parâmetros) negada a authenticated',
 pg_temp.adm(format('select public.registrar_adicional(%L::uuid,''2026-02-01''::date,''2026-02-15''::date,''legado'',10::numeric)::text', pg_temp.cli(1))),
 'erro 42501');
select pg_temp.assert_prefixo('RPC legada negada a authenticated também com todos os parâmetros nomeados',
 pg_temp.adm(format('select public.registrar_adicional(p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''legado'', p_amount => 10::numeric, p_reference => null, p_operation_id => null, p_billing_period_start => null, p_billing_period_end => null)::text', pg_temp.cli(1))),
 'erro 42501');
select pg_temp.assert_eq('o legado não criou nada',
 (select count(*)::text from public.billing_additionals where description = 'legado'), '0');
select pg_temp.assert_prefixo('RPC legada negada a anon',
 pg_temp.como('anon', '{}'::jsonb, format('select public.registrar_adicional(%L::uuid,''2026-02-01''::date,''2026-02-15''::date,''legado'',10::numeric)::text', pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_prefixo('RPC legada negada a service_role',
 pg_temp.como('service_role', '{}'::jsonb, format('select public.registrar_adicional(%L::uuid,''2026-02-01''::date,''2026-02-15''::date,''legado'',10::numeric)::text', pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_eq('privilégio EXECUTE do legado: nenhum papel da API',
 (select bool_or(has_function_privilege(r, p.oid, 'EXECUTE'))::text
    from pg_proc p, unnest(array['anon','authenticated','service_role']) r
   where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_adicional'), 'false');
select pg_temp.assert_eq('privilégio EXECUTE da RPC nova: só authenticated',
 (select string_agg(r, ',' order by r) from pg_proc p, unnest(array['anon','authenticated','service_role']) r
   where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_adicional_idempotente' and has_function_privilege(r, p.oid, 'EXECUTE')), 'authenticated');
select pg_temp.assert_eq('só existe UMA assinatura de registrar_adicional (sem sobrecarga legada oculta)',
 (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'registrar_adicional'), '1');

select pg_temp.assert_prefixo('operacional não registra adicional',
 pg_temp.como('authenticated', pg_temp.claims('a2'), format('select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''x'', p_amount => 1::numeric)::text', pg_temp.chave(90), pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_prefixo('conta sem papel não registra adicional',
 pg_temp.como('authenticated', pg_temp.claims('a3'), format('select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''x'', p_amount => 1::numeric)::text', pg_temp.chave(91), pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_prefixo('anon não registra adicional',
 pg_temp.como('anon', '{}'::jsonb, format('select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''x'', p_amount => 1::numeric)::text', pg_temp.chave(92), pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_prefixo('operacional não descobre chave alheia (42501, nunca 23505 nem o id)',
 pg_temp.como('authenticated', pg_temp.claims('a2'), format('select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''Etiquetagem sintética 047'', p_amount => 100::numeric)::text', pg_temp.chave(1), pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_prefixo('admin com fator verificado em AAL1 é barrado como antes',
 pg_temp.como('authenticated', pg_temp.claims('a4','aal1'), format('select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''x'', p_amount => 1::numeric)::text', pg_temp.chave(93), pg_temp.cli(1))), 'erro 42501');
select pg_temp.assert_eq('admin com fator verificado em AAL2 registra',
 (pg_temp.como('authenticated', pg_temp.claims('a4','aal2'), format('select public.registrar_adicional_idempotente(p_idempotency_key => %L::uuid, p_client_id => %L::uuid, p_period_start => ''2026-02-01''::date, p_period_end => ''2026-02-15''::date, p_description => ''AAL2 047'', p_amount => 5::numeric)::text', pg_temp.chave(94), pg_temp.cli(4))) ~ '^[0-9a-f-]{36}$')::text, 'true');

-- Nenhum caminho direto: a tabela segue sem INSERT/UPDATE para a API.
select pg_temp.assert_prefixo('authenticated não insere adicional direto na tabela',
 pg_temp.tentar('authenticated', pg_temp.claims(), format('insert into public.billing_additionals(client_id,period_start,period_end,description,amount,idempotency_key,request_payload) values (%L,''2026-02-01'',''2026-02-15'',''forjado'',1,%L,''{}'')', pg_temp.cli(1), pg_temp.chave(95))), 'erro 42501: permission denied');
select pg_temp.assert_prefixo('chave e payload são imutáveis depois de gravados (nível do gatilho)',
 pg_temp.tentar('postgres', '{}'::jsonb, format('update public.billing_additionals set idempotency_key = %L where id = %L', pg_temp.chave(96), pg_temp.id('a1'))), 'erro 42501');
select pg_temp.assert_prefixo('a mesma chave não pode ser gravada em duas linhas (unicidade no banco)',
 pg_temp.tentar('postgres', '{}'::jsonb, format('insert into public.billing_additionals(client_id,period_start,period_end,description,amount,idempotency_key,request_payload,billing_period_start,billing_period_end) values (%L,''2026-02-01'',''2026-02-15'',''duplicada'',1,%L,''{"x":1}'',''2026-02-01'',''2026-02-15'')', pg_temp.cli(1), pg_temp.chave(1))), 'erro 23505');
select pg_temp.assert_prefixo('chave sem payload é incoerente (CHECK)',
 pg_temp.tentar('postgres', '{}'::jsonb, format('insert into public.billing_additionals(client_id,period_start,period_end,description,amount,idempotency_key,billing_period_start,billing_period_end) values (%L,''2026-02-01'',''2026-02-15'',''sem payload'',1,%L,''2026-02-01'',''2026-02-15'')', pg_temp.cli(1), pg_temp.chave(97))), 'erro 23514');

-- ===========================================================================
-- C. Containers seguem funcionando pelo caminho interno (sem chave de adicional) e idempotentes.
-- ===========================================================================
create function pg_temp.payload_container() returns jsonb language sql as $$
  select jsonb_build_object('clienteId',pg_temp.cli(5),'operacaoId',null,'solicitadoEm','2026-02-02','executadoEm','2026-02-03',
    'descricao','Descarga sintética 047','quantidade',2,'receitaCentavos',12000,'custoTotalCentavos',3000,'referencia','ORDEM-047',
    'modalidadeCusto','total_distribuido','competenciaCobranca',null,'participantes',jsonb_build_array(
      jsonb_build_object('colaboradorId',pg_temp.emp(1),'custoCentavos',1000),jsonb_build_object('colaboradorId',pg_temp.emp(2),'custoCentavos',2000)))
$$;
select pg_temp.guardar('container', pg_temp.como('postgres', pg_temp.claims(), format('select public.registrar_servico_container(%L::jsonb,%L::uuid,%L)::text', pg_temp.payload_container(), pg_temp.chave(40), 'Registro sintético 047')));
select pg_temp.assert_eq('container registra o adicional pelo caminho interno (chave de adicional nula)',
 pg_temp.q(format('select (a.idempotency_key is null and a.request_payload is null and a.amount = 120.00)::text from public.container_services s join public.billing_additionals a on a.id = s.billing_additional_id where s.id = %L', pg_temp.id('container'))), 'true');
select pg_temp.assert_eq('retry do container segue idempotente (sem 2º adicional)',
 pg_temp.como('postgres', pg_temp.claims(), format('select public.registrar_servico_container(%L::jsonb,%L::uuid,%L)::text', pg_temp.payload_container(), pg_temp.chave(40), 'Registro sintético 047')), pg_temp.id('container')::text);
select pg_temp.assert_eq('o cliente do container tem 1 adicional',
 (select count(*)::text from public.billing_additionals where client_id = pg_temp.cli(5)), '1');

-- ===========================================================================
-- D. Cancelamento: o retry da intenção cancelada não ressuscita nem duplica; nova intenção cria outro.
-- ===========================================================================
select pg_temp.assert_eq('cancelar adicional criado de forma idempotente funciona',
 pg_temp.adm(format('select public.cancelar_adicional(%L::uuid,%L)::text', pg_temp.id('a3'), 'cancelamento sintético 047')), '');
select pg_temp.assert_eq('retry da intenção já cancelada devolve o mesmo id (sem recriar)',
 pg_temp.idem(pg_temp.chave(3), 2, '2026-02-01', '2026-02-15', 'Separação de pedidos', 80.00), pg_temp.id('a3')::text);
select pg_temp.assert_eq('o retry não reativou o cancelado nem criou outro',
 (select count(*)||'|'||count(*) filter (where canceled_at is not null) from public.billing_additionals where client_id = pg_temp.cli(2)), '2|1');
select pg_temp.guardar('a3b', pg_temp.idem(pg_temp.chave(31), 2, '2026-02-01', '2026-02-15', 'Separação de pedidos', 80.00));
select pg_temp.assert_eq('nova intenção (nova chave) depois do cancelamento cria um novo adicional',
 (select count(*)||'|'||count(*) filter (where canceled_at is null) from public.billing_additionals where client_id = pg_temp.cli(2)), '3|2');

-- ===========================================================================
-- E. Faturamento: adicional isolado e fatura mista; retry depois de faturado; compatível com a 046.
-- ===========================================================================
select pg_temp.faturar('fatura-a', 1, '2026-02-01', '2026-02-15');
select pg_temp.assert_eq('fatura só de adicional: 1 adicional de R$ 100 (não 200)',
 (select i.total_amount::text||'|'||(select count(*) from public.invoice_items it where it.invoice_id = i.id) from public.invoices i where i.id = pg_temp.id('fatura-a')), '100.00|1');
select pg_temp.assert_eq('retry da intenção já FATURADA devolve o mesmo id',
 pg_temp.idem(pg_temp.chave(1), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00), pg_temp.id('a1')::text);
select pg_temp.assert_eq('o retry não mexeu na fatura emitida nem criou adicional',
 pg_temp.q(format('select count(*)::text||''|''||(select total_amount::text from public.invoices where id = %L) from public.billing_additionals where client_id = %L and idempotency_key = %L', pg_temp.id('fatura-a'), pg_temp.cli(1), pg_temp.chave(1))), '1|100.00');
select pg_temp.assert_prefixo('fatura emitida com adicional idempotente segue imutável (046)',
 pg_temp.tentar('postgres', '{}'::jsonb, format('update public.invoices set total_amount = 1 where id = %L', pg_temp.id('fatura-a'))), 'erro 42501: Fatura com lastro vinculado');
select pg_temp.assert_prefixo('adicional faturado segue imutável',
 pg_temp.tentar('postgres', '{}'::jsonb, format('update public.billing_additionals set amount = 1 where id = %L', pg_temp.id('a1'))), 'erro 42501');
select pg_temp.assert_prefixo('authenticated segue sem escrita direta em fatura (046)',
 pg_temp.tentar('authenticated', pg_temp.claims(), format('update public.invoices set total_amount = 1 where id = %L', pg_temp.id('fatura-a'))), 'erro 42501: permission denied');
-- Nova operação intencional com os MESMOS dados, depois de a competência ter sido faturada: é outro adicional.
select pg_temp.guardar('a1b', pg_temp.idem(pg_temp.chave(11), 1, '2026-02-01', '2026-02-15', 'Etiquetagem sintética 047', 100.00));
select pg_temp.assert_eq('nova chave com os mesmos dados após faturar cria novo adicional a faturar (decisão de competência faturada inalterada)',
 (select count(*)||'|'||count(*) filter (where invoice_id is null) from public.billing_additionals where client_id = pg_temp.cli(1) and amount = 100.00 and description = 'Etiquetagem sintética 047'), '2|1');

-- Fatura mista: apontamento + adicional idempotente.
insert into public.timesheets(id,operation_id,shift_id,work_date) values
 ('5c47b000-0000-4000-8000-000000000001','5c47e000-0000-4000-8000-000000000001','5c47a000-0000-4000-8000-000000000001','2026-02-03');
insert into public.timesheet_entries(id,timesheet_id,employee_id,status,check_in,check_out,break_minutes) values
 ('5c47b100-0000-4000-8000-000000000001','5c47b000-0000-4000-8000-000000000001',pg_temp.emp(3),'present','06:00','15:00',60);
select pg_temp.guardar('a-mista', pg_temp.idem(pg_temp.chave(60), 3, '2026-02-01', '2026-02-15', 'Adicional da fatura mista', 30.00));
select pg_temp.assert_eq('reenvio do adicional da fatura mista não duplica',
 pg_temp.idem(pg_temp.chave(60), 3, '2026-02-01', '2026-02-15', 'Adicional da fatura mista', 30.00), pg_temp.id('a-mista')::text);
select pg_temp.faturar('fatura-m', 3, '2026-02-01', '2026-02-15');
select pg_temp.assert_eq('fatura mista fecha em centavos: diária 200 + adicional 30 (uma vez)',
 (select i.total_amount::text||'|'||(select sum(it.amount)::text from public.invoice_items it where it.invoice_id = i.id) from public.invoices i where i.id = pg_temp.id('fatura-m')), '230.00|230.00');
select pg_temp.assert_eq('retry após a fatura mista devolve o mesmo id',
 pg_temp.idem(pg_temp.chave(60), 3, '2026-02-01', '2026-02-15', 'Adicional da fatura mista', 30.00), pg_temp.id('a-mista')::text);

-- ===========================================================================
-- F. Estado final: nenhuma duplicidade de cobrança nem de trilha.
-- ===========================================================================
select pg_temp.assert_eq('nenhuma chave de idempotência repetida',
 pg_temp.q('select count(*)::text from (select idempotency_key from public.billing_additionals where idempotency_key is not null group by 1 having count(*) > 1) x'), '0');
select pg_temp.assert_eq('cada adicional criado pela RPC nova tem exatamente 1 evento de auditoria de registro',
 pg_temp.q('select count(*)::text from public.billing_additionals a where a.idempotency_key is not null and (select count(*) from public.financial_terms_audit t where t.action = ''adicional_registrado'' and t.entity_id = a.id) <> 1'), '0');
select pg_temp.assert_eq('soma dos itens = total em todas as faturas',
 (select bool_and(i.total_amount = (select sum(it.amount) from public.invoice_items it where it.invoice_id = i.id))::text from public.invoices i), 'true');

do $$
begin
  if exists (select 1 from _falhas) then
    raise exception 'FIN20D: % de % asserções FALHARAM (veja os NOTICE acima).',
      (select count(*) from _falhas), (select count(*) from _falhas) + (select count(*) from _checks);
  end if;
end; $$;
select 'FIN20D: '||count(*)||' asserções PASS; todas as fixtures serão desfeitas.' as resultado from _checks;
ROLLBACK;
