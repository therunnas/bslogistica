# BS Logística — sistema de gestão operacional e financeira

Aplicação **TanStack Start + React + Tailwind + shadcn/ui**, com **Supabase**
para autenticação e banco de dados. Renderizada no servidor e publicada na
Vercel.

## Comandos

```
npm install     # dependências
npm run dev     # http://localhost:8080
npm run build   # build de produção (saída em .vercel/output)
npm run lint    # eslint
npm run format  # prettier
```

## Estrutura

- `src/routes/auth.tsx` — tela de login.
- `src/routes/_authenticated/` — área protegida: dashboard, clientes,
  colaboradores, operações, apontamentos, faturamento e relatórios.
- `src/integrations/supabase/` — cliente do Supabase (navegador e servidor) e
  middleware de autenticação.
- `supabase/migrations/` — esquema do banco. Nunca editar migration já
  aplicada; criar uma nova com `supabase migration new <nome>`.
- `src/components/app-shell.tsx` — cabeçalho e barra lateral.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. Todas são públicas por natureza —
vão para o navegador junto com o JavaScript. A chave secreta (`service_role`)
não é usada por esta aplicação e não deve entrar aqui.

## Banco de dados

RLS está ativa em todas as tabelas do schema `public`, e um event trigger
(`ensure_rls`) a habilita automaticamente em tabelas novas. Antes de commitar
mudanças de esquema, rode `supabase db advisors --linked --type security`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
