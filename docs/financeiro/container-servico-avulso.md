# FIN-PR-11 — desenho do container como serviço avulso

**Status:** proposta de desenho para revisão. **Não implementado, não homologado e
não autorizado para ativação.** Este documento não afirma que a migration 029,
038 ou qualquer outra esteja aplicada em HML ou Production. Estado real dos
ambientes: [Estado do projeto](../ESTADO_DO_PROJETO.md).

## Objetivo e limites confirmados

- Container é **serviço avulso**, com cobrança negociada e pagamento por
  container. **Não** é diária de colaborador, hora extra, bônus diário ou
  recálculo de apontamento.
- O FIN-PR-11 é independente dos PRs 01–10 e da exportação Dynamis do PR-12.
  Faturamento, Fechamento e Relatórios continuam módulos distintos.
- Valor **cobrado do cliente** e valor **devido/pago pela execução** são
  conceitos separados; sem regra comercial validada, não inventar tarifa,
  distribuição, vínculo com trabalhador nem status de pagamento.
- Não alterar os snapshots ou os valores de lançamentos já faturados, nem
  reprecificar histórico. Sem carga automática nem alteração remota nesta fase.

## Base técnica verificada no Git

| Estrutura existente | Comportamento no código versionado | Consequência para o PR-11 |
| --- | --- | --- |
| `billing_additionals` (migration 029) | Adicional por cliente, operação opcional, período de execução, descrição, referência, valor total e vínculo com fatura. Escrita por RPC com motivo/trilha; cancelamento restrito; item faturado imutável. | Reaproveitar o fluxo de **receita** já existente, sem criar segunda soma paralela. |
| `gerar_fatura` (migrations 029/037/038) | Seleciona adicionais elegíveis, soma o valor em receita, cria `invoice_items` e vincula o adicional na mesma transação. O item avulso atual nasce com quantidade 1 e valor total. | A quantidade de containers precisa ser modelada à parte; alterar a quantidade do item exige preservar invariantes de faturamento. |
| `billing_period_start/end` (migration 038) | Competência de cobrança separada das datas de execução; respeita a frequência quinzenal/mensal do cliente. | Não duplicar lógica de competências nem faturar duas vezes. |
| `src/lib/adicionais.ts` e `adicionais-dados.ts` | Formulário e RPC de adicionais com valor total, sem quantidade física, valor unitário de container ou custo de execução. | Não representar pagamento por um campo de receita ou texto livre. |
| `timesheet_entries` / núcleo financeiro | Deriva diária, HE, especial e bônus por regras de jornada. | O serviço por container **não** deve gerar presença/diária nem entrar no motor de HE. |

A implementação de custo previsto de um colaborador **não é comprovante de
pagamento**. O modelo atual de adicionais não cria custo de execução.

## Alternativas arquiteturais

**A — estender `billing_additionals` para todo o controle do container.**
Menos entidades e possível reaproveitamento direto do CRUD; porém mistura
produção, receita, obrigação de pagamento e faturamento numa tabela legada.
Amplia riscos de regressão em RLS, relatórios e `gerar_fatura`.

**B — entidade de execução de container, associada a um adicional de receita.**
Proposta preferencial **sujeita à validação comercial e técnica**: registrar
lote/serviço executado com quantidade e valores comerciais congelados; gerar
ou vincular, por RPC transacional e idempotente, **um único**
`billing_additional` para a cobrança. Obrigações de pagamento ficam em
registros separados, com beneficiários e valores definidos explicitamente.
Contras: exige nova migration, novas RPCs, integração de leitura e testes
mais extensos. Vantagem: separa receita, execução e pagamento sem contaminar
o núcleo de diárias.

**Não implementar ainda nenhuma opção.** A opção B é uma hipótese de
arquitetura; a adoção definitiva depende das respostas comerciais abaixo,
da análise de consumers do ledger e da versão real do schema no ambiente
alvo.

## Contrato proposto (ainda não aprovado)

1. **Execução:** cliente, operação (quando existente), data/período da
   execução, referência identificadora e quantidade positiva de containers.
   Não pressupor que exista um número físico único de cada container.
2. **Receita:** preço unitário negociado ou valor total combinado, conforme
   regra aprovada; congelar a base de formação e o total por registro. Não
   modificar o valor de uma fatura emitida.
3. **Pagamento/custo:** valor unitário devido e beneficiário(s) somente após
   confirmação comercial. Se houver divisão por equipe, especificar partes
   sem atribuição presumida. Distinguir obrigação **a pagar** de pagamento
   **efetivamente realizado**, com prova/auditoria se o escopo abranger baixa.
4. **Competência:** utilizar o período de execução e a competência de cobrança
   previstos na 038, sem reabrir faturas e sem criar duas receitas para
   a mesma prestação. A competência de pagamento pode ser distinta e
   precisa de decisão específica.
5. **Segurança:** escrita só por RPC administrativa com piso MFA atual,
   guardas de papel e identidade, menor privilégio, auditoria e trava de
   concorrência/idempotência. Proibir UPDATE direto que altere valores
   faturados ou comprovantes históricos.
6. **Integração:** faturamento pode exibir quantidade e preço por container
   **somente** se os totais e invariantes forem preservados. Relatórios podem
   discriminar serviço avulso; Fechamento continua sem recalcular fontes.
7. **Compatibilidade:** ausência de registros novos preserva valores,
   leituras e exportações legados; resolução comercial OFF/ON e calendário
   territorial não sofrem alteração.

## Decisões comerciais em aberto (aprovação necessária)

- **Cobrança:** preço por unidade × quantidade ou valor fechado por lote?
  O valor varia por cliente, contrato, operação ou execução específica?
- **Pagamento:** quem recebe — trabalhador individual, equipe, fornecedor ou
  prestador externo? O pagamento é por container para cada pessoa ou um total
  a dividir? Qual a regra de custo e de rateio?
- **Registro:** quem confirma o serviço executado, qual a referência exigida,
  e como distinguir correção legítima de lançamento duplicado?
- **Competências:** quando ocorre faturamento e quando o pagamento é devido?
  Deve existir baixa financeira efetiva ou só previsão/controle de custos?
- **Cancelamento e alterações:** o que é permitido antes e depois de faturar
  ou pagar, inclusive estorno e compensação, sem reescrever histórico?

## Plano de implementação (após aprovação do desenho)

1. Inventariar a versão **efetiva** dos schemas e as dependências
   `billing_additionals`, `invoice_items`, `gerar_fatura`, Fechamento,
   Relatórios e exportações; não inferir implantação pelo Git.
2. Especificar modelo de execução, receita e obrigação de pagamento, invariantes
   e matriz de permissões. Testes RED com duplicidade, concorrência,
   cancelamento, períodos, diferenças entre receita/custo e histórico.
3. Implementar em branch própria, por migrations **novas** e compatíveis.
   Nenhuma migração de banco já aplicada deve ser editada.
4. Testar em Supabase local descartável, com paridade do legado, fatura de
   container apenas, fatura mista, RLS, auditoria, rollback permitido/bloqueado
   e compatibilidade com migrations 029–044.
5. Abrir PR de implementação isolado, validar CI, segurança e revisão.
   A integração no Git **não** autoriza migration remota.
6. Homologar em HML somente depois de comprovar isolamento, backups/restore,
   estado real das migrations e autorização específica. Production exige
   gate separado. Conciliação com dados reais pertence ao FIN-PR-13.

## Critério de saída do desenho

Aprovação explícita da modelagem e das regras de cobrança/pagamento,
acompanhada de matriz de risco e proposta de testes. **Sem essas decisões,
o FIN-PR-11 não deve gravar dados financeiros nem criar uma regra de
pagamento inventada.**
