# FIN-PR-11 — desenho do container como serviço avulso

**Evolução do desenho:** arquitetura B aprovada e integrada pelo PR #93; domínio
puro integrado pelo PR #94. O backend FIN-PR-11B tem implementação local em
revisão, sem homologação ou autorização de ativação. Este documento não afirma que a migration 029,
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
- Regra atual confirmada (FUNC-01): a solicitação pode ser **anterior ou no mesmo
  dia** da execução. Solicitação posterior ou data civil inválida é recusada.
  Não inventar preço, equipe ou quantidade.
- O registro contém data, cliente, operação opcional, descrição do serviço
  (tamanho/produto), quantidade de containers e valor cobrado.
- No fechamento e na fatura, o serviço aparece inclusive quando o cliente
  contratou **somente containers**. Na exportação ao cliente (FIN-PR-12),
  mostrar linha própria sem custo/margem; custo e resultado pertencem aos
  relatórios **internos**.
- Não alterar os snapshots ou os valores de lançamentos já faturados, nem
  reprecificar histórico. Sem carga automática nem alteração remota nesta fase.

## Base técnica verificada no Git

| Estrutura existente                             | Comportamento no código versionado                                                                                                                                                                        | Consequência para o PR-11                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `billing_additionals` (migration 029)           | Adicional por cliente, operação opcional, período de execução, descrição, referência, valor total e vínculo com fatura. Escrita por RPC com motivo/trilha; cancelamento restrito; item faturado imutável. | Reaproveitar o fluxo de **receita** já existente, sem criar segunda soma paralela.                                                |
| `gerar_fatura` (migrations 029/037/038)         | Seleciona adicionais elegíveis, soma o valor em receita, cria `invoice_items` e vincula o adicional na mesma transação. O item avulso atual nasce com quantidade 1 e valor total.                         | A quantidade de containers precisa ser modelada à parte; alterar a quantidade do item exige preservar invariantes de faturamento. |
| `billing_period_start/end` (migration 038)      | Competência de cobrança separada das datas de execução; respeita a frequência quinzenal/mensal do cliente.                                                                                                | Não duplicar lógica de competências nem faturar duas vezes.                                                                       |
| `src/lib/adicionais.ts` e `adicionais-dados.ts` | Formulário e RPC de adicionais com valor total, sem quantidade física, valor unitário de container ou custo de execução.                                                                                  | Não representar pagamento por um campo de receita ou texto livre.                                                                 |
| `timesheet_entries` / núcleo financeiro         | Deriva diária, HE, especial e bônus por regras de jornada.                                                                                                                                                | O serviço por container **não** deve gerar presença/diária nem entrar no motor de HE.                                             |

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

1. **Solicitação (histórico de 30/10, superado):** até um dia antes. A confirmação
   posterior permite mesmo dia; FUNC-01 implementa `solicitação <= execução`,
   sem impor prazo de horário. Demais regras abaixo são preservadas.
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

## Contrato técnico registrado no desenho

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

## Detalhes operacionais registrados no desenho

Lista histórica do desenho; as decisões implementadas no FIN-PR-11B estão no
contrato do backend ao final deste documento.

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

## Plano de implementação registrado no desenho

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

## Critério de saída do desenho (histórico)

Critério anterior à aprovação no PR #93, preservado para rastreabilidade.

As regras comerciais acima estão registradas; o próximo gate exige
**aprovação do desenho técnico e dos critérios de aceite**, matriz de risco
e proposta de testes. O PR de implementação não deve inventar tarifa,
quantidade, rateio, pagamento ou datas e **não** autoriza implantação remota.
O FIN-PR-11 não deve gravar dados reais antes da homologação específica.

## Contrato do backend FIN-PR-11B

A migration nova `20261112120000_045_container_servico.sql` separa
`container_services`, `container_service_participants` e
`container_service_audit`. O vínculo único com `billing_additionals` é a única
fonte de receita para faturamento; quantidade física, custo devido e modalidade
ficam na execução. Nenhum registro representa pagamento quitado.

`registrar_servico_container(p_dados jsonb, p_idempotency_key uuid, p_reason text)`
recebe o payload normalizado de `prepararLoteDeContainers`: centavos inteiros,
participantes explícitos e competência opcional. O banco repete as validações de
datas, quantidade, precisão, soma, cliente/operação e modalidade. Não há rateio
automático. O adaptador `src/lib/container-servico-backend.ts` reutiliza o domínio
e propaga erros da RPC; não substitui a autorização ou o cálculo no banco.

A chave UUID identifica uma execução por cliente e deve ser reutilizada nas
tentativas do mesmo pedido. Payload canônico igual retorna o mesmo UUID sem nova
receita ou auditoria; conteúdo diferente com a mesma chave é recusado. A
referência operacional continua opcional e não substitui a chave de idempotência.
Serviços diferentes precisam de chaves diferentes; o backend não infere se dois
pedidos com novas chaves correspondem à mesma execução física.

`cancelar_servico_container(p_id uuid, p_reason text)` preserva o serviço, os
participantes e a trilha, cancelando a receita na mesma transação. Serviço
faturado é imutável. A API legada de cancelar adicional não pode cancelar
isoladamente a receita vinculada a serviço ativo. Não há edição financeira: uma
correção anterior ao faturamento exige cancelamento explícito e novo registro.

Registro, cancelamento e `gerar_fatura` usam a mesma trava de cliente. A fatura
continua incluindo o adicional uma única vez, inclusive sem apontamentos. Sua
expressão de custo acrescenta somente o custo devido dos containers vinculados
aos adicionais selecionados; diárias, HE e bônus mantêm suas fórmulas. Faturas
existentes não são recalculadas. Custo devido não comprova quitação.

As três tabelas permitem leitura somente a admin com sessão válida e piso
`mfa_cotidiano_ok()`, sem escrita direta pela API. As duas RPCs revalidam essas
condições internamente e possuem grants mínimos/search_path controlado. As cinco
RPCs operacionais permanecem sem nova superfície financeira.

O [rollback da 045](../runbooks/rollback-container-servico.sql) só se destina ao
estágio 045 antes de qualquer uso: serviço, participante ou auditoria bloqueia
a remoção com SQLSTATE `55000`. Exige janela sem escrita ou faturamento; travas
exclusivas `NOWAIT` precedem a guarda e recusam concorrência com `55P03`.
Não apagar histórico para vencer a guarda. Versões posteriores exigem
novo plano de dependências; não executar esse SQL como rollback genérico.
Resultados e limites de implantação ficam no
[checkpoint canônico](../ESTADO_DO_PROJETO.md#fin-pr-11b--checkpoint-de-desenvolvimento-local-04112026).
A interface e os consumidores de apresentação pertencem ao FIN-PR-11C.


## FUNC-01 — mesmo dia, versão 050 e integração

A correção muda somente a ordem admissível das datas: CHECK da tabela e
normalizador SQL aceitam `requested_on <= executed_on`; domínio/formulário aceitam
`solicitadoEm <= executadoEm`. O erro de data posterior é consistente. Datas civis
inválidas continuam recusadas. Nada reescreve serviços, participantes, receitas,
competências, custos, faturas ou trilhas existentes; normalizador mantém assinatura,
IMMUTABLE/INVOKER, owner e ACL. Migrations históricas não foram editadas.

Migration nova: `20261117120000_050_container_same_day_request.sql`. A numeração
segue depois das candidatas 046–049 do #111, conferidas no HEAD
`7e08270011f74ea5dfe4470097f58659eea81140`. A main base contém até a 045; esta
branch isolada acrescenta somente a 050. Não há arquivos 046–049 por arrasto.
O timestamp local gerado pelo CLI era anterior às migrations futuras já versionadas;
o arquivo novo foi nomeado após a 049 antes de publicar, sem renomear histórico.

### Sequências locais comprovadas e limite remoto

- **045 → 050:** instalação independente da correção no baseline, 47 suítes SQL
  locais PASS. Correção disponível nesse baseline continua cancelar + registrar.
- **045 → 046 → 047 → 048 → 049 → 050:** composição com candidatos existentes,
  55 versões de migration e 51 suítes SQL PASS. A 049 chama o normalizador comum;
  troca auditada, mesmo dia, reenvio e bloqueio de faturado foram exercitados.
- Frontend do #111 composto seletivamente com esta correção passou nos testes
  focais e no adaptador real de correção com transporte simulado. Quatro testes
  antigos desta main que fixavam o inventário de migrations foram atualizados para
  51 arquivos/última 050; ao combinar o prefixo 046–049, reconciliar contagens para
  55 e manter as exceções de versões posteriores. Não é mudança de regra financeira.
- Probe local antes/depois preservou integralmente dois serviços anteriores à 050
  (um livre e outro faturado), custos, participantes, adicionais, trilhas, itens de
  fatura e snapshots, incluindo reenvio das chaves antigas. Owner/ACL/RLS intactos.

**Não executar db push diretamente desta branch em HML 045.** Primeiro obter
aprovação e reconciliar a integração dos arquivos 046–049 com a main, preservando
esta 050 como última versão, main:false e controlador OFF. Antes da aplicação,
confirmar catálogo real, backup/recuperação e autorização específica do ambiente.
Na sequência recomendada para HML: aplicar o prefixo aprovado 046–049 em ordem e
somente depois a 050; conferir cada versão e executar a homologação do candidato.
A decisão comercial da 048 continua pendente; não ligar a resolução por arrasto.

Embora a 050 funcione sozinha em 045 local, aplicá-la remotamente antes de decidir
como incorporar 046–049 criaria versões anteriores pendentes no ledger. Essa rota
não foi autorizada/proposta como atalho. Se o prefixo não estiver aprovado ou o
catálogo divergir, **BLOQUEADO para aplicação**, sem `--include-all` improvisado,
renomear migrations históricas, ignorar versão ou aplicar automaticamente no app.
Os PRs documentais/funcionais permanecem independentes; nenhum merge é autorizado.

Preview READY comprova código publicado, não backend atualizado: com HML ainda
na 045, o banco segue recusando mesmo dia e a UI deve apresentar o erro retornado,
sem fallback/duplicidade ou alteração automática de schema. A correção atômica
049 não foi portada para esta branch; só é oferecida por sua capacidade no #111.

### Resposta a falha

A migration transaciona as mudanças e recusa estrutura inesperada do CHECK em vez
de remover outra restrição. Não se propõe rollback que exclua/altere serviços do
mesmo dia para recuperar `<`. Preservar histórico e avaliar correção adiante com
autorização própria. Nada autoriza limpeza de HML, mudança de Production ou dado real.
Resultados do SHA candidato e autorização de aplicação ficam no
[HANDOFF](../HANDOFF.md); decisões comerciais gerais permanecem no PR documental.
