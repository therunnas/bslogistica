# Faturamento não transacional

**Levantado em:** 04/09/2026
**Situação:** **RESOLVIDA** em 05/09/2026 — corrigida e validada ponta a ponta,
no banco e pela interface.
**Gravidade original:** alta — cobrava o mesmo trabalho mais de uma vez, sem
aviso e sem rastro.

O diagnóstico e as evidências de 04/09 estão preservados na íntegra abaixo. As
seções de correção vêm em seguida.

## Causa técnica

A geração de fatura, na tela de faturamento (à época em
`src/routes/_authenticated/faturamento.tsx`, caminho do projeto anterior ao Next.js),
executava três escritas separadas a partir do navegador, sem transação:

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

Quatro faturas, todas de um mesmo cliente de teste, três delas cobrindo exatamente
o mesmo período.

| #   | Fatura   | Período       | Total     | Soma dos itens | Itens | Apontamentos vinculados | Criada   |
| --- | -------- | ------------- | --------- | -------------- | ----- | ----------------------- | -------- |
| 1   | fatura 1 | 01/09 a 30/09 | R$ 0,00   | R$ 0,00        | 1     | **0 — órfã**            | 12:30:44 |
| 2   | fatura 2 | 01/09 a 30/09 | R$ 0,00   | R$ 0,00        | 1     | **0 — órfã**            | 12:33:26 |
| 3   | fatura 3 | 01/09 a 30/09 | R$ 264,38 | R$ 264,38      | 2     | **0 — órfã**            | 12:37:29 |
| 4   | fatura 4 | 01/09 a 11/09 | R$ 264,38 | R$ 264,38      | 2     | 1                       | 13:03:53 |

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

---

## Causa raiz

Três escritas independentes disparadas do navegador, sem transação e sem filtro
de elegibilidade. Duas consequências somadas:

**Sem transação.** Falha de rede, aba fechada ou recusa da RLS entre os passos
deixava o que já tinha sido gravado. É a origem das faturas com R$ 0,00 e um
item — nem completas, nem revertidas.

**Sem filtro de elegibilidade.** Nem a prévia da tela nem o `UPDATE` final
excluíam apontamento já faturado. Como `timesheet_entries.invoice_id` é coluna
única, a segunda fatura **movia** o vínculo para si e deixava a anterior órfã.

Somaram-se ainda dois agravantes: os totais eram calculados no navegador e
gravados sem verificação, e nada serializava duas gerações simultâneas.

## Arquitetura antiga

```
navegador
  ├─ INSERT invoices        (totais calculados no browser)
  ├─ INSERT invoice_items   (agrupados no browser)
  └─ UPDATE timesheet_entries SET invoice_id   (sem WHERE invoice_id IS NULL)
```

Três viagens, três transações implícitas, nenhuma coordenação.

## Arquitetura nova

```
navegador
  └─ supabase.rpc("gerar_fatura", { _client_id, _period_start, _period_end })
         │
         └─ public.gerar_fatura  ·  UMA transação
              1. exige auth.uid() e papel admin
              2. valida parâmetros, período e existência do cliente
              3. pg_advisory_xact_lock por client_id
              4. seleciona elegíveis com FOR UPDATE
              5. recusa se não houver nenhum
              6. soma os totais no servidor
              7. INSERT invoices
              8. INSERT invoice_items por operação
              9. UPDATE vínculo com invoice_id IS NULL repetido
             10. confere ROW_COUNT e aborta se divergir
```

Migration: `supabase/migrations/20260905163000_005_gerar_fatura_transacional.sql`.

O navegador não envia mais `total_dailies`, `total_overtime`, `total_amount`,
`total_cost` nem itens para persistência. Ele ainda calcula a **prévia** na tela,
mas esse cálculo não chega ao banco.

## Segurança

`SECURITY DEFINER` com `SET search_path = public, pg_temp`, dono `postgres`.
Como a função roda acima da RLS, a autorização é explícita no corpo:
`has_role(auth.uid(), 'admin')`. `EXECUTE` revogado de `PUBLIC` e de `anon`,
concedido só a `authenticated`. Nenhuma `SERVICE_ROLE_KEY` participa — a
identidade vem do JWT do próprio usuário.

## Concorrência

`pg_advisory_xact_lock(hashtextextended(client_id))` serializa por cliente até o
fim da transação; `FOR UPDATE OF te` trava os apontamentos para que um Salvar
simultâneo não altere valores durante a apuração; e a conferência de `ROW_COUNT`
aborta tudo se o número de vínculos gravados divergir do selecionado.

## Duplicidade

`invoice_id IS NULL` aparece duas vezes — na seleção e no `UPDATE`. Um
apontamento já faturado não é selecionado nem tem o vínculo movido, então a
fatura anterior nunca fica órfã. A segunda geração no mesmo período encontra
zero elegíveis e falha.

Optou-se por **não** criar `UNIQUE (client_id, period_start, period_end)`: isso
bloquearia o caso legítimo de faturar lançamentos novos acrescentados ao mesmo
período. O filtro de elegibilidade já resolve o defeito real.

## Testes realizados — 05/09/2026

Todos contra o banco real, com a base em `invoices = 0` e dois apontamentos.

| Teste                                           | Resultado                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Autorização: usuário sem papel admin            | **PASS** — `42501`                                                                                                      |
| Período inválido (`início > fim`)               | **PASS** — `22023`                                                                                                      |
| Cliente inexistente                             | **PASS** — `P0002`                                                                                                      |
| Geração transacional com rollback               | **PASS**                                                                                                                |
| `total_amount` = soma de `billed_amount`        | **PASS** — 433,13                                                                                                       |
| `total_cost` = soma de `cost_amount`            | **PASS** — 330,94                                                                                                       |
| `total_amount` = soma de `invoice_items.amount` | **PASS**                                                                                                                |
| `total_dailies` = nº de entries faturados       | **PASS** — 2                                                                                                            |
| Vínculo dos entries                             | **PASS** — 2 vinculados, nenhum `absent`                                                                                |
| Duplicidade: segunda geração no mesmo período   | **PASS** — `P0002`, vínculos não movidos                                                                                |
| Concorrência real entre duas sessões            | **PASS** — sessão 2 bloqueada no advisory lock até o `COMMIT` da sessão 1, depois `P0002`; nunca existiram duas faturas |

A concorrência foi validada com **duas sessões `psql` independentes**. Fica
registrado o motivo: o SQL Editor do Supabase não é adequado para esse teste —
não garante sessão persistente entre execuções, e duas tentativas por lá
mediram `espera = 0.0 s`, resultado ambíguo entre "a RPC falhou" e "as execuções
não se sobrepuseram".

Após cada teste o banco voltou a `invoices = 0`, `invoice_items = 0`,
`entries_faturados = 0`, com a impressão digital dos campos de negócio dos
apontamentos inalterada.

## Testes de frontend — 05/09/2026

Executados na aplicação local, contra o banco real.

| Teste                                                               | Resultado |
| ------------------------------------------------------------------- | --------- |
| Gerar fatura via `rpc("gerar_fatura")`                              | **PASS**  |
| Fatura com 2,00 diárias · 3,25 h · R$ 433,13 · custo R$ 330,94      | **PASS**  |
| 2 `invoice_items` criados                                           | **PASS**  |
| 2 `timesheet_entries` vinculados                                    | **PASS**  |
| Prévia zerou após o faturamento                                     | **PASS**  |
| Botão de gerar perdeu elegibilidade                                 | **PASS**  |
| F5 preservou a fatura                                               | **PASS**  |
| Dashboard permaneceu coerente                                       | **PASS**  |
| Relatórios por colaborador                                          | **PASS**  |
| Relatórios por operação                                             | **PASS**  |
| Relatórios > Lançamentos com "Faturado = Sim" nos dois apontamentos | **PASS**  |

## Limpeza final

A fatura de teste foi removida com `DELETE FROM public.invoices WHERE id = …`,
com UUID explícito lido antes. Os `invoice_items` caíram por CASCADE e o
`invoice_id` dos apontamentos voltou a `NULL` por SET NULL, sem tocar em nenhuma
outra coluna.

Estado final conferido:

```
invoices          = 0
invoice_items     = 0
entries_faturados = 0
entries_total     = 2
digital_negocio   = 4bbec44b61ae2e3c965268ed9156083c
```

A impressão digital dos campos de negócio — status, horários, pausa, minutos e
valores — permaneceu idêntica à registrada antes dos testes. O `updated_at` dos
apontamentos avançou, e isso é esperado: o SET NULL da FK é um UPDATE e dispara
o trigger `trg_timesheet_entries_updated`.

## Resultado ponta a ponta

Onze testes de backend e onze de frontend, todos PASS, com o banco retornando ao
baseline depois de cada série. O defeito que produziu 6 faturas e 4 órfãs em
poucas horas de uso normal não tem mais caminho para acontecer: as três escritas
viraram uma transação, e o apontamento já faturado deixou de ser selecionável
tanto no servidor quanto na tela.

## Deriva do histórico de migrations — RESOLVIDA em 05/09/2026

Duas migrations estavam fora de `supabase_migrations.schema_migrations`:

- **`20260903205051`** (`revoke_public_execute_rls_auto_enable`), cujos efeitos
  já haviam sido aplicados no banco, mas cuja versão nunca constou do histórico;
- **`20260905163000`** (`005_gerar_fatura_transacional`), que ficou de fora por
  ter sido aplicada manualmente pelo SQL Editor, decisão tomada para não usar
  `supabase db push` enquanto a primeira deriva existisse.

Antes de qualquer reconciliação, os efeitos das duas foram **auditados no banco**,
não presumidos:

| Migration        | Evidência                                                                                                                                                                                              | Conclusão              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `20260903205051` | `has_function_privilege` em `public.rls_auto_enable`: `PUBLIC`, `anon` e `authenticated` com `false`; `postgres` com `true`                                                                            | efeitos 100% presentes |
| `20260905163000` | `md5` normalizado de `prosrc` igual ao do arquivo local (`dde73de1372af215620ed28ba2f7f006`), `SECURITY DEFINER`, `search_path = public, pg_temp`, owner `postgres`, `EXECUTE` só para `authenticated` | efeitos 100% presentes |

A diferença de tamanho do corpo entre banco e arquivo — 5721 contra 5567
caracteres — é apenas CRLF: 154 quebras de linha a mais. O hash normalizado, que
ignora `CR`, comprova identidade caractere por caractere.

Com a prova em mãos, o histórico foi reconciliado com o mecanismo oficial do
CLI, uma versão por vez:

```
supabase migration repair --linked --status applied 20260903205051
supabase migration repair --linked --status applied 20260905163000
```

`supabase migration list --linked` passou a mostrar **6 migrations com Local e
Remote alinhados**.

**Nenhum SQL de migration foi reaplicado.** O comando escreve apenas na tabela de
histórico. A verificação posterior confirmou que nada mais se moveu: o `md5` de
`gerar_fatura` continuou `dde73de1372af215620ed28ba2f7f006` e a impressão digital
dos apontamentos continuou `4bbec44b61ae2e3c965268ed9156083c`, com
`invoices = 0`, `invoice_items = 0` e `entries_total = 2`.

Descartou-se a alternativa de `INSERT` manual em
`supabase_migrations.schema_migrations`: acertar `version`, `name` e o array
`statements` à mão numa tabela cujo contrato pertence ao CLI é mais arriscado,
sem nenhuma vantagem.

## Dívidas separadas, que esta correção NÃO fecha

Nenhuma das quatro abaixo foi tocada aqui. Estão listadas para que a resolução
desta dívida não seja lida como resolução delas.

**O cálculo por lançamento ainda nasce no frontend.** A RPC soma os snapshots
`billed_amount`, `cost_amount`, `overtime_minutes` e `daily_rate_snapshot`
gravados pela tela de apontamentos — os totais da fatura passaram para o
servidor, mas o valor unitário não. Mover `calcEntry` para o Postgres tiraria do
navegador a autoridade sobre o valor. Trabalho próprio, ainda não feito.

**RLS permissiva em `timesheet_entries.invoice_id`.** A policy da tabela exige
apenas `is_staff()`, então um usuário `operacional` pode alterar o vínculo
diretamente pela API, desfazendo o lastro de uma fatura fechada. A RPC fechou o
caminho acidental pela aplicação, não o deliberado pela API. Registrada em
[rls-vinculo-de-fatura-permissivo.md](rls-vinculo-de-fatura-permissivo.md), e
precisa ser fechada **antes de existir a primeira conta `operacional`**.

**Demais dívidas já documentadas** seguem como estavam, em
`docs/divida-tecnica/`: escrita em `operation_team`, falso sucesso em UPDATE
bloqueado por RLS, e folha duplicada por `shift_id` nulo.
