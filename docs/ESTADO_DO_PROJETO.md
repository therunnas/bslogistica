# Estado do projeto

Fotografia em **28/09/2026**. Este documento descreve o **estado atual**; o
detalhe operacional e o próximo passo ficam em [PROGRESS.md](../PROGRESS.md),
que é atualizado com mais frequência. Onde os dois divergirem, o `PROGRESS.md`
vence.

A fotografia anterior, de 04/09/2026, descrevia um projeto **ainda não
publicado**, com o PR #1 aberto e sete migrations. Nada daquilo vale mais — o
histórico correspondente está preservado no `PROGRESS.md` e no `SEGURANCA.md`.

## Em uma linha

Sistema **publicado e em uso**, com um único usuário real (o administrador). A
autorização por papel está **implementada de ponta a ponta**: guard role-aware
no servidor (**PR C**), superfície de RPC estreita para o operador em AAL1 e
AAL2 (`013`/`015`) já **consumida pela interface operacional** (tela
`/operacional`, PR B2.3), e a **`016`** fecha o acesso direto às dez tabelas de
negócio pelo PostgREST, que antes bastava estar `authenticated` em AAL2 para
alcançar — agora exige **`admin` + `aal2`**. O **PR D** está **concluído**: o
backend administrativo de usuários existe (`src/lib/admin-usuarios/`),
exclusivamente server-side, com a migration **`017`** (`admin_audit_log` e a
proteção do último admin serializada por `pg_advisory_xact_lock`) já **em
Production**. Ainda não existe conta `operacional` real: falta a tela
`/usuarios` (**PR E**, etapa atual), a ativação de MFA pelo próprio operador
(**PR F**) e a matriz E2E (**PR G**) — ver [PROGRESS.md](../PROGRESS.md).

## Arquitetura

**Next.js é a arquitetura definitiva.** TanStack Start, TanStack Router, Vite,
Nitro e as integrações com o Lovable foram removidos do repositório.

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth e RLS) · TanStack Query · npm · Vercel.
Node ≥ 20.9.

`@tanstack/react-query` permanece: é a camada de dados da aplicação e não tem
relação com o TanStack Router.

## Production

| Item             | Estado                                                     |
| ---------------- | ---------------------------------------------------------- |
| Aplicação        | **publicada** em `admin.bslogisticas.com.br`               |
| Deploy           | Vercel, projeto `bs-logistica-sistema`, a partir de `main` |
| Supabase         | `ehkduqokntemtmqzdrbd`                                     |
| Migrations       | **23 locais = 23 remotas**, zero pendentes                 |
| Usuários reais   | **um**: o administrador, com TOTP verificado               |
| Cadastro público | bloqueado (`disable_signup = true`)                        |

**Preview da Vercel falha de propósito** e isso não é defeito: ela não tem as
variáveis `NEXT_PUBLIC_SUPABASE_*`, e conectá-la ao banco de produção para
deixar o check verde está proibido.

## Módulos da interface

Sete telas administrativas, todas exigindo **AAL2** e papel `admin`:

| Módulo               | Situação |
| -------------------- | -------- |
| Dashboard            | ✅       |
| Clientes e contratos | ✅       |
| Colaboradores        | ✅       |
| Operações            | ✅       |
| Apontamentos         | ✅       |
| Faturamento          | ✅       |
| Relatórios           | ✅       |

Mais landing, login, segundo fator, recuperação de senha, layout protegido,
logout e renovação de sessão.

### Área operacional — consumida desde o PR B2.3

Existe uma **segunda área**, separada, para o papel `operacional`: a tela
`/operacional` (um único item de navegação, "Apontamentos"), que fala
**exclusivamente** com as cinco RPCs da `013`/`015` — nunca com as tabelas de
negócio direto. Fluxo: operação atribuída → turno → data → equipe →
apontamentos → salvar. Sem `billed_amount`, `cost_amount`, `daily_cost`,
`daily_rate`, `agreed_amount`, `invoice_id`, contratos ou qualquer prévia
financeira — "faturado" chega como booleano derivado. O guard `exigirOperacional()`
bloqueia administrador, e o guard role-aware do **PR C** decide, no servidor,
quem entra em AAL1 e quem precisa de TOTP primeiro. Detalhe completo na seção
7.3 do [PROGRESS.md](../PROGRESS.md).

**Ainda não existe conta `operacional` real usando essa tela em Production** —
ver "Próximo passo", abaixo.

### Backend administrativo de usuários — concluído pelo PR D

`src/lib/admin-usuarios/` entrega, exclusivamente server-side: listar usuários
(identidade da Admin API + papéis de `user_roles`), convidar por e-mail
(`auth.admin.inviteUserByEmail`) com atribuição de papel explícita, conceder ou
revogar um papel (ação validada em runtime, não só pelo tipo TypeScript),
revogar acesso por completo, reativar, e atribuir/remover/consultar operações
em `user_operation_access`. Toda ação exige `admin` + `aal2`
(`exigirAdminAal2()`, que reusa `lerAcesso()`); `service_role` só é instanciado
depois dessa checagem, só em `src/integrations/supabase/admin.ts`, nunca em
código client.

**Revogar acesso** segue uma ordem deliberada — remover papéis (único passo que
o trigger do último admin pode recusar) → limpar **todas** as atribuições em
`user_operation_access` (pela sessão RLS real do admin, não por `service_role`)
→ banir a conta pela Admin API. **Reativar** concede o papel primeiro e só
depois desbane (o estado seguro é banido-mas-com-papel, nunca o contrário), e
**não** restaura as operações removidas na revogação. Um passo real que falhe
no meio de uma sequência já iniciada devolve `"parcial"`, nunca `"erro"` — dizer
"erro" quando algo persistente já mudou faria o admin repetir a ação achando
que nada aconteceu.

**A auditoria (`admin_audit_log`) é best-effort, não uma garantia
transacional.** Toda alteração administrativa tenta registrar um evento; se o
estado já foi alterado e a gravação da auditoria falhar, a alteração **não é
revertida** — a falha só é registrada no servidor. Não afirmar cobertura
absoluta de auditoria em nenhuma documentação futura.

Nem `user_operation_access` nem as cinco RPCs operacionais mudaram de policy —
o PR D consome a primeira pela RLS já existente desde a `013` e não toca nas
segundas.

## Banco — o que já está em Production

| Migration | Entrega                                                                 |
| --------- | ------------------------------------------------------------------------ |
| `009`     | AAL2 exigido no banco: 11 policies RESTRICTIVE                           |
| `010`     | valores financeiros **derivados por trigger**, não pelo payload          |
| `011`     | fontes financeiras protegidas; lastro faturado imutável                  |
| `012`     | estado de MFA verificável pelo banco (`mfa_bloqueia_excecao_aal1()`)     |
| `013`     | **superfície operacional AAL1** — papel, tabela, helpers e RPCs          |
| `014`     | `CHECK (break_minutes >= 0)` em `timesheet_entries` e `shifts`           |
| `015`     | a mesma superfície estreita passa a aceitar o operador também em **AAL2** |
| `016`     | acesso direto às 10 tabelas de negócio passa a exigir **`admin` + `aal2`** |
| `017`     | `admin_audit_log` (leitura admin+AAL2, escrita só `service_role`) e o trigger do último admin serializado por `pg_advisory_xact_lock` |

**As migrations aplicadas são imutáveis, a `017` inclusive.** Qualquer mudança
de banco exige migration nova.

### A superfície operacional AAL1/AAL2 — `013` e `015`, concluídas

- `public.user_operation_access`: atribuição usuário → operação, só admin em AAL2;
- papel de execução `bslog_rpc_operacional`: `NOLOGIN`, `BYPASSRLS`, sem
  membership nos papéis da API, grants **por coluna**;
- cinco helpers internos de `postgres`, todos read-only;
- cinco RPCs de contrato fechado, donas do papel dedicado;
- **nenhum valor financeiro** atravessa, e nenhuma leitura direta das tabelas
  protegidas acontece em AAL1 **nem em AAL2** (ver `016`, abaixo);
- as 11 policies `*_exige_aal2` continuam RESTRICTIVE e intactas;
- a `015` estendeu a mesma superfície ao operador que já concluiu o TOTP e está
  em AAL2 — sem ampliar dado, coluna ou grant.

**A interface já consome essa superfície** desde o PR B2.1 (camada de dados,
`src/lib/operacional/`) e o PR B2.3 (tela `/operacional`) — ver seção acima.

### Acesso direto revogado — `016`

Até a `016`, a policy permissiva original (`public.is_staff()`) liberava as dez
tabelas de negócio para **qualquer papel atribuído** em AAL2, não só `admin` —
uma conta `operacional` que concluísse o TOTP alcançava `clients`, `contracts`,
`employees`, `invoices`, `invoice_items`, `operations`, `operation_team`,
`shifts`, `timesheets` e `timesheet_entries` **direto pelo PostgREST**,
contornando a superfície estreita. A `016` acrescenta uma RESTRICTIVE
`<tabela>_exige_admin` por tabela, de modo que acesso direto de `authenticated`
passa a exigir **AAL2 E admin**. Não toca permissiva, grant, trigger, RPC nem
`is_staff()` — é aditiva. Ficam fora, de propósito: `profiles`, `user_roles` e
`user_operation_access` (motivos na seção 7.7 do `PROGRESS.md`). As cinco RPCs
não são afetadas (`BYPASSRLS`).

### Auditoria e proteção do último admin — `017`, fundação de banco do PR D

Duas entregas: `public.admin_audit_log` (RLS: leitura só admin+AAL2, sem GRANT
de escrita para `authenticated` — só `service_role` grava, então nem um admin
consegue adulterar a própria trilha) e o trigger `trg_proteger_ultimo_admin` em
`user_roles`, que recusa com `42501` qualquer `DELETE`/`UPDATE` que deixaria
zero linhas `role = 'admin'`. **Não isenta `postgres` nem `service_role`** —
diferente das guardas financeiras da `010`/`011`, aqui não existe caminho
legítimo para a operação.

A decisão é **serializada por `pg_advisory_xact_lock`** dentro do próprio
trigger, antes de contar quantos admins restam — sem isso, duas transações
concorrentes removendo admins diferentes veem "ainda sobra um" antes de a outra
commitar, e as duas passam. Provado nos dois sentidos com duas sessões `psql`
reais contra harness local antes do merge: sem o lock a segunda transação não
bloqueia e o resultado final é zero admins (a corrida reproduzida de propósito);
com o lock, a segunda bloqueia (~3s medidos) e é corretamente recusada ao
desbloquear. Nenhuma das 11 policies `*_exige_aal2` nem das 10 `*_exige_admin`
foi tocada; as cinco RPCs operacionais também não.

**Aplicada em Production** — PR #44/PR D, merge commit
`481cf22e50ff21b07bf47ccf1324b7e997cc20c5`. Auditoria pós-deploy, por leitura
direta do catálogo: migration `017` presente e mais recente, `admin_audit_log`
existente com RLS habilitada e as duas policies esperadas, `proteger_ultimo_admin()`
e `trg_proteger_ultimo_admin` existentes, a função contendo
`pg_advisory_xact_lock`, as 11 `*_exige_aal2` e as 10 `*_exige_admin` intactas,
e as cinco RPCs operacionais presentes.

## Testes

| Suíte                      | Cobertura                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| `supabase/tests/001`–`013` | RLS, invariáveis, fontes financeiras, MFA, superfície operacional AAL1/AAL2, revogação do acesso direto e auditoria/último admin |
| `npm run test:mfa`         | decisões de segundo fator                                              |
| `npm run test:recuperacao` | fluxo de recuperação de senha                                          |
| `npm run test:prova`       | prova HMAC e saídas pós-`verifyOtp`                                    |
| `npm run test:troca`       | troca de senha e desfechos do login                                    |
| `npm run test:operacional` | camada de dados operacional (RPCs, sem UI)                             |
| `npm run test:papel`       | papel, navegação e bloqueio de rotas server-side                       |
| `npm run test:tela-operacional` | tela `/operacional` — fases, rascunho, estados vazios e erro       |
| `npm run test:admin-usuarios`   | backend administrativo — forma literal, domínio puro, revogação/reativação, `"parcial"`, `acao` em runtime |

As oito suítes Node somam **874 asserções**, todas verdes (796 preexistentes +
78 do PR D). As treze suítes SQL (`001`–`013`) somam **13/13 PASS, 0 FAIL** — a
`012` mede especificamente a `016`, e a `013` mede a `017`.

## Validações

| Verificação        | Resultado                     |
| ------------------- | ------------------------------ |
| `npm run lint`     | 0 erros, 1 aviso preexistente |
| `npx tsc --noEmit` | limpo                         |
| `npm run build`    | verde                         |
| `npm audit`        | 0 vulnerabilidades            |
| Segredos no bundle | nenhum                        |

## Dívidas técnicas

Seis documentos em [divida-tecnica/](divida-tecnica/). As duas que afetavam
valores cobrados — faturamento não transacional e sobrescrita do rascunho — e a
do vínculo de fatura já foram **resolvidas** por migrations; os documentos
seguem como registro da causa. Segue aberta a escrita permissiva em
`operation_team`, que só se manifesta quando existir conta não-admin.

## Próximo passo

**PR D está concluído** — merge commit `481cf22e50ff21b07bf47ccf1324b7e997cc20c5`,
migration `017` em Production. A **etapa atual é o PR E** — tela `/usuarios`,
só admin, consumindo o backend do PR D sem adicionar lógica de segurança na UI.
Depois, na ordem: **PR F** (Configurações → Segurança — MFA opcional do
operador), **PR G** (matriz E2E completa).

**Não criar o primeiro usuário `operacional` real antes do PR E, do PR F e da
matriz E2E do PR G.**

O detalhamento, as decisões congeladas e o que não deve ser reaberto estão no
[PROGRESS.md](../PROGRESS.md).
