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
--
-- Também não cria fluxo de estorno. Onde a proteção é absoluta, a saída é a
-- ausência de saída: correção contábil ganha mecanismo próprio e auditado
-- quando for desenhada, e até lá nada aqui abre exceção "temporária".
--
-- SEGUNDA RODADA DE REVISÃO
--
-- Três caminhos a mais foram levantados em revisão depois da primeira versão
-- desta migration, todos reproduzidos em banco local antes de fechar:
--
--   1. o vínculo de fatura era mutável, então dava para desvincular e só então
--      apagar o lastro — seção 1b;
--   2. `operations.client_id` ficara de fora da proteção por coluna, e é por
--      ele que `gerar_fatura` decide elegibilidade — seção 3;
--   3. a folha podia nascer com turno de OUTRA operação, porque a guarda de
--      vínculo só cobria UPDATE — seção 3b.
--
-- Os três têm a mesma assinatura dos ataques originais: a configuração volta
-- ao normal e o valor inflado, ou o cliente errado, fica congelado.

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
-- 1b. O vínculo com a fatura também é imutável — senão o bloqueio acima é
--     contornável em dois passos
--
-- Levantado em revisão e reproduzido em banco local. O trigger acima lê
-- `OLD.invoice_id`, e o vínculo era mutável:
--
--   admin: UPDATE timesheet_entries SET invoice_id = NULL  -> DESVINCULOU
--          DELETE FROM timesheet_entries                   -> APAGOU
--
-- `protect_timesheet_invoice_link` não barra isso: ela isenta admin,
-- `postgres` e `service_role` de propósito, porque é justamente quem gera
-- fatura. E existe um segundo caminho, sem sequer tocar no apontamento:
--
--   admin: DELETE FROM invoices  -> FK ON DELETE SET NULL -> invoice_id = NULL
--          DELETE FROM timesheet_entries                  -> APAGOU
--
-- Verificado em banco, não presumido: o UPDATE que a FK emite para o SET NULL
-- DISPARA um trigger `BEFORE UPDATE OF`. Então uma guarda aqui fecha os dois
-- caminhos de uma vez, e o DELETE da fatura passa a falhar enquanto houver
-- apontamento vinculado. Isso é DESEJADO, e não ganha exceção por cascata pelo
-- mesmo motivo de `clients`.
--
-- A regra é direcional, e a direção importa:
--
--   NULL          -> fatura X   PERMITIDO  (é o passo 6 de `gerar_fatura`)
--   fatura X      -> NULL       RECUSADO
--   fatura X      -> fatura Y   RECUSADO
--
-- `gerar_fatura` só alcança apontamentos com `te.invoice_id IS NULL`, então
-- ela nunca cai nos dois casos recusados.
--
-- Sem exceção de papel, como no DELETE: estorno contábil terá fluxo próprio e
-- auditado, e enquanto ele não existir a ausência de saída é a proteção.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_desvinculo_faturado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Sem checagem de `current_user` e sem checagem de papel, de propósito.
  IF OLD.invoice_id IS NOT NULL
     AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION
      'Vínculo de fatura de apontamento faturado é imutável. Fatura: %.',
      OLD.invoice_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_desvinculo_faturado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_desvinculo_faturado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_desvinculo_faturado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_desvinculo_faturado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_desvinculo_faturado() IS
  'Impede remover ou trocar o invoice_id de apontamento já faturado, incluindo o SET NULL emitido pela FK ao apagar a fatura. Sem exceção de papel. Vincular a partir de NULL continua permitido, que é o caminho de gerar_fatura.';

-- `bloqueia` < `protect`: esta guarda roda antes de
-- `trg_timesheet_entries_protect_invoice_link`, e a recusa sai com a mensagem
-- sobre lastro em vez da mensagem sobre papel.
DROP TRIGGER IF EXISTS trg_timesheet_entries_bloqueia_desvinculo
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_bloqueia_desvinculo
  BEFORE UPDATE OF invoice_id ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_desvinculo_faturado();

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
  -- `client_id` entra aqui pelo mesmo motivo que os outros dois, ainda que
  -- não apareça na fórmula. `gerar_fatura` decide o que é elegível juntando
  -- `timesheet_entries -> timesheets -> operations` e filtrando por
  -- `o.client_id`. Mover a operação para outro cliente, faturar e devolvê-la
  -- cobra o cliente errado e não deixa rastro na linha — a mesma silhueta do
  -- ataque de `agreed_amount`. Levantado em revisão e reproduzido em banco
  -- local: `operacional` em aal2 ALTEROU `client_id` sem qualquer recusa.
  IF (NEW.client_id      IS DISTINCT FROM OLD.client_id
      OR NEW.contract_id   IS DISTINCT FROM OLD.contract_id
      OR NEW.agreed_amount IS DISTINCT FROM OLD.agreed_amount)
     AND current_user NOT IN ('postgres', 'service_role')
     AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION
      'Cliente, contrato e valor acordado da operação são administrativos e não podem ser alterados por este papel.'
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
-- 3b. Par operação/turno — invariante estrutural, não permissão de papel
--
-- A guarda acima cobre UPDATE. O INSERT de folha continua livre para
-- `operacional`, de propósito — é o fluxo diário de `painel-apontamentos`. Só
-- que nada exigia que o turno informado pertencesse à operação informada.
-- Levantado em revisão e reproduzido em banco local: `operacional` em aal2
-- CRIOU uma folha com `operation_id` da operação A e `shift_id` de um turno da
-- operação B.
--
-- O estrago é silencioso porque `derivar_valores_financeiros` lê as duas
-- pontas: a taxa vem da operação escolhida, e a jornada prevista vem do turno.
-- Combinar a operação cara com o turno curto fabrica hora extra que nenhum
-- admin configurou — sem alterar nenhuma linha protegida.
--
-- POR QUE TRIGGER E NÃO FK COMPOSTA
--
-- A FK composta `(shift_id, operation_id) -> shifts(id, operation_id)` seria a
-- expressão mais declarativa, e foi a primeira opção avaliada. Ela esbarra em
-- dois fatos do schema, ambos verificados:
--
--   1. `shifts` tem só `PRIMARY KEY (id)`. A FK exigiria criar um
--      `UNIQUE (id, operation_id)` novo — índice redundante, já que `id` é
--      único sozinho, mantido só para sustentar a FK.
--
--   2. Uma FK tem UMA ação referencial para todas as suas colunas, e as duas
--      FKs atuais têm ações OPOSTAS: `timesheets_shift_id_fkey` é
--      `ON DELETE SET NULL` e `timesheets_operation_id_fkey` é
--      `ON DELETE CASCADE`. Não há ação única que sirva: SET NULL tentaria
--      anular também `operation_id`, que é NOT NULL, e o DELETE de um turno
--      passaria a falhar por violação de NOT NULL em vez de desvincular.
--
-- O critério era menor mudança estrutural e menor risco para as cascatas. A FK
-- composta perde nos dois. Trigger.
--
-- ERRCODE 23514, NÃO 42501, e a escolha é deliberada: nenhum papel pode criar
-- um par inválido, nem admin, nem `postgres`, nem `service_role`. Dizer
-- "privilégio insuficiente" sugeriria que existe alguém com esse privilégio.
-- É violação de invariante — o mesmo que uma FK composta teria recusado.
--
-- `shift_id` NULL segue aceito: a coluna é anulável no modelo atual, o painel
-- cria folha sem turno, e a FK de turno anula esse campo ao apagar o turno.
-- Não é papel desta migration proibir o que o modelo permite.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validar_par_operacao_turno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.shift_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.shifts s
        WHERE s.id = NEW.shift_id
          AND s.operation_id = NEW.operation_id
     ) THEN
    RAISE EXCEPTION
      'Turno informado não pertence à operação da folha.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_par_operacao_turno() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_par_operacao_turno() FROM anon;
REVOKE ALL ON FUNCTION public.validar_par_operacao_turno() FROM authenticated;
REVOKE ALL ON FUNCTION public.validar_par_operacao_turno() FROM service_role;

COMMENT ON FUNCTION public.validar_par_operacao_turno() IS
  'Exige que timesheets.shift_id pertença a timesheets.operation_id. Substitui uma FK composta, inviável porque shifts não tem UNIQUE (id, operation_id) e as duas FKs atuais têm ações de DELETE opostas. Invariante estrutural: vale para todos os papéis.';

-- Vale em INSERT e em UPDATE. O UPDATE já tem a guarda de papel acima, mas
-- ela isenta admin e a escrita interna — e nem eles devem produzir um par
-- inválido. Rodam as duas, em camadas diferentes.
DROP TRIGGER IF EXISTS trg_timesheets_valida_par ON public.timesheets;
CREATE TRIGGER trg_timesheets_valida_par
  BEFORE INSERT OR UPDATE OF operation_id, shift_id ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.validar_par_operacao_turno();

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
