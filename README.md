# BS Logística — sistema de gestão

Painel interno de gestão operacional e financeira de mão de obra terceirizada:
clientes e contratos, colaboradores, operações e turnos, apontamento de diárias
e horas extras, faturamento por período e relatórios.

Sistema de uso interno, **publicado** em `admin.bslogisticas.com.br`. Não há
cadastro público: `disable_signup = true`, e a criação de contas passa
exclusivamente pelo administrador. Hoje isso acontece no painel do Supabase —
a administração de usuários dentro do próprio sistema está planejada e ainda
não existe.

## Stack

Next.js 16 com App Router · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth e RLS) · TanStack Query · Vercel.

## Instalação

Requer Node.js 20.9 ou superior.

```bash
npm install
cp .env.example .env
npm run dev
```

Abre em http://localhost:3000.

## Variáveis de ambiente

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

As duas são públicas por natureza: viajam no JavaScript da página. Quem protege
os dados é a RLS do banco. **A chave secreta do Supabase (`service_role`) não é
usada por esta aplicação e não deve entrar no `.env`.**

## Comandos

| Comando                    | O que faz                           |
| -------------------------- | ----------------------------------- |
| `npm run dev`              | servidor de desenvolvimento         |
| `npm run build`            | build de produção                   |
| `npm run start`            | serve o build                       |
| `npm run lint`             | ESLint com Prettier                 |
| `npm run format`           | formata o código                    |
| `npm run test:mfa`         | decisões de segundo fator           |
| `npm run test:recuperacao` | fluxo de recuperação de senha       |
| `npm run test:prova`       | prova HMAC e saídas pós-`verifyOtp` |
| `npm run test:troca`       | troca de senha e desfechos do login |

As quatro suítes somam **357 asserções**, e várias asseveram a **forma literal**
do código de autenticação, não só o comportamento. Mexeu em auth, MFA ou
recuperação: rode as quatro.

Os testes de banco ficam em `supabase/tests/` — nove arquivos SQL de RLS,
invariáveis, proteção financeira, estado de MFA e superfície operacional. Cada
um roda de uma vez e termina em `rollback`.

## Estrutura

```
src/
├── app/                      rotas (App Router)
│   ├── page.tsx              landing pública
│   ├── login/                entrada no painel
│   └── (painel)/             área protegida — 7 telas
├── components/ui/            shadcn/ui
├── integrations/supabase/    clientes, tipos do banco
├── lib/                      regras de cálculo, queries, formatação
└── proxy.ts                  renovação de sessão

supabase/
├── migrations/               19 arquivos, todos aplicados em Production
└── tests/                    9 suítes SQL
```

Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Deploy

Vercel, projeto `bs-logistica-sistema`. O `vercel.json` declara o framework; o
build usa o script `build`. As duas variáveis precisam existir no ambiente — sem
elas o build falha na pré-renderização, de propósito, em vez de publicar uma
aplicação quebrada.

O site institucional (`bslogisticas.com.br`) é outro projeto e outro repositório.
Este painel responde em `admin.bslogisticas.com.br`.

## Documentação

| Documento                                      | Conteúdo                                                     |
| ---------------------------------------------- | ------------------------------------------------------------ |
| [Arquitetura](docs/ARQUITETURA.md)             | organização do código, autenticação, fluxo de dados, módulos |
| [Segurança](docs/SEGURANCA.md)                 | RLS, papéis, segredos, pendências abertas                    |
| [Progresso](PROGRESS.md)                       | **estado atual, decisões abertas e próximo passo**           |
| [Estado do projeto](docs/ESTADO_DO_PROJETO.md) | fotografia do projeto, atualizada a cada marco               |
| [Dívidas técnicas](docs/divida-tecnica/)       | defeitos conhecidos, com causa e reprodução                  |

**Antes de mexer em apontamentos ou faturamento, leia as dívidas técnicas.** As
que afetavam valores cobrados já foram fechadas por migration, mas os documentos
explicam a causa — e o banco, não a interface, é a autoridade sobre qualquer
valor.

Regras permanentes para quem for editar o projeto estão em
[CLAUDE.md](CLAUDE.md); `AGENTS.md` repete o subconjunto que agentes precisam.
