# BS Logística — sistema de gestão

Painel interno de gestão operacional e financeira de mão de obra terceirizada:
clientes e contratos, colaboradores, operações e turnos, apontamento de diárias
e horas extras, faturamento por período e relatórios.

Sistema de uso interno. Não há cadastro público — os acessos são criados pelo
administrador no painel do Supabase.

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

| Comando          | O que faz                   |
| ---------------- | --------------------------- |
| `npm run dev`    | servidor de desenvolvimento |
| `npm run build`  | build de produção           |
| `npm run start`  | serve o build               |
| `npm run lint`   | ESLint com Prettier         |
| `npm run format` | formata o código            |

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
| [Estado do projeto](docs/ESTADO_DO_PROJETO.md) | situação atual e próximos passos                             |
| [Dívidas técnicas](docs/divida-tecnica/)       | defeitos conhecidos, com causa e reprodução                  |

**Antes de mexer em apontamentos ou faturamento, leia as dívidas técnicas.** Há
problemas ali que afetam valores cobrados.
