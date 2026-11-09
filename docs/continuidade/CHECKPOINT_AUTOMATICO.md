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

## Gate 2 mínimo: publicação desativada

Esta composição é candidata em PR Draft próprio a partir da main consolidada.
O estado factual/SHAs e a decisão atual ficam no [HANDOFF](../HANDOFF.md).
Não copiar a release funcional nem o checkpoint do #111 para a main. O mecanismo
Node foi portado seletivamente; não requer pacote npm, token Vercel/Supabase ou
bypass. A CI preserva main:false, os testes/step do Gate 1 e permissões globais read.

Travas obrigatórias nesta versão:

- controlador com false &&, contents: read e --dry-run;
- CHECKPOINT_AUTO_ENABLED ausente ou false (OFF); nenhuma variável foi configurada;
- sinal com permissions: {}, sem checkout/código do candidato;
- controlador confiável em github.workflow_sha e persist-credentials false;
- escrita local recusada, allowWrites false em dry-run e nenhuma credencial nova.

workflow_run só funciona com a definição na branch padrão. Publicar o Draft não
instala o controlador na main; seu merge exige autorização nominal futura e novas
verificações de main:false/CI/Production. Mesmo após merge, estas travas mantêm o
job desligado. Não confundir workflow sinalizador com autorização de escrita.

## Gate 3: plano de dry-run hospedado, não executado

### Condições e autorizações

1. Gate 2 integrado por aprovação específica, composição/CI e contenção real
   preservadas. Reconfirmar SHA/default branch, projeto, integração Git e eventos.
2. Nova autorização para dry-run: remover somente false && e adequar os testes
   que fixam a versão desativada; manter contents: read e --dry-run. Essa mudança
   não foi realizada nesta tarefa. Não autoriza --write nem contents: write.
3. Autorizar quatro variáveis não secretas: CHECKPOINT_AUTO_ENABLED=true para
   o ensaio em leitura, allowlist exata CHECKPOINT_PREVIEW_BRANCHES, projeto
   CHECKPOINT_PREVIEW_PROJECT=bs-logistica-sistema e time
   CHECKPOINT_PREVIEW_TEAM=bslogisticas. Não incluir main/default/staging/HML/forks.
   Sem PAT, segredo Vercel/Supabase ou ampliação de permissões globais.
4. Permissões do job: contents/actions/deployments/pull-requests read. Nenhum
   environments/secrets write. Se faltar acesso, diagnosticar sem contornar controles.

### Evento seguro e evidências

Autorizar uma branch de prova da main atual, PR aberto e artefato sintético
inerte fora do app, sem import/efeito funcional, junto ao HANDOFF atualizado.
O diff deve ser não exclusivamente documental para alcançar o caminho completo;
push só de Markdown será skipped por desenho. O PR é necessário para CI e foi
o caminho de Preview automático comprovado no Gate 1; não usar deploy manual.

Exigir CI validar/sql-local SUCCESS e Preview Vercel success no mesmo SHA, PR/HEAD
atuais e branch permitida. O controlador de workflow_run usa apenas código da
branch padrão, nunca candidato, cache ou artefato do PR. Consultar evidências
independentemente na API, incluindo deployment_status e ordem CI/sinal, sem inventar
evento ausente. Logs esperados: run/evento, decisão dry-run/skipped/recusa e motivo
sanitizado; vincular SHA/PR/deployment/CI pelos metadados GitHub. Se o diagnóstico
atual não permitir a vinculação, preparar patch de logs só com IDs/status sob
revisão; nunca corpos de API, headers, tokens, cookies ou URLs com query.

### Critérios PASS / FAIL / BLOQUEADO

- PASS: evento hospedado confiável no SHA correto alcança dry-run com evidência
  completa, sem qualquer commit/recibo remoto, e Production/configuração preservadas.
  Reentrega não escreve; evento documental é skipped; cabeça concorrente, CI/SHA/
  origem incorretos ou evidência falha são recusados. Provar negativo hospedado
  somente no escopo sintético aprovado; fixtures locais não viram prova remota.
- FAIL: tentativa/escrita remota, execução de candidato não confiável, permissão
  ampliada indevida, Production inesperado ou violação de branch/SHA/loop.
- BLOQUEADO: falta de evento, acesso, campos/paginação, logs suficientes ou outro
  requisito de prova. Não inferir dry-run aprovado nem homologação de READY/CI.

### Reversão segura

Se autorizado no ensaio futuro, desligar flag, cancelar apenas jobs do controlador
explicitamente autorizados e restaurar false &&/read/--dry-run. Preservar recibos,
histórico e main:false; não reverter a configuração inteira removendo a trava.
Evento de Production exige FAIL/STOP e decisão administrativa do proprietário
antes de cancelar/promover/mudar aliases. Não desconectar Git nem restaurar B1.
Gates 4 (escrita) e 5 (primeiro recibo) exigem aprovações independentes posteriores.

## Fonte e limites

O mecanismo e seus testes foram reutilizados da implementação publicada no #111;
o [plano histórico](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/continuidade/CHECKPOINT_AUTOMATICO.md)
permanece disponível. Esta composição precisa de seus próprios testes/CI/Preview.
O controlador não lê .env, não acessa Preview/Supabase/Auth e não deduz saúde,
homologação, banco aplicado ou decisões comerciais. Nenhuma sessão real de outra
IA ou dry-run hospedado foi simulada como aprovada.
