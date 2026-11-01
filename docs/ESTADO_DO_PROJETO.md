# Estado do projeto

Fotografia factual do sistema de **BS Soluções Logística**. É a **fonte única**
dos dados que mudam com o tempo (o que está em Production, cobertura de testes,
estado das dependências): os demais documentos apontam para cá em vez de repeti-los.
Etapa atual e próximos passos ficam em [PROGRESS.md](../PROGRESS.md).

## Checkpoint de 01/11/2026

**Ambientes: último estado informado, não revalidado nesta sessão.** O Git confirma
os PRs #86 e #87 na base `6b1edc3aa2a5894aa674ef22ed43f989551da966`; o
PR #86 encerrou o FIN-PR-08 em `b38579075d2675918b24b97440ef546ea04ad27f`.
Código versionado, validação de testes, publicação de aplicação, aplicação de
migrations e ativação de funcionalidade são estados distintos.

- Motor financeiro por vigência: ativo em Production desde 29/10/2026, conforme
  informado. Resolução comercial de tarifas por função/colaborador: **desligada**.
  São controles diferentes.
- Migrations 032 (MFA opcional), 033 (integridade da taxa legada) e 034 (MFA
  somente no login): aplicadas em Production, conforme informado. As migrations
  035–042 estão versionadas, mas não aplicadas em HML ou Production, conforme
  informado. A 042 é a última versionada nesta base, não uma afirmação sobre a
  última aplicada em Production.
- FIN-PR-01, 02, 03, 05, 06, 07 e 08 foram integrados; PR-04 foi absorvido pelo
  PR-02. PR-09 é a próxima implementação financeira e está pendente.
- SEC-DEP-01 foi integrado. A matriz E2E e a comprovação de isolamento real de
  Preview/HML permanecem pendentes; riscos residuais estão em [Segurança](SEGURANCA.md).

### Migrations financeiras versionadas

| Migration | Escopo |
| --- | --- |
| 030 | Regras comerciais anteriores |
| 035 | Núcleo financeiro puro V2 |
| 036 | Integração do núcleo V2 |
| 037 | Leitores por componentes |
| 038 | Período contratual e competência |
| 039 | Catálogo de funções e período do turno |
| 040 | Snapshots de função e período |
| 041 | Tarifas por função, período e vigência |
| 042 | Diária individual e bônus diário |

O repositório contém suítes para essas entregas; resultados históricos não
comprovam execução nesta sessão. As migrações remotas e a ativação de preços não
podem ser inferidas de código mergeado nem dos testes locais.

### Regras financeiras e estágio

- Dia útil: referência líquida de 8 horas e intervalo conforme turno; saída
  antecipada proporcional; HE pela diária comercial dividida por 8 e multiplicada
  por 1,5, com arredondamento diário 15/45 ou acumulado quando configurado.
- Sábado: referência de cobrança de 4 horas, diária integral até a referência,
  HE depois dela e divisor 8 para HE.
- Domingo e feriado: regra comercial aprovada para o **FIN-PR-09, ainda não
  implementada na integração**: sem diária-base; horas trabalhadas × diária
  comercial resolvida ÷ 8 × 2; custo previsto separado também ×2; arredondamento
  especial configurável, com minutos exatos por padrão. O núcleo puro já admite
  dias especiais; os lançamentos seguem o cálculo legado até o PR-09.
- Com resolução comercial ligada, a fonte é a diária individual vigente por
  colaborador e contrato; na ausência, a tarifa padrão de contrato, função,
  período e vigência; sem fonte válida, há erro. Operação sem contrato usa sua
  fonte de valor acordado. Com resolução desligada preservam-se valores legados.
- Função e período são snapshots; a HE usa a diária comercial resolvida. O bônus
  diário por acúmulo é separado, somado uma vez, fora da base de HE, e registrado
  por RPC administrativa com motivo e auditoria. A 042 recusa bônus em domingo e
  feriado enquanto esses lançamentos permanecem no cálculo legado; a integração
  de bônus nesses dias pertence ao PR-09.
- Preço cobrado não é custo do colaborador. O sistema apresenta **custo previsto**,
  não folha de pagamento; não se presume custo para o bônus.

### Referência para conciliação futura

A referência comercial informada para 01–15/09/2026 contém 141 lançamentos,
14 colaboradores e total de R$ 35.118,12: R$ 33.050,00 em diárias e
R$ 2.068,12 em HE. Não contém custos pagos. Diárias variam entre colaboradores
mesmo na mesma função; a HE usa a diária individual da linha e não inclui bônus.
A decisão comercial é diária individual por colaborador, contrato e vigência,
sem criar funções fictícias. A conciliação pertence ao FIN-PR-13.

## Production — referência de infraestrutura

Último estado informado, não revalidado nesta sessão.

| Item                  | Estado                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicação             | publicada em `admin.bslogisticas.com.br`                                                                                                      |
| Hospedagem            | Vercel, projeto `bs-logistica-sistema`, deploy a partir de `main`                                                                             |
| Banco e Auth          | Supabase, projeto `ehkduqokntemtmqzdrbd`                                                                                                      |
| Migrations            | Ver checkpoint acima; versão no Git não comprova aplicação remota. |
| Cadastro público      | bloqueado (`disable_signup = true`)                                                                                                           |
| Usuário `operacional` | perfil homologado com uma conta existente que era admin e foi rebaixada; contas definitivas ainda não criadas ([PROGRESS.md](../PROGRESS.md)) |

O **Preview** da Vercel não pode usar o banco de produção: o escopo Preview não
deve ter as variáveis de Production, e o código recusa (no build e em cada
requisição) um Preview apontado para o projeto Supabase de Production. Sem
destino de teste próprio, o build de Preview falha de propósito, e conectá-lo ao
banco de produção para deixar o check verde é proibido. Ver "Isolamento entre
ambientes" em [docs/SEGURANCA.md](SEGURANCA.md).

O site institucional (`bslogisticas.com.br`) é outro projeto, em outro
repositório, e não faz parte deste.

## Histórico de vigências financeiras — fotografia de 23/10/2026

**Histórico, não estado atual:** as afirmações e pendências desta seção retratam
o checkpoint de 23/10/2026 e foram superadas onde divergirem do checkpoint acima.
A autorização e o MFA seguem as instruções atuais de [Segurança](SEGURANCA.md).

Estado em 23/10/2026 (C05-B7.2). Quatro níveis que não se confundem: **implementado**
(existe no código), **validado** (foi testado), **publicado** (está disponível aos
usuários) e **pendente**.

**Banco — migrations `021` a `028`**

- Implementado e **publicado em Production**: tabelas de vigência de contrato, de custo do
  colaborador e do valor acordado da operação, trilha `financial_terms_audit`, as RPCs de
  registro, os cadastros atômicos, a chave do motor e os bloqueios da `027` e da `028`.
- Validado: ensaio local de cada migration e de sua reversão, mais conferência de catálogo
  em Production depois de cada lote (L1 a L4): histórico, estruturas, permissões, RLS,
  dados e valores financeiros idênticos. Os logs de Production (Postgres, API, Auth e
  Vercel) **não** foram verificados depois dos lotes.
- Efeito já ativo, mesmo com o motor desligado (`028`): o contrato de uma operação que tem
  apontamento ou valor acordado cadastrado não troca, e esse contrato não é excluído.

**Motor financeiro**

- Motor atual (`010`): **ligado**, sem alteração (gatilho `trg_timesheet_entries_calculo_financeiro`
  habilitado; `derivar_valores_financeiros` e `gerar_fatura` com o mesmo corpo de antes).
- Motor por vigência (`025`): instalado e **desligado**. `financial_engine_settings` tem uma
  linha com `vigencia_ativa = false`, nunca alterada; os gatilhos novos (cálculo por vigência,
  três bloqueios de edição direta de taxa e congelamento de jornada de turno) estão
  desabilitados.
- Nenhuma vigência foi cadastrada: as três tabelas de versões e a trilha têm 0 linhas.
- **Ativar o motor é decisão de negócio e etapa própria**: não é feita por nenhuma tela. A RPC
  `alterar_motor_vigencia` é executável por `admin` em AAL2 pela API. A `027` recusa ligar
  com divergência entre coluna e vigência, mas `p_aceitar_pendencias = true` ainda liga com
  cadastros sem vigência, e o motor novo recusaria apontamento remunerável deles.

**Pendências de vigência (decisão de negócio)**

Há 7 cadastros em uso sem vigência para hoje: 4 colaboradores, 2 contratos e 1 operação sem
contrato. Falta decidir a data de início e o valor de cada vigência; nada foi presumido nem
cadastrado.

**Interfaces — PR B**

- **Implementado**, só na branch `feat/c05b-interfaces-vigencia`: histórico e reajuste de
  vigências em contratos, colaboradores e operações sem contrato; cadastro atômico (usado só com o
  motor ligado); apontamentos com valor do banco, prévia e origem; turnos usados com jornada
  protegida; tela `/implantacao-vigencias` (consulta). As telas de cadastro não ligam nem
  desligam o motor. A C05-B8.6 acrescenta à `/implantacao-vigencias` o controle de **ligar** o
  motor (Server Action com `exigirAdminAal2()`, RPC `alterar_motor_vigencia` com o JWT da sessão,
  motivo, frase de confirmação, `p_aceitar_pendencias = false`). A reversão tem módulo e trava próprios (RB-01, abaixo).
  Usado **só na homologação** (C05-B8.8, 24/10/2026, pelo Preview do PR, admin AAL2): motor
  ligado lá, com dados `HML-TESTE`; em Production o motor segue **desligado**. É controle técnico
  de implantação: a única forma segura de ligar o motor, por isso permanece até existir
  procedimento substituto validado.
  **Trava de servidor (C05-B8.12):** o controle não é permanente. A Server Action só aceita o
  pedido se a variável `BS_ATIVACAO_MOTOR_HABILITADA` (server-only, nunca `NEXT_PUBLIC_*`) valer
  exatamente `true`; ausente ou com qualquer outro valor, o padrão em todos os ambientes, ela recusa
  (código `desabilitada`) depois da autorização e antes de tocar o banco, e a tela nem mostra botão
  nem diálogo. Não substitui nada: admin em AAL2, motivo, frase e a RPC do banco seguem exigidos; a
  ativação só liga. Procedimento para Production, com autorização própria: definir a
  variável no projeto da Vercel, publicar, ligar o motor pela tela, remover a variável e publicar de
  novo.
- **RB-01** (reversão controlada do motor, implementada localmente, sem deploy): botão "Desligar
  motor" em `/implantacao-vigencias`, só com o motor ligado e consistente. Server Action
  `desligarMotorAction`: `exigirAdminAal2()`, trava própria `BS_REVERSAO_MOTOR_HABILITADA`
  (server-only; só `true` abre), cliente da sessão (sem `service_role`) e a RPC
  `alterar_motor_vigencia(false, motivo)`, que audita em `financial_terms_audit`. Motivo e frase
  `DESLIGAR MOTOR`. Sem migration. Procedimento: `docs/runbooks/reversao-do-motor.md`.
- **C05-B8.9** (no mesmo PR): as telas de apontamento (admin e operacional) recusam salvar linha
  com entrada igual à saída, que o cálculo mediria como 24 h; o cálculo não mudou e o banco ainda
  aceita a igualdade por outra via (corrigir no banco exige migration própria). O cadastro de
  colaborador novo com o motor ligado pede a data de início do custo (antes era sempre hoje, o que
  recusava apontar dias anteriores).
- **C05-B8.10** (no mesmo PR; migration `029` **só local**, não aplicada em banco remoto): regras
  confirmadas pela BS. Valem no motor por vigência; o motor antigo (`010`) não muda.
  - **Hora extra paga** pelo valor-hora acordado com cada colaborador (`employee_cost_terms.ot_hourly_cost`,
    opcional, congelado no apontamento). Cobrança e custo independentes: o fator do contrato só
    entra na cobrança. Sem valor acordado, segue diária de custo ÷ jornada (o comportamento anterior).
  - **Saída antecipada**: custo proporcional às horas trabalhadas, com os dois horários; a cobrança
    continua a diária inteira.
  - **Adicionais de serviço** (`billing_additionals`): motivo, valor, referência, período, cliente e
    operação opcional; só por RPC (admin AAL2, trilha), cancelamento com motivo, sem exclusão;
    `gerar_fatura` inclui os que cabem inteiros no período, um item cada.
  - **Entrada igual à saída** recusada pelo banco (23514), por qualquer via.
  - As telas só oferecem isso quando `estado_motor_vigencia()` anuncia `regras_bs`: o código pode
    ser publicado antes da `029` sem mudar nada. O Dashboard mostra a receita dos apontamentos; os
    adicionais aparecem no Faturamento e na fatura.
  - Validado localmente: aplicar a `029` sobre dados existentes não altera nenhum valor gravado, e a
    reversão devolve catálogo e dados idênticos aos da `028`.
- **Regras comerciais pendentes** (decisão da BS, nada implementado por suposição): arredondamento de
  meia hora (15 e 45 min) e se é diário ou depois de acumular a quinzena; feriado (100% com diária
  por 4 h e extra acima disso); sábado e domingo; cobrança ao cliente por saída antecipada; preço
  avulso por serviço completo ou por trabalhador; parâmetros da operação sem contrato (8 h, fator 1,
  10 min fixos); presença ou substituição sem horário; como os adicionais entram no Dashboard e nos
  Relatórios. Fechamento quinzenal com aprovação do gerente do cliente: PR #63, separado.
- **Validado**: as 29 suítes Node (`test:*`) e as 26 SQL locais; homologação ponta a ponta na
  C05-B8.8 (antes da `029`).
- **Publicado**: as interfaces (PR #68) estão na `main` e em Production. O controle de ativação e
  as correções da C05-B8.9 (PR #69) estão só no Preview, ligado à homologação. A C05-B8.10 está
  só na branch local, sem push.
- **Pendente**: decisão da BS sobre as regras comerciais acima; aplicar a `029` na homologação e
  validar; merge do PR #69 e procedimento para ligar o motor em Production, cada um com autorização.

**Separados deste trabalho**: o PR #63 (fechamento quinzenal, rascunho) e a migration `019`
(nunca aplicada).

**Backups de Production** (dump lógico do PostgreSQL, cifrado com `age`, uma cópia local e uma
cópia externa cifrada)

- O mais recente é de 23/10/2026, **depois da `024` e antes da `025`**; uma restauração dele
  exigiria reaplicar a `025` a `028`. Não existe backup posterior à `025`.
- Limites: o dump por schema **não preserva event triggers** (o `ensure_rls` é recriado à mão
  e o privilégio para isso em Supabase hospedado não está comprovado; ver
  [recuperação](runbooks/recuperacao-c02-020.md)); não cobre a configuração de Auth, os segredos
  da Vercel, o Storage nem `vault` e `realtime`; a restauração do pacote mais recente não foi
  ensaiada (o ensaio vale para o procedimento); a cópia da chave privada no gerenciador de
  senhas não foi verificada. Production não tem backup gerenciado nem PITR.

**Limpeza final do projeto** (dados fictícios, ramos antigos, rascunhos): etapa futura, não
iniciada.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth, RLS) com `@supabase/ssr` · TanStack Query ·
npm · Vercel. Node ≥ 22.6. Sentry para monitoramento de erros.

Next.js é a arquitetura definitiva. TanStack Start, TanStack Router, Vite, Nitro e
as integrações do Lovable foram removidos. `@tanstack/react-query` permanece: é a
camada de dados e não tem relação com o TanStack Router.

## Módulos

**Área administrativa** — só `admin`, com o piso de MFA aplicável à conta:

| Módulo               | Função                                                           |
| -------------------- | ---------------------------------------------------------------- |
| Dashboard            | indicadores do período: diárias, horas extras, receita, margem   |
| Clientes e contratos | cadastro e regras de cobrança                                    |
| Colaboradores        | cadastro com função, contato e custo por diária                  |
| Operações            | operações fixas e avulsas, turnos e equipe                       |
| Apontamentos         | presença, horários e intervalo, com cálculo automático           |
| Faturamento          | fechamento por cliente e período                                 |
| Relatórios           | por colaborador, operação e lançamento, com exportação CSV       |
| Usuários             | convite, papel, atribuição de operações, revogação e reativação  |
| Configurações        | segurança da conta: ativar MFA (o `operacional` também desativa) |

**Área operacional** — só `operacional`: a tela `/operacional` registra presença e
horários das operações atribuídas ao usuário, falando exclusivamente com as cinco
RPCs da superfície operacional. Nenhum valor financeiro é exibido.

Mais: login, segundo fator, recuperação de senha, logout e renovação de sessão.

## Autenticação e papéis

- Dois papéis: `admin` e `operacional`; TOTP é opcional para ambos. Sem fator
  verificado, AAL1 respeita o papel; com fator, AAL1 é bloqueado até o TOTP no
  login, e depois não há novo desafio por funcionalidade. Desativar o próprio
  fator exige código novo na interface.
- O acesso direto às tabelas de negócio exige `admin` e o piso
  `mfa_cotidiano_ok()`. O `operacional` chega aos dados só pelas RPCs restritas.
- O último admin é protegido por trigger, e as alterações de usuário e papel são
  auditadas em `admin_audit_log` (best-effort).

O modelo completo está em [SEGURANCA.md](SEGURANCA.md).

## Segurança relevante em vigor

- Identidade utilizável exigida pelo banco (C02, migration `020`, aplicada em
  18/10/2026): conta existente e não banida, e sessão do JWT viva.
- RLS protege os dados; policies restritivas aplicam papel e piso de MFA.
  Nomes históricos com `aal2` não implicam AAL2 obrigatório para todos.
- Funções `SECURITY DEFINER` validam autorização internamente; cadastro público
  permanece bloqueado. SEC-DEP-01 foi integrado.
- Valores financeiros derivados por trigger; linha faturada imutável.
- Content-Security-Policy com nonce, em enforcement, mais cabeçalhos de segurança
  (HSTS pela plataforma).
- `service_role` usada só no servidor; segredos fora do Git e do bundle.

## Testes e CI — registro histórico

Os números abaixo refletem a fotografia anterior e não foram revalidados nesta sessão.

| Verificação                     | Estado                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Suítes Node (`test:*`)          | 29 scripts, todos exigidos pela CI; 11 deles são da C05-B                                                            |
| Testes SQL (`supabase/tests`)   | 26 arquivos; rodam localmente (`scripts/testar-sql-local.sh`), **não** na CI                                         |
| CI (`.github/workflows/ci.yml`) | em todo PR e em push para `main`: lint, `tsc`, as 29 suítes e build, sem secret e sem tocar o Supabase de Production |
| `npm audit`                     | 0 vulnerabilidades (SEC-DEP-01: `@sentry/nextjs` 10.75.2 e `fast-uri` 3.1.9; ver [SEGURANCA.md](SEGURANCA.md))       |

## Riscos e pendências confirmados

Registrados em [SEGURANCA.md](SEGURANCA.md) (seção "Riscos residuais") e em
[PROGRESS.md](../PROGRESS.md). O diretório [divida-tecnica/](divida-tecnica/) tem
só dívidas já resolvidas, como histórico.
