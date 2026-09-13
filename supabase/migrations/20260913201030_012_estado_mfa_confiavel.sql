-- Estado de MFA verificável PELO BANCO.
--
-- O PROBLEMA
--
-- O guard do painel decide o segundo fator com
-- `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`. Essa função tem dois
-- ramos no `@supabase/auth-js` 2.115.0, e o projeto chama **sempre sem
-- argumento** — o ramo que NÃO fala com o servidor:
--
--   const { data: { session } } = await this.getSession();   // storage/cookie
--   const { payload } = decodeJWT(session.access_token);     // decodifica
--   currentLevel = payload.aal;
--   const verified = session.user.factors?.filter(f => f.status === 'verified');
--   if (verified.length > 0) nextLevel = 'aal2';
--
-- `currentLevel` sai da claim `aal` de um JWT assinado, então não se forja sem
-- quebrar a assinatura. Mas `nextLevel` sai de `session.user.factors`, que é
-- um campo JSON do MESMO cookie, FORA da área coberta pela assinatura. O
-- próprio SDK marca esse objeto com um proxy que avisa no console: "could be
-- insecure! This value comes directly from the storage medium (usually cookies
-- on the server) and may not be authentic."
--
-- Reproduzido localmente com o cliente de servidor real, variando apenas o
-- cookie e mantendo o mesmo JWT:
--
--   aal1 + factors:[{status:'verified'}]  ->  nextLevel = aal2
--   aal1 + factors:[]                     ->  nextLevel = aal1
--
-- HOJE ISSO NÃO É EXPLORÁVEL, e é importante dizer por quê: `nextLevel` forjado
-- para `aal1` produz a situação "mfa-ausente", que manda para /mfa e FECHA o
-- painel. A mentira só consegue negar acesso a quem mente.
--
-- O RISCO É FUTURO, E É A RAZÃO DESTA MIGRATION
--
-- A política aprovada (PROGRESS.md, seções 6 e 7) prevê que `operacional` possa
-- usar AAL1 onde for autorizado, EXCETO se a conta tiver optado por MFA. A
-- condição de concessão vira "não tem fator verificado" — exatamente o valor
-- que acabamos de mostrar ser forjável. Uma conta com TOTP verificado apagaria
-- `factors` do próprio cookie e usaria o sistema em AAL1 sem nunca fazer o
-- segundo fator.
--
-- E a RLS não tem como se defender sozinha: uma policy enxerga apenas claims do
-- JWT, e o JWT não carrega nada sobre existência de fator. `aal1` sozinho não
-- distingue "nunca cadastrou MFA" de "cadastrou e ainda não desafiou".
--
-- A FONTE AUTORITATIVA
--
-- `auth.mfa_factors` é a única fonte do estado real, e está fora de alcance de
-- quem consulta pela API: RLS ativa com ZERO policies, e `SELECT` negado a
-- `anon`, a `authenticated` e também a `service_role`. Só `postgres` (que tem
-- `rolbypassrls`) e o dono `supabase_auth_admin` leem.
--
-- Por isso a função abaixo é SECURITY DEFINER: pertence a `postgres` e roda com
-- os privilégios dele. Não é bypass de autorização — ela não recebe parâmetro,
-- não alcança outro usuário, e devolve um único booleano sobre a própria conta.
--
-- POLARIDADE: A FUNÇÃO RESPONDE PELO BLOQUEIO, NÃO PELA POSSE
--
-- O nome não é `tem_mfa_verificado`. Ela responde "o estado de MFA impede a
-- futura exceção de AAL1?", e o valor seguro é TRUE. Assim todo caso duvidoso
-- — sem sessão, erro de leitura — cai no lado que FECHA, sem depender de quem
-- escrever a policy lembrar de negar a ausência.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não libera AAL1. Não altera nenhuma das 11 policies `*_exige_aal2`, que
-- continuam globais e RESTRICTIVE. Não decide papel — a função não consulta
-- `user_roles` de propósito, porque `admin` fica fora da exceção
-- independentemente de ter fator, e misturar as duas decisões aqui esconderia
-- essa regra dentro de um primitivo. Não altera o guard do Next, o login, o
-- fluxo de /mfa nem a recuperação de senha. Não cria usuário. Não toca em dado.


-- ---------------------------------------------------------------------------
-- 1. O primitivo
-- ---------------------------------------------------------------------------
--
-- `STABLE`: lê tabela, e o valor não muda dentro do mesmo comando. Mesmo
-- contrato de `has_role()` e `is_staff()`.
--
-- `search_path` explícito e sem `auth`: tudo que a função referencia está
-- schema-qualified (`auth.uid()`, `auth.mfa_factors`), então nenhuma resolução
-- depende do caminho. Isso fecha o vetor clássico de SECURITY DEFINER, em que
-- um objeto plantado num schema gravável sequestra um nome não qualificado.
--
-- SEM TRATAMENTO DE EXCEÇÃO, DE PROPÓSITO: se a leitura de `auth.mfa_factors`
-- falhar — tabela renomeada num upgrade do Supabase, privilégio perdido —, o
-- erro sobe e a policy que a chamar NEGA. Capturar e devolver `false` aqui
-- transformaria uma falha de infraestrutura em concessão silenciosa de acesso,
-- que é o pior desfecho possível.
CREATE OR REPLACE FUNCTION public.mfa_bloqueia_excecao_aal1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    -- Sem sessão não existe conta para avaliar. Responder `false` aqui diria
    -- "esta conta não tem MFA", e uma policy futura leria isso como permissão.
    WHEN auth.uid() IS NULL THEN true

    -- CONTA QUE NÃO EXISTE MAIS. O PostgREST valida a ASSINATURA do JWT e não
    -- consulta o GoTrue a cada requisição, então um token emitido antes de a
    -- conta ser apagada continua aceito até expirar — cerca de uma hora. Nesse
    -- intervalo `auth.uid()` devolve o `sub` de alguém que já não existe.
    --
    -- Sem esta linha o resultado se invertia: `auth.mfa_factors` tem FK para
    -- `auth.users` com ON DELETE CASCADE, então apagar a conta leva os fatores
    -- junto, o EXISTS abaixo dá `false`, e a conta APAGADA passaria a ser
    -- elegível à exceção de AAL1 que, viva, lhe era negada. O papel sobrevive
    -- para completar o quadro: `user_roles` não tem FK para `auth.users` — é a
    -- remoção que deixa registro órfão, já registrada em docs/SEGURANCA.md.
    --
    -- Conta inexistente é "não sei quem é", e "não sei" já é `true` aqui.
    -- Levantado na review do PR #25 e reproduzido antes de corrigir; os casos
    -- K e L de `supabase/tests/008_estado_mfa.sql` guardam a regressão.
    WHEN NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
    ) THEN true

    ELSE EXISTS (
      SELECT 1
        FROM auth.mfa_factors f
       WHERE f.user_id = auth.uid()
         -- Qualquer `factor_type` conta: totp, webauthn ou phone. O que importa
         -- é a conta ter provado posse de um segundo fator, não qual.
         AND f.status = 'verified'::auth.factor_status
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Quem pode executar
-- ---------------------------------------------------------------------------
--
-- `authenticated` precisa do EXECUTE porque uma policy é avaliada com o papel
-- do chamador: sem o grant, a policy do PR B falharia por privilégio em vez de
-- decidir.
--
-- `service_role` fica de fora. Não há dependência técnica: ele ignora RLS por
-- definição, então nunca precisa perguntar se deve exigir aal2. Manter o grant
-- só ampliaria a superfície da chave que a API expõe.
--
-- `PUBLIC` e `anon` são revogados explicitamente. O `REVOKE FROM PUBLIC` é o
-- que realmente importa: o Postgres concede EXECUTE a PUBLIC em toda função
-- nova, e revogar só de `anon` deixaria o privilégio chegar por essa via — foi
-- exatamente o defeito registrado como SEC-011.
REVOKE ALL ON FUNCTION public.mfa_bloqueia_excecao_aal1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mfa_bloqueia_excecao_aal1() FROM anon;
REVOKE ALL ON FUNCTION public.mfa_bloqueia_excecao_aal1() FROM service_role;

GRANT EXECUTE ON FUNCTION public.mfa_bloqueia_excecao_aal1() TO authenticated;

COMMENT ON FUNCTION public.mfa_bloqueia_excecao_aal1() IS
  'Responde se o estado de MFA da conta atual impede a futura excecao de AAL1. TRUE quando ha fator verificado, quando nao ha sessao e quando o uid do JWT nao existe mais em auth.users: o valor seguro e o que exige aal2. Nao decide papel, nao concede acesso e nao libera AAL1. SECURITY DEFINER porque auth.mfa_factors nega SELECT a anon, authenticated e service_role; sem parametro, para nao permitir enumerar outra conta.';
