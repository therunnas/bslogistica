# BS Logística — instruções permanentes

Este arquivo é carregado em toda sessão. Contém apenas o que **não muda**.
Estado atual, decisões em aberto e próximo passo ficam em
[PROGRESS.md](PROGRESS.md) — leia os dois antes de agir.

`AGENTS.md` repete um subconjunto destas regras para agentes que não leem
`CLAUDE.md`. Ao mudar uma regra aqui, mude lá também.

## O que é o sistema

Painel interno de gestão de mão de obra terceirizada: clientes e contratos,
colaboradores, operações e turnos, apontamento de diárias e horas extras,
faturamento por período e relatórios. Uso interno, sem cadastro público.

Responde em `admin.bslogisticas.com.br`.

**Não confundir com o site institucional** (`bslogisticas.com.br`): outro
repositório, outro projeto na Vercel, outra pasta. Nunca tocar nele.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (`@supabase/ssr`) · TanStack Query · npm · Vercel.
Node ≥ 20.9.

**Não reintroduzir:** TanStack Start, TanStack Router, Vite, Nitro, Vinxi,
Wrangler, Lovable. Foram removidos de propósito. `@tanstack/react-query`
**permanece** — é a camada de dados e não tem relação com o TanStack Router.

## Arquitetura

```
src/app/(painel)/            área protegida — 7 telas
  layout.tsx                 guard de acesso (sessão → papel → MFA)
  _autorizacao.ts            decisão de acesso, no servidor

as rotas abaixo são irmãs de (painel)/ e ficam fora do guard, de propósito:

src/app/login/               entrada
src/app/mfa/                 segundo fator
src/app/esqueci-senha/       solicitação de recuperação
src/app/auth/confirm/        GET do link: valida e NÃO consome o token
src/app/auth/confirmar-recuperacao/
                             confirmação deliberada; consome o token
src/app/redefinir-senha/     troca da senha, com a prova revalidada

src/lib/billing.ts           cálculo de diária, hora extra, custo
src/lib/ledger.ts            consolidação apontamento → cliente
src/lib/mfa.ts               decisões de segundo fator, funções puras
src/lib/prova-recuperacao.ts prova HMAC da recuperação, funções puras
src/integrations/supabase/   clientes (browser/server), tipos do banco
src/proxy.ts                 renovação de sessão a cada requisição
supabase/migrations/         21 arquivos, todos em Production e imutáveis
supabase/tests/              9 testes SQL de RLS, invariáveis, fontes, MFA e
                             superfície operacional
```

**`proxy.ts`, nunca `middleware.ts`.** No Next.js 16 a convenção foi renomeada;
um `middleware.ts` é ignorado em silêncio e a sessão para de ser renovada.

Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Comandos

| Comando                    | O que faz                           |
| -------------------------- | ----------------------------------- |
| `npm run dev`              | servidor de desenvolvimento         |
| `npm run build`            | build de produção                   |
| `npm run lint`             | ESLint com Prettier                 |
| `npm run test:mfa`         | decisões de MFA                     |
| `npm run test:recuperacao` | fluxo de recuperação de senha       |
| `npm run test:prova`       | prova HMAC e saídas pós-`verifyOtp` |
| `npm run test:troca`       | troca de senha e desfechos do login |

As quatro suítes somam **357 asserções**. Mexer em auth, MFA ou recuperação
exige rodar todas — várias delas asseveram a **forma literal** do código, não só
o comportamento.

Antes de entregar: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

Erro de Prettier introduzido por uma edição se corrige **à mão**, não com
`--fix` — o formatador reescreve arquivos que não fazem parte da tarefa.

## Auth

- **Sem cadastro público.** `disable_signup = true`. Usuários são criados pelo
  administrador; a tela de login não oferece registro. **Contas nascem por
  convite ou pela mão do admin** — nunca por autosserviço.
- **Papel é explícito.** O trigger de onboarding cria apenas o `profiles`.
  Papel em `public.user_roles` é atribuição administrativa separada — nunca
  automática. Não reintroduzir bootstrap automático de admin.
- **Operação administrativa privilegiada é server-side.** Convidar, atribuir ou
  trocar papel, remover acesso: nada disso passa pelo navegador como
  autoridade. O frontend nunca é a barreira.
- **O último admin é protegido.** Nenhum caminho pode remover ou rebaixar o
  único administrador restante.
- **Alteração de usuário ou papel é auditada.**
- **MFA TOTP é obrigatório** para o painel. O guard exige AAL2; sem ele a rota
  redireciona para `/mfa`.
- **Conta com MFA ativo exige TOTP no login.** Não existe caminho que aceite só
  a senha para uma conta com fator verificado.
- **Recovery de conta com MFA exige um TOTP** — e **apenas um**. Depois de uma
  redefinição bem-sucedida, **não cobrar um segundo TOTP**: a sessão que chega
  ali já provou posse do link, prova HMAC e o segundo fator. Foi um defeito real
  (PR #18), não uma preferência.
- **Falha ao consultar o nível de garantia não é ausência de fator.** Erro
  transitório vai para a tela "não foi possível verificar", nunca para o
  cadastro de fator — cadastrar sobre conta que já tem fator trava a conta.
- **Token de recuperação não se consome em GET.** O `GET /auth/confirm` confere
  **apenas formato e `type`** — não verifica se o token é válido — e o guarda
  num cookie `httpOnly`. Quem chama `verifyOtp`, e portanto cria a sessão de
  recuperação, é a Server Action de `src/app/auth/confirmar-recuperacao/`,
  disparada por um clique. Gateways de segurança de e-mail visitam cada link da
  mensagem sozinhos, e a varredura queimava a recuperação antes do usuário.
  Conferir a validade do token **é** consumi-lo: não existe "só verificar" num
  token de uso único. Vale para qualquer link desse tipo que venha a existir.
- **Depois que a senha muda com sucesso, a prova é apagada** e não permanece
  reutilizável em nenhum desfecho posterior. Falhas **anteriores** ao
  `updateUser` podem preservá-la, de propósito, para nova tentativa dentro da
  validade. E a tela nunca diz que a redefinição falhou num caminho em que o
  `updateUser` teve sucesso.
- O guard governa **o que a interface mostra**. Quem protege os dados é a RLS.

## RLS e banco

- **A RLS é a proteção real.** Nunca tratar o guard do layout como substituto.
- 13 tabelas em `public`, todas com RLS ativa — as 12 de sempre mais
  `user_operation_access`, criada pela 013.
- Autorização em SQL usa `public.has_role()` e `public.is_staff()`.
- **O MFA também é exigido no banco.** 11 tabelas de negócio têm policy
  RESTRICTIVE pedindo `aal2`, porque papel sozinho não distinguia uma sessão
  AAL1 — quem tivesse só a senha alcançava os dados pelo PostgREST.
- **`user_roles` fica fora desse enforcement, de propósito.** O guard lê o
  papel ainda em AAL1, antes de mandar para o MFA; bloquear a tabela cria
  deadlock — seria preciso AAL2 para chegar à tela que concede AAL2. Não
  adicionar policy de AAL2 nela.

### AAL por papel — decisão aprovada, ainda NÃO implementada

Separar as duas coisas importa mais aqui do que em qualquer outro ponto deste
arquivo. Leia as duas metades antes de agir.

**ESTADO ATUAL — o que vale hoje:**

- o guard do painel exige **AAL2 para qualquer papel**;
- as **11 tabelas** de negócio exigem `aal2` por policy RESTRICTIVE **global**,
  sem distinguir papel;
- portanto **`operacional` em AAL1 ainda não alcança tabela nenhuma**, e isso
  permanece: a exceção de AAL1 NÃO entra por policy;
- o que existe desde o **PR B1** (migration 013) é uma **superfície estreita de
  RPC** — descrita mais abaixo — que ainda **não é consumida pela interface**.

**DECISÃO ARQUITETURAL APROVADA — o que ainda vai ser construído:**

- **admin:** MFA obrigatório, sempre em AAL2;
- **operacional:** MFA opcional, ativável pelo próprio usuário;
- a implementação é **mudança coordenada de guard + papel + RLS**, num mesmo
  desenho — nunca em pedaços soltos.

**MFA opcional NÃO é MFA dispensável.** Uma conta `operacional` que **já optou
por MFA** não pode continuar acessando dados em AAL1. Uma conta com fator
verificado recebe sessão AAL1 logo após o login por senha, então **papel + `aal`
isoladamente não distinguem** quem nunca ativou MFA de quem ativou e ainda não
fez o TOTP. A futura autorização precisa exigir o segundo fator **também no
enforcement do banco** para os acessos protegidos, com um indicador confiável e
**não manipulável pelo usuário** do estado de MFA, ou mecanismo equivalente.
**Nunca implementar isso só no guard ou no frontend.**

**Esse indicador passou a existir** — `public.mfa_bloqueia_excecao_aal1()`,
migration 012, PR A. Ela lê `auth.mfa_factors` por `SECURITY DEFINER` e responde
se o estado de MFA da conta **impede** a futura exceção de AAL1. Responde que
impede em três casos além do fator verificado: sem sessão, com erro de leitura, e
quando o `uid` do JWT **não existe mais** em `auth.users` — um token ainda não
expirado de conta apagada, cujos fatores o `ON DELETE CASCADE` levou junto,
enquanto a linha órfã de `user_roles` sobrevive. **Ter o indicador não é ter a
autorização:** o PR A **não liberou AAL1**, as 11 policies `*_exige_aal2`
continuam globais, e nenhuma policy chama a função ainda. Quem a usa é o PR B1,
por dentro de `public.operador_elegivel_aal1()`.

### A superfície operacional AAL1 — PR B1, migration 013

**O que existe.** `public.user_operation_access` (atribuição usuário →
operação), dois helpers internos — `operador_elegivel_aal1()` e
`operador_autorizado(operation_id)` — e cinco RPCs de contrato fechado:
`listar_operacoes_do_operador`, `listar_turnos_do_operador`,
`listar_equipe_do_operador`, `listar_apontamentos_do_operador` e
`salvar_apontamento_operacional`.

**O que continua fechado, e é o ponto:** nenhuma policy foi afrouxada. As 11
`*_exige_aal2` seguem RESTRICTIVE e globais, e `operacional` em AAL1 lê **zero
linha** de `operations`, `shifts`, `employees`, `contracts`, `timesheets` e
`timesheet_entries` pelo PostgREST. A única porta é a RPC.

**Regras permanentes desta superfície:**

- **O operador não recebe valor financeiro.** Nem `billed_amount`,
  `cost_amount`, snapshot, `invoice_id`, `daily_cost`, `daily_rate`,
  `shift_hours`, `ot_factor`, `ot_tolerance_min` ou `agreed_amount`. Do cliente
  atravessa **apenas `cliente_nome`** — nunca `client_id`, documento, telefone
  ou e-mail. Quem precisa de número é o admin, em AAL2. "Faturado" chega ao
  operador como **boolean derivado**, nunca como id de fatura.
- **A escrita aceita seis campos por linha** — `employee_id`, `status`,
  `check_in`, `check_out`, `break_minutes`, `notes` — e **recusa a chamada
  inteira** com `22023` diante de qualquer outra chave no JSON. Não existe
  DELETE nesta superfície; linha ausente do payload é linha não tocada.
- **A autoridade financeira continua sendo a 010.** A RPC não escreve coluna
  derivada: quem calcula é o trigger, igual ao caminho do admin.
- **`SECURITY DEFINER` ignora RLS**, então cada função revalida tudo por dentro:
  papel `operacional`, **não** `admin`, `aal = aal1`,
  `mfa_bloqueia_excecao_aal1() = false`, conta ainda existente e atribuição em
  `user_operation_access`. Nunca acrescentar RPC aqui sem essa verificação
  completa — e **nunca** aceitar `user_id` por parâmetro: a decisão é sempre
  sobre `auth.uid()`.
- **`NULL` não é `false` nessa decisão.** Os helpers fecham o retorno com
  `coalesce(..., false)` e as RPCs decidem com `IS NOT TRUE`. Um JWT sem o claim
  `aal` fazia a cadeia de `AND` devolver NULL, e `IF NOT NULL` não dispara — era
  fail-open, medido e corrigido antes do merge (caso A9 do teste `009`).
- **`user_operation_access` é só do admin em AAL2**, por policy permissiva e
  por RESTRICTIVE de mesmo predicado. O operador não a consulta; ela o autoriza.
- **A interface ainda não consome nada disso** — é o PR B2 que adapta
  `queries.ts`, `painel-apontamentos.tsx`, o guard e o login.

**As cinco RPCs não rodam como `postgres`.** Elas pertencem ao papel
`bslog_rpc_operacional` — `NOLOGIN`, sem membership em `anon`, `authenticated`
ou `service_role`, com `BYPASSRLS` e privilégios mínimos **por coluna**. O
motivo é concreto: sete guardas de 010/011 isentam `postgres`, e com dono
`postgres` a superfície do papel menos privilegiado escreveria com as isenções
do mais privilegiado. Com dono próprio, `current_user` dentro da escrita é
`bslog_rpc_operacional` — medido por trigger espião no caso L2 do teste `009` —
e as guardas voltam a valer.

**Todos os grants do papel são por COLUNA — ele não tem privilégio de tabela em
nada.** Não tem `invoice_id` nem coluna financeira, **nem para ler**: um comando
desta superfície que nomeasse `billed_amount`, `cost_amount`, um snapshot,
`employees.daily_cost`, `operations.agreed_amount` ou `invoice_id` é recusado
pelo PostgreSQL com `42501`, independentemente do que o código diga — e
`select *` nessas tabelas também. `contracts` ele não alcança de jeito nenhum.
Em `timesheets` e `shifts` o `UPDATE` é só de `updated_at`, e só porque o
PostgreSQL exige privilégio de UPDATE para travar linha com `FOR SHARE` — dois
triggers da 011 fazem isso no caminho da escrita. **Não ampliar esses grants, e
nunca trocar um grant de coluna por `GRANT ... ON TABLE`.**

O booleano `faturado` vem de `public.apontamento_faturado(timesheet_id,
employee_id)`, helper de `postgres` que lê `invoice_id` e devolve só o booleano.
É o que permite ao papel não ter leitura naquela coluna. Ao acrescentar campo
derivado de dado sensível, seguir esse padrão em vez de conceder a coluna.

**Ele não tem nada no schema `auth`** — nem `USAGE`, nem tabela, nem função — e
isso não é folga de desenho: em Production o `postgres` **não consegue** conceder
`USAGE` em `auth` a outro papel, medido. Identidade e autorização entram pelos
helpers de `postgres`. Uma RPC desta superfície que passe a referenciar `auth.*`
quebra em Production; use `uid_do_operador()`.

**O trigger `protect_timesheet_invoice_link` foi aposentado pela 013.** Ele era
`SECURITY INVOKER`, chamava `auth.uid()` em todo INSERT de apontamento e, por
isso, forçava aquele privilégio impossível. Não protegia mais nada: as guardas da
011 cobrem o mesmo evento permitindo estritamente menos — o legado isentava
`admin` e `service_role`, elas não isentam ninguém. Não recriar.

Os cinco helpers (`operador_elegivel_aal1`, `operador_autorizado`,
`uid_do_operador`, `travar_turno_da_operacao`, `apontamento_faturado`)
continuam com dono `postgres`,
porque leem o schema `auth`, tomam lock ou leem coluna que o papel não alcança —
e **nenhum deles escreve**, que é o que torna isso seguro. Ao criar helper novo aqui, manter essa propriedade ou
mudar o dono.

**Ainda dependem só do contrato da RPC**, e não do banco: a exigência de equipe
ativa e a recusa de folha fechada. Nenhuma das duas é invariante de banco para
papel nenhum — o admin também aponta quem quiser e escreve em folha fechada.
Está registrado assim de propósito; se virar invariante, é tarefa própria.

- **Função `SECURITY DEFINER` roda acima da RLS**, então policy não a protege:
  a exigência de `aal2` precisa estar escrita dentro da própria função, como
  em `gerar_fatura`. Vale para toda RPC nova com `SECURITY DEFINER`.
- **O payload do cliente não é fonte de valor financeiro.** Desde a migration
  010, `billed_amount`, `cost_amount` e os três snapshots são **derivados por
  trigger** a partir de contrato, operação, turno e colaborador. O desfecho
  depende da operação: no `INSERT` a derivação **sobrescreve** o payload; um
  `UPDATE` que mexa **apenas** em campo derivado é **recusado com `42501`** por
  `bloquear_edicao_financeira()`, que roda antes da derivação; um `UPDATE`
  aceito **recalcula só se alterou coluna motriz** — `status`, `check_in`,
  `check_out`, `break_minutes`, `employee_id`, `timesheet_id` —, e do contrário
  **preserva** os valores gravados, descartando o payload. Não usar "recalcula"
  como descrição genérica de `UPDATE`: é a preservação que mantém o snapshot
  congelado. `postgres` e `service_role` são isentos **desse bloqueio
  específico**, não das demais proteções. Não reintroduzir cálculo no cliente
  como autoridade — `src/lib/billing.ts` existe para a interface mostrar o
  número antes de salvar, não para decidi-lo, e a paridade entre os dois é
  conferida **à mão** (ver `PROGRESS.md`).
- **Linha faturada é imutável e o lastro não se destrói.** Desde a 011,
  `timesheet_entries` com `invoice_id` preenchido recusa `UPDATE` e `DELETE`,
  inclusive o `SET NULL` que a FK emitiria ao apagar a fatura. **O vínculo só
  nasce em execução como `postgres`**, que é o contexto em que `gerar_fatura`
  roda: `authenticated` não cria — admin incluído —, `service_role` também não.
  A fronteira é a API da aplicação; **sessão `postgres` direta e superusuário
  ficam fora dela**, e nenhuma proteção aqui promete o contrário. Os bloqueios
  de `DELETE` têm **critérios distintos**, e não é "em uso": cliente só é
  protegido se tiver **fatura ou apontamento faturado** — cliente com apenas
  operação é apagável, e a operação cai por cascata; contrato é protegido se
  for **o `contract_id` atual** de uma operação que tenha apontamento — lido do
  valor corrente, então remapear a operação torna o contrato **de origem**
  apagável; turno é protegido se **alguma folha** o referencia — turno
  referenciado só por `operation_team` é apagável, de propósito. Com faturamento
  congelam `operations.client_id`, o `work_date`/`operation_id`/`shift_id` da
  folha e a linha do apontamento — mas **não** `operations.contract_id`,
  `agreed_amount`, as taxas do contrato nem `employees.daily_cost`, que
  continuam editáveis por admin. Isso não altera o já faturado, cujos snapshots
  estão congelados; perde-se **proveniência**, não dinheiro. `TRUNCATE` está
  revogado de `anon` e `authenticated` em `public`, e de `service_role`
  **apenas nas 10 tabelas de negócio**: `profiles` e `user_roles` seguem com
  esse privilégio para `service_role` — conferido em Production —, porque a
  `011` não as listou e `ALTER DEFAULT PRIVILEGES` só vale para tabela futura.
  Há trigger `BEFORE TRUNCATE` sobre `timesheet_entries` e `invoice_items`. Não
  afrouxar nada disso sem tarefa de escopo próprio.
- **Nunca editar migration já aplicada.** Criar nova com
  `supabase migration new <nome>`. As 21 migrations do repositório estão
  aplicadas em Production — a `014` e a `015` inclusive —, e **nenhuma
  migration aplicada se edita**, nem para corrigir.
- **Não alterar RLS, policies, grants ou triggers** fora de tarefa com esse
  escopo explícito.
- **Não alterar regras financeiras** — diária, hora extra, custo, faturamento —
  fora de tarefa com esse escopo explícito.

### Supabase CLI — armadilhas reais deste ambiente

- **`supabase db query` inline executa só a primeira linha.** Sempre usar
  `-f <arquivo>`, que envia o arquivo inteiro e honra `BEGIN`/`ROLLBACK`.
  Ignorar isso já causou perda de dados aqui.
- **`SUPABASE_ACCESS_TOKEN` do ambiente é inválido** e sobrepõe o
  `supabase login`. Prefixar todo comando com `env -u SUPABASE_ACCESS_TOKEN`.
- **`.env` define `SUPABASE_PROJECT_ID`**, que vence `config.toml` e
  `.temp/project-ref`. Se um comando parecer apontar para o projeto errado,
  é daí.
- O SQL Editor e o `db query` conectam como `postgres`, dono das tabelas —
  **a RLS não é aplicada**. Para testar policy é preciso trocar o papel com
  `SET LOCAL ROLE authenticated` e injetar as claims com `set_config`.
- **`db query` é caminho de leitura.** Escrita só pelo SQL Editor ou por
  transação guardada explicitamente autorizada, com pré-condições reverificadas
  dentro da transação e `GET DIAGNOSTICS` em cada comando.
- **O `postgres` do Supabase NÃO é superusuário, e o do harness local é.** Toda
  verificação de privilégio que passa localmente herda essa ressalva: superusuário
  pula checagem de ACL, e Production não pula. Isso já custou um deploy — a
  primeira tentativa da 013 falhou com `42501 permission denied for schema public`
  no primeiro `ALTER FUNCTION ... OWNER TO`, porque **o NOVO dono precisa de
  `CREATE` no schema** para receber a posse, e o harness nunca cobrou isso.
  Ao transferir posse de objeto, conceder `CREATE` imediatamente antes e revogar
  imediatamente depois, na mesma transação — nunca deixar o privilégio
  permanente. O harness também **não consegue** simular isso por completo: o
  usuário de bootstrap do PostgreSQL não pode perder `SUPERUSER`, e as regras de
  administração de papel do PG16 divergem das do Supabase. Reproduzir esse tipo
  de falha exige um experimento isolado com executor não-superusuário.
- **Nunca `supabase config push`.** O `config.toml` não descreve a configuração
  de Auth real; um push aplicaria padrões do CLI e desligaria MFA, confirmação
  de e-mail e a Site URL de produção.
- Nunca `TRUNCATE`, `DELETE` sem `WHERE`, por `LIKE` ou por prefixo. Só UUID
  exato, em transação com asserção final.

## Segredos

- **`service_role` nunca vai para o cliente.** A aplicação não a usa.
- **Nenhuma variável `NEXT_PUBLIC_*` pode conter segredo** — o prefixo embute o
  valor no bundle do navegador.
- Credencial de SMTP e chave de API de e-mail existem **só** no Dashboard do
  Supabase. Não vão para o Git, `.env`, Vercel, frontend, nem para o chat.
- `.env` está no `.gitignore` e deve continuar.

## Git e deploy

- Trabalhar em branch; `main` recebe por PR.
- **Não commitar, fazer push ou merge sem aval explícito** quando a tarefa tiver
  ponto de aprovação. Apresentar o resultado e aguardar.
- Nunca `force push`, nunca alterar `main` diretamente.
- Deploy pela Vercel a partir de `main`. Production tem as duas variáveis
  `NEXT_PUBLIC_SUPABASE_*`; **Preview não tem, de propósito** — e por isso o
  build de Preview falha. Não conectar Preview ao banco de produção para deixar
  o check verde.

## Método

- Verificar antes de afirmar. Se a conclusão anterior — minha, do usuário ou de
  um documento — não bater com o repositório, **parar e reportar** em vez de
  seguir sobre premissa falsa. Isso já evitou estrago mais de uma vez aqui.
- Não inventar valor de configuração de terceiro (DNS, provedor de e-mail):
  copiar do painel real.
- Relatar o que aconteceu, incluindo o que falhou ou foi pulado.

## Documentação

| Documento                                    | Conteúdo                               |
| -------------------------------------------- | -------------------------------------- |
| [PROGRESS.md](PROGRESS.md)                   | **estado atual e próximo passo**       |
| [README.md](README.md)                       | instalação, comandos, estrutura        |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md)   | organização do código e fluxo de dados |
| [docs/SEGURANCA.md](docs/SEGURANCA.md)       | RLS, papéis, segredos, auditorias      |
| [docs/divida-tecnica/](docs/divida-tecnica/) | defeitos conhecidos, com causa         |

`docs/ESTADO_DO_PROJETO.md` é a fotografia do projeto, atualizada a cada marco.
Onde ela e o `PROGRESS.md` divergirem, o `PROGRESS.md` vence — é ele que carrega
o estado do dia e o próximo passo.
