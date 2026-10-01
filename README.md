# BS Logística — sistema de gestão

Painel interno de gestão operacional e financeira de mão de obra terceirizada:
clientes e contratos, colaboradores, operações e turnos, apontamento de diárias
e horas extras, faturamento por período e relatórios.

Sistema de uso interno, **publicado** em `admin.bslogisticas.com.br`. Não há
cadastro público: `disable_signup = true`, e a criação de contas passa
exclusivamente pelo administrador, pela tela `/usuarios` do próprio painel.

## Stack

Next.js 16 com App Router · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth e RLS) · TanStack Query · Vercel.

## Instalação

Requer Node.js 22.6 ou superior (as suítes usam `--experimental-strip-types`).
A CI roda em Node 24.

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
SUPABASE_SERVICE_ROLE_KEY
PASSWORD_RECOVERY_PROOF_SECRET
```

As duas variáveis `NEXT_PUBLIC_*` são públicas por natureza: viajam no JavaScript
da página. Quem protege os dados é a RLS do banco. A
`SUPABASE_SERVICE_ROLE_KEY` é segredo e é usada exclusivamente no servidor pelas
operações administrativas de usuários. Ela nunca pode receber o prefixo
`NEXT_PUBLIC_` nem ser importada por código client. O cliente privilegiado só é
instanciado depois dos controles de autorização do backend; a chave não substitui
esses controles e nunca deve ser versionada. A `PASSWORD_RECOVERY_PROOF_SECRET`
também é segredo, só do servidor, e assina a prova da recuperação de senha;
`.env.example` descreve como gerá-la.

## Comandos

| Comando                         | O que faz                              |
| ------------------------------- | -------------------------------------- |
| `npm run dev`                   | servidor de desenvolvimento            |
| `npm run build`                 | build de produção                      |
| `npm run start`                 | serve o build                          |
| `npm run lint`                  | ESLint com Prettier                    |
| `npm run format`                | formata o código                       |
| `npm run test:mfa`              | decisões de segundo fator              |
| `npm run test:recuperacao`      | fluxo de recuperação de senha          |
| `npm run test:prova`            | prova HMAC e saídas pós-`verifyOtp`    |
| `npm run test:troca`            | troca de senha e desfechos do login    |
| `npm run test:cookies-supabase` | cookies de sessão do Supabase          |
| `npm run test:operacional`      | contratos da superfície operacional    |
| `npm run test:papel`            | papel efetivo e guards                 |
| `npm run test:tela-operacional` | tela `/operacional`                    |
| `npm run test:admin-usuarios`   | administração de usuários, no servidor |
| `npm run test:tela-usuarios`    | tela `/usuarios`                       |
| `npm run test:configuracoes`    | tela `/configuracoes`                  |

São **11 suítes Node, com 1.062 asserções** no total. Várias asseveram a **forma
literal** do código, não só o comportamento — mexeu em auth, MFA, recuperação ou
nas telas, rode todas.

Os testes de banco ficam em `supabase/tests/` — 13 arquivos SQL de RLS,
invariáveis, proteção financeira, estado de MFA e superfície operacional. Cada
um roda de uma vez e termina em `rollback`. Não rodam na CI.

## Validação e CI

Antes de entregar: `npm run lint`, `npx tsc --noEmit`, as 11 suítes e
`npm run build`. O workflow `.github/workflows/ci.yml` executa essa mesma
sequência em todo pull request e em todo push para `main`. Ele não usa secret
algum e não acessa o Supabase de Production: o `build` recebe valores inertes
para as duas variáveis públicas, só para a pré-renderização passar.

`main` recebe alterações por pull request; o trabalho é feito em branch.

## Estrutura

```
src/
├── app/                      rotas (App Router)
│   ├── page.tsx              redireciona para /login
│   ├── login/, mfa/          entrada e segundo fator
│   ├── esqueci-senha/, auth/, redefinir-senha/
│   │                         recuperação de senha
│   └── (painel)/             área protegida — 10 rotas: dashboard, clientes,
│                             colaboradores, operações, apontamentos,
│                             faturamento, relatórios, usuários, configurações
│                             e operacional
├── components/               ui (shadcn/ui), branding
├── integrations/supabase/    clientes, tipos do banco
├── lib/                      cálculo, queries, MFA, recuperação de senha,
│                             admin-usuarios, operacional
└── proxy.ts                  renovação de sessão

supabase/
├── migrations/               23 arquivos, todos aplicados em Production
└── tests/                    13 testes SQL
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
