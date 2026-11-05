# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | FIN-PR-12 — exportação Excel no modelo do cliente (Dynamis)                                                             |
| Gate atual                | Gate 2 — #99 reconciliado com a `main` após o #98; revisão independente e CI do HEAD em andamento                       |
| Último gate concluído     | Gate 2 — validação local e CI (CI do HEAD R1 a registrar no checkpoint seguinte)                                        |
| Worktree                  | `/private/tmp/bs-fin-pr-12`                                                                                             |
| Branch                    | `feat/fin-pr-12-exportacao-dynamis`                                                                                     |
| Base                      | `a2fec9a3f336bec3cbf8d53cd35880a4625370de` (`origin/main`, merge do PR #98)                                             |
| HEAD validado             | `6452a95160847f57a251da67088e84fcb1e9adcb` (CI run 42041943752 verde); o merge da `main` que segue só traz documentação |
| Alterações não commitadas | Nenhuma; este checkpoint vai no commit seguinte ao validado                                                             |
| PR                        | [#99 — Draft](https://github.com/therunnas/bslogistica/pull/99)                                                         |
| Ambiente-alvo             | Nenhum ambiente remoto alterado; CI e Preview automáticos do PR                                                         |
| Última ação comprovada    | PR #98 mergeado (`a2fec9a`); `origin/main` mesclada no #99 com os 3 documentos reconciliados                            |
| Próxima ação exata        | Aprovação do merge do PR #99 pelo usuário; depois FIN-PR-13                                                             |

## Evidências

- Funcionalidade: botão "Excel do cliente (.xlsx)" no Fechamento →
  `POST /api/fechamento/xlsx-cliente` → `gerarXlsxDoCliente`. Detalhes no
  [Estado do projeto](ESTADO_DO_PROJETO.md#fin-pr-12--excel-do-cliente-modelo-dynamis-05112026).
- Arquivos: `src/lib/fechamento/exportacao-cliente.ts` (modelo e conferência),
  `src/lib/fechamento/xlsx-cliente.ts` (arquivo), rota
  `src/app/api/fechamento/xlsx-cliente/route.ts`, `download.ts` (rota por modelo),
  `_exportar.tsx` (botão), `xlsx.ts` (só exporta auxiliares).
- Implementação (`145666a`, CI run 42038640093 em `5e70631`): suíte nova 92/92,
  mutação "adicional fora do total" barrada, `test:fechamento-xlsx` 279/279, 65/65
  suítes, lint, `tsc`, build. Preview `dpl_8S7q95qJ3nUMyJAnDj2L8E51gzkQ` READY (SSO).
- R1 (sessão 07, mesmo agente que implementou): sem achado crítico ou alto.
  Corrigidos o rótulo "Serviço avulso" → "Adicional de serviço" (vocabulário único
  do projeto) e o status da recusa por soma divergente (500 → 422
  `dado-inconsistente`), com RED 5/95 antes do GREEN 95/95. A rota do cliente
  entrou na suíte de compatibilidade: cópia isolada, schemas 034 → 045, 685
  asserções, 0 falhas; na 034 de Production a rota responde 200 com total igual à
  receita do `GET`. 65/65 suítes, lint, `tsc`, Prettier e diff check.
- Não executado: Excel real (automação de interface não autorizada nesta sessão)
  e qualquer teste com dados do HML.

## Migrations por ambiente

- Esta tarefa não cria nem aplica migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045 (aplicada em 05/11/2026); evidências de backup,
  restauração e aplicação em
  [Estado do projeto](ESTADO_DO_PROJETO.md#fin-pr-11--evidências-de-backup-restauração-e-migrations-no-hml-05112026).
- Production `ehkduqokntemtmqzdrbd`: 034. O Excel do cliente funciona na 034
  (compatibilidade H2b/H2c).

## Integração com o PR #98 (executada na sessão 08)

1. PR #98 mergeado por squash em `a2fec9a` (05/11/2026 14:14:04 UTC), condicionado
   ao head `7b6c8c7` com CI verde.
2. `origin/main` mesclada neste PR com commit de merge normal (sem rebase nem force
   push). Conflitos só em `HANDOFF.md`, `PROGRESS.md` e `ESTADO_DO_PROJETO.md`.
3. `ESTADO_DO_PROJETO.md`: versão da `main` mais a seção do FIN-PR-12; as evidências
   do HANDOFF do #98 (backup e SHA-256, guarda, restauração, aplicação em HML e
   roteiro dos Containers) foram transferidas na íntegra para uma seção própria.
4. `PROGRESS.md`: tarefa ativa FIN-PR-12/13 conforme a decisão do usuário; marcos do
   #98 preservados.
5. `HANDOFF.md`: este checkpoint.

## Autorizações

- sessão 06: implementar FIN-PR-12, testes, commits, push, PR Draft, CI e Preview.
- sessão 07: revisão R1, correções e testes no PR #99, push; preparar a integração
  sem merge.
- sessão 08: merge do PR #98 (inclui o deploy automático de Production dele);
  reconciliar o #99, revisão por outro agente, correções, commits e push no #99.
  **Merge do #99 não autorizado.**

## Proibições

- sem merge;
- sem alterar Production, migrations remotas, credenciais ou ambientes;
- sem alterar regras financeiras aprovadas;
- sem iniciar FIN-PR-13 antes de autorização;
- sem criar contas de teste.

## Bloqueios e riscos

- revisão R1 feita pelo mesmo agente que implementou: falta revisão independente
  de outro agente ou pessoa sobre o HEAD exato;
- fórmulas sem resultado gravado: dependem do recálculo ao abrir;
  visualizadores que não calculam mostram o subtotal vazio;
- conciliação "não confere" não bloqueia o arquivo do cliente (como o interno);
- Excel real e homologação de FIN-PR-11/FIN-PR-12 pendentes, previstos para a
  homologação completa depois do FIN-PR-13;
- merge em `main` publica Production antes da CI; contenção administrativa
  pendente.

## Retomada

Sequência: **merge autorizado do #99 → FIN-PR-13 → homologação
completa E2E → manual de utilização → preparação de Production**.

1. Reconciliar Git e GitHub conforme
   [Transferência entre agentes](WORKFLOW.md#reconciliação-na-retomada).
2. Conferir que o PR #99 continua no HEAD validado, com CI verde.
3. Merge do #99 só com autorização explícita.
4. Na homologação, abrir o Excel do cliente no Excel real e conferir o SUBTOTAL
   com filtro por colaborador.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
