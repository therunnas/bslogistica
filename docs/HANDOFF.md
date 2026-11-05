# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Etapa                     | FIN-PR-12 — exportação Excel no modelo do cliente (Dynamis)                          |
| Gate atual                | Gate 2 concluído — CI verde no HEAD do PR #99; aguarda revisão independente          |
| Último gate concluído     | Gate 2 — validação local e CI no `HEAD validado`                                     |
| Worktree                  | `/private/tmp/bs-fin-pr-12`                                                          |
| Branch                    | `feat/fin-pr-12-exportacao-dynamis`                                                  |
| Base                      | `314c08cb20e9a32dd10b4a0665e1be7dad108264` (`origin/main`)                           |
| HEAD validado             | `5e7063188f7462c4443dac233fe568166cf8dd98`; local = remoto; CI run 42038640093 verde |
| Alterações não commitadas | Nenhuma; este checkpoint vai no commit seguinte ao validado                          |
| PR                        | [#99 — Draft](https://github.com/therunnas/bslogistica/pull/99)                      |
| Ambiente-alvo             | Nenhum ambiente remoto alterado; CI e Preview automáticos do PR                      |
| Última ação comprovada    | PR #99 aberto; CI verde; Preview `dpl_8S7q95qJ3nUMyJAnDj2L8E51gzkQ` pronto (SSO)     |
| Próxima ação exata        | Revisão independente do PR #99; merge só com autorização; depois FIN-PR-13           |

## Evidências

- HEAD validado localmente: `145666a` (commit `feat(fechamento): add client XLSX
export (Dynamis model)`). A CI do HEAD publicado entra no checkpoint seguinte.
- Funcionalidade: botão "Excel do cliente (.xlsx)" no Fechamento →
  `POST /api/fechamento/xlsx-cliente` → `gerarXlsxDoCliente`. Detalhes no
  [Estado do projeto](ESTADO_DO_PROJETO.md#fin-pr-12--excel-do-cliente-modelo-dynamis-05112026).
- Arquivos: `src/lib/fechamento/exportacao-cliente.ts` (modelo e conferência),
  `src/lib/fechamento/xlsx-cliente.ts` (arquivo), rota
  `src/app/api/fechamento/xlsx-cliente/route.ts`, `download.ts` (rota por modelo),
  `_exportar.tsx` (botão), `xlsx.ts` (só exporta auxiliares).
- Testes locais: `test:fechamento-xlsx-cliente` 92/92 (fixture sintética, total
  conferido à mão R$ 2.259,32); mutação "adicional fora do total" barrada;
  `test:fechamento-xlsx` 279/279; 65/65 suítes `test:*`; lint, `tsc`, Prettier,
  `git diff --check` e `npm run build` com variáveis inertes da CI.
- CI run 42038640093 em `5e70631`: `validar` (lint, `tsc`, `test:fechamento-xlsx`,
  `test:fechamento-xlsx-cliente`, demais suítes e build) e `sql-local` verdes.
  Preview `dpl_8S7q95qJ3nUMyJAnDj2L8E51gzkQ` READY, protegido por SSO; navegação
  não executada.
- Não executado: conferência no Microsoft Excel real (automação local não abriu
  a pasta por diálogo do aplicativo) e qualquer teste com dados do HML.

## Migrations por ambiente

- Esta tarefa não cria nem aplica migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045 (aplicada em 05/11/2026, registro no PR #98).
- Production `ehkduqokntemtmqzdrbd`: 034.

## Autorizações

- sessão 06: implementar FIN-PR-12, branch/worktree isolados, testes, lint,
  TypeScript, build, commits, push, PR Draft, conferir CI e Preview, corrigir
  falhas do próprio PR e atualizar documentação.

## Proibições

- sem merge;
- sem alterar Production, migrations remotas, credenciais ou ambientes;
- sem alterar regras financeiras aprovadas;
- sem iniciar FIN-PR-13 antes de autorização;
- sem criar contas de teste.

## Bloqueios e riscos

- PR #98 (documental, Draft) e este PR alteram `HANDOFF.md`, `PROGRESS.md` e
  `ESTADO_DO_PROJETO.md`: o segundo a ser integrado precisa reconciliar esses três
  arquivos, preservando os fatos dos dois;
- fórmulas sem resultado gravado: dependem do recálculo ao abrir (pedido no
  arquivo); visualizadores que não calculam mostram o subtotal vazio;
- conciliação do Fechamento com o banco "não confere" não bloqueia o arquivo do
  cliente (o interno também não bloqueia); a tela mostra o alerta crítico;
- homologação de FIN-PR-11 e FIN-PR-12 pendente, prevista para depois do
  FIN-PR-13;
- merge em `main` publica Production antes da CI; contenção administrativa
  pendente.

## Retomada

Sequência: **FIN-PR-12 (revisão e merge autorizado) → FIN-PR-13 → homologação
completa E2E → manual de utilização → preparação de Production**.

1. Reconciliar Git e GitHub conforme
   [Transferência entre agentes](WORKFLOW.md#reconciliação-na-retomada).
2. Conferir que o PR #99 continua no HEAD validado, com CI verde.
3. Pedir revisão independente; merge só com autorização explícita.
4. Abrir o arquivo de fixture no Excel na homologação e conferir SUBTOTAL com
   filtro por colaborador.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
