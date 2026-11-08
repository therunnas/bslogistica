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
   o transforma em commit documental; SQL em runbook também não é ignorado.
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
