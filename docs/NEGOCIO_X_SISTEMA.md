# Negócio × sistema

Registro do alinhamento entre o funcionamento real da BS Soluções Logísticas, o comportamento
esperado do sistema e o que está implementado. Criado em 08/11/2026, sobre `origin/main` em
`38b43490a8e0913c62a4ee6047ef48a8288ca0dc`. Este documento **não autoriza** implementação,
migration, ativação nem mudança de ambiente.

## Como ler

Há três camadas, e uma não vira a outra automaticamente:

| Camada                 | Onde está                                                                                             | Pergunta que responde             |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| Funcionamento real     | [NEGOCIO.md](NEGOCIO.md)                                                                              | Como a BS trabalha?               |
| Comportamento esperado | Este documento, coluna "Esperado"                                                                     | O que o sistema deve representar? |
| Implementado           | Este documento, coluna "Implementado"; estado mutável em [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md) | O que a `main` faz hoje?          |

Uma decisão de modelagem do sistema não é regra de funcionamento da BS. Um item de
[NEGOCIO.md](NEGOCIO.md) marcado como "a confirmar" (seção 15) não pode ser tratado como prática
real nem codificado como regra fixa.

Implementado significa **código na `main`**. Não significa schema aplicado: HML está na migration
045 e Production na 034. A resolução comercial continua OFF.

## Regras confirmadas nesta etapa

Registradas pelo responsável em 08/11/2026. As definições de sábado foram recuperadas das
decisões de 26 e 30/10/2026.

1. **Operação fixa** é serviço recorrente contratado, normalmente por diárias. **Serviço avulso**
   é atividade pontual, com ou sem operação fixa do mesmo cliente. Contêiner é um tipo de serviço
   avulso, não o conjunto.
2. Catálogo inicial de tipos de serviço avulso: carga e descarga de contêineres, de caminhões e de
   paletes; montagem, desmontagem e organização de paletes; embalagem e empacotamento;
   movimentação e organização de mercadorias; retrabalhos logísticos; outros serviços
   operacionais. O catálogo não deve impedir novos tipos.
3. Um serviço avulso pode ser solicitado e executado no mesmo dia. Não existe exigência universal
   de antecedência de um dia.
4. A cobrança do avulso deve poder ser por diária, por unidade ou por valor fechado. São
   possibilidades de modelagem; só a diária para contêineres foi informada como referência. A
   diária comercial do avulso não se confunde com a diária individual do motor das operações
   fixas.
5. Sábado, cobrança ao cliente: até 4 horas trabalhadas, diária integral; acima, diária integral
   mais horas extras sobre o excedente, com acréscimo de 50%. Sábado, pagamento ao colaborador:
   até 4 horas, diária normal; acima, diária normal mais as horas extras do excedente, com
   valor-hora previamente acordado, que pode variar por função e não é necessariamente igual ao
   cobrado. A expressão antiga "pagamento sábado: só HE" refere-se ao tratamento do excedente, não
   à exclusão da diária normal.
6. Nota fiscal e acompanhamento de recebimentos fazem parte do funcionamento real, mas **estão
   fora do escopo da entrega atual** (seção "Fora do escopo atual").

## Decisões anteriores superadas

O histórico é preservado; estes itens deixam de valer como regra de negócio.

| Decisão anterior                                          | Onde aparece                                                                                  | Situação                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| "Pedido até um dia antes da execução" (30/10/2026)        | [container-servico-avulso.md](financeiro/container-servico-avulso.md); código; manual         | Superada pela regra 3. O código ainda a impõe.    |
| "Container é serviço avulso" como definição do conjunto   | [container-servico-avulso.md](financeiro/container-servico-avulso.md); `ESTADO_DO_PROJETO.md` | Superada pela regra 1.                            |
| "Pagamento no sábado" como regra não confirmada           | `ARQUITETURA.md`                                                                              | Superada pela regra 5. Corrigida neste PR.        |
| "Cobrança no feriado e domingo" como regra não confirmada | `ARQUITETURA.md`                                                                              | Já implementada e confirmada; corrigida neste PR. |

## Divergências entre o negócio e a implementação

Legenda: **Alinhado**, **Divergente** (o código contradiz o negócio), **Lacuna** (o negócio exige
algo que o sistema não tem), **A confirmar** (o negócio ainda não confirmou).

| #   | Tema                                                                              | Negócio                                                                               | Implementado na `main`                                                                                                                                                      | Situação                                                                                 |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Operações fixas: jornada de 8 h, hora extra de 50%, saída antecipada proporcional | Confirmado                                                                            | Motor por vigência, núcleo V2 (035–043); resolução comercial OFF                                                                                                            | Alinhado                                                                                 |
| 2   | Sábado: cobrança e pagamento                                                      | Regra 5                                                                               | `nucleo-financeiro.ts`: referência de 4 h; diária inteira até 4 h; HE acima, inclusive no pagamento; valor-hora acordado da versão de custo do colaborador, ou diária ÷ 8 h | Alinhado no código. `ARQUITETURA.md` estava desatualizada                                |
| 3   | Domingo e feriado                                                                 | Horas efetivas com acréscimo de 100%; feriados nacionais, de SC e dos seis municípios | Dias especiais V2 (043) e calendário territorial (044)                                                                                                                      | Alinhado                                                                                 |
| 4   | Diária individual                                                                 | Valores por profissional; rotina de reajuste não confirmada                           | Diária individual por vigência (042), alterada por admin                                                                                                                    | A confirmar (a rotina real)                                                              |
| 5   | Funções                                                                           | Nove funções operacionais; categoria de preço pode agrupá-las                         | Catálogo de preço com quatro categorias (039): auxiliar de produção, conferente, operador, administrativo                                                                   | A confirmar. Como a função operacional livre é registrada não foi verificado nesta etapa |
| 6   | Serviço avulso: tipos                                                             | Catálogo da regra 2, extensível                                                       | Módulo "Containers" (045): sem tipo de serviço; rotas, menu e rótulos de contêiner                                                                                          | Divergente                                                                               |
| 7   | Serviço avulso: data do pedido                                                    | Mesmo dia permitido                                                                   | Exige `requested_on < executed_on` em quatro camadas: restrição da tabela, `normalizar_payload_container`, validador TypeScript e formulário                                | Divergente                                                                               |
| 8   | Serviço avulso: quantidade e unidade                                              | Tipo, unidade de cobrança e quantidade identificados                                  | Quantidade sempre de contêineres; sem unidade                                                                                                                               | Lacuna                                                                                   |
| 9   | Serviço avulso: modalidade de cobrança                                            | Diária, unidade ou valor fechado (a confirmar na prática)                             | Só valor total negociado; sem modalidade                                                                                                                                    | Lacuna / A confirmar                                                                     |
| 10  | Serviço avulso: pagamento aos participantes                                       | Valor devido por participante; por pessoa ou total dividido a confirmar               | Custo por participante, modalidades `por_pessoa` e `total_distribuido`                                                                                                      | Alinhado. A prática real é A confirmar                                                   |
| 11  | Diária do avulso × diária individual                                              | Não se confundem                                                                      | Container não gera diária, hora extra nem presença                                                                                                                          | Alinhado; agora explícito nos documentos técnicos                                        |
| 12  | Termo "serviço avulso"                                                            | Atividade pontual do cliente                                                          | "Adicional de serviço" nomeia `billing_additionals` (valores extras do período)                                                                                             | Manter os dois nomes separados                                                           |
| 13  | Fechamento quinzenal ou mensal; avulso em competência diferente                   | Confirmado                                                                            | Janela por frequência do cliente (038); competência de cobrança separada da execução                                                                                        | Alinhado                                                                                 |
| 14  | Conferência com o cliente                                                         | Fora do sistema (planilha, e-mail, WhatsApp)                                          | Excel do cliente no modelo Dynamis (FIN-PR-12)                                                                                                                              | A confirmar: não homologado com o Excel real                                             |
| 15  | Resultado por cliente, período, operação ou tipo de serviço                       | Confirmado                                                                            | Dashboard, Relatórios, Fechamento e Faturamento incluem o custo de Containers; não há recorte por tipo                                                                      | Lacuna enquanto não houver tipo                                                          |
| 16  | Cobrança e pagamento apurados separadamente                                       | Confirmado                                                                            | Receita e custo **previsto**; o custo previsto não é pagamento realizado nem folha                                                                                          | Alinhado                                                                                 |
| 17  | Nota fiscal e recebimentos                                                        | Parte do ciclo real                                                                   | Inexistentes                                                                                                                                                                | Fora do escopo atual                                                                     |

## Fora do escopo atual

Registrado por decisão do responsável em 08/11/2026. Não retira essas atividades do funcionamento
real da empresa; só delimita esta entrega. Avaliação futura.

- Emissão de nota fiscal.
- Acompanhamento de recebimentos e de prazos de pagamento por cliente.
- Folha de pagamento e baixa de pagamento realizado (o sistema calcula custo previsto).
- Etapa de aprovação do cliente dentro do sistema (a conferência ocorre fora).
- Cadastro de novos tipos de serviço avulso por tela de administração.

## Próximos passos e pendências

1. **Generalização de Serviços Avulsos** (itens 6 a 9 e 15): etapa separada, **não iniciada**.
   Exige análise de impacto, compatibilidade com os dados existentes (sem duplicidade financeira e
   sem alterar o cálculo das operações fixas) e autorização própria. O número da próxima migration
   deve ser verificado na `main` no momento; não está reservado por este documento.
2. [Manual de uso](MANUAL_DE_USO.md): a seção 10 descreve a tela atual e continua assim até a
   tela mudar. Não foi alterado por este alinhamento.
3. Confirmar com a BS os itens da seção 15 de [NEGOCIO.md](NEGOCIO.md) antes de transformá-los em
   regra do sistema.
4. Validar a exportação no modelo Dynamis com a planilha real (item 14).
