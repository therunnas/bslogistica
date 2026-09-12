# BS Logística — Project Checkpoint

Checkpoint dinâmico. Regras permanentes ficam em [CLAUDE.md](CLAUDE.md).

## 1. Checkpoint

| Item          | Valor                                      |
| ------------- | ------------------------------------------ |
| Data          | 2026-09-12                                 |
| Branch atual  | `docs/checkpoint-auth-users-policy`        |
| `main`        | `8149a4de60240af115bd3e9cc29160af230c7755` |
| `origin/main` | `8149a4d` — idêntico ao `main` local       |
| Production    | **verde** no commit `8149a4d`              |

**A frente de recuperação de senha está CONCLUÍDA**, em Production, validada por
E2E real e sem resíduo de diagnóstico no código.

| Frente            | Merge     | Estado                                |
| ----------------- | --------- | ------------------------------------- |
| Enforcement AAL2  | `359dd90` | **CONCLUÍDO** — PR #14, em Production |
| Password recovery | `8149a4d` | **CONCLUÍDO** — PRs #13, #17 a #20    |

O próximo trabalho é a **nova política de autorização** (seção 7). Ela está
**aprovada e ainda não implementada** — leia a seção 6 antes de tocar em guard,
policy ou usuário.

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
- a sessão some depois porque `falharDepoisDeVerificar()` chama
  `signOut({ scope: "local" })`, que **apaga a sessão no servidor**;
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
  RLS.

### 6.3 Proibições enquanto a refatoração não acontecer

- **NÃO remover o AAL2 parcialmente.** Derrubar a policy global sem substituição
  segura abre as 11 tabelas para sessões AAL1 — exatamente o P1 que o PR #14
  fechou, e que foi **reproduzido de verdade** em PostgreSQL (22 FAIL / 16 PASS
  antes da migration 009);
- **NÃO criar usuário `operacional` real** antes dessa mudança. Além do AAL2,
  há dívida técnica aberta que só se manifesta quando existir uma conta não-admin
  — ver seção 9 e `docs/SEGURANCA.md`, que registra "condição para reabertura:
  criação da primeira conta não-admin";
- **NÃO confiar no frontend** para nenhuma parte dessa decisão.

## 7. Próximas etapas oficiais

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

### ETAPA 2

Implementar **migrations / policies / guards** da nova política.

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

## 9. Achados menores registrados

**P3 —** `sincronizar_chave_da_diaria` pode retornar `23503` "Folha não
encontrada" numa tentativa AAL1, antes do `WITH CHECK`. O trigger é
`SECURITY INVOKER` e lê `timesheets`, que a policy nova esconde em AAL1.
**A operação continua bloqueada** — é problema de diagnóstico, **não bypass**.

**P3 —** mensagens cruas do SDK em `src/app/mfa/painel-mfa.tsx`.

**P3 —** diagnosticabilidade da confirmação de recuperação: sete desfechos
distintos colapsam na mesma mensagem `link-invalido`. Foi isso que escondeu a
causa no incidente da seção 5. Separá-los exigiria mudar mensagens e destinos —
tarefa própria, com escopo próprio.

**Dívida técnica que só se manifesta com conta não-admin:**
`docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` e
`docs/divida-tecnica/escrita-em-operation-team.md`. As tabelas operacionais
aceitam qualquer coluna do payload — incluindo `billed_amount`, `cost_amount` e
`invoice_id` em `timesheet_entries`. **Fechar antes da ETAPA 3.**

**Resíduo de CLI —** `supabase/.branches/` reaparece a cada operação local e não
está no `.gitignore`.

**Production praticamente vazia de dados de negócio.** Conferido em 12/09/2026:
`auth.users` = 1, `profiles` = 1, `user_roles` = 1; as 10 tabelas de negócio com
**0 linhas**. Não é defeito, mas **limita o que qualquer teste em Production
prova**: num banco vazio, "AAL1 leu 0 linhas" não distingue bloqueio de ausência
de dado. Foi por isso que a prova do enforcement se apoiou em `profiles`.

**Pendências antigas ainda abertas:**

- decidir sobre Vercel Preview Deployments (P3);
- `auth.sms.twilio.enabled = true` no remoto com `external.phone = false` —
  conferir origem numa passagem pelo Dashboard;
- `docs/ESTADO_DO_PROJETO.md` e
  `docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` estão obsoletos.

## 10. Não fazer

- Não reconstruir o Supabase de novo.
- Não reaplicar migrations já aplicadas, nem a 009 — já está em Production (15/15).
- Não usar `supabase config push`.
- Não ativar signup público.
- Não expor `service_role`, nem colocar segredo em `NEXT_PUBLIC_*`.
- Não conectar Preview ao banco de produção só para passar o check.
- Não modificar DNS sem confirmação.
- Não adicionar enforcement AAL2 em `user_roles`.
- **Não remover a policy AAL2 global sem substituição segura** (seção 6.3).
- **Não criar usuário `operacional` real** antes da ETAPA 2 (seção 6.3).
- Não alterar as quatro linhas `if (…) return falharDepoisDeVerificar()` sem
  entender o guardrail que elas sustentam (seção 4.2).
- Não reabrir a hipótese PKCE do recovery — foi refutada pelo fonte (seção 5).
- Não tocar no site institucional.

## 11. Como retomar após `/clear`

1. leia `CLAUDE.md`;
2. leia este arquivo — em especial a **seção 6**, antes de qualquer mudança de
   autorização;
3. confira `git status` e HEAD;
4. não reaudite todo o projeto sem necessidade;
5. continue da seção **7 — Próximas etapas oficiais**, pela ETAPA 1;
6. se o estado real divergir deste checkpoint, **pare e reporte**.
