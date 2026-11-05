# Manual de uso — BS Soluções Logísticas (painel interno)

Manual operacional baseado nas telas e nos fluxos **implementados na `main`** (checkpoint
da sessão 14). Descreve o que o sistema faz hoje, sem prometer funções futuras. Onde um
comportamento depende de configuração do ambiente, isso está dito. Os valores financeiros
vêm sempre do banco; a tela só mostra uma prévia antes de salvar.

> **Estado de homologação.** Este manual descreve o sistema como ele foi exercitado em
> HML (homologação). Production está na migration 034: Containers, tarifas por função e
> período, diária individual, adicional diário, domingo/feriado V2 e calendário territorial
> **só existem depois da implantação 035–045** (ver
> [plano de Production](runbooks/producao-034-045.md)). Este manual não substitui essa
> implantação nem a homologação final.

## 1. Papéis e acesso

- **Administrador**: vê todo o menu (Dashboard, Apontamentos, Operações, Clientes e
  contratos, Colaboradores, Faturamento, Containers, Fechamento, Relatórios, Usuários) e
  a tela Segurança.
- **Operacional**: vê só **Apontamentos** (rota `/operacional`), apenas das operações que
  lhe foram atribuídas. Não vê valores financeiros nem as telas administrativas; ao abrir
  uma rota administrativa aparece "Área administrativa restrita".
- **Sem papel**: aparece "Acesso não liberado"; o administrador precisa conceder um papel.
- Quem tem os dois papéis é tratado como administrador.
- Não há cadastro público: contas nascem por **convite** do administrador.

## 2. Login, senha e verificação em duas etapas (MFA)

1. **Entrar**: e-mail e senha em `/login`.
2. **Esqueci minha senha**: informe o e-mail; a resposta é sempre a mesma, exista ou não
   a conta. No e-mail, o link abre uma página com o botão **Continuar**; só o clique valida
   o link (abrir ou pré-visualizar o e-mail não o consome). Depois defina a nova senha duas
   vezes. O link vale uma única vez e por tempo limitado; se expirar, peça outro.
3. **Verificação em duas etapas (opcional)**: em **Segurança** (`/configuracoes`),
   **Ativar autenticação em duas etapas** e leia o QR code no aplicativo autenticador. Depois
   de ativada, **todo login** pede o código de 6 dígitos; sem concluir o código o painel não
   libera. Nenhuma tela exige novo código depois do login. Para **desativar**, a interface
   pede um código novo.
4. **Recuperar senha com MFA ativa**: além do link, o sistema pede **um** código do aplicativo
   e não pede outro depois de redefinir.
5. Falha ao consultar o nível de verificação mostra "não foi possível verificar"; tente
   de novo. Não tente cadastrar outro fator nesse caso.

## 3. Usuários e permissões (administrador)

Tela **Usuários**:

- **Convidar usuário**: informe o e-mail e o **Papel** (Operacional é o padrão). A conta
  nasce com o convite e o papel é atribuído na mesma ação.
- **Primeiro acesso do convidado**: o convidado define a senha pelo fluxo **Esqueci minha
  senha** (seção 2). Dependendo do modelo de e-mail do convite configurado no Supabase, o
  link do convite pode apenas confirmar a conta e abrir a tela de login; nesse caso use
  "Esqueci minha senha". O modelo de e-mail é configurado fora do repositório.
- Engrenagem da conta: **Conceder/Revogar** papel, **Operações atribuídas** (escolha a
  operação e **Atribuir**; vale para o papel Operacional) e **Revogar acesso** (remove
  papéis e atribuições e bloqueia a conta; é reversível pela reativação).
- O **último administrador** não pode ser removido nem rebaixado.
- Toda alteração de papel é registrada na auditoria.

## 4. Clientes e contratos

Tela **Clientes e contratos**:

- **Cliente**: Nome, CNPJ, Contato, E-mail, Telefone, Observações, Status.
- **Contrato**: Cliente, Nome do contrato, Preço da diária, Jornada da diária (horas),
  Fator de hora extra, Tolerância (min), Vigente de, Vigente até (opcional). Na **vigência** do contrato
  definem-se também a frequência do fechamento (**Quinzenal** ou **Mensal**) e o modo de
  arredondamento da hora extra (**diário** ou **acumulado**); mudar a frequência só vale a
  partir do dia 1 de um mês.
- **Vigências**: para mudar preço ou regra, **registre uma nova vigência com motivo**; o
  histórico fica. Lançamentos já feitos mantêm o preço da data trabalhada. O campo "Fim da
  vigência" é **exclusivo**: uma vigência até 12/11 vale até 11/11.
- **Tarifas do contrato** (por função e período diurno/noturno) e **Diárias individuais**
  (por colaborador): cadastram **Vigente a partir de**, **Diária cobrada (R$)** e motivo.
  **Só passam a valer quando a resolução por função e período é ligada** (ação administrativa
  separada); enquanto desligada, o preço é a diária genérica do contrato.
- **Feriados** (tela de Clientes) e **Calendário territorial** (em Operações e
  Apontamentos): registrar feriado ou ponto facultativo com data, nome, âmbito (nacional,
  estadual, municipal), ato legal e fonte oficial, e a **cobertura anual por território**.
  O dia só é classificado como feriado/domingo/sábado com a **localidade da operação** e a
  cobertura do ano registradas; sem elas o dia fica "pendente" e o sistema não presume dia
  comum.

## 5. Operações, turnos e funções

- **Operações**: Cliente, Tipo (fixa ou avulsa), Nome, Local, **Contrato (regra de
  cobrança)**, Valor acordado por diária (avulsa), Data (avulsa), Observações.
- **Turnos**: Nome, Início, Fim, Intervalo (min), **Período do turno** (diurno/noturno).
  Turno que cruza a meia-noite é aceito. A jornada líquida de referência é de 8 horas.
- **Equipe**: cada colaborador ativo pertence a **uma** operação por vez.
- **Local da operação**: associa a operação a um município do catálogo (necessário para o
  calendário territorial e, com a resolução ligada, para apontar).
- **Funções** (Colaboradores → Catálogo de funções, **Nova função**): nomes únicos.

## 6. Colaboradores

Tela **Colaboradores**: Nome, Função, Função padrão, Documento, Telefone, **Custo por
diária (R$)** e **Custo vigente desde**, Status. O custo também é versionado por vigência,
com motivo. O custo é interno: não aparece no Excel do cliente nem para o operacional.

## 7. Apontamentos (diárias)

Tela **Apontamentos**: escolha **Operação**, **Turno** e **Data**; a tabela **Equipe do dia**
lista os colaboradores com Presença, Entrada, Saída e Intervalo, e mostra Trabalhado, Hora
extra, A faturar e Custo.

- **Presença**: **Presente**, **Falta** ou **Substituição**. **Falta não gera valor** nem custo.
- Entrada igual à saída é **recusada** (seria jornada de 24 h); o botão **Salvar** fica
  bloqueado e o que você digitou é mantido até corrigir.
- **Salvar** grava o dia inteiro; se o banco recusar, nada é gravado pela metade.
- **Fechar dia** fecha a folha e **Reabrir** a reabre. Folha fechada não aceita escrita.
- Uma diária por colaborador, operação e data; trabalhar além da jornada vira hora extra
  no mesmo lançamento.
- **Função do dia** ("Função trabalhada neste dia", com motivo) e **Adicional diário**
  (valor e motivo, só com a resolução ligada) são ações do próprio lançamento.
- **Lançamento faturado é imutável**; erros anteriores à fatura corrigem-se no próprio
  apontamento; depois da fatura só com tarefa administrativa própria.
- O **operacional** vê a mesma tela simplificada (`/operacional`), sem valores.

## 8. Horas extras, sábado, domingo e feriado

- **Dia útil**: referência líquida de 8 h. Saída antecipada paga **proporcionalmente**.
  A hora extra só existe acima da **tolerância** do contrato (padrão do exemplo: 10 min).
- **Arredondamento diário da hora extra** (minutos residuais de cada hora): menos de 15
  min = 0; **15 a 44 min = 30 min**; **45 a 59 min = 1 hora**. Valor da hora extra =
  diária ÷ 8 × fator (1,5).
- **Modo acumulado**: cada lançamento guarda os minutos; o **fechamento arredonda a soma do
  período uma vez** e mostra o ajuste. Por isso uma linha pode mostrar R$ 309,38 e o total
  trazer um ajuste de −R$ 0,01.
- **Sábado**: diária integral até 4 h e hora extra depois; **domingo e feriado**
  (com a resolução ligada): minutos trabalhados × diária × 2 ÷ 480, sem diária-base nem hora
  extra comum; domingo que também é feriado recebe o fator uma vez. Com a resolução
  desligada, o domingo e o feriado são cobrados como dia comum.
- **Custo** é separado da cobrança e usa os minutos efetivos.

## 9. Adicionais de serviço

Em **Faturamento → Adicionais**: **Novo adicional de serviço** (Competência de cobrança
(mês), Operação opcional, Motivo/serviço, Referência (OS, contêiner…), Valor). É receita
extra do período, sem diária nem custo. **Cancelar adicional** exige motivo e só é possível
antes da fatura. Adicionais criados por Containers não se cancelam isoladamente.

## 10. Containers (serviço avulso)

Tela **Containers**: lista, detalhe e **Novo serviço**.

1. Pelo menu, ou pelo atalho **Containers** da tela de Operações (que já preenche Cliente e
   Operação).
2. Preencha **Data da solicitação** (até o dia anterior à execução), **Data da execução**,
   **Valor total negociado (R$)**, **Quantidade de containers** (inteira, maior que zero),
   **Produto e serviço**, Referência (opcional), **Modalidade de custo** (Por pessoa ou
   Total distribuído), **Participantes e valores devidos** (custo zero deve ser informado
   explicitamente) e, se quiser, a **Competência de cobrança**.
3. **Revisar serviço** → confira → **Confirmar registro**. O duplo clique não duplica.
4. A soma dos participantes tem de **igualar** o custo total. Valores usam duas casas.
5. **Cancelar serviço** (no detalhe) exige motivo, cancela a receita junto, é permitido só
   **antes** da fatura e preserva a auditoria. Para corrigir: cancele e registre de novo.
6. Custo por participante é uma **informação interna** e **não é pagamento**; o Excel do
   cliente não mostra custo.

## 11. Fechamento

Tela **Fechamento** (cliente + período): escolha Cliente e **Mês de referência/Ano** ou
**Data inicial/Data final**, e **Gerar fechamento**. Mostra receita (apontamentos +
serviços + ajustes), custo previsto, resultado e margem, **por colaborador** e o
**detalhamento diário**, a **conciliação** com o banco e **alertas** (por exemplo, folhas
abertas). Falta fica fora das diárias. O janelamento correto é **1ª quinzena (1–15), 2ª
(16–fim) ou mês inteiro**, conforme o contrato do cliente; o banco recusa outras janelas
na hora de faturar. Valores são "previstos": não representam pagamento realizado.

## 12. Faturamento

Tela **Faturamento** ("Revise lançamentos faturáveis, valores consolidados e faturas geradas
por cliente e período"):

1. Escolha o **Cliente** e o período. A fatura é sempre uma **competência inteira** da
   frequência do cliente (1 a 15 ou 16 ao último dia, ou o mês inteiro); a tela oferece os
   botões de competência (`dd/mm a dd/mm`) e avisa em vermelho quando o período escolhido não
   é uma competência.
2. A tela mostra os lançamentos faturáveis, o valor de diárias, de horas extras, o ajuste de
   arredondamento acumulado e os adicionais de serviço, o **total a faturar** e o resultado.
   Sem lançamentos elegíveis aparece "Nenhum lançamento faturável".
3. **Gerar fatura** emite a fatura do cliente e do período. O total dos itens é igual ao total
   da receita. Depois de emitida, os lançamentos e adicionais ficam **vinculados e imutáveis**,
   o **a faturar** zera e repetir a emissão é recusado.
4. A lista **Faturas geradas** guarda o histórico. **Exportar CSV** exporta o período
   mostrado. A planilha Excel do período está no **Fechamento** (seção 13).
5. **Adicionais** (seção 9) ficam na mesma tela.

## 12.1 Relatórios

Tela **Relatórios** ("Analise diárias, faltas, horas extras, receita, custo e margem do
período selecionado"): filtros **De** e **Até**, indicadores do período (diárias, faltas,
horas extras, receita, custo e margem) e as seções **Desempenho por colaborador**, **Resultado
por operação** e **Lançamentos detalhados**, com a situação de presença de cada linha.
**Exportar CSV** exporta o período. A receita dos Relatórios vem da mesma função do banco
usada pela fatura, com o ajuste de arredondamento separado.

## 13. Exportações Excel

No **Fechamento**, depois de gerar:

- **Baixar Excel (.xlsx)** — visão **interna**: abas Resumo, Por colaborador e Detalhamento
  diário, com custo, resultado e margem.
- **Excel do cliente (.xlsx)** — abas Fechamento e Resumo por colaborador, **sem** custo,
  resultado ou margem. Tem filtro automático; a linha **Subtotal** acompanha o filtro
  (função SUBTOTAL) e a linha **Total do fechamento** é fixa. As horas extras do total são a
  soma dos **minutos** convertida uma vez; a soma das linhas arredondadas pode diferir em
  centésimos de hora, mas o **dinheiro nunca diverge**.
- Se os dados mudarem depois de gerar o fechamento, a exportação é recusada (assinatura
  vencida): **gere o fechamento de novo**.

## 14. Correção de erros e dúvidas frequentes

| Situação                                    | O que fazer                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "Entrada igual à saída" ao salvar           | Corrija o horário; o rascunho é mantido.                                                                             |
| Não consigo editar o dia                    | A folha está fechada: **Reabrir** (administrador). Se já foi faturada, não se edita.                                 |
| Preço errado numa data                      | Não se edita o lançamento: registre **nova vigência** com motivo para as datas futuras.                              |
| Serviço de container errado                 | **Cancelar serviço** (com motivo) antes da fatura e registrar de novo.                                               |
| Soma dos participantes não bate             | Ajuste os valores devidos até igualar o custo total.                                                                 |
| Diária/feriado "pendente"                   | Falta localidade da operação ou cobertura do calendário do ano.                                                      |
| Exportação recusada                         | Gere o fechamento de novo (os dados mudaram).                                                                        |
| Fatura recusada por janela                  | Use 1–15, 16–fim ou o mês, conforme o cliente.                                                                       |
| Convidado não consegue entrar               | Use **Esqueci minha senha** com o e-mail convidado.                                                                  |
| Código MFA recusado                         | Confira o relógio do celular; use o código atual.                                                                    |
| Apontamento recusado com a resolução ligada | Classifique o período do turno (diurno/noturno), registre local e cobertura, e cadastre tarifa ou diária individual. |

## 15. O que **não** está neste manual

Ligar ou desligar o motor por vigência e a resolução por função e período são ações
administrativas controladas (tela **Implantação das vigências** e RPCs próprias), com
autorização e janela; não faça isso sem a decisão da BS. Também ficam fora: implantação em
Production, conciliação com a planilha Dynamis e qualquer pagamento.
