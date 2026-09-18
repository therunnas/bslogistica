-- Fundação da superfície operacional AAL1 — PR B1.
--
-- O QUE ESTE PR ENTREGA, E O QUE ELE DELIBERADAMENTE NÃO ENTREGA
--
-- Entrega a FUNDAÇÃO de autorização da política aprovada em PROGRESS.md,
-- seções 6 e 7: um papel de execução dedicado, a tabela de atribuição usuário →
-- operação, os helpers que decidem se a sessão atual é um operador autorizado
-- naquela operação, e cinco RPCs de contrato fechado — quatro de leitura e uma
-- de escrita.
--
-- NÃO libera AAL1 nas tabelas. As 11 policies `*_exige_aal2` da migration 009
-- continuam RESTRICTIVE, globais e intactas, e nenhuma linha desta migration as
-- altera. Um `operacional` em AAL1 continua sem enxergar `operations`,
-- `shifts`, `employees`, `timesheets` ou `timesheet_entries` pelo PostgREST: a
-- única porta é a RPC estreita, que devolve colunas escolhidas uma a uma.
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
-- coordenado. A decisão de produto deste PR é que o operador não recebe NENHUM
-- valor financeiro, nem `client_id`, nem documento ou telefone de ninguém. Um
-- contrato fechado de sete colunas cumpre isso por construção: o que não está
-- no `RETURNS TABLE` não existe para quem chama.
--
-- A AUTORIDADE FINANCEIRA CONTINUA SENDO A 010
--
-- A RPC de escrita grava exclusivamente `status`, `check_in`, `check_out`,
-- `break_minutes` e `notes`. Nenhuma coluna financeira é mencionada no INSERT
-- nem no UPDATE, então `derivar_valores_financeiros()` continua sendo quem
-- calcula `billed_amount`, `cost_amount` e os snapshots — exatamente como no
-- caminho do admin. E as guardas da 011 continuam valendo: linha faturada
-- recusa UPDATE, e o vínculo com fatura não nasce aqui.


-- ---------------------------------------------------------------------------
-- 0. O papel de execução — `bslog_rpc_operacional`
--
-- POR QUE ELE EXISTE, E POR QUE ISTO NÃO É DETALHE
--
-- `SECURITY DEFINER` roda com os privilégios do DONO da função. Se o dono fosse
-- `postgres`, `current_user` dentro das RPCs seria `postgres` — e sete guardas
-- das migrations 010 e 011 perguntam exatamente isso:
--
--   bloquear_edicao_financeira            isenta postgres e service_role
--   bloquear_vinculo_fora_do_faturamento  EXIGE postgres para criar vínculo
--   bloquear_fontes_operacao/turno/folha  isentam postgres e service_role
--   protect_timesheet_invoice_link        isentava os dois — aposentado na 2b
--
-- Ou seja: uma superfície operada pelo papel MENOS privilegiado do sistema
-- escreveria com as isenções do papel MAIS privilegiado. Foi medido antes de
-- corrigir — o bloco K de `supabase/tests/009_superficie_operacional.sql`
-- registra que, como `postgres`, criar vínculo de fatura FUNCIONAVA.
--
-- Com dono próprio, `current_user` dentro das RPCs é `bslog_rpc_operacional`,
-- que não está em nenhuma dessas isenções: as guardas voltam a valer sobre a
-- escrita do operador, sem duplicar uma linha de regra financeira dentro da
-- RPC. A defesa continua centralizada no banco, que é onde ela pertence.
--
-- ATRIBUTOS, E POR QUE CADA UM
--
-- `NOLOGIN`   — não é papel de conexão; ninguém autentica como ele.
-- `NOINHERIT` — quem receber membership não ganha os privilégios por tabela sem
--               um `SET ROLE` explícito.
-- `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE` — explícitos, ainda que sejam o
--               padrão: este arquivo é a documentação do papel.
-- `BYPASSRLS` — necessário, e é o único atributo forte aqui. Ver abaixo.
-- Sem membership em `anon`, `authenticated` ou `service_role`, e nenhum desses
-- recebe membership nele. Ele não é papel de aplicação e não aparece na API.
--
-- POR QUE `BYPASSRLS` É ESTRITAMENTE NECESSÁRIO
--
-- As RPCs leem e escrevem tabelas com RLS ativa. Policy se aplica ao papel
-- corrente: as existentes são `TO authenticated`, e este papel não é membro de
-- `authenticated` — de propósito. Sem policy aplicável, a RLS NEGA por padrão.
-- Restariam duas saídas:
--
--   (a) `BYPASSRLS` no papel — um atributo, num papel sem login, sem membership
--       e cujos privilégios de tabela são os mínimos listados na seção 7;
--   (b) escrever policies novas `TO bslog_rpc_operacional` em NOVE tabelas de
--       negócio — ampliando justamente a superfície de policy que este projeto
--       protege, e criando nove lugares onde um erro futuro abre acesso.
--
-- (a) é menor e mais auditável, e não altera nenhuma policy existente.
-- `BYPASSRLS` não concede privilégio de tabela nenhum: o papel só alcança o que
-- a seção 7 conceder explicitamente, coluna a coluna onde faz diferença.
--
-- PRÉ-REQUISITO DE AMBIENTE — UM SÓ, E JÁ CONFIRMADO EM PRODUCTION
--
-- `postgres` precisa conseguir criar papel com `BYPASSRLS` sem ser superusuário.
-- Confirmado no SQL Editor de Production, em transação descartável:
--
--   BEGIN;
--     CREATE ROLE bslog_rpc_operacional NOLOGIN NOINHERIT BYPASSRLS;
--     SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
--      WHERE rolname = 'bslog_rpc_operacional';
--   ROLLBACK;
--
-- O QUE PRODUCTION RECUSOU, E O QUE ISSO MUDOU NO DESENHO
--
-- A primeira versão desta migration também concedia `USAGE` no schema `auth` ao
-- papel. Em Production isso NÃO funciona: mesmo depois de
-- `GRANT USAGE ON SCHEMA auth TO bslog_rpc_operacional`,
-- `has_schema_privilege(..., 'auth', 'USAGE')` continua `false`. O schema `auth`
-- pertence a `supabase_auth_admin`, e `postgres` não tem como repassar esse
-- privilégio ali.
--
-- Isso não é obstáculo: é um limite que melhorou o desenho. Esta superfície não
-- tem por que alcançar a base de contas. Nenhuma das cinco RPCs referencia
-- `auth.*` — identidade e autorização vêm dos helpers da seção 3, que são de
-- `postgres`, só leem e devolvem um booleano ou um uuid. O único acoplamento
-- que restava era um trigger legado, aposentado na seção 2b.
-- Se a criação do papel falhar, PARAR: esta migration não se aplica como está,
-- e improvisar fallback é como se perde uma proteção sem perceber.
-- ---------------------------------------------------------------------------

DO $papel$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bslog_rpc_operacional') THEN
    CREATE ROLE bslog_rpc_operacional
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
END
$papel$;

COMMENT ON ROLE bslog_rpc_operacional IS
  'Papel de execucao das RPCs da superficie operacional AAL1 (migration 013). NOLOGIN, sem membership em anon/authenticated/service_role, privilegios minimos e por coluna. Existe para que essas funcoes NAO rodem como postgres e portanto NAO caiam nas isencoes de current_user das guardas de 010 e 011.';

-- `postgres` precisa ser membro para poder transferir a posse das funções e
-- para que um `CREATE OR REPLACE` futuro funcione. Membership não transporta
-- atributo de papel: `postgres` não ganha nada com isso — ele já tem mais.
GRANT bslog_rpc_operacional TO postgres;


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
-- tem FK para `auth.users` e deixa papel órfão, e foi justamente esse órfão que
-- obrigou a 012 a tratar "uid que não existe mais" como bloqueio. Aqui a FK
-- existe, e a atribuição de uma conta apagada some junto com ela.
--
-- `created_by` com `ON DELETE SET NULL`: quem concedeu é auditoria, e apagar o
-- admin que concedeu não pode apagar a concessão.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_operation_access (
  user_id      uuid NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL REFERENCES auth.users(id)            ON DELETE SET NULL,
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
-- `009_superficie_operacional.sql`. Entrar nessa família mudaria o número 11 e
-- transformaria um guarda-corpo de regressão em ruído. São regras diferentes
-- com propósitos diferentes: aquelas protegem dado de negócio, esta mantém uma
-- tabela de autorização fora do alcance de quem ela autoriza.
--
-- `(SELECT auth.jwt() ...)` em subquery pelo mesmo motivo da 009: avaliação uma
-- vez por comando, não uma vez por linha. Fail-closed sem COALESCE — claim
-- ausente devolve NULL, e NULL não é permissão.
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
-- 2b. Aposentadoria de `protect_timesheet_invoice_link` — o trigger legado
--
-- POR QUE ELE SAI AQUI, E NÃO NUM PR SEPARADO
--
-- Ele é `SECURITY INVOKER`, chama `auth.uid()` e `public.has_role()`, e dispara
-- em TODO INSERT de `timesheet_entries` — o `OF invoice_id` restringe apenas o
-- UPDATE. Com ele no caminho, qualquer papel que escreva apontamento precisa de
-- `USAGE` no schema `auth` e de leitura de `user_roles`. Production não concede
-- o primeiro. Ou seja: ou este trigger sai, ou a superfície operacional volta a
-- rodar como `postgres` — que é exatamente o que este PR existe para evitar.
--
-- ELE NÃO PROTEGE MAIS NADA, E ISSO É DEMONSTRÁVEL, NÃO OPINIÃO
--
-- Mesma tabela, mesmo evento (`BEFORE INSERT OR UPDATE OF invoice_id`), e o
-- conjunto de quem ele PERMITE é sempre um superconjunto do que a 011 permite:
--
--   transição            legado permite                 011 permite
--   INSERT com vínculo   postgres, service_role, admin  só postgres
--   UPDATE NULL -> X     postgres, service_role, admin  só postgres
--   UPDATE X -> Y        postgres, service_role, admin  ninguém
--   UPDATE X -> NULL     postgres, service_role, admin  ninguém
--
-- As duas primeiras linhas são `bloquear_vinculo_fora_do_faturamento`; as duas
-- últimas, `bloquear_desvinculo_faturado` somada a `bloquear_edicao_faturada`,
-- que congela a linha faturada inteira sem exceção de papel.
--
-- Como o legado permite tudo o que a 011 permite e mais, ele nunca recusa algo
-- que a 011 aceite: o conjunto de recusas dele está contido no dela. E a ordem
-- alfabética dos triggers põe `bloqueia_vinculo_direto` ANTES de
-- `protect_invoice_link`, então na prática ele nem chega a ser o recusador. É
-- código morto que cobra um privilégio caro.
--
-- REMOVER MELHORA A POSTURA, e não só a simplifica: o legado isenta `admin` e
-- `service_role`, a 011 não isenta nem um nem outro. Quem sai é a regra mais
-- fraca. Os casos O1 a O8 de `supabase/tests/009_superficie_operacional.sql`
-- exercitam as quatro transições para admin em aal2 e para `service_role`
-- DEPOIS desta remoção, e todas continuam recusadas com 42501.
--
-- A 011 e a 010 NÃO são tocadas. O que sai é um objeto criado pela migration
-- 20260909175435, e sai por esta migration, que ainda não foi publicada —
-- `docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` foi atualizado no
-- mesmo commit para não seguir apontando um trigger que não existe mais.

DROP TRIGGER IF EXISTS trg_timesheet_entries_protect_invoice_link
  ON public.timesheet_entries;
DROP FUNCTION IF EXISTS public.protect_timesheet_invoice_link();


-- ---------------------------------------------------------------------------
-- 3. Helpers de autorização e de identidade — dono `postgres`, JUSTIFICADO
--
-- Os quatro helpers abaixo continuam pertencendo a `postgres`, e a justificativa
-- é individual, não de conveniência:
--
--   `uid_do_operador()`, `operador_elegivel_aal1()` e `operador_autorizado()`
--   leem `auth.users` e chamam `mfa_bloqueia_excecao_aal1()`, que por sua vez lê
--   `auth.mfa_factors` — tabela que nega SELECT a anon, authenticated e
--   service_role. Dar essa leitura ao papel de execução exigiria conceder-lhe
--   privilégio dentro do schema `auth`, que é justamente o que se quer evitar:
--   um papel que só aponta presença não precisa poder ler a base de contas.
--
--   `travar_turno_da_operacao()` existe para NÃO conceder `UPDATE` em `shifts`.
--   Ver a justificativa na própria função.
--
-- E — o ponto que torna isso seguro — NENHUM DOS QUATRO ESCREVE. As isenções de
-- `postgres` nas guardas de 010/011 são todas sobre escrita: recusar UPDATE
-- financeiro, recusar criação de vínculo, recusar mudança de fonte. Um helper
-- que só lê e trava não tem como aproveitar isenção nenhuma. A escrita, que é
-- onde a isenção importaria, acontece na RPC — e essa pertence ao papel
-- dedicado.
--
-- NENHUM DOS TRÊS PRIMEIROS ACEITA `user_id`. A decisão é sempre sobre
-- `auth.uid()`. Um parâmetro de usuário transformaria um helper de autorização
-- em enumerador: qualquer chamador perguntaria pelo acesso alheio.
--
-- AS SEIS CONDIÇÕES, e por que cada uma existe:
--
--   1. `auth.uid()` não nulo   — sem sessão não há a quem autorizar;
--   2. o `uid` ainda existe em `auth.users` — o PostgREST valida a ASSINATURA do
--      JWT e não consulta o GoTrue a cada requisição, então um token de conta
--      apagada segue aceito até expirar (~1 h). `user_roles` não tem FK para
--      `auth.users` e o papel sobrevive à conta. A 012 já fecha esse caso por
--      dentro; a verificação é repetida aqui de propósito, para que esta
--      autorização não dependa de um detalhe interno de outra função;
--   3. papel `operacional`  — esta superfície é do operador;
--   4. NÃO papel `admin`    — `user_roles` não impede acumular os dois papéis.
--      Um admin não opera em AAL1 (PROGRESS.md, seção 6.1), e sem esta linha um
--      admin que também fosse `operacional` teria em AAL1 uma porta para dados
--      que a policy de AAL2 lhe nega;
--   5. `aal = aal1`         — esta é a superfície de AAL1 e só dela. Uma sessão
--      aal2 tem o painel inteiro e não precisa passar por aqui; aceitar aal2
--      criaria um segundo caminho para os mesmos dados, com regras diferentes;
--   6. `mfa_bloqueia_excecao_aal1() = false` — é a razão de o PR A existir. Uma
--      conta com fator verificado recebe sessão AAL1 logo após a senha, ANTES do
--      TOTP: papel + `aal` sozinhos não distinguem quem nunca ativou MFA de quem
--      ativou e ainda não desafiou. Sem esta linha, quem optou pelo segundo
--      fator o contornaria por aqui.
--
-- SEM TRATAMENTO DE EXCEÇÃO, como na 012: erro de leitura sobe e a chamada
-- termina negando. Capturar e devolver `false` é o que transforma falha de
-- infraestrutura em concessão silenciosa — e aqui `false` já é o lado seguro.
--
-- NULL NÃO É `false`, E ISSO QUASE ABRIU A SUPERFÍCIE — medido, não suposto.
--
-- Na primeira versão os helpers eram uma cadeia de `AND` sem `coalesce`, e as
-- RPCs decidiam com `IF NOT helper() THEN RAISE`. Com um JWT SEM o claim `aal`,
-- `auth.jwt() ->> 'aal'` é NULL, a comparação com `'aal1'` é NULL, e a cadeia
-- inteira devolve NULL quando todo o resto é verdadeiro. Aí `NOT NULL` é NULL,
-- `IF NULL` não dispara — e a função SEGUIA. O caso A9 de
-- `supabase/tests/009_superficie_operacional.sql` pegou isso: um operacional
-- atribuído, sem MFA, com token sem `aal` LISTOU os turnos.
--
-- A correção é dupla, de propósito: `coalesce(..., false)` fecha o valor de
-- retorno, e `IS NOT TRUE` nas cinco RPCs fecha a decisão mesmo que alguém um
-- dia reintroduza um NULL aqui dentro. `IF NOT x` e `IF x IS NOT TRUE` são
-- idênticos para `true`/`false` e diferentes exatamente no caso que importa.
--
-- GRANTS: os quatro são peça interna. `authenticated`, `anon`, `service_role` e
-- `PUBLIC` não executam nenhum deles; quem executa é o papel dedicado, dono das
-- RPCs que os chamam.
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
  'Responde se a SESSAO atual e um operador elegivel a superficie AAL1: uid presente, conta existente, papel operacional, nao admin, claim aal=aal1 e estado de MFA que nao bloqueia. Nao recebe parametro e nao decide operacao. Interna: executavel apenas por bslog_rpc_operacional.';

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
  'Responde se a sessao atual e operador elegivel AAL1 E tem a operacao informada atribuida em user_operation_access. Nao aceita user_id: a decisao e sempre sobre auth.uid(). Interna: executavel apenas por bslog_rpc_operacional.';

-- A identidade que as RPCs usam. Elas NÃO chamam `auth.uid()` diretamente, e
-- isso é de desenho: assim o papel dedicado não precisa de privilégio nenhum
-- para resolver quem é o usuário, e existe um único lugar onde "quem está
-- apontando" é decidido.
--
-- Devolve NULL para quem não é operador elegível. Não é um `auth.uid()` com
-- outro nome: é `auth.uid()` CONDICIONADO à elegibilidade.
CREATE OR REPLACE FUNCTION public.uid_do_operador()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.operador_elegivel_aal1() THEN auth.uid() END;
$$;

COMMENT ON FUNCTION public.uid_do_operador() IS
  'Devolve auth.uid() somente quando a sessao e um operador elegivel AAL1, e NULL caso contrario. Existe para que as RPCs da superficie nao precisem alcancar o schema auth. Interna: executavel apenas por bslog_rpc_operacional.';

-- TRAVA DO TURNO — e a razão de ela ser uma função à parte.
--
-- A jornada do turno entra no cálculo da hora extra, então ela não pode mudar
-- entre a verificação e o commit: a 011 resolve esse tipo de corrida com
-- `FOR SHARE`, que conflita com qualquer alteração da linha e não conflita com
-- outro `FOR SHARE`.
--
-- Só que o PostgreSQL cobra privilégio de UPDATE para travar linha — `SELECT
-- ... FOR SHARE` com apenas SELECT é recusado com 42501, medido. Manter o
-- `FOR SHARE` dentro da RPC obrigaria a conceder `UPDATE` em `shifts` ao papel
-- dedicado, ou seja, poder de ESCRITA numa tabela onde ele não escreve nada.
-- Concentrar a trava aqui evita isso.
--
-- POR QUE ISTO NÃO REABRE O PROBLEMA DO `current_user`: esta função não
-- escreve. Não faz INSERT, UPDATE nem DELETE em tabela nenhuma — toma um lock
-- compartilhado e responde um booleano. As isenções de `postgres` nas guardas
-- de 010/011 só existem em caminhos de escrita; não há escrita aqui para elas
-- deixarem passar. O contrato é mínimo: dois uuids entram, um booleano sai,
-- nada além do par informado é alcançado, e a API não executa.
CREATE OR REPLACE FUNCTION public.travar_turno_da_operacao(
  p_shift_id     uuid,
  p_operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _pertence boolean;
BEGIN
  IF p_shift_id IS NULL OR p_operation_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1
     FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.operation_id = p_operation_id
      FOR SHARE;

  _pertence := FOUND;
  RETURN _pertence;
END;
$$;

COMMENT ON FUNCTION public.travar_turno_da_operacao(uuid, uuid) IS
  'Trava com FOR SHARE o turno informado se ele pertencer a operacao informada, e responde se pertence. Nao escreve nada. Existe para que o papel de execucao das RPCs nao precise de UPDATE em shifts, que e o privilegio que o PostgreSQL exige para travar linha. Interna: executavel apenas por bslog_rpc_operacional.';

-- O BOOLEAN `faturado`, SEM DAR `invoice_id` A NINGUÉM.
--
-- A superfície precisa dizer ao operador que uma linha congelou. A forma óbvia
-- seria `te.invoice_id IS NOT NULL` dentro da RPC — só que isso exige que o
-- papel de execução tenha SELECT em `invoice_id`, e um privilégio de leitura
-- concedido "só para derivar um booleano" é exatamente o tipo de folga que
-- depois ninguém lembra por que existe.
--
-- Este helper faz a leitura no contexto de `postgres` e devolve apenas o
-- booleano. Não escreve, recebe dois uuids, e a API não o executa. Com ele, o
-- papel das RPCs não tem — e não precisa de — nenhum privilégio sobre
-- `invoice_id`, nem de leitura nem de escrita.
CREATE OR REPLACE FUNCTION public.apontamento_faturado(
  p_timesheet_id uuid,
  p_employee_id  uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT te.invoice_id IS NOT NULL
       FROM public.timesheet_entries te
      WHERE te.timesheet_id = p_timesheet_id
        AND te.employee_id  = p_employee_id),
    false);
$$;

COMMENT ON FUNCTION public.apontamento_faturado(uuid, uuid) IS
  'Responde se o apontamento daquele par folha/colaborador ja esta vinculado a uma fatura. Devolve so o booleano, nunca o invoice_id, para que o papel de execucao das RPCs nao precise de privilegio de leitura naquela coluna. Nao escreve. Interna: executavel apenas por bslog_rpc_operacional.';

REVOKE ALL ON FUNCTION public.apontamento_faturado(uuid, uuid)       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.operador_elegivel_aal1()               FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.operador_autorizado(uuid)              FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.uid_do_operador()                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.travar_turno_da_operacao(uuid, uuid)   FROM PUBLIC, anon, authenticated, service_role;


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
-- motivo operacional: distinguir visualmente duas operações parecidas.
-- Documento, telefone, e-mail e o próprio `client_id` ficam de fora — o
-- `client_id` inclusive porque ele seria a chave para tentar qualquer outra
-- leitura.
--
-- A NEGATIVA É SEMPRE 42501 E SEMPRE ANTES DA LEITURA. Devolver zero linhas
-- para quem não é autorizado seria ambíguo com "autorizado e sem dados", e a
-- diferença importa para quem for depurar isto em produção.
--
-- SECURITY DEFINER IGNORA RLS. É por isso que cada função revalida papel, AAL,
-- estado de MFA e atribuição por dentro, sempre pelos mesmos helpers, antes de
-- qualquer leitura ou escrita. O dono é `bslog_rpc_operacional` (seção 7), não
-- `postgres`.
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
DECLARE
  _uid uuid;
BEGIN
  _uid := public.uid_do_operador();

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão não autorizada à superfície operacional.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT o.id, o.name, o.site, o.type, o.operation_date, o.status, c.name
      FROM public.user_operation_access a
      JOIN public.operations o ON o.id = a.operation_id
      JOIN public.clients    c ON c.id = o.client_id
     WHERE a.user_id = _uid
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
-- `operador_autorizado`: a atribuição é por OPERAÇÃO, e sem esta verificação um
-- `p_shift_id` de outra operação devolveria a equipe daquela outra.
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
-- e a tela precisa saber que ela existe e em que estado está. Com folha vazia a
-- resposta é uma linha com os campos de folha preenchidos e os de apontamento
-- nulos.
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
           te.break_minutes, te.notes,
           public.apontamento_faturado(te.timesheet_id, te.employee_id)
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
-- TRÊS CAMADAS, E NENHUMA DELAS SOZINHA
--
--   1. o contrato: a lista branca de chaves e as colunas nomeadas no INSERT;
--   2. o PRIVILÉGIO: o papel dono tem INSERT e UPDATE apenas nas COLUNAS
--      operacionais (seção 7). Mesmo que alguém escreva `invoice_id` ou
--      `billed_amount` num comando daqui, o PostgreSQL recusa com 42501 —
--      a proteção não depende de ninguém lembrar da regra;
--   3. as guardas de 010 e 011, que agora enxergam `current_user =
--      bslog_rpc_operacional` e portanto VOLTAM a se aplicar a esta escrita.
--
-- A recusa acontece ANTES de qualquer escrita, e a função é uma transação
-- única: ou todas as linhas entram, ou nenhuma entra.
--
-- DELETE NÃO EXISTE nesta superfície, por decisão de escopo — e o papel dono
-- nem tem o privilégio. Linha ausente do payload é linha NÃO TOCADA, nunca
-- apagada. Apagar apontamento continua sendo caminho administrativo, em AAL2.
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
  _uid          uuid;
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

  _uid := public.uid_do_operador();

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

  -- 3. O turno pertence à operação, e fica travado com `FOR SHARE` até o fim da
  --    transação — a jornada dele entra no cálculo da hora extra e não pode
  --    mudar no meio. A trava mora numa função à parte para que este papel não
  --    precise de `UPDATE` em `shifts`; ver a seção 3.
  IF public.travar_turno_da_operacao(p_shift_id, p_operation_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Turno informado não pertence à operação.'
      USING ERRCODE = '23514';
  END IF;

  -- 4. Folha: reaproveita a existente ou cria. O INSERT direto com captura de
  --    `unique_violation` evita tocar numa folha existente — um
  --    `ON CONFLICT DO UPDATE` dispararia os triggers de UPDATE de `timesheets`
  --    e reescreveria `updated_at` de folha já faturada sem necessidade. Sob
  --    READ COMMITTED, quando a violação acontece a transação concorrente já
  --    commitou, então o SELECT seguinte a encontra.
  --
  --    `FOR SHARE` NAS DUAS BUSCAS, e não é zelo decorativo. Sem ele havia uma
  --    janela real entre validar a folha e gravar a linha, levantada na review
  --    do Codex no PR #26:
  --
  --      o operador lê a folha F de (operação A, turno S, data D), aberta;
  --      um admin, em aal2, COMMITA no meio:
  --        - `status = 'closed'`  -> a linha entraria numa folha fechada, porque
  --          a verificação abaixo já teria passado sobre o valor velho; ou
  --        - se F ainda estiver VAZIA, `operation_id = B` — movimento que
  --          `bloquear_mover_folha_com_apontamento` só recusa quando a folha já
  --          tem apontamento. A linha então nasceria numa operação para a qual
  --          este operador NUNCA foi autorizado, e `derivar_valores_financeiros`
  --          calcularia pelo contrato de B.
  --
  --    `ancorar_folha_do_apontamento` trava a folha só no INSERT da linha, e
  --    trava a versão JÁ alterada, sem revalidar chave nem status — por isso
  --    não fecha nada disso sozinho.
  --
  --    `FOR SHARE` conflita com o `FOR NO KEY UPDATE` que aquele UPDATE de admin
  --    tomaria, então ou ele espera o commit desta transação, ou já commitou e o
  --    PostgreSQL reavalia o WHERE sobre a versão nova: status fechado cai na
  --    recusa abaixo, e chave alterada faz a folha simplesmente não casar, o que
  --    leva ao INSERT de uma folha correta. `FOR SHARE` e não `FOR UPDATE`, pelo
  --    mesmo motivo da 011: dois operadores gravando a mesma folha não se
  --    serializam entre si. É o mesmo lock que o trigger já toma depois, tomado
  --    antes — nenhuma ordem nova entra no grafo de deadlock.
  SELECT t.id, t.status INTO _folha_id, _folha_status
    FROM public.timesheets t
   WHERE t.operation_id = p_operation_id
     AND t.shift_id     = p_shift_id
     AND t.work_date    = p_work_date
     FOR SHARE;

  IF _folha_id IS NULL THEN
    BEGIN
      INSERT INTO public.timesheets (operation_id, shift_id, work_date, created_by)
      VALUES (p_operation_id, p_shift_id, p_work_date, _uid)
      RETURNING id, status INTO _folha_id, _folha_status;
    EXCEPTION WHEN unique_violation THEN
      SELECT t.id, t.status INTO _folha_id, _folha_status
        FROM public.timesheets t
       WHERE t.operation_id = p_operation_id
         AND t.shift_id     = p_shift_id
         AND t.work_date    = p_work_date
         FOR SHARE;
    END;
  END IF;

  -- Folha fechada é decisão administrativa, tomada em AAL2 na tela de
  -- apontamentos. O operador não a reabre e não escreve por cima dela. Não é
  -- invariante de banco — é regra desta superfície, e está registrada como tal.
  -- Com o `FOR SHARE` acima, este `status` é o valor travado: ou ninguém mexe
  -- nele até o commit, ou já tinha mexido e é a versão nova que se lê aqui.
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
    -- `operation_id` ou `timesheet_id` de entrarem pelo payload: o que não está
    -- explicitamente permitido está recusado. E, se um dia falhar, o privilégio
    -- por coluna do papel dono recusa de novo, do lado do PostgreSQL.
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
    -- turnos da operação. Também não é invariante de banco — nenhum trigger
    -- liga `timesheet_entries` a `operation_team`, para papel nenhum.
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

    -- Apontamento já faturado é imutável (migration 011). A recusa explícita
    -- aqui existe pela mensagem e por falhar cedo; `bloquear_edicao_faturada`,
    -- que não isenta papel nenhum, continua por baixo.
    _faturado := public.apontamento_faturado(_folha_id, _employee_id);

    IF _faturado THEN
      RAISE EXCEPTION 'Apontamento já faturado não pode ser alterado.'
        USING ERRCODE = '42501';
    END IF;

    -- Somente os seis campos. Nenhuma coluna financeira, nenhum `invoice_id`,
    -- nenhuma chave desnormalizada: `operation_id` e `work_date` da linha são
    -- escritos por `sincronizar_chave_da_diaria()` a partir da folha, e os
    -- valores por `derivar_valores_financeiros()`. Coluna escrita por trigger
    -- não passa por verificação de privilégio — só as nomeadas no comando —,
    -- então o papel dono pode ser mínimo sem quebrar a derivação.
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
  'Grava o apontamento operacional de um par operacao/turno numa data. Aceita por linha somente employee_id, status, check_in, check_out, break_minutes e notes; qualquer outra chave recusa a chamada inteira com 22023. Nao escreve coluna financeira nem invoice_id, e o papel dono nem tem privilegio para isso: os valores continuam sendo derivados pelos triggers da migration 010. Nao apaga linha. Exige operador_autorizado na operacao.';


-- ---------------------------------------------------------------------------
-- 6. Quem pode executar as RPCs
--
-- `authenticated` e mais ninguém. `anon` e `PUBLIC` revogados explicitamente —
-- o Postgres concede EXECUTE a PUBLIC em toda função nova, e o Supabase ainda
-- acrescenta os papéis da API por DEFAULT PRIVILEGES; revogar só de `anon`
-- deixaria o privilégio chegar por PUBLIC, que foi o defeito registrado como
-- SEC-011.
--
-- `service_role` fica de fora das cinco: ela ignora RLS por definição e não tem
-- uso nesta superfície. A aplicação não a usa.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.listar_operacoes_do_operador()                          FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_turnos_do_operador(uuid)                         FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_equipe_do_operador(uuid, uuid)                   FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)       FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.salvar_apontamento_operacional(uuid, uuid, date, jsonb) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.listar_operacoes_do_operador()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_turnos_do_operador(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_equipe_do_operador(uuid, uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_apontamento_operacional(uuid, uuid, date, jsonb) TO authenticated;


-- ---------------------------------------------------------------------------
-- 7. Os privilégios do papel de execução — o inventário completo
--
-- Cada linha abaixo corresponde a um comando concreto das RPCs. Nada aqui é
-- especulativo, e o que não está aqui o papel não pode.
--
-- LEITURA. As quatro RPCs de leitura tocam `operations`, `clients`, `shifts`,
-- `employees`, `operation_team`, `timesheets`, `timesheet_entries` e
-- `user_operation_access` — e o SELECT é concedido **coluna a coluna**, não por
-- tabela. Nenhuma coluna financeira, nem `invoice_id`, é legível por este papel.
--
-- NENHUM OBJETO DO SCHEMA `auth`, e nenhum `user_roles`. É `uid_do_operador()`
-- quem resolve a identidade, e ela pertence a `postgres`, só lê e devolve o uuid
-- da própria sessão; quem lê papel é `has_role()`, chamada apenas pelos helpers.
-- Depois da seção 2b não sobrou nenhum trigger no caminho desta escrita que
-- alcance `auth` ou `user_roles` como invocador — e é por isso que este papel
-- não precisa de `USAGE` em `auth`, que Production não concede.

-- ESCRITA, por COLUNA. É aqui que a proteção deixa de depender de alguém
-- lembrar da regra:
--
--   timesheets        INSERT (operation_id, shift_id, work_date, created_by)
--   timesheet_entries INSERT (timesheet_id, employee_id, status, check_in,
--                             check_out, break_minutes, notes)
--                     UPDATE (status, check_in, check_out, break_minutes, notes)
--
-- `invoice_id`, `billed_amount`, `cost_amount` e os três snapshots NÃO estão em
-- nenhuma dessas listas. Um comando desta superfície que os nomeasse seria
-- recusado pelo PostgreSQL com 42501, independentemente do que o código diga —
-- medido, e é o que responde ao "não depender apenas do contrato JSON".
--
-- Coluna escrita por TRIGGER não passa por essa verificação: só as colunas
-- nomeadas no comando passam. Por isso `derivar_valores_financeiros()` continua
-- gravando os valores normalmente, e `sincronizar_chave_da_diaria()` continua
-- gravando `operation_id` e `work_date` da linha.
--
-- `UPDATE (updated_at)` EM `timesheets` E EM `shifts` — e por que não é o que
-- parece. O papel não atualiza folha nem turno: o PostgreSQL exige privilégio
-- de UPDATE em ALGUMA coluna para travar linha com `FOR SHARE`, e há DOIS
-- `FOR SHARE` no caminho desta escrita, ambos de triggers da 011 que rodam como
-- SECURITY INVOKER:
--
--   ancorar_folha_do_apontamento  trava a folha pai a cada INSERT de apontamento
--   validar_par_operacao_turno    trava o turno a cada INSERT de folha
--
-- Medido: sem esse privilégio o INSERT falha com "permission denied for table
-- shifts". Como os dois triggers vêm de migration já aplicada, que não se
-- edita, a saída é conceder o MENOR privilégio que satisfaz o lock.
--
-- `updated_at` é a escolha certa porque é a única coluna sem significado de
-- negócio em ambas as tabelas E porque um trigger `BEFORE UPDATE` a reescreve
-- com `now()` em qualquer atualização: mesmo um comando que a nomeasse não
-- produziria efeito observável. Nem `status`, nem `work_date`, nem
-- `operation_id`, nem `shift_id`, nem a jornada do turno — que são as colunas
-- que importam — ficam ao alcance deste papel.
--
-- O `FOR SHARE` que ESTA migration introduziu, sobre `shifts`, continua fora
-- daqui: ele mora em `travar_turno_da_operacao()`, que pertence a `postgres` e
-- não escreve. Ver a seção 3.
--
-- SEM DELETE em tabela alguma, SEM TRUNCATE, SEM REFERENCES, SEM TRIGGER.
-- ---------------------------------------------------------------------------

-- `USAGE` em `public` e mais nada. Nenhum privilégio no schema `auth`, nem de
-- schema, nem de tabela, nem de função. `CREATE` em `public` ele recebe por
-- dois comandos na seção 8, o tempo de transferir a posse das funções, e perde
-- em seguida — o estado final é `USAGE` sim, `CREATE` não.
GRANT USAGE ON SCHEMA public TO bslog_rpc_operacional;

-- LEITURA, COLUNA A COLUNA. `GRANT SELECT ON TABLE` daria ao papel a tabela
-- inteira — inclusive `employees.daily_cost`, `operations.agreed_amount`,
-- `timesheet_entries.billed_amount`, `cost_amount`, os três snapshots e
-- `invoice_id`. As RPCs não devolvem nada disso, mas o DONO teria o privilégio,
-- e defesa em profundidade que depende do código não usar o que pode usar não é
-- defesa. Cada coluna abaixo corresponde a uma referência real; conferidas uma
-- a uma contra o corpo das cinco RPCs e dos três triggers que rodam sob este
-- papel.

-- `client_id` entra porque `listar_operacoes_do_operador` faz o JOIN com
-- `clients` por ele; ele não atravessa para o operador. `agreed_amount` e
-- `contract_id` ficam de fora.
GRANT SELECT (id, name, site, type, operation_date, status, client_id)
  ON TABLE public.operations TO bslog_rpc_operacional;

-- Do cliente, o nome e a chave do JOIN. Nada de doc, phone, email, contact_name.
GRANT SELECT (id, name)
  ON TABLE public.clients TO bslog_rpc_operacional;

-- `operation_id` é lido pela RPC e também por `validar_par_operacao_turno`,
-- trigger da 011 que roda como invocador no INSERT da folha.
GRANT SELECT (id, name, start_time, end_time, break_minutes, crosses_midnight, operation_id)
  ON TABLE public.shifts TO bslog_rpc_operacional;

-- Do colaborador, só o que a tela do operador mostra. `daily_cost`, `doc`,
-- `phone` e `status` ficam de fora.
GRANT SELECT (id, name, role)
  ON TABLE public.employees TO bslog_rpc_operacional;

GRANT SELECT (operation_id, shift_id, employee_id, active)
  ON TABLE public.operation_team TO bslog_rpc_operacional;

-- `id`, `operation_id` e `work_date` também são lidos por
-- `sincronizar_chave_da_diaria` e `ancorar_folha_do_apontamento`, triggers da
-- 008 e da 011 que rodam como invocador. `notes` e `created_by` não são lidos.
GRANT SELECT (id, operation_id, shift_id, work_date, status)
  ON TABLE public.timesheets TO bslog_rpc_operacional;

-- As seis colunas operacionais e mais nada. Sem `invoice_id` — o booleano
-- `faturado` vem de `apontamento_faturado()` —, sem `billed_amount`,
-- `cost_amount`, `worked_minutes`, `overtime_minutes` e sem os três snapshots.
GRANT SELECT (timesheet_id, employee_id, status, check_in, check_out, break_minutes, notes)
  ON TABLE public.timesheet_entries TO bslog_rpc_operacional;

GRANT SELECT (user_id, operation_id)
  ON TABLE public.user_operation_access TO bslog_rpc_operacional;

GRANT INSERT (operation_id, shift_id, work_date, created_by)
  ON TABLE public.timesheets TO bslog_rpc_operacional;
GRANT UPDATE (updated_at)
  ON TABLE public.timesheets TO bslog_rpc_operacional;
GRANT UPDATE (updated_at)
  ON TABLE public.shifts TO bslog_rpc_operacional;

GRANT INSERT (timesheet_id, employee_id, status, check_in, check_out, break_minutes, notes)
  ON TABLE public.timesheet_entries TO bslog_rpc_operacional;
GRANT UPDATE (status, check_in, check_out, break_minutes, notes)
  ON TABLE public.timesheet_entries TO bslog_rpc_operacional;

GRANT EXECUTE ON FUNCTION public.operador_elegivel_aal1()             TO bslog_rpc_operacional;
GRANT EXECUTE ON FUNCTION public.operador_autorizado(uuid)            TO bslog_rpc_operacional;
GRANT EXECUTE ON FUNCTION public.uid_do_operador()                    TO bslog_rpc_operacional;
GRANT EXECUTE ON FUNCTION public.travar_turno_da_operacao(uuid, uuid) TO bslog_rpc_operacional;
GRANT EXECUTE ON FUNCTION public.apontamento_faturado(uuid, uuid)     TO bslog_rpc_operacional;


-- ---------------------------------------------------------------------------
-- 8. A troca de dono — o passo que dá sentido a tudo acima
--
-- Depois daqui, `current_user` dentro das cinco RPCs é `bslog_rpc_operacional`,
-- e as guardas de 010/011 que isentam `postgres` voltam a se aplicar à escrita
-- do operador. Os quatro helpers continuam com `postgres` pelos motivos da
-- seção 3 — e nenhum deles escreve.
--
-- A troca vem DEPOIS dos grants de propósito: `REVOKE`/`GRANT` sobre função
-- exige ser dono, e assim os comandos acima rodam enquanto `postgres` ainda é.
-- A ACL sobrevive à transferência; o PostgreSQL apenas reescreve o concedente.
--
-- O `CREATE` TEMPORÁRIO, E POR QUE ELE É OBRIGATÓRIO
--
-- `ALTER FUNCTION ... OWNER TO` exige que o NOVO DONO tenha `CREATE` no schema
-- onde o objeto vive: transferir a posse equivale, para o PostgreSQL, a esse
-- papel criar o objeto ali. Sem isso o comando recusa com
-- `42501 / permission denied for schema public`.
--
-- Isso NÃO é hipótese: a primeira tentativa de aplicar esta migration em
-- Production falhou exatamente aqui, no primeiro dos cinco `ALTER FUNCTION`, e
-- o rollback desfez tudo — Production ficou intacta, com 18 migrations.
--
-- POR QUE O TESTE LOCAL NÃO PEGOU, que é a parte que interessa para a próxima
-- vez: no harness local as migrations rodam como um `postgres` SUPERUSUÁRIO, e
-- superusuário pula essa verificação de privilégio inteira. O `postgres` do
-- Supabase **não é superusuário** — ele é dono do schema `public` e tem
-- `CREATEROLE`/`BYPASSRLS`, mas as verificações de ACL valem para ele. Toda
-- afirmação de privilégio validada só no harness herda essa ressalva.
--
-- Reproduzido depois, com executor não-superusuário: sem o `CREATE`, os cinco
-- `ALTER OWNER` recusam com 42501; com ele, passam; e o `REVOKE` seguinte
-- devolve o papel ao mínimo.
--
-- A JANELA É A MENOR POSSÍVEL. O `CREATE` existe entre duas linhas adjacentes,
-- dentro da mesma transação da migration — se qualquer um dos `ALTER` falhar, o
-- rollback leva o `GRANT` junto e o privilégio nunca chega a existir. O papel é
-- `NOLOGIN` e ninguém se autentica como ele, então não há sessão dele para
-- aproveitar a janela. O estado FINAL é `USAGE` sim, `CREATE` não — asseverado
-- na seção 9 e no caso R do teste `009`.
-- ---------------------------------------------------------------------------

GRANT CREATE ON SCHEMA public TO bslog_rpc_operacional;

ALTER FUNCTION public.listar_operacoes_do_operador()                          OWNER TO bslog_rpc_operacional;
ALTER FUNCTION public.listar_turnos_do_operador(uuid)                         OWNER TO bslog_rpc_operacional;
ALTER FUNCTION public.listar_equipe_do_operador(uuid, uuid)                   OWNER TO bslog_rpc_operacional;
ALTER FUNCTION public.listar_apontamentos_do_operador(uuid, uuid, date)       OWNER TO bslog_rpc_operacional;
ALTER FUNCTION public.salvar_apontamento_operacional(uuid, uuid, date, jsonb) OWNER TO bslog_rpc_operacional;

REVOKE CREATE ON SCHEMA public FROM bslog_rpc_operacional;


-- ---------------------------------------------------------------------------
-- 9. Verificação da própria migration
--
-- Uma migration que se aplica pela metade em silêncio é pior que uma que falha.
-- Estas asserções custam nada e recusam o commit se o estado final não for o
-- descrito acima — em especial a troca de dono, que é a razão de ser deste PR.
-- ---------------------------------------------------------------------------

DO $verificacao$
DECLARE
  _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                       'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                       'salvar_apontamento_operacional')
     AND pg_get_userbyid(p.proowner) = 'bslog_rpc_operacional'
     AND p.prosecdef;
  IF _n <> 5 THEN
    RAISE EXCEPTION 'Esperadas 5 RPCs SECURITY DEFINER de bslog_rpc_operacional; encontradas %.', _n;
  END IF;

  -- Financeiro e vínculo: nem escrita NEM LEITURA.
  IF has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'invoice_id', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'invoice_id', 'UPDATE')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'invoice_id', 'INSERT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'billed_amount', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'cost_amount', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'daily_rate_snapshot', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'ot_hour_rate_snapshot', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'daily_cost_snapshot', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.employees', 'daily_cost', 'SELECT')
     OR has_column_privilege('bslog_rpc_operacional', 'public.operations', 'agreed_amount', 'SELECT') THEN
    RAISE EXCEPTION 'bslog_rpc_operacional recebeu privilegio em coluna financeira ou de fatura.';
  END IF;

  IF has_table_privilege('bslog_rpc_operacional', 'public.contracts', 'SELECT') THEN
    RAISE EXCEPTION 'bslog_rpc_operacional nao pode ler contracts.';
  END IF;

  IF pg_has_role('bslog_rpc_operacional', 'authenticated', 'USAGE')
     OR pg_has_role('bslog_rpc_operacional', 'anon', 'USAGE')
     OR pg_has_role('bslog_rpc_operacional', 'service_role', 'USAGE') THEN
    RAISE EXCEPTION 'bslog_rpc_operacional nao pode ser membro de papel da API.';
  END IF;

  IF has_schema_privilege('bslog_rpc_operacional', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'bslog_rpc_operacional nao pode ter USAGE no schema auth.';
  END IF;

  -- O `CREATE` da seção 8 é temporário: se sobrar, a migration não passa.
  IF has_schema_privilege('bslog_rpc_operacional', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'bslog_rpc_operacional ficou com CREATE no schema public.';
  END IF;

  IF NOT has_schema_privilege('bslog_rpc_operacional', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'bslog_rpc_operacional precisa de USAGE no schema public.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'protect_timesheet_invoice_link'
  ) THEN
    RAISE EXCEPTION 'O trigger legado protect_timesheet_invoice_link deveria ter sido aposentado.';
  END IF;

  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname = 'public' AND policyname LIKE '%exige_aal2%' AND permissive = 'RESTRICTIVE';
  IF _n <> 11 THEN
    RAISE EXCEPTION 'As 11 policies *_exige_aal2 deveriam continuar intactas; encontradas %.', _n;
  END IF;
END
$verificacao$;
