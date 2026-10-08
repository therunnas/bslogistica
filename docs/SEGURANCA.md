# Segurança

Modelo de segurança vigente do painel de **BS Soluções Logística** e riscos
residuais conhecidos. Este é o documento de referência: onde outro texto divergir
dele, vale o que está aqui. O estado de implantação (migrations, testes, o que
está em Production) fica em [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md); o
histórico de cada mudança, no Git.

## Princípios

1. **A RLS é a proteção real.** O guard do layout governa o que a interface
   mostra; se ele tivesse um defeito, as tabelas continuariam protegidas.
2. **O banco decide, o frontend não.** Autorização, valor financeiro e
   invariantes de dado são impostos no Postgres. Corrigir só na interface não
   resolve.
3. **Fechar por padrão.** Erro de leitura, claim ausente, estado desconhecido:
   a decisão é "não liberado". `NULL` não é `false`.
4. **Operação privilegiada é server-side.** O navegador nunca é autoridade.

## Acesso e papéis

**Sem cadastro público.** O signup está desativado no Auth do Supabase
(`disable_signup = true`), e a tela de login não oferece registro. Contas nascem
por **convite** ou pela mão do administrador, nunca por autosserviço. As demais
opções de Auth (providers, confirmação de e-mail, recuperação) são configuração
externa, do Dashboard do Supabase, e não vêm do repositório: o `config.toml`
não as descreve. Reconferir no Dashboard antes de mexer em Auth.

**Papel é explícito.** O trigger de onboarding cria só o `profiles`. O papel, em
`public.user_roles`, é uma atribuição administrativa separada. O bootstrap
automático do primeiro admin foi **removido** (migration
`remove_automatic_admin_bootstrap`) e não deve voltar.

| Papel                 | Acesso                                                               |
| --------------------- | -------------------------------------------------------------------- |
| `admin` em AAL2       | leitura e escrita nas tabelas de negócio, pelo painel administrativo |
| `admin` em AAL1       | nenhum dado de negócio; o guard envia a `/mfa`                       |
| `operacional`         | **nenhuma** tabela de negócio pelo PostgREST; só as cinco RPCs       |
| autenticado sem papel | nenhum dado de negócio                                               |
| não autenticado       | redirecionado ao login                                               |

`admin` + `operacional` é tratado como `admin`. Sem papel, bloqueia.

## Segundo fator (MFA)

TOTP pelo MFA oficial do Supabase. Nenhum segredo é gerado, guardado ou
conferido pela aplicação, e não existe tabela própria de OTP.

- **`admin`: MFA obrigatório**, sempre AAL2.
- **`operacional`: MFA opcional.** Sem fator verificado, trabalha em AAL1; com
  fator verificado, é barrado em AAL1 até concluir o TOTP. Opcional **não** é
  dispensável: quem optou pelo segundo fator não continua acessando dados só com
  a senha.
- **Conta com fator verificado exige TOTP no login.** Não há caminho que aceite
  só a senha.
- **Falha ao consultar o nível de garantia não é ausência de fator.** Erro
  transitório vai para "não foi possível verificar", nunca para o cadastro de
  fator — cadastrar sobre conta que já tem fator trava a conta.

### A decisão de acesso

Uma só, em `lerAcesso()` (`src/app/(painel)/_autorizacao.ts`), com a lógica pura
em `src/lib/mfa.ts`. Layout, `/mfa`, dashboard e guards apenas a leem.

| Papel efetivo | Nível  | Estado do fator | Decisão            |
| ------------- | ------ | --------------- | ------------------ |
| `admin`       | `aal2` | qualquer        | liberado           |
| `admin`       | `aal1` | com fator       | `mfa-pendente`     |
| `admin`       | `aal1` | sem fator       | `mfa-ausente`      |
| `operacional` | `aal1` | sem fator       | liberado           |
| `operacional` | `aal1` | com fator       | `mfa-pendente`     |
| `operacional` | `aal2` | qualquer        | liberado           |
| sem papel     | —      | —               | bloqueado          |
| qualquer      | outro  | qualquer        | `mfa-indisponivel` |
| qualquer      | `aal1` | indeterminado   | `mfa-indisponivel` |

`mfa-ausente` e `mfa-pendente` fecham o painel do mesmo jeito e mandam para
`/mfa`; a diferença é o fluxo que a tela abre — cadastrar o primeiro fator ou
desafiar um já verificado. Trocar um pelo outro quebra o cadastro inicial do
admin.

### Onde a verdade do MFA mora

`getAuthenticatorAssuranceLevel()` sem argumento **não fala com o servidor**:
`currentLevel` sai da claim `aal` do token, e `nextLevel` sai de
`session.user.factors`, campo do cookie fora da assinatura do JWT. Serve para UX,
não para autorização. Por isso o estado do fator usado no enforcement vem de
`public.mfa_bloqueia_excecao_aal1()` (migration `012`), que lê `auth.mfa_factors`
por `SECURITY DEFINER` e responde se o estado de MFA da conta **impede** a
exceção de AAL1. Ela fecha em quatro casos: fator verificado, sem sessão, erro de
leitura e `uid` do JWT inexistente em `auth.users` (token ainda válido de conta
apagada). `nextLevel` não participa do enforcement do painel; sobrevive só na
recuperação de senha, onde não concede acesso a dado e quem recusa a troca sem
AAL2 é o próprio GoTrue.

A tela `/mfa` fica fora do grupo `(painel)`, para não ser barrada pela guarda que
a invoca. Exige sessão e papel, mas não AAL2 — é o que se vem obter ali.

## Recuperação de senha

- **Token de uso único não se consome em GET.** Gateways de segurança de e-mail
  visitam cada link da mensagem sozinhos, e a varredura queimava a recuperação
  antes do usuário. O `GET /auth/confirm` confere **apenas formato e `type`** e
  guarda o token num cookie `httpOnly`. Quem chama `verifyOtp` — e portanto cria
  a sessão de recuperação — é a Server Action de `/auth/confirmar-recuperacao`,
  disparada por um clique. Conferir a validade de um token de uso único **é**
  consumi-lo; vale para qualquer link desse tipo que venha a existir.
- **Prova HMAC.** Depois do `verifyOtp`, o servidor emite uma prova assinada
  (HMAC-SHA-256, `PASSWORD_RECOVERY_PROOF_SECRET`, só no servidor) que
  `/redefinir-senha` revalida. Sem o segredo, o fluxo falha fechado. As funções
  puras ficam em `src/lib/prova-recuperacao.ts`.
- **Conta com MFA exige exatamente um TOTP** na recuperação. Depois de uma
  redefinição bem-sucedida **não se cobra um segundo**: a sessão que chega ali já
  provou posse do link, da prova e do segundo fator.
- **Depois que a senha muda, a prova é apagada** e não é reutilizável em nenhum
  desfecho posterior. Falhas **anteriores** ao `updateUser` podem preservá-la,
  de propósito, para nova tentativa dentro da validade. A tela nunca diz que a
  redefinição falhou num caminho em que o `updateUser` teve sucesso.

## RLS e banco

- **Todas as tabelas de `public` têm RLS ativa e ao menos uma policy.** Um event
  trigger (`ensure_rls`) habilita RLS em tabela nova.
- Autorização em SQL usa `public.has_role()` e `public.is_staff()`.
  **`is_staff()` é verdadeira para qualquer papel atribuído**, não distingue
  `admin` de `operacional`; por isso não é a barreira entre os dois.
- **MFA também é exigido no banco.** As 11 tabelas de negócio têm policy
  RESTRICTIVE pedindo `aal2` (`*_exige_aal2`). Papel sozinho não distinguia uma
  sessão AAL1, e quem tivesse só a senha alcançaria os dados pelo PostgREST.
- **Acesso direto exige `aal2` E `admin`.** Uma RESTRICTIVE adicional
  `*_exige_admin` (migration `016`) fecha as dez tabelas de negócio para qualquer
  papel que não seja `admin`. Sem ela, um `operacional` que concluísse o TOTP
  alcançava essas tabelas pela policy permissiva de `is_staff()`. Ficam de fora,
  de propósito: `profiles` (cada conta lê a própria linha), `user_roles` (lida em
  AAL1, antes do MFA) e `user_operation_access` (já é admin + AAL2).
- **`user_roles` não recebe policy de AAL2.** O guard lê o papel ainda em AAL1,
  antes de mandar para o MFA; bloqueá-la cria deadlock — seria preciso AAL2 para
  chegar à tela que concede AAL2.
- **Funções `SECURITY DEFINER` rodam acima da RLS**, então policy não as
  protege: cada uma revalida o que precisa por dentro (papel, `aal2`, atribuição),
  com `search_path` fixo e `EXECUTE` revogado de `PUBLIC` e `anon`.
  `gerar_fatura`, por exemplo, confere `aal2` e o papel dentro da função.
- **`TRUNCATE`** está revogado de `anon` e `authenticated` em `public`, e de
  `service_role` **nas 10 tabelas de negócio**, com `ALTER DEFAULT PRIVILEGES`
  para tabelas futuras. Há trigger `BEFORE TRUNCATE` em `timesheet_entries` e
  `invoice_items`, que recusa o comando quando existe lastro faturado — proteção
  por estado, que também dispara em tabelas atingidas por `CASCADE`. Ver o
  resíduo em "Riscos residuais".
- **`SECURITY DEFINER` não é superusuário.** O `postgres` do Supabase **não** é
  superusuário, e o do harness local é: teste de privilégio que passa localmente
  não prova nada sobre Production. `ALTER ... OWNER TO` exige `CREATE` no schema
  para o **novo dono** — conceder antes e revogar depois, na mesma transação.

## Superfície operacional (RPC)

É a **única** porta do `operacional` para os dados. `operacional` lê **zero
linha** de tabela de negócio pelo PostgREST, em AAL1 e em AAL2. A tela
`/operacional` e `src/lib/operacional/` falam exclusivamente com estas funções, e
os testes asseveram isso na forma dos arquivos.

- `public.user_operation_access`: atribuição usuário → operação. Leitura e
  escrita só por `admin` em AAL2 (policy permissiva e RESTRICTIVE de mesmo
  predicado). O operador não a consulta; ela o autoriza.
- Cinco RPCs de contrato fechado: `listar_operacoes_do_operador`,
  `listar_turnos_do_operador`, `listar_equipe_do_operador`,
  `listar_apontamentos_do_operador` e `salvar_apontamento_operacional`.
- **Elegibilidade** (`operador_elegivel_operacional()`): `aal1` com
  `mfa_bloqueia_excecao_aal1() = false` **ou** `aal2`; papel `operacional` e **não**
  `admin`; conta ainda existente; atribuição em `user_operation_access`. A decisão
  é sempre sobre `auth.uid()` — nenhuma RPC aceita `user_id` por parâmetro.
- **`NULL` não é `false`.** Os helpers fecham com `coalesce(..., false)` e as RPCs
  decidem com `IS NOT TRUE`. Um JWT sem a claim `aal` fazia a cadeia de `AND`
  devolver `NULL` e `IF NOT NULL` não dispara: era fail-open.
- **O operador não recebe valor financeiro.** Nem `billed_amount`, `cost_amount`,
  snapshots, `invoice_id`, `daily_cost`, `daily_rate`, `shift_hours`, `ot_factor`,
  `ot_tolerance_min` ou `agreed_amount`. Do cliente atravessa só `cliente_nome`.
  "Faturado" chega como booleano derivado de `public.apontamento_faturado()`, um
  helper de `postgres` que lê `invoice_id` e devolve só o booleano.
- **A escrita aceita seis campos por linha** (`employee_id`, `status`, `check_in`,
  `check_out`, `break_minutes`, `notes`) e **recusa a chamada inteira** com
  `22023` diante de qualquer outra chave. Não existe `DELETE`; linha ausente do
  payload é linha não tocada.
- **As RPCs não rodam como `postgres`.** Pertencem a `bslog_rpc_operacional`:
  `NOLOGIN`, `BYPASSRLS`, sem membership em `anon`, `authenticated` ou
  `service_role`, e com grants **por coluna** — nenhum privilégio de tabela. Sem
  dono próprio, as guardas de `010`/`011` que isentam `postgres` seriam
  contornadas pela superfície do papel menos privilegiado. Um comando que nomeie
  coluna financeira é recusado com `42501` pelo próprio PostgreSQL. Em `timesheets` e `shifts`
  o `UPDATE` é só de `updated_at`, apenas porque o PostgreSQL exige privilégio de
  `UPDATE` para travar linha com `FOR SHARE`, e dois triggers da `011` fazem isso
  no caminho da escrita.
- **Esse papel não tem nada no schema `auth`.** Em Production o `postgres` não
  consegue conceder `USAGE` em `auth` a outro papel; identidade entra por
  `uid_do_operador()`. Uma RPC desta superfície que referencie `auth.*` quebra.
- **Não ampliar grants, não trocar grant de coluna por `GRANT ... ON TABLE`, não
  trocar o dono das funções.** Ao criar helper novo, mantê-lo somente leitura
  (ou mudar o dono).
- A exigência de equipe ativa e a recusa de folha fechada dependem **só do
  contrato da RPC**, não do banco: nenhuma das duas é invariante de banco para
  papel nenhum. Se virar invariante, é tarefa própria.

## Proteção financeira

- **O payload do cliente não é fonte de valor.** `billed_amount`, `cost_amount` e
  os três snapshots (diária, hora extra, custo) são **derivados por trigger**
  (migration `010`) a partir de contrato, operação, turno e colaborador. No
  `INSERT`, a derivação sobrescreve o payload. Um `UPDATE` só em campo derivado é
  **recusado com `42501`**. Um `UPDATE` aceito recalcula **só se alterou coluna
  motriz** (`status`, `check_in`, `check_out`, `break_minutes`, `employee_id`,
  `timesheet_id`); do contrário preserva o gravado — é isso que mantém o snapshot
  congelado. `postgres` e `service_role` escapam **desse bloqueio específico**,
  não das demais proteções.
- **Linha faturada é imutável e o lastro não se destrói** (migration `011`).
  `timesheet_entries` com `invoice_id` recusa `UPDATE` e `DELETE`, inclusive o
  `SET NULL` da FK. O vínculo só nasce em execução como `postgres`, contexto de
  `gerar_fatura`: `authenticated` (admin incluído) e `service_role` não o criam.
- **A fronteira é a API da aplicação.** O gatilho mede `current_user`, então não
  distingue `gerar_fatura` de uma sessão `postgres` escrevendo à mão. Sessão
  `postgres` direta e superusuário ficam fora; nenhuma proteção aqui promete o
  contrário.
- **Bloqueios de `DELETE` com critérios distintos**, não "em uso": cliente só é
  protegido se tiver fatura ou apontamento faturado; contrato, se for o
  `contract_id` **atual** de uma operação com apontamento; turno, se alguma folha
  o referencia. Com faturamento congelam `operations.client_id`, o
  `work_date`/`operation_id`/`shift_id` da folha e a linha do apontamento.
- `break_minutes` não pode ser negativo (migration `014`): valor negativo inflava
  `billed_amount`.
- `src/lib/billing.ts` serve para a interface mostrar o número **antes** de salvar,
  nunca para decidi-lo.

## Fechamento e exportação

`GET /api/fechamento` e `POST /api/fechamento/xlsx` são Route Handlers que **se
protegem sozinhos**: o guard do layout só governa o que a interface mostra, e uma
rota de API é alcançável sem passar por ele.

- **Acesso:** `lerAcesso()` (a decisão única) — sem sessão 401; sem papel
  `admin` ou sem segundo fator 403. Para o admin, `liberado` já implica AAL2;
  não há segunda checagem de nível.
- **Dados:** leitura pelo cliente Supabase da **sessão**, sob RLS (`aal2` e
  `admin`). Nunca `service_role`.
- **Entrada:** o POST aceita só `cliente`, `inicio`, `fim` e `assinatura`, em
  JSON, com corpo de até 1 KB; campo desconhecido, ausente ou fora do formato é 400.
  O corpo é lido **por pedaços e cancelado ao passar do teto** (`lerCorpoComLimite`),
  com ou sem `Content-Length` e mesmo que o cabeçalho minta: nada de acumular o
  corpo inteiro antes de medir. A autenticação vem antes da leitura. Nenhum valor
  financeiro viaja do navegador.
- **Assinatura:** SHA-256 de uma serialização canônica do snapshot financeiro
  (versão `fechamento-v2`). O servidor relê, recalcula e compara; divergência é
  **409** com mensagem fixa. É conferência de **frescor**, não segurança contra o
  navegador. Cobre números, status, datas, fatura, horários e contrato **e os
  textos que a tela e os arquivos mostram** (nome do cliente, do colaborador,
  função, operação e turno, já normalizados): o download é exatamente o que a
  tela exibiu. Não cobre o que não é exibido (ids de turno) nem `geradoEm`. Ao
  navegador vai só o hash.
- **Fórmulas:** o CSV neutraliza texto que começa com `=`, `+`, `-` ou `@`
  (também depois de espaço, TAB ou quebra de linha) em `src/lib/csv.ts`. O XLSX
  escreve todo texto do banco como `String` com formato de texto e nunca usa
  `type: "Formula"`: o XML não contém `<f>`.
- **Resposta:** `Content-Type` do XLSX, `Content-Disposition: attachment` com
  nome reduzido a ASCII seguro, `Cache-Control: no-store`. A CSP e os demais
  cabeçalhos vêm do `proxy.ts`/`next.config.ts`. Teto de **4.000.000 bytes**
  (a Vercel limita a resposta de uma função a 4,5 MB): acima disso é 413, nunca
  arquivo cortado.
- **Erros:** código estável e frase fixa; stack, SQL e mensagens do banco vão só
  para o log do servidor.
- **Dependência:** `write-excel-file` 4.1.1 (licença MIT, única dependência
  transitiva: `fflate`), versão exata, usada só no servidor.

Verificado por suítes (`test:fechamento-csv`, `test:fechamento-xlsx`) e por E2E
contra um Supabase local descartável. Pendências que só o Preview prova estão em
[PROGRESS.md](../PROGRESS.md).

## Administração de usuários e auditoria

Convidar, atribuir ou trocar papel, remover acesso e atribuir operações passam
por `src/lib/admin-usuarios/`, **exclusivamente no servidor**, depois de
`exigirAdminAal2()` (que reaproveita `lerAcesso()`).

- **`service_role` só no servidor**, instanciada em
  `src/integrations/supabase/admin.ts` e só depois dos controles de autorização.
  Nunca em código client, nunca com prefixo `NEXT_PUBLIC_`.
- **O último admin é protegido** no banco (migration `017`): o trigger
  `trg_proteger_ultimo_admin` recusa com `42501` qualquer `DELETE`/`UPDATE` que
  deixaria zero linhas `admin`, **sem isentar `postgres` nem `service_role`**. A
  decisão é serializada por `pg_advisory_xact_lock`; sem o lock, duas transações
  concorrentes removendo admins diferentes passavam ambas.
- **Revogar acesso** segue uma ordem deliberada: remover papéis (único passo que o
  trigger pode recusar) → limpar as atribuições em `user_operation_access` (pela
  sessão RLS do admin) → banir a conta pela Admin API. Reativar concede o papel
  primeiro e só depois desbane; não restaura as operações removidas. Falha no
  meio de uma sequência já iniciada devolve `"parcial"`, nunca `"erro"`.
- **Alteração de usuário ou papel é auditada** em `public.admin_audit_log`:
  leitura só `admin` em AAL2, sem grant de escrita para `authenticated` (a
  migration `018` normaliza os grants da tabela pelo menor privilégio). Só
  `service_role` grava, então nem um admin adultera a própria trilha.
- **A auditoria é best-effort, não garantia transacional.** Se a alteração já
  ocorreu e a gravação do evento falha, a alteração **não é revertida** — a falha
  só é registrada no servidor. Não afirmar cobertura absoluta de auditoria.

## Segredos

| Item                             | Regra                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`      | só servidor; nunca `NEXT_PUBLIC_`; ausente, falha fechada   |
| `PASSWORD_RECOVERY_PROOF_SECRET` | só servidor; ao menos 32 bytes aleatórios em produção       |
| `NEXT_PUBLIC_SUPABASE_*`         | públicas por natureza; quem protege os dados é a RLS        |
| credenciais de SMTP / e-mail     | só no Dashboard do Supabase; nunca em Git, `.env` ou Vercel |
| `.env`, `.env.local`             | fora do Git; só `.env.example` é versionado, sem valores    |

**Nenhuma variável `NEXT_PUBLIC_*` pode conter segredo:** o prefixo embute o
valor no bundle do navegador. O Sentry roda com `userInfo`, `httpBodies`, cookies,
headers e query params desligados, e não há source maps servidos ao navegador.

## Isolamento entre ambientes

`NODE_ENV` **não** identifica o ambiente: um Preview da Vercel também roda com
`NODE_ENV=production`. O critério é `VERCEL_ENV`, e **só `VERCEL_ENV=production`
conta como Production** (`src/lib/ambiente.ts`). Ausente, vazio, outro valor ou
caixa diferente é "não Production" — nunca há promoção por fallback. No navegador
`VERCEL_ENV` não existe; `next.config.ts` publica o valor no build como
`NEXT_PUBLIC_AMBIENTE` (não depende de a Vercel expor `NEXT_PUBLIC_VERCEL_ENV`).

| Item                                        | Production                                                             | Preview, Development, local, CI, E2E                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sentry (servidor, edge, navegador)          | habilitado, DSN e 10% de traces como antes, coleta restrita preservada | `enabled: false`, sem DSN, traces 0, Replay sempre 0                                                                  |
| Túnel `/monitoring`                         | existe                                                                 | não existe (404)                                                                                                      |
| Source maps, release e telemetria do plugin | como antes                                                             | desligados — **não dependem** de `SENTRY_AUTH_TOKEN` estar ausente                                                    |
| `report-uri` da CSP                         | presente                                                               | ausente                                                                                                               |
| Supabase de Production                      | permitido                                                              | **barrado** na Vercel (build e runtime); fora da Vercel não se aplica. Exceção temporária só para Preview: ver abaixo |

**Gate do Supabase** (`verificarDestinoSupabase`): fora de Production na Vercel, uma
`NEXT_PUBLIC_SUPABASE_URL` que aponte para o projeto de Production — ou que não
possa ser lida — faz o **build falhar** (`next.config.ts`) e, de novo, a leitura em
runtime (`lerAmbienteSupabase`) lançar, com mensagem fixa que não cita URL nem
chave. A referência de Production usada na comparação é pública (a mesma de
`supabase/config.toml`) e fica num único arquivo. Limites honestos:

- ele barra o **projeto de Production**; não prova que o destino seja um ambiente
  de teste. Um Preview só é isolado de fato se tiver um projeto Supabase próprio
  nas variáveis do escopo Preview;
- o desenvolvimento **local** (sem `VERCEL_ENV`) continua livre para usar o
  `.env` de quem o roda, que hoje aponta para Production. Isso é decisão de
  fluxo, não coberta pelo gate;
- se a URL de Production um dia passar a um domínio próprio, a comparação por
  referência deixa de reconhecê-la — atualizar `REFERENCIA_SUPABASE_PRODUCTION`.

### Preview com Supabase compartilhado (exceção TEMPORÁRIA)

**Por quê:** hoje o projeto Supabase só tem dados **fictícios** e ainda não foi
entregue ao cliente, e os Previews sempre usaram esse mesmo projeto. Enquanto isso
for verdade, o fluxo pode continuar — mas só por autorização explícita, nunca por
padrão.

| Item               | Valor                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| Variável           | `BS_PREVIEW_SHARED_SUPABASE`                                                  |
| Valor que autoriza | exatamente `true` (`false`, vazio, `TRUE`, `1`, `yes`, com espaço: bloqueiam) |
| Escopo             | **só Preview** na Vercel; servidor, **nunca** `NEXT_PUBLIC_`                  |
| Efeito             | libera o Preview a usar o Supabase de Production **e nada mais**              |

Regras do código (`previewCompartilhadoAutorizado`, em `src/lib/ambiente.ts`):

- só vale com `VERCEL_ENV === "preview"` exato **e** a variável `true` exata;
- Production não a lê (o comportamento original não depende dela); Development,
  ambiente desconhecido e CI/local (sem `VERCEL_ENV`) não ganham nada com ela;
- a URL continua validada por inteiro antes de qualquer liberação (https, ou http
  em loopback; sem credenciais; legível): URL inválida segue bloqueada com a flag;
- build e runtime usam a mesma regra: o `next.config.ts` avalia no build e **de novo
  ao subir o servidor**. Um build feito com a flag não sobe sem ela, e vice-versa;
- o build imprime um **aviso** quando um Preview usa o banco compartilhado;
- **não** compartilha monitoramento: com a flag, o Sentry continua desligado, sem
  DSN, sem traces, sem túnel `/monitoring`, sem source maps e sem `report-uri`;
- no navegador o valor não existe (a variável não é `NEXT_PUBLIC_`); lá o gate não
  roda, e quem decidiu foi o build.

**Riscos de usar o banco compartilhado:** um deploy de Preview — de qualquer
branch, de qualquer pessoa com acesso ao repositório — lê e **escreve** nos mesmos
dados que Production. Contas e papéis são os mesmos. Preview e Production dividem
Auth, RLS e as RPCs; um Preview com código em teste pode gravar dados inválidos.
Só é aceitável porque os dados são fictícios.

**É PROIBIDO usar essa exceção quando houver dados reais.**

**ANTES DA ENTRADA DE DADOS REAIS** (procedimento de revogação):

1. Remover `BS_PREVIEW_SHARED_SUPABASE` do escopo Preview na Vercel (Settings →
   Environment Variables) e, se existirem, de **overrides por branch**. Fazer um
   novo deploy: variável de ambiente só vale num deploy novo.
2. Definir um Preview isolado (projeto Supabase de teste, com variáveis próprias no
   escopo Preview) **ou** interromper os Previews conectados ao banco oficial.
3. Validar que não restam deploys antigos de Preview com acesso compartilhado
   (listar os deploys de Preview e removê-los ou desativá-los).
4. Executar a limpeza controlada dos dados fictícios, em **procedimento separado**
   (não descrito aqui, não executado automaticamente).

Depois do passo 1, qualquer Preview apontando para o Supabase de Production volta
a falhar no build — que é o comportamento seguro por padrão.

**Como configurar na Vercel** (feito pelo responsável, no painel; este repositório
não altera a Vercel): Settings → Environment Variables → Add → nome
`BS_PREVIEW_SHARED_SUPABASE`, valor `true`, ambiente **somente Preview** (não
marcar Production nem Development, e **não** usar "All Environments"). Não mexer nas
variáveis de Production. É preciso um **novo deploy** para aplicar. Se a Vercel
oferecer a opção de limitar a variável a uma branch de Preview, é uma restrição
extra bem-vinda; se o projeto já tiver variáveis por branch, conferi-las — não foi
possível verificar isso a partir daqui.

**Configuração que continua sendo da Vercel** (não verificada a partir do
repositório): variáveis do escopo Preview, vínculo do repositório ao projeto e
deploy automático no push. Ver as pendências em [PROGRESS.md](../PROGRESS.md).

## Cabeçalhos HTTP e CSP

Em `next.config.ts`, para todas as rotas: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` e
`Permissions-Policy` negando câmera, microfone, geolocalização, pagamento e USB.

**HSTS vem da plataforma** (Vercel, borda do domínio próprio). **Não duplicar na
aplicação**: criaria duas fontes de verdade. Sem `includeSubDomains` até mapear
todos os subdomínios, e sem `preload` sem decisão explícita — sair da lista dos
navegadores leva meses. Se a origem sair da Vercel, o header passa a ser da
aplicação.

**`Content-Security-Policy` está em enforcement**, montada por requisição em
`src/proxy.ts` com **nonce** (precisa mudar a cada requisição, por isso não está
em `next.config.ts`):

```
default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self' <origem do Supabase>;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
upgrade-insecure-requests; report-uri <endpoint do Sentry — só em Production>
```

- O nonce cobre os scripts inline que o Next injeta no streaming do RSC, sem
  `unsafe-inline` em `script-src`. O `RootLayout` chama `headers()`, o que força
  renderização por requisição — é o custo do nonce: `/`, `/login` e
  `/esqueci-senha` deixam de ser estáticas.
- O script de tema é um arquivo (`public/theme-script.js`), o que elimina o único
  `dangerouslySetInnerHTML` alcançável.
- A origem do Supabase em `connect-src` vem de `NEXT_PUBLIC_SUPABASE_URL`,
  validada por `origemDoSupabase()` (https, ou http só em loopback; sem
  credenciais) — não há host fixo no código nem host vindo da requisição. A
  montagem está em `src/lib/csp.ts`. O `report-uri` do Sentry só existe em
  Production; ver "Isolamento entre ambientes".
- O Sentry usa o túnel `/monitoring` (same-origin) **só em Production**; fora dela
  a rota não existe.
- As fontes são auto-hospedadas por `next/font`, por isso `font-src 'self'`.
- **`style-src` mantém `'unsafe-inline'`** — Radix/shadcn usam estilo inline para
  posicionamento. Apertar isso é etapa própria (ver riscos residuais).

## Frontend

- **Exportação CSV** (`src/lib/csv.ts`): toda célula sai entre aspas com aspas
  internas duplicadas (RFC 4180), registro terminando em CRLF, e valor que comece
  com caractere de fórmula (`=`, `+`, `-`, `@`, TAB, CR) recebe apóstrofo
  inicial. Número puro passa intacto: `-123` não é fórmula.
- **CRUD genérico sem allowlist de colunas** (`useSaveRow`): não é fronteira de
  segurança — é código de navegador, e quem quisesse enviar campos arbitrários
  chamaria o PostgREST direto. O controle é a RLS, mais os triggers e guardas de
  coluna. A correção certa é RLS e privilégio de coluna, nunca allowlist no
  navegador.
- **Escrita recusada pela RLS** não pode parecer sucesso: um `UPDATE`/`DELETE`
  bloqueado afeta zero linhas sem erro, e `exigirLinhaAfetada()`
  (`src/lib/mutations.ts`) trata `count === 0` como falha.
- Nenhum `eval`, `new Function` ou `.innerHTML` no código da aplicação. O único
  `src` dinâmico é o QR do MFA, entregue como data URI em `<img>`, onde SVG não
  executa script. O `alt` do QR é neutro de propósito: a `totp.uri` carrega o
  segredo TOTP.

## Infraestrutura

- Vercel, projeto do sistema, com domínio customizado em Production. O site
  institucional é **outro projeto e outro repositório**.
- **Preview** não tem as variáveis `NEXT_PUBLIC_SUPABASE_*`, de propósito: o build
  de Preview falha. Não conectar Preview ao banco de produção para deixar o check
  verde.
- Sem as variáveis, o build falha na pré-renderização nomeando o que falta, em
  vez de publicar uma aplicação quebrada.
- **Nunca `supabase config push`.** O `config.toml` não descreve a configuração de
  Auth real; um push aplicaria padrões do CLI e desligaria MFA, confirmação de
  e-mail e a Site URL de produção.
- Dependências: `npm audit` deve permanecer em zero; o estado atual está em
  [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md).

## Riscos residuais

Nenhum bloqueia a operação atual. Cada item tem uma condição objetiva de
fechamento.

| Risco                                                                            | Severidade  | Situação e condição de fechamento                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proteção contra senhas vazadas indisponível** (HaveIBeenPwned exige plano Pro) | baixa       | Risco aceito. Controle equivalente em vigor: o MFA do admin é obrigatório, então a senha sozinha não abre o painel. Fecha com upgrade de plano.                                                                                                                                                                                                                                                                                                     |
| **`TRUNCATE` ainda concedido a `service_role` em `profiles` e `user_roles`**     | baixa       | A migration `011` listou só as 10 tabelas de negócio, e `ALTER DEFAULT PRIVILEGES` não mexe em grant existente. Exige a chave `service_role` **e** conexão direta ao Postgres (o PostgREST não expõe `TRUNCATE`). Fecha revogando, ou registrando como risco aceito: decisão de quem responde pelo projeto.                                                                                                                                         |
| **Grants herdados dos default privileges do Supabase** em tabelas de `public`    | informativa | `anon` e `authenticated` herdam privilégios de tabela além do necessário. Não é acesso: nenhuma policy alcança `anon` e a RLS nega por padrão, verificado em execução. Um `REVOKE` seria defesa em profundidade, mas muda o retorno da API de "vazio" para `42501` e deve ser testado antes.                                                                                                                                                        |
| **Sem FK de `profiles` e `user_roles` para `auth.users`**                        | baixa       | Remover usuário pelo painel do Supabase não limpa essas tabelas e deixa registros órfãos. Ao remover uma conta, apagar antes as linhas dessas duas tabelas. A remoção pelo backend administrativo (revogar e banir) não apaga a conta.                                                                                                                                                                                                              |
| **`style-src 'unsafe-inline'` na CSP**                                           | baixa       | Necessário hoje para Radix/shadcn. Apertar exige nonce ou hash para estilo.                                                                                                                                                                                                                                                                                                                                                                         |
| **Perda do autenticador do admin**                                               | operacional | Um fator verificado perdido só se remove pelo painel do Supabase. Mitigação organizacional (mais de um admin com MFA); não é defeito de código.                                                                                                                                                                                                                                                                                                     |
| **Proveniência da taxa faturada não é preservada**                               | baixa       | Um admin ainda altera `operations.contract_id`, `agreed_amount`, as taxas do contrato e `employees.daily_cost`, porque não há gatilho de congelamento em `contracts` e `employees`, e as guardas de `operations` isentam admin. **O valor já cobrado não muda** (a entry carrega os snapshots congelados), mas perde-se a resposta para "de qual contrato e com que taxa saiu esta fatura". Fechar exige decisão de desenho: congelar ou versionar. |
| **Paridade `calcEntry()` × derivação SQL é manual**                              | baixa       | A regra existe em TypeScript e em trigger; os testes de banco guardam constantes, não executam as duas implementações lado a lado. Toda mudança em `calcEntry()` exige revisão explícita da paridade.                                                                                                                                                                                                                                               |
| **Exportação do fechamento: limite de 4 MB e 413 não exercitados**               | baixa       | O teto existe e a decisão é testada como função pura, mas nenhum arquivo chegou perto dele (12.400 lançamentos ≈ 650 KB). Fecha no Preview, ou com um volume que o justifique.                                                                                                                                                                                                                                                                      |
| **Leitura do fechamento lenta em volume alto**                                   | informativa | A leitura é paginada e provada completa; 12.400 lançamentos levaram ~20 s localmente. Dentro do limite da função, mas é o primeiro lugar a otimizar se o uso crescer.                                                                                                                                                                                                                                                                               |
| **Auditoria best-effort**                                                        | informativa | Ver "Administração de usuários e auditoria".                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Alocação de equipe sem autor nem histórico**                                   | informativa | `operation_team` não registra quem alocou. Só `admin` escreve nela, mas não há trilha por linha.                                                                                                                                                                                                                                                                                                                                                    |
| **Mensagens cruas do SDK em `/mfa` e `link-invalido` genérico na recuperação**   | informativa | Melhoria de diagnóstico; separar os desfechos exige mudar mensagens e destinos, em tarefa própria.                                                                                                                                                                                                                                                                                                                                                  |
