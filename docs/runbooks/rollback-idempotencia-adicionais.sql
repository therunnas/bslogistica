-- FIN-20D. Origem: schema 047. Destino: 046 (adicional sem chave idempotente).
--
-- Este rollback só é seguro quando NENHUM adicional tiver chave/payload da 047.
-- A chave identifica uma intenção e seu payload permite replay seguro; apagá-los
-- após uso destruiria a proteção contra duplicidade e a evidência associada. Por
-- isso o script RECUSA dados idempotentes em vez de removê-los. Preserve o
-- histórico e corrija o consumidor se já houver qualquer uma dessas linhas.
--
-- Não use CASCADE, não altera valores, faturas, lastro, RLS nem migrations
-- posteriores. Antes de qualquer execução autorizada, confirme a compatibilidade
-- do aplicativo: o app FIN-20D faz fallback para a RPC antiga apenas quando a
-- RPC nova estiver ausente (PGRST202), mas perde a garantia de idempotência.
--
-- Para o histórico de migrations voltar a apontar para 046, remova o registro da
-- 047 somente depois da aprovação explícita da recuperação:
--   delete from supabase_migrations.schema_migrations where version = '20261114120000';
--
-- A trava falha imediatamente (55P03) se houver registro, cancelamento ou
-- faturamento concorrente do adicional; não aguarda e não descarta trabalho.
begin;

lock table public.billing_additionals in access exclusive mode nowait;

do $$
begin
  if exists (
    select 1
      from public.billing_additionals
     where idempotency_key is not null or request_payload is not null
  ) then
    raise exception
      'Reversão recusada: há adicionais idempotentes da 047. Preserve chave, payload e histórico; não os descarte para voltar à 046.'
      using errcode = '55000';
  end if;
end;
$$;

drop function public.registrar_adicional_idempotente(uuid, uuid, date, date, text, numeric, text, uuid, date, date);
drop function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date, uuid, jsonb);
drop index public.billing_additionals_idempotency_key_uidx;

alter table public.billing_additionals
  drop constraint billing_additionals_idempotencia_coerente,
  drop column request_payload,
  drop column idempotency_key;

-- Corpo vigente da 046 (originado na 038), restaurado sem a chave/payload.
create function public.registrar_adicional(
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

  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));

  if p_billing_period_start is not null then
    perform public.validar_periodo_de_cobranca(p_client_id, p_billing_period_start, p_billing_period_end);
    v_cob_inicio := p_billing_period_start;
    v_cob_fim := p_billing_period_end;
  else
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
     billing_period_start, billing_period_end)
  values
    (p_client_id, p_operation_id, p_period_start, p_period_end, v_descricao, v_referencia, p_amount, auth.uid(),
     v_cob_inicio, v_cob_fim)
  returning * into v_novo;

  perform public.condicoes_auditar('adicional_registrado', 'adicional', v_novo.id, v_novo.id,
    null, to_jsonb(v_novo), v_descricao);

  return v_novo.id;
end;
$$;

alter function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date) owner to postgres;
revoke all on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date)
  from public, anon, authenticated, service_role, bslog_rpc_operacional;
grant execute on function public.registrar_adicional(uuid, date, date, text, numeric, text, uuid, date, date)
  to authenticated;

commit;
