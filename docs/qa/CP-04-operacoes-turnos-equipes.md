# QA-BS-01 · CP-04 — Operações, turnos e equipes

Evidência da auditoria do CP-04 (sessão 07, 12/11/2026, sessão em nuvem, Linux). Escopo: tela
`/operacoes` (operação fixa e avulsa, turnos, equipe), os valores comerciais exibidos nela e a
passagem para apontamento, fechamento e relatório. Supabase **local descartável**, dados
sintéticos (`TESTE-AUD-132 CP04 …`), motor por vigência LIGADO, resolução comercial DESLIGADA,
domingo/feriado em dobro LIGADO, como na Production. Nenhum acesso a HML, Preview ou Production.

Testes: `e2e/specs/70-operacoes-turnos-equipes.spec.ts`, `scripts/testar-operacoes-turnos.mjs`
(`npm run test:operacoes-turnos`) e a conversão do D3 em turno em
`e2e/specs/30-falhas-conhecidas.spec.ts`.

## Regras do sistema conferidas (não alteradas)

- **Equipe exclusiva:** um colaborador fica ativo em **uma** operação e **um** turno por vez (índice
  único `operation_team_um_ativo_por_colaborador`, migration 006). A tela mostra quem está em outra
  operação como "Indisponível — Alocado em …"; o banco recusa a segunda alocação com 23505 mesmo pela
  API. Não há sobreposição possível de alocações; não foi tratada como defeito.
- **Turno com apontamento:** a jornada fica travada; "Criar novo turno a partir deste" copia os
  horários para um turno novo; a exclusão é recusada.
- **Fim ≤ início sem "Vira a meia-noite":** o cálculo (`shiftPlannedMinutes` e
  `motor_minutos_previstos`, iguais) já o trata como virada de dia. 15:00–00:00 = 8 h.
- **Fixa × avulsa:** fixa com contrato (preço e regras do contrato) e turnos; avulsa sem contrato,
  com valor próprio por vigência e data do serviço, pode existir sem turno. Nenhuma estrutura nova de
  serviço pontual foi criada (avulsos e containers seguem para o CP-06).

## Defeitos

Reproduzidos no código do HEAD `1f94d03` (RED), corrigidos e revalidados (GREEN).

| ID         | Sev. | Esperado × obtido (antes)                                                                                                                                                                                                               | Correção                                                                                                                                                                                            | Regressão                                                                                                               |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| D3 (turno) | P2   | Duplo clique em "Salvar turno": esperado 1, obtido **2** turnos (reproduzido em todas as execuções desde o #133). O botão nem ficava desabilitado durante o envio                                                                       | trava de envio único (`src/lib/trava.ts`), botão "Salvando..." desabilitado                                                                                                                         | TU2 (duplo clique e Enter ×3), TU3, 30-falhas (agora PASS); D2                                                          |
| D-CP04-01  | P2   | Duplo clique em "Salvar operação": esperado 1, obtido **2** operações                                                                                                                                                                   | mesma trava nos três caminhos de envio                                                                                                                                                              | OP2; D1                                                                                                                 |
| D-CP04-02  | P2   | Com o motor por vigência, o cartão da avulsa mostrava o valor do cadastro (R$ 200,00) no lugar do de hoje (R$ 220,00) quando a leitura das vigências falhava; o seletor de contrato e o custo na equipe tinham o mesmo recuo silencioso | `useValoresDeHojeComEstado` nos três (contrato, operação, colaborador): "Carregando…" / "Indisponível"                                                                                              | OP3; E1, E2                                                                                                             |
| D-CP04-03  | P2   | Turno com "Vira a meia-noite" marcado e fim depois do início (08:00–17:00) era aceito e virava **32 h líquidas** no cálculo; intervalo maior que o turno também era aceito                                                              | `errosDoTurno` bloqueia esses dois casos com mensagem; 15:00–00:00 sem marcar continua aceito, com aviso "termina no dia seguinte"; início = fim (24 h) só avisa (DEC-CP04-01). O cálculo não mudou | TU1; A1–A10                                                                                                             |
| D-CP04-04  | P3   | Formulário da operação oferecia cliente inativo e contrato encerrado/inativo sem distinção                                                                                                                                              | rótulos "(inativo)", "(encerrado em dd/mm/aaaa)", "(começa em …)" e aviso ao escolher contrato encerrado. **Nada é bloqueado nem filtrado** (DEC-CP02-01)                                           | OP1; B1–B4                                                                                                              |
| D-CP04-05  | P3   | Nome de operação e de turno só com espaços aceito; espaços das pontas gravados (gerava dois " Op " indistinguíveis)                                                                                                                     | `nomeValido`/`nomeLimpo`                                                                                                                                                                            | OP1, OP2, TU1; D3                                                                                                       |
| D-CP04-06  | P3   | 12 rótulos dos formulários de operação e turno soltos dos campos                                                                                                                                                                        | `htmlFor`/`id`                                                                                                                                                                                      | OP1, TU1; E4                                                                                                            |
| D-CP04-07  | P3   | Excluir turno com equipe (ou operação com turnos e equipe) confirmava só "Excluir o turno X?"; as alocações saem em cascata                                                                                                             | a confirmação diz o que sai junto                                                                                                                                                                   | TU5; C1, C2                                                                                                             |
| D-CP04-08  | P3   | Alocar/desalocar mostravam `error.message` cru em falha (ex.: rede)                                                                                                                                                                     | `mensagemDoErro` (a mensagem própria da exclusividade 23505 foi mantida)                                                                                                                            | EQ2; E3 — RED não isolado no E2E (o cenário caía antes, pelo D-CP04-05); comprovado pela leitura do código e pelo GREEN |

Nenhum defeito exigiu mudança de SQL, migration, RLS, policy, grant, trigger ou cálculo.

## Matriz de ações

Tipo: **I** interface · **N** integração · **R** regra/banco.

### Operações

| ID  | Tipo | Ação                                                                                                                                  | Status                                                                | Teste |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| OP1 | I    | Nova operação: rótulos, nome vazio/só espaços, cliente inativo e contrato encerrado identificados                                     | CORRIGIDO (D-CP04-04, 05, 06)                                         | OP1   |
| OP2 | I/R  | Fixa com contrato: duplo clique e Enter ×3 = 1 operação; vínculos cliente/contrato/tipo no banco e no cartão                          | CORRIGIDO (D-CP04-01, 05)                                             | OP2   |
| OP3 | I/N  | Avulsa sem contrato com valor e data; "Alterar valor" 200 → 220; cartão com o valor de hoje; erro de leitura não mostra o do cadastro | CORRIGIDO (D-CP04-02)                                                 | OP3   |
| OP4 | I    | Editar local e observações; recarregar                                                                                                | PASS                                                                  | OP4   |
| OP5 | R    | Excluir com apontamento (recusado em português) e sem dependência (removida)                                                          | PASS                                                                  | OP5   |
| OP6 | I    | Inativar operação                                                                                                                     | N/A — a tela não oferece status (o campo existe no banco)             | —     |
| OP7 | I    | Localidade                                                                                                                            | N/A com a resolução desligada (como na Production)                    | —     |
| OP8 | I    | Confirmar/cancelar operação                                                                                                           | N/A — não existe esse fluxo; "Cancelar" fecha o formulário sem gravar | OP1   |

### Turnos

| ID   | Ação                                                        | Esperado                                                  | Obtido                                                              | Status                | Teste |
| ---- | ----------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | --------------------- | ----- |
| TU-a | 06:00–15:00, intervalo 60                                   | aceito, 8 h                                               | 8 h                                                                 | PASS                  | TU2   |
| TU-b | 15:00–00:00 sem marcar                                      | aceito, aviso "termina no dia seguinte", 8 h              | conforme                                                            | PASS                  | TU1   |
| TU-c | 22:00–07:00 marcado                                         | aceito, "07:00 (+1d)", 8 h                                | conforme                                                            | PASS                  | TU2   |
| TU-d | 08:00–17:00 marcado                                         | bloqueado                                                 | antes: aceito (32 h); depois: bloqueado com mensagem                | CORRIGIDO (D-CP04-03) | TU1   |
| TU-e | Intervalo maior que o turno                                 | bloqueado                                                 | antes: aceito; depois: bloqueado                                    | CORRIGIDO (D-CP04-03) | TU1   |
| TU-f | Início = fim (24 h)                                         | decisão                                                   | aviso, não bloqueia                                                 | RISCO (DEC-CP04-01)   | A9    |
| TU-g | Duplo clique, Enter ×3                                      | 1 turno                                                   | antes: 2; depois: 1                                                 | CORRIGIDO (D3)        | TU2   |
| TU-h | Falha de rede, carregamento, nova tentativa                 | português; "Salvando..."; grava 1                         | antes: sem carregamento; depois: conforme                           | CORRIGIDO (D3)        | TU3   |
| TU-i | Turno com apontamento: editar, criar a partir dele, excluir | jornada travada; cópia com os horários; exclusão recusada | conforme                                                            | PASS                  | TU4   |
| TU-j | Excluir turno com equipe                                    | confirmação diz quem sai                                  | antes: genérica; depois: "1 colaborador sai da equipe deste turno." | CORRIGIDO (D-CP04-07) | TU5   |
| TU-k | Turnos com o mesmo nome                                     | sem regra que proíba                                      | não bloqueado                                                       | N/A (sem regra)       | —     |
| TU-l | Dias da semana do turno                                     | —                                                         | o turno não tem dias (o dia é do apontamento)                       | N/A                   | —     |

### Equipes

| ID     | Ação                                                | Resultado                                                                                    | Status                  | Teste      |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| EQ-A/B | Alocar vários no mesmo turno e em turnos diferentes | Rui e Sol no turno do dia, Tito na noite; contador "Equipe (3)"                              | PASS                    | EQ1        |
| EQ-C/E | Função de trabalho na equipe                        | seletor só com a resolução ligada (OFF na Production); a alocação herda a função do cadastro | PASS (OFF)              | CP-03 CN-E |
| EQ-D   | Desalocar (com falha de rede antes)                 | português; desaloca; o lançamento do dia anterior continua                                   | CORRIGIDO (D-CP04-08)   | EQ2        |
| EQ-F   | Trocar a função no cadastro                         | não reescreve a alocação nem o lançamento                                                    | PASS                    | CP-03 CN-E |
| EQ-G   | Substituição                                        | registrada no apontamento (presença "Substituição"), não na equipe                           | PASS (10-ciclo) / CP-05 | 10-ciclo   |
| EQ-H/I | Mesmo colaborador em duas operações                 | tela: "Indisponível — Alocado em …"; banco: 23505                                            | PASS                    | EQ1        |
| EQ-J   | Filtros e busca                                     | "Em outra operação" e busca por nome                                                         | PASS                    | EQ1        |

## Integração e conciliação

Operação fixa com o contrato a R$ 250,00 (300 a partir de 08/10); Rui custo 150 (170 a partir de
09/10), Sol 180, Tito 150. Salvar o dia grava a equipe inteira do turno (comportamento do
apontamento, CP-05): Sol aparece nos mesmos dias que Rui.

| Data  | Quem     | Turno                               | Receita esperada = obtida | Custo esperado = obtido |
| ----- | -------- | ----------------------------------- | ------------------------- | ----------------------- |
| 05/10 | Tito     | Noite 22:00–07:00 (data da entrada) | 250,00                    | 150,00                  |
| 06/10 | Rui, Sol | Dia 06:00–15:00                     | 250 + 250                 | 150 + 180               |
| 07/10 | Rui, Sol | Dia                                 | 250 + 250                 | 150 + 180               |
| 08/10 | Rui, Sol | Dia (contrato 300)                  | 300 + 300                 | 150 + 180               |
| 09/10 | Rui, Sol | Dia (contrato 300, Rui 170)         | 300 + 300                 | 170 + 180               |

Fechamento 01–15/10: receita **R$ 2.450,00**, custo **R$ 1.490,00**. Relatório por colaborador:
Rui R$ 620,00, Sol R$ 720,00, Tito R$ 150,00. Lançamentos de antes de cada reajuste ficam com o valor
da sua data. A lista mostra os valores de hoje (contrato R$ 300,00 no seletor, custo R$ 170,00 na
equipe). Nenhuma diferença ao centavo.

Evidência adicional para DEC-CP02-01: na primeira execução do teste a operação ficou ligada, por
engano do próprio teste, ao contrato **encerrado em 30/09**; os lançamentos de outubro foram
cobrados normalmente pelo valor dele (R$ 200,00). O fim do contrato não limita a cobrança.

## Decisões pendentes e alternativas

| ID                     | Situação                                                       | Alternativas e impacto                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-CP02-01 (continua) | Contrato encerrado ou inativo continua selecionável e cobrando | (a) **feito:** identificar no seletor e avisar ao escolher, sem mudar cobrança; (b) impedir escolher contrato encerrado/inativo em operação **nova** (só tela, sem efeito nas existentes); (c) recusar lançamento depois do fim do contrato (motor, CP-05/CP-07, exige migration e decisão sobre o que já foi lançado); (d) encerrar a vigência das condições junto com o fim do contrato |
| DEC-CP04-01            | Turno com início igual ao fim é aceito como 24 h               | aceitar (hoje, com aviso) ou bloquear; depende de existir plantão de 24 h                                                                                                                                                                                                                                                                                                                 |

## Riscos residuais e dependências

- **CP-05:** salvar o dia grava a equipe inteira do turno; B3/D1 (saída antes da entrada) continua.
- **CP-06:** avulsa sem data do serviço nasce com a vigência a partir de hoje (lançar dias anteriores
  exige "Alterar valor" antecipando o início); modalidades de avulso.
- **CP-09:** exclusões no `window.confirm` nativo (D8), agora com as consequências no texto.
- A operação não tem status editável na tela (inativar operação não existe).

## Testes RED/GREEN e resultados

- **RED** (`1f94d03`), primeira execução do `70-operacoes-turnos-equipes`: rótulos de operação e
  turno soltos; **2 operações** no duplo clique, gravadas com espaços (" … Op Fixa ", o que tornou
  os botões ambíguos e derrubou os cenários seguintes); cartão da avulsa com R$ 200,00 do cadastro
  com erro de leitura; "Salvar turno" sem estado de carregamento. D3 em turno: reproduzido pelo
  `30-falhas-conhecidas` em todas as execuções anteriores (2 turnos).
- Ajustes do próprio teste durante o GREEN: seletor do contrato que casava também o "Contrato
  Encerrado" (`^Nome ` → `^Nome — `) e fechamento do diálogo por "Cancelar" em vez de dois `Escape`.
- **GREEN, sessão em nuvem (Linux, Node 22.23, Docker local):** lint, `tsc`, `check:workflow`,
  `git diff --check` PASS; **76/76** `test:*` (nova `test:operacoes-turnos` 23/23); build PASS
  (placeholders da CI); travas 25/25; `npm run e2e:local` completo: **148 testes, 145 PASS, 0 FAIL,
  3 FALHA CONHECIDA, 0 PULADO**, 990 s, nenhuma rede externa, encerramento sem sobras; `sql-local` 52
  suítes PASS.
- **Falhas conhecidas:** D3 em turno saiu da lista (o teste do `30-falhas-conhecidas` agora confere
  1 turno, sem a etiqueta). Seguem B3/D1 (CP-05), confirmação da fatura (D4, CP-07) e CN-D
  (DEC-CP02-01).
- **CP-01, CP-02 e CP-03 íntegros:** specs 40, 41, 50 e 60 PASS na mesma execução; suítes
  `mensagens-auth`, `clientes-contratos` e `colaboradores-custos` PASS.
