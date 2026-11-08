# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. CHECKPOINT-AUTO-04B, 08/11/2026: publicação documental autorizada do diagnóstico AUTO-04 no PR #111. Controlador permanece desativado; rotação controlada e ensaio isolado pendentes.**

**Retomada:** antes da publicação AUTO-04B, HEAD local/remoto do PR #111
confirmado em `80ebfbb0f1be3615832f6f456a3240b7715919a7`, sem divergência;
nenhum fast-forward necessário. Este conjunto contém somente os quatro documentos
da AUTO-04, revisados para publicação na mesma branch. Descobrir o SHA publicado
e seus próprios checks no PR; não transferir CI/Preview de 80ebfbb ao novo commit.
Production e configurações Vercel não foram reinspecionados nesta sincronização;
valem os limites da inspeção AUTO-04 abaixo. SDLC: documentação/publicação no PR,
sem instalação ou ativação. Este arquivo permanece o checkpoint único.

## Identificação

| Campo | Valor |
| --- | --- |
| Etapa | CHECKPOINT-AUTO-04B: sincronização documental autorizada exclusivamente no PR #111 |
| Gate atual | Publicar diagnóstico sanitizado e conferir CI/Preview no novo SHA; rotação, ensaio e ativação não autorizados |
| Último gate concluído | Leitura autenticada Vercel; CI 42494404663 validar/sql-local SUCCESS e Preview READY no HEAD 80ebfbb |
| Worktree | `/private/tmp/bs-fin-20d` |
| Branch | `integracao/release-preview-01` |
| Base | `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, também fonte do Production servido |
| HEAD validado | 80ebfbb0f1be3615832f6f456a3240b7715919a7 — ponto de partida remoto/local confirmado da AUTO-04B; novo SHA e CI/Preview precisam de conferência própria |
| Alterações não commitadas | Somente quatro documentos da AUTO-04 atualizados para AUTO-04B; conferir status após publicação; nenhum arquivo de código/configuração |
| PR | [#111](https://github.com/therunnas/bslogistica/pull/111) aberto Draft contra main; outros PRs inalterados |
| Ambiente-alvo | GitHub/CI e Preview automático do PR #111 por publicação documental; sem nova inspeção ou alteração Vercel/Supabase |
| Última ação comprovada | Branch/worktree/diff e HEAD remoto conferidos; exatamente quatro documentos locais, sem código/workflows/configurações alterados; controles do bot preservados |
| Próxima ação exata | Após CI/Preview deste conjunto, obter autorização para rotação controlada do bypass exposto, com avaliação de consumidores e validação; depois autorizar ensaio descartável do bloqueio antes de instalação na main real |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | CHECKPOINT-AUTO-04B: revisão e publicação exclusivamente documental do diagnóstico autenticado AUTO-04 na branch do #111 |
| Resultados e testes comprovados | Confirmação remota 80ebfbb, sem divergência; exatamente quatro documentos e nenhum valor secreto identificado na revisão. Local desta sincronização: check:workflow PASS, test:workflow 8/8 PASS e diff --check PASS. CI/Preview do novo commit ainda pendentes no momento deste registro |
| Código e PR afetados | PROGRESS.md, docs/ESTADO_DO_PROJETO.md, docs/HANDOFF.md e docs/continuidade/CHECKPOINT_AUTOMATICO.md; somente PR #111, sem código, workflow, migration ou configuração alterados |
| Ambientes envolvidos | GitHub e Preview automático do push documental; sem deploy manual, novas leituras Vercel/Supabase ou alteração em HML/Production |
| Pendências e decisões | Credencial de bypass exposta na AUTO-04 exige rotação controlada autorizada, nunca seu valor neste arquivo. Ensaio main:false, instalação mínima, dry-run e escrita do bot continuam pendentes; controlador com false &&, contents: read e --dry-run |
| Próxima ação exata | Conferir CI/Preview no SHA publicado; depois obter autorização específica para rotação controlada e, em gate separado, ensaio isolado preservando Previews |
| Autorizações e proibições | Autorizados commit e push normal somente destes quatro documentos na branch do #111. Proibidos valores secretos, rotação, deploy manual, main, merge/force push, bot, mudanças Vercel, HML/Production, migrations e criação/fechamento de PRs |

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

- **Publicado no GitHub:** implementação em `c5c62e99f91d154290247a1100cf98b090b6811d`, plano AUTO-03 em `92ee55afa763d2234784486dedb476f87abe820b`, registro final AUTO-03B em `80ebfbb0f1be3615832f6f456a3240b7715919a7`, HEAD remoto conferido do #111 nesta etapa.
- **Conjunto AUTO-04B autorizado para publicação:** `docs/HANDOFF.md`, `PROGRESS.md`, `docs/ESTADO_DO_PROJETO.md` e referência em `docs/continuidade/CHECKPOINT_AUTOMATICO.md`, incluindo as evidências sanitizadas AUTO-04. A confirmação de push/CI/Preview pertence ao novo SHA; até sua conferência não declarar publicação aprovada.
- **Outros artefatos somente locais:** logs `/private/tmp/checkpoint-auto-01-*`, inventário de backups e stack sintética. Não são necessários para executar o controlador ou ler o estado publicado.
- **Nunca publicar:** credenciais, `.env`, dumps, respostas brutas da API, URLs/identificadores de hooks e bypass. Nenhum segredo/variável remoto foi configurado. Houve exposição acidental de identificador sensível na saída técnica, sem inclusão nos documentos; revisão administrativa pendente.

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
`npm run test:workflow` 8/8 PASS e `git diff --check` PASS. Commit/push e CI/Preview
deste conjunto ainda pendentes no momento deste registro, sem antecipar resultado.

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

CHECKPOINT-AUTO-04B (vigente): commit e push normal exclusivamente dos quatro documentos na branch ativa do PR #111, atualização do HANDOFF e conferência de CI/Preview do SHA publicado. Sem autorização de mudança de provedor ou rotação.

Histórico CHECKPOINT-AUTO-04: somente leitura e diagnóstico autenticado, com documentação local; nenhuma publicação naquela etapa.

Histórico CHECKPOINT-AUTO-03B: commit/push dos quatro documentos e registro final exclusivo do HANDOFF, executados na etapa anterior; autorização não reutilizada.

Histórico CHECKPOINT-AUTO-03: inspeção somente leitura e plano/checkpoint locais; sem publicação naquela sessão.

Histórico CHECKPOINT-AUTO-02: revisão, commit/push fast-forward exclusivamente na branch do #111 e leitura de CI/Preview; autorização não reutilizada nesta etapa.

Histórico CHECKPOINT-AUTO-01: implementação/testes locais e fast-forward, sem publicação naquela etapa.

Histórico CHECKUP-SYNC-01 / FUNC-READY-02 (não reutilizar como autorização atual): commit da FUNC-READY-01, atualização dos documentos de continuidade, push
exclusivamente para `integracao/release-preview-01`, verificação de CI e Preview e verificações não destrutivas do
deployment.

## Proibições

CHECKPOINT-AUTO-04B: sem exibir/registrar valores secretos, rotacionar credenciais, executar deploy manual, alterar Vercel/Supabase/conexão Git, main, merge/force push, bot, tokens/segredos, hooks, novos/fechados PRs, HML/Production ou migrations. Publicação autorizada somente dos quatro documentos no #111.
Sem merge em `main`, deploy em Production, migration em HML ou Production (046–049 inclusive), limpeza ou escrita
de dados no HML, novo Supabase, novo PR, alteração dos PRs de origem, backups redundantes e force push.

## Bloqueios e riscos

- Decisão comercial da 048 pendente (acima); sem ela, a 048 não vai a ambiente compartilhado.
- Idempotência de adicionais só vale com a 047 no HML; até lá, reenvio após resposta perdida bloqueia e exige conferência.
- Expurgo do HML, 046–049 no HML e cópia independente dos backups seguem com gates próprios.
- Regra permanente: ao concluir ou pausar, toda tarefa atualiza este checkpoint com o que foi executado, o que
  funcionou, o que não funcionou, evidências e ambientes, pendências, próxima ação e o que não está autorizado.

## Retomada

1. Descobrir o checkout/worktree e a branch reais; conferir status, HEAD local e HEAD remoto pelo PR autorizado.
2. Ler a identificação e “Última tarefa”; preservar alterações locais e não reutilizar autorização histórica.
3. Conferir o HEAD publicado AUTO-04B e seus próprios checks; preflight Vercel autenticado concluído na AUTO-04 no limite descrito acima. Rotação controlada e ensaio isolado exigem autorizações próprias; sem ativação.
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

