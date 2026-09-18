# BS Logística — Project Checkpoint

Checkpoint dinâmico. Regras permanentes ficam em [CLAUDE.md](CLAUDE.md).

## 1. Checkpoint

| Item          | Valor                                         |
| ------------- | --------------------------------------------- |
| Data          | 2026-09-18                                    |
| Branch atual  | `claude/laughing-archimedes-cq6a4z` — PR B1   |
| `main`        | `3ec924269ff98df8e63af688faf386142671c222`    |
| `origin/main` | `3ec9242` — idêntico ao `main` local          |
| Production    | **verde** no commit `3ec9242`                 |
| Migrations    | **18 em Production**; a 013 do PR B1 pendente |

| Frente                               | Merge     | Estado                                |
| ------------------------------------ | --------- | ------------------------------------- |
| Enforcement AAL2                     | `359dd90` | **CONCLUÍDO** — PR #14, em Production |
| Password recovery                    | `8149a4d` | **CONCLUÍDO** — PRs #13, #17 a #20    |
| A₀ — valores derivados no banco      | `83ed1f3` | **CONCLUÍDO** — PR #22, em Production |
| A₀.1 — fontes financeiras protegidas | `c019e42` | **CONCLUÍDO** — PR #23, em Production |
| PR A — estado de MFA no banco        | `3ec9242` | **CONCLUÍDO** — PR #25, em Production |

**A₀ e A₀.1 estão concluídos e implantados** — migrations `010` e `011`
aplicadas em Production em 13/09/2026, com validação read-only completa. O
detalhe está na **seção 9**.

O trabalho em curso é a **nova política de autorização** (seção 7). O **PR A**
está **em Production** — migration `012`, o primitivo de MFA no banco (seção
7.1), que **não libera AAL1**. O **PR B1** está **implementado e ainda não em
Production**: migration `013`, a fundação da superfície operacional AAL1 (seção
7.2). Ele também **não libera AAL1 em tabela nenhuma** — entrega uma superfície
de RPC estreita que **a interface ainda não consome**.

Seguem **aprovados e não implementados**: **PR B2** (adaptar a interface à
superfície) e **PR C** (guard role-aware). Leia a seção 6 antes de tocar em
guard, policy ou usuário.

## 2. Ambiente

|                 |                                                       |
| --------------- | ----------------------------------------------------- |
| Projeto local   | `C:\Users\VINICIUS\Documents\BS Logistics`            |
| GitHub          | `therunnas/bslogistica`                               |
| Produção        | `https://admin.bslogisticas.com.br`                   |
| Supabase atual  | `ehkduqokntemtmqzdrbd`                                |
| Supabase antigo | `qaibhlucbpetxrtswulf` — **apagado**, não existe mais |
| GoTrue          | `v2.196.0` — lido de `/auth/v1/health` em 12/09/2026  |

**Site institucional é outro projeto:** `https://bslogisticas.com.br`,
repositório `therunnas/PROJETO-BS-LOGISTICA`, pasta
`C:\Users\VINICIUS\Documents\GitHub\PROJETOS\BS Logistica`. Nunca tocar.

O domínio tem **"s"** em "logisticas".

A reconstrução do Supabase está **concluída e validada** — não refazer.

## 3. Auth, MFA e branding — estado consolidado

|                  |                                        |
| ---------------- | -------------------------------------- |
| Admin            | `contato@bslogisticas.com.br`          |
| UUID             | `61d892b4-abb3-4e55-b5e1-9795a3476d96` |
| Papel            | `admin`                                |
| MFA              | TOTP `verified`                        |
| `disable_signup` | `true`                                 |
| Site URL         | `https://admin.bslogisticas.com.br`    |

**Hoje existe UM único usuário real**, o admin acima. Não há conta
`operacional` — e não deve haver antes da refatoração da seção 7.

Branding provisório do MVP em produção (PRs #11 e #12): logo em
`/branding/bs-logo-temp.png`, login, sidebar, home e favicon derivado da
própria marca.

**E-mail/SMTP funciona:** Supabase → Resend → Gmail, com SPF, DKIM e DMARC
PASS. Remetente `BS Soluções Logísticas <nao-responda@envio.bslogisticas.com.br>`.

**Template Reset Password já está no formato novo.** Aponta para
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`, e isso
foi comprovado em Production pelo E2E real. **O passo manual que este arquivo
listava como pendente está cumprido.**

## 4. Password recovery — ESTADO FINAL

Fluxo real, como está em Production hoje.

### 4.1 `GET /auth/confirm`

- **não consome o token** e não chama `verifyOtp`;
- não instancia cliente do Supabase e não cria sessão nem prova;
- confere **apenas formato e `type=recovery`**;
- grava `bs_recovery_pending` (`httpOnly`, `Secure`, `SameSite=lax`, 300s,
  `Path=/auth/confirmar-recuperacao`);
- responde `Cache-Control: no-store` e redireciona por **303** para URL limpa;
- não aceita `next`/`redirect_to` — os destinos são constantes do código.

É isso que impede um gateway de segurança de e-mail de queimar a recuperação:
o scanner percorre a rota inteira sem gastar nada.

### 4.2 Server Action de `/auth/confirmar-recuperacao`

Só se chega por POST, disparado por um clique deliberado.

1. lê o `token_hash` **exclusivamente do cookie** — nunca do `FormData`;
2. `verifyOtp({ type: "recovery", token_hash })`, com o `type` fixo no código;
3. valida os claims com `getClaims` e confirma o usuário com `getUser`, exigindo
   `sub === user.id`;
4. consulta a situação do segundo fator;
5. emite a **prova HMAC** amarrada ao `sub` e ao `session_id`;
6. apaga o cookie pendente e grava `bs_recovery_proof`.

Toda falha **posterior** ao `verifyOtp` passa por `falharDepoisDeVerificar()`,
que **tenta** derrubar a sessão recém-criada com `signOut({ scope: "local" })`
antes de redirecionar. Essa forma literal, `if (…) return
falharDepoisDeVerificar()`, é **asseverada por regex** em `test:prova` e
`test:recuperacao`: é o guardrail que impede uma tela dizer "link inválido"
deixando o navegador autenticado. **Não alterar essas quatro linhas sem entender
o que elas garantem.**

**Risco residual conhecido — não afirmar que a sessão é sempre derrubada.** O
helper chama o `signOut` e **descarta o retorno**, sem `try/catch`
(`src/app/auth/confirmar-recuperacao/actions.ts:98-100`). O `signOut` do SDK não
lança em falha de API ou de rede — resolve com `{ error }` —, então uma limpeza
fracassada passa por bem-sucedida. A limpeza é **tentada**, não confirmada.

Isto já era rastreado no checkpoint anterior e **não é defeito novo**. Mitigação
que continua valendo: com o AAL2 exigido no banco, uma sessão residual é AAL1 e
não alcança nenhuma das 11 tabelas de negócio. **Não manipular cookies internos
`sb-*` manualmente** — isso acoplaria a aplicação a detalhe de implementação do
SDK. Investigar e endurecer na **ETAPA 1**.

Para contraste: o mesmo cuidado **já foi aplicado** do outro lado do fluxo. Em
`src/app/redefinir-senha/actions.ts`, `derrubarSessaoLocal()` devolve `boolean` e
o resultado é conferido — foi o que o PR #18 corrigiu. A confirmação não recebeu
o mesmo tratamento.

### 4.3 Desfechos por tipo de conta

**Conta COM MFA** — comprovado em Production:

```
e-mail → link → Continuar → TOTP (uma vez) → nova senha → dashboard DIRETO
```

**Sem segundo login e sem segundo TOTP.**

**Conta SEM MFA:** a arquitetura suporta seguir sem desafio — `decidirMfaNaRecuperacao`
devolve `prosseguir` para `mfa-ausente`. **O E2E dessa variante NÃO foi feito**,
porque hoje só existe o admin real, e ele tem TOTP verificado. Fica para a
matriz da ETAPA 6.

### 4.4 Depois da troca de senha

- a **prova é apagada após uma troca de senha bem-sucedida** — e a partir daí
  nenhum desfecho posterior mantém prova reutilizável, então ela não serve para
  uma segunda troca. **Falhas ANTERIORES ao `updateUser` podem preservá-la**, de
  propósito: entrada inválida, segundo fator recusado ou erro do próprio
  `updateUser` retornam mantendo a prova, o que deixa o usuário corrigir a senha
  e tentar de novo dentro da validade, sem reiniciar a recuperação inteira.
  `apagarProva()` só é chamada depois que o `updateUser` deu certo;
- `signOut({ scope: "others" })` revoga as **outras** refresh sessions;
- a sessão atual só é preservada se, revalidado, continuar sendo **o mesmo
  usuário** e **ainda em AAL2**;
- qualquer incerteza cai em **fallback seguro para o login** — nunca se
  reconstrói sessão;
- **limite conhecido, que já existia antes:** access tokens JWT já emitidos em
  outros dispositivos sobrevivem até expirar. Nenhum escopo de `signOut`
  invalida um JWT emitido. Não é regressão.

A troca de `signOut()` global por `scope: "others"` foi o objeto do PR #18: o
global derrubava a própria sessão que acabara de provar link, prova, TOTP e
AAL2, e cobrava o mesmo TOTP de novo no mesmo processo.

### 4.5 Testes

| Suíte              | Asserções |
| ------------------ | --------- |
| `test:recuperacao` | **72**    |
| `test:prova`       | **143**   |
| `test:troca`       | **119**   |
| `test:mfa`         | **23**    |
| **TOTAL**          | **357**   |

**357 asserções, 0 falhas.** Lint 0 erros (1 warning preexistente em
`painel-apontamentos.tsx:141`) · `tsc --noEmit` PASS · `build` PASS ·
`git diff --check` PASS.

### 4.6 PRs da frente

| PR  | Merge     | O que fez                                       |
| --- | --------- | ----------------------------------------------- |
| #13 | `9822fc3` | arquitetura do fluxo, com o GET que não consome |
| #17 | `e9255c6` | exigir o fator existente antes da troca         |
| #18 | `3b7e0fc` | preservar a sessão AAL2 após a troca            |
| #19 | `3c46b46` | instrumentação temporária de diagnóstico        |
| #20 | `8149a4d` | **remoção completa** da instrumentação          |

`RECOVERY_DIAG_`: **zero ocorrências** na `main` final. O arquivo
`src/app/auth/confirmar-recuperacao/actions.ts` voltou a ser **byte a byte
idêntico** ao estado anterior ao PR #19.

## 5. Incidente não reproduzido — 12/09/2026

Durante o **primeiro** E2E houve uma falha **posterior ao `verifyOtp`** que
redirecionou para `/esqueci-senha?status=link-invalido`. Repetiu com um segundo
link. O PR #19 adicionou instrumentação temporária para separar os quatro ramos
de falha; a tentativa seguinte, em Production, emitiu **`RECOVERY_DIAG_OK`** e o
fluxo completo passou.

**A causa da falha anterior NÃO foi comprovada.**

Ficaram como **pistas, não como causa**:

- falha transitória em alguma etapa posterior ao `verifyOtp`;
- dependência do estado de sessão anterior do navegador — nas tentativas que
  falharam havia uma sessão AAL1 antiga ativa.

O que **ficou provado** no diagnóstico, e vale guardar:

- o `verifyOtp` **conclui**: consome o token e cria sessão. `last_sign_in_at` só
  é escrito dentro da criação do refresh token (GoTrue
  `internal/models/refresh_token.go:205`);
- depois da falha, `falharDepoisDeVerificar()` **chamou**
  `signOut({ scope: "local" })`, e a sessão deixou de aparecer nas consultas
  seguintes. Isso é **consistente** com a limpeza local ter funcionado — mas o
  helper não verifica o `{ error }` retornado (seção 4.2), então **não se pode
  afirmar** que a limpeza foi confirmada em todos os cenários. Consistente não é
  o mesmo que comprovado;
- **não existe incompatibilidade PKCE.** `verifyPost` não tem ramo PKCE —
  `issueAuthCode` vive só em `verifyGet` —, e `{{ .TokenHash }}` renderiza de
  propósito o valor com prefixo `pkce_`, que é exatamente o que
  `FindUserByRecoveryToken` casa. Hipótese levantada e **refutada pelo fonte**;
  não reabri-la.

**Não é bug aberto e não bloqueia nada.** Registrado como incidente não
reproduzido. Só investigar se voltar a acontecer — e, se voltar, o caminho é
reinstrumentar como no PR #19, não adivinhar.

## 6. Nova política de autorização — APROVADA, NÃO IMPLEMENTADA

> **Leia esta seção inteira antes de tocar em guard, policy, RLS ou usuário.**

### 6.1 Política aprovada

**ADMIN**

- MFA **obrigatório**;
- login exige **AAL2**;
- recovery exige TOTP **uma vez**;
- **não** permitir admin operando em AAL1.

**OPERACIONAL**

- MFA **opcional**;
- poderá ativar em **Configurações → Segurança**;
- se ativado, os próximos logins exigem TOTP;
- sem MFA, poderá operar em AAL1 **somente depois** da refatoração explícita das
  policies/RLS e dos guards.

### 6.2 ESTADO ATUAL — o que vale hoje, no código e no banco

**A divisão por papel descrita na seção 6.1 ainda NÃO está implementada.**

As proteções atuais do admin **já existem e permanecem ativas** — MFA
obrigatório, painel exigindo AAL2, um TOTP no recovery e nenhum admin operando
em AAL1. O painel e as 11 tabelas continuam exigindo AAL2.

O que falta implementar é a **exceção segura para o papel `operacional`** e a
**autorização coordenada por papel + AAL**: `operacional` com MFA opcional,
`operacional` em AAL1 nas permissões expressamente autorizadas, o guard e a RLS
cientes de papel, e a tela Configurações → Segurança.

- o guard de `(painel)` **ainda exige AAL2** para qualquer papel;
- **11 tabelas de negócio ainda têm policy RESTRICTIVE global exigindo `aal2`**;
- portanto **um usuário `operacional` em AAL1 ainda NÃO consegue usar o
  sistema** — ele seria barrado pelo guard e, mesmo contornando o guard, pela
  RLS;
- o **PR B1** (migration 013, seção 7.2) acrescentou uma **superfície de RPC**
  para o operador em AAL1, mas **nenhuma policy foi afrouxada** e **a interface
  não a consome**. O quadro acima continua valendo integralmente.

### 6.3 Proibições enquanto a refatoração não acontecer

- **NÃO remover o AAL2 parcialmente.** Derrubar a policy global sem substituição
  segura abre as 11 tabelas para sessões AAL1 — exatamente o P1 que o PR #14
  fechou, e que foi **reproduzido de verdade** em PostgreSQL (22 FAIL / 16 PASS
  antes da migration 009);
- **NÃO criar usuário `operacional` real** antes dessa mudança. Além do AAL2,
  há dívida técnica aberta que só se manifesta quando existir uma conta não-admin
  — ver seção 10 e `docs/SEGURANCA.md`, que registra "condição para reabertura:
  criação da primeira conta não-admin". A parte **financeira** dessa dívida já
  foi fechada pelas migrations `010` e `011` (seção 9); o que resta é a escrita
  permissiva em `operation_team`;
- **NÃO confiar no frontend** para nenhuma parte dessa decisão.

## 7. Próximas etapas oficiais

Com A₀ e A₀.1 fechados (seção 9), a fila volta a ser a autorização. Ela foi
quebrada em três PRs, **nesta ordem obrigatória**:

| PR        | Entrega                                                                                                                                                                                        | Cabe em |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **PR A**  | estado de MFA **verificável no banco** — indicador confiável, não forjável pelo próprio usuário e fail-closed. **IMPLEMENTADO** na migration 012, ainda não em Production. Ver 7.1             | ETAPA 1 |
| **PR B1** | **superfície AAL1 no banco**: atribuição usuário → operação, helpers de autorização e RPCs estreitas, sem afrouxar policy. **IMPLEMENTADO** na migration 013, ainda não em Production. Ver 7.2 | ETAPA 2 |
| **PR B2** | **interface** consumindo a superfície: `queries.ts`, `painel-apontamentos.tsx` e o caminho de login do operador                                                                                | ETAPA 2 |
| **PR C**  | **guard role-aware** no `(painel)`, mais o `nextLevel` e o comentário errado em `_autorizacao.ts`                                                                                              | ETAPA 2 |

**O primeiro usuário `operacional` real só existe depois de todos**, e depois da
matriz E2E da ETAPA 6. PR A é pré-requisito de PR B1: sem um indicador confiável
de MFA no banco, a exceção de AAL1 vira bypass para a conta que optou pelo
segundo fator.

### 7.1 PR A — primitivo de MFA no banco

**Estado: EM PRODUCTION** (PR #25, merge `3ec9242`). Migration
`20260913201030_012_estado_mfa_confiavel.sql` e teste
`supabase/tests/008_estado_mfa.sql`.

**O risco que motivou, medido e não suposto.** O guard chama
`getAuthenticatorAssuranceLevel()` **sem argumento**, e nessa forma o
`@supabase/auth-js` 2.115.0 não fala com o servidor: lê `getSession()` do
cookie e decodifica o JWT. `currentLevel` vem da claim `aal`, que é assinada;
mas `nextLevel` vem de `session.user.factors`, campo do **mesmo cookie, fora da
assinatura**. Reproduzido com o cliente de servidor real, variando só o cookie:

| JWT    | `user.factors` no cookie | `nextLevel` |
| ------ | ------------------------ | ----------- |
| `aal1` | um `verified`            | `aal2`      |
| `aal1` | `[]`                     | **`aal1`**  |

O próprio SDK embrulha esse objeto num proxy que avisa: _"could be insecure!
This value comes directly from the storage medium (usually cookies on the
server) and may not be authentic."_

**Hoje isso não é explorável**, e vale dizer por quê: `nextLevel` forjado para
`aal1` produz `mfa-ausente`, que manda para `/mfa` e **fecha** o painel — a
mentira só nega acesso a quem mente. O risco aparece no PR B, onde "não tem
fator verificado" passa a ser a **condição de concessão** da exceção de AAL1.

**O que o PR A entrega:** `public.mfa_bloqueia_excecao_aal1()` — sem parâmetro,
`RETURNS boolean`, `STABLE`, `SECURITY DEFINER` de `postgres`,
`search_path = pg_catalog, public`, `EXECUTE` só para `authenticated`. Lê
`auth.mfa_factors`, que nega `SELECT` a `anon`, `authenticated` **e**
`service_role`. Responde `true` quando há fator verificado de qualquer
`factor_type`, `true` quando não há sessão, `true` quando o `uid` do JWT não
existe mais em `auth.users`, `false` sem fator ou só com `unverified`, e **deixa
o erro propagar** se a leitura falhar — capturar e devolver `false`
transformaria falha de infraestrutura em concessão silenciosa.

**O caso da conta apagada veio da review e foi reproduzido antes de corrigir.**
`auth.mfa_factors` cascateia com `auth.users`, mas `user_roles` não tem FK para
lá — remoção deixa papel órfão, como `docs/SEGURANCA.md` já registrava. Com um
token AAL1 ainda válido, o PostgREST aceita a assinatura sem consultar o GoTrue,
os fatores já sumiram, e a primeira versão da função respondia `false`: a conta
**apagada** ficaria elegível à exceção que, viva, lhe era negada. Medido no
banco local — `true` antes do `DELETE`, `false` depois — e fechado pelo ramo que
exige a existência do `uid`.

**O que o PR A NÃO faz:** não libera AAL1, não altera nenhuma das 11 policies
`*_exige_aal2`, não consulta papel — `admin` fica fora da exceção tendo fator ou
não, e essa regra pertence ao PR B, não a um primitivo. Nenhuma policy chama a
função ainda.

**Testes:** `008` cobre 25 casos — semântica por estado de fator, isolamento por
`auth.uid()`, conta inexistente e a regressão da conta apagada com token vivo,
os quatro grants, a prova de que `authenticated` não lê a tabela
direto mas obtém a resposta pela função, e a conferência de que as 11 policies
seguem RESTRICTIVE. Escrito **antes** da migration: contra o schema sem a 012 dá
17 FAIL, com os casos semânticos falhando em `42883` (função inexistente); e os
casos K/L, medidos contra a primeira versão da função, davam 3 FAIL — foi essa
falha que documentou o furo da conta apagada.

**Quem usa a função:** o PR B1, por dentro de
`public.operador_elegivel_aal1()` (seção 7.2). Nenhuma **policy** a chama, e
isso continua verdadeiro.

**Pendência registrada para o PR C:** o comentário em
`src/app/(painel)/_autorizacao.ts:47-51` afirma que
`getAuthenticatorAssuranceLevel()` valida o token chamando `getUser(jwt)`. **É
falso** — descreve o ramo `if (jwt)`, que o projeto nunca usa. Não foi corrigido
aqui de propósito, para manter o escopo do PR A.

### 7.2 PR B1 — fundação da superfície operacional AAL1

**Estado: implementado, testado localmente, ainda NÃO em Production.** Migration
`20260918160000_013_superficie_operacional_aal1.sql` e teste
`supabase/tests/009_superficie_operacional.sql`.

**A pergunta que o PR B1 respondeu.** A ETAPA 1 previa "RLS seletiva": afrouxar
a policy de AAL2 para `operacional` e deixar a RLS filtrar. Ao desenhar, isso
não fecha a decisão de produto — **RLS filtra LINHA, não COLUNA**. Uma policy
que devolvesse `operations` ao operador devolveria `agreed_amount` junto;
`employees`, o `daily_cost`; `timesheet_entries`, `billed_amount`,
`cost_amount` e os três snapshots. Proteger coluna exigiria view com
`security_invoker`, grants por coluna e policy nova por tabela — mais superfície,
não menos.

**O que foi construído em vez disso:** uma superfície de **RPC de contrato
fechado**. O que não está no `RETURNS TABLE` não existe para quem chama.

| Objeto                                                           | Papel                                           |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| `public.user_operation_access`                                   | atribuição usuário → operação; só admin em AAL2 |
| `public.operador_elegivel_aal1()`                                | a sessão é operador elegível? (interno)         |
| `public.operador_autorizado(uuid)`                               | ... e tem ESTA operação atribuída? (interno)    |
| `public.listar_operacoes_do_operador()`                          | 7 colunas, com `cliente_nome` e sem `client_id` |
| `public.listar_turnos_do_operador(uuid)`                         | 6 colunas de jornada                            |
| `public.listar_equipe_do_operador(uuid, uuid)`                   | 4 colunas; sem `daily_cost`, `doc` ou `phone`   |
| `public.listar_apontamentos_do_operador(uuid, uuid, date)`       | folha + linhas; `faturado` é boolean derivado   |
| `public.salvar_apontamento_operacional(uuid, uuid, date, jsonb)` | escreve 6 campos por linha; não apaga nada      |

**As seis condições de `operador_elegivel_aal1()`**, todas obrigatórias: `uid`
presente · conta ainda existente em `auth.users` · papel `operacional` · **não**
`admin` · `aal = aal1` · `mfa_bloqueia_excecao_aal1() = false`. É aqui que o PR A
entra em uso — e é o que impede a conta que optou pelo MFA de contornar o
segundo fator por esta porta.

**O que o PR B1 NÃO faz:** não altera nenhuma das 11 policies `*_exige_aal2`,
que seguem RESTRICTIVE e globais; não concede SELECT/UPDATE direto em tabela
nenhuma para AAL1; não cria usuário; não toca em uma linha de frontend, guard,
login ou `/mfa`. **A interface ainda não consome a superfície** — isso é o PR B2.

**Decisões de produto congeladas neste PR** (do enunciado da tarefa):

- do cliente, o operador recebe **somente `cliente_nome`** — nem `client_id`,
  nem documento, telefone ou e-mail;
- **nenhum valor financeiro** atravessa, em nenhuma direção: nem
  `daily_cost`, `daily_rate`, `shift_hours`, `ot_factor`, `ot_tolerance_min`,
  `agreed_amount`, `billed_amount`, `cost_amount`, snapshot, `invoice_id`, nem
  prévia de "a faturar" ou de custo;
- a **migration 010 continua sendo a autoridade financeira**: a RPC de escrita
  não menciona coluna derivada, e o trigger calcula igual ao caminho do admin;
- **admin em AAL2 mantém o comportamento atual**, inclusive `gerar_fatura`.

**Um fail-open real foi encontrado e corrigido antes do merge.** Na primeira
versão, os helpers eram uma cadeia de `AND` sem `coalesce` e as RPCs decidiam com
`IF NOT helper()`. Com um JWT **sem o claim `aal`**, a comparação com `'aal1'` é
NULL, a cadeia inteira devolve NULL, `NOT NULL` é NULL e o `IF` **não dispara**:
um operacional atribuído listou os turnos sem `aal` nenhum. Medido pelo caso A9
do teste `009`. Corrigido em duas camadas — `coalesce(..., false)` no retorno dos
helpers e `IS NOT TRUE` nas cinco RPCs.

**Testes:** `009` cobre **112 casos** — acesso (operacional sem MFA atribuído,
operação alheia, UUID inexistente, `operation_id` nulo, operacional com fator
verificado em aal1 e em aal2, operacional sem MFA em aal2, sem claim `aal`,
admin em aal1 e em aal2, quem acumula admin+operacional, sem papel, anon, conta
apagada com token vivo), contrato (nenhuma coluna proibida na assinatura das
quatro leituras), dados, escrita aceita com derivação conferida contra a 010,
dezesseis vetores de escrita recusada, lastro faturado congelado, o que o PR
**não** relaxou (11 policies, leitura e escrita direta nas tabelas, a própria
`user_operation_access` nos dois papéis e nos dois AAL), privilégios das sete
funções, schema/grants da tabela e a auditoria de camada 2 descrita abaixo.
Escrito **antes** da migration: contra o
schema sem a 013 o arquivo nem monta a fixture —
`relation "public.user_operation_access" does not exist`.

**Auditoria de camada 2 — gate de segurança pedido antes do PR.** Dentro de
qualquer função `SECURITY DEFINER` de `postgres`, `current_user` é `postgres`, e
sete guardas de 010/011 perguntam exatamente isso. Auditado uma a uma, com as
tentativas executadas **no contexto real da RPC** (bloco K do teste `009`):

| Invariante                                       | Por dentro da RPC     |
| ------------------------------------------------ | --------------------- |
| linha faturada imutável                          | **viva** (K7)         |
| `DELETE` de linha faturada                       | **viva** (K8)         |
| desvínculo de fatura                             | **viva** (K6)         |
| folha com apontamento não muda de operação/turno | **viva** (K10)        |
| par operação/turno                               | **viva** (K13)        |
| valor financeiro derivado pelo banco             | **viva** (K1, K2, K4) |
| chave diária sincronizada pela folha             | **viva** (E6)         |
| uma diária por colaborador/operação/dia          | **viva** (K17)        |
| uma alocação ativa por colaborador               | **viva** (K18)        |
| **criar vínculo de fatura**                      | **ausente** (K5)      |
| **mensagem de recusa de coluna financeira**      | **ausente** (K1)      |
| **mover folha vazia**                            | **ausente** (K12)     |
| **colaborador fora da equipe**                   | **ausente** (K14)     |
| **folha fechada**                                | **ausente** (K16)     |

Nenhuma das cinco ausências é alcançável pelo operador hoje: a RPC não escreve
`invoice_id` nem coluna financeira, não faz `UPDATE` em `timesheets`, e a lista
branca de chaves recusa a chamada inteira. As duas últimas nunca foram
invariantes de banco — o admin também aponta quem quiser e escreve em folha
fechada. O risco real é de **edição futura da RPC** perder a rede sem que nada
avise.

**PR B1.1 — owner dedicado (desenhado e provado, não implementado).** A correção
estrutural é as cinco funções pertencerem a um papel próprio, que não seja
`postgres` e portanto não seja isento das guardas. Provado em banco local:
`ALTER FUNCTION ... OWNER TO bslog_rpc_operacional` mantém leitura, escrita e
derivação corretas, e as guardas passam a ver `current_user =
bslog_rpc_operacional`. Requisitos medidos: o papel precisa de `BYPASSRLS` (um
papel com `CREATEROLE + BYPASSRLS` e **sem** superusuário consegue criá-lo em
PG16 — confirmar em Production dentro de `BEGIN … ROLLBACK`), `USAGE` em `auth`
e `SELECT` em `auth.users`, e `UPDATE` em `shifts`/`timesheets` — não para
escrever, mas porque o PostgreSQL cobra privilégio de `UPDATE` para tomar
`FOR SHARE`. Esse último ponto merece refinamento antes de implementar: mover os
dois `FOR SHARE` para helpers `SECURITY DEFINER` de `postgres` evitaria conceder
`UPDATE` em `shifts`.

**Validação local.** PostgreSQL 16.13 com um harness que reproduz o que as
migrations usam do Supabase: papéis (`anon`, `authenticated`, `service_role`,
`supabase_auth_admin`, `authenticator`), schema `auth` (`users`, `mfa_factors`,
`uid()`, `jwt()`) e os DEFAULT PRIVILEGES que o Supabase mantém em `public`.
**Não é o stack do Supabase** — a fidelidade é aferida pelo fato de as **oito
suítes anteriores passarem sem alteração** no mesmo harness. Nada remoto foi
tocado: nenhum `db push`, nenhum `--linked`, nenhuma escrita em Production.

### ETAPA 1 — próxima

**Auditoria e desenho da autorização** por **papel + AAL + RLS + guards**.

Objetivo: permitir `operacional` em AAL1 **apenas onde for expressamente
autorizado**, mantendo admin e ações administrativas em AAL2.

Entrar nesta etapa com estes pontos já mapeados:

- a policy RESTRICTIVE hoje é idêntica nas 11 tabelas e não distingue papel;
- `user_roles` está **de propósito** fora do enforcement AAL2 — bloqueá-la cria
  deadlock login → MFA. Não adicionar;
- função `SECURITY DEFINER` roda **acima** da RLS: a exigência de AAL precisa
  estar escrita dentro da própria função, como em `gerar_fatura`;
- **achado a confirmar:** `getAuthenticatorAssuranceLevel()` do
  `@supabase/auth-js` 2.115.0 tem **dois ramos**. O projeto sempre chama **sem
  argumento**, e esse ramo é **local** — `getSession()` + `decodeJWT`, sem
  chamada de rede. O `nextLevel` sai de `session.user.factors`, que vem do
  armazenamento de sessão. O comentário em
  `src/app/(painel)/_autorizacao.ts:47-49` e o texto de `docs/SEGURANCA.md`
  afirmavam que ela chama `getUser(jwt)` por dentro; isso descreve o **outro**
  ramo. O guard continua validando a sessão, porque chama `getUser()` logo
  antes — mas essa premissa precisa ser reexaminada ao redesenhar a decisão de
  AAL.

#### Requisito de segurança obrigatório — MFA optativo precisa existir na RLS

Levantado em revisão do Codex no PR #21. **É restrição da ETAPA 1, não
sugestão.**

Uma conta que tem **fator verificado** recebe sessão **AAL1** logo após o login
por senha — antes do TOTP. Então, se a futura policy autorizar
`papel = operacional AND aal = aal1`, ela **não consegue distinguir**:

|         |                                                                            |
| ------- | -------------------------------------------------------------------------- |
| **(A)** | `operacional` que **nunca ativou** MFA                                     |
| **(B)** | `operacional` **com MFA verificado** que ainda não fez o TOTP nesta sessão |

O guard mandaria **(B)** para `/mfa`, mas o token AAL1 dele continuaria podendo
tentar **PostgREST/RPC direto**. A obrigação de MFA viraria **guard-only** — o
que a arquitetura deste projeto proíbe.

**O que a ETAPA 1 precisa garantir:**

- `operacional` **sem** MFA pode futuramente receber os acessos AAL1
  expressamente autorizados;
- `operacional` **com MFA verificado NÃO** pode usar esses mesmos acessos apenas
  com AAL1 depois de um login por senha;
- a decisão precisa ser **enforceable no banco**, não só no guard;
- **papel + claim `aal` sozinhos NÃO bastam** para separar (A) de (B);
- é preciso definir uma **fonte de verdade da inscrição em MFA verificável pelo
  banco**, ou mecanismo de segurança equivalente;
- essa fonte **não pode ser controlável pelo próprio usuário** por `UPDATE`
  comum.

**A solução NÃO está escolhida.** Tabela própria sincronizada, consulta segura
ao estado de fatores, claim confiável, função `SECURITY DEFINER` ou outro
mecanismo — tudo isso fica para a auditoria da ETAPA 1, depois de avaliar
segurança, sincronização, revogação e impossibilidade de spoofing. **Este
checkpoint registra o REQUISITO, não inventa a solução.**

### ETAPA 2

Implementar **migrations / policies / guards** da nova política.

**Testes reais de RLS obrigatórios**, exercitados no banco — não no guard:

| Cenário                                     | Esperado                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| `operacional` **sem** MFA + AAL1            | permite **somente** os acessos explicitamente autorizados      |
| `operacional` **com MFA verificado** + AAL1 | **bloqueia** os dados que exigem o segundo fator daquela conta |
| `operacional` **com MFA verificado** + AAL2 | permite conforme o papel                                       |
| `admin` + AAL1                              | **bloqueia**                                                   |
| `admin` + AAL2                              | permite conforme o papel                                       |

A segunda linha é a que prova o requisito da ETAPA 1. Sem ela, a exigência de
MFA para quem optou por ele fica só no guard.

### ETAPA 3

**Backend administrativo de usuários:** listar · convidar por e-mail · atribuir
papel · alterar papel · remover acesso · **impedir remoção ou rebaixamento do
último admin** · auditoria.

Operações privilegiadas **exclusivamente server-side**.

### ETAPA 4

Tela **`/usuarios`**, somente para admin.

### ETAPA 5

**Configurações → Segurança:** estado do MFA · `operacional` pode ativar · admin
permanece obrigatório · política de desativação protegida **no backend**.

### ETAPA 6

**Matriz E2E completa** antes do segundo usuário real — incluindo a variante de
recovery **sem MFA**, que ainda não foi exercitada (seção 4.3).

## 8. AAL2 / RLS — estado em vigor

**PR #14 mergeado** em 2026-09-11, merge `359dd905bf47ad213968e0f50e0ea198db93866f`.
**Migration `20260911140000_009_enforce_aal2.sql` aplicada em Production.**

**Problema que resolveu (P1):** MFA era aplicado só na aplicação. Sessão AAL1 com
papel válido alcançava os dados por PostgREST/RPC.

**11 tabelas protegidas:** `profiles` · `clients` · `contracts` · `employees` ·
`operations` · `shifts` · `operation_team` · `timesheets` · `timesheet_entries` ·
`invoices` · `invoice_items`.

Forma da policy, idêntica nas 11:

```sql
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');
```

Fail-closed sem `COALESCE`: `->>` devolve `NULL` com o claim ausente,
`NULL = 'aal2'` é `NULL`, e a RLS trata `NULL` como não-permitido.

`user_roles` fica **deliberadamente sem** enforcement AAL2 — é consultada antes
do MFA em `src/app/(painel)/_autorizacao.ts`, e bloqueá-la causaria deadlock.

`gerar_fatura` continua `SECURITY DEFINER`, mesma assinatura, mesmo
`search_path`, mesmos grants, com check explícito de `aal2` **antes** da
verificação de papel — porque policy RESTRICTIVE não protege função que roda
acima da RLS.

### Validação local, com a vulnerabilidade reproduzida

Docker + WSL2 · Supabase CLI **2.117.0** · PostgreSQL local **17.6.1.166**.
Nenhum comando remoto, nenhum `db push`, nenhum `--linked`. **Production não foi
tocada** — o `db reset` reportou `{"target":"local"}`.

Antes da 009, o teste `005` dava **22 FAIL / 16 PASS**: admin AAL1 lia `clients`,
`employees`, `invoices` e `profiles`, escrevia em `clients`; `operacional` AAL1
lia e escrevia `timesheet_entries`; sem claim `aal` tudo passava; `gerar_fatura`
funcionava em AAL1. Depois da 009: **`005` 38/38 PASS**, e `001` a `004` PASS.

### Verificação em Production — 2026-09-11

Registro **daquela data**, preservado como está. As contagens de migration e de
policy mudaram depois, com a `010` e a `011` — o estado atual é o da seção 9.

15 migrations local / 15 remoto, 0 pendentes · 11 policies `*_exige_aal2`, todas
RESTRICTIVE/`ALL`/`authenticated` · `USING` e `WITH CHECK` com `aal2` nas 11 ·
**0** em `user_roles` · 19 policies permissivas antigas intactas (30 no total) ·
RLS **12/12** tabelas · `md5` normalizado de `prosrc` de `gerar_fatura` idêntico
ao arquivo da 009.

Testes remotos não destrutivos em `BEGIN … ROLLBACK`, só leitura, com claims
simulados: sobre `profiles`, `aal1` → 0 linhas, claim ausente → 0 linhas,
`aal2` → 1 linha, `user_roles` com `aal1` → 1 linha (sem deadlock).
`gerar_fatura` em AAL1 → **42501** antes de qualquer efeito de negócio.

### Smoke manual em Production — APROVADO

Login com senha funcionou; **antes do TOTP o painel não foi liberado**; TOTP
funcionou; o painel carregou; F5 e nova aba preservaram a sessão; logout
funcionou; novo login voltou a exigir TOTP.

## 9. Proteção financeira no banco — A₀ e A₀.1, EM PRODUCTION

**Estado: CONCLUÍDO e implantado.** PR #22 (`83ed1f3`) e PR #23 (`c019e42`)
mergeados com merge commit; migrations `010` e `011` aplicadas em Production em
**13/09/2026**, por `supabase db push --linked`, depois de pre-flight read-only.

### 9.1 A₀ — `010_derivar_valores_financeiros`

**Problema que fecha:** o valor financeiro chegava pronto no payload do
navegador. `billed_amount`, `cost_amount` e os snapshots eram o que o cliente
mandasse — a RLS deixava passar porque a policy era `ALL` sobre a linha inteira.

**Como foi resolvido:** em vez de proibir a escrita coluna a coluna, o banco
passou a **derivar**. Um trigger `BEFORE INSERT OR UPDATE` recalcula os valores
a partir de contrato, operação, turno e colaborador. A operação que decide o
cálculo é lida da folha (`SELECT t.operation_id INTO _operation_id`), nunca do
payload.

**O desfecho não é o mesmo em toda operação**, e a distinção importa para quem
trata erro:

| Operação                                       | O que acontece                                           |
| ---------------------------------------------- | -------------------------------------------------------- |
| `INSERT`                                       | a derivação **sobrescreve** o payload                    |
| `UPDATE` mexendo **apenas** em campo derivado  | **recusado**, `SQLSTATE 42501`                           |
| `UPDATE` que altera coluna **motriz**          | **recalcula** a partir das fontes atuais                 |
| `UPDATE` aceito que **não** toca coluna motriz | **preserva** os valores gravados; o payload é descartado |

**Motrizes são seis:** `status`, `check_in`, `check_out`, `break_minutes`,
`employee_id`, `timesheet_id`. `operation_id` e `work_date` ficaram de fora **de
propósito** — nenhum dos dois entra no cálculo, e incluí-los daria ao cliente um
jeito de forçar recálculo, e com ele a troca de um snapshot congelado, só
mandando qualquer valor nessas colunas.

A quarta linha é o caso comum, e é o oposto de recalcular: editar `notes`
reenviando valores divergentes preserva `worked_minutes`, `overtime_minutes`, os
três snapshots, `billed_amount` e `cost_amount` de `OLD` — provado pelos casos
C2b e C2c da `006`. É também o que faz o `UPDATE ... SET invoice_id` do
`gerar_fatura` não recalcular nada com as taxas de hoje.

A recusa vem de `bloquear_edicao_financeira()`, e ela roda **antes** da
derivação porque gatilho `BEFORE` de linha dispara em ordem alfabética:
`trg_timesheet_entries_bloqueio_financeiro` precede
`trg_timesheet_entries_calculo_financeiro`. `postgres` e `service_role` são
isentos **desse bloqueio específico** — não das proteções da 011, das quais
várias não abrem exceção para papel nenhum.

**Objetos:** 2 funções · 2 triggers · **5 CHECK** de não-negatividade em
`contracts`, `employees` e `operations`.

`src/lib/billing.ts` continua existindo e continua correto — serve para a
interface mostrar o número antes de salvar. **Deixou de ser autoridade.**

**A paridade entre as duas implementações é conferida à mão.**
`supabase/tests/006_valores_financeiros.sql` guarda expectativas cujos números
saíram de uma execução anterior do `calcEntry()` e hoje estão gravados como
**constantes** — o teste não roda as duas implementações lado a lado. Se o
`calcEntry()` mudar, a paridade precisa ser revista explicitamente. Ver a dívida
registrada na seção 10.

### 9.2 A₀.1 — `011_proteger_fontes_financeiras`

**Problema que fecha:** derivar o valor não bastava. A **fonte** do cálculo
continuava editável e apagável depois do faturamento, e o histórico faturado
podia ser desfeito por vários caminhos.

**O que passou a ser garantido:**

- **linha faturada é imutável** — `UPDATE` e `DELETE` recusados em
  `timesheet_entries` com `invoice_id`, **inclusive o `SET NULL`** que a FK
  emitiria ao apagar a fatura, e inclusive a troca de uma fatura por outra. A
  comparação é da **linha inteira** (`to_jsonb(OLD) - 'updated_at'`), não de uma
  lista de colunas, para que uma coluna nova no futuro nasça protegida;
- **o vínculo de fatura exige execução como `postgres`** — é o contexto em que
  `gerar_fatura` roda, medido por `current_user`. Recusa `authenticated`, **admin
  incluído**, e `service_role`. O gatilho **não distingue** `gerar_fatura` de um
  `INSERT`/`UPDATE` manual numa sessão `postgres`: a fronteira protegida é a API
  da aplicação, não o banco contra quem já é seu dono;
- **fontes não se apagam, com três critérios distintos** — cliente com fatura ou
  apontamento faturado; turno referenciado por **alguma folha** (só
  `operation_team` não basta); e contrato **atualmente referenciado** por
  operação que tenha apontamento. Os dois últimos valem **mesmo em rascunho**, de
  propósito: as FKs são `ON DELETE SET NULL` e o rascunho vira fatura depois.
  **Atenção ao "atualmente":** o gatilho do contrato junta por
  `o.contract_id = OLD.id`, o valor corrente. Se um admin remapear o
  `contract_id` da operação, o contrato **de origem** — aquele de onde a diária
  faturada realmente saiu — passa a ser apagável, e o contrato recém-atribuído
  passa a ser protegido sem que nada tenha derivado dele. É a mesma lacuna de
  proveniência do item abaixo;
- **o que congela como valor, com faturamento, é menos do que "a fonte
  inteira"** — e a lista exata importa. Congelam, sem exceção de papel:
  `operations.client_id`; `work_date`, `operation_id` e `shift_id` da folha; e a
  própria linha do apontamento. Mover `operation_id`/`shift_id` de folha é
  recusado com **qualquer** apontamento, faturado ou não; `work_date` só com
  faturado;
- **NÃO congelam, nem com histórico faturado:** `operations.contract_id` e
  `operations.agreed_amount`, porque `bloquear_fontes_operacao()` **isenta
  admin**; as taxas do contrato (`daily_rate`, `shift_hours`, `ot_factor`,
  `ot_tolerance_min`), porque **não existe gatilho de `UPDATE` em `contracts`**;
  `employees.daily_cost`, pelo mesmo motivo; e a jornada do turno, que também
  isenta admin. **O dinheiro já faturado não muda** — a entry está congelada e
  seus snapshots com ela —, mas a **proveniência** se perde: a operação passa a
  apontar para um contrato diferente daquele de onde a diária cobrada saiu, sem
  rastro na linha. Ver a dívida registrada na seção 10;
- **invariante do par** operação × turno, em `timesheets` e `operation_team`,
  lida do `SELECT` travado e não do payload;
- **fatura com lastro vinculado congela**, e seus itens recusam `INSERT`,
  `UPDATE` e `DELETE` — inclusive mover um item para outra fatura. O critério é
  ter apontamento vinculado, não a coluna `status`;
- **`TRUNCATE` fechado como classe, nas tabelas de negócio** — revogado de
  `anon`, `authenticated` e `service_role` **nas 10 tabelas listadas**, mais
  `ALTER DEFAULT PRIVILEGES ... REVOKE TRUNCATE ... FROM service_role`, que
  corrige a origem do privilégio **para tabelas futuras** — não mexe em grant
  existente. Por isso `profiles` e `user_roles` **continuam** com `TRUNCATE`
  para `service_role`: não estavam na lista da `011`. Medido em Production em
  13/09/2026 — `anon` e `authenticated` com **0 nas 12**; `service_role` com
  **0 nas 10** de negócio e **1 em cada** das duas de identidade. Os gatilhos
  `BEFORE TRUNCATE` em `timesheet_entries` e `invoice_items` são **condicionais
  ao estado**: recusam enquanto existir apontamento faturado, e disparam também
  quando a tabela é alcançada por `CASCADE`, que é o que cobre o `TRUNCATE` de
  `clients`, `operations`, `timesheets` e `invoices`.

**Objetos:** 20 funções · 21 triggers · 8 policies novas (substituindo
`operations_staff` e `shifts_staff`) · 4 índices para as consultas das guardas ·
82 `REVOKE` · 1 `ALTER DEFAULT PRIVILEGES`.

**Nove rodadas de review do Codex**, 18 achados numerados, cada um reproduzido
localmente **antes** da correção — teste que falha primeiro, migration depois.
Cinco corridas de concorrência foram fechadas com **duas sessões `psql` reais**,
nos dois sentidos. O teste `supabase/tests/007_fontes_financeiras.sql` cresceu
para **139 casos**.

### 9.3 Validação em Production — 13/09/2026

Pre-flight read-only antes de aplicar: zero drift, zero violação de invariante,
zero violação dos 5 CHECK, nenhuma das 22 funções já existente, nenhuma colisão
de nome de policy, índice ou constraint. **Nenhum DML de dados nas duas
migrations** — puro DDL, sem backfill.

Depois de aplicar, conferido no banco:

| Verificação                                   | Esperado | Encontrado |
| --------------------------------------------- | -------- | ---------- |
| migrations remotas                            | 17       | **17**     |
| migrations pendentes                          | 0        | **0**      |
| funções da 011                                | 20       | **20**     |
| triggers da 011                               | 21       | **21**     |
| policies novas                                | 8        | **8**      |
| `operations_staff` / `shifts_staff` removidas | 0        | **0**      |
| índices novos                                 | 4        | **4**      |
| CHECK da 010                                  | 5        | **5**      |
| `service_role` com `TRUNCATE`                 | 0/10     | **0/10**   |
| `anon` + `authenticated` com `TRUNCATE`       | 0        | **0**      |
| policies `*_exige_aal2` RESTRICTIVE           | 11       | **11**     |
| violações de invariante                       | 0        | **0**      |

Smoke de schema: `SELECT` com projeção de linha inteira nas 10 tabelas, todas
sem erro. **Nenhuma fixture foi inserida em Production**; as 10 tabelas de
negócio seguem com 0 linhas e só a conta admin existe. **Nenhum rollback
executado** — o plano permanece só como contingência.

### 9.4 Por que a janela era esta

Aplicar com as tabelas vazias foi deliberado. Os 5 `ADD CONSTRAINT CHECK` e os
4 `CREATE INDEX` — que não podem ser `CONCURRENTLY`, porque migration roda em
transação — varreriam e travariam tabelas populadas. Com zero linhas, o custo
foi nulo. Adiar teria encarecido o mesmo deploy.

**Mudança de comportamento, não de dado:** criar operação e turno passou a ser
**admin-only**, e `service_role` perdeu `TRUNCATE`. Sem dados e com um único
admin, nada quebrou — mas é o tipo de coisa que aparece quando o primeiro
`operacional` existir.

## 10. Achados menores registrados

**P3 —** `sincronizar_chave_da_diaria` pode retornar `23503` "Folha não
encontrada" numa tentativa AAL1, antes do `WITH CHECK`. O trigger é
`SECURITY INVOKER` e lê `timesheets`, que a policy nova esconde em AAL1.
**A operação continua bloqueada** — é problema de diagnóstico, **não bypass**.

**P3 —** mensagens cruas do SDK em `src/app/mfa/painel-mfa.tsx`.

**P3 —** diagnosticabilidade da confirmação de recuperação: sete desfechos
distintos colapsam na mesma mensagem `link-invalido`. Foi isso que escondeu a
causa no incidente da seção 5. Separá-los exigiria mudar mensagens e destinos —
tarefa própria, com escopo próprio.

**Dívida técnica que só se manifesta com conta não-admin — FECHADA na parte
financeira.** As tabelas operacionais aceitavam qualquer coluna do payload,
incluindo `billed_amount`, `cost_amount` e `invoice_id` em `timesheet_entries`.
As migrations `010` e `011` fecharam isso (seção 9): os valores passaram a ser
derivados — sobrescritos no `INSERT`, e a edição puramente financeira **recusada
com `42501`** no `UPDATE` — e o vínculo de fatura passou a exigir execução como
`postgres`, o contexto de `gerar_fatura`, recusando `authenticated` e
`service_role`.
**Continua aberto** o que não é financeiro:
`docs/divida-tecnica/escrita-em-operation-team.md` — qualquer `is_staff()` ainda
inclui, altera e remove alocação, e a tabela não guarda autor nem histórico. É
decisão de negócio, não de migration, e a `011` não a mudou: o que a `011` passou
a exigir ali é só a **invariante do par** operação × turno.

**Resíduo de CLI —** `supabase/.branches/` reaparece a cada operação local e não
está no `.gitignore`.

**Production praticamente vazia de dados de negócio.** Conferido em 12/09/2026:
`auth.users` = 1, `profiles` = 1, `user_roles` = 1; as 10 tabelas de negócio com
**0 linhas**. Não é defeito, mas **limita o que qualquer teste em Production
prova**: num banco vazio, "AAL1 leu 0 linhas" não distingue bloqueio de ausência
de dado. Foi por isso que a prova do enforcement se apoiou em `profiles`.

**Dívida nova — proveniência da taxa faturada não é preservada.** Com
apontamento já faturado, um **admin** ainda altera `operations.contract_id` e
`agreed_amount` — `bloquear_fontes_operacao()` isenta admin — e altera as taxas
do próprio contrato, porque **não existe gatilho de `UPDATE` em `contracts`**; o
mesmo vale para `employees.daily_cost`. **O valor já cobrado não muda**, porque a
entry faturada está congelada e carrega os snapshots. O que se perde é a
resposta para "de qual contrato, e com que taxa, saiu esta fatura": a operação
passa a apontar para outro contrato e nada na linha registra a troca. É a mesma
silhueta do ataque de `client_id` que a `011` fechou, sobrando pelo caminho do
admin.

O remapeamento tem um **segundo efeito**, notado na review: como
`bloquear_delete_contrato_usado()` junta pelo `contract_id` corrente, remapear
libera o `DELETE` do contrato **de origem** e passa a proteger o recém-atribuído.
Ou seja, o contrato que produziu a diária cobrada pode ser apagado depois da
troca.

Fechar isso é migration própria — congelar `contract_id`/`agreed_amount` quando
a operação tiver apontamento faturado, e decidir se as taxas do contrato viram
imutáveis ou versionadas. **Decisão de desenho, não correção mecânica:** hoje
admin edita contrato legitimamente para valer daqui pra frente, e um congelamento
ingênuo quebraria esse fluxo. Levantado na review do PR #24.

**Dívida nova — automatizar o teste diferencial `calcEntry()` × derivação SQL.**
`src/lib/billing.ts` e o trigger da `010` implementam a mesma regra duas vezes,
e hoje **nada no repositório prova que continuam iguais**. As expectativas de
`supabase/tests/006_valores_financeiros.sql` saíram de uma execução do
`calcEntry()` e estão gravadas como **constantes**; o teste não executa as duas
implementações sobre a mesma entrada. Se o `calcEntry()` mudar sem que alguém
atualize as constantes à mão, a divergência passa despercebida — a interface
prevê um número e o banco grava outro.

O diferencial de 12 casos rodado durante o PR #23 foi **validação pontual de
desenvolvimento**, não ficou no repositório e **não é cobertura permanente**.
Automatizar isso é tarefa própria, com escopo próprio. Enquanto não existir,
**toda mudança em `calcEntry()` exige revisar a paridade explicitamente.**

**Otimização da tela de login — guardada fora do Git.** Existe, **na máquina de
desenvolvimento**, um stash local com a mensagem
`login-optimization-before-pr23-round4`: `<main>` como landmark, logo
dimensionada, fontes do Google auto-hospedadas por `next/font/google` e
prioridade de LCP. Foi guardada para não entrar no PR #23 e **ainda não foi
retomada** — não tem branch nem PR.

**Esse estado não é versionado.** Não existe num clone novo e não se recupera
pelo repositório; some com a máquina. O índice `stash@{N}` é **transitório** —
qualquer `git stash` novo desloca a numeração —, então localizar pela **mensagem**,
nunca pelo índice. Ao retomar, aplicar em branch própria. SEO segue
intencionalmente bloqueado (`noindex` + `robots`): é painel interno, não mexer.

**Pendências antigas ainda abertas:**

- decidir sobre Vercel Preview Deployments (P3);
- `auth.sms.twilio.enabled = true` no remoto com `external.phone = false` —
  conferir origem numa passagem pelo Dashboard;
- `docs/ESTADO_DO_PROJETO.md` está obsoleto (fotografia de 04/09/2026);
- `docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` continua
  **OBSOLETO/HISTÓRICO**. A dívida que ele descreve foi **fechada**: pelo
  trigger de 09/09 e, em definitivo, pela migration `011`. O cabeçalho do
  arquivo registra a resolução, mas o **corpo não foi atualizado** e ainda
  descreve o mundo anterior — a isenção de `service_role` no vínculo, uma
  contagem de usuários que não vale mais, e uma "Direção da correção" que a
  `011` substituiu por outro desenho. **Não usar esse arquivo como
  especificação para implementação futura.** A fonte de verdade do
  comportamento atual é a seção 9 deste arquivo, mais `docs/SEGURANCA.md` e
  `docs/ARQUITETURA.md`. Reescrevê-lo é tarefa própria, não dívida nova.

## 11. Não fazer

- Não reconstruir o Supabase de novo.
- Não reaplicar migrations já aplicadas — Production tem **18 aplicadas**, e a
  **013 do PR B1 ainda não foi implantada**.
- **Não afrouxar as proteções de `010`/`011`** (seção 9): não devolver
  autoridade de cálculo ao payload, não reabrir `UPDATE`/`DELETE` de linha
  faturada, não devolver `TRUNCATE` a `anon`, `authenticated` ou `service_role`.
- Não usar `supabase config push`.
- Não ativar signup público.
- Não expor `service_role`, nem colocar segredo em `NEXT_PUBLIC_*`.
- Não conectar Preview ao banco de produção só para passar o check.
- Não modificar DNS sem confirmação.
- Não adicionar enforcement AAL2 em `user_roles`.
- **Não remover a policy AAL2 global sem substituição segura** (seção 6.3).
- **Não criar usuário `operacional` real** antes dos PRs A, B1, B2 e C e da
  matriz E2E da ETAPA 6 (seções 6.3 e 7).
- **Não afrouxar a superfície do PR B1** (seção 7.2): não acrescentar coluna
  financeira, `client_id`, documento ou telefone ao retorno das RPCs; não
  aceitar campo novo no JSON da escrita sem decisão de produto; não criar RPC de
  exclusão; não conceder `EXECUTE` dos helpers a `authenticated`; não abrir
  `user_operation_access` a quem não é admin em AAL2.
- Não alterar as quatro linhas `if (…) return falharDepoisDeVerificar()` sem
  entender o guardrail que elas sustentam (seção 4.2).
- Não reabrir a hipótese PKCE do recovery — foi refutada pelo fonte (seção 5).
- Não tocar no site institucional.

## 12. Como retomar após `/clear`

1. leia `CLAUDE.md`;
2. leia este arquivo — em especial a **seção 6**, antes de qualquer mudança de
   autorização;
3. confira `git status` e HEAD;
4. não reaudite todo o projeto sem necessidade;
5. continue da seção **7 — Próximas etapas oficiais**: o **PR A** está em
   Production, o **PR B1** está implementado e pendente de deploy, e o próximo
   passo é o **PR B2** (interface consumindo a superfície);
6. se o estado real divergir deste checkpoint, **pare e reporte**.
