# Vínculo de fatura alterável por quem não é admin

**Levantado em:** 05/09/2026, durante a implementação do faturamento transacional.
**Situação:** **RESOLVIDA / HISTÓRICA**. A proteção atual é a da migration `011`.
**Gravidade na época:** média — não permitia criar fatura, mas permitia desfazer
o lastro de uma já fechada.

## O problema

A policy de `timesheet_entries` exigia apenas `is_staff()`, que é verdadeiro para
qualquer papel atribuído. Como `invoice_id` é uma coluna da própria tabela,
alguém que não fosse admin poderia, em tese, desvincular um apontamento da fatura
que o cobrou — ou vinculá-lo a outra. Policy de RLS decide sobre a **linha**, não
sobre a **coluna**, então não havia como fechar isso só pela policy.

## Como foi resolvido

1. **09/09/2026** — um trigger de `BEFORE INSERT OR UPDATE OF invoice_id`
   recusava a mudança do vínculo a quem não fosse admin. Era `SECURITY INVOKER`
   e isentava `postgres` e `service_role`.
2. **Migration `011`** — as guardas definitivas. Hoje o vínculo só nasce em
   execução como `postgres`, que é o contexto em que `gerar_fatura` roda;
   `authenticated` (admin incluído) e `service_role` não criam. Uma linha com
   `invoice_id` preenchido recusa `UPDATE` e `DELETE`, inclusive o `SET NULL` que
   a FK emitiria ao apagar a fatura.
3. **Migration `013`** — aposentou o trigger do passo 1. Ele era código morto: as
   guardas da `011` aceitam estritamente menos do que ele aceitava. E custava
   caro, porque chamava `auth.uid()` e obrigava qualquer papel que gravasse
   apontamento a ter `USAGE` no schema `auth`, privilégio que o `postgres` do
   Supabase não consegue conceder em Production. **Não recriar.**
4. **Migration `016`** — o acesso direto a `timesheet_entries` pelo PostgREST
   passou a exigir `admin` + `aal2`. O papel `operacional` não escreve nela
   diretamente.

## O que isto não cobre

O gatilho mede `current_user`, então não distingue `gerar_fatura` de uma sessão
`postgres` escrevendo à mão. A fronteira protegida é a API da aplicação, não o
banco contra quem já é seu dono.

`billed_amount` e `cost_amount` nunca estiveram neste escopo: foram fechados pela
migration `010`, que passou a **derivar** os valores no banco em vez de proibir a
escrita.

## Onde está a fonte de verdade

O comportamento atual está descrito em [`../SEGURANCA.md`](../SEGURANCA.md) e em
[`../ARQUITETURA.md`](../ARQUITETURA.md). Este arquivo é só registro do problema
e do caminho até a correção; **não usar como especificação**.

Relacionados: [faturamento-nao-transacional.md](faturamento-nao-transacional.md)
e [falso-sucesso-em-update-bloqueado-por-rls.md](falso-sucesso-em-update-bloqueado-por-rls.md).
