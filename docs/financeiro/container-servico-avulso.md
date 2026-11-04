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
- Valor **cobrado do cliente** e valor **devido ao colaborador pela
  execução** são conceitos separados. O preço é negociado **caso a caso**,
  sem tabela fixa; o pagamento é informado por colaborador participante,
  seja um valor em R$ por pessoa, seja um total a dividir entre eles.
- O pedido do serviço deve ocorrer **até um dia antes** da execução, conforme
  a regra comercial relatada. Não inventar preço, equipe ou quantidade.
- O registro contém data, cliente, operação opcional, descrição do serviço
  (tamanho/produto), quantidade de containers e valor cobrado.
- No fechamento e na fatura, o serviço aparece inclusive quando o cliente
  contratou **somente containers**. Na exportação ao cliente (FIN-PR-12),
  mostrar linha própria sem custo/margem; custo e resultado pertencem aos
  relatórios **internos**.
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
Proposta preferencial **sujeita à validação de arquitetura e testes**: registrar
lote/serviço executado com quantidade e valores comerciais congelados; gerar
ou vincular, por RPC transacional e idempotente, **um único**
`billing_additional` para a cobrança. Obrigações de pagamento ficam em
registros separados, com beneficiários e valores definidos explicitamente.
Contras: exige nova migration, novas RPCs, integração de leitura e testes
mais extensos. Vantagem: separa receita, execução e pagamento sem contaminar
o núcleo de diárias.

**Não implementar ainda nenhuma opção.** A opção B é uma hipótese
de arquitetura; a adoção definitiva depende da revisão dos consumidores
de faturamento/ledger, da versão real do schema no ambiente alvo e da
aprovação do desenho, **não de repetir perguntas comerciais já respondidas**.

## Regras comerciais já informadas

Estas diretrizes foram registradas na conversa do projeto em 30/10/2026,
a partir das respostas do cliente; não são decisões técnicas novas:

1. **Solicitação:** serviço solicitado até um dia antes; não impor prazos
   horários adicionais sem evidência.
2. **Cobrança:** valor negociado para cada serviço, considerando produto,
   quantidade, tempo, equipe e eventual ajuda do cliente. **Sem tabela de
   preços fixa**, fórmula automática de orçamento ou tarifa por container.
3. **Registro:** data, cliente, operação opcional, descrição com produto/tamanho,
   quantidade de containers e valor total efetivamente acordado.
4. **Pagamento:** informar os colaboradores participantes e o valor devido
   **por colaborador**, aceitando a entrada de R$ por pessoa ou o rateio
   explícito de um total informado. Não pressupor divisão igualitária sem
   ter sido escolhida ou registrada.
5. **Faturamento:** incluir no fechamento/fatura do cliente; se não existirem
   diárias, a fatura **somente de serviços avulsos** continua válida.
6. **Exportação e indicadores:** containers em **linha própria** na
   exportação ao cliente, sem custo/margem (FIN-PR-12); custos e resultado
   apenas nos relatórios internos. Não duplicar receita no faturamento.
7. **Competências:** a cobrança de serviço avulso pode ocorrer em
   competência diferente da execução (capacidade já existente na 038).
   A data exata do pagamento não foi detalhada.

O sistema deve preservar essas decisões. Não pedir novamente ao cliente
respostas já fornecidas nem confundir custo previsto com quitação efetiva.

## Contrato técnico proposto (ainda não aprovado)

1. **Execução:** cliente, operação opcional, data/período de execução,
   descrição do produto/tamanho, quantidade positiva de containers e
   referência operacional para impedir duplicidade. Não pressupor
   identificador físico individual de cada container.
2. **Receita:** valor **total negociado** por execução. Se o orçamento
   trouxer valor unitário, preservá-lo como evidência, **não** como
   tabela de preços nem como regra para recalcular o valor combinado.
   Congelar valor e vínculo de fatura; não reabrir valores históricos.
3. **Custo por colaborador:** registrar participantes e o custo informado
   individualmente, em R$ por pessoa ou mediante distribuição explícita
   de valor total. Validar soma, precisão decimal, não negatividade e
   autorização da correção. Não associar esse custo à diária ou HE.
   Distinguir valor **devido** de baixa/valor **pago**; a existência
   de baixa bancária é extensão não confirmada, não pré-requisito inventado.
4. **Competência:** reaproveitar período de execução e competência de
   **cobrança** da 038. Preservar a possibilidade de cobrança antes/depois
   da execução, sem emissão duplicada. A competência de pagamento será
   mantida distinta se o fluxo exigir, sem assumir um vencimento.
5. **Segurança:** escrita por RPC administrativa com piso MFA em vigor,
   autorização, menor privilégio, auditoria e idempotência. Sem modificar
   diretamente adicionais faturados, snapshots ou comprovantes históricos.
6. **Integração:** manter elegibilidade de `billing_additionals` e
   invariantes de `gerar_fatura`. Testar fatura mista e **somente containers**.
   Exportação ao cliente com linha própria sem custo/margem; Relatórios
   internos podem mostrar custo e resultado. Fechamento não recalcula
   valores fontes.
7. **Compatibilidade:** sem containers novos, não há alterações em
   diárias, horas extras, calendário, fechamento legado ou faturas
   preexistentes; resolução financeira OFF/ON permanece independente.

## Detalhes operacionais a especificar na implementação

Não são lacunas da regra de negócio já respondida. Devem ser resolvidas
na análise de produto/segurança com a menor alteração necessária:

- Chave de idempotência e evidência mínima para identificar a execução,
  impedir lançamentos repetidos e tratar correções com trilha.
- Representação de participantes e rateio individual: como registrar
  explicitamente a modalidade escolhida, prevenir arredondamento com
  centavos perdidos e manter histórico; não inventar alocação de equipe.
- Fluxo de cancelamento antes do faturamento e de ajuste posterior por
  documento compensatório, nunca edição silenciosa da fatura.
- Distinguir acompanhamento de custo a pagar de **baixa financeira real**.
  Não criar conciliação bancária nesta etapa sem decisão de escopo.
- Acesso por perfil, relatórios internos, item da fatura e formato da
  exportação ao cliente, mantendo os três módulos separados.

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

As regras comerciais acima estão registradas; o próximo gate exige
**aprovação do desenho técnico e dos critérios de aceite**, matriz de risco
e proposta de testes. O PR de implementação não deve inventar tarifa,
quantidade, rateio, pagamento ou datas e **não** autoriza implantação remota.
O FIN-PR-11 não deve gravar dados reais antes da homologação específica.
