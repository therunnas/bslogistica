# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. CHECKPOINT-AUTO-02, 08/11/2026: implementação publicada no PR #111, CI e Preview comprovados em c5c62e9; controlador bloqueado, sem ativação.**

**Retomada:** 19 arquivos publicados por fast-forward em `c5c62e99f91d154290247a1100cf98b090b6811d`. O commit que publica este checkpoint altera somente `docs/HANDOFF.md`; conferir o HEAD atual pelo PR e seus checks, sem atribuir automaticamente a ele a CI ou o Preview do código.
SDLC: Desenvolvimento / Testes; homologação funcional pausada durante a publicação CHECKPOINT-AUTO-02. Objetivo: qualquer IA autorizada abre o repositório, lê este checkpoint, confere o
GitHub e sabe onde continuar, sem depender de histórico de conversa.

## Identificação

| Campo                     | Valor                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Etapa | CHECKPOINT-AUTO-02 — implementação publicada na branch do #111; automação ainda bloqueada |
| Gate atual | CI e Preview do código c5c62e9 concluídos; ativação e instalação do controlador na branch padrão não autorizadas |
| Último gate concluído | GitHub Actions 42481151663: validar e sql-local SUCCESS no SHA c5c62e9; Preview success no mesmo SHA; revisão focal de publicação sem bloqueio |
| Worktree                  | `/private/tmp/bs-fin-20d`                                                                                                                                                           |
| Branch                    | `integracao/release-preview-01`                                                                                                                                                     |
| Base                      | `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                                                                                                                   |
| HEAD validado | c5c62e99f91d154290247a1100cf98b090b6811d — implementação publicada e CI/Preview conferidos. Commit documental posterior altera só este HANDOFF; verificar seus checks separadamente |
| Alterações não commitadas | Nenhuma após o commit documental que publica este checkpoint; confirmar status ao retomar. Nenhum artefato local necessário à automação foi deixado sem publicação |
| PR                        | [#111](https://github.com/therunnas/bslogistica/pull/111) Draft contra `main`; #106, #108, #109 e #110 em Draft, inalterados                                                        |
| Ambiente-alvo | GitHub/CI e Preview do PR #111; sem escrita em HML/Production ou migrations |
| Última ação comprovada | Push normal 0308127 → c5c62e9, CI validar/sql-local SUCCESS e deployment GitHub 7635950040 em Preview; signal skipped; main permaneceu 38b4349 |
| Próxima ação exata | Revisar e autorizar separadamente o plano de contenção do deploy automático antes de qualquer instalação mínima na branch padrão; nenhuma ativação ou merge por inferência |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | CHECKPOINT-AUTO-02 concluída: 19 arquivos publicados no #111, CI/Preview conferidos e bot mantido bloqueado |
| Resultados e testes comprovados | Local: 26/26 automação, 8/8 documentais, lint, tsc e check:workflow PASS; revisão focal de publicação sem bloqueio. CI 42481151663: validar e sql-local SUCCESS em c5c62e9. Preview success no mesmo SHA. Turbopack local continua limitação histórica; build padrão passou na CI |
| Código e PR afetados | Commit c5c62e99f91d154290247a1100cf98b090b6811d, 19 arquivos, branch integracao/release-preview-01, PR #111 aberto Draft; este checkpoint final em commit documental separado, sem alterações de negócio ou migrations |
| Ambientes envolvidos | Checkout local, GitHub Actions efêmero e deployment Preview do #111; sem acesso ao banco HML/Production, sem alteração de main |
| Pendências e decisões | Instalação na branch padrão e ativação permanecem proibidas; plano de contenção/reconexão não executado. Homologação funcional e decisões comerciais 048/049 continuam pendentes |
| Próxima ação exata | Obter autorização específica para avaliar/aplicar contenção administrativa e preparar instalação mínima; o #111 não deve ser mergeado para instalar o controlador |
| Autorizações e proibições | Executado commit/push fast-forward somente na branch do #111. Seguem proibidos merge/main, force push, bot de escrita, segredos remotos, novos/fechados PRs, HML/Production e migrations |

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

- **Publicado no GitHub:** os 19 arquivos da implementação em `c5c62e99f91d154290247a1100cf98b090b6811d`, na branch `integracao/release-preview-01`. Este checkpoint final é publicado por commit documental subsequente na mesma branch; descobrir seu SHA no [PR #111](https://github.com/therunnas/bslogistica/pull/111).
- **Somente locais:** logs `/private/tmp/checkpoint-auto-01-*`, inventário de backups e stack sintética. Não são necessários para executar o controlador ou ler o estado no GitHub.
- **Nunca publicar:** credenciais, `.env`, dumps e dados pessoais. Nenhuma variável/segredo remoto foi configurado nesta tarefa.

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

CHECKPOINT-AUTO-02 (vigente): revisão, commit e push fast-forward exclusivamente na branch ativa do PR #111, e leitura de CI/Preview. O checkpoint final pode acompanhar commit documental posterior na mesma branch.

Histórico CHECKPOINT-AUTO-01: implementação/testes locais e fast-forward, sem publicação naquela etapa.

Histórico CHECKUP-SYNC-01 / FUNC-READY-02 (não reutilizar como autorização atual): commit da FUNC-READY-01, atualização dos documentos de continuidade, push
exclusivamente para `integracao/release-preview-01`, verificação de CI e Preview e verificações não destrutivas do
deployment.

## Proibições

CHECKPOINT-AUTO-02: sem merge/main, force push, ativação de bot, configuração de segredos, novos/fechados PRs ou instalação do controlador na branch padrão.
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
3. Conferir o HEAD atual do #111; o código validado está em c5c62e9 e o checkpoint posterior altera somente este arquivo. Conferir CI/Preview do HEAD exato pelo GitHub; não assumir resultados de outro SHA.
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

