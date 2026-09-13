# Instruções operacionais

Documentação do projeto: [README](README.md) ·
[Arquitetura](docs/ARQUITETURA.md) · [Segurança](docs/SEGURANCA.md) ·
[Progresso](PROGRESS.md)

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
- **O valor financeiro nasce no banco, não no payload.** `billed_amount`,
  `cost_amount` e os snapshots de diária, hora extra e custo são derivados por
  trigger a partir de contrato, operação, turno e colaborador. No `INSERT` a
  derivação sobrescreve o que veio do navegador; um `UPDATE` que mexa **apenas**
  em campo derivado é **recusado com `42501`**, não corrigido em silêncio; um
  `UPDATE` aceito **recalcula só se mexeu em coluna motriz** (`status`,
  `check_in`, `check_out`, `break_minutes`, `employee_id`, `timesheet_id`) e do
  contrário **preserva** o que estava gravado, descartando o payload — é a
  preservação que mantém o snapshot congelado. `postgres` e `service_role`
  escapam desse bloqueio específico, não das demais proteções.
  `src/lib/billing.ts` serve para a interface prever o número, nunca para
  decidi-lo; a paridade entre as duas implementações é conferida à mão.
- **Histórico faturado é imutável.** `timesheet_entries` com `invoice_id`
  recusa `UPDATE` e `DELETE`. O vínculo só nasce em execução como `postgres`,
  contexto em que `gerar_fatura` roda — `authenticated`, admin incluído, e
  `service_role` não criam; sessão `postgres` direta e superusuário estão fora
  dessa fronteira. Os bloqueios de `DELETE` têm critérios **distintos**, não "em
  uso": cliente exige **fatura ou apontamento faturado**; contrato, ser o
  `contract_id` **atual** de uma operação com apontamento — remapear a operação
  torna o contrato de origem apagável; turno, ser referenciado por **folha** —
  só por `operation_team` não basta. Com faturamento congelam
  `operations.client_id`, o
  `work_date`/`operation_id`/`shift_id` da folha e a linha do apontamento.
  **Não** congelam `operations.contract_id`, `agreed_amount`, as taxas do
  contrato nem `employees.daily_cost` — editáveis por admin, sem alterar o já
  faturado, mas perdendo proveniência. `TRUNCATE` está revogado de `anon` e
  `authenticated` em `public`, e de `service_role` **nas 10 tabelas de
  negócio** — `profiles` e `user_roles` **continuam** com ele para
  `service_role`, porque a `011` não as listou e `ALTER DEFAULT PRIVILEGES` não
  mexe em grant existente. Não afrouxar fora de tarefa própria.
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
- **Não remover a policy AAL2 global sem substituição segura.** Existe uma
  decisão aprovada de tornar o MFA opcional para o papel `operacional`, mas ela
  **ainda não foi implementada**: hoje o guard e as 11 tabelas exigem AAL2 para
  qualquer papel. A mudança é coordenada — guard + papel + RLS no mesmo desenho.
  Derrubar a policy sozinha reabre uma vulnerabilidade já corrigida. Enquanto
  isso, **não criar usuário `operacional` real**. Ver `CLAUDE.md`, seção
  "AAL por papel", e `PROGRESS.md`, seções 6 e 7.
- **MFA optativo precisa valer no banco.** Se a conta `operacional` tiver fator
  verificado, a futura exceção de AAL1 não pode deixar bypass direto por
  PostgREST/RPC — papel + `aal` sozinhos não distinguem quem nunca ativou MFA de
  quem ativou e ainda não fez o TOTP. A decisão precisa ser enforceable no
  banco, não só no guard.
- **Estado de MFA vindo da sessão não vale para enforcement.**
  `getAuthenticatorAssuranceLevel()` sem argumento não fala com o servidor:
  `nextLevel` sai de `session.user.factors`, que é campo do cookie fora da
  assinatura do JWT — o próprio SDK chama isso de inseguro. Serve para UX. Para
  autorização, usar `public.mfa_bloqueia_excecao_aal1()` (migration 012), que lê
  `auth.mfa_factors` e falha fechada. Ela **não** libera AAL1 nem decide papel.
- **Sem cadastro público.** Contas nascem por convite ou pela mão do admin.
  Operação administrativa privilegiada é server-side, o último admin é
  protegido, e alteração de usuário ou papel é auditada.

## Antes de entregar

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Quando a tarefa tiver ponto de aprovação definido, **não fazer commit, push ou
merge** sem o aval — apresentar o resultado e aguardar.
