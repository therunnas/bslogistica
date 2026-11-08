# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. FUNC-READY-02 / CHECKUP-SYNC-01, 07/11/2026. FUNC-READY-01 concluída localmente e publicada no PR #111 (Draft).**
SDLC: Testes / homologação. Objetivo: qualquer IA autorizada abre o repositório, lê este checkpoint, confere o
GitHub e sabe onde continuar, sem depender de histórico de conversa.

## Identificação

| Campo                     | Valor                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | FUNC-READY-01 concluída localmente (precedência de preço, correção de container, prévia); publicada no #111 por FUNC-READY-02; checkpoint por CHECKUP-SYNC-01                       |
| Gate atual                | Gate 3 (CI e Preview) concluído para o código; homologação manual e decisão comercial da 048 pendentes                                                                              |
| Último gate concluído     | FUNC-READY-01: validação local completa e E2E 34/34; antes, UX-SIMPLIFICACAO-02 (`9978684`, CI verde, Preview com destino HML provado)                                              |
| Worktree                  | `/private/tmp/bs-fin-20d`                                                                                                                                                           |
| Branch                    | `integracao/release-preview-01`                                                                                                                                                     |
| Base                      | `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                                                                                                                   |
| HEAD validado             | `c4b445622b5f89c2f98907333ce8aee362f76407` (commit `c4b4456`, código da FUNC-READY-01). Commits seguintes só alteram documentação; ver "Arquivos locais × remotos"                  |
| Alterações não commitadas | Nenhuma ao fechar esta etapa; qualquer alteração fora deste checkpoint pertence a outro agente: preservar                                                                           |
| PR                        | [#111](https://github.com/therunnas/bslogistica/pull/111) Draft contra `main`; #106, #108, #109 e #110 em Draft, inalterados                                                        |
| Ambiente-alvo             | Preview do #111 × HML `qbnfcmrxmssnwkhaitgd` (schema 045). Nenhuma escrita ou migration remota nesta etapa                                                                          |
| Última ação comprovada    | Push de `c4b4456` e `f03e8c7` para o #111; CI (`validar`, `sql-local`) PASS e Preview READY com destino HML conferidos no SHA `f03e8c7`                                             |
| Próxima ação exata        | Homologação manual do Preview (roteiro `docs/homologacao-release-preview-01.md`, itens 4, 5, 6, 8, 12) e decisão comercial da 048; 046–049 só entram no HML com autorização própria |

## Estados por item

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

| Onde                                           | O que                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub, branch `integracao/release-preview-01` | Código, migrations 048/049, suítes Node e SQL, E2E `scripts/testar-fluxos-local.sh`, roteiro manual e este checkpoint                                                                                                                                                                    |
| Remoto (HEAD)                                  | `f03e8c7a7a21f993368de60d92b6224d542df320` ao gravar este checkpoint (código `c4b4456` + documentação `f03e8c7`). O commit que publica este texto altera só `docs/HANDOFF.md` e não invalida as evidências; conferir com `git ls-remote origin refs/heads/integracao/release-preview-01` |
| Somente no Mac (não publicado)                 | Inventário oficial de backups; stack local isolada `bs-fin20d-local` e seus dados sintéticos; logs de execução                                                                                                                                                                           |
| Nunca no GitHub                                | Senhas, chaves, conteúdo de dumps, dados pessoais, `.env`                                                                                                                                                                                                                                |

Arquivo local, inclusive em `/private/tmp`, não está publicado. Sem push autorizado, o checkpoint fica só no worktree
e a diferença deve ser informada.

## Evidências

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

CHECKUP-SYNC-01 / FUNC-READY-02: commit da FUNC-READY-01, atualização dos documentos de continuidade, push
exclusivamente para `integracao/release-preview-01`, verificação de CI e Preview e verificações não destrutivas do
deployment.

## Proibições

Sem merge em `main`, deploy em Production, migration em HML ou Production (046–049 inclusive), limpeza ou escrita
de dados no HML, novo Supabase, novo PR, alteração dos PRs de origem, backups redundantes e force push.

## Bloqueios e riscos

- Decisão comercial da 048 pendente (acima); sem ela, a 048 não vai a ambiente compartilhado.
- Idempotência de adicionais só vale com a 047 no HML; até lá, reenvio após resposta perdida bloqueia e exige conferência.
- Expurgo do HML, 046–049 no HML e cópia independente dos backups seguem com gates próprios.
- Regra permanente: ao concluir ou pausar, toda tarefa atualiza este checkpoint com o que foi executado, o que
  funcionou, o que não funcionou, evidências e ambientes, pendências, próxima ação e o que não está autorizado.

## Retomada

1. `git worktree list` e `git status --short --branch` em `/private/tmp/bs-fin-20d`.
2. Conferir o HEAD remoto: `git ls-remote origin refs/heads/integracao/release-preview-01` e `gh pr view 111`.
3. `git diff --stat c4b4456 HEAD`: se tocar algo além de documentação, as evidências acima não valem.
4. Conferir CI e Preview pelo SHA (`gh pr checks 111`), nunca pela última execução visível.
5. Seguir "Próxima ação exata"; merge e Production seguem sem autorização.
