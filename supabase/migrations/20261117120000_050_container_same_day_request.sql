-- FUNC-01 / 050: pedido de serviço pode ocorrer no mesmo dia da execução.
-- Nova regra confirmada: solicitadoEm <= executadoEm. Depende somente da 045.
-- Não reescreve dados, valores, snapshots, participantes, faturas ou trilhas.
-- Mantém normalizador IMMUTABLE/INVOKER, assinatura, proprietário e ACL existentes.
--
-- Versionamento: 046–049 estão no candidato #111. Esta versão ordena depois da 049.
-- Localmente validar 045→050 e 045→046→047→048→049→050. Em HML, não publicar 050
-- antes de definir/integrar o prefixo 046–049: evitar versões pendentes anteriores.
-- Nenhuma aplicação remota é autorizada por esta migration ou por um Preview.
-- Reversão para '<' exigiria verificar registros do mesmo dia e decisão própria;
-- nunca excluir nem alterar histórico para permitir o retorno da restrição antiga.

begin;

-- Uma estrutura divergente exige revisão, não a remoção de outro CHECK por engano.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.container_services'::regclass
       and conname = 'container_services_check'
       and contype = 'c'
       and pg_get_expr(conbin, conrelid) = '(requested_on < executed_on)'
  ) then
    raise exception 'Restrição de datas de container divergente da 045; revisar antes de aplicar a 050.';
  end if;
end;
$$;

alter table public.container_services
  drop constraint container_services_check,
  add constraint container_services_request_execution_check
    check (requested_on <= executed_on);

create or replace function public.normalizar_payload_container(p_dados jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_item jsonb;
  v_comp jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_client uuid;
  v_operation uuid;
  v_requested date;
  v_executed date;
  v_start date;
  v_end date;
  v_number numeric;
  v_total numeric := 0;
  v_participants jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_dados) is distinct from 'object'
     or not (p_dados ?& array['clienteId','operacaoId','solicitadoEm','executadoEm','descricao',
       'quantidade','receitaCentavos','custoTotalCentavos','referencia','participantes',
       'modalidadeCusto','competenciaCobranca'])
     or exists (select 1 from jsonb_object_keys(p_dados) k where k <> all(array[
       'clienteId','operacaoId','solicitadoEm','executadoEm','descricao','quantidade',
       'receitaCentavos','custoTotalCentavos','referencia','participantes','modalidadeCusto','competenciaCobranca'])) then
    raise exception 'Payload de container incompleto ou com campos desconhecidos.' using errcode = '22023';
  end if;
  foreach v_key in array array['clienteId','solicitadoEm','executadoEm','descricao','modalidadeCusto'] loop
    if jsonb_typeof(p_dados -> v_key) is distinct from 'string' then
      raise exception 'Campo textual inválido: %.', v_key using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array array['operacaoId','referencia'] loop
    if jsonb_typeof(p_dados -> v_key) not in ('string', 'null') then
      raise exception 'Campo opcional inválido: %.', v_key using errcode = '22023';
    end if;
  end loop;
  v_client := (p_dados ->> 'clienteId')::uuid;
  v_operation := (p_dados ->> 'operacaoId')::uuid;
  if (p_dados ->> 'solicitadoEm') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (p_dados ->> 'executadoEm') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Informe datas civis ISO válidas.' using errcode = '22023';
  end if;
  v_requested := (p_dados ->> 'solicitadoEm')::date;
  v_executed := (p_dados ->> 'executadoEm')::date;
  if v_requested > v_executed then
    raise exception 'A solicitação não pode ser posterior à execução.' using errcode = '22023';
  end if;
  if char_length(btrim(p_dados ->> 'descricao')) not between 1 and 500
     or char_length(btrim(coalesce(p_dados ->> 'referencia', ''))) > 200
     or (p_dados ->> 'modalidadeCusto') not in ('por_pessoa', 'total_distribuido') then
    raise exception 'Descrição, referência ou modalidade de custo inválida.' using errcode = '22023';
  end if;
  foreach v_key in array array['quantidade','receitaCentavos','custoTotalCentavos'] loop
    if jsonb_typeof(p_dados -> v_key) is distinct from 'number' then
      raise exception 'Valor inteiro obrigatório: %.', v_key using errcode = '22023';
    end if;
    v_number := (p_dados ->> v_key)::numeric;
    if v_number <> trunc(v_number) or v_number < (case when v_key = 'custoTotalCentavos' then 0 else 1 end)
       or v_number > (case when v_key = 'quantidade' then 9007199254740991 else 999999999999 end) then
      raise exception 'Valor inteiro fora do limite: %.', v_key using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_dados -> 'participantes') is distinct from 'array'
     or jsonb_array_length(p_dados -> 'participantes') = 0 then
    raise exception 'Informe os participantes do serviço.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_dados -> 'participantes') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or not (v_item ?& array['colaboradorId','custoCentavos'])
       or exists (select 1 from jsonb_object_keys(v_item) k where k <> all(array['colaboradorId','custoCentavos']))
       or jsonb_typeof(v_item -> 'colaboradorId') is distinct from 'string'
       or jsonb_typeof(v_item -> 'custoCentavos') is distinct from 'number' then
      raise exception 'Participante inválido ou com campos desconhecidos.' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'colaboradorId')::uuid;
    v_number := (v_item ->> 'custoCentavos')::numeric;
    if v_number <> trunc(v_number) or v_number < 0 or v_number > 999999999999 or v_id = any(v_ids) then
      raise exception 'Custo inválido ou participante duplicado.' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_total := v_total + v_number;
    v_participants := v_participants || jsonb_build_array(jsonb_build_object('colaboradorId', v_id, 'custoCentavos', v_number::bigint));
  end loop;
  if v_total > 999999999999 or v_total <> (p_dados ->> 'custoTotalCentavos')::numeric then
    raise exception 'A soma dos participantes deve igualar o custo total informado.' using errcode = '22023';
  end if;
  if p_dados -> 'competenciaCobranca' <> 'null'::jsonb then
    v_comp := p_dados -> 'competenciaCobranca';
    if jsonb_typeof(v_comp) is distinct from 'object'
       or not (v_comp ?& array['inicio','fim'])
       or exists (select 1 from jsonb_object_keys(v_comp) k where k <> all(array['inicio','fim']))
       or jsonb_typeof(v_comp -> 'inicio') is distinct from 'string'
       or jsonb_typeof(v_comp -> 'fim') is distinct from 'string'
       or (v_comp ->> 'inicio') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_comp ->> 'fim') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Competência de cobrança inválida.' using errcode = '22023';
    end if;
    v_start := (v_comp ->> 'inicio')::date;
    v_end := (v_comp ->> 'fim')::date;
    if v_start > v_end then
      raise exception 'Competência de cobrança invertida.' using errcode = '22023';
    end if;
    v_comp := jsonb_build_object('inicio', v_start, 'fim', v_end);
  end if;
  select jsonb_agg(value order by value ->> 'colaboradorId') into v_participants from jsonb_array_elements(v_participants);
  return jsonb_build_object('clienteId', v_client, 'operacaoId', v_operation,
    'solicitadoEm', v_requested, 'executadoEm', v_executed,
    'descricao', btrim(p_dados ->> 'descricao'), 'quantidade', (p_dados ->> 'quantidade')::bigint,
    'receitaCentavos', (p_dados ->> 'receitaCentavos')::bigint, 'custoTotalCentavos', v_total::bigint,
    'referencia', nullif(btrim(p_dados ->> 'referencia'), ''), 'participantes', v_participants,
    'modalidadeCusto', p_dados ->> 'modalidadeCusto', 'competenciaCobranca', v_comp);
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    raise exception 'Identificador, data ou valor de container inválido.' using errcode = '22023';
end;
$$;

commit;
