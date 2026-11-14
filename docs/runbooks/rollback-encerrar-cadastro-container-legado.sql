-- GATE-FIN-02. Origem: schema 052. Destino: 051 quanto ao privilégio de registrar_servico_container.
--
-- O QUE FAZ: devolve o EXECUTE de `public.registrar_servico_container(jsonb,uuid,text)` a `authenticated`,
-- exatamente como a 045 o deixou. Não toca dados, corpos de função, RLS, faturamento nem o histórico.
--
-- RISCO DE EXECUTAR: REABRE AUT-CP06-01. Um admin com token volta a criar, pela API, serviço de contêiner
-- com receita própria por um caminho que não existe na interface (cobrança paralela; ver SQL 090 C1/D4/D5
-- e docs/qa/CP-10-seguranca-integridade-infraestrutura.md). Só executar com autorização específica, por
-- ambiente, e com motivo registrado (ex.: um consumidor legítimo esquecido que não pode esperar a correção).
--
-- COMPATIBILIDADE: o app do #134 não chama esta RPC (cadastro encerrado na Server Action); a reversão não
-- muda nada nele. Um app anterior ao #134 volta a cadastrar pela tela antiga por URL.
-- `corrigir_servico_container` funciona igual com ou sem o EXECUTE de authenticated (chama como dona).
--
-- REVALIDAR DEPOIS: SQL 090 C1 volta a mostrar o cadastro aceito pela API (a suíte da 052 passa a falhar,
-- de propósito); spec 99 M8 falha; `has_function_privilege('authenticated', …, 'EXECUTE')` = true.
--
-- Para o histórico de migrations voltar a apontar para 051, remova o registro da 052 somente depois da
-- aprovação explícita da recuperação:
--   delete from supabase_migrations.schema_migrations where version = '20261119120000';
begin;

grant execute on function public.registrar_servico_container(jsonb, uuid, text) to authenticated;

comment on function public.registrar_servico_container(jsonb, uuid, text) is null;

do $$
begin
  if not has_function_privilege('authenticated', 'public.registrar_servico_container(jsonb,uuid,text)', 'EXECUTE') then
    raise exception 'rollback 052: authenticated deveria voltar a executar a RPC.';
  end if;
  if has_function_privilege('anon', 'public.registrar_servico_container(jsonb,uuid,text)', 'EXECUTE') then
    raise exception 'rollback 052: anon não pode executar a RPC.';
  end if;
end;
$$;

commit;
