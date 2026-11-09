-- FUNC-READY-01 — Correção de serviço de container sem cancelar e recriar à mão.
-- SOMENTE LOCAL até autorização própria para HML/Production. Depende da 045 (e da 047 para os adicionais).
--
-- DEFEITO (045). O serviço só podia ser registrado ou cancelado: corrigir um campo (quantidade, valor,
-- participante, data, descrição) obrigava o usuário a cancelar e registrar de novo, em duas operações
-- independentes, digitando tudo outra vez e sem vínculo entre o original e o substituto.
--
-- CORREÇÃO (aditiva). `corrigir_servico_container(id, dados, chave, motivo)` faz a TROCA ATÔMICA numa só
-- transação, reutilizando os caminhos que já protegem o lastro:
--   1. o original é cancelado por `cancelar_servico_container` (motivo "Correção: ..."), que cancela o
--      adicional e grava a trilha `canceled`;
--   2. o substituto é registrado por `registrar_servico_container` com a chave de idempotência da correção
--      (novo adicional, participantes e trilha `registered`);
--   3. a trilha ganha a ação `corrected` no original, com o antes e o depois (id do substituto).
-- Nada é atualizado no lugar: a imutabilidade do serviço, dos participantes e da trilha (045) continua igual.
--
-- REGRAS
--   * Só serviço disponível: cancelado ou faturado é recusado (55000), como no cancelamento.
--   * Mesmo cliente: trocar o cliente é recusado (22023); o caminho é cancelar e registrar no outro cliente.
--   * Dados idênticos aos do original são recusados (22023): correção sem mudança não gera trilha.
--   * Repetição da MESMA correção (mesma chave e mesmo payload) devolve o mesmo substituto, sem duplicar;
--     a mesma chave com outro payload é recusada (23505). A trava por cliente é a mesma da fatura.
--   * Exige admin e o piso de MFA dentro da função (SECURITY DEFINER), como as RPCs da 045.
--   * `estado_motor_vigencia` anuncia `correcao_container` (a tela só oferece "Corrigir" com o anúncio).
--
-- REVERSÃO: drop da função e volta do CHECK de `container_service_audit.action` para ('registered','canceled'),
-- só se não houver trilha `corrected`.

begin;

alter table public.container_service_audit
  drop constraint container_service_audit_action_check,
  add constraint container_service_audit_action_check
    check (action in ('registered', 'canceled', 'corrected'));

create function public.corrigir_servico_container(
  p_id uuid,
  p_dados jsonb,
  p_idempotency_key uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_reason text;
  v_payload jsonb;
  v_old public.container_services%rowtype;
  v_existing public.container_services%rowtype;
  v_additional public.billing_additionals%rowtype;
  v_new uuid;
begin
  perform public.condicoes_exigir_admin();
  v_reason := public.condicoes_validar_motivo(p_reason);
  if p_id is null or p_idempotency_key is null then
    raise exception 'Informe o serviço e a chave de idempotência da correção.' using errcode = '22023';
  end if;
  v_payload := public.normalizar_payload_container(p_dados);
  select * into v_old from public.container_services where id = p_id;
  if not found then
    raise exception 'Serviço de container não encontrado.' using errcode = 'P0002';
  end if;
  if (v_payload ->> 'clienteId')::uuid is distinct from v_old.client_id then
    raise exception 'A correção não troca o cliente: cancele e registre o serviço no outro cliente.'
      using errcode = '22023';
  end if;
  -- Mesma trava de registrar, cancelar, adicionais e gerar_fatura do cliente.
  perform pg_advisory_xact_lock(hashtextextended(v_old.client_id::text, 0));

  -- Repetição da mesma correção (resposta perdida, duplo clique): devolve o substituto já criado.
  select * into v_existing from public.container_services
   where client_id = v_old.client_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload is distinct from v_payload
       or not exists (select 1 from public.container_service_audit a
                       where a.service_id = p_id and a.action = 'corrected'
                         and a.after_data ->> 'id' = v_existing.id::text) then
      raise exception 'Chave de idempotência já usada com outro payload.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  select * into v_old from public.container_services where id = p_id for update;
  select * into v_additional from public.billing_additionals where id = v_old.billing_additional_id for update;
  if v_old.canceled_at is not null or v_additional.canceled_at is not null or v_additional.invoice_id is not null then
    raise exception 'Serviço cancelado ou faturado não pode ser corrigido.' using errcode = '55000';
  end if;
  if v_payload is not distinct from v_old.request_payload then
    raise exception 'Nada a corrigir: os dados são iguais aos do serviço.' using errcode = '22023';
  end if;

  perform public.cancelar_servico_container(p_id, left('Correção: ' || v_reason, 1000));
  v_new := public.registrar_servico_container(p_dados, p_idempotency_key, left('Correção: ' || v_reason, 1000));

  insert into public.container_service_audit(service_id, action, actor_id, actor_session_id, reason, before_data, after_data)
  values (p_id, 'corrected', auth.uid(), auth.jwt() ->> 'session_id', v_reason,
          (select to_jsonb(s) from public.container_services s where s.id = p_id),
          (select to_jsonb(s) from public.container_services s where s.id = v_new));
  return v_new;
end;
$$;

comment on function public.corrigir_servico_container(uuid, jsonb, uuid, text) is
  'FUNC-READY-01: troca atômica de um serviço de container disponível (cancela o original e registra o substituto, com trilha corrected). Nada é alterado no lugar.';

revoke all on function public.corrigir_servico_container(uuid, jsonb, uuid, text)
  from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant execute on function public.corrigir_servico_container(uuid, jsonb, uuid, text) to authenticated;

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
    -- FUNC-READY-01 (048): preço-base do contrato como 3º nível da precedência com a resolução ligada.
    'preco_base_recuo', true,
    -- FUNC-READY-01 (049): correção atômica de serviço de container.
    'correcao_container', true,
    'calendario_territorial', true);
end;
$function$;


commit;
