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
| Migrations            | 33 registradas; a última é a `028` (C05-B, aplicada em 23/10/2026). Ver "Vigências financeiras", abaixo                                       |
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
  motivo, frase de confirmação, `p_aceitar_pendencias = false`; sem botão de desligar). Está em PR,
  **não** foi usado em nenhum ambiente: o motor segue desligado em Production e na homologação.
- **Validado**: as 26 suítes Node (`test:*`). Não houve verificação visual em ambiente hospedado.
- **Publicado**: **não**. As interfaces não estão na `main`, nem em Preview, nem em Production.
- **Pendente**: criar o PR B, validar em Preview (exige projeto Supabase de teste próprio no
  escopo Preview; **não verificado**), merge e deploy, cada um com autorização.

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
| Suítes Node (`test:*`)          | 26 scripts, todos exigidos pela CI; 8 deles são da C05-B                                                             |
| Testes SQL (`supabase/tests`)   | 24 arquivos; rodam localmente (`scripts/testar-sql-local.sh`), **não** na CI                                         |
| CI (`.github/workflows/ci.yml`) | em todo PR e em push para `main`: lint, `tsc`, as 26 suítes e build, sem secret e sem tocar o Supabase de Production |
| `npm audit`                     | 0 vulnerabilidades                                                                                                   |

## Riscos e pendências confirmados

Registrados em [SEGURANCA.md](SEGURANCA.md) (seção "Riscos residuais") e em
[PROGRESS.md](../PROGRESS.md). O diretório [divida-tecnica/](divida-tecnica/) tem
só dívidas já resolvidas, como histórico.
