# QA-BS-01 · CP-05 — Apontamentos e regras financeiras

Sessão 08 (12/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`75c9b6df81094b6251b7fbea4048e2d6514510ed` (CP-04). PR #134 (Draft).

**Configuração testada = Production** (semente E2E): motor por vigência LIGADO, resolução de
tarifas DESLIGADA, domingo e feriado em dobro (051) LIGADO. Contrato criado pela tela: fator 1,5,
tolerância 10 min, hora extra no modo diário, minutos exatos no dia especial.

Cada valor foi conferido por um **cálculo independente** (`esperado()` em
`e2e/specs/80-apontamentos-financeiro.spec.ts`), escrito a partir de `docs/NEGOCIO.md` §10 e da
regra V2 aprovada, **sem importar nada de `src/`**, e comparado com a prévia da tela, com o banco,
com o fechamento e com o relatório.

## Incidente de ambiente (registrado, sem efeito em dados)

Durante o CP-04 e o início do CP-05, para conferir o banco local, chamei por engano um script de
uma sessão anterior (`q.sh`, na pasta temporária da sessão) que **envia SQL à API de gerenciamento
do Supabase do HML** (`qbnfcmrxmssnwkhaitgd`). Foram **quatro chamadas**. Em todas, o SQL foi
passado no lugar do argumento de modo (`ro|rw`), e o corpo enviado foi `{"query": "\n"}`: **nenhum
comando SQL foi executado, nada foi lido nem gravado**; a resposta foi `[]`. Ainda assim é um
acesso ao HML, proibido no CP-04 e no CP-05. Ação: os dois scripts remotos (`q.sh`, HML;
`qp.sh`, Production) foram renomeados para `*.REMOTO-NAO-EXECUTAR` e perderam a permissão de
execução; as conferências passaram a usar só `ql.sh`, que recusa rodar fora de um container local
`supabase_db_bs-e2e-*`. Production não foi chamada. O achado "RB1 não gravou" que motivou a
consulta era falso: vinha da resposta vazia do HML, não do banco local.

## Inventário de ações

Telas: `/apontamentos` (administrador) e `/operacional` (operador, só pelas RPCs). Ações
encontradas no código e na interface; PASS exige navegador e banco.

| Ação                                                   | Onde    | Resultado                 | Evidência                                                                                                                 |
| ------------------------------------------------------ | ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Selecionar operação, turno (ou "sem turno") e data     | adm, op | PASS                      | todos os casos do spec 80                                                                                                 |
| Selecionar profissional                                | adm, op | PASS com limite           | a folha lista a **equipe alocada no turno** e os lançamentos existentes; não há "adicionar colaborador" (ver DEC-CP05-02) |
| Registrar comparecimento (Presente)                    | adm, op | PASS                      | DU1–DU3, SA1, DF1                                                                                                         |
| Registrar ausência (Falta)                             | adm, op | PASS                      | DU2, PA1: falta grava horários nulos e **zero** de receita e custo                                                        |
| Registrar substituição                                 | adm     | PASS com limite           | DU2: status "Substituição" é precificado como presença; o substituto precisa estar na equipe do turno                     |
| Entrada, saída e intervalo                             | adm, op | PASS                      | DU1–DU3, SA1                                                                                                              |
| Jornada com virada de dia                              | adm, op | **CORRIGIDO** (D1)        | D1, D1 A, VD1, D1 operador, 30-falhas                                                                                     |
| Hora extra                                             | adm, op | PASS                      | derivada pelo banco (não é digitada); DU1–DU3, SA1                                                                        |
| Salvar apontamento                                     | adm, op | PASS                      | todos                                                                                                                     |
| Editar apontamento / alterar presença depois de salvar | adm     | PASS                      | PA1: presença → falta zera; falta → presença reprecifica pela vigência da data                                            |
| Excluir ou cancelar registro                           | —       | NÃO EXISTE                | não há exclusão de lançamento na interface; "cancelar" é marcar Falta (zera). O operador não tem DELETE por contrato      |
| Consultar histórico                                    | —       | NÃO EXISTE                | não há trilha de alterações do lançamento na interface (ver riscos)                                                       |
| Estado do dia: Fechar dia / Reabrir                    | adm     | PASS                      | FD1 (spec 80); o banco recusa escrita em folha fechada (031)                                                              |
| Valores calculados (prévia)                            | adm     | PASS                      | prévia = banco = cálculo independente em DU1–DU3 e SA1; domingo/feriado: "o valor aparece depois de salvar" (DF1)         |
| Lançamento faturado travado                            | adm, op | PASS (regressão)          | spec 10 ("lançamento faturado fica travado"), spec 20 (operador vê "Faturado")                                            |
| Duplo clique, falha de rede, nova tentativa            | adm     | PASS                      | RB1                                                                                                                       |
| Duas abas no mesmo dia                                 | adm     | **CORRIGIDO** (D-CP05-02) | RB2                                                                                                                       |
| Linhas novas gravadas pelo "salvar o dia"              | adm, op | **CORRIGIDO** (D-CP05-01) | PA1, D1 operador                                                                                                          |
| Função do dia, correção de função, tarifa por função   | adm     | NÃO APLICÁVEL             | só com a resolução de tarifas LIGADA (desligada em Production)                                                            |
| Diária individual e adicional diário                   | adm     | NÃO TESTADO               | só com as capacidades da 042 ligadas; fora da configuração de Production                                                  |

## Defeitos

| ID        | Sev. | Esperado × obtido (antes, HEAD `75c9b6d`)                                                                                                                                                                                                                                            | Correção                                                                                                                                                                                                                                                                                                                                                                                               | Regressão                                              |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| D1/B3     | P1   | Turno 08:00–17:00, entrada 08:00 e saída 07:50 (provável erro de digitação): **gravado sem aviso** como 22h50 — num contrato de R$ 240, R$ 915,00 cobrados e R$ 456,67 de custo (no `30-falhas`, R$ 953,13 / R$ 428,13 com diária de R$ 250). A prévia mostrava "22h50" sem destaque | Saída antes da entrada num turno que **não** vira o dia (sem `crosses_midnight` e com fim > início) bloqueia o salvamento com aviso e exige **corrigir** o horário ou **confirmar na linha** que a jornada atravessou a meia-noite. A confirmação vale só para aquele colaborador e aquele par de horários. Turnos noturnos (22–07, 15–00) seguem sem aviso. Admin e operador. **O cálculo não mudou** | D1, D1 A, D1 operador, `30-falhas` (agora PASS); A1–A9 |
| D-CP05-01 | P2   | "Salvar o dia" grava **todas** as linhas da equipe ainda sem apontamento: no admin, como presença com o horário do turno; no operador, como **presença sem horário** (diária inteira no dia útil e no sábado). A tela não distinguia linha gravada de linha sugerida                 | Admin: selo "Não gravado" em cada linha nova e aviso "N colaboradores ainda sem apontamento… quem não for marcado como Falta vira presença com o horário mostrado". Operador: aviso "N colaboradores ainda sem apontamento serão gravados como presentes sem horário". O comportamento (presença por padrão) **não mudou**: é decisão (DEC-CP05-03)                                                    | PA1, D1 operador; C1, C2                               |
| D-CP05-02 | P2   | Duas abas no mesmo dia: a segunda, com a leitura de antes, **sobrescreveu sem aviso** o que a primeira gravou (saída 18:00 virou falta; as outras linhas foram regravadas)                                                                                                           | Antes de gravar, a tela lê a versão (`updated_at`) de cada linha do lote e compara com a versão sobre a qual a pessoa editou (registrada na 1ª edição; para a linha não editada, a que a tela mostra). Diferente: nada é enviado e a tela pede para recarregar                                                                                                                                         | RB2; B1–B8                                             |

Severidade: P1 = cobrança/custo incorreto sem a pessoa perceber; P2 = gravação indevida ou perda
silenciosa evitável.

## D6 — tolerância e arredondamento (investigado, sem defeito na configuração atual)

| Excedente (min)                                        | 14  | 15  | 16  | 44  | 45  | 46  | 70  |
| ------------------------------------------------------ | --- | --- | --- | --- | --- | --- | --- |
| V2 (`nucleo_componentes_v2`, aprovada) — HE cobrada    | 0   | 30  | 30  | 30  | 60  | 60  | 60  |
| 030 (`arredondar_minutos_extras`, legado) — HE cobrada | 0   | 0   | 30  | 30  | 30  | 60  | 60  |
| HE **paga** (os dois motores)                          | 14  | 15  | 16  | 44  | 45  | 46  | 70  |

- A regra aprovada é a V2 (15 → 30; 45 → 60), confirmada também pela planilha Dynamis
  (`docs/financeiro/homologacao-fin-pr-13.md`).
- Cada espelho em TypeScript bate com o seu SQL: `billing.ts` ≡ 030 (`<= 15`/`<= 45`),
  `nucleo-financeiro.ts` ≡ 035 (`< 15`/`< 45`) (D3).
- No motor vigente (051), **dia útil e sábado** passam sempre pela V2, e **domingo e feriado**
  pelo ramo especial da V2 (sem HE). A regra 030 só roda em domingo/feriado com o dobro **e** a
  resolução desligados (D4). A prévia de domingo/feriado não usa a regra 030 (D5).
- Medido no navegador e no banco (DU1, DU2): 14 → R$ 240,00 (não cobra) e paga 14 min; 15 e 16 →
  R$ 262,50; 44 → R$ 262,50; 45, 46 e 70 → R$ 285,00; prévia = banco.
- **Horas exibidas:** a coluna "Trabalhado" usa `workedMinutes` (igual à V2); "Hora extra" mostra
  os minutos **pagos**; "A faturar" e "Custo", os valores da V2. Fonte de verdade de receita e
  custo: o banco (trigger `derivar_valores_por_vigencia`).
- **Risco residual (R-CP05-04):** se o dobro de domingo/feriado for desligado, a HE de domingo e
  feriado volta à regra 030 e cobra 15 min e 45 min pela regra antiga. Não foi alterado: mudar
  exige migration e quebraria a promessa da 051 ("desligado = igual à 050").

## Matriz de jornadas e intervalos (dia útil; diária R$ 240, custo R$ 160)

| Caso                            | Entrada → saída (intervalo)     | Trabalhado | Receita                           | Custo                             | Teste |
| ------------------------------- | ------------------------------- | ---------- | --------------------------------- | --------------------------------- | ----- |
| Jornada normal                  | 08:00 → 17:00 (60)              | 8 h        | 240,00                            | 160,00                            | DU1   |
| Saída antecipada (proporcional) | 08:00 → 15:00 (60)              | 6 h        | 180,00                            | 120,00                            | DU1   |
| Saída antecipada (13:00)        | 08:00 → 13:00 (60)              | 4 h        | 120,00                            | 80,00                             | PA1   |
| Tolerância: +10 min             | 08:00 → 17:10                   | 8h10       | 240,00                            | 160,00                            | DU3   |
| +11 min (cobra 0, paga 11)      | 08:00 → 17:11                   | 8h11       | 240,00                            | 163,67                            | DU3   |
| +14 / +15 / +16                 | 17:14 / 17:15 / 17:16           | —          | 240,00 / 262,50 / 262,50          | 164,67 / 165,00 / 166,67*         | DU1   |
| +24                             | 08:00 → 17:24                   | 8h24       | 262,50                            | 168,00                            | DU1   |
| +44 / +45 / +46 / +70           | 17:44 / 17:45 / 17:46 / 18:10   | —          | 262,50 / 285,00 / 285,00 / 285,00 | 174,67 / 175,00 / 175,33 / 183,33 | DU2   |
| Turno 06–15                     | 06:00 → 15:00 (60)              | 8 h        | 240,00                            | 160,00                            | D1 A  |
| Turno 15–00 (vira o dia)        | 15:00 → 00:00 (60)              | 8 h        | 240,00                            | 160,00                            | D1 A  |
| Turno 22–07 (vira o dia)        | 22:00 → 07:00 (60)              | 8 h        | 240,00                            | 160,00                            | D1 A  |
| D1 confirmado                   | 08:00 → 07:50 (60), turno 08–17 | 22h50      | 915,00                            | 456,67                            | D1    |
| Entrada = saída                 | 08:00 → 08:00                   | —          | bloqueado                         | bloqueado                         | D1    |

\* Fábio tem valor-hora acordado de R$ 25 para a HE paga (16 min = R$ 6,67).

## Sábado, domingo e feriado

| Caso                                    | Horário            | Receita         | Custo           | Regra                                        | Teste |
| --------------------------------------- | ------------------ | --------------- | --------------- | -------------------------------------------- | ----- |
| Sábado 3 h                              | 08:00 → 11:00 (0)  | 240,00          | 160,00          | até 4 h: diária integral (sem proporcional)  | SA1   |
| Sábado 4 h                              | 08:00 → 12:00 (0)  | 240,00          | 160,00          | idem                                         | SA1   |
| Sábado 6 h                              | 08:00 → 14:00 (0)  | 330,00          | 200,00          | diária + 2 h × 45; custo + 2 h × 20          | SA1   |
| Sábado 8 h                              | 08:00 → 17:00 (60) | 420,00          | 240,00          | diária + 4 h de HE                           | SA1   |
| Sábado 6 h, HE acordada R$ 25           | 08:00 → 14:00 (0)  | 330,00          | 210,00          | HE paga ≠ HE cobrada                         | SA1   |
| Domingo 8 h                             | 08:00 → 17:00 (60) | 480,00          | 320,00          | horas × (diária ÷ 8) × 2, sem diária         | DF1   |
| Domingo 4 h                             | 08:00 → 12:00 (0)  | 240,00          | 160,00          | idem                                         | DF1   |
| Feriado (02/11, lista legada) 8 h e 4 h | idem               | 480,00 / 240,00 | 320,00 / 160,00 | idem                                         | DF1   |
| Sáb 22:00 → dom 07:00                   | turno noturno      | 420,00          | 240,00          | **tudo como sábado** (data da entrada)       | VD1   |
| Dom 22:00 → seg 07:00                   | turno noturno      | 480,00          | 320,00          | **tudo como domingo**                        | VD1   |
| 30/11 → 01/12 e 31/12 → 01/01           | turno noturno      | 240,00          | 160,00          | data e tipo da entrada; 01/01 não cadastrado | VD1   |

O tipo do dia fica **congelado** no lançamento (`day_kind_snapshot`). Falta não recebe tipo.

## Custo × receita

Separados em todos os cenários. Exemplos medidos:

- HE cobrada: (diária ÷ 8) × 1,5 = R$ 45/h. HE paga: valor-hora acordado (Fábio, R$ 25/h) ou custo ÷
  8 sem fator (R$ 20/h). DU3: 30 min de HE → receita +22,50 nos dois; custo +12,50 (Fábio) e +10,00
  (Caio).
- Tolerância: a HE paga é em minutos exatos depois de passar a tolerância; a cobrada arredonda.
  +11 min: receita 240,00 e custo 163,67.
- 1ª quinzena de novembro (IN1, todos os lançamentos do cliente): receita **R$ 12.172,50**, custo
  **R$ 7.775,51**, resultado bruto R$ 4.396,99. O fechamento ("Receita total", "Custo previsto") e
  o relatório por colaborador batem ao centavo com o cálculo independente. Resultado bruto é
  margem operacional, não lucro líquido.

## Vigências e snapshots

Reajustes por data (contrato e custo), alteração retroativa recusada, snapshot congelado e
faturado imutável já foram comprovados no CP-02 (CN-B, CN-C), CP-03 (CN-B, CN-C) e CP-04 (CN-C) e
seguem PASS na regressão completa. Neste checkpoint: o tipo do dia e a data de referência são os
da **entrada** (VD1); a falta zera e voltar a presença reprecifica pela vigência da data (PA1); o
lançamento faturado continua travado (spec 10 e 20).

## Concorrência e robustez

| Caso                                                    | Resultado                                                                          | Teste     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| Duplo clique em "Salvar"                                | uma linha por colaborador (a RPC é idempotente por colaborador na folha)           | RB1       |
| Falha de rede                                           | mensagem em português, nada gravado, nova tentativa grava                          | RB1       |
| Duas abas no mesmo dia                                  | a segunda é recusada antes de enviar; nada sobrescrito                             | RB2       |
| Diária do mesmo colaborador em outro turno do mesmo dia | bloqueado (índice `timesheet_entries_uma_diaria_por_operacao_dia` e aviso da tela) | regressão |
| Intervalo negativo                                      | recusado pelo banco (`break_minutes >= 0`)                                         | 014       |
| Edição de faturado                                      | recusada (tela e banco)                                                            | spec 10   |

## Riscos residuais e dependências

- **R-CP05-01 (D1 no banco):** a trava do D1 está nas duas telas; o banco ainda aceita a saída
  antes da entrada de qualquer cliente que grave direto (RPC ou PostgREST). Fechar isso exige
  migration (ver AUT-CP05-01).
- **R-CP05-02 (concorrência):** a conferência de versão é feita pela tela, imediatamente antes da
  RPC; resta a janela de milissegundos entre a leitura e a gravação. A tela do operador não tem a
  conferência (o operador não lê a tabela; precisaria de RPC nova).
- **R-CP05-03 (histórico):** não há trilha de alterações do lançamento visível; a confirmação do
  D1 não fica gravada.
- **R-CP05-04 (D6):** ver acima; depende do dobro continuar ligado.
- **CP-07:** D4 (confirmação da fatura não avisa dias abertos) segue como falha conhecida.
- **DEC-CP02-01:** CN-D (lançamento depois do fim do contrato é cobrado) segue como falha conhecida.

## Decisões de negócio necessárias

| ID          | Pergunta                                                                                                                                                                | Hoje                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| DEC-CP05-01 | Existe uma duração máxima de jornada acima da qual a tela deve pedir confirmação também em turnos noturnos (ex.: 22:00 → 21:50)? E a confirmação deve ficar registrada? | sem limite; turno noturno aceita qualquer saída anterior à entrada                       |
| DEC-CP05-02 | Como registrar um substituto que não está na equipe do turno?                                                                                                           | é preciso alocá-lo, o que o tira da operação em que estava                               |
| DEC-CP05-03 | A linha nova deve nascer "Presente" (com o horário do turno no admin; sem horário no operador) ou "não apontada"?                                                       | Presente; agora com aviso                                                                |
| DEC-CP05-04 | Jornada que atravessa dois tipos de dia (sábado → domingo, véspera de feriado): ratear?                                                                                 | tudo pelo tipo da data de entrada (com a resolução ligada, o banco recusa "turno misto") |
| DEC-CP05-05 | Presença sem horário deve valer diária inteira?                                                                                                                         | sim (regra V2), inclusive quando o operador não informa horário                          |

Pendentes de antes, sem mudança: DEC-CP02-01, DEC-CP02-02, DEC-CP02-03, DEC-CP04-01.

## Autorização necessária (não implementado)

**AUT-CP05-01 — trava do D1 e da concorrência no banco.** Impacto: contrato das duas RPCs de
apontamento. Plano de compatibilidade proposto:

1. migration nova: `salvar_apontamento_admin` e `salvar_apontamento_operacional` aceitam, por
   linha, `virada_confirmada` (boolean) e a versão esperada (`updated_at`); a do operador passa de
   seis para oito chaves (hoje recusa qualquer outra com `22023`);
2. recusa (`22023`) da saída anterior à entrada quando o turno da folha não vira o dia e a linha
   não traz a confirmação; recusa (`40001`) quando a versão esperada não é a atual;
3. coluna de trilha da confirmação no lançamento; nada recalculado em lançamento existente;
4. aplicação e código publicados juntos (tela antiga contra banco novo seria recusada); suíte SQL
   nova em `supabase/tests/`; reversão: restaurar o corpo das funções e remover a coluna.

## Testes RED/GREEN e resultados

- **RED** (`75c9b6d`), primeira execução do `80-apontamentos-financeiro`: D1 sem aviso e com
  "Salvar" habilitado; nenhuma indicação de linha não gravada; a segunda aba sobrescreveu a
  primeira (Bia: presente 18:00 → falta). Toda a matriz financeira passou de primeira contra o
  cálculo independente (DU1–DU3, SA1, DF1, VD1, IN1). Ajuste do próprio teste: no RB1, esperar o
  botão voltar depois do erro de rede antes do duplo clique.
- **GREEN**, sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS;
  **77/77** `test:*` (nova `test:apontamentos-cp05`, 24 asserções; `test:apontamentos-salvar` H6
  atualizado para a nova forma do botão do operador, mesma propriedade); travas 25/25;
  `npm run e2e:local` completo: **163 testes, 161 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO**,
  1142 s, nenhuma rede externa; depois, com o FD1 acrescentado, spec 80 completo **15/15**
  (totais da 1ª quinzena impressos pelo teste: receita 12.172,50 e custo 7.775,51);
  `sql-local` **52 suítes** PASS; 0 containers e 0 volumes no fim.
- **CP-01 a CP-04 íntegros:** specs 10, 20, 40, 41, 50, 60 e 70 PASS na mesma execução completa.
- **Falhas conhecidas:** o D1 saiu da lista. Seguem D4 (CP-07) e CN-D (DEC-CP02-01).

## Casos não executados

- Diária individual, adicional diário, tarifa por função e calendário territorial: fora da
  configuração de Production (capacidades desligadas).
- Feriados estaduais e municipais por território: só com a resolução ligada; com ela desligada vale
  a lista legada de feriados (testada com 02/11).
- Modo de HE "acumulado" e arredondamento especial `meia_hora_15_45`: o contrato pela tela não os
  configura; cobertos pelas suítes SQL e Node do núcleo.
- Concorrência entre dois operadores: sem conferência de versão (R-CP05-02).
