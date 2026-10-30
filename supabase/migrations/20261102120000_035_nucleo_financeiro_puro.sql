-- Núcleo financeiro puro (FIN-PR-01). ESTRITAMENTE ADITIVA: só cria funções novas.
--
-- O QUE É
--   Funções matemáticas puras (IMMUTABLE) que calculam os componentes de um lançamento: diária-
--   base, hora extra (fator do contrato, 50% = 150), horas especiais de domingo/feriado (fator 2 =
--   200), adicional diário, custo independente da cobrança e o total. Espelho exato de
--   `src/lib/nucleo-financeiro.ts`; as duas implementações são conferidas contra um oráculo
--   independente (`scripts/_oraculo-financeiro.mjs`) e contra casos calculados à mão
--   (`scripts/fixtures/nucleo-financeiro-golden.json`) pela suíte `supabase/tests/035_*.sql`.
--
-- O QUE NÃO É
--   Nenhuma função, gatilho, policy ou tela usa estas funções nesta etapa. O cálculo em vigor
--   continua sendo `derivar_valores_por_vigencia()` (030) e `derivar_valores_financeiros()` (010).
--   Nada aqui lê tabela, `auth.*`, sessão, relógio ou configuração: a entrada é só parâmetro.
--   Nada é concedido a `public`, `anon`, `authenticated` ou `service_role`.
--
-- DOIS COMPORTAMENTOS, SEPARADOS
--   * `nucleo_componentes_legado_010`: o motor antigo, para provar que a aritmética exata reproduz
--     o banco (100% da fixture do trigger real). Nenhuma regra nova.
--   * `nucleo_componentes_v2`: as regras confirmadas pelo cliente (FIN-DESENHO-01 R2).
--   O modo acumulado existente (`arredondar_minutos_extras`, 030) NÃO é tocado.
--
-- UNIDADES
--   dinheiro em centavos (bigint); tempo em minutos (integer); fatores em centésimos (integer).
--   A conta é feita em inteiros exatos (`numeric` sem divisão inexata) e arredondada uma vez,
--   meio centavo para cima. Ver o cabeçalho de `src/lib/nucleo-financeiro.ts` para as regras v2.
--
-- ERROS: SQLSTATE 22023, mensagem `nucleo:<codigo>: ...` com o mesmo código do TypeScript.
--
-- REVERSÃO (nada depende destas funções): docs/runbooks/rollback-nucleo-financeiro.sql

begin;

-- ---------------------------------------------------------------------------
-- Primitivas
-- ---------------------------------------------------------------------------

-- Inteiro mais próximo de numerador / denominador, meio para cima (não negativos).
create function public.nucleo_arredondar_centavos(p_numerador numeric, p_denominador numeric)
returns bigint
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  if p_numerador < 0 or p_denominador <= 0
     or p_numerador <> trunc(p_numerador) or p_denominador <> trunc(p_denominador) then
    raise exception 'nucleo:parametro_invalido: arredondamento exige inteiros, numerador >= 0 e denominador > 0.'
      using errcode = '22023';
  end if;
  return div(2 * p_numerador + p_denominador, 2 * p_denominador)::bigint;
end;
$$;

-- HE do modo diário: fração da hora < 15 min = 0; 15 a 44 = 30; >= 45 = 60. Horas inteiras ficam.
create function public.nucleo_arredondar_he_diaria(p_minutos integer)
returns integer
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  if p_minutos < 0 then
    raise exception 'nucleo:parametro_invalido: minutos devem ser >= 0.' using errcode = '22023';
  end if;
  return case
    when p_minutos % 60 < 15 then (p_minutos / 60) * 60
    when p_minutos % 60 < 45 then (p_minutos / 60) * 60 + 30
    else (p_minutos / 60 + 1) * 60
  end;
end;
$$;

-- Jornada líquida prevista de um turno (mesma regra do motor antigo).
create function public.nucleo_minutos_previstos(
  p_inicio    time,
  p_fim       time,
  p_intervalo integer,
  p_cruza     boolean
) returns integer
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  _i integer := extract(hour from p_inicio)::integer * 60 + extract(minute from p_inicio)::integer;
  _f integer := extract(hour from p_fim)::integer * 60 + extract(minute from p_fim)::integer;
begin
  if p_intervalo < 0 then
    raise exception 'nucleo:parametro_invalido: intervalo deve ser >= 0.' using errcode = '22023';
  end if;
  if p_cruza or _f <= _i then
    _f := _f + 1440;
  end if;
  return greatest(0, _f - _i - p_intervalo);
end;
$$;

-- Minutos trabalhados, líquidos do intervalo; NULL sem entrada e saída.
create function public.nucleo_minutos_trabalhados(
  p_entrada   time,
  p_saida     time,
  p_intervalo integer
) returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  _i integer;
  _f integer;
begin
  if p_intervalo is null or p_intervalo < 0 then
    raise exception 'nucleo:parametro_invalido: intervalo deve ser >= 0.' using errcode = '22023';
  end if;
  if p_entrada is null or p_saida is null then
    return null;
  end if;
  _i := extract(hour from p_entrada)::integer * 60 + extract(minute from p_entrada)::integer;
  _f := extract(hour from p_saida)::integer * 60 + extract(minute from p_saida)::integer;
  if _f <= _i then
    _f := _f + 1440;
  end if;
  return greatest(0, _f - _i - p_intervalo);
end;
$$;

-- ---------------------------------------------------------------------------
-- Regras v2
-- ---------------------------------------------------------------------------

create function public.nucleo_componentes_v2(
  p_status                  text,
  p_tipo_dia                text,
  p_entrada                 time,
  p_saida                   time,
  p_intervalo               integer,
  p_diaria                  bigint,
  p_fator_he                integer,
  p_fator_especial          integer,
  p_tolerancia              integer,
  p_modo_he                 text,
  p_arredondamento_especial text,
  p_adicional               bigint,
  p_custo_diario            bigint,
  p_custo_hora_he           bigint,
  out minutos_trabalhados       integer,
  out cruza_meia_noite          boolean,
  out he_minutos_cobrados       integer,
  out he_minutos_pagos          integer,
  out especial_minutos_cobrados integer,
  out base_centavos             bigint,
  out he_centavos               bigint,
  out especial_centavos         bigint,
  out adicional_centavos        bigint,
  out total_centavos            bigint,
  out custo_base_centavos       bigint,
  out custo_he_centavos         bigint,
  out custo_especial_centavos   bigint,
  out custo_total_centavos      bigint
)
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  -- 480 min (jornada de 8 h e divisor da hora, também no sábado) × 100 (centésimos de fator)
  _den        constant numeric := 48000;
  _completos  boolean;
  _min_ent    integer;
  _min_sai    integer;
  _referencia integer;
  _excesso    integer;
  _passa      boolean;
  _prop       boolean;
  _base_num   numeric;
  _he_num     numeric;
  _total_sem  bigint;
  _cbase_num  numeric;
  _che_num    numeric;
  _ctotal     bigint;
begin
  if p_status is null or p_status not in ('present', 'replacement', 'absent')
     or p_tipo_dia is null or p_tipo_dia not in ('util', 'sabado', 'domingo', 'feriado')
     or p_modo_he is null or p_modo_he not in ('diario', 'acumulado')
     or p_arredondamento_especial is null
     or p_arredondamento_especial not in ('minutos', 'meia_hora_15_45')
     or p_intervalo is null or p_intervalo < 0
     or p_diaria is null or p_diaria < 0
     or p_fator_he is null or p_fator_he < 1
     or p_fator_especial is null or p_fator_especial < 1
     or p_tolerancia is null or p_tolerancia < 0
     or p_adicional is null or p_adicional < 0
     or p_custo_diario is null or p_custo_diario < 0
     or (p_custo_hora_he is not null and p_custo_hora_he < 1) then
    raise exception 'nucleo:parametro_invalido: parâmetro ausente ou fora do domínio.'
      using errcode = '22023';
  end if;

  minutos_trabalhados := 0;
  cruza_meia_noite := false;
  he_minutos_cobrados := 0;
  he_minutos_pagos := 0;
  especial_minutos_cobrados := 0;
  base_centavos := 0;
  he_centavos := 0;
  especial_centavos := 0;
  adicional_centavos := 0;
  total_centavos := 0;
  custo_base_centavos := 0;
  custo_he_centavos := 0;
  custo_especial_centavos := 0;
  custo_total_centavos := 0;

  if p_status = 'absent' then
    if p_adicional > 0 then
      raise exception 'nucleo:falta_com_adicional: falta não recebe adicional.' using errcode = '22023';
    end if;
    return;
  end if;

  _completos := p_entrada is not null and p_saida is not null;
  if _completos then
    _min_ent := extract(hour from p_entrada)::integer * 60 + extract(minute from p_entrada)::integer;
    _min_sai := extract(hour from p_saida)::integer * 60 + extract(minute from p_saida)::integer;
    if _min_ent = _min_sai then
      raise exception 'nucleo:entrada_igual_saida: entrada igual à saída (jornada de 24 h).'
        using errcode = '22023';
    end if;
    minutos_trabalhados := public.nucleo_minutos_trabalhados(p_entrada, p_saida, p_intervalo);
    cruza_meia_noite := _min_sai <= _min_ent;
    if minutos_trabalhados = 0 then
      raise exception 'nucleo:zero_minuto_com_horarios: presença com entrada e saída e nenhum minuto trabalhado.'
        using errcode = '22023';
    end if;
  end if;

  adicional_centavos := p_adicional;

  if p_tipo_dia in ('domingo', 'feriado') then
    if not _completos then
      raise exception 'nucleo:especial_sem_horarios: domingo e feriado exigem entrada e saída.'
        using errcode = '22023';
    end if;
    especial_minutos_cobrados := case p_arredondamento_especial
      when 'minutos' then minutos_trabalhados
      else public.nucleo_arredondar_he_diaria(minutos_trabalhados)
    end;
    especial_centavos := public.nucleo_arredondar_centavos(
      p_diaria::numeric * especial_minutos_cobrados * p_fator_especial, _den);
    custo_especial_centavos := public.nucleo_arredondar_centavos(
      p_custo_diario::numeric * minutos_trabalhados * p_fator_especial, _den);
    total_centavos := especial_centavos + p_adicional;
    custo_total_centavos := custo_especial_centavos;
    return;
  end if;

  _referencia := case p_tipo_dia when 'sabado' then 240 else 480 end;
  _prop := _completos and p_tipo_dia = 'util' and minutos_trabalhados < 480;
  _excesso := case when _completos then greatest(minutos_trabalhados - _referencia, 0) else 0 end;
  _passa := _excesso > p_tolerancia;

  he_minutos_cobrados := case
    when p_modo_he = 'acumulado' then _excesso
    when _passa then public.nucleo_arredondar_he_diaria(_excesso)
    else 0
  end;
  he_minutos_pagos := case when _passa then _excesso else 0 end;

  _base_num := case when _prop then p_diaria::numeric * minutos_trabalhados * 100
                    else p_diaria::numeric * _den end;
  _he_num := p_diaria::numeric * he_minutos_cobrados * p_fator_he;
  _total_sem := public.nucleo_arredondar_centavos(_base_num + _he_num, _den);
  base_centavos := public.nucleo_arredondar_centavos(_base_num, _den);
  he_centavos := _total_sem - base_centavos;
  total_centavos := _total_sem + p_adicional;

  _cbase_num := case when _prop then p_custo_diario::numeric * minutos_trabalhados * 100
                     else p_custo_diario::numeric * _den end;
  _che_num := case
    when p_custo_hora_he is not null then he_minutos_pagos::numeric * p_custo_hora_he * 800
    else he_minutos_pagos::numeric * p_custo_diario * 100
  end;
  _ctotal := public.nucleo_arredondar_centavos(_cbase_num + _che_num, _den);
  custo_base_centavos := public.nucleo_arredondar_centavos(_cbase_num, _den);
  custo_he_centavos := _ctotal - custo_base_centavos;
  custo_total_centavos := _ctotal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Motor antigo (010), em aritmética exata: só para a prova de compatibilidade
-- ---------------------------------------------------------------------------

-- A jornada prevista sem turno é jornada × 60 (pode ter fração de minuto): a conta é em QUINTOS
-- de minuto (jornada em centésimos de hora × 60 ÷ 100 = × 3 ÷ 5).
create function public.nucleo_componentes_legado_010(
  p_status     text,
  p_entrada    time,
  p_saida      time,
  p_intervalo  integer,
  p_previsto   integer,
  p_diaria     bigint,
  p_custo      bigint,
  p_jornada    integer,
  p_fator      integer,
  p_tolerancia integer,
  out minutos_trabalhados integer,
  out minutos_extras      integer,
  out cobrado_centavos    bigint,
  out custo_centavos      bigint
)
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  _jornada  numeric;
  _fator    numeric;
  _previsto numeric;
  _excesso  numeric;
  _extras   numeric;
  _den      numeric;
begin
  if p_status is null or p_status not in ('present', 'replacement', 'absent')
     or p_intervalo is null or p_intervalo < 0 or p_previsto is null or p_previsto < 0
     or p_diaria is null or p_diaria < 0 or p_custo is null or p_custo < 0
     or p_jornada is null or p_jornada < 0 or p_fator is null or p_fator < 0
     or p_tolerancia is null or p_tolerancia < 0 then
    raise exception 'nucleo:parametro_invalido: parâmetro ausente ou fora do domínio.'
      using errcode = '22023';
  end if;

  if p_status = 'absent' then
    minutos_trabalhados := 0;
    minutos_extras := 0;
    cobrado_centavos := 0;
    custo_centavos := 0;
    return;
  end if;

  _jornada := case when p_jornada > 0 then p_jornada else 800 end;
  _fator := case when p_fator = 0 then 100 else p_fator end;
  minutos_trabalhados := coalesce(public.nucleo_minutos_trabalhados(p_entrada, p_saida, p_intervalo), 0);

  _previsto := case when p_previsto > 0 then 5 * p_previsto else 3 * _jornada end;
  _excesso := 5 * minutos_trabalhados - _previsto;
  _extras := case when _excesso > 5 * p_tolerancia then _excesso else 0 end;
  _den := 300 * _jornada;

  minutos_extras := div(2 * _extras + 5, 10)::integer;
  cobrado_centavos := public.nucleo_arredondar_centavos(
    p_diaria * _den + _extras * p_diaria * _fator, _den);
  custo_centavos := public.nucleo_arredondar_centavos(
    p_custo * _den + _extras * p_custo * 100, _den);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sem acesso pela API: só o próprio banco (e, numa etapa futura, o motor) chama.
-- ---------------------------------------------------------------------------

revoke all on function public.nucleo_arredondar_centavos(numeric, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.nucleo_arredondar_he_diaria(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.nucleo_minutos_previstos(time, time, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.nucleo_minutos_trabalhados(time, time, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.nucleo_componentes_v2(text, text, time, time, integer, bigint, integer, integer, integer, text, text, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.nucleo_componentes_legado_010(text, time, time, integer, integer, bigint, bigint, integer, integer, integer)
  from public, anon, authenticated, service_role;

comment on function public.nucleo_componentes_v2(text, text, time, time, integer, bigint, integer, integer, integer, text, text, bigint, bigint, bigint) is
  'FIN-PR-01: componentes de cobrança e custo pelas regras v2 (FIN-DESENHO-01 R2). Pura, não usada pelo motor nesta etapa.';
comment on function public.nucleo_componentes_legado_010(text, time, time, integer, integer, bigint, bigint, integer, integer, integer) is
  'FIN-PR-01: motor antigo (010) em aritmética exata, só para a prova de compatibilidade. Não usada pelo motor.';

commit;
