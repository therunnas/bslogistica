-- Valores financeiros de `timesheet_entries` passam a ser DERIVADOS no banco.
--
-- O PROBLEMA
--
-- `billed_amount` e `cost_amount` são calculados hoje no NAVEGADOR, por
-- `calcEntry()` em `src/lib/billing.ts`, e enviados no payload do upsert da tela
-- de apontamentos. A policy `timesheet_entries_staff` é `ALL` com `is_staff()`,
-- e `authenticated` tem `UPDATE` sobre todas as colunas — então qualquer sessão
-- com papel poderia mandar um PATCH direto ao PostgREST com o valor que
-- quisesse. Esse valor entra no `sum(te.billed_amount)` de `gerar_fatura` e vira
-- o total cobrado do cliente.
--
-- Não é explorável hoje, porque só existem contas `admin`. Precisa estar fechado
-- ANTES da primeira conta `operacional`.
--
-- POR QUE NÃO BASTA PROIBIR A COLUNA
--
-- O fluxo legítimo é quem envia esses campos. Proibi-los quebraria o único
-- caminho de gravação de apontamento, e as colunas cairiam no `DEFAULT 0` —
-- apontamento com receita zero. E privilégio por coluna não serve para nada
-- aqui: `admin` e `operacional` compartilham o MESMO papel de banco
-- (`authenticated`), então um REVOKE atingiria os dois.
--
-- A correção é mudar ONDE o valor nasce: o banco recalcula e ignora o que veio
-- no payload. Assim não depende de papel nenhum — payload forjado é irrelevante
-- para qualquer identidade.
--
-- AS DUAS FUNÇÕES, E POR QUE TÊM CONTEXTOS DE SEGURANÇA DIFERENTES
--
-- `derivar_valores_financeiros` é SECURITY DEFINER porque precisa ler
-- `operations`, `contracts`, `employees`, `timesheets` e `shifts`. Como INVOKER,
-- essas leituras passariam pela RLS do chamador — e quando o papel
-- `operacional` puder gravar apontamento em aal1, ele NÃO enxergará `contracts`.
-- O SELECT voltaria vazio, o código cairia no fallback sem contrato e gravaria
-- valores errados SEM erro nenhum. Falha silenciosa em regra financeira é o pior
-- desfecho possível aqui.
--
-- Não é bypass de autorização: a função só é alcançável depois que a escrita em
-- `timesheet_entries` já passou pela policy daquela tabela (papel + aal2), não
-- aceita entrada além de NEW/OLD, e não devolve nada ao cliente — apenas grava
-- valores derivados na própria linha.
--
-- `bloquear_edicao_financeira` é SECURITY INVOKER, e isso é OBRIGATÓRIO. Ela
-- distingue escrita de cliente de escrita interna por `current_user`, e dentro
-- de uma função SECURITY DEFINER `current_user` é sempre o dono — seria sempre
-- `postgres`, a condição nunca seria verdadeira e a proteção jamais dispararia.
-- `session_user` não substitui: o PostgREST conecta como `authenticator` e faz
-- `SET ROLE`, então ele vale `authenticator` nos dois casos e não distingue
-- nada. É o mesmo contexto já usado e comprovado em
-- `protect_timesheet_invoice_link`.
--
-- ORDEM DOS TRIGGERS
--
-- Triggers BEFORE de linha disparam em ordem ALFABÉTICA do nome. `bloqueio`
-- roda antes de `calculo` de propósito: se o cálculo rodasse primeiro, ele já
-- teria normalizado NEW para os valores de OLD e o bloqueio não veria diferença
-- alguma para recusar. A ordem final na tabela fica:
--
--   bloqueio_financeiro -> calculo_financeiro -> chave -> protect_invoice_link
--   -> updated
--
-- Essa dependência de ordem vale SOMENTE para o par bloqueio/cálculo, que é
-- interno a esta migration. O cálculo NÃO depende de rodar antes ou depois de
-- `chave`: ele lê a operação da folha, não de `NEW.operation_id`. Foi assim que
-- se fechou o bypass descrito adiante, e é o que mantém o resultado correto
-- ainda que a ordem mude.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não altera fórmula, diária, hora extra, tolerância, custo, fallback sem
-- contrato ou arredondamento: reproduz `calcEntry()` exatamente, e há teste de
-- paridade. Não libera aal1. Não remove nenhuma policy. Não toca no guard, em
-- MFA, em `user_roles`, em `operation_team`, nem duplica a proteção de
-- `invoice_id`. Não faz backfill — só atua em escrita nova.

-- ---------------------------------------------------------------------------
-- 1. Recusa da edição puramente financeira
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_edicao_financeira()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Colunas derivadas. Nenhuma delas é digitada por ninguém: todas saem do
  -- cálculo. Um UPDATE que mexe SÓ nelas não tem origem legítima na aplicação.
  _financeiro_mudou boolean :=
       NEW.billed_amount         IS DISTINCT FROM OLD.billed_amount
    OR NEW.cost_amount           IS DISTINCT FROM OLD.cost_amount
    OR NEW.daily_rate_snapshot   IS DISTINCT FROM OLD.daily_rate_snapshot
    OR NEW.ot_hour_rate_snapshot IS DISTINCT FROM OLD.ot_hour_rate_snapshot
    OR NEW.daily_cost_snapshot   IS DISTINCT FROM OLD.daily_cost_snapshot
    OR NEW.worked_minutes        IS DISTINCT FROM OLD.worked_minutes
    OR NEW.overtime_minutes      IS DISTINCT FROM OLD.overtime_minutes;

  -- Qualquer outra coluna da tabela. `updated_at` entra aqui, mas o trigger que
  -- a preenche roda DEPOIS deste, então neste ponto ela só difere se o próprio
  -- cliente a tiver enviado.
  _outro_mudou boolean :=
       NEW.id           IS DISTINCT FROM OLD.id
    OR NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id
    OR NEW.employee_id  IS DISTINCT FROM OLD.employee_id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.work_date    IS DISTINCT FROM OLD.work_date
    OR NEW.status       IS DISTINCT FROM OLD.status
    OR NEW.check_in     IS DISTINCT FROM OLD.check_in
    OR NEW.check_out    IS DISTINCT FROM OLD.check_out
    OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes
    OR NEW.invoice_id   IS DISTINCT FROM OLD.invoice_id
    OR NEW.notes        IS DISTINCT FROM OLD.notes
    OR NEW.created_at   IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at   IS DISTINCT FROM OLD.updated_at;
BEGIN
  IF _financeiro_mudou
     AND NOT _outro_mudou
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION
      'Valores financeiros do apontamento são calculados pelo sistema e não podem ser alterados diretamente.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_edicao_financeira() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_edicao_financeira() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_edicao_financeira() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_edicao_financeira() FROM service_role;

COMMENT ON FUNCTION public.bloquear_edicao_financeira() IS
  'Recusa UPDATE que altere apenas colunas financeiras derivadas de timesheet_entries. SECURITY INVOKER de propósito: precisa enxergar o current_user real.';

-- ---------------------------------------------------------------------------
-- 2. Derivação dos valores, espelhando calcEntry() de src/lib/billing.ts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derivar_valores_financeiros()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _motriz_mudou boolean;

  _operation_id   uuid;
  _contract_id    uuid;
  _agreed_amount  numeric;

  _daily_rate       double precision;
  _shift_hours      double precision;
  _ot_factor        double precision;
  _ot_tolerance_min double precision;
  _daily_cost       double precision;

  _shift_start        time;
  _shift_end          time;
  _shift_break        integer;
  _crosses_midnight   boolean;

  _planned          double precision := 0;
  _planned_efetivo  double precision;
  _shift_hours_efetivo double precision;
  _ot_factor_efetivo   double precision;
  _ot_hour_rate        double precision;
  _ot_cost_hour_rate   double precision;

  _inicio    double precision;
  _fim       double precision;
  _worked    double precision := 0;
  _excess    double precision;
  _overtime  double precision := 0;
  _ot_horas  double precision;

  _billed numeric;
  _cost   numeric;
BEGIN
  -- Colunas motrizes: as que mudam o resultado do cálculo. Um UPDATE que não
  -- toca em nenhuma delas PRESERVA os valores já gravados — é o que mantém os
  -- snapshots congelados quando alguém edita só `notes`, e é também o que faz o
  -- `UPDATE ... SET invoice_id` do `gerar_fatura` não recalcular nada com os
  -- valores de contrato de hoje.
  --
  -- `operation_id` e `work_date` NÃO são motrizes: nenhum dos dois entra no
  -- cálculo, porque a operação vem da folha (ver abaixo) e a data não é usada.
  -- Deixá-los na lista daria ao cliente um jeito de forçar recálculo — e com
  -- ele a troca de um snapshot congelado — só mandando um valor qualquer nessas
  -- colunas, que o trigger de chave depois sobrescreveria de volta.
  IF TG_OP = 'UPDATE' THEN
    _motriz_mudou :=
         NEW.status        IS DISTINCT FROM OLD.status
      OR NEW.check_in      IS DISTINCT FROM OLD.check_in
      OR NEW.check_out     IS DISTINCT FROM OLD.check_out
      OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes
      OR NEW.employee_id   IS DISTINCT FROM OLD.employee_id
      OR NEW.timesheet_id  IS DISTINCT FROM OLD.timesheet_id;

    IF NOT _motriz_mudou THEN
      NEW.worked_minutes        := OLD.worked_minutes;
      NEW.overtime_minutes      := OLD.overtime_minutes;
      NEW.daily_rate_snapshot   := OLD.daily_rate_snapshot;
      NEW.ot_hour_rate_snapshot := OLD.ot_hour_rate_snapshot;
      NEW.daily_cost_snapshot   := OLD.daily_cost_snapshot;
      NEW.billed_amount         := OLD.billed_amount;
      NEW.cost_amount           := OLD.cost_amount;
      RETURN NEW;
    END IF;
  END IF;

  -- Regras do contrato. Espelha `useContractRules` de src/lib/ledger.ts: quando
  -- a operação não tem contrato, cai no mesmo fallback usado pela tela.
  -- A OPERAÇÃO VEM DA FOLHA, NUNCA DO PAYLOAD.
  --
  -- `NEW.operation_id` é escolhido pelo cliente. Usá-lo aqui abria um bypass
  -- real, reproduzido em revisão: bastava mandar `timesheet_id` de uma folha
  -- barata e `operation_id` de uma operação cara para o valor sair da cara. A
  -- linha terminava coerente — porque `sincronizar_chave_da_diaria` corrige a
  -- chave depois — e o dinheiro, errado.
  --
  -- Ler a operação da folha fecha isso INDEPENDENTEMENTE da ordem dos triggers:
  -- esta função passa a não depender de nenhuma coluna que o cliente controle
  -- além de `timesheet_id`, que é a própria chave estrangeira da folha. Se a
  -- ordem mudar, o resultado é o mesmo.
  SELECT t.operation_id INTO _operation_id
    FROM public.timesheets t
   WHERE t.id = NEW.timesheet_id;

  -- Folha inexistente ou operação ausente não lançam aqui: `calcEntry` também
  -- não lança, e segue com `agreed_amount ?? 0`. Inventar exceção quebraria a
  -- paridade. Quem recusa folha inexistente é o trigger de chave, que tem essa
  -- responsabilidade e já falha fechado com 23503.
  SELECT o.contract_id, o.agreed_amount
    INTO _contract_id, _agreed_amount
    FROM public.operations o
   WHERE o.id = _operation_id;

  SELECT c.daily_rate, c.shift_hours, c.ot_factor, c.ot_tolerance_min
    INTO _daily_rate, _shift_hours, _ot_factor, _ot_tolerance_min
    FROM public.contracts c
   WHERE c.id = _contract_id;

  IF NOT FOUND THEN
    _daily_rate       := COALESCE(_agreed_amount, 0);
    _shift_hours      := 8;
    _ot_factor        := 1;
    _ot_tolerance_min := 10;
  END IF;

  SELECT COALESCE(e.daily_cost, 0) INTO _daily_cost
    FROM public.employees e
   WHERE e.id = NEW.employee_id;

  _daily_cost := COALESCE(_daily_cost, 0);

  -- Jornada prevista, de `shiftPlannedMinutes`. Folha sem turno devolve 0, que
  -- adiante vira `shift_hours * 60`, exatamente como o `||` do TypeScript.
  SELECT s.start_time, s.end_time, s.break_minutes, s.crosses_midnight
    INTO _shift_start, _shift_end, _shift_break, _crosses_midnight
    FROM public.timesheets t
    JOIN public.shifts s ON s.id = t.shift_id
   WHERE t.id = NEW.timesheet_id;

  IF FOUND THEN
    _inicio := EXTRACT(HOUR FROM _shift_start) * 60 + EXTRACT(MINUTE FROM _shift_start);
    _fim    := EXTRACT(HOUR FROM _shift_end)   * 60 + EXTRACT(MINUTE FROM _shift_end);
    IF COALESCE(_crosses_midnight, false) OR _fim <= _inicio THEN
      _fim := _fim + 1440;
    END IF;
    _planned := GREATEST(0, _fim - _inicio - COALESCE(_shift_break, 0));
  END IF;

  -- `rules.shift_hours > 0 ? rules.shift_hours : 8`
  _shift_hours_efetivo := CASE
    WHEN _shift_hours IS NOT NULL AND _shift_hours > 0 THEN _shift_hours ELSE 8
  END;

  -- `rules.ot_factor || 1` — em JavaScript, 0 e NaN caem no 1.
  _ot_factor_efetivo := CASE
    WHEN _ot_factor IS NULL OR _ot_factor = 0 THEN 1 ELSE _ot_factor
  END;

  _daily_rate        := COALESCE(_daily_rate, 0);
  _ot_hour_rate      := (_daily_rate / _shift_hours_efetivo) * _ot_factor_efetivo;
  _ot_cost_hour_rate := _daily_cost / _shift_hours_efetivo;

  IF NEW.status = 'absent' THEN
    -- Falta não gera cobrança nem custo, mas os snapshots continuam gravados.
    _worked   := 0;
    _overtime := 0;
    _billed   := 0;
    _cost     := 0;
  ELSE
    -- `workedMinutes`: sem entrada ou sem saída, zero. A comparação usa só
    -- HH:MM, como o `slice(0, 5)` do TypeScript.
    IF NEW.check_in IS NULL OR NEW.check_out IS NULL THEN
      _worked := 0;
    ELSE
      _inicio := EXTRACT(HOUR FROM NEW.check_in)  * 60 + EXTRACT(MINUTE FROM NEW.check_in);
      _fim    := EXTRACT(HOUR FROM NEW.check_out) * 60 + EXTRACT(MINUTE FROM NEW.check_out);
      IF _fim <= _inicio THEN
        _fim := _fim + 1440;
      END IF;
      _worked := GREATEST(0, _fim - _inicio - COALESCE(NEW.break_minutes, 0));
    END IF;

    -- `input.plannedMinutes || shiftHours * 60`
    _planned_efetivo := CASE
      WHEN _planned IS NULL OR _planned = 0 THEN _shift_hours_efetivo * 60 ELSE _planned
    END;

    _excess   := _worked - _planned_efetivo;
    _overtime := CASE
      WHEN _excess > COALESCE(_ot_tolerance_min, 0) THEN _excess ELSE 0
    END;
    _ot_horas := _overtime / 60.0;

    -- `round2` = Math.round(v * 100) / 100. Os valores aqui nunca são
    -- negativos, faixa em que o arredondamento do JavaScript e o do numeric
    -- coincidem.
    _billed := ROUND((( _daily_rate + _ot_horas * _ot_hour_rate) * 100)::numeric) / 100;
    _cost   := ROUND((( _daily_cost + _ot_horas * _ot_cost_hour_rate) * 100)::numeric) / 100;
  END IF;

  NEW.worked_minutes        := _worked::integer;
  NEW.overtime_minutes      := _overtime::integer;
  NEW.daily_rate_snapshot   := _daily_rate::numeric;
  NEW.ot_hour_rate_snapshot := _ot_hour_rate::numeric;
  NEW.daily_cost_snapshot   := _daily_cost::numeric;
  NEW.billed_amount         := _billed;
  NEW.cost_amount           := _cost;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.derivar_valores_financeiros() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derivar_valores_financeiros() FROM anon;
REVOKE ALL ON FUNCTION public.derivar_valores_financeiros() FROM authenticated;
REVOKE ALL ON FUNCTION public.derivar_valores_financeiros() FROM service_role;

COMMENT ON FUNCTION public.derivar_valores_financeiros() IS
  'Recalcula no banco os valores financeiros de timesheet_entries, espelhando calcEntry() de src/lib/billing.ts. SECURITY DEFINER porque precisa ler contracts/operations/employees/timesheets/shifts independentemente da RLS do chamador.';

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_timesheet_entries_bloqueio_financeiro
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_bloqueio_financeiro
  BEFORE UPDATE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_edicao_financeira();

DROP TRIGGER IF EXISTS trg_timesheet_entries_calculo_financeiro
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_calculo_financeiro
  BEFORE INSERT OR UPDATE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.derivar_valores_financeiros();

-- ---------------------------------------------------------------------------
-- 4. Não-negatividade das fontes do cálculo
--
-- POR QUE ISTO ENTRA JUNTO
--
-- `round2` do TypeScript é `Math.round(v * 100) / 100`, e `Math.round`
-- arredonda o meio para +infinito: `Math.round(-112.5)` é `-112`. O `round()`
-- do `numeric` arredonda o meio para LONGE do zero: `-113`. Os dois só
-- divergem no negativo — e apontado em revisão, com o caso `daily_rate = -1`,
-- `shift_hours = 1`, `ot_factor = 0.25` e 30 minutos de hora extra, dando
-- `-1.12` no TypeScript e `-1.13` no SQL.
--
-- Em vez de reescrever a fórmula SQL para imitar o arredondamento do
-- JavaScript — o que mascararia entrada inválida —, fecha-se a entrada. Valor
-- financeiro de origem negativo não tem regra de negócio neste sistema.
--
-- QUAIS COLUNAS, E POR QUÊ
--
-- Cada uma abaixo foi verificada como capaz de produzir `billed_amount` ou
-- `cost_amount` negativo, executando o próprio `calcEntry`:
--
--   daily_rate       -1   -> billed  -100
--   daily_cost       -50  -> cost     -50
--   ot_factor        -20  -> billed  -800
--   ot_tolerance_min -600 -> billed -1600, e `overtime_minutes` NEGATIVO,
--                            porque `excess > tolerancia` passa a valer para
--                            jornada INCOMPLETA
--   agreed_amount    -300 -> billed  -300, pelo fallback sem contrato
--
-- `shift_hours` fica de FORA de propósito: valor <= 0 já é substituído por 8
-- pela própria regra, então não produz valor negativo, e a constraint seria
-- redundante.
--
-- O zero continua permitido em todas: é o DEFAULT de `daily_rate`, de
-- `daily_cost` e de `ot_tolerance_min`, e tem sentido de negócio.
--
-- Production tem zero linhas de negócio hoje, então não há backfill.
-- ---------------------------------------------------------------------------

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_daily_rate_nao_negativa CHECK (daily_rate >= 0),
  ADD CONSTRAINT contracts_ot_factor_nao_negativo CHECK (ot_factor >= 0),
  ADD CONSTRAINT contracts_ot_tolerance_min_nao_negativa CHECK (ot_tolerance_min >= 0);

ALTER TABLE public.employees
  ADD CONSTRAINT employees_daily_cost_nao_negativo CHECK (daily_cost >= 0);

ALTER TABLE public.operations
  ADD CONSTRAINT operations_agreed_amount_nao_negativo
    CHECK (agreed_amount IS NULL OR agreed_amount >= 0);
