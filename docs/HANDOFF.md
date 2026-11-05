# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| Etapa                     | WORKFLOW-01 — padronização definitiva do desenvolvimento                 |
| Gate atual                | Revisão R1 concluída; aguardando autorização de merge do PR #97          |
| Último gate concluído     | Gate 2 — validação local e CI no `HEAD validado`                         |
| Worktree                  | `/private/tmp/bs-workflow-01`                                            |
| Branch                    | `docs/workflow-01`                                                       |
| Base                      | `eb8cec9af11c4b0e314296ed776caf15c3764b5f` (`origin/main`)               |
| HEAD validado             | `4e3b0ab565635fd1a7af894983f953975c48db25`; local = remoto no checkpoint |
| Alterações não commitadas | Nenhuma                                                                  |
| PR                        | [#97 — Draft](https://github.com/therunnas/bslogistica/pull/97)          |
| Ambiente-alvo             | Nenhum ambiente remoto; somente repositório e CI sem secrets             |
| Última ação comprovada    | Ajustes R1 em `4e3b0ab`, CI verde (run 42023101884)                      |
| Próxima ação exata        | Usuário decide o merge do PR #97; até lá, Draft e sem merge              |

## Evidências

- PR #96 mergeado por squash; `main` em `eb8cec9…` no preflight.
- Production Vercel publicou o merge antes de a CI de `main` terminar.
- `main` sem proteção/ruleset/check obrigatório na verificação de 05/11/2026.
- Supabase HML e Production distintos, ambos com migration head 034.
- Migrations 035–045 pendentes remotamente; migration 045 presente no Git.
- Nenhuma homologação real dos Containers foi comprovada.
- Commit `ae2f319` (sessão 01): TDD documental RED 2/4 e GREEN 4/4; 64 scripts
  `test:*`, lint, TypeScript, Prettier, check documental e `git diff --check`
  passaram localmente. Build Turbopack local bloqueado por `Operation not
permitted` ao abrir porta interna; build Webpack local passou.
- `0e1848a`, CI run 42019884284: `validar` (lint, TypeScript, `check:workflow`,
  `test:workflow`, todas as suítes Node e build padrão) e `sql-local` com
  sucesso. O build padrão está comprovado na CI, não localmente.
- Revisão R1 (sessão 02, Claude Code): faltavam worktree, HEAD local/remoto,
  alterações não commitadas, último gate e checkpoint de transferência entre
  agentes. Ajustes em `WORKFLOW.md`, `AGENTS.md`, `CLAUDE.md`, neste arquivo e no
  validador documental; RED 1/5 pelo campo `Worktree` ausente antes do GREEN.
- `4e3b0ab`: localmente GREEN 5/5, `check:workflow`, 64/64 `test:*`, lint,
  TypeScript, Prettier e `git diff --check`; build local não executado. CI run
  42023101884: `validar` (inclui build padrão) e `sql-local` com sucesso.

## Migrations por ambiente

- Local/CI: migrations até 045 versionadas e anteriormente testadas em instâncias
  descartáveis; nenhum banco local foi resetado por WORKFLOW-01.
- HML `qbnfcmrxmssnwkhaitgd`: migration remota mais recente 034.
- Production `ehkduqokntemtmqzdrbd`: migration remota mais recente 034.
- Não aplicar migrations nesta tarefa. A preparação de HML é o próximo trabalho
  após a integração de WORKFLOW-01 e exige autorização específica.

## Autorizações

- editar documentação, template de PR e checks locais/CI sem credenciais;
- commits e push normal em `docs/workflow-01`, com testes verdes;
- consultar fatos mutáveis em modo somente leitura.

## Proibições

- sem merge ou Ready for Review;
- sem alteração de GitHub/Vercel/Supabase remoto;
- sem migration, SQL remoto, deploy ou mudança de variável/flag;
- sem regra financeira, Auth, RLS, RPC ou faturamento;
- sem iniciar FIN-PR-12 ou FIN-PR-13.

## Bloqueios e riscos

- merge em `main` ainda pode publicar Production automaticamente; a contenção é
  configuração administrativa futura, não parte deste PR. O próprio merge do
  PR #97 dispara novo deploy de Production, com código de aplicação igual ao de
  `eb8cec9`;
- vínculo exato Preview ↔ HML e escopos de variáveis Vercel permanecem pendentes
  de conferência autenticada;
- HML está 11 migrations atrás do Git e não deve receber somente a 045;
- backup/restauração integral de HML precisa ser comprovado antes da implantação.

## Retomada

Sequência preservada: **WORKFLOW-01 → preparação de HML → homologação de
Containers (FIN-PR-11) → FIN-PR-12 → FIN-PR-13**.

1. Reconciliar Git e GitHub conforme
   [Transferência entre agentes](WORKFLOW.md#reconciliação-na-retomada).
2. Confirmar que WORKFLOW-01 continua sendo a única tarefa ativa e que os checks
   do HEAD exato do PR #97 estão verdes.
3. Merge do PR #97 só com autorização explícita do usuário.
4. Integrado o PR, solicitar autorização separada para preparar HML (035–045) e
   homologar FIN-PR-11 Containers; não iniciar FIN-PR-12/13 antes disso.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
