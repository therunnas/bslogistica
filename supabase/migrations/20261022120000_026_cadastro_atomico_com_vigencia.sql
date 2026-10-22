-- Cadastro atômico de entidade + vigência inicial (C05-B5.1).
--
-- PROBLEMA. Com o motor por vigência ligado, o preço vem da vigência. Cadastrar um contrato, um
-- colaborador ou uma operação sem contrato exigia DUAS chamadas do navegador: o INSERT da
-- entidade e, depois, a RPC de registro da primeira vigência (023/024). Se a segunda falhasse, a
-- entidade ficava sem condição financeira (aparecia nas pendências do motor, e os apontamentos
-- remuneráveis dela eram recusados).
--
-- SOLUÇÃO. Três funções que fazem os dois passos na MESMA chamada — e, portanto, na mesma
-- transação: se a vigência falhar (sobreposição, motivo vazio, valor inválido, sem permissão),
-- o INSERT da entidade é desfeito junto.
--
--   public.criar_contrato_com_vigencia(...)      -> uuid do contrato
--   public.criar_colaborador_com_vigencia(...)   -> uuid do colaborador
--   public.criar_operacao_com_vigencia(...)      -> uuid da operação (SEM contrato)
--
-- DESENHO DE SEGURANÇA
--
--   * SECURITY INVOKER, de propósito. As funções NÃO elevam privilégio: o INSERT da entidade roda
--     como o chamador, sob a RLS e os triggers que já valem hoje para o INSERT direto (admin em
--     AAL2; operacional, admin em AAL1 e anônimo são recusados pelas policies RESTRICTIVE). A
--     vigência é registrada pelas RPCs 023/024 (SECURITY DEFINER), que revalidam por dentro
--     admin AAL2, motivo, valores e sobreposição, e gravam a trilha `financial_terms_audit`.
--     Nada é reimplementado aqui: as regras de vigência continuam num só lugar.
--   * EXECUTE só para `authenticated`; dono `postgres`; `search_path` fixo.
--   * Não presume vigência histórica: a vigência começa na data informada pelo chamador (a tela
--     envia a data de início do contrato, o dia do cadastro ou a data da operação) e fica aberta.
--   * Não recalcula nada: nenhum apontamento, fatura ou legado é tocado.
--   * Vale também com o motor DESLIGADO (as versões ficam preparadas, como no registro avulso);
--     a tela só a usa com o motor ligado e continua com o INSERT direto quando está desligado.
--
-- Não altera nenhuma migration anterior, nenhuma policy, nenhum grant de tabela e nenhum trigger.
--
-- ROLLBACK (só se nenhuma entidade criada por estas funções precisar ser mantida; as funções não
-- guardam estado):
--   drop function public.criar_operacao_com_vigencia(uuid, text, text, text, date, text, text, numeric, date, text);
--   drop function public.criar_colaborador_com_vigencia(text, text, text, text, text, numeric, date, text);
--   drop function public.criar_contrato_com_vigencia(uuid, text, date, date, text, numeric, numeric, numeric, integer, text);

create or replace function public.criar_contrato_com_vigencia(
  p_client_id          uuid,
  p_name               text,
  p_valid_from         date,
  p_valid_to           date,
  p_status             text,
  p_daily_rate         numeric,
  p_shift_hours        numeric,
  p_ot_factor          numeric,
  p_ot_tolerance_min   integer,
  p_reason             text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.contracts
    (client_id, name, valid_from, valid_to, status, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values
    (p_client_id, p_name, p_valid_from, p_valid_to, p_status::public.record_status,
     p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min)
  returning id into v_id;

  -- Uma exceção daqui desfaz o INSERT acima: é a mesma transação.
  perform public.registrar_condicao_contrato(
    v_id, p_valid_from, p_daily_rate, p_shift_hours, p_ot_factor, p_ot_tolerance_min, p_reason);

  return v_id;
end;
$$;

create or replace function public.criar_colaborador_com_vigencia(
  p_name         text,
  p_doc          text,
  p_role         text,
  p_phone        text,
  p_status       text,
  p_daily_cost   numeric,
  p_valid_from   date,
  p_reason       text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.employees (name, doc, role, phone, status, daily_cost)
  values (p_name, p_doc, p_role, p_phone, p_status::public.record_status, p_daily_cost)
  returning id into v_id;

  perform public.registrar_custo_colaborador(v_id, p_valid_from, p_daily_cost, p_reason);

  return v_id;
end;
$$;

create or replace function public.criar_operacao_com_vigencia(
  p_client_id        uuid,
  p_type             text,
  p_name             text,
  p_site             text,
  p_operation_date   date,
  p_status           text,
  p_notes            text,
  p_agreed_amount    numeric,
  p_valid_from       date,
  p_reason           text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- O valor acordado só existe para operação SEM contrato (com contrato, o preço é o do contrato).
  if p_agreed_amount is null then
    raise exception 'Informe o valor acordado da operação.' using errcode = '22023';
  end if;

  insert into public.operations
    (client_id, contract_id, type, name, site, operation_date, status, notes, agreed_amount)
  values
    (p_client_id, null, p_type::public.operation_type, p_name, p_site, p_operation_date,
     p_status::public.record_status, p_notes, p_agreed_amount)
  returning id into v_id;

  perform public.registrar_valor_acordado_operacao(v_id, p_valid_from, p_agreed_amount, p_reason);

  return v_id;
end;
$$;

do $privilegios$
declare
  _f record;
begin
  for _f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('criar_contrato_com_vigencia', 'criar_colaborador_com_vigencia',
                         'criar_operacao_com_vigencia')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    execute format('grant execute on function %s to authenticated', _f.assinatura);
  end loop;
end;
$privilegios$;

comment on function public.criar_contrato_com_vigencia(uuid, text, date, date, text, numeric, numeric, numeric, integer, text) is
  'Admin AAL2. Cria o contrato e a vigencia inicial na mesma transacao (falha da vigencia desfaz o contrato). SECURITY INVOKER: o INSERT segue a RLS; a vigencia vai pela registrar_condicao_contrato.';
comment on function public.criar_colaborador_com_vigencia(text, text, text, text, text, numeric, date, text) is
  'Admin AAL2. Cria o colaborador e o custo inicial na mesma transacao. SECURITY INVOKER; o custo vai pela registrar_custo_colaborador.';
comment on function public.criar_operacao_com_vigencia(uuid, text, text, text, date, text, text, numeric, date, text) is
  'Admin AAL2. Cria operacao SEM contrato e o valor acordado inicial na mesma transacao. SECURITY INVOKER; o valor vai pela registrar_valor_acordado_operacao.';
