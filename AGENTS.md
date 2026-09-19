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
  `supabase migration new <nome>`. As 21 migrations do repositório estão
  aplicadas em Production — a `014` e a `015` inclusive —, e **nenhuma
  migration aplicada se edita**, nem para corrigir.
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
- **O `postgres` do Supabase não é superusuário; o do harness local é.** Teste
  de privilégio que passa localmente não prova nada sobre Production — superusuário
  pula checagem de ACL. Em especial, `ALTER ... OWNER TO` exige que o **novo dono**
  tenha `CREATE` no schema: conceder antes e revogar depois, na mesma transação,
  nunca deixar permanente.
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
- **O guard do painel é role-aware desde o PR C** (PR #37), e a decisão é uma
  só, em `lerAcesso()`: **admin** nunca é liberado em AAL1 — sem fator vai
  cadastrar (`mfa-ausente`), com fator vai desafiar (`mfa-pendente`), e só AAL2
  libera; **`operacional` sem fator verificado** pode trabalhar em AAL1, e
  **com** fator verificado é barrado até concluir o TOTP, voltando em AAL2;
  **`admin`+`operacional` é admin**, com AAL2 obrigatório; sem papel bloqueia; e
  falha de leitura ou claim `aal` ausente/desconhecida **fecha**. Não recriar
  essa decisão no layout, em `/mfa`, no dashboard ou nos guards — duas
  definições de "liberado" produzem laço entre as rotas.
- **Não remover a policy AAL2 global sem substituição segura.** As **11 tabelas**
  de negócio continuam exigindo `aal2` por policy RESTRICTIVE **global**, e a
  exceção do `operacional` **não** entra por policy: ela é a superfície de RPC
  abaixo. Derrubar a policy reabre uma vulnerabilidade já corrigida.
- **O que ainda não existe é o autosserviço de MFA do `operacional`** — ativar
  ou desativar o próprio fator. O _enforcement_ por papel já está implementado;
  o que falta é a tela Configurações → Segurança, que é o **PR F**. Não escrever
  que "MFA por papel não foi implementado".
- **Não criar usuário `operacional` real** antes de concluir o **PR D**, o
  **PR E**, o **PR F** e a matriz E2E do **PR G**. B2.1, B2.2, B2.3 e o PR C já
  estão fechados; a proibição continua pelos que faltam. Ver `CLAUDE.md`, seção
  "AAL por papel", e `PROGRESS.md`, seções 6 e 7.
- **MFA optativo vale no banco, não só no guard.** Se a conta `operacional`
  tiver fator verificado, a exceção de AAL1 não pode deixar bypass direto por
  PostgREST/RPC — papel + `aal` sozinhos não distinguem quem nunca ativou MFA de
  quem ativou e ainda não fez o TOTP. É por isso que as RPCs revalidam o estado
  de MFA por dentro e o guard consulta o banco em vez do cookie.
- **Estado de MFA vindo da sessão não vale para enforcement.**
  `getAuthenticatorAssuranceLevel()` sem argumento não fala com o servidor:
  `nextLevel` sai de `session.user.factors`, que é campo do cookie fora da
  assinatura do JWT — o próprio SDK chama isso de inseguro. Serve para UX. Para
  autorização, usar `public.mfa_bloqueia_excecao_aal1()` (migration 012), que lê
  `auth.mfa_factors` e falha fechada. Ela **não** libera AAL1 nem decide papel.
  É exatamente o que o guard faz desde o PR C: `currentLevel` (claim `aal` do
  token já validado) mais essa RPC; `nextLevel` **não participa do enforcement
  do painel**. Ele sobrevive só na recuperação de senha, onde não concede acesso
  a dado nenhum e quem recusa a troca sem AAL2 é o próprio GoTrue.
- **A superfície operacional entra por RPC, nunca por policy.** A migration 013
  criou `public.user_operation_access`, os helpers
  `operador_elegivel_aal1()`/`operador_autorizado(uuid)` e cinco RPCs de
  contrato fechado; a migration **015** acrescentou
  `operador_elegivel_operacional()` — `aal1` sem MFA bloqueando **ou** `aal2` —
  e reapontou os helpers centrais para ela, **sem** ampliar dado, coluna ou
  grant. As 11 policies `*_exige_aal2` **não** foram afrouxadas por nenhuma das
  duas, e **em AAL1** `operacional` lê zero linha de tabela de negócio pelo
  PostgREST — ali a RPC é a única porta. **Em AAL2 não é assim:** as policies
  permissivas originais liberam por `public.is_staff()`, que é verdadeiro para
  qualquer papel, então o operador em AAL2 alcança essas tabelas direto — e
  escreve naquelas cuja policy é `FOR ALL`. Isso é anterior à `013` e à `015`, e
  não se conserta no guard; separar `is_staff()` por papel é tarefa própria, com
  migration e teste. A interface **consome** as RPCs desde o B2.1
  (`src/lib/operacional/`) e o B2.3 (tela `/operacional`), e só elas. Ao mexer nessa superfície: nenhum valor financeiro atravessa (do cliente só
  `cliente_nome`; "faturado" é boolean derivado), a escrita aceita seis campos
  por linha e recusa a chamada inteira diante de chave inesperada, não existe
  DELETE, e toda função `SECURITY DEFINER` revalida papel + AAL + MFA +
  atribuição por dentro, sempre sobre `auth.uid()` e nunca sobre um `user_id`
  recebido. Decisão de autorização fecha com `coalesce(..., false)` e
  `IS NOT TRUE`: NULL não é `false`.
- **As RPCs operacionais não rodam como `postgres`.** Elas pertencem a
  `bslog_rpc_operacional` — `NOLOGIN`, sem membership nos papéis da API,
  `BYPASSRLS` e privilégios mínimos por coluna —, porque sete guardas de 010/011
  isentam `postgres` e a superfície do papel menos privilegiado não pode escrever
  com as isenções do mais privilegiado. Esse papel **não tem privilégio** em
  `invoice_id` nem em coluna financeira, não tem DELETE nem TRUNCATE, e em
  `timesheets`/`shifts` só atualiza `updated_at`, o mínimo que o PostgreSQL exige
  para travar linha. **Todos os grants dele são por coluna**, nenhum por tabela:
  ele não lê `billed_amount`, `cost_amount`, snapshot, `invoice_id`,
  `employees.daily_cost`, `operations.agreed_amount`, documento ou telefone, e
  não alcança `contracts`. Não ampliar esses grants, não trocar coluna por
  tabela, e não trocar o dono das funções.
  Ele também **não tem nada no schema `auth`**: em Production o `postgres` não
  consegue conceder `USAGE` ali a outro papel, então RPC que referencie `auth.*`
  quebra — identidade vem de `public.uid_do_operador()`. O trigger legado
  `protect_timesheet_invoice_link` foi aposentado pela 013 por forçar esse
  privilégio e não proteger mais nada; não recriar.
- **Sem cadastro público.** Contas nascem por convite ou pela mão do admin.
  Operação administrativa privilegiada é server-side, o último admin é
  protegido, e alteração de usuário ou papel é auditada. **O backend que
  implementa isso é o PR D — a próxima etapa oficial**: convite, atribuição e
  troca de papel, atribuição de operações via `user_operation_access`, proteção
  do último admin e auditoria, tudo **exclusivamente server-side**, com
  `service_role` nunca no navegador e o frontend jamais como barreira.

## Antes de entregar

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Quando a tarefa tiver ponto de aprovação definido, **não fazer commit, push ou
merge** sem o aval — apresentar o resultado e aguardar.
