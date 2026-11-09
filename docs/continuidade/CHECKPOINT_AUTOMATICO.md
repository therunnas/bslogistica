# Continuidade por tarefa e evidência automática de Preview

SDLC: Desenvolvimento / Testes. A entrada de estado atual é sempre
[HANDOFF](../HANDOFF.md). Este documento define o mecanismo; não duplica o estado
da tarefa nem concede autorização para publicar ou ativar automação.

## Prioridade vigente: trilha auxiliar PAUSADA

RETOMADA-FUNCIONAL-01 consolidou #116 e priorizou a primeira versão funcional da
BS. Gate 1/2 preservados; Gates 3, 4 e 5 PAUSADOS, não concluídos. Não executar o
protocolo futuro abaixo sem nova solicitação explícita. Manter false &&,
contents: read, --dry-run e CHECKPOINT_AUTO_ENABLED OFF; nenhum workflow removido.
A continuidade passa pelo HANDOFF escrito pelo agente no conjunto publicado
com a autorização vigente. O #117 contém os seis documentos da retomada e da
transferência; conferir no GitHub o estado de integração do PR. A correção do item 7
e as migrations 046–050 estão no #119 Draft, **não** na main até merge autorizado.
Nenhum desses PRs autoriza ativação do controlador ou Gates 3–5.
Consultar CI e Preview pelo HEAD de cada PR, sem commit recursivo somente para atualizar status.

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

## Gate 2 instalado desativado

AUTO-12 integrou [#115](https://github.com/therunnas/bslogistica/pull/115) por squash
na main `92478763af9674ecd327333020ea2a6f240ee404`. O [HANDOFF](../HANDOFF.md) é a entrada principal para estado,
CI/eventos observados e limites. O mecanismo não incorpora a release #111/#112,
nova dependência, token Vercel/Supabase ou bypass.

Travas preservadas: false && no controlador, contents/actions/deployments/
pull-requests read, --dry-run, CHECKPOINT_AUTO_ENABLED ausente/OFF, sinalizador com
permissions vazio e sem checkout/escrita. Controlador confiável em
`github.workflow_sha`, persist-credentials false, sem código/cache/artefatos de PR.
Gate 1/main:false/Next.js/validação de CI permanecem intactos.

As duas definições estão na branch padrão. A API pode registrá-las como active,
mas o job é impedido pelas condições versionadas e flag. Workflow_run do AUTO-12
observado com checkpoint SKIPPED/zero steps; nenhuma CLI, escrita ou recibo real.
Esta é instalação desativada, sem prova de execução ativa ou dry-run hospedado.

## Gate 3 — PAUSADO; protocolo proposto, não executado

SDLC: planejamento do ensaio de infraestrutura. Gate 2 instalado desativado não é
Gate 3 aprovado. Nenhuma mudança deste protocolo foi executada no AUTO-12.
Gates 4 (escrita) e 5 (primeiro recibo) continuam sem autorização.

### 1. Autorização nominal e instalação do modo de leitura

Autorizar separadamente um PR mínimo da main então atual para remover somente
`false &&` do controlador e adequar seus testes da versão desativada. Preservar
`contents/actions/deployments/pull-requests: read`, permissões globais read,
`--dry-run`, checkout em `github.workflow_sha`, credenciais não persistidas,
sinalizador sem escrita e toda a contenção `main:false`. Nenhum PAT ou segredo novo.
Manter a flag OFF durante preparação, CI e eventual integração desse PR; o merge
é outra ação nominal. Não habilitar `--write` ou `contents: write`.

A CLI atual imprime decisão e motivo, sem IDs do recibo dry-run. Antes de ligar a
flag, aprovar se necessário um patch mínimo de observabilidade no mesmo PR:
logs JSON somente com status, SHA validado, PR, deployment GitHub e run/tentativa da
CI, derivados da evidência validada, e ID numérico do evento de origem. Testar
sanitização e ausência de tokens/eventos/respostas brutas. Não imprimir o objeto
inteiro de evento/API/recibo nem URLs com parâmetros. Sem vínculo verificável dos
IDs entre evento, CI e Preview, o ensaio fica BLOQUEADO, não PASS.

### 2. Variáveis e branch de prova

Autorizar exclusivamente quatro variáveis não secretas, inicialmente com flag OFF:

| Variável | Valor proposto |
| --- | --- |
| CHECKPOINT_AUTO_ENABLED | false durante preparação; true somente na janela nominal; false ao encerrar |
| CHECKPOINT_PREVIEW_BRANCHES | test/gate3-checkpoint-dry-run — uma única linha, correspondência exata |
| CHECKPOINT_PREVIEW_PROJECT | bs-logistica-sistema |
| CHECKPOINT_PREVIEW_TEAM | bslogisticas |

Redescobrir refs e conferir se o nome está livre; se ocupado, definir outro nome e
sua allowlist antes de ativar. Nunca autorizar main/default/master/prod/staging/
HML, forks ou a release #111 por arrasto. Sem nova integração Vercel/Supabase.
O token efêmero é somente `github.token` com os quatro escopos read declarados.
Se o acesso for insuficiente, STOP; não elevar permissões para obter PASS.

### 3. Evento sintético seguro

Autorizar uma branch da main atual e PR próprio com arquivo sintético inerte
`scripts/fixtures/checkpoint-preview-smoke.txt`, sem import/efeito no app, mais
HANDOFF atualizado. Essa extensão/caminho não é exclusivamente documental para o
classificador; nenhum código do candidato deve ser executado pelo controlador.
Usar somente Preview automático Git; não dispatch/deploy manual ou promoção.

Com os controles read-only já integrados e a allowlist conferida, habilitar a
flag por autorização específica e publicar um commit sintético na branch de
prova. Capturar HEAD/PR, CI `validar` e `sql-local` SUCCESS e deployment Preview
Vercel success/READY no mesmo SHA. Reconsultar autoria Vercel, status mais recente,
URL canônica, head_repository/origem, branch, PR/HEAD atual e paginação. Observar
`workflow_run` de CI e/ou Preview signal; não fabricar evento ausente.

### 4. Provas e repetição

- Exigir logs dry-run com IDs sanitizados correlacionados às APIs e ao código
  confiável da branch padrão. Zero commit, recibo ou mutação remota pelo token.
- Observar as duas entregas naturais CI/sinal do mesmo SHA e comparar decisões e
  identidade do recibo proposto. Se faltar repetição observável, solicitar
  autorização nominal de reexecução pelo proprietário; não conceder actions:write
  ao job. Sem repetição comprovada, esse item permanece BLOQUEADO.
- Publicar depois um commit somente HANDOFF/Markdown na mesma branch autorizada:
  esperar classificação skipped para impedir loops, sem escrita/recibo.
- Evento atrasado de HEAD substituído, branch proibida, origem/CI/SHA divergentes
  ou consulta incompleta devem recusar evidência. Exercitar remotamente apenas os
  negativos sintéticos expressamente autorizados; manter os demais nas fixtures.
- O dry-run pode provar repetição sem escrita e checagens de HEAD, mas não prova
  CAS de uma escrita real. expectedHeadOid/resposta perdida/commit atômico continuam
  evidências locais até o gate de escrita autorizado; não transferir esse PASS.
- Comparar refs/árvores/receipts, histórico completo Production, servido/aliases/
  domínios/proteção/Git antes/depois. CI verde ou HTTP 200 não são homologação.

### 5. Critérios e encerramento

PASS somente com evento confiável, correlação SHA/PR/CI/Preview completa, decisão
dry-run observável, repetição e documental skipped comprovados no escopo, zero
escrita e Production preservada. FAIL para qualquer escrita, candidato/artefato
não confiável executado, privilégio indevido ou Production inesperado. BLOQUEADO
quando faltar evento, acesso, IDs/logs, repetição ou outra prova. Documentar cada
item separando hospedado e simulado/local; não converter parcial em PASS.

Ao encerrar, sob a autorização específica do ensaio, voltar a flag para false e
revalidar SKIPPED/ausência de escrita. Restaurar false && e seus testes por PR
revisado se previsto na autorização, preservando read/--dry-run/main:false e todo
histórico. Nunca restaurar vercel.json retirando a trava. Qualquer cancelamento,
promoção, alias ou intervenção administrativa em Production exige nova decisão
do proprietário. Nenhuma recuperação administrativa foi autorizada pelo AUTO-12.

## Fonte e limites

O mecanismo e seus testes foram reutilizados da implementação publicada no #111;
o [plano histórico](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/continuidade/CHECKPOINT_AUTOMATICO.md)
permanece disponível. A composição foi testada no AUTO-11 e a main integrada
revalidada no AUTO-12; não transferir esses resultados para futuras alterações.
O controlador não lê .env, não acessa Preview/Supabase/Auth e não deduz saúde,
homologação, banco aplicado ou decisões comerciais. Nenhuma sessão real de outra
IA ou dry-run hospedado foi simulada como aprovada.
