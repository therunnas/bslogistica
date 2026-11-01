# BS Soluções Logística — instruções permanentes

Este arquivo é carregado em toda sessão. Contém apenas o que **não muda**: regras,
invariantes e fluxo de trabalho. O estado atual de Production, de testes e de
migrations vive em [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md); a etapa
atual e as decisões em aberto, em [PROGRESS.md](PROGRESS.md). Leia este arquivo e
o `PROGRESS.md` antes de agir.

`AGENTS.md` traz um subconjunto menor, para agentes que não leem este arquivo. Os
dois não precisam ser iguais, mas **as regras que compartilham não podem se
contradizer**: ao mudar uma regra compartilhada, mude nos dois.

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
Node ≥ 22.6.

**Não reintroduzir:** TanStack Start, TanStack Router, Vite, Nitro, Vinxi,
Wrangler, Lovable. Foram removidos de propósito. `@tanstack/react-query`
**permanece** — é a camada de dados e não tem relação com o TanStack Router.

## Arquitetura (mapa mínimo)

```
src/app/(painel)/            área protegida; layout.tsx é o guard
  _autorizacao.ts            decisão de acesso, no servidor (lerAcesso)
  _papel.ts · _exigir-admin.tsx · _exigir-operacional.tsx
  operacional/               apontamento do operador, só pelas RPCs
src/app/login · mfa · esqueci-senha · auth/ · redefinir-senha
                             irmãs de (painel)/, fora do guard, de propósito
src/lib/billing.ts           cálculo de diária, hora extra, custo (previsão)
src/lib/ledger.ts            consolidação apontamento → cliente
src/lib/mfa.ts               decisões de segundo fator e de acesso, puras
src/lib/operacional/         contratos e hooks das RPCs — sem tabela direta
src/lib/fechamento/          Fechamento: lê lançamentos e funções do banco (030), soma e concilia
                             (a regra financeira é do banco); API em src/app/api/fechamento/
src/lib/admin-usuarios/      administração de usuários, server-side
src/lib/prova-recuperacao.ts prova HMAC da recuperação, funções puras
src/integrations/supabase/   clientes (browser/server/admin) e tipos do banco
src/proxy.ts                 renovação de sessão e CSP com nonce
supabase/migrations/         esquema, RLS, triggers e RPCs
supabase/tests/              testes SQL
```

**`proxy.ts`, nunca `middleware.ts`.** No Next.js 16 a convenção foi renomeada;
um `middleware.ts` é ignorado em silêncio e a sessão para de ser renovada.

Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Comandos e validação

| Comando               | O que faz                                |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | servidor de desenvolvimento              |
| `npm run build`       | build de produção                        |
| `npm run lint`        | ESLint com Prettier                      |
| `npm run test:<nome>` | uma suíte Node (lista em `package.json`) |

Os scripts `test:*` exigem Node ≥ 22.6 (`--experimental-strip-types`). Várias
asseveram a **forma literal** do código, não só o comportamento. **Mexer em auth,
MFA, recuperação ou nas telas exige rodar todas.**

**Antes de entregar:** `npm run lint`, `npx tsc --noEmit`, todas as suítes
`test:*` e `npm run build`. A CI (`.github/workflows/ci.yml`) roda essa sequência
em todo PR e em push para `main`, sem secret e sem tocar o Supabase de Production.
Os testes SQL não rodam nela.

Erro de Prettier introduzido por uma edição se corrige **à mão**, não com
`--fix` — o formatador reescreve arquivos que não fazem parte da tarefa.

## Auth

- **Sem cadastro público.** `disable_signup = true`. Contas nascem por convite ou
  pela mão do admin — nunca por autosserviço. A tela de login não oferece
  registro.
- **Papel é explícito.** O trigger de onboarding cria apenas o `profiles`. Papel
  em `public.user_roles` é atribuição administrativa separada — nunca
  automática. Não reintroduzir bootstrap automático de admin.
- **Operação administrativa privilegiada é server-side.** Convidar, atribuir ou
  trocar papel, remover acesso: nada disso passa pelo navegador como autoridade.
  O frontend nunca é a barreira.
- **O último admin é protegido.** Nenhum caminho remove ou rebaixa o único
  administrador restante.
- **Alteração de usuário ou papel é auditada.** A auditoria é _best-effort_: não
  afirmar cobertura transacional.
- **MFA TOTP é OPCIONAL para `admin` e para `operacional` e protege só o LOGIN e a
  própria conta** (AUTH-01D.R1). Sem fator: e-mail e senha e todas as funcionalidades
  do papel. Com fator: TOTP em todo novo login, sessão AAL1 barrada no app e no banco,
  e depois do TOTP tudo do papel, **sem novo código por operação**. **Opcional não é
  dispensável**: quem ativou continua obrigado a concluir o TOTP no login. Nenhum
  papel entra no painel com estado de MFA desconhecido.
- **Nenhuma funcionalidade exige AAL2.** Os guards (`exigirAdmin`, `exigirAdminAtor`)
  conferem sessão liberada e papel; no banco `condicoes_exigir_admin()`, `gerar_fatura`
  e as policies usam `mfa_cotidiano_ok()` (034). **Não reintroduzir exigência de AAL2
  por função.** Única exceção: desativar o PRÓPRIO fator pede código novo
  (`challengeAndVerify` antes de `unenroll`), imposto só pela interface — o GoTrue
  exige apenas AAL2 para o `unenroll`, limite registrado em
  [docs/SEGURANCA.md](docs/SEGURANCA.md). Risco assumido: conta sem MFA fica protegida
  só pela senha; recomenda-se que admins ativem.
- **Conta com MFA ativo exige TOTP no login.** Não existe caminho que aceite só a
  senha para uma conta com fator verificado.
- **Recovery de conta com MFA exige um TOTP — e apenas um.** Depois de uma
  redefinição bem-sucedida, não cobrar um segundo: a sessão que chega ali já
  provou posse do link, da prova HMAC e do segundo fator.
- **Falha ao consultar o nível de garantia não é ausência de fator.** Erro
  transitório vai para a tela "não foi possível verificar", nunca para o cadastro
  de fator — cadastrar sobre conta que já tem fator trava a conta.
- **Token de recuperação não se consome em GET.** O `GET /auth/confirm` confere
  **apenas formato e `type`** e guarda o token num cookie `httpOnly`; quem chama
  `verifyOtp` é a Server Action de `src/app/auth/confirmar-recuperacao/`,
  disparada por um clique. Gateways de e-mail visitam cada link sozinhos.
  Conferir a validade de um token de uso único **é** consumi-lo. Vale para
  qualquer link desse tipo que venha a existir.
- **Depois que a senha muda com sucesso, a prova é apagada.** Falhas anteriores
  ao `updateUser` podem preservá-la, de propósito. A tela nunca diz que a
  redefinição falhou num caminho em que o `updateUser` teve sucesso.
- O guard governa **o que a interface mostra**. Quem protege os dados é a RLS.

### Decisão de acesso

A decisão mora em **`lerAcesso()`**, é uma só, e layout, `/mfa`, `/dashboard` e os
guards apenas a leem. **Não recriar essa decisão** em outro lugar: duas definições
de "liberado" produzem laço entre as rotas.

- Sem fator verificado, `admin` e `operacional` são liberados em AAL1 (`nivel:
"aal1"`). **Com** fator verificado, em AAL1 são barrados em `mfa-pendente` e
  mandados para `/mfa` até concluir o TOTP. `mfa-ausente` deixou de ser uma decisão
  do painel.
- `admin` + `operacional` decide como admin. Sem papel, bloqueia. Erro de leitura,
  claim `aal` ausente ou nível desconhecido **fecha**.
- O estado do fator **não vem do cookie**: vem de
  `public.mfa_bloqueia_excecao_aal1()`, consultada no servidor. `nextLevel` não
  participa do enforcement do painel.

A tabela completa está em [docs/SEGURANCA.md](docs/SEGURANCA.md). **Nunca
implementar isso só no guard ou no frontend:** o enforcement do banco é o que vale.

## RLS e banco

- **A RLS é a proteção real.** Nunca tratar o guard do layout como substituto.
- Todas as tabelas de `public` têm RLS ativa. Autorização em SQL usa
  `public.has_role()` e `public.is_staff()`; **`is_staff()` vale para qualquer
  papel atribuído**, não separa `admin` de `operacional`.
- **O piso de MFA vale no banco** (migrations 032 e 034): todas as policies e funções
  usam `mfa_cotidiano_ok()` (AAL2 se a conta tem fator verificado; AAL1 se não tem;
  sessão inválida nega). Os nomes `*_exige_aal2` são históricos. **Papel continua
  sendo exigido em tudo** (`has_role`, `*_exige_admin`). A proteção da 033
  (INSERT de taxa legada exige vigência com o motor ligado) é independente e não
  deve ser removida numa reversão do MFA.
- **Acesso direto também exige `admin`.** Uma RESTRICTIVE `*_exige_admin` por
  tabela de negócio exige o papel `admin`, além do piso `mfa_cotidiano_ok()`:
  AAL1 sem fator verificado ou AAL2 com fator verificado. O
  `operacional` lê zero linha de tabela de negócio pelo PostgREST, em qualquer
  nível: a RPC é a única porta dele.
- **A CSP está em enforcement** (nonce por requisição, montada em `src/proxy.ts`).
  Não afrouxar nem voltar para `report-only`; ver
  [docs/SEGURANCA.md](docs/SEGURANCA.md).
- **`user_roles` fica fora do enforcement de MFA, de propósito.** O guard lê o
  papel em AAL1, antes do MFA; bloquear a tabela cria deadlock. Não adicionar
  policy de MFA nela.
- **Função `SECURITY DEFINER` roda acima da RLS**, então policy não a protege: a
  exigência do piso de MFA (`mfa_cotidiano_ok()`) e de papel precisa estar escrita
  dentro da função, como em `gerar_fatura`. Vale para toda RPC nova com `SECURITY DEFINER`.

### A superfície operacional (RPC)

Cinco RPCs de contrato fechado — `listar_operacoes_do_operador`,
`listar_turnos_do_operador`, `listar_equipe_do_operador`,
`listar_apontamentos_do_operador` e `salvar_apontamento_operacional` — mais
`public.user_operation_access` e os helpers internos. A interface as consome por
`src/lib/operacional/` e pela tela `/operacional`, e só por elas. O desenho
completo está em [docs/SEGURANCA.md](docs/SEGURANCA.md). Regras permanentes:

- **O operador não recebe valor financeiro.** Nem `billed_amount`, `cost_amount`,
  snapshot, `invoice_id`, `daily_cost`, `daily_rate`, `shift_hours`, `ot_factor`,
  `ot_tolerance_min` ou `agreed_amount`. Do cliente atravessa **apenas
  `cliente_nome`**. "Faturado" chega como **boolean derivado**.
- **A escrita aceita seis campos por linha** (`employee_id`, `status`,
  `check_in`, `check_out`, `break_minutes`, `notes`) e **recusa a chamada
  inteira** com `22023` diante de qualquer outra chave. Não existe DELETE.
- **Cada função revalida tudo por dentro:** papel `operacional` (não `admin`),
  nível aceito (`aal1` sem MFA bloqueando, ou `aal2`), conta existente e
  atribuição em `user_operation_access`. A decisão é sempre sobre `auth.uid()`;
  **nunca** aceitar `user_id` por parâmetro. Nunca acrescentar RPC aqui sem essa
  verificação completa.
- **`NULL` não é `false`.** Os helpers fecham com `coalesce(..., false)` e as RPCs
  decidem com `IS NOT TRUE`. Um claim `aal` ausente fazia a cadeia de `AND`
  devolver `NULL`, e `IF NOT NULL` não dispara — era fail-open.
- **As RPCs não rodam como `postgres`.** Pertencem a `bslog_rpc_operacional`
  (`NOLOGIN`, `BYPASSRLS`, sem membership nos papéis da API), porque as guardas
  das migrations de proteção financeira isentam `postgres`. **Todos os grants do
  papel são por coluna**, nenhum por tabela, e ele não tem nenhuma coluna
  financeira, nem para ler. **Não ampliar esses grants, nunca trocar grant de
  coluna por `GRANT ... ON TABLE`, e não trocar o dono das funções.**
- **O papel não tem nada no schema `auth`.** Em Production o `postgres` não
  consegue conceder `USAGE` em `auth` a outro papel; uma RPC que referencie
  `auth.*` quebra. Identidade entra por `uid_do_operador()`.
- **Helpers de `postgres` não escrevem**, e é isso que os torna seguros. Ao criar
  helper novo, manter essa propriedade ou mudar o dono. Para campo derivado de
  dado sensível, seguir o padrão de `apontamento_faturado()` em vez de conceder a
  coluna.
- O trigger `protect_timesheet_invoice_link` foi aposentado: forçava um privilégio
  impossível em Production e não protegia mais nada. **Não recriar.**
- Equipe ativa e folha fechada dependem só do contrato da RPC, não de invariante
  de banco. Se virarem invariante, é tarefa própria.

### Proteção financeira

- **O payload do cliente não é fonte de valor financeiro.** `billed_amount`,
  `cost_amount` e os três snapshots são **derivados por trigger**. No `INSERT` a
  derivação **sobrescreve** o payload; um `UPDATE` que mexa **apenas** em campo
  derivado é **recusado com `42501`**; um `UPDATE` aceito **recalcula só se
  alterou coluna motriz** (`status`, `check_in`, `check_out`, `break_minutes`,
  `employee_id`, `timesheet_id`) e do contrário **preserva** o gravado, descartando
  o payload — é a preservação que mantém o snapshot congelado. `postgres` e
  `service_role` são isentos **desse bloqueio específico**, não das demais
  proteções. Não usar "recalcula" como descrição genérica de `UPDATE`.
- **`src/lib/billing.ts` serve para a interface mostrar o número antes de salvar,
  não para decidi-lo.** A paridade com a derivação SQL é conferida à mão; toda
  mudança em `calcEntry()` exige revisar essa paridade.
- **Linha faturada é imutável e o lastro não se destrói.** `timesheet_entries` com
  `invoice_id` preenchido recusa `UPDATE` e `DELETE`, inclusive o `SET NULL` da FK.
  O vínculo só nasce em execução como `postgres`, contexto de `gerar_fatura`:
  `authenticated` (admin incluído) e `service_role` não o criam. A fronteira é a
  API da aplicação; **sessão `postgres` direta e superusuário ficam fora dela**.
- Os bloqueios de `DELETE` têm **critérios distintos**, não "em uso": cliente só é
  protegido se tiver fatura ou apontamento faturado; contrato, se for o
  `contract_id` atual de uma operação com apontamento; turno, se alguma folha o
  referencia. Com faturamento **não** congelam `operations.contract_id`,
  `agreed_amount`, as taxas do contrato nem `employees.daily_cost`: o já faturado
  não muda (os snapshots estão congelados), perde-se proveniência.
- `TRUNCATE` está revogado de `anon` e `authenticated` em `public`, e de
  `service_role` apenas nas 10 tabelas de negócio. Há trigger `BEFORE TRUNCATE`
  sobre `timesheet_entries` e `invoice_items`.
- **Não alterar RLS, policies, grants, triggers ou regras financeiras** (diária,
  hora extra, custo, faturamento) fora de tarefa com esse escopo explícito. Não
  afrouxar nenhuma proteção acima sem tarefa de escopo próprio.

### Migrations

- **Nunca editar migration já aplicada**, nem para corrigir. Criar nova com
  `supabase migration new <nome>`. Quais estão em Production está em
  [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md).

### Supabase CLI — armadilhas reais deste ambiente

- **`supabase db query` inline executa só a primeira linha.** Sempre usar
  `-f <arquivo>`, que envia o arquivo inteiro e honra `BEGIN`/`ROLLBACK`. Ignorar
  isso já causou perda de dados aqui.
- **`SUPABASE_ACCESS_TOKEN` do ambiente é inválido** e sobrepõe o `supabase login`.
  Prefixar todo comando com `env -u SUPABASE_ACCESS_TOKEN`.
- **`.env` define `SUPABASE_PROJECT_ID`**, que vence `config.toml` e
  `.temp/project-ref`. Se um comando parecer apontar para o projeto errado, é daí.
- O SQL Editor e o `db query` conectam como `postgres`, dono das tabelas — **a RLS
  não é aplicada**. Para testar policy, trocar o papel com `SET LOCAL ROLE
authenticated` e injetar as claims com `set_config`.
- **`db query` é caminho de leitura.** Escrita só pelo SQL Editor ou por transação
  guardada explicitamente autorizada, com pré-condições reverificadas dentro da
  transação e `GET DIAGNOSTICS` em cada comando.
- **O `postgres` do Supabase NÃO é superusuário; o do harness local é.** Toda
  verificação de privilégio que passa localmente herda essa ressalva: superusuário
  pula checagem de ACL. Ao transferir posse de objeto (`ALTER ... OWNER TO`), o
  **novo dono precisa de `CREATE` no schema**: conceder imediatamente antes e
  revogar imediatamente depois, na mesma transação — nunca deixar permanente. O
  harness não simula isso por completo; exige experimento isolado com executor
  não-superusuário.
- **Nunca `supabase config push`.** O `config.toml` não descreve a configuração de
  Auth real; um push aplicaria padrões do CLI e desligaria MFA, confirmação de
  e-mail e a Site URL de produção.
- Nunca `TRUNCATE`, `DELETE` sem `WHERE`, por `LIKE` ou por prefixo. Só UUID
  exato, em transação com asserção final.

## Segredos

- **`service_role` nunca vai para o cliente.** A aplicação a usa exclusivamente no
  servidor, nas operações administrativas de usuários e somente depois dos
  controles de autorização do backend. Nunca prefixar com `NEXT_PUBLIC_`,
  importar em código client ou remover a variável enquanto essa integração
  existir.
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
- Deploy pela Vercel a partir de `main`. Production tem as variáveis
  `NEXT_PUBLIC_SUPABASE_*`; **Preview não tem, de propósito** — e por isso o build
  de Preview falha. Não conectar Preview ao banco de produção para deixar o check
  verde.

## Método

- Verificar antes de afirmar. Se a conclusão anterior — minha, do usuário ou de um
  documento — não bater com o repositório, **parar e reportar** em vez de seguir
  sobre premissa falsa.
- Não inventar valor de configuração de terceiro (DNS, provedor de e-mail):
  copiar do painel real.
- Relatar o que aconteceu, incluindo o que falhou ou foi pulado.
- **Não criar usuário `operacional` real** antes da matriz E2E descrita em
  [PROGRESS.md](PROGRESS.md).

## Documentação

| Documento                                              | Conteúdo                                          |
| ------------------------------------------------------ | ------------------------------------------------- |
| [README.md](README.md)                                 | porta de entrada: instalação, comandos            |
| [PROGRESS.md](PROGRESS.md)                             | **etapa atual, riscos abertos e próximos passos** |
| [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md) | fotografia factual: Production, testes, módulos   |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md)             | organização do código e fluxo de dados            |
| [docs/SEGURANCA.md](docs/SEGURANCA.md)                 | modelo de segurança e riscos residuais            |
| [docs/divida-tecnica/](docs/divida-tecnica/)           | histórico das dívidas já resolvidas, com índice   |

Estado mutável tem **uma única fonte**: `ESTADO_DO_PROJETO.md`. Não o repita em
outros arquivos; aponte para ele.
