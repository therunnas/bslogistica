-- FIN-20D — Idempotência do registro de adicionais (duplo clique, reenvio HTTP, retry após timeout).
--
-- DEFEITO (baseline 046). `registrar_adicional` não tem chave de idempotência: a mesma chamada feita duas
-- vezes (duplo clique, reenvio, timeout seguido de retry) grava DOIS adicionais, cobra duas vezes na fatura
-- e escreve duas trilhas. O serviço de container já resolve isso (chave + payload, 045); o adicional avulso não.
--
-- CORREÇÃO (aditiva; nenhuma linha existente é alterada, nenhuma regra comercial muda):
--   1. `billing_additionals` ganha `idempotency_key` e `request_payload` (nulos nos existentes e nos adicionais
--      criados por Containers, que têm a própria idempotência), um CHECK de coerência e UNIQUE parcial na chave.
--      A imutabilidade do adicional (proteger_adicional) passa a cobrir as duas colunas.
--   2. Nova RPC pública `registrar_adicional_idempotente(chave, ...)`: a chave é obrigatória e identifica a
--      INTENÇÃO. Mesma chave + mesmo payload normalizado devolve o MESMO adicional (mesmo depois de faturado ou
--      cancelado), sem nova linha e sem nova trilha; mesma chave + payload diferente é recusada (23505).
--      Chaves diferentes com dados iguais são operações distintas e criam dois adicionais.
--   3. A RPC antiga `registrar_adicional` deixa de ser executável por qualquer papel da API (caminho que
--      contornaria a proteção) e vira função interna: só Containers (SECURITY DEFINER) a chama, sem chave.
--
-- CONCORRÊNCIA. A RPC nova toma a MESMA trava por cliente de gerar_fatura, registrar_adicional e
-- cancelar_adicional (pg_advisory_xact_lock) ANTES de consultar a chave: retry, registro e fatura do cliente
-- são serializados. O UNIQUE é a rede de segurança (chave repetida entre clientes diferentes).
--
-- TRANSIÇÃO. Cliente antigo (frontend sem a chave) chamando `registrar_adicional` recebe 42501 depois desta
-- migration. O frontend novo detecta a ausência da RPC nova (PGRST202) e, só nesse caso, usa a antiga, que
-- continua existindo no banco anterior à 047. Ordem segura: publicar o frontend, depois aplicar a 047.
-- Rollback: docs/runbooks/rollback-idempotencia-adicionais.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Chave e payload normalizado no próprio adicional.
-- ---------------------------------------------------------------------------
alter table public.billing_additionals
  add column idempotency_key uuid,
  add column request_payload jsonb,
  add constraint billing_additionals_idempotencia_coerente
    check ((idempotency_key is null) = (request_payload is null));

create unique index billing_additionals_idempotency_key_uidx
  on public.billing_additionals (idempotency_key) where idempotency_key is not null;

comment on column public.billing_additionals.idempotency_key is
  'Chave da INTENÇÃO de registro (gerada pelo cliente). Nula em adicionais anteriores à 047 e nos criados por Containers. Imutável.';
comment on column public.billing_additionals.request_payload is
  'Payload normalizado da intenção, comparado em cada retry da mesma chave. Imutável.';

-- ---------------------------------------------------------------------------
-- 2. A função existente vira INTERNA e ganha chave/payload opcionais (mesma lógica da 038).
--    Containers a chama com 9 argumentos: a chave e o payload nascem nulos.
-- ---------------------------------------------------------------------------
drop function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date);

create function public.registrar_adicional(
  p_client_id            uuid,
  p_period_start         date,
  p_period_end           date,
  p_description          text,
  p_amount               numeric,
  p_reference            text default null,
  p_operation_id         uuid default null,
  p_billing_period_start date default null,
  p_billing_period_end   date default null,
  p_idempotency_key      uuid default null,
  p_request_payload      jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_descricao  text := btrim(coalesce(p_description, ''));
  v_referencia text := nullif(btrim(coalesce(p_reference, '')), '');
  v_novo       public.billing_additionals%rowtype;
  v_freq       text;
  v_cob_inicio date;
  v_cob_fim    date;
begin
  perform public.condicoes_exigir_admin();

  if p_client_id is null or p_period_start is null or p_period_end is null or p_amount is null then
    raise exception 'Cliente, período e valor são obrigatórios.' using errcode = '22023';
  end if;
  if v_descricao = '' then
    raise exception 'O motivo do adicional é obrigatório.' using errcode = '22023';
  end if;
  if char_length(v_descricao) > 500 then
    raise exception 'O motivo do adicional deve ter no máximo 500 caracteres.' using errcode = '22023';
  end if;
  if v_referencia is not null and char_length(v_referencia) > 200 then
    raise exception 'A referência deve ter no máximo 200 caracteres.' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Período inválido: início (%) posterior ao fim (%).', p_period_start, p_period_end
      using errcode = '22023';
  end if;
  if (p_billing_period_start is null) <> (p_billing_period_end is null) then
    raise exception 'Informe o início e o fim da competência de cobrança, ou nenhum dos dois.' using errcode = '22023';
  end if;
  if p_amount <= 0 then
    raise exception 'O valor do adicional deve ser maior que zero.' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'O valor do adicional aceita no máximo duas casas decimais.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
  if p_operation_id is not null
     and not exists (select 1 from public.operations where id = p_operation_id and client_id = p_client_id) then
    raise exception 'A operação informada não pertence ao cliente.' using errcode = '22023';
  end if;

  -- A mesma trava de `gerar_fatura`: um registro não corre junto com a fatura do cliente.
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));

  -- A competência é uma janela inteira da frequência do cliente; a execução pode estar fora dela.
  if p_billing_period_start is not null then
    perform public.validar_periodo_de_cobranca(p_client_id, p_billing_period_start, p_billing_period_end);
    v_cob_inicio := p_billing_period_start;
    v_cob_fim := p_billing_period_end;
  else
    -- Sem competência (app anterior à 038 ou chamada direta): a competência é a que contém a
    -- execução inteira. Execução que não cabe numa competência é recusada: gravada assim, nunca
    -- caberia numa fatura (receita presa).
    v_freq := public.frequencia_de_fechamento(p_client_id, p_period_start);
    v_cob_inicio := date_trunc('month', p_period_start)::date;
    v_cob_fim := (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date;
    if v_freq = 'quinzenal' then
      if extract(day from p_period_start) > 15 then
        v_cob_inicio := v_cob_inicio + 15;
      else
        v_cob_fim := v_cob_inicio + 14;
      end if;
    end if;
    if p_period_end > v_cob_fim then
      raise exception 'A execução de % a % não cabe numa competência % do cliente: informe a competência de cobrança.',
        to_char(p_period_start, 'DD/MM/YYYY'), to_char(p_period_end, 'DD/MM/YYYY'), v_freq
        using errcode = '22023',
              hint = 'Informe p_billing_period_start e p_billing_period_end (uma quinzena ou o mês, conforme o contrato).';
    end if;
  end if;

  insert into public.billing_additionals
    (client_id, operation_id, period_start, period_end, description, reference, amount, created_by,
     billing_period_start, billing_period_end, idempotency_key, request_payload)
  values
    (p_client_id, p_operation_id, p_period_start, p_period_end, v_descricao, v_referencia, p_amount, auth.uid(),
     v_cob_inicio, v_cob_fim, p_idempotency_key, p_request_payload)
  returning * into v_novo;

  perform public.condicoes_auditar('adicional_registrado', 'adicional', v_novo.id, v_novo.id,
    null, to_jsonb(v_novo), v_descricao);

  return v_novo.id;
end;
$$;

alter function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date, uuid, jsonb) owner to postgres;
revoke all on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date, uuid, jsonb)
  from public, anon, authenticated, service_role, bslog_rpc_operacional;

comment on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date, uuid, jsonb) is
  'INTERNA (sem EXECUTE para a API desde a 047). Registra adicional de servico: periodo de EXECUCAO e competencia de COBRANCA. Chamada por registrar_adicional_idempotente e por registrar_servico_container. Trilha.';

-- ---------------------------------------------------------------------------
-- 3. A porta pública: idempotente e com a mesma autorização da antiga (admin).
-- ---------------------------------------------------------------------------
create function public.registrar_adicional_idempotente(
  p_idempotency_key      uuid,
  p_client_id            uuid,
  p_period_start         date,
  p_period_end           date,
  p_description          text,
  p_amount               numeric,
  p_reference            text default null,
  p_operation_id         uuid default null,
  p_billing_period_start date default null,
  p_billing_period_end   date default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payload  jsonb;
  v_existing public.billing_additionals%rowtype;
  v_id       uuid;
begin
  -- Autorização ANTES de qualquer leitura: quem não é admin não descobre se uma chave existe.
  perform public.condicoes_exigir_admin();

  if p_idempotency_key is null then
    raise exception 'A chave de idempotência é obrigatória.' using errcode = '22023';
  end if;

  -- Payload normalizado: o que a intenção significa, não como foi digitada.
  v_payload := jsonb_build_object(
    'clienteId', p_client_id,
    'operacaoId', p_operation_id,
    'inicio', p_period_start,
    'fim', p_period_end,
    'descricao', btrim(coalesce(p_description, '')),
    'referencia', nullif(btrim(coalesce(p_reference, '')), ''),
    'valor', p_amount,
    'competenciaInicio', p_billing_period_start,
    'competenciaFim', p_billing_period_end);

  -- A mesma trava de gerar_fatura, registrar_adicional e cancelar_adicional.
  if p_client_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));
  end if;

  select * into v_existing from public.billing_additionals where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload is distinct from v_payload then
      raise exception 'Chave de idempotência já usada com outro payload.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  begin
    v_id := public.registrar_adicional(
      p_client_id, p_period_start, p_period_end, p_description, p_amount, p_reference, p_operation_id,
      p_billing_period_start, p_billing_period_end, p_idempotency_key, v_payload);
  exception when unique_violation then
    -- Corrida em que outra transação (de outro cliente, logo sem a mesma trava) gravou a chave primeiro.
    select * into v_existing from public.billing_additionals where idempotency_key = p_idempotency_key;
    if found and v_existing.request_payload is not distinct from v_payload then
      return v_existing.id;
    end if;
    raise exception 'Chave de idempotência já usada com outro payload.' using errcode = '23505';
  end;

  return v_id;
end;
$$;

alter function public.registrar_adicional_idempotente(uuid, uuid, date, date, text, numeric, text, uuid, date, date) owner to postgres;
revoke all on function public.registrar_adicional_idempotente(uuid, uuid, date, date, text, numeric, text, uuid, date, date)
  from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant execute on function public.registrar_adicional_idempotente(uuid, uuid, date, date, text, numeric, text, uuid, date, date)
  to authenticated;

comment on function public.registrar_adicional_idempotente(uuid, uuid, date, date, text, numeric, text, uuid, date, date) is
  'Admin. Registra adicional de servico com chave de idempotencia obrigatoria: mesma chave e mesmo payload devolvem o mesmo adicional (sem nova linha nem nova trilha); payload diferente = 23505. Mesma trava por cliente de gerar_fatura. FIN-20D (047).';

commit;
