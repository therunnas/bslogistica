# BS Soluções Logística — Progresso

Andamento do projeto: marcos concluídos, etapa atual e próximas etapas. Regras
permanentes ficam em [CLAUDE.md](CLAUDE.md); o estado factual de Production, dos
testes e das dependências, em [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md);
o modelo de segurança, em [docs/SEGURANCA.md](docs/SEGURANCA.md). O histórico
detalhado de cada mudança está no Git — este arquivo não o repete.

## Objetivo

Painel interno de gestão de mão de obra terceirizada: clientes e contratos,
colaboradores, operações e turnos, apontamento de diárias e horas extras,
faturamento por período e relatórios. Duas trilhas de uso:

- **Admin** — login com MFA, cadastros, operações, turnos, equipe, apontamentos,
  faturamento, relatórios e administração de usuários.
- **Operacional** — recebe convite, entra, vê **somente** as operações que lhe
  foram atribuídas, registra presença e horários, e **não** vê financeiro nem
  telas administrativas.

## Marcos concluídos

| Frente                                             | Entrega                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Migração para Next.js e reconstrução do Supabase   | Next.js 16 é a arquitetura definitiva; banco e Auth reconstruídos e validados                        |
| MFA e enforcement de AAL2                          | TOTP obrigatório para o admin, na interface e no banco (11 policies RESTRICTIVE)                     |
| Recuperação de senha                               | confirmação deliberada (token não se consome em GET), prova HMAC e um único TOTP para contas com MFA |
| Proteção financeira no banco (`010`, `011`, `014`) | valores derivados por trigger, lastro faturado imutável, `break_minutes` não negativo                |
| Estado de MFA verificável pelo banco (`012`)       | `mfa_bloqueia_excecao_aal1()`                                                                        |
| Superfície operacional (`013`, `015`)              | cinco RPCs, papel dedicado com grants por coluna, elegível em AAL1 sem MFA ou AAL2                   |
| Interface operacional                              | camada de dados em `src/lib/operacional/`, papel e guards por rota, tela `/operacional`              |
| Guard role-aware                                   | uma só decisão de acesso, em `lerAcesso()`                                                           |
| Acesso direto restrito (`016`)                     | tabelas de negócio exigem `aal2` **e** `admin` pelo PostgREST                                        |
| Administração de usuários (`017`)                  | backend server-side, `admin_audit_log`, último admin protegido                                       |
| Telas `/usuarios` e `/configuracoes`               | gestão de usuários e papéis; ativação/desativação de MFA conforme o papel                            |
| Hardening de grants de `admin_audit_log` (`018`)   | menor privilégio na tabela de auditoria                                                              |
| Baseline e CI                                      | Next.js atualizado, testes estruturais alinhados, CI no GitHub Actions                               |
| Cabeçalhos e CSP                                   | CSP com nonce em enforcement, fontes auto-hospedadas, contraste do login                             |
| Dependências                                       | `npm audit` zerado                                                                                   |

## Etapa atual — matriz E2E

**Objetivo:** provar de ponta a ponta, com contas reais, a política de acesso por
papel antes de existir o primeiro usuário `operacional`.

A matriz aprovada cobre:

- `admin` em AAL1 bloqueado · `admin` em AAL2 liberado;
- `operacional` sem MFA em AAL1 · `operacional` com fator verificado em AAL1
  **bloqueado** · `operacional` com MFA em AAL2;
- conta sem papel · `admin` + `operacional`;
- operação atribuída · operação não atribuída · operação sem turno;
- apontamento · folha fechada;
- financeiro inacessível ao operador · rotas administrativas bloqueadas;
- convite · troca de papel · último admin · auditoria;
- recuperação de acesso — **incluindo a variante sem MFA**, cuja arquitetura
  (`decidirMfaNaRecuperacao` devolve `prosseguir` para `mfa-ausente`) existe, mas
  que ainda não foi exercitada com conta real;
- logout/login e MFA.

**Gate:** o primeiro usuário `operacional` definitivo (do cliente) só é criado depois
da matriz.

**Situação do perfil operacional:**

- **Homologação do perfil (feita):** uma conta existente, que era admin, teve o papel
  de admin revogado e o `operacional` atribuído pela administração de usuários. Com
  ela, `/operacional` e a interface de apontamentos abriram, e o acesso direto a
  `/dashboard` foi barrado com redirecionamento para `/operacional`. Valida a
  navegação por perfil; **não** cria conta definitiva e **não** testa o fluxo de
  convite de operadores.
- **Criação por convite:** não exercitada nessa operação; segue na matriz E2E.
- **Contas definitivas do cliente:** preparação futura, depois da matriz.
- **Dados fictícios:** limpeza controlada antes da entrega, ainda pendente.
- A matriz E2E **não** está concluída.

## Próximas etapas

1. Concluir a matriz E2E acima.
2. Criar as contas `operacional` definitivas, pelo fluxo de convite, e limpar os
   dados fictícios antes da entrega.
3. Acompanhar o uso real e priorizar os riscos abaixo conforme apareçam.
4. Auditoria de segurança: **C03** é a próxima prioridade (não iniciada).

## Riscos e pendências abertos

Os riscos de segurança, com condição de fechamento, estão em
[docs/SEGURANCA.md](docs/SEGURANCA.md) (seção "Riscos residuais"): proveniência
da taxa faturada, paridade manual `calcEntry()` × SQL, `TRUNCATE` de
`service_role` em `profiles` e `user_roles`, grants herdados, ausência de FK para
`auth.users`, e outros.

### Auditoria de segurança — andamento

Inventário original preservado: **21 frentes** (P0: 0 · P1: 7 · P2: 13 · P3: 1).
Concluídas em Production: **2** (C01, C02). Restantes: **19**. Próxima prioridade
de tratamento: **C03** (não iniciada). A severidade original não foi alterada.

### C02 — revogação de identidade e sessões (P1) — CONCLUÍDA EM PRODUCTION

- **Data:** 18/10/2026. **PR:** #65. **Merge commit:**
  `37bd0a9ded7de97ec3965a6a1bd17361c1f500ae`. **Migration:**
  `20261018120000_020_revogacao_de_identidade.sql`, aplicada por `supabase db push`
  (código 0) no projeto `ehkduqokntemtmqzdrbd`; 25 migrations registradas; a `019`
  **não** foi aplicada.
- **Resultado técnico:** `has_role()` e `is_staff()` só autorizam identidade
  utilizável (conta existente, não banida, sessão do JWT viva em `auth.sessions`);
  29 policies atualizadas; trigger do último admin conta só admins utilizáveis;
  privilégios previstos preservados. Modelo em [docs/SEGURANCA.md](docs/SEGURANCA.md).
- **Validação:** homologação local em instância isolada (14 suítes SQL, 1.235
  asserções, JWT/MFA/revogação com tokens reais); 15 verificações SQL de catálogo em
  Production; login de admin e tela `/operacional` funcionando; operador barrado no
  dashboard e levado a `/operacional`; deployment e checks da CI aprovados; sem erro
  identificado nos logs de Vercel, PostgreSQL e Auth **nas janelas que os planos
  atuais permitem consultar** (não é cobertura de todo o período desde a publicação).
- **O que NÃO foi feito em Production:** nenhum teste destrutivo. Banimento,
  exclusão e logout de contas reais **não** foram exercitados na publicação; esses
  comportamentos estão provados só na homologação local.
- **Recuperação:** `docs/runbooks/recuperacao-c02-020.md`. Reabre a C02; só com
  autorização expressa. Foi feito um backup técnico preventivo antes da `020`; ele
  **não** é backup integral restaurável comprovado.

#### Pendências relacionadas (não são regressões da C02)

- **Backup integral restaurável não comprovado** (plano Free).
- **Último admin:** banimento direto pela Auth Admin API não passa pelo trigger.
- **Registros órfãos** em `profiles` e `user_roles` (a `020` os faz negar, não os
  remove): exigem análise própria de retenção e limpeza controlada.
- **Revisão de segurança específica (Codex) não executada.**
- **Isolamento Preview/Production:** a proteção em código (gate no build e no
  runtime, CSP por ambiente, Sentry só em Production) foi implementada e testada
  localmente, sem exceção por variável. Falta comprovar com um Preview real na
  Vercel depois do merge e tratar os Previews anteriores à contenção, que seguem
  publicados.
- **Observabilidade histórica incompleta**, limitada pelas janelas de log dos planos.
- **Custo do trigger do último admin em Production** não medido.
- **Migration `019`** (fechamento): fora da C02; exige reordenar o timestamp, adaptar
  a suíte `014` e resolver conflitos nas branches da feature.

Outros itens, de menor gravidade:

- **Diagnóstico P3 no banco** — `sincronizar_chave_da_diaria` pode devolver
  `23503` "Folha não encontrada" numa tentativa em AAL1, porque o trigger é
  `SECURITY INVOKER` e lê `timesheets`, que a policy esconde. A operação
  continua bloqueada: é problema de mensagem, não de acesso.
- **Incidente de recuperação não reproduzido** — uma falha posterior ao
  `verifyOtp` redirecionou uma vez para `link-invalido` e a causa não foi
  comprovada. Não é bug aberto. Se voltar, o caminho é reinstrumentar o fluxo,
  não adivinhar.
- **Banco de Production com poucos dados** — "AAL1 leu 0 linhas" num banco vazio
  não distingue bloqueio de ausência de dado; testes em Production provam menos
  do que parecem. Os testes SQL locais é que medem as proteções.

### C05-B — vigências financeiras (banco em Production; interfaces ainda não publicadas)

**Situação em 23/10/2026** (fatos de Production em
[docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md), seção "Vigências financeiras"):

| Frente                              | Implementado | Validado                             | Publicado                   | Pendente                                     |
| ----------------------------------- | ------------ | ------------------------------------ | --------------------------- | -------------------------------------------- |
| Banco (migrations `021` a `028`)    | sim          | ensaio local e conferência por lote  | **sim, em Production** (33) | —                                            |
| Motor atual (`010`)                 | sim          | preservado, funções e gatilho iguais | em uso (ligado)             | —                                            |
| Motor por vigência (`025`)          | sim          | estrutura conferida, nunca ativado   | instalado, **desligado**    | ativação: decisão de negócio, etapa própria  |
| Interfaces (PR B)                   | sim, branch  | 26 suítes Node; sem Preview          | **não**                     | PR B, Preview, merge e deploy (autorizações) |
| Vigências dos 7 cadastros pendentes | —            | —                                    | nenhuma cadastrada          | decisão de negócio: datas e valores          |

Regra de negócio: cada apontamento preserva as condições vigentes na data trabalhada;
reajuste futuro não reescreve diária anterior; faturado é imutável; nada é recalculado
em silêncio. Ordem das migrations:

- **021** e **022** (expansão do esquema): **aplicadas em Production** (L1, 23/10/2026).
- **023**: registro de vigências de contrato e de custo por RPC admin AAL2, trilha
  `financial_terms_audit` e imutabilidade das versões. **Aplicada em Production** (L2, 23/10/2026).
- **024**: vigência do valor acordado por operação (`operation_terms`, `operation_terms_id`
  no apontamento, RPCs espelho das da 023) e o **congelamento de jornada de turno usado,
  criado DESABILITADO**. **Aplicada em Production** (L2); nenhum efeito sobre o cálculo.
- **025**: motor financeiro por vigência, **desligado por padrão** e reversível
  (`financial_engine_settings`, `alterar_motor_vigencia`). Ligar troca 6 triggers de uma vez
  (motor antigo desabilitado; motor novo, 3 bloqueios de edição direta e congelamento de
  turno habilitados); desligar volta ao motor antigo, ressincroniza as colunas das taxas pela
  versão vigente hoje e deixa a trilha. **Aplicada em Production** (L3, 23/10/2026), com o motor
  **desligado**. Regras do motor ligado: preço pela versão da data trabalhada, sem
  fallback para a taxa atual; edição usa os preços congelados; apontamento legado só muda
  por `regularizar_apontamento_legado`; operação com legado recusa data anterior à ativação
  (R7); operação com apontamento não troca de contrato (R6).
  Falta não exige vigência (zerada, sem preço inventado); voltar a presença exige vigência na data;
  contrato antigo com jornada <= 0 entra no histórico com a jornada já normalizada (8 h).
- **Interfaces (U3–U7, branch `feat/c05b-interfaces-vigencia`; implementadas, NÃO publicadas):** contratos,
  colaboradores e operações sem contrato ganham histórico de vigências e registro de reajuste
  (com motivo, início e distinção entre alteração imediata e vigência futura) pelas RPCs das
  migrations 023 e 024. O estado do motor tem quatro valores (carregando, desligado, ligado,
  desconhecido): só `desligado` comprovado mantém a edição tradicional das taxas; ligado, a taxa
  muda por nova vigência; desconhecido (falha de consulta, permissão, resposta inválida ou gatilhos
  inconsistentes) deixa as condições financeiras somente para leitura. Apontamentos mostram o valor
  do banco, a prévia com o preço congelado ou a vigência da data trabalhada, e a origem; sem
  vigência a linha é bloqueada na tela. Turnos usados com jornada protegida só aceitam nome e
  status e oferecem "novo turno a partir deste". As telas **não** ligam, desligam, sincronizam nem
  regularizam o motor (fora do escopo). Dependência registrada: a tela do operador não mostra
  valores nem origem de vigência.

- **026** (cadastro atômico, C05-B5.1): `criar_contrato_com_vigencia`, `criar_colaborador_com_vigencia`
  e `criar_operacao_com_vigencia` criam a entidade e a vigência inicial na mesma transação (antes
  eram dois passos, e a falha do segundo deixava a entidade sem condição financeira). São
  `SECURITY INVOKER`: o INSERT segue a RLS e a vigência vai pelas RPCs 023/024, que revalidam admin
  AAL2 e gravam a trilha. **Aplicada em Production** (L4, 23/10/2026). As telas só a usam com o motor ligado (desligado, o INSERT direto continua). Os tipos
  do Supabase (`types.ts`) foram regenerados do schema local até a 026.

- **027** (ativação com divergência, C05-B5.5): com o motor desligado, a edição direta de taxa
  muda só a coluna, não a vigência cadastrada; a 025 ligava mesmo assim e o preço passava, em
  silêncio, da coluna para a vigência (não havia sobrescrita das colunas, só troca da fonte).
  `alterar_motor_vigencia(true, ...)` agora recusa (55000) enquanto existir cadastro cuja coluna
  difere da vigência ativa de hoje; a conferência roda dentro da transação, depois de habilitar os
  bloqueios (as tabelas já estão travadas), e a exceção desfaz tudo. Ausência de vigência segue
  como pendência; vigência futura e operação com contrato não entram; `p_aceitar_pendencias` não
  libera divergência. Lista para o admin: `divergencias_implantacao_vigencias()`. Corrigir é ato
  explícito (editar a coluna com o motor desligado, `sincronizar_colunas_legadas` ou registrar a
  vigência desejada). **Aplicada em Production** (L4). A trava de pendências continua contornável
  com `p_aceitar_pendencias = true`: a `027` fecha só a divergência.

- **028** (contrato da operação protegido, C05-B5.6): `operations.contract_id` não pode mais
  mudar (trocar, preencher ou remover) quando a operação tem apontamento ou valor acordado
  cadastrado (`operation_terms`), com o motor ligado **ou** desligado; a recusa é 55000 e manda
  criar uma nova operação. Antes só havia bloqueio ligado e só com apontamento (a 025): desligado a
  troca era livre, e ligado com valor acordado cadastrado e sem apontamento também. Operação sem
  histórico segue editável; contrato de outro cliente segue recusado pela 021. Trigger sempre
  habilitado, `SECURITY INVOKER`, `postgres` e `service_role` isentos como nas demais guardas.
  Segunda porta fechada (C05-B5.6A): excluir o contrato desvinculava a operação pelo `SET NULL` da
  chave estrangeira, que roda como dono e escapava do trigger; um `BEFORE DELETE` em `contracts`
  recusa (55000) a exclusão quando a operação ligada tem apontamento ou valor acordado cadastrado,
  sem exceção de papel. Contrato sem operação ou com operação sem histórico segue excluível.
  **Aplicada em Production** (L4). Vale desde já, com o motor desligado: o contrato das operações
  que têm apontamento não troca.

- **029** (regras confirmadas pela BS, C05-B8.10): **só no repositório**, não aplicada em nenhum
  banco remoto. Hora extra paga pelo valor-hora acordado por colaborador, custo proporcional na
  saída antecipada (cobrança inalterada), adicionais de serviço separados da diária e incluídos
  em `gerar_fatura`, e recusa de entrada igual à saída no banco. Detalhes, validação e regras
  ainda pendentes de decisão da BS em [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md).

- **030** (regras definitivas da BS, C05-B8.15): **só no repositório**. Arredondamento da hora extra
  cobrada (diário ou acumulado no período, por contrato), saída antecipada cobrada
  proporcionalmente, jornada de referência de sábado, pagamento em feriado com fator e calendário de
  feriados, e saldo de horas informativo. Detalhes e pendências no
  [ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md).

- **Legado (C05-B5.7):** sem migration nova. As RPCs que já existiam bastam: `pendencias_implantacao_vigencias`
  (em uso e sem vigência para hoje), `divergencias_implantacao_vigencias` (027), `registrar_*` (023/024,
  data e motivo informados por quem decide), `sincronizar_colunas_legadas` e
  `regularizar_apontamento_legado` (prévia, só não faturado, com motor ligado). A lacuna comprovada era a
  administração não enxergar as listas: nenhuma tela as consumia. Nova tela só de leitura,
  `/implantacao-vigencias` (menu de conta do admin, `exigirAdmin`; só na branch, não publicada): pendências, divergências com o
  campo, a contagem de apontamentos legados e o link para a tela do cadastro. Não registra, não
  sincroniza, não liga, não mostra valor em reais. Apontamento e fatura antigos seguem como
  gravados (suíte SQL 025). Decisões que continuam do negócio: de qual data vale cada preço
  histórico, e se um apontamento legado deve ser regularizado (reprecificado pelas vigências).

Próximos passos da C05-B, em ordem e cada um com autorização própria:

1. Publicar a branch e abrir o PR B (ainda não existe).
2. Validar em Preview, que exige projeto Supabase de teste próprio no escopo Preview (não
   verificado) e uma conta admin em AAL2 nesse projeto.
3. Merge e deploy das interfaces. Depois, conferência só de leitura em Production.
4. Decidir as 7 pendências de vigência (4 colaboradores, 2 contratos, 1 operação sem contrato):
   data de início e valor de cada uma.
5. Só então, e em etapa separada, avaliar a ativação do motor, com as dependências abaixo.
6. Limpeza final do projeto (dados fictícios, ramos antigos): etapa futura, não iniciada.

Riscos abertos: um admin em AAL2 pode ligar o motor pela API com `p_aceitar_pendencias = true`
(há 1 admin); logs de Production não verificados depois dos lotes; o backup mais recente é anterior
à `025`; o dump não preserva event triggers. O PR #63 e a migration `019` seguem separados.

Dependências da ativação (ligar o motor da 025, não antes):

1. **Bloqueio da edição direta** de `contracts`, `employees` e `operations.agreed_amount`:
   hoje as telas gravam esses campos por `UPDATE`; bloquear antes quebra os formulários.
   Exige trocar os formulários pelas RPCs de vigência (data de início e motivo).
2. **Congelamento de turno usado:** habilitar `trg_shifts_congela_jornada_usada` junto com a
   tela de turnos, que tem de traduzir o erro `23514` e oferecer "novo turno" (hoje o
   formulário reenvia o objeto inteiro e funciona porque o trigger está desabilitado). A
   derivação grava `planned_minutes_snapshot` e o reaproveita enquanto o turno da folha
   não mudar.
3. **`operations.contract_id`:** resolvido pela 028 (não muda com apontamento ou valor
   acordado cadastrado). Sem histórico, a troca segue livre; isso é de propósito.
4. **Legado:** valores existentes são preservados; regularizar condição antiga exige
   admin, motivo e trilha (as RPCs da 023 e da 024 já fazem isso), nunca recálculo
   automático. Apontamento sem versão na data é recusado, sem fallback para a taxa atual.

## Decisões que não se reabrem

- **Não** reconstruir o Supabase, nem reaplicar migration já aplicada, nem editar
  uma aplicada. Mudança de banco exige migration nova.
- **Não** reintroduzir TanStack Start/Router, Vite, Nitro, Vinxi, Wrangler ou
  Lovable.
- **Não** afrouxar as proteções financeiras das migrations `010`/`011`.
- **Não** adicionar enforcement de AAL2 em `user_roles`, e **não** remover a
  policy AAL2 global sem substituição segura.
- **Não** abrir a superfície do operador: nenhuma coluna financeira, `client_id`,
  documento ou telefone no retorno das RPCs; nenhum campo novo no JSON de escrita
  sem decisão de produto; nenhuma RPC de exclusão; nenhum `EXECUTE` dos helpers
  para `authenticated`.
- **Não** transformar o frontend em autoridade de segurança.
- **Não** reabrir a hipótese de incompatibilidade PKCE na recuperação: foi
  refutada pelo código-fonte do GoTrue.
- **Não** mudar sem entender as quatro linhas `if (…) return
falharDepoisDeVerificar()` da Server Action de recuperação.
- Decisões de produto congeladas da interface operacional: fonte de dados por
  papel, tela operacional separada, fechar e reabrir folha só pelo admin, nenhum
  fallback para operação sem turno, `admin` + `operacional` tratado como admin e
  tipos gerados do banco conferidos antes de sobrescrever.
- **Não** tocar no site institucional, **não** ativar signup público, **não**
  usar `supabase config push`, **não** modificar DNS sem confirmação.

## Como retomar

1. Leia o [CLAUDE.md](CLAUDE.md).
2. Leia este arquivo e, antes de qualquer mudança de autorização, a seção
   "Superfície operacional" e "RLS e banco" de [docs/SEGURANCA.md](docs/SEGURANCA.md).
3. Confira `git status` e o `HEAD`.
4. Não reaudite o projeto inteiro sem necessidade.
5. Se o estado real divergir do que está escrito, **pare e reporte**.
