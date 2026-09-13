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
supabase/migrations/         18 arquivos; 17 em Production, a 012 pendente
supabase/tests/              8 testes SQL de RLS, invariáveis, fontes e MFA
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
- 12 tabelas em `public`, todas com RLS ativa.
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
- portanto **`operacional` em AAL1 ainda não usa o sistema**, e isso permanece
  até que uma migration específica seja criada, testada e aplicada.

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
continuam globais, e nenhuma policy chama a função ainda. Quem a usar é o PR B.

**Enquanto isso não acontecer:**

- **nunca simplesmente remover a policy AAL2 global** sem substituição segura.
  Derrubá-la reabre o P1 que o PR #14 fechou, e que foi reproduzido de verdade
  em PostgreSQL antes da migration 009;
- **nunca confiar só no frontend** para essa decisão;
- **não criar usuário `operacional` real** antes dessa mudança.

O plano por etapas está em [PROGRESS.md](PROGRESS.md), seções 6 e 7.

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
  `supabase migration new <nome>`.
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

`docs/ESTADO_DO_PROJETO.md` é uma fotografia de 04/09/2026 e **está obsoleta**.
Use `PROGRESS.md` no lugar dela.
