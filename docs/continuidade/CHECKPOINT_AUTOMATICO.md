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

**Plano somente; nenhum passo administrativo executado em CHECKPOINT-AUTO-02.**
Não fazer merge do #111 para instalar o controlador. `main` ainda é a branch
padrão exigida por `workflow_run`; isso não obriga integrar a release inteira.
O caminho proposto é uma mudança mínima futura de infraestrutura/documentação,
precedida de contenção comprovada do deploy automático e com autorização própria.

1. **Antes de alterar `main`:** obter autorização administrativa específica;
   registrar o deployment/aliases atuais de Production e os mecanismos que podem
   publicar (integração Git, hooks e workflows). Não pausar o aplicativo servido.
   A opção documentada de contenção é desconectar temporariamente o repositório
   do projeto Vercel existente em [Settings → Git](https://vercel.com/docs/project-configuration/git-settings).
   Não apagar projeto, domínio, deployment ou dados. Conferir antes/depois que o
   domínio e seus aliases continuam no mesmo deployment, sem publicação nova.
   Se isso não puder ser comprovado, parar: nenhuma alteração em `main`.
2. **Com a contenção comprovada:** por um gate futuro de integração autorizada,
   levar a `main` apenas controlador/sinal, módulos Node necessários, validador
   compatível e checkpoint — sem código funcional, migrations ou commits de
   integração da release. Manter `false &&`, token somente leitura e `--dry-run`.
   A preparação desse conjunto precisa identificar dependências mínimas e obter
   aprovação nominal; este documento não autoriza branch nova, PR ou merge.
3. **Bloqueio durável antes de reconectar:** preparar, nessa mudança mínima
   futura, `git.deploymentEnabled` com `main: false` na configuração Vercel,
   preservando as demais configurações. Essa opção [impede deploy automático por
   branch](https://vercel.com/docs/project-configuration/git-configuration).
   Conferir a Production Branch real e bloquear todas as branches de Production;
   nenhuma regra concorrente verdadeira pode reabilitá-las. Não usar `[skip ci]`
   ou apenas impedir atribuição de domínio como prova de ausência de deployment.
4. **Reconexão é outro gate:** validar previamente, fora de Production, o
   comportamento de reconectar o projeto existente com esse bloqueio; não acionar
   importação, redeploy ou promoção. Revalidar CI, histórico de deployments e
   aliases. Se o provedor não oferecer prova suficiente de que a reconexão não
   dispara Production, manter a integração desconectada e a ativação bloqueada.
   Não reconectar por tentativa nem prometer que a contenção foi validada agora.
5. **Só depois:** autorizar as variáveis não secretas e um ensaio de leitura com
   Preview da branch permitida. Ainda sem remover as três travas. A prova do
   controlador instalado não é permissão de escrita. Habilitar o job inicialmente
   em modo seco também exige uma alteração revisada específica.
6. **Último gate, separado:** após aprovação do ensaio, autorizar remoção da trava,
   `--write` e permissão mínima de conteúdo; conferir um evento real, repetição,
   conflito e evento documental, sem publicar Production ou migrar banco.

Em qualquer divergência, suspender a ativação e preservar histórico/aliases; não
usar force push, mudar a default branch ou promover o Preview para contornar o
gate. A contenção descrita é uma proposta apoiada na documentação do provedor,
não uma configuração inspecionada ou aplicada no projeto nesta sessão.
