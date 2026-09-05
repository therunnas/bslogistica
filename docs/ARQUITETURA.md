# Arquitetura

## Stack

| Camada             | Tecnologia                                         |
| ------------------ | -------------------------------------------------- |
| Framework          | Next.js 16, App Router                             |
| UI                 | React 19, Tailwind CSS 4, shadcn/ui                |
| Tipos              | TypeScript estrito                                 |
| Dados              | Supabase (Postgres, Auth, RLS) via `@supabase/ssr` |
| Estado de servidor | TanStack Query                                     |
| Hospedagem         | Vercel                                             |

As opções estritas do TypeScript são deliberadas e devem permanecer:
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` e
`noPropertyAccessFromIndexSignature`. `typedRoutes` está ligado no
`next.config.ts`, o que transforma link para rota inexistente em erro de
compilação.

## Organização de `src/`

```
src/
├── app/
│   ├── layout.tsx            layout raiz: fontes, metadata, providers
│   ├── providers.tsx         TanStack Query e Toaster (client)
│   ├── page.tsx              landing pública
│   ├── login/page.tsx        entrada (client)
│   └── (painel)/
│       ├── layout.tsx        guard no servidor
│       ├── _autorizacao.ts   lê sessão e papel
│       ├── _acoes.ts         logout (Server Action)
│       ├── _components/      app-shell, tela de acesso não liberado
│       └── <modulo>/
│           ├── page.tsx           servidor: exporta metadata
│           └── painel-<modulo>.tsx cliente: a tela
├── components/ui/            shadcn/ui
├── hooks/use-mobile.tsx
├── integrations/supabase/
│   ├── browser.ts            cliente de navegador (singleton)
│   ├── server.ts             cliente de servidor (cookies)
│   ├── env.ts                leitura das variáveis
│   └── types.ts              tipos gerados do banco
├── lib/
│   ├── billing.ts            regras de diária, hora extra, custo e margem
│   ├── ledger.ts             consolida apontamentos com operação e cliente
│   ├── queries.ts            leituras (TanStack Query)
│   ├── mutations.ts          escritas genéricas
│   ├── format.ts             moeda, número, data, minutos
│   ├── types.ts · utils.ts
├── proxy.ts                  renovação de sessão
└── styles.css                tema Tailwind
```

### Por que cada tela tem dois arquivos

`metadata` só pode ser exportado de um Server Component, e as telas precisam de
estado, formulários e TanStack Query. Então `page.tsx` roda no servidor e
exporta o `metadata`; `painel-<modulo>.tsx` traz a interface e é client
component.

## Supabase

**`browser.ts`** — `createBrowserClient`, uma instância só por sessão de página.
Cada cliente mantém o próprio estado de autenticação e os próprios ouvintes;
criar vários faria a renovação de token disputar consigo mesma.

**`server.ts`** — `createServerClient` sobre os cookies do Next, para Server
Components, Route Handlers e Server Actions.

Os dois usam a **chave publicável**, nunca a secreta: as consultas passam pela
RLS em nome do usuário da sessão. É o comportamento desejado — o servidor não
deve enxergar mais do que o usuário enxergaria.

A sessão vive em **cookies**, não em `localStorage`, porque o servidor precisa
lê-la ao renderizar.

## `proxy.ts`

No Next.js 16 esta convenção se chama `proxy.ts`; `middleware.ts` foi
descontinuado e renomeado. Um `middleware.ts` é ignorado em silêncio.

Roda antes de qualquer renderização e chama `getUser()`, que é o que dispara a
renovação do token — e o valida contra o servidor do Supabase em vez de confiar
no cookie. Sem ele o token expiraria em cerca de uma hora e o usuário cairia no
login sem aviso, porque Server Components não podem gravar cookies.

O `matcher` exclui estáticos e imagens, senão haveria uma verificação de sessão
a cada CSS e cada ícone. **Não colocar lógica de autorização aqui** — o arquivo
é só renovação de sessão.

## Autenticação e autorização

```
usuário → Supabase Auth → profiles → user_roles → admin | operacional → RLS
```

O layout de `(painel)` chama `lerAcesso()` **no servidor**, antes de enviar
qualquer HTML:

| Situação              | Resultado                                   |
| --------------------- | ------------------------------------------- |
| sem sessão            | `redirect("/login")` — HTTP 307, sem markup |
| autenticado sem papel | tela "Acesso não liberado"                  |
| com papel             | o painel                                    |

A leitura usa `getUser()`, que valida o token contra o Supabase, e não
`getSession()`, que confiaria no cookie.

**Isto governa o que a interface mostra. Quem impede o acesso aos dados é a
RLS** — se este arquivo tivesse um defeito, as tabelas continuariam protegidas.

### O que cada papel pode

| Tabela                               | admin              | operacional        |
| ------------------------------------ | ------------------ | ------------------ |
| clients · contracts · employees      | ler e escrever     | só ler             |
| invoices · invoice_items             | ler e escrever     | só ler             |
| operations · shifts · operation_team | ler e escrever     | **ler e escrever** |
| timesheets · timesheet_entries       | ler e escrever     | **ler e escrever** |
| profiles                             | vê todos           | só o próprio       |
| user_roles                           | só a própria linha | só a própria linha |

Um usuário operacional não altera cadastro nem gera fatura, mas **define o que
será faturado** — cria e altera apontamentos, que viram diária e hora extra.

## Fluxo de dados

Leitura: componente → hook de `queries.ts` → TanStack Query → cliente de
navegador → PostgREST → **RLS** → Postgres.

Escrita: formulário → `mutations.ts` ou chamada direta → mesma cadeia →
invalidação das queries afetadas.

Os valores financeiros são **calculados no navegador e gravados** no
apontamento: `worked_minutes`, `overtime_minutes`, `billed_amount`,
`cost_amount` e os snapshots de diária e custo. Dashboard, faturamento e
relatórios apenas **leem** o que foi gravado — não recalculam.

Consequência prática: a tela de apontamentos mostra o valor **calculado na
hora**, não o gravado. Conferir uma alteração pela interface não prova o que foi
persistido.

## Módulos

| Módulo               | O que faz                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Dashboard            | indicadores do período: diárias, horas extras, receita, custo, margem, e gráficos por cliente, dia e tipo |
| Clientes e contratos | cadastro e regras de cobrança: diária, jornada, fator e tolerância de hora extra                          |
| Colaboradores        | cadastro com função, contato e custo por diária                                                           |
| Operações            | operações fixas e avulsas, com turnos e equipe alocada                                                    |
| Apontamentos         | presença, horários e intervalo por turno, com cálculo automático                                          |
| Faturamento          | fechamento por cliente e período, com itens por operação                                                  |
| Relatórios           | por colaborador, operação e lançamento, com exportação CSV                                                |

## Regras de cálculo

Em `src/lib/billing.ts`. Uma diária por colaborador presente; falta não gera
cobrança. A hora extra é `(diária ÷ horas do turno) × fator`, aplicada ao
excedente que ultrapassar a tolerância definida no contrato. O turno trata
virada de meia-noite.

## Banco

Projeto Supabase **BSLOG**. RLS ativa em todas as tabelas do schema `public`, e
um event trigger (`ensure_rls`) a habilita automaticamente em tabelas novas.

Migrations em `supabase/migrations/`. **Nunca editar migration já aplicada** —
criar nova com `supabase migration new <nome>`. Antes de commitar mudança de
esquema, rodar `supabase db advisors --linked --type security`.
