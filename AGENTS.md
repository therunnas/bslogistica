# Instruções operacionais

Documentação do projeto: [README](README.md) ·
[Arquitetura](docs/ARQUITETURA.md) · [Segurança](docs/SEGURANCA.md) ·
[Estado](docs/ESTADO_DO_PROJETO.md)

## Stack definitiva

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
Supabase com `@supabase/ssr` · TanStack Query · npm · Vercel.

## Não reintroduzir

TanStack Start, TanStack Router, Vite, Nitro, Vinxi, Wrangler ou qualquer
integração com o Lovable. Foram removidos de propósito.

`@tanstack/react-query` **permanece** — é a camada de dados da aplicação e não
tem relação com o TanStack Router.

## Regras

- **A RLS é a proteção real dos dados.** O guard do layout governa o que a
  interface mostra; nunca o trate como substituto das políticas do banco.
- **A chave `service_role` nunca vai para o cliente.** Nenhuma variável
  `NEXT_PUBLIC_*` pode conter segredo — o prefixo embute o valor no bundle.
- **Nunca editar migration já aplicada.** Criar nova com
  `supabase migration new <nome>`.
- **Não alterar regras financeiras** — cálculo de diária, hora extra, custo ou
  faturamento — fora de tarefa com esse escopo explícito.
- **Não tocar no projeto `bs-logisticas`.** É o site institucional, outro
  repositório e outro projeto na Vercel.
- **`proxy.ts`, não `middleware.ts`.** No Next.js 16 a convenção foi renomeada;
  um `middleware.ts` é ignorado em silêncio e a sessão deixa de ser renovada.
- **Token de uso único não se consome em GET.** Gateways de segurança de e-mail
  visitam cada link da mensagem sozinhos; um GET que muda estado queima o token
  antes do usuário. No GET, validar **apenas formato/estrutura e tipo
  permitido** — nada além disso. Conferir a validade ou a autenticidade do
  token **é** consumi-lo, então isso só pode acontecer depois de uma ação
  deliberada do usuário.
- **MFA é exigido também no banco.** 11 tabelas de negócio têm policy
  RESTRICTIVE pedindo `aal2`; `user_roles` fica de fora de propósito, porque é
  lida antes do MFA. Não adicionar AAL2 nela.

## Antes de entregar

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Quando a tarefa tiver ponto de aprovação definido, **não fazer commit, push ou
merge** sem o aval — apresentar o resultado e aguardar.
