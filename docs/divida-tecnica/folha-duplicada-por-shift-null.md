# Folha duplicada quando o turno é nulo

**Levantado em:** 04/09/2026
**Situação:** diagnóstico apenas. Nada foi corrigido.
**Correção prevista:** depois da migração para Next.js.

## Causa técnica

A tela de apontamentos procura a folha existente por três campos:

```js
(timesheets.data ?? []).find(
  (t) =>
    t.operation_id === operationId &&
    t.work_date === date &&
    (t.shift_id ?? "") === (shiftId ?? ""),
);
```

`timesheets.shift_id` aceita `NULL`, e a tela grava `shift_id: shiftId || null` — ou
seja, uma folha salva antes de a lista de turnos carregar fica com `NULL`.

Como a comparação normaliza `NULL` para string vazia, uma folha com `shift_id`
nulo **nunca casa** com uma seleção de turno válida. O código então segue para o
ramo que cria uma folha nova, em vez de reaproveitar a existente.

Resultado: duas folhas para a mesma operação e a mesma data, uma com turno nulo
e outra com turno preenchido. O banco não impede — não há restrição de
unicidade sobre `(operation_id, work_date, shift_id)`.

## Estado observado

Reproduzido em 04/09/2026, na operação de teste "Op. salmo":

| Folha       | Criada   | `shift_id`  | Apontamento                             |
| ----------- | -------- | ----------- | --------------------------------------- |
| `dce2c888…` | 13:56:46 | **NULL**    | Felipe, saída 15:00, 480 min, R$ 180,00 |
| `661a43e6…` | 14:05:56 | `224aeafe…` | Felipe, saída 17:30, 630 min, R$ 264,38 |

Mesma operação, mesma data, mesmo colaborador. Felipe aparece duas vezes no
mesmo dia, somando **R$ 444,38** por uma única jornada.

## Impacto financeiro

O apontamento é a origem da diária faturável. Duas folhas para o mesmo dia
significam duas diárias contadas para o mesmo colaborador: o cliente pode ser
cobrado em dobro, e o custo de mão de obra aparece inflado no dashboard e nos
relatórios.

O erro é silencioso. Nada na interface avisa que já existe folha para aquele dia.

## Como reproduzir

1. Abrir apontamentos numa operação cuja lista de turnos ainda não carregou.
2. Salvar — a folha nasce com `shift_id` nulo.
3. Recarregar, com o turno já selecionado, e salvar de novo.
4. Uma segunda folha é criada, em vez de a primeira ser atualizada.

## Direção da correção

Três frentes, que se somam:

- **No banco:** índice único sobre `(operation_id, work_date, shift_id)`, tratando
  nulos de forma explícita. É a única barreira que não depende do frontend.
- **Na tela:** não permitir salvar sem turno selecionado, quando a operação tem
  turnos cadastrados.
- **Na busca:** decidir se folha com turno nulo deve casar com qualquer turno,
  em vez de com nenhum.

Conferir antes se existem folhas duplicadas em produção, e como consolidá-las
sem perder apontamento.

## Agravante: a duplicata não tem como ser desfeita

A tela de apontamentos **não oferece exclusão**. Não há botão, e não há código —
enquanto clientes, colaboradores e operações usam `useDeleteRow`, a tela de
apontamentos não a importa nenhuma vez:

| Tela             | ocorrências de `useDeleteRow` |
| ---------------- | ----------------------------- |
| clientes         | 3                             |
| colaboradores    | 2                             |
| operações        | 4                             |
| **apontamentos** | **0**                         |

Folha e apontamento, uma vez criados, só podem ser editados. Nunca removidos.

Na prática, uma folha duplicada é **permanente**: segue contando diária em dobro
no dashboard, nos relatórios e no faturamento, e não há caminho pela interface
para corrigi-la.

O único jeito de removê-la hoje é apagar a **operação** inteira, o que dispara a
cascata do banco:

```
timesheets.operation_id        -> operations  ON DELETE CASCADE
timesheet_entries.timesheet_id -> timesheets  ON DELETE CASCADE
shifts.operation_id            -> operations  ON DELETE CASCADE
```

Isso apaga junto todas as folhas, apontamentos e turnos daquela operação —
inclusive os corretos. Serve para descartar dados de teste, não para corrigir um
registro em produção.

Vale notar que `invoice_items.operation_id` é `ON DELETE SET NULL`: apagar uma
operação já faturada deixa itens de fatura órfãos, apontando para nada. Some com
a origem do que foi cobrado.

Portanto, a correção precisa incluir uma forma de excluir ou cancelar folha e
apontamento pela interface, com as devidas restrições — por exemplo, impedir a
exclusão de apontamento já vinculado a fatura.
