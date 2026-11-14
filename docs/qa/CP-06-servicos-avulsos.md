# QA-BS-01 · CP-06 — Serviços avulsos

Sessão 09 (13/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`f22d7e26ab36d74f81a17220617c88366503feb4` (CP-05). PR #134 (Draft).

## Modelo de negócio usado nesta auditoria

A BS tem **dois** modelos de operação: **operação fixa** (recorrente, com contrato, equipe, turnos,
apontamento de presença, diárias e horas extras) e **serviço avulso** (pontual, pedido pelo
cliente conforme a necessidade). **Contêiner é um tipo de serviço avulso**, como etiquetagem,
empacotamento ou limpeza — não é uma terceira modalidade. **Adicional** é um valor complementar
associado a uma operação ou serviço; também não é uma modalidade.

**Fluxo canônico do serviço avulso no sistema** (decisão do #121: "serviço pontual vira operação
avulsa"): Operações → Nova operação → tipo **Avulsa** (no banco, `operations.type = 'spot'`), sem
contrato, com **valor próprio por diária** e **data do serviço**; os participantes entram pelo
apontamento do dia, e cada um tem o custo do seu cadastro.

**Caminho legado:** o módulo `/containers` (migrations 045–050). Gera um serviço com valor total
negociado, quantidade e custo por participante, e a receita vira um **adicional**
(`billing_additionals`). Saiu do menu no #121, mas continuava aberto por URL e pelo link
"Ver container" do Faturamento (D7).

Configuração testada = Production (semente E2E): motor por vigência LIGADO, resolução de tarifas
DESLIGADA, domingo e feriado em dobro LIGADO.

## Isolamento e incidente herdado

- Antes dos testes: os scripts executáveis da sessão só apontam para `127.0.0.1` (conferido por
  busca literal); os dois scripts remotos do CP-05 seguem desativados (`*.REMOTO-NAO-EXECUTAR`).
  Consultas ao banco só pelo container local `supabase_db_bs-e2e-*`.
- O incidente do CP-04/CP-05 continua registrado: **4 chamadas vazias** à API de gerenciamento do
  HML (`{"query": "\n"}`), duas no CP-04 (21:41 e 21:43 UTC de 12/11) e duas no CP-05 (22:47 UTC),
  sem SQL executado. Conferido de novo pela transcrição da sessão: nenhuma outra chamada a `q.sh`
  ou `qp.sh` desde o início da QA-BS-01. Nenhum acesso remoto no CP-06.

## Inventário de telas e ações

| Tela / ação                                                                   | Caminho                       | Resultado                 | Evidência                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Criar serviço avulso (operação tipo Avulsa)                                   | `/operacoes`                  | PASS                      | PR (spec 90): três avulsos, `spot`, sem contrato                          |
| Cliente, nome/descrição, valor por diária, data do serviço                    | `/operacoes`                  | PASS                      | PR, AV1, AV2; regressão do CP-04 (OP3)                                    |
| Tipo do serviço                                                               | —                             | NÃO DISPONÍVEL            | não há campo de tipo; o tipo fica no nome e nas observações (DEC-CP06-01) |
| Quantidade e unidade de cobrança                                              | —                             | NÃO DISPONÍVEL            | a avulsa cobra por diária × participante (DEC-CP06-02)                    |
| Pedido e execução no mesmo dia, sem contrato                                  | `/operacoes`, `/apontamentos` | PASS                      | AV1                                                                       |
| Participantes (um ou vários) e custo individual                               | `/apontamentos`               | PASS                      | AV1 (2), AV2 (1 + 1)                                                      |
| Editar, excluir com dependência, duplo clique, falha de rede, duas abas       | `/operacoes`, `/apontamentos` | PASS (regressão)          | CP-04 OP2–OP5; CP-05 RB1, RB2                                             |
| Cadastro NOVO pelo caminho legado de contêiner                                | `/containers/novo`            | **CORRIGIDO** (D7)        | D7: a URL mostra o aviso e leva às Operações; o servidor recusa           |
| Lista de registros antigos de contêiner                                       | `/containers`                 | **CORRIGIDO** (D7)        | D7: "Estes são registros antigos.", sem botão de cadastro                 |
| Detalhe e cancelamento de registro antigo                                     | `/containers/[id]`            | PASS                      | D7c: cancelado com motivo; histórico preservado                           |
| Correção de registro antigo                                                   | `/containers/[id]/corrigir`   | NÃO TESTADO no E2E        | coberta por `test:container-*` (049); mantida para os registros antigos   |
| Link do Faturamento para o registro antigo                                    | `/faturamento`                | **CORRIGIDO** (D7)        | "Ver registro antigo de contêiner"                                        |
| Aviso de cobrança em dobro (registro antigo × apontamentos da mesma operação) | `/faturamento`                | **CORRIGIDO** (D-CP06-01) | D7b, D7c                                                                  |
| Novo adicional (duplo clique)                                                 | `/faturamento`                | **CORRIGIDO** (D-CP06-02) | AD1: um registro, diálogo fecha                                           |
| Texto do bloco de adicionais                                                  | `/faturamento`                | **CORRIGIDO** (D-CP06-03) | C3                                                                        |
| Cancelar adicional não faturado (motivo obrigatório)                          | `/faturamento`                | PASS                      | AD2: sai do total; motivo gravado                                         |
| Adicional faturado imutável                                                   | `/faturamento`                | PASS                      | FE1: "Conferir cancelamento" desabilitado                                 |
| Fechamento do período                                                         | `/fechamento`                 | PASS                      | FE1: 1.050,00 / 680,00                                                    |
| Fatura única e nenhuma segunda cobrança                                       | `/faturamento`                | PASS                      | FE1: 1 fatura, 4 lançamentos, "Gerar fatura" desabilitado depois          |
| Relatório por colaborador                                                     | `/relatorios`                 | PASS                      | FE1: receita e custo de cada participante                                 |
| Operacional: telas e dados de contêiner e adicionais                          | `/containers`, API, RPC       | PASS                      | SG1                                                                       |

Ações reais encontradas: 21; testadas nesta sessão: 18; 1 não testada no E2E (correção de registro
antigo, coberta pelas suítes Node); 2 não disponíveis (tipo e unidade/quantidade).

## Tipos de serviço avulso

| Tipo                                                      | Disponível como               | Teste | Valor                                       | Custo              |
| --------------------------------------------------------- | ----------------------------- | ----- | ------------------------------------------- | ------------------ |
| Contêiner (40 pés, tecidos)                               | operação Avulsa               | AV1   | R$ 300/diária × 2 = 600,00                  | 160 + 200 = 360,00 |
| Etiquetagem (caixas)                                      | operação Avulsa               | AV2   | R$ 220/diária × 1 = 220,00                  | 150,00             |
| Limpeza (galpão)                                          | operação Avulsa               | AV2   | R$ 180/diária × 1 = 180,00                  | 170,00             |
| Caminhão, palete, empacotamento, retrabalho, movimentação | operação Avulsa (mesmo fluxo) | —     | não exercidos separadamente: mesmo cadastro | —                  |

O sistema **não diferencia** tipos: não há catálogo, unidade, quantidade nem campos específicos
(tamanho do contêiner, mercadoria, escopo da limpeza). Nada disso é exigido de quem cadastra uma
limpeza ou uma etiquetagem — e nada disso é registrado para um contêiner. Particularidades ficam
no nome e nas observações. A categoria não interfere no cálculo (é texto).

## D7 — caminho legado de contêiner

1. **Fluxo canônico:** operação Avulsa (acima).
2. **Caminhos legados encontrados:** `/containers` (lista), `/containers/novo` (cadastro, com o
   parâmetro `?operacao=` para ligar o contêiner a uma operação), `/containers/[id]` (detalhe e
   cancelamento), `/containers/[id]/corrigir`, o link "Ver container" do Faturamento, as Server
   Actions de `containers/_acoes.ts` e as RPCs `registrar_servico_container`,
   `corrigir_servico_container` e `cancelar_servico_container`. O custo dos participantes entra no
   Faturamento, no Dashboard e nos Relatórios; a receita entra como adicional.
3. **Risco comprovado (RED, HEAD `f22d7e2`):** um contêiner cadastrado como operação avulsa (dois
   participantes, R$ 600) e o MESMO contêiner registrado pelo caminho antigo ligado a essa operação
   (R$ 600, custos 160 + 200): o Faturamento somou **R$ 1.600,00** no período (correto: R$
   1.000,00) e o Fechamento **R$ 1.650,00** com o adicional, sem nenhum aviso. A URL
   `/containers/novo` oferecia o formulário completo a qualquer administrador.
4. **Correção (GREEN):** o cadastro NOVO pelo caminho legado foi encerrado na tela
   (`/containers/novo` mostra o aviso e leva às Operações; a lista não oferece cadastro) e no
   servidor (`registrarContainerAction` confere o admin e recusa sem chamar a RPC). O Faturamento
   avisa a possível cobrança em dobro quando um registro antigo disponível está ligado a uma
   operação com apontamentos a faturar no período, e o link diz "Ver registro antigo de
   contêiner". **Nada foi apagado**: tabelas, registros, rotas de consulta, correção e
   cancelamento, trilha de auditoria e componentes continuam.
5. **Cobrança única comprovada:** cancelado o registro antigo duplicado, o total volta a R$
   1.000,00, a fatura sai com R$ 1.050,00 (avulsos + adicional) e não há segunda cobrança.
6. **Residual (AUT-CP06-01):** a RPC `registrar_servico_container` continua executável por um
   administrador direto pela API (o E2E a usa para simular o registro antigo). Fechar esse
   caminho exige migration (revogar o `EXECUTE` ou recusar dentro da função), com plano de
   compatibilidade — não executado.

## Participantes e custos

| Cenário                                     | Resultado                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Um participante                             | PASS (etiquetagem, limpeza)                                                                               |
| Vários participantes com custos diferentes  | PASS (contêiner: 160 e 200)                                                                               |
| Valor cobrado × custo                       | separados: receita pela diária do avulso, custo pelo cadastro de cada colaborador                         |
| Custo do participante por serviço           | não existe na avulsa (o módulo antigo tinha "por pessoa" e "total distribuído"); decisão C4 / DEC-CP06-03 |
| Serviço sem participante                    | não gera receita nem custo (sem apontamento)                                                              |
| Participante em dois avulsos ao mesmo tempo | exige mover a alocação (exclusividade de equipe da 006); DEC-CP06-05                                      |
| Serviço faturado                            | lançamentos travados (regressão do CP-05 e spec 10)                                                       |

Resultado bruto do cenário: receita 1.050,00 (avulsos 1.000,00 + adicional 50,00) − custo 680,00 =
**370,00** (margem operacional, não lucro líquido).

## Adicionais

- Natureza: valor complementar do período (`billing_additionals`), com motivo, referência,
  operação opcional, janela de execução, competência de cobrança (038), chave de idempotência
  (047) e trilha. Um adicional de registro antigo de contêiner não pode ser cancelado
  isoladamente (só pelo próprio registro), o que evita desencontro entre serviço e cobrança.
- **D-CP06-02:** com duplo clique em "Registrar adicional", a chave persistente evitava o
  duplicado no banco, mas o diálogo ficava aberto sem confirmação; um novo envio com qualquer
  campo alterado geraria outra chave e outra cobrança. Corrigido com a trava de diálogo.
- **D-CP06-03:** o bloco dizia "Valores extras do período (etiquetagem, separação, contêiner…)",
  induzindo a registrar um serviço avulso como adicional — uma segunda origem de cobrança para o
  mesmo trabalho. O texto agora diz que serviço avulso se cadastra em Operações.
- O sistema não consegue saber se um adicional manual representa o mesmo valor já cobrado por um
  avulso: isso continua sendo conferência humana (risco R-CP06-03).

## Integração financeira (ao centavo, cálculo independente)

| Etapa                                                              | Esperado                                | Obtido                                         |
| ------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------- |
| Lançamentos (Ana 300/160, Bia 300/200, Caio 220/150, Davi 180/170) | 1.000,00 / 680,00                       | igual (banco)                                  |
| Adicional                                                          | 50,00                                   | igual                                          |
| Faturamento antes do cancelamento do duplicado                     | 1.000,00 + 600,00 (aviso)               | 1.600,00 com aviso                             |
| Faturamento depois                                                 | 1.050,00                                | igual                                          |
| Fechamento 1ª quinzena                                             | 1.050,00 / 680,00                       | igual                                          |
| Fatura                                                             | 1.050,00 / custo 680,00 / 4 lançamentos | igual                                          |
| Segunda fatura                                                     | impossível                              | "Gerar fatura" desabilitado; 1 fatura no banco |
| Relatório por colaborador                                          | receita e custo de cada um              | igual                                          |

## Defeitos RED/GREEN

| ID        | Sev. | Esperado × obtido (antes)                                                                                                                                             | Correção                                                                                                                            | Regressão                              |
| --------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| D7        | P2   | Caminho legado de contêiner fora do menu, mas aberto por URL: `/containers/novo` registrava receita própria (adicional) e permitia ligar à operação avulsa já cobrada | cadastro novo encerrado na tela e no servidor; lista e link como "registros antigos"; consulta, correção e cancelamento preservados | D7, D7c; B1–B6; `test:container-telas` |
| D-CP06-01 | P2   | Registro antigo de contêiner + apontamentos da mesma operação: R$ 1.600,00 no Faturamento (correto 1.000,00), sem aviso                                               | aviso de possível cobrança em duplicidade com o nome da operação                                                                    | D7b; A1, A2, C1                        |
| D-CP06-02 | P2   | Duplo clique em "Registrar adicional": gravado uma vez, diálogo aberto sem confirmação                                                                                | trava de diálogo (só o erro e a reabertura soltam)                                                                                  | AD1; C4                                |
| D-CP06-03 | P3   | Texto do bloco de adicionais apresentava contêiner e etiquetagem como adicionais                                                                                      | texto corrigido                                                                                                                     | C3                                     |

Ajustes de teste: `test-container-telas` passou a esperar o aviso de cadastro encerrado em
`/containers/novo` (o teste antigo exigia o formulário com a operação de origem, que é justamente o
caminho do D7) e ganhou o stub da trava; a guarda administrativa continua conferida.

## Testes e resultados

- **RED** (`f22d7e2`), primeira execução do `90-servicos-avulsos`: `/containers/novo` com o
  formulário do caminho legado; Faturamento R$ 1.600,00 com o contêiner em dobro e sem aviso;
  Fechamento R$ 1.650,00; duplo clique em "Registrar adicional" com o diálogo aberto. Ajustes do
  próprio teste: o tipo "Avulsa" é `spot` no banco; dois seletores de texto ambíguos.
- **GREEN**, sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS;
  **78/78** `test:*` (nova `test:servicos-avulsos-cp06`, 12 asserções; `test:container-telas`
  65/65 na nova forma); travas 25/25; `npm run e2e:local` completo: **173 testes, 171 PASS, 0
  FAIL, 2 FALHA CONHECIDA, 0 PULADO**, 1198 s, nenhuma rede externa; depois, com o AD2
  acrescentado, spec 90 completo **10/10**; `sql-local` **52 suítes** PASS; 0 containers e 0
  volumes no fim.
- **CP-01 a CP-05 íntegros:** specs 10, 20, 30, 40, 41, 50, 60, 70 e 80 PASS na mesma execução.
- **Falhas conhecidas:** D4 (CP-07) e CN-D (DEC-CP02-01), sem mudança.

## Segurança

- Operacional: `/containers` e `/containers/novo` respondem "Área administrativa restrita"; pela
  API, `container_services`, `container_service_participants` e `billing_additionals` devolvem zero
  linha; a RPC `registrar_servico_container` recusa (SG1).
- Server Actions de containers conferem `exigirAdminAtor` no servidor antes de qualquer resposta,
  inclusive a recusa do cadastro encerrado. RLS sem alteração.

## Casos não testados

- Correção de registro antigo pela tela (`/containers/[id]/corrigir`): coberta pelas suítes
  `test:container-*`; não exercida no E2E.
- Tipos caminhão, palete, empacotamento, retrabalho e movimentação: mesmo fluxo da avulsa, sem
  diferença no sistema; não exercidos um a um.
- Competência de cobrança diferente da execução para avulso: coberta no CP-07 (fechamento).
- Exportações (CSV/XLSX) com serviço avulso: CP-08.

## Riscos residuais

- **R-CP06-01 (AUT-CP06-01):** RPC de registro de contêiner ainda executável pela API por admin.
- **R-CP06-02:** o aviso de duplicidade depende do vínculo do registro antigo com a operação; um
  registro antigo sem operação, ou ligado a outra, não é comparado.
- **R-CP06-03:** adicional manual com o mesmo valor de um avulso não é detectável.
- **R-CP06-04:** sem tipo, unidade e quantidade, relatórios não separam resultado por tipo de
  serviço (item 15 da matriz negócio × sistema).
- Herdados: **AUT-CP05-01** (trava do D1 e conferência de versão no banco) segue como risco
  financeiro pendente de autorização; D4 (CP-07) e CN-D (DEC-CP02-01) seguem falhas conhecidas.

## Decisões pendentes

| ID          | Pergunta                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-CP06-01 | Catálogo de tipos de serviço avulso: quais tipos, e se viram campo próprio (exige schema)                                                          |
| DEC-CP06-02 | Unidade, quantidade e valor fechado por tipo (C5): hoje a avulsa só cobra por diária                                                               |
| DEC-CP06-03 | Custo do participante por serviço (por pessoa ou total distribuído, C4) em vez do custo do cadastro                                                |
| DEC-CP06-04 | Duplicidade com registro antigo: só avisar (hoje) ou bloquear a fatura                                                                             |
| DEC-CP06-05 | Participante em dois avulsos (ou em fixa e avulso) no mesmo período sem mover a alocação                                                           |
| AUT-CP06-01 | Migration para encerrar `registrar_servico_container` no banco (impacto: só cadastro novo; consulta, correção e cancelamento dos antigos mantidos) |

---

# CP-06B — Remoção do painel independente de Contêineres

Sessão 10 (13/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`569c301b6709a199f8fd5b74d9bf697e46bffeea` (CP-06). PR #134 (Draft).

## Regra do responsável

A BS tem dois modelos: **operação fixa** e **serviço avulso**. **Contêiner não é um módulo
independente**: é um tipo de serviço avulso, e todo serviço novo de contêiner se cadastra por
**Operações → Nova operação → Avulsa**. "O painel Container não é para mais existir."

O CP-06 tinha encerrado o **cadastro novo** pelo caminho antigo, mas a lista `/containers`, o
detalhe e a correção continuavam como um painel próprio, alcançável por URL e pelos links do
Faturamento. Isso não atendia à regra.

## RED (HEAD `569c301`)

Spec 90 reescrito para a regra, rodado contra o código do `569c301`:

- `/containers` renderizava a página própria, título "Containers";
- o link do Faturamento apontava para `/containers/<id>`;
- a operação Avulsa não explicava os tipos de serviço;
- `/operacoes/avulsos-antigos/<id>` não existia (404);
- as falhas seguintes eram consequência destas.

## O que mudou (GREEN)

| Antes                                                         | Depois                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/containers`: painel "Containers" com lista e filtros        | guarda de admin, depois **redireciona** para `/operacoes#servicos-avulsos-antigos`                                                                                       |
| `/containers/novo`: aviso de cadastro encerrado (CP-06)       | guarda, depois **redireciona** para `/operacoes?origem=conteiner`; Operações mostra "Contêiner é um tipo de serviço avulso" e o caminho correto                          |
| `/containers/<id>`: detalhe e cancelamento                    | guarda, depois **redireciona** para `/operacoes/avulsos-antigos/<id>`                                                                                                    |
| `/containers/<id>/corrigir`: correção                         | guarda, depois **redireciona** para `/operacoes/avulsos-antigos/<id>/corrigir`                                                                                           |
| link "Ver registro antigo de contêiner" (Faturamento)         | aponta para `/operacoes/avulsos-antigos/<id>`                                                                                                                            |
| lista própria                                                 | seção recolhível **"Serviços avulsos antigos"** no fim de Operações, sem título de painel, sem botão de cadastro, com "Ver registro" por item                            |
| rótulos "+ containers" em Faturamento, Fechamento e Dashboard | "+ serviços antigos de contêiner" (só texto: o cálculo é o mesmo)                                                                                                        |
| campo Tipo da Nova operação sem explicação                    | Avulsa: "serviço pontual — contêiner, carga e descarga, etiquetagem, limpeza…; identifique o tipo do serviço no nome"; Fixa: "recorrente, com contrato, turnos e equipe" |

- **Sem painel, menu ou atalho:** nenhum arquivo de `src` contém mais o texto `"/containers`
  (asserção B5); o menu do admin continua com oito itens, sem Contêineres (E5, E5c).
- **Guarda primeiro:** cada rota antiga chama `exigirAdmin()` antes do `redirect`; quem não é
  admin recebe "Área administrativa restrita" e não fica sabendo do destino.
- **Componente removido:** só `containers/cadastro-encerrado.tsx` (a página de aviso do CP-06,
  substituída pelo redirect). Os componentes de lista, detalhe, correção, formulário e as Server
  Actions continuam, agora servidos dentro de Operações.

## Registros históricos

- **Nada foi apagado nem migrado.** As tabelas `container_services`,
  `container_service_participants` e `container_service_audit`, os adicionais vinculados, a
  trilha e as RPCs de correção e cancelamento estão intactos. Sem migration, sem alteração de RLS
  ou de RPC.
- **Consulta, correção e cancelamento** ficam em Operações (`/operacoes/avulsos-antigos/<id>` e
  `/corrigir`), sob a mesma guarda e as mesmas Server Actions de antes.
- **Faturado continua imutável:** o registro antigo faturado mostra "Faturado" e não oferece
  "Cancelar serviço" (FE1).
- **Cancelado continua consultável:** D7c cancela, D7d confirma os dois registros no banco, o
  cancelado incluído.

## Classificação do tipo de serviço (DEC-CP06-01)

**Estado atual:** o tipo do serviço avulso **não é estruturado**. `operations` tem `type`
(`fixed` | `spot`, a modalidade), `name`, `notes`, `site`, `operation_date` e `agreed_amount`;
não existe coluna de categoria. A interface agora diz como identificar o tipo no nome e a
modalidade e o tipo aparecem separados (I1), mas **o nome livre não é um catálogo**: não foi criada
nenhuma lista falsa de tipos sobre texto livre, nem preço ou regra por tipo.

**Proposta (não executada, exige migration e DEC-CP06-01):**

| Alternativa                                                                        | Impacto                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A. Coluna `operations.service_kind` com `CHECK` sobre uma lista fixa, nula na fixa | migration pequena; operações existentes ficam nulas ("não classificado"); a lista só muda por migration |
| B. Tabela `service_kinds` (catálogo editável pelo admin) + FK em `operations`      | RLS, grants e tela de cadastro novos; o admin mantém a lista; relatórios por tipo ficam possíveis       |
| C. Manter no nome (hoje)                                                           | sem migration; relatórios não separam por tipo (R-CP06-04); depende da disciplina de quem cadastra      |

Em A ou B: a classificação não entra no cálculo financeiro (nenhuma regra por tipo sem decisão
própria); os registros antigos de contêiner podem ser mostrados como "contêiner (cadastro antigo)"
sem copiar dados; a fixa não exige tipo. Recomendação técnica: **B**, se a lista de tipos for
mudar com o negócio; **A**, se for estável. A escolha é do responsável.

## Faturamento e dupla cobrança

- O custo e a receita dos registros antigos continuam entrando em Faturamento, Fechamento,
  Dashboard e Relatórios **pelas mesmas funções**, sem mudança de cálculo.
- Novo serviço de contêiner (operação Avulsa), etiquetagem e limpeza: um lançamento por
  participante, cobrado uma vez (AV1, AV2, FE1).
- Registro antigo **cancelado**: sai do total (D7c). Registro antigo **faturado**: congelado
  (FE1).
- Registro antigo **sem operação** (R$ 120, custo 50): entra **uma vez** na fatura e continua
  consultável (D7d, FE1).
- **Adicional** manual: uma vez (AD1, FE1).
- **Cliente com serviço novo e registro antigo:** fatura única de **R$ 1.170,00**, custo
  **R$ 730,00**, 4 lançamentos (FE1). Conta: avulsos 1.000,00 + adicional 50,00 + registro
  antigo sem operação 120,00; custo 680,00 + 50,00.
- **A duplicidade continua só avisada** (D7b: total R$ 1.600,00 com o alerta "cobrado duas
  vezes"); bloquear a fatura é DEC-CP06-04, não decidido aqui. A RPC antiga continua aceitando
  criação pela API (AUT-CP06-01).

## Testes A–J

| ID  | Exigência                                 | Evidência                                                                                                             |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A   | não existe painel                         | D7: `/containers` cai em Operações, sem h1 "Containers"; B6 (lista sem PageHeader nem "Containers")                   |
| B   | criação só por Operações                  | D7 (`/containers/novo` → `/operacoes?origem=conteiner`); AV1, AV2; Server Action recusa (CP-06)                       |
| C   | URLs antigas não abrem cadastro           | D7, D7c; `test:container-telas` (redirect exato, nenhum componente renderizado, nada quando negado)                   |
| D   | nenhum link interno                       | D7: 0 `a[href^="/containers"]`, nenhum item de menu; B5 (nenhum `"/containers` em `src`); E5c                         |
| E   | registros antigos consultáveis            | D7b (seção abre e lista), D7c (detalhe por redirect), D7d                                                             |
| F   | nenhuma perda de dados                    | D7d: os dois registros no banco (um cancelado); nenhuma migration nem DELETE                                          |
| G   | valores preservados                       | D7b 1.600,00 com aviso; D7c 1.000,00; FE1 1.170,00 / 730,00 ao centavo                                                |
| H   | permissões                                | SG1 (operacional em `/containers`, `/containers/novo` e `/operacoes/avulsos-antigos/<id>`: restrito); `test:papel` B3 |
| I   | classificação compreensível e persistente | I1: textos de Avulsa e Fixa; nome com o tipo permanece depois de recarregar                                           |
| J   | sem cobrança duplicada                    | FE1: uma fatura, "Gerar fatura" desabilitado depois; D7b/D7c                                                          |

Suítes ajustadas para a forma nova (mesmas propriedades, não afrouxadas): `test:container-telas`
(rotas antigas e novas, 68 asserções), `test:servicos-avulsos-cp06` (15), `test:papel` (B3 confere
a guarda antes do redirect, 111), `test:custo-containers` e `test:margem-containers` (rótulos).

## Resultados

- **RED** (`569c301`): spec 90 na forma nova — `/containers` com o painel próprio, link do
  Faturamento para `/containers/<id>`, sem explicação do tipo, rota nova inexistente.
- **GREEN**, sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS
  (as rotas `/containers…` existem só como redirect); **78/78** `test:*`; travas 25/25; spec 90
  **12/12**; `npm run e2e:local` completo: **176 testes, 174 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0
  PULADO**, 1119 s, nenhuma conexão externa do servidor; `sql-local` **52 suítes** PASS; 0
  containers e 0 volumes no fim.
- **CP-01 a CP-06 íntegros:** specs 00 a 80 PASS na mesma execução.
- **Falhas conhecidas:** D4 (CP-07) e CN-D (DEC-CP02-01), sem mudança.
- `docs/ESTADO_DO_PROJETO.md` não foi alterado: descreve a `main` e a Production, onde o painel
  ainda existe até a integração deste PR.

## Pendências que continuam

- **AUT-CP06-01:** encerrar `registrar_servico_container` no banco (migration).
- **DEC-CP06-01** (classificação, acima), **DEC-CP06-02** (unidade e quantidade),
  **DEC-CP06-03** (custo por serviço), **DEC-CP06-04** (bloquear ou avisar a duplicidade),
  **DEC-CP06-05** (participante em dois avulsos).
- **AUT-CP05-01** (trava do D1 e conferência de versão no banco).
- Incidente do HML (4 chamadas vazias, CP-04/CP-05): continua registrado; **nenhum acesso remoto
  no CP-06B**.
