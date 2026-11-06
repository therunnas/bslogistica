# Padrão de prompts para agentes

Formato obrigatório dos prompts enviados ao Codex CLI, ao Claude Code ou a outro
agente que trabalhe neste repositório. O prompt **define o escopo e a autorização
da sessão**; não substitui os gates de [WORKFLOW.md](WORKFLOW.md) nem as regras
permanentes de `AGENTS.md` e `CLAUDE.md`, que prevalecem em caso de conflito.

## Prompt único e completo

Cada sessão recebe **um único prompt autossuficiente**. O agente não depende de
conversa anterior, memória da ferramenta ou mensagens complementares para saber o
que fazer: tudo o que não está no prompt vem do repositório, do
[HANDOFF](HANDOFF.md) e do estado real de Git/GitHub.

Mensagem enviada no meio da sessão só altera o escopo se for explícita; na
dúvida, vale o prompt original.

## Cabeçalho obrigatório

O cabeçalho fica fora do bloco de código; o prompt de execução fica em um único
bloco copiável. MODELO, EFFORT, ETAPA e SESSÃO são obrigatórios; ESTILO e SKILL
são usados quando aplicáveis. A tabela descreve os campos:

| Campo    | Conteúdo                                                                            | Exemplo                              |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| `MODELO` | Agente e modelo que executam a sessão                                               | `Claude Code — Opus 5.5`             |
| `EFFORT` | Nível de raciocínio pedido ao agente                                                | `high`                               |
| `ETAPA`  | Identificador da tarefa e gate de [WORKFLOW.md](WORKFLOW.md) em que a sessão atua   | `FIN-PR-11 — Gate 4, preparação HML` |
| `ESTILO` | Papel e forma de trabalho: execução, revisão independente, diagnóstico ou documento | `Execução autônoma por PR`           |
| `SKILL`  | Skills ou procedimentos que o agente deve carregar; `nenhuma` quando não houver     | `test-driven-development`            |
| `SESSÃO` | Número sequencial da sessão dentro da etapa                                         | `03`                                 |

Campo obrigatório ausente ou vazio torna o prompt incompleto: o agente registra a lacuna e
segue a interpretação mais conservadora, sem ampliar autorização.

## Corpo obrigatório

Depois do cabeçalho, nesta ordem:

1. **Contexto Git:** repositório, PR (se houver), branch, worktree e HEAD de
   referência com SHA completo.
2. **Autorização:** o que pode ser feito, com ambiente-alvo nominal (local, CI,
   Preview, HML, Production) e condições — por exemplo, "merge somente se o HEAD
   for `<sha>` e a CI estiver verde".
3. **Proibido:** o que não pode ser feito nesta sessão, mesmo que tecnicamente
   possível.
4. **Etapas numeradas:** retomada, trabalho, validação, checkpoint.
5. **Critérios de validação:** comandos e evidências que encerram a sessão.
6. **Relatório final:** itens que a resposta precisa trazer.

## Execução autônoma por PR

Dentro da autorização do prompt, o agente executa a etapa de ponta a ponta — da
retomada ao checkpoint — sem pedir confirmação a cada passo. Um prompt cobre no
máximo **um PR**; trabalho de outro PR é outra sessão.

O agente **para e pergunta** apenas quando:

- a próxima ação exige autorização que o prompt não deu;
- o estado real diverge do prompt ou do HANDOFF de forma material;
- há ambiguidade que muda arquitetura, dado, contrato ou resultado financeiro;
- uma verificação falha e a correção sairia do escopo.

Autonomia **não atravessa gates**. Preview com banco, migration em HML,
homologação, merge, Production e ativação de flag exigem autorização nominal no
prompt, para o ambiente e o SHA indicados. CI verde não é homologação; merge não
autoriza Production. Autorização de uma sessão não vale para a seguinte.

## Critérios de validação

A sessão só se declara concluída com evidência, vinculada ao SHA ou ao working
tree em que rodou:

- teste RED antes de mudar comportamento executável, depois GREEN;
- `npm run lint`, `npx tsc --noEmit`, `npm run check:workflow` e as suítes
  `test:*` exigidas pelo escopo (todas, quando tocar aplicação, auth ou telas);
- Prettier dos arquivos alterados e `git diff --check`;
- build e SQL local quando aplicáveis, ou o motivo de não terem rodado;
- CI conferida no HEAD exato depois de cada push;
- homologação só com execução real no navegador, no ambiente autorizado.

Teste não executado não é PASS. Falha de infraestrutura é registrada como tal.

## Atualização do HANDOFF

Toda sessão termina atualizando o [HANDOFF](HANDOFF.md) conforme a
[transferência entre agentes](WORKFLOW.md#transferência-entre-agentes):
worktree, branch, `HEAD validado`, alterações não commitadas, último gate
concluído, testes por SHA, próxima ação autorizada, proibições e bloqueios.
Commit e push do checkpoint seguem a autorização do prompt.

## Modelo

MODELO: <agente — modelo>

EFFORT: <low | medium | high | xhigh | max>

ETAPA: <ID da tarefa> — <gate>

SESSÃO: <NN>

ESTILO: <quando aplicável>

SKILL: <quando aplicável>

```text
REPOSITÓRIO: therunnas/bslogistica
PR: <#n ou "nenhum">
BRANCH: <branch>
WORKTREE: <caminho absoluto>
HEAD DE REFERÊNCIA: <SHA completo>

AUTORIZAÇÃO:
<ações permitidas, ambiente-alvo e condições>

PROIBIDO:
<ações vedadas nesta sessão>

ETAPAS:
1. Retomada — ler instruções, HANDOFF e reconciliar Git/GitHub.
2. <trabalho>
3. Validação — <critérios>
4. Checkpoint — atualizar HANDOFF.

RELATÓRIO FINAL:
- <itens obrigatórios>
```
