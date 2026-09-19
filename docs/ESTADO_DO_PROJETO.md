# Estado do projeto

Fotografia em **19/09/2026**. Este documento descreve o **estado atual**; o
detalhe operacional e o próximo passo ficam em [PROGRESS.md](../PROGRESS.md),
que é atualizado com mais frequência. Onde os dois divergirem, o `PROGRESS.md`
vence.

A fotografia anterior, de 04/09/2026, descrevia um projeto **ainda não
publicado**, com o PR #1 aberto e sete migrations. Nada daquilo vale mais — o
histórico correspondente está preservado no `PROGRESS.md` e no `SEGURANCA.md`.

## Em uma linha

Sistema **publicado e em uso**, com um único usuário real (o administrador), e a
fundação de acesso operacional **pronta no banco** mas ainda não consumida pela
interface.

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
| Migrations       | **19 locais = 19 remotas**, zero pendentes                 |
| Usuários reais   | **um**: o administrador, com TOTP verificado               |
| Cadastro público | bloqueado (`disable_signup = true`)                        |

**Preview da Vercel falha de propósito** e isso não é defeito: ela não tem as
variáveis `NEXT_PUBLIC_SUPABASE_*`, e conectá-la ao banco de produção para
deixar o check verde está proibido.

## Módulos da interface

Sete telas concluídas, todas administrativas e exigindo **AAL2**:

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

## Banco — o que já está em Production

| Migration | Entrega                                                              |
| --------- | -------------------------------------------------------------------- |
| `009`     | AAL2 exigido no banco: 11 policies RESTRICTIVE                       |
| `010`     | valores financeiros **derivados por trigger**, não pelo payload      |
| `011`     | fontes financeiras protegidas; lastro faturado imutável              |
| `012`     | estado de MFA verificável pelo banco (`mfa_bloqueia_excecao_aal1()`) |
| `013`     | **superfície operacional AAL1** — papel, tabela, helpers e RPCs      |

**As migrations aplicadas são imutáveis, a `013` inclusive.** Qualquer mudança
de banco exige migration nova.

### A superfície operacional AAL1 — `013`, concluída

- `public.user_operation_access`: atribuição usuário → operação, só admin em AAL2;
- papel de execução `bslog_rpc_operacional`: `NOLOGIN`, `BYPASSRLS`, sem
  membership nos papéis da API, grants **por coluna**;
- cinco helpers internos de `postgres`, todos read-only;
- cinco RPCs de contrato fechado, donas do papel dedicado;
- **nenhum valor financeiro** atravessa, e nenhuma leitura direta das tabelas
  protegidas acontece em AAL1;
- as 11 policies `*_exige_aal2` continuam RESTRICTIVE e intactas.

**A interface ainda não consome nada disso** — é o próximo bloco de trabalho.

## Testes

| Suíte                      | Cobertura                                                          |
| -------------------------- | ------------------------------------------------------------------ |
| `supabase/tests/001`–`009` | RLS, invariáveis, fontes financeiras, MFA e superfície operacional |
| `npm run test:mfa`         | decisões de segundo fator                                          |
| `npm run test:recuperacao` | fluxo de recuperação de senha                                      |
| `npm run test:prova`       | prova HMAC e saídas pós-`verifyOtp`                                |
| `npm run test:troca`       | troca de senha e desfechos do login                                |

As quatro suítes JS somam **357 asserções**. A `009` sozinha tem **180 casos**.

## Validações

| Verificação        | Resultado                     |
| ------------------ | ----------------------------- |
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

**B2 — adaptar o frontend à superfície operacional AAL1**, em PRs pequenos:
`B2.1` camada de dados · `B2.2` papel, navegação e bloqueio de rotas · `B2.3`
tela operacional de apontamentos. Depois vêm `PR C` (guard por papel + AAL +
MFA), `PR D`/`PR E` (backend e tela de usuários), `PR F` (configurações de
segurança) e `PR G` (matriz E2E).

**Não criar o primeiro usuário `operacional` real antes do `PR G`.**

O detalhamento, as decisões congeladas e o que não deve ser reaberto estão no
[PROGRESS.md](../PROGRESS.md).
