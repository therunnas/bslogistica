-- GATE-FIN-02 / AUT-CP06-01 — Encerra no BANCO o cadastro novo pela RPC legada de contêiner.
-- SOMENTE LOCAL + CI até autorização própria para HML/Production.
--
-- DEFEITO (CP-10, SQL 090 C1). O painel independente de Contêineres saiu no CP-06B e a Server Action de
-- cadastro recusa desde o CP-06 (D7), mas `registrar_servico_container(jsonb,uuid,text)` continuou
-- executável por `authenticated` (045): um admin com token ainda criava, pela API, um serviço de
-- contêiner e o adicional de receita dele, por um caminho que não existe mais na interface. Contêiner é
-- tipo de serviço avulso (NEGOCIO.md §3A), registrado em Operações → Nova operação → Avulsa.
--
-- CORREÇÃO (só privilégio; nenhuma linha lida, escrita ou movida):
--   REVOKE EXECUTE da função para os papéis externos (PUBLIC, anon, authenticated, service_role). Pela
--   045 só `authenticated` tinha o EXECUTE; os demais entram no REVOKE para a migration ser idempotente e
--   explícita. A dona (`postgres`) mantém o EXECUTE implícito de dona.
--
-- O QUE NÃO MUDA
--   - A função continua existindo, com o mesmo corpo (nenhum DROP).
--   - `corrigir_servico_container` (049, SECURITY DEFINER, dona `postgres`) chama esta função por dentro,
--     como a dona: a correção de um registro antigo disponível segue funcionando, com a mesma guarda de
--     papel e MFA (lida do JWT), a mesma idempotência e a mesma trilha.
--   - `cancelar_servico_container`, `normalizar_payload_container`, as tabelas e os registros históricos,
--     o faturamento (`gerar_fatura`) e todo valor já gravado ou faturado.
--   - A consulta do histórico em Operações (leitura pela RLS, sem RPC).
--
-- COMPATIBILIDADE
--   App do #134: nenhum caminho chama esta RPC (o cadastro está encerrado na Server Action desde o
--   CP-06). App anterior ao #134 (ex.: o site `ecd67f2`): a tela antiga de cadastro por URL passa a
--   receber 42501 — é o efeito desejado. Nenhuma assinatura muda.
--
-- REVERSÃO: docs/runbooks/rollback-encerrar-cadastro-container-legado.sql (GRANT para authenticated;
-- reabre AUT-CP06-01).

begin;

revoke execute on function public.registrar_servico_container(jsonb, uuid, text)
  from public, anon, authenticated, service_role;

comment on function public.registrar_servico_container(jsonb, uuid, text) is
  '052 (AUT-CP06-01): cadastro NOVO pela API encerrado — nenhum papel externo executa. Usada só por dentro de corrigir_servico_container (dona postgres), para o substituto de um registro antigo disponível.';

-- ---------------------------------------------------------------------------
-- Autoverificação
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _f regprocedure := 'public.registrar_servico_container(jsonb,uuid,text)'::regprocedure;
  _papel text;
begin
  foreach _papel in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(_papel, _f, 'EXECUTE') then
      raise exception '052: % ainda executa registrar_servico_container.', _papel;
    end if;
  end loop;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = _f and a.privilege_type = 'EXECUTE'
       and a.grantee <> p.proowner
  ) then
    raise exception '052: há EXECUTE concedido a outro papel além da dona (inclusive PUBLIC).';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = _f and p.prosecdef
                   and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception '052: a função deveria continuar SECURITY DEFINER e da postgres.';
  end if;
  if not has_function_privilege('authenticated', 'public.corrigir_servico_container(uuid,jsonb,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.cancelar_servico_container(uuid,text)', 'EXECUTE') then
    raise exception '052: correção e cancelamento do histórico devem continuar disponíveis ao admin.';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = 'public.corrigir_servico_container(uuid,jsonb,uuid,text)'::regprocedure
                    and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception '052: corrigir_servico_container precisa seguir SECURITY DEFINER da postgres (chama a função encerrada como dona).';
  end if;
end;
$verificacao$;

commit;
