# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. CHECKPOINT-AUTO-07, 08/11/2026: PASS no ensaio de novos eventos em sandbox já inicializado. AUTO-06 continua FAIL histórico. Gate 1 da BS ainda BLOQUEADO por falta da prova do primeiro commit que introduz main:false. Controlador desativado.**

**Retomada:** seis documentos oficiais lidos diretamente do GitHub e conferidos
contra o checkout; início local/remoto do #111 em
`1af74ed60f4e6f4a8969a4e4b4dc88ccd53918d2`, branch
`integracao/release-preview-01`, worktree limpo; main BS `38b4349`. Reutilizados
somente o repositório/projeto sandbox existentes, sem novos recursos ou chaves.
SDLC: Testes de infraestrutura / Design da instalação controlada. PASS significa
A/B/C hospedados e D local aprovados no escopo descrito; não aprova bootstrap de
projeto novo nem instalação real. Este registro e o plano serão publicados somente
nos quatro documentos autorizados, com CI/Preview próprios conferidos no PR,
sem commit recursivo apenas para registrar checks.

## Identificação

| Campo | Valor |
| --- | --- |
| Etapa | CHECKPOINT-AUTO-07 PASS para projeto inicializado; plano mínimo preparado; Gate 1 ainda BLOQUEADO |
| Gate atual | Falta prova remota da transição main sem regra → primeiro commit main:false; nenhuma alteração real da BS ou ativação autorizada |
| Último gate concluído | A: 2 Previews READY; B: 2 pushes main sem deployment; C: terceiro Preview READY; D: 22 negativos/modelos locais PASS. Zero novos Production |
| Worktree | `/private/tmp/bs-fin-20d`; sandbox existente em `/private/tmp/bs-checkpoint-auto-06/sandbox` |
| Branch | `integracao/release-preview-01` na BS; main e preview/checkpoint no sandbox |
| Base | main BS `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, sem alteração |
| HEAD validado | 1af74ed60f4e6f4a8969a4e4b4dc88ccd53918d2 — início local/remoto do #111 e fonte do manifesto; novo commit documental tem checks próprios |
| Alterações não commitadas | Somente HANDOFF, PROGRESS, ESTADO_DO_PROJETO e CHECKPOINT_AUTOMATICO nesta tarefa; conferir status após publicação |
| PR | #111 e #112 abertos Draft; #112 segue 2d1c0cde7bd47154a281171d77858b530d0b6de2; sem merge, novo PR ou alteração funcional |
| Ambiente-alvo | Novos eventos Git automáticos apenas no sandbox já inicializado; BS somente leitura e publicação documental na branch do #111; sem Supabase |
| Última ação comprovada | Baseline 1 Production histórico/0 Preview; final 1 Production histórico/3 Preview READY, sem novos Production ou staged Production; configurações preservadas |
| Próxima ação exata | Aprovar protocolo TRANS-MAIN para comprovar introdução da trava somente no sandbox; qualquer baseline deliberadamente sem trava/Production sintético esperado exige autorização específica; não avançar ao Gate 1 real antes da prova |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | CHECKPOINT-AUTO-07: A/B/C hospedados com cinco commits sintéticos; D local; comparação sandbox/BS, manifesto mínimo e cinco gates; continuidade #112 preservada |
| Resultados e testes comprovados | A1/A2/C1 source git, SHA/branch corretos, target Preview e READY; B.1/B.2 listas antes/depois idênticas por 96,7/92,3 s; zero novos Production. 22 casos locais, 26 testes do motor e parsing/guardas de 3 workflows PASS; check:workflow, 8/8 testes documentais, diff --check e revisão dos quatro documentos sem padrões de segredo PASS |
| Código e PR afetados | Sandbox: apenas alterações sintéticas index.html, vercel.json main:false preservado. BS: somente quatro documentos, sem código/workflows/configuração alterados; publicação no #111 autorizada |
| Ambientes envolvidos | Sandbox Git/Vercel existentes; HEAD anônimo de Preview retorna 302 pela proteção, sem credenciais/cookies/redirects. BS em leitura, sem deploy manual, banco ou homologação funcional |
| Pendências e decisões | AUTO-07 PASS limitado ao projeto inicializado; AUTO-06 FAIL preservado. Gate 1 não reúne todas as condições: falta transição ausente→false. Combinação mínima sobre main ainda exige preparação/CI próprias em gate autorizado; nenhum escritor instalado/ativado |
| Próxima ação exata | Autorizar e executar prova adicional TRANS-MAIN apenas no sandbox após aprovar seu risco; depois decidir contenção real via PR mínimo, sem integrar #111/#112 inteiros |
| Autorizações e proibições | Executados somente commits/pushes sintéticos e deployments Git no sandbox; permitida publicação documental no #111. Sem main BS, merge, Production BS, Vercel BS, migrations, Supabase, chaves, domínios reais, novos recursos, force push ou bot |

## Evidência automática de Preview

<!-- checkpoint-preview:start -->
Automação não ativada: controlador com `false &&`, `contents: read` e `--dry-run`. Nenhum recibo remoto gerado pelo bot.
Históricos manuais de Preview abaixo continuam vinculados aos SHAs originais.
<!-- checkpoint-preview:end -->

## Estados funcionais anteriores — preservados (não são validação da automação)

Estados **não são equivalentes**: cada coluna precisa de evidência própria. "n.a." = não se aplica ao item.

| Item                                     | Implementado | Validado localmente | CI aprovada     | Publicado em Preview                            | Aplicado no HML | Homologado    | Em Production |
| ---------------------------------------- | ------------ | ------------------- | --------------- | ----------------------------------------------- | --------------- | ------------- | ------------- |
| UX-SIMPLIFICACAO-01/02 (telas)           | sim          | sim                 | sim (`9978684`) | sim (`9978684`)                                 | n.a. (só app)   | não           | não           |
| FUNC-READY-01, código do app             | sim          | sim (`c4b4456`)     | sim (`f03e8c7`) | sim (`f03e8c7`)                                 | n.a. (só app)   | não           | não           |
| Migration 048 (preço-base como 3º nível) | sim          | sim, só stack local | sim (`f03e8c7`) | sim (`f03e8c7`) (código); migration **inativa** | **não**         | não           | não           |
| Migration 049 (correção de container)    | sim          | sim, só stack local | sim (`f03e8c7`) | sim (`f03e8c7`) (código); migration **inativa** | **não**         | não           | não           |
| Migrations 046 e 047 (#108–#110)         | sim          | sim                 | sim             | código sim; migrations **inativas**             | **não**         | não           | não           |
| Migrations até a 045                     | sim          | sim                 | sim             | n.a.                                            | sim (head 045)  | parcial (S19) | não (034)     |

Estar no código do Preview **não** ativa 048, 049, 046 ou 047: o banco do Preview é o HML na 045. O app novo
mantém o comportamento anterior sem os anúncios `preco_base_recuo` e `correcao_container`.

## Arquivos locais × remotos

- **Publicado no GitHub:** implementação em `c5c62e99f91d154290247a1100cf98b090b6811d`, plano AUTO-03 em `92ee55afa763d2234784486dedb476f87abe820b`, registro final AUTO-03B em `80ebfbb0f1be3615832f6f456a3240b7715919a7` e quatro documentos AUTO-04B em `85128d1378a5fb6f92665d70147b9107f84ef5be`.
- **AUTO-04B publicada:** os quatro documentos estão em 85128d1, incluindo evidências sanitizadas AUTO-04. Este registro final é publicado em commit posterior exclusivo do HANDOFF; seu SHA/checks devem ser consultados no #111. Nenhuma alteração documental desta tarefa permanece exclusivamente local após a publicação final.
- **Publicado antes da AUTO-06:** resultado SEC-BYPASS-02/AUTO-05 em `e01fffa54bbc567b92b9f0b21a8c84dfe3460563`, ponto de partida remoto conferido.
- **AUTO-06 publicada:** checkpoint FAIL em `1af74ed60f4e6f4a8969a4e4b4dc88ccd53918d2`, preservado como histórico.
- **Conjunto AUTO-07:** quatro documentos de continuidade; o commit que contém este registro é o checkpoint desta tarefa. Consultar seu SHA/CI/Preview no #111; não transferir resultados de 1af74ed nem criar commit recursivo só de checks.
- **Sandbox remoto preservado:** [repositório privado](https://github.com/therunnas/bs-checkpoint-sandbox), projeto `bs-checkpoint-sandbox`; três commits históricos AUTO-06 e cinco commits sintéticos AUTO-07 descritos abaixo. Não fazem parte da release BS.
- **Outros artefatos somente locais:** logs `/private/tmp/checkpoint-auto-01-*`, inventário de backups e stack sintética. Não são necessários para executar o controlador ou ler o estado publicado.
- **Nunca publicar:** credenciais, `.env`, dumps, respostas brutas, URLs/identificadores secretos ou fingerprints. B2 foi criada somente na Vercel e selecionada como variável de sistema, sem cópia para Git/chat/arquivos. A exposição original foi tratada pela revogação de B1, preservando o registro histórico sanitizado.

Arquivos publicados (mesmo conjunto revisado):

- `.github/workflows/checkpoint-preview-signal.yml`
- `.github/workflows/checkpoint-preview.yml`
- `.github/workflows/ci.yml`
- `AGENTS.md`
- `CLAUDE.md`
- `PROGRESS.md`
- `docs/ESTADO_DO_PROJETO.md`
- `docs/HANDOFF.md`
- `docs/WORKFLOW.md`
- `docs/continuidade/CHECKPOINT_AUTOMATICO.md`
- `docs/continuidade/ESTADO_ATUAL.md`
- `docs/continuidade/PROTOCOLO_DE_TRABALHO.md`
- `package.json`
- `scripts/atualizar-checkpoint-preview.mjs`
- `scripts/checkpoint-github-api.mjs`
- `scripts/checkpoint-preview.mjs`
- `scripts/testar-checkpoint-preview.mjs`
- `scripts/testar-workflow-documental.mjs`
- `scripts/validar-workflow-documental.mjs`

## Evidências

### CHECKPOINT-AUTO-07 — 08/11/2026 — PASS no projeto inicializado

#### Baseline, configuração e provas hospedadas

Sandbox reutilizado: therunnas/bs-checkpoint-sandbox, projeto
`prj_mywfRcPkdzLckvuZwHyNNHPFcltS`, time bslogisticas. Nenhum recurso criado,
excluído ou reutilizado fora desse escopo. Production Branch main, Git conectado,
configuração das duas branches exatamente `git.deploymentEnabled: {"main": false}`;
demais branches habilitadas por padrão. Framework estático/null, outputDirectory `.`,
sem build/install/ignored-step concorrente nos retornos/snapshot efetivo; sem custom
environment, hook, env explícita ou domínio personalizado. Standard Protection
all_except_custom_domains e autoatribuição preservadas.

Baseline lido em `2026-11-08T21:59:09Z`: apenas
`dpl_3iP5NBVhdCp9gCifkNNFT5NDXwPJ`, target production, READY/PROMOTED, source git,
SHA `54f799d4f474bcadd81bd721a986f8301eead691`, ref preview/checkpoint, do AUTO-06.
Esse deployment foi mantido e **não** reclassificado. Main do sandbox começou em
48419e2 e Preview em 54f799d, ambas com main:false; worktree limpo antes dos pushes.
A documentação oficial da BS em 1af74ed confirmou os estados anteriores; B1/B2 de
segurança não foram testadas, recriadas ou removidas.

| Teste | Branch | SHA completo | Evidência nova / observação | Resultado |
| --- | --- | --- | --- | --- |
| A1 | preview/checkpoint | 5d688b74d70799e8d0f7d08798c792aeaa3dd0ea | Preview READY, source git; `dpl_DSjkkhPaSvvMXBPQk937ZYAnzfzK`; [URL](https://bs-checkpoint-sandbox-gx9ii807v-bslogisticas.vercel.app) | PASS |
| A2 | preview/checkpoint | 319213dff1e4276af87a459adbfda086fbeb1100 | Preview READY, source git; `dpl_9xWpBoAbDBG7FBntFwfZNhwjS2Pu`; [URL](https://bs-checkpoint-sandbox-b8c9hv5di-bslogisticas.vercel.app) | PASS |
| B.1 | main | 6415866f2280dd602672da78184ee63626e2b376 | 0 novos deployments; conjunto de IDs idêntico por 96,7 s | PASS |
| B.2 | main | 854cb832a6f0df10663082f9829075a1a74a2480 | 0 novos deployments; conjunto de IDs idêntico por 92,3 s | PASS |
| C1 | preview/checkpoint | eac4fa6801a2a2eec596092041a66cf4f77cf0eb | Preview READY, source git; `dpl_DeDQbY7khFDBeqi4C8AAUE4f43N5`; [URL](https://bs-checkpoint-sandbox-67tuyihny-bslogisticas.vercel.app) | PASS |

B.1/B.2 são nomes dos testes de push da main, **não** das credenciais de segurança.
Cada push foi precedido de baseline completo e validação da configuração; depois
houve confirmação do ref GitHub no SHA esperado e comparação paginada dos IDs
Vercel. B.1/B.2 tinham antes/depois exatamente o Production histórico + A1 + A2.
C1 demonstrou que a conexão Git continuava gerando Preview após os dois bloqueios.

Resultado final: **1 Production histórico + 3 Preview; 0 novos Production,
0 novos staged Production e 0 Preview da main**. A1/A2/C1 têm target null na API
Vercel, confirmado como ambiente Preview; readySubstate STAGED nesses Previews
não equivale a target production. Não houve evento/deployment inesperado nas
comparações. Conexão Git, Production Branch, regra e overrides foram reconferidos.
As janelas e a conferência posterior comprovam os eventos observados, não ausência
ilimitada de eventos futuros.

Limite de observabilidade: a API GitHub de eventos retornou lista vazia; não foi
inventado webhook de recebimento/PushEvent. Push normal, refs remotos e a lista
Vercel completa foram as provas utilizadas. No sandbox, createDeployments está
**disabled** e disableRepositoryDispatchEvents true: a emissão de notificações
GitHub não está configurada como na BS; a API GitHub de deployments do C1 retornou
zero registros. Isso não impediu os deployments Git comprovados na Vercel. Não
atribuir IDs GitHub aos IDs dpl_* nem declarar o controlador hospedado exercitado.

HEAD anônimo nas três URLs Preview respondeu 302 pela Deployment Protection.
Não houve uso/criação de bypass, cookies persistentes ou redirects; conteúdo
protegido da aplicação não foi autenticado. PASS é técnico de Git/target/READY,
não homologação funcional. Alias de branch do sandbox pode avançar automaticamente
com os Previews; os domains/aliases Production nativos e o deployment histórico
foram preservados. Nenhuma alteração manual de domínio, alias, proteção ou Git.

#### D local, mecanismo e preparação

- D: **22/22 casos locais PASS**, modelo de critérios + minimatch já instalado.
  Cobriu global true/false, globs sobrepostos, branch incorreta, configuração
  ausente, HEAD concorrente, consulta falha, paginação/dados incompletos, SHA/source
  incorretos, Preview pendente, Production novo/staged e evidência duplicada.
  Casos de consulta/dados insuficientes recusam PASS (BLOQUEADO); violações da
  regra resultam FAIL esperado pelo teste. Não foram executados remotamente.
- `npm run test:checkpoint-preview`: **26/26 PASS**, motor real com fixtures
  sintéticas: idempotência, loops, SHA, CAS, reprocessamento e resposta perdida.
- Parsing YAML e guardas dos três workflows PASS, com js-yaml existente. Controlador
  continua false &&, contents: read, --dry-run; nenhum arquivo de workflow alterado.
- Fonte do manifesto: 1af74ed; base main real: 38b4349. Imports do runtime conferidos:
  módulos Node nativos/locais, sem dependência nova, token Vercel ou B2. O grafo
  disponível pertence a checkout antigo e exclui scripts; usada a fonte exata
  nos caminhos relevantes, sem reindexação ou auditoria geral.

Comparação em leitura: ambos projetos usam main e Standard Protection; sandbox é
estático, privado e com zero env, BS é Next.js com 11 env explícitas, domínios reais
existentes e createDeployments enabled. Nenhum valor de env foi coletado ou copiado.
GitHub da BS mantém default_workflow_permissions read e aprovação de reviews pelo
GITHUB_TOKEN false. Não há necessidade de ampliar a permissão global para instalar
ou rodar dry-run. O bot usa API GitHub, não acessa Preview e não depende de B2.

**Gate 1 ainda BLOQUEADO:** A/B/C provaram a main **já bloqueada**, não a transição
real de arquivo sem regra para o primeiro commit main:false. A BS ainda não tem a
trava em vercel.json. O [plano técnico](continuidade/CHECKPOINT_AUTOMATICO.md#plano-técnico-checkpoint-auto-07)
define manifesto e cinco gates, e propõe TRANS-MAIN separado apenas no sandbox.
Nenhuma configuração da BS foi instalada ou ativada. Uma baseline deliberadamente
sem trava pode gerar Production sintético; não foi criada nesta tarefa e exige
nova decisão/autorização específica. Não usar modelo local ou PASS AUTO-07 como
substituto dessa prova. AUTO-06 permanece FAIL histórico para bootstrap novo.

#### Continuidade funcional e publicação

#111 continua aberto Draft; #112 permanece aberto Draft no mesmo HEAD
`2d1c0cde7bd47154a281171d77858b530d0b6de2`. Reaproveitada, sem repetir merge textual,
a análise AUTO-06: conflitos em HANDOFF, PROGRESS e ESTADO_DO_PROJETO; dois docs
novos de negócio não incorporados. Ordem futura: incorporar documentos de negócio
com autorização e preservação do checkpoint → reconciliar estados dos PRs → revisar
divergências funcionais sem reabrir auditorias válidas → priorizar financeiro e
suas decisões/migrations por ambiente → evoluir Serviços Avulsos → homologar o
sistema. Isso é fila, não autorização de implementação ou merge. Não assumir que
texto do #112 relativo à main descreve código da release #111 ou banco aplicado.

Artefatos locais sanitizados: `/private/tmp/bs-checkpoint-auto-07`; resultados,
modelos e cópias oficiais sem segredos. Não são checkpoint paralelo nem serão
commitados. Evidências necessárias estão neste registro e no plano versionado.
Validação documental deste conjunto: check:workflow PASS, 8/8 testes PASS,
diff --check PASS e revisão sem padrões de segredo nos quatro documentos. O commit
que contém este registro é o checkpoint AUTO-07; consultar seu SHA no #111 e seus
[checks/CI](https://github.com/therunnas/bslogistica/pull/111/checks), além do Preview
correspondente. A redação antecede esses resultados, sem PASS antecipado ou
transferido de 1af74ed. Conferência final entregue ao usuário sem commit recursivo
só de checks. Um Preview BS dessa publicação não é o ensaio sandbox.

### CHECKPOINT-AUTO-06 — 08/11/2026: ensaio hospedado FAIL

#### Recursos, isolamento e primeiro commit

- [Repo privado therunnas/bs-checkpoint-sandbox](https://github.com/therunnas/bs-checkpoint-sandbox),
  ID `1450656069`, criado em `2026-11-08T20:55:38Z`, default branch main.
- Projeto `bs-checkpoint-sandbox`, ID `prj_mywfRcPkdzLckvuZwHyNNHPFcltS`, criado
  no time bslogisticas em `2026-11-08T20:59:20.119Z`; plano existente Hobby,
  framework null/estático, outputDirectory `.`, zero variáveis explicitamente
  configuradas. Sem Supabase, banco, dados reais, credenciais BS, dependências ou
  domínios personalizados. Apenas aliases vercel.app nativos da plataforma.
- Nomes confirmados livres antes de criar. A consulta de instalação GitHub App
  pela sessão gh retornou 403; não houve ampliação de acesso. A conexão específica
  via Vercel funcionou com os acessos existentes, sem alteração administrativa.
- Fixture: somente index.html, README.md e vercel.json. Primeiro commit
  `9351b797794f3f45376a874a0b4bc97e7571b440` na main, já com
  `git.deploymentEnabled: {"main": false}`. Conteúdo confirmado no GitHub **antes**
  de conectar à Vercel. Nenhuma cópia da release #111, .env ou credencial.
- Conexão por `POST /v11/projects` com gitRepository específico. Não houve chamada
  de criação de deployment, CLI deploy, promoção manual ou criação de PR. O caminho
  REST de criação/conexão é registrado separadamente de eventual import pelo painel;
  não declarar que um import pelo painel tenha sido exercitado.

#### Resultado real e gate de parada

| Etapa / observação UTC de 08/11/2026 | SHA | Production | Preview | Resultado |
| --- | --- | --- | --- | --- |
| Criação/conexão inicial; leitura 21:00:40Z | 9351b797794f3f45376a874a0b4bc97e7571b440 | 0 | 0 | PASS da observação; nenhum deployment inicial solicitado pela API |
| Push adicional main; leitura 21:02:06Z | 48419e2b0b92e99e45b45f52ed35fbfd4a0cd529 | 0 | 0 | Zero Production observado nessa janela; não é aprovação do desenho completo |
| Primeiro push preview/checkpoint; leitura 21:03:49Z | 54f799d4f474bcadd81bd721a986f8301eead691 | 1 | 0 | **FAIL: target production, READY/PROMOTED** |
| Negativos hospedados de regras concorrentes | não executados | n.a. | n.a. | **BLOQUEADO** pelo gate de parada |
| Fase 4: preparar/validar instalação real | não executada | n.a. | n.a. | **BLOQUEADO**; condição de entrada não satisfeita |

**Deployment inesperado confirmado:** `dpl_3iP5NBVhdCp9gCifkNNFT5NDXwPJ`,
source git, target production, READY/PROMOTED, gitSource ref preview/checkpoint,
repoId 1450656069 e SHA exatamente `54f799d4f474bcadd81bd721a986f8301eead691`.
Criado em `2026-11-08T21:02:22.745Z`, READY em `21:02:25.159Z`.
[URL imutável do deployment](https://bs-checkpoint-sandbox-e2tbxwlt8-bslogisticas.vercel.app).
Aliases automáticos: bs-checkpoint-sandbox.vercel.app,
bs-checkpoint-sandbox-bslogisticas.vercel.app e
bs-checkpoint-sandbox-git-preview-checkpoint-bslogisticas.vercel.app.
A Production Branch continuava **main**, e o vercel.json do SHA Preview também
foi confirmado com main:false. Não houve troca de branch tracking ou promoção
manual. A API GitHub de deployments desse SHA retornou lista vazia; não inventar
ID GitHub nem confundir com o ID Vercel acima.

Contagem total na interrupção e na conferência final de **21:17:06Z**:
**1 Production (PROMOTED), 0 Preview, 0 outros**; nenhum staged observado. Foram contados todos os estados/targets retornados,
sem filtrar somente READY; paginação sem próxima página. Não houve novo push,
redeploy, alteração de regra, cancelamento ou exclusão no sandbox após a falha.
O deployment não foi reclassificado como Preview só pelo nome da branch.

A [documentação oficial Vercel](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)
afirma que o primeiro deployment de projeto novo é Production. Isso é consistente
com o caso observado: bloquear a branch main não impede que o primeiro deployment
permitido, vindo de outra branch, tenha target Production. Não se declara bug da
Vercel nem se afirma que todos os projetos existentes tenham esse comportamento.
O resultado **reprova o protocolo de bootstrap com zero Production + Preview**
como preparado na AUTO-05. Não continuar o ensaio já inicializado e chamar o
resultado de PASS retroativamente.

#### Diferenças para BS e consequência para a instalação

| Sandbox | BS real |
| --- | --- |
| Projeto novo, sem deployment anterior na conexão | Projeto estabelecido, Production já servido |
| Fixture estática, framework null, sem dependências/env | Next.js, workflows, dependências e variáveis próprias; nada copiado para o sandbox |
| main:false desde o primeiro commit | vercel.json real ainda sem bloqueio seletivo; não foi editado |
| Primeiro push Preview virou Production | Previews anteriores do #111 já eram target Preview; evidência histórica não aprova este ensaio |

A leitura da BS real antes/depois confirmou os mesmos IDs/aliases/SHAs e proteção:
Production `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4` de main `38b4349`, Preview
`dpl_5LJ8yCQ6MrzQTxi38wLEiYrXfWFV` de e01fffa e política Standard Protection
inalterados durante o ensaio. Nenhuma escrita em configuração Vercel BS, domínio,
alias, main, Supabase ou dados. O push documental autorizado ao final pode produzir
novo Preview BS e avançar seu alias automaticamente; é independente do FAIL do
sandbox e não torna o ensaio aprovado.

**Fase 4 não executada:** manifesto mínimo/validação sobre main real e nova
sequência de instalação não foram preparados como aprovados. O plano anterior
permanece histórico condicionado. Exige decisão do responsável sobre novo protocolo
para projeto já inicializado, com critérios próprios e preservação explícita do
FAIL AUTO-06. Um novo ensaio no sandbox atual só pode começar após essa decisão;
nenhuma autorização é inferida da criação anterior. Não usar o achado para
experimentar diretamente na main real. Controlador permanece com false &&,
contents: read e --dry-run; nenhum recibo automático ou ativação foi realizado.
SEC-BYPASS-02 segue concluída por evidência anterior, sem nova leitura de valores,
testes de B1/B2 ou rotação nesta etapa.

#### Continuidade dos PRs #112 e #111 — somente leitura

#112 aberto Draft, branch docs/alinhamento-negocio-sistema, HEAD
`2d1c0cde7bd47154a281171d77858b530d0b6de2`, base main. #111 aberto Draft,
HEAD e01fffa antes desta publicação. Base comum confirmada na API:
`38b43490a8e0913c62a4ee6047ef48a8288ca0dc`.
Comparação textual de três vias apenas em arquivos temporários, sem merge,
checkout ou edição da branch do #112:

| Documento do #112 | Resultado contra #111 e ação futura |
| --- | --- |
| PROGRESS.md | Conflito textual; manter tarefa ativa e fila do checkpoint mais recente, incorporar só links/pendências de negócio autorizados |
| docs/ESTADO_DO_PROJETO.md | Conflito textual; preservar histórico recente e natureza de arquivo histórico, sem restaurar sua antiga declaração de fonte única do estado |
| docs/HANDOFF.md | Conflito textual; não substituir pelo checkpoint antigo do #112, nem importar worktree, SHAs e testes 5/5 como atuais |
| docs/NEGOCIO.md e docs/NEGOCIO_X_SISTEMA.md | Dois arquivos novos no #112, ausentes em #111/base; sem colisão textual, ainda sujeitos a revisão semântica no HEAD que os receber |
| docs/ARQUITETURA.md e docs/financeiro/container-servico-avulso.md | Combinação textual sem conflito; revisão semântica ainda necessária para distinguir negócio aprovado, regra implementada e desenho histórico |

`NEGOCIO.md` separa funcionamento real e pontos a confirmar. A matriz
`NEGOCIO_X_SISTEMA.md` declara escopo de código na main 38b4349; não descreve
automaticamente a release #111, suas migrations até 049, estado de Preview ou
homologação. Datas/flags/estados de ambiente nela precisam de fonte e limite de
verificação no momento da incorporação. Generalização de Serviços Avulsos segue
não iniciada e sem autorização funcional; novas descrições comerciais não alteram
o código nem concedem permissão de migration.

**Próximos passos documentais, em autorização separada:** manter #112 aberto Draft,
portar primeiro os dois arquivos novos para o HEAD atualizado da linha #111,
revisar a matriz contra o código/ambientes desse HEAD sem repetir auditorias válidas,
incorporar somente os parágrafos pertinentes de arquitetura/container e os links,
e atualizar o HANDOFF vigente da tarefa em vez de adotar o antigo. Não fazer
cherry-pick/merge indiscriminado do commit completo com seus sete arquivos de
estado. Só depois avaliar integração futura na main sob gates próprios; merge de
PR documental também pode disparar Production enquanto o bloqueio real não existe.
Nenhum documento de negócio foi incorporado nesta etapa e nenhum PR foi alterado.

**Artefatos locais sanitizados:** `/private/tmp/bs-checkpoint-auto-06`, incluindo
fixture, configurações, snapshots, observações e cópias temporárias da revisão.
Não são checkpoint paralelo nem serão publicados como respostas brutas. Os IDs,
SHAs e resultados necessários à retomada estão neste registro versionável.
**Validação documental/publicação:** check:workflow PASS, test:workflow **8/8
PASS**, diff --check PASS e revisão dos quatro documentos sem padrões de segredo.
O commit que contém este registro publica somente os quatro documentos autorizados
no #111; descobrir seu SHA e consultar [checks/CI](https://github.com/therunnas/bslogistica/pull/111/checks)
e Preview correspondente. A redação antecede esses resultados, que não são
declarados aprovados antecipadamente. Conferência final entregue ao usuário, sem
novo commit recursivo só de checks. CI verde da BS não altera o FAIL do ensaio
hospedado nem autoriza instalação ou Production.

### SEC-BYPASS-02 / CHECKPOINT-AUTO-05 — 08/11/2026

#### Rotação autorizada e evidências

Projeto confirmado `prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV`, `bs-logistica-sistema`,
escopo `bslogisticas`. B1 foi identificada por **igualdade exata**, somente em
memória, com a credencial da saída original da AUTO-04; a incerteza de identidade
da SEC-BYPASS-01 foi resolvida sem imprimir, copiar, salvar ou gerar fingerprint
do valor. B1 correspondia ao único registro criado em 23/10, scope automation-bypass.

Reconferência focal, sem repetir auditoria geral: Actions e ambos os environments
continuavam sem secrets/variables; nenhuma integração Vercel adicional aplicável.
Nenhum consumidor externo acessível foi identificado para migração. Revisão focal
SEC-BYPASS-01 reaproveitada: app/main sem leitor funcional da env de bypass; módulo
server de Analytics apenas potencial, não importado. Não houve atualização de
GitHub secrets, Sentry, variáveis do app, Supabase ou arquivos de credenciais.

**Procedimento executado:** B2 adicionada preservando B1; B2 validada; riscos e
zero consumidores atualizados registrados antes do corte; B2 selecionada para
builds futuras, novamente validada; B1 revogada sem gerar outra chave. Após a
troca, a configuração contém **somente B2**, scope automation-bypass, isEnvVar true.
Valores ficaram somente na memória dos processos e no gerenciamento de segredos
Vercel; bodies PATCH enviados por stdin, nunca argumentos ou arquivos.

| Evidência UTC de 08/11/2026 | Resultado no Preview imutável de 8071a99 |
| --- | --- |
| 18:58:57, anônimo antes | 302 para hostname vercel.com, sem login do app |
| 18:59:01, B1 antes | 200, marcador da página de login do app |
| 18:59:07, B2 antes do corte | 200, mesmo marcador; propagação inicial exigiu nova leitura após aproximadamente 4 segundos |
| 19:01:18, B2 selecionada | Única selecionada para a env futura, B1 ainda presente; B2 200 |
| 19:01:21, revogação | B1 ausente, apenas B2 configurada e selecionada |
| 19:01:25, B1 após revogar | 302 para vercel.com, sem marcador do app; primeira leitura ainda aceitou B1 durante propagação de aproximadamente 4 segundos, sem PASS antecipado |
| 19:01:25, B2 após revogar | 200, marcador da página de login |
| 19:01:25, anônimo após | 302 para vercel.com; proteção continuou ativa |
| 19:01:31, continuidade | HEAD do login público 200; deployments/aliases e política de proteção conferidos inalterados |

Validação usou GET da página pública de login do Preview exato
`https://bs-logistica-sistema-5p4soi6bg-bslogisticas.vercel.app/login`, com header
em memória, **sem cookie jar/SSO e sem seguir redirects**, rejeitando outra origem
antes de abrir conexão e sem proxy intermediário configurado pelo processo.
Corpos, Location integral, Set-Cookie, headers e respostas brutas não foram
registrados. Não houve login de usuário nem requisição de negócio com sessão.
Teste em contexto limpo comprova rejeição de B1 nesse caminho; não comprova apagar
cópias externas nem invalidar toda sessão/cookie preexistente.

**Preservação durante a rotação:** Production
`dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4` (main 38b4349), seus quatro aliases, Preview
`dpl_9kmT1ZM9Qmh8fvotKRf3YSc1Ldpm` (8071a99) e seu alias de branch permaneceram
iguais. IDs/aliases conferidos por GET antes/depois. Production Branch main,
Standard Protection all_except_custom_domains e autoatribuição mantidas. Nenhum
deploy manual, promoção, alteração manual de domínio/alias ou de dados. O push
posterior desta documentação pode criar **novo Preview automático** e avançar seu
alias de branch; isso não é alteração de alias feita pela rotação. Production não
foi homologada e seu app/banco não foi publicado ou modificado.

**Riscos residuais e recuperação:** B1 permanece como valor obsoleto embutido nos
builds antigos; a plataforma não o reescreve sem deployment. Nenhum leitor funcional
foi encontrado na superfície revisada, portanto não surgiu justificativa nem
necessidade comprovada de redeploy. Usos fora do inventário continuam desconhecidos.
Se um consumidor aparecer, migrá-lo para B2 somente no escopo autorizado e testar;
não restaurar B1, desproteger URL ou executar deploy por inferência. Recurso/chave
adicional ou deployment necessário exige decisão própria. A seleção isEnvVar não
é garantia de migração de um consumidor externo nem de homologação funcional.

#### Preparação da automação e limite dos testes

Reutilizados os workflows e runtime publicados; nenhum alterado. Controlador
continua com `false &&`, `contents: read` e `--dry-run`; sinal sem permissões,
sem checkout e sem segredo Vercel. O bot consulta GitHub e **não depende de B2**.
Revisão focal confirmou guarda de branch padrão/main, allowlist, origem/URL,
CI/Preview/HEAD no mesmo SHA, recibo por deployment, diff documental, reconsulta
antes da escrita e expectedHeadOid. Workflow serializa eventos pelo SHA; GraphQL
CAS recusa avanço concorrente. Esse bloqueio de escrita do bot não bloqueia os
deployments Git da main: vercel.json real continua sem git.deploymentEnabled.

- `npm run test:checkpoint-preview`: **26/26 PASS**, incluindo repetição, loops,
  ordens CI/Preview, falhas, SHA divergente, concorrência/CAS e resposta perdida.
- Modelo local documentado com minimatch **3.1.5 já instalado**: **12/12 PASS**,
  sem dependência nova nem edição de vercel.json. Main false, Previews omitidos
  true, global false bloqueando Preview e regra true sobreposta liberando main
  foram exercitados. Matriz e passos no [plano](continuidade/CHECKPOINT_AUTOMATICO.md#preparação-local-checkpoint-auto-05).
  Trata-se de simulação da regra documentada, **não** execução do avaliador Vercel
  nem prova do primeiro commit/instalação hospedada.
- Inventário somente leitura: o time Vercel retornou **um projeto**, o BS real,
  sem paginação restante. Entre 49 repositórios próprios consultados, nenhum
  candidato descartável pelos nomes/descrições usados na busca. Nenhum recurso
  existente foi identificado/aprovado para ensaio; nome não prova finalidade.
- Escopo proposto: **um repositório privado** e **um projeto Vercel descartável**,
  fonte estática sintética, main + branch Preview, sem banco, secrets do app,
  domínio customizado, vínculo com o BS ou escrita no projeto real. Criar recursos,
  conectá-los e fazer pushes/deployments Git automáticos de fixture exige nova
  autorização; não criar PR, instalar controlador ou executar deploy manual por
  inferência. Ensaiar contagens antes/depois, primeiro commit bloqueado e Preview
  automático; todo eventual deployment isolado permanece fora da Production BS.

Artefatos de execução somente locais em `/private/tmp/bs-sec-bypass-02`: scripts
sem valores secretos, snapshots/jornal sanitizados e modelo sintético. Não são
fontes permanentes de estado nem serão commitados. Diagnóstico SEC-BYPASS-01
preservado abaixo como histórico, com suas incertezas no momento original.

**Validação documental/publicação deste conjunto:** check:workflow PASS,
8/8 testes documentais PASS e diff --check PASS. Comparação interna dos valores
B1/B2 com os documentos e artefatos locais sem ocorrência, sem exibir os valores.
Publicação autorizada exclusivamente dos quatro documentos na branch do #111.
O commit que contém este registro é o checkpoint desta tarefa: descobrir seu SHA
no PR e consultar [checks/CI](https://github.com/therunnas/bslogistica/pull/111/checks)
e deployment correspondente; não transferir CI/Preview de 8071a99. A redação
antecede esses checks, que não são declarados aprovados antecipadamente. Resultado
final é entregue ao usuário após a conferência, sem novo commit só de checks.

### SEC-BYPASS-01 — 08/11/2026, diagnóstico e plano somente locais

#### Inventário e limites de identificação

Projeto Vercel `bs-logistica-sistema`, ID `prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV`,
escopo `bslogisticas`. GET via CLI existente, sem imprimir respostas brutas,
credenciais, chaves do objeto protectionBypass ou nomes/valores de cookies.
Os valores sensíveis da resposta ficaram apenas na memória do processo de leitura;
nenhum foi usado em requisição, copiado para argumento de comando, arquivo ou log.

- **B1** é apenas um rótulo deste documento, nunca valor ou identificador secreto.
  Há **um** registro, scope `automation-bypass`, criado em
  `2026-10-23T18:41:52.791Z`, `isEnvVar: true`, sem nota. `autoExposeSystemEnvs: true`.
- B1 é o único candidato atual à credencial exposta na AUTO-04. A data é anterior
  à exposição, mas não houve comparação byte a byte com a saída antiga, teste
  com a chave ou confirmação de alterações por terceiros. **Não declarar identidade
  criptográfica nem uso funcional comprovados.** Tratar B1 como comprometido por
  precaução e confirmar expressamente o alvo da substituição com o responsável.
- Confirmada a **seleção** de B1 para `VERCEL_AUTOMATION_BYPASS_SECRET`; não se
  confundem seleção/injeção automática, leitura efetiva pela aplicação e envio
  de uma requisição com a credencial. Os dois últimos não foram comprovados.
- Metadados das 11 variáveis explicitamente configuradas, consultados com
  `decrypt=false`, não contêm nome de bypass; não foram descriptografadas.
  A variável de sistema é injetada pela plataforma e sua ausência nessa lista
  não significa ausência de B1 nos builds. Nenhum outro segredo do app é alvo.
- Nenhum Deploy Hook, nenhuma integração adicional retornada pelo inventário
  Vercel aplicável ao projeto. Isso não enumera clientes externos que detenham
  a chave, sessões de navegador ou todos os serviços nativos da plataforma.

#### Consumidores: confirmado, potencial e não comprovado

| Superfície examinada | Resultado e relação específica com B1 |
| --- | --- |
| Variável de sistema Vercel | B1 selecionado com isEnvVar true. Configuração confirmada; uso funcional do valor por deployments existentes não foi exercitado |
| E2E/Playwright | Nenhum Playwright/Puppeteer/Cypress/Selenium ou header de bypass nas superfícies versionadas verificadas. Os runners de fluxos/compatibilidade usam Supabase local e HTTP loopback; não foram executados nesta etapa |
| GitHub Actions | Workflows CI/signal/controlador sem referência ao bypass. API: zero secrets e zero variables de repositório e de ambos os environments Preview/Production; proprietário é User, sem inventário de secrets de organização aplicável |
| Controlador de checkpoint | Usa API GitHub; não acessa URL de Preview e não precisa de bypass Vercel. Mantidas false &&, contents: read e --dry-run |
| Scripts e ambiente local | Nenhuma variável de bypass/Playwright herdada no processo atual. Apenas .env.example na raiz ativa; metadados de 14 worktrees deste repositório sem arquivo .env de credenciais encontrado nas raízes examinadas. Nenhum conteúdo de .env ou store de credenciais lido; outros terminais, perfis, subpastas e máquinas não enumerados |
| Integrações versionadas | App usa @vercel/analytics/next (client). @vercel/analytics/server 2.0.1 instalado contém suporte ao bypass, mas não é importado pelo app nos SHAs examinados; consumidor apenas potencial. Sentry configurado no app, sem referência a bypass encontrada; não confundir seu token com B1 |
| Integrações externas | API Vercel não retornou configurações adicionais aplicáveis; GitHub tem zero webhooks de repositório. Isso não comprova ausência de GitHub Apps, monitores externos, caches, links ou automações manuais. Confirmação do responsável solicitada, ainda não recebida |

Revisão focal: 387 arquivos versionados em scripts, .github, src, package.json,
.env.example e vercel.json, buscando os nomes/headers exatos e frameworks E2E;
sem ocorrências nessas superfícies. Mesmo recorte consultado no SHA da main
servida, sem referência encontrada. A dependência instalada Analytics foi
inspecionada separadamente para distinguir módulo server potencial de client usado.
O grafo disponível é de outro checkout/branch, geração 14/10/2026, com scripts
excluídos e cobertura insuficiente; as conclusões se apoiam na fonte atual, sem
reindexar nem presumir cobertura completa do grafo.

**Conclusão específica:** nenhum consumidor funcional da credencial exposta foi
confirmado. O único vínculo configurado confirmado é B1 como variável de sistema.
Não há prova de que ninguém a use. Não foram lidos valores de secrets externos,
logs antigos portadores da exposição, cookies de navegador ou memória de outros
processos; não há trilha de uso por credencial nas respostas consultadas.

#### Baseline e impacto

- HEAD local/remoto `8071a99f2050cb4de8e238b2531b1a0e078e1086`, #111 aberto Draft;
  CI [42508993311](https://github.com/therunnas/bslogistica/actions/runs/42508993311)
  validar/sql-local SUCCESS, signal SKIPPED, conferidos no SHA exato.
- Vercel continua servindo Production `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4` de
  main `38b4349`, e Preview `dpl_9kmT1ZM9Qmh8fvotKRf3YSc1Ldpm` de 8071a99.
  Production Branch main, Standard Protection all_except_custom_domains.
- **HEAD sem credenciais**, sem redirects/cookie jar: `admin.bslogisticas.com.br/login`
  respondeu **200**; o Preview imutável
  `bs-logistica-sistema-5p4soi6bg-bslogisticas.vercel.app/login` respondeu **302**
  com destino hostname `vercel.com`. Não foram registrados query, Location integral,
  Set-Cookie ou corpo. Não é homologação funcional nem teste de token.
- [Documentação oficial](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation):
  múltiplas chaves podem coexistir e valem nos deployments do projeto até revogação.
  Bypass é controle de acesso da plataforma, **não** substitui login Supabase, MFA
  ou RLS do app. Alterar/revogar a chave é configuração compartilhada do projeto,
  incluindo URLs protegidas de deployments Production; não é operação restrita ao PR.
- **Deployment não é requisito para um cliente externo enviar B2 ao Preview já
  existente.** Porém a variável de sistema é fixada no build: selecionar outra
  chave não reescreve o valor dos deployments antigos. Se algum consumidor depender
  desse valor embutido, a documentação exige redeployment para atualizá-lo.
  Isso não prova que o app inteiro saia do ar após revogar B1; o risco é o caminho
  que ainda enviar o segredo antigo. Não prometer ausência absoluta de impacto.
- Nenhum consumidor da env foi encontrado no código do app/main examinados.
  Não há justificativa comprovada para redeploy de Production nesta etapa.
  Se surgir dependência em Production, parar: deploy e atualização da aplicação
  exigem autorização própria. Não alterar domínio, proteção, Supabase ou Auth
  para compensar eventual falha de bypass.

#### Opções e procedimento recomendado, ainda não executado

Revogar B1 imediatamente reduz a janela de exposição, mas pode interromper
consumidor desconhecido. Criar B2 e adiar indefinidamente a revogação mantém a
exposição. **Recomendação:** sobreposição curta, com responsáveis, janela de
execução e critérios de passagem definidos, seguida de revogação comprovada.
Não deixar o token comprometido como mecanismo de recuperação permanente.

1. **Preflight autorizado:** reconfirmar projeto, B1 e responsáveis por usos fora
   do checkout. Aprovar explicitamente B1 como alvo, mesmo sem recuperar o valor
   antigo da conversa. Revalidar metadados imediatamente antes de escrever; se a
   quantidade/seleção/data mudar, parar e reconciliar. Confirmar quais consumidores
   serão alterados nominalmente; conjunto atual de consumidores funcionais é vazio,
   portanto não criar secrets GitHub nem alterar Sentry/Supabase sem necessidade.
2. **Adicionar B2 sem revogar B1**, via administrador Vercel autorizado, em canal
   seguro. Confirmar a coexistência e os metadados/seleção antes de prosseguir.
   Não usar regeneração destrutiva de um único passo. Não expor B2 no chat,
   argumentos, URLs, traces, histórico do shell ou arquivos versionados.
3. **Migrar somente consumidores nomeados e autorizados**, usando armazenamento
   seguro e header x-vercel-protection-bypass apenas para a origem Preview exata.
   Nunca NEXT_PUBLIC, query de URL, comando com valor literal ou logs/traces de
   headers. Nenhum consumidor novo foi aprovado nesta etapa.
4. **Validar B2 no Preview existente**, com contexto limpo sem SSO/cookies e sem
   seguir redirect para outra origem. Primeiro manter prova de bloqueio anônimo;
   com B2 alcançar a página pública de login do app, sem autenticar em Supabase ou
   escrever no HML. Comprovar funcionamento real de cada consumidor autorizado,
   registrar apenas status/host/resultado e descartar corpos/headers sensíveis.
5. **Seleção da env:** escolher B2 para builds futuras, conferindo seleção única.
   Isso não atualiza builds existentes. Se algum consumidor ainda depender de B1
   embutido, não revogar até haver solução autorizada; eventual novo Preview tem
   gate próprio, e Production não pode ser redeployado por inferência.
6. **Revogar somente B1**, após confirmação de identidade/alvo, B2 e consumidores
   validados e nenhuma dependência pendente de build antigo. Restringir a janela
   de coexistência; não desativar proteção nem criar exceção pública para contornar
   falhas. Se faltar evidência, não declarar a rotação concluída e devolver o gate
   ao responsável com a exposição ainda explicitamente pendente.
7. **Prova pós-revogação:** metadados sem B1; mesmo Preview imutável, novos contextos
   sem cookies/SSO: anônimo barrado, B1 barrado pela Vercel e B2 alcançando login.
   Não basta testar no domínio Production público, onde 200 não prova validade
   de nenhum token. Se propagação divergir, aguardar somente o prazo administrativo
   acordado e reinspecionar; nunca registrar PASS por antecipação. Testar o token
   antigo em contexto limpo não comprova invalidação de toda sessão/cookie anterior.
8. **Continuidade:** repetir HEAD sem segredo do domínio público e verificar os
   consumidores nominalmente aprovados; nenhuma alteração em app, domínio, banco,
   migrations, main ou controlador. Registrar somente evidências sanitizadas no
   HANDOFF; eventual commit/push continuará dependendo de autorização própria.

#### Recuperação e autorização necessária

**Antes de revogar:** se B2 ou consumidor falhar, interromper o corte, manter a
proteção ligada e corrigir a distribuição da chave nova na janela aprovada;
comunicar a exposição pendente. Não mascarar falha com exceção pública.
**Depois de revogar:** manter B2 válido, corrigir o consumidor para usar B2 e
retestar. Não restaurar/recriar B1 comprometido. Chave adicional de contingência,
reimplantação de Preview ou qualquer intervenção Production exigem nova autorização
se não constarem expressamente do gate. Login administrativo Vercel normal pode
servir para diagnóstico humano, não substitui prova de automação B2 em contexto limpo.
Não há rollback de código/banco nesta troca; preservar histórico, domains/aliases,
conexão Git e configuração de acesso existente.

**Gate SEC-BYPASS-02 proposto, não concedido:** administrador com papel Vercel
adequado (member de time ou Project Administrator) e autorização nominal para,
somente em `prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV`, adicionar B2, mantê-lo fora do Git/chat,
atualizar apenas consumidores previamente nomeados, selecionar B2 para builds
futuras, executar GET/HEAD com bypass somente no Preview imutável autorizado
e HEAD sem credenciais no login público para comparação de continuidade,
revogar B1 após as provas e verificar a rejeição da antiga/aceitação da nova.
A autorização precisa reconhecer o escopo compartilhado da proteção do projeto,
inclusive URLs protegidas de Production; não autoriza deployment, promoção,
alteração do app/domínios Production, HML, Auth, main, banco, automação ou publicação
Git. Se exigir novo deployment para consumidor embutido, o plano para esse
consumidor precisa de gate separado **antes** da revogação.

**Validação documental SEC-BYPASS-01:** `npm run check:workflow` PASS,
`npm run test:workflow` 8/8 PASS, `git diff --check` PASS e revisão focal sem
valores secretos nos três documentos locais. Não foram executados
criação/revogação, teste com segredo, consumidor externo, deploy, build, SQL,
homologação ou novo job CI. Sem segredos, fingerprints ou respostas brutas em
arquivos. Pergunta sobre alterações/usos externos ainda sem resposta; isso não
constitui autorização nem confirmação de ausência.

### CHECKPOINT-AUTO-04B — sincronização documental em 08/11/2026

Ponto de partida local/remoto `80ebfbb0f1be3615832f6f456a3240b7715919a7`, PR #111
aberto Draft na branch `integracao/release-preview-01`, worktree com exatamente os
quatro documentos autorizados e index inicialmente vazio. Main remota conferida
em `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`; sem atualização a incorporar.
Revisão dos quatro documentos e padrões de credenciais/URLs secretas sem achados;
nenhum valor de bypass ou resposta bruta da API incluído. Ocorrência AUTO-04
preservada abaixo, com necessidade de rotação controlada e autorização própria.
Controlador conferido com as três travas; nenhum workflow alterado.
Validações locais desta sincronização: `npm run check:workflow` PASS,
`npm run test:workflow` 8/8 PASS e `git diff --check` PASS.

**Publicação comprovada:** push normal 80ebfbb →
`85128d1378a5fb6f92665d70147b9107f84ef5be`, somente os quatro documentos, arquivos
remotos conferidos. [CI 42508320309](https://github.com/therunnas/bslogistica/actions/runs/42508320309):
`validar` e `sql-local` SUCCESS no SHA exato; sinal SKIPPED. CodeRabbit pulou a
revisão por Draft, não é revisão efetiva. Deployment GitHub `7639731414`,
ambiente Preview, `production_environment: false`, success em
`2026-11-08T18:07:11Z`, fonte exatamente 85128d1;
[URL do Preview](https://bs-logistica-sistema-6j5f86wt5-bslogisticas.vercel.app),
Vercel `dpl_2188BMDC6gGSKcuJkssME5ZvpXg2`. Sem teste funcional, rotação ou
ativação; sem deploy manual, configuração Vercel ou alteração de HML/Production.

**Registro final:** commit posterior exclusivo deste HANDOFF, sem novos fatos de
provedor ou código. Seus checks e Preview têm SHA próprio e devem ser consultados
no PR; não são declarados aprovados antecipadamente neste arquivo. A conferência
final é entregue ao usuário, sem ciclo recursivo de commits documentais.
**Próxima ação:** autorização específica para rotação controlada; ensaio isolado e
instalação/ativação do controlador continuam em gates separados.

### CHECKPOINT-AUTO-04 — inspeção autenticada em 08/11/2026, origem local; publicação documental autorizada na AUTO-04B

**Acessos e método.** GitHub CLI 2.93.0 autenticado pelo keyring; Vercel CLI
65.11.0 já existente no cache npm, executada diretamente por Node 24.15.0
(sem instalar pacote e sem `vercel` no PATH), `whoami` e `api -X GET` funcionais.
Supabase CLI 2.117.0 autenticada em `env -u SUPABASE_ACCESS_TOKEN supabase projects
list --output json`; somente metadados dos dois projetos conhecidos,
`ACTIVE_HEALTHY`, sem acesso ao banco. A primeira falha de `gh auth status` no
sandbox não representava ausência de sessão; acesso confirmado fora dele.
MCP GitHub e Context7 disponíveis/funcionais, codebase-memory disponível;
nenhum MCP Vercel ou Supabase exposto nesta sessão. Não houve login, criação de
token, leitura de `.env` nem exibição deliberada de credenciais de sessão.

**GitHub e Preview do HEAD exato.** #111 aberto Draft, branch
`integracao/release-preview-01`, HEAD local/remoto
`80ebfbb0f1be3615832f6f456a3240b7715919a7`; worktree inicialmente limpo.
[CI 42494404663](https://github.com/therunnas/bslogistica/actions/runs/42494404663):
`validar` e `sql-local` SUCCESS; sinal SKIPPED. Vercel confirma Preview por Git,
`dpl_Bm69ehiR5CTDr5XXMm41zdgNuw5Q`, READY/STAGED, target API null (Preview),
fonte exatamente 80ebfbb, [URL imutável](https://bs-logistica-sistema-m21o2od4p-bslogisticas.vercel.app),
alias da branch `bs-logistica-sistema-git-integracao-release-b94e86-bslogisticas.vercel.app`.
Nenhum teste funcional autenticado ou destino Supabase do bundle foi repetido;
deployment READY não é homologação.

**Configuração Vercel comprovada por GET.** Projeto `bs-logistica-sistema`,
`prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV`, escopo `bslogisticas`:

| Leitura | Evidência sem segredos |
| --- | --- |
| Conexão Git | GitHub, organização therunnas, repo bslogistica, repoId 1356283351; link existente, `gitProviderOptions.createDeployments: enabled` |
| Production Branch efetiva | `link.productionBranch: main`, coerente com gitSource e target Production servido |
| Deploy Hooks | `link.deployHooks: []`, zero hooks cadastrados; nenhum hook chamado |
| Ambientes por branch | GET custom-environments retornou lista vazia; nenhum remapeamento por ambiente personalizado exposto |
| Configuração versionada | No SHA servido 38b4349 e HEAD 80ebfbb: somente vercel.json com schema/framework nextjs, sem git.deploymentEnabled, ignoreCommand ou github.enabled; sem vercel.ts/vercel.toml nessas raízes |
| Build e overrides | Projeto sem build/install/dev/output override; campo Ignored Build Step não exposto no objeto atual; snapshots efetivos dos dois deployments têm commandForIgnoringBuildStep, build/install/dev/output/rootDirectory null, Next.js e Node 24.x |
| Outras regras observadas | gitForkProtection true, enableAffectedProjectsDeployments true, productionDeploymentsFastLane true; não constituem bloqueio seletivo de Production |
| Autoatribuição | `autoAssignCustomDomains: true`; não foi desligada |
| Proteção de acesso | Projeto com Vercel Authentication `all_except_custom_domains` (Standard Protection); bypass configurado, sem registrar valor; Password Protection não configurada no retorno |

**Production servido.** `targets.production`, detalhe e aliases concordam:
`dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`, READY/PROMOTED, target production, source git,
fonte `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, URL imutável
`https://bs-logistica-sistema-kqb06lfcf-bslogisticas.vercel.app`.
Os quatro aliases atribuídos são `admin.bslogisticas.com.br`,
`bs-logistica-sistema-gold.vercel.app`, `bs-logistica-sistema-bslogisticas.vercel.app`
e `bs-logistica-sistema-git-main-bslogisticas.vercel.app`.
GET domains retornou dois domínios verificados, sem redirect/branch/customEnvironment:
`admin.bslogisticas.com.br` e `bs-logistica-sistema-gold.vercel.app`; sem próxima
página. A consulta dos cinco deployments Production mais recentes também aponta
o mesmo deployment como o mais recente, sem constituir auditoria de todo histórico.

**Conclusão e limites.** Confirmada `main` como alvo do bloqueio proposto no
[plano publicado](continuidade/CHECKPOINT_AUTOMATICO.md#plano-de-instalação-sem-publicar-production).
[Documentação Vercel](https://vercel.com/docs/project-configuration/git-configuration)
permite `git.deploymentEnabled: {"main": false}` mantendo branches omitidas
habilitadas; regra true concorrente habilitaria o deployment. Nada aplicado.
Standard Protection preserva acesso público aos domínios Production e protege as
demais URLs conforme atribuição de domínio; é controle de acesso, não trava de
criação/promoção ([referência](https://vercel.com/docs/deployment-protection)).
Não extrapolar campos ausentes dos detalhes de deployment sobre a política atual
do projeto. Não foram exercitados bloqueio, bootstrap, rotas protegidas, bypass,
promoção, CLI/API de escrita ou permissões administrativas. Zero hooks cadastrados
não prova ausência de clientes externos com acesso CLI/API.

**Incidente de saída técnica.** Um filtro exibiu acidentalmente um identificador
sensível de bypass (valor utilizável como segredo); não reproduzido neste checkpoint,
não salvo em artefato bruto,
não usado e não revogado na inspeção somente leitura. Comunicado ao usuário.
**Necessária rotação controlada da credencial exposta**, com avaliação de
consumidores, substituição/revogação e validação de continuidade pelo administrador,
somente após autorização específica. Nenhuma rotação executada nesta sincronização.
Não declarar ausência de exposição na sessão.

**Próximo gate.** Solicitar autorização para ensaio em repositório/projeto
Vercel descartáveis e isolados, sem domínios/credenciais/banco reais. Provar que o
primeiro commit introduzindo main:false não cria Production e que push de Preview
continua criando Preview; repetir com as configurações relevantes, testar rollback
preservando a trava e registrar os IDs/SHAs. Só depois autorizar separadamente a
instalação mínima na branch padrão real, sem release #111, com controlador ainda
travado; dry-run e escrita real permanecem gates posteriores. Nenhuma permissão de
escrita foi testada ou pode ser inferida desta inspeção.

**Validação local documental:** `npm run check:workflow` PASS, `npm run test:workflow`
8/8 PASS e `git diff --check` PASS. Sem testes funcionais,
builds, SQL ou auditorias gerais repetidos; sem alteração de código, workflow,
vercel.json, main, ambientes, PRs, commit ou push.

### CHECKPOINT-AUTO-03B — sincronização documental publicada

- **Commit dos quatro documentos:** `92ee55afa763d2234784486dedb476f87abe820b`, push normal sobre `0b41d80`, exclusivamente na branch `integracao/release-preview-01` do #111 aberto Draft. Nenhuma alteração existente descartada.
- **Escopo publicado:** `PROGRESS.md`, `docs/ESTADO_DO_PROJETO.md`, `docs/HANDOFF.md`, `docs/continuidade/CHECKPOINT_AUTOMATICO.md`. Nenhum código, workflow, migration ou configuração Vercel alterado.
- **Local:** check:workflow, 8/8 testes documentais, formatação do plano e git diff --check PASS; nenhum teste de ativação repetido ou declarado aprovado.
- **CI do SHA 92ee55a:** [run 42493398898](https://github.com/therunnas/bslogistica/actions/runs/42493398898), jobs `validar` e `sql-local` SUCCESS, conferidos pelo SHA exato. A CI da aplicação não é homologação nem ativação.
- **Preview:** deployment GitHub `7637659628`, ambiente Preview, `production_environment: false`, success em `2026-11-08T15:10:17Z`; [URL do Preview](https://bs-logistica-sistema-k2n3nl7hn-bslogisticas.vercel.app), fonte `92ee55a`. Nenhuma tela autenticada ou destino Supabase foi reverificado nesta sincronização.
- **Controles:** signal skipped; controlador permanece com `false &&`, `contents: read`, `--dry-run`. Main conferida em `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`. Sem alteração em HML/Production ou configurações da Vercel.
- **Checkpoint final:** este registro é publicado por commit documental subsequente apenas deste arquivo. CI/Preview desse commit têm SHA próprio e não são declarados antecipadamente como aprovados; conferir no PR.
- **Próxima ação:** disponibilizar acesso Vercel e concluir o preflight somente leitura. Não executar o plano de ativação sem as autorizações específicas.

### CHECKPOINT-AUTO-03 — leitura e plano local em 08/11/2026

- PR #111 aberto Draft, HEAD remoto/local `0b41d80f29d84d23b10938da576c68a7f5c46b2a`; default branch main, HEAD `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`. CI já existente desse HEAD: `validar`/`sql-local` success, sinal skipped; nenhuma suíte funcional repetida.
- Arquivos publicados conferidos: main só contém CI; controlador/sinal estão no #111 e continuam com as travas. `vercel.json` nas duas referências tem apenas schema/framework, sem bloqueio por branch. O validador de main não tem a seção Última tarefa, portanto a combinação mínima precisa de compatibilidade/testes próprios.
- Não foi possível ler configurações atuais do painel Vercel: CLI não encontrada, token ausente no processo, navegador com `The browser access host is unavailable` e plugin Vercel não instalado/conectado. Conexão sugerida; nenhuma credencial lida/exposta, nenhum hook chamado.
- [Plano local revisado](continuidade/CHECKPOINT_AUTOMATICO.md#plano-de-instalação-sem-publicar-production): opções, leituras exatas, conjunto mínimo, autorizações, testes e rollback. Preferência condicionada por bloqueio seletivo Git, sem desconexão, mudança de Production Branch ou proteção de acesso. Bloqueio Git não substitui controle de hooks/CLI/API.
- **Não comprovados:** Production Branch nominal, estado real da conexão Git, regras/overrides, existência de hooks, autoatribuição/proteção de domínios. Nenhum teste de bootstrap/ativação ou configuração em ambiente real foi executado.
- **Validação documental local AUTO-03:** check:workflow, 8/8 testes documentais e git diff --check PASS. Sem repetir auditoria geral ou testes funcionais da aplicação.


### CHECKPOINT-AUTO-02 — publicação comprovada em 08/11/2026

- **Implementação:** `c5c62e99f91d154290247a1100cf98b090b6811d`; push normal exclusivamente na branch do #111, sobre `0308127`. Worktree limpo após o commit; nenhum force push.
- **Local nesta tarefa:** 26/26 testes de automação, 8/8 documentais, lint, TypeScript, check:workflow e comparação do diff `0308127` → `c5c62e9` PASS. A trava de publicação teve RED/GREEN. Revisão independente focal sem bloqueio.
- **CI:** [run 42481151663](https://github.com/therunnas/bslogistica/actions/runs/42481151663), jobs `validar` e `sql-local` **SUCCESS** no SHA exato `c5c62e9`. O job validar inclui lint, tsc, 84 suítes Node, validação de HANDOFF no conjunto publicado e build padrão. CodeRabbit pulou por Draft; não é revisão efetiva.
- **Preview:** deployment GitHub `7635950040`, ambiente **Preview**, `production_environment: false`, **success** em `2026-11-08T12:38:11Z`, fonte `c5c62e9`; [URL imutável do Preview](https://bs-logistica-sistema-c54lp4w7j-bslogisticas.vercel.app). Nenhuma tela autenticada ou destino Supabase foi reverificado; não é homologação funcional.
- **Desativação:** arquivo do controlador conferido no GitHub: `false &&`, `contents: read`, `--dry-run`. CI também só leitura; sinal sem permissões e execução **skipped**. Nenhum recibo do bot criado. Main permaneceu `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`.
- **Escopo:** nenhuma alteração em `src`, `supabase` ou lockfile; varredura limitada aos 19 arquivos sem padrão de credencial. Sem secrets/vars configurados, instalação na main, merge ou operação em HML/Production.
- **Plano futuro:** [instalação sem publicar Production](continuidade/CHECKPOINT_AUTOMATICO.md#plano-de-instalação-sem-publicar-production); contenção administrativa, bloqueio durável de deploy por branch, instalação mínima, reconexão comprovada e ensaio/ativação em gates separados. Nada disso foi executado nesta tarefa.
- **Limite do checkpoint:** este registro comprova CI/Preview de `c5c62e9`. O commit posterior que grava somente este HANDOFF tem SHA/checks próprios, consultáveis no PR; não são declarados antecipadamente como aprovados aqui.

### CHECKPOINT-AUTO-01 — histórico local anterior

- **CHECKPOINT-AUTO-01, working tree local (08/11/2026):** 25 testes de automação e 8 de workflow documental PASS; matriz cobre falha, repetição, eventos em qualquer ordem, documentação, origem, URL, CAS e resposta perdida. Duas falhas da revisão reproduzidas antes da correção e revisão focal final sem achados.
- **Regressão Node:** 84 suítes `test:*`; 83 PASS no sandbox e `test:calendario-runners` PASS 23/23 fora dele após bloqueio do servidor de teste em loopback. SQL não repetido: sem mudança de banco, harness ou migration.
- **Ferramentas locais:** lint, `tsc --noEmit`, `check:workflow` e comparação documental real `2a7270f` → `0308127` PASS. Build Webpack PASS com domínio `.invalid` e chave pública inerte. `npm run build` (Turbopack) falhou por bind `Operation not permitted`, inclusive fora do sandbox; não declarado PASS.
- **Não executado nesta tarefa:** nova CI/Preview, escrita real do bot, outra sessão real de Claude/Codex, homologação, Supabase, HML ou Production. Logs somente locais em `/private/tmp/checkpoint-auto-01-*`.

### Histórico funcional anterior (evidência nos SHAs originais)

- **Local, em `c4b4456` (07/11/2026):** lint, `tsc` e build OK; **83 suítes Node PASS**; **50 suítes SQL PASS**
  numa stack local recriada do zero com as 49 migrations; **34 verificações E2E locais PASS**
  (`scripts/testar-fluxos-local.sh`: sessão real de admin, mesmas RPCs e montadores do app, conferência do que ficou
  gravado). Prettier e `git diff --check` limpos.
- **CI do SHA publicado:** **PASS** no SHA `f03e8c7a7a21f993368de60d92b6224d542df320` (PR #111, run 42432532431): `validar` (lint, `tsc`, todas as suítes Node, build) e `sql-local` (todas as suítes SQL, incluindo 048 e 049) = success; CodeRabbit pulado por ser Draft. Conferido por SHA, não pela última execução visível.
- **Preview:** **READY**, ambiente Vercel **Preview**, fonte `integracao/release-preview-01` @ `f03e8c7`, URL do deployment `https://bs-logistica-sistema-6m9zop80g-bslogisticas.vercel.app` (alias da branch: `bs-logistica-sistema-git-integracao-release-b94e86-bslogisticas.vercel.app`; muda a cada push). Destino Supabase servido: **somente o HML** `qbnfcmrxmssnwkhaitgd` (um único host Supabase no código, nenhum de Production); nenhuma referência ao domínio de Production; custom domains "Skipped"; nenhum deploy Production. Rotas protegidas (inclusive `/containers/<id>/corrigir`) redirecionam ao login com CSP e sem erro de console. Telas autenticadas **não** exercitadas por IA (sem credencial): homologação manual pendente.
- FUNC-READY-01, defeitos comprovados e corrigidos:
  - Contratos: com a resolução ligada não havia recuo (função sem tarifa = P0002) e, desligada, a diária individual
    e a tarifa eram ignoradas; a precedência diária individual > tarifa da função > preço-base não existia. A **048**
    a implementa. A prévia do apontamento mostrava o preço-base com a resolução ligada; `src/lib/preco-do-dia.ts`
    aplica a mesma precedência do banco.
  - Containers: só havia registrar e cancelar. A **049** cria `corrigir_servico_container`: **substituição auditada**
    do registro original (cancela o original, registra o substituto, trilha `corrected` com vínculo e histórico,
    idempotente, só serviço disponível do mesmo cliente, recusa dados idênticos). Nada é alterado no lugar.
  - Colaboradores, operações, apontamentos e faturamento: sem defeito novo; custo da lista = custo do motor; prévia =
    banco; pendente → fatura → unicidade → imutabilidade → conciliação.
- O que **não** foi provado: nada disto foi exercitado no HML, em Production nem por usuário real; a homologação manual
  do Preview segue pendente.

## Migrations por ambiente

- **Repositório:** até a **049** (`20261116120000`). **048 e 049 são novas e foram aplicadas somente na stack local
  isolada**; nenhuma migration foi aplicada em ambiente remoto nesta etapa.
- **HML** `qbnfcmrxmssnwkhaitgd`: head **045** (última confirmação conhecida, leitura de 07/11/2026); 046, 047, 048 e 049
  **não** aplicadas.
- **Production** `ehkduqokntemtmqzdrbd`: **034** (última confirmação); fora do escopo. [Inventário histórico](AMBIENTES.md).
- Ordem segura: publicar o app, depois aplicar 046 → 049, cada uma com autorização para o ambiente-alvo.

## Decisões comerciais pendentes

1. **048, preço-base como fallback — PENDENTE DE APROVAÇÃO DEFINITIVA.** Quando não há diária individual nem tarifa da
   função, o contrato cobra o preço-base em vez de bloquear o dia. A regra aprovada antes recusava (nunca cobrar sem
   tarifa). A implementação é **candidata** em PR Draft; não ativar fora do local sem aprovação. Mitigação:
   `alterar_resolucao_tarifas` devolve `contratos_sem_tarifa`.
2. **049, correção por substituição.** O id do serviço muda (a trilha liga original e substituto). Confirmar que atende.
3. **Localidade do calendário por contrato:** hoje só por operação; por contrato exigiria migration e decisão.

## Homologação manual pendente

Nada do Preview foi homologado por pessoa. Roteiro: [homologação RELEASE-PREVIEW-01](homologacao-release-preview-01.md).
Prioridade: 5.3–5.4 (custo), 6.4 (operações), 8.3 (container), 12.6 (faturas emitidas), 4 (contratos). Os itens 4.6 e
8.4 só são homologáveis depois da 048 e da 049 no HML; 9.4 e 12.5, depois da 047 e da 046.

## Prontidão operacional e backups

Resumo (o inventário oficial fica no Mac do responsável técnico e não é copiado para o GitHub): há backup
criptografado do HML, restauração e ensaio de expurgo e de recuperação pós-COMMIT validados só em stack local, e a
limpeza dos backups dispensáveis foi concluída, com um pacote mantido por bloqueio. **Pendente:** cópia independente
fora do Mac. Não há senha, chave nem conteúdo de dump neste repositório.

## Autorizações

CHECKPOINT-AUTO-07 (vigente): leituras necessárias, commits/pushes exclusivamente sintéticos no sandbox existente, deployments Git automáticos nele, modelos locais e preparação do plano; commit/push normal somente documental no #111. Sem autorização para alterar a BS real. TRANS-MAIN com baseline sem regra/Production sintético esperado não executado nem autorizado por inferência.

Histórico AUTO-06: criação nominal e ensaio de bootstrap interrompido em FAIL; recursos preservados. AUTO-07 não altera sua classificação.

Histórico SEC-BYPASS-02 / AUTO-05: rotação e preparação concluídas e publicadas, sem autorização reutilizada de credenciais nesta etapa.

Histórico SEC-BYPASS-01: somente diagnóstico e planejamento local, sem rotação ou publicação naquela etapa.

Histórico CHECKPOINT-AUTO-04B: publicação documental no #111 e conferência de CI/Preview, concluídas anteriormente; autorização não reutilizada nesta etapa.

Histórico CHECKPOINT-AUTO-04: somente leitura e diagnóstico autenticado, com documentação local; nenhuma publicação naquela etapa.

Histórico CHECKPOINT-AUTO-03B: commit/push dos quatro documentos e registro final exclusivo do HANDOFF, executados na etapa anterior; autorização não reutilizada.

Histórico CHECKPOINT-AUTO-03: inspeção somente leitura e plano/checkpoint locais; sem publicação naquela sessão.

Histórico CHECKPOINT-AUTO-02: revisão, commit/push fast-forward exclusivamente na branch do #111 e leitura de CI/Preview; autorização não reutilizada nesta etapa.

Histórico CHECKPOINT-AUTO-01: implementação/testes locais e fast-forward, sem publicação naquela etapa.

Histórico CHECKUP-SYNC-01 / FUNC-READY-02 (não reutilizar como autorização atual): commit da FUNC-READY-01, atualização dos documentos de continuidade, push
exclusivamente para `integracao/release-preview-01`, verificação de CI e Preview e verificações não destrutivas do
deployment.

## Proibições

CHECKPOINT-AUTO-07: sem main BS, merge #111/#112, Production BS, Vercel BS, migrations, HML/Supabase, criação de recursos/bancos, remoção/recriação de chaves, domínios reais, exclusão do sandbox, force push, escrita do bot ou implementação funcional. Sem deploy manual ou Production sintético intencional nos negativos; publicação somente documental no #111.
Sem merge em `main`, deploy em Production, migration em HML ou Production (046–049 inclusive), limpeza ou escrita
de dados no HML, novo Supabase, novo PR, alteração dos PRs de origem, backups redundantes e force push.

## Bloqueios e riscos

- B1 revogada e rejeitada; B2 única e selecionada. Valor antigo embutido em builds e usos externos desconhecidos continuam riscos residuais; não restaurar a credencial comprometida.
- AUTO-06 continua FAIL histórico. AUTO-07 passou para projeto inicializado, com zero novos Production; Gate 1 permanece bloqueado por falta da prova do primeiro commit ausente→main:false. Nenhuma instalação real autorizada.
- Sandbox não emite deployment_status/repository_dispatch como a BS; dry-run hospedado/primeiro recibo continuam não comprovados. Conteúdo protegido de Preview não foi autenticado.
- #112 tem três conflitos documentais com #111; não substituir o checkpoint atual nem inferir implementação/homologação a partir dos novos documentos de negócio.

- Decisão comercial da 048 pendente (acima); sem ela, a 048 não vai a ambiente compartilhado.
- Idempotência de adicionais só vale com a 047 no HML; até lá, reenvio após resposta perdida bloqueia e exige conferência.
- Expurgo do HML, 046–049 no HML e cópia independente dos backups seguem com gates próprios.
- Regra permanente: ao concluir ou pausar, toda tarefa atualiza este checkpoint com o que foi executado, o que
  funcionou, o que não funcionou, evidências e ambientes, pendências, próxima ação e o que não está autorizado.

## Retomada

1. Descobrir o checkout/worktree e a branch reais; conferir status, HEAD local e HEAD remoto pelo PR autorizado.
2. Ler a identificação e “Última tarefa”; preservar alterações locais e não reutilizar autorização histórica.
3. Ler AUTO-07 PASS limitado e Gate 1 BLOQUEADO; preservar AUTO-06 FAIL e não repetir rotação. Obter autorização específica do ensaio TRANS-MAIN antes de novo experimento; instalação real e escrita do bot continuam sem autorização. Conferir SHA/checks deste checkpoint documental.
4. Ativação permanece bloqueada independentemente de variáveis; seguir os gates futuros de [Checkpoint automático](continuidade/CHECKPOINT_AUTOMATICO.md), sem alterar main ou Production por inferência.
5. Não repetir a triagem de PRs abaixo sem nova divergência; nenhuma recomendação equivale a autorização de fechamento.


## Retomada Codex — verificação dos sete PRs (08/11/2026)

**Registro histórico anterior à CHECKPOINT-AUTO-01. Natureza:** resultado de uma sessão de análise, sem alterações de código nem de ambiente. Este registro foi consolidado a partir do relatório do Codex e reconciliação do GitHub. Nenhum fechamento de PR foi autorizado ou executado.

### Evidências mais recentes até este checkpoint documental

- PR principal [#111](https://github.com/therunnas/bslogistica/pull/111): **Draft aberto**, HEAD de referência `2a7270f694fc8a10131774ae326f4fbcd6c5a47f`; base `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, sem merge.
- [GitHub Actions 42432763543](https://github.com/therunnas/bslogistica/actions/runs/42432763543): `validar` e `sql-local` aprovados para `2a7270f`; CodeRabbit sem revisão, por PR em Draft. A análise do Codex não repetiu os testes locais (83 suítes Node, 50 SQL, 34 verificações E2E documentadas previamente).
- Último Preview mencionado pelo Codex para `2a7270f`: [bs-logistica-sistema-9fgp38zta-bslogisticas.vercel.app](https://bs-logistica-sistema-9fgp38zta-bslogisticas.vercel.app), deployment `7629519178`, concluído. **Telas autenticadas e destino Supabase não foram reverificados nessa sessão**; o destino HML havia sido comprovado na verificação anterior.
- HML head **045** e Production head **034** são **últimas confirmações históricas**, não leituras feitas pelo Codex em 08/11. Migrations 046–049 continuam **não aplicadas remotamente**, conforme último checkpoint; não inferir mudança de banco a partir de código publicado.
- Atualização exclusivamente documental realizada no GitHub após a análise produz novo SHA de branch. **Não transferir a CI nem o deployment do `2a7270f` ao commit documental sem conferi-los novamente.**

### Classificação dos PRs revisados pelo Codex

| PR | Conclusão da comparação com #111 | Próxima decisão |
| --- | --- | --- |
| [#111](https://github.com/therunnas/bslogistica/pull/111) | Candidato consolidado à homologação, com evolução própria | **Manter aberto em Draft**, sem merge |
| [#106](https://github.com/therunnas/bslogistica/pull/106) | Totalmente incorporado ao #111 | Candidato a encerrar como substituído **após autorização**; preservar branch, pois é base do #107 |
| [#108](https://github.com/therunnas/bslogistica/pull/108) | Totalmente incorporado ao #111 | Candidato a encerrar como substituído após autorização |
| [#109](https://github.com/therunnas/bslogistica/pull/109) | Totalmente incorporado ao #111 | Candidato a encerrar como substituído após autorização |
| [#110](https://github.com/therunnas/bslogistica/pull/110) | Totalmente incorporado ao #111 | Candidato a encerrar como substituído após autorização |
| [#107](https://github.com/therunnas/bslogistica/pull/107) | Runbook de expurgo HML com escopo próprio, fora do #111 | **Manter separado**, não executar expurgo |
| [#63](https://github.com/therunnas/bslogistica/pull/63) | Parcialmente incorporado e com conflitos; `src/lib/apontamentos/rascunho.ts` e `scripts/testar-apontamentos.mjs` não estão no #111, segundo Codex | **Manter suspenso** até avaliar preservar/adaptar/descartar conteúdo exclusivo |

### Próximas ações e limites

1. **Prioridade de continuidade solicitada pelo proprietário:** implementar mecanismo confiável para que cada etapa concluída atualize o `docs/HANDOFF.md` e para que o status técnico de cada deployment Preview seja registrado no GitHub, sem loops de commit/deploy. **Essa automação ainda não foi implementada**; a sessão atual é sincronização pontual de documentação.
2. Não confundir atualização funcional do HANDOFF pelo executor com atualização automática de evidências de deploy: CI/Preview não conseguem inferir sozinhos decisões comerciais, resultados de homologação ou testes não realizados.
3. Após preparar a automação, retomar homologação manual do Preview (seções 4, 5, 6, 8, 12 do roteiro), a decisão comercial da migration 048 e a confirmação do mecanismo da 049. Sem autorização, **não** aplicar 046–049 no HML nem realizar merge/Production.
4. Não encerrar os PRs #106/#108/#109/#110 nesta atualização; a recomendação não é autorização de fechamento.
5. Na próxima sessão, descobrir worktree e branch reais e verificar GitHub antes de operar; `/private/tmp/bs-fin-20d` é somente o caminho da última sessão, não exigência permanente.

