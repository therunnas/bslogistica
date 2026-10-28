# Estado do projeto

Fotografia factual do sistema de **BS Soluções Logística**. É a **fonte única**
dos dados que mudam com o tempo (o que está em Production, cobertura de testes,
estado das dependências): os demais documentos apontam para cá em vez de repeti-los.
Etapa atual e próximos passos ficam em [PROGRESS.md](../PROGRESS.md).

## Production

| Item                  | Estado                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicação             | publicada em `admin.bslogisticas.com.br`                                                                                                      |
| Hospedagem            | Vercel, projeto `bs-logistica-sistema`, deploy a partir de `main`                                                                             |
| Banco e Auth          | Supabase, projeto `ehkduqokntemtmqzdrbd`                                                                                                      |
| Migrations            | 33 registradas; a última é a `028` (C05-B, aplicada em 23/10/2026). `029` e `030` não aplicadas. Ver "Vigências financeiras", abaixo          |
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

## Vigências financeiras (C05-B)

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
  motivo, frase de confirmação, `p_aceitar_pendencias = false`; sem botão de desligar). Está em PR.
  Usado **só na homologação** (C05-B8.8, 24/10/2026, pelo Preview do PR, admin AAL2): motor
  ligado lá, com dados `HML-TESTE`; em Production o motor segue **desligado**. É controle técnico
  de implantação: a única forma segura de ligar o motor, por isso permanece até existir
  procedimento substituto validado.
  **Trava de servidor (C05-B8.12):** o controle não é permanente. A Server Action só aceita o
  pedido se a variável `BS_ATIVACAO_MOTOR_HABILITADA` (server-only, nunca `NEXT_PUBLIC_*`) valer
  exatamente `true`; ausente ou com qualquer outro valor, o padrão em todos os ambientes, ela recusa
  (código `desabilitada`) depois da autorização e antes de tocar o banco, e a tela nem mostra botão
  nem diálogo. Não substitui nada: admin em AAL2, motivo, frase e a RPC do banco seguem exigidos, e
  não existe botão de desligar. Procedimento para Production, com autorização própria: definir a
  variável no projeto da Vercel, publicar, ligar o motor pela tela, remover a variável e publicar de
  novo.
- **C05-B8.9** (no mesmo PR): as telas de apontamento (admin e operacional) recusam salvar linha
  com entrada igual à saída, que o cálculo mediria como 24 h; o cálculo não mudou e o banco ainda
  aceita a igualdade por outra via (corrigir no banco exige migration própria). O cadastro de
  colaborador novo com o motor ligado pede a data de início do custo (antes era sempre hoje, o que
  recusava apontar dias anteriores).
- **C05-B8.10** (PR #69, merge em 27/10/2026; migration `029` aplicada **só na homologação**, na
  C05-B8.11): hora extra paga pelo valor-hora acordado por colaborador
  (`employee_cost_terms.ot_hourly_cost`, congelado no apontamento), custo proporcional na saída
  antecipada, adicionais de serviço (`billing_additionals`, só por RPC, cancelamento com motivo,
  entram em `gerar_fatura`) e recusa de entrada igual à saída no banco. Na C05-B8.12, o controle
  de ligar o motor ganhou trava de servidor (`BS_ATIVACAO_MOTOR_HABILITADA`, fechada por padrão).
- **C05-B8.15** (branch `feat/c05b-regras-definitivas`, migration `030` **só local**): regras
  definitivas da BS, só no motor por vigência (o `010` não muda).
  - **Arredondamento da hora extra cobrada** (minutos residuais de cada hora: até 15 descarta, 16 a
    45 vira 30, 46 a 59 vira a hora seguinte). Modo por vigência do contrato
    (`contract_terms.ot_rounding_mode`): `diario` (padrão) no próprio apontamento, depois da
    tolerância; `acumulado` (ex.: Aceville) soma os minutos brutos do período, sem tolerância, e
    arredonda uma vez no fechamento, com item próprio na fatura
    (`ajustes_de_arredondamento_acumulado`, a mesma função da prévia). O custo segue em minutos
    exatos: a regra não foi confirmada para o pagamento.
  - **Saída antecipada cobrada proporcionalmente** (8 h previstas, 4 trabalhadas = meia diária),
    além do custo proporcional da `029`.
  - **Sábado:** jornada de referência da cobrança por contrato (`saturday_shift_hours`, ex.: 4); a
    hora continua diária ÷ jornada contratual. O pagamento no sábado não muda.
  - **Feriado:** pagamento com fator por contrato (`holiday_pay_factor`, 2 = +100%; R$ 150, 8 h,
    6 h trabalhadas = R$ 225), calendário em `financial_holidays` (admin AAL2, motivo, trilha). A
    cobrança no feriado não muda. O tipo do dia fica congelado no apontamento.
  - **Saldo de horas** (`saldo_de_horas_do_periodo`, ex.: Dynamis): informativo, não muda valores.
  - Telas: parâmetros na vigência do contrato, calendário em Contratos, prévia nova em
    Apontamentos, arredondamento acumulado no Faturamento, adicionais no total de Dashboard e
    Relatórios; horas extras exibidas pelos minutos cobrados. Tudo só com o anúncio
    `regras_definitivas` de `estado_motor_vigencia()`.
- **Regras comerciais pendentes** (decisão da BS, nada implementado por suposição): arredondamento e
  feriado aplicados ao PAGAMENTO; cobrança no feriado; pagamento no sábado e cobrança abaixo de 4 h;
  domingo; compensação da Dynamis na cobrança e no custo; tolerância na falta de minutos; preço
  avulso por serviço completo ou por trabalhador; parâmetros da operação sem contrato (8 h, fator 1,
  10 min fixos).
- **Validado**: as 30 suítes Node (`test:*`) e as 27 SQL locais; homologação ponta a ponta na
  C05-B8.8 (antes da `029`) e da `029` na C05-B8.11.
- **Publicado**: as interfaces (PR #68) e o PR #69 estão na `main` e em Production (código). Em
  Production o banco segue na `028`, com o motor por vigência desligado.
- **Pendente**: publicar a C05-B8.15 (push e PR, com autorização), aplicar `029` e `030` em
  Production e ligar o motor, cada um em etapa própria; reconciliar o PR #63 com a `main`.

**Separados deste trabalho**: o PR #63 (fechamento quinzenal, rascunho) e a migration `019`
(nunca aplicada; só no branch local do PR #63, sobre o histórico operacional). Reconciliar o PR #63
com a `main` tem 11 arquivos em conflito e exige que o fechamento leia os minutos cobrados, os
adicionais e o arredondamento acumulado da `030`; a `019`, com data anterior à `020`, precisaria de
nova numeração para ser aplicada depois da `030`.

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

**Área administrativa** — só `admin`, em AAL2:

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

- Dois papéis: `admin` e `operacional`. `admin` exige MFA TOTP (AAL2); para
  `operacional` o MFA é opcional, e uma conta que o ativa passa a exigi-lo.
- O acesso direto às tabelas de negócio exige `admin` e `aal2`. O `operacional`
  chega aos dados só por RPC.
- O último admin é protegido por trigger, e as alterações de usuário e papel são
  auditadas em `admin_audit_log` (best-effort).

O modelo completo está em [SEGURANCA.md](SEGURANCA.md).

## Segurança relevante em vigor

- Identidade utilizável exigida pelo banco (C02, migration `020`, aplicada em
  18/10/2026): conta existente e não banida, e sessão do JWT viva.
- RLS em todas as tabelas de `public`, com RESTRICTIVE de `aal2` e de `admin`.
- Valores financeiros derivados por trigger; linha faturada imutável.
- Content-Security-Policy com nonce, em enforcement, mais cabeçalhos de segurança
  (HSTS pela plataforma).
- `service_role` usada só no servidor; segredos fora do Git e do bundle.

## Testes e CI

| Verificação                     | Estado                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Suítes Node (`test:*`)          | 30 scripts, todos exigidos pela CI; 12 deles são da C05-B                                                            |
| Testes SQL (`supabase/tests`)   | 27 arquivos; rodam localmente (`scripts/testar-sql-local.sh`), **não** na CI                                         |
| CI (`.github/workflows/ci.yml`) | em todo PR e em push para `main`: lint, `tsc`, as 30 suítes e build, sem secret e sem tocar o Supabase de Production |
| `npm audit`                     | 0 vulnerabilidades                                                                                                   |

## Riscos e pendências confirmados

Registrados em [SEGURANCA.md](SEGURANCA.md) (seção "Riscos residuais") e em
[PROGRESS.md](../PROGRESS.md). O diretório [divida-tecnica/](divida-tecnica/) tem
só dívidas já resolvidas, como histórico.
