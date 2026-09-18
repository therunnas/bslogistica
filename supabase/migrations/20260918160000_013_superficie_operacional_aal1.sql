-- Fundação da superfície operacional AAL1 — PR B1.
--
-- O QUE ESTE PR ENTREGA, E O QUE ELE DELIBERADAMENTE NÃO ENTREGA
--
-- Entrega a FUNDAÇÃO de autorização da política aprovada em PROGRESS.md,
-- seções 6 e 7: a tabela de atribuição usuário -> operação, o helper que
-- decide se a sessão atual é um operador autorizado naquela operação, e cinco
-- RPCs de contrato fechado — quatro de leitura e uma de escrita.
--
-- NÃO libera AAL1 nas tabelas. As 11 policies `*_exige_aal2` da migration 009
-- continuam RESTRICTIVE, globais e intactas, e nenhuma linha desta migration
-- as altera. Um `operacional` em AAL1 continua sem enxergar
-- `operations`, `shifts`, `employees`, `timesheets` ou `timesheet_entries`
-- pelo PostgREST: a única porta é a RPC estreita, que devolve colunas
-- escolhidas uma a uma.
--
-- NÃO altera o frontend. A UI ainda não consome nada disto — é o PR B2 que
-- adapta `queries.ts`, `painel-apontamentos.tsx`, o guard e o login.
--
-- POR QUE RPC EM VEZ DE POLICY POR PAPEL
--
-- A alternativa seria afrouxar a policy de AAL2 para `operacional` e deixar a
-- RLS filtrar linha a linha. Isso devolveria ao cliente a TABELA inteira,
-- colunas incluídas: `employees.daily_cost`, `contracts.daily_rate`,
-- `operations.agreed_amount`, `timesheet_entries.billed_amount` e os três
-- snapshots. RLS filtra LINHA, não COLUNA — proteger coluna exigiria view com
-- `security_invoker`, grants por coluna e uma policy nova por tabela, tudo
-- coordenado. A decisão de produto deste PR é que o operador não recebe
-- NENHUM valor financeiro, nem `client_id`, nem documento ou telefone de
-- ninguém. Um contrato fechado de sete colunas cumpre isso por construção:
-- o que não está no `RETURNS TABLE` não existe para quem chama.
--
-- SECURITY DEFINER IGNORA RLS — e é por isso que cada função revalida tudo
--
-- Toda função abaixo roda como `postgres` e portanto passa por cima das
-- policies. Não há camada por baixo que possa salvar um descuido: papel, AAL,
-- estado de MFA e atribuição são verificados DENTRO de cada função, sempre
-- pelo mesmo helper, antes de qualquer leitura ou escrita. É o mesmo desenho
-- de `gerar_fatura` (migration 009, seção 2).
--
-- A AUTORIDADE FINANCEIRA CONTINUA SENDO A 010
--
-- A RPC de escrita grava exclusivamente `status`, `check_in`, `check_out`,
-- `break_minutes` e `notes`. Nenhuma coluna financeira é mencionada no INSERT
-- nem no UPDATE, então `derivar_valores_financeiros()` continua sendo quem
-- calcula `billed_amount`, `cost_amount` e os snapshots — exatamente como no
-- caminho do admin. E as guardas da 011 continuam valendo: linha faturada
-- recusa UPDATE, e o vínculo com fatura não nasce aqui.
--
-- CUIDADO DOCUMENTADO: dentro de uma função SECURITY DEFINER de `postgres`,
-- `current_user` é `postgres`. As guardas de 010 e 011 que perguntam
-- `current_user NOT IN ('postgres','service_role')` portanto NÃO disparam aqui.
-- O mesmo já valia para `gerar_fatura` desde a 009 — a novidade é que agora
-- existe uma SEGUNDA porta com esse privilégio, e ela é operada por um papel
-- menos confiável.
--
-- ISTO FOI AUDITADO GUARDA POR GUARDA E MEDIDO, não presumido. O bloco K de
-- `supabase/tests/009_superficie_operacional.sql` executa cada tentativa com
-- `current_user = postgres`, que é exatamente o contexto destas funções.
--
-- CAMADA 2 VIVA — continua valendo mesmo por dentro desta superfície, porque
-- estas guardas não isentam papel nenhum:
--
--   bloquear_edicao_faturada        linha faturada é imutável        (K7)
--   bloquear_delete_faturado        linha faturada não se apaga      (K8)
--   bloquear_desvinculo_faturado    vínculo não se desfaz            (K6)
--   bloquear_mover_folha_com_apontamento  folha com apontamento não muda de
--                                   operação nem de turno            (K10)
--   validar_par_operacao_turno      turno tem de ser da operação     (K13)
--   derivar_valores_financeiros     o valor é do banco, não do payload (K1/K2/K4)
--   sincronizar_chave_da_diaria     a chave vem da folha             (E6)
--   índices únicos: uma diária por colaborador/operação/dia e uma alocação
--                                   ativa por colaborador            (K17/K18)
--
-- CAMADA 2 AUSENTE por aqui — onde SÓ o contrato desta RPC protege:
--
--   1. VÍNCULO DE FATURA. `bloquear_vinculo_fora_do_faturamento` exige
--      `current_user = postgres` para criar vínculo, e
--      `protect_timesheet_invoice_link` isenta `postgres`: as duas deixam
--      passar aqui (K5). O que impede é esta RPC nunca nomear `invoice_id` em
--      lista de colunas nenhuma, e a lista branca de chaves do JSON recusar a
--      chamada inteira se ele aparecer (F3). **Nunca escrever `invoice_id`
--      nesta superfície.**
--   2. COLUNA FINANCEIRA EM UPDATE. `bloquear_edicao_financeira` isenta
--      `postgres`, então a MENSAGEM de recusa some (K1). O VALOR continua
--      protegido por `derivar_valores_financeiros`, que não isenta ninguém e
--      sobrescreve ou preserva o payload (K2/K4). Perdeu-se o aviso, não a
--      invariante.
--   3. MOVER FOLHA VAZIA. `bloquear_fontes_folha` isenta `postgres` (K12).
--      Inalcançável hoje: esta RPC não faz `UPDATE` em `timesheets`. **Nunca
--      passar a fazer sem antes reavaliar isto.**
--   4. EQUIPE. Não existe invariante de banco ligando `timesheet_entries` a
--      `operation_team` — para papel nenhum, nem hoje para o admin (K14). A
--      exigência de equipe ativa é regra DESTA RPC.
--   5. FOLHA FECHADA. Também não é invariante de banco (K16). A recusa é regra
--      DESTA RPC.
--
-- Por isso a RPC de escrita nunca escreve as colunas que essas guardas
-- protegem, e recusa explicitamente apontamento já faturado antes de tentar:
-- a proteção precisa estar no contrato, não na sorte de um trigger disparar.
--
-- A correção estrutural — dar às cinco funções um OWNER DEDICADO, que não seja
-- `postgres` e portanto não seja isento — está desenhada e provada em banco
-- local, e está registrada em PROGRESS.md, seção 7.2, como PR B1.1. Não entra
-- aqui: mexe em privilégio de papel do Supabase e merece escopo próprio.


-- ---------------------------------------------------------------------------
-- 1. user_operation_access — a fonte da atribuição
--
-- Chave primária composta `(user_id, operation_id)`: a atribuição É o par, não
-- tem identidade própria, e a PK já impede duplicata sem índice extra.
--
-- Índice adicional por `operation_id` porque a PK é um btree que começa por
-- `user_id` e não serve para a busca inversa — "quem está atribuído a esta
-- operação", que é a tela administrativa do PR B2 e a varredura do
-- `ON DELETE CASCADE` de `operations`.
--
-- `ON DELETE CASCADE` nos dois lados: conta apagada ou operação apagada não
-- deixam atribuição órfã. Isso importa mais do que parece — `user_roles` NÃO
-- tem FK para `auth.users` e deixa papel órfão, e foi justamente esse órfão
-- que obrigou a 012 a tratar "uid que não existe mais" como bloqueio. Aqui a
-- FK existe, e a atribuição de uma conta apagada some junto com ela.
--
-- `created_by` com `ON DELETE SET NULL`: quem concedeu é auditoria, e apagar
-- o admin que concedeu não pode apagar a concessão.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_operation_access (
  user_id      uuid NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL REFERENCES auth.users(id)          ON DELETE SET NULL,
  PRIMARY KEY (user_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_user_operation_access_operation
  ON public.user_operation_access (operation_id);

COMMENT ON TABLE public.user_operation_access IS
  'Atribuicao usuario -> operacao. Fonte interna de autorizacao das RPCs da superficie operacional AAL1. Somente admin em aal2 le ou escreve; o operador nunca consulta esta tabela diretamente.';

COMMENT ON INDEX public.idx_user_operation_access_operation IS
  'Busca inversa por operacao, que a PK (user_id, operation_id) nao atende.';

ALTER TABLE public.user_operation_access ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 2. Segurança da tabela
--
-- DUAS policies com o MESMO predicado, de propósito, e não por descuido:
--
--   a PERMISSIVE é a que CONCEDE — sem ela a tabela é negada a todos, porque
--   RLS sem policy nenhuma nega por padrão;
--
--   a RESTRICTIVE é a que GARANTE — ela se soma com AND a qualquer policy
--   permissiva que venha a existir aqui no futuro. Sem ela, bastaria alguém
--   acrescentar uma permissiva bem-intencionada ("o operador pode ver as
--   próprias atribuições") para abrir a tabela em AAL1. Com ela, essa
--   permissiva futura continuaria barrada até que alguém REMOVA esta linha,
--   deliberadamente e por escrito.
--
-- O NOME NÃO É `user_operation_access_exige_aal2`, e isso é intencional. O
-- sufixo `_exige_aal2` identifica a família de 11 policies da migration 009,
-- cuja CONTAGEM é asseverada como regressão em
-- `supabase/tests/008_estado_mfa.sql` (caso J4) e em
-- `009_superficie_operacional.sql`. Entrar nessa família mudaria o número 11
-- e transformaria um guarda-corpo de regressão em ruído. São regras diferentes
-- com propósitos diferentes: aquelas protegem dado de negócio, esta mantém uma
-- tabela de autorização fora do alcance de quem ela autoriza.
--
-- `(SELECT auth.jwt() ...)` em subquery pelo mesmo motivo da 009: avaliação
-- uma vez por comando, não uma vez por linha. Fail-closed sem COALESCE —
-- claim ausente devolve NULL, e NULL não é permissão.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS user_operation_access_admin ON public.user_operation_access;
CREATE POLICY user_operation_access_admin ON public.user_operation_access
  FOR ALL TO authenticated
  USING (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS user_operation_access_somente_admin_aal2 ON public.user_operation_access;
CREATE POLICY user_operation_access_somente_admin_aal2 ON public.user_operation_access
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    (SELECT auth.jwt() ->> 'aal') = 'aal2'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

COMMENT ON POLICY user_operation_access_admin ON public.user_operation_access IS
  'Concede leitura e escrita da atribuicao apenas a admin em aal2.';
COMMENT ON POLICY user_operation_access_somente_admin_aal2 ON public.user_operation_access IS
  'RESTRICTIVE: soma com AND a qualquer policy permissiva futura desta tabela, para que nenhuma delas possa abri-la a AAL1 ou a outro papel.';

-- Grants mínimos. `authenticated` precisa dos quatro verbos porque a tela
-- administrativa do PR B2 fala pelo PostgREST e a RLS acima é quem decide; sem
-- grant, admin receberia erro de privilégio em vez da decisão da policy.
-- TRUNCATE, REFERENCES e TRIGGER ficam de fora.
--
-- `service_role` NÃO recebe nada: a aplicação não a usa, ela ignora RLS por
-- definição (`bypassrls`), e um grant aqui daria à chave da API o poder de
-- atribuir operações a si mesma. `anon` tampouco. O REVOKE explícito é
-- necessário porque o Supabase mantém DEFAULT PRIVILEGES que concedem ALL aos
-- três papéis em toda tabela nova de `public` — foi esse mesmo mecanismo que
-- obrigou a 011 a revogar TRUNCATE de `service_role`.
REVOKE ALL ON TABLE public.user_operation_access FROM PUBLIC;
REVOKE ALL ON TABLE public.user_operation_access FROM anon;
REVOKE ALL ON TABLE public.user_operation_access FROM authenticated;
REVOKE ALL ON TABLE public.user_operation_access FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_operation_access TO authenticated;


-- ---------------------------------------------------------------------------
-- 3. Helpers de autorização
--
-- `operador_elegivel_aal1()` responde pela SESSÃO; `operador_autorizado(op)`
-- responde pela sessão NAQUELA operação. Separados porque a listagem de
-- operações precisa da primeira metade sem ter ainda uma operação em mãos —
-- e não porque a segunda seja opcional.
--
-- NENHUM DOS DOIS ACEITA `user_id`. A decisão é sempre sobre `auth.uid()`.
-- Um parâmetro de usuário transformaria um helper de autorização em
-- enumerador: qualquer chamador perguntaria pelo acesso alheio.
--
-- AS SEIS CONDIÇÕES, e por que cada uma existe:
--
--   1. `auth.uid()` não nulo   — sem sessão não há a quem autorizar;
--   2. o `uid` ainda existe em `auth.users` — o PostgREST valida a ASSINATURA
--      do JWT e não consulta o GoTrue a cada requisição, então um token de
--      conta apagada segue aceito até expirar (~1 h). `user_roles` não tem FK
--      para `auth.users` e o papel sobrevive à conta. A 012 já fecha esse caso
--      por dentro; a verificação é repetida aqui de propósito, para que esta
--      autorização não dependa de um detalhe interno de outra função;
--   3. papel `operacional`  — esta superfície é do operador;
--   4. NÃO papel `admin`    — `user_roles` não impede acumular os dois papéis.
--      Um admin não opera em AAL1 (PROGRESS.md, seção 6.1), e sem esta linha
--      um admin que também fosse `operacional` teria em AAL1 uma porta para
--      dados que a policy de AAL2 lhe nega;
--   5. `aal = aal1`         — esta é a superfície de AAL1 e só dela. Uma sessão
--      aal2 tem o painel inteiro e não precisa passar por aqui; aceitar aal2
--      criaria um segundo caminho para os mesmos dados, com regras diferentes;
--   6. `mfa_bloqueia_excecao_aal1() = false` — é a razão de o PR A existir.
--      Uma conta com fator verificado recebe sessão AAL1 logo após a senha,
--      ANTES do TOTP: papel + `aal` sozinhos não distinguem quem nunca ativou
--      MFA de quem ativou e ainda não desafiou. Sem esta linha, quem optou pelo
--      segundo fator o contornaria por aqui.
--
-- SEM TRATAMENTO DE EXCEÇÃO, como na 012: erro de leitura sobe e a chamada
-- termina negando. Capturar e devolver `false` é o que transforma falha de
-- infraestrutura em concessão silenciosa — e aqui `false` já é o lado seguro.
--
-- NULL NÃO É `false`, E ISSO QUASE ABRIU A SUPERFÍCIE — medido, não suposto.
--
-- Na primeira versão os dois helpers eram uma cadeia de `AND` sem `coalesce`, e
-- as RPCs decidiam com `IF NOT helper() THEN RAISE`. Com um JWT SEM o claim
-- `aal`, `auth.jwt() ->> 'aal'` é NULL, a comparação com `'aal1'` é NULL, e a
-- cadeia inteira devolve NULL quando todo o resto é verdadeiro. Aí
-- `NOT NULL` é NULL, `IF NULL` não dispara — e a função SEGUIA. O caso A9 de
-- `supabase/tests/009_superficie_operacional.sql` pegou isso: um operacional
-- atribuído, sem MFA, com token sem `aal` LISTOU os turnos.
--
-- A correção é dupla, de propósito: `coalesce(..., false)` fecha o valor de
-- retorno, e `IS NOT TRUE` nas cinco RPCs fecha a decisão mesmo que alguém um
-- dia reintroduza um NULL aqui dentro. `IF NOT x` e `IF x IS NOT TRUE` são
-- idênticos para `true`/`false` e diferentes exatamente no caso que importa.
--
-- SEM GRANT PARA NINGUÉM. Os dois helpers são peça interna: quem os chama são
-- as RPCs abaixo, que pertencem a `postgres` e por isso os executam como donas.
-- `authenticated` não precisa chamá-los e não pode.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operador_elegivel_aal1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
       auth.uid() IS NOT NULL
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid())
   AND public.has_role(auth.uid(), 'operacional'::public.app_role)
   AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
   AND (auth.jwt() ->> 'aal') = 'aal1'
   AND public.mfa_bloqueia_excecao_aal1() = false,
     false);
$$;

COMMENT ON FUNCTION public.operador_elegivel_aal1() IS
  'Responde se a SESSAO atual e um operador elegivel a superficie AAL1: uid presente, conta existente, papel operacional, nao admin, claim aal=aal1 e estado de MFA que nao bloqueia. Nao recebe parametro e nao decide operacao. Interna: sem EXECUTE para anon, authenticated ou service_role.';

CREATE OR REPLACE FUNCTION public.operador_autorizado(p_operation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
       p_operation_id IS NOT NULL
   AND public.operador_elegivel_aal1()
   AND EXISTS (
     SELECT 1
       FROM public.user_operation_access a
      WHERE a.user_id      = auth.uid()
        AND a.operation_id = p_operation_id
   ),
     false);
$$;

COMMENT ON FUNCTION public.operador_autorizado(uuid) IS
  'Responde se a sessao atual e operador elegivel AAL1 E tem a operacao informada atribuida em user_operation_access. Nao aceita user_id: a decisao e sempre sobre auth.uid(). Interna: sem EXECUTE para anon, authenticated ou service_role.';

REVOKE ALL ON FUNCTION public.operador_elegivel_aal1()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operador_elegivel_aal1()      FROM anon;
REVOKE ALL ON FUNCTION public.operador_elegivel_aal1()      FROM authenticated;
REVOKE ALL ON FUNCTION public.operador_elegivel_aal1()      FROM service_role;

REVOKE ALL ON FUNCTION public.operador_autorizado(uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operador_autorizado(uuid)     FROM anon;
REVOKE ALL ON FUNCTION public.operador_autorizado(uuid)     FROM authenticated;
REVOKE ALL ON FUNCTION public.operador_autorizado(uuid)     FROM service_role;


-- ---------------------------------------------------------------------------
-- 4. RPCs de leitura
--
-- Contrato fechado: cada `RETURNS TABLE` é a lista completa do que o operador
-- recebe. Não há `SELECT *` em lugar nenhum, e não há coluna financeira em
-- nenhuma das quatro — nem `client_id`, nem `contract_id`, nem `agreed_amount`,
-- nem `daily_rate`, `shift_hours`, `ot_factor`, `ot_tolerance_min`,
-- `daily_cost`, `billed_amount`, `cost_amount`, snapshot ou `invoice_id`.
--
-- `cliente_nome` é a única informação de cliente que atravessa, e existe por um
-- motivo operacional: distinguir visualmente duas operações parecidas. Documento,
-- telefone, e-mail e o próprio `client_id` ficam de fora — o `client_id` inclusive
-- porque ele seria a chave para tentar qualquer outra leitura.
--
-- A NEGATIVA É SEMPRE 42501 E SEMPRE ANTES DA LEITURA. Devolver zero linhas
-- para quem não é autorizado seria ambíguo com "autorizado e sem dados", e a
-- diferença importa para quem for depurar isto em produção.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.listar_operacoes_do_operador()
RETURNS TABLE (
  id             uuid,
  name           text,
  site           text,
  type           public.operation_type,
  operation_date date,
  status         public.record_status,
  cliente_nome   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.operador_elegivel_aal1() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sessão não autorizada à superfície operacional.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT o.id, o.name, o.site, o.type, o.operation_date, o.status, c.name
      FROM public.user_operation_access a
      JOIN public.operations o ON o.id = a.operation_id
      JOIN public.clients    c ON c.id = o.client_id
     WHERE a.user_id = auth.uid()
     ORDER BY o.operation_date DESC NULLS LAST, o.name;
END;
$$;

COMMENT ON FUNCTION public.listar_operacoes_do_operador() IS
  'Operacoes atribuidas a sessao atual, com sete colunas fixas. Devolve o NOME do cliente e nao o client_id; nenhum valor financeiro atravessa. Exige operador elegivel AAL1.';


CREATE OR REPLACE FUNCTION public.listar_turnos_do_operador(p_operation_id uuid)
RETURNS TABLE (
  id               uuid,
  name             text,
  start_time       time,
  end_time         time,
  break_minutes    integer,
  crosses_midnight boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.operador_autorizado(p_operation_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Operação não autorizada para esta sessão.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT s.id, s.name, s.start_time, s.end_time, s.break_minutes, s.crosses_midnight
      FROM public.shifts s
     WHERE s.operation_id = p_operation_id
     ORDER BY s.start_time, s.name;
END;
$$;

COMMENT ON FUNCTION public.listar_turnos_do_operador(uuid) IS
  'Turnos da operacao atribuida, com seis colunas de jornada. Nao devolve operation_id, status nem qualquer taxa. Exige operador_autorizado na operacao.';


-- `active` VEM na resposta, e a lista NÃO é filtrada por ele. A tela precisa
-- distinguir "não está mais na equipe" de "nunca esteve" — e a escrita, essa
-- sim, exige `active`. Filtrar aqui esconderia do operador por que um nome
-- sumiu da folha do dia anterior.
--
-- O par turno/operação é validado mesmo já tendo passado por
-- `operador_autorizado`: a atribuição é por OPERAÇÃO, e sem esta verificação
-- um `p_shift_id` de outra operação devolveria a equipe daquela outra.
CREATE OR REPLACE FUNCTION public.listar_equipe_do_operador(
  p_operation_id uuid,
  p_shift_id     uuid
)
RETURNS TABLE (
  employee_id   uuid,
  employee_name text,
  employee_role text,
  active        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.operador_autorizado(p_operation_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Operação não autorizada para esta sessão.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shifts s
     WHERE s.id = p_shift_id AND s.operation_id = p_operation_id
  ) THEN
    RAISE EXCEPTION 'Turno informado não pertence à operação.'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
    SELECT e.id, e.name, e.role, ot.active
      FROM public.operation_team ot
      JOIN public.employees e ON e.id = ot.employee_id
     WHERE ot.operation_id = p_operation_id
       AND ot.shift_id     = p_shift_id
     ORDER BY e.name;
END;
$$;

COMMENT ON FUNCTION public.listar_equipe_do_operador(uuid, uuid) IS
  'Equipe alocada ao par operacao/turno, com quatro colunas. Nao devolve daily_cost, doc nem phone do colaborador. Exige operador_autorizado e que o turno pertenca a operacao.';


-- LEFT JOIN nas linhas, de propósito: a folha existe antes de ter apontamento,
-- e a tela precisa saber que ela existe e em que estado está. Com folha vazia
-- a resposta é uma linha com os campos de folha preenchidos e os de
-- apontamento nulos.
--
-- `faturado` é BOOLEAN DERIVADO — `invoice_id IS NOT NULL`. O id da fatura não
-- atravessa; o que o operador precisa saber é que aquela linha congelou.
CREATE OR REPLACE FUNCTION public.listar_apontamentos_do_operador(
  p_operation_id uuid,
  p_shift_id     uuid,
  p_work_date    date
)
RETURNS TABLE (
  timesheet_id  uuid,
  shift_id      uuid,
  work_date     date,
  folha_status  public.timesheet_status,
  employee_id   uuid,
  status        public.attendance_status,
  check_in      time,
  check_out     time,
  break_minutes integer,
  notes         text,
  faturado      boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.operador_autorizado(p_operation_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Operação não autorizada para esta sessão.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shifts s
     WHERE s.id = p_shift_id AND s.operation_id = p_operation_id
  ) THEN
    RAISE EXCEPTION 'Turno informado não pertence à operação.'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
    SELECT t.id, t.shift_id, t.work_date, t.status,
           te.employee_id, te.status, te.check_in, te.check_out,
           te.break_minutes, te.notes, (te.invoice_id IS NOT NULL)
      FROM public.timesheets t
      LEFT JOIN public.timesheet_entries te ON te.timesheet_id = t.id
     WHERE t.operation_id = p_operation_id
       AND t.shift_id     = p_shift_id
       AND t.work_date    = p_work_date
     ORDER BY te.employee_id;
END;
$$;

COMMENT ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date) IS
  'Folha e linhas do par operacao/turno numa data, so com dados operacionais. faturado e boolean derivado de invoice_id; nem o id da fatura nem valor ou snapshot atravessam. Exige operador_autorizado e que o turno pertenca a operacao.';


-- ---------------------------------------------------------------------------
-- 5. RPC de escrita
--
-- Contrato fechado também na ENTRADA: seis campos por linha e nada mais. Uma
-- chave inesperada no JSON — `billed_amount`, `invoice_id`, `operation_id`,
-- `timesheet_id`, ou um erro de digitação — RECUSA a chamada inteira, em vez de
-- ser ignorada em silêncio. Ignorar seria pior que aceitar: o cliente acharia
-- que gravou o que mandou.
--
-- A recusa acontece ANTES de qualquer escrita, e a função é uma transação
-- única: ou todas as linhas entram, ou nenhuma entra.
--
-- DELETE NÃO EXISTE nesta superfície, por decisão de escopo. Linha ausente do
-- payload é linha NÃO TOCADA — nunca apagada. Apagar apontamento continua
-- sendo caminho administrativo, em AAL2.
--
-- O QUE NÃO SE DERIVA AQUI: nada. A função grava os seis campos operacionais;
-- `derivar_valores_financeiros()` (migration 010) calcula o resto no mesmo
-- comando, com a configuração de contrato, operação, turno e colaborador.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.salvar_apontamento_operacional(
  p_operation_id uuid,
  p_shift_id     uuid,
  p_work_date    date,
  p_linhas       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _campos_permitidos constant text[] :=
    ARRAY['employee_id', 'status', 'check_in', 'check_out', 'break_minutes', 'notes'];
  _folha_id     uuid;
  _folha_status public.timesheet_status;
  _linha        jsonb;
  _campo        text;
  _employee_id  uuid;
  _status       text;
  _vistos       uuid[] := '{}'::uuid[];
  _faturado     boolean;
BEGIN
  -- 1. Autorização. Antes de tudo, inclusive da validação de parâmetro: quem
  --    não é operador daquela operação não descobre nem se o turno existe.
  IF public.operador_autorizado(p_operation_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Operação não autorizada para esta sessão.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Parâmetros. `p_shift_id` é obrigatório aqui, embora `timesheets.shift_id`
  --    seja anulável: folha sem turno é caso administrativo, e a derivação
  --    financeira sem turno cai num padrão de 8 h que o operador não escolheu.
  IF p_shift_id IS NULL OR p_work_date IS NULL THEN
    RAISE EXCEPTION 'Turno e data são obrigatórios.'
      USING ERRCODE = '22023';
  END IF;

  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'As linhas do apontamento devem vir num array JSON.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha para gravar.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. O turno pertence à operação. `FOR SHARE` porque a jornada do turno
  --    entra no cálculo da hora extra: ela não pode mudar entre esta
  --    verificação e o commit.
  PERFORM 1
     FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.operation_id = p_operation_id
      FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno informado não pertence à operação.'
      USING ERRCODE = '23514';
  END IF;

  -- 4. Folha: reaproveita a existente ou cria. O INSERT direto com captura de
  --    `unique_violation` evita tocar numa folha existente — um
  --    `ON CONFLICT DO UPDATE` dispararia os triggers de UPDATE de
  --    `timesheets` e reescreveria `updated_at` de folha já faturada sem
  --    necessidade. Sob READ COMMITTED, quando a violação acontece a
  --    transação concorrente já commitou, então o SELECT seguinte a encontra.
  SELECT t.id, t.status INTO _folha_id, _folha_status
    FROM public.timesheets t
   WHERE t.operation_id = p_operation_id
     AND t.shift_id     = p_shift_id
     AND t.work_date    = p_work_date;

  IF _folha_id IS NULL THEN
    BEGIN
      INSERT INTO public.timesheets (operation_id, shift_id, work_date, created_by)
      VALUES (p_operation_id, p_shift_id, p_work_date, auth.uid())
      RETURNING id, status INTO _folha_id, _folha_status;
    EXCEPTION WHEN unique_violation THEN
      SELECT t.id, t.status INTO _folha_id, _folha_status
        FROM public.timesheets t
       WHERE t.operation_id = p_operation_id
         AND t.shift_id     = p_shift_id
         AND t.work_date    = p_work_date;
    END;
  END IF;

  -- Folha fechada é decisão administrativa, tomada em AAL2 na tela de
  -- apontamentos. O operador não a reabre e não escreve por cima dela.
  IF _folha_status = 'closed'::public.timesheet_status THEN
    RAISE EXCEPTION 'Folha fechada não recebe apontamento.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. Linha a linha. Todas as validações antes de qualquer escrita de linha
  --    seriam mais elegantes em dois laços; não são mais seguras, porque a
  --    função inteira é uma transação e a primeira recusa desfaz o que veio
  --    antes.
  FOR _linha IN SELECT value FROM jsonb_array_elements(p_linhas)
  LOOP
    IF jsonb_typeof(_linha) <> 'object' THEN
      RAISE EXCEPTION 'Cada linha do apontamento deve ser um objeto JSON.'
        USING ERRCODE = '22023';
    END IF;

    -- Chave inesperada recusa a chamada. É esta verificação — e não uma lista
    -- de colunas proibidas — que impede valor financeiro, `invoice_id`,
    -- `operation_id` ou `timesheet_id` de entrarem pelo payload: o que não
    -- está explicitamente permitido está recusado.
    FOR _campo IN SELECT jsonb_object_keys(_linha)
    LOOP
      IF NOT (_campo = ANY (_campos_permitidos)) THEN
        RAISE EXCEPTION 'Campo não permitido no apontamento: %.', _campo
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    IF NOT (_linha ? 'employee_id') OR NOT (_linha ? 'status') THEN
      RAISE EXCEPTION 'Cada linha exige employee_id e status.'
        USING ERRCODE = '22023';
    END IF;

    _employee_id := (_linha ->> 'employee_id')::uuid;
    _status      := _linha ->> 'status';

    IF _status IS NULL OR _status NOT IN ('present', 'absent', 'replacement') THEN
      RAISE EXCEPTION 'Status de apontamento inválido: %.', coalesce(_status, 'nulo')
        USING ERRCODE = '22023';
    END IF;

    -- Duas linhas para o mesmo colaborador violariam o UNIQUE
    -- (timesheet_id, employee_id) no meio da gravação. Recusar aqui dá a
    -- mensagem certa em vez de um 23505 cru.
    IF _employee_id = ANY (_vistos) THEN
      RAISE EXCEPTION 'Colaborador repetido no mesmo apontamento: %.', _employee_id
        USING ERRCODE = '22023';
    END IF;
    _vistos := _vistos || _employee_id;

    -- O colaborador precisa estar na equipe ATIVA daquele par operação/turno.
    -- É o mesmo recorte que a tela do admin usa hoje
    -- (`painel-apontamentos.tsx`): alocação sem turno não aparece em todos os
    -- turnos da operação.
    IF NOT EXISTS (
      SELECT 1
        FROM public.operation_team ot
       WHERE ot.operation_id = p_operation_id
         AND ot.shift_id     = p_shift_id
         AND ot.employee_id  = _employee_id
         AND ot.active
    ) THEN
      RAISE EXCEPTION 'Colaborador % não está na equipe ativa deste turno.', _employee_id
        USING ERRCODE = '23514';
    END IF;

    -- Apontamento já faturado é imutável (migration 011). A recusa é explícita
    -- aqui porque, dentro desta função, `current_user` é `postgres` e as
    -- guardas que isentam `postgres` não disparariam. `bloquear_edicao_faturada`
    -- não isenta ninguém e continua por baixo — mas a proteção precisa estar
    -- no contrato, e a mensagem precisa dizer o que aconteceu.
    SELECT (te.invoice_id IS NOT NULL) INTO _faturado
      FROM public.timesheet_entries te
     WHERE te.timesheet_id = _folha_id
       AND te.employee_id  = _employee_id;

    IF coalesce(_faturado, false) THEN
      RAISE EXCEPTION 'Apontamento já faturado não pode ser alterado.'
        USING ERRCODE = '42501';
    END IF;

    -- Somente os seis campos. Nenhuma coluna financeira, nenhum `invoice_id`,
    -- nenhuma chave desnormalizada: `operation_id` e `work_date` da linha são
    -- escritos por `sincronizar_chave_da_diaria()` a partir da folha, e os
    -- valores por `derivar_valores_financeiros()`.
    INSERT INTO public.timesheet_entries (
      timesheet_id, employee_id, status, check_in, check_out, break_minutes, notes
    )
    VALUES (
      _folha_id,
      _employee_id,
      _status::public.attendance_status,
      (_linha ->> 'check_in')::time,
      (_linha ->> 'check_out')::time,
      coalesce((_linha ->> 'break_minutes')::integer, 0),
      _linha ->> 'notes'
    )
    ON CONFLICT (timesheet_id, employee_id) DO UPDATE
    SET status        = EXCLUDED.status,
        check_in      = EXCLUDED.check_in,
        check_out     = EXCLUDED.check_out,
        break_minutes = EXCLUDED.break_minutes,
        notes         = EXCLUDED.notes;
  END LOOP;

  RETURN _folha_id;
END;
$$;

COMMENT ON FUNCTION public.salvar_apontamento_operacional(uuid, uuid, date, jsonb) IS
  'Grava o apontamento operacional de um par operacao/turno numa data. Aceita por linha somente employee_id, status, check_in, check_out, break_minutes e notes; qualquer outra chave recusa a chamada inteira com 22023. Nao escreve coluna financeira nem invoice_id: os valores continuam sendo derivados pelos triggers da migration 010. Nao apaga linha. Exige operador_autorizado na operacao.';


-- ---------------------------------------------------------------------------
-- 6. Quem pode executar as RPCs
--
-- `authenticated` e mais ninguém. `anon` e `PUBLIC` revogados explicitamente —
-- o Postgres concede EXECUTE a PUBLIC em toda função nova, e o Supabase ainda
-- acrescenta os papéis da API por DEFAULT PRIVILEGES; revogar só de `anon`
-- deixaria o privilégio chegar por PUBLIC, que foi o defeito registrado como
-- SEC-011.
--
-- `service_role` fica de fora das cinco: ela ignora RLS por definição e não
-- tem uso nesta superfície. A aplicação não a usa.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.listar_operacoes_do_operador()                        FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_turnos_do_operador(uuid)                       FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_equipe_do_operador(uuid, uuid)                 FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.salvar_apontamento_operacional(uuid, uuid, date, jsonb) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.listar_operacoes_do_operador()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_turnos_do_operador(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_equipe_do_operador(uuid, uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_apontamento_operacional(uuid, uuid, date, jsonb) TO authenticated;
