# Handoff ativo

<!-- workflow-handoff:v1 -->

**CHECKPOINT-AUTO-12 — Gate 2 PASS: INSTALADO DESATIVADO na main. SDLC:
integração / testes / manutenção. #115 integrado por squash no HEAD autorizado;
CI aprovada, Production preservada, controlador com job SKIPPED. Gate 3 somente
planejado; nenhuma ativação, dry-run hospedado ativo ou escrita automática.**

Este registro documental separado conserva o histórico da main e da release.
Consultar no GitHub o estado de integração deste checkpoint; sua publicação não
faz merge nem habilita o Gate 3. Os estados abaixo são evidências datadas, não
SHAs/caminhos permanentes ou autorização para retomar operações remotas.

## Identificação

| Campo | Valor |
| --- | --- |
| Etapa | AUTO-12 — Gate 2 instalado desativado; registro documental separado |
| Gate atual | Gate 2 PASS; Gate 3 somente planejamento, sem autorização de execução |
| Último gate concluído | #115 squash exato, árvore idêntica ao candidato, CI da nova main, travas e Production verificadas; workflow_run observado com job SKIPPED |
| Worktree | /private/tmp/bs-checkpoint-auto-12/checkpoint; worktrees anteriores preservados; redescobrir todos os caminhos/status ao retomar |
| Branch | docs/checkpoint-auto-12-gate2-installed — documental, criada da main integrada; consultar PR desta branch e seu estado no GitHub |
| Base | 92478763af9674ecd327333020ea2a6f240ee404 — squash #115; a base anterior foi b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b |
| HEAD validado | 92478763af9674ecd327333020ea2a6f240ee404 — main/CI/árvore/travas/Production. O registro documental tem HEAD/checks próprios no PR desta branch; não transferir a CI da main |
| Alterações não commitadas | Quatro documentos compõem este registro; conferir status na retomada. Três docs locais AUTO-10 permanecem intocados no worktree original, fora da publicação |
| PR | #115 MERGED; registro AUTO-12 na branch documental acima, estado no GitHub; #111/#112 abertos Draft e preservados |
| Ambiente-alvo | Main GitHub/Actions; Vercel somente leitura e eventual Preview Git da documentação. Nenhum HML/Supabase ou deploy manual |
| Última ação comprovada | Sete leituras completas; última Vercel 309 s após squash, processo de consultas 315,0 s: mesmos 43 Production/servido/aliases/domínios/proteção/Git, zero deployment do merge, zero recibo/escrita automática; CI SUCCESS |
| Próxima ação exata | Revisar e autorizar nominalmente a integração deste checkpoint documental se pendente; depois autorizar separadamente o protocolo Gate 3 read-only, sem executar Gates 4–5 |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | Revalidar o #115 exato, tornar Ready, reconferir checks/reviews/threads, squash condicionado ao HEAD autorizado, comprovar instalação desativada e preparar o protocolo futuro Gate 3 |
| Resultados e testes comprovados | 56 casos Node pertinentes PASS nesta sessão, validators/YAML/integridade Gate 1/dependências/diff PASS; CI validar/sql-local SUCCESS na nova main; árvore e 17 arquivos idênticos ao candidato; evento workflow_run com checkpoint SKIPPED/zero steps; mesmos 43 Production, zero deployment do merge e nenhuma escrita automática. CI/testes anteriores AUTO-11 mantêm data/SHA, não são prova nova |
| Código e PR afetados | #115, HEAD fda7fcc9df7b64d0393852c9cc5256624a7b9b52, integrado em 92478763af9674ecd327333020ea2a6f240ee404; composição mínima sem app/SQL/migrations/dependências/vercel.json. Registro posterior somente HANDOFF, PROGRESS, ESTADO e CHECKPOINT_AUTOMATICO; sem alterar os workflows integrados |
| Ambientes envolvidos | GitHub/default main e Actions. Projeto Vercel real só consultado; Git Preview documental automático pode ser criado. Nenhuma operação Supabase, credencial, domínio, alias, promoção ou cancelamento |
| Pendências e decisões | Gate 2 instalado desativado, não ativo/validado. main:false e todas as travas preservadas; flag ausente/OFF. Callback observado não executou CLI/checkout, não comprova dry-run. Consolidar este registro e obter autorização própria para Gate 3; Gates 4–5 proibidos |
| Próxima ação exata | Revalidar HEAD/base/diff/checks do PR documental e autorizar sua integração se pendente; depois aprovar escopo read-only, allowlist/evento/logs/retorno OFF do Gate 3 antes de qualquer mudança |
| Autorizações e proibições | AUTO-12 usada somente para Ready/squash #115 exato, verificações/observação e checkpoint separado conforme Fase 7. Sem merge automático deste registro, sem Gate 3 ativo, remoção false &&, flag ON, contents: write, --write, recibos, #111/#112, alterações Production/Supabase, migrations ou deploy manual |

## Evidência automática de Preview

<!-- checkpoint-preview:start -->
Controlador instalado na main, totalmente desativado: false &&, contents: read,
--dry-run e flag ausente/OFF. AUTO-12 observou workflow_run/job SKIPPED, zero steps.
Nenhum recibo automático ou dry-run hospedado ativo foi executado.
<!-- checkpoint-preview:end -->

## Evidências

### AUTO-12 — preflight e squash

- Preflight remoto: main b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b, #115 fda7fcc9df7b64d0393852c9cc5256624a7b9b52,
  mergeable/CLEAN, mesmos 17 arquivos/blobs, CI e Preview do próprio HEAD READY
  (`dpl_DoU8FnEvKPHnJ8kE5zzsXKBzQCRU`). Sem app, SQL/migration, dependência nova,
  alteração de vercel.json ou release #111/#112.
- Ready em 2026-11-09T04:05:15Z; reconsulta de checks/reviews/threads sem pendência
  ou bloqueio. CodeRabbit status success não é aprovação humana de código;
  revisão independente do mesmo candidato já constava da AUTO-11, sem repeti-la.
- Squash [#115](https://github.com/therunnas/bslogistica/pull/115),
  em 2026-11-09T04:07:30Z: `92478763af9674ecd327333020ea2a6f240ee404`, pai `b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b`,
  árvore `a6e7ce724145aa7e52e8e59a49d9fb40f51b6675` idêntica ao candidato. Sem --admin, auto-merge,
  force push ou commit direto adicional na main. Os 17 arquivos foram reconferidos.
- [CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42560037734): validar/sql-local SUCCESS. Validação local nova:
  56 casos (26 automação/8 documentais/22 política Vercel), contrato/links,
  main:false, YAML/permissões/checkout confiável, composição CI/dependências e
  diff --check PASS. CI executou as verificações completas da nova main; os
  resultados locais 70 suítes/lint/TypeScript/build do AUTO-11 são históricos.

### AUTO-12 — Production e ausência de escrita

Baseline completa pré-merge: 216 deployments / 3 páginas, 43 Production.
Sete leituras completas pós-merge, com última leitura Vercel em 2026-11-09T04:12:39Z
(309 s após squash). O processo incluiu outras consultas GitHub e encerrou a
última amostra composta em 2026-11-09T04:12:44Z, 315,0 s medidos após merge.
É amostragem delimitada, não garantia contínua/infinita.

| Evidência | Antes | Depois |
| --- | --- | --- |
| Total deployments | 216 | 216 |
| Production (todos os estados) | 43 IDs | Os mesmos 43 IDs, zero novo/removido |
| Servido | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 | Idêntico |
| SHA servido | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc | Idêntico |
| Deployment do squash | Nenhum | Nenhum target/estado, inclusive staged/failed/cancelled |
| Domínios/aliases/proteção/Git | Baseline | Idênticos |
| Refs publicadas | Baseline | Somente main avançou pelo squash autorizado |
| Recibos automáticos | Nenhum na árvore candidata | Nenhum novo |

Aliases preservados: admin.bslogisticas.com.br,
bs-logistica-sistema-bslogisticas.vercel.app,
bs-logistica-sistema-git-main-bslogisticas.vercel.app e
bs-logistica-sistema-gold.vercel.app. Production Branch main, conexão Git,
proteção all_except_custom_domains, overrides e hooks sem divergência.
Nenhum deployment/ajuste administrativo executado. Zero incidente operacional.
Nenhum commit publicado pelo controlador: refs comparadas, main sem avanço além
do squash, #111/#112/candidato preservados e job sem passos. Este registro manual
posterior em branch própria é autorizado e não é recibo automático.

### AUTO-12 — instalação e evento observado

Os dois arquivos estão na branch padrão: checkpoint-preview.yml e
checkpoint-preview-signal.yml. A API registra os workflows como state active;
isso significa definição registrada, não controlador operacionalmente ativado.
O bloqueio versionado false && e a flag OFF mantêm o job desligado.

[Evento workflow_run observado](https://github.com/therunnas/bslogistica/actions/runs/42560278574), run 42560278574,
SHA `92478763af9674ecd327333020ea2a6f240ee404`, branch main, criado em 2026-11-09T04:10:07Z:
workflow Checkpoint Preview e job checkpoint **SKIPPED**, zero steps.
A API comprova o estado; a condição false && é sempre falsa e a flag estava
verdadeiramente ausente/OFF. Não houve checkout, token de job exercido ou CLI
executada; permissões read são as declaradas, sem afirmar teste efetivo do token.
Sem dry-run hospedado ativo, escrita ou recibo. Nenhum evento foi fabricado.

Travas reconferidas no código da main: false &&, contents/actions/deployments/
pull-requests read, --dry-run, flag ausente/OFF, sinal com permissions vazio e sem
checkout/escrita, controlador confiável github.workflow_sha e persist-credentials
false. Default workflow permissions do repositório read; nenhum segredo/variável
ou credencial criado. Gate 1/vercel.json/Next.js/lockfile e controles preservados.

Fechamento documental desta branch: 34 casos (automação/contrato documental)
reexecutados PASS, links canônicos e diff --check PASS; revisão independente
sem bloqueio importante. A precisão entre horário da Vercel e duração agregada
foi corrigida sem repetir o ensaio. CI/Preview desta documentação têm SHA e
checks próprios a consultar no GitHub, sem commit recursivo somente de status.

### Histórico AUTO-11 e anteriores — preservar datas e escopos

Os registros seguintes pertencem às suas etapas. Expressões como candidato,
ausente da main ou merge não autorizado descrevem a situação daquela data;
foram superadas somente pela integração nominal AUTO-12 acima. Não são autorização
vigente nem prova de Gate 3, escrita ou homologação funcional.

### AUTO-11 — consolidação documental comprovada

- #114 ajustou somente referências transitórias em HANDOFF, PROGRESS e ESTADO;
  HEAD final `0917e0c16e8480bcb74e7a638027e91dfd961c26`, três blobs remotos
  conferidos, CI/Preview próprios aprovados, Ready e nenhuma revisão/thread
  bloqueante. CodeRabbit não produziu aprovação de código (política do serviço).
- Squash em 2026-11-09T03:23:27Z: `b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b`,
  pai `2561b919da5ab31e0ed1882864ee069b9961b6f7`, árvore idêntica ao candidato.
  [CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42556140779):
  validar e sql-local SUCCESS, sem supressão de checks ou --admin.
- Leituras completas/paginadas antes e após o squash, até 03:26:42Z (191,3 s):
  215 deployments totais, mesmos 43 Production, zero deployment associado ao
  squash em qualquer target/estado, Git e main:false preservados. Servido
  `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`, SHA
  `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, mesmos aliases/domínios/proteção.
  É verificação desta consolidação, não nova homologação ou repetição do AUTO-10B.

### AUTO-11 — composição mínima do Gate 2

Branch criada de b26b6d8, fonte seletiva #111
`7e08270011f74ea5dfe4470097f58659eea81140`. Sem merge/cherry-pick de release,
sem app, SQL/migrations, lockfile, documentos de negócio #112 ou nova dependência.
O [guia técnico](continuidade/CHECKPOINT_AUTOMATICO.md) descreve os componentes,
limites e o plano do Gate 3. HANDOFF permanece entrada única de continuidade;
AGENTS/CLAUDE compartilham contrato literal de sete campos por tarefa.

Workflows permanecem com **false &&, contents: read, --dry-run e flag OFF**.
Sinalizador sem checkout/escrita; controlador usa github.workflow_sha confiável,
sem executar código/artefatos de PR. Nenhum secret ou variável foi configurado.
A composição é candidata; workflow_run depende da instalação na branch padrão,
ainda não autorizada. Sem dry-run hospedado, recibo ou escrita automática real.

Testes desta composição (não transferidos do #111): 70 suítes Node PASS; 26 casos
cobrem repetição/idempotência, CAS/conflito/resposta perdida, SHA/CI/origem/branches,
falha de consulta/evidência insuficiente, documentação/loops e locks. Mais 8 casos
documentais e 22 de política Vercel. Lint e TypeScript PASS. YAML validado e CI
comparada estruturalmente à base: só histórico completo no checkout de validar,
gate HANDOFF e suíte nova; Gate 1/permissões/jobs restantes intactos. Build padrão Turbopack PASS em 31,73 s
com placeholders públicos inertes, sem .env/credenciais reais. Diff --check e
revisão de segurança PASS. Revisão independente da composição sem achado crítico
ou importante para o Draft; observação de contrato CLAUDE corrigida e teste do
checkout confiável/cache/artefatos reforçado, 26 casos reexecutados PASS. Nenhum
resultado de teste hospedado/CI/Preview do candidato é presumido antes de sua
consulta no SHA publicado. Consultar checks próprios sem commit recursivo só
para registrar status.

Históricos seguintes mantêm seus SHAs/resultados e não representam autorização
vigente. AUTO-06 FAIL, AUTO-07 PASS e AUTO-08 TRANS-MAIN PASS seguem independentes.

### AUTO-10 interrompido e preservação local

AUTO-10 parou antes do merge por falta de confirmação da Fase 3. Na retomada
AUTO-10B, o proprietário confirmou disponibilidade, acesso administrativo funcional
e ciência do incidente. Proprietário decide/autoriza eventual recuperação;
executor monitora e interrompe a progressão em caso de falha. Nenhuma nova pergunta
de confirmação foi feita; não houve sinal de indisponibilidade durante a operação.

Os três documentos locais de AUTO-10 não foram sobrescritos: permaneceram no
worktree original e foram preservados byte a byte, com manifest/patch local em
/private/tmp/bs-checkpoint-auto-10b/preserved-local-docs. O novo worktree foi criado
da main integrada. Seu histórico relevante foi incorporado aqui; não depende do
acesso a esses artefatos para conhecer o resultado. #111 não sobrescreveu a main.

### Integração e baseline

- Autorizado: HEAD `53dce23e4973b1f1474fe165c415a307335929a0`, base `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`. Diff remoto de oito arquivos/blobs
  reconferido; 212 deployments completos/3 páginas, 43 Production, nenhum ativo.
- Ready confirmado em 2026-11-09T02:17:27Z; checks mantidos SUCCESS,
  zero threads/reviews bloqueantes. CodeRabbit pulou revisão automática por política
  do serviço para este OSS; não foi aprovação de código. Revisão local anterior e
  autorização nominal do mesmo HEAD preservadas; sem bypass --admin/auto-merge.
- Squash #113 em 2026-11-09T02:22:12Z: `2561b919da5ab31e0ed1882864ee069b9961b6f7`, pai `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, árvore
  `265ea1b74a1d567f6be81e1cb0d2b7991f2031cd` idêntica ao candidato autorizado. Sem funcionalidade da release.
- main:false exclusivo e framework nextjs conferidos na main, com validador,
  testes, CI e documentação autorizados. [CI do SHA integrado](https://github.com/therunnas/bslogistica/actions/runs/42550552142):
  validar/sql-local SUCCESS. Nenhuma migration/SQL ou alteração Supabase.

### Janela Production e controle Preview

| Evidência | Antes | Depois da janela |
| --- | --- | --- |
| Horário UTC | 2026-11-09T02:22:16Z | 2026-11-09T02:52:26Z |
| Production servido | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 |
| SHA servido | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc |
| IDs Production | 43 | 43, mesmo conjunto; zero novo/removido |
| Total deployments | 212 | 213; único novo é o Preview de controle |
| Deployment do merge | nenhum | nenhum target/estado; nenhum objeto GitHub de deployment do SHA |

Janela real de **1810.0 segundos**, 49 amostras,
histórico completo repaginado em cada leitura, queries bem-sucedidas. Nenhum novo
Production/staged Production, failed/cancelled indevido ou incidente observado.
Mantidos Git, Production Branch main, configuração, domínios, proteção e aliases
Production: admin.bslogisticas.com.br, bs-logistica-sistema-bslogisticas.vercel.app,
bs-logistica-sistema-git-main-bslogisticas.vercel.app e
bs-logistica-sistema-gold.vercel.app. Nenhum alias/domínio modificado manualmente.

Controle na branch `docs/checkpoint-auto-10b-gate1-result`, criada de `2561b919da5ab31e0ed1882864ee069b9961b6f7`:
commit `0732b66e85b3768101da854307ba6a5a32a6d25c` alterou só HANDOFF. Push sem PR em
2026-11-09T02:26:02Z não produziu status/deployment nas leituras
anteriores ao Draft. Após abrir #114 em 2026-11-09T02:30:26Z, Vercel gerou
`dpl_FbRVLLpDoBw7c2zzeCa5Ki5foZYS`, [Preview](https://bs-logistica-sistema-3ptokhj9b-bslogisticas.vercel.app), READY/source Git,
target Preview (null), SHA/ref corretos e gitSource.prId=114.
GitHub deployment `7645579824` success. STAGED como
subestado de Preview não é staged Production. Branch/commit/deployment preservados.

O caminho automático via PR foi comprovado. Não afirmar que push isolado sem PR
foi comprovado nem inferir sua causa. Não houve deploy manual, mudança Vercel,
bypass, autenticação funcional ou homologação a partir de READY/HTTP 200.
O fechamento documental posterior pode gerar outro Preview autorizado; ele tem
SHA/checks próprios e não pertence à contagem da janela acima.

### Histórico AUTO-10B — proposta do Gate 2 então não preparada

Reutilizado o [plano existente do #111](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/continuidade/CHECKPOINT_AUTOMATICO.md),
sem repetir auditorias. Fonte atual `7e08270011f74ea5dfe4470097f58659eea81140`; base futura deve ser redescoberta
após a decisão sobre este checkpoint, não fixada permanentemente em `2561b919da5ab31e0ed1882864ee069b9961b6f7`.

| Caminhos | Preparação futura |
| --- | --- |
| .github/workflows/checkpoint-preview.yml; checkpoint-preview-signal.yml | Adicionar definições mínimas, sem executar candidato/artefato não confiável |
| scripts/atualizar-checkpoint-preview.mjs; checkpoint-preview.mjs; checkpoint-github-api.mjs; testar-checkpoint-preview.mjs | Adicionar três módulos Node nativos/locais e suíte; sem pacote ou segredo novo |
| scripts/validar-workflow-documental.mjs; testar-workflow-documental.mjs | Atualizar contrato compartilhado; checkpoint coerente com main, não com a release |
| package.json; .github/workflows/ci.yml | Somente novo teste/gate de HANDOFF e dependência de histórico necessária; preservar step Gate 1, jobs, Node 24 e permissões existentes |
| AGENTS.md; CLAUDE.md; docs/WORKFLOW.md e guia/checkpoint | Patches mínimos do contrato documental; sem copiar HANDOFF/release/#112 por arrasto |

Manter obrigatoriamente **false &&, contents: read, --dry-run e flag desligada**.
CHECKPOINT_AUTO_ENABLED: absent; disabled by default. Nenhuma variável ou segredo foi alterado.
workflow_run depende da definição na branch padrão; não contornar com escritor
em PR, PAT ou execução de código do candidato. Sem token Vercel/bypass/Supabase.
Validar composição isolada com testes próprios, idempotência, CAS/expectedHeadOid,
reprocessamento, dados incompletos, falha segura, loops e logs sem segredo. Não
emprestar os testes do #111 como prova de uma composição ainda não criada.

AUTO-11 autoriza criar/publicar PR Draft mínimo do Gate 2 da main então atual,
somente após consolidar #114 e verificar main/CI/Production. A integração do Gate 2
exige aprovação nominal separada. Instalação na main não realizada; gates 3 (dry-run), 4 (escrita) e 5 (recibo)
continuam sujeitos a autorizações independentes. Rollback sempre preserva
main:false; qualquer intervenção administrativa continua sem autorização.

### Histórico AUTO-10B — estado publicado e limites

#113 mergeado; #111 `7e08270011f74ea5dfe4470097f58659eea81140` e #112 `2d1c0cde7bd47154a281171d77858b530d0b6de2` permanecem
abertos Draft, sem integração ou reconciliação funcional. Controlador ausente na
main e desativado no #111. AUTO-06 FAIL/AUTO-07 PASS/AUTO-08 PASS mantêm escopos
históricos independentes. Nenhuma Production homologada por esta tarefa.

Artefatos sanitizados locais em /private/tmp/bs-checkpoint-auto-10b; evidências
essenciais constam aqui. O resultado foi registrado no #114; consultar no GitHub
o HEAD/SHA de integração e seus checks próprios, sem
transferir CI da main/smoke nem criar commits recursivos só para registrar checks.

### Histórico da main anterior ao AUTO-10B

Registros seguintes preservados da main integrada, com datas e limites originais.
Não são autorização atual nem nova auditoria financeira/Production.

### Gate 1 — baseline e candidato (08/11/2026 BRT; horários UTC)

- Retomada #111 em 7e08270011f74ea5dfe4470097f58659eea81140 e #112 em
  2d1c0cde7bd47154a281171d77858b530d0b6de2, ambos abertos Draft e preservados.
  Branch nova nasceu da main 38b4349, sem cherry-pick ou incorporação dos PRs.
- API Vercel em 2026-11-09T00:22:34Z: projeto bs-logistica-sistema,
  prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV, Git therunnas/bslogistica, Production Branch
  main; sem hooks nem overrides build/install/output/root/ignored-step retornados.
  Autoassign true e Standard Protection all_except_custom_domains preservados.
  Nenhuma configuração administrativa alterada; sem divergência material AUTO-08.
- Production servido: dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4, SHA
  38b43490a8e0913c62a4ee6047ef48a8288ca0dc. Aliases: admin.bslogisticas.com.br,
  bs-logistica-sistema-bslogisticas.vercel.app,
  bs-logistica-sistema-git-main-bslogisticas.vercel.app e
  bs-logistica-sistema-gold.vercel.app. Sem promoção/cancelamento ou alteração.
- Lista completa pré-publicação: 43 deployments Production (paginação completa,
  sem filtro de estado), registrados para comparação após o push. CI da main
  base: validar/sql-local success; permissão global de workflows read.
- vercel.json da main tinha somente $schema e framework nextjs; candidato
  preserva ambos e acrescenta git.deploymentEnabled exatamente {"main":false}.
  Nenhum booleano global, glob ou regra de outra branch; Previews habilitados por
  padrão. A regra ainda não está na main; o merge real segue acoplado a deploy
  enquanto a contenção não for integrada e comprovada.
- Validador/testes novos usam Node nativo, sem instalação de pacote. Executam
  contra JSON/arquivos reais temporários e códigos de saída, incluindo ausência,
  main:true, booleanos globais, globs, branch incorreta, inválidos, framework
  removido e duplicidade de chaves. CI acrescenta apenas um step após Setup Node,
  com check:vercel-deployments e test:vercel-deployments, sem mudar permissões.
- Testes escritos e observados falhando antes da implementação; 22/22 passaram
  depois. YAML comparado estruturalmente à main: removido o step novo, igualdade
  total de jobs/triggers/permissões/steps. Comandos do step executados com sucesso.
- 69/69 suítes Node e lint PASS. Primeiro tsc falhou em tipos .next de uma rota
  exclusiva do #111; origem comprovada no cache gerado. .next e tsbuildinfo
  anteriores preservados fora do checkout, tsc limpo PASS sem mudar app/tsconfig.
  Build padrão npm run build PASS (Turbopack, 136,42 s), com variáveis públicas
  inertes como na CI; nenhum teste/limitação antiga foi transferido a este SHA.
- Artefatos locais sanitizados/cache preservado em /private/tmp/bs-checkpoint-auto-09;
  não são checkpoint alternativo, não serão publicados nem são necessários à
  retomada. Resultados públicos finais serão registrados abaixo após criar o PR.

### Publicação do Draft e fechamento do checkpoint

PR [#113](https://github.com/therunnas/bslogistica/pull/113), aberto Draft contra
main, branch chore/gate1-production-deployment-guard. Código publicado em
`75fe207b77c936123af96000471f698ec8c23ecc`; diff remoto completo conferido: 8 caminhos e blobs idênticos
ao conjunto local revisado, sem src/SQL/migrations/auth/lockfile/controlador.

Conferência de `2026-11-09T00:36:26Z`: [CI validar e sql-local PASS](https://github.com/therunnas/bslogistica/actions/runs/42540864694),
Vercel success. Preview `dpl_52k9hWtcAtaKdsMtjujbZ6zZQFnp`, [URL](https://bs-logistica-sistema-6avmet2mx-bslogisticas.vercel.app),
source Git/branch/SHA corretos, target Preview/READY; recibo GitHub
`7644201426` success. CodeRabbit não revisou por ser Draft;
a revisão local independente não encontrou defeitos críticos/importantes.

Production preservada: mesmos 43 IDs, incluindo qualquer estado retornado;
zero novos Production, mesmo deployment servido/aliases/proteção/configuração
e mesmos HEADs de main/#111/#112. Nenhum comando de deploy ou alteração Vercel.

Este fechamento documental atende à etapa de registrar o resultado após criar o
PR; não muda código validado. Seu próprio SHA/checks/Preview devem ser consultados
no HEAD final do #113 e na entrega, sem emprestar PASS de 75fe207 nem fazer uma
série recursiva de commits só para registrar checks. SHA nominal de aprovação
será o HEAD final indicado na descrição do PR; qualquer alteração exige reaprovação.
Na AUTO-09, Gate 1 estava somente preparado; essa condição foi resolvida pelo squash e observação AUTO-10B registrados acima.

### Histórico AUTO-09 — proposta então futura, #113 integrado no AUTO-10B

1. Aprovar nominalmente o SHA final exato do Draft (HEAD da API, informado na
   descrição/entrega final); qualquer commit novo invalida a aprovação anterior.
   Reconfirmar a main e baseline servida acima; se divergirem, STOP/revisão.
2. Diff esperado: 8 arquivos — vercel.json, dois scripts Node, package.json,
   .github/workflows/ci.yml e HANDOFF/PROGRESS/ESTADO_DO_PROJETO. Zero src, SQL,
   migrations, lockfile, auth, documentos #112 ou controlador; sem release #111.
3. Checks obrigatórios para a decisão: validar/sql-local e Vercel no mesmo HEAD,
   22 casos da regra e validação documental/Node/lint/tsc/build aprovados. Nenhuma
   review bloqueante ou conflito pendente; CI verde não é homologação.
4. Janela proposta: 30 minutos após autorização, com responsável disponível e
   sem alterações concorrentes main/Vercel. Horário nominal e responsável devem
   ser confirmados pelo proprietário antes de integrar; não estão autorizados.
5. Método proposto: squash, após tornar Ready somente se autorizado, com
   --match-head-commit no SHA aprovado, sem --admin ou auto-merge. Reconsultar
   checks, reviews, threads e base imediatamente antes. Registrar o novo SHA do
   squash; ele difere do candidato e precisa de evidência própria.
6. Antes/depois: capturar lista paginada de deployments Vercel sem filtro de
   estado, targets e aliases, e eventos/statuses GitHub. Observar por pelo menos
   3 minutos após o push/CI e reconferir após o controle Preview, cobrindo atrasos.
   Exigir zero novos Production/staged/failed/cancelled associados à integração,
   mesmo Production servido/aliases/proteção/Git. Não usar somente saída da CLI.
7. Autorizar separadamente um evento sintético em branch Preview aprovada, sem
   regra de negócio, secrets ou banco. Exigir source Git, SHA/branch corretos,
   target Preview READY, main:false preservado e zero Production inesperados.
   O Preview deste Draft demonstra a branch atual; não substitui o controle
   posterior ao merge. Sem evento autorizado/evidência suficiente, BLOQUEADO.
8. Resposta a falha: FAIL/STOP e suspender progressão. O proprietário deve nomear
   antes quem poderá executar contenção administrativa e sob qual autorização.
   Nenhuma mudança de Production, alias, promoção ou cancelamento está permitida
   nesta etapa. Não reverter vercel.json retirando main:false: isso reabilitaria
   deployments. Qualquer correção/rollback deve preservar a trava e o histórico.
9. Só depois da prova real do Gate 1: Gate 2 controlador mínimo instalado mas
   desativado → Gate 3 dry-run hospedado em leitura → Gate 4 escrita autorizada →
   Gate 5 primeiro recibo automático. Cada gate requer autorização independente.

### Histórico da main anterior ao Gate 1 — não é validação desta tarefa

Os registros seguintes foram preservados da main base; datas, PRs e estado do
banco refletem suas sessões originais. Não foram reauditados ou atualizados por
inferência a partir da release #111.

- Sessão 11: PR #100 marcado Ready e mergeado por squash com `--match-head-commit`
  no HEAD autorizado `a391079671539ddd89b8e2cd910adb65d68c9a74`, depois de reconfirmar
  CI, Preview, `CLEAN` e ausência de revisões bloqueantes. `main` =
  `91513b91b11461ac48d8dfe6af118234bfb6fbc0`; CI de `main` (run `42077946742`)
  verde; deploy automático de Production `7581007010` em `success`.
- Sessão 12, Production: sem acesso à Vercel (sem CLI, token ou MCP), então nenhum
  rollback foi tentado. Não há candidato comprovadamente melhor: o último deploy
  anterior a qualquer migration 035+ é o de `3f5125c` (30/10, deployment
  `7441801844`), que descartaria os PRs FIN-PR-01 a 13 sem prova adicional; a `main`
  tem suíte de compatibilidade 034 → 045 (697 asserções) e Production já recebeu vários
  deploys nesse estado. Smoke não destrutivo: `/login` e `/esqueci-senha` 200;
  `/dashboard`, `/fechamento`, `/containers`, `/operacional`, `/faturamento` e `/mfa`
  redirecionam para `/login`; `POST /api/fechamento/xlsx-cliente` sem sessão responde 405.
  `max(version)` em Production = `20261101120000` (034), lido em transação `READ ONLY`.
- Sessão 12, HML: head `20261112120000` (045), 50 migrations, confirmado por leitura.
  Dump de dados de `public` antes das escritas. Contas e dados sintéticos
  `E2E-S11` (lista de IDs em
  [Homologação integrada](financeiro/homologacao-fin-pr-13.md)). Resolução
  comercial permaneceu **OFF**; o motor por vigência já estava ligado.
- Execução: app Next local (porta 3100) ligado só ao HML, JWT reais, TOTP real.
  Resultados por caso e achados na matriz. Nenhum defeito financeiro encontrado;
  um achado de documentação (regra de arredondamento da HE) e quatro observações.
- Sessão 13: resolução comercial ligada em HML só durante B02, C03 e C04 e restaurada
  para OFF (verificado). Navegador real (Chrome): C05, D04, D05, D09 e fluxos de
  recuperação. Microsoft Excel real (AppleScript): E03 e E04, com filtros aplicados.
  A05: papel e auditoria pela interface; recuperação sem MFA e com um TOTP. Regra da HE
  (15 → 30, 45 → 60) aprovada e corrigida em `ARQUITETURA.md`. Resultado 25/1/1/0.
- Sem Preview da Vercel apontado para HML (sem acesso à Vercel). Dynamis continua
  indisponível: E06 BLOQUEADO, sem inferência.

- Sessão 14: PR #101 mergeado por squash em `e7f77b0` (CI verde no HEAD `1371f07`; só
  documentação). A05 fechado em stack local isolada com captura de e-mail; E06 executado com
  a planilha Dynamis (SHA-256 `2b211d4c…18f7`, comparação por componente, sem paridade);
  achado G explicado sem alterar código; H corrigido no PR #102 (rótulos "fim exclusivo");
  novo achado I (margem do Dashboard sem custo de Containers) e dependência J (modelo de e-mail
  do convite). Manual de uso e plano 034 → 045 redigidos.

- Sessão 15: PR #102 mergeado (`b63d33b`). Achado I corrigido no PR #104 (custo de Containers
  na margem do Dashboard e dos Relatórios; 67/67 suítes, lint e tsc). Manual corrigido
  (Presente/Falta/Substituição; Faturamento; Relatórios) e runbook corrigido (os scripts
  `comparar-catalogo-*.sh` só operam no local). Config de Auth de HML e Production lida por
  `supabase config pull --dry-run` (nada gravado). **Backup novo de Production** em
  `~/bs-backups-producao/2026-11-05-034/` (cifrado, senha no Chaveiro) com restauração local
  comprovada; Production não tem dados de negócio.

- Sessão 16: #104 corrigido para o schema 034 (defeito medido no PostgREST real sobre o backup) e
  mergeado (`071ea6d`); margem total no Fechamento e no Faturamento no PR #105; backup verificado e
  restaurado (Auth funcional); ensaio integral 034 → 045 e reversão; checklists de e-mail e backup.
  Parecer: NO-GO condicional (runbook, seção 11).

## Migrations por ambiente

AUTO-12: nenhuma consulta/operação de banco ou alteração SQL. Os estados abaixo
são o último registro herdado da main, não reconferidos nesta tarefa.

- Esta etapa não criou nem aplicou migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045; escritas apenas de dados sintéticos pelas RPCs e
  tabelas da própria aplicação, e uma transação com `ROLLBACK` (último admin).
- Production `ehkduqokntemtmqzdrbd`: 034; apenas leitura do head. Sem backup recente
  (último lógico: 23/10/2026).

## Autorizações

AUTO-12 vigente: Ready e squash #115 exclusivamente no HEAD nominal, verificações,
observação e preparação do plano Gate 3. Registro factual separado em branch/PR
documental conforme Fase 7, sem integração automática ou commit adicional na main.
O merge do registro documental, se pendente, requer decisão nominal própria.
Gate 3 não foi autorizado a executar; Gates 4–5 permanecem proibidos.

Histórico AUTO-09: implementação mínima, testes, commit/push normal somente na
branch chore/gate1-production-deployment-guard e criação de PR Draft contra main.
Merge e mudanças de main/Production não autorizados. Os itens abaixo são históricos.

- sessão 11: ready e squash merge do PR #100 condicionados ao HEAD exato;
- sessão 12: proteger Production (rollback só com candidato comprovado), preparar HML
  com identidades e dados sintéticos, executar a matriz de 27 casos e atualizar a
  documentação. Nenhuma foi usada para alterar Production.

## Proibições

AUTO-12: sem remover false &&, ligar flag, dry-run hospedado ativo, contents: write,
--write ou recibos automáticos. Sem integrar #111/#112, alterar app/SQL/migrations,
Supabase, Production administrativamente, aliases/domínios/credenciais, deploy
manual, novos projetos, exclusões ou site institucional. Preservar main:false.
Sem merge automático do checkpoint documental ou execução dos Gates 3–5.

Os limites AUTO-09 abaixo pertencem àquela sessão, não desfazem o squash concluído.

AUTO-09: sem merge, main direta, release #111/#112, Vercel real, HML/Supabase,
migrations, credenciais, dados, domínios/aliases, deploy manual, bot ou gates 2–5.

- sem migration em Production, dados de Production ou alteração de variáveis de Production;
- sem ligar a resolução comercial em HML sem autorização específica;
- sem e-mails reais, pagamentos externos, dados pessoais reais ou alteração de usuários reais;
- sem inferir regra comercial nem usar R$ 35.118,12 como fixture de outra base.

## Bloqueios e riscos

- Gate 1 PASS é delimitado a esta janela/amostragem e ao Preview automático via PR;
  não é garantia infinita ou bloqueio universal de deploy manual/promoção.
- Gate 2 instalado desativado pelo AUTO-12; execução do Gate 3 e escrita dos Gates 4–5 dependem de novas autorizações. O bot não está ativo.
- Originais locais AUTO-10 foram preservados; não confundi-los com o checkpoint
  registrado no #114 ou substituir o estado da main pela release #111.
- Parágrafos funcionais seguintes são históricos, sem reconciliação nesta tarefa.

- Histórico AUTO-09: trava integrada no AUTO-10B; Gate 2 preparado no AUTO-11 e instalado desativado no AUTO-12. Nenhuma autorização se estende ao Gate 3.
- GitHub informa main sem proteção; o check falha diante de regressão, mas não
  impede por si só um merge administrativo. Nenhuma proteção/ruleset/permissão
  foi modificada. Exigir checks e revisão na decisão nominal.
- Git.deploymentEnabled governa eventos Git; não bloqueia universalmente deploy
  manual/promoção. Diferenças sandbox/Next.js e observação delimitada continuam
  limites. Não declarar Production homologada ou controlador ativo.
- Registros funcionais/banco seguintes são históricos da main; sem reconciliação
  funcional nesta tarefa nem autorização herdada desses parágrafos.

- **Histórico funcional: Production roda código 045 sobre banco 034.** Não é nova
  inspeção de banco. O acoplamento Git/Production referido nos registros antigos
  foi contido pelo Gate 1; esta etapa não altera código ou banco servido. Opções
  históricas de tratamento, sempre com autorização própria: manter
  (a compatibilidade 034 → 045 está testada), conter por rollback na Vercel com
  acesso administrativo, ou preparar 035–045 em Production com backup novo.
- Pendências reais: revisão humana dos PRs #103 e #104; **segunda cópia** do backup em outro
  local protegido; conferir no Dashboard do Supabase os **modelos de e-mail** de convite e
  recuperação, a **expiração** do link e a autenticação do domínio de envio (ver runbook, 1.2);
  decisão e autorização para implantar 035–045 em Production, com dump novo se houver escrita.
- Dados sintéticos em HML, com faturas emitidas (imutáveis), exigem tarefa própria de
  limpeza. Regra de arredondamento da HE aprovada e documentada na sessão 13.
- Manual de utilização e preparação de Production 035–045 são gates posteriores.

## Retomada

1. Redescobrir worktrees/status/HEADs; preservar os três docs locais AUTO-10.
   Ler este checkpoint na branch/PR da tarefa autorizada, sem copiar o #111.
2. Conferir #115 MERGED e a main remota; 92478763af9674ecd327333020ea2a6f240ee404
   é a instalação histórica do Gate 2. Revalidar main:false, locks, CI e Production.
3. Consultar o estado de integração da branch docs/checkpoint-auto-12-gate2-installed;
   se o registro estiver pendente, revisar diff exclusivamente documental/checks e
   pedir autorização nominal para integração. Não fazer merge por inferência.
4. O [protocolo Gate 3](continuidade/CHECKPOINT_AUTOMATICO.md) é somente plano:
   obter autorização própria para patch/variáveis/allowlist/eventos/repetição/logs/
   retorno OFF. Não remover false && ou habilitar flag nesta retomada por memória.
5. Em incidente, FAIL/STOP e evidências sanitizadas; proprietário decide qualquer
   intervenção administrativa. Não cancelar/promover/trocar alias/remover a trava.
