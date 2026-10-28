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
│   ├── layout.tsx            layout raiz: fontes (next/font), metadata, providers
│   ├── providers.tsx         TanStack Query e Toaster (client)
│   ├── page.tsx              entrada pública, redireciona para /login
│   ├── login/ · mfa/         entrada e segundo fator
│   ├── esqueci-senha/ · auth/ · redefinir-senha/
│   │                         recuperação de senha (ver SEGURANCA.md)
│   └── (painel)/             área protegida
│       ├── layout.tsx        guard no servidor
│       ├── _autorizacao.ts   decisão de acesso (sessão → papel → MFA)
│       ├── _papel.ts         papel efetivo
│       ├── _exigir-admin.tsx · _exigir-operacional.tsx   guards por tela
│       ├── _acoes.ts         logout (Server Action)
│       ├── _components/      app-shell e telas de acesso não liberado
│       └── <modulo>/
│           ├── page.tsx           servidor: exporta metadata
│           └── painel-<modulo>.tsx cliente: a tela
├── components/               ui (shadcn/ui), branding
├── integrations/supabase/
│   ├── browser.ts · server.ts   clientes de navegador e de servidor
│   ├── admin.ts                 cliente privilegiado, só no servidor
│   ├── env.ts · cookie-options.ts
│   └── types.ts                 tipos gerados do banco
├── lib/
│   ├── ambiente.ts · csp.ts  isolamento entre ambientes e montagem da CSP, puros
│   ├── billing.ts            diária, hora extra, custo e margem (previsão)
│   ├── ledger.ts             consolida apontamentos com operação e cliente
│   ├── queries.ts · mutations.ts   leituras e escritas genéricas
│   ├── mfa.ts                decisões de segundo fator e de acesso, puras
│   ├── recuperacao-senha.ts · prova-recuperacao.ts
│   ├── operacional/          contratos e hooks das RPCs do operador
│   ├── admin-usuarios/       administração de usuários, server-side
│   └── format.ts · csv.ts · types.ts · utils.ts
├── proxy.ts                  renovação de sessão e CSP com nonce
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
qualquer HTML. A decisão é uma só — layout, `/mfa`, dashboard e os guards apenas
a leem; duas definições de "liberado" produzem laço entre rotas.

| Situação                                    | Resultado                                            |
| ------------------------------------------- | ---------------------------------------------------- |
| sem sessão                                  | `redirect("/login")` — HTTP 307, sem markup          |
| autenticado sem papel                       | tela "Acesso não liberado"                           |
| `admin` em AAL2                             | painel administrativo                                |
| `admin` em AAL1                             | `/mfa`: cadastrar o primeiro fator ou desafiar       |
| `operacional` sem fator verificado, em AAL1 | tela `/operacional`                                  |
| `operacional` com fator verificado, em AAL1 | `/mfa` até concluir o TOTP                           |
| `operacional` em AAL2                       | tela `/operacional`                                  |
| falha ao consultar o estado de MFA          | tela "não foi possível verificar" (nunca o cadastro) |

`admin` + `operacional` é tratado como admin. O estado do fator vem do banco
(`public.mfa_bloqueia_excecao_aal1()`), não do cookie. A leitura usa
`getUser()`, que valida o token contra o Supabase, e não `getSession()`.

**Isto governa o que a interface mostra. Quem impede o acesso aos dados é a
RLS** — se este arquivo tivesse um defeito, as tabelas continuariam protegidas. O
modelo completo, incluindo MFA e recuperação de senha, está em
[SEGURANCA.md](SEGURANCA.md).

### O que cada papel alcança

| Superfície                               | admin        | operacional                          |
| ---------------------------------------- | ------------ | ------------------------------------ |
| tabelas de negócio, pelo PostgREST       | AAL2         | **nenhuma**, em nenhum nível         |
| `user_operation_access`                  | AAL2         | nenhuma                              |
| cinco RPCs operacionais                  | recusadas    | operações atribuídas, sem financeiro |
| `profiles`                               | vê todos     | só o próprio                         |
| `user_roles`                             | só a própria | só a própria                         |
| telas administrativas (`/usuarios` etc.) | sim          | bloqueadas no servidor               |
| tela `/operacional`                      | bloqueada    | sim                                  |

O `operacional` registra presença e horários **só** pela tela `/operacional`,
que fala exclusivamente com as RPCs de `src/lib/operacional/`. Nenhum valor
financeiro atravessa essa superfície. O desenho dela está em
[SEGURANCA.md](SEGURANCA.md).

## Fluxo de dados

Leitura: componente → hook de `queries.ts` → TanStack Query → cliente de
navegador → PostgREST → **RLS** → Postgres.

Escrita: formulário → `mutations.ts` ou chamada direta → mesma cadeia →
invalidação das queries afetadas.

Os valores financeiros são **derivados no banco**, desde a migration
`20260912183000_010`. Um trigger `BEFORE INSERT OR UPDATE` em
`timesheet_entries` recalcula `worked_minutes`, `overtime_minutes`,
`billed_amount`, `cost_amount` e os snapshots de diária, hora extra e custo a
partir de contrato, operação, turno e colaborador. **O payload do navegador não
é fonte de verdade nessas colunas.** Dashboard, faturamento e relatórios apenas
**leem** o que ficou gravado.

**Como isso chega a quem escreve, porém, depende da operação** — e a diferença
importa para o tratamento de erro:

| Operação                                       | O que acontece                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `INSERT`                                       | a derivação **sobrescreve** o que veio no payload                |
| `UPDATE` mexendo **apenas** em campo derivado  | **recusado**, com `SQLSTATE 42501` — não é corrigido em silêncio |
| `UPDATE` que altera coluna **motriz**          | **recalcula** a partir das fontes atuais                         |
| `UPDATE` aceito que **não** toca coluna motriz | **preserva** os valores já gravados; o payload é descartado      |

**As colunas motrizes são seis:** `status`, `check_in`, `check_out`,
`break_minutes`, `employee_id` e `timesheet_id`. `operation_id`, `work_date`,
`notes` e `invoice_id` **não** são motrizes — nenhuma entra no cálculo, e
mantê-las fora é o que impede o cliente de forçar recálculo (e a troca de um
snapshot congelado) só reenviando um valor qualquer.

A última linha é o caso comum: editar `notes` reenviando valores financeiros
divergentes **não** recusa e **não** recalcula — `worked_minutes`,
`overtime_minutes`, os três snapshots, `billed_amount` e `cost_amount` voltam a
ser os de `OLD`. É isso que mantém o snapshot congelado quando o contrato mudou
depois, e é também o que faz o `UPDATE ... SET invoice_id` do `gerar_fatura` não
recalcular nada com as taxas de hoje.

A recusa vem de `bloquear_edicao_financeira()`, que roda **antes** da derivação:
gatilho `BEFORE` de linha dispara em ordem alfabética de nome, e
`trg_timesheet_entries_bloqueio_financeiro` precede
`trg_timesheet_entries_calculo_financeiro`.

`postgres` e `service_role` são isentos **desse bloqueio específico**, para que
a derivação e o faturamento funcionem. Isento deste gatilho não significa isento
do resto: as proteções da `011` — imutabilidade da linha faturada, `TRUNCATE`
revogado, criação do vínculo de fatura exigindo **execução como `postgres`** —
continuam valendo, e várias delas não abrem exceção para papel nenhum,
`service_role` incluído. A fronteira do vínculo é o papel de execução, não a
função: o gatilho testa `current_user`, então não distingue `gerar_fatura` de
uma sessão `postgres` escrevendo à mão.

`src/lib/billing.ts` continua sendo a referência da regra e roda no navegador,
mas **para previsão, não para decisão**: serve para a tela mostrar o número
antes de salvar. A autoridade é o trigger.

**As duas implementações precisam continuar espelhadas, e isso hoje é manual.**
`supabase/tests/006_valores_financeiros.sql` guarda expectativas de paridade
cujos números saíram de uma execução anterior do `calcEntry()` e estão gravados
como **constantes**. O teste **não** executa as duas implementações lado a lado:
se o `calcEntry()` mudar, a paridade precisa ser revista à mão. Automatizar esse
diferencial segue como risco registrado em [PROGRESS.md](../PROGRESS.md).

Consequência prática que não mudou: a tela de apontamentos mostra o valor
**calculado na hora**, não o gravado. Conferir uma alteração pela interface não
prova o que foi persistido.

Uma vez faturado, o apontamento **congela**: linha com `invoice_id` preenchido
recusa `UPDATE` e `DELETE`, e as fontes do cálculo não podem ser **apagadas**
(migration `20260912200000_011`). O congelamento das fontes é mais estreito que
o da linha: valem `operations.client_id` e o
`work_date`/`operation_id`/`shift_id` da folha, mas `operations.contract_id`,
`agreed_amount`, as taxas do contrato e `employees.daily_cost` continuam
editáveis por admin. Isso não altera valor já cobrado — a entry guarda os
snapshots —, mas a proveniência da taxa não é preservada; está registrado como
risco em [PROGRESS.md](../PROGRESS.md).

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

Em `src/lib/billing.ts` (prévia) e no trigger do motor ativo (autoridade). Uma
diária por colaborador presente; falta não gera cobrança. A hora extra cobrada é
`(diária ÷ horas do turno) × fator`, aplicada ao excedente que ultrapassar a
tolerância definida no contrato. O turno trata virada de meia-noite; entrada
igual à saída é recusada pelo banco (seria uma jornada de 24 h).

Com o motor por vigência e a migration `029`, o **custo** segue regras próprias,
independentes da cobrança: a hora extra paga usa o valor-hora acordado na versão
de custo do colaborador (sem ele, diária de custo ÷ jornada, sem fator), e a
saída antecipada paga proporcionalmente aos minutos trabalhados (só com os dois
horários).

A migration `030` acrescenta as regras definitivas da BS, configuradas por
vigência do contrato:

- **Cobrança:** a saída antecipada também é proporcional. A hora extra cobrada é
  arredondada nos minutos residuais de cada hora (até 15 descarta; 16 a 45 vira 30;
  46 a 59 vira a hora seguinte). No modo `diario` isso acontece no próprio
  apontamento, depois da tolerância. No modo `acumulado`, o apontamento guarda os
  minutos brutos e o fechamento arredonda a soma do período uma vez, com item
  próprio na fatura. No sábado, a jornada de referência pode ser menor (ex.: 4 h),
  mas a hora continua diária ÷ jornada contratual.
- **Custo:** no feriado, horas × custo-hora × fator. Fora disso, minutos exatos.
- **Colunas:** `billed_overtime_minutes` guarda os minutos cobrados do dia, e
  `overtime_minutes`, o excedente à jornada (base do custo).

Regras que a BS não confirmou continuam como antes: pagamento no sábado, cobrança
no feriado, domingo e compensação entre dias.

**Adicionais de serviço** (`billing_additionals`, migration `029`) são valores
extras do período, com motivo e referência, separados da diária: não criam
diária nem custo. `gerar_fatura` soma os que cabem inteiros no período da fatura
e cria um item para cada.

## Diária por colaborador

**Um colaborador gera no máximo uma diária faturável por operação e data.**
Trabalhar além da jornada prevista vira hora extra no lançamento existente, e
nunca uma segunda diária. Dois turnos no mesmo dia continuam válidos para
colaboradores diferentes.

`absent` não conta como diária; `present` e `replacement` contam — o mesmo
recorte que `gerar_fatura` usa para faturar.

A regra não depende da interface. A chave `(employee_id, operation_id,
work_date)` é mantida em `timesheet_entries` por trigger que relê a folha pai e
sobrescreve o que vier no payload, e o índice parcial
`timesheet_entries_uma_diaria_por_operacao_dia` — criado pela migration
`20260906180000` — a garante no Postgres. Índice, e não validação em trigger:
só ele é avaliado no commit, e portanto só ele resiste a duas abas, a chamada
direta ao PostgREST e a concorrência.

O índice tem uma única exceção: um lançamento já faturado e anterior à regra,
isento apenas enquanto `id`, `employee_id`, `operation_id` e `work_date`
continuarem os do registro histórico — mudou a chave, volta a ser coberto. É
exceção registrada em
[dívida técnica](divida-tecnica/folha-duplicada-por-shift-null.md), não mecanismo
de escape.

Folha sem turno tem índice próprio, `timesheets_uma_folha_sem_turno`: o
`UNIQUE (operation_id, shift_id, work_date)` não cobre esse caso porque trata
NULLs como distintos entre si.

## Alocação de colaboradores

Um colaborador ocupa **no máximo uma alocação ativa** por vez: uma operação e um
turno. Enquanto ela existir, ele não pode estar em outro turno da mesma operação
nem em qualquer turno de outra, mesmo que os horários não se sobreponham. Mover
alguém exige desalocar antes.

A regra não depende da interface: o índice parcial
`operation_team_um_ativo_por_colaborador` — `UNIQUE (employee_id) WHERE active`,
criado pela migration `20260905203000` — a garante no Postgres. É ele que
impede duas sessões simultâneas de alocarem a mesma pessoa: a segunda recebe
`23505`.

Um vínculo com `shift_id` nulo também ocupa o colaborador. Ele é o caso das
operações sem turno cadastrado.

## Banco

Projeto Supabase **BSLOG**. RLS ativa em todas as tabelas do schema `public`, e
um event trigger (`ensure_rls`) a habilita automaticamente em tabelas novas.

Migrations em `supabase/migrations/`, aplicadas em Production na ordem; o estado
atual está em [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md). **Nunca editar
migration já aplicada** — criar nova com `supabase migration new <nome>`. Antes
de commitar mudança de esquema, rodar `supabase db advisors --linked --type
security`. Testes de banco ficam em `supabase/tests/`.
