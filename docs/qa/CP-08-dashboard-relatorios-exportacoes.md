# QA-BS-01 · Sessão 13 — Modelo de negócio consolidado e CP-08 (Dashboard, Relatórios e Exportações)

Sessão 13 (13/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`12f55289f23ec45a0af1cb9427b4f1c74e3e6661` (CP-07). PR #134 (Draft).

## Isolamento

- Antes de qualquer teste: HEAD local = remoto, árvore limpa (só `supabase/.branches/`), scripts
  da sessão apenas locais (nenhum host remoto), os dois scripts remotos antigos seguem desativados
  (`*.REMOTO-NAO-EXECUTAR`). Docker: 0 containers, 0 volumes, 8 imagens preexistentes.
- Só Supabase local (`supabase_db_bs-e2e-*`) e CI. Nenhum acesso a HML, Preview ou Production,
  nenhuma API de gerenciamento remoto. O incidente das 4 chamadas vazias ao HML (CP-04/CP-05)
  continua registrado e não se repetiu.

## Parte A — modelo comercial confirmado pela BS

Fonte: esclarecimento direto do responsável, registrado em
[NEGOCIO.md §3A](../NEGOCIO.md#3a-duração-da-operação-regime-de-cobrança-e-tipo-de-serviço).

1. **Três dimensões independentes:** modalidade operacional (Fixa/Avulsa), regime de cobrança
   (diária por trabalhador ou produção/quantidade) e tipo de serviço (contêiner, carga e descarga,
   etiquetagem…). Avulsa não é valor fechado; temporária não é produção; contêiner é tipo de
   serviço, não modalidade.
2. **Mão de obra por diária** — recorrente ou temporária (semana, mês de Black Friday, dois
   meses). A BS negocia a diária por trabalhador; o valor final depende de presença, falta,
   substituição, jornada, HE, fim de semana, feriado e contrato.
3. **Temporárias** podem ter diária maior e recorrentes, menor — **critério de negociação**, sem
   percentual automático.
4. **Produção/quantidade** — preço por unidade executada (10 contêineres × R$ 300 = R$ 3.000). Não
   se multiplica por colaboradores; não muda com as horas.
5. **Custos individuais** — cada colaborador tem custo próprio, apurado separadamente.
6. **Receita × custo** — conceitos separados: o R$ 250 do exemplo é preço ao cliente, não custo;
   a remuneração em serviços de produção **não foi esclarecida** (DEC-PROD-01).

## Parte B — reconciliação negócio × sistema

Matriz completa (16 itens) em
[NEGOCIO_X_SISTEMA.md](../NEGOCIO_X_SISTEMA.md#revisão-qa-bs-01--sessão-13-13112026-duração--regime-de-cobrança--tipo-de-serviço).
Resumo:

- **Implementado e testado:** diária por trabalhador (fixa e avulsa), custo por colaborador e por
  vigência, falta, HE, sábado, domingo, feriado, saída antecipada, competência, imutabilidade.
- **Divergente:** contêiner por unidade — hoje sai como diária × participantes.
- **Não implementado:** produção/quantidade, quantidade executada, remuneração por produção, tipo
  de serviço estruturado.
- **Depende de decisão:** DEC-CP06-01 a 05, DEC-PROD-01/02, DEC-AV-01/02.
- **Paridade técnica não é aderência comercial:** as telas reproduzem o mesmo total do modelo de
  diária; se o acordo real for por produção, todas reproduzem o mesmo valor inadequado.

## Parte C — CP-08

### Fonte de cada número (lida no código e conferida no E2E)

| Valor                               | Fonte                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Receita (Dashboard e Relatórios)    | `resumo_financeiro_periodo` (banco): apontamentos + adicionais pela janela de cobrança + arredondamento  |
| Custo                               | apontamentos (ledger) + custo dos serviços antigos de contêiner (**corrigido**: pela janela de cobrança) |
| Margem                              | receita − custo = **resultado bruto** (não é lucro líquido); % sobre a receita                           |
| Diárias                             | contagem de lançamentos que não são falta (inclusive domingo/feriado, cobrados por hora)                 |
| Horas extras                        | minutos cobrados (`billed_overtime_minutes`)                                                             |
| Gráficos e "por cliente"            | **somente apontamentos** (sem adicionais nem serviços antigos) — agora rotulado                          |
| Fixa × Avulsa                       | `operations.type` dos apontamentos; não existe dimensão "tipo de serviço" nem "Contêineres"              |
| Relatórios por colaborador/operação | apontamentos (ledger)                                                                                    |
| Faturado (Relatórios)               | `invoice_id` do lançamento                                                                               |

Receita gerada não é valor recebido: o sistema não tem recebimentos (fora do escopo, NEGOCIO §12).

### Inventário e matriz de ações

| Tela / ação                                       | Resultado                        | Evidência                                                        |
| ------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| Dashboard: filtros De/Até                         | PASS                             | DB1, DB3                                                         |
| Dashboard: Receita                                | PASS                             | DB1 2.502,50; DB3 (dia, quinzena, mês, sem dados)                |
| Dashboard: Custo                                  | **CORRIGIDO** (D-CP08-01)        | DB1 1.513,33; DB3 abril 0,00                                     |
| Dashboard: Margem (resultado e %)                 | PASS                             | DB1 989,17 · 39,5%                                               |
| Dashboard: Diárias, Faltas, Colaboradores, HE     | PASS                             | DB1 8 · 8 · 4 · 2,5 h                                            |
| Dashboard: Lançamentos (contagem)                 | NÃO TESTADO no E2E               | lido no código (`period.length`, faltas incluídas)               |
| Dashboard: gráficos (cliente, dia, Fixa × Avulsa) | **CORRIGIDO** rótulo (D-CP08-02) | DB2; valores dos gráficos não lidos (SVG)                        |
| Dashboard: lista por cliente                      | PASS (rótulo)                    | já dizia "apontamentos… sem adicionais"; `test:custo-containers` |
| Dashboard: período invertido                      | **CORRIGIDO** (D-CP08-04)        | DB3                                                              |
| Dashboard: carregando, erro do ledger, vazio      | PASS (suítes Node)               | `test:ledger-estados`; leitura do código                         |
| Relatórios: filtros e cartões                     | PASS (custo **CORRIGIDO**)       | RL1, RL2                                                         |
| Relatórios: por colaborador                       | PASS                             | RL1 (4 colaboradores ao centavo)                                 |
| Relatórios: por operação                          | **CORRIGIDO** (D-CP08-03)        | RL1: coluna Modalidade                                           |
| Relatórios: lançamentos e "Faturado"              | PASS                             | FT1                                                              |
| Relatórios: período invertido / sem dados         | **CORRIGIDO** / PASS             | RL2                                                              |
| Relatórios: exportar CSV                          | **CORRIGIDO** (D-CP08-05)        | EX1                                                              |
| Faturamento: exportar CSV (rótulo)                | **CORRIGIDO** (D-CP08-05)        | EX2; conteúdo no CP-07 EX1                                       |
| Fechamento: Excel interno/cliente, CSV            | PASS (regressão)                 | specs 10 e 95                                                    |
| Relatório por cliente                             | NÃO DISPONÍVEL                   | só no Dashboard (gráfico/lista) e no Fechamento por cliente      |
| Relatório por tipo de serviço                     | NÃO DISPONÍVEL                   | depende do catálogo (DEC-CP06-01)                                |
| Segurança (operacional, sem papel, anônimo)       | PASS                             | SG1; spec 41 (rotas e APIs)                                      |

### Matriz financeira independente (spec 97)

Cenário de maio de 2027, cálculo independente (NEGOCIO §10 + V2) linha a linha contra o banco:

| Item                                                                | Receita      | Custo        |
| ------------------------------------------------------------------- | ------------ | ------------ |
| Fixa: Gil 8 h; Hana 9h20 (HE 90 cobrada/80 paga); Ivo falta (03/05) | 547,50       | 383,33       |
| Fixa: Gil no feriado (04/05), dobro                                 | 480,00       | 300,00       |
| Fixa: Ivo sábado 5 h (08/05)                                        | 285,00       | 135,00       |
| Fixa: Hana domingo 4 h (09/05), dobro                               | 240,00       | 200,00       |
| Fixa: Ivo 6 h com custo reajustado; Gil substituição (10/05)        | 420,00       | 255,00       |
| Avulsa por diária: Jade (03/05)                                     | 280,00       | 130,00       |
| **Apontamentos**                                                    | **2.252,50** | **1.403,33** |
| Adicional manual (1ª quinzena)                                      | 60,00        | —            |
| Registro antigo A (sem competência, executado 06/05)                | 90,00        | 40,00        |
| Registro antigo B (executado 28/04, cobrado na 1ª quinzena de maio) | 100,00       | 70,00        |
| Registro antigo C (cancelado)                                       | —            | —            |
| Adicional cobrado na 2ª quinzena (executado na 1ª)                  | (fora)       | —            |
| **Total da 1ª quinzena**                                            | **2.502,50** | **1.513,33** |

Resultado bruto 989,17; margem 39,5%. Conferido em: banco local → Fechamento (por cliente) →
Faturamento (por cliente) → Dashboard → Relatórios → CSV dos Relatórios (apontamentos). Depois da
fatura do cliente fixo, os totais não mudam e os lançamentos aparecem como faturados (FT1).

Produção/quantidade não foi testada nem simulada (não existe; não se forçou por adicional).

### Defeitos RED/GREEN

| ID        | Sev. | Esperado × obtido (RED no `12f5528`)                                                                                                                                                                                                 | Correção                                                                                                                                  | Teste                                                 |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| D-CP08-01 | P2   | Custo dos serviços antigos de contêiner pela data de EXECUÇÃO, receita pela COMPETÊNCIA: Dashboard e Relatórios com custo 1.443,33 (certo 1.513,33) e abril com custo 70,00 sem receita. Fechamento e fatura já usavam a competência | leitura pela janela de cobrança do adicional (competência ou execução), o critério de `resumo_financeiro_periodo`; nenhuma mudança de SQL | DB1, DB3, RL1, FT1; `test:custo-containers`           |
| D-CP08-02 | P3   | Gráficos somam só apontamentos e não diziam (o cartão "Receita" inclui adicionais e serviços antigos)                                                                                                                                | descrição "Somente apontamentos: sem adicionais nem serviços antigos de contêiner"                                                        | DB2                                                   |
| D-CP08-03 | P3   | Relatório por operação sem distinguir Fixa de Avulsa (e chave de linha pelo nome, que colide entre clientes)                                                                                                                         | coluna Modalidade; chave pelo id da operação                                                                                              | RL1 (RED por leitura: o teste parava antes, no custo) |
| D-CP08-04 | P3   | Período invertido mostrava "Não foi possível ler a receita do banco" e R$ 0,00                                                                                                                                                       | aviso "A data inicial é posterior à final", sem números                                                                                   | DB3, RL2                                              |
| D-CP08-05 | P3   | CSVs de lançamentos rotulados "Exportar CSV", como se fossem o relatório financeiro; o dos Relatórios sem modalidade e sem situação faturada                                                                                         | "Exportar lançamentos (CSV)" com explicação; colunas Modalidade e Faturado; arquivo `lancamentos-<início>-<fim>.csv`                      | EX1, EX2                                              |

Nenhum cálculo, SQL, migration, RLS, grant, trigger ou contrato de RPC alterado. Ajustes de teste
legítimos: `test:custo-containers` passou a testar a janela de cobrança (o teste de paridade com a
fatura do HML deixou de trocar a data de execução para fechar); a spec 95 clica no novo rótulo.

### Períodos e datas

| Caso                                     | Resultado                                                       |
| ---------------------------------------- | --------------------------------------------------------------- |
| Dia único (feriado)                      | PASS: 480,00 / 300,00                                           |
| 1ª quinzena                              | PASS: 2.502,50 / 1.513,33                                       |
| 2ª quinzena                              | PASS: só o adicional cobrado nela (45,00), custo 0              |
| Mês inteiro                              | PASS: 2.547,50 / 1.513,33                                       |
| Sem dados                                | PASS: zero, exportação desabilitada                             |
| Execução ≠ competência                   | **CORRIGIDO**: custo e receita juntos na competência            |
| Faturado e pendente                      | PASS: o total não muda depois da fatura                         |
| Período invertido                        | **CORRIGIDO**                                                   |
| Virada de mês/ano, fevereiro, meia-noite | coberto no CP-07 (competências) e CP-04/CP-05 (data da entrada) |

Datas são strings civis (`AAAA-MM-DD`) comparadas inclusivamente; o período padrão é o mês atual
do navegador.

### Robustez e segurança

- Precisão: centavos inteiros em todas as somas novas; margem negativa é legítima (receita > 0).
- Receita zero: `marginPct` devolve 0 e a tela mostraria "0,0%" com custo > 0 (R-CP08-02; não
  reproduzido no E2E depois do D-CP08-01).
- Paginação: ledger, adicionais e serviços antigos usam `lerConsultaPaginada` (sem truncamento
  silencioso de 1.000 linhas; `test:queries-paginacao`, `test:admin-paginacao`). Centenas de
  lançamentos: NÃO TESTADO no E2E deste checkpoint (escala de 300 colaboradores no CP-03).
- Respostas fora de ordem: as consultas são chaveadas pelo período (TanStack Query); lido no código.
- Segurança (SG1): `resumo_financeiro_periodo` recusado para operacional, sem papel e anônimo;
  `timesheet_entries`, `billing_additionals` e `container_services` devolvem zero linha. Rotas e
  APIs pela spec 41. RLS e grants sem alteração.

### Exportações

| Exportação         | Natureza                                             | Nome                                             | Conferido                                  |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Relatórios — CSV   | extrato de lançamentos (todos os clientes)           | `lancamentos-<início>-<fim>.csv` (**corrigido**) | colunas, presença, modalidade, faturado, Σ |
| Faturamento — CSV  | extrato de lançamentos a faturar do cliente          | `faturamento-<cliente>-<início>-<fim>.csv`       | CP-07 EX1                                  |
| Fechamento — CSV   | diário / por colaborador                             | `fechamento-<cliente>-<início>-<fim>-….csv`      | CP-07 EX1, spec 10                         |
| Fechamento — Excel | interno (com custo) / cliente (sem custo nem margem) | —                                                | spec 10                                    |

UTF-8 com BOM, separador `;`, fórmula neutralizada (`montarCsv`, suítes de CSV do Fechamento).
**Separador decimal:** os CSVs de lançamentos usam ponto; o do Fechamento usa vírgula (R-CP08-03).

## Resultados

- **RED** (`12f5528`): spec 97 com 8 falhas (D-CP08-01, 02, 04, 05; D-CP08-03 por leitura).
- **GREEN**, sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS;
  **79/79** `test:*` (`test:custo-containers` 13 na regra nova); travas 25/25; spec 97 **12/12**;
  specs 10, 90 e 95 62/62; `npm run e2e:local` completo: **205 testes, 204 PASS, 0 FAIL, 1 FALHA
  CONHECIDA (CN-D), 0 PULADO**, 1527 s, nenhuma conexão externa do servidor; `sql-local` **52
  suítes** PASS.
- **Docker:** 0 containers e 0 volumes antes e depois; 8 imagens preexistentes intocadas.
- **CP-01 a CP-07 íntegros**, inclusive o CP-06B: specs 00 a 95 PASS na mesma execução.

## Riscos residuais

- **R-CP08-01:** "Diárias" conta todo lançamento que não é falta — inclusive domingo e feriado,
  cobrados por hora e sem diária. A fatura usa a mesma contagem (`total_dailies`): coerente, mas o
  rótulo induz a erro. Mudar exige decisão (afeta a fatura).
- **R-CP08-02:** margem % mostrada como 0,0% quando a receita é zero e há custo.
- **R-CP08-03:** separador decimal diferente entre os CSVs de lançamentos (ponto) e o do Fechamento
  (vírgula); num Excel em português o ponto pode ser lido como milhar. Não verificado em aplicativo
  externo.
- **R-CP08-04:** não há relatório por cliente nem por tipo de serviço (catálogo, DEC-CP06-01).
- **Aderência comercial:** produção/quantidade não existe; contêiner por unidade sai como diária
  (NEGOCIO_X_SISTEMA, itens 3–5, 7, 10).
- Herdados: AUT-CP05-01, AUT-CP06-01, AUT-CP07-01, DEC-CP06-04, DEC-CP07-01 a 03, DEC-CP02-01
  (CN-D, falha conhecida).

## Decisões pendentes

DEC-CP06-01 (catálogo), DEC-CP06-02 (regimes de cobrança), DEC-CP06-03 (custo por serviço),
DEC-PROD-01 (remuneração por produção), DEC-PROD-02 (unidades, quantidade executada, parcial),
DEC-CP06-04 (duplicidade), DEC-CP06-05 (colaborador em dois avulsos), DEC-AV-01 (jornada na
temporária por diária), DEC-AV-02 (um ou vários dias), DEC-CP07-01 a 03, DEC-CP02-01; e, do
CP-08, o rótulo/semântica de "Diárias" (R-CP08-01) e o separador decimal dos CSVs (R-CP08-03).

## Casos não testados

- Valores desenhados nos gráficos (SVG); conferidos rótulo e fonte.
- Centenas de lançamentos no Dashboard (paginação coberta por suítes Node).
- Abertura dos CSV/XLSX em Excel ou LibreOffice (indisponível na sessão).
- Recarga automática ao voltar à aba.

## Proposta futura: cobrança por produção (não implementada)

Proposta para decisão; **nada disto foi implementado nesta sessão**.

1. **Regime explícito na operação:** campo "Forma de cobrança" (diária por trabalhador |
   produção) na operação, com vigência como os preços atuais; "valor fechado" = unidade "serviço"
   × 1, se a BS o praticar.
2. **Preço por produção:** unidade (contêiner, caminhão, palete, caixa, serviço) e preço unitário
   na operação, versionados (padrão de `operation_terms`).
3. **Execução:** registro por data de execução com a quantidade **efetivamente executada**
   (aceita vários dias, execução parcial e correção auditada); receita = quantidade × preço
   unitário vigente na data, congelada no registro.
4. **Participantes e custo:** continuam pelo apontamento (presença), com **receita zero** nas
   operações por produção; o custo segue a regra decidida em DEC-CP06-03/DEC-PROD-01 — nunca
   derivado do preço de venda.
5. **Prevenção de duplicidade:** uma operação tem UM regime, travado depois do primeiro
   faturamento; o trigger de derivação zera a receita dos apontamentos dessa operação; a execução
   tem chave única e idempotência (padrão 046/047); adicionais não substituem a produção.
6. **Faturamento e relatórios:** `gerar_fatura`, `resumo_financeiro_periodo`, Fechamento, Dashboard
   e Relatórios somam a produção com o mesmo critério de competência; paridade com `billing.ts`.
7. **Compatibilidade:** operações existentes ficam "diária" (padrão), sem recálculo; faturado
   congelado; registros antigos de contêiner permanecem histórico (sem conversão automática);
   tudo atrás de um interruptor desligado (padrão do motor e do dobro), com suítes SQL e E2E,
   homologação no HML e autorização por ambiente.

Exige migrations, mudança de RPC e de regra financeira: autorização específica antes de começar.

## Próxima etapa

CP-09 — interface, clareza e consistência, só com nova autorização.
