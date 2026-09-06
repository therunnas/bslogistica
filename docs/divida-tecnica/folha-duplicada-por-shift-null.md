# Folha duplicada quando o turno é nulo

**Levantado em:** 04/09/2026
**Rediagnosticado em:** 06/09/2026 — parte do diagnóstico original estava errada
**Situação:** RESOLVIDA pela migration `20260906180000_008_unicidade_diaria`
**Escopo:** integridade financeira e regra de negócio. Não é vulnerabilidade de
segurança: nada aqui permite acesso indevido, escalonamento ou vazamento.

## O que o diagnóstico original errou

Duas afirmações de 04/09 não se sustentaram na verificação de 06/09:

**"Não há restrição de unicidade sobre `(operation_id, work_date, shift_id)`."**
Falso — `timesheets_operation_id_shift_id_work_date_key` existe desde a primeira
migration. O problema é outro: ela é **NULLS DISTINCT**, o padrão do Postgres
(`indnullsnotdistinct = false`, conferido no banco). NULL nunca é igual a NULL
para efeito de unicidade, então N folhas `(operação, NULL, data)` sempre foram
aceitas — e `(op, NULL, data)` jamais colide com `(op, turno, data)`.

**"Salvar antes de a lista de turnos carregar cria folha com `shift_id` nulo."**
Já não é verdade. O botão Salvar é bloqueado por `carregando`, que inclui
`shifts.isLoading`. O caminho para uma folha nula deixou de ser a corrida de
carregamento e passou a ser a escolha explícita de "Sem turno definido".

O caso "Op. salmo / Felipe" citado na versão anterior não existe mais: aquelas
tabelas foram zeradas no reset de 05/09.

## Causa real

A invariável que interessa atravessa duas tabelas:

```
operation_id, work_date  ->  timesheets
employee_id, status      ->  timesheet_entries
```

O Postgres não expressa `UNIQUE` entre tabelas, e os uniques existentes resolvem
outra coisa: `(timesheet_id, employee_id)` só olha dentro de uma folha, e
`(operation_id, shift_id, work_date)` garante uma folha por turno — o que é
correto, porque dois turnos no mesmo dia são legítimos.

Somando a isso `calcEntry`, que dá `daily_rate` inteiro a todo lançamento não
`absent`, o mesmo colaborador em dois turnos da mesma operação e data rende
**duas diárias**. Não era preciso `shift_id` nulo para isso: o caminho por turnos
reais era o mais fácil de percorrer, e foi o que aconteceu de verdade.

## Estado observado em 06/09/2026

| | |
| --- | --- |
| Folhas com `shift_id NULL` | 0 |
| Vínculos `operation_team` sem turno | 0 |
| Pares operação+data com folha NULL e folha com turno | nenhum |
| Colaboradores com duas diárias na mesma operação+data | **1** |

O caso real veio por dois turnos reais, não por nulo:

| Colaborador | Data | Operação | Turno | Jornada | Faturado |
| --- | --- | --- | --- | --- | --- |
| Gabriel Jesus Rocha | 05/09/2026 | Itajai ludovic | Matutino | 1200 min | R$ 450,00 |
| Gabriel Jesus Rocha | 05/09/2026 | Itajai ludovic | Noturno | 480 min | R$ 180,00 |

Ambos já faturados, na mesma invoice.

## A invariável adotada

> **Um colaborador gera no máximo UMA diária faturável por operação e data.**
> Trabalhar além da jornada prevista vira **hora extra** no lançamento
> existente, nunca uma segunda diária. Dois turnos no mesmo dia continuam
> válidos — para colaboradores diferentes.

`absent` não conta como diária. `present` e `replacement` contam — o mesmo
recorte que `public.gerar_fatura` usa para faturar, então a função de
faturamento não precisou de nenhuma alteração.

## Como foi corrigido

**No banco, que é onde a garantia mora.** A chave foi desnormalizada para
`timesheet_entries` (`operation_id`, `work_date`), mantida exclusivamente por
trigger `BEFORE INSERT OR UPDATE` que relê a folha pai e **sobrescreve** o que
vier no payload — um POST ao PostgREST informando outra operação tem o valor
substituído. Sobre ela, um índice único parcial:

```sql
CREATE UNIQUE INDEX timesheet_entries_uma_diaria_por_operacao_dia
  ON public.timesheet_entries (employee_id, operation_id, work_date)
  WHERE status <> 'absent' AND id <> '<id legado>';
```

Índice, e não trigger de validação: só o índice é avaliado no commit. Um
`SELECT ... EXISTS` seguido de `INSERT` não é atômico em READ COMMITTED e deixa
duas transações concorrentes passarem — é o que torna o índice a única defesa
que vale contra duas abas, chamada direta à API e concorrência.

Mover a folha pai propaga a chave aos filhos por trigger `AFTER UPDATE`; se a
movimentação criar colisão, o índice recusa e o UPDATE da folha é desfeito na
mesma transação.

**O P1-1 fica fechado pelo mesmo desenho**, porque o índice ignora `shift_id`:
duas diárias para a mesma pessoa/operação/data colidem venha a folha de um turno
real ou de nenhum. Some-se o índice parcial
`timesheets_uma_folha_sem_turno` — `UNIQUE (operation_id, work_date) WHERE
shift_id IS NULL` —, que fecha a duplicação de folha herdada do NULLS DISTINCT.

**Na tela**, três mudanças, todas de UX — a garantia continua sendo o banco:
"Sem turno definido" deixa de ser oferecido quando a operação tem turnos, a menos
que exista contexto sem turno herdado, para que o histórico continue alcançável;
o Salvar é bloqueado, com aviso nomeando colaborador e turno, quando alguém já
tem diária no dia em outra folha; e o `23505` do banco é traduzido para a mesma
mensagem de negócio, em vez de erro técnico.

## Exceção histórica preservada

O lançamento `a453c848-3478-4388-858a-12546103d10b` — Noturno, 480 min,
R$ 180,00, já faturado — é anterior à invariável e está **excluído do índice por
id literal**. Nada nele foi alterado: valores, status, `invoice_id` e os itens da
fatura seguem exatamente como foram cobrados.

O par dele, `5ebf2a8b-cf39-4862-869f-030e7f49377d` (Matutino, 1200 min,
R$ 450,00), permanece **sob** o índice como a diária canônica do dia. O critério
é objetivo: sob a regra nova, a diária é a da maior jornada e o excedente
deveria ter sido hora extra — o excedente é o que sai do índice.

A exclusão vale para aquele id, não para a chave: uma diária **nova** para o
mesmo colaborador, operação e data continua sendo recusada com `23505` (testado).

Acrescentar outro id à exclusão para "resolver" um conflito futuro é contornar a
regra, não aplicá-la. O caminho certo é lançar o período extra como hora extra na
diária existente.

**Pendência comercial, fora do escopo técnico:** sob a regra nova, o correto
teria sido uma diária de R$ 450,00 mais hora extra pelos 480 minutos do Noturno.
A diferença em relação aos R$ 180,00 cobrados se resolve como ajuste em fatura
futura, com a origem registrada — nunca reescrevendo o que já foi faturado.

## O que continua em aberto

**A conversão não é automática.** O índice **impede** a segunda diária, mas não
**transforma** as horas do segundo turno em extra. Hoje `calcEntry` compara o
trabalhado com a jornada do turno selecionado; com um lançamento só, as horas do
outro turno precisam entrar como excedente do lançamento existente. Isso é
decisão de produto — qual turno hospeda o lançamento e como a tela oferece somar
horas de outro turno — e ainda não foi implementado.

**Exclusão de folha e apontamento continua não existindo** na interface, como
apontado na versão anterior deste documento e ainda válido: a tela de
apontamentos não importa `useDeleteRow` nenhuma vez. Uma folha criada por engano
segue sem caminho de correção pela tela. A cascata por exclusão da operação
(`ON DELETE CASCADE` em `timesheets` e `timesheet_entries`) apaga também o que
está correto, e `invoice_items.operation_id` é `ON DELETE SET NULL` — apagar
operação já faturada deixa item de fatura órfão. Serve para descartar dado de
teste, não para corrigir produção.
