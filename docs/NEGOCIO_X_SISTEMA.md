# Negócio × sistema — revisão RETOMADA-FUNCIONAL-01

SDLC: Requisitos / Planejamento. **Publicação documental FUNC-01 autorizada em
PR Draft próprio; sem merge.** Entrada operacional única: [HANDOFF](HANDOFF.md).
Matriz17 itens preservada. A correção do item7 foi autorizada em branch/PR
separados e está sob preparação; esta publicação não comprova sua implementação
ou homologação. Demais lotes mantêm decisões e autorizações próprias.
Gates de checkpoint3–5 **PAUSADOS**, não concluídos; Gate 1/2 preservados.

## Fontes, SHAs e limite da conclusão

- Main atual: `75c47cd9a30e4888b197ca6ae27aa236c71ec589`, após squash documental #116; CI aprovada.
- #111 aberto Draft: `7e08270011f74ea5dfe4470097f58659eea81140`; #112 aberto Draft: `2d1c0cde7bd47154a281171d77858b530d0b6de2`.
  Ambos com CI atual aprovada e conflitos de integração informados pelo GitHub;
  não foram mergeados nem atualizados. Infraestrutura nova da main deve ser preservada.
- [B — negócio e decisões do responsável,08/11](https://github.com/therunnas/bslogistica/blob/2d1c0cde7bd47154a281171d77858b530d0b6de2/docs/NEGOCIO.md)
  e [matriz original17 itens](https://github.com/therunnas/bslogistica/blob/2d1c0cde7bd47154a281171d77858b530d0b6de2/docs/NEGOCIO_X_SISTEMA.md).
  Confirmação documental do responsável, não observação nova da operação real.
- `git diff38b4349..main -- src supabase` vazio: implementação funcional da main
  continua igual à base38b da matriz antiga. Foram examinadas fontes pertinentes
  de ambos os SHAs, não inferidas diferenças a partir do nome dos PRs.
- Índice estrutural disponível era de outra branch/14-10, com lacunas de docs/SQL
  e módulos novos; conclusões abaixo usam leitura Git direta dos SHAs, não ausência
  no grafo como prova. Sem auditoria genérica de infraestrutura ou SQL remoto.
- Não houve teste funcional/local-banco/navegador, homologação HML nem migration
  nesta tarefa. CI é evidência automatizada do SHA, não uso real/homologação.
  Último registro documental: HML045 e resolução comercial OFF; Production034,
  servindo código38b. Não houve nova consulta ao banco para atualizar esses fatos.

## Separação rigorosa de estados

| Camada | Evidência e estado |
| --- | --- |
| A. Funcionamento real confirmado documentalmente | Fixa recorrente versus avulso pontual; mesmo dia permitido; regras gerais8h/sábado/especial; separação cobrança/custo; fechamento por cliente. Negociação específica e seção15 do negócio continuam pendentes. |
| B. Implementado na main | Cadastros/contratos/equipe/turnos/apontamentos; vigências, funções e preços condicionados; calendário/V2; Containers; fechamento/fatura/exportação; auth/RLS/MFA e auditoria no seu escopo. Não equivale a estar ativo em Production034. |
| B. Implementado só no candidato #111 | UX/cadastros, validações e moedas/CSV; integridade046, idempotência047, fallback048, correção auditada049. Nenhum desses quatro schemas foi registrado como aplicado no HML. |
| C. Testes locais históricos | FUNC-READY:83 suítes Node/50 SQL/E2E 34 verificações locais; versões anteriores da046/047 também têm concorrência/compatibilidade e replay/rollback locais. Resultados com data/SHA, não transferidos ao candidato final. |
| D. Evidências HML e limites dos conjuntos históricos | Matriz FIN-PR-13:27 casos fechados com evidências MISTAS: HML, Excel real e A05 de e-mail em stack LOCAL; não são27PASS integrais de HML. S19 reúne controles locais/leitura HML/UI parcial e mantém NO-GO:283PASS/64BLOQUEADO/137NÃO TESTADO,484controles. Não somar conjuntos nem aprovar todo #111. |
| E. Pendente | Reconciliar código/documentos; decisão048 e demais práticas; corrigir pedido mesmo dia; generalizar avulsos; aplicação/homologação autorizadas de schemas novos; completar fluxo integrado e preparar rollout separado. |
| F. Decisão do cliente | Preço-base como recuo, rotina de reajuste, mapeamento função/preço, modalidades/prática de avulsos, custo participantes e exceções de sábado. Não preencher lacuna comercial com uma suposição técnica. |

Não são17 bugs. A revisão mantém8 itens alinhados sob suas condições, corrige2
premissas antigas(5,14), confirma2divergências(6,7),2lacunas(8,15),2 itens de
prontidão/decisão(4,9) e1foraMVP(17). O item10 também depende da prática comercial.
P0=risco financeiro/gate de primeiro uso; P1=necessário ao fluxo do MVP;
P2=melhoria/recorte posterior ao núcleo; P3=fora da entrega aprovada.

## Matriz das17divergências reavaliadas

| ID | Tema | Situação revisada | Prioridade |
| --- | --- | --- | --- |
| 1 | Jornada fixa, HE e saída antecipada | Alinhado condicionado | P0 |
| 2 | Sábado: cobrança e custo | Alinhado condicionado | P0 |
| 3 | Domingo, feriado e território | Alinhado condicionado | P0 |
| 4 | Diária individual e precedência de preços | Decisão comercial / prontidão | P0 |
| 5 | Função operacional e categoria de preço | Premissa antiga corrigida | P1 |
| 6 | Tipos de serviço avulso | Divergência confirmada | P1 |
| 7 | Pedido e execução no mesmo dia | Divergência confirmada | P0 |
| 8 | Quantidade e unidade do avulso | Lacuna confirmada | P1 |
| 9 | Modalidade de cobrança do avulso | Parcial / decisão | P1 |
| 10 | Custo dos participantes do avulso | Alinhado / decisão de uso | P0 |
| 11 | Avulso não é diária/HE individual | Alinhado | P0 |
| 12 | Terminologia: serviço avulso × adicional | Alinhado, clareza a preservar | P2 |
| 13 | Fechamento e competência de cobrança | Alinhado | P0 |
| 14 | Conferência e Excel/Dynamis | Premissa antiga corrigida | P1 |
| 15 | Resultado por tipo de serviço | Lacuna parcial | P2 |
| 16 | Receita, custo previsto e pagamento efetivo | Alinhado | P0 |
| 17 | Nota fiscal e recebimentos | Fora do MVP aprovado | P3 |

### 1. Jornada fixa, HE e saída antecipada

- **Regra esperada:** Jornada líquida de referência 8h, HE de 50% e saída antecipada proporcional, respeitadas condições contratuais.
- **Main comprovada por fonte:** Núcleo por vigência/V2 e snapshots implementados. Motor de preço e classificação dependem de capacidades/flags; existir código não prova ativação.
- **Candidato #111:** Mesmo núcleo financeiro; correções de jornada zero/UI e prévia de preço foram agregadas. Não são uma nova regra comercial.
- **Impacto e prioridade:** P0 — Cobrança incorreta se a configuração real divergir do contrato; uso de preço genérico com resolução OFF pode não representar a negociação.
- **Correção proposta:** Reutilizar núcleo e testes; conferir uma configuração financeira de referência do cliente-piloto e os caminhos ON/OFF, sem reescrever o motor.
- **Critério de aceite:** Presença/falta/substituição, 8h, saída antecipada, meia-noite, tolerância e arredondamento conciliados com valores aprovados; faturados não mudam.
- **Dependências/riscos/validação:** Contrato e vigências corretos; decisão de preços do item4; homologação do candidato. Evidência histórica C01/C02/C05, não PASS novo.
- **Evidências:** K1,K2,K7,K8. Estado: Alinhado condicionado; não é teste novo aprovado nesta sessão.

### 2. Sábado: cobrança e custo

- **Regra esperada:** Até4h diária integral; acima, diária+excedente. Cobrança HE50%; custo usa hora acordada do colaborador, separado da receita.
- **Main comprovada por fonte:** Núcleo usa referência240min e preserva diária; custo HE usa valor-hora acordado; na ausência, fallback técnico custo diário/8, sem fator de cobrança.
- **Candidato #111:** Mesmo núcleo; edição de custo no cadastro vira vigência e preserva hora HE acordada já existente.
- **Impacto e prioridade:** P0 — Confundir HE cobrada e paga ou omitir parâmetros do colaborador altera margem.
- **Correção proposta:** Não refazer fórmula; validar parâmetros e exceções contratuais reais. Explicitar o fallback existente sem apresentá-lo como valor efetivamente negociado.
- **Critério de aceite:** 4h=diária; excedente tratado separadamente por receita/custo, com tolerância do contrato; mudança futura de custo não altera snapshots.
- **Dependências/riscos/validação:** BS confirma exceções de sábado e valores-hora do piloto. C03 histórico comprova casos, não todas as exceções; sem nova regra presumida.
- **Evidências:** K1,K7,K10. Estado: Alinhado condicionado; não é teste novo aprovado nesta sessão.

### 3. Domingo, feriado e território

- **Regra esperada:** Horas efetivas com acréscimo100%; feriados nacionais/SC e dos seis municípios previstos no negócio.
- **Main comprovada por fonte:** 043/044 existem: cálculo especial, cobertura territorial e localidade; com resolução OFF o caminho histórico não aplica automaticamente a regra especial.
- **Candidato #111:** Mesmas regras; testes/runner territorial e UX melhorados, sem ativação remota. HML foi registrado com resolução OFF.
- **Impacto e prioridade:** P0 — Preço e classificação errados se o usuário tomar cadastro de feriado/código instalado por regra ativa.
- **Correção proposta:** Reutilizar calendário/motor. Preparar homologação autorizada com cobertura e localidade reais do piloto; ativação é gate próprio.
- **Critério de aceite:** Domingo que também é feriado recebe fator uma vez; sem cobertura/localidade fica pendente; ON/OFF e horários efetivos comprovados.
- **Dependências/riscos/validação:** Configuração/flags e parâmetros do cliente; sem ligar nada nesta tarefa. C03 histórico; S19 não repetiu o caminho comercial ON.
- **Evidências:** K1,K2,K7,K8. Estado: Alinhado condicionado; não é teste novo aprovado nesta sessão.

### 4. Diária individual e precedência de preços

- **Regra esperada:** Valores podem variar por profissional, função, turno e contrato; reajustes e vigência operacional devem ser confirmados pela BS.
- **Main comprovada por fonte:** 041/042 e cadastros já existem. Com resolução OFF prevalece diária genérica; ON exige resolução adequada. Não há recuo terceiro nível da048.
- **Candidato #111:** 048 e preco-do-dia propõem individual > função/período > preço-base quando resolução ON. Aplicação apenas local; aprovação definitiva do recuo pendente.
- **Impacto e prioridade:** P0 — Pode cobrar valor diferente do negociado ou bloquear lançamentos sem tarifa. É decisão material de receita, não só UX.
- **Correção proposta:** Obter decisão explícita: usar preço-base ou bloquear quando faltarem individual/tarifa. Reutilizar o código candidato apenas após revisão dessa decisão e do reajuste.
- **Critério de aceite:** ON/OFF, precedência, ausência de tarifa, vigência inicial/fim exclusivo, reajuste futuro/retroativo permitido e preservação de faturados conciliados com a BS.
- **Dependências/riscos/validação:** Decisão C1/C2 e implantação separada de048/flags; não herdar E2E local como homologação HML. B02 histórico não aprova o novo fallback.
- **Evidências:** K2,K7,K10. Estado: Decisão comercial / prontidão; não é teste novo aprovado nesta sessão.

### 5. Função operacional e categoria de preço

- **Regra esperada:** Identificar função real entre as nove citadas; categoria de preço pode agrupar funções conforme negociação.
- **Main comprovada por fonte:** employee.role é texto livre. job_function_id é separado;039 cria quatro funções INICIAIS, não limite de quatro. Há catálogo extensível e RPC/tela de nova função.
- **Candidato #111:** Preserva o catálogo e o texto; custo no cadastro melhorado. No cadastro atômico, função padrão pode exigir edição posterior conforme capacidade.
- **Impacto e prioridade:** P1 — A matriz antiga induz a criar outro catálogo ou supor que funções reais se perdem; isso duplicaria algo já existente.
- **Correção proposta:** Reutilizar os campos e catálogo; cadastrar/mapear somente com a BS quais funções têm preço próprio e quais são agrupadas. Sem hardcode de nove categorias.
- **Critério de aceite:** Nove rótulos reais identificáveis; função de alocação e preço corretos na data/turno, sem apagar texto/histórico. Testar o fluxo de cadastro e edição completo.
- **Dependências/riscos/validação:** Decisão C3, classificações e tarifas do piloto. Capacidade de UI depende do schema; nenhum novo catálogo necessário só por haver nove nomes.
- **Evidências:** K3,K9. Estado: Premissa antiga corrigida; não é teste novo aprovado nesta sessão.

### 6. Tipos de serviço avulso

- **Regra esperada:** Avulso é conjunto de atividades pontuais; contêiner é um dos tipos, não o conjunto inteiro. Catálogo inicial extensível documentado no #112.
- **Main comprovada por fonte:** Existe operação spot por diária e módulo Containers por serviço. Este último não possui catálogo genérico de tipos, e a UI o apresenta como contêiner.
- **Candidato #111:** Melhora spot e Containers, mas não implementa o catálogo genérico. Não confundir validação de operação avulsa com generalização do módulo.
- **Impacto e prioridade:** P1 — Caminhões/paletes/embalagem/retrabalho não ficam identificados adequadamente; risco de usar o fluxo financeiro errado.
- **Correção proposta:** Evoluir o módulo existente de serviços pontuais com tipo explícito e rótulos coerentes, preservando a operação spot diária e sem faturar um trabalho duas vezes.
- **Critério de aceite:** Cada tipo aprovado pode ser registrado/listado e relacionado ao cliente/equipe; contêiner continua funcionando e histórico preservado.
- **Dependências/riscos/validação:** Itens8/9 e decisões de modalidade. Tela administrativa para cadastrar tipos continua fora do MVP acordado; evitar arquitetura/catálogo paralelo.
- **Evidências:** K4,K9,K10. Estado: Divergência confirmada; não é teste novo aprovado nesta sessão.

### 7. Pedido e execução no mesmo dia

- **Regra esperada:** Pedido e execução no mesmo dia são permitidos; não há antecedência universal de um dia.
- **Main comprovada por fonte:** 045 exige requested_on < executed_on na tabela e normalizador; TypeScript recusa solicitadoEm >= executadoEm. Formulário usa esse domínio.
- **Candidato #111:** Mesma restrição. A049 de correção não elimina a normalização original; continua impedido, inclusive no candidato.
- **Impacto e prioridade:** P0 — Impede registrar atendimento urgente real; é contradição objetiva de regra já confirmada.
- **Correção proposta:** Primeira correção funcional recomendada: migration nova (não editar045), normalizador, domínio/formulário, correção e testes alinhados à nova regra.
- **Critério de aceite:** Mesmo dia e pedido anterior passam; pedido posterior/data inválida falham sem gravação parcial; custo/receita/idempotência/imutabilidade faturada preservados.
- **Dependências/riscos/validação:** FUNC-01 autorizou desenvolvimento em branch/PR próprios; implementação sob preparação, aplicação remota exige outra autorização. D06 histórico PASS recusava mesmo dia e tem esperado superado em 08/11, não deve ser reutilizado para aprovar a regra nova.
- **Evidências:** K4,K5,K7. Estado: Divergência confirmada; não é teste novo aprovado nesta sessão.

### 8. Quantidade e unidade do avulso

- **Regra esperada:** Tipo, unidade de cobrança e quantidade devem ser identificados por serviço.
- **Main comprovada por fonte:** Quantidade inteira de contêineres existe; não há unidade genérica por serviço.
- **Candidato #111:** Mesmo modelo de quantidade; resumos de custos e UI não acrescentam unidade ou catálogo de serviço.
- **Impacto e prioridade:** P1 — Não representa corretamente paletes, caminhões ou outras unidades; preço/relatório podem ser interpretados incorretamente.
- **Correção proposta:** Adicionar o mínimo de informação de unidade ligado ao tipo no módulo existente. Definir com o cliente unidades e precisão; não presumir fracionamento.
- **Critério de aceite:** Tipo/unidade/quantidade persistem e aparecem na conferência; unidades incompatíveis são recusadas; histórico monetário continua idêntico.
- **Dependências/riscos/validação:** Item6 e decisão C5; evolução de schema/compatibilidade e autorização própria. Não converter quantidade de contêiner em número de diárias ou de pessoas.
- **Evidências:** K4. Estado: Lacuna confirmada; não é teste novo aprovado nesta sessão.

### 9. Modalidade de cobrança do avulso

- **Regra esperada:** Diária, unidade ou valor fechado são possibilidades; só a referência diária de contêiner foi informada, demais práticas ainda a confirmar.
- **Main comprovada por fonte:** Total negociado representa valor fechado sem modalidade explícita; spot já admite preço por diária, em outro fluxo. Não existe cálculo genérico por unidade no serviço pontual.
- **Candidato #111:** Valida melhor data/preço da spot e esclarece seu rótulo por diária; Containers continua total negociado. Não são três modalidades genéricas prontas.
- **Impacto e prioridade:** P1 — Inferir preço unitário ou reaproveitar diária individual de operação fixa pode gerar cobrança indevida.
- **Correção proposta:** Confirmar modalidades praticadas por tipo antes de definir cálculo. Preservar valor fechado existente e evoluir somente o que a BS aprovar.
- **Critério de aceite:** Modalidade fica explícita e total confere com negociação aprovada; quantidade não muda total automaticamente sem regra autorizada; diária individual continua independente.
- **Dependências/riscos/validação:** Decisão C5, itens6/8; não implementar fórmula genérica por suposição nem duplicar o fluxo spot.
- **Evidências:** K4,K10. Estado: Parcial / decisão; não é teste novo aprovado nesta sessão.

### 10. Custo dos participantes do avulso

- **Regra esperada:** Valor devido informado por profissional; prática por pessoa ou total distribuído ainda requer confirmação.
- **Main comprovada por fonte:** por_pessoa e total_distribuido já existem; participantes com custo em centavos e validação de soma, sem status de pagamento realizado.
- **Candidato #111:** Reutiliza o modelo; melhora carregamento/visibilidade/resumo de custos e correção auditada via049, ainda não aplicada no HML.
- **Impacto e prioridade:** P0 — Modalidade escolhida sem refletir a negociação ou soma incorreta distorce custo/margem.
- **Correção proposta:** Não criar outro motor de custo; confirmar a prática e homologar o fluxo existente, mantendo controles de soma e participantes.
- **Critério de aceite:** Soma exata inclusive centavos, ausência de duplicidade de participante, zero explícito, custo interno sem exposição ao cliente/operacional.
- **Dependências/riscos/validação:** Decisão C4; D02/D03/D09 históricos, nova UX/correção não homologadas integralmente. Sem folha ou baixa de pagamento.
- **Evidências:** K4,K5,K7. Estado: Alinhado / decisão de uso; não é teste novo aprovado nesta sessão.

### 11. Avulso não é diária/HE individual

- **Regra esperada:** Diária comercial do serviço avulso não se confunde com diária individual da operação fixa.
- **Main comprovada por fonte:** Containers gera serviço/adicional com receita única e custo por participante, sem gerar presença, diária ou HE.
- **Candidato #111:** Mantém separação;049 troca registro por substituição auditada, sem transformar serviço em jornada.
- **Impacto e prioridade:** P0 — Duplicar receita/custo ao generalizar avulsos ou misturar com spot/diárias é risco financeiro.
- **Correção proposta:** Preservar o modelo existente e cobrir essa separação como regressão obrigatória em toda evolução de avulsos.
- **Critério de aceite:** Um serviço gera uma receita; nenhum apontamento/HE é criado; correção/cancelamento respeitam histórico e lastro faturado.
- **Dependências/riscos/validação:** Compatibilidade045/049 e itens6/9; testar com operação opcional do mesmo cliente sem dupla cobrança.
- **Evidências:** K4,K5,K7. Estado: Alinhado; não é teste novo aprovado nesta sessão.

### 12. Terminologia: serviço avulso × adicional

- **Regra esperada:** Atividade pontual e valor adicional de período são conceitos distintos.
- **Main comprovada por fonte:** billing_additionals é receita adicional; Containers cria origem própria protegida. Operação spot não é sinônimo do adicional.
- **Candidato #111:** Faturamento em abas facilita uso, sem eliminar a distinção de domínio.
- **Impacto e prioridade:** P2 — Renomear tudo como avulso sem diferenciar origens pode levar a duplicidade e cancelamento impróprio.
- **Correção proposta:** Clarificar rótulos no lote de avulsos, reutilizando as entidades atuais e preservando o vínculo protegido de origem.
- **Critério de aceite:** Usuário distingue serviço pontual, operação spot e adicional; adicional originado por serviço não pode ser cancelado isoladamente.
- **Dependências/riscos/validação:** Item6/11 e validação de linguagem com a BS; sem migration apenas para trocar o nome de uma tela.
- **Evidências:** K4,K9,K10. Estado: Alinhado, clareza a preservar; não é teste novo aprovado nesta sessão.

### 13. Fechamento e competência de cobrança

- **Regra esperada:** Quinzenal/mensal conforme cliente; avulso pode ser cobrado em competência diferente da execução.
- **Main comprovada por fonte:** 038 e045 validam frequência/competência separada da execução e fatura no período correto.
- **Candidato #111:** Preserva modelo; melhora validações de datas/intervalos e faturamento.046/047 endurecem integridade/idempotência, ainda não aplicadas no HML.
- **Impacto e prioridade:** P0 — Serviço no período errado, duplicação ou soma divergente comprometem faturamento.
- **Correção proposta:** Reutilizar fechamento e reforços existentes; homologar o lote financeiro em vez de criar novo fechamento.
- **Critério de aceite:** 1–15,16–fim e mensal, virada de mês, competência diferente da execução, arredondamento e soma fatura=itens=receita; reemissão não duplica.
- **Dependências/riscos/validação:** Frequência do cliente, versões históricas e implantação autorizada046/047. D08/E01 e suítes de concorrência locais são evidências de escopos diferentes.
- **Evidências:** K5,K6,K7. Estado: Alinhado; não é teste novo aprovado nesta sessão.

### 14. Conferência e Excel/Dynamis

- **Regra esperada:** Conferência ocorre fora do sistema, por planilha/e-mail/WhatsApp; não exige novo módulo de aprovação interna.
- **Main comprovada por fonte:** Exportação existe; E03/E04 registram Excel real com filtros e totais. E06 foi fechado na sessão14 com referência Dynamis e diferenças explicadas.
- **Candidato #111:** Núcleo de exportação/homologação histórica preservado; nova UI/faturamento/CSV e futuros dados do candidato exigem regressão focada, não recertificação automática.
- **Impacto e prioridade:** P1 — A frase antiga de que Excel real não foi homologado está desatualizada; também seria errado declarar paridade monetária Dynamis/V2.
- **Correção proposta:** Corrigir o diagnóstico e reutilizar evidências/fixtures aprovadas. Revalidar apenas alterações e o ciclo de exportação do candidato final.
- **Critério de aceite:** Excel cliente sem custo/margem, fórmulas/AutoFilter/SUBTOTAL e totais corretos; divergências históricas explicadas por regra, sem forçar igualdade com planilha antiga.
- **Dependências/riscos/validação:** E03/E04/E06 históricos e dados autorizados; não copiar planilha real para Git nem tratar27 PASS como homologação de todo #111.
- **Evidências:** K7,K8,K9. Estado: Premissa antiga corrigida; não é teste novo aprovado nesta sessão.

### 15. Resultado por tipo de serviço

- **Regra esperada:** Acompanhar resultado por cliente/período/operação/tipo, sem confundir contribuição econômica com lucro líquido.
- **Main comprovada por fonte:** Dashboard/Relatórios/Fechamento/Faturamento já incluem custo de Containers; não há dimensão genérica de tipo do serviço.
- **Candidato #111:** Melhora moeda/CSV/resumo de custos, mas não cria a dimensão de tipo.
- **Impacto e prioridade:** P2 — Totais existentes são úteis; falta análise por tipo para comparar atividades avulsas.
- **Correção proposta:** Adicionar recorte por tipo depois do catálogo, reaproveitando resumos e regras financeiras existentes.
- **Critério de aceite:** Soma dos grupos=total do mesmo recorte; execução/competência coerentes; custo/margem somente na visão interna.
- **Dependências/riscos/validação:** Item6/8, capacidade de dados históricos sem tipo e escopo do relatório requerido para o piloto. Não recalcular faturas históricas.
- **Evidências:** K4,K7,K9,K10. Estado: Lacuna parcial; não é teste novo aprovado nesta sessão.

### 16. Receita, custo previsto e pagamento efetivo

- **Regra esperada:** Cobrança e valor devido são apurações distintas; folha/baixa de pagamento estão fora do MVP atual.
- **Main comprovada por fonte:** Receita e custo previstos separados, snapshots e restrições de exposição. Não é controle de pagamento realizado.
- **Candidato #111:** Mesma separação; UX de custo por vigência, integridade046/047 e correção049 acrescentam controles, não folha.
- **Impacto e prioridade:** P0 — Tratar custo previsto como quitado ou margem como lucro líquido gera interpretação financeira errada.
- **Correção proposta:** Manter avisos, separação e conciliação; aproveitar controles existentes sem criar folha/contas a pagar.
- **Critério de aceite:** Receita e custo reconciliam independentemente; exportação do cliente não revela custo; faturado imutável e sem estado de pagamento fictício.
- **Dependências/riscos/validação:** Cadastro de custos, decisões de participantes e integridade de fatura. D09 histórico; novos reforços dependem de homologação/implantação separadas.
- **Evidências:** K4,K5,K7,K9. Estado: Alinhado; não é teste novo aprovado nesta sessão.

### 17. Nota fiscal e recebimentos

- **Regra esperada:** Fazem parte do ciclo real da BS, mas foram expressamente excluídos da entrega atual no #112.
- **Main comprovada por fonte:** Fluxo descrito/implementado apura e gera fatura interna; não oferece emissão fiscal nem conciliação de recebimentos no escopo examinado.
- **Candidato #111:** Não acrescenta esses módulos; mantém o limite da entrega.
- **Impacto e prioridade:** P3 — O ciclo externo continua necessário, mas sua ausência não é defeito contra o MVP delimitado.
- **Correção proposta:** Manter operação fiscal/recebimentos fora desta implementação; só abrir lote futuro se a BS alterar o escopo.
- **Critério de aceite:** MVP não promete NF, cobrança bancária, recebimento ou folha; usuário sabe onde o ciclo externo continua.
- **Dependências/riscos/validação:** Sem novo provedor, integração financeira ou arquitetura nesta tarefa. Mudança de escopo exige decisão própria.
- **Evidências:** B,K9. Estado: Fora do MVP aprovado; não é teste novo aprovado nesta sessão.

## Decisões a obter sem inventar regra

| ID | Decisão necessária | Enquanto não houver resposta |
| --- | --- | --- |
| C1 | Na ausência de preço individual/tarifa, cobrar preço-base(048) ou bloquear? | Não homologar/ativar o novo fallback como regra aprovada; preservar comportamento OFF e histórico. |
| C2 | Quem efetiva reajuste individual, em qual data, e quando retroatividade é permitida? | Usar mecanismo de vigência existente; nenhum reprocessamento de faturados. |
| C3 | Quais funções têm preço próprio por cliente/turno e quais são agrupadas? | Não mapear automaticamente nove funções em quatro iniciais nem criar catálogo duplicado. |
| C4 | Nos avulsos, valor por participante ou total distribuído? | Não impor rateio igual ou usar custo previsto como pagamento realizado. |
| C5 | Quais modalidades/unidades de avulsos são efetivamente praticadas? | Preservar total negociado; não criar multiplicação por unidade/diária como regra presumida. |
| C6 | Quais exceções contratuais de sábado e parâmetros de hora paga valem no piloto? | Não aplicar uma regra global acima do contrato; cadastrar valor acordado e explicitar fallback técnico quando houver. |

## Prioridade do primeiro uso, na ordem solicitada

| Frente | Aproveitar | Pendência para primeiro uso |
| --- | --- | --- |
| 1.Clientes/colaboradores | CRUD, vigências, catálogo e UX candidata | Validar dados reais do piloto, mapeamento comercial e preço/custo vigente, sem reimplementar cadastro. |
| 2.Fixas/avulsos | Operações/spot/Containers/equipes existentes | Identificar fluxo correto; mesmo dia e catálogo/unidade não estão resolvidos pelo #111. |
| 3.Apontamentos/jornadas | Núcleo, snapshots e correções S19 | Regredir jornada zero, saída antecipada, faltas/substituição/meia-noite e recarga no candidato. |
| 4.Diárias por função/turno/contrato | 041/042, tabelas e editor existentes | C1–C3, flags e esquema compatível; não confundir cadastro de tarifa com cobrança ativa. |
| 5.HE/sábado/feriado | V2/calendário e matrizes históricas | Parâmetros do contrato, cobertura/localidade e prova ON/OFF no lote autorizado. |
| 6.Custos/pagamentos | Vigências/participantes e resumo | Confirmar prática e conciliar previsto; folha/baixa financeira continuam externas. |
| 7.Fechamento/faturamento | Frequência, competência e exportações | Homologar reforços046/047, cenários mistos e resultado desconhecido/repetição. |
| 8.Containers/retrabalhos | Registro/cancelamento/idempotência | Generalização mínima e049 auditada; nunca apagar lastro ou misturar jornada/serviço. |
| 9.Segurança/permissões/backup | RLS/MFA/papéis e runbooks já aprovados | Completar controles E2E pendentes e pré-requisitos de rollout; sem auditoria ampla ou limpeza de HML agora. |
| 10.Homologação ponta a ponta | Livro484 controles+matriz27 casos+E2Elocal | Executar somente deltas e fluxo integrado com evidência por ambiente; só depois decisão de piloto/Production. |

## Lotes enxutos e dependências

1. **Lote0 — referência funcional e decisões.** Publicação deste plano/pausa
   autorizada na FUNC-01 em PR documental próprio; reconciliar documentos do #112 seletivamente,
   preservando HANDOFF atual. Definir estratégia autorizada para atualizar #111 com
   main, mantendo main:false, validador/CI e controlador OFF. Reutilizar #106/#108–110
   já incorporados no candidato, sem novas versões paralelas ou rebase/force push.
   Gate: base/escopo exatos, C1–C6 registradas no que afetar o piloto.
2. **Lote1 — cadastro e base financeira utilizáveis.** Reutilizar UX e correções
   prontas do #111, preços por vigência e custo do colaborador; tratar decisão048
   antes de validar o fallback. Preparar integração/homologação em commits pequenos
   e revisáveis; nenhum merge da release por esta recomendação.
   Gate: cadastro→contrato→função/turno→apontamento→preço/custo conforme negociação,
   comportamento OFF e históricos preservados. Sem recalcular faturados.
3. **Lote2 — primeira correção nova: mesmo dia(item7).** Desenvolvimento FUNC-01
   autorizado em branch/PR separado, base main75c47cd, sob preparação. Alterar regra em migration NOVA, domínio,
   normalização/formulário/correção e expectativas superadas do D06; testes de
   mesmo dia/anterior/posterior, replay, cancelamento, fatura e compatibilidade.
   Não reservar número de migration nem aplicá-la remotamente nesta etapa.
4. **Lote3 — Serviços Avulsos mínimo(itens6/8/9/15).** Depois das decisões de modo
   e unidade, evoluir módulo existente por tipo/unidade/quantidade/valor negociado;
   reaproveitar participantes, competência, idempotência e trilha. Preservar spot
   diária e dados antigos; não construir nova arquitetura ou motor financeiro.
   Gate: os tipos aprovados funcionam sem duplicidade, custo/vínculo histórico
   conservados e recorte por tipo quando necessário ao piloto.
5. **Lote4 — homologação financeira integrada.** Reutilizar testes046/047/048/049,
   controles S19 ainda pendentes, matriz27 casos e Excel aprovado. Qualquer aplicação
   em HML exige autorização própria e plano compatível com045 e histórico existente;
   sem resets/limpeza do HML. Executar receita/custo/competência/fatura/Excel,
   recuperação de resposta perdida e autorização por papel no candidato final.
   Gate: nenhum P0 aberto, cada teste com SHA/ambiente/resultado, sem transformar
   CI ou stack local em homologação hospedada.
6. **Lote5 — piloto operacional e rollout separado.** Somente após homologação,
   aceite do responsável e plano de implantação/backup/restauração já existente
   atualizado para o schema final. Production ainda034 segundo último registro;
   não pular migrations nem publicar só por merge. Gate 1 contém deploy Git, não
   autoriza deploy manual, promoção, dados reais ou liberação de operador.
   Gates de infraestrutura3–5 ficam pausados e não são pré-requisito do SaaS.

Lote1 continua dependente da base/decisões pertinentes. Há uma implementação ativa
por vez: FUNC-01, item7, em branch/PR separados e sob preparação. A escolha segue:
regra confirmada, bloqueio objetivo e aceite determinístico; não depende de inventar
política comercial. Isso não substitui as decisões financeiras P0 do Lote1.

## O que já pode ser aproveitado e o que impede uso real

Pode ser reaproveitado para desenvolvimento/homologação: cadastros, operações e
jornadas, preços/custos por vigência, módulo Containers, fechamento/fatura/Excel e
segurança existentes. Há partes historicamente exercitadas no HML; isso não é
liberação geral do candidato ou da Production atual. O módulo genérico de avulsos
não está pronto. NF/recebimentos/folha não são bloqueios contra o MVP delimitado.

Impedem declarar a primeira versão pronta: decisões comerciais pendentes,
resolução OFF versus preço esperado, schemas046–049 não homologados no HML,
restrição de mesmo dia e generalização de avulsos pendentes, NO-GO S19 e controles
não testados/bloqueados, reconciliação dos PRs e rollout autorizado ainda ausentes.
Não foi realizada operação real de cliente nesta tarefa.

## Evidências verificáveis por SHA

- **K1**: [núcleo financeiro](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/src/lib/nucleo-financeiro.ts), [dias especiais043](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/supabase/migrations/20261110120000_043_dias_especiais_v2.sql).
- **K2**: [preço do dia candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/src/lib/preco-do-dia.ts), [048 candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/supabase/migrations/20261115120000_048_preco_base_como_recuo.sql).
- **K3**: [cadastro main](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/src/app/%28painel%29/colaboradores/painel-colaboradores.tsx), [RPC/catálogo funções](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/src/lib/funcoes-dados.ts), [039 extensível](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/supabase/migrations/20261106120000_039_funcoes_e_periodo_do_turno.sql).
- **K4**: [domínio Containers](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/src/lib/container-servico.ts), [schema/normalizador045](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/supabase/migrations/20261112120000_045_container_servico.sql).
- **K5**: [049 candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/supabase/migrations/20261116120000_049_correcao_servico_container.sql), [046 candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/supabase/migrations/20261113120000_046_imutabilidade_fatura_com_adicionais.sql), [047 candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/supabase/migrations/20261114120000_047_idempotencia_adicionais.sql).
- **K6**: [frequência038](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/supabase/migrations/20261105120000_038_periodo_contratual.sql).
- **K7**: [matriz FIN-PR-13, casos e ressalvas](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/docs/financeiro/homologacao-fin-pr-13.md).
- **K8**: [S19 e NO-GO](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/homologacao-sessao-19.md), [roteiro candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/homologacao-release-preview-01.md).
- **K9**: [manual da main](https://github.com/therunnas/bslogistica/blob/75c47cd9a30e4888b197ca6ae27aa236c71ec589/docs/MANUAL_DE_USO.md).
- **K10**: [estados/local versus HML do candidato](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/ESTADO_DO_PROJETO.md), [operação spot por diária](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/src/lib/operacao-modalidade.ts), [custo por vigência](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/src/lib/colaborador-custo.ts).

Nenhuma evidência histórica é convertida em teste executado nesta tarefa. A
publicação destes cinco documentos foi autorizada na FUNC-01 em PR Draft próprio;
merge, homologação e aplicação remota continuam sem autorização.
