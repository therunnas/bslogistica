-- Protege as FONTES da derivação financeira e o LASTRO já faturado.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A migration 010 fechou o caminho do PAYLOAD: o cliente não dita mais
-- `billed_amount`, `cost_amount` nem os snapshots de `timesheet_entries`. Ela
-- NÃO fechou o caminho das FONTES. Levantado em revisão e reproduzido em banco
-- local, com sessão `operacional` em aal2:
--
--   UPDATE operations SET agreed_amount = 999999  ->  grava apontamento
--   ->  UPDATE operations SET agreed_amount = 250
--   agreed_amount depois = 250.00 (parece legítimo) | billed gravado = 999999.00
--
--   UPDATE shifts SET end_time = '08:00', break_minutes = 0  ->  grava
--   ->  restaura o turno
--   turno depois = 15:00 (parece legítimo) | overtime = 360 min | billed = 425.00
--
-- Em ambos, a configuração volta ao normal e o valor inflado fica congelado no
-- snapshot, entrando no `sum(te.billed_amount)` de `gerar_fatura`.
--
-- A causa é que `operations`, `shifts` e `timesheets` têm policy `ALL
-- is_staff()`, e `is_staff()` é verdadeiro para `operacional`. `contracts` e
-- `employees` já eram admin-only para escrita — por isso não aparecem aqui.
--
-- INVENTAR TAXA x ESCOLHER CONFIGURAÇÃO
--
-- A distinção que orienta todo o desenho. Mexer em `agreed_amount` ou no
-- horário do turno INVENTA uma taxa, e some sem rastro depois da restauração:
-- bloquear. Apontar uma folha para a operação X ESCOLHE entre configurações
-- que o admin criou, e fica registrado na linha: permitir. Por isso
-- `timesheets` mantém INSERT livre e só perde o UPDATE dos vínculos.
--
-- LASTRO FATURADO
--
-- Depois que um apontamento entra numa fatura, ele vira lastro financeiro. O
-- bloqueio de DELETE é ABSOLUTO, sem exceção de papel — nem admin, nem
-- `postgres`, nem `service_role`. É decisão deliberada de produto: nenhum
-- caminho normal da aplicação deve destruir lastro, incluindo RPC
-- `SECURITY DEFINER`, job interno, PostgREST ou ação administrativa. Correção
-- contábil futura terá fluxo próprio, com estorno e auditoria — não DELETE.
--
-- A CASCATA PROTEGE A ÁRVORE, MENOS UM CAMINHO
--
-- Verificado em banco, não presumido: um `BEFORE DELETE` na folha DISPARA
-- durante a cascata. Então o trigger em `timesheet_entries` já cobre:
--
--   DELETE timesheets  -> CASCADE -> entry faturada -> bloqueia
--   DELETE operations  -> CASCADE -> timesheets -> entry faturada -> bloqueia
--
-- Mas NÃO cobre `shifts`: a FK é `timesheets.shift_id ON DELETE SET NULL`,
-- não CASCADE. Nenhum apontamento é tocado, o trigger nunca dispara, e o turno
-- sumiria levando junto a jornada que originou os valores. Daí a função
-- própria de `shifts`.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não libera aal1. Não toca em nenhuma das 11 policies `*_exige_aal2`, no
-- guard, em MFA, em `user_roles`, em `gerar_fatura` nem no frontend.
-- `operation_team` fica de fora de propósito: é composição de equipe, trabalho
-- de campo, e a auditoria não encontrou efeito financeiro direto.
-- `invoices` e `invoice_items` já são admin-only. Não faz backfill.

-- ---------------------------------------------------------------------------
-- 1. Lastro faturado — absoluto, sem exceção de papel
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_delete_faturado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Sem checagem de `current_user` e sem checagem de papel, de propósito.
  -- Qualquer bypass privilegiado aqui seria silencioso.
  IF OLD.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Apontamento faturado não pode ser excluído. Fatura: %.', OLD.invoice_id
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_delete_faturado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_delete_faturado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_delete_faturado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_delete_faturado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_delete_faturado() IS
  'Impede DELETE de apontamento já vinculado a fatura. Sem exceção de papel, incluindo postgres e service_role: correção contábil deve ter fluxo próprio, auditado.';

DROP TRIGGER IF EXISTS trg_timesheet_entries_bloqueia_delete_faturado
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_bloqueia_delete_faturado
  BEFORE DELETE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_delete_faturado();

-- ---------------------------------------------------------------------------
-- 2. Turno com histórico faturado — o caminho que a cascata não alcança
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_delete_turno_faturado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _client_id uuid;
BEGIN
  SELECT o.client_id INTO _client_id
    FROM public.operations o
   WHERE o.id = OLD.operation_id;

  -- Mesmo advisory lock que `gerar_fatura` toma. Sem ele existe janela real:
  -- a fatura pode ser gerada entre o EXISTS abaixo e o commit, e o turno
  -- sumiria mesmo assim. `gerar_fatura` trava por cliente, então travar pelo
  -- mesmo hash serializa as duas operações.
  IF _client_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.timesheets t
      JOIN public.timesheet_entries te ON te.timesheet_id = t.id
     WHERE t.shift_id = OLD.id
       AND te.invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Turno com apontamento faturado não pode ser excluído. Inative-o em vez de apagar.'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_delete_turno_faturado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_delete_turno_faturado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_delete_turno_faturado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_delete_turno_faturado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_delete_turno_faturado() IS
  'Impede DELETE de turno cujo histórico contenha apontamento faturado. Existe porque timesheets.shift_id é ON DELETE SET NULL, e a cascata não alcança os apontamentos.';

DROP TRIGGER IF EXISTS trg_shifts_bloqueia_delete_faturado ON public.shifts;
CREATE TRIGGER trg_shifts_bloqueia_delete_faturado
  BEFORE DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_delete_turno_faturado();

-- ---------------------------------------------------------------------------
-- 2b. Cliente com histórico faturado — falha cedo, na raiz da árvore
--
-- Sem esta guarda o bloqueio já aconteceria, mas lá embaixo: a cascata
-- `clients -> operations -> shifts` chega no trigger do turno e aborta com uma
-- mensagem sobre TURNO, quando o que o usuário tentou apagar foi um CLIENTE.
-- Falhar na raiz dá a mensagem certa e evita percorrer a árvore inteira.
--
-- Vale para todos, admin incluído, e NÃO existe exceção por cascata. Detectar
-- que um DELETE de turno veio de um DELETE de cliente para liberá-lo criaria
-- uma exceção implícita difícil de manter, e enfraqueceria justamente a
-- invariante que esta migration existe para sustentar.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_delete_cliente_faturado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Mesma chave de `gerar_fatura`, para que gerar fatura e apagar cliente
  -- fiquem serializados pelo mesmo `client_id`. Sem isso a fatura poderia ser
  -- criada entre a verificação e o commit.
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id::text, 0));

  -- Verificação DEPOIS do lock, de propósito.
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.client_id = OLD.id)
     OR EXISTS (
       SELECT 1
         FROM public.timesheet_entries te
         JOIN public.timesheets t  ON t.id = te.timesheet_id
         JOIN public.operations  o ON o.id = t.operation_id
        WHERE o.client_id = OLD.id
          AND te.invoice_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'Cliente com histórico faturado não pode ser excluído. Inative-o.'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_delete_cliente_faturado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_delete_cliente_faturado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_delete_cliente_faturado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_delete_cliente_faturado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_delete_cliente_faturado() IS
  'Impede DELETE de cliente com histórico faturado, antes de percorrer a cascata. Sem exceção de papel.';

DROP TRIGGER IF EXISTS trg_clients_bloqueia_delete_faturado ON public.clients;
CREATE TRIGGER trg_clients_bloqueia_delete_faturado
  BEFORE DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_delete_cliente_faturado();

-- ---------------------------------------------------------------------------
-- 3. Proteção por coluna
--
-- `IS DISTINCT FROM` é obrigatório: a tela reenvia o objeto inteiro a cada
-- gravação (`useSaveRow` faz `.update(rest)` com todos os campos), então o
-- simples reenvio de um campo protegido SEM mudança não pode gerar 42501.
--
-- SECURITY INVOKER nas três: elas precisam enxergar o `current_user` real
-- para isentar escrita interna. Dentro de uma função SECURITY DEFINER,
-- `current_user` seria sempre o dono e a proteção jamais dispararia.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_fontes_operacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.contract_id    IS DISTINCT FROM OLD.contract_id
      OR NEW.agreed_amount IS DISTINCT FROM OLD.agreed_amount)
     AND current_user NOT IN ('postgres', 'service_role')
     AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION
      'Contrato e valor acordado da operação são administrativos e não podem ser alterados por este papel.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_fontes_turno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.start_time       IS DISTINCT FROM OLD.start_time
      OR NEW.end_time        IS DISTINCT FROM OLD.end_time
      OR NEW.break_minutes   IS DISTINCT FROM OLD.break_minutes
      OR NEW.crosses_midnight IS DISTINCT FROM OLD.crosses_midnight
      OR NEW.operation_id    IS DISTINCT FROM OLD.operation_id)
     AND current_user NOT IN ('postgres', 'service_role')
     AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION
      'Jornada e vínculo do turno definem o cálculo e não podem ser alterados por este papel.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_fontes_folha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.operation_id IS DISTINCT FROM OLD.operation_id
      OR NEW.shift_id    IS DISTINCT FROM OLD.shift_id)
     AND current_user NOT IN ('postgres', 'service_role')
     AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION
      'Operação e turno da folha definem o cálculo e não podem ser alterados por este papel.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_fontes_operacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_fontes_operacao() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_fontes_operacao() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_fontes_operacao() FROM service_role;

REVOKE ALL ON FUNCTION public.bloquear_fontes_turno() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_fontes_turno() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_fontes_turno() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_fontes_turno() FROM service_role;

REVOKE ALL ON FUNCTION public.bloquear_fontes_folha() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_fontes_folha() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_fontes_folha() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_fontes_folha() FROM service_role;

-- Nomes escolhidos para ordenar ANTES dos triggers existentes de `updated_at`
-- e do `propaga_chave`: `bloqueia` < `operations_updated`, < `shifts_updated`,
-- < `propaga_chave` e < `timesheets_updated`. A guarda recusa antes de
-- qualquer efeito colateral. Nenhuma delas depende de ordem para estar
-- correta — só para falhar cedo.
DROP TRIGGER IF EXISTS trg_operations_bloqueia_fontes ON public.operations;
CREATE TRIGGER trg_operations_bloqueia_fontes
  BEFORE UPDATE ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_fontes_operacao();

DROP TRIGGER IF EXISTS trg_shifts_bloqueia_fontes ON public.shifts;
CREATE TRIGGER trg_shifts_bloqueia_fontes
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_fontes_turno();

DROP TRIGGER IF EXISTS trg_timesheets_bloqueia_fontes ON public.timesheets;
CREATE TRIGGER trg_timesheets_bloqueia_fontes
  BEFORE UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_fontes_folha();

-- ---------------------------------------------------------------------------
-- 4. Policies por comando em operations e shifts
--
-- A policy `ALL is_staff()` não distingue comando nem coluna. Dividi-la em
-- SELECT/UPDATE para staff e INSERT/DELETE para admin expressa a autorização
-- onde a RLS consegue expressá-la; o resto fica nos triggers acima, porque
-- `WITH CHECK` não enxerga `OLD` e não há como dizer "não mudou".
--
-- Criar operação é admin-only por decisão de produto: a operação é a raiz das
-- regras que afetam cálculo e faturamento, e permitir criação livre
-- contornaria a proteção de coluna — bastaria criar uma operação nova já com o
-- valor desejado. Turno segue a mesma lógica: quatro das suas sete colunas
-- definem o cálculo.
--
-- As policies RESTRICTIVE de aal2 NÃO são tocadas e continuam valendo sobre
-- todos os comandos.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS operations_staff ON public.operations;

CREATE POLICY operations_select_staff ON public.operations
  FOR SELECT TO authenticated USING (public.is_staff());

CREATE POLICY operations_update_staff ON public.operations
  FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY operations_insert_admin ON public.operations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY operations_delete_admin ON public.operations
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS shifts_staff ON public.shifts;

CREATE POLICY shifts_select_staff ON public.shifts
  FOR SELECT TO authenticated USING (public.is_staff());

CREATE POLICY shifts_update_staff ON public.shifts
  FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY shifts_insert_admin ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY shifts_delete_admin ON public.shifts
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
