# Estado do projeto

Fotografia factual do sistema de **BS Soluções Logística**. É a **fonte única**
dos dados que mudam com o tempo (o que está em Production, cobertura de testes,
estado das dependências): os demais documentos apontam para cá em vez de repeti-los.
Etapa atual e próximos passos ficam em [PROGRESS.md](../PROGRESS.md).

## Production

| Item                  | Estado                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| Aplicação             | publicada em `admin.bslogisticas.com.br`                                           |
| Hospedagem            | Vercel, projeto `bs-logistica-sistema`, deploy a partir de `main`                  |
| Banco e Auth          | Supabase, projeto `ehkduqokntemtmqzdrbd`                                           |
| Migrations            | todas as de `supabase/migrations/` aplicadas (24 de 24)                            |
| Cadastro público      | bloqueado (`disable_signup = true`)                                                |
| Usuário `operacional` | ainda não existe conta real; depende da matriz E2E ([PROGRESS.md](../PROGRESS.md)) |

O **Preview** da Vercel falha de propósito: não tem as variáveis
`NEXT_PUBLIC_SUPABASE_*`, e conectá-lo ao banco de produção para deixar o check
verde é proibido.

O site institucional (`bslogisticas.com.br`) é outro projeto, em outro
repositório, e não faz parte deste.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth, RLS) com `@supabase/ssr` · TanStack Query ·
npm · Vercel. Node ≥ 22.6. Sentry para monitoramento de erros.

Next.js é a arquitetura definitiva. TanStack Start, TanStack Router, Vite, Nitro e
as integrações do Lovable foram removidos. `@tanstack/react-query` permanece: é a
camada de dados e não tem relação com o TanStack Router.

## Módulos

**Área administrativa** — só `admin`, em AAL2:

| Módulo               | Função                                                           |
| -------------------- | ---------------------------------------------------------------- |
| Dashboard            | indicadores do período: diárias, horas extras, receita, margem   |
| Clientes e contratos | cadastro e regras de cobrança                                    |
| Colaboradores        | cadastro com função, contato e custo por diária                  |
| Operações            | operações fixas e avulsas, turnos e equipe                       |
| Apontamentos         | presença, horários e intervalo, com cálculo automático           |
| Faturamento          | fechamento por cliente e período                                 |
| Relatórios           | por colaborador, operação e lançamento, com exportação CSV       |
| Fechamento           | por cliente e período, XLSX e CSV (fora de Production)           |
| Usuários             | convite, papel, atribuição de operações, revogação e reativação  |
| Configurações        | segurança da conta: ativar MFA (o `operacional` também desativa) |

**Área operacional** — só `operacional`: a tela `/operacional` registra presença e
horários das operações atribuídas ao usuário, falando exclusivamente com as cinco
RPCs da superfície operacional. Nenhum valor financeiro é exibido.

Mais: login, segundo fator, recuperação de senha, logout e renovação de sessão.

## Autenticação e papéis

- Dois papéis: `admin` e `operacional`. `admin` exige MFA TOTP (AAL2); para
  `operacional` o MFA é opcional, e uma conta que o ativa passa a exigi-lo.
- O acesso direto às tabelas de negócio exige `admin` e `aal2`. O `operacional`
  chega aos dados só por RPC.
- O último admin é protegido por trigger, e as alterações de usuário e papel são
  auditadas em `admin_audit_log` (best-effort).

O modelo completo está em [SEGURANCA.md](SEGURANCA.md).

## Segurança relevante em vigor

- RLS em todas as tabelas de `public`, com RESTRICTIVE de `aal2` e de `admin`.
- Valores financeiros derivados por trigger; linha faturada imutável.
- Content-Security-Policy com nonce, em enforcement, mais cabeçalhos de segurança
  (HSTS pela plataforma).
- `service_role` usada só no servidor; segredos fora do Git e do bundle.

## Testes e CI

| Verificação                     | Estado                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Suítes Node (`test:*`)          | `main`: 11 scripts. Branch do fechamento: 18 (11 + 7 novos), todos no workflow da CI                 |
| Testes SQL (`supabase/tests`)   | `main`: 13 arquivos; branch do fechamento: 14. Locais (`scripts/testar-sql-local.sh`), **não** na CI |
| CI (`.github/workflows/ci.yml`) | em PR e push para `main`: lint, `typegen`, `tsc`, suítes e build; sem secret, sem tocar Production   |
| `npm audit`                     | 0 vulnerabilidades                                                                                   |

O módulo **Fechamento** (`/fechamento`, `GET /api/fechamento`, `POST
/api/fechamento/xlsx`) está na branch `feat/fechamento-quinzenal` e **não está em
Production**. O workflow dessa branch (com `next typegen` antes do `tsc` e as
seis suítes do fechamento) ainda não rodou no GitHub. Detalhes e pendências de
Preview em [PROGRESS.md](../PROGRESS.md).

## Riscos e pendências confirmados

Registrados em [SEGURANCA.md](SEGURANCA.md) (seção "Riscos residuais") e em
[PROGRESS.md](../PROGRESS.md). O diretório [divida-tecnica/](divida-tecnica/) tem
só dívidas já resolvidas, como histórico.
