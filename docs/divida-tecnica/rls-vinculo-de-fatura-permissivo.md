# Não-admin consegue alterar o vínculo de fatura de um apontamento

**Levantado em:** 05/09/2026, durante a implementação do faturamento transacional.
**Situação:** **RESOLVIDA** em 09/09/2026 pela migration
`20260909175435_protect_timesheet_invoice_link.sql`.
**Gravidade na época:** média — não permitia criar fatura, mas permitia desfazer
o lastro de uma já fechada.

> ## Resolvida — leia antes do resto
>
> A correção veio como **trigger**, não como divisão de policy:
>
> ```sql
> CREATE TRIGGER trg_timesheet_entries_protect_invoice_link
>   BEFORE INSERT OR UPDATE OF invoice_id ON public.timesheet_entries
>   FOR EACH ROW EXECUTE FUNCTION public.protect_timesheet_invoice_link();
> ```
>
> `protect_timesheet_invoice_link()` levanta **42501** quando o vínculo muda e o
> chamador não é admin, isentando `postgres` e `service_role` para que
> `gerar_fatura` — que é `SECURITY DEFINER` — continue funcionando. A função é
> `SECURITY INVOKER` de propósito: é isso que a deixa enxergar o `current_user`
> real.
>
> Trigger instalado e conferido em Production em 12/09/2026.
>
> ## Atualização — o trigger foi APOSENTADO pela migration 013 (PR B1)
>
> `protect_timesheet_invoice_link` **não existe mais**. Quem protege o vínculo
> hoje são as guardas da migration `011`, que cobrem o mesmo evento e são
> **estritamente mais restritas**:
>
> | transição          | o legado permitia             | a 011 permite |
> | ------------------ | ----------------------------- | ------------- |
> | INSERT com vínculo | postgres, service_role, admin | só `postgres` |
> | UPDATE NULL → X    | postgres, service_role, admin | só `postgres` |
> | UPDATE X → Y       | postgres, service_role, admin | **ninguém**   |
> | UPDATE X → NULL    | postgres, service_role, admin | **ninguém**   |
>
> Como o legado permitia tudo o que a 011 permite e mais, ele nunca recusava
> nada que ela aceitasse — e, pela ordem alfabética dos triggers, nem chegava a
> ser o recusador. Era código morto, e cobrava caro: por ser `SECURITY INVOKER`
> e chamar `auth.uid()`, obrigava qualquer papel que gravasse apontamento a ter
> `USAGE` no schema `auth` — privilégio que o `postgres` do Supabase **não
> consegue conceder** em Production, medido no gate do PR B1.
>
> A remoção **endureceu** a regra: sumiram as isenções de `admin` e de
> `service_role`. Os casos O1–O10 de `supabase/tests/009_superficie_operacional.sql`
> exercitam as quatro transições para os dois papéis e todas continuam recusadas
> com `42501`.
>
> **Não recriar esta proteção** — nem a versão legada, nem uma nova policy. O
> texto abaixo é o registro histórico do problema e da análise que levou à
> correção original.
>
> **Esta dívida não cobria `billed_amount` e `cost_amount`.** Essas colunas
> ficaram desprotegidas até a migration
> `20260912183000_010_derivar_valores_financeiros.sql`, que mudou a abordagem:
> em vez de proibir a escrita, o banco passou a **derivar** os valores e ignorar
> o que vem no payload.

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
