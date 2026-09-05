# Faturamento não transacional

**Levantado em:** 04/09/2026
**Situação:** diagnóstico apenas. Nada foi corrigido, estornado ou apagado.
**Correção prevista:** após a migração para Next.js estar estável.

## Causa técnica

A geração de fatura, em `src/routes/_authenticated/faturamento.tsx`, executa três
escritas separadas a partir do navegador, sem transação:

```
1. INSERT em invoices          -> devolve invoice.id
2. INSERT em invoice_items     -> em lote
3. UPDATE timesheet_entries    -> SET invoice_id
```

Se qualquer passo falhar — queda de rede, aba fechada, recusa da RLS — os
anteriores permanecem gravados. Não há `ROLLBACK`.

Agrava o quadro o fato de `timesheet_entries.invoice_id` ser uma **coluna única**:
um apontamento só consegue apontar para uma fatura. Gerar uma segunda fatura que
cubra o mesmo período **move** o vínculo para a nova e deixa a anterior órfã,
sem que nada no sistema registre que aquilo aconteceu.

Como o apontamento volta a aparecer como faturável enquanto não estiver
vinculado, o mesmo trabalho pode ser cobrado repetidamente.

## Estado observado

Quatro faturas, todas do cliente **Salmonela**, três delas cobrindo exatamente
o mesmo período.

| #   | ID                                     | Período       | Total     | Soma dos itens | Itens | Apontamentos vinculados | Criada   |
| --- | -------------------------------------- | ------------- | --------- | -------------- | ----- | ----------------------- | -------- |
| 1   | `d5bb5206-ffb9-477a-af9a-df199760dca7` | 01/09 a 30/09 | R$ 0,00   | R$ 0,00        | 1     | **0 — órfã**            | 12:30:44 |
| 2   | `7aa38d0f-d765-4fa9-af6c-b3a03f8483da` | 01/09 a 30/09 | R$ 0,00   | R$ 0,00        | 1     | **0 — órfã**            | 12:33:26 |
| 3   | `4528e427-beae-4dfc-b0c6-90a9630df4c7` | 01/09 a 30/09 | R$ 264,38 | R$ 264,38      | 2     | **0 — órfã**            | 12:37:29 |
| 4   | `e66e6b17-09e4-46a6-8a89-19707cf82295` | 01/09 a 11/09 | R$ 264,38 | R$ 264,38      | 2     | 1                       | 13:03:53 |

Todas com situação `closed`.

### Faturas órfãs

As faturas **1, 2 e 3** não têm nenhum apontamento vinculado. Existem como
documento fechado, mas nada no banco diz qual trabalho elas cobrem.

### Períodos sobrepostos

As faturas 1, 2 e 3 cobrem **01/09 a 30/09**. A fatura 4 cobre **01/09 a 11/09**,
contida inteiramente dentro do intervalo das outras três. As quatro se sobrepõem
no mesmo cliente.

### Apontamento faturado mais de uma vez

| Colaborador | Data       | Valor     | Fatura vinculada hoje | Faturas que cobrem a data |
| ----------- | ---------- | --------- | --------------------- | ------------------------- |
| Felipe      | 04/09/2026 | R$ 264,38 | `e66e6b17…`           | **4**                     |

O mesmo dia de trabalho está no intervalo das quatro faturas. Somando os
documentos emitidos, ele foi cobrado quatro vezes, embora só a última mantenha
o vínculo.

### Faturas com total zerado

As faturas 1 e 2 têm total R$ 0,00 e um item cada. Estado parcial: nem
completo nem revertido.

## Como reproduzir

1. Gerar fatura para um cliente num período com apontamentos.
2. Gerar de novo, mesmo cliente, mesmo período.
3. A segunda fatura assume o vínculo dos apontamentos e a primeira fica órfã.

## Direção da correção

Substituir as três escritas por uma função no Postgres, `SECURITY DEFINER`, que
faça tudo em uma transação: valide que o chamador é admin, recuse apontamento já
vinculado a fatura não cancelada, calcule os valores no servidor em vez de
confiar no que o navegador enviou, grave fatura, itens e vínculos, e desfaça
tudo em caso de erro.

Vale reavaliar também se `timesheet_entries.invoice_id` deve continuar sendo
uma coluna única ou virar uma tabela de vínculo, para que o histórico de
faturamento de um apontamento não seja sobrescrito silenciosamente.

Testes a criar junto: sucesso, rollback em falha, apontamento já faturado,
usuário sem permissão e tentativa de faturamento duplicado.

## Reincidência observada horas depois

O mesmo comportamento voltou a acontecer no mesmo dia, com duas faturas geradas
às 14:47 e às 16:49.

Antes delas, a fatura `e66e6b17…` (criada 13:03) era a única com apontamento
vinculado. Depois, ficou com **zero**: a fatura `a76268d8…`, criada às 16:49
para o mesmo cliente e período sobreposto, **moveu o vínculo para si**.

O número de faturas órfãs passou de **3 para 4**.

| Momento                      | Faturas | Órfãs |
| ---------------------------- | ------- | ----- |
| Primeiro diagnóstico         | 4       | 3     |
| Depois de mais duas gerações | 6       | 4     |

Isto confirma, com um segundo caso e sem nenhuma intervenção no banco, que
gerar uma fatura sobre período já faturado **desliga silenciosamente a fatura
anterior** do trabalho que ela cobre. Nada na interface avisa, e a fatura antiga
continua existindo como documento fechado, agora sem lastro.

Vale notar a velocidade com que o problema se acumula: em poucas horas de uso
normal foram geradas seis faturas para seis apontamentos, quatro delas órfãs.
Não é um caso raro que exige condição incomum — acontece no uso corriqueiro.
