# Estado do projeto

Fotografia factual do sistema de **BS Soluções Logísticas**. É a **fonte única**
dos dados que mudam com o tempo (o que está em Production, cobertura de testes,
estado das dependências): os demais documentos apontam para cá em vez de repeti-los.
Etapa atual e próximos passos ficam em [PROGRESS.md](../PROGRESS.md).

## FIN-PR-11B — checkpoint de desenvolvimento local (04/11/2026)

### FIN-PR-11B.R1 — P2 da revisão do PR #95 (04/11/2026)

Partida: `978c116e7e6aab9ecb7b85a08728b831f5813737`, branch
`feat/fin-pr-11b-backend-containers`, worktree limpa. A revisão independente
identificou que o DROP TRIGGER poderia aguardar em `billing_additionals`.
O rollback agora trava essa tabela primeiro, seguida das três tabelas novas,
com `ACCESS EXCLUSIVE NOWAIT` antes das guardas. Nenhuma aquisição espera por
outra transação; conflito aborta imediatamente e desfaz as travas já adquiridas.
Corpo financeiro de `gerar_fatura`, migration 045, RPCs e RLS não foram alterados.

RED real: sessão com ROW EXCLUSIVE confirmada em `billing_additionals`; o prefixo
antigo retornou sucesso em 0,096 s, violando a expectativa de `55P03`. Nenhum DROP
foi executado nessa prova. GREEN com o escritor ainda ativo: `55P03` em
`billing_additionals` (0,095 s), `container_service_audit` (0,105 s),
`container_service_participants` (0,447 s) e `container_services` (0,194 s).
Catálogo e dados permaneceram iguais nos quatro casos. O teste limita o SQL a
2 s e o processo a 10 s, separando a inspeção Docker da medição; uma rodada
intermediária detectou atraso da inspeção, sem falha da recusa SQL.

Regressões R1 executadas: 59 scripts Node, lint, TypeScript, AST Python,
Prettier Markdown e diff check aprovados. Rollback permitido restaurou catálogo
exato 044 e preservou dados/auditoria. Os ensaios usaram exclusivamente o projeto
descartável `bs-fin11-local-3fi66bvw`, com labels/volume/rede reconferidos.

**Limitações desta rodada:** o reset seguinte excedeu 300 s; uma tentativa com o
binário 2.117.0 já instalado, sem resolução npm, também excedeu 300 s. O Postgres
aceita conexões, mas sem `public.clients` nem catálogo de migrations. Não houve
outra tentativa nem intervenção em recursos de outros projetos. A repetição da
paridade OFF completa, do rollback bloqueado com histórico e das suítes SQL R1
ficou pendente; seus PASS no checkpoint original abaixo são históricos.
Build local Turbopack bloqueado ao abrir porta (`EPERM`), inclusive após exceção
específica; Webpack bloqueado por DNS de `fonts.googleapis.com` e encerrado.
Não interpretar essas falhas ambientais como testes aprovados. Logs R1:
`/private/tmp/fin11-r1-*.log`, fora do Git.

PR #95 permanece Draft. Próximo gate: conferir CI do novo HEAD e repetir os
ensaios SQL pendentes após recuperar somente o ambiente descartável, seguido de
revisão independente. Até lá, validação R1 incompleta. Rollback continua restrito
a 045→044 antes de uso, sem concorrência; histórico deve recusar com `55000`,
sem remoção de serviços/auditoria. Nenhum banco remoto, Preview, HML ou Production
foi acessado/alterado, e FIN-PR-11C não foi iniciado.

### Checkpoint original da implementação

Git confirmado nesta execução: desenho FIN-PR-11/PR #93 integrado em
`cc5405b8cd2e6203ba2d4190aaa3b88f463595a2`; domínio puro FIN-PR-11A/PR #94
integrado em `cebf80e3a1c9b74e47d6f5c0e43255d9fa3489c4`, base desta implementação.
Branch isolada: `feat/fin-pr-11b-backend-containers`. Commit do backend e testes:
`7acfbe9b7cb44ca82a785d9018e509bddc627c4e`; a continuidade documental é registrada
no commit seguinte. Escopo implementado e validado localmente, aguardando revisão
independente em PR Draft; não homologado nem integrado à main neste checkpoint.

A migration nova `20261112120000_045_container_servico.sql` foi aplicada somente
no Supabase local descartável. Separa execução, participantes/custos devidos e
auditoria, vinculando uma única receita a `billing_additionals`. As RPCs
`registrar_servico_container(jsonb,uuid,text)` e
`cancelar_servico_container(uuid,text)` revalidam admin, sessão e piso MFA atual,
com escrita direta vedada, RLS, motivos, auditoria e trava transacional por
cliente. `gerar_fatura` mantém o fluxo existente e acrescenta apenas o custo
devido dos containers dos mesmos adicionais selecionados. Diárias, HE, bônus e
faturas existentes preservam suas regras. Não há preço fixo, rateio automático
ou registro de pagamento quitado. Detalhes no
[contrato do backend](financeiro/container-servico-avulso.md#contrato-do-backend-fin-pr-11b).

**Evidências executadas nesta sessão:**

- RED SQL real até a 044: ausência de
  `registrar_servico_container(jsonb,uuid,text)`; execução chegou ao banco, sem
  erro de infraestrutura. Adaptador também teve RED antes da implementação.
- GREEN: todas as **46 suítes SQL**, incluindo **88 asserções da 045**, em banco
  limpo; todos os **59 scripts Node `test:*`**, com sete testes do adaptador e
  23 do domínio integrado. Lint, `tsc --noEmit`, Prettier nos formatos suportados,
  build e `git diff --check` passaram.
- Três provas com sessões PostgreSQL concorrentes: retry da mesma chave gera
  somente um serviço/receita/trilha; cancelamento vencedor impede fatura vazia;
  faturamento vencedor impede cancelamento, preservando receita e custo.
- Matriz de ambas as RPCs: admin AAL1 sem fator e admin AAL2 com fator permitidos;
  MFA pendente, operacional, sem papel, anon e sessão inválida recusados. Testes
  de DML direto, atomicidade após erro intermediário, fatura só de containers,
  fatura mista, competência distinta e imutabilidade passaram.
- Paridade OFF **044×045 exata**, antes/depois da instalação e repetindo as
  operações: valores, minutos, fontes, snapshots, itens/faturas e auditoria
  preservados. Normalização restrita a IDs técnicos e timestamps voláteis.
- Catálogo: somente três tabelas, suas constraints/índices/triggers/policies,
  cinco funções novas, guarda de cancelamento do adicional e o delta de custo
  em `gerar_fatura`. Owner, ACL, security_definer e config anteriores preservados.
- Compatibilidade do app com **034, 037, 038, 039, 040, 041, 042, 043 e 044**:
  **541 asserções**, sem falhas. O backend novo foi testado no schema 045; telas
  de containers não fazem parte desta etapa.
- Rollback antes do uso restaurou catálogo exato 044 e preservou os dados.
  Após uso, recusou com `55000`, sem mudar catálogo, serviços, faturas ou trilha.
  Revisão estática identificou uma janela concorrente no rollback: corrigida
  com `ACCESS EXCLUSIVE NOWAIT` antes da guarda e comprovada por RED/GREEN real
  com `55P03` nas três tabelas. A revisão da correção não encontrou outro bloqueio
  concreto nesse escopo; não substitui a revisão independente do PR.

Os inventários das suítes 010/015 receberam somente os três objetos e seis
policies novos, conservando os inventários antigos. O pin da suíte 035 para
`gerar_fatura` mudou de `6fdfcdaf72100fb7db4bc381a2230e41` para
`b7ddafbd6b0276f99ebf8eac8147a50a`: a comparação de catálogo exige o delta exato
de custo avulso, sem alteração de oráculos monetários. Falhas intermediárias
de inventário e contaminação por fixtures foram corrigidas por inventário
explícito e nova execução em banco limpo, sem tolerância financeira.

**Reprodução e isolamento:** checkout `/private/tmp/bs-fin-pr-11b`; instância
`/private/tmp/bs-fin11-local-3fi66bvw`, com project_id próprio, labels, único volume,
rede e portas exclusivos conferidos. Nesse diretório descartável, os runners
`testar-sql-local.sh` e `testar-compatibilidade-deploy.sh` usam apenas resets
`--local`. Os três scripts `testar-container-*-local.py` recebem esse workdir e
revalidam o alvo; paridade/rollback fazem resets exclusivos, concorrência grava
fixtures sintéticas e a prova de travas do rollback exige tabelas novas vazias.
Executar essas provas separadamente, restaurando o alvo local entre fixtures.
Logs desta execução estão em `/private/tmp/fin11-*.log`; catálogo e dados em
`fin11-evidence/` dentro da instância descartável. Não são artefatos versionados;
os runners e fixtures permitem reproduzir as provas.

Nenhum container/volume anterior foi reutilizado ou removido. Todas as migrations
anteriores foram comparadas byte a byte com a base. A CI inclui os novos testes
Node e um job SQL em VM efêmera, com identidade exclusiva, sem secrets/vínculo
remoto. Seus resultados remotos devem ser conferidos no HEAD do PR após publicar.
Não houve consulta ou alteração de banco remoto, nem alteração administrativa de
Preview, HML ou Production. O estado desses ambientes continua não comprovado por
esta etapa. Código versionado, Preview do aplicativo, migration aplicada e
ativação de regras são estados distintos.

**Riscos e próximo gate:** revisão independente do PR Draft e CI do HEAD. A chave
de idempotência precisa ser reutilizada para o mesmo pedido; uma nova chave não
permite inferir duplicidade física pela referência opcional. A API não edita
valores: correção antes de faturar exige cancelamento e novo serviço. Rollback
somente de 045 para 044 antes de qualquer uso, sem concorrência; nunca apagar
histórico para vencer a guarda. Integração visual FIN-PR-11C, homologação em HML,
restore, migrations remotas e ativação dependem de gates/autorização específicos.
Nenhum desses passos foi iniciado, e não houve merge.

## Checkpoint verificado no GitHub — 04/11/2026

Registro anterior, preservado como evidência histórica; não representa a main
mais recente confirmada no checkpoint FIN-PR-11B acima.

**Fonte e limite:** refs, PRs, checks e commits consultados no GitHub. Não houve
consulta autenticada ao catálogo efetivo do Supabase, ao banco HML ou às
variáveis/destino do Preview. Código mergeado, deploy do aplicativo, migration
aplicada e flag ativada **não são equivalentes**.

| Superfície            | Última evidência verificável                                                                                                                                                                                                                                                                                | Limite e próximo gate                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `main` (Git)          | HEAD `041aa27b2de41390f121fcc931a18430f34473e1`. [FIN-PR-10 / PR #90](https://github.com/therunnas/bslogistica/pull/90) mergeado por squash em `5795c0960d9b58a9c54037adfdfe55b6213f2fc2`; [DOC-MASTER-01/B1 / PR #91](https://github.com/therunnas/bslogistica/pull/91) mergeado por squash no HEAD atual. | Migrations até a 044 **versionadas**, sem presumir implantação remota.                                                                  |
| Qualidade no Git      | CI do HEAD `3851a6e` do PR #90 e do HEAD `568269f` do PR #91 aprovadas; seis threads do #90 resolvidas. Revisão Codex do #91 concluída sem achados.                                                                                                                                                         | CodeRabbit do #91 não fez revisão substantiva por limite de uso; estado `success` do check não equivale a parecer.                      |
| Vercel                | Check de deploy do merge do PR #90: `success`; checks de Preview nos PRs aprovados.                                                                                                                                                                                                                         | O deploy de Production após o PR #91 e o comportamento do domínio não foram revalidados neste checkpoint.                               |
| Preview               | Proteções de isolamento documentadas e testes de código anteriores.                                                                                                                                                                                                                                         | **Destino real do Supabase e separação dos dados não comprovados nesta verificação**. Não inserir dados reais sem o gate de isolamento. |
| HML / Supabase        | Sem leitura do catálogo remoto neste checkpoint.                                                                                                                                                                                                                                                            | Determinar projeto, versão do schema, migrations, roles, flags e possibilidade de restauração antes de aplicar alterações.              |
| Production / Supabase | Último relato histórico: migrations 032–034 aplicadas, motor por vigência ligado desde 29/10 e resolução comercial por função/colaborador **OFF**.                                                                                                                                                          | Situação atual e aplicação de 035–044 **não verificadas ao vivo**. Nenhuma migration ou flag alterada por estes merges.                 |
| Backup e acesso       | Backups e ensaios anteriores registrados nos históricos do projeto.                                                                                                                                                                                                                                         | Restauração integral atual, matriz E2E real de papéis e recuperação não foram comprovadas neste checkpoint.                             |

**Sequência de entrega:** concluir a reconciliação documental DOC-MASTER-01/B2,
verificar ambientes e backups por leitura antes de qualquer alteração, executar
FIN-PR-11 (container como serviço avulso), FIN-PR-12 (XLSX Dynamis) e FIN-PR-13
(conciliação/HML) em PRs isolados. Só então avaliar migrations remotas, rollout
financeiro, matriz E2E final e aceite do cliente por gates específicos. O PR
[antigo #63](https://github.com/therunnas/bslogistica/pull/63) permanece fora
deste fluxo até triagem explícita.

**Evidência negativa:** este checkpoint não certifica HML, Production/DB,
restore completo, regras comerciais ativadas ou homologação de ponta a ponta.

## Checkpoint histórico de 02/11/2026 — início do FIN-PR-10

**Registro histórico, não status vigente.** As referências abaixo a
`FIN-PR-10 em andamento`, `PR #90 Draft`, ausência de autorização de merge e
motor desligado em outubro descrevem decisões e estados daqueles dias. O
checkpoint de 04/11 acima prevalece para o Git atual; estados remotos continuam
sujeitos à comprovação por ambiente.

**Ambientes: último estado informado, não revalidado nesta sessão.** O GitHub
confirma o PR #89 (FIN-PR-09) mergeado em
`5e28b01fef992090136595aa2ee5dd97975e1160`, base do FIN-PR-10.
O FIN-PR-08 e as correções documentais anteriores permanecem integrados.
Código versionado, validação de testes, publicação de aplicação, aplicação de
migrations e ativação de funcionalidade são estados distintos.

- Motor financeiro por vigência: ativo em Production desde 29/10/2026, conforme
  informado. Resolução comercial de tarifas por função/colaborador: **desligada**.
  São controles diferentes.
- Migrations 032 (MFA opcional), 033 (integridade da taxa legada) e 034 (MFA
  somente no login): aplicadas em Production, conforme informado. As migrations
  035–043 estão versionadas. Não há aplicação remota da 043 confirmada no último
  checkpoint; as anteriores permanecem conforme o último estado informado. Código
  mergeado não comprova aplicação em HML ou Production.
- FIN-PR-01, 02, 03, 05, 06, 07 e 08 foram integrados; PR-04 foi absorvido pelo
  PR-02. FIN-PR-09 foi mergeado; FIN-PR-10 está em andamento local.
- SEC-DEP-01 foi integrado. A matriz E2E e a comprovação de isolamento real de
  Preview/HML permanecem pendentes; riscos residuais estão em [Segurança](SEGURANCA.md).

### Migrations financeiras versionadas

| Migration | Escopo                                 |
| --------- | -------------------------------------- |
| 030       | Regras comerciais anteriores           |
| 035       | Núcleo financeiro puro V2              |
| 036       | Integração do núcleo V2                |
| 037       | Leitores por componentes               |
| 038       | Período contratual e competência       |
| 039       | Catálogo de funções e período do turno |
| 040       | Snapshots de função e período          |
| 041       | Tarifas por função, período e vigência |
| 042       | Diária individual e bônus diário       |
| 043       | Dias especiais V2 (PR #89 mergeado)    |
| 044       | Calendário territorial (PR #90 no Git) |

O repositório contém suítes para essas entregas; resultados históricos não
comprovam execução nesta sessão. As migrações remotas e a ativação de preços não
podem ser inferidas de código mergeado nem dos testes locais.

### Regras financeiras e estágio

- Dia útil: referência líquida de 8 horas e intervalo conforme turno; saída
  antecipada proporcional; HE pela diária comercial dividida por 8 e multiplicada
  por 1,5, com arredondamento diário 15/45 ou acumulado quando configurado.
- Sábado: referência de cobrança de 4 horas, diária integral até a referência,
  HE depois dela e divisor 8 para HE.
- Domingo e feriado: regra integrada pelo **FIN-PR-09**, somente com resolução
  comercial ON: sem diária-base nem HE comum; minutos trabalhados × diária
  comercial resolvida × 2 ÷ 480; custo previsto separado também ×2; arredondamento
  especial configurável, com minutos exatos por padrão. Domingo também feriado
  recebe o fator uma vez. Com OFF, novos lançamentos preservam a regra anterior.
- Com resolução comercial ligada, a fonte é a diária individual vigente por
  colaborador e contrato; na ausência, a tarifa padrão de contrato, função,
  período e vigência; sem fonte válida, há erro. Operação sem contrato usa sua
  fonte de valor acordado. Com resolução desligada preservam-se valores legados.
- Função e período são snapshots; a HE usa a diária comercial resolvida. O bônus
  diário por acúmulo é separado, somado uma vez, fora da base de HE, e registrado
  por RPC administrativa com motivo e auditoria. Domingo/feriado em V2 admite
  bônus conforme FIN-PR-09; registros legados e resolução OFF recusam novos bônus.
- Preço cobrado não é custo do colaborador. O sistema apresenta **custo previsto**,
  não folha de pagamento; não se presume custo para o bônus.

### FIN-PR-09 — mergeado

A migration `20261110120000_043_dias_especiais_v2.sql` integra domingo/feriado ao
núcleo 035 somente com resolução comercial ligada. OFF conserva a 042; instalar
não recalcula lançamentos nem ativa tarifas. O classificador histórico permanece.
O componente especial substitui base e HE; o bônus permanece separado, sem fator
nem custo fictício. Prévia de dia especial elegível aguarda o banco ao salvar,
sem exibir o cálculo legado como estimativa da regra nova. Apontamentos e
Fechamento mostram especial e bônus separados. CSV/XLSX acrescentam esses
componentes quando há valor, mantendo as colunas anteriores nas mesmas posições
e preservando o formato quando ambos são zero. Não é a exportação específica
de cliente do FIN-PR-12. Preço individual, tarifa padrão e custo mantêm vigências
independentes; operação sem contrato usa valor acordado e minutos exatos.

`contract_terms.special_rounding_mode` é imutável na versão: `minutos` (default)
ou `meia_hora_15_45` (fronteiras do núcleo: 15 inclui meia hora, 45 inclui hora
inteira). Só a cobrança arredonda; o custo usa minutos efetivos. A nova RPC
`registrar_condicao_contrato_especial` espelha os parâmetros da RPC antiga e
acrescenta `p_special_rounding_mode`; registra uma versão com motivo e auditoria.
As assinaturas antigas permanecem; o registro pela assinatura antiga herda o
modo da versão ativa imediatamente anterior (ou minutos sem anterior), e a
correção contratual preserva o modo da versão corrigida. Trocar modo exige nova
vigência. A configuração não tem nova interface nesta etapa.

Provas locais reproduzíveis: suíte `supabase/tests/043_dias_especiais_v2.sql`,
`npm run test:dias-especiais` e
`python3 scripts/testar-dias-especiais-local.py /private/tmp/bs-fin09-local-<id>`.
O último exige uma instância exclusiva recém-criada, com workdir, `project_id`,
volume e rede correspondentes; recusa vínculo remoto. Executa resets **locais**
até a 042, compara catálogo, dados OFF e ensaia rollback permitido/bloqueado.
Normaliza UUIDs técnicos por chaves lógicas e timestamps voláteis; preserva
valores, minutos, fontes e classificação. A coluna nova é excluída da comparação
com a 042. Evidências ficam na pasta temporária da instância, fora do Git.
Os runners SQL/deploy devem executar em cópia isolada do código, com configuração
temporária própria; nunca sobre volumes anteriores associados ao `project_id`
versionado. CLI fixado em 2.117.0 para reprodução; nenhuma dependência do app nova.

Rollback: [rollback-dias-especiais-v2.sql](runbooks/rollback-dias-especiais-v2.sql).
Recusa uso especial V2 ou configuração incompatível, inclusive auditada; não
apaga bônus, snapshots, tarifas, lastro ou trilha. Nenhuma aplicação remota desta
migration é autorizada por esta implementação. Evidências da entrega e da revisão
R1 estão no PR #89. Especial V2 não faturado que exija recálculo com resolução OFF
é recusado com 55000; notas sem mudança financeira preservam valores, e ON permite
recalcular preservando o bônus. Faturados continuam imutáveis.

### FIN-PR-10 — calendário territorial nacional (histórico do PR #90)

Desenvolvimento e testes exclusivamente locais, seguido de commits, push e PR
Draft. Sem autorização para merge, Ready for Review, deploy, HML, Production,
ativação de tarifas ou carga remota. Migrations 001–043 permanecem intactas.
O estado mutável permanece centralizado neste documento; PROGRESS aponta para cá.

A migration `20261111120000_044_calendario_territorial.sql` está implementada na
branch `feat/fin-pr-10-calendario-nacional`, sem aplicação remota. O primeiro
commit, `4edb43e40182811ce1b6f805bdcf82a2af68aa81`, contém somente este documento e
PROGRESS. O modelo usa `financial_holidays`, catálogo IBGE, local de execução
vigenciado e cobertura oficial anual por âmbito. Novas presenças ON sem local ou
cobertura confirmados são recusadas; OFF conserva o caminho anterior. Não houve
carga real de calendário, backfill ou ativação de preços.

Validação local repetida no FIN-PR-10/R1: 45 suítes SQL no schema 044 e todas
as 57 suítes Node passaram; lint, TypeScript, Prettier nos formatos suportados e
build também. A suíte 044 contém 255 asserções, incluindo 52 específicas de R1;
a renderização comportamental da interface cobre 17 casos.
Paridade financeira OFF exata 042/043 e 043/044, catálogo e rollback permitido e
bloqueado foram comprovados na instância descartável exclusiva. Compatibilidade
034, 037, 038, 039, 040, 041, 042, 043 e 044 aprovada: 541 asserções, zero falhas.
Entrega em PR Draft para revisão independente, sem Ready for Review ou merge.

Na revisão R1 do PR #90, o cadastro escolhe a interface pelo regime financeiro
confirmado e pela capacidade: OFF mantém calendário/RPCs legados; ON com 044 usa
territorial; estado desconhecido não libera cadastro. Brasília/DF mantém o código
IBGE `5300108` e os mesmos campos de vínculo/snapshot, sem município jurídico.
O âmbito `distrital` exige UF DF, sem código municipal; o calendário do DF exige
coberturas nacional e distrital, sem terceira cobertura municipal fictícia.
As demais UFs mantêm as três coberturas. Nenhuma data distrital foi inferida.

RED/GREEN registrados para OFF e DF. A matriz distrital confirma admin sem fator
em AAL1 e admin com fator em AAL2; recusa MFA pendente, operacional, sem papel,
anon e sessão inválida sem escrita/auditoria residual. Sobreposição com domingo
cobra ×2 uma vez; fatura e snapshots permanecem imutáveis após aposentadoria de
feriado/cobertura. O corpo da derivação financeira e os pins de MD5 não mudaram
em R1. As duas referências de Ilhota esclarecem a alteração do Anexo Único do
Decreto 14/2026 pelo Decreto 235/2026, sem mudar datas ou classificações.

Os ensaios R1 reutilizaram somente a instância descartável exclusiva FIN10 após
revalidar labels, volume, rede e fixtures sintéticos. Nenhuma ação em banco
remoto. PR #90 permanece Draft para revisão independente. Resultados da CI devem
ser conferidos no HEAD remoto do PR. Sem Ready for Review ou merge.

Contratos, guardas e reprodução em
[calendario-territorial.md](financeiro/calendario-territorial.md); pesquisa oficial,
datas e pendências em
[calendario-fontes-oficiais.md](financeiro/calendario-fontes-oficiais.md). Fontes
municipais ainda exigem conferência do cliente e da legislação aplicável; anos
sem calendário anual confirmado permanecem pendentes. A regra de turnos mistos
não foi ativada: classificações distintas são bloqueadas com 55000 até decisão
comercial explícita sobre segmentos e horários do intervalo.

Regras confirmadas para esta etapa:

- Calendário expansível para todas as UFs e municípios brasileiros, sem alteração
  de código ao incluir uma nova localidade. Prioridade inicial: Santa Catarina,
  Itajaí, Navegantes, Balneário Camboriú, Brusque, Barra Velha e Ilhota.
- O local real da execução determina a abrangência nacional, estadual e municipal;
  não se presume a sede do cliente. Localidade conhecida e calendário oficialmente
  confirmado são estados distintos. Ausência de cadastro não prova dia útil.
- Fechamento predominantemente quinzenal, com modalidade mensal. Não há aprovação
  do cliente no fluxo de fechamento.
- Jornada de referência de 8 horas; intervalo conforme turno, de 1 ou 2 horas.
  Turnos mistos exigem identificação dos segmentos por data civil; sem horário do
  intervalo, não se inventa sua distribuição nem nova cobrança. A classificação
  financeira por segmento depende de regra comercial confirmada; FIN-PR-09 segue
  protegido enquanto essa decisão estiver pendente.
- Adicionais avulsos podem ter competência de cobrança diferente da execução.
  Container é serviço avulso com cobrança negociada e pagamento por container,
  exclusivo do FIN-PR-11; não será desenvolvido nesta etapa.
- Diária individual muda por admin mediante nova vigência. Históricos, snapshots
  e faturas não são reprecificados. Domingo/feriado e bônus seguem FIN-PR-09.
- Custo previsto não é folha de pagamento.
- Fontes oficiais para 2026–2028 serão conferidas; datas municipais dependem de
  conferência do cliente antes de ativação real. Sem comprovação, ficam pendentes;
  ponto facultativo não vira feriado automaticamente. Nenhuma carga real na migration.

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
| Migrations            | Ver checkpoint acima; versão no Git não comprova aplicação remota.                                                                            |
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
