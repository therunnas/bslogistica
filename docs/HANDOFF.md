# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Etapa                     | FIN-PR-13 — testes integrados e conciliação financeira                                                 |
| Gate atual                | Implementação e validação local concluídas; preparar commit, push e PR Draft                           |
| Último gate concluído     | Matriz local 034 → 045, 66 suítes, lint, TypeScript e build verdes                                     |
| Worktree                  | `/private/tmp/bs-fin-pr-13`                                                                            |
| Branch                    | `feat/fin-pr-13-integracao-conciliacao`                                                                |
| Base                      | `3e5b7b17858fddfcd7fe7f5d96aeff8e6581f420` (`origin/main`, squash do PR #99)                           |
| HEAD validado             | `3e5b7b17858fddfcd7fe7f5d96aeff8e6581f420`; alterações validadas ainda não commitadas neste checkpoint |
| Alterações não commitadas | Sim — implementação e documentação do FIN-PR-13 prontas para commit                                    |
| PR                        | Draft a abrir na branch `feat/fin-pr-13-integracao-conciliacao`                                        |
| Ambiente-alvo             | Nenhum remoto; somente Supabase local descartável e Preview automático futuro                          |
| Última ação comprovada    | Build de produção passou após 66/66 suítes e 697/697 asserções de compatibilidade                      |
| Próxima ação exata        | Revisar diff, commitar, fazer push, abrir PR Draft e conferir CI/Preview                               |

## Evidências

- PR #99: HEAD autorizado `9b98b072a146d347a966c64c7c8c7a57669ed91b`, CI verde,
  mergeável e sem threads; squash em `3e5b7b17858fddfcd7fe7f5d96aeff8e6581f420`.
- Production decorrente exclusivamente do merge: CI run `42051545919` verde;
  deployment `7577211847` em `success`; `/login` 200 e CSP apontando para o projeto
  de Production. Nenhuma migration ou alteração de dados/configuração remota.
- Conciliação: `src/lib/fechamento/conciliacao-comercial.ts` valida proveniência,
  componentes em centavos e diferenças exatas; `scripts/conciliar-fin-pr-13.mjs`
  aceita os três JSON locais e retorna código não zero em divergência.
- TDD: a suíte nasceu RED por módulo ausente e ficou GREEN; cobre total sintético
  R$ 1.135,65, propositalmente diferente da referência Dynamis, erro de um centavo,
  SHA inválido, soma inválida e geração dos dois XLSX.
- Integração local isolada: schemas 034, 037, 038, 039, 040, 041, 042, 043, 044 e
  045; 697 asserções, zero falhas. O cenário 045 registra Containers pela RPC,
  fecha, fatura e exporta pelas rotas reais; nos anteriores a capacidade não existe.
- Validação geral: 66/66 suítes `test:*`, lint, `tsc --noEmit`, workflow documental,
  Prettier e build de produção passaram.
- Planilha original Dynamis: não encontrada nos worktrees nem na pasta local
  autorizada do projeto. A conciliação real de R$ 35.118,12 não foi declarada.

## Migrations por ambiente

- Esta tarefa não cria nem aplica migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045, não acessado nem alterado nesta execução.
- Production `ehkduqokntemtmqzdrbd`: 034, não acessado no banco nem alterado.
- A matriz 034 → 045 usou stack local própria, `project_id` e portas exclusivos.

## Autorizações

- squash merge do PR #99 condicionado ao HEAD exato autorizado, incluindo o deploy
  automático de Production decorrente somente desse merge;
- desenvolver FIN-PR-13, executar testes, criar branch/commits, push e PR Draft;
- corrigir defeitos reais dentro do escopo financeiro integrado.

## Proibições

- sem migration remota, dados de HML/Production, secrets ou configuração remota;
- sem merge do FIN-PR-13 e sem deploy manual de Production;
- sem criar contas de teste remotas;
- sem inventar regra comercial nem usar R$ 35.118,12 como fixture de outra base.

## Bloqueios e riscos

- falta a planilha original Dynamis de 01–15/09/2026 com procedência verificável;
- conciliação real e validação do arquivo no Microsoft Excel continuam pendentes;
- nove fluxos reais de Containers, jornada cadastro → faturamento e matriz de
  segurança/permissões permanecem na homologação completa;
- manual de utilização e preparação de Production 035–045 são gates posteriores;
- merge em `main` publica Production antes da CI; contenção administrativa pendente.

## Retomada

Sequência: **PR Draft FIN-PR-13 → CI/Preview/revisão → homologação completa E2E →
manual de utilização → preparação controlada de Production 035–045**.

1. Confirmar branch, worktree e diff somente do FIN-PR-13.
2. Criar commit e push; abrir PR como Draft, sem merge.
3. Conferir `validar`, `sql-local`, CodeRabbit e Preview no HEAD final.
4. Na homologação posterior, fornecer a planilha original Dynamis, calcular seu
   SHA-256, produzir os JSON de entrada e conciliar componente a componente.
5. Manter as pendências de homologação; não declarar o projeto finalizado.
