# Continuidade por tarefa e evidência automática de Preview

SDLC: Desenvolvimento / Testes. A entrada de estado atual é sempre
[HANDOFF](../HANDOFF.md). Este documento define o mecanismo; não duplica o estado
da tarefa nem concede autorização para publicar ou ativar automação.

## Após cada tarefa

Claude Code, Codex e outros executores seguem o mesmo contrato em `AGENTS.md` e
`CLAUDE.md`. Ao concluir ou interromper uma tarefa, preencher “Última tarefa” no
HANDOFF: tarefa executada; resultados e testes comprovados; código/PR afetados;
ambientes envolvidos; pendências/decisões; próxima ação exata; autorizações e
proibições. Atualizar também os campos de identificação e preservar os históricos.

Com autorização de commit/push, incluir o HANDOFF no mesmo conjunto publicado da
tarefa. Sem ela, manter a alteração local e informar o SHA remoto que ainda não a
contém. `npm run check:workflow` valida a estrutura e os links; a CI também exige
HANDOFF no diff entre o SHA anterior do evento e o novo HEAD. Na abertura do PR,
compara a base com o HEAD. Um texto plausível não comprova um teste: relatar testes
não executados, limitações e estados históricos como tais.

Não há hook privado específico de Claude/Codex nem tentativa de inferir decisões a
partir de uma conversa. As instruções versionadas e o gate comum são portáveis;
o agente ainda precisa escrever o resultado verdadeiro da tarefa.

## Eventos e evidências disponíveis

Em leitura de 08/11/2026, a integração existente criou deployments GitHub com
`environment: Preview`, `production_environment: false`, SHA e autoria
`vercel[bot]`. O deployment `7635428392` correspondeu ao commit documental
`0308127aa22a15d6d0551c8cf2bac8a711a050fa`. É evidência histórica da integração,
não parâmetro fixo da automação. O GitHub fornece um identificador próprio de
deployment; não presumir que seja o identificador interno `dpl_*` da Vercel.

A [Vercel documenta](https://vercel.com/docs/git/vercel-for-github) tanto
`deployment_status` quanto `repository_dispatch` (`vercel.deployment.success`).
Este mecanismo captura **deployment_status**, observado no repositório, com o
workflow **Preview signal**, sem escrita, sem buscar código e sem interpretar o
evento como comando. O escritor recebe exclusivamente `workflow_run` de **CI** ou
**Preview signal**, usando a definição/controlador da branch padrão. O evento
`deployment_status` pode usar o ref implantado e não é tratado como contexto
confiável para executar o escritor. Não há webhook externo, token Vercel ou novo
segredo. Os dois sinais cobrem qualquer ordem de conclusão entre Preview e CI e
reconsultam evidências na API; o corpo do evento não é prova.
Eventos ausentes não são inventados e nenhuma homologação é deduzida.

## Reconciliação e arquivos atualizados

O workflow [checkpoint-preview.yml](../../.github/workflows/checkpoint-preview.yml)
aceita somente `workflow_run` e executa o controlador do SHA do próprio workflow
da branch padrão, sem checkout do PR,
instalação de pacotes ou execução de artefatos do candidato. O motor exige:

1. Repositório correto, deployment da Vercel, ambiente Preview e último status
   `success`, com data e URL HTTPS canônica `<projeto>-<hash>-<time>.vercel.app`,
   projeto e time completos configurados, sem
   credenciais, query ou fragmento. URLs de branch, domínios personalizados ou
   formatos diferentes são recusados; a URL não comprova um ID interno de projeto.
2. Commit completo e diff paginado. Commits exclusivamente `.md` de documentação
   e recibos automáticos não produzem nova escrita. Renomear código para docs não
   o transforma em commit documental; arquivos .sql não são documentais. O
   classificador usa caminhos, não interpreta comandos/SQL dentro de Markdown;
   runbooks exigem revisão humana e não concedem autorização de execução.
3. Um único PR aberto, do mesmo repositório, cujo HEAD ainda é o SHA implantado,
   em branch explicitamente permitida. Default branch, `main`, `master`,
   `production`, `prod`, `staging` e `hml` são recusadas, inclusive seus prefixos.
4. Última execução de `.github/workflows/ci.yml` via `pull_request`, no **mesmo
   SHA**, concluída com sucesso; jobs `validar` e `sql-local` únicos e aprovados.
   `skipped`, ausência, falha, outro SHA ou evidência incompleta recusam a escrita.
5. HANDOFF válido, bloco técnico único e HEAD/PR ainda inalterados ao publicar.

A escrita atualiza **somente** o bloco entre `checkpoint-preview:start` e
`checkpoint-preview:end` de `docs/HANDOFF.md` e cria
`docs/continuidade/previews/deployment-<id-GitHub>.json`. O recibo registra PR,
branch, SHA, URL, identificador GitHub, status/data, CI e limitações explícitas.
Históricos anteriores e o restante do HANDOFF são preservados. Um recibo existente
não é sobrescrito. Nenhum arquivo de aplicação, migration ou ambiente é alterado.

## Loops, repetição e concorrência

- Não existe trigger `push` neste controlador. Sinais de CI e de deployment do
  mesmo SHA compartilham concorrência com `cancel-in-progress: false`.
- Antes de qualquer escrita, classificar o diff: o commit gerado contém somente
  HANDOFF e recibo e será ignorado caso a Vercel faça outro Preview. Não depender
  de `[skip ci]`, autor do commit ou supressão de eventos pelo `GITHUB_TOKEN`.
- O motor não herda CI/Preview do código para o commit documental produzido.
  O bloco registra sempre o **SHA implantado**, distinto do novo HEAD documental.
- O commit GraphQL usa `createCommitOnBranch` com `expectedHeadOid`: HANDOFF e
  recibo entram juntos, ou a atualização é recusada. Se pessoa ou outro agente
  avançar o HEAD, a automação não sobrescreve, não força e não faz rebase.
- Repetição após sucesso ou resposta perdida consulta novamente HEAD/recibo e não
  duplica o registro. Sem confirmação da API, não declarar escrita aprovada.
- Evento atrasado de HEAD substituído é descartado. O mecanismo registra o
  candidato ainda atual, sem reconstruir retroativamente todos os Previews antigos.
- Falta de evidência ou conflito deixa o checkpoint anterior intacto e encerra a
  execução com falha. O outro evento pode reconciliar quando a evidência chegar;
  após conflito sem novo evento, exige nova execução autorizada. Sem polling infinito.

## Retomada somente pelo GitHub

1. Listar PRs abertos e localizar a tarefa autorizada; não escolher apenas pelo
   número do PR ou pela data mais recente. Se houver ambiguidade, pedir a decisão.
2. Consultar metadados do PR e ler `docs/HANDOFF.md` **na head branch/commit desse
   PR**. O arquivo da branch padrão pode representar uma etapa anterior.
3. Ler “Última tarefa”, identificação, próxima ação e proibições. O bloco técnico
   aponta o último recibo automático; o histórico fica na mesma branch.
4. Conferir remotamente o HEAD e os checks do SHA indicado. CI, Preview,
   homologação, migrations e Production são estados independentes.
5. Ao usar checkout local, descobrir seu worktree/branch; sincronizar apenas por
   fast-forward autorizado e sem alterações locais. Evidência ainda local não
   aparece no GitHub até publicação autorizada.

Exemplo de consultas de leitura: `gh pr list --repo therunnas/bslogistica --state
open`; depois `gh pr view <PR> --repo therunnas/bslogistica --json
headRefName,headRefOid,url` e leitura do HANDOFF nessa referência. Não colocar
tokens em comandos ou arquivos.

## Permissões e ativação posterior

**Publicação CHECKPOINT-AUTO-02:** o controlador está bloqueado por `false &&`,
usa `contents: read` e chama somente `--dry-run`. Mesmo configurar
`CHECKPOINT_AUTO_ENABLED=true` não habilita escrita nesta versão. A CI existente
também tem apenas `contents: read`; o sinal de Preview tem `permissions: {}`.
Nenhum desses workflows possui permissão para publicar commits nesta etapa.

Depois de uma futura ativação revisada, o mecanismo também ficará desligado na
ausência de `CHECKPOINT_AUTO_ENABLED=true`.
Requisitos que precisam de autorização própria, **não executados pela implementação**:

1. Revisar e publicar os arquivos na branch autorizada, com checkpoint.
2. Disponibilizar o controlador e suas dependências na branch padrão por um gate
   futuro autorizado. `workflow_run` só dispara se o workflow existir na branch
   padrão, conforme a [documentação do GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
   O workflow não altera `main`; instalar seu código lá é uma decisão posterior.
   Essa instalação precisa respeitar o acoplamento existente entre merge e Production.
   O [workflow de sinal](../../.github/workflows/checkpoint-preview-signal.yml)
   também precisa existir nos commits candidatos para capturar `deployment_status`.
3. Confirmar que a integração Vercel continua emitindo `deployment_status` e que
   os deployments possuem os campos exigidos; a configuração pode mudar.
4. Configurar variáveis de repositório, sem segredo: `CHECKPOINT_AUTO_ENABLED`
   (`true` apenas ao ativar), `CHECKPOINT_PREVIEW_BRANCHES` (uma branch exata por
   linha), `CHECKPOINT_PREVIEW_PROJECT` (nome completo do projeto, por exemplo
   `bs-logistica-sistema`) e `CHECKPOINT_PREVIEW_TEAM` (slug completo do time, por
   exemplo `bslogisticas`). Nenhuma branch entra por inferência.
5. Em alteração futura explicitamente autorizada, remover a trava `false &&`,
   trocar `--dry-run` por `--write` e conceder somente `contents: write` ao job
   controlador. Autorizar commits documentais exclusivamente nas branches
   permitidas. O job precisará de `contents: write`, `actions: read`, `deployments: read` e
   `pull-requests: read`; não pede permissões de ambientes, secrets ou migrations.
   O `GITHUB_TOKEN` não tem restrição nativa por caminho; os limites são impostos
   pelo controlador confiável e pelas regras do repositório. Não fornecer PAT.
6. Exercitar o primeiro evento real e conferir recibo, repetição e eventual
   deployment documental. Testes locais não comprovam a execução hospedada.

Desativar: retirar `CHECKPOINT_AUTO_ENABLED=true`. Não requer apagar histórico,
reverter banco ou modificar dados em HML/Production. O modo `--dry-run` faz apenas
leituras; `--write` só é aceito dentro do workflow autorizado. O comando não carrega
`.env`. A matriz isolada usa dados sintéticos e não recebe token real.

O registro técnico não acessa o Preview, Supabase ou Auth; portanto não prova
saúde funcional, vínculo de banco, identidade de chave, backup ou homologação.
Nenhuma sessão real de Claude/Codex é simulada: a compatibilidade entre agentes é
o contrato comum versionado, validado pelos mesmos comandos.

## Plano de instalação sem publicar Production

**CHECKPOINT-AUTO-03, SDLC: Design/Arquitetura. Plano condicionado; nada ativado.**

**Atualização AUTO-06:** o ensaio de bootstrap reprovou o critério de zero
Production. O primeiro deployment permitido da branch Preview recebeu target
Production no projeto novo. Não executar a instalação abaixo como plano aprovado;
progressão interrompida, detalhes no [HANDOFF](../HANDOFF.md). O desenho anterior
permanece histórico, sujeito a nova decisão/ensaio, sem alteração na BS real.

**Atualização AUTO-07:** novos eventos no sandbox já inicializado passaram,
sem reclassificar AUTO-06. O Gate 1 real ainda está bloqueado pela prova ausente
do primeiro commit que introduz a trava; ver [plano técnico](#plano-técnico-checkpoint-auto-07).

**Atualização AUTO-08:** TRANS-MAIN PASS no sandbox existente resolve a prova
da introdução da trava. Nenhum gate real executado/autorizado; consultar o
[plano atual](#plano-técnico-checkpoint-auto-08--trans-main), sem reclassificar históricos.

Sincronização documental autorizada em CHECKPOINT-AUTO-03B; sem execução do plano.
Estado e evidências da publicação ficam somente no [HANDOFF](../HANDOFF.md).
O requisito adicional é preservar novos deployments automáticos de Preview.
A proposta de desconectar/reconectar Git descrita na AUTO-02 não atende a esse
requisito e deixa de ser a recomendação. O GitHub mantém o plano anterior no
histórico; esta revisão não autoriza alteração remota nem instalação na main.

### Evidência histórica e inspeção autenticada

Referência histórica da leitura AUTO-03 no GitHub em 08/11/2026 (não é HEAD permanente):

- #111 aberto Draft, branch `integracao/release-preview-01`, HEAD
  `0b41d80f29d84d23b10938da576c68a7f5c46b2a`; main/default branch em
  `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`.
- No HEAD do #111, `validar`/`sql-local` success e sinal skipped. Controlador com
  `false &&`, `contents: read`, `--dry-run`. Main contém somente `ci.yml`.
- `vercel.json` nas duas referências contém apenas schema e `framework: nextjs`;
  não há bloqueio versionado por branch nem `ignoreCommand` nesse arquivo.
- O validador na main exporta `validarHandoff`, mas ainda não exige “Última tarefa”.
  Não pressupor que copiar apenas os YAML seja instalação completa ou equivalente.

**Limite histórico AUTO-03:** a sessão então não encontrou a CLI no PATH,
e o navegador/plugin não estava disponível. **AUTO-04:** localizada CLI já
existente no cache npm e sessão autenticada funcional; leitura real do projeto
concluída, incluindo main como Production Branch, Git conectado, zero hooks e
aliases. Evidências, limites e próxima ação somente no [HANDOFF](../HANDOFF.md),
com publicação documental autorizada na AUTO-04B, sem ativação nem rotação.
A tabela abaixo permanece o roteiro de
revalidação, não uma declaração de acesso ainda bloqueado. Nada ativado; ensaio
real do bloqueio continua pendente de autorização.

| Leitura administrativa necessária           | O que registrar, sem segredos                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Environments → Production → Branch Tracking | Production Branch nominal e autoatribuição de domínios                                                                 |
| Settings → Git                              | Repositório/time/projeto conectados e eventos de deployment                                                            |
| Build/Deployment                            | Ignored Build Step, overrides e regras que afetem deploys                                                              |
| Deploy Hooks                                | Quantidade, branch e responsável/uso; nunca copiar URL ou identificador que funcione como segredo; nunca chamar o hook |
| Domains / Deployment Protection             | Aliases e deployment servido, vínculo por branch, método/escopo de proteção e exceções; nunca coletar bypass secrets   |
| Caminhos alternativos de publicação         | Existência de CLI/API, hooks ou outra integração capaz de criar/promover Production                                    |

Não declarar Production Branch, hooks ausentes, Git conectado ou proteção de
domínio como confirmados sem essa leitura. Vercel Authentication protege acesso;
não é uma trava que impeça criar ou promover deployments.

### Opções comparadas

| Opção                                                             | Preserva Preview automático                          | Impede novo deployment Production                                        | Parecer                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Bloqueio seletivo `git.deploymentEnabled` na branch de Production | Sim, com Git conectado e outras branches habilitadas | Para o caminho Git, condicionado à configuração efetiva e prova anterior | Preferida, após preflight autenticado                                    |
| Desligar autoatribuição de domínio                                | Sim                                                  | Não; ainda permite deployment Production staged                          | Insuficiente para este objetivo                                          |
| Ignored Build Step                                                | Pode preservar                                       | Pode criar tentativa cancelada; pode sofrer override                     | Não usar como garantia de zero deployment                                |
| Desconectar Git ou `deploymentEnabled: false` global              | Não                                                  | Bloqueia o caminho Git globalmente                                       | Incompatível com continuidade de Preview                                 |
| Mudar Production Branch para branch congelada                     | Possível                                             | Depende dos efeitos da mudança e de outros canais                        | Mais configuração/risco; não recomendada sem ensaio e preflight próprios |

Base documental: [configuração Git](https://vercel.com/docs/project-configuration/git-configuration),
[Production/Preview branches](https://vercel.com/docs/git),
[staged deployments](https://vercel.com/docs/deployments/promoting-a-deployment) e
[Ignored Build Step](https://vercel.com/docs/monorepos#ignoring-the-build-step).
Nenhuma opção baseada só em Git impede, por si, chamadas CLI/API ou hooks.

### Desenho recomendado, após confirmação do painel

Manter conexão Git, Production Branch, domínios e ambientes existentes. Bloquear
apenas as branches capazes de produzir Production. Se a Production Branch real
for confirmada como `main`, a configuração proposta, partindo do arquivo atual,
seria a seguinte; **não foi aplicada**:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

A Vercel documenta branches não especificadas como habilitadas. Assim, os pushes
nas branches Preview continuam com deploy automático. Não adicionar `"*": true`:
se várias regras casarem e uma for true, a Vercel permite o deployment. O bloqueio
precisa estar no commit avaliado da branch protegida, não só no #111. Manter esse
bloqueio em todos os commits posteriores de instalação, ensaio, ativação e rollback.

Esse é o desenho de menor alteração para o caminho Git, não uma garantia já
comprovada no projeto. **Antes do primeiro commit em main**, é obrigatório provar
em ambiente descartável autorizado que o commit que introduz o bloqueio já deixa
de criar Production, e que um commit de Preview continua criando Preview. Também
é preciso concluir a leitura de hooks/canais alternativos e delimitar sua contenção.
Se isso exigir mudanças administrativas que não preservem Preview, parar e rever
o desenho; não efetuar um commit em main como experimento.

Desabilitar autoatribuição de domínios poderia ser defesa adicional, mediante
aprovação separada, mas não satisfaz a condição de zero deployment Production.
Não mudar a proteção de acesso dos domínios: isso pode interromper usuários e não
resolve o gatilho de deploy.

### Instalação mínima avaliada

Preparar em etapa futura um conjunto a partir da main revalidada, com manifesto
de arquivos e diff. Não fazer merge/cherry-pick dos commits de integração do #111.
Não copiar `package.json` ou `ci.yml` inteiros da release.

- Runtime: os dois workflows de checkpoint, `scripts/atualizar-checkpoint-preview.mjs`,
  `scripts/checkpoint-preview.mjs`, `scripts/checkpoint-github-api.mjs` e o validador
  `scripts/validar-workflow-documental.mjs` compatível com o contrato da tarefa.
- Verificação: `scripts/testar-checkpoint-preview.mjs` e
  `scripts/testar-workflow-documental.mjs`, com fixtures compatíveis. Aplicar somente
  os acréscimos de comando/steps necessários em `package.json` e `ci.yml`.
- Continuidade: HANDOFF de instalação próprio, válido, preservando evidências e
  apontando a tarefa de homologação do #111; documentação deste mecanismo.
- Contenção: patch seletivo no `vercel.json` da branch Production real, após prova.

Não incluir `src`, migrations, testes/fixtures financeiros, dependências, lockfile
ou mudanças de negócio. A combinação mínima sobre main ainda precisa de validação
local e CI próprias; a CI do #111 não comprova essa combinação nova.

### Roteiro com autorizações separadas

1. **Agora, somente leitura:** disponibilizar acesso Vercel e concluir a tabela de
   preflight. Registrar também o ID/aliases do Production servido e um Preview de
   referência. Nenhuma URL de hook/token entra no registro.
2. **Autorização administrativa de ensaio:** escolher um projeto descartável já
   aprovado ou autorizar explicitamente sua criação, com fonte sintética e sem
   banco/domínio/credenciais reais. Ensaiar bloqueio da branch Production desde o
   primeiro commit e continuidade de Preview; testar regras sobrepostas. Registrar
   contagem/IDs de deployments antes/depois. Nenhum ensaio em Production real.
3. **Autorização de contenção/instalação:** aprovar manifesto, branch Production
   nominal e qualquer contenção necessária de hooks/CLI/API. Só então autorizar o
   fluxo de integração mínima em main com o bloqueio Git validado. Ainda manter
   `false &&`, token de leitura, `--dry-run` e chave de ativação desligada. Não
   incluir a release do #111. Conferir zero novos deployments Production e aliases
   inalterados; confirmar que um push autorizado de Preview continua automático.
4. **Autorização de ensaio hospedado:** permitir remover apenas `false &&`, manter
   `contents: read` e `--dry-run`, configurar as quatro variáveis não secretas com
   allowlist exata e atualizar o teste que fixa a versão bloqueada. Com
   `CHECKPOINT_AUTO_ENABLED=true`, o controlador e o sinal podem executar, mas sem
   publicar. Exigir CI, Preview e decisão dry-run no mesmo SHA; testar ambas as
   ordens de conclusão. Nenhum novo secret é necessário.
5. **Autorização específica do escritor:** após revisar as evidências, permitir
   `--write` e `contents: write` somente no controlador confiável, atualizar seus
   testes e manter o bloqueio Production. Revalidar instalação antes de ativar.
   `GITHUB_TOKEN` não restringe escrita por caminho; as guardas de branch/caminho,
   a definição confiável e os controles administrativos são parte da proteção.
6. **Encerramento:** registrar tarefa, ambiente, SHAs, runs, deployments e decisões
   no HANDOFF; zero novos deployments Production, Preview automático preservado,
   recibo único e sem homologação inferida. Publicação de documentação tem a própria
   autorização; a AUTO-03B autoriza somente sincronizar os quatro documentos, sem
   executar o plano nem instalar/ativar o controlador.

### Matriz de testes reais e critérios

- Bootstrap no ensaio descartável: o primeiro commit com bloqueio e todos os
  seguintes geram **zero** deployments Production, inclusive staged; domínio
  servido no projeto real permanece com o mesmo deployment/aliases.
- Preview positivo: commit autorizado de fixture de teste e HANDOFF em branch
  permitida com PR aberto, sem mudança funcional, gera Preview automaticamente.
  A CI do SHA passa e o controlador produz decisão dry-run; depois da autorização
  de escrita, um único commit documental com HANDOFF/recibo.
- Repetição e loop: reentrega do mesmo evento não duplica; o deployment do commit
  documental é ignorado pelo controlador. Não desligar Preview para mascarar loop.
- Negativos: CI incompleta/falha, origem/URL divergente, branch não permitida,
  evento antigo ou Production não produzem recibo nem alteração de branch.
- Concorrência: avanço legítimo do HEAD não é sobrescrito. Se a corrida não for
  efetivamente observada no ensaio remoto, registrar limite; os testes locais de
  CAS não viram PASS remoto por inferência.
- Isolamento: o controlador não recebe token Vercel, chave Supabase nem bypass;
  não autentica no aplicativo nem chama hooks. Deployment Protection é preservada.
- Em cada passo, falta de evidência significa gate pendente, nunca homologação.

### Rollback da ativação

Autorização de rollback precisa estar nominalmente incluída no gate de ativação.
Desligar `CHECKPOINT_AUTO_ENABLED`, desabilitar o workflow e cancelar execuções em
curso; variáveis alteradas não cancelam jobs já iniciados. Conferir o último HEAD
e recibos, pois um commit pode ter concluído antes do cancelamento. Repor modo
seco/token de leitura/trava versionada por alteração revisada, mantendo o bloqueio
Git de Production e a conexão de Preview. Preservar recibos e histórico; correção
por novo commit, sem reset/force push ou exclusão de evidências.

Se ocorrer deployment Production inesperado, abortar a ativação e acionar o
responsável pelo incidente. Qualquer cancelamento/promoção/rollback de Production
exige autorização específica; não alterar aliases automaticamente como parte do
rollback do bot. Não reconectar/desconectar Git nem remover o bloqueio Git como
“rollback rápido”, pois isso pode interromper Preview ou voltar a disparar Production.


## Preparação local CHECKPOINT-AUTO-05

SDLC: Design/Arquitetura / Testes. Execução e estado corrente somente no
[HANDOFF](../HANDOFF.md). A preparação não instala nada na branch padrão nem
remove as travas de publicação. A rotação de bypass não é requisito do escritor:
o mecanismo usa evidências GitHub, sem acessar Preview ou carregar B2.

### Mecanismo publicado conferido

- Idempotência: recibo por deployment; repetição preserva o histórico existente.
- Loop: commits apenas documentais/recibos não geram nova escrita. O classificador
  examina caminhos e renomeações, não conteúdo semântico de Markdown.
- Evidência: CI, deployment, PR e HEAD precisam coincidir no SHA; origem, URL,
  jobs obrigatórios e estado mais recente são reconsultados, sem sucesso inferido.
- Concorrência: workflow serializa pelo SHA e o commit atômico usa expectedHeadOid;
  alterações concorrentes não são sobrescritas, resposta perdida exige reconciliação.
- Branch: motor recusa branch padrão descoberta, main e nomes protegidos, inclusive
  se incluídos na allowlist. Main também é a Production Branch confirmada nesta
  inspeção. Isso impede escrita do bot, **não** desliga deployment Git na Vercel.
  Se a Production Branch mudar, o preflight/allowlist precisa ser reavaliado.
- Workflows intactos: controlador com false &&, contents: read e --dry-run; sinal
  sem permissão, checkout ou segredos Vercel. Nenhuma configuração remota ativada.

Validação isolada reutilizada: `npm run test:checkpoint-preview`, **26/26 PASS**,
incluindo falha, repetição, ambas as ordens dos eventos, documentação, SHA errado,
CAS, simultaneidade e resposta perdida. Não é prova de execução real workflow_run.

### Matriz local da regra git.deploymentEnabled

Modelo sintético da regra documentada, usando minimatch 3.1.5 já instalado,
sem dependência nova, rede ou alteração de vercel.json real. Avaliação: booleano
é global; objeto seleciona padrões que casam; sem padrão aplicável retorna true;
se algum padrão aplicável for true, habilita. O modelo verifica a interpretação
proposta; não executa código da Vercel e não comprova seu bootstrap/import.

| Configuração sintética | Branch | Deployment habilitado esperado e observado |
| --- | --- | --- |
| main:false | main | não |
| main:false | integracao/release-preview-01 | sim |
| main:false | feat/example | sim |
| main:false | staging | sim |
| propriedade ausente | main | sim |
| false global | integracao/release-preview-01 | não — quebra Preview |
| true global | main | sim |
| main:false e *:true | main | sim — regra concorrente insegura |
| main:false e ma*:true | main | sim — sobreposição insegura |
| internal-*:false | internal-test | não |
| experiment-*:false e *-dev:true | experiment-my-branch-dev | sim |
| main:false e feat/*:true | main | não |

**12/12 cenários passaram localmente.** O vercel.json real foi lido e continua
somente schema/framework, sem git.deploymentEnabled; o modelo também confirmou
que sua ausência não contém main. Nenhum push/commit para main ou ensaio no projeto
real foi executado. Artefato temporário de referência:
`/private/tmp/bs-sec-bypass-02/test-git-deployment-enabled.cjs`; redescobrir checkout
e dependências ao reproduzir. Não tratar esse caminho temporário como requisito.

### Escopo preparado na AUTO-05 — histórico

Inventário em leitura: um projeto no time Vercel consultado, o BS real; nenhum
ambiente descartável identificado. Busca de candidatos entre repositórios próprios
por nomes/descrições também não encontrou recurso aprovado. Não reutilizar o BS,
o site institucional ou outro projeto por conveniência.

Escopo concreto proposto para autorização futura:

1. Um repositório privado `therunnas/bs-checkpoint-sandbox` e um projeto
   `bs-checkpoint-sandbox` no time Vercel existente, com conexão Git entre eles.
   Confirmar disponibilidade de nomes antes de criar; sem domínio customizado,
   Supabase, dados, credenciais ou env do BS real. Fonte estática sintética.
2. Push somente nesse repositório descartável: main sintética e branch Preview.
   Deployments **automáticos de Git/import** apenas no projeto descartável;
   nenhum comando de deploy manual. Não criar PR nem instalar controlador nesse
   primeiro ensaio sem escopo adicional. Registrar eventuais deployments iniciais
   do import separadamente; não declarar que import obedece ao bloqueio sem prova.
3. Provar comportamento do primeiro commit com main:false e dos seguintes,
   contar deployments Production/staged antes/depois, confirmar novo Preview
   automático e exercitar o negativo da regra true concorrente. Qualquer resultado
   divergente reprova o desenho para main real, sem afetar a BS.
4. Registrar SHAs, configuração e IDs/status, sem segredos; preservar recursos para
   revisão. Exclusão posterior do repositório/projeto exige autorização própria.

Na AUTO-05, essas criações, conexão e pushes/deployments ainda não estavam
autorizados. A AUTO-06 autorizou e executou o escopo nominal, com resultado FAIL
registrado abaixo e no HANDOFF. Instalação mínima na main real, dry-run e escrita
continuam sem autorização. Não concluir proteção de Production a partir do modelo
local, da rotação de bypass ou de CI verde.


## Ensaio hospedado CHECKPOINT-AUTO-06 — FAIL

SDLC: Testes / diagnóstico. Recursos autorizados criados e preservados: repo
privado therunnas/bs-checkpoint-sandbox e projeto Vercel bs-checkpoint-sandbox,
no time existente Hobby. IDs, SHAs completos e observações estão somente no
[HANDOFF](../HANDOFF.md). Nenhuma mudança em projeto/branch padrão BS.

### O que a prova mostrou

1. Primeiro commit da fixture já com main:false, confirmado no GitHub antes de
   conectar. Criação/conexão via POST /v11/projects não chamou API de deployment.
   Não é prova do fluxo de importação pelo painel; essa variante não foi executada.
2. Conexão inicial: zero Production e zero Preview na leitura. Push adicional de
   main: também zero na janela observada. Ausência não aprova o protocolo completo.
3. Primeiro push de preview/checkpoint: um deployment Git READY/PROMOTED com
   target production, fonte no SHA da branch Preview, apesar de Production Branch
   main e main:false no vercel.json. Total na parada: **1 Production, 0 Preview**.
4. FAIL registrado e progressão interrompida. Não houve novo push, regra alterada,
   redeploy ou tentativa de usar o sandbox agora inicializado para converter a
   mesma prova em PASS. Negativos adicionais e Fase 4 não executados.

A [Vercel documenta](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)
que o primeiro deployment de projeto novo é Production. O comportamento observado
é consistente com esse bootstrap, e não com a suposição de que a primeira branch
não-main permitida necessariamente produza Preview. git.deploymentEnabled decide
se a branch pode gerar deployment; não é uma declaração de target. Main:false
não impede bootstrap Production vindo de outra branch permitida.

### Consequência e próxima decisão

O desenho AUTO-05 não satisfez o critério de bootstrap sem Production e não foi
promovido para instalação real. BS é um projeto já inicializado com Production e
Previews existentes; a fixture é um projeto novo estático. Não extrapolar o FAIL
para afirmar que todo push bloqueado na BS geraria Production, nem extrapolar a
ausência de deploy de main no sandbox para declarar segura a instalação real.

Proposta para **nova decisão**, não execução nesta etapa: definir com o responsável
um ensaio separado para projeto já inicializado no sandbox preservado, com critérios
explícitos de main bloqueada, target Preview na branch permitida, regras
concorrentes seguras e contagens antes/depois. Manter AUTO-06 como FAIL histórico.
Se o requisito continuar sendo zero Production desde o primeiro deployment de um
projeto novo, revisar a viabilidade com base no comportamento documentado antes
de solicitar qualquer novo experimento. Nenhum recurso adicional deve ser criado.

Só após novo protocolo autorizado e aprovado será possível retomar manifesto
mínimo sobre main, dependências, permissões, contenção e rollback. A lista anterior
é uma proposta histórica, não instalação validada nesta sessão. Os gates continuam:
contenção comprovada → instalação mínima desativada → dry-run hospedado → escrita
explicitamente autorizada → primeiro recibo. Nenhum deles foi executado na BS.
O rollback futuro não pode remover o bloqueio por conveniência ou alterar aliases
reais por inferência; preservar a versão desativada e o histórico permanece regra.

Revisão somente leitura dos PRs #112/#111 e proposta de incorporar os dois docs de
negócio estão no HANDOFF. Não substituir o checkpoint atual pelo do #112 nem fazer
merge documental na main sem avaliar seu deployment automático ainda não contido.
CI/Preview do commit documental AUTO-06 serão conferidos pelo SHA próprio e não
mudam o resultado do ensaio, nem ativam o controlador.


## Plano técnico CHECKPOINT-AUTO-07

Histórico datado: as lacunas e autorizações abaixo descrevem o fim da AUTO-07.
Estado posterior da transição e próximo gate no [plano AUTO-08](#plano-técnico-checkpoint-auto-08--trans-main).

SDLC: Design/Arquitetura após A/B/C hospedados PASS e D local PASS. Evidências,
SHAs/IDs e riscos correntes ficam somente no [HANDOFF](../HANDOFF.md). AUTO-06
continua FAIL para bootstrap novo. Este plano **não autoriza execução na BS**;
Gate 1 não está liberado, embora a main já bloqueada e Previews tenham passado.

### Escopo comprovado e diferença de eventos

Sandbox existente: main:false preservado em todos os cinco commits; dois pushes
Preview antes, dois main bloqueados e um Preview depois, sem novo Production.
Negativos de configuração/consulta/concorrência foram somente simulados. O modelo
local não prova comportamento da Vercel, e READY não prova login funcional.

Sandbox é estático, sem env e sem domínio customizado; BS é Next.js, com env e
domínios próprios, já inicializada. Ambos têm Git conectado, Production Branch
main e Standard Protection. Não copiar env, secrets, GitCredential ou bypass.
Sandbox tem createDeployments disabled e disableRepositoryDispatchEvents true;
BS tem createDeployments enabled e histórico real de deployments GitHub. A emissão
de [deployment_status](https://vercel.com/docs/git/vercel-for-github) é distinta da
criação de builds na Vercel. Não alterar configurações para esconder essa diferença;
o ensaio AUTO-07 não exerceu signal/workflow_run ou bot hospedados.

### Lacuna obrigatória: primeiro commit real / TRANS-MAIN

A BS hoje não contém git.deploymentEnabled no vercel.json. Dois pushes de uma
main **já com false** não provam qual versão de configuração é usada ao introduzir
false pela primeira vez. Portanto **nem todas as condições do Gate 1 foram
comprovadas**. Não fazer esse experimento na main BS nem usar a CI como substituto.

Ensaio adicional proposto apenas para o sandbox existente, **não executado**:

1. Aprovar protocolo TRANS-MAIN, janela e risco de baseline equivalente à BS,
   com main inicialmente sem a regra. Não remover o bloqueio atual sob a autorização
   AUTO-07: esse push pode gerar um Production sintético esperado e exige autorização
   específica, distinta dos negativos locais que não podem criá-lo intencionalmente.
2. Se o responsável aprovar essa baseline, registrar separadamente o único
   Production sintético esperado, seus IDs/SHAs e o conjunto de deployments antes
   do commit sob prova. Sem dados, env BS, novo recurso, deploy manual ou promoção.
3. Publicar o primeiro commit que **introduz** main:false, com conteúdo restante
   preservado, e comparar todos os IDs/targets, inclusive staged/cancelado. Exigir
   zero novo deployment nesse commit, depois um controle Preview READY e nova
   leitura da main/configuração. Qualquer novo Production nessa transição é FAIL.
4. Manter baseline e prova separadas, preservar AUTO-06 FAIL e AUTO-07 PASS no
   escopo original. Protocolo/execução novos exigem decisão nominal. Se essa
   baseline Production não for aceitável, definir uma prova alternativa suficiente
   antes de qualquer escrita na BS; não declarar a lacuna resolvida por simulação.

### Manifesto mínimo e dependências

Base real conferida: `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`.
Fonte publicada dos arquivos do controlador:
`1af74ed60f4e6f4a8969a4e4b4dc88ccd53918d2`. Revalidar SHAs antes de preparar a
branch de instalação; nunca copiar a release inteira, fazer cherry-pick integral
dos commits de integração ou substituir package.json/ci.yml completos.

| Arquivo | Alteração mínima sobre a main conferida |
| --- | --- |
| .github/workflows/checkpoint-preview.yml | Adicionar definição confiável, mantendo false &&, contents: read, --dry-run |
| .github/workflows/checkpoint-preview-signal.yml | Adicionar sinal sem permissão, checkout ou código do candidato |
| scripts/atualizar-checkpoint-preview.mjs | Adicionar CLI e ligação ao motor/API; escrita local recusada |
| scripts/checkpoint-preview.mjs | Adicionar motor de evidência, idempotência, branch/URL/HEAD e recibo |
| scripts/checkpoint-github-api.mjs | Adicionar adaptador GitHub com paginação, API fixa e CAS GraphQL |
| scripts/validar-workflow-documental.mjs | Atualizar validador existente para sete campos por tarefa e diff de checkpoint |
| scripts/testar-checkpoint-preview.mjs | Adicionar suíte do motor/adaptador e travas versionadas |
| scripts/testar-workflow-documental.mjs | Atualizar suíte existente de 5 para 8 casos/contrato compartilhado |
| package.json | Acrescentar somente test:checkpoint-preview: node --test scripts/testar-checkpoint-preview.mjs; check:workflow e test:workflow já existem |
| .github/workflows/ci.yml | Manter steps atuais; acrescentar gate de HANDOFF no diff do PR e teste checkpoint-preview; manter token read e fetch-depth 0 |

Imports conferidos nos scripts acima são locais ou Node nativos (fs, path, url,
child_process, assert, test etc.); fetch é do runtime. CI main e candidato já usam
Node 24; controlador usa setup-node 24 e não instala pacotes nem executa artefatos
indicados pelo PR. Não há dependência npm nova nem secret Vercel/Supabase.

Contrato documental mínimo também precisa acompanhar a instalação: patch pontual
em AGENTS/CLAUDE e WORKFLOW, guia técnico do mecanismo e HANDOFF novo da tarefa,
com fila PROGRESS e histórico ESTADO_DO_PROJETO coerentes. Não copiar o HANDOFF do
#111 inteiro para main: release, migrations e homologação devem refletir a main
real e limites datados, preservando o link para o candidato #111. O validador novo
exige Última tarefa e estrutura que o checkpoint antigo da main ainda não fornece.
Índices/protocolo de continuidade só entram se referenciados; não são dependência
de runtime. A main conferida não tem a árvore docs/continuidade do #111.

**Não incluir:** src, migrations/SQL, fixtures financeiras, refactors de app,
lockfile, dependências, correções de negócio ou documentos #112 por arrasto. A
composição mínima ainda precisa de diff e CI próprios na branch isolada de main;
os 26 testes do #111 não validam antecipadamente essa nova composição.

### Cinco gates, critérios de aprovação e rollback

| Gate | Mudança futura / critérios obrigatórios | Rollback e limite |
| --- | --- | --- |
| 1 — Contenção | Após TRANS-MAIN aprovado e revisão nominal: PR mínimo a partir da main atual com git.deploymentEnabled exatamente main:false, mantendo schema/framework Next.js. Só integrar mediante autorização própria. Conferir mesmo Production/aliases e zero novo Production, além de Preview automático | Manter a trava nos commits seguintes. Se surgir Production inesperado, STOP e decisão administrativa de contenção previamente autorizada; não remover false nem alterar aliases como rollback automático |
| 2 — Instalado desativado | PR mínimo com manifesto acima e checkpoint adequado à main; validar combinação local/CI e política Git. Workflow_run instalado na branch padrão, mas false &&, token read, --dry-run e flag desligada. Sem release #111 | Recolocar versão travada se divergir; preservar main:false, histórico e app. Nenhuma ampliação global do token |
| 3 — Dry-run hospedado | Autorização própria para remover só false &&, mantendo read e --dry-run; definir allowlist/vars não secretas; adequar teste que fixa a versão desativada. Exigir evento real, CI/Preview/SHA corretos e decisão dry-run, sem commit do bot | Desligar variável, restaurar trava, manter read/dry-run e cancelar execução se autorizado; nenhum recibo a apagar |
| 4 — Escrita autorizada | Após Gate 3 e revisão nominal, mudar apenas job confiável para contents: write e --write, adequando testes. Revalidar CAS, dois caminhos permitidos e branch; autorização explícita de ativação | Desligar flag, cancelar jobs se autorizado, restaurar false &&/read/dry-run. Preservar recibos e a trava de deployment; nunca criar PAT para contornar bloqueio |
| 5 — Primeiro recibo | Um evento não documental autorizado em branch permitida, PR aberto e CI/Preview success no mesmo SHA produz um único commit atômico HANDOFF+recibo. Repetição não duplica; evento do commit documental não escreve de novo | Se divergente, suspender escritor e reconciliar via tarefa documental autorizada, sem apagar histórico, reescrever recibo existente ou inferir sucesso após resposta perdida |

Gate 1 é o próximo gate técnico, **ainda BLOQUEADO pela prova TRANS-MAIN e por
sua autorização própria**. Gate 2 não inicia porque o sandbox passou; exige o
fechamento do Gate 1, diff da combinação mínima e autorização de integração.
Não executar nenhum desses gates na BS na tarefa AUTO-07.

A política mínima proposta para o vercel.json preserva o arquivo atual:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "git": { "deploymentEnabled": { "main": false } }
}
```

Preparar na CI futura uma verificação estrita de que o objeto de política tem
**somente** main:false; booleano global, ausência, main:true ou outras regras
exigem revisão. Essa escolha conservadora evita o true concorrente que libera
main. É uma checagem a preparar no Gate 1/2, não instalada agora; sem pacote novo.
Validar também branches Preview e não desconectar Git. A trava precisa acompanhar
instalação, dry-run, ativação e rollback; sincronizar branches candidatas em tarefa
autorizada, preservando mudanças e sem rebase/force push publicado.

### Permissões, reprocessamento, logs e primeiro evento

[workflow_run depende da definição na branch padrão](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
O executor confiável deve continuar usando github.workflow_sha com
persist-credentials false; não buscar/executar PR, cache ou artefato não confiável.
API reconsulta origem, CI, deployment, PR e HEAD; o evento sozinho não é prova.

Política GitHub lida nesta etapa: default_workflow_permissions read e
can_approve_pull_request_reviews false. Não alterar esse padrão global. Gate 2/3
mantêm contents/actions/deployments/pull-requests read no job. Só Gate 4 pede
contents write nesse job; GITHUB_TOKEN não tem escopo por caminho, então a
proteção efetiva também depende do código confiável, allowlist, guards e revisão.
Qualquer restrição administrativa adicional deve ser diagnosticada, sem ampliar
permissões automaticamente.

Variáveis futuras, sem segredos: CHECKPOINT_AUTO_ENABLED, CHECKPOINT_PREVIEW_BRANCHES
(allowlist exata), CHECKPOINT_PREVIEW_PROJECT=bs-logistica-sistema e
CHECKPOINT_PREVIEW_TEAM=bslogisticas. Não incluir default branch/main, forks ou
ambientes protegidos na allowlist. Reconfirmar open PR/HEAD antes de publicar.
Nenhuma dessas variáveis foi configurada nesta tarefa.

A definição atual espera CI (validar/sql-local) e Preview signal, reconsulta ambos
no SHA e trata qualquer ordem. Deployment-status ausente, jobs não aprovados,
URL/branch/origem divergentes, paginação incompleta ou CAS concorrente recusam
escrita. Recibo por ID preserva histórico; resposta perdida exige reconciliar
HEAD/recibo antes de repetir, nunca criar um segundo commit às cegas. Concorrência
do workflow é pelo SHA, cancel-in-progress false, com expectedHeadOid final.

Dry-run precisa de diff não documental aprovado para testar o caminho completo;
push apenas de Markdown será corretamente skipped. Planejar um pequeno artefato
sintético sem import no app e HANDOFF na branch permitida, em autorização própria;
não alterar regra funcional só para disparar a prova. Reentrega de evento e falha
controlada devem ocorrer no escopo aprovado, sem desligar Preview para mascarar loop.

Logs devem registrar somente status/IDs/SHAs e limitações, sem corpos de API,
headers, cookies, URLs com query ou credenciais. A API é fixa GitHub, redirects
recusados; o motor não acessa URL Preview nem B2. O commit de recibo tem SHA próprio,
distinto do código implantado: não copiar CI entre eles nem pressupor execução
nova; consultar checks ou registrar ausência. Primeiro recibo, loop e permissões
reais ainda não foram testados remotamente. Nenhuma homologação é inferida.

### Continuidade funcional após infraestrutura

Manter a análise #112/#111 já registrada, sem substituir HANDOFF atual. Ordem
futura: incorporar os dois docs de negócio com checkpoint novo → reconciliar
estados dos PRs → revisar divergências funcionais no HEAD correto → priorizar
financeiro e decisões/migrations por ambiente → evoluir Serviços Avulsos → homologar
o sistema. Cada implementação, migration, merge e homologação tem gate próprio;
a fila e o PASS técnico AUTO-07 não concedem essas autorizações.

## Plano técnico CHECKPOINT-AUTO-08 / TRANS-MAIN

SDLC: Testes de infraestrutura / Design da contenção. Protocolo hospedado T1–T4
PASS no sandbox inicializado. Resultados, SHAs, IDs e contagens somente no
[HANDOFF](../HANDOFF.md); AUTO-06 FAIL e AUTO-07 PASS permanecem independentes.
A lacuna do primeiro commit ausente→main:false foi comprovada nesse escopo.
**Nenhum gate da BS real foi autorizado ou executado.**

### Comparabilidade e risco residual do primeiro commit real

Teste real teve sequência sem trava/Production esperado → primeiro commit com
trava/nenhum deployment → Preview automático → main posterior/nenhum deployment.
Não é apenas simulação ou teste de main que sempre esteve bloqueada. Não prova
bootstrap novo nem um bloqueio universal de deployments manuais ou promoções.

Sandbox e BS estão inicializados, GitHub conectado e Production Branch main;
sem hooks/overrides concorrentes observados e com Standard Protection. Permanecem
diferenças: sandbox estático/zero env/domínio nativo versus BS Next.js/11 env/
domínios reais; emissão de deployment_status/repository_dispatch do sandbox não
equivale à BS. Nenhum valor de env ou bypass é necessário à instalação do bot.
O teste não validou aplicação autenticada, banco, homologação ou controlador
hospedado. Não ampliar permissões nem modificar provedores para esconder diferenças.

Primeiro commit real continua operação com risco: configuração/HEAD/projeto podem
mudar entre revisão e integração, regra conflitante pode liberar a main e rollback
que retire false pode gerar Production. Reconfirmar estado imediatamente antes do
gate e observar o SHA de integração real, sem tratar o PASS sandbox como garantia
absoluta. Não desconectar Git nem alterar Production Branch/aliases/proteção.

### Diff mínimo preparado, sem aplicação na BS

Base remota conferida: `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, blob
vercel.json `a667db8cdaad0d862c4173ec447d8fbf9f64fcb1`. Revalidar na execução;
não usar esses identificadores como verdade permanente. Patch da configuração:

```diff
--- a/vercel.json
+++ b/vercel.json
@@ -1,4 +1,9 @@
 {
   "$schema": "https://openapi.vercel.sh/vercel.json",
-  "framework": "nextjs"
+  "framework": "nextjs",
+  "git": {
+    "deploymentEnabled": {
+      "main": false
+    }
+  }
 }
```

git apply --check e aplicação desse patch passaram apenas em pasta temporária
isolada; JSON e preservação dos campos anteriores conferidos. Não é alteração no
worktree real, branch main ou projeto Vercel. O patch é isolável da release #111:
não inclui src, migrations, dependências, lockfile ou controlador. A publicação
desta tarefa contém somente quatro documentos, não vercel.json.

Uma tarefa futura de Gate 1 deverá incluir seu checkpoint próprio coerente com a
main e checagem estrita da política (somente main:false; glob/booleano concorrente,
ausência ou main:true recusados). O modelo local já cobre negativos; a verificação
versionada de CI ainda precisa ser preparada/testada no candidato autorizado,
sem copiar ci.yml/package.json completos ou estado da release para main.

### Gates e autorizações independentes

| Gate | Pré-requisitos e prova de saída | Autorização ainda necessária |
| --- | --- | --- |
| 1 — Contenção | Prova TRANS-MAIN concluída; diff mínimo revisado sobre main atual, política/testes/CI próprios, operação em janela acordada. Exigir mesmo Production/aliases reais, zero novos Production/staged/cancelled/failed no SHA de contenção e controle Preview automático | Criar branch/candidato isolado da main, publicar PR mínimo e posteriormente integrá-lo somente sob aprovação específica; resposta administrativa a evento inesperado pré-definida, sem inferir permissão para mudar alias ou Production |
| 2 — Instalado desativado | Gate 1 concluído; manifesto mínimo AUTO-07, dez caminhos de código/configuração e contrato documental, sem release. Composição exige seus testes/CI. Manter false &&, contents: read, --dry-run e flag desligada | Publicação/revisão/integração do controlador mínimo na branch padrão; não autoriza ativação |
| 3 — Dry-run hospedado | Definição na branch padrão, evento confiável real com CI/Preview no mesmo SHA e candidato não documental aprovado. Reprocessamento, falha segura e logs sanitizados; nenhuma escrita | Remover só trava false && e definir quatro vars não secretas/allowlist, preservando token read/--dry-run; adequar testes da versão travada e autorizar evento de prova |
| 4 — Escrita | Gate 3 aprovado; revisão de código confiável, CAS, duas rotas permitidas, allowlist sem main/ambientes protegidos/forks, permissões e regressões | Alterar apenas job para contents: write e --write, atualizar testes e ativar flag sob aprovação nominal; sem PAT ou ampliação global de privilégio |
| 5 — Primeiro recibo | Um único commit atômico HANDOFF+recibo por deployment; CI/Preview/código no mesmo SHA, HEAD documental separado. Reentrega não duplica e evento documental não gera novo recibo | Autorizar evento real não documental e acompanhamento da primeira escrita na branch permitida; não implementar funcionalidade só para disparar teste |

Nenhuma nova alteração administrativa é exigida pela preparação local. Se as
permissões atuais não permitirem PR/workflow/vars, diagnosticar e pedir exatamente
o acesso necessário; não ampliar a integração a todos os repositórios. Permissão
global GitHub continua read. workflow_run precisa da definição na branch padrão;
não contornar essa dependência com pull_request_target ou execução do candidato.

### Dependências, concorrência, loops e rollback

Reutilizado o manifesto AUTO-07 sem nova auditoria: seus dez caminhos não mudaram
entre a fonte anterior e o HEAD 3fe2f1d conferido. Runtime apenas Node/arquivos
locais/fetch, CI Node 24 existente, sem npm novo ou secret Vercel/Supabase/bypass.
AGENTS/CLAUDE/WORKFLOW e checkpoint mínimo da main devem acompanhar o contrato
dos validadores; não copiar o HANDOFF da release nem docs #112 por arrasto.

Preservar checkout confiável github.workflow_sha, token mínimo e APIs reconsultadas;
não executar código/artefatos do PR. Motor valida CI+Preview+SHA, origem, projeto,
branch e HEAD atual, pagina resultados e recusa dados incompletos. Concorrência
por SHA não substitui expectedHeadOid; CAS final e reconciliação após resposta
perdida evitam sobrescrita/duplicação. Commits só documentais são skipped e recibo
existente é preservado. Logs somente IDs/SHAs/status, sem segredo ou API bruta.

Antes de qualquer Gate 1 real, acordar quem pode interromper/cancelar uma execução
inesperada e recuperar o estado servido; esta documentação não concede esse
poder. Se surgir Production inesperado, FAIL/STOP, sem nova progressão ou promoção
automática como correção. Manter main:false em todos os rollbacks; não reverter
o arquivo inteiro se isso retirar a contenção. Restaurar arquivos do controlador
só preservando o guard e histórico. Para gates 3–5: desligar flag, cancelar jobs
se autorizado e restaurar false &&/read/--dry-run. Recibos não se apagam e uma
resposta perdida não justifica nova escrita às cegas. Nunca restaurar B1.

Próxima ação exata: revisão e autorização nominal do Gate 1, com escopo mínimo,
CI, janela, prova de saída e resposta a falha. Gates 2–5 e reconciliação funcional
permanecem sem autorização; nenhum novo ensaio TRANS-MAIN é necessário sem
divergência factual. Preservar sandbox e todos os históricos para revisão.
