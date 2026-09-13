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
-- própria de `shifts`, na seção 2 — que na sexta rodada deixou de perguntar
-- por faturamento e passou a perguntar por REFERÊNCIA, porque o turno também
-- sumia enquanto o apontamento ainda era rascunho.
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
--
-- TERCEIRA RODADA DE REVISÃO
--
-- Mais três, também reproduzidos antes de fechar, e os dois primeiros mostram
-- que proteger o VÍNCULO e o DELETE não bastava — faltava proteger a LINHA:
--
--   4. a linha faturada continuava editável, e editá-la REESCREVIA os valores:
--      `status = 'absent'` levou `billed_amount` de 200.00 a 0.00, e
--      `check_out = '23:00'` levou a 500.00, com a fatura parada nos 250.00
--      originais — seção 1c;
--   5. `timesheets.work_date` mudava depois do faturamento, movendo o lastro
--      para outro período — seção 3c;
--   6. o par operação/turno podia ser quebrado pelo LADO DO TURNO, movendo um
--      turno já referenciado — seção 3d.
--
-- A lição das seções 1c e 3c está escrita nelas: onde havia lista de colunas,
-- passou a haver invariante sobre a linha. Uma lista protege o que alguém
-- lembrou; a comparação protege também o que ainda não existe.
--
-- QUARTA RODADA DE REVISÃO
--
-- Mais três, reproduzidos antes de fechar — dois deles com DUAS sessões psql,
-- porque leitura de snapshot não os revelava:
--
--   7. ADMIN seguia isento em `operations.client_id`, e para operação já
--      faturada isso faz o extrato cobrar um cliente e a fatura outro —
--      seção 3e;
--   8. mover um turno era recusado por folha, mas não por `operation_team`:
--      turno só com equipe alocada era movido, e o colaborador ficava preso
--      pelo índice de alocação exclusiva — seção 3d;
--   9. as duas guardas do par eram leitura de snapshot sem lock, e as duas
--      ordens produziam par inválido em corrida real — seção 3b.
--
-- O padrão desta rodada é outro: não são colunas esquecidas, são consequências
-- de segunda ordem — quem mais lê o dado, quem mais referencia a linha, e o
-- que acontece quando duas transações decidem ao mesmo tempo.
--
-- QUINTA RODADA DE REVISÃO
--
-- Mais três, e os três são consequência das correções anteriores:
--
--  10. fechar `X -> NULL` e `X -> Y` sem fechar `NULL -> X` deixava o admin
--      criar vínculo arbitrário pelo PostgREST — e as guardas novas tornavam
--      esse vínculo errado IRREVERSÍVEL. Total de 400.00 contra lastro de
--      600.00, medido — seção 1d;
--  11. este arquivo AFIRMAVA que "a fatura é imutável" para justificar o
--      congelamento do lastro, e a afirmação era FALSA: admin alterava fatura
--      e itens à vontade. O lastro congelado e o resumo mutável é pior que
--      nenhum dos dois, porque parece protegido — seção 1e;
--  12. `operation_team` foi fechada pelo lado de mover o turno e não pelo de
--      criar a alocação — seção 3f.
--
-- A lição desta rodada é sobre método, não sobre SQL: eu afirmei imutabilidade
-- sem verificar, e desenhei uma saída sem olhar a entrada correspondente.
--
-- SEXTA RODADA DE REVISÃO
--
-- Um só, e a correção é uma SIMPLIFICAÇÃO:
--
--  13. a guarda de DELETE de turno perguntava por FATURAMENTO, e a pergunta
--      era cedo demais. O turno era apagado enquanto o apontamento ainda era
--      rascunho, e o rascunho virava fatura depois — histórico faturado com
--      `shift_id` nulo e sem jornada de origem. Passou a perguntar por
--      REFERÊNCIA, que subsume a pergunta antiga — seção 2.
--
-- O padrão das rodadas anteriores era acrescentar guarda. Aqui foi trocar uma
-- condição por outra mais simples e mais forte, e o advisory lock saiu porque
-- a nova pergunta não depende mais do estado de faturamento.
--
-- SÉTIMA RODADA DE REVISÃO
--
-- Dois, e o segundo é regressão introduzida por esta própria migration:
--
--  14. mover uma folha que JÁ TEM apontamento preservava os snapshots da
--      configuração antiga enquanto a chave ia para a nova. Medido com
--      contratos de 100.00 e 1000.00: o cliente caro foi faturado em 100.00.
--      A seção 3c só congelava depois do faturamento, e isso era tarde —
--      seção 3g, com a âncora correspondente na seção 1f;
--  15. a guarda de itens da seção 1e roda um EXISTS por `invoice_id` para cada
--      item, e não havia índice por essa coluna: cada fatura gerada custava
--      uma varredura do histórico por item — seção 1g.
--
-- O 15 é o primeiro achado de DESEMPENHO desta série, e ele não aparecia em
-- teste nenhum porque toda fixture aqui é pequena. Correção por índice, sem
-- reescrever a guarda: o desenho simples continua certo.
--
-- OITAVA RODADA, E AUDITORIA PREVENTIVA DE FECHAMENTO
--
-- Da revisão, mais índices ausentes — `timesheets.shift_id` e
-- `operation_team.shift_id`. Ao inventariar TODAS as queries desta migration
-- para corrigi-los, apareceu um terceiro que a revisão não apontou,
-- `invoices.client_id`, e um vetor que nenhuma revisão apontou:
--
--  16. `DELETE` de CONTRATO com histórico de apontamento era aceito, e
--      `operations.contract_id ON DELETE SET NULL` fazia a operação cair no
--      fallback de `agreed_amount` em silêncio — a mesma forma da seção 2, na
--      outra fonte do cálculo: o turno é a origem da jornada, o contrato é a
--      origem da taxa — seção 2c.
--
-- Sete outros vetores foram testados e NÃO procederam: DELETE de colaborador
-- com apontamento faturado (já recusado), UPDATE multi-coluna misturando
-- protegida e livre (reenvio igual aceito, entry faturada recusada), turno
-- usado por várias folhas, `invoice_items.operation_id ON DELETE SET NULL`
-- (inalcançável, porque o DELETE da operação já é recusado antes), DELETE de
-- fatura, DELETE de cliente faturado, e alteração de `contracts.daily_rate` ou
-- de `operations.contract_id` com apontamentos existentes — estes dois são a
-- semântica de snapshot funcionando como projetado, não defeito.

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
-- 1c. A LINHA faturada inteira é imutável, não só o vínculo
--
-- Levantado em revisão e reproduzido em banco local. Proteger o vínculo e o
-- DELETE ainda deixava a linha editável, e a edição REESCREVIA os valores:
--
--   operacional, entry dentro de fatura fechada, billed_amount = 200.00
--     UPDATE ... SET status    = 'absent'     -> billed_amount = 0.00
--     UPDATE ... SET check_out = '23:00:00'   -> billed_amount = 500.00
--
-- A fatura não muda: `invoices.total_amount` e `invoice_items` continuam nos
-- 250.00 originais, e o lastro que os justifica passa a dizer outra coisa.
--
-- POR QUE COMPARAR A LINHA INTEIRA, E NÃO UMA LISTA DE COLUNAS
--
-- Uma lista é frágil pelo lado errado: ela protege o que alguém lembrou de
-- escrever, e deixa passar toda coluna futura. A comparação é sobre
-- `to_jsonb(NEW)` contra `to_jsonb(OLD)`, então qualquer coluna que venha a
-- existir nesta tabela nasce protegida, sem ninguém precisar lembrar.
--
-- A única exclusão é `updated_at`, metadado técnico reescrito pelo próprio
-- `update_updated_at_column`. Sem excluí-la, um UPDATE inócuo viraria falso
-- positivo. `created_at` e `id` NÃO são excluídos, de propósito: mudar
-- qualquer um dos dois numa linha faturada é falsificação de histórico, não
-- manutenção técnica.
--
-- A mensagem nomeia as colunas que divergiram — quem for corrigir um
-- apontamento faturado precisa saber o que exatamente o sistema recusou.
--
-- ORDEM DOS TRIGGERS: a correção NÃO depende dela
--
-- Alfabeticamente esta guarda roda antes de `calculo_financeiro`, então ela vê
-- o payload cru. Mas a propriedade vale mesmo se a ordem mudar, e vale por
-- construção: `derivar_valores_financeiros` só recalcula quando uma coluna
-- MOTRIZ mudou (`status`, `check_in`, `check_out`, `break_minutes`,
-- `employee_id`, `timesheet_id`), e toda coluna motriz é também uma coluna de
-- negócio — logo já recusada aqui. Quando nenhuma motriz muda, aquela função
-- copia os valores de OLD e não recalcula nada. Não existe caminho em que uma
-- linha faturada seja recalculada, independente de quem roda primeiro.
--
-- A direção do vínculo continua valendo: com `OLD.invoice_id IS NULL` esta
-- guarda nem olha a linha, que é como `gerar_fatura` segue vinculando.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_edicao_faturada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _antes  jsonb;
  _depois jsonb;
  _campos text;
BEGIN
  -- Ainda não faturado: nada a fazer, e é por aqui que `gerar_fatura` passa.
  IF OLD.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  _antes  := to_jsonb(OLD) - 'updated_at';
  _depois := to_jsonb(NEW) - 'updated_at';

  IF _depois IS DISTINCT FROM _antes THEN
    SELECT string_agg(k, ', ' ORDER BY k)
      INTO _campos
      FROM jsonb_object_keys(_antes) AS k
     WHERE _antes -> k IS DISTINCT FROM _depois -> k;

    RAISE EXCEPTION
      'Apontamento faturado é imutável. Alterações recusadas em: %. Fatura: %.',
      _campos, OLD.invoice_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_edicao_faturada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_edicao_faturada() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_edicao_faturada() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_edicao_faturada() FROM service_role;

COMMENT ON FUNCTION public.bloquear_edicao_faturada() IS
  'Congela a linha inteira de um apontamento já faturado, comparando to_jsonb(NEW) com to_jsonb(OLD) e ignorando apenas updated_at. Colunas futuras nascem protegidas. Sem exceção de papel.';

DROP TRIGGER IF EXISTS trg_timesheet_entries_bloqueia_edicao_faturada
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_bloqueia_edicao_faturada
  BEFORE UPDATE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_edicao_faturada();

-- ---------------------------------------------------------------------------
-- 1d. A ENTRADA do vínculo, que as seções 1b e 1c deixaram aberta
--
-- As guardas acima fecham `X -> NULL` e `X -> Y`. Não fechavam `NULL -> X`, e
-- `protect_timesheet_invoice_link` isenta admin. Levantado em revisão e
-- reproduzido em banco local, sessão de admin em aal2, direto no PostgREST:
--
--   UPDATE timesheet_entries SET invoice_id = <fatura existente>
--     -> VINCULOU
--     -> total da fatura 400.00  x  soma do lastro vinculado 600.00
--
-- Nenhum `invoice_item` foi criado, nenhum total ajustado. E o agravante é que
-- a seção 1b torna esse vínculo errado IRREVERSÍVEL. Fechar a saída sem fechar
-- a entrada foi um erro meu de desenho, não um caso de borda.
--
-- ONDE FICA A FRONTEIRA, E O QUE ELA NÃO PROMETE
--
-- `gerar_fatura` é `SECURITY DEFINER` e pertence a `postgres`, então dentro
-- dela `current_user` é `postgres`. Isso foi MEDIDO, não presumido: um trigger
-- espião instalado durante a chamada registrou `postgres`.
--
-- É essa a única distinção confiável disponível aqui, e ela é deliberadamente
-- MAIS restrita que a de `protect_timesheet_invoice_link`:
--
--   authenticated (inclusive admin)  -> recusado
--   service_role                     -> recusado
--   postgres                         -> permitido
--
-- `service_role` perde o acesso de propósito. A aplicação não a usa, e ela
-- chegaria pela mesma API que se está fechando.
--
-- O QUE ISTO NÃO PROTEGE, dito sem rodeio: uma sessão `postgres` direta — o
-- SQL Editor, por exemplo — continua podendo vincular à mão, e um superusuário
-- pode desabilitar triggers ou alterar o schema de qualquer jeito. Não existe
-- defesa de banco contra o dono do banco. A meta aqui é outra e é alcançável:
-- nenhum caminho normal da aplicação ou da API cria vínculo arbitrário.
--
-- Não se usa GUC nem `set_config` como segredo: um caller que alcança o
-- PostgREST também alcança `set_config`, e a "proteção" seria teatro.
--
-- VALIDAÇÃO SEMÂNTICA — por que ela NÃO vira regra nova aqui
--
-- Com a entrada restrita a `gerar_fatura`, as invariantes que se poderia
-- querer checar já são verdadeiras por construção dela: o passo 6 seleciona
-- por `o.client_id = _client_id` e `t.work_date BETWEEN _period_start AND
-- _period_end`, e os passos 7 a 9 derivam totais e itens dos MESMOS
-- `_ids`. Reescrever essas condições como CHECK duplicaria a regra em dois
-- lugares que podem divergir. Ficam como TESTE, não como código.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_vinculo_fora_do_faturamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _vinculando boolean;
BEGIN
  _vinculando :=
    CASE
      WHEN TG_OP = 'INSERT' THEN NEW.invoice_id IS NOT NULL
      ELSE OLD.invoice_id IS NULL AND NEW.invoice_id IS NOT NULL
    END;

  -- Sem exceção para admin nem para `service_role`, de propósito.
  IF _vinculando AND current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Vínculo de fatura só pode ser criado pelo faturamento. Use gerar_fatura.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_vinculo_fora_do_faturamento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_vinculo_fora_do_faturamento() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_vinculo_fora_do_faturamento() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_vinculo_fora_do_faturamento() FROM service_role;

COMMENT ON FUNCTION public.bloquear_vinculo_fora_do_faturamento() IS
  'Restringe a criação do vínculo entry->fatura ao contexto de gerar_fatura, medido por current_user = postgres. Recusa authenticated (admin incluído) e service_role. Não protege contra sessão postgres direta nem contra superusuário: a fronteira é a API da aplicação.';

DROP TRIGGER IF EXISTS trg_timesheet_entries_bloqueia_vinculo_direto
  ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_bloqueia_vinculo_direto
  BEFORE INSERT OR UPDATE OF invoice_id ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_vinculo_fora_do_faturamento();

-- ---------------------------------------------------------------------------
-- 1f. Âncora: a folha pai não muda enquanto se deriva a partir dela
--
-- Metade da correção da seção 3g, e a que fica deste lado. Os valores de um
-- apontamento são derivados da configuração da folha — operação, contrato,
-- turno — e essa configuração precisa estar estável entre a leitura e o
-- commit. A FK já toma `FOR KEY SHARE` na folha, mas esse modo protege a
-- EXISTÊNCIA da linha, não as suas colunas: ele não conflita com o
-- `FOR NO KEY UPDATE` de um `UPDATE timesheets SET operation_id`.
--
-- `FOR SHARE` é o modo certo, pelo mesmo motivo da seção 3b: conflita com
-- qualquer alteração da folha, e NÃO conflita com outro `FOR SHARE` — vários
-- apontamentos sendo gravados na mesma folha, que é o fluxo diário inteiro,
-- continuam paralelos entre si.
--
-- O nome começa com `ancora` para ordenar ANTES de todas as guardas `bloqueia`
-- e do `calculo_financeiro`: a folha é travada antes de qualquer leitura da
-- sua configuração.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ancorar_folha_do_apontamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1 FROM public.timesheets t WHERE t.id = NEW.timesheet_id FOR SHARE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ancorar_folha_do_apontamento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ancorar_folha_do_apontamento() FROM anon;
REVOKE ALL ON FUNCTION public.ancorar_folha_do_apontamento() FROM authenticated;
REVOKE ALL ON FUNCTION public.ancorar_folha_do_apontamento() FROM service_role;

COMMENT ON FUNCTION public.ancorar_folha_do_apontamento() IS
  'Trava a folha pai com FOR SHARE enquanto o apontamento é gravado, para que a configuração usada na derivação não mude no meio. Não serializa apontamentos entre si.';

DROP TRIGGER IF EXISTS trg_timesheet_entries_ancora_folha ON public.timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_ancora_folha
  BEFORE INSERT OR UPDATE OF timesheet_id ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.ancorar_folha_do_apontamento();

-- ---------------------------------------------------------------------------
-- 1g. Índice para a busca por vínculo de fatura
--
-- Levantado em revisão: a guarda da seção 1e roda um EXISTS sobre
-- `timesheet_entries.invoice_id` PARA CADA linha de `invoice_items`, e durante
-- `gerar_fatura` a fatura ainda não tem vínculo nenhum — então o EXISTS
-- precisa provar AUSÊNCIA. Sem índice por essa coluna, provar ausência é
-- varrer a tabela inteira, uma vez por item gerado.
--
-- Auditado antes de criar: os índices existentes são por `id`, por
-- `(timesheet_id, employee_id)`, por `timesheet_id`, por `employee_id` e por
-- `(employee_id, operation_id, work_date)`. Nenhum começa por `invoice_id`,
-- então não há redundância aqui.
--
-- PARCIAL, e de propósito. A guarda sempre procura `invoice_id = <uuid não
-- nulo>`, e o histórico ainda não faturado tem `invoice_id` NULL — que num
-- sistema em uso é a maior parte da tabela. O índice parcial indexa só o que
-- se procura, fica pequeno, e o custo de escrita recai apenas sobre a
-- transição para vinculado, que acontece uma vez por apontamento.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_invoice
  ON public.timesheet_entries (invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON INDEX public.idx_timesheet_entries_invoice IS
  'Sustenta o EXISTS por invoice_id das guardas de fatura fechada. Parcial porque a busca é sempre por um invoice_id não nulo e o histórico não faturado é NULL.';

-- ---------------------------------------------------------------------------
-- 1h. Índices para as demais buscas introduzidas por esta migration
--
-- Mesmo problema da seção 1g, em outras três colunas. Levantado em revisão
-- para as duas primeiras; a terceira apareceu ao inventariar TODAS as queries
-- desta migration, e não estava no achado.
--
-- Cada índice abaixo corresponde a uma consulta concreta escrita aqui, e
-- nenhum é especulativo:
--
--   timesheets.shift_id       -> `bloquear_delete_turno_usado` e
--                                `bloquear_mover_turno_referenciado`
--   operation_team.shift_id   -> `bloquear_mover_turno_referenciado`
--   invoices.client_id        -> `bloquear_delete_cliente_faturado`
--
-- Auditado antes de criar: em `timesheets` e `operation_team` os únicos
-- índices compostos que contêm `shift_id` começam por `operation_id`
-- (`timesheets_operation_id_shift_id_work_date_key`,
-- `operation_team_operation_id_shift_id_employee_id_key`), e um btree não
-- serve para buscar pela segunda coluna. `invoices` tinha SÓ a primary key.
--
-- Medido em banco local com 40 000 folhas, 40 000 alocações e 2 000 faturas:
--
--   timesheets.shift_id      Seq Scan 534 buffers 2.553 ms -> Index Only 2 buffers 0.060 ms
--   operation_team.shift_id  Seq Scan 534 buffers 2.854 ms -> Index Only 2 buffers 0.037 ms
--   invoices.client_id       Seq Scan  29 buffers 0.195 ms -> Index Only 2 buffers 0.044 ms
--
-- PARCIAIS nos dois `shift_id`, porque a coluna é anulável nas duas tabelas e
-- a busca é sempre por um id concreto — folha sem turno e alocação sem turno
-- ficam fora do índice. `invoices.client_id` é NOT NULL, então o índice é
-- completo: um índice parcial ali só acrescentaria um predicado inútil.
--
-- Custo de escrita: 1248 kB de índice para 8544 kB de tabela nos dois
-- primeiros, 80 kB para 464 kB no terceiro. `invoices` recebe uma linha por
-- fatura gerada, e as outras duas uma por folha e por alocação criadas — não é
-- caminho de escrita quente.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_timesheets_shift
  ON public.timesheets (shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_operation_team_shift
  ON public.operation_team (shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client
  ON public.invoices (client_id);

COMMENT ON INDEX public.idx_timesheets_shift IS
  'Sustenta o EXISTS por shift_id das guardas de DELETE e de movimento de turno. Parcial: folha sem turno nunca é procurada por este caminho.';

COMMENT ON INDEX public.idx_operation_team_shift IS
  'Sustenta o EXISTS por shift_id da guarda de movimento de turno. Parcial: alocação sem turno nunca é procurada por este caminho.';

COMMENT ON INDEX public.idx_invoices_client IS
  'Sustenta o EXISTS por client_id da guarda de DELETE de cliente com histórico faturado. Completo porque client_id é NOT NULL.';

-- ---------------------------------------------------------------------------
-- 1e. A FATURA fechada também congela — e a afirmação anterior era falsa
--
-- Este bloco existe por um erro meu de método, e vale registrá-lo: as seções
-- acima AFIRMAM que "a fatura é imutável" para justificar o congelamento do
-- lastro. Eu nunca verifiquei. `invoices_write_admin` e
-- `invoice_items_write_admin` são `ALL`, e não havia trigger algum nas duas
-- tabelas — só o de `updated_at`. Reproduzido em banco local, admin em aal2:
--
--   UPDATE invoices SET total_amount = 1, period_start = ...  -> ALTEROU
--   UPDATE invoice_items SET amount = 1, description = ...    -> ALTEROU 2
--   INSERT INTO invoice_items (...)                           -> INSERIU
--   DELETE FROM invoice_items WHERE invoice_id = ...          -> APAGOU 3
--
-- O lastro estava congelado e a fatura que o resume, não. A assimetria é pior
-- que nenhuma das duas: dá a impressão de histórico protegido.
--
-- QUANDO A FATURA FECHA
--
-- Foi preciso ler `gerar_fatura` inteira antes de escolher a condição, porque
-- uma proteção mal colocada quebraria a própria construção. A ordem real é:
--
--   5. advisory lock por cliente
--   6. SELECT dos elegíveis, com `te.invoice_id IS NULL`, FOR UPDATE
--   7. INSERT invoices           <- já nasce com status 'closed'
--   8. INSERT invoice_items      (diárias)
--   9. INSERT invoice_items      (horas extras, condicional)
--  10. UPDATE timesheet_entries SET invoice_id  <- o vínculo é o ÚLTIMO passo
--
-- Duas consequências decidem o desenho. A fatura NASCE `'closed'`, então
-- `status` não distingue construção de histórico — usá-lo travaria a fatura
-- antes mesmo de os itens existirem. E o vínculo vem por último, então
-- "possui ao menos uma entry vinculada" é falso durante os passos 7 a 9 e
-- verdadeiro a partir do commit. É exatamente a fronteira que se quer, e ela
-- não atravessa a construção.
--
-- CONCORRÊNCIA: por que não precisa de lock novo
--
-- Tudo isso acontece em UMA transação. Enquanto ela não commita, a fatura não
-- existe para mais ninguém — não há janela em que a fatura esteja visível e
-- ainda não congelada. Não se acrescenta lock aqui, e portanto nenhuma ordem
-- nova entra no grafo de deadlock.
--
-- Como em 1c, a comparação é sobre a LINHA, não sobre uma lista de colunas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_edicao_fatura_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _antes  jsonb;
  _depois jsonb;
  _campos text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.timesheet_entries te WHERE te.invoice_id = OLD.id
  ) THEN
    RETURN NEW;
  END IF;

  _antes  := to_jsonb(OLD) - 'updated_at';
  _depois := to_jsonb(NEW) - 'updated_at';

  IF _depois IS DISTINCT FROM _antes THEN
    SELECT string_agg(k, ', ' ORDER BY k)
      INTO _campos
      FROM jsonb_object_keys(_antes) AS k
     WHERE _antes -> k IS DISTINCT FROM _depois -> k;

    RAISE EXCEPTION
      'Fatura com lastro vinculado é imutável. Alterações recusadas em: %.',
      _campos
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_itens_fatura_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _faturas uuid[];
BEGIN
  -- No UPDATE entram as DUAS faturas: a de origem e a de destino. Mover um
  -- item para fora de uma fatura fechada é tão grave quanto editá-lo.
  _faturas :=
    CASE TG_OP
      WHEN 'DELETE' THEN ARRAY[OLD.invoice_id]
      WHEN 'INSERT' THEN ARRAY[NEW.invoice_id]
      ELSE ARRAY[OLD.invoice_id, NEW.invoice_id]
    END;

  IF EXISTS (
    SELECT 1
      FROM public.timesheet_entries te
     WHERE te.invoice_id = ANY(_faturas)
  ) THEN
    RAISE EXCEPTION
      'Itens de fatura com lastro vinculado são imutáveis.'
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_edicao_fatura_fechada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_edicao_fatura_fechada() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_edicao_fatura_fechada() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_edicao_fatura_fechada() FROM service_role;

REVOKE ALL ON FUNCTION public.bloquear_itens_fatura_fechada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_itens_fatura_fechada() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_itens_fatura_fechada() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_itens_fatura_fechada() FROM service_role;

COMMENT ON FUNCTION public.bloquear_edicao_fatura_fechada() IS
  'Congela a linha inteira de uma fatura que já tenha apontamento vinculado, comparando to_jsonb e ignorando apenas updated_at. Não atinge a construção em gerar_fatura, onde o vínculo é o último passo. Sem exceção de papel.';

COMMENT ON FUNCTION public.bloquear_itens_fatura_fechada() IS
  'Impede INSERT, UPDATE e DELETE de itens de fatura já com lastro vinculado, incluindo mover um item de uma fatura fechada para outra. Sem exceção de papel.';

DROP TRIGGER IF EXISTS trg_invoices_bloqueia_edicao_fechada ON public.invoices;
CREATE TRIGGER trg_invoices_bloqueia_edicao_fechada
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_edicao_fatura_fechada();

DROP TRIGGER IF EXISTS trg_invoice_items_bloqueia_fechada ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_bloqueia_fechada
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_itens_fatura_fechada();

-- ---------------------------------------------------------------------------
-- 2. Turno JÁ USADO EM FOLHA não é excluível — o caminho que a cascata não
--    alcança
--
-- A primeira versão desta guarda perguntava se o turno tinha apontamento
-- FATURADO. Levantado em revisão e reproduzido em banco local, essa pergunta
-- era cedo demais — a cadeia inteira, medida:
--
--   ADMIN: DELETE FROM shifts                        -> APAGOU
--   timesheets.shift_id                              -> NULL (FK SET NULL)
--   o apontamento continua existindo                 -> 1
--   billed_amount, derivado da jornada do turno já apagado -> 275.00
--   ADMIN: gerar_fatura(...)                         -> FATUROU: total 275.00
--   lastro faturado com shift_id                     -> NULL
--
-- Ou seja: o turno some enquanto o apontamento ainda é rascunho, e só DEPOIS
-- o rascunho vira histórico faturado — já sem a jornada que originou o valor.
-- `gerar_fatura` não exige turno na seleção (passo 6 filtra por cliente,
-- período e `invoice_id IS NULL`), então nada ali barra o caso.
--
-- POR QUE A PERGUNTA NOVA É MAIS SIMPLES, E NÃO MAIS COMPLEXA
--
-- A tentação seria tentar decidir no DELETE se o apontamento "ainda pode ser
-- faturado" — uma previsão sobre o futuro, que depende de período, status e do
-- que o admin vier a fazer. A invariante estrutural é mais barata e mais
-- forte: se ALGUMA folha aponta para o turno, o turno é origem de registro de
-- trabalho e não se apaga. Inativar é o caminho.
--
-- A regra nova SUBSUME a antiga: todo apontamento faturado que a versão
-- anterior protegia estava numa folha com `shift_id = OLD.id`, que é
-- exatamente o que se testa agora. Nada que era recusado passou a ser aceito.
--
-- O ADVISORY LOCK SAIU, e a troca é deliberada. Ele existia porque a pergunta
-- antiga dependia do estado de FATURAMENTO, que `gerar_fatura` podia mudar
-- entre o EXISTS e o commit. A pergunta nova não olha faturamento: olha
-- referência. O que pode mudar concorrentemente agora é a criação da primeira
-- folha, e isso se fecha com lock de LINHA, não com lock por cliente — ver
-- abaixo. Sem advisory aqui, nenhuma ordem nova entra no grafo de deadlock;
-- a guarda de `clients` continua tomando o advisory antes de descer a cascata.
--
-- O LOCK VEM ANTES DA VERIFICAÇÃO, pelo mesmo motivo da seção 3d: um trigger
-- `BEFORE DELETE` roda antes de o executor travar a linha. `FOR UPDATE`
-- conflita com o `FOR SHARE` que `validar_par_operacao_turno` toma ao criar
-- folha, e é isso que serializa criar-folha contra apagar-turno.
--
-- ESCOPO: `operation_team` NÃO entra aqui, e foi medido, não presumido.
-- Apagar um turno que só tem alocação remove a alocação em cascata (1 -> 0,
-- via `operation_team.shift_id ON DELETE CASCADE`). Isso é coerente: sem folha
-- nenhuma, o turno nunca registrou trabalho, a alocação é "quem está escalado
-- neste turno" e perde sentido junto com ele. Não há órfão, não há histórico
-- perdido, e o índice de alocação exclusiva libera o colaborador. Ampliar a
-- regra por analogia proibiria apagar um turno recém-criado por engano.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_delete_turno_usado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1 FROM public.shifts s WHERE s.id = OLD.id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.timesheets t WHERE t.shift_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Turno já utilizado em folha não pode ser excluído. Inative-o.'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_delete_turno_usado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_delete_turno_usado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_delete_turno_usado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_delete_turno_usado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_delete_turno_usado() IS
  'Impede DELETE de turno referenciado por qualquer folha. Existe porque timesheets.shift_id é ON DELETE SET NULL: sem esta guarda o turno sumia enquanto o apontamento era rascunho, e o rascunho virava fatura depois, sem jornada de origem. Sem exceção de papel.';

-- A função antiga perguntava por faturamento e foi substituída pela pergunta
-- estrutural acima, que a subsume. Removida junto com o trigger que a usava
-- para não deixar duas guardas concorrentes sobre o mesmo DELETE.
DROP TRIGGER IF EXISTS trg_shifts_bloqueia_delete_faturado ON public.shifts;
DROP FUNCTION IF EXISTS public.bloquear_delete_turno_faturado();

DROP TRIGGER IF EXISTS trg_shifts_bloqueia_delete_usado ON public.shifts;
CREATE TRIGGER trg_shifts_bloqueia_delete_usado
  BEFORE DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_delete_turno_usado();

-- ---------------------------------------------------------------------------
-- 2c. Contrato já usado não é excluível — a origem da TAXA
--
-- Não veio de revisão: apareceu na auditoria preventiva de fechamento, ao
-- percorrer o grafo de FKs procurando a mesma forma da seção 2. Reproduzido em
-- banco local, com fatura já gerada:
--
--   ADMIN: DELETE FROM contracts                -> APAGOU
--   operations.contract_id                      -> NULL (FK SET NULL)
--
-- É o mesmo desenho do turno, na outra fonte. O turno é a origem da JORNADA; o
-- contrato é a origem da TAXA. Apagá-lo deixa o histórico faturado sem a
-- configuração que justificou o seu valor, e mais: como `operations.contract_id`
-- vira NULL, toda derivação seguinte cai silenciosamente no fallback de
-- `agreed_amount` — a operação muda de preço sem ninguém ter mudado preço.
--
-- O CRITÉRIO É "JÁ FOI USADO", e usado significa "existe apontamento". Um
-- contrato ligado a uma operação que nunca registrou trabalho continua
-- excluível: nada derivou dele. `contracts` tem `status` e `valid_to`, então
-- inativar é caminho real, e a mensagem aponta para ele.
--
-- CONCORRÊNCIA: dois locks, e o primeiro desenho estava errado
--
-- O contrato não é tocado por quem grava apontamento, então travar a linha do
-- contrato não encostaria nessa transação. A primeira tentativa travou as
-- OPERAÇÕES com `FOR UPDATE`, supondo que inserir apontamento tomasse
-- `FOR KEY SHARE` nelas pela FK. Medido em corrida real: **não bloqueou**. A
-- razão é que `timesheet_entries` NÃO tem FK para `operations` — só para
-- `timesheets`, `employees` e `invoices`. A suposição estava errada.
--
-- O caminho do apontamento trava a FOLHA: a FK toma `FOR KEY SHARE` nela e a
-- seção 1f acrescenta `FOR SHARE`. Então são precisos DOIS locks aqui, cada um
-- fechando uma interleaving diferente:
--
--   operations  FOR UPDATE          conflita com o `FOR KEY SHARE` que a FK de
--                                   `timesheets.operation_id` toma -> fecha o
--                                   caso de a PRIMEIRA folha estar nascendo;
--   timesheets  FOR NO KEY UPDATE   conflita com o `FOR SHARE` da seção 1f ->
--                                   fecha o caso de um apontamento estar sendo
--                                   gravado numa folha que já existe.
--
-- O custo fica todo no lado raro: quem apaga contrato trava as operações e as
-- folhas dele. O fluxo diário não paga nada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_delete_contrato_usado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Os dois locks vêm ANTES da pergunta, e nesta ordem: operação e depois
  -- folha, que é a mesma ordem em que o caminho de escrita os alcança.
  PERFORM 1 FROM public.operations o WHERE o.contract_id = OLD.id FOR UPDATE;

  PERFORM 1
     FROM public.timesheets t
     JOIN public.operations o ON o.id = t.operation_id
    WHERE o.contract_id = OLD.id
      FOR NO KEY UPDATE OF t;

  IF EXISTS (
    SELECT 1
      FROM public.timesheet_entries te
      JOIN public.timesheets t ON t.id = te.timesheet_id
      JOIN public.operations  o ON o.id = t.operation_id
     WHERE o.contract_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Contrato já usado em apontamento não pode ser excluído. Inative-o ou encerre a vigência.'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_delete_contrato_usado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_delete_contrato_usado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_delete_contrato_usado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_delete_contrato_usado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_delete_contrato_usado() IS
  'Impede DELETE de contrato do qual algum apontamento já derivou valores. Existe porque operations.contract_id é ON DELETE SET NULL: sem esta guarda a operação perderia a origem da taxa e passaria a cair no fallback de agreed_amount em silêncio. Sem exceção de papel.';

DROP TRIGGER IF EXISTS trg_contracts_bloqueia_delete_usado ON public.contracts;
CREATE TRIGGER trg_contracts_bloqueia_delete_usado
  BEFORE DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_delete_contrato_usado();

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

-- CONCORRÊNCIA: por que `FOR SHARE`, e por que sem ele a guarda não fecha
--
-- Levantado em revisão e reproduzido com duas sessões psql no banco local. A
-- versão anterior era leitura de snapshot pura, e o mesmo valia do outro lado:
--
--   T1 BEGIN; INSERT folha (OP-A + turno S)   -- transação aberta
--   T2 UPDATE shifts SET operation_id = OP-B  -- 3 ms, NÃO bloqueou
--   estado final: folha.op = A | turno.op = B  -> PAR INVALIDO
--
-- E na ordem inversa, com T2 segurando a transação, o resultado era o mesmo.
-- Write skew clássico: as duas transações enxergam o estado anterior, as duas
-- commitam, e o par proibido nasce sem que nenhuma tenha feito nada ilegal
-- isoladamente.
--
-- A FK `timesheets.shift_id` já toma `FOR KEY SHARE` na linha do turno, e é
-- exatamente por isso que a corrida existia: `FOR KEY SHARE` NÃO conflita com
-- `FOR NO KEY UPDATE`, que é o modo que um `UPDATE shifts SET operation_id`
-- adquire. A FK protege a existência do turno, não a sua operação.
--
-- `FOR SHARE` é o modo certo aqui, e não `FOR UPDATE`:
--
--   conflita     com UPDATE/DELETE da linha, FOR UPDATE e FOR NO KEY UPDATE
--                -> qualquer tentativa de mover o turno passa a esperar;
--   NÃO conflita com outro FOR SHARE
--                -> duas folhas sendo criadas para o MESMO turno, que é o
--                   fluxo diário normal, não se serializam uma na outra.
--
-- `FOR UPDATE` fecharia a mesma janela enfileirando o fluxo diário à toa. Esta
-- guarda só LÊ `operation_id`; o que ela precisa dizer é "li esta linha e ela
-- não pode mudar até eu commitar", que é a definição de `FOR SHARE`.
--
-- O `operation_id` é lido DO PRÓPRIO SELECT travado, de propósito. Em READ
-- COMMITTED, uma leitura travada que espera por outra transação reavalia a
-- linha depois da espera: se o turno acabou de ser movido, é o valor NOVO que
-- volta aqui, e a validação recusa. Ler antes e travar depois perderia isso.
CREATE OR REPLACE FUNCTION public.validar_par_operacao_turno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _operacao_do_turno uuid;
  _achou boolean;
BEGIN
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.operation_id INTO _operacao_do_turno
    FROM public.shifts s
   WHERE s.id = NEW.shift_id
     FOR SHARE;

  _achou := FOUND;

  -- Turno inexistente não é problema desta guarda: a própria FK recusa com
  -- 23503, e sequestrar esse caso aqui trocaria o código de erro sem motivo.
  IF NOT _achou THEN
    RETURN NEW;
  END IF;

  IF _operacao_do_turno IS DISTINCT FROM NEW.operation_id THEN
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
-- 3c. A folha que já tem apontamento faturado também congela
--
-- Levantado em revisão e reproduzido em banco local: com um apontamento já
-- dentro de fatura fechada, tanto `operacional` quanto ADMIN ALTERARAM o
-- `work_date` da folha. `gerar_fatura` usa `t.work_date` para escolher o
-- período (`t.work_date BETWEEN _period_start AND _period_end`), e o extrato
-- exibe a mesma data: mover a data depois de faturar joga o lastro para outro
-- período sem tocar na fatura nem nos totais.
--
-- `operation_id` e `shift_id` entram na mesma guarda pelo mesmo motivo, e não
-- porque a revisão os tenha citado. Os três respondem à mesma pergunta — a
-- que trabalho esta fatura se refere. Deixar dois de fora repetiria o erro da
-- lista frágil que a seção 1c existe para não cometer.
--
-- ADVISORY LOCK, e por que ele vem antes da verificação
--
-- Mesma convenção de `gerar_fatura`, do DELETE de `clients` e do DELETE de
-- `shifts`: `hashtextextended(client_id::text, 0)`. Sem ele existe janela
-- real — a fatura pode nascer entre o EXISTS e o commit, e a data teria sido
-- movida assim mesmo. Travar pelo mesmo hash serializa as duas operações.
--
-- O cliente sai de OLD.operation_id, não de NEW: a pergunta é sobre o lastro
-- que a folha JÁ tem, e ele pertence ao cliente de hoje. Se a folha estiver
-- mudando de operação, travar pelo cliente de destino deixaria a corrida
-- aberta exatamente do lado que importa.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_alteracao_folha_faturada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _client_id uuid;
BEGIN
  -- Reenvio sem mudança não pode virar 42501: a tela manda o objeto inteiro.
  IF NEW.work_date    IS NOT DISTINCT FROM OLD.work_date
     AND NEW.operation_id IS NOT DISTINCT FROM OLD.operation_id
     AND NEW.shift_id     IS NOT DISTINCT FROM OLD.shift_id THEN
    RETURN NEW;
  END IF;

  SELECT o.client_id INTO _client_id
    FROM public.operations o
   WHERE o.id = OLD.operation_id;

  IF _client_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));
  END IF;

  -- Verificação DEPOIS do lock, de propósito.
  IF EXISTS (
    SELECT 1
      FROM public.timesheet_entries te
     WHERE te.timesheet_id = OLD.id
       AND te.invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Folha com apontamento faturado não pode ter data, operação ou turno alterados.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_alteracao_folha_faturada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_alteracao_folha_faturada() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_alteracao_folha_faturada() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_alteracao_folha_faturada() FROM service_role;

COMMENT ON FUNCTION public.bloquear_alteracao_folha_faturada() IS
  'Congela work_date, operation_id e shift_id de folha que já tenha apontamento faturado. Toma o mesmo advisory lock por cliente que gerar_fatura. Sem exceção de papel.';

-- `bloqueia_faturada` < `bloqueia_fontes`: a recusa por lastro vem antes da
-- recusa por papel, que é a mensagem certa quando as duas se aplicam.
DROP TRIGGER IF EXISTS trg_timesheets_bloqueia_faturada ON public.timesheets;
CREATE TRIGGER trg_timesheets_bloqueia_faturada
  BEFORE UPDATE OF work_date, operation_id, shift_id ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_alteracao_folha_faturada();

-- ---------------------------------------------------------------------------
-- 3g. Folha COM apontamento não muda de operação nem de turno
--
-- A seção 3c congela a folha depois do FATURAMENTO. Levantado em revisão e
-- reproduzido, isso era tarde demais: mover uma folha ainda em rascunho já
-- corrompe o lastro, porque os apontamentos guardam SNAPSHOTS.
--
-- Medido, com duas configurações propositalmente distantes — contrato de
-- 100.00 e contrato de 1000.00:
--
--   ANTES:  billed 100.00 / daily_rate_snapshot 100.00   (config BARATA)
--   ADMIN:  UPDATE timesheets SET operation_id = <OP CARA>, shift_id = ...
--           -> MOVEU
--   DEPOIS: billed 100.00 / daily_rate_snapshot 100.00   (config BARATA)
--           entry.operation_id -> OP CARA
--   gerar_fatura no cliente CARO -> FATUROU: total 100.00
--
-- Ou seja: `propagar_chave_da_diaria` leva a CHAVE desnormalizada para a
-- operação nova, mas `derivar_valores_financeiros` trata `operation_id` e
-- `work_date` como NÃO motrizes — de propósito, pela seção 010 — e preserva os
-- snapshots. `gerar_fatura` então agrupa sob o cliente novo somando valores da
-- configuração velha. O cliente CARO é cobrado 100.00 em vez de 1000.00; na
-- direção inversa, cobra-se dez vezes a mais.
--
-- POR QUE RECUSAR E NÃO REDERIVAR
--
-- Recalcular todos os filhos ao mover a folha mudaria preço, hora extra,
-- snapshots, cliente e agrupamento de faturamento — uma operação de negócio
-- significativa, que não pode acontecer como efeito colateral de um UPDATE
-- administrativo comum. Se "mover folha" for necessário um dia, será operação
-- explícita, transacional e auditável. Fora do escopo desta migration.
--
-- `work_date` NÃO entra nesta proibição: ele não é motriz nem altera
-- configuração, e editar a data de uma folha em rascunho segue legítimo. A
-- seção 3c já o congela depois do faturamento.
--
-- ERRCODE 42501, e não 23514: isto não é par estruturalmente impossível — a
-- combinação seria perfeitamente válida numa folha vazia. É proteção de
-- contexto já utilizado, a mesma família das guardas de histórico.
--
-- CONCORRÊNCIA — a matriz de conflito, e por que a FK não bastava
--
-- Auditado, não presumido: ao inserir um apontamento, a FK
-- `timesheet_entries.timesheet_id` toma `FOR KEY SHARE` na folha pai (visível
-- como RowShareLock na tabela e `xmax` na linha). E `FOR KEY SHARE` NÃO
-- conflita com `FOR NO KEY UPDATE`, que é o modo de um
-- `UPDATE timesheets SET operation_id`. A FK protege a existência da folha,
-- não a sua configuração — exatamente o mesmo padrão da seção 3b.
--
-- Reproduzido nas DUAS ordens antes da correção. As transações até esperavam
-- ~4 s uma pela outra, por causa do `propagar_chave_da_diaria`, e mesmo assim
-- o estado final era o proibido: folha na OP CARA com snapshot de 100.00.
-- Serializar não bastava; era preciso RECUSAR.
--
--   lado do apontamento: `FOR SHARE` na folha pai (seção 1f). Conflita com
--     qualquer alteração da linha e NÃO conflita com outro `FOR SHARE`, então
--     vários apontamentos na mesma folha — o fluxo diário — não se serializam.
--   lado do movimento: `FOR NO KEY UPDATE` ANTES do EXISTS. É o modo mínimo
--     que conflita com aquele `FOR SHARE`, e é o mesmo que o UPDATE tomaria
--     sozinho. `FOR UPDATE` também fecharia, mas conflitaria além do
--     necessário, com o `FOR KEY SHARE` da própria FK.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_mover_folha_com_apontamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.operation_id IS NOT DISTINCT FROM OLD.operation_id
     AND NEW.shift_id IS NOT DISTINCT FROM OLD.shift_id THEN
    RETURN NEW;
  END IF;

  -- Antes do EXISTS: um `BEFORE UPDATE` roda antes de o executor travar a
  -- linha, e sem isto a verificação decidiria sobre estado velho.
  PERFORM 1 FROM public.timesheets t WHERE t.id = OLD.id FOR NO KEY UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.timesheet_entries te WHERE te.timesheet_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Folha com apontamento não pode mudar de operação nem de turno. Os valores já gravados vêm da configuração atual.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_mover_folha_com_apontamento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_mover_folha_com_apontamento() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_mover_folha_com_apontamento() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_mover_folha_com_apontamento() FROM service_role;

COMMENT ON FUNCTION public.bloquear_mover_folha_com_apontamento() IS
  'Impede mudar operation_id ou shift_id de folha que já tenha apontamento, faturado ou não, porque os apontamentos guardam snapshots da configuração antiga. Trava a folha antes de verificar. Sem exceção de papel. work_date fica de fora: não é motriz.';

-- `bloqueia_faturada` < `bloqueia_fontes` < `bloqueia_mover_folha`: quando as
-- três se aplicam, vence a mensagem mais específica, sobre lastro faturado.
DROP TRIGGER IF EXISTS trg_timesheets_bloqueia_mover_folha ON public.timesheets;
CREATE TRIGGER trg_timesheets_bloqueia_mover_folha
  BEFORE UPDATE OF operation_id, shift_id ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_mover_folha_com_apontamento();

-- ---------------------------------------------------------------------------
-- 3d. O outro lado da relação: turno já usado não muda de operação
--
-- `validar_par_operacao_turno` guarda a folha. Levantado em revisão e
-- reproduzido em banco local, o par podia ser quebrado pelo turno:
--
--   turno S pertence à operação A, folha T = operação A + turno S
--   ADMIN: UPDATE shifts SET operation_id = B  ->  MOVEU
--   par resultante: folha.operation_id = A, turno.operation_id = B
--
-- A folha não é tocada, e o par proibido passa a existir sem que ninguém o
-- tenha inserido. O recálculo seguinte volta a combinar a taxa de A com a
-- jornada do turno de B.
--
-- DECISÃO: mover só é possível enquanto NENHUMA folha referenciar o turno.
-- Basta uma, faturada ou não, para recusar — vale inclusive para admin.
--
-- Deliberadamente NÃO propaga `operation_id` para as folhas existentes nem
-- reescreve histórico: isso mudaria silenciosamente a que operação pertence
-- trabalho já registrado. Para mover um turno já usado, o caminho seguro é
-- criar um turno novo na operação de destino.
--
-- ERRCODE 23514 pelo mesmo motivo da seção 3b: é a mesma invariante, vista do
-- outro lado, e nenhum papel pode violá-la.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_mover_turno_referenciado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.operation_id IS NOT DISTINCT FROM OLD.operation_id THEN
    RETURN NEW;
  END IF;

  -- O lock vem ANTES das verificações, e o motivo é sutil: um trigger
  -- `BEFORE UPDATE` roda antes de o executor travar a linha. Sem esta linha, o
  -- EXISTS abaixo leria o estado anterior, aprovaria, e só então o UPDATE
  -- esperaria pelo lock — tarde demais, porque a decisão já teria sido tomada
  -- sobre dados velhos. Foi assim que a corrida com a criação de folha
  -- aconteceu de verdade em banco local.
  --
  -- `FOR NO KEY UPDATE` é exatamente o modo que o UPDATE seguinte adquiriria
  -- sozinho, já que `operation_id` não é coluna de chave: não escala o lock, e
  -- conflita com o `FOR SHARE` que `validar_par_operacao_turno` toma.
  PERFORM 1 FROM public.shifts s WHERE s.id = OLD.id FOR NO KEY UPDATE;

  -- Duas tabelas referenciam um turno, e as duas contam como uso.
  --
  -- `operation_team` entrou aqui depois, levantado em revisão e reproduzido:
  -- um turno SEM folha mas COM equipe alocada era movido sem recusa. A
  -- alocação guarda `operation_id` E `shift_id`, e a tela de apontamento exige
  -- que os dois batam — então o colaborador sumia de todo turno selecionável.
  -- Pior: o índice `operation_team_um_ativo_por_colaborador` impede alocá-lo em
  -- outro lugar enquanto a alocação órfã estiver ativa, e o colaborador ficava
  -- preso. Não é dano financeiro, é dano operacional, e foi por procurar só
  -- efeito financeiro que ele passou na primeira vez.
  IF EXISTS (SELECT 1 FROM public.timesheets t WHERE t.shift_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.operation_team ot WHERE ot.shift_id = OLD.id) THEN
    RAISE EXCEPTION
      'Turno já usado em folha ou alocação não pode mudar de operação. Crie um turno novo na operação de destino.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_mover_turno_referenciado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_mover_turno_referenciado() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_mover_turno_referenciado() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_mover_turno_referenciado() FROM service_role;

COMMENT ON FUNCTION public.bloquear_mover_turno_referenciado() IS
  'Impede mudar shifts.operation_id enquanto alguma folha OU alocação de equipe referenciar o turno. Trava a linha do turno antes de verificar, porque o BEFORE trigger roda antes do lock do executor. Invariante estrutural: vale para todos os papéis.';

-- ---------------------------------------------------------------------------
-- 3e. Cliente de operação com histórico faturado
--
-- A seção 3 já impede `operacional` de mexer em `client_id`. ADMIN seguia
-- isento, e para operação já faturada isso quebra o histórico. Levantado em
-- revisão e reproduzido em banco local:
--
--   ADMIN: UPDATE operations SET client_id = <Cliente B>  ->  ALTEROU
--   operação -> Cliente B   |   fatura -> Cliente A   ->  DIVERGE
--
-- A fatura guarda o `invoices.client_id` original, e a seção 1e a torna
-- imutável depois de fechada — quando escrevi este comentário pela primeira
-- vez eu AFIRMEI essa imutabilidade sem ter verificado, e ela era falsa. Mas o
-- extrato
-- resolve o cliente pelo `operations.client_id` de HOJE
-- (`src/lib/ledger.ts`), então o mesmo apontamento passa a aparecer sob o
-- cliente B no relatório e sob o cliente A na fatura que o cobra.
--
-- Sem exceção de papel. Operação SEM histórico faturado continua livre para o
-- admin — é decisão administrativa legítima, e a proteção é sobre o passado,
-- não sobre a operação.
--
-- ADVISORY LOCK: UM cliente, não dois
--
-- Trava-se `OLD.client_id`, a mesma chave de `gerar_fatura`, e a verificação
-- vem depois. As duas ordens ficam corretas:
--
--   fatura primeiro -> o UPDATE espera, e ao prosseguir já ENXERGA o lastro
--                      recém-criado, então recusa;
--   UPDATE primeiro -> `gerar_fatura` espera; ao prosseguir, a operação não
--                      está mais sob o cliente A e o seu `WHERE o.client_id`
--                      simplesmente não a alcança.
--
-- `NEW.client_id` NÃO é travado, e isso é deliberado em vez de esquecimento.
-- Faturar sob o cliente de DESTINO depois da mudança é legítimo: a invariante
-- protegida é "operação com passado faturado não troca de cliente", e ela é
-- decidida inteiramente pelo lado de OLD. Travar dois clientes exigiria ordem
-- determinística contra deadlock e não compraria nada.
--
-- ORDEM GLOBAL DE LOCKS, para que nenhum ciclo exista: todo caminho deste
-- schema adquire o advisory por cliente ANTES de qualquer lock de linha em
-- `shifts`, nunca o contrário. `gerar_fatura`, as guardas de DELETE de
-- `clients` e `shifts`, a guarda de folha faturada e esta seguem a mesma
-- ordem; `validar_par_operacao_turno` e `bloquear_mover_turno_referenciado`
-- tomam lock de linha e nenhum advisory.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bloquear_cliente_operacao_faturada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Reenvio do mesmo cliente não pode virar 42501: a tela manda o objeto todo.
  IF NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.client_id::text, 0));

  -- Verificação DEPOIS do lock, de propósito. O caminho é o mesmo de
  -- `gerar_fatura`: entry -> folha -> operação.
  IF EXISTS (
    SELECT 1
      FROM public.timesheet_entries te
      JOIN public.timesheets t ON t.id = te.timesheet_id
     WHERE t.operation_id = OLD.id
       AND te.invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Operação com histórico faturado não pode mudar de cliente. A fatura continuaria no cliente original.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_cliente_operacao_faturada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_cliente_operacao_faturada() FROM anon;
REVOKE ALL ON FUNCTION public.bloquear_cliente_operacao_faturada() FROM authenticated;
REVOKE ALL ON FUNCTION public.bloquear_cliente_operacao_faturada() FROM service_role;

COMMENT ON FUNCTION public.bloquear_cliente_operacao_faturada() IS
  'Congela operations.client_id quando a operação já tem apontamento faturado, para que o extrato não resolva um cliente diferente do que a fatura cobra. Toma o advisory lock do cliente de OLD, o mesmo de gerar_fatura. Sem exceção de papel.';

-- `bloqueia_faturada` < `bloqueia_fontes`: a recusa por histórico vem antes da
-- recusa por papel, que é a mensagem certa quando as duas se aplicam.
DROP TRIGGER IF EXISTS trg_operations_bloqueia_faturada ON public.operations;
CREATE TRIGGER trg_operations_bloqueia_faturada
  BEFORE UPDATE OF client_id ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_cliente_operacao_faturada();

DROP TRIGGER IF EXISTS trg_shifts_bloqueia_mover_referenciado ON public.shifts;
CREATE TRIGGER trg_shifts_bloqueia_mover_referenciado
  BEFORE UPDATE OF operation_id ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_mover_turno_referenciado();

-- ---------------------------------------------------------------------------
-- 3f. O par da ALOCAÇÃO, pelo lado que faltava
--
-- A seção 3d fechou "mover turno já alocado". Faltava o simétrico: `criar`
-- alocação incompatível. `operation_team_staff` é `ALL`, não há constraint
-- composta, e a tabela guarda `operation_id` e `shift_id` separados.
-- Levantado em revisão e reproduzido em banco local, `operacional` em aal2:
--
--   INSERT operation_team (operation_id = OP-A, shift_id = turno da OP-B)
--     -> CRIOU par incompatível
--
-- O estrago é o mesmo da seção 3d, alcançado pela outra ponta: a tela de
-- apontamento exige que os dois campos batam, o colaborador some de todo turno
-- selecionável, e o índice de alocação exclusiva impede realocá-lo.
--
-- É a mesma invariante estrutural da seção 3b, na tabela vizinha, então segue
-- as mesmas três decisões, pelas mesmas razões: ERRCODE 23514 e não 42501,
-- porque nenhum papel pode; `shift_id` NULL segue aceito, porque a coluna é
-- anulável no modelo e alocação sem turno é alocação na operação inteira; e o
-- turno é lido com `FOR SHARE` do próprio SELECT travado, para não repetir a
-- corrida que a seção 3b teve de corrigir depois — `FOR SHARE` aqui conflita
-- com o `FOR NO KEY UPDATE` que a seção 3d toma, e é isso que serializa criar
-- alocação contra mover turno.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validar_par_alocacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _operacao_do_turno uuid;
BEGIN
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.operation_id INTO _operacao_do_turno
    FROM public.shifts s
   WHERE s.id = NEW.shift_id
     FOR SHARE;

  -- Turno inexistente é assunto da FK, que recusa com 23503.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF _operacao_do_turno IS DISTINCT FROM NEW.operation_id THEN
    RAISE EXCEPTION
      'Turno informado não pertence à operação da alocação.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_par_alocacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_par_alocacao() FROM anon;
REVOKE ALL ON FUNCTION public.validar_par_alocacao() FROM authenticated;
REVOKE ALL ON FUNCTION public.validar_par_alocacao() FROM service_role;

COMMENT ON FUNCTION public.validar_par_alocacao() IS
  'Exige que operation_team.shift_id pertença a operation_team.operation_id. Trava o turno com FOR SHARE para serializar contra o movimento do turno. Invariante estrutural: vale para todos os papéis.';

DROP TRIGGER IF EXISTS trg_operation_team_valida_par ON public.operation_team;
CREATE TRIGGER trg_operation_team_valida_par
  BEFORE INSERT OR UPDATE OF operation_id, shift_id ON public.operation_team
  FOR EACH ROW EXECUTE FUNCTION public.validar_par_alocacao();

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
