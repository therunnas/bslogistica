-- FUNC-READY-01: correção atômica de serviço de container (049).
-- Teste transacional, exclusivo do Supabase local descartável; desfaz todas as fixtures.
--
-- Prova: a correção cancela o original e registra o substituto na mesma transação, com trilha `corrected`
-- apontando o substituto; repetir a mesma correção não duplica; conflito, cliente diferente, dados idênticos,
-- serviço cancelado ou faturado, operacional e anon são recusados; a imutabilidade da 045 continua; a fatura
-- cobra só o substituto.
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
create function pg_temp.tentar(papel text, claims jsonb, comando text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', claims::text, true);
  execute format('set local role %I', papel);
  begin
    execute comando;
    raise exception using errcode = 'ZX049';
  exception
    when sqlstate 'ZX049' then r := 'ok';
    when others then r := 'erro ' || sqlstate || ': ' || left(sqlerrm, 90);
  end;
  set local role postgres;
  return r;
end; $$;
create function pg_temp.claims(ator text default 'a1', nivel text default 'aal1') returns jsonb language sql as $$
  select jsonb_build_object('sub','5c490000-0000-4000-8000-0000000000'||ator,
    'role','authenticated','aal',nivel,'session_id','ec490000-0000-4000-8000-0000000000'||ator)
$$;
create function pg_temp.adm(comando text) returns text language sql as $$
  select pg_temp.como('authenticated', pg_temp.claims(), comando)
$$;
create function pg_temp.cli(n integer) returns uuid language sql as $$ select ('5c49c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.emp(n integer) returns uuid language sql as $$ select ('5c49f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.chave(n integer) returns uuid language sql as $$ select ('5c49d000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create temporary table _ids(k text primary key, id uuid not null) on commit drop;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from _ids where _ids.k = $1 $$;
create function pg_temp.q(consulta text) returns text language plpgsql as $$
declare r text;
begin
  execute consulta into r;
  return coalesce(r, 'nulo');
exception when others then return 'erro ' || sqlstate;
end; $$;
create function pg_temp.guardar(k text, r text) returns void language plpgsql as $$
begin
  if r !~ '^[0-9a-f-]{36}$' then
    insert into _falhas values ('preparo ' || k, 'uuid', r);
    raise notice 'FALHA preparo %: obtido [%]', k, r;
    insert into _ids values (k, gen_random_uuid());
  else insert into _ids values (k, r::uuid); end if;
end; $$;
-- Payload do serviço (cliente n, quantidade, receita e custos em centavos dos participantes 1 e 2).
create function pg_temp.dados(cliente integer, qtd integer, receita bigint, c1 bigint, c2 bigint)
returns jsonb language sql as $$
  select jsonb_build_object('clienteId', pg_temp.cli(cliente), 'operacaoId', null, 'solicitadoEm', '2026-02-02',
    'executadoEm', '2026-02-03', 'descricao', 'Descarga sintética 049', 'quantidade', qtd, 'receitaCentavos', receita,
    'custoTotalCentavos', c1 + c2, 'referencia', 'REF-049',
    'participantes', jsonb_build_array(jsonb_build_object('colaboradorId', pg_temp.emp(1), 'custoCentavos', c1),
                                       jsonb_build_object('colaboradorId', pg_temp.emp(2), 'custoCentavos', c2)),
    'modalidadeCusto', 'total_distribuido',
    'competenciaCobranca', jsonb_build_object('inicio', '2026-02-01', 'fim', '2026-02-15'))
$$;
create function pg_temp.registrar_servico(chave uuid, d jsonb) returns text language sql as $$
  select pg_temp.adm(format('select public.registrar_servico_container(%L::jsonb, %L::uuid, %L)::text', d, chave, 'Registro sintético 049'))
$$;
create function pg_temp.corrigir(servico uuid, d jsonb, chave uuid, claims jsonb default null) returns text language sql as $$
  select pg_temp.como('authenticated', coalesce(claims, pg_temp.claims()),
    format('select public.corrigir_servico_container(%L::uuid, %L::jsonb, %L::uuid, %L)::text', servico, d, chave, 'Quantidade errada'))
$$;

-- Fixtures sintéticas: a1 admin (sem fator de MFA), a2 operacional.
insert into auth.users(id) select ('5c490000-0000-4000-8000-0000000000a'||n)::uuid from generate_series(1,2) n;
insert into auth.sessions(id,user_id,not_after)
 select ('ec490000-0000-4000-8000-0000000000a'||n)::uuid, ('5c490000-0000-4000-8000-0000000000a'||n)::uuid, null from generate_series(1,2) n;
insert into public.user_roles(user_id,role) values
 ('5c490000-0000-4000-8000-0000000000a1','admin'),('5c490000-0000-4000-8000-0000000000a2','operacional');
insert into public.clients(id,name) select pg_temp.cli(n),'CLIENTE-SINTETICO-049-'||n from generate_series(1,2) n;
insert into public.employees(id,name,daily_cost) select pg_temp.emp(n),'COLAB-SINTETICO-049-'||n,80 from generate_series(1,3) n;
set constraints all immediate;

-- ===========================================================================
-- A. Correção atômica
-- ===========================================================================
select pg_temp.guardar('s1', pg_temp.registrar_servico(pg_temp.chave(1), pg_temp.dados(1, 2, 30000, 4000, 3500)));
select pg_temp.guardar('s2', pg_temp.corrigir(pg_temp.id('s1'), pg_temp.dados(1, 3, 45000, 5000, 3500), pg_temp.chave(2)));
select pg_temp.assert_eq('A1. o substituto é outro serviço, com os dados corrigidos e disponível',
 pg_temp.q(format($s$select (id <> %L)::text || '|' || quantity || '|' || revenue_cents || '|' || cost_total_cents || '|' || (canceled_at is null)::text
                       from public.container_services where id = %L$s$, pg_temp.id('s1'), pg_temp.id('s2'))),
 'true|3|45000|8500|true');
select pg_temp.assert_eq('A2. o original fica cancelado com motivo de correção; o adicional dele também, valor intacto',
 pg_temp.q(format($s$select (s.canceled_at is not null)::text || '|' || left(s.cancel_reason, 10) || '|' || (b.canceled_at is not null)::text || '|' || b.amount
                       from public.container_services s join public.billing_additionals b on b.id = s.billing_additional_id where s.id = %L$s$, pg_temp.id('s1'))),
 'true|Correção: |true|300.00');
select pg_temp.assert_eq('A3. novo adicional com a receita corrigida; participantes novos gravados',
 pg_temp.q(format($s$select b.amount || '|' || (select string_agg(p.cost_cents::text, ',' order by p.cost_cents)
                                                  from public.container_service_participants p where p.service_id = s.id)
                       from public.container_services s join public.billing_additionals b on b.id = s.billing_additional_id where s.id = %L$s$, pg_temp.id('s2'))),
 '450.00|3500,5000');
select pg_temp.assert_eq('A4. trilha: original com registered, canceled e corrected (apontando o substituto); substituto com registered',
 pg_temp.q(format($s$select (select string_agg(action, ',' order by action) from public.container_service_audit where service_id = %L)
                      || '|' || (select after_data ->> 'id' from public.container_service_audit where service_id = %L and action = 'corrected')
                      || '|' || (select string_agg(action, ',') from public.container_service_audit where service_id = %L)$s$,
                  pg_temp.id('s1'), pg_temp.id('s1'), pg_temp.id('s2'))),
 'canceled,corrected,registered|' || pg_temp.id('s2')::text || '|registered');

-- ===========================================================================
-- B. Repetição, conflito e recusas
-- ===========================================================================
select pg_temp.assert_eq('B1. repetir a MESMA correção devolve o mesmo substituto, sem nova linha nem trilha',
 pg_temp.corrigir(pg_temp.id('s1'), pg_temp.dados(1, 3, 45000, 5000, 3500), pg_temp.chave(2)) || '|' ||
 pg_temp.q(format($s$select count(*)::text from public.container_services where client_id = %L$s$, pg_temp.cli(1))) || '|' ||
 pg_temp.q(format($s$select count(*)::text from public.container_service_audit where service_id = %L and action = 'corrected'$s$, pg_temp.id('s1'))),
 pg_temp.id('s2')::text || '|2|1');
select pg_temp.assert_prefixo('B2. mesma chave com outro conteúdo é recusada (23505)',
 pg_temp.corrigir(pg_temp.id('s1'), pg_temp.dados(1, 4, 45000, 5000, 3500), pg_temp.chave(2)), 'erro 23505');
select pg_temp.assert_prefixo('B3. corrigir o original já substituído (cancelado) é recusado (55000)',
 pg_temp.corrigir(pg_temp.id('s1'), pg_temp.dados(1, 5, 45000, 5000, 3500), pg_temp.chave(3)), 'erro 55000');
select pg_temp.assert_prefixo('B4. trocar o cliente é recusado (22023)',
 pg_temp.corrigir(pg_temp.id('s2'), pg_temp.dados(2, 3, 45000, 5000, 3500), pg_temp.chave(4)), 'erro 22023');
select pg_temp.assert_prefixo('B5. dados idênticos aos atuais são recusados (22023)',
 pg_temp.corrigir(pg_temp.id('s2'), pg_temp.dados(1, 3, 45000, 5000, 3500), pg_temp.chave(5)), 'erro 22023');
select pg_temp.assert_prefixo('B6. operacional não corrige (42501)',
 pg_temp.corrigir(pg_temp.id('s2'), pg_temp.dados(1, 6, 45000, 5000, 3500), pg_temp.chave(6), pg_temp.claims('a2')), 'erro 42501');
select pg_temp.assert_prefixo('B7. anon não executa a RPC (42501)',
 pg_temp.como('anon', '{"role":"anon"}'::jsonb,
   format('select public.corrigir_servico_container(%L::uuid, %L::jsonb, %L::uuid, %L)::text',
          pg_temp.id('s2'), pg_temp.dados(1, 6, 45000, 5000, 3500), pg_temp.chave(7), 'x')), 'erro 42501');
select pg_temp.assert_prefixo('B8. alteração direta da linha continua proibida (imutabilidade da 045)',
 pg_temp.tentar('authenticated', pg_temp.claims(),
   format('update public.container_services set quantity = 9 where id = %L', pg_temp.id('s2'))), 'erro 42501');

-- ===========================================================================
-- C. Faturado não se corrige; a fatura cobra só o substituto
-- ===========================================================================
select pg_temp.guardar('f1', pg_temp.adm(format('select (public.gerar_fatura(%L::uuid, %L::date, %L::date)).id::text',
  pg_temp.cli(1), '2026-02-01', '2026-02-15')));
select pg_temp.assert_eq('C1. a fatura cobra só o substituto (450,00), uma vez; Σ itens = total',
 pg_temp.q(format($s$select i.total_amount || '|' || (select sum(amount) from public.invoice_items where invoice_id = i.id)
                       from public.invoices i where i.id = %L$s$, pg_temp.id('f1'))),
 '450.00|450.00');
select pg_temp.assert_prefixo('C2. corrigir serviço faturado é recusado (55000)',
 pg_temp.corrigir(pg_temp.id('s2'), pg_temp.dados(1, 7, 45000, 5000, 3500), pg_temp.chave(8)), 'erro 55000');
select pg_temp.assert_eq('C3. nada mudou no faturado',
 pg_temp.q(format($s$select quantity::text from public.container_services where id = %L$s$, pg_temp.id('s2'))), '3');
select pg_temp.assert_eq('C4. o estado anuncia a correção',
 pg_temp.adm($q$select public.estado_motor_vigencia() ->> 'correcao_container'$q$), 'true');

do $$
begin
  if exists (select 1 from _falhas) then
    raise exception '049: % de % asserções FALHARAM (veja os NOTICE acima).',
      (select count(*) from _falhas), (select count(*) from _falhas) + (select count(*) from _checks);
  end if;
end; $$;
select '049: '||count(*)||' asserções PASS; todas as fixtures serão desfeitas.' as resultado from _checks;
ROLLBACK;
