# Não-admin consegue alterar o vínculo de fatura de um apontamento

**Levantado em:** 05/09/2026, durante a implementação do faturamento transacional.
**Situação:** registrada, **não corrigida**. Decisão deliberada de não misturar
com a mudança do faturamento.
**Gravidade:** média — não permite criar fatura, mas permite desfazer o lastro de
uma já fechada.

## O que foi encontrado

As policies das três tabelas de faturamento não são simétricas:

| Tabela              | Policy `ALL`                            |
| ------------------- | --------------------------------------- |
| `invoices`          | `has_role(auth.uid(), 'admin')`         |
| `invoice_items`     | `has_role(auth.uid(), 'admin')`         |
| `timesheet_entries` | **`is_staff()`**                        |

`is_staff()` devolve verdadeiro para qualquer usuário com linha em `user_roles` —
inclusive `operacional`. Como a policy é `ALL`, ela cobre `UPDATE` de **todas** as
colunas, e `timesheet_entries.invoice_id` é uma delas.

Na prática: um usuário `operacional` não consegue criar nem apagar fatura, mas
consegue alterar `invoice_id` de qualquer apontamento — desvinculando trabalho de
uma fatura fechada, ou apontando-o para outra. A fatura continua existindo com
seus totais, agora sem lastro, e nada registra a mudança.

## Por que não foi corrigido junto com o faturamento transacional

A função `public.gerar_fatura` fecha o caminho pelo qual o vínculo era movido
*pela aplicação*: ela nunca sobrescreve `invoice_id` preenchido. Isso resolve o
defeito observado em produção, que era acidental e vinha da própria tela.

O que fica em aberto é diferente: a escrita **direta** na tabela, via API do
Supabase, por um usuário autenticado sem papel de admin. Corrigir exige dividir a
policy `ALL` em `SELECT` / `INSERT` / `UPDATE` com restrição por coluna ou por
papel, o que mexe em autorização de uma tabela usada por toda a tela de
apontamentos — mudança de escopo próprio, com testes próprios.

Hoje o sistema tem dois usuários, ambos `admin`, então não há exposição prática
enquanto não existir uma conta `operacional`.

## Direção da correção

Substituir a policy única por um conjunto explícito: leitura e escrita
operacional para `is_staff()`, mas `invoice_id` gravável apenas por
`has_role(auth.uid(), 'admin')` — via policy separada de `UPDATE` com `WITH CHECK`
comparando o valor anterior, ou movendo o vínculo para uma tabela própria, o que
também resolveria o histórico de faturamento sobrescrito discutido em
[faturamento-nao-transacional.md](faturamento-nao-transacional.md).

**Antes de criar a primeira conta `operacional`, esta dívida precisa ser fechada.**

## Testes a criar junto

Usuário `operacional` autenticado tentando: `UPDATE timesheet_entries SET
invoice_id = NULL`, e `UPDATE` apontando para outra fatura. Ambos devem ser
recusados, e a recusa precisa ser visível — hoje um `UPDATE` bloqueado por RLS
retorna sucesso com zero linhas, conforme
[falso-sucesso-em-update-bloqueado-por-rls.md](falso-sucesso-em-update-bloqueado-por-rls.md).
