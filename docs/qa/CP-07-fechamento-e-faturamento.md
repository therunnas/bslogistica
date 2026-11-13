# QA-BS-01 · CP-07 — Fechamento e faturamento

Sessão 11 (13/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`7e8659f4ec8314362dfeef66292b8b680307afb5` (CP-06B). PR #134 (Draft).

## Escopo e isolamento

Cadeia conferida: cliente → contrato e condições → operação fixa ou avulsa → apontamentos e
serviços → valores e custos → fechamento → competência de cobrança → fatura → exportação.

- Só Supabase local (`supabase_db_bs-e2e-*`), dados sintéticos com o prefixo `TESTE-AUD-132 CP07`
  e datas de janeiro a março de 2027 (nenhum outro arquivo de teste usa).
- Os scripts locais foram conferidos antes de qualquer comando: só apontam para `127.0.0.1`. Os
  dois scripts remotos de sessões anteriores seguem desativados (`*.REMOTO-NAO-EXECUTAR`).
  Nenhum acesso a HML, Preview ou Production, nem à API de gerenciamento remoto.
- O incidente do CP-04/CP-05 continua registrado: 4 chamadas vazias à API de gerenciamento do
  HML, sem SQL executado. Nenhuma outra desde então.
- Docker: antes, 0 containers, 0 volumes e 8 imagens (nenhum recurso preexistente removido);
  depois, ver [Resultados](#resultados).

Configuração testada = Production (semente E2E): motor por vigência LIGADO, resolução de tarifas
DESLIGADA, domingo e feriado em dobro LIGADO.

## Como o sistema fecha e fatura (lido no código e conferido no banco)

- **Fechamento** (`/fechamento`, API `/api/fechamento`): prévia por cliente e período. Oferece
  1ª quinzena, 2ª quinzena, mês e período personalizado (até 31 dias, pode atravessar o mês).
  Não grava nada. Alerta "folha aberta" e outros só sinalizam; nunca mudam um valor.
- **Faturamento** (`/faturamento`): prévia das linhas a faturar, adicionais, arredondamento
  acumulado, "Gerar fatura" → confirmação → "Emitir fatura" (RPC `gerar_fatura`), lista de
  faturas e exportação CSV.
- **`gerar_fatura`** (última definição na 045), `SECURITY DEFINER`:
  - exige sessão, `mfa_cotidiano_ok()` e o papel `admin`;
  - toma a trava `pg_advisory_xact_lock` do cliente;
  - exige uma competência inteira da frequência do cliente (`validar_periodo_de_cobranca`, 038);
  - seleciona `FOR UPDATE` os lançamentos sem fatura, exceto faltas, **sem olhar o estado do
    dia** (aberto ou fechado);
  - seleciona os adicionais pela competência de cobrança, ou pela execução nos anteriores à 038;
  - grava a fatura, os itens por componente e os vínculos;
  - confere a corrida (40001) e que Σ itens = total (23514).
- **Totais não vêm do navegador:** a tela só envia cliente, início e fim.
- **Escrita direta:** `authenticated` tem só `SELECT` em `invoices` e `invoice_items`; triggers
  bloqueiam a edição de fatura fechada.

### Estados da fatura (semântica real)

| Estado no banco | Rótulo   | Quem cria                             | Significado real                                |
| --------------- | -------- | ------------------------------------- | ----------------------------------------------- |
| `closed`        | Fechada  | `gerar_fatura` (sempre)               | documento interno de cobrança emitido; imutável |
| `draft`         | Rascunho | ninguém (padrão da coluna, sem fluxo) | não ocorre                                      |
| `issued`        | Emitida  | ninguém                               | não ocorre                                      |

Nenhum estado corresponde à NF-e/NFS-e: a nota fiscal é emitida fora do sistema. Não existe
cancelamento, estorno, reemissão nem detalhe da fatura na tela (os itens ficam no banco; a lista
mostra totais) — DEC-CP07-03.

## Inventário e matriz de ações

| Tela / ação                                        | Resultado                 | Evidência                                                         |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| Fechamento: cliente, mês, ano, 1ª/2ª quinzena, mês | PASS                      | FE1, EX1; specs 10 e 80                                           |
| Fechamento: período personalizado (até 31 dias)    | PASS (suítes Node)        | `test:fechamento-*`; não repetido no E2E                          |
| Fechamento: totais de receita, custo, resultado    | PASS                      | FE1: 3.217,50 / 1.813,75                                          |
| Fechamento: alerta de folha aberta                 | PASS                      | FE1                                                               |
| Fechamento: Excel interno, Excel do cliente        | PASS (regressão)          | spec 10 (custo só no interno)                                     |
| Fechamento: CSV por colaborador e diário           | PASS                      | EX1 (diário), spec 10 (por colaborador)                           |
| Faturamento: cliente, período, frequência          | PASS                      | CP1                                                               |
| Faturamento: botões de competência                 | PASS                      | CP1 (janeiro, fev. comum e bissexto, virada de ano, mensal)       |
| Faturamento: período fora da competência           | PASS                      | CP1: aviso e "Gerar fatura" desabilitado                          |
| Faturamento: prévia (diárias, HE, total, margem)   | PASS                      | FE1                                                               |
| Faturamento: novo adicional e cancelamento         | PASS (regressão)          | CP-06 AD1, AD2; AP, CC1                                           |
| Faturamento: exportar CSV                          | **CORRIGIDO** (D-CP07-06) | EX1                                                               |
| "Gerar fatura" → confirmação                       | **CORRIGIDO** (D4)        | D4: relê antes de abrir; dias fechados, abertos e sem apontamento |
| Confirmação: fatura já emitida no período          | **CORRIGIDO** (D-CP07-04) | CPL                                                               |
| Confirmação: duplicidade com registro antigo       | **CORRIGIDO** (D-CP07-05) | DUP                                                               |
| "Emitir fatura": duplo clique e Enter              | PASS                      | EM1: uma fatura                                                   |
| Emissão em duas abas                               | **CORRIGIDO** (D-CP07-01) | CC1                                                               |
| Emissão por chamadas simultâneas à API             | PASS                      | CC2: uma fatura, as outras P0002                                  |
| Falha de rede ao emitir                            | **CORRIGIDO** (D-CP07-02) | RD1                                                               |
| Resposta perdida depois de gravar                  | **CORRIGIDO** (D-CP07-02) | RD2                                                               |
| Lançamento salvo depois da conferência             | **CORRIGIDO** (D-CP07-03) | ED1 (aviso; o banco fatura o que havia na emissão)                |
| Lista de faturas e estado                          | PASS                      | EM1: "Fechada" com o total                                        |
| Detalhe da fatura e itens na tela                  | NÃO DISPONÍVEL            | itens só no banco (DEC-CP07-03)                                   |
| Cancelamento, estorno, reemissão                   | NÃO DISPONÍVEL            | sem modelo (DEC-CP07-03)                                          |
| Proteção de registros faturados                    | PASS                      | IM1                                                               |
| Operacional, sem papel, anônimo                    | PASS                      | SG1; spec 41 (rotas e APIs)                                       |

Ações reais: 27. Testadas no E2E: 24; 1 só nas suítes Node (período personalizado); 2 não
disponíveis.

## Competências e frequências

A tela (`competenciasDoMes`, `ehCompetencia` em `src/lib/fechamento/periodo.ts`) e o banco
(`janela_de_cobranca_valida`, `validar_periodo_de_cobranca`) usam a **mesma definição**,
conferida pela tela e pela função SQL no mesmo teste (CP1).

| Caso                                 | Tela                                              | Banco                                   |
| ------------------------------------ | ------------------------------------------------- | --------------------------------------- |
| Janeiro (quinzenal)                  | 01–15 e 16–31                                     | válidas                                 |
| Fevereiro comum (2027)               | 01–15 e 16–28                                     | 16–28 válida                            |
| Fevereiro bissexto (2028)            | 01–15 e 16–29                                     | 16–29 válida; 16–28 recusada            |
| Virada de ano (dezembro de 2026)     | 16–31/12                                          | válida                                  |
| Mensal (2028-02)                     | uma competência, 01–29                            | válida; quinzena recusada (22023)       |
| Período personalizado (05–20/01)     | aviso e botão desabilitado                        | 22023 "não é uma competência quinzenal" |
| Atravessa o mês (16/01–15/02)        | aviso e botão desabilitado                        | 22023 "atravessa o mês"                 |
| Sem registros (16–28/02)             | "Nenhum lançamento faturável", botão desabilitado | P0002, nenhuma fatura                   |
| Antes do contrato (novembro de 2026) | idem                                              | P0002, nenhuma fatura                   |
| Com registros já faturados           | só o restante (complementar)                      | CPL                                     |

A competência financeira nunca diverge do período mostrado: a tela só emite competência inteira,
e o banco recusa qualquer outra.

## D4 — dias ainda abertos

- **Comportamento do banco:** `gerar_fatura` fatura os lançamentos do dia **aberto ou fechado**.
  "Fechar dia" trava a edição (031); não é condição de faturamento.
- **RED** (`7e8659f`): a confirmação mostrava cliente, período, apontamentos, adicionais e total,
  sem nenhuma menção ao dia 06/01 aberto. Na spec 30 o D4 constava como falha conhecida.
- **GREEN:** a confirmação mostra:
  - "Dias com apontamento: 7 (6 fechados, 1 aberto)";
  - "Dias já faturados", quando houver;
  - "Dias sem apontamento: 8 (não são pendência)";
  - um aviso com cada dia aberto (data, operação e turno), dizendo que os lançamentos entram mesmo
    assim e que, se ainda houver conferência, o dia deve ser fechado antes.
- **Não bloqueia** a emissão: a política é decisão do responsável (DEC-CP07-01).
- **Estado atual, não o de quando a tela abriu:** "Gerar fatura" relê lançamentos, folhas,
  faturas, adicionais e registros antigos antes de abrir. No teste, outra aba fechou o dia 06 e a
  confirmação seguinte já mostrou "7 fechados", sem recarregar.
- Dia sem apontamento não é tratado como pendente. Dia com apontamento só de faltas, ainda
  aberto, conta como aberto (pode virar presença).
- A spec 30 deixou de ter o D4 como falha conhecida e passou a conferir o comportamento correto.

## Conciliação do fechamento (cálculo independente)

Cliente `CP07 Cliente`, contrato R$ 240 (fator 1,5, tolerância 10 min, HE diária), 1ª quinzena
de janeiro de 2027, 01/01 cadastrado como feriado. O cálculo independente é o mesmo do CP-05
(NEGOCIO §10 + V2), aqui com custo por colaborador.

| Data        | Caso                                            | Receita      | Custo        |
| ----------- | ----------------------------------------------- | ------------ | ------------ |
| 01/01 (sex) | L feriado: Ana 8 h, dobro sem diária            | 480,00       | 300,00       |
| 02/01 (sáb) | J sábado: Ana 5 h (1 h acima de 4 h)            | 285,00       | 168,75       |
| 03/01 (dom) | K domingo: Beto 4 h, dobro                      | 240,00       | 180,00       |
| 04/01       | A normal: Ana                                   | 240,00       | 150,00       |
| 04/01       | H saída antecipada: Caio 6 h, proporcional      | 180,00       | 90,00        |
| 04/01       | G falta: Beto                                   | 0,00         | 0,00         |
| 05/01       | I HE: Ana 9h20 (80 min; cobra 90, paga 80)      | 307,50       | 175,00       |
| 05/01       | Beto normal (F custo 180)                       | 240,00       | 180,00       |
| 06/01       | M vigência: Caio a R$ 140 desde 06/01           | 240,00       | 140,00       |
| 06/01       | Ana normal (dia ABERTO)                         | 240,00       | 150,00       |
| 08/01       | B avulso: Contêiner 20 pés, Davi e Edu (R$ 300) | 600,00       | 240,00       |
| —           | D adicional manual (competência 1ª quinzena)    | 75,00        | —            |
| —           | E registro antigo sem operação                  | 90,00        | 40,00        |
| **Total**   |                                                 | **3.217,50** | **1.813,75** |

- **Resultado bruto:** 1.403,75 (margem operacional, não lucro líquido).
- **Banco, tela e fatura:** cada lançamento gravado bate com o cálculo; o Fechamento mostra
  3.217,50 / 1.813,75; o Faturamento mostra o mesmo total e a margem.
- **Fatura:** 3.217,50 / 1.813,75 / 11 lançamentos / 2 adicionais vinculados. Os itens
  (`diarias`, `horas_extras`, `horas_especiais`, `adicional`) somam exatamente o total. As faltas
  ficam fora do lastro.
- **N (período com faturados):** o lançamento atrasado de 07/01 gera fatura complementar de
  240,00. O já faturado não é cobrado de novo.

## Serviços avulsos, adicionais e registros antigos

| Item                                            | Comportamento                                                                                       | Teste        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------ |
| Avulso executado e cobrado na mesma competência | entra pela data do serviço                                                                          | AP, FE1, EM1 |
| Avulso com vários participantes                 | um lançamento por participante, custo de cada um                                                    | AP           |
| Avulso com competência diferente da execução    | a operação Avulsa não tem competência própria (cobra pela data); só adicional e registro antigo têm | —            |
| Adicional com competência diferente da execução | executado em 28–30/01, cobrado na 1ª quinzena de fevereiro; fora da fatura de janeiro               | CC1, CC2     |
| Adicional manual válido                         | uma vez                                                                                             | EM1          |
| Adicional cancelado                             | fora do total (regressão)                                                                           | CP-06 AD2    |
| Adicional faturado                              | cancelamento recusado                                                                               | IM1          |
| Registro antigo a faturar                       | uma vez, com o custo congelado                                                                      | EM1          |
| Registro antigo cancelado                       | fora do total (regressão)                                                                           | CP-06 D7c    |
| Registro antigo faturado                        | cancelamento recusado                                                                               | IM1          |

Não foi criado catálogo, preço ou unidade (DEC-CP06-01/02 seguem pendentes).

## Duplicidade e risco financeiro

| Cenário                                                  | Aviso                                            | Banco emite?                                   |
| -------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Registro antigo ligado à MESMA operação com apontamentos | sim: bloco de adicionais e, agora, a confirmação | **sim** (DUP: R$ 600,00 por um serviço de 300) |
| Registro antigo sem operação                             | não                                              | sim (R-CP06-02)                                |
| Registro antigo ligado a OUTRA operação                  | não                                              | sim (R-CP06-02)                                |
| Adicional manual com o mesmo valor de um avulso          | não                                              | sim (R-CP06-03)                                |
| Registro antigo cancelado antes da emissão               | não (sai do total)                               | não entra                                      |
| Duas emissões simultâneas da mesma competência           | —                                                | não: trava do cliente, uma fatura              |
| Alteração entre a conferência e a emissão                | sim, depois (D-CP07-03)                          | sim, com o valor do momento                    |

- A matriz está fixada em `test:faturamento-cp07` (E1–E5).
- **Uma fatura financeiramente incorreta ainda pode ser emitida** quando o mesmo serviço está
  como avulsa e como registro antigo, ou como adicional manual. O sistema avisa só no primeiro
  caso. Bloquear exige DEC-CP06-04, não decidido.
- **Proposta, se o responsável decidir bloquear:** no banco, `gerar_fatura` recusaria adicional
  de registro antigo cuja operação tenha lançamento na mesma fatura. Exige migration e plano de
  compatibilidade, porque os registros antigos já faturados não mudam.

## Contratos encerrados (CN-D, DEC-CP02-01)

- **Situação:** CN-D continua como falha conhecida (spec 50). Lançamento depois do fim do
  contrato é aceito e cobrado pelas condições da última versão, e o histórico anterior é
  preservado.
- **No faturamento:** a competência que tem dias antes e depois do fim fatura os dois, sem aviso
  na confirmação.
- **Alternativas, sem decisão:**
  - **A. Bloquear:** recusar o lançamento, na RPC ou em trigger. Exige migration e afeta a
    reabertura de contratos.
  - **B. Exigir autorização:** exige modelo de aprovação, que não existe.
  - **C. Apenas avisar:** hoje nenhum alerta trata contrato encerrado (o "sem contrato" do
    Fechamento é para lançamento sem contrato nenhum). Seria um alerta novo, só de interface,
    no padrão dos que só sinalizam.
  - **D. Permitir conforme o contrato:** comportamento atual.
- **Mais aderente ao modelo existente:** C, porque segue o padrão de alertas que só sinalizam.
  A escolha é do responsável.

## Emissão, concorrência e idempotência

- **Duplo clique e Enter** em "Emitir fatura": uma fatura (EM1).
- **Duas abas:** uma fatura; a outra aba recebe "Nada a faturar…: os lançamentos já foram
  faturados (por outra aba ou outro usuário)… A tela foi atualizada." e passa a mostrar R$ 0,00,
  com "Gerar fatura" desabilitado (CC1, D-CP07-01).
- **API:** três chamadas simultâneas dão 1 sucesso e 2 P0002 (CC2). A autoridade é a trava do
  cliente no banco, não o botão.
- **Rede caída:** "Não foi possível confirmar a emissão por falha de conexão. A tela foi
  atualizada: confira a lista de faturas antes de tentar de novo."; nada gravado; a nova
  tentativa emite uma vez (RD1).
- **Resposta perdida depois de gravar:** a mesma mensagem; a tela mostra a fatura gravada e não
  oferece emitir de novo (RD2).
- **Edição durante a emissão:** a fatura sai com o que havia no banco (R$ 480,00, 2 lançamentos)
  e a tela avisa que é diferente do conferido (R$ 240,00) (ED1, D-CP07-03). Impedir a emissão
  divergente exigiria a RPC conferir um total ou uma versão enviada pela tela: é contrato de RPC,
  fica como proposta **AUT-CP07-01**.
- **Itens, vínculos e lastro:** Σ itens = total, conferido pelo banco; todos os lançamentos
  elegíveis vinculados; faltas fora.

## Imutabilidade e histórico (IM1, com o admin pela API)

| Tentativa                                       | Resultado                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `UPDATE`/`DELETE` em `invoices`                 | nada muda (sem grant de escrita)                                                                |
| `UPDATE`/`DELETE` em `invoice_items`            | nada muda                                                                                       |
| `UPDATE`/`DELETE` em lançamento faturado        | recusado: a 011 recusa a MUDANÇA da linha; um `UPDATE` que não muda nada é aceito sem efeito    |
| Cancelar adicional faturado                     | recusado                                                                                        |
| Cancelar registro antigo faturado               | recusado                                                                                        |
| Reabrir dia com lançamento faturado             | permitido (estado do dia); campos travados e "Faturado" na tela; valores iguais                 |
| Correção do valor usado por lançamento faturado | o faturado não muda (regressão spec 10 V4; retroativa sobre dias lançados recusada, CP-03 CN-C) |
| Excluir operação ou cliente com faturado        | recusado (regressão CP-04 OP5, CP-02 CL7)                                                       |

Nenhum registro faturado foi alterado. Não foi criado cancelamento, estorno nem reemissão.

## Segurança

- **Operacional e sem papel:** `gerar_fatura` → 42501; `invoices` e `invoice_items` → zero linha
  pela API (SG1).
- **Anônimo:** RPC recusada; zero linha.
- **Rotas e APIs:** `/faturamento`, `/fechamento`, `/api/fechamento*` seguem conferidas pela
  matriz da spec 41.
- RLS, grants e policies sem alteração.

## Exportações

| Exportação                       | Nome                                                       | Conteúdo conferido                                                    |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Faturamento CSV                  | `faturamento-<cliente>-<início>-<fim>.csv` (**corrigido**) | 11 linhas, presença "Presente" (**corrigido**), Σ 3.052,50 / 1.773,75 |
| Fechamento CSV diário            | `fechamento-<cliente>-<início>-<fim>-diario.csv`           | todos os colaboradores do período                                     |
| Fechamento Excel interno/cliente | regressão spec 10                                          | custo só no interno                                                   |

- O CSV do Faturamento lista **só os lançamentos**: soma 3.052,50 contra a fatura de 3.217,50
  (adicionais e registro antigo ficam de fora). Não é erro de valor, mas o arquivo não é o
  espelho da fatura (R-CP07-05). O espelho com adicionais é o Excel do Fechamento.
- O formato (UTF-8 com BOM, separador `;`) segue o gerador comum (`montarCsv`). Não foi aberto
  em aplicativo externo (indisponível na sessão).

## Defeitos RED/GREEN

| ID        | Sev. | Esperado × obtido (RED no `7e8659f`)                                                                                                            | Correção                                                                                       | Teste       |
| --------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------- |
| D4        | P2   | Confirmação sem menção a dias abertos                                                                                                           | dias fechados, abertos e sem apontamento; lista dos abertos; relê antes de abrir; sem bloqueio | D4; spec 30 |
| D-CP07-01 | P2   | Aba que perde a corrida seguia com R$ 240,00 a faturar e "Gerar fatura" ativo; mensagem genérica                                                | erro relê tudo; mensagem "Nada a faturar…"                                                     | CC1         |
| D-CP07-02 | P2   | Falha de rede: "TypeError: Failed to fetch" cru; com a resposta perdida, a tela não mostrava a fatura gravada                                   | mensagem própria e releitura                                                                   | RD1, RD2    |
| D-CP07-03 | P2   | Lançamento salvo depois da conferência: fatura de R$ 480,00 emitida sobre conferência de R$ 240,00, sem aviso                                   | aviso persistente com os dois valores                                                          | ED1         |
| D-CP07-04 | P2   | Fatura complementar na mesma competência sem dizer que já existe fatura                                                                         | aviso com a fatura existente e "complementar"                                                  | CPL         |
| D-CP07-05 | P2   | Aviso de cobrança em dobro (CP-06) ausente na confirmação                                                                                       | aviso repetido na confirmação, sem bloqueio                                                    | DUP         |
| D-CP07-06 | P3   | CSV do Faturamento sem cliente no nome (`faturamento-2027-01-01-2027-01-15.csv`); presença com o valor cru do banco (`present`, lido no código) | nome com o cliente, presença em português                                                      | EX1         |

- **Nenhum cálculo, SQL, migration, RLS, grant, trigger ou contrato de RPC alterado.**
- **Arquivos:**
  - `src/lib/faturamento-conferencia.ts` (novo): regras puras da conferência;
  - `src/app/(painel)/faturamento/painel-faturamento.tsx`: tela;
  - `src/lib/erros-banco.ts`: `ehFalhaDeRede` passa a ser exportada.
- **Ajustes de teste:**
  - `test:interface-simples` C8 confere a abertura pela nova função (que continua sem emitir);
  - a spec 30 converteu o D4 para o comportamento correto.

## Resultados

- **RED** (`7e8659f`): spec 95 com 10 falhas (D4, D-CP07-01 a 06), além de 2 erros do próprio
  teste corrigidos (contagem de faltas e seletor de linha ambíguo).
- **GREEN**, sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS;
  **79/79** `test:*` (nova `test:faturamento-cp07`, 38 asserções; `test:interface-simples` 46);
  travas 25/25; spec 95 **16/16** e spec 30 6/6; `npm run e2e:local` completo: **192 testes, 191
  PASS, 0 FAIL, 1 FALHA CONHECIDA (CN-D), 0 PULADO**, 1425 s, nenhuma conexão externa do servidor;
  `sql-local` **52 suítes** PASS.
- **Docker:** 0 containers e 0 volumes antes e depois; as 8 imagens preexistentes intocadas.
- **CP-01 a CP-06B íntegros:** specs 00 a 90 PASS na mesma execução.
- **Falhas conhecidas:** de 2 para 1 — D4 corrigido; CN-D (DEC-CP02-01) sem mudança.
- **CI no `d58c2f7`:** `validar` e `sql-local` SUCCESS; `e2e-local` FAIL só no IM1 (190 PASS, 1 FAIL,
  1 FALHA CONHECIDA). Causa: o teste pegava o lançamento faturado com `limit 1` sem ordem; na CI
  veio um com intervalo 0, o `UPDATE` de teste não mudava nada e o trigger da 011 (que recusa a
  MUDANÇA da linha) o aceitou sem efeito. Defeito do teste: agora o lançamento tem intervalo > 0,
  escolhido de forma determinística, e o `UPDATE` sem mudança é conferido à parte (aceito, nada
  muda). Spec 95 16/16 de novo.

## Riscos residuais

- **R-CP07-01 (DEC-CP06-04):** fatura com duplicidade ainda é emitida; o aviso existe só para o
  registro antigo ligado à mesma operação.
- **R-CP07-02:** a emissão não depende do dia fechado (DEC-CP07-01).
- **R-CP07-03 (AUT-CP07-01):** o banco não confere o total conferido; a tela avisa depois.
- **R-CP07-04:** fatura complementar na mesma competência é permitida pelo banco (DEC-CP07-02).
- **R-CP07-05:** o CSV do Faturamento não inclui adicionais nem registros antigos.
- **Herdados:**
  - CN-D (DEC-CP02-01), falha conhecida;
  - AUT-CP05-01 (proteção bancária do D1 e da concorrência no apontamento);
  - AUT-CP06-01 (RPC legada de cadastro de contêiner);
  - R-CP06-01 a 04.

## Decisões e autorizações pendentes

| ID          | Pergunta                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| DEC-CP07-01 | Dia de apontamento aberto na competência: só avisar (hoje), pedir confirmação extra ou bloquear a emissão                            |
| DEC-CP07-02 | Fatura complementar na mesma competência (lançamento atrasado): permitir (hoje), exigir aprovação ou proibir                         |
| DEC-CP07-03 | Estados e ciclo da fatura: rascunho e emitida sem uso; cancelamento, estorno, reemissão e detalhe na tela; vínculo com a nota fiscal |
| AUT-CP07-01 | Parâmetro de conferência em `gerar_fatura` (total ou versão esperada; recusa se divergir): muda o contrato da RPC e exige migration  |
| DEC-CP06-04 | Duplicidade com registro antigo: avisar (hoje) ou bloquear                                                                           |
| DEC-CP02-01 | Lançamento depois do fim do contrato (CN-D): bloquear, autorizar, avisar ou permitir                                                 |

Seguem abertas: DEC-CP06-01 a 05, DEC-CP04-01, DEC-CP05-01 a 05, AUT-CP05-01 e AUT-CP06-01.

## Casos não testados

- Frequência mensal com emissão e conteúdo da fatura (só competências e recusas: CP1).
- Mudança de frequência no meio do ano: coberta pela suíte SQL 038, não repetida no E2E.
- Arredondamento acumulado na fatura: coberto pelas suítes SQL 028/030; o cenário usa o modo
  diário.
- Excel do Fechamento deste cenário (regressão da spec 10 cobre o formato).
- Dashboard e Relatórios: CP-08.
- Abertura dos arquivos em aplicativo externo: indisponível na sessão.
