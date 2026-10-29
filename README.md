# BS Soluções Logística — sistema de gestão

Painel interno de gestão operacional e financeira de mão de obra terceirizada.
Uso interno, publicado em `admin.bslogisticas.com.br`; não há cadastro público.

> O site institucional (`bslogisticas.com.br`) é outro projeto, em outro
> repositório. Este repositório contém somente o painel.

## Principais funcionalidades

- **Clientes e contratos** — cadastro e regras de cobrança (diária, jornada, hora
  extra).
- **Colaboradores, operações e turnos** — equipe alocada por operação e turno.
- **Apontamento** de presença, horários e intervalo, com cálculo de diária e hora
  extra.
- **Faturamento** por cliente e período, e **relatórios** com exportação CSV.
- **Usuários e papéis** — convite por e-mail, papel `admin` ou `operacional`,
  atribuição de operações e auditoria das alterações.
- **Área operacional** — tela separada, sem valores financeiros, para quem
  registra a presença em campo.
- **Segurança** — segundo fator (TOTP) opcional, exigido nas operações críticas, RLS no
  banco e valores financeiros calculados no banco.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth e RLS) · TanStack Query · Vercel.

## Pré-requisitos

- Node.js 22.6 ou superior (as suítes de teste usam `--experimental-strip-types`;
  a CI roda em Node 24).
- npm.
- Um projeto Supabase com as migrations de `supabase/migrations/` aplicadas.

## Início rápido

```bash
npm install
cp .env.example .env   # preencha as variáveis abaixo
npm run dev
```

Abre em http://localhost:3000.

## Variáveis de ambiente

| Variável                               | Onde roda   | Descrição                                           |
| -------------------------------------- | ----------- | --------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | navegador   | URL do projeto Supabase                             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | navegador   | chave publicável; quem protege os dados é a RLS     |
| `SUPABASE_SERVICE_ROLE_KEY`            | só servidor | **segredo**; operações administrativas de usuário   |
| `PASSWORD_RECOVERY_PROOF_SECRET`       | só servidor | **segredo**; assina a prova da recuperação de senha |

As variáveis marcadas como segredo nunca recebem o prefixo `NEXT_PUBLIC_` e nunca
são versionadas. O `.env.example` explica cada uma e como gerar o segredo de
recuperação. Detalhes em [Segurança](docs/SEGURANCA.md).

## Comandos

| Comando               | O que faz                                     |
| --------------------- | --------------------------------------------- |
| `npm run dev`         | servidor de desenvolvimento                   |
| `npm run build`       | build de produção                             |
| `npm run start`       | serve o build                                 |
| `npm run lint`        | ESLint com Prettier                           |
| `npm run format`      | formata o código                              |
| `npm run test:<nome>` | uma suíte de testes (lista em `package.json`) |

## Testes e CI

- **Suítes Node** (`npm run test:*`): decisões de MFA, recuperação de senha, papel
  e guards, telas, administração de usuários e camada operacional. Várias
  asseveram a **forma literal** do código, não só o comportamento: mexeu em auth,
  MFA, recuperação ou nas telas, rode todas.
- **Testes de banco** em `supabase/tests/`: arquivos SQL de RLS, invariantes,
  proteção financeira e superfície operacional. Cada um termina em `rollback`.
  Rodam localmente com `scripts/testar-sql-local.sh`, contra um Supabase local
  descartável, e não na CI.
- **CI** (`.github/workflows/ci.yml`): em todo pull request e em push para `main`,
  roda lint, `tsc --noEmit`, as suítes Node e o build. Não usa secret nem acessa
  o Supabase de Production.

Antes de entregar: `npm run lint`, `npx tsc --noEmit`, todas as suítes e
`npm run build`. `main` recebe alterações por pull request.

## Estrutura

```
src/
├── app/                  rotas (App Router): login, MFA, recuperação de senha
│   └── (painel)/         área protegida: telas administrativas e /operacional
├── components/           shadcn/ui e marca
├── integrations/supabase/ clientes (navegador, servidor, admin) e tipos do banco
├── lib/                  cálculo, consultas, MFA, usuários, camada operacional
└── proxy.ts              renovação de sessão e política de conteúdo (CSP)

supabase/
├── migrations/           esquema, RLS, triggers e RPCs
└── tests/                testes SQL
```

Detalhes em [Arquitetura](docs/ARQUITETURA.md).

## Segurança

Sem cadastro público. Dois papéis (`admin` e `operacional`), MFA opcional (obrigatório
nas operações críticas e para quem o ativou), RLS no banco como proteção real dos dados, valores financeiros
derivados no banco e operações privilegiadas somente no servidor. O modelo
completo e os riscos residuais estão em [Segurança](docs/SEGURANCA.md).

## Deploy

Vercel, a partir de `main`; o `vercel.json` declara o framework e o build usa o
script `build`. As variáveis de ambiente precisam existir no ambiente — sem elas o
build falha na pré-renderização, de propósito, em vez de publicar uma aplicação
quebrada. O Preview não recebe as variáveis do banco de produção.

## Documentação do projeto

| Documento                                      | Conteúdo                                                 |
| ---------------------------------------------- | -------------------------------------------------------- |
| [Arquitetura](docs/ARQUITETURA.md)             | organização do código, fluxo de dados, regras de negócio |
| [Segurança](docs/SEGURANCA.md)                 | autenticação, MFA, RLS, segredos, riscos residuais       |
| [Estado do projeto](docs/ESTADO_DO_PROJETO.md) | fotografia atual: Production, testes, módulos            |
| [Progresso](PROGRESS.md)                       | etapa atual, marcos e próximas etapas                    |
| [Dívidas técnicas](docs/divida-tecnica/)       | histórico dos defeitos já diagnosticados e resolvidos    |

Regras permanentes para quem edita o projeto com agentes de código:
[CLAUDE.md](CLAUDE.md) (Claude Code) e [AGENTS.md](AGENTS.md) (demais agentes).
