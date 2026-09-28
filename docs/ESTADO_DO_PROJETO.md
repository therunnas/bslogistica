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
alcançar — agora exige **`admin` + `aal2`**. Ainda não existe conta
`operacional` real: falta o backend administrativo de usuários (**PR D**), a
tela `/usuarios` (**PR E**), a ativação de MFA pelo próprio operador (**PR F**)
e a matriz E2E (**PR G**) — ver [PROGRESS.md](../PROGRESS.md).

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
| Migrations       | **22 locais = 22 remotas**, zero pendentes                 |
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

**As migrations aplicadas são imutáveis, a `016` inclusive.** Qualquer mudança
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

## Testes

| Suíte                      | Cobertura                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| `supabase/tests/001`–`012` | RLS, invariáveis, fontes financeiras, MFA, superfície operacional AAL1/AAL2 e revogação do acesso direto |
| `npm run test:mfa`         | decisões de segundo fator                                              |
| `npm run test:recuperacao` | fluxo de recuperação de senha                                          |
| `npm run test:prova`       | prova HMAC e saídas pós-`verifyOtp`                                    |
| `npm run test:troca`       | troca de senha e desfechos do login                                    |
| `npm run test:operacional` | camada de dados operacional (RPCs, sem UI)                             |
| `npm run test:papel`       | papel, navegação e bloqueio de rotas server-side                       |
| `npm run test:tela-operacional` | tela `/operacional` — fases, rascunho, estados vazios e erro       |

As sete suítes Node somam **796 asserções**, todas verdes. As doze suítes SQL
(`001`–`012`) somam **12/12 PASS, 0 FAIL** — a `012` sozinha tem 95 casos e
mede especificamente a `016`.

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

**PR D — backend administrativo de usuários**, exclusivamente server-side:
convite, papel, atribuição de operações, proteção do último admin, auditoria de
alteração. É a **etapa atual**. Depois dele, na ordem: **PR E** (tela
`/usuarios`, só admin), **PR F** (Configurações → Segurança — MFA opcional do
operador), **PR G** (matriz E2E completa).

**Não criar o primeiro usuário `operacional` real antes do PR D, do PR E, do PR
F e da matriz E2E do PR G.**

O detalhamento, as decisões congeladas e o que não deve ser reaberto estão no
[PROGRESS.md](../PROGRESS.md).
