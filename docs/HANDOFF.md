# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md).

## Identificação

| Campo                  | Valor                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Etapa                  | WORKFLOW-01 — padronização definitiva do desenvolvimento                   |
| Gate atual             | PR Draft aberto; aguardar CI e revisão independente                        |
| Branch                 | `docs/workflow-01`                                                         |
| Base                   | `eb8cec9af11c4b0e314296ed776caf15c3764b5f` (`origin/main`)                 |
| PR                     | [#97 — Draft](https://github.com/therunnas/bslogistica/pull/97)            |
| Ambiente-alvo          | Nenhum ambiente remoto; somente repositório e CI sem secrets               |
| Última ação comprovada | Commits `9926622` e `ae2f319` publicados; PR #97 Draft aberto              |
| Próxima ação exata     | Conferir CI do novo HEAD e solicitar revisão independente; não fazer merge |

## Evidências

- PR #96 mergeado por squash; `main` em `eb8cec9…` no preflight.
- Production Vercel publicou o merge antes de a CI de `main` terminar.
- `main` sem proteção/ruleset/check obrigatório na verificação de 05/11/2026.
- Supabase HML e Production distintos, ambos com migration head 034.
- Migrations 035–045 pendentes remotamente; migration 045 presente no Git.
- Nenhuma homologação real dos Containers foi comprovada.
- TDD documental: RED com 2/4 testes falhando pelo motivo esperado; GREEN 4/4.
- Todos os 64 scripts Node `test:*`, lint, TypeScript, Prettier, check documental
  e `git diff --check` passaram.
- Build padrão Turbopack ficou bloqueado por `Operation not permitted` ao abrir
  porta interna, inclusive fora da sandbox. Build alternativo Webpack passou; o
  build padrão da CI do PR é evidência separada e ainda precisa ser conferido.

## Migrations por ambiente

- Local/CI: migrations até 045 versionadas e anteriormente testadas em instâncias
  descartáveis; nenhum banco local foi resetado por WORKFLOW-01.
- HML `qbnfcmrxmssnwkhaitgd`: migration remota mais recente 034.
- Production `ehkduqokntemtmqzdrbd`: migration remota mais recente 034.
- Não aplicar migrations nesta tarefa. A preparação de HML é o próximo trabalho
  após a integração de WORKFLOW-01 e exige autorização específica.

## Autorizações

- editar documentação, template de PR e checks locais/CI sem credenciais;
- criar branch, commits, push normal e PR Draft;
- consultar fatos mutáveis em modo somente leitura.

## Proibições

- sem merge ou Ready for Review;
- sem alteração de GitHub/Vercel/Supabase remoto;
- sem migration, SQL remoto, deploy ou mudança de variável/flag;
- sem regra financeira, Auth, RLS, RPC ou faturamento;
- sem iniciar FIN-PR-12 ou FIN-PR-13.

## Bloqueios e riscos

- merge em `main` ainda pode publicar Production automaticamente; a contenção é
  configuração administrativa futura, não parte deste PR;
- vínculo exato Preview ↔ HML e escopos de variáveis Vercel permanecem pendentes
  de conferência autenticada;
- HML está 11 migrations atrás do Git e não deve receber somente a 045;
- backup/restauração integral de HML precisa ser comprovado antes da implantação.

## Retomada

1. Ler [WORKFLOW.md](WORKFLOW.md) e [AMBIENTES.md](AMBIENTES.md).
2. Conferir `git status`, `git rev-parse HEAD`, `origin/main` e o PR deste handoff.
3. Confirmar que WORKFLOW-01 continua sendo a única tarefa ativa e revisar os
   checks do HEAD exato do PR #97.
4. Se o PR estiver integrado com autorização, solicitar autorização separada
   para preparar HML e homologar
   FIN-PR-11 Containers; não iniciar FIN-PR-12/13 antes disso.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
